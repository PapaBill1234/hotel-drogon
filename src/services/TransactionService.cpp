#include "services/TransactionService.h"
#include "utils/Logger.h"

// The header deliberately pulls in only Drogon's ORM client so a unit test can
// include it without the whole framework. `drogon::app()` lives in the umbrella
// header, so the implementation includes it here rather than widening the
// header's dependencies.
#include <drogon/drogon.h>

namespace hotel::services {

namespace {

TransactionRecord mapRow(const drogon::orm::Row& row) {
    TransactionRecord t;
    t.id = row["id"].as<uint32_t>();
    t.user_id = row["user_id"].as<uint32_t>();
    t.type = row["type"].as<std::string>();
    t.amount = row["amount"].as<int32_t>();
    t.balance_after = row["balance_after"].as<int32_t>();
    t.description = row["description"].as<std::string>();
    // `reference_id` is NULLable in the schema (migration 001), so a NULL must
    // map to the empty string rather than throwing. The legacy page echoed it
    // without reading it, so nothing depended on NULL surviving as NULL.
    t.reference_id = row["reference_id"].isNull() ? "" : row["reference_id"].as<std::string>();
    t.created_at = row["created_at"].as<uint64_t>();
    return t;
}

} // namespace

void TransactionService::ensureSchema(
    const drogon::orm::DbClientPtr& db,
    std::function<void()> onComplete
) {
    if (!db) {
        HOTEL_LOG_WARN("TransactionService::ensureSchema called without a DbClient");
        if (onComplete) onComplete();
        return;
    }

    // Column-for-column the definition in the legacy
    // `migrations/001_custom_tables.sql`. The widths are load-bearing, not
    // cosmetic: the legacy writers still insert into this table, so a narrower
    // column here would truncate their rows.
    //
    // The index is named exactly as legacy names it. `CREATE TABLE IF NOT
    // EXISTS` means a database that already has the legacy table keeps it, and
    // a fresh one gets the same shape rather than an equivalent-looking variant.
    static const std::string createTable =
        "CREATE TABLE IF NOT EXISTS phpretro_transactions ("
        "id INT NOT NULL AUTO_INCREMENT,"
        "user_id INT NOT NULL,"
        "type VARCHAR(50) NOT NULL,"
        "amount INT NOT NULL,"
        "balance_after INT NOT NULL,"
        "description VARCHAR(255) NOT NULL DEFAULT '',"
        "reference_id VARCHAR(100) NULL,"
        "created_at INT NOT NULL,"
        "PRIMARY KEY (id),"
        "INDEX idx_user_id_created (user_id, created_at)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

    *db << createTable
        >> [onComplete](const drogon::orm::Result&) {
            if (onComplete) onComplete();
        }
        >> [onComplete](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("TransactionService::ensureSchema error: {}", e.base().what());
            // Reported as completion so a schema failure cannot deadlock the
            // startup sequencer; the error is logged and the health check still
            // decides readiness from the tables it needs.
            if (onComplete) onComplete();
        };
}

void TransactionService::listForUser(
    uint32_t userId,
    uint32_t limit,
    std::function<void(std::vector<TransactionRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        HOTEL_LOG_WARN("TransactionService::listForUser called without a DbClient");
        callback({});
        return;
    }

    // `history.php`: ORDER BY created_at DESC, id DESC LIMIT 100. The `id DESC`
    // tiebreak matters — rows written in the same second (the Homes store writes
    // one per purchase) would otherwise come back in an arbitrary order, and the
    // legacy page's order is the one users saw.
    *db << "SELECT id, user_id, type, amount, balance_after, description, "
           "reference_id, created_at FROM phpretro_transactions "
           "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
        << userId << limit
        >> [callback](const drogon::orm::Result& r) {
            std::vector<TransactionRecord> rows;
            rows.reserve(r.size());
            for (const auto& row : r) {
                rows.push_back(mapRow(row));
            }
            callback(std::move(rows));
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("TransactionService::listForUser error: {}", e.base().what());
            callback({});
        };
}

void TransactionService::record(
    const TransactionRecord& entry,
    std::function<void(bool, const std::string&)> callback
) {
    if (entry.type.empty()) {
        callback(false, "A transaction type is required.");
        return;
    }
    if (entry.user_id == 0) {
        callback(false, "A transaction must belong to a user.");
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database service unavailable.");
        return;
    }

    *db << "INSERT INTO phpretro_transactions (user_id, type, amount, balance_after, "
           "description, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        << entry.user_id << entry.type << entry.amount << entry.balance_after
        << entry.description << entry.reference_id << entry.created_at
        >> [callback](const drogon::orm::Result&) {
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("TransactionService::record error: {}", e.base().what());
            callback(false, e.base().what());
        };
}

} // namespace hotel::services
