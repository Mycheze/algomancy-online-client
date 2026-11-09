/* Report #356 (owner, 2026-11-08) — Competitive is the RULES SET, on Draft as
 * on Constructed: "Casual = simultaneous actions during simultaneous phases,
 * Competitive = entirely turn based, INT while NIT watches, then swap … both
 * draft AND constructed should have the competitive vs casual slider".
 *
 * A draft game dealt with `rules: {sequential: true}` keeps the draft step
 * simultaneous (CR 501.4: the draw and draft steps happen for both players at
 * once), and opens the resource step only once both seats have drafted and the
 * packs have passed — the draft game's twin of the constructed bottoming gate
 * (CR 901.9a, 501.4a). From there the steps are the printed order, as in a
 * Competitive Constructed game (803 walks those).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { gateDisagreements, types, walk } from './cc-walk.ts';

const draftGame = (seed = 42): Harness =>
  new Harness(seed, ['Ann', 'Bob'], 'draft', undefined, undefined, undefined, undefined, { sequential: true });

/** keep the pack as dealt: the indices of the pack's own cards in hand+pack */
const keepPack = (h: Harness, seat: Seat): number[] => {
  const hand = h.state.players[seat]!.hand.length, pack = h.state.packs[seat]!.length;
  return Array.from({ length: pack }, (_, i) => hand + i);
};

test('Competitive draft: the draft step is both players at once, and the resource step waits for both', () => {
  for (const seed of [42, 7]) {
    const h = draftGame(seed);
    assert.equal(h.state.sequential, true);
    const int = h.state.initiative, nit = (1 - int) as Seat;
    assert.ok(h.state.draftDone, 'the draft step is open');
    // both may draft; neither may take a resource action yet
    for (const seat of [int, nit]) assert.deepEqual(types(h.legal(seat)), ['draftCommit'], `seat ${seat} in the draft step`);
    assert.deepEqual(gateDisagreements(h.state), [], 'draft step');
    // the NIT drafting first is fine — the draft step is simultaneous
    h.do({ type: 'draftCommit', seat: nit, packIndices: keepPack(h, nit) });
    assert.deepEqual(h.legal(nit), [], 'the NIT, drafted, waits');
    assert.deepEqual(types(h.legal(int)), ['draftCommit'], 'the INT may only draft until the packs pass');
    assert.deepEqual(gateDisagreements(h.state), [], 'half drafted');
    h.do({ type: 'draftCommit', seat: int, packIndices: keepPack(h, int) });
    assert.equal(h.state.draftDone, null, 'the packs passed');
    // now the printed order: the initiative player's resource step first
    assert.ok(h.legal(int).some(a => a.type === 'donePlanning'), 'the INT takes the resource step');
    assert.deepEqual(h.legal(nit), [], 'the NIT watches');
    assert.deepEqual(gateDisagreements(h.state), [], 'INT resource step');
    h.do({ type: 'donePlanning', seat: int });
    assert.ok(h.legal(nit).some(a => a.type === 'donePlanning'), 'then the NIT');
    assert.deepEqual(h.legal(int), []);
  }
});

test('Competitive draft: the initiative player who drafts first waits for the other before the resource step', () => {
  const h = draftGame(42);
  const int = h.state.initiative, nit = (1 - int) as Seat;
  h.do({ type: 'draftCommit', seat: int, packIndices: keepPack(h, int) });
  // CR 501.4a: no player begins the resource step until every player has
  // finished the draft step — under the house rule the INT could start now
  assert.deepEqual(h.legal(int), [], 'the INT, drafted, waits for the NIT to draft');
  assert.deepEqual(types(h.legal(nit)), ['draftCommit']);
  assert.deepEqual(gateDisagreements(h.state), [], 'INT drafted first');
  h.do({ type: 'draftCommit', seat: nit, packIndices: keepPack(h, nit) });
  assert.ok(h.legal(int).some(a => a.type === 'donePlanning'));
  assert.deepEqual(h.legal(nit), []);
});

test('Competitive draft: random games play to the end with the reducer and legalActions agreeing', () => {
  for (const seed of [1, 2, 3]) {
    let checked = 0;
    const r = walk(seed, {
      mode: 'draft', rules: { sequential: true }, maxActions: 400, invariants: true,
      onStep: (s, _legal, i) => {
        if (i % 25 !== 0) return;
        assert.deepEqual(gateDisagreements(s), [], `seed ${seed} action ${i}`);
        checked++;
      },
    });
    assert.equal(r.state.sequential, true);
    assert.ok(checked > 0 && r.actions.length > 50, `seed ${seed}: the walk played (${r.actions.length} actions)`);
  }
});
