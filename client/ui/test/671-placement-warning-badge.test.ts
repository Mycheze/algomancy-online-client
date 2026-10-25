/* BL-50 / CT-410 — THE (!) ON A CARD PLACED WHERE CONFIRM WILL BE REFUSED.
 *
 * Report #284 (invi, room VRRS, 2026-10-24): "bripp can be moved to a block
 * column during declare blockers". The engine refuses the declaration
 * ("Feeble units cannot block"); the board let the drag happen and said
 * nothing until Confirm. The owner, 2026-10-25: keep the drag, mark the card —
 * "a sorta (!) icon onto cards (in the same place the big die is for token
 * spells) when there's a card in a formation in an illegal way (a way that the
 * engine won't allow upon submission). So feeble, but also alluring".
 *
 * WHAT IS ASSERTED.
 *  1. The backlog entry's own done-when: for EVERY placement of a fixture's
 *     defenders (home, each attacking column, a side-block either end, sent to
 *     counterattack), some card is marked exactly when the engine's validator
 *     refuses the declaration. Swept, not sampled, over boards that put
 *     Feeble, Pure, Flying, Evasive, a lone Sneaky attacker and an Alluring
 *     duty in front of it.
 *  2. The named cases: the Feeble unit is the card marked and loses it when it
 *     leaves; a Pure + Feeble unit is never marked; an unmet Alluring duty marks
 *     the lured unit.
 *  3. The board: driven through ui/main.ts, a Feeble unit clicked into a block
 *     column wears the badge before Confirm, the bar says why, Confirm stays
 *     live (the owner kept the drag), and the badge goes when the unit does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { blockDeclarationIssue, legalActions } from '../../engine/src/apply.ts';
import { placementWarnings } from '../placewarn.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';
import { pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

/** give `id` an attribute until end of turn (the engine's own temp-attr seam) */
function grant(h: Harness, id: EntityId, attr: 'Pure' | 'Feeble'): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
  h.state = g.s;
}

/** an attack with one column per attacker, stopped at the block step; `lure`
 * names the defender an Alluring trigger targets, `pure` the defenders made Pure */
function battlefield(seed: number, attackers: string[], defenders: string[],
  opts: { pure?: number[]; feeble?: number[] } = {}):
{ h: Harness; D: Seat; atk: EntityId[]; def: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = attackers.map(n => spawn(h, A, n));
  const def = defenders.map(n => spawn(h, D, n));
  for (const i of opts.pure ?? []) grant(h, def[i]!, 'Pure');
  for (const i of opts.feeble ?? []) grant(h, def[i]!, 'Feeble');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: def[0] });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the block step is open');
  return { h, D, atk, def };
}

/** what the engine says to this declaration — the thing the badge must agree with */
const refused = (h: Harness, D: Seat, blocks: Record<number, EntityId[]>, send: EntityId[]): string | null =>
  blockDeclarationIssue(new E(structuredClone(h.state)), D, blocks, send);

/** every way to place `def`: each unit at home (null), in a column key, or sent */
function* placements(def: EntityId[], keys: number[]): Generator<{ blocks: Record<number, EntityId[]>; send: EntityId[] }> {
  const where: (number | 'send' | null)[] = [null, ...keys, 'send'];
  const at = def.map(() => 0);
  for (;;) {
    const blocks: Record<number, EntityId[]> = {};
    const send: EntityId[] = [];
    def.forEach((id, i) => {
      const w = where[at[i]!]!;
      if (w === 'send') send.push(id);
      else if (w !== null) (blocks[w] ??= []).push(id);
    });
    yield { blocks, send };
    let i = 0;
    while (i < at.length && ++at[i]! === where.length) at[i++] = 0;
    if (i === at.length) return;
  }
}

/** the sweep: badge shown ⇔ submit refused, for every placement on this board */
function sweep(h: Harness, D: Seat, def: EntityId[]): { total: number; refusedN: number } {
  const n = h.state.battle!.columns.length;
  const keys = [-1, ...Array.from({ length: n }, (_, i) => i), n];
  let total = 0, refusedN = 0;
  for (const { blocks, send } of placements(def, keys)) {
    total++;
    const why = refused(h, D, blocks, send);
    const marks = placementWarnings(h.state, D, blocks, send, []);
    const plan = JSON.stringify({ blocks, send });
    if (why) refusedN++;
    assert.equal(marks.size > 0, why !== null,
      `${plan}: the engine ${why ? `refuses it (${why}) but no card is marked` : `accepts it but ${[...marks.keys()]} marked`}`);
    for (const id of marks.keys()) {
      assert.equal(h.state.entities[id]?.controller, D, `${plan}: a marked card is the defender's own`);
    }
  }
  return { total, refusedN };
}

test('CR D1.3 / 802.12 / CT-410: the badge shows exactly when the engine refuses the plan — Feeble, Pure, Flying, Evasive', () => {
  // three attacking columns: plain, Flying, Evasive. Three defenders: Bripp
  // (Feeble), a flyer, and a Pure unit granted Feeble.
  const { h, D, def } = battlefield(67101,
    ['The Foretold', 'Ephemeral Skywalker', 'Curio Drifter'],
    ['Bripp', 'Dreamfloat Drifter', 'Just a Unit'], { feeble: [2] });
  const own = new E(h.state).ownAttrs(h.state.entities[def[2]!]!);
  assert.ok(own.has('Pure') && own.has('Feeble'), 'premise: the third defender is Pure and Feeble at block time');
  const { total, refusedN } = sweep(h, D, def);
  assert.equal(total, 7 ** 3, 'every placement of three defenders over seven places');
  assert.ok(refusedN > 50 && refusedN < total, `the sweep covers both verdicts (${refusedN} of ${total} refused)`);
});

test('CR D1.3 / 606.2e / CT-410: the badge shows exactly when the engine refuses the plan — under an Alluring duty', () => {
  const { h, D, def } = battlefield(67102,
    ['Tempest Wrangler', 'The Foretold'], ['The Foretold', 'Bripp', 'The Foretold']);
  assert.ok(Object.values(h.state.entities).some(e => e.allured && e.controller === D), 'premise: a defender is lured');
  const { refusedN } = sweep(h, D, def);
  assert.ok(refusedN > 0, 'the duty refuses some placements');
});

test('CR D1.3 / 802.14 / CT-410: the badge shows exactly when the engine refuses the plan — a lone Sneaky attacker', () => {
  const { h, D, def } = battlefield(67103, ['Whispering Mantid'], ['The Foretold', 'Just a Unit']);
  const { refusedN } = sweep(h, D, def);
  assert.ok(refusedN > 0, 'blocking the lone Sneaky attacker is refused for the plain blocker');
});

test('CR 802.12 / CT-410: the Feeble unit in a block column is the card marked, in the engine words, and only while it is there', () => {
  const { h, D, def } = battlefield(67104, ['The Foretold', 'The Foretold'], ['Bripp', 'The Foretold']);
  const [bripp, plain] = def as [EntityId, EntityId];
  const placed = placementWarnings(h.state, D, { 0: [bripp], 1: [plain] }, [], []);
  assert.deepEqual([...placed.keys()], [bripp], 'Bripp alone is marked — the plain blocker beside it is fine');
  assert.match(placed.get(bripp)!, /Feeble units cannot block/, 'carrying the engine reason');
  assert.equal(placementWarnings(h.state, D, { 1: [plain] }, [bripp], []).size, 0,
    'sent to counterattack instead, Bripp is legal and unmarked');
  assert.equal(placementWarnings(h.state, D, { 1: [plain] }, [], []).size, 0, 'left at home, unmarked');
});

test('CR 802.12b / CT-410: a Pure and Feeble unit is never marked for blocking', () => {
  const { h, D, def } = battlefield(67105, ['The Foretold'], ['Just a Unit'], { feeble: [0] });
  assert.equal(placementWarnings(h.state, D, { 0: [def[0]!] }, [], []).size, 0);
  assert.equal(refused(h, D, { 0: [def[0]!] }, []), null, 'and the engine takes that block');
});

test('CR 606.2e / CT-410: an unmet Alluring duty marks the lured unit, wherever it is', () => {
  const { h, D, def } = battlefield(67106, ['Tempest Wrangler', 'The Foretold'], ['The Foretold', 'The Foretold']);
  const [lured, other] = def as [EntityId, EntityId];
  assert.ok(h.state.entities[lured]!.allured, 'premise: the first defender is lured');
  const lureCol = h.state.battle!.columns.findIndex(c => c.some(id => h.state.entities[id]?.card === 'Tempest Wrangler'));
  const plainCol = 1 - lureCol;
  // left at home
  assert.deepEqual([...placementWarnings(h.state, D, {}, [], []).keys()], [lured], 'at home, before anything is placed');
  // blocking the other column
  assert.ok(placementWarnings(h.state, D, { [plainCol]: [lured] }, [], []).has(lured), 'blocking the wrong column');
  // a substitute sent into the lure's column
  assert.ok(placementWarnings(h.state, D, { [lureCol]: [other] }, [], []).has(lured), 'replaced by a substitute');
  // duty met
  assert.equal(placementWarnings(h.state, D, { [lureCol]: [lured], [plainCol]: [other] }, [], []).size, 0, 'duty met');
});

// ── the board, driven ─────────────────────────────────────────────────

const ui = await client();

/** the markup of the card with this entity id (unit cards carry data-id) */
function cardOf(html: string, id: EntityId): string {
  const at = html.search(new RegExp(`<div class="[^"]*\\bcard\\b[^"]*"[^>]*data-act="unit" data-id="${id}"`));
  assert.ok(at >= 0, `unit ${id} is on the board`);
  // the card's own markup runs to the next card div
  const rest = html.slice(at + 10);
  const next = rest.search(/<div class="[^"]*\bcard\b[^"]*"[^>]*data-act=/);
  return html.slice(at, next < 0 ? undefined : at + 10 + next);
}

test('CR 802.12 / CT-410: on the board, a Feeble unit clicked into a block column wears the (!) before Confirm, and loses it when moved out', () => {
  const { h, D, def } = battlefield(67107, ['The Foretold', 'The Foretold'], ['Bripp', 'The Foretold']);
  const [bripp] = def as [EntityId];
  const first = ui.join(h.state, D, legalActions(h.state, D));
  assert.doesNotMatch(first, /class="placewarn"/, 'nothing placed, nothing marked');

  ui.click({ act: 'unit', id: String(bripp) });
  const placed = ui.click({ act: 'slot', ci: '0', row: '0' });
  assert.match(cardOf(placed, bripp), /class="placewarn"[^>]*title="Feeble units cannot block"/,
    'Bripp in the block column wears the badge with the engine reason');
  assert.match(placed, /class="placewarnline"><b class="duty">\(!\) Bripp<\/b>: Feeble units cannot block/,
    'the bar names the card and the reason, where a finger can read it');
  assert.doesNotMatch(placed, /data-btn="confirmblocks" disabled/,
    'Confirm stays live: the owner kept the drag, and Confirm takes the card back out (#77)');

  // click it again: back to the region
  const back = ui.click({ act: 'unit', id: String(bripp) });
  const home = back.includes('class="placewarn"') ? ui.click({ act: 'unit', id: String(bripp) }) : back;
  assert.doesNotMatch(home, /class="placewarn"/, 'out of the column, the badge is gone');
});
