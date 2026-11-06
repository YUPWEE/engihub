# EngiHub

Course-resource site for KSU College of Engineering (Arabic / English). **Vite + React 19 + TypeScript** frontend,
**FastAPI + MongoDB** backend. All API routes live under `/api`; the frontend always calls relative `/api/...` paths
(Vite proxies them to the backend in dev, so both are same-origin).

```
backend/    FastAPI API (routers/, lib/, models/), PDF uploads on local disk
frontend/   Vite + React + Tailwind v4 + shadcn/ui
memory/     original product spec (SPEC.md)
```

## Run locally

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt      # Linux/macOS: .venv/bin/pip
cp .env.example .env     # then edit: for a quick start set MONGO_URL=mongomock://local (in-memory, no MongoDB needed)
.venv/Scripts/python -m uvicorn server:app --port 8001 --no-proxy-headers
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000, proxies /api to localhost:8001
```

Sign in as admin: open the site, click the small key icon in the footer, enter `ADMIN_PASSWORD` from `backend/.env`.

## Checks

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
cd backend  && .venv/Scripts/python tests/smoke_check.py   # needs the backend running; restart it before a second run
```

## Deploying

- The frontend is a static build (`frontend/dist`); it needs `/api/*` rewritten to the backend so cookies stay same-origin
  (the admin cookie is `SameSite=Strict; Secure`, so it will not work across different domains).
- Backend env vars: see `backend/.env.example`. Behind a reverse proxy set `TRUSTED_PROXY_HOPS=1` and run uvicorn with `--no-proxy-headers`.
- Uploaded PDFs are written to `UPLOAD_DIR` on local disk; hosts with ephemeral disks (most free tiers) lose them on redeploy.
  Use a persistent disk or move uploads to object storage before relying on them.
- MongoDB: any MongoDB (a free Atlas cluster works). The app seeds branches/courses on first start if the database is empty.

`TEMPLATE.md` is the original Emergent scaffold's agent notes and can be ignored.
