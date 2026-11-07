"""Адаптер модели. Владелец: Участник 2.

Сейчас - OpenAI-совместимый POST {LLM_BASE_URL}/chat/completions (подходит для OpenAI,
OpenRouter, локальных vLLM/Ollama, Gemini OpenAI-compat endpoint).
Для Anthropic Messages API / нативного Gemini - добавить отдельную функцию (задача A01).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from ..config import settings


class LLMError(Exception):
    pass


@dataclass
class CallRecord:
    ok: bool
    latency_s: float
    input_tokens: Optional[int] = None    # None = неизвестно (НЕ ноль!)
    output_tokens: Optional[int] = None
    error: Optional[str] = None


@dataclass
class LLMResponse:
    text: str
    calls: list[CallRecord] = field(default_factory=list)


def chat_json(system: str, user: str) -> LLMResponse:
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
            with urllib.request.urlopen(req, timeout=settings.llm_timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            usage = data.get("usage") or {}
            calls.append(CallRecord(True, time.monotonic() - t0,
                                    usage.get("prompt_tokens"), usage.get("completion_tokens")))
            return LLMResponse(data["choices"][0]["message"]["content"], calls)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            calls.append(CallRecord(False, time.monotonic() - t0, error=last_err))
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            last_err = f"{type(e).__name__}: {e}"
            calls.append(CallRecord(False, time.monotonic() - t0, error=last_err))
        time.sleep(min(2 ** attempt, 8))
    err = LLMError(f"Вызов модели не удался: {last_err}")
    err.calls = calls  # type: ignore[attr-defined]
    raise err


def cost_usd(calls: list[CallRecord]) -> Optional[float]:
    """Стоимость по ВСЕМ вызовам. None, если usage хоть одного успешного вызова неизвестен."""
    total = 0.0
    for c in calls:
        if not c.ok:
            continue  # TODO(A06): уточнить, тарифицирует ли провайдер неуспешные вызовы
        if c.input_tokens is None or c.output_tokens is None:
            return None
        total += (c.input_tokens * settings.llm_price_input_per_m
                  + c.output_tokens * settings.llm_price_output_per_m) / 1_000_000
    return round(total, 6)
