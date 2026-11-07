"""SQLite-хранилище. Владелец: Участник 1.

Принципы:
- исходные диалоги сохраняются как есть (raw_json) + нормализованные реплики;
- версии чек-листа НЕИЗМЕНЯЕМЫ: любое сохранение = новая версия;
- оценка хранит снимок ответа ИИ отдельно от решений проверяющего;
- финальный результат = ответ ИИ + решения -> калькулятор.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from .config import settings
from .models import ChecklistDraft, ChecklistVersion, Conversation

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    channel TEXT, language TEXT, audio_url TEXT,
    content_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    timestamp TEXT, speaker TEXT, text TEXT,
    PRIMARY KEY (conversation_id, message_id)
);
CREATE TABLE IF NOT EXISTS checklist_versions (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    body_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (checklist_id, version)
);
CREATE TABLE IF NOT EXISTS evaluations (
    evaluation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    checklist_version_id INTEGER NOT NULL,
    status TEXT NOT NULL,             -- queued | running | completed | failed
    mode TEXT,                        -- mock | real
    model TEXT, prompt_version TEXT,
    ai_results_json TEXT,             -- исходный ответ ИИ (не меняется!)
    ai_score_json TEXT,               -- итог по ответу ИИ
    final_results_json TEXT,          -- после решений проверяющего
    final_score_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    usage_json TEXT, cost_usd REAL,
    error TEXT,
    created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS appeals (
    appeal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    criterion_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    status TEXT NOT NULL,             -- open | confirmed | changed
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
    appeal_id INTEGER NOT NULL UNIQUE, -- одно решение на апелляцию
    action TEXT NOT NULL,
    old_status TEXT, old_answer TEXT,
    new_status TEXT, new_answer TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Короткая транзакция. НЕ держать во время LLM-запроса."""
    with _lock:
        conn = connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def init_db() -> None:
    with tx() as c:
        c.executescript(SCHEMA)


# ---------- Диалоги ----------

def upsert_conversations(items: list[Conversation]) -> dict[str, int]:
    stats = {"new": 0, "unchanged": 0, "updated": 0}
    with tx() as c:
        for conv in items:
            row = c.execute("SELECT content_hash FROM conversations WHERE conversation_id=?",
                            (conv.conversation_id,)).fetchone()
            if row and row["content_hash"] == conv.content_hash:
                stats["unchanged"] += 1
                continue
            stats["updated" if row else "new"] += 1
            c.execute("DELETE FROM messages WHERE conversation_id=?", (conv.conversation_id,))
            c.execute(
                "INSERT OR REPLACE INTO conversations VALUES (?,?,?,?,?,?,?)",
                (conv.conversation_id, conv.group_id, conv.channel, conv.language,
                 conv.audio_url, conv.content_hash, now()),
            )
            c.executemany(
                "INSERT INTO messages VALUES (?,?,?,?,?,?)",
                [(conv.conversation_id, m.message_id, m.index, m.timestamp, m.speaker, m.text)
                 for m in conv.messages],
            )
    return stats


def list_conversations(language: Optional[str] = None, channel: Optional[str] = None,
                       group_id: Optional[str] = None) -> list[dict[str, Any]]:
    q = """SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.conversation_id) AS message_count,
                  (SELECT e.evaluation_id FROM evaluations e WHERE e.conversation_id=c.conversation_id
                   ORDER BY e.evaluation_id DESC LIMIT 1) AS last_evaluation_id
           FROM conversations c WHERE 1=1"""
    args: list[Any] = []
    for col, val in (("language", language), ("channel", channel), ("group_id", group_id)):
        if val:
            q += f" AND c.{col}=?"
            args.append(val)
    q += " ORDER BY c.group_id, c.conversation_id"
    with tx() as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]


def get_conversation(conversation_id: str) -> Optional[Conversation]:
    with tx() as c:
        row = c.execute("SELECT * FROM conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
        if not row:
            return None
        msgs = c.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY idx",
                         (conversation_id,)).fetchall()
    return Conversation(
        conversation_id=row["conversation_id"], group_id=row["group_id"], channel=row["channel"],
        language=row["language"], audio_url=row["audio_url"], content_hash=row["content_hash"],
        messages=[{"message_id": m["message_id"], "index": m["idx"], "timestamp": m["timestamp"],
                   "speaker": m["speaker"], "text": m["text"]} for m in msgs],
    )


# ---------- Чек-листы ----------

def save_checklist(draft: ChecklistDraft) -> ChecklistVersion:
    with tx() as c:
        row = c.execute("SELECT MAX(version) AS v FROM checklist_versions WHERE checklist_id=?",
                        (draft.checklist_id,)).fetchone()
        version = (row["v"] or 0) + 1
        created = now()
        cur = c.execute(
            "INSERT INTO checklist_versions (checklist_id, version, body_json, created_at) VALUES (?,?,?,?)",
            (draft.checklist_id, version, draft.model_dump_json(), created),
        )
        vid = cur.lastrowid
    return ChecklistVersion(**draft.model_dump(), version_id=vid, version=version, created_at=created)


def _row_to_checklist(r: sqlite3.Row) -> ChecklistVersion:
    return ChecklistVersion(**json.loads(r["body_json"]), version_id=r["version_id"],
                            version=r["version"], created_at=r["created_at"])


def list_checklists() -> list[ChecklistVersion]:
    with tx() as c:
        rows = c.execute("SELECT * FROM checklist_versions ORDER BY version_id DESC").fetchall()
    return [_row_to_checklist(r) for r in rows]


def get_checklist(version_id: int) -> Optional[ChecklistVersion]:
    with tx() as c:
        r = c.execute("SELECT * FROM checklist_versions WHERE version_id=?", (version_id,)).fetchone()
    return _row_to_checklist(r) if r else None


# ---------- Оценки ----------

def create_evaluation(conversation_id: str, content_hash: str, version_id: int) -> int:
    with tx() as c:
        cur = c.execute(
            "INSERT INTO evaluations (conversation_id, content_hash, checklist_version_id, status, created_at) "
            "VALUES (?,?,?,?,?)", (conversation_id, content_hash, version_id, "queued", now()))
        return cur.lastrowid


def update_evaluation(evaluation_id: int, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with tx() as c:
        c.execute(f"UPDATE evaluations SET {cols} WHERE evaluation_id=?", (*fields.values(), evaluation_id))


def get_evaluation(evaluation_id: int) -> Optional[dict[str, Any]]:
    with tx() as c:
        r = c.execute("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,)).fetchone()
        if not r:
            return None
        appeals = c.execute(
            """SELECT a.*, d.action, d.old_status, d.old_answer, d.new_status, d.new_answer,
                      d.reason AS decision_reason, d.created_at AS decided_at
               FROM appeals a LEFT JOIN decisions d ON d.appeal_id=a.appeal_id
               WHERE a.evaluation_id=? ORDER BY a.appeal_id""", (evaluation_id,)).fetchall()
    out = dict(r)
    for k in ("ai_results_json", "ai_score_json", "final_results_json", "final_score_json", "usage_json"):
        out[k.removesuffix("_json")] = json.loads(out.pop(k)) if out.get(k) else None
    out["appeals"] = [dict(a) for a in appeals]
    return out


def list_evaluations(conversation_id: str) -> list[dict[str, Any]]:
    with tx() as c:
        rows = c.execute(
            "SELECT evaluation_id, checklist_version_id, status, mode, model, created_at, revision "
            "FROM evaluations WHERE conversation_id=? ORDER BY evaluation_id DESC", (conversation_id,)).fetchall()
    return [dict(r) for r in rows]


# ---------- Апелляции ----------

def create_appeal(evaluation_id: int, criterion_id: str, comment: str) -> int:
    with tx() as c:
        cur = c.execute(
            "INSERT INTO appeals (evaluation_id, criterion_id, comment, status, created_at) VALUES (?,?,?,?,?)",
            (evaluation_id, criterion_id, comment, "open", now()))
        return cur.lastrowid


def list_appeals(status: Optional[str] = None) -> list[dict[str, Any]]:
    q = """SELECT a.*, e.conversation_id, e.revision FROM appeals a
           JOIN evaluations e ON e.evaluation_id=a.evaluation_id"""
    args: list[Any] = []
    if status:
        q += " WHERE a.status=?"
        args.append(status)
    q += " ORDER BY a.appeal_id DESC"
    with tx() as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]


def get_appeal(appeal_id: int) -> Optional[dict[str, Any]]:
    with tx() as c:
        r = c.execute("SELECT * FROM appeals WHERE appeal_id=?", (appeal_id,)).fetchone()
    return dict(r) if r else None


class RevisionConflict(Exception):
    pass


class AlreadyDecided(Exception):
    pass


def save_decision_atomic(appeal_id: int, evaluation_id: int, expected_revision: int,
                         decision: dict[str, Any], final_results: list[dict], final_score: dict) -> int:
    """Решение + новый итог + revision+1 в ОДНОЙ транзакции."""
    with tx() as c:
        ev = c.execute("SELECT revision FROM evaluations WHERE evaluation_id=?", (evaluation_id,)).fetchone()
        if ev["revision"] != expected_revision:
            raise RevisionConflict(f"Ожидалась revision {expected_revision}, текущая {ev['revision']}")
        if c.execute("SELECT 1 FROM decisions WHERE appeal_id=?", (appeal_id,)).fetchone():
            raise AlreadyDecided("По этой апелляции решение уже принято")
        c.execute(
            "INSERT INTO decisions (appeal_id, action, old_status, old_answer, new_status, new_answer, reason, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (appeal_id, decision["action"], decision.get("old_status"), decision.get("old_answer"),
             decision.get("new_status"), decision.get("new_answer"), decision["reason"], now()))
        c.execute("UPDATE appeals SET status=? WHERE appeal_id=?",
                  ("confirmed" if decision["action"] == "confirm" else "changed", appeal_id))
        c.execute(
            "UPDATE evaluations SET final_results_json=?, final_score_json=?, revision=revision+1 WHERE evaluation_id=?",
            (json.dumps(final_results, ensure_ascii=False), json.dumps(final_score, ensure_ascii=False), evaluation_id))
        return expected_revision + 1
