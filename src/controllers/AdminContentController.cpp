#include "controllers/AdminContentController.h"
#include "filters/AuthPolicy.h"
#include "services/ContentService.h"
#include "utils/Logger.h"
#include <json/json.h>
#include <string>

using Json::Value;
using hotel::services::ContentResult;

namespace hotel::controllers {

namespace {

// ------------------------------------------------------------- responses

drogon::HttpResponsePtr errResp(drogon::HttpStatusCode code, const std::string& error,
                                const std::string& message, const std::string& field = "") {
    Value v;
    v["error"] = error;
    v["message"] = message;
    v["status"] = static_cast<int>(code);
    if (!field.empty()) v["field"] = field;
    auto r = drogon::HttpResponse::newHttpJsonResponse(v);
    r->setStatusCode(code);
    return r;
}

drogon::HttpResponsePtr okResp(Value v) {
    v["status"] = "ok";
    return drogon::HttpResponse::newHttpJsonResponse(v);
}

const char* kHighTrustWarning =
    "This content is raw HTML/script markup and is rendered WITHOUT escaping. "
    "Only trusted administrators should edit it.";

void finish(const ContentResult& r, const std::string& okMessage, bool highTrustWrite,
            std::function<void(const drogon::HttpResponsePtr&)> cb) {
    if (!r.ok) {
        cb(errResp(drogon::k400BadRequest, "Bad Request", r.error, r.field));
        return;
    }
    Value v;
    v["message"] = okMessage;
    if (r.id != 0) v["id"] = r.id;
    if (highTrustWrite) {
        v["high_trust"] = true;
        v["warning"] = kHighTrustWarning;
    }
    cb(okResp(v));
}

bool parseId(const std::string& s, uint32_t& out) {
    if (s.empty()) return false;
    try {
        size_t pos = 0;
        unsigned long v = std::stoul(s, &pos);
        if (pos != s.size()) return false;
        out = static_cast<uint32_t>(v);
        return true;
    } catch (...) {
        return false;
    }
}

// Type-tolerant readers: the admin UI may send numbers as strings.
std::string str(const Value& v, const char* key, const std::string& def = "") {
    if (!v.isMember(key) || v[key].isNull()) return def;
    if (v[key].isString()) return v[key].asString();
    if (v[key].isBool()) return v[key].asBool() ? "1" : "0";
    if (v[key].isInt64() || v[key].isUInt64() || v[key].isInt() || v[key].isUInt()) {
        return std::to_string(v[key].asLargestInt());
    }
    return def;
}

bool boolean(const Value& v, const char* key, bool def) {
    if (!v.isMember(key) || v[key].isNull()) return def;
    if (v[key].isBool()) return v[key].asBool();
    if (v[key].isString()) {
        const std::string s = v[key].asString();
        return s == "1" || s == "true" || s == "TRUE" || s == "yes";
    }
    if (v[key].isIntegral()) return v[key].asLargestInt() != 0;
    return def;
}

int64_t integer(const Value& v, const char* key, int64_t def) {
    if (!v.isMember(key) || v[key].isNull()) return def;
    if (v[key].isIntegral()) return v[key].asLargestInt();
    if (v[key].isString()) {
        try { return std::stoll(v[key].asString()); } catch (...) { return def; }
    }
    return def;
}

// -------------------------------------------------------- serialisation

Value newsJson(const services::NewsArticle& a) {
    Value v;
    v["id"] = a.id;
    v["title"] = a.title;
    v["summary"] = a.summary;
    v["story"] = a.story;
    v["author"] = a.author;
    v["categories"] = a.categories;
    v["images"] = a.images;
    v["time"] = static_cast<Json::UInt64>(a.time);
    return v;
}

Value faqJson(const services::FaqEntry& f) {
    Value v;
    v["id"] = f.id;
    v["category"] = f.category;
    v["question"] = f.question;
    v["answer"] = f.answer;
    v["sort_order"] = f.sort_order;
    v["active"] = f.active;
    return v;
}

Value collectibleJson(const services::Collectible& c) {
    Value v;
    v["id"] = c.id;
    v["name"] = c.name;
    v["description"] = c.description;
    v["image"] = c.image;
    v["time"] = static_cast<Json::UInt64>(c.time);
    return v;
}

Value bannerJson(const services::Banner& b, bool includeRawHtml) {
    Value v;
    v["id"] = b.id;
    v["text"] = b.text;
    v["banner"] = b.banner;
    v["url"] = b.url;
    v["status"] = b.status;
    v["advanced"] = b.advanced;
    v["sort_order"] = b.sort_order;
    if (includeRawHtml) v["html"] = b.html;
    if (b.advanced || includeRawHtml) {
        v["high_trust"] = true;
        v["warning"] = kHighTrustWarning;
    }
    return v;
}

Value campaignJson(const services::Campaign& c) {
    Value v;
    v["id"] = c.id;
    v["name"] = c.name;
    v["desc"] = c.desc;
    v["image"] = c.image;
    v["url"] = c.url;
    v["visible"] = c.visible;
    v["sort_order"] = c.sort_order;
    return v;
}

// ------------------------------------------------------------- parsers

services::NewsArticle newsFromJson(const Value& v) {
    services::NewsArticle a;
    a.title = str(v, "title");
    a.summary = str(v, "summary");
    a.story = str(v, "story");
    a.author = str(v, "author");
    a.categories = str(v, "categories");
    a.images = str(v, "images");
    a.time = static_cast<uint64_t>(integer(v, "time", 0));
    return a;
}

services::FaqEntry faqFromJson(const Value& v) {
    services::FaqEntry f;
    f.category = str(v, "category", "general");
    f.question = str(v, "question");
    f.answer = str(v, "answer");
    f.sort_order = static_cast<int32_t>(integer(v, "sort_order", 0));
    f.active = boolean(v, "active", true);
    return f;
}

services::Collectible collectibleFromJson(const Value& v) {
    services::Collectible c;
    c.name = str(v, "name");
    c.description = str(v, "description");
    c.image = str(v, "image");
    c.time = static_cast<uint64_t>(integer(v, "time", 0));
    return c;
}

services::Banner bannerFromJson(const Value& v) {
    services::Banner b;
    b.text = str(v, "text");
    b.banner = str(v, "banner");
    b.url = str(v, "url");
    b.status = boolean(v, "status", true);
    b.advanced = boolean(v, "advanced", false);
    b.html = str(v, "html");
    b.sort_order = static_cast<int32_t>(integer(v, "sort_order", 1));
    return b;
}

services::Campaign campaignFromJson(const Value& v) {
    services::Campaign c;
    c.name = str(v, "name");
    c.desc = str(v, "desc", str(v, "description"));
    c.image = str(v, "image");
    c.url = str(v, "url");
    c.visible = boolean(v, "visible", true);
    c.sort_order = static_cast<int32_t>(integer(v, "sort_order", 1));
    return c;
}

std::string clientIp(const drogon::HttpRequestPtr& req) {
    return req->peerAddr().toIp();
}

}  // namespace

// =================================================================== news

void AdminContentController::listNews(const drogon::HttpRequestPtr& req,
                                      std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb](const services::StaffSessionData&) {
            uint32_t limit = 20, offset = 0;
            if (req->getParameter("limit").size()) {
                try { limit = static_cast<uint32_t>(std::stoul(req->getParameter("limit"))); } catch (...) {}
            }
            if (req->getParameter("offset").size()) {
                try { offset = static_cast<uint32_t>(std::stoul(req->getParameter("offset"))); } catch (...) {}
            }
            services::ContentService::listNews(
                limit, offset,
                [cb](std::vector<services::NewsArticle> items) {
                    Value out(Json::arrayValue);
                    for (const auto& a : items) out.append(newsJson(a));
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::createNews(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body](const services::StaffSessionData& session) {
            auto article = newsFromJson(*body);
            services::ContentService::publishNews(
                session.user_id, article, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "News article published.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::updateNews(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                        const std::string& id) {
    uint32_t newsId = 0;
    if (!parseId(id, newsId)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body, newsId](const services::StaffSessionData& session) {
            auto article = newsFromJson(*body);
            article.id = newsId;
            services::ContentService::updateNews(
                session.user_id, article, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "News article updated.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::deleteNews(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                        const std::string& id) {
    uint32_t newsId = 0;
    if (!parseId(id, newsId)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, newsId](const services::StaffSessionData& session) {
            services::ContentService::deleteNews(
                session.user_id, newsId, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "News article deleted.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

// ==================================================================== faq

void AdminContentController::listFaq(const drogon::HttpRequestPtr& req,
                                     std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [cb](const services::StaffSessionData&) {
            services::ContentService::listFaq(
                false,
                [cb](std::vector<services::FaqEntry> items) {
                    Value out(Json::arrayValue);
                    for (const auto& f : items) out.append(faqJson(f));
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::createFaq(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body](const services::StaffSessionData& session) {
            services::ContentService::createFaq(
                session.user_id, faqFromJson(*body), clientIp(req),
                [cb](const ContentResult& r) { finish(r, "FAQ entry created.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::updateFaq(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                       const std::string& id) {
    uint32_t faqId = 0;
    if (!parseId(id, faqId)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body, faqId](const services::StaffSessionData& session) {
            auto entry = faqFromJson(*body);
            entry.id = faqId;
            services::ContentService::updateFaq(
                session.user_id, entry, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "FAQ entry updated.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::deleteFaq(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                       const std::string& id) {
    uint32_t faqId = 0;
    if (!parseId(id, faqId)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, faqId](const services::StaffSessionData& session) {
            services::ContentService::deleteFaq(
                session.user_id, faqId, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "FAQ entry deleted.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

// =========================================================== collectibles

void AdminContentController::listCollectibles(const drogon::HttpRequestPtr& req,
                                              std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [cb](const services::StaffSessionData&) {
            services::ContentService::listCollectibles(
                [cb](std::vector<services::Collectible> items) {
                    Value out(Json::arrayValue);
                    for (const auto& c : items) out.append(collectibleJson(c));
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::createCollectible(const drogon::HttpRequestPtr& req,
                                               std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body](const services::StaffSessionData& session) {
            services::ContentService::createCollectible(
                session.user_id, collectibleFromJson(*body), clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Collectible created.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::updateCollectible(const drogon::HttpRequestPtr& req,
                                               std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                               const std::string& id) {
    uint32_t cid = 0;
    if (!parseId(id, cid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body, cid](const services::StaffSessionData& session) {
            auto item = collectibleFromJson(*body);
            item.id = cid;
            services::ContentService::updateCollectible(
                session.user_id, item, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Collectible updated.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::deleteCollectible(const drogon::HttpRequestPtr& req,
                                               std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                               const std::string& id) {
    uint32_t cid = 0;
    if (!parseId(id, cid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, cid](const services::StaffSessionData& session) {
            services::ContentService::deleteCollectible(
                session.user_id, cid, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Collectible deleted.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

// ================================================================ banners

void AdminContentController::listBanners(const drogon::HttpRequestPtr& req,
                                         std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    // Reading raw markup is itself a high-trust operation, so the full record
    // (including `html`) requires the elevated capability. Ordinary staff can
    // still list banners, but without the raw markup.
    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb](const services::StaffSessionData& session) {
            const bool highTrust = session.rank >= filters::kHighTrustMinRank;
            services::ContentService::listBanners(
                false,
                [cb, highTrust](std::vector<services::Banner> items) {
                    Value out(Json::arrayValue);
                    for (const auto& b : items) out.append(bannerJson(b, highTrust));
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    v["raw_html_included"] = highTrust;
                    if (!highTrust) {
                        v["notice"] =
                            "Raw HTML is omitted; the high-trust content permission is "
                            "required to view or edit it.";
                    }
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::createBanner(const drogon::HttpRequestPtr& req,
                                          std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    const services::Banner banner = bannerFromJson(*body);
    const bool highTrust = services::ContentService::bannerRequiresHighTrust(banner);

    // Escalate the permission requirement when the payload carries raw markup.
    auto onGranted = [req, cb, banner, highTrust](const services::StaffSessionData& session) mutable {
        services::ContentService::createBanner(
            session.user_id, banner, highTrust, clientIp(req),
            [cb, highTrust](const ContentResult& r) {
                finish(r, "Banner created.", highTrust, cb);
            });
    };
    auto onDenied = [cb](const drogon::HttpResponsePtr& denied) mutable { cb(denied); };

    if (highTrust) {
        filters::AuthPolicy::requireHighTrust(req, std::move(onGranted), std::move(onDenied));
    } else {
        filters::AuthPolicy::requireStaff(req, 5, std::move(onGranted), std::move(onDenied));
    }
}

void AdminContentController::updateBanner(const drogon::HttpRequestPtr& req,
                                          std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                          const std::string& id) {
    uint32_t bid = 0;
    if (!parseId(id, bid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    services::Banner banner = bannerFromJson(*body);
    banner.id = bid;
    const bool highTrust = services::ContentService::bannerRequiresHighTrust(banner);

    auto onGranted = [req, cb, banner, highTrust](const services::StaffSessionData& session) mutable {
        services::ContentService::updateBanner(
            session.user_id, banner, highTrust, clientIp(req),
            [cb, highTrust](const ContentResult& r) {
                finish(r, "Banner updated.", highTrust, cb);
            });
    };
    auto onDenied = [cb](const drogon::HttpResponsePtr& denied) mutable { cb(denied); };

    if (highTrust) {
        filters::AuthPolicy::requireHighTrust(req, std::move(onGranted), std::move(onDenied));
    } else {
        filters::AuthPolicy::requireStaff(req, 5, std::move(onGranted), std::move(onDenied));
    }
}

void AdminContentController::deleteBanner(const drogon::HttpRequestPtr& req,
                                          std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                          const std::string& id) {
    uint32_t bid = 0;
    if (!parseId(id, bid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, bid](const services::StaffSessionData& session) {
            services::ContentService::deleteBanner(
                session.user_id, bid, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Banner deleted.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

// ============================================================== campaigns

void AdminContentController::listCampaigns(const drogon::HttpRequestPtr& req,
                                           std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [cb](const services::StaffSessionData&) {
            services::ContentService::listCampaigns(
                [cb](std::vector<services::Campaign> items) {
                    Value out(Json::arrayValue);
                    for (const auto& c : items) out.append(campaignJson(c));
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::createCampaign(const drogon::HttpRequestPtr& req,
                                            std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body](const services::StaffSessionData& session) {
            services::ContentService::createCampaign(
                session.user_id, campaignFromJson(*body), clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Campaign created.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::updateCampaign(const drogon::HttpRequestPtr& req,
                                            std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                            const std::string& id) {
    uint32_t cid = 0;
    if (!parseId(id, cid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, body, cid](const services::StaffSessionData& session) {
            auto c = campaignFromJson(*body);
            c.id = cid;
            services::ContentService::updateCampaign(
                session.user_id, c, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Campaign updated.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::deleteCampaign(const drogon::HttpRequestPtr& req,
                                            std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                            const std::string& id) {
    uint32_t cid = 0;
    if (!parseId(id, cid)) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid id.")); return; }

    filters::AuthPolicy::requireStaff(
        req, 5,
        [req, cb, cid](const services::StaffSessionData& session) {
            services::ContentService::deleteCampaign(
                session.user_id, cid, clientIp(req),
                [cb](const ContentResult& r) { finish(r, "Campaign deleted.", false, cb); });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

// ========================================================= site settings

void AdminContentController::listSettings(const drogon::HttpRequestPtr& req,
                                          std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    filters::AuthPolicy::requireStaff(
        req, 5,
        [cb](const services::StaffSessionData&) {
            services::ContentService::listSettings(
                [cb](std::vector<services::SiteSetting> items) {
                    Value out(Json::arrayValue);
                    for (const auto& s : items) {
                        Value v;
                        v["key"] = s.key;
                        v["value"] = s.value;
                        out.append(v);
                    }
                    Value v;
                    v["items"] = out;
                    v["count"] = static_cast<Json::UInt>(items.size());
                    cb(okResp(v));
                });
        },
        [cb](const drogon::HttpResponsePtr& denied) { cb(denied); });
}

void AdminContentController::setSetting(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    auto body = req->getJsonObject();
    if (!body) { cb(errResp(drogon::k400BadRequest, "Bad Request", "Invalid JSON payload.")); return; }
    if (!body->isMember("key")) {
        cb(errResp(drogon::k400BadRequest, "Bad Request", "key is required.", "key"));
        return;
    }
    const std::string key = str(*body, "key");
    const std::string value = str(*body, "value");

    // Raw markup in a setting (tracking snippets, banner HTML) is high-trust.
    const bool highTrust = services::ContentService::bannerRequiresHighTrust(
        services::Banner{0, "", "", "", true, false, value, 1});

    auto onGranted = [req, cb, key, value, highTrust](const services::StaffSessionData& session) mutable {
        services::ContentService::setSetting(
            session.user_id, key, value, clientIp(req),
            [cb, highTrust](const ContentResult& r) {
                finish(r, "Setting updated.", highTrust, cb);
            });
    };
    auto onDenied = [cb](const drogon::HttpResponsePtr& denied) mutable { cb(denied); };

    if (highTrust) {
        filters::AuthPolicy::requireHighTrust(req, std::move(onGranted), std::move(onDenied));
    } else {
        filters::AuthPolicy::requireStaff(req, 5, std::move(onGranted), std::move(onDenied));
    }
}

}  // namespace hotel::controllers
