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

## Deploying (free tier)

Vercel (site) -> Render (API) -> MongoDB Atlas (data and PDFs). Step-by-step: [DEPLOY.md](DEPLOY.md).

- The frontend is a static build (`frontend/dist`) with `frontend/vercel.json` rewriting `/api/*` to the backend, so the
  browser stays on one origin (the admin cookie is `SameSite=Strict; Secure` and would not work across domains).
- `render.yaml` defines the API service. Env vars are listed in `backend/.env.example`. Behind reverse proxies set
  `TRUSTED_PROXY_HOPS` to the number of proxies and run uvicorn with `--no-proxy-headers`.
- Uploaded PDFs are stored inside MongoDB (collection `pdf_files`), not on disk, so they survive redeploys. Atlas' free
  tier is 512 MB in total, hence `STORAGE_QUOTA_MB=300`.
- The app seeds branches/courses on first start if the database is empty.

`TEMPLATE.md` is the original Emergent scaffold's agent notes and can be ignored.
