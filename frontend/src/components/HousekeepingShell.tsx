import { useEffect, useState, type ReactNode } from 'react';

/**
 * `templates/housekeeping_header.php` + `housekeeping_footer.php` — the staff
 * panel's desktop-style window chrome.
 *
 * ## Why this exists
 *
 * The legacy panel is not a web page: it is a fixed-size **window** with a
 * two-row title bar, a beige desktop background, a titled panel and a footer.
 * All of that is the `housekeeping/images/styles/style.css` + `boxes.css` pair.
 * The React panel was authored as a flat web form instead, which the audit
 * measured at **93.5% of the frame differing** on `/housekeeping/login` — the
 * worst page in the whole sweep.
 *
 * The stylesheets and every image this shell references are already served:
 * `proxy/nginx.conf` publishes the legacy `housekeeping/images/` tree at the same
 * `/housekeeping/images/` URLs the client-side routes would otherwise shadow.
 * So no asset had to be copied into this repository — only the markup, which is
 * reproduced with the legacy class names.
 *
 * Structure, verbatim from `housekeeping_header.php:61-73` and
 * `housekeeping_footer.php:33-42`:
 *
 *   .panel
 *     .header_left   PHPRetro logo (links to phpretro.com, as legacy does)
 *     .header_right  trademark gif
 *     .panel_title   "PHPRetro <major>.<minor> Housekeeping" + close button
 *     <content>
 *     .page_footer   .buttons > .footer_button (Homepage)
 *     .copylight     "Powered by PHPRetro" + design credit + Sulake line
 *
 * The close button goes to `/housekeeping/logout` in legacy. This panel's staff
 * session is separate from the public one, so it points at the same route and
 * the app handles the sign-out.
 */
export default function HousekeepingShell({
  pageName,
  showChrome = true,
  children,
}: {
  /** `$page['name']`, used for the `<title>` as `housekeeping_header.php:25`. */
  pageName: string;
  /** False on the login screen, which omits the nav rows but keeps the window. */
  showChrome?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <title>{`PHPRetro Housekeeping: ${pageName}`}</title>
      <link
        rel="shortcut icon"
        href="/housekeeping/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      {/* The panel's own pair, in the legacy order. */}
      <link
        rel="stylesheet"
        type="text/css"
        href="/housekeeping/images/styles/style.css"
      />
      <link
        rel="stylesheet"
        type="text/css"
        href="/housekeeping/images/styles/boxes.css"
      />

      <div className="panel">
        <div className="header_left">
          &nbsp;
          <br />
          &nbsp;
          <br />
          &nbsp;
          <br />
          <a href="http://www.phpretro.com/">
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img src="/housekeeping/images/header_logo.png" alt="PHPRetro" />
          </a>
        </div>
        <div className="header_right">
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src="/housekeeping/images/header_tm1.gif" alt="" />
        </div>

        <div className="panel_title">
          <span className="text">PHPRetro 4.0 Housekeeping</span>
          <div className="close_button">
            <a href="/housekeeping/logout">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src="/housekeeping/images/button_close.gif" alt="Logout" />
            </a>
          </div>
        </div>

        {showChrome && <HousekeepingNav />}

        {children}

        <div className="page_footer">
          <div className="buttons">
            <input
              type="button"
              className="footer_button"
              value="Homepage"
              onClick={() => {
                window.location.href = '/';
              }}
            />
          </div>
        </div>
        <div className="copylight">
          Powered by <a href="http://www.phpretro.com/">PHPRetro</a>
          <br />
          Housekeeping design &copy; 2009{' '}
          <a href="http://www.ukumo.com/">xsixteen</a>,{' '}
          <a href="http://pixelarts.habbohack.servegame.org">Tsuka</a>
          <br />
          HABBO is a registered trademark of Sulake Corporation. All rights
          reserved to their respective owner(s).
        </div>
      </div>
    </>
  );
}

/**
 * The "real time" line the login screen shows above the form.
 *
 * `housekeeping/index.php:94` renders `date('l F j, Y | g:iA')` — e.g.
 * "Saturday October 4, 2026 | 11:13AM". Computed in the browser because that is
 * where the legacy value came from too (the server's clock, rendered once).
 */
export function useHousekeepingDate(): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Minute resolution is all the legacy format shows; the interval exists so a
    // panel left open does not display a stale time indefinitely.
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} | ${hours12}:${minutes}${ampm}`;
}

/**
 * `housekeeping_header.php:74-...` — the panel's navigation rows.
 *
 * Only the two groups whose destinations exist in this app are rendered. The
 * legacy panel has four more (Tools, Moderation, Content, and a Users group), and
 * rendering dead links into unbuilt pages would be the "control that silently
 * does nothing" the plan forbids; the missing pages are reported in the audit
 * instead.
 */
function HousekeepingNav() {
  return (
    <>
      <div className="panel_header">
        <ul id="item">
          <li className="top">
            <div style={{ textAlign: 'center' }}>
              <a href="#">Dashboard</a>
            </div>
          </li>
          <li className="item">
            <a href="/housekeeping/dashboard">Home</a>
          </li>
        </ul>
        <div className="border"></div>

        <ul id="item">
          <li className="top">
            <div style={{ textAlign: 'center' }}>
              <a href="#">Settings</a>
            </div>
          </li>
          <li className="item">
            <a href="/housekeeping/settings">Site settings</a>
          </li>
        </ul>
        <div className="border"></div>

        <ul id="item">
          <li className="top">
            <div style={{ textAlign: 'center' }}>
              <a href="#">Content</a>
            </div>
          </li>
          <li className="item">
            <a href="/housekeeping/news">News</a>
          </li>
          <li className="item">
            <a href="/housekeeping/faq">FAQ</a>
          </li>
          <li className="item">
            <a href="/housekeeping/banners">Banners</a>
          </li>
          <li className="item">
            <a href="/housekeeping/campaigns">Campaigns</a>
          </li>
          <li className="item">
            <a href="/housekeeping/collectables">Collectables</a>
          </li>
        </ul>
        <div className="border"></div>
      </div>
    </>
  );
}
