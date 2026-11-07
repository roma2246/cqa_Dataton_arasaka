"""Отрицательные проверки оценщика и импорта. Владельцы: Участники 2 и 4."""
import json
from pathlib import Path

import pytest

from cqa.evaluator.validation import validate
from cqa.importer import ImportError_, parse_response
from cqa.models import ChecklistDraft, CriterionResult

ROOT = Path(__file__).resolve().parents[2]
DATASET = json.loads((ROOT / "data/fixtures/sample_dataset.json").read_text(encoding="utf-8"))
CHECKLIST = ChecklistDraft.model_validate_json((ROOT / "data/fixtures/checklist_demo.json").read_text(encoding="utf-8"))


def conv():
    return parse_response(DATASET)[0]  # fx-ru-001: m001 бот, m004 оператор


def full(**over):
    base = {c.criterion_id: CriterionResult(criterion_id=c.criterion_id, status="applicable",
                                            answer="yes" if c.answer_type != "scale" else "4",
                                            explanation="", evidence_message_ids=["m004"])
            for c in CHECKLIST.criteria}
    base.update(over)
    return list(base.values())


def test_import_keeps_roles_and_ids():
    convs = parse_response(DATASET)
    assert [c.conversation_id for c in convs] == ["fx-ru-001", "fx-kz-001", "fx-call-001"]
    assert convs[0].messages[0].message_id == "m001" and convs[0].messages[0].speaker == "bot"
    assert convs[2].messages[0].timestamp.endswith("+05:00")


def test_import_bad_role():
    bad = json.loads(json.dumps(DATASET))
    bad["data"]["records"][0]["transcript"][0]["speaker"] = "robot"
    with pytest.raises(ImportError_):
        parse_response(bad)


def test_valid_passes():
    out, problems = validate(full(), CHECKLIST, conv())
    assert problems == [] and all(r.status == "applicable" for r in out)


def test_bot_greeting_not_credited_to_operator():
    res = full(demo_greeting=CriterionResult(criterion_id="demo_greeting", status="applicable", answer="yes",
                                             explanation="", evidence_message_ids=["m001"]))
    out, problems = validate(res, CHECKLIST, conv())
    assert next(r for r in out if r.criterion_id == "demo_greeting").status == "needs_review"


def test_unknown_message_id_rejected():
    res = full(demo_need=CriterionResult(criterion_id="demo_need", status="applicable", answer="yes",
                                         explanation="", evidence_message_ids=["m999"]))
    out, _ = validate(res, CHECKLIST, conv())
    assert next(r for r in out if r.criterion_id == "demo_need").status == "needs_review"


def test_missing_criterion_becomes_needs_review():
    out, problems = validate(full()[:-1], CHECKLIST, conv())
    assert out[-1].status == "needs_review" and problems


def test_na_forbidden():
    res = full(demo_greeting=CriterionResult(criterion_id="demo_greeting", status="not_applicable", explanation=""))
    out, _ = validate(res, CHECKLIST, conv())
    assert next(r for r in out if r.criterion_id == "demo_greeting").status == "needs_review"


def test_range_past_end_is_clamped_not_rejected():
    from cqa.models import CheckedRange
    res = full(demo_greeting=CriterionResult(criterion_id="demo_greeting", status="applicable", answer="no",
                                             explanation="", checked_range=CheckedRange(from_message_id="m001", to_message_id="m014")))
    out, problems = validate(res, CHECKLIST, conv())  # в диалоге 7 реплик
    g = next(r for r in out if r.criterion_id == "demo_greeting")
    assert g.status == "applicable" and g.checked_range.to_message_id == "m007"
    assert any("обрезан" in p for p in problems)


def test_garbage_range_rejected():
    from cqa.models import CheckedRange
    res = full(demo_greeting=CriterionResult(criterion_id="demo_greeting", status="applicable", answer="no",
                                             explanation="", checked_range=CheckedRange(from_message_id="m009", to_message_id="m002")))
    out, _ = validate(res, CHECKLIST, conv())
    assert next(r for r in out if r.criterion_id == "demo_greeting").status == "needs_review"
