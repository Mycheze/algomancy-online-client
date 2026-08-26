/* R195 — PER-COLUMN FACE DAMAGE: "a unit deals combat damage to a player" is
 * answerable now.
 *
 * THE DIVERGENCE (docs/09-divergence-inventory.md §2a, row PER-COLUMN FACE
 * DAMAGE). `commitPlayerDamage` folds every connecting column's face damage
 * into ONE `lifeLost` per seat per sub-step. That event is still one event —
 * it is one simultaneous strike, and splitting it would make "when a player
 * loses life" fire once per column — but it carries a per-column BREAKDOWN
 * now (`E.combatFaceHits` / `FaceDamageHit`), so card text asks who dealt what
 * instead of re-deriving it from the formation.
 *
 * WHAT "RE-DERIVING IT" WAS, and why it is wrong: eight cards reconstructed
 * "my column connected" as *attacking and never blocked, or blocked/blocking
 * with {Piercing}*. That is a statement about GEOMETRY, not about damage. A
 * column can connect by that test and deal the player nothing at all, and then
 * read another column's hit as its own.
 *
 * MEASURED ON THE OLD CODE before any of this was written (2026-08-26) —
 * every one of these is a real board, not a hypothetical:
 *  · Vroot in a 4-power column beside a separate 1/1 column, both unblocked:
 *    the opponent lost 5 and Vroot handed back 5. Vroot's column dealt 4.
 *  · Zephyrzoa in a {Piercing} column a 0/20 wall absorbed whole, beside a 1/1
 *    column that connected: Zephyrzoa erased itself and recalled its bin off a
 *    hit its own column had no part in. Same board, same firing, for
 *    Amphivore and Rippleback Skulker (which took a card off the damaged
 *    player's bin), and for Bloodwind Revenant.
 *  · Sarcophage stripped the counters off a passenger poisoned to 0 power —
 *    a unit that, by R157 §4, "does no damage".
 *  · Blightmound, whose column's every point was prevented by a shield and
 *    which therefore dealt nothing to anything, rotted the opponent off the
 *    other column's hit.
 *
 * THE OWNER'S STEER, 2026-08-24: *"All the cards in Algomancy are pretty
 * literal."* Sarcophage prints "a unit", with no "your", so both sides' units
 * are in scope; it prints "a unit", not "a column", so a passenger that dealt
 * nothing is not one. R157 §4 (owner, 2026-08-25) is the power reading:
 * *"0 power units do no damage. But the other thing in the column can still
 * contribute to the shared column power."* — the COLUMN is the dealer of a
 * column-scoped clause, its positive-power members are the dealers of a
 * unit-scoped one.
 *
 * ⚠ TWO CARDS ARE NOT AFFECTED THE WAY THE INVENTORY SAYS, and both controls
 * are pinned below. Blightmound and Vroot print the clause UNQUALIFIED — no
 * "to an opponent" — so they hear unit damage too, and on an ordinary absorbed
 * board their column really did deal combat damage (to the blockers). Their
 * face-attribution bug is only reachable when the column deals NOTHING, which
 * needs a shield. A test built on the absorbed board for either of them cannot
 * redden and would be a lie.
 *
 * Seeds 6600-6619.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** answer whatever the combat pump raised and drain the stack the damage
 * steps queued (the shape 134-column-and-substep uses) */
function settleCombat(h: Harness): void {
  let guard = 80;
  while (guard-- > 0) {
    const d = h.state.decision;
    if (d) {
      h.do({
        type: 'decide', seat: d.seat,
        choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0,
      });
      continue;
    }
    if (h.state.phase !== 'battle') break;
    if (h.state.battle!.step !== 'afterWindow') break;
    if (!h.state.stack.length) break;
    pass(h);
  }
  if (guard <= 0) throw new Error('settleCombat did not terminate');
}

/** a token with exactly these stats */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

function attr(h: Harness, id: EntityId, a: 'Piercing' | 'Flying' | 'Swift'): void {
  new E(h.state).addTempAttr(ent(h, id)!, a);
}

/**
 * THE ABSORBED BOARD — the inventory's second named consequence.
 *
 * A attacks with TWO columns that both strike in the normal sub-step:
 *   col 0  [subject + a 1/1 {Piercing} ally]   blocked by two 0/20 walls
 *   col 1  [a 1/1]                             unblocked → 1 to the face
 *
 * Col 0 is {Piercing} and therefore "connects" by the old geometric test, and
 * its whole pool is swallowed by the front wall, so its {Piercing} overflow is
 * ZERO. The only face damage on the table is col 1's. Two walls because
 * {Evasive} (Rippleback Skulker) may not be blocked by fewer; {Flying} on the
 * walls because a {Flying} attacker (Bloodwind Revenant) may not be blocked by
 * anything else.
 *
 * `block: false` runs the same board with col 0 UNBLOCKED — the positive
 * control, where the subject's column really does deal face damage.
 */
function absorbedBoard(seed: number, subject: string, block = true) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const sub = spawn(h, A, subject);
  const piercer = tok(h, A, 1, 1);
  const solo = tok(h, A, 1, 1);
  const w1 = tok(h, D, 0, 20), w2 = tok(h, D, 0, 20);
  attr(h, piercer, 'Piercing');
  for (const w of [w1, w2]) attr(h, w, 'Flying');
  return {
    h, A, D, sub, solo,
    go(): void {
      toNextBattle(h, A);
      h.do({ type: 'declareAttack', seat: A, columns: [[sub, piercer], [solo]] });
      pass(h); pass(h);
      h.do({ type: 'declareBlocks', seat: D, blocks: block ? { 0: [w1, w2] } : {} });
      pass(h); pass(h);
    },
  };
}

/**
 * THE PREVENTED BOARD — for the two cards whose clause is UNQUALIFIED.
 *
 * Blightmound ("when I deal combat damage"), Vroot and Flowstone Arcanite
 * ("when my column deals combat damage") hear UNIT damage as well as face
 * damage, so on the absorbed board above their column genuinely dealt combat
 * damage — to the blockers — and firing is correct. To isolate the FACE
 * attribution their column has to deal nothing whatsoever, which is R98's
 * shield: `preventUnitDamage` returns 0, the commit loop `continue`s, and no
 * 'damage' and no 'countersChanged' is emitted at all. The pool is fully
 * assigned to the shielded wall, so {Piercing} overflows nothing either.
 *
 * `swift` makes the OTHER column {Swift} as well, for a {Swift} subject
 * (Flowstone Arcanite) — R117 wants both hits in the same sub-step or the
 * sub-step gate, not the attribution, is what is being measured.
 */
function preventedBoard(seed: number, subject: string, opts: { swift?: boolean } = {}) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const sub = spawn(h, A, subject);
  const solo = tok(h, A, 1, 1);
  const wall = tok(h, D, 0, 20);
  attr(h, sub, 'Piercing');
  attr(h, wall, 'Flying');
  if (opts.swift) attr(h, solo, 'Swift');
  return {
    h, A, D, sub, solo, wall,
    /** `shield: false` is the control — the same board with the damage landing */
    go(shield = true): void {
      if (shield) ent(h, wall)!.damageShield = 'Phytochemical Protection';
      toNextBattle(h, A);
      h.do({ type: 'declareAttack', seat: A, columns: [[sub], [solo]] });
      pass(h); pass(h);
      h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
      pass(h); pass(h);
      settleCombat(h);
    },
  };
}

const fired = (h: Harness, card: string): boolean =>
  h.log.some(l => l.startsWith(`Trigger: ${card}`));

/* ── the seam itself ────────────────────────────────────────────────────── */

test("R195 — a combat 'lifeLost' names the columns that dealt it, and only the units that dealt damage", () => {
  const h = new Harness(6600);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const passenger = tok(h, A, 2, 5);
  const hitter = tok(h, A, 2, 2);
  const solo = tok(h, A, 1, 1);
  // R157 §4: poisoned to 0 power. It is still IN the column and the column
  // still has power — "the other thing in the column can still contribute".
  new E(h.state).addCounters(ent(h, passenger)!, -2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[passenger, hitter], [solo]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);

  const ev = h.events.filter(e => e.type === 'lifeLost').at(-1)!;
  assert.equal(ev.data!['n'], 3, 'ONE aggregated event per seat per sub-step — 2 + 1');
  const g = new E(h.state);
  const hits = g.combatFaceHits(ev);
  assert.equal(hits.length, 2, 'and a breakdown with one entry per column that dealt it');
  assert.equal(hits.reduce((n, x) => n + x.amount, 0), 3, 'the shares sum to the loss');
  const mine = hits.find(x => x.col.includes(passenger))!;
  assert.ok(mine, 'the poisoned passenger is in its COLUMN — column-scoped text still fires');
  assert.equal(mine.amount, 2, "and that column's share is its own 2, not the table's 3");
  assert.deepEqual(mine.units, [hitter],
    'but only the hitter DEALT damage: R157 §4, "0 power units do no damage"');
  assert.deepEqual(g.unitsDealingFaceDamage(ev).map(u => u.id).sort(), [hitter, solo].sort(),
    'across the whole event, exactly the units that dealt combat damage to a player');
  finishBattle(h);
});

/* ── inventory consequence #1: the 0-power passenger ─────────────────────── */

test('R195 — Sarcophage: "Whenever a unit deals combat damage to a player, remove all counters from it" — a 0-power passenger is not one', () => {
  const h = new Harness(6601);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const sarc = spawn(h, A, 'Sarcophage');       // 2/4, its own [Augment] text is live
  const passenger = tok(h, A, 2, 5);
  const hitter = tok(h, A, 2, 2);
  const g = new E(h.state);
  g.addCounters(ent(h, passenger)!, -2);        // poisoned to 0/3 — deals nothing
  g.addCounters(ent(h, hitter)!, 1);            // 3/3, and it does deal
  toNextBattle(h, A);
  // Sarcophage rides in its own column so it is IN the battle region (R12) and
  // is not itself a passenger of the column under test
  h.do({ type: 'declareAttack', seat: A, columns: [[passenger, hitter], [sarc]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);

  assert.equal(ent(h, passenger)!.counters, -2,
    'the passenger dealt no combat damage, so nothing of "it" was removed');
  assert.equal(ent(h, hitter)!.counters, 0,
    'the unit that DID deal it is stripped — the card still works');
  finishBattle(h);
});

test('R195 — Sarcophage strips BOTH sides: the clause prints "a unit", not "your unit"', () => {
  const h = new Harness(6602);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, D, 'Sarcophage');                    // the DEFENDER owns the text
  const hitter = tok(h, A, 2, 2);
  new E(h.state).addCounters(ent(h, hitter)!, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hitter]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);

  assert.equal(ent(h, hitter)!.counters, 0,
    'the attacker that hit me loses its counters — unowned wording, whoever is hit');
  finishBattle(h);
});

/* ── inventory consequence #2: the fully absorbed {Piercing} column ──────── */

test('R195 — Zephyrzoa: "When my column deals combat damage to an opponent, recall your bin and erase me" — a {Piercing} column absorbed whole does not claim another column\'s hit', () => {
  const b = absorbedBoard(6603, 'Zephyrzoa');
  const { h, A, D } = b;
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin');
  const life0 = h.state.players[D]!.life;
  b.go();
  settleCombat(h);

  assert.equal(h.state.players[D]!.life, life0 - 1, 'only the OTHER column connected, for 1');
  assert.ok(ent(h, b.sub), 'my column pierced nothing — the wall swallowed the whole pool');
  assert.deepEqual(h.state.players[A]!.bin, ['Gublin'], 'so the bin was never recalled');
  assert.ok(!h.state.players[A]!.hand.includes('Gublin'), 'and nothing of it reached my hand');
});

test('R195 — Zephyrzoa still fires when its own column really connects (control)', () => {
  const b = absorbedBoard(6604, 'Zephyrzoa', false);
  const { h, A, D } = b;
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin');
  const life0 = h.state.players[D]!.life;
  b.go();
  settleCombat(h);

  assert.equal(h.state.players[D]!.life, life0 - 3, 'nothing is blocked: 1 + 1 through, and 1 more');
  assert.equal(ent(h, b.sub), undefined, 'the column connected, so Zephyrzoa erased itself');
  assert.ok(h.state.players[A]!.hand.includes('Gublin'), 'and recalled the bin');
  assert.deepEqual(h.state.players[A]!.bin, [], 'which is now empty');
});

/* ── one named assertion per card ───────────────────────────────────────── */

test('R195 — Amphivore: "When my column deals combat damage to an opponent, [Switch1][Switch1][Switch1]" — absorbed whole, it triples nothing', () => {
  const b = absorbedBoard(6605, 'Amphivore');
  b.go();
  settleCombat(b.h);
  assert.ok(!fired(b.h, 'Amphivore'),
    'this copy hand-rolled the connect test and had NO sub-step gate and NO power gate either');
});

test('R195 — Amphivore triples on a column that really connects (control)', () => {
  const b = absorbedBoard(6606, 'Amphivore', false);
  b.go();
  settleCombat(b.h);
  assert.ok(fired(b.h, 'Amphivore'), 'the graft cause still fires');
});

test('R195 — Rippleback Skulker: "[Augment] Whenever my column deals combat damage to a player, put target card from that player\'s bin into your hand" — absorbed whole, it takes nothing', () => {
  const b = absorbedBoard(6607, 'Rippleback Skulker');
  b.h.state.players[b.D]!.bin.push('Good Whale', 'Jelly');
  b.go();
  assert.equal(b.h.state.decision, null,
    'no target is asked for: my column dealt that player no damage');
  settleCombat(b.h);
  assert.ok(!fired(b.h, 'Rippleback Skulker'));
  assert.deepEqual(b.h.state.players[b.D]!.bin, ['Good Whale', 'Jelly'], 'their bin is untouched');
});

test('R195 — Rippleback Skulker still takes a card when its column connects (control)', () => {
  const b = absorbedBoard(6608, 'Rippleback Skulker', false);
  b.h.state.players[b.D]!.bin.push('Good Whale', 'Jelly');
  b.go();
  assert.equal(b.h.state.decision?.kind, 'targets', "R67: the bin card is a declared target");
  settleCombat(b.h);
  assert.equal(b.h.state.players[b.D]!.bin.length, 1, 'one card left that bin');
});

test('R195 — Vroot: "[Augment] When my column deals combat damage, each opponent gains that much life" — "that much" is MY column\'s, not the table\'s', () => {
  const h = new Harness(6609);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const v = spawn(h, A, 'Vroot');               // 4/4
  const solo = tok(h, A, 1, 1);
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[v], [solo]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);

  // 5 lost (4 + 1, aggregated into one event), 4 handed back — the 1 the OTHER
  // column dealt is not Vroot's column's to give away
  assert.equal(h.state.players[D]!.life, life0 - 1,
    'lost 5, gained 4: the aggregate is not the amount');
  assert.ok(h.log.some(l => /gains 4 life \(Vroot\)/.test(l)),
    `the payout is 4, not 5 — log was ${JSON.stringify(h.log.filter(l => l.includes('Vroot')))}`);
  finishBattle(h);
});

test('R195 — Vroot: a column whose every point a shield prevented dealt nothing, and pays out nothing', () => {
  const b = preventedBoard(6610, 'Vroot');
  const life0 = b.h.state.players[b.D]!.life;
  b.go();
  assert.equal(b.h.state.players[b.D]!.life, life0 - 1,
    'the other column\'s 1 stands: no gain, because my column dealt nothing at all');
  assert.ok(!fired(b.h, 'Vroot'));
});

test('R195 — Blightmound: "When I deal combat damage or die, [Switch1] Each opponent gains 1 rot" — a column the shield emptied deals none', () => {
  const b = preventedBoard(6611, 'Blightmound');
  b.go();
  assert.equal(b.h.state.players[b.D]!.rot, 0,
    'no damage, no {Poisonous} counters, nothing pierced — and yet a lifeLost was on the table');
  assert.ok(!fired(b.h, 'Blightmound'));
});

test('R195 — Blightmound rots when its column really deals damage (control)', () => {
  const b = preventedBoard(6612, 'Blightmound');
  b.go(false);   // no shield: the 4 lands on the wall as -1/-1 counters
  assert.equal(b.h.state.players[b.D]!.rot, 1, 'the {Poisonous} channel still reaches it');
});

test('R195 — Blightmound is NOT a face-attribution card on an ordinary board: its clause is unqualified, and a blocked column dealt real combat damage (control)', () => {
  const b = absorbedBoard(6613, 'Blightmound');
  b.go();
  settleCombat(b.h);
  assert.equal(b.h.state.players[b.D]!.rot, 1,
    'the inventory named Blightmound, but "when I DEAL combat damage" has no '
    + '"to an opponent" in it: this column dealt 5 to the blockers and the card is owed its rot');
});

test('R195 — Bloodwind Revenant: "When my column deals combat damage to an opponent, [Switch1] You may sacrifice a unit" — absorbed whole, no offer', () => {
  const b = absorbedBoard(6614, 'Bloodwind Revenant');
  b.go();
  settleCombat(b.h);
  assert.ok(!fired(b.h, 'Bloodwind Revenant'),
    'NOT in the inventory row, and carried the identical reconstruction');
});

test('R195 — Bloodwind Revenant still offers the sacrifice when its column connects (control)', () => {
  const b = absorbedBoard(6615, 'Bloodwind Revenant', false);
  b.go();
  settleCombat(b.h);
  assert.ok(fired(b.h, 'Bloodwind Revenant'));
});

test('R195 — Flowstone Arcanite: "When my column deals combat damage, [Switch1] Put a +1/+1 counter on each of your units" — a prevented column puts none', () => {
  const b = preventedBoard(6616, 'Flowstone Arcanite', { swift: true });
  b.go();
  assert.equal(ent(b.h, b.solo)!.counters, 0,
    'NOT in the inventory row either, and it read the same geometry');
  assert.equal(ent(b.h, b.sub)!.counters, 0);
  assert.ok(!fired(b.h, 'Flowstone Arcanite'));
});

test('R195 — Flowstone Arcanite still pays out when its column deals damage (control)', () => {
  const b = preventedBoard(6617, 'Flowstone Arcanite', { swift: true });
  b.go(false);
  assert.ok(fired(b.h, 'Flowstone Arcanite'), 'the 1 power lands on the wall — real combat damage');
  assert.equal(ent(b.h, b.sub)!.counters, 1, 'and every unit of mine here gets its counter');
});
