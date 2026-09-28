# v4 unit 2 draft persistence contract

Status: **design-only; no schema or persistence implementation yet.**

This document defines the smallest next boundary after the read-only presentation
validator. It does not authorize publish, rollback, theme switching, media import,
Pixel63 writes, or any emulator operation.

## Ownership

Draft documents are website-owned CMS data. They must live in a versioned
`phpretro_*` table family and be accessed only through named `PresentationService`
methods. No PolarIS or Pixel63 table is read or written. A theme id is website
state and cannot select a game profile or client.

## Document envelope

The validated payload remains the typed `NavigationDocument` or `PageDocument`
from `frontend/src/types/cms.ts`. Persistence adds an envelope, not a generic
table/column API:

```json
{
  "document_kind": "navigation|page",
  "document_key": "/community|navigation",
  "revision": 3,
  "payload": { "...validated typed document..." },
  "state": "draft",
  "updated_at": 1730000000,
  "updated_by": 7
}
```

Required constraints:

- `document_kind` is a closed enum: `navigation` or `page`.
- `document_key` is `navigation` or a known public route; it is never an SQL
  table name or arbitrary path.
- `revision` is the server revision and is monotonic per document key.
- `payload` must pass `PresentationValidationService` before storage.
- `state` is currently only `draft`; published state is a later slice.
- `updated_by` is the authenticated staff account id, never client supplied.
- JSON size, key length, and slot/item limits remain bounded by the validator and
  a separate request-body limit.

## Named service boundary

The next implementation may expose only these operations:

- `readDraft(actor, documentKey, callback)` — staff rank check, returns the
  current draft or an explicit not-found result; no fallback to published data.
- `saveDraft(actor, documentKey, basedOnRevision, payload, ip, callback)` —
  validates the typed payload, checks the staff capability, and performs an
  optimistic compare-and-swap on the website-owned revision.

No generic `saveDocument(table, json)` method is permitted.

## Conflict and failure contract

A save must refuse rather than overwrite when `basedOnRevision` differs from the
current server revision:

```json
{
  "status": 409,
  "error": "Conflict",
  "current_revision": 4,
  "draft": { "...current typed document..." }
}
```

Validation failure is `400` with the validator's stable `code`, `field`, and
`message`. Missing/expired staff session is `401` or `403` according to the
existing `AuthPolicy`; missing CSRF is rejected by `CsrfFilter` before the
service is called. Database failure is a bounded `503`, never a success response.

## Atomicity and audit

The eventual save mutation must update the document payload, revision, updater,
and timestamp in one transaction. The audit row is part of the same transaction
or the entire mutation rolls back. Audit details must identify the named document
key and revision, never record passwords, session tokens, raw client credentials,
or unbounded request bodies.

The save route must use a named endpoint and `CsrfFilter`; it must not be added
until the service and transaction tests exist. Publish and rollback are separate
later work units and cannot be implied by a successful draft save.

## Verification gate before implementation

The candidate schema and ownership review are recorded in
[`v4-unit2-draft-schema-review.md`](v4-unit2-draft-schema-review.md). It is a
proposal only and has not been added to startup or any database.

Before adding a table or route, verify in the pinned environment:

1. schema/table name and column limits are website-owned and do not collide with
   PolarIS or Pixel63;
2. validator unit tests pass under `-Werror` and ASan/UBSan;
3. service tests prove malformed JSON, stale revision, duplicate revision race,
   rollback on audit failure, and no cross-document overwrite;
4. CSRF and rank checks are present in route macros and exercised live;
5. API contract and a Playwright staff flow cover read, save, conflict, and
   unauthorized paths;
6. inventory and run state record the exact checks and any unavailable evidence.

Until these checks are implemented, this contract is a design artifact only.
