#include "filters/CsrfPublicFilter.h"
#include "services/SessionManager.h"
#include <json/json.h>

using Json::Value;

namespace hotel::filters {

void CsrfPublicFilter::doFilter(
    const drogon::HttpRequestPtr& req,
    drogon::FilterCallback&& fcb,
    drogon::FilterChainCallback&& fccb
) {
    // The account routes this guards are POST-only, but a preflight or a health
    // probe must not be answered with a 403 from here.
    const auto method = req->method();
    if (method == drogon::Get || method == drogon::Head || method == drogon::Options) {
        fccb();
        return;
    }

    if (!req->getHeader(services::SessionManager::CSRF_HEADER_NAME).empty()) {
        fccb();
        return;
    }

    Value err;
    err["error"] = "Forbidden";
    err["message"] = "CSRF header missing.";
    err["status"] = 403;
    auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
    resp->setStatusCode(drogon::k403Forbidden);
    fcb(resp);
}

} // namespace hotel::filters
