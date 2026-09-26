/**
 * Per-page stylesheet sets, taken verbatim from the legacy templates.
 *
 * The three legacy page families load DIFFERENT (and partly overlapping) sets:
 *
 *   templates/community_header.php     -> CommunityStyles   (community, articles, help, collectables)
 *   templates/login_header.php         -> LandingStyles     (index.php / landing.php)
 *   templates/maintenance_header.php   -> MaintenanceStyles (maintenance.php)
 *
 * These used to be declared once, globally, in index.html. That was wrong: the
 * maintenance page then inherited the community rules and its boxes were
 * mis-sized (#content-container computed 670px, correct, but had a 690px border
 * box because the community sheets added padding; #page-container sat 8px too
 * high). Each page must declare its own set, in the legacy order — later files
 * override earlier ones, so order is significant.
 */

const COMMUNITY = [
  'v2/styles/style.css',
  'v2/styles/buttons.css',
  'v2/styles/boxes.css',
  'v2/styles/tooltips.css',
  'v2/styles/welcome.css',
  'v2/styles/personal.css',
  'v2/styles/minimail.css',
  'styles/myhabbo/control.textarea.css',
  'v2/styles/settings.css',
  'v2/styles/friendmanagement.css',
  'v2/styles/rooms.css',
  'v2/styles/collectibles.css',
  'styles/myhabbo/myhabbo.css',
  'styles/myhabbo/skins.css',
  'styles/myhabbo/dialogs.css',
  'styles/myhabbo/buttons.css',
  'styles/myhabbo/control.textarea.css',
  'styles/myhabbo/boxes.css',
  'v2/styles/myhabbo.css',
  'styles/myhabbo/assets.css',
  'v2/styles/lightwindow.css',
  'v2/styles/group.css',
  'styles/discussions.css',
  'v2/styles/ie8.css',
  'v2/styles/ie.css',
  'v2/styles/ie6.css',
];

// The ACTUAL set the rendered landing page requests, read from the live page
// rather than from the template source. Note what is NOT here: no
// frontpage.css, and no ie8/ie/ie6. Grepping login_header.php suggests a
// different (larger) set, but that file has branches; loading frontpage.css
// shrinks #content from 714px to 674px and breaks the two-column layout.
//
// `styles/local/com.css` is also in the legacy page but is rewritten to
// habblet/null.php by .htaccess, i.e. served empty, so it is omitted.
const LANDING = [
  'v2/styles/style.css',
  'v2/styles/buttons.css',
  'v2/styles/boxes.css',
  'v2/styles/tooltips.css',
  'v2/styles/process.css',
];

const MAINTENANCE = [
  'maintenance/style.css',
  'maintenance/ie-all.css',
  'maintenance/ie6.css',
];

function Sheets({ hrefs }: { hrefs: string[] }) {
  return (
    <>
      {hrefs.map((href) => (
        <link
          key={href}
          rel="stylesheet"
          type="text/css"
          href={`/web-gallery/${href}`}
        />
      ))}
    </>
  );
}

/** templates/community_header.php */
export function CommunityStyles() {
  return <Sheets hrefs={COMMUNITY} />;
}

/** templates/login_header.php — used by index.php, which serves "/". */
export function LandingStyles() {
  return <Sheets hrefs={LANDING} />;
}

/**
 * The `process-template` family: `login_header.php` with a non-landing
 * `$page['new_landing']`, i.e. forgot.php, reauthenticate.php, login_popup.php.
 *
 * Same set as LANDING. Named separately because the two are reached by different
 * templates and could diverge; the live pages currently request identical sets
 * (measured from the rendered `/forgot` and `/`), so this aliases LANDING rather
 * than duplicating the list and letting the two drift.
 */
export function ProcessStyles() {
  return <Sheets hrefs={LANDING} />;
}

/** templates/maintenance_header.php */
export function MaintenanceStyles() {
  return <Sheets hrefs={MAINTENANCE} />;
}
