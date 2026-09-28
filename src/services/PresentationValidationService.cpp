#include "services/PresentationValidationService.h"

#include <algorithm>
#include <cctype>
#include <initializer_list>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

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

bool validIdSegment(std::string_view segment) {
    if (segment.empty() || segment.size() > 10) return false;
    unsigned int value = 0;
    for (const unsigned char c : segment) {
        if (c < '0' || c > '9') return false;
        const auto digit = static_cast<unsigned int>(c - '0');
        const auto max = static_cast<unsigned int>(kMaxId);
        if (value > (max - digit) / 10U) return false;
        value = value * 10U + digit;
    }
    return value > 0;
}

void orderByOrderThenKey(Json::Value& entries) {
    std::vector<Json::Value> ordered;
    ordered.reserve(entries.size());
    for (const auto& entry : entries) ordered.push_back(entry);
    std::sort(ordered.begin(), ordered.end(), [](const Json::Value& left,
                                                  const Json::Value& right) {
        const int leftOrder = left["order"].asInt();
        const int rightOrder = right["order"].asInt();
        if (leftOrder != rightOrder) return leftOrder < rightOrder;
        return left["key"].asString() < right["key"].asString();
    });

    Json::Value sorted(Json::arrayValue);
    for (const auto& entry : ordered) sorted.append(entry);
    entries = std::move(sorted);
}

bool validArticleSegment(std::string_view segment) {
    const auto separator = segment.find('-');
    if (!validIdSegment(segment.substr(0, separator))) return false;
    if (separator == std::string_view::npos) return true;
    const auto slug = segment.substr(separator + 1);
    return slug.size() <= 128 &&
           std::all_of(slug.begin(), slug.end(), [](unsigned char c) {
               return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
           });
}

bool validGroupSegment(std::string_view segment) {
    if (validIdSegment(segment)) return true;
    if (segment.empty() || segment.size() > 30 ||
        !((segment.front() >= 'A' && segment.front() <= 'Z') ||
          (segment.front() >= 'a' && segment.front() <= 'z'))) return false;
    if (!std::all_of(segment.begin() + 1, segment.end(), [](unsigned char c) {
            return std::isalnum(c) || c == '-';
        })) return false;

    std::string lower;
    lower.reserve(segment.size());
    for (const unsigned char c : segment) lower += static_cast<char>(std::tolower(c));
    return lower != "actions" && lower != "id" && lower != "discussions" && lower != "home";
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
    std::size_t labelStart = 0;
    for (std::size_t i = 0; i <= host.size(); ++i) {
        if (i < host.size() && host[i] != '.') {
            const auto c = static_cast<unsigned char>(host[i]);
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                  (c >= '0' && c <= '9') || c == '-')) return false;
            continue;
        }
        if (i == labelStart || i - labelStart > 63 || host[labelStart] == '-' ||
            host[i - 1] == '-') return false;
        if (i < host.size()) hasDot = true;
        labelStart = i + 1;
    }
    if (!hasDot) return false;

    // Keep external URLs safe for either React attribute rendering or a future
    // HTML serializer: accept RFC 3986 URI characters, require valid percent
    // escapes, and reject quotes, angle brackets, backslashes and controls.
    for (std::size_t i = 0; i < url.size(); ++i) {
        const auto c = static_cast<unsigned char>(url[i]);
        const bool alphanumeric =
            (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9');
        if (alphanumeric || c == '-' || c == '.' || c == '_' || c == '~' ||
            c == ':' || c == '/' || c == '?' || c == '[' || c == ']' ||
            c == '!' || c == '$' || c == '&' || c == '(' || c == ')' ||
            c == '*' || c == '+' || c == ',' || c == ';' || c == '=') continue;
        if (c != '%' || i + 2 >= url.size()) return false;
        const auto isHex = [](unsigned char value) {
            return (value >= '0' && value <= '9') ||
                   (value >= 'a' && value <= 'f') ||
                   (value >= 'A' && value <= 'F');
        };
        if (!isHex(static_cast<unsigned char>(url[i + 1])) ||
            !isHex(static_cast<unsigned char>(url[i + 2]))) return false;
        i += 2;
    }
    return true;
}

bool safeLocalMediaPath(const std::string& url) {
    if (url.size() > 2048) return false;
    std::string_view path(url);
    if (!path.empty() && path.front() == '/') path.remove_prefix(1);
    if (path.size() <= 12 || path.substr(0, 12) != "web-gallery/" ||
        path.front() == '/') return false;
    std::size_t segmentStart = 0;
    for (std::size_t i = 0; i <= path.size(); ++i) {
        if (i < path.size()) {
            const auto c = static_cast<unsigned char>(path[i]);
            const bool alphanumeric =
                (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                (c >= '0' && c <= '9');
            if (!(alphanumeric || c == '/' || c == '-' || c == '_' ||
                  c == '.' || c == '~')) return false;
            if (c != '/') continue;
        }

        const auto segment = path.substr(segmentStart, i - segmentStart);
        if (segment.empty() || segment == "." || segment == "..") return false;
        segmentStart = i + 1;
    }
    return true;
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
        return fail(PresentationValidationCode::unknown_block, field + ".type", "unknown block type");
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
    if (path.rfind("/articles/", 0) == 0) {
        return validArticleSegment(std::string_view(path).substr(10));
    }
    if (path.rfind("/help/", 0) == 0) {
        return validIdSegment(std::string_view(path).substr(6));
    }
    if (path.rfind("/groups/", 0) == 0) {
        return validGroupSegment(std::string_view(path).substr(8));
    }
    if (path.rfind("/home/", 0) == 0) {
        const std::string_view rest(path.data() + 6, path.size() - 6);
        const auto edit = rest.find("/edit");
        return edit == std::string_view::npos ? validIdSegment(rest)
                                               : edit > 0 && edit + 5 == rest.size() &&
                                                     validIdSegment(rest.substr(0, edit));
    }
    constexpr std::string_view kStartSessionPrefix = "/myhabbo/startSession/";
    if (path.rfind(kStartSessionPrefix, 0) == 0)
        return validIdSegment(std::string_view(path).substr(kStartSessionPrefix.size()));
    return false;
}

std::optional<std::string> PresentationValidationService::normalizePresentationMediaUrl(
    const std::string& url) {
    if (validExternalUrl(url)) return url;
    if (!safeLocalMediaPath(url)) return std::nullopt;
    return url.front() == '/' ? url : "/" + url;
}

bool PresentationValidationService::isSafePresentationLinkUrl(const std::string& url) {
    return url.empty() || validExternalUrl(url) || isKnownPublicRoute(url);
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

PresentationOrderedResult PresentationValidationService::validateAndOrderNavigation(
    const Json::Value& document) {
    PresentationOrderedResult result;
    result.validation = validateNavigation(document);
    if (!result.validation.ok) return result;
    result.document = document;
    orderByOrderThenKey(result.document["items"]);
    return result;
}

PresentationOrderedResult PresentationValidationService::validateAndOrderPage(
    const Json::Value& document) {
    PresentationOrderedResult result;
    result.validation = validatePage(document);
    if (!result.validation.ok) return result;
    result.document = document;
    orderByOrderThenKey(result.document["slots"]);
    return result;
}

}  // namespace hotel::services
