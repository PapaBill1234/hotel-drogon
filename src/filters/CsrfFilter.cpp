#include "filters/CsrfFilter.h"
#include "services/SessionManager.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::filters {

void CsrfFilter::doFilter(
    const drogon::HttpRequestPtr& req,
    drogon::FilterCallback&& fcb,
    drogon::FilterChainCallback&& fccb
) {
    auto method = req->method();

    if (method == drogon::Get || method == drogon::Head || method == drogon::Options) {
        fccb();
        return;
    }

    std::string path = req->path();
    if (path == "/api/auth/login" || path == "/api/auth/register" || path == "/api/auth/staff-login") {
        fccb();
        return;
    }

    std::string submittedCsrf = req->getHeader(services::SessionManager::CSRF_HEADER_NAME);
    if (submittedCsrf.empty()) {
        auto json = req->getJsonObject();
        if (json && json->isMember("csrf_token") && (*json)["csrf_token"].isString()) {
            submittedCsrf = (*json)["csrf_token"].asString();
        } else {
            submittedCsrf = req->getParameter("csrf_token");
        }
    }

    if (submittedCsrf.empty()) {
        Value err;
        err["error"] = "Forbidden";
        err["message"] = "CSRF token missing.";
        err["status"] = 403;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k403Forbidden);
        fcb(resp);
        return;
    }

    std::string sessionToken = req->getCookie(services::SessionManager::USER_COOKIE_NAME);
    if (sessionToken.empty()) {
        sessionToken = req->getCookie(services::SessionManager::STAFF_COOKIE_NAME);
    }

    if (sessionToken.empty()) {
        Value err;
        err["error"] = "Forbidden";
        err["message"] = "No active session for CSRF verification.";
        err["status"] = 403;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
        resp->setStatusCode(drogon::k403Forbidden);
        fcb(resp);
        return;
    }

    services::SessionManager::getUserSession(
        sessionToken,
        [req, submittedCsrf, fcb = std::move(fcb), fccb = std::move(fccb)](std::optional<services::UserSessionData> session) mutable {
            if (session.has_value() && utils::Crypto::constantTimeEquals(session->csrf_token, submittedCsrf)) {
                req->attributes()->insert("user_session", *session);
                fccb();
            } else {
                Value err;
                err["error"] = "Forbidden";
                err["message"] = "CSRF token validation failed.";
                err["status"] = 403;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k403Forbidden);
                fcb(resp);
            }
        }
    );
}

} // namespace hotel::filters
