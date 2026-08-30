/* Literal-reading audit of the dark + fire/water/earth-hybrid batches
 * (batch-dark-a/b/c, batch-hybrids-fwe): the cards whose IMPLEMENTATION was
 * narrower than their PRINTED TEXT.
 *
 * The standing principle is R125's — "when a printed text carries no
 * qualifier, do not invent one" — and both cards pinned here had exactly that
 * shape: a qualifier in the code with no word behind it on the card.
 *
 *  · Nothyr prints "negate up to one target NONSPELL effect". R60 enumerates
 *    the nonspell half itself — "triggered abilities, activated abilities and
 *    A VIRUS BEING APPLIED" — and the restriction listed only the first two,
 *    so a virus on the stack was never offered.
 *  · Rotling prints "[Switch1]", the graft symbol, on its own sentence. The
 *    bounded trigger was implemented; the DONATABLE half of the same marker
 *    was not, so `isGraftable('Rotling')` answered false and the only card in
 *    the pool with a [Switch]-marked effect and no `graftEffect` could not be
 *    applied to anything.
 *
 * Seeds are 11400-11499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard, isGraftable } from '../src/cards/dsl.ts';
import {
  ent, finishBattle, give, giveResources, offered, pass, pick, spawn,
  toDeployment, toNextBattle,
} from './util.ts';
import type { Seat } from '../src/types.ts';

// ── Nothyr: a VIRUS is a nonspell effect (R60) ───────────────────────────

test('Nothyr: "target nonspell effect" reaches a VIRUS on the stack (R60)', () => {
  const h = new Harness(11401);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'dark', 1);      // Gzxyclop is d/[1] and {Virus}
  giveResources(h, D, 'dark', 2);      // Nothyr's "2 [d] Discard Me" line
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  // A applies a {Virus} to an enemy unit: in battle that goes on the STACK as
  // a `kind: 'virus'` item, which R60 names as one of the nonspell effects.
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Gzxyclop'), hostId: host });
  const virusItem = h.state.stack[0]!;
  assert.equal(virusItem.kind, 'virus', 'the premise: a virus item is on the stack');

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Nothyr'), mode: 'discardMe' });
  assert.ok(h.state.players[D]!.bin.includes('Nothyr'), 'the cost discarded it — a trash (R40)');
  assert.equal(h.state.decision!.kind, 'targets', 'R67: the negate names its victim at cast');
  // THE REGRESSION: the restriction used to allow only 'triggered' and
  // 'activated', so this menu was empty and Nothyr could not answer a virus.
  assert.ok(offered(h).includes(JSON.stringify({ stack: virusItem.id })),
    'the virus is offered — "nonspell" is the complement of R60\'s spell half, '
    + 'and a virus being applied is in it');
  pick(h, { stack: virusItem.id });
  pass(h); pass(h);                                     // resolve Nothyr's trigger

  assert.equal(h.state.stack.length, 0, 'R68: the negated virus left the stack at once');
  assert.equal(ent(h, host)!.mods.length, 0, 'the negated virus never attached');
  assert.ok(h.state.players[A]!.bin.includes('Gzxyclop'), 'and its card went to the bin (R68)');
  finishBattle(h);
});

test('Nothyr: an AMBUSH stays out of reach — R60 puts it on the SPELL side', () => {
  // The other direction of the same line, so the widening above cannot drift
  // into "Nothyr negates anything". `stackSpell` is "spell / spell unit /
  // spell token / ambush"; "nonspell" is precisely its complement.
  const spec = getCard('Nothyr').abilities![0]!.effect.targets!;
  assert.equal(spec.what, 'stackEffect', 'the superset kind (R60)');
  const kinds = ['spell', 'spellUnit', 'spellToken', 'ambush', 'triggered', 'activated', 'virus'];
  const g = { s: { stack: kinds.map((kind, i) => ({ id: i, kind })) } } as never;
  const allowed = kinds.filter((_, i) => spec.restrict!(g, { stack: i } as never, {} as never));
  assert.deepEqual(allowed, ['triggered', 'activated', 'virus'],
    'exactly R60\'s nonspell half — no more (ambush and the spell kinds are spell-side) '
    + 'and no less (a virus being applied is a nonspell effect)');
});

// ── Rotling: [Switch1] is a graft symbol ─────────────────────────────────

test('Rotling: the printed [Switch1] makes it graftable at all', () => {
  assert.ok(isGraftable('Rotling'),
    'Rotling prints "[Switch1] You may pay [1] to draw a card and gain 1 rot" — a '
    + 'BOUNDED GRAFTABLE EFFECT. Without a graftEffect the card could not be applied '
    + 'to anything, which made the printed marker half dead text.');
  assert.equal(getCard('Rotling').graftEffect!.bounded, true, '[Switch1]: bounded, not [Switch]');
  assert.ok(getCard('Rotling').abilities!.some(a => a.graftCause),
    'and the same marked ability is the graft CAUSE, as every other [Switch] card in the '
    + 'pool declares it (it can never carry riders from a bin — R51 anchors a zone firing '
    + 'on a stand-in whose mods are [] — but the symbol is on the card)');
});

test('Rotling grafted onto a host: the pay-[1] rider fires off the HOST\'s graft cause', () => {
  const h = new Harness(11403);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 6);
  giveResources(h, P, 'dark', 2);                       // [1] to graft it, [1] for the rider
  const oracle = spawn(h, P, 'Oracle of the Flame');    // "Sacrifice me: [Switch] Create a Fireball 1"
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Rotling'), hostId: oracle, position: 0 });
  assert.equal(ent(h, oracle)!.mods.length, 1, 'the graft attached');
  assert.equal(h.state.entities[ent(h, oracle)!.mods[0]!]!.appliedAs, 'graft');

  const hand0 = h.state.players[P]!.hand.length;
  h.do({ type: 'activateAbility', seat: P, entityId: oracle, abilityIndex: 0 });
  assert.ok(!ent(h, oracle), 'the sacrifice cost was paid at activation');
  assert.equal(h.state.decision!.kind, 'payOrDecline', 'the grafted rider asks for its [1]');
  assert.ok(h.state.decision!.prompt.startsWith('Rotling:'), 'and it is Rotling asking');
  const mana0 = h.q.openMana(P);
  pick(h, true);
  assert.equal(h.state.players[P]!.hand.length, hand0 + 1, 'the rider drew a card');
  assert.equal(h.q.rot(P), 1, 'and charged its rot');
  assert.equal(h.q.openMana(P), mana0 - 1, 'the [1] was paid');
});

test("Rotling grafted OUT OF THE BIN fires its own 'leftBin' (R124's choke point)", () => {
  // The consequence R124's engine note could not have: `zoneTake` routes a
  // mod applied from a bin through E.removeFromBin with reason 'modded', and
  // the comment there says no reachable card noticed "only because Rotling
  // carries no mod symbol". It prints one — so this is the reachable case.
  const h = new Harness(11404);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 6);
  giveResources(h, P, 'dark', 2);
  const oracle = spawn(h, P, 'Oracle of the Flame');
  h.state.players[P]!.bin.push('Rotling');
  h.do({ type: 'graft', seat: P, from: 'bin', index: 0, hostId: oracle, position: 0 });

  assert.equal(ent(h, oracle)!.mods.length, 1, 'grafted straight out of the bin');
  const left = h.events.filter(ev => ev.type === 'leftBin');
  assert.equal(left.length, 1, "exactly ONE 'leftBin' fired");
  assert.deepEqual(left[0]!.data, { seat: P, card: 'Rotling', reason: 'modded' });
  // …and Rotling hears its own exit: "When I leave your bin, [Switch1] You may
  // pay [1] to draw a card and gain 1 rot."
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  assert.ok(h.state.decision!.prompt.startsWith('Rotling:'),
    'the card that left the bin is the card that triggers (R124)');
  pick(h, true);
  assert.equal(h.q.rot(P), 1, 'the [1] bought a draw and a rot');
});
