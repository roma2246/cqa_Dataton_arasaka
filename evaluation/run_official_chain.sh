#!/usr/bin/env bash
# Очередь прогонов официального трека (локальная модель, без размышлений).
cd "$(dirname "$0")/.."
R() { LLM_THINK=off .venv/bin/python evaluation/run_eval.py --calibration off --concurrency 2 --db data/eval_qwen.sqlite3 "$@"; }
while pgrep -f "run_eval.py --tag o3-base" >/dev/null; do sleep 20; done
R --tag o3-hold --testset data/testsets/official_holdout_v1.json > data/o3-hold.log 2>&1
R --tag o4-dev  --testset data/testsets/official_synth_v1.json  --checklist data/checklists/official_v4.json > data/o4-dev.log 2>&1
R --tag o4-hold --testset data/testsets/official_holdout_v1.json --checklist data/checklists/official_v4.json > data/o4-hold.log 2>&1
.venv/bin/python evaluation/progress.py iterations_official.json progress_official.html
grep -h "Совпадение" evaluation/reports/o3-base.md evaluation/reports/o3-hold.md evaluation/reports/o4-dev.md evaluation/reports/o4-hold.md || true
