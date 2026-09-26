import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import ProcessShell from '../../components/ProcessShell';
import {
  useRequestPasswordReset,
  useRequestUsernameReminder,
  useResetPassword,
  isUnauthenticated,
} from '../../hooks/useAccount';

/**
 * `/account/password/forgot` — the converted `forgot.php`.
 *
 * ## Two forms, because the legacy page had two
 *
 * `forgot.php` handled two POST actions on one page and rendered two boxes
 * side by side:
 *
 *   - `actionForgot` — recover a password: username **and** email, both exact,
 *     with `mail_verified = '1'`.
 *   - `actionList`  — recover a *username*: email only, no verification
 *     required, listing the account names on that address.
 *
 * Both are reproduced. The legacy page's third box ("False alarm?") is static
 * copy and is not ported.
 *
 * ## Where the outcome differs from legacy, deliberately
 *
 * The password form gives **one** answer whether or not the details matched.
 * Legacy printed a distinct "Invalid details." error, which turned the form into
 * an oracle for which username/address pairs exist — an unnecessary disclosure,
 * since the requester either receives mail they can act on or does not. The
 * username form still reports its result, because its whole output *is* the
 * answer and the caller must already know the address.
 */
export default function ForgotPasswordPage() {
  return (
    <ProcessShell pageName="Forgotten password">
      {/*
        `forgot.php` does NOT use `#column1`/`#column2` here. It ships its own
        inline stylesheet and two floats:

          div.left-column  { float: left;  width: 50% }
          div.right-column { float: right; width: 49% }
          label { display: block }
          input { width: 98% }
          input.process-button { width: auto; float: right }

        Using the generic column ids instead was wrong in a way that is not
        obvious: `process.css:41` sets `body.process-template #column1
        { float: none }`, and only re-floats them for `body#landing` and
        `body#reauthenticate`. On a body with no id the boxes therefore STACK,
        which is what made this page 21% different after the shell was fixed.
      */}
      <style>{`
        div.left-column { float: left; width: 50% }
        div.right-column { float: right; width: 49% }
        label { display: block }
        input { width: 98% }
        input.process-button { width: auto; float: right }
      `}</style>
      <div className="left-column">
        <PasswordResetRequestForm />
      </div>
      <div className="right-column">
        <UsernameReminderForm />
        <FalseAlarmBox />
      </div>
    </ProcessShell>
  );
}

/**
 * `forgot.php`'s third box. It was dismissed in the page's own comment as
 * "static copy and is not ported" — but it is a visible third of the page's
 * content, and leaving it out is exactly the kind of omission that reads as
 * "a lot is simple wrong". It is static, so it is reproduced verbatim.
 */
function FalseAlarmBox() {
  return (
    <div className="habblet-container">
      <div className="cbb clearfix">
        <h2 className="title">False Alarm!</h2>
        <div className="box-content">
          <p>
            If you have remembered your password, or if you just came here by
            accident, click the link below to return to the homepage.
          </p>
          <p>
            <a href="/">Back to homepage &raquo;</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function PasswordResetRequestForm() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRequestPasswordReset();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    try {
      const result = await mutation.mutateAsync({ username: username.trim(), email: email.trim() });
      setNotice(result.message);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The request could not be sent.');
    }
  }

  return (
    <div className="cbb clearfix">
      <h2 className="title">Forgotten your password?</h2>
      <div className="box-content">
        {notice !== null && <p data-testid="forgot-notice">{notice}</p>}
        <p>
          Enter your account name and the email address on the account. If they match a
          verified address, a reset link will be sent to it.
        </p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <p>
            <label htmlFor="forgottenpw-username">Account name</label>
            <input
              id="forgottenpw-username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </p>
          <p>
            <label htmlFor="forgottenpw-email">Email address</label>
            <input
              id="forgottenpw-email"
              name="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p>
            <button type="submit" disabled={mutation.isPending} data-testid="forgot-submit">
              {mutation.isPending ? 'Sending…' : 'Recover password'}
            </button>
          </p>
        </form>
        <p>
          <Link to="/account">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

function UsernameReminderForm() {
  const [email, setEmail] = useState('');
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [transport, setTransport] = useState<'log-only' | 'smtp' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useRequestUsernameReminder();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsernames(null);
    setError(null);
    try {
      const result = await mutation.mutateAsync({ email: email.trim() });
      setUsernames(result.usernames);
      setTransport(result.mail_transport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request could not be sent.');
    }
  }

  return (
    <div className="cbb clearfix">
      <h2 className="title">Forgotten your account name?</h2>
      <div className="box-content">
        {error !== null && <p data-testid="username-error">{error}</p>}
        <p>Enter the email address on the account and its names will be listed.</p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <p>
            <label htmlFor="accountlist-owner-email">Email address</label>
            <input
              id="accountlist-owner-email"
              name="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p>
            <button type="submit" disabled={mutation.isPending} data-testid="username-submit">
              {mutation.isPending ? 'Looking…' : 'Get account names'}
            </button>
          </p>
        </form>

        {usernames !== null && (
          <div data-testid="username-results">
            {usernames.length === 0 ? (
              <p data-testid="username-none">No accounts are registered to that address.</p>
            ) : (
              <>
                <ul>
                  {usernames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                {/*
                  The legacy page emailed this list. With no mail transport the
                  server returns it instead, and says so — the UI must not imply
                  an email went out when none did.
                */}
                {transport === 'log-only' && (
                  <p data-testid="username-transport-note">
                    This site has no mail transport configured, so the list is shown here
                    instead of being emailed.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `/account/password/reset?token=…` — the page a reset link opens.
 *
 * There is no legacy equivalent: `forgot.php` mailed a plaintext password and had
 * no second step. This page spends the single-use token the mail carries; the
 * token's expiry and single-use behaviour are enforced server-side in Redis, not
 * here.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const mutation = useResetPassword();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    try {
      const result = await mutation.mutateAsync({ token, newPassword });
      setNotice(result.message);
      setDone(true);
    } catch (err) {
      setExpired(isUnauthenticated(err));
      setNotice(err instanceof Error ? err.message : 'The password could not be changed.');
    }
  }

  return (
    <ProcessShell pageName="Choose a new password">
      <div id="container">
        <div id="content" className="clearfix">
          <div id="column1" className="column">
            <div className="cbb clearfix">
              <h2 className="title">Choose a new password</h2>
              <div className="box-content">
                {token === '' ? (
                  <p data-testid="reset-no-token">
                    This page needs the link from your reset email. <Link to="/account/password/forgot">Request a new one</Link>.
                  </p>
                ) : (
                  <>
                    {notice !== null && (
                      <p data-testid={done ? 'reset-done' : 'reset-error'}>{notice}</p>
                    )}
                    {done ? (
                      <p>
                        <Link to="/account">Sign in with your new password</Link>
                      </p>
                    ) : (
                      <form onSubmit={(e) => void onSubmit(e)}>
                        {expired && (
                          <p data-testid="reset-expired">
                            Reset links can only be used once and expire after 30 minutes.{' '}
                            <Link to="/account/password/forgot">Request a new one</Link>.
                          </p>
                        )}
                        <p>
                          <label htmlFor="reset-new-password">New password</label>
                          <input
                            id="reset-new-password"
                            name="new_password"
                            type="password"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                        </p>
                        <p>
                          <button type="submit" disabled={mutation.isPending} data-testid="reset-submit">
                            {mutation.isPending ? 'Saving…' : 'Set new password'}
                          </button>
                        </p>
                      </form>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProcessShell>
  );
}
