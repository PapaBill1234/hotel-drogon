# Isolated CI-reproduction project

Two Compose files live here, both bound by the same safety rule: any CI
reproduction runs in its own project with its own throwaway volumes.

| File | Purpose |
| --- | --- |
| `compose.yaml` | Reproduces the **smoke job's** fresh-runner conditions. Deliberately omits the `frontend/dist` and `web-gallery` mounts, because a fresh runner has neither. |
| `compose-parity.yaml` | Reproduces the **visual-parity job's** conditions instead: it mounts everything the real stack mounts (so pages render at all) but still uses a disposable project, network, volumes and port (3200), so a genuinely fresh database can be created safely. Added while diagnosing why parity failed on CI and passed locally. |
| `compose-cutover.yaml` | Hosts the **cutover/rollback demonstration**: the new stack and the legacy PHP stack behind one proxy running the REAL `proxy/nginx.conf` and `proxy/cutover.map`, on port 3500. Separate because the production `compose.yaml` deliberately has no legacy PHP service, and adding one there would put an unused runtime in the deployed stack just to satisfy a test. |
| `compose-no-webgallery.yaml` | Reproduces the **empty-`web-gallery` defect** that broke parity: the proxy mounts no legacy assets, exactly as a CI runner that never cloned them. Kept so the failure can be reproduced on demand rather than re-derived. |

### The cutover harness

```sh
docker compose -p ci-cutover -f tools/ci-repro/compose-cutover.yaml up -d --build
# seed both databases (the harness's legacy DB has a minimal schema, so it takes
# the subset fixtures, not the shared seed):
get-content tools/ci-repro/cutover-fixtures.sql -raw | docker exec -i ci-cutover-mariadb-1 mysql -uhotel -photel_secret polaris
get-content tools/ci-repro/cutover-fixtures.sql -raw | docker exec -i ci-cutover-legacy-db-1 mysql -uhotel -photel_secret polaris
COMPOSE_ARGS="-p ci-cutover -f tools/ci-repro/compose-cutover.yaml" \
  sh scripts/check_cutover.sh http://localhost:3500
docker compose -p ci-cutover -f tools/ci-repro/compose-cutover.yaml down -v
```

The CI job `cutover-check` runs exactly this. `scripts/check_cutover.sh` rewrites
`proxy/cutover.map` (the committed file, restored on exit even if it fails),
reloads the proxy, and asserts that `/articles/rss.xml` is served by the new
stack, then by the legacy stack, then by the new stack again.

Two details of the harness worth knowing before changing it:

- `cutover-legacy-min.sql` creates only `phpretro_news` and
  `phpretro_site_settings`, the two tables `xml/rss.php` reads. The full
  `CleanDB.sql` import (~5.5 MB) made `ci-cutover-legacy-db-1` exit 1 on a GitHub
  runner while the same stack starts fine locally; the harness does not need the
  rest of the schema. `cutover-fixtures.sql` is the matching subset of the shared
  seed, with values copied verbatim.
- `check_cutover.sh` requires the Docker CLI and a proxy it can reach, so it runs
  on the host or on a CI runner — not from inside a container, where the Compose
  mount paths resolve to paths that do not exist on the Docker host.

## Why they are separate from `compose.yaml` (the repo root one)

The root `compose.yaml` pins `container_name:` values (`hotel_backend`,
`hotel_mariadb`, …). Running it a second time locally would collide with the
already-running stack. These files deliberately set **no** `container_name`, so
Compose derives `ci-repro-<service>-1` / `ci-parity-<service>-1`.

## Usage

```sh
# smoke-job conditions (no frontend/dist, no web-gallery)
docker compose -p ci-repro -f tools/ci-repro/compose.yaml up -d --build
docker compose -p ci-repro -f tools/ci-repro/compose.yaml down -v

# parity-job conditions (everything mounted, fresh database, port 3200)
docker compose -p ci-parity -f tools/ci-repro/compose-parity.yaml up -d --build
docker compose -p ci-parity -f tools/ci-repro/compose-parity.yaml down -v
```

Then, to mirror CI's exact poll-then-smoke sequence with a Linux client at
in-network latency, create the project first so the network exists, attach a
client, and only then start the services:

```sh
docker compose -p ci-repro -f tools/ci-repro/compose.yaml create
docker run -d --name ci-repro-client --network ci-repro_ci-repro-net \
  -v "$PWD/scripts:/scripts:ro" -v /tmp/ci-repro:/dbg:ro \
  curlimages/curl:latest sh /dbg/poll_and_smoke.sh http://proxy
docker compose -p ci-repro -f tools/ci-repro/compose.yaml start
docker logs ci-repro-client
```

Client latency matters: a Windows/PowerShell client adds hundreds of
milliseconds of process-spawn latency per request, which masks short readiness
windows. Use a Linux client for anything timing-sensitive.

## What it established

- The Phase 3 smoke passes on a fresh disposable database, with both CI-only
  missing mounts, from an in-network Linux client that detected `/health` after
  **3 polls (~150ms)**. So the missing mounts and fresh-database state alone do
  not explain the CI failure.
- The backend logs show the server accepting connections ~**620ms before** the
  user seed completes, and `/health` reports ready on the client object existing
  rather than on the seed having finished — a genuine readiness window, and the
  leading explanation for the job being flaky rather than deterministically
  broken.
- For the parity job: with the fixtures applied and `site_closed=1` on a fresh
  disposable database, all six parity pages pass under Linux Chromium, including
  with the legacy app unreachable. The parity failure on CI is therefore **not**
  explained by fresh-database state, the fixtures, the baselines or the
  Playwright version — see the fourth-pass entry in `docs/ai-run-state.md`.

## Safety

`down -v` here is scoped to `-p ci-repro` / `-p ci-parity` and destroys only
those projects' disposable volumes. **Never** run a bare `docker compose down -v`
from the repo root, and never `docker volume prune` — both would destroy the
primary stack's `hotel-drogon_*` volumes.
