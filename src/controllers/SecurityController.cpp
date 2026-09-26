#include "controllers/SecurityController.h"
#include "filters/AuthPolicy.h"
#include "services/SessionManager.h"
#include "services/UserAccountService.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

void SecurityController::session(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [callback](const services::UserSessionData& session) {
            Value root;
            root["status"] = "ok";
            root["user_id"] = session.user_id;
            root["username"] = session.username;
            // The legacy `$_SESSION['reauthenticate']` flag, reported rather than
            // enforced: the SPA routes itself to the step-up screen on true, and
            // the server enforces the requirement wherever it matters.
            root["reauth_required"] = session.reauth_required;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(drogon::k200OK);
            callback(resp);
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void SecurityController::reauth(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    auto json = req->getJsonObject();
    if (!json || !json->isMember("password") || !(*json)["password"].isString()) {
        Value err;
        err["error"] = "Bad Request";
        err["message"] = "Field 'password' is required.";
        err["status"] = 400;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    const std::string password = (*json)["password"].asString();

    filters::AuthPolicy::requireUser(
        req,
        [req, password, callback](const services::UserSessionData& session) {
            // `reauthenticate.php` re-ran the full password check against the
            // account rather than comparing to anything already in the session,
            // which is the only way a step-up proves anything. Same here, through
            // the same service method login uses, so a password that would not
            // pass login cannot pass step-up either.
            services::UserAccountService::authenticate(
                session.username,
                password,
                req->peerAddr().toIp(),
                [session, callback](services::AuthResult result) {
                    if (!result.success) {
                        Value err;
                        err["error"] = "Unauthorized";
                        err["message"] = "Password does not match.";
                        err["status"] = 401;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k401Unauthorized);
                        callback(resp);
                        return;
                    }

                    services::SessionManager::setReauthRequired(
                        session.token,
                        false,
                        [callback](bool cleared) {
                            Value root;
                            if (!cleared) {
                                // The password was right but the flag could not be
                                // cleared: reporting success would let the client
                                // believe a step-up happened that did not.
                                root["error"] = "Internal Server Error";
                                root["message"] = "Could not clear the reauthentication flag.";
                                root["status"] = 500;
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                                resp->setStatusCode(drogon::k500InternalServerError);
                                callback(resp);
                                return;
                            }
                            root["status"] = "ok";
                            root["reauth_required"] = false;
                            root["message"] = "Reauthenticated.";
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                            resp->setStatusCode(drogon::k200OK);
                            callback(resp);
                        });
                });
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

} // namespace hotel::controllers
