/* CR 106.6a — recycling a card from hand can make a PRISMITE, not only an element.
 *
 * Playtest ledger #168 (Debeli, 2026-09-17, from the home page): "You can't
 * recycle for the multicolored one you start with to decide later." The
 * designer, rules-questions 2025-05-09: "Yep you can grab prismites. If you
 * meant shards technically yes you could but prismites are strictly better."
 *
 * The engine had only ever accepted an element of the game — `doRecycle`
 * checked `s.elements`, and `legalActions` enumerated it — so the Prismite, a
 * resource like any other (Manual p.18: "any resource can be created from
 * outside the game by recycling a card from hand"), was refused.
 *
 * AND A SHARD (owner, 2026-09-19: "it's also legal to make a shard as well …
 * very very rare, basically never heard of"). Offered after the Prismite, and
 * in the client only behind the expander.
 *
 * WHAT A MADE PRISMITE IS: exactly a starting one. It arrives dormant, takes
 * an activation to wake, gives no affinity (CR 106.6b), grants no Shard (CR 106.7d —
 * `maybeGrantShard` returns early on prismite), and once active may be
 * exchanged for any element of the game.
 *
 * Seeds 30800-30899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ALL_ELEMENTS, IllegalAction, legalActions } from '../src/apply.ts';

const recycleKinds = (h: Harness, seat: 0 | 1): string[] =>
  legalActions(h.state, seat)
    .filter(a => a.type === 'recycleForResource' && a.handIndex === 0)
    .map(a => (a as { element: string }).element);

test('CR 106.6a every hand card offers a Prismite, then a Shard, after the elements', () => {
  for (const [label, h] of [
    ['shared', new Harness(30801)],
    ['draft', new Harness(30802, undefined, 'draft')],
  ] as const) {
    if (h.state.mode === 'draft') {
      const H = h.state.players[0]!.hand.length;
      h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
    }
    const kinds = recycleKinds(h, 0);
    assert.deepEqual(kinds, [...h.state.elements, 'prismite', 'shard'],
      `${label}: the elements in their order, then the Prismite, then the Shard`);
  }
});

test('CR 106.6b a recycled Prismite behaves like a starting one', () => {
  const h = new Harness(30803);
  const P = 0;
  const before = h.state.players[P]!.hand.length;
  const res = (): Harness['state']['players'][number]['resources'] => h.state.players[P]!.resources;
  const start = res().length;

  h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'prismite' });
  assert.equal(h.state.players[P]!.hand.length, before - 1, 'the card left the hand');
  assert.deepEqual(res()[start], { kind: 'prismite', state: 'dormant' }, 'a DORMANT prismite arrived');

  // a dormant prismite cannot be exchanged (CR 106.8b)
  assert.ok(!legalActions(h.state, P).some(a => a.type === 'exchangePrismite' && a.index === start),
    'dormant: no exchange offered');

  h.do({ type: 'activateResource', seat: P, index: start });
  assert.equal(res()[start]!.state, 'open', 'activating it spends an activation like any resource');
  assert.equal(h.state.players[P]!.activationsLeft, 1);
  assert.equal(res().length, start + 1, 'and it grants no Shard');
  for (const el of ALL_ELEMENTS) {
    assert.equal(new E(h.state).affinity(P, el), 0, `an active prismite gives no ${el} affinity (CR 105.5)`);
  }

  h.do({ type: 'exchangePrismite', seat: P, index: start, element: 'water' });
  assert.deepEqual(res()[start], { kind: 'water', state: 'open' }, 'exchanged into water, still open');
  assert.equal(new E(h.state).affinity(P, 'water'), 1);
});

test('a recycled Shard is mana only: no affinity, no Shard of its own, no exchange', () => {
  const h = new Harness(30805);
  const P = 0;
  const res = (): Harness['state']['players'][number]['resources'] => h.state.players[P]!.resources;
  const start = res().length;
  h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'shard' });
  assert.deepEqual(res()[start], { kind: 'shard', state: 'dormant' }, 'a DORMANT shard arrived');
  h.do({ type: 'activateResource', seat: P, index: start });
  assert.equal(res()[start]!.state, 'open', 'it takes an activation like any resource');
  assert.equal(res().length, start + 1, 'and grants no Shard of its own');
  for (const el of ALL_ELEMENTS) {
    assert.equal(new E(h.state).affinity(P, el), 0, `a shard gives no ${el} affinity`);
  }
  assert.ok(!legalActions(h.state, P).some(a => a.type === 'exchangePrismite' && a.index === start),
    'a shard is not a prismite: it cannot be exchanged');
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: P, index: start, element: 'fire' }), IllegalAction);
});

test('CR 106.8d / CT-237: a Prismite exchanges into any non-prismite resource, a Shard included, but never a Prismite', () => {
  // The printed Prismite: "Erase me: Create a non-prismite resource, then
  // activate it". A Shard is a non-prismite resource.
  const h = new Harness(30804);
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'prismite' }), IllegalAction,
    'a Prismite is the one resource an exchange cannot make');
  const kinds = legalActions(h.state, 0)
    .filter(a => a.type === 'exchangePrismite' && a.index === 0)
    .map(a => (a as { element: string }).element);
  assert.deepEqual(kinds, [...h.state.elements, 'shard'],
    'every element of the game, then a Shard, appended so each element keeps its index');
  const before = h.state.players[0]!.resources.length;
  h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'shard' });
  assert.deepEqual(h.state.players[0]!.resources[0], { kind: 'shard', state: 'open' },
    'the Prismite became a Shard, in its place and in its state');
  assert.equal(h.state.players[0]!.resources.length, before, 'and no affinity Shard came with it');
});
