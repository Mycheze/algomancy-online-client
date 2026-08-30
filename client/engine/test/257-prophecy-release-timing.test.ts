/* R277 — what a trailing [Haste] on a prophecy banner does, and what it does NOT.
 *
 * R42 has said since it was written that a card released from cache on a
 * fulfilled prophecy is played "as if it were in your hand", so NORMAL TIMING
 * STILL APPLIES. The engine disagreed with it: `E.cachedTiming` read a trailing
 * [Haste] on the banner as an override of the printed timing, under a comment
 * citing R42 as its authority. Divine Intervention is a {Battle} spell, so the
 * override made its fulfilled, FREE release unplayable at every battle window
 * in the game — the owner lost a game to exactly that (report #152, room ZSPG).
 *
 * The marker is a PROPHESY-window widener instead (report #151): R42 allows
 * prophesying only during deployment, and the marker is the printed exception
 * that lets the card be cached during the haste step too. It says when you may
 * CACHE the card; it says nothing about when you may play it.
 *
 * Seeds 4257xx. Guards, not tripwires: every assertion here is reached only
 * after a non-vacuity assertion has proved the state it is about really exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { IllegalAction } from '../src/apply.ts';
import { allCardNames, getCard, registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import {
  ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';
import type { CachedCard, Seat } from '../src/types.ts';

/** the marker as PRINTED: a bracketed word at the very END of the banner
 * condition. Tithe Enforcer's "End [Haste] with used mana" is deliberately not
 * this — there the bracket names the step the condition is about. */
const MARKED = /\[\s*haste\s*\]\s*$/i;

const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];

/** every registered card whose PRINTED banner carries the trailing marker.
 * Derived, never listed: the pool is the input, so a second card printing the
 * marker is covered the day it is registered. */
function markedBannerCards(): string[] {
  return allCardNames().filter(n => {
    const b = getCard(n).prophecy;
    return b !== undefined && MARKED.test(b.condition);
  });
}

/** the same, for banners with no marker at all */
function unmarkedBannerCards(): string[] {
  return allCardNames().filter(n => {
    const b = getCard(n).prophecy;
    return b !== undefined && !MARKED.test(b.condition);
  });
}

// ── synthetics ────────────────────────────────────────────────────────
//
// A marked {Battle} spell with NO targets, so `castable` is trivially true and
// nothing but timing can decide whether the release is offered.

const T_BATTLE = 'T257 Marked Battle Prophet';
registerSynthetic({
  name: T_BATTLE, cost: '', mana: 6, power: 0, toughness: 0, type: 'Test Spell',
  kind: 'spell', timing: 'battle', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '',
  prophecy: { mana: 1, condition: 'Your life is 5 or less [Haste]' },
} as Printed, {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

/** an inert, unaffordable, deploy-timed filler so nothing in the deck can act */
const FILLER = 'T257 Filler';
registerSynthetic({
  name: FILLER, cost: '', mana: 20, power: 1, toughness: 1, type: 'Test Unit',
  kind: 'unit', timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '',
}, {});

/** a harness whose randomness cannot leak into an assertion (see 36-) */
function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  return h;
}


// ── CT-166: the release obeys the PRINTED timing ──────────────────────

test('R277: the marker does not move a fulfilled release out of battle and into the haste step', () => {
  const h = sterile(425701);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 4);
  h.state.players[P]!.life = 5;                       // the banner condition, met now
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, T_BATTLE) });

  // non-vacuity: it really is cached, the marker really was split off the
  // condition, and the prophecy really is fulfilled and free to release
  const cc = cacheOf(h, P)[0];
  assert.ok(cc, 'the card is in cache');
  assert.equal(cc.card, T_BATTLE);
  assert.equal(cc.prophecy!.condition, 'Your life is 5 or less', 'the marker is not part of the condition');
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'permission is a FULFILLED prophecy');
  assert.equal(getCard(T_BATTLE).timing, 'battle', 'and the card is printed {Battle}');

  // the haste step of the next turn: a {Battle} card is NOT playable there,
  // marker or no marker — R42 plays it "as if it were in your hand"
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step is open');
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'and the release is still permitted');
  assert.ok(!h.legal(P).some(a => a.type === 'playCached'),
    'a {Battle} card is not released during the haste step');
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: 0 }), IllegalAction);
});

test('R277: a fulfilled prophecy on a battle card is offered at a BATTLE window', () => {
  const h = sterile(425702);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 4);
  h.state.players[P]!.life = 5;
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, T_BATTLE) });

  // non-vacuity, again before anything is asserted about the offer
  assert.equal(cacheOf(h, P)[0]!.card, T_BATTLE, 'the card is in cache');
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'the prophecy is fulfilled');

  const atk = spawn(h, P, FILLER);
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [[atk]] });
  while (h.state.priority !== P) h.do({ type: 'passPriority', seat: h.state.priority! });

  assert.equal(h.state.phase, 'battle', 'a battle window, with priority');
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'still fulfilled here');
  assert.ok(h.legal(P).some(a => a.type === 'playCached' && a.index === 0),
    'the free {Battle} release is offered at battle timing (R42)');

  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana, 'and it is free');
  assert.equal(h.state.stack.length, 1, 'and it goes on the stack like any battle card');
});

// ── CT-166, the report: the owner's actual loss, with the actual card ──

test('R277: Divine Intervention can be released from cache in the battle it was prophesied for', () => {
  const h = new Harness(425703);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  giveResources(h, A, 'light', 5);
  giveResources(h, D, 'wood', 2);
  h.state.players[A]!.life = 5;                       // "Your life is 5 or less"
  h.do({ type: 'prophesy', seat: A, from: 'hand', index: give(h, A, 'Divine Intervention') });

  // non-vacuity: this is the exact state the replay log recorded at action 181
  const cc = cacheOf(h, A)[0];
  assert.ok(cc, 'Divine Intervention is in cache');
  assert.equal(cc.card, 'Divine Intervention');
  assert.equal(cc.prophecy!.condition, 'Your life is 5 or less');
  assert.equal(h.q.cachePermission(A, 0), 'prophecy',
    'the prophecy is fulfilled — it may be played from cache for free');
  assert.equal(getCard('Divine Intervention').timing, 'battle');

  const atk = spawn(h, A, 'Good Whale');
  const blk = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });

  // A holds priority, an effect is on the stack to retarget, and the free
  // fulfilled battle spell is sitting in cache. This is the window the owner
  // lost the game in, and the engine offered him nothing.
  assert.equal(h.state.priority, A, 'A has priority');
  assert.equal(h.state.stack.length, 1, 'and there is a target effect on the stack');
  assert.equal(h.q.cachePermission(A, 0), 'prophecy', 'and the release is still permitted');
  assert.ok(h.legal(A).some(a => a.type === 'playCached' && a.index === 0),
    'Divine Intervention is offered from cache');

  h.do({ type: 'playCached', seat: A, index: 0 });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);
  assert.equal(h.state.decision!.seat, A, 'the caster is asked whether to change anything');
  pick(h, true);
  pick(h, { unit: blk });
  pass(h); pass(h);
  assert.equal(ent(h, atk)!.counters, 0, 'the original target is untouched');
  assert.equal(ent(h, blk)!.counters, -1, "the counter landed on D's own unit");
});


// ── CT-167: the marker widens the PROPHESY window ─────────────────────

test('R277: a banner marked [Haste] may be prophesied during the haste step', () => {
  const marked = markedBannerCards();
  assert.ok(marked.length > 0, 'the pool prints at least one marked banner');

  for (const name of marked) {
    const h = sterile(425704);
    h.do({ type: 'donePlanning', seat: 0 });
    h.do({ type: 'donePlanning', seat: 1 });
    const P = 0 as Seat;
    giveResources(h, P, 'fire', 5);
    const idx = give(h, P, name);

    // non-vacuity: the haste step is open, the card is in hand and the banner
    // cost is affordable — nothing but the window can be refusing it
    assert.ok(h.state.hasteDone && !h.state.hasteDone[P], `${name}: the haste step is open`);
    assert.equal(h.state.players[P]!.hand[idx], name, `${name}: it is in hand`);
    assert.ok(h.q.openMana(P) >= getCard(name).prophecy!.mana, `${name}: the banner is affordable`);

    assert.ok(h.legal(P).some(a => a.type === 'prophesy' && a.index === idx),
      `${name}: prophesying is offered during the haste step`);
    h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx });
    assert.equal(cacheOf(h, P)[0]!.card, name, `${name}: and it reaches the cache`);
  }
});

test('R277: an UNMARKED banner is still deployment-only — the haste step refuses it', () => {
  const unmarked = unmarkedBannerCards();
  assert.ok(unmarked.length > 0, 'the pool prints unmarked banners too');

  const h = sterile(425705);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const P = 0 as Seat;
  giveResources(h, P, 'fire', 5);
  assert.ok(h.state.hasteDone && !h.state.hasteDone[P], 'the haste step is open');

  for (const name of unmarked) {
    const idx = give(h, P, name);
    assert.equal(h.state.players[P]!.hand[idx], name, `${name}: it is in hand`);
    assert.ok(h.q.openMana(P) >= getCard(name).prophecy!.mana, `${name}: the banner is affordable`);
    assert.ok(!h.legal(P).some(a => a.type === 'prophesy' && a.index === idx),
      `${name}: prophesying is NOT offered during the haste step`);
    assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }),
      IllegalAction, `${name}: and apply refuses it`);
    h.state.players[P]!.hand.splice(idx, 1);
  }
});

test('R277: the marker never widens the window outside the haste step', () => {
  const marked = markedBannerCards();
  assert.ok(marked.length > 0, 'the pool prints at least one marked banner');
  const name = marked[0]!;

  const h = sterile(425706);
  const P = 0 as Seat;
  giveResources(h, P, 'fire', 5);
  const idx = give(h, P, name);
  // the resource step, BEFORE the haste step opens
  assert.equal(h.state.phase, 'planning');
  assert.equal(h.state.hasteDone, null, 'the haste step has not opened yet');
  assert.ok(!h.legal(P).some(a => a.type === 'prophesy'), 'prophesying is not offered in the resource step');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);

  // and not in battle either
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'doneHaste', seat: 0 });
  h.do({ type: 'doneHaste', seat: 1 });
  assert.equal(h.state.phase, 'battle');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    assert.ok(!h.legal(P).some(a => a.type === 'prophesy'), 'nor during a battle');
    assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);
  }
});
