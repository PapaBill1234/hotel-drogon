#include <drogon/drogon.h>
#include <iostream>
#include <csignal>
#include <filesystem>
#include "utils/Logger.h"
#include "utils/Config.h"
#include "utils/Readiness.h"
#include "services/ContentService.h"
#include <functional>
#include <memory>
#include <string>
#include <vector>

static void handleSignal(int sig) {
    HOTEL_LOG_INFO("Received signal {}, initiating graceful shutdown...", sig);
    drogon::app().quit();
}

int main(int argc, char* argv[]) {
    // 1. Initialize structured logging
    auto config = hotel::utils::AppConfig::loadFromEnv();
    hotel::utils::Logger::init(config.log_level, config.json_logging);

    HOTEL_LOG_INFO("Starting hotel-drogon server in {} mode", config.environment);

    // 2. Register signal handlers for graceful termination
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    // 3. Load config file if present, otherwise configure from environment
    std::string configPath = "config/config.json";
    if (argc > 1) {
        configPath = argv[1];
    }

    if (std::filesystem::exists(configPath)) {
        HOTEL_LOG_INFO("Loading configuration from file: {}", configPath);
        drogon::app().loadConfigFile(configPath);
    } else {
        HOTEL_LOG_INFO("Config file {} not found; applying environment-based configuration", configPath);
        
        drogon::app()
            .addListener(config.host, config.port)
            .setThreadNum(config.thread_count);

        // Configure MySQL/MariaDB if DB_HOST is set
        if (!config.db_host.empty() && !config.db_name.empty()) {
            std::string resolvedDbHost = hotel::utils::AppConfig::resolveHost(config.db_host);
            HOTEL_LOG_INFO("Configuring default MariaDB client ({}:{}/{})",
                resolvedDbHost, config.db_port, config.db_name);
            drogon::app().createDbClient(
                "mysql",
                resolvedDbHost,
                config.db_port,
                config.db_name,
                config.db_user,
                config.db_password,
                config.db_max_connections,
                "", // filename for sqlite
                "default",
                false, // is_fast
                "utf8mb4"
            );

            // Execute schema migrations / setup.
            //
            // Everything below runs STRICTLY IN ORDER and readiness is signalled
            // only at the very end. Drogon dispatches each `<<` asynchronously,
            // so firing these together previously (a) let the user seed race its
            // own CREATE TABLE, and (b) — the defect that actually broke CI —
            // let the server answer /health while none of it had finished, so a
            // readiness poll could pass before `testuser` existed. See
            // utils/Readiness.h.
            drogon::app().registerBeginningAdvice([]() {
                auto db = drogon::app().getDbClient("default");
                if (!db) {
                    HOTEL_LOG_WARN("Default DbClient not available for initial migration");
                    return;
                }
                HOTEL_LOG_INFO("Verifying / migrating PolarIS and service layer database tables...");

                // Not ready until the seed below completes.
                hotel::utils::Readiness::markNotReady();

                // Phase 4 website-owned content tables have their own ordered
                // sequencer; chain the core tables and the seed after it.
                hotel::services::ContentService::ensureSchema(db, [db]() {
                    static const std::vector<std::string> kCoreStatements = {
                        "CREATE TABLE IF NOT EXISTS users ("
                        "id INT AUTO_INCREMENT PRIMARY KEY, "
                        "username VARCHAR(50) UNIQUE, "
                        "real_name VARCHAR(100) DEFAULT '', "
                        "password VARCHAR(255), "
                        "mail VARCHAR(100) DEFAULT '', "
                        "mail_verified TINYINT DEFAULT 0, "
                        "rank INT DEFAULT 1, "
                        "credits INT DEFAULT 500, "
                        "pixels INT DEFAULT 100, "
                        "points INT DEFAULT 0, "
                        "look VARCHAR(255) DEFAULT 'hr-115-42.hd-190-1.ch-215-66.lg-270-82.sh-290-80', "
                        "gender ENUM('M','F') DEFAULT 'M', "
                        "motto VARCHAR(128) DEFAULT 'Hello Habbo!', "
                        "online ENUM('0','1','2') DEFAULT '0', "
                        "account_created BIGINT DEFAULT 0, "
                        "last_login BIGINT DEFAULT 0, "
                        "ip_current VARCHAR(50) DEFAULT '', "
                        "auth_ticket VARCHAR(255) DEFAULT '', "
                        "auth_ticket_expires_at BIGINT DEFAULT 0, "
                        "remember_token_hash VARCHAR(64) DEFAULT '', "
                        "remember_token_expires_at BIGINT DEFAULT 0"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

                        "CREATE TABLE IF NOT EXISTS bans ("
                        "id INT AUTO_INCREMENT PRIMARY KEY, "
                        "user_id INT, "
                        "ip VARCHAR(50) DEFAULT '', "
                        "machine_id VARCHAR(255) DEFAULT '', "
                        "user_staff_id INT DEFAULT 0, "
                        "timestamp BIGINT DEFAULT 0, "
                        "ban_expire BIGINT DEFAULT 0, "
                        "ban_reason TEXT, "
                        "type ENUM('account','ip','machine','super') DEFAULT 'account', "
                        "cfh_topic VARCHAR(255) DEFAULT ''"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

                        "CREATE TABLE IF NOT EXISTS guilds ("
                        "id INT AUTO_INCREMENT PRIMARY KEY, "
                        "user_id INT, "
                        "name VARCHAR(100), "
                        "description TEXT, "
                        "room_id INT DEFAULT 0, "
                        "state INT DEFAULT 0, "
                        "rights INT DEFAULT 0, "
                        "badge VARCHAR(50) DEFAULT '', "
                        "color_one VARCHAR(10) DEFAULT '', "
                        "color_two VARCHAR(10) DEFAULT '', "
                        "date_created BIGINT DEFAULT 0, "
                        "forum ENUM('0','1') DEFAULT '0', "
                        "read_forum ENUM('EVERYONE','MEMBERS','ADMINS') DEFAULT 'EVERYONE', "
                        "post_messages ENUM('EVERYONE','MEMBERS','ADMINS','OWNER') DEFAULT 'MEMBERS', "
                        "post_threads ENUM('EVERYONE','MEMBERS','ADMINS','OWNER') DEFAULT 'MEMBERS', "
                        "mod_forum ENUM('ADMINS','OWNER') DEFAULT 'ADMINS'"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

                        "CREATE TABLE IF NOT EXISTS guilds_members ("
                        "guild_id INT, "
                        "user_id INT, "
                        "rank_level INT DEFAULT 0, "
                        "is_current INT DEFAULT 0, "
                        "PRIMARY KEY (guild_id, user_id)"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

                        "CREATE TABLE IF NOT EXISTS phpretro_admin_action_log ("
                        "id INT AUTO_INCREMENT PRIMARY KEY, "
                        "admin_id INT, "
                        "action_type VARCHAR(64), "
                        "target_type VARCHAR(64), "
                        "target_id INT DEFAULT 0, "
                        "details TEXT, "
                        "ip VARCHAR(50) DEFAULT '', "
                        "created_at BIGINT DEFAULT 0"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

                        "CREATE TABLE IF NOT EXISTS phpretro_user_reports ("
                        "id INT AUTO_INCREMENT PRIMARY KEY, "
                        "user_id INT, "
                        "target_id INT, "
                        "category VARCHAR(64), "
                        "message TEXT, "
                        "status ENUM('open','resolved','dismissed') DEFAULT 'open', "
                        "created_at BIGINT DEFAULT 0, "
                        "resolved_at BIGINT DEFAULT 0, "
                        "resolved_by INT DEFAULT 0"
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
                    };

                    // Sequential driver. shared_ptr keeps the function alive for
                    // the async callbacks that invoke it (capturing `step` by
                    // reference would dangle once this lambda returns).
                    auto step = std::make_shared<std::function<void(std::size_t)>>();
                    *step = [db, step](std::size_t index) {
                        if (index < kCoreStatements.size()) {
                            *db << kCoreStatements[index]
                                >> [step, index](const drogon::orm::Result&) {
                                       (*step)(index + 1);
                                   }
                                >> [step, index](const drogon::orm::DrogonDbException& e) {
                                       HOTEL_LOG_WARN("Schema init statement {}: {}",
                                                      index, e.base().what());
                                       (*step)(index + 1);
                                   };
                            return;
                        }

                        // Seed 'admin' (rank 7) and 'testuser' (rank 1), password
                        // 'password123' for both. PHPRetro/PolarIS legacy scheme is
                        // username-dependent: sha1(password . strtolower(username)).
                        //   admin    -> sha1('password123admin')    = 688a8dacaad619c69b4091eb624dae82004c3afd
                        //   testuser -> sha1('password123testuser') = 023f158f3fa0cfe32dfdd8a9884b8e1b1f07a1bd
                        *db << "INSERT IGNORE INTO users (id, username, real_name, password, mail, rank, motto) VALUES "
                               "(1, 'admin', 'Hotel Administrator', '688a8dacaad619c69b4091eb624dae82004c3afd', 'admin@hotel.local', 7, 'Hotel Administrator'), "
                               "(2, 'testuser', 'Test User', '023f158f3fa0cfe32dfdd8a9884b8e1b1f07a1bd', 'test@hotel.local', 1, 'Exploring the hotel!')"
                            >> [](const drogon::orm::Result&) {
                                   HOTEL_LOG_INFO("Default test user and admin seeded successfully.");
                                   // Schema and seed are both done: now, and only
                                   // now, does /health report ready.
                                   hotel::utils::Readiness::markReady();
                               }
                            >> [](const drogon::orm::DrogonDbException& e) {
                                   HOTEL_LOG_WARN("Seeding default users: {}", e.base().what());
                                   // Deliberately NOT marking ready: a failed seed
                                   // must surface as unhealthy rather than as a
                                   // stack that claims to be up but cannot log
                                   // anyone in.
                               };
                    };
                    (*step)(0);
                });
            });
        }

        // Configure Redis if REDIS_HOST is set
        if (!config.redis_host.empty()) {
            std::string resolvedRedisHost = hotel::utils::AppConfig::resolveHost(config.redis_host);
            HOTEL_LOG_INFO("Configuring default Redis client ({}:{})",
                resolvedRedisHost, config.redis_port);
            drogon::app().createRedisClient(
                resolvedRedisHost,
                config.redis_port,
                "default",
                config.redis_password,
                5,     // connectionNum
                false, // isFast
                -1.0,  // timeout
                config.redis_db
            );
        }
    }

    // 4. Default JSON 404 response
    Json::Value notFoundJson;
    notFoundJson["error"] = "Not Found";
    notFoundJson["status"] = 404;
    notFoundJson["message"] = "The requested resource does not exist.";
    auto notFoundResp = drogon::HttpResponse::newHttpJsonResponse(notFoundJson);
    notFoundResp->setStatusCode(drogon::k404NotFound);
    drogon::app().setCustom404Page(notFoundResp);

    // 5. Run Drogon async event loop
    HOTEL_LOG_INFO("Listening on {}:{}...", config.host, config.port);
    drogon::app().run();

    HOTEL_LOG_INFO("hotel-drogon server stopped gracefully.");
    return 0;
}
