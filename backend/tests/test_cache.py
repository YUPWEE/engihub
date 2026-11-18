import os

for k, v in dict(MONGO_URL="mongomock://local", DB_NAME="engihub_test", ADMIN_PASSWORD="pw",
                 ADMIN_TOKEN_SECRET="x" * 32, CORS_ORIGINS="http://test").items():
    os.environ.setdefault(k, v)

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402

from lib import cache, security  # noqa: E402
from lib.db import db  # noqa: E402
from models.schemas import new_id  # noqa: E402
from server import app  # noqa: E402


@pytest_asyncio.fixture
async def api(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    security._buckets.clear()
    cache.clear()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test/api") as c:
            yield c


async def sneak_course(number: str) -> None:
    branch = await db.branches.find_one({"code_en": "MATH"})
    await db.courses.insert_one({"id": new_id(), "branch_id": branch["id"], "number": number,
                                 "name_ar": "", "name_en": f"Sneaky {number}"})


def numbers(catalog: dict) -> set[str]:
    return {c["number"] for c in catalog["courses"]}


async def test_catalog_is_served_from_cache_until_a_write(api):
    first = (await api.get("/catalog")).json()
    await sneak_course("901")
    assert "901" not in numbers((await api.get("/catalog")).json())
    branch = first["branches"][0]["id"]
    r = await api.post("/courses", json={"branch_id": branch, "number": "902", "name_en": "Via API"})
    assert r.status_code == 200
    fresh = numbers((await api.get("/catalog")).json())
    assert {"901", "902"} <= fresh


async def test_counters_do_not_clear_the_cache(api):
    cat = (await api.get("/catalog")).json()
    await sneak_course("903")
    course_id = cat["courses"][0]["id"]
    assert (await api.post(f"/courses/{course_id}/open")).status_code == 200
    assert "903" not in numbers((await api.get("/catalog")).json())


async def test_failed_write_does_not_clear(api):
    await api.get("/catalog")
    await sneak_course("904")
    r = await api.post("/courses", json={"branch_id": "nope", "number": "905", "name_en": "x"})
    assert r.status_code >= 400
    assert "904" not in numbers((await api.get("/catalog")).json())


async def test_course_detail_cached_and_missing_course_not_cached(api):
    cat = (await api.get("/catalog")).json()
    cid = cat["courses"][0]["id"]
    before = (await api.get(f"/courses/{cid}")).json()
    await db.courses.update_one({"id": cid}, {"$set": {"name_en": "Renamed behind the cache"}})
    assert (await api.get(f"/courses/{cid}")).json()["course"]["name_en"] == before["course"]["name_en"]
    assert (await api.get("/courses/missing")).status_code == 404
    assert "course:missing" not in cache._store


async def test_value_computed_across_a_clear_is_not_stored():
    cache.clear()

    async def slow_factory():
        cache.clear()
        return "stale"

    assert await cache.get_or_set("k", 60, slow_factory) == "stale"
    assert "k" not in cache._store

    async def fresh():
        return "fresh"

    assert await cache.get_or_set("k", 60, fresh) == "fresh"
    assert cache._store["k"][1] == "fresh"
