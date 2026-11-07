"""Проверка ответа модели. Владелец: Участник 2.

Проверяем: точное множество criterion_id, дубли, допустимые ответы/статусы,
существование message_id, корректность диапазона и АВТОРСТВО:
действие оператора нельзя подтвердить только репликами бота/клиента/системы.
"""
from __future__ import annotations

from ..models import ChecklistDraft, Conversation, CriterionResult


def validate(results: list[CriterionResult], checklist: ChecklistDraft,
             conv: Conversation) -> tuple[list[CriterionResult], list[str]]:
    """Возвращает (исправленные результаты, список проблем).

    Невалидный критерий не выкидывается, а переводится в needs_review с причиной -
    чтобы ошибка была видна, а не превращена в ноль или N/A.
    """
    problems: list[str] = []
    msgs = {m.message_id: m for m in conv.messages}
    order = {m.message_id: m.index for m in conv.messages}
    crit = {c.criterion_id: c for c in checklist.criteria}

    seen: dict[str, CriterionResult] = {}
    for r in results:
        if r.criterion_id not in crit:
            problems.append(f"Лишний criterion_id {r.criterion_id}")
            continue
        if r.criterion_id in seen:
            problems.append(f"Дубликат {r.criterion_id}")
            continue
        seen[r.criterion_id] = r

    out: list[CriterionResult] = []
    for cid, c in crit.items():
        r = seen.get(cid)
        if r is None:
            problems.append(f"Нет ответа по {cid}")
            out.append(CriterionResult(criterion_id=cid, status="needs_review",
                                       explanation="Модель не вернула ответ по критерию",
                                       review_reason="missing"))
            continue

        issue = None
        bad_ids = [i for i in r.evidence_message_ids if i not in msgs]
        if bad_ids:
            issue = f"несуществующие message_id {bad_ids}"
        elif r.status == "not_applicable" and not c.na_allowed:
            issue = "N/A запрещён для критерия"
        elif r.status == "applicable":
            if c.answer_type in ("yes_no", "single_choice") and r.answer not in {o.value for o in c.options}:
                issue = f"недопустимый ответ '{r.answer}'"
            elif c.answer_type == "scale" and c.scale:
                try:
                    v = float(r.answer)  # type: ignore[arg-type]
                    if not (c.scale.min <= v <= c.scale.max):
                        issue = f"ответ {v} вне шкалы"
                except (TypeError, ValueError):
                    issue = f"ответ '{r.answer}' не число"
            if not issue and r.checked_range:
                a, b = r.checked_range.from_message_id, r.checked_range.to_message_id
                if a not in order or b not in order or order[a] > order[b]:
                    issue = "некорректный checked_range"
            if not issue and not r.evidence_message_ids and not r.checked_range:
                issue = "нет ни доказательства, ни проверенного диапазона"
            # Авторство: если есть доказательства, хотя бы одно должно быть от оператора.
            # TODO(A03): уточнить - для каких ответов (положительный/отрицательный) это обязательно.
            if not issue and r.evidence_message_ids:
                speakers = {msgs[i].speaker for i in r.evidence_message_ids}
                positive = c.options and any(o.value == r.answer and o.score > 0 for o in c.options)
                if positive and "operator" not in speakers:
                    issue = "положительная оценка подтверждена только репликами не оператора"

        if issue:
            problems.append(f"{cid}: {issue}")
            r = r.model_copy(update={"status": "needs_review", "review_reason": issue})
        out.append(r)
    return out, problems
