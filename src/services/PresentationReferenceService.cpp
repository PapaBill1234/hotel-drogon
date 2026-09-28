#include "services/PresentationReferenceService.h"

#include "services/PresentationValidationService.h"
#include "utils/Logger.h"

#include <drogon/drogon.h>
#include <drogon/orm/Result.h>

#include <utility>

namespace hotel::services {
namespace {

constexpr uint32_t kMaxReferencedRowId = 2000000000U;

PresentationBannerReferenceResult bannerFailure(PresentationReferenceCode code,
                                                  std::string field,
                                                  std::string message) {
    PresentationBannerReferenceResult result;
    result.code = code;
    result.field = std::move(field);
    result.message = std::move(message);
    return result;
}

PresentationCampaignReferenceResult campaignFailure(PresentationReferenceCode code,
                                                      std::string field,
                                                      std::string message) {
    PresentationCampaignReferenceResult result;
    result.code = code;
    result.field = std::move(field);
    result.message = std::move(message);
    return result;
}

std::optional<std::string> safeImageUrl(const std::string& value) {
    if (value.empty()) return std::nullopt;
    return PresentationValidationService::normalizePresentationMediaUrl(value);
}

std::optional<std::string> safeDestinationUrl(const std::string& value) {
    if (value.empty()) return std::nullopt;
    if (!PresentationValidationService::isSafePresentationLinkUrl(value))
        return std::nullopt;
    return value;
}

void resolveBanner(
    const drogon::orm::DbClientPtr& db,
    uint32_t id,
    std::function<void(PresentationBannerReferenceResult)> callback) {
    if (!callback) return;
    if (id == 0 || id > kMaxReferencedRowId) {
        callback(bannerFailure(PresentationReferenceCode::InvalidInput, "bannerId",
                               "Banner id is outside the supported range."));
        return;
    }
    if (!db) {
        callback(bannerFailure(PresentationReferenceCode::Unavailable, "database",
                               "The banner reference could not be checked."));
        return;
    }

    *db << "SELECT id, text, banner, url, advanced FROM phpretro_banners "
           "WHERE id = ? AND status = '1'"
        << id
        >> [callback](const drogon::orm::Result& rows) mutable {
               if (rows.empty()) {
                   callback(bannerFailure(
                       PresentationReferenceCode::NotFound, "bannerId",
                       "The banner does not exist or is not active."));
                   return;
               }

               const auto& row = rows[0];
               if (row["advanced"].as<std::string>() != "0") {
                   callback(bannerFailure(
                       PresentationReferenceCode::Unsupported, "bannerId",
                       "Advanced HTML banners are not supported in typed presentations."));
                   return;
               }

               PresentationBannerReference reference;
               reference.id = row["id"].as<uint32_t>();
               reference.text = row["text"].as<std::string>();
               const auto imageValue = row["banner"].as<std::string>();
               const auto imageUrl = safeImageUrl(imageValue);
               if (!imageValue.empty() && !imageUrl) {
                   callback(bannerFailure(
                       PresentationReferenceCode::UnsafeField, "banner",
                       "The banner image URL is not allowed."));
                   return;
               }
               reference.image_url = imageUrl;

               const auto destinationValue = row["url"].as<std::string>();
               const auto destinationUrl = safeDestinationUrl(destinationValue);
               if (!destinationValue.empty() && !destinationUrl) {
                   callback(bannerFailure(
                       PresentationReferenceCode::UnsafeField, "url",
                       "The banner destination URL is not allowed."));
                   return;
               }
               reference.destination_url = destinationUrl;

               PresentationBannerReferenceResult result;
               result.ok = true;
               result.code = PresentationReferenceCode::None;
               result.reference = std::move(reference);
               callback(std::move(result));
           }
        >> [callback](const drogon::orm::DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("PresentationReferenceService::findPublicBannerById: {}",
                               e.base().what());
               callback(bannerFailure(PresentationReferenceCode::Unavailable,
                                      "database",
                                      "The banner reference could not be checked."));
           };
}

void resolveCampaign(
    const drogon::orm::DbClientPtr& db,
    uint32_t id,
    std::function<void(PresentationCampaignReferenceResult)> callback) {
    if (!callback) return;
    if (id == 0 || id > kMaxReferencedRowId) {
        callback(campaignFailure(PresentationReferenceCode::InvalidInput, "campaignId",
                                 "Campaign id is outside the supported range."));
        return;
    }
    if (!db) {
        callback(campaignFailure(PresentationReferenceCode::Unavailable, "database",
                                 "The campaign reference could not be checked."));
        return;
    }

    *db << "SELECT id, name, `desc`, image, url FROM phpretro_campaigns "
           "WHERE id = ? AND visible = '1'"
        << id
        >> [callback](const drogon::orm::Result& rows) mutable {
               if (rows.empty()) {
                   callback(campaignFailure(
                       PresentationReferenceCode::NotFound, "campaignId",
                       "The campaign does not exist or is not visible."));
                   return;
               }

               const auto& row = rows[0];
               PresentationCampaignReference reference;
               reference.id = row["id"].as<uint32_t>();
               reference.name = row["name"].as<std::string>();
               reference.description = row["desc"].as<std::string>();
               const auto imageValue = row["image"].as<std::string>();
               const auto imageUrl = safeImageUrl(imageValue);
               if (!imageValue.empty() && !imageUrl) {
                   callback(campaignFailure(
                       PresentationReferenceCode::UnsafeField, "image",
                       "The campaign image URL is not allowed."));
                   return;
               }
               reference.image_url = imageUrl;

               const auto destinationValue = row["url"].as<std::string>();
               const auto destinationUrl = safeDestinationUrl(destinationValue);
               if (!destinationValue.empty() && !destinationUrl) {
                   callback(campaignFailure(
                       PresentationReferenceCode::UnsafeField, "url",
                       "The campaign destination URL is not allowed."));
                   return;
               }
               reference.destination_url = destinationUrl;

               PresentationCampaignReferenceResult result;
               result.ok = true;
               result.code = PresentationReferenceCode::None;
               result.reference = std::move(reference);
               callback(std::move(result));
           }
        >> [callback](const drogon::orm::DrogonDbException& e) mutable {
               HOTEL_LOG_ERROR("PresentationReferenceService::findPublicCampaignById: {}",
                               e.base().what());
               callback(campaignFailure(PresentationReferenceCode::Unavailable,
                                        "database",
                                        "The campaign reference could not be checked."));
           };
}

}  // namespace

void PresentationReferenceService::findPublicBannerById(
    uint32_t id,
    std::function<void(PresentationBannerReferenceResult)> callback) {
    resolveBanner(drogon::app().getDbClient("default"), id, std::move(callback));
}

void PresentationReferenceService::findPublicBannerById(
    const drogon::orm::DbClientPtr& db,
    uint32_t id,
    std::function<void(PresentationBannerReferenceResult)> callback) {
    resolveBanner(db, id, std::move(callback));
}

void PresentationReferenceService::findPublicCampaignById(
    uint32_t id,
    std::function<void(PresentationCampaignReferenceResult)> callback) {
    resolveCampaign(drogon::app().getDbClient("default"), id, std::move(callback));
}

void PresentationReferenceService::findPublicCampaignById(
    const drogon::orm::DbClientPtr& db,
    uint32_t id,
    std::function<void(PresentationCampaignReferenceResult)> callback) {
    resolveCampaign(db, id, std::move(callback));
}

}  // namespace hotel::services
