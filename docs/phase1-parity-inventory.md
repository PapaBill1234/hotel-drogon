# Phase 1 — Architecture baseline and parity inventory

Status: **draft, generated from a code read of `PapaBill1234/hotel@laravel-13-cms`
(commit `38c878f`) against `PapaBill1234/PHPRetro-PDO@master` (commit `56f2670`)
on 2026-09-17.** Not yet walked page-by-page in a browser. Treat every "Works"
below as "code exists and looks structurally correct," not "verified running."

This is the artifact Phase 1 of the conversion plan asks for: a route/feature
freeze, an owner for every table touched, and an explicit list of what is
replaced, in-progress-on-the-wrong-stack, or not started. Update this file
every time a page is converted — it is the thing that should catch stack
drift (Blade where the plan says Inertia/React, hand-rolled CRUD where it
says Filament) before it compounds.

## How to read the Status column

| Status | Meaning |
| --- | --- |
| **Not started** | No Laravel route/controller/view exists for this. |
| **Ported (Blade)** | A Laravel route+controller+view exists and looks functionally equivalent, but renders server-side Blade against the legacy `web-gallery` CSS — not the plan's Inertia+React target. Needs a second pass, not just a merge. |
| **Ported (Inertia)** | Matches the plan's intended stack for this layer. |
| **Refused / handoff** | Route exists, returns a message that the write isn't supported here (matches PHPRetro's own honest-501 pattern) — acceptable per plan rule 6, but means the feature isn't actually done. |
| **Read-only** | Displays Polaris/phpretro_ data but cannot write it. |
| **Wrong tool** | Built, but with a component the plan explicitly replaces (e.g. hand-rolled admin CRUD instead of Filament). |

## Table ownership (plan requirement: classify every query)

| Table family | Owner | Laravel access today |
| --- | --- | --- |
| `users`, `guilds`, `guilds_members`, `rooms`, `bans`, `catalog_items` (PolarIS core) | **PolarIS** | Read: unrestricted `holodb` query builder calls scattered across controllers (not a service layer — see gap below). Write: 4 hardcoded `UPDATE users` statements in `HolodbWriteGuard`; everything else throws `RuntimeException`. |
| `phpretro_news`, `phpretro_banners`, `phpretro_faq`, `phpretro_campaigns`, `phpretro_recommended`, `phpretro_homes_catalogue` | **Website/CMS (Laravel-owned per plan)** | Read via `HousekeepingToolsController`. Write allowed by `HolodbWriteGuard`'s `isWebsiteTableDml()` regex (any INSERT/UPDATE/DELETE against `phpretro_*`), but the controllers that would perform those writes are not yet built — see Phase 4 below. |
| `phpretro_user_reports`, `phpretro_helpdesk_tickets` | Website | Read + write implemented in `HousekeepingUsersController` (reports, help desk). |
| `sys` / `hotel_cms_sys` (Laravel `users`, sessions, jobs, passkeys) | **Laravel-owned, separate from PolarIS `users`** | Fully functional — this is the Fortify/starter-kit auth system. **Not connected to hotel identity at all.** Two parallel "users" concepts exist in this codebase right now. |

## Phase 2 — Laravel foundation

| Item | Plan asks for | Status |
| --- | --- | --- |
| Docker Compose (app, DB, Redis, queue, scheduler) | Yes | **Done.** `compose.yaml` + `compose.override.yaml` for XAMPP-beside mode. |
| `web-gallery` served without copying/hashing | Yes | **Done.** nginx `alias`, enforced by `scripts/visual-contract.sh`. |
| Route switch/proxy with rollback | Yes | **Partially done.** `proxy/cutover.map` mechanism exists and is a one-line add/remove + reload. Currently only routes `/up /health/* /horizon /build/*` — nothing hotel-facing has moved. |
| CI (PHP lint, tests, TS checks, Playwright) | Yes | **Not verified in this read** — no CI config found in the checked-out tree. |
| Redis cache/sessions/queues/locks | Yes | **Done.** DB 0 cache, DB 1 sessions (`hotel_session`), DB 2 Horizon queues, DB 3 scheduler flags. |
| Horizon | Adopt "when first queued work is introduced" | **Installed and wired**, ahead of any actual queued jobs existing yet. |
| Sentry / OpenTelemetry metrics | Before public cutover | **Not started.** |

## Phase 3 — Auth, authorization, Polaris access layer

| Item | Plan asks for | Status |
| --- | --- | --- |
| Login/logout/remember/reset for hotel identity | Yes | **Ported (Blade).** `HotelController::login/logout/forgot/forgotSubmit`. Uses `PolarisAuthService` — password_verify with sha1 legacy upgrade, matches PHPRetro's own approach. |
| Session regeneration, email verification | Yes | Login regenerates; email verification route (`/email`) exists and is honest about invalid tokens (per its own test). |
| Staff step-up auth (2FA) | Yes | **Not started.** `HotelStaff` middleware reuses the same `hotel.user_id` session as public users — no separate staff session, no step-up. PHPRetro had `phpretro_staff_sessions` + TOTP pages; nothing equivalent exists here. |
| Policies per role (visitor/user/group member/mod/owner/staff rank) | Yes, as Laravel policies | **Not started as policies.** Authorization is ad hoc `if ($guild->user_id !== $user->id)` checks inside controller methods, not `Illuminate\Auth\Access\Response`/policy classes. |
| Explicit Polaris service layer, "behind a service with explicit allowed operations" | **Central requirement of this phase** | **Not built.** What exists is `HolodbWriteGuard`: a regex blocklist on the DB connection, not named service methods. Controllers call `$this->holodb()->table('users')->...` directly. This is the single largest gap between the plan and the repo — nearly everything else in Phases 4–9 depends on this existing first. |
| Client SSO handoff from verified fields only | Yes | `HotelController::client`, `clientUtils` exist; not independently verified against "documented emulator behavior" in this read. |
| Audit logging for staff/sensitive actions | Yes | `Support/AdminAudit.php` exists (29 lines) — present but thin; only wired into a couple of write paths (report status changes), not staff logins or bulk actions generally. |

## Phase 4 — CMS and public content

| Page/feature | Plan target | Status |
| --- | --- | --- |
| Filament CMS (news, campaigns, collectables, banners, FAQ, settings, maintenance) | Filament resources | **Wrong tool.** `HousekeepingToolsController` (503 lines) is hand-written Blade CRUD — no Filament anywhere in `composer.json`. |
| Public: landing, community, articles, FAQ, collectables, maintenance, RSS | React/Inertia | **Ported (Blade), wrong stack.** All 29 `return view(...)` calls in `HotelController`; zero `Inertia::render` for hotel pages. RSS (`/articles/rss.xml`) exists as Blade emitting XML. |
| Raw-HTML/script settings as gated high-trust features | Explicit permission gates + warnings | **Not implemented as a gate.** Legacy PHPRetro's raw-output settings (`site_tracking`, banner HTML) were flagged in its own XSS audit as "deliberate staff code execution" needing documented trust boundaries; Laravel side doesn't yet reproduce or gate this at all — it's simply not read/write here yet. |
| Screenshot parity tests vs. original pages | Yes | **Not found.** `tests/Feature/VisualContractTest.php` checks file/route hygiene (no `web-gallery` copy, correct nginx alias), not visual screenshot diffing against the legacy page. |

## Phase 5 — Account, profile, credits, Club, client entry

| Page/feature | Status |
| --- | --- |
| `/me`, `/profile`, `/welcome`, `/client` | Ported (Blade). Reads Polaris `users` fields directly. |
| Registration | **Refused / handoff.** `registerSubmit()` returns "Website registration is not enabled... Use an existing hotel account." Fails this phase's own exit condition ("a new... user can complete the supported account journeys"). |
| Reauthenticate, security check | Ported (Blade). |
| Club display / subscribe | **Refused / handoff**, matching PHPRetro's own honest client-handoff pattern (correctly, per plan rule 6) — `HabbletController::clubSubscribe` returns "This website cannot take coins or grant club membership." |
| Credits / history | Ported (Blade), read-only. |

## Phase 6 — Messaging and friend management

| Feature | Status |
| --- | --- |
| Minimail (load/send/delete/trash/report) | **Ported (Blade), wrong output contract.** `MinimailController` (240 lines) implements the full flow but returns HTML fragments (`resources/views/hotel/habblet/minimail-*.blade.php`) — exactly the pattern the plan says to replace with "typed React form/action results." |
| Friend requests / search / management | **Refused for mutation.** `friendManagementRefuse()`, `friendAddRefuse()`, `confirmAddFriend`/`addFriend` exist as routes but several are explicit refusal stubs. |
| Reverb / live notifications | **Not started.** Not installed. |
| Anti-spam / rate-limit checks | Partial — `throttle:20,1` applied at the route level on several `habblet/ajax/*` endpoints; no dedicated anti-spam service. |

## Phase 7 — Groups, discussions, group profile

| Feature | Status |
| --- | --- |
| Group show/discussions/settings pages | Ported (Blade). `GroupController` (379 lines). |
| Join / leave | **Refused.** "PolarIS guilds_members is not written from this website." |
| Badge editor | **Refused / handoff**, matching PHPRetro's client-handoff design — correctly labeled, not faked. |
| Group create/purchase | Exists (`HabbletController::groupCreateForm/groupConfirm/groupPurchase`) but gated behind a "sign in / club required" wall; not confirmed to complete a real purchase (PolarIS write not allowlisted). |
| BBCode/rich-text allowlist for member content | **Not verified in this read** — not found as a distinct rendering component. |
| Discussions/forum moderation | Mostly **refused** (`discussionsRefuse`, `discussionsConfirmDelete` present but many discussion actions route to a generic refusal). |

## Phase 8 — MyHabbo Homes editor

| Item | Plan target | Status |
| --- | --- | --- |
| Versioned JSON layout API | Explicit requirement | **Not started.** No JSON API; `HomesController` (571 lines) + `Support/Homes.php` (942 lines) return Blade partials per widget type, same shape as legacy AJAX responses. |
| React canvas/drag-drop via dnd-kit | Explicit requirement | **Not started.** `dnd-kit` not in `package.json`. No interactive frontend for Homes exists — server renders static widget markup. |
| TanStack Query for optimistic updates | Explicit requirement | Not installed. |
| Store/inventory/stickers/notes | Legacy feature parity | Routes exist (`storeMain`, `storeItems`, `placeSticker`, `stickieEdit`, etc.) and appear functionally ported at the data level, but through the same server-rendered-fragment pattern the plan wants retired. |
| Ratings, guestbook | Ported (Blade) | Present, including `resetRatings`/`rate` and guestbook add/list/remove/configure. |
| Group Homes | "Port only after user Homes passes all interaction tests" | Group editing session routes exist (`groupStart`, `groupCancel`, `groupSave`) — being built in parallel with user Homes, ahead of the plan's stated sequencing. |

**This phase, as specified, has not been started.** What exists is a faithful data-layer port of the old behavior, which is real and reusable, but the interactive/versioned-API rebuild the plan explicitly calls for ("rebuilt deliberately, rather than copied through a compatibility layer") hasn't begun.

## Phase 9 — Housekeeping replacement

| Item | Plan target | Status |
| --- | --- | --- |
| Filament resources for users/bans/news/etc. | Filament | **Wrong tool.** `HousekeepingController` (382 lines) + `HousekeepingToolsController` (503) + `HousekeepingUsersController` (218) are hand-rolled Blade admin screens. |
| User management writes (rank/credits/mail/pixels) | Working, audited | **Refused.** "PolarIS users.rank / credits / mail / pixels / points are not written from this website." |
| Bans | Working, audited | **Refused.** "PolarIS bans are not written from this website." |
| Alerts | Working via RCON/CMS API | **Refused** unless RCON configured, and even then hardcoded to `'PolarIS rejected the alert.'` — no real RCON call implemented yet. |
| Reports, help desk | Working | **Actually functional** — real reads/writes against `phpretro_user_reports` and `phpretro_helpdesk_tickets`. This is the most complete piece of Phase 9. |
| Staff sessions / 2FA pages | Working | Blade views exist (`staffsessions.blade.php`, `twofactor.blade.php`) — not confirmed functional against real session-pinning logic (Phase 3 gap above). |
| Audit trail on all destructive actions | Required | Only wired into the report-status write path. |

## Phase 10 — Cutover

| Item | Status |
| --- | --- |
| Route-by-route parallel verification | Not started — nothing hotel-facing is behind the proxy yet. |
| Security review (SQLi/XSS/CSRF/IDOR) | Not started. Notably, `bootstrap/app.php` currently **exempts CSRF validation** on `habblet/ajax/*`, `myhabbo/*`, `minimail/*`, `groups/actions/*`, `discussions/*`, `mod/*`, `habboclub/*`, `friendmanagement/*` — the inverse of what this phase requires, and a real gap the moment any of those refused writes gets un-refused. |
| `cutover.map` scope | **Actively blocked by the repo's own guardrail.** `scripts/visual-contract.sh` fails the build if the map contains a line matching `habblet` or `housekeeping`. |
| Unsupported-feature register | Not written as a standalone doc; PHPRetro's own `docs/phase-reports/phase10-final-status.md` covers the *legacy* app's version of this list, not Laravel's. |

## What this inventory says, plainly

- **Genuinely reusable now:** routing map, middleware boundary (`hotel.auth`/`optional`/`staff`/`guest`), `PolarisAuthService`, the Homes/Hotel data-layer logic, Docker/nginx/cutover scaffolding, the `phpretro_*` migrations, reports/help-desk (the one fully-functional admin feature).
- **Needs replacing, not extending:** every Blade template for a hotel page (→ Inertia+React), `HousekeepingController`/`HousekeepingToolsController` (→ Filament), the CSRF exemption list (→ real token bridging), `HolodbWriteGuard` (→ named Polaris service classes).
- **Not started at all:** policies-as-code, staff step-up auth, Reverb, dnd-kit/TanStack Query Homes rebuild, screenshot parity testing, CI, monitoring, the JSON layout API, and any actual cutover.
- **The one blocker everything else sits on:** Phase 3's Polaris service layer. Registration, bans, credit edits, group join/leave, and badge saves are all "refused" for the same underlying reason — there's no audited, named write path yet, just a blocklist. Building that service layer (even narrow, feature-by-feature) is what turns the "refused" rows in this table into real ones.
