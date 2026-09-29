# Personal guestbook POST contract (Phase 8 review gate)

**Status: proposed for Sol review; not implemented.** This contract is limited to
one personal guestbook write. It does not add a route or service write method.
Group guestbooks, deletion, privacy configuration, BBCode/HTML rendering, layout
GET/PUT, purchases, Pixel63, and emulator writes remain outside this unit.

## Evidence boundary

The read-only PHPRetro-PDO checkout is the behavioral source of truth:

- `habblet/myhabbo_guestbook_add.php:18-25` requires a signed-in user, calls
  `Csrf::protectPost()`, reads `widgetId` and `message`, then calls
  `PhpretroHomes::addGuestbook()`.
- `PhpretroHomes.php:325-385` requires `guestbookwidget`, trims the message,
  accepts 1–1000 UTF-8 characters, permits public personal posts, and for a
  private personal widget calls `areFriends(owner, actor)` (self is allowed).
  A successful personal write inserts only
  `phpretro_myhabbo_guestbook(profile_user_id, author_user_id, message,
  created_at)` and emits `homes.guestbook_added`.
- `PhpretroHomes::widget()`/`requireOwner()` and the verified read boundary
  establish that a personal widget has `guild_id = 0`; group widgets are
  identified by `guild_id` and are not accepted by this contract. The route
  owner (`userId`) is a separate value from the posting actor: the widget
  lookup binds `user_id = userId`, never `user_id = actorId`, so a visitor may
  post to another owner's personal Home when the privacy boundary allows it.
- `PhpretroHomes::areFriends()` uses the directed prepared lookup
  `messenger_friendships(user_one_id = owner, user_two_id = actor)` and allows
  self-posts before querying.

The current `PersonalGuestbookWidgetService` and
`FriendshipPrivacyService` are read-only prerequisites. The future write path
must compose named methods without widening either boundary into a generic table
writer.

## Proposed endpoint

`POST /api/homes/{userId}/guestbook`

Authentication: a valid public user session is required. The route parameter is
the personal-home owner (`profile_user_id`), not the actor. The request body is
JSON:

```json
{"widget_id": 123, "message": "Hello"}
```

`widget_id` is the visible personal `guestbookwidget` belonging to `userId`
(`user_id = userId AND guild_id = 0`). The server must not trust a client-supplied
owner, privacy, author, timestamp, table, or event name.

## Responses

- **201 Created**: the inserted personal row, with server-assigned `id`,
  `profile_user_id`, `author_user_id`, `message`, and `created_at`; no HTML or
  BBCode rendering is performed.
- **400 Bad Request**: malformed body/IDs, wrong widget type, missing or
  trimmed-empty message, invalid UTF-8, or message longer than 1000 UTF-8
  characters. Validation is performed before any transaction or write.
- **401 Unauthorized**: no valid signed-in public session.
- **403 Forbidden**: missing/invalid CSRF token, a private widget where the actor
  is neither the owner nor a verified friend, or an attempt to use group/foreign
  ownership. CSRF rejection must happen before database mutation.
- **404 Not Found**: the requested owner or visible personal guestbook widget is
  absent. Do not reveal whether a foreign or group widget exists.
- **409 Conflict**: only if the approved implementation identifies a documented
  duplicate/idempotency conflict; the legacy handler has no duplicate rule, so
  this response must not be invented during implementation.
- **503 Service Unavailable**: the named widget/friendship read or website DB is
  unavailable before commit.
- **500 Internal Server Error**: transaction, insert, audit, or event-outbox
  failure after validation. The response must not claim success.

Error bodies should use the repository's existing JSON error shape and stable
messages; exact wording must be checked against the controller conventions before
implementation rather than guessed here.

## Authorization and write sequence

1. Authenticate the actor and enforce the route's CSRF filter for the mutating
   endpoint.
2. Validate `widget_id` and the trimmed UTF-8 `message` (1–1000 characters).
3. Resolve the requested owner and a visible personal guestbook widget through a
   named method with fixed predicates: `widget_key = 'guestbookwidget'`,
   `user_id = owner`, `guild_id = 0`. Never resolve or write a group widget.
4. Read widget privacy. For `public`, allow the authenticated actor. For
   `private`, allow only owner/self or the named friendship boundary's directed
   owner→actor friendship result. A friendship-read failure is a refusal, not an
   allow. The actor remains `author_user_id`; the route owner remains
   `profile_user_id`; neither may be substituted for the other in the widget
   predicate.
5. In one website-DB transaction, insert only into
   `phpretro_myhabbo_guestbook`, create the named website audit event, and create
   the `homes.guestbook_added` outbox/sync event if that event mechanism is
   approved for this service. Commit only after all required records succeed.
6. Return the inserted row only after commit. Roll back the guestbook row and
   audit/event records together on any failure; never decrement PolarIS data or
   touch group tables.

Audit must identify actor, owner/profile, widget, outcome and a correlation/request
identifier without storing the raw message unless the approved audit policy
explicitly permits it. The audit action name should be a stable website-owned
constant (for example `homes.guestbook_added`), not a client-provided value.

## Contract-gated verification before implementation

Add unit coverage for UTF-8 boundaries, trimming, invalid input, public/self/
friend/private refusal, group/foreign widget exclusion, and failure mapping. Add
an isolated MariaDB test with a uniquely named database/project and least-
privilege test grants covering insert, audit/event atomicity, rollback, and zero
writes on refusal. Add a CSRF/browser API check for missing and valid tokens.
Run the pinned Release `-Werror`/CTest, ASan/UBSan, static security checks, and
browser/API checks at the code-change boundary. Do not implement the POST until
Sol reviews this contract and the disposable DB check can run without touching
primary or legacy data.
