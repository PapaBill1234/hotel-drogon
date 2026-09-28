#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace hotel::services {

enum class HomeInventoryCode { None, InvalidInput, NotFound, Unavailable };

struct HomeInventoryItem {
    uint32_t id = 0;
    uint32_t catalogue_id = 0;
    std::string item_type;
    std::string skin;
    std::string data;
    std::string name;
    std::string description;
    std::string category;
    uint32_t category_id = 0;
    int32_t amount = 0;
    uint32_t quantity = 0;
};

struct HomeInventoryResult {
    HomeInventoryCode code = HomeInventoryCode::Unavailable;
    std::string message;
    std::vector<HomeInventoryItem> items;
    bool ok() const { return code == HomeInventoryCode::None; }
};

/**
 * Read-only personal Homes inventory metadata.
 *
 * Rows are scoped to the signed-in user and guild_id = 0. Group-assigned rows
 * are intentionally excluded even when a legacy group-edit session exists.
 * Coordinates, placement state, widgets, purchases and emulator writes are not
 * part of this boundary.
 */
class HomeInventoryService {
public:
    static void getPersonalItems(
        const drogon::orm::DbClientPtr& db,
        uint32_t userId,
        std::function<void(HomeInventoryResult)> callback);
};

}  // namespace hotel::services
