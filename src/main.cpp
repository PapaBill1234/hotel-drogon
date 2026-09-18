#include <drogon/drogon.h>
#include <iostream>
#include <csignal>
#include <filesystem>
#include "utils/Logger.h"
#include "utils/Config.h"

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
