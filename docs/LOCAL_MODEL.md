# Локальная модель (Ollama) — бесплатно и без отправки данных наружу

Оценщик работает с любым OpenAI-совместимым сервером. Локально — через Ollama и модель **Qwen3 8B**.
Транскрипты не покидают компьютер, лимитов и оплаты нет. Минусы: медленнее облака (~30–60 с на диалог
на Apple M-серии), качество на казахском нужно проверять тест-сетом.

Проверено на Apple M5 / 16 ГБ: Ollama v0.40.15, `qwen3:8b` (5.2 ГБ).

## 1. Установка (macOS, без Homebrew)

```bash
mkdir -p ~/.local/ollama
```
```bash
cd ~/.local/ollama && curl -sSLO https://github.com/ollama/ollama/releases/download/v0.40.15/ollama-darwin.tgz && curl -sSLO https://github.com/ollama/ollama/releases/download/v0.40.15/sha256sum.txt
```
Сверить контрольную сумму (строки должны совпасть):
```bash
cd ~/.local/ollama && grep ollama-darwin.tgz sha256sum.txt && shasum -a 256 ollama-darwin.tgz
```
```bash
cd ~/.local/ollama && tar -xzf ollama-darwin.tgz && rm ollama-darwin.tgz
```
На Windows/Linux — установщик с https://ollama.com/download.

## 2. Запуск сервера

Контекст по умолчанию у Ollama маленький — длинный транскрипт был бы молча обрезан. Самый длинный звонок DEV (115 реплик) = 6.3 тыс. токенов промпта + ~2 тыс. ответа, поэтому 12 тыс. (на 16 ГБ памяти больше 2×12k не ставить):
```bash
OLLAMA_CONTEXT_LENGTH=12288 OLLAMA_NUM_PARALLEL=2 OLLAMA_HOST=127.0.0.1:11434 ~/.local/ollama/ollama serve
```

## 3. Модель

```bash
~/.local/ollama/ollama pull qwen3:8b
```

## 4. Настройка `.env`

```
EVALUATOR_MODE=real
LLM_PROVIDER=openai_compat
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:8b
LLM_FALLBACK_MODEL=
LLM_API_KEY=
LLM_TIMEOUT_S=600
LLM_CONTEXT_TOKENS=12288
BATCH_CONCURRENCY=2
```
Стоимость локальных вызовов учитывается как **$0** (а не «неизвестна»). Ключ не нужен.

Проверка:
```bash
cd backend && ../.venv/bin/python -m cqa.check_llm
```

## 5. Прогон тест-сета

```bash
.venv/bin/python evaluation/run_eval.py --tag qwen-base --calibration off --concurrency 2 --db data/eval_qwen.sqlite3
```
`--concurrency` не больше `OLLAMA_NUM_PARALLEL`.
