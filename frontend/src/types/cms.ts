/**
 * Plan v3's typed website contracts — **types only, imported by nothing yet.**
 *
 * Plan v3 ("Modular CMS expansion") asks for the presentation, navigation,
 * translation and theme contracts to be defined *before* any route changes, so
 * that the units which follow implement a shape instead of inventing one. This
 * module is that definition and nothing else: it declares no request, renders
 * nothing and is not wired into the router. `docs/modular-cms-contracts.md`
 * carries the reasoning, the ownership map and the capability matrix.
 *
 * Three properties are deliberate and each is a rule from the plan:
 *
 * 1. **No contract names a table.** A block references content by id and lets a
 *    service method resolve it, so no new block type can become a generic table
 *    write (plan rules 3–4).
 * 2. **No contract carries markup or script.** Typed props only; the plan
 *    forbids arbitrary JavaScript and unsafe HTML in operator-editable fields,
 *    and an allow-listed block registry is how that is enforced rather than
 *    promised.
 * 3. **Theme is website state.** `ThemeId` is a closed set of website-owned
 *    values and cannot select an emulator or a client: v3 keeps the website theme
 *    and the game profile on separate axes, and this type is where that is true
 *    by construction.
 */

/** A published revision number. Every editable document carries one. */
export type CmsRevision = number;

/** Who may see a navigation item or a page slot. */
export type RoleVisibility = 'everyone' | 'guest' | 'user' | 'staff';

/**
 * Where a navigation item points.
 *
 * `route` must be a path the router already serves, and `external` must be
 * `https:` — the two rules the plan states for operator-editable destinations.
 * There is deliberately no `html` or `script` variant.
 */
export type NavigationTarget =
  | { kind: 'route'; path: string }
  | { kind: 'external'; url: string }
  /** A label with no destination, rendered as text rather than as a dead link. */
  | { kind: 'none' };

export interface NavigationItem {
  /** Stable key; also the translation key for the label. */
  key: string;
  /** Literal label, used only when no translation exists for `key`. */
  label: string;
  target: NavigationTarget;
  visibility: RoleVisibility;
  /** Ascending; ties are broken by `key` so ordering is deterministic. */
  order: number;
  /** Optional badge text, translated the same way as the label. */
  badgeKey?: string;
}

export interface NavigationDocument {
  revision: CmsRevision;
  items: NavigationItem[];
}

/** The closed set of public themes. Adding one is a code change, by design. */
export type ThemeId = 'legacy' | 'modern';

export interface ThemeDescriptor {
  /** v3's two themes: the legacy PHPRetro look and the Chocolatey-inspired one. */
  id: ThemeId;
  revision: CmsRevision;
  /** Published at this time (epoch seconds), for the audit trail. */
  publishedAt: number;
}

/** Locales the site ships. `en` is the fallback for a missing key. */
export type LocaleCode = 'en' | 'nl';

export interface TranslationCatalog {
  locale: LocaleCode;
  revision: CmsRevision;
  /** Keyed copy. Every value is plain text: no markup, no script. */
  entries: Record<string, string>;
}

/**
 * The allow-listed block registry.
 *
 * A discriminated union rather than `{ type: string; props: unknown }`: a new
 * block type is a deliberate addition here with its own props, and the server can
 * validate against the same closed set.
 */
export type TypedBlock =
  | { type: 'heading'; textKey: string; level: 2 | 3 }
  | { type: 'richText'; textKey: string }
  | { type: 'newsList'; limit: number; source: 'phpretro_news' | 'hotelview_news' }
  | { type: 'bannerSlot'; bannerId: number }
  | { type: 'campaignSlot'; campaignId: number }
  | { type: 'faqList'; category?: string }
  | { type: 'collectables' }
  | { type: 'homePromo'; userId?: number };

/** One ordered position in a page. */
export interface PageSlot {
  /** Stable key, so a slot can be reordered or hidden without losing identity. */
  key: string;
  block: TypedBlock;
  visibility: RoleVisibility;
  order: number;
}

export interface PageDocument {
  /** The route this document describes, e.g. `/community`. */
  path: string;
  revision: CmsRevision;
  slots: PageSlot[];
}

/**
 * The publish lifecycle every editable document above shares.
 *
 * Draft → published → rolled back, with the revision a client read, so two
 * operators editing one document cannot silently overwrite each other — the same
 * rule the MyHabbo layout API already enforces.
 */
export interface DraftState<T> {
  draft: T;
  /** The published revision the draft was based on. */
  basedOn: CmsRevision;
  updatedAt: number;
  updatedBy: number;
}

export interface PublishRequest {
  /** The revision the editor read. A stale value is refused, never applied. */
  basedOn: CmsRevision;
}

export interface PublishResult<T> {
  published: T;
  revision: CmsRevision;
}
