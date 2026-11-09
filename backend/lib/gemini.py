"""Thin client for the Gemini REST API (free tier).

Everything here degrades to "no AI": with no GEMINI_API_KEY, over the daily budget, or on any API error the
functions return None and callers carry on without AI. The key only ever travels in a request header."""

import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)
API = "https://generativelanguage.googleapis.com/v1beta"
EMBED_BATCH = 50


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def api_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "").strip()


def enabled() -> bool:
    return bool(api_key())


def text_model() -> str:
    return os.environ.get("GEMINI_TEXT_MODEL", "").strip() or "gemini-3.5-flash-lite"


def embed_model() -> str:
    return os.environ.get("GEMINI_EMBED_MODEL", "").strip() or "gemini-embedding-2"


def embed_dim() -> int:
    return max(128, min(3072, _env_int("GEMINI_EMBED_DIM", 384)))


# ---------- budget: stay well inside the free quota; resets each UTC day and on restart ----------
_BUDGET_ENV = {"search": ("GEMINI_DAILY_SEARCH", 300), "other": ("GEMINI_DAILY_OTHER", 200)}
_used: dict[str, int] = {"search": 0, "other": 0}
_used_day = ""
_cooldown_until = 0.0  # set after a 429 so we stop hammering


def _limit(bucket: str) -> int:
    name, default = _BUDGET_ENV[bucket]
    return _env_int(name, default)


def _roll_day() -> None:
    global _used_day
    today = datetime.now(timezone.utc).date().isoformat()
    if today != _used_day:
        _used_day = today
        _used.update(search=0, other=0)


def _spend(bucket: str) -> bool:
    _roll_day()
    if time.monotonic() < _cooldown_until or _used[bucket] >= _limit(bucket):
        return False
    _used[bucket] += 1
    return True


def usage() -> dict[str, int]:
    _roll_day()
    return {"used": sum(_used.values()), "limit": sum(_limit(b) for b in _BUDGET_ENV)}


async def _post(path: str, body: dict) -> Optional[dict]:
    """POST to the API; None on any failure. Tests replace this function."""
    global _cooldown_until
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{API}/{path}", json=body, headers={"x-goog-api-key": api_key()})
    except httpx.HTTPError as exc:
        logger.warning("gemini request failed: %s", type(exc).__name__)
        return None
    if r.status_code == 429:
        _cooldown_until = time.monotonic() + 60
        logger.warning("gemini rate limit hit; pausing AI calls for 60s")
        return None
    if r.status_code != 200:
        logger.warning("gemini returned %s: %s", r.status_code, r.text[:300])
        return None
    try:
        return r.json()
    except ValueError:
        return None


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [round(x / n, 5) for x in v]


async def embed(texts: list[str], *, query: bool, bucket: str = "other") -> Optional[list[list[float]]]:
    """Unit-length embedding vectors, one per text (None if AI is unavailable). `gemini-embedding-2` takes no
    task_type, so the task is stated in a text prefix instead."""
    if not texts or not enabled():
        return None
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        chunk = texts[i:i + EMBED_BATCH]
        if not _spend(bucket):
            return None
        reqs = [{
            "model": f"models/{embed_model()}",
            "content": {"parts": [{"text": (f"task: search result | query: {t}" if query else f"title: none | text: {t}")}]},
            "output_dimensionality": embed_dim(),
        } for t in chunk]
        data = await _post(f"models/{embed_model()}:batchEmbedContents", {"requests": reqs})
        vecs = [e.get("values") for e in (data or {}).get("embeddings", [])]
        if len(vecs) != len(chunk) or not all(isinstance(v, list) and v for v in vecs):
            return None
        out.extend(_normalize(v) for v in vecs)
    return out


async def generate_json(prompt: str, schema: dict, system: str = "") -> Optional[Any]:
    """One structured-output call to the text model; the parsed JSON, or None."""
    if not enabled() or not _spend("other"):
        return None
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    data = await _post(f"models/{text_model()}:generateContent", body)
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]  # type: ignore[index]
        return json.loads(text)
    except (TypeError, KeyError, IndexError, ValueError):
        return None
