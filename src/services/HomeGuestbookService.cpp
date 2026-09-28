#include "services/HomeGuestbookService.h"

#include "utils/Logger.h"

#include <charconv>
#include <memory>
#include <string_view>
#include <system_error>
#include <utility>

namespace hotel::services {

namespace {

HomeGuestbookResult failure(HomeGuestbookCode code, std::string message) {
    HomeGuestbookResult result;
    result.code = code;
    result.message = std::move(message);
    return result;
}

}  // namespace

bool HomeGuestbookService::validProfileId(int64_t profileId) {
    return profileId > 0;
}

bool HomeGuestbookService::parseProfileId(const std::string& value,
                                          int64_t& profileId) {
    std::string_view input(value);
    const auto isLegacyTrimCharacter = [](char character) {
        return character == ' ' || character == '\t' || character == '\n' ||
               character == '\r' || character == '\0' || character == '\v';
    };
    while (!input.empty() && isLegacyTrimCharacter(input.front()))
        input.remove_prefix(1);
    while (!input.empty() && isLegacyTrimCharacter(input.back()))
        input.remove_suffix(1);
    if (input.empty()) return false;
    if (input.front() == '+') input.remove_prefix(1);
    if (input.empty()) return false;
    // FILTER_VALIDATE_INT rejects leading zeroes unless octal parsing is
    // explicitly enabled; the legacy endpoint uses its default flags.
    if (input.size() > 1 && input.front() == '0') return false;

    int64_t parsed = 0;
    const auto [end, error] =
        std::from_chars(input.data(), input.data() + input.size(), parsed);
    if (error != std::errc{} || end != input.data() + input.size() ||
        !validProfileId(parsed))
        return false;
    profileId = parsed;
    return true;
}

void HomeGuestbookService::getEntries(
    const drogon::orm::DbClientPtr& db,
    const std::string& profileIdText,
    std::function<void(HomeGuestbookResult)> callback) {
    if (!callback) return;
    int64_t profileId = 0;
    if (!parseProfileId(profileIdText, profileId)) {
        callback(failure(HomeGuestbookCode::InvalidInput, "Invalid profile."));
        return;
    }
    if (!db) {
        callback(failure(HomeGuestbookCode::Unavailable,
                         "The guestbook could not be loaded."));
        return;
    }

    auto resultCallback =
        std::make_shared<std::function<void(HomeGuestbookResult)>>(std::move(callback));
    const auto deliver = [resultCallback](HomeGuestbookResult result) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(result));
    };

    try {
        *db << "SELECT g.id, g.profile_user_id, g.author_user_id, g.message, "
               "g.created_at, u.username, u.look, u.online "
               "FROM phpretro_myhabbo_guestbook g "
               "JOIN users u ON u.id = g.author_user_id "
               "WHERE g.profile_user_id = ? ORDER BY g.id DESC LIMIT ?"
            << profileId << kMaxEntries
            >> [deliver](const drogon::orm::Result& rows) {
                   HomeGuestbookResult result;
                   result.code = HomeGuestbookCode::None;
                   result.entries.reserve(rows.size());
                   for (const auto& row : rows) {
                       HomeGuestbookEntry entry;
                       entry.id = row["id"].as<uint32_t>();
                       entry.profile_user_id =
                           row["profile_user_id"].as<uint32_t>();
                       entry.author_user_id =
                           row["author_user_id"].as<uint32_t>();
                       entry.message = row["message"].as<std::string>();
                       entry.created_at = row["created_at"].as<uint32_t>();
                       entry.username = row["username"].as<std::string>();
                       entry.look = row["look"].as<std::string>();
                       // The legacy users.online field is an ENUM. Preserve its
                       // PDO JSON string value instead of coercing it to a number.
                       entry.online = row["online"].as<std::string>();
                       result.entries.push_back(std::move(entry));
                   }
                   deliver(std::move(result));
               }
            >> [deliver](const drogon::orm::DrogonDbException& error) {
                   HOTEL_LOG_ERROR("HomeGuestbookService entries: {}",
                                   error.base().what());
                   deliver(failure(HomeGuestbookCode::Unavailable,
                                   "The guestbook could not be loaded."));
               };
    } catch (const std::exception& error) {
        HOTEL_LOG_ERROR("HomeGuestbookService read: {}", error.what());
        deliver(failure(HomeGuestbookCode::Unavailable,
                        "The guestbook could not be loaded."));
    }
}

}  // namespace hotel::services
