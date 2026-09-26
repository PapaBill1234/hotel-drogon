/**
 * Typed client for the account surface: `/api/auth/*`, `/api/me` and
 * `/api/account/*`.
 *
 * ## What this is derived from
 *
 * Every type and status code here is the *observed* contract (Phase 1,
 * `docs/openapi-account-v1.json`), which was itself verified against the live
 * routes by `scripts/check_account_contract.py`. Nothing is invented: the
 * response shapes are the handlers' actual output.
 *
 * ## Why this file makes no requests of its own
 *
 * The request machinery — cookies, the double-submit CSRF header, error
 * mapping — lives in `services/api.ts`, which is the single place the public
 * surface is allowed to open a request (the staff panel has its own,
 * `apiAdmin.ts`). `scripts/check_admin_ui_coverage.py` fails the build if a
 * third module opens one directly, so this client composes `requestJson` rather
 * than re-deriving that policy. The `AccountApiError` name is kept as an alias
 * of `ApiRequestError` so callers can keep branching on one type.
 *
 * ## Two sessions, and which one this file uses
 *
 * The account routes authorize on the **public** `hotel_session` cookie
 * (`AuthPolicy::requireUser`). The separate `hotel_staff_session` is not
 * sufficient and is not touched here.
 */

import { ACCOUNT_API_BASE, ApiRequestError, requestJson } from './api';
import type {
  ClientEntryResponse,
  LoginRequest,
  MeResponse,
  PasswordChangeRequest,
  PasswordChangeResponse,
  ProfileEmailRequest,
  ProfileEmailResponse,
  ProfileLookRequest,
  ProfileLookResponse,
  ProfileMottoRequest,
  ProfileMottoResponse,
  PurseResponse,
  TransactionsResponse,
  User,
} from '../types/account';

/** The one error type this surface throws. See `ApiRequestError`. */
export const AccountApiError = ApiRequestError;
export type AccountApiError = ApiRequestError;

/**
 * Server-enforced profile limits, taken from the *legacy* implementation
 * (`profile.php`) and the PolarIS schema rather than from the current handler.
 *
 * Legacy `profile.php` rejected rather than truncated:
 *
 *   if (mb_strlen($motto) > 127 || mb_strlen($look) > 256
 *       || !in_array($gender, ['M','F'], true)) { $notice = 'Invalid profile details.'; }
 *
 * The Drogon handler used to truncate the motto to 128 *bytes* and coerce an
 * invalid gender to `M`, which is a silent behaviour change from legacy and can
 * cut a multibyte motto mid-character. The handler now rejects like legacy does;
 * these constants mirror the server so the form can refuse before spending a
 * request, and the server remains the authority.
 *
 * `LOOK_MAX_CHARS` is 255, not legacy's 256: `users.look` is `varchar(255)`, so a
 * 256-character figure cannot be stored and the handler rejects it explicitly.
 */
export const MOTTO_MAX_CHARS = 127;
export const LOOK_MAX_CHARS = 255;
export const PASSWORD_MIN_CHARS = 6;

/**
 * `POST /api/auth/login` — create the public session.
 *
 * Not CSRF-filtered on purpose (there is no session to bind a token to yet).
 * Failures: 400 invalid JSON, 401 bad credentials, 403 banned (with
 * `ban_reason` / `ban_expires`), 500 session store failure. The OpenAPI document
 * records that authentication system errors are currently collapsed into 401;
 * this client does not pretend otherwise.
 */
export function login(username: string, password: string, signal?: AbortSignal): Promise<User> {
  const body: LoginRequest = { username, password };
  return requestJson<MeResponse>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/auth/login`,
    body,
    csrf: false,
    signal,
  }).then((res) => res.user);
}

/**
 * `GET /api/me` — the signed-in user's current profile.
 *
 * Reads the live PolarIS row rather than a session snapshot. 401 when there is no
 * usable public session, 404 when the session is valid but the row is gone.
 */
export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return requestJson<MeResponse>({
    method: 'GET',
    path: `${ACCOUNT_API_BASE}/me`,
    csrf: false,
    signal,
  });
}

/** `POST /api/auth/logout` — delete the public session. CSRF-filtered. */
export function logout(signal?: AbortSignal): Promise<void> {
  return requestJson<{ status: string }>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/auth/logout`,
    body: {},
    csrf: true,
    signal,
  }).then(() => undefined);
}

/** `POST /api/account/motto` — 400 on invalid details, 403 on CSRF failure. */
export function updateMotto(motto: string, signal?: AbortSignal): Promise<ProfileMottoResponse> {
  const body: ProfileMottoRequest = { motto };
  return requestJson<ProfileMottoResponse>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/account/motto`,
    body,
    csrf: true,
    signal,
  });
}

/** `POST /api/account/look` — figure and gender. */
export function updateLook(
  look: string,
  gender: 'M' | 'F',
  signal?: AbortSignal,
): Promise<ProfileLookResponse> {
  const body: ProfileLookRequest = { look, gender };
  return requestJson<ProfileLookResponse>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/account/look`,
    body,
    csrf: true,
    signal,
  });
}

/** `POST /api/account/email` — a successful change resets `mail_verified`. */
export function updateEmail(email: string, signal?: AbortSignal): Promise<ProfileEmailResponse> {
  const body: ProfileEmailRequest = { email };
  return requestJson<ProfileEmailResponse>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/account/email`,
    body,
    csrf: true,
    signal,
  });
}

/** `POST /api/account/password` — 401 when the current password is wrong. */
export function changePassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<PasswordChangeResponse> {
  const body: PasswordChangeRequest = {
    current_password: currentPassword,
    new_password: newPassword,
  };
  return requestJson<PasswordChangeResponse>({
    method: 'POST',
    path: `${ACCOUNT_API_BASE}/account/password`,
    body,
    csrf: true,
    signal,
  });
}

/**
 * `GET /api/account/purse` — the signed-in user's Coin, Pixel and Point balances.
 *
 * The legacy `/credits` page read these from the user row (`credits.php`'s
 * `#purse-habblet`); this is the same read over JSON. There is no user id
 * parameter: the balance served is always the caller's own.
 */
export function fetchPurse(signal?: AbortSignal): Promise<PurseResponse> {
  return requestJson<PurseResponse>({
    method: 'GET',
    path: `${ACCOUNT_API_BASE}/account/purse`,
    csrf: false,
    signal,
  });
}

/**
 * `GET /api/account/transactions` — the caller's own ledger, newest first.
 *
 * Same ownership property as `fetchPurse`: the server takes the user from the
 * session, so there is no id to tamper with.
 */
export function fetchTransactions(signal?: AbortSignal): Promise<TransactionsResponse> {
  return requestJson<TransactionsResponse>({
    method: 'GET',
    path: `${ACCOUNT_API_BASE}/account/transactions`,
    csrf: false,
    signal,
  });
}

/**
 * `GET /api/account/client-entry` — SSO ticket and hotel connection settings.
 *
 * Reports `handoff_available: false` with the missing setting names when the
 * stack has no client configured, rather than inventing a host. See the type's
 * documentation for what these flags do and do not claim.
 */
export function fetchClientEntry(signal?: AbortSignal): Promise<ClientEntryResponse> {
  return requestJson<ClientEntryResponse>({
    method: 'GET',
    path: `${ACCOUNT_API_BASE}/account/client-entry`,
    csrf: false,
    signal,
  });
}

export type { User };
