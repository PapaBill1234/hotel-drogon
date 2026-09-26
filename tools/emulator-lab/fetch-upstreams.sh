#!/bin/sh
# Obtain exactly the reviewed sources without changing an existing checkout.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
. "$script_dir/upstreams.env"

fetch_one() {
    name=$1
    url=$2
    revision=$3
    paths=$4
    target="$workspace/upstream/$name"
    if [ -e "$target" ] && [ ! -d "$target/.git" ]; then
        echo "[FAIL] $target exists and is not a Git checkout" >&2
        exit 1
    fi
    if [ ! -d "$target/.git" ]; then
        mkdir -p "$workspace/upstream"
        git clone --filter=blob:none --sparse --depth=1 "$url" "$target"
    fi
    if [ -n "$(git -C "$target" status --porcelain)" ]; then
        echo "[FAIL] $target has local changes; preserve them and resolve manually" >&2
        exit 1
    fi
    current=$(git -C "$target" rev-parse HEAD)
    if [ "$current" != "$revision" ]; then
        git -C "$target" fetch --filter=blob:none --depth=1 origin "$revision"
        git -C "$target" checkout --detach "$revision"
    fi
    # Deliberately fetch source/config only; Nitro-Files is a separate asset input.
    git -C "$target" sparse-checkout set $paths
    [ "$(git -C "$target" rev-parse HEAD)" = "$revision" ]
    [ -z "$(git -C "$target" status --porcelain)" ]
    echo "[PASS] $name at $revision"
}

fetch_one Polaris-Emulator https://github.com/duckietm/Polaris-Emulator.git "$POLARIS_REV" 'Emulator Database docs'
fetch_one Octane https://github.com/duckietm/Octane.git "$OCTANE_REV" 'public src scripts docs css-utils'
fetch_one Octane-Renderer https://github.com/duckietm/Octane-Renderer.git "$RENDERER_REV" 'packages src scripts docs protocol'
