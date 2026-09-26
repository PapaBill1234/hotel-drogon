import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import CommunityShell from '../../components/CommunityShell';
import { useReauthenticate, useSessionState } from '../../hooks/useAccount';

/**
 * `/account/reauthenticate` — the converted `reauthenticate.php`.
 *
 * ## What the legacy page did
 *
 * `client.php` refused to open the hotel for a session whose
 * `$_SESSION['reauthenticate']` flag was set — a session restored from a
 * remember-me token rather than established by a fresh password. It stored the
 * requested URL in `$_SESSION['page']` and redirected here; this page collected
 * the password, re-ran the **full** credential check, cleared the flag and sent
 * the user on.
 *
 * ## What is preserved
 *
 * The re-check is the whole point, so it uses the same service method login uses:
 * a password that would not pass login cannot pass step-up. The flag itself lives
 * in the Redis session (server state, not a client claim), and the page routes
 * itself onward rather than through the legacy HTML redirect hop — a decoupled
 * SPA has a router, so `security_check.php`'s meta-refresh has nothing to do.
 *
 * ## What is not here
 *
 * `security_check.php`'s `type=token` branch, which logged a user in from a
 * remember-me cookie and *set* the flag. That belongs with the remember-me slice;
 * until it lands nothing in this stack sets the flag, so this page is reachable
 * but its condition cannot yet arise. Recorded in the inventory.
 */
export default function ReauthenticatePage() {
  const { data } = useSessionState();
  return <ReauthenticateScreen username={data?.username} />;
}

/**
 * The step-up screen itself, without the session query.
 *
 * Split out because `AccountPage` already knows the username — it fetched
 * `/api/me` to decide whether to render this at all — and rendering the screen
 * through this entry point avoids a second request for a value that is already in
 * hand.
 */
export function ReauthenticateScreen({ username }: { username?: string }) {
  return (
    <CommunityShell pageId="me" cat="home" pageName="Confirm your password">
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="cbb clearfix green">
              <h2 className="title">Confirm your password</h2>
              <div className="box-content" data-testid="reauth-screen">
                <p>
                  For your security, please confirm your password before continuing.
                </p>
                <p data-testid="reauth-current-user">
                  Signed in as <strong>{username ?? '…'}</strong>.
                </p>
                <ReauthenticateForm />
                <p>
                  Forgotten your password? <Link to="/account/password/forgot">Recover it here</Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CommunityShell>
  );
}

function ReauthenticateForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useReauthenticate();
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({ password });
      // The legacy page sent the user on to whatever they had asked for; `client`
      // is the only thing that sets the flag today, so it is the destination.
      navigate('/client', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That password was not accepted.');
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      {error !== null && <p data-testid="reauth-error">{error}</p>}
      <p>
        <label htmlFor="reauth-password">Password</label>
        <input
          id="reauth-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </p>
      <p>
        <button type="submit" disabled={mutation.isPending} data-testid="reauth-submit">
          {mutation.isPending ? 'Checking…' : 'Continue'}
        </button>
      </p>
    </form>
  );
}
