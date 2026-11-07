"""Формат сдачи (Приложение, JSON 1.0) и официальный расчёт итога. Владельцы: Участники 1 и 4."""
import json
from pathlib import Path

import pytest

from cqa import export, importer, storage
from cqa.models import ChecklistDraft, CriterionResult
from cqa.scoring import score

ROOT = Path(__file__).resolve().parents[2]
OFFICIAL = ChecklistDraft.model_validate_json((ROOT / "data/checklists/official_v1.json").read_text(encoding="utf-8"))

# Пример из приложения (стр. 2): итог 85.38
EXAMPLE = {"contact": ("applicable", "yes"), "discovery": ("not_applicable", None),
           "identification": ("not_applicable", None), "consultation": ("applicable", "15"),
           "empathy": ("applicable", "yes"), "dialogue": ("applicable", "7"),
           "closure": ("applicable", "yes"), "critical": ("applicable", "no")}


def results_for(spec):
    return [CriterionResult(criterion_id=k, status=st, answer=a, explanation="x",
                            evidence_message_ids=["m001"]) for k, (st, a) in spec.items()]


def test_official_checklist_matches_appendix():
    got = {c.criterion_id: (c.weight, c.na_allowed) for c in OFFICIAL.criteria}
    assert got == {"contact": (10, False), "discovery": (15, True), "identification": (20, True),
                   "consultation": (20, True), "empathy": (15, False), "dialogue": (15, False),
                   "closure": (5, True), "critical": (0, False)}


def test_example_from_appendix_scores_85_38():
    s = score(OFFICIAL, results_for(EXAMPLE))
    assert s.total == 85.38 and s.critical_error is False


def test_critical_flag_does_not_zero_total():
    spec = dict(EXAMPLE, critical=("applicable", "yes"))
    s = score(OFFICIAL, results_for(spec))
    assert s.total == 85.38 and s.critical_error is True


def _seed(spec_by_conv):
    storage.save_checklist(OFFICIAL)
    vid = next(v.version_id for v in storage.list_checklists() if v.checklist_id == "official")
    ds = json.loads((ROOT / "data/fixtures/sample_dataset.json").read_text(encoding="utf-8"))
    storage.upsert_conversations(importer.parse_response(ds))
    for cid, spec in spec_by_conv.items():
        conv = storage.get_conversation(cid)
        eid = storage.create_evaluation(cid, conv.content_hash, vid)
        if spec == "failed":
            storage.update_evaluation(eid, status="failed", error="HTTP 503")
            continue
        res = results_for(spec)
        sc = score(OFFICIAL, res)
        dump = json.dumps([r.model_dump() for r in res])
        storage.update_evaluation(eid, status="completed", model="qwen3:8b", final_results_json=dump,
                                  ai_results_json=dump, final_score_json=sc.model_dump_json(),
                                  ai_score_json=sc.model_dump_json())
    return vid


def test_build_and_check_roundtrip():
    review = dict(EXAMPLE, empathy=("needs_review", None))
    vid = _seed({"fx-ru-001": EXAMPLE, "fx-kz-001": "failed", "fx-call-001": review})
    doc = export.build("FIXTURE", vid, "Arasaka")
    assert export.check(doc, {"fx-ru-001", "fx-kz-001", "fx-call-001"}, 3) == []
    by = {r["conversation_id"]: r for r in doc["results"]}
    ok = by["fx-ru-001"]
    assert ok["status"] == "ok" and ok["score"] == {"final_score": 85.38, "critical_flag": False}
    vals = {c["criterion_id"]: c["value"] for c in ok["criteria"]}
    assert vals == {"contact": True, "discovery": None, "identification": None, "consultation": 15,
                    "empathy": True, "dialogue": 7, "closure": True, "critical": False}
    assert ok["criteria"][0]["evidence_turns"] == [1]
    assert by["fx-kz-001"]["status"] == "error" and by["fx-kz-001"]["score"] is None   # сбой — не ноль
    assert by["fx-call-001"]["status"] == "error" and "ручной" in by["fx-call-001"]["error"]


@pytest.mark.parametrize("mutate,needle", [
    (lambda d: d["results"].append(dict(d["results"][0])), "повторяющиеся"),
    (lambda d: d["results"][0]["criteria"].pop(), "все 8 критериев"),
    (lambda d: d["results"][0]["criteria"][5].update(value=8), "недопустимое значение"),
    (lambda d: d["results"][0]["criteria"][0].update(value=1), "неверный тип"),
    (lambda d: d["results"][0]["score"].update(final_score=90.0), "пересчёт"),
    (lambda d: d["results"][0]["score"].update(critical_flag=True), "critical_flag"),
])
def test_check_catches_format_errors(mutate, needle):
    vid = _seed({"fx-ru-001": EXAMPLE})
    doc = export.build("FIXTURE", vid, "Arasaka")
    doc["results"] = [r for r in doc["results"] if r["status"] == "ok"]
    mutate(doc)
    assert any(needle in e for e in export.check(doc))
