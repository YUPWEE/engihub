"""English versions of imported Arabic content: resource titles, section headings, course and branch names.

The translations live in backend/data/translations_en.json and are applied on every start (one bulk write). Only
EMPTY English fields are filled, so anything an admin edits by hand is never overwritten. Section headings are
translated part by part ("المصادر / شرائح د. فلان" -> "Resources / Dr. X's slides"), so new combinations of
known folder names translate too. New uploads and imports get English the same way (english_for)."""

import json
import logging
from functools import lru_cache
from pathlib import Path

from pymongo import UpdateMany

from lib.db import db
from lib.textnorm import norm_number

logger = logging.getLogger(__name__)
DATA = Path(__file__).resolve().parent.parent / "data" / "translations_en.json"
EMPTY = {"$in": ["", None]}


@lru_cache(maxsize=1)
def _data() -> dict:
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("no English translations loaded: %s", exc)
        return {}


def section_en(section: str) -> str:
    """English for a section path, or "" if any part is unknown (better Arabic than half-translated)."""
    if not section:
        return ""
    parts = _data().get("sections", {})
    out = []
    for p in section.split(" / "):
        if p in parts:
            out.append(parts[p])
        elif not any("؀" <= ch <= "ۿ" for ch in p):
            out.append(p)  # already Latin
        else:
            return ""
    return " / ".join(out)


def english_for(title: str, section: str = "") -> dict[str, str]:
    """title_en / section_en for a new resource (empty strings when unknown)."""
    return {"title_en": _data().get("titles", {}).get(title, ""), "section_en": section_en(section)}


async def apply() -> dict[str, int]:
    """Fill missing English fields from the translations file. Idempotent and cheap to repeat."""
    data = _data()
    if not data:
        return {}
    ops: list = []
    for ar, en in data.get("titles", {}).items():
        ops.append(UpdateMany({"title": ar, "title_en": EMPTY}, {"$set": {"title_en": en}}))
    for section in await db.resources.distinct("section"):
        en = section_en(section) if section else ""
        if en and en != section:
            ops.append(UpdateMany({"section": section, "section_en": EMPTY}, {"$set": {"section_en": en}}))
    res_mod = (await db.resources.bulk_write(ops, ordered=False)).modified_count if ops else 0

    # Course names: keyed by Arabic code, e.g. "سلم 100".
    branches = {b["code_ar"]: b["id"] for b in await db.branches.find({}, {"_id": 0, "id": 1, "code_ar": 1}).to_list(1000)}
    course_ops = []
    for code, name_en in data.get("courses", {}).items():
        prefix, _, number = code.partition(" ")
        if prefix in branches:
            # (branch, number) is unique; UpdateMany also keeps the local mongomock backend happy.
            course_ops.append(UpdateMany({"branch_id": branches[prefix], "number": norm_number(number), "name_en": EMPTY},
                                         {"$set": {"name_en": name_en}}))
    course_mod = (await db.courses.bulk_write(course_ops, ordered=False)).modified_count if course_ops else 0

    # Branches: only replace placeholder values (when a field still equals the given "if" value).
    branch_mod = 0
    for code_ar, spec in data.get("branches", {}).items():
        for field, value in spec.get("set", {}).items():
            placeholder = spec.get("if", {}).get(field)
            filt = {"code_ar": code_ar, field: placeholder if placeholder is not None else EMPTY}
            branch_mod += (await db.branches.update_one(filt, {"$set": {field: value}})).modified_count
    result = {"resources": res_mod, "courses": course_mod, "branches": branch_mod}
    if any(result.values()):
        logger.info("English translations applied: %s", result)
    return result
