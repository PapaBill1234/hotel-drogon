import AccountPage from '../../components/AccountPage';
import { useTransactions } from '../../hooks/useCredits';
import type { Transaction } from '../../types/account';

/**
 * `/credits/history` — the converted `history.php`.
 *
 * ## What legacy did
 *
 *   SELECT type, amount, balance_after, description, reference_id, created_at
 *   FROM phpretro_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100
 *
 * then one table: Date | Type | Amount | Balance | Description, with the date
 * formatted `Y-m-d H:i` and the counts cast to `int`. When there were no rows it
 * printed "No transactions have been recorded yet." That ordering, the 100-row
 * cap and the empty-state sentence are all reproduced rather than re-invented.
 *
 * `reference_id` was selected by the legacy query but never rendered, so it is
 * carried in the API payload and deliberately not shown — displaying it would be
 * a visible change to a page whose job is parity.
 *
 * ## Why an empty ledger is the normal case today
 *
 * Only two legacy paths ever write a row: the housekeeping credit adjustment
 * (`admin_grant`, Phase 9) and the MyHabbo Homes store (`homes_store`, Phase 8).
 * Neither is ported yet, so on a stack whose ledger was never populated this page
 * correctly shows the empty state. That is parity with a fresh legacy install,
 * not a stubbed success — and the browser suite seeds rows to prove the populated
 * path renders.
 */
export default function TransactionHistoryPage() {
  return (
    <AccountPage pageName="Transaction history" pageId="history" cat="credits">
      {() => <History />}
    </AccountPage>
  );
}

/** `date('Y-m-d H:i', $createdAt)` — the legacy format, not a locale format. */
function formatLegacyDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function History() {
  const { data, isPending, isError, error } = useTransactions();

  return (
    <div id="container">
      <div id="content" className="clearfix">
        <div id="column1" className="column">
          <div className="habblet-container">
            <div className="cbb clearfix default">
              <h2 className="title">Transaction history</h2>
              <div className="box-content">
                {isPending && <p data-testid="history-loading">Loading your transactions…</p>}

                {isError && (
                  <p data-testid="history-error">
                    Your transaction history could not be loaded
                    {(error as { status?: number } | null)?.status !== undefined
                      ? ` (HTTP ${(error as { status?: number }).status})`
                      : ''}
                    .
                  </p>
                )}

                {data && (
                  <>
                    <table data-testid="history-table">
                      <tbody>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Balance</th>
                          <th>Description</th>
                        </tr>
                        {data.items.map((row) => (
                          <TransactionRow key={row.id} row={row} />
                        ))}
                      </tbody>
                    </table>
                    {data.count === 0 && (
                      <p data-testid="history-empty">No transactions have been recorded yet.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionRow({ row }: { row: Transaction }) {
  return (
    <tr data-testid="history-row">
      <td>{formatLegacyDate(row.created_at)}</td>
      <td>{row.type}</td>
      <td>{row.amount}</td>
      <td>{row.balance_after}</td>
      <td>{row.description}</td>
    </tr>
  );
}
