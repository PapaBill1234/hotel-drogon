# Pixel difference: legacy vs new

Ranked worst first. `ratio` is the fraction of the frame whose RGB differs,
computed by decoding both captures written by `audit.spec.ts`.

Re-measured in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image
after the `Rounder` DOM-ownership fix, which is why several rows moved: that
defect froze any React update inside a `.cbb` box, so box titles that
interpolate settings rendered empty. `credits`, `credits-history` and `landing`
improved; `profile` moved the other way by ~1pp and is noted below.

The `hk-*` rows are byte-identical to the previous run, which is the control:
the staff panel renders no `.cbb` boxes, so the fix cannot touch it.

| page | differing | detail |
| --- | --- | --- |
| hk-settings | 48.90% | 500694 px differ |
| me | 43.08% | 441162 px differ |
| hk-banners | 30.70% | 314378 px differ |
| hk-faq | 29.97% | 306863 px differ |
| hk-news | 28.56% | 292495 px differ |
| hk-dashboard | 28.48% | 291605 px differ |
| hk-campaigns | 27.52% | 281769 px differ |
| hk-collectables | 27.07% | 277207 px differ |
| profile | 18.51% | 189535 px differ |
| hk-login | 10.55% | 108011 px differ |
| credits | 7.11% | 72762 px differ |
| collectables | 5.45% | 55818 px differ |
| community | 5.12% | 52405 px differ |
| papers-privacy | 2.97% | 30445 px differ |
| papers-disclaimer | 2.96% | 30356 px differ |
| forgot | 2.29% | 23415 px differ |
| credits-history | 2.25% | 23090 px differ |
| articles | 2.01% | 20555 px differ |
| tag | 1.91% | 19542 px differ |
| help | 1.90% | 19503 px differ |
| maintenance | 0.54% | 5541 px differ | (site_closed=1 on BOTH stacks)
| landing | 0.01% | 92 px differ |

## Changes since the previous run

| page | before | after | note |
| --- | --- | --- | --- |
| landing | 0.24% | **0.01%** (92 px) | The box chrome, ported to React, is now pixel-identical. This is the strongest single piece of evidence that the `Rounder` transcription is faithful. |
| credits | 13.45% | **7.11%** | `#credits-methods`' heading interpolates `site_shortname`; it had been frozen at its pre-query value. |
| credits-history | 4.82% | **2.25%** | Same class of frozen update. |
| collectables | 5.78% | 5.45% | — |
| me | 43.45% | 43.08% | Still dominated by the unbuilt MyHabbo widgets (Phase 6-8). |
| forgot | 2.44% | 2.29% | The heading defect itself is a handful of pixels; it was diagnosed by code points, not by this ratio. |
| community | 5.11% | 5.12% | Unchanged within noise. |
| articles | 2.00% | 2.01% | Unchanged within noise. |
| help | 1.90% | 1.90% | Unchanged. |
| profile | 17.49% | 18.51% | **Moved the wrong way by ~1pp and NOT isolated.** The page's diff is dominated by the signed-in header pieces this stack does not render (the `My Friends / My Groups / My Rooms / Help / Sign Out` strip, the `Housekeeping` tab and the `Enter PHPRetro` button), and this port renders four boxes where legacy renders one. `landing` reaching 92px makes a chrome-geometry regression unlikely, but it was not proven either way. |
| tag | — | 1.91% | New: `/tag` and `/papers/*` were ported, so these are comparable now. |
| papers-disclaimer | — | 2.96% | New. The residual is the honest "not published yet" sentence, which legacy renders as an empty box. |
| papers-privacy | — | 2.97% | New, same reason. |

`maintenance` is captured with `site_closed=1` on **both** stacks. Setting it on
the new stack alone is not enough and produced a 99.4% reading: the legacy stack
serves `/maintenance` from its own database *and* caches the whole
`phpretro_site_settings` table in `/var/www/html/cache/*.cache` with no expiry,
so the row must be set there too and that cache cleared.
