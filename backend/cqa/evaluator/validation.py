"""Проверка ответа модели. Владелец: Участник 2.

Проверяем: точное множество criterion_id, дубли, допустимые ответы/статусы,
существование message_id, корректность диапазона и АВТОРСТВО:
действие оператора нельзя подтвердить только репликами бота/клиента/системы.
"""
from __future__ import annotations

import re

from ..models import CheckedRange, ChecklistDraft, Conversation, CriterionResult

_MID = re.compile(r"^m(\d{3,})$")


def _clamp_range(a: str, b: str, conv: Conversation) -> tuple[str, str] | None:
    """Диапазон, выходящий за края диалога, обрезается (это «смотрел до конца»), а не отклоняется.
    None — если ID не в формате mNNN или начало позже конца."""
    ma, mb = _MID.match(a or ""), _MID.match(b or "")
    if not (ma and mb):
        return None
    n = len(conv.messages)
    ia, ib = int(ma.group(1)), int(mb.group(1))
    if ia > ib or ia > n:
        return None
    ia, ib = max(ia, 1), min(ib, n)
    return conv.messages[ia - 1].message_id, conv.messages[ib - 1].message_id


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
        if r.status == "not_applicable" and not c.na_allowed and any(o.value == "no" for o in c.options):
            # Официально «Нет» = действие было нужно, но его нет. N/A там, где N/A не бывает, означает
            # «действия не было» -> «Нет»; просмотренный диапазон — весь разговор. Фиксируем в замечаниях.
            problems.append(f"{cid}: N/A недопустим — засчитано как «Нет»")
            r = r.model_copy(update={
                "status": "applicable", "answer": "no", "na_reason": None,
                "checked_range": r.checked_range or CheckedRange(from_message_id=conv.messages[0].message_id,
                                                                 to_message_id=conv.messages[-1].message_id)})
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
                fixed = _clamp_range(r.checked_range.from_message_id, r.checked_range.to_message_id, conv)
                if fixed is None:
                    issue = "некорректный checked_range"
                elif fixed != (r.checked_range.from_message_id, r.checked_range.to_message_id):
                    problems.append(f"{cid}: checked_range обрезан до границ диалога {fixed[0]}–{fixed[1]}")
                    r = r.model_copy(update={"checked_range": CheckedRange(from_message_id=fixed[0], to_message_id=fixed[1])})
            positive_claim = c.answer_type != "scale" and any(o.value == r.answer and o.score > 0 for o in c.options) \
                and not c.is_critical
            if not issue and not r.evidence_message_ids and not r.checked_range and positive_claim:
                issue = "утверждение о действии оператора без ссылки на реплику"
            elif not issue and not r.evidence_message_ids and not r.checked_range:
                # «действия нет» без ссылок — считаем, что просмотрен весь разговор (а не отправляем на проверку)
                problems.append(f"{cid}: нет ссылок — подставлен диапазон всего разговора")
                r = r.model_copy(update={"checked_range": CheckedRange(
                    from_message_id=conv.messages[0].message_id, to_message_id=conv.messages[-1].message_id)})
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
