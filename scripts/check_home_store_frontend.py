#!/usr/bin/env python3
"""Guard the Phase 8 Store preparation slice stays read-only and unmounted."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
component = (root / "frontend/src/components/HomeStorePanel.tsx").read_text(encoding="utf-8")
hook = (root / "frontend/src/hooks/useHomeStore.ts").read_text(encoding="utf-8")
api = (root / "frontend/src/services/apiHomesStore.ts").read_text(encoding="utf-8")
home = (root / "frontend/src/pages/HomePage.tsx").read_text(encoding="utf-8")

assert "HomeStorePanel" not in home, "Store panel must remain unmounted while layout GET is blocked"
assert "fetchHomeStoreCategories" in api and "fetchHomeStoreItems" in api
assert "method: 'GET'" in api and "csrf: false" in api
assert "purchase" in component.lower() and "placement" in component.lower()
assert "data-testid=\"home-store-categories-loading\"" in component
assert "data-testid=\"home-store-categories-empty\"" in component
assert "data-testid=\"home-store-categories-error\"" in component
assert "data-testid=\"home-store-items-loading\"" in component
assert "data-testid=\"home-store-items-empty\"" in component
assert "data-testid=\"home-store-items-error\"" in component
assert "useQuery" in hook and "retry: false" in hook
for forbidden in ("POST", "PUT", "DELETE"):
    assert forbidden not in api, f"forbidden Store operation in API client: {forbidden}"
print("home Store frontend contract: 9 assertions passed")
