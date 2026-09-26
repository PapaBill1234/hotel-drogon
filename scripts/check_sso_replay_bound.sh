#!/bin/sh
# SSO ticket replay bound: the website voids its own ticket on schedule.
#
# Usage: check_sso_replay_bound.sh [BASE_URL] [DB_CONTAINER] [DB_USER] [DB_PASS] [DB_NAME]
#   BASE_URL      defaults to http://proxy (the nginx service name on the compose network)
#   DB_CONTAINER  defaults to hotel_mariadb
#   From the host:  sh scripts/check_sso_replay_bound.sh http://localhost:3000
#
# Exits 0 if every assertion passes, 1 otherwise.
#
# Why this exists as a live check and not only a browser suite: the claim under
# test is about a row. Polaris matches `users.auth_ticket` at game login WITHOUT
# consulting an expiry, consumes it, then restores it during its reconnect grace
# and leaves it on the row after a full disconnect — so a ticket taken from
# browser history would open the account indefinitely. The website therefore
# bounds the credential itself, and the only place that bound is observable is
# the row. A change that quietly stopped sweeping, or that cleared the ticket to
# an empty string (which the emulator's restore would happily write back into),
# would still look fine over HTTP; here it fails.
#
# Requires the Docker CLI because the assertion is a database read. Set
# SSO_TICKET_TTL_SECONDS to the same value the stack was started with.

set -u

BASE="${1:-http://proxy}"
DB_CONTAINER="${2:-hotel_mariadb}"
DB_USER="${3:-hotel}"
DB_PASS="${4:-hotel_secret}"
DB_NAME="${5:-polaris}"

TTL="${SSO_TICKET_TTL_SECONDS:-120}"
SWEEP="${SSO_TICKET_SWEEP_SECONDS:-5}"
USERNAME="${SMOKE_USER:-testuser}"
PASSWORD="${SMOKE_PASSWORD:-password123}"

# The value the client presents must be shorter than this; a voided ticket is
# longer, so it can never be presented. Both PolarIS doors cap at 128.
PRESENTABLE_MAX=128

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CODE=""
COOKIES=""

pass() { printf '  PASS  %-56s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %-56s %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

expect_eq() { # LABEL ACTUAL EXPECTED
    if [ "$2" = "$3" ]; then pass "$1" "$2"; else fail "$1" "expected '$3', got '$2'"; fi
}

expect_ne() { # LABEL ACTUAL UNEXPECTED
    if [ "$2" != "$3" ]; then pass "$1" "differs"; else fail "$1" "still '$3'"; fi
}

expect_gt() { # LABEL ACTUAL FLOOR
    if [ "$2" -gt "$3" ] 2>/dev/null; then pass "$1" "$2"; else fail "$1" "expected > $3, got '$2'"; fi
}

printf '%s' "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" > "$TMP/user.json"

# do_req METHOD URL COOKIE [EXTRA_HEADER] [DATAFILE]
do_req() {
    _m="$1"; _u="$2"; _c="$3"; _h="${4:-}"; _d="${5:-}"
    if [ -n "$_d" ]; then
        if [ -n "$_h" ]; then
            CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
                   -H "Cookie: $_c" -H "$_h" -H 'Content-Type: application/json' \
                   --data-binary "@$_d" "$_u")
        else
            CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
                   -H "Cookie: $_c" -H 'Content-Type: application/json' \
                   --data-binary "@$_d" "$_u")
        fi
    else
        if [ -n "$_h" ]; then
            CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
                   -H "Cookie: $_c" -H "$_h" "$_u")
        else
            CODE=$(curl -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m" \
                   -H "Cookie: $_c" "$_u")
        fi
    fi
}

cookies_from_last_response() {
    awk '/^[Ss]et-[Cc]ookie:/ {
            sub(/^[Ss]et-[Cc]ookie:[ \t]*/, "");
            sub(/;.*/, "");
            gsub(/\r/, "");
            printf "%s; ", $0
         }' "$TMP/hdr"
}

cookie_value() { # NAME -> value from $COOKIES
    printf '%s' "$COOKIES" | tr ';' '\n' | sed -n "s/^ *$1=//p" | tr -d '\r' | head -1
}

json_string() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$TMP/body" | head -1; }
json_number() { sed -n "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p" "$TMP/body" | head -1; }

db_scalar() { # SQL -> single value
    docker exec "$DB_CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -B -e "$1" 2>/dev/null
}

stored_ticket() {
    db_scalar "SELECT auth_ticket FROM users WHERE username='$USERNAME' LIMIT 1"
}

# sign_in -> sets $COOKIES, exits non-zero on failure
sign_in() {
    do_req POST "$BASE/api/auth/login" "" "" "$TMP/user.json"
    if [ "$CODE" != "200" ]; then
        printf '  FAIL  %-56s HTTP %s: %s\n' "login $USERNAME" "$CODE" "$(cat "$TMP/body")"
        FAIL=$((FAIL + 1))
        return 1
    fi
    COOKIES="$(cookies_from_last_response)"
    return 0
}

# issue_ticket -> sets $TICKET and $VOID_AT
issue_ticket() {
    _csrf="$(cookie_value XSRF-TOKEN)"
    do_req POST "$BASE/api/account/client-entry" "$COOKIES" "X-XSRF-TOKEN: $_csrf"
    if [ "$CODE" != "200" ]; then
        printf '  FAIL  %-56s HTTP %s: %s\n' "client-entry" "$CODE" "$(cat "$TMP/body")"
        FAIL=$((FAIL + 1))
        return 1
    fi
    TICKET="$(json_string sso_ticket)"
    VOID_AT="$(json_number sso_ticket_void_at)"
    return 0
}

echo "SSO ticket replay bound against $BASE (TTL ${TTL}s, sweep ${SWEEP}s)"
echo

echo "[1] A request issues a ticket and states when it dies"
sign_in || exit 1
case "$COOKIES" in
    *hotel_session*) pass "login issued a session cookie" "hotel_session" ;;
    *) fail "login issued a session cookie" "got: $COOKIES" ;;
esac

NOW_BEFORE="$(date +%s)"
issue_ticket || exit 1
expect_eq "the ticket is in the legacy 36-character shape" "${#TICKET}" "36"
expect_gt "the response states a void deadline in the future" "$VOID_AT" "$NOW_BEFORE"
if [ -n "$VOID_AT" ] && [ "$VOID_AT" -gt 0 ] 2>/dev/null; then
    WINDOW=$((VOID_AT - NOW_BEFORE))
    if [ "$WINDOW" -le $((TTL + 2)) ]; then
        pass "the deadline honours the configured ${TTL}s window" "${WINDOW}s"
    else
        fail "the deadline honours the configured ${TTL}s window" "${WINDOW}s"
    fi
fi

ROW="$(stored_ticket)"
expect_eq "the issued ticket is the one on the row" "$ROW" "$TICKET"

echo
echo "[2] The website voids it at the deadline, with a value the client cannot present"
NOW="$(date +%s)"
WAIT=$((VOID_AT - NOW + SWEEP + 3))
if [ "$WAIT" -gt 0 ]; then
    printf '        waiting %ss for the deadline and a sweep\n' "$WAIT"
    sleep "$WAIT"
fi

ROW="$(stored_ticket)"
expect_ne "the ticket is gone from the row after its window" "$ROW" "$TICKET"
if [ -z "$ROW" ]; then
    # An empty column is exactly what the emulator's reconnect grace restores a
    # consumed ticket into, so this is the failure mode that looks like success.
    fail "the void left a value the client cannot present" "row is empty"
else
    expect_gt "the void value is longer than any presentable ticket" "${#ROW}" "$PRESENTABLE_MAX"
    case "$ROW" in
        void-*) pass "the void value is recognisable as a void" "void-…" ;;
        *) fail "the void value is recognisable as a void" "got: $(printf '%s' "$ROW" | cut -c1-24)…" ;;
    esac
fi

echo
echo "[3] A later request still issues a working ticket"
issue_ticket || exit 1
ROW="$(stored_ticket)"
expect_eq "a fresh ticket replaces the void value" "$ROW" "$TICKET"

echo
echo "[4] Signing out voids the ticket immediately"
sign_in || exit 1
issue_ticket || exit 1
LOGOUT_TICKET="$TICKET"
CSRF="$(cookie_value XSRF-TOKEN)"
do_req POST "$BASE/api/auth/logout" "$COOKIES" "X-XSRF-TOKEN: $CSRF"
expect_eq "logout succeeds" "$CODE" "200"
ROW="$(stored_ticket)"
expect_ne "the ticket is gone from the row right after sign-out" "$ROW" "$LOGOUT_TICKET"
if [ -n "$ROW" ]; then
    expect_gt "sign-out also leaves a value the client cannot present" "${#ROW}" "$PRESENTABLE_MAX"
fi

echo
echo "=== ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ]
