"""Arabic/English normalisation + URL helpers shared by routers (mirrors frontend/src/lib/search.ts)."""

import ipaddress
import re
from typing import Optional
from urllib.parse import urlparse

_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_SEPARATORS = re.compile(r"[\s\-_./]+")


def norm(text: str) -> str:
    s = _DIACRITICS.sub("", text or "").translate(_DIGITS).lower()
    s = re.sub("[أإآٱ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return _SEPARATORS.sub("", s)


def norm_number(number: str) -> str:
    return norm(number).upper()


NUMBER_RE = re.compile(r"^\d{3}[A-Z]?$")


def split_code(code: str) -> tuple[str, str]:
    """'ريض 106' / 'MATH-106' -> ('ريض', '106') with the prefix normalised."""
    s = norm(code)
    m = re.match(r"^(\D+?)(\d.*)$", s)
    if not m:
        return s, ""
    return m.group(1), m.group(2).upper()


# ---------- URLs ----------


_INTERNAL_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet")


def public_host(host: str) -> bool:
    """False for IP literals that aren't globally routable (loopback, private, link-local...) and
    obviously internal names. DNS-level checks happen again at fetch time in lib/linkcheck.py."""
    host = (host or "").lower().strip("[]")
    if not host or host == "localhost" or host.endswith(_INTERNAL_SUFFIXES):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        pass  # not an IP literal
    # catch dotted forms like 0x7f.1 / 017.0.0.1 that some resolvers read as IPs: TLD must contain a letter
    return not host.rsplit(".", 1)[-1].replace("-", "").isdigit() and not host.rsplit(".", 1)[-1].lower().startswith("0x")


def valid_https(url: str) -> bool:
    if not url or len(url) > 2000 or any(c.isspace() for c in url):
        return False
    try:
        p = urlparse(url)
        host = (p.hostname or "").lower()
        p.port  # raises ValueError on a malformed port
    except ValueError:
        return False
    return p.scheme == "https" and "." in host and not host.endswith(".") and public_host(host)


def is_personal_contact(url: str) -> bool:
    low = url.strip().lower()
    if low.startswith(("tel:", "mailto:", "whatsapp:", "sms:")):
        return True
    p = urlparse(low)
    host = p.hostname or ""
    if host in ("wa.me", "www.wa.me"):
        return True
    return host in ("api.whatsapp.com", "web.whatsapp.com") and p.path.startswith("/send")


def detect_source(url: Optional[str]) -> str:
    host = (urlparse(url or "").hostname or "").lower()
    if host.endswith(("drive.google.com", "docs.google.com")):
        return "gdrive"
    if host.endswith(("onedrive.live.com", "1drv.ms", "sharepoint.com", "onedrive.com")):
        return "onedrive"
    if host.endswith(("youtube.com", "youtu.be", "youtube-nocookie.com")):
        return "youtube"
    return "other"
