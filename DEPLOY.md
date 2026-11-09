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

## AI features (optional, free Gemini API)
Two things, both off until a key is set:
- **Smart search**: the home search box also suggests courses and resources by meaning (e.g. "past papers for statics"),
  under an "AI search suggestions" heading below the normal keyword matches.
- **Submission screening**: each new public link, PDF and study group is checked by the text model. A suspicious one gets a
  report in the dashboard (note starts with `AI:`) and stays visible until the admin decides. Nothing is hidden or deleted
  automatically, and if the AI is down the item is simply not screened.

Setup: create a key at https://aistudio.google.com/apikey (no billing needed), add it in Render -> engihub-api ->
Environment as `GEMINI_API_KEY`, and let it redeploy. Then in the dashboard (Import / Export -> "AI features") the card
should say "On"; press "Update search index" once (the first sync also runs ~20 s after each start).
Models default to `gemini-3.5-flash-lite` (screening) and `gemini-embedding-2` (search), both listed as free-tier on
Google's pricing page; override with `GEMINI_TEXT_MODEL` / `GEMINI_EMBED_MODEL` if Google retires them.

Limits and privacy:
- Spend is capped per server run and per UTC day (`GEMINI_DAILY_SEARCH` 300 search calls, `GEMINI_DAILY_OTHER` 200 for
  screening and indexing); over the cap the features quietly switch off for the day. Search is also rate-limited per
  visitor, and identical queries are cached.
- On the free tier Google may use the content sent to improve its products. What is sent: search text typed by visitors,
  and the titles, descriptions, link addresses and course names of resources (all public on the site anyway). PDF contents
  are never sent. Mention it in your privacy note if you have one.
- `SEARCH_MIN_SCORE` (default 0.35) and the 0.12 closeness window in `lib/semantic.py` decide how strict suggestions are;
  tune them after trying real queries.
- Indexing speed: the free tier allows only a couple of embedding calls (50 items each) per minute, so a big import
  (e.g. the ~1,800 Drive links) takes about 25-30 minutes to become searchable. The sync waits out each "too many
  requests" pause and carries on by itself; the admin AI card shows progress. While it pauses, AI search briefly
  falls back to keyword-only results.
- Tests: `cd backend && python -m pytest tests/test_ai.py tests/test_import.py -n 0` (Gemini is faked, no key needed).

## Gotcha: Vercel blocks commits from other identities
On Vercel's free (Hobby) plan, a push is only deployed if the commit's author is the GitHub account linked to the Vercel
account; otherwise the deployment shows as **BLOCKED**. Commit as that account, e.g. in this repo:
`git config user.name YUPWEE` and `git config user.email 350624975+YUPWEE@users.noreply.github.com` (GitHub's noreply
address for the account). Commits authored with any other email (such as a different GitHub account's) are skipped.

## Bulk-adding resource links
Dashboard -> Import / Export -> "Import resource links from CSV". Columns: `code,name_ar,name_en,type,title,url`, then
optionally `has_solutions` (1 for solved exams), `section` (a sub-heading inside the type group on the course page, e.g.
"النهائية") and `description`. Create any missing branch first (e.g. NJM). Re-uploading is safe: links already on a course
are skipped. Thousands of rows import in a couple of seconds.

`data/drive-import.csv` is the shared KSU Drive, file by file (about 1,800 links for 24 courses), built by
`python -I data/build_drive_import.py`, which crawls the public folder anonymously and decides type, section and
"solved" from folder and file names. Photo-only folders become one folder link, each course also gets a link to its whole
Drive folder, and grade sheets, credit pages and the non-course "أدلة الكلية" folder are skipped. Re-run it later to pick
up new files, then import the CSV again: only new links are added.
