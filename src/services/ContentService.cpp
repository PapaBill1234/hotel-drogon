#include "services/ContentService.h"
#include "services/AuditService.h"
#include "utils/Logger.h"
#include <drogon/drogon.h>
#include <chrono>
#include <algorithm>
#include <cctype>

// Specific using-declarations, deliberately NOT `using namespace drogon::orm;`
// — the namespace directive pulls in extra operator<< candidates and breaks
// SqlBinder overload resolution.
using drogon::orm::Result;
using drogon::orm::Row;
using drogon::orm::DbClientPtr;
using drogon::orm::DrogonDbException;

namespace hotel::services {

// ---------------------------------------------------------------- helpers

static uint64_t nowUnix() {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count());
}

static std::string trim(const std::string& s) {
    size_t b = 0, e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return s.substr(b, e - b);
}

// PHPRetro's URL slug: lowercase, non-alphanumerics collapsed to '-'.
// Mirrors the legacy stringToURL() closely enough for article links.
static std::string slugify(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    bool lastDash = false;
    for (unsigned char c : in) {
        if (std::isalnum(c)) {
            out += static_cast<char>(std::tolower(c));
            lastDash = false;
        } else if (!lastDash) {
            out += '-';
            lastDash = true;
        }
    }
    while (!out.empty() && out.back() == '-') out.pop_back();
    return out;
}

static bool isHighTrustHtml(const std::string& html) {
    // Raw markup is high-trust if it can execute or load remote content.
    std::string lower;
    lower.reserve(html.size());
    for (unsigned char c : html) lower += static_cast<char>(std::tolower(c));
    static const char* needles[] = {
        "<script", "<iframe", "<object", "<embed", "javascript:",
        "onerror=", "onload=", "onclick=", "<style", "<link"
    };
    for (const char* n : needles) {
        if (lower.find(n) != std::string::npos) return true;
    }
    return false;
}

// ------------------------------------------------------------ validation

std::string ContentService::validateNews(const NewsArticle& a, std::string& badField) {
    badField.clear();
    if (trim(a.title).empty()) { badField = "title"; return "title is required"; }
    if (a.title.size() > 255) { badField = "title"; return "title must be 255 characters or fewer"; }
    if (trim(a.summary).empty()) { badField = "summary"; return "summary is required"; }
    if (trim(a.story).empty()) { badField = "story"; return "story is required"; }
    if (a.author.size() > 100) { badField = "author"; return "author must be 100 characters or fewer"; }
    if (a.categories.size() > 255) { badField = "categories"; return "categories must be 255 characters or fewer"; }
    return {};
}

std::string ContentService::validateFaq(const FaqEntry& e, std::string& badField) {
    badField.clear();
    if (trim(e.question).empty()) { badField = "question"; return "question is required"; }
    if (e.question.size() > 255) { badField = "question"; return "question must be 255 characters or fewer"; }
    if (trim(e.answer).empty()) { badField = "answer"; return "answer is required"; }
    if (e.category.size() > 100) { badField = "category"; return "category must be 100 characters or fewer"; }
    return {};
}

std::string ContentService::validateBanner(const Banner& b, std::string& badField) {
    badField.clear();
    if (b.text.size() > 255) { badField = "text"; return "text must be 255 characters or fewer"; }
    if (b.banner.size() > 255) { badField = "banner"; return "banner must be 255 characters or fewer"; }
    if (b.url.size() > 255) { badField = "url"; return "url must be 255 characters or fewer"; }
    return {};
}

bool ContentService::bannerRequiresHighTrust(const Banner& b) {
    return b.advanced || isHighTrustHtml(b.html);
}

// ---------------------------------------------------------------- schema

void ContentService::ensureSchema(const DbClientPtr& db) {
    if (!db) {
        HOTEL_LOG_WARN("ContentService::ensureSchema called without a DbClient");
        return;
    }
    // Column definitions mirror legacy migrations 001 and 008 exactly, so the
    // ported pages read the same shapes the PHP did.
    // std::string, not const char*: Drogon's operator<< is overloaded for
    // string-literal arrays, so passing a bare const char* is ambiguous.
    // static: the sequencer below references it from async callbacks.
    static const std::vector<std::string> statements = {
        "CREATE TABLE IF NOT EXISTS phpretro_news ("
        "id INT NOT NULL AUTO_INCREMENT, title VARCHAR(255) NOT NULL,"
        "summary TEXT NOT NULL, story TEXT NOT NULL, author VARCHAR(100) NOT NULL,"
        "categories VARCHAR(255) NOT NULL DEFAULT '', images TEXT NOT NULL,"
        "time INT NOT NULL, PRIMARY KEY (id), INDEX idx_time (time)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_collectibles ("
        "id INT NOT NULL AUTO_INCREMENT, name VARCHAR(255) NOT NULL,"
        "description TEXT NOT NULL, image VARCHAR(255) NOT NULL, time INT NOT NULL,"
        "PRIMARY KEY (id), UNIQUE INDEX idx_time (time)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_faq ("
        "id INT NOT NULL AUTO_INCREMENT, category VARCHAR(100) NOT NULL DEFAULT 'general',"
        "question VARCHAR(255) NOT NULL, answer TEXT NOT NULL,"
        "sort_order INT NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,"
        "PRIMARY KEY (id), INDEX idx_category_sort (category, sort_order)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_banners ("
        "id INT NOT NULL AUTO_INCREMENT, text VARCHAR(255) NOT NULL DEFAULT '',"
        "banner VARCHAR(255) NOT NULL DEFAULT '', url VARCHAR(255) NOT NULL DEFAULT '',"
        "status CHAR(1) NOT NULL DEFAULT '1', advanced CHAR(1) NOT NULL DEFAULT '0',"
        "html TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 1,"
        "PRIMARY KEY (id), INDEX idx_status_order (status, sort_order)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_campaigns ("
        "id INT NOT NULL AUTO_INCREMENT, name VARCHAR(255) NOT NULL DEFAULT '',"
        "`desc` VARCHAR(255) NOT NULL DEFAULT '', image VARCHAR(255) NOT NULL DEFAULT '',"
        "url VARCHAR(255) NOT NULL DEFAULT '', visible CHAR(1) NOT NULL DEFAULT '1',"
        "sort_order INT NOT NULL DEFAULT 1,"
        "PRIMARY KEY (id), INDEX idx_visible_order (visible, sort_order)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        // Shape taken from legacy migrations/002_admin_features.sql, including
        // updated_at NOT NULL (the legacy app writes this table too). An earlier
        // version had only (setting_key, setting_value): it was inferred from the
        // SELECT in includes/classes.php rather than the migration, and diverged
        // from the table the legacy app actually writes.
        //
        // Divergence: legacy declares a FK on updated_by -> users(id). Omitted
        // here because Drogon dispatches statements asynchronously, so this
        // CREATE is not ordered after the users CREATE and the constraint would
        // race. It is a constraint only; column shape matches.
        "CREATE TABLE IF NOT EXISTS phpretro_site_settings ("
        "setting_key VARCHAR(100) NOT NULL, setting_value VARCHAR(255) NOT NULL,"
        "updated_by INT NULL, updated_at INT NOT NULL,"
        "PRIMARY KEY (setting_key)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    };

    // Drogon's operator<< dispatches asynchronously: the statements below are
    // NOT ordered relative to each other. The settings seed depends on its
    // table existing, so everything runs strictly in sequence — fire-and-forget
    // let the INSERT race ahead of the CREATE and fail with error 1146.
    auto run = std::make_shared<std::function<void(size_t)>>();
    *run = [db, run](size_t index) {
        if (index < statements.size()) {
            *db << statements[index]
                >> [run, index](const Result&) { (*run)(index + 1); }
                >> [run, index](const DrogonDbException& e) {
                       HOTEL_LOG_WARN("ContentService schema init: {}", e.base().what());
                       (*run)(index + 1);
                   };
            return;
        }

        // Seed the maintenance/site flags the ported pages depend on, so a
        // fresh install renders the same defaults as legacy. INSERT IGNORE:
        // never clobber an operator's existing value.
        *db << "INSERT IGNORE INTO phpretro_site_settings "
               "(setting_key, setting_value, updated_by, updated_at) VALUES "
               "('site_closed','0',NULL,UNIX_TIMESTAMP()),"
               "('maintenance_style','0',NULL,UNIX_TIMESTAMP()),"
               "('maintenance_twitter','',NULL,UNIX_TIMESTAMP()),"
               "('site_capcha','0',NULL,UNIX_TIMESTAMP()),"
               "('site_name','PHPRetro',NULL,UNIX_TIMESTAMP()),"
               "('site_url','',NULL,UNIX_TIMESTAMP()),"
               "('site_promo_phrases','Welcome to the hotel|Hey there!|Come on in!',NULL,UNIX_TIMESTAMP())"
            >> [](const Result&) {
                   HOTEL_LOG_INFO("ContentService: content schema ready.");
               }
            >> [](const DrogonDbException& e) {
                   HOTEL_LOG_WARN("ContentService settings seed: {}", e.base().what());
               };
    };
    (*run)(0);
}

// ------------------------------------------------------------------ news

static NewsArticle mapNews(const Row& r) {
    NewsArticle a;
    a.id = r["id"].as<uint32_t>();
    a.title = r["title"].as<std::string>();
    a.summary = r["summary"].as<std::string>();
    a.story = r["story"].as<std::string>();
    a.author = r["author"].as<std::string>();
    a.categories = r["categories"].as<std::string>();
    a.images = r["images"].as<std::string>();
    a.time = static_cast<uint64_t>(r["time"].as<int64_t>());
    return a;
}

static const char* kNewsCols =
    "id, title, summary, story, author, categories, images, time";

void ContentService::listNews(
    uint32_t limit, uint32_t offset,
    std::function<void(std::vector<NewsArticle>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }
    if (limit == 0 || limit > 100) limit = 20;

    std::string sql = "SELECT " + std::string(kNewsCols) +
                      " FROM phpretro_news ORDER BY time DESC, id DESC LIMIT ? OFFSET ?";
    *db << sql
        << static_cast<int>(limit) << static_cast<int>(offset)
        >> [callback](const Result& r) {
               std::vector<NewsArticle> out;
               out.reserve(r.size());
               for (const auto& row : r) out.push_back(mapNews(row));
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listNews: {}", e.base().what());
               callback({});
           };
}

void ContentService::getNewsById(
    uint32_t id,
    std::function<void(std::optional<NewsArticle>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback(std::nullopt); return; }

    std::string sql = "SELECT " + std::string(kNewsCols) +
                      " FROM phpretro_news WHERE id = ? LIMIT 1";
    *db << sql
        << id
        >> [callback](const Result& r) {
               if (r.empty()) { callback(std::nullopt); return; }
               callback(mapNews(r[0]));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::getNewsById: {}", e.base().what());
               callback(std::nullopt);
           };
}

void ContentService::getLatestNews(
    std::function<void(std::optional<NewsArticle>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback(std::nullopt); return; }

    std::string sql = "SELECT " + std::string(kNewsCols) +
                      " FROM phpretro_news ORDER BY time DESC, id DESC LIMIT 1";
    *db << sql
        >> [callback](const Result& r) {
               if (r.empty()) { callback(std::nullopt); return; }
               callback(mapNews(r[0]));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::getLatestNews: {}", e.base().what());
               callback(std::nullopt);
           };
}

void ContentService::listPublicNews(
    uint32_t limit,
    std::function<void(std::vector<PublicNewsItem>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }
    if (limit == 0 || limit > 100) limit = 10;

    std::string sql =
        "SELECT id, title, summary, time FROM phpretro_news ORDER BY time DESC, id DESC LIMIT ?";
    *db << sql
        << static_cast<int>(limit)
        >> [callback](const Result& r) {
               std::vector<PublicNewsItem> out;
               out.reserve(r.size());
               for (const auto& row : r) {
                   PublicNewsItem n;
                   n.id = row["id"].as<uint32_t>();
                   n.title = row["title"].as<std::string>();
                   n.summary = row["summary"].as<std::string>();
                   n.time = static_cast<uint64_t>(row["time"].as<int64_t>());
                   n.title_safe = slugify(n.title);
                   out.push_back(std::move(n));
               }
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listPublicNews: {}", e.base().what());
               callback({});
           };
}

void ContentService::publishNews(
    uint32_t actorId, const NewsArticle& article, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    std::string badField;
    std::string err = validateNews(article, badField);
    if (!err.empty()) { res.ok = false; res.error = err; res.field = badField; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    uint64_t t = article.time != 0 ? article.time : nowUnix();
    *db << "INSERT INTO phpretro_news (title, summary, story, author, categories, images, time) "
           "VALUES (?, ?, ?, ?, ?, ?, ?)"
        << article.title << article.summary << article.story << article.author
        << article.categories << article.images << static_cast<int64_t>(t)
        >> [callback, actorId, ip, res](const Result& r) mutable {
               res.ok = true;
               res.id = static_cast<uint32_t>(r.insertId());
               AuditService::logAction(actorId, "content_news_publish", "phpretro_news",
                                       res.id, "Published news article", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::publishNews: {}", e.base().what());
               res.ok = false; res.error = "failed to publish article";
               callback(res);
           };
}

void ContentService::updateNews(
    uint32_t actorId, const NewsArticle& article, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (article.id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }
    std::string badField;
    std::string err = validateNews(article, badField);
    if (!err.empty()) { res.error = err; res.field = badField; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "UPDATE phpretro_news SET title = ?, summary = ?, story = ?, author = ?, "
           "categories = ?, images = ?, time = ? WHERE id = ?"
        << article.title << article.summary << article.story << article.author
        << article.categories << article.images
        << static_cast<int64_t>(article.time != 0 ? article.time : nowUnix())
        << article.id
        >> [callback, actorId, article, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) {
                   res.ok = false; res.error = "article not found"; callback(res); return;
               }
               res.ok = true; res.id = article.id;
               AuditService::logAction(actorId, "content_news_update", "phpretro_news",
                                       article.id, "Updated news article", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::updateNews: {}", e.base().what());
               res.error = "failed to update article"; callback(res);
           };
}

void ContentService::deleteNews(
    uint32_t actorId, uint32_t id, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "DELETE FROM phpretro_news WHERE id = ?" << id
        >> [callback, actorId, id, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) {
                   res.ok = false; res.error = "article not found"; callback(res); return;
               }
               res.ok = true; res.id = id;
               AuditService::logAction(actorId, "content_news_delete", "phpretro_news",
                                       id, "Deleted news article", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::deleteNews: {}", e.base().what());
               res.error = "failed to delete article"; callback(res);
           };
}

// ------------------------------------------------------------------- FAQ

static FaqEntry mapFaq(const Row& r) {
    FaqEntry f;
    f.id = r["id"].as<uint32_t>();
    f.category = r["category"].as<std::string>();
    f.question = r["question"].as<std::string>();
    f.answer = r["answer"].as<std::string>();
    f.sort_order = r["sort_order"].as<int32_t>();
    f.active = r["active"].as<int>() == 1;
    return f;
}

void ContentService::listFaq(
    bool activeOnly,
    std::function<void(std::vector<FaqEntry>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }

    std::string sql = "SELECT id, category, question, answer, sort_order, active FROM phpretro_faq";
    if (activeOnly) sql += " WHERE active = 1";
    sql += " ORDER BY category, sort_order, id";

    *db << sql
        >> [callback](const Result& r) {
               std::vector<FaqEntry> out;
               out.reserve(r.size());
               for (const auto& row : r) out.push_back(mapFaq(row));
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listFaq: {}", e.base().what());
               callback({});
           };
}

void ContentService::createFaq(
    uint32_t actorId, const FaqEntry& entry, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    std::string badField;
    std::string err = validateFaq(entry, badField);
    if (!err.empty()) { res.error = err; res.field = badField; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    // Explicit std::string: a ternary mixing const char* and std::string picks
    // the generic SqlBinder template and fails to compile (it tries to
    // static_cast the string to an integer for the PostgreSQL path).
    std::string category = entry.category.empty() ? "general" : entry.category;

    *db << "INSERT INTO phpretro_faq (category, question, answer, sort_order, active) "
           "VALUES (?, ?, ?, ?, ?)"
        << category
        << entry.question << entry.answer << entry.sort_order
        << (entry.active ? 1 : 0)
        >> [callback, actorId, ip, res](const Result& r) mutable {
               res.ok = true; res.id = static_cast<uint32_t>(r.insertId());
               AuditService::logAction(actorId, "content_faq_create", "phpretro_faq",
                                       res.id, "Created FAQ entry", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::createFaq: {}", e.base().what());
               res.error = "failed to create FAQ entry"; callback(res);
           };
}

void ContentService::updateFaq(
    uint32_t actorId, const FaqEntry& entry, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (entry.id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }
    std::string badField;
    std::string err = validateFaq(entry, badField);
    if (!err.empty()) { res.error = err; res.field = badField; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    std::string category = entry.category.empty() ? "general" : entry.category;

    *db << "UPDATE phpretro_faq SET category = ?, question = ?, answer = ?, "
           "sort_order = ?, active = ? WHERE id = ?"
        << category
        << entry.question << entry.answer << entry.sort_order
        << (entry.active ? 1 : 0) << entry.id
        >> [callback, actorId, entry, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) {
                   res.error = "FAQ entry not found"; callback(res); return;
               }
               res.ok = true; res.id = entry.id;
               AuditService::logAction(actorId, "content_faq_update", "phpretro_faq",
                                       entry.id, "Updated FAQ entry", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::updateFaq: {}", e.base().what());
               res.error = "failed to update FAQ entry"; callback(res);
           };
}

void ContentService::deleteFaq(
    uint32_t actorId, uint32_t id, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "DELETE FROM phpretro_faq WHERE id = ?" << id
        >> [callback, actorId, id, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "FAQ entry not found"; callback(res); return; }
               res.ok = true; res.id = id;
               AuditService::logAction(actorId, "content_faq_delete", "phpretro_faq",
                                       id, "Deleted FAQ entry", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::deleteFaq: {}", e.base().what());
               res.error = "failed to delete FAQ entry"; callback(res);
           };
}

// ---------------------------------------------------------- collectibles

static Collectible mapCollectible(const Row& r) {
    Collectible c;
    c.id = r["id"].as<uint32_t>();
    c.name = r["name"].as<std::string>();
    c.description = r["description"].as<std::string>();
    c.image = r["image"].as<std::string>();
    c.time = static_cast<uint64_t>(r["time"].as<int64_t>());
    return c;
}

void ContentService::listCollectibles(
    std::function<void(std::vector<Collectible>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }

    *db << "SELECT id, name, description, image, time FROM phpretro_collectibles "
           "ORDER BY time DESC"
        >> [callback](const Result& r) {
               std::vector<Collectible> out;
               out.reserve(r.size());
               for (const auto& row : r) out.push_back(mapCollectible(row));
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listCollectibles: {}", e.base().what());
               callback({});
           };
}

void ContentService::createCollectible(
    uint32_t actorId, const Collectible& item, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (trim(item.name).empty()) { res.error = "name is required"; res.field = "name"; callback(res); return; }
    if (item.time == 0) { res.error = "time is required"; res.field = "time"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "INSERT INTO phpretro_collectibles (name, description, image, time) VALUES (?, ?, ?, ?)"
        << item.name << item.description << item.image << static_cast<int64_t>(item.time)
        >> [callback, actorId, ip, res](const Result& r) mutable {
               res.ok = true; res.id = static_cast<uint32_t>(r.insertId());
               AuditService::logAction(actorId, "content_collectible_create",
                                       "phpretro_collectibles", res.id,
                                       "Created collectible", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::createCollectible: {}", e.base().what());
               // UNIQUE(time) is the likely cause; say so rather than "failed".
               res.error = "failed to create collectible (a collectible may already exist for that month)";
               callback(res);
           };
}

void ContentService::deleteCollectible(
    uint32_t actorId, uint32_t id, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "DELETE FROM phpretro_collectibles WHERE id = ?" << id
        >> [callback, actorId, id, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "collectible not found"; callback(res); return; }
               res.ok = true; res.id = id;
               AuditService::logAction(actorId, "content_collectible_delete",
                                       "phpretro_collectibles", id, "Deleted collectible", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::deleteCollectible: {}", e.base().what());
               res.error = "failed to delete collectible"; callback(res);
           };
}

// --------------------------------------------------------------- banners

static Banner mapBanner(const Row& r, bool includeRawHtml) {
    Banner b;
    b.id = r["id"].as<uint32_t>();
    b.text = r["text"].as<std::string>();
    b.banner = r["banner"].as<std::string>();
    b.url = r["url"].as<std::string>();
    b.status = r["status"].as<std::string>() == "1";
    b.advanced = r["advanced"].as<std::string>() == "1";
    b.sort_order = r["sort_order"].as<int32_t>();
    if (includeRawHtml) b.html = r["html"].as<std::string>();
    return b;
}

void ContentService::listBanners(
    bool visibleOnly,
    std::function<void(std::vector<Banner>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }

    std::string sql =
        "SELECT id, text, banner, url, status, advanced, html, sort_order FROM phpretro_banners";
    if (visibleOnly) sql += " WHERE status = '1'";
    sql += " ORDER BY sort_order, id";

    // Public listing never exposes raw markup.
    *db << sql
        >> [callback](const Result& r) {
               std::vector<Banner> out;
               out.reserve(r.size());
               for (const auto& row : r) out.push_back(mapBanner(row, false));
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listBanners: {}", e.base().what());
               callback({});
           };
}

void ContentService::createBanner(
    uint32_t actorId, const Banner& banner, bool includeRawHtml,
    const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    std::string badField;
    std::string err = validateBanner(banner, badField);
    if (!err.empty()) { res.error = err; res.field = badField; callback(res); return; }

    // Second line of defence. The controller must already have required the
    // high-trust permission; this refuses the write if it did not.
    if (!includeRawHtml && bannerRequiresHighTrust(banner)) {
        res.error = "raw HTML banner content requires the high-trust content permission";
        res.field = "html";
        callback(res);
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "INSERT INTO phpretro_banners (text, banner, url, status, advanced, html, sort_order) "
           "VALUES (?, ?, ?, ?, ?, ?, ?)"
        << banner.text << banner.banner << banner.url
        << (banner.status ? "1" : "0") << (banner.advanced ? "1" : "0")
        << banner.html << banner.sort_order
        >> [callback, actorId, banner, ip, res](const Result& r) mutable {
               res.ok = true; res.id = static_cast<uint32_t>(r.insertId());
               AuditService::logAction(
                   actorId, "content_banner_create", "phpretro_banners", res.id,
                   bannerRequiresHighTrust(banner)
                       ? "Created banner WITH RAW HTML (high-trust)"
                       : "Created banner",
                   ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::createBanner: {}", e.base().what());
               res.error = "failed to create banner"; callback(res);
           };
}

void ContentService::updateBanner(
    uint32_t actorId, const Banner& banner, bool includeRawHtml,
    const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (banner.id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }
    std::string badField;
    std::string err = validateBanner(banner, badField);
    if (!err.empty()) { res.error = err; res.field = badField; callback(res); return; }
    if (!includeRawHtml && bannerRequiresHighTrust(banner)) {
        res.error = "raw HTML banner content requires the high-trust content permission";
        res.field = "html";
        callback(res);
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "UPDATE phpretro_banners SET text = ?, banner = ?, url = ?, status = ?, "
           "advanced = ?, html = ?, sort_order = ? WHERE id = ?"
        << banner.text << banner.banner << banner.url
        << (banner.status ? "1" : "0") << (banner.advanced ? "1" : "0")
        << banner.html << banner.sort_order << banner.id
        >> [callback, actorId, banner, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "banner not found"; callback(res); return; }
               res.ok = true; res.id = banner.id;
               AuditService::logAction(
                   actorId, "content_banner_update", "phpretro_banners", banner.id,
                   bannerRequiresHighTrust(banner)
                       ? "Updated banner WITH RAW HTML (high-trust)"
                       : "Updated banner",
                   ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::updateBanner: {}", e.base().what());
               res.error = "failed to update banner"; callback(res);
           };
}

void ContentService::deleteBanner(
    uint32_t actorId, uint32_t id, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "DELETE FROM phpretro_banners WHERE id = ?" << id
        >> [callback, actorId, id, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "banner not found"; callback(res); return; }
               res.ok = true; res.id = id;
               AuditService::logAction(actorId, "content_banner_delete", "phpretro_banners",
                                       id, "Deleted banner", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::deleteBanner: {}", e.base().what());
               res.error = "failed to delete banner"; callback(res);
           };
}

// ------------------------------------------------------------- campaigns

static Campaign mapCampaign(const Row& r) {
    Campaign c;
    c.id = r["id"].as<uint32_t>();
    c.name = r["name"].as<std::string>();
    c.desc = r["desc"].as<std::string>();
    c.image = r["image"].as<std::string>();
    c.url = r["url"].as<std::string>();
    c.visible = r["visible"].as<std::string>() == "1";
    c.sort_order = r["sort_order"].as<int32_t>();
    return c;
}

void ContentService::listCampaigns(
    std::function<void(std::vector<Campaign>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }

    *db << "SELECT id, name, `desc`, image, url, visible, sort_order FROM phpretro_campaigns "
           "ORDER BY sort_order, id"
        >> [callback](const Result& r) {
               std::vector<Campaign> out;
               out.reserve(r.size());
               for (const auto& row : r) out.push_back(mapCampaign(row));
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listCampaigns: {}", e.base().what());
               callback({});
           };
}

void ContentService::createCampaign(
    uint32_t actorId, const Campaign& c, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (trim(c.name).empty()) { res.error = "name is required"; res.field = "name"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "INSERT INTO phpretro_campaigns (name, `desc`, image, url, visible, sort_order) "
           "VALUES (?, ?, ?, ?, ?, ?)"
        << c.name << c.desc << c.image << c.url
        << (c.visible ? "1" : "0") << c.sort_order
        >> [callback, actorId, ip, res](const Result& r) mutable {
               res.ok = true; res.id = static_cast<uint32_t>(r.insertId());
               AuditService::logAction(actorId, "content_campaign_create", "phpretro_campaigns",
                                       res.id, "Created campaign", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::createCampaign: {}", e.base().what());
               res.error = "failed to create campaign"; callback(res);
           };
}

void ContentService::updateCampaign(
    uint32_t actorId, const Campaign& c, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (c.id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }
    if (trim(c.name).empty()) { res.error = "name is required"; res.field = "name"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "UPDATE phpretro_campaigns SET name = ?, `desc` = ?, image = ?, url = ?, "
           "visible = ?, sort_order = ? WHERE id = ?"
        << c.name << c.desc << c.image << c.url
        << (c.visible ? "1" : "0") << c.sort_order << c.id
        >> [callback, actorId, c, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "campaign not found"; callback(res); return; }
               res.ok = true; res.id = c.id;
               AuditService::logAction(actorId, "content_campaign_update", "phpretro_campaigns",
                                       c.id, "Updated campaign", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::updateCampaign: {}", e.base().what());
               res.error = "failed to update campaign"; callback(res);
           };
}

void ContentService::deleteCampaign(
    uint32_t actorId, uint32_t id, const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (id == 0) { res.error = "id is required"; res.field = "id"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "DELETE FROM phpretro_campaigns WHERE id = ?" << id
        >> [callback, actorId, id, ip, res](const Result& r) mutable {
               if (r.affectedRows() == 0) { res.error = "campaign not found"; callback(res); return; }
               res.ok = true; res.id = id;
               AuditService::logAction(actorId, "content_campaign_delete", "phpretro_campaigns",
                                       id, "Deleted campaign", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::deleteCampaign: {}", e.base().what());
               res.error = "failed to delete campaign"; callback(res);
           };
}

// --------------------------------------------------------- site settings

void ContentService::listSettings(
    std::function<void(std::vector<SiteSetting>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback({}); return; }

    *db << "SELECT setting_key, setting_value FROM phpretro_site_settings ORDER BY setting_key"
        >> [callback](const Result& r) {
               std::vector<SiteSetting> out;
               out.reserve(r.size());
               for (const auto& row : r) {
                   out.push_back({row["setting_key"].as<std::string>(),
                                  row["setting_value"].as<std::string>()});
               }
               callback(std::move(out));
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::listSettings: {}", e.base().what());
               callback({});
           };
}

void ContentService::getSetting(
    const std::string& key,
    std::function<void(std::optional<std::string>)> callback) {
    auto db = drogon::app().getDbClient("default");
    if (!db) { callback(std::nullopt); return; }

    *db << "SELECT setting_value FROM phpretro_site_settings WHERE setting_key = ? LIMIT 1"
        << key
        >> [callback](const Result& r) {
               if (r.empty()) { callback(std::nullopt); return; }
               callback(r[0]["setting_value"].as<std::string>());
           }
        >> [callback](const DrogonDbException& e) {
               HOTEL_LOG_ERROR("ContentService::getSetting: {}", e.base().what());
               callback(std::nullopt);
           };
}

void ContentService::setSetting(
    uint32_t actorId, const std::string& key, const std::string& value,
    const std::string& ip,
    std::function<void(ContentResult)> callback) {
    ContentResult res;
    if (trim(key).empty()) { res.error = "setting key is required"; res.field = "key"; callback(res); return; }
    if (key.size() > 100) { res.error = "setting key must be 100 characters or fewer"; res.field = "key"; callback(res); return; }

    auto db = drogon::app().getDbClient("default");
    if (!db) { res.error = "database unavailable"; callback(res); return; }

    *db << "INSERT INTO phpretro_site_settings "
           "(setting_key, setting_value, updated_by, updated_at) VALUES (?, ?, ?, UNIX_TIMESTAMP()) "
           "ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), "
           "updated_by = VALUES(updated_by), updated_at = UNIX_TIMESTAMP()"
        << key << value << static_cast<int32_t>(actorId)
        >> [callback, actorId, key, ip, res](const Result&) mutable {
               res.ok = true;
               AuditService::logAction(actorId, "content_setting_update", "phpretro_site_settings",
                                       0, "Updated setting '" + key + "'", ip);
               callback(res);
           }
        >> [callback, res](const DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("ContentService::setSetting: {}", e.base().what());
               res.error = "failed to update setting"; callback(res);
           };
}

}  // namespace hotel::services
