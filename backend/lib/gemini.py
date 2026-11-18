import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

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


_BUDGET_ENV = {"search": ("GEMINI_DAILY_SEARCH", 200), "index": ("GEMINI_DAILY_INDEX_ITEMS", 750),
               "other": ("GEMINI_DAILY_OTHER", 200)}
_used: dict[str, int] = {"search": 0, "index": 0, "other": 0}
_QUOTA_TZ = ZoneInfo("America/Los_Angeles")
_used_day = ""
_cooldown_until = 0.0
_last_error = ""


def _limit(bucket: str) -> int:
    name, default = _BUDGET_ENV[bucket]
    return _env_int(name, default)


def _roll_day() -> None:
    global _used_day
    today = datetime.now(_QUOTA_TZ).date().isoformat()
    if today != _used_day:
        _used_day = today
        for k in _used:
            _used[k] = 0


def _spend(bucket: str, units: int = 1) -> bool:
    _roll_day()
    if time.monotonic() < _cooldown_until or _used[bucket] + units > _limit(bucket):
        return False
    _used[bucket] += units
    return True


def budget_left(bucket: str) -> int:
    _roll_day()
    return max(0, _limit(bucket) - _used[bucket])


def cooldown_left() -> float:
    return max(0.0, _cooldown_until - time.monotonic())


def last_error() -> str:
    return _last_error


def _remember(err: str) -> None:
    global _last_error
    _last_error = f"{datetime.now(timezone.utc).strftime('%H:%M UTC')} {err}"[:300]


def usage() -> dict[str, int]:
    _roll_day()
    return {"used": sum(_used.values()), "limit": sum(_limit(b) for b in _BUDGET_ENV)}


async def _post(path: str, body: dict) -> Optional[dict]:
    global _cooldown_until
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{API}/{path}", json=body, headers={"x-goog-api-key": api_key()})
    except httpx.HTTPError as exc:
        logger.warning("gemini request failed: %s", type(exc).__name__)
        _remember(f"network: {type(exc).__name__}")
        return None
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", "")
        except ValueError:
            msg = r.text
        _remember(f"HTTP {r.status_code}: {msg[:220]}")
        if r.status_code == 429:
            _cooldown_until = time.monotonic() + 60
            logger.warning("gemini rate limit hit; pausing AI calls for 60s: %s", msg[:300])
        else:
            logger.warning("gemini returned %s: %s", r.status_code, msg[:300])
        return None
    try:
        return r.json()
    except ValueError:
        return None


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [round(x / n, 5) for x in v]


async def embed(texts: list[str], *, query: bool, bucket: str = "index") -> Optional[list[list[float]]]:
    if not texts or not enabled():
        return None
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        chunk = texts[i:i + EMBED_BATCH]
        if not _spend(bucket, len(chunk)):
            return None
        reqs = [{
            "model": f"models/{embed_model()}",
            "content": {"parts": [{"text": (f"task: search result | query: {t}" if query else f"title: none | text: {t}")}]},
            "output_dimensionality": embed_dim(),
        } for t in chunk]
        data = await _post(f"models/{embed_model()}:batchEmbedContents", {"requests": reqs})
        vecs = [e.get("values") for e in (data or {}).get("embeddings", [])]
        if len(vecs) != len(chunk) or not all(isinstance(v, list) and v for v in vecs):
            _used[bucket] = max(0, _used[bucket] - len(chunk))
            return None
        out.extend(_normalize(v) for v in vecs)
    return out


async def generate_json(prompt: str, schema: dict, system: str = "") -> Optional[Any]:
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
