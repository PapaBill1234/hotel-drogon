#pragma once
#include <drogon/orm/DbClient.h>
#include <cstdint>
#include <functional>
#include <string>
namespace hotel::services {
enum class PersonalGuestbookWidgetCode { Found, NotFound, InvalidInput, Unavailable };
struct PersonalGuestbookWidget { uint32_t id = 0; uint32_t user_id = 0; uint32_t guild_id = 0; std::string privacy = "public"; };
struct PersonalGuestbookWidgetResult { PersonalGuestbookWidgetCode code = PersonalGuestbookWidgetCode::Unavailable; PersonalGuestbookWidget widget; std::string message; bool found() const { return code == PersonalGuestbookWidgetCode::Found; } };
class PersonalGuestbookWidgetService {
public:
    static bool isPersonalOwner(uint32_t actorId, uint32_t ownerId, uint32_t guildId);
    static void findOwnedWidget(const drogon::orm::DbClientPtr& db,
                                uint32_t ownerId,
                                uint32_t actorId,
                                uint32_t widgetId,
                                std::function<void(PersonalGuestbookWidgetResult)> callback);
};
}  // namespace hotel::services
