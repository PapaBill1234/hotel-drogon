#include "services/GuildService.h"
#include "services/AuditService.h"
#include "utils/Logger.h"

namespace hotel::services {

void GuildService::findById(
    uint32_t guildId,
    std::function<void(std::optional<GuildRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }

    *db << "SELECT id, user_id, name, description, room_id, state, rights, badge, "
           "color_one, color_two, date_created, forum, read_forum, post_messages, post_threads, mod_forum "
           "FROM guilds WHERE id = ? LIMIT 1"
        << guildId
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(std::nullopt);
            } else {
                const auto& row = r[0];
                GuildRecord g;
                g.id = row["id"].as<uint32_t>();
                g.user_id = row["user_id"].as<uint32_t>();
                g.name = row["name"].as<std::string>();
                g.description = row["description"].as<std::string>();
                g.room_id = row["room_id"].as<uint32_t>();
                g.state = row["state"].as<uint32_t>();
                g.rights = row["rights"].as<uint32_t>();
                g.badge = row["badge"].as<std::string>();
                g.color_one = row["color_one"].as<std::string>();
                g.color_two = row["color_two"].as<std::string>();
                g.date_created = row["date_created"].as<uint64_t>();
                g.forum = row["forum"].as<std::string>();
                g.read_forum = row["read_forum"].as<std::string>();
                g.post_messages = row["post_messages"].as<std::string>();
                g.post_threads = row["post_threads"].as<std::string>();
                g.mod_forum = row["mod_forum"].as<std::string>();
                callback(g);
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("GuildService::findById error: {}", e.base().what());
            callback(std::nullopt);
        };
}

void GuildService::getMember(
    uint32_t guildId,
    uint32_t userId,
    std::function<void(std::optional<GuildMemberRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }

    *db << "SELECT guild_id, user_id, rank_level, is_current "
           "FROM guilds_members WHERE guild_id = ? AND user_id = ? LIMIT 1"
        << guildId
        << userId
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(std::nullopt);
            } else {
                const auto& row = r[0];
                GuildMemberRecord m;
                m.guild_id = row["guild_id"].as<uint32_t>();
                m.user_id = row["user_id"].as<uint32_t>();
                m.rank_level = row["rank_level"].as<uint32_t>();
                m.is_current = row["is_current"].as<uint32_t>();
                callback(m);
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("GuildService::getMember error: {}", e.base().what());
            callback(std::nullopt);
        };
}

void GuildService::joinGuild(
    uint32_t actorUserId,
    uint32_t guildId,
    const std::string& actorIp,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "INSERT INTO guilds_members (guild_id, user_id, rank_level, is_current) VALUES (?, ?, 0, 0) "
           "ON DUPLICATE KEY UPDATE rank_level = VALUES(rank_level)"
        << guildId
        << actorUserId
        >> [actorUserId, guildId, actorIp, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(actorUserId, "guild_join", "guild", guildId, "User joined guild", actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("GuildService::joinGuild error: {}", e.base().what());
            callback(false, "Failed to join guild");
        };
}

void GuildService::leaveGuild(
    uint32_t actorUserId,
    uint32_t guildId,
    const std::string& actorIp,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "DELETE FROM guilds_members WHERE guild_id = ? AND user_id = ?"
        << guildId
        << actorUserId
        >> [actorUserId, guildId, actorIp, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(actorUserId, "guild_leave", "guild", guildId, "User left guild", actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("GuildService::leaveGuild error: {}", e.base().what());
            callback(false, "Failed to leave guild");
        };
}

void GuildService::updateSettings(
    uint32_t actorUserId,
    uint32_t guildId,
    const std::string& description,
    uint32_t state,
    const std::string& actorIp,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "UPDATE guilds SET description = ?, state = ? WHERE id = ?"
        << description
        << state
        << guildId
        >> [actorUserId, guildId, actorIp, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(actorUserId, "guild_update_settings", "guild", guildId, "Guild settings updated", actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("GuildService::updateSettings error: {}", e.base().what());
            callback(false, "Failed to update guild settings");
        };
}

} // namespace hotel::services
