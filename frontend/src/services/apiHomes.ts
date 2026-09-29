/**
 * The MyHabbo Homes API client.
 *
 * Lives beside `apiAccount.ts` rather than inside `api.ts` so the route list for
 * one feature stays readable, and it goes through `requestJson` for the same
 * reason every other client does: the cookie and CSRF policy is written once, in
 * `api.ts`, and `scripts/check_admin_ui_coverage.py` fails the build for a module
 * that opens a request itself.
 *
 * The contract is `docs/homes-layout-api.md`; the legacy behaviour behind it is
 * `home.php` and `includes/PhpretroHomes.php`.
 */

import { ApiRequestError, requestJson } from './api';
import type {
  HomeGuestbookEntry,
  HomeLayout,
  HomePlacement,
  HomeWidget,
  UserWidgetKey,
} from '../types/homes';
import { MAX_HOME_POSITION } from '../types/homes';

/** `ACCOUNT_API_BASE` is `/api`; the homes routes hang directly off it. */
const HOMES_BASE = '/api/homes';

/** `GET /api/homes/{id}/layout` — readable by anyone, guests included. */
export function fetchHomeLayout(userId: number, signal?: AbortSignal): Promise<HomeLayout> {
  return requestJson<HomeLayout>({
    method: 'GET',
    path: `${HOMES_BASE}/${userId}/layout`,
    csrf: false,
    signal,
  });
}

/** `GET /api/homes/{id}/guestbook` — public, read-only personal entries. */
export function fetchHomeGuestbook(
  userId: number,
  signal?: AbortSignal,
): Promise<HomeGuestbookEntry[]> {
  return requestJson<HomeGuestbookEntry[]>({
    method: 'GET',
    path: `${HOMES_BASE}/${userId}/guestbook`,
    csrf: false,
    signal,
  });
}

/** `POST /api/homes/{id}/edit-session` — open or refresh the Redis edit lock. */
export interface HomeEditSession {
  status: string;
  token: string;
  holder_user_id: number;
  ttl_seconds: number;
}

export function openHomeEditSession(userId: number): Promise<HomeEditSession> {
  return requestJson<HomeEditSession>({
    method: 'POST',
    path: `${HOMES_BASE}/${userId}/edit-session`,
    csrf: true,
  });
}

/**
 * `DELETE /api/homes/{id}/edit-session` — release the caller's own lock.
 *
 * The token travels in the body, not the URL: a URL ends up in logs and history,
 * and this is a credential for the duration of an edit.
 */
export function closeHomeEditSession(userId: number, lockToken: string): Promise<void> {
  return requestJson<void>({
    method: 'DELETE',
    path: `${HOMES_BASE}/${userId}/edit-session`,
    body: { lock_token: lockToken },
    csrf: true,
  });
}

/** `PUT /api/homes/{id}/layout` — move widgets, optionally change background. */
export function saveHomeLayout(
  userId: number,
  version: number,
  lockToken: string,
  widgets: HomePlacement[],
  backgroundItemId?: number,
): Promise<HomeLayout> {
  return requestJson<HomeLayout>({
    method: 'PUT',
    path: `${HOMES_BASE}/${userId}/layout`,
    body: {
      version,
      lock_token: lockToken,
      widgets,
      ...(backgroundItemId === undefined ? {} : { background_item_id: backgroundItemId }),
    },
    csrf: true,
  });
}

/** `POST /api/homes/{id}/widgets` */
export function addHomeWidget(
  userId: number,
  widgetKey: UserWidgetKey,
  column: number,
): Promise<{ status: string; widget: HomeWidget }> {
  return requestJson<{ status: string; widget: HomeWidget }>({
    method: 'POST',
    path: `${HOMES_BASE}/${userId}/widgets`,
    body: { widget_key: widgetKey, column },
    csrf: true,
  });
}

/** `DELETE /api/homes/{id}/widgets/{widgetId}` */
export function removeHomeWidget(userId: number, widgetId: number): Promise<void> {
  return requestJson<void>({
    method: 'DELETE',
    path: `${HOMES_BASE}/${userId}/widgets/${widgetId}`,
    csrf: true,
  });
}

/**
 * The slot a dragged box lands in — `saveWidgetCoords()`'s rule.
 *
 * Legacy's editor posted pixels and the model derived the slot:
 *
 *   $column   = $coords['x'] >= 450 ? 2 : 1;
 *   $position = max(0, (int) floor($coords['y'] / 50));
 *
 * This is the one place the client re-derives it, and it exists because the
 * write contract takes a slot rather than a pixel position. It is not
 * load-bearing for what is stored: the server validates the slot against the
 * home's rows and answers with the geometry it computed, which then replaces the
 * optimistic value. A drift here therefore shows up as a box that snaps
 * differently until the response lands — not as a wrong layout.
 */
export function placementForPixels(
  left: number,
  top: number,
): { column: number; position: number } {
  const column = left >= 450 ? 2 : 1;
  const position = Math.min(MAX_HOME_POSITION, Math.max(0, Math.floor(top / 50)));
  return { column, position };
}

/**
 * The geometry the server would return for a slot — `widgetStyle()`.
 *
 * Used only to render a move optimistically, so the box does not jump while the
 * request is in flight. The server's own values replace these on success.
 */
export function geometryForSlot(
  column: number,
  position: number,
): { left: number; top: number; z_index: number } {
  return {
    left: column === 2 ? 450 : 25,
    top: position * 50 + 10,
    z_index: position + 1,
  };
}

/**
 * Whether a failed request was the API's lock refusal (`423 Locked`).
 *
 * The editor has to tell "somebody else is editing this" from "your session
 * expired": the first needs the page reloaded into view mode, the second needs a
 * new edit session.
 */
export function isLockRefusal(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 423;
}
