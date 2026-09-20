#pragma once

// Phase 4 admin CMS API: /api/admin/* for website-owned content.
//
// Authorization: handlers call filters::AuthPolicy explicitly (the project's
// established pattern — Drogon filters only enforce "is logged in", role
// checks are explicit function calls). Ordinary content writes need staff rank
// >= 5. Banner writes that carry raw markup need the separate high-trust
// capability (rank >= 7) and the response always carries a warning.
//
// Every mutating route registers hotel::filters::CsrfFilter, enforced by
// scripts/check_csrf_rules.py.

#include <drogon/HttpController.h>

namespace hotel::controllers {

class AdminContentController : public drogon::HttpController<AdminContentController> {
public:
    METHOD_LIST_BEGIN
    // --- news ---
    ADD_METHOD_TO(AdminContentController::listNews,   "/api/admin/news",      drogon::Get);
    ADD_METHOD_TO(AdminContentController::createNews, "/api/admin/news",      drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::updateNews, "/api/admin/news/{id}", drogon::Put, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::deleteNews, "/api/admin/news/{id}", drogon::Delete, "hotel::filters::CsrfFilter");

    // --- faq ---
    ADD_METHOD_TO(AdminContentController::listFaq,    "/api/admin/faq",      drogon::Get);
    ADD_METHOD_TO(AdminContentController::createFaq,  "/api/admin/faq",      drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::updateFaq,  "/api/admin/faq/{id}", drogon::Put, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::deleteFaq,  "/api/admin/faq/{id}", drogon::Delete, "hotel::filters::CsrfFilter");

    // --- collectibles ---
    ADD_METHOD_TO(AdminContentController::listCollectibles,   "/api/admin/collectibles",      drogon::Get);
    ADD_METHOD_TO(AdminContentController::createCollectible,  "/api/admin/collectibles",      drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::deleteCollectible,  "/api/admin/collectibles/{id}", drogon::Delete, "hotel::filters::CsrfFilter");

    // --- banners (high-trust on raw `html`) ---
    ADD_METHOD_TO(AdminContentController::listBanners,   "/api/admin/banners",      drogon::Get);
    ADD_METHOD_TO(AdminContentController::createBanner,  "/api/admin/banners",      drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::updateBanner,  "/api/admin/banners/{id}", drogon::Put, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::deleteBanner,  "/api/admin/banners/{id}", drogon::Delete, "hotel::filters::CsrfFilter");

    // --- campaigns ---
    ADD_METHOD_TO(AdminContentController::listCampaigns,  "/api/admin/campaigns",      drogon::Get);
    ADD_METHOD_TO(AdminContentController::createCampaign, "/api/admin/campaigns",      drogon::Post, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::updateCampaign, "/api/admin/campaigns/{id}", drogon::Put, "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(AdminContentController::deleteCampaign, "/api/admin/campaigns/{id}", drogon::Delete, "hotel::filters::CsrfFilter");

    // --- site settings ---
    ADD_METHOD_TO(AdminContentController::listSettings, "/api/admin/settings", drogon::Get);
    ADD_METHOD_TO(AdminContentController::setSetting,   "/api/admin/settings", drogon::Put, "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    void listNews(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void createNews(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void updateNews(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);
    void deleteNews(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);

    void listFaq(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void createFaq(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void updateFaq(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);
    void deleteFaq(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);

    void listCollectibles(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void createCollectible(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void deleteCollectible(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);

    void listBanners(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void createBanner(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void updateBanner(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);
    void deleteBanner(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);

    void listCampaigns(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void createCampaign(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void updateCampaign(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);
    void deleteCampaign(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb, const std::string& id);

    void listSettings(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
    void setSetting(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& cb);
};

}  // namespace hotel::controllers
