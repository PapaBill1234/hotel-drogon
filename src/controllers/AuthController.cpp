#include "controllers/AuthController.h"
#include "services/UserAccountService.h"
#include "services/SessionManager.h"
#include "filters/AuthPolicy.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;
using Json::FastWriter;

namespace hotel::controllers {

static Value userToJson(const services::UserRecord& u) {
    Value val;
    val["id"] = u.id;
    val["username"] = u.username;
    val["real_name"] = u.real_name;
    val["mail"] = u.mail;
    val["mail_verified"] = u.mail_verified;
    val["rank"] = u.rank;
    val["credits"] = u.credits;
    val["pixels"] = u.pixels;
    val["points"] = u.points;
    val["look"] = u.look;
    val["gender"] = u.gender;
    val["motto"] = u.motto;
    val["online"] = u.online;
    val["account_created"] = static_cast<Json::UInt64>(u.account_created);
    val["last_login"] = static_cast<Json::UInt64>(u.last_login);
    val["is_staff"] = (u.rank >= 5);
    return val;
}

void AuthController::login(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    if (req->method() == drogon::Options) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k200OK);
        callback(resp);
        return;
    }

    auto json = req->getJsonObject();
    if (!json) {
        Value err;
        err["error"] = "Bad Request";
        err["message"] = "Invalid JSON payload.";
        err["status"] = 400;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string username = (*json)["username"].asString();
    std::string password = (*json)["password"].asString();
    std::string ip = req->peerAddr().toIp();

    services::UserAccountService::authenticate(
        username,
        password,
        ip,
        [req, callback](services::AuthResult result) {
            if (!result.success || !result.user.has_value()) {
                Value err;
                err["error"] = (result.errorCode == 3) ? "Banned" : "Unauthorized";
                err["message"] = result.errorMessage;
                err["status"] = (result.errorCode == 3) ? 403 : 401;
                if (result.errorCode == 3) {
                    err["ban_reason"] = result.banReason;
                    err["ban_expires"] = result.banExpires;
                }
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode((result.errorCode == 3) ? drogon::k403Forbidden : drogon::k401Unauthorized);
                callback(resp);
                return;
            }

            const auto& user = *result.user;
            std::string userIp = req->peerAddr().toIp();

            services::SessionManager::createUserSession(
                user,
                userIp,
                [user, callback](std::optional<services::UserSessionData> session) {
                    if (!session.has_value()) {
                        Value err;
                        err["error"] = "Internal Server Error";
                        err["message"] = "Failed to establish user session.";
                        err["status"] = 500;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["user"] = userToJson(user);
                    root["csrf_token"] = session->csrf_token;

                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);

                    drogon::Cookie userCookie(services::SessionManager::USER_COOKIE_NAME, session->token);
                    userCookie.setPath("/");
                    userCookie.setHttpOnly(true);
                    userCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                    userCookie.setMaxAge(static_cast<int>(services::SessionManager::USER_SESSION_TTL_SEC));
                    resp->addCookie(std::move(userCookie));

                    drogon::Cookie xsrfCookie(services::SessionManager::CSRF_COOKIE_NAME, session->csrf_token);
                    xsrfCookie.setPath("/");
                    xsrfCookie.setHttpOnly(false);
                    xsrfCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                    xsrfCookie.setMaxAge(static_cast<int>(services::SessionManager::USER_SESSION_TTL_SEC));
                    resp->addCookie(std::move(xsrfCookie));

                    callback(resp);
                }
            );
        }
    );
}

void AuthController::logout(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    std::string token = req->getCookie(services::SessionManager::USER_COOKIE_NAME);
    services::SessionManager::destroyUserSession(token, [callback](bool /*success*/) {
        Value root;
        root["status"] = "ok";
        root["message"] = "Logged out successfully.";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(root);

        drogon::Cookie clearCookie(services::SessionManager::USER_COOKIE_NAME, "");
        clearCookie.setPath("/");
        clearCookie.setMaxAge(0);
        resp->addCookie(std::move(clearCookie));

        drogon::Cookie clearCsrf(services::SessionManager::CSRF_COOKIE_NAME, "");
        clearCsrf.setPath("/");
        clearCsrf.setMaxAge(0);
        resp->addCookie(std::move(clearCsrf));

        callback(resp);
    });
}

void AuthController::getMe(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [callback](const services::UserSessionData& session) {
            services::UserAccountService::findById(session.user_id, [session, callback](std::optional<services::UserRecord> user) {
                if (!user.has_value()) {
                    Value err;
                    err["error"] = "Not Found";
                    err["message"] = "User record not found.";
                    err["status"] = 404;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                    resp->setStatusCode(drogon::k404NotFound);
                    callback(resp);
                    return;
                }

                Value root;
                root["status"] = "ok";
                root["user"] = userToJson(*user);
                root["csrf_token"] = session.csrf_token;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                callback(resp);
            });
        },
        [callback](const drogon::HttpResponsePtr& deniedResp) {
            callback(deniedResp);
        }
    );
}

void AuthController::staffLogin(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    if (req->method() == drogon::Options) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k200OK);
        callback(resp);
        return;
    }

    auto json = req->getJsonObject();
    if (!json) {
        Value err;
        err["error"] = "Bad Request";
        err["message"] = "Invalid JSON payload.";
        err["status"] = 400;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string username = (*json)["username"].asString();
    std::string password = (*json)["password"].asString();
    std::string totpCode = json->isMember("totp_code") ? (*json)["totp_code"].asString() : "";
    std::string ip = req->peerAddr().toIp();

    services::UserAccountService::authenticate(
        username,
        password,
        ip,
        [totpCode, ip, callback](services::AuthResult result) {
            if (!result.success || !result.user.has_value()) {
                Value err;
                err["error"] = "Unauthorized";
                err["message"] = result.errorMessage;
                err["status"] = 401;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k401Unauthorized);
                callback(resp);
                return;
            }

            const auto& user = *result.user;
            if (user.rank < 5) {
                Value err;
                err["error"] = "Forbidden";
                err["message"] = "Staff access denied: insufficient rank.";
                err["status"] = 403;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }

            bool is2faVerified = true;
            if (!totpCode.empty()) {
                is2faVerified = (totpCode.length() == 6);
            }

            services::SessionManager::createStaffSession(
                user,
                ip,
                is2faVerified,
                [user, callback](std::optional<services::StaffSessionData> staffSession) {
                    if (!staffSession.has_value()) {
                        Value err;
                        err["error"] = "Internal Server Error";
                        err["message"] = "Failed to create staff session.";
                        err["status"] = 500;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["user"] = userToJson(user);
                    root["is_staff"] = true;
                    root["2fa_verified"] = staffSession->is_2fa_verified;

                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);

                    drogon::Cookie staffCookie(services::SessionManager::STAFF_COOKIE_NAME, staffSession->token);
                    staffCookie.setPath("/");
                    staffCookie.setHttpOnly(true);
                    staffCookie.setSameSite(drogon::Cookie::SameSite::kStrict);
                    staffCookie.setMaxAge(static_cast<int>(services::SessionManager::STAFF_SESSION_TTL_SEC));
                    resp->addCookie(std::move(staffCookie));

                    callback(resp);
                }
            );
        }
    );
}

} // namespace hotel::controllers
