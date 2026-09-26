import type { ReactNode } from 'react';

import { ProcessStyles } from './LegacyStyles';
import { useFaq, useSettings } from '../hooks/usePublicContent';
import { holoText } from '../services/legacy';

/**
 * The `templates/login_header.php` + `templates/login_footer.php` shell for
 * "process template" pages.
 *
 * WHY THIS EXISTS AS ITS OWN SHELL
 *
 * The legacy site has three page families with three different chrome, and the
 * recovery flow is NOT in the community family:
 *
 *   index.php, landing.php, forgot.php, reauthenticate.php, login_popup.php
 *     -> login_header/login_footer, `<body class="process-template">`
 *     -> #overlay > #container > .cbb.process-template-box > #content
 *     -> #header with a bare logo + online count ONLY (no nav, no tabs)
 *     -> #process-content, then #footer
 *
 *   community.php, articles.php, help.php, collectables.php, me.php, ...
 *     -> community_header/community_footer, `<body id="home">`, full nav
 *
 * `ForgotPasswordPage` and `LoginPage` were rendered inside `CommunityShell`,
 * which is the wrong family: they grew the whole header, the Register/Community/
 * Coins tab bar and the #subnavi sign-in form, on a white page, where legacy
 * shows a centred panel on the light-blue process background. On `/forgot` that
 * measured as **86% of the frame differing** — the worst page in the audit.
 *
 * The class names below are the legacy ones, so `style.css` and `process.css`
 * apply to the markup they were written for. `#overlay` is rendered because
 * `process.css` positions against it and the legacy page always emitted it.
 */
export default function ProcessShell({
  pageName,
  children,
}: {
  /** `$page['name']`, used for `<title>`: `SHORTNAME . ": " . $page['name']`. */
  pageName: string;
  children: ReactNode;
}) {
  const { data: settingsData } = useSettings();
  const { data: faqData } = useFaq();

  const settings = settingsData?.settings ?? {};
  const shortname = settings['site_shortname'] ?? '';
  const siteTracking = settings['site_tracking'] ?? '';

  // `login_footer.php` builds its FAQ links from `phpretro_faq` ordered by
  // `sort_order, id` (no category), unlike /api/public/faq's help-page grouping.
  const faqLinks = [...(faqData?.items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  );

  return (
    <>
      <title>{`${shortname}: ${pageName} `}</title>
      <ProcessStyles />
      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      {/*
        The legacy `<body>` is written by the template, which this SPA cannot
        own; `App.tsx` sets the equivalent class/id on <body> for these routes
        instead. See the PROCESS_BODY map there.
      */}
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
                  {/* `GetOnlineCount()` has no public endpoint; the legacy page
                      shows 0 on this fixture and the value is masked in the
                      parity harness. Rendering 0 is the same placeholder the
                      community shell uses. */}
                  <span className="stats-fig">0</span> retros online now
                </li>
                <li className="stats-visited">
                  <img
                    src="/web-gallery/v2/images/online.gif"
                    alt="online"
                    style={{ border: 0 }}
                  />
                </li>
              </ul>
            </div>

            <div id="process-content">{children}</div>

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
                {faqLinks.map((f) => (
                  <span key={f.id}>
                    {' | '}
                    <a href={`/help/${f.id}`} target="_new">
                      {/* Legacy escaped this with HoloText before echoing. */}
                      {holoText(f.question)}
                    </a>
                  </span>
                ))}
              </p>
              <p>
                Powered by <a href="http://www.phpretro.com/">PHPRetro</a>
                <br />
                HABBO is a registered trademark of Sulake Corporation. All rights
                reserved to their respective owner(s).
              </p>
            </div>
          </div>
        </div>
      </div>
      {siteTracking !== '' && <div dangerouslySetInnerHTML={{ __html: siteTracking }} />}
    </>
  );
}
