/* R127 — Ancient One copies the WHOLE text box: every behaviour channel
 * except attributes.
 *
 * The owner, 2026-08-24: *"Ancient One technically copies eeeeverything,
 * including everything you mentioned. It explicitly includes modded abilities.
 * The only thing it doesn't are attributes (like Piercing or Unstable). It
 * basically just copies the whole text box of adjacent allies (so only during
 * combat) right in its text box."*
 *
 * R118 shipped the copy layer with three ability facets (`statics`,
 * `activated`, `triggered`) and its own section said so out loud: the
 * radiating-permission families "read `this.card(holder.card)` in six
 * `anchored()` walks of their own and no card in the pool needs them copied
 * today". They do now. R127 adds the `behavior` facet — `costMods`,
 * `effectAttrs`, `amountMods`, `modPermissions`, `playPermissions`,
 * `mustBeTargeted` and the seven `replace*` hooks — and every one of those
 * walks reads it off `E.facesWith` instead.
 *
 * ONE thing stays behind, and it is the whole of the stated exclusion:
 * ATTRIBUTES. `attrs` is still a facet of its own, still carried by an
 * identity copy (Borrower of Forms takes the Whale's {Piercing}) and still
 * absent from Ancient One's `projects` declaration.
 *
 * "So only during combat" needs no gate of its own: `E.adjacentInFormation`
 * opens with `if (!this.s.battle) return []`, so adjacency — and with it every
 * projected face — exists only inside a battle. The last assertion of each
 * test below is the same board with the column BROKEN, which is that fact
 * measured from the other side.
 *
 * Seeds 12700-12799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, ownAttrs, spawn, toDeployment, toNextBattle } from './util.ts';

/**
 * One attacking formation of three single-unit columns, with the Ancient One
 * either NEXT TO the donor or two columns away from it.
 *
 * Columns are the adjacency geometry (`E.adjacentInFormation`: the vertical
 * partner, plus the same row of the columns either side), so `[donor],
 * [ancient], [filler]` are neighbours and `[donor], [filler], [ancient]` are
 * not. Single-unit columns deliberately: a SHARED column would also share
 * attributes (R4's column rule), which is the one thing R127 must not be
 * confused with.
 *
 * The Ancient One is spawned FIRST so it holds the lower entity id — the
 * replacement hooks resolve ties by id, and `replaceCounters` below reads that
 * ordering.
 */
function board(seed: number, donor: string, adjacent: boolean): {
  h: Harness; A: Seat; ancient: EntityId; donor: EntityId; filler: EntityId; region: number;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const ancient = spawn(h, A, 'Ancient One');       // 1/1, no text of its own
  const dn = spawn(h, A, donor);
  const filler = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({
    type: 'declareAttack', seat: A,
    columns: adjacent ? [[dn], [ancient], [filler]] : [[dn], [filler], [ancient]],
  });
  return { h, A, ancient, donor: dn, filler, region: ent(h, ancient)!.region };
}

// ── channel 1: costMods (Tranquility) ────────────────────────────────────

test('R127: an adjacent Tranquility\'s COST MODIFIER radiates from the Ancient One too', () => {
  // "[Augment] Spells cost [one] more to play during battle." A CostMod SUMS
  // (R59), so a second radiator is directly visible in the price.
  const near = board(12701, 'Tranquility', true);
  const far = board(12702, 'Tranquility', false);
  const base = new E(new Harness(12703).state).manaToPlay(0, 'Foretell');

  assert.equal(new E(far.h.state).manaToPlay(far.A, 'Foretell', { region: far.region }),
    base + 1, 'two columns away the Ancient One borrows nothing — only Tranquility taxes');
  assert.equal(new E(near.h.state).manaToPlay(near.A, 'Foretell', { region: near.region }),
    base + 2, 'adjacent, the Ancient One radiates the same clause: two taxes, not one');

  // "so only during combat": the projection is continuous, so it is gone the
  // instant the neighbour leaves the column
  const g = new E(near.h.state);
  g.destroy(g.entity(near.donor)!, 'dies');
  near.h.state = g.s;
  assert.equal(new E(near.h.state).manaToPlay(near.A, 'Foretell', { region: near.region }),
    base, 'Tranquility gone, the borrowed clause with it');
});

// ── channel 2: amountMods (Flux Resonator) ───────────────────────────────

test('R127: an adjacent Flux Resonator\'s AMOUNT MODIFIER radiates from the Ancient One too', () => {
  // "[Augment] Counters placed on your units by an allied source are increased
  // by one." AmountMods SUM (R104: "a replacement only happens once … the
  // replacement just takes what would be 1 and makes it 2"), so two radiators
  // turn one counter into three.
  const near = board(12711, 'Flux Resonator', true);
  const far = board(12712, 'Flux Resonator', false);

  for (const b of [far, near]) {
    const g = new E(b.h.state);
    // R130 (landed the same day, from another branch): the placement names
    // its ACTOR, because Flux Resonator's printed "by an allied source" is a
    // real gate now rather than an approximation. An unattributed white-box
    // call is deliberately NOT "allied" — "nobody in particular put this" is
    // not "you did" — so this test has to say who, exactly as R130's own
    // updates to 87-replacement-layer / 27-metal-b / 29-hybrids-wm-a do.
    g.addCounters(g.entity(b.filler)!, 1, b.A);
    b.h.state = g.s;
  }
  assert.equal(ent(far.h, far.filler)!.counters, 2,
    'two columns away: the Resonator\'s own +1 and nothing else');
  assert.equal(ent(near.h, near.filler)!.counters, 3,
    'adjacent: the Ancient One radiates the same modifier, and they sum');
});

// ── channel 3: mustBeTargeted (Gatekeeper of Souls) ──────────────────────

test('R127: an adjacent Gatekeeper of Souls makes the ANCIENT ONE must-be-targeted', () => {
  // "[Augment] When a player selects targets for an effect during battle, I
  // must be targeted if able." The compulsion is anchored on the radiator, so
  // borrowing it puts the ANCIENT ONE on the must-target list — the clearest
  // case of "right in its text box": "I" is the mimic.
  const near = board(12721, 'Gatekeeper of Souls', true);
  const far = board(12722, 'Gatekeeper of Souls', false);

  const farSet = new E(far.h.state).mustBeTargetedIn(far.region);
  assert.ok(farSet.has(far.donor) && !farSet.has(far.ancient),
    'two columns away only the Gatekeeper itself must be targeted');
  const nearSet = new E(near.h.state).mustBeTargetedIn(near.region);
  assert.ok(nearSet.has(near.donor) && nearSet.has(near.ancient),
    'adjacent, the Ancient One must be targeted too — the clause reads "I"');

  // combat-scoped by construction: no battle, no formation, no adjacency
  const g = new E(near.h.state);
  g.destroy(g.entity(near.donor)!, 'dies');
  near.h.state = g.s;
  assert.ok(!new E(near.h.state).mustBeTargetedIn(near.region).has(near.ancient),
    'the Gatekeeper left the column and the borrowed compulsion went with it');
});

// ── channel 4: a replace* hook (Counter Theif) ───────────────────────────

test('R127: an adjacent Counter Theif\'s REPLACEMENT HOOK radiates from the Ancient One too', () => {
  // "[Augment] If one or more counters would be placed on one or more units
  // during battle, those counters are placed on me instead." A replacement is
  // consumed by the FIRST holder in entity-id order, and `board()` spawns the
  // Ancient One first — so when it is adjacent, the mimic claims the counters
  // and the Thief never sees them.
  const near = board(12731, 'Counter Theif', true);
  const far = board(12732, 'Counter Theif', false);

  for (const b of [far, near]) {
    const g = new E(b.h.state);
    g.addCounters(g.entity(b.filler)!, 1);
    b.h.state = g.s;
  }
  assert.equal(ent(far.h, far.filler)!.counters, 0, 'the Thief steals them either way');
  assert.equal(ent(far.h, far.donor)!.counters, 1,
    'two columns away, they land on the Thief — the Ancient One has no such hook');
  assert.equal(ent(far.h, far.ancient)!.counters, 0, 'and not on the Ancient One');

  assert.equal(ent(near.h, near.filler)!.counters, 0, 'still stolen');
  assert.equal(ent(near.h, near.ancient)!.counters, 1,
    'adjacent, the Ancient One holds the same clause and (lower id) claims them first');
  assert.equal(ent(near.h, near.donor)!.counters, 0,
    'a replacement is consumed once — the Thief gets nothing');
});

// ── the stated exclusion: ATTRIBUTES ─────────────────────────────────────

test('R127: attributes are the ONE thing an adjacent ally does not donate', () => {
  // The owner: "the only thing it doesn't are attributes (like Piercing or
  // Unstable)". Good Whale prints {Piercing} and nothing this seam carries;
  // Tranquility prints a behaviour channel and no attribute. Both are adjacent
  // to the same Ancient One, so this is the whole ruling on one board: the
  // text box crosses, the type line does not.
  const h = new Harness(12741);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const ancient = spawn(h, A, 'Ancient One');
  const whale = spawn(h, A, 'Good Whale');            // 7/5 {Piercing}
  const tranq = spawn(h, A, 'Tranquility');           // "[Augment] spells cost [1] more"
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  // one unit per column: a SHARED column shares attributes (R4), which would
  // hide the very thing this test is about
  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [ancient], [tranq]] });

  const e = new E(h.state);
  const region = ent(h, ancient)!.region;
  assert.ok(e.adjacentInFormation(ancient).map(u => u.id).includes(whale),
    'the Whale really is adjacent — otherwise this test proves nothing');

  // the behaviour half DOES cross, on this very board
  const base = new E(new Harness(12742).state).manaToPlay(0, 'Foretell');
  assert.equal(e.manaToPlay(A, 'Foretell', { region }), base + 2,
    'Tranquility\'s clause crosses: its own tax plus the Ancient One\'s copy');

  // and the attribute half does NOT
  assert.deepEqual(e.facesWith(ent(h, ancient)!, 'attrs'), ['Ancient One'],
    'no projected face contributes `attrs` — the facet the projection refuses');
  assert.ok(!ownAttrs(h, ancient).has('Piercing'),
    '{Piercing} is an ATTRIBUTE: the one thing the whole text box does not include');
  assert.ok(ownAttrs(h, whale).has('Piercing'), 'the Whale of course keeps it');
  assert.ok(!e.isUnstable(ent(h, ancient)!),
    'and the same exclusion covers {Unstable}, which the owner named beside it');

  // the ability facets are unaffected by any of this
  assert.equal(e.nameOf(ent(h, ancient)!), 'Ancient One', 'still itself (R118)');
  assert.deepEqual(e.effStats(ent(h, ancient)!), [1, 1], 'and still a 1/1');
});
