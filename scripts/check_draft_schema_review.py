#!/usr/bin/env python3
"""Static guard for the uninstalled, website-owned draft schema proposal."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
review = (root / "docs/v4-unit2-draft-schema-review.md").read_text()
contract = (root / "docs/v4-unit2-draft-persistence-contract.md").read_text()
main = (root / "src/main.cpp").read_text()
checks = [
    ("proposal is explicitly not installed", "not installed" in review and "not referenced by startup" in review),
    ("proposal is website-owned", "phpretro_presentation_drafts" in review and "phpretro_*" in review),
    ("proposal excludes emulator and Pixel63 tables", "No PolarIS table" in review and "No Pixel63 table" in review),
    ("proposal uses named service methods", "named SQL" in review and "generic table writer" in review),
    ("contract requires conflict refusal", "409" in contract and "must refuse" in contract),
    ("contract requires audit atomicity", "same transaction" in contract and "rolls back" in contract),
    ("startup does not install proposal", "phpretro_presentation_drafts" not in main),
]
failed = [name for name, ok in checks if not ok]
if failed:
    for name in failed:
        print(f"[FAIL] {name}")
    raise SystemExit(1)
print(f"[PASS] draft schema review remains proposal-only ({len(checks)} assertions)")
