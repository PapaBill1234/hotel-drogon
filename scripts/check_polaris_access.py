#!/usr/bin/env python3
"""
CI Check: Ensure zero direct SQL queries against PolarIS-owned tables exist outside src/services/.
PolarIS-owned tables: users, guilds, guilds_members, bans, rooms, catalog_items, items, users_subscriptions
"""

import os
import re
import sys

POLARIS_TABLES = [
    "users",
    "guilds",
    "guilds_members",
    "bans",
    "rooms",
    "catalog_items",
    "items",
    "users_subscriptions",
]

# Match SQL statements targeting polaris tables (FROM table, INTO table, UPDATE table, JOIN table)
TABLE_REGEX = re.compile(
    r'\b(?:FROM|INTO|UPDATE|JOIN)\s+`?(' + '|'.join(POLARIS_TABLES) + r')`?\b',
    re.IGNORECASE
)

def check_polaris_isolation(src_dir):
    violations = []
    scanned_files = 0

    for root, _, files in os.walk(src_dir):
        # Skip src/services and tests directory
        rel_root = os.path.relpath(root, src_dir)
        if rel_root.startswith("services") or "tests" in root:
            continue

        for file in files:
            if not file.endswith(('.h', '.cpp', '.c', '.hpp')):
                continue

            scanned_files += 1
            file_path = os.path.join(root, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            for line_no, line in enumerate(lines, 1):
                # Ignore comments
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                    continue

                matches = TABLE_REGEX.findall(line)
                if matches:
                    violations.append(
                        f"[VIOLATION] {file_path}:{line_no}: Direct PolarIS table access '{matches[0]}' outside service layer:\n  {stripped}"
                    )

    print(f"Scanned {scanned_files} non-service files for PolarIS direct table access.")
    if violations:
        for v in violations:
            print(v, file=sys.stderr)
        return False

    print("Isolation verified: Zero direct PolarIS table access outside src/services/.")
    return True

if __name__ == "__main__":
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "src"
    if not os.path.exists(src_dir):
        src_dir = os.path.join(os.path.dirname(__file__), "..", "src")

    success = check_polaris_isolation(src_dir)
    sys.exit(0 if success else 1)
