/* R299 — recycling a card from hand can make a PRISMITE, not only an element.
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
 * WHAT A MADE PRISMITE IS: exactly a starting one. It arrives dormant, takes
 * an activation to wake, gives no affinity (R17), grants no Shard (R116/R132 —
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

test('R299 every hand card offers a Prismite, after the elements', () => {
  for (const [label, h] of [
    ['shared', new Harness(30801)],
    ['draft', new Harness(30802, undefined, 'draft')],
  ] as const) {
    if (h.state.mode === 'draft') {
      const H = h.state.players[0]!.hand.length;
      h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
    }
    const kinds = recycleKinds(h, 0);
    assert.deepEqual(kinds, [...h.state.elements, 'prismite'],
      `${label}: the elements in their order, then the Prismite last`);
  }
});

test('R299 a recycled Prismite behaves like a starting one', () => {
  const h = new Harness(30803);
  const P = 0;
  const before = h.state.players[P]!.hand.length;
  const res = (): Harness['state']['players'][number]['resources'] => h.state.players[P]!.resources;
  const start = res().length;

  h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'prismite' });
  assert.equal(h.state.players[P]!.hand.length, before - 1, 'the card left the hand');
  assert.deepEqual(res()[start], { kind: 'prismite', state: 'dormant' }, 'a DORMANT prismite arrived');

  // a dormant prismite cannot be exchanged (R17)
  assert.ok(!legalActions(h.state, P).some(a => a.type === 'exchangePrismite' && a.index === start),
    'dormant: no exchange offered');

  h.do({ type: 'activateResource', seat: P, index: start });
  assert.equal(res()[start]!.state, 'open', 'activating it spends an activation like any resource');
  assert.equal(h.state.players[P]!.activationsLeft, 1);
  assert.equal(res().length, start + 1, 'and it grants no Shard');
  for (const el of ALL_ELEMENTS) {
    assert.equal(new E(h.state).affinity(P, el), 0, `an active prismite gives no ${el} affinity (R17)`);
  }

  h.do({ type: 'exchangePrismite', seat: P, index: start, element: 'water' });
  assert.deepEqual(res()[start], { kind: 'water', state: 'open' }, 'exchanged into water, still open');
  assert.equal(new E(h.state).affinity(P, 'water'), 1);
});

test('R299 what stays illegal: a Shard, and exchanging a Prismite into a Prismite', () => {
  const h = new Harness(30804);
  // Caleb allows a Shard "technically", but it is strictly worse than a
  // Prismite, so it is not offered and not accepted — nothing a player loses
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'shard' }), IllegalAction);
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'prismite' }), IllegalAction,
    'an exchange still has to name an element');
});
