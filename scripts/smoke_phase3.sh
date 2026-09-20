#!/bin/sh
# Phase 3 smoke test: authentication, Redis sessions, authorization, CSRF enforcement.
#
# Usage: smoke_phase3.sh [BASE_URL]
#   BASE_URL defaults to http://proxy (the nginx service name on the compose network).
#   From the host:  http://localhost:3000
#
# Exits 0 if every assertion passes, 1 otherwise.
#
# NOTE: cookies are extracted from Set-Cookie and replayed via an explicit Cookie
# header rather than curl's -b/-c jar, because jar replay proved unreliable here.
# This also exercises the same bytes a browser would send.

set -u

BASE="${1:-http://proxy}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CODE=""
COOKIES=""

# ---- payload fixtures (files, so no shell quoting can mangle them) ----
printf '%s' '{"username":"testuser","password":"password123"}' > "$TMP/user.json"
printf '%s' '{"username":"admin","password":"password123"}'    > "$TMP/admin.json"
printf '%s' '{"username":"testuser","password":"wrongpass"}'   > "$TMP/bad.json"
printf '%s' '{"username":"nosuchuser","password":"password123"}' > "$TMP/unknown.json"
printf '%s' '{"motto":"hello world"}'                          > "$TMP/motto.json"

# do_req METHOD URL COOKIE [DATAFILE]
#   sets $CODE, leaves body in $TMP/body and headers in $TMP/hdr
do_req() {
    _m="$1"; _u="$2"; _c="$3"; _d="${4:-}"
    if [ -n "$_d" ]; then
        CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
               -H "Cookie: $_c" -H 'Content-Type: application/json' \
               --data-binary "@$_d" "$_u")
    else
        CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
               -H "Cookie: $_c" "$_u")
    fi
}

# cookies_from_last_response -> "name=val; name2=val2"
cookies_from_last_response() {
    awk '/^[Ss]et-[Cc]ookie:/ {
            sub(/^[Ss]et-[Cc]ookie:[ \t]*/, "");
            sub(/;.*/, "");
            gsub(/\r/, "");
            printf "%s; ", $0
         }' "$TMP/hdr"
}

check() { # LABEL EXPECTED
    if [ "$2" = "$CODE" ]; then
        printf '  PASS  %-47s HTTP %s\n' "$1" "$CODE"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-47s expected %s, got %s\n' "$1" "$2" "$CODE"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    fi
}

echo "Phase 3 smoke test against $BASE"
echo

echo "[1] Public user authentication"
do_req POST "$BASE/api/auth/login" "" "$TMP/user.json"
check "login testuser" 200
USER_COOKIES="$(cookies_from_last_response)"

do_req POST "$BASE/api/auth/login" "" "$TMP/bad.json"
check "login rejects wrong password" 401

do_req POST "$BASE/api/auth/login" "" "$TMP/unknown.json"
check "login rejects unknown user" 401

echo
echo "[2] Session round-trip"
if [ -z "$USER_COOKIES" ]; then
    printf '  FAIL  %-47s no Set-Cookie returned by login\n' "login issued a session cookie"
    FAIL=$((FAIL + 1))
else
    printf '  PASS  %-47s %s\n' "login issued a session cookie" "$(printf '%s' "$USER_COOKIES" | cut -c1-40)..."
    PASS=$((PASS + 1))
fi

do_req GET "$BASE/api/me" "$USER_COOKIES"
check "GET /api/me with session" 200
printf '        user: %s\n' "$(cat "$TMP/body" | tr -d '\n' | cut -c1-120)"

do_req GET "$BASE/api/me" ""
check "GET /api/me without session" 401

echo
echo "[3] Authorization (non-staff must not reach staff surface)"
do_req GET "$BASE/api/admin/test-gate" "$USER_COOKIES"
check "staff gate blocks non-staff" 403

echo
echo "[4] Staff step-up (separate cookie + Redis keyspace)"
do_req POST "$BASE/api/auth/staff-login" "" "$TMP/admin.json"
check "staff-login as admin" 200
STAFF_COOKIES="$(cookies_from_last_response)"

case "$STAFF_COOKIES" in
    *hotel_staff_session*)
        printf '  PASS  %-47s %s\n' "staff cookie is hotel_staff_session" "distinct from hotel_session"
        PASS=$((PASS + 1)) ;;
    *)
        printf '  FAIL  %-47s got: %s\n' "staff cookie is hotel_staff_session" "$STAFF_COOKIES"
        FAIL=$((FAIL + 1)) ;;
esac

do_req GET "$BASE/api/admin/test-gate" "$STAFF_COOKIES"
check "staff gate allows staff" 200

echo
echo "[5] CSRF enforcement on mutating routes"
do_req POST "$BASE/api/account/motto" "$USER_COOKIES" "$TMP/motto.json"
check "mutation without CSRF token" 403

echo
echo "[6] Debug surface removed"
do_req POST "$BASE/api/test/echo" "" "$TMP/user.json"
check "removed debug route is gone" 404

echo
echo "---------------------------------------------"
printf 'passed: %s   failed: %s\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    echo "RESULT: FAIL"
    exit 1
fi

echo "RESULT: PASS"
exit 0
