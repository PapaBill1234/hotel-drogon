#include <catch2/catch_test_macros.hpp>

#include "services/PresentationReferenceService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using hotel::services::PresentationBannerReferenceResult;
using hotel::services::PresentationCampaignReferenceResult;
using hotel::services::PresentationReferenceCode;
using hotel::services::PresentationReferenceService;

constexpr auto kCallbackTimeout = std::chrono::seconds(15);

std::vector<drogon::orm::DbClientPtr>& retainedTestDbClients() {
    static std::vector<drogon::orm::DbClientPtr> clients;
    return clients;
}

template <typename Result>
Result waitForResult(std::future<Result>& future) {
    if (future.wait_for(kCallbackTimeout) != std::future_status::ready)
        throw std::runtime_error("presentation reference callback timed out");
    return future.get();
}

std::future<PresentationBannerReferenceResult> findBanner(
    const drogon::orm::DbClientPtr& db, uint32_t id) {
    auto promise = std::make_shared<std::promise<PresentationBannerReferenceResult>>();
    auto future = promise->get_future();
    PresentationReferenceService::findPublicBannerById(
        db, id, [promise](PresentationBannerReferenceResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

std::future<PresentationCampaignReferenceResult> findCampaign(
    const drogon::orm::DbClientPtr& db, uint32_t id) {
    auto promise = std::make_shared<std::promise<PresentationCampaignReferenceResult>>();
    auto future = promise->get_future();
    PresentationReferenceService::findPublicCampaignById(
        db, id, [promise](PresentationCampaignReferenceResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

struct FixtureCleanup {
    drogon::orm::DbClientPtr db;
    std::vector<uint32_t> bannerIds;
    std::vector<uint32_t> campaignIds;

    explicit FixtureCleanup(drogon::orm::DbClientPtr client) : db(std::move(client)) {}

    ~FixtureCleanup() {
        if (!cleaned_) (void)cleanupRows();
    }

    bool cleanupRows() noexcept {
        if (!db) {
            cleaned_ = true;
            return true;
        }
        bool succeeded = true;
        for (const auto id : bannerIds) {
            try {
                db->execSqlSync("DELETE FROM phpretro_banners WHERE id = ?", id);
                const auto remaining = db->execSqlSync(
                    "SELECT COUNT(*) AS total FROM phpretro_banners WHERE id = ?", id);
                succeeded = succeeded && remaining[0]["total"].as<uint64_t>() == 0;
            } catch (...) {
                succeeded = false;
            }
        }
        for (const auto id : campaignIds) {
            try {
                db->execSqlSync("DELETE FROM phpretro_campaigns WHERE id = ?", id);
                const auto remaining = db->execSqlSync(
                    "SELECT COUNT(*) AS total FROM phpretro_campaigns WHERE id = ?", id);
                succeeded = succeeded && remaining[0]["total"].as<uint64_t>() == 0;
            } catch (...) {
                succeeded = false;
            }
        }
        cleaned_ = succeeded;
        return succeeded;
    }

private:
    bool cleaned_ = false;
};

}  // namespace

TEST_CASE("Presentation references resolve active rows to safe typed fields",
          "[presentation-db]") {
    const char* host = std::getenv("PRESENTATION_TEST_DB_HOST");
    const char* database = std::getenv("PRESENTATION_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set PRESENTATION_TEST_DB_HOST and PRESENTATION_TEST_DB_DATABASE to run disposable MariaDB integration checks");
    }
    REQUIRE(std::string(database) == "presentation_test");

    const char* portText = std::getenv("PRESENTATION_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* username = std::getenv("PRESENTATION_TEST_DB_USERNAME");
    const char* password = std::getenv("PRESENTATION_TEST_DB_PASSWORD");
    const std::string dbUser = username == nullptr ? "hotel" : username;
    const std::string dbPassword = password == nullptr ? "hotel_secret" : password;
    const std::string connectionInfo =
        "host=" + std::string(host) + " port=" + std::to_string(port) +
        " dbname=" + database + " user=" + dbUser + " password=" + dbPassword;
    const auto db = drogon::orm::DbClient::newMysqlClient(connectionInfo, 4);
    REQUIRE(db != nullptr);
    retainedTestDbClients().push_back(db);
    db->setTimeout(5.0);

    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_banners ("
        "id INT NOT NULL AUTO_INCREMENT, text VARCHAR(255) NOT NULL DEFAULT '',"
        "banner VARCHAR(255) NOT NULL DEFAULT '', url VARCHAR(255) NOT NULL DEFAULT '',"
        "status CHAR(1) NOT NULL DEFAULT '1', advanced CHAR(1) NOT NULL DEFAULT '0',"
        "html TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 1, PRIMARY KEY (id),"
        "INDEX idx_status_order (status, sort_order)) "
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_campaigns ("
        "id INT NOT NULL AUTO_INCREMENT, name VARCHAR(255) NOT NULL DEFAULT '',"
        "`desc` VARCHAR(255) NOT NULL DEFAULT '', image VARCHAR(255) NOT NULL DEFAULT '',"
        "url VARCHAR(255) NOT NULL DEFAULT '', visible CHAR(1) NOT NULL DEFAULT '1',"
        "sort_order INT NOT NULL DEFAULT 1, PRIMARY KEY (id),"
        "INDEX idx_visible_order (visible, sort_order)) "
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    FixtureCleanup cleanup(db);
    const auto marker = std::to_string(
        std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());

    const auto activeBanner = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES (?, ?, ?, '1', '0', ?, 1)",
        "banner " + marker, "web-gallery/images/banner.png", "/community",
        "<ignored>not a public field</ignored>");
    const auto activeBannerId = static_cast<uint32_t>(activeBanner.insertId());
    cleanup.bannerIds.push_back(activeBannerId);

    const auto emptyBanner = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES (?, '', '', '1', '0', '', 2)",
        "text only " + marker);
    const auto emptyBannerId = static_cast<uint32_t>(emptyBanner.insertId());
    cleanup.bannerIds.push_back(emptyBannerId);

    const auto hiddenBanner = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES ('hidden', 'web-gallery/hidden.png', '/community', '0', '0', '', 3)");
    const auto hiddenBannerId = static_cast<uint32_t>(hiddenBanner.insertId());
    cleanup.bannerIds.push_back(hiddenBannerId);

    const auto advancedBanner = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES ('advanced', '', '', '1', '1', '<b>legacy raw</b>', 4)");
    const auto advancedBannerId = static_cast<uint32_t>(advancedBanner.insertId());
    cleanup.bannerIds.push_back(advancedBannerId);

    const auto unsafeBanner = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES ('unsafe', '/account/logout', 'javascript:alert(1)', '1', '0', '', 5)");
    const auto unsafeBannerId = static_cast<uint32_t>(unsafeBanner.insertId());
    cleanup.bannerIds.push_back(unsafeBannerId);

    const auto unsafeBannerUrl = db->execSqlSync(
        "INSERT INTO phpretro_banners "
        "(text, banner, url, status, advanced, html, sort_order) "
        "VALUES ('unsafe destination', 'web-gallery/safe.png', "
        "'javascript:alert(1)', '1', '0', '', 6)");
    const auto unsafeBannerUrlId = static_cast<uint32_t>(unsafeBannerUrl.insertId());
    cleanup.bannerIds.push_back(unsafeBannerUrlId);

    const auto activeCampaign = db->execSqlSync(
        "INSERT INTO phpretro_campaigns "
        "(name, `desc`, image, url, visible, sort_order) "
        "VALUES (?, ?, ?, ?, '1', 1)",
        "campaign " + marker, "campaign description", "web-gallery/campaign.png",
        "https://example.com/campaign?source=v4");
    const auto activeCampaignId = static_cast<uint32_t>(activeCampaign.insertId());
    cleanup.campaignIds.push_back(activeCampaignId);

    const auto hiddenCampaign = db->execSqlSync(
        "INSERT INTO phpretro_campaigns "
        "(name, `desc`, image, url, visible, sort_order) "
        "VALUES ('hidden', '', '', '', '0', 2)");
    const auto hiddenCampaignId = static_cast<uint32_t>(hiddenCampaign.insertId());
    cleanup.campaignIds.push_back(hiddenCampaignId);

    const auto unsafeCampaign = db->execSqlSync(
        "INSERT INTO phpretro_campaigns "
        "(name, `desc`, image, url, visible, sort_order) "
        "VALUES ('unsafe', '', 'http://cdn.example.com/campaign.png', '', '1', 3)");
    const auto unsafeCampaignId = static_cast<uint32_t>(unsafeCampaign.insertId());
    cleanup.campaignIds.push_back(unsafeCampaignId);

    const auto unsafeCampaignUrl = db->execSqlSync(
        "INSERT INTO phpretro_campaigns "
        "(name, `desc`, image, url, visible, sort_order) "
        "VALUES ('unsafe destination', '', 'web-gallery/safe.png', "
        "'//cdn.example.com/campaign', '1', 4)");
    const auto unsafeCampaignUrlId = static_cast<uint32_t>(unsafeCampaignUrl.insertId());
    cleanup.campaignIds.push_back(unsafeCampaignUrlId);

    auto bannerFuture = findBanner(db, activeBannerId);
    const auto banner = waitForResult(bannerFuture);
    REQUIRE(banner.ok);
    REQUIRE(banner.code == PresentationReferenceCode::None);
    REQUIRE(banner.reference.has_value());
    REQUIRE(banner.reference->id == activeBannerId);
    REQUIRE(banner.reference->text == "banner " + marker);
    REQUIRE(banner.reference->image_url == "/web-gallery/images/banner.png");
    REQUIRE(banner.reference->destination_url == "/community");

    auto emptyBannerFuture = findBanner(db, emptyBannerId);
    const auto emptyBannerResult = waitForResult(emptyBannerFuture);
    REQUIRE(emptyBannerResult.ok);
    REQUIRE(emptyBannerResult.reference.has_value());
    REQUIRE_FALSE(emptyBannerResult.reference->image_url.has_value());
    REQUIRE_FALSE(emptyBannerResult.reference->destination_url.has_value());

    auto hiddenBannerFuture = findBanner(db, hiddenBannerId);
    const auto hiddenBannerResult = waitForResult(hiddenBannerFuture);
    REQUIRE_FALSE(hiddenBannerResult.ok);
    REQUIRE(hiddenBannerResult.code == PresentationReferenceCode::NotFound);

    auto advancedBannerFuture = findBanner(db, advancedBannerId);
    const auto advancedBannerResult = waitForResult(advancedBannerFuture);
    REQUIRE_FALSE(advancedBannerResult.ok);
    REQUIRE(advancedBannerResult.code == PresentationReferenceCode::Unsupported);

    auto unsafeBannerFuture = findBanner(db, unsafeBannerId);
    const auto unsafeBannerResult = waitForResult(unsafeBannerFuture);
    REQUIRE_FALSE(unsafeBannerResult.ok);
    REQUIRE(unsafeBannerResult.code == PresentationReferenceCode::UnsafeField);

    auto unsafeBannerUrlFuture = findBanner(db, unsafeBannerUrlId);
    const auto unsafeBannerUrlResult = waitForResult(unsafeBannerUrlFuture);
    REQUIRE_FALSE(unsafeBannerUrlResult.ok);
    REQUIRE(unsafeBannerUrlResult.code == PresentationReferenceCode::UnsafeField);

    auto campaignFuture = findCampaign(db, activeCampaignId);
    const auto campaign = waitForResult(campaignFuture);
    REQUIRE(campaign.ok);
    REQUIRE(campaign.code == PresentationReferenceCode::None);
    REQUIRE(campaign.reference.has_value());
    REQUIRE(campaign.reference->id == activeCampaignId);
    REQUIRE(campaign.reference->name == "campaign " + marker);
    REQUIRE(campaign.reference->description == "campaign description");
    REQUIRE(campaign.reference->image_url == "/web-gallery/campaign.png");
    REQUIRE(campaign.reference->destination_url ==
            "https://example.com/campaign?source=v4");

    auto hiddenCampaignFuture = findCampaign(db, hiddenCampaignId);
    const auto hiddenCampaignResult = waitForResult(hiddenCampaignFuture);
    REQUIRE_FALSE(hiddenCampaignResult.ok);
    REQUIRE(hiddenCampaignResult.code == PresentationReferenceCode::NotFound);

    auto unsafeCampaignFuture = findCampaign(db, unsafeCampaignId);
    const auto unsafeCampaignResult = waitForResult(unsafeCampaignFuture);
    REQUIRE_FALSE(unsafeCampaignResult.ok);
    REQUIRE(unsafeCampaignResult.code == PresentationReferenceCode::UnsafeField);

    auto unsafeCampaignUrlFuture = findCampaign(db, unsafeCampaignUrlId);
    const auto unsafeCampaignUrlResult = waitForResult(unsafeCampaignUrlFuture);
    REQUIRE_FALSE(unsafeCampaignUrlResult.ok);
    REQUIRE(unsafeCampaignUrlResult.code == PresentationReferenceCode::UnsafeField);

    auto invalidBannerFuture = findBanner(db, 0);
    const auto invalidBanner = waitForResult(invalidBannerFuture);
    REQUIRE_FALSE(invalidBanner.ok);
    REQUIRE(invalidBanner.code == PresentationReferenceCode::InvalidInput);

    auto invalidCampaignFuture = findCampaign(db, 2000000001U);
    const auto invalidCampaign = waitForResult(invalidCampaignFuture);
    REQUIRE_FALSE(invalidCampaign.ok);
    REQUIRE(invalidCampaign.code == PresentationReferenceCode::InvalidInput);

    auto noDbBanner = findBanner(drogon::orm::DbClientPtr{}, activeBannerId);
    const auto noDbBannerResult = waitForResult(noDbBanner);
    REQUIRE_FALSE(noDbBannerResult.ok);
    REQUIRE(noDbBannerResult.code == PresentationReferenceCode::Unavailable);

    REQUIRE(cleanup.cleanupRows());
}
