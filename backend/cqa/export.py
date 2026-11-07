"""Экспорт результатов в формат организаторов (Приложение «Как сдать результаты», JSON 1.0) и проверка файла.
Владельцы: Участники 1 и 4.

  cd backend
  ../.venv/bin/python -m cqa.export --group DEV  --out ../results/dev/results.json  --expect 65
  ../.venv/bin/python -m cqa.export --group PROD --out ../results/prod/results.json --expect 10
  ../.venv/bin/python -m cqa.export --check ../results/dev/results.json

Правила формата:
- value: true/false/null (N/A) или число шкалы ДО веса; evidence_turns — номера реплик с 1 по исходному транскрипту;
- final_score 0..100, 2 знака; N/A исключается, вес перераспределяется; critical_flag = value критерия critical;
- не удалось оценить -> status "error", criteria [], score null, error — причина (не ноль!).
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Optional

from . import storage
from .config import settings

SCHEMA_VERSION = "1.0"
# код -> (тип, допустимые значения, вес). Из приложения к гайду, стр. 3.
OFFICIAL = {
    "contact":        ("bool", {True, False}, 10),
    "discovery":      ("bool", {True, False, None}, 15),
    "identification": ("bool", {True, False, None}, 20),
    "consultation":   ("scale", {0, 5, 10, 15, 20, None}, 20),
    "empathy":        ("bool", {True, False}, 15),
    "dialogue":       ("scale", {0, 4, 7, 10}, 15),
    "closure":        ("bool", {True, False, None}, 5),
    "critical":       ("bool", {True, False}, 0),
}
SCALE_MAX = {"consultation": 20, "dialogue": 10}


def _turn(mid: str) -> Optional[int]:
    return int(mid[1:]) if mid and mid[0] == "m" and mid[1:].isdigit() else None


def _value(code: str, r: dict) -> Any:
    if r["status"] == "not_applicable":
        return None
    kind = OFFICIAL[code][0]
    if kind == "bool":
        return r["answer"] == "yes"
    return int(r["answer"])


def _evidence(r: dict) -> list[int]:
    turns = [t for t in (_turn(m) for m in r.get("evidence_message_ids") or []) if t]
    rng = r.get("checked_range")
    if not turns and rng:
        a, b = _turn(rng["from_message_id"]), _turn(rng["to_message_id"])
        if a and b and a <= b:
            turns = list(range(a, b + 1))
    return sorted(set(turns))


def official_score(criteria: list[dict]) -> Optional[float]:
    """Независимый пересчёт итога по правилам приложения — для проверки файла."""
    num = den = Decimal(0)
    for c in criteria:
        kind, _, w = OFFICIAL[c["criterion_id"]]
        v = c["value"]
        if v is None or w == 0:
            continue
        q = Decimal(1 if v else 0) if kind == "bool" else Decimal(v) / SCALE_MAX[c["criterion_id"]]
        num += Decimal(w) * q
        den += Decimal(w)
    if den == 0:
        return None
    return float((Decimal(100) * num / den).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _latest(conversation_id: str, version_id: int) -> Optional[dict]:
    with storage.tx() as c:
        r = c.execute("SELECT evaluation_id FROM evaluations WHERE conversation_id=? AND checklist_version_id=? "
                      "AND status IN ('completed','failed') ORDER BY evaluation_id DESC LIMIT 1",
                      (conversation_id, version_id)).fetchone()
    return storage.get_evaluation(r[0]) if r else None


def build(group_id: str, version_id: int, team: str) -> dict:
    chk = storage.get_checklist(version_id)
    codes = [c.criterion_id for c in chk.criteria]
    if set(codes) != set(OFFICIAL):
        raise ValueError(f"Версия {version_id} не официальный чек-лист: {codes}")
    convs = storage.list_conversations(group_id=group_id)
    results, models = [], set()
    for conv in convs:
        cid = conv["conversation_id"]
        ev = _latest(cid, version_id)
        if not ev:
            results.append({"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                            "error": "Диалог не оценён этой версией чек-листа."})
            continue
        if ev["status"] != "completed":
            results.append({"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                            "error": f"Не удалось получить ответ модели: {(ev['error'] or '')[:200]}"})
            continue
        models.update(m.strip() for m in (ev["model"] or "").split(",") if m.strip())
        by = {r["criterion_id"]: r for r in ev["final_results"]}
        review = [f"{k}: {by[k].get('review_reason') or 'нужна проверка'}" for k in OFFICIAL if by[k]["status"] == "needs_review"]
        if review:
            results.append({"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                            "error": "Оценка требует ручной проверки — " + "; ".join(review)[:300]})
            continue
        criteria = []
        for code in OFFICIAL:  # порядок как в приложении
            r = by[code]
            rationale = (r.get("explanation") or "").strip()
            if r["status"] == "not_applicable" and r.get("na_reason"):
                rationale = f"{rationale} N/A: {r['na_reason']}".strip()
            criteria.append({"criterion_id": code, "value": _value(code, r),
                             "rationale": rationale or "—", "evidence_turns": _evidence(r)})
        fs = ev["final_score"]
        critical = next(c["value"] for c in criteria if c["criterion_id"] == "critical")
        results.append({"conversation_id": cid, "status": "ok", "criteria": criteria,
                        "score": {"final_score": fs["total"], "critical_flag": bool(critical)}})
    from .evaluator.llm_client import is_local
    mode = "local" if is_local() else ("external_api" if settings.evaluator_mode == "real" else "local")
    return {"schema_version": SCHEMA_VERSION, "team_name": team,
            "model": {"mode": mode, "name": ", ".join(sorted(models)) or (settings.llm_model or "unknown")},
            "results": results}


def check(doc: dict, expected_ids: Optional[set[str]] = None, expect_count: Optional[int] = None) -> list[str]:
    """Пустой список = файл соответствует формату."""
    errs: list[str] = []
    if doc.get("schema_version") != SCHEMA_VERSION:
        errs.append("schema_version должен быть \"1.0\"")
    if not str(doc.get("team_name") or "").strip():
        errs.append("пустой team_name")
    m = doc.get("model") or {}
    if m.get("mode") not in ("local", "external_api", "hybrid") or not str(m.get("name") or "").strip():
        errs.append("model.mode/name заполнены неверно")
    res = doc.get("results")
    if not isinstance(res, list):
        return errs + ["results не массив"]
    ids = [r.get("conversation_id") for r in res]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f"повторяющиеся conversation_id: {sorted(dup)[:5]}")
    if expected_ids is not None:
        miss, extra = expected_ids - set(ids), set(ids) - expected_ids
        if miss:
            errs.append(f"нет записей для {len(miss)} ID: {sorted(miss)[:5]}")
        if extra:
            errs.append(f"лишние ID: {sorted(extra)[:5]}")
    if expect_count is not None and len(res) != expect_count:
        errs.append(f"записей {len(res)}, ожидается {expect_count}")
    for r in res:
        cid = r.get("conversation_id")
        if r.get("status") == "error":
            if r.get("criteria") != [] or r.get("score") is not None or not r.get("error"):
                errs.append(f"{cid}: error-запись должна иметь criteria=[], score=null и причину")
            continue
        if r.get("status") != "ok":
            errs.append(f"{cid}: status должен быть ok или error")
            continue
        crit = r.get("criteria") or []
        codes = [c.get("criterion_id") for c in crit]
        if sorted(codes) != sorted(OFFICIAL):
            errs.append(f"{cid}: нужны все 8 критериев ровно по разу, есть {codes}")
            continue
        for c in crit:
            kind, allowed, _ = OFFICIAL[c["criterion_id"]]
            v = c.get("value")
            if isinstance(v, bool) and kind == "scale" or (kind == "bool" and v is not None and not isinstance(v, bool)):
                errs.append(f"{cid}/{c['criterion_id']}: неверный тип значения {v!r}")
            elif v not in allowed:
                errs.append(f"{cid}/{c['criterion_id']}: недопустимое значение {v!r}")
            if not isinstance(c.get("rationale"), str) or not c["rationale"].strip():
                errs.append(f"{cid}/{c['criterion_id']}: пустой rationale")
            ev = c.get("evidence_turns")
            if not isinstance(ev, list) or any(not isinstance(t, int) or isinstance(t, bool) or t < 1 for t in ev):
                errs.append(f"{cid}/{c['criterion_id']}: evidence_turns — список номеров с 1")
        sc = r.get("score") or {}
        crit_v = next(c["value"] for c in crit if c["criterion_id"] == "critical")
        if sc.get("critical_flag") is not crit_v:
            errs.append(f"{cid}: critical_flag должен совпадать с value критерия critical")
        fs = sc.get("final_score")
        want = official_score(crit)
        if fs is None or not isinstance(fs, (int, float)) or not (0 <= fs <= 100) or round(fs, 2) != fs:
            errs.append(f"{cid}: final_score должен быть числом 0..100 с 2 знаками")
        elif want is not None and abs(fs - want) > 0.005:
            errs.append(f"{cid}: final_score {fs} ≠ пересчёт {want}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group")
    ap.add_argument("--version-id", type=int, help="по умолчанию — последняя версия официального чек-листа")
    ap.add_argument("--out")
    ap.add_argument("--team", default=settings.team_name)
    ap.add_argument("--expect", type=int, help="ожидаемое число записей (prod = 10)")
    ap.add_argument("--check", help="только проверить готовый файл")
    args = ap.parse_args()

    if args.check:
        doc = json.loads(Path(args.check).read_text(encoding="utf-8"))
        errs = check(doc, expect_count=args.expect)
    else:
        storage.init_db()
        vid = args.version_id or next(v.version_id for v in storage.list_checklists() if v.checklist_id == "official")
        doc = build(args.group, vid, args.team)
        ids = {c["conversation_id"] for c in storage.list_conversations(group_id=args.group)}
        errs = check(doc, ids, args.expect)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        ok = sum(r["status"] == "ok" for r in doc["results"])
        print(f"{out}: записей {len(doc['results'])}, ok {ok}, error {len(doc['results']) - ok}; модель {doc['model']}")
    print("ПРОВЕРКА ФОРМАТА: OK" if not errs else "ОШИБКИ ФОРМАТА:\n- " + "\n- ".join(errs[:30]))
    return 0 if not errs else 1


if __name__ == "__main__":
    sys.exit(main())
