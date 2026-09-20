#include "utils/Readiness.h"

#include <atomic>

namespace hotel::utils {

namespace {
// Default false: nothing is ready until the bootstrap says so.
std::atomic<bool> g_ready{false};
}  // namespace

void Readiness::markReady() {
    g_ready.store(true, std::memory_order_release);
}

void Readiness::markNotReady() {
    g_ready.store(false, std::memory_order_release);
}

bool Readiness::isReady() {
    return g_ready.load(std::memory_order_acquire);
}

}  // namespace hotel::utils
