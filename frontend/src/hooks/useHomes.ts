/**
 * Query and mutation hooks for one MyHabbo home.
 *
 * The layout is server state with an explicit version, so it is cached under
 * `['home', userId]` and every write replaces that cache with what the server
 * returned. Two behaviours here are the point of the slice, not decoration:
 *
 *   - a move is applied **optimistically**, so the box stays where the user put
 *     it while the request is in flight, and
 *   - a `409` rolls that move back to **the server's own layout**, which the
 *     conflict body carries. Re-fetching instead would be a second request that
 *     can itself race the writer the conflict is telling us about.
 *
 * The Redis edit session is separate state on purpose: it is a lease with a
 * lifetime, not part of the layout, and it must survive a save.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addHomeWidget,
  closeHomeEditSession,
  fetchHomeGuestbook,
  fetchHomeLayout,
  openHomeEditSession,
  removeHomeWidget,
  saveHomeLayout,
} from '../services/apiHomes';
import { ApiRequestError } from '../services/api';
import type { HomeLayout, HomePlacement, UserWidgetKey } from '../types/homes';
import { isHomeConflict } from '../types/homes';
import { geometryForSlot } from '../services/apiHomes';

export const homeKeys = {
  layout: (userId: number) => ['home', userId] as const,
  guestbook: (userId: number) => ['home-guestbook', userId] as const,
};

/** `GET /api/homes/{id}/guestbook` — public, read-only personal entries. */
export function useHomeGuestbook(userId: number, enabled = true) {
  return useQuery({
    queryKey: homeKeys.guestbook(userId),
    queryFn: ({ signal }) => fetchHomeGuestbook(userId, signal),
    enabled: enabled && Number.isFinite(userId) && userId > 0,
    retry: false,
    staleTime: 0,
  });
}

/** `GET /api/homes/{id}/layout` — the page, its version and its lock. */
export function useHomeLayout(userId: number, enabled = true) {
  return useQuery({
    queryKey: homeKeys.layout(userId),
    queryFn: ({ signal }) => fetchHomeLayout(userId, signal),
    enabled: enabled && Number.isFinite(userId) && userId > 0,
    // A failed read is shown as a failure. Retrying a 404 or a 400 only delays
    // the honest answer, and a 503 is already reported as "unavailable".
    retry: false,
    staleTime: 0,
  });
}

/**
 * Apply a set of placements to a cached layout, recomputing the geometry.
 *
 * `geometryForSlot` mirrors the server's `widgetStyle()`; the response replaces
 * these values a moment later, so a mismatch shows up as a box that moves once
 * rather than as a wrong layout.
 */
export function applyPlacements(
  layout: HomeLayout,
  placements: HomePlacement[],
): HomeLayout {
  const byId = new Map(placements.map((placement) => [placement.id, placement]));
  const widgets = layout.widgets.map((widget) => {
    const placement = byId.get(widget.id);
    if (!placement) return widget;
    return {
      ...widget,
      column: placement.column,
      position: placement.position,
      ...geometryForSlot(placement.column, placement.position),
    };
  });
  return { ...layout, widgets };
}

/**
 * The placements a drag produces, as a permutation.
 *
 * `phpretro_myhabbo_layouts` has `UNIQUE (user_id, guild_id, column_number,
 * position)` and the server refuses two widgets on one slot with 400, so a drop
 * onto an occupied slot swaps the two rather than stacking them — which is also
 * what a dragged box looks like it should do. The result is always a valid
 * permutation, so the server never has to refuse a move the user made on screen.
 */
export function placementsForMove(
  layout: HomeLayout,
  widgetId: number,
  column: number,
  position: number,
): HomePlacement[] {
  const moving = layout.widgets.find((widget) => widget.id === widgetId);
  if (!moving) return [];
  if (moving.column === column && moving.position === position) return [];

  const occupant = layout.widgets.find(
    (widget) =>
      widget.id !== widgetId && widget.column === column && widget.position === position,
  );

  const placements: HomePlacement[] = [{ id: widgetId, column, position }];
  if (occupant) {
    placements.push({
      id: occupant.id,
      column: moving.column,
      position: moving.position,
    });
  }
  return placements;
}

export interface SaveOutcome {
  /** The message to show when the save was refused, empty on success. */
  error: string;
  /** True when the server's version had moved: the cache now holds its layout. */
  conflicted: boolean;
  /** True when the edit session is gone and the editor must be left. */
  lockLost: boolean;
}

/**
 * `PUT /api/homes/{id}/layout`.
 *
 * The mutation takes the placements, the version and the lock token the caller
 * read, and it never retries a conflict: a `409` means somebody else's write
 * landed, and repeating ours would be exactly the silent overwrite the version
 * exists to prevent.
 */
export function useSaveHomeLayout(userId: number) {
  const queryClient = useQueryClient();
  const key = homeKeys.layout(userId);

  return useMutation<HomeLayout, unknown, { version: number; lockToken: string; placements: HomePlacement[] }>({
    mutationFn: ({ version, lockToken, placements }) =>
      saveHomeLayout(userId, version, lockToken, placements),
    retry: false,
    onMutate: async ({ placements }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HomeLayout>(key);
      if (previous) {
        queryClient.setQueryData(key, applyPlacements(previous, placements));
      }
      return { previous };
    },
    onSuccess: (layout) => {
      queryClient.setQueryData(key, layout);
    },
    onError: (error, _variables, context) => {
      const payload = error instanceof ApiRequestError ? error.payload : undefined;
      if (isHomeConflict(payload)) {
        // The server's layout, from the conflict body itself.
        queryClient.setQueryData(key, payload.current);
        return;
      }
      const previous = (context as { previous?: HomeLayout } | undefined)?.previous;
      if (previous) {
        queryClient.setQueryData(key, previous);
      }
    },
  });
}

/** `POST /api/homes/{id}/edit-session` — the lease that makes a save legal. */
export function useOpenHomeEditSession(userId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => openHomeEditSession(userId),
    retry: false,
    onSuccess: () => {
      // The lock is part of the layout payload (`home.lock`), so the cached read
      // is now stale in a field the editor renders.
      void queryClient.invalidateQueries({ queryKey: homeKeys.layout(userId) });
    },
  });
}

/** `DELETE /api/homes/{id}/edit-session` */
export function useCloseHomeEditSession(userId: number) {
  return useMutation({
    mutationFn: (lockToken: string) => closeHomeEditSession(userId, lockToken),
    retry: false,
  });
}

/** `POST /api/homes/{id}/widgets` */
export function useAddHomeWidget(userId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ widgetKey, column }: { widgetKey: UserWidgetKey; column: number }) =>
      addHomeWidget(userId, widgetKey, column),
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: homeKeys.layout(userId) }),
  });
}

/** `DELETE /api/homes/{id}/widgets/{widgetId}` */
export function useRemoveHomeWidget(userId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: number) => removeHomeWidget(userId, widgetId),
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: homeKeys.layout(userId) }),
  });
}
