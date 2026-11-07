"""Калибровка на решениях проверяющего («дообучение» через прецеденты). Владелец: Участник 2."""
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cqa import storage
from cqa.config import settings
from cqa.evaluator import llm_client, service
from cqa.models import ChecklistDraft

ROOT = Path(__file__).resolve().parents[2]
DATASET = json.loads((ROOT / "data/fixtures/sample_dataset.json").read_text(encoding="utf-8"))


@pytest.fixture()
def client():
    from cqa.main import app
    with TestClient(app) as c:
        yield c


def wait(c, eid):
    for _ in range(100):
        ev = c.get(f"/api/evaluations/{eid}").json()
        if ev["status"] in ("completed", "failed"):
            return ev
        time.sleep(0.05)
    raise AssertionError


def appeal_change(c, conv="fx-ru-001", crit="demo_next_step", answer="no"):
    c.post("/api/import/json", json=DATASET)
    eid = c.post("/api/evaluations", json={"conversation_id": conv, "checklist_version_id": 1}).json()["evaluation_id"]
    wait(c, eid)
    ap = c.post(f"/api/evaluations/{eid}/appeals", json={"criterion_id": crit, "comment": "не согласен"}).json()
    return c.post(f"/api/appeals/{ap['appeal_id']}/decision", json={
        "action": "change", "reason": "Срок не назван — это «нет», а не N/A", "expected_revision": 0,
        "new_status": "applicable", "new_answer": answer}).json()


def test_change_decision_creates_example(client):
    r = appeal_change(client)
    assert r["calibration_example_id"]
    ex = client.get("/api/calibration").json()["examples"]
    assert len(ex) == 1 and ex[0]["criterion_id"] == "demo_next_step"
    assert ex[0]["ai_status"] == "not_applicable" and ex[0]["correct_answer"] == "no"
    assert any(m["speaker"] == "operator" for m in ex[0]["excerpt"])


def test_confirm_creates_no_example(client):
    client.post("/api/import/json", json=DATASET)
    eid = client.post("/api/evaluations", json={"conversation_id": "fx-ru-001", "checklist_version_id": 1}).json()["evaluation_id"]
    wait(client, eid)
    ap = client.post(f"/api/evaluations/{eid}/appeals", json={"criterion_id": "demo_need", "comment": "?"}).json()
    r = client.post(f"/api/appeals/{ap['appeal_id']}/decision",
                    json={"action": "confirm", "reason": "ИИ прав", "expected_revision": 0}).json()
    assert r["calibration_example_id"] is None


def _fps(chk):
    return {c.criterion_id: storage.criterion_fingerprint(c) for c in chk.criteria}


def test_selection_rules(client):
    appeal_change(client)
    chk = ChecklistDraft.model_validate(client.get("/api/checklists/1").json())
    assert storage.calibration_for(_fps(chk), "fx-ru-001") == []          # не из того же диалога
    assert len(storage.calibration_for(_fps(chk), "fx-kz-001")) == 1      # другой диалог — да
    chk.criteria[3].instruction += " Изменено."                          # формулировка изменилась
    assert storage.calibration_for(_fps(chk), "fx-kz-001") == []
    ex_id = storage.list_calibration()[0]["example_id"]
    client.patch(f"/api/calibration/{ex_id}", json={"active": False})
    chk = ChecklistDraft.model_validate(client.get("/api/checklists/1").json())
    assert storage.calibration_for(_fps(chk), "fx-kz-001") == []          # выключенный пример не используется


def test_examples_reach_prompt_and_version(client, monkeypatch):
    appeal_change(client)
    seen = {}

    def fake(system, user, schema):
        seen["user"] = user
        res = [{"criterion_id": c, "status": "needs_review", "answer": None, "explanation": "", "evidence_message_ids": [],
                "checked_range": None, "na_reason": None, "review_reason": "x"}
               for c in ("demo_greeting", "demo_need", "demo_politeness", "demo_next_step")]
        return llm_client.LLMResponse(json.dumps({"results": res}), [llm_client.CallRecord(True, 0.1, "m", 1, 1)])

    monkeypatch.setattr(llm_client, "chat_json", fake)
    chk = ChecklistDraft.model_validate(client.get("/api/checklists/1").json())
    conv = storage.get_conversation("fx-kz-001")
    out = service._real(conv, chk)
    assert "<calibration>" in seen["user"] and "Срок не назван" in seen["user"]
    assert out.prompt_version.endswith("+cal1")
    assert "fx-ru-001" not in seen["user"]  # ID других диалогов в промпт не попадают

    monkeypatch.setattr(settings, "calibration", False)
    out = service._real(conv, chk)
    assert "<calibration>" not in seen["user"] and "+cal" not in out.prompt_version
