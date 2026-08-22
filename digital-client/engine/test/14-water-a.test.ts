/* Per-card tests for the water-a batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit hands) so
 * parallel card registration can't shift assertions; seeds are 1400-1499.
 *
 * Covers: a tripling graft cause (Amphivore), hand disruption (Bripp), erase
 * + Glimpse (Celestial Purge — R45: reveal N, cache exactly ONE of the
 * glimpser's choice and recycle the rest; the cached one is playable
 * until end of turn ignoring affinity), stack recall (Cosmic Reversal), a live hand-size static (Dreadspawn
 * Horror; its augment-donated form stays parked — mod-carried statics),
 * targeted draw trigger (Dreamfloat Drifter), the engine's per-battle
 * life-loss ledger (Echo of Despair, Null Drone; R14), bin recall (Eldritch
 * Reclaimer), R6 payments (Frosted Denial), hand-entry pump — recalls AND
 * battle draws (Galerider Eel), playing units mid-battle (Hooba-Pon,
 * Insidious Invitation), ambush
 * (Mirage Walker and Lurking Slimebeast, R22),
 * targeted recall (Minor Kraken), deployment-idle tracking (Mirage Walker),
 * Glimpse spells (Oracle of Foretelling, Premonition) and until-regroup
 * pumps (Overwhelm, Protective Adaptations).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, notOffered, offered, ownAttrs,
  pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

const passUntil = (h: Harness, seat: Seat) => { while (h.state.priority !== seat) pass(h); };
const drainStack = (h: Harness) => { while (h.state.stack.length) pass(h); };
import type { CachedCard, Seat } from '../src/types.ts';

/** R41: the cache zone — optional field, so read it through here. */
const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];

// ── Amphivore ────────────────────────────────────────────────────────────

test('Amphivore: combat damage to an opponent triggers grafts thrice (one trigger)', () => {
  const h = new Harness(1401);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const amph = spawn(h, A, 'Amphivore');                    // 2/5, graft cause
  giveResources(h, A, 'fire', 1);                           // Ignis Sprite: r/1
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Ignis Sprite'), hostId: amph, position: 0 });
  assert.equal(ent(h, amph)!.mods.length, 1, 'Ignis Sprite grafted on');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[amph]] });
  pass(h); pass(h);                                         // → blocks
  h.do({ type: 'declareBlocks', seat: 1 - A, blocks: {} });
  pass(h); pass(h);   // combat: 2 dmg → trigger resolves at once (R3 sub-step drain)
  const fires = tokensOf(h, A).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 3, 'unbounded untargeted graft ran three times (3 Fireballs)');
  assert.ok(fires.every(f => f.x === 1));
  finishBattle(h);
});

// ── Bripp ────────────────────────────────────────────────────────────────

test('Bripp: look at target player\'s hand, recycle a card, they draw; 4/2 Feeble spawns', () => {
  const h = new Harness(1402);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  const foe = spawn(h, D, 'Lurking Slimebeast');            // 8/3, trigger-free
  giveResources(h, A, 'water', 5);                          // Bripp: bb/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  // R64 (playtest UFAB): "target player" is the 'player' kind. Under the old
  // 'any' — the DAMAGE kind — every unit in the region was on this menu, the
  // cast was legal, and the spell resolved into "no hand to look at".
  notOffered(h, { unit: foe }, 'a unit has no hand');
  notOffered(h, { unit: tok }, 'nor does your own');
  assert.deepEqual(offered(h).sort(), [JSON.stringify({ player: A }), JSON.stringify({ player: D })].sort(),
    'both seats, and only the seats — "target player" may legally be yourself');
  pick(h, { player: D });                                   // target player
  pass(h); pass(h);                                         // resolve
  const dHand = h.state.players[D]!.hand.slice();
  const deckTop = h.state.sharedDeck[0]!;
  const picked = dHand[0]!;
  pick(h, 0);                                               // recycle D's first card
  assert.equal(h.state.players[D]!.hand.length, dHand.length, 'recycled one, drew one');
  assert.equal(h.state.sharedDeck[h.state.sharedDeck.length - 1], picked, 'recycled card is on the deck bottom');
  assert.equal(h.state.players[D]!.hand[dHand.length - 1], deckTop, 'the draw came off the top');
  const bripp = unitsOf(h, A).find(u => u.card === 'Bripp')!;
  assert.ok(bripp, 'Bripp spawned after resolving');
  assert.deepEqual(effStats(h, bripp.id), [4, 2]);
  assert.ok(ownAttrs(h, bripp.id).has('Feeble'));
  finishBattle(h);
});

// ── Celestial Purge ──────────────────────────────────────────────────────

test('Celestial Purge: erases target unit (no bin); its controller Glimpses 3 — ONE cached, the other two recycled', () => {
  const h = new Harness(1403);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  const slime = spawn(h, D, 'Lurking Slimebeast');          // 8/3, trigger-free
  giveResources(h, A, 'water', 3);                          // Purge: bb/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Celestial Purge') });
  pick(h, { unit: slime });
  const top3 = h.q.deckOf(D).slice(0, 3);
  const deckBefore = h.q.deckOf(D).length;
  const dHandBefore = [...h.state.players[D]!.hand];
  pass(h); pass(h);                                         // resolve → erase + glimpse
  // R45: the GLIMPSER chooses which one to cache — here the erased unit's
  // controller, D, not the caster
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'the glimpser chooses, and the glimpser is D');
  assert.deepEqual(dec.options.map(o => o.card), top3, 'the three revealed cards are the options');
  h.do({ type: 'decide', seat: D, choice: 1 });             // cache the MIDDLE one
  assert.ok(!ent(h, slime), 'unit erased');
  assert.ok(!h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'erase, not bin');
  assert.deepEqual(cacheOf(h, D).map(c => c.card), [top3[1]],
    'exactly ONE card is cached — the chosen one (R45)');
  assert.deepEqual(h.state.players[D]!.hand, dHandBefore, 'nothing reaches hand');
  assert.equal(h.q.deckOf(D).length, deckBefore - 1, 'only the cached card left the deck');
  assert.deepEqual(h.q.deckOf(D).slice(-2), [top3[0], top3[2]],
    'the other two are recycled to the BOTTOM, in revealed order');
  assert.equal(h.q.cachePermission(D, 0), 'glimpse', 'it carries the until-end-of-turn permission');
  assert.equal(cacheOf(h, D)[0]!.prophecy, undefined, 'glimpse attaches no prophecy');
  assert.ok(h.events.some(ev => ev.type === 'glimpsed'), 'and the reveal is public (R41)');
  finishBattle(h);
});

// ── Cosmic Reversal ──────────────────────────────────────────────────────

test('Cosmic Reversal: recalls all other spell effects on the stack to hands', () => {
  const h = new Harness(1404);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 2);                          // Reversal: bb/2
  giveResources(h, D, 'water', 1);                          // Overwhelm: b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  pass(h);                                                  // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: tok });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Cosmic Reversal') });
  pass(h); pass(h);                                         // resolve Reversal first
  assert.equal(h.state.stack.length, 0, 'Overwhelm left the stack without resolving');
  assert.ok(h.state.players[D]!.hand.includes('Overwhelm'), 'recalled to its controller\'s hand');
  assert.ok(!h.state.players[D]!.bin.includes('Overwhelm'), 'not binned');
  assert.ok(h.state.players[A]!.bin.includes('Cosmic Reversal'), 'Reversal itself resolved → bin');
  assert.deepEqual(effStats(h, tok), [1, 1], 'the recalled spell never shrank the token');
  finishBattle(h);
});

// ── Dreadspawn Horror ────────────────────────────────────────────────────

test('Dreadspawn Horror: 7/5 on an empty hand; the virus augment DONATES the live static', () => {
  const h = new Harness(1405);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.length = 0;                      // the static reads the hand LIVE
  const ds = spawn(h, A, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, ds), [7, 5], 'empty hand → the full 7/5');
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 4);                          // bb/2 Virus
  toNextBattle(h, A);                                       // new turn: both players draw 2
  h.state.players[A]!.hand.length = 0;                      // empty again — the host must survive
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Dreadspawn Horror'), hostId: host });
  pass(h); pass(h);                                         // resolve the virus
  const hostEnt = ent(h, host)!;
  assert.equal(hostEnt.mods.length, 1, 'virus augment attached in battle');
  assert.equal(ent(h, hostEnt.mods[0]!)!.card, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, host), [1, 1], 'empty hand: the donated static subtracts nothing');
  // the mod-carried static reads the hand LIVE, anchored on the host
  h.state.players[A]!.hand.push('Jelly');
  assert.deepEqual(effStats(h, host), [0, 0], 'one card in hand → the host is a 0/0');
  assert.deepEqual(effStats(h, ds), [6, 4], 'the in-play copy tracks the same hand');
  h.state.players[A]!.hand.length = 0;                      // let both survive the battle
  finishBattle(h);
});

test('Dreadspawn Horror: "-1/-1 for each card in your hand" tracks the hand live', () => {
  const h = new Harness(1428);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.length = 0;
  const ds = spawn(h, A, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, ds), [7, 5], 'empty hand: 7/5');
  give(h, A, 'Bripp'); give(h, A, 'Bripp'); give(h, A, 'Bripp');
  assert.deepEqual(effStats(h, ds), [4, 2], '3 cards in hand: a live 4/2 — no action in between');
  h.state.players[A]!.hand.length = 1;
  assert.deepEqual(effStats(h, ds), [6, 4], 'cards leaving the hand give the stats back');
  for (let i = 0; i < 4; i++) give(h, A, 'Bripp');          // 5 cards → toughness 0
  const e = new E(h.state);
  e.checkDeaths(); e.settle();
  assert.ok(!ent(h, ds), 'a 5+ card hand kills it at the next death check (toughness ≤ 0)');
  assert.ok(h.state.players[A]!.bin.includes('Dreadspawn Horror'), 'it dies to its own drawback → bin');
});

// ── Dreamfloat Drifter ───────────────────────────────────────────────────

test('Dreamfloat Drifter: attack → you and target opponent each draw a card', () => {
  const h = new Harness(1406);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const dd = spawn(h, A, 'Dreamfloat Drifter');             // augment text live when played normally
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dd]] });
  pick(h, { player: D });                                   // target opponent
  const aHand = h.state.players[A]!.hand.length;
  const dHand = h.state.players[D]!.hand.length;
  pass(h); pass(h);                                         // resolve the trigger
  assert.equal(h.state.players[A]!.hand.length, aHand + 1, 'you draw');
  assert.equal(h.state.players[D]!.hand.length, dHand + 1, 'target opponent draws');
  finishBattle(h);
});

// ── Echo of Despair ──────────────────────────────────────────────────────

test('Echo of Despair: after combat with life lost → a token copy; none without', () => {
  // life lost: Echo attacks unblocked → copy
  const h = new Harness(1407);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const echo = spawn(h, A, 'Echo of Despair');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[echo]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat: D loses 3 (tracked)
  pass(h); pass(h);                                         // resolve the afterCombat trigger
  assert.equal(h.state.players[D]!.life, 27);
  const echoes = unitsOf(h, A).filter(u => u.card === 'Echo of Despair');
  assert.equal(echoes.length, 2, 'a copy was created');
  assert.equal(echoes.filter(u => u.token).length, 1, 'the copy is a token');
  finishBattle(h);

  // no life lost: Echo is blocked, trades with a 1/1 — no copy
  const h2 = new Harness(1408);
  toDeployment(h2);
  const A2 = h2.state.deployPlayer!, D2 = 1 - A2;
  const echo2 = spawn(h2, A2, 'Echo of Despair');
  const blk = spawn(h2, D2, 'Unit Token');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[echo2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [blk] } });
  finishBattle(h2);                                         // blocked: no life lost
  assert.equal(unitsOf(h2, A2).filter(u => u.card === 'Echo of Despair').length, 1,
    'no life lost this battle → no copy');
});

// ── Eldritch Reclaimer ───────────────────────────────────────────────────

test('Eldritch Reclaimer: recalls a unit from your bin to your hand, spawns 4/2', () => {
  const h = new Harness(1409);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.bin.push('Echo of Despair', 'Overwhelm');   // unit + spell in the bin
  giveResources(h, p, 'water', 4);                          // bb/4
  // R64: a real cast-time target — the spell in the bin is never on the menu
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Eldritch Reclaimer') });
  assert.equal(h.state.decision!.options.length, 2,
    'the one unit, plus the "up to" decline (an empty bin must not block the 4/2)');
  notOffered(h, { bin: { seat: p, card: 'Overwhelm' } }, 'a spell is not a unit');
  pick(h, { bin: { seat: p, card: 'Echo of Despair' } });
  assert.deepEqual(h.state.players[p]!.bin, ['Overwhelm'], 'unit left the bin');
  assert.ok(h.state.players[p]!.hand.includes('Echo of Despair'), 'recalled to hand');
  const rec = unitsOf(h, p).find(u => u.card === 'Eldritch Reclaimer')!;
  assert.deepEqual(effStats(h, rec.id), [4, 2], 'the spell unit spawned');
});

// ── Frosted Denial ───────────────────────────────────────────────────────

test('Frosted Denial: controller cannot pay X → the effect is negated', () => {
  const h = new Harness(1410);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);
  giveResources(h, D, 'water', 1);                          // exactly Overwhelm's cost
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: tok });
  const owId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Frosted Denial') });
  assert.equal(h.state.decision!.seat, A, 'caster picks X at cast (R35)');
  assert.equal(h.state.decision!.options[0]!.label, 'X = 1', "X can't be zero (xMin 1)");
  pick(h, 1);                                               // X = 1, paid at cast
  pick(h, { stack: owId });
  pass(h); pass(h);                                         // resolve; D has 0 open → auto-negate
  assert.equal(h.state.decision, null, 'no pay decision when the opponent cannot pay');
  assert.equal(h.state.stack.length, 0, 'R68: the negated Overwhelm left the stack at once');
  assert.ok(h.state.players[D]!.bin.includes('Overwhelm'), 'negated → bin');
  assert.deepEqual(effStats(h, tok), [1, 1], 'the token was never shrunk');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 2, 'A paid X=1');
  finishBattle(h);
});

test('Frosted Denial: controller pays X → the effect survives and you draw', () => {
  const h = new Harness(1411);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5, survives a small shrink
  giveResources(h, A, 'water', 3);
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.state.players[D]!.hand = [];                            // deterministic hand size for Overwhelm
  give(h, D, 'Bripp'); give(h, D, 'Bripp');
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: whale });
  const owId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Frosted Denial') });
  pick(h, 2);                                               // A chooses X = 2 at cast (R35), paid now
  pick(h, { stack: owId });
  const aHand = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                         // resolve Frosted Denial
  assert.equal(h.state.decision!.seat, D, 'controller may pay');
  pick(h, 1);                                               // D pays 2
  assert.equal(h.state.players[A]!.hand.length, aHand + 1, 'they paid → you draw');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, 0, 'D paid X');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 1, 'A paid X too');
  pass(h); pass(h);                                         // Overwhelm resolves (NOT negated)
  assert.deepEqual(effStats(h, whale), [5, 3], '-1/-1 per card in D\'s hand (2)');
  finishBattle(h);
});

// ── Galerider Eel ────────────────────────────────────────────────────────

test('Galerider Eel: a card recalled to my hand during battle → +4/+4 until regroup', () => {
  const h = new Harness(1412);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Galerider Eel');                 // 0/4
  const ally = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 6);                          // Mirage Walker ambush: [4bb]
  give(h, A, 'Mirage Walker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel], [ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Mirage Walker'), mode: 'ambush' });
  pick(h, { unit: ally });                                  // recall the ally → my hand
  pass(h); pass(h);                                         // resolve the ambush
  pass(h); pass(h);                                         // resolve the Eel trigger
  assert.deepEqual(effStats(h, eel), [4, 8], '0/4 + 4/4');
  assert.ok(ownAttrs(h, eel).has('Flying'), 'flying granted (addTempAttr)');
  assert.ok(h.state.players[A]!.hand.includes('Unit Token'), 'the recall reached my hand');
  finishBattle(h);
  assert.deepEqual(effStats(h, eel), [0, 4], 'the pump ends at regroup');
  assert.ok(!ownAttrs(h, eel).has('Flying'), 'the flying grant ends at regroup');
});

test('Galerider Eel: a battle DRAW entering my hand triggers it (+4/+4 and flying)', () => {
  const h = new Harness(1425);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Galerider Eel');                 // 0/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel]] });
  {
    const e = new E(h.state);                               // a card enters my hand: a draw
    e.draw(A, 1);                                           // battle draws fire 'draw' events
    e.settle();
  }
  pass(h); pass(h);                                         // resolve the trigger
  assert.deepEqual(effStats(h, eel), [4, 8], '0/4 + 4/4');
  assert.ok(ownAttrs(h, eel).has('Flying'), 'flying granted');
  finishBattle(h);
  assert.deepEqual(effStats(h, eel), [0, 4], 'gone at regroup');
  assert.ok(!ownAttrs(h, eel).has('Flying'), 'gone at regroup');
});

// ── Hooba-Pon ────────────────────────────────────────────────────────────

test('Hooba-Pon: attack → you may pay for a unit from hand into my formation', () => {
  const h = new Harness(1413);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hooba = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 2);                          // the second Hooba-Pon: bb/2
  give(h, A, 'Hooba-Pon');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);                                         // resolve the trigger
  pick(h, h.state.players[A]!.hand.indexOf('Hooba-Pon'));   // play the second Hooba-Pon
  pick(h, 1);                                               // R75: and where it goes — behind me
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'played into the open back position of my column');
  assert.equal(ent(h, col[1]!)!.card, 'Hooba-Pon');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'the cost was paid');
  assert.ok(!h.state.players[A]!.hand.includes('Hooba-Pon'), 'it left the hand');
  finishBattle(h);
});

// ── Insidious Invitation ─────────────────────────────────────────────────

test('Insidious Invitation: draw, then each player (you first) may play a unit as [Battle]', () => {
  const h = new Harness(1414);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                          // spell b/1 + Echo of Despair b/4
  giveResources(h, D, 'water', 2);                          // Hooba-Pon bb/2
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);                                         // resolve: draw, then the invitations
  assert.equal(h.state.decision!.seat, A, 'caster is invited first');
  pick(h, h.state.players[A]!.hand.indexOf('Echo of Despair'));
  assert.equal(h.state.decision!.seat, D, 'then the opponent');
  pick(h, h.state.players[D]!.hand.indexOf('Hooba-Pon'));
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair'), 'A played a deploy-timing unit in battle');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Hooba-Pon'), 'D did too');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'A paid 1 + 4');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, 0, 'D paid 2');
  assert.equal(h.state.players[A]!.hand.length, 1, 'spell + Echo left, one card drawn');
  finishBattle(h);
});

// ── Lurking Slimebeast ───────────────────────────────────────────────────

test('Lurking Slimebeast: plays as an 8/3', () => {
  const h = new Harness(1415);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'water', 4);                          // bb/4
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lurking Slimebeast') });
  const slime = unitsOf(h, p).find(u => u.card === 'Lurking Slimebeast')!;
  assert.deepEqual(effStats(h, slime.id), [8, 3]);
});

// UNPARKED (round 15): the extractor expands word-form cost tokens now
// (three_blue -> 3b, core.py's COST_WORDS), so printed.ambush is real and the
// R22 mode is offered like any other ambusher's.
test('Lurking Slimebeast: [Battle] Ambush [three_blue] = 3 mana at one water pip (R22)', () => {
  const h = new Harness(1417);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');
  const rc = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'water', 4);                          // 3 is the ambush cost
  give(h, D, 'Lurking Slimebeast');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
  passUntil(h, D);
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.mode === 'ambush'),
    'the ambush mode is offered at all — the whole point of the unpark');
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: rc });
  drainStack(h);
  assert.ok(!ent(h, rc), 'the ally it recalled left play');
  const slime = unitsOf(h, D).find(u => u.card === 'Lurking Slimebeast');
  assert.ok(slime, 'the ambusher is in play');
  assert.equal(h.state.battle!.blocks[0]![0], slime!.id, 'it took the blocking slot');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 3,
    'paid the ambush cost (3), not the printed 4');
  finishBattle(h);
});

// ── Minor Kraken ─────────────────────────────────────────────────────────

test('Minor Kraken: attack → recall target unit with 5 or less defense', () => {
  const h = new Harness(1416);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const kraken = spawn(h, A, 'Minor Kraken');
  const small = spawn(h, D, 'Unit Token');                  // 1/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken]] });
  pick(h, { unit: small });
  pass(h); pass(h);                                         // resolve the trigger
  assert.ok(!ent(h, small), 'recalled out of play');
  assert.ok(h.state.players[D]!.hand.includes('Unit Token'), 'to its owner\'s hand');
  finishBattle(h);

  // R64 — defense > 5: not a legal target, so it is never offered
  const h2 = new Harness(1417);
  toDeployment(h2);
  const A2 = h2.state.deployPlayer!, D2 = 1 - A2;
  const kraken2 = spawn(h2, A2, 'Minor Kraken');
  const tough = spawn(h2, D2, 'Crumbling Ancient');         // 3/8
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[kraken2]] });
  notOffered(h2, { unit: tough }, '8 defense > 5');
  pick(h2, { unit: kraken2 });                              // "up to one" — the Kraken itself is legal
  pass(h2); pass(h2);
  assert.ok(ent(h2, tough), '8 defense > 5 → not recalled');
  finishBattle(h2);
});

// ── Mirage Walker ────────────────────────────────────────────────────────

test('Mirage Walker: ambush [4bb] recalls an ally and takes its formation slot (R22)', () => {
  const h = new Harness(1418);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ally = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 6);
  give(h, A, 'Mirage Walker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Mirage Walker'), mode: 'ambush' });
  pick(h, { unit: ally });
  pass(h); pass(h);                                         // resolve the ambush
  const mw = unitsOf(h, A).find(u => u.card === 'Mirage Walker')!;
  assert.ok(mw, 'the ambusher spawned');
  assert.equal(h.state.battle!.columns[0]![0], mw.id, 'it took the ally\'s exact slot');
  assert.ok(!ent(h, ally), 'the ally left play');
  assert.ok(h.state.players[A]!.hand.includes('Unit Token'), 'recalled to hand');
  finishBattle(h);
});

test('Mirage Walker: end of turn with no deployment actions → a 3/3 unit', () => {
  const h = new Harness(1419);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Mirage Walker');                             // its own arrival marks "acted"
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // end of turn 1
  assert.ok(!unitsOf(h, p).some(u => u.token && u.tokenStats?.[0] === 3),
    'acted during deployment (its own play) → no token');
  // a full turn with an idle deployment
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // end of turn 2
  const made = unitsOf(h, p).filter(u => u.token && u.tokenStats?.[0] === 3);
  assert.equal(made.length, 1, 'idle deployment → one 3/3');
  assert.deepEqual(effStats(h, made[0]!.id), [3, 3]);
});

// ── Null Drone ───────────────────────────────────────────────────────────

test('Null Drone: negates a spell costing ≤ the greatest life lost this battle', () => {
  const h = new Harness(1420);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const drone = spawn(h, A, 'Null Drone');                  // 2/1
  giveResources(h, A, 'water', 3);                          // the Null Drone spell: b/2
  giveResources(h, D, 'water', 1);                          // Overwhelm: b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[drone]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat: D loses 2 (tracked)
  assert.equal(h.state.players[D]!.life, 28);
  pass(h);                                                  // afterWindow: A passes → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: drone });
  const owId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Null Drone') });
  pick(h, { stack: owId });
  pass(h); pass(h);                                         // resolve Null Drone: cost 1 ≤ 2 lost
  assert.equal(h.state.stack.length, 0, 'R68: the negated Overwhelm left the stack at once');
  assert.ok(h.state.players[D]!.bin.includes('Overwhelm'), 'negated → bin');
  assert.deepEqual(effStats(h, drone), [2, 1], 'the drone was never shrunk');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Null Drone').length, 2, 'the spell unit spawned too');
  finishBattle(h);
});

test('Null Drone: life loss is ledgered engine-side — no tracker unit needed in play', () => {
  // E.loseLife bumps battleCounter `lifeLost:<seat>` itself, so life lost
  // BEFORE any Null Drone existed still counts.
  const h = new Harness(1426);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                    // 1/1 — no life-loss listener anywhere
  giveResources(h, A, 'water', 3);                          // the Null Drone spell: b/2
  giveResources(h, D, 'water', 1);                          // Overwhelm: b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat: D loses 1 (engine ledger)
  assert.equal(h.state.players[D]!.life, 29);
  pass(h);                                                  // afterWindow: A passes → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: atk });
  const owId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Null Drone') });
  pick(h, { stack: owId });
  pass(h); pass(h);                                         // resolve Null Drone: cost 1 ≤ 1 lost
  assert.ok(h.log.some(l => l.includes('is negated')), 'Overwhelm negated');
  assert.equal(h.state.stack.length, 0, 'R68: the negated Overwhelm left the stack at once');
  assert.ok(h.state.players[D]!.bin.includes('Overwhelm'), 'negated → bin');
  assert.deepEqual(effStats(h, atk), [1, 1], 'the token was never shrunk');
  finishBattle(h);
});

// ── Oracle of Foretelling ────────────────────────────────────────────────

test('Oracle of Foretelling: Glimpse 5 caches ONE of the five; it is playable IGNORING AFFINITY, 4/1 spawns', () => {
  const h = new Harness(1421);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'water', 5);                          // b/3 + 2 spare mana, ZERO fire affinity
  h.q.deckOf(p).unshift('Ignis Sprite');                    // r/1 deploy unit — needs fire affinity from hand
  const top5 = h.q.deckOf(p).slice(0, 5);
  const deckBefore = h.q.deckOf(p).length;
  const spriteInHand = give(h, p, 'Ignis Sprite');
  assert.ok(!h.legal(p).some(a => a.type === 'playCard' && a.handIndex === spriteInHand),
    'baseline: with no fire affinity the copy IN HAND cannot be played');
  const oracleIdx = give(h, p, 'Oracle of Foretelling');
  const handBefore = h.state.players[p]!.hand.filter((_, i) => i !== oracleIdx);
  h.do({ type: 'playCard', seat: p, handIndex: oracleIdx });
  // R45: reveal 5, cache exactly ONE of the glimpser's choice, recycle 4
  const dec = h.state.decision!;
  assert.equal(dec.seat, p);
  assert.deepEqual(dec.options.map(o => o.card), top5, 'all five are offered, in deck order');
  h.do({ type: 'decide', seat: p, choice: 0 });             // keep the Ignis Sprite on top
  assert.deepEqual(cacheOf(h, p).map(c => c.card), ['Ignis Sprite'], 'exactly one cached');
  assert.deepEqual(h.state.players[p]!.hand, handBefore, 'and nothing reaches hand');
  assert.equal(h.q.deckOf(p).length, deckBefore - 1, 'only the cached card left the deck');
  assert.deepEqual(h.q.deckOf(p).slice(-4), top5.slice(1),
    'the other four are on the BOTTOM, in revealed order');
  const oracle = unitsOf(h, p).find(u => u.card === 'Oracle of Foretelling')!;
  assert.deepEqual(effStats(h, oracle.id), [4, 1]);
  // R45's whole point: the SAME card that is unplayable from hand is playable
  // from the cache, because the glimpse permission ignores affinity.
  assert.equal(h.q.cachePermission(p, 0), 'glimpse');
  assert.ok(h.legal(p).some(a => a.type === 'playCached' && a.index === 0),
    'the cached Ignis Sprite IS offered — glimpse ignores affinity');
  const mana = h.q.openMana(p);
  h.do({ type: 'playCached', seat: p, index: 0 });
  assert.equal(h.q.openMana(p), mana - 1, 'but the mana cost is still paid (Caleb 2023-08-13)');
  assert.ok(unitsOf(h, p).some(u => u.card === 'Ignis Sprite'), 'and it really enters play');
  assert.deepEqual(cacheOf(h, p).map(c => c.card), [], 'it left the cache');
});

// ── Overwhelm ────────────────────────────────────────────────────────────

test('Overwhelm: target unit gains -1/-1 per card in your hand, until regroup', () => {
  const h = new Harness(1422);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.state.players[D]!.hand = [];                            // deterministic count
  give(h, D, 'Bripp'); give(h, D, 'Bripp');
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: whale });
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, whale), [5, 3], '2 cards in hand at resolution → -2/-2 (R1)');
  finishBattle(h);
  assert.deepEqual(effStats(h, whale), [7, 5], 'temporary — gone at regroup');
});

// ── Premonition ──────────────────────────────────────────────────────────

test('Premonition: Glimpse X where X is your water affinity; the permission dies with the turn, the card stays', () => {
  const h = new Harness(1423);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);                          // affinity 3 (expended still counts)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  const top3 = h.q.deckOf(A).slice(0, 3);
  const deckBefore = h.q.deckOf(A).length;
  const handBefore = [...h.state.players[A]!.hand];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Premonition') });
  pass(h); pass(h);                                         // resolve
  const dec = h.state.decision!;
  assert.equal(dec.options.length, 3, 'X = 3 water affinity → Glimpse 3, so three options');
  h.do({ type: 'decide', seat: A, choice: 2 });             // cache the LAST of the three
  assert.deepEqual(cacheOf(h, A).map(c => c.card), [top3[2]], 'exactly one cached (R45)');
  assert.deepEqual(h.state.players[A]!.hand, handBefore, 'nothing to hand');
  assert.equal(h.q.deckOf(A).length, deckBefore - 1, 'the other two stayed in the deck');
  assert.deepEqual(h.q.deckOf(A).slice(-2), [top3[0], top3[1]],
    'recycled to the BOTTOM, in revealed order');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse');
  finishBattle(h);
  // R45: the permission expires at end of turn — the card stays cached, inert
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.deepEqual(cacheOf(h, A).map(c => c.card), [top3[2]], 'still in the cache next turn');
  assert.equal(h.q.cachePermission(A, 0), null, 'but no longer playable');
  assert.ok(!h.legal(A).some(a => a.type === 'playCached'));
});

// ── Protective Adaptations ───────────────────────────────────────────────

test('Protective Adaptations: target unit gains +1/+1 until regroup', () => {
  const h = new Harness(1424);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 1);                          // b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Protective Adaptations') });
  pick(h, { unit: tok });
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, tok), [2, 2], '1/1 + 1/1');
  finishBattle(h);
  assert.deepEqual(effStats(h, tok), [1, 1], 'temporary — gone at regroup');
});

test('Protective Adaptations: the target also gains piercing until regroup', () => {
  const h = new Harness(1427);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 1);                          // b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Protective Adaptations') });
  pick(h, { unit: tok });
  pass(h); pass(h);                                         // resolve (addTempAttr)
  assert.ok(ownAttrs(h, tok).has('Piercing'), 'gains piercing');
  finishBattle(h);
  assert.ok(!ownAttrs(h, tok).has('Piercing'), 'temporary — gone at regroup');
});
