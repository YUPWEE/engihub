import json
import os

for k, v in dict(MONGO_URL="mongomock://local", DB_NAME="engihub_test", ADMIN_PASSWORD="pw",
                 ADMIN_TOKEN_SECRET="x" * 32, CORS_ORIGINS="http://test").items():
    os.environ.setdefault(k, v)

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402

from lib import cache, security, translations  # noqa: E402
from lib.db import db  # noqa: E402
from models.schemas import Resource, new_id  # noqa: E402
from server import app  # noqa: E402

DATA = {
    "titles": {"النهائية 47-1": "Final 47-1", "ملخص": "Summary"},
    "sections": {"النهائية": "Final", "شرائح د. فلان": "Dr. Fulan's slides"},
    "courses": {"ريض 106": "Integral Calculus (EN test)"},
    "branches": {"ريض": {"set": {"name_en": "Mathematics EN"}, "if": {"name_en": "PLACEHOLDER"}}},
}


@pytest_asyncio.fixture
async def api(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(translations, "_data", lambda: DATA)
    security._buckets.clear()
    cache.clear()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test/api") as c:
            await db.resources.delete_many({})
            yield c


async def add(title: str, section: str = "", **extra) -> str:
    course = await db.courses.find_one({})
    r = Resource(course_id=course["id"], title=title, type="exams", kind="link", url=f"https://x.org/{new_id()}",
                 source="other", section=section, **extra)
    await db.resources.insert_one(r.model_dump())
    return r.id


async def test_apply_fills_titles_and_composes_sections(api):
    a = await add("النهائية 47-1", "شرائح د. فلان / النهائية")
    b = await add("Already English", "Mid 1")
    c = await add("عنوان غير معروف", "مجلد غير معروف / النهائية")
    await translations.apply()
    ra, rb, rc = [await db.resources.find_one({"id": i}) for i in (a, b, c)]
    assert ra["title_en"] == "Final 47-1" and ra["section_en"] == "Dr. Fulan's slides / Final"
    assert not rb.get("title_en") and not rb.get("section_en")
    assert not rc.get("title_en") and not rc.get("section_en")


async def test_apply_never_overrides_admin_edits(api):
    i = await add("ملخص", title_en="Hand-written English")
    await translations.apply()
    assert (await db.resources.find_one({"id": i}))["title_en"] == "Hand-written English"


async def test_course_and_branch_names_only_replace_placeholders(api):
    branch = await db.branches.find_one({"code_ar": "ريض"})
    course = await db.courses.find_one({"branch_id": branch["id"], "number": "106"})
    await db.courses.update_one({"id": course["id"]}, {"$set": {"name_en": ""}})
    await db.branches.update_one({"id": branch["id"]}, {"$set": {"name_en": "PLACEHOLDER"}})
    await translations.apply()
    assert (await db.courses.find_one({"id": course["id"]}))["name_en"] == "Integral Calculus (EN test)"
    assert (await db.branches.find_one({"id": branch["id"]}))["name_en"] == "Mathematics EN"
    await db.branches.update_one({"id": branch["id"]}, {"$set": {"name_en": "Mathematics"}})
    await translations.apply()
    assert (await db.branches.find_one({"id": branch["id"]}))["name_en"] == "Mathematics"


async def test_new_uploads_and_imports_get_english(api):
    course = (await api.get("/catalog")).json()["courses"][0]
    r = await api.post("/resources", data={"course_id": course["id"], "title": "ملخص", "type": "summaries",
                                           "kind": "link", "url": "https://example.com/s"})
    assert r.status_code == 200 and r.json()["title_en"] == "Summary"
    assert (await api.post("/admin/login", json={"password": "pw"})).status_code == 200
    csv = ("code,name_ar,name_en,type,title,url,has_solutions,section\n"
           "ريض 106,,,exams,النهائية 47-1,https://example.com/f,1,النهائية\n")
    assert (await api.post("/admin/import-resources", json={"csv": csv})).json()["resources_created"] == 1
    doc = await db.resources.find_one({"url": "https://example.com/f"})
    assert doc["title_en"] == "Final 47-1" and doc["section_en"] == "Final"


async def test_admin_can_set_english_title(api):
    assert (await api.post("/admin/login", json={"password": "pw"})).status_code == 200
    i = await add("ملخص")
    body = {"title": "ملخص", "title_en": "My English title", "type": "exams", "has_solutions": False,
            "description": "", "url": None}
    r = await api.patch(f"/admin/resources/{i}", json=body)
    assert r.status_code == 200 and r.json()["title_en"] == "My English title"


def test_shipped_translation_file_is_valid():
    data = json.loads(translations.DATA.read_text(encoding="utf-8"))
    assert {"titles", "sections", "courses", "branches"} <= set(data)
    arabic = lambda s: any("؀" <= ch <= "ۿ" for ch in s)  # noqa: E731
    assert data["titles"] and not [v for v in data["titles"].values() if arabic(v) or not v.strip()]
    assert not [v for v in data["sections"].values() if arabic(v) or not v.strip()]
