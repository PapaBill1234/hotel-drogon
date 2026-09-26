#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

class AuthController : public drogon::HttpController<AuthController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(AuthController::login, "/api/auth/login", drogon::Post, drogon::Options);
    ADD_METHOD_TO(AuthController::logout, "/api/auth/logout", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AuthController::getMe, "/api/me", drogon::Get);
    ADD_METHOD_TO(AuthController::staffLogin, "/api/auth/staff-login", drogon::Post, drogon::Options);
    // The consume side of remember-me. Legacy had no such route: `core.php`
    // redirected a request that was anonymous but carried the remember-me cookies
    // to `/security_check_token` (a rewrite of `security_check.php?type=token`).
    // A decoupled SPA has no server-side redirect to hook, so the client calls
    // this when it finds itself signed out while holding a token.
    ADD_METHOD_TO(AuthController::rememberLogin, "/api/auth/remember-login", drogon::Post);
    METHOD_LIST_END

    void login(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void logout(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void getMe(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void staffLogin(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /**
     * `POST /api/auth/remember-login` — establish a session from the
     * `rememberme_token` cookie.
     *
     * The session it creates carries `reauth_required = true`, which is the whole
     * point of the legacy design: a token restored the session but did not grant
     * entry to the hotel, so the holder still had to prove the password.
     */
    void rememberLogin(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
