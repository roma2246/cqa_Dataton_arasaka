"""Калькулятор итога. Владелец: Участник 4.

Чистая функция: (версия чек-листа, ответы по критериям) -> ScoreResult.
Модель НЕ считает итог; апелляции пересчитываются этой же функцией.

ВНИМАНИЕ: формула ниже - обобщённый плоский взвешенный вариант из исследования
(S = 100 * Σ w_i q_i / Σ w_i по применимым). Задача Q01/Q02 - сверить с официальным
PDF чек-листа: секции, нормализация шкал, грубые ошибки, этап и способ округления.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from .models import (
    ChecklistDraft,
    Criterion,
    CriterionResult,
    CriterionScore,
    ScoreResult,
    SectionScore,
)


def normalize_answer(criterion: Criterion, answer: Optional[str]) -> Optional[Decimal]:
    """Ответ -> q в диапазоне 0..1. None, если ответ недопустим."""
    if answer is None:
        return None
    if criterion.answer_type in ("yes_no", "single_choice"):
        for opt in criterion.options:
            if opt.value == answer:
                return Decimal(str(opt.score))
        return None
    if criterion.answer_type == "scale" and criterion.scale:
        s = criterion.scale
        if s.map is not None:
            return Decimal(str(s.map[answer])) if answer in s.map else None
        try:
            v = Decimal(answer)
        except Exception:
            return None
        if v < s.min or v > s.max or s.max == s.min:
            return None
        return (v - s.min) / Decimal(s.max - s.min)
    return None


def _round(value: Decimal, digits: int) -> float:
    q = Decimal(1).scaleb(-digits)
    return float(value.quantize(q, rounding=ROUND_HALF_UP))


def _weighted(items: list[tuple[Decimal, Decimal]]) -> Optional[Decimal]:
    """items: [(w, q)] только применимые. None, если знаменатель 0."""
    denom = sum((w for w, _ in items), Decimal(0))
    if denom == 0:
        return None
    return Decimal(100) * sum((w * q for w, q in items), Decimal(0)) / denom


def score(checklist: ChecklistDraft, results: list[CriterionResult]) -> ScoreResult:
    rules = checklist.rules
    by_id = {r.criterion_id: r for r in results}
    rows: list[CriterionScore] = []
    applicable: list[tuple[Criterion, Decimal]] = []
    incomplete: list[str] = []
    critical: list[str] = []

    for c in checklist.criteria:
        r = by_id.get(c.criterion_id)
        status = r.status if r else "needs_review"
        answer = r.answer if r else None
        q: Optional[Decimal] = None

        if status == "applicable":
            q = normalize_answer(c, answer)
            if q is None:
                status = "needs_review"
        elif status == "not_applicable" and not c.na_allowed:
            status = "needs_review"  # N/A запрещён для этого критерия

        if status == "applicable" and q is not None:
            applicable.append((c, q))
        elif status == "needs_review":
            incomplete.append(c.criterion_id)

        hit = c.is_critical and status == "applicable" and answer in c.critical_values
        if hit:
            critical.append(c.criterion_id)

        rows.append(CriterionScore(
            criterion_id=c.criterion_id, status=status, answer=answer,
            weight=c.weight, q=float(q) if q is not None else None,
            effective_weight=None, contribution=None, is_critical_hit=hit,
        ))

    # Эффективные веса и вклад (плоская схема)
    denom = sum((Decimal(str(c.weight)) for c, _ in applicable), Decimal(0))
    if denom > 0:
        app_ids = {c.criterion_id: q for c, q in applicable}
        for row in rows:
            if row.criterion_id in app_ids:
                w = Decimal(str(row.weight))
                row.effective_weight = _round(w / denom, 4)
                row.contribution = _round(Decimal(100) * w * app_ids[row.criterion_id] / denom, 4)

    # Секции
    sections: list[SectionScore] = []
    section_totals: dict[str, Optional[Decimal]] = {}
    for s in checklist.sections:
        items = [(Decimal(str(c.weight)), q) for c, q in applicable if c.section_id == s.section_id]
        t = _weighted(items)
        section_totals[s.section_id] = t
        sections.append(SectionScore(
            section_id=s.section_id,
            total=_round(t, rules.rounding_digits) if t is not None else None,
        ))

    # Итог
    total: Optional[Decimal]
    reason: Optional[str] = None
    if rules.aggregation == "weighted_sections" and checklist.sections:
        items = [
            (Decimal(str(s.weight or 0)), section_totals[s.section_id] / 100)
            for s in checklist.sections if section_totals.get(s.section_id) is not None
        ]
        total = _weighted(items)
    else:
        total = _weighted([(Decimal(str(c.weight)), q) for c, q in applicable])

    if incomplete:
        total, reason = None, "Нужна проверка: " + ", ".join(incomplete)
    elif total is None:
        reason = "Нет применимых критериев"

    if critical and rules.critical_policy == "zero_total":
        total = Decimal(0)

    return ScoreResult(
        total=_round(total, rules.rounding_digits) if total is not None else None,
        incomplete_reason=reason,
        critical_error=bool(critical),
        critical_criteria=critical,
        criteria=rows,
        sections=sections,
    )
