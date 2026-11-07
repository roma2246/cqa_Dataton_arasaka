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
    status TEXT NOT NULL,             -- queued | running | completed | failed | canceled
    batch_id TEXT,
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
CREATE TABLE IF NOT EXISTS calibration_examples (
    example_id INTEGER PRIMARY KEY AUTOINCREMENT,
    criterion_id TEXT NOT NULL,
    criterion_fingerprint TEXT NOT NULL, -- хеш формулировки критерия: изменили критерий -> старые примеры не применяются
    conversation_id TEXT NOT NULL,
    evaluation_id INTEGER, appeal_id INTEGER UNIQUE,
    excerpt_json TEXT NOT NULL,          -- фрагмент диалога [{message_id, speaker, text}]
    ai_status TEXT, ai_answer TEXT,
    correct_status TEXT NOT NULL, correct_answer TEXT,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,                -- appeal | manual
    active INTEGER NOT NULL DEFAULT 1,
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
        cols = {r["name"] for r in c.execute("PRAGMA table_info(evaluations)")}
        if "batch_id" not in cols:  # миграция БД, созданной до появления пакетов
            c.execute("ALTER TABLE evaluations ADD COLUMN batch_id TEXT")


def unfinished_evaluations() -> list[int]:
    """Оценки, прерванные перезапуском сервера."""
    with tx() as c:
        c.execute("UPDATE evaluations SET status='queued' WHERE status='running'")
        return [r[0] for r in c.execute("SELECT evaluation_id FROM evaluations WHERE status='queued' ORDER BY evaluation_id")]


def claim_evaluation(evaluation_id: int) -> bool:
    """queued -> running атомарно. False, если задачу отменили или уже взяли."""
    with tx() as c:
        cur = c.execute("UPDATE evaluations SET status='running' WHERE evaluation_id=? AND status='queued'",
                        (evaluation_id,))
        return cur.rowcount == 1


def batch_status(batch_id: str) -> dict[str, Any]:
    """Прогресс пакета по ПОСЛЕДНЕЙ попытке для каждого диалога."""
    with tx() as c:
        rows = c.execute(
            """SELECT e.evaluation_id, e.conversation_id, e.status, e.error, e.cost_usd, e.model
               FROM evaluations e
               WHERE e.batch_id=? AND e.evaluation_id = (
                   SELECT MAX(e2.evaluation_id) FROM evaluations e2
                   WHERE e2.batch_id=e.batch_id AND e2.conversation_id=e.conversation_id)
               ORDER BY e.conversation_id""", (batch_id,)).fetchall()
        all_cost = c.execute("SELECT SUM(cost_usd), COUNT(*) FROM evaluations WHERE batch_id=?",
                             (batch_id,)).fetchone()
    items = [dict(r) for r in rows]
    counts: dict[str, int] = {}
    for it in items:
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    return {
        "batch_id": batch_id, "total": len(items), "counts": counts,
        "done": all(i["status"] in ("completed", "failed", "canceled") for i in items),
        "attempts": all_cost[1], "cost_usd": all_cost[0],  # стоимость по всем попыткам, включая повторы
        "failed": [i for i in items if i["status"] == "failed"],
        "items": items,
    }


def cancel_batch(batch_id: str, reason: Optional[str] = None) -> int:
    with tx() as c:
        return c.execute("UPDATE evaluations SET status='canceled', error=?, finished_at=? "
                         "WHERE batch_id=? AND status='queued'", (reason, now(), batch_id)).rowcount


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
                  e.evaluation_id AS last_evaluation_id, e.status AS last_status, e.mode AS last_mode,
                  json_extract(e.final_score_json, '$.total') AS last_total,
                  json_extract(e.final_score_json, '$.critical_error') AS last_critical,
                  (SELECT COUNT(*) FROM appeals a WHERE a.evaluation_id=e.evaluation_id AND a.status='open') AS open_appeals
           FROM conversations c
           LEFT JOIN evaluations e ON e.evaluation_id = (
               SELECT MAX(e2.evaluation_id) FROM evaluations e2 WHERE e2.conversation_id=c.conversation_id)
           WHERE 1=1"""
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

def create_evaluation(conversation_id: str, content_hash: str, version_id: int,
                      batch_id: Optional[str] = None) -> int:
    with tx() as c:
        cur = c.execute(
            "INSERT INTO evaluations (conversation_id, content_hash, checklist_version_id, status, batch_id, created_at) "
            "VALUES (?,?,?,?,?,?)", (conversation_id, content_hash, version_id, "queued", batch_id, now()))
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


# ---------- Калибровка («дообучение» на решениях проверяющего) ----------

def criterion_fingerprint(criterion: Any) -> str:
    import hashlib
    c = criterion if isinstance(criterion, dict) else criterion.model_dump()
    key = json.dumps({"t": c.get("title"), "i": c.get("instruction"), "a": c.get("answer_type"),
                      "o": [o.get("value") if isinstance(o, dict) else o.value for o in c.get("options") or []],
                      "s": c.get("scale")}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def add_calibration_example(**f: Any) -> Optional[int]:
    with tx() as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO calibration_examples (criterion_id, criterion_fingerprint, conversation_id, "
            "evaluation_id, appeal_id, excerpt_json, ai_status, ai_answer, correct_status, correct_answer, reason, "
            "source, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
            (f["criterion_id"], f["criterion_fingerprint"], f["conversation_id"], f.get("evaluation_id"),
             f.get("appeal_id"), json.dumps(f["excerpt"], ensure_ascii=False), f.get("ai_status"), f.get("ai_answer"),
             f["correct_status"], f.get("correct_answer"), f["reason"], f.get("source", "appeal"), now()))
        return cur.lastrowid if cur.rowcount else None


def list_calibration(active_only: bool = False) -> list[dict[str, Any]]:
    q = "SELECT * FROM calibration_examples" + (" WHERE active=1" if active_only else "") + " ORDER BY example_id DESC"
    with tx() as c:
        rows = [dict(r) for r in c.execute(q).fetchall()]
    for r in rows:
        r["excerpt"] = json.loads(r.pop("excerpt_json"))
    return rows


def calibration_for(fingerprints: dict[str, str], exclude_conversation: str, per_criterion: int = 3) -> list[dict[str, Any]]:
    """Активные примеры для критериев с ТОЙ ЖЕ формулировкой; без примеров из оцениваемого диалога."""
    out: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for r in list_calibration(active_only=True):
        cid = r["criterion_id"]
        if fingerprints.get(cid) != r["criterion_fingerprint"] or r["conversation_id"] == exclude_conversation:
            continue
        if counts.get(cid, 0) >= per_criterion:
            continue
        counts[cid] = counts.get(cid, 0) + 1
        out.append(r)
    return out


def set_calibration_active(example_id: int, active: bool) -> bool:
    with tx() as c:
        return c.execute("UPDATE calibration_examples SET active=? WHERE example_id=?",
                         (1 if active else 0, example_id)).rowcount == 1


def list_batches(limit: int = 12) -> list[dict[str, Any]]:
    """Последние пакеты: прогресс по последней попытке на диалог, стоимость, время."""
    with tx() as c:
        ids = [r[0] for r in c.execute(
            "SELECT batch_id FROM evaluations WHERE batch_id IS NOT NULL GROUP BY batch_id "
            "ORDER BY MAX(evaluation_id) DESC LIMIT ?", (limit,)).fetchall()]
        out = []
        for b in ids:
            meta = c.execute("SELECT MIN(created_at) AS started, MAX(finished_at) AS last, "
                             "MAX(checklist_version_id) AS vid FROM evaluations WHERE batch_id=?", (b,)).fetchone()
            ver = c.execute("SELECT body_json, version FROM checklist_versions WHERE version_id=?", (meta["vid"],)).fetchone()
            name = json.loads(ver["body_json"]).get("name", "") if ver else ""
            out.append({"batch_id": b, "started": meta["started"], "last_finished": meta["last"],
                        "checklist": f"v{ver['version']} · {name}" if ver else str(meta["vid"])})
    for item in out:
        st = batch_status(item["batch_id"])
        item.update({k: st[k] for k in ("total", "counts", "done", "cost_usd")})
    return out


def recent_evaluations(limit: int = 15) -> list[dict[str, Any]]:
    with tx() as c:
        rows = c.execute(
            "SELECT evaluation_id, conversation_id, status, model, error, created_at, finished_at, batch_id, "
            "json_extract(final_score_json, '$.total') AS total, json_extract(final_score_json, '$.critical_error') AS critical "
            "FROM evaluations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]
