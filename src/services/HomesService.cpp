#include "services/HomesService.h"
#include "services/AuditService.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"

// The header deliberately includes only Drogon's ORM client so a unit test can
// include it without the whole framework; `drogon::app()` needs the umbrella.
#include <drogon/drogon.h>

#include <algorithm>
#include <cctype>
#include <ctime>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace hotel::services {

namespace {

constexpr const char* kDefaultBackgroundClass = "b_bg_pattern_abstract2";

/**
 * The Redis keyspace for an active edit session, one key per user home.
 *
 * Named after the resource, not the actor: two people editing the same home must
 * collide, and one person editing two homes must not.
 */
std::string editLockKey(uint32_t userId) {
    return "homes_edit_lock:" + std::to_string(userId);
}

/** `<holder id>:<token>`, so the holder can be reported without a second key. */
std::string lockValue(uint32_t holderId, const std::string& token) {
    return std::to_string(holderId) + ":" + token;
}

bool isUniqueViolation(const std::string& message) {
    return message.find("Duplicate entry") != std::string::npos;
}

/**
 * The transaction stepper.
 *
 * Drogon's `Transaction` commits when its last `shared_ptr` is destroyed and
 * never fires its commit callback after a rollback (see
 * `TransactionImpl::~TransactionImpl`), so the abort path reports its own result
 * and a `settled` guard in the caller makes a late callback a no-op.
 *
 * Steps are queued as closures so each statement keeps its own typed parameter
 * binding, and a step may queue more steps — the background lookup decides inside
 * the transaction whether there is anything to place.
 *
 * The object keeps ITSELF alive from `start()` to completion: the queued closures
 * hold a raw `this`, and the last of them runs on a database callback long after
 * the caller's `shared_ptr` has gone out of scope. That self-reference is broken
 * in `advance()`/`abort()`, which is also where the transaction reference is
 * dropped — the destructor is what queues the COMMIT, so releasing it too early
 * would commit an unfinished layout and releasing it never would leak a
 * connection.
 */
class TxnSteps : public std::enable_shared_from_this<TxnSteps> {
public:
    TxnSteps(
        std::shared_ptr<drogon::orm::Transaction> trans,
        std::function<void(HomeError, const std::string&)> onFail
    ) : trans_(std::move(trans)), onFail_(std::move(onFail)) {}

    TxnSteps(const TxnSteps&) = delete;
    TxnSteps& operator=(const TxnSteps&) = delete;

    /** Queue one statement. `onOk` runs on success, `failWith` on failure. */
    template <typename... Args>
    void add(
        const std::string& sql,
        HomeError failWith,
        std::function<void(const drogon::orm::Result&)> onOk,
        const Args&... args
    ) {
        steps_.push_back([this, sql, failWith, onOk, args...]() {
            auto binder = *trans_ << sql;
            ((binder << args), ...);
            binder >> onOk;
            binder >> [this, failWith](const drogon::orm::DrogonDbException& e) {
                abort(failWith, e.base().what());
            };
        });
    }

    void start() {
        self_ = shared_from_this();
        advance();
    }

    /** Run the next queued statement, or finish the transaction. */
    void advance() {
        if (done_) return;
        if (index_ >= steps_.size()) {
            // Success. Drop the reference to the transaction here: its destructor
            // is what queues the COMMIT, and the commit callback fires after it.
            done_ = true;
            steps_.clear();
            trans_.reset();
            releaseSelf();
            return;
        }
        auto step = steps_[index_++];
        step();
    }

    void abort(HomeError error, const std::string& message) {
        if (done_) return;
        done_ = true;
        // Roll back first, then report. `TransactionImpl::rollback` sets its
        // guard asynchronously, so the caller's `settled` flag — not the commit
        // callback — is what keeps a late commit from being read as success.
        if (trans_) trans_->rollback();
        steps_.clear();
        trans_.reset();
        releaseSelf();
        onFail_(error, message);
    }

private:
    /**
     * Break the self-reference, holding one reference for the rest of this call
     * so `this` cannot be destroyed underneath the statement that is running.
     */
    void releaseSelf() {
        auto keepAlive = self_;
        self_.reset();
        (void)keepAlive;
    }

    std::shared_ptr<drogon::orm::Transaction> trans_;
    std::function<void(HomeError, const std::string&)> onFail_;
    std::vector<std::function<void()>> steps_;
    std::size_t index_ = 0;
    bool done_ = false;
    /** Self-reference held only while the asynchronous chain is in flight. */
    std::shared_ptr<TxnSteps> self_;
};

} // namespace

int homeErrorStatus(HomeError error) {
    switch (error) {
        case HomeError::None:          return 200;
        case HomeError::InvalidInput:  return 400;
        case HomeError::NotFound:      return 404;
        case HomeError::NotPermitted:  return 403;
        case HomeError::VersionConflict: return 409;
        // 423 Locked: a client has to be able to tell "someone edited this" from
        // "someone is editing this right now" without reading the message.
        case HomeError::Locked:        return 423;
        case HomeError::Unavailable:   return 503;
    }
    return 400;
}

// ---------------------------------------------------------------------- pure

uint32_t HomesService::columnForX(int32_t x) {
    // `PhpretroHomes::saveWidgetCoords()`: `$column = $coords['x'] >= 450 ? 2 : 1;`
    return x >= 450 ? 2U : 1U;
}

uint32_t HomesService::positionForY(int32_t y) {
    // `$position = max(0, (int) floor($coords['y'] / 50));` — integer division of
    // a negative value truncates toward zero in C++, where PHP's floor() rounds
    // down, so negatives are normalised first rather than divided directly.
    if (y <= 0) return 0;
    return static_cast<uint32_t>(y / 50);
}

int32_t HomesService::leftForColumn(uint32_t column_number) {
    return column_number == 2 ? 450 : 25;
}

int32_t HomesService::topForPosition(uint32_t position) {
    return static_cast<int32_t>(position) * 50 + 10;
}

uint32_t HomesService::zIndexForPosition(uint32_t position) {
    return position + 1;
}

std::string HomesService::normalizeWidgetKey(const std::string& key) {
    // `PhpretroHomes::key()`: strtolower(trim($key)) then the ALIASES table.
    std::string lowered;
    lowered.reserve(key.size());
    for (char c : key) {
        lowered.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    const std::size_t begin = lowered.find_first_not_of(" \t\n\r\f\v");
    if (begin == std::string::npos) return "";
    const std::size_t end = lowered.find_last_not_of(" \t\n\r\f\v");
    lowered = lowered.substr(begin, end - begin + 1);

    static const std::map<std::string, std::string> kAliases = {
        {"profile", "profilewidget"},
        {"guestbook", "guestbookwidget"},
        {"highscores", "highscoreswidget"},
        {"badges", "badgeswidget"},
        {"friends", "friendswidget"},
        {"groups", "groupswidget"},
        {"rooms", "roomswidget"},
        {"traxplayer", "traxplayerwidget"},
        {"rating", "ratingwidget"},
        {"groupinfo", "groupinfowidget"},
        {"members", "memberwidget"},
        {"member", "memberwidget"},
    };
    const auto it = kAliases.find(lowered);
    return it == kAliases.end() ? lowered : it->second;
}

bool HomesService::isUserWidget(const std::string& key) {
    static const std::set<std::string> kUserWidgets = {
        "profilewidget", "guestbookwidget", "highscoreswidget", "badgeswidget",
        "friendswidget", "groupswidget", "roomswidget", "ratingwidget",
    };
    return kUserWidgets.count(key) > 0;
}

bool HomesService::isBlockedWidget(const std::string& key) {
    // `PhpretroHomes::BLOCKED_WIDGETS` — refused with 501 by legacy, because the
    // Trax player is emulator-bound (plan milestone 6).
    return key == "traxplayerwidget";
}

std::string HomesService::requiredWidgetKey() {
    // `PhpretroHomes::delete()`: a user home may not lose its `profilewidget`.
    return "profilewidget";
}

std::string HomesService::backgroundClass(const std::string& catalogue_data) {
    return "b_" + catalogue_data;
}

std::string HomesService::defaultBackgroundClass() {
    return kDefaultBackgroundClass;
}

HomeError HomesService::validatePlacements(
    const std::vector<HomePlacement>& requested,
    const std::vector<HomeWidgetRecord>& existing,
    std::string& message
) {
    if (requested.size() > kMaxPlacements) {
        message = "Too many widgets in one save.";
        return HomeError::InvalidInput;
    }

    std::map<uint32_t, std::pair<uint32_t, uint32_t>> current;
    for (const auto& widget : existing) {
        current[widget.id] = {widget.column_number, widget.position};
    }

    std::set<uint32_t> seen;
    std::map<uint32_t, std::pair<uint32_t, uint32_t>> finalSlots;
    for (const auto& placement : requested) {
        if (placement.widget_id == 0) {
            // Legacy's `displayLayouts()` synthesises an unsaved profile widget
            // for an empty home. It has no row to move, and legacy's own save
            // silently skipped it — a write that reports success and changes
            // nothing. Refusing is the honest answer.
            message = "This widget is not on the page yet.";
            return HomeError::InvalidInput;
        }
        if (!seen.insert(placement.widget_id).second) {
            message = "The same widget was placed twice.";
            return HomeError::InvalidInput;
        }
        if (current.find(placement.widget_id) == current.end()) {
            message = "That widget does not belong to this page.";
            return HomeError::NotPermitted;
        }
        if (placement.column_number != 1 && placement.column_number != 2) {
            message = "A widget must be in column 1 or 2.";
            return HomeError::InvalidInput;
        }
        if (placement.position > kMaxPosition) {
            message = "That position is outside the page.";
            return HomeError::InvalidInput;
        }
        finalSlots[placement.widget_id] = {placement.column_number, placement.position};
    }

    // Widgets the request did not mention keep their slot, so the union is what
    // has to be unique. Without this the unique index on
    // (user_id, guild_id, column_number, position) would reject the write as a
    // database error — a 500 for what is really bad input.
    for (const auto& widget : existing) {
        if (finalSlots.find(widget.id) == finalSlots.end()) {
            finalSlots[widget.id] = {widget.column_number, widget.position};
        }
    }
    std::set<std::pair<uint32_t, uint32_t>> occupied;
    for (const auto& entry : finalSlots) {
        if (!occupied.insert(entry.second).second) {
            message = "Two widgets cannot share the same slot.";
            return HomeError::InvalidInput;
        }
    }
    return HomeError::None;
}

// ------------------------------------------------------------------- schema

void HomesService::ensureSchema(
    const drogon::orm::DbClientPtr& db,
    std::function<void()> onComplete
) {
    if (!db) {
        HOTEL_LOG_WARN("HomesService::ensureSchema called without a DbClient");
        if (onComplete) onComplete();
        return;
    }

    // Column for column the shape the legacy migrations leave behind:
    // `001_custom_tables.sql` creates the layout and guestbook tables,
    // `004_web_homes.sql` adds the live-sync columns, `007_restore_remaining_501s.sql`
    // adds `privacy`/`guild_id`, replaces the unique index with the guild-aware
    // one, and creates the ratings, catalogue and items tables.
    //
    // One table here is NOT in the legacy schema: `phpretro_myhabbo_homes` holds
    // the per-home version the optimistic-concurrency write needs. It is
    // website-owned (`phpretro_*`), so plan rule 1 does not apply, and adding a
    // `version` column to every layout row instead would be a version per widget
    // rather than per page — and would have nowhere to live for a home with no
    // rows at all, which legacy's `displayLayouts()` shows is a real state.
    static const std::vector<std::string> kStatements = {
        "CREATE TABLE IF NOT EXISTS phpretro_myhabbo_homes ("
        "user_id INT NOT NULL,"
        "guild_id INT NOT NULL DEFAULT 0,"
        "version INT NOT NULL DEFAULT 1,"
        "updated_at BIGINT NOT NULL DEFAULT 0,"
        "PRIMARY KEY (user_id, guild_id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_myhabbo_layouts ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "user_id INT NOT NULL,"
        "column_number TINYINT NOT NULL,"
        "widget_key VARCHAR(50) NOT NULL,"
        "position INT NOT NULL DEFAULT 0,"
        "visible TINYINT(1) NOT NULL DEFAULT 1,"
        "privacy ENUM('public','private') NOT NULL DEFAULT 'public',"
        "guild_id INT NOT NULL DEFAULT 0,"
        "synced_at TIMESTAMP NULL DEFAULT NULL,"
        "PRIMARY KEY (id),"
        "UNIQUE INDEX idx_user_guild_column_position (user_id, guild_id, column_number, position),"
        "INDEX idx_user_id (user_id),"
        "INDEX idx_guild_id (guild_id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_myhabbo_guestbook ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "profile_user_id INT NOT NULL,"
        "author_user_id INT NOT NULL,"
        "message TEXT NOT NULL,"
        "created_at INT NOT NULL,"
        "synced_at TIMESTAMP NULL DEFAULT NULL,"
        "PRIMARY KEY (id),"
        "INDEX idx_profile_user_id (profile_user_id, created_at)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_home_ratings ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "profile_user_id INT NOT NULL,"
        "rater_id INT NOT NULL,"
        "rating TINYINT NOT NULL,"
        "created_at INT NOT NULL,"
        "synced_at TIMESTAMP NULL DEFAULT NULL,"
        "PRIMARY KEY (id),"
        "UNIQUE INDEX idx_profile_rater (profile_user_id, rater_id),"
        "INDEX idx_profile (profile_user_id),"
        "CONSTRAINT fk_phpretro_home_ratings_profile FOREIGN KEY (profile_user_id) "
        "REFERENCES users (id) ON DELETE CASCADE,"
        "CONSTRAINT fk_phpretro_home_ratings_rater FOREIGN KEY (rater_id) "
        "REFERENCES users (id) ON DELETE CASCADE"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_homes_catalogue ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "name VARCHAR(255) NOT NULL,"
        "description VARCHAR(255) NOT NULL DEFAULT '',"
        "type ENUM('sticker','widget','note','background') NOT NULL,"
        "data VARCHAR(255) NOT NULL,"
        "price INT NOT NULL DEFAULT 0,"
        "amount INT NOT NULL DEFAULT 1,"
        "category VARCHAR(255) NOT NULL DEFAULT 'Default',"
        "category_id INT NOT NULL DEFAULT 0,"
        "min_rank INT NOT NULL DEFAULT 1,"
        "placement ENUM('homes','groups','anywhere') NOT NULL DEFAULT 'anywhere',"
        "PRIMARY KEY (id),"
        "INDEX idx_type_category (type, category_id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_homes_items ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "user_id INT NOT NULL,"
        "guild_id INT NOT NULL DEFAULT 0,"
        "catalogue_id INT NOT NULL,"
        "item_type ENUM('sticker','stickie','background') NOT NULL,"
        "skin VARCHAR(64) NOT NULL DEFAULT '',"
        "data TEXT NOT NULL,"
        "x INT NOT NULL DEFAULT 0,"
        "y INT NOT NULL DEFAULT 0,"
        "z INT NOT NULL DEFAULT 0,"
        "placed TINYINT(1) NOT NULL DEFAULT 0,"
        "synced_at TIMESTAMP NULL DEFAULT NULL,"
        "PRIMARY KEY (id),"
        "INDEX idx_user_placed_type (user_id, placed, item_type),"
        "INDEX idx_guild_placed (guild_id, placed),"
        "CONSTRAINT fk_phpretro_homes_items_user FOREIGN KEY (user_id) "
        "REFERENCES users (id) ON DELETE CASCADE,"
        "CONSTRAINT fk_phpretro_homes_items_catalogue FOREIGN KEY (catalogue_id) "
        "REFERENCES phpretro_homes_catalogue (id) ON DELETE CASCADE"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        // The catalogue rows the legacy migration ships. `id` is explicit and the
        // insert is `IGNORE`, so re-running against a database that already has
        // the operator's own catalogue changes nothing.
        //
        // Widgets are priced 0 and are NOT purchasable (`purchase()` refuses
        // `type = 'widget'`); they exist here because `resolveWidgetKey()` accepts
        // a catalogue id as a widget key and checks this table's `type` and
        // `placement`.
        "INSERT IGNORE INTO phpretro_homes_catalogue "
        "(id, name, description, type, data, price, amount, category, category_id, min_rank, placement) VALUES "
        "(101, 'Profile Widget', 'Your profile.', 'widget', 'profilewidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(102, 'Guestbook Widget', 'Comments on your page.', 'widget', 'guestbookwidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(103, 'High Scores Widget', 'High scores.', 'widget', 'highscoreswidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(104, 'Badges Widget', 'Your badges.', 'widget', 'badgeswidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(105, 'Friends Widget', 'Your friends.', 'widget', 'friendswidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(106, 'Groups Widget', 'Your groups.', 'widget', 'groupswidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(107, 'Rooms Widget', 'Your rooms.', 'widget', 'roomswidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(109, 'Rating Widget', 'Allows others to vote on your page. You cannot vote for yourself.', 'widget', 'ratingwidget', 0, 1, 'Widgets', 100, 1, 'homes'),"
        "(110, 'Group Info Widget', 'Group information.', 'widget', 'groupinfowidget', 0, 1, 'Widgets', 100, 1, 'groups'),"
        "(111, 'Group Guestbook', 'Comments on the group page.', 'widget', 'guestbookwidget', 0, 1, 'Widgets', 100, 1, 'groups'),"
        "(112, 'Members Widget', 'Members of this group.', 'widget', 'memberwidget', 0, 1, 'Widgets', 100, 1, 'groups'),"
        "(114, 'Notes', '', 'note', 'stickienote', 2, 5, 'Notes', 101, 1, 'anywhere'),"
        "(116, 'Trax Sfx', '', 'sticker', 'trax_sfx', 1, 1, 'Trax', 102, 1, 'anywhere'),"
        "(117, 'Trax Rock', '', 'sticker', 'trax_rock', 1, 2, 'Trax 2', 103, 1, 'anywhere'),"
        "(118, 'Wood Background', '', 'background', 'bg_wood', 3, 1, 'Backgrounds', 104, 1, 'anywhere')",
    };

    auto step = std::make_shared<std::function<void(std::size_t)>>();
    *step = [db, step, onComplete](std::size_t index) {
        if (index < kStatements.size()) {
            *db << kStatements[index]
                >> [step, index](const drogon::orm::Result&) { (*step)(index + 1); }
                >> [step, index](const drogon::orm::DrogonDbException& e) {
                       HOTEL_LOG_WARN("HomesService::ensureSchema statement {}: {}",
                                      index, e.base().what());
                       (*step)(index + 1);
                   };
            return;
        }
        if (onComplete) onComplete();
    };
    (*step)(0);
}

// ------------------------------------------------------------------ reading

void HomesService::findUserIdByName(
    const std::string& username,
    std::function<void(std::optional<uint32_t>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }
    // `home.php`'s `?name=` branch.
    *db << "SELECT id FROM users WHERE username = ? LIMIT 1" << username
        >> [callback](const drogon::orm::Result& r) {
               if (r.empty()) {
                   callback(std::nullopt);
                   return;
               }
               callback(r[0]["id"].as<uint32_t>());
           }
        >> [callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("HomesService::findUserIdByName error: {}", e.base().what());
               callback(std::nullopt);
           };
}

void HomesService::loadLayout(
    uint32_t userId,
    std::function<void(HomeError, const std::string&, HomeLayout)> callback
) {
    if (userId == 0) {
        callback(HomeError::InvalidInput, "Invalid profile.", HomeLayout{});
        return;
    }
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(HomeError::Unavailable, "Database service unavailable.", HomeLayout{});
        return;
    }

    auto layout = std::make_shared<HomeLayout>();
    layout->user_id = userId;
    layout->version = 1;
    layout->background_class = defaultBackgroundClass();

    // `home.php` resolves the profile first and 404s when it is unknown.
    *db << "SELECT id, username FROM users WHERE id = ? LIMIT 1" << userId
        >> [db, userId, layout, callback](const drogon::orm::Result& profile) {
               if (profile.empty()) {
                   callback(HomeError::NotFound, "Profile not found.", HomeLayout{});
                   return;
               }
               layout->username = profile[0]["username"].as<std::string>();

               *db << "SELECT version, updated_at FROM phpretro_myhabbo_homes "
                      "WHERE user_id = ? AND guild_id = 0"
                   << userId
                   >> [db, userId, layout, callback](const drogon::orm::Result& version) {
                          if (!version.empty()) {
                              layout->version = version[0]["version"].as<uint32_t>();
                              layout->updated_at = version[0]["updated_at"].as<uint64_t>();
                          }

                          // `layouts()`: visible rows only, ordered by column and
                          // then position then id.
                          *db << "SELECT id, widget_key, column_number, position, visible, privacy "
                                 "FROM phpretro_myhabbo_layouts "
                                 "WHERE user_id = ? AND guild_id = 0 AND visible = 1 "
                                 "ORDER BY column_number ASC, position ASC, id ASC"
                              << userId
                              >> [db, userId, layout, callback](const drogon::orm::Result& rows) {
                                     for (const auto& row : rows) {
                                         HomeWidgetRecord widget;
                                         widget.id = row["id"].as<uint32_t>();
                                         widget.widget_key = row["widget_key"].as<std::string>();
                                         widget.column_number = row["column_number"].as<uint32_t>();
                                         widget.position = row["position"].as<uint32_t>();
                                         widget.visible = row["visible"].as<int>() != 0;
                                         widget.privacy = row["privacy"].as<std::string>();
                                         layout->widgets.push_back(std::move(widget));
                                     }
                                     if (layout->widgets.empty()) {
                                         // `displayLayouts()`: a home with no rows
                                         // renders one profile widget. Reported as
                                         // synthesised so a client cannot mistake it
                                         // for a stored row.
                                         HomeWidgetRecord widget;
                                         widget.id = 0;
                                         widget.widget_key = requiredWidgetKey();
                                         widget.column_number = 1;
                                         widget.position = 0;
                                         layout->widgets.push_back(std::move(widget));
                                         layout->default_layout = true;
                                     }

                                     // `placedItems()`: the page's stickers and
                                     // notes, back to front, joined to the
                                     // catalogue for the CSS class.
                                     *db << "SELECT i.id, i.item_type, i.skin, i.data, i.x, i.y, i.z, "
                                            "c.data AS catalogue_data, c.type AS catalogue_type "
                                            "FROM phpretro_homes_items i "
                                            "JOIN phpretro_homes_catalogue c ON c.id = i.catalogue_id "
                                            "WHERE i.user_id = ? AND i.guild_id = 0 AND i.placed = 1 "
                                            "ORDER BY i.z ASC, i.id ASC"
                                         << userId
                                         >> [layout, callback](const drogon::orm::Result& items) {
                                                for (const auto& row : items) {
                                                    HomeItemRecord item;
                                                    item.id = row["id"].as<uint32_t>();
                                                    item.item_type = row["item_type"].as<std::string>();
                                                    item.skin = row["skin"].as<std::string>();
                                                    item.data = row["data"].as<std::string>();
                                                    item.x = row["x"].as<int32_t>();
                                                    item.y = row["y"].as<int32_t>();
                                                    item.z = row["z"].as<int32_t>();
                                                    item.catalogue_data =
                                                        row["catalogue_data"].as<std::string>();
                                                    layout->items.push_back(std::move(item));
                                                }
                                                // `backgroundClass()`: the first
                                                // placed background wins, and a home
                                                // with none keeps the legacy default.
                                                for (const auto& item : layout->items) {
                                                    if (item.item_type == "background") {
                                                        layout->background_class =
                                                            backgroundClass(item.catalogue_data);
                                                        break;
                                                    }
                                                }
                                                callback(HomeError::None, "", *layout);
                                            }
                                         >> [callback](const drogon::orm::DrogonDbException& e) {
                                                HOTEL_LOG_ERROR("HomesService::loadLayout items: {}",
                                                                e.base().what());
                                                callback(HomeError::Unavailable,
                                                         "The page could not be loaded.", HomeLayout{});
                                            };
                                 }
                              >> [callback](const drogon::orm::DrogonDbException& e) {
                                     HOTEL_LOG_ERROR("HomesService::loadLayout layouts: {}",
                                                     e.base().what());
                                     callback(HomeError::Unavailable,
                                              "The page could not be loaded.", HomeLayout{});
                                 };
                      }
                   >> [callback](const drogon::orm::DrogonDbException& e) {
                          HOTEL_LOG_ERROR("HomesService::loadLayout version: {}", e.base().what());
                          callback(HomeError::Unavailable, "The page could not be loaded.", HomeLayout{});
                      };
           }
        >> [callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("HomesService::loadLayout profile: {}", e.base().what());
               callback(HomeError::Unavailable, "The page could not be loaded.", HomeLayout{});
           };
}

// ------------------------------------------------------------------ writing

void HomesService::saveLayout(
    uint32_t userId,
    uint32_t actorId,
    uint32_t expectedVersion,
    const std::vector<HomePlacement>& placements,
    std::optional<uint32_t> backgroundItemId,
    const std::string& lockToken,
    const std::string& actorIp,
    std::function<void(HomeSaveResult)> callback
) {
    if (userId == 0 || actorId == 0) {
        callback({HomeError::InvalidInput, "Invalid profile.", 0});
        return;
    }
    // Owner-only in this slice. Group homes are the second half of Phase 8 and
    // have their own permission rule (`canEditGroup`), deliberately not guessed
    // here.
    if (userId != actorId) {
        callback({HomeError::NotPermitted, "Not permitted.", 0});
        return;
    }
    if (expectedVersion == 0) {
        callback({HomeError::InvalidInput, "A layout version is required.", 0});
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback({HomeError::Unavailable, "Database service unavailable.", 0});
        return;
    }

    // The lock is checked before the transaction: it is what stops two people
    // editing at once, while the version CAS inside the transaction is what makes
    // a lost update impossible even if the lock expired mid-edit.
    verifyEditLock(userId, actorId, lockToken, [db, userId, actorId, expectedVersion, placements,
                                                backgroundItemId, actorIp, callback](bool held) {
        if (!held) {
            callback({HomeError::Locked, "This page is not locked for editing by you.", 0});
            return;
        }

        auto result = std::make_shared<HomeSaveResult>();
        auto settled = std::make_shared<bool>(false);

        // The audit record is written from the commit callback, so a rolled-back
        // layout is never audited as saved. Captured by value: the callback
        // outlives this scope.
        auto audit = std::make_shared<std::pair<uint32_t, std::string>>(actorId, actorIp);

        std::shared_ptr<drogon::orm::Transaction> trans;
        try {
            trans = db->newTransaction([callback, result, settled, audit, userId, placements,
                                        backgroundItemId](bool committed) {
                if (*settled) return;
                *settled = true;
                if (!committed) {
                    result->error = HomeError::Unavailable;
                    result->message = "The layout could not be saved.";
                    result->version = 0;
                    callback(*result);
                    return;
                }
                AuditService::logAction(
                    audit->first,
                    "homes_layout_saved",
                    "user",
                    userId,
                    "Saved MyHabbo layout version " + std::to_string(result->version) + " (" +
                        std::to_string(placements.size()) + " widget placement(s)" +
                        (backgroundItemId.has_value() ? ", background changed" : "") + ")",
                    audit->second);
                callback(*result);
            });
        } catch (const std::exception& e) {
            HOTEL_LOG_ERROR("HomesService::saveLayout: no transaction: {}", e.what());
            callback({HomeError::Unavailable, "The layout could not be saved.", 0});
            return;
        }

        auto steps = std::make_shared<TxnSteps>(
            trans,
            [callback, result, settled](HomeError error, const std::string& message) {
                if (*settled) return;
                *settled = true;
                result->error = error;
                result->message = message;
                result->version = 0;
                callback(*result);
            });

        // 1. The version row must exist before the compare-and-swap can find it.
        steps->add(
            "INSERT IGNORE INTO phpretro_myhabbo_homes (user_id, guild_id, version, updated_at) "
            "VALUES (?, 0, 1, 0)",
            HomeError::Unavailable,
            [steps](const drogon::orm::Result&) { steps->advance(); },
            userId);

        // 2. Compare-and-swap the version FIRST. It takes the row lock, so a
        //    second writer blocks here and then finds its expectation stale.
        //    Everything else in this transaction happens behind that lock.
        const uint64_t now = static_cast<uint64_t>(std::time(nullptr));
        steps->add(
            "UPDATE phpretro_myhabbo_homes SET version = version + 1, updated_at = ? "
            "WHERE user_id = ? AND guild_id = 0 AND version = ?",
            HomeError::Unavailable,
            [steps, result, expectedVersion](const drogon::orm::Result& r) {
                if (r.affectedRows() == 0) {
                    steps->abort(HomeError::VersionConflict,
                                 "This page changed while you were editing it.");
                    return;
                }
                result->version = expectedVersion + 1;
                steps->advance();
            },
            now, userId, expectedVersion);

        // 3. Read the home's rows FOR UPDATE and validate against them.
        auto existing = std::make_shared<std::vector<HomeWidgetRecord>>();
        steps->add(
            "SELECT id, widget_key, column_number, position FROM phpretro_myhabbo_layouts "
            "WHERE user_id = ? AND guild_id = 0 FOR UPDATE",
            HomeError::Unavailable,
            [steps, existing, placements, result, userId](const drogon::orm::Result& rows) {
                for (const auto& row : rows) {
                    HomeWidgetRecord widget;
                    widget.id = row["id"].as<uint32_t>();
                    widget.widget_key = row["widget_key"].as<std::string>();
                    widget.column_number = row["column_number"].as<uint32_t>();
                    widget.position = row["position"].as<uint32_t>();
                    existing->push_back(std::move(widget));
                }

                std::string message;
                const HomeError verdict = validatePlacements(placements, *existing, message);
                if (verdict != HomeError::None) {
                    steps->abort(verdict, message);
                    return;
                }

                // 4. Mirror every position into the negative range. The unique
                //    index is (user_id, guild_id, column_number, position), so
                //    swapping two widgets' slots would collide if they were written
                //    one at a time; mirroring is injective and cannot collide with
                //    a final position, which is always >= 0.
                steps->add(
                    "UPDATE phpretro_myhabbo_layouts SET position = -(position + 1) "
                    "WHERE user_id = ? AND guild_id = 0",
                    HomeError::Unavailable,
                    [steps, placements, userId](const drogon::orm::Result&) {
                        // 5. One statement per requested placement. Bounded by
                        //    kMaxPlacements, and each is scoped to the owner's rows.
                        for (const auto& placement : placements) {
                            steps->add(
                                "UPDATE phpretro_myhabbo_layouts "
                                "SET column_number = ?, position = ?, synced_at = NULL "
                                "WHERE id = ? AND user_id = ? AND guild_id = 0",
                                HomeError::Unavailable,
                                [steps](const drogon::orm::Result&) { steps->advance(); },
                                placement.column_number, placement.position,
                                placement.widget_id, userId);
                        }
                        // 6. Un-mirror whatever the request did not mention.
                        steps->add(
                            "UPDATE phpretro_myhabbo_layouts SET position = -(position + 1) "
                            "WHERE user_id = ? AND guild_id = 0 AND position < 0",
                            HomeError::Unavailable,
                            [steps](const drogon::orm::Result&) { steps->advance(); },
                            userId);
                        steps->advance();
                    },
                    userId);
                steps->advance();
            },
            userId);

        if (backgroundItemId.has_value()) {
            const uint32_t itemId = *backgroundItemId;
            auto backgroundOwner = std::make_shared<uint32_t>(0);
            steps->add(
                "SELECT id, user_id, item_type FROM phpretro_homes_items WHERE id = ? FOR UPDATE",
                HomeError::Unavailable,
                [steps, backgroundOwner, itemId, userId](const drogon::orm::Result& rows) {
                    if (rows.empty()) {
                        steps->abort(HomeError::NotFound, "That background is not in your inventory.");
                        return;
                    }
                    const std::string itemType = rows[0]["item_type"].as<std::string>();
                    *backgroundOwner = rows[0]["user_id"].as<uint32_t>();
                    if (itemType != "background" || *backgroundOwner != userId) {
                        steps->abort(HomeError::NotPermitted,
                                     "That background is not in your inventory.");
                        return;
                    }
                    // `saveBackground()`: unplace the home's current background,
                    // then place this one. Both statements are the legacy ones.
                    steps->add(
                        "UPDATE phpretro_homes_items SET placed = 0, guild_id = 0, synced_at = NULL "
                        "WHERE item_type = 'background' AND placed = 1 AND user_id = ? AND guild_id = 0",
                        HomeError::Unavailable,
                        [steps](const drogon::orm::Result&) { steps->advance(); },
                        userId);
                    steps->add(
                        "UPDATE phpretro_homes_items SET placed = 1, guild_id = 0, "
                        "x = 0, y = 0, z = 0, synced_at = NULL WHERE id = ? AND user_id = ?",
                        HomeError::Unavailable,
                        [steps](const drogon::orm::Result&) { steps->advance(); },
                        itemId, userId);
                    steps->advance();
                },
                itemId);
        }

        steps->start();
    });
}

// ------------------------------------------------------------------ widgets

void HomesService::addWidget(
    uint32_t userId,
    uint32_t actorId,
    const std::string& widgetKey,
    uint32_t columnNumber,
    const std::string& actorIp,
    std::function<void(HomeError, const std::string&, HomeWidgetRecord)> callback
) {
    if (userId == 0 || actorId == 0) {
        callback(HomeError::InvalidInput, "Invalid profile.", HomeWidgetRecord{});
        return;
    }
    if (userId != actorId) {
        callback(HomeError::NotPermitted, "Not permitted.", HomeWidgetRecord{});
        return;
    }

    const std::string key = normalizeWidgetKey(widgetKey);
    if (isBlockedWidget(key)) {
        // `add()` answers 501 for the Trax player: the widget exists in the legacy
        // catalogue but is emulator-bound, so it is refused rather than stubbed.
        callback(HomeError::Unavailable, "This widget is unavailable.", HomeWidgetRecord{});
        return;
    }
    if (!isUserWidget(key)) {
        callback(HomeError::InvalidInput, "Unknown widget.", HomeWidgetRecord{});
        return;
    }
    const uint32_t column = columnNumber == 2 ? 2U : 1U;

    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(HomeError::Unavailable, "Database service unavailable.", HomeWidgetRecord{});
        return;
    }

    // `add()`'s own predicate: one of each widget key per home.
    *db << "SELECT id FROM phpretro_myhabbo_layouts WHERE user_id = ? AND guild_id = 0 "
           "AND widget_key = ? LIMIT 1"
        << userId << key
        >> [db, userId, actorId, key, column, actorIp, callback](const drogon::orm::Result& existing) {
               if (!existing.empty()) {
                   callback(HomeError::VersionConflict, "Widget already placed.", HomeWidgetRecord{});
                   return;
               }
               *db << "SELECT COALESCE(MAX(position), -1) + 1 AS next_position "
                      "FROM phpretro_myhabbo_layouts "
                      "WHERE user_id = ? AND guild_id = 0 AND column_number = ?"
                   << userId << column
                   >> [db, userId, actorId, key, column, actorIp, callback](
                          const drogon::orm::Result& r) {
                          const uint32_t position =
                              r.empty() ? 0U : r[0]["next_position"].as<uint32_t>();
                          *db << "INSERT INTO phpretro_myhabbo_layouts "
                                 "(user_id, guild_id, column_number, widget_key, position, visible, privacy) "
                                 "VALUES (?, 0, ?, ?, ?, 1, 'public')"
                              << userId << column << key << position
                              >> [db, userId, actorId, key, column, position, actorIp, callback](
                                     const drogon::orm::Result&) {
                                     AuditService::logAction(actorId, "homes_widget_added", "user",
                                                             userId, "Added widget " + key, actorIp);
                                     HomeWidgetRecord widget;
                                     widget.widget_key = key;
                                     widget.column_number = column;
                                     widget.position = position;
                                     widget.visible = true;
                                     widget.privacy = "public";
                                     // Read the id back so the caller can place it
                                     // immediately without a second round trip.
                                     *db << "SELECT id FROM phpretro_myhabbo_layouts "
                                            "WHERE user_id = ? AND guild_id = 0 AND widget_key = ? "
                                            "ORDER BY id DESC LIMIT 1"
                                          << userId << key
                                          >> [widget, callback](const drogon::orm::Result& rows) mutable {
                                                 if (!rows.empty()) {
                                                     widget.id = rows[0]["id"].as<uint32_t>();
                                                 }
                                                 callback(HomeError::None, "", widget);
                                             }
                                          >> [widget, callback](const drogon::orm::DrogonDbException&) {
                                                 callback(HomeError::None, "", widget);
                                             };
                                 }
                              >> [callback](const drogon::orm::DrogonDbException& e) {
                                     const std::string what = e.base().what();
                                     HOTEL_LOG_ERROR("HomesService::addWidget insert: {}", what);
                                     if (isUniqueViolation(what)) {
                                         callback(HomeError::VersionConflict, "Widget already placed.",
                                                  HomeWidgetRecord{});
                                         return;
                                     }
                                     callback(HomeError::Unavailable,
                                              "The widget could not be added.", HomeWidgetRecord{});
                                 };
                      }
                   >> [callback](const drogon::orm::DrogonDbException& e) {
                          HOTEL_LOG_ERROR("HomesService::addWidget position: {}", e.base().what());
                          callback(HomeError::Unavailable, "The widget could not be added.",
                                   HomeWidgetRecord{});
                      };
           }
        >> [callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("HomesService::addWidget lookup: {}", e.base().what());
               callback(HomeError::Unavailable, "The widget could not be added.", HomeWidgetRecord{});
           };
}

void HomesService::removeWidget(
    uint32_t userId,
    uint32_t actorId,
    uint32_t widgetId,
    const std::string& actorIp,
    std::function<void(HomeError, const std::string&)> callback
) {
    if (userId == 0 || actorId == 0 || widgetId == 0) {
        callback(HomeError::InvalidInput, "Invalid widget.");
        return;
    }
    if (userId != actorId) {
        callback(HomeError::NotPermitted, "Not permitted.");
        return;
    }
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(HomeError::Unavailable, "Database service unavailable.");
        return;
    }

    *db << "SELECT id, widget_key FROM phpretro_myhabbo_layouts "
           "WHERE id = ? AND user_id = ? AND guild_id = 0"
        << widgetId << userId
        >> [db, userId, actorId, widgetId, actorIp, callback](const drogon::orm::Result& rows) {
               if (rows.empty()) {
                   callback(HomeError::NotFound, "Widget not found.");
                   return;
               }
               const std::string key = rows[0]["widget_key"].as<std::string>();
               if (key == requiredWidgetKey()) {
                   // `delete()`: the profile widget is the page's identity and
                   // cannot be removed. Legacy answers 403.
                   callback(HomeError::NotPermitted, "This widget cannot be removed.");
                   return;
               }
               *db << "DELETE FROM phpretro_myhabbo_layouts WHERE id = ? AND user_id = ? AND guild_id = 0"
                   << widgetId << userId
                   >> [actorId, userId, widgetId, key, actorIp, callback](const drogon::orm::Result&) {
                          AuditService::logAction(actorId, "homes_widget_deleted", "user", userId,
                                                  "Removed widget " + key, actorIp);
                          callback(HomeError::None, "");
                      }
                   >> [callback](const drogon::orm::DrogonDbException& e) {
                          HOTEL_LOG_ERROR("HomesService::removeWidget delete: {}", e.base().what());
                          callback(HomeError::Unavailable, "The widget could not be removed.");
                      };
           }
        >> [callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("HomesService::removeWidget lookup: {}", e.base().what());
               callback(HomeError::Unavailable, "The widget could not be removed.");
           };
}

// -------------------------------------------------------------------- locks

void HomesService::editLockState(
    uint32_t userId,
    std::function<void(HomeEditLock)> callback
) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(HomeEditLock{});
        return;
    }
    redis->execCommandAsync(
        [callback](const drogon::nosql::RedisResult& r) {
            HomeEditLock lock;
            if (r.type() != drogon::nosql::RedisResultType::kString) {
                callback(lock);
                return;
            }
            const std::string value = r.asString();
            const std::size_t colon = value.find(':');
            if (colon == std::string::npos) {
                callback(lock);
                return;
            }
            try {
                lock.holder_user_id = static_cast<uint32_t>(std::stoul(value.substr(0, colon)));
            } catch (const std::exception&) {
                callback(HomeEditLock{});
                return;
            }
            lock.held = lock.holder_user_id != 0;
            callback(lock);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("HomesService::editLockState: {}", e.what());
            callback(HomeEditLock{});
        },
        "GET %s",
        editLockKey(userId).c_str());
}

void HomesService::acquireEditLock(
    uint32_t userId,
    uint32_t actorId,
    std::function<void(HomeError, const std::string&, HomeEditLock)> callback
) {
    if (userId == 0 || actorId == 0) {
        callback(HomeError::InvalidInput, "Invalid profile.", HomeEditLock{});
        return;
    }
    if (userId != actorId) {
        callback(HomeError::NotPermitted, "Not permitted.", HomeEditLock{});
        return;
    }
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(HomeError::Unavailable, "The edit session store is unavailable.", HomeEditLock{});
        return;
    }

    const std::string key = editLockKey(userId);
    const std::string token = utils::Crypto::randomHex(16);

    // SET NX EX: the acquire is one atomic command, so two editors cannot both
    // see themselves as the holder.
    redis->execCommandAsync(
        [redis, key, token, actorId, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() == drogon::nosql::RedisResultType::kStatus) {
                HomeEditLock lock;
                lock.held = true;
                lock.holder_user_id = actorId;
                lock.token = token;
                callback(HomeError::None, "", lock);
                return;
            }
            // Not acquired. Either somebody else holds it, or this actor already
            // does — and in that case the value is left alone, because rewriting it
            // would invalidate the token the holder is already carrying.
            redis->execCommandAsync(
                [redis, key, actorId, callback](const drogon::nosql::RedisResult& current) {
                    HomeEditLock lock;
                    if (current.type() == drogon::nosql::RedisResultType::kString) {
                        const std::string value = current.asString();
                        const std::size_t colon = value.find(':');
                        if (colon != std::string::npos) {
                            try {
                                lock.holder_user_id =
                                    static_cast<uint32_t>(std::stoul(value.substr(0, colon)));
                            } catch (const std::exception&) {
                                lock.holder_user_id = 0;
                            }
                            if (lock.holder_user_id == actorId) {
                                lock.token = value.substr(colon + 1);
                            }
                        }
                    }
                    if (lock.holder_user_id == actorId && !lock.token.empty()) {
                        lock.held = true;
                        // Refresh the holder's own deadline.
                        redis->execCommandAsync(
                            [callback, lock](const drogon::nosql::RedisResult&) {
                                callback(HomeError::None, "", lock);
                            },
                            [callback, lock](const std::exception&) { callback(HomeError::None, "", lock); },
                            "EXPIRE %s %u",
                            key.c_str(),
                            static_cast<unsigned int>(kEditLockTtlSeconds));
                        return;
                    }
                    callback(HomeError::Locked,
                             lock.holder_user_id == 0
                                 ? "This page is being edited right now."
                                 : "This page is being edited by somebody else right now.",
                             lock);
                },
                [callback](const std::exception& e) {
                    HOTEL_LOG_ERROR("HomesService::acquireEditLock GET: {}", e.what());
                    callback(HomeError::Unavailable, "The edit session store is unavailable.",
                             HomeEditLock{});
                },
                "GET %s",
                key.c_str());
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("HomesService::acquireEditLock SET: {}", e.what());
            callback(HomeError::Unavailable, "The edit session store is unavailable.", HomeEditLock{});
        },
        "SET %s %s NX EX %u",
        key.c_str(),
        lockValue(actorId, token).c_str(),
        static_cast<unsigned int>(kEditLockTtlSeconds));
}

void HomesService::releaseEditLock(
    uint32_t userId,
    uint32_t actorId,
    const std::string& token,
    std::function<void(HomeError, const std::string&)> callback
) {
    if (userId == 0 || actorId == 0) {
        callback(HomeError::InvalidInput, "Invalid profile.");
        return;
    }
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(HomeError::Unavailable, "The edit session store is unavailable.");
        return;
    }
    const std::string key = editLockKey(userId);
    redis->execCommandAsync(
        [redis, key, actorId, token, callback](const drogon::nosql::RedisResult& r) {
            const std::string value =
                r.type() == drogon::nosql::RedisResultType::kString ? r.asString() : std::string();
            // Only the holder's own token deletes the key. A non-holder is told 403
            // rather than being silently ignored.
            if (value != lockValue(actorId, token)) {
                callback(HomeError::NotPermitted, "You do not hold this edit session.");
                return;
            }
            redis->execCommandAsync(
                [callback](const drogon::nosql::RedisResult&) { callback(HomeError::None, ""); },
                [callback](const std::exception& e) {
                    HOTEL_LOG_ERROR("HomesService::releaseEditLock DEL: {}", e.what());
                    callback(HomeError::Unavailable, "The edit session store is unavailable.");
                },
                "DEL %s",
                key.c_str());
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("HomesService::releaseEditLock GET: {}", e.what());
            callback(HomeError::Unavailable, "The edit session store is unavailable.");
        },
        "GET %s",
        key.c_str());
}

void HomesService::verifyEditLock(
    uint32_t userId,
    uint32_t actorId,
    const std::string& token,
    std::function<void(bool)> callback
) {
    if (token.empty()) {
        callback(false);
        return;
    }
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(false);
        return;
    }
    redis->execCommandAsync(
        [userId, actorId, token, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() != drogon::nosql::RedisResultType::kString) {
                HOTEL_LOG_WARN("HomesService::verifyEditLock: home {} has no lock (type {})",
                               userId, static_cast<int>(r.type()));
                callback(false);
                return;
            }
            const std::string actual = r.asString();
            const std::string expected = lockValue(actorId, token);
            if (actual != expected) {
                HOTEL_LOG_WARN(
                    "HomesService::verifyEditLock: home {} lock mismatch for user {} "
                    "(stored {} chars, presented {} chars)",
                    userId, actorId, actual.size(), expected.size());
                callback(false);
                return;
            }
            callback(true);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("HomesService::verifyEditLock: {}", e.what());
            callback(false);
        },
        "GET %s",
        editLockKey(userId).c_str());
}

} // namespace hotel::services
