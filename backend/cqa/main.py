"""HTTP API. Владелец: Участник 1.

Запуск:  cd backend && uvicorn cqa.main:app --reload --port 8000
UI раздаётся с того же сервера: http://localhost:8000  (нет CORS)
Контракт: docs/API_CONTRACT.md
"""
from __future__ import annotations

import json
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import audio as audio_adapter, http, importer, storage
from .config import ROOT, settings
from .evaluator import evaluate
from .models import (
    AppealCreate,
    ChecklistDraft,
    CriterionResult,
    DecisionCreate,
    EvaluationRequest,
)
from .scoring import score

app = FastAPI(title="CQA Hackathon API", version="0.1.0")


# ---------- Защита паролем (для деплоя) ----------
# Включается переменными BASIC_AUTH_USER / BASIC_AUTH_PASSWORD. /api/health открыт для проверки живости.
import base64
import os
import secrets

from fastapi import Request
from fastapi.responses import Response

_AUTH_USER = os.getenv("BASIC_AUTH_USER", "")
_AUTH_PASS = os.getenv("BASIC_AUTH_PASSWORD", "")


_PUBLIC = {"/", "/api/health", "/api/public/stats", "/ui/styles.css", "/ui/landing.css", "/ui/landing.js"}


def _public(path: str) -> bool:
    """Витрина для жюри и графики качества открыты; приложение и API — по паролю."""
    return path in _PUBLIC or path.startswith(("/reports/", "/ui/vendor/", "/ui/img/"))


# Ограничение частоты для запросов, которые тратят лимит модели (сайт открыт без пароля).
# Счётчик в памяти процесса: на Vercel — на экземпляр функции, этого достаточно против случайного перерасхода.
import time as _time
from collections import defaultdict as _dd, deque as _deque

_RATE = {("POST", "/api/evaluations"): 60, ("POST", "/api/evaluations/batch"): 3, ("POST", "/api/analytics/ask"): 20,
         ("POST", "/api/import/organizer"): 5}
_HITS: dict = _dd(_deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    limit = _RATE.get((request.method, request.url.path))
    if limit and os.getenv("RATE_LIMIT", "1") != "0":
        ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
              or (request.client.host if request.client else "?"))
        q, now = _HITS[(ip, request.url.path)], _time.time()
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= limit:
            return Response('{"detail":"Слишком много запросов с вашего адреса, попробуйте через час"}',
                            status_code=429, media_type="application/json")
        q.append(now)
    return await call_next(request)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if not _AUTH_PASS or _public(request.url.path):
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if header.startswith("Basic "):
        try:
            user, _, pwd = base64.b64decode(header[6:]).decode("utf-8").partition(":")
        except Exception:  # noqa: BLE001
            user, pwd = "", ""
        if secrets.compare_digest(user, _AUTH_USER) and secrets.compare_digest(pwd, _AUTH_PASS):
            return await call_next(request)
    return Response("Требуется вход", status_code=401, headers={"WWW-Authenticate": 'Basic realm="CQA"'})
executor = ThreadPoolExecutor(max_workers=settings.batch_concurrency)


@app.on_event("startup")
def startup() -> None:
    storage.init_db()
    if not storage.list_checklists():
        demo = ROOT / "data" / "fixtures" / "checklist_demo.json"
        storage.save_checklist(ChecklistDraft.model_validate_json(demo.read_text(encoding="utf-8")))
    try:  # официальный чек-лист всегда доступен в UI
        from .pipeline import official_version
        official_version()
    except Exception as e:  # noqa: BLE001
        print("Официальный чек-лист не загружен:", e)
    # Восстановление после перезапуска: незавершённые задачи снова в очередь.
    # Без фоновых процессов (Vercel) очередь досчитывается через POST /api/work.
    if not settings.serverless:
        for eid in storage.unfinished_evaluations():
            executor.submit(_run_evaluation, eid)


@app.get("/api/health")
def health() -> dict[str, Any]:
    model = "mock"
    if settings.evaluator_mode == "real":
        model = settings.llm_model or ("claude-opus-5-5" if settings.llm_provider == "anthropic" else "?")
    return {"ok": True, "evaluator_mode": settings.evaluator_mode, "provider": settings.llm_provider, "model": model,
            "serverless": settings.serverless}


# ---------- Импорт ----------

class ImportOrganizerBody(BaseModel):
    group_id: str


@app.post("/api/import/organizer")
def import_organizer(body: ImportOrganizerBody) -> dict[str, Any]:
    if not settings.organizer_api_url:
        raise HTTPException(400, "ORGANIZER_API_URL не задан в .env")
    parts = urllib.parse.urlsplit(settings.organizer_api_url)
    qs = dict(urllib.parse.parse_qsl(parts.query))
    qs["group_id"] = body.group_id
    url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(qs)))
    try:
        data = http.get_json(url, timeout=90)
    except Exception as e:  # noqa: BLE001 - не выводим URL: в нём подпись
        reason = getattr(e, "reason", None) or getattr(e, "code", None) or type(e).__name__
        raise HTTPException(502, f"API организаторов недоступен: {reason}")
    return _import(data, body.group_id)


@app.post("/api/import/json")
def import_json(body: dict[str, Any]) -> dict[str, Any]:
    """Тело - ответ API организаторов целиком (для файлов/фикстур)."""
    return _import(body, None)


def _import(data: dict[str, Any], group_id: Optional[str]) -> dict[str, Any]:
    try:
        convs = importer.parse_response(data, group_id)
    except importer.ImportError_ as e:
        raise HTTPException(422, str(e))
    stats = storage.upsert_conversations(convs)
    return {"total": len(convs), **stats}


# ---------- Диалоги ----------

@app.get("/api/conversations")
def conversations(language: Optional[str] = None, channel: Optional[str] = None,
                  group_id: Optional[str] = None) -> list[dict[str, Any]]:
    return storage.list_conversations(language, channel, group_id)


@app.get("/api/conversations/{conversation_id}")
def conversation(conversation_id: str) -> dict[str, Any]:
    conv = storage.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    return {**conv.model_dump(), "evaluations": storage.list_evaluations(conversation_id)}


# ---------- Чек-листы ----------

@app.get("/api/checklists")
def checklists() -> list[dict[str, Any]]:
    return [c.model_dump() for c in storage.list_checklists()]


@app.get("/api/checklists/{version_id}")
def checklist(version_id: int) -> dict[str, Any]:
    c = storage.get_checklist(version_id)
    if not c:
        raise HTTPException(404, "Версия не найдена")
    return c.model_dump()


@app.post("/api/checklists")
def save_checklist(draft: ChecklistDraft) -> dict[str, Any]:
    ids = [c.criterion_id for c in draft.criteria]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "criterion_id должны быть уникальны")
    for c in draft.criteria:
        if c.answer_type == "scale" and not c.scale:
            raise HTTPException(422, f"{c.criterion_id}: для шкалы нужна scale")
        if c.answer_type != "scale" and not c.options:
            raise HTTPException(422, f"{c.criterion_id}: нужны варианты ответа")
    return storage.save_checklist(draft).model_dump()


# ---------- Оценка ----------

def _run_evaluation(evaluation_id: int) -> None:
    if not storage.claim_evaluation(evaluation_id):
        return  # отменена или уже выполняется
    ev = storage.get_evaluation(evaluation_id)
    conv = storage.get_conversation(ev["conversation_id"])
    chk = storage.get_checklist(ev["checklist_version_id"])
    try:
        out = evaluate(conv, chk)  # долгий вызов - вне транзакции
        sc = score(chk, out.results)
        results_json = json.dumps([r.model_dump() for r in out.results], ensure_ascii=False)
        storage.update_evaluation(
            evaluation_id, status="completed", mode=out.mode, model=out.model,
            prompt_version=out.prompt_version,
            ai_results_json=results_json, ai_score_json=sc.model_dump_json(),
            final_results_json=results_json, final_score_json=sc.model_dump_json(),
            usage_json=json.dumps({"calls": out.calls, "problems": out.problems, "agreement": out.agreement},
                                  ensure_ascii=False),
            cost_usd=out.cost_usd, finished_at=storage.now(),
        )
    except Exception as e:  # noqa: BLE001 - сбой сохраняем как failed, а не как оценку
        from .evaluator.llm_client import QuotaExceeded, cost_usd
        calls = getattr(e, "calls", [])
        if isinstance(e, QuotaExceeded) and ev.get("batch_id"):
            # квота исчерпана — не сжигаем остальную очередь пакета впустую
            storage.cancel_batch(ev["batch_id"], "Остановлено: исчерпана квота модели")
        storage.update_evaluation(
            evaluation_id, status="failed", error=f"{type(e).__name__}: {e}",
            usage_json=json.dumps({"calls": [c.__dict__ for c in calls]}),
            cost_usd=cost_usd(calls) if calls else None, finished_at=storage.now())


def _start(conversation_id: str, version_id: int, batch_id: Optional[str] = None, inline: bool = False) -> int:
    conv = storage.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, f"Диалог {conversation_id} не найден")
    if not storage.get_checklist(version_id):
        raise HTTPException(404, "Версия чек-листа не найдена")
    eid = storage.create_evaluation(conversation_id, conv.content_hash, version_id, batch_id)
    if not settings.serverless:
        executor.submit(_run_evaluation, eid)
    elif inline:
        _run_evaluation(eid)  # одна оценка — прямо в запросе (~10 с на Gemini)
    return eid


@app.post("/api/work")
def work() -> dict[str, Any]:
    """Досчитать порцию очереди в пределах WORK_BUDGET_S (для Vercel: вызывает интерфейс, пока идёт пакет)."""
    import time
    from concurrent.futures import ThreadPoolExecutor as Pool
    t0 = time.monotonic()
    reclaimed = storage.reclaim_stale()
    done = 0
    with Pool(max_workers=settings.batch_concurrency) as pool:
        while time.monotonic() - t0 < settings.work_budget_s:
            ids = storage.next_queued(settings.batch_concurrency)
            if not ids:
                break
            list(pool.map(_run_evaluation, ids))
            done += len(ids)
    return {"processed": done, "reclaimed": reclaimed, "remaining": len(storage.next_queued(1000)),
            "seconds": round(time.monotonic() - t0, 1)}


@app.post("/api/evaluations")
def start_evaluation(req: EvaluationRequest) -> dict[str, Any]:
    # TODO(B05): кеш по (content_hash, version, model, prompt_version) при необходимости
    eid = _start(req.conversation_id, req.checklist_version_id, inline=True)
    return {"evaluation_id": eid, "status": storage.get_evaluation(eid)["status"]}


class BatchBody(BaseModel):
    checklist_version_id: int
    conversation_ids: Optional[list[str]] = None
    group_id: Optional[str] = None


@app.post("/api/evaluations/batch")
def start_batch(body: BatchBody) -> dict[str, Any]:
    ids = body.conversation_ids or [c["conversation_id"] for c in storage.list_conversations(group_id=body.group_id)]
    if not ids:
        raise HTTPException(422, "Нет диалогов для оценки")
    batch_id = uuid.uuid4().hex[:12]
    return {"batch_id": batch_id,
            "evaluation_ids": [_start(cid, body.checklist_version_id, batch_id) for cid in ids]}


@app.get("/api/batches")
def batches() -> dict[str, Any]:
    """Всё, что сейчас идёт и недавно закончилось — для страницы «Задачи»."""
    return {"batches": storage.list_batches(), "recent": storage.recent_evaluations(),
            "evaluator": {"mode": settings.evaluator_mode, "model": settings.llm_model, "think": settings.llm_think},
            "serverless": settings.serverless}


@app.get("/api/batches/{batch_id}")
def batch(batch_id: str) -> dict[str, Any]:
    st = storage.batch_status(batch_id)
    if not st["total"]:
        raise HTTPException(404, "Пакет не найден")
    return st


@app.post("/api/batches/{batch_id}/retry")
def batch_retry(batch_id: str) -> dict[str, Any]:
    """Повтор неуспешных и отменённых: новая попытка, старая остаётся в истории."""
    st = storage.batch_status(batch_id)
    retried = []
    for it in [i for i in st["items"] if i["status"] in ("failed", "canceled")]:
        ev = storage.get_evaluation(it["evaluation_id"])
        retried.append(_start(it["conversation_id"], ev["checklist_version_id"], batch_id))
    return {"retried": len(retried), "evaluation_ids": retried}


@app.post("/api/batches/{batch_id}/cancel")
def batch_cancel(batch_id: str) -> dict[str, Any]:
    """Останавливает задачи, которые ещё не начались. Идущие вызовы модели завершатся."""
    return {"canceled": storage.cancel_batch(batch_id)}


@app.get("/api/evaluations/{evaluation_id}")
def get_evaluation(evaluation_id: int) -> dict[str, Any]:
    ev = storage.get_evaluation(evaluation_id)
    if not ev:
        raise HTTPException(404, "Оценка не найдена")
    return ev


# ---------- Апелляции ----------

@app.post("/api/evaluations/{evaluation_id}/appeals")
def create_appeal(evaluation_id: int, body: AppealCreate) -> dict[str, Any]:
    ev = storage.get_evaluation(evaluation_id)
    if not ev or ev["status"] != "completed":
        raise HTTPException(409, "Оценка не завершена")
    if body.criterion_id not in {r["criterion_id"] for r in ev["ai_results"]}:
        raise HTTPException(422, "Нет такого критерия в оценке")
    return {"appeal_id": storage.create_appeal(evaluation_id, body.criterion_id, body.comment), "status": "open"}


@app.get("/api/appeals")
def appeals(status: Optional[str] = None) -> list[dict[str, Any]]:
    return storage.list_appeals(status)


@app.post("/api/appeals/{appeal_id}/decision")
def decide(appeal_id: int, body: DecisionCreate) -> dict[str, Any]:
    ap = storage.get_appeal(appeal_id)
    if not ap:
        raise HTTPException(404, "Апелляция не найдена")
    ev = storage.get_evaluation(ap["evaluation_id"])
    chk = storage.get_checklist(ev["checklist_version_id"])
    current = [CriterionResult.model_validate(r) for r in ev["final_results"]]
    old = next(r for r in current if r.criterion_id == ap["criterion_id"])

    if body.action == "change":
        if not body.new_status:
            raise HTTPException(422, "Для изменения нужен new_status")
        new = old.model_copy(update={
            "status": body.new_status,
            "answer": body.new_answer if body.new_status == "applicable" else None,
            "na_reason": body.reason if body.new_status == "not_applicable" else None,
        })
        current = [new if r.criterion_id == old.criterion_id else r for r in current]
    sc = score(chk, current)  # тот же калькулятор
    try:
        rev = storage.save_decision_atomic(
            appeal_id, ap["evaluation_id"], body.expected_revision,
            {"action": body.action, "reason": body.reason, "old_status": old.status, "old_answer": old.answer,
             "new_status": body.new_status, "new_answer": body.new_answer},
            [r.model_dump() for r in current], sc.model_dump())
    except storage.RevisionConflict as e:
        raise HTTPException(409, str(e))
    except storage.AlreadyDecided as e:
        raise HTTPException(409, str(e))
    example_id = None
    if body.action == "change":
        example_id = _save_calibration(ap, ev, chk, old, current, body.reason)
    return {"revision": rev, "final_score": sc.model_dump(), "calibration_example_id": example_id}


def _save_calibration(ap: dict, ev: dict, chk: Any, old: CriterionResult,
                      current: list[CriterionResult], reason: str) -> Optional[int]:
    """Исправление проверяющего -> прецедент для следующих оценок («дообучение» без изменения весов модели)."""
    crit = next((c for c in chk.criteria if c.criterion_id == ap["criterion_id"]), None)
    conv = storage.get_conversation(ev["conversation_id"])
    if not crit or not conv:
        return None
    new = next(r for r in current if r.criterion_id == ap["criterion_id"])
    msgs = conv.messages
    ids = list(old.evidence_message_ids)
    if not ids and old.checked_range:
        idx = {m.message_id: m.index for m in msgs}
        a, b = idx.get(old.checked_range.from_message_id, 0), idx.get(old.checked_range.to_message_id, 0)
        ids = [m.message_id for m in msgs[a:b + 1]]
    if not ids:  # нет ссылок — берём реплики оператора
        ids = [m.message_id for m in msgs if m.speaker == "operator"]
    keep = set(ids[:8])
    excerpt = [{"message_id": m.message_id, "speaker": m.speaker, "text": m.text} for m in msgs if m.message_id in keep]
    return storage.add_calibration_example(
        criterion_id=crit.criterion_id, criterion_fingerprint=storage.criterion_fingerprint(crit),
        conversation_id=conv.conversation_id, evaluation_id=ev["evaluation_id"], appeal_id=ap["appeal_id"],
        excerpt=excerpt, ai_status=old.status, ai_answer=old.answer,
        correct_status=new.status, correct_answer=new.answer, reason=reason, source="appeal")


@app.get("/api/calibration")
def calibration() -> dict[str, Any]:
    return {"enabled": settings.calibration, "per_criterion": settings.calibration_per_criterion,
            "examples": storage.list_calibration()}


class CalibrationToggle(BaseModel):
    active: bool


@app.patch("/api/calibration/{example_id}")
def calibration_toggle(example_id: int, body: CalibrationToggle) -> dict[str, Any]:
    if not storage.set_calibration_active(example_id, body.active):
        raise HTTPException(404, "Пример не найден")
    return {"example_id": example_id, "active": body.active}


# ---------- Аналитика ----------

def _official_vid(checklist_version_id: Optional[int], group_id: Optional[str] = None) -> int:
    """Явно заданная версия; иначе — последняя версия официального чек-листа, по которой в наборе есть оценки."""
    if checklist_version_id:
        return checklist_version_id
    with storage.tx() as db:
        r = db.execute("""SELECT MAX(e.checklist_version_id) FROM evaluations e
                          JOIN checklist_versions v ON v.version_id = e.checklist_version_id
                          JOIN conversations c ON c.conversation_id = e.conversation_id
                          WHERE v.checklist_id = 'official' AND e.status = 'completed'"""
                       + (" AND c.group_id = ?" if group_id else ""), (group_id,) if group_id else ()).fetchone()
    vid = (r[0] if r else None) or next((v.version_id for v in storage.list_checklists() if v.checklist_id == "official"), None)
    if not vid:
        raise HTTPException(404, "Нет официального чек-листа")
    return vid


@app.get("/api/analytics")
def analytics(group_id: Optional[str] = "DEV", checklist_version_id: Optional[int] = None) -> dict[str, Any]:
    from . import analytics as an
    return an.summary(group_id or None, _official_vid(checklist_version_id, group_id or None))


class AskBody(BaseModel):
    group_id: Optional[str] = "DEV"
    question: str = ""


@app.post("/api/analytics/ask")
def analytics_ask(body: AskBody) -> dict[str, Any]:
    from . import analytics as an
    from .evaluator.llm_client import LLMError
    if settings.evaluator_mode != "real":
        raise HTTPException(409, "ИИ-аналитик доступен с настоящей моделью (EVALUATOR_MODE=real)")
    stats = an.summary(body.group_id or None, _official_vid(None, body.group_id or None))
    try:
        return an.ask(stats, body.question)
    except LLMError as e:
        raise HTTPException(502, f"Модель недоступна: {e}")


# ---------- Экспорт для сдачи ----------

@app.get("/api/export/{group_id}")
def export_results(group_id: str, checklist_version_id: Optional[int] = None) -> dict[str, Any]:
    """results.json в формате организаторов + список ошибок формата (пустой = готово к сдаче)."""
    from . import export as exp
    vid = checklist_version_id or next((v.version_id for v in storage.list_checklists() if v.checklist_id == "official"), None)
    if not vid:
        raise HTTPException(404, "Нет официального чек-листа")
    try:
        doc = exp.build(group_id, vid, settings.team_name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    ids = {c["conversation_id"] for c in storage.list_conversations(group_id=group_id)}
    if not ids:
        raise HTTPException(404, f"Нет диалогов группы {group_id}")
    return {"document": doc, "errors": exp.check(doc, ids)}


# ---------- Аудио ----------

@app.get("/api/conversations/{conversation_id}/audio")
def audio(conversation_id: str) -> dict[str, Any]:
    """audio_url организаторов - HTML-страница плеера, НЕ аудиофайл.
    Возвращаем штатный плеер и, если удалось проверить, прямой media-источник для <audio>."""
    conv = storage.get_conversation(conversation_id)
    if not conv or not conv.audio_url:
        raise HTTPException(404, "Записи нет")
    return audio_adapter.resolve(conv.audio_url)


# ---------- UI ----------

app.mount("/ui", StaticFiles(directory=ROOT / "frontend", html=True), name="ui")
app.mount("/reports", StaticFiles(directory=ROOT / "evaluation" / "reports", html=True), name="reports")


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return FileResponse(ROOT / "frontend" / "landing.html")


_stats_cache: dict[str, Any] = {"at": 0.0, "data": None}


@app.get("/api/public/stats")
def public_stats() -> dict[str, Any]:
    """Живые цифры для витрины: только агрегаты, без текстов переписок. Кэш 2 минуты."""
    import time
    if _stats_cache["data"] and time.time() - _stats_cache["at"] < 120:
        return _stats_cache["data"]
    from . import analytics as an
    out: dict[str, Any] = {"model": settings.llm_model if settings.evaluator_mode == "real" else "mock",
                           "team": settings.team_name}
    try:
        a = an.summary("DEV", _official_vid(None, "DEV"))
        out.update({k: a[k] for k in ("evaluated", "avg_total", "critical_count", "by_language")})
        out["criteria"] = [{k: c[k] for k in ("title", "weight", "score_pct")} for c in a["criteria"]]
    except Exception:  # noqa: BLE001 — витрина не должна падать
        return out
    _stats_cache.update(at=time.time(), data=out)
    return out
