"""Каждый тест — на своей временной БД, без сети и без рабочей data/cqa.sqlite3."""
import pytest

from cqa import storage
from cqa.config import settings


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", tmp_path / "test.sqlite3")
    monkeypatch.setattr(settings, "evaluator_mode", "mock")
    monkeypatch.setattr(settings, "calibration", True)
    storage.init_db()
    yield
