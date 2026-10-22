/**
 * NO TOKEN, UNIT OR MOD, EVER GOES ON AN ERASED PILE — one rule.
 *
 * Owner, 2026-10-22: "Never file tokens". A token is not a card (CR 304.2) and
 * the erased pile is a list of cards (CR 407.1). The rule is kept in ONE place,
 * `E.ev`, which files an 'erased' event's names unless the event says
 * `token: true`; every route that erases a token says so. Most routes are
 * guarded where they were already tested (35-rot-debt-trash: the bin, hand and
 * cache sweeps and a token mod on a death; 129/141: token mods on every
 * leave-play route; 145: a token mod erased from play; 42-dark-b: an exchange).
 * This file guards the three routes nothing else reached: a token HOST erased
 * from play, a modded (Unstable) token host dying, and a spell token recalled
 * off the stack.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import type { StackItem } from '../src/types.ts';
import { ent, toDeployment, withE } from './util.ts';

const pile = (h: Harness, seat: number): string[] => [...(h.state.players[seat]!.erased ?? [])];

test('CR 407.1 / never file tokens: a token host erased from play is not filed, its real mod is', () => {
  const h = new Harness(54901);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = -1;
  withE(h, e => {
    const t = e.spawnUnit(P, 'Rune Channeler', e.homeRegion(P), { token: true });
    id = t.id;
    e.attachMod(t, 'Ignis Sprite', P, 'augment');
    e.augmentWraith(t, P);
  });
  withE(h, e => { e.eraseFromPlay(e.entity(id)!, 'probe'); });
  assert.equal(ent(h, id), undefined, 'the token left play');
  assert.deepEqual(pile(h, P), ['Ignis Sprite'],
    'only the real mod card is filed: neither the token host nor the token mod');
});

test('CR 407.1 / never file tokens: a modded token dying is swept Unstable without being filed, its real mod is', () => {
  const h = new Harness(54902);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = -1;
  withE(h, e => {
    const t = e.spawnUnit(P, 'Rune Channeler', e.homeRegion(P), { token: true });
    id = t.id;
    e.attachMod(t, 'Ignis Sprite', P, 'augment');
  });
  const mark = h.events.length;
  withE(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  assert.ok(h.events.slice(mark).some(ev => ev.type === 'erased' && ev.data?.['card'] === 'Rune Channeler'),
    'the token body is still swept out of the bin (announced)');
  assert.deepEqual(h.state.players[P]!.bin.filter(c => c === 'Rune Channeler'), [], 'and gone from it');
  assert.deepEqual(pile(h, P), ['Ignis Sprite'], 'but only the real mod card is on the erased pile');
});

test('CR 407.1 / never file tokens: a spell token recalled off the stack is not filed', () => {
  const h = new Harness(54903);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = pile(h, P);
  withE(h, e => {
    const item = {
      id: e.s.nextId++, kind: 'spellToken', card: 'Fireball', label: 'Fireball',
      controller: P, region: e.homeRegion(P), negated: false, parts: [],
    } as unknown as StackItem;
    e.recallSpellTokenItem(item, 'probe');
  });
  assert.ok(!h.state.players[P]!.hand.includes('Fireball'), 'the token ceased to exist in the hand');
  assert.deepEqual(pile(h, P), before, 'and is not filed on the erased pile');
});
