/* Per-card tests for the Light & Dark hybrid batch A (batch-hybrids-ld-a):
 * sacrifice-for-damage-and-life (Abyssal Extortionist), the printed
 * "[Gain 4 debt]" cast cost wired at resolution (Hyper Beam, R35/R39), a
 * split-and-cache glimpse (Big Glimpse Card, R41/R45), control theft after
 * combat (Bloppert), life-scaled statics (Burden of Life, The Mighty Doot),
 * counter moving (Chombot), bin reanimation paid for in debt (Covenant of the
 * Damned, R39), recalling a spell off the stack (Dream Lapse), {Lethal}
 * (Gublin, R48), life-change token minting (Life Plant), a repeating
 * sacrifice-or-discard (Mindburn, R35/R40), even-life rot (Pale Tormentor,
 * R38), mods returned to play (Reclaim the Fallen), {Blessed} lifelink (Shib,
 * R48), bin-for-bin trades (Uglk) and bin recall + self-erase (Zephyrzoa).
 * Apex Prime is COMPLETE as of R118: "become a copy of target unit until
 * regroup" is one face carrying the name, the base stats, the attributes, the
 * statics, the triggered/[Augment] text and — since apply.ts learned
 * `E.facesWith(u, 'activated')` — the ACTIVATED abilities too.
 * Debt Plant (no end-of-haste trigger seam) has a registration test + todo.
 *
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration in sibling batches can't shift assertions. Seeds:
 * 4400-4499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { apply } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** run engine mutations white-box; a trigger's decision may suspend —
 * the suspension is recorded in state and answered via h.do('decide'). */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

/** empty both bins and both hands — several cards here read those zones and
 * the opening draws would otherwise decide the assertions */
function clearZones(h: Harness): void {
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
}

// ── Abyssal Extortionist ─────────────────────────────────────────────────

test('Abyssal Extortionist: attacking sacrifices a unit, deals its power and gains that much life', () => {
  const h = new Harness(4400);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ae = spawn(h, A, 'Abyssal Extortionist');            // 5/3
  toNextBattle(h, A);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[ae]] });
  // the attack trigger is on the stack and wants its "any target"
  pick(h, { player: D });
  pass(h); pass(h);                                          // resolve the trigger
  // the only unit I control in the region is the Extortionist itself — forced
  assert.ok(!ent(h, ae), 'the Extortionist sacrificed itself (the only legal unit)');
  assert.ok(h.state.players[A]!.bin.includes('Abyssal Extortionist'), 'sacrificed → bin (R40 trash)');
  assert.equal(h.state.players[D]!.life, lifeD - 5, 'dealt damage equal to its power (5)');
  assert.equal(h.state.players[A]!.life, lifeA + 5, 'gained life equal to the damage dealt');
  finishBattle(h);
});

test('Abyssal Extortionist: with no unit to sacrifice there is no damage', () => {
  const h = new Harness(4401);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ae = spawn(h, A, 'Abyssal Extortionist');
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[ae]] });
  pick(h, { player: D });
  // remove the Extortionist before the trigger resolves: nothing left to sacrifice
  whiteBox(h, e => { delete e.s.entities[ae]; });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, lifeD, 'no sacrifice → no damage');
  assert.ok(h.log.some(l => l.includes('no unit to sacrifice')), 'said so in the log');
  finishBattle(h);
});

// ── Apex Prime ───────────────────────────────────────────────────────────

test('Apex Prime: on an odd life total, all of your units copy the target\'s base stats and attributes (R92)', () => {
  const h = new Harness(4404);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');                       // 4/4
  const tok = spawn(h, A, 'Unit Token');                      // 1/1
  const siren = spawn(h, D, 'Sporebloom Siren');              // 2/2 {Poisonous}, "when I die …"
  h.state.players[A]!.life = 29;                              // odd — the printed gate
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ap, tok]] });
  pick(h, { unit: siren });                                   // R67: the target is declared at cast
  pass(h); pass(h);                                           // resolve the trigger
  pick(h, true);                                              // "you MAY"
  assert.deepEqual(effStats(h, ap), [2, 2], 'base stats copied (R66 E.setBase) — even onto Apex Prime itself');
  assert.deepEqual(effStats(h, tok), [2, 2]);
  assert.ok(ownAttrs(h, ap).has('Poisonous'), 'attributes copied (E.addTempAttr over ownAttrs)');
  assert.ok(ownAttrs(h, tok).has('Poisonous'));
  assert.equal(new E(h.state).nameOf(ent(h, tok)!), 'Sporebloom Siren',
    'R118: the copy is one FACE, so the NAME travels with the stats and the text');
  assert.equal(ent(h, tok)!.card, 'Unit Token',
    'R118 ruling 1: the PHYSICAL card is untouched — only the game name changed');
});

test('Apex Prime: the copied "when I die" text really fires on the copy (R63/R92)', () => {
  const h = new Harness(4405);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Noxious Deathcap');                            // 4/2, "[Augment] when I die, -1/-1 on each unit"
  const cap = unitsOf(h, D)[0]!.id;
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ap, tok]] });
  pick(h, { unit: cap });
  pass(h); pass(h);
  pick(h, true);
  assert.deepEqual(effStats(h, tok), [4, 2], 'the token has the Deathcap\'s base stats');
  // the whole point: the copy is not cosmetic — the granted text is live
  whiteBox(h, e => e.destroy(e.entity(tok)!, 'dies'));
  pass(h); pass(h);                                           // resolve the granted death trigger
  assert.equal(ent(h, ap)!.counters, -1,
    'the Unit Token died with the Deathcap\'s text and poisoned the region');
});

test('Apex Prime: an EVEN life total means the trigger never queues at all (R1)', () => {
  const h = new Harness(4406);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  spawn(h, D, 'Sporebloom Siren');
  h.state.players[A]!.life = 30;                              // even
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ap]] });
  assert.equal(h.state.stack.length, 0, 'R1: the condition is judged at event time');
  assert.equal(h.state.decision, null, 'and no target is ever asked for');
  assert.deepEqual(effStats(h, ap), [4, 4]);
  finishBattle(h);
  // the CONTROL, so this test discriminates rather than just observing a card
  // that does nothing: the identical board on an odd life total does queue.
  const odd = new Harness(4407);
  toDeployment(odd);
  const A2 = odd.state.deployPlayer!, D2 = (1 - A2) as Seat;
  const ap2 = spawn(odd, A2, 'Apex Prime');
  spawn(odd, D2, 'Sporebloom Siren');
  odd.state.players[A2]!.life = 29;
  toNextBattle(odd, A2);
  odd.do({ type: 'declareAttack', seat: A2, columns: [[ap2]] });
  assert.equal(odd.state.decision!.kind, 'targets', 'odd life → the trigger queues and wants its target');
});

/** R118: bring Apex Prime's trigger to resolution with `target` copied onto
 * every unit `A` controls in the battle region. Returns the attacker's id. */
function apexCopy(h: Harness, A: Seat, apexId: number, targetId: number, extra: number[] = []): void {
  h.do({ type: 'declareAttack', seat: A, columns: [[apexId, ...extra]] });
  pick(h, { unit: targetId });                                // R67: declared at cast
  pass(h); pass(h);                                           // resolve the trigger
  pick(h, true);                                              // "you MAY"
}

test('R118: a copy carries the NAME, and the PHYSICAL card is untouched (ruling 1)', () => {
  const h = new Harness(4420);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                    // 7/5
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  const e = new E(h.state);
  assert.equal(e.nameOf(ent(h, tok)!), 'Good Whale', 'the GAME name is the copied card');
  assert.equal(ent(h, tok)!.card, 'Unit Token', 'the PHYSICAL card is still its own');
  assert.deepEqual(effStats(h, tok), [7, 5], 'and the printed numbers are the face\'s');
  finishBattle(h);
});

test('R118: a copy DYING puts the PHYSICAL card in the bin, not the copied one (ruling 1)', () => {
  const h = new Harness(4421);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const cap = spawn(h, A, 'Noxious Deathcap');               // a NON-token body, so it bins
  const whale = spawn(h, D, 'Good Whale');
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [cap]);
  assert.equal(new E(h.state).nameOf(ent(h, cap)!), 'Good Whale');
  whiteBox(h, e => e.destroy(e.entity(cap)!, 'dies'));
  assert.ok(h.state.players[A]!.bin.includes('Noxious Deathcap'),
    'R118 ruling 1: the card that bins is the one that was in the deck');
  assert.ok(!h.state.players[A]!.bin.includes('Good Whale'),
    'the copied card was never anybody\'s card — it does not enter a bin');
});

test('R118: a copied STATIC really radiates — Apex Prime copying Aberrant Statweaver', () => {
  const h = new Harness(4422);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');                      // 1/1
  const sw = spawn(h, D, 'Aberrant Statweaver');              // "your units are base 3/3"
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  assert.deepEqual(effStats(h, tok), [1, 1], 'before: a plain 1/1');
  apexCopy(h, A, ap, sw, [tok]);
  // both of A's units are Statweavers now, and each one's static reads
  // "your units" as ITS controller's — so A's whole side is base 3/3
  assert.deepEqual(effStats(h, tok), [3, 3], 'the copied static radiates from the copy');
  assert.deepEqual(effStats(h, ap), [3, 3], 'onto every unit it matches, itself included');
  assert.ok(new E(h.state).projections(ent(h, tok)!).some(p => p.from === 'Aberrant Statweaver'),
    'and the text box is told which card the clause is printed on');
  finishBattle(h);
});

test('R118: R62 suppression is a veto ABOVE copy — a silenced copy radiates nothing', () => {
  const h = new Harness(4423);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const sw = spawn(h, D, 'Aberrant Statweaver');              // "your units are base 3/3"
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, sw, [tok]);
  const radiators = (): string[] =>
    new E(h.state).projections(ent(h, tok)!).filter(p => p.from === 'Aberrant Statweaver')
      .map(p => String(p.holder));
  assert.equal(radiators().length, 2, 'both copies radiate the copied static');
  whiteBox(h, e => e.suppress(e.entity(ap)!, 'Suppression Field', { attrs: true, abilities: true }));
  assert.equal(radiators().length, 1, 'silencing one copy switches ONLY its face off');
  whiteBox(h, e => e.suppress(e.entity(tok)!, 'Suppression Field', { attrs: true, abilities: true }));
  assert.equal(radiators().length, 0,
    'R62 sits ABOVE layer 0: a silenced copy radiates nothing, all faces at once');
  // …and the veto is about ABILITIES, not identity. The copy is still a
  // Statweaver, and still has a Statweaver's printed 3/3 body.
  assert.equal(new E(h.state).nameOf(ent(h, tok)!), 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, tok), [3, 3], 'the FACE survives suppression — only its text is off');
  finishBattle(h);
});

test('R118: {Unaware} reads the COPIED face\'s printed stats (R106 over layer 0)', () => {
  const h = new Harness(4424);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                    // 7/5
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  const e = new E(h.state);
  assert.deepEqual(e.printedStats(ent(h, tok)!), [7, 5],
    'a Unit Token wearing a Good Whale face PRINTS 7/5 — layer 0 redefines layer 1');
  whiteBox(h, g => g.addCounters(g.entity(tok)!, 2));
  assert.deepEqual(effStats(h, tok), [9, 7], 'counters are facts about the unit, on top');
  whiteBox(h, g => g.addTempAttr(g.entity(tok)!, 'Unaware'));
  assert.deepEqual(effStats(h, tok), [7, 5],
    'R106: {Unaware} throws away everything above layer 1 — and layer 1 is the FACE');
  finishBattle(h);
});

test('R118: {Inverted} inverts the change from the COPIED base (R93 over layer 0)', () => {
  const h = new Harness(4425);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                    // 7/5
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  whiteBox(h, g => g.addCounters(g.entity(tok)!, 2));         // 9/7 — a +2/+2 net change
  assert.deepEqual(effStats(h, tok), [9, 7]);
  whiteBox(h, g => g.addTempAttr(g.entity(tok)!, 'Inverted'));
  assert.deepEqual(effStats(h, tok), [5, 3],
    'the net change from the COPIED base (7/5) is inverted, not from the token\'s own 1/1');
  finishBattle(h);
});

test('R118: a later setBase wins over a copy — and so does an earlier one (layer 2 over layer 0)', () => {
  // copy THEN setBase
  const h = new Harness(4426);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  assert.deepEqual(effStats(h, tok), [7, 5]);
  whiteBox(h, g => g.setBase(g.entity(tok)!, 4, 4));
  assert.deepEqual(effStats(h, tok), [4, 4], 'a base-setter rewrites what the face prints');
  finishBattle(h);

  // setBase THEN copy — the same answer, because copy is layer 0 and BELOW it
  const h2 = new Harness(4427);
  toDeployment(h2);
  const A2 = h2.state.deployPlayer!, D2 = (1 - A2) as Seat;
  const ap2 = spawn(h2, A2, 'Apex Prime');
  const tok2 = spawn(h2, A2, 'Unit Token');
  const whale2 = spawn(h2, D2, 'Good Whale');
  h2.state.players[A2]!.life = 29;
  toNextBattle(h2, A2);
  whiteBox(h2, g => g.setBase(g.entity(tok2)!, 4, 4));
  apexCopy(h2, A2, ap2, whale2, [tok2]);
  assert.deepEqual(effStats(h2, tok2), [4, 4],
    'the copy does not overwrite the base-set: layer 0 is BELOW layer 2 in both orders');
  assert.equal(new E(h2.state).nameOf(ent(h2, tok2)!), 'Good Whale', 'but the face still landed');
  finishBattle(h2);
});

test('R118: an until-regroup face lapses at regroup, and the revert can be lethal', () => {
  const h = new Harness(4428);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');                      // 1/1
  const whale = spawn(h, D, 'Good Whale');                    // 7/5
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  whiteBox(h, g => g.addCounters(g.entity(tok)!, -2));        // 5/3 while wearing the face
  assert.deepEqual(effStats(h, tok), [5, 3]);
  finishBattle(h);
  assert.ok(!ent(h, tok),
    'back to base 1/1 with two -1/-1 counters — the regroup sweep runs a death check');
  assert.ok(h.state.players[A]!.bin.length >= 0);
  assert.equal(ent(h, ap)!.copies, undefined, 'and the surviving copy\'s face is gone');
  assert.deepEqual(effStats(h, ap), [4, 4], 'Apex Prime is a 4/4 again');
});

test('R118: a copy of a COPY chains through the face, not the physical card', () => {
  const h = new Harness(4429);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  assert.equal(new E(h.state).nameOf(ent(h, tok)!), 'Good Whale');
  // now a SECOND Apex copy, aimed at the unit that is already a copy
  const ap2 = spawn(h, A, 'Apex Prime');
  whiteBox(h, g => g.becomeCopy(g.entity(ap2)!, g.entity(tok)!, { from: 'Apex Prime', until: 'regroup' }));
  assert.equal(new E(h.state).nameOf(ent(h, ap2)!), 'Good Whale',
    'MTG\'s copiable values: you copy what it IS, not what card it is printed on');
  assert.deepEqual(effStats(h, ap2), [7, 5]);
  assert.equal(ent(h, ap2)!.card, 'Apex Prime', 'and its own physical card is still Apex Prime');
  finishBattle(h);
});

test('R118: attacking and then blocking leaves ONE face, not two', () => {
  const h = new Harness(4430);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, whale, [tok]);
  assert.equal(ent(h, tok)!.copies!.length, 1);
  whiteBox(h, g => g.becomeCopy(g.entity(tok)!, g.entity(whale)!, { from: 'Apex Prime', until: 'regroup' }));
  assert.equal(ent(h, tok)!.copies!.length, 1,
    'a whole-identity face REPLACES the previous one — copies do not pile up');
  finishBattle(h);
});

/** every activateAbility `seat` may take on `id` right now, as its `via` */
function activations(h: Harness, seat: Seat, id: number): unknown[] {
  return h.legal(seat)
    .filter(a => a.type === 'activateAbility' && a.entityId === id)
    .map(a => (a as { via?: unknown }).via ?? 'own');
}

test('R118: a copied ACTIVATED ability is offered, accepted and really fires — Apex Prime', () => {
  const h = new Harness(4432);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');                      // 1/1, no abilities at all
  const evoker = spawn(h, D, 'Omniwield Evoker');             // 2/1, "[three]: +1/+1 counter on me"
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  assert.deepEqual(activations(h, A, tok), [], 'a Unit Token has nothing to activate');
  apexCopy(h, A, ap, evoker, [tok]);
  assert.equal(new E(h.state).nameOf(ent(h, tok)!), 'Omniwield Evoker');

  // THE OFFER SIDE. The identity face keeps `via: undefined` — the copied card
  // is what the unit IS, so its `abilities` are its own, not borrowed.
  giveResources(h, A, 'metal', 3);                            // the [three]
  assert.deepEqual(activations(h, A, tok), ['own'],
    'the copied activated ability reaches legalActions, addressed as the unit\'s own');

  // THE ACCEPT SIDE — the half that used to refuse what the other half offered
  h.do({ type: 'activateAbility', seat: A, entityId: tok, abilityIndex: 0 });
  assert.ok(h.log.some(l => l.includes('Omniwield Evoker')),
    'the stack row names the FACE, not the physical Unit Token');
  pass(h); pass(h);                                           // resolve it
  assert.equal(ent(h, tok)!.counters, 1, 'and the ability actually did its thing');
  assert.deepEqual(effStats(h, tok), [3, 2], 'a 2/1 Evoker plus its own +1/+1 counter');
  finishBattle(h);
});

test('R118: an until-regroup face takes its ACTIVATED ability with it — Apex Prime', () => {
  const h = new Harness(4433);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Omniwield Evoker');
  const evoker = unitsOf(h, D).find(u => u.card === 'Omniwield Evoker')!.id;
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  apexCopy(h, A, ap, evoker, [tok]);
  giveResources(h, A, 'metal', 3);
  assert.deepEqual(activations(h, A, tok), ['own'], 'offered while the face is worn');
  finishBattle(h);
  assert.equal(ent(h, tok)!.copies, undefined, 'the face lapsed at regroup (R11 step 3)');

  // the same window, one turn later: the token is a Unit Token again
  toNextBattle(h, A);
  giveResources(h, A, 'metal', 3);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  assert.deepEqual(activations(h, A, tok), [],
    'and the borrowed ability is gone with it — the offer follows the face, not the card');
  finishBattle(h);
});

test('R118: Entity.copies survives a seed + actions replay byte for byte', () => {
  const h = new Harness(4431);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');
  const tok = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  h.state.players[A]!.life = 29;
  toNextBattle(h, A);
  // the spawns are white-box, so the round trip is ANCHORED at the state just
  // before the copy; everything past that point is nothing but actions
  const start = structuredClone(h.state);
  const from = h.actions.length;
  apexCopy(h, A, ap, whale, [tok]);
  assert.ok(ent(h, tok)!.copies?.length, 'a face is on the board');
  let st = start;
  for (const a of h.actions.slice(from)) st = apply(st, a).state;
  assert.equal(JSON.stringify(st), JSON.stringify(h.state),
    'CopyRef is plain serializable data — the copy replays identically from the log');
});


test('Apex Prime: plays as a 4/4 and is recognised as an augment (inert donation)', () => {
  const h = new Harness(4402);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ap = spawn(h, p, 'Apex Prime');
  assert.deepEqual(effStats(h, ap), [4, 4], 'vanilla 4/4 in play');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'metal', 1);
  giveResources(h, p, 'earth', 2);                           // lm / 4
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Apex Prime'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
});

// ── Big Glimpse Card ─────────────────────────────────────────────────────

test('Big Glimpse Card: the opponent splits 7, the caster caches one pile playable this turn (R41/R45)', () => {
  const h = new Harness(4403);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'earth', 2);                           // lb / 4
  const seven = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];
  h.state.sharedDeck.unshift(...seven);
  const deckBefore = h.state.sharedDeck.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Big Glimpse Card') });
  pick(h, { player: D });                                    // R67: "target opponent", at cast
  pass(h); pass(h);                                          // resolve
  // the SPLIT is the opponent's: two cards into pile 1, then done
  assert.equal(h.state.decision!.seat, D, 'the opponent splits the piles');
  pick(h, 0); pick(h, 1); pick(h, false);
  // the CASTER chooses which pile is cached
  assert.equal(h.state.decision!.seat, A, 'the caster chooses the pile');
  pick(h, 'a');
  const cache = h.state.players[A]!.cache ?? [];
  assert.deepEqual(cache.map(c => c.card), ['Gublin', 'Shib'], 'pile 1 is cached');
  assert.ok(cache.every(c => c.playableUntilTurn === h.state.turn),
    'glimpse-style permission: playable until end of turn (R45)');
  assert.equal(h.state.sharedDeck.length, deckBefore - 7,
    'R296: all 7 left the deck — two to the cache and five past the mark');
  assert.deepEqual(h.state.sharedRecycled!.slice(-5),
    ['Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'],
    'the other pile is past the mark, in order');
  finishBattle(h);
});

test('Big Glimpse Card: its printed banner is prophesiable for [4] during deployment (R42)', () => {
  const h = new Harness(4428);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 4);                           // the banner cost is plain mana
  const i = give(h, p, 'Big Glimpse Card');
  h.do({ type: 'prophesy', seat: p, from: 'hand', index: i });
  const cc = (h.state.players[p]!.cache ?? [])[0];
  assert.equal(cc?.card, 'Big Glimpse Card', 'it moved from hand to cache');
  assert.equal(cc?.prophecy?.condition, 'Two Turns Pass', 'the printed condition rode along');
  assert.ok(!cc?.prophecy?.fulfilled, 'nothing is fulfilled yet — it counts forward (R43)');
  assert.equal(new E(h.state).openMana(p), 0, 'the banner cost [4] was paid');
});

// ── Bloppert ─────────────────────────────────────────────────────────────

test('Bloppert: after combat the highest-life player takes it and loses 5', () => {
  const h = new Harness(4404);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                     // 1/1, unblocked
  const blop = spawn(h, D, 'Bloppert');                      // 5/5, own [Augment] live
  toNextBattle(h, A);
  h.state.players[A]!.life = 40;
  h.state.players[D]!.life = 30;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                          // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat (D takes 1) + afterCombat trigger
  pass(h); pass(h);                                          // resolve it
  assert.equal(ent(h, blop)!.controller, A, 'the highest-life player gains control');
  assert.equal(h.state.players[A]!.life, 35, '…then loses 5 life');
  assert.equal(h.state.players[D]!.life, 29, 'the other player only took combat damage');
  finishBattle(h);
});

test('Bloppert: a tie has no single highest player — nothing happens (⚠ flagged text)', () => {
  const h = new Harness(4405);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const blop = spawn(h, D, 'Bloppert');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [] });      // a battle happened, no damage
  if (h.state.phase === 'battle' && h.state.battle!.step === 'declare') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  assert.equal(ent(h, blop)?.controller, D, 'tied life totals: no control change');
  assert.equal(h.state.players[A]!.life, h.state.players[D]!.life, 'still tied');
});

// ── Burden of Life ───────────────────────────────────────────────────────

test('Burden of Life: a 20/20 that gains -X/-X for your life total', () => {
  const h = new Harness(4406);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.life = 5;
  const bol = spawn(h, p, 'Burden of Life');
  assert.deepEqual(effStats(h, bol), [15, 15], '20/20 minus 5 life');
  h.state.players[p]!.life = 12;
  assert.deepEqual(effStats(h, bol), [8, 8], 'the static is LIVE — it tracks the life total');
  // life 20+ makes it a 0/0 and the state check kills it
  h.state.players[p]!.life = 22;
  whiteBox(h, e => { e.checkDeaths(); });
  assert.ok(!ent(h, bol), 'at 22 life the 20/20 is -2/-2 and dies');
});

test('Burden of Life: as a Virus the shrink lands on the HOST (host-anchored static)', () => {
  const h = new Harness(4407);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  h.state.players[D]!.life = 2;
  const victim = spawn(h, D, 'Shib');                        // 7/4
  whiteBox(h, e => e.attachMod(ent(h, victim)!, 'Burden of Life', A, 'augment'));
  assert.deepEqual(effStats(h, victim), [5, 2], "7/4 minus the HOST controller's 2 life");
  // …and raising the host controller's life kills it outright
  h.state.players[D]!.life = 9;
  whiteBox(h, e => { e.checkDeaths(); });
  assert.ok(!ent(h, victim), 'at 9 life the 7/4 is -2/-5 and dies');
});

// ── Chombot ──────────────────────────────────────────────────────────────

test('Chombot: blocking moves up to two counters from one unit onto another', () => {
  const h = new Harness(4408);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const chom = spawn(h, D, 'Chombot');                       // 1/5
  const src = spawn(h, D, 'Unit Token');
  const dst = spawn(h, D, 'Unit Token');
  whiteBox(h, e => e.addCounters(ent(h, src)!, 3));          // 4/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                          // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chom] } });
  // Chombot blocked → its trigger asks for both targets
  pick(h, { unit: src });
  pick(h, { unit: dst });
  pass(h); pass(h);                                          // resolve the trigger
  pick(h, 2);                                                // move two counters
  assert.equal(ent(h, src)!.counters, 1, 'the source kept one counter');
  assert.equal(ent(h, dst)!.counters, 2, 'the destination gained two');
  assert.deepEqual(effStats(h, dst), [3, 3], 'a 1/1 with two +1/+1 counters');
  finishBattle(h);
});

test('Chombot: a counterless source moves nothing', () => {
  const h = new Harness(4409);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const chom = spawn(h, D, 'Chombot');
  const src = spawn(h, D, 'Unit Token');
  const dst = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chom] } });
  pick(h, { unit: src });
  pick(h, { unit: dst });
  pass(h); pass(h);
  assert.equal(ent(h, dst)!.counters, 0, 'nothing to move');
  assert.ok(h.log.some(l => l.includes('no counters to move')), 'said so in the log');
  finishBattle(h);
});

// ── Covenant of the Damned ───────────────────────────────────────────────

test('Covenant of the Damned: reanimates from your bin and charges its cost in debt (R39)', () => {
  const h = new Harness(4410);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  clearZones(h);
  h.state.players[p]!.bin.push('Gublin');                    // ed / 9
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'dark', 1);
  giveResources(h, p, 'earth', 1);                           // ld / 3
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Covenant of the Damned') });
  pick(h, { bin: { seat: p, card: 'Gublin' } });             // R67: declared at cast
  assert.ok(unitsOf(h, p).some(u => u.card === 'Gublin'), 'the unit is in play');
  assert.ok(!h.state.players[p]!.bin.includes('Gublin'), 'it left the bin');
  assert.equal(new E(h.state).debt(p), 9, 'debt equal to its printed cost (R39)');
});

test('Covenant of the Damned: an empty bin makes the cast ILLEGAL (R67)', () => {
  const h = new Harness(4411);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  clearZones(h);
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'dark', 1);
  giveResources(h, p, 'earth', 1);
  const idx = give(h, p, 'Covenant of the Damned');
  // R64/R67: "put TARGET unit from your bin into play" is a mandatory target,
  // so an empty bin means there is nothing legal to aim at and the card may
  // not be played at all. It used to resolve into a no-op, which quietly ate
  // the card and the mana.
  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: idx }),
    /no legal target/i, 'refused, not wasted');
  assert.equal(new E(h.state).debt(p), 0, 'no unit, no debt');
  assert.ok(h.state.players[p]!.hand.includes('Covenant of the Damned'), 'still in hand');
});

// ── Debt Plant ───────────────────────────────────────────────────────────

test('Debt Plant: at the end of [Haste], +1/+1 until regroup per 2 expended resources (R50)', () => {
  const h = new Harness(4430);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const plant = spawn(h, A, 'Debt Plant');                 // 3/2
  const ally = spawn(h, A, 'Unit Token');                  // 1/1
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  giveResources(h, A, 'light', 5, 'expended');             // 5 expended → floor(5/2) = 2
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
  assert.deepEqual(effStats(h, plant), [5, 4], '+2/+2, itself included');
  assert.deepEqual(effStats(h, ally), [3, 3], 'and every other unit of yours');
  finishBattle(h);
  assert.deepEqual(effStats(h, plant), [3, 2], 'the bonus is until regroup');
});

test('Debt Plant: fewer than 2 expended resources buys nothing', () => {
  const h = new Harness(4431);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const plant = spawn(h, A, 'Debt Plant');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  giveResources(h, A, 'light', 1, 'expended');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.deepEqual(effStats(h, plant), [3, 2]);
  assert.ok(h.log.some(l => l.includes('fewer than 2 expended resources')));
  finishBattle(h);
});

test('Debt Plant: plays as a 3/2 and is recognised as an augment', () => {
  const h = new Harness(4412);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const dp = spawn(h, p, 'Debt Plant');
  assert.deepEqual(effStats(h, dp), [3, 2], 'vanilla 3/2 in play');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'wood', 1);
  giveResources(h, p, 'earth', 1);                           // lg / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Debt Plant'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
});

// ── Dream Lapse ──────────────────────────────────────────────────────────

test('Dream Lapse: recalls a spell off the stack to its hand, then its controller discards', () => {
  const h = new Harness(4413);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const prey = spawn(h, D, 'Shib');                          // 7/4 in the battle region
  toNextBattle(h, A);
  clearZones(h);
  giveResources(h, D, 'fire', 2);                            // Luminous Arc: r / 2
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);                            // Dream Lapse: bd / 2
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                   // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: prey });
  const arcId = h.state.stack.find(i => i.card === 'Luminous Arc')!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dream Lapse') });
  pick(h, { stack: arcId });
  pass(h); pass(h);                                          // resolve Dream Lapse
  assert.ok(!h.state.stack.some(i => i.id === arcId), 'the Arc left the stack');
  assert.equal(ent(h, prey)!.damage, 0, 'it never resolved — no damage');
  // it went to hand, and the forced discard then trashed it
  assert.ok(!h.state.players[D]!.hand.includes('Luminous Arc'), 'recalled, then discarded');
  assert.ok(h.state.players[D]!.bin.includes('Luminous Arc'), 'the discard put it in the bin (R40 trash)');
  assert.ok(h.log.some(l => l.includes('is recalled to')), 'recalled, not negated-into-the-bin');
  finishBattle(h);
});

// ── Gublin ───────────────────────────────────────────────────────────────

test('Gublin: {Lethal} — any combat damage kills a player outright (R48)', () => {
  const h = new Harness(4414);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const gub = spawn(h, A, 'Gublin');                         // 1/4 {Lethal}
  toNextBattle(h, A);
  assert.ok(new E(h.state).ownAttrs(ent(h, gub)!).has('Lethal'), 'printed attribute, no code');
  h.do({ type: 'declareAttack', seat: A, columns: [[gub]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // 1 combat damage — and Lethal
  assert.equal(h.state.winner, A, 'one point of combat damage killed the player');
  assert.equal(h.state.phase, 'gameover');
});

// ── Hyper Beam ───────────────────────────────────────────────────────────

test('Hyper Beam: 8 damage + a draw, and its printed [Gain 4 debt] is charged (R35/R39)', () => {
  const h = new Harness(4415);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const prey = spawn(h, D, 'Shib');                          // 7/4
  toNextBattle(h, A);
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'earth', 2);                           // lr / 4
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hyper Beam') });
  pick(h, { unit: prey });
  pass(h); pass(h);                                          // resolve
  assert.ok(!ent(h, prey), '8 damage killed the 7/4');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'drew a card (the Beam itself left hand)');
  assert.equal(new E(h.state).debt(A), 4, 'the printed [Gain 4 debt] cost was charged (R39)');
  finishBattle(h);
});

// ── Life Plant ───────────────────────────────────────────────────────────

test('Life Plant: [once] per turn — a life change mints that many 1/1 units', () => {
  const h = new Harness(4416);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Life Plant');
  const before = unitsOf(h, p).length;
  whiteBox(h, e => e.gainLife(p, 3, 'test'));
  const made = unitsOf(h, p).filter(u => u.card === 'Unit Token' && u.token);
  assert.equal(made.length, 3, 'three 1/1 units');
  assert.deepEqual(effStats(h, made[0]!.id), [1, 1], 'each is a 1/1');
  assert.equal(unitsOf(h, p).length, before + 3, 'nothing else changed');
  // [once]: a second life change this turn does nothing (R9)
  whiteBox(h, e => e.loseLife(p, 2, 'test'));
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 3, 'bounded — no second batch');
});

// R115 (2026-08-23) REVERSED this test. Report #83 IS this card: "Life Plant's
// units were made in my region, despite it currently being in Rashi's region.
// Anything made by anything needs to spawn in that region."
test('Life Plant: R115 — the created units arrive in the BATTLE region the carrier is fighting in', () => {
  const h = new Harness(4418);
  toDeployment(h);
  const A = h.state.initiative;
  const plant = spawn(h, A, 'Life Plant');                   // 7/3 — it attacks
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[plant]] });
  const battleRegion = h.state.battle!.region;
  const home = h.state.regions.findIndex(r => r.owner === A);
  assert.notEqual(home, battleRegion, 'the carrier is fighting in the ENEMY region');
  whiteBox(h, e => e.loseLife(A, 2, 'test'));
  pass(h); pass(h);                                          // resolve the queued trigger
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.token);
  assert.equal(made.length, 2, 'two 1/1s were created');
  assert.ok(made.every(u => u.region === battleRegion),
    'R115: a created unit arrives where its SOURCE is — the enemy region Life Plant is standing in');
  assert.ok(made.every(u => u.region !== home), 'R52 is WITHDRAWN — they are NOT sent home');
  finishBattle(h);
});

test("Life Plant: only YOUR life changes count", () => {
  const h = new Harness(4417);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  spawn(h, p, 'Life Plant');
  whiteBox(h, e => e.gainLife(o, 3, 'test'));
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 0,
    "the opponent's life gain does not trigger it");
});

// ── Mindburn ─────────────────────────────────────────────────────────────

test('Mindburn: each player sacrifices a nontoken unit or discards, X times (R35/R40)', () => {
  const h = new Harness(4418);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Gublin');                        // A's only nontoken unit
  const theirs = spawn(h, D, 'Shib');                        // D's only nontoken unit
  toNextBattle(h, A);
  clearZones(h);
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);                            // rd / X, X ≤ 2
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Mindburn') });
  pick(h, 1);                                                // X = 1
  pass(h); pass(h);                                          // resolve
  // each player had exactly one option (their unit; hands are empty) — forced
  assert.ok(!ent(h, mine), "A's unit was sacrificed");
  assert.ok(!ent(h, theirs), "D's unit was sacrificed");
  assert.ok(h.state.players[A]!.bin.includes('Gublin'), 'sacrificed → bin (R40 trash)');
  assert.ok(h.state.players[D]!.bin.includes('Shib'), 'and theirs too');
  finishBattle(h);
});

test('Mindburn: X = 0 does nothing', () => {
  const h = new Harness(4419);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Gublin');
  const theirs = spawn(h, D, 'Shib');
  toNextBattle(h, A);
  clearZones(h);
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Mindburn') });
  pick(h, 0);                                                // X = 0
  pass(h); pass(h);
  assert.ok(ent(h, mine) && ent(h, theirs), 'nobody sacrificed anything');
  assert.ok(h.log.some(l => l.includes('X = 0')), 'said so in the log');
  finishBattle(h);
});

// ── Pale Tormentor ───────────────────────────────────────────────────────

test('Pale Tormentor: after combat, every even-life player gains two rot (R38)', () => {
  const h = new Harness(4420);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Pale Tormentor');                             // 1/6, own [Augment] live
  toNextBattle(h, A);
  h.state.players[A]!.life = 40;                             // even
  h.state.players[D]!.life = 36;                             // becomes 35 (odd) after 1 damage
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat + afterCombat trigger
  pass(h); pass(h);                                          // resolve it
  const e = new E(h.state);
  assert.equal(e.rot(A), 2, 'even life → two rot');
  assert.equal(e.rot(D), 0, 'odd life → none');
  finishBattle(h);
});

test('Pale Tormentor: rot bites at the start of the next deployment (R38)', () => {
  const h = new Harness(4421);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  whiteBox(h, e => e.gainRot(p, 2));
  const life = h.state.players[p]!.life;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  toDeployment(h);
  assert.equal(h.state.players[p]!.life, life - 2, 'took damage equal to its rot');
  assert.equal(new E(h.state).rot(p), 2, 'rot never decays (R38)');
});

// ── Reclaim the Fallen ───────────────────────────────────────────────────

test('Reclaim the Fallen: unit mods leave the host and enter play; other mods stay', () => {
  const h = new Harness(4422);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Shib');
  whiteBox(h, e => {
    e.attachMod(ent(h, host)!, 'Gublin', D, 'augment');       // a UNIT mod
    e.attachMod(ent(h, host)!, 'Luminous Arc', D, 'augment'); // a SPELL mod — stays
  });
  assert.equal(ent(h, host)!.mods.length, 2, 'setup: two mods');
  toNextBattle(h, A);
  giveResources(h, A, 'earth', 1);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'wood', 1);                            // ed / 3
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reclaim the Fallen') });
  pick(h, { unit: host });
  pass(h); pass(h);                                          // resolve
  assert.ok(unitsOf(h, D).some(u => u.card === 'Gublin'), "the unit mod is in play under the mod's controller");
  const left = ent(h, host)!.mods.map(id => ent(h, id)!.card);
  assert.deepEqual(left, ['Luminous Arc'], 'the nonunit mod stayed on the host');
  finishBattle(h);
});

// ── Shib ─────────────────────────────────────────────────────────────────

test('Shib: {Blessed} combat damage gains its controller that much life (R48)', () => {
  const h = new Harness(4423);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const shib = spawn(h, A, 'Shib');                          // 7/4 {Blessed}
  toNextBattle(h, A);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  assert.ok(new E(h.state).ownAttrs(ent(h, shib)!).has('Blessed'), 'printed attribute, no code');
  assert.equal(new E(h.state).card('Shib').ambush?.mana, 4, 'printed "[4] Ambush" play mode');
  h.do({ type: 'declareAttack', seat: A, columns: [[shib]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, lifeD - 7, 'seven combat damage');
  assert.equal(h.state.players[A]!.life, lifeA + 7, '…and seven life gained (R48)');
  finishBattle(h);
});

// ── The Mighty Doot ──────────────────────────────────────────────────────

test('The Mighty Doot: your units gain +1/+1 per 3 life an opponent leads by', () => {
  const h = new Harness(4424);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  const doot = spawn(h, p, 'The Mighty Doot');               // 3/3
  const ally = spawn(h, p, 'Unit Token');                    // 1/1
  assert.deepEqual(effStats(h, ally), [1, 1], 'level life totals: no bonus');
  h.state.players[o]!.life = h.state.players[p]!.life + 10;  // lead 10 → floor(10/3) = 3

  // ⚠ R243 CHANGED THIS, AND THE CHANGE IS THE RULING, NOT A REGRESSION.
  // "An opponent" is an opponent IN THIS REGION. Out of battle a home region
  // lists only its owner (the standing R25 behaviour every "each opponent"
  // card already has), so during deployment there is no opponent here for the
  // superlative to read and the bonus is zero. This test used to assert +3/+3
  // here, reading a life total belonging to a player who is not present.
  assert.deepEqual(effStats(h, ally), [1, 1],
    'R243: no opponent is in my home region during deployment, so nobody leads me here');

  // …and in the BATTLE region, where the opponent really is present, it buffs
  // exactly as printed. This half is what proves the card still works — a
  // green above on its own would be equally consistent with having broken it.
  h.state.regions[h.state.entities[doot]!.region]!.presentSeats = [p as Seat, o as Seat];
  assert.deepEqual(effStats(h, ally), [4, 4], '+3/+3 where the opponent is standing');
  assert.deepEqual(effStats(h, doot), [6, 6], 'it buffs itself too ("your units")');
  h.state.players[o]!.life = h.state.players[p]!.life - 10;  // I am ahead
  assert.deepEqual(effStats(h, ally), [1, 1], 'never negative');
});


// ── Uglk ─────────────────────────────────────────────────────────────────

test("Uglk: after combat each player puts a unit from their bin into play under the opponent's control", () => {
  const h = new Harness(4425);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Uglk');                                       // 3/4, own [Augment] live
  toNextBattle(h, A);
  clearZones(h);
  h.state.players[A]!.bin.push('Gublin');
  h.state.players[D]!.bin.push('Shib');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat + afterCombat trigger
  pass(h); pass(h);                                          // resolve it
  assert.ok(unitsOf(h, D).some(u => u.card === 'Gublin'), "A's bin unit entered play for D");
  assert.ok(unitsOf(h, A).some(u => u.card === 'Shib'), "D's bin unit entered play for A");
  assert.ok(!h.state.players[A]!.bin.includes('Gublin'), 'it left the bin');
  assert.ok(!h.state.players[D]!.bin.includes('Shib'), 'and so did theirs');
  finishBattle(h);
});

// ── Zephyrzoa ────────────────────────────────────────────────────────────

test('Zephyrzoa: a connecting column recalls your whole bin and erases it', () => {
  const h = new Harness(4426);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const zep = spawn(h, A, 'Zephyrzoa');                      // 1/1, own [Augment] live
  toNextBattle(h, A);
  clearZones(h);
  h.state.players[A]!.bin.push('Gublin', 'Shib');
  h.do({ type: 'declareAttack', seat: A, columns: [[zep]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat: D takes 1 → the trigger
  pass(h); pass(h);                                          // resolve it
  assert.deepEqual(h.state.players[A]!.hand.sort(), ['Gublin', 'Shib'], 'the whole bin is recalled to hand');
  assert.equal(h.state.players[A]!.bin.length, 0, 'the bin is empty');
  assert.ok(!ent(h, zep), 'it erased itself');
  assert.ok(!h.state.players[A]!.bin.includes('Zephyrzoa'), 'erasing never touches a bin (R40)');
  assert.ok(!h.state.players[A]!.hand.includes('Zephyrzoa'), '…and is not a recall either');
  finishBattle(h);
});

test('Zephyrzoa: a blocked column does not connect — no trigger', () => {
  const h = new Harness(4427);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const zep = spawn(h, A, 'Zephyrzoa');
  const blocker = spawn(h, D, 'Chombot');                    // 1/5 — absorbs the 1/1
  toNextBattle(h, A);
  clearZones(h);
  h.state.players[A]!.bin.push('Gublin');
  h.do({ type: 'declareAttack', seat: A, columns: [[zep]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  // Chombot's own block trigger wants two targets before anything else runs
  pick(h, { unit: zep });
  pick(h, { unit: blocker });
  finishBattle(h);
  assert.ok(h.state.players[A]!.bin.includes('Gublin'), 'the bin was never recalled');
});
