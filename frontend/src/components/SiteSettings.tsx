import { createContext, useContext, type ReactNode } from 'react';

import { useSettings } from '../hooks/usePublicContent';

/**
 * One shared read of `/api/public/settings` for a whole page.
 *
 * ## Why this exists
 *
 * Every legacy template read settings from the same `$settings->find(...)` call,
 * so a page could never show two different values for the same key. The port
 * instead had each component call `useSettings()` itself, and on `/forgot` that
 * produced a page which rendered **both** the right value and an empty one: the
 * shell's `<title>` resolved `site_shortname` to "Retro" while the recovery form
 * two nodes away interpolated it as `""`, giving the visible heading
 * "Forgotten Your  Name?" (double space, measured code point by code point).
 *
 * Rather than chase that one interpolation, this gives a page a single source for
 * its settings — the shape the legacy templates actually had. A consumer reads
 * `usePageSettings()`, which falls back to its own query only when there is no
 * provider above it, so existing call sites keep working outside a provider.
 *
 * `SiteSettingsProvider` also renders nothing itself: it is a data boundary, and
 * the page keeps owning its markup.
 */
const SiteSettingsContext = createContext<Record<string, string> | null>(null);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const { data } = useSettings();
  // `?? {}` defensively: the API always sends `settings`, but a consumer must
  // never be handed `undefined` and then index into it.
  const settings = data?.settings ?? {};

  return (
    <SiteSettingsContext.Provider value={settings}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

/**
 * The page's settings, from the provider when there is one.
 *
 * Outside a provider this performs its own query, which is what the components
 * did before this module existed — so a shell that wraps only part of a page
 * still behaves.
 */
export function usePageSettings(): Record<string, string> {
  const fromProvider = useContext(SiteSettingsContext);
  const { data } = useSettings();
  return fromProvider ?? data?.settings ?? {};
}

/** `SHORTNAME` — the `site_shortname` setting, as the legacy templates used it. */
export function useSiteShortname(): string {
  return usePageSettings()['site_shortname'] ?? '';
}
