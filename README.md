# CQA — Conversation Quality Analytics (Freedom Broker Hackathon, команда 4)

Прототип: настраиваемый чек-лист → автоматическая оценка оператора (RU/KZ/EN) → доказательства
по репликам → апелляция → решение проверяющего → пересчитанный итог.

**Кто что делает — см. [TEAM_TASKS.md](TEAM_TASKS.md).**
**Что сделано и что идёт сейчас — [docs/CHANGELOG.md](docs/CHANGELOG.md); вживую — http://localhost:8000 → «Задачи».**
**Финал (T+23, 10 контрольных чатов) — [docs/PROD_RUNBOOK.md](docs/PROD_RUNBOOK.md).** Сдача: `results/dev/results.json`, `results/prod/results.json`.

## Стек
- Backend: Python 3.12, FastAPI, SQLite (`backend/cqa`)
- Оценщик: OpenAI-совместимый `chat/completions` (`backend/cqa/evaluator`), промпт `backend/prompts`
- Frontend: чистый HTML/CSS/JS без сборки (`frontend/`) — готов к упаковке как HTML web resource Dynamics 365
- UI раздаётся тем же сервером → нет проблем с CORS

## Запуск

```bash
python3 -m venv .venv
```
```bash
.venv/bin/pip install -r backend/requirements.txt
```
```bash
cp .env.example .env
```
```bash
cd backend && ../.venv/bin/uvicorn cqa.main:app --reload --port 8000
```

Открыть http://localhost:8000 → «Импорт»: выбрать файл `data/fixtures/sample_dataset.json`
или загрузить из API организаторов (нужен `ORGANIZER_API_URL` в `.env`).

По умолчанию `EVALUATOR_MODE=mock` — **тестовый** ответ без модели (в UI жёлтая плашка).

Настоящая оценка — два варианта:
- **Локально и бесплатно: Ollama + `qwen3:8b`** — транскрипты не покидают компьютер. Установка: [docs/LOCAL_MODEL.md](docs/LOCAL_MODEL.md).
- **Облако: Gemini 3.6 Flash** (резерв 3.8 Flash) — `LLM_MODEL=gemini-3.6-flash`, `LLM_API_KEY` из https://aistudio.google.com/apikey.

Проверить доступ одним коротким вызовом:

```bash
cd backend && ../.venv/bin/python -m cqa.check_llm
```

Альтернатива — Claude: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `LLM_MODEL` (по умолчанию `claude-opus-5-5`).
После изменения `.env` перезапустите сервер.

## Тесты

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

## Структура

```
backend/cqa/main.py          API (Участник 1)
backend/cqa/audio.py         адаптер записи звонков (Участник 1)
backend/cqa/http.py          HTTP с сертификатами certifi
backend/cqa/storage.py       SQLite, версии, атомарные решения (Участник 1)
backend/cqa/models.py        общий контракт (Участник 1, согласуется всеми)
backend/cqa/evaluator/       модель, промпт, валидация доказательств (Участник 2)
backend/prompts/             тексты промптов (Участник 2)
backend/cqa/scoring.py       калькулятор итога (Участник 4)
backend/cqa/importer.py      импорт набора организаторов (Участник 4)
frontend/                    весь интерфейс (Участник 3)
data/fixtures/               синтетические примеры (НЕ реальные данные)
data/checklists/             официальный чек-лист в JSON (Участник 4, Q01)
evaluation/                  эталоны и compare.py (Участник 4)
docs/API_CONTRACT.md         контракт API
```

## Модель и стоимость
**Основная модель — `gemini-3.6-flash`** (резерв при перегрузке — `gemini-3.5-flash-lite`), бесплатный проект Google AI Studio.
Почему: на официальных тест-сетах с известными ответами — **99%** (152/153) и **100%** (72/72) совпадений,
~3–13 с на диалог (весь DEV ≈ 10 мин). Локальная `qwen3:8b` (Ollama) дала 88% и ~80 с на диалог — запасной вариант
без интернета и без передачи данных (`docs/LOCAL_MODEL.md`).
Стоимость: на бесплатном тарифе — $0 (в отчётах показан эквивалент платного тарифа ≈ $0.011 за оценку).
На бесплатном тарифе Google может использовать запросы для улучшения своих продуктов.

## Ограничения
_Заполнить к защите (Q07): что не проверено, что требует звука и т.д._

## Безопасность
Ключи модели, подписанные ссылки API/аудио, реальные транскрипты и БД в репозиторий не коммитим (`.gitignore`).
