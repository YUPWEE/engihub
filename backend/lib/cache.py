"""Tiny in-process cache for public read endpoints.

Each database round trip from Render to Atlas costs ~0.25 s, and the home/catalog/course endpoints need several,
so their results are kept for a short time. The cache is cleared after every successful write request (see the
middleware in server.py), so edits show up immediately; only the anonymous "open"/"helpful" counters skip that
and may lag by up to a TTL. Single process (one Render instance), so a dict is enough."""

import asyncio
import time
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}
_generation = 0  # bumped by clear(); results computed before a clear are not stored


async def get_or_set(key: str, ttl: float, factory: Callable[[], Awaitable[T]]) -> T:
    hit = _store.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:  # concurrent misses for the same key wait for one computation
        hit = _store.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        gen = _generation
        value = await factory()
        if gen == _generation:  # a write during the computation would make this value stale
            _store[key] = (time.monotonic() + ttl, value)
        return value


def clear() -> None:
    global _generation
    _generation += 1
    _store.clear()
