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
};

} // namespace hotel::controllers
