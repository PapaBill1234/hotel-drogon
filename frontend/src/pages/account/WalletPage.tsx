import AccountPage from '../../components/AccountPage';
import { usePurse } from '../../hooks/useCredits';
import { useSettings } from '../../hooks/usePublicContent';
import { holoText } from '../../services/legacy';

/**
 * `/credits` — the converted `credits.php`.
 *
 * ## What legacy rendered
 *
 * `credits.php` set `$page['id'] = 'credits'`, `$page['cat'] = 'credits'`,
 * `$page['bodyid'] = 'home'`, `$page['allow_guests'] = true`, and required
 * `community_header.php`. The page is two columns:
 *
 *   #column1  "How to get Credits" — `#credits-methods`, three groups:
 *             Best Way / Other Ways / Tools, each a set of `.credits-method-*`
 *             blocks driven by `credits.js`.
 *   #column2  "Your purse" (`#purse-habblet`) and "What are Retro Coins?"
 *             (`#credits-promo`).
 *
 * ## Why the left column IS ported now
 *
 * An earlier version of this page skipped `#credits-methods` and the Coins promo
 * on the grounds that they are "THIS IS A SAMPLE HABBLET ONLY!" tenant content.
 * That reasoning is defensible in isolation but wrong for its purpose: legacy
 * renders them, they are a large part of the page, and the whole point of this
 * migration is that a visitor cannot tell which stack served the page. The copy
 * is reproduced verbatim from `credits.php` (it is the shipped default, exactly
 * like the `hotelview_news` ship row the community promo needed). An operator
 * edits it in `credits.php` today; the port keeps the same text so the page
 * matches, and it is grep-able when a real content source replaces it.
 *
 * The `Read more` disclosures are rendered in their collapsed state, which is
 * what `credits.js` produces on load (`$("method-show-N").show();
 * $("method-full-N").hide()`).
 *
 * ## Voucher redemption is still absent, and this is now the ONLY missing part
 *
 * The legacy purse carried a `voucherCode` form posting to itself. The plan lists
 * voucher redemption as an explicit handoff unless a verified PolarIS/Nitro
 * integration exists, and none is recorded. A disabled-looking input with no
 * handler would be exactly the "control that silently no-ops" the plan forbids,
 * so the form is not rendered. Everything else in the purse block is.
 */
export default function WalletPage() {
  return (
    <AccountPage pageName="Coins" pageId="credits" cat="credits">
      {() => <CreditsColumns />}
    </AccountPage>
  );
}

function CreditsColumns() {
  return (
    <div id="container">
      <div id="content" style={{ position: 'relative' }} className="clearfix">
        <div id="column1" className="column">
          <HowToGetCredits />
        </div>
        <div id="column2" className="column">
          <Purse />
          <WhatAreCoins />
        </div>
      </div>
    </div>
  );
}

/**
 * `credits.php:34-127`. The three `credits-type-*` groups and their method
 * blocks, with the legacy copy verbatim.
 */
function HowToGetCredits() {
  return (
    <div className="habblet-container ">
      <div className="cbb clearfix green ">
        <h2 className="title">How to get Credits</h2>
        <p className="credits-countries-select">
          THIS IS A SAMPLE HABBLET ONLY! PLEASE EDIT /credits.php TO CHANGE THE CONTENTS!
        </p>
        <ul id="credits-methods">
          <li id="credits-type-promo">
            <h4 className="credits-category-promo">Best Way</h4>
            <ul>
              <li className="clearfix even">
                <div id="method-44" className="credits-method-container">
                  <div className="credits-summary">
                    <h3>Ask a Moderator</h3>
                    <p>
                      Moderators are all over the hotel. Ask one of them and they&apos;ll give
                      you a voucher. Redeem it in the hotel.
                    </p>
                    <p className="credits-read-more" id="method-show-44">
                      Read more
                    </p>
                  </div>
                  <div id="method-full-44" className="credits-method-full" style={{ display: 'none' }}>
                    <p>
                      <b>Here&apos;s How to do this:</b>
                      <br />
                      blablabla
                    </p>
                  </div>
                </div>
              </li>
            </ul>
          </li>
          <li id="credits-type-quick_and_easy">
            <h4 className="credits-category-quick_and_easy">Other Ways</h4>
            <ul>
              <li className="clearfix odd">
                <div id="method-1" className="credits-method-container">
                  <div className="credits-summary">
                    <h3>Refer a Friend</h3>
                    <p>Refer a friend to this hotel and earn some credits.</p>
                    <p className="credits-read-more" id="method-show-1">
                      Read more
                    </p>
                  </div>
                  <div id="method-full-1" className="credits-method-full" style={{ display: 'none' }}>
                    <p>
                      <b>How to do This: </b>
                      <br />
                      <br />
                      Get your link on the front page and send it to your friends. When they
                      sign up, you get credits!
                    </p>
                  </div>
                </div>
              </li>
            </ul>
          </li>
          <li id="credits-type-other">
            <h4 className="credits-category-other">Tools</h4>
            <ul>
              <li className="clearfix odd">
                <div id="method-3" className="credits-method-container">
                  <div className="credits-summary">
                    <div className="credits-tools">
                      {/*
                        Legacy renders a `Reset Hand` button here with no href and
                        no handler of its own — `credits.js` is what would wire it,
                        and it resets a Shockwave client's held furniture, which
                        this stack has no equivalent of. Rendering the button would
                        be the silent no-op the plan forbids, so the block keeps its
                        heading and copy and omits only the control. Recorded in the
                        inventory rather than faked.
                      */}
                    </div>
                    <h3>Reset Hand</h3>
                    <p>Virtual hand too full? Click here to reset it.</p>
                    <p className="credits-read-more" id="method-show-3">
                      Read more
                    </p>
                  </div>
                  <div id="method-full-3" className="credits-method-full" style={{ display: 'none' }}>
                    <p>
                      <b>How to Do This:</b>
                      <br />
                      <br />
                      Click that button above these words. Hard isn&apos;t it?
                    </p>
                  </div>
                </div>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * `credits.php:135-173`. Labels come from `en.php` `redeem.voucher`:
 *   your.purse "Your purse" · you.have "You Currently Have"
 *   coins "Coins" · transactions "Account transactions"
 */
function Purse() {
  const { data, isPending, isError, error } = usePurse();

  return (
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
                <div>You Currently Have</div>
                <span className="purse-balance-amount" data-testid="purse-credits">
                  {data.credits} Coins
                </span>
                <div className="purse-tx">
                  <a href="/credits/history" data-testid="purse-history-link">
                    Account transactions
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
  );
}

/**
 * `credits.php:176-193`. Copy from `en.php:1211-1213`; SHORTNAME is the
 * `site_shortname` setting, so it is read at runtime rather than hard-coded.
 */
function WhatAreCoins() {
  const { data: settingsData } = useSettings();
  const shortname = settingsData?.settings['site_shortname'] ?? '';

  return (
    <div className="habblet-container ">
      <div className="cbb clearfix orange ">
        <h2 className="title">{holoText(`What are ${shortname} Coins?`)}</h2>
        <div id="credits-promo" className="box-content credits-info">
          <div className="credit-info-text clearfix">
            <img
              className="credits-image"
              src="/web-gallery/v2/images/credits/poor.png"
              alt=""
              width="77"
              height="105"
            />
            <p className="credits-text">
              {`${shortname} Coins are the Hotel's currency. You can use them to buy all kinds of things, from rubber ducks and sofas, to VIP membership, jukeboxes and teleports.`}
            </p>
          </div>
          <p className="credits-text-2">
            {`All legitimate ways to get ${shortname} coins are to the left. Remember: ${shortname} coins are ALWAYS and always will be free.`}
          </p>
        </div>
      </div>
    </div>
  );
}
