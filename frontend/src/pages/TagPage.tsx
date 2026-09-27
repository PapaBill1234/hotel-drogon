import CommunityShell from '../components/CommunityShell';
import { BoxTitle, Cbb } from '../components/Rounder';

/**
 * `/tag` — `tag.php`, ported.
 *
 * The legacy page is one line of markup and, unusually, it is already an honest
 * stub about a missing capability:
 *
 *   $page['bodyid'] = 'tags'; $page['cat'] = 'community';
 *   require community_header.php;
 *   <div id="container"><div id="content" class="clearfix"><div id="column1" class="column">
 *     <div class="habblet-container"><div class="cbb clearfix default">
 *       <h2 class="title">Tag Search</h2>
 *       <div class="box-content"><p>Tag search, tag clouds, matches, and fights are not
 *       available because Polaris has no tags table and no project-owned replacement
 *       schema is defined.</p></div>
 *     </div></div>
 *   </div></div></div>
 *
 * So this is NOT a "not converted yet" page in the same sense as `/register`:
 * the legacy implementation already tells the visitor the feature is
 * unavailable and why. The port therefore keeps the community shell, the body
 * id `tags` (which the `navi2` strip keys its selected state on) and the copy
 * verbatim, rather than showing a generic notice.
 *
 * Two details that are easy to get wrong:
 *
 *   - The heading and the `<title>` are both `$loc['pagename.tags']`, which is
 *     **"Tag Search"** (`en.php:1087`) — not "Tags". The navi2 tab label is
 *     "Tags" but the page name is not.
 *   - `tag.php` sets `allow_guests`, so the header renders the anonymous branch
 *     for a visitor with no session, which is what `CommunityShell` does when
 *     `signedInAs` is left undefined.
 */
export default function TagPage() {
  return (
    <CommunityShell pageId="tags" cat="community" pageName="Tag Search">
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container">
              <Cbb className="cbb clearfix default">
                <BoxTitle>Tag Search</BoxTitle>
                <div className="box-content">
                  <p data-testid="tags-unavailable">
                    Tag search, tag clouds, matches, and fights are not available because
                    Polaris has no tags table and no project-owned replacement schema is
                    defined.
                  </p>
                </div>
              </Cbb>
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}
