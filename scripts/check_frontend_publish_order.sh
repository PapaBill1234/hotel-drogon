#!/bin/sh
# The deployment-ordering contract of frontend/publish-dist.sh.
#
# The gap this closes: publishing a SPA into the volume nginx serves has three
# properties that a bare `cp -a src/. out/` does not have, and each one is a
# distinct way to serve a visitor a broken page.
#
#   1. The replaced build's hashed files stay fetchable while the new ones land.
#   2. The entry point (index.html, the only unhashed file) is published last, so
#      it never names a bundle the volume does not have yet.
#   3. It is published by rename, so it is never observed truncated.
#
# This script runs the real publisher against a real directory tree, so it needs
# neither Docker nor a network, and it samples the volume from a second process
# while the publisher runs rather than inspecting the code. Two of the sections
# are controls: they run the same sampler against the publishing order this
# script replaced, and fail if the sampler does NOT catch the violation. A
# sampler that never fires is not evidence that the real publisher is correct.
#
# Usage: sh scripts/check_frontend_publish_order.sh
# Exits 0 when every assertion and both controls pass, 1 otherwise.

set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PUBLISH="$REPO_ROOT/frontend/publish-dist.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

pass() { printf '  PASS  %-58s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %-58s %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

check_ok() { # LABEL CONDITION-DESCRIPTION RESULT(0/1)
    if [ "$3" -eq 0 ]; then pass "$1" "$2"; else fail "$1" "$2"; fi
}

digest() { md5sum "$1" 2>/dev/null | cut -c1-32; }

# A stand-in build: an entry point that names one hashed bundle, plus that bundle.
make_build() { # DIR TAG ASSET
    mkdir -p "$1/assets"
    {
        printf '<!doctype html><html><head><meta charset="utf-8"><title>%s</title>' "$2"
        printf '<script type="module" crossorigin src="/assets/%s"></script>' "$3"
        printf '</head><body><div id="root">%s</div></body></html>\n' "$2"
    } > "$1/index.html"
    printf 'console.log("%s");\n' "$2" > "$1/assets/$3"
}

# Publishes the real way, capturing the log for the failure messages.
publish() { # SRC GRACE
    PUBLISH_SRC="$1" PUBLISH_OUT="$OUT" PUBLISH_GRACE_SECONDS="$2" \
        sh "$PUBLISH" > "$TMP/publish.log" 2>&1
}

# Samples the volume from another process: the entry point's digest, and whether
# a named bundle is present. Column 1 is the digest, column 2 is 0/1.
sampler() { # OUT_DIR SAMPLES ASSET
    while :; do
        if [ -f "$1/assets/$3" ]; then _here=1; else _here=0; fi
        printf '%s %s\n' "$(digest "$1/index.html")" "$_here" >> "$2"
    done
}

start_sampler() { # OUT_DIR SAMPLES ASSET
    sampler "$1" "$2" "$3" &
    SAMPLER_PID=$!
}

stop_sampler() {
    kill "$SAMPLER_PID" 2>/dev/null
    wait "$SAMPLER_PID" 2>/dev/null
    SAMPLER_PID=""
}

sample_count() { wc -l < "$1" | tr -d ' '; }

# Lines where the entry point names the bundle and the bundle is absent.
missing_when_named() { # SAMPLES DIGEST
    awk -v d="$2" '$1 == d && $2 == 0' "$1" | wc -l | tr -d ' '
}

# Lines whose entry point is not one of the whole files that exist.
torn() { # SAMPLES DIGEST_A DIGEST_B
    awk -v a="$2" -v b="$3" '$1 != a && $1 != b' "$1" | wc -l | tr -d ' '
}

echo "Frontend publish order check ($PUBLISH)"
echo

[ -f "$PUBLISH" ] || {
    echo "  FAIL  the publisher exists at $PUBLISH" >&2
    exit 1
}

OUT="$TMP/out"
mkdir -p "$OUT"
make_build "$TMP/a" "shell-a" "app-a1b2c3.js"
make_build "$TMP/b" "shell-b" "app-d4e5f6.js"
make_build "$TMP/c" "shell-c" "app-07a8b9.js"
make_build "$TMP/d" "shell-d" "app-1c2d3e.js"
DIG_A=$(digest "$TMP/a/index.html")
DIG_B=$(digest "$TMP/b/index.html")
DIG_C=$(digest "$TMP/c/index.html")
DIG_D=$(digest "$TMP/d/index.html")

echo "[1] Publishing a build, then the next one, keeps the replaced hashes fetchable"
if publish "$TMP/a" 900 && publish "$TMP/b" 900; then
    pass "both deployments exit 0" "grace 900s"
else
    fail "both deployments exit 0" "$(cat "$TMP/publish.log")"
fi
check_ok "the entry point is the new shell" "index.html is shell-b" \
    "$([ "$(digest "$OUT/index.html")" = "$DIG_B" ] && echo 0 || echo 1)"
check_ok "the new bundle is in the volume" "assets/app-d4e5f6.js" \
    "$([ -f "$OUT/assets/app-d4e5f6.js" ] && echo 0 || echo 1)"
check_ok "the replaced bundle is still in the volume" "assets/app-a1b2c3.js" \
    "$([ -f "$OUT/assets/app-a1b2c3.js" ] && echo 0 || echo 1)"

echo
echo "[2] Sampled during republishing: the entry point never names an absent bundle"
SAMPLES="$TMP/samples-order.txt"
: > "$SAMPLES"
start_sampler "$OUT" "$SAMPLES" "app-d4e5f6.js"
i=0
while [ "$i" -lt 20 ]; do
    publish "$TMP/a" 900
    publish "$TMP/b" 900
    i=$((i + 1))
done
stop_sampler
COUNT=$(sample_count "$SAMPLES")
# The sampler records one digest per line; a sample "names an absent bundle" when
# the shell it saw is the one that references app-d4e5f6.js and that file is gone.
MISSING_A=$(missing_when_named "$SAMPLES" "$DIG_A")
MISSING_B=$(missing_when_named "$SAMPLES" "$DIG_B")
check_ok "the sampler actually observed the volume" "$COUNT samples" \
    "$([ "$COUNT" -ge 100 ] && echo 0 || echo 1)"
check_ok "shell-a was never seen without its bundle" "$MISSING_A violations" \
    "$([ "$MISSING_A" -eq 0 ] && echo 0 || echo 1)"
check_ok "shell-b was never seen without its bundle" "$MISSING_B violations" \
    "$([ "$MISSING_B" -eq 0 ] && echo 0 || echo 1)"

echo
echo "[3] Control: the same sampler catches the ordering this script replaced"
# Copying the entry point before the bundles it names -- and then taking long
# enough that the window is unmistakable -- must be visible to the sampler. The
# control runs in its own published directory, so it leaves the real one on the
# build the sections below sample.
CONTROL="$TMP/control-order"
SAMPLES_ORDER="$TMP/samples-control-order.txt"
pub() { PUBLISH_SRC="$1" PUBLISH_OUT="$CONTROL" PUBLISH_GRACE_SECONDS=900 sh "$PUBLISH" >/dev/null 2>&1; }
mkdir -p "$CONTROL"
pub "$TMP/a"
: > "$SAMPLES_ORDER"
start_sampler "$CONTROL" "$SAMPLES_ORDER" "app-07a8b9.js"
cp -a "$TMP/c/index.html" "$CONTROL/index.html"
sleep 2
cp -a "$TMP/c/assets/." "$CONTROL/assets/"
stop_sampler
CAUGHT=$(missing_when_named "$SAMPLES_ORDER" "$DIG_C")
check_ok "the control sampler observed the window" "$(sample_count "$SAMPLES_ORDER") samples" \
    "$([ "$(sample_count "$SAMPLES_ORDER")" -ge 10 ] && echo 0 || echo 1)"
check_ok "the control violates the ordering property, and it is seen" \
    "$CAUGHT samples of shell-c without its bundle" \
    "$([ "$CAUGHT" -ge 1 ] && echo 0 || echo 1)"

echo
echo "[4] Sampled during republishing: the entry point is never seen torn"
SAMPLES_TEAR="$TMP/samples-tear.txt"
: > "$SAMPLES_TEAR"
start_sampler "$OUT" "$SAMPLES_TEAR" "app-d4e5f6.js"
i=0
while [ "$i" -lt 20 ]; do
    publish "$TMP/a" 900
    publish "$TMP/b" 900
    i=$((i + 1))
done
# Leave the volume on shell-b, which section 6 depends on.
publish "$TMP/b" 900
stop_sampler
TORN=$(torn "$SAMPLES_TEAR" "$DIG_A" "$DIG_B")
check_ok "the entry point was always a whole published shell" \
    "$(sample_count "$SAMPLES_TEAR") samples, $TORN not shell-a or shell-b" \
    "$([ "$TORN" -eq 0 ] && echo 0 || echo 1)"

echo
echo "[5] Control: the same sampler catches a torn entry point"
TEARDIR="$TMP/tear"
mkdir -p "$TEARDIR"
awk 'BEGIN { for (i = 0; i < 131072; i++) printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' > "$TEARDIR/index.html"
awk 'BEGIN { for (i = 0; i < 131072; i++) printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }' > "$TEARDIR/next.html"
DIG_T1=$(digest "$TEARDIR/index.html")
DIG_T2=$(digest "$TEARDIR/next.html")
SAMPLES_TORN="$TMP/samples-control-tear.txt"
: > "$SAMPLES_TORN"
sampler "$TEARDIR" "$SAMPLES_TORN" "unused" &
SAMPLER_PID=$!
i=0
while [ "$i" -lt 60 ]; do
    cp "$TEARDIR/next.html" "$TEARDIR/index.html"
    i=$((i + 1))
done
stop_sampler
TORN_CONTROL=$(torn "$SAMPLES_TORN" "$DIG_T1" "$DIG_T2")
check_ok "copying over the entry point is observable as a partial file" \
    "$(sample_count "$SAMPLES_TORN") samples, $TORN_CONTROL neither whole file" \
    "$([ "$TORN_CONTROL" -ge 1 ] && echo 0 || echo 1)"

echo
echo "[6] After the grace period, hashes nothing references are pruned"
sleep 1
publish "$TMP/c" 0
check_ok "the replaced shell's bundle survived its grace period" "assets/app-d4e5f6.js" \
    "$([ -f "$OUT/assets/app-d4e5f6.js" ] && echo 0 || echo 1)"
check_ok "hashes from earlier deployments are pruned" "assets/app-a1b2c3.js was removed" \
    "$([ ! -f "$OUT/assets/app-a1b2c3.js" ] && echo 0 || echo 1)"
check_ok "the newly published bundle is in the volume" "assets/app-07a8b9.js" \
    "$([ -f "$OUT/assets/app-07a8b9.js" ] && echo 0 || echo 1)"
sleep 1
publish "$TMP/d" 0
check_ok "one more deployment prunes the previous grace holder" "assets/app-d4e5f6.js was removed" \
    "$([ ! -f "$OUT/assets/app-d4e5f6.js" ] && echo 0 || echo 1)"
check_ok "the bundle the last-but-one shell names is still present" "assets/app-07a8b9.js" \
    "$([ -f "$OUT/assets/app-07a8b9.js" ] && echo 0 || echo 1)"
check_ok "the entry point is the newest shell" "index.html is shell-d" \
    "$([ "$(digest "$OUT/index.html")" = "$DIG_D" ] && echo 0 || echo 1)"
LEFTOVER=$(ls -a "$OUT" | grep -c '^\.index\.html' || true)
check_ok "no half-written entry point is left behind" "$LEFTOVER partial files" \
    "$([ "$LEFTOVER" -eq 0 ] && echo 0 || echo 1)"

echo
echo "Frontend publish order check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
