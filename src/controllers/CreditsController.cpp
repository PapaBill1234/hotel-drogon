#include "controllers/CreditsController.h"
#include "filters/AuthPolicy.h"
#include "services/TransactionService.h"
#include "services/UserAccountService.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

namespace {

/** `history.php`'s own cap: `ORDER BY created_at DESC, id DESC LIMIT 100`. */
constexpr uint32_t kHistoryLimit = 100;

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

} // namespace hotel::controllers
