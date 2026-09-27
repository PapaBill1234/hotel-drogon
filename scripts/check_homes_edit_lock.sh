#!/bin/sh
# The MyHabbo edit lock: a home that is already being edited refuses a second
# editor's save, and refuses it as 423 rather than as a lost update.
#
# Usage: check_homes_edit_lock.sh [BASE_URL] [REDIS_CONTAINER]
#   BASE_URL         defaults to http://proxy (the nginx service name on the compose network)
#   REDIS_CONTAINER  defaults to hotel_redis
#   From the host:  sh scripts/check_homes_edit_lock.sh http://localhost:3000
#
# Exits 0 if every assertion passes, 1 otherwise.
#
# Why this is a separate live check rather than part of smoke_phase8_homes.sh:
# a user home is edited by its owner and nobody else, so two *different* accounts
# are refused by the ownership rule (403) before the lock is ever consulted. The
# lock's refusal path is therefore unreachable through the API alone today — it
# becomes reachable the moment group homes arrive, where the owner and the
# group's level-1 administrators edit one page. Rather than leave the mechanism
# untested until then, this seeds a foreign lock straight into Redis and asserts
# what the API does with it.
#
# Requires the Docker CLI, because seeding the lock is the whole point: the API
# has no way to hand one account's lock to another, which is a property worth
# keeping.
#
# The version compare-and-swap is the other half of the guarantee and is tested
# in smoke_phase8_homes.sh section 7 (two concurrent saves with one version:
# exactly one is applied). This script covers the lock; the two are independent
# mechanisms and both are asserted.

set -u

BASE="${1:-http://proxy}"
REDIS_CONTAINER="${2:-hotel_redis}"
FOREIGN_HOLDER=99

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CODE=""

pass() { printf '  PASS  %-56s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %-56s %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

check() { # LABEL EXPECTED
    if [ "$2" = "$CODE" ]; then
        pass "$1" "HTTP $CODE"
    else
        fail "$1" "expected $2, got $CODE"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
    fi
}

check_body() { # LABEL NEEDLE
    if grep -q -- "$2" "$TMP/body" 2>/dev/null; then
        pass "$1" "body contains $2"
    else
        fail "$1" "body lacks $2"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
    fi
}

redis_cli() {
    docker exec "$REDIS_CONTAINER" redis-cli "$@"
}

do_req() {
    _m="$1"; _u="$2"; _c="$3"; _d="${4:-}"; _csrf="${5:-}"
    set -- -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m"
    set -- "$@" -H 'Content-Type: application/json'
    if [ -n "$_c" ]; then set -- "$@" -H "Cookie: $_c"; fi
    if [ -n "$_csrf" ]; then set -- "$@" -H "X-XSRF-TOKEN: $_csrf"; fi
    if [ -n "$_d" ]; then set -- "$@" --data-binary "@$_d"; fi
    set -- "$@" "$_u"
    CODE=$(curl "$@")
}

cleanup() {
    redis_cli DEL homes_edit_lock:2 >/dev/null 2>&1
}

echo "Homes edit lock check against $BASE (redis: $REDIS_CONTAINER)"
echo

if ! redis_cli PING >/dev/null 2>&1; then
    echo "  FAIL  the Redis container '$REDIS_CONTAINER' is not reachable; this check needs it" >&2
    exit 1
fi
trap 'cleanup; rm -rf "$TMP"' EXIT

# Start from a known state, and leave the home unlocked at the end.
cleanup

printf '%s' '{"username":"testuser","password":"password123"}' > "$TMP/user.json"
do_req POST "$BASE/api/auth/login" "" "$TMP/user.json"
check "sign in as the home owner" 200
COOKIES="$(awk '/^[Ss]et-[Cc]ookie:/ {
        sub(/^[Ss]et-[Cc]ookie:[ \t]*/, ""); sub(/;.*/, ""); gsub(/\r/, "");
        printf "%s; ", $0 }' "$TMP/hdr")"
CSRF="$(printf '%s' "$COOKIES" | tr ';' '\n' | sed -n 's/^[ \t]*XSRF-TOKEN=//p' | head -1)"

echo
echo "[1] With no lock held, the owner can open a session and save"
do_req POST "$BASE/api/homes/2/edit-session" "$COOKIES" "" "$CSRF"
check "owner opens an edit session" 200
TOKEN="$(tr ',' '\n' < "$TMP/body" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' | head -1)"
VERSION="$(do_req GET "$BASE/api/homes/2/layout" "$COOKIES"; tr ',' '\n' < "$TMP/body" | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -1)"
printf '{"version":%s,"lock_token":"%s","widgets":[]}' "$VERSION" "$TOKEN" > "$TMP/save.json"
do_req PUT "$BASE/api/homes/2/layout" "$COOKIES" "$TMP/save.json" "$CSRF"
check "owner saves with its own lock" 200

# Re-read the version the save produced, and rebuild the payload against it: the
# assertion in section 2 is that a REFUSED save does not move the version, which
# only means something if the payload would otherwise have been accepted.
do_req GET "$BASE/api/homes/2/layout" "$COOKIES"
VERSION="$(tr ',' '\n' < "$TMP/body" | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -1)"
printf '{"version":%s,"lock_token":"%s","widgets":[]}' "$VERSION" "$TOKEN" > "$TMP/save.json"

echo
echo "[2] A lock held by somebody else refuses the owner's writes"
redis_cli SET homes_edit_lock:2 "$FOREIGN_HOLDER:seedtoken" EX 300 >/dev/null
SOWNED="$(redis_cli GET homes_edit_lock:2)"
if [ "$SOWNED" = "$FOREIGN_HOLDER:seedtoken" ]; then
    pass "a foreign lock is in place" "$SOWNED"
else
    fail "a foreign lock is in place" "redis holds '$SOWNED'"
fi

do_req POST "$BASE/api/homes/2/edit-session" "$COOKIES" "" "$CSRF"
check "the owner cannot open a session on a locked home" 423
check_body "the refusal names the lock" '"error":"Locked"'

do_req GET "$BASE/api/homes/2/layout" "$COOKIES" ""
check "the lock is still readable" 200
check_body "the read reports the foreign holder" "\"holder_user_id\":$FOREIGN_HOLDER"
check_body "the read does not hand over the token" '"is_mine":false'

do_req PUT "$BASE/api/homes/2/layout" "$COOKIES" "$TMP/save.json" "$CSRF"
check "the owner cannot save on a locked home" 423

# The version must not have moved: a refused save is refused, not applied-then-reported.
VERSION_AFTER="$(do_req GET "$BASE/api/homes/2/layout" "$COOKIES"; tr ',' '\n' < "$TMP/body" | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -1)"
if [ "$VERSION_AFTER" = "$VERSION" ]; then
    pass "the refused save left the version alone" "version $VERSION_AFTER"
else
    fail "the refused save left the version alone" "was $VERSION, now $VERSION_AFTER"
fi

echo
echo "[3] Releasing the foreign lock restores the owner's access"
redis_cli DEL homes_edit_lock:2 >/dev/null
do_req POST "$BASE/api/homes/2/edit-session" "$COOKIES" "" "$CSRF"
check "the owner can open a session again" 200

printf '{"lock_token":"%s"}' "$(tr ',' '\n' < "$TMP/body" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' | head -1)" \
    > "$TMP/release.json"
do_req DELETE "$BASE/api/homes/2/edit-session" "$COOKIES" "$TMP/release.json" "$CSRF"
check "the owner releases its session" 200

do_req GET "$BASE/api/homes/2/layout" "$COOKIES" ""
check_body "the home is unlocked at the end" '"held":false'

echo
echo "Homes edit lock check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
