# hotel-drogon

C++ (Drogon) + React rewrite of the Habbo-style hotel CMS, replacing the
legacy PHPRetro PHP application and the abandoned Laravel/Inertia attempt.

- Backend: Drogon (C++17/20), async JSON API
- Frontend: decoupled React SPA (React Router + TanStack Query)
- Plan: `docs/cpp-drogon-conversion-plan.md`
- Parity inventory: `docs/phase1-parity-inventory.md`
- Legacy behavior reference (read-only, not part of this repo):
  https://github.com/PapaBill1234/PHPRetro-PDO

Status: **Phase 3 and Phase 4 narrow exits verified; Phase 2b and Phase 1
OpenAPI still incomplete.** See [current state](docs/ai-run-state.md) and
[feature inventory](docs/phase1-parity-inventory.md) for the release gaps.

---

## Running the stack

A fresh clone is not yet one-command runnable: `compose.yaml` requires a
read-only sibling `../legacy/phpretro-pdo` checkout containing
`web-gallery/` and `housekeeping/images/`, and nginx serves a
`frontend/dist` bundle currently built outside Compose. The planned
frontend build service and reproducible asset acquisition are open work.
Do not package legacy assets until redistribution rights are verified.

```sh
docker compose up -d --build
# nginx is published on :3000
curl http://localhost:3000/health
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

# Live integration (12 assertions: auth, sessions, authorization, CSRF)
sh scripts/smoke_phase3.sh http://localhost:3000
```

All three run in CI (`.github/workflows/ci.yml`); the smoke suite runs against a
freshly built stack in a separate job.

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
