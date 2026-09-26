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
}

/** `POST /api/auth/login` and `GET /api/me` share this shape. */
export interface MeResponse extends ApiEnvelope {
  user: User;
  csrf_token: string;
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

export interface LogoutResponse extends ApiEnvelope {
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
