#!/usr/bin/env bash
# Прогон одной итерации: набор для настройки + отложенный набор, затем перерисовка графика.
# Пример: evaluation/run_iteration.sh qwen-dev-v2 qwen-hold-v2 [доп. аргументы run_eval.py]
set -u
cd "$(dirname "$0")/.."
DEV_TAG="$1"; HOLD_TAG="$2"; shift 2
PY=.venv/bin/python
COMMON=(--calibration off --concurrency 2 --db data/eval_qwen.sqlite3)
if [ -n "$DEV_TAG" ] && [ "$DEV_TAG" != "-" ]; then
  "$PY" evaluation/run_eval.py --tag "$DEV_TAG" "${COMMON[@]}" "$@" > "data/$DEV_TAG.log" 2>&1
fi
if [ -n "$HOLD_TAG" ] && [ "$HOLD_TAG" != "-" ]; then
  "$PY" evaluation/run_eval.py --tag "$HOLD_TAG" --testset data/testsets/holdout_v1.json "${COMMON[@]}" "$@" > "data/$HOLD_TAG.log" 2>&1
fi
"$PY" evaluation/progress.py
grep -h "Совпадение" evaluation/reports/"$DEV_TAG".md evaluation/reports/"$HOLD_TAG".md 2>/dev/null || true
