"""Каждый тест — на своей временной БД, без сети и без рабочей data/cqa.sqlite3.

TEST_DATABASE_URL=postgresql://... — прогнать тот же набор на PostgreSQL: каждому тесту своя схема,
после теста схема удаляется.
"""
import os
import uuid

import pytest

from cqa import storage
from cqa.config import settings

PG = os.getenv("TEST_DATABASE_URL", "")


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", tmp_path / "test.sqlite3")
    monkeypatch.setattr(settings, "database_url", PG)
    monkeypatch.setattr(settings, "database_url_unpooled", PG)
    schema = f"t_{uuid.uuid4().hex[:10]}" if PG else ""
    monkeypatch.setattr(settings, "db_schema", schema)
    monkeypatch.setattr(settings, "evaluator_mode", "mock")
    monkeypatch.setattr(settings, "calibration", True)
    monkeypatch.setattr(settings, "llm_think", True)
    monkeypatch.setattr(settings, "llm_context_tokens", 0)
    storage.init_db()
    yield
    if PG:
        import psycopg
        with psycopg.connect(PG, autocommit=True) as c:
            c.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
