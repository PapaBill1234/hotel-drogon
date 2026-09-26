/**
 * Where the "enter the hotel" buttons send a signed-in visitor.
 *
 * Two entry points need the same answer — `/me`'s Enter button and `/client`'s
 * launcher — and they must not disagree about which client is configured, or
 * about what a missing configuration means.
 *
 * This is a deliberate port of `client.php`'s two launch shapes:
 *
 *  - **Browser-native Octane.** Configured by an operator; the client consumes
 *    `?sso=<users.auth_ticket>` at its own root. Taken when `octane_url` is set.
 *  - **The legacy Shockwave client.** `client.php` embedded a Director object
 *    whose `sw8` parameter carried `use.sso.ticket=1;sso.ticket=<ticket>` and
 *    whose `sw2`/`sw3` carried host/port/MUS port. Kept for an operator who has
 *    configured that instead.
 */

import type { ClientEntryResponse } from '../types/account';

/**
 * A URL-shaped rendering of the configured host and port.
 *
 * Deliberately not `http://`: the value a Shockwave client was given was a bare
 * `host:port` for its own socket connection, not an HTTP origin, and guessing a
 * scheme would invent a fact. The `hotel://` scheme marks it as the hotel
 * endpoint it is; nothing dereferences it in this application.
 */
export function clientScheme(host: string, port: string): string {
  return `hotel://${host}${port ? `:${port}` : ''}`;
}

/**
 * The URL to launch, or `null` when nothing is configured to launch.
 *
 * `null` is a real answer, not an error: a site with no client configured should
 * send the visitor somewhere that says so rather than to a dead link.
 */
export function launchUrl(entry: ClientEntryResponse): string | null {
  if (!entry.handoff_available || entry.sso_ticket === '') return null;

  if (entry.octane_url) {
    return `${entry.octane_url}?sso=${encodeURIComponent(entry.sso_ticket)}`;
  }

  const { host, port } = entry.connection;
  if (host === '') return null;
  return `${clientScheme(host, port)}?use.sso.ticket=1&sso.ticket=${encodeURIComponent(entry.sso_ticket)}`;
}

/**
 * The local time a ticket stops working, or a phrase when the server did not
 * report one. Rendered from the server's deadline rather than recomputed here:
 * the window is the server's to enforce, and a client-side guess would disagree
 * with it.
 */
export function voidTime(epochSeconds: number): string {
  if (!epochSeconds) return 'an unreported time';
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
