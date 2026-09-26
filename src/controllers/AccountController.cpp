#include "controllers/AccountController.h"
#include "services/UserAccountService.h"
#include "filters/AuthPolicy.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

namespace {

/**
 * Profile field limits, taken from legacy `profile.php` and the PolarIS `users`
 * schema rather than invented:
 *
 *   if (mb_strlen($motto) > 127 || mb_strlen($look) > 256
 *       || !in_array($gender, ['M','F'], true)) { $notice = 'Invalid profile details.'; }
 *
 * The legacy page **rejected** out-of-range input and **trimmed** accepted input
 * before measuring and storing it. The handlers below used to truncate the motto
 * to 128 bytes and silently coerce an unknown gender to `M`; both were behaviour
 * changes from legacy, and the truncation could cut a multibyte motto
 * mid-character. They now reject, with the legacy message.
 *
 * `kLookMaxChars` is one *less* than legacy's 256, and that is not a weakening:
 * `users.look` is `varchar(255)` in PolarIS, so a 256-character figure exceeds
 * what the column can hold and the write fails at the database either way.
 * Rejecting it here turns a database error into the same explicit 400 the other
 * invalid values get. The limit can only be relaxed by widening a PolarIS column,
 * which the plan's rule 1 forbids changing for convenience.
 */
constexpr std::size_t kMottoMaxChars = 127;
constexpr std::size_t kLookMaxChars = 255;

/** Legacy `profile.php`'s single failure notice, used for validation rejections. */
void replyInvalidProfileDetails(
    const std::function<void(const drogon::HttpResponsePtr&)>& callback
) {
    Value err;
    err["error"] = "Bad Request";
    err["message"] = "Invalid profile details.";
    err["status"] = 400;
    auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
    resp->setStatusCode(drogon::k400BadRequest);
    callback(resp);
}

/** Legacy `profile.php` ran `trim()` on both fields before validating them. */
std::string trimmed(const std::string& value) {
    const auto begin = value.find_first_not_of(" \t\n\r\f\v");
    if (begin == std::string::npos) {
        return "";
    }
    const auto end = value.find_last_not_of(" \t\n\r\f\v");
    return value.substr(begin, end - begin + 1);
}

} // namespace

void AccountController::updateMotto(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("motto") || !(*json)["motto"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'motto' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newMotto = trimmed((*json)["motto"].asString());
            if (newMotto.length() > kMottoMaxChars) {
                replyInvalidProfileDetails(callback);
                return;
            }

            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateMotto(
                session.user_id,
                newMotto,
                ip,
                [newMotto, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["motto"] = newMotto;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

void AccountController::updateLook(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("look") || !(*json)["look"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'look' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newLook = trimmed((*json)["look"].asString());

            // Legacy required a gender of exactly M or F when submitted. The
            // field is optional here because the API also serves callers that
            // only change the figure; when it IS supplied it must be valid.
            std::string newGender = "M";
            if (json->isMember("gender") && (*json)["gender"].isString()) {
                newGender = (*json)["gender"].asString();
                if (newGender != "M" && newGender != "F") {
                    replyInvalidProfileDetails(callback);
                    return;
                }
            }

            if (newLook.length() > kLookMaxChars) {
                replyInvalidProfileDetails(callback);
                return;
            }
            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateLook(
                session.user_id,
                newLook,
                newGender,
                ip,
                [newLook, newGender, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["look"] = newLook;
                    root["gender"] = newGender;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

void AccountController::updateEmail(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("email") || !(*json)["email"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'email' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newEmail = (*json)["email"].asString();
            if (newEmail.find('@') == std::string::npos) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Invalid email format.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateEmail(
                session.user_id,
                newEmail,
                ip,
                [newEmail, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["email"] = newEmail;
                    root["mail_verified"] = false;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

void AccountController::changePassword(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("current_password") || !json->isMember("new_password")) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Current password and new password are required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string currentPass = (*json)["current_password"].asString();
            std::string newPass = (*json)["new_password"].asString();

            if (newPass.length() < 6) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "New password must be at least 6 characters.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string ip = req->peerAddr().toIp();

            services::UserAccountService::authenticate(
                session.username,
                currentPass,
                ip,
                [session, newPass, ip, callback](services::AuthResult authResult) {
                    if (!authResult.success) {
                        Value err;
                        err["error"] = "Unauthorized";
                        err["message"] = "Current password does not match.";
                        err["status"] = 401;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k401Unauthorized);
                        callback(resp);
                        return;
                    }

                    services::UserAccountService::changePassword(
                        session.user_id,
                        newPass,
                        ip,
                        [callback](bool success, const std::string& error) {
                            if (!success) {
                                Value err;
                                err["error"] = "Update Failed";
                                err["message"] = error;
                                err["status"] = 400;
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                                resp->setStatusCode(drogon::k400BadRequest);
                                callback(resp);
                                return;
                            }

                            Value root;
                            root["status"] = "ok";
                            root["message"] = "Password successfully changed.";
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                            resp->setStatusCode(drogon::k200OK);
                            callback(resp);
                        }
                    );
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

} // namespace hotel::controllers
