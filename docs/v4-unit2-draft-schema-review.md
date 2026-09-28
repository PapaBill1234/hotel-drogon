# v4 unit 2 draft schema review

Status: **reviewed proposal; not installed and not referenced by startup.**

## Proposed website-owned table

The next persistence slice may add this table only after service transaction tests
are ready:

```sql
CREATE TABLE IF NOT EXISTS phpretro_presentation_drafts (
  document_kind ENUM('navigation','page') NOT NULL,
  document_key VARCHAR(128) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  updated_by INT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (document_kind, document_key),
  INDEX idx_presentation_drafts_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Ownership review

- The table name is `phpretro_*`, matching website/CMS ownership.
- No PolarIS table appears in the proposal and no foreign key is added to a
  PolarIS-owned table. `updated_by` is an audit actor identifier, not an
  identity handoff or a permission grant.
- No Pixel63 table, UUID assumption, game profile, client token, catalog, room,
  furniture or asset field is present.
- `payload` is accepted only after the typed presentation validator and draft
  envelope contract. JSON is bounded at the request boundary; the service must
  also enforce a serialized payload limit before SQL.
- The primary key prevents two rows for one document kind/key. Revision is
  compared in the update predicate; it is not trusted from a client response.

## Required implementation shape

The table must be created by the website-owned content-schema sequencer only
after the service tests exist. The service must use named SQL for this table,
not a generic table writer. Save must use one transaction for the compare-and-swap
row update and audit decision; a stale predicate returns a typed conflict and
never overwrites another draft. Audit failure must roll back the draft mutation,
or the save must fail before mutating if the selected transaction API cannot
include the audit insert.

This is a proposal, not a migration. No production or emulator database was
changed by this review.
