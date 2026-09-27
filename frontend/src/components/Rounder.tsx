import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * A React port of the legacy `Rounder` (web-gallery/static/js/visual.js).
 *
 * ## Why this exists at all
 *
 * The legacy pages do not ship the box chrome you see in a browser. They ship
 * flat `<div class="cbb ...">` boxes and then `Rounder.init()` rewrites them
 * into the sprite-backed border markup that `style.css` actually styles:
 *
 *   .cbb           -> div.cb   > .bt, .i1 > .i2 > .i3, .bb
 *   .cbb .title    -> .rounded-container > gradient rows + h2.title.rounded-done
 *   .rounded       -> .rounded-container (radius 8) around the element
 *
 * `style.css:1228-1289` gives `.bt`/`.bb` their corner sprites and `.i1`/`.i2`
 * their repeating borders, and `#content .green .i3 { background-color: … }`
 * and friends give each theme its fill. Remove the rewrite and the boxes lose
 * their frames: measured on this stack, `/` goes from **7.7% to 36.0%** pixel
 * difference against its legacy baseline and `/community` from **6.0% to
 * 20.7%**. So the rewrite is load-bearing and had to be reproduced, not dropped.
 *
 * ## Why it could not simply keep calling the legacy function
 *
 * `Rounder` mutates DOM that React owns, and it does it destructively:
 *
 *   - `addCorners` does `N.cloneNode(true)` and `parentNode.replaceChild(I, N)`
 *     (`visual.js:226`). React's node is thrown away and the visible node is a
 *     clone with no `__reactFiber$`, so every later React update to it is
 *     written to a detached node and never appears.
 *   - `addCorners`/`B` also move React's node under a wrapper React knows
 *     nothing about, so a later React removal calls `removeChild` on a parent
 *     that no longer holds it.
 *
 * That first bullet is not theoretical: it is why `/forgot`'s second heading
 * rendered the literal string `"Forgotten Your  Name?"` (code points `20 20`)
 * on a page whose settings query had resolved `site_shortname: "Retro"`. The
 * provider published `Retro`, the consumer *read* `Retro`, and the screen still
 * showed the empty first-render value — because the `<h2>` on screen was
 * Rounder's clone. Instrumented, the same page had **106 of 167** React nodes
 * orphaned; `/credits/collectables` had 183 of 316.
 *
 * ## How this port avoids that
 *
 * Every node below is rendered BY React, so React keeps ownership and the
 * markup is identical to what `Rounder` produced. The gradient rows depend on
 * computed background colours, so they are built in a layout effect and
 * committed before paint — the same ordering `Rounder` had (it ran on DOM
 * ready), without the node replacement.
 *
 * The geometry is a direct transcription of `visual.js`, including its use of
 * `substring` bounds that look like typos; see `rgbToHex`.
 */

// ---------------------------------------------------------------------------
// visual.js primitives, transcribed
// ---------------------------------------------------------------------------

/** `visual.js: D` — square. */
function sq(n: number): number {
  return n * n;
}

/**
 * `visual.js: A` — `"rgb(1, 2, 3)"` to `"#010203"`.
 *
 * The legacy builds this with `("0" + parseInt(part).toString(16)).slice(-2)`
 * and no bounds check, so a `rgb()` with a component above 255 yields a
 * three-digit hex. Kept as-is: the value feeds `mix`, and changing the shape
 * here would change the drawn colours.
 */
function rgbToHex(rgb: string): string {
  const m = /([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)/.exec(rgb);
  if (m === null) return rgb;
  let out = '';
  for (let i = 1; i < 4; i++) {
    out += ('0' + parseInt(m[i], 10).toString(16)).slice(-2);
  }
  return '#' + out;
}

/** `visual.js: F` — linear blend of two `#rrggbb` colours. */
function mix(from: string, to: string, t: number): string {
  const a = [
    parseInt(from.substring(1, 3), 16),
    parseInt(from.substring(3, 5), 16),
    parseInt(from.substring(5, 7), 16),
  ];
  const b = [
    parseInt(to.substring(1, 3), 16),
    parseInt(to.substring(3, 5), 16),
    parseInt(to.substring(5, 7), 16),
  ];
  // `visual.js: F` ends each channel with `("0" + Math.round(…).toString(16))
  // .slice(-2).toString(16)`. That trailing call is on a STRING, where
  // `toString` ignores its radix argument — it is inert, and TypeScript rejects
  // it outright. Dropping it changes nothing about the computed colour; the
  // radix that matters is the one applied to the number.
  const channel = (i: number) =>
    ('0' + Math.round(a[i] + (b[i] - a[i]) * t).toString(16)).slice(-2);
  return '#' + channel(0) + channel(1) + channel(2);
}

/**
 * `visual.js: E` — the background colour that is actually *seen* behind an
 * element, walking up past `transparent`/`rgba(...)` until something is opaque.
 *
 * This is why the rows can be built from React markup even though `Rounder`
 * measured the element before wrapping it: `.rounded-container` has no
 * background of its own, so the walk lands on the same `.i3` either way.
 */
function resolvedBackground(el: Element | null): string {
  if (el === null) return '#FFFFFF';
  let colour = window.getComputedStyle(el).getPropertyValue('background-color');

  if ((colour.indexOf('rgba') > -1 || colour === 'transparent') && el.parentNode) {
    if (el.parentNode !== el.ownerDocument) {
      colour = resolvedBackground(el.parentNode as Element);
    } else {
      colour = '#FFFFFF';
    }
  }
  if (colour.indexOf('rgb') > -1 && colour.indexOf('rgba') === -1) {
    colour = rgbToHex(colour);
  }
  // `visual.js` expands a 3-digit hex with `substring(1,1)`, `substring(2,1)`,
  // `substring(3,1)`. `substring` swaps inverted bounds, so this is "#" + "" +
  // "" + s[1] + s[1] + s.slice(1,3) + s.slice(1,3) — reproduced verbatim below
  // rather than "corrected", because it is what drew the legacy pixels.
  if (colour.length === 4) {
    colour =
      '#' +
      colour.substring(1, 1) +
      colour.substring(1, 1) +
      colour.substring(2, 1) +
      colour.substring(2, 1) +
      colour.substring(3, 1) +
      colour.substring(3, 1);
  }
  return colour;
}

/**
 * `visual.js: G` — one block of corner rows, as a list of parallel chains.
 *
 * Each row is a NESTED chain of 1px divs (each is the parent of the next), not
 * a list of siblings, and each chain hangs off the row container individually —
 * `P` is reset to `X` at the top of every `W` iteration. Both details change
 * the rendered height, so both are preserved.
 */
function buildCornerRows(start: string, end: string, radius: number, z: number): CSSProperties[][] {
  const rows: CSSProperties[][] = [];
  let s = 0;

  for (let w = 1; w <= z; w++) {
    const o = Math.sqrt(1 - sq(1 - w / z)) * radius;
    const k = radius - Math.ceil(o);
    const r = Math.floor(s);
    const y = radius - k - r;

    const chain: CSSProperties[] = [];
    let q: CSSProperties = { margin: `0px ${k}px`, height: '1px', overflow: 'hidden' };

    for (let v = 1; v <= y; v++) {
      let n: number;
      if (v === 1) {
        n = v === y ? (o + s) * 0.5 - r : 0;
      } else if (v === y) {
        const m = Math.sqrt(1 - sq((radius - k - v + 1) / radius)) * z;
        n = 1 - (1 - (m - (z - w))) * (1 - (s - r)) * 0.5;
      } else {
        const l = Math.sqrt(1 - sq((radius - k - v) / radius)) * z;
        const m = Math.sqrt(1 - sq((radius - k - v + 1) / radius)) * z;
        n = (m + l) * 0.5 - (z - w);
      }
      q.backgroundColor = mix(start, end, n);
      chain.push(q);
      q = { height: '1px', overflow: 'hidden', margin: '0px 1px' };
    }

    q.backgroundColor = end;
    chain.push(q);
    rows.push(chain);
    s = o;
  }

  return rows;
}

/** Render a `buildCornerRows` chain as nested divs, innermost first. */
function renderChain(chain: CSSProperties[], key: number): ReactNode {
  let el: ReactNode = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    el = <div style={chain[i]}>{el}</div>;
  }
  return <Fragment key={key}>{el}</Fragment>;
}

/**
 * The gradient rows themselves. `visual.js` inserted these around the element;
 * here they are plain children, so nothing outside React owns them.
 */
function CornerRows({
  start,
  end,
  radius,
  z,
}: {
  start: string;
  end: string;
  radius: number;
  z: number;
}) {
  const rows = buildCornerRows(start, end, radius, z);
  return <div style={{ backgroundColor: start }}>{rows.map((c, i) => renderChain(c, i))}</div>;
}

/**
 * Measure the two colours `Rounder` measured — the element's own resolved
 * background and its parent's — after the node is in the document.
 *
 * The rows cannot be computed during the first render: `getComputedStyle` needs
 * a laid-out node, and the colours come from the legacy stylesheets, which this
 * SPA injects per page AFTER mount (each shell renders its own `<link>` set).
 * Measuring too early reads `rgba(0, 0, 0, 0)` for everything and then bakes
 * the wrong colours in permanently, because a resolved colour never changes on
 * its own afterwards.
 *
 * So the measurement waits for every stylesheet to be APPLIED, not merely
 * requested — the same condition `tests/e2e/visual-parity.spec.ts` waits on,
 * for the same reason. `useLayoutEffect` still commits before paint in the
 * common case where the sheets are already parsed.
 */
function useCornerColours(ref: React.RefObject<HTMLElement>) {
  const [colours, setColours] = useState<{ start: string; end: string } | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;

    const measure = () => {
      const el = ref.current;
      if (el === null || cancelled) return;
      const end = resolvedBackground(el);
      const start = resolvedBackground(el.parentNode as Element | null);
      setColours((prev) =>
        prev !== null && prev.start === start && prev.end === end ? prev : { start, end },
      );
    };

    const sheetsApplied = () =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(
        (l) => (l as HTMLLinkElement).sheet !== null,
      );

    if (sheetsApplied()) {
      measure();
      return () => {
        cancelled = true;
      };
    }

    // Bounded: a stylesheet that 404s never sets `.sheet`, and this must not
    // poll forever. ~3s at 16ms is far longer than a local sheet takes.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (sheetsApplied() || attempts > 200) {
        window.clearInterval(timer);
        measure();
      }
    }, 16);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ref]);

  return colours;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * A legacy `.cbb` box.
 *
 * `Rounder.B` renamed the box (`cbb` -> `cb`), moved the id up to the wrapper,
 * reset the original element's class to exactly `i3`, and surrounded it with
 * `.i1 > .i2` and the `.bt`/`.bb` corner strips. `.notitle` boxes get no `.bb`
 * — that is `B`'s `O.indexOf("toponly") == -1` check, where `O` is the original
 * class string.
 */
export function Cbb({
  className = '',
  id,
  children,
}: {
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const wrapperClass = className.replace(/(^|\s)cbb(\s|$)/, '$1cb$2');
  const hasBottom = !/(^|\s)toponly(\s|$)/.test(className);

  return (
    <div className={wrapperClass} id={id}>
      <div className="bt">
        <div />
      </div>
      <div className="i1">
        <div className="i2">
          <div className="i3">{children}</div>
        </div>
      </div>
      {hasBottom && (
        <div className="bb">
          <div />
        </div>
      )}
    </div>
  );
}

/**
 * An `<h2 class="title">` inside a `.cbb`, which `Rounder.addCorners` wrapped
 * in a `.rounded-container` carrying a 4-row gradient above and below.
 *
 * `addCorners` cloned the node and replaced it; this renders the same markup
 * with the same node React already owns, which is the whole point of the port.
 */
export function BoxTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const colours = useCornerColours(ref);

  return (
    <div className="rounded-container">
      {colours !== null && (
        <CornerRows start={colours.start} end={colours.end} radius={4} z={4} />
      )}
      {/* `addCorners` dropped a `rounded` class and added `rounded-done`; a
          `.title` never had `rounded`, so the visible result is both classes. */}
      <h2 className="title rounded-done" ref={ref}>
        {children}
      </h2>
      {colours !== null && (
        <CornerRows start={colours.start} end={colours.end} radius={4} z={4} />
      )}
    </div>
  );
}

/**
 * A bare `.rounded` element, which `Rounder.init` processed first and with a
 * larger radius than box titles (`addCorners(J, 8, 8)`).
 */
export function Rounded({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const colours = useCornerColours(ref);

  return (
    <div className="rounded-container">
      {colours !== null && (
        <CornerRows start={colours.start} end={colours.end} radius={8} z={8} />
      )}
      {/* `removeClassName("rounded")` then `addClassName("rounded-done")`.
          `#habbos-online .rounded-done` is what carries the styling. */}
      <div className="rounded-done" ref={ref}>
        {children}
      </div>
      {colours !== null && (
        <CornerRows start={colours.start} end={colours.end} radius={8} z={8} />
      )}
    </div>
  );
}

/**
 * Stop the legacy `Rounder` from touching React's DOM.
 *
 * `App.tsx` calls `Rounder.init()` for parity and `visual.js:228` registers a
 * second call through `HabboView.run()`, so neutering the global before either
 * runs is the only way to stop it — skipping our own call is not enough, and
 * believing otherwise produced a measurement run in which two score sets were
 * identical and looked like "Rounder has no visual effect" when it had not been
 * disabled at all.
 *
 * This must be called before `HabboView.run()`.
 */
export function disableLegacyRounder(): void {
  const w = window as unknown as { Rounder?: { init?: () => void } };
  if (w.Rounder !== undefined) {
    w.Rounder.init = () => {
      /* intentionally empty: see the module comment */
    };
  }
}
