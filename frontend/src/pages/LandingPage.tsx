import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useLogin } from '../hooks/useAccount';
import { useFaq, useSettings } from '../hooks/usePublicContent';
import { LandingStyles } from '../components/LegacyStyles';
import { splitPromoPhrases } from '../services/legacy';

/**
 * The site root, as rendered by `index.php` through
 * `templates/login_header.php` + `templates/login_footer.php`.
 *
 * NOT `landing.php`: index.php only defers to it when the setting
 * `site_new_landing_page == "1"`, and that setting is not present in this
 * deployment, so the classic template is what `/` actually serves.
 *
 * The markup below is a transcription of the DOM the legacy page emits, in the
 * legacy order, with the legacy ids/classes:
 *
 *   login_header.php  -> #overlay, #container, .cbb.process-template-box,
 *                        #content, #header (logo + ul.stats), #process-content
 *   index.php         -> #column1 (#create-habbo), #column2 (login habblet +
 *                        two .ad-container blocks), empty #column3,
 *                        #column-footer (#tag-cloud-slim)
 *   login_footer.php  -> #footer (static links + FAQ links), HabboView.run()
 *
 * The `site_flash_promo` branch of index.php (lines 53-98) is dead here
 * (`site_flash_promo` is 0), so only the non-flash branch is reproduced.
 *
 * Locale strings come from `includes/languages/en.php`, which has no public
 * endpoint; they are reproduced verbatim with their line numbers. Everything
 * that came from `$settings->find(...)` is read from `/api/public/settings`.
 */

/** `en.php:472` — `$loc['pagename.home']`. */
const PAGE_NAME = 'Home';
/** `en.php:485` — `$loc['join.now']` (the legacy value ends in `&raquo;`). */
const JOIN_NOW = "Join now, it's free \u00BB";
/** `en.php:491` — `$loc['sign.in']`. */
const SIGN_IN = 'Sign in';
/** `en.php:87` / `en.php:483` — `$loc['username']` / `$loc['forgot']`. */
const USERNAME = 'Username';
const PASSWORD = 'Password';
const FORGOT = 'I forgot my username/password';
/** `en.php:492` — `$loc['remember.me']`. */
const REMEMBER_ME = 'Remember me';
/** `en.php:493` — `$loc['register.link']`. */
const REGISTER_LINK = 'Register for free';
/**
 * `en.php:494` — `$loc['remember.warning']`. It sits inside the
 * `#remember-me-notification` bubble, which is `display:none` until the
 * checkbox is ticked.
 */
const REMEMBER_WARNING =
  "By selecting 'remember me' you will stay signed in on this computer until you click 'Sign Out'. If this is a public computer please do not use this feature.";
/** `en.php:552-555` — footer locale strings. */
const COPYRIGHT_HABBO =
  'HABBO is a registered trademark of Sulake Corporation. All rights reserved to their respective owner(s).';
const LINK_HOMEPAGE = 'Homepage';
const LINK_DISCLAIMER = 'Disclaimer';
const LINK_PRIVACY = 'Privacy Policy';

export default function LandingPage() {
  const { data: settingsData } = useSettings();
  const { data: faqData } = useFaq();

  // The sign-in box is this page's primary action, so it submits through the API
  // rather than posting to a page. The legacy markup had
  // `action="/account/submit" method="post"`; here `action` is only the
  // no-JavaScript fallback (a GET to the sign-in screen), because a POST to a
  // client-side route cannot be served — the SPA catch-all is a static file, and
  // nginx answers a POST to a static file with **405 Not Allowed**. That was the
  // bug: pressing "Sign in" produced a bare nginx 405 instead of signing in.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const mutation = useLogin();
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    if (username.trim() === '' || password === '') {
      setLoginError('Username and password are required.');
      return;
    }
    try {
      await mutation.mutateAsync({ username: username.trim(), password, rememberMe });
      navigate('/me', { replace: true });
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  // `LoginFormUI.init()` below installs the legacy submit path on the styled
  // button, and that path is a trap: fullcontent.js binds
  //   $("login-submit-new-button").observe("click", ... $("...").up("form").submit())
  // and Prototype's `Form.submit()` calls the DOM's `form.submit()` directly,
  // which **does not fire a submit event**. React's `onSubmit` therefore never
  // runs: the browser performs a native POST to the form's `action`
  // (`/account/submit`), the SPA catch-all answers with a static file, and nginx
  // returns **405 Not Allowed** — the exact failure a user reported.
  //
  // A capture-phase listener on the button runs *before* Prototype's bubble-phase
  // observer, so stopping propagation there keeps the legacy code from ever
  // reaching its `.submit()` call, and `preventDefault` suppresses the native
  // submission. The API call then goes through `onSubmit` as it does everywhere
  // else, so CSRF is untouched.
  const submitLatest = useRef(onSubmit);
  submitLatest.current = onSubmit;
  useEffect(() => {
    const el = document.getElementById('login-submit-new-button');
    if (!el) return;
    const intercept = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      void submitLatest.current(event as unknown as FormEvent<HTMLFormElement>);
    };
    el.addEventListener('click', intercept, true);
    return () => el.removeEventListener('click', intercept, true);
  }, []);

  const settings = settingsData?.settings ?? {};
  // `SHORTNAME` was a config constant; it is also published as `site_shortname`
  // and is interpolated into several locale strings.
  const shortname = settings['site_shortname'] ?? '';
  // index.php line 52: `explode("|", $settings->find("site_promo_phrases"))`,
  // rendered as index 0, 1, 2 into landing-text-1/2/3.
  const phrases = splitPromoPhrases(settings['site_promo_phrases']);

  // login_footer.php builds its links from `phpretro_faq` ordered by
  // `sort_order, id` (no category), which is not the order /api/public/faq
  // serves (that one is the help page's grouping), so re-sort here.
  const faqLinks = [...(faqData?.items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  );

  useEffect(() => {
    // index.php ends the login habblet with
    //   HabboView.add(LoginFormUI.init); HabboView.add(RememberMeUI.init);
    // and login_footer.php ends the page with `HabboView.run()`, which flushes
    // them. Both globals come from the legacy scripts the SPA entry loads
    // (fullcontent.js carries the same implementations landing.js does).
    //
    // LoginFormUI.init() is the one that matters visually: it pushes the plain
    // `#login-submit-button` input off-screen (`margin-left: -10000px`) and
    // reveals the `#login-submit-new-button` anchor, which is the button the
    // legacy page actually shows. RememberMeUI.init() only positions the
    // (hidden) remember-me bubble.
    const w = window as unknown as {
      LoginFormUI?: { init?: () => void };
      RememberMeUI?: { init?: () => void };
    };
    try {
      w.LoginFormUI?.init?.();
    } catch (err) {
      console.warn('LoginFormUI.init() failed', err);
    }
    try {
      w.RememberMeUI?.init?.();
    } catch (err) {
      console.warn('RememberMeUI.init() failed', err);
    }
  }, []);

  return (
    <>
      {/* login_header.php <head> (SHORTNAME . ": " . $page['name']) */}
      <title>{`${shortname}: ${PAGE_NAME} `}</title>
      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      <link
        rel="alternate"
        type="application/rss+xml"
        title={`${shortname}: RSS`}
        href="/articles/rss.xml"
      />
      {/*
        The full login_header.php set, in order: frontpage.css FIRST, then
        style/buttons/boxes/tooltips, then process.css. This page previously
        depended on the global sheet list in index.html for the first four and
        declared only process.css itself — and frontpage.css, which carries the
        front-page promo layout, was missing entirely. Each page family now
        declares its own set (components/LegacyStyles.tsx) because the three
        legacy headers load different sets.
      */}
      <LandingStyles />

      {/* login_header.php:130-146 (the `new_landing != true` branch) */}
      <div id="overlay"></div>

      <div id="container">
        <div className="cbb process-template-box clearfix">
          <div id="content">
            <div id="header" className="clearfix">
              <h1>
                <a href="/"></a>
              </h1>
              <ul className="stats">
                <li className="stats-online">
                  {/*
                    Legacy: `GetOnlineCount()` -- a live users table count with
                    no public endpoint. `0` is the value this deployment
                    returns, and `.stats-fig` is a masked region anyway.
                  */}
                  <span className="stats-fig">0</span> {`${shortname}s online now`}
                </li>
                <li className="stats-visited">
                  {/*
                    Legacy: `HotelStatus()`, whose default is "online" unless
                    `site_status_image` is 2 (a setting the public API does not
                    publish). The legacy page renders online.gif here.
                  */}
                  <img src="/web-gallery/v2/images/online.gif" alt="online" />
                </li>
              </ul>
            </div>
            <div id="process-content">
              <div id="column1" className="column">
                <div className="habblet-container " id="create-habbo">
                  {/* index.php:105-114 -- the `site_flash_promo == 0` branch.
                      The duplicated id="create-habbo" is in the legacy markup. */}
                  <div id="create-habbo" className="layout-static">
                    <div
                      id="create-habbo-nonflash"
                      style={{
                        backgroundImage:
                          'url(/web-gallery/v2/images/landing/pixel.gif)',
                      }}
                    >
                      <div className="landing-text-1">
                        <span>{phrases[0]}</span>
                      </div>
                      <div className="landing-text-2">
                        <span>{phrases[1] ?? ''}</span>
                      </div>
                      <div className="landing-text-3">
                        <span>{phrases[2] ?? ''}</span>
                      </div>

                      <div id="landing-register-text">
                        <a href="/register">
                          <span>{JOIN_NOW}</span>
                        </a>
                      </div>
                      <div id="landing-promotional-text">
                        <span>{`${shortname} is a virtual world where you can meet and make friends.`}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div id="column2" className="column">
                <div className="habblet-container ">
                  <div className="cbb loginbox clearfix">
                    <h2 className="title">{SIGN_IN}</h2>

                    <div className="box-content clearfix" id="login-habblet">
                      {/* `Csrf::field()` emitted a hidden input here; the SPA
                          entry has no CSRF hook, and a hidden input has no
                          visual effect. */}
                      <form action="/account" method="get" className="login-habblet" onSubmit={(e) => void onSubmit(e)}>
                        <ul>
                          <li>
                            <label htmlFor="login-username" className="login-text">
                              {USERNAME}
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
                          </li>
                          <li>
                            <label htmlFor="login-password" className="login-text">
                              {PASSWORD}
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
                              type="submit"
                              value={SIGN_IN}
                              className="submit"
                              id="login-submit-button"
                            />
                            <a
                              href="#"
                              id="login-submit-new-button"
                              className="new-button"
                              style={{ float: 'left', marginLeft: 0, display: 'none' }}
                            >
                              <b
                                style={{
                                  paddingLeft: '10px',
                                  paddingRight: '7px',
                                  width: '55px',
                                }}
                              >
                                {SIGN_IN}
                              </b>
                              <i></i>
                            </a>
                          </li>
                          <li className="no-label">
                            <input
                              tabIndex={3}
                              type="checkbox"
                              value="true"
                              name="_login_remember_me"
                              id="login-remember-me"
                              checked={rememberMe}
                              onChange={(e) => setRememberMe(e.target.checked)}
                            />
                            <label htmlFor="login-remember-me">{REMEMBER_ME}</label>
                          </li>
                          <li className="no-label">
                            <a href="/register" className="login-register-link">
                              <span>{REGISTER_LINK}</span>
                            </a>
                          </li>
                          <li className="no-label">
                            <a href="/account/password/forgot" id="forgot-password">
                              <span>{FORGOT}</span>
                            </a>
                          </li>
                        </ul>
                        {loginError !== null && (
                          <p className="error" data-testid="landing-login-error">
                            {loginError}
                          </p>
                        )}
                      </form>
                    </div>
                  </div>

                  <div
                    id="remember-me-notification"
                    className="bottom-bubble"
                    style={{ display: 'none' }}
                  >
                    <div className="bottom-bubble-t">
                      <div></div>
                    </div>
                    <div className="bottom-bubble-c">{REMEMBER_WARNING}</div>
                    <div className="bottom-bubble-b">
                      <div></div>
                    </div>
                  </div>
                </div>

                <div className="habblet-container ">
                  <div className="ad-container">
                    <div id="geoip-ad" style={{ display: 'none' }}></div>
                  </div>
                </div>

                <div className="habblet-container "></div>

                <div className="habblet-container ">
                  <div className="ad-container">
                    <a href="register.php">
                      <img
                        src="/web-gallery/v2/images/landing/uk_party_frontpage_image.gif"
                        alt=""
                      />
                    </a>
                  </div>
                </div>
              </div>

              <div id="column3" className="column"></div>

              <div id="column-footer">
                <div className="habblet-container ">
                  <div className="habblet box-content" id="tag-cloud-slim">
                    {/* index.php:255-258 -- `$loc['tags']` is
                        SHORTNAME."s Like.." for the landing locale, and
                        `$loc['no.tags']` is unset there, so the legacy page
                        renders the span and nothing else. */}
                    <span className="tags-habbos-like">{`${shortname}s Like..`}</span>
                  </div>
                </div>
              </div>

              {/* login_footer.php:45-50 */}
              <div id="footer">
                <p>
                  <a href="/" target="_self">
                    {LINK_HOMEPAGE}
                  </a>{' '}
                  |{' '}
                  <a href="/papers/disclaimer" target="_self">
                    {LINK_DISCLAIMER}
                  </a>{' '}
                  |{' '}
                  <a href="/papers/privacy" target="_self">
                    {LINK_PRIVACY}
                  </a>
                  {faqLinks.map((faq) => (
                    <Fragment key={faq.id}>
                      {' | '}
                      <a href={`/help/${faq.id}`} target="_new">
                        {faq.question}
                      </a>
                    </Fragment>
                  ))}
                </p>
                <p>
                  Powered by <a href="http://www.phpretro.com/">PHPRetro</a>
                  <br />
                  {COPYRIGHT_HABBO}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        login_footer.php runs `HabboView.run()` here, which flushes the
        LoginFormUI/RememberMeUI callbacks registered above; `App` already
        calls `HabboView.run()` (and `Rounder.init()`) after every route
        change, so it is not repeated.

        `HabboView.add(LoginFormUI.init)`/`RememberMeUI.init` and the
        `Rounder.init()` guards in index.php are also not emitted as script
        tags: the guards were no-ops because the body carries
        `process-template`, and the two UI initialisers are invoked from the
        effect above instead of through an injected inline script.

        `$settings->find("site_tracking")` is echoed raw by login_footer.php,
        but /api/public/settings withholds raw-markup settings and the value is
        empty in this deployment, so nothing is emitted.
      */}
    </>
  );
}
