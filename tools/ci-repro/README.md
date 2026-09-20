# Isolated CI-reproduction project

Reproduces GitHub Actions' fresh-runner conditions **locally and safely**, to
diagnose the flaky `integration-smoke` job without disturbing the primary stack.

Required by the safety constraint in `docs/ai-run-state.md`: CI reproduction
must use a clearly isolated, disposable Compose project.

## Why it is separate from `compose.yaml`

The root `compose.yaml` pins `container_name:` values (`hotel_backend`,
`hotel_mariadb`, …). Running it a second time locally would collide with the
already-running stack. This file deliberately sets **no** `container_name`, so
Compose derives `ci-repro-<service>-1`.

It also deliberately does **not** mount:

- `frontend/dist` — absent on a fresh CI runner;
- `../legacy/phpretro-pdo/web-gallery` — also absent on a fresh runner.

Those two absent mounts are part of what CI actually exercises, so reproducing
CI means reproducing their absence.

## Usage

```sh
# bring up (own project, own network, own throwaway volumes, port 3100)
docker compose -p ci-repro -f tools/ci-repro/compose.yaml up -d --build

# tear down — touches ONLY ci-repro_* ; safe and scoped
docker compose -p ci-repro -f tools/ci-repro/compose.yaml down -v
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

## Safety

`down -v` here is scoped to `-p ci-repro` and destroys only this project's
disposable volumes. **Never** run a bare `docker compose down -v` from the repo
root, and never `docker volume prune` — both would destroy the primary stack's
`hotel-drogon_*` volumes.
