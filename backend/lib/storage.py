import os
import secrets
from typing import Optional

from lib.db import db

MAX_PDF_BYTES = 15 * 1024 * 1024


def quota_bytes() -> int:
    return int(float(os.environ.get("STORAGE_QUOTA_MB", "300")) * 1024 * 1024)


async def used_bytes() -> int:
    rows = await db.pdf_files.aggregate([{"$group": {"_id": None, "n": {"$sum": "$size"}}}]).to_list(1)
    return int(rows[0]["n"]) if rows else 0


async def save_pdf(data: bytes) -> str:
    name = secrets.token_hex(16) + ".pdf"
    await db.pdf_files.insert_one({"name": name, "size": len(data), "data": data})
    return name


async def read_pdf(name: Optional[str]) -> Optional[bytes]:
    if not name:
        return None
    doc = await db.pdf_files.find_one({"name": name}, {"_id": 0, "data": 1})
    return bytes(doc["data"]) if doc else None


async def delete_file(name: Optional[str]) -> None:
    if name:
        await db.pdf_files.delete_one({"name": name})
