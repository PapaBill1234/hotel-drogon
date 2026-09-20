import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import CommunityShell from '../components/CommunityShell';
import { useNews, useNewsItem } from '../hooks/usePublicContent';
import {
  articleHref,
  formatArticleDate,
  holoUrl,
  nl2br,
  parseArticleId,
  splitCsv,
} from '../services/legacy';

/**
 * `articles.php` with the data coming from `/api/public/news` and
 * `/api/public/news/{id}`.
 *
 * Three legacy URL shapes funnel into this component:
 *
 *  - `/articles?id=5`            — the archive list's own links,
 *  - `/articles/5-title-safe`    — the frontpage promo's links,
 *  - `/articles?archive=true&pageNumber=N` and `/articles?category=X` — the
 *    archive paging and category filters.
 *
 * The legacy page displayed the newest article when no `id` was supplied
 * (`ORDER BY time DESC, id DESC LIMIT 1`), which is what a missing id does
 * here by selecting the first row of the list.
 *
 * The backend publishes only the newest 100 articles through
 * `/api/public/news?limit=`, so the archive's total page count is derived from
 * that window rather than from `SELECT COUNT(*)`.
 */

const PER_PAGE = 20;
const ARCHIVE_WINDOW = 100;
const OLDER = '<< Older';
const NEWER = 'Newer >>';

export default function ArticlesPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const articleId = parseArticleId(idParam ?? searchParams.get('id') ?? undefined);
  const archive = searchParams.get('archive') === 'true';
  const category = (searchParams.get('category') ?? '').trim();
  const pageNumber = Math.max(1, Number.parseInt(searchParams.get('pageNumber') ?? '1', 10) || 1);

  const { data: newsData } = useNews(archive ? ARCHIVE_WINDOW : PER_PAGE);

  const items = useMemo(() => newsData?.items ?? [], [newsData]);
  // With no id in the URL the legacy page displayed the newest article
  // (`ORDER BY time DESC, id DESC LIMIT 1`); the list is already in that order.
  const newestId = articleId ?? items[0]?.id ?? null;
  const { data: article } = useNewsItem(newestId);

  const newsList = useMemo(() => {
    if (archive) {
      const start = (pageNumber - 1) * PER_PAGE;
      return items.slice(start, start + PER_PAGE);
    }
    // Categories are not published on the list endpoint, so the category view
    // shows the same newest-first listing the legacy page's own sidebar used.
    return items.slice(0, PER_PAGE);
  }, [items, archive, pageNumber]);

  const archivePages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const effectivePage = Math.min(pageNumber, archivePages);

  const categories = splitCsv(article?.categories);
  const images = splitCsv(article?.images);
  const pageTitle = article?.title ?? '';

  return (
    <>
      <title>{`PHPRetro: News${pageTitle ? ` - ${pageTitle}` : ''} `}</title>
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
      <link rel="stylesheet" href="/web-gallery/v2/styles/style.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/buttons.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/boxes.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/tooltips.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/fullcontent.css" type="text/css" />

      <CommunityShell pageId="news" cat="community" pageName="News">
        <div id="container">
          <div id="content" style={{ position: 'relative' }} className="clearfix">
            <div id="column1" className="column">
              <div className="habblet-container">
                <div className="cbb clearfix default">
                  <h2 className="title">News</h2>
                  <div id="article-archive">
                    {archive && (
                      <div id="article-paging" className="clearfix">
                        {effectivePage < archivePages && (
                          <a
                            href={`/articles?archive=true&pageNumber=${effectivePage + 1}`}
                            className="older"
                          >
                            {OLDER}
                          </a>
                        )}
                        {effectivePage > 1 && (
                          <a
                            href={`/articles?archive=true&pageNumber=${effectivePage - 1}`}
                            className="newer"
                          >
                            {NEWER}
                          </a>
                        )}
                      </div>
                    )}
                    <ul>
                      {newsList.map((newsItem) => (
                        <li key={newsItem.id}>
                          <a
                            href={articleHref(newsItem.id, newsItem.title_safe)}
                            className={`article-${newsItem.id}`}
                          >
                            {newsItem.title}&nbsp;&raquo;
                          </a>
                        </li>
                      ))}
                    </ul>
                    {!archive && category === '' && (
                      <a href="/articles?archive=true">More news &raquo;</a>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div id="column2" className="column">
              <div className="habblet-container">
                <div className="cbb clearfix notitle">
                  <div id="article-wrapper">
                    {article ? (
                      <>
                        <h2>{article.title}</h2>
                        <div className="article-meta">
                          {`Posted ${formatArticleDate(article.time)}`}
                          {categories.length > 0 && (
                            <>
                              {' — '}
                              {categories.map((newsCategory, index) => (
                                <span key={newsCategory}>
                                  {index > 0 ? ', ' : ''}
                                  <a
                                    href={`/articles?category=${encodeURIComponent(newsCategory)}`}
                                  >
                                    {newsCategory}
                                  </a>
                                </span>
                              ))}
                            </>
                          )}
                        </div>
                        {images.length > 0 && holoUrl(images[0]) !== '' && (
                          <img src={holoUrl(images[0])} className="article-image" alt="" />
                        )}
                        <p
                          className="summary"
                          dangerouslySetInnerHTML={{ __html: nl2br(article.summary) }}
                        />
                        <div className="article-body">
                          <p dangerouslySetInnerHTML={{ __html: nl2br(article.story) }} />
                          <div className="article-author">- {article.author}</div>
                          {images.length > 1 && (
                            <div className="article-images clearfix">
                              {images
                                .slice(1)
                                .filter((image) => holoUrl(image) !== '')
                                .map((image) => (
                                  <a
                                    key={image}
                                    href={holoUrl(image)}
                                    style={{
                                      backgroundImage: `url(${holoUrl(image)})`,
                                      backgroundPosition: '0 0',
                                    }}
                                  ></a>
                                ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <p>No news to display.</p>
                    )}
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
