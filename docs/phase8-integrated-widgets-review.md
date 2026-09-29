# Phase 8 integrated Homes widgets — next-unit review

**Reviewed HEAD:** `7b975a2e5b7d856bb3a0544ae5663dbe46fbe0f5` (`codex/v4-luna-continuation`)

## Recommendation

Do not start another Homes product slice from this worktree. The smallest independently authorized follow-up is **read-only verification of the already integrated guestbook/rating widgets**, followed by maintainer-created PR/CI review. No backend, schema, layout, group, purchase, guestbook-mutation, or sanitizer-gated work is authorized by the current run state.

The existing focused browser checks are the correct evidence units:

- `tests/e2e/homes-guestbook.spec.ts` — public JSON validation and, only when seeded variables are supplied, the renderer's raw-text assertion. It must not call the layout endpoint or any mutation.
- `tests/e2e/homes-rating.spec.ts` — public summary, anonymous authorization, CSRF rejection, and invalid-widget rejection before transaction creation. It must not open a Homes page or create a vote.

## Review findings

1. The integrated frontend build already passed after manual reconciliation (`frontend/` build, not a nonexistent repository-root package).
2. Guestbook and rating integration has no independent GitHub CI result yet. The prior token attempt returned HTTP 403 (`Resource not accessible by personal access token`); `pending` checks without a PR are not verification.
3. The guestbook browser/API check was not rerun during integration because the isolated Compose environment was unavailable. This is the only narrow local evidence gap identified for the integrated widgets; it is safe to close with a disposable, uniquely named stack and seeded website-owned fixtures only.
4. The Homes page renderer assertion in the guestbook spec is intentionally gated because it opens `/home/{id}`; do not use it as a substitute for the known-stalled layout GET. If the stack's layout request does not respond, stop and report the stall rather than increasing timeouts or retrying.
5. Guestbook POST/DELETE/privacy, group Homes, purchase/PolarIS credit writes, layout GET/PUT diagnosis, and DB-enabled sanitizer reruns remain explicit gates and are excluded.

## Verification scope

A maintainer or authorized runner should execute the existing focused specs against an isolated disposable Compose project:

```text
PLAYWRIGHT_HOMES_GUESTBOOK=1 npx playwright test tests/e2e/homes-guestbook.spec.ts
PLAYWRIGHT_HOMES_RATING=1 npx playwright test tests/e2e/homes-rating.spec.ts
```

The guestbook run should include a uniquely seeded personal profile/message only if the fixture contract is available; cleanup must prove zero fixture rows remain. The rating run should use the existing invalid-widget path and must leave rating/outbox/audit counts unchanged. Neither run should call layout PUT or any guestbook mutation.

Before claiming the combined workflow verified, a repository maintainer must create a PR or otherwise produce an independent CI run. The current branch has no such run.

## Gate status

- **Open:** maintainer PR/CI; isolated guestbook browser/API rerun.
- **Blocked:** Homes layout GET/PUT stall; DB-enabled sanitizer external 904-byte allocation review.
- **Decision-gated:** guestbook mutations; Group Homes contract/schema; purchase and PolarIS credit debit; BBCode/sanitizer and asset provenance.
- **Not changed by this review:** product behavior, integrated widgets, routes, schema, generated assets, primary/legacy data.
