import AccountPage from '../../components/AccountPage';
import { useClientEntry } from '../../hooks/useCredits';

/**
 * `/client` — the converted client entry.
 *
 * ## What this is, and what it deliberately is not
 *
 * The legacy `client.php` embedded a **Shockwave/Director** object
 * (`clsid:166B1BCA-…`) whose `sw8` parameter carried
 * `use.sso.ticket=1;sso.ticket=<users.auth_ticket>` and whose `sw2`/`sw3`
 * parameters carried the hotel's host, port and MUS port. Modern browsers cannot
 * run that plugin, and the plan tracks the browser-native client as **milestone
 * 6**, an explicitly separate deliverable that may not be counted as
 * first-release scope.
 *
 * So this is a **handoff**, matching the convention the legacy codebase already
 * established for emulator-bound actions (`docs/phase-reports/client-handoff.md`:
 * an honest page that tells the user to do the action in the client, with no
 * faked website-side grant). It does not embed a plugin, does not pretend a
 * client is running, and does not present a button that would silently do
 * nothing.
 *
 * ## What is real here
 *
 * The server issues a genuine SSO ticket in the format the legacy site wrote and
 * stores it in `users.auth_ticket`, the column PolarIS defines; the settings it
 * reports are the website's own. What is **not** verified — and is recorded in
 * the inventory as a gap rather than claimed — is whether the emulator accepts
 * that ticket, because no PolarIS/Nitro source or running emulator is available
 * to this project.
 *
 * When the connection settings are absent the page says so and lists them. On a
 * stack that has never had a client configured (which is every stack this
 * repository can currently produce) that is the true state, and the alternative
 * — inventing `hotel_ip`/`hotel_port` defaults — would be a fabricated success.
 */
export default function ClientPage() {
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
                        The target is the emulator the settings describe, not a
                        page this application serves. `sso_ticket` is passed in
                        the same `use.sso.ticket` form the legacy Shockwave
                        parameters used, so a client reading them gets the same
                        material.
                      */}
                      <a
                        href={`${clientScheme(data.connection.host, data.connection.port)}?use.sso.ticket=1&sso.ticket=${encodeURIComponent(data.sso_ticket)}`}
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
                      Your entry ticket has been issued. This site hands you to the hotel
                      client; it does not run one, and whether the hotel accepts the ticket
                      is decided by the hotel itself.
                    </p>
                  ) : (
                    <>
                      <p>
                        An entry ticket can only be issued once the hotel connection is
                        configured. The following settings are missing or empty:
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
