# Modular CMS contracts and evidence (plan v4, unit 1)

Status: **in progress.** This file is the artifact plan v4's unit 1 asks for —
"a reviewed route/action map, ownership map, capability matrix and API contracts".
The typed draft was reviewed against the plan and current services, and the
capability matrix was checked against upstream source. **The route/action map
still lacks a per-entry port-status join**, so the unit is not complete. No
route or table changes in this review.

Plan v4 keeps the parity phases as the target and adds this track at a verified
work-unit boundary. Nothing in this document alters an existing route, writes to
an emulator database, or infers a capability from a name.

## 1. Route and action map

Generated, not hand-written: `scripts/legacy_surface_inventory.mjs` reads the
read-only PHPRetro checkout and emits [the full map](legacy-surface-inventory.md)
— every entry point with the permission idiom it declares and the tables its own
source writes.

| Area | Entry points | Write to a table | Read in this document as |
| --- | --- | --- | --- |
| Top level (`*.php`) | 34 | 5 | one page each; the other 29 delegate their writes to `includes/` classes, which is why the column is small |
| `habblet/` | 136 | 6 | AJAX actions behind `.htaccess` rewrites |
| `housekeeping/` | 28 | 17 | staff pages, each declaring `$page['rank']` and requiring `includes/hksession.php` |
| `xml/` | 3 | 0 | feeds |
| `.htaccess` | 27 rewrite rules | — | the URL shapes the legacy site actually served |

Three things the map makes explicit that the parity inventory states only in
prose:

* **The permission idiom is uniform and extractable.** A housekeeping page is
  gated by `$page['rank'] = <expr>` immediately before
  `require_once('./includes/hksession.php')`; the expression is often conditional
  (`alerts.php` is `$type === 'mass' ? 7 : 6`). A port that gates on a single
  rank constant per page would be wrong for those.
* **Writes are concentrated, and the three writers that matter for ownership are
  visible by name**: `register.php` (`users`, `users_settings`,
  `phpretro_email_verification_tokens`), `profile.php`/`forgot.php` (`users`),
  `clientutils.php` (`phpretro_client_errors`), and in the habblets the MyHabbo
  `myhabbo_*` actions over `phpretro_myhabbo_*`/`phpretro_homes_*`.
* **The housekeeping surface is 28 pages, not 30.** The earlier audit counted 30
  legacy staff pages by probing URLs; the checkout holds 28 `.php` files. The two
  extra probes were routes into the same file with different parameters
  (`housekeeping/index.php` with a section, and the 2FA step). The parity
  inventory's "20 housekeeping pages have no React counterpart" is therefore
  measured against file count plus parameters, and the map is the authority for
  which file owns what.

Review correction: the extractor originally labelled pages that both included
`session.php` and set `$page['allow_guests'] = true` as `signed-in`. The explicit
guest flag takes precedence. Comparing the old and regenerated maps found
11 corrected top-level rows, including `home.php` and `community.php`; the
other entries are unchanged. `history.php` remains `signed-in`. The generated
file is now UTF-8 (the prior PowerShell redirect had encoded it as UTF-16LE).

## 2. Ownership map

| Data family | Owner | Evidence | Rule for this stack |
| --- | --- | --- | --- |
| `users`, `users_settings`, `users_badges`, `guilds`, `guilds_members`, `rooms`, `messenger_friendships`, `catalog_pages`, `catalog_items`, `items`, `bans` | PolarIS (pinned emulator) | `legacy/phpretro-pdo/references/schema/CleanDB.sql`; the pinned emulator's own migrations | never altered; read and written only through named service methods (plan rules 1, 3) |
| `phpretro_*` (content, reports, help desk, homes, myhabbo, ledger, audit, SSO tickets, staff sessions) | This website | `migrations/001…009` in the read-only checkout | the website's own schema; same named-method discipline for consistency |
| `hotel_*` — Pixel63's own tables | Pixel63, if that profile is installed | `muff1n-pixel/Hotel`, `packages/server/schema/hotel_*.sql` (read-only sparse checkout) | **a separate database.** Nothing is shared with PolarIS by table name |

The Pixel63 schemas are named `hotel_<table>.sql` but the dumps declare the
tables **unqualified** — `CREATE TABLE \`users\``, `\`user_tokens\``,
`\`shop_pages\``. Two profiles in one database would therefore collide on
`users`, which is the concrete reason plan v4 says a profile is chosen per
installation and a migration between profiles is a separate project.

## 3. Capability matrix (one profile per installation)

Read from the pinned PolarIS schema in the legacy checkout and from a read-only
sparse checkout of `muff1n-pixel/Hotel` at `8a43772882c1c4b2dd8c9c986ab7a1e0075b92e6`
on 2026-09-27. A cell that says *not
verified here* is exactly that: this document does not infer a write path.

| Capability | PolarIS / Octane (working profile) | Pixel63 (candidate profile) |
| --- | --- | --- |
| Identity key | `users.id` `int(11)` auto-increment (`CleanDB.sql`) | `users.id` `char(36)` UUID (`hotel_users.sql`) |
| Website-facing credential | `users.auth_ticket` `varchar(256)`, matched at game login without consulting an expiry; the website bounds it itself (see the SSO bound in the run state) | Its own web package signs a JWT `{userId}` with the `user_tokens.secretKey`, valid for one year, after password login; game WebSocket verifies it. No supported Drogon-issued handoff contract is verified. |
| Password column | `password varchar(64)`, legacy scheme `sha1(password . strtolower(username))` with bcrypt upgrade path | `password varchar(256)`; its own web package uses `bcrypt.compare` for login and `bcrypt.hash(..., 10)` for registration |
| Currencies | `credits`, `pixels`, `points` on `users` | `credits`, `diamonds`, `duckets` on `users` |
| Figure | `look varchar(256)` | `figureConfiguration text` |
| Catalog model | `catalog_pages` / `catalog_items` (emulator-owned) | `shop_pages` (UUID, `parentId` tree) + `shop_page_furnitures`, `shop_page_bots`, `shop_page_pets`, `shop_page_bundles`, `shop_page_features` |
| Furniture catalog capability (outside CMS scope) | none recorded in the pinned server | an in-client editor exists (`Shop/Development/UpdateShopPageEvent`, guarded by a permission); **the permission string and the write semantics are not verified here** |
| Permissions | `users.rank` integer, plus the website's own staff session | `permissions`, `permission_roles`, `role_permissions`, `user_roles` — a role/permission model |
| Friends / furniture / badges | `messenger_friendships`, `items`, `users_badges` | `user_friends`, `user_furnitures`, `user_badges` (different names *and* shapes) |
| Website content it ships | none (PHPRetro owns the website) | `web_articles`, `web_article_comments`, `web_article_likes` — its own web schema |
| Client / assets | Octane + local-only Nitro assets (lab-verified) | game client reads the `accessToken` cookie and sends it on the WebSocket; README requires separately sourced SWF assets converted to spritesheets/manifest, so a permitted deployable asset source is **not verified here** |

Conclusion this matrix supports, and no more: **the two profiles have different
identity, credential, currency, catalog and permission models, and the website
cannot treat one as a skin of the other.** Whether Pixel63 can be driven from
this website at all is a question for its own contracts and a live instance, not
for this table. The game WebSocket also has a `useAccessTokens=false` branch
that accepts a `userId` query parameter; this is not an acceptable CMS
handoff. Pixel63's own web API has account endpoints, but their integration
with Drogon's session, CSRF and audit model is not established. All Pixel63
CMS login, account mutation and client launch actions remain unsupported.

## 4. Typed contracts (proposed, not wired)

The shapes live in `frontend/src/types/cms.ts` — types only, imported by nothing
yet, so this unit changes no route and no render. They exist so unit 2 can be
implemented against a contract instead of inventing shapes as it goes.

| Contract | What it describes | Server-side validation it implies |
| --- | --- | --- |
| `NavigationItem` | one operator-editable link: keyed label, typed target, visibility, order | target must be a **known route** or an `https:` URL; ordering by integer; visibility by role |
| `PageSlot` + `TypedBlock` | a page's ordered blocks with typed props | block type from a closed registry; props validated per type; **no raw JavaScript, no unvalidated HTML** |
| `TranslationCatalog` | keyed copy per locale with a published revision | placeholder validation, missing-key fallback, no markup |
| `ThemeDescriptor` | which public theme is published, at which revision | a closed set of theme ids; publish/rollback is a revision change, never a code deploy |
| `CmsRevision` | the draft → published → rolled-back lifecycle every one of the above shares | optimistic concurrency on publish, audit on every transition |

The draft contract review found and corrected three mismatches: `newsList`
had exposed physical table names despite the rule below, so it now selects
semantic `articles` or `community` sources for named service methods;
`richText` claimed rich content while translations are plain text, so it is
now `paragraph`; and `homePromo.userId` assumed a numeric PolarIS identity,
so that block is removed until a profile-neutral, verified contract exists.
These are type-shape corrections only. Server validation of route allowlists,
external URLs, block props, placeholders, roles and revisions is required in
unit 2 and is not implemented by TypeScript declarations.

Two rules the contracts encode because the plan names them: the **website theme
cannot change the game database or the client** (theme ids are website-owned and
Map to no emulator state), and **no contract carries a table name** — a block
references content by id through a service method, so a block type can never
become a generic table write.

## 5. What unit 1 still owes

* **Pixel63 integration remains unsupported.** Its own JWT, web account
  endpoints and client token transport are now source-verified, but no
  Drogon-issued handoff, shared-session design or permitted SWF asset source
  is established. Its in-client shop editor is outside CMS scope.
* **The route map's port status is not joined in.** The generated map says what
  legacy has; which of those are ported is tracked in
  `docs/phase1-parity-inventory.md`. Unit 1 still needs to join the two into
  one reviewed table rather than duplicating status in two files.
