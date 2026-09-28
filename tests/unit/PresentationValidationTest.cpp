#include <catch2/catch_test_macros.hpp>
#include <json/value.h>

#include <utility>
#include <vector>

#include "services/PresentationValidationService.h"

using hotel::services::PresentationValidationCode;
using hotel::services::PresentationValidationService;

namespace {
Json::Value validNavigation() {
    Json::Value document(Json::objectValue);
    document["revision"] = 4U;
    Json::Value item(Json::objectValue);
    item["key"] = "home";
    item["label"] = "Home";
    item["visibility"] = "everyone";
    item["order"] = 0;
    item["target"]["kind"] = "route";
    item["target"]["path"] = "/";
    document["items"].append(item);
    return document;
}

Json::Value validPage() {
    Json::Value document(Json::objectValue);
    document["path"] = "/community";
    document["revision"] = 2U;
    Json::Value slot(Json::objectValue);
    slot["key"] = "intro";
    slot["visibility"] = "everyone";
    slot["order"] = 1;
    slot["block"]["type"] = "heading";
    slot["block"]["textKey"] = "community.title";
    slot["block"]["level"] = 2;
    document["slots"].append(slot);
    return document;
}
}  // namespace

TEST_CASE("Presentation validation accepts valid navigation and page documents", "[presentation]") {
    REQUIRE(PresentationValidationService::validateNavigation(validNavigation()).ok);
    REQUIRE(PresentationValidationService::validatePage(validPage()).ok);
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/articles/12-safe-title"));
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/home/42/edit"));
    REQUIRE(PresentationValidationService::isSafeKey("community.title"));
}

TEST_CASE("Presentation route targets match the current route parameter shapes", "[presentation]") {
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/articles/12-safe-title"));
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/help/12"));
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/groups/Cool-Name"));
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/home/42/edit"));
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/myhabbo/startSession/1"));

    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/articles/.."));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/home/../edit"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/home/not-a-number"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/home/2147483648/edit"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/myhabbo/startSession/abc"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/help/faqsearch"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/groups/actions"));
}

TEST_CASE("Presentation validation rejects unsafe navigation targets and duplicate keys", "[presentation]") {
    auto document = validNavigation();
    document["items"][0]["target"]["path"] = "/housekeeping/settings";
    auto result = PresentationValidationService::validateNavigation(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::unknown_route);
    REQUIRE(result.field == "items[0].target.path");

    document = validNavigation();
    document["items"].append(document["items"][0]);
    result = PresentationValidationService::validateNavigation(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::duplicate_key);

    document = validNavigation();
    document["items"][0]["target"]["kind"] = "external";
    document["items"][0]["target"].removeMember("path");
    document["items"][0]["target"]["url"] = "https://user:pass@example.com/#x";
    result = PresentationValidationService::validateNavigation(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::unsafe_target);
}

TEST_CASE("Presentation external targets reject unsafe URL suffix characters", "[presentation]") {
    auto document = validNavigation();
    document["items"][0]["target"]["kind"] = "external";
    document["items"][0]["target"].removeMember("path");
    document["items"][0]["target"]["url"] = "https://example.com/news?source=community";
    REQUIRE(PresentationValidationService::validateNavigation(document).ok);

    const std::vector<std::string> unsafeUrls = {
        "http://example.com/news",
        "javascript:alert(1)",
        "https://example.com/a b",
        "https://example.com/line\nbreak",
        "https://example.com/line\tbreak",
        "https://example.com/path\\attacker.test",
        "https://example.com/#fragment",
    };
    for (const auto& url : unsafeUrls) {
        document["items"][0]["target"]["url"] = url;
        const auto result = PresentationValidationService::validateNavigation(document);
        REQUIRE_FALSE(result.ok);
        REQUIRE(result.code == PresentationValidationCode::unsafe_target);
    }
}

TEST_CASE("Presentation validation rejects unknown properties and blocks", "[presentation]") {
    auto document = validPage();
    document["unexpected"] = true;
    auto result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_document);

    document = validPage();
    document["slots"][0]["block"]["type"] = "html";
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::unknown_block);

    document = validPage();
    document["slots"][0]["block"]["extra"] = "nope";
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_block);
}

TEST_CASE("Presentation block registry accepts only bounded typed props", "[presentation]") {
    auto document = validPage();
    std::vector<Json::Value> blocks(7, Json::Value(Json::objectValue));

    blocks[0]["type"] = "heading";
    blocks[0]["textKey"] = "community.title";
    blocks[0]["level"] = 2;
    blocks[1]["type"] = "paragraph";
    blocks[1]["textKey"] = "community.description";
    blocks[2]["type"] = "newsList";
    blocks[2]["limit"] = 5;
    blocks[2]["source"] = "articles";
    blocks[3]["type"] = "bannerSlot";
    blocks[3]["bannerId"] = 1;
    blocks[4]["type"] = "campaignSlot";
    blocks[4]["campaignId"] = 2;
    blocks[5]["type"] = "faqList";
    blocks[5]["category"] = "account";
    blocks[6]["type"] = "collectables";

    for (const auto& block : blocks) {
        document["slots"][0]["block"] = block;
        REQUIRE(PresentationValidationService::validatePage(document).ok);
    }

    document = validPage();
    document["slots"][0]["visibility"] = "administrator";
    auto result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_field);

    document = validPage();
    document["slots"][0]["block"]["type"] = "newsList";
    document["slots"][0]["block"]["limit"] = 101;
    document["slots"][0]["block"]["source"] = "phpretro_news";
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_block);

    document = validPage();
    document["slots"][0]["block"]["type"] = "bannerSlot";
    document["slots"][0]["block"]["bannerId"] = 0;
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_block);

    document = validPage();
    document["slots"][0]["block"]["textKey"] = "<h1>unsafe</h1>";
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_block);
}

TEST_CASE("Presentation validation fails closed on invalid scalar ranges", "[presentation]") {
    auto document = validPage();
    document["revision"] = -1;
    auto result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_document);

    document = validPage();
    document["slots"][0]["order"] = 100001;
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_field);
}

TEST_CASE("Presentation output orders navigation and page slots by order then key",
          "[presentation]") {
    auto navigation = validNavigation();
    navigation["items"][0]["key"] = "z";
    navigation["items"][0]["order"] = 1;
    auto navItem = navigation["items"][0];
    navItem["key"] = "B";
    navItem["order"] = 0;
    navigation["items"].append(navItem);
    navItem["key"] = "a";
    navigation["items"].append(navItem);

    const auto orderedNavigation =
        PresentationValidationService::validateAndOrderNavigation(navigation);
    REQUIRE(orderedNavigation.validation.ok);
    REQUIRE(orderedNavigation.document["items"][0]["key"].asString() == "B");
    REQUIRE(orderedNavigation.document["items"][1]["key"].asString() == "a");
    REQUIRE(orderedNavigation.document["items"][2]["key"].asString() == "z");
    REQUIRE(navigation["items"][0]["key"].asString() == "z");

    Json::Value reversedNavItems(Json::arrayValue);
    reversedNavItems.append(navigation["items"][2]);
    reversedNavItems.append(navigation["items"][1]);
    reversedNavItems.append(navigation["items"][0]);
    auto permutedNavigation = navigation;
    permutedNavigation["items"] = std::move(reversedNavItems);
    const auto reorderedNavigation =
        PresentationValidationService::validateAndOrderNavigation(permutedNavigation);
    REQUIRE(reorderedNavigation.validation.ok);
    REQUIRE(reorderedNavigation.document == orderedNavigation.document);

    auto page = validPage();
    page["slots"][0]["key"] = "z";
    page["slots"][0]["order"] = 1;
    auto pageSlot = page["slots"][0];
    pageSlot["key"] = "b";
    pageSlot["order"] = 0;
    page["slots"].append(pageSlot);
    pageSlot["key"] = "A";
    page["slots"].append(pageSlot);

    const auto orderedPage = PresentationValidationService::validateAndOrderPage(page);
    REQUIRE(orderedPage.validation.ok);
    REQUIRE(orderedPage.document["slots"][0]["key"].asString() == "A");
    REQUIRE(orderedPage.document["slots"][1]["key"].asString() == "b");
    REQUIRE(orderedPage.document["slots"][2]["key"].asString() == "z");
    REQUIRE(page["slots"][0]["key"].asString() == "z");

    Json::Value reversedPageSlots(Json::arrayValue);
    reversedPageSlots.append(page["slots"][2]);
    reversedPageSlots.append(page["slots"][1]);
    reversedPageSlots.append(page["slots"][0]);
    auto permutedPage = page;
    permutedPage["slots"] = std::move(reversedPageSlots);
    const auto reorderedPage = PresentationValidationService::validateAndOrderPage(permutedPage);
    REQUIRE(reorderedPage.validation.ok);
    REQUIRE(reorderedPage.document == orderedPage.document);
}

TEST_CASE("Presentation ordering rejects invalid documents without mutating them",
          "[presentation]") {
    auto navigation = validNavigation();
    navigation["items"][0]["order"] = -1;
    const auto originalNavigation = navigation;
    const auto invalidNavigation =
        PresentationValidationService::validateAndOrderNavigation(navigation);
    REQUIRE_FALSE(invalidNavigation.validation.ok);
    REQUIRE(navigation == originalNavigation);

    auto page = validPage();
    page["slots"][0]["order"] = 100001;
    const auto originalPage = page;
    const auto invalidPage = PresentationValidationService::validateAndOrderPage(page);
    REQUIRE_FALSE(invalidPage.validation.ok);
    REQUIRE(page == originalPage);
}

TEST_CASE("Presentation media and link URLs fail closed",
          "[presentation]") {
    const auto localMedia =
        PresentationValidationService::normalizePresentationMediaUrl(
            "web-gallery/images/banner.png");
    REQUIRE(localMedia.has_value());
    REQUIRE(*localMedia == "/web-gallery/images/banner.png");
    const auto rootedMedia =
        PresentationValidationService::normalizePresentationMediaUrl(
            "/web-gallery/images/campaign.webp");
    REQUIRE(rootedMedia.has_value());
    REQUIRE(*rootedMedia == "/web-gallery/images/campaign.webp");
    const auto externalMedia =
        PresentationValidationService::normalizePresentationMediaUrl(
            "https://cdn.example.com/banners/summer.png?size=640");
    REQUIRE(externalMedia.has_value());
    REQUIRE(*externalMedia == "https://cdn.example.com/banners/summer.png?size=640");

    const std::vector<std::string> unsafeMedia = {
        "",
        "http://cdn.example.com/banner.png",
        "//cdn.example.com/banner.png",
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "b.png",
        "/account/logout",
        "/housekeeping/images/admin.gif",
        "/assets/logo.svg",
        "web-gallery",
        "/web-gallery/../secret.png",
        "/web-gallery//secret.png",
        "web-gallery/%2e%2e/secret.png",
        "web-gallery\\secret.png",
        "web-gallery/images/banner image.png",
        "https://user@cdn.example.com/banner.png",
        "https://cdn.example.com/\"><svg/onload=alert(1)>",
        "https://cdn.example.com/banner.png' onclick='alert(1)",
        "https://cdn.example.com/banner%GG.png",
        "https://cdn-.example.com/banner.png",
        std::string("https://") + std::string(64, 'a') + ".example.com/banner.png",
    };
    for (const auto& url : unsafeMedia) {
        INFO("unexpectedly accepted media URL: " << url);
        REQUIRE_FALSE(
            PresentationValidationService::normalizePresentationMediaUrl(url).has_value());
    }

    REQUIRE(PresentationValidationService::isSafePresentationLinkUrl(""));
    REQUIRE(PresentationValidationService::isSafePresentationLinkUrl("/community"));
    REQUIRE(PresentationValidationService::isSafePresentationLinkUrl(
        "/articles/12-safe-title"));
    REQUIRE(PresentationValidationService::isSafePresentationLinkUrl(
        "https://example.com/campaign?source=banner"));
    const std::vector<std::string> unsafeLinks = {
        "http://example.com/campaign",
        "//example.com/campaign",
        "javascript:alert(1)",
        "data:text/html,unsafe",
        "https://example.com/\"><svg/onload=alert(1)>",
        "https://example.com/path' onclick='alert(1)",
        "https://example.com/banner%GG.png",
        std::string("https://") + std::string(64, 'a') + ".example.com/path",
        "/housekeeping/settings",
        "/community?next=https://attacker.example",
        "/community/../housekeeping",
    };
    for (const auto& url : unsafeLinks) {
        INFO("unexpectedly accepted link URL: " << url);
        REQUIRE_FALSE(PresentationValidationService::isSafePresentationLinkUrl(url));
    }
}
