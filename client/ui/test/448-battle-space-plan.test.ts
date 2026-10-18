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
 * its arithmetic on the boards HPTR was measured on (the `.lboard` content
 * boxes at 1280×720, 1344×768, 1440×900 and 1920×1080, and a narrow one).
 *
 * §1 the fight is as wide as its columns need — never under the old half,
 *    and a fight that fits in half keeps the old half-and-half board
 * §2 the HPTR four-rank fight: bigger at 1440×900, every rank standing at 1280×720
 * §3 units grow to the owner's 100px cap where there is room, never past it
 * §4 the height the fight cannot use goes back to the bands, all of it
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
    idle: { send: false, pad: 20, gap: 6, floor: FLOOR, ...idle },
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
        // a fight that fits in half keeps the old board exactly
        assert.equal(p.wide, false, `${name} ${c}/${t}+${b}: needs ${need}px of ${h}, so no wider`);
        assert.equal(p.fight, h);
        assert.equal(p.idle, h, 'and the other region keeps its half');
      } else {
        assert.equal(p.wide, true);
        // as wide as it needs (a wide fight is two tracks: at least half and a gap)…
        assert.ok(p.fight <= Math.max(need, h + i.gapX) + 1, `${name} ${c}/${t}+${b}: ${p.fight}px for a need of ${need}`);
        // …unless the board runs out first, and then the columns fan or shrink inside it
        assert.ok(p.fight >= Math.min(need, board.w - i.gapX - (i.idle.pad + FLOOR)) - 1, `${name}: it gets what it needs`);
      }
    }
  }
  // HPTR s084 (two columns, four ranks) is height-bound: the old half-and-half
  // board with bigger units, not a fight in three quarters of the table
  for (const name of ['1344x768', '1440x900', '1920x1080']) {
    const p = plan(input(BOARDS[name]!, 2, 2, 2));
    assert.equal(p.wide, false, `${name}: s084 stays half and half`);
  }
  // HPTR s129 (three columns at the cap) at 1440 needs more than half: it widens, by what it needs
  const i129 = input(BOARDS['1440x900']!, 3, 0, 2);
  const p129 = plan(i129);
  assert.equal(p129.cw, BATTLE_CAP);
  assert.equal(p129.wide, needW(i129, p129) > half(i129));
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

test('§3 units grow to the owner cap of 100px where there is room, and never past it', () => {
  assert.equal(BATTLE_CAP, 100, 'the owner, on the board (2026-10-11): "it should cap at 100px/card during a fight"');
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

test('§5 a wide attack pushes the other region aside only as far as it needs, and never past a floor card', () => {
  // seven columns one rank deep (HPTR, turn 6): wide at every size
  for (const [name, board] of Object.entries(BOARDS)) {
    const i = input(board, 7, 0, 1);
    const p = plan(i);
    assert.equal(p.wide, true, `${name}: seven columns need more than half`);
    assert.ok(p.idle >= i.idle.pad + FLOOR, `${name}: the other column keeps one card at the floor (${p.idle})`);
    assert.ok(needW(i, p) <= p.fight + 1 || p.idle === i.idle.pad + FLOOR, `${name}: the line stands in its column`);
  }
  // the send box keeps its two-card slot
  const send = plan(input(BOARDS['1280x720']!, 12, 1, 1, { send: true }));
  assert.ok(send.idle >= 20 + SEND_SLOT_SPAN * FLOOR + 6, `the send box keeps its slot (${send.idle}px)`);
  const nosend = plan(input(BOARDS['1280x720']!, 12, 1, 1));
  assert.ok(nosend.idle < 20 + FLOOR + 14, `twelve columns take all but about one floor card (${nosend.idle}px left)`);
  // and its columns are never squeezed for the other region
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
    // HPTR s084 (two columns, two ranks a side: fits in half) and turn 6 (seven columns, one rank: wide)
    for (const [n, top, bot] of [[2, 2, 2], [7, 0, 1]] as const) {
      const vars = new Map<string, string>();
      const style = { setProperty: (k: string, v: string) => { vars.set(k, v); }, getPropertyValue: () => '' };
      const none = { length: 0 };
      const cols = { style: { getPropertyValue: (v: string) => (v === '--rowstop' ? String(top) : v === '--rowsbot' ? String(bot) : '') },
        querySelectorAll: () => ({ length: n }) };
      const fight = { querySelector: (sel: string) => (sel === '.cols' ? cols : null), querySelectorAll: () => none };
      const idle = { dataset: { region: '1' }, classList: { contains: () => false }, querySelectorAll: () => none };
      const lb = {
        style, dataset: {} as Record<string, string>, getBoundingClientRect: () => rect(1166, 622), querySelectorAll: () => none,
        querySelector: (sel: string) => (sel === '.lfight.focus' ? fight : sel === '.lfight:not(.focus)' ? idle : null),
      };
      const root = { querySelector: (sel: string) => (sel === '.lboard[data-fight]' ? lb : null), querySelectorAll: () => [] } as unknown as ParentNode;
      fitBoard(root, 78);
      // the stand-in's paddings are all zero (the stub reads every one as '')
      const p = plan({ ...input(BOARDS['1440x900']!, n, top, bot, { pad: 0 }), chrome: { w: 0, h: 0 } });
      assert.deepEqual(Object.fromEntries(vars), { '--lidle': `${p.idle}px`, '--lbandt': `${p.bandTop}px`, '--lbandb': `${p.bandBot}px` },
        `${n} columns: the board gets the plan for what it holds`);
      assert.equal(p.wide, n === 7, 'the premise: only the seven-column attack needs more than half');
      assert.equal('wide' in lb.dataset, p.wide, `${n} columns: three tracks only when the fight needs more than half`);
    }
  } finally { g.getComputedStyle = had; }
});

test('§8 a band you build a formation from keeps its units at the size of the slots they go to', () => {
  // battle-space-defend: four columns attack you, you declare blocks with four
  // units waiting in your In Play — they stood at ~50px beside ~85px slots
  for (const name of ['1344x768', '1440x900', '1920x1080']) {
    const base = input(BOARDS[name]!, 6, 1, 2);
    const plain = plan(base);
    const cap = Math.round(78 * GROW);
    const built = plan({ ...base, source: { top: 0, bot: 4, cap, pad: 12 } });
    const unit = Math.floor((built.bandBot - 12) / 1.4);
    assert.ok(unit >= Math.min(built.cw, cap) - 1, `${name}: the waiting units (${unit}px) stand at the slots' ${built.cw}px`);
    assert.ok(Math.floor((plain.bandBot - 12) / 1.4) < plain.cw, `${name}: the premise — without it they were smaller`);
    assert.ok(built.bandTop < built.bandBot, `${name}: the other band still gives way (${built.bandTop} < ${built.bandBot})`);
    const f = fightBox(base, built);
    assert.ok(battleMeasure(6, 1, 2, base.o).height(built.cw) + CHROME.h <= f.h, `${name}: and the fight still stands`);
  }
});

test('§9 a band holding a modded unit stands at least that unit\'s height at the floor', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    const base = input(board, 3, 1, 1);
    // nothing modded: `tall` with zeros changes nothing
    assert.deepEqual(plan({ ...base, tall: { top: 0, bot: 0, pad: 12 } }), plan(base), `${name}: no mods, same plan`);
    // their band holds a unit with seven mods (.83 of a card hanging under it)
    const p = plan({ ...base, tall: { top: 0.83, bot: 0, pad: 12 } });
    const need = Math.round(FLOOR * RATIO * 1.83) + 12;
    assert.ok(p.bandTop >= need, `${name}: their band ${p.bandTop} >= ${need}, the long unit at the floor`);
    assert.ok(p.bandTop > plan(base).bandTop || plan(base).bandTop >= need, `${name}: it grew for it`);
    // and the fight still stands in what is left
    const f = fightBox(base, p);
    assert.ok(battleMeasure(3, 1, 1, base.o).height(p.cw) + CHROME.h <= f.h + 1, `${name}: the fight still stands`);
  }
});
