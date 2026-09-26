/**
 * Response shapes for the implemented account surface.
 *
 * Mirrors `docs/openapi-account-v1.json` (Phase 1 contract, verified against the
 * live routes by `scripts/check_account_contract.py`). Field names are the
 * handlers' actual output — `mail` rather than `email` on the user object, for
 * example, because that is the PolarIS column and what `userToJson` emits.
 *
 * These are intentionally separate from `types/admin.ts`: the admin panel's
 * `AuthResponse`/`MeResponse` describe the same two endpoints but are used with
 * the staff client, and merging them would couple the two surfaces.
 */

import type { ApiEnvelope } from './api';

/** One PolarIS `users` row as `AuthController::userToJson` emits it. */
export interface User {
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
  /** Unix epoch seconds. */
  account_created: number;
  /** Unix epoch seconds; 0 means the account has never signed in. */
  last_login: number;
  /** Derived server side as `rank >= 5`, not a stored column. */
  is_staff: boolean;
}

/** Error bodies are `{error, message, status}`, plus ban detail on a 403 login. */
export interface AccountErrorBody extends ApiEnvelope {
  error?: string;
  message?: string;
  ban_reason?: string;
  ban_expires?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  /**
   * The legacy remember-me flag, under the legacy field name.
   *
   * `classes.php` issued a token only when `$rememberme == "true"`, and the
   * anonymous header's checkbox is `_login_remember_me` with that value, so the
   * JSON field keeps the name rather than inventing a tidier one.
   */
  _login_remember_me?: string;
}

/**
 * `POST /api/auth/remember-login`
 *
 * Establishes a session from the `rememberme_token` cookie. The session it
 * creates always requires step-up: `reauth_required` is true by construction,
 * which is the legacy design — a token restores a session but never grants entry
 * to the hotel on its own.
 */
export interface RememberLoginResponse extends MeResponse {
  reauth_required: boolean;
}

/**
 * `POST /api/auth/login` and `GET /api/me` share this shape.
 *
 * `reauth_required` is returned by both, and by `remember-login` where it is
 * always true. It is optional here because a client that has only seen a login
 * response may be reading an older payload; treat a missing value as false, which
 * is what the server's own reader does for a session document written before the
 * field existed.
 */
export interface MeResponse extends ApiEnvelope {
  user: User;
  csrf_token: string;
  reauth_required?: boolean;
}

export interface ProfileMottoRequest {
  motto: string;
}

export interface ProfileMottoResponse extends ApiEnvelope {
  motto: string;
}

export interface ProfileLookRequest {
  look: string;
  /** M or F. The current handler stores M when this is absent or invalid. */
  gender?: string;
}

export interface ProfileLookResponse extends ApiEnvelope {
  look: string;
  gender: string;
}

export interface ProfileEmailRequest {
  email: string;
}

export interface ProfileEmailResponse extends ApiEnvelope {
  email: string;
  /** Always false after a successful change: a new address is unverified. */
  mail_verified: boolean;
}

export interface PasswordChangeRequest {
  current_password: string;
  new_password: string;
}

export interface PasswordChangeResponse extends ApiEnvelope {
  message: string;
}

/**
 * `POST /api/account/client-entry`
 *
 * The materials a client needs to connect, plus an explicit statement of whether
 * the website can actually offer a handoff.
 *
 * `handoff_ready` means an Octane origin or legacy connection is configured.
 * `handoff_available` additionally requires that the ticket was stored.
 * Emulator acceptance is verified separately by the isolated browser test.
 *
 * The ticket is not valid forever, and the page says so: `sso_ticket_void_at` is
 * when this website replaces it with a value the client cannot present. That
 * deadline is the website's own, because PolarIS matches `auth_ticket` at game
 * login without consulting an expiry and restores a consumed ticket after a
 * disconnect.
 */
export interface ClientEntryResponse extends ApiEnvelope {
  handoff_ready: boolean;
  handoff_available: boolean;
  /** Validated origin for browser-native Octane, empty when not configured. */
  octane_url: string;
  /** Empty when the ticket could not be stored. */
  sso_ticket: string;
  /** Unix epoch seconds; 0 when no ticket was stored. */
  sso_ticket_void_at: number;
  /** Names of the `phpretro_site_settings` keys that are absent or empty. */
  missing_settings: string[];
  connection: {
    host: string;
    port: string;
    mus_port: string;
    client_asset: string;
  };
  notes: string;
}

export interface LogoutResponse extends ApiEnvelope {
  message: string;
}

/**
 * `POST /api/auth/password/forgot`
 *
 * The message is deliberately the same whether or not the details matched a
 * verified account — legacy `forgot.php` distinguished the two, which made the
 * form an oracle for which accounts exist. See the route's OpenAPI description.
 */
export interface ForgotPasswordResponse extends ApiEnvelope {
  message: string;
}

/** `POST /api/auth/password/reset` — 401 when the token is unknown, expired or spent. */
export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface ResetPasswordResponse extends ApiEnvelope {
  message: string;
}

/**
 * `POST /api/auth/username/forgot`
 *
 * Legacy mailed the list; with no mail transport configured the names come back
 * in the response instead, and `mail_transport` says which happened so the UI can
 * be honest about it rather than implying an email was sent.
 */
export interface ForgotUsernameResponse extends ApiEnvelope {
  usernames: string[];
  count: number;
  mail_transport: 'log-only' | 'smtp';
}

/** `GET /api/account/session` */
export interface SessionStateResponse extends ApiEnvelope {
  user_id: number;
  username: string;
  /** The legacy `$_SESSION['reauthenticate']` flag. */
  reauth_required: boolean;
}

/** `POST /api/account/reauthenticate` */
export interface ReauthenticateResponse extends ApiEnvelope {
  reauth_required: boolean;
  message: string;
}

/**
 * One row of the website's own ledger, `phpretro_transactions`.
 *
 * The columns are legacy migration `001_custom_tables.sql`'s, and the two legacy
 * writers (`housekeeping/users.php` → `admin_grant`, `includes/PhpretroHomes.php`
 * → `homes_store`) are what define the `type` values. Nothing here is invented.
 */
export interface Transaction {
  id: number;
  type: string;
  /** Signed: a negative amount is a debit, e.g. the Homes store spending Coins. */
  amount: number;
  /** The Coin balance immediately after this row was written. */
  balance_after: number;
  description: string;
  /** Empty when the column is NULL — the schema allows it. */
  reference_id: string;
  /** Unix epoch seconds. */
  created_at: number;
}

/** `GET /api/account/transactions` */
export interface TransactionsResponse extends ApiEnvelope {
  items: Transaction[];
  count: number;
  /** The server's own page cap, so the UI can say when it truncated. */
  limit: number;
}

/**
 * `GET /api/account/purse`
 *
 * Read from the live PolarIS `users` row, not derived from the ledger: the row is
 * the balance of record, and the ledger only records what the website changed.
 */
export interface PurseResponse extends ApiEnvelope {
  credits: number;
  pixels: number;
  points: number;
}
