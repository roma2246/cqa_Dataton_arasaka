# CQA — Conversation Quality Analytics (Freedom Broker Hackathon, команда 4)

Прототип: настраиваемый чек-лист → автоматическая оценка оператора (RU/KZ/EN) → доказательства
по репликам → апелляция → решение проверяющего → пересчитанный итог.

**Кто что делает — см. [TEAM_TASKS.md](TEAM_TASKS.md).**

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

Настоящая оценка — **Gemini 3.8 Flash** (выбор команды): в `.env` вписать `LLM_API_KEY`
(ключ из https://aistudio.google.com/apikey) и поставить `EVALUATOR_MODE=real`.
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
Модель: `gemini-3.8-flash` (Google, платный тариф: $0.75 за 1 млн входных и $3.75 за 1 млн выходных токенов,
включая токены размышлений; цены до 31.12.2026). Один вызов на диалог + не более одного повтора при неверном JSON.
_Фактическую среднюю стоимость одной оценки со всеми вызовами заполнить после прогона DEV (A06)._

Важно: на бесплатном тарифе Gemini Google использует данные для улучшения продуктов — для реальных
звонков и транскриптов используйте платный тариф (или согласуйте с организаторами).

## Ограничения
_Заполнить к защите (Q07): что не проверено, что требует звука и т.д._

## Безопасность
Ключи модели, подписанные ссылки API/аудио, реальные транскрипты и БД в репозиторий не коммитим (`.gitignore`).
