#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

class AccountController : public drogon::HttpController<AccountController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(AccountController::updateMotto, "/api/account/motto", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AccountController::updateLook, "/api/account/look", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AccountController::updateEmail, "/api/account/email", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AccountController::changePassword, "/api/account/password", drogon::Post, "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    void updateMotto(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void updateLook(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void updateEmail(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void changePassword(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
