#include "services/PersonalGuestbookWidgetService.h"

#include "utils/Logger.h"

#include <memory>
#include <utility>

namespace hotel::services {
namespace {
PersonalGuestbookWidgetResult failure(PersonalGuestbookWidgetCode code, std::string message) {
    PersonalGuestbookWidgetResult value;
    value.code = code;
    value.message = std::move(message);
    return value;
}
}  // namespace

bool PersonalGuestbookWidgetService::isPersonalOwner(uint32_t actorId,
                                                     uint32_t ownerId,
                                                     uint32_t guildId) {
    return actorId != 0 && actorId == ownerId && guildId == 0;
}

void PersonalGuestbookWidgetService::findOwnedWidget(
    const drogon::orm::DbClientPtr& db,
    uint32_t ownerId,
    uint32_t actorId,
    uint32_t widgetId,
    std::function<void(PersonalGuestbookWidgetResult)> callback) {
    if (!callback) return;
    if (ownerId == 0 || actorId == 0 || widgetId == 0) {
        callback(failure(PersonalGuestbookWidgetCode::InvalidInput,
                         "A personal guestbook widget is required."));
        return;
    }
    if (!db) {
        callback(failure(PersonalGuestbookWidgetCode::Unavailable,
                         "The guestbook widget could not be checked."));
        return;
    }
    auto resultCallback =
        std::make_shared<std::function<void(PersonalGuestbookWidgetResult)>>(std::move(callback));
    const auto deliver = [resultCallback](PersonalGuestbookWidgetResult value) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(value));
    };
    try {
        *db << "SELECT id, user_id, guild_id, privacy FROM phpretro_myhabbo_layouts "
               "WHERE id = ? AND user_id = ? AND guild_id = 0 "
               "AND widget_key = 'guestbookwidget' AND visible = 1 LIMIT 1"
            << widgetId << ownerId
            >> [deliver](const drogon::orm::Result& rows) {
                   if (rows.empty()) {
                       deliver(failure(PersonalGuestbookWidgetCode::NotFound,
                                       "Personal guestbook widget not found."));
                       return;
                   }
                   PersonalGuestbookWidgetResult value;
                   value.code = PersonalGuestbookWidgetCode::Found;
                   value.widget.id = rows[0]["id"].as<uint32_t>();
                   value.widget.user_id = rows[0]["user_id"].as<uint32_t>();
                   value.widget.guild_id = rows[0]["guild_id"].as<uint32_t>();
                   value.widget.privacy = rows[0]["privacy"].as<std::string>();
                   deliver(std::move(value));
               }
            >> [deliver](const drogon::orm::DrogonDbException& error) {
                   HOTEL_LOG_ERROR("PersonalGuestbookWidgetService read: {}",
                                   error.base().what());
                   deliver(failure(PersonalGuestbookWidgetCode::Unavailable,
                                   "The guestbook widget could not be checked."));
               };
    } catch (const std::exception& error) {
        HOTEL_LOG_ERROR("PersonalGuestbookWidgetService: {}", error.what());
        deliver(failure(PersonalGuestbookWidgetCode::Unavailable,
                        "The guestbook widget could not be checked."));
    }
}

}  // namespace hotel::services
