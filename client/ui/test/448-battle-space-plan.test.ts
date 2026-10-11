/* ROUND 7 — THE FIGHT BLOCK GROWS (report #204, CT-278; docs/18 § Round 7).
 *
 * The owner: "There are so many moments where there is an absolute ton of
 * unused space on screen, but the units and the 'important' area is all
 * scrunched into the side of the screen." Measured on HPTR before the round:
 * the fight's block was half the board wide and a fixed share of its height,
 * the cards covered 5–13% of the board, a two-column, four-rank fight stood at
 * 43px beside a 1048×388 empty rectangle at 1440×900, and at 1280×720 its back
 * blocker rank was cut off.
 *
 * ui/fit.ts planBattleBoard decides the board's shape in a battle; this pins
 * its arithmetic on the boards HPTR was measured on (the `.lboard` content
 * boxes at 1280×720, 1344×768, 1440×900 and 1920×1080, and a narrow one).
 *
 * §1 the fight's column takes most of the width; the idle one is a narrow band
 * §2 the HPTR four-rank fight: bigger at 1440×900, every rank standing at 1280×720
 * §3 units grow to the owner's ~120px cap where there is room, never past it
 * §4 the height the fight cannot use goes back to the bands, all of it
 * §5 the idle column is as wide as what it holds wants, within its bounds
 * §6 more columns or more ranks never mean bigger cards
 * §7 the DOM pass writes the shape on the board before any zone is fitted
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleMeasure, FLOOR, IDLE_SHARE, planBattleBoard, SEND_SLOT_SPAN, type BattleBoardIn } from '../fit.ts';
import { BAND, BATTLE_CAP, fitBoard, GROW } from '../layout.ts';

/** the `.lboard` content boxes measured on HPTR (board box less its 2+4px padding) */
const BOARDS: Record<string, { w: number; h: number }> = {
  '1280x720': { w: 1006, h: 464 },
  '1344x768': { w: 1070, h: 512 },
  '1440x900': { w: 1166, h: 622 },
  '1920x1080': { w: 1226, h: 802 },
  'narrow 860x1000 (rail drawer)': { w: 844, h: 730 },
};
const CHROME = { w: 20, h: 20 };

function input(board: { w: number; h: number }, cols: number, ranksTop: number, ranksBot: number,
  idle: Partial<BattleBoardIn['idle']> = {}): BattleBoardIn {
  return {
    board, gapX: 8, gapY: 6, cols, ranksTop, ranksBot,
    o: { cw: BATTLE_CAP, gap: 6, chrome: 8, floor: 40, side: { n: 0, frac: 0.6, pad: 12 } },
    chrome: CHROME, bandMin: BAND.two, bandFloor: BAND.one,
    idle: { send: false, cards: 0, invaders: 0, pad: 20, gap: 6, rowCw: 52, lineCw: 78, floor: FLOOR, ...idle },
  };
}
const plan = (i: BattleBoardIn) => {
  const p = planBattleBoard(i);
  assert.ok(p, 'a board with a box gets a plan');
  return p;
};
/** the fight block's box under a plan (style.css `.lboard[data-fight]`: the
 * band split stays at half, the fight's column is the board less the idle
 * column; three row gaps are outside the fight) */
const fightBox = (i: BattleBoardIn, p: { idle: number; bandTop: number; bandBot: number }) =>
  ({ w: i.board.w - i.gapX - p.idle, h: i.board.h - 3 * i.gapY - p.bandTop - p.bandBot });

const BATTLES: Array<[number, number, number]> = [[1, 1, 1], [2, 2, 2], [3, 0, 2], [2, 1, 2], [5, 1, 1], [7, 0, 1], [9, 2, 2]];

test('§1 the fight column takes most of the board; the idle one is a narrow band at the side', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const i = input(board, c, t, b);
      const p = plan(i);
      const f = fightBox(i, p);
      // the old board gave the fight exactly half the width, whatever it held
      assert.ok(f.w >= board.w * (1 - IDLE_SHARE) - i.gapX,
        `${name}, ${c} cols ${t}+${b}: the fight is ${f.w} of ${board.w}px wide`);
      assert.ok(p.idle <= Math.max(i.idle.pad + FLOOR, board.w * IDLE_SHARE), `${name}: idle ${p.idle}px`);
      assert.ok(p.idle >= i.idle.pad + FLOOR, `${name}: the idle band still holds one card at the floor`);
    }
  }
  assert.ok(IDLE_SHARE <= 0.25, 'a narrow band: a quarter of the board at most');
});

test('§2 the HPTR four-rank fight grows at 1440x900 and every rank stands at 1280x720', () => {
  const m = battleMeasure(2, 2, 2, input(BOARDS['1440x900']!, 2, 2, 2).o);
  // before: 43px at 1440x900 (cols box 559×296)
  const big = input(BOARDS['1440x900']!, 2, 2, 2);
  const pb = plan(big);
  assert.ok(pb.cw >= 60, `1440x900: the four-rank fight stands at ${pb.cw}px (it was 43)`);
  // (less than one card-width step of the four ranks may come back to them)
  assert.ok(pb.bandTop + pb.bandBot <= 2 * BAND.two + 6, `the bands stay at two lines (${pb.bandTop}+${pb.bandBot})`);
  // before: 40px and the back rank clipped — the floor did not stand in 212px
  for (const name of ['1280x720', '1344x768']) {
    const i = input(BOARDS[name]!, 2, 2, 2);
    const p = plan(i);
    const f = fightBox(i, p);
    assert.ok(p.cw >= 40, `${name}: never under the battle floor (${p.cw})`);
    assert.ok(m.height(p.cw) + CHROME.h <= f.h,
      `${name}: all four ranks stand in the block (${m.height(p.cw) + CHROME.h} in ${f.h}px)`);
    assert.ok(p.bandTop >= BAND.one && p.bandBot >= BAND.one, `${name}: the name-and-life line always stands`);
  }
});

test('§3 units grow to the owner cap of about 120px where there is room, and never past it', () => {
  assert.equal(BATTLE_CAP, 120, 'the owner\'s number (2026-10-11): "a moderate cap"');
  assert.ok(BATTLE_CAP > Math.round(78 * GROW), 'above the field\'s cap the battle used to share');
  const roomy = plan(input(BOARDS['1920x1080']!, 1, 1, 1));
  assert.equal(roomy.cw, BATTLE_CAP, 'one column a rank a side at 1920x1080 reaches the cap');
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const p = plan(input(board, c, t, b));
      assert.ok(p.cw <= BATTLE_CAP && p.cw >= 40, `${name} ${c}/${t}+${b}: ${p.cw}px`);
    }
  }
});

test('§4 what the fight cannot use goes back to the bands, and the bands never fall under the name line', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const i = input(board, c, t, b);
      const p = plan(i);
      const m = battleMeasure(c, t, b, i.o);
      const f = fightBox(i, p);
      assert.ok(p.bandTop >= BAND.one && p.bandBot >= BAND.one, `${name} ${c}/${t}+${b}: bands ${p.bandTop}/${p.bandBot}`);
      assert.ok(Math.abs(p.bandTop - p.bandBot) <= 1, `${name}: the two bands share alike`);
      const need = m.height(p.cw) + CHROME.h;
      if (p.bandTop > BAND.two) {
        // the bands grew: only by what the fight could not use
        assert.ok(f.h - need >= 0 && f.h - need <= 1, `${name} ${c}/${t}+${b}: the fight keeps ${f.h - need}px it does not need`);
      }
    }
  }
  // a one-rank fight at 1920 leaves most of the height: the bands take it
  const i = input(BOARDS['1920x1080']!, 7, 0, 1);
  const p = plan(i);
  assert.ok(p.bandTop > 2 * BAND.two, `seven columns one rank deep: the bands get ${p.bandTop}px`);
});

test('§5 the idle column holds what it holds: the send slot, the counterattackers on their way, its invaders', () => {
  const board = BOARDS['1440x900']!;
  const empty = plan(input(board, 2, 2, 2));
  assert.equal(empty.idle, 20 + FLOOR, 'empty: one floor card and its padding');
  const send = plan(input(board, 2, 2, 2, { send: true }));
  assert.ok(send.idle >= 20 + SEND_SLOT_SPAN * FLOOR + 6, `the send box keeps its two-card slot (${send.idle}px)`);
  const three = plan(input(board, 2, 2, 2, { cards: 3 }));
  assert.equal(three.idle, 20 + 3 * 58 - 6, 'three counterattackers on their way stand one row deep at the row size');
  const many = plan(input(board, 2, 2, 2, { cards: 12 }));
  assert.equal(many.idle, Math.round(board.w * IDLE_SHARE), 'twelve stop at a quarter of the board and wrap');
  // a fight that needs the width keeps it: twelve columns at 1280 leave the idle at its least
  const wi = input(BOARDS['1280x720']!, 12, 1, 1, { cards: 4 });
  const wide = plan(wi);
  assert.ok(wide.idle < 20 + 4 * 58 - 6, `the premise: the idle band gets less than it wants (${wide.idle}px)`);
  assert.ok(battleMeasure(12, 1, 1, wi.o).width(wide.cw) + CHROME.w <= fightBox(wi, wide).w,
    'the fight\'s columns are never squeezed for the idle band');
});

test('§6 more columns or more ranks never mean bigger cards', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    let last = Infinity;
    for (let c = 1; c <= 10; c++) {
      const p = plan(input(board, c, 2, 2));
      assert.ok(p.cw <= last, `${name}: ${c} columns got ${p.cw}px, ${c - 1} got ${last}`);
      last = p.cw;
    }
    const shallow = plan(input(board, 3, 1, 1)), deep = plan(input(board, 3, 2, 2));
    assert.ok(deep.cw <= shallow.cw, `${name}: four ranks ${deep.cw} vs two ${shallow.cw}`);
  }
  // nothing placed yet is planned as one column a rank a side: the block does
  // not collapse into the bands and spring back on the first unit placed
  const none = plan(input(BOARDS['1440x900']!, 0, 0, 0)), one = plan(input(BOARDS['1440x900']!, 1, 1, 1));
  assert.deepEqual(none, one);
  assert.equal(planBattleBoard(input({ w: 0, h: 0 }, 2, 1, 1)), null, 'no box (the test driver), no plan');
});

test('§7 the DOM pass writes the shape onto a fighting board before any zone is fitted', () => {
  const g = globalThis as { getComputedStyle?: unknown };
  const had = g.getComputedStyle;
  g.getComputedStyle = () => ({ getPropertyValue: () => '', columnGap: '8px', rowGap: '6px' });
  try {
    const rect = (w: number, h: number) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h });
    const vars = new Map<string, string>();
    const style = { setProperty: (k: string, v: string) => { vars.set(k, v); }, getPropertyValue: () => '' };
    const none = { length: 0 };
    const cols = { style: { getPropertyValue: (v: string) => (v === '--rowstop' || v === '--rowsbot' ? '2' : '') },
      querySelectorAll: () => ({ length: 2 }) };
    const fight = { querySelector: (sel: string) => (sel === '.cols' ? cols : null), querySelectorAll: () => none };
    const idle = { dataset: { region: '1' }, classList: { contains: () => false }, querySelectorAll: () => none };
    const lb = {
      style, getBoundingClientRect: () => rect(1166, 622), querySelectorAll: () => none,
      querySelector: (sel: string) => (sel === '.lfight.focus' ? fight : sel === '.lfight:not(.focus)' ? idle : null),
    };
    const root = { querySelector: (sel: string) => (sel === '.lboard[data-fight]' ? lb : null), querySelectorAll: () => [] } as unknown as ParentNode;
    fitBoard(root, 78);
    // the stand-in's paddings are all zero (the stub reads every one as '')
    const p = plan({ ...input(BOARDS['1440x900']!, 2, 2, 2, { pad: 0 }), chrome: { w: 0, h: 0 } });
    assert.deepEqual(Object.fromEntries(vars), { '--lidle': `${p.idle}px`, '--lbandt': `${p.bandTop}px`, '--lbandb': `${p.bandBot}px` },
      'the board gets the plan for what it holds');
  } finally { g.getComputedStyle = had; }
});
