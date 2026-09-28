#include <catch2/catch_test_macros.hpp>
#include <json/value.h>
#include <string>
#include <vector>

#include "services/PresentationDraftContract.h"
#include "services/PresentationDraftOutcome.h"
#include "services/PresentationValidationService.h"

using hotel::services::PresentationDraftContract;
using hotel::services::PresentationDraftError;
using hotel::services::PresentationDraftOutcome;
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
    REQUIRE(PresentationValidationService::isKnownPublicRoute("/tag/search"));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/articles/.."));
    REQUIRE_FALSE(PresentationValidationService::isKnownPublicRoute("/logout"));
    REQUIRE(PresentationValidationService::isSafeKey("community.title"));
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

TEST_CASE("Draft outcomes map failures without implying persistence", "[presentation][draft]") {
    const auto conflict = PresentationDraftOutcome::failure(PresentationDraftError::conflict, "stale", 7);
    REQUIRE_FALSE(conflict.ok);
    REQUIRE(conflict.statusCode() == 409);
    REQUIRE(conflict.current_revision == 7);
    REQUIRE(PresentationDraftOutcome::failure(PresentationDraftError::unavailable).statusCode() == 503);
    REQUIRE(PresentationDraftOutcome::success().statusCode() == 200);
}

TEST_CASE("Draft contract accepts typed navigation envelope", "[presentation][draft]") {
    auto request = Json::Value(Json::objectValue);
    request["document_kind"] = "navigation";
    request["document_key"] = "navigation";
    request["based_on"] = 4U;
    request["payload"] = validNavigation();
    request["payload"]["revision"] = 4U;
    REQUIRE(PresentationDraftContract::validateRequest(request).ok);

    request["payload"]["revision"] = 3U;
    auto mismatch = PresentationDraftContract::validateRequest(request);
    REQUIRE_FALSE(mismatch.ok);
    REQUIRE(mismatch.field == "payload.revision");
    request["payload"]["revision"] = 4U;

    request["document_key"] = "/housekeeping/settings";
    const auto result = PresentationDraftContract::validateRequest(request);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::unknown_route);
}

TEST_CASE("Presentation validation accepts each typed block and safe HTTPS target", "[presentation]") {
    auto document = validPage();
    std::vector<Json::Value> blocks = {
        Json::Value(Json::objectValue), Json::Value(Json::objectValue),
        Json::Value(Json::objectValue), Json::Value(Json::objectValue),
        Json::Value(Json::objectValue), Json::Value(Json::objectValue),
        Json::Value(Json::objectValue)};
    blocks[0]["type"] = "heading"; blocks[0]["textKey"] = "x"; blocks[0]["level"] = 3;
    blocks[1]["type"] = "paragraph"; blocks[1]["textKey"] = "x";
    blocks[2]["type"] = "newsList"; blocks[2]["limit"] = 5; blocks[2]["source"] = "articles";
    blocks[3]["type"] = "bannerSlot"; blocks[3]["bannerId"] = 1;
    blocks[4]["type"] = "campaignSlot"; blocks[4]["campaignId"] = 1;
    blocks[5]["type"] = "faqList"; blocks[5]["category"] = "general";
    blocks[6]["type"] = "collectables";
    document["slots"] = Json::Value(Json::arrayValue);
    for (Json::ArrayIndex i = 0; i < blocks.size(); ++i) {
        Json::Value slot(Json::objectValue);
        slot["key"] = "slot-" + std::to_string(i);
        slot["visibility"] = "everyone";
        slot["order"] = static_cast<int>(i);
        slot["block"] = blocks[i];
        document["slots"].append(slot);
    }
    REQUIRE(PresentationValidationService::validatePage(document).ok);

    auto navigation = validNavigation();
    navigation["items"][0]["target"]["kind"] = "external";
    navigation["items"][0]["target"].removeMember("path");
    navigation["items"][0]["target"]["url"] = "https://example.com/landing?source=cms";
    REQUIRE(PresentationValidationService::validateNavigation(navigation).ok);

    navigation["items"][0]["target"]["url"] = "https://example.com:443/landing";
    REQUIRE(PresentationValidationService::validateNavigation(navigation).ok);
    navigation["items"][0]["target"]["url"] = "https://example.com:bad/landing";
    REQUIRE_FALSE(PresentationValidationService::validateNavigation(navigation).ok);
}

TEST_CASE("Presentation validation rejects markup and invalid scalar ranges", "[presentation]") {
    auto document = validPage();
    document["slots"][0]["block"]["textKey"] = "<script>bad</script>";
    auto result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_block);

    document = validPage();
    document["revision"] = -1;
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_document);

    document = validPage();
    document["slots"][0]["order"] = 100001;
    result = PresentationValidationService::validatePage(document);
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.code == PresentationValidationCode::invalid_field);
}
