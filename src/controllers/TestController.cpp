#include "controllers/TestController.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

void TestController::echoJson(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    if (req->method() == drogon::Options) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k200OK);
        callback(resp);
        return;
    }

    std::string ct = req->getHeader("content-type");
    std::string cl = req->getHeader("content-length");
    HOTEL_LOG_INFO("Content-Type header: {}", ct.empty() ? "NOT SET" : ct);
    HOTEL_LOG_INFO("Content-Length: {}", cl.empty() ? "NOT SET" : cl);
    HOTEL_LOG_INFO("Body length: {}", req->bodyLength());

    std::string body = std::string(req->getBody());
    HOTEL_LOG_INFO("Raw body: {}", body);
    
    // Log raw bytes for debugging
    std::string hexDump;
    for (unsigned char c : body) {
        hexDump += fmt::format("{:02x} ", c);
    }
    HOTEL_LOG_INFO("Raw bytes: {}", hexDump);

    auto json = req->getJsonObject();
    if (!json) {
        HOTEL_LOG_ERROR("Failed to parse JSON payload - getJsonObject() returned null");
        Value err;
        err["error"] = "Bad Request";
        err["message"] = "Invalid or missing JSON payload.";
        err["status"] = 400;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    Value root;
    root["status"] = "ok";
    root["received"] = *json;
    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
    resp->setStatusCode(drogon::k200OK);
    callback(resp);
}

} // namespace hotel::controllers
