#pragma once

#include <string>
#include <optional>
#include <vector>
#include <cstdint>
#include <functional>
#include <drogon/drogon.h>

namespace hotel::services {

struct GuildRecord {
    uint32_t id = 0;
    uint32_t user_id = 0; // owner
    std::string name;
    std::string description;
    uint32_t room_id = 0;
    uint32_t state = 0;
    uint32_t rights = 0;
    std::string badge;
    std::string color_one;
    std::string color_two;
    uint64_t date_created = 0;
    std::string forum = "0";
    std::string read_forum = "EVERYONE";
    std::string post_messages = "MEMBERS";
    std::string post_threads = "MEMBERS";
    std::string mod_forum = "ADMINS";
};

struct GuildMemberRecord {
    uint32_t guild_id = 0;
    uint32_t user_id = 0;
    uint32_t rank_level = 0; // 0=member, 1=admin, 2=owner
    uint32_t is_current = 0;
};

class GuildService {
public:
    static void findById(
        uint32_t guildId,
        std::function<void(std::optional<GuildRecord>)> callback
    );

    static void getMember(
        uint32_t guildId,
        uint32_t userId,
        std::function<void(std::optional<GuildMemberRecord>)> callback
    );

    static void joinGuild(
        uint32_t actorUserId,
        uint32_t guildId,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void leaveGuild(
        uint32_t actorUserId,
        uint32_t guildId,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void updateSettings(
        uint32_t actorUserId,
        uint32_t guildId,
        const std::string& description,
        uint32_t state,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );
};

} // namespace hotel::services
