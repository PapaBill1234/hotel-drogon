import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import AccountPage from '../../components/AccountPage';
import { useClearSessionCache, useLogout } from '../../hooks/useAccount';
import { useCampaigns } from '../../hooks/usePublicContent';
import { creditsKeys } from '../../hooks/useCredits';
import { fetchClientEntry } from '../../services/apiAccount';
import { launchUrl } from '../../services/clientEntry';
import { holoText } from '../../services/legacy';
import type { User } from '../../types/account';

/**
 * `/me` — the signed-in user's own page, the converted `me.php`.
 *
 * ## What the legacy page actually rendered
 *
 * `me.php` set `$page['id'] = 'me'`, `$page['bodyid'] = 'home'`,
 * `$page['cat'] = 'home'` and required `community_header.php`, then rendered
 * `#new-personal-info`: the avatar plate, the motto, a `#link-bar` of credits,
 * Club status and pixels, and a `#habbo-feed` of notifications. The styling for
 * that markup lives in `v2/styles/personal.css`, which `CommunityShell` already
 * loads (it is in the community set), so the legacy class names below are the
 * ones that make the page look like itself. That is why this page reproduces
 * the legacy element ids rather than inventing new ones.
 *
 * ## What is deliberately NOT rendered, and why
 *
 *  - **habbo-feed widgets** (Club upsell, birthday, friend requests, online
 *    friends, group updates, staff ticket count). The APIs behind them are
 *    minimail, friendships, guilds and the helpdesk — Phases 6, 7 and 9. The
 *    plan's rule 6 forbids inventing them, and a plausible-looking zero would be
 *    a simulated success.
 *  - **HC/Club status.** `me.php` called `$user->IsHCMember()` / `HCDaysLeft()`;
 *    nothing in the current API exposes membership, so the link is rendered
 *    without a status claim. Club is also an explicit handoff in Phase 5.
 *  - **The avatar "self,b,3,3,sml,1,0" image** is kept, because it is a plain
 *    URL rather than a data dependency, but it points at the external Habbo
 *    imaging host the legacy site used. It is decorative: if that host is
 *    unreachable the image is hidden and the surrounding layout is unaffected.
 */
export default function MePage() {
  return (
    <AccountPage pageName="My page">
      {(user) => <MeContent user={user} />}
    </AccountPage>
  );
}

/** `date('M j, Y g:i:s A', $lastLogin)`, matching me.php's feed entry. */
function formatLastLogin(epochSeconds: number): string {
  if (epochSeconds <= 0) return 'Never';
  const d = new Date(epochSeconds * 1000);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hours12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

function MeContent({ user }: { user: User }) {
  const { mutate: doLogout, isPending } = useLogout();
  const clearSessionCache = useClearSessionCache();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);

  /**
   * The "Enter" button: one press takes the visitor into the hotel.
   *
   * `me.php:40` was `<a href="/client" target="client" onclick="openOrFocusHabbo(this); return false;">`.
   * Two things went wrong in the port:
   *
   *  1. `openOrFocusHabbo` **is** defined on this page (`common.js` is loaded),
   *     so the handler always ran — and it calls `HabboClient.openOrFocus(this)`,
   *     which does `window.open(...)`. A popup blocker kills that silently, and
   *     because the legacy code returned `false`/called `preventDefault()` the
   *     link's own `href` never navigated either. The result was a button that
   *     did nothing at all.
   *  2. Even when the link did navigate, `/client` only *prepares* a ticket and
   *     renders a second button — so entering took two presses.
   *
   * This fetches the entry and launches the configured client in a single press.
   * When no client launch is configured the visitor still goes to `/client`,
   * which explains that state honestly instead of failing silently here.
   *
   * `fetchClientEntry` is called directly rather than through the
   * `useClientEntry` *query*: this is an action, and it must mint a fresh ticket
   * every press. Reusing the cached query result would hand the client a ticket
   * the server has already voided.
   */
  async function onEnter() {
    if (entering) return;
    setEnterError(null);
    setEntering(true);
    try {
      const entry = await fetchClientEntry();
      // The ticket just changed, so any cached entry for /client is stale.
      await queryClient.invalidateQueries({ queryKey: creditsKeys.clientEntry });
      const launch = launchUrl(entry);
      if (launch === null) {
        // Nothing configured to launch: the /client page is where that is
        // explained, with the connection settings that are missing.
        setEntering(false);
        navigate('/client');
        return;
      }
      // Same tab, deliberately. `window.open` is how legacy did it and is what
      // popup blockers drop; a top-level navigation cannot be blocked, so the
      // single press always does something observable. The client is the
      // destination, not a side window.
      window.location.assign(launch);
    } catch (err) {
      setEntering(false);
      setEnterError(err instanceof Error ? err.message : 'Could not prepare your entry.');
    }
  }

  function onLogout() {
    doLogout(undefined, {
      // Navigate FIRST, then clear the cache. The order is load-bearing:
      // clearing first refetches the still-mounted `/api/me` observer, and the
      // logout endpoint answers 200 before the Redis deletion is confirmed, so
      // that refetch can report a live session and keep this page rendered.
      // Navigating unmounts the observer, so the clear cannot re-read anything.
      // (A `flushSync` navigation from inside the mutation callback throws and
      // silently never runs — that was the first attempt at this.)
      onSettled: () => {
        navigate('/', { replace: true });
        void clearSessionCache();
      },
    });
  }

  return (
    <div id="container">
      <div id="content" className="clearfix">
        <div id="column1" className="column">
          <div className="habblet-container">
            <div id="new-personal-info">
              <div className="enter-hotel-btn">
                <div className="open enter-btn">
                  <a
                    href="/client"
                    data-testid="me-enter"
                    aria-busy={entering}
                    onClick={(e) => {
                      // The href is the no-JavaScript fallback AND the pre-hydration
                      // behaviour. `preventDefault` is essential: without it the
                      // browser would navigate to /client while the entry request
                      // is still in flight. See `onEnter` for why the legacy
                      // `openOrFocusHabbo(this)` path was dropped.
                      e.preventDefault();
                      void onEnter();
                    }}
                  >
                    {entering ? 'Entering…' : 'Enter'}
                    <i></i>
                  </a>
                  <b></b>
                </div>
                {enterError !== null && (
                  <p className="error" data-testid="me-enter-error">
                    {enterError}
                  </p>
                )}
              </div>

              <div id="habbo-plate">
                <a href="/profile">
                  <img
                    alt={user.username}
                    src={`https://www.habbo.com/habbo-imaging/avatarimage?figure=${encodeURIComponent(user.look)}&size=b&direction=3&head_direction=3&crr=0&gesture=sml&frame=1`}
                    width={64}
                    height={110}
                    onError={(e) => {
                      // Decorative only: an unreachable imaging host must not
                      // leave a broken-image box in the middle of the page.
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                </a>
              </div>

              <div id="habbo-info">
                <div id="motto-container" className="clearfix">
                  <strong data-testid="me-username">{user.username}:</strong>
                  <div>
                    <span title="Change your motto">
                      <span data-testid="me-motto">
                        {user.motto !== '' ? user.motto : 'Click here to change your motto'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              <ul id="link-bar" className="clearfix">
                <li className="change-looks">
                  <a href="/account/profile">Change looks &raquo;</a>
                </li>
                <li className="credits">
                  <a href="/credits" data-testid="me-credits">
                    {user.credits}
                  </a>{' '}
                  Credits
                </li>
                <li className="club">
                  <a href="/credits/club">Join Habbo Club &raquo;</a>
                </li>
                <li className="activitypoints">
                  <a href="/credits/pixels" data-testid="me-pixels">
                    {user.pixels}
                  </a>{' '}
                  Pixels
                </li>
              </ul>

              <div id="habbo-feed">
                <ul id="feed-items">
                  <li className="small" id="feed-lastlogin">
                    Last online: <span data-testid="me-last-login">{formatLastLogin(user.last_login)}</span>
                  </li>
                  <li className="small" id="feed-account-actions">
                    <a href="/account/profile">Edit your profile</a>
                    {' | '}
                    <a href="/credits/history">Transaction history</a>
                    {' | '}
                    <button
                      type="button"
                      onClick={onLogout}
                      disabled={isPending}
                      data-testid="logout-button"
                    >
                      {isPending ? 'Logging out…' : 'Log out'}
                    </button>
                  </li>
                </ul>
              </div>
              <p className="last"></p>
            </div>
          </div>

          {/*
            `me.php:196-229` — the "Hot Campaigns" habblet, which sits in
            `#column1` BELOW the personal-info box. Its data is real and already
            published: `me.php` runs

              SELECT name, `desc`, image, url FROM phpretro_campaigns
              WHERE visible = '1' ORDER BY sort_order ASC, id DESC

            and `/api/public/campaigns` serves exactly that list, which is why
            this block could be ported rather than deferred. On this fixture the
            table is empty, so the box renders header-only — which is what legacy
            renders too, and is visible in the audit capture.
          */}
          <HotCampaigns />
        </div>
      </div>
    </div>
  );
}

/**
 * `me.php:196-229`. `$input->IsEven($i)` picks `even`/`odd` per row, and both
 * the image and the link go through `str_replace("%path%", PATH, …)` — a token
 * an operator can put in a campaign row, NOT a URL prefix. Reproduced with `/`
 * substituted for `PATH`, which is this deployment's value.
 */
function HotCampaigns() {
  const { data } = useCampaigns();
  const campaigns = data?.items ?? [];

  function withPath(value: string): string {
    return value.split('%path%').join('');
  }

  return (
    <div className="habblet-container ">
      <div className="cbb clearfix orange ">
        <h2 className="title">Hot Campaigns</h2>
        <div id="hotcampaigns-habblet-list-container">
          <ul id="hotcampaigns-habblet-list">
            {campaigns.map((campaign, index) => (
              <li key={campaign.id} className={index % 2 === 0 ? 'even' : 'odd'}>
                <div className="hotcampaign-container">
                  <a href={withPath(campaign.url)}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img src={withPath(campaign.image)} style={{ float: 'left' }} alt="" />
                  </a>
                  <h3>{holoText(campaign.name)}</h3>
                  <p>{holoText(campaign.desc)}</p>
                  <p className="link">
                    <a href={withPath(campaign.url)}>Go there &raquo;</a>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
