#include "utils/Logger.h"
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/basic_file_sink.h>
#include <spdlog/pattern_formatter.h>
#include <vector>

namespace hotel::utils {

static std::shared_ptr<spdlog::logger> s_logger;

void Logger::init(const std::string& level, bool jsonFormat) {
    auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
    
    if (jsonFormat) {
        // Structured JSON-like log format: {"timestamp":"...","level":"...","msg":"..."}
        console_sink->set_pattern("{\"time\":\"%Y-%m-%dT%H:%M:%S.%eZ\",\"level\":\"%l\",\"logger\":\"%n\",\"thread\":\"%t\",\"message\":\"%v\"}");
    } else {
        console_sink->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%^%l%$] [%t] %v");
    }

    std::vector<spdlog::sink_ptr> sinks { console_sink };
    s_logger = std::make_shared<spdlog::logger>("hotel", sinks.begin(), sinks.end());

    if (level == "trace") {
        s_logger->set_level(spdlog::level::trace);
    } else if (level == "debug") {
        s_logger->set_level(spdlog::level::debug);
    } else if (level == "warn") {
        s_logger->set_level(spdlog::level::warn);
    } else if (level == "error") {
        s_logger->set_level(spdlog::level::err);
    } else if (level == "critical") {
        s_logger->set_level(spdlog::level::critical);
    } else {
        s_logger->set_level(spdlog::level::info);
    }

    spdlog::set_default_logger(s_logger);
    spdlog::flush_on(spdlog::level::info);
}

std::shared_ptr<spdlog::logger> Logger::get() {
    if (!s_logger) {
        init("info", false);
    }
    return s_logger;
}

} // namespace hotel::utils
