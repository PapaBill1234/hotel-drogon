/**
 * Typed client for the staff `/api/admin/*` surface plus the auth calls the
 * admin UI needs to establish *both* sessions.
 *
 * ## Two cookies, one UI
 *
 * `filters::AuthPolicy::requireStaff` reads `hotel_staff_session`, while
 * `filters::CsrfFilter` validates the submitted token against the
 * `csrf_token` of the **user** session in `hotel_session`. A staff-only cookie
 * jar therefore cannot pass CSRF — `SessionManager::StaffSessionData` has no
 * `csrf_token` field at all. The admin UI must hold both, exactly as
 * `scripts/smoke_phase4_admin.sh` does:
 *
 *   1. `POST /api/auth/login`        -> `hotel_session` + `XSRF-TOKEN`
 *   2. `POST /api/auth/staff-login`  -> `hotel_staff_session`
 *
 * Both calls are deliberately performed with the server's own endpoints rather
 * than reproducing password verification or session minting in the browser.
 *
 * ## CSRF
 *
 * The double-submit token is `XSRF-TOKEN`, issued readable (not HttpOnly) by
 * `AuthController::login` precisely so a decoupled frontend can echo it. It is
 * read from the cookie on every mutating call; nothing is cached in
 * localStorage, so a server-side session change cannot leave a stale token in
 * place.
 */

import type {
  AdminBannerList,
  AdminCampaignList,
  AdminCollectibleList,
  AdminEnvelope,
  AdminFaqList,
  AdminMutationResult,
  AdminNewsList,
  AdminSession,
  AdminSettingList,
  AuthResponse,
  BannerPayload,
  CampaignPayload,
  CollectiblePayload,
  FaqPayload,
  MeResponse,
  NewsPayload,
} from '../types/admin';

export const ADMIN_API_BASE = '/api';

export const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/** Mirrors `AuthPolicy::kStaffMinRank` on the server; the server is the authority. */
export const STAFF_MIN_RANK = 5;
/** Mirrors `AuthPolicy::kHighTrustMinRank` (raw HTML/script capability). */
export const HIGH_TRUST_MIN_RANK = 7;

/** An error carrying the server's HTTP status and the field it rejected. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(status: number, message: string, field?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.field = field;
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : '';
}

/** The current double-submit CSRF token, refreshed from the cookie each call. */
export function csrfToken(): string {
  return readCookie(CSRF_COOKIE_NAME);
}

async function request<T extends AdminEnvelope>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  if (init.method !== 'GET') {
    const token = csrfToken();
    // Never fabricate a token: sending an empty header would be a silent
    // CSRF bypass attempt, and the server would (correctly) reject it anyway.
    if (token) headers[CSRF_HEADER_NAME] = token;
  }

  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    method: init.method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const body = (parsed ?? {}) as AdminEnvelope;

  if (!response.ok) {
    const message =
      body.message ?? body.error ?? `${response.status} ${response.statusText}`;
    throw new AdminApiError(response.status, message, body.field);
  }

  return body as T;
}

// --------------------------------------------------------------------- auth

/** `POST /api/auth/login` — establishes the public user session and the CSRF cookie. */
export function adminLogin(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

/**
 * `POST /api/auth/staff-login` — establishes the separate staff session.
 *
 * `totp_code` is forwarded only when supplied. The current server-side gate
 * checks the code's *format* (6 digits) rather than a per-staff secret, which
 * the inventory records as a Phase 3 partial; the UI does not pretend
 * otherwise, and the 2FA state the server reports back is what is displayed.
 */
export function adminStaffLogin(
  username: string,
  password: string,
  totpCode?: string,
): Promise<AuthResponse> {
  const body: Record<string, string> = { username, password };
  if (totpCode) body.totp_code = totpCode;
  return request<AuthResponse>('/auth/staff-login', { method: 'POST', body });
}

/** `POST /api/auth/logout` — clears the public session cookies. */
export function adminLogout(): Promise<AdminEnvelope> {
  return request<AdminEnvelope>('/auth/logout', { method: 'POST' });
}

/**
 * `GET /api/me` — the signed-in user, if any. Rejects with 401 when anonymous.
 *
 * Note the path: the existing route is `/api/me` (registered with
 * `ADD_METHOD_TO(AuthController::getMe, "/api/me", …)`), not `/api/auth/me`.
 * The plan's Phase 3 exit condition names `/api/me` as well, so the route stays
 * as-is and this client follows it rather than introducing a duplicate.
 */
export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>('/me', { method: 'GET' });
}

/** `GET /api/admin/session` — the *staff* session this browser actually holds. */
export function fetchAdminSession(): Promise<AdminSession> {
  return request<AdminSession>('/admin/session', { method: 'GET' });
}

// --------------------------------------------------------------------- news

export function listNews(): Promise<AdminNewsList> {
  return request<AdminNewsList>('/admin/news', { method: 'GET' });
}

export function createNews(payload: NewsPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/news', { method: 'POST', body: payload });
}

export function updateNews(id: number, payload: NewsPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/news/${id}`, { method: 'PUT', body: payload });
}

export function deleteNews(id: number): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/news/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------- faq

export function listFaq(): Promise<AdminFaqList> {
  return request<AdminFaqList>('/admin/faq', { method: 'GET' });
}

export function createFaq(payload: FaqPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/faq', { method: 'POST', body: payload });
}

export function updateFaq(id: number, payload: FaqPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/faq/${id}`, { method: 'PUT', body: payload });
}

export function deleteFaq(id: number): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/faq/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------- collectibles

export function listCollectibles(): Promise<AdminCollectibleList> {
  return request<AdminCollectibleList>('/admin/collectibles', { method: 'GET' });
}

export function createCollectible(
  payload: CollectiblePayload,
): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/collectibles', {
    method: 'POST',
    body: payload,
  });
}

export function deleteCollectible(id: number): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/collectibles/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------------ banners

export function listBanners(): Promise<AdminBannerList> {
  return request<AdminBannerList>('/admin/banners', { method: 'GET' });
}

export function createBanner(payload: BannerPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/banners', { method: 'POST', body: payload });
}

export function updateBanner(
  id: number,
  payload: BannerPayload,
): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/banners/${id}`, {
    method: 'PUT',
    body: payload,
  });
}

export function deleteBanner(id: number): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/banners/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- campaigns

export function listCampaigns(): Promise<AdminCampaignList> {
  return request<AdminCampaignList>('/admin/campaigns', { method: 'GET' });
}

export function createCampaign(payload: CampaignPayload): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/campaigns', {
    method: 'POST',
    body: payload,
  });
}

export function updateCampaign(
  id: number,
  payload: CampaignPayload,
): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/campaigns/${id}`, {
    method: 'PUT',
    body: payload,
  });
}

export function deleteCampaign(id: number): Promise<AdminMutationResult> {
  return request<AdminMutationResult>(`/admin/campaigns/${id}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------- settings

export function listSettings(): Promise<AdminSettingList> {
  return request<AdminSettingList>('/admin/settings', { method: 'GET' });
}

/**
 * `PUT /api/admin/settings` — one key per call.
 *
 * The legacy page (`housekeeping/settings.php`, rank 7) submitted every
 * existing key in one form and skipped unchanged ones; this endpoint upserts a
 * single key, so the settings page issues one call per changed row and reports
 * per-key results instead of a single "Settings saved."
 */
export function setSetting(key: string, value: string): Promise<AdminMutationResult> {
  return request<AdminMutationResult>('/admin/settings', {
    method: 'PUT',
    body: { key, value },
  });
}

/**
 * True when the server would demand the high-trust capability for this value.
 *
 * Ported from `ContentService::isHighTrustHtml`, which is the server's own
 * definition. This exists so the UI can warn *before* a submit; it is not a
 * security boundary (the server re-checks via `bannerRequiresHighTrust`), and a
 * false negative here only means the operator finds out at submit time.
 */
export function looksLikeRawMarkup(value: string): boolean {
  const lower = value.toLowerCase();
  return [
    '<script',
    '<iframe',
    '<object',
    '<embed',
    'javascript:',
    'onerror=',
    'onload=',
    'onclick=',
    '<style',
    '<link',
  ].some((needle) => lower.includes(needle));
}
