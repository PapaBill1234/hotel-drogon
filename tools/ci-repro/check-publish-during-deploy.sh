#!/bin/sh
# Deploy, for real, into a running stack's volume -- and keep asking for the
# assets of BOTH builds while it happens.
#
# The offline check (scripts/check_frontend_publish_order.sh) proves the ordering
# properties against a directory tree. This one proves them where the visitor
# actually stands: through nginx, over HTTP, against a volume the proxy is
# serving from, while a deployment replaces the entry point underneath it.
#
# It rehearses a deployment rather than triggering a real `docker build`, because
# what is under test is the publish contract, not the bundler: a real build is
# copied to <volume>/.rehearsal-a, and a second build that renames every hashed
# bundle and repoints the entry point at the new names is staged as
# <volume>/.rehearsal-b. Both are then published through the image's own
# publisher, exactly as `frontend-build` runs it.
#
# Asserted, over every sample taken during the deployments:
#   * index.html answers 200 and is always one whole build's shell (digest A or B)
#   * every bundle the old shell names answers 200, before, during and after
#   * every bundle the new shell names answers 200, before, during and after
#   * afterwards, fetching a bundle over HTTP returns the bytes the volume holds
#     (a whole file, not a half-copied one)
#   * after the grace period is set to zero, the bundles nothing references are
#     pruned, and the served build is untouched
#
# Usage: sh tools/ci-repro/check-publish-during-deploy.sh [BASE_URL] [COMPOSE_PROJECT]
#   BASE_URL         default http://localhost:3130
#   COMPOSE_PROJECT  default ci-publish-20260914 (the stack must already be up)
# Exits 0 when every assertion passes, 1 otherwise.

set -u

BASE="${1:-http://localhost:3130}"
PROJECT="${2:-ci-publish-20260914}"
VOLUME="${PROJECT}_frontend_dist"
IMAGE="${PROJECT}-frontend-build"
ROUNDS=6

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Everything this script writes goes through curl, and curl is not always a
# POSIX binary: on a Windows host it is curl.exe, which resolves the paths it is
# given against the Win32 working directory and so cannot write to an MSYS
# /tmp/... path at all (the request succeeds, the body goes to stdout, and the
# file is never created). Working from inside the temporary directory and naming
# these files relatively makes the same script correct under both.
cd "$TMP" || exit 1

PASS=0
FAIL=0

pass() { printf '  PASS  %-58s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %-58s %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }
check_ok() { # LABEL DESCRIPTION RESULT(0/1)
    if [ "$3" -eq 0 ]; then pass "$1" "$2"; else fail "$1" "$2"; fi
}

in_volume() { docker run --rm -i -v "$VOLUME:/out" "$IMAGE" sh -s; }

# Publisher invocation, byte for byte what the frontend-build service runs.
deploy() { # SRC_DIR GRACE
    _log=$(docker run --rm -e PUBLISH_SRC="$1" -e PUBLISH_OUT=/out -e PUBLISH_GRACE_SECONDS="$2" \
        -v "$VOLUME:/out" "$IMAGE" 2>&1)
    _rc=$?
    printf '%s\n' "$_log" | sed 's/^/        /'
    if [ "$_rc" -ne 0 ]; then
        printf '  FAIL  the publisher exits 0 for %s at grace %ss: %s\n' "$1" "$2" "$_log" >&2
        FAIL=$((FAIL + 1))
    fi
    return 0
}

echo "Publish-during-deployment check against $BASE"
echo "  project: $PROJECT   volume: $VOLUME   image: $IMAGE"
echo

if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "  FAIL  the volume $VOLUME exists; bring the stack up first" >&2
    exit 1
fi

echo "[1] The stack serves a shell and its bundles before anything is deployed"
STATUS=$(curl -s -o "live.html" -w '%{http_code}' "$BASE/index.html")
check_ok "the entry point answers" "HTTP $STATUS" "$([ "$STATUS" = 200 ] && echo 0 || echo 1)"
SHELL_A=$(sha256sum "live.html" | cut -c1-16)
ASSETS_A=$(grep -oE '/assets/[A-Za-z0-9._~-]+' "live.html" | sed 's|^/assets/||' | sort -u | tr '\n' ' ')
if [ -n "$ASSETS_A" ]; then
    pass "the shell names hashed bundles" "$(printf '%s' "$ASSETS_A" | wc -w | tr -d ' ') of them"
else
    fail "the shell names hashed bundles" "index.html names none"
fi
for asset in $ASSETS_A; do
    STATUS=$(curl -s -o sink.txt -w '%{http_code}' "$BASE/assets/$asset")
    check_ok "the bundle $asset is served" "HTTP $STATUS" "$([ "$STATUS" = 200 ] && echo 0 || echo 1)"
done
CACHE_ASSET=$(curl -s -D - -o sink.txt "$BASE/assets/$(printf '%s' "$ASSETS_A" | awk '{print $1}')" | tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: //p')
CACHE_INDEX=$(curl -s -D - -o sink.txt "$BASE/index.html" | tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: //p')
check_ok "the bundle URL is immutable" "$CACHE_ASSET" \
    "$(printf '%s' "$CACHE_ASSET" | grep -q 'immutable' && echo 0 || echo 1)"
check_ok "the entry point URL revalidates" "$CACHE_INDEX" \
    "$(printf '%s' "$CACHE_INDEX" | grep -q 'no-cache' && echo 0 || echo 1)"

echo
echo "[2] Staging a second build in the volume, and publishing it once"
in_volume <<'STAGE' > "stage.log" 2>&1
set -eu
rm -rf /out/.rehearsal-a /out/.rehearsal-b
mkdir -p /out/.rehearsal-a/assets /out/.rehearsal-b/assets
cp -a /out/index.html /out/.rehearsal-a/index.html
cp -a /out/assets/. /out/.rehearsal-a/assets/
cp -a /out/index.html /out/.rehearsal-b/index.html
: > /tmp/pairs
cd /out/assets
for f in *; do
    [ -f "$f" ] || continue
    new="${f%.*}-rehearsal.${f##*.}"
    cp -a "$f" "/out/.rehearsal-b/assets/$new"
    printf '%s %s\n' "$f" "$new" >> /tmp/pairs
done
# Repoint the new shell at the new names, longest name first so a shorter name
# cannot rewrite a prefix of a longer one.
awk '{ print length($1), $0 }' /tmp/pairs | sort -rn | cut -d' ' -f2- | while read -r old new; do
    sed -i "s|/assets/$old|/assets/$new|g" /out/.rehearsal-b/index.html
done
printf 'staged: %s bundles renamed\n' "$(wc -l < /tmp/pairs | tr -d ' ')"
STAGE
STAGED=$(sed -n 's/^staged: \(.*\)$/\1/p' "stage.log")
if [ -n "$STAGED" ]; then
    pass "a second build is staged in the volume" "$STAGED"
else
    fail "a second build is staged in the volume" "$(tail -3 "stage.log" | tr '\n' ' ')"
fi
SHELL_B=$(in_volume <<'DIG' | tr -d '\r'
sha256sum /out/.rehearsal-b/index.html | cut -c1-16
DIG
)
ASSETS_B=$(in_volume <<'LIST' | tr -d '\r' | tr '\n' ' '
set -eu
cd /out/.rehearsal-b/assets && ls -1
LIST
)
if [ "$SHELL_B" != "$SHELL_A" ] && [ -n "$ASSETS_B" ]; then
    pass "the staged shell is a different build" "$SHELL_B vs $SHELL_A"
else
    fail "the staged shell is a different build" "digests are $SHELL_A / $SHELL_B"
fi

echo
echo "[3] The deployment itself: the replaced shell's bundles keep answering"
deploy /out/.rehearsal-b 900
STATUS=$(curl -s -o "after.html" -w '%{http_code}' "$BASE/index.html")
SERVED=$(sha256sum "after.html" | cut -c1-16)
check_ok "the new entry point is being served" "digest $SERVED" \
    "$([ "$SERVED" = "$SHELL_B" ] && echo 0 || echo 1)"
for asset in $ASSETS_A; do
    STATUS=$(curl -s -o "asset-body" -w '%{http_code}' "$BASE/assets/$asset")
    CHECK=$(in_volume <<EOF | tr -d '\r'
sha256sum /out/assets/$asset | cut -c1-16
EOF
    )
    SERVED_ASSET=$(sha256sum "asset-body" | cut -c1-16)
    check_ok "the old bundle $asset still answers" "HTTP $STATUS, digest matches the volume" \
        "$([ "$STATUS" = 200 ] && [ "$SERVED_ASSET" = "$CHECK" ] && echo 0 || echo 1)"
done
for asset in $ASSETS_B; do
    STATUS=$(curl -s -o "asset-body" -w '%{http_code}' "$BASE/assets/$asset")
    CHECK=$(in_volume <<EOF | tr -d '\r'
sha256sum /out/assets/$asset | cut -c1-16
EOF
    )
    SERVED_ASSET=$(sha256sum "asset-body" | cut -c1-16)
    check_ok "the new bundle $asset is served whole" "HTTP $STATUS, digest matches the volume" \
        "$([ "$STATUS" = 200 ] && [ "$SERVED_ASSET" = "$CHECK" ] && echo 0 || echo 1)"
done

echo
echo "[4] Sampled through $ROUNDS further deployments, alternating between builds"
SAMPLES="samples.txt"
: > "$SAMPLES"
poll() {
    i=0
    while [ "$i" -lt 40 ]; do
        line=$(curl -s -o "poll-body" -w '%{http_code} %{size_download}' "$BASE/index.html")
        line="$line $(sha256sum "poll-body" | cut -c1-16)"
        for asset in $ASSETS_A $ASSETS_B; do
            line="$line $(curl -s -o sink.txt -w '%{http_code}' "$BASE/assets/$asset")"
        done
        printf '%s\n' "$line" >> "$SAMPLES"
        i=$((i + 1))
    done
}
poll &
POLLER=$!
i=0
while [ "$i" -lt "$ROUNDS" ]; do
    deploy /out/.rehearsal-b 900 >/dev/null
    deploy /out/.rehearsal-a 900 >/dev/null
    i=$((i + 1))
done
wait "$POLLER" 2>/dev/null

COUNT=$(wc -l < "$SAMPLES" | tr -d ' ')
SHELL_BAD=$(awk -v a="$SHELL_A" -v b="$SHELL_B" '$1 != 200 || ($3 != a && $3 != b)' "$SAMPLES" | wc -l | tr -d ' ')
ASSET_BAD=$(awk -v na="$(printf '%s' "$ASSETS_A $ASSETS_B" | wc -w | tr -d ' ')" '{ for (i = 4; i <= 3 + na; i++) if ($i != 200) bad++ } END { print bad + 0 }' "$SAMPLES")
SAW_A=$(awk -v a="$SHELL_A" '$3 == a' "$SAMPLES" | wc -l | tr -d ' ')
SAW_B=$(awk -v b="$SHELL_B" '$3 == b' "$SAMPLES" | wc -l | tr -d ' ')
check_ok "the sampler observed the deployments" "$COUNT samples" \
    "$([ "$COUNT" -ge 20 ] && echo 0 || echo 1)"
check_ok "the entry point always answered 200 as a whole shell" "$SHELL_BAD bad samples" \
    "$([ "$SHELL_BAD" -eq 0 ] && echo 0 || echo 1)"
check_ok "both builds' bundles answered 200 in every sample" "$ASSET_BAD non-200" \
    "$([ "$ASSET_BAD" -eq 0 ] && echo 0 || echo 1)"
check_ok "the shell actually switched underneath the sampler" "$SAW_A samples of A, $SAW_B of B" \
    "$([ "$SAW_A" -ge 1 ] && [ "$SAW_B" -ge 1 ] && echo 0 || echo 1)"

echo
echo "[5] With the grace period set to zero, unreferenced bundles are pruned"
deploy /out/.rehearsal-a 900 >/dev/null
sleep 1
deploy /out/.rehearsal-a 0 >/dev/null
PRUNED=$(in_volume <<'COUNT' | tr -d '\r'
set -eu
n=0
for f in /out/assets/*; do
    [ -f "$f" ] || continue
    case "${f##*/}" in
        *-rehearsal.*) n=$((n + 1)) ;;
    esac
done
printf '%s\n' "$n"
COUNT
)
KEPT=$(in_volume <<'COUNT' | tr -d '\r'
set -eu
n=0
for f in /out/assets/*; do
    [ -f "$f" ] || continue
    case "${f##*/}" in
        *-rehearsal.*) ;;
        *) n=$((n + 1)) ;;
    esac
done
printf '%s\n' "$n"
COUNT
)
check_ok "the stale build's bundles are gone" "$PRUNED rehearsal bundles left" \
    "$([ "$PRUNED" -eq 0 ] && echo 0 || echo 1)"
check_ok "the served build's bundles are untouched" "$KEPT bundles" \
    "$([ "$KEPT" -eq "$(printf '%s' "$ASSETS_A" | wc -w | tr -d ' ')" ] && echo 0 || echo 1)"
STATUS=$(curl -s -o sink.txt -w '%{http_code}' "$BASE/index.html")
check_ok "the entry point is still served" "HTTP $STATUS" "$([ "$STATUS" = 200 ] && echo 0 || echo 1)"
for asset in $ASSETS_A; do
    STATUS=$(curl -s -o sink.txt -w '%{http_code}' "$BASE/assets/$asset")
    check_ok "the surviving bundle $asset is served" "HTTP $STATUS" "$([ "$STATUS" = 200 ] && echo 0 || echo 1)"
done

echo
echo "[6] Cleanup: the rehearsal directories leave the volume"
in_volume <<'CLEAN' >/dev/null 2>&1
set -eu
rm -rf /out/.rehearsal-a /out/.rehearsal-b
CLEAN
LEFT=$(in_volume <<'EOF' | tr -d '\r'
set -eu
ls -a /out | grep -c '^\.rehearsal' || true
EOF
)
check_ok "no rehearsal directory is left in the document root" "$LEFT left" \
    "$([ "$LEFT" -eq 0 ] && echo 0 || echo 1)"

echo
echo "Publish-during-deployment check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
