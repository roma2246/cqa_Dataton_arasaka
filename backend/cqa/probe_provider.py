"""Проверка стороннего OpenAI-совместимого API (Groq, xAI Grok и др.) БЕЗ изменения рабочих настроек.

Ключ — в .env строкой ALT_LLM_API_KEY=... (в Git не попадает). Провайдер определяется по префиксу:
  gsk_  -> Groq     https://api.groq.com/openai/v1
  xai-  -> xAI Grok https://api.x.ai/v1
  иначе — нужен ALT_LLM_BASE_URL

  cd backend
  ../.venv/bin/python -m cqa.probe_provider                 # список доступных моделей
  ../.venv/bin/python -m cqa.probe_provider --model <id>    # оценить 3 тестовых диалога этой моделью
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from . import http
from .config import ROOT, settings

KNOWN = {"gsk_": ("Groq", "https://api.groq.com/openai/v1"), "xai-": ("xAI Grok", "https://api.x.ai/v1")}
PROBE = ["off-ru-01-good_full", "off-kz-03-id_disclosed", "off-en-09-insult"]


def detect() -> tuple[str, str, str]:
    key = os.getenv("ALT_LLM_API_KEY", "").strip()
    if not key:
        raise SystemExit("Нет ALT_LLM_API_KEY в .env — добавьте строку ALT_LLM_API_KEY=<ключ>")
    for prefix, (name, base) in KNOWN.items():
        if key.startswith(prefix):
            return name, os.getenv("ALT_LLM_BASE_URL") or base, key
    base = os.getenv("ALT_LLM_BASE_URL")
    if not base:
        raise SystemExit("Не узнал провайдера по ключу — укажите ALT_LLM_BASE_URL в .env")
    return "OpenAI-совместимый", base, key


def list_models(base: str, key: str) -> list[str]:
    import urllib.request
    req = urllib.request.Request(base.rstrip("/") + "/models", headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30, context=http.SSL_CONTEXT) as r:
        data = json.loads(r.read().decode("utf-8"))
    return sorted(m.get("id") for m in data.get("data", []))


def probe(base: str, key: str, model: str) -> None:
    from .evaluator import service
    from .importer import parse_response
    from .models import ChecklistDraft
    ts = json.loads((ROOT / "data/testsets/official_synth_v1.json").read_text(encoding="utf-8"))
    chk = ChecklistDraft.model_validate_json((ROOT / "data/checklists/official_v4.json").read_text(encoding="utf-8"))
    convs = {c.conversation_id: c for c in parse_response(ts["dataset"])}
    # временно переключаем настройки ТОЛЬКО в этом процессе
    settings.evaluator_mode, settings.llm_provider = "real", "openai_compat"
    settings.llm_base_url, settings.llm_api_key, settings.llm_model = base, key, model
    settings.llm_fallback_model, settings.llm_context_tokens, settings.calibration = "", 0, False
    ok = tot = 0
    for cid in PROBE:
        t0 = time.monotonic()
        try:
            out = service.evaluate(convs[cid], chk)
        except Exception as e:  # noqa: BLE001
            print(f"  {cid}: ОШИБКА {str(e)[:200]}")
            continue
        got = {r.criterion_id: r for r in out.results}
        for k, e in ts["expected"][cid].items():
            r = got[k]
            hit = r.status == e["status"] and (e["status"] != "applicable" or r.answer in e["answers"])
            ok += hit
            tot += 1
            if not hit:
                print(f"    ✕ {k}: эталон {e.get('answers', e['status'])} → {r.status} {r.answer}")
        toks = [(c.get("input_tokens"), c.get("output_tokens")) for c in out.calls]
        print(f"  {cid}: {time.monotonic() - t0:.1f} с, токены {toks}, стоимость {out.cost_usd}")
    print(f"\nСовпало с эталоном: {ok}/{tot}" + (f" ({100 * ok / tot:.0f}%)" if tot else ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model")
    args = ap.parse_args()
    name, base, key = detect()
    print(f"Провайдер: {name} ({base}), ключ …{key[-4:]}")
    try:
        models = list_models(base, key)
    except Exception as e:  # noqa: BLE001
        print("Ключ не принят или API недоступен:", getattr(e, "code", ""), str(e)[:200])
        return 1
    print(f"Доступно моделей: {len(models)}")
    for m in models:
        print("  -", m)
    if args.model:
        print(f"\nПроба на 3 тестовых диалогах (RU/KZ/EN) моделью {args.model}:")
        probe(base, key, args.model)
    return 0


if __name__ == "__main__":
    sys.exit(main())
