# EngiHub — Living Spec

Free, non-profit, ad-free bilingual (Arabic default / English) course-resource hub for KSU College of Engineering.
No accounts, no ads, no analytics/trackers, no third-party scripts or fonts (IBM Plex Sans Arabic self-hosted via @fontsource).

## Pages (frontend/src/pages)
- `/` Home: hero smart search, branch grid (course counts), most-searched courses (7-day anonymous opens; falls back to suggested), most-downloaded resources.
- `/courses` all courses: filter text + dashed "Course not found? Add it" button beside it, branch pills (`?add=1&q=` prefills).
- `/branch/:id` branch header with filled "Add a resource" + dashed "Course not found? Add it" (stacked full-width on mobile), in-branch search, courses.
- Add-course modal: code (هعم 106 / GE106 / 106 + branch, same normalisation as search; typed prefix selects branch), Arabic name required, English optional, branch preselected; live duplicate check links to existing course; success opens new course.
- `/course/:id` course header (code AR/EN), resources grouped by type, helpful (1 vote/browser via localStorage), report, study-sessions section (bottom, disclaimer).
- `/admin` dashboard (admin only): stats + storage, reports (clear one/all), broken links (+ run check now), branches CRUD, CSV course import, JSON metadata export.
- Header: outlined "Contact us" (Telegram, new tab; icon-only on mobile; link from public setting `GET /api/settings`, admin edits via `PUT /api/admin/settings` in Admin → Data tab; Mongo `settings` doc `_id:"site"`, default https://t.me/+48Hwr9MjRHU2ODM0). Centered muted tagline under wordmark; its "شاركه / Share it" opens the add-resource modal.
- Footer: QR modal (window.location.origin, PNG download), key icon → admin login.

## Search (frontend/src/lib/search.ts)
Full catalog cached once (`/api/catalog`, localStorage) → client-side ranked prefix/fuzzy match over code AR/EN, names, aliases. Normalises Arabic letters/digits, case, separators: `GE106`, `ge 106`, `GE-106`, `هعم106`, `هعم 106` are equivalent.

## Data model (Mongo, backend/models/schemas.py ↔ frontend/src/lib/types.ts)
- branches {id, code_ar, code_en, name_ar, name_en, order}
- courses {id, branch_id, number(3 digits + optional letter), name_ar, name_en}; unique branch+number
- resources {id, course_id, title, type(slides|notes|textbooks|exams|summaries|videos|other), has_solutions, description, kind(pdf|link), url, source, file_name, file_size, helpful, link_status(ok|broken|unknown), reported_broken, flagged, created_at}
- sessions {id, course_id, name, description, specialization, contact_url(https, optional), flagged, created_at}
- reports {id, target_type(resource|session), target_id, reason, note, created_at}
- events {kind(open|download), target_id, day, count} — anonymous per-day counters only.

## Safety
PDF only (magic bytes), 15 MB max, random filenames in backend/uploads, quota `STORAGE_QUOTA_MB` (default 2048) → 507 storage_full. Links must be HTTPS; wa.me / api.whatsapp.com/send / tel: / mailto: rejected for resources. Honeypot field `website`; in-memory salted-hash rate limits (no IP/UA persisted; uvicorn access log disabled). Daily link-health loop (YouTube oEmbed; ambiguous → unknown).

## Admin auth
Single owner password in `ADMIN_PASSWORD` (backend/.env, never in code). `POST /api/admin/login` → signed httpOnly SameSite=Strict cookie (2 h). Failed logins rate-limited (5 / 15 min). All `/api/admin/*` mutating routes verify the cookie server-side. Seed: 10 branches + 6 courses (ريض 106/203/204, هعم 202/211, همك 254), no fake resources.
