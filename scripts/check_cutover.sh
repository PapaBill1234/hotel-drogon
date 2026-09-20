#!/bin/sh
# Demonstrates a real route cutover AND rollback through the proxy's cutover map.
#
# The plan's Phase 2b exit condition asks for "a route-switch/proxy map and
# demonstrate both cutover and rollback for one real test route". This script is
# that demonstration, and it runs against the proxy's REAL configuration
# (proxy/nginx.conf + proxy/cutover.map) rather than a hand-written stand-in: the
# "legacy" variant of the map used mid-run is generated from the committed file
# by a single substitution, so it cannot silently drift from what is deployed.
#
# The route is /articles/rss.xml, which both stacks implement. That is what makes
# it a genuine cutover rather than a redirect: switching the map serves the same
# URL from a different implementation, and both remain deployed throughout.
#
# Usage:
#   sh scripts/check_cutover.sh [BASE_URL]
#     BASE_URL defaults to http://localhost:3000
#
# Preconditions:
#   - the proxy is serving $BASE_URL and is reachable from this script;
#   - the legacy PHP upstream named by the map (default `legacy:80`) is running;
#   - this script can reload that proxy. By default it runs
#     `docker compose $COMPOSE_ARGS exec -T proxy nginx -s reload`; set
#     COMPOSE_ARGS (e.g. "-p ci-cutover -f tools/ci-repro/compose-cutover.yaml")
#     for another project, or set RELOAD_CMD to a shell command that reloads
#     whatever proxy serves $BASE_URL — which is how this runs inside the
#     Compose network, where no Docker CLI is available:
#
#       RELOAD_CMD='wget -qO- http://proxy/reload' ...
#
# Exits 0 only when the route serves the new stack, then the legacy stack, then
# the new stack again -- i.e. cutover and rollback both really happened.

set -eu

BASE="${1:-http://localhost:3000}"
COMPOSE_ARGS="${COMPOSE_ARGS:-}"
RELOAD_CMD="${RELOAD_CMD:-}"
MARKER_APP="${MARKER_APP:-<title>PHPRetro ~</title>}"
MARKER_LEGACY="${MARKER_LEGACY:-<title>Retro ~</title>}"

PASS=0
FAIL=0

say() { printf '%s\n' "$*"; }

ok() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

check() { # LABEL EXPECTED ACTUAL
    if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: expected $2, got $3"; fi
}

# Ask the route who served it.
#
# The two implementations are identified by their feed content, which is a real
# difference between them: the Drogon port builds the channel title from the
# `site_name` setting ("PHPRetro ~") while legacy `xml/rss.php` emits its own
# "Retro ~". A canned or cached response cannot satisfy the whole sequence below,
# because the same URL must produce one marker, then the other, then the first.
#
# The upstream's `Server` header is deliberately NOT used. Proxied responses
# carry nginx's own Server header in both directions — measured on this harness,
# `Server: nginx/1.31.6` for the legacy upstream too — so a header check would
# have reported "app" for every probe and made the demonstration vacuous.
probe() {
    body=$(curl -s "$BASE/articles/rss.xml")
    case "$body" in
        *"$MARKER_APP"*)    echo app ;;
        *"$MARKER_LEGACY"*) echo legacy ;;
        *)                  echo "unknown(no marker; $(printf '%s' "$body" | head -c 120))" ;;
    esac
}

reload_proxy() {
    if [ -n "$RELOAD_CMD" ]; then
        sh -c "$RELOAD_CMD" >/dev/null 2>&1
    else
        # shellcheck disable=SC2086
        docker compose $COMPOSE_ARGS exec -T proxy nginx -s reload >/dev/null 2>&1
    fi
    # The proxy re-reads the map on reload, but a variable proxy_pass target is
    # re-resolved through Docker's DNS at most every 10s (`resolver ... valid=10s`).
    # Waiting past that window is not politeness: a shorter wait can read the
    # previously resolved address and report the wrong side.
    sleep 3
}

# Wait until the route actually answers before probing it.
#
# Without this, a run can probe during the window when the proxy is still coming
# up, get an empty body, and report a failure that says nothing about the map.
# Bounded, so a genuinely broken proxy still fails the run.
wait_for_route() {
    i=0
    while [ "$i" -lt 30 ]; do
        body=$(curl -s "$BASE/articles/rss.xml" || true)
        case "$body" in
            *"$MARKER_APP"*|*"$MARKER_LEGACY"*) return 0 ;;
        esac
        i=$((i + 1))
        sleep 1
    done
    return 0  # let probe() report what it actually saw
}

# Wait until the route serves the expected side, up to a bound.
#
# A fixed sleep after reload is not enough on a slower runner: measured on CI,
# `nginx -s reload` plus the 10s DNS re-resolution window meant a three-second
# wait still observed the OLD side, and the check reported
# "expected legacy, got app" — a false failure about the map. Polling for the
# expected side removes the timing guesswork while keeping the assertion real:
# if the switch never happens, this still fails.
wait_for_side() { # SIDE
    i=0
    while [ "$i" -lt 20 ]; do
        if [ "$(probe)" = "$1" ]; then
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    return 0
}

# Assert the PROXY sees exactly the map we just wrote, before asking it to reload.
#
# This is the assertion that was missing, and its absence cost several CI runs.
# The map is bind-mounted into the proxy; if the proxy's copy still holds the old
# routing, the reload is a no-op and the probe dutifully reports the old side —
# which reads exactly like "the switch is slow" rather than "the proxy never saw
# the change".
#
# Compared by CHECKSUM, not by grepping for a marker. Two reasons, both learned
# here: the interesting strings appear in the map's own explanatory comments, so a
# marker match proves nothing; and pushing a regex (`\.`, `$`) through
# `docker compose exec` into the container's grep survives two shells badly.
# `cksum` is POSIX and present in busybox, so both sides agree byte for byte.
proxy_map_checksum() {
    if [ -z "$COMPOSE_ARGS" ] && [ -z "$RELOAD_CMD" ]; then
        return 1
    fi
    # Two spellings of the container path on purpose. MSYS/Git-Bash on Windows
    # rewrites an argument like `/etc/nginx/...` into a Windows path before docker
    # ever sees it (`cksum: can't open 'C:/Program Files/Git/etc/...'`), which made
    # this assertion fail on a developer machine while working on the runner. The
    # `//` form is the POSIX-sanctioned way to say "do not translate this".
    out=""
    for p in /etc/nginx/config/cutover.map //etc/nginx/config/cutover.map; do
        # shellcheck disable=SC2086
        out=$(docker compose $COMPOSE_ARGS exec -T proxy cksum "$p" 2>/dev/null \
            | tr -d '\r' | awk '{print $1, $2}')
        [ -n "$out" ] && break
    done
    printf '%s' "$out"
}

assert_proxy_sees_map() { # LABEL
    host_sum=$(cksum "$MAP" | awk '{print $1, $2}')
    proxy_sum=$(proxy_map_checksum || echo '')
    if [ -n "$proxy_sum" ] && [ "$host_sum" = "$proxy_sum" ]; then
        ok "$1 (checksum ${host_sum%% *})"
    else
        bad "$1: host map (${host_sum:-?}) and the proxy's copy (${proxy_sum:-unreadable}) differ — a stale bind mount would make the reload a no-op"
    fi
}

# --- locate the committed configuration ------------------------------------
# PROXY_DIR lets this run against a mounted copy (the isolated reproduction does
# exactly that); otherwise it is found relative to this script.
PROXY_DIR="${PROXY_DIR:-$(cd "$(dirname "$0")/.." && pwd)/proxy}"
CONF="$PROXY_DIR/nginx.conf"
MAP="$PROXY_DIR/cutover.map"
BACKUP="${MAP}.cutover-backup"

if [ ! -f "$CONF" ] || [ ! -f "$MAP" ]; then
    say "cannot find proxy/nginx.conf and proxy/cutover.map under $PROXY_DIR"
    exit 1
fi

say "Cutover check against $BASE"
say "  map:  $MAP"
say "  conf: $CONF"
say

# The map must actually be included by nginx.conf. An orphaned map is exactly the
# defect this check exists to prevent: it looks like routing configuration, it
# says sensible things, and nothing reads it. Matched on the filename rather than
# the full path so that moving the mount point does not silently disable the check.
if grep -qE '^[[:space:]]*include[[:space:]]+[^;]*cutover\.map' "$CONF"; then
    ok "nginx.conf includes the cutover map"
else
    bad "nginx.conf does not include a cutover.map — the map would be orphaned"
    say
    say "RESULT: FAIL (map not wired up); stopping"
    exit 1
fi

if grep -q 'default app:8080' "$MAP"; then
    ok "map defaults to the new stack (deploying it changes no routing)"
else
    bad "map does not default to app:8080; refusing to touch routing"
    say
    say "RESULT: FAIL; stopping before any change"
    exit 1
fi

# Refuse to trample an uncommitted edit: this script writes the map and restores
# it, and silently discarding someone's change would be worse than failing.
if [ -f "$BACKUP" ]; then
    bad "a previous run left $BACKUP behind; restore the map before re-running"
    exit 1
fi

restore() {
    if [ -f "$BACKUP" ]; then
        # `cp`, never `mv`: a bind-mounted FILE stays pinned to its original
        # inode, so replacing it with a new one leaves the proxy reading the old
        # content forever. That is exactly how this check first failed on CI --
        # "expected legacy, got app" persisted through a reload even though the
        # host file had changed, because the restore step had swapped the inode.
        cp "$BACKUP" "$MAP"
        rm -f "$BACKUP"
        reload_proxy || true
        say "  (map restored)"
    fi
}
trap 'restore' EXIT INT TERM

# --- 1. baseline: the route is served by the new stack ----------------------
say "[1] Baseline — route served by the new stack"
wait_for_route
check "route resolves to the new stack" app "$(probe)"

# --- 2. cutover: flip the route to the legacy stack -------------------------
say
say "[2] Cutover — flip /articles/rss.xml to the legacy stack"
cp "$MAP" "$BACKUP"
# Rewrite IN PLACE (truncate + write) so the file keeps its inode; see the note in
# restore(). `sed -i` would create a new inode and the mounted copy would not
# change on Linux, which makes the whole demonstration appear to do nothing.
# The single substitution the demonstration turns on. If the map stops containing
# this exact line the check below fails loudly rather than silently routing nothing.
sed 's|^\( *~\^/articles/rss\\\.xml\$\) app:8080;|\1 legacy:80;|' "$BACKUP" > "$MAP"

if grep -q '^ *~\^/articles/rss\\\.xml\$ legacy:80;' "$MAP"; then
    ok "map now routes /articles/rss.xml to legacy:80"
else
    bad "map rewrite did not take effect"
fi
# Markers are deliberately free of regex metacharacters and backslashes: they are
# passed through `docker compose exec` into the container's grep, and `\.`/`$`
# survive two shells badly. `legacy:80;` appears only on the cutover line of the
# map, so it identifies the change without needing a regex.
assert_proxy_sees_map "proxy sees the cutover map before reload"

reload_proxy
wait_for_side legacy
check "after cutover, route resolves to the legacy stack" legacy "$(probe)"

# --- 3. rollback: put it back ----------------------------------------------
say
say "[3] Rollback — restore the committed map"
cp "$BACKUP" "$MAP"
rm -f "$BACKUP"
assert_proxy_sees_map "proxy sees the restored map before reload"
reload_proxy
wait_for_side app
check "after rollback, route resolves to the new stack again" app "$(probe)"

say
say "---------------------------------------------"
printf 'passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo "RESULT: FAIL"
    exit 1
fi
echo "RESULT: PASS"
exit 0
