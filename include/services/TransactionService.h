#pragma once

#include <drogon/orm/DbClient.h>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace hotel::services {

/**
 * The website's own transaction ledger — `phpretro_transactions`.
 *
 * ## Ownership
 *
 * `phpretro_*` tables belong to the website/CMS, not to PolarIS (plan rule 1 and
 * the ownership table in `docs/phase1-parity-inventory.md`). The plan's data
 * access rule still applies unchanged: `phpretro_*` goes through a named-method
 * service class rather than a generic table write, which is why this exists as
 * its own small class instead of SQL inlined in the controller.
 *
 * ## Where the shape comes from
 *
 * `migrations/001_custom_tables.sql` in the read-only PHPRetro checkout defines
 * it, and two legacy writers use it:
 *
 *   - `housekeeping/users.php`      → type `admin_grant`, amount = new − old
 *                                     credits, description 'Housekeeping credit
 *                                     adjustment', reference_id = the user id
 *   - `includes/PhpretroHomes.php`  → type `homes_store`, amount = −price,
 *                                     description 'MyHabbo store: <item>',
 *                                     reference_id = the catalogue item id
 *
 * `history.php` reads `type, amount, balance_after, description, reference_id,
 * created_at` for one user, newest first, `LIMIT 100`. None of those widths or
 * names are invented here.
 */
struct TransactionRecord {
    uint32_t id = 0;
    uint32_t user_id = 0;
    std::string type;
    int32_t amount = 0;
    int32_t balance_after = 0;
    std::string description;
    std::string reference_id;
    uint64_t created_at = 0;
};

class TransactionService {
public:
    /** Create the ledger table if it is absent. Mirrors migration 001. */
    static void ensureSchema(
        const drogon::orm::DbClientPtr& db,
        std::function<void()> onComplete
    );

    /**
     * One page of a user's ledger, newest first — `history.php`'s own query.
     *
     * Scoped to a single `user_id` by construction: there is no method here
     * that returns another user's rows or an unfiltered list, so a handler
     * cannot accidentally serve someone else's ledger by passing the wrong
     * argument. `limit` exists because the caller must be able to cap the page;
     * the legacy cap of 100 is what the controller passes.
     */
    static void listForUser(
        uint32_t userId,
        uint32_t limit,
        std::function<void(std::vector<TransactionRecord>)> callback
    );

    /**
     * Append one ledger row.
     *
     * Named and explicit rather than a generic insert: the caller must supply a
     * transaction type, which is the field the ledger's meaning depends on. Not
     * called by the read slice — the writers are the Phase 9 staff credit
     * adjustment and the Phase 8 Homes store, both of which port their own
     * legacy caller — but it is what makes this a ledger service rather than a
     * read-only view, and it is exercised by the unit test.
     */
    static void record(
        const TransactionRecord& entry,
        std::function<void(bool, const std::string&)> callback
    );
};

} // namespace hotel::services
