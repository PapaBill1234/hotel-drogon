#include <catch2/catch_test_macros.hpp>

#include "services/PresentationService.h"

using hotel::services::PresentationDocumentKind;
using hotel::services::PresentationService;

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
