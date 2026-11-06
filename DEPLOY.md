# Deploying EngiHub for free

Order matters: database, then API, then site.

## 1. MongoDB Atlas (database + PDFs)
1. Create a free account at https://www.mongodb.com/cloud/atlas and a free **M0** cluster. Pick a region near Render's
   (AWS Frankfurt `eu-central-1`).
2. Database Access: add a user with a password (read/write to any database).
3. Network Access: allow `0.0.0.0/0` (Render's free tier has no fixed IP).
4. Connect -> Drivers: copy the `mongodb+srv://...` connection string (put your password in it).

## 2. Render (API)
1. https://render.com -> sign in with GitHub -> **New -> Blueprint** -> pick this repo. It reads `render.yaml`.
2. Fill in the prompted secrets: `MONGO_URL` (from Atlas), `ADMIN_PASSWORD` (your choice), `CORS_ORIGINS` (the Vercel URL, add
   it after step 3 if you do not know it yet). `ADMIN_TOKEN_SECRET` is generated for you.
3. When it is live, check `https://engihub-api.onrender.com/api/` returns `{"message":"EngiHub API"}`. If Render gave the
   service a different URL, update the destination in `frontend/vercel.json` to match.
4. Free services sleep after ~15 minutes idle (first request then takes up to a minute). To keep it awake, add a free
   UptimeRobot HTTP monitor on `https://<your-service>.onrender.com/api/` with a 5-minute interval.

## 3. Vercel (site)
1. https://vercel.com -> **Add New -> Project** -> import this repo -> set **Root Directory** to `frontend`.
   Framework (Vite), build command and output directory come from `frontend/vercel.json`. No environment variables needed.
2. Deploy. Put the resulting URL into Render's `CORS_ORIGINS`.

## 4. Verify
- Open the site, search a course, add a link and a small PDF, download it.
- Sign in as admin (key icon in the footer) with `ADMIN_PASSWORD`; check the dashboard loads and storage shows usage.
- Rate limiting: `render.yaml` sets `CLIENT_IP_HEADER=x-vercel-forwarded-for`, a header Vercel sets itself and overwrites,
  so visitors are limited individually. (Measured chain on Render: visitor, Vercel egress IP, Cloudflare edge IP, Render
  internal IP. Counting positions in `X-Forwarded-For` does not work there because the middle entries change per request.)
  Limitation: anyone who calls the Render URL directly can set that header themselves. The admin login stays protected
  either way, since failed logins are also capped globally.
