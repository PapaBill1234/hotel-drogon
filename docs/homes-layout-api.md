# MyHabbo Homes layout API (Phase 8)

Status: **the backend half and the React page/editor are implemented and verified
against a live stack.** Widget *contents*, ratings, the guestbook, notes,
stickers, the store and group homes are the remaining slices of the phase. This
document is the "present the request/response and conflict schema" artifact the
plan asks for before implementation; it describes what is built, not what is
planned.

## The React side

`/home/{userId}` renders the page (`home.php`); `/home/{userId}/edit` is the
editor, and the legacy `myhabbo/startSession/{userId}` URL routes to it as well.
Both use the legacy element ids and classes (`#mypage-wrapper.cbb.blue`,
`#mypage-content`, `#top-toolbar`, `#mypage-bg`, `#playground`,
`.movable.widget.<Class>`), so the legacy stylesheets paint them.

* The geometry is **used, not re-derived**: the API returns `left`/`top`/`z_index`
  and the canvas writes them as the box's inline style. `homes.spec.ts` asserts
  the rendered style equals the API's value for every box, which is what would
  fail if the canvas ever grew its own copy of `widgetStyle()`.
* A drag turns pixels into a slot with `saveWidgetCoords()`'s rule
  (`placementForPixels`), and a drop onto an occupied slot **swaps** the two
  boxes, so the request is always a valid permutation and the server never has to
  refuse a move the user made on screen.
* A move is applied optimistically and a `409` rolls it back to the `current`
  payload the conflict body carries — no second request, so the rollback cannot
  race the writer it is reacting to.
* Cancel releases the lease (and so does leaving the route), because a lock held
  by a tab the user has left is a lock nobody can take.

`@dnd-kit/core` is **not** used: it was installed and its `DndContext` blanked the
editor with `TypeError: e.reduce is not a function` in this bundle, so the drag is
native pointer events. That substitution, the exact error and the versions are
recorded in `docs/ai-run-state.md` as an open item rather than hidden here.

Two defects found while building this are also recorded there: Prototype's
`toJSON` patch (loaded from the legacy assets) made `JSON.stringify` serialize any
array as a string, which broke the layout save until `main.tsx` removed the
prototype methods; and `useParams()` returned a route's parameter descriptor
instead of its value, which this page sidesteps by reading the id from the path.


Every rule below was read out of the read-only PHPRetro checkout at
`../legacy/phpretro-pdo`, not invented:

| Legacy source | What it decides |
| --- | --- |
| `home.php` | the page: which profile, which columns, what renders on the playground |
| `includes/PhpretroHomes.php` | the model: layout rows, widget allow-lists, save/move/delete, ratings, guestbook, store |
| `habblet/myhabbo_layout_save.php` | the save endpoint the editor posts to |
| `habblet/myhabbo_widget_add.php`, `myhabbo_widget_delete.php` | adding and removing a widget box |
| `migrations/001_custom_tables.sql`, `004_web_homes.sql`, `007_restore_remaining_501s.sql` | the tables |

## The placement model

A widget is a row in `phpretro_myhabbo_layouts`: `column_number` (1 or 2) and an
integer `position` within that column. Legacy's editor dragged pixels and the
model derived the slot; both directions are ported:

* `saveWidgetCoords()` — `column = x >= 450 ? 2 : 1`, `position = max(0, floor(y / 50))`
* `widgetStyle()` — `left = column == 2 ? 450 : 25`, `top = position * 50 + 10`,
  `z-index = max(1, position + 1)`

The API stores the slot and returns the pixels, computed in one place
(`HomesService`), so a second definition cannot drift from the stylesheets.

## Endpoints

| Method | Path | Auth | CSRF |
| --- | --- | --- | --- |
| GET | `/api/homes/{userId}/layout` | anyone (guests too) | n/a |
| POST | `/api/homes/{userId}/edit-session` | signed-in owner | required |
| DELETE | `/api/homes/{userId}/edit-session` | signed-in owner | required |
| PUT | `/api/homes/{userId}/layout` | signed-in owner **and** live lock | required |
| POST | `/api/homes/{userId}/widgets` | signed-in owner | required |
| DELETE | `/api/homes/{userId}/widgets/{widgetId}` | signed-in owner | required |

## `GET /api/homes/{userId}/layout`

`200`:

```json
{
  "status": "ok",
  "home": {
    "user_id": 2,
    "username": "testuser",
    "version": 3,
    "updated_at": 1790492707,
    "background": "b_bg_pattern_abstract2",
    "default_layout": false,
    "editable": true,
    "lock": { "held": true, "holder_user_id": 2, "expires_at": 0, "is_mine": true }
  },
  "widgets": [
    { "id": 1, "widget_key": "profilewidget", "column": 1, "position": 0,
      "left": 25, "top": 10, "z_index": 1, "visible": true, "privacy": "public" }
  ],
  "items": [
    { "id": 9, "type": "background", "skin": "", "data": "",
      "x": 0, "y": 0, "z": 0, "catalogue_data": "bg_wood" }
  ]
}
```

* `default_layout: true` is `displayLayouts()`: a home with **no stored rows**
  renders one profile widget anyway. Its widget carries `"id": 0` because there is
  no row behind it, and the write routes refuse to move it rather than reporting
  success and changing nothing (which is what legacy's `continue` did).
* `background` is `backgroundClass()`: the `b_` + catalogue-data class of the
  placed background, or `b_bg_pattern_abstract2` when there is none — the legacy
  fallback for a user home.
* `editable` is true only for the home's own signed-in owner.
* `home.lock` never carries a `token` for anyone but the holder. A different
  reader sees `held`, `holder_user_id` and `is_mine: false`.

`400` invalid profile id · `404` unknown profile · `503` database unavailable.

## `POST /api/homes/{userId}/edit-session`

Opens (or refreshes) the Redis edit lock. `200`:

```json
{ "status": "ok", "token": "…32 hex…", "holder_user_id": 2, "ttl_seconds": 300 }
```

The lock is `SET homes_edit_lock:{userId} "<holderId>:<token>" NX EX 300`. A
re-open by the same holder refreshes the TTL **without** rewriting the value, so
the token the holder already has stays valid. Refusals:

* `403` — the caller is not this home's owner (legacy never had a per-home ACL:
  only the owner was ever shown the edit control).
* `423 Locked` — the home is held by somebody else, with the holder in the body.

## `PUT /api/homes/{userId}/layout`

```json
{
  "version": 3,
  "lock_token": "…32 hex…",
  "widgets": [ { "id": 1, "column": 2, "position": 3 } ],
  "background_item_id": 9
}
```

`version` and `lock_token` are required. `widgets` may be empty, may omit
widgets (an omitted widget keeps its slot — legacy's save moved only what it was
sent), and `background_item_id` is optional.

`200`: the full `GET` payload above, at the **new** version.

Refusals, and why each status is what it is:

| Status | When | Client action |
| --- | --- | --- |
| `400` | a widget id is not on this page, `id: 0` (the synthesised default), a duplicate id, a column outside 1–2, a position above 127, two widgets on one slot, no `version`, malformed JSON | fix the request |
| `401` | no session | sign in |
| `403` | signed in as somebody else | — |
| `409` | `version` is stale | roll the optimistic update back to `current` |
| `423` | no live lock for this caller (expired, released, or somebody else's) | re-open an edit session |
| `503` | database or cache unavailable | retry |

`409` carries the server's state so a rollback needs no second request:

```json
{ "error": "Conflict", "message": "This page changed while you were editing it.",
  "status": 409, "current_version": 5, "current": { …the GET payload… } }
```

### How the conflict is actually enforced

Two mechanisms, deliberately independent:

1. **The edit lock** stops two people *starting* an edit. It is checked before
   the transaction and is not trusted for correctness.
2. **The version compare-and-swap** makes a lost update impossible. The first
   statement inside the transaction is
   `UPDATE phpretro_myhabbo_homes SET version = version + 1, updated_at = ?
   WHERE user_id = ? AND guild_id = 0 AND version = ?`. It takes the row lock, so
   a second writer blocks there and then finds `affectedRows() == 0` — the whole
   transaction rolls back and the caller gets `409`. Measured:
   `scripts/smoke_phase8_homes.sh` section 7 fires two saves with one version and
   requires exactly one `200` and one `409`; the loser's placement must not be in
   the stored layout and it is not audited.

### Why positions are mirrored before they are written

`phpretro_myhabbo_layouts` has `UNIQUE (user_id, guild_id, column_number,
position)`, so swapping two widgets' slots would collide if the rows were written
one at a time. Inside the transaction every row of the home is first moved to
`-(position + 1)`, which is injective and cannot collide with a final position
(always `>= 0`); the requested placements are then written; then the rows the
request did not mention are un-mirrored. The union of final slots is validated in
C++ before any write, so a collision is a `400` rather than a database error.

### Schema

Website-owned (`phpretro_*`), created by `HomesService::ensureSchema`:

* `phpretro_myhabbo_layouts` — `001` + `004`'s `synced_at` + `007`'s `privacy`,
  `guild_id` and guild-aware unique index, column for column.
* `phpretro_myhabbo_guestbook`, `phpretro_home_ratings`, `phpretro_homes_catalogue`
  (with the legacy seed rows), `phpretro_homes_items` — `001`/`007` verbatim.
* **`phpretro_myhabbo_homes` — new, and the only schema addition:**
  `(user_id, guild_id) PRIMARY KEY, version INT NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL DEFAULT 0`. The version is per **home**, not per
  widget: a per-row version could not answer "did this page change" for a home
  whose rows are reordered, and a home with no rows at all still needs one, which
  `displayLayouts()` shows is a real state. Plan rule 1 protects PolarIS tables;
  this one is the website's own.

The order inside `src/main.cpp` matters and is commented there: these tables
declare foreign keys onto `users` and `phpretro_homes_catalogue`, so they are
sequenced *after* the core statements that create `users`. Fired alongside them
they fail with MariaDB errno 150 and `CREATE TABLE IF NOT EXISTS` leaves the
table permanently missing — a failure mode this unit actually hit.

## `POST /api/homes/{userId}/widgets` · `DELETE …/widgets/{widgetId}`

`POST` body `{"widget_key": "guestbook", "column": 2}`. `key()` resolves legacy's
alias table, so `guestbook` is stored as `guestbookwidget`. `201` returns the
created widget in the same shape as the layout's `widgets[]` entries.

* `400` unknown widget, group widget on a user home, column outside 1–2
* `503` the blocked Trax player (`BLOCKED_WIDGETS`, legacy's 501: emulator-bound,
  plan milestone 6)
* `409` already placed — `add()`'s own rule, one of each widget key per home

`DELETE` refuses `profilewidget` with `403` (`delete()`'s locked widget: a page
keeps its profile box). `404` unknown id; `400` id `0`.

## What is deliberately not here yet

* **Group homes** (`guild_id != 0`). `canEditGroup`'s rule — the group's owner or
  a level-1 member — is read and recorded but not ported, because the group half
  of Phase 8 comes after user homes pass their tests.
* **Ratings and the guestbook.** `rate()` (1–5, one vote per rater, no
  self-vote), `ratingSummary()`'s `average`/`px` derivation, the guestbook's
  1–1000 character bound and its `private` = friends-only / group-members-only
  rule are all read; none is routed.
* **Notes, stickers and the store.** `placeNote`, `placeSticker`, `purchase()`
  and its credit write (`homes_store` in `phpretro_transactions`, which nothing
  in this stack writes yet) are Phase 8's remaining slices. The store's
  "leave the hotel first" refusal in particular rests on an emulator behaviour
  claim already recorded in the legacy source and is not yet verified here.
* **Templates/widget rendering.** `includes/habblet-templates/home-widget.php`
  renders each widget's content. The layout API places boxes; the content of each
  box is a separate unit.

## Verification

| Check | Result |
| --- | --- |
| `tests/unit/HomesServiceTest.cpp` (`[homes]`) | **93 assertions in 9 cases** — the pixel mapping both ways, the alias table, the allow-lists, the placement validator, the status mapping |
| Catch2 (whole suite, ASan/UBSan, `-Werror`) | **303 assertions in 18 cases** |
| `scripts/smoke_phase8_homes.sh` | **70/70** on a disposable `ci-homes-20260927` stack, including the two-concurrent-saves case (`A=200 B=409`) |
| `scripts/check_homes_edit_lock.sh` | **14/14** — a foreign lock seeded into Redis refuses the owner's session and save with `423` and leaves the version alone |
| `scripts/check_csrf_rules.py` | 64 routes, 36 mutating, all protected |
| `scripts/check_polaris_access.py` | zero direct PolarIS access outside `src/services/` |
| audit rows | `homes_widget_added`, `homes_layout_saved`, `homes_widget_deleted` written for each committed mutation, and **not** for the losing concurrent save |
