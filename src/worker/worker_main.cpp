#include <iostream>
#include <csignal>
#include <atomic>
#include <thread>
#include <chrono>
#include "utils/Logger.h"
#include "utils/Config.h"

static std::atomic<bool> s_running{true};

static void handleSignal(int sig) {
    HOTEL_LOG_INFO("Worker received signal {}, shutting down...", sig);
    s_running.store(false);
}

int main(int /*argc*/, char* /*argv*/[]) {
    auto config = hotel::utils::AppConfig::loadFromEnv();
    hotel::utils::Logger::init(config.log_level, config.json_logging);

    HOTEL_LOG_INFO("Starting hotel-drogon background worker process");

    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    HOTEL_LOG_INFO("Connecting to Redis at {}:{} (db: {})",
        config.redis_host, config.redis_port, config.redis_db);

    while (s_running.load()) {
        // Poll worker queues / background tasks with backoff
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    HOTEL_LOG_INFO("Worker process exited gracefully.");
    return 0;
}
