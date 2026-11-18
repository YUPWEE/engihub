import csv
import html
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

ROOT = "1-1mGVrrYzo-RslxHhfHSZFPj-lZWsvxk"
HERE = Path(__file__).parent
CACHE = HERE / ".drive-tree.json"
OUT = HERE / "drive-import.csv"
SKIP_NAMES = ("نتائج الدرجات", "سبر", "تم الإعداد من", "تم الاعداد من")
SKIP_RE = r"^نتائج .*طلاب"
MIN_IMAGES_TO_COLLAPSE, MAX_DOCS_SHARE = 3, 0.15


def parse_listing(text: str) -> list[dict]:
    out = []
    for chunk in text.split('<div class="flip-entry" id="entry-')[1:]:
        href = re.search(r'<a href="([^"]+)"', chunk)
        title = re.search(r'class="flip-entry-title">(.*?)</div>', chunk, re.S)
        mime = re.search(r'/type/([\w./+-]+)"', chunk)
        out.append({"id": re.match(r"[\w-]+", chunk).group(0), "href": html.unescape(href.group(1)) if href else "",
                    "name": html.unescape(title.group(1)).strip() if title else "",
                    "mime": mime.group(1) if mime else ""})
    return out


def crawl() -> dict:
    client = httpx.Client(timeout=40, follow_redirects=True, headers={"Accept-Language": "en", "User-Agent": "Mozilla/5.0"})

    def listing(fid: str) -> list[dict]:
        for _ in range(4):
            try:
                r = client.get(f"https://drive.google.com/embeddedfolderview?id={fid}")
                if r.status_code == 200:
                    return parse_listing(r.text)
            except httpx.HTTPError:
                pass
        raise RuntimeError(f"could not list folder {fid}")

    nodes = {ROOT: {"id": ROOT, "name": "", "path": [], "folder": True, "children": []}}
    frontier = [ROOT]
    with ThreadPoolExecutor(8) as ex:
        while frontier:
            nxt = []
            for fid, entries in zip(frontier, ex.map(listing, frontier)):
                parent = nodes[fid]
                for e in entries:
                    parent["children"].append(e["id"])
                    if e["id"] in nodes:
                        continue
                    folder = "/folders/" in e["href"]
                    nodes[e["id"]] = {**e, "folder": folder, "children": [],
                                      "path": parent["path"] + ([parent["name"]] if fid != ROOT else [])}
                    if folder:
                        nxt.append(e["id"])
            frontier = nxt
    return nodes


def clean(seg: str) -> str:
    seg = re.sub(r"^\s*\d+(\.\d+)?\s*(》|\||_)\s*", "", seg)
    return seg.strip(" _-")


def has(text: str, *words: str) -> bool:
    return any(re.search(w, text, re.I) for w in words)


def classify(segs: list[str], name: str, mime: str) -> str:
    where = " / ".join(segs)
    both = f"{where} / {name}"
    if has(where, "اختبار", "اسئلة سابقة", "أسئلة سابقة", "تجميعات", "كويز") or \
            has(name, r"\bquiz", "كويز", r"\bexam\b", r"\bmid\s*-?\s*\d", "midterm", "اختبار", r"\bfinal\b.*\b(exam|solved)"):
        return "exams"
    if has(where, "مشروع", "مشاريع", r"\bproject\b", "logbook", "poster", "report sample", "نتائج"):
        return "other"
    if mime.startswith(("video/", "audio/")) or has(both, "مقاطع شرح"):
        return "videos"
    if has(both, "تمارين", "التمارين", "tutorial", "home ?work", "هوموورك", "أسئلة الكتاب", "اسئلة الخطة",
           r"\bproblems?\b", r"\blabs?\b", r"\bsheet\b", "واجب", r"\bexercises?\b"):
        return "notes"
    if has(both, "ملخص", "تلخيص", "تخليص", "قوانين", "معادلات", "cheat", "مراجعة", "تعاريف", "تعداد", "خريطة ذهنية",
           "أحداث مهمة", "التواريخ", "الارقام", "ارقام المواد", "جدول يوضح", "المصطلحات", "أحكام"):
        return "summaries"
    if has(both, "شرائح", "سلايد", r"(^| / )د\.\s?", r"\bslides?\b", "عرض", "عروض", "محاضرات", r"\blecture", r"\bch(apter)?\s*-?\s*\d") or \
            "presentation" in mime or mime == "application/vnd.ms-powerpoint":
        return "slides"
    if has(both, "المرجع", "الكتاب", "الكتب", "كتاب", r"\bbooks?\b", "textbook"):
        return "textbooks"
    if has(both, "مذكرة", "مذكرات", "نوتات", "أوراق", "ملازم", "شروح", "شرح", "ملفات الدكتور", r"\bnotes?\b"):
        return "notes"
    return "other"


def solved(name: str, section: str) -> bool:
    text = f"{section} / {name}"
    if has(text, "بلا حل", "بدون حل", "without"):
        return False
    return has(text, "محلول", "الحل", "حلول", r"(^|[\s(_-])حل($|[\s)_.-])", r"\bsol(ution|ved|s)?\b", r"\banswers?\b")


def title_of(name: str) -> str:
    t = re.sub(r"\.(pdf|docx?|pptx?|xlsx?|jpe?g|png|webp|mp4|txt|ogg)$", "", name, flags=re.I)
    t = re.sub(r"^((copy of|نسخة من)\s+)+", "", t, flags=re.I)
    t = re.sub(r"\[\d+\]$", "", t).replace("_", " ")
    return re.sub(r"\s+", " ", t).strip()[:200] or name[:200]


def file_url(node: dict) -> str:
    href = node["href"]
    m = re.match(r"https://drive\.google\.com/file/d/([\w-]+)", href)
    if m:
        return f"https://drive.google.com/file/d/{m.group(1)}/view"
    return re.sub(r"[?&]usp=drive_web$", "", href)


def build(nodes: dict) -> list[dict]:
    def files_under(fid: str) -> list[dict]:
        out = []
        for c in nodes[fid]["children"]:
            n = nodes.get(c)
            if n and c != fid:
                out += files_under(c) if n["folder"] else [n]
        return out

    def image_heavy(fid: str) -> bool:
        files = files_under(fid)
        imgs = sum(1 for f in files if f["mime"].startswith("image/"))
        if imgs >= MIN_IMAGES_TO_COLLAPSE and (len(files) - imgs) <= max(3, MAX_DOCS_SHARE * len(files)):
            return True
        direct_docs = sum(1 for c in nodes[fid]["children"]
                          if c in nodes and not nodes[c]["folder"] and not nodes[c]["mime"].startswith("image/"))
        return imgs >= 10 and imgs / len(files) >= 0.75 and direct_docs <= 3

    rows: list[dict] = []

    def add(code: str, segs: list[str], name: str, url: str, mime: str, kind_hint: str = "") -> None:
        inner = segs[1:]
        cleaned = [clean(s) for s in inner]
        rtype = classify(cleaned, name, mime) if not kind_hint else kind_hint
        generic = r"^(الاختبارات|اختبارات|المصادر|الشرائح|الكتب|التمارين|شروح)$"
        sec_parts = cleaned[1:] if cleaned and re.match(generic, cleaned[0]) else cleaned
        section = " / ".join(p for p in sec_parts if p)[:120]
        rows.append({"code": code, "type": rtype, "title": title_of(name), "url": url, "section": section,
                     "has_solutions": "1" if rtype == "exams" and solved(name, section) else ""})

    def walk(fid: str, code: str) -> None:
        node = nodes[fid]
        segs = node["path"][1:] + [node["name"]]
        for c in node["children"]:
            n = nodes.get(c)
            if not n or c == fid or any(s in n["name"] for s in SKIP_NAMES) or re.match(SKIP_RE, n["name"]):
                continue
            if n["folder"]:
                if len(segs) >= 2 and image_heavy(c):
                    count = len(files_under(c))
                    add(code, segs + [n["name"]], f"{clean(n['name'])} (مجلد صور، {count} ملف)",
                        f"https://drive.google.com/drive/folders/{c}", "image/folder")
                else:
                    walk(c, code)
            elif n["mime"] != "application/vnd.google-apps.shortcut":
                add(code, segs, n["name"], file_url(n), n["mime"])

    seen_codes = set()
    for level_id in nodes[ROOT]["children"]:
        level = nodes[level_id]
        if not (level["folder"] and level["name"].startswith("مقررات")):
            continue
        for cid in level["children"]:
            course = nodes[cid]
            m = re.match(r"\s*([؀-ۿ]+)\s*(\d{3})", course["name"])
            if not (course["folder"] and m) or not files_under(cid):
                continue
            code = f"{m.group(1)} {m.group(2)}"
            if code not in seen_codes:
                seen_codes.add(code)
                rows.append({"code": code, "type": "other", "title": "مجلد المقرر كاملاً على Google Drive",
                             "url": f"https://drive.google.com/drive/folders/{cid}", "section": "", "has_solutions": ""})
            walk(cid, code)
    return rows


def main() -> None:
    if "--cached" in sys.argv and CACHE.exists():
        nodes = json.loads(CACHE.read_text(encoding="utf-8"))
    else:
        nodes = crawl()
        CACHE.write_text(json.dumps(nodes, ensure_ascii=False), encoding="utf-8")
    rows = build(nodes)
    urls = Counter(r["url"] for r in rows)
    rows = [r for i, r in enumerate(rows) if urls[r["url"]] == 1 or r["url"] not in {x["url"] for x in rows[:i]}]
    with OUT.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["code", "name_ar", "name_en", "type", "title", "url", "has_solutions", "section", "description"])
        for r in rows:
            w.writerow([r["code"], "", "", r["type"], r["title"], r["url"], r["has_solutions"], r["section"], ""])
    print(f"wrote {len(rows)} rows for {len({r['code'] for r in rows})} courses -> {OUT}")
    print("types:", dict(Counter(r["type"] for r in rows)))
    print("with solutions:", sum(1 for r in rows if r["has_solutions"]))


if __name__ == "__main__":
    main()
