"""Ассистент поддержки на витрине: отвечает по опыту операторов из DEV и передаёт человеку то, что решает специалист.

Принципы: называет себя ассистентом (за человека себя не выдаёт); вопросы о деньгах, счёте, идентификации,
просьба позвать человека и раздражение клиента — сразу к специалисту, без модели; остальное — модель отвечает
ТОЛЬКО по примерам ответов операторов из хорошо оценённых диалогов, иначе тоже передаёт человеку.
Оценка разговора клиентом (1–5) сохраняется в таблицу csat и видна в аналитике.
"""
from __future__ import annotations

import json
import re
import threading
from typing import Any, Optional

from . import storage

_KZ = re.compile(r"[әғқңөұүһі]", re.I)
_LAT = re.compile(r"[a-z]", re.I)
_CYR = re.compile(r"[а-яё]", re.I)

HANDOFF = re.compile(
    r"вывод|вывест|снят|withdraw|шығар|баланс|balance|идентиф|верифик|identity|verif|жеке бас|"
    r"блок|ограничен|restrict|block|шектеу|персональн|личн\w* данн|personal data|паспорт|"
    r"мо[йеёи]\w* (сч[её]т|счет|деньг|средств|портфел|заявк|поручен|платеж|платёж)|my (account|money|funds|order|payment|portfolio)|"
    r"менің (шот|ақша)|шотым|"
    r"оператор|человек|специалист|сотрудник|agent|human|person|адам|маман|"
    r"безобраз|ужас|сколько можно|надоел|обман|terrible|angry|ridiculous|scam|!!!", re.I)

TEXT = {
    "RU": {"handoff": "Это вопрос, который решает специалист. Передаю ему разговор: он увидит всю переписку, "
                      "повторять ничего не нужно. Обычно отвечают в течение 2 минут.",
           "nofound": "Точного ответа у меня нет, поэтому передаю вопрос специалисту — он увидит всю переписку. "
                      "Обычно отвечают в течение 2 минут."},
    "KZ": {"handoff": "Бұл сұрақты маман шешеді. Әңгімені маманға жолдаймын: ол бүкіл хат алмасуды көреді, "
                      "қайталаудың қажеті жоқ. Әдетте 2 минут ішінде жауап береді.",
           "nofound": "Нақты жауабым жоқ, сондықтан сұрағыңызды маманға жолдаймын — ол бүкіл хат алмасуды көреді. "
                      "Әдетте 2 минут ішінде жауап береді."},
    "EN": {"handoff": "This is something a specialist handles. I'm passing the conversation on — they'll see the whole "
                      "chat, so you won't need to repeat anything. They usually reply within 2 minutes.",
           "nofound": "I don't have an exact answer, so I'm passing your question to a specialist — they'll see the "
                      "whole chat. They usually reply within 2 minutes."},
}


def language(text: str) -> str:
    if _KZ.search(text):
        return "KZ"
    if _LAT.search(text) and not _CYR.search(text):
        return "EN"
    return "RU"


def _words(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[\wёәғқңөұүһі]+", text.lower()) if len(w) >= 3}


_KB: Optional[list[dict]] = None
_KB_LOCK = threading.Lock()


KB_FILE = "data/assistant_kb.json"   # собирается командой: python -m cqa.assistant (из базы, ~2 мин на Neon)


def knowledge() -> list[dict]:
    """Пары «вопрос клиента → ответ оператора» из DEV-диалогов с хорошей оценкой и без грубых ошибок."""
    global _KB
    with _KB_LOCK:
        if _KB is not None:
            return _KB
        from .config import ROOT
        f = ROOT / KB_FILE
        if f.exists():
            _KB = json.loads(f.read_text(encoding="utf-8"))
            return _KB
        _KB = build_knowledge()
        return _KB


def build_knowledge() -> list[dict]:
    if True:
        from . import export
        from .main import _official_vid
        vid = _official_vid(None, "DEV")
        kb = []
        for c in storage.list_conversations(group_id="DEV"):
            if c["channel"] == "voice call":
                continue
            ev = export._latest(c["conversation_id"], vid)
            fs = (ev or {}).get("final_score") or {}
            if not ev or fs.get("critical_error") or (fs.get("total") or 0) < 85:
                continue
            q: list[str] = []
            for m in storage.get_conversation(c["conversation_id"]).messages:
                if m.speaker == "client":
                    q.append(m.text)
                elif m.speaker == "operator" and q:
                    kb.append({"q": " ".join(q[-2:]), "a": m.text, "src": c["conversation_id"], "lang": c["language"]})
                    q = []
        return kb


def retrieve(question: str, k: int = 5) -> list[dict]:
    qw = _words(question)
    scored = [(len(qw & _words(x["q"] + " " + x["a"])), x) for x in knowledge()]
    return [x for s, x in sorted(scored, key=lambda t: -t[0]) if s >= 2][:k]


SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "handoff": {"type": "boolean"}},
          "required": ["answer", "handoff"], "additionalProperties": False}


def reply(messages: list[dict]) -> dict[str, Any]:
    """messages: [{"role": "client"|"assistant", "text": "..."}]. Последнее сообщение — от клиента."""
    last = next((m["text"] for m in reversed(messages) if m.get("role") == "client"), "").strip()[:800]
    lang = language(last)
    if not last:
        return {"reply": "", "handoff": False, "language": lang, "sources": []}
    if HANDOFF.search(last):
        return {"reply": TEXT[lang]["handoff"], "handoff": True, "language": lang, "sources": [], "eta_min": 2}
    hits = retrieve(last)
    if not hits:
        return {"reply": TEXT[lang]["nofound"], "handoff": True, "language": lang, "sources": [], "eta_min": 2}
    from .evaluator import llm_client
    examples = "\n".join(f"- Клиент: {h['q'][:300]}\n  Оператор: {h['a'][:400]}" for h in hits)
    history = "\n".join(f"{'Клиент' if m.get('role') == 'client' else 'Ассистент'}: {m.get('text', '')[:400]}"
                        for m in messages[-6:])
    system = ("Ты — ИИ-ассистент поддержки брокера (не человек; если спросят — так и скажи). Отвечай на языке клиента "
              f"({ {'RU': 'русский', 'KZ': 'казахский', 'EN': 'английский'}[lang] }), коротко: 1–3 предложения, конкретный путь в "
              "приложении, если он есть в примерах. Используй ТОЛЬКО факты из примеров ответов операторов ниже. "
              "Не давай инвестиционных советов, не обещай сроков и сумм, не запрашивай личные данные. Если в примерах нет "
              "ответа на вопрос клиента — handoff=true и answer: вежливо, что передаёшь вопрос специалисту. "
              "Ответ — JSON {\"answer\": \"...\", \"handoff\": false|true}.")
    user = f"Примеры ответов операторов:\n{examples}\n\nРазговор:\n{history}"
    try:
        resp = llm_client.chat_json(system, user, SCHEMA)
        data = json.loads(resp.text)
    except Exception:  # noqa: BLE001 — модель недоступна: честно передаём человеку
        return {"reply": TEXT[lang]["nofound"], "handoff": True, "language": lang, "sources": [], "eta_min": 2}
    answer = (data.get("answer") or "").strip() or TEXT[lang]["nofound"]
    out = {"reply": answer, "handoff": bool(data.get("handoff")), "language": lang,
           "sources": sorted({h["src"] for h in hits})[:3]}
    if out["handoff"]:
        out["eta_min"] = 2
    return out


def _ensure_csat() -> None:
    with storage.tx() as db:
        db.execute("CREATE TABLE IF NOT EXISTS csat (created_at TEXT, rating INTEGER, language TEXT, handoff INTEGER)")


def rate(rating: int, lang: str, handoff: bool) -> None:
    _ensure_csat()
    with storage.tx() as db:
        db.execute("INSERT INTO csat (created_at, rating, language, handoff) VALUES (?,?,?,?)",
                   (storage.now(), int(rating), lang if lang in TEXT else "RU", int(bool(handoff))))


def csat_summary() -> dict[str, Any]:
    _ensure_csat()
    with storage.tx() as db:
        rows = db.execute("SELECT rating, handoff FROM csat").fetchall()
    n = len(rows)
    if not n:
        return {"count": 0, "avg": None, "good_pct": None}
    vals = [r[0] for r in rows]
    return {"count": n, "avg": round(sum(vals) / n, 2), "good_pct": round(100 * sum(v >= 4 for v in vals) / n, 1),
            "handoff_pct": round(100 * sum(r[1] for r in rows) / n, 1)}


if __name__ == "__main__":
    from .config import ROOT
    kb = build_knowledge()
    (ROOT / KB_FILE).write_text(json.dumps(kb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{KB_FILE}: {len(kb)} пар")
