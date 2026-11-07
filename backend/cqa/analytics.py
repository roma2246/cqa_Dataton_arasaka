"""Аналитика качества по набору и ИИ-аналитик. Владелец: Участник 4.

Считается по ПОСЛЕДНЕЙ завершённой оценке каждого диалога выбранной версией чек-листа
(финальные результаты — с учётом решений проверяющего).
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Optional

from . import storage


def _latest_completed(group_id: Optional[str], version_id: int) -> list[dict]:
    """Один запрос: последняя завершённая оценка каждого диалога данной версией чек-листа."""
    q = """SELECT c.conversation_id, c.language, c.channel, e.final_results_json, e.final_score_json, e.usage_json
           FROM conversations c JOIN evaluations e ON e.evaluation_id = (
               SELECT MAX(e2.evaluation_id) FROM evaluations e2 WHERE e2.conversation_id=c.conversation_id
               AND e2.checklist_version_id=? AND e2.status='completed')"""
    args: list[Any] = [version_id]
    if group_id:
        q += " WHERE c.group_id=?"
        args.append(group_id)
    with storage.tx() as db:
        rows = [dict(r) for r in db.execute(q, args).fetchall()]
    for r in rows:
        for k in ("final_results_json", "final_score_json", "usage_json"):
            r[k.removesuffix("_json")] = json.loads(r.pop(k)) if r.get(k) else None
    return rows


def summary(group_id: Optional[str], version_id: int) -> dict[str, Any]:
    chk = storage.get_checklist(version_id)
    evs = _latest_completed(group_id, version_id)
    crit = {c.criterion_id: c for c in chk.criteria}
    per = {k: {"title": c.title, "weight": c.weight, "n": 0, "na": 0, "review": 0, "q_sum": 0.0, "fails": 0}
           for k, c in crit.items()}
    by_lang, by_chan = defaultdict(list), defaultdict(list)
    critical, totals, worst = [], [], []
    agree_sum, agree_n = 0.0, 0
    for ev in evs:
        fs = ev["final_score"]
        if fs["total"] is not None:
            totals.append(fs["total"])
            by_lang[ev["language"]].append(fs["total"])
            by_chan[ev["channel"]].append(fs["total"])
            worst.append((fs["total"], ev["conversation_id"]))
        if fs["critical_error"]:
            r = next((x for x in ev["final_results"] if crit.get(x["criterion_id"]) and crit[x["criterion_id"]].is_critical), None)
            critical.append({"conversation_id": ev["conversation_id"], "language": ev["language"],
                             "reason": (r or {}).get("explanation", "")})
        for s in fs["criteria"]:
            p = per.get(s["criterion_id"])
            if not p:
                continue
            if s["status"] == "not_applicable":
                p["na"] += 1
            elif s["status"] == "needs_review":
                p["review"] += 1
            elif s["q"] is not None:
                p["n"] += 1
                q = s["q"]
                if crit[s["criterion_id"]].is_critical:   # для флага «успех» = нарушения нет
                    q = 0.0 if s["is_critical_hit"] else 1.0
                p["q_sum"] += q
                p["fails"] += q < 1
        for v in ((ev.get("usage") or {}).get("agreement") or {}).values():
            agree_sum, agree_n = agree_sum + v, agree_n + 1
    avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None  # noqa: E731
    criteria = []
    for k, p in per.items():
        criteria.append({"criterion_id": k, "title": p["title"], "weight": p["weight"], "applicable": p["n"],
                         "na": p["na"], "needs_review": p["review"], "fails": p["fails"],
                         "score_pct": round(100 * p["q_sum"] / p["n"], 1) if p["n"] else None})
    return {
        "group_id": group_id, "checklist": f"v{chk.version} · {chk.name}", "evaluated": len(evs),
        "avg_total": avg(totals), "critical_count": len(critical), "critical": critical,
        "criteria": criteria,
        "by_language": {k: {"n": len(v), "avg": avg(v)} for k, v in sorted(by_lang.items())},
        "by_channel": {k: {"n": len(v), "avg": avg(v)} for k, v in sorted(by_chan.items())},
        "worst": [{"conversation_id": c, "total": t} for t, c in sorted(worst)[:6]],
        "agreement_avg": round(agree_sum / agree_n, 3) if agree_n else None,
    }


ASK_SCHEMA = {
    "type": "object",
    "properties": {
        "insights": {"type": "array", "items": {"type": "string"}},
        "recommendations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["insights", "recommendations"], "additionalProperties": False,
}


def ask(stats: dict, question: str) -> dict:
    """ИИ-аналитик: получает ТОЛЬКО агрегаты (без текстов переписок)."""
    from .evaluator import llm_client
    system = ("Ты — аналитик качества контакт-центра брокера. По агрегированной статистике оценок операторов "
              "по чек-листу дай 3–5 выводов (что проседает, где, насколько) и 3–5 конкретных рекомендаций "
              "для обучения операторов или изменения процессов. Опирайся только на цифры. Пиши по-русски, "
              "каждый пункт — одно-два предложения. Ответ — JSON {\"insights\": [...], \"recommendations\": [...]}.")
    payload = {k: v for k, v in stats.items() if k != "critical"}
    payload["critical_examples"] = [c["reason"][:160] for c in stats["critical"][:6]]
    user = f"Вопрос руководителя: {question or 'Где проседает качество и что изменить?'}\n\nСтатистика:\n" + \
        json.dumps(payload, ensure_ascii=False)
    resp = llm_client.chat_json(system, user, ASK_SCHEMA)
    data = json.loads(resp.text)
    data["model"] = ", ".join(sorted({c.model for c in resp.calls if c.model}))
    return data
