/* R80/R81 — playtest round 15 (game VEAV, 2026-08-22).
 *
 * R80: ONE EFFECT'S DAMAGE IS ONE BATCH.
 *
 *   "Channel Through caused Restitution to make 2 triggers, but it should
 *    have done just one trigger."
 *   "I only made 2 units from my Channel Through, but Channel Through dealt 6
 *    damage to my allies and 6 damage to my opponent's units, so I should
 *    have made 12 units."
 *
 * Both are the same defect: the engine had no notion of "the damage an effect
 * dealt", only a pile of independent dealEffectDamage calls, and Channel
 * Through committed its distributed damage one point at a time. A unit given
 * two of those points was dealt damage TWICE.
 *
 * R81: BURST GROUPS BY NAME.
 *
 *   "The game is trying to force me to cast my Fireball here (since it has
 *    Burst), but Burst only applies to spell tokens with the same NAME."
 *
 * Sourced: "a player must play all burst spells they control OF THE SAME TYPE
 * at the same time" (The Rules of Algomancy, spell tokens).
 *
 * Seeds: 6900-6999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';
import type { EngineEvent, EntityId } from '../src/types.ts';

/** run engine mutations white-box, then let the engine settle (queued
 * triggers resolve) — the same helper 19-hybrids uses. */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try { f(e); e.settle(); } catch (sig) { if (!(sig instanceof Suspended)) throw sig; }
  h.state = e.s;
}

/** the 'damage' events a run produced, in order */
const damageEvents = (evs: EngineEvent[]): EngineEvent[] => evs.filter(e => e.type === 'damage');
const hitsOn = (evs: EngineEvent[], id: EntityId): EngineEvent[] =>
  damageEvents(evs).filter(e => e.data?.unit === id);

// ── the batch itself ─────────────────────────────────────────────────────

test('R80: two hits on one unit in a batch are ONE damage event for the total', () => {
  const h = new Harness(6900);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawn(h, p, 'Good Whale');                  // 7/5, no triggers
  const e = new E(h.state);
  const before = e.events.length;
  const ctx = { controller: p, sourceName: 'Fireball', region: e.homeRegion(p), targets: [], event: null,
    choose: () => { throw new Error('no decision expected'); } } as never;
  e.dealEffectDamageAll(ctx, [{ target: h.state.entities[u]!, n: 1 }, { target: h.state.entities[u]!, n: 2 }]);
  const evs = e.events.slice(before);
  const hits = hitsOn(evs, u);
  assert.equal(hits.length, 1, 'one event, not two');
  assert.equal(hits[0]!.data?.n, 3, 'for the total');
  assert.equal(hits[0]!.data?.total, 3, 'and the batch total is the same 3');
  assert.equal(h.state.entities[u]!.damage, 3);
});

test('R80: every event in a batch carries the WHOLE batch as `total`', () => {
  const h = new Harness(6901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const a = spawn(h, p, 'Good Whale');
  const b = spawn(h, p, 'Good Whale');
  const e = new E(h.state);
  const before = e.events.length;
  const ctx = { controller: p, sourceName: 'Fireball', region: e.homeRegion(p), targets: [], event: null,
    choose: () => { throw new Error('no decision expected'); } } as never;
  e.dealEffectDamageAll(ctx, [
    { target: h.state.entities[a]!, n: 2 },
    { target: h.state.entities[b]!, n: 3 },
    { target: { player: p }, n: 1 },
  ]);
  const evs = damageEvents(e.events.slice(before));
  assert.equal(evs.length, 3, 'three recipients, three events');
  assert.deepEqual(evs.map(x => x.data?.n), [2, 3, 1], 'each hears its own share');
  assert.deepEqual(evs.map(x => x.data?.total), [6, 6, 6], 'and all hear the same total');
});

test('R80: a single-target deal is a batch of one — total equals n', () => {
  const h = new Harness(6902);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawn(h, p, 'Good Whale');
  const e = new E(h.state);
  const before = e.events.length;
  const ctx = { controller: p, sourceName: 'Fireball', region: e.homeRegion(p), targets: [], event: null,
    choose: () => { throw new Error('no decision expected'); } } as never;
  e.dealEffectDamage(ctx, h.state.entities[u]!, 4);
  const hits = hitsOn(e.events.slice(before), u);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.data?.n, 4);
  assert.equal(hits[0]!.data?.total, 4);
});

// ── what the table actually reported ─────────────────────────────────────

test('R80: Channel Through gives a twice-hit unit ONE damage event (the Restitution report)', () => {
  const h = new Harness(6903);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ally = spawn(h, D, 'Good Whale');               // 7/5 — takes the "2 to each ally"
  const victim = spawn(h, A, 'Awoken Tomb');            // 0/5 — the SOLE enemy unit, so both
  giveResources(h, D, 'earth', 2);                      //       distributed points land on it
  giveResources(h, D, 'fire', 2);                       // eer / X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  pass(h);                                              // priority → D
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 1);                                           // X = 1, paid at cast (R35)
  pick(h, { unit: ally });                              // the one cast-time ally target
  pass(h); pass(h);                                     // resolve (both distributed points auto-aim)
  const hits = hitsOn(h.events.slice(mark), victim);
  assert.equal(hits.length, 1, 'the sole enemy unit took both points as ONE hit');
  assert.equal(hits[0]!.data?.n, 2, 'for 2');
  assert.equal(hits[0]!.data?.total, 4, 'the whole spell dealt 4 (2 to the ally + 2 distributed)');
  finishBattle(h);
});

test('R80: Awoken Tomb reads its OWN share as X, not the batch total', () => {
  const h = new Harness(6904);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ally = spawn(h, D, 'Good Whale');
  const tomb = spawn(h, A, 'Awoken Tomb');              // "create an X/X unit, X = the damage I am dealt"
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tomb]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 1);
  pick(h, { unit: ally });
  pass(h); pass(h);                                     // Channel Through resolves
  while (h.state.stack.length) pass(h);                 // and the Tomb's trigger after it
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1, 'the Tomb made its one unit');
  assert.deepEqual(made[0]!.tokenStats, [2, 2],
    'X = the 2 the Tomb itself took, not the 4 the spell dealt in all');
  finishBattle(h);
});

test('R80: Ember of Life counts the WHOLE effect (the 12-units report)', () => {
  const h = new Harness(6905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Good Whale');
  giveResources(h, p, 'fire', 4);
  giveResources(h, p, 'wood', 4);
  // Ember of Life's text is [Augment] — worn as a mod it reads from its host
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Ember of Life'), hostId: host });
  const a = spawn(h, p, 'Good Whale');
  const b = spawn(h, p, 'Good Whale');
  const before = unitsOf(h, p).length;
  whiteBox(h, e => {
    const ctx = { controller: p, sourceName: 'Fireball', region: e.homeRegion(p), targets: [], event: null,
      choose: () => { throw new Error('no decision expected'); } } as never;
    e.dealEffectDamageAll(ctx, [
      { target: h.state.entities[a]!, n: 2 },
      { target: h.state.entities[b]!, n: 3 },
    ]);
  });
  const made = unitsOf(h, p).length - before;
  assert.equal(made, 5, '2 + 3 = 5 units, from the batch total — not 2 from the first fragment');
});

test('R80: "each unit" damage kills simultaneously — every unit hears the same total', () => {
  const h = new Harness(6906);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const x = spawn(h, A, 'Unit Token');                  // 1/1
  const y = spawn(h, D, 'Unit Token');                  // 1/1
  giveResources(h, A, 'earth', 4);                      // Haboob: ee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[x]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Haboob') });
  pass(h); pass(h);
  const evs = damageEvents(h.events.slice(mark));
  assert.equal(evs.length, 2, 'one event per unit');
  assert.deepEqual(evs.map(e2 => e2.data?.total), [2, 2], 'both hear "this effect dealt 2"');
  assert.ok(!ent(h, x) && !ent(h, y), 'both 1/1s died');
  finishBattle(h);
});

// ── R81: Burst ───────────────────────────────────────────────────────────

test('R81: Burst casts all your tokens OF THAT NAME, and leaves the others alone', () => {
  const h = new Harness(6907);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  const r = e.homeRegion(D);
  e.createSpellToken(D, 'Fireball', 1, r);
  e.createSpellToken(D, 'Fireball', 1, r);
  e.createSpellToken(D, 'Poison', 1, r);
  h.state = e.s;
  const toks = tokensOf(h, D);
  const fire = toks.filter(t => t.card === 'Fireball');
  const poison = toks.find(t => t.card === 'Poison')!;
  assert.equal(fire.length, 2);
  pass(h);                                              // initiative acts first — priority → D
  h.do({ type: 'castSpellToken', seat: D, entityId: fire[0]!.id });
  // both Fireballs need a target; the Poison must not be asked about at all
  pick(h, { player: A });
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 2, 'both Fireballs went on together');
  assert.ok(h.state.stack.every(i => i.card === 'Fireball'), 'and nothing else did');
  assert.ok(ent(h, poison.id), 'the Poison is still a token in play — a different name, its own timing');
  finishBattle(h);
});
