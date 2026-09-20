import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import {
  adminLogin,
  adminStaffLogin,
  AdminApiError,
  STAFF_MIN_RANK,
} from '../../services/apiAdmin';

/**
 * Staff sign-in for the converted housekeeping panel.
 *
 * ## What the legacy entry point did
 *
 * `housekeeping/index.php` posted to `account.php` for the *public* session and
 * then required `includes/hksession.php` to find a staff session before any
 * panel page would render. The same two steps are reproduced here, through the
 * server's own endpoints:
 *
 *   1. `POST /api/auth/login`       — public session + CSRF cookie
 *   2. `POST /api/auth/staff-login` — the separate staff session
 *
 * The panel needs both: `AuthPolicy::requireStaff` reads
 * `hotel_staff_session`, while `filters::CsrfFilter` validates the submitted
 * token against the `csrf_token` of the **user** session in `hotel_session`.
 * This component performs exactly the sequence `scripts/smoke_phase4_admin.sh`
 * performs, so the browser path and the smoke path cannot drift apart.
 *
 * ## Rank note
 *
 * The rank check here is a *courtesy*, kept deliberately loose: it runs only
 * after the server accepted the credentials and reports its own rank. The
 * authoritative gate is `AuthPolicy::requireStaff(minRank)` on every endpoint;
 * a client that lied about its rank would simply receive 403s.
 */

type Step = 'idle' | 'user-session' | 'staff-session';

export default function HousekeepingLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = step !== 'idle';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (username.trim() === '' || password === '') {
      setError('Username and password are required.');
      return;
    }

    try {
      setStep('user-session');
      const login = await adminLogin(username.trim(), password);

      if (login.user.rank < STAFF_MIN_RANK) {
        setError(
          `"${login.user.username}" has rank ${login.user.rank}. Housekeeping needs rank ${STAFF_MIN_RANK} or above.`,
        );
        setStep('idle');
        return;
      }

      setStep('staff-session');
      const staff = await adminStaffLogin(username.trim(), password, totpCode.trim() || undefined);

      // Both sessions now exist. Cached answers from *before* sign-in must not
      // survive: `AdminLayout` mounts on navigation and would otherwise render
      // the "no staff session" gate from the pre-login 403s.
      //
      // `resetQueries` rather than `clear()`: clear() removes query objects but
      // leaves already-dispatched fetches alive, and a stale rejection landing
      // afterwards re-seeds the very state being discarded.
      await queryClient.resetQueries();

      if (!staff['2fa_verified']) {
        // Surfaced rather than hidden: the server-side 2FA gate currently checks
        // only that a 6-digit code was supplied (recorded as a Phase 3 partial
        // in the inventory), and the panel must not imply more than that.
        setNotice('Staff session created without a verified 2FA step-up.');
      }

      navigate('/housekeeping', { replace: true });
    } catch (err) {
      setStep('idle');
      if (err instanceof AdminApiError) {
        setError(err.status === 401 ? 'Wrong username or password.' : err.message);
      } else {
        setError('Sign-in failed. Check that the API is reachable.');
      }
    }
  }

  return (
    <div className="hk-admin">
      <div className="hk-panel">
        <div className="hk-header">
          <span className="hk-header-title">PHPRetro Housekeeping</span>
        </div>
      </div>

      <div className="hk-login">
        <div className="hk-login-head">Staff sign-in</div>
        <div className="hk-login-body">
          {error !== null && (
            <div className="hk-notice hk-notice-error" data-testid="login-error">
              {error}
            </div>
          )}
          {notice !== null && <div className="hk-notice">{notice}</div>}

          <form onSubmit={(e) => void onSubmit(e)} className="hk-form">
            <div className="hk-field">
              <label htmlFor="hk-username">Username</label>
              <input
                id="hk-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="hk-field">
              <label htmlFor="hk-password">Password</label>
              <input
                id="hk-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="hk-field">
              <label htmlFor="hk-totp">Two-factor code (optional)</label>
              <input
                id="hk-totp"
                name="totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
              <div className="hk-field-error">
                Leave blank to create a staff session without a 2FA step-up.
              </div>
            </div>

            <div className="hk-actions">
              <button type="submit" disabled={busy} data-testid="login-submit">
                {step === 'user-session'
                  ? 'Signing in…'
                  : step === 'staff-session'
                    ? 'Starting staff session…'
                    : 'Sign in'}
              </button>
              <Link to="/">Back to the site</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
