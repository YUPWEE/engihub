"""Builds data/drive-import.csv from the crawled Google Drive structure and verifies every link is publicly
reachable (anonymous request, no cookies).   python data/build_drive_import.py [--no-verify]

Source: the shared KSU engineering handbook folder (one folder per course, with sub-folders such as exams/resources).
Skipped on purpose: student grade-result sheets and "prepared by" credit PDFs."""

import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

# course code (Arabic prefix + number) -> (name_ar, items). Items are (drive name, drive id).
COURSES = {
    "سلم 100": ("", [("الاختبارات", "1kF2aLwKKY5J3_kCLvI6tgniRMhZZ_Et8"), ("المصادر", "1gWelu6ani45s7TZAQXY32T3TKQWPhvny")]),
    "سلم 102": ("", [("الاختبارات", "1hLURRnaoxiSq9gDnntOoN-oxiRCql9Rh"), ("المصادر", "19BD3FOfokhZ6PP3tlEPyZBMVJI3LqtpY")]),
    "سلم 103": ("", [("الاختبارات", "1-v3Hi-ODtpsTbKSahDOmt5G_GQYsJIWE"), ("المصادر", "1zXAFqWjt4JwpztzLJ4F0mTXovz_krvL_")]),
    "سلم 106": ("", [("الاختبارات", "1nFEfziggpf_H-mOL_qQtiVE6hcEnsrNh"), ("المصادر", "1iBM_5Dyrd3Agnp7I3bq230ejJmFRtWiL")]),
    "سلم 107": ("", [("الاختبارات", "1FTfGM2UAeLt2I2HW6KQs4uKQQeVlz5Zu"), ("المصادر", "1Cg_mD9fRfjJtHq8bL-HCCS0raxdO8UM4")]),
    "سلم 108": ("", [("الاختبارات", "15i5xSkTPMGhjpDo4gX9aoKLNCpKbAUcp"), ("المصادر", "1RAJKhp_dvAfj8qOloJ20HQWvs3LAKVTG")]),
    "ريض 106": ("", [("الاختبارات", "1c-3BbFpNfbJvZgjkT-1GCYGr9r84fM8H"), ("المصادر", "1T9aGHLnyTHI7pVqb-SCwG1sv6xDSTaCi"), ("سبر - ريض 106", "1aMjyOIC7xlmK6UND8hH2VF3rQEI9jgXH")]),
    "ريض 107": ("", [("الاختبارات", "1RCPPQtO_sIBbzs-BaXQyYME_ibpkLJzz"), ("المصادر", "13hW6TGkoP5DNtMpQYzIVQLwUnLTpeV3q"), ("سبر - ريض 107", "1fKZ9QgbdKKntIks8VIC-dutIm7VZC4i3")]),
    "فيز 103": ("", [("الاختبارات", "1i-1SUJm6qLeU2nidKi_I05G3WiGuwXcG"), ("العملي", "1TPebibl3956-YXtrVR2OTyPLzBhQbBs_"), ("المصادر", "1rMUO9duvP33wasT08HAuDErA3PWg5BXR"), ("سبر - فيز 103", "1xx_YDUntL_g_oEs0d1lRX9JWX5faQqYx")]),
    "نجم 109": ("", [("أمثلة مشاريع", "1YAMC5unbLQ7oeZpnkJNmaelwHqqD-J2U"), ("الاختبارات", "1QsoS-Dy_zAaktHm5OFStoSDfBgJ5Gdll"), ("المصادر", "1FYLSOkFMNKw1ySAS1WegfVHN8tWOtC4v")]),
    "هعم 104": ("رسم", [("الاختبارات", "1NX7xYTfs2jfuLvnLpa6p_L9GA2MrxmVS"), ("المصادر", "1s2ADLx_TVo1-Fxwic9VBHbx3eY34JIeT"), ("2D Paper.pdf", "1LHdBf8AktUp7ZV95tWVXiWhIv4-Tf698"), ("3D Paper.pdf", "1VOd7TQL2ZdWMQUIqQeXbdi2304sqtjqL"), ("AUTOCAD Sheet", "1C8co5afLGzQ8YV2UDUELJJNaULAAKsvW"), ("سجل العمل لمادة الرسم الهندسي.docx", "1Qy0VisXXYYzGrInHqwdib6YEhxPtwqmo")]),
    "ريض 203": ("", [("الاختبارات", "11BE0cYfZ8OtYu1-3GuccKiD-0vIfkE6K"), ("المصادر", "1-hAGvG5CRKsVigkx7Kz8gT4N8mYVsSrg")]),
    "فيز 104": ("", [("الاختبارات", "1JfYNzxtikmWLBiGioH-MIV0XtxTQvPZy"), ("العملي", "1p1ro4fm1sfSW4eZ0VZUu9xWBRS-_3SWB"), ("المصادر", "1Au7kjzDD3H2dCWRcB_z0QvPdUG8UZLTi"), ("سبر - فيز 104", "1ztQI4qRLV9KbutFSp0StG_ktCymnGe_C")]),
    "نجم 110": ("", [("أمثلة مشاريع", "1U3vCOPrBCD0k0Px16b1nWbZZAEqGoMft"), ("الاختبارات", "1iB1XT384f_Ktf9C_D4yv-3NRJ2vzINBi"), ("المصادر", "14VpfUkmOiaV-4MEU5CMsAC2_AGF2_ySS")]),
    "هعم 106": ("", [("Tutorials", "1pDZEcJSUf3aerOC1fABU-sh1iETaW_9w"), ("الاختبارات", "1kdaPhOXbJSpkzwqZzaxMAoX3bWfrAzsy"), ("المشروع", "1Hk-f3zmDTJQv3N-wYua99Jw5hKwwEbj-"), ("المصادر", "1T9Q_skADvPCasaCLSYUWsgsFNEI0rTRa")]),
    "هعم 201": ("ستاتيكا", [("1 _ الشرائح", "1wV-qieXS2kh-BfdNRokgFNbb4JssV8vN"), ("2 _ الكتب", "1YSEOXscNqjc5z_XmkXzwJrNNyb7EzDLb"), ("3 _ التمارين", "19aAH-2HbpONkQ-HL6qAdxF-W-W8ynqbf"), ("4 _ الاختبارات", "1XfnYemaz1Ig1piPNjRfDv70WbVVYun7M"), ("5 _ التقارير (MD)", "1QB3ax2XJBfsINsaLGkESrrEc4zEuwJbF"), ("سبر - هعم ٢٠١", "14qSX2owf5YP_z6ia2gfjyz8W3gJUPhiu"), ("خطة المادة.pdf", "1TTszm6kWAvSTQmAh7NRmcQO--87bwoVB")]),
    "هعم 203": ("بيئة", [("الاختبارات", "1PAG1TpaBvYXOWFya4GxPJkid7xNH2a6-"), ("المشروع", "1TZxAuKAupgKnPK0iKUEtiayVJVvKCaiJ"), ("المصادر", "15-xx9yLU2Z1J6KfXV_I2qRZvB907CGq-"), ("سبر- 203 هعم", "1MroL-qVg7IFqIXHThYC9hWbSceTKYsEL")]),
    "ريض 204": ("", [("0 | خطة المقرر + نصائح", "1QIxSg2vStlxfoLeJcb9J4uKOLZztLJl8"), ("1 | المصادر", "1zaorRfH2kXkb2i02Pg7MHdQwbjy-mPfU"), ("2 | الاختبارات", "1JYgweEyAe7q38tE84Kwt_rjXtBZk2emp")]),
    "ريض 254": ("", [("1 | شروح", "1qlYqoGXjTvZbKh5cOrJZFaR2sEpP2j0n"), ("2 | التمارين", "1mSMw-be_yrrGs2wpD6a6D4o8rfvQ_37g"), ("3 | الاختبارات", "1KWXcgsMhBWi2LzVS1ZT0H9UI7BJmnR28"), ("254", "1Z2g3xe5V7kM9hrbAWWVFnX6JY293xeg4"), ("REC-M254", "1kdYQTuUtY46Dk3rhzchAnmnxUsKrJvjI"), ("الكتاب", "1OASfPsJrommJ4784RgBINuT2V23NitOw"), ("توصيف المقرر", "1AyX6Dmhod-KHn2UTj-vqfHXA7ALfFDAy")]),
    "هعم 202": ("", [("اسئلة الخطة", "1Ri9TAttKNXc-eFseLnhp1_vf21hlBp3F"), ("الاختبارات", "18Lzmb2hJe-BOSiHr8jf9fk9rifNtdN7O"), ("المرجع", "1vLomlSkQF_J3IT_n8MJ2fJ-_ZdbtcyI9"), ("المصادر", "1S04bJ1S4hEv7gdW47QmYBLXo7xzauRzP"), ("ملفات الدكتور بسام البسام", "12PpadsfFpG1P_ykdha92rMAtFTJUoQ4e"), ("نوتات د.أحمد الخضير", "1Cx67A6ca-iGszj7BENFS6cycTocnij6S"), ("Syllabus_1_1448.pdf", "1CD2lLlzNgaL38fhdKZtkm5sM14CMdJTg"), ("دليل المقرر ( اجتهاد طلاب ).pdf", "1YhKNJt1CejyfvHrmadZCLCZKpv_Q4_Np"), ("مذكرة المهندس ابراهيم (محلولة).pdf", "1P1pVXRfhqNKO5gYEpTqUeCBb4_mC20dA"), ("ورقة معادلات الديناميكا.pdf", "1_tm8okXCPvSMnHCtozO_n7ESRdiZy3ee")]),
    "هعم 209": ("", [("1 _ شرائح د. مقراوي", "19CWCP55pGju3a8c8mswQmeFis5TJzcJX"), ("2 _ التمارين", "1sjqBPgr0ouDs4EntR1bKcpSVLAp4vat6"), ("3 _ الاختبارات", "1hXZ5e5sn7Jl1dpJwfKxXic9rdz_GdL4K"), ("GE209_Syllabus_481.pdf", "1DQ8L5QCBAnKf9ksmw5exPOXRZMz8GsRK"), ("الكتاب.pdf", "1xHO7t9_RY-7Jh8ShPTfruC4GjPTfWR_K")]),
    "هعم 211": ("برمجة", [("الاختبارات", "1qvxD-cTu3OE1gPU9g1pGr2pXIkEo1pVF"), ("المصادر", "1beo0gHOSgDLzhB9D2WSFHGwaBSERZg1b"), ("روابط لشرح مادة C++", "1Kz00jU1is53RHPgzphtyjtDO2dtyVP1zbu-4GIDJB5c"), ("نصائح ل C++.docx", "1xpm02a21jbjp55gVCYgR2TX8VJr_gOHc")]),
    "هعم 402": ("", [("اختبارات", "1CbUBixYJvybHMggOti4uqodmvb5Boe3A"), ("المصادر", "1FlWnptEqvwU-yQoNrjBysrMWixqc2RJt")]),
    "هعم 403": ("", [("الاختبارات", "1ilacsAlSqO2hbhoh_aHpNETx71tQynTd"), ("المصادر", "1jIZ_hQ-3mIBYIOrAErfyzBFGgbFPYt_P")]),
}
EN_PREFIX = {"سلم": "SALM", "ريض": "MATH", "فيز": "PHYS", "نجم": "NJM", "هعم": "GE"}


def classify(name: str) -> str:
    n = name.lower()
    if "اختبار" in n: return "exams"
    if "شرائح" in n: return "slides"
    if any(k in n for k in ("الكتب", "الكتاب", "المرجع")): return "textbooks"
    if any(k in n for k in ("التمارين", "شروح", "نوتات", "ملفات الدكتور", "مذكرة", "معادلات", "اسئلة الخطة")): return "notes"
    return "other"


def clean_title(name: str) -> str:
    return re.sub(r"^\d+\s*[_|]\s*", "", name).strip()


def url_for(name: str, drive_id: str) -> str:
    is_file = bool(re.search(r"\.(pdf|docx?|xlsx?|pptx?|jpe?g|png)$", name, re.I)) or len(drive_id) > 40 or name == "AUTOCAD Sheet"
    return f"https://drive.google.com/open?id={drive_id}" if is_file else f"https://drive.google.com/drive/folders/{drive_id}"


rows = []
for code, (label, items) in COURSES.items():
    prefix, number = code.split()
    for name, drive_id in items:
        rows.append({"code": code, "name_ar": label, "name_en": "", "type": classify(name), "title": clean_title(name),
                     "url": url_for(name, drive_id), "drive_name": name})

if "--no-verify" not in sys.argv:
    BIDI = re.compile("[‎‏‪-‮⁦-⁩]")

    def fetch(url):
        last = None
        for _ in range(3):  # transient disconnects happen
            try:
                resp = httpx.get(url, follow_redirects=True, timeout=30, headers={"Accept-Language": "en", "User-Agent": "Mozilla/5.0"})
                return resp, BIDI.sub("", (re.search(r"<title>(.*?)</title>", resp.text, re.S) or [None, ""])[1]).strip()
            except httpx.HTTPError as exc:
                last = exc
        raise last

    def check(r):
        drive_id = re.search(r"(?:folders/|id=)([\w-]+)", r["url"]).group(1)
        try:
            resp, title = fetch(r["url"])
            if resp.status_code == 404 and "/folders/" in r["url"]:  # an extension-less item that is really a file
                r["url"] = f"https://drive.google.com/open?id={drive_id}"
                resp, title = fetch(r["url"])
        except httpx.HTTPError as exc:
            return r, "ERR " + str(exc)[:60]
        low = title.lower()
        if resp.status_code != 200 or "sign in" in low or "sign-in" in low or not title:
            return r, f"NOT PUBLIC ({resp.status_code}, title={title!r})"
        if not title.startswith(BIDI.sub("", r["drive_name"]).strip()[:12]) and r["url"].startswith("https://drive.google.com/drive/folders/"):
            return r, f"TITLE MISMATCH (expected ~{r['drive_name']!r}, got {title!r})"
        return r, "ok"

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(check, rows))
    bad = [(r, s) for r, s in results if s != "ok"]
    print(f"verified {len(rows) - len(bad)}/{len(rows)} links publicly reachable")
    for r, s in bad:
        print(f"  {r['code']} | {r['drive_name']} | {s}")
    rows = [r for r, s in results if s == "ok"] if "--drop-bad" in sys.argv else rows

out = Path(__file__).parent / "drive-import.csv"
with out.open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["code", "name_ar", "name_en", "type", "title", "url"])
    for r in rows:
        w.writerow([r["code"], r["name_ar"], r["name_en"], r["type"], r["title"], r["url"]])
print(f"wrote {len(rows)} rows for {len(COURSES)} courses -> {out}")
from collections import Counter
print("types:", dict(Counter(r["type"] for r in rows)))
