#!/usr/bin/env python3
"""Static guard for the isolated Homes rating renderer contract.

This is deliberately not an end-to-end claim: it checks the typed React source
without starting the Homes page or calling its blocked layout endpoint.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "source",
    nargs="?",
    type=Path,
    default=ROOT / "frontend" / "src" / "pages" / "HomePage.tsx",
    help="HomePage.tsx source to verify (defaults to this worktree)",
)
source = parser.parse_args().source.read_text(encoding="utf-8")

checks = {
    "rating marker": 'data-testid="home-rating"' in source,
    "polite live region": 'aria-live="polite"' in source,
    "pending state announced": "aria-busy={vote.isPending}" in source,
    "five typed vote buttons": "[1, 2, 3, 4, 5].map((rating)" in source,
    "button semantics": '<button type="button"' in source and 'className={`r${rating}-unit rater`' in source,
    "server error is rendered": 'data-testid="home-rating-error"' in source,
    "owner state is rendered": 'data-testid="home-rating-owner"' in source,
    "prior-vote state is rendered": 'data-testid="home-rating-voted"' in source,
    "no rating anchor controls": 'className="rater"' not in source,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"rating frontend contract failed: {', '.join(failed)}")
print(f"rating frontend contract: {len(checks)}/{len(checks)}")
