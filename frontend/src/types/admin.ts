/**
 * Response shapes for the staff `/api/admin/*` surface of the Drogon backend
 * (`src/controllers/AdminContentController.cpp`, `StaffTestController.cpp`).
 *
 * Field names and optionality are taken from the controller serialisers, not
 * guessed: e.g. `banner.html` is present only when the caller holds the
 * high-trust capability (`bannerJson(b, includeRawHtml)`), so it is optional
 * here and every read site has to say what it does when it is missing.
 *
 * Endpoints are implemented against the legacy housekeeping pages the plan
 * names: `housekeeping/{news,faq,collectables,banners,campaigns,settings}.php`.
 */

/** Every successful admin handler sets `"status": "ok"`; errors set an HTTP code. */
export type AdminStatus = 'ok' | number;

export interface AdminEnvelope {
  status: AdminStatus;
  message?: string;
  error?: string;
  /** Present on validation failures: the exact field the server rejected. */
  field?: string;
}

/** `GET /api/admin/session` */
export interface AdminSession extends AdminEnvelope {
  username: string;
  rank: number;
  '2fa_verified': boolean;
  /** Mirror of `AuthPolicy::kHighTrustMinRank` (rank >= 7). */
  high_trust: boolean;
}

/** `POST /api/auth/login` and `GET /api/auth/me` both return this user shape. */
export interface AuthUser {
  id: number;
  username: string;
  real_name: string;
  mail: string;
  mail_verified: boolean;
  rank: number;
  credits: number;
  pixels: number;
  points: number;
  look: string;
  gender: string;
  motto: string;
  online: string;
  account_created: number;
  last_login: number;
  /** `rank >= 5` — the server's own definition of staff. */
  is_staff: boolean;
}

export interface AuthResponse extends AdminEnvelope {
  user: AuthUser;
  csrf_token?: string;
  /** Returned by `/api/auth/staff-login` only. */
  is_staff?: boolean;
  '2fa_verified'?: boolean;
}

/** `GET /api/auth/me` */
export interface MeResponse extends AdminEnvelope {
  user: AuthUser;
  csrf_token: string;
}

/** One row of `phpretro_news`. */
export interface AdminNews {
  id: number;
  title: string;
  summary: string;
  story: string;
  author: string;
  categories: string;
  images: string;
  /** Unix epoch seconds. */
  time: number;
}

export interface AdminNewsList extends AdminEnvelope {
  items: AdminNews[];
  count: number;
}

/** One row of `phpretro_faq`. */
export interface AdminFaq {
  id: number;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  active: boolean;
}

export interface AdminFaqList extends AdminEnvelope {
  items: AdminFaq[];
  count: number;
}

/** One row of `phpretro_collectibles`. The API is create + delete only. */
export interface AdminCollectible {
  id: number;
  name: string;
  description: string;
  image: string;
  /** First instant of the collectable's month; `UNIQUE` in the table. */
  time: number;
}

export interface AdminCollectibleList extends AdminEnvelope {
  items: AdminCollectible[];
  count: number;
}

/**
 * One row of `phpretro_banners`.
 *
 * `html` is raw, unescaped markup that the public pages render verbatim. It is
 * only ever present for a caller holding the high-trust capability, and writing
 * one requires it too (`ContentService::bannerRequiresHighTrust`).
 */
export interface AdminBanner {
  id: number;
  text: string;
  banner: string;
  url: string;
  status: boolean;
  advanced: boolean;
  sort_order: number;
  /** Raw markup. Absent unless the caller holds the high-trust capability. */
  html?: string;
  high_trust?: boolean;
  warning?: string;
}

export interface AdminBannerList extends AdminEnvelope {
  items: AdminBanner[];
  count: number;
  /** Whether this response included `html` at all. */
  raw_html_included: boolean;
  notice?: string;
}

/** One row of `phpretro_campaigns`. */
export interface AdminCampaign {
  id: number;
  name: string;
  desc: string;
  image: string;
  url: string;
  visible: boolean;
  sort_order: number;
}

export interface AdminCampaignList extends AdminEnvelope {
  items: AdminCampaign[];
  count: number;
}

/** One row of `phpretro_site_settings`. */
export interface AdminSetting {
  key: string;
  value: string;
}

export interface AdminSettingList extends AdminEnvelope {
  items: AdminSetting[];
  count: number;
}

/** Payload of a successful create/update, including the high-trust warning. */
export interface AdminMutationResult extends AdminEnvelope {
  id?: number;
  high_trust?: boolean;
  warning?: string;
}

// ------------------------------------------------------------------ payloads
//
// Request bodies. These live here rather than beside the fetch helpers so a
// page can type its form state without importing the transport layer — and so
// one definition of each payload is shared by the client and the form.

/** Body of `POST /api/admin/news` and `PUT /api/admin/news/{id}`. */
export interface NewsPayload {
  title: string;
  summary: string;
  story: string;
  author: string;
  categories: string;
  images: string;
  /** Unix seconds; 0 means "now" on both create and update. */
  time: number;
}

/** Body of `POST /api/admin/faq` and `PUT /api/admin/faq/{id}`. */
export interface FaqPayload {
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  active: boolean;
}

/** Body of `POST /api/admin/collectibles`. There is no update endpoint. */
export interface CollectiblePayload {
  name: string;
  description: string;
  image: string;
  /** First instant of the collectable's month; `UNIQUE` in the table. */
  time: number;
}

/** Body of `POST /api/admin/banners` and `PUT /api/admin/banners/{id}`. */
export interface BannerPayload {
  text: string;
  banner: string;
  url: string;
  status: boolean;
  /** Derived from a non-empty `html`, as the legacy page derived it. */
  advanced: boolean;
  /** Raw markup. Requires the high-trust capability to write. */
  html: string;
  sort_order: number;
}

/** Body of `POST /api/admin/campaigns` and `PUT /api/admin/campaigns/{id}`. */
export interface CampaignPayload {
  name: string;
  desc: string;
  image: string;
  url: string;
  visible: boolean;
  sort_order: number;
}
