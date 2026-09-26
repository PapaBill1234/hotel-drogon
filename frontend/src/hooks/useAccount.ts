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
  fetchSessionState,
  login,
  logout,
  reauthenticate,
  rememberLogin,
  requestPasswordReset,
  requestUsernameReminder,
  resetPassword,
  updateEmail,
  updateLook,
  updateMotto,
} from '../services/apiAccount';
import type { User } from '../types/account';

export const accountKeys = {
  me: ['account', 'me'] as const,
  sessionState: ['account', 'session'] as const,
};

/**
 * `GET /api/account/session` — the step-up flag and what the session may do.
 *
 * Separate from `useMe` because `/api/me` answers 401 for a caller with no
 * session while this reports the session's *state*; conflating them would make
 * `reauth_required` unreadable on the pages that need it most.
 */
export function useSessionState() {
  return useQuery({
    queryKey: accountKeys.sessionState,
    queryFn: ({ signal }) => fetchSessionState(signal),
    retry: false,
    staleTime: 0,
  });
}

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
    mutationFn: ({
      username,
      password,
      rememberMe = false,
    }: {
      username: string;
      password: string;
      rememberMe?: boolean;
    }) => login(username, password, rememberMe),
    onSuccess: (user: User) => {
      queryClient.setQueryData(accountKeys.me, { status: 'ok', user, csrf_token: '' });
    },
  });
}

/**
 * Restore a session from the remember-me cookie.
 *
 * The server spends the token and answers `reauth_required: true`, so the caller
 * must send the visitor to the step-up screen rather than to a working page —
 * that is the legacy contract, not a detail.
 *
 * Also resets the query cache on success for the same reason `HousekeepingLoginPage`
 * does: answers cached while signed out (a 403, an empty purse) must not survive
 * into the restored session.
 */
export function useRememberLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rememberLogin(),
    onSuccess: async () => {
      await queryClient.resetQueries();
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

/**
 * `POST /api/auth/password/forgot` — request a reset link.
 *
 * A mutation rather than a query because it sends something. It deliberately
 * does **not** invalidate the `/api/me` cache: the caller is signed out by
 * definition, and nothing about their state changed.
 */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: ({ username, email }: { username: string; email: string }) =>
      requestPasswordReset(username, email),
  });
}

/** `POST /api/auth/password/reset` — spend a reset token. */
export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, newPassword }: { token: string; newPassword: string }) =>
      resetPassword(token, newPassword),
  });
}

/** `POST /api/auth/username/forgot` — list the account names on an address. */
export function useRequestUsernameReminder() {
  return useMutation({
    mutationFn: ({ email }: { email: string }) => requestUsernameReminder(email),
  });
}

/**
 * `POST /api/account/reauthenticate` — clear the step-up requirement.
 *
 * Invalidates the session state on success so the page that routed here sees the
 * cleared flag rather than a cached `reauth_required: true`.
 */
export function useReauthenticate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ password }: { password: string }) => reauthenticate(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.sessionState });
    },
  });
}
