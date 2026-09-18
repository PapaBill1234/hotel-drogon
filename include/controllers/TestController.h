#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

class TestController : public drogon::HttpController<TestController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(TestController::echoJson, "/api/test/echo", drogon::Post, drogon::Options);
    METHOD_LIST_END

    void echoJson(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
