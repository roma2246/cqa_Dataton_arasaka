"""Сквозной прогон набора одной командой: импорт -> оценка -> повтор упавших -> results.json -> проверка.
Для T+23 (10 контрольных чатов за час) и для DEV. Владелец: Участник 1.

  cd backend
  ../.venv/bin/python -m cqa.pipeline --group <group_id от организаторов> --set prod --expect 10
  ../.venv/bin/python -m cqa.pipeline --group DEV --set dev --expect 65 --skip-done

--skip-done      не переоценивать диалоги, у которых уже есть завершённая оценка этой версией чек-листа
--from-file F    взять набор из JSON-файла (ответ API целиком), если API недоступен
Git-команды скрипт НЕ выполняет — commit/push делает человек (см. docs/PROD_RUNBOOK.md).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import export, http, importer, storage
from .config import ROOT, settings


def fetch(group_id: str) -> dict:
    if not settings.organizer_api_url:
        raise SystemExit("ORGANIZER_API_URL не задан в .env")
    parts = urllib.parse.urlsplit(settings.organizer_api_url)
    qs = dict(urllib.parse.parse_qsl(parts.query))
    qs["group_id"] = group_id
    return http.get_json(urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(qs))), timeout=120)


OFFICIAL_FILE = "data/checklists/official_v5.json"  # официальный чек-лист (CQA_Chat_Quality_Checklist)


def official_version() -> int:
    """Последняя версия официального чек-листа; если файл изменился — сохраняется новая версия."""
    from .models import ChecklistDraft
    draft = ChecklistDraft.model_validate_json((ROOT / OFFICIAL_FILE).read_text(encoding="utf-8"))
    v = next((v for v in storage.list_checklists() if v.checklist_id == draft.checklist_id), None)
    if v and [c.model_dump() for c in v.criteria] == [c.model_dump() for c in draft.criteria]:
        return v.version_id
    return storage.save_checklist(draft).version_id


def done_ids(version_id: int, conv_ids: list[str]) -> set[str]:
    out = set()
    for cid in conv_ids:
        ev = export._latest(cid, version_id)
        if ev and ev["status"] == "completed":
            out.add(cid)
    return out


def run(ids: list[str], version_id: int, batch: str, workers: int) -> None:
    from .main import _run_evaluation  # импорт здесь: не поднимаем FastAPI без нужды
    eids = [storage.create_evaluation(cid, storage.get_conversation(cid).content_hash, version_id, batch) for cid in ids]
    t0 = time.monotonic()
    done = 0

    def one(eid):
        nonlocal done
        _run_evaluation(eid)
        done += 1
        ev = storage.get_evaluation(eid)
        print(f"  [{done}/{len(eids)}] {ev['conversation_id']}: {ev['status']} "
              f"({time.monotonic() - t0:.0f} с)" + (f" — {ev['error'][:120]}" if ev["error"] else ""), flush=True)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(one, eids))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", required=True)
    ap.add_argument("--set", choices=["dev", "prod"], required=True, help="папка results/<set>/")
    ap.add_argument("--expect", type=int)
    ap.add_argument("--workers", type=int, default=settings.batch_concurrency)
    ap.add_argument("--skip-done", action="store_true")
    ap.add_argument("--from-file")
    ap.add_argument("--retries", type=int, default=1, help="сколько раз повторить упавшие")
    args = ap.parse_args()

    storage.init_db()
    t_start = time.monotonic()
    body = json.loads(Path(args.from_file).read_text(encoding="utf-8")) if args.from_file else fetch(args.group)
    convs = importer.parse_response(body, args.group)
    stats = storage.upsert_conversations(convs)
    ids = [c.conversation_id for c in convs]
    print(f"Импорт {args.group}: {len(ids)} диалогов {stats}")
    if args.expect and len(ids) != args.expect:
        print(f"ВНИМАНИЕ: получено {len(ids)}, ожидалось {args.expect}")

    vid = official_version()
    batch = f"{args.set}-{int(time.time())}"
    done = done_ids(vid, ids) if args.skip_done else set()   # один проход, а не на каждый диалог
    todo = [c for c in ids if c not in done]
    print(f"Оцениваем {len(todo)} (модель {settings.llm_model or settings.llm_provider}, потоков {args.workers})")
    if todo:
        run(todo, vid, batch, args.workers)
    for attempt in range(args.retries):
        ok_ids = done_ids(vid, ids)
        failed = [c for c in ids if c not in ok_ids]
        if not failed:
            break
        print(f"Повтор {attempt + 1}: {len(failed)} диалогов")
        run(failed, vid, f"{batch}-retry{attempt + 1}", args.workers)

    out = ROOT / "results" / args.set / "results.json"
    doc = export.build(args.group, vid, settings.team_name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    errs = export.check(doc, set(ids), args.expect)
    ok = sum(r["status"] == "ok" for r in doc["results"])
    print(f"\n{out.relative_to(ROOT)}: {len(doc['results'])} записей — ok {ok}, error {len(doc['results']) - ok}; "
          f"{time.monotonic() - t_start:.0f} с всего")
    for r in doc["results"]:
        if r["status"] == "error":
            print(f"  error {r['conversation_id']}: {r['error'][:140]}")
    print("ПРОВЕРКА ФОРМАТА: OK" if not errs else "ОШИБКИ ФОРМАТА:\n- " + "\n- ".join(errs))
    print("\nДальше вручную: git add results && git commit -m '...' && git push")
    return 0 if not errs else 1


if __name__ == "__main__":
    sys.exit(main())
