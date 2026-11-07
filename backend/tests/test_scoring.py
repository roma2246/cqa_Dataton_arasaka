"""Тесты калькулятора. Владелец: Участник 4.
Пример из исследования (раздел 11): A=10/q1, B=20/q0.75, C=30/q0.5, D=40/N/A -> 66.67; после апелляции C=1 -> 91.67.
"""
from cqa.models import ChecklistDraft, CriterionResult
from cqa.scoring import score


def _opt(*pairs):
    return [{"value": v, "label": v, "score": s} for v, s in pairs]


def make_checklist(**rules):
    choice = _opt(("full", 1), ("most", 0.75), ("half", 0.5), ("none", 0))
    return ChecklistDraft.model_validate({
        "name": "test", "rules": rules,
        "criteria": [
            {"criterion_id": k, "title": k, "instruction": "", "weight": w,
             "answer_type": "single_choice", "options": choice, "na_allowed": True,
             "is_critical": k == "A", "critical_values": ["none"]}
            for k, w in (("A", 10), ("B", 20), ("C", 30), ("D", 40))
        ],
    })


def r(cid, status="applicable", answer=None):
    return CriterionResult(criterion_id=cid, status=status, answer=answer, explanation="")


def test_na_redistributes_weight():
    s = score(make_checklist(), [r("A", answer="full"), r("B", answer="most"),
                                 r("C", answer="half"), r("D", "not_applicable")])
    assert s.total == 66.67


def test_appeal_changes_total():
    s = score(make_checklist(), [r("A", answer="full"), r("B", answer="most"),
                                 r("C", answer="full"), r("D", "not_applicable")])
    assert s.total == 91.67


def test_all_na_is_null_not_zero():
    s = score(make_checklist(), [r(k, "not_applicable") for k in "ABCD"])
    assert s.total is None
    assert s.incomplete_reason == "Нет применимых критериев"


def test_needs_review_makes_total_null():
    s = score(make_checklist(), [r("A", answer="full"), r("B", "needs_review"),
                                 r("C", answer="half"), r("D", answer="full")])
    assert s.total is None and "B" in s.incomplete_reason


def test_missing_result_is_incomplete():
    s = score(make_checklist(), [r("A", answer="full")])
    assert s.total is None


def test_critical_flag_only():
    s = score(make_checklist(), [r("A", answer="none"), r("B", answer="full"),
                                 r("C", answer="full"), r("D", answer="full")])
    assert s.critical_error and s.critical_criteria == ["A"] and s.total == 90.0


def test_critical_zero_total():
    s = score(make_checklist(critical_policy="zero_total"),
              [r("A", answer="none"), r("B", answer="full"), r("C", answer="full"), r("D", answer="full")])
    assert s.total == 0.0


def test_scale_normalization():
    c = ChecklistDraft.model_validate({"name": "t", "criteria": [
        {"criterion_id": "S", "title": "S", "instruction": "", "weight": 1, "answer_type": "scale",
         "scale": {"min": 1, "max": 5}}]})
    assert score(c, [r("S", answer="4")]).total == 75.0
    assert score(c, [r("S", answer="9")]).total is None  # вне шкалы -> needs_review
