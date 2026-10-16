/**
 * CR 708.4, the replacement CHAIN, for the two hooks whose substitute is still
 * the same kind of event: a counter placement redirected by Counter Thief is
 * still a counter placement, and a token Cosmic Conspirator swaps is still a
 * token being created. Both used to be "first one to claim it consumes".
 *
 * Caleb Gannon, rules-questions 2025-11-25: "replacement effects don't work
 * like triggers" … "its a replacement effect so it just takes one thing and
 * replaces it with another (you the player control how they stack)" … "1 token
 * -> 2tokens -> 3 tokens" … "the tldr is replacement effects only apply once
 * onto an effect". The owner, 2026-10-16: "Go with Caleb. ... But the chain
 * should work in the way he says", and on two Oorblaks: each effect applies
 * once, and only if the event AS THE EARLIER EFFECTS LEFT IT still matches its
 * own condition.
 *
 * So each holder applies at most once, in turn, to the event as the ones
 * before it left it. Order is entity id (timestamp) — Caleb says the player
 * orders them, which is an open item; these tests pin the timestamp default.
 *
 * RED-CHECK: restore the first-one-wins `return` in `E.replaceCounters` /
 * `E.replaceTokenCreation` (or route either around `chainReplacements`) and the
 * tests marked RED below fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import {
  ent, give, giveResources, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf, withE as whiteBox,
} from './util.ts';

// ── Counter Thief ─────────────────────────────────────────────────────────

test('CR 708.4: two Counter Thieves chain — the second takes the counters from the first, once', () => {
  // RED before the chain: the lower id kept all 3.
  const h = new Harness(46801);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const first = spawn(h, P, 'Counter Thief');
  const second = spawn(h, P, 'Counter Thief');
  const other = spawn(h, P, 'Mohruung');
  toNextBattle(h, P);
  const before = h.events.length;
  whiteBox(h, e => e.addCounters(e.entity(other)!, 3));
  assert.equal(ent(h, other)!.counters, 0, 'the unit they were aimed at gets none');
  assert.equal(ent(h, first)!.counters, 0,
    'the first thief redirected them onto itself, and that placement is still one the second thief matches');
  assert.equal(ent(h, second)!.counters, 3, 'so they end on the second thief');
  const after = h.events.slice(before);
  assert.equal(after.filter(ev => ev.type === 'countersChanged').length, 1,
    'still ONE placement — the chain decides where it lands before anything lands');
  assert.equal(h.log.filter(l => /Counter Thief: the 3 counter\(s\)/.test(l)).length, 2,
    'each thief applied exactly once');
});

test('CR 708.4: three Counter Thieves — each applies once and the counters end on the last', () => {
  // RED before the chain (the first kept them).
  const h = new Harness(46802);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const t = [spawn(h, P, 'Counter Thief'), spawn(h, P, 'Counter Thief'), spawn(h, P, 'Counter Thief')];
  const other = spawn(h, P, 'Mohruung');
  toNextBattle(h, P);
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.deepEqual(t.map(id => ent(h, id)!.counters), [0, 0, 2]);
});

test('CR 708.4: counters aimed at a Counter Thief are taken by the other thief, then taken back', () => {
  // RED before the chain: the second thief kept them. The first thief does not
  // apply to counters already coming to it ("placed on me instead" changes
  // nothing); once the second has redirected them onto ITSELF, the first,
  // which has not applied yet, matches the event as it now stands and takes
  // them — and the second, having applied, cannot take them again.
  const h = new Harness(46803);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const first = spawn(h, P, 'Counter Thief');
  const second = spawn(h, P, 'Counter Thief');
  toNextBattle(h, P);
  whiteBox(h, e => e.addCounters(e.entity(first)!, 2));
  assert.equal(ent(h, first)!.counters, 2);
  assert.equal(ent(h, second)!.counters, 0);
});

test('CR 708.4: one Counter Thief still redirects once, and not outside battle', () => {
  const h = new Harness(46804);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const thief = spawn(h, P, 'Counter Thief');
  const other = spawn(h, P, 'Mohruung');
  whiteBox(h, e => e.addCounters(e.entity(other)!, 1));
  assert.equal(ent(h, other)!.counters, 1, 'deployment is not battle');
  toNextBattle(h, P);
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.equal(ent(h, thief)!.counters, 2);
  assert.equal(ent(h, other)!.counters, 1);
});

// ── Cosmic Conspirator ────────────────────────────────────────────────────

/** A plays Self-Assembly (Robot X, X = 2 here) with two Conspirators out */
function twoConspirators(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Conspirator');
  spawn(h, A, 'Cosmic Conspirator');
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
  return { h, A };
}

test('CR 708.4: two Cosmic Conspirators chain — the second may swap the token the first swapped in', () => {
  // RED before the chain: after the first Conspirator swapped the Robot for a
  // Fireball, the second was never asked, and a Fireball was created.
  const { h, A } = twoConspirators(46805);
  assert.match(h.state.decision!.prompt ?? '', /instead of the Robot 2/, 'the first is asked about the Robot');
  pick(h, 'Fireball');
  assert.ok(h.state.decision, 'the second Conspirator is asked too');
  assert.match(h.state.decision!.prompt ?? '', /instead of the Fireball 2/,
    'and it is asked about the Fireball the first one left, not the Robot');
  assert.deepEqual(h.state.decision!.options.map(o => o.value).sort(), ['Crystal', 'Poison', 'Robot', 'keep']);
  pick(h, 'Crystal');
  assert.equal(h.state.decision, null, 'each Conspirator applied once, so the chain is over');
  assert.deepEqual(tokensOf(h, A).map(t => `${t.card} ${t.x}`), ['Crystal 2'],
    'one token, of the kind the LAST replacement left, with the same X');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 0, 'no Robot');
});

test('CR 708.4: a Cosmic Conspirator that keeps the token has applied — it is not asked again', () => {
  const { h, A } = twoConspirators(46806);
  pick(h, 'keep');
  assert.match(h.state.decision!.prompt ?? '', /instead of the Robot 2/, 'the second is asked about the kept Robot');
  pick(h, 'Fireball');
  assert.equal(h.state.decision, null,
    'the first Conspirator already applied (it kept the Robot), so it is not asked about the Fireball');
  assert.deepEqual(tokensOf(h, A).map(t => `${t.card} ${t.x}`), ['Fireball 2']);
});
