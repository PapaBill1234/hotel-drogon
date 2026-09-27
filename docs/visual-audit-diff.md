# Pixel difference: legacy vs new

Ranked worst first. `ratio` is the fraction of the frame whose RGB differs,
computed by decoding both captures written by `audit.spec.ts`.

Re-measured in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image
after two units in the same session:

1. **the `Rounder` DOM-ownership fix**, which froze any React update inside a
   `.cbb` box, so box titles that interpolate settings rendered empty; and
2. **the signed-in header port**, which replaced the invented `#subnavi-logout` /
   `#subnavi-hotel` blocks with `community_header.php`'s real
   `#subnavi-user` / `#subnavi-search` / `#to-hotel`.

Everything except the four signed-in rows came back **byte-identical** across
both re-measurements, which is the control: the `hk-*` panel renders no `.cbb`
boxes and does not use the community shell, and the public pages' anonymous
header was not touched.

| page | differing | detail |
| --- | --- | --- |
| hk-settings | 48.90% | 500694 px differ |
| me | 41.63% | 426251 px differ |
| hk-banners | 30.70% | 314378 px differ |
| hk-faq | 29.97% | 306863 px differ |
| hk-news | 28.56% | 292495 px differ |
| hk-dashboard | 28.48% | 291605 px differ |
| hk-campaigns | 27.52% | 281769 px differ |
| hk-collectables | 27.07% | 277207 px differ |
| profile | 17.05% | 174609 px differ |
| hk-login | 10.55% | 108011 px differ |
| credits | 5.68% | 58181 px differ |
| collectables | 5.45% | 55818 px differ |
| community | 5.12% | 52405 px differ |
| papers-privacy | 2.97% | 30445 px differ |
| papers-disclaimer | 2.96% | 30356 px differ |
| forgot | 2.29% | 23415 px differ |
| articles | 2.01% | 20555 px differ |
| tag | 1.91% | 19542 px differ |
| help | 1.90% | 19503 px differ |
| credits-history | 0.83% | 8509 px differ |
| maintenance | 0.54% | 5541 px differ | (site_closed=1 on BOTH stacks)
| landing | 0.01% | 92 px differ |

## Changes in this session

| page | at session start | `Rounder` fix | header port | note |
| --- | --- | --- | --- | --- |
| landing | 0.24% | **0.01%** (92 px) | — | The box chrome, ported to React, is pixel-identical. The strongest single piece of evidence that the `visual.js` transcription is faithful. |
| credits | 13.45% | 7.11% | **5.68%** | `#credits-methods`' heading interpolates `site_shortname` and had been frozen; then the signed-in header. |
| credits-history | 4.82% | 2.25% | **0.83%** | Same two causes. |
| profile | 17.49% | 18.51% | **17.05%** | The 18.51% reading was the header regression, now fixed; the residual is the unbuilt MyHabbo blocks. |
| me | 43.45% | 43.08% | **41.63%** | Still dominated by the unbuilt MyHabbo widgets (Phases 6-8). |
| collectables | 5.78% | 5.45% | — | — |
| community | 5.11% | 5.12% | — | Unchanged within noise. |
| articles | 2.00% | 2.01% | — | Unchanged within noise. |
| help | 1.90% | 1.90% | — | Unchanged. |
| forgot | 2.44% | 2.29% | — | The heading defect is a handful of pixels; it was diagnosed by code points, not by this ratio. |
| tag | — | 1.91% | — | Newly comparable: `/tag` was ported. |
| papers-disclaimer | — | 2.96% | — | Newly comparable. Residual is the honest "not published yet" sentence, which legacy renders as an empty box. |
| papers-privacy | — | 2.97% | — | Newly comparable, same reason. |
| all `hk-*` | — | identical | identical | Control: unaffected by either change. |

## Measurement traps this file has hit

- `maintenance` is captured with `site_closed=1` on **both** stacks. Setting it
  on the new stack alone produced a 99.4% reading: the legacy stack serves
  `/maintenance` from its **own database** (`legacy_db`, not `hotel_mariadb`)
  *and* caches the whole `phpretro_site_settings` table in
  `/var/www/html/cache/*.cache` with no expiry, so the row must be set there too
  and that cache cleared.
- The audit's signed-in guard is checked on the target page, and it must use a
  marker the **legacy template itself** guarantees. It used to look for
  `#myhabbo`, an id the port had invented; porting the real header removed it,
  and the guard then reported every signed-in page `UNAUTH` and skipped the
  screenshot **without failing**, leaving the previous PNGs in place. The
  re-measurement looked like "the header fix changed nothing" because it was
  diffing stale files. It now uses the same `#subnavi-user && !#subnavi-login`
  test the legacy side uses.
