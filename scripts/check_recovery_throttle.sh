#!/bin/sh
# Live recovery-budget check. All five arguments are required so the fixture
# cannot silently attach to the primary or read-only legacy stack.
# Usage: sh scripts/check_recovery_throttle.sh BASE PROJECT PROXY DB REDIS
set -eu

if [ "$#" -ne 5 ]; then
    echo 'usage: check_recovery_throttle.sh BASE PROJECT PROXY DB REDIS' >&2
    exit 2
fi
BASE=$1 PROJECT=$2 PROXY=$3 DB=$4 REDIS=$5

for container in "$PROXY" "$DB" "$REDIS"; do
    actual=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")
    if [ "$actual" != "$PROJECT" ]; then
        echo "refusing fixture: $container belongs to $actual, expected $PROJECT" >&2
        exit 2
    fi
done

ROOT=$(pwd -P)
TMP=$(mktemp -d "$ROOT/.recovery-throttle.XXXXXXXX")
ORIGINAL_VERIFIED=''
REDIS_STOPPED=0
cleanup() {
    if [ "$REDIS_STOPPED" -eq 1 ]; then
        docker start "$REDIS" >/dev/null 2>&1 || true
    fi
    if [ -n "$ORIGINAL_VERIFIED" ]; then
        docker exec "$DB" mariadb -uhotel -photel_secret polaris -e \
            "UPDATE users SET mail_verified=$ORIGINAL_VERIFIED WHERE id=2" >/dev/null 2>&1 || true
    fi
    docker exec "$REDIS" redis-cli --scan --pattern 'recovery:*' 2>/dev/null |
        while IFS= read -r key; do docker exec "$REDIS" redis-cli DEL "$key" >/dev/null; done || true
    if [ -f "$TMP/tokens-before" ]; then
        docker exec "$REDIS" redis-cli --scan --pattern 'password_reset:*' 2>/dev/null |
            sort > "$TMP/tokens-after" || true
        comm -13 "$TMP/tokens-before" "$TMP/tokens-after" |
            while IFS= read -r key; do docker exec "$REDIS" redis-cli DEL "$key" >/dev/null; done || true
    fi
    case "$(cd "$TMP" 2>/dev/null && pwd -P)" in
        "$ROOT"/.recovery-throttle.*) rm -rf "$TMP" ;;
        *) echo "refusing to remove unexpected temporary path: $TMP" >&2 ;;
    esac
}
trap cleanup EXIT HUP INT TERM

ORIGINAL_VERIFIED=$(docker exec "$DB" mariadb -N -B -uhotel -photel_secret polaris \
    -e 'SELECT mail_verified FROM users WHERE id=2' | tr -d '\r')
MAIL=$(docker exec "$DB" mariadb -N -B -uhotel -photel_secret polaris \
    -e 'SELECT mail FROM users WHERE id=2' | tr -d '\r')
if [ "$ORIGINAL_VERIFIED" != 0 ] && [ "$ORIGINAL_VERIFIED" != 1 ]; then
    echo 'refusing fixture: user 2 verification state is not Boolean' >&2
    exit 2
fi
case "$MAIL" in *'@'*) ;; *) echo 'refusing fixture: user 2 has no email' >&2; exit 2;; esac
docker exec "$REDIS" redis-cli --scan --pattern 'password_reset:*' | sort > "$TMP/tokens-before"
docker exec "$DB" mariadb -uhotel -photel_secret polaris \
    -e 'UPDATE users SET mail_verified=1 WHERE id=2' >/dev/null
# This check runs on a disposable Compose project. Earlier recovery probes may
# have spent the host's visitor budget; begin from a known counter state.
docker exec "$REDIS" redis-cli --scan --pattern 'recovery:*' |
    while IFS= read -r key; do docker exec "$REDIS" redis-cli DEL "$key" >/dev/null; done
cd "$TMP"

PASS=0 FAIL=0
check() {
    if [ "$2" = "$3" ]; then
        PASS=$((PASS + 1)); printf 'PASS %s: %s\n' "$1" "$2"
    else
        FAIL=$((FAIL + 1)); printf 'FAIL %s: got %s, expected %s\n' "$1" "$2" "$3"
        cat body 2>/dev/null || true
    fi
}
post() {
    route=$1 payload=$2
    CODE=$(curl -sS --max-time 10 -D headers -o body -w '%{http_code}' \
        -H 'Content-Type: application/json' -H 'X-XSRF-TOKEN: recovery-check' \
        -d "$payload" "$BASE$route")
}
token_count() {
    docker exec "$REDIS" redis-cli --scan --pattern 'password_reset:*' | wc -l | tr -d ' '
}

# The public CSRF filter still runs before the new budget. A rejected request
# cannot consume a counter, and no token is issued.
CODE=$(curl -sS --max-time 10 -D headers -o body -w '%{http_code}' \
    -H 'Content-Type: application/json' -d "{\"username\":\"testuser\",\"email\":\"$MAIL\"}" \
    "$BASE/api/auth/password/forgot")
check 'CSRF stays first' "$CODE" 403
KEYS=$(docker exec "$REDIS" redis-cli --scan --pattern 'recovery:*' | wc -l | tr -d ' ')
check 'CSRF refusal spends no budget' "$KEYS" 0

# The two forms share the target budget. The sixth request is refused before
# lookup, and does not issue another reset token.
post /api/auth/password/forgot "{\"username\":\"testuser\",\"email\":\"$MAIL\"}"
check 'matching account admitted' "$CODE" 200
TOKENS=$(token_count)
for n in 2 3 4 5; do
    post /api/auth/username/forgot "{\"email\":\"$MAIL\"}"
    check "shared email request $n" "$CODE" 200
done
post /api/auth/password/forgot "{\"username\":\"testuser\",\"email\":\"$MAIL\"}"
check 'sixth shared email request refused' "$CODE" 429
RETRY=$(sed -n 's/^[Rr]etry-[Aa]fter: \([0-9][0-9]*\).*/\1/p' headers | tr -d '\r')
case "$RETRY" in ''|*[!0-9]*) FAIL=$((FAIL + 1)); echo 'FAIL Retry-After missing';;
    *) if [ "$RETRY" -ge 1 ] && [ "$RETRY" -le 900 ]; then
           PASS=$((PASS + 1)); echo "PASS Retry-After: $RETRY";
       else FAIL=$((FAIL + 1)); echo "FAIL Retry-After: $RETRY"; fi;; esac
check 'refusal issues no reset token' "$(token_count)" "$TOKENS"

# Six requests spent the address budget. Fourteen distinct targets are still
# admitted; the next request is refused regardless of which email it submits.
n=1
while [ "$n" -le 14 ]; do
    post /api/auth/username/forgot "{\"email\":\"address-$n@example.invalid\"}"
    check "address request $n" "$CODE" 200
    n=$((n + 1))
done
post /api/auth/username/forgot '{"email":"final@example.invalid"}'
check 'twenty-first address request refused' "$CODE" 429

# Reset only the scoped disposable counters, then make eight concurrent
# requests to one unknown target. INCR gives exactly five admissions.
docker exec "$REDIS" redis-cli --scan --pattern 'recovery:*' |
    while IFS= read -r key; do docker exec "$REDIS" redis-cli DEL "$key" >/dev/null; done
n=1
while [ "$n" -le 8 ]; do
    curl -sS --max-time 10 -o "parallel-$n-body" -w '%{http_code}\n' \
        -H 'Content-Type: application/json' -H 'X-XSRF-TOKEN: recovery-check' \
        -d '{"email":"parallel@example.invalid"}' \
        "$BASE/api/auth/username/forgot" > "parallel-$n-code" &
    n=$((n + 1))
done
wait
ADMITTED=$(cat parallel-*-code | grep -c '^200$' || true)
REFUSED=$(cat parallel-*-code | grep -c '^429$' || true)
check 'concurrent admissions' "$ADMITTED" 5
check 'concurrent refusals' "$REFUSED" 3

# A disconnected Redis client may queue a command without an error callback.
# The route must return a bounded 503 and must not issue a token after the
# connection comes back.
TOKENS=$(token_count)
docker stop "$REDIS" >/dev/null
REDIS_STOPPED=1
post /api/auth/password/forgot "{\"username\":\"testuser\",\"email\":\"$MAIL\"}"
check 'counter-store outage refuses within curl deadline' "$CODE" 503
docker start "$REDIS" >/dev/null
REDIS_STOPPED=0
n=0
until [ "$(docker exec "$REDIS" redis-cli PING 2>/dev/null | tr -d '\r')" = PONG ]; do
    n=$((n + 1))
    [ "$n" -le 10 ] || { echo 'Redis did not recover' >&2; exit 1; }
    sleep 1
done
check 'outage creates no reset token' "$(token_count)" "$TOKENS"

printf 'Recovery throttle: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
