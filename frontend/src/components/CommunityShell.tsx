import { Link } from 'react-router-dom';

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
  pageId: 'community' | 'news' | 'tags' | 'credits' | 'club' | 'collectables' | 'pixels' | 'help';
  /** Legacy `$page['cat']`, which chooses the secondary navigation strip. */
  cat: PageCat;
  /** Legacy `<title>` content: `SHORTNAME . ": " . $page['name']`. */
  pageName: string;
  children: React.ReactNode;
}

const SHORTNAME = 'PHPRetro';

export default function CommunityShell({ pageId, cat, pageName, children }: CommunityShellProps) {
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
      <div id="overlay"></div>
      <div id="header-container">
        <div id="header" className="clearfix">
          <h1>
            <a href="/"></a>
          </h1>
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
              <form action="/account/submit" method="post" id="login-form">
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
                    <input
                      type="submit"
                      id="login-submit-button"
                      value="Log in"
                      className="submit"
                    />
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
                    />
                    <input
                      tabIndex={3}
                      type="checkbox"
                      name="_login_remember_me"
                      value="true"
                      id="login-remember-me"
                    />
                    <label htmlFor="login-remember-me" className="left">
                      Remember me
                    </label>
                  </li>
                </ul>
              </form>
              <div id="subnavi-login-help" className="clearfix">
                <ul>
                  <li className="register">
                    <a href="/account/password/forgot" id="forgot-password">
                      <span>I forgot my password/username</span>
                    </a>
                  </li>
                  <li>
                    <a href="/register">
                      <span>Register</span>
                    </a>
                  </li>
                </ul>
              </div>
              <div id="remember-me-notification" className="bottom-bubble" style={{ display: 'none' }}>
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
          <ul id="navi">
            <li id="tab-register-now">
              <Link to="/register">Register now!</Link>
              <span></span>
            </li>
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
            HABBO is a registered trademark of Sulake Corporation. All rights reserved to their respective owner(s).
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
