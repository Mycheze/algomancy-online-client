/* R293 / playtest report #167 — FORMLESS REMOVES ATTRIBUTES FROM THE COLUMN,
 * not from the target alone.
 *
 * The card, in full: *"When I attack or block, [Switch] Target unit becomes a
 * base 4/4 and loses all attributes until regroup. {i}(This removes attributes
 * from its column.){/i}"*
 *
 * REPORT #167, room BTUX, 2026-09-15, filed by the owner (judge L1) at action
 * [221]: *"Formless didn't properly remove attributes from the column"*.
 *
 * The replay is unambiguous. Formless blocked and targeted Refuse Reclaimer,
 * whose column-mate Flzzz prints {Blessed}. The engine suppressed the TARGET's
 * attribute layer and stopped — so the column was still Blessed, dealt 17, and
 * gained its controller 17 life through the attribute Formless had just been
 * played to turn off. Gember lost the game to the Flzzz drain that followed.
 *
 * ── WHAT THE OLD COMMENT GOT HALF-RIGHT ──────────────────────────────
 * batch-metal-b argued that suppressing the target alone satisfied the
 * parenthesis, "because switching the target's attribute layer off removes
 * what it was SHARING into its column, which E.colAttrs gets for free by
 * unioning ownAttrs". True, and half the job: it removes what the target
 * shared IN, and leaves every attribute its column-mates were sharing in
 * exactly where it was.
 *
 * ── WHAT KIND OF EFFECT THE STAMP IS ─────────────────────────────────
 * The owner, 2026-09-16, asked whether a unit joining the column afterwards
 * should be caught by it:
 *
 *   > "Formless's targeting, and all 'turning off attributes' applies as a
 *   > static effect on units that have 'had their attributes removed'. Think
 *   > about the logic. If you remove the attributes from a guy for the turn, it
 *   > wouldn't make sense for it to get them back."
 *
 * So the stamp is PER UNIT and is that unit's own state until regroup. It does
 * not track column membership: a stamped unit that LEAVES the column does not
 * get its attributes back (§3), and a unit that JOINS afterwards was never
 * stamped (§4).
 *
 * Seeds 29900-29999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, finishBattle, pass, pick, spawn, throughDamageWindows,
  toDeployment, toNextBattle,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** BTUX's shape: A attacks with a column of two — a plain unit in front and a
 *  {Blessed} Flzzz behind — and D blocks it with Formless, whose trigger then
 *  targets the front unit. Stops with the trigger's target decision answered. */
function btux(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Lithoghul');               // 4/4, no attributes of its own
  const mate = spawn(h, A, 'Flzzz');                    // {Blessed}
  const formless = spawn(h, D, 'Formless');             // {Flying} 2/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, mate]] });
  pass(h); pass(h);
  const g0 = new E(h.state);
  assert.ok(g0.colAttrs(g0.columnOf(front)!).has('Blessed'),
    'CONTROL: before Formless, the attacking column really is Blessed');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [formless] } });
  pick(h, { unit: front });                             // Formless targets the front unit
  pass(h); pass(h);                                     // resolve the trigger
  return { h, A, D, front, mate, formless };
}

/* ══ §1 — THE REPORT ═════════════════════════════════════════════════ */

test('R293 §1 the report: Formless takes {Blessed} off the whole column, not just its target', () => {
  const { h, front, mate } = btux(29901);
  const g = new E(h.state);
  assert.ok(!g.ownAttrs(g.entity(front)!).size, 'the target lost its own layer (this always worked)');
  assert.ok(!g.ownAttrs(g.entity(mate)!).has('Blessed'),
    'THE REPORT: the column-MATE lost {Blessed} too — it was stamped as well');
  assert.ok(!g.colAttrs(g.columnOf(front)!).has('Blessed'),
    'so the column is not Blessed any more, which is what the printed reminder promises');
});

test('R293 §1b and therefore nobody gains life when the column connects', () => {
  // ⚠ THIS ASSERTION WAS VACUOUS ONCE, and the mutation found it. `btux()`
  // stops with the Formless trigger resolved and the block window reopened —
  // no combat damage has happened yet. Reading the life total there compares
  // two numbers that are equal because NOTHING has occurred, and it stayed
  // green with the fix reverted. The two passes below are what make it a
  // measurement.
  const { h, A } = btux(29902);
  const life0 = h.state.players[A]!.life;
  pass(h); pass(h);                                     // out of the block window → damage
  throughDamageWindows(h);
  assert.ok(h.events.some(e => e.type === 'combatDamage'),
    'combat damage really happened — the control for the control');
  assert.equal(h.state.players[A]!.life, life0,
    'BTUX gained 17 life here; a column whose {Blessed} has been turned off gains none');
  finishBattle(h);
});

test('R293 §1c the control: without Formless the same column DOES gain', () => {
  const h = new Harness(29903);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Lithoghul');
  const mate = spawn(h, A, 'Flzzz');
  const wall = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  const life0 = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[front, mate]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  pass(h); pass(h);
  throughDamageWindows(h);
  assert.ok(h.state.players[A]!.life > life0,
    'a live {Blessed} column gains its controller life — §1b is not passing on a board that '
    + 'never gains anything');
  finishBattle(h);
});

/* ══ §2 — ONLY THE ATTRIBUTE HALF IS COLUMN-WIDE ════════════════════ */

test('R293 §2 the base rewrite still hits the TARGET alone', () => {
  const { h, front, mate } = btux(29904);
  assert.deepEqual(effStats(h, front), [4, 4], 'the target became a base 4/4');
  assert.deepEqual(effStats(h, mate), [1, 3],
    "the column-mate keeps its printed 1/3 — \"target unit becomes a base 4/4\" is singular, "
    + 'and only the parenthesis is about the column');
});

test('R293 §2b abilities are untouched, on both of them (R62)', () => {
  const { h, front, mate } = btux(29905);
  const g = new E(h.state);
  assert.equal(g.entity(front)!.suppressed?.abilities, undefined,
    'Formless removes ATTRIBUTES; R62 keeps the ability layer separate');
  assert.equal(g.entity(mate)!.suppressed?.abilities, undefined, 'and the same for the mate');
  assert.equal(g.entity(mate)!.suppressed?.attrs, 'Formless',
    'what the mate carries is the attribute stamp, named for what stamped it');
});

/* ══ §3 — THE STAMP IS THE UNIT'S OWN STATE ═════════════════════════ */

test('R293 §3 the stamp outlives the column, and expires exactly where the card says: regroup', () => {
  // "If you remove the attributes from a guy for the turn, it wouldn't make
  // sense for it to get them back." The stamp is the UNIT's state, not the
  // column's — so it survives the column, and the only thing that clears it is
  // the duration the card prints.
  const { h, mate } = btux(29906);
  throughDamageWindows(h);
  const mid = new E(h.state);
  const alive = mid.entity(mate);
  assert.ok(alive, 'the mate survived combat — this test has a subject');
  assert.equal(alive.suppressed?.attrs, 'Formless', 'still stamped once the damage step is over');
  assert.ok(!mid.ownAttrs(alive).has('Blessed'), 'so it still has no {Blessed} inside the battle');

  finishBattle(h);
  const after = new E(h.state);
  const then = after.entity(mate);
  if (then) {
    assert.equal(then.suppressed?.attrs, undefined,
      '"until regroup" is the printed duration, and regroup is where it ends — for the '
      + 'column-mate exactly as for the target');
  }
});

/* ══ §4 — AND A LATER ARRIVAL WAS NEVER STAMPED ═════════════════════ */

test('R293 §4 a unit that joins the column afterwards keeps its own attributes', () => {
  // The stamp is applied at RESOLUTION, to the units standing there. It is not
  // a continuous column effect, because nothing in the engine models one and
  // the printed text is a one-shot event ("When I attack or block…").
  const { h, A, front } = btux(29907);
  const g = new E(h.state);
  const late = g.spawnUnit(A, 'Flzzz', g.s.battle!.region, {});
  h.state = g.s;
  const g2 = new E(h.state);
  assert.ok(g2.ownAttrs(g2.entity(late.id)!).has('Blessed'),
    'a Flzzz that was not on the board when Formless resolved is Blessed like any other');
  assert.equal(g2.entity(late.id)!.suppressed?.attrs, undefined, 'it carries no stamp');
  assert.ok(!g2.ownAttrs(g2.entity(front)!).size, 'while the ones that WERE there still do');
});

/* ══ §5 — NO COLUMN IS A COLUMN OF ONE ══════════════════════════════ */

test('R293 §5 a target with no column (or no battle) is stamped alone, and nothing throws', () => {
  const h = new Harness(29908);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const lone = spawn(h, D, 'Flzzz');
  const g = new E(h.state);
  assert.equal(g.columnOf(lone), null, 'outside battle there are no columns at all');
  g.setBase(g.entity(lone)!, 4, 4);
  g.suppress(g.entity(lone)!, 'Formless', { attrs: true });
  h.state = g.s;
  const g2 = new E(h.state);
  assert.ok(!g2.ownAttrs(g2.entity(lone)!).has('Blessed'), 'the lone target is stamped');
  assert.deepEqual(effStats(h, lone), [4, 4], 'and rewritten');
  void A;
});
