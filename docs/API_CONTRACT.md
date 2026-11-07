# API-контракт (владелец — Участник 1)

Базовый адрес: `http://localhost:8000/api`. Модели — `backend/cqa/models.py`.
Изменения формата объявляются в чате команды **до** правки потребителей (UI, оценщик, калькулятор).

## Состояния

| Поле | Значения | Смысл |
|---|---|---|
| Критерий `status` | `applicable` | применим и оценён |
| | `not_applicable` | N/A разрешён и обоснован правилом |
| | `needs_review` | данных не хватает / ответ модели невалиден |
| Оценка `status` | `queued`, `running`, `completed`, `failed`, `canceled` | состояние задачи; после перезапуска сервера `queued/running` выполняются снова |
| Апелляция `status` | `open`, `confirmed`, `changed` | |

`total: null` ≠ 0. N/A, неполнота и сбой не смешиваются.

## Endpoints

| Метод | Путь | Тело / параметры | Ответ |
|---|---|---|---|
| GET | `/health` | — | `{ok, evaluator_mode, model}` |
| POST | `/import/organizer` | `{group_id}` | `{total, new, updated, unchanged}` |
| POST | `/import/json` | ответ API организаторов целиком | то же |
| GET | `/conversations` | `?language=&channel=&group_id=` | список с `message_count`, `last_evaluation_id` |
| GET | `/conversations/{id}` | — | `Conversation` + `messages[]` + `evaluations[]` |
| GET | `/conversations/{id}/audio` | — | `{player_url, media_url, media_type, error}` — `media_url` только если сервер проверил `audio/*` |
| GET | `/checklists` | — | версии, новые сверху |
| GET | `/checklists/{version_id}` | — | `ChecklistVersion` |
| POST | `/checklists` | `ChecklistDraft` | новая неизменяемая версия |
| POST | `/evaluations` | `{conversation_id, checklist_version_id}` | `{evaluation_id, status:"queued"}` |
| POST | `/evaluations/batch` | `{checklist_version_id, conversation_ids? , group_id?}` | `{batch_id, evaluation_ids[]}` |
| GET | `/batches/{batch_id}` | — | `{total, counts, done, attempts, cost_usd, failed[], items[]}` (по последней попытке на диалог) |
| POST | `/batches/{batch_id}/retry` | — | `{retried, evaluation_ids[]}` — новые попытки только для `failed` |
| POST | `/batches/{batch_id}/cancel` | — | `{canceled}` — отменяет ещё не начатые (`queued` → `canceled`) |
| GET | `/evaluations/{id}` | — | см. ниже |
| POST | `/evaluations/{id}/appeals` | `{criterion_id, comment}` | `{appeal_id, status}` |
| GET | `/appeals` | `?status=open` | список |
| POST | `/appeals/{id}/decision` | `{action: confirm/change, reason, expected_revision, new_status?, new_answer?}` | `{revision, final_score}`; **409** при устаревшей revision или повторном решении |

## Оценка `GET /evaluations/{id}`

```json
{
  "evaluation_id": 1, "conversation_id": "p1-ru-001", "checklist_version_id": 2,
  "status": "completed", "mode": "real|mock", "model": "...", "prompt_version": "evaluate_v1",
  "ai_results":    [CriterionResult],   // исходный ответ ИИ — НЕ меняется
  "ai_score":      ScoreResult,
  "final_results": [CriterionResult],   // после решений проверяющего
  "final_score":   ScoreResult,
  "revision": 0, "cost_usd": 0.0123, "usage": {"calls": [...], "problems": [...]},
  "error": null,
  "appeals": [{appeal_id, criterion_id, comment, status, action, old_*, new_*, decision_reason}]
}
```

## Ответ ИИ — `CriterionResult` (без общего балла)

```json
{"criterion_id": "greeting", "status": "applicable", "answer": "yes",
 "explanation": "Оператор поздоровался в m004.",
 "evidence_message_ids": ["m004"],
 "checked_range": null, "na_reason": null, "review_reason": null}
```

`message_id` = `m001…` по порядку реплик в исходном transcript.
