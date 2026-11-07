"""Реальный путь оценщика без сети: подменяем chat_json. Владелец: Участник 2."""
import json
from pathlib import Path

import pytest

from cqa.config import settings
from cqa.evaluator import llm_client, prompt_builder, service
from cqa.importer import parse_response
from cqa.models import ChecklistDraft

ROOT = Path(__file__).resolve().parents[2]
CONV = parse_response(json.loads((ROOT / "data/fixtures/sample_dataset.json").read_text(encoding="utf-8")))[0]
CHK = ChecklistDraft.model_validate_json((ROOT / "data/fixtures/checklist_demo.json").read_text(encoding="utf-8"))

GOOD = {"results": [
    {"criterion_id": "demo_greeting", "status": "applicable", "answer": "yes", "explanation": "m004",
     "evidence_message_ids": ["m004"], "checked_range": None, "na_reason": None, "review_reason": None},
    {"criterion_id": "demo_need", "status": "applicable", "answer": "yes", "explanation": "",
     "evidence_message_ids": ["m004"], "checked_range": None, "na_reason": None, "review_reason": None},
    {"criterion_id": "demo_politeness", "status": "applicable", "answer": "5", "explanation": "",
     "evidence_message_ids": ["m004", "m006"], "checked_range": None, "na_reason": None, "review_reason": None},
    {"criterion_id": "demo_next_step", "status": "applicable", "answer": "yes", "explanation": "",
     "evidence_message_ids": ["m006"], "checked_range": None, "na_reason": None, "review_reason": None},
]}


def call(tokens=(1000, 500)):
    return llm_client.CallRecord(True, 0.1, "claude-opus-5-5", *tokens)


def test_schema_built_from_checklist():
    s = prompt_builder.output_schema(CHK)
    ids = s["properties"]["results"]["items"]["properties"]["criterion_id"]["enum"]
    assert ids == [c.criterion_id for c in CHK.criteria]


def test_retry_once_on_bad_json_and_cost_counts_both(monkeypatch):
    answers = iter(["не json", json.dumps(GOOD)])
    monkeypatch.setattr(llm_client, "chat_json", lambda s, u, sch: llm_client.LLMResponse(next(answers), [call()]))
    monkeypatch.setattr(settings, "llm_price_input_per_m", 0.0)
    monkeypatch.setattr(settings, "llm_price_output_per_m", 0.0)
    out = service._real(CONV, CHK)
    assert len(out.calls) == 2
    # 2 × (1000×4 + 500×20)/1e6 = 0.028
    assert out.cost_usd == pytest.approx(0.028)
    assert all(r.status == "applicable" for r in out.results)


def test_fails_after_two_bad_answers(monkeypatch):
    monkeypatch.setattr(llm_client, "chat_json", lambda s, u, sch: llm_client.LLMResponse("{}", [call()]))
    with pytest.raises(llm_client.LLMError) as e:
        service._real(CONV, CHK)
    assert len(e.value.calls) == 2


def test_unknown_usage_is_not_zero_cost():
    assert llm_client.cost_usd([llm_client.CallRecord(True, 0.1, "claude-opus-5-5", None, None)]) is None


def test_compact_answer_is_expanded():
    from cqa.evaluator import prompt_builder
    raw = {"results": [{"criterion_id": "demo_next_step", "status": "not_applicable", "answer": None,
                        "explanation": "Вопрос решён", "evidence_message_ids": [], "checked_range": "m001-m007"}]}
    r = prompt_builder.expand_compact(raw)["results"][0]
    assert r["checked_range"] == {"from_message_id": "m001", "to_message_id": "m007"}
    assert r["na_reason"] == "Вопрос решён" and r["review_reason"] is None


def test_ultra_answer_is_expanded():
    from cqa.evaluator import prompt_builder
    raw = {"results": [
        {"id": "a1", "a": "yes", "e": ["m004"], "r": None, "x": "Поздоровался"},
        {"id": "a2", "a": "NA", "e": [], "r": None, "x": "Общий вопрос"},
        {"id": "a3", "a": "?", "e": [], "r": "m001-m007", "x": "Неясно"}]}
    out = prompt_builder.expand_ultra(raw)["results"]
    assert (out[0]["status"], out[0]["answer"], out[0]["evidence_message_ids"]) == ("applicable", "yes", ["m004"])
    assert (out[1]["status"], out[1]["answer"], out[1]["na_reason"]) == ("not_applicable", None, "Общий вопрос")
    assert out[2]["status"] == "needs_review" and out[2]["checked_range"] == {"from_message_id": "m001", "to_message_id": "m007"}


def test_needs_review_gets_one_followup(monkeypatch):
    from cqa.config import settings as st
    first = json.loads(json.dumps(GOOD))
    first["results"][3].update(status="needs_review", answer=None, evidence_message_ids=[], review_reason="Неясно")
    second = {"results": [dict(GOOD["results"][3])]}
    answers = iter([json.dumps(first), json.dumps(second)])
    seen = []

    def fake(s, u, sch):
        seen.append(u)
        return llm_client.LLMResponse(next(answers), [call()])
    monkeypatch.setattr(llm_client, "chat_json", fake)
    monkeypatch.setattr(st, "followup", True)
    monkeypatch.setattr(prompt_builder, "PROMPT_VERSION", "evaluate_v2")
    out = service._real(CONV, CHK)
    assert len(seen) == 2 and "demo_next_step: Неясно" in seen[1]
    assert next(r for r in out.results if r.criterion_id == "demo_next_step").status == "applicable"
    assert any("уточнено" in p for p in out.problems) and len(out.calls) == 2


def test_facts_block_points_to_first_operator_reply():
    f = prompt_builder.facts_block(CONV)  # fx-ru-001: оператор впервые в m004, после system m003 [00:38]
    assert "m004" in f and "37 с" in f and "Все реплики оператора: m004, m006" in f
