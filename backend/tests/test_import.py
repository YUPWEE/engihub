"""In-process tests for the bulk link importer (mongomock, no server needed).

Run serially:  python -m pytest tests/test_import.py -n 0"""

import os

for k, v in dict(MONGO_URL="mongomock://local", DB_NAME="engihub_test", ADMIN_PASSWORD="pw",
                 ADMIN_TOKEN_SECRET="x" * 32, CORS_ORIGINS="http://test").items():
    os.environ.setdefault(k, v)  # shared with test_ai.py when both run in one process

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402

from lib.db import db  # noqa: E402
from server import app  # noqa: E402

HEADER = "code,name_ar,name_en,type,title,url,has_solutions,section,description\n"


@pytest_asyncio.fixture
async def admin(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test/api") as c:
            await db.resources.delete_many({})
            assert (await c.post("/admin/login", json={"password": "pw"})).status_code == 200
            yield c


async def test_import_sets_section_solutions_and_is_idempotent(admin):
    csv = HEADER + (
        "ريض 106,,,exams,47-1 (محلول),https://drive.google.com/file/d/a/view,1,النهائية,\n"
        "ريض 106,,,slides,Lecture 1,https://drive.google.com/file/d/b/view,1,شرائح د. س,\n"  # solutions only for exams
        "ريض 106,,,bogus,Plan,https://drive.google.com/file/d/c/view,,,\n"  # unknown type -> other
        "ريض 106,,,exams,dup,https://drive.google.com/file/d/a/view,,,\n"  # same url in same file -> skipped
        "زيف 999,,,exams,x,https://drive.google.com/file/d/z/view,,,\n"  # unknown branch -> error
    )
    out = (await admin.post("/admin/import-resources", json={"csv": csv})).json()
    assert out["resources_created"] == 3 and out["skipped"] == 1 and len(out["errors"]) == 1
    docs = {d["title"]: d for d in await db.resources.find({}, {"_id": 0}).to_list(10)}
    assert docs["47-1 (محلول)"]["section"] == "النهائية" and docs["47-1 (محلول)"]["has_solutions"] is True
    assert docs["Lecture 1"]["has_solutions"] is False and docs["Plan"]["type"] == "other"
    again = (await admin.post("/admin/import-resources", json={"csv": csv})).json()
    assert again["resources_created"] == 0 and again["skipped"] == 4


async def test_old_six_column_csv_still_works(admin):
    csv = "code,name_ar,name_en,type,title,url\nريض 106,,,notes,Old style,https://drive.google.com/file/d/o/view\n"
    out = (await admin.post("/admin/import-resources", json={"csv": csv})).json()
    assert out["resources_created"] == 1
    doc = await db.resources.find_one({"title": "Old style"})
    assert doc["section"] == "" and doc["description"] == ""


async def test_editing_a_resource_keeps_its_section(admin):
    csv = HEADER + "ريض 106,,,exams,47-2,https://drive.google.com/file/d/e/view,,النهائية,\n"
    await admin.post("/admin/import-resources", json={"csv": csv})
    doc = await db.resources.find_one({"title": "47-2"})
    body = {"title": "47-2 renamed", "type": "exams", "has_solutions": False, "description": "", "url": doc["url"]}
    r = await admin.patch(f"/admin/resources/{doc['id']}", json=body)
    assert r.status_code == 200 and r.json()["section"] == "النهائية"
    r = await admin.patch(f"/admin/resources/{doc['id']}", json={**body, "section": "بديل"})
    assert r.json()["section"] == "بديل"
