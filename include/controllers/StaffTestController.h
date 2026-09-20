#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

class StaffTestController : public drogon::HttpController<StaffTestController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(StaffTestController::testGate, "/api/admin/test-gate", drogon::Get);
    // Session introspection for the React admin UI. The legacy housekeeping
    // pages re-checked the staff session server-side on every request
    // (includes/hksession.php); a decoupled SPA has no such hook, so it needs
    // one read-only endpoint that reports the *staff* session it actually
    // holds. Passwordless and idempotent by design: the UI calls it on every
    // load and must not have to replay a password to find out who it is.
    ADD_METHOD_TO(StaffTestController::session, "/api/admin/session", drogon::Get);
    ADD_METHOD_TO(StaffTestController::banUser, "/api/admin/bans", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(StaffTestController::revokeBan, "/api/admin/bans/revoke", drogon::Post, "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    void testGate(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void session(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void banUser(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void revokeBan(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
