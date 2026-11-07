"""Прогон оценщика на тест-сете с известными ответами + отчёт. Владельцы: Участники 2 и 4.

Работает в ОТДЕЛЬНОЙ БД (по умолчанию data/eval.sqlite3), чтобы эталонные прецеденты
не попадали в рабочие оценки. Использует настоящую модель из .env (EVALUATOR_MODE=real).

Примеры (из корня проекта):
  # базовая линия без калибровки, 2 повтора для оценки стабильности
  .venv/bin/python evaluation/run_eval.py --tag base --calibration off --repeat 2
  # «дообучение»: ошибки базовой линии на RU -> прецеденты; проверка на KZ и EN
  .venv/bin/python evaluation/run_eval.py --tag cal --calibration on --seed-from base --seed-langs RU --langs KZ,EN

Отчёт: evaluation/reports/<tag>.md и <tag>.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from cqa.config import settings  # noqa: E402

REPORTS = ROOT / "evaluation" / "reports"


def compare(ai_results: list[dict], expected: dict, conv_msgs: dict) -> list[dict]:
    ai = {r["criterion_id"]: r for r in ai_results}
    rows = []
    for crit, e in expected.items():
        a = ai.get(crit, {})
        ok = a.get("status") == e["status"] and (e["status"] != "applicable" or a.get("answer") in e["answers"])
        ev_ok = None
        if e.get("evidence_any") and a.get("status") == "applicable" and ok:
            ev_ok = bool(set(e["evidence_any"]) & set(a.get("evidence_message_ids") or []))
        # авторство: ни одно доказательство положительного ответа не должно быть только от бота/клиента
        rows.append({
            "criterion": crit, "expected": e, "got_status": a.get("status"), "got_answer": a.get("answer"),
            "ok": ok, "evidence_ok": ev_ok, "explanation": a.get("explanation", ""),
            "evidence": [(m, conv_msgs.get(m, "?")) for m in a.get("evidence_message_ids") or []],
        })
    return rows


def pct(a: int, b: int) -> str:
    return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "—"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--testset", default=str(ROOT / "data/testsets/synthetic_v1.json"))
    ap.add_argument("--db", default=str(ROOT / "data/eval.sqlite3"))
    ap.add_argument("--tag", required=True)
    ap.add_argument("--calibration", choices=["on", "off"], default="off")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--langs", default="", help="через запятую: RU,KZ,EN (по умолчанию все)")
    ap.add_argument("--seed-from", default="", help="tag прошлого прогона: его ошибки станут прецедентами")
    ap.add_argument("--seed-langs", default="", help="языки, ошибки которых берутся в прецеденты")
    ap.add_argument("--resume", action="store_true", help="досчитать только несостоявшиеся оценки прогона --tag")
    args = ap.parse_args()

    settings.db_path = Path(args.db)
    settings.calibration = args.calibration == "on"
    if settings.evaluator_mode != "real":
        print("ВНИМАНИЕ: EVALUATOR_MODE != real — оценки будут тестовыми (mock)")

    from cqa import importer, storage
    from cqa.main import _run_evaluation
    from cqa.models import ChecklistDraft

    ts = json.loads(Path(args.testset).read_text(encoding="utf-8"))
    storage.init_db()
    storage.upsert_conversations(importer.parse_response(ts["dataset"]))

    # Версия чек-листа: переиспользуем идентичную, иначе сохраняем новую
    draft = ChecklistDraft.model_validate_json((ROOT / ts["checklist"]).read_text(encoding="utf-8"))
    vid = next((v.version_id for v in storage.list_checklists()
                if [c.model_dump() for c in v.criteria] == [c.model_dump() for c in draft.criteria]), None)
    if vid is None:
        vid = storage.save_checklist(draft).version_id
    chk = storage.get_checklist(vid)

    langs = {x.strip().upper() for x in args.langs.split(",") if x.strip()}
    conv_ids = [cid for cid in ts["expected"] if not langs or ts["meta"][cid]["language"] in langs]

    # ---- «Дообучение»: ошибки прошлого прогона -> прецеденты калибровки ----
    seeded = 0
    if args.seed_from:
        prev = json.loads((REPORTS / f"{args.seed_from}.json").read_text(encoding="utf-8"))
        seed_langs = {x.strip().upper() for x in args.seed_langs.split(",") if x.strip()}
        crit_by_id = {c.criterion_id: c for c in chk.criteria}
        for item in prev["items"]:
            if item["repeat"] != 0 or item["ok"] or (seed_langs and item["language"] not in seed_langs):
                continue
            conv = storage.get_conversation(item["conversation_id"])
            e = item["expected"]
            ops = [{"message_id": m.message_id, "speaker": m.speaker, "text": m.text} for m in conv.messages
                   if m.speaker != "bot" or item["criterion"] == "demo_greeting"]
            ex_id = storage.add_calibration_example(
                criterion_id=item["criterion"], criterion_fingerprint=storage.criterion_fingerprint(crit_by_id[item["criterion"]]),
                conversation_id=item["conversation_id"], excerpt=ops,
                ai_status=item["got_status"], ai_answer=item["got_answer"],
                correct_status=e["status"], correct_answer=(e.get("answers") or [None])[0],
                reason=f"Эталон: {ts['meta'][item['conversation_id']]['what']}", source="golden")
            seeded += bool(ex_id)
        print(f"Добавлено прецедентов калибровки: {seeded}")

    # ---- Прогон ----
    items, evals = [], []
    todo = {r: list(conv_ids) for r in range(args.repeat)}
    if args.resume:
        prev = json.loads((REPORTS / f"{args.tag}.json").read_text(encoding="utf-8"))
        ok_keys = {(e["repeat"], e["conversation_id"]) for e in prev["evaluations"] if e["status"] == "completed"}
        evals = [e for e in prev["evaluations"] if (e["repeat"], e["conversation_id"]) in ok_keys]
        items = [it for it in prev["items"] if (it["repeat"], it["conversation_id"]) in ok_keys]
        args.repeat = prev["summary"]["repeat"]
        conv_ids = sorted({e["conversation_id"] for e in prev["evaluations"]})
        todo = {r: [c for c in conv_ids if (r, c) not in ok_keys] for r in range(args.repeat)}
        print(f"Досчитываем: {sum(len(v) for v in todo.values())} оценок")
    t0 = time.monotonic()
    for r in range(args.repeat):
        batch = f"eval-{args.tag}-{r}"
        if not todo[r]:
            continue
        ids = [storage.create_evaluation(cid, storage.get_conversation(cid).content_hash, vid, batch) for cid in todo[r]]
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(_run_evaluation, ids))
        for eid in ids:
            ev = storage.get_evaluation(eid)
            evals.append({"repeat": r, "evaluation_id": eid, "conversation_id": ev["conversation_id"],
                          "status": ev["status"], "error": ev["error"], "cost_usd": ev["cost_usd"],
                          "model": ev["model"], "prompt_version": ev["prompt_version"],
                          "latency_s": sum(c.get("latency_s") or 0 for c in (ev["usage"] or {}).get("calls", [])),
                          "calls": len((ev["usage"] or {}).get("calls", []))})
            if ev["status"] != "completed":
                continue
            cid = ev["conversation_id"]
            msgs = {m.message_id: m.speaker for m in storage.get_conversation(cid).messages}
            for row in compare(ev["ai_results"], ts["expected"][cid], msgs):
                items.append({"repeat": r, "conversation_id": cid, "language": ts["meta"][cid]["language"],
                              "scenario": ts["meta"][cid]["scenario"], **row})
        print(f"повтор {r + 1}/{args.repeat}: выполнено {sum(storage.get_evaluation(i)['status'] == 'completed' for i in ids)}/{len(ids)}")
    wall = time.monotonic() - t0

    # ---- Метрики ----
    def group(key):
        g = defaultdict(lambda: [0, 0])
        for it in items:
            g[it[key]][0] += it["ok"]
            g[it[key]][1] += 1
        return dict(sorted(g.items()))

    total = [sum(it["ok"] for it in items), len(items)]
    ev_items = [it for it in items if it["evidence_ok"] is not None]
    done = [e for e in evals if e["status"] == "completed"]
    costs = [e["cost_usd"] for e in done if e["cost_usd"] is not None]
    stability = None
    if args.repeat > 1:
        answers = defaultdict(set)
        for it in items:
            answers[(it["conversation_id"], it["criterion"])].add((it["got_status"], it["got_answer"]))
        stability = [sum(len(v) == 1 for v in answers.values()), len(answers)]

    summary = {
        "tag": args.tag, "testset": ts["name"], "checklist_version_id": vid, "calibration": args.calibration,
        "calibration_examples_seeded": seeded, "repeat": args.repeat, "langs": sorted({ts["meta"][c]["language"] for c in conv_ids}),
        "model": sorted({e["model"] for e in done if e["model"]}), "prompt_versions": sorted({e["prompt_version"] for e in done}),
        "accuracy": total, "by_criterion": group("criterion"), "by_language": group("language"),
        "by_scenario": group("scenario"),
        "evidence": [sum(it["evidence_ok"] for it in ev_items), len(ev_items)],
        "evaluations": {"total": len(evals), "completed": len(done), "failed": len(evals) - len(done)},
        "cost_usd": {"total": round(sum(costs), 6), "per_eval": round(sum(costs) / len(costs), 6) if costs else None,
                     "unknown": len(done) - len(costs)},
        "latency_s_avg": round(sum(e["latency_s"] for e in done) / len(done), 1) if done else None,
        "wall_s": round(wall, 1), "stability": stability,
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / f"{args.tag}.json").write_text(
        json.dumps({"summary": summary, "items": items, "evaluations": evals}, ensure_ascii=False, indent=1), encoding="utf-8")

    lines = [f"# Прогон «{args.tag}» — {ts['name']}", "",
             f"Модель: {', '.join(summary['model']) or '—'} · промпт: {', '.join(summary['prompt_versions'])} · "
             f"калибровка: {args.calibration}" + (f" ({seeded} прецедентов из «{args.seed_from}»)" if args.seed_from else ""),
             f"Языки: {', '.join(summary['langs'])} · повторов: {args.repeat}", "",
             "| Метрика | Значение |", "|---|---|",
             f"| Совпадение с эталоном | **{pct(*total)}** |",
             f"| Доказательство указывает на нужную реплику оператора | {pct(*summary['evidence'])} |",
             f"| Оценок завершено | {len(done)}/{len(evals)} |",
             f"| Стоимость | ${summary['cost_usd']['total']:.4f} всего, ${summary['cost_usd']['per_eval'] or 0:.4f} за оценку |",
             f"| Время ответа модели (среднее) | {summary['latency_s_avg']} с |"]
    if stability:
        lines.append(f"| Стабильность (одинаковый ответ во всех повторах) | {pct(*stability)} |")
    for title, key in (("По критериям", "by_criterion"), ("По языкам", "by_language"), ("По сценариям", "by_scenario")):
        lines += ["", f"## {title}", "", "| | Совпало |", "|---|---|"]
        lines += [f"| {k} | {pct(*v)} |" for k, v in summary[key].items()]
    fails = [it for it in items if not it["ok"]]
    lines += ["", f"## Расхождения ({len(fails)})", ""]
    for it in fails:
        e = it["expected"]
        want = e["status"] if e["status"] != "applicable" else "/".join(e["answers"])
        got = it["got_status"] if it["got_status"] != "applicable" else it["got_answer"]
        lines.append(f"- `{it['conversation_id']}` · **{it['criterion']}** · эталон `{want}` → модель `{got}` "
                     f"(повтор {it['repeat'] + 1}): {it['explanation'][:180]}")
    errs = [e for e in evals if e["status"] != "completed"]
    if errs:
        reasons = defaultdict(list)
        for e in errs:
            reasons[(e["status"], (e["error"] or "").splitlines()[0][:160])].append(e["conversation_id"])
        lines += ["", f"## Сбои оценки ({len(errs)}) — досчитать: `--tag {args.tag} --resume`", ""]
        lines += [f"- {st}: {msg} — {len(ids)} шт." for (st, msg), ids in reasons.items()]
    (REPORTS / f"{args.tag}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("\n".join(lines[:16]))
    print(f"\nОтчёт: evaluation/reports/{args.tag}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
