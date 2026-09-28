#include <catch2/catch_test_macros.hpp>
#include <json/value.h>

#include "services/PresentationDraftService.h"

using hotel::services::PresentationDraftError;
using hotel::services::PresentationDraftResult;

namespace {

Json::Value validNavigationRequest() {
    Json::Value request(Json::objectValue);
    request["document_kind"] = "navigation";
    request["document_key"] = "navigation";
    request["based_on"] = 4U;
    request["payload"]["revision"] = 4U;
    request["payload"]["items"] = Json::arrayValue;
    Json::Value item(Json::objectValue);
    item["key"] = "home";
    item["label"] = "Home";
    item["visibility"] = "everyone";
    item["order"] = 0U;
    item["target"]["kind"] = "route";
    item["target"]["path"] = "/";
    request["payload"]["items"].append(item);
    return request;
}

}  // namespace

TEST_CASE("PresentationDraftService refuses reads before database access", "[presentation][draft][service]") {
    using hotel::services::PresentationDraftService;

    SECTION("missing actor is unauthorized") {
        bool called = false;
        PresentationDraftService::readDraft(
            nullptr, 0, 5, true, "navigation", "navigation",
            [&](PresentationDraftResult result) {
                called = true;
                REQUIRE_FALSE(result.outcome.ok);
                REQUIRE(result.outcome.statusCode() == 401);
                REQUIRE(result.outcome.error == PresentationDraftError::unauthorized);
            });
        REQUIRE(called);
    }

    SECTION("insufficient rank is forbidden") {
        bool called = false;
        PresentationDraftService::readDraft(
            nullptr, 7, 4, true, "navigation", "navigation",
            [&](PresentationDraftResult result) {
                called = true;
                REQUIRE_FALSE(result.outcome.ok);
                REQUIRE(result.outcome.statusCode() == 403);
                REQUIRE(result.outcome.error == PresentationDraftError::forbidden);
            });
        REQUIRE(called);
    }

    SECTION("unverified two factor is forbidden") {
        bool called = false;
        PresentationDraftService::readDraft(
            nullptr, 7, 5, false, "navigation", "navigation",
            [&](PresentationDraftResult result) {
                called = true;
                REQUIRE_FALSE(result.outcome.ok);
                REQUIRE(result.outcome.statusCode() == 403);
                REQUIRE(result.outcome.error == PresentationDraftError::forbidden);
            });
        REQUIRE(called);
    }
}

TEST_CASE("PresentationDraftService validates save requests before database access", "[presentation][draft][service]") {
    using hotel::services::PresentationDraftService;

    SECTION("malformed request is rejected") {
        Json::Value malformed(Json::objectValue);
        malformed["document_kind"] = "page";
        bool called = false;
        PresentationDraftService::saveDraft(
            nullptr, 7, 5, true, malformed, "127.0.0.1",
            [&](PresentationDraftResult result) {
                called = true;
                REQUIRE_FALSE(result.outcome.ok);
                REQUIRE(result.outcome.statusCode() == 400);
                REQUIRE(result.outcome.error == PresentationDraftError::invalid_request);
            });
        REQUIRE(called);
    }

    SECTION("valid request reports a bounded database failure") {
        const auto request = validNavigationRequest();
        bool called = false;
        PresentationDraftService::saveDraft(
            nullptr, 7, 5, true, request, "127.0.0.1",
            [&](PresentationDraftResult result) {
                called = true;
                REQUIRE_FALSE(result.outcome.ok);
                REQUIRE(result.outcome.statusCode() == 503);
                REQUIRE(result.outcome.error == PresentationDraftError::unavailable);
            });
        REQUIRE(called);
    }
}
