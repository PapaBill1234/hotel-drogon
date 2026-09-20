#pragma once

// Phase 4 public content API: /api/public/* plus the RSS feed.
//
// These endpoints are anonymous (no session required) and therefore expose
// only published/visible content. Raw markup fields (banner `html`) are never
// included here — see ContentService::listBanners, which does not populate it.
//
// The RSS feed is served at both the legacy path (/articles/rss.xml) and an
// API path so existing feed readers keep working through the cutover.

#include <drogon/HttpController.h>

namespace hotel::controllers {

class PublicContentController : public drogon::HttpController<PublicContentController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PublicContentController::landing,      "/api/public/landing",      drogon::Get);
    ADD_METHOD_TO(PublicContentController::news,         "/api/public/news",         drogon::Get);
    ADD_METHOD_TO(PublicContentController::newsItem,     "/api/public/news/{id}",    drogon::Get);
    ADD_METHOD_TO(PublicContentController::faq,          "/api/public/faq",          drogon::Get);
    ADD_METHOD_TO(PublicContentController::collectibles, "/api/public/collectibles", drogon::Get);
    ADD_METHOD_TO(PublicContentController::banners,      "/api/public/banners",      drogon::Get);
    ADD_METHOD_TO(PublicContentController::campaigns,    "/api/public/campaigns",    drogon::Get);
    ADD_METHOD_TO(PublicContentController::maintenance,  "/api/public/maintenance",  drogon::Get);
    ADD_METHOD_TO(PublicContentController::settings,     "/api/public/settings",     drogon::Get);

    // RSS: legacy path kept for feed-reader compatibility.
    ADD_METHOD_TO(PublicContentController::rss, "/api/public/rss",    drogon::Get);
    ADD_METHOD_TO(PublicContentController::rss, "/articles/rss.xml",  drogon::Get);
    METHOD_LIST_END

    void landing(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void news(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void newsItem(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);
    void faq(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void collectibles(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void banners(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void campaigns(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void maintenance(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void settings(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void rss(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
};

}  // namespace hotel::controllers
