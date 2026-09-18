# hotel-drogon

C++ (Drogon) + React rewrite of the Habbo-style hotel CMS, replacing the
legacy PHPRetro PHP application and the abandoned Laravel/Inertia attempt.

- Backend: Drogon (C++17/20), async JSON API
- Frontend: decoupled React SPA (React Router + TanStack Query)
- Plan: `docs/cpp-drogon-conversion-plan.md`
- Parity inventory: `docs/phase1-parity-inventory.md`
- Legacy behavior reference (read-only, not part of this repo):
  https://github.com/PapaBill1234/PHPRetro-PDO

Status: **Phase 2 — backend foundation and directory scaffold (setup complete, build tooling deferred to Phase 2b)**

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
