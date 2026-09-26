/**
 * The `/community` "Latest news" promo widget — `community.php` lines 372-431.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The legacy app read TWO independent news tables, and this widget was always
 * fed by the one the new page originally ignored:
 *
 *   community.php:372   SELECT ... FROM hotelview_news ORDER BY id DESC LIMIT 5
 *   articles.php:17     SELECT ... FROM phpretro_news  WHERE id = ?
 *
 * `/community` used `phpretro_news`, so the promo rendered the wrong articles —
 * and once that list ran short it rendered blank filler slots instead of a
 * story at all. The shaping below is the part that has to stay faithful, so it
 * lives here, away from the 480-line page component, and the visual-parity
 * harness asserts the *rendered* result against the legacy baseline rather than
 * trusting a pixel tolerance to notice.
 */

import { holoText, holoUrl, nl2br } from './legacy';
import type { CommunityNewsItem, PromoNewsItem } from '../types/api';

/** Slots `community.php` padded its result set up to, unconditionally. */
export const PROMO_SLOTS = 5;

/**
 * `$input->stringToURL($title, true, true)` — the slug the PHP minted for the
 * promo permalink.
 *
 *   $str = trim(preg_replace('/\s\s+/', ' ', preg_replace("/[^A-Za-z0-9-]/", " ", $str)));
 *   $str = strtolower($str);
 *   $str = str_replace(" ", "-", $str);
 *
 * Note `$spaces = true`: the legacy call site passed true, so spaces became
 * '-' rather than being stripped. (The `else` branch of that ternary was a
 * no-op — `str_replace` without assignment — which is why this is a faithful
 * port of the taken branch only.)
 */
export function slugifyTitle(title: string): string {
  const collapsed = title
    .replace(/[^A-Za-z0-9-]/g, ' ')
    .replace(/\s\s+/g, ' ')
    .trim();
  return collapsed.toLowerCase().replace(/ /g, '-');
}

/**
 * Shape `hotelview_news` rows into the five promo slots the template renders.
 *
 * `community.php`:
 *   $row['summary']      = nl2br($input->HoloText($row['text']));
 *   $row['title']        = $input->HoloText($row['title']);
 *   $row['title_safe']   = $input->stringToURL($row['title'], true, true);
 *   $row['header_image'] = HoloUrl($row['image']);
 *   $row['date']         = '';
 *   while (count($news) < 5) { $news[] = [ ...all empty... ]; }
 *
 * `date` stays empty because `hotelview_news` has no time column — which is why
 * `community.php` echoes `$news[3]['date']` inside BOTH `widelist` rows (line
 * 428 is not a typo in the port; the PHP really does index [3] twice).
 */
export function buildPromoNews(items: CommunityNewsItem[]): PromoNewsItem[] {
  const news: PromoNewsItem[] = items.slice(0, PROMO_SLOTS).map((item) => ({
    id: item.id,
    title: holoText(item.title),
    title_safe: slugifyTitle(item.title),
    summary: nl2br(holoText(item.text)),
    header_image: holoUrl(item.image),
    date: '',
  }));
  while (news.length < PROMO_SLOTS) {
    news.push({ id: 0, title: '', title_safe: '', summary: '', header_image: '', date: '' });
  }
  return news;
}
