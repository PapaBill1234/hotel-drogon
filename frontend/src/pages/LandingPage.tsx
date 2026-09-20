import { useEffect, useMemo, useRef, useState } from 'react';

import { useLanding } from '../hooks/usePublicContent';
import { splitPromoPhrases } from '../services/legacy';

/**
 * `landing.php` (new frontpage) with the data coming from
 * `GET /api/public/landing` instead of inline PHP echoes.
 *
 * The login box, the frontpage image bubble layer, the hotel stats strip and
 * the tag cloud habblet are all static markup in the legacy page — only the
 * three promo speech bubbles are data driven, and they come from
 * `promo_phrases_raw`, which the legacy code split on "|" and rendered as
 * index 1, then 2, then 0 (in exactly that order, at those pixel offsets).
 */

interface Bubble {
  id: string;
  x: number;
  y: number;
  text: string;
}

const FRONTPAGE_IMAGE = '/web-gallery/v2/images/landing/frontpg_misc_01.gif';

/**
 * Port of the legacy `SpeechBubble` prototype in
 * `web-gallery/static/js/landing.js`.
 *
 * The legacy template was
 * `<div class="cb bubble" id="#id#"><div class="bt"><div></div></div><div
 * class="i1"><div class="i2"><div class="i3">#content#</div></div><div
 * class="spike"></div></div><div class="bb"><div></div></div></div>`
 * and `render()` then set
 *
 *   width: guessBubbleWidth(text) + "px"
 *   left:  Math.round(x - width / 2 - 3) + "px"
 *   top:   (y - 24) + "px"
 *
 * where `guessBubbleWidth` measured the text inside a hidden `<span
 * class="bubble">` and added 22. Note the wrapper carries `cb bubble` while the
 * measuring span carried only `bubble` — that asymmetry is preserved here.
 */
function SpeechBubble({ bubble }: { bubble: Bubble }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    // `guessBubbleWidth` inserted the measuring span into the bubble's target
    // element (`#frontpage-image`), and the wrapper is `position: absolute`,
    // so the span is absolutely positioned here to keep it out of flow.
    const host = ref.current?.parentElement ?? document.body;
    const probe = document.createElement('span');
    probe.style.visibility = 'hidden';
    probe.style.position = 'absolute';
    probe.className = 'bubble';
    probe.appendChild(document.createTextNode(bubble.text));
    host.appendChild(probe);
    const measured = probe.offsetWidth;
    probe.remove();
    setWidth(measured + 22);
  }, [bubble.text]);

  return (
    <div
      ref={ref}
      id={bubble.id}
      className="cb bubble"
      style={{
        width: width === null ? undefined : `${width}px`,
        left: width === null ? undefined : `${Math.round(bubble.x - width / 2 - 3)}px`,
        top: `${bubble.y - 24}px`,
        display: width === null ? 'none' : undefined,
      }}
    >
      <div className="bt">
        <div></div>
      </div>
      <div className="i1">
        <div className="i2">
          <div className="i3">{bubble.text}</div>
        </div>
        <div className="spike"></div>
      </div>
      <div className="bb">
        <div></div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { data } = useLanding();

  const bubbles = useMemo<Bubble[]>(() => {
    const phrases = splitPromoPhrases(data?.promo_phrases_raw);
    // Legacy order and coordinates, verbatim from landing.php:
    //   sb.add("fp-bubble-0", "frontpage-image", 108,  57, phrases[1])
    //   sb.add("fp-bubble-1", "frontpage-image", 317,  51, phrases[2])
    //   sb.add("fp-bubble-2", "frontpage-image",   6, 168, phrases[0])
    return [
      { id: 'fp-bubble-0', x: 108, y: 57, text: phrases[1] ?? '' },
      { id: 'fp-bubble-1', x: 317, y: 51, text: phrases[2] ?? '' },
      { id: 'fp-bubble-2', x: 6, y: 168, text: phrases[0] ?? '' },
    ];
  }, [data?.promo_phrases_raw]);

  return (
    <>
      <title>PHPRetro: Home </title>

      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      <link
        rel="alternate"
        type="application/rss+xml"
        title="PHPRetro: RSS"
        href="/articles/rss.xml"
      />
      <link rel="stylesheet" href="/web-gallery/v2/styles/frontpage.css" type="text/css" />

      <div id="fp-container">
        <div id="header" className="clearfix">
          <h1>
            <a href="/"></a>
          </h1>
          <span className="login-register-link">
            New here?{' '}
            <a href="/register">REGISTER</a>
          </span>
        </div>
        <div id="content">
          <div id="column1" className="column">
            <div className="habblet-container ">
              <div className="logincontainer">
                <div className="cbb loginbox clearfix">
                  <h2 className="title">Sign in</h2>
                  <div className="box-content clearfix" id="login-habblet">
                    <form action="/account/submit" method="post" className="login-habblet">
                      <ul>
                        <li>
                          <label htmlFor="login-username" className="login-text">
                            Username
                          </label>
                          <input
                            tabIndex={1}
                            type="text"
                            className="login-field"
                            name="username"
                            id="login-username"
                            maxLength={32}
                            defaultValue=""
                          />
                        </li>
                        <li>
                          <label htmlFor="login-password" className="login-text">
                            Password
                          </label>
                          <input
                            tabIndex={2}
                            type="password"
                            className="login-field"
                            name="password"
                            id="login-password"
                            maxLength={32}
                          />
                          <input
                            type="submit"
                            value="Sign in"
                            className="submit"
                            id="login-submit-button"
                          />
                          <a
                            href="#"
                            id="login-submit-new-button"
                            className="new-button"
                            style={{ marginLeft: 0, display: 'none' }}
                          >
                            <b
                              style={{
                                paddingLeft: 10,
                                paddingRight: 7,
                                width: 55,
                              }}
                            >
                              Sign in
                            </b>
                            <i></i>
                          </a>
                        </li>
                        <li id="remember-me" className="no-label">
                          <input
                            tabIndex={3}
                            type="checkbox"
                            value="true"
                            name="_login_remember_me"
                            id="login-remember-me"
                          />
                          <label htmlFor="login-remember-me">Remember me</label>
                        </li>

                        <li id="register-link" className="no-label">
                          <a href="/register" className="login-register-link">
                            <span>Register for free</span>
                          </a>
                        </li>
                        <li className="no-label">
                          <a href="/account/password/forgot" id="forgot-password">
                            <span>I forgot my username/password</span>
                          </a>
                        </li>
                      </ul>
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
                    </form>
                  </div>
                </div>
              </div>
            </div>

            <div className="habblet-container ">
              <div
                id="frontpage-image"
                style={{ backgroundImage: `url('${FRONTPAGE_IMAGE}')` }}
              >
                <div id="partner-logo"></div>
                {bubbles.map((bubble) => (
                  <SpeechBubble key={bubble.id} bubble={bubble} />
                ))}
              </div>
            </div>
          </div>
          <div id="column2" className="column"></div>
          <div id="column-footer">
            <div className="habblet-container ">
              <div className="cbb" id="hotel-stats">
                <ul className="stats">
                  <li className="stats-online">
                    <span className="stats-fig">0</span> users online now
                  </li>
                  <li className="stats-online">
                    Hotel is <span className="stats-fig">online</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="habblet-container ">
              <div className="cbb habblet box-content" id="tag-cloud-slim">
                <span className="tags-habbos-like">Tags</span>
                No tags to display yet.
              </div>
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
          </p>
          <p className="copyright">
            Powered by <a href="http://www.phpretro.com/">PHPRetro</a>
            <br />
            HABBO is a registered trademark of Sulake Corporation. All rights reserved to their respective owner(s).
          </p>
        </div>
      </div>
    </>
  );
}
