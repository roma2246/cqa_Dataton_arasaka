# Деплой: Render (сервер) + Neon (PostgreSQL)

**Сейчас:** https://cqa-arasaka.onrender.com (Render, бесплатный тариф, регион Ohio) + Neon `small-lab-73536684`,
ветка `production` (us-east-2). Вход: логин `arasaka`, пароль — в `.env` (`DEPLOY_BASIC_AUTH_PASSWORD`).
Перенос локальных данных в Neon: `cd backend && ../.venv/bin/python -m cqa.migrate_to_pg`.

Бесплатно. Сервер — Docker-образ из `Dockerfile` (FastAPI + интерфейс), база — Neon Postgres через `DATABASE_URL`.
Локально без `DATABASE_URL` всё работает на SQLite, как раньше.

## Один раз
1. **Neon:** `npx neon@9.2.0 init … && npx neon@9.2.0 deploy` — `DATABASE_URL` (пулер, для приложения) и `DATABASE_URL_UNPOOLED` (прямое, для создания таблиц) попадают в `.env`.
2. **Render** (https://render.com): вход через GitHub, доступ к репозиторию; New → Blueprint → этот репозиторий
   (`render.yaml`), заполнить секреты: `DATABASE_URL`, `LLM_API_KEY`, `ORGANIZER_API_URL`, `BASIC_AUTH_PASSWORD`.
3. После деплоя: открыть сайт (логин `arasaka` + пароль) → «Диалоги» → «Загрузить из API» (DEV)
   → выбрать официальный чек-лист → «Оценить показанные».

## Особенности бесплатного Render
- Без запросов 15 минут сервер засыпает; первое открытие после сна — 30–60 с. Перед защитой открыть сайт заранее.
- Если сервер уснёт посреди пакета, при следующем запуске незавершённые оценки продолжатся сами (данные в Postgres).

## Проверка базы
Весь набор тестов на настоящем Postgres (каждому тесту — своя схема, потом удаляется):
```bash
cd backend && TEST_DATABASE_URL='postgresql://…' ../.venv/bin/python -m pytest -q
```
