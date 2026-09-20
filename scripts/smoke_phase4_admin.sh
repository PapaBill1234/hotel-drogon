#!/bin/sh
# Phase 4 admin CMS API smoke test.
#
# Usage: smoke_phase4_admin.sh [BASE_URL]
#   BASE_URL defaults to http://proxy (nginx service name on the compose network).
#   From the host:  http://localhost:3000
#
# Covers: staff auth, CRUD, validation errors, CSRF enforcement, role gates,
# and the high-trust boundary on raw-HTML banner content.
#
# Exits 0 if every assertion passes, 1 otherwise.

set -u

BASE="${1:-http://proxy}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CODE=""
COOKIES=""

jget() { # FILE KEY -> first string value
    grep -o "\"$2\":\"[^\"]*\"" "$1" 2>/dev/null | head -1 | sed 's/.*:"//; s/"$//'
}

jnum() { # FILE KEY -> first numeric value (jsoncpp emits ids as numbers)
    grep -o "\"$2\":[0-9][0-9]*" "$1" 2>/dev/null | head -1 | sed 's/.*://'
}

do_req() { # METHOD URL COOKIE [DATAFILE]
    _m="$1"; _u="$2"; _c="$3"; _d="${4:-}"
    if [ -n "$_d" ]; then
        CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
               -H "Cookie: $_c" -H 'Content-Type: application/json' \
               -H "X-XSRF-TOKEN: $CSRF" --data-binary "@$_d" "$_u")
    else
        CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
               -H "Cookie: $_c" -H "X-XSRF-TOKEN: $CSRF" "$_u")
    fi
}

cookies_from_hdr() {
    awk '/^[Ss]et-[Cc]ookie:/ {
            sub(/^[Ss]et-[Cc]ookie:[ \t]*/, ""); sub(/;.*/, ""); gsub(/\r/, "");
            printf "%s; ", $0
         }' "$TMP/hdr"
}

check() { # LABEL EXPECTED
    if [ "$2" = "$CODE" ]; then
        printf '  PASS  %-52s HTTP %s\n' "$1" "$CODE"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s expected %s, got %s\n' "$1" "$2" "$CODE"
        printf '        body: %s\n' "$(head -c 200 "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    fi
}

contains() { # LABEL NEEDLE
    if grep -q -- "$2" "$TMP/body" 2>/dev/null; then
        printf '  PASS  %-52s found "%s"\n' "$1" "$2"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s missing "%s"\n' "$1" "$2"
        printf '        body: %s\n' "$(head -c 200 "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    fi
}

header_present() { # LABEL HEADER
    if grep -qi -- "$2" "$TMP/hdr" 2>/dev/null; then
        printf '  PASS  %-52s present\n' "$1"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s absent\n' "$1"
        FAIL=$((FAIL + 1))
    fi
}

printf '%s' '{"username":"admin","password":"password123"}'    > "$TMP/admin.json"
printf '%s' '{"username":"staff5","password":"password123"}'   > "$TMP/staff5.json"
printf '%s' '{"username":"testuser","password":"password123"}' > "$TMP/user.json"
printf '%s' '{"title":"Phase4 Smoke","summary":"summary text","story":"story text","author":"smoke"}' > "$TMP/news.json"
printf '%s' '{"title":"","summary":"s","story":"s","author":"a"}' > "$TMP/news_bad.json"

echo "Phase 4 admin API smoke test against $BASE"
echo

# ---------------------------------------------------------------- auth
echo "[1] Staff authentication"
CSRF=""
do_req POST "$BASE/api/auth/login" "" "$TMP/admin.json"
check "admin user login" 200
ADMIN_CSRF=$(jget "$TMP/body" csrf_token)
ADMIN_COOKIES="$(cookies_from_hdr)"

do_req POST "$BASE/api/auth/staff-login" "" "$TMP/admin.json"
check "admin staff login" 200
STAFF_COOKIES="$(cookies_from_hdr)"

ADMIN_ALL="$ADMIN_COOKIES$STAFF_COOKIES"
CSRF="$ADMIN_CSRF"
if [ -z "$ADMIN_ALL" ]; then
    echo "  FATAL: no cookies issued; aborting"
    exit 1
fi

# --------------------------------------------------------------- CRUD
echo
echo "[2] News CRUD (staff rank 7)"
do_req GET "$BASE/api/admin/news" "$ADMIN_ALL"
check "list news" 200

do_req POST "$BASE/api/admin/news" "$ADMIN_ALL" "$TMP/news.json"
check "create news" 200
NEWS_ID=$(jnum "$TMP/body" id)
printf '        created id=%s\n' "${NEWS_ID:-?}"

do_req GET "$BASE/api/admin/news" "$ADMIN_ALL"
check "list news after create" 200
contains "created article is listed" "Phase4 Smoke"

if [ -n "${NEWS_ID:-}" ]; then
    printf '%s' '{"title":"Phase4 Smoke (edited)","summary":"s2","story":"st2","author":"smoke"}' > "$TMP/news_upd.json"
    do_req PUT "$BASE/api/admin/news/$NEWS_ID" "$ADMIN_ALL" "$TMP/news_upd.json"
    check "update news" 200

    do_req DELETE "$BASE/api/admin/news/$NEWS_ID" "$ADMIN_ALL"
    check "delete news" 200
fi

echo
echo "[3] Validation"
do_req POST "$BASE/api/admin/news" "$ADMIN_ALL" "$TMP/news_bad.json"
check "empty title rejected" 400
contains "validation names the bad field" '"field":"title"'

echo
echo "[4] Audit trail"
# Audit rows land in phpretro_admin_action_log, which has no read endpoint;
# they are asserted separately against the database (see the runbook), so this
# step only confirms the write path executed.
do_req GET "$BASE/api/admin/news" "$ADMIN_ALL"
check "news list readable after writes" 200

# ------------------------------------------------------- role gates
echo
echo "[5] Role gates"
CSRF=""
do_req POST "$BASE/api/auth/login" "" "$TMP/user.json"
USER_CSRF=$(jget "$TMP/body" csrf_token)
USER_COOKIES="$(cookies_from_hdr)"
CSRF="$USER_CSRF"
do_req GET "$BASE/api/admin/news" "$USER_COOKIES"
check "non-staff user blocked" 403

# ------------------------------------------------------- CSRF gate
echo
echo "[6] CSRF enforcement"
CSRF=""
do_req POST "$BASE/api/admin/news" "$ADMIN_ALL" "$TMP/news.json"
check "mutation without CSRF token" 403
CSRF="$ADMIN_CSRF"

# ------------------------------------------------- high-trust boundary
echo
echo "[7] High-trust raw-HTML banner gating"
printf '%s' '{"text":"plain banner","banner":"b.png","url":"/x","html":"<b>safe</b>"}' > "$TMP/banner_plain.json"
do_req POST "$BASE/api/admin/banners" "$ADMIN_ALL" "$TMP/banner_plain.json"
check "plain banner as rank 7" 200

printf '%s' '{"text":"raw","banner":"b.png","url":"/x","html":"<script>alert(1)</script>"}' > "$TMP/banner_raw.json"
do_req POST "$BASE/api/admin/banners" "$ADMIN_ALL" "$TMP/banner_raw.json"
check "raw-HTML banner as rank 7 (high trust)" 200
contains "response carries a visible warning" "warning"

# rank-5 staff must NOT be able to write raw markup
CSRF=""
do_req POST "$BASE/api/auth/login" "" "$TMP/staff5.json"
S5_CSRF=$(jget "$TMP/body" csrf_token)
S5_COOKIES="$(cookies_from_hdr)"
do_req POST "$BASE/api/auth/staff-login" "" "$TMP/staff5.json"
S5_STAFF="$(cookies_from_hdr)"
S5_ALL="$S5_COOKIES$S5_STAFF"
CSRF="$S5_CSRF"

if [ -n "$S5_ALL" ] && [ -n "$S5_CSRF" ]; then
    do_req POST "$BASE/api/admin/banners" "$S5_ALL" "$TMP/banner_plain.json"
    check "plain banner as rank 5" 200

    do_req POST "$BASE/api/admin/banners" "$S5_ALL" "$TMP/banner_raw.json"
    check "raw-HTML banner as rank 5 is refused" 403
    header_present "high-trust marker on denial" "X-High-Trust-Required"
else
    echo "  SKIP  rank-5 staff checks (staff5 user missing)"
fi

echo
echo "---------------------------------------------"
printf 'passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
exit 0
