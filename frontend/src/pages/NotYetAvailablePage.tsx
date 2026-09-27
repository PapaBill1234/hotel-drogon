import ProcessShell from '../components/ProcessShell';

/**
 * An honest landing page for a route that exists in the legacy site but has not
 * been converted yet.
 *
 * ## Why this exists
 *
 * The router ends with `<Route path="*" element={<Navigate to="/" replace />} />`,
 * so **every** unconverted link silently bounced the visitor to the front page.
 * A link audit over the public pages found seven of them, two of which are in the
 * footer of every page:
 *
 *   /papers/disclaimer  /papers/privacy     footer, site-wide
 *   /credits/club                           "Join Habbo Club" in the header and /me
 *   /credits/pixels                         "Pixels" in the /me link bar
 *   /register                               header and the landing "Join now" button
 *   /tag                                    the community navi2 "Tags" tab
 *   /habblet/proxy.php?hid=…                habblet placeholders
 *
 * Clicking any of them looked like the site had thrown you back to the home page
 * for no reason. That is the "control that looks like it works but does not" the
 * plan forbids, and it is worse than saying so plainly.
 *
 * This page states which feature is missing and why, using the same
 * process-template shell the legacy error and notice pages use, so it reads as
 * part of the site rather than a dead end.
 */
export default function NotYetAvailablePage({
  title,
  phase,
  detail,
}: {
  /** Feature name, e.g. "Retro Club". */
  title: string;
  /** The plan phase that will deliver it. */
  phase: string;
  /** One sentence on what is missing, in the operator's own terms. */
  detail: string;
}) {
  return (
    <ProcessShell pageName={title}>
      <div className="cbb clearfix">
        <h2 className="title">{title}</h2>
        <div className="box-content">
          <p data-testid="not-yet-available">
            This part of the site has not been converted yet, so there is nothing
            to show here. The rest of the hotel works as normal.
          </p>
          <p>{detail}</p>
          <p>
            Planned for <strong>{phase}</strong>. Until then this page says so
            rather than sending you back to the front page.
          </p>
          <p>
            <a href="/">Back to the homepage &raquo;</a>
          </p>
        </div>
      </div>
    </ProcessShell>
  );
}
