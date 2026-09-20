import { useMemo } from 'react';

import CommunityShell from '../components/CommunityShell';
import { useCollectibles, useSettings } from '../hooks/usePublicContent';
import { formatMonthYear, holoUrl, isEven } from '../services/legacy';
import type { Collectible } from '../types/api';

/**
 * `collectables.php` with the data coming from `/api/public/collectibles`.
 *
 * The legacy page computed the first instant of the current month
 * (`mktime(0, 0, 0, date('m'), 1, date('Y'))`), used the row whose `time`
 * matched exactly as the current collectable, and listed every row older than
 * that as the showroom, newest first. That split is reproduced here; a row
 * whose `time` is not exactly a month boundary falls into the showroom, which
 * is the same behaviour the PHP had.
 *
 * The "purchase" button and the countdown timer only rendered for signed-in
 * users (`$user->id != "0"`); the API surface consumed here is anonymous, so
 * the visitor branch is rendered.
 */

const COLLECTABLES_DESC_FALLBACK = '';

export default function CollectablesPage() {
  const { data } = useCollectibles();
  const { data: settingsData } = useSettings();

  const items = useMemo(() => data?.items ?? [], [data]);

  const currentMonthStart = useMemo(() => {
    const now = new Date();
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }, []);

  const currentItem = useMemo(
    () => items.find((item) => item.time === currentMonthStart),
    [items, currentMonthStart],
  );

  const showroom = useMemo(
    () => items.filter((item) => item.time < currentMonthStart).sort((a, b) => b.time - a.time),
    [items, currentMonthStart],
  );

  const row: Collectible = currentItem ?? {
    id: 0,
    name: 'No collectables available',
    description: 'There are no collectables available at the moment.',
    image: '',
    time: currentMonthStart,
  };
  const hasCurrentCollectable = currentItem !== undefined;

  const collectablesDesc =
    settingsData?.settings['collectables.desc'] ?? COLLECTABLES_DESC_FALLBACK;

  return (
    <>
      <title>PHPRetro: Collectables </title>
      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      <link rel="stylesheet" href="/web-gallery/v2/styles/style.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/buttons.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/boxes.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/tooltips.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/collectibles.css" type="text/css" />

      <CommunityShell pageId="collectables" cat="credits" pageName="Collectables">
        <div id="container">
          <div id="content" style={{ position: 'relative' }} className="clearfix">
            <div id="column1" className="column">
              <div className="habblet-container " id="collectible-current">
                <div className="cbb clearfix gray ">
                  <h2 className="title">Current collectables</h2>
                  <div id="collectible-current-content" className="clearfix">
                    <div
                      id="collectibles-current-img"
                      style={{ backgroundImage: `url(${holoUrl(row.image)})` }}
                    ></div>
                    <h4>{row.name}</h4>
                    <p>{formatMonthYear(currentMonthStart)}</p>
                    <p className="last">{row.description}</p>
                    {hasCurrentCollectable && (
                      <p id="collectibles-purchase">
                        <a href="#" className="new-button collectibles-purchase-current">
                          <b>Purchase</b>
                          <i></i>
                        </a>
                        <span className="collectibles-timeleft">
                          Time left: <span id="collectibles-timeleft-value"></span>
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="habblet-container ">
                <div className="cbb clearfix red ">
                  <h2 className="title">Showroom</h2>
                  <ul id="collectibles-list">
                    {showroom.map((showroomRow, index) => (
                      <li
                        key={showroomRow.id}
                        className={`${isEven(index + 1) ? 'even' : 'odd'} clearfix`}
                      >
                        <div
                          className="collectibles-prodimg"
                          style={{ backgroundImage: `url(${holoUrl(showroomRow.image)})` }}
                        ></div>
                        <h4>
                          {`${formatMonthYear(showroomRow.time)}: `}
                          {showroomRow.name}
                        </h4>
                        <p className="collectibles-proddesc last">{showroomRow.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div id="column2" className="column">
              <div className="habblet-container ">
                <div className="cbb clearfix red ">
                  <h2 className="title">What are collectables?</h2>
                  <div id="collectibles-instructions" className="box-content">
                    {collectablesDesc}
                  </div>
                </div>
              </div>

              <div className="habblet-container ">
                <div className="cbb clearfix red ">
                  <h2 className="title">Invest in collectables</h2>
                  <div className="box-content">
                    <p className="collectibles-value-intro">
                      <img
                        src="/web-gallery/v2/images/collectibles/ukplane.png"
                        alt=""
                        width="79"
                        height="47"
                      />
                      Collect collectables and trade them with your friends.
                    </p>
                    <p className="clear last">
                      <img
                        src="/web-gallery/v2/images/collectibles/chart.png"
                        alt=""
                        width="272"
                        height="117"
                      />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CommunityShell>
    </>
  );
}
