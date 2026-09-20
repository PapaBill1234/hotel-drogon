/**
 * Small ports of the PHPRetro helper functions the ported templates relied on.
 * Each one mirrors a specific PHP helper so the rendered values match byte for
 * byte rather than approximately.
 */

/**
 * `HoloUrl()` — the legacy CMS stored some asset paths as absolute URLs and
 * others as site-relative paths without a leading slash (banner images are
 * stored as e.g. `b.png` under `web-gallery/`). Absolute values passed through
 * unchanged and everything else got the site path prefixed; here the site path
 * is "/", so a bare relative path gains exactly one leading slash and nothing
 * else is rewritten. Empty input stays empty, which is what made the legacy
 * `($imageUrl = HoloUrl(...)) !== ''` guards skip the element.
 */
export function holoUrl(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return `/${trimmed}`;
}

/**
 * `$input->HoloText()` — escapes every character that `htmlspecialchars(...,
 * ENT_QUOTES, 'UTF-8')` escapes. React escapes text children on its own, so
 * this is only needed when replicating the legacy habit of placing an escaped
 * value into an attribute or into `dangerouslySetInnerHTML`.
 */
export function holoText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * PHP `nl2br()` — inserts `<br />` before every newline. The legacy pages fed
 * article bodies and FAQ answers through this before echoing them.
 */
export function nl2br(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).replace(/\r\n|\r|\n/g, '<br />\n');
}

/** PHP `date('M j, Y', $t)` — e.g. "Sep 15, 2026". */
export function formatArticleDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** PHP `date('F Y', $t)` — e.g. "September 2026". */
export function formatMonthYear(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * `$input->IsEven($n)` — the legacy helper treated an odd ordinal as "even"
 * (its first row was class `even`), and the callers then inverted the result.
 * Reproduced verbatim: `1` maps to `true`.
 */
export function isEven(n: number): boolean {
  return n % 2 === 1;
}

/** Legacy `//articles/{id}-{title_safe}` href used by the frontpage promo. */
export function articleHref(id: number, titleSafe: string): string {
  return `/articles/${id}-${titleSafe}`;
}

/**
 * The legacy `/articles/{id}-{title_safe}` route and the query-string form
 * `/articles?id=5` both resolve to a single numeric article id. Extract it from
 * a route segment that may be `"5"`, `"5-wow"`, or `"5-wow-extra"`.
 */
export function parseArticleId(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^(\d+)/.exec(raw.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Split a comma separated database column the way `array_filter(array_map('trim', explode(',', $v)))` did. */
export function splitCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The landing page's `site_promo_phrases` split. Legacy code did
 * `explode("|", $settings->find("site_promo_phrases"))` and then read indexes
 * 1, 2 and 0 — unconditionally, so a shorter setting produced empty bubbles
 * plus PHP notices. Missing indexes are returned as empty strings here.
 */
export function splitPromoPhrases(raw: string | null | undefined): string[] {
  return String(raw ?? '').split('|');
}

/**
 * `rooms.php`-style occupancy bucket used by `community.php` to pick the
 * `room-occupancy-N` class: `$count = ($users / $users_max) * 100`.
 */
export function roomOccupancy(usersNow: number, usersMax: number): number {
  const max = usersMax === 0 ? 1 : usersMax;
  const count = (usersNow / max) * 100;
  if (count >= 99) return 5;
  if (count > 65) return 4;
  if (count > 32) return 3;
  if (count > 0) return 2;
  return 1;
}
