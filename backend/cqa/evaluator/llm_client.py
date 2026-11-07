"""Адаптеры моделей. Владелец: Участник 2.

LLM_PROVIDER:
  - anthropic      — Claude через официальный SDK `anthropic`, structured output по JSON-схеме,
                     серверный fallback при отказе (fallbacks="default"). Модель по умолчанию claude-opus-5-5.
  - openai_compat  — любой POST {LLM_BASE_URL}/chat/completions: Gemini (выбран командой), OpenAI, OpenRouter, vLLM.
                     Для моделей gemini-* LLM_BASE_URL можно не задавать. Ответ по JSON-схеме (json_schema),
                     при отказе провайдера — json_object. reasoning_effort из LLM_EFFORT.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

from ..config import settings
from ..http import SSL_CONTEXT


class LLMError(Exception):
    def __init__(self, msg: str, calls: Optional[list["CallRecord"]] = None):
        super().__init__(msg)
        self.calls = calls or []


class QuotaExceeded(LLMError):
    """Исчерпана квота/биллинг провайдера: повторять бессмысленно, очередь пакета останавливается."""


def _api_message(detail: str) -> str:
    """Короткое сообщение из JSON-ошибки провайдера (Google отдаёт [{"error": {...}}])."""
    try:
        d = json.loads(detail)
        d = d[0] if isinstance(d, list) and d else d
        return str((d.get("error") or {}).get("message") or detail)[:200]
    except (ValueError, AttributeError):
        return detail.strip()[:200]


def _is_quota(code: int, msg: str) -> bool:
    """429 с квотой/биллингом или 402 (закончились предоплаченные кредиты) — повтор бесполезен."""
    m = msg.lower()
    return code == 402 or (code == 429 and ("quota" in m or "billing" in m or "credit" in m))


_rate_lock = threading.Lock()
_next_slot = 0.0


def _pace() -> None:
    """Не больше LLM_RPM запросов в минуту на процесс (0 — без ограничения)."""
    global _next_slot
    if settings.llm_rpm <= 0:
        return
    with _rate_lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot - now)
        _next_slot = max(now, _next_slot) + 60.0 / settings.llm_rpm
    if wait:
        time.sleep(wait)


@dataclass
class CallRecord:
    ok: bool
    latency_s: float
    model: Optional[str] = None
    input_tokens: Optional[int] = None    # None = неизвестно (НЕ ноль!)
    output_tokens: Optional[int] = None
    error: Optional[str] = None


@dataclass
class LLMResponse:
    text: str
    calls: list[CallRecord] = field(default_factory=list)


def chat_json(system: str, user: str, schema: dict[str, Any]) -> LLMResponse:
    if settings.llm_provider == "anthropic":
        return _anthropic(system, user, schema)
    return _openai_compat(system, user, schema)


# ---------------- Claude (официальный SDK) ----------------

_client = None


def _anthropic_client():
    global _client
    if _client is None:
        import anthropic
        # Ключ берётся из ANTHROPIC_API_KEY (или профиля `ant auth login`).
        try:
            _client = anthropic.Anthropic(timeout=settings.llm_timeout_s, max_retries=settings.llm_max_retries)
        except TypeError as e:  # SDK не нашёл учётных данных
            raise LLMError("Не задан ANTHROPIC_API_KEY в .env (или выполните `ant auth login`)") from e
    return _client


def _anthropic(system: str, user: str, schema: dict[str, Any]) -> LLMResponse:
    import anthropic

    model = settings.llm_model or "claude-opus-5-5"
    client = _anthropic_client()
    t0 = time.monotonic()
    try:
        resp = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": settings.llm_effort,
                "format": {"type": "json_schema", "schema": schema},
            },
            # При отказе классификатора запрос автоматически переисполняется на рекомендованной модели.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIStatusError as e:  # 4xx/5xx после встроенных повторов SDK
        raise LLMError(f"Claude API HTTP {e.status_code}: {e.message}",
                       [CallRecord(False, time.monotonic() - t0, model, error=f"HTTP {e.status_code}")])
    except anthropic.APIConnectionError as e:  # сеть / таймаут
        raise LLMError(f"Нет связи с Claude API: {e}",
                       [CallRecord(False, time.monotonic() - t0, model, error=type(e).__name__)])
    except anthropic.AnthropicError as e:  # например, не задан ключ
        raise LLMError(f"Claude SDK: {e}")

    u = resp.usage
    rec = CallRecord(True, time.monotonic() - t0, resp.model, u.input_tokens, u.output_tokens)
    if resp.stop_reason == "refusal":
        cat = getattr(resp.stop_details, "category", None) if resp.stop_details else None
        rec.ok, rec.error = False, f"refusal:{cat}"
        raise LLMError(f"Модель отказалась отвечать (категория {cat})", [rec])
    if resp.stop_reason == "max_tokens":
        rec.error = "max_tokens"
        raise LLMError("Ответ обрезан по max_tokens", [rec])
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return LLMResponse(text, [rec])


# ---------------- OpenAI-совместимый HTTP ----------------

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
# reasoning_effort у Gemini: minimal | low | medium | high
_EFFORT = {"low": "low", "medium": "medium", "high": "high", "xhigh": "high", "max": "high", "minimal": "minimal"}


def _usage(usage: dict) -> tuple[Optional[int], Optional[int]]:
    """(input, output). Output берём как total - prompt, чтобы учесть токены размышлений,
    которые Gemini тарифицирует по цене output."""
    pin, pout, tot = usage.get("prompt_tokens"), usage.get("completion_tokens"), usage.get("total_tokens")
    if pin is not None and tot is not None and tot >= pin:
        return pin, tot - pin
    return pin, pout


def _openai_compat(system: str, user: str, schema: Optional[dict] = None) -> LLMResponse:
    try:
        return _openai_compat_model(system, user, schema, settings.llm_model)
    except LLMError as e:
        # квота у резервной модели может быть своей (у Gemini лимиты по моделям) — пробуем её один раз
        fb = settings.llm_fallback_model
        overloaded = any(c.error in ("HTTP 503", "HTTP 429") or (c.error or "").startswith("TimeoutError")
                         for c in e.calls)
        if not (fb and fb != settings.llm_model and overloaded):
            raise
        # Основная модель перегружена — повторяем на резервной; все вызовы идут в учёт стоимости
        try:
            r = _openai_compat_model(system, user, schema, fb)
        except LLMError as e2:
            e2.calls = e.calls + e2.calls
            if isinstance(e, QuotaExceeded) and isinstance(e2, QuotaExceeded):
                raise QuotaExceeded(f"Исчерпана квота провайдера для {settings.llm_model} и {fb}: {e2}", e2.calls) from e2
            raise
        r.calls = e.calls + r.calls
        return r


def _openai_compat_model(system: str, user: str, schema: Optional[dict], model: str) -> LLMResponse:
    base = settings.llm_base_url or (GEMINI_BASE_URL if model.startswith("gemini") else "")
    if not (base and model):
        raise LLMError("LLM_BASE_URL / LLM_MODEL не заданы в .env")
    if not settings.llm_api_key and not is_local():
        raise LLMError("Не задан LLM_API_KEY в .env")
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": ({"type": "json_schema",
                             "json_schema": {"name": "cqa_evaluation", "schema": schema, "strict": True}}
                            if schema else {"type": "json_object"}),
    }
    if model.startswith("gemini"):
        body["reasoning_effort"] = _EFFORT.get(settings.llm_effort, "medium")
    else:
        body["temperature"] = 0
    calls: list[CallRecord] = []
    last_err = ""
    for attempt in range(settings.llm_max_retries + 1):
        _pace()
        t0 = time.monotonic()
        req = urllib.request.Request(
            base.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.llm_api_key or 'local'}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=settings.llm_timeout_s, context=SSL_CONTEXT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            pin, pout = _usage(data.get("usage") or {})
            rec = CallRecord(True, time.monotonic() - t0, data.get("model") or model, pin, pout)
            calls.append(rec)
            if settings.llm_context_tokens and pin and pin >= settings.llm_context_tokens - 1500:
                rec.error = "context"
                raise LLMError(f"Диалог не помещается в контекст модели: промпт {pin} из {settings.llm_context_tokens} "
                               f"токенов. Увеличьте OLLAMA_CONTEXT_LENGTH и LLM_CONTEXT_TOKENS.", calls)
            choice = data["choices"][0]
            if choice.get("finish_reason") == "length":
                rec.error = "max_tokens"
                raise LLMError("Ответ обрезан по длине", calls)
            return LLMResponse(choice["message"]["content"] or "", calls)
        except urllib.error.HTTPError as e:
            detail = e.read(2000).decode("utf-8", "replace") if e.fp else ""
            msg = _api_message(detail)
            last_err = f"HTTP {e.code}: {msg}"
            calls.append(CallRecord(False, time.monotonic() - t0, model, error=f"HTTP {e.code}"))
            if _is_quota(e.code, msg):
                raise QuotaExceeded(f"Исчерпана квота или кредиты {model} (HTTP {e.code}). Пополните баланс "
                                    f"в Google AI Studio или используйте другой ключ/модель. {msg}", calls)
            if e.code == 400 and body["response_format"]["type"] == "json_schema":
                # Провайдер не принял схему — пробуем режим JSON без схемы; валидатор всё равно проверит ответ
                body["response_format"] = {"type": "json_object"}
                continue
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            last_err = f"{type(e).__name__}: {e}"
            calls.append(CallRecord(False, time.monotonic() - t0, model, error=last_err))
        time.sleep(min(2 ** attempt, 8))
    raise LLMError(f"Вызов модели не удался: {last_err}", calls)


# ---------------- Стоимость ----------------

# $ за 1 млн токенов (стандартные цены, без кеша/batch). Переопределяются LLM_PRICE_* в .env.
KNOWN_PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-4-8": (5.0, 25.0),  # возможная модель серверного fallback
    # Gemini: цены до 31.12.2026 (с 01.01.2027 — 1.50 / 7.50); output включает токены размышлений
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.6-flash": (0.75, 3.75),
    "claude-haiku-5-5": (0.10, 0.50),
}


def is_local() -> bool:
    """Модель на этом компьютере (Ollama и т.п.) — вызовы бесплатны."""
    host = urllib.parse.urlsplit(settings.llm_base_url).hostname or ""
    return settings.llm_provider == "openai_compat" and host in ("localhost", "127.0.0.1", "::1")


def _price(model: Optional[str]) -> Optional[tuple[float, float]]:
    """Цена за 1 млн токенов; (0, 0) — бесплатно (локально); None — неизвестна."""
    if settings.llm_price_input_per_m or settings.llm_price_output_per_m:
        return settings.llm_price_input_per_m, settings.llm_price_output_per_m
    if model in KNOWN_PRICES:
        return KNOWN_PRICES[model]
    return (0.0, 0.0) if is_local() else None


def cost_usd(calls: list[CallRecord]) -> Optional[float]:
    """Стоимость по ВСЕМ вызовам с известным usage (включая отказы и обрезанные ответы).
    None — если usage хоть одного вызова с ответом неизвестен или цена модели не задана."""
    total = 0.0
    for c in calls:
        if c.input_tokens is None and c.output_tokens is None:
            if c.ok:
                return None
            continue  # сетевой сбой/HTTP-ошибка без ответа
        price = _price(c.model)
        if price is None:
            return None
        pin, pout = price
        total += ((c.input_tokens or 0) * pin + (c.output_tokens or 0) * pout) / 1_000_000
    return round(total, 6)
