from datetime import date, timedelta
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import RedirectResponse, Response

import asyncio

from lib import cache, gemini, moderation, semantic, storage, translations
from lib.catalog import (
    branch_map, courses_by_ids, get_course_doc, resource_counts, to_course, to_resource, to_session,
    validate_course_fields,
)
from lib.dates import today_iso
from lib.db import db
from lib.security import check_honeypot, rate_limit
from lib.textnorm import detect_source, is_personal_contact, valid_https
from models.schemas import (
    Catalog, Course, CourseDetail, CourseIn, HelpfulOut, HomeStats, OkOut, PublicSettings, Report, ReportIn,
    Resource, ResourceType, ResourceWithCourse, SearchOut, StudySession, StudySessionIn, TopCourse, new_id,
)

router = APIRouter()

DEFAULT_CONTACT_URL = "https://t.me/+48Hwr9MjRHU2ODM0"


async def get_site_settings() -> PublicSettings:
    doc = await db.settings.find_one({"_id": "site"}) or {}
    return PublicSettings(contact_url=doc.get("contact_url") or DEFAULT_CONTACT_URL, ai_search=gemini.enabled())


@router.get("/settings", response_model=PublicSettings)
async def read_settings():
    return await cache.get_or_set("settings", 300, get_site_settings)

ADD_LIMIT, ADD_WINDOW = 12, 600


async def log_event(kind: str, target_id: str) -> None:
    await db.events.update_one(
        {"kind": kind, "target_id": target_id, "day": today_iso()}, {"$inc": {"count": 1}}, upsert=True
    )


def week_start() -> str:
    return (date.fromisoformat(today_iso()) - timedelta(days=6)).isoformat()


async def top_events(kind: str, limit: int) -> list[tuple[str, int]]:
    rows = await db.events.aggregate([
        {"$match": {"kind": kind, "day": {"$gte": week_start()}}},
        {"$group": {"_id": "$target_id", "n": {"$sum": "$count"}}},
        {"$sort": {"n": -1}},
        {"$limit": limit * 2},
    ]).to_list(limit * 2)
    return [(r["_id"], r["n"]) for r in rows]


@router.get("/catalog", response_model=Catalog)
async def catalog():
    return await cache.get_or_set("catalog", 60, _catalog)


async def _catalog() -> Catalog:
    branches, docs, counts = await asyncio.gather(
        branch_map(), db.courses.find({}, {"_id": 0}).to_list(20000), resource_counts()
    )
    order = {bid: b.order for bid, b in branches.items()}
    docs.sort(key=lambda d: (order.get(d["branch_id"], 999), d["number"]))
    return Catalog(
        branches=list(branches.values()),
        courses=[to_course(d, branches, counts.get(d["id"], 0)) for d in docs],
    )


@router.get("/home", response_model=HomeStats)
async def home_stats():
    return await cache.get_or_set("home", 60, _home_stats)


async def _home_stats() -> HomeStats:
    top, top_res = await asyncio.gather(top_events("open", 8), top_events("download", 8))
    courses, rdocs = await asyncio.gather(
        courses_by_ids([cid for cid, _ in top]),
        db.resources.find({"id": {"$in": [rid for rid, _ in top_res]}}, {"_id": 0}).to_list(50),
    )
    top_courses = [TopCourse(course=courses[cid], count=n) for cid, n in top if cid in courses][:8]
    fallback = not top_courses
    if fallback:
        catalog_ = await catalog()
        ranked = sorted(catalog_.courses, key=lambda c: -c.resource_count)[:6]
        top_courses = [TopCourse(course=c, count=0) for c in ranked]

    rmap = {d["id"]: to_resource(d) for d in rdocs}
    rcourses = await courses_by_ids(list({r.course_id for r in rmap.values()}))
    top_resources = [
        ResourceWithCourse(resource=rmap[rid], course=rcourses[rmap[rid].course_id], count=n)
        for rid, n in top_res if rid in rmap and rmap[rid].course_id in rcourses
    ][:8]
    return HomeStats(top_courses=top_courses, top_courses_fallback=fallback, top_resources=top_resources)


@router.get("/search", response_model=SearchOut)
async def ai_search(request: Request, q: str = Query("", max_length=200)):
    if not gemini.enabled() or len(q.strip()) < 2:
        return SearchOut(ai=False)
    rate_limit(request, "search", 40, 600)
    found = await semantic.search(q)
    if found is None:
        return SearchOut(ai=False)
    course_ids, resource_ids = found
    rdocs = {d["id"]: d for d in await db.resources.find({"id": {"$in": resource_ids}}, {"_id": 0}).to_list(50)}
    wanted_courses = list({*course_ids, *(d["course_id"] for d in rdocs.values())})
    courses = await courses_by_ids(wanted_courses)
    return SearchOut(
        ai=True,
        courses=[courses[c] for c in course_ids if c in courses],
        resources=[ResourceWithCourse(resource=to_resource(rdocs[r]), course=courses[rdocs[r]["course_id"]])
                   for r in resource_ids if r in rdocs and rdocs[r]["course_id"] in courses],
    )


@router.get("/courses/{course_id}", response_model=CourseDetail)
async def course_detail(course_id: str):
    return await cache.get_or_set(f"course:{course_id}", 30, lambda: _course_detail(course_id))


async def _course_detail(course_id: str) -> CourseDetail:
    doc, branches, rdocs, sdocs = await asyncio.gather(
        get_course_doc(course_id),
        branch_map(),
        db.resources.find({"course_id": course_id}, {"_id": 0}).to_list(5000),
        db.sessions.find({"course_id": course_id}, {"_id": 0}).sort("created_at", -1).to_list(1000),
    )
    resources = [to_resource(d) for d in rdocs]
    sessions = [to_session(d) for d in sdocs]
    branch = branches.get(doc["branch_id"])
    if not branch:
        raise HTTPException(status_code=404, detail="branch_not_found")
    return CourseDetail(course=to_course(doc, branches, len(resources)), branch=branch,
                        resources=resources, sessions=sessions)


@router.post("/courses/{course_id}/open", response_model=OkOut)
async def course_open(course_id: str, request: Request):
    rate_limit(request, "open", 120, 600)
    await get_course_doc(course_id)
    await log_event("open", course_id)
    return OkOut()


@router.post("/courses", response_model=Course)
async def create_course(body: CourseIn, request: Request):
    check_honeypot(body.website)
    rate_limit(request, "add", ADD_LIMIT, ADD_WINDOW)
    num = await validate_course_fields(body.branch_id, body.number, body.name_ar, body.name_en)
    doc = {"id": new_id(), "branch_id": body.branch_id, "number": num,
           "name_ar": body.name_ar.strip(), "name_en": body.name_en.strip()}
    await db.courses.insert_one(dict(doc))
    semantic.schedule_sync()
    return to_course(doc, await branch_map())


@router.post("/resources", response_model=Resource)
async def create_resource(
    request: Request,
    background: BackgroundTasks,
    course_id: str = Form(...),
    title: str = Form(..., min_length=1, max_length=200),
    type: ResourceType = Form(...),
    kind: Literal["pdf", "link"] = Form(...),
    has_solutions: bool = Form(False),
    description: str = Form("", max_length=500),
    url: str = Form(""),
    website: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    check_honeypot(website)
    await get_course_doc(course_id)
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title_required")
    if kind == "link":
        url = url.strip()
        if is_personal_contact(url):
            raise HTTPException(status_code=400, detail="contact_link_not_allowed")
        if not valid_https(url):
            raise HTTPException(status_code=400, detail="invalid_url")
        rate_limit(request, "add", ADD_LIMIT, ADD_WINDOW)
        res = Resource(course_id=course_id, title=title, type=type, has_solutions=has_solutions and type == "exams",
                       description=description.strip(), kind="link", url=url, source=detect_source(url),
                       link_status="unknown", **translations.english_for(title))
        await db.resources.insert_one(res.model_dump())
        background.add_task(moderation.screen_resource, res.id)
        semantic.schedule_sync()
        return res

    if file is None:
        raise HTTPException(status_code=400, detail="file_required")
    data = await file.read(storage.MAX_PDF_BYTES + 1)
    if len(data) > storage.MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="not_pdf")
    if await storage.used_bytes() + len(data) > storage.quota_bytes():
        raise HTTPException(status_code=507, detail="storage_full")
    rate_limit(request, "add", ADD_LIMIT, ADD_WINDOW)
    rate_limit(request, "upload", 6, ADD_WINDOW)
    stored = await storage.save_pdf(data)
    res = Resource(course_id=course_id, title=title, type=type, has_solutions=has_solutions and type == "exams",
                   description=description.strip(), kind="pdf", source="pdf", file_size=len(data),
                   **translations.english_for(title))
    await db.resources.insert_one({**res.model_dump(), "file_name": stored})
    background.add_task(moderation.screen_resource, res.id)
    semantic.schedule_sync()
    return res


@router.get("/resources/{resource_id}/open")
async def open_resource(resource_id: str):
    doc = await db.resources.find_one({"id": resource_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="resource_not_found")
    await log_event("download", resource_id)
    if doc["kind"] == "link":
        return RedirectResponse(doc["url"], status_code=302, headers={"Referrer-Policy": "no-referrer"})
    data = await storage.read_pdf(doc.get("file_name"))
    if data is None:
        raise HTTPException(status_code=404, detail="file_missing")
    safe_ascii = "".join(c if (c.isascii() and c.isalnum()) or c in "-_ " else "_" for c in doc["title"])[:80].strip("_ ") or "resource"
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=\"{safe_ascii}.pdf\"; filename*=UTF-8''{quote(doc['title'][:80])}.pdf",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=3600",
    })


@router.post("/resources/{resource_id}/helpful", response_model=HelpfulOut)
async def helpful(resource_id: str, request: Request):
    rate_limit(request, "helpful", 60, 600)
    doc = await db.resources.find_one_and_update(
        {"id": resource_id}, {"$inc": {"helpful": 1}}, projection={"_id": 0, "helpful": 1}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="resource_not_found")
    return HelpfulOut(helpful=doc["helpful"])


@router.post("/sessions", response_model=StudySession)
async def create_session(body: StudySessionIn, request: Request, background: BackgroundTasks):
    check_honeypot(body.website)
    await get_course_doc(body.course_id)
    contact = body.contact_url.strip()
    if contact and not valid_https(contact):
        raise HTTPException(status_code=400, detail="invalid_url")
    rate_limit(request, "add", ADD_LIMIT, ADD_WINDOW)
    s = StudySession(course_id=body.course_id, name=body.name.strip(), description=body.description.strip(),
                     specialization=body.specialization.strip(), contact_url=contact or None)
    await db.sessions.insert_one(s.model_dump())
    background.add_task(moderation.screen_session, s.id)
    return s


@router.post("/reports", response_model=OkOut)
async def create_report(body: ReportIn, request: Request):
    check_honeypot(body.website)
    rate_limit(request, "report", 20, 600)
    coll = db.resources if body.target_type == "resource" else db.sessions
    update: dict = {"flagged": True}
    if body.reason == "broken" and body.target_type == "resource":
        update["reported_broken"] = True
    res = await coll.update_one({"id": body.target_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="target_not_found")
    rep = Report(target_type=body.target_type, target_id=body.target_id, reason=body.reason, note=body.note.strip())
    await db.reports.insert_one(rep.model_dump())
    return OkOut()
