"""Перенос локальной SQLite (data/cqa.sqlite3) в PostgreSQL (DATABASE_URL), с сохранением ID.
Повторный запуск безопасен: существующие строки не дублируются.

  cd backend && ../.venv/bin/python -m cqa.migrate_to_pg [--sqlite ../data/cqa.sqlite3]
"""
from __future__ import annotations

import argparse
import sqlite3

import psycopg

from . import storage
from .config import settings

TABLES = [  # (таблица, конфликтный ключ, колонка-последовательность)
    ("conversations", "conversation_id", None),
    ("messages", "conversation_id, message_id", None),
    ("checklist_versions", "version_id", "version_id"),
    ("evaluations", "evaluation_id", "evaluation_id"),
    ("appeals", "appeal_id", "appeal_id"),
    ("decisions", "decision_id", "decision_id"),
    ("calibration_examples", "example_id", "example_id"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", default=str(settings.db_path))
    args = ap.parse_args()
    if not storage.is_pg():
        raise SystemExit("DATABASE_URL не задан — переносить некуда")
    storage.init_db()  # таблицы в Postgres (по прямому соединению)
    src = sqlite3.connect(args.sqlite)
    src.row_factory = sqlite3.Row
    url = settings.database_url_unpooled or settings.database_url
    with psycopg.connect(url) as dst:
        for table, key, seq in TABLES:
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                print(f"{table}: пусто")
                continue
            cols = rows[0].keys()
            sql = (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
                   f"ON CONFLICT ({key}) DO NOTHING")
            with dst.cursor() as cur:
                cur.executemany(sql, [tuple(r) for r in rows])
            if seq:
                dst.execute(f"SELECT setval(pg_get_serial_sequence('{table}', '{seq}'), "
                            f"GREATEST((SELECT COALESCE(MAX({seq}), 0) FROM {table}), 1))")
            n = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"{table}: из SQLite {len(rows)}, в Postgres теперь {n}")
        dst.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
