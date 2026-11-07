"""Общий HTTP-клиент на stdlib с корректными сертификатами.

На macOS python.org-сборка Python не видит системные корневые сертификаты
(CERTIFICATE_VERIFY_FAILED), поэтому берём их из certifi.
"""
from __future__ import annotations

import json
import ssl
import urllib.request
from typing import Any, Optional

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    SSL_CONTEXT = ssl.create_default_context()


def get_json(url: str, timeout: int = 60) -> Any:
    with urllib.request.urlopen(url, timeout=timeout, context=SSL_CONTEXT) as r:
        return json.loads(r.read().decode("utf-8"))


def get_raw(url: str, timeout: int = 30, max_bytes: int = 2_000_000) -> tuple[str, bytes]:
    """(content-type, первые max_bytes байт)."""
    req = urllib.request.Request(url, headers={"User-Agent": "cqa-prototype"})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as r:
        return r.headers.get("Content-Type", ""), r.read(max_bytes)


def post_json(url: str, body: dict, headers: Optional[dict] = None, timeout: int = 90) -> Any:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as r:
        return json.loads(r.read().decode("utf-8"))
