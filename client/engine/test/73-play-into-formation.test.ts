/* R29 — a card PLAYED into an open spot never stands outside the line.
 *
 * Playtest UFAB, 2026-08-22: *"Tiderunner Initiate should never have entered
 * the Invader's zone. It gets played directly into the formation, not as a
 * trigger that happens when it enters."*
 *
 * The card was modelled as a triggered ability on its own `spawned` event. So
 * playing it spawned a unit into the battle region with NO column — which is
 * exactly the state the client renders as the invader's zone — then stacked a
 * placement trigger and handed the opponent priority. In the reported game
 * that window was enough for Good Whale (Ambush) and Tidal Reversion to
 * recall it before it ever reached the line.
 *
 * The conceptual mistake was folding it into R75. R75's ruling — *"that choice
 * should be made on effect resolution"* — was written for "create a unit IN MY
 * FORMATION" (Hooba-Bot/Lin/God/Pon), where the placement genuinely is part of
 * an effect resolving. Tiderunner's text is "you may PLAY me into an open
 * spot". A play, not an effect. So the spot is chosen in the CAST window with
 * everything else about how the card is played (R35), and taken at resolution
 * atomically with the spawn.
 *
 * Seeds 7300-7399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** the client's own definition of the invader's zone (ui/main.ts): in the
 * enemy region, in no column */
function invaders(h: Harness, seat: Seat): string[] {
  const b = h.state.battle;
  if (!b) return [];
  const e = new E(h.state);
  return unitsOf(h, seat)
    .filter(u => u.region === b.region && !e.columnOf(u.id))
    .map(u => u.card);
}

function playTiderunner(h: Harness, seat: Seat): void {
  giveResources(h, seat, 'water', 1);
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Tiderunner Initiate') });
}

// ── the report ─────────────────────────────────────────────────────────

test('R29 THE REPORT: Tiderunner is never in the invader’s zone, and never stacks a trigger', () => {
  const h = new Harness(7301, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });

  playTiderunner(h, A);
  // the question is the CAST's, raised before anything is on the board
  assert.ok(h.state.decision, 'the spot is asked for as the card is played');
  assert.equal(h.state.decision!.seat, A);
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Tiderunner Initiate').length, 0,
    'nothing has entered play yet — this is still the cast');
  pick(h, { kind: 'behind', unit: wh });

  // …and while the item sits on the stack, still nothing in the region
  assert.deepEqual(invaders(h, A), [], 'no invader while the play is on the stack');
  assert.equal(h.state.priority, D, 'the opponent gets their normal response window');

  pass(h); pass(h);                                        // the play resolves
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(tr, 'it entered play');
  assert.deepEqual(invaders(h, A), [],
    'THE REPORT: it was never in the invader’s zone, not for one priority window');
  assert.deepEqual(h.state.battle!.columns[0], [wh, tr.id], 'it is in the line, behind the whale');
  assert.equal(h.state.stack.length, 0, 'and no placement trigger was ever stacked');
  assert.equal(h.state.decision, null, 'nor a second question asked');
  finishBattle(h);
});

test('R29 THE REPORTED SHAPE: no state between the play and the line shows an invader', () => {
  // Driven blind, the way a client would: answer whatever is asked, pass when
  // nothing is, and check the reported symptom after EVERY single step. The
  // old modelling failed here and not at some timing assertion — there really
  // was a state on the wire with a Tiderunner Initiate standing in the enemy
  // region in no column, which is what the client draws as the invader's zone.
  const h = new Harness(7309, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  playTiderunner(h, A);

  for (let step = 0; step < 12; step++) {
    assert.deepEqual(invaders(h, A), [],
      `step ${step}: Tiderunner Initiate must never be renderable in the invader's zone`);
    if (unitsOf(h, A).some(u => u.card === 'Tiderunner Initiate')) break;
    const dec = h.state.decision;
    if (dec) {
      // take a real spot, never "stay out" — declining is the one legal way to
      // end up outside the line, and it would mask the bug
      const i = dec.options.findIndex(o => o.label !== 'stay out of formation');
      h.do({ type: 'decide', seat: dec.seat, choice: i });
    } else {
      pass(h);
    }
  }
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(tr, 'it got into play');
  assert.deepEqual(invaders(h, A), [], 'and it is not an invader at the end either');
  assert.ok(h.state.battle!.columns.flat().includes(tr.id), 'it is in the line');
  finishBattle(h);
});

test('R29 the spawn event itself already sees it in the formation', () => {
  const h = new Harness(7302, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  playTiderunner(h, A);
  pick(h, { kind: 'behind', unit: wh });
  pass(h);
  const events = h.do({ type: 'passPriority', seat: h.state.priority! });

  const at = events.findIndex(e => e.type === 'spawned' && e.data?.['card'] === 'Tiderunner Initiate');
  assert.notEqual(at, -1, 'it spawned');
  const id = events[at]!.data!['unit'] as number;
  assert.ok(h.state.battle!.columns[0]!.includes(id), 'and it is in the column');
  // atomicity is a claim about ORDER: nothing between the spawn and the line.
  // The placement line is narrated under the spawn, not before some window.
  assert.ok(events.slice(at).some(e => e.type === 'info'
    && /played straight into the formation/.test(e.msg)),
    'the log says it was played straight in');
  assert.ok(!events.some(e => e.type === 'triggered'
    && /Tiderunner/.test(e.msg)), 'no trigger fired for the placement');
  finishBattle(h);
});

test('R29 the opponent’s response window cannot catch it outside the line', () => {
  // The reported kill: Good Whale (Ambush) / Tidal Reversion answering the
  // spawn. There is no longer a spawn to answer — the only window is against
  // the PLAY, and recalling a card off the stack is a different card's job.
  const h = new Harness(7303, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  playTiderunner(h, A);
  pick(h, { kind: 'end', end: 'right' });

  // D holds priority over the stacked play. Whatever they can aim at, it is
  // not a Tiderunner Initiate standing in the region.
  assert.equal(h.state.priority, D);
  const targets = new E(h.state).targetCandidates(
    { what: 'unit', prompt: '' }, h.state.battle!.region, undefined, D);
  const names = targets
    .map(t => ('unit' in t ? h.state.entities[t.unit]?.card : undefined))
    .filter(Boolean);
  assert.ok(!names.includes('Tiderunner Initiate'),
    'there is nothing of that name on the board to recall');
  finishBattle(h);
});

// ── the printed "may", and the no-formation case ──────────────────────

test('R29 "stay out of formation" is still on the menu — the text says MAY', () => {
  const h = new Harness(7304, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  playTiderunner(h, A);
  assert.ok(h.state.decision!.options.some(o => o.label === 'stay out of formation'));
  pick(h, { kind: 'out' });
  pass(h); pass(h);
  assert.deepEqual(invaders(h, A), ['Tiderunner Initiate'],
    'declining puts it in the region, outside the line — which is a CHOICE, not a window');
  finishBattle(h);
});

test('R29 with NO formation of your own the play is legal and asks nothing', () => {
  const h = new Harness(7305, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                 // priority → D
  playTiderunner(h, D);                                    // D has declared no blocks
  assert.equal(h.state.decision, null, 'nothing to join — no prompt');
  pass(h); pass(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Tiderunner Initiate'), 'and it still entered play');
  finishBattle(h);
});

// ── R5/R56: the board may move between the cast and the resolution ────

test('R29 the slot is RE-DERIVED at resolution: the spot can be gone by then', () => {
  const h = new Harness(7306, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const wh = spawn(h, A, 'Good Whale');
  const other = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'fire', 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh], [other]] });
  playTiderunner(h, A);
  pick(h, { kind: 'behind', unit: wh });                   // aimed behind the whale

  // …and the whale dies before the play resolves, taking the slot with it
  const e = new E(h.state);
  e.destroy(e.entity(wh)!, 'is deleted');
  e.settle();
  assert.equal(ent(h, wh), undefined, 'the whale is gone');

  pass(h); pass(h);
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(tr, 'the card still resolved');
  const line = h.state.battle!.columns.flat();
  assert.ok(!line.includes(tr.id), 'it did not take some OTHER column by index');
  assert.ok(h.log.some(l => /the open spot it was played into is gone/.test(l)),
    'and it says so rather than resolving into silence');
  finishBattle(h);
});

test('R29 a spot chosen at cast opens a NEW column at resolution, re-keying blocks', () => {
  const h = new Harness(7307, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  playTiderunner(h, A);
  pick(h, { kind: 'end', end: 'left' });
  pass(h); pass(h);
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.deepEqual(h.state.battle!.columns.map(c => [...c]), [[tr.id], [wh]],
    'the new column went in on the LEFT and everything else shifted right');
  finishBattle(h);
});

// ── the primitive is a card FLAG, and exactly two cards have it ───────

test('R29 playsIntoFormation is the flag, and R75’s placeInFormation is untouched', async () => {
  const { allCardNames, getCard } = await import('../src/cards/dsl.ts');
  const flagged = allCardNames().filter(n => getCard(n).playsIntoFormation);
  assert.deepEqual(flagged, ['Tiderunner Initiate', 'Trench Stalker'],
    'exactly the cards whose text is a PLAY into the line — "you may PLAY me into an '
    + 'open spot" and (R123) "I can be played directly into formation"');

  // R75's class is untouched: those four create a unit with an EFFECT and then
  // place it, so their placement stays where the ruling put it — at
  // resolution, inside an ability, and reached through E.placeInFormation.
  for (const n of ['Hooba-Bot', 'Hooba-Lin', 'Hooba-God', 'Hooba-Pon']) {
    assert.equal(getCard(n).playsIntoFormation, undefined,
      `${n} creates a unit in its formation — an effect, not a play`);
    const def = getCard(n);
    assert.ok((def.abilities ?? []).length + (def.augmentText ?? []).length > 0,
      `${n} still does it with an ability`);
  }
  // and the card that IS a play no longer carries an ability at all
  assert.deepEqual(getCard('Tiderunner Initiate').abilities, undefined,
    'Tiderunner Initiate is the flag and nothing else — no spawn trigger left');
});
