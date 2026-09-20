import { LEGACY_ALIGN_LEFT, LEGACY_BORDER_ZERO } from '../services/jsxLegacy';

/**
 * `maintenance.php` (classic template) with the closure flag coming from
 * `/api/public/maintenance`.
 *
 * The legacy entry point redirected to `/` when `site_closed` was "0" and to
 * the new template when `maintenance_style` was "1"; the API collapses both
 * decisions into `closed` and `style`, and `MaintenancePage` picks the
 * matching markup.
 *
 * The bubble copy (`$lang->loc['text.1']` / `['text.2']`) and the three GIFs
 * are static template content — no public endpoint publishes them.
 */

/** Legacy `$lang->loc['text.1']` and `['text.2']`. */
const CLASSIC_STRINGS = {
  text1: 'The hotel is closed for maintenance.',
  text2: 'We are working hard to get everything back up and running. Please check back soon!',
};

export default function MaintenanceClassic() {
  return (
    <>
      <title>PHPRetro</title>
      <link href="/web-gallery/maintenance/style.css" type="text/css" rel="stylesheet" />

      <div id="page-container">
        <div id="header-container"></div>
        <div id="maintenance-container">
          <div id="content-container">
            <div id="inner-container">
              <div id="left_col">
                {/* bubble */}
                <div className="bubble">
                  <div className="bubble-body">
                    <img
                      src="/web-gallery/maintenance/alert_triangle.gif"
                      width="30"
                      height="29"
                      alt=""
                      {...LEGACY_ALIGN_LEFT}
                      className="triangle"
                      {...LEGACY_BORDER_ZERO}
                    />
                    <b>{CLASSIC_STRINGS.text1}</b>
                    <div className="clear"></div>
                  </div>
                </div>
                <div className="bubble-bottom">
                  <div className="bubble-bottom-body">
                    <img
                      src="/web-gallery/maintenance/bubble_tail_left.gif"
                      alt=""
                      width="22"
                      height="31"
                    />
                  </div>
                </div>
                {/* \bubble */}

                <img
                  src="/web-gallery/maintenance/frank_habbo_down.gif"
                  width="57"
                  height="87"
                  alt=""
                  {...LEGACY_BORDER_ZERO}
                />
              </div>

              <div id="right_col">
                {/* bubble */}
                <div className="bubble">
                  <div className="bubble-body">
                    {CLASSIC_STRINGS.text2}
                    <div className="clear"></div>
                  </div>
                </div>
                <div className="bubble-bottom">
                  <div className="bubble-bottom-body">
                    <img
                      src="/web-gallery/maintenance/bubble_tail_left.gif"
                      alt=""
                      width="22"
                      height="31"
                    />
                  </div>
                </div>
                {/* \bubble */}

                <img
                  src="/web-gallery/maintenance/workman_habbo_down.gif"
                  width="125"
                  height="118"
                  alt=""
                  {...LEGACY_BORDER_ZERO}
                />
              </div>
            </div>
          </div>
        </div>

        <div id="footer-container"></div>
      </div>
    </>
  );
}

/**
 * `maintenance_new.php` — `maintenance_style = "1"`.
 *
 * `.tweet-container` only rendered when the `maintenance_twitter` setting was
 * non-empty, which is exactly what the API reports as `show_twitter`.
 */
export function MaintenanceNew({ showTwitter }: { showTwitter: boolean }) {
  return (
    <>
      <title>PHPRetro</title>
      <link
        href="/web-gallery/maintenance/new/style/maintenance.css"
        rel="stylesheet"
        type="text/css"
      />

      <div id="container">
        <div id="content">
          <div id="header" className="clearfix">
            <h1>
              <span></span>
            </h1>
          </div>
          <div id="process-content">
            <div className="fireman">
              <h1>We are taking a break!</h1>
              <p>
                The hotel is closed for maintenance right now. We will be back as soon as
                possible — thanks for your patience.
              </p>
            </div>

            {showTwitter && (
              <div className="tweet-container">
                <h2>Twitter</h2>
                <div className="tweet"></div>
              </div>
            )}

            <div id="footer">
              <p className="copyright">
                Powered by <a href="http://www.phpretro.com/">PHPRetro</a> &copy 2009{' '}
                <a href="http://www.yifanlu.com/">Yifan Lu</a>, Based on HoloCMS By{' '}
                <a href="http://www.meth0d.org">Meth0d</a>
                <br />
                HABBO is a registered trademark of Sulake Corporation. All rights reserved to their
                respective owner(s).
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
