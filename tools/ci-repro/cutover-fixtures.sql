-- Fixtures for the cutover harness's two databases.
--
-- Deliberately a subset of tools/legacy-stack/init/99-seed.sql: that shared file
-- also populates phpretro_faq and phpretro_collectibles, which the harness's
-- minimal legacy schema does not create (see cutover-legacy-min.sql). The VALUES
-- here are copied verbatim from the shared file, so the two sides still differ
-- only in WHICH implementation answers, never in content.
--
-- Applied to BOTH databases by the CI job and by the local reproduction in
-- tools/ci-repro/README.md, so `/articles/rss.xml` is non-empty on both sides and
-- the marker that identifies the answering implementation is present either way.

DELETE FROM phpretro_news;
INSERT INTO phpretro_news (id, title, summary, story, author, categories, images, time) VALUES
  (1, 'Server maintenance complete',
      'The hotel is back online after scheduled maintenance.',
      'We upgraded the database and everything is running smoothly again.',
      'george', 'announcements', '', 1700000000),
  (2, 'New furniture line released',
      'A fresh range of furniture is now available in the catalogue.',
      'Head to the catalogue to browse the new items while stocks last.',
      'george', 'news,releases', '', 1699000000);

-- The legacy endpoint renders SHORTNAME and PATH from these rows.
INSERT INTO phpretro_site_settings (setting_key, setting_value, updated_by, updated_at) VALUES
  ('site_name',          'PHPRetro',       NULL, UNIX_TIMESTAMP()),
  ('site_shortname',     'Retro',          NULL, UNIX_TIMESTAMP()),
  ('site_path',          'http://localhost:3500', NULL, UNIX_TIMESTAMP()),
  ('site_language',      'en',             NULL, UNIX_TIMESTAMP()),
  ('site_closed',        '0',              NULL, UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = UNIX_TIMESTAMP();
