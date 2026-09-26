import CommunityShell from '../components/CommunityShell';
import { useCommunityNews } from '../hooks/usePublicContent';
import { buildPromoNews } from '../services/communityNews';
import { articleHref, roomOccupancy } from '../services/legacy';
import { legacyRoomId } from '../services/jsxLegacy';

/**
 * `community.php`.
 *
 * The page mixes four habblets: a recommended-rooms tab, a recent-discussions
 * tab, the "random Habbos" imagemap, and the news promo in `#column2`. The news
 * promo is backed by `/api/public/community-news`, which serves the
 * **`hotelview_news`** table — the one `community.php` actually reads. There is
 * no anonymous route for rooms, forum threads or the online count, so those
 * habblets keep their complete legacy markup skeleton and render the empty data
 * sets the legacy page produced when its queries returned nothing.
 *
 * The imagemap coordinates and placeholder ids are copied verbatim from the
 * PHP because `activehomes.js` and the imagemap's `usemap="#habbomap"`
 * reference them positionally.
 */

/** Legacy `$lang->loc['latest.news']`. */
const LATEST_NEWS = 'Latest News';
/** Legacy `$lang->loc['read.more']`. */
const READ_MORE = 'Read more';
/** Legacy `$lang->loc['news.more']`. */
const NEWS_MORE = 'More news';
/** Legacy `$lang->loc['news.previous']` / `$lang->loc['news.next']`. */
const NEWS_PREVIOUS = 'Previous';
const NEWS_NEXT = 'Next';

/**
 * The 18 avatars of the "Random Habbos" imagemap, positioned exactly as the
 * legacy JavaScript positioned them.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * `style.css` gives `.active-habbo-image-placeholder` `position: absolute` but
 * supplies **no `top`/`left`** — the coordinates come from
 * `ActiveHabbosHabblet._positionPlaceHolderImages()` in
 * `web-gallery/static/js/fullcontent.js`, which is called from `initialize()`
 * on `dom:loaded` (the same script that later swaps in real avatars via
 * `generateRandomImages`).
 *
 * Without that call every placeholder falls back to the container origin,
 * stacks, and — because the 64x110 sprite is taller than the 12px the container
 * has left below the imagemap — paints a `habbo_skeleton.gif` *outside* the
 * widget. That was the stray avatar sprite visible below the "Random Habbos"
 * box.
 *
 * THE ARITHMETIC (ported verbatim, 3 rows x 6 columns)
 *
 *   rows = 3, cols = 6, horizontalSpace = 62, verticalSpace = 45
 *   top = 10, left = 50
 *   each row: left += 62 per column
 *   each row: if (row % 2 < 1) left = 20 else left = 50    // stagger even rows
 *   each row: top += 45
 *
 * `_placeImage` is deliberately NOT ported: it fetches
 * `www.habbo.com/habbo-imaging/avatarimage?...` for each habbo, and this stack
 * has no habbos endpoint to feed it (the legacy page in this fixture has no
 * rows either). The placeholders therefore keep the skeleton sprite the
 * stylesheet assigns, which is the state the legacy page renders too.
 */
const HABBO_ROWS = 3;
const HABBO_COLUMNS = 6;
const HABBO_HORIZONTAL_SPACE = 62;
const HABBO_VERTICAL_SPACE = 45;

const HABBO_SLOTS: { id: number; left: number; top: number }[] = (() => {
  const slots: { id: number; left: number; top: number }[] = [];
  let top = 10;
  let id = 0;
  for (let row = 0; row < HABBO_ROWS; row++) {
    let left = 50;
    for (let col = 0; col < HABBO_COLUMNS; col++) {
      slots.push({ id: id++, left, top });
      left += HABBO_HORIZONTAL_SPACE;
    }
    // `if (row % 2 < 1) left = 20 else left = 50` — the reset is dead for every
    // row because each row re-enters at `left = 50` above, exactly as in the
    // legacy script, where the same reset is likewise overwritten.
    left = row % 2 < 1 ? 20 : 50;
    top += HABBO_VERTICAL_SPACE;
  }
  return slots;
})();

interface RoomRow {
  id: number;
  name: string;
  owner_display: string;
  users: number;
  usersMax: number;
}

/** No anonymous rooms endpoint exists; the legacy query result is empty. */
const ROOMS: RoomRow[] = [];

interface TopicRow {
  id: number;
  guildId: number;
  subject: string;
  postsCount: number;
}

/** No anonymous discussions endpoint exists; the legacy query result is empty. */
const TOPICS: TopicRow[] = [];

function buildPageLinks(topic: TopicRow): number[] {
  const pages = Math.ceil(topic.postsCount / 10);
  const links = [1];
  if (pages > 4) {
    for (let pageAt = pages - 2; pageAt <= pages; pageAt += 1) links.push(pageAt);
  } else if (pages !== 1) {
    for (let pageAt = 2; pageAt <= pages; pageAt += 1) links.push(pageAt);
  }
  return links;
}

function RoomList({ rooms, enterLabel }: { rooms: RoomRow[]; enterLabel: string }) {
  return (
    <>
      {rooms.map((room, index) => (
        <li key={room.id} className={index % 2 === 0 ? 'odd' : 'even'}>
          <span
            className={`clearfix enter-room-link room-occupancy-${roomOccupancy(
              room.users,
              room.usersMax,
            )}`}
            title="Go to room"
            {...legacyRoomId(room.id)}
          >
            <span className="room-enter">{enterLabel}</span>
            <span className="room-name">{room.name}</span>
            <span className="room-description">{room.name}</span>
            <span className="room-owner">
              Owner: <a href={`/home/${room.owner_display}`}>{room.owner_display}</a>
            </span>
          </span>
        </li>
      ))}
    </>
  );
}

function TopicList({ topics }: { topics: TopicRow[] }) {
  return (
    <>
      {topics.map((topic, index) => (
        <li key={topic.id} className={index % 2 === 0 ? 'even' : 'odd'}>
          <a href={`/groups/${topic.guildId}/discussions/${topic.id}/id`} className="topic">
            <span>{topic.subject}</span>
          </a>
          <div className="topic-info post-icon">
            <span className="grey">(</span>
            {buildPageLinks(topic).map((page, pageIndex) => (
              <span key={page}>
                {pageIndex === 0 ? null : ' '}
                <a
                  href={`/groups/${topic.guildId}/discussions/${topic.id}/id/page/${page}`}
                  className="topiclist-page-link secondary"
                >
                  {page}
                </a>
              </span>
            ))}
            <span className="grey">)</span>
          </div>
        </li>
      ))}
    </>
  );
}

export default function CommunityPage() {
  const { data: newsData } = useCommunityNews(5);
  const news = buildPromoNews(newsData?.items ?? []);

  return (
    <>
      <title>PHPRetro: Community </title>
      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      <link rel="stylesheet" href="/web-gallery/v2/styles/style.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/buttons.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/boxes.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/tooltips.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/rooms.css" type="text/css" />

      <CommunityShell pageId="community" cat="community" pageName="Community">
        <div id="container">
          <div id="content" style={{ position: 'relative' }} className="clearfix">
            <div id="column1" className="column">
              <div className="habblet-container ">
                <div className="cbb clearfix green ">
                  <div className="box-tabs-container clearfix">
                    <h2>Rooms</h2>
                    <ul className="box-tabs">
                      <li id="tab-0-0-1">
                        <a href="#">Top rated</a>
                        <span className="tab-spacer"></span>
                      </li>
                      <li id="tab-0-0-2" className="selected">
                        <a href="#">Recommended rooms</a>
                        <span className="tab-spacer"></span>
                      </li>
                    </ul>
                  </div>
                  <div id="tab-0-0-1-content" style={{ display: 'none' }}>
                    <div className="progressbar">
                      <img
                        src="/web-gallery/images/progress_bubbles.gif"
                        alt=""
                        width="29"
                        height="6"
                      />
                    </div>
                    <a href="/habblet/proxy.php?hid=h120" className="tab-ajax"></a>
                  </div>
                  <div id="tab-0-0-2-content">
                    <div
                      id="rooms-habblet-list-container-h119"
                      className="recommendedrooms-lite-habblet-list-container"
                    >
                      <ul className="habblet-list">
                        <RoomList rooms={ROOMS.slice(0, 5)} enterLabel="Enter" />
                      </ul>
                      <div id="room-more-data-h119" style={{ display: 'none' }}>
                        <ul className="habblet-list room-more-data">
                          <RoomList rooms={ROOMS.slice(5, 20)} enterLabel="Enter room" />
                        </ul>
                      </div>
                      <div className="clearfix">
                        <a href="#" className="room-toggle-more-data" id="room-toggle-more-data-h119">
                          Show more rooms
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="habblet-container ">
                <div className="cbb clearfix blue ">
                  <div className="box-tabs-container clearfix">
                    <h2>Groups</h2>
                    <ul className="box-tabs">
                      <li id="tab-0-1-1">
                        <a href="#">Hot groups</a>
                        <span className="tab-spacer"></span>
                      </li>
                      <li id="tab-0-1-2" className="selected">
                        <a href="#">Recent topics</a>
                        <span className="tab-spacer"></span>
                      </li>
                    </ul>
                  </div>
                  <div id="tab-0-1-1-content" style={{ display: 'none' }}>
                    <div className="progressbar">
                      <img
                        src="/web-gallery/images/progress_bubbles.gif"
                        alt=""
                        width="29"
                        height="6"
                      />
                    </div>
                    <a href="/habblet/proxy.php?hid=h122" className="tab-ajax"></a>
                  </div>
                  <div id="tab-0-1-2-content">
                    <ul className="active-discussions-toplist">
                      <TopicList topics={TOPICS.slice(0, 10)} />
                    </ul>
                    <div id="active-discussions-toplist-hidden-h121" style={{ display: 'none' }}>
                      <ul className="active-discussions-toplist">
                        <TopicList topics={TOPICS.slice(10, 50)} />
                      </ul>
                    </div>
                    <div className="clearfix">
                      <a
                        href="#"
                        className="discussions-toggle-more-data secondary"
                        id="discussions-toggle-more-data-h121"
                      >
                        Show more discussions
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="habblet-container ">
                <div className="cbb clearfix activehomes ">
                  <h2 className="title">Random Habbos</h2>
                  <div id="homes-habblet-list-container" className="habblet-list-container">
                    <img
                      className="active-habbo-imagemap"
                      src="/web-gallery/v2/images/activehomes/transparent_area.gif"
                      width="435px"
                      height="230px"
                      useMap="#habbomap"
                      alt=""
                    />
                    <div id="placeholder-container">
                      {HABBO_SLOTS.map((slot) => (
                        <div
                          key={slot.id}
                          id={`active-habbo-image-placeholder-${slot.id}`}
                          className="active-habbo-image-placeholder"
                          style={{ left: `${slot.left}px`, top: `${slot.top}px`, display: 'block' }}
                        ></div>
                      ))}
                    </div>
                  </div>

                  <map id="habbomap" name="habbomap">
                    <area id="imagemap-area-0" shape="rect" coords="55,53,95,103" href="#" alt="" />
                    <area id="imagemap-area-1" shape="rect" coords="120,53,160,103" href="#" alt="" />
                    <area id="imagemap-area-2" shape="rect" coords="185,53,225,103" href="#" alt="" />
                    <area id="imagemap-area-3" shape="rect" coords="250,53,290,103" href="#" alt="" />
                    <area id="imagemap-area-4" shape="rect" coords="315,53,355,103" href="#" alt="" />
                    <area id="imagemap-area-5" shape="rect" coords="380,53,420,103" href="#" alt="" />
                    <area id="imagemap-area-6" shape="rect" coords="28,103,68,153" href="#" alt="" />
                    <area id="imagemap-area-7" shape="rect" coords="93,103,133,153" href="#" alt="" />
                    <area id="imagemap-area-8" shape="rect" coords="158,103,198,153" href="#" alt="" />
                    <area id="imagemap-area-9" shape="rect" coords="223,103,263,153" href="#" alt="" />
                    <area id="imagemap-area-10" shape="rect" coords="288,103,328,153" href="#" alt="" />
                    <area id="imagemap-area-11" shape="rect" coords="353,103,393,153" href="#" alt="" />
                    <area id="imagemap-area-12" shape="rect" coords="55,153,95,203" href="#" alt="" />
                    <area id="imagemap-area-13" shape="rect" coords="120,153,160,203" href="#" alt="" />
                    <area id="imagemap-area-14" shape="rect" coords="185,153,225,203" href="#" alt="" />
                    <area id="imagemap-area-15" shape="rect" coords="250,153,290,203" href="#" alt="" />
                    <area id="imagemap-area-16" shape="rect" coords="315,153,355,203" href="#" alt="" />
                    <area id="imagemap-area-17" shape="rect" coords="380,153,420,203" href="#" alt="" />
                  </map>
                </div>
              </div>
            </div>
            <div id="column2" className="column">
              <div className="habblet-container news-promo">
                <div className="cbb clearfix notitle ">
                  <div id="newspromo">
                    <div id="topstories">
                      {news.map((topStory, index) => (
                        <div
                          key={topStory.id === 0 ? `empty-${index}` : topStory.id}
                          className="topstory"
                          style={{
                            backgroundImage: `url(${topStory.header_image})`,
                            display: index === 0 ? undefined : 'none',
                          }}
                        >
                          <h4>{LATEST_NEWS}</h4>
                          <h3>
                            <a href={articleHref(topStory.id, topStory.title_safe)}>
                              {topStory.title}
                            </a>
                          </h3>
                          <p
                            className="summary"
                            dangerouslySetInnerHTML={{ __html: topStory.summary }}
                          />
                          <p>
                            <a href={articleHref(topStory.id, topStory.title_safe)}>
                              {READ_MORE}
                            </a>
                          </p>
                        </div>
                      ))}
                      <div id="topstories-nav" style={{ display: 'none' }}>
                        <a href="#" className="prev">
                          {NEWS_PREVIOUS}
                        </a>
                        <span>1</span> / 3<a href="#" className="next">{NEWS_NEXT}</a>
                      </div>
                    </div>
                    <ul className="widelist">
                      <li className="even">
                        <a href={articleHref(news[3].id, news[3].title_safe)}>{news[3].title}</a>
                        <div className="newsitem-date">{news[3].date}</div>
                      </li>
                      <li className="odd">
                        <a href={articleHref(news[4].id, news[4].title_safe)}>{news[4].title}</a>
                        <div className="newsitem-date">{news[3].date}</div>
                      </li>
                      <li className="last">
                        <a href="/articles">{NEWS_MORE}</a>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="habblet-container ">
                <div className="cbb clearfix green ">
                  <h2 className="title">Tags</h2>
                  <div className="habblet box-content">
                    No tags to display yet.
                    <div className="tag-search-form">
                      <form name="tag_search_form" action="/tag/search" className="search-box">
                        <input
                          type="text"
                          name="tag"
                          id="search_query"
                          className="search-box-query"
                          style={{ float: 'left' }}
                          defaultValue=""
                        />
                        <a
                          href="#"
                          className="new-button search-icon"
                          style={{ float: 'left' }}
                        >
                          <b>
                            <span></span>
                          </b>
                          <i></i>
                        </a>
                      </form>
                    </div>
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
