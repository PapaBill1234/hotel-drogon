import { useNavigate } from 'react-router-dom';

import AccountPage from '../../components/AccountPage';
import { useClearSessionCache, useLogout } from '../../hooks/useAccount';
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
                    target="client"
                    onClick={(e) => {
                      // `me.php` called openOrFocusHabbo(this) and cancelled the
                      // default navigation. The helper is loaded as a classic
                      // script by index.html; if it is absent the plain link is
                      // the correct fallback rather than a dead click.
                      const w = window as unknown as {
                        openOrFocusHabbo?: (el: HTMLAnchorElement) => void;
                      };
                      if (typeof w.openOrFocusHabbo === 'function') {
                        e.preventDefault();
                        w.openOrFocusHabbo(e.currentTarget);
                      }
                    }}
                  >
                    Enter<i></i>
                  </a>
                  <b></b>
                </div>
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
        </div>
      </div>
    </div>
  );
}
