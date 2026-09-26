import { Navigate } from 'react-router-dom';

import AccountPage from '../../components/AccountPage';
import { useSessionState } from '../../hooks/useAccount';
import { useClientEntry } from '../../hooks/useCredits';

/**
 * `/client` — the converted client entry.
 *
 * The legacy `client.php` embedded a **Shockwave/Director** object
 * (`clsid:166B1BCA-…`) whose `sw8` parameter carried
 * `use.sso.ticket=1;sso.ticket=<users.auth_ticket>` and whose `sw2`/`sw3`
 * parameters carried the hotel's host, port and MUS port. The browser-native
 * Octane client instead consumes `?sso=<users.auth_ticket>` at its root. The
 * backend only advertises that launch when an operator has configured its URL.
 */
export default function ClientPage() {
  const { data: session, isPending } = useSessionState();

  // `client.php` opened with exactly this check: a session carrying the
  // `reauthenticate` flag was sent to the step-up screen *before* anything else
  // on the page ran, and the requested URL was remembered so the user came back
  // to it. The URL is carried in location state rather than a session variable.
  if (!isPending && session?.reauth_required) {
    return <Navigate to="/account/reauthenticate" replace />;
  }

  return (
    <AccountPage pageName="Enter the hotel">
      {() => <ClientEntry />}
    </AccountPage>
  );
}

function ClientEntry() {
  const { data, isPending, isError, error } = useClientEntry();

  if (isPending) {
    return (
      <Shell>
        <p data-testid="client-loading">Preparing your hotel entry…</p>
      </Shell>
    );
  }

  if (isError || !data) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <Shell>
        <p data-testid="client-error">
          Your hotel entry could not be prepared
          {status !== undefined ? ` (HTTP ${status})` : ''}. Please try again.
        </p>
      </Shell>
    );
  }

  // The legacy `intermediate.php` markup: an enter button, a line of copy, and a
  // link back to the user's own page. The ids are kept so the legacy stylesheet
  // (`#enter-hotel`, `.enter-btn`) applies to the block it was written for.
  return (
    <div id="container">
      <div id="content" className="clearfix">
        <div id="column1" className="column">
          <div className="habblet-container">
            <div className="cbb clearfix default">
              <h2 className="title">Enter the hotel</h2>
              <div className="box-content">
                <div id="enter-hotel">
                  {data.handoff_available ? (
                    <div className="open enter-btn">
                      {/*
                        Octane consumes `?sso=`. The old hotel:// form remains
                        available only for a separately configured legacy client.
                      */}
                      <a
                        href={data.octane_url
                          ? `${data.octane_url}?sso=${encodeURIComponent(data.sso_ticket)}`
                          : `${clientScheme(data.connection.host, data.connection.port)}?use.sso.ticket=1&sso.ticket=${encodeURIComponent(data.sso_ticket)}`}
                        target={data.octane_url ? '_blank' : undefined}
                        rel={data.octane_url ? 'noreferrer' : undefined}
                        referrerPolicy="no-referrer"
                        data-testid="client-open"
                      >
                        Enter PHPRetro<i></i>
                      </a>
                      <b></b>
                    </div>
                  ) : (
                    <p data-testid="client-unavailable">
                      The hotel client is not configured on this site, so there is nothing to
                      launch yet.
                    </p>
                  )}
                </div>

                <div id="info">
                  {data.handoff_available ? (
                    <p data-testid="client-ready-note">
                      {data.octane_url
                        ? 'Your entry ticket is ready. Open Octane to enter the hotel.'
                        : 'Your entry ticket is ready for the configured hotel client.'}
                    </p>
                  ) : (
                    <>
                      <p>
                        An entry ticket was prepared, but no client launch is configured.
                        The following legacy connection settings are missing or empty:
                      </p>
                      <ul data-testid="client-missing-settings">
                        {data.missing_settings.map((key) => (
                          <li key={key}>{key}</li>
                        ))}
                      </ul>
                      <p>
                        Set them under housekeeping settings, and this page will offer the
                        handoff.
                      </p>
                    </>
                  )}
                  <p data-testid="client-ticket-state">
                    {data.sso_ticket !== ''
                      ? 'An SSO ticket is stored on your account.'
                      : 'No SSO ticket was stored.'}
                  </p>
                </div>

                <div id="enter-mypage">
                  <a href="/me">Go to your page</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div id="container">
      <div id="content" className="clearfix">
        <div id="column1" className="column">
          <div className="habblet-container">
            <div className="cbb clearfix default">
              <h2 className="title">Enter the hotel</h2>
              <div className="box-content">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A URL-shaped rendering of the configured host and port.
 *
 * Deliberately not `http://`: the value a Shockwave client was given was a bare
 * `host:port` for its own socket connection, not an HTTP origin, and guessing a
 * scheme would invent a fact. The `hotel://` scheme marks it as the hotel
 * endpoint it is; nothing dereferences it in this application.
 */
function clientScheme(host: string, port: string): string {
  return `hotel://${host}${port ? `:${port}` : ''}`;
}
