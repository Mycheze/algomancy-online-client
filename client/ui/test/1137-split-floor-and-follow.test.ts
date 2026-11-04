/* THE DIVIDER CAN ALWAYS BE BROUGHT BACK (BL-65 fix, 2026-11-04).
 *
 * Owner: "I dragged up the space to better see the cards, but now I can't
 * drag it back down to see the whole card pool again." Measured in real
 * Firefox and Chrome: at the smallest split on a 1024×768 window the pool was
 * 77px tall and its filter bar 88px (152px at 768 wide). The pool kept
 * shrinking under its own bar, the bar and the results spilled out over the
 * divider, and elementFromPoint at ▲ and ▼ found `.ttpoolresults` /
 * `.ttpoolbar`, not the buttons — the divider was drawn under the cards.
 *
 *   §1 the pool has a floor (its bar and a strip of results) and clips: it
 *      is floored by its content (min-height auto), the results' cards are
 *      kept out of that content (contain: size), and nothing spills
 *      (overflow: clip — `hidden` would zero the floor)
 *   §2 the grip follows the pointer: the share is of the pool and the table
 *      (not the whole builder), from the pool's top, keeping where the
 *      divider was taken hold of
 *   §3 dragged past the floor, the release stores what is DRAWN, so the
 *      next ▼ grows the pool by a whole step
 *   §4 ▲ ▼ step from the drawn split too
 *
 * Seeds: none. §2–§3 drive ui/splitter.ts's own pointer listener over a
 * small fake layout whose pool has a floor, as the CSS gives it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
/** every declaration block whose selector list is exactly `sel` */
const blocks = (sel: string): string[] => {
  const out: string[] = [];
  const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/ /g, '\\s*');
  for (const m of css.matchAll(new RegExp(`(?<=^|})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))) out.push(m[1]!);
  return out;
};

test('§1 the pool is floored at its bar and clips; nothing of it reaches the divider', () => {
  const pool = blocks('.ttbuilder > .ttpool').join(';');
  assert.match(pool, /min-height:\s*auto/, 'floored at its content, not min-height: 0');
  assert.match(pool, /overflow:\s*clip/, 'and clips what is under the floor');
  assert.doesNotMatch(pool, /overflow:\s*hidden/, 'hidden would make it a scroll container, and its floor 0');
  const res = blocks('.ttbuilder > .ttpool > .ttpoolresults').join(';');
  assert.match(res, /contain:\s*size/, "the results' cards are not part of the floor");
  const min = /min-height:\s*(\d+)px/.exec(res);
  assert.ok(min && Number(min[1]) >= 20, 'a strip of the results shows at the floor');
  // the generic rules come later in the file at a lower specificity: they must not be the builder's
  assert.ok(blocks('.ttpool').some(b => /min-height:\s*0/.test(b)), '(the generic .ttpool rule is still min-height: 0)');
  assert.doesNotMatch(css, /\.ttbuilder\s*>\s*\.ttpool\s*\{[^}]*min-height:\s*0/, 'no builder rule takes the floor away');
});

/* ── a fake layout: the pool gets f of the span, never less than FLOOR ── */
const POOL_TOP = 65, SPAN = 640, DIV = 24, FLOOR = 128;
const STORE = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g['localStorage'] = { getItem: (k: string) => STORE.get(k) ?? null, setItem: (k: string, v: string) => { STORE.set(k, v); } };
const docHandlers: Record<string, (e: unknown) => void> = {};
g['document'] = { addEventListener: (t: string, fn: (e: unknown) => void) => { docHandlers[t] = fn; } };
let f = 0.4;
const poolH = (): number => Math.max(FLOOR, f * SPAN);
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, width: 1000 });
const pool = { getBoundingClientRect: () => rect(POOL_TOP, poolH()) };
const divider = { getBoundingClientRect: () => rect(POOL_TOP + poolH(), DIV) };
const table = { getBoundingClientRect: () => rect(POOL_TOP + poolH() + DIV, SPAN - poolH()) };
const root = {
  classList: { add: () => {}, remove: () => {} },
  style: { setProperty: (_k: string, v: string) => { f = Number(v); } },
  getBoundingClientRect: () => rect(POOL_TOP, SPAN + DIV),
  querySelector: (s: string) => (/ttpool\b/.test(s) && !/results/.test(s) ? pool : /ttdivider/.test(s) ? divider : /tttablewrap/.test(s) ? table : null),
};
const gripHandlers: Record<string, (e: unknown) => void> = {};
const grip = {
  closest: (s: string) => (s === '[data-tt-grip]' ? grip : s === '.ttbuilder' ? root : null),
  setPointerCapture: () => {},
  addEventListener: (t: string, fn: (e: unknown) => void) => { gripHandlers[t] = fn; },
  removeEventListener: (t: string) => { delete gripHandlers[t]; },
};
const { installSplitter, readSplit, shownSplit, stepSplit } = await import('../splitter.ts');
let repainted = 0;
installSplitter(() => { repainted++; });

test('§2 the divider moves with the pointer, wherever on the grip it was taken', () => {
  const dividerTop = (): number => divider.getBoundingClientRect().top;
  const grabAt = dividerTop() + 15;        // a little below the grip's middle
  docHandlers['pointerdown']!({ target: grip, button: 0, pointerId: 1, clientY: grabAt, preventDefault: () => {} });
  for (const y of [300, 420, 480, 260]) {
    gripHandlers['pointermove']!({ clientY: y });
    assert.ok(Math.abs(dividerTop() - (y - 15)) <= 1, `pointer at ${y}: the divider's top is at ${dividerTop()}, not ${y - 15}`);
  }
});

test('§3 dragged past the floor, the release stores the drawn split', () => {
  gripHandlers['pointermove']!({ clientY: 0 });
  assert.equal(poolH(), FLOOR, 'the pool stops at its floor');
  gripHandlers['pointerup']!({});
  assert.equal(repainted, 1);
  assert.equal(readSplit(), FLOOR / SPAN, `stored ${readSplit()}: what is drawn (${FLOOR / SPAN}), not the 0.12 the pointer asked for`);
  assert.equal(gripHandlers['pointermove'], undefined, 'the gesture let go');
  assert.ok(Math.max(FLOOR, stepSplit(readSplit(), 1) * SPAN) > FLOOR, 'so one ▼ grows the pool');
});

test('§4 ▲ ▼ step from the drawn split', () => {
  f = 0.12;                                 // what a player stored before the fix
  assert.equal(shownSplit(root as unknown as Element), FLOOR / SPAN, 'drawn at the floor');
  assert.ok(Math.max(FLOOR, stepSplit(shownSplit(root as unknown as Element)!, 1) * SPAN) > FLOOR, 'a ▼ from there is a whole step up');
  const tt = readFileSync(new URL('../tabletop.ts', import.meta.url), 'utf8');
  assert.match(tt, /case 'tt-split': writeSplit\(stepSplit\(shownSplit\(el\.closest\?\.\('\.ttbuilder'\) \?\? null\) \?\? readSplit\(\),/,
    'the tap route steps from what is drawn, the stored split only without a layout');
});
