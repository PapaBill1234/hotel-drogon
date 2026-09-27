#include <catch2/catch_test_macros.hpp>

#include <string>
#include <vector>

#include "services/HomesService.h"

using namespace hotel::services;

/**
 * The MyHabbo placement model, checked against the legacy code it was read from.
 *
 * Every expectation here is a line of `includes/PhpretroHomes.php` in the
 * read-only PHPRetro checkout:
 *
 *   - `saveWidgetCoords()`: `$column = $coords['x'] >= 450 ? 2 : 1;`
 *     `$position = max(0, (int) floor($coords['y'] / 50));`
 *   - `widgetStyle()`: `left` 25 or 450, `top = position * 50 + 10`,
 *     `z-index = max(1, position + 1)`
 *   - `key()` and the `ALIASES` table
 *   - `USER_WIDGETS` / `BLOCKED_WIDGETS` / `delete()`'s locked widget
 *   - `itemCss('background', …)` → `'b_' . $data`, and `backgroundClass()`'s
 *     `'b_bg_pattern_abstract2'` fallback for a user home
 *
 * The database-backed half of the service is exercised by
 * `scripts/smoke_phase8_homes.sh` against a live stack; these cases are the ones
 * that need no database and can therefore run in the CI sanitizer job.
 */
TEST_CASE("A dragged x maps to a column exactly as legacy mapped it", "[homes]") {
    // 449 is the last pixel of column 1 and 450 the first of column 2 — the
    // boundary is legacy's, not a rounded-off approximation of it.
    REQUIRE(HomesService::columnForX(0) == 1U);
    REQUIRE(HomesService::columnForX(25) == 1U);
    REQUIRE(HomesService::columnForX(449) == 1U);
    REQUIRE(HomesService::columnForX(450) == 2U);
    REQUIRE(HomesService::columnForX(1000) == 2U);
}

TEST_CASE("A dragged y maps to a slot exactly as legacy mapped it", "[homes]") {
    // floor(y / 50), floored at zero. PHP's floor() rounds toward negative
    // infinity where C++ integer division truncates toward zero, so the negative
    // case is the one worth pinning: -60 must be 0, not -1.
    REQUIRE(HomesService::positionForY(0) == 0U);
    REQUIRE(HomesService::positionForY(9) == 0U);
    REQUIRE(HomesService::positionForY(10) == 0U);
    REQUIRE(HomesService::positionForY(49) == 0U);
    REQUIRE(HomesService::positionForY(50) == 1U);
    REQUIRE(HomesService::positionForY(99) == 1U);
    REQUIRE(HomesService::positionForY(-60) == 0U);
    REQUIRE(HomesService::positionForY(-1) == 0U);
}

TEST_CASE("Stored placements render back to legacy's pixel geometry", "[homes]") {
    REQUIRE(HomesService::leftForColumn(1) == 25);
    REQUIRE(HomesService::leftForColumn(2) == 450);
    // Any other column value is column 1 in legacy (`$column === 2 ? 2 : 1`).
    REQUIRE(HomesService::leftForColumn(0) == 25);
    REQUIRE(HomesService::leftForColumn(3) == 25);

    REQUIRE(HomesService::topForPosition(0) == 10);
    REQUIRE(HomesService::topForPosition(1) == 60);
    REQUIRE(HomesService::topForPosition(7) == 360);

    REQUIRE(HomesService::zIndexForPosition(0) == 1U);
    REQUIRE(HomesService::zIndexForPosition(4) == 5U);
}

TEST_CASE("The round trip between pixels and slots is the identity", "[homes]") {
    // `myhabbo_layout_save.php` received coordinates and `widgetStyle()` produced
    // them. If these two ever disagree, a saved layout moves every time it is
    // loaded, which is a defect no single-sided test would show.
    for (uint32_t column : {1U, 2U}) {
        for (uint32_t position : {0U, 1U, 2U, 5U, 127U}) {
            const int32_t left = HomesService::leftForColumn(column);
            const int32_t top = HomesService::topForPosition(position);
            REQUIRE(HomesService::columnForX(left) == column);
            REQUIRE(HomesService::positionForY(top) == position);
        }
    }
}

TEST_CASE("Widget keys resolve through legacy's alias table", "[homes]") {
    REQUIRE(HomesService::normalizeWidgetKey("profile") == "profilewidget");
    REQUIRE(HomesService::normalizeWidgetKey("  GuestBook ") == "guestbookwidget");
    REQUIRE(HomesService::normalizeWidgetKey("HIGHSCORES") == "highscoreswidget");
    REQUIRE(HomesService::normalizeWidgetKey("badges") == "badgeswidget");
    REQUIRE(HomesService::normalizeWidgetKey("friends") == "friendswidget");
    REQUIRE(HomesService::normalizeWidgetKey("groups") == "groupswidget");
    REQUIRE(HomesService::normalizeWidgetKey("rooms") == "roomswidget");
    REQUIRE(HomesService::normalizeWidgetKey("rating") == "ratingwidget");
    REQUIRE(HomesService::normalizeWidgetKey("member") == "memberwidget");
    REQUIRE(HomesService::normalizeWidgetKey("members") == "memberwidget");
    REQUIRE(HomesService::normalizeWidgetKey("profilewidget") == "profilewidget");
    REQUIRE(HomesService::normalizeWidgetKey("") == "");
    REQUIRE(HomesService::normalizeWidgetKey("   ") == "");
}

TEST_CASE("The widget allow-list and the blocked widget are legacy's", "[homes]") {
    for (const char* key : {"profilewidget", "guestbookwidget", "highscoreswidget", "badgeswidget",
                            "friendswidget", "groupswidget", "roomswidget", "ratingwidget"}) {
        REQUIRE(HomesService::isUserWidget(key));
    }
    // Group widgets are a real key but not a user-home widget, so `add()` would
    // answer "Unknown widget." for them on a user page — which is what legacy did.
    REQUIRE_FALSE(HomesService::isUserWidget("groupinfowidget"));
    REQUIRE_FALSE(HomesService::isUserWidget("memberwidget"));
    REQUIRE_FALSE(HomesService::isUserWidget("notawidget"));

    // `BLOCKED_WIDGETS`: the Trax player is emulator-bound and refused with 501.
    REQUIRE(HomesService::isBlockedWidget("traxplayerwidget"));
    REQUIRE_FALSE(HomesService::isBlockedWidget("profilewidget"));

    // `delete()` will not remove the page's own profile widget.
    REQUIRE(HomesService::requiredWidgetKey() == "profilewidget");
}

TEST_CASE("The page background class is legacy's itemCss", "[homes]") {
    REQUIRE(HomesService::backgroundClass("bg_wood") == "b_bg_wood");
    // `backgroundClass()`'s fallback when nothing is placed.
    REQUIRE(HomesService::defaultBackgroundClass() == "b_bg_pattern_abstract2");
}

/**
 * `home-widget.php`'s online flag.
 *
 *   $online = $owner['hide_online'] === '1' ? false : $owner['online'] === '1';
 *
 * The `'2'` case is the interesting one: PolarIS's column is `enum('0','1','2')`
 * and this test asserts the sprite is the OFFLINE one for it, because that is
 * what the PHP rendered. Which value the emulator writes when is emulator
 * behaviour this repository does not own, so the port keeps the legacy test
 * rather than guessing that `'2'` means something else.
 */
TEST_CASE("The profile box's online sprite follows the legacy predicate", "[homes]") {
    SECTION("online only for exactly '1'") {
        REQUIRE(HomesService::onlineForDisplay("1", "0"));
        REQUIRE_FALSE(HomesService::onlineForDisplay("0", "0"));
        REQUIRE_FALSE(HomesService::onlineForDisplay("2", "0"));
        REQUIRE_FALSE(HomesService::onlineForDisplay("", "0"));
    }

    SECTION("hiding wins over the online flag") {
        REQUIRE_FALSE(HomesService::onlineForDisplay("1", "1"));
        REQUIRE_FALSE(HomesService::onlineForDisplay("2", "1"));
    }
}

/**
 * `array_values(array_filter(explode(';', (string) $owner['tags'])))`.
 *
 * The separators are the whole behaviour: an empty part contributes nothing, so
 * a trailing or doubled `;` produces no empty tag link — which is what the
 * legacy page rendered, because `array_filter` drops `''`.
 */
TEST_CASE("Tags split the way the legacy template split them", "[homes]") {
    SECTION("a plain list") {
        const auto tags = HomesService::splitTags("retro;habbo;friends");
        REQUIRE(tags.size() == 3);
        REQUIRE(tags[0] == "retro");
        REQUIRE(tags[1] == "habbo");
        REQUIRE(tags[2] == "friends");
    }

    SECTION("empty parts are dropped, not kept as blank tags") {
        const auto tags = HomesService::splitTags("retro;;friends;");
        REQUIRE(tags.size() == 2);
        REQUIRE(tags[0] == "retro");
        REQUIRE(tags[1] == "friends");
    }

    SECTION("an empty or absent column yields no tags") {
        REQUIRE(HomesService::splitTags("").empty());
        REQUIRE(HomesService::splitTags(";").empty());
        REQUIRE(HomesService::splitTags(";;;").empty());
    }

    SECTION("spaces inside a tag are kept — legacy trimmed nothing") {
        const auto tags = HomesService::splitTags("two words; other");
        REQUIRE(tags.size() == 2);
        REQUIRE(tags[0] == "two words");
        REQUIRE(tags[1] == " other");
    }
}

namespace {

HomeWidgetRecord widget(uint32_t id, uint32_t column, uint32_t position) {
    HomeWidgetRecord record;
    record.id = id;
    record.widget_key = "profilewidget";
    record.column_number = column;
    record.position = position;
    return record;
}

HomePlacement placement(uint32_t id, uint32_t column, uint32_t position) {
    HomePlacement requested;
    requested.widget_id = id;
    requested.column_number = column;
    requested.position = position;
    return requested;
}

} // namespace

TEST_CASE("A placement list is validated against the rows the home has", "[homes]") {
    const std::vector<HomeWidgetRecord> existing = {
        widget(11, 1, 0), widget(12, 1, 1), widget(13, 2, 0),
    };
    std::string message;

    SECTION("a legal swap is accepted") {
        const std::vector<HomePlacement> requested = {placement(11, 1, 1), placement(12, 1, 0)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) == HomeError::None);
    }

    SECTION("a move across columns is accepted") {
        const std::vector<HomePlacement> requested = {placement(11, 2, 1)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) == HomeError::None);
    }

    SECTION("an empty list is accepted — legacy's save moved only what it was sent") {
        REQUIRE(HomesService::validatePlacements({}, existing, message) == HomeError::None);
    }

    SECTION("a widget that is not on this page is refused, not skipped") {
        // Legacy `continue`d here: the write reported success and changed nothing.
        // That silent no-op is what this refusal replaces.
        const std::vector<HomePlacement> requested = {placement(99, 1, 0)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::NotPermitted);
        REQUIRE_FALSE(message.empty());
    }

    SECTION("the synthesised default widget cannot be placed") {
        // `displayLayouts()` invents a profile widget with no row behind it.
        const std::vector<HomePlacement> requested = {placement(0, 1, 0)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::InvalidInput);
    }

    SECTION("one widget cannot be placed twice in one request") {
        const std::vector<HomePlacement> requested = {placement(11, 1, 0), placement(11, 2, 0)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::InvalidInput);
    }

    SECTION("two widgets cannot share a slot") {
        const std::vector<HomePlacement> requested = {placement(11, 2, 0)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::InvalidInput);
        REQUIRE(message.find("slot") != std::string::npos);
    }

    SECTION("an untouched widget's slot counts in the collision check") {
        // Widget 12 stays at (1, 1), so moving 11 onto it must be refused even
        // though the request itself is internally consistent.
        const std::vector<HomePlacement> requested = {placement(11, 1, 1)};
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::InvalidInput);
    }

    SECTION("a column outside 1 and 2 is refused") {
        REQUIRE(HomesService::validatePlacements({placement(11, 3, 0)}, existing, message) ==
                HomeError::InvalidInput);
        REQUIRE(HomesService::validatePlacements({placement(11, 0, 0)}, existing, message) ==
                HomeError::InvalidInput);
    }

    SECTION("a position outside the page is refused") {
        // Legacy had no upper bound, because only its own canvas ever sent a
        // value. A JSON API cannot assume that.
        REQUIRE(HomesService::validatePlacements(
                    {placement(11, 1, HomesService::kMaxPosition)}, existing, message) ==
                HomeError::None);
        REQUIRE(HomesService::validatePlacements(
                    {placement(11, 1, HomesService::kMaxPosition + 1)}, existing, message) ==
                HomeError::InvalidInput);
    }

    SECTION("an oversized request is refused") {
        std::vector<HomePlacement> requested;
        for (std::size_t i = 0; i <= HomesService::kMaxPlacements; ++i) {
            requested.push_back(placement(11, 1, 0));
        }
        REQUIRE(HomesService::validatePlacements(requested, existing, message) ==
                HomeError::InvalidInput);
    }
}

TEST_CASE("Each outcome maps to the status the API documents", "[homes]") {
    REQUIRE(homeErrorStatus(HomeError::InvalidInput) == 400);
    REQUIRE(homeErrorStatus(HomeError::NotPermitted) == 403);
    REQUIRE(homeErrorStatus(HomeError::NotFound) == 404);
    // 409 for "somebody edited this" and 423 for "somebody is editing this right
    // now": the React editor's rollback branches on the difference.
    REQUIRE(homeErrorStatus(HomeError::VersionConflict) == 409);
    REQUIRE(homeErrorStatus(HomeError::Locked) == 423);
    REQUIRE(homeErrorStatus(HomeError::Unavailable) == 503);
    REQUIRE(homeErrorStatus(HomeError::None) == 200);
}
