import asyncio
import time
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}
_generation = 0


async def get_or_set(key: str, ttl: float, factory: Callable[[], Awaitable[T]]) -> T:
    hit = _store.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _store.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        gen = _generation
        value = await factory()
        if gen == _generation:
            _store[key] = (time.monotonic() + ttl, value)
        return value


def clear() -> None:
    global _generation
    _generation += 1
    _store.clear()
