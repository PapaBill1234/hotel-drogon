#include "services/PresentationValidationService.h"

#include <algorithm>
#include <cctype>
#include <initializer_list>
#include <string_view>
#include <unordered_set>

namespace hotel::services {
namespace {

constexpr Json::ArrayIndex kMaxItems = 100;
constexpr unsigned int kMaxRevision = 1000000000U;
constexpr int kMaxOrder = 100000;
constexpr int kMaxId = 2147483647;
constexpr int kMaxNewsLimit = 100;
constexpr std::size_t kMaxString = 256;

PresentationValidationResult fail(PresentationValidationCode code,
                                   const std::string& field,
                                   const std::string& message) {
    return PresentationValidationResult::failure(code, field, message);
}

bool hasOnly(const Json::Value& value,
             std::initializer_list<const char*> allowed) {
    if (!value.isObject()) return false;
    for (const auto& name : value.getMemberNames()) {
        bool found = false;
        for (const auto* candidate : allowed) {
            if (name == candidate) {
                found = true;
                break;
            }
        }
        if (!found) return false;
    }
    return true;
}

bool validString(const Json::Value& value, std::size_t max = kMaxString) {
    if (!value.isString() || value.asString().empty() || value.asString().size() > max) return false;
    // Presentation text is plain text in the v4 contract. React escapes it at
    // render time, but rejecting markup-shaped values here keeps the API
    // contract explicit and prevents a later renderer from reinterpreting it.
    return value.asString().find('<') == std::string::npos &&
           value.asString().find('>') == std::string::npos;
}

bool validRevision(const Json::Value& value) {
    return value.isUInt() && value.asUInt() <= kMaxRevision;
}

bool validBoundedInt(const Json::Value& value, int min, int max) {
    if (value.isInt()) {
        return value.asInt() >= min && value.asInt() <= max;
    }
    if (value.isUInt()) {
        return value.asUInt() <= static_cast<unsigned int>(max) &&
               static_cast<int>(value.asUInt()) >= min;
    }
    return false;
}

bool validArray(const Json::Value& value) {
    return value.isArray() && value.size() <= kMaxItems;
}

bool validVisibility(const Json::Value& value) {
    if (!value.isString()) return false;
    const auto visibility = value.asString();
    return visibility == "everyone" || visibility == "guest" ||
           visibility == "user" || visibility == "staff";
}

bool validPathSegment(std::string_view segment) {
    return !segment.empty() && segment.size() <= 128 &&
           std::all_of(segment.begin(), segment.end(), [](unsigned char c) {
               return std::isalnum(c) || c == '-' || c == '_' || c == '.';
           });
}

bool validExternalUrl(const std::string& url) {
    if (url.size() > 2048 || url.rfind("https://", 0) != 0) return false;
    const std::string_view rest(url.data() + 8, url.size() - 8);
    if (rest.empty() || rest.find_first_of("/?#@\\\r\n\t ") == 0 ||
        rest.find('#') != std::string_view::npos ||
        rest.find('@') != std::string_view::npos) return false;
    const auto slash = rest.find('/');
    const auto query = rest.find('?');
    const auto end = std::min(slash == std::string_view::npos ? rest.size() : slash,
                              query == std::string_view::npos ? rest.size() : query);
    const auto host = rest.substr(0, end);
    if (host.empty() || host.size() > 253 || host.front() == '.' || host.back() == '.') return false;
    bool hasDot = false;
    bool labelStart = true;
    for (const unsigned char c : host) {
        if (c == '.') {
            if (labelStart) return false;
            hasDot = true;
            labelStart = true;
        } else if (std::isalnum(c) || c == '-') {
            if (labelStart && c == '-') return false;
            labelStart = false;
        } else {
            return false;
        }
    }
    return !labelStart && hasDot;
}

PresentationValidationResult validateTarget(const Json::Value& target, const std::string& field) {
    if (!target.isObject() || !target.isMember("kind") || !target["kind"].isString())
        return fail(PresentationValidationCode::invalid_field, field, "target must be a valid object");
    const auto kind = target["kind"].asString();
    if (kind == "none") {
        if (!hasOnly(target, {"kind"})) return fail(PresentationValidationCode::invalid_field, field, "none target has unknown properties");
        return PresentationValidationResult::success();
    }
    if (kind == "route") {
        if (!hasOnly(target, {"kind", "path"}) || !target["path"].isString() ||
            !PresentationValidationService::isKnownPublicRoute(target["path"].asString()))
            return fail(PresentationValidationCode::unknown_route, field + ".path", "route is not a known public path");
        return PresentationValidationResult::success();
    }
    if (kind == "external") {
        if (!hasOnly(target, {"kind", "url"}) || !target["url"].isString() ||
            !validExternalUrl(target["url"].asString()))
            return fail(PresentationValidationCode::unsafe_target, field + ".url", "external target must be a safe https URL");
        return PresentationValidationResult::success();
    }
    return fail(PresentationValidationCode::invalid_field, field + ".kind", "unknown target kind");
}

PresentationValidationResult validateBlock(const Json::Value& block, const std::string& field) {
    if (!block.isObject() || !block.isMember("type") || !block["type"].isString())
        return fail(PresentationValidationCode::invalid_block, field, "block must have a type");
    const auto type = block["type"].asString();
    if (type == "heading") {
        if (!hasOnly(block, {"type", "textKey", "level"}) || !validString(block["textKey"]) ||
            !PresentationValidationService::isSafeKey(block["textKey"].asString()) ||
            !validBoundedInt(block["level"], 2, 3))
            return fail(PresentationValidationCode::invalid_block, field, "invalid heading block");
    } else if (type == "paragraph") {
        if (!hasOnly(block, {"type", "textKey"}) || !validString(block["textKey"]) ||
            !PresentationValidationService::isSafeKey(block["textKey"].asString()))
            return fail(PresentationValidationCode::invalid_block, field, "invalid paragraph block");
    } else if (type == "newsList") {
        if (!hasOnly(block, {"type", "limit", "source"}) ||
            !validBoundedInt(block["limit"], 1, kMaxNewsLimit) || !block["source"].isString() ||
            (block["source"].asString() != "articles" && block["source"].asString() != "community"))
            return fail(PresentationValidationCode::invalid_block, field, "invalid newsList block");
    } else if (type == "bannerSlot" || type == "campaignSlot") {
        const char* idName = type == "bannerSlot" ? "bannerId" : "campaignId";
        if (!hasOnly(block, {"type", idName}) || !validBoundedInt(block[idName], 1, kMaxId))
            return fail(PresentationValidationCode::invalid_block, field, "invalid slot block");
    } else if (type == "faqList") {
        if (!hasOnly(block, {"type", "category"}) ||
            (block.isMember("category") && (!validString(block["category"]) ||
             !PresentationValidationService::isSafeKey(block["category"].asString()))))
            return fail(PresentationValidationCode::invalid_block, field, "invalid faqList block");
    } else if (type == "collectables") {
        if (!hasOnly(block, {"type"})) return fail(PresentationValidationCode::invalid_block, field, "invalid collectables block");
    } else {
        return fail(PresentationValidationCode.unknown_block, field + ".type", "unknown block type");
    }
    return PresentationValidationResult::success();
}

}  // namespace

PresentationValidationResult PresentationValidationResult::success() {
    return {true, PresentationValidationCode::none, {}, {}};
}

PresentationValidationResult PresentationValidationResult::failure(PresentationValidationCode code,
                                                                    std::string field,
                                                                    std::string message) {
    return {false, code, std::move(field), std::move(message)};
}

bool PresentationValidationService::isSafeKey(const std::string& key) {
    if (key.empty() || key.size() > 96) return false;
    return std::all_of(key.begin(), key.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ':';
    });
}

bool PresentationValidationService::isKnownPublicRoute(const std::string& path) {
    static const std::unordered_set<std::string> routes = {
        "/", "/community", "/articles", "/help", "/credits/collectables", "/maintenance",
        "/credits", "/credits/history", "/client", "/forgot", "/account", "/logout",
        "/account/logout", "/me", "/account/profile", "/account/password/forgot",
        "/account/password/reset", "/account/reauthenticate", "/papers/disclaimer",
        "/papers/privacy", "/tag", "/register", "/credits/club", "/credits/pixels",
        "/habblet/proxy.php"
    };
    if (routes.count(path) != 0) return true;
    if (path.rfind("/articles/", 0) == 0 || path.rfind("/help/", 0) == 0 ||
        path.rfind("/groups/", 0) == 0) {
        return validPathSegment(path.substr(path.find('/', 1) + 1));
    }
    if (path.rfind("/home/", 0) == 0) {
        const auto rest = path.substr(6);
        const auto edit = rest.rfind("/edit");
        return edit == std::string::npos ? validPathSegment(rest)
                                         : edit > 0 && edit + 5 == rest.size() && validPathSegment(rest.substr(0, edit));
    }
    if (path.rfind("/myhabbo/startSession/", 0) == 0)
        return validPathSegment(path.substr(23));
    return false;
}

PresentationValidationResult PresentationValidationService::validateNavigation(const Json::Value& document) {
    if (!document.isObject() || !hasOnly(document, {"revision", "items"}) ||
        !validRevision(document["revision"]) || !validArray(document["items"]))
        return fail(PresentationValidationCode::invalid_document, "document", "invalid navigation document");
    std::unordered_set<std::string> keys;
    for (Json::ArrayIndex i = 0; i < document["items"].size(); ++i) {
        const auto& item = document["items"][i];
        const auto field = "items[" + std::to_string(i) + "]";
        if (!item.isObject() || !hasOnly(item, {"key", "label", "target", "visibility", "order", "badgeKey"}) ||
            !validString(item["key"]) || !isSafeKey(item["key"].asString()) ||
            !keys.insert(item["key"].asString()).second)
            return fail(PresentationValidationCode::duplicate_key, field + ".key", "navigation key is missing, unsafe, or duplicated");
        if (!validString(item["label"]) || !validVisibility(item["visibility"]) || !validBoundedInt(item["order"], 0, kMaxOrder) ||
            (item.isMember("badgeKey") && (!validString(item["badgeKey"]) || !isSafeKey(item["badgeKey"].asString()))))
            return fail(PresentationValidationCode::invalid_field, field, "invalid navigation item");
        auto target = validateTarget(item["target"], field + ".target");
        if (!target.ok) return target;
    }
    return PresentationValidationResult::success();
}

PresentationValidationResult PresentationValidationService::validatePage(const Json::Value& document) {
    if (!document.isObject() || !hasOnly(document, {"path", "revision", "slots"}) ||
        !validString(document["path"]) || !isKnownPublicRoute(document["path"].asString()) ||
        !validRevision(document["revision"]) || !validArray(document["slots"]))
        return fail(PresentationValidationCode::invalid_document, "document", "invalid page document");
    std::unordered_set<std::string> keys;
    for (Json::ArrayIndex i = 0; i < document["slots"].size(); ++i) {
        const auto& slot = document["slots"][i];
        const auto field = "slots[" + std::to_string(i) + "]";
        if (!slot.isObject() || !hasOnly(slot, {"key", "block", "visibility", "order"}) ||
            !validString(slot["key"]) || !isSafeKey(slot["key"].asString()) ||
            !keys.insert(slot["key"].asString()).second)
            return fail(PresentationValidationCode::duplicate_key, field + ".key", "page slot key is missing, unsafe, or duplicated");
        if (!validVisibility(slot["visibility"]) || !validBoundedInt(slot["order"], 0, kMaxOrder))
            return fail(PresentationValidationCode::invalid_field, field, "invalid page slot");
        auto block = validateBlock(slot["block"], field + ".block");
        if (!block.ok) return block;
    }
    return PresentationValidationResult::success();
}

}  // namespace hotel::services
