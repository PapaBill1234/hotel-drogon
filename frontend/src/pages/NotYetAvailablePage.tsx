import ProcessShell from '../components/ProcessShell';
import { BoxTitle, Cbb } from '../components/Rounder';

/**
 * The honest "this route exists in the legacy site but has no page here yet"
 * screen, rendered in the legacy process-template chrome.
 *
 * ## Why it is not just a redirect
 *
 * The catch-all used to be `<Navigate to="/" replace />`, so every unconverted
 * URL silently bounced the visitor to the front page — a click looked like the
 * site had thrown them out for no reason. `/papers/disclaimer` and
 * `/papers/privacy` are in the footer of EVERY page and `/credits/club` and
 * `/credits/pixels` are in the signed-in header, so this was easy to hit.
 *
 * ## Why the markup looks like this
 *
 * The shell (`ProcessShell`) already renders
 * `#overlay > #container > .cbb.process-template-box > #content`, so children
 * belong directly in `#process-content`. An earlier version of this page
 * re-declared `#container`/`#content`/`#column1` inside the shell's own
 * `#container`, which nested the panel inside itself; the page then rendered
 * outside the centred 766px panel with the logo at the top-left of the viewport.
 *
 * The layout here matches the legacy single-box process pages: `#column1` is
 * `float: none; width: auto` under `body.process-template` (`process.css:41`),
 * so the box spans the panel.
 *
 * NOT every unconverted route should become a page: several are deliberate
 * handoffs to the hotel client or plan decision gates. `phase` and `detail`
 * exist so each one says which, rather than implying the feature is missing by
 * accident.
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
      <div id="column1" className="column">
        <div className="habblet-container ">
          <Cbb className="cbb clearfix orange ">
            <BoxTitle>{title}</BoxTitle>
            <div className="box-content">
              <p data-testid="not-yet-available">
                This part of the site has not been converted yet, so there is
                nothing to show here. The rest of the hotel works as normal.
              </p>
              <p>{detail}</p>
              <p>
                Planned for <strong>{phase}</strong>. Until then this page says
                so rather than sending you back to the front page.
              </p>
              <p>
                <a href="/">Back to the homepage &raquo;</a>
              </p>
            </div>
          </Cbb>
        </div>
      </div>
    </ProcessShell>
  );
}
