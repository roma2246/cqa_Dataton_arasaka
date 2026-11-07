"""Аудио звонков. Владелец: Участник 1 (B06).

audio_url организаторов — HTML-страница «Воспроизведение записи», а не аудиофайл.
Адаптер скачивает ТОЛЬКО эту страницу из записи диалога (не произвольный адрес от пользователя),
извлекает <source src> регулярным выражением (скрипты страницы не выполняются)
и проверяет, что по ссылке действительно отдаётся audio/*.
"""
from __future__ import annotations

import html
import re
import threading
import time
import urllib.parse
from typing import Any, Optional

from . import http

_SRC_RE = re.compile(r"<(?:source|audio)\b[^>]*?\bsrc\s*=\s*[\"']([^\"']+)[\"']", re.I)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()
TTL_S = 600  # ссылки подписаны и временные — не кешируем надолго


def extract_media_src(page_html: str) -> Optional[str]:
    m = _SRC_RE.search(page_html)
    if not m:
        return None
    src = html.unescape(m.group(1)).strip()
    return src if urllib.parse.urlsplit(src).scheme == "https" else None


def resolve(player_url: str) -> dict[str, Any]:
    """{player_url, media_url|None, media_type|None, error|None}"""
    with _lock:
        hit = _cache.get(player_url)
        if hit and time.monotonic() - hit[0] < TTL_S:
            return hit[1]
    out: dict[str, Any] = {"player_url": player_url, "media_url": None, "media_type": None, "error": None}
    try:
        ctype, body = http.get_raw(player_url, timeout=20, max_bytes=200_000)
        if ctype.startswith("audio/"):  # вдруг организаторы отдадут прямой файл
            out.update(media_url=player_url, media_type=ctype.split(";")[0])
        elif "html" in ctype:
            src = extract_media_src(body.decode("utf-8", "replace"))
            if not src:
                out["error"] = "На странице плеера не найден <source>"
            else:
                mtype, _ = http.get_raw(src, timeout=20, max_bytes=1024)  # проверяем первые байты
                if mtype.startswith("audio/"):
                    out.update(media_url=src, media_type=mtype.split(";")[0])
                else:
                    out["error"] = f"Источник отдаёт {mtype or 'неизвестный тип'}, а не аудио"
        else:
            out["error"] = f"Неожиданный тип страницы: {ctype}"
    except Exception as e:  # noqa: BLE001 - адрес не выводим: в нём подпись
        out["error"] = f"Запись недоступна: {getattr(e, 'code', None) or getattr(e, 'reason', None) or type(e).__name__}"
    with _lock:
        _cache[player_url] = (time.monotonic(), out)
    return out
