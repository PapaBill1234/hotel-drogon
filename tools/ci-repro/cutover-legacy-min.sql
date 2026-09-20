-- Minimal schema for the cutover harness's legacy database.
--
-- ── Why not CleanDB.sql ──────────────────────────────────────────────────────
--
-- tools/legacy-stack mounts the full reviewed schema (~5.5 MB, ~55k lines from
-- CleanDB.sql plus migrations 001-009) because the parity suite screenshots whole
-- legacy pages and needs every table they touch. The cutover harness needs one
-- endpoint: `/articles/rss.xml`.
--
-- Measured: the full import made `ci-cutover-legacy-db-1` fail to initialise on a
-- GitHub runner ("dependency failed to start: container ... exited (1)"), while
-- the same stack comes up locally where the import has more headroom. Rather
-- than tune MariaDB startup for a job that does not need the schema, this file
-- creates exactly what the endpoint reads.
--
-- ── What the endpoint actually reads ─────────────────────────────────────────
--
--   xml/rss.php  -> SELECT id, title, summary, time FROM phpretro_news ORDER BY time DESC LIMIT 10
--   includes/core.php -> the `phpretro_site_settings` rows (SHORTNAME, PATH, ...)
--
-- The column definitions mirror the reviewed `migrations/001_custom_tables.sql`;
-- they are not invented. Any table the demo does not read is deliberately absent,
-- and the fixtures for both tables are applied afterwards from
-- tools/legacy-stack/init/99-seed.sql — the same file the new app gets.

CREATE TABLE IF NOT EXISTS phpretro_news (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  summary TEXT NOT NULL,
  story TEXT NOT NULL,
  author VARCHAR(100) NOT NULL,
  categories VARCHAR(255) NOT NULL DEFAULT '',
  images TEXT NOT NULL,
  time INT NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_time (time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS phpretro_site_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_by INT NULL,
  updated_at INT NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
