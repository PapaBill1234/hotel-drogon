#include "services/HomeStoreService.h"

#include "utils/Logger.h"

#include <algorithm>
#include <charconv>
#include <memory>
#include <system_error>
#include <utility>

namespace hotel::services {

namespace {

HomeStoreResult failure(HomeStoreCode code, std::string message) {
    HomeStoreResult result;
    result.code = code;
    result.message = std::move(message);
    return result;
}

void browse(const drogon::orm::DbClientPtr& db,
            uint32_t userId,
            const std::string& type,
            bool categoriesOnly,
            uint32_t categoryId,
            std::function<void(HomeStoreResult)> callback) {
    if (!callback) return;
    if (userId == 0 || !HomeStoreService::supportsType(type) ||
        (categoriesOnly && categoryId != 0)) {
        callback(failure(HomeStoreCode::InvalidInput, "Invalid store request."));
        return;
    }
    if (!db) {
        callback(failure(HomeStoreCode::Unavailable, "The store could not be loaded."));
        return;
    }

    auto resultCallback =
        std::make_shared<std::function<void(HomeStoreResult)>>(std::move(callback));
    const auto deliver = [resultCallback](HomeStoreResult result) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(result));
    };

    try {
        *db << "SELECT rank FROM users WHERE id = ? LIMIT 1"
            << userId
            >> [db, type, categoriesOnly, categoryId, deliver](const drogon::orm::Result& users) {
                   if (users.empty()) {
                       deliver(failure(HomeStoreCode::NotFound,
                                       "The signed-in user no longer exists."));
                       return;
                   }

                   const uint32_t rank = users[0]["rank"].as<uint32_t>();
                   if (categoriesOnly) {
                       *db << "SELECT category_id, category "
                              "FROM phpretro_homes_catalogue "
                              "WHERE type = ? AND min_rank <= ? "
                              "AND (placement = 'homes' OR placement = 'anywhere') "
                              "GROUP BY category_id, category "
                              "ORDER BY category ASC, category_id ASC"
                           << type << rank
                           >> [deliver](const drogon::orm::Result& rows) {
                                  HomeStoreResult result;
                                  result.code = HomeStoreCode::None;
                                  result.categories.reserve(rows.size());
                                  for (const auto& row : rows) {
                                      HomeStoreCategory category;
                                      category.category_id =
                                          row["category_id"].as<uint32_t>();
                                      category.category =
                                          row["category"].as<std::string>();
                                      result.categories.push_back(std::move(category));
                                  }
                                  deliver(std::move(result));
                              }
                           >> [deliver](const drogon::orm::DrogonDbException& error) {
                                  HOTEL_LOG_ERROR("HomeStoreService categories: {}",
                                                  error.base().what());
                                  deliver(failure(HomeStoreCode::Unavailable,
                                                  "The store could not be loaded."));
                              };
                       return;
                   }

                   std::string query =
                       "SELECT id, name, description, type, data, price, amount, "
                       "category, category_id, min_rank, placement "
                       "FROM phpretro_homes_catalogue "
                       "WHERE type = ? AND min_rank <= ? "
                       "AND (placement = 'homes' OR placement = 'anywhere')";
                   if (categoryId > 0) query += " AND category_id = ?";
                   query += " ORDER BY id DESC";

                   const auto onRows = [deliver](const drogon::orm::Result& rows) {
                              HomeStoreResult result;
                              result.code = HomeStoreCode::None;
                              result.items.reserve(rows.size());
                              for (const auto& row : rows) {
                                  HomeStoreItem item;
                                  item.id = row["id"].as<uint32_t>();
                                  item.name = row["name"].as<std::string>();
                                  item.description =
                                      row["description"].as<std::string>();
                                  item.type = row["type"].as<std::string>();
                                  const auto dataKey = row["data"].as<std::string>();
                                  // Legacy concatenates this value into a CSS class.
                                  // Expose only validated opaque identifiers; never a
                                  // URL, HTML fragment, or arbitrary class string.
                                  if (HomeStoreService::safeDataKey(dataKey))
                                      item.data_key = dataKey;
                                  item.price = row["price"].as<int32_t>();
                                  item.amount = row["amount"].as<int32_t>();
                                  item.category = row["category"].as<std::string>();
                                  item.category_id =
                                      row["category_id"].as<uint32_t>();
                                  item.min_rank = row["min_rank"].as<uint32_t>();
                                  item.placement =
                                      row["placement"].as<std::string>();
                                  result.items.push_back(std::move(item));
                              }
                              deliver(std::move(result));
                          };
                   const auto onError = [deliver](
                                            const drogon::orm::DrogonDbException& error) {
                              HOTEL_LOG_ERROR("HomeStoreService items: {}",
                                              error.base().what());
                              deliver(failure(HomeStoreCode::Unavailable,
                                              "The store could not be loaded."));
                          };
                   try {
                       if (categoryId > 0) {
                           *db << query << type << rank << categoryId >> onRows >> onError;
                       } else {
                           *db << query << type << rank >> onRows >> onError;
                       }
                   } catch (const std::exception& error) {
                       HOTEL_LOG_ERROR("HomeStoreService items: {}", error.what());
                       deliver(failure(HomeStoreCode::Unavailable,
                                       "The store could not be loaded."));
                   }
               }
            >> [deliver](const drogon::orm::DrogonDbException& error) {
                   HOTEL_LOG_ERROR("HomeStoreService current rank: {}",
                                   error.base().what());
                   deliver(failure(HomeStoreCode::Unavailable,
                                   "The store could not be loaded."));
               };
    } catch (const std::exception& error) {
        HOTEL_LOG_ERROR("HomeStoreService browse: {}", error.what());
        deliver(failure(HomeStoreCode::Unavailable, "The store could not be loaded."));
    }
}

}  // namespace

bool HomeStoreService::supportsType(const std::string& type) {
    return type == "sticker" || type == "background" || type == "note";
}

bool HomeStoreService::safeDataKey(const std::string& value) {
    if (value.empty() || value.size() > 128) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
               (c >= '0' && c <= '9') || c == '_' || c == '-';
    });
}

bool HomeStoreService::parseCategoryId(const std::string& value,
                                       uint32_t& categoryId) {
    if (value.empty()) {
        categoryId = 0;
        return true;
    }
    uint32_t parsed = 0;
    const auto [end, error] =
        std::from_chars(value.data(), value.data() + value.size(), parsed);
    if (error != std::errc{} || end != value.data() + value.size()) return false;
    categoryId = parsed;
    return true;
}

void HomeStoreService::getCategories(
    const drogon::orm::DbClientPtr& db,
    uint32_t userId,
    const std::string& type,
    std::function<void(HomeStoreResult)> callback) {
    browse(db, userId, type, true, 0, std::move(callback));
}

void HomeStoreService::getItems(
    const drogon::orm::DbClientPtr& db,
    uint32_t userId,
    const std::string& type,
    uint32_t categoryId,
    std::function<void(HomeStoreResult)> callback) {
    browse(db, userId, type, false, categoryId, std::move(callback));
}

}  // namespace hotel::services
