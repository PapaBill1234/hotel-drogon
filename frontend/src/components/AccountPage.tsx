import type { ReactNode } from 'react';

import CommunityShell from './CommunityShell';
import LoginPage from '../pages/account/LoginPage';
import { useMe } from '../hooks/useAccount';
import type { User } from '../types/account';

/**
 * Shared guard + shell for the signed-in account pages (`/me`,
 * `/account/profile`).
 *
 * ## Why a guard component rather than a redirect in each page
 *
 * `GET /api/me` is the only authority on whether a public session exists, and
 * both account pages need the same four answers: loading, signed out, failed,
 * signed in. Keeping that in one place means the pages cannot disagree about
 * what "signed out" means.
 *
 * ## Signed out renders the form *in place* rather than redirecting
 *
 * The sign-in form is served at the URL the visitor asked for, so a successful
 * sign-in continues to the page they wanted without a client-side bounce and
 * without a `location.state` round trip. This mirrors the legacy behaviour
 * closely enough to matter: `me.php` and `profile.php` both set
 * `$page['allow_guests'] = false`, and `includes/session.php` sent an anonymous
 * visitor to `account.php` *carrying the original destination*, so signing in
 * returned them to the page they had asked for. Rendering in place gets the same
 * outcome with one less hop.
 *
 * ## What counts as "signed out"
 *
 * Only a 401 (no session, or an expired one). Any other failure — 500, 404, a
 * network error — renders an explicit error instead, because silently showing
 * the sign-in form on a server fault looks like a wrong password and sends the
 * visitor round a loop that cannot succeed.
 */
interface AccountPageProps {
  /** Legacy `$page['name']`, used for `<title>`. */
  pageName: string;
  /**
   * Legacy `$page['id']` / `$page['cat']`, passed through to `CommunityShell`.
   *
   * The account pages do not all share one: `me.php` and `profile.php` are
   * `cat = 'home'` with no secondary navigation strip, while `credits.php` is
   * `cat = 'credits'` and renders the Coins/Habbo Club/Collectables/Pixels strip
   * with Coins selected. Defaulting to the profile pair keeps the common case
   * terse without forcing the credits pages to accept the wrong strip.
   */
  pageId?: 'me' | 'credits' | 'history';
  cat?: 'home' | 'credits';
  children: (user: User) => ReactNode;
}

export default function AccountPage({
  pageName,
  pageId = 'me',
  cat = 'home',
  children,
}: AccountPageProps) {
  const { data, error, isPending, isError } = useMe();

  if (isPending) {
    return (
      <AccountFrame pageName={pageName} pageId={pageId} cat={cat}>
        <p data-testid="account-loading">Loading your account…</p>
      </AccountFrame>
    );
  }

  if (isError && error !== null) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      // No usable session: the sign-in form, in place, at this URL.
      return <LoginPage />;
    }
    return (
      <AccountFrame pageName={pageName} pageId={pageId} cat={cat}>
        <p data-testid="account-error">
          Your account could not be loaded
          {status !== undefined ? ` (HTTP ${status})` : ''}. Please try again.
        </p>
      </AccountFrame>
    );
  }

  if (!data) {
    return <LoginPage />;
  }

  return (
    <CommunityShell pageId={pageId} cat={cat} pageName={pageName} signedInAs={data.user.username}>
      {children(data.user)}
    </CommunityShell>
  );
}

/** The plain `#column1` box these pages share, for the non-content states. */
function AccountFrame({
  pageName,
  pageId,
  cat,
  children,
}: {
  pageName: string;
  pageId: 'me' | 'credits' | 'history';
  cat: 'home' | 'credits';
  children: ReactNode;
}) {
  return (
    <CommunityShell pageId={pageId} cat={cat} pageName={pageName}>
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container">
              <div className="cbb clearfix default">
                <h2 className="title">{pageName}</h2>
                <div className="box-content">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}
