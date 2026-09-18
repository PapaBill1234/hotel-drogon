#pragma once

#include <string>
#include <string_view>
#include <memory>
#include <spdlog/spdlog.h>

namespace hotel::utils {

class Logger {
public:
    static void init(const std::string& level = "info", bool jsonFormat = true);
    static std::shared_ptr<spdlog::logger> get();
};

} // namespace hotel::utils

#define HOTEL_LOG_TRACE(...) SPDLOG_TRACE(__VA_ARGS__)
#define HOTEL_LOG_DEBUG(...) SPDLOG_DEBUG(__VA_ARGS__)
#define HOTEL_LOG_INFO(...)  SPDLOG_INFO(__VA_ARGS__)
#define HOTEL_LOG_WARN(...)  SPDLOG_WARN(__VA_ARGS__)
#define HOTEL_LOG_ERROR(...) SPDLOG_ERROR(__VA_ARGS__)
#define HOTEL_LOG_CRITICAL(...) SPDLOG_CRITICAL(__VA_ARGS__)
