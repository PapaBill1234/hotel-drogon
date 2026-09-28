#include "services/HomeInventoryService.h"

#include "utils/Logger.h"

#include <memory>
#include <utility>

namespace hotel::services {
namespace {
HomeInventoryResult failure(HomeInventoryCode code, std::string message) {
    HomeInventoryResult result;
    result.code = code;
    result.message = std::move(message);
    return result;
}
}  // namespace

void HomeInventoryService::getPersonalItems(
    const drogon::orm::DbClientPtr& db,
    uint32_t userId,
    std::function<void(HomeInventoryResult)> callback) {
    if (!callback) return;
    if (userId == 0) {
        callback(failure(HomeInventoryCode::InvalidInput, "Invalid inventory request."));
        return;
    }
    if (!db) {
        callback(failure(HomeInventoryCode::Unavailable, "The inventory could not be loaded."));
        return;
    }

    auto resultCallback =
        std::make_shared<std::function<void(HomeInventoryResult)>>(std::move(callback));
    const auto deliver = [resultCallback](HomeInventoryResult result) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(result));
    };

    try {
        // Fixed website-owned tables, prepared user binding, and explicit personal
        // scope. Do not broaden this predicate for legacy group-edit sessions.
        *db << "SELECT MIN(i.id) AS id, i.catalogue_id, i.item_type, i.skin, i.data, "
                "c.name, c.description, c.category, c.category_id, c.amount, COUNT(*) AS quantity "
                "FROM phpretro_homes_items i "
                "INNER JOIN phpretro_homes_catalogue c ON c.id = i.catalogue_id "
                "WHERE i.user_id = ? AND i.guild_id = 0 "
                "AND (i.item_type = 'background' OR i.placed = 0) "
                "AND i.item_type IN ('sticker', 'stickie', 'background') "
                "GROUP BY i.catalogue_id, i.item_type, i.skin, i.data, c.name, c.description, "
                "c.category, c.category_id, c.amount "
                "ORDER BY id DESC"
            << userId
            >> [deliver](const drogon::orm::Result& rows) {
                   HomeInventoryResult result;
                   result.code = HomeInventoryCode::None;
                   result.items.reserve(rows.size());
                   for (const auto& row : rows) {
                       HomeInventoryItem item;
                       item.id = row["id"].as<uint32_t>();
                       item.catalogue_id = row["catalogue_id"].as<uint32_t>();
                       item.item_type = row["item_type"].as<std::string>();
                       item.skin = row["skin"].as<std::string>();
                       item.data = row["data"].as<std::string>();
                       item.name = row["name"].as<std::string>();
                       item.description = row["description"].as<std::string>();
                       item.category = row["category"].as<std::string>();
                       item.category_id = row["category_id"].as<uint32_t>();
                       item.amount = row["amount"].as<int32_t>();
                       item.quantity = row["quantity"].as<uint32_t>();
                       result.items.push_back(std::move(item));
                   }
                   deliver(std::move(result));
               }
            >> [deliver](const drogon::orm::DrogonDbException& error) {
                   HOTEL_LOG_ERROR("HomeInventoryService: {}", error.base().what());
                   deliver(failure(HomeInventoryCode::Unavailable,
                                   "The inventory could not be loaded."));
               };
    } catch (const std::exception& error) {
        HOTEL_LOG_ERROR("HomeInventoryService request: {}", error.what());
        deliver(failure(HomeInventoryCode::Unavailable,
                        "The inventory could not be loaded."));
    }
}

}  // namespace hotel::services
