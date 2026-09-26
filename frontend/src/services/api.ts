/**
 * Typed fetch helpers for the anonymous `/api/public` surface, plus the shared
 * request machinery for the whole **public** API surface.
 *
 * This module — and `apiAdmin.ts` for the staff panel — are the only two places
 * in the frontend allowed to open a request; `scripts/check_admin_ui_coverage.py`
 * enforces that. Account calls therefore import `requestJson` from here instead
 * of calling `fetch()` themselves, so the cookie and CSRF policy lives in one
 * place per surface rather than being re-derived per feature.
 *
 * All endpoints are same-origin relative paths, which the Vite dev server
 * proxies to the Drogon backend (see `vite.config.ts`). The public helpers
 * return only the data the pages need: they unwrap nothing, because the legacy
 * templates read the payload fields directly.
 */

import type {
  BannersResponse,
  CampaignsResponse,
  CollectiblesResponse,
  FaqResponse,
  LandingResponse,
  MaintenanceResponse,
  NewsArticle,
  NewsListResponse,
  SettingsResponse,
} from '../types/api';

export const API_BASE = '/api/public';

/** The account surface shares the origin but not the `/public` prefix. */
export const ACCOUNT_API_BASE = '/api';

export const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/**
 * The value the pre-authentication routes send in `X-XSRF-TOKEN`.
 *
 * Those routes have **no session**, so there is no `XSRF-TOKEN` cookie to read
 * and `requestJson`'s normal path would omit the header entirely — which
 * `CsrfPublicFilter` then rejects with 403, as it should. The filter checks
 * presence, not value, because before a session exists there is nothing to
 * compare against; what makes the requirement meaningful is that a cross-origin
 * request cannot set a custom header without a CORS preflight this application
 * does not answer.
 *
 * A constant is therefore correct and not a secret. It is named rather than
 * inlined so it cannot be mistaken for a token.
 */
export const PUBLIC_CSRF_MARKER = 'public';

export class ApiRequestError extends Error {
  readonly status: number;
  /** Present only on a banned-user login refusal (`AuthResult.errorCode == 3`). */
  readonly banReason?: string;
  readonly banExpires?: string;

  constructor(status: number, message: string, banReason?: string, banExpires?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.banReason = banReason;
    this.banExpires = banExpires;
  }

  /** True when the failure means "no valid public session" (missing/expired). */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * The current double-submit CSRF token, refreshed from the cookie on every call.
 *
 * `XSRF-TOKEN` is issued readable (not HttpOnly) by `AuthController::login`
 * precisely so a decoupled frontend can echo it. Nothing is cached in
 * `localStorage`, so a server-side session change cannot leave a stale token.
 */
export function csrfToken(): string {
  return readCookie(CSRF_COOKIE_NAME);
}

/**
 * The readable remember-me flag cookie, named as the legacy site named it.
 *
 * Readable on purpose: the client tests it to decide whether attempting a
 * remember-me restore is worth a request at all, which is the role the legacy
 * front controller played when it read `$_COOKIE['rememberme']`. The credential
 * itself is a separate, HttpOnly cookie that this code never sees.
 */
export const REMEMBER_FLAG_COOKIE_NAME = 'rememberme';

/** Whether the browser holds the remember-me flag cookie. */
export function hasRememberMeFlag(): boolean {
  return readCookie(REMEMBER_FLAG_COOKIE_NAME) === 'true';
}

interface RequestJsonInit {
  method: 'GET' | 'POST';
  /** Absolute API path beginning with `/`. */
  path: string;
  body?: unknown;
  /**
   * Send the double-submit token. False only for the routes the CSRF filter
   * deliberately exempts — login has no session to bind a token to yet.
   */
  csrf: boolean;
  /**
   * Send this literal value instead of reading the cookie.
   *
   * Only for the pre-authentication routes guarded by `CsrfPublicFilter`, which
   * checks that the header is **present** and has nothing to compare it to (see
   * `PUBLIC_CSRF_MARKER`). Ignored when `csrf` is false.
   */
  csrfValue?: string;
  signal?: AbortSignal;
}

/**
 * Perform one JSON request against the public API surface.
 *
 * Errors carry the server's HTTP status and whatever the body supplied:
 * `{error, message, status}`, plus `ban_reason` / `ban_expires` on a 403 login
 * refusal. Callers branch on `ApiRequestError`, never on a bare `Error`.
 */
export async function requestJson<T>(init: RequestJsonInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  if (init.csrf) {
    const token = init.csrfValue ?? csrfToken();
    // Never fabricate a session token: sending an empty header for a route that
    // validates one would be a silent CSRF bypass attempt, and the filter rejects
    // it anyway. Omitting it produces the server's own explicit 403, which is the
    // honest failure to surface. `csrfValue` is the separate, deliberate case for
    // routes that validate presence only.
    if (token) headers[CSRF_HEADER_NAME] = token;
  }

  const response = await fetch(init.path, {
    method: init.method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const body = (parsed ?? {}) as {
    error?: string;
    message?: string;
    ban_reason?: string;
    ban_expires?: string;
  };

  if (!response.ok) {
    // Error bodies are `{error, message, status}`; fall back to the HTTP text.
    const message = body.message ?? body.error ?? `${response.status} ${response.statusText}`;
    throw new ApiRequestError(response.status, message, body.ban_reason, body.ban_expires);
  }

  return body as T;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>({ method: 'GET', path: `${API_BASE}${path}`, csrf: false, signal });
}

/** `GET /api/public/landing` — five newest articles plus the promo phrases. */
export function fetchLanding(signal?: AbortSignal): Promise<LandingResponse> {
  return getJson<LandingResponse>('/landing', signal);
}

/** `GET /api/public/news` — newest articles, `limit` defaults to 20 server side. */
export function fetchNews(limit?: number, signal?: AbortSignal): Promise<NewsListResponse> {
  const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
  return getJson<NewsListResponse>(`/news${query}`, signal);
}

/** `GET /api/public/news/{id}` */
export function fetchNewsItem(id: number, signal?: AbortSignal): Promise<NewsArticle> {
  return getJson<NewsArticle>(`/news/${encodeURIComponent(String(id))}`, signal);
}

/** `GET /api/public/faq` — active entries ordered by category then sort_order. */
export function fetchFaq(signal?: AbortSignal): Promise<FaqResponse> {
  return getJson<FaqResponse>('/faq', signal);
}

/** `GET /api/public/collectibles` */
export function fetchCollectibles(signal?: AbortSignal): Promise<CollectiblesResponse> {
  return getJson<CollectiblesResponse>('/collectibles', signal);
}

/** `GET /api/public/banners` — visible banners; no `html` field by design. */
export function fetchBanners(signal?: AbortSignal): Promise<BannersResponse> {
  return getJson<BannersResponse>('/banners', signal);
}

/** `GET /api/public/campaigns` */
export function fetchCampaigns(signal?: AbortSignal): Promise<CampaignsResponse> {
  return getJson<CampaignsResponse>('/campaigns', signal);
}

/** `GET /api/public/maintenance` — closure flag, twitter flag and template style. */
export function fetchMaintenance(signal?: AbortSignal): Promise<MaintenanceResponse> {
  return getJson<MaintenanceResponse>('/maintenance', signal);
}

/** `GET /api/public/settings` — site settings, raw-markup values omitted. */
export function fetchSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  return getJson<SettingsResponse>('/settings', signal);
}
