"""Сравнение ИСХОДНЫХ ответов ИИ с ручными эталонами. Владелец: Участник 4 (Q06).

Запуск (из корня проекта):
    .venv/bin/python evaluation/compare.py --split dev
    .venv/bin/python evaluation/compare.py --split holdout --version-id 3

Эталон: evaluation/golden/<conversation_id>.json
{
  "conversation_id": "p1-ru-001", "checklist_version_id": 2, "split": "dev",
  "content_hash": "<необязательно: хеш транскрипта на момент разметки>",
  "results": [{"criterion_id": "...", "status": "applicable", "answer": "yes",
               "evidence_message_ids": ["m004"]}]
}
Берётся последняя завершённая оценка диалога по той же версии чек-листа.
Решения проверяющего в метрику НЕ входят (используется ai_results / ai_score).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from cqa import storage  # noqa: E402
from cqa.models import CriterionResult  # noqa: E402
from cqa.scoring import score  # noqa: E402


def latest_eval(conversation_id: str, version_id: int) -> dict | None:
    with storage.tx() as c:
        r = c.execute(
            "SELECT evaluation_id FROM evaluations WHERE conversation_id=? AND checklist_version_id=? "
            "AND status='completed' ORDER BY evaluation_id DESC LIMIT 1", (conversation_id, version_id)).fetchone()
    return storage.get_evaluation(r[0]) if r else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="dev", choices=["dev", "holdout", "all"])
    ap.add_argument("--version-id", type=int, help="переопределить версию чек-листа из эталона")
    args = ap.parse_args()

    golden = sorted((ROOT / "evaluation" / "golden").glob("*.json"))
    agree = defaultdict(lambda: [0, 0])          # (criterion|lang) -> [совпало, всего]
    na = {"tp": 0, "fp": 0, "fn": 0}
    ev_ok = [0, 0]
    total_err: list[float] = []
    missing, stale, cases, cost = [], [], 0, 0.0
    errors: list[str] = []

    for f in golden:
        g = json.loads(f.read_text(encoding="utf-8"))
        if args.split != "all" and g.get("split") != args.split:
            continue
        vid = args.version_id or g["checklist_version_id"]
        conv = storage.get_conversation(g["conversation_id"])
        ev = latest_eval(g["conversation_id"], vid)
        if not ev or not conv:
            missing.append(g["conversation_id"])
            continue
        if g.get("content_hash") and g["content_hash"] != ev["content_hash"]:
            stale.append(g["conversation_id"])
            continue
        cases += 1
        cost += ev.get("cost_usd") or 0
        lang = conv.language
        ai = {r["criterion_id"]: r for r in ev["ai_results"]}
        for gr in g["results"]:
            cid = gr["criterion_id"]
            a = ai.get(cid, {})
            same = a.get("status") == gr["status"] and (gr["status"] != "applicable" or a.get("answer") == gr.get("answer"))
            for key in (f"crit:{cid}", f"lang:{lang}", "ALL"):
                agree[key][0] += same
                agree[key][1] += 1
            if not same:
                errors.append(f"{g['conversation_id']} [{lang}] {cid}: эталон {gr['status']}/{gr.get('answer')} "
                              f"— ИИ {a.get('status')}/{a.get('answer')}")
            g_na, a_na = gr["status"] == "not_applicable", a.get("status") == "not_applicable"
            na["tp"] += g_na and a_na
            na["fp"] += (not g_na) and a_na
            na["fn"] += g_na and not a_na
            if gr.get("evidence_message_ids") and a.get("status") == "applicable":
                ev_ok[1] += 1
                ev_ok[0] += bool(set(gr["evidence_message_ids"]) & set(a.get("evidence_message_ids") or []))
        chk = storage.get_checklist(vid)
        g_total = score(chk, [CriterionResult(explanation="", **{k: v for k, v in r.items() if k != "explanation"})
                              for r in g["results"]]).total
        a_total = ev["ai_score"]["total"]
        if g_total is not None and a_total is not None:
            total_err.append(abs(g_total - a_total))

    pct = lambda a, b: f"{a}/{b} ({100 * a / b:.0f}%)" if b else "—"  # noqa: E731
    print(f"Эталонов в выборке «{args.split}»: проверено {cases}; без оценки {len(missing)}; устаревших {len(stale)}")
    print(f"Совпадение ответов (всего): {pct(*agree['ALL'])}")
    for k in sorted(k for k in agree if k.startswith("lang:")):
        print(f"  {k[5:]}: {pct(*agree[k])}")
    for k in sorted(k for k in agree if k.startswith("crit:")):
        print(f"  {k[5:]}: {pct(*agree[k])}")
    p = na["tp"] / (na["tp"] + na["fp"]) if na["tp"] + na["fp"] else None
    r = na["tp"] / (na["tp"] + na["fn"]) if na["tp"] + na["fn"] else None
    print(f"N/A: precision {p if p is None else round(p, 2)}, recall {r if r is None else round(r, 2)} ({na})")
    print(f"Доказательство пересекается с эталоном: {pct(*ev_ok)}")
    if total_err:
        print(f"Ошибка итога: средняя {sum(total_err) / len(total_err):.2f} п.п., макс {max(total_err):.2f} п.п.")
    print(f"Стоимость оценок в выборке: ${cost:.4f}")
    if missing:
        print("Нет завершённой оценки:", ", ".join(missing))
    if errors:
        print("\nРасхождения:")
        print("\n".join("  " + e for e in errors))


if __name__ == "__main__":
    main()
