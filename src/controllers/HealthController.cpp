#include "controllers/HealthController.h"
#include "utils/Logger.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <atomic>

namespace hotel::controllers {

static std::atomic<uint64_t> s_requestCount{0};

HealthController::HealthController()
    : m_startTime(std::chrono::steady_clock::now()) {
}

void HealthController::healthCheck(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    ++s_requestCount;

    auto now = std::chrono::steady_clock::now();
    auto uptimeSeconds = std::chrono::duration_cast<std::chrono::seconds>(now - m_startTime).count();

    Json::Value root;
    root["status"] = "ok";
    root["service"] = "hotel-drogon";
    root["uptime_seconds"] = static_cast<Json::UInt64>(uptimeSeconds);

    // Check DB client if configured
    bool dbOk = false;
    try {
        auto dbClient = drogon::app().getDbClient("default");
        if (dbClient) {
            dbOk = true;
        }
    } catch (...) {
        dbOk = false;
    }
    root["database"] = dbOk ? "connected" : "idle";

    // Check Redis client if configured
    bool redisOk = false;
    try {
        auto redisClient = drogon::app().getRedisClient("default");
        if (redisClient) {
            redisOk = true;
        }
    } catch (...) {
        redisOk = false;
    }
    root["redis"] = redisOk ? "connected" : "idle";

    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    callback(resp);
}

void HealthController::metrics(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    auto now = std::chrono::steady_clock::now();
    auto uptimeSeconds = std::chrono::duration_cast<std::chrono::seconds>(now - m_startTime).count();

    std::string metricsOutput;
    metricsOutput += "# HELP hotel_uptime_seconds Total server uptime in seconds\n";
    metricsOutput += "# TYPE hotel_uptime_seconds gauge\n";
    metricsOutput += "hotel_uptime_seconds " + std::to_string(uptimeSeconds) + "\n\n";

    metricsOutput += "# HELP hotel_http_requests_total Total number of HTTP requests\n";
    metricsOutput += "# TYPE hotel_http_requests_total counter\n";
    metricsOutput += "hotel_http_requests_total " + std::to_string(s_requestCount.load()) + "\n\n";

    metricsOutput += "# HELP hotel_service_up Status of hotel service\n";
    metricsOutput += "# TYPE hotel_service_up gauge\n";
    metricsOutput += "hotel_service_up 1\n";

    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k200OK);
    resp->setContentTypeCode(drogon::CT_TEXT_PLAIN);
    resp->setBody(std::move(metricsOutput));
    resp->addHeader("Access-Control-Allow-Origin", "*");
    callback(resp);
}

} // namespace hotel::controllers
