/* Report round 2026-10-16, the edges of the Wraith fix (see 460 for the report
 * and the owner's decision, verbatim): "They don't target which means they
 * can't be fizzled."
 *
 * The Wraith's "put a -1/-1 counter on an ally" now chooses its ally as each
 * trigger RESOLVES, with the same rule as its death line ("Augment a Wraith
 * onto an ally"). The owner's clarification, verbatim: "To be clear, Waiths
 * can fizzle once you're fully out of units, but since they don't target,
 * it's just a raw choice where it gets augmented." So, for BOTH lines: no ally
 * in play means the trigger fizzles (no question; the log says so); exactly
 * one ally in play is chosen without asking; two or more and the controller
 * is asked, at resolution.
 *
 * Seeds: 46100-46199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { effStats, ent, finishBattle, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { EntityId } from '../src/types.ts';

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

registerSynthetic(unit('T461 Filler', 1, 1, { mana: 20 }), {});
registerSynthetic(unit('T461 Grunt', 1, 1), {});
registerSynthetic(unit('T461 Duo', 2, 2), {});

function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => 'T461 Filler');
  return h;
}

/** answer every pending question with `prefer` when offered, else the first option */
function answerAll(h: Harness, prefer: EntityId): number {
  let asked = 0, guard = 30;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    const i = Math.max(0, dec.options.findIndex(o => o.value === prefer));
    h.do({ type: 'decide', seat: dec.seat, choice: i });
    asked++;
  }
  return asked;
}

// A lone 1/1 carrying two Wraith augments: both lines trigger, the first
// shrinks the host (its only ally, so nothing is asked) and kills it. The
// second shrink then finds NO ally at all, and so do both death lines.
test('report 2026-10-16: a Wraith shrink that finds no ally in play asks nothing and fizzles', () => {
  const h = sterile(46100);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'T461 Grunt');
  withE(h, e => { e.augmentWraith(e.entity(host)!, P); e.augmentWraith(e.entity(host)!, P); });
  toNextBattle(h, P);
  const mark = h.log.length;
  finishBattle(h);
  assert.equal(h.state.decision, null, 'nothing is asked: one candidate, then none');
  assert.equal(ent(h, host), undefined, 'the first trigger shrank its host, its only ally, to death');
  const tail = h.log.slice(mark);
  assert.equal(tail.filter(l => l.includes('Wraith fizzles — there is no ally to put a -1/-1 counter on')).length, 1,
    'the second shrink fizzles, and says why');
  assert.equal(tail.filter(l => l.includes('Wraith fizzles — there is no ally to Augment a Wraith onto')).length, 2,
    'and both death lines, with no ally left either, fizzle too');
  assert.equal(tail.filter(l => l.includes('-1/-1 counter(s)')).length, 1, 'exactly one counter landed');
});

// The death line alone: a Wraith body is the last unit its controller has,
// and it dies. "Augment a Wraith onto an ally" finds nobody, asks nothing,
// and fizzles; no Wraith mod is minted.
test('report 2026-10-16: a Wraith death line with no ally in play asks nothing, mints nothing and fizzles', () => {
  const h = sterile(46103);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let w = 0 as EntityId;
  withE(h, e => { w = e.createWraith(P).id; });
  const mark = h.log.length;
  withE(h, e => { e.addCounters(e.entity(w)!, -3); e.settle(); });
  assert.equal(h.state.decision, null, 'nothing is asked');
  assert.equal(ent(h, w), undefined, 'the Wraith died');
  const tail = h.log.slice(mark);
  assert.ok(tail.some(l => l.includes('Wraith fizzles — there is no ally to Augment a Wraith onto')),
    'the death line fizzles, and says why');
  assert.equal(Object.values(h.state.entities).filter(e => e.card === 'Wraith').length, 0, 'no Wraith was minted');
});

// The death line with two allies: the choice is made as the trigger resolves,
// among the allies in play then, and the chosen one carries the new Wraith.
test('report 2026-10-16: a Wraith death line with two allies asks at resolution and augments the chosen one', () => {
  const h = sterile(46104);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const a = spawn(h, P, 'T461 Grunt');
  const b = spawn(h, P, 'T461 Duo');
  let w = 0 as EntityId;
  withE(h, e => { w = e.createWraith(P).id; });
  withE(h, e => { e.addCounters(e.entity(w)!, -3); e.settle(); });
  const dec = h.state.decision;
  assert.ok(dec, 'two allies: the controller is asked');
  assert.ok(!(h.state.suspension as { snapshot?: unknown }).snapshot,
    'before the resolution starts, so the question rewinds nothing and freezes nobody (CR 507.5a)');
  assert.deepEqual(dec.options.map(o => o.value as number).sort(), [a, b].sort(), 'between the two allies in play');
  assert.equal(answerAll(h, b), 1);
  const wraithMods = (id: EntityId): number =>
    (ent(h, id)!.mods ?? []).filter(m => ent(h, m)?.card === 'Wraith').length;
  assert.equal(wraithMods(b), 1, 'the Duo carries the new Wraith');
  assert.equal(wraithMods(a), 0);
});

// The same host, plus a 2/2. The first trigger has two allies and asks; the
// player kills the host. The second has ONE ally left and takes it without
// asking, exactly as the death line always has.
test('report 2026-10-16: a Wraith trigger with one ally left in play chooses it without asking', () => {
  const h = sterile(46101);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'T461 Grunt');
  const duo = spawn(h, P, 'T461 Duo');
  withE(h, e => { e.augmentWraith(e.entity(host)!, P); e.augmentWraith(e.entity(host)!, P); });
  toNextBattle(h, P);
  const mark = h.log.length;
  finishBattle(h);
  assert.equal(answerAll(h, host), 1, 'one question: the first trigger, with two allies to choose from');
  assert.equal(ent(h, host), undefined, 'it killed the 1/1 host');
  assert.equal(ent(h, duo)!.counters, -1, 'the second trigger put its counter on the one ally left');
  assert.deepEqual(effStats(h, duo), [1, 1]);
  assert.ok(!h.log.slice(mark).some(l => l.includes('fizzle')), 'nothing fizzled');
});

// Not a target (CR 110.2a), now as before: Mohruung prints "When I become
// targeted, create a Crystal 2", and a Wraith choosing it must not pay out.
// A PIN, not a guard for the 2026-10-16 fix: the old seam did not target either.
test('report 2026-10-16: a Wraith choosing Mohruung on resolution fires no targeted event and makes no Crystal', () => {
  const h = sterile(46102);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const mohruung = spawn(h, P, 'Mohruung');
  withE(h, e => { e.createWraith(P); });
  toNextBattle(h, P);
  const from = h.events.length;
  finishBattle(h);
  assert.equal(answerAll(h, mohruung), 1, 'two allies, one question');
  assert.equal(ent(h, mohruung)!.counters, -1, 'the counter went on Mohruung');
  assert.equal(h.events.slice(from).filter(ev => ev.type === 'targeted').length, 0, 'it was not targeted');
  assert.equal(Object.values(h.state.entities).filter(e => e.card === 'Crystal').length, 0, 'so no Crystal');
});
