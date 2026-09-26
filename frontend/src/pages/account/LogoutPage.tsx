import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import CommunityShell from '../../components/CommunityShell';
import { useClearSessionCache, useLogout } from '../../hooks/useAccount';

/**
 * `/logout` — ends the public session.
 *
 * ## Why this is a page rather than a link that fires a request
 *
 * `POST /api/auth/logout` is CSRF-filtered (see `AuthController.h`: the route
 * carries `hotel::filters::CsrfFilter`), so it is a *state-changing* request and
 * cannot be a bare `<a href>`. The legacy site could get away with a plain link
 * because `logout.php` was a GET that the framework treated as safe; this stack
 * deliberately does not, and weakening that to match legacy would be exactly the
 * kind of parity-over-safety trade the plan forbids.
 *
 * The header's "Log out" link therefore navigates here, and this page performs
 * the mutation once on mount. It is idempotent from the visitor's point of view:
 * a session that is already gone produces the same outcome.
 */
export default function LogoutPage() {
  const { mutate } = useLogout();
  const clearSessionCache = useClearSessionCache();
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // React 18 StrictMode mounts effects twice in development. Guarding on a ref
    // keeps this to a single logout request without relying on the mutation's
    // own deduplication.
    if (started.current) return;
    started.current = true;
    mutate(undefined, {
      onSettled: () => {
        setDone(true);
        // Cache cleared only after the request has settled, for the ordering
        // reason documented in `useLogout`.
        void clearSessionCache();
      },
    });
  }, [mutate, clearSessionCache]);

  return (
    <CommunityShell pageId="me" cat="home" pageName="Signed out">
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container">
              <div className="cbb clearfix default">
                <h2 className="title">Signed out</h2>
                <div className="box-content">
                  <p data-testid="logout-status">
                    {done ? 'You have been signed out.' : 'Signing you out…'}
                  </p>
                  <p>
                    <Link to="/">Back to the front page</Link>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}
