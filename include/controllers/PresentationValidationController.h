#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

/** Read-only validation seam for v4 editor clients; it never persists a document. */
class PresentationValidationController
    : public drogon::HttpController<PresentationValidationController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PresentationValidationController::validate,
                  "/api/admin/presentation/validate", drogon::Post,
                  "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    void validate(const drogon::HttpRequestPtr& req,
                  std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};

}  // namespace hotel::controllers
