#include <catch2/catch_test_macros.hpp>
#include <json/value.h>

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
