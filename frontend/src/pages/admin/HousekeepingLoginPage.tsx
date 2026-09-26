import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import HousekeepingShell, {
  useHousekeepingDate,
} from '../../components/HousekeepingShell';
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
  const today = useHousekeepingDate();

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
    <HousekeepingShell pageName="Login" showChrome={false}>
      {/*
        `housekeeping/index.php:88-133` — a two-cell table: the form on the left,
        the Habbo illustration and version on the right. Reproduced with the
        legacy class names so `housekeeping/images/styles/style.css` (already
        served at these URLs) does the work; a div-based rewrite would have
        needed new CSS that this repository does not own.
      */}
      <div className="page_main">
        <table cellPadding={0} cellSpacing={0} style={{ height: '100%', border: 0 }}>
          <tbody>
            <tr style={{ height: '100%' }}>
              <td className="page_main_left">
                <div className="left_date">{today}</div>
                <div className="hr"></div>
                <div className="loginuser">Please log in</div>
                <div className="text">
                  <form
                    id="loginform"
                    onSubmit={(e) => void onSubmit(e)}
                  >
                    <strong>Username:</strong>
                    <br />
                    <input
                      type="text"
                      size={20}
                      name="username"
                      id="namefield"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <br />
                    <strong>Password:</strong>
                    <br />
                    <input
                      type="password"
                      size={20}
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <br />
                    {/* `housekeeping/index.php:103` — legacy labels this
                        "Authenticator code (staff)". */}
                    <strong>Authenticator code (staff):</strong>
                    <br />
                    <input
                      type="text"
                      size={20}
                      name="totp_code"
                      inputMode="numeric"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                    />
                    <div className="button left">
                      <input
                        type="submit"
                        value={busy ? 'Signing in…' : 'Submit'}
                        disabled={busy}
                        data-testid="login-submit"
                      />
                    </div>
                  </form>
                </div>
                <div className="hr"></div>
                <div className="text">
                  If you have forgot your password, please use the{' '}
                  <Link to="/account/password/forgot">recovery tool</Link> or contact
                  your system administrator.
                </div>
              </td>
              <td className="page_main_right">
                {/* `housekeeping/index.php:119-127`. */}
                {error !== null && (
                  <div className="center">
                    <div className="clean-error" data-testid="login-error">
                      {error}
                    </div>
                  </div>
                )}
                {notice !== null && (
                  <div className="center">
                    <div data-testid="login-notice">{notice}</div>
                  </div>
                )}
                <div className="login_top">
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <img src="/housekeeping/images/workman_habbo_down.gif" />
                  <br />
                  PHPRetro Version 4.0.10 BETA
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </HousekeepingShell>
  );
}
