import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { CommunityStyles } from './LegacyStyles';
import { useLogin } from '../hooks/useAccount';
import { useBanners, useFaq, useSettings } from '../hooks/usePublicContent';
import { holoUrl } from '../services/legacy';

/**
 * The page shell produced by `templates/community_header.php` +
 * `templates/community_footer.php`.
 *
 * The markup is reproduced verbatim, including the legacy PHP's quirks that are
 * visible in the DOM:
 *
 *  - the anonymous `class=""` on `<body>` (the legacy ternary emitted a single
 *    space when `$user->name` was not "Guest"),
 *  - the visitor branch, which is always the one taken because these pages are
 *    anonymous-only,
 *  - the `#habbos-online` count, which came from `GetOnlineCount()` — no public
 *    endpoint publishes it, so the legacy "0" placeholder is emitted,
 *  - the `#column3` ad block and the FAQ footer links, which are filled from
 *    `/api/public/banners` and `/api/public/faq`.
 */

type PageCat = 'community' | 'credits' | 'home';

interface CommunityShellProps {
  /** Legacy `$page['id']`, used to pick the selected navi2 tab. */
  pageId:
    | 'community'
    | 'news'
    | 'tags'
    | 'credits'
    | 'club'
    | 'collectables'
    | 'pixels'
    | 'help'
    | 'me'
    | 'profile'
    // MyHabbo's own home page (`home.php`). This stack has no such page yet, but
    // `cat = "home"`'s navi2 strip has a "My page" tab keyed on it, so the token
    // has to exist for the strip to select it correctly once the page does.
    | 'home'
    | 'history';
  /** Legacy `$page['cat']`, which chooses the secondary navigation strip. */
  cat: PageCat;
  /** Legacy `<title>` content: `SHORTNAME . ": " . $page['name']`. */
  pageName: string;
  /**
   * When set, the header renders the signed-in branch instead of the anonymous
   * one. `community_header.php` chose between them on `$user->name`, so an
   * anonymous visitor got the `#subnavi-login` form and a signed-in user got
   * their name, a profile link and an "enter hotel" link.
   *
   * Only the account pages pass this. Public pages leave it undefined and
   * therefore keep rendering the anonymous markup the committed visual
   * baselines were captured against — the anonymous branch below is unchanged,
   * and must stay that way.
   */
  signedInAs?: string;
  children: React.ReactNode;
}

const SHORTNAME = 'PHPRetro';

/**
 * The signed-in `#subnavi` branch of `templates/community_header.php`.
 *
 * No "remember me" bubble and no registration prompt: those belong to the
 * anonymous branch, and leaving them visible to a signed-in user would be the
 * visible tell of a half-converted header.
 *
 * "Enter PHPRetro" keeps the legacy `/client` target and `openOrFocusHabbo`
 * click behaviour. `me.php` rendered the client link the same way, and the
 * client-entry *handoff* is a separately tracked Phase 5 unit — this button
 * links to the same URL legacy linked to and claims nothing more.
 */
function SignedInSubnav({ username }: { username: string }) {
  return (
    <div id="subnavi">
      <div id="subnavi-user">
        <ul>
          <li id="myhabbo" className="selected">
            <strong>{username}</strong>
            <span></span>
          </li>
          <li>
            <Link to="/account/profile">Edit profile</Link>
            <span></span>
          </li>
          <li className="last">
            <Link to="/me">My page</Link>
            <span></span>
          </li>
        </ul>
      </div>
      <div id="subnavi-logout">
        <Link to="/logout">Log out</Link>
      </div>
      <div id="subnavi-hotel" className="clearfix">
        <p>
          <a
            href="/client"
            id="enter-hotel-open-medium-link"
            target="client"
            onClick={(e) => {
              const w = window as unknown as {
                openOrFocusHabbo?: (el: HTMLAnchorElement) => void;
              };
              if (typeof w.openOrFocusHabbo === 'function') {
                e.preventDefault();
                w.openOrFocusHabbo(e.currentTarget);
              }
            }}
          >
            Enter PHPRetro
          </a>
        </p>
      </div>
    </div>
  );
}

/** The anonymous `#subnavi` branch: "enter hotel" plus the sign-in form. */
function AnonymousSubnav() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useLogin();
  const navigate = useNavigate();

  // The header's form is the site's primary sign-in, so it submits through the
  // API rather than posting to a page. The legacy markup had
  // `action="/account/submit" method="post"`; the `action` here is the fallback
  // for a browser with no JavaScript, where a GET to the sign-in screen is the
  // only thing that can work (a POST to a client-side route cannot be served).
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (username.trim() === '' || password === '') {
      setError('Username and password are required.');
      return;
    }
    try {
      await mutation.mutateAsync({ username: username.trim(), password, rememberMe });
      navigate('/me', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  return (
    <div id="subnavi">
      <div id="subnavi-user">
        <div className="clearfix">&nbsp;</div>
        <p>
          <a href="/client" id="enter-hotel-open-medium-link" target="client">
            Enter PHPRetro
          </a>
        </p>
      </div>
      <div id="subnavi-login">
        <form action="/account" method="get" id="login-form" onSubmit={(e) => void onSubmit(e)}>
          <input type="hidden" name="page" value="" />
          <ul>
            <li>
              <label htmlFor="login-username" className="login-text">
                <b>Username</b>
              </label>
              <input
                tabIndex={1}
                type="text"
                className="login-field"
                name="username"
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <a
                href="#"
                id="login-submit-new-button"
                className="new-button"
                style={{ float: 'left', display: 'none' }}
              >
                <b>Login</b>
                <i></i>
              </a>
              <input type="submit" id="login-submit-button" value="Log in" className="submit" />
            </li>
            <li>
              <label htmlFor="login-password" className="login-text">
                <b>Password</b>
              </label>
              <input
                tabIndex={2}
                type="password"
                className="login-field"
                name="password"
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                tabIndex={3}
                type="checkbox"
                name="_login_remember_me"
                value="true"
                id="login-remember-me"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <label htmlFor="login-remember-me" className="left">
                Remember me
              </label>
            </li>
          </ul>
          {error !== null && (
            <p className="error" data-testid="header-login-error">
              {error}
            </p>
          )}
        </form>
        <div id="subnavi-login-help" className="clearfix">
          <ul>
            <li className="register">
              {/* A router Link, not a bare anchor: the destination is a
                  client-side route now, so a plain <a> forced a full document
                  load and a fresh SPA boot for an in-app navigation. The
                  rendered href is unchanged, so the legacy markup and its
                  stylesheet still match. */}
              <Link to="/account/password/forgot" id="forgot-password">
                <span>I forgot my password/username</span>
              </Link>
            </li>
            <li>
              <a href="/register">
                <span>Register</span>
              </a>
            </li>
          </ul>
        </div>
        <div
          id="remember-me-notification"
          className="bottom-bubble"
          style={{ display: 'none' }}
        >
          <div className="bottom-bubble-t">
            <div></div>
          </div>
          <div className="bottom-bubble-c"></div>
          <div className="bottom-bubble-b">
            <div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CommunityShell({
  pageId,
  cat,
  pageName,
  signedInAs,
  children,
}: CommunityShellProps) {
  const { data: settingsData } = useSettings();
  const { data: bannerData } = useBanners();
  const { data: faqData } = useFaq();

  const settings = settingsData?.settings ?? {};
  const banners = bannerData?.items ?? [];
  // The footer orders FAQ links differently from the help page. Legacy
  // community_footer.php uses `ORDER BY sort_order ASC, id ASC` (no category),
  // whereas help.php groups by category first. /api/public/faq serves the
  // help-page order, so re-sort here rather than change the shared endpoint.
  const faqLinks = [...(faqData?.items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  );
  const siteTracking = settings['site_tracking'] ?? '';

  return (
    <>
      <title>{`${SHORTNAME}: ${pageName} `}</title>
      <CommunityStyles />
      <div id="overlay"></div>
      <div id="header-container">
        <div id="header" className="clearfix">
          <h1>
            <a href="/"></a>
          </h1>
          {signedInAs !== undefined ? (
            <SignedInSubnav username={signedInAs} />
          ) : (
            <AnonymousSubnav />
          )}
          <ul id="navi">
            {/*
              `community_header.php:327-334` renders EITHER the username tab
              (`$user->name != "Guest"`) OR the register tab:
                <?php if($user->name != "Guest"){ ?> …username… <?php }else{ ?>
                <li id="tab-register-now">…</li> <?php } ?>
              The port rendered the register tab unconditionally, so a signed-in
              user was still shown "Register now!". The whole <li> is omitted
              rather than styled away, so the DOM matches legacy too.

              (Legacy also reuses `id="tab-register-now"` for the staff
              Housekeeping tab at line 344 when rank > 4. That duplicate id is
              not reproduced; the staff tab is not ported yet.)
            */}
            {signedInAs === undefined && (
              <li id="tab-register-now">
                <Link to="/register">Register now!</Link>
                <span></span>
              </li>
            )}
            <li className={cat === 'community' ? 'selected' : undefined}>
              {cat === 'community' ? (
                <strong>Community </strong>
              ) : (
                <Link to="/community">Community</Link>
              )}
              <span></span>
            </li>
            <li className={cat === 'credits' ? 'selected' : undefined}>
              {cat === 'credits' ? <strong>Coins </strong> : <Link to="/credits">Coins</Link>}
              <span></span>
            </li>
          </ul>

          <div id="habbos-online">
            <div className="rounded">
              {/* Legacy: `<?= $online ?> Retros online` — SHORTNAME, not the full
                  site name ("Retros", not "PHPRetros"). */}
              <span>0 Retros online</span>
            </div>
          </div>
        </div>
      </div>

      <div id="content-container">
        {/*
          `community_header.php:355-379` has a `navi2` variant for `cat ==
          "home"`:
            Home | My Page | Account Settings | Habbo Club
          rendered only when `$user->name != "Guest"`. `me.php` and `profile.php`
          are both `cat = "home"`, so a signed-in user sees this strip on /me and
          on the profile page. `CommunityShell` rendered nothing for `home`,
          which is most of why /me measured 48.8% different from legacy.
        */}
        {cat === 'home' && signedInAs !== undefined && (
          <div id="navi2-container" className="pngbg">
            <div id="navi2" className="pngbg clearfix">
              <ul>
                <li className={pageId === 'me' ? 'selected' : undefined}>
                  {pageId === 'me' ? 'Home' : <Link to="/me">Home</Link>}
                </li>
                <li className={pageId === 'home' ? 'selected' : undefined}>
                  {/* Legacy links to /home/<username>; this stack has no MyHabbo
                      home page, so the link points at the profile's own page
                      rather than inventing one. Recorded in the inventory. */}
                  {pageId === 'home' ? (
                    'My page'
                  ) : (
                    <a href={`/home/${signedInAs}`}>My page</a>
                  )}
                </li>
                <li className={pageId === 'profile' ? 'selected' : undefined}>
                  {pageId === 'profile' ? (
                    'Account settings'
                  ) : (
                    <Link to="/account/profile">Account settings</Link>
                  )}
                </li>
                <li className=" last">
                  <a href="/club">Retro Club</a>
                </li>
              </ul>
            </div>
          </div>
        )}
        {cat === 'community' && (
          <div id="navi2-container" className="pngbg">
            <div id="navi2" className="pngbg clearfix">
              <ul>
                <li className={pageId === 'community' ? 'selected' : undefined}>
                  {pageId === 'community' ? (
                    'Community'
                  ) : (
                    <Link to="/community">Community</Link>
                  )}
                </li>
                <li className={pageId === 'news' ? 'selected' : undefined}>
                  {pageId === 'news' ? 'News' : <Link to="/articles">News</Link>}
                </li>
                <li className={`${pageId === 'tags' ? 'selected' : ''} last`.trim()}>
                  {pageId === 'tags' ? 'Tags' : <a href="/tag">Tags</a>}
                </li>
              </ul>
            </div>
          </div>
        )}
        {cat === 'credits' && (
          <div id="navi2-container" className="pngbg">
            <div id="navi2" className="pngbg clearfix">
              <ul>
                <li className={pageId === 'credits' ? 'selected' : undefined}>
                  {pageId === 'credits' ? 'Coins' : <Link to="/credits">Coins</Link>}
                </li>
                <li className={pageId === 'club' ? 'selected' : undefined}>
                  {pageId === 'club' ? 'Habbo Club' : <a href="/credits/club">Habbo Club</a>}
                </li>
                <li className={pageId === 'collectables' ? 'selected' : undefined}>
                  {pageId === 'collectables' ? (
                    'Collectables'
                  ) : (
                    <Link to="/credits/collectables">Collectables</Link>
                  )}
                </li>
                <li className={`${pageId === 'pixels' ? 'selected' : ''} last`.trim()}>
                  {pageId === 'pixels' ? 'Pixels' : <a href="/credits/pixels">Pixels</a>}
                </li>
              </ul>
            </div>
          </div>
        )}

        {children}

        <div id="column3" className="column">
          <div className="habblet-container ">
            <div className="ad-container">
              {banners.map((banner) => {
                // `community_footer.php`: `${bannerUrl}` went through HoloUrl(),
                // the link href did not.
                const bannerUrl = holoUrl(banner.banner);
                const linkUrl = banner.url ?? '';
                return (
                  <span key={banner.id}>
                    {bannerUrl !== '' && (
                      <>
                        <a target="_blank" rel="noopener noreferrer" href={linkUrl}>
                          <img src={bannerUrl} alt="" />
                        </a>
                        <br />
                      </>
                    )}
                    {banner.text !== '' && linkUrl !== '' && (
                      <>
                        <a target="_blank" rel="noopener noreferrer" href={linkUrl}>
                          {banner.text}
                        </a>
                        <br />
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div id="footer">
          <p>
            <a href="/" target="_self">
              Homepage
            </a>{' '}
            |{' '}
            <a href="/papers/disclaimer" target="_self">
              Disclaimer
            </a>{' '}
            |{' '}
            <a href="/papers/privacy" target="_self">
              Privacy Policy
            </a>
            {faqLinks.map((faq) => (
              <span key={faq.id}>
                {' '}
                |{' '}
                <a href={`/help/${faq.id}`} target="_new">
                  {faq.question}
                </a>
              </span>
            ))}
          </p>
          <p>
            Powered by <a href="http://www.phpretro.com/">PHPRetro</a>
            <br />
            HABBO is a registered trademark of Sulake Corporation. All rights reserved to their
            respective owner(s).
          </p>
        </div>
      </div>

      {siteTracking !== '' && (
        <div
          // `$settings->find("site_tracking")` was echoed raw into the footer.
          dangerouslySetInnerHTML={{ __html: siteTracking }}
        />
      )}
    </>
  );
}
