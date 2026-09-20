#include "controllers/PublicContentController.h"
#include "services/ContentService.h"
#include "utils/Logger.h"
#include <json/json.h>
#include <ctime>
#include <string>
#include <vector>

using Json::Value;

namespace hotel::controllers {

namespace {

// ------------------------------------------------------------ escaping

// Escape for XML text/attribute content. APPLIED EXACTLY ONCE per value.
//
// The legacy xml/rss.php escaped the title twice — once when reading the row
// into $row['title'] and again when echoing it — so a title containing '&'
// rendered as "&amp;amp;". Escaping is centralised here and every call site
// passes raw unescaped data, which is what makes "exactly once" auditable.
std::string xmlEscape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 16);
    for (const char c : in) {
        switch (c) {
            case '&':  out += "&amp;";  break;
            case '<':  out += "&lt;";   break;
            case '>':  out += "&gt;";   break;
            case '"':  out += "&quot;"; break;
            case '\'': out += "&apos;"; break;
            default:   out += c;        break;
        }
    }
    return out;
}

std::string rfc822(uint64_t t) {
    std::time_t tt = static_cast<std::time_t>(t);
    std::tm g{};
    gmtime_r(&tt, &g);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%a, %d %b %Y %H:%M:%S +0000", &g);
    return buf;
}

std::string iso8601(uint64_t t) {
    std::time_t tt = static_cast<std::time_t>(t);
    std::tm g{};
    gmtime_r(&tt, &g);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+00:00", &g);
    return buf;
}

Json::UInt64 asU64(uint64_t v) { return static_cast<Json::UInt64>(v); }

// ------------------------------------------------------------- responses

drogon::HttpResponsePtr json(Value v) {
    v["status"] = "ok";
    return drogon::HttpResponse::newHttpJsonResponse(v);
}

drogon::HttpResponsePtr notFound(const std::string& message) {
    Value v;
    v["error"] = "Not Found";
    v["message"] = message;
    v["status"] = 404;
    auto r = drogon::HttpResponse::newHttpJsonResponse(v);
    r->setStatusCode(drogon::k404NotFound);
    return r;
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

// Base URL for absolute links in the feed. Prefers the configured site_url
// setting, falls back to the request Host header.
using SettingMap = std::vector<services::SiteSetting>;

std::string settingOr(const SettingMap& s, const std::string& key, const std::string& def) {
    for (const auto& kv : s) {
        if (kv.key == key) return kv.value;
    }
    return def;
}

std::string baseUrl(const drogon::HttpRequestPtr& req, const SettingMap& settings) {
    std::string configured = settingOr(settings, "site_url", "");
    if (!configured.empty()) {
        while (!configured.empty() && configured.back() == '/') configured.pop_back();
        return configured;
    }
    std::string host = req->getHeader("host");
    if (host.empty()) host = "localhost";
    return "http://" + host;
}

}  // namespace

// ================================================================ landing

void PublicContentController::landing(const drogon::HttpRequestPtr& req,
                                      std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listPublicNews(5, [cb, req](std::vector<services::PublicNewsItem> items) {
        Value out(Json::arrayValue);
        for (const auto& n : items) {
            Value v;
            v["id"] = n.id;
            v["title"] = n.title;
            v["summary"] = n.summary;
            v["title_safe"] = n.title_safe;
            v["time"] = asU64(n.time);
            out.append(v);
        }
        services::ContentService::getSetting(
            "site_promo_phrases",
            [cb, out](std::optional<std::string> phrases) {
                Value v;
                v["news"] = out;
                // Legacy stored these pipe-separated and rendered index 1, 2, 0
                // in that order; the raw string is passed through for parity.
                v["promo_phrases_raw"] = phrases.value_or("");
                cb(json(v));
            });
    });
}

// =================================================================== news

void PublicContentController::news(const drogon::HttpRequestPtr& req,
                                   std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    uint32_t limit = 20;
    const std::string limitParam = req->getParameter("limit");
    if (!limitParam.empty()) {
        try { limit = static_cast<uint32_t>(std::stoul(limitParam)); } catch (...) {}
    }
    services::ContentService::listPublicNews(limit, [cb](std::vector<services::PublicNewsItem> items) {
        Value out(Json::arrayValue);
        for (const auto& n : items) {
            Value v;
            v["id"] = n.id;
            v["title"] = n.title;
            v["summary"] = n.summary;
            v["title_safe"] = n.title_safe;
            v["time"] = asU64(n.time);
            out.append(v);
        }
        Value v;
        v["items"] = out;
        v["count"] = static_cast<Json::UInt>(items.size());
        cb(json(v));
    });
}

void PublicContentController::newsItem(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                                       const std::string& id) {
    uint32_t newsId = 0;
    if (!parseId(id, newsId)) { cb(notFound("Article not found.")); return; }

    services::ContentService::getNewsById(newsId, [cb](std::optional<services::NewsArticle> a) {
        if (!a.has_value()) { cb(notFound("Article not found.")); return; }
        Value v;
        v["id"] = a->id;
        v["title"] = a->title;
        v["summary"] = a->summary;
        v["story"] = a->story;
        v["author"] = a->author;
        v["categories"] = a->categories;
        v["images"] = a->images;
        v["time"] = asU64(a->time);
        cb(json(v));
    });
}

// ==================================================================== faq

void PublicContentController::faq(const drogon::HttpRequestPtr& req,
                                  std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listFaq(true, [cb](std::vector<services::FaqEntry> items) {
        Value out(Json::arrayValue);
        for (const auto& f : items) {
            Value v;
            v["id"] = f.id;
            v["category"] = f.category;
            v["question"] = f.question;
            v["answer"] = f.answer;
            v["sort_order"] = f.sort_order;
            out.append(v);
        }
        Value v;
        v["items"] = out;
        v["count"] = static_cast<Json::UInt>(items.size());
        cb(json(v));
    });
}

// =========================================================== collectibles

void PublicContentController::collectibles(const drogon::HttpRequestPtr& req,
                                           std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listCollectibles([cb](std::vector<services::Collectible> items) {
        Value out(Json::arrayValue);
        for (const auto& c : items) {
            Value v;
            v["id"] = c.id;
            v["name"] = c.name;
            v["description"] = c.description;
            v["image"] = c.image;
            v["time"] = asU64(c.time);
            out.append(v);
        }
        Value v;
        v["items"] = out;
        v["count"] = static_cast<Json::UInt>(items.size());
        cb(json(v));
    });
}

// ================================================================ banners

void PublicContentController::banners(const drogon::HttpRequestPtr& req,
                                      std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    // visibleOnly = true, and the service never populates `html` here.
    services::ContentService::listBanners(true, [cb](std::vector<services::Banner> items) {
        Value out(Json::arrayValue);
        for (const auto& b : items) {
            Value v;
            v["id"] = b.id;
            v["text"] = b.text;
            v["banner"] = b.banner;
            v["url"] = b.url;
            v["sort_order"] = b.sort_order;
            // `html` is intentionally absent: raw markup is not published.
            out.append(v);
        }
        Value v;
        v["items"] = out;
        v["count"] = static_cast<Json::UInt>(items.size());
        cb(json(v));
    });
}

void PublicContentController::campaigns(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listCampaigns([cb](std::vector<services::Campaign> items) {
        Value out(Json::arrayValue);
        for (const auto& c : items) {
            if (!c.visible) continue;
            Value v;
            v["id"] = c.id;
            v["name"] = c.name;
            v["desc"] = c.desc;
            v["image"] = c.image;
            v["url"] = c.url;
            v["sort_order"] = c.sort_order;
            out.append(v);
        }
        Value v;
        v["items"] = out;
        v["count"] = out.size();
        cb(json(v));
    });
}

// ============================================================ maintenance

void PublicContentController::maintenance(const drogon::HttpRequestPtr& req,
                                          std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listSettings([cb](std::vector<services::SiteSetting> items) {
        std::string closed = "0", style = "0", twitter;
        for (const auto& s : items) {
            if (s.key == "site_closed") closed = s.value;
            else if (s.key == "maintenance_style") style = s.value;
            else if (s.key == "maintenance_twitter") twitter = s.value;
        }
        Value v;
        // Legacy maintenance.php redirected to "/" when site_closed was "0",
        // and to the "new" template when maintenance_style was "1".
        v["closed"] = (closed == "1");
        v["show_twitter"] = !twitter.empty();
        v["style"] = (style == "1") ? "new" : "classic";
        cb(json(v));
    });
}

void PublicContentController::settings(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listSettings([cb](std::vector<services::SiteSetting> items) {
        Value out;
        for (const auto& s : items) {
            // Never expose raw markup settings through the public API.
            if (services::ContentService::bannerRequiresHighTrust(
                    services::Banner{0, "", "", "", true, false, s.value, 1})) {
                continue;
            }
            out[s.key] = s.value;
        }
        Value v;
        v["settings"] = out;
        cb(json(v));
    });
}

// ==================================================================== rss

void PublicContentController::rss(const drogon::HttpRequestPtr& req,
                                  std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
    services::ContentService::listSettings(
        [req, cb](std::vector<services::SiteSetting> settingsList) {
            const std::string base = baseUrl(req, settingsList);
            const std::string siteName = settingOr(settingsList, "site_name", "PHPRetro");

            services::ContentService::listPublicNews(
                10,
                [cb, base, siteName](std::vector<services::PublicNewsItem> items) {
                    std::string x;
                    x.reserve(4096);
                    x += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
                    x += "<rss xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" "
                         "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                         "xmlns:taxo=\"http://purl.org/rss/1.0/modules/taxonomy/\" version=\"2.0\">\n";
                    x += "  <channel>\n";
                    // Escaped once.
                    x += "    <title>" + xmlEscape(siteName) + " ~</title>\n";
                    x += "    <link>" + xmlEscape(base) + "</link>\n";
                    x += "    <description />\n";

                    for (const auto& n : items) {
                        const std::string link = base + "/articles/" +
                                                 std::to_string(n.id) + "-" + n.title_safe;
                        x += "\n    <item>\n";
                        // Escaped once here. The legacy feed escaped this value
                        // twice, producing "&amp;amp;" for any title containing
                        // '&'. Do NOT wrap these in a second escape.
                        x += "      <title>" + xmlEscape(n.title) + "</title>\n";
                        x += "      <link>" + xmlEscape(link) + "</link>\n";
                        x += "      <description>" + xmlEscape(n.summary) + "</description>\n";
                        x += "      <pubDate>" + rfc822(n.time) + "</pubDate>\n";
                        x += "      <guid isPermaLink=\"false\">" + xmlEscape(link) + "</guid>\n";
                        x += "      <dc:date>" + iso8601(n.time) + "</dc:date>\n";
                        x += "    </item>\n";
                    }

                    x += "  </channel>\n</rss>\n";

                    auto resp = drogon::HttpResponse::newHttpResponse();
                    resp->setStatusCode(drogon::k200OK);
                    resp->setContentTypeString("text/xml; charset=utf-8");
                    resp->setBody(std::move(x));
                    cb(resp);
                });
        });
}

}  // namespace hotel::controllers
