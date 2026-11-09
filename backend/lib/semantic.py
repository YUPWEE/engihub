"""Meaning-based search: courses and resources are embedded with Gemini, kept in the `embeddings` collection,
and compared with the embedded query. No AI key, or any API failure -> search() returns None and the site's
normal keyword search carries on alone."""

import asyncio
import hashlib
import logging
import os
from collections import OrderedDict
from typing import Optional

from lib import gemini
from lib.db import db

logger = logging.getLogger(__name__)

_lock = asyncio.Lock()
_pending: Optional[asyncio.Task] = None
_vectors: Optional[list[tuple[str, list[float]]]] = None  # [("c:<id>" | "r:<id>", unit vector)]
_query_cache: "OrderedDict[str, list[float]]" = OrderedDict()


def _min_score() -> float:
    try:
        return float(os.environ.get("SEARCH_MIN_SCORE", "") or 0.35)
    except ValueError:
        return 0.35


async def _wanted() -> dict[str, str]:
    """key -> the text that represents it."""
    branches = {b["id"]: b for b in await db.branches.find({}, {"_id": 0}).to_list(1000)}
    courses = {c["id"]: c for c in await db.courses.find({}, {"_id": 0}).to_list(20000)}

    def course_text(c: dict) -> str:
        b = branches.get(c["branch_id"], {})
        return (f"{b.get('code_ar', '')} {c['number']} / {b.get('code_en', '')} {c['number']}. "
                f"{c.get('name_ar', '')}. {c.get('name_en', '')}. {b.get('name_ar', '')} {b.get('name_en', '')}")

    out = {f"c:{cid}": course_text(c) for cid, c in courses.items()}
    for r in await db.resources.find({}, {"_id": 0}).to_list(100000):
        c = courses.get(r["course_id"])
        if not c:
            continue
        out[f"r:{r['id']}"] = (f"{r['title']}. {r.get('description', '')}. type: {r['type']}. "
                               f"course: {course_text(c)}")
    return out


def _hash(text: str) -> str:
    return hashlib.sha1(f"{gemini.embed_model()}:{gemini.embed_dim()}:{text}".encode()).hexdigest()


async def sync() -> dict[str, int]:
    """Bring stored embeddings in line with the catalog: embed what is new or changed, drop what is gone."""
    global _vectors
    if not gemini.enabled():
        return {"embedded": 0, "removed": 0, "total": 0}
    async with _lock:
        wanted = await _wanted()
        have = {d["_id"]: d["h"] for d in await db.embeddings.find({}, {"h": 1}).to_list(200000)}
        gone = [k for k in have if k not in wanted]
        if gone:
            await db.embeddings.delete_many({"_id": {"$in": gone}})
        stale = [k for k, text in wanted.items() if have.get(k) != _hash(text)]
        done = 0
        for i in range(0, len(stale), gemini.EMBED_BATCH):
            keys = stale[i:i + gemini.EMBED_BATCH]
            vecs = await gemini.embed([wanted[k] for k in keys], query=False)
            if vecs is None:
                logger.warning("embedding sync stopped early (%d of %d done)", done, len(stale))
                break
            for k, v in zip(keys, vecs):
                await db.embeddings.update_one({"_id": k}, {"$set": {"h": _hash(wanted[k]), "v": v}}, upsert=True)
            done += len(keys)
        _vectors = None
        return {"embedded": done, "removed": len(gone), "total": len(wanted)}


def schedule_sync(delay: float = 5.0) -> None:
    """Re-sync soon, coalescing bursts of edits into one run. Safe to call from any request."""
    global _pending
    if not gemini.enabled() or (_pending is not None and not _pending.done()):
        return

    async def run() -> None:
        global _pending
        try:
            await asyncio.sleep(delay)
            await sync()
        except Exception as exc:  # background job: never crash the app
            logger.error("embedding sync failed: %s", exc)

    _pending = asyncio.create_task(run())


async def status() -> dict:
    wanted = await db.courses.count_documents({}) + await db.resources.count_documents({})
    return {
        "enabled": gemini.enabled(), "indexed": await db.embeddings.count_documents({}), "total": wanted,
        "text_model": gemini.text_model(), "embed_model": gemini.embed_model(), **{
            f"calls_{k}": v for k, v in gemini.usage().items()},
    }


async def _load() -> list[tuple[str, list[float]]]:
    global _vectors
    if _vectors is None:
        _vectors = [(d["_id"], d["v"]) for d in await db.embeddings.find({}, {"v": 1}).to_list(200000)]
    return _vectors


def _rank(items: list[tuple[str, list[float]]], q: list[float]) -> list[tuple[str, float]]:
    return sorted(((k, sum(a * b for a, b in zip(v, q))) for k, v in items), key=lambda t: -t[1])


async def search(query: str, max_courses: int = 5, max_resources: int = 8) -> Optional[tuple[list[str], list[str]]]:
    """(course ids, resource ids) ranked by meaning, or None when AI search is unavailable."""
    q = " ".join(query.split())[:200]
    if not gemini.enabled() or len(q) < 2:
        return None
    key = q.lower()
    qvec = _query_cache.get(key)
    if qvec is None:
        res = await gemini.embed([q], query=True, bucket="search")
        if not res:
            return None
        qvec = res[0]
        _query_cache[key] = qvec
        while len(_query_cache) > 256:
            _query_cache.popitem(last=False)
    items = await _load()
    if not items:
        return None
    ranked = await asyncio.to_thread(_rank, items, qvec)
    # Keep only clear matches: above an absolute floor and close to the best hit of the same kind.
    courses, resources = [], []
    for kind, bucket, cap in (("c:", courses, max_courses), ("r:", resources, max_resources)):
        of_kind = [(k, s) for k, s in ranked if k.startswith(kind)]
        if not of_kind:
            continue
        top = of_kind[0][1]
        bucket.extend(k[2:] for k, s in of_kind[:cap] if s >= _min_score() and s >= top - 0.12)
    return courses, resources
