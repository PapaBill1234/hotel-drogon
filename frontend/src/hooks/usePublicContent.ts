/**
 * TanStack Query hooks wrapping `src/services/api.ts`.
 *
 * The query keys mirror the legacy request URLs one for one, so pages that
 * used to re-fetch on every full page load now share a cache entry.
 */

import { useQuery } from '@tanstack/react-query';

import {
  fetchBanners,
  fetchCampaigns,
  fetchCollectibles,
  fetchFaq,
  fetchLanding,
  fetchMaintenance,
  fetchNews,
  fetchNewsItem,
  fetchSettings,
} from '../services/api';

export const queryKeys = {
  landing: ['public', 'landing'] as const,
  news: (limit?: number) => ['public', 'news', limit ?? 'default'] as const,
  newsItem: (id: number) => ['public', 'news', 'item', id] as const,
  faq: ['public', 'faq'] as const,
  collectibles: ['public', 'collectibles'] as const,
  banners: ['public', 'banners'] as const,
  campaigns: ['public', 'campaigns'] as const,
  maintenance: ['public', 'maintenance'] as const,
  settings: ['public', 'settings'] as const,
};

/** `/api/public/landing` — frontpage news teasers and promo phrases. */
export function useLanding() {
  return useQuery({
    queryKey: queryKeys.landing,
    queryFn: ({ signal }) => fetchLanding(signal),
  });
}

/** `/api/public/news` — newest articles, used by the frontpage promo widget. */
export function useNews(limit?: number) {
  return useQuery({
    queryKey: queryKeys.news(limit),
    queryFn: ({ signal }) => fetchNews(limit, signal),
  });
}

/** `/api/public/news/{id}` — a single article. Disabled until an id is known. */
export function useNewsItem(id: number | null) {
  return useQuery({
    queryKey: queryKeys.newsItem(id ?? 0),
    queryFn: ({ signal }) => fetchNewsItem(id as number, signal),
    enabled: id !== null,
  });
}

/** `/api/public/faq` — grouped by category inside `HelpPage`. */
export function useFaq() {
  return useQuery({
    queryKey: queryKeys.faq,
    queryFn: ({ signal }) => fetchFaq(signal),
  });
}

/** `/api/public/collectibles` */
export function useCollectibles() {
  return useQuery({
    queryKey: queryKeys.collectibles,
    queryFn: ({ signal }) => fetchCollectibles(signal),
  });
}

/** `/api/public/banners` — the `#column3` ad slots. */
export function useBanners() {
  return useQuery({
    queryKey: queryKeys.banners,
    queryFn: ({ signal }) => fetchBanners(signal),
  });
}

/** `/api/public/campaigns` */
export function useCampaigns() {
  return useQuery({
    queryKey: queryKeys.campaigns,
    queryFn: ({ signal }) => fetchCampaigns(signal),
  });
}

/** `/api/public/maintenance` — selects the classic or new maintenance template. */
export function useMaintenance() {
  return useQuery({
    queryKey: queryKeys.maintenance,
    queryFn: ({ signal }) => fetchMaintenance(signal),
  });
}

/** `/api/public/settings` — site-wide strings the legacy templates echoed. */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
  });
}
