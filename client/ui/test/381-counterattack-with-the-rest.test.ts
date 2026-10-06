/* 381 — REPORT #196: A BIG COUNTERATTACK FITS, AND GOES IN ONE CLICK.
 *
 * EMCU (a Single Card Duel), action 115, the owner declaring blocks with
 * eighteen units: *"There literally isn't enough space on screen to counter
 * attack beyond ~10 units. There needs to be two changes: counter attack with
 * remaining button AND to use 2 rows for counter attacking. In this current
 * scenario, I cannot counter attack with more units."*
 *
 * Measured in a real browser (1440×900, the regions board): the send box was
 * one row deep at a fixed card height, so the fit could only shrink the cards
 * along it; at the tenth unit it hit the floor, and the drop slot — two cards
 * wide and drawn last — was pushed out of the clipped row. Nothing more could
 * be sent.
 *
 * §1  the bar offers "Counterattack with the rest"; one click sends every unit
 *     not already blocking or sent, and the declaration it builds is one the
 *     engine takes
 * §2  …and once nothing is left, the button goes
 * §3  a lured unit (R84) must block and may not counterattack: the button
 *     leaves it alone, because the ENGINE says so (ui/battle.ts sendableRest)
 * §4  only the blocking seat is offered it, and only in round 1
 * §5  the send box's plan: every card and the slot fit inside the block, at
 *     both window sizes measured, for any number sent — the slot is never the
 *     thing pushed out
 * §6  the stylesheet half: the box wraps, and the slot breaks on its two-card
 *     width, not its caption's
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import { pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { sendableRest } from '../battle.ts';
import { fitSendBox, SEND_SLOT_SPAN, type FitPlan } from '../fit.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');

/** round 1's block step: A attacks with `atk` columns, D has `k` units */
function blockStep(seed: number, k: number, opts: { lure?: boolean } = {}): {
  h: Harness; A: Seat; D: Seat; mine: EntityId[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, opts.lure ? 'Tempest Wrangler' : 'The Foretold'), spawn(h, A, 'The Foretold')];
  const mine = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let g = 0; g < 40 && h.state.battle!.step !== 'blocks'; g++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: mine[0]! });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the premise: the block step');
  assert.equal(h.state.battle!.round, 1, 'the premise: round 1');
  return { h, A, D, mine };
}

/** Confirm, and the declaration it sent — which the engine must take */
function confirmAndApply(h: Harness): Extract<Action, { type: 'declareBlocks' }> {
  ui.actions();
  ui.click({ btn: 'confirmblocks' });
  const sent = ui.actions().filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  assert.equal(sent.length, 1, 'Confirm sent one declaration');
  assert.doesNotThrow(() => apply(h.state, sent[0]!), 'the engine accepts it');
  return sent[0]!;
}

test('§1 "Counterattack with the rest" sends every unit not blocking or already sent', () => {
  const { h, D, mine } = blockStep(38101, 16);
  ui.join(h.state, D, legalActions(h.state, D));
  assert.ok(ui.has({ btn: 'sendrest' }), 'the bar offers it in the block step');
  // a blocker and one hand-sent unit first: the button must work AROUND a plan
  const [blocker, early] = mine;
  ui.click({ act: 'unit', id: String(blocker) });
  ui.click({ act: 'slot', ci: '0', row: '0' });
  ui.click({ act: 'unit', id: String(early) });
  ui.click({ act: 'sendslot' });
  ui.click({ btn: 'sendrest' });
  const a = confirmAndApply(h);
  assert.deepEqual(a.blocks, { 0: [blocker] }, 'the block is untouched');
  assert.deepEqual([...(a.send ?? [])].sort((x, y) => x - y), mine.slice(1).sort((x, y) => x - y),
    'every other unit is sent — the hand-sent one once, not twice');
});

test('§2 with nothing left to send, the button is gone', () => {
  const { h, D } = blockStep(38102, 12);
  ui.join(h.state, D, legalActions(h.state, D));
  const html = ui.click({ btn: 'sendrest' });
  assert.doesNotMatch(html, /data-btn="sendrest"/, 'nothing left: no button');
  ui.click({ btn: 'clearform' });
  assert.ok(ui.has({ btn: 'sendrest' }), 'cleared, it is back');
});

test('§3 a lured unit is left to its duty — the engine, not the client, says so', () => {
  const { h, D, mine } = blockStep(38103, 5, { lure: true });
  const [lured] = mine;
  assert.deepEqual(new E(h.state).entity(lured!)!.allured, { round: 1, columns: [0] }, 'the premise: lured');
  assert.deepEqual(sendableRest(h.state, D, []), mine.slice(1), 'every unit but the lured one');
  ui.join(h.state, D, legalActions(h.state, D));
  ui.click({ act: 'unit', id: String(lured) });
  ui.click({ act: 'slot', ci: '0', row: '0' });
  ui.click({ btn: 'sendrest' });
  const a = confirmAndApply(h);
  assert.deepEqual([...(a.send ?? [])].sort((x, y) => x - y), mine.slice(1).sort((x, y) => x - y));
});

test('§4 only the blocker is offered it, and only in round 1', () => {
  const { h, A, D, mine } = blockStep(38104, 4);
  assert.deepEqual(sendableRest(h.state, A, []), [], 'the attacker has nothing to send');
  assert.doesNotMatch(ui.join(h.state, A, legalActions(h.state, A)), /data-btn="sendrest"/,
    'and the watching seat has no button');
  // round 2's block step: no counter-counterattack, so no button
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: mine });
  for (let g = 0; g < 80 && !(h.state.battle?.round === 2 && h.state.battle.step === 'blocks'); g++) {
    const b = h.state.battle;
    if (!b) break;
    if (b.round === 2 && b.step === 'declare') { h.do({ type: 'declareAttack', seat: b.attacker, columns: [[mine[0]!]] }); continue; }
    const dec = h.state.decision;
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    pass(h);
  }
  const b = h.state.battle;
  assert.ok(b && b.round === 2 && b.step === 'blocks', 'the premise: round 2 blocks');
  assert.deepEqual(sendableRest(h.state, b.defender, []), []);
  assert.doesNotMatch(ui.join(h.state, b.defender, legalActions(h.state, b.defender)), /data-btn="sendrest"/);
});

/* ── §5 the send box's plan ─────────────────────────────────────────────── */

/** lay the plan out as a wrapping flex row would (style.css `.lsendrow`):
 * cards of the plan's footprint with a 6px gap (a fan: `step` each, no gap),
 * then the slot at two of them. Returns the rows it took. */
function rowsTaken(p: FitPlan, cards: number, w: number): number {
  const fan = p.mode === 'fan';
  const foot = fan ? p.step : p.cw, gap = fan ? 0 : 6;
  const items = [...Array<number>(cards).fill(foot), fan ? 2 * p.step : 2 * p.cw];
  let rows = 1, x = 0;
  for (const iw of items) {
    const need = x === 0 ? iw : x + gap + iw;
    if (need > w + 0.5 && x > 0) { rows++; x = iw; } else x = need;
  }
  return rows;
}

test('§5 every sent card and the slot fit inside the block, for any number sent', () => {
  // the two windows measured in the browser: the send box's content box in
  // the attacker's battle block, 1440×900 and 1280×720
  for (const box of [{ w: 559, h: 260 }, { w: 479, h: 177 }]) {
    for (let cards = 0; cards <= 40; cards++) {
      const p = fitSendBox(cards, box, { cw: 78, gap: 6 });
      const rows = rowsTaken(p, cards, box.w);
      const tall = rows * Math.round(p.cw * 1.4) + 6 * (rows - 1);
      assert.ok(tall <= box.h, `${box.w}×${box.h}, ${cards} sent: ${rows} rows of ${p.cw}px cards stand ${tall}px — taller than the block`);
      if (p.mode === 'fan') {
        assert.ok(p.step * p.cols <= box.w, `${cards} sent: a fanned row runs past the block`);
      }
    }
  }
  // the report's own case: eleven sent at 1440×900 is NOT at the floor any more
  const emcu = fitSendBox(11, { w: 559, h: 260 }, { cw: 78, gap: 6 });
  assert.equal(emcu.mode, 'grid');
  assert.ok(emcu.rows >= 2, 'it takes a second row rather than shrinking along one');
  assert.equal(SEND_SLOT_SPAN, 2, 'the slot is counted at its two-card width');
});

test('§6 the stylesheet wraps the box, and breaks the slot on its two-card width', () => {
  const rule = (sel: string): string => {
    const at = CSS.indexOf(`${sel} {`);
    assert.ok(at >= 0, `no ${sel} rule`);
    return CSS.slice(at, CSS.indexOf('}', at));
  };
  assert.match(rule('.lsend .lsendrow'), /flex-wrap:\s*wrap/, 'the send box wraps');
  const slot = rule('.lboard .lsend .zone .slot.lsendslot');
  assert.match(slot, /min-width:\s*calc\(var\(--cw\) \* 2\)/, 'the slot is two cards wide');
  assert.match(slot, /flex:\s*1 1 0[;\s]/,
    'an auto basis is the caption\'s one-line width, and the row would break on that instead');
});
