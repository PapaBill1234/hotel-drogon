#pragma once

#include <string>
#include <cstdint>

namespace hotel::utils {

struct AppConfig {
    // Server
    std::string host = "0.0.0.0";
    uint16_t port = 8080;
    size_t thread_count = 0; // 0 = hardware concurrency
    std::string environment = "development";

    // Logging
    std::string log_level = "info";
    bool json_logging = true;

    // Database (MariaDB / MySQL)
    std::string db_host = "127.0.0.1";
    uint16_t db_port = 3306;
    std::string db_name = "polaris";
    std::string db_user = "hotel";
    std::string db_password = "";
    size_t db_max_connections = 10;

    // Redis
    std::string redis_host = "127.0.0.1";
    uint16_t redis_port = 6379;
    std::string redis_password = "";
    unsigned int redis_db = 0;

    // Sentry / Observability
    std::string sentry_dsn = "";

    // Security & Auth
    std::string session_cookie_name = "hotel_session";
    std::string csrf_header_name = "X-XSRF-TOKEN";
    std::string secret_key = "change-me-in-production";

    static AppConfig loadFromEnv();
    static std::string resolveHost(const std::string& host);
};

} // namespace hotel::utils
