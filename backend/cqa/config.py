"""Настройки из переменных окружения (.env). Секреты в Git не коммитим."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv("CQA_DB_PATH", str(ROOT / "data" / "cqa.sqlite3"))))
    # Ссылка GET организаторов БЕЗ group_id (подписанная ссылка - секрет, только в .env)
    organizer_api_url: str = field(default_factory=lambda: os.getenv("ORGANIZER_API_URL", ""))
    # mock - тестовый ответ (явно помечается в UI); real - настоящая модель
    evaluator_mode: str = field(default_factory=lambda: os.getenv("EVALUATOR_MODE", "mock"))
    llm_base_url: str = field(default_factory=lambda: os.getenv("LLM_BASE_URL", ""))
    llm_api_key: str = field(default_factory=lambda: os.getenv("LLM_API_KEY", ""))
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", ""))
    llm_price_input_per_m: float = field(default_factory=lambda: float(os.getenv("LLM_PRICE_INPUT_PER_M", "0")))
    llm_price_output_per_m: float = field(default_factory=lambda: float(os.getenv("LLM_PRICE_OUTPUT_PER_M", "0")))
    llm_timeout_s: int = field(default_factory=lambda: int(os.getenv("LLM_TIMEOUT_S", "90")))
    llm_max_retries: int = field(default_factory=lambda: int(os.getenv("LLM_MAX_RETRIES", "2")))
    batch_concurrency: int = field(default_factory=lambda: int(os.getenv("BATCH_CONCURRENCY", "4")))


settings = Settings()
