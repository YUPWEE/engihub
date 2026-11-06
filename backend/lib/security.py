"""Anti-abuse + admin session helpers.

Rate limiting uses SHORT-LIVED IN-MEMORY counters keyed by a salted hash of the client
address. The salt is random per process and never persisted; the raw address is never
stored, logged, or written to the database."""

import hashlib
import hmac
import os
import secrets
import time
from collections import deque

import jwt
from fastapi import HTTPException, Request

_SALT = secrets.token_bytes(32)
_buckets: dict[str, deque] = {}

ADMIN_COOKIE = "engihub_admin"
ADMIN_TTL_SECONDS = 2 * 60 * 60


def _client_addr(request: Request) -> str:
    """Client address for rate limiting.

    X-Forwarded-For is client-controlled unless a trusted reverse proxy appended to it, so it is
    ignored by default. Behind N trusted proxies (Render, Vercel, nginx...) set TRUSTED_PROXY_HOPS=N and the
    entry the outermost trusted proxy added (N-th from the right) is used instead."""
    direct = request.client.host if request.client else ""
    try:
        hops = int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))
    except ValueError:
        hops = 0
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return direct


def _client_key(request: Request, scope: str) -> str:
    return hashlib.sha256(_SALT + scope.encode() + _client_addr(request).encode()).hexdigest()


def global_limited(scope: str, limit: int, window: int) -> bool:
    """True when `scope` already saw `limit` events in `window` seconds across ALL clients."""
    now = time.monotonic()
    q = _buckets.get("global:" + scope)
    return bool(q) and sum(1 for t in q if t >= now - window) >= limit


def global_hit(scope: str, window: int) -> None:
    now = time.monotonic()
    q = _buckets.setdefault("global:" + scope, deque())
    while q and q[0] < now - window:
        q.popleft()
    q.append(now)


def _prune(now: float) -> None:
    if len(_buckets) < 5000:
        return
    for k in [k for k, q in _buckets.items() if not q or q[-1] < now - 3600]:
        _buckets.pop(k, None)


def rate_limit(request: Request, scope: str, limit: int, window: int) -> None:
    """Raise 429 when this client exceeded `limit` hits for `scope` within `window` seconds."""
    now = time.monotonic()
    _prune(now)
    key = _client_key(request, scope)
    q = _buckets.setdefault(key, deque())
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="rate_limited")
    q.append(now)


def peek_limited(request: Request, scope: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    q = _buckets.get(_client_key(request, scope))
    if not q:
        return False
    return sum(1 for t in q if t >= now - window) >= limit


def check_honeypot(value: str) -> None:
    if value:
        raise HTTPException(status_code=400, detail="rejected")


# ---------- admin ----------
def _secret() -> str:
    return os.environ["ADMIN_TOKEN_SECRET"]


def password_ok(candidate: str) -> bool:
    expected = os.environ.get("ADMIN_PASSWORD", "")
    return bool(expected) and hmac.compare_digest(candidate.encode(), expected.encode())


def make_admin_token() -> str:
    now = int(time.time())
    return jwt.encode({"role": "admin", "iat": now, "exp": now + ADMIN_TTL_SECONDS}, _secret(), algorithm="HS256")


def is_admin(request: Request) -> bool:
    token = request.cookies.get(ADMIN_COOKIE)
    if not token:
        return False
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return False
    return payload.get("role") == "admin"


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="admin_required")
