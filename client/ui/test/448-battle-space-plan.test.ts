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
 * The owner's correction to the first build (which gave the fight three
 * quarters of the board whatever it held): "it's taking up the space that it
 * doesn't need … the horizontal space should be expanded when needed", and
 * "the 120px cap is a bit big. I think it should cap at 100px/card during a
 * fight." So: height first, then only the width the columns need, never under
 * the old half; the rest stays with the other region.
 *
 * ui/fit.ts planBattleBoard decides the board's shape in a battle; this pins
 * its arithmetic at 1280×720, 1344×768, 1440×900 and 1920×1080, and a narrow
 * one. Board round 8 (owner, 2026-10-27) made each region a column and a
 * full-width info line, so the plan is over the board's WIDTH and the fight
 * COLUMN's height (between the two lines — measured on the review boards),
 * and the fight shares its column with ONE band: its region's In Play.
 *
 * §1 the fight is as wide as its columns need — never under the old half,
 *    and a fight that fits in half keeps the old half-and-half board
 * §2 the HPTR four-rank fight: bigger at 1440×900, every rank standing at 1280×720
 * §3 units grow to the owner's 100px cap where there is room, never past it
 * §4 the height the fight cannot use goes back to the band, all of it
 * §5 a wide attack pushes the other region aside only as far as it needs,
 *    and never past one floor card (two for the send slot)
 * §6 more columns or more ranks never mean bigger cards
 * §7 the DOM pass writes the shape on the board before any zone is fitted
 * §8 the band you build a formation from keeps its units at the slots' size
 * §9 a band holding a modded (taller) unit never stands shorter than that
 *    unit at the floor — and with nothing modded the plan is unchanged
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleMeasure, FLOOR, planBattleBoard, RATIO, SEND_SLOT_SPAN, type BattleBoardIn } from '../fit.ts';
import { BAND, BATTLE_CAP, fitBoard, GROW } from '../layout.ts';

/** the board's width and the fight column's height (board round 8, measured
 * on the board8-* review boards with a one-line action bar) */
const BOARDS: Record<string, { w: number; h: number }> = {
  '1280x720': { w: 1024, h: 410 },
  '1344x768': { w: 1088, h: 458 },
  '1440x900': { w: 1184, h: 580 },
  '1920x1080': { w: 1244, h: 736 },
  'narrow 860x1000 (rail drawer)': { w: 856, h: 660 },
};
const CHROME = { w: 20, h: 20 };

function input(board: { w: number; h: number }, cols: number, ranksTop: number, ranksBot: number,
  idle: Partial<BattleBoardIn['idle']> = {}): BattleBoardIn {
  return {
    board, gapX: 2, gapY: 2, cols, ranksTop, ranksBot,
    o: { cw: BATTLE_CAP, gap: 2, chrome: 6, floor: 40, side: { n: 0, frac: 0.6, pad: 8 } },
    chrome: CHROME, bandMin: BAND.want, bandFloor: BAND.least,
    idle: { send: false, pad: 10, gap: 6, floor: FLOOR, ...idle },
  };
}
const plan = (i: BattleBoardIn) => {
  const p = planBattleBoard(i);
  assert.ok(p, 'a board with a box gets a plan');
  return p;
};
/** the fight block's box under a plan: the fight's column (the board less the
 * idle column), less its In Play band and the one gap between them */
const fightBox = (i: BattleBoardIn, p: { idle: number; band: number }) =>
  ({ w: i.board.w - i.gapX - p.idle, h: i.board.h - i.gapY - p.band });
/** what the plan's columns need across, at its card width */
const needW = (i: BattleBoardIn, p: { cw: number }) => battleMeasure(Math.max(1, i.cols), i.ranksTop, i.ranksBot, i.o).width(p.cw) + CHROME.w;
const half = (i: BattleBoardIn) => (i.board.w - i.gapX) / 2;

const BATTLES: Array<[number, number, number]> = [[1, 1, 1], [2, 2, 2], [3, 0, 2], [2, 1, 2], [5, 1, 1], [7, 0, 1], [9, 2, 2]];

test('§1 the fight is as wide as its columns need, never under the old half', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const i = input(board, c, t, b);
      const p = plan(i);
      const f = fightBox(i, p);
      const need = needW(i, p), h = half(i);
      assert.equal(f.w, p.fight, `${name}: the two columns fill the board`);
      assert.ok(p.fight >= h, `${name} ${c}/${t}+${b}: never under the half it had (${p.fight} < ${h})`);
      if (need <= h) {
        assert.equal(p.wide, false, `${name} ${c}/${t}+${b}: needs ${need}px of ${h}, so no wider`);
        assert.equal(p.fight, h);
        assert.equal(p.idle, h, 'and the other region keeps its half');
      } else {
        assert.equal(p.wide, true);
        assert.ok(p.fight <= Math.max(need, h + i.gapX) + 1, `${name} ${c}/${t}+${b}: ${p.fight}px for a need of ${need}`);
        assert.ok(p.fight >= Math.min(need, board.w - i.gapX - (i.idle.pad + FLOOR)) - 1, `${name}: it gets what it needs`);
      }
    }
  }
  // HPTR s084 (two columns, four ranks) is height-bound: half and half, bigger units
  for (const name of ['1344x768', '1440x900', '1920x1080']) {
    assert.equal(plan(input(BOARDS[name]!, 2, 2, 2)).wide, false, `${name}: s084 stays half and half`);
  }
  // HPTR s129 (three columns at the cap) widens only by what it needs
  const i129 = input(BOARDS['1440x900']!, 3, 0, 2);
  const p129 = plan(i129);
  assert.equal(p129.cw, BATTLE_CAP);
  assert.equal(p129.wide, needW(i129, p129) > half(i129));
});

test('§2 the HPTR four-rank fight grows at 1440x900 and every rank stands at 1280x720', () => {
  const m = battleMeasure(2, 2, 2, input(BOARDS['1440x900']!, 2, 2, 2).o);
  const pb = plan(input(BOARDS['1440x900']!, 2, 2, 2));
  assert.ok(pb.cw >= 60, `1440x900: the four-rank fight stands at ${pb.cw}px (it was 43 before round 7)`);
  for (const name of ['1280x720', '1344x768']) {
    const i = input(BOARDS[name]!, 2, 2, 2);
    const p = plan(i);
    const f = fightBox(i, p);
    assert.ok(p.cw >= 40, `${name}: never under the battle floor (${p.cw})`);
    assert.ok(m.height(p.cw) + CHROME.h <= f.h, `${name}: all four ranks stand in the block (${m.height(p.cw) + CHROME.h} in ${f.h}px)`);
    assert.ok(p.band >= BAND.least, `${name}: the In Play band always stands`);
  }
});

test('§3 units grow to the owner cap of 100px where there is room, and never past it', () => {
  assert.equal(BATTLE_CAP, 100, 'the owner, on the board (2026-10-11): "it should cap at 100px/card during a fight"');
  assert.ok(BATTLE_CAP > Math.round(78 * GROW), 'above the field\'s cap the battle used to share');
  assert.equal(plan(input(BOARDS['1920x1080']!, 1, 1, 1)).cw, BATTLE_CAP, 'one column a rank a side at 1920x1080 reaches the cap');
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const p = plan(input(board, c, t, b));
      assert.ok(p.cw <= BATTLE_CAP && p.cw >= 40, `${name} ${c}/${t}+${b}: ${p.cw}px`);
    }
  }
});

test('§4 what the fight cannot use goes back to the band, and the band never falls under its floor', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    for (const [c, t, b] of BATTLES) {
      const i = input(board, c, t, b);
      const p = plan(i);
      const f = fightBox(i, p);
      const need = battleMeasure(c, t, b, i.o).height(p.cw) + CHROME.h;
      assert.ok(p.band >= BAND.least, `${name} ${c}/${t}+${b}: band ${p.band}`);
      if (p.band > BAND.want) {
        assert.ok(f.h - need >= 0 && f.h - need <= 1, `${name} ${c}/${t}+${b}: the fight keeps ${f.h - need}px it does not need`);
      }
    }
  }
  const p = plan(input(BOARDS['1920x1080']!, 7, 0, 1));
  assert.ok(p.band > 2 * BAND.want, `seven columns one rank deep: the band gets ${p.band}px`);
});

test('§5 a wide attack pushes the other region aside only as far as it needs, and never past a floor card', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    const i = input(board, 7, 0, 1);
    const p = plan(i);
    assert.equal(p.wide, true, `${name}: seven columns need more than half`);
    assert.ok(p.idle >= i.idle.pad + FLOOR, `${name}: the other column keeps one card at the floor (${p.idle})`);
    assert.ok(needW(i, p) <= p.fight + 1 || p.idle === i.idle.pad + FLOOR, `${name}: the line stands in its column`);
  }
  const send = plan(input(BOARDS['1280x720']!, 12, 1, 1, { send: true }));
  assert.ok(send.idle >= 10 + SEND_SLOT_SPAN * FLOOR + 6, `the send box keeps its slot (${send.idle}px)`);
  const nosend = plan(input(BOARDS['1280x720']!, 12, 1, 1));
  assert.ok(nosend.idle < 10 + FLOOR + 14, `twelve columns take all but about one floor card (${nosend.idle}px left)`);
  const wi = input(BOARDS['1440x900']!, 5, 1, 1);
  const wp = plan(wi);
  assert.ok(needW(wi, wp) <= fightBox(wi, wp).w, 'the fight\'s columns fit their column');
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
  const none = plan(input(BOARDS['1440x900']!, 0, 0, 0)), one = plan(input(BOARDS['1440x900']!, 1, 1, 1));
  assert.deepEqual(none, one);
  assert.equal(planBattleBoard(input({ w: 0, h: 0 }, 2, 1, 1)), null, 'no box (the test driver), no plan');
});

test('§7 the DOM pass writes the shape onto a fighting board before any zone is fitted', () => {
  const g = globalThis as { getComputedStyle?: unknown };
  const had = g.getComputedStyle;
  g.getComputedStyle = () => ({ getPropertyValue: () => '', columnGap: '2px', rowGap: '2px' });
  try {
    const rect = (w: number, h: number) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h });
    const B = BOARDS['1440x900']!;
    for (const [n, top, bot] of [[2, 2, 2], [7, 0, 1]] as const) {
      const vars = new Map<string, string>();
      const style = { setProperty: (k: string, v: string) => { vars.set(k, v); }, getPropertyValue: () => '' };
      const none = { length: 0 };
      const cols = { style: { getPropertyValue: (v: string) => (v === '--rowstop' ? String(top) : v === '--rowsbot' ? String(bot) : '') },
        querySelectorAll: () => ({ length: n }) };
      // the fight's column (`.lcol`): its box is the height the plan is over
      const col = { getBoundingClientRect: () => rect(B.w / 2, B.h), querySelector: () => null };
      const fight = { parentElement: col, querySelector: (sel: string) => (sel === '.cols' ? cols : null), querySelectorAll: () => none };
      const idle = { dataset: { region: '1' }, classList: { contains: () => false }, querySelectorAll: () => none };
      const lb = {
        style, dataset: {} as Record<string, string>, getBoundingClientRect: () => rect(B.w, 900), querySelectorAll: () => none,
        querySelector: (sel: string) => (sel === '.lfight.focus' ? fight : sel === '.lfight:not(.focus)' ? idle : null),
      };
      const root = { querySelector: (sel: string) => (sel === '.lboard[data-fight]' ? lb : null), querySelectorAll: () => [] } as unknown as ParentNode;
      fitBoard(root, 78);
      // the stand-in's paddings are all zero (the stub reads every one as '')
      const p = plan({ ...input(B, n, top, bot, { pad: 0 }), chrome: { w: 0, h: 0 } });
      assert.deepEqual(Object.fromEntries(vars), { '--lidle': `${p.idle}px`, '--lband': `${p.band}px` },
        `${n} columns: the board gets the plan for what it holds`);
      assert.equal(p.wide, n === 7, 'the premise: only the seven-column attack needs more than half');
      assert.equal('wide' in lb.dataset, p.wide, `${n} columns: the idle column measured only when the fight needs more than half`);
    }
  } finally { g.getComputedStyle = had; }
});

test('§8 a band you build a formation from keeps its units at the size of the slots they go to', () => {
  // battle-space-defend: you declare blocks with four units waiting in your
  // In Play — the band at the foot of the fight's column
  for (const name of ['1344x768', '1440x900', '1920x1080']) {
    const base = input(BOARDS[name]!, 6, 1, 2);
    const plain = plan(base);
    const cap = Math.round(78 * GROW);
    const built = plan({ ...base, source: { n: 4, cap, pad: 10 } });
    const unit = Math.floor((built.band - 10) / 1.4);
    assert.ok(unit >= Math.min(built.cw, cap) - 1, `${name}: the waiting units (${unit}px) stand at the slots' ${built.cw}px`);
    // without it the band would have held them smaller than the slots, and it grew to stop that
    if (Math.floor((plain.band - 10) / 1.4) < Math.min(plain.cw, cap) - 1) assert.ok(built.band > plain.band, `${name}: the band grew for them`);
    const f = fightBox(base, built);
    assert.ok(battleMeasure(6, 1, 2, base.o).height(built.cw) + CHROME.h <= f.h, `${name}: and the fight still stands`);
  }
});

test('§9 a band holding a modded unit stands at least that unit\'s height at the floor', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    const base = input(board, 3, 1, 1);
    assert.deepEqual(plan({ ...base, tall: { extra: 0, pad: 10 } }), plan(base), `${name}: no mods, same plan`);
    const p = plan({ ...base, tall: { extra: 0.83, pad: 10 } });
    const need = Math.round(FLOOR * RATIO * 1.83) + 10;
    assert.ok(p.band >= need, `${name}: the band ${p.band} >= ${need}, the long unit at the floor`);
    const f = fightBox(base, p);
    assert.ok(battleMeasure(3, 1, 1, base.o).height(p.cw) + CHROME.h <= f.h + 1, `${name}: the fight still stands`);
  }
});
