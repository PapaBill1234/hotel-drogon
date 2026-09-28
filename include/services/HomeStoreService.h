#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace hotel::services {

enum class HomeStoreCode {
    None,
    InvalidInput,
    NotFound,
    Unavailable,
};

struct HomeStoreCategory {
    uint32_t category_id = 0;
    std::string category;
};

struct HomeStoreItem {
    uint32_t id = 0;
    std::string name;
    std::string description;
    std::string type;
    std::optional<std::string> data_key;
    int32_t price = 0;
    int32_t amount = 0;
    std::string category;
    uint32_t category_id = 0;
    uint32_t min_rank = 0;
    std::string placement;
};

struct HomeStoreResult {
    HomeStoreCode code = HomeStoreCode::Unavailable;
    std::string message;
    std::vector<HomeStoreCategory> categories;
    std::vector<HomeStoreItem> items;

    bool ok() const { return code == HomeStoreCode::None; }
};

/**
 * Read-only boundary for the personal Homes Store catalogue.
 *
 * The current PolarIS user rank is read on each browse, matching the legacy
 * `PhpretroHomes::rank()` behavior. Catalogue queries then use the PHPRetro-owned
 * catalogue and the fixed personal-home placement. No purchases, inventory or
 * PolarIS writes are part of this service.
 */
class HomeStoreService {
public:
    static bool supportsType(const std::string& type);
    static bool safeDataKey(const std::string& value);
    static bool parseCategoryId(const std::string& value, uint32_t& categoryId);

    static void getCategories(
        const drogon::orm::DbClientPtr& db,
        uint32_t userId,
        const std::string& type,
        std::function<void(HomeStoreResult)> callback);

    static void getItems(
        const drogon::orm::DbClientPtr& db,
        uint32_t userId,
        const std::string& type,
        uint32_t categoryId,
        std::function<void(HomeStoreResult)> callback);
};

}  // namespace hotel::services
