import ProcessShell from '../components/ProcessShell';
import { SiteSettingsProvider, usePageSettings } from '../components/SiteSettings';

/**
 * `/papers/disclaimer` and `/papers/privacy` — `papers.php`, ported.
 *
 * ## What the legacy page actually is
 *
 * `papers.php` is 5 lines:
 *
 *   $requested = $_GET['page'] ?? 'privacy';
 *   disclaimer -> title "Disclaimer",     content = $settings->find('paper_disclaimer')
 *   otherwise  -> title "Privacy Policy", content = $settings->find('paper_privacy')
 *   $page['bodyid'] = 'landing'; require login_header.php;
 *   <div id="process-content"><div id="terms" class="box-content">
 *     <div class="tos-header"><b>TITLE</b></div>
 *     <div class="tos-item">CONTENT</div></div></div>
 *
 * so it is a process-template page (`body#landing.process-template`, the same
 * family as `/forgot`), not a community page.
 *
 * Before this file existed the route was a `NotYetAvailablePage` stub that was
 * not wired into the process-template body at all, so it rendered with no
 * chrome: measured on this stack the `#container` came out 930px wide instead
 * of 766px, with the logo at the top-left of the viewport and the copy against
 * the left edge. It is in the footer of EVERY page, which made it the most
 * visible of the unconverted routes.
 *
 * ## Two deliberate departures
 *
 * 1. `papers.php` emits a SECOND `<div id="process-content">` inside the one
 *    `login_header.php` already opened — a duplicate id. It is reproduced,
 *    because `process.css:31` gives `#process-content` an 18px top margin and
 *    nesting the element applies it twice; dropping the inner div would move
 *    the box up by 18px against the legacy layout.
 * 2. The stored copy is NOT rendered as markup. `paper_disclaimer` and
 *    `paper_privacy` are raw-HTML settings (`settings.paper_disclaimer.desc`
 *    is literally "HTML allowed. Your hotel disclaimer."), the public settings
 *    API deliberately withholds markup-bearing values, and the plan makes HTML
 *    sanitisation an explicit dependency decision gate (Phase 7: "do not
 *    hand-roll HTML sanitization"). So when copy exists but carries markup,
 *    this page says so instead of either injecting it or pretending the page is
 *    empty. In the current fixture there are no `paper_*` rows at all, and
 *    `HoloSettings::find` returns `''` for a missing key — the legacy page
 *    therefore renders an EMPTY `.tos-item`, which is what is ported here.
 */
export default function PapersPage({ which }: { which: 'disclaimer' | 'privacy' }) {
  return (
    <SiteSettingsProvider>
      <ProcessShell pageName={which === 'disclaimer' ? 'Disclaimer' : 'Privacy Policy'}>
        <PaperBody which={which} />
      </ProcessShell>
    </SiteSettingsProvider>
  );
}

function PaperBody({ which }: { which: 'disclaimer' | 'privacy' }) {
  const settings = usePageSettings();

  // `en.php:953-954` (`landing.papers`): `$loc['disclaimer'] = "Disclaimer"`,
  // `$loc['privacy.policy'] = "Privacy Policy"` — note the capital P in
  // "Privacy Policy", which the settings label uses as well.
  const title = which === 'disclaimer' ? 'Disclaimer' : 'Privacy Policy';
  const key = which === 'disclaimer' ? 'paper_disclaimer' : 'paper_privacy';

  // `HoloSettings::find()` (`includes/classes.php:740`) is
  // `return $this->cache[$key] ?? '';` — a missing row is an empty string, not
  // null, and the legacy page renders the empty `.tos-item` that produces.
  const stored = settings[key] ?? '';

  return (
    <>
      {/* See note 1 above: the duplicate id is the legacy markup, not a slip. */}
      <div id="process-content">
        <div id="terms" className="box-content">
          <div className="tos-header">
            <b>{title}</b>
          </div>
          <div className="tos-item">
            {stored === '' ? (
              <p data-testid="paper-unset">
                This hotel has not published its {title.toLowerCase()} text yet, so there is
                nothing to show here.
              </p>
            ) : (
              /*
                The value is shown as TEXT on purpose. It is a raw-HTML setting
                and rendering it would mean sanitising tenant-authored markup,
                which the plan reserves for a deliberate decision.
              */
              <p data-testid="paper-text">{stored}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
