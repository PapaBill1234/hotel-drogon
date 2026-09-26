import AccountPage from '../../components/AccountPage';
import { usePurse } from '../../hooks/useCredits';

/**
 * `/credits` — the converted `credits.php`.
 *
 * ## What legacy rendered, and what is reproduced
 *
 * `credits.php` set `$page['id'] = 'credits'`, `$page['cat'] = 'credits'`,
 * `$page['bodyid'] = 'home'`, `$page['allow_guests'] = true`, and required
 * `community_header.php`. Its `#column2` held the `#purse-habblet` block, which
 * is the only part of the page backed by data:
 *
 *   <li class="even icon-purse">
 *     <div>You have:</div>
 *     <span class="purse-balance-amount"><?= $user->user("credits") ?> Coins</span>
 *     <div class="purse-tx"><a href="/credits/history">Transactions</a></div>
 *   </li>
 *
 * Those classes live in `v2/styles/style.css`, which `CommunityShell` already
 * loads, so the markup is reused rather than re-invented. The other two blocks
 * (`#credits-methods`, the "What are Coins?" promo) are the legacy file's own
 * sample copy, marked in the source as "THIS IS A SAMPLE HABBLET ONLY!". They are
 * tenant-authored content, not behaviour, and are not ported — copying marketing
 * placeholder text into the new stack would be inventing product content.
 *
 * ## Voucher redemption is absent on purpose
 *
 * The legacy purse carried a `voucherCode` form posting to itself. The plan lists
 * voucher redemption as an explicit handoff unless a verified PolarIS/Nitro
 * integration exists, and no such integration is recorded, so no form is
 * rendered here. A disabled-looking input with no handler would be exactly the
 * "control that silently no-ops" the plan forbids.
 */
export default function WalletPage() {
  return (
    <AccountPage pageName="Coins" pageId="credits" cat="credits">
      {() => <Purse />}
    </AccountPage>
  );
}

function Purse() {
  const { data, isPending, isError, error } = usePurse();

  return (
    <div id="container">
      <div id="content" style={{ position: 'relative' }} className="clearfix">
        <div id="column2" className="column">
          <div className="habblet-container ">
            <div className="cbb clearfix brown ">
              <h2 className="title">Your purse</h2>
              <div id="purse-habblet">
                {isPending && <div className="box-content">Loading your purse…</div>}
                {isError && (
                  <div className="box-content" data-testid="purse-error">
                    Your balance could not be loaded
                    {(error as { status?: number } | null)?.status !== undefined
                      ? ` (HTTP ${(error as { status?: number }).status})`
                      : ''}
                    .
                  </div>
                )}
                {data && (
                  <ul>
                    <li className="even icon-purse">
                      <div>You have:</div>
                      <span className="purse-balance-amount" data-testid="purse-credits">
                        {data.credits} Coins
                      </span>
                      <div className="purse-tx">
                        <a href="/credits/history" data-testid="purse-history-link">
                          Transactions
                        </a>
                      </div>
                    </li>
                    <li className="odd">
                      <div className="box-content">
                        <div>Activity Points:</div>
                        <span className="purse-balance-amount" data-testid="purse-pixels">
                          {data.pixels} Pixels
                        </span>
                      </div>
                    </li>
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
