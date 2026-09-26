#include <catch2/catch_test_macros.hpp>

#include "services/TransactionService.h"

using namespace hotel::services;

/**
 * Unit coverage for the ledger service's own rules.
 *
 * The queries themselves are exercised against a live database by the account
 * browser suite and by `scripts/check_account_contract.py`; what belongs in a
 * unit test is the validation the service performs *before* touching a database,
 * because that is the part a missing or misconfigured DbClient cannot mask.
 *
 * `drogon::app()` is not initialised here on purpose: `record` checks its inputs
 * first and returns a failure without a client, so these assertions hold even
 * with no framework running.
 */
TEST_CASE("TransactionService refuses ledger rows that cannot mean anything", "[transactions]") {
    SECTION("a row without a type is refused") {
        TransactionRecord entry;
        entry.user_id = 2;
        entry.amount = 10;
        entry.balance_after = 510;
        // `type` is the field the ledger's meaning depends on: the two legacy
        // writers distinguish a staff grant from a Homes purchase by it alone.
        entry.type = "";

        bool ok = true;
        std::string error;
        TransactionService::record(entry, [&](bool success, const std::string& message) {
            ok = success;
            error = message;
        });

        REQUIRE(ok == false);
        REQUIRE(error == "A transaction type is required.");
    }

    SECTION("a row with no owner is refused") {
        TransactionRecord entry;
        entry.user_id = 0;
        entry.type = "admin_grant";

        bool ok = true;
        std::string error;
        TransactionService::record(entry, [&](bool success, const std::string& message) {
            ok = success;
            error = message;
        });

        REQUIRE(ok == false);
        REQUIRE(error == "A transaction must belong to a user.");
    }

    SECTION("type validation is checked before the user id") {
        // Order matters for the message a caller sees: an empty row should say
        // what is missing first, not report the id it also lacks.
        TransactionRecord entry;

        std::string error;
        TransactionService::record(entry, [&](bool, const std::string& message) { error = message; });

        REQUIRE(error == "A transaction type is required.");
    }
}
