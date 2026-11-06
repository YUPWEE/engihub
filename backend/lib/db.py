"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
if mongo_url.startswith("mongomock://"):
    # Local development only: in-memory fake Mongo (pip install mongomock-motor). Data is lost on restart.
    from mongomock_motor import AsyncMongoMockClient

    client = AsyncMongoMockClient()
else:
    client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "branches": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("order", ASCENDING)], name="order")],
    "courses": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                IndexModel([("branch_id", ASCENDING), ("number", ASCENDING)], name="branch_number", unique=True)],
    "resources": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("course_id", ASCENDING)], name="course"),
                  IndexModel([("kind", ASCENDING), ("link_status", ASCENDING)], name="kind_status")],
    "sessions": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("course_id", ASCENDING), ("created_at", DESCENDING)], name="course_created")],
    "reports": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                IndexModel([("target_type", ASCENDING), ("target_id", ASCENDING)], name="target"),
                IndexModel([("created_at", DESCENDING)], name="created")],
    "pdf_files": [IndexModel([("name", ASCENDING)], name="name", unique=True)],
    "events": [IndexModel([("kind", ASCENDING), ("target_id", ASCENDING), ("day", ASCENDING)], name="kind_target_day", unique=True),
               IndexModel([("kind", ASCENDING), ("day", ASCENDING)], name="kind_day")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
