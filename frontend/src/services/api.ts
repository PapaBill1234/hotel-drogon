/**
 * Typed fetch helpers for the anonymous `/api/public` surface.
 *
 * All endpoints are GET + anonymous and default to a same-origin relative path,
 * which the Vite dev server proxies to the Drogon backend (see
 * `vite.config.ts`). The helpers return only the data the pages need: they
 * unwrap nothing, because the legacy templates read the payload fields
 * directly.
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

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });

  if (!response.ok) {
    // Error bodies are `{error, message, status}`; fall back to the HTTP text.
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* keep the status line */
    }
    throw new ApiRequestError(response.status, message);
  }

  return (await response.json()) as T;
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
