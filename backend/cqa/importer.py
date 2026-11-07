"""Импорт набора организаторов. Владелец: Участник 4.

Вход - ответ API организаторов:
  {"isSuccess": true, "error": "", "data": {"dataset_group_id": "DEV", "records": [...]}}
Выход - список Conversation с стабильными message_id (m001, m002, ...),
исходными timestamp/speaker/text и хешем содержимого.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .models import Conversation, Message

VALID_SPEAKERS = {"client", "operator", "bot", "system"}


class ImportError_(ValueError):
    """Понятная ошибка формата."""


def content_hash(record: dict[str, Any]) -> str:
    payload = json.dumps(
        {k: record.get(k) for k in ("conversation_id", "channel", "language", "transcript", "audio_url")},
        ensure_ascii=False, sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_response(body: dict[str, Any], group_id: str | None = None) -> list[Conversation]:
    if not body.get("isSuccess", False):
        raise ImportError_(f"API вернул ошибку: {body.get('error') or 'isSuccess=false'}")
    data = body.get("data") or {}
    records = data.get("records")
    if not isinstance(records, list):
        raise ImportError_("Нет data.records в ответе")
    gid = group_id or data.get("dataset_group_id") or "UNKNOWN"
    return [parse_record(r, gid) for r in records]


def parse_record(rec: dict[str, Any], group_id: str) -> Conversation:
    cid = rec.get("conversation_id")
    if not cid:
        raise ImportError_("Запись без conversation_id")
    transcript = rec.get("transcript")
    if isinstance(transcript, str):  # на случай, если придёт строкой
        transcript = json.loads(transcript)
    if not isinstance(transcript, list):
        raise ImportError_(f"{cid}: transcript не массив")

    messages: list[Message] = []
    for i, m in enumerate(transcript):
        speaker = m.get("speaker")
        if speaker not in VALID_SPEAKERS:
            raise ImportError_(f"{cid}: неизвестная роль '{speaker}' в реплике {i}")
        messages.append(Message(
            message_id=f"m{i + 1:03d}",
            index=i,
            timestamp=str(m.get("timestamp", "")),
            speaker=speaker,
            text=str(m.get("text", "")),
        ))

    return Conversation(
        conversation_id=cid,
        group_id=group_id,
        channel=rec.get("channel", ""),
        language=rec.get("language", ""),
        audio_url=rec.get("audio_url"),
        content_hash=content_hash(rec),
        messages=messages,
    )
