/**
 * TanStack Query hooks wrapping `src/services/apiAccount.ts`.
 *
 * The signed-in state is *derived from the server*, not stored in the client:
 * `useMe` is the single source of truth, and a 401 from it is a normal,
 * expected answer for an anonymous visitor rather than an error condition.
 * Nothing about the session is cached in `localStorage`, so a session that
 * expires or is deleted server side cannot leave the UI claiming a signed-in
 * user.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  AccountApiError,
  changePassword,
  fetchMe,
  login,
  logout,
  updateEmail,
  updateLook,
  updateMotto,
} from '../services/apiAccount';
import type { User } from '../types/account';

export const accountKeys = {
  me: ['account', 'me'] as const,
};

/**
 * `GET /api/me`.
 *
 * `retry: false` deliberately overrides the client's global `retry: 1`: a 401
 * is the *expected* answer for an anonymous visitor on a guarded route, and
 * retrying it would delay the redirect to the sign-in screen by a backoff for
 * no possible benefit. A 404 is likewise not worth retrying.
 */
export function useMe() {
  return useQuery({
    queryKey: accountKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 0,
  });
}

/** True when the failure means "not signed in" rather than "something broke". */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof AccountApiError && error.isUnauthenticated;
}

/**
 * Sign in and adopt the returned profile as the cached `/api/me` answer.
 *
 * Seeding the cache from the login response rather than invalidating avoids a
 * second round trip and a visible flash of "loading" immediately after a
 * successful sign-in. The response carries exactly the same `user` shape as
 * `/api/me`, so this is not an approximation.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: (user: User) => {
      queryClient.setQueryData(accountKeys.me, { status: 'ok', user, csrf_token: '' });
    },
  });
}

/**
 * Sign out.
 *
 * ## Why this hook does NOT reset the cache itself
 *
 * The obvious implementation — `onSuccess: () => queryClient.resetQueries()` —
 * is wrong here, and the reason is worth recording because it produced a real
 * bug. `resetQueries` refetches the still-mounted `/api/me` observer, and
 * `AuthController::logout` answers 200 *before* the Redis key deletion is
 * confirmed, so that refetch can still return 200 and the guard keeps rendering
 * the signed-in page. Worse, resetting from inside the mutation's callback
 * dispatches React updates that make a `flushSync` navigation in the caller's
 * own `onSettled` throw ("flushSync was called from inside a lifecycle method"),
 * so the navigation silently never happened and the visitor was left on `/me`
 * looking at a sign-in form.
 *
 * The working order is the reverse: the caller navigates first so the `/api/me`
 * observer unmounts, then the cache is cleared. `clearSessionCache` is that
 * second step; see `MePage` and `LogoutPage`.
 */
export function useLogout() {
  return useMutation({
    mutationFn: () => logout(),
  });
}

/**
 * Drop every cached answer after a successful sign-out.
 *
 * Called *after* navigation, never before: with the account observer unmounted
 * there is nothing left for `resetQueries` to refetch, so the destroyed session
 * cannot be re-read as a live one.
 */
export function useClearSessionCache() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.resetQueries();
  };
}

/**
 * Re-read `/api/me` after a profile write.
 *
 * The mutation endpoints return only the field they changed, so the authoritative
 * new state comes from `/api/me`; invalidating it (rather than patching the
 * cache) keeps the displayed profile exactly what the server would serve.
 */
function useProfileMutation<TArgs, TResult>(fn: (args: TArgs, signal?: AbortSignal) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => fn(args),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.me });
    },
  });
}

export function useUpdateMotto() {
  return useProfileMutation<{ motto: string }, { motto: string }>((args) => updateMotto(args.motto));
}

export function useUpdateLook() {
  return useProfileMutation<{ look: string; gender: 'M' | 'F' }, { look: string; gender: string }>(
    (args) => updateLook(args.look, args.gender),
  );
}

export function useUpdateEmail() {
  return useProfileMutation<{ email: string }, { email: string; mail_verified: boolean }>((args) =>
    updateEmail(args.email),
  );
}

export function useChangePassword() {
  return useProfileMutation<
    { currentPassword: string; newPassword: string },
    { message: string }
  >((args) => changePassword(args.currentPassword, args.newPassword));
}
