"""Целостность синтетического тест-сета. Владелец: Участник 4."""
import json
from collections import Counter
from pathlib import Path

from cqa.importer import parse_response
from cqa.models import ChecklistDraft

ROOT = Path(__file__).resolve().parents[2]
TS = json.loads((ROOT / "data/testsets/synthetic_v1.json").read_text(encoding="utf-8"))
CHK = ChecklistDraft.model_validate_json((ROOT / TS["checklist"]).read_text(encoding="utf-8"))


def test_imports_and_language_parity():
    convs = parse_response(TS["dataset"])
    assert len(convs) == len(TS["expected"]) == 24
    by_lang = Counter(c.language for c in convs)
    assert by_lang == {"RU": 8, "KZ": 8, "EN": 8}
    # одинаковые сценарии на всех языках имеют одинаковую структуру ролей
    by_sc = {}
    for c in convs:
        by_sc.setdefault(TS["meta"][c.conversation_id]["scenario"], set()).add(tuple(m.speaker for m in c.messages))
    assert all(len(v) == 1 for v in by_sc.values())


def test_expected_answers_are_valid_for_checklist():
    crit = {c.criterion_id: c for c in CHK.criteria}
    convs = {c.conversation_id: c for c in parse_response(TS["dataset"])}
    for cid, exp in TS["expected"].items():
        msgs = {m.message_id: m for m in convs[cid].messages}
        for k, e in exp.items():
            c = crit[k]
            if e["status"] == "not_applicable":
                assert c.na_allowed, (cid, k)
            if e["status"] == "applicable":
                allowed = ({o.value for o in c.options} if c.answer_type != "scale"
                           else {str(v) for v in range(c.scale.min, c.scale.max + 1)})
                assert set(e["answers"]) <= allowed, (cid, k)
            for mid in e.get("evidence_any", []):  # доказательство — реплика оператора
                assert msgs[mid].speaker == "operator", (cid, k, mid)


def test_authorship_traps_present():
    # в «ловушках» приветствие есть, но не от оператора
    convs = {c.conversation_id: c for c in parse_response(TS["dataset"])}
    for cid, m in TS["meta"].items():
        if m["scenario"] in ("bot_greeting_only", "client_greets_only"):
            assert TS["expected"][cid]["demo_greeting"]["answers"] == ["no"]
            assert not any(x.speaker == "operator" and i == 0 for i, x in enumerate(convs[cid].messages))
