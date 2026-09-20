/**
 * Response shapes for the anonymous `/api/public` surface of the Drogon
 * backend (`src/controllers/PublicContentController.cpp`).
 *
 * Every successful handler does `v["status"] = "ok"` before replying, so the
 * success literal is the string "ok". Error replies instead carry an HTTP
 * status code plus `error` / `message`, hence `ApiStatus`.
 */

export type ApiStatus = 'ok' | number;

export interface ApiEnvelope {
  status: ApiStatus;
}

export interface ApiErrorBody extends ApiEnvelope {
  error?: string;
  message?: string;
}

/** One row of `phpretro_news` as published by the public API. */
export interface NewsListItem {
  id: number;
  title: string;
  summary: string;
  /** URL slug derived from the title (`ContentService::slugify`). */
  title_safe: string;
  /** Unix epoch seconds. */
  time: number;
}

/** `GET /api/public/landing` */
export interface LandingResponse extends ApiEnvelope {
  news: NewsListItem[];
  /**
   * The raw `site_promo_phrases` setting, pipe separated.
   * Legacy landing.php rendered index 1, then 2, then 0 as speech bubbles.
   */
  promo_phrases_raw: string;
}

/** `GET /api/public/news` */
export interface NewsListResponse extends ApiEnvelope {
  items: NewsListItem[];
  count: number;
}

/** `GET /api/public/news/{id}` */
export interface NewsArticle extends ApiEnvelope {
  id: number;
  title: string;
  summary: string;
  story: string;
  author: string;
  /** Comma separated in the database, comma separated here. */
  categories: string;
  /** Comma separated in the database, comma separated here. */
  images: string;
  time: number;
}

/** One row of `phpretro_faq`. */
export interface FaqItem {
  id: number;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
}

/** `GET /api/public/faq` */
export interface FaqResponse extends ApiEnvelope {
  items: FaqItem[];
  count: number;
}

/** One row of `phpretro_collectibles`. */
export interface Collectible {
  id: number;
  name: string;
  description: string;
  image: string;
  time: number;
}

/** `GET /api/public/collectibles` */
export interface CollectiblesResponse extends ApiEnvelope {
  items: Collectible[];
  count: number;
}

/**
 * One visible row of `phpretro_banners`.
 *
 * `html` is deliberately absent from this endpoint: raw markup is never
 * published by the public API (see `PublicContentController::banners`), so the
 * legacy `advanced` branch of `community_footer.php` cannot be reproduced from
 * this payload.
 */
export interface Banner {
  id: number;
  text: string;
  banner: string;
  url: string;
  sort_order: number;
}

/** `GET /api/public/banners` */
export interface BannersResponse extends ApiEnvelope {
  items: Banner[];
  count: number;
}

/** One row of the campaigns table (only visible ones are returned). */
export interface Campaign {
  id: number;
  name: string;
  desc: string;
  image: string;
  url: string;
  sort_order: number;
}

/** `GET /api/public/campaigns` */
export interface CampaignsResponse extends ApiEnvelope {
  items: Campaign[];
  count: number;
}

/** `GET /api/public/maintenance` */
export interface MaintenanceResponse extends ApiEnvelope {
  closed: boolean;
  show_twitter: boolean;
  style: 'classic' | 'new';
}

/** `GET /api/public/settings` */
export interface SettingsResponse extends ApiEnvelope {
  settings: Record<string, string>;
}

/**
 * One slot of the frontpage news promo.
 *
 * `community.php` padded the five `hotelview_news` rows it read up to a fixed
 * length of five with empty entries before rendering, so the widget always
 * emits `newspromo[0]`..`newspromo[4]`.
 */
export interface PromoNewsItem {
  id: number;
  title: string;
  title_safe: string;
  /** Already `nl2br`-rendered in the legacy page; stored as HTML here. */
  summary: string;
  header_image: string;
  date: string;
}
