import CommunityShell from '../components/CommunityShell';

/**
 * `error.php` — the legacy 404, ported.
 *
 * The legacy router sent an unknown path to `error.php`, which returns **HTTP
 * 404** and renders a community-shell page: a red "Page not found!" box in
 * `#column1` and a green "Were you looking for..." box in `#column2` with four
 * suggestions. The port replaced that with
 * `<Route path="*" element={<Navigate to="/" replace />} />`, so every unknown or
 * unconverted URL silently bounced the visitor to the front page — which is what
 * a user hit when they followed the footer's Disclaimer link.
 *
 * Copy is verbatim from `en.php:716-734` (`community.error`), including the
 * oddities the legacy strings have. The "Were you looking for..." links all
 * point at `/community`, exactly as `error.php` does — the legacy box suggested
 * "Recommended Rooms", "Top Tags" and "Coins" but linked three of the four at
 * the community page, and reproducing that is the point of a parity port.
 */
export default function NotFoundPage() {
  return (
    <CommunityShell pageId="community" cat="community" pageName="Page not found">
      <div id="container">
        <div id="content" style={{ position: 'relative' }} className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container ">
              <div className="cbb clearfix red ">
                <h2 className="title">Page not found!</h2>
                <div id="notfound-content" className="box-content">
                  <p className="error-text" data-testid="notfound-message">
                    Sorry, but the page you were looking for was not found.
                  </p>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <img id="error-image" src="/web-gallery/v2/images/error.gif" />
                  <p className="error-text">
                    Please use the &apos;Back&apos; button to get back to where you started.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div id="column2" className="column">
            <div className="habblet-container ">
              <div className="cbb clearfix green ">
                <h2 className="title">Were you looking for...</h2>
                <div id="notfound-looking-for" className="box-content">
                  <p>
                    <b>A friend&apos;s group or personal page?</b>
                    <br />
                    See if it is listed on the <a href="/community">Community</a> page.
                  </p>
                  <p>
                    <b>Rooms that rock?</b>
                    <br />
                    Browse the <a href="/community">Recommended Rooms</a> list.
                  </p>
                  <p>
                    <b>What other Retros are in to?</b>
                    <br />
                    Check out the <a href="/community">Top Tags</a> list.
                  </p>
                  <p>
                    <b>How to get Coins?</b>
                    <br />
                    Have a look at the <a href="/credits">Coins</a> page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}
