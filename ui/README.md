# CQA UI (React)

Интерфейс CQA на React + TypeScript + Tailwind. Заменяет `frontend/` (vanilla JS) и работает по контракту `backend/cqa/models.py`.
Сборка — статические HTML/CSS/JS с относительными путями и hash-маршрутами, поэтому её можно раздавать с FastAPI
и упаковать как HTML web resource Dynamics 365.

## Запуск

```bash
npm install
npm run dev        # UI на :5173, запросы → http://localhost:8000/api (по API_CONTRACT.md)
npm run dev:mock   # демо без бэкенда: данные в браузере, тестовый оценщик
```

Адрес API — `VITE_API_BASE` (по умолчанию `http://localhost:8000/api`).

**CORS.** UI на :5173 и API на :8000 — разные origin. Варианты:
- в `main.py` добавить `CORSMiddleware` с `allow_origins=["http://localhost:5173"]` (Участник 1);
- или `VITE_API_BASE=/api npm run dev` — запросы пойдут через прокси Vite, CORS не нужен;
- в сборке, которую раздаёт сам FastAPI, задать `VITE_API_BASE=/api` при `npm run build`.

## Сборка

```bash
npm run build      # проверка типов + сборка в dist/
```

`dist/` раздаёт FastAPI вместо `frontend/`. Пример для `main.py` (Участник 1):

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory=ROOT / "ui" / "dist", html=True), name="ui")  # после всех /api-маршрутов
```

## Связь с API (docs/API_CONTRACT.md)

Все вызовы — в `src/api/http.ts`; там же сырые ответы приводятся к типам UI (`src/api/types.ts`).
При изменении контракта правится только этот файл.

| UI | Endpoint | Заметки |
|---|---|---|
| Список | `GET /conversations` + `GET /evaluations/{last_evaluation_id}` | в списке нет итогов — подтягиваются последние оценки (до 6 запросов параллельно). Поле с итогом в списке сэкономило бы запросы |
| Карточка | `GET /conversations/{id}`, `GET /evaluations/{id}`, `GET /conversations/{id}/audio` | `ai_results`/`ai_score` — исходник ИИ, `final_results`/`final_score` — после решений; изменённое проверяющим ИИ-значение показывается зачёркнутым |
| Новый запуск | `POST /evaluations` | ответ `{evaluation_id}` → опрос `GET /evaluations/{id}` |
| Апелляция | `POST /evaluations/{id}/appeals` | |
| Решение | `POST /appeals/{id}/decision` с `expected_revision` | **409** → уведомление + «Оценка уже изменилась» с кнопкой «Обновить»; после обновления можно решить заново |
| Очередь апелляций | `GET /appeals?status=open`, `GET /appeals` | `confirmed`/`changed` показываются как «решённые»; детали — из `GET /evaluations/{id}` |
| Пакет | `POST /evaluations/batch`, `GET /batches/{id}`, `/retry`, `/cancel` | `BatchProgress` опрашивает каждые 1,5 с, пока есть `queued/running`; показывает `done / total`, `cost_usd`, `attempts`, ошибки `failed[]` |
| Чек-лист | `GET /checklists`, `POST /checklists` | сервер отдаёт новые сверху — UI сортирует по версии |
| Импорт | `POST /import/organizer`, `POST /import/json` | |

Предположения о полях, которых нет в контракте явно (если иначе — поправить `http.ts`):
- в `appeals[]` оценки: `old_status`/`old_answer`, `new_status`/`new_answer`, `decision_reason`; итог до/после не приходит — карточка показывает `ai_score` → `final_score`;
- `usage.calls[]`: токены берутся из `input_tokens`/`prompt_tokens` и `output_tokens`/`completion_tokens`, время — из `duration_ms`/`latency_ms`;
- `GET /batches/{id}` не отдаёт версию чек-листа — UI запоминает её при запуске пакета;
- `items[]` пакета: `{conversation_id, evaluation_id, status}`, `failed[]` — id диалогов или `{conversation_id, error}`.

## Как устроено

```
src/api/types.ts        контракт: зеркало models.py + ответы API
src/api/http.ts         настоящий API (таблица ROUTES)
src/api/mock/           демо-бэкенд: данные, очередь, апелляции с revision/409, пакеты, импорт
src/lib/format.ts       подписи RU, форматирование, null → «—» (никогда не 0)
src/components/ui.tsx   кнопки, чипы, поля, кольцо итога, модальное окно
src/views/Dialogues.tsx список, фильтры, импорт, пакетная оценка
src/views/card/         карточка: транскрипт ↔ оценка, доказательства, апелляция и решение
src/views/Checklist.tsx редактор: секции, правила, типы ответа, шкалы, N/A, грубые ошибки, версии
src/views/Appeals.tsx   очередь апелляций: спорная оценка, комментарий, фрагмент диалога, решение
```

Цвета — семантические токены в `src/index.css` (светлая и тёмная тема). В компонентах только `bg-surface`, `text-fg-2`, `text-ok` и т. п.

## Что проверено (в демо-режиме, в браузере)

- Список → карточка; бот, оператор, клиент и система различаются цветом, формой и подписью.
- «Показать в диалоге» и клик по реплике подсвечивают доказательство и прокручивают к нему. Пропущенное действие показывает проверенный участок.
- N/A — отдельный бейдж с причиной, вне знаменателя. «Нужна проверка» → итог «—» с причиной, а не 0.
- Грубая ошибка отмечается в критерии и в итоге.
- Апелляция (роль «Пользователь») → решение (роль «Проверяющий») с обязательной причиной и `expected_revision`.
  Карточка показывает ИИ / Проверяющий / Причина / Итог до→после; исходник ИИ сохранён.
- Чек-лист: новый критерий → «Сохранить версию» → «Применить к диалогам» → пакет по новой версии. Старые оценки не меняются.
- Импорт файла организаторов; светлая и тёмная тема; узкий экран.

## Ограничения

- Проверено против заглушки, повторяющей API_CONTRACT.md (включая 409 и пакет с повтором), но не против настоящего `main.py`. Первый прогон на нём — сверить поля из списка выше.
- `src/api/mock/scoring.ts` — упрощённый калькулятор только для демо. В реальном режиме итог приходит с сервера (`scoring.py`).
- Демо-данные синтетические, демо-чек-лист не официальный.
