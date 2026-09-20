import { useMemo } from 'react';

import CommunityShell from '../components/CommunityShell';
import { useNews } from '../hooks/usePublicContent';
import { articleHref, roomOccupancy } from '../services/legacy';
import { legacyRoomId } from '../services/jsxLegacy';
import type { NewsListItem, PromoNewsItem } from '../types/api';

/**
 * `community.php`.
 *
 * The page mixes four habblets: a recommended-rooms tab, a recent-discussions
 * tab, the "random Habbos" imagemap, and the news promo in `#column2`. Only the
 * news promo is backed by a public endpoint (`/api/public/news`); there is no
 * anonymous route for rooms, forum threads, hotel-view news or the online
 * count, so those habblets keep their complete legacy markup skeleton and
 * render the empty data sets the legacy page produced when its queries
 * returned nothing.
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
 * `community.php` padded the five `hotelview_news` rows it read to exactly five
 * entries before rendering, so the widget always emits five slots. There is no
 * public endpoint for `hotelview_news`, so every slot is the empty filler the
 * PHP pushed, which is what produced the five blank permalinks.
 */
function buildPromoNews(items: NewsListItem[]): PromoNewsItem[] {
  const news: PromoNewsItem[] = items.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    title_safe: item.title_safe,
    summary: item.summary,
    header_image: '',
    date: '',
  }));
  while (news.length < 5) {
    news.push({ id: 0, title: '', title_safe: '', summary: '', header_image: '', date: '' });
  }
  return news;
}

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
  const { data: newsData } = useNews(5);
  const news = useMemo(() => buildPromoNews(newsData?.items ?? []), [newsData]);

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
                      <div
                        id="active-habbo-image-placeholder-0"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-1"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-2"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-3"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-4"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-5"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-6"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-7"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-8"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-9"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-10"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-11"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-12"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-13"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-14"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-15"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-16"
                        className="active-habbo-image-placeholder"
                      ></div>
                      <div
                        id="active-habbo-image-placeholder-17"
                        className="active-habbo-image-placeholder"
                      ></div>
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
