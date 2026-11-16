import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Request
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, ensure_indexes  # noqa: E402
from lib import cache, semantic, translations  # noqa: E402
from lib.linkcheck import link_check_loop  # noqa: E402
from lib.seed import seed_if_empty  # noqa: E402
from routers import admin as admin_routes  # noqa: E402
from routers import public as public_routes  # noqa: E402

# Privacy: never log visitor addresses or user agents (uvicorn's access log contains them).
logging.getLogger("uvicorn.access").disabled = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    await seed_if_empty()
    try:
        await translations.apply()  # fill English titles/sections/names from data/translations_en.json
    except Exception as exc:  # never block startup on this
        logging.getLogger(__name__).error("applying translations failed: %s", exc)
    app.state.link_task = asyncio.create_task(link_check_loop())
    semantic.schedule_sync(delay=20)  # index anything new since the last start (no-op without an AI key)
    yield
    app.state.link_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.link_task
    client.close()


app = FastAPI(lifespan=lifespan, title="EngiHub API")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "EngiHub API"}


api_router.include_router(public_routes.router)
api_router.include_router(admin_routes.router)
api_router.include_router(admin_routes.guarded)


# Writes clear the read cache so edits show up at once. The anonymous counters (course "open", resource
# "helpful") are excluded: they fire on every visit and would otherwise empty the cache constantly.
_COUNTER_SUFFIXES = ("/open", "/helpful")


@app.middleware("http")
async def clear_cache_after_writes(request: Request, call_next):
    response = await call_next(request)
    if (request.method not in ("GET", "HEAD", "OPTIONS") and response.status_code < 400
            and not request.url.path.endswith(_COUNTER_SUFFIXES)):
        cache.clear()
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# Include the router in the main app — keep last.
app.include_router(api_router)
