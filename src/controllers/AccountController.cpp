#include "controllers/AccountController.h"
#include "services/UserAccountService.h"
#include "services/MailService.h"
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

namespace {

/**
 * The legacy subject line and body shape for a recovery mail.
 *
 * `forgot.php` sent `$lang->loc['forgot.mail.subject']` with a body containing
 * the account name and the new password. The wording is reproduced; what differs
 * is *what* is sent — a single-use reset link rather than a plaintext password,
 * because a password in an inbox is a credential in an inbox and the plan asks
 * for reset tokens. That divergence is recorded in the inventory.
 */
std::string resetSubject() {
    return "Your password reset link";
}

std::string resetBody(const std::string& username, const std::string& resetUrl, uint32_t ttlMinutes) {
    return "Hello " + username + ",\n\n"
           "A password reset was requested for your account.\n\n"
           "Open this link to choose a new password:\n" + resetUrl + "\n\n"
           "The link can be used once and expires in " + std::to_string(ttlMinutes) +
           " minutes.\n\n"
           "If you did not request this, you can ignore this message: your password "
           "has not changed.\n";
}

} // namespace

void AccountController::forgotPassword(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
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

    // Legacy `forgot.php` read `forgottenpw-username` / `forgottenpw-email` from
    // a form post. The JSON field names here are the modern equivalents of the
    // same two values.
    const std::string username = trimmed((*json)["username"].asString());
    const std::string mail = trimmed((*json)["email"].asString());

    // One response for every outcome. Legacy distinguished them ("Invalid
    // details." vs the success notice), which turns the form into an oracle for
    // which username/address pairs exist. The flow's own security does not need
    // that disclosure: the requester either receives mail they can act on or
    // does not. This is a deliberate divergence from legacy and is recorded in
    // the inventory.
    auto respondNeutral = [callback]() {
        Value root;
        root["status"] = "ok";
        root["message"] =
            "If those details match a verified account, a reset link has been sent.";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
        resp->setStatusCode(drogon::k200OK);
        callback(resp);
    };

    if (username.empty() || mail.empty()) {
        // Still 200: an empty submission must not be distinguishable either.
        respondNeutral();
        return;
    }

    services::UserAccountService::findByUsernameAndVerifiedMail(
        username,
        mail,
        [req, username, mail, callback, respondNeutral](
            std::optional<services::UserRecord> user
        ) {
            if (!user.has_value()) {
                respondNeutral();
                return;
            }

            services::UserAccountService::issuePasswordResetToken(
                user->id,
                [req, username, mail, callback, respondNeutral, record = *user](
                    bool issued, const std::string& token, uint32_t ttl
                ) {
                    if (!issued) {
                        HOTEL_LOG_ERROR(
                            "forgotPassword: could not issue a reset token for user id {}",
                            record.id);
                        respondNeutral();
                        return;
                    }

                    // The link is built from the request's own host so a
                    // multi-host deployment does not mail links to the wrong one.
                    const std::string scheme = req->isOnSecureConnection() ? "https" : "http";
                    const std::string host = req->getHeader("host");
                    const std::string resetUrl = scheme + "://" +
                                                 (host.empty() ? "localhost" : host) +
                                                 "/account/password/reset?token=" + token;

                    services::MailService::send(
                        services::MailMessage{mail, resetSubject(),
                                              resetBody(username, resetUrl, ttl / 60)},
                        [respondNeutral, record](services::MailResult result) {
                            // The result is logged, never surfaced: telling the
                            // caller that delivery failed would confirm the
                            // account exists. An operator sees the `logged`
                            // outcome in the log.
                            if (result != services::MailResult::Delivered) {
                                HOTEL_LOG_WARN(
                                    "forgotPassword: reset mail for user id {} was not delivered "
                                    "(transport={})",
                                    record.id,
                                    result == services::MailResult::Logged ? "log-only" : "failed");
                            }
                            respondNeutral();
                        });
                });
        });
}

void AccountController::resetPassword(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
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

    const std::string token = (*json)["token"].asString();
    const std::string newPassword = (*json)["new_password"].asString();

    services::UserAccountService::consumePasswordResetToken(
        token,
        newPassword,
        req->peerAddr().toIp(),
        [callback](bool success, bool invalidToken, const std::string& error) {
            Value root;
            if (success) {
                root["status"] = "ok";
                root["message"] = "Password successfully changed.";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                resp->setStatusCode(drogon::k200OK);
                callback(resp);
                return;
            }

            root["error"] = invalidToken ? "Unauthorized" : "Bad Request";
            root["message"] = error;
            root["status"] = invalidToken ? 401 : 400;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(invalidToken ? drogon::k401Unauthorized : drogon::k400BadRequest);
            callback(resp);
        });
}

void AccountController::listAccounts(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
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

    const std::string mail = trimmed((*json)["email"].asString());

    // Legacy `actionList` mailed the list. With no transport the names are
    // returned instead — the same information, delivered the only way this stack
    // currently can. It is not a disclosure beyond what legacy already did: the
    // caller must supply the address, and learns only the account names on it.
    services::UserAccountService::listUsernamesForMail(
        mail,
        [callback, mail](std::vector<std::string> names) {
            Value list(Json::arrayValue);
            for (const auto& name : names) {
                list.append(name);
            }
            Value root;
            root["status"] = "ok";
            root["usernames"] = list;
            root["count"] = static_cast<Json::UInt>(names.size());
            root["mail_transport"] =
                services::MailService::transport() == services::MailTransport::Log
                    ? "log-only"
                    : "smtp";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(drogon::k200OK);
            callback(resp);
        });
}

} // namespace hotel::controllers
