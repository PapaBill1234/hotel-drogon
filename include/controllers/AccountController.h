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
    // Legacy `forgot.php` handled two POST actions on one page: recover a
    // password (`actionForgot`) and list the names on an address (`actionList`).
    // They are separate routes here because they are separate decisions with
    // separate failure modes.
    //
    // `CsrfPublicFilter`, not `CsrfFilter`: these routes exist precisely for a
    // caller with no session, and `CsrfFilter` validates against a session. The
    // substitute requires a custom header, which a cross-origin request cannot
    // set without a preflight this application does not answer. See that filter's
    // header for what it does and does not verify.
    ADD_METHOD_TO(AccountController::forgotPassword, "/api/auth/password/forgot", drogon::Post, "hotel::filters::CsrfPublicFilter");
    ADD_METHOD_TO(AccountController::resetPassword, "/api/auth/password/reset", drogon::Post, "hotel::filters::CsrfPublicFilter");
    ADD_METHOD_TO(AccountController::listAccounts, "/api/auth/username/forgot", drogon::Post, "hotel::filters::CsrfPublicFilter");
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

    /** `POST /api/auth/password/forgot` — request a reset for an account. */
    void forgotPassword(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `POST /api/auth/password/reset` — spend a reset token and set a password. */
    void resetPassword(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `POST /api/auth/username/forgot` — list the account names on an address. */
    void listAccounts(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
