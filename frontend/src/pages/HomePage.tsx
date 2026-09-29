/**
 * `/home/:userId` and `/home/:userId/edit` — `home.php`, ported.
 *
 * ## Why two routes rather than one page with a mode flag
 *
 * Legacy entered edit mode through a *different URL*: `home.php` rendered the
 * view, and the Edit button went to `PATH/myhabbo/startSession/<id>` (the
 * `.htaccess` rule turns that into `habblet/myhabbo_homes?id=<id>&type=startSession`),
 * which set `$_SESSION['page_edit'] = 'home'` and sent the browser back to the
 * home page — now rendered in edit mode. Two routes keep that shape, and they
 * also carry the one thing the legacy page could not: `home.php` set
 * `$page['bodyid']` to `viewmode` or `editmode`, and the legacy stylesheets size
 * the playground from `body#editmode`. A body id is a per-URL fact here, which is
 * what `BODY_BY_PATH` in `App.tsx` already models.
 *
 * ## What this renders, and what it deliberately does not
 *
 * The **layout** is real: the widget boxes, their columns, their positions, the
 * page background, adding and removing boxes, and the versioned save with the
 * Redis edit session behind it. The classes and ids are the legacy ones
 * (`#mypage-wrapper.cbb.blue`, `#mypage-content`, `#mypage-bg`, `#playground`,
 * `.movable.widget.<Class>`), so the legacy stylesheets serve the appearance.
 *
 * The **content inside each box** is not ported yet —
 * `includes/habblet-templates/home-widget.php` renders it, and that is the next
 * slice in this phase. Each box says so in its own body rather than showing an
 * empty frame, because an empty frame is indistinguishable from a widget that
 * failed to load. The profile box shows the owner's name, which the layout
 * payload already carries; it does not fabricate a figure or a motto the API
 * does not return.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRouteParam } from '../hooks/useRouteParam';

import CommunityShell from '../components/CommunityShell';
import { Cbb } from '../components/Rounder';
import { usePageSettings } from '../components/SiteSettings';
import { useMe } from '../hooks/useAccount';
import {
  placementsForMove,
  useAddHomeWidget,
  useCloseHomeEditSession,
  useHomeGuestbook,
  useHomeLayout,
  useHomeRating,
  useOpenHomeEditSession,
  useRateHome,
  useRemoveHomeWidget,
  useSaveHomeLayout,
} from '../hooks/useHomes';
import { placementForPixels } from '../services/apiHomes';
import { ApiRequestError } from '../services/api';
import type { HomeGuestbookEntry, HomeLayout, HomeOwner, HomeRatingSummary, HomeWidget, UserWidgetKey } from '../types/homes';
import {
  REQUIRED_WIDGET_KEY,
  USER_WIDGET_KEYS,
  WIDGET_EMPTY_COPY,
  widgetClass,
  widgetTitle,
} from '../types/homes';

/**
 * A widget being dragged, in the coordinates the drag started at.
 *
 * The drag is implemented directly on pointer events rather than with dnd-kit.
 * dnd-kit is what the plan names for this canvas and it was installed first, but
 * `@dnd-kit/core@6.3.1` throws `TypeError: e.reduce is not a function` from
 * inside its own `DndContext` render in this bundle, which blanks the editor
 * (`#root` renders empty). That is recorded in `docs/ai-run-state.md` as an open
 * defect with the error and the versions; a canvas that renders nothing is not a
 * canvas, and this keeps the editor working while the library question is
 * answered separately.
 *
 * The semantics are the ones the model already had: the handle captures the
 * pointer, the box follows it live, and on release the pixel position is turned
 * into a slot with `saveWidgetCoords()`'s rule (`placementForPixels`).
 */
interface WidgetDrag {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

/**
 * The avatar URL, built the way `classes.php`'s `avatarURL($figure, $style)` did.
 *
 * `home-widget.php` called it as `avatarURL($owner['look'], 'b,4,4,,1,0')`, which
 * expands to `?figure=<look>&size=b&direction=4&head_direction=4&crr=0&gesture=&frame=1`
 * (the empty third field is the gesture, and the fifth is the frame). The host is
 * the external Habbo imaging service the legacy site used, exactly as on `/me`:
 * it is a plain URL rather than a data dependency, and the image is decorative.
 */
function avatarUrl(look: string, size: 'b' | 's' = 'b'): string {
  return (
    'https://www.habbo.com/habbo-imaging/avatarimage' +
    `?figure=${encodeURIComponent(look)}&size=${size}&direction=4&head_direction=4&crr=0&gesture=&frame=1`
  );
}

/**
 * `date('d-m-Y', $account_created)`.
 *
 * Built from the epoch rather than through `toLocaleDateString`, because the
 * legacy format is day-month-year with dashes and a locale call would produce
 * slashes and follow the *browser's* locale. UTC is this stack's server
 * timezone, so the rendered day matches what the PHP would have printed.
 */
function legacyDate(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const date = new Date(epochSeconds * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

/** Legacy guestbook `date('M j, Y g:i:s A')`, using the documented UTC server timezone. */
function legacyGuestbookDate(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const date = new Date(epochSeconds * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour = date.getUTCHours();
  const hour12 = hour % 12 || 12;
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${hour12}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** A box whose data could not be read — the reason, not an empty list. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <p className="home-widget-unavailable" data-testid="widget-unavailable">
      {reason}
    </p>
  );
}

function RatingBody({ widgetId, summary, vote }: { widgetId: number; summary?: HomeRatingSummary; vote: ReturnType<typeof useRateHome> }) {
  if (!summary) return <p data-testid="rating-loading">Loading rating…</p>;
  const canVote = !summary.owner && !summary.mine;
  return (
    <div id="rating-main" data-testid="home-rating">
      <div className="rating-average">
        <b>{canVote ? 'Click on the stars to cast your vote!' : `Average rating: ${summary.average}`}</b>
        <div className="rating-stars">
          <ul className="rating-unit-rating" aria-label="Rate this home">
            <li className="rating-current-rating" style={{ width: `${summary.px}px` }} />
            {canVote ? [1, 2, 3, 4, 5].map((rating) => (
              <li key={rating}>
                <button type="button" className={`r${rating}-unit rater`} aria-label={`${rating} star${rating === 1 ? '' : 's'}`} disabled={vote.isPending} onClick={() => vote.mutate({ widgetId, rating })} data-testid={`home-rating-${rating}`}>{rating}</button>
              </li>
            )) : null}
          </ul>
        </div>
        <span data-testid="home-rating-total">{summary.total} votes total</span><br />
        ({summary.high} users voted 4 or better)
        {summary.mine ? <p data-testid="home-rating-voted">You have already voted.</p> : null}
        {summary.owner ? <p data-testid="home-rating-owner">You cannot vote for yourself.</p> : null}
        {vote.isError ? <p role="alert" data-testid="home-rating-error">{vote.error instanceof ApiRequestError ? vote.error.message : 'The vote could not be saved.'}</p> : null}
      </div>
    </div>
  );
}

/**
 * The contents of one widget box — `includes/habblet-templates/home-widget.php`.
 *
 * Each branch follows the template's own markup and copy. Two things in there
 * are deliberately not reproduced, and both are recorded in the inventory rather
 * than hidden:
 *
 *   - **The badge sprite URL.** The template built it from `site_c_images_path`
 *     and `site_badges_path`, and this fixture has neither setting, so legacy
 *     rendered `url(.gif)` — an invisible badge. Where the paths are set the
 *     sprite is rendered exactly as legacy did; where they are not, the badge
 *     code is rendered as text, because a broken image is a control that appears
 *     to work and does not.
 *   - **The friends list.** The count is real (`friendCount()`), and the search
 *     box and avatar list belong to Phase 6. The box states that instead of
 *     rendering an input that would do nothing.
 */
function WidgetBody({
  widget,
  owner,
  settings,
  guestbook,
  rating,
  vote,
}: {
  widget: HomeWidget;
  owner: HomeOwner;
  settings: Record<string, string>;
  guestbook?: { entries: HomeGuestbookEntry[]; loading: boolean; error?: string };
  rating?: HomeRatingSummary;
  vote: ReturnType<typeof useRateHome>;
}) {
  const data = widget.data;
  const shortname = settings['site_shortname'] ?? '';
  // The badge sprite is a background image built from two settings, and this
  // fixture has neither, so legacy rendered `url(.gif)` — see the component doc.
  const badgePathsSet =
    Boolean(settings['site_c_images_path']) && Boolean(settings['site_badges_path']);

  if (widget.widget_key === 'profilewidget') {
    const online = owner.hide_online === '1' ? false : owner.online === '1';
    return (
      <div className="profile-info" data-testid="widget-body-profile">
        <div className="name" style={{ float: 'left' }}>
          <span className="name-text" data-testid="home-owner-name">
            {owner.username}
          </span>
        </div>
        <br className="clear" />
        <img
          alt={online ? 'online' : 'offline'}
          data-testid="profile-online"
          data-online={online ? 'true' : 'false'}
          src={`/web-gallery/images/myhabbo/profile/habbo_${online ? 'online_anim' : 'offline'}.gif`}
        />
        <div className="birthday text">{shortname} Created On:</div>
        <div className="birthday date" data-testid="profile-created">
          {legacyDate(owner.account_created)}
        </div>
        <div className="profile-figure">
          <img alt={owner.username} src={avatarUrl(owner.look)} />
        </div>
        {owner.motto !== '' ? (
          <div className="profile-motto" data-testid="profile-motto">
            {owner.motto}
          </div>
        ) : null}
        <div id="profile-tags-container" data-testid="profile-tags">
          {!owner.settings_available ? (
            <Unavailable reason="This page's tags could not be read." />
          ) : owner.tags.length === 0 ? (
            WIDGET_EMPTY_COPY.tags
          ) : (
            owner.tags.map((tag) => (
              <span className="tag-search-rowholder" key={tag}>
                <a href={`/tag/${encodeURIComponent(tag)}`} className="tag">
                  {tag}
                </a>
              </span>
            ))
          )}
        </div>
      </div>
    );
  }

  if (widget.widget_key === 'highscoreswidget') {
    // The template renders this line unconditionally: there is no high-score
    // source anywhere in the legacy checkout, so the box has always been static.
    return (
      <table data-testid="widget-body-highscores">
        <tbody>
          <tr>
            <td>{WIDGET_EMPTY_COPY.highScores}</td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (data && !data.available) {
    return <Unavailable reason={data.unavailable_reason ?? 'This box could not be loaded.'} />;
  }

  if (widget.widget_key === 'badgeswidget') {
    const badges = data?.badges ?? [];
    if (badges.length === 0) return <p>{WIDGET_EMPTY_COPY.badges}</p>;
    return (
      <ul className="clearfix" data-testid="widget-body-badges">
        {badges.map((badge) =>
          badgePathsSet ? (
            <li
              key={badge.badge_code}
              style={{
                backgroundImage: `url(${settings['site_c_images_path']}${settings['site_badges_path']}${encodeURIComponent(badge.badge_code)}.gif)`,
              }}
            />
          ) : (
            <li key={badge.badge_code} className="badge-code" title="Badge image paths are not configured">
              {badge.badge_code}
            </li>
          ),
        )}
      </ul>
    );
  }

  if (widget.widget_key === 'groupswidget') {
    const groups = data?.groups ?? [];
    if (groups.length === 0) return <p>{WIDGET_EMPTY_COPY.groups}</p>;
    return (
      <ul className="groups-list" data-testid="widget-body-groups">
        {groups.map((group) => (
          // `phpretroGroupPath()`: `/groups/<alias>` when the group has one and
          // `/groups/<id>/id` otherwise. The alias table is Phase 7's, so the id
          // form is what this can build — and it is the same URL legacy fell back
          // to for a group with no alias.
          <li key={group.id}>
            <a href={`/groups/${group.id}/id`}>{group.name}</a>
          </li>
        ))}
      </ul>
    );
  }

  if (widget.widget_key === 'roomswidget') {
    const rooms = data?.rooms ?? [];
    if (rooms.length === 0) return <p>{WIDGET_EMPTY_COPY.rooms}</p>;
    return (
      <ul className="rooms-list" data-testid="widget-body-rooms">
        {rooms.map((room) => (
          <li key={room.id}>{room.name}</li>
        ))}
      </ul>
    );
  }

  if (widget.widget_key === 'ratingwidget') {
    return <RatingBody widgetId={widget.id} summary={rating} vote={vote} />;
  }

  if (widget.widget_key === 'friendswidget') {
    return (
      <p data-testid="widget-body-friends">
        {data?.friend_count_known
          ? `${data.friend_count} friend${data.friend_count === 1 ? '' : 's'}. The list and the search box are Phase 6.`
          : 'The friend count could not be read; the list and the search box are Phase 6.'}
      </p>
    );
  }

  if (widget.widget_key === 'guestbookwidget') {
    if (!guestbook || guestbook.loading) return <p data-testid="guestbook-loading">Loading guestbook…</p>;
    if (guestbook.error) return <Unavailable reason={guestbook.error} />;
    if (guestbook.entries.length === 0) return <p data-testid="guestbook-empty">This guestbook has no entries.</p>;
    return (
      <ul className="guestbook-entries" data-testid="guestbook-entries">
        {guestbook.entries.map((entry) => {
          const online = entry.online === '1';
          return (
            <li className="guestbook-entry" id={`guestbook-entry-${entry.id}`} key={entry.id}>
              <div className="guestbook-author">
                <img alt={entry.username} src={avatarUrl(entry.look, 's')} />
              </div>
              <div className="guestbook-message">
                <div className={online ? 'online' : 'offline'}>
                  <a href={`/home/${entry.author_user_id}`}>{entry.username}</a>
                </div>
                {/* Legacy applies BBCode here; this read-only slice deliberately preserves raw text. */}
                <p>{entry.message}</p>
              </div>
              <div className="guestbook-cleaner">&nbsp;</div>
              <div className="guestbook-entry-footer metadata">
                {legacyGuestbookDate(entry.created_at)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <p className="home-widget-pending" data-testid="widget-content-pending">
      This widget’s contents are not converted yet.
    </p>
  );
}

/**
 * One draggable widget box — `home-widget.php`'s markup.
 *
 * The element ids are legacy's (`widget-<id>`, `widget-<id>-handle`,
 * `widget-<id>-edit`) because the legacy stylesheets and the legacy editor's
 * JavaScript both key off them; the `-edit` icon is only rendered in edit mode,
 * exactly as the PHP did.
 */
function WidgetBox({
  widget,
  owner,
  settings,
  guestbook,
  editing,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
  rating,
  vote,
}: {
  widget: HomeWidget;
  owner: HomeOwner;
  settings: Record<string, string>;
  guestbook?: { entries: HomeGuestbookEntry[]; loading: boolean; error?: string };
  editing: boolean;
  drag: WidgetDrag | null;
  onDragStart: (event: React.PointerEvent<HTMLElement>, widget: HomeWidget) => void;
  onDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
  onRemove: (widget: HomeWidget) => void;
  rating?: HomeRatingSummary;
  vote: ReturnType<typeof useRateHome>;
}) {
  const active = drag?.id === widget.id;

  const style: React.CSSProperties = {
    left: `${widget.left}px`,
    top: `${widget.top}px`,
    zIndex: active ? 999 : widget.z_index,
    transform: active ? `translate3d(${drag.dx}px, ${drag.dy}px, 0)` : undefined,
  };

  const removable = editing && widget.widget_key !== REQUIRED_WIDGET_KEY;

  return (
    <div
      className={`movable widget ${widgetClass(widget.widget_key)}`}
      id={`widget-${widget.id}`}
      style={style}
      data-testid={`home-widget-${widget.widget_key}`}
      data-widget-id={widget.id}
      data-column={widget.column}
      data-position={widget.position}
    >
      <div className="w_skin_defaultskin">
        {/* The handle is the drag surface: `widget-corner` is what the legacy
            editor bound its drag handler to (`myhabbo-store.js`). */}
        <div
          className="widget-corner"
          id={`widget-${widget.id}-handle`}
          style={editing ? { touchAction: 'none' } : undefined}
          onPointerDown={(event) => editing && onDragStart(event, widget)}
          onPointerMove={(event) => editing && onDragMove(event)}
          onPointerUp={(event) => editing && onDragEnd(event)}
          onPointerCancel={(event) => editing && onDragEnd(event)}
        >
          <div className="widget-headline">
            <h3>
              {editing ? (
                <img
                  src="/web-gallery/images/myhabbo/icon_edit.gif"
                  width="19"
                  height="18"
                  className="edit-button"
                  id={`widget-${widget.id}-edit`}
                  alt=""
                />
              ) : null}
              <span className="header-left">&nbsp;</span>
              <span className="header-middle">
                {widgetTitle(widget.widget_key, widget.data?.friend_count_known ? widget.data.friend_count : undefined)}
              </span>
              <span className="header-right">&nbsp;</span>
            </h3>
          </div>
        </div>
        <div className="widget-body">
          <div className="widget-content">
            <WidgetBody widget={widget} owner={owner} settings={settings} guestbook={guestbook} rating={rating} vote={vote} />
            {removable ? (
              <button
                type="button"
                className="new-button"
                onClick={() => onRemove(widget)}
                data-testid={`remove-widget-${widget.widget_key}`}
              >
                Remove
              </button>
            ) : null}
            <div className="clear"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The editor's widget palette — the keys legacy's `USER_WIDGETS` allows. */
function WidgetPalette({
  layout,
  onAdd,
  busy,
}: {
  layout: HomeLayout;
  onAdd: (key: UserWidgetKey, column: number) => void;
  busy: boolean;
}) {
  const placed = new Set(layout.widgets.map((widget) => widget.widget_key));
  const available = USER_WIDGET_KEYS.filter((key) => !placed.has(key));
  if (available.length === 0) {
    return <p data-testid="widget-palette-empty">Every widget is already on the page.</p>;
  }
  return (
    <ul className="home-widget-palette" data-testid="widget-palette">
      {available.map((key) => (
        <li key={key}>
          <button
            type="button"
            className="new-button"
            disabled={busy}
            onClick={() => onAdd(key, 1)}
            data-testid={`add-widget-${key}`}
          >
            Add {widgetTitle(key)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The home id in a URL, or 0 when the path is not one of this page's.
 *
 * The three routes are `/home/:userId`, `/home/:userId/edit` and the legacy
 * alias `/myhabbo/startSession/:userId` (`.htaccess`'s
 * `^myhabbo/startSession/(.*)$`), so the id is the segment after `home` or
 * `startSession` in every case.
 */
export function parseHomeUserId(pathname: string): number {
  const match = /^\/(?:home|myhabbo\/startSession)\/(\d+)(?:\/|$)/.exec(pathname);
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export default function HomePage({ mode }: { mode: 'view' | 'edit' }) {
  const userIdParam = useRouteParam('userId', /^\/(?:home|myhabbo\/startSession)\/(\d+)/);
  /**
   * The id comes from the path, not from `useParams()`.
   *
   * `useParams()` was tried first and returned the route's compiled **param
   * descriptor** rather than the matched value — `{paramName: "userId",
   * isOptional: false}` — instead of `{userId: "2"}`, which is what
   * `react-router-dom@6.30.6`'s own `useParams` (`matches[last].params`) should
   * hand back. That is recorded in `docs/ai-run-state.md` as an open defect
   * rather than worked around silently: it would affect every dynamic route in
   * the app, `/articles/:id` and `/help/:id` included.
   *
   * Reading the path is deterministic here — this page is URL-driven, all three
   * of its routes put the id in the same position, and the parser is the same
   * one the routes are written with — so the page does not depend on that
   * question being answered before it can work.
   */
  const userId = userIdParam ? Number(userIdParam) : 0;
  const navigate = useNavigate();
  const me = useMe();
  const layoutQuery = useHomeLayout(userId);
  const ratingQuery = useHomeRating(userId);
  const voteRating = useRateHome(userId);
  const layout = layoutQuery.data;
  const guestbookQuery = useHomeGuestbook(userId, Boolean(layout));
  // `SHORTNAME` and the badge sprite paths come from the same settings the
  // legacy templates read through `$settings->find()` — one page, one source.
  const settings = usePageSettings();

  const [lockToken, setLockToken] = useState('');
  const [lockError, setLockError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [conflictNotice, setConflictNotice] = useState('');
  const [drag, setDrag] = useState<WidgetDrag | null>(null);
  /** The live drag, read by the handlers so a move is never gated on a render. */
  const dragRef = useRef<WidgetDrag | null>(null);
  const layoutRef = useRef<HomeLayout | undefined>(undefined);
  layoutRef.current = layout;

  const openSession = useOpenHomeEditSession(userId);
  const closeSession = useCloseHomeEditSession(userId);
  const saveLayout = useSaveHomeLayout(userId);
  const addWidget = useAddHomeWidget(userId);
  const removeWidget = useRemoveHomeWidget(userId);

  const editing = mode === 'edit';

  // Entering edit mode opens the lease. Legacy did this on the startSession URL
  // and kept the flag in the session; here it is a Redis record with a TTL, so
  // the editor has to hold the token it was given.
  useEffect(() => {
    if (!editing || !layout?.home.editable) return;
    let cancelled = false;
    openSession.mutate(undefined, {
      onSuccess: (session) => {
        if (!cancelled) {
          setLockToken(session.token);
          setLockError('');
        }
      },
      onError: (error) => {
        if (cancelled) return;
        setLockError(
          error instanceof ApiRequestError
            ? error.message
            : 'The page could not be locked for editing.',
        );
      },
    });
    return () => {
      cancelled = true;
    };
    // `layout?.home.editable` is the only value that changes the answer; the
    // mutation objects are stable per render and must not re-open the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, layout?.home.editable, userId]);

  // Leaving the editor releases the lease, so a second editor is not locked out
  // by a tab the user has already left. `closeSession` is deliberately not in the
  // dependency list: it is a new object every render and re-running this would
  // release a lock that was just acquired.
  useEffect(() => {
    if (!editing || !lockToken) return;
    const token = lockToken;
    return () => {
      void closeSession.mutateAsync(token).catch(() => {
        // Releasing is best effort: the lease expires on its own, and the version
        // compare-and-swap is what keeps the layout correct either way.
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, lockToken]);

  const version = layout?.home.version ?? 0;

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>, widget: HomeWidget) => {
      // Capture the pointer so the drag keeps receiving moves even when it
      // travels outside the handle — the box under the cursor changes, the
      // element that started the drag does not.
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      const next: WidgetDrag = {
        id: widget.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dx: 0,
        dy: 0,
      };
      // The ref is what the handlers read: a move that arrives before React has
      // re-rendered must not be dropped just because the rendered `drag` prop is
      // still null. The state exists only to redraw the box.
      dragRef.current = next;
      setDrag(next);
    },
    [],
  );

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next: WidgetDrag = {
      ...current,
      dx: event.clientX - current.startX,
      dy: event.clientY - current.startY,
    };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const handleDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      const currentLayout = layoutRef.current;
      if (!current || !currentLayout || current.pointerId !== event.pointerId) return;

      const widget = currentLayout.widgets.find((candidate) => candidate.id === current.id);
      if (!widget || (current.dx === 0 && current.dy === 0)) return;

      // `widgetStyle()` put the box at (left, top); the drag moved it by delta.
      // `placementForPixels` is then `saveWidgetCoords()`'s rule, unchanged.
      const { column, position } = placementForPixels(
        widget.left + current.dx,
        widget.top + current.dy,
      );
      const placements = placementsForMove(currentLayout, widget.id, column, position);
      if (placements.length === 0) return;

      setSaveMessage('');
      setConflictNotice('');
      saveLayout.mutate(
        { version: currentLayout.home.version, lockToken, placements },
        {
          onSuccess: () => setSaveMessage('Saved.'),
          onError: (error) => {
            const payload = error instanceof ApiRequestError ? error.payload : undefined;
            if (
              payload &&
              typeof payload === 'object' &&
              (payload as { status?: number }).status === 409
            ) {
              // The cache has already been rolled back to the server's layout by
              // the hook; say so, and say which version won.
              const serverVersion = (payload as { current_version?: number }).current_version;
              setConflictNotice(
                `Somebody else saved this page while you were moving that box. ` +
                  `Your move was not applied; the page is now at version ${serverVersion}.`,
              );
              return;
            }
            if (error instanceof ApiRequestError && error.status === 423) {
              setLockError(error.message);
              return;
            }
            setSaveMessage(
              error instanceof ApiRequestError ? error.message : 'The move could not be saved.',
            );
          },
        },
      );
    },
    // Reads the ref, not the rendered `drag` value: pointerup carries no delta of
    // its own, and the final move may not have re-rendered yet.
    [lockToken, saveLayout],
  );

  const widgetList = useMemo(() => layout?.widgets ?? [], [layout]);

  if (!Number.isFinite(userId) || userId <= 0) {
    return (
      <CommunityShell pageId="home" cat="home" pageName="Home">
        <div id="container">
          <div id="content" className="clearfix">
            <div id="column1" className="column">
              <div className="habblet-container">
                <Cbb className="cbb clearfix default">
                  <h2 className="title">Page not found</h2>
                  <div className="box-content">
                    <p data-testid="home-invalid">That is not a valid home id.</p>
                  </div>
                </Cbb>
              </div>
            </div>
          </div>
        </div>
      </CommunityShell>
    );
  }

  const shellProps = {
    pageId: 'home' as const,
    cat: 'home' as const,
    pageName: layout?.home.username ?? 'Home',
    signedInAs: me.data?.user.username,
    signedInRank: me.data?.user.rank,
  };

  if (layoutQuery.isLoading) {
    return (
      <CommunityShell {...shellProps}>
        <div id="container">
          <div id="content" className="clearfix">
            <div className="habblet-container">
              <p data-testid="home-loading">Loading the page…</p>
            </div>
          </div>
        </div>
      </CommunityShell>
    );
  }

  if (layoutQuery.isError || !layout) {
    const message =
      layoutQuery.error instanceof ApiRequestError
        ? layoutQuery.error.message
        : 'The page could not be loaded.';
    return (
      <CommunityShell {...shellProps}>
        <div id="container">
          <div id="content" className="clearfix">
            <div className="habblet-container">
              <Cbb className="cbb clearfix default">
                <h2 className="title">Page not found</h2>
                <div className="box-content">
                  <p data-testid="home-error">{message}</p>
                </div>
              </Cbb>
            </div>
          </div>
        </div>
      </CommunityShell>
    );
  }

  return (
    <CommunityShell {...shellProps}>
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container">
              <Cbb className="cbb clearfix blue">
                <div id="mypage-wrapper">
                  <div className="box-tabs-container box-tabs-left clearfix">
                    {!editing && layout.home.editable ? (
                      <Link
                        to={`/home/${userId}/edit`}
                        id="edit-button"
                        className="new-button dark-button edit-icon"
                        style={{ float: 'left' }}
                        data-testid="home-edit-button"
                      >
                        <b>
                          <span></span>Edit
                        </b>
                        <i></i>
                      </Link>
                    ) : null}
                    <h2 className="page-owner" data-testid="home-owner">
                      {layout.home.username}
                    </h2>
                    <ul className="box-tabs"></ul>
                  </div>
                  <div id="mypage-content">
                    {editing ? (
                      <div id="top-toolbar" className="clearfix">
                        <ul>
                          <li>
                            <span data-testid="home-editing-notice">
                              Editing — drag a box by its title bar.
                            </span>
                          </li>
                        </ul>
                        <form action="#" method="get" style={{ width: '50%' }}>
                          <button
                            type="button"
                            id="cancel-button"
                            className="new-button red-button cancel-icon"
                            onClick={() => {
                              void closeSession.mutateAsync(lockToken).catch(() => {});
                              setLockToken('');
                              navigate(`/home/${userId}`);
                            }}
                            data-testid="home-cancel-button"
                          >
                            <b>
                              <span></span>Cancel
                            </b>
                            <i></i>
                          </button>
                        </form>
                      </div>
                    ) : null}

                    {lockError ? (
                      <p className="home-lock-error" data-testid="home-lock-error">
                        {lockError}
                      </p>
                    ) : null}
                    {conflictNotice ? (
                      <p className="home-conflict" data-testid="home-conflict">
                        {conflictNotice}
                      </p>
                    ) : null}
                    {saveMessage ? (
                      <p className="home-save-message" data-testid="home-save-message">
                        {saveMessage}
                      </p>
                    ) : null}
                    {editing ? (
                      <p className="home-version" data-testid="home-version">
                        Version {version}
                      </p>
                    ) : null}

                    {/* `#mypage-bg` carries `backgroundClass()`; the legacy
                        stylesheets paint the page floor from it. */}
                    <div id="mypage-bg" className={layout.home.background}>
                      {editing ? (
                        <div id="playground-outer">
                          <Playground
                            widgets={widgetList}
                            owner={layout.home.owner}
                            settings={settings}
                            guestbook={{ entries: guestbookQuery.data ?? [], loading: guestbookQuery.isLoading, error: guestbookQuery.error instanceof ApiRequestError ? guestbookQuery.error.message : guestbookQuery.error ? 'The guestbook could not be loaded.' : undefined }}
                            editing
                            drag={drag}
                            onDragStart={handleDragStart}
                            onDragMove={handleDragMove}
                            onDragEnd={handleDragEnd}
                            rating={ratingQuery.data}
                            vote={voteRating}
                            onRemove={(widget) =>
                              removeWidget.mutate(widget.id, {
                                onError: (error) =>
                                  setSaveMessage(
                                    error instanceof ApiRequestError
                                      ? error.message
                                      : 'The widget could not be removed.',
                                  ),
                              })
                            }
                          />
                        </div>
                      ) : (
                        <Playground
                          widgets={widgetList}
                          owner={layout.home.owner}
                          settings={settings}
                          guestbook={{ entries: guestbookQuery.data ?? [], loading: guestbookQuery.isLoading, error: guestbookQuery.error instanceof ApiRequestError ? guestbookQuery.error.message : guestbookQuery.error ? 'The guestbook could not be loaded.' : undefined }}
                          editing={false}
                          drag={null}
                          onDragStart={handleDragStart}
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
                           rating={ratingQuery.data}
                           vote={voteRating}
                          onRemove={() => {}}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </Cbb>

              {editing ? (
                <div className="habblet-container" data-testid="home-editor-tools">
                  <Cbb className="cbb clearfix default">
                    <h2 className="title">Widgets</h2>
                    <div className="box-content">
                      <WidgetPalette
                        layout={layout}
                        busy={addWidget.isPending}
                        onAdd={(key, column) =>
                          addWidget.mutate(
                            { widgetKey: key, column },
                            {
                              onError: (error) =>
                                setSaveMessage(
                                  error instanceof ApiRequestError
                                    ? error.message
                                    : 'The widget could not be added.',
                                ),
                            },
                          )
                        }
                      />
                    </div>
                  </Cbb>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}

/**
 * `#playground` — the canvas the boxes are absolutely positioned in.
 *
 * It renders `home.php`'s own element ids and nothing of its own: the boxes are
 * positioned by the inline geometry the API returned, so this component has no
 * layout opinion to get wrong.
 */
function Playground({
  widgets,
  owner,
  settings,
  guestbook,
  editing,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
  rating,
  vote,
}: {
  widgets: HomeWidget[];
  owner: HomeOwner;
  settings: Record<string, string>;
  guestbook?: { entries: HomeGuestbookEntry[]; loading: boolean; error?: string };
  editing: boolean;
  drag: WidgetDrag | null;
  onDragStart: (event: React.PointerEvent<HTMLElement>, widget: HomeWidget) => void;
  onDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
  onRemove: (widget: HomeWidget) => void;
  rating?: HomeRatingSummary;
  vote: ReturnType<typeof useRateHome>;
}) {
  return (
    <div id="playground" data-testid="home-playground">
      {widgets.map((widget) => (
        <WidgetBox
          key={widget.id}
          widget={widget}
          owner={owner}
          settings={settings}
          guestbook={guestbook}
          editing={editing}
          drag={drag}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onRemove={onRemove}
          rating={rating}
          vote={vote}
        />
      ))}
    </div>
  );
}
