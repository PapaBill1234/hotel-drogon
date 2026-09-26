// Shared page manifest for the visual-parity harness.

export interface PageSpec {
  /** Stable name used for the baseline filename. */
  name: string;
  /** Path on the NEW React app. */
  newPath: string;
  /** Path on the LEGACY PHP app. Usually identical after the cutover map. */
  legacyPath: string;
  /**
   * Selectors whose content is inherently dynamic (online counts, timestamps,
   * per-request randomness). These are masked before capture on BOTH sides --
   * otherwise the diff is dominated by data that was never expected to match.
   */
  mask: string[];
  /**
   * True when the legacy page renders content the new API cannot reproduce
   * yet (e.g. a Polaris-backed widget). Such a page is still captured and
   * diffed, but the expectation is recorded rather than silently narrowed.
   */
  knownDivergence?: string;
}

/** Timestamps, live counters and randomised widgets that must be masked. */
const DYNAMIC = [
  '.stats-fig',
  '#hotel-stats',
  '.newsitem-date',
  '.article-meta',
  '.active-habbo-data',
  '.active-habbo-image',
  '.tracker',
];

export const PAGES: PageSpec[] = [
  {
    name: 'landing',
    newPath: '/',
    legacyPath: '/',
    // Speech bubbles are positioned by JS from site_promo_phrases; the online
    // counter is live.
    mask: [...DYNAMIC, '#frontpage-image .speech-bubble', '.bottom-bubble'],
  },
  {
    name: 'community',
    newPath: '/community',
    legacyPath: '/community',
    // Room lists are ordered by live occupancy and the habbo map is randomised
    // (`ORDER BY RAND()` in legacy community.php).
    mask: [...DYNAMIC, '#rooms-habblet-list-container-h119', '#homes-habblet-list-container', '.active-discussions-toplist'],
    knownDivergence:
      'Legacy community.php orders featured rooms by live occupancy and picks habbos with ORDER BY RAND(); the new API serves neither yet.',
  },
  {
    name: 'articles',
    newPath: '/articles',
    legacyPath: '/articles',
    mask: DYNAMIC,
  },
  {
    name: 'help',
    newPath: '/help',
    legacyPath: '/help',
    mask: DYNAMIC,
  },
  {
    name: 'collectables',
    newPath: '/credits/collectables',
    legacyPath: '/credits/collectables',
    // The month label and countdown timer are time-dependent.
    mask: [...DYNAMIC, '#collectibles-timeleft-value', '#collectible-current-content p'],
  },
  {
    name: 'maintenance',
    newPath: '/maintenance',
    legacyPath: '/maintenance',
    // Legacy maintenance.php redirects to "/" unless site_closed is "1"; both
    // sides must be captured with the site closed for this page to render.
    mask: DYNAMIC,
    knownDivergence:
      'Requires site_closed=1 on both apps. Legacy redirects to the front page when site_closed=0.',
  },
];

export function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

// ---------------------------------------------------------------- audit
//
// The CONVERTED-page manifest above drives the pass/fail parity gate. The list
// below is wider and drives the migration AUDIT: every page that exists on
// either stack, whether or not the pair currently matches, plus the legacy pages
// that have no new counterpart at all (`newPath: null`) and the new pages with
// no legacy counterpart (`legacyPath: null`).
//
// Kept separate on purpose. Adding a page here never changes what CI gates on,
// so the audit can be as broad and as honest as it needs to be.

export interface AuditPage {
  name: string;
  /** Path on the new React app, or null when nothing was converted. */
  newPath: string | null;
  /** Path on the legacy PHP app, or null when the page is new-only. */
  legacyPath: string | null;
  /** Signed-in pages need a session before capture. */
  auth?: 'user' | 'staff';
  /** Why this pair is expected to differ, when that is already known. */
  note?: string;
}

/** Public pages, anonymous. */
const AUDIT_PUBLIC: AuditPage[] = [
  { name: 'landing', newPath: '/', legacyPath: '/' },
  { name: 'community', newPath: '/community', legacyPath: '/community' },
  { name: 'articles', newPath: '/articles', legacyPath: '/articles' },
  { name: 'articles-archive', newPath: null, legacyPath: '/articles/archive' },
  {
    name: 'articles-category',
    newPath: null,
    legacyPath: '/articles/category/announcements',
  },
  { name: 'help', newPath: '/help', legacyPath: '/help' },
  {
    name: 'collectables',
    newPath: '/credits/collectables',
    legacyPath: '/credits/collectables',
  },
  { name: 'club', newPath: null, legacyPath: '/club' },
  { name: 'papers-disclaimer', newPath: null, legacyPath: '/papers/disclaimer' },
  { name: 'papers-privacy', newPath: null, legacyPath: '/papers/privacy' },
  { name: 'register', newPath: '/register', legacyPath: '/register' },
  { name: 'forgot', newPath: '/forgot', legacyPath: '/forgot' },
  { name: 'maintenance', newPath: '/maintenance', legacyPath: '/maintenance' },
  { name: 'tag-search', newPath: null, legacyPath: '/tag/search' },
];

/** Signed-in pages. */
const AUDIT_SIGNED_IN: AuditPage[] = [
  { name: 'me', newPath: '/me', legacyPath: '/me', auth: 'user' },
  { name: 'profile', newPath: '/account/profile', legacyPath: '/profile', auth: 'user' },
  { name: 'credits', newPath: '/credits', legacyPath: '/credits', auth: 'user' },
  {
    name: 'credits-history',
    newPath: '/credits/history',
    legacyPath: '/credits/history',
    auth: 'user',
  },
  { name: 'pixels', newPath: null, legacyPath: '/credits/pixels', auth: 'user' },
  { name: 'client', newPath: '/client', legacyPath: '/client', auth: 'user' },
  {
    name: 'reauthenticate',
    newPath: '/account/reauthenticate',
    legacyPath: '/reauthenticate',
    auth: 'user',
  },
];

/** Staff pages. The legacy panel is 30 pages; the new one is 8 routes. */
const AUDIT_STAFF: AuditPage[] = [
  { name: 'hk-login', newPath: '/housekeeping', legacyPath: '/housekeeping/' },
  { name: 'hk-dashboard', newPath: '/housekeeping/dashboard', legacyPath: '/housekeeping/dashboard', auth: 'staff' },
  { name: 'hk-news', newPath: '/housekeeping/news', legacyPath: '/housekeeping/news', auth: 'staff' },
  { name: 'hk-faq', newPath: '/housekeeping/faq', legacyPath: '/housekeeping/faq', auth: 'staff' },
  { name: 'hk-banners', newPath: '/housekeeping/banners', legacyPath: '/housekeeping/banners', auth: 'staff' },
  { name: 'hk-campaigns', newPath: '/housekeeping/campaigns', legacyPath: '/housekeeping/campaigns', auth: 'staff' },
  { name: 'hk-collectables', newPath: '/housekeeping/collectables', legacyPath: '/housekeeping/collectables', auth: 'staff' },
  { name: 'hk-settings', newPath: '/housekeeping/settings', legacyPath: '/housekeeping/settings', auth: 'staff' },
  // Present in legacy housekeeping, with no new route.
  ...['about', 'alerts', 'auditlog', 'bans', 'cache', 'catalogue', 'help', 'logs', 'maintenance', 'newsletter', 'permissions', 'recommended', 'reports', 'search', 'staffsessions', 'twofactor', 'updates', 'users', 'vouchers', 'logout'].map(
    (slug): AuditPage => ({
      name: `hk-${slug}`,
      newPath: null,
      legacyPath: `/housekeeping/${slug}`,
      auth: 'staff',
    }),
  ),
];

export const AUDIT_PAGES: AuditPage[] = [
  ...AUDIT_PUBLIC,
  ...AUDIT_SIGNED_IN,
  ...AUDIT_STAFF,
];
