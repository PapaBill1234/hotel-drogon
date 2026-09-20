-- Shared content fixtures for visual-parity capture.
--
-- Applied to BOTH databases: the legacy stack (legacy-stack/init) and the new
-- Drogon app (see tools/legacy-stack/README.md). Both sides must render
-- IDENTICAL data or a screenshot diff compares content, not markup.
--
-- Fixed ids and timestamps so the two sides cannot drift.

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

DELETE FROM phpretro_faq;
INSERT INTO phpretro_faq (id, category, question, answer, sort_order, active) VALUES
  (1, 'general', 'How do I create an account?', 'Click Register on the front page and follow the steps.', 1, 1),
  (2, 'general', 'I forgot my password', 'Use the forgot password link on the sign-in box.', 2, 1),
  (3, 'credits', 'How do I earn credits?', 'Credits are awarded for taking part in hotel events.', 1, 1);

DELETE FROM phpretro_collectibles;
INSERT INTO phpretro_collectibles (id, name, description, image, time) VALUES
  (1, 'Around The World', 'A limited edition collectable from a previous month.',
      '/web-gallery/v2/images/collectibles/ukplane.png', 1696118400);

-- Settings both sides read. UPSERT so the legacy defaults from migration 002
-- are overwritten rather than duplicated.
INSERT INTO phpretro_site_settings (setting_key, setting_value, updated_by, updated_at) VALUES
  ('site_name',          'PHPRetro',       NULL, UNIX_TIMESTAMP()),
  ('site_shortname',     'Retro',          NULL, UNIX_TIMESTAMP()),
  ('site_path',          'http://localhost:8081', NULL, UNIX_TIMESTAMP()),
  ('site_language',      'en',             NULL, UNIX_TIMESTAMP()),
  ('site_closed',        '0',              NULL, UNIX_TIMESTAMP()),
  ('maintenance_mode',   '0',              NULL, UNIX_TIMESTAMP()),
  ('maintenance_style',  '0',              NULL, UNIX_TIMESTAMP()),
  ('maintenance_twitter','',               NULL, UNIX_TIMESTAMP()),
  ('site_capcha',        '0',              NULL, UNIX_TIMESTAMP()),
  -- includes/session.php forces $page['allow_guests'] = false unless this is
  -- "1", and then bounces guests to "/" with a 302. Without it, every page that
  -- requires session.php (community, articles, collectables) is unreachable
  -- anonymously -- which is exactly the set we need to screenshot.
  ('site_allow_guests',  '1',              NULL, UNIX_TIMESTAMP()),
  ('site_session_time',  '30',             NULL, UNIX_TIMESTAMP()),
  ('site_promo_phrases', 'Welcome to the hotel|Hey there!|Come on in!', NULL, UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = UNIX_TIMESTAMP();
