import { Fragment, useMemo } from 'react';

import CommunityShell from '../components/CommunityShell';
import { useFaq } from '../hooks/usePublicContent';
import { nl2br } from '../services/legacy';
import type { FaqItem } from '../types/api';

/**
 * `help.php` with the data coming from `/api/public/faq`.
 *
 * The legacy page read every active FAQ row ordered by
 * `category, sort_order, id`, grouped them into `$groups[$category][]`, and
 * emitted one `<h3>` per category followed by an `<h4>` question and a `<p>`
 * answer per entry. The backend already returns the rows in that order, so the
 * grouping here preserves first-seen category order.
 */

function groupByCategory(faqs: FaqItem[]): Array<[string, FaqItem[]]> {
  const groups = new Map<string, FaqItem[]>();
  for (const faq of faqs) {
    const existing = groups.get(faq.category);
    if (existing) {
      existing.push(faq);
    } else {
      groups.set(faq.category, [faq]);
    }
  }
  return Array.from(groups.entries());
}

export default function HelpPage() {
  const { data } = useFaq();

  const groups = useMemo(() => groupByCategory(data?.items ?? []), [data]);

  return (
    <>
      <title>PHPRetro: Help </title>
      <link
        rel="shortcut icon"
        href="/web-gallery/v2/favicon.ico"
        type="image/vnd.microsoft.icon"
      />
      <link rel="stylesheet" href="/web-gallery/v2/styles/style.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/buttons.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/boxes.css" type="text/css" />
      <link rel="stylesheet" href="/web-gallery/v2/styles/tooltips.css" type="text/css" />

      <CommunityShell pageId="help" cat="community" pageName="Help">
        <div id="container">
          <div id="content" className="clearfix">
            <div id="column1" className="column">
              <div className="habblet-container">
                <div className="cbb clearfix default">
                  <h2 className="title">Help and FAQ</h2>
                  <div className="box-content">
                    {groups.length === 0 && <p>No FAQ entries are available yet.</p>}
                    {groups.map(([category, entries]) => (
                      <Fragment key={category}>
                        <h3>{category}</h3>
                        {entries.map((faq) => (
                          <Fragment key={faq.id}>
                            <h4>{faq.question}</h4>
                            <p dangerouslySetInnerHTML={{ __html: nl2br(faq.answer) }} />
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
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
