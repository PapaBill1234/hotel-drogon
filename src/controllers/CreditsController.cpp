#include "controllers/CreditsController.h"
#include "filters/AuthPolicy.h"
#include "services/ContentService.h"
#include "services/TransactionService.h"
#include "services/UserAccountService.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <json/json.h>
#include <map>
#include <memory>

using Json::Value;

namespace hotel::controllers {

namespace {

/** `history.php`'s own cap: `ORDER BY created_at DESC, id DESC LIMIT 100`. */
constexpr uint32_t kHistoryLimit = 100;

/**
 * The `phpretro_site_settings` keys the legacy client page needed.
 *
 * `client.php` passed these straight into the Shockwave `sw2`/`sw3`/`src`
 * parameters: `connection.info.host`/`port` from `hotel_ip`/`hotel_port`,
 * `connection.mus.host`/`port` from `hotel_ip`/`hotel_mus`, and the client asset
 * from `client_dcr`. None of them is invented here; they are the settings the
 * legacy page read by name.
 *
 * The first four are required for a client to connect at all. `client_dcr` is
 * required for the legacy *asset* only, and is reported separately so a
 * browser-native client would not be blocked by a missing `.dcr`.
 */
constexpr const char* kSettingHotelIp = "hotel_ip";
constexpr const char* kSettingHotelPort = "hotel_port";
constexpr const char* kSettingHotelMus = "hotel_mus";
constexpr const char* kSettingClientDcr = "client_dcr";

/**
 * Load the signed-in user, answering 404/401 itself when that is not possible.
 *
 * Extracted so both handlers authorize and resolve identically instead of each
 * re-deriving it — the balance route and the ledger route must not disagree
 * about who is signed in.
 */
void withSignedInUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(const services::UserRecord&)> onUser,
    std::function<void(const drogon::HttpResponsePtr&)> onFailure
) {
    filters::AuthPolicy::requireUser(
        req,
        [onUser, onFailure](const services::UserSessionData& session) {
            services::UserAccountService::findById(
                session.user_id,
                [onUser, onFailure](std::optional<services::UserRecord> user) {
                    if (!user.has_value()) {
                        Value err;
                        err["error"] = "Not Found";
                        err["message"] = "User record not found.";
                        err["status"] = 404;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k404NotFound);
                        onFailure(resp);
                        return;
                    }
                    onUser(*user);
                });
        },
        [onFailure](const drogon::HttpResponsePtr& denied) { onFailure(denied); });
}

} // namespace

void CreditsController::purse(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    withSignedInUser(
        req,
        [callback](const services::UserRecord& user) {
            // Read from the live PolarIS row, exactly as `credits.php` read
            // `$user->user("credits")` — not from the ledger. The ledger records
            // what changed and when; the row is the balance of record. Deriving
            // the balance from the ledger would silently disagree with the hotel
            // the moment the emulator changes credits itself.
            Value root;
            root["status"] = "ok";
            root["credits"] = user.credits;
            root["pixels"] = user.pixels;
            root["points"] = user.points;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(drogon::k200OK);
            callback(resp);
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void CreditsController::history(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    withSignedInUser(
        req,
        [callback](const services::UserRecord& user) {
            // `listForUser` takes the id from the session, never from the
            // request: there is no query parameter a caller could use to ask for
            // another account's ledger, so IDOR is structurally absent here
            // rather than checked for.
            services::TransactionService::listForUser(
                user.id,
                kHistoryLimit,
                [callback](std::vector<services::TransactionRecord> rows) {
                    Value items(Json::arrayValue);
                    for (const auto& row : rows) {
                        Value item;
                        item["id"] = row.id;
                        item["type"] = row.type;
                        item["amount"] = row.amount;
                        item["balance_after"] = row.balance_after;
                        item["description"] = row.description;
                        item["reference_id"] = row.reference_id;
                        item["created_at"] = static_cast<Json::UInt64>(row.created_at);
                        items.append(item);
                    }

                    Value root;
                    root["status"] = "ok";
                    root["items"] = items;
                    root["count"] = static_cast<Json::UInt>(rows.size());
                    root["limit"] = kHistoryLimit;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void CreditsController::clientEntry(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    withSignedInUser(
        req,
        [req, callback](const services::UserRecord& user) {
            // Read the client settings first. They live in the website's own
            // `phpretro_site_settings` table, so they are a website-side fact and
            // can be verified here; whether the emulator then accepts the ticket
            // is emulator behaviour and is not claimed.
            struct Settings {
                std::map<std::string, std::string> values;
                int remaining = 4;
                bool clientDcrPresent = false;
            };
            auto state = std::make_shared<Settings>();

            auto finishIfDone = [state, req, callback, userId = user.id]() {
                if (--state->remaining > 0) return;

                const std::string& host = state->values[kSettingHotelIp];
                const std::string& port = state->values[kSettingHotelPort];
                const std::string& mus = state->values[kSettingHotelMus];
                const std::string& dcr = state->values[kSettingClientDcr];

                // A setting that is absent *or present but empty* is the same
                // fact to a client: nothing to connect to. Both are reported, and
                // neither is papered over with a placeholder — the plan forbids
                // shipping a control that silently no-ops, and a handoff page
                // claiming "Enter the hotel" over a blank host would be exactly
                // that.
                Json::Value missing(Json::arrayValue);
                if (host.empty()) missing.append(kSettingHotelIp);
                if (port.empty()) missing.append(kSettingHotelPort);
                if (mus.empty()) missing.append(kSettingHotelMus);
                if (dcr.empty()) missing.append(kSettingClientDcr);

                const bool ready = host.empty() == false && port.empty() == false;

                // Issue a fresh ticket on every request. The legacy page did the
                // same (`new HoloUser($user->name, $user->password, true)` writes
                // a new `auth_ticket`), so a ticket is single-use-ish rather than
                // a long-lived credential sitting in a page.
                const std::string ticket = utils::Crypto::generateSsoTicket();
                services::UserAccountService::generateAuthTicket(
                    userId,
                    ticket,
                    req->peerAddr().toIp(),
                    [callback, state, host, port, mus, dcr, ticket, ready, missing](
                        bool stored
                    ) {
                        Value root;
                        root["status"] = "ok";
                        // Named for what it means: the website has everything it
                        // needs to hand a visitor to a client. It is NOT a claim
                        // that a client exists, is running, or accepts this
                        // ticket.
                        root["handoff_ready"] = ready;
                        root["handoff_available"] = ready && stored;
                        root["sso_ticket"] = stored ? ticket : "";
                        root["missing_settings"] = missing;

                        Value connection;
                        connection["host"] = host;
                        connection["port"] = port;
                        connection["mus_port"] = mus;
                        connection["client_asset"] = dcr;
                        root["connection"] = connection;

                        // Two separate facts, so they are stated separately: whether
                        // the ticket was stored is about this request, and whether a
                        // handoff is offered is about the stack's configuration. One
                        // sentence covering both read as a contradiction when the
                        // ticket stored fine and the configuration was still absent.
                        root["notes"] =
                            std::string(stored
                                            ? "An SSO ticket was issued and stored in "
                                              "users.auth_ticket."
                                            : "The SSO ticket could not be stored, so no ticket "
                                              "is available.") +
                            (ready
                                 ? " The hotel connection settings are present."
                                 : " The hotel connection settings are not configured, so no "
                                   "handoff is offered; see missing_settings.") +
                            " Whether the hotel client accepts the ticket is emulator "
                            "behaviour and is not verified by this application.";

                        auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                        resp->setStatusCode(drogon::k200OK);
                        callback(resp);
                    });
            };

            for (const char* key : {kSettingHotelIp, kSettingHotelPort, kSettingHotelMus,
                                    kSettingClientDcr}) {
                services::ContentService::getSetting(
                    key,
                    [state, key, finishIfDone](std::optional<std::string> value) mutable {
                        state->values[key] = value.value_or("");
                        finishIfDone();
                    });
            }
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

} // namespace hotel::controllers
