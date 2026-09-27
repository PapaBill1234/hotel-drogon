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
import { Link, useLocation, useNavigate } from 'react-router-dom';

import CommunityShell from '../components/CommunityShell';
import { Cbb } from '../components/Rounder';
import { useMe } from '../hooks/useAccount';
import {
  placementsForMove,
  useAddHomeWidget,
  useCloseHomeEditSession,
  useHomeLayout,
  useOpenHomeEditSession,
  useRemoveHomeWidget,
  useSaveHomeLayout,
} from '../hooks/useHomes';
import { placementForPixels } from '../services/apiHomes';
import { ApiRequestError } from '../services/api';
import type { HomeLayout, HomeWidget, UserWidgetKey } from '../types/homes';
import { REQUIRED_WIDGET_KEY, USER_WIDGET_KEYS, widgetClass, widgetTitle } from '../types/homes';

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
 * One draggable widget box — `home-widget.php`'s markup.
 *
 * The element ids are legacy's (`widget-<id>`, `widget-<id>-handle`,
 * `widget-<id>-edit`) because the legacy stylesheets and the legacy editor's
 * JavaScript both key off them; the `-edit` icon is only rendered in edit mode,
 * exactly as the PHP did.
 */
function WidgetBox({
  widget,
  ownerName,
  editing,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
}: {
  widget: HomeWidget;
  ownerName: string;
  editing: boolean;
  drag: WidgetDrag | null;
  onDragStart: (event: React.PointerEvent<HTMLElement>, widget: HomeWidget) => void;
  onDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
  onRemove: (widget: HomeWidget) => void;
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
              <span className="header-middle">{widgetTitle(widget.widget_key)}</span>
              <span className="header-right">&nbsp;</span>
            </h3>
          </div>
        </div>
        <div className="widget-body">
          <div className="widget-content">
            {widget.widget_key === 'profilewidget' ? (
              <div className="profile-info">
                <div className="name" style={{ float: 'left' }}>
                  {/* `home-widget.php` echoed the owner's username here. It is
                      the one field of that template this payload already
                      carries; the figure, motto and created-on line are not in
                      the layout contract and are not invented. */}
                  <span className="name-text" data-testid="home-owner-name">
                    {ownerName}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="home-widget-pending" data-testid="widget-content-pending">
              This widget&rsquo;s contents are not converted yet: the legacy body was
              rendered by <code>includes/habblet-templates/home-widget.php</code>, which
              is the next slice of this phase. The box itself is real, and so is its
              position.
            </p>
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
  const location = useLocation();
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
  const userId = parseHomeUserId(location.pathname);
  const navigate = useNavigate();
  const me = useMe();
  const layoutQuery = useHomeLayout(userId);
  const layout = layoutQuery.data;

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
                            ownerName={layout.home.username}
                            editing
                            drag={drag}
                            onDragStart={handleDragStart}
                            onDragMove={handleDragMove}
                            onDragEnd={handleDragEnd}
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
                          ownerName={layout.home.username}
                          editing={false}
                          drag={null}
                          onDragStart={handleDragStart}
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
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
  ownerName,
  editing,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
}: {
  widgets: HomeWidget[];
  ownerName: string;
  editing: boolean;
  drag: WidgetDrag | null;
  onDragStart: (event: React.PointerEvent<HTMLElement>, widget: HomeWidget) => void;
  onDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
  onRemove: (widget: HomeWidget) => void;
}) {
  return (
    <div id="playground" data-testid="home-playground">
      {widgets.map((widget) => (
        <WidgetBox
          key={widget.id}
          widget={widget}
          ownerName={ownerName}
          editing={editing}
          drag={drag}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
