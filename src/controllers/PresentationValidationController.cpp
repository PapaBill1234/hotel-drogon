#include "controllers/PresentationValidationController.h"

#include "filters/AuthPolicy.h"
#include "services/PresentationDraftPolicy.h"
#include "services/PresentationValidationService.h"
#include <json/json.h>

namespace hotel::controllers {
namespace {

drogon::HttpResponsePtr response(Json::Value value, drogon::HttpStatusCode status) {
    value["status"] = static_cast<int>(status);
    auto result = drogon::HttpResponse::newHttpJsonResponse(value);
    result->setStatusCode(status);
    return result;
}

Json::Value error(const services::PresentationValidationResult& result) {
    Json::Value value;
    value["error"] = "Invalid presentation document";
    value["code"] = static_cast<int>(result.code);
    value["field"] = result.field;
    value["message"] = result.message;
    return value;
}

}  // namespace

void PresentationValidationController::validate(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, callback](const services::StaffSessionData&) mutable {
            const auto json = req->getJsonObject();
            if (!json || !json->isObject() || !json->isMember("kind") ||
                !(*json)["kind"].isString() || !json->isMember("document")) {
                Json::Value value;
                value["error"] = "Bad Request";
                value["message"] = "kind and document are required.";
                callback(response(std::move(value), drogon::k400BadRequest));
                return;
            }

            const auto kind = (*json)["kind"].asString();
            services::PresentationValidationResult result;
            const auto sizeResult = services::PresentationDraftPolicy::validatePayloadSize((*json)["document"]);
            if (!sizeResult.ok) {
                result = sizeResult;
            } else if (kind == "navigation") {
                result = services::PresentationValidationService::validateNavigation((*json)["document"]);
            } else if (kind == "page") {
                result = services::PresentationValidationService::validatePage((*json)["document"]);
            } else {
                Json::Value value;
                value["error"] = "Bad Request";
                value["message"] = "kind must be navigation or page.";
                callback(response(std::move(value), drogon::k400BadRequest));
                return;
            }

            if (!result.ok) {
                callback(response(error(result), drogon::k400BadRequest));
                return;
            }
            Json::Value value;
            value["message"] = "Presentation document is valid.";
            value["read_only"] = true;
            callback(response(std::move(value), drogon::k200OK));
        },
        [callback](const drogon::HttpResponsePtr& denied) mutable {
            callback(denied);
        });
}

}  // namespace hotel::controllers
