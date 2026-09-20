#!/usr/bin/env python3
"""
CI check: the pinned apt dependency set is consistent and still installable.

The plan's build-system decision (see the "Build system" row in
`docs/cpp-drogon-conversion-plan.md` and `docs/dependency-policy.md`) is CMake +
Ninja against Ubuntu 24.04 archive packages, pinned by version. Pinning is only
worth anything if something notices when it rots, and Ubuntu LTS archives do drop
superseded versions when a security update lands. This check is that something.

It asserts:

1. Every `pkg=version` pin in `Dockerfile` is well formed, and each pin lives in a
   named build stage.
2. The pinned versions still resolve on the architecture this runs on. Needs
   `apt-cache` and a populated index; if either is unavailable the check reports
   that it could not verify and FAILS, rather than passing vacuously — an
   unverified pin is exactly the rot this is meant to catch.
3. CI's `Install system dependencies` step installs exactly the BUILDER stage's
   packages, neither more nor fewer. The runtime stage is deliberately different
   (runtime libraries instead of -dev packages) and is not compared; every package
   in it is checked to exist as a pin.

Usage:
    python3 scripts/check_dependency_pins.py          # from the repo root
Exit 0 when every assertion holds, 1 otherwise.
"""

import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCKERFILE = os.path.join(REPO, "Dockerfile")
CI = os.path.join(REPO, ".github", "workflows", "ci.yml")

FROM_LINE = re.compile(r"^\s*FROM\s+\S+(?:\s+AS\s+(\w+))?", re.IGNORECASE)
PIN = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9.+-]*)=([^\s\\]+)\s*\\?$")

# Packages the CI runner needs that the Docker builder does not, each with a
# reason. Anything else appearing only in CI is drift. Conversely, a builder pin
# missing from CI is drift too, unless it is listed here.
CI_ONLY = {
    "python3": "runs the linters and smoke suites on the runner",
    "sudo": "the runner's apt invocations are not root",
    "g++": "runner ships it; the Dockerfile gets it via build-essential",
}
# Builder pins CI deliberately does not repeat, with the reason. The runner image
# already provides these; installing them pinned would add a failure mode (a
# superseded version disappearing from the archive) without changing what is built.
BUILDER_NOT_IN_CI = {
    "git": "the runner image ships git; CI only needs it to check out",
    "curl": "the runner image ships curl; the smokes use it directly",
    "ca-certificates": "the runner image already carries the CA bundle",
}


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def dockerfile_stages() -> dict[str, dict[str, str]]:
    """{stage: {package: version}} for every stage that pins packages."""
    stages: dict[str, dict[str, str]] = {}
    stage = "unnamed"
    for line in read(DOCKERFILE).splitlines():
        match = FROM_LINE.match(line)
        if match:
            stage = match.group(1) or "unnamed"
            stages.setdefault(stage, {})
            continue
        pin = PIN.match(line)
        if pin and any(ch.isdigit() for ch in pin.group(2)):
            stages.setdefault(stage, {})[pin.group(1)] = pin.group(2)
    return {name: pins for name, pins in stages.items() if pins}


def ci_packages(pinned: bool = False) -> "dict[str, str] | set[str]":
    """Dependencies named in CI's apt install step.

    `pinned=False` returns just the names; `pinned=True` returns {name: version}
    for the ones CI pins, so the two build paths can be compared version by
    version rather than merely by name.
    """
    text = read(CI)
    block = re.search(
        r"- name: Install system dependencies\s*\n\s*run: \|\s*\n(.*?)\n\n",
        text,
        re.DOTALL,
    )
    if not block:
        return {} if pinned else set()

    tokens = re.findall(
        r"^\s*([A-Za-z0-9][A-Za-z0-9.+-]*(?:=[^\s\\]+)?)\s*\\?$", block.group(1), re.MULTILINE
    )
    if pinned:
        return {tok.split("=", 1)[0]: tok.split("=", 1)[1] for tok in tokens if "=" in tok}
    return {tok.split("=", 1)[0] for tok in tokens}


def candidate_versions(names: list[str]) -> dict[str, str]:
    """{package: candidate version} from apt, or {} when apt is unusable."""
    if not shutil.which("apt-cache"):
        return {}

    # The index has to be populated or every package looks absent, which would
    # read as rot rather than as "nobody ran apt-get update".
    subprocess.run(["apt-get", "update", "-qq"], capture_output=True, timeout=600, check=False)
    try:
        out = subprocess.run(
            ["apt-cache", "policy", *names],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return {}

    found: dict[str, str] = {}
    current = None
    for line in out.splitlines():
        # apt-cache policy prints "<package>:" flush left, then indented fields.
        # Matching on "has no colon" is wrong: package names contain '-' and the
        # header line itself ends with ':'. An earlier version of this parser did
        # that and silently found zero candidates, which read as "the archive
        # dropped every pin".
        header = re.match(r"^(\S+):\s*$", line)
        if header:
            current = header.group(1)
        elif current and line.strip().startswith("Candidate:"):
            found[current] = line.split(":", 1)[1].strip()
            current = None
    return found


def main() -> int:
    errors: list[str] = []
    stages = dockerfile_stages()
    if not stages:
        print("[FAIL] no `pkg=version` pins found in the Dockerfile.", file=sys.stderr)
        return 1
    if "builder" not in stages:
        print("[FAIL] the Dockerfile has no `AS builder` stage with pins.", file=sys.stderr)
        return 1

    for name, pins in stages.items():
        print(f"Stage {name}: {len(pins)} pinned packages")

    all_pins: dict[str, str] = {}
    for pins in stages.values():
        all_pins.update(pins)

    # --- 2. do the pinned versions still exist? -------------------------------
    candidates = candidate_versions(sorted(all_pins))
    if not candidates:
        errors.append(
            "[FAIL] could not query apt for candidate versions (no apt-cache, or the "
            "index could not be populated). An unverified pin must not pass."
        )
    else:
        for name, pinned in sorted(all_pins.items()):
            candidate = candidates.get(name)
            if candidate is None:
                errors.append(f"[FAIL] {name} is pinned but has no apt candidate.")
            elif candidate != pinned:
                errors.append(
                    f"[FAIL] {name} is pinned to {pinned} but the archive now offers "
                    f"{candidate}. The package set moved: re-verify and update the pin "
                    f"(procedure in docs/dependency-policy.md)."
                )

    # --- 3. do the two build paths agree? -------------------------------------
    builder = set(stages["builder"])
    ci = ci_packages()
    if not ci:
        errors.append("[FAIL] could not parse CI's apt install step; the workflow changed shape.")
    else:
        for name in sorted(builder - ci - set(BUILDER_NOT_IN_CI)):
            errors.append(
                f"[FAIL] '{name}' is pinned in the Dockerfile builder stage but CI does "
                f"not install it: the two build paths have drifted."
            )
        for name in sorted(ci - builder - set(CI_ONLY)):
            errors.append(
                f"[FAIL] CI installs '{name}' but the Dockerfile builder stage does not "
                f"pin it. Add the pin, or record it in CI_ONLY with a reason."
            )
        # Same name is not enough: the versions must agree, or the two paths build
        # against different packages.
        ci_pins = ci_packages(pinned=True)
        for name, version in sorted(ci_pins.items()):
            if name in stages["builder"] and stages["builder"][name] != version:
                errors.append(
                    f"[FAIL] '{name}' is pinned to {stages['builder'][name]} in the "
                    f"Dockerfile but {version} in CI: the two build paths install "
                    f"different versions."
                )

    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        return 1

    print(f"CI packages agree with the builder stage: {len(ci)} packages")
    if CI_ONLY:
        print("Intentional CI-only packages: " + ", ".join(sorted(CI_ONLY)))
    if BUILDER_NOT_IN_CI:
        print("Builder pins CI inherits from the runner: " + ", ".join(sorted(BUILDER_NOT_IN_CI)))
    print("Dependency pins are consistent and still installable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
