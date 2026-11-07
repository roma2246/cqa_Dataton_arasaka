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
Основная модель — `gemini-3.6-flash`, резервная — `gemini-3.8-flash` (переключение автоматически при 503/429/таймауте).
Цены Google (платный тариф, до 31.12.2026): $0.75 за 1 млн входных и $3.75 за 1 млн выходных токенов,
включая токены размышлений; с 01.01.2027 — вдвое дороже.

Замер 07.11.2026 на 6 диалогах DEV (демо-чек-лист из 4 критериев, effort=medium):
**$0.008–0.012 за одну оценку** со всеми вызовами (≈1.7–7 тыс. входных и 1.7–2.5 тыс. выходных токенов),
3.6 Flash — 8–12 с на диалог; 3.8 Flash — 90–140 с и частые 503/таймауты в момент замера.
Таймаут без ответа не даёт usage — такие попытки в стоимости не учтены (провайдер мог их не тарифицировать).

Важно: на бесплатном тарифе Gemini Google использует данные для улучшения продуктов — для реальных
звонков и транскриптов используйте платный тариф (или согласуйте с организаторами).

## Ограничения
_Заполнить к защите (Q07): что не проверено, что требует звука и т.д._

## Безопасность
Ключи модели, подписанные ссылки API/аудио, реальные транскрипты и БД в репозиторий не коммитим (`.gitignore`).
