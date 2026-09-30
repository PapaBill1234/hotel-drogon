#!/usr/bin/env python3
"""Fail closed on a candidate unit's Git diff against the coordinator policy.

This script and its JSON policy run from the default branch in scope-guard.yml.
Candidate commits are fetched as data, never checked out or executed.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


SHA = re.compile(r"[0-9a-f]{40}\Z")
PROTECTED_PREFIXES = (".github/workflows/",)
PROTECTED_EXACT = (
    ".github/scope-policy.json",
    "scripts/check_unit_scope.py",
)
COORDINATOR_WORKFLOW = ".github/workflows/ci.yml"


def is_coordinator_owned(path: str) -> bool:
    return path in PROTECTED_EXACT or (
        path.startswith(PROTECTED_PREFIXES) and path != COORDINATOR_WORKFLOW
    )


def git(*args: str) -> bytes:
    return subprocess.check_output(("git", *args), stderr=subprocess.STDOUT)


def allowed_path(path: str, paths: list[str]) -> bool:
    return any(path == rule or (rule.endswith("/") and path.startswith(rule))
               for rule in paths)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()

    if not SHA.fullmatch(args.sha):
        raise ValueError("candidate SHA must be a complete lowercase Git SHA")
    if not args.branch.startswith("codex/") or not re.fullmatch(
        r"codex/[A-Za-z0-9][A-Za-z0-9._/-]*", args.branch
    ) or ".." in args.branch or "//" in args.branch:
        raise ValueError("candidate branch has an invalid name")

    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    if policy.get("version") != 1 or not isinstance(policy.get("units"), dict):
        raise ValueError("unsupported scope-policy schema")
    unit = policy["units"].get(args.branch)
    if not isinstance(unit, dict):
        raise ValueError(f"no coordinator scope for {args.branch}")
    base = unit.get("base_sha")
    paths = unit.get("allowed_paths")
    if not isinstance(base, str) or not SHA.fullmatch(base):
        raise ValueError("policy base_sha must be a full Git SHA")
    if not isinstance(paths, list) or not paths or any(
        not isinstance(path, str) or not path or path.startswith("/")
        or ".." in path.split("/") or "\\" in path for path in paths
    ):
        raise ValueError("policy allowed_paths must contain safe repository paths")
    if any(is_coordinator_owned(path) for path in paths):
        raise ValueError("policy cannot grant coordinator-owned guard/policy paths")

    tip = git("rev-parse", f"refs/remotes/origin/{args.branch}").decode().strip()
    if tip != args.sha:
        raise ValueError(f"branch tip {tip} differs from requested SHA {args.sha}")
    subprocess.run(("git", "merge-base", "--is-ancestor", base, args.sha),
                   check=True, stdout=subprocess.DEVNULL)
    raw = git("diff", "--name-status", "-z", "--no-renames", base, args.sha)
    entries = raw.split(b"\0")
    if entries[-1:] == [b""]:
        entries.pop()
    if not entries or len(entries) % 2:
        raise ValueError("candidate has no changes or an invalid diff")

    failures: list[str] = []
    for index in range(0, len(entries), 2):
        status = entries[index].decode("ascii", errors="replace")
        path = entries[index + 1].decode("utf-8", errors="surrogateescape")
        if status not in ("A", "M"):
            failures.append(f"{status} {path}: deletion or unsupported change")
        elif is_coordinator_owned(path):
            failures.append(f"{status} {path}: coordinator-owned guard/policy path")
        elif not allowed_path(path, paths):
            failures.append(f"{status} {path}: outside allowed scope")
        else:
            print(f"ALLOW {status} {path}")

    if failures:
        for failure in failures:
            print(f"DENY {failure}", file=sys.stderr)
        return 1
    print(f"Scope passed for {args.branch} at {args.sha} against {base}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"DENY scope guard error: {error}", file=sys.stderr)
        sys.exit(1)
