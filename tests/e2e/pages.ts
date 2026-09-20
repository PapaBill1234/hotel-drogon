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
