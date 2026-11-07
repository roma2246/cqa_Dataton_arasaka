"""Адаптеры моделей. Владелец: Участник 2.

LLM_PROVIDER:
  - anthropic      — Claude через официальный SDK `anthropic`, structured output по JSON-схеме,
                     серверный fallback при отказе (fallbacks="default"). Модель по умолчанию claude-opus-5-5.
  - openai_compat  — любой POST {LLM_BASE_URL}/chat/completions: OpenAI, OpenRouter, vLLM/Ollama,
                     Gemini (LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

from ..config import settings
from ..http import SSL_CONTEXT


class LLMError(Exception):
    def __init__(self, msg: str, calls: Optional[list["CallRecord"]] = None):
        super().__init__(msg)
        self.calls = calls or []


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
    return _openai_compat(system, user)


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

def _openai_compat(system: str, user: str) -> LLMResponse:
    if not (settings.llm_base_url and settings.llm_model):
        raise LLMError("LLM_BASE_URL / LLM_MODEL не заданы в .env")
    body = {
        "model": settings.llm_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    calls: list[CallRecord] = []
    last_err = ""
    for attempt in range(settings.llm_max_retries + 1):
        t0 = time.monotonic()
        req = urllib.request.Request(
            settings.llm_base_url.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.llm_api_key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=settings.llm_timeout_s, context=SSL_CONTEXT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            usage = data.get("usage") or {}
            calls.append(CallRecord(True, time.monotonic() - t0, settings.llm_model,
                                    usage.get("prompt_tokens"), usage.get("completion_tokens")))
            return LLMResponse(data["choices"][0]["message"]["content"], calls)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            calls.append(CallRecord(False, time.monotonic() - t0, settings.llm_model, error=last_err))
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            last_err = f"{type(e).__name__}: {e}"
            calls.append(CallRecord(False, time.monotonic() - t0, settings.llm_model, error=last_err))
        time.sleep(min(2 ** attempt, 8))
    raise LLMError(f"Вызов модели не удался: {last_err}", calls)


# ---------------- Стоимость ----------------

# $ за 1 млн токенов (стандартные цены, без кеша/batch). Переопределяются LLM_PRICE_* в .env.
KNOWN_PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-4-8": (5.0, 25.0),  # возможная модель серверного fallback
    "claude-haiku-5-5": (0.10, 0.50),
}


def _price(model: Optional[str]) -> tuple[float, float]:
    if settings.llm_price_input_per_m or settings.llm_price_output_per_m:
        return settings.llm_price_input_per_m, settings.llm_price_output_per_m
    return KNOWN_PRICES.get(model or "", (0.0, 0.0))


def cost_usd(calls: list[CallRecord]) -> Optional[float]:
    """Стоимость по ВСЕМ вызовам с известным usage (включая отказы и обрезанные ответы).
    None — если usage хоть одного вызова с ответом неизвестен или цена модели не задана."""
    total = 0.0
    for c in calls:
        if c.input_tokens is None and c.output_tokens is None:
            if c.ok:
                return None
            continue  # сетевой сбой/HTTP-ошибка без ответа
        pin, pout = _price(c.model)
        if pin == 0 and pout == 0:
            return None
        total += ((c.input_tokens or 0) * pin + (c.output_tokens or 0) * pout) / 1_000_000
    return round(total, 6)
