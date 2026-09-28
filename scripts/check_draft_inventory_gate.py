#!/usr/bin/env python3
"""Guard the v4 unit 2 inventory against overstating draft persistence readiness."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
inventory = (root / "docs/phase1-parity-inventory.md").read_text()
contract = (root / "docs/v4-unit2-draft-persistence-contract.md").read_text()
main = (root / "src/main.cpp").read_text()
row = next((line for line in inventory.splitlines() if line.startswith("| Modular website controls and second theme |")), "")
checks = [
    ("inventory says persistence remains disabled", "persistence remains disabled" in row),
    ("inventory keeps live database evidence ahead", "Add live DB service transaction tests" in row),
    ("inventory keeps production persistence disabled", "No production draft table, read/save route" in row),
    ("contract requires transaction and API tests", "duplicate revision race" in contract and "Playwright staff flow" in contract),
    ("startup has no draft table reference", "phpretro_presentation_drafts" not in main),
]
failed = [name for name, ok in checks if not ok]
if failed:
    for name in failed:
        print(f"[FAIL] {name}")
    raise SystemExit(1)
print(f"[PASS] draft inventory remains behind persistence gate ({len(checks)} assertions)")
