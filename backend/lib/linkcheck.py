"""Best-effort link health for external resources. Never deletes anything — only stores a
status (ok / broken / unknown) that the UI turns into a badge."""

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse

import httpx

from lib.db import db
from lib.textnorm import public_host
from models.schemas import utcnow

logger = logging.getLogger(__name__)
UA = "Mozilla/5.0 (compatible; EngiHub-LinkCheck/1.0)"
CHECK_INTERVAL = 24 * 60 * 60
MAX_REDIRECTS = 5


async def resolves_public(host: str) -> bool:
    """SSRF guard: every address the name resolves to must be globally routable."""
    if not public_host(host):
        return False
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


async def safe_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """GET with manual redirect handling so each hop's host is checked before connecting."""
    for _ in range(MAX_REDIRECTS + 1):
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not await resolves_public(p.hostname or ""):
            raise ValueError("blocked host")
        r = await client.get(url, follow_redirects=False)
        if r.is_redirect and r.headers.get("location"):
            url = urljoin(url, r.headers["location"])
            continue
        return r
    raise ValueError("too many redirects")


async def check_url(client: httpx.AsyncClient, url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    try:
        if host.endswith(("youtube.com", "youtu.be")):
            r = await client.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"})
            if r.status_code == 200:
                return "ok"
            if r.status_code in (401, 403, 404):
                return "broken"
            return "unknown"
        r = await safe_get(client, url)
        final_host = (r.url.host or "").lower()
        if host.endswith(("drive.google.com", "docs.google.com")):
            # private/removed Drive files often bounce to a login page — can't tell, so unknown
            if final_host.startswith("accounts.") or "ServiceLogin" in str(r.url):
                return "unknown"
        if r.status_code in (404, 410):
            return "broken"
        if 200 <= r.status_code < 400:
            return "ok"
        return "unknown"
    except (httpx.HTTPError, ValueError):
        return "unknown"


async def check_all() -> int:
    docs = await db.resources.find({"kind": "link"}, {"_id": 0, "id": 1, "url": 1}).to_list(10000)
    async with httpx.AsyncClient(timeout=12, follow_redirects=False, headers={"User-Agent": UA}) as client:
        sem = asyncio.Semaphore(5)

        async def one(doc: dict) -> None:
            async with sem:
                status = await check_url(client, doc.get("url") or "")
            await db.resources.update_one(
                {"id": doc["id"]}, {"$set": {"link_status": status, "link_checked_at": utcnow()}}
            )

        await asyncio.gather(*(one(d) for d in docs))
    logger.info("link check finished: %d links", len(docs))
    return len(docs)


async def link_check_loop() -> None:
    await asyncio.sleep(120)
    while True:
        try:
            await check_all()
        except Exception as exc:  # keep the daily job alive
            logger.error("link check failed: %s", exc)
        await asyncio.sleep(CHECK_INTERVAL)
