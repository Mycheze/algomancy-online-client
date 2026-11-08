/**
 * CR 706.3a, 706.5 / CT-535 (report #339, invi, YYAE) — a trigger set off WHILE
 * a batch of triggers is being put on the stack waits for the whole batch, then
 * goes on top of it. It is never ordered in with the batch.
 *
 * CR 706.5: "Triggered abilities that are put on the stack at the same time are
 * put there in the order of rule 703.4" — one batch, one order. CR 706.3a: in
 * battle a trigger is put on the stack "as soon as the action or resolution that
 * made them trigger is complete, on top of anything already on the stack". When
 * a batch member's cost (Darkblast grafted under Splort: "[Discard a card]")
 * discards Dropslime, the action that made Dropslime trigger is the batch going
 * on, so Dropslime goes above all of it.
 *
 * YYAE [222]-[226]: invi ordered Splort's and Blightwalker's trash triggers with
 * Blightwalker to resolve first; putting Splort's composite on cost a discard,
 * Dropslime; the engine then asked invi to order Blightwalker AND Dropslime
 * together, and Blightwalker went on top. The cause: every trigger-queueing site
 * reset the batch's ordering (`triggerOrderedSeats = []`), so a late trigger
 * joined the batch still in the queue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, give, giveResources, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

const SPLORT = /^Splort: deal 2 damage/;
const BLIGHT = /^Blightwalker: you may pay/;
const DROP = /^Dropslime/;

/** Splort (Darkblast grafted under it) standing in the battle region, a card in
 * the bin for Blightwalker to aim at, Dropslime in hand; returns the seat */
function board(seed: number, opponentSplort = false): { h: Harness; P: Seat; Q: Seat; theirs?: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const Q = (1 - P) as Seat;
  const splort = spawn(h, P, 'Splort');
  giveResources(h, P, 'fire', 3);
  giveResources(h, P, 'dark', 6);
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Darkblast'), hostId: splort, position: 0 });
  assert.ok(ent(h, splort)!.mods.some(m => ent(h, m)?.card === 'Darkblast'), 'setup: Darkblast is grafted under Splort');
  // the opponent's Splort stays in its home region until the test walks it in
  const theirs = opponentSplort ? spawn(h, Q, 'Splort') : undefined;
  toNextBattle(h, P);
  assert.equal(h.state.phase, 'battle', 'setup: in battle — triggers use the stack (CR 706.3a)');
  // put the units where the battle is, so they hear a trash there (CR 706.7)
  withE(h, e => {
    const r = e.s.battle!.region;
    const u = e.entity(splort)!;
    u.region = r;
    for (const m of u.mods) e.entity(m)!.region = r;
    if (theirs !== undefined) e.entity(theirs)!.region = 1 - r;   // away from the battle
  });
  h.state.players[P]!.bin = ['Cthyrian Rector'];
  give(h, P, 'Dropslime');
  return { h, P, Q, ...(theirs !== undefined ? { theirs } : {}) };
}

/** the items that resolved, in order, as their log lines name them */
const resolved = (h: Harness): string[] =>
  h.log.filter(l => l.startsWith('Resolving ')).map(l => l.slice('Resolving '.length));

/** discard Blightwalker; order the batch Blightwalker-first (so Splort's goes on
 * the stack first and pays its discard with Blightwalker still waiting); answer
 * every other question with its first option, the discard with Dropslime.
 * Returns every ordering question asked, as option labels. */
function play(h: Harness, P: Seat, beforeDiscard?: () => void): string[][] {
  const bwi = give(h, P, 'Blightwalker');
  withE(h, e => { e.discardFromHand(P, bwi); e.processTriggerQueue(); });
  const asked: string[][] = [];
  for (let guard = 0; guard < 30 && h.state.decision; guard++) {
    const d = h.state.decision;
    const labels = d.options.map(o => String(o.label));
    let choice: number | number[] = 0;
    if (d.kind === 'orderTriggers') {
      asked.push(labels);
      // Blightwalker first (it resolves first), everything else after, as listed
      const bw = labels.findIndex(l => BLIGHT.test(l));
      choice = bw >= 0 ? [bw, ...labels.map((_, i) => i).filter(i => i !== bw)] : labels.map((_, i) => i);
    } else if (d.kind === 'targets' && labels.some(l => /^Player/.test(l))) {
      choice = labels.findIndex(l => /^Player/.test(l));   // aim at a player: no unit dies mid-test
    } else if (/discard a card/.test(d.prompt)) {
      choice = labels.findIndex(l => l === 'Dropslime');
      assert.ok(choice >= 0, `Dropslime can be discarded: [${labels.join(' | ')}]`);
      beforeDiscard?.();
    }
    h.do({ type: 'decide', seat: d.seat, choice });
  }
  return asked;
}

test('CT-535: a trigger set off by a batch member\'s cost goes on top of the whole batch, unasked', () => {
  const { h, P } = board(11810);
  const asked = play(h, P);
  assert.equal(asked.length, 1, `one ordering question, the batch's own: ${JSON.stringify(asked)}`);
  assert.ok(asked[0]!.some(l => SPLORT.test(l)) && asked[0]!.some(l => BLIGHT.test(l)) && asked[0]!.length === 2,
    `the question orders Splort and Blightwalker only: ${JSON.stringify(asked[0])}`);
  // nobody holds priority before an attack is declared, so the stack resolves
  // straight away: the order it resolves in is the stack, top first
  const order = resolved(h);
  assert.equal(order.length, 3, `three items resolved: ${JSON.stringify(order)}`);
  assert.ok(DROP.test(order[0]!), `Dropslime's resolves first — it went on top, after the batch: ${JSON.stringify(order)}`);
  assert.ok(BLIGHT.test(order[1]!), `then Blightwalker's, as ordered: ${JSON.stringify(order)}`);
  assert.ok(SPLORT.test(order[2]!), `then Splort's, the bottom: ${JSON.stringify(order)}`);
});

test('CT-535: an opponent\'s trigger set off by the same cost waits for the batch too, then the two players\' late triggers go on top in initiative order', () => {
  const { h, P, theirs } = board(11811, true);
  assert.equal(h.state.initiative, P, 'setup: P has the initiative');
  // Q's Splort walks into the battle just before the discard, so the first trash
  // (Blightwalker) is not heard by it and the second (Dropslime) is: its trigger
  // and Dropslime's are the late batch, one each side (a Splort fires once: [Switch1])
  const asked = play(h, P, () => withE(h, e => { e.entity(theirs!)!.region = e.s.battle!.region; }));
  for (const q of asked) {
    assert.ok(!(q.some(l => BLIGHT.test(l)) && q.some(l => DROP.test(l))),
      `no question orders Blightwalker with Dropslime: ${JSON.stringify(asked)}`);
  }
  const order = resolved(h);
  assert.equal(order.length, 4, `four items resolved: ${JSON.stringify(order)}`);
  // CR 703.4: of the late batch the initiative player's goes on first, so the
  // non-initiative player's resolves first — and both above the first batch
  assert.ok(SPLORT.test(order[0]!), `Q's Splort trigger resolves first: ${JSON.stringify(order)}`);
  assert.ok(DROP.test(order[1]!), `then P's Dropslime: ${JSON.stringify(order)}`);
  assert.ok(BLIGHT.test(order[2]!), `then the first batch, Blightwalker as ordered: ${JSON.stringify(order)}`);
  assert.ok(SPLORT.test(order[3]!), `and P's Splort at the bottom: ${JSON.stringify(order)}`);
});

test('CT-535: the rest of the batch keeps the order its player gave — the late trigger does not re-ask it', () => {
  const { h, P } = board(11812);
  // a second, plain Splort beside the grafted one: the batch is three triggers
  const plain = spawn(h, P, 'Splort');
  withE(h, e => { e.entity(plain)!.region = e.s.battle!.region; });
  const bwi = give(h, P, 'Blightwalker');
  withE(h, e => { e.discardFromHand(P, bwi); e.processTriggerQueue(); });
  const asked: string[][] = [];
  for (let guard = 0; guard < 30 && h.state.decision; guard++) {
    const d = h.state.decision;
    const labels = d.options.map(o => String(o.label));
    let choice: number | number[] = 0;
    if (d.kind === 'orderTriggers') {
      asked.push(labels);
      // Blightwalker, then the plain Splort, then the grafted one — which goes
      // on the stack first and pays its discard with the other two still waiting
      const q = h.state.triggerQueue.filter(t => t.controller === P);
      const rank = (i: number): number => BLIGHT.test(q[i]!.label) ? 0 : q[i]!.parts.length === 1 ? 1 : 2;
      choice = labels.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
    } else if (d.kind === 'targets' && labels.some(l => /^Player/.test(l))) {
      choice = labels.findIndex(l => /^Player/.test(l));
    } else if (/discard a card/.test(d.prompt)) {
      choice = labels.findIndex(l => l === 'Dropslime');
    }
    h.do({ type: 'decide', seat: d.seat, choice });
  }
  assert.equal(asked.length, 1, `one ordering question, the batch's own: ${JSON.stringify(asked)}`);
  assert.equal(asked[0]!.length, 3, `over all three: ${JSON.stringify(asked[0])}`);
  const order = resolved(h);
  assert.equal(order.length, 4, `four items resolved: ${JSON.stringify(order)}`);
  assert.ok(DROP.test(order[0]!), `Dropslime's on top: ${JSON.stringify(order)}`);
  assert.ok(BLIGHT.test(order[1]!), `then Blightwalker's, as first ordered: ${JSON.stringify(order)}`);
  assert.ok(SPLORT.test(order[2]!) && SPLORT.test(order[3]!), `then the two Splorts: ${JSON.stringify(order)}`);
});
