"""Проверка доступа к модели (A01). Один короткий вызов, ~копейки.

Запуск:  cd backend && ../.venv/bin/python -m cqa.check_llm
"""
from __future__ import annotations

import json
import sys

from .config import settings
from .evaluator import llm_client

SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}, "lang": {"type": "string"}},
    "required": ["ok", "lang"],
    "additionalProperties": False,
}


def main() -> int:
    print(f"Провайдер: {settings.llm_provider}, модель: {settings.llm_model or '(по умолчанию)'}, effort: {settings.llm_effort}")
    try:
        r = llm_client.chat_json(
            "Ответь только JSON по схеме.",
            'Определи язык фразы и верни {"ok": true, "lang": "<код>"}: «Сәлеметсіз бе! Сізге қалай көмектесе аламын?»',
            SCHEMA,
        )
    except llm_client.LLMError as e:
        print("ОШИБКА:", e)
        for c in e.calls:
            print("  вызов:", c.__dict__)
        return 1
    print("Ответ:", r.text)
    try:
        json.loads(r.text)
        print("JSON: корректный")
    except json.JSONDecodeError:
        print("JSON: НЕкорректный")
    for c in r.calls:
        print(f"Вызов: модель={c.model} input={c.input_tokens} output={c.output_tokens} "
              f"время={c.latency_s:.1f}с ok={c.ok} {c.error or ''}")
    cost = llm_client.cost_usd(r.calls)
    print("Стоимость:", "неизвестна (нет usage или цены)" if cost is None else f"${cost:.6f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
