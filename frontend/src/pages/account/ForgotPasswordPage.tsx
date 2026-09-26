import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import ProcessShell from '../../components/ProcessShell';
import {
  useRequestPasswordReset,
  useRequestUsernameReminder,
  useResetPassword,
  isUnauthenticated,
} from '../../hooks/useAccount';
import { useSettings } from '../../hooks/usePublicContent';

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
        /*
         * forgot.php writes this as input.process-button, which matches
         * nothing here: the port renders a real <button> rather than an
         * <input type=submit>, so the rule has to name both or the submit
         * control keeps the default inline-block flow instead of floating
         * right the way the legacy one does. The .submit class carries the
         * button skin; this only adds the width and float.
         */
        input.process-button, button.process-button { width: auto; float: right }
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
      {/* `en.php:509` — `$loc['forgot.pass']`. Kept in the legacy capitalisation:
          "Forgotten Your Password?", not "Forgotten your password?". */}
      <h2 className="title">Forgotten Your Password?</h2>
      <div className="box-content">
        {notice !== null && <p data-testid="forgot-notice">{notice}</p>}
        {/* `en.php:515` — `$loc['forgot.pass.content']`. */}
        <p>
          Don&apos;t panic! Please enter your account information below and we&apos;ll send you
          an email telling you how to reset your password.
        </p>
        <form id="forgottenpw-form" onSubmit={(e) => void onSubmit(e)}>
          <p>
            {/* `en.php:514` — `$loc['forgot.username']` is "Username". */}
            <label htmlFor="forgottenpw-username">Username</label>
            <input
              id="forgottenpw-username"
              name="forgottenpw-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </p>
          <p>
            {/* `en.php:513` — `$loc['forgot.email']`. */}
            <label htmlFor="forgottenpw-email">Email address</label>
            <input
              id="forgottenpw-email"
              name="forgottenpw-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p>
            {/* `en.php:516` — `$loc['forgot.button']`, and the legacy id and
                class. `.process-button` is what floats it right. */}
            <button
              type="submit"
              id="forgottenpw-submit"
              className="submit process-button"
              disabled={mutation.isPending}
              data-testid="forgot-submit"
            >
              Request password email
            </button>
          </p>
          <input type="hidden" name="origin" value="default" />
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
  // `SHORTNAME` is the `site_shortname` setting, not a build constant.
  const { data: settingsData } = useSettings();
  const shortname = settingsData?.settings['site_shortname'] ?? '';

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
      {/* `en.php:518` — `$loc['forgot.name']` is
          "Forgotten Your ".SHORTNAME." Name?", which renders as "Forgotten Your
          Retro Name?" on this site. SHORTNAME is the `site_shortname` setting,
          not a constant, so it is read at runtime rather than hard-coded. */}
      <h2 className="title">{`Forgotten Your ${shortname} Name?`}</h2>
      <div className="box-content">
        {error !== null && <p data-testid="username-error">{error}</p>}
        {/* `en.php:519` — `$loc['forgot.name.message']`. */}
        <p>No problem - just enter your email address below and we&apos;ll send you a list of your accounts.</p>
        <form id="accountlist-form" onSubmit={(e) => void onSubmit(e)}>
          <p>
            {/* `en.php:513` — `$loc['forgot.email']`. */}
            <label htmlFor="accountlist-owner-email">Email address</label>
            <input
              id="accountlist-owner-email"
              name="accountlist-owner-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p>
            {/* `en.php:521` — `$loc['forgot.button.get.accounts']`. */}
            <button
              type="submit"
              id="accountlist-submit"
              className="submit process-button"
              disabled={mutation.isPending}
              data-testid="username-submit"
            >
              Get my accounts
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
