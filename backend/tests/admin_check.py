"""Live check of admin features + edge cases:  python tests/admin_check.py [base_url]
Needs a running backend (fresh restart recommended: it consumes the 'add' rate limit at the end).
Reads ADMIN_PASSWORD from backend/.env. Leaves no data behind except rate-limit counters."""

import io
import sys
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001").rstrip("/") + "/api"
ENV = dotenv_values(Path(__file__).parent.parent / ".env")
fails: list[str] = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(name)


c = httpx.Client(base_url=BASE, timeout=30)
r = c.post("/admin/login", json={"password": ENV["ADMIN_PASSWORD"]})
assert r.status_code == 200, f"login failed {r.status_code} (restart the backend to clear the lockout)"
tok = r.headers["set-cookie"].split("engihub_admin=")[1].split(";")[0]
a = httpx.Client(base_url=BASE, timeout=30, headers={"Cookie": f"engihub_admin={tok}"})

# ---------- branches
b = a.post("/admin/branches", json={"code_ar": "اختبر", "code_en": "TST", "name_ar": "فرع اختبار", "name_en": "Test branch"})
check("create branch", b.status_code == 200, b.text)
bid = b.json()["id"]
check("duplicate branch 409", a.post("/admin/branches", json={"code_ar": "اختبر", "code_en": "TSX", "name_ar": "x", "name_en": "x"}).status_code == 409)
check("update branch", a.patch(f"/admin/branches/{bid}", json={"code_ar": "اختبر", "code_en": "TST", "name_ar": "فرع معدل", "name_en": "Edited"}).json().get("name_en") == "Edited")
check("branch unknown 404", a.patch("/admin/branches/nope", json={"code_ar": "q", "code_en": "q", "name_ar": "q", "name_en": "q"}).status_code == 404)
check("branch code too long 422", a.post("/admin/branches", json={"code_ar": "x" * 13, "code_en": "y", "name_ar": "a", "name_en": "b"}).status_code == 422)

# ---------- courses (public create + validation)
def add_course(num, ar="مقرر", en="Course", **kw):
    return c.post("/courses", json={"branch_id": bid, "number": num, "name_ar": ar, "name_en": en, **kw})

r1 = add_course("١٠٦")  # Arabic-Indic digits
check("course Arabic digits normalised to 106", r1.status_code == 200 and r1.json()["number"] == "106", r1.text)
cid = r1.json().get("id")
check("course lowercase suffix 107a -> 107A", (lambda x: x.status_code == 200 and x.json()["number"] == "107A")(add_course("107a")))
check("duplicate course 409", add_course("106").status_code == 409)
check("bad course code 400", add_course("12").status_code == 400)
check("no names 400", add_course("108", ar="", en="").status_code == 400)
check("unknown branch 400", c.post("/courses", json={"branch_id": "nope", "number": "109", "name_ar": "a"}).status_code == 400)
check("course honeypot", add_course("110", website="bot").status_code == 400)
check("admin update course", a.patch(f"/admin/courses/{cid}", json={"branch_id": bid, "number": "106", "name_ar": "معدل", "name_en": "Edited"}).json().get("name_en") == "Edited")
check("branch not empty 409", a.delete(f"/admin/branches/{bid}").status_code == 409)

# ---------- CSV import
csv_text = "code,name_ar,name_en,branch\nTST 201,اسم,Name,TST\nTST 106,مكرر,Dup,TST\nZZZ 300,x,y,\nTST 12,bad,bad,TST\n"
imp = a.post("/admin/import-courses", json={"csv": csv_text}).json()
check("import: 1 created, 1 skipped, 2 errors", imp.get("created") == 1 and imp.get("skipped") == 1 and len(imp.get("errors", [])) == 2, str(imp))

# ---------- resources: edge cases
def add_link(title="EDGE", url="https://example.com/x", **kw):
    return c.post("/resources", data={"course_id": cid, "title": title, "type": "exams", "kind": "link", "url": url, **kw})

xss = add_link(title="<img src=x onerror=alert(1)>")
check("XSS title stored literally", xss.status_code == 200 and xss.json()["title"].startswith("<img"))
check("blank title 400", add_link(title="   ").status_code == 400)
check("title 201 chars 422", add_link(title="a" * 201).status_code == 422)
check("description 501 chars 422", add_link(description="d" * 501).status_code == 422)
check("javascript: url rejected", add_link(url="javascript:alert(1)").status_code == 400)
check("url with spaces rejected", add_link(url="https://exa mple.com").status_code == 400)
check("url w/ credentials+private host rejected", add_link(url="https://user@10.0.0.5/x").status_code == 400)
check("localhost name rejected", add_link(url="https://localhost/x").status_code == 400)
check("has_solutions kept only for exams", add_link(has_solutions="true").json().get("has_solutions") is True)
rid = xss.json()["id"]
upd = a.patch(f"/admin/resources/{rid}", json={"title": "Edited", "type": "notes", "has_solutions": True, "description": "d", "url": "https://example.org/new"}).json()
check("admin edit resource (type notes drops solutions)", upd.get("title") == "Edited" and upd.get("has_solutions") is False and upd.get("url") == "https://example.org/new", str(upd))
check("admin edit bad url 400", a.patch(f"/admin/resources/{rid}", json={"title": "E", "type": "notes", "url": "http://nope.com"}).status_code == 400)
check("resource missing file 404", c.get("/resources/nope/open").status_code == 404)
big = c.post("/resources", data={"course_id": cid, "title": "big", "type": "notes", "kind": "pdf"},
             files={"file": ("big.pdf", io.BytesIO(b"%PDF-" + b"0" * (15 * 1024 * 1024 + 10)), "application/pdf")})
check("pdf >15MB rejected 413", big.status_code == 413, str(big.status_code))
nofile = c.post("/resources", data={"course_id": cid, "title": "nf", "type": "notes", "kind": "pdf"})
check("pdf kind without file 400", nofile.status_code == 400)

# ---------- sessions + reports
s = c.post("/sessions", json={"course_id": cid, "name": "جلسة", "description": "وصف", "contact_url": "https://t.me/x"}).json()
check("session bad contact rejected", c.post("/sessions", json={"course_id": cid, "name": "n", "description": "d", "contact_url": "http://x.com"}).status_code == 400)
check("session update", a.patch(f"/admin/sessions/{s['id']}", json={"name": "جلسة2", "description": "d", "contact_url": ""}).json().get("contact_url") is None)
check("report resource", c.post("/reports", json={"target_type": "resource", "target_id": rid, "reason": "broken", "note": "n"}).status_code == 200)
check("report session", c.post("/reports", json={"target_type": "session", "target_id": s["id"], "reason": "other"}).status_code == 200)
check("report bad target 404", c.post("/reports", json={"target_type": "resource", "target_id": "nope", "reason": "other"}).status_code == 404)
ov = a.get("/admin/overview").json()
check("overview lists 2 reports + 1 broken", len(ov["reports"]) == 2 and len(ov["broken"]) == 1, f"{len(ov['reports'])}/{len(ov['broken'])}")
check("report timestamps carry a timezone (else browsers show the wrong day)",
      all(r["created_at"].endswith(("Z", "+00:00")) for r in ov["reports"]), str([r["created_at"] for r in ov["reports"]]))
a.delete(f"/admin/reports/{ov['reports'][0]['id']}")
check("clear one report", len(a.get("/admin/overview").json()["reports"]) == 1)
check("clear all reports", a.delete("/admin/reports").status_code == 200 and len(a.get("/admin/overview").json()["reports"]) == 0)

# ---------- settings / export / link check
check("settings http rejected", a.put("/admin/settings", json={"contact_url": "http://t.me/x"}).status_code == 400)
old = c.get("/settings").json()["contact_url"]
check("settings update", a.put("/admin/settings", json={"contact_url": "https://t.me/+test"}).status_code == 200 and c.get("/settings").json()["contact_url"] == "https://t.me/+test")
a.put("/admin/settings", json={"contact_url": old})
ex = a.get("/admin/export").json()
check("export has all collections", all(k in ex for k in ("branches", "courses", "resources", "sessions", "reports", "events")))
check("trigger link check", a.post("/admin/check-links").status_code == 200)
time.sleep(6)
st = {x["id"]: x.get("link_status") for x in c.get(f"/courses/{cid}").json()["resources"]}
check("link check set a status (ok/unknown, none left 'unknown' only if offline)", all(v in ("ok", "unknown", "broken") for v in st.values()), str(st))

# ---------- delete cascade
check("delete session", a.delete(f"/admin/sessions/{s['id']}").status_code == 200)
check("delete course cascades", a.delete(f"/admin/courses/{cid}").status_code == 200 and c.get(f"/courses/{cid}").status_code == 404)
for course in c.get("/catalog").json()["courses"]:
    if course["branch_id"] == bid:
        a.delete(f"/admin/courses/{course['id']}")
check("delete branch (now empty)", a.delete(f"/admin/branches/{bid}").status_code == 200)

# ---------- add rate limit (last: consumes budget). 12 adds / 10 min
cat = c.get("/catalog").json()["courses"][0]["id"]
codes = [c.post("/resources", data={"course_id": cat, "title": f"RL{i}", "type": "notes", "kind": "link", "url": "https://example.com/rl"}).status_code for i in range(14)]
check("add rate limit kicks in with 429", 429 in codes, str(codes))
for x in c.get(f"/courses/{cat}").json()["resources"]:
    if x["title"].startswith("RL"):
        a.delete(f"/admin/resources/{x['id']}")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
