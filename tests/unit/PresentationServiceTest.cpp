#include <catch2/catch_test_macros.hpp>

#include "services/PresentationService.h"

#include <utility>

using hotel::services::PresentationDocumentKind;
using hotel::services::PresentationService;
using hotel::services::PresentationServiceCode;
using hotel::services::PresentationServiceResult;

namespace {
Json::Value validNavigationDocument(uint32_t revision) {
    Json::Value document(Json::objectValue);
    document["revision"] = revision;
    document["items"] = Json::Value(Json::arrayValue);
    return document;
}

Json::Value validPageDocument(const std::string& path, uint32_t revision) {
    Json::Value document(Json::objectValue);
    document["path"] = path;
    document["revision"] = revision;
    document["slots"] = Json::Value(Json::arrayValue);
    return document;
}
}  // namespace

TEST_CASE("Presentation document keys are restricted to typed public documents",
          "[presentation]") {
    REQUIRE(PresentationService::kindForDocumentKey("navigation") ==
            PresentationDocumentKind::Navigation);
    REQUIRE(PresentationService::kindForDocumentKey("page:/community") ==
            PresentationDocumentKind::Page);
    REQUIRE(PresentationService::kindForDocumentKey("page:/articles/12-safe-title") ==
            PresentationDocumentKind::Page);
    REQUIRE(PresentationService::kindForDocumentKey("page:/groups/Cool-Name") ==
            PresentationDocumentKind::Page);

    REQUIRE_FALSE(PresentationService::kindForDocumentKey("settings"));
    REQUIRE_FALSE(PresentationService::kindForDocumentKey("page:/housekeeping"));
    REQUIRE_FALSE(PresentationService::kindForDocumentKey("page:/home/not-a-number"));
    REQUIRE_FALSE(PresentationService::kindForDocumentKey("page:/groups/actions"));
    REQUIRE_FALSE(PresentationService::kindForDocumentKey("page:/community/../admin"));
}

TEST_CASE("Presentation persistence declares the current document contract version",
          "[presentation]") {
    REQUIRE(hotel::services::kPresentationContractVersion == 1);
}

TEST_CASE("Presentation document content must match its typed key",
          "[presentation]") {
    REQUIRE(PresentationService::validateDocumentForKey(
                "navigation", validNavigationDocument(1))
                .ok);
    REQUIRE(PresentationService::validateDocumentForKey(
                "page:/community", validPageDocument("/community", 1))
                .ok);

    auto mismatchedPage = validPageDocument("/articles/12", 1);
    const auto mismatch = PresentationService::validateDocumentForKey(
        "page:/community", mismatchedPage);
    REQUIRE_FALSE(mismatch.ok);
    REQUIRE(mismatch.field == "path");

    const auto invalidKey = PresentationService::validateDocumentForKey(
        "page:/housekeeping", validPageDocument("/housekeeping", 1));
    REQUIRE_FALSE(invalidKey.ok);
}

TEST_CASE("Malformed draft shapes return validation errors without touching storage",
          "[presentation]") {
    const auto reject = [](Json::Value document) {
        bool callbackCalled = false;
        PresentationServiceResult response;
        PresentationService::saveDraft(
            drogon::orm::DbClientPtr{}, 7, "navigation", 0, document, "",
            [&](PresentationServiceResult result) {
                callbackCalled = true;
                response = std::move(result);
            });
        REQUIRE(callbackCalled);
        REQUIRE_FALSE(response.ok);
        REQUIRE(response.code == PresentationServiceCode::InvalidInput);
        REQUIRE(response.field == "document");
    };

    reject(Json::Value(Json::arrayValue));
    reject(Json::Value(42));
    reject(Json::Value());
}

TEST_CASE("Presentation schema failure does not advance startup readiness",
          "[presentation]") {
    bool callbackCalled = false;
    PresentationService::ensureSchema(
        drogon::orm::DbClientPtr{}, [&callbackCalled]() { callbackCalled = true; });
    REQUIRE_FALSE(callbackCalled);
}
