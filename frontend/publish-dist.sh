#!/bin/sh
# Publish a built SPA into the volume nginx serves, in the only order that cannot
# serve a broken page. Run by the `frontend-build` one-shot service; the proxy
# starts only after it exits 0.
#
# The three properties this script exists to guarantee, in the order they are
# performed:
#
#   1. NEW BUNDLES FIRST. Hashed files are copied into the volume additively and
#      nothing is deleted in this phase, so a visitor holding the previous shell
#      keeps getting 200s for the hashes that shell names while the new ones land.
#
#   2. THE ENTRY POINT LAST, ATOMICALLY. `index.html` is the only unhashed file,
#      and it is the file that names the hashes. It is written to a sibling temp
#      file and rename(2)d over the old one. rename(2) within one filesystem is
#      atomic, so a request sees either the whole previous shell or the whole new
#      one: never a truncated index.html, never a 404, and never an index.html
#      that names bundles which are not in the volume yet. Copying straight over
#      it -- what this file replaced -- has none of those properties.
#
#   3. OLD HASHES SURVIVE A GRACE PERIOD. Every deployment writes a manifest of
#      what it published, and contributes the assets named by the entry point it
#      replaced (that shell is the authoritative list of what its clients will
#      still ask for, and the previous deployment's manifest covers the chunks its
#      stylesheets reference but its HTML never names). An asset is deleted only
#      when no manifest younger than PUBLISH_GRACE_SECONDS mentions it, so a
#      browser that loaded the page seconds before a deploy, and then asks for
#      the chunk that deploy removed, is answered instead of handed a 404.
#
# Usage:
#   PUBLISH_SRC=/app/dist PUBLISH_OUT=/out PUBLISH_GRACE_SECONDS=900 \
#     sh frontend/publish-dist.sh
#
# PUBLISH_SRC   directory holding the freshly built site (must contain index.html)
# PUBLISH_OUT   the volume nginx serves: index.html, assets/, .publish/
# PUBLISH_GRACE_SECONDS
#               how long a replaced build's assets stay reachable (default 900).
#               Measured from the moment they were last published, not from the
#               moment they stopped being current: an asset leaves the volume one
#               grace period after the last deployment that shipped it. 0 keeps a
#               replaced build only until the *next* deployment, and is what
#               scripts/check_frontend_publish_order.sh uses to exercise expiry.
#
# The volume layout is a contract, not an implementation detail: index.html,
# assets/ (hashed), and .publish/ (one "<epoch>-<build id>-<kind>.list" manifest
# per deployment). Nothing else is written, and only assets/ is pruned.

set -eu

SRC="${PUBLISH_SRC:-/app/dist}"
OUT="${PUBLISH_OUT:-/out}"
GRACE="${PUBLISH_GRACE_SECONDS:-900}"

if [ ! -f "$SRC/index.html" ]; then
    echo "[publish] refusing to publish: $SRC/index.html does not exist" >&2
    exit 1
fi
case "$GRACE" in
    '' | *[!0-9]*)
        echo "[publish] refusing to publish: PUBLISH_GRACE_SECONDS='$GRACE' is not a whole number of seconds" >&2
        exit 1
        ;;
esac

mkdir -p "$OUT/assets" "$OUT/.publish"
NOW=$(date +%s)
BUILD_ID=$(md5sum "$SRC/index.html" | cut -c1-12)

# 0. Protect what is about to be replaced, before anything is replaced. The
#    manifest is stamped "now" because that is when this build's grace starts:
#    a client is allowed to be holding the old shell for one more grace period
#    from this deployment, not from whenever that shell was first published.
if [ -f "$OUT/index.html" ]; then
    grep -oE '/assets/[A-Za-z0-9._~-]+' "$OUT/index.html" \
        | sed 's|^/assets/||' | sort -u > "$OUT/.publish/$NOW-$BUILD_ID-entry.list" || true
    [ -s "$OUT/.publish/$NOW-$BUILD_ID-entry.list" ] \
        || rm -f "$OUT/.publish/$NOW-$BUILD_ID-entry.list"
fi

# 1. New files land additively. No deletion happens in this phase.
if [ -d "$SRC/assets" ]; then
    cp -a "$SRC/assets/." "$OUT/assets/"
fi
for entry in "$SRC"/*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in
        index.html | assets) continue ;;
    esac
    cp -a "$entry" "$OUT/"
done

# 2. The entry point, last, by rename. Everything a browser needs under this file
#    is already in the volume when it appears.
TMP_INDEX="$OUT/.index.html.$$.tmp"
cp -a "$SRC/index.html" "$TMP_INDEX"
mv -f "$TMP_INDEX" "$OUT/index.html"

# 3. Record what this deployment published, so the next one can protect it.
if [ -d "$SRC/assets" ]; then
    (cd "$SRC/assets" && ls -1) > "$OUT/.publish/$NOW-$BUILD_ID-build.list"
else
    : > "$OUT/.publish/$NOW-$BUILD_ID-build.list"
fi

# 4. Prune. A manifest older than the grace period is dropped first (it no longer
#    protects anything), then any asset no surviving manifest mentions.
#
#    The per-manifest loop is builtins only -- no `cat` per file -- because the
#    number of manifests grows with the deployment rate, and this runs inside the
#    deployment. Reading the survivors is one `xargs cat`; the manifest names are
#    generated by this script (`<epoch>-<build id>-<kind>.list`) and so contain no
#    spaces.
ACTIVE="$OUT/.publish/.active.$$"
KEEP="$OUT/.publish/.keep.$$"
: > "$ACTIVE"
for manifest in "$OUT"/.publish/*.list; do
    [ -f "$manifest" ] || continue
    stamp=${manifest##*/}
    stamp=${stamp%%-*}
    case "$stamp" in
        '' | *[!0-9]*)
            rm -f "$manifest"
            continue
            ;;
    esac
    if [ $((NOW - stamp)) -gt "$GRACE" ]; then
        rm -f "$manifest"
        continue
    fi
    printf '%s\n' "$manifest" >> "$ACTIVE"
done
if [ -s "$ACTIVE" ]; then
    xargs cat < "$ACTIVE" | sort -u > "$KEEP"
else
    : > "$KEEP"
fi
rm -f "$ACTIVE"

REMOVED=0
for asset in "$OUT"/assets/*; do
    [ -f "$asset" ] || continue
    if ! grep -qxF -- "${asset##*/}" "$KEEP"; then
        rm -f "$asset"
        REMOVED=$((REMOVED + 1))
    fi
done
rm -f "$KEEP"
HELD=$(ls -1 "$OUT/assets" | wc -l | tr -d ' ')

echo "[publish] build $BUILD_ID published $(wc -l < "$OUT/.publish/$NOW-$BUILD_ID-build.list" | tr -d ' ') assets last; removed $REMOVED expired; volume holds $HELD assets for a ${GRACE}s grace period"
