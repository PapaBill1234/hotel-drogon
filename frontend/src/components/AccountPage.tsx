import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import CommunityShell from './CommunityShell';
import LoginPage from '../pages/account/LoginPage';
import { ReauthenticateScreen } from '../pages/account/ReauthenticatePage';
import { useMe, useRememberLogin } from '../hooks/useAccount';
import { hasRememberMeFlag } from '../services/apiAccount';
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
   * `cat = 'home'`, which DOES have a secondary strip — `community_header.php`
   * renders `Home | My Page | Account Settings | Habbo Club` for a signed-in
   * user — and `credits.php` is `cat = 'credits'` with the
   * Coins/Habbo Club/Collectables/Pixels strip. Defaulting to the profile pair
   * keeps the common case terse without forcing the credits pages to accept the
   * wrong strip.
   *
   * `'me'` / `'profile'` select which tab of the `home` strip is current;
   * `'home'` is the MyHabbo home page, which this stack does not have yet.
   */
  pageId?: 'me' | 'profile' | 'home' | 'credits' | 'history';
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
      // No usable session. Before offering the sign-in form, try the remember-me
      // token if the browser holds one — which is exactly when the legacy front
      // controller consulted it (`$user->error == 1 && $_COOKIE['rememberme'] ==
      // "true"`). The save/restore decision is the user's; this only honours a
      // token they already asked for.
      if (hasRememberMeFlag()) {
        return <RememberMeRestore />;
      }
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

  // A session restored from a remember-me token is real but not yet privileged:
  // it must prove the password before it can show anything. The screen is
  // rendered here rather than reached by redirect, so the visitor stays on the
  // page they asked for and gets it as soon as the step-up succeeds — the same
  // destination `reauthenticate.php` restored from `$_SESSION['page']`.
  if (data.reauth_required === true) {
    return <ReauthenticateScreen username={data.user.username} />;
  }

  return (
    <CommunityShell pageId={pageId} cat={cat} pageName={pageName} signedInAs={data.user.username}>
      {children(data.user)}
    </CommunityShell>
  );
}

/**
 * Spend the remember-me token and send the visitor to the step-up screen.
 *
 * The server answers `reauth_required: true` for a token-established session, so
 * the destination is `/account/reauthenticate` and never the page they asked
 * for: a restored session must prove the password before it can do anything.
 *
 * Runs once per mount (the ref guard). React 18's StrictMode mounts effects twice
 * in development, and the token is single-use server-side — a second attempt
 * would fail against a token the first attempt already spent, turning a working
 * restore into an error.
 */
function RememberMeRestore() {
  const { mutate } = useRememberLogin();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate(undefined, {
      onSuccess: () => {
        navigate('/account/reauthenticate', { replace: true });
      },
      onError: () => {
        // The server clears the cookies when it refuses, so the next render sees
        // no flag and falls through to the sign-in form. Reloading the query is
        // what re-runs that decision.
        navigate('/account', { replace: true });
      },
    });
  }, [mutate, navigate]);

  return (
    <AccountFrame pageName="Restoring your session" pageId="me" cat="home">
      <p data-testid="remember-restore">Restoring your session…</p>
    </AccountFrame>
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
  pageId: 'me' | 'profile' | 'home' | 'credits' | 'history';
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
