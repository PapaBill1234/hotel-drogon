# Isolated PolarIS and Octane development lab

This optional lab runs the three reviewed upstream projects beside the Drogon
website. It has its own MariaDB volume and network. It never uses the primary
hotel or read-only legacy databases. All three host ports bind to `127.0.0.1`.

The reviewed revisions are in `upstreams.env`. On this Windows host, fetch
them into the sibling `../upstream` directory with:

```powershell
& tools/emulator-lab/fetch-upstreams.ps1
```

On a Unix host, run `sh tools/emulator-lab/fetch-upstreams.sh`. Both scripts
refuse a dirty existing checkout. The Polaris README says Java 21, but its
pinned `Emulator/pom.xml` enforces Java 25; the image uses Java 25.

## Start and check the service shell

From the `hotel-drogon` root:

```powershell
docker compose -f tools/emulator-lab/compose.yaml up -d --build
node tools/emulator-lab/verify-lab.mjs --shell-only
```

- Octane client: <http://127.0.0.1:3201/>
- PolarIS HTTP/WebSocket: `127.0.0.1:3202`
- PolarIS TCP game port: `127.0.0.1:3203`

The smoke checks both direct and proxied health endpoints, the HTML/config
responses, and the WebSocket handshake. `--shell-only` deliberately reports
that the game assets and in-game journey are unverified. No user account is
created by this check.

## Assemble local game assets

The three upstream project trees do not contain `.nitro` game bundles.
`prepare-assets.mjs` assembles a local-only `../upstream/Nitro-Files-lab-v1`
from pinned, clean checkouts of
[Nitro default assets](https://git.krews.org/nitro/default-assets) at
`e8b882f84095ad3b3b6bb0b31e03d0cf8f7e104c` and
[sphynxkitten/nitro-assets](https://github.com/sphynxkitten/nitro-assets) at
`005cd6430c82f274603805bb2dd6686e714f2271`. The script validates the
source revisions and required game data. It refuses to overwrite its output.
The resulting directory contains 12,834 `.nitro` files and is outside Git.
These assets have not been cleared for redistribution.

The assessed [all-in-1-converter](https://github.com/duckietm/all-in-1-converter)
is not required for this local lab and has not been run. It requires .NET 11
Preview 6, can fetch SWFs, and includes unrelated database-writing menus.

From the repository root, assemble and mount the assets read-only:

```powershell
node tools/emulator-lab/prepare-assets.mjs
$env:NITRO_FILES_DIR = (Resolve-Path '../upstream/Nitro-Files-lab-v1').Path
docker compose -p hotel-emulator-lab -f tools/emulator-lab/compose.yaml -f tools/emulator-lab/compose.assets.yaml up -d --build
node tools/emulator-lab/verify-lab.mjs
```

The full smoke verifies that Octane serves a mounted `.nitro` file and has
its standalone login screen disabled. A pinned Playwright run created a
disposable emulator account through the lab API, obtained its SSO ticket,
entered Octane through `?sso=`, created a room, and captured a rendered floor,
walls, and avatar. No Octane login or registration form appeared. This first
check proves the isolated emulator/client ticket path. The optional CMS overlay
below verifies a Drogon-issued ticket too. Website registration remains
decision-gated by the plan.

## Launch from the Drogon CMS

The optional `compose.cms.yaml` overlay adds Drogon, Redis, the React bundle,
and the normal nginx proxy to the **same disposable lab project and database**.
It sets `OCTANE_CLIENT_URL=http://127.0.0.1:3201/`, so the CMS `/client` page
offers a browser-native launch after an existing user signs in. This setting
accepts loopback origins only. The CMS proxy is <http://127.0.0.1:3204/>.
Use a distinct Compose project name and verify its containers and volumes
before starting; never attach the primary website database to this emulator.

```powershell
$env:NITRO_FILES_DIR = (Resolve-Path '../upstream/Nitro-Files-lab-v1').Path
docker compose -p ci-emulator-sso -f tools/emulator-lab/compose.yaml -f tools/emulator-lab/compose.assets.yaml -f tools/emulator-lab/compose.cms.yaml up -d --build
docker compose -p ci-emulator-sso -f tools/emulator-lab/compose.yaml -f tools/emulator-lab/compose.assets.yaml -f tools/emulator-lab/compose.cms.yaml ps
```

In the disposable database, Drogon's seeded existing user is `testuser` with
password `password123`. Browse to `http://127.0.0.1:3204/account`, sign in,
then open `/client`. That page requests a fresh ticket with a CSRF-protected
POST, passes it to Octane as `?sso=`, and keeps Octane's standalone login and
registration disabled. The pinned Playwright `cms-octane.spec.ts` verifies the
whole path through room rendering, as well as signed-out refusal.

The ticket appears in the Octane URL and browser history. The pinned emulator
consumes it at game login, then restores it during its disconnect grace period
and leaves it in `users.auth_ticket` after the full disconnect, and its game
lookup does not enforce `auth_ticket_expires_at`. The website therefore bounds
the ticket itself: a ticket it issues is voided `SSO_TICKET_TTL_SECONDS` after
issue (30 in this overlay, 120 by default), and the void writes a value longer
than the 128 characters PolarIS accepts as a presented ticket — an empty column
would be exactly what the emulator's restore writes the dead ticket back into.
Signing out voids it immediately. **This bridge is for loopback development
only** until the launch can use a reviewed HTTPS origin. No game assets are
redistributed by this Compose overlay.

## Check the replay bound

`sso-replay.spec.ts` walks the five paths in order — login, reconnect inside the
window, full disconnect, sign-out, and a ticket past its window — and asserts the
last three twice over: against the emulator's SSO endpoint and against the client
itself, because those are two different doors in PolarIS.

```powershell
$repo = (Resolve-Path .).Path
$out = Join-Path (Resolve-Path ../upstream).Path 'emulator-lab-replay-out'
docker run --rm --network host --mount "type=bind,source=$repo,target=/repo,readonly" --mount "type=bind,source=$out,target=/out" -e BASE_NEW=http://127.0.0.1:3204 -e CMS_BASE=http://127.0.0.1:3204 -e OCTANE_BASE=http://127.0.0.1:3201 -e PLAYWRIGHT_SSO_REPLAY=1 -e SSO_TICKET_TTL_SECONDS=90 -e PLAYWRIGHT_ARGS=sso-replay.spec.ts -e PLAYWRIGHT_CONFIG=playwright.emulator.config.ts mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh
```

`SSO_TICKET_TTL_SECONDS` must match the value the CMS was started with, because
the suite waits out the window it is given. It also has to exceed a client
launch: the reconnect case disposes the first connection and waits for a second
one to boot and present the same ticket, so the suite refuses a window under 60
seconds instead of reporting a flake. The emulator's own view of each path is in
its log:

```powershell
docker logs ci-emulator-sso-20260926-emulator-1 --since 10m | Select-String "SessionResume|logged in|disconnected"
```

The browser command below uses the disposable database. Its registration
endpoint limits each IP to five accounts, so use a fresh isolated lab volume
for a repeat run instead of treating an HTTP 429 as a product failure. Do not
delete or reset the primary hotel or legacy data.

```powershell
$repo = (Resolve-Path .).Path
$out = Join-Path (Resolve-Path ../upstream).Path 'emulator-lab-sso-out'
docker run --rm --network host --mount "type=bind,source=$repo,target=/repo,readonly" --mount "type=bind,source=$out,target=/out" -e BASE_NEW=http://127.0.0.1:3201 -e PLAYWRIGHT_ARGS=emulator-lab.spec.ts -e PLAYWRIGHT_CONFIG=playwright.emulator.config.ts mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh
```

With the CMS overlay running, change `PLAYWRIGHT_ARGS` to
`cms-octane.spec.ts` to test CMS sign-in, `/client`, and room rendering. Keep
the report directory outside Git; the ticket-bearing URL must not be copied
into a public report.

One optional camera effect image, `shadow_multiply_02.png`, is missing from
the local asset pack. Room rendering passed, but camera visuals remain a gap.

To stop the lab while preserving its isolated database:

```powershell
docker compose -p hotel-emulator-lab -f tools/emulator-lab/compose.yaml -f tools/emulator-lab/compose.assets.yaml stop
```

For the CMS overlay, use the same project name it was started with and include
`compose.cms.yaml` in the stop command. Stopping preserves the disposable
volumes; never use this lab command on the primary hotel or legacy project.
