/**
 * Read a route parameter, with a path-based fallback.
 *
 * ## Why this exists
 *
 * `useParams()` does not deliver values in this application. Measured in the
 * browser on `react-router-dom@6.30.6` with the `@remix-run/router@1.23.4` that
 * version declares: `useParams()` returned the route's compiled parameter
 * *descriptor* (`{paramName: 'userId', isOptional: false}`) instead of the
 * matched value, so `useParams().id` was `undefined` and every dynamic route
 * silently rendered its list/empty branch. The visible symptom: `/articles/1`
 * rendered a byte-identical page to `/articles`.
 *
 * The cause was not established — the two packages are at the versions
 * `react-router` itself declares, and `matchPath` in that build does reduce
 * `compiledParams` into `{name: value}` — so this does not guess at one. It
 * asks the router first (so the day the behaviour returns, nothing here has to
 * change) and falls back to the URL, which is where the value demonstrably is.
 *
 * Each caller passes the pattern for its own route, because only the caller
 * knows which segment the parameter occupies.
 */
import { useLocation, useParams } from 'react-router-dom';

export function useRouteParam(name: string, pattern: RegExp): string | undefined {
  // Hooks stay unconditional even if the router starts returning a string
  // after the URL fallback has handled earlier renders.
  const { pathname } = useLocation();
  const params = useParams() as Record<string, unknown>;
  const fromRouter = params[name];
  if (typeof fromRouter === 'string' && fromRouter !== '') return fromRouter;
  const captured = pattern.exec(pathname);
  return captured?.[1];
}
