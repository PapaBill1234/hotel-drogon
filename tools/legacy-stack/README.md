# Legacy PHPRetro stack (baseline capture only)

Runs the legacy PHP app in Docker so the visual-parity harness has something to
capture references from. **Not part of the production stack** — deliberately
separate from `compose.yaml` and from the new app's database, so it can never
clobber live data.

## Why this exists

The Phase 4 exit condition requires each converted page to pass screenshot
comparison against the legacy page. That needs a running legacy app. The one
used previously was XAMPP at `C:\xampp\htdocs\PHPRetro-PDO`, which is not part
of this repo and was not running. This stack reproduces it in Docker.

## Usage

```sh
docker compose -f tools/legacy-stack/compose.yaml up -d --build

# The first boot imports CleanDB.sql (~5.5MB / 55k lines) plus migrations
# 001-009, so allow ~30-60s before the app is usable.
curl -I http://localhost:8081/
```

Then capture baselines:

```sh
cd tests/e2e
BASE_LEGACY=http://localhost:8081 npm run capture
BASE_NEW=http://localhost:3000 npm run test:visual
```

Tear down (the schema import is preserved in a named volume):

```sh
docker compose -f tools/legacy-stack/compose.yaml down       # keep data
docker compose -f tools/legacy-stack/compose.yaml down -v    # wipe, forces re-import
```

## How it is wired

- `web.Dockerfile` — `php:8.2-apache` with `pdo_mysql`, `mod_rewrite` and
  `AllowOverride All` (the legacy app routes pretty URLs through `.htaccess`).
- `legacy.env` — mounted as `/var/www/html/.env`. `includes/core.php` redirects
  to `/install/` when that file is missing, so it must exist even though the
  credentials actually arrive through the container environment
  (`DB_DSN`/`DB_USER`/`DB_PASS`, read by `includes/Database.php`).
- `init/99-seed.sql` — shared fixtures. Applied to **both** databases; both apps
  must render identical content or a screenshot diff compares data rather than
  markup. Fixed ids and timestamps so the two sides cannot drift.
- `legacy/phpretro-pdo` is mounted read-only in spirit (never modified by this
  stack); the `.env` is mounted over rather than written into the tree.

## Traps encountered bringing this up

1. **`site_allow_guests` must be `"1"`.** `includes/session.php` forces
   `$page['allow_guests'] = false` when it is unset, then 302s guests to `/`.
   That silently breaks exactly the pages that `require` `session.php`
   (community, articles, collectables) — while landing and help, which do not,
   keep working. Easy to misread as a rewrite problem.
2. **The app caches settings on disk** (`cache/*.cache`). Changing a setting in
   the database has no effect until the cache is cleared:
   `docker exec legacy_web sh -c 'rm -f /var/www/html/cache/*.cache'`
3. **`site_path` drives asset URLs**, not just links. If it is wrong, every
   image 404s and every diff fails for the wrong reason. It is set to
   `http://localhost:8081` to match the published port.
4. **`maintenance.php` redirects to `/` when `site_closed = "0"`.** Maintenance
   therefore has to be captured in its own pass with `site_closed = "1"`, then
   restored — with `site_closed = "1"` every *other* page redirects to
   `/maintenance`, so the two passes cannot be combined.
