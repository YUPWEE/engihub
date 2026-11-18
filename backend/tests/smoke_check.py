import io
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001").rstrip("/") + "/api"
ENV = dotenv_values(Path(__file__).parent.parent / ".env")
fails: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(name)


c = httpx.Client(base_url=BASE, timeout=20)

cat = c.get("/catalog").json()
check("catalog has branches+courses", len(cat["branches"]) > 0 and len(cat["courses"]) > 0)
course = next(x for x in cat["courses"] if x["resource_count"] >= 0)
cd = c.get(f"/courses/{course['id']}")
check("course detail 200", cd.status_code == 200)
check("unknown course 404", c.get("/courses/nope").status_code == 404)
check("home 200", c.get("/home").status_code == 200)
check("course open 200", c.post(f"/courses/{course['id']}/open").status_code == 200)

def add_link(url, **kw):
    data = {"course_id": course["id"], "title": "SMOKE link", "type": "notes", "kind": "link", "url": url, **kw}
    return c.post("/resources", data=data)

r = add_link("https://example.com/a")
check("add https link", r.status_code == 200, r.text)
link_id = r.json().get("id") if r.status_code == 200 else None
check("reject http link", add_link("http://example.com/a").status_code == 400)
check("reject whatsapp link", add_link("https://wa.me/966500000000").status_code == 400)
check("honeypot rejected", add_link("https://example.com/b", website="x").status_code == 400)
ssrf = add_link("https://127.0.0.1:8001/api/")
check("reject loopback/private https link (SSRF)", ssrf.status_code == 400, f"got {ssrf.status_code}")
ssrf_id = ssrf.json().get("id") if ssrf.status_code == 200 else None
ssrf2 = add_link("https://169.254.169.254/latest/meta-data/")
check("reject link-local https link (SSRF)", ssrf2.status_code == 400, f"got {ssrf2.status_code}")
ssrf2_id = ssrf2.json().get("id") if ssrf2.status_code == 200 else None
if link_id:
    check("helpful +1", c.post(f"/resources/{link_id}/helpful").json().get("helpful") == 1)
    check("link open redirects", c.get(f"/resources/{link_id}/open", follow_redirects=False).status_code == 302)
    check("report accepted", c.post("/reports", json={"target_type": "resource", "target_id": link_id, "reason": "broken"}).status_code == 200)

pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
up = c.post("/resources", data={"course_id": course["id"], "title": "ورقة الرسم للاوتوكاد SMOKE", "type": "notes", "kind": "pdf"},
            files={"file": ("x.pdf", io.BytesIO(pdf), "application/pdf")})
check("upload pdf", up.status_code == 200, up.text)
pdf_id = up.json().get("id") if up.status_code == 200 else None
if pdf_id:
    dl = c.get(f"/resources/{pdf_id}/open")
    check("download pdf w/ Arabic title 200", dl.status_code == 200 and dl.content == pdf, f"{dl.status_code}")
    check("download has filename*", "filename*=UTF-8''" in dl.headers.get("content-disposition", ""))
bad = c.post("/resources", data={"course_id": course["id"], "title": "SMOKE bad", "type": "notes", "kind": "pdf"},
             files={"file": ("x.pdf", io.BytesIO(b"not a pdf"), "application/pdf")})
check("non-pdf rejected 415", bad.status_code == 415)

s = c.post("/sessions", json={"course_id": course["id"], "name": "SMOKE s", "description": "d"})
check("create session", s.status_code == 200, s.text)
sess_id = s.json().get("id") if s.status_code == 200 else None

check("admin route without cookie 401", c.get("/admin/overview").status_code == 401)
check("wrong password 401", c.post("/admin/login", json={"password": "wrong"}).status_code == 401)
ok = c.post("/admin/login", json={"password": ENV["ADMIN_PASSWORD"]})
check("right password 200", ok.status_code == 200, f"{ok.status_code}")
tok = ok.cookies.get("engihub_admin") or ""
if not tok and "set-cookie" in ok.headers:
    tok = ok.headers["set-cookie"].split("engihub_admin=")[1].split(";")[0]
check("login sets httpOnly cookie", "httponly" in ok.headers.get("set-cookie", "").lower())
adm = httpx.Client(base_url=BASE, timeout=20, headers={"Cookie": f"engihub_admin={tok}"})
check("admin overview 200", adm.get("/admin/overview").status_code == 200)
check("admin export 200", adm.get("/admin/export").status_code == 200)

codes = []
for i in range(9):
    codes.append(httpx.post(BASE + "/admin/login", json={"password": f"bad{i}"}, headers={"X-Forwarded-For": f"10.9.8.{i}"}, timeout=20).status_code)
check("login limiter not bypassed by spoofed X-Forwarded-For", 429 in codes, f"codes={codes}")

for rid in (link_id, pdf_id, ssrf_id, ssrf2_id):
    if rid:
        adm.delete(f"/admin/resources/{rid}")
if sess_id:
    adm.delete(f"/admin/sessions/{sess_id}")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
