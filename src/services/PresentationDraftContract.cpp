#include "services/PresentationDraftContract.h"

#include <unordered_set>

namespace hotel::services {
namespace {
PresentationValidationResult fail(PresentationValidationCode code, const std::string& field,
                                   const std::string& message) {
    return PresentationValidationResult::failure(code, field, message);
}

bool exactObject(const Json::Value& value, std::initializer_list<const char*> names) {
    if (!value.isObject()) return false;
    const auto members = value.getMemberNames();
    if (members.size() != names.size()) return false;
    for (const auto* name : names) if (!value.isMember(name)) return false;
    return true;
}
}

bool PresentationDraftContract::isDocumentKey(const std::string& kind, const std::string& key) {
    if (kind == "navigation") return key == "navigation";
    return kind == "page" && PresentationValidationService::isKnownPublicRoute(key);
}

PresentationValidationResult PresentationDraftContract::validateRequest(const Json::Value& request) {
    if (!exactObject(request, {"document_kind", "document_key", "based_on", "payload"}))
        return fail(PresentationValidationCode::invalid_document, "request", "draft request has unexpected or missing fields");
    if (!request["document_kind"].isString() ||
        (request["document_kind"].asString() != "navigation" && request["document_kind"].asString() != "page"))
        return fail(PresentationValidationCode::invalid_field, "document_kind", "document_kind must be navigation or page");
    const auto kind = request["document_kind"].asString();
    if (!request["document_key"].isString() || !isDocumentKey(kind, request["document_key"].asString()))
        return fail(PresentationValidationCode::unknown_route, "document_key", "document_key is not an allowed website document");
    if (!request["based_on"].isUInt() || request["based_on"].asUInt() > 1000000000U)
        return fail(PresentationValidationCode::invalid_field, "based_on", "based_on must be a bounded revision");
    if (kind == "navigation") {
        auto result = PresentationValidationService::validateNavigation(request["payload"]);
        if (!result.ok) { result.field = "payload." + result.field; return result; }
    } else {
        auto result = PresentationValidationService::validatePage(request["payload"]);
        if (!result.ok) { result.field = "payload." + result.field; return result; }
    }
    // The client must submit the revision it actually edited. Keeping the
    // envelope's compare-and-swap value and the typed document revision equal
    // prevents a stale payload from being paired with a fresh base by mistake.
    if (!request["payload"].isMember("revision") ||
        !request["payload"]["revision"].isUInt() ||
        request["payload"]["revision"].asUInt() != request["based_on"].asUInt())
        return fail(PresentationValidationCode::invalid_field, "payload.revision", "payload revision must equal based_on");
    return PresentationValidationResult::success();
}

}  // namespace hotel::services
