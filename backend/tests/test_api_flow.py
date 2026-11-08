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


def test_quota_stops_batch_queue(client, monkeypatch):
    from cqa import main
    from cqa.evaluator import llm_client

    def boom(conv, chk):
        raise llm_client.QuotaExceeded("Исчерпана квота")
    monkeypatch.setattr(main, "evaluate", boom)
    monkeypatch.setattr(main.executor, "submit", lambda fn, *a: None)  # выполняем вручную, по порядку
    c = client
    c.post("/api/import/json", json=DATASET)
    b = c.post("/api/evaluations/batch", json={"checklist_version_id": 1, "group_id": "FIXTURE"}).json()
    main._run_evaluation(b["evaluation_ids"][0])
    for eid in b["evaluation_ids"][1:]:
        main._run_evaluation(eid)  # отменённые не выполняются
    st = c.get(f"/api/batches/{b['batch_id']}").json()
    assert st["counts"] == {"failed": 1, "canceled": 2}
    assert all("квота" in (i["error"] or "") for i in st["items"])
    r = c.post(f"/api/batches/{b['batch_id']}/retry").json()
    assert r["retried"] == 3


def test_basic_auth_when_enabled(monkeypatch, tmp_path):
    import base64
    from cqa import main
    monkeypatch.setattr(main, "_AUTH_USER", "team")
    monkeypatch.setattr(main, "_AUTH_PASS", "s3cret")
    with TestClient(main.app) as c:
        assert c.get("/api/health").status_code == 200                       # проверка живости открыта
        assert c.get("/api/conversations").status_code == 401
        ok = {"Authorization": "Basic " + base64.b64encode(b"team:s3cret").decode()}
        assert c.get("/api/conversations", headers=ok).status_code == 200
        bad = {"Authorization": "Basic " + base64.b64encode(b"team:nope").decode()}
        assert c.get("/api/conversations", headers=bad).status_code == 401


def test_serverless_mode_runs_inline_and_by_work(client, monkeypatch):
    from cqa.config import settings
    monkeypatch.setattr(settings, "serverless", True)
    c = client
    c.post("/api/import/json", json=DATASET)
    assert c.get("/api/health").json()["serverless"] is True
    r = c.post("/api/evaluations", json={"conversation_id": "fx-ru-001", "checklist_version_id": 1}).json()
    assert r["status"] == "completed"                                   # одна оценка — сразу в запросе
    b = c.post("/api/evaluations/batch", json={"checklist_version_id": 1, "group_id": "FIXTURE"}).json()
    assert c.get(f"/api/batches/{b['batch_id']}").json()["counts"] == {"queued": 3}   # без фоновых потоков
    w = c.post("/api/work").json()
    assert w["processed"] == 3 and w["remaining"] == 0
    assert c.get(f"/api/batches/{b['batch_id']}").json()["counts"] == {"completed": 3}


def test_stale_running_is_reclaimed(client):
    from cqa import storage
    c = client
    c.post("/api/import/json", json=DATASET)
    conv = storage.get_conversation("fx-ru-001")
    eid = storage.create_evaluation("fx-ru-001", conv.content_hash, 1)
    storage.update_evaluation(eid, status="running", started_at="2000-01-01T00:00:00+00:00")
    assert storage.reclaim_stale(300) == 1 and storage.get_evaluation(eid)["status"] == "queued"


def test_analytics_summary(client):
    from cqa import pipeline
    c = client
    c.post("/api/import/json", json=DATASET)
    vid = pipeline.official_version()
    for cid in ("fx-ru-001", "fx-kz-001"):
        eid = c.post("/api/evaluations", json={"conversation_id": cid, "checklist_version_id": vid}).json()["evaluation_id"]
        wait_eval(c, eid)
    a = c.get("/api/analytics", params={"group_id": "FIXTURE"}).json()
    assert a["evaluated"] == 2 and len(a["criteria"]) == 8
    assert set(a["by_language"]) == {"RU", "KZ"} and a["avg_total"] is not None
    assert c.post("/api/analytics/ask", json={"group_id": "FIXTURE"}).status_code == 409   # mock — без ИИ


def test_public_pages_open_with_auth(client, monkeypatch):
    from cqa import main
    monkeypatch.setattr(main, "_AUTH_USER", "u")
    monkeypatch.setattr(main, "_AUTH_PASS", "p")
    assert client.get("/").status_code == 200 and "Arasaka" in client.get("/").text
    assert client.get("/api/public/stats").status_code == 200
    for asset in ("/ui/landing.css", "/ui/landing.js", "/ui/vendor/gsap.min.js", "/ui/img/freedom-logo.png"):
        assert client.get(asset).status_code == 200, asset
    assert client.get("/api/conversations").status_code == 401
    assert client.get("/api/conversations", auth=("u", "p")).status_code == 200


def test_rate_limit_on_llm_endpoints(client, monkeypatch):
    from cqa import main
    monkeypatch.setitem(main._RATE, ("POST", "/api/analytics/ask"), 2)
    main._HITS.clear()
    codes = [client.post("/api/analytics/ask", json={"group_id": "FIXTURE"}).status_code for _ in range(3)]
    assert codes[:2] != [429, 429] and codes[2] == 429


def test_assistant_handoff_and_rating(client):
    r = client.post("/api/assist", json={"messages": [{"role": "client", "text": "Почему ограничен вывод с моего счёта?"}]}).json()
    assert r["handoff"] is True and r["language"] == "RU" and "специалист" in r["reply"]
    r = client.post("/api/assist", json={"messages": [{"role": "client", "text": "Шотымнан ақша шығара алмаймын"}]}).json()
    assert r["handoff"] is True and r["language"] == "KZ"
    ok = client.post("/api/assist/rate", json={"rating": 5, "language": "RU", "handoff": True}).json()
    assert ok["csat"]["count"] == 1 and ok["csat"]["avg"] == 5
    assert client.post("/api/assist/rate", json={"rating": 9}).status_code == 422
