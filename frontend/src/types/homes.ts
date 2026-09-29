/**
 * MyHabbo Homes — the shapes `/api/homes/*` actually returns.
 *
 * Read from `src/controllers/HomesController.cpp` and its `layoutJson`/`widgetJson`
 * helpers, and written down in `docs/homes-layout-api.md`; the legacy behaviour
 * behind them is `home.php` and `includes/PhpretroHomes.php` in the read-only
 * PHPRetro checkout.
 *
 * The pixel geometry (`left`, `top`, `z_index`) is **not** stored anywhere: the
 * server derives it from `column`/`position` with `widgetStyle()`'s arithmetic
 * and sends it, so the canvas has one source for where a box goes.
 */

/** `phpretro_myhabbo_layouts.privacy` — a guestbook's who-may-post rule. */
export type HomePrivacy = 'public' | 'private';

/**
 * One placed widget box.
 *
 * `id === 0` means the row does not exist: `displayLayouts()` synthesises a
 * profile widget for a home that has never been saved, and the write routes
 * refuse to place that id rather than reporting success and changing nothing.
 */
export interface HomeWidget {
  id: number;
  widget_key: string;
  column: number;
  position: number;
  left: number;
  top: number;
  z_index: number;
  visible: boolean;
  privacy: HomePrivacy;
  /** The box's contents. Absent only when the server could not read them. */
  data?: HomeWidgetData;
}

/** One placed sticker or note, or the page background (`placedItems()`). */
export interface HomeItem {
  id: number;
  type: 'sticker' | 'stickie' | 'background';
  skin: string;
  data: string;
  x: number;
  y: number;
  z: number;
  catalogue_data: string;
}

/**
 * The owner block — `PhpretroHomes::profile()`'s row.
 *
 * `tags` arrives already split and filtered the way
 * `array_values(array_filter(explode(';', $tags)))` did, so a trailing separator
 * cannot be interpreted two different ways by two clients.
 */
export interface HomeOwner {
  id: number;
  username: string;
  motto: string;
  look: string;
  account_created: number;
  last_online: number;
  /** PolarIS `enum('0','1','2')`, passed through as the string it is. */
  online: string;
  hide_online: string;
  tags: string[];
  /**
   * False when the `users_settings` half of the join could not be read at all.
   *
   * The tags area then says so instead of rendering "No tags." — a missing table
   * and a user with no tags look identical on screen, and only one is true.
   */
  settings_available: boolean;
}

/** One public, read-only personal Homes guestbook entry. */
export interface HomeGuestbookEntry {
  id: number;
  profile_user_id: number;
  author_user_id: number;
  message: string;
  created_at: number;
  username: string;
  look: string;
  /** PolarIS enum('0','1','2'), intentionally retained as a string. */
  online: string;
}

/**
 * What one widget box renders inside itself.
 *
 * `available: false` means the box's own data could not be read (most often a
 * development stack without that PolarIS table). The box renders the reason
 * rather than an empty list.
 */
export interface HomeWidgetData {
  available: boolean;
  unavailable_reason?: string;
  badges: Array<{ badge_code: string }>;
  groups: Array<{ id: number; name: string; badge: string; level_id: number }>;
  rooms: Array<{ id: number; name: string; description: string }>;
  friend_count: number;
  friend_count_known: boolean;
}

/**
 * The Redis edit lock, as one reader sees it.
 *
 * `token` is present only for the caller that holds the lock; a different reader
 * gets `is_mine: false` and no token, so a lock cannot be claimed from outside.
 */
export interface HomeLock {
  held: boolean;
  holder_user_id: number;
  expires_at: number;
  is_mine: boolean;
  token?: string;
}

export interface HomeSummary {
  user_id: number;
  username: string;
  /**
   * The optimistic-concurrency token. Every write echoes the version it read;
   * a write whose version is stale is refused with 409 and never applied.
   */
  version: number;
  updated_at: number;
  /** `backgroundClass()` — the class `#mypage-bg` carries. */
  background: string;
  default_layout: boolean;
  editable: boolean;
  lock: HomeLock;
  /** The owner block the profile box renders. */
  owner: HomeOwner;
}

export interface HomeLayout {
  status: string;
  home: HomeSummary;
  widgets: HomeWidget[];
  items: HomeItem[];
}

/** One requested placement in a layout write. */
export interface HomePlacement {
  id: number;
  column: number;
  position: number;
}

export interface HomeSaveRequest {
  version: number;
  lock_token: string;
  widgets: HomePlacement[];
  background_item_id?: number;
}

/**
 * The `409` body, which carries the server's own layout.
 *
 * That is what lets an optimistic move roll back to the truth without a second
 * request — and it is the reason a conflict is reported rather than retried.
 */
export interface HomeConflict {
  error: string;
  message: string;
  status: number;
  current_version: number;
  current: HomeLayout;
}

export function isHomeConflict(payload: unknown): payload is HomeConflict {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Partial<HomeConflict>;
  return (
    candidate.status === 409 &&
    typeof candidate.current_version === 'number' &&
    typeof candidate.current === 'object' &&
    candidate.current !== null
  );
}

/**
 * The server's slot bound (`HomesService::kMaxPosition`).
 *
 * Exported so the canvas clamps to the same number the API validates against,
 * instead of sending a position the server will reject.
 */
export const MAX_HOME_POSITION = 127;

/**
 * The widget keys a user home may hold, in the order the store lists them.
 *
 * `PhpretroHomes::USER_WIDGETS`. The Trax player is deliberately absent: it is
 * in `BLOCKED_WIDGETS` and the API answers 503 for it, because it is
 * emulator-bound (plan milestone 6).
 */
export const USER_WIDGET_KEYS = [
  'profilewidget',
  'guestbookwidget',
  'highscoreswidget',
  'badgeswidget',
  'friendswidget',
  'groupswidget',
  'roomswidget',
  'ratingwidget',
] as const;

export type UserWidgetKey = (typeof USER_WIDGET_KEYS)[number];

/**
 * The heading each widget box carries.
 *
 * Taken from `home-widget.php`'s `match ($key)` against the keys it loads, and
 * then read out of `includes/languages/en.php` — **not** from the `??` fallbacks
 * in that template. The file assigns several of these keys more than once and
 * the last assignment wins, which is why the effective strings are `MY PROFILE`,
 * `MY ROOMS` and `HIGH SCORES` rather than the template's own "My Profile",
 * "My Rooms" and "High Scores". A previous unit lost a round to exactly this
 * mistake on the `navi2` labels, so they are quoted from the file here.
 */
export const WIDGET_TITLES: Record<UserWidgetKey, string> = {
  profilewidget: 'MY PROFILE',
  guestbookwidget: 'My Guestbook',
  highscoreswidget: 'HIGH SCORES',
  badgeswidget: 'Badges & Achievements',
  friendswidget: 'My Friends',
  groupswidget: 'My Groups',
  roomswidget: 'MY ROOMS',
  ratingwidget: 'My Rating',
};

/**
 * The copy each box renders when it has nothing to show.
 *
 * `en.php` again: `no.badges`, `no.groups`, `no.rooms`, `no.high.scores`,
 * `no.tags`. `no.groups` and `no.rooms` are sentences, not labels, and the
 * template's fallbacks differ from all four.
 */
export const WIDGET_EMPTY_COPY = {
  badges: "You don't have any badges.",
  groups: 'You are not a member of any Groups',
  rooms: 'You do not have any rooms',
  highScores: 'You do not have any high scores.',
  tags: 'No tags.',
} as const;

/**
 * The class each widget box carries — `home-widget.php`'s `$class` match.
 *
 * The legacy stylesheets key the box's whole appearance off it, so it is not
 * cosmetic: a box with the wrong class renders as an unstyled div.
 */
export const WIDGET_CLASSES: Record<UserWidgetKey, string> = {
  profilewidget: 'ProfileWidget',
  guestbookwidget: 'GuestbookWidget',
  highscoreswidget: 'HighScoresWidget',
  badgeswidget: 'BadgesWidget',
  friendswidget: 'FriendsWidget',
  groupswidget: 'GroupsWidget',
  roomswidget: 'RoomsWidget',
  ratingwidget: 'RatingWidget',
};

export function isUserWidgetKey(key: string): key is UserWidgetKey {
  return (USER_WIDGET_KEYS as readonly string[]).includes(key);
}

/**
 * The heading for one box.
 *
 * `home-widget.php` built the friends heading as
 * `($lang->loc['my.friends']).' ('.$homes->friendCount(...).')'`, so the count is
 * part of the title and not of the body. `friendCount` is unknown when the count
 * query could not run, and the title then carries no number rather than a zero
 * that would be a claim about the user's friends.
 */
export function widgetTitle(key: string, friendCount?: number): string {
  if (key === 'friendswidget' && typeof friendCount === 'number') {
    return `${WIDGET_TITLES.friendswidget} (${friendCount})`;
  }
  return isUserWidgetKey(key) ? WIDGET_TITLES[key] : key;
}

export function widgetClass(key: string): string {
  return isUserWidgetKey(key) ? WIDGET_CLASSES[key] : 'ProfileWidget';
}

/** `PhpretroHomes::delete()`'s locked widget: a page keeps its profile box. */
export const REQUIRED_WIDGET_KEY: UserWidgetKey = 'profilewidget';
