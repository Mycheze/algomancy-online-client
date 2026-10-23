/* Vroot — "[Augment] When my column deals combat damage, each opponent gains
 * that much life." Asked whether a column whose damage all goes to Oorblak, or
 * to blockers, counts, the owner answered on 2026-10-23: "Any combat damage".
 * The printed clause has no "to a player" in it, so combat damage the column
 * deals to blockers, to Oorblak (a redirect: "that damage is dealt to me
 * instead"), or to the player all counts, and "that much" is all of it.
 *
 * The CT-296 rulings of 2026-10-22 stand for the cards that DO print "to a
 * player" / "to an opponent" (581): a hit wholly redirected into Oorblak pays
 * them nothing. So the class is split by its printed words, and this file
 * derives it from the pool: every card whose own text (reminders stripped)
 * says "deal(s) combat damage" with no "to a player / to an opponent" after it.
 *
 * Seeds 60100-60199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/apply.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';

/** the card's own words, its italic reminders stripped (Rime Wraith's
 * "(Swift units deal combat damage first…)" is a reminder, not a trigger) */
const ownText = (n: string): string => (getCard(n).text ?? '').replace(/\{i\}\([^)]*\)/g, '').replace(/\s+/g, ' ');
const DEALS = /\bdeals? combat damage\b(?! to (?:a |an |target )?(?:players?|oppo-? ?nents?)\b)/i;
/** printed "my column / I deal(s) combat damage" with no player in it */
const ANY_COMBAT_DAMAGE = allCardNames().filter(n => DEALS.test(ownText(n)));

function tok(h: Harness, seat: Seat, p: number, t: number, attrs: Attr[] = []): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  for (const a of attrs) g.addTempAttr(u, a);
  g.settle();
  return u.id;
}

type Shape = 'none' | 'whole' | 'partial' | 'blocked';
/** `name` attacks alone (plus a 6-power Piercing token for 'partial') into a
 * defender with Oorblak ('whole', 'partial'), a 0/20 blocker ('blocked') or
 * nothing; returns the events from the block declaration on */
function strike(seed: number, name: string, shape: Shape): { h: Harness; A: Seat; D: Seat; evs: EngineEvent[] } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const col = [spawn(h, A, name)];
  // CR 608.8c: the column is Piercing, and only the excess past Oorblak's 4 reaches the player
  if (shape === 'partial') col.push(tok(h, A, 6, 20, ['Piercing']));
  if (shape === 'whole' || shape === 'partial') spawn(h, D, 'Oorblak');
  const blocker = shape === 'blocked' ? tok(h, D, 0, 20) : null;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [col] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  const mark = h.events.length;
  h.do({ type: 'declareBlocks', seat: D, blocks: blocker !== null ? { 0: [blocker] } : {} });
  for (let i = 0; i < 12 && h.state.battle && h.state.winner === null; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  return { h, A, D, evs: h.events.slice(mark) };
}

const fired = (evs: EngineEvent[], name: string): number =>
  evs.filter(e => e.msg.startsWith(name) && e.msg.includes('→ stack')).length;
const vrootGain = (evs: EngineEvent[]): number => evs
  .filter(e => /gains \d+ life \(Vroot\)/.test(e.msg))
  .reduce((n, e) => n + Number(/gains (\d+) life/.exec(e.msg)![1]), 0);

test('CR 608.9a: the any-combat-damage class is derived from the printed pool, and it is Vroot, Flowstone Arcanite and Blightmound', () => {
  assert.deepEqual([...ANY_COMBAT_DAMAGE].sort(), ['Blightmound', 'Flowstone Arcanite', 'Vroot'],
    'a new card printing an unqualified "deals combat damage" trigger joins this list and must pass the tests below');
  // and the "to a player" family is NOT in it — 581 holds those to CT-296
  for (const n of ['Zephyrzoa', 'Rippleback Skulker', 'Amphivore', 'Bloodwind Revenant',
    'Eldritch Dreamtender', 'Cinder Scuttler', 'Sarcophage', 'Blightsea Polyp', 'Rime Wraith']) {
    assert.ok(!ANY_COMBAT_DAMAGE.includes(n), `${n} names a player, or only says it in a reminder`);
  }
});

for (const [i, name] of ANY_COMBAT_DAMAGE.entries()) {
  test(`CR 608.8c, 608.9a: ${name} hears its column dealing combat damage to the player, to a blocker, and to Oorblak whole or in part`, () => {
    for (const [k, shape] of (['none', 'blocked', 'whole', 'partial'] as const).entries()) {
      assert.ok(fired(strike(60110 + 4 * i + k, name, shape).evs, name) >= 1,
        `${name}, ${shape}: "Any combat damage" (owner, 2026-10-23)`);
    }
  });
}

test('CR 608.8c, 608.9a: Vroot whose column is wholly redirected into Oorblak gives each opponent the 4 its column dealt', () => {
  const { evs, h, D } = strike(60101, 'Vroot', 'whole');
  assert.equal(evs.filter(e => e.type === 'combatFaceDamage').length, 0, 'PREMISE: the player was dealt nothing (CT-296)');
  assert.ok(evs.some(e => /^Oorblak takes 4/.test(e.msg)), 'PREMISE: Oorblak took the 4');
  assert.equal(vrootGain(evs), 4, 'the column dealt 4 combat damage, to Oorblak');
  assert.equal(h.state.players[D]!.life, 34);
});

test('CR 608.8c, 608.9a: Vroot whose 10-power Piercing column puts 4 into Oorblak and 6 past it gives 10, all its column dealt', () => {
  const { evs, h, D } = strike(60102, 'Vroot', 'partial');
  assert.ok(evs.some(e => /^Oorblak takes 4/.test(e.msg)), 'PREMISE: Oorblak took 4 of the 10');
  assert.equal(vrootGain(evs), 10, '4 to Oorblak and 6 to the player');
  assert.equal(h.state.players[D]!.life, 30 - 6 + 10);
});

test('CR 608.9a: Vroot blocked by a 0/20 gives each opponent the 4 its column dealt the blocker', () => {
  const { evs } = strike(60103, 'Vroot', 'blocked');
  assert.equal(vrootGain(evs), 4);
});

test('CR 608.8c / CT-296: the "to a player" family still hears nothing from a wholly redirected hit', () => {
  // Rippleback Skulker: "Whenever my column deals combat damage to a player" — the same
  // board as Vroot above, so the redirect tag does not leak into the face family
  const { evs } = strike(60104, 'Rippleback Skulker', 'whole');
  assert.ok(evs.some(e => /^Oorblak takes/.test(e.msg)), 'PREMISE: the hit went into Oorblak');
  assert.equal(fired(evs, 'Rippleback Skulker'), 0);
});
