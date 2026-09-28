#include "controllers/HomesController.h"
#include "utils/ClientAddress.h"
#include "filters/AuthPolicy.h"
#include "services/HomeRatingService.h"
#include "services/HomeStoreService.h"
#include "services/HomesService.h"
#include "utils/Logger.h"
#include <json/json.h>
#include <memory>
#include <optional>
#include <string>
#include <vector>

using Json::Value;
using hotel::services::HomeError;
using hotel::services::homeErrorStatus;
using hotel::services::HomeItemRecord;
using hotel::services::HomeLayout;
using hotel::services::HomePlacement;
using hotel::services::HomeWidgetRecord;

namespace {

int homeStoreStatus(hotel::services::HomeStoreCode code) {
    switch (code) {
        case hotel::services::HomeStoreCode::InvalidInput: return 400;
        case hotel::services::HomeStoreCode::NotFound: return 404;
        case hotel::services::HomeStoreCode::Unavailable: return 503;
        case hotel::services::HomeStoreCode::None: return 200;
    }
    return 503;
}

drogon::HttpResponsePtr homeStoreResponse(
    const hotel::services::HomeStoreResult& result,
    bool categoriesOnly) {
    Value body;
    if (!result.ok()) {
        body["error"] = result.code == hotel::services::HomeStoreCode::InvalidInput
                             ? "Bad Request"
                             : result.code == hotel::services::HomeStoreCode::NotFound
                                   ? "Not Found"
                                   : "Service Unavailable";
        body["message"] = result.message;
        body["status"] = homeStoreStatus(result.code);
    } else {
        body["status"] = "ok";
        if (categoriesOnly) {
            Value categories(Json::arrayValue);
            for (const auto& category : result.categories) {
                Value row;
                row["category_id"] = category.category_id;
                row["category"] = category.category;
                categories.append(std::move(row));
            }
            body["categories"] = std::move(categories);
        } else {
            Value items(Json::arrayValue);
            for (const auto& item : result.items) {
                Value row;
                row["id"] = item.id;
                row["name"] = item.name;
                row["description"] = item.description;
                row["type"] = item.type;
                if (item.data_key.has_value())
                    row["data_key"] = *item.data_key;
                row["price"] = item.price;
                row["amount"] = item.amount;
                row["category"] = item.category;
                row["category_id"] = item.category_id;
                row["min_rank"] = item.min_rank;
                row["placement"] = item.placement;
                items.append(std::move(row));
            }
            body["items"] = std::move(items);
        }
    }
    auto response = drogon::HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(
        static_cast<drogon::HttpStatusCode>(homeStoreStatus(result.code)));
    return response;
}

}  // namespace

namespace hotel::controllers {

namespace {

/** The caller's public session, when there is one. Never an error on its own. */
void withOptionalUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(std::optional<services::UserSessionData>)> callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [callback](const services::UserSessionData& session) { callback(session); },
        [callback](const drogon::HttpResponsePtr&) { callback(std::nullopt); });
}

/** A caller who must be signed in, answered 401 when they are not. */
void withRequiredUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(const services::UserSessionData&)> onUser,
    std::function<void(const drogon::HttpResponsePtr&)> onDenied
) {
    filters::AuthPolicy::requireUser(req, onUser, onDenied);
}

drogon::HttpResponsePtr jsonError(HomeError error, const std::string& message) {
    Value body;
    switch (error) {
        case HomeError::InvalidInput:    body["error"] = "Bad Request"; break;
        case HomeError::NotFound:        body["error"] = "Not Found"; break;
        case HomeError::NotPermitted:    body["error"] = "Forbidden"; break;
        case HomeError::VersionConflict: body["error"] = "Conflict"; break;
        case HomeError::Locked:          body["error"] = "Locked"; break;
        case HomeError::Unavailable:     body["error"] = "Service Unavailable"; break;
        case HomeError::None:            body["error"] = "OK"; break;
    }
    body["message"] = message;
    body["status"] = hotel::services::homeErrorStatus(error);
    auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
    resp->setStatusCode(static_cast<drogon::HttpStatusCode>(hotel::services::homeErrorStatus(error)));
    return resp;
}

int homeRatingStatus(services::HomeRatingCode code) {
    switch (code) {
        case services::HomeRatingCode::InvalidInput: return 400;
        case services::HomeRatingCode::NotFound: return 404;
        case services::HomeRatingCode::Unavailable: return 503;
        case services::HomeRatingCode::None: return 200;
    }
    return 503;
}

drogon::HttpResponsePtr homeRatingResponse(const services::HomeRatingResult& result) {
    Value body;
    if (!result.ok()) {
        switch (result.code) {
            case services::HomeRatingCode::InvalidInput: body["error"] = "Bad Request"; break;
            case services::HomeRatingCode::NotFound: body["error"] = "Not Found"; break;
            case services::HomeRatingCode::Unavailable: body["error"] = "Service Unavailable"; break;
            case services::HomeRatingCode::None: body["error"] = "OK"; break;
        }
        body["message"] = result.message;
        body["status"] = homeRatingStatus(result.code);
    } else {
        body["status"] = "ok";
        body["total"] = static_cast<Json::UInt64>(result.summary.total);
        body["high"] = static_cast<Json::UInt64>(result.summary.high);
        body["average"] = result.summary.average;
        body["px"] = result.summary.px;
        body["mine"] = result.summary.mine;
        body["owner"] = result.summary.owner;
    }
    auto response = drogon::HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(
        static_cast<drogon::HttpStatusCode>(homeRatingStatus(result.code)));
    return response;
}

Value widgetJson(const HomeWidgetRecord& widget) {
    Value out;
    out["id"] = widget.id;
    out["widget_key"] = widget.widget_key;
    out["column"] = widget.column_number;
    out["position"] = widget.position;
    out["visible"] = widget.visible;
    out["privacy"] = widget.privacy;
    // The pixel geometry is derived here from the stored column/position rather
    // than stored: `PhpretroHomes::widgetStyle()` is the only definition of it,
    // and a second copy in the database could drift from the stylesheets.
    out["left"] = hotel::services::HomesService::leftForColumn(widget.column_number);
    out["top"] = hotel::services::HomesService::topForPosition(widget.position);
    out["z_index"] = hotel::services::HomesService::zIndexForPosition(widget.position);
    return out;
}

Value itemJson(const HomeItemRecord& item) {
    Value out;
    out["id"] = item.id;
    out["type"] = item.item_type;
    out["skin"] = item.skin;
    out["data"] = item.data;
    out["x"] = item.x;
    out["y"] = item.y;
    out["z"] = item.z;
    out["catalogue_data"] = item.catalogue_data;
    return out;
}

/**
 * The owner block â€” legacy `PhpretroHomes::profile()`'s row.
 *
 * `tags` travels as the array the box renders, already split and filtered the
 * way `array_values(array_filter(explode(';', $tags)))` did, so the client
 * cannot disagree with the server about what a trailing separator means.
 * `settings_available` is false when the `users_settings` half could not be read
 * at all, which is what stops the box from rendering "No tags." for a user whose
 * tags it simply could not see.
 */
Value ownerJson(const services::HomeOwner& owner) {
    Value out;
    out["id"] = owner.id;
    out["username"] = owner.username;
    out["motto"] = owner.motto;
    out["look"] = owner.look;
    out["account_created"] = static_cast<Json::UInt64>(owner.account_created);
    out["last_online"] = static_cast<Json::UInt64>(owner.last_online);
    out["online"] = owner.online;
    out["hide_online"] = owner.hide_online;
    out["settings_available"] = owner.settings_available;
    Value tags(Json::arrayValue);
    for (const auto& tag : services::HomesService::splitTags(owner.tags)) {
        tags.append(tag);
    }
    out["tags"] = tags;
    return out;
}

/** What one widget box renders inside itself. */
Value widgetDataJson(const services::HomeWidgetData& data) {
    Value out;
    out["available"] = data.available;
    if (!data.available) {
        out["unavailable_reason"] = data.unavailable_reason;
    }
    Value badges(Json::arrayValue);
    for (const auto& badge : data.badges) {
        Value row;
        row["badge_code"] = badge.badge_code;
        badges.append(row);
    }
    out["badges"] = badges;
    Value groups(Json::arrayValue);
    for (const auto& group : data.groups) {
        Value row;
        row["id"] = group.id;
        row["name"] = group.name;
        row["badge"] = group.badge;
        row["level_id"] = group.level_id;
        groups.append(row);
    }
    out["groups"] = groups;
    Value rooms(Json::arrayValue);
    for (const auto& room : data.rooms) {
        Value row;
        row["id"] = room.id;
        row["name"] = room.name;
        row["description"] = room.description;
        rooms.append(row);
    }
    out["rooms"] = rooms;
    out["friend_count"] = data.friend_count;
    out["friend_count_known"] = data.friend_count_known;
    return out;
}

/** The full layout payload both GET and a successful PUT answer with. */
Value layoutJson(
    const HomeLayout& layout,
    bool editable,
    const services::HomeEditLock& lock,
    uint32_t viewerId
) {
    Value home;
    home["user_id"] = layout.user_id;
    home["username"] = layout.username;
    home["version"] = layout.version;
    home["updated_at"] = static_cast<Json::UInt64>(layout.updated_at);
    home["background"] = layout.background_class;
    // `displayLayouts()` synthesises a profile widget for a home with no rows.
    // Saying so lets a client tell "this page has one widget" from "this page has
    // never been saved".
    home["default_layout"] = layout.default_layout;
    home["editable"] = editable;

    Value lockJson;
    lockJson["held"] = lock.held;
    lockJson["holder_user_id"] = lock.holder_user_id;
    lockJson["expires_at"] = static_cast<Json::UInt64>(lock.expires_at);
    // The token is returned only to the caller that holds the lock. Somebody
    // else's session must not be usable, so it is not echoed.
    if (lock.held && lock.holder_user_id == viewerId) {
        lockJson["token"] = lock.token;
        lockJson["is_mine"] = true;
    } else {
        lockJson["is_mine"] = false;
    }
    home["lock"] = lockJson;
    home["owner"] = ownerJson(layout.owner);

    Value widgets(Json::arrayValue);
    for (const auto& widget : layout.widgets) {
        Value entry = widgetJson(widget);
        // Each box's content travels with the box: `home.php` rendered the whole
        // page in one load, and a client that had to fetch per widget would be a
        // different page with a different failure mode.
        for (const auto& withData : layout.widget_data) {
            if (withData.widget.id == widget.id &&
                withData.widget.widget_key == widget.widget_key) {
                entry["data"] = widgetDataJson(withData.data);
                break;
            }
        }
        widgets.append(entry);
    }
    Value items(Json::arrayValue);
    for (const auto& item : layout.items) {
        items.append(itemJson(item));
    }

    Value root;
    root["status"] = "ok";
    root["home"] = home;
    root["widgets"] = widgets;
    root["items"] = items;
    return root;
}

} // namespace
void HomesController::layout(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId
) {
    withOptionalUser(req, [userId, callback](std::optional<services::UserSessionData> session) {
        const uint32_t viewerId = session.has_value() ? session->user_id : 0;
        services::HomesService::loadLayout(
            userId,
            [viewerId, callback](HomeError error, const std::string& message, HomeLayout layout) {
                if (error != HomeError::None) {
                    callback(jsonError(error, message));
                    return;
                }
                services::HomesService::editLockState(
                    layout.user_id,
                    [layout, viewerId, callback](services::HomeEditLock lock) {
                        const bool editable = viewerId != 0 && viewerId == layout.user_id;
                        callback(drogon::HttpResponse::newHttpJsonResponse(
                            layoutJson(layout, editable, lock, viewerId)));
                    });
            });
    });
}

void HomesController::saveLayout(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId
) {
    withRequiredUser(
        req,
        [req, callback, userId](const services::UserSessionData& session) {
            auto body = req->getJsonObject();
            if (!body) {
                callback(jsonError(HomeError::InvalidInput, "A JSON body is required."));
                return;
            }

            const uint32_t version = (*body).isMember("version") && (*body)["version"].isUInt()
                                         ? (*body)["version"].asUInt()
                                         : 0;
            const std::string lockToken = (*body).isMember("lock_token") &&
                                                  (*body)["lock_token"].isString()
                                              ? (*body)["lock_token"].asString()
                                              : "";

            std::vector<HomePlacement> placements;
            if ((*body).isMember("widgets")) {
                if (!(*body)["widgets"].isArray()) {
                    callback(jsonError(HomeError::InvalidInput, "widgets must be an array."));
                    return;
                }
                for (const auto& entry : (*body)["widgets"]) {
                    if (!entry.isObject() || !entry.isMember("id") || !entry["id"].isUInt()) {
                        callback(jsonError(HomeError::InvalidInput,
                                           "Every placement needs a widget id."));
                        return;
                    }
                    HomePlacement placement;
                    placement.widget_id = entry["id"].asUInt();
                    placement.column_number =
                        entry.isMember("column") && entry["column"].isUInt()
                            ? entry["column"].asUInt()
                            : 1U;
                    placement.position = entry.isMember("position") && entry["position"].isUInt()
                                             ? entry["position"].asUInt()
                                             : 0U;
                    placements.push_back(placement);
                }
            }

            std::optional<uint32_t> backgroundItemId;
            if ((*body).isMember("background_item_id") && !(*body)["background_item_id"].isNull()) {
                if (!(*body)["background_item_id"].isUInt()) {
                    callback(jsonError(HomeError::InvalidInput,
                                       "background_item_id must be a number."));
                    return;
                }
                backgroundItemId = (*body)["background_item_id"].asUInt();
            }

            const std::string ip = utils::ClientAddress::of(req);
            services::HomesService::saveLayout(
                userId,
                session.user_id,
                version,
                placements,
                backgroundItemId,
                lockToken,
                ip,
                [callback, userId, session](services::HomeSaveResult result) {
                    if (result.error != HomeError::None) {
                        // A stale version is answered with the current layout, so
                        // the client can roll its optimistic update back to the
                        // server's state without a second request â€” and without
                        // ever being told its own write landed.
                        if (result.error == HomeError::VersionConflict) {
                            services::HomesService::loadLayout(
                                userId,
                                [callback, result, userId](HomeError error, const std::string&,
                                                           HomeLayout current) {
                                    if (error != HomeError::None) {
                                        callback(jsonError(HomeError::VersionConflict,
                                                           result.message));
                                        return;
                                    }
                                    // Built as one Value rather than patched into
                                    // `jsonError`'s body: the conflict answer is the
                                    // one response whose shape a client depends on,
                                    // and a `const_cast` into a response's JSON would
                                    // be a silent way to get it wrong.
                                    Value payload;
                                    payload["error"] = "Conflict";
                                    payload["message"] = result.message;
                                    payload["status"] = homeErrorStatus(HomeError::VersionConflict);
                                    payload["current_version"] = current.version;
                                    payload["current"] =
                                        layoutJson(current, true, services::HomeEditLock{}, userId);
                                    auto resp =
                                        drogon::HttpResponse::newHttpJsonResponse(payload);
                                    resp->setStatusCode(drogon::k409Conflict);
                                    callback(resp);
                                });
                            return;
                        }
                        callback(jsonError(result.error, result.message));
                        return;
                    }
                    services::HomesService::editLockState(
                        userId,
                        [callback, userId, session](services::HomeEditLock lock) {
                            services::HomesService::loadLayout(
                                userId,
                                [callback, userId, session, lock](HomeError error,
                                                                  const std::string& message,
                                                                  HomeLayout layout) {
                                    if (error != HomeError::None) {
                                        callback(jsonError(error, message));
                                        return;
                                    }
                                    callback(drogon::HttpResponse::newHttpJsonResponse(
                                        layoutJson(layout, true, lock, userId)));
                                });
                        });
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::openEditSession(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId
) {
    withRequiredUser(
        req,
        [callback, userId](const services::UserSessionData& session) {
            services::HomesService::acquireEditLock(
                userId,
                session.user_id,
                [callback](HomeError error, const std::string& message,
                           services::HomeEditLock lock) {
                    if (error != HomeError::None) {
                        callback(jsonError(error, message));
                        return;
                    }
                    Value root;
                    root["status"] = "ok";
                    root["token"] = lock.token;
                    root["holder_user_id"] = lock.holder_user_id;
                    root["ttl_seconds"] = services::HomesService::kEditLockTtlSeconds;
                    callback(drogon::HttpResponse::newHttpJsonResponse(root));
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::closeEditSession(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId
) {
    withRequiredUser(
        req,
        [req, callback, userId](const services::UserSessionData& session) {
            std::string token;
            if (auto body = req->getJsonObject(); body && (*body).isMember("lock_token") &&
                                                  (*body)["lock_token"].isString()) {
                token = (*body)["lock_token"].asString();
            }
            services::HomesService::releaseEditLock(
                userId,
                session.user_id,
                token,
                [callback](HomeError error, const std::string& message) {
                    if (error != HomeError::None) {
                        callback(jsonError(error, message));
                        return;
                    }
                    Value root;
                    root["status"] = "ok";
                    root["released"] = true;
                    callback(drogon::HttpResponse::newHttpJsonResponse(root));
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::addWidget(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId
) {
    withRequiredUser(
        req,
        [req, callback, userId](const services::UserSessionData& session) {
            auto body = req->getJsonObject();
            if (!body) {
                callback(jsonError(HomeError::InvalidInput, "A JSON body is required."));
                return;
            }
            const std::string key = (*body).isMember("widget_key") && (*body)["widget_key"].isString()
                                        ? (*body)["widget_key"].asString()
                                        : "";
            const uint32_t column = (*body).isMember("column") && (*body)["column"].isUInt()
                                        ? (*body)["column"].asUInt()
                                        : 1U;
            services::HomesService::acquireEditLock(
                userId,
                session.user_id,
                [req, callback, userId, key, column, session](HomeError lockError,
                                                              const std::string& lockMessage,
                                                              services::HomeEditLock) {
                    if (lockError != HomeError::None) {
                        // A widget add is an edit, so it needs the edit session
                        // too â€” otherwise the lock would be advisory for exactly
                        // the operation that changes the page's structure.
                        callback(jsonError(lockError, lockMessage));
                        return;
                    }
                    services::HomesService::addWidget(                        userId,
                        session.user_id,
                        key,
                        column,
                        utils::ClientAddress::of(req),
                        [callback](HomeError error, const std::string& message,
                                   HomeWidgetRecord widget) {
                            if (error != HomeError::None) {
                                callback(jsonError(error, message));
                                return;
                            }
                            Value root;
                            root["status"] = "ok";
                            root["widget"] = widgetJson(widget);
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                            resp->setStatusCode(drogon::k201Created);
                            callback(resp);
                        });
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::removeWidget(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId,
    uint32_t widgetId
) {
    withRequiredUser(
        req,
        [req, callback, userId, widgetId](const services::UserSessionData& session) {
            services::HomesService::acquireEditLock(
                userId,
                session.user_id,
                [req, callback, userId, widgetId, session](HomeError lockError,
                                                           const std::string& lockMessage,
                                                           services::HomeEditLock) {
                    if (lockError != HomeError::None) {
                        callback(jsonError(lockError, lockMessage));
                        return;
                    }
                    services::HomesService::removeWidget(
                        userId,
                        session.user_id,
                        widgetId,
                        utils::ClientAddress::of(req),
                        [callback](HomeError error, const std::string& message) {
                            if (error != HomeError::None) {
                                callback(jsonError(error, message));
                                return;
                            }
                            Value root;
                            root["status"] = "ok";
                            root["removed"] = true;
                            callback(drogon::HttpResponse::newHttpJsonResponse(root));
                        });
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::ratingSummary(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId) {
    withOptionalUser(req, [callback, userId](std::optional<services::UserSessionData> session) {
        const uint32_t viewerId = session.has_value() ? session->user_id : 0;
        services::HomeRatingService::getSummary(
            drogon::app().getDbClient("default"),
            userId,
            viewerId,
            [callback](services::HomeRatingResult result) {
                callback(homeRatingResponse(result));
            });
    });
}

void HomesController::rate(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    uint32_t userId,
    uint32_t widgetId) {
    withRequiredUser(
        req,
        [req, callback, userId, widgetId](const services::UserSessionData& session) {
            const auto body = req->getJsonObject();
            if (!body || !body->isObject() || !body->isMember("rating") ||
                !(*body)["rating"].isInt()) {
                callback(jsonError(HomeError::InvalidInput,
                                   "rating must be an integer from 1 to 5."));
                return;
            }

            services::HomeRatingService::castVote(
                drogon::app().getDbClient("default"),
                userId,
                widgetId,
                session.user_id,
                (*body)["rating"].asInt(),
                utils::ClientAddress::of(req),
                [callback](services::HomeRatingResult result) {
                    callback(homeRatingResponse(result));
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::storeCategories(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    withRequiredUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            const auto type = req->getParameter("type");
            services::HomeStoreService::getCategories(
                drogon::app().getDbClient("default"), session.user_id, type,
                [callback](services::HomeStoreResult result) {
                    callback(homeStoreResponse(result, true));
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void HomesController::storeItems(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    withRequiredUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            const auto type = req->getParameter("type");
            const auto categoryText = req->getParameter("category_id");
            uint32_t categoryId = 0;
            if (!services::HomeStoreService::parseCategoryId(categoryText,
                                                             categoryId)) {
                services::HomeStoreResult invalid;
                invalid.code = services::HomeStoreCode::InvalidInput;
                invalid.message = "category_id must be an unsigned integer.";
                callback(homeStoreResponse(invalid, false));
                return;
            }
            services::HomeStoreService::getItems(
                drogon::app().getDbClient("default"), session.user_id, type,
                categoryId,
                [callback](services::HomeStoreResult result) {
                    callback(homeStoreResponse(result, false));
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

} // namespace hotel::controllers
