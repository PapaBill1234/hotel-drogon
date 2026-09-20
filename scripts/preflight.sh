#!/bin/sh
# Phase 2b preflight: report the host and toolchain before infrastructure work.
#
# The plan's Phase 2b bullet asks for these commands by name; this script is what
# produces the recorded results in docs/phase2b-preflight.md, and CI runs it as a
# visible step so that artifact can be checked against a live run instead of
# trusted.
#
# Deliberately tolerant: a missing tool is reported as missing, not as a
# failure. Phase 2b's purpose is to find out what the host can do before
# building on it, and "docker is absent" is a result, not an error.
set -u

say() { printf '%s\n' "$*"; }

show() { # LABEL COMMAND...
    label=$1
    shift
    if command -v "$1" >/dev/null 2>&1; then
        out=$("$@" 2>&1 | head -1)
        say "$(printf '%-24s %s' "$label" "$out")"
    else
        say "$(printf '%-24s %s' "$label" "not installed")"
    fi
}

say "== preflight =="
show "date (UTC)"          date -u +%Y-%m-%dT%H:%M:%SZ
say  "$(printf '%-24s %s' 'uname' "$(uname -a)")"
show "g++"                 g++ --version
show "clang++"             clang++ --version
show "cmake"               cmake --version
show "ninja"               ninja --version
show "git"                 git --version
show "docker"              docker --version
show "docker compose"      docker compose version --short
show "systemd-detect-virt" systemd-detect-virt
show "node"                node --version
show "npm"                 npm --version
show "python3"             python3 --version

say "== docker daemon =="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    say "daemon reachable: yes"
    docker ps --format '{{.Names}}' | sed 's/^/running: /'
else
    say "daemon reachable: NO (plan: stop Docker work and use the native path)"
fi
