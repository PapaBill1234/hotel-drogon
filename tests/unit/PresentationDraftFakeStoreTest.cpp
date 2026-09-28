#include <catch2/catch_test_macros.hpp>
#include <json/value.h>
#include <map>
#include <string>

#include "services/PresentationDraftOutcome.h"

namespace {

struct FakeDraft {
    uint32_t revision = 0;
    Json::Value payload;
};

class FakeDraftStore {
public:
    hotel::services::PresentationDraftOutcome save(const std::string& kind,
                                                    const std::string& key,
                                                    uint32_t basedOn,
                                                    const Json::Value& payload,
                                                    bool auditSucceeds) {
        const auto storeKey = kind + "\n" + key;
        auto found = drafts.find(storeKey);
        const uint32_t current = found == drafts.end() ? 0 : found->second.revision;
        if (current != basedOn) {
            return hotel::services::PresentationDraftOutcome::failure(
                hotel::services::PresentationDraftError::conflict,
                "Draft revision is stale.", current);
        }
        if (!auditSucceeds) {
            return hotel::services::PresentationDraftOutcome::failure(
                hotel::services::PresentationDraftError::unavailable,
                "Draft audit could not be committed.");
        }
        drafts[storeKey] = FakeDraft{current + 1, payload};
        return hotel::services::PresentationDraftOutcome::success();
    }

    const FakeDraft* read(const std::string& kind, const std::string& key) const {
        const auto found = drafts.find(kind + "\n" + key);
        return found == drafts.end() ? nullptr : &found->second;
    }

private:
    std::map<std::string, FakeDraft> drafts;
};

Json::Value payload(const char* value) {
    Json::Value result(Json::objectValue);
    result["value"] = value;
    return result;
}

}  // namespace

TEST_CASE("Fake draft store refuses a stale writer", "[presentation][draft]") {
    FakeDraftStore store;
    REQUIRE(store.save("page", "/community", 0, payload("first"), true).ok);
    const auto stale = store.save("page", "/community", 0, payload("stale"), true);
    REQUIRE_FALSE(stale.ok);
    REQUIRE(stale.statusCode() == 409);
    REQUIRE(stale.current_revision == 1);
    REQUIRE(store.read("page", "/community")->payload["value"] == "first");
}

TEST_CASE("Fake draft store isolates document keys", "[presentation][draft]") {
    FakeDraftStore store;
    REQUIRE(store.save("page", "/community", 0, payload("community"), true).ok);
    REQUIRE(store.save("page", "/articles", 0, payload("articles"), true).ok);
    REQUIRE(store.read("page", "/community")->payload["value"] == "community");
    REQUIRE(store.read("page", "/articles")->payload["value"] == "articles");
}

TEST_CASE("Fake draft store leaves the draft unchanged when audit fails", "[presentation][draft]") {
    FakeDraftStore store;
    REQUIRE(store.save("navigation", "navigation", 0, payload("before"), true).ok);
    const auto failed = store.save("navigation", "navigation", 1, payload("uncommitted"), false);
    REQUIRE_FALSE(failed.ok);
    REQUIRE(failed.statusCode() == 503);
    REQUIRE(store.read("navigation", "navigation")->revision == 1);
    REQUIRE(store.read("navigation", "navigation")->payload["value"] == "before");
}
