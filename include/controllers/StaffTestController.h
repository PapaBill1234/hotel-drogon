#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

class StaffTestController : public drogon::HttpController<StaffTestController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(StaffTestController::testGate, "/api/admin/test-gate", drogon::Get);
    ADD_METHOD_TO(StaffTestController::banUser, "/api/admin/bans", drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(StaffTestController::revokeBan, "/api/admin/bans/revoke", drogon::Post, "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    void testGate(
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
