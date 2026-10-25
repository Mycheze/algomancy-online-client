/* 668 — CT-382: A QUESTION ASKED IN THE MIDDLE OF A CAST CHAIN DOES NOT LOSE THE CHAIN.
 *
 * The 2026-08 audit left one case open: "a NESTED suspension (trigger inside
 * settle() during a chain head's commit) still drops the chain tail". The
 * probe, measured 2026-10-25:
 *
 *  · The only cast chain longer than one item is a {Burst} group (CR 803.5),
 *    and it goes on the STACK (`castChain(…, 'push')`): every token is
 *    committed before anything resolves, so a trigger's question comes after
 *    the whole group is up. That is the first test, with real cards — a
 *    Voltwrath Behemoth ("[Augment] Whenever you play a spell, I deal 1
 *    damage to any target") asking for a target once per Fireball.
 *  · The case the audit named needs a chain of two or more cast WITHOUT the
 *    stack (`castChain(…, 'resolve')`), where a head's commit resolves it and
 *    runs settle() before the next item starts. Driven straight on the engine,
 *    that still drops the tail (see E.castChain). No action can build one: every
 *    {Burst} card in the pool is battle timing (the second test), and a
 *    spell-token cast in deployment pushes too (CR 703.7). The second test is
 *    the tripwire for the day either stops being true.
 *
 * Seeds 66800-66899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/cards/registry.ts';
import { ent, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from './util.ts';
import type { Seat } from '../src/types.ts';

test('CR 803.5 / CT-382: a question asked while a Burst is being cast does not drop the rest of the burst', () => {
  const h = new Harness(66800);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Voltwrath Behemoth');
  const sponge = spawn(h, D, 'Good Whale');           // 7/5: soaks the pings
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  const r = e.homeRegion(D);
  for (const x of [1, 1, 1]) e.createSpellToken(D, 'Fireball', x, r);
  h.state = e.s;
  pass(h);                                             // priority → D
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D).find(t => t.card === 'Fireball')!.id });
  // three Fireballs, each aimed at the attacking player, and three Voltwrath
  // questions — every question answered onto the Whale
  let asked = 0;
  for (let guard = 0; guard < 40 && h.state.phase === 'battle'; guard++) {
    const dec = h.state.decision;
    if (dec && dec.seat === D && dec.kind === 'targets') {
      const toA = dec.options.some(o => JSON.stringify(o.value) === JSON.stringify({ player: A }));
      if (/Voltwrath/.test(dec.prompt)) { asked++; pick(h, { unit: sponge }); }
      else if (toA) pick(h, { player: A });
      else break;
      continue;
    }
    if (dec) break;
    if (!h.state.stack.length) break;
    pass(h);
  }
  assert.equal(tokensOf(h, D).filter(t => t.card === 'Fireball').length, 0, 'the whole burst left play');
  assert.equal(asked, 3, 'Voltwrath asked once per Fireball played');
  assert.equal(lifeA - h.state.players[A]!.life, 3, 'all three Fireballs resolved: 3 damage to the attacker');
  assert.equal(ent(h, sponge)!.damage, 3, 'and all three pings landed');
});

test('CR 803.5 / CT-382: every Burst card is battle timing, so no action casts a group without the stack', () => {
  const bursts = allCardNames().filter(n => getCard(n).burst);
  assert.ok(bursts.length >= 3, `the pool has Burst cards (${bursts.join(', ')})`);
  for (const n of bursts) {
    assert.equal(getCard(n).timing, 'battle',
      `${n} is a Burst card that is not battle timing — a group of it could be cast without the stack, `
      + 'where a question asked inside the first commit drops the rest of the group (CT-382, E.castChain)');
  }
});
