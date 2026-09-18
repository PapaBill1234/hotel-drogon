#pragma once

#include <drogon/HttpController.h>
#include <chrono>

namespace hotel::controllers {

class HealthController : public drogon::HttpController<HealthController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(HealthController::healthCheck, "/health", drogon::Get, drogon::Options);
        ADD_METHOD_TO(HealthController::healthCheck, "/api/health", drogon::Get, drogon::Options);
        ADD_METHOD_TO(HealthController::metrics, "/metrics", drogon::Get, drogon::Options);
    METHOD_LIST_END

    HealthController();

    void healthCheck(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    void metrics(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

private:
    std::chrono::steady_clock::time_point m_startTime;
};

} // namespace hotel::controllers
