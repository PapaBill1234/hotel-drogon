#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace hotel::services {

enum class PresentationReferenceCode {
    None,
    InvalidInput,
    NotFound,
    Unsupported,
    UnsafeField,
    Unavailable,
};

/**
 * Typed, renderable fields from an active legacy banner.
 * Text is unescaped plain text for React text nodes; raw HTML is never returned.
 */
struct PresentationBannerReference {
    uint32_t id = 0;
    std::string text;
    std::optional<std::string> image_url;
    std::optional<std::string> destination_url;
};

/** Typed, renderable fields from a visible legacy campaign. */
struct PresentationCampaignReference {
    uint32_t id = 0;
    std::string name;
    std::string description;
    std::optional<std::string> image_url;
    std::optional<std::string> destination_url;
};

struct PresentationBannerReferenceResult {
    bool ok = false;
    PresentationReferenceCode code = PresentationReferenceCode::Unavailable;
    std::string field;
    std::string message;
    std::optional<PresentationBannerReference> reference;
};

struct PresentationCampaignReferenceResult {
    bool ok = false;
    PresentationReferenceCode code = PresentationReferenceCode::Unavailable;
    std::string field;
    std::string message;
    std::optional<PresentationCampaignReference> reference;
};

/**
 * Read-only resolver for the existing website-owned banner and campaign rows.
 * Public queries require their legacy active flag and return only fields that
 * the typed React renderer can safely consume. No table or column is selected
 * by caller input.
 */
class PresentationReferenceService {
public:
    static void findPublicBannerById(
        uint32_t id,
        std::function<void(PresentationBannerReferenceResult)> callback);
    static void findPublicBannerById(
        const drogon::orm::DbClientPtr& db,
        uint32_t id,
        std::function<void(PresentationBannerReferenceResult)> callback);

    static void findPublicCampaignById(
        uint32_t id,
        std::function<void(PresentationCampaignReferenceResult)> callback);
    static void findPublicCampaignById(
        const drogon::orm::DbClientPtr& db,
        uint32_t id,
        std::function<void(PresentationCampaignReferenceResult)> callback);
};

}  // namespace hotel::services
