# Финал: T+23 → T+24 (10 контрольных чатов за 1 час)

Формат сдачи — «Приложение к студенческому гайду: как сдать результаты» (JSON 1.0).
В корне репозитория: `results/dev/results.json` (65 диалогов DEV) и `results/prod/results.json` (ровно 10 записей).

## Заранее (до T+23)

- [ ] `results/dev/results.json` выгружен, проверен и запушен (см. ниже «DEV»).
- [ ] Ссылка на открытый репозиторий отправлена организаторам; репозиторий открывается без входа.
- [ ] Ollama запущена (`docs/LOCAL_MODEL.md`), `cd backend && ../.venv/bin/python -m cqa.check_llm` отвечает.
- [ ] В `.env`: `EVALUATOR_MODE=real`, `TEAM_NAME` — название команды, `LLM_CONTEXT_TOKENS=12288`.
- [ ] Mac на зарядке, сон отключён на время прогона.

Время на локальной qwen3:8b (Apple M5, 2 потока): ~3–5 мин на диалог с 8 критериями → **10 чатов ≈ 20–25 мин**.
Запас на повтор упавших и push — ~30 мин.

## T+23: одна команда

Организаторы сообщают `group_id` контрольного набора (и, возможно, новую ссылку — тогда обновить `ORGANIZER_API_URL` в `.env`).

```bash
cd backend && ../.venv/bin/python -m cqa.pipeline --group <GROUP_ID> --set prod --expect 10
```

Скрипт: загружает набор через API организаторов (исходные `conversation_id`) → оценивает по официальному
чек-листу → один раз повторяет упавшие → пишет `results/prod/results.json` → проверяет формат
(10 записей, без дублей, все 8 критериев, типы значений, пересчёт итога, `critical_flag`).
В конце должно быть `ПРОВЕРКА ФОРМАТА: OK`.

Если API недоступен, но организаторы дали файл:
```bash
cd backend && ../.venv/bin/python -m cqa.pipeline --group <GROUP_ID> --set prod --expect 10 --from-file /путь/к/файлу.json
```

## Отправка (обязательно push, не только commit)

```bash
git add results/prod/results.json
```
```bash
git commit -m "Результаты контрольного набора"
```
```bash
git push origin main
```
Проверить в браузере, что файл виден в репозитории на GitHub.

## Если что-то пошло не так

| Симптом | Что делать |
|---|---|
| Часть записей `status: "error"` | Это допустимо по правилам (не подменяем нулём). Если есть время — повторить: `--skip-done` переоценит только неготовые |
| `Диалог не помещается в контекст` | Перезапустить Ollama с `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_NUM_PARALLEL=1`, в `.env` `LLM_CONTEXT_TOKENS=16384`, запустить с `--skip-done` |
| Ollama не отвечает | `~/.local/ollama/ollama ps`; перезапуск сервера из `docs/LOCAL_MODEL.md` |
| Не успеваем | За 10 мин до стоп-кода выгрузить то, что есть: `../.venv/bin/python -m cqa.export --group <GROUP_ID> --out ../results/prod/results.json --expect 10` и запушить |

## DEV

Прогон всех 65 (долго, ~2–3 часа локально; можно через UI «Оценить показанные» по официальному чек-листу):
```bash
cd backend && ../.venv/bin/python -m cqa.pipeline --group DEV --set dev --expect 65 --skip-done
```
Только выгрузка уже сделанных оценок (кнопка «results.json ↓» на странице «Диалоги» делает то же):
```bash
cd backend && ../.venv/bin/python -m cqa.export --group DEV --out ../results/dev/results.json --expect 65
```
