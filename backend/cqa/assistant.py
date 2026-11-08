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


FAQ_FILE = "data/assistant_faq.json"   # справочник команды по ответам операторов DEV (RU/KZ/EN)
_FAQ: Optional[list[dict]] = None
_NAME_INTRO = re.compile(r"^\s*(здравствуйте|добрый день|привет|hi|hello|сәлеметсіз бе)[!,.]?\s*"
                         r"((я|меня зовут|мен|i'm|i am|my name is)\s+(?!ии|ai\b|ии-|виртуальн)[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][\w-]*[!.,]?\s*)", re.I)
_SELF_INTRO = re.compile(r"^\s*(здравствуйте[!,.]?\s*)?(я\s+)?(ии|виртуальный)[-\s]?ассистент[^.!]*[.!]\s*", re.I)


def faq() -> list[dict]:
    global _FAQ
    if _FAQ is None:
        from .config import ROOT
        f = ROOT / FAQ_FILE
        _FAQ = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    return _FAQ


def _faq_text(lang: str) -> str:
    key = {"RU": "ru", "KZ": "kz", "EN": "en"}[lang]
    return "\n".join(f"[{x['id']}] {x['topic']}{' (ПЕРЕДАТЬ СПЕЦИАЛИСТУ)' if x.get('handoff') else ''}: {x.get(key) or x['ru']}"
                     for x in faq())


def reply(messages: list[dict]) -> dict[str, Any]:
    """messages: [{"role": "client"|"assistant", "text": "..."}]. Последнее сообщение — от клиента."""
    client_msgs = [m.get("text", "").strip()[:500] for m in messages if m.get("role") == "client"]
    last = client_msgs[-1] if client_msgs else ""
    lang = language(last) if len(last) > 3 else language(" ".join(client_msgs[-3:]))
    if not last:
        return {"reply": "", "handoff": False, "language": lang, "sources": []}
    if HANDOFF.search(last):
        return {"reply": TEXT[lang]["handoff"], "handoff": True, "language": lang, "sources": [], "eta_min": 2}
    if re.fullmatch(r"\s*(привет\w*|здравствуй\w*|добрый (день|вечер|утро)|салам\w*|сәлем\w*|hi|hello|hey)[\s!.,)]*", last, re.I):
        hello = next((x for x in faq() if x["id"] == "hello"), {})
        return {"reply": hello.get({"RU": "ru", "KZ": "kz", "EN": "en"}[lang]) or hello.get("ru", "Здравствуйте! Чем помочь?"),
                "handoff": False, "language": lang, "sources": []}
    context = " ".join(client_msgs[-3:])                     # «я в вебе» понимаем вместе с прошлым вопросом
    hits = retrieve(context, k=4)
    from .evaluator import llm_client
    examples = "\n".join(f"- Клиент: {h['q'][:250]}\n  Оператор: {h['a'][:350]}" for h in hits) or "—"
    history = "\n".join(f"{'Клиент' if m.get('role') == 'client' else 'Ассистент'}: {m.get('text', '')[:400]}"
                        for m in messages[-8:])
    lang_name = {"RU": "русском", "KZ": "казахском", "EN": "английском"}[lang]
    system = (
        "Ты — ИИ-ассистент поддержки брокера Freedom Broker (не человек; если спросят — так и скажи). "
        f"Отвечай на {lang_name} языке, коротко (1–3 предложения), по делу, с конкретным путём в приложении. "
        "Факты бери ТОЛЬКО из СПРАВОЧНИКА (главный источник) и примеров ответов операторов. Учитывай весь разговор: "
        "если клиент уточняет («я в вебе», «в приложении», «за прошлый год»), отвечай на его исходный вопрос с учётом уточнения. "
        "Если ответ зависит от детали, которой нет (например, приложение или веб), — задай ОДИН короткий уточняющий вопрос "
        "(handoff=false). Не начинай ответ с представления «я ИИ-ассистент» — представляйся, только если спросили, кто ты. "
        "Не называй себя именами операторов, не пиши «я Алина/Света» и т. п. Не давай инвестиционных советов, "
        "не обещай сумм и сроков, не запрашивай пароли и коды. Если тема помечена «ПЕРЕДАТЬ СПЕЦИАЛИСТУ» или ответа нет "
        "в справочнике и примерах — коротко объясни и handoff=true. Ответ — JSON {\"answer\": \"...\", \"handoff\": false|true}.")
    user = f"СПРАВОЧНИК:\n{_faq_text(lang)}\n\nПримеры ответов операторов:\n{examples}\n\nРазговор:\n{history}"
    try:
        resp = llm_client.chat_json(system, user, SCHEMA)
        data = json.loads(resp.text)
    except Exception:  # noqa: BLE001 — модель недоступна: честно передаём человеку
        return {"reply": TEXT[lang]["nofound"], "handoff": True, "language": lang, "sources": [], "eta_min": 2}
    answer = _NAME_INTRO.sub(lambda m: m.group(1) + "! ", (data.get("answer") or "").strip()).strip()
    if not re.search(r"кто ты|ты человек|ты бот|who are you|are you (a )?(human|bot)|сен кімсің", last, re.I):
        answer = _SELF_INTRO.sub("", answer).strip()
    answer = (answer[:1].upper() + answer[1:]) if answer else TEXT[lang]["nofound"]
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
