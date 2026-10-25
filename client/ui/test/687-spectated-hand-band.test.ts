/* 687 — A SPECTATOR'S VIEW OF THE TOP SEAT'S HAND IN A BATTLE AT 1280x720
 * (CT-419, after CT-368 / test 674).
 *
 * CT-368 gave the spectated hand (`.lspect`) a column of its own in the top
 * info block. Measured in headless Chrome on 2026-10-25, live watch (BL-29,
 * `?watch=1`, both seats connected), a one-rank-a-side fight, the top seat
 * with 5 resources in 3 groups:
 *   - 1280x720: bands 109/110px either side of the 223px fight; the block
 *     took the squeezed two-row shape (it switched at 132px), the strip was
 *     153px wide: two cards 56x78, four 35x49.
 *   - with many resource groups (13 resources in 8) the name column, an `auto`
 *     track, widened until the strip (a bare 1fr) had NOTHING: 0px, no card
 *     showing, at 1280x720 AND at 1440x900.
 * Whole 92x128 cards need the top band at ~160px; at 1280x720 that height is
 * the fight's (one rank a side at the 100px cap), so it is not taken. What is
 * done, without a pixel of the fight's height:
 *   §1 planBattleBoard: while a strip is drawn, the top band takes the spare
 *      height first, up to what the strip's cards can use at its width (the
 *      bottom band keeps what step 1 gave it, the fight is unchanged);
 *   §2 the strip's squeezed shape only under 90px, where its three rows do not
 *      fit;
 *   §3 the strip keeps at least 35% of the block's width in both shapes.
 * After, same boards: 1280x720 two cards 78x108 (bands 139/80), four 40x55
 * (bands unchanged: width-bound); 1366x768 two cards whole 92x128 (were
 * 74x102), four 50x70 (46x64); 13 resources: four cards 39x54 at 1280x720 and
 * 46x64 at 1440x900 (were 0). 1440x900 and up with few resources: unchanged.
 * The rules question board is not helped at 1280x720 (85/80px bands: its
 * replay bar's reserve leaves 5px spare) — the report says so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLOOR, planBattleBoard, type BattleBoardIn } from '../fit.ts';
import { BAND, BATTLE_CAP, SPECT_CW } from '../layout.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');

/** the `.lboard` content boxes: 1280x720 live watch (measured, 472 less 6) and 1440x900 */
const WATCH_720 = { w: 1000, h: 466 };
const WATCH_900 = { w: 1160, h: 624 };
/** the band height a strip of whole cards wants (measured: the block, label and gap around a 129px card) */
const WANT = 160;

function input(board: { w: number; h: number }, spect?: number): BattleBoardIn {
  return {
    board, gapX: 8, gapY: 6, cols: 2, ranksTop: 0, ranksBot: 1,
    o: { cw: BATTLE_CAP, gap: 6, chrome: 8, floor: 40, side: { n: 0, frac: 0.6, pad: 12 } },
    chrome: { w: 20, h: 20 }, bandMin: BAND.two, bandFloor: BAND.one,
    idle: { send: false, pad: 20, gap: 6, floor: FLOOR },
    ...(spect !== undefined ? { spect } : {}),
  };
}
const plan = (i: BattleBoardIn) => { const p = planBattleBoard(i); assert.ok(p); return p; };

test('CT-419: while a spectated hand is drawn the top band takes the spare height first, and the fight keeps every pixel', () => {
  const plain = plan(input(WATCH_720));
  const spect = plan(input(WATCH_720, WANT));
  assert.equal(spect.cw, plain.cw, 'the fight stands at the same card width');
  assert.equal(spect.fight, plain.fight);
  assert.equal(spect.bandTop + spect.bandBot, plain.bandTop + plain.bandBot, 'the fight is as tall as it was');
  assert.ok(Math.abs(plain.bandTop - plain.bandBot) <= 1, `without a strip the spare is split evenly (${plain.bandTop}/${plain.bandBot})`);
  assert.ok(spect.bandTop > plain.bandTop, `the top band grows (${plain.bandTop} -> ${spect.bandTop})`);
  assert.ok(spect.bandBot >= BAND.two, `the bottom band keeps its two lines (${spect.bandBot})`);
  assert.ok(spect.bandTop <= WANT, 'and takes no more than the strip wants');
});

test('CT-419: where the even share already stands the strip at full size, nothing moves', () => {
  const plain = plan(input(WATCH_900));
  assert.ok(plain.bandTop >= WANT, `1440x900 gives the top band ${plain.bandTop}px`);
  assert.deepEqual(plan(input(WATCH_900, WANT)), plain);
  // and a spect of nothing changes no plan
  assert.deepEqual(plan(input(WATCH_720, 0)), plan(input(WATCH_720)));
});

test('CT-419 wiring: the board pass asks the strip what height it wants, off the stylesheet sizes and the dock card', () => {
  const src = read('../layout.ts');
  assert.match(src, /spect: spectWant\(lb\),/, 'shapeBoard hands planBattleBoard the strip want');
  assert.equal(SPECT_CW, 92);
  assert.match(CSS, /\.linfo \.lspect > \.zone > \.card \{ flex: 0 1 min\(92px,/, 'the strip caps its cards at the same 92px');
});

/** the body of the rule for `sel` inside `@container (max-height: Npx)`, and N */
function squeezed(sel: string): { px: number; body: string } | null {
  const re = /@container \(max-height: (\d+)px\) \{([\s\S]*?)\n\}/g;
  for (const m of CSS.matchAll(re)) {
    const i = m[2]!.indexOf(`${sel} {`);
    if (i >= 0) return { px: Number(m[1]), body: m[2]!.slice(i, m[2]!.indexOf('}', i)) };
  }
  return null;
}

test('CT-419: the strip takes its squeezed two-row shape only where its three rows cannot stand, under 90px', () => {
  const sel = '.linfo.theirs > .lin:has(> .lspect)';
  const sq = squeezed(sel);
  assert.ok(sq, 'the squeezed strip shape is in a container query');
  assert.ok(sq.px <= 90, `it switches at ${sq.px}px; the name, resources and hand line stand in ~90px`);
  assert.match(sq.body, /"id hand spect cache bin"/);
});

test('CT-419: in both shapes the strip keeps at least 35% of the block width, however wide the resources grow', () => {
  const sel = '.linfo.theirs > .lin:has(> .lspect)';
  const bodies: string[] = [];
  for (let i = CSS.indexOf(`${sel} {`); i >= 0; i = CSS.indexOf(`${sel} {`, i + 1)) bodies.push(CSS.slice(i, CSS.indexOf('}', i)));
  assert.equal(bodies.length, 2);
  for (const b of bodies) {
    const cols = /grid-template-columns:([^;]*);/.exec(b)?.[1]?.trim().split(/\s+(?![^(]*\))/) ?? [];
    const areas = (/grid-template-areas:\s*"([^"]*)"/.exec(b)?.[1] ?? '').split(/\s+/);
    const at = areas.indexOf('spect');
    assert.ok(at >= 0, b);
    assert.equal(cols[at], 'minmax(35%, 1fr)', `the strip's track in ${areas.join(' ')}`);
  }
});
