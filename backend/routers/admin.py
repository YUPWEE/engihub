"""Admin endpoints. Every route verifies the signed httpOnly admin cookie server-side."""

import asyncio
import csv
import io
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib import storage
from lib.catalog import (
    aware, branch_map, courses_by_ids, get_course_doc, match_branch, to_course, to_resource, to_session,
    validate_course_fields,
)
from lib.db import db
from lib.linkcheck import check_all
from lib.security import (
    ADMIN_COOKIE, ADMIN_TTL_SECONDS, global_hit, global_limited, is_admin, make_admin_token, password_ok,
    peek_limited, rate_limit, require_admin,
)
from lib.textnorm import detect_source, is_personal_contact, norm_number, split_code, valid_https
from models.schemas import (
    AdminCounts, AdminLogin, AdminMe, AdminOverview, Branch, BranchIn, Course, CourseUpdate, ImportIn,
    ImportResourcesResult, ImportResult, OkOut, Report, ReportOut, Resource, ResourceType, ResourceUpdate,
    ResourceWithCourse, StorageInfo, SiteSettings, StudySession, StudySessionUpdate, new_id,
)

router = APIRouter(prefix="/admin")
guarded = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])

FAIL_LIMIT, FAIL_WINDOW = 5, 900
GLOBAL_FAIL_LIMIT = 30


# ---------- session ----------
@router.post("/login", response_model=AdminMe)
async def login(body: AdminLogin, request: Request, response: Response):
    # Per-client limit, plus a global cap so rotating addresses can't brute-force the password.
    if peek_limited(request, "admin_fail", FAIL_LIMIT, FAIL_WINDOW) or global_limited("admin_fail", GLOBAL_FAIL_LIMIT, FAIL_WINDOW):
        raise HTTPException(status_code=429, detail="rate_limited")
    if not password_ok(body.password):
        rate_limit(request, "admin_fail", FAIL_LIMIT + 1, FAIL_WINDOW)
        global_hit("admin_fail", FAIL_WINDOW)
        await asyncio.sleep(0.5)
        raise HTTPException(status_code=401, detail="bad_password")
    response.set_cookie(ADMIN_COOKIE, make_admin_token(), max_age=ADMIN_TTL_SECONDS, httponly=True,
                        secure=True, samesite="strict", path="/api")
    return AdminMe(admin=True)


@router.post("/logout", response_model=AdminMe)
async def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE, path="/api", secure=True, httponly=True, samesite="strict")
    return AdminMe(admin=False)


@router.get("/me", response_model=AdminMe)
async def me(request: Request):
    return AdminMe(admin=is_admin(request))


# ---------- overview ----------
@guarded.get("/overview", response_model=AdminOverview)
async def overview():
    reports = [Report(**aware(d)) for d in await db.reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)]
    res_ids = [r.target_id for r in reports if r.target_type == "resource"]
    ses_ids = [r.target_id for r in reports if r.target_type == "session"]
    rdocs = {d["id"]: d for d in await db.resources.find({"id": {"$in": res_ids}}, {"_id": 0}).to_list(5000)}
    sdocs = {d["id"]: d for d in await db.sessions.find({"id": {"$in": ses_ids}}, {"_id": 0}).to_list(5000)}

    broken_docs = await db.resources.find(
        {"kind": "link", "$or": [{"link_status": "broken"}, {"reported_broken": True}]}, {"_id": 0}
    ).to_list(5000)
    course_ids = {d["course_id"] for d in [*rdocs.values(), *sdocs.values(), *broken_docs]}
    courses = await courses_by_ids(list(course_ids))

    out: list[ReportOut] = []
    for r in reports:
        target = rdocs.get(r.target_id) if r.target_type == "resource" else sdocs.get(r.target_id)
        title = (target or {}).get("title") or (target or {}).get("name") or "—"
        cid = (target or {}).get("course_id")
        out.append(ReportOut(**r.model_dump(), target_title=title, course_id=cid,
                             course_code=courses[cid].code_ar if cid in courses else ""))
    broken = [ResourceWithCourse(resource=to_resource(d), course=courses[d["course_id"]])
              for d in broken_docs if d["course_id"] in courses]
    counts = AdminCounts(
        branches=await db.branches.count_documents({}), courses=await db.courses.count_documents({}),
        resources=await db.resources.count_documents({}), sessions=await db.sessions.count_documents({}),
    )
    storage_info = StorageInfo(used_bytes=await storage.used_bytes(), quota_bytes=storage.quota_bytes())
    return AdminOverview(reports=out, broken=broken, storage=storage_info, counts=counts)


async def _refresh_flags(target_type: str, target_id: str) -> None:
    remaining = await db.reports.find({"target_type": target_type, "target_id": target_id}, {"_id": 0, "reason": 1}).to_list(1000)
    coll = db.resources if target_type == "resource" else db.sessions
    upd = {"flagged": bool(remaining)}
    if target_type == "resource":
        upd["reported_broken"] = any(r["reason"] == "broken" for r in remaining)
    await coll.update_one({"id": target_id}, {"$set": upd})


@guarded.delete("/reports/{report_id}", response_model=OkOut)
async def clear_report(report_id: str):
    doc = await db.reports.find_one_and_delete({"id": report_id})
    if not doc:
        raise HTTPException(status_code=404, detail="report_not_found")
    await _refresh_flags(doc["target_type"], doc["target_id"])
    return OkOut()


@guarded.delete("/reports", response_model=OkOut)
async def clear_all_reports():
    await db.reports.delete_many({})
    await db.resources.update_many({}, {"$set": {"flagged": False, "reported_broken": False}})
    await db.sessions.update_many({}, {"$set": {"flagged": False}})
    return OkOut()


@guarded.post("/check-links", response_model=OkOut)
async def trigger_link_check():
    asyncio.create_task(check_all())
    return OkOut()


# ---------- resources ----------
async def _delete_resource_docs(query: dict) -> None:
    docs = await db.resources.find(query, {"_id": 0, "id": 1, "file_name": 1}).to_list(100000)
    for d in docs:
        await storage.delete_file(d.get("file_name"))
    ids = [d["id"] for d in docs]
    await db.resources.delete_many({"id": {"$in": ids}})
    await db.reports.delete_many({"target_type": "resource", "target_id": {"$in": ids}})


@guarded.patch("/resources/{resource_id}", response_model=Resource)
async def update_resource(resource_id: str, body: ResourceUpdate):
    doc = await db.resources.find_one({"id": resource_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="resource_not_found")
    upd = {"title": body.title.strip(), "type": body.type, "description": body.description.strip(),
           "has_solutions": body.has_solutions and body.type == "exams"}
    if doc["kind"] == "link" and body.url is not None and body.url.strip() != doc.get("url"):
        url = body.url.strip()
        if is_personal_contact(url):
            raise HTTPException(status_code=400, detail="contact_link_not_allowed")
        if not valid_https(url):
            raise HTTPException(status_code=400, detail="invalid_url")
        upd.update(url=url, source=detect_source(url), link_status="unknown", reported_broken=False)
    await db.resources.update_one({"id": resource_id}, {"$set": upd})
    return to_resource({**doc, **upd})


@guarded.delete("/resources/{resource_id}", response_model=OkOut)
async def delete_resource(resource_id: str):
    if not await db.resources.find_one({"id": resource_id}):
        raise HTTPException(status_code=404, detail="resource_not_found")
    await _delete_resource_docs({"id": resource_id})
    return OkOut()


# ---------- sessions ----------
@guarded.patch("/sessions/{session_id}", response_model=StudySession)
async def update_session(session_id: str, body: StudySessionUpdate):
    doc = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="session_not_found")
    contact = body.contact_url.strip()
    if contact and not valid_https(contact):
        raise HTTPException(status_code=400, detail="invalid_url")
    upd = {"name": body.name.strip(), "description": body.description.strip(),
           "specialization": body.specialization.strip(), "contact_url": contact or None}
    await db.sessions.update_one({"id": session_id}, {"$set": upd})
    return to_session({**doc, **upd})


@guarded.delete("/sessions/{session_id}", response_model=OkOut)
async def delete_session(session_id: str):
    res = await db.sessions.delete_one({"id": session_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="session_not_found")
    await db.reports.delete_many({"target_type": "session", "target_id": session_id})
    return OkOut()


# ---------- courses ----------
@guarded.patch("/courses/{course_id}", response_model=Course)
async def update_course(course_id: str, body: CourseUpdate):
    doc = await get_course_doc(course_id)
    num = await validate_course_fields(body.branch_id, body.number, body.name_ar, body.name_en, exclude_id=course_id)
    upd = {"branch_id": body.branch_id, "number": num, "name_ar": body.name_ar.strip(), "name_en": body.name_en.strip()}
    await db.courses.update_one({"id": course_id}, {"$set": upd})
    return to_course({**doc, **upd}, await branch_map())


@guarded.delete("/courses/{course_id}", response_model=OkOut)
async def delete_course(course_id: str):
    await get_course_doc(course_id)
    await _delete_resource_docs({"course_id": course_id})
    ses_ids = [d["id"] for d in await db.sessions.find({"course_id": course_id}, {"_id": 0, "id": 1}).to_list(10000)]
    await db.sessions.delete_many({"course_id": course_id})
    await db.reports.delete_many({"target_type": "session", "target_id": {"$in": ses_ids}})
    await db.events.delete_many({"target_id": course_id})
    await db.courses.delete_one({"id": course_id})
    return OkOut()


# ---------- branches ----------
async def _branch_conflict(body: BranchIn, exclude_id: str | None = None) -> None:
    q: dict = {"$or": [{"code_ar": body.code_ar.strip()}, {"code_en": body.code_en.strip()}]}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    if await db.branches.find_one(q):
        raise HTTPException(status_code=409, detail="duplicate_branch")


@guarded.post("/branches", response_model=Branch)
async def create_branch(body: BranchIn):
    await _branch_conflict(body)
    if body.order == 0:
        body.order = await db.branches.count_documents({})
    b = Branch(**{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()})
    await db.branches.insert_one(b.model_dump())
    return b


@guarded.patch("/branches/{branch_id}", response_model=Branch)
async def update_branch(branch_id: str, body: BranchIn):
    if not await db.branches.find_one({"id": branch_id}):
        raise HTTPException(status_code=404, detail="branch_not_found")
    await _branch_conflict(body, exclude_id=branch_id)
    upd = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()}
    await db.branches.update_one({"id": branch_id}, {"$set": upd})
    return Branch(id=branch_id, **upd)


@guarded.delete("/branches/{branch_id}", response_model=OkOut)
async def delete_branch(branch_id: str):
    if await db.courses.count_documents({"branch_id": branch_id}) > 0:
        raise HTTPException(status_code=409, detail="branch_not_empty")
    res = await db.branches.delete_one({"id": branch_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="branch_not_found")
    return OkOut()


# ---------- import / export ----------
@guarded.post("/import-courses", response_model=ImportResult)
async def import_courses(body: ImportIn):
    branches = await branch_map()
    rows = list(csv.reader(io.StringIO(body.csv.lstrip("\ufeff"))))
    if rows and rows[0] and rows[0][0].strip().lower() in ("code", "course_code", "رمز"):
        rows = rows[1:]
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=1):
        if not any(c.strip() for c in row):
            continue
        code, name_ar, name_en, branch_tok = (row + ["", "", "", ""])[:4]
        prefix, number = split_code(code)
        branch = match_branch(branch_tok, branches) if branch_tok.strip() else None
        branch = branch or match_branch(prefix, branches)
        if not branch:
            errors.append(f"row {i}: unknown branch '{branch_tok or prefix}'")
            continue
        try:
            num = await validate_course_fields(branch.id, number, name_ar, name_en)
        except HTTPException as exc:
            if exc.detail == "duplicate_course":
                skipped += 1
            else:
                errors.append(f"row {i}: {exc.detail}")
            continue
        await db.courses.insert_one({"id": new_id(), "branch_id": branch.id, "number": num,
                                     "name_ar": name_ar.strip(), "name_en": name_en.strip()})
        created += 1
    return ImportResult(created=created, skipped=skipped, errors=errors[:100])


@guarded.post("/import-resources", response_model=ImportResourcesResult)
async def import_resources(body: ImportIn):
    """Bulk-add external links. CSV columns: code, name_ar, name_en, type, title, url (header row optional).
    Missing courses are created (name falls back to the code, editable later); a link already present on its
    course is skipped, so re-uploading the same file is safe."""
    branches = await branch_map()
    rows = list(csv.reader(io.StringIO(body.csv.lstrip("﻿"))))
    if rows and rows[0] and rows[0][0].strip().lower() in ("code", "course_code", "رمز"):
        rows = rows[1:]
    types = set(get_args(ResourceType))
    courses_created = resources_created = skipped = 0
    errors: list[str] = []
    for i, row in enumerate(rows, start=1):
        if not any(c.strip() for c in row):
            continue
        code, name_ar, name_en, rtype, title, url = ([c.strip() for c in row] + [""] * 6)[:6]
        prefix, number = split_code(code)
        branch = match_branch(prefix, branches)
        if not branch:
            errors.append(f"row {i}: unknown branch '{prefix}' (create it under Branches first)")
            continue
        num = norm_number(number)
        title = title.strip()
        if not title or len(title) > 200:
            errors.append(f"row {i}: title missing or longer than 200 characters")
            continue
        if is_personal_contact(url) or not valid_https(url):
            errors.append(f"row {i}: invalid or non-https link")
            continue
        course = await db.courses.find_one({"branch_id": branch.id, "number": num}, {"_id": 0})
        if not course:
            try:
                await validate_course_fields(branch.id, number, name_ar or code, name_en)
            except HTTPException as exc:
                errors.append(f"row {i}: {exc.detail}")
                continue
            course = {"id": new_id(), "branch_id": branch.id, "number": num, "name_ar": (name_ar or code).strip(),
                      "name_en": name_en.strip()}
            await db.courses.insert_one(dict(course))
            courses_created += 1
        if await db.resources.find_one({"course_id": course["id"], "url": url}):
            skipped += 1
            continue
        res = Resource(course_id=course["id"], title=title, type=rtype.lower() if rtype.lower() in types else "other",
                       kind="link", url=url, source=detect_source(url), link_status="unknown")
        await db.resources.insert_one(res.model_dump())
        resources_created += 1
    return ImportResourcesResult(courses_created=courses_created, resources_created=resources_created,
                                 skipped=skipped, errors=errors[:100])


@guarded.get("/export")
async def export_backup():
    async def dump(name: str) -> list[dict]:
        return await db[name].find({}, {"_id": 0}).to_list(200000)

    data = {name: await dump(name) for name in ("branches", "courses", "resources", "sessions", "reports", "events")}
    import json
    body = json.dumps({"app": "EngiHub", "version": 1, **data}, ensure_ascii=False, default=str, indent=1)
    return Response(body, media_type="application/json", headers={
        "Content-Disposition": 'attachment; filename="engihub-backup.json"', "Cache-Control": "no-store",
    })


# ---------- public site settings ----------
@guarded.put("/settings", response_model=SiteSettings)
async def update_settings(body: SiteSettings):
    url = body.contact_url.strip()
    if not valid_https(url):
        raise HTTPException(status_code=400, detail="invalid_url")
    await db.settings.update_one({"_id": "site"}, {"$set": {"contact_url": url}}, upsert=True)
    return SiteSettings(contact_url=url)
