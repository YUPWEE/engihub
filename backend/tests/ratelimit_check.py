import sys

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8003").rstrip("/") + "/api"
HDR = "X-Vercel-Forwarded-For"
fails = []
body = {"target_type": "resource", "target_id": "nope", "reason": "other"}


def post(headers):
    return httpx.post(BASE + "/reports", json=body, headers=headers, timeout=30).status_code


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(name)


codes = [post({HDR: f"198.51.100.{i}"}) for i in range(25)]
check("25 different visitors are not throttled", 429 not in codes, str(codes))

codes = [post({HDR: "203.0.113.7", "X-Forwarded-For": f"10.0.0.{i}"}) for i in range(25)]
check("one visitor is throttled after 20 requests despite rotating X-Forwarded-For", codes[:20] == [404] * 20 and 429 in codes[20:], str(codes))

check("a different visitor is still served", post({HDR: "203.0.113.8"}) == 404)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
