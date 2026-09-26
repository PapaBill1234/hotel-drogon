# hotel-drogon

C++ (Drogon) + React rewrite of the Habbo-style hotel CMS, replacing the
legacy PHPRetro PHP application and the abandoned Laravel/Inertia attempt.

- Backend: Drogon (C++17/20), async JSON API
- Frontend: decoupled React SPA (React Router + TanStack Query)
- Plan: `docs/cpp-drogon-conversion-plan.md`
- Parity inventory: `docs/phase1-parity-inventory.md`
- Legacy behavior reference (read-only, not part of this repo):
  https://github.com/PapaBill1234/PHPRetro-PDO

Status: **Phases 1, 2b, 3 and 4 narrow exits verified; Phase 5's existing-user
journey — profile and credits — now works through React.** See [current
state](docs/ai-run-state.md) and [feature
inventory](docs/phase1-parity-inventory.md) for the release gaps.

---

## Running the stack

A fresh clone needs a read-only sibling `../legacy/phpretro-pdo` checkout
containing `web-gallery/` and `housekeeping/images/`. Compose builds the React
bundle from `frontend/package-lock.json` and publishes it to nginx through a
generated-assets volume; no host `npm run build` is needed. Reproducible
acquisition of the legacy assets remains open work.
Do not package legacy assets until redistribution rights are verified.

```sh
docker compose up -d --build
# nginx is published on :3000
curl http://localhost:3000/health
# frontend-build should have exited 0; the worker runs without an HTTP probe
docker compose ps -a frontend-build worker
```

Seeded development accounts (both password `password123`):

| Username | Rank | Role |
| --- | --- | --- |
| `testuser` | 1 | regular user |
| `admin` | 7 | staff |

The seed only runs when the account is absent (`INSERT IGNORE`), so changing a
password in code will not rewrite existing rows. Inspect the data and use an
authorized, auditable update path when a reseed is needed. Never reset the
primary or legacy database volume without explicit prior approval; see the
plan's data-safety rule.

> Recreating the backend container does not require restarting the proxy: the
> cutover map returns literal `host:port` values resolved through Docker's
> embedded DNS on each request (see the `resolver` note in `proxy/nginx.conf`).
> Do not reintroduce an `upstream` block — a variable `proxy_pass` target that
> matches a server group is pinned at startup and will 502 after a recreate.

## Verifying

```sh
# Static enforcement
python3 scripts/check_csrf_rules.py       # every mutating route has CsrfFilter
python3 scripts/check_polaris_access.py   # no direct Polaris SQL outside src/services/
python3 scripts/check_admin_ui_coverage.py # admin routes and client calls agree
python3 scripts/check_dependency_pins.py   # exact Ubuntu pins match the archive

# Live integration (12 assertions: auth, sessions, authorization, CSRF)
sh scripts/smoke_phase3.sh http://localhost:3000
python3 scripts/smoke_phase4_public.py http://localhost:3000

# The account API contract against its live routes. Requires a DISPOSABLE,
# seeded stack: it writes profile fields and a password, and restores them in a
# finally block, but it must never point at data you care about.
ACCOUNT_CONTRACT_DISPOSABLE=1 python3 scripts/check_account_contract.py http://localhost:3000

# Browser suites (each gated so a bare `npx playwright test` keeps its
# visual-parity meaning). From tests/e2e:
#   PLAYWRIGHT_ACCOUNT=1 npx playwright test account.spec.ts
#   PLAYWRIGHT_CREDITS=1 npx playwright test credits.spec.ts
#   PLAYWRIGHT_CLIENT=1  npx playwright test client.spec.ts
#   PLAYWRIGHT_RESET=1   npx playwright test password-reset.spec.ts
#   PLAYWRIGHT_ADMIN=1   npx playwright test admin.spec.ts
```

All of these run in CI (`.github/workflows/ci.yml`); the smoke and browser suites
run against a freshly built stack in a separate job.

## Architecture notes

**Polaris table access is service-layer only.** Every read/write goes through a
named method on `UserAccountService`, `GuildService`, `BanService`, or
`ReportService`. There is deliberately no generic `update(table, column, value)`
escape hatch — that is what the abandoned Laravel attempt got wrong when it
substituted a regex write-blocklist (`HolodbWriteGuard`) for a real service
layer. `check_polaris_access.py` fails the build if direct SQL reappears outside
`src/services/`.

**Authorization is explicit functions, not inline checks.** See
`include/filters/AuthPolicy.h`: `requireUser`, `requireStaff`,
`requireGroupOwner`, `requireGroupAdmin`.

**Sessions are Redis-backed with separate keyspaces and cookies** — public users
get `hotel_session` (7 days), staff get `hotel_staff_session` (2 hours, distinct
Redis prefix, rank-gated). `XSRF-TOKEN` is issued as a non-HttpOnly cookie for
double-submit CSRF.

**Account routes keep the legacy URL shape.** `/account` is the sign-in screen
(`account.php`), `/me` is `me.php`, `/account/profile` is `profile.php`, and
`/logout` ends the public session. `/credits` is `credits.php` (the purse) and
`/credits/history` is `history.php` (the ledger), which is the path the legacy
purse itself linked to. The signed-in branch of the page header is rendered by
`CommunityShell` from the same `community_header.php` markup, so the legacy
stylesheets style these pages with the classes they were written for. A guarded
page renders the sign-in form **in place** rather than redirecting, which is what
`includes/session.php` achieved by carrying the original destination.

**The Coin balance comes from the user row; the ledger only records changes.**
`/api/account/purse` reads PolarIS `users.credits`, as `credits.php` did.
`/api/account/transactions` serves the caller's own `phpretro_transactions` rows
through `TransactionService`. Neither route takes a user id — the subject is
always the session's user — so another account's balance or ledger is not
reachable through them. The ledger's only writers are the housekeeping credit
adjustment (Phase 9) and the MyHabbo Homes store (Phase 8), so an empty history
on a fresh stack is expected, not broken.

**`/client` is a handoff, not a client.** The legacy `client.php` embedded a
Shockwave/Director object that modern browsers cannot run, so the converted page
issues an SSO ticket in the legacy `GenerateTicket("sso")` format, stores it in
`users.auth_ticket`, reports the hotel connection settings from
`phpretro_site_settings`, and links to the hotel endpoint only when those
settings exist. It never claims the hotel accepts the ticket — that is emulator
behaviour, no PolarIS/Nitro source is available here, and the browser-native
client is tracked as its own milestone. An unconfigured stack says so and lists
the missing keys instead of offering a control that cannot work.

**Password recovery has no mail transport, and says so.** `/account/password/forgot`
implements both legacy `forgot.php` actions, and a match issues a single-use token
stored only as a SHA-256 hash in Redis with a 30-minute TTL — no PolarIS column is
added. Delivery goes through `MailService`, whose only transport **logs**: it
records the recipient and subject and withholds the body, because a reset body
carries a live token. It reports `logged`, never `delivered`. Until an SMTP
transport is approved, nobody receives a reset link, and the pages state that
rather than implying an email was sent.

**Anonymous routes get a header check, not a CSRF exemption.** The three recovery
routes exist for a caller with no session, so `CsrfFilter` (which validates a
session-bound token) cannot protect them. `CsrfPublicFilter` requires the
`X-XSRF-TOKEN` header instead — a cross-origin request cannot set a custom header
without a preflight this application does not answer. It checks presence, not
value, and says so; `scripts/check_csrf_rules.py` keeps an explicit list of those
routes and still fails if one loses the filter.

**Two modules may open a request, one per surface.** `services/api.ts` (public,
including the account routes) and `services/apiAdmin.ts` (staff).
`scripts/check_admin_ui_coverage.py` fails the build if a third module calls
`fetch()` itself, so cookie and CSRF policy stay in one place per surface.

**Drogon 1.8.7 on Ubuntu 24.04 links jsoncpp, not nlohmann.** Controllers must
use `Json::Value` / `isMember()` / `asString()`. (`nlohmann-json3-dev` remains a
dependency of Drogon's CMake config, but calling `newHttpJsonResponse` with an
`nlohmann::json` will not compile.)

---

## Directory Layout

The project follows a standard Drogon + React modular architecture:

```
hotel-drogon/
├── config/              # Drogon configuration files & environment templates
├── docs/                # Conversion plan and phase parity inventory documentation
├── frontend/            # Decoupled React + TypeScript single-page application
│   └── src/
│       ├── components/  # Reusable UI components (legacy web-gallery styling)
│       ├── hooks/       # Custom React hooks & TanStack Query hooks
│       ├── pages/       # Route-level views (landing, me, community, homes, admin)
│       ├── services/    # Client API fetchers
│       └── types/       # Shared TypeScript interfaces & OpenAPI generated types
├── include/             # C++ header declarations
│   ├── controllers/     # Drogon HTTP & WebSocket controller declarations
│   ├── filters/         # HTTP filters / middleware headers (Auth, CSRF, RateLimit)
│   ├── models/          # Drogon ORM models & DTO headers
│   ├── plugins/         # Drogon plugin headers (Redis, Audit, Metrics)
│   ├── services/        # Service layer headers (PolarIS access, Audit, Homes)
│   └── utils/           # Utility, crypto, and validation helper headers
├── src/                 # C++ implementation files
│   ├── controllers/     # Drogon HTTP & WebSocket controller implementations
│   ├── filters/         # HTTP filter implementations
│   ├── models/          # Drogon ORM model implementations
│   ├── plugins/         # Drogon plugin implementations
│   ├── services/        # Service layer implementations (named PolarIS access methods)
│   ├── utils/           # Utility & helper implementations
│   └── worker/          # Background worker process entry points
└── tests/               # Backend & frontend automated test suites
    ├── unit/            # Catch2 / GTest unit tests
    ├── integration/     # Service layer and API integration tests
    └── e2e/             # Playwright browser end-to-end flows
```
