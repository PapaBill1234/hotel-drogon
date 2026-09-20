import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import {
  createBanner,
  createCampaign,
  createCollectible,
  createFaq,
  createNews,
  deleteBanner,
  deleteCampaign,
  deleteCollectible,
  deleteFaq,
  deleteNews,
  fetchAdminSession,
  fetchMe,
  listBanners,
  listCampaigns,
  listCollectibles,
  listFaq,
  listNews,
  listSettings,
  setSetting,
  updateBanner,
  updateCampaign,
  updateCollectible,
  updateFaq,
  updateNews,
} from '../services/apiAdmin';
import { AdminApiError } from '../services/apiAdmin';
import type {
  AdminBannerList,
  AdminCampaignList,
  AdminCollectibleList,
  AdminFaqList,
  AdminMutationResult,
  AdminNewsList,
  AdminSession,
  AdminSettingList,
  MeResponse,
} from '../types/admin';

/**
 * Query keys for the admin surface. Mutations invalidate exactly the list they
 * changed, so a create is visible on the next render without a manual refresh —
 * the legacy pages got this for free by re-rendering server-side.
 */
export const adminKeys = {
  session: ['admin', 'session'] as const,
  me: ['auth', 'me'] as const,
  news: ['admin', 'news'] as const,
  faq: ['admin', 'faq'] as const,
  collectibles: ['admin', 'collectibles'] as const,
  banners: ['admin', 'banners'] as const,
  campaigns: ['admin', 'campaigns'] as const,
  settings: ['admin', 'settings'] as const,
};

/**
 * 401/403 will not become 200 by retrying; every other error gets one retry.
 *
 * `AdminApiError` carries the HTTP status as a *property*, so this is written
 * structurally rather than with `instanceof` and accepts `unknown`, which is
 * what keeps it usable as the `retry` option for query generics typed as
 * `<Data, Error>`.
 */
function retryAdmin(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (status === 401 || status === 403) return false;
  return failureCount < 1;
}

/** Kept exported under the original name for call sites outside this module. */
export const adminRetry = retryAdmin;

/** `GET /api/me` — the signed-in user; 401 simply means "anonymous". */
export function useMe() {
  return useQuery<MeResponse, Error>({
    queryKey: adminKeys.me,
    queryFn: fetchMe,
    retry: retryAdmin,
    // The session can be created by the login page at any time, and a stale
    // "anonymous" answer would bounce the operator back to the form.
    staleTime: 0,
  });
}

/**
 * `GET /api/admin/session` — the staff session this browser actually holds.
 *
 * This is what distinguishes "signed in as staff" from "signed in but without
 * the separate staff session": `requireStaff` reads
 * `hotel_staff_session`, and `/api/auth/me` knows nothing about it.
 */
export function useAdminSession(enabled: boolean) {
  return useQuery<AdminSession, Error>({
    queryKey: adminKeys.session,
    queryFn: fetchAdminSession,
    enabled,
    retry: retryAdmin,
    staleTime: 0,
  });
}

export function useNewsList() {
  return useQuery<AdminNewsList, Error>({
    queryKey: adminKeys.news,
    queryFn: listNews,
    retry: retryAdmin,
  });
}

export function useFaqList() {
  return useQuery<AdminFaqList, Error>({
    queryKey: adminKeys.faq,
    queryFn: listFaq,
    retry: retryAdmin,
  });
}

export function useCollectiblesList() {
  return useQuery<AdminCollectibleList, Error>({
    queryKey: adminKeys.collectibles,
    queryFn: listCollectibles,
    retry: retryAdmin,
  });
}

export function useBannersList() {
  return useQuery<AdminBannerList, Error>({
    queryKey: adminKeys.banners,
    queryFn: listBanners,
    retry: retryAdmin,
  });
}

export function useCampaignsList() {
  return useQuery<AdminCampaignList, Error>({
    queryKey: adminKeys.campaigns,
    queryFn: listCampaigns,
    retry: retryAdmin,
  });
}

export function useSettingsList() {
  return useQuery<AdminSettingList, Error>({
    queryKey: adminKeys.settings,
    queryFn: listSettings,
    retry: retryAdmin,
  });
}

/**
 * The six content mutations, each invalidating its own list.
 *
 * The payload types stay concrete per resource rather than collapsing into one
 * union, because a union would let a wrong payload through the compiler — which
 * is exactly the class of bug (a field the server never receives) that makes a
 * form appear to do nothing.
 */
export type AdminMutation<P> = UseMutationResult<AdminMutationResult, Error, P>;

/**
 * Split a failed mutation into `{ field: message }` plus a form-level banner.
 *
 * The API answers a validation failure with HTTP 400 and `{message, field}`
 * (`AdminContentController::finish` -> `errResp`), where `field` is the exact
 * column the service rejected (`ContentService::validateNews` and friends set
 * it). Legacy `housekeeping/news.php` had one flat notice
 * ("Title, summary, story, and author are required.") for every case; keeping
 * the field lets the port attach the message to the input that caused it
 * without inventing client-side rules that differ from the server's.
 */
export function splitFieldError(error: unknown): {
  field?: string;
  message: string | null;
} {
  if (error instanceof AdminApiError) {
    return { field: error.field, message: error.message };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: null };
}

export function useAdminMutations() {
  const queryClient = useQueryClient();
  const invalidate = (key: readonly unknown[]) => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  return {
    createNews: useMutation({
      mutationFn: createNews,
      onSuccess: () => invalidate(adminKeys.news),
    }),
    updateNews: useMutation({
      mutationFn: (vars: { id: number; payload: Parameters<typeof updateNews>[1] }) =>
        updateNews(vars.id, vars.payload),
      onSuccess: () => invalidate(adminKeys.news),
    }),
    deleteNews: useMutation({ mutationFn: deleteNews, onSuccess: () => invalidate(adminKeys.news) }),

    createFaq: useMutation({
      mutationFn: createFaq,
      onSuccess: () => invalidate(adminKeys.faq),
    }),
    updateFaq: useMutation({
      mutationFn: (vars: { id: number; payload: Parameters<typeof updateFaq>[1] }) =>
        updateFaq(vars.id, vars.payload),
      onSuccess: () => invalidate(adminKeys.faq),
    }),
    deleteFaq: useMutation({ mutationFn: deleteFaq, onSuccess: () => invalidate(adminKeys.faq) }),

    createCollectible: useMutation({
      mutationFn: createCollectible,
      onSuccess: () => invalidate(adminKeys.collectibles),
    }),
    updateCollectible: useMutation({
      mutationFn: (vars: { id: number; payload: Parameters<typeof updateCollectible>[1] }) =>
        updateCollectible(vars.id, vars.payload),
      onSuccess: () => invalidate(adminKeys.collectibles),
    }),
    deleteCollectible: useMutation({
      mutationFn: deleteCollectible,
      onSuccess: () => invalidate(adminKeys.collectibles),
    }),

    createBanner: useMutation({
      mutationFn: createBanner,
      onSuccess: () => invalidate(adminKeys.banners),
    }),
    updateBanner: useMutation({
      mutationFn: (vars: { id: number; payload: Parameters<typeof updateBanner>[1] }) =>
        updateBanner(vars.id, vars.payload),
      onSuccess: () => invalidate(adminKeys.banners),
    }),
    deleteBanner: useMutation({
      mutationFn: deleteBanner,
      onSuccess: () => invalidate(adminKeys.banners),
    }),

    createCampaign: useMutation({
      mutationFn: createCampaign,
      onSuccess: () => invalidate(adminKeys.campaigns),
    }),
    updateCampaign: useMutation({
      mutationFn: (vars: { id: number; payload: Parameters<typeof updateCampaign>[1] }) =>
        updateCampaign(vars.id, vars.payload),
      onSuccess: () => invalidate(adminKeys.campaigns),
    }),
    deleteCampaign: useMutation({
      mutationFn: deleteCampaign,
      onSuccess: () => invalidate(adminKeys.campaigns),
    }),

    setSetting: useMutation({
      mutationFn: (vars: { key: string; value: string }) => setSetting(vars.key, vars.value),
      onSuccess: () => invalidate(adminKeys.settings),
    }),
  };
}
