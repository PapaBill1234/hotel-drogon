#pragma once

// Phase 4 content layer: website-owned `phpretro_*` tables.
//
// Deliberately NOT Drogon ORM model classes. This matches the Phase 3 idiom
// (UserAccountService, BanService, ...): typed structs plus a service exposing
// only named operations, backed by parameterised SQL. One data-access pattern
// across the whole codebase, not a second one for the lower-risk tables.
//
// Table ownership: these tables are website/CMS-owned, not Polaris-owned, so
// scripts/check_polaris_access.py does not govern them. The named-method
// discipline still applies — there is no generic update(table, column, value).

#include <drogon/orm/DbClient.h>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace hotel::services {

// ---------------------------------------------------------------- structs

struct NewsArticle {
    uint32_t id = 0;
    std::string title;
    std::string summary;
    std::string story;
    std::string author;
    std::string categories;  // comma-separated
    std::string images;      // comma-separated
    uint64_t time = 0;
};

struct Collectible {
    uint32_t id = 0;
    std::string name;
    std::string description;
    std::string image;
    uint64_t time = 0;
};

struct FaqEntry {
    uint32_t id = 0;
    std::string category;
    std::string question;
    std::string answer;
    int32_t sort_order = 0;
    bool active = true;
};

// `html` and `text` on a banner are RAW MARKUP rendered without escaping.
// Writing them requires the high-trust permission (see requireHighTrust).
// Never treat them as ordinary text fields.
struct Banner {
    uint32_t id = 0;
    std::string text;
    std::string banner;
    std::string url;
    bool status = true;
    bool advanced = false;
    std::string html;  // HIGH TRUST: raw markup
    int32_t sort_order = 1;
};

struct Campaign {
    uint32_t id = 0;
    std::string name;
    std::string desc;
    std::string image;
    std::string url;
    bool visible = true;
    int32_t sort_order = 1;
};

struct SiteSetting {
    std::string key;
    std::string value;
};

struct PublicNewsItem {
    uint32_t id = 0;
    std::string title;
    std::string summary;
    std::string title_safe;  // URL slug
    uint64_t time = 0;
};

// ------------------------------------------------------------ validation

// Result of a write attempt. `error` is a developer-facing message; `field`
// names the offending input so the API can return a structured 422.
struct ContentResult {
    bool ok = false;
    std::string error;
    std::string field;
    uint32_t id = 0;
};

// ---------------------------------------------------------------- service

class ContentService {
public:
    // --- schema bootstrap (idempotent; called once at startup) ---
    // Runs the CREATE statements and the settings seed strictly in order, then
    // invokes `onComplete` (if given) once everything has finished. Callers use
    // this to order dependent work — notably the readiness signal, which must
    // not fire before the schema exists.
    static void ensureSchema(const drogon::orm::DbClientPtr& db,
                             std::function<void()> onComplete = nullptr);

    // --- news ---------------------------------------------------------
    static void listNews(
        uint32_t limit, uint32_t offset,
        std::function<void(std::vector<NewsArticle>)> callback);
    static void getNewsById(
        uint32_t id,
        std::function<void(std::optional<NewsArticle>)> callback);
    static void getLatestNews(
        std::function<void(std::optional<NewsArticle>)> callback);

    // Public listing for the landing/community/article pages and the RSS feed.
    // Populates `title_safe` (URL slug) the way legacy stringToURL() did, so
    // article links keep the /articles/<id>-<slug> shape.
    static void listPublicNews(
        uint32_t limit,
        std::function<void(std::vector<PublicNewsItem>)> callback);
    static void publishNews(
        uint32_t actorId, const NewsArticle& article, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void updateNews(
        uint32_t actorId, const NewsArticle& article, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void deleteNews(
        uint32_t actorId, uint32_t id, const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- FAQ ----------------------------------------------------------
    static void listFaq(
        bool activeOnly,
        std::function<void(std::vector<FaqEntry>)> callback);
    static void createFaq(
        uint32_t actorId, const FaqEntry& entry, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void updateFaq(
        uint32_t actorId, const FaqEntry& entry, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void deleteFaq(
        uint32_t actorId, uint32_t id, const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- collectibles -------------------------------------------------
    static void listCollectibles(
        std::function<void(std::vector<Collectible>)> callback);
    static void createCollectible(
        uint32_t actorId, const Collectible& item, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void deleteCollectible(
        uint32_t actorId, uint32_t id, const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- banners (HIGH TRUST on `html`) -------------------------------
    static void listBanners(
        bool visibleOnly,
        std::function<void(std::vector<Banner>)> callback);
    // `includeRawHtml` gates whether `html` is populated on the returned rows;
    // callers without the high-trust permission must pass false.
    static void createBanner(
        uint32_t actorId, const Banner& banner, bool includeRawHtml,
        const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void updateBanner(
        uint32_t actorId, const Banner& banner, bool includeRawHtml,
        const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void deleteBanner(
        uint32_t actorId, uint32_t id, const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- campaigns ----------------------------------------------------
    static void listCampaigns(
        std::function<void(std::vector<Campaign>)> callback);
    static void createCampaign(
        uint32_t actorId, const Campaign& campaign, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void updateCampaign(
        uint32_t actorId, const Campaign& campaign, const std::string& ip,
        std::function<void(ContentResult)> callback);
    static void deleteCampaign(
        uint32_t actorId, uint32_t id, const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- site settings ------------------------------------------------
    static void listSettings(
        std::function<void(std::vector<SiteSetting>)> callback);
    static void getSetting(
        const std::string& key,
        std::function<void(std::optional<std::string>)> callback);
    static void setSetting(
        uint32_t actorId, const std::string& key, const std::string& value,
        const std::string& ip,
        std::function<void(ContentResult)> callback);

    // --- validation helpers (pure; unit-testable) ---------------------
    // Returns empty string when valid, else a developer-facing message.
    static std::string validateNews(const NewsArticle& article, std::string& badField);
    static std::string validateFaq(const FaqEntry& entry, std::string& badField);
    static std::string validateBanner(const Banner& banner, std::string& badField);

    // HIGH TRUST classification: a banner is high-trust when it carries raw
    // markup or is flagged advanced. Used to decide whether a write needs the
    // elevated permission and whether responses must carry a warning.
    static bool bannerRequiresHighTrust(const Banner& banner);
};

}  // namespace hotel::services
