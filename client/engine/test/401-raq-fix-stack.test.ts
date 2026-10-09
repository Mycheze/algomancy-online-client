/**
 * RAQ fix round F3 — the stack, targets and last-known state, built from the
 * threads the RAQ audit found broken (ledgers/raq.ts, CT-207/208/209/224).
 * The RAQ is the authority (owner, 2026-10-09): where a thread and one of our
 * own rulings disagreed, the ruling was reversed (R225, R157 §20).
 *
 * The thread-by-thread reproductions live in 390-raq-stack.test.ts; this file
 * holds the whole-pool sweeps and the pieces 390 does not reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { effStats, ent, finishBattle, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;
const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const;

/** every spell whose target spec needs two or more DISTINCT targets at cast —
 * derived from the registry, so a new card of that shape is in the sweep */
function multiTargetSpells(): string[] {
  return allCardNames().filter(n => {
    const t = getCard(n).spellEffect?.targets;
    if (!t) return false;
    const extra = t.extraSlots ?? 0;
    const max = t.count === 'X' ? extra + 1 : (t.count ?? 1) + extra;
    return Math.min(t.min ?? 1, max) >= 2;
  });
}

test('R323 sweep: no spell that needs two distinct targets is offered when the region holds one unit', () => {
  // RAQ "[Solved] Target requirements to put effect on stack.": _passer, "You
  // cannot play Fight if there isn't 2 units in the region"; Caleb on Tidal
  // Reversion, "You can't play it if one player doesn't have a valid target".
  const pool = multiTargetSpells();
  assert.ok(pool.includes('Fight') && pool.includes('Tidal Reversion'), 'the sweep reaches the two cards in the thread');
  assert.ok(pool.length >= 8, `the derived pool is not empty or shrunk (${pool.length})`);
  const offered: string[] = [];
  for (const name of pool) {
    const battle = getCard(name).timing === 'battle';
    const h = new Harness(4010);
    toDeployment(h);
    const A = battle ? h.state.initiative : h.state.deployPlayer!;
    const lone = spawn(h, A, 'Good Whale');
    for (const el of ELEMENTS) giveResources(h, A, el, 9);
    for (const p of h.state.players) p.bin = [];
    if (battle) {
      toNextBattle(h, A);
      h.do({ type: 'declareAttack', seat: A, columns: [[lone]] });
      while (h.state.priority !== A && !h.state.decision) h.do({ type: 'passPriority', seat: other(A) });
    }
    h.state.players[A]!.hand.push(name);
    const i = h.state.players[A]!.hand.length - 1;
    if (legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === i)) offered.push(name);
  }
  assert.deepEqual(offered, [], 'offered with only one unit in the region — a required slot cannot be filled');
});

// ── R325 (CT-209): last-known state — "[Solved] Dead Unit Effect on Stack" ──

/** A attacks with `cols`, D declines to block, and combat runs: the after-combat
 * triggers are on the stack (R261) when this returns */
function toAfterCombat(h: Harness, A: Seat, cols: EntityId[][]): void {
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: other(A), blocks: {} });
  pass(h); pass(h);
}

const kill = (h: Harness, id: EntityId): void => {
  new E(h.state).destroy(ent(h, id)!, 'dies');
  assert.equal(ent(h, id), undefined, 'the source really is gone');
};

const onStack = (h: Harness, card: string): boolean => h.state.stack.some(i => i.card === card);

test('R325 Embermaw Fledgling gone before its after-combat trigger resolves still counts the attackers it stood with', () => {
  // _passer names Embermaw Fledgling among the effects that "remember they were
  // in formation and will work fine"
  const h = new Harness(4020);
  toDeployment(h);
  const A = h.state.initiative;
  const fl = spawn(h, A, 'Embermaw Fledgling');
  const a = spawn(h, A, 'Good Whale');
  const b = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  toAfterCombat(h, A, [[fl], [a], [b]]);
  assert.ok(onStack(h, 'Embermaw Fledgling'), 'the trigger is waiting');
  kill(h, fl);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token');
  assert.equal(unitsOf(h, A).length, before + 1, 'an X/X was made');
  assert.deepEqual(effStats(h, made[0]!.id), [2, 2], 'X = the two attackers left in its formation');
  finishBattle(h);
});

test('R325 Deathglow Strider gone before its after-combat trigger resolves deals its last-known defense', () => {
  const h = new Harness(4021);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const st = spawn(h, A, 'Deathglow Strider');               // 2/3
  toNextBattle(h, A);
  toAfterCombat(h, A, [[st]]);
  assert.ok(onStack(h, 'Deathglow Strider'));
  kill(h, st);
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, life - 3, 'the opponent takes 3 — the defense it had as it left');
  finishBattle(h);
});

test('R325 Spewing Mushroom gone before its attack trigger resolves still makes a Poison of its last-known power', () => {
  const h = new Harness(4022);
  toDeployment(h);
  const A = h.state.initiative;
  const sm = spawn(h, A, 'Spewing Mushroom');               // 1/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sm]] });
  assert.ok(onStack(h, 'Spewing Mushroom'));
  kill(h, sm);
  pass(h); pass(h);
  const poison = Object.values(h.state.entities).filter(u => u.card === 'Poison' && u.controller === A);
  assert.equal(poison.length, 1, 'a Poison was made');
  assert.equal(poison[0]!.x, 1, 'Poison 1: the power it had');
  finishBattle(h);
});

test('R325 Echo of Despair gone before its after-combat trigger resolves still makes its copy', () => {
  const h = new Harness(4023);
  toDeployment(h);
  const A = h.state.initiative;
  const echo = spawn(h, A, 'Echo of Despair');               // 3/2, unblocked: a player lost life
  toNextBattle(h, A);
  toAfterCombat(h, A, [[echo]]);
  assert.ok(onStack(h, 'Echo of Despair'));
  kill(h, echo);
  pass(h); pass(h);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair' && u.token), 'the copy was made');
  finishBattle(h);
});

test('R325 Lumengrove Lurker gone before its trigger resolves counts the formation it remembers', () => {
  // _passer names Lumengrove Lurker too. Its target was chosen against a
  // formation of 3 (it and two Whales); gone, it counts the two Whales left — a
  // cost-2 target is still within reach, and R324 re-checks the restriction
  // against that remembered formation at resolution.
  const h = new Harness(4024);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const lurker = spawn(h, A, 'Lumengrove Lurker');
  const w1 = spawn(h, A, 'Good Whale');
  const w2 = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  const prey = spawn(h, D, 'Spewing Mushroom');            // cost 2, in the battle region
  toAfterCombat(h, A, [[lurker], [w1], [w2]]);
  if (h.state.decision) pick(h, { unit: prey });
  assert.ok(onStack(h, 'Lumengrove Lurker'));
  kill(h, lurker);
  pass(h); pass(h);
  assert.equal(ent(h, prey), undefined, 'the Mushroom was recalled');
  assert.ok(h.state.players[D]!.hand.includes('Spewing Mushroom'), 'to its owner\'s hand');
  finishBattle(h);
});
