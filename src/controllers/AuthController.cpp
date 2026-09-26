#include "controllers/AuthController.h"
#include "services/UserAccountService.h"
#include "services/SessionManager.h"
#include "services/BanService.h"
#include "services/ContentService.h"
#include "filters/AuthPolicy.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <json/json.h>
#include <chrono>

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

    // The anonymous header's checkbox is `_login_remember_me` with value "true";
    // the JSON field keeps the legacy name so the two cannot drift.
    // `HoloUser`'s constructor took `$rememberme` and only issued a token when it
    // was exactly "true", so any other value means "do not remember".
    const bool rememberMe =
        json->isMember("_login_remember_me") && (*json)["_login_remember_me"].asString() == "true";

    services::UserAccountService::authenticate(
        username,
        password,
        ip,
        [req, rememberMe, callback](services::AuthResult result) {
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
                [user, rememberMe, callback](std::optional<services::UserSessionData> session) {
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

                    if (!rememberMe) {
                        callback(resp);
                        return;
                    }

                    // Issue the remember-me pair. Everything about the shape is
                    // legacy: the token format, storing only its SHA-256 digest,
                    // the `site_cookie_time` lifetime, and the two cookie names.
                    const std::string rememberToken = utils::Crypto::generateRememberToken();
                    const std::string rememberHash = utils::Crypto::sha256(rememberToken);

                    services::ContentService::getSetting(
                        "site_cookie_time",
                        [callback, resp, rememberToken, rememberHash,
                         userId = user.id](std::optional<std::string> setting) {
                            const uint32_t days = services::UserAccountService::rememberMeDays(
                                setting.value_or(""));
                            const auto expiresAt = static_cast<uint64_t>(
                                std::chrono::duration_cast<std::chrono::seconds>(
                                    std::chrono::system_clock::now().time_since_epoch())
                                    .count()) +
                                                   static_cast<uint64_t>(days) * 86400;
                            const int maxAge = static_cast<int>(days) * 86400;

                            services::UserAccountService::setRememberToken(
                                userId,
                                rememberHash,
                                expiresAt,
                                [callback, resp, rememberToken, maxAge, userId](bool stored) {
                                    if (!stored) {
                                        // The password was right and the session
                                        // exists; only the long-lived token failed.
                                        // The login still succeeds — refusing it
                                        // would be worse than not remembering — but
                                        // no cookie is set, so the client is not
                                        // told it will be remembered.
                                        HOTEL_LOG_WARN(
                                            "login: remember-me token could not be stored for "
                                            "user id {}; signing in without it",
                                            userId);
                                        callback(resp);
                                        return;
                                    }

                                    drogon::Cookie flagCookie(
                                        services::SessionManager::REMEMBER_FLAG_COOKIE_NAME, "true");
                                    flagCookie.setPath("/");
                                    // Readable, because the client tests it to
                                    // decide whether to attempt a token login at
                                    // all — the role the legacy front controller
                                    // played when it read `$_COOKIE['rememberme']`.
                                    flagCookie.setHttpOnly(false);
                                    flagCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                                    flagCookie.setMaxAge(maxAge);

                                    drogon::Cookie tokenCookie(
                                        services::SessionManager::REMEMBER_TOKEN_COOKIE_NAME,
                                        rememberToken);
                                    tokenCookie.setPath("/");
                                    // HttpOnly, unlike the flag: nothing in the
                                    // browser needs to read the credential itself,
                                    // and the legacy site's exposure of it to
                                    // script is not a property worth reproducing.
                                    tokenCookie.setHttpOnly(true);
                                    tokenCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                                    tokenCookie.setMaxAge(maxAge);

                                    resp->addCookie(std::move(flagCookie));
                                    resp->addCookie(std::move(tokenCookie));
                                    callback(resp);
                                });
                        });
                }
            );
        }
    );
}

void AuthController::rememberLogin(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    // The legacy front controller only consulted the token when the request was
    // anonymous AND the flag cookie said to: `$user->error == 1 &&
    // ($_COOKIE['rememberme'] ?? '') == "true"`. Both conditions are checked here,
    // so a stray token cookie without its flag does nothing.
    const std::string flag = req->getCookie(services::SessionManager::REMEMBER_FLAG_COOKIE_NAME);
    const std::string token = req->getCookie(services::SessionManager::REMEMBER_TOKEN_COOKIE_NAME);

    auto deny = [callback]() {
        Value err;
        err["error"] = "Unauthorized";
        err["message"] = "Remember-me token is invalid or has expired.";
        err["status"] = 401;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k401Unauthorized);

        // Clear the pair on any failure, as legacy did when its lookup missed:
        // the cookie is worthless now, and leaving it makes the client retry a
        // dead credential on every page load.
        drogon::Cookie clearFlag(services::SessionManager::REMEMBER_FLAG_COOKIE_NAME, "");
        clearFlag.setPath("/");
        clearFlag.setMaxAge(0);
        drogon::Cookie clearToken(services::SessionManager::REMEMBER_TOKEN_COOKIE_NAME, "");
        clearToken.setPath("/");
        clearToken.setMaxAge(0);
        resp->addCookie(std::move(clearFlag));
        resp->addCookie(std::move(clearToken));
        callback(resp);
    };

    if (flag != "true" || token.empty()) {
        deny();
        return;
    }

    // Only the digest is compared: the column holds SHA-256 hex, never the token.
    const std::string tokenHash = utils::Crypto::sha256(token);

    services::UserAccountService::findByRememberToken(
        tokenHash,
        [req, callback, deny, tokenHash](std::optional<services::UserRecord> user) {
            if (!user.has_value()) {
                deny();
                return;
            }

            // `loginFromToken` checked `IsUserBanned` before accepting a token, so
            // a ban that landed after the token was issued cannot be bypassed by
            // it. `findByRememberToken` applies the same check through the same
            // service the login path uses.
            services::BanService::checkUserBan(
                user->id,
                [req, callback, deny, tokenHash, record = *user](services::BanCheckResult ban) {
                    if (ban.isBanned) {
                        Value err;
                        err["error"] = "Forbidden";
                        err["message"] = "Account is banned: " + ban.reason;
                        err["status"] = 403;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k403Forbidden);
                        callback(resp);
                        return;
                    }

                    services::SessionManager::createUserSession(
                        record,
                        req->peerAddr().toIp(),
                        [callback, deny, record,
                         req](std::optional<services::UserSessionData> session) {
                            if (!session.has_value()) {
                                deny();
                                return;
                            }

                            // The heart of the legacy design: a token restores the
                            // session but does NOT grant entry. `security_check.php`
                            // set `$_SESSION['reauthenticate'] = "true"` here, and
                            // `client.php` refused the hotel until the password was
                            // proved again.
                            services::SessionManager::setReauthRequired(
                                session->token,
                                true,
                                [callback, session, record](bool flagged) {
                                    if (!flagged) {
                                        // A session that cannot be marked is worse
                                        // than no session: it would look fully
                                        // privileged. Destroy it and refuse.
                                        services::SessionManager::destroyUserSession(
                                            session->token, [](bool) {});
                                        Value err;
                                        err["error"] = "Internal Server Error";
                                        err["message"] =
                                            "Could not establish a step-up session.";
                                        err["status"] = 500;
                                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                                        resp->setStatusCode(drogon::k500InternalServerError);
                                        callback(resp);
                                        return;
                                    }

                                    // Spend the token: the digest is cleared, so it
                                    // cannot establish a second session. The client
                                    // keeps a valid session cookie and is sent to
                                    // the step-up screen.
                                    services::UserAccountService::clearRememberToken(
                                        record.id, [](bool) {});

                                    Value root;
                                    root["status"] = "ok";
                                    root["user"] = userToJson(record);
                                    root["csrf_token"] = session->csrf_token;
                                    root["reauth_required"] = true;

                                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                                    resp->setStatusCode(drogon::k200OK);

                                    drogon::Cookie userCookie(
                                        services::SessionManager::USER_COOKIE_NAME, session->token);
                                    userCookie.setPath("/");
                                    userCookie.setHttpOnly(true);
                                    userCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                                    userCookie.setMaxAge(static_cast<int>(
                                        services::SessionManager::USER_SESSION_TTL_SEC));
                                    resp->addCookie(std::move(userCookie));

                                    drogon::Cookie xsrfCookie(
                                        services::SessionManager::CSRF_COOKIE_NAME,
                                        session->csrf_token);
                                    xsrfCookie.setPath("/");
                                    xsrfCookie.setHttpOnly(false);
                                    xsrfCookie.setSameSite(drogon::Cookie::SameSite::kLax);
                                    xsrfCookie.setMaxAge(static_cast<int>(
                                        services::SessionManager::USER_SESSION_TTL_SEC));
                                    resp->addCookie(std::move(xsrfCookie));

                                    // The token is spent, so its cookies go too.
                                    drogon::Cookie clearFlag(
                                        services::SessionManager::REMEMBER_FLAG_COOKIE_NAME, "");
                                    clearFlag.setPath("/");
                                    clearFlag.setMaxAge(0);
                                    drogon::Cookie clearToken(
                                        services::SessionManager::REMEMBER_TOKEN_COOKIE_NAME, "");
                                    clearToken.setPath("/");
                                    clearToken.setMaxAge(0);
                                    resp->addCookie(std::move(clearFlag));
                                    resp->addCookie(std::move(clearToken));

                                    HOTEL_LOG_INFO(
                                        "rememberLogin: session restored for user id {}; step-up "
                                        "required",
                                        record.id);
                                    callback(resp);
                                });
                        });
                });
        });
}

void AuthController::logout(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    std::string token = req->getCookie(services::SessionManager::USER_COOKIE_NAME);

    // Read the session before destroying it, because the remember-me digest is
    // keyed by user id and clearing it is what makes a deliberate sign-out end
    // the long-lived credential too. Legacy only cleared the cookies; leaving the
    // stored digest live would mean a copied cookie still worked after the user
    // had signed out — a session the user cannot end.
    services::SessionManager::getUserSession(
        token,
        [req, callback, token](std::optional<services::UserSessionData> session) {
            const uint32_t userId = session.has_value() ? session->user_id : 0;

            auto sendLoggedOut = [req, callback]() {
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

                // The remember-me pair goes with the session, whatever the client
                // sent: after a sign-out the browser should hold neither cookie.
                drogon::Cookie clearFlag(services::SessionManager::REMEMBER_FLAG_COOKIE_NAME, "");
                clearFlag.setPath("/");
                clearFlag.setMaxAge(0);
                resp->addCookie(std::move(clearFlag));

                drogon::Cookie clearRemember(services::SessionManager::REMEMBER_TOKEN_COOKIE_NAME,
                                             "");
                clearRemember.setPath("/");
                clearRemember.setMaxAge(0);
                resp->addCookie(std::move(clearRemember));

                callback(resp);
            };

            services::SessionManager::destroyUserSession(
                token,
                [req, userId, sendLoggedOut](bool /*success*/) {
                    if (userId == 0) {
                        // No session to attribute the token to. The cookies are
                        // still cleared, which is what the caller asked for.
                        sendLoggedOut();
                        return;
                    }
                    services::UserAccountService::clearRememberToken(
                        userId,
                        [req, userId, sendLoggedOut](bool /*cleared*/) {
                            // Signing out ends the client credential as well as
                            // the browser session. Waiting for the ticket's own
                            // deadline would leave a captured ticket usable after
                            // the user had deliberately signed out — the same
                            // reasoning that clears the remember-me digest above.
                            // A failure here does not fail the sign-out: the
                            // session is already gone, and the ticket still has
                            // its scheduled void.
                            services::UserAccountService::voidIssuedAuthTicket(
                                userId,
                                "logout",
                                req->peerAddr().toIp(),
                                [sendLoggedOut](bool /*voided*/) { sendLoggedOut(); });
                        });
                });
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
                // The step-up flag, reported here as well as on
                // `/api/account/session`. Every guarded page already fetches
                // `/api/me`, so without this a client would need a second request
                // just to learn whether it may render anything — and the guard
                // that decides that would be reading a value it did not ask for.
                root["reauth_required"] = session.reauth_required;
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
