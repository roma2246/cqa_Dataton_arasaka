"""Сквозной сценарий через HTTP API (mock-оценщик, временная БД). Владельцы: Участники 1 и 4."""
import copy
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cqa.config import settings

ROOT = Path(__file__).resolve().parents[2]
DATASET = json.loads((ROOT / "data/fixtures/sample_dataset.json").read_text(encoding="utf-8"))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", tmp_path / "t.sqlite3")
    monkeypatch.setattr(settings, "evaluator_mode", "mock")
    from cqa.main import app
    with TestClient(app) as c:
        yield c


def wait_eval(c, eid):
    for _ in range(100):
        ev = c.get(f"/api/evaluations/{eid}").json()
        if ev["status"] in ("completed", "failed", "canceled"):
            return ev
        time.sleep(0.05)
    raise AssertionError("оценка не завершилась")


def crit(ev, cid, key="final_score"):
    return next(x for x in ev[key]["criteria"] if x["criterion_id"] == cid)


def test_full_flow(client):
    c = client
    assert c.post("/api/import/json", json=DATASET).json()["new"] == 3
    assert c.post("/api/import/json", json=DATASET).json()["unchanged"] == 3  # без дублей

    eid = c.post("/api/evaluations", json={"conversation_id": "fx-ru-001", "checklist_version_id": 1}).json()["evaluation_id"]
    ev = wait_eval(c, eid)
    assert ev["status"] == "completed" and ev["mode"] == "mock"
    assert crit(ev, "demo_next_step")["status"] == "not_applicable"
    assert ev["final_score"]["total"] == 91.67  # (10 + 30 + 0.75·20) / 60

    # Апелляция: N/A -> применим, "нет". Знаменатель растёт до 100.
    ap = c.post(f"/api/evaluations/{eid}/appeals", json={"criterion_id": "demo_next_step", "comment": "шаг не назван"}).json()
    r = c.post(f"/api/appeals/{ap['appeal_id']}/decision", json={
        "action": "change", "reason": "Следующий шаг не озвучен", "expected_revision": 0,
        "new_status": "applicable", "new_answer": "no"})
    assert r.status_code == 200 and r.json()["final_score"]["total"] == 55.0

    # Повторное решение и решение по устаревшей revision отклоняются
    assert c.post(f"/api/appeals/{ap['appeal_id']}/decision",
                  json={"action": "confirm", "reason": "x", "expected_revision": 1}).status_code == 409
    ap2 = c.post(f"/api/evaluations/{eid}/appeals", json={"criterion_id": "demo_need", "comment": "?"}).json()
    assert c.post(f"/api/appeals/{ap2['appeal_id']}/decision",
                  json={"action": "confirm", "reason": "x", "expected_revision": 0}).status_code == 409

    ev = c.get(f"/api/evaluations/{eid}").json()
    assert ev["ai_score"]["total"] == 91.67          # исходник ИИ сохранён
    assert crit(ev, "demo_next_step", "ai_score")["status"] == "not_applicable"
    assert ev["final_score"]["total"] == 55.0 and ev["revision"] == 1
    a = next(x for x in ev["appeals"] if x["appeal_id"] == ap["appeal_id"])
    assert a["status"] == "changed" and a["old_status"] == "not_applicable" and a["decision_reason"]

    # Новая версия чек-листа с новым критерием — без правки кода
    chk = c.get("/api/checklists/1").json()
    chk["criteria"].append({"criterion_id": "custom_next", "title": "Передал следующий шаг", "instruction": "...",
                            "weight": 15, "answer_type": "single_choice",
                            "options": [{"value": "yes", "label": "Да", "score": 1},
                                        {"value": "partial", "label": "Частично", "score": 0.5},
                                        {"value": "no", "label": "Нет", "score": 0}]})
    v2 = c.post("/api/checklists", json=chk).json()
    assert v2["version"] == 2
    eid2 = c.post("/api/evaluations", json={"conversation_id": "fx-kz-001", "checklist_version_id": v2["version_id"]}).json()["evaluation_id"]
    ev2 = wait_eval(c, eid2)
    assert "custom_next" in {x["criterion_id"] for x in ev2["final_score"]["criteria"]}
    assert len(c.get(f"/api/evaluations/{eid}").json()["ai_results"]) == 4  # старая оценка не тронута


def test_changed_text_same_id_updates_and_keeps_old_hash(client):
    c = client
    c.post("/api/import/json", json=DATASET)
    eid = c.post("/api/evaluations", json={"conversation_id": "fx-ru-001", "checklist_version_id": 1}).json()["evaluation_id"]
    old_hash = wait_eval(c, eid)["content_hash"]
    changed = copy.deepcopy(DATASET)
    changed["data"]["records"][0]["transcript"][3]["text"] = "Изменённый текст"
    assert c.post("/api/import/json", json=changed).json()["updated"] == 1
    conv = c.get("/api/conversations/fx-ru-001").json()
    assert conv["content_hash"] != old_hash
    assert c.get(f"/api/evaluations/{eid}").json()["content_hash"] == old_hash


def test_checklist_validation(client):
    bad = {"name": "x", "criteria": [
        {"criterion_id": "a", "title": "a", "instruction": "", "weight": 1, "answer_type": "yes_no", "options": []}]}
    assert client.post("/api/checklists", json=bad).status_code == 422
