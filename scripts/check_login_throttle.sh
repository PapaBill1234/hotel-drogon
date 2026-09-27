#!/bin/sh
# Login throttling, against a live stack.
#
# The unit tests cover the boundary arithmetic, the key encoding and the refusal
# message without a server. What they cannot show is the behaviour that only
# exists when Redis, MariaDB and the HTTP layer are all real: that five
# consecutive failures land on the sixth attempt, that the refusal happens
# *before* the password is compared, that concurrent failures are counted
# without losing one, that a success clears the account's counter, that all four
# routes which check a password share those counters, and that the CSRF filter
# still runs in front of the throttle.
#
# Usage: check_login_throttle.sh [BASE_URL] [REDIS_CONTAINER]
#   BASE_URL         defaults to http://proxy (the nginx service name on the compose network)
#   REDIS_CONTAINER  defaults to hotel_redis
#   From the host:   sh scripts/check_login_throttle.sh http://localhost:3130 ci-publish-20260914-redis-1
#
# Exits 0 if every assertion passes, 1 otherwise.
#
# The counters this script seeds and clears live only in Redis, keyed on names
# it invents, except for the two sections that deliberately throttle the shared
# `testuser` fixture to prove the step-up routes share the counter -- those
# clear it again immediately, and again on exit, so a failure cannot leave the
# fixture locked out for another suite.
#
# Requires the Docker CLI: seeding and inspecting the counters is the point, and
# the API deliberately offers no way to read or reset another caller's budget.

set -u

BASE="${1:-http://proxy}"
REDIS_CONTAINER="${2:-hotel_redis}"

# Must match include/services/LoginThrottle.h. The first section measures the
# real boundary and fails if it has moved, rather than trusting these.
ACCOUNT_LIMIT=5
ADDRESS_LIMIT=20
WINDOW_SECONDS=900

USERNAME="testuser"
PASSWORD="password123"
WRONG="definitely-not-the-password"
PROBE="throttle_probe_$(date +%s)"
BURST=20

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Everything curl writes goes to a file named relative to the working directory,
# because curl is not always a POSIX binary: on a Windows host it is curl.exe,
# which resolves the paths it is given against the Win32 working directory and
# so cannot write an MSYS /tmp/... path at all -- the request succeeds, the body
# goes to stdout, and the file is never created.
cd "$TMP" || exit 1

PASS=0
FAIL=0
CODE=""

pass() { printf '  PASS  %-58s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %-58s %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

check() { # LABEL EXPECTED
    if [ "$2" = "$CODE" ]; then
        pass "$1" "HTTP $CODE"
    else
        fail "$1" "expected $2, got $CODE"
        printf '        body: %s\n' "$(cat "body" 2>/dev/null)"
    fi
}

check_body() { # LABEL NEEDLE
    if grep -q -- "$2" "body" 2>/dev/null; then
        pass "$1" "body contains $2"
    else
        fail "$1" "body lacks $2"
        printf '        body: %s\n' "$(cat "body" 2>/dev/null)"
    fi
}

check_eq() { # LABEL ACTUAL EXPECTED
    if [ "$2" = "$3" ]; then
        pass "$1" "$2"
    else
        fail "$1" "expected $3, got $2"
    fi
}

redis_cli() { docker exec "$REDIS_CONTAINER" redis-cli "$@"; }

clear_counters() {
    _keys=$(docker exec "$REDIS_CONTAINER" redis-cli --scan --pattern 'login_fail:*' 2>/dev/null | tr -d '\r')
    if [ -n "$_keys" ]; then
        # shellcheck disable=SC2086
        docker exec "$REDIS_CONTAINER" redis-cli DEL $_keys >/dev/null 2>&1
    fi
}

counter() { redis_cli GET "$1" 2>/dev/null | tr -d '\r'; }

do_req() { # METHOD URL COOKIES [DATA] [CSRF]
    _m="$1"; _u="$2"; _c="$3"; _d="${4:-}"; _csrf="${5:-}"
    set -- -s -o "body" -D "hdr" -w '%{http_code}' -X "$_m"
    set -- "$@" -H 'Content-Type: application/json'
    if [ -n "$_c" ]; then set -- "$@" -H "Cookie: $_c"; fi
    if [ -n "$_csrf" ]; then set -- "$@" -H "X-XSRF-TOKEN: $_csrf"; fi
    if [ -n "$_d" ]; then set -- "$@" --data-binary "@$_d"; fi
    set -- "$@" "$_u"
    CODE=$(curl "$@")
    RETRY_AFTER=$(awk '/^[Rr]etry-[Aa]fter:/ { sub(/\r/, ""); print $2 }' "hdr" 2>/dev/null | head -1)
    MESSAGE=$(tr ',' '\n' < "body" 2>/dev/null | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)
}

attempt_login() { # USER PASS
    printf '{"username":"%s","password":"%s"}' "$1" "$2" > "login.json"
    do_req POST "$BASE/api/auth/login" "" "login.json"
}

echo "Login throttle check against $BASE (redis: $REDIS_CONTAINER)"
echo

if ! redis_cli PING >/dev/null 2>&1; then
    echo "  FAIL  the Redis container '$REDIS_CONTAINER' is not reachable; this check needs it" >&2
    exit 1
fi
trap 'clear_counters; rm -rf "$TMP"' EXIT
clear_counters

echo "[1] One wrong password is refused the way it always was"
attempt_login "$USERNAME" "$WRONG"
check "a wrong password is unauthorized" 401
check_body "the refusal stays generic" "Invalid username or password."
ACCOUNT_COUNTER="login_fail:u:$USERNAME"
check_eq "the account counter moved once" "$(counter "$ACCOUNT_COUNTER")" 1

echo
echo "[2] The refusal lands on the attempt after the limit, not before it"
i=2
while [ "$i" -le "$ACCOUNT_LIMIT" ]; do
    attempt_login "$USERNAME" "$WRONG"
    check "failure $i of the budget is still unauthorized" 401
    i=$((i + 1))
done
check_eq "the counter reached the limit" "$(counter "$ACCOUNT_COUNTER")" "$ACCOUNT_LIMIT"
attempt_login "$USERNAME" "$WRONG"
check "the attempt past the limit is refused" 429
check_body "the refusal is a throttle, not a bad password" "Too many failed sign-in attempts."
if [ -n "$RETRY_AFTER" ] && [ "$RETRY_AFTER" -gt 0 ] && [ "$RETRY_AFTER" -le "$WINDOW_SECONDS" ]; then
    pass "the refusal carries Retry-After" "$RETRY_AFTER s"
else
    fail "the refusal carries Retry-After" "got '${RETRY_AFTER:-<none>}'"
fi

echo
echo "[3] The counter is read before the password is compared"
# The right password for the throttled account: 429 means the refusal came
# first, which is what makes the limit a limit -- reaching the comparison at all
# is the thing being budgeted.
attempt_login "$USERNAME" "$PASSWORD"
check "the correct password is refused while throttled" 429

echo
echo "[4] An account that does not exist is refused identically"
# Nothing in the answer may separate "wrong password, real account" from "wrong
# password, no such account" -- including the throttle, which is keyed on the
# name that was submitted rather than on one that exists.
THROTTLED_MESSAGE="$MESSAGE"
clear_counters
i=1
while [ "$i" -le "$((ACCOUNT_LIMIT + 1))" ]; do
    attempt_login "$PROBE" "$WRONG"
    i=$((i + 1))
done
check "an invented account is refused with 429 too" 429
check_eq "with the same message" "$MESSAGE" "$THROTTLED_MESSAGE"
check_eq "and a counter of its own" "$(counter "login_fail:u:$PROBE")" "$ACCOUNT_LIMIT"

echo
echo "[5] Concurrent failures are counted, not lost"
clear_counters
: > "burst.txt"
printf '{"username":"%s","password":"%s"}' "$PROBE" "$WRONG" > "login.json"
i=1
while [ "$i" -le "$BURST" ]; do
    (
        code=$(curl -s -o "sink.$i" -w '%{http_code}' -X POST \
            -H 'Content-Type: application/json' \
            --data-binary "@login.json" \
            "$BASE/api/auth/login")
        printf '%s\n' "$code" >> "burst.txt"
    ) &
    i=$((i + 1))
done
wait
# The counter is read before the password is verified and written after, so a
# burst can overshoot the limit: every request that read the counter below five
# is verified, and each of those then increments. What must NOT happen is a lost
# or double-counted failure, so the assertion is that the counter equals the
# number of answers that were "wrong password" -- not that it equals the burst.
ACCEPTED=$(grep -c '^401$' "burst.txt" || true)
REFUSED=$(grep -c '^429$' "burst.txt" || true)
OTHER=$(grep -cv -e '^401$' -e '^429$' "burst.txt" || true)
# Counted by shape rather than by line: an empty line is an attempt that never
# reached the server (a curl that could not read its own payload file looks
# exactly like that), and it must not be able to pass as an answer.
ANSWERED=$(grep -c -E '^[0-9]{3}$' "burst.txt" || true)
check_eq "every concurrent attempt answered" "$ANSWERED" "$BURST"
check_eq "no attempt answered anything but 401 or 429" "$OTHER" 0
# The increments are asynchronous on the server; wait for them to land rather
# than assuming the responses and the counter agree at the instant the last
# response arrived.
i=0
while [ "$i" -lt 50 ]; do
    if [ "$(counter "login_fail:u:$PROBE")" = "$ACCEPTED" ]; then break; fi
    sleep 0.1
    i=$((i + 1))
done
check_eq "exactly the failures that were verified are counted" "$(counter "login_fail:u:$PROBE")" "$ACCEPTED"
pass "the burst split" "$ACCEPTED verified before the limit, $REFUSED refused after it"
attempt_login "$PROBE" "$WRONG"
check "and the account is throttled once the burst settles" 429

echo
echo "[6] A successful sign-in clears the account's failures"
clear_counters
i=1
while [ "$i" -lt "$ACCOUNT_LIMIT" ]; do
    attempt_login "$USERNAME" "$WRONG"
    i=$((i + 1))
done
check_eq "failures below the limit are held" "$(counter "$ACCOUNT_COUNTER")" "$((ACCOUNT_LIMIT - 1))"
attempt_login "$USERNAME" "$PASSWORD"
check "the correct password still signs in" 200
check_eq "the account counter is gone" "$(counter "$ACCOUNT_COUNTER")" ""
i=1
while [ "$i" -lt "$ACCOUNT_LIMIT" ]; do
    attempt_login "$USERNAME" "$WRONG"
    i=$((i + 1))
done
attempt_login "$USERNAME" "$PASSWORD"
check "and the budget starts over afterwards" 200

echo
echo "[7] Every route that checks a password shares the counter"
clear_counters
attempt_login "$USERNAME" "$PASSWORD"
check "sign in first, to have a session" 200
COOKIES="$(awk '/^[Ss]et-[Cc]ookie:/ {
        sub(/^[Ss]et-[Cc]ookie:[ \t]*/, ""); sub(/;.*/, ""); gsub(/\r/, "");
        printf "%s; ", $0 }' "hdr")"
CSRF="$(printf '%s' "$COOKIES" | tr ';' '\n' | sed -n 's/^[ \t]*XSRF-TOKEN=//p' | head -1)"
printf '{"password":"%s"}' "$PASSWORD" > "reauth.json"
printf '{"current_password":"%s","new_password":"newpassword123"}' "$PASSWORD" > "password.json"

i=1
while [ "$i" -le "$ACCOUNT_LIMIT" ]; do
    attempt_login "$USERNAME" "$WRONG"
    i=$((i + 1))
done
check_eq "the account is now throttled" "$(counter "$ACCOUNT_COUNTER")" "$ACCOUNT_LIMIT"

attempt_login "$USERNAME" "$PASSWORD"
check "POST /api/auth/login" 429
do_req POST "$BASE/api/auth/staff-login" "" "login.json"
check "POST /api/auth/staff-login" 429
do_req POST "$BASE/api/account/reauthenticate" "$COOKIES" "reauth.json" "$CSRF"
check "POST /api/account/reauthenticate (the step-up)" 429
check_body "the step-up does not blame the password" "Too many failed sign-in attempts."
do_req POST "$BASE/api/account/password" "$COOKIES" "password.json" "$CSRF"
check "POST /api/account/password (the change step-up)" 429
if [ -n "$RETRY_AFTER" ]; then
    pass "the step-up refusal carries Retry-After" "$RETRY_AFTER s"
else
    fail "the step-up refusal carries Retry-After" "no header"
fi

echo
echo "[8] The CSRF filter still runs in front of the throttle"
do_req POST "$BASE/api/account/reauthenticate" "$COOKIES" "reauth.json" ""
check "a throttled step-up without a CSRF token is refused as CSRF" 403
check_body "and says so, rather than blaming the throttle" "CSRF"

echo
echo "[9] The counters expire on their own"
TTL_ACCOUNT=$(redis_cli TTL "$ACCOUNT_COUNTER" 2>/dev/null | tr -d '\r')
case "$TTL_ACCOUNT" in
    '' | *[!0-9]*)
        fail "the account counter has a window" "no TTL ('$TTL_ACCOUNT')"
        ;;
    *)
        if [ "$TTL_ACCOUNT" -gt 0 ] && [ "$TTL_ACCOUNT" -le "$WINDOW_SECONDS" ]; then
            pass "the account counter has a window" "${TTL_ACCOUNT}s"
        else
            fail "the account counter has a window" "TTL ${TTL_ACCOUNT}"
        fi
        ;;
esac

clear_counters

echo
echo "[10] The address budget is separate from the account budget, and looser"
# Twenty different account names, one wrong password each: every one of them is
# inside its own account budget, so only the address counter can refuse. This is
# the limit a sprayer of one password across many names runs into, and it is the
# reason the address budget is not the account budget.
i=1
while [ "$i" -le "$ADDRESS_LIMIT" ]; do
    attempt_login "addr_probe_$i" "$WRONG"
    if [ "$CODE" != 401 ]; then
        fail "attempt $i of the address budget answers 401" "got $CODE"
        break
    fi
    i=$((i + 1))
done
if [ "$i" -gt "$ADDRESS_LIMIT" ]; then
    pass "one failure per account name stays under every account limit" "$ADDRESS_LIMIT names"
fi
ADDRESS_KEY=$(docker exec "$REDIS_CONTAINER" redis-cli --scan --pattern 'login_fail:a:*' 2>/dev/null | tr -d '\r' | head -1)
if [ -n "$ADDRESS_KEY" ]; then
    pass "the address counter exists" "$ADDRESS_KEY"
    check_eq "and holds one failure per name" "$(counter "$ADDRESS_KEY")" "$ADDRESS_LIMIT"
else
    fail "the address counter exists" "no login_fail:a:* key"
fi

# The budget has to be keyed on the visitor, not on the proxy every visitor
# arrives through. Read the way it was found: the key itself. Before
# `utils::ClientAddress`, this read `login_fail:a:172.27.0.5` -- the nginx
# container's address -- which made the address budget one shared budget for the
# whole site: twenty failed sign-ins from anybody would have refused sign-in for
# everybody, and the counter would have looked perfectly healthy while it did.
PROJECT_LABEL=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$REDIS_CONTAINER" 2>/dev/null | tr -d '\r')
PROXY_IP=""
if [ -n "$PROJECT_LABEL" ]; then
    PROXY_ID=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT_LABEL" \
        --filter 'label=com.docker.compose.service=proxy' | head -1)
    if [ -n "$PROXY_ID" ]; then
        PROXY_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$PROXY_ID" 2>/dev/null | tr -d '\r' | awk '{print $1}')
    fi
fi
if [ -n "$ADDRESS_KEY" ] && [ -n "$PROXY_IP" ]; then
    if [ "$ADDRESS_KEY" = "login_fail:a:$PROXY_IP" ]; then
        fail "the address budget is keyed on the visitor, not the proxy" "key is the proxy's own $PROXY_IP"
    else
        pass "the address budget is keyed on the visitor, not the proxy" "$ADDRESS_KEY, not the proxy's $PROXY_IP"
    fi
else
    fail "the address budget is keyed on the visitor, not the proxy" "could not read the proxy's address"
fi
attempt_login "addr_probe_next" "$WRONG"
check "the next name is refused by the address budget" 429
check_eq "though its own account budget is untouched" "$(counter "login_fail:u:addr_probe_next")" ""

clear_counters
echo
echo "Login throttle check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
