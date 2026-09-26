#!/usr/bin/env python3
"""
Phase 4 public content API smoke test.

Usage: smoke_phase4_public.py [BASE_URL]     (default http://proxy)

Covers the anonymous /api/public/* surface and, most importantly, asserts the
RSS feed escapes exactly ONCE. Legacy xml/rss.php escaped the title twice
(once into $row['title'], again on echo), so "Rock & Roll" rendered as
"Rock &amp;amp; Roll". The decisive check is a round-trip: a correctly escaped
feed parses back to the ORIGINAL title string, whereas a double-escaped one
parses back to the '&amp;' form.

Exits 0 if every assertion passes, 1 otherwise.
"""

import json
import sys
import urllib.error
import urllib.request
import http.cookiejar
import xml.etree.ElementTree as ET

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://proxy"

PASS = 0
FAIL = 0


def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        print(f"  PASS  {label}")
        PASS += 1
    else:
        print(f"  FAIL  {label}" + (f"\n        {detail}" if detail else ""))
        FAIL += 1


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request(opener, method, path, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with opener.open(req, timeout=15) as resp:
            raw = resp.read()
            return resp.status, raw, dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def request_raw(opener, path):
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with opener.open(req, timeout=15) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


print(f"Phase 4 public API smoke test against {BASE}\n")

# ---------------------------------------------------------------- setup
admin = make_opener()
status, raw, _ = request(admin, "POST", "/api/auth/login",
                         {"username": "admin", "password": "password123"})
if status != 200:
    print(f"  FATAL: admin login failed ({status}): {raw[:200]}")
    sys.exit(1)
csrf = json.loads(raw)["csrf_token"]

status, raw, _ = request(admin, "POST", "/api/auth/staff-login",
                         {"username": "admin", "password": "password123"})
if status != 200:
    print(f"  FATAL: staff login failed ({status}): {raw[:200]}")
    sys.exit(1)

# A title containing every XML metacharacter, so any double-escaping shows up.
TRICKY_TITLE = 'Rock & Roll <B> "quoted" it\'s'
TRICKY_SUMMARY = "Summary with & and <tags> too"

status, raw, _ = request(admin, "POST", "/api/admin/news",
                         {"title": TRICKY_TITLE, "summary": TRICKY_SUMMARY,
                          "story": "body", "author": "smoke"},
                         {"X-XSRF-TOKEN": csrf})
check("create article with XML metacharacters in title", status == 200,
      f"status={status} body={raw[:200]}")
created_id = json.loads(raw)["id"] if status == 200 else None

# ------------------------------------------------------- public surface
print("\n[1] Public content endpoints")
anon = make_opener()
for path, label in [
    ("/api/public/landing", "landing"),
    ("/api/public/news", "news list"),
    ("/api/public/community-news", "community promo (hotelview_news)"),
    ("/api/public/faq", "faq"),
    ("/api/public/collectibles", "collectibles"),
    ("/api/public/banners", "banners"),
    ("/api/public/campaigns", "campaigns"),
    ("/api/public/maintenance", "maintenance"),
    ("/api/public/settings", "settings"),
]:
    status, raw, _ = request_raw(anon, path)
    check(f"GET {path} ({label})", status == 200, f"status={status}")

print("\n[2] Raw markup is never published")
status, raw, _ = request_raw(anon, "/api/public/banners")
check("banner listing omits the raw html field", b'"html"' not in raw,
      f"body={raw[:200]}")

print("\n[2b] The community promo reads hotelview_news, not phpretro_news")
# /community and the frontpage use two DIFFERENT legacy news tables. The promo
# widget rendered the wrong one, so assert the shape only hotelview_news has:
# a `text` body field. `phpretro_news` rows carry `summary` instead, so a
# regression that re-points the widget at the wrong table fails here even
# though both endpoints return 200.
status, raw, _ = request_raw(anon, "/api/public/community-news")
check("GET /api/public/community-news", status == 200, f"status={status}")
try:
    promo = json.loads(raw)
except ValueError as e:
    promo = {}
    check("community-news returns JSON", False, str(e))
items = promo.get("items", [])
if items:
    first = items[0]
    check("promo rows expose a hotelview_news `text` field", "text" in first,
          f"keys={sorted(first)}")
    check("promo rows do NOT expose the phpretro_news `summary` field",
          "summary" not in first, f"keys={sorted(first)}")
else:
    # Not a failure on its own -- an operator may legitimately have no promo --
    # but it must be visible, since an empty widget is the bug this guards.
    print("  NOTE: hotelview_news is empty, so the promo renders blank slots")

print("\n[3] RSS feed")
status, raw, headers = request_raw(anon, "/articles/rss.xml")
check("GET /articles/rss.xml (legacy path)", status == 200, f"status={status}")
ctype = headers.get("Content-Type", "")
check("served as XML", "xml" in ctype.lower(), f"Content-Type={ctype!r}")

text = raw.decode("utf-8", errors="replace")
try:
    root = ET.fromstring(raw)
    parsed_ok = True
except ET.ParseError as e:
    root = None
    parsed_ok = False
    check("feed is well-formed XML", False, str(e))
if parsed_ok:
    check("feed is well-formed XML", True)

check("no double-escaped entity in feed (&amp;amp;)", "&amp;amp;" not in text,
      "feed contains a double-escaped ampersand")

if root is not None:
    titles = [el.text for el in root.iter("title")]
    # Round-trip: the parsed title must equal the original, unescaped string.
    check("title round-trips to the original string",
          TRICKY_TITLE in titles,
          f"expected {TRICKY_TITLE!r}; got {titles!r}")

    summaries = [el.text for el in root.iter("description")]
    check("summary round-trips to the original string",
          TRICKY_SUMMARY in summaries,
          f"expected {TRICKY_SUMMARY!r}; got {summaries!r}")

    check("title escaped exactly once in raw XML",
          "Rock &amp; Roll" in text,
          "expected '&amp;' form in the raw feed")

# ------------------------------------------------------------- cleanup
if created_id:
    request(admin, "DELETE", f"/api/admin/news/{created_id}", None,
            {"X-XSRF-TOKEN": csrf})

print("\n---------------------------------------------")
print(f"passed: {PASS}   failed: {FAIL}")
if FAIL:
    print("RESULT: FAIL")
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
