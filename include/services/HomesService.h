#pragma once

#include <drogon/orm/DbClient.h>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace hotel::services {

/**
 * MyHabbo Homes — the `phpretro_myhabbo_*` family and the placement model behind
 * a user's page.
 *
 * ## Legacy entry points read before this was written
 *
 *   - `home.php` — the page itself. Resolves a profile by `?id=` or `?name=`,
 *     splits `displayLayouts()` into columns 1 and 2, renders `placedItems()` on
 *     the playground, and takes the page background from `backgroundClass()`.
 *   - `includes/PhpretroHomes.php` — the whole model: `layouts()`,
 *     `displayLayouts()`, `add()`, `delete()`, `place()`, `saveLayout()`,
 *     `placedItems()`, `backgroundClass()`, `widgetStyle()`, and the widget
 *     allow-lists `USER_WIDGETS` / `GROUP_WIDGETS` / `BLOCKED_WIDGETS`.
 *   - `habblet/myhabbo_layout_save.php`, `myhabbo_widget_add.php`,
 *     `myhabbo_widget_delete.php`, `myhabbo_widget_edit.php` — the endpoints the
 *     edit-mode page posts to.
 *   - `templates/myhabbo_footer.php`, `includes/habblet-templates/home-widget.php`
 *     — the client side: which element ids the editor's JavaScript drags, and
 *     what a widget's box looks like.
 *   - `migrations/001_custom_tables.sql`, `004_web_homes.sql`,
 *     `007_restore_remaining_501s.sql` — the tables, column for column.
 *
 * ## What is ported, and what is deliberately not
 *
 * The **placement model** is ported exactly: a widget lives in column 1 or 2 at
 * an integer position, and legacy's own arithmetic converts between those and
 * the pixels the editor dragged:
 *
 *   - `saveLayout()` → `column = x >= 450 ? 2 : 1`, `position = floor(y / 50)`
 *   - `widgetStyle()` → `left = column == 2 ? 450 : 25`, `top = position * 50 + 10`,
 *     `z-index = position + 1`
 *
 * Both directions live here, in one class, so they cannot drift apart.
 *
 * The **transport** does not. Legacy posted a flat coordinate string
 * (`widgets=12:25,10,1/13:450,60,2`) through a habblet page and re-rendered HTML
 * fragments. This is a JSON API with a per-home **version** and an **edit lock**;
 * see `docs/homes-layout-api.md`. The widget allow-lists, the guestbook privacy
 * rule, the rating rule and the store's credit write are the same rules.
 *
 * ## Ownership
 *
 * `phpretro_*` tables belong to the website (plan rule 1). The PolarIS reads this
 * class needs — the profile's `username`, and the owner check against `users` —
 * stay behind named methods here rather than in a controller, because
 * `scripts/check_polaris_access.py` fails the build for raw PolarIS SQL outside
 * `src/services/`.
 */
struct HomeWidgetRecord {
    uint32_t id = 0;
    std::string widget_key;
    uint32_t column_number = 1;
    uint32_t position = 0;
    bool visible = true;
    std::string privacy = "public";
};

struct HomeItemRecord {
    uint32_t id = 0;
    std::string item_type;   // sticker | stickie | background
    std::string skin;
    std::string data;
    int32_t x = 0;
    int32_t y = 0;
    int32_t z = 0;
    std::string catalogue_data;
};

/**
 * The owner block `home-widget.php`'s profile box renders.
 *
 * Exactly the columns legacy's `PhpretroHomes::profile()` selected, so the page
 * cannot show a field the legacy page did not:
 *
 *   SELECT u.id, u.username, u.motto, u.look, u.account_created, u.last_online,
 *          u.online, COALESCE(s.hide_online,'0') AS hide_online,
 *          COALESCE(s.tags,'') AS tags, COALESCE(s.guild_id,0) AS guild_id
 *   FROM users u LEFT JOIN users_settings s ON s.user_id = u.id WHERE u.id = ?
 *
 * `online` is PolarIS's `enum('0','1','2')` and is passed through as the string
 * it is: the legacy page tested `=== '1'` and so treats `'2'` as offline. That
 * looks like a legacy quirk, but which value the emulator writes when is
 * emulator behaviour this repository does not own, so the test is ported rather
 * than "corrected" — see `onlineForDisplay`.
 */
struct HomeOwner {
    uint32_t id = 0;
    std::string username;
    std::string motto;
    std::string look;
    uint64_t account_created = 0;
    uint64_t last_online = 0;
    std::string online = "0";
    std::string hide_online = "0";
    /** `users_settings.tags`, `;`-separated — legacy `explode(';', $tags)`. */
    std::string tags;
    uint32_t guild_id = 0;
    /**
     * False when the `users_settings` side of the join could not be read at all.
     *
     * The box then says so where it would otherwise render "No tags." — a
     * missing table and a user with no tags look identical on screen, and only
     * one of them is true.
     */
    bool settings_available = true;
};

/** One badge as the badges box renders it. */
struct HomeBadgeRecord {
    std::string badge_code;
};

/** One group as the groups box renders it — `groups()`'s own row shape. */
struct HomeGroupRecord {
    uint32_t id = 0;
    std::string name;
    std::string badge;
    uint32_t level_id = 0;
};

/** One room as the rooms box renders it — `rooms()`'s own row shape. */
struct HomeRoomRecord {
    uint32_t id = 0;
    std::string name;
    std::string description;
};

/**
 * What one widget box renders inside itself.
 *
 * `available` is false when the box's own data could not be read — most often
 * because this development stack has no such PolarIS table. The box then renders
 * `unavailable_reason` instead of an empty list, because an empty list and a
 * failed read look identical on screen and only one of them is honest.
 */
struct HomeWidgetData {
    bool available = true;
    std::string unavailable_reason;
    std::vector<HomeBadgeRecord> badges;
    std::vector<HomeGroupRecord> groups;
    std::vector<HomeRoomRecord> rooms;
    /**
     * `friendCount()` — the number in the friends box's heading. The list itself
     * is Phase 6, so the box renders the count and says what is missing.
     */
    uint32_t friend_count = 0;
    bool friend_count_known = false;
};

/** One placed widget together with the data its box renders. */
struct HomeWidgetWithData {
    HomeWidgetRecord widget;
    HomeWidgetData data;
};

/** Everything one page load of a home needs, plus the concurrency token. */
struct HomeLayout {
    uint32_t user_id = 0;
    std::string username;
    /**
     * The home's optimistic-concurrency token.
     *
     * 1 before anything has been saved, and **not** 0: legacy's
     * `displayLayouts()` returns a default profile widget for a home with no
     * rows, so "nothing saved yet" is a real, renderable state and its version
     * has to be a value a client can echo back.
     */
    uint32_t version = 1;
    uint64_t updated_at = 0;
    std::string background_class;
    std::vector<HomeWidgetRecord> widgets;
    std::vector<HomeItemRecord> items;
    /** The owner block, from legacy's `profile()`. Absent only on a failed read. */
    HomeOwner owner;
    /** Per-widget content, keyed by widget id (0 for the synthesised default). */
    std::vector<HomeWidgetWithData> widget_data;
    /**
     * True when the widget list is legacy's synthesised default rather than
     * stored rows. `widgets` then holds exactly one entry with `id == 0`, which
     * `saveLayout` refuses to place — the same answer legacy gives when asked to
     * move a widget that was never added.
     */
    bool default_layout = false;
};

/** One requested placement in a layout write. */
struct HomePlacement {
    uint32_t widget_id = 0;
    uint32_t column_number = 1;
    uint32_t position = 0;
};

/** The outcome kinds both the service and the controller branch on. */
enum class HomeError {
    None = 0,
    InvalidInput,
    NotFound,
    NotPermitted,
    VersionConflict,
    Locked,
    Unavailable,
};

/**
 * The HTTP status each outcome maps to.
 *
 * 409 is the version conflict and 423 the held edit lock: a client can tell
 * "somebody else edited this" from "somebody else is editing this right now"
 * without parsing a message, which is what the React editor's rollback needs.
 */
int homeErrorStatus(HomeError error);

struct HomeSaveResult {
    HomeError error = HomeError::None;
    std::string message;
    uint32_t version = 0;
};

/** A home's edit session, as Redis holds it. */
struct HomeEditLock {
    bool held = false;
    uint32_t holder_user_id = 0;
    uint64_t expires_at = 0;
    /**
     * The lock secret. Returned only to the caller that acquired (or already
     * holds) the lock, and required by `saveLayout`; it is never echoed to a
     * different user, so holding the lock cannot be claimed from outside.
     */
    std::string token;
};

class HomesService {
public:
    /**
     * `saveLayout`'s position bound.
     *
     * Legacy took `max(0, floor(y / 50))` with no upper bound, which is fine for
     * a canvas that only ever sends back what it was given. A JSON API cannot
     * assume that: an unbounded position is an unbounded `top:` in the rendered
     * style, so the value is bounded here and a larger one is a 400 rather than a
     * layout nobody can reach.
     */
    static constexpr uint32_t kMaxPosition = 127;

    /** How long an edit session survives without being refreshed. */
    static constexpr uint32_t kEditLockTtlSeconds = 300;

    /** A layout write may move at most this many widgets in one request. */
    static constexpr std::size_t kMaxPlacements = 64;

    /** Create the MyHabbo tables if they are absent. Mirrors migrations 001/004/007. */
    static void ensureSchema(
        const drogon::orm::DbClientPtr& db,
        std::function<void()> onComplete
    );

    // ---------------------------------------------------------------- pure ---
    // These carry the legacy arithmetic and the legacy allow-lists. They are
    // static and database-free on purpose: `tests/unit/HomesServiceTest.cpp`
    // checks them directly, which is the only way the pixel mapping is verified
    // without a browser.

    /** `saveLayout()`: `x >= 450 ? 2 : 1`. */
    static uint32_t columnForX(int32_t x);

    /** `saveLayout()`: `max(0, floor(y / 50))`. */
    static uint32_t positionForY(int32_t y);

    /** `widgetStyle()`: column 2 starts at 450px, column 1 at 25px. */
    static int32_t leftForColumn(uint32_t column_number);

    /** `widgetStyle()`: `position * 50 + 10`. */
    static int32_t topForPosition(uint32_t position);

    /** `widgetStyle()`: `max(1, position + 1)`. */
    static uint32_t zIndexForPosition(uint32_t position);

    /** Legacy's `key()`: trims, lowercases, and resolves its alias table. */
    static std::string normalizeWidgetKey(const std::string& key);

    /** `PhpretroHomes::USER_WIDGETS`. */
    static bool isUserWidget(const std::string& key);

    /** `PhpretroHomes::BLOCKED_WIDGETS` — refused with 501 by legacy. */
    static bool isBlockedWidget(const std::string& key);

    /**
     * A widget that must always be placeable, so it cannot be deleted:
     * `profilewidget` for a user home (legacy `delete()` refuses exactly this).
     */
    static std::string requiredWidgetKey();

    /** `itemCss('background', <catalogue data>)` — the page's `#mypage-bg` class. */
    static std::string backgroundClass(const std::string& catalogue_data);

    /** `backgroundClass()`'s fallback for a user home with no background placed. */
    static std::string defaultBackgroundClass();

    /**
     * Whether the profile box renders the animated "online" sprite.
     *
     * `home-widget.php`: `$online = $owner['hide_online'] === '1' ? false :
     * $owner['online'] === '1';` — note `=== '1'`, so a row holding `'2'` renders
     * as offline. That is ported as written; what the emulator writes when is
     * emulator behaviour and is not verified here, so "fixing" it would be
     * guessing at a capability.
     */
    static bool onlineForDisplay(const std::string& online, const std::string& hide_online);

    /** `array_values(array_filter(explode(';', $tags)))` — empty parts dropped. */
    static std::vector<std::string> splitTags(const std::string& tags);

    /**
     * Validate one requested placement list against the rows the home actually
     * has, and report the first problem.
     *
     * Legacy's `saveWidgetCoords()` silently `continue`d past an id that was not
     * the caller's — a write that reports success while changing nothing, which
     * is the failure mode the plan forbids. Here the same case is a refusal, and
     * the collision check replaces a unique-index violation (a 500) with a 400.
     *
     * @param existing the home's current rows, `id` → (column, position)
     */
    static HomeError validatePlacements(
        const std::vector<HomePlacement>& requested,
        const std::vector<HomeWidgetRecord>& existing,
        std::string& message
    );

    // ----------------------------------------------------------- database ---

    /** Resolve `home.php`'s `?name=` lookup to a user id. */
    static void findUserIdByName(
        const std::string& username,
        std::function<void(std::optional<uint32_t>)> callback
    );

    /**
     * The owner block — legacy `PhpretroHomes::profile()`'s own query.
     *
     * `found` is false when the user row is gone. A missing `users_settings` row
     * is not a failure (`LEFT JOIN`, `COALESCE`), and neither is a missing
     * `users_settings` *table*: on a stack with no PolarIS emulator behind it the
     * join cannot run at all, so the read falls back to the `users` columns and
     * reports the settings fields as their defaults. That is a recorded
     * divergence, not a silent one — see the implementation.
     */
    static void loadOwnerProfile(
        uint32_t userId,
        std::function<void(bool found, const HomeOwner&)> callback
    );

    /**
     * Load what each placed widget box renders, in the order the widgets were
     * given.
     *
     * One query per box, and each box's failure is its own: a development stack
     * without `users_badges` must not blank the whole page, but it must not
     * pretend the box is empty either, so the box carries `available = false`
     * and the reason. Widgets that render no data (profile, high scores) need no
     * query at all.
     */
    static void loadWidgetData(
        const HomeOwner& owner,
        const std::vector<HomeWidgetRecord>& widgets,
        std::function<void(std::vector<HomeWidgetWithData>)> callback
    );

    /**
     * Read one user home: the profile name, its version, its widget columns and
     * its placed stickers/notes/background.
     *
     * A home with no stored rows reports legacy's synthesised default layout
     * (`default_layout = true`) rather than an empty page, because that is what
     * `home.php` renders in the same state.
     */
    static void loadLayout(
        uint32_t userId,
        std::function<void(HomeError, const std::string&, HomeLayout)> callback
    );

    /**
     * Write widget placements, and optionally the page background.
     *
     * Optimistic concurrency: `expectedVersion` must be the version the caller
     * read. The compare-and-swap is the first statement in the transaction, so a
     * second writer blocks on the version row and then finds its expectation
     * stale — the loser is told (409), never silently overwritten.
     *
     * `lockToken` must match the live edit lock for this home. The lock is what
     * stops two people editing at once; the version is what makes a lost update
     * impossible even if the lock is bypassed or has expired.
     */
    static void saveLayout(
        uint32_t userId,
        uint32_t actorId,
        uint32_t expectedVersion,
        const std::vector<HomePlacement>& placements,
        std::optional<uint32_t> backgroundItemId,
        const std::string& lockToken,
        const std::string& actorIp,
        std::function<void(HomeSaveResult)> callback
    );

    /** Add one widget to a column — legacy `add()`, including its 409. */
    static void addWidget(
        uint32_t userId,
        uint32_t actorId,
        const std::string& widgetKey,
        uint32_t columnNumber,
        const std::string& actorIp,
        std::function<void(HomeError, const std::string&, HomeWidgetRecord)> callback
    );

    /** Remove one widget — legacy `delete()`, including its locked widget. */
    static void removeWidget(
        uint32_t userId,
        uint32_t actorId,
        uint32_t widgetId,
        const std::string& actorIp,
        std::function<void(HomeError, const std::string&)> callback
    );

    // --------------------------------------------------------------- locks ---

    /**
     * Open (or refresh) an edit session for this home.
     *
     * Redis `SET NX EX`, with the value `<holder_id>:<token>`. The lock is
     * **not** what makes a lost update impossible — the version CAS is — so a
     * refresh by the same holder does not rewrite the value (that would
     * invalidate the token the holder is already carrying).
     */
    static void acquireEditLock(
        uint32_t userId,
        uint32_t actorId,
        std::function<void(HomeError, const std::string&, HomeEditLock)> callback
    );

    /** Close an edit session. Only the holder's own token releases it. */
    static void releaseEditLock(
        uint32_t userId,
        uint32_t actorId,
        const std::string& token,
        std::function<void(HomeError, const std::string&)> callback
    );

    /** Read the current lock without changing it — used by GET and by saves. */
    static void editLockState(
        uint32_t userId,
        std::function<void(HomeEditLock)> callback
    );

    /** Whether a presented token is the live lock for this home. */
    static void verifyEditLock(
        uint32_t userId,
        uint32_t actorId,
        const std::string& token,
        std::function<void(bool)> callback
    );
};

} // namespace hotel::services
