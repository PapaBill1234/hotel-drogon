import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import CommunityShell from '../../components/CommunityShell';
import { useLogin } from '../../hooks/useAccount';
import { AccountApiError } from '../../services/apiAccount';

/**
 * Sign-in screen for the public hotel session.
 *
 * ## Where the URL comes from
 *
 * The legacy site's sign-in form posted to `account.php`, and every anonymous
 * header (`templates/community_header.php`) carried that form. The converted
 * site keeps a matching destination: the anonymous header form's `action` is
 * `/account`, so it lands here even when JavaScript has not taken over, and
 * this screen performs the real `POST /api/auth/login`.
 *
 * ## What this screen is not
 *
 * It is not the staff sign-in. Housekeeping has its own screen and its own
 * separate `hotel_staff_session` cookie (`HousekeepingLoginPage`); signing in
 * here grants the public session only.
 *
 * ## Failure messages
 *
 * `AuthController::login` returns 401 for bad credentials *and* for
 * authentication system errors, 403 for a banned account (with
 * `ban_reason`/`ban_expires`), 400 for malformed JSON, and 500 when the session
 * store fails. The messages below distinguish exactly the cases the response
 * distinguishes and claim no more precision than that.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mutateAsync, isPending } = useLogin();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Where a guarded page wanted to go before it sent the visitor here. */
  const from = (location.state as { from?: string } | null)?.from ?? '/me';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (username.trim() === '' || password === '') {
      setError('Username and password are required.');
      return;
    }

    try {
      await mutateAsync({ username: username.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof AccountApiError) {
        if (err.status === 403) {
          const until =
            err.banExpires !== undefined && err.banExpires !== '' ? ` (until ${err.banExpires})` : '';
          setError(
            `This account is banned${until}.${err.banReason ? ` Reason: ${err.banReason}` : ''}`,
          );
        } else if (err.status === 401) {
          setError('Wrong username or password.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Sign-in failed. Check that the site is reachable.');
      }
    }
  }

  return (
    <CommunityShell pageId="me" cat="home" pageName="Sign in">
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="habblet-container">
              <div className="cbb clearfix default">
                <h2 className="title">Sign in</h2>
                <div className="box-content">
                  {error !== null && (
                    <p className="error" data-testid="login-error">
                      {error}
                    </p>
                  )}

                  {/* Scoped ids and names, deliberately `account-*` rather than
                      `login-*`: `CommunityShell` renders the anonymous header
                      sign-in form on this same page, so `#login-username` and
                      `#login-password` would be duplicated in the document and
                      every label lookup would be ambiguous between the two. */}
                  <form onSubmit={(e) => void onSubmit(e)} data-testid="account-signin-form">
                    <label htmlFor="account-username">Username</label>
                    <br />
                    <input
                      id="account-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <br />
                    <label htmlFor="account-password">Password</label>
                    <br />
                    <input
                      id="account-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <br />
                    <button type="submit" disabled={isPending} data-testid="login-submit">
                      {isPending ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>

                  <p>
                    <a href="/account/password/forgot">I forgot my password/username</a>
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
