/* CR 708.8, 708.8b, 112.15 — REMOVING COUNTERS IS NOT PUTTING THE OPPOSITE KIND ON.
 *
 * Found beside report #210 (room FFAH): every unit-counter removal went
 * through `addCounters(u, -k)`, so the engine could not tell "remove two
 * +1/+1 counters" from "put two -1/-1 counters". Measured before the fix:
 *   · Burn the Blight stripping an ENEMY's +1/+1s drew its caster a card off
 *     Wandering Blightshell ("when you PUT a counter on an enemy");
 *   · stripping your own ally's drew one off Scrapyard Custodian;
 *   · Flux Resonator and Proliferating Slime made the removal one BIGGER, so a
 *     +2 unit ended on -1 — against CR 708.8's own example, "Proliferating
 *     Slime does not change how many counters Burn the Blight removes".
 * The player-counter half (rot, debt) already had `loseRot`/`loseDebt` and
 * their own events; `E.removeCounters` and 'countersRemoved' are the unit half.
 *
 * Seeds 45500-45599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE as whiteBox } from './util.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';
import { ENGINE_SRC_DIR } from '../scripts/paths.mjs';

const handOf = (h: Harness, s: Seat): number => h.state.players[s]!.hand.length;
function during(h: Harness, fn: () => void): EngineEvent[] {
  const before = h.events.length;
  fn();
  return h.events.slice(before);
}

/** A attacks with `mine` (listener cards ride along so they are present), D
 * has `victim` at home in the battle region with `k` counters D put on it, and
 * A then casts Burn the Blight. Returns the events of the cast. */
function burnBoard(seed: number, mine: string[], victimSide: 'enemy' | 'ally', k: number): {
  h: Harness; A: Seat; D: Seat; victim: EntityId; evs: EngineEvent[]; hand0: number;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const listeners = mine.map(n => spawn(h, A, n));
  const victim = spawn(h, victimSide === 'enemy' ? D : A, 'The Foretold');
  whiteBox(h, e => e.addCounters(e.entity(victim)!, k, D));
  giveResources(h, A, 'dark', 3);
  toNextBattle(h, A);
  const cols = [[atk], ...listeners.map(id => [id])];
  if (victimSide === 'ally') cols.push([victim]);
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  assert.equal(ent(h, victim)!.region, h.state.battle!.region, 'the victim is in the battle');
  const hand0 = handOf(h, A);
  const evs = during(h, () => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burn the Blight') });
    pass(h); pass(h); pass(h); pass(h);
  });
  return { h, A, D, victim, evs, hand0 };
}

test('Burn the Blight removing an enemy +1/+1 counters is not a counter you put: Blightshell draws nothing', () => {
  const { h, A, victim, evs, hand0 } = burnBoard(45501, ['Wandering Blightshell'], 'enemy', 2);
  assert.equal(ent(h, victim)!.counters, 0, 'all counters removed');
  assert.equal(handOf(h, A), hand0, 'a removal is not a placement');
  assert.equal(evs.filter(e => e.type === 'countersChanged').length, 0, 'no placement event at all');
  const rm = evs.filter(e => e.type === 'countersRemoved');
  assert.equal(rm.length, 1, 'the removal is announced on its own event');
  assert.deepEqual([rm[0]!.data?.['unit'], rm[0]!.data?.['n'], rm[0]!.data?.['removed'], rm[0]!.data?.['total']],
    [victim, -2, 2, 0], 'with the same unit / signed n / total shape as a placement, plus the count');
});

test('Burn the Blight removing +1/+1 counters from your own ally: Scrapyard Custodian draws nothing', () => {
  const { h, A, victim, hand0 } = burnBoard(45502, ['Scrapyard Custodian'], 'ally', 2);
  assert.equal(ent(h, victim)!.counters, 0);
  assert.equal(handOf(h, A), hand0, 'Custodian hears only counters PUT on an ally');
});

test('Flux Resonator does not enlarge a removal: Burn the Blight on a +2 unit leaves it at 0', () => {
  const { h, victim } = burnBoard(45503, ['Flux Resonator'], 'enemy', 2);
  assert.equal(ent(h, victim)!.counters, 0, 'a scaled removal would leave -1');
});

test('CR 708.8 example: Proliferating Slime does not change how many counters Burn the Blight removes', () => {
  const { h, victim } = burnBoard(45504, ['Proliferating Slime'], 'enemy', 2);
  assert.equal(ent(h, victim)!.counters, 0, 'a scaled removal would leave -1');
});

test('removing -1/-1 counters is not putting +1/+1 counters on: no Resonator extra, no Custodian draw', () => {
  // Burn the Blight on an ally carrying -2: the old addCounters(u, +2) read as
  // "you put two +1/+1 on an ally" and the Resonator made it three (net +1)
  const { h, A, victim, hand0 } = burnBoard(45505, ['Scrapyard Custodian', 'Flux Resonator'], 'ally', -2);
  assert.equal(ent(h, victim)!.counters, 0);
  assert.equal(handOf(h, A), hand0);
});

test('a MOVE removes from the source and puts on the destination: Flux Resonator enlarges only the put', () => {
  // Scrap For Parts with my Resonator: the enemy's +2 come off as exactly 2
  // (the old addCounters(from, -2) read as my -1/-1 placement and became -3,
  // leaving the enemy on -1); the two put on my unit are mine, so they are 3.
  const h = new Harness(45507);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'The Foretold');
  const flux = spawn(h, A, 'Flux Resonator');
  const enemy = spawn(h, D, 'The Foretold');
  whiteBox(h, e => e.addCounters(e.entity(enemy)!, 2, D));
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine], [flux]] });
  const evs = during(h, () => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Scrap For Parts') });
    pick(h, { unit: enemy });
    pick(h, { unit: mine });
    pass(h); pass(h);
  });
  assert.equal(ent(h, enemy)!.counters, 0, 'the source is stripped bare, not pushed below zero');
  assert.equal(ent(h, mine)!.counters, 3, 'the destination is a placement by me: plus one');
  assert.equal(evs.filter(e => e.type === 'countersRemoved' && e.data?.['unit'] === enemy).length, 1,
    'the source side is announced as a removal');
});

test('E.removeCounters clamps at zero and never crosses it', () => {
  const h = new Harness(45506);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'The Foretold');
  whiteBox(h, e => e.addCounters(e.entity(u)!, 2, A));
  whiteBox(h, e => assert.equal(e.removeCounters(e.entity(u)!, 5), 2, 'only what was there goes'));
  assert.equal(ent(h, u)!.counters, 0);
  const evs = during(h, () => whiteBox(h, e => assert.equal(e.removeCounters(e.entity(u)!, 1), 0)));
  assert.equal(evs.filter(e => e.type === 'countersRemoved').length, 0, 'no event for nothing removed');
  whiteBox(h, e => e.addCounters(e.entity(u)!, -2, A));
  whiteBox(h, e => e.removeCounters(e.entity(u)!, 1));
  assert.equal(ent(h, u)!.counters, -1, 'a -1/-1 removal moves the net up toward zero');
});

/* CLASS GUARD — derived from the printed pool, not listed by hand. Every card
 * whose printed text REMOVES or MOVES counters must take them off through
 * `removeCounters`: a removal written as `addCounters(u, -k)` (or `+k` for a
 * -1/-1) is a placement to every listener and every amount modifier. Costs
 * ("[Remove X +1/+1 counters …]") are paid by the engine (payCastCost), which
 * the last assertion pins. A card whose source has already left play
 * (Powerforge Synergist: "When I despawn, … move my counters") has nothing to
 * remove and is the one declared exemption. */
test('CR 708.8 class guard: every printed counter removal or move goes through removeCounters', () => {
  const printed = JSON.parse(fs.readFileSync(path.join(ENGINE_SRC_DIR, 'cards', 'printed.json'), 'utf8')) as
    Record<string, { text?: string }>;
  const REMOVE = /\b(remove|move)s?\b[^.]*\bcounters?\b/i;
  /** an activated or alternative COST: "[Remove X … counters …]" or "Remove X … counters …:" */
  const COST = /\[?\bremove\b[^.:\]]*counters?[^.:\]]*\]?\s*:/i;
  const EXEMPT = new Set(['Powerforge Synergist']);
  const sources = fs.readdirSync(path.join(ENGINE_SRC_DIR, 'cards', 'sets'))
    .filter(f => f.endsWith('.ts'))
    .map(f => fs.readFileSync(path.join(ENGINE_SRC_DIR, 'cards', 'sets', f), 'utf8'));
  /** the source of one card() block, up to the next card( */
  const blockOf = (name: string): string | undefined => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const src of sources) {
      const m = new RegExp(`card\\(\\s*["'\`]${esc}["'\`]`).exec(src);
      if (!m) continue;
      const rest = src.slice(m.index + 5);
      const next = rest.search(/\ncard\(/);
      // the effect may be a named const ABOVE the card() call: take the
      // stretch since the previous card() block as well
      const before = src.slice(0, m.index);
      const prev = before.lastIndexOf('\ncard(');
      return before.slice(prev < 0 ? 0 : prev) + (next < 0 ? rest : rest.slice(0, next));
    }
    return undefined;
  };
  const checked: string[] = [];
  const bad: string[] = [];
  for (const [name, card] of Object.entries(printed)) {
    const raw = card.text ?? '';
    const text = raw.replace(COST, '');
    if (!REMOVE.test(raw) || EXEMPT.has(name)) continue;
    try { if (!getCard(name)) continue; } catch { continue; }
    const src = blockOf(name);
    assert.ok(src, `${name} prints a counter removal and has a card() block`);
    if (COST.test(raw)) {
      assert.ok(/kind: 'removeCounters'/.test(src!), `${name} prints a counter-removal COST and declares it as one`);
      if (!REMOVE.test(text)) { checked.push(name); continue; }
    }
    checked.push(name);
    if (!/\.removeCounters\(/.test(src!)) bad.push(name);
  }
  assert.ok(checked.length >= 7, `the sweep is not blind (found: ${checked.join(', ')})`);
  assert.deepEqual(bad, [], 'these remove or move counters without removeCounters');
  const engine = fs.readFileSync(path.join(ENGINE_SRC_DIR, 'engine.ts'), 'utf8');
  const cost = /if \('counterFrom' in obj\) \{[\s\S]*?\n {4}\}/.exec(engine);
  assert.ok(cost, 'the counter-cost payment block is still where this guard looks');
  assert.ok(/this\.removeCounters\(/.test(cost![0]) && !/this\.addCounters\(/.test(cost![0]),
    'a [Remove X counters] cost is paid with removeCounters');
});
