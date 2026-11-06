"""Shared read helpers: turn raw Mongo docs into response models."""

from datetime import timezone
from typing import Any, Optional

from fastapi import HTTPException

from lib.db import db
from lib.textnorm import NUMBER_RE, norm, norm_number
from models.schemas import Branch, Course, Resource, StudySession


def _aware(doc: dict) -> dict:
    doc.pop("_id", None)
    dt = doc.get("created_at")
    if dt is not None and getattr(dt, "tzinfo", 1) is None:
        doc["created_at"] = dt.replace(tzinfo=timezone.utc)
    return doc


aware = _aware  # public alias: mark Mongo's naive UTC `created_at` as UTC before it reaches a response model


def to_resource(doc: dict) -> Resource:
    return Resource(**_aware(doc))


def to_session(doc: dict) -> StudySession:
    return StudySession(**_aware(doc))


async def branch_map() -> dict[str, Branch]:
    docs = await db.branches.find({}, {"_id": 0}).sort("order", 1).to_list(1000)
    return {d["id"]: Branch(**d) for d in docs}


def to_course(doc: dict, branches: dict[str, Branch], count: int = 0) -> Course:
    b = branches.get(doc["branch_id"])
    code_ar = f"{b.code_ar} {doc['number']}" if b else doc["number"]
    code_en = f"{b.code_en} {doc['number']}" if b else doc["number"]
    return Course(
        id=doc["id"], branch_id=doc["branch_id"], number=doc["number"], code_ar=code_ar, code_en=code_en,
        name_ar=doc.get("name_ar", ""), name_en=doc.get("name_en", ""), resource_count=count,
    )


async def resource_counts(course_ids: Optional[list[str]] = None) -> dict[str, int]:
    match: dict[str, Any] = {"course_id": {"$in": course_ids}} if course_ids is not None else {}
    rows = await db.resources.aggregate(
        [{"$match": match}, {"$group": {"_id": "$course_id", "n": {"$sum": 1}}}]
    ).to_list(100000)
    return {r["_id"]: r["n"] for r in rows}


async def get_course_doc(course_id: str) -> dict:
    doc = await db.courses.find_one({"id": course_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="course_not_found")
    return doc


async def courses_by_ids(ids: list[str]) -> dict[str, Course]:
    branches = await branch_map()
    docs = await db.courses.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids) + 1)
    counts = await resource_counts([d["id"] for d in docs])
    return {d["id"]: to_course(d, branches, counts.get(d["id"], 0)) for d in docs}


async def validate_course_fields(branch_id: str, number: str, name_ar: str, name_en: str,
                                 exclude_id: Optional[str] = None) -> str:
    """Returns the normalised number; raises 4xx on bad branch/format/duplicate."""
    if not await db.branches.find_one({"id": branch_id}):
        raise HTTPException(status_code=400, detail="branch_not_found")
    num = norm_number(number)
    if not NUMBER_RE.match(num):
        raise HTTPException(status_code=400, detail="invalid_code")
    if not (name_ar.strip() or name_en.strip()):
        raise HTTPException(status_code=400, detail="name_required")
    q: dict[str, Any] = {"branch_id": branch_id, "number": num}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    if await db.courses.find_one(q):
        raise HTTPException(status_code=409, detail="duplicate_course")
    return num


def match_branch(token: str, branches: dict[str, Branch]) -> Optional[Branch]:
    t = norm(token)
    for b in branches.values():
        if t in (norm(b.code_ar), norm(b.code_en), norm(b.name_ar), norm(b.name_en)):
            return b
    return None
