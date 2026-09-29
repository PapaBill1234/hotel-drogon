# Phase 8 Store catalogue read-only review

**Reviewed commit:** `88e1075` (`docs: qualify integrated widget review scope`)

## Scope and authorization

This is a bounded Phase 8 read-only Store/catalogue evidence unit. It does not add or authorize purchase, credit/inventory writes, placement, assets/media, layout changes, or guestbook/rating integration. The existing purchase and group-Homes gates remain blocked.

## Legacy parity evidence

The read-only PHPRetro-PDO source was inspected in `includes/PhpretroHomes.php` at the following methods:

- `storeType()` (541–551): legacy accepts aliases and defaults unknown values to `sticker`.
- `storeCategories()` (559–566): categories are filtered by the current rank and placement, grouped by `(category_id, category)`, and ordered by category name then ID.
- `storeItems()` (568–579): items use the current rank and placement filters, optionally filter a positive category, and order by catalogue ID descending.
- `purchase()` (593–639): purchase locks and mutates PolarIS credits, writes website-owned inventory/transactions, and emits a sync event. This is explicitly **out of scope**.

The current C++ boundary intentionally does not copy the unsafe/defaulting request grammar. `HomeStoreService` accepts only the three explicitly authorized personal read types (`sticker`, `background`, `note`), rereads the caller's current PolarIS rank through a named read query, and applies fixed personal placement (`homes` or `anywhere`). It returns typed metadata only. Catalogue `data` is exposed only as an optional opaque identifier matching `[A-Za-z0-9_-]{1,128}`; invalid values are omitted rather than interpreted as CSS, URLs, HTML, or media paths.

## Current implementation reviewed

- Routes: `GET /api/homes/store/categories` and `GET /api/homes/store/items` in `include/controllers/HomesController.h` / `src/controllers/HomesController.cpp`.
- Service: `include/services/HomeStoreService.h` and `src/services/HomeStoreService.cpp`.
- Unit evidence: `tests/unit/HomeStoreServiceTest.cpp` covers type allowlisting, opaque-key validation, and strict unsigned category parsing.
- Database evidence: `tests/integration/HomeStoreServiceDbTest.cpp` exercises rank, placement, type/category filtering, ordering, missing users, and read-only behavior.
- Browser evidence: `tests/e2e/homes-store.spec.ts` covers anonymous denial, invalid type/category, and signed-in browse behavior.

## Safety decisions preserved

- No purchase endpoint, credit decrement, transaction insert, inventory insert, placement, or emulator command was added.
- No catalogue media was fetched, imported, or assigned provenance.
- No personal endpoint reads group-assigned rows; group Homes remains a separate authorization/schema decision gate.
- Existing integrated guestbook/rating behavior was not changed.
- The blocked Homes layout GET/PUT path and repeated DB-enabled sanitizer leak gate were not retried.

## Verification applicability

This artifact changes documentation only. The applicable check is:

```text
git diff --check
```

Build, sanitizer, database, API, and browser checks are not repeated by this docs-only review; their previously recorded Store results remain evidence for the implementation at this commit. No primary or legacy data was changed.
