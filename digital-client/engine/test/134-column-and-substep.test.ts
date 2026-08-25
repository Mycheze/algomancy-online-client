/* R157 §4, §5 and §11 — the column power gate, the {Swift}{Sluggish} trigger
 * gate, and {Deadly}'s (absent) damage cap.
 *
 * §4, verbatim (Bena, 2026-08-25): "Only if the other unit in the column has a
 * positive power. 0 power units do no damage. But the other thing in the
 * column can still contribute to the shared column power."
 *   → the gate on "when my column deals combat damage" is the LIVE COLUMN's
 *     total power, never the anchor's own. Four cards print the clause and
 *     carried four readings of it: Zephyrzoa and Vroot summed the column
 *     (right), Blightmound read `effStats(self)[0]` (the anchor alone), and
 *     Eldritch Dreamtender had no power gate at all. All four now go through
 *     the one engine predicate, `E.columnDealtCombatDamage`, whose CHANNEL
 *     parameter carries the one thing that legitimately differs between them:
 *     which events each printed text is entitled to hear.
 *
 * §5, verbatim: "Both apply. It's Algomancy's answer to double strike. A
 * Swift+Sluggish unit that's in combat with a normal unit will (potentially,
 * assuming they all survive all damage) end up having damage done in all three
 * sub damage steps."
 *   → the DAMAGE was already right (`E.scheduled` says true for both
 *     sub-steps). The TRIGGER gate was not: `combatSubStepOf` returned only
 *     the first match, so a Rime Wraith column's triggers fired once while its
 *     damage landed twice. `strikesInCurrentSubStep` now reads the full list,
 *     `E.combatSubStepsOf`.
 *
 * §11, verbatim: "Deadly doesn't have a cap?? A 10/10 deadly unit still deals
 * 10 damage to something, the only difference is that any amount of damage is
 * enough to kill a unit."
 *   → the engine was ALREADY RIGHT and nothing was changed for it. {Deadly}'s
 *     1 is a FLOOR on the pass-along SHARE (`victimShare` / `poolToKill`),
 *     never a ceiling on what is dealt; R114's leftover puts the whole rest
 *     back on the back-most living unit. These two tests pin that so nobody
 *     "fixes" the floor into a cap.
 *
 * Seeds 5340-5359.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** answer whatever the combat pump raised (an elective split, a trigger
 * ordering, Eldritch Dreamtender's discard pick) and pass the afterWindow
 * until the stack the damage steps queued has fully resolved */
function settleCombat(h: Harness): void {
  let guard = 60;
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

/** shrink `id` to 0 power, keeping its toughness — the R157 §4 anchor */
function toZeroPower(h: Harness, id: EntityId): void {
  const e = new E(h.state);
  const u = ent(h, id)!;
  e.setBase(u, 0, e.effStats(u)[1]);
  assert.equal(e.effStats(u)[0], 0, 'the anchor really is 0 power');
}

/**
 * Both R157 §4 boards, run to the end of the damage steps.
 *
 * `together`: the 0-power anchor shares a column with a 1-power ally, so the
 * COLUMN has power and the column deals combat damage — the trigger MUST fire.
 * `apart`:    the anchor stands alone in a 0-power column while a SECOND
 * column of the same player connects for 1. Both columns are normal, so both
 * strike in the same sub-step and R117's gate lets the anchor through; the
 * aggregated per-seat `lifeLost` is the ONLY thing it can be hearing, and the
 * power gate is the only thing that stops it. That is the whole point of
 * running the negative this way rather than with a silent 0-power board: a
 * board with no damage at all would pass with no gate whatsoever.
 */
function attackWith(h: Harness, A: Seat, D: Seat, anchor: EntityId, ally: EntityId,
  shape: 'together' | 'apart'): void {
  toZeroPower(h, anchor);
  h.do({
    type: 'declareAttack', seat: A,
    columns: shape === 'together' ? [[anchor, ally]] : [[anchor], [ally]],
  });
  assert.equal(h.q.combatSubStepOf(ent(h, anchor)!), 'normal',
    'nothing here is Swift or Sluggish — R117 is satisfied either way');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);
}

/* ── R157 §4: Zephyrzoa (face channel) ─────────────────────────────────── */

test('R157 §4 — Zephyrzoa: a 0-power anchor in a POWERED column still fires', () => {
  const h = new Harness(5340);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const zep = spawn(h, A, 'Zephyrzoa');                      // 1/1, own [Augment] live
  const ally = spawn(h, A, 'Unit Token');                    // 1/1
  toNextBattle(h, A);
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin', 'Shib');
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, zep, ally, 'together');

  assert.equal(h.state.players[D]!.life, life0 - 1, 'the ally alone carries the column');
  assert.equal(ent(h, zep), undefined, 'the column dealt damage, so Zephyrzoa erased itself');
  assert.deepEqual(h.state.players[A]!.hand.slice().sort(), ['Gublin', 'Shib'],
    'and recalled the whole bin');
  finishBattle(h);
});

test('R157 §4 — Zephyrzoa: alone in a 0-POWER column it hears nothing', () => {
  const h = new Harness(5341);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const zep = spawn(h, A, 'Zephyrzoa');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin');
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, zep, ally, 'apart');

  assert.equal(h.state.players[D]!.life, life0 - 1, 'the OTHER column connected for 1');
  assert.ok(ent(h, zep), 'but my column has no power, so it dealt nothing and I did not fire');
  assert.deepEqual(h.state.players[A]!.bin, ['Gublin'], 'the bin was never recalled');
  finishBattle(h);
});

/* ── R157 §4: Vroot (units + face channels) ────────────────────────────── */

test('R157 §4 — Vroot: a 0-power anchor in a POWERED column still pays out', () => {
  const h = new Harness(5342);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const v = spawn(h, A, 'Vroot');                            // 4/4, own [Augment] live
  const ally = spawn(h, A, 'Unit Token');                    // 1/1
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, v, ally, 'together');

  // 1 dealt by the ally, 1 handed straight back by Vroot's column trigger
  assert.equal(h.state.players[D]!.life, life0, 'lost 1, gained 1 — the trigger fired');
  assert.ok(h.log.some(l => l.includes('Vroot')), 'and the gain is attributed to Vroot');
  finishBattle(h);
});

test('R157 §4 — Vroot: alone in a 0-POWER column it pays out nothing', () => {
  const h = new Harness(5343);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const v = spawn(h, A, 'Vroot');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, v, ally, 'apart');

  assert.equal(h.state.players[D]!.life, life0 - 1,
    "the other column's 1 sticks — Vroot's own column dealt nothing");
  finishBattle(h);
});

/* ── R157 §4: Eldritch Dreamtender (face channel; had NO power gate) ────── */

test('R157 §4 — Eldritch Dreamtender: a 0-power anchor in a POWERED column still fires', () => {
  const h = new Harness(5344);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dt = spawn(h, A, 'Eldritch Dreamtender');            // 1/1, own [Augment] live
  const ally = spawn(h, A, 'Unit Token');                    // 1/1
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, dt, ally, 'together');

  assert.equal(h.state.players[D]!.life, life0 - 1);
  assert.equal(ent(h, dt), undefined, 'R73: the sacrifice is a cast cost, paid on the way to the stack');
  assert.ok(h.state.players[A]!.bin.includes('Eldritch Dreamtender'));
  finishBattle(h);
});

test('R157 §4 — Eldritch Dreamtender: alone in a 0-POWER column it survives', () => {
  const h = new Harness(5345);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dt = spawn(h, A, 'Eldritch Dreamtender');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, dt, ally, 'apart');

  assert.equal(h.state.players[D]!.life, life0 - 1, 'the other column connected');
  assert.ok(ent(h, dt), 'this copy had NO power gate at all — it used to sacrifice itself here');
  assert.ok(!h.state.players[A]!.bin.includes('Eldritch Dreamtender'));
  finishBattle(h);
});

/* ── R157 §4: Blightmound (all three channels; read its OWN power) ──────── */

test('R157 §4 — Blightmound: a 0-power anchor in a POWERED column still rots', () => {
  const h = new Harness(5346);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const bm = spawn(h, A, 'Blightmound');                     // 4/3 {Poisonous}
  const ally = spawn(h, A, 'Unit Token');                    // 1/1
  toNextBattle(h, A);
  const rot0 = h.q.rot(D);

  attackWith(h, A, D, bm, ally, 'together');

  // THE FIX: this card gated on `effStats(self)[0] <= 0` — its OWN power — so
  // a 0-power Blightmound in a column that plainly deals combat damage stayed
  // silent. R157 §4: "the other thing in the column can still contribute to
  // the shared column power."
  assert.equal(h.q.rot(D), rot0 + 1, 'the COLUMN dealt combat damage, so the rot lands');
  finishBattle(h);
});

test('R157 §4 — Blightmound: alone in a 0-POWER column it rots nobody', () => {
  const h = new Harness(5347);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const bm = spawn(h, A, 'Blightmound');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const rot0 = h.q.rot(D);
  const life0 = h.state.players[D]!.life;

  attackWith(h, A, D, bm, ally, 'apart');

  assert.equal(h.state.players[D]!.life, life0 - 1, 'the other column connected');
  assert.equal(h.q.rot(D), rot0, 'my own column has no power, so I dealt nothing');
  finishBattle(h);
});

/* ── R157 §5: a {Swift}{Sluggish} column triggers in BOTH sub-steps ─────── */

test('R157 §5 — a {Swift}{Sluggish} column strikes twice, and its triggers fire twice', () => {
  const h = new Harness(5348);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const rw = spawn(h, A, 'Rime Wraith');                     // 2/1 {Swift}{Sluggish}
  const v = spawn(h, A, 'Vroot');                            // 4/4, "my column deals combat damage"
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;

  // {Swift} and {Sluggish} are both shared vertically down the column
  // (E.colAttrs), so the whole column carries the pair.
  h.do({ type: 'declareAttack', seat: A, columns: [[rw, v]] });
  assert.deepEqual(h.q.combatSubStepsOf(ent(h, v)!), ['Swift', 'Sluggish'],
    'R157 §5: "both apply" — the column is scheduled in TWO sub-steps');
  assert.equal(h.q.combatSubStepOf(ent(h, v)!), 'Swift',
    'the singular form is documented-lossy and still answers the first');

  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settleCombat(h);

  // THE REGRESSION THIS PINS: the damage was always right — 6 in the Swift
  // sub-step and 6 in the Sluggish one, 12 in all — but `combatSubStepOf`
  // stopped at the first match, so `strikesInCurrentSubStep` was true only in
  // the Swift one and Vroot handed back 6 of the 12. Net -6 instead of 0.
  assert.equal(h.state.players[D]!.life, life0,
    '12 dealt across two sub-steps, 12 given back across two triggers');
  assert.equal(h.log.filter(l => l.includes('gains 6 life')).length, 2,
    'two payouts, one per sub-step the column really struck in');
  finishBattle(h);
});

/* ── R157 §11: {Deadly} changes lethality, not amount ───────────────────── */

test('R157 §11 — a 10-power {Deadly} column deals all 10 to a 1/1 blocker', () => {
  const h = new Harness(5349);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dev = spawn(h, A, 'Carapace Devourer');              // 3/3 {Deadly}
  const blk = spawn(h, D, 'Unit Token');                     // 1/1
  toNextBattle(h, A);
  new E(h.state).setBase(ent(h, dev)!, 10, 10);              // the ruling's 10/10
  const life0 = h.state.players[D]!.life;

  h.do({ type: 'declareAttack', seat: A, columns: [[dev]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  settleCombat(h);

  // "A 10/10 deadly unit still deals 10 damage to something." {Deadly}'s 1 is
  // a floor on the pass-along SHARE, and R114 lands the whole leftover back on
  // the back-most living unit — so nothing is lost and nothing is capped.
  assert.ok(h.log.some(l => l.includes('Unit Token takes 10')),
    `all 10 landed; log was ${JSON.stringify(h.log.filter(l => l.includes('takes')))}`);
  assert.equal(ent(h, blk), undefined, 'and any amount from a Deadly source is lethal (R21)');
  assert.equal(h.state.players[D]!.life, life0,
    'a blocked, non-Piercing column spills nothing to the face');
  finishBattle(h);
});

test('R157 §11 — {Deadly} + {Piercing}: 1 kills the blocker and the other 9 pierce', () => {
  const h = new Harness(5350);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dev = spawn(h, A, 'Carapace Devourer');              // 3/3 {Deadly}
  const crab = spawn(h, A, 'Bumblecrab');                    // 2/3 {Piercing}
  const blk = spawn(h, D, 'Unit Token');                     // 1/1
  toNextBattle(h, A);
  const e = new E(h.state);
  e.setBase(ent(h, dev)!, 10, 10);
  e.setBase(ent(h, crab)!, 0, 3);                            // the column's power is the Devourer's
  const life0 = h.state.players[D]!.life;

  // both attributes are shared down the column (E.colAttrs)
  h.do({ type: 'declareAttack', seat: A, columns: [[dev, crab]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  settleCombat(h);

  // RAQ "[Solved] Oorblak vs Piercing", and R157 §11 for the amount: the
  // source's whole 10 is dealt — 1 spent on the {Deadly} floor, 9 pierced. A
  // cap of any kind at the source would show up here as missing life loss.
  assert.equal(h.state.players[D]!.life, life0 - 9, '10 dealt: 1 to the body, 9 to the face');
  assert.equal(ent(h, blk), undefined);
  finishBattle(h);
});
