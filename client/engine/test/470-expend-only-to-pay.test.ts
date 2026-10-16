/* Report #209 (room DFRH, the owner, 2026-10-15): "Can you expend resources for
 * no reason? Like if you have one of the cards that gives you a benefit for
 * having expended resources after haste?" Caleb answered no, and the owner
 * (2026-10-16) asked for it to be codified: there is no way to expend a
 * resource except by paying a cost.
 *
 * CR 106.5 says what expending is FOR (paying a mana cost). The engine already
 * enforces the ONLY: the Action union has no expend action, and the one place
 * a resource turns 'expended' is E.payMana, whose every caller is paying a
 * bill (a card, an ability, a prophecy banner, an ambush or "discard me" line,
 * a chosen X, a tax, debt, or a "you may pay [N]" the player chose to pay).
 *
 * The engine was right on #209, so these are REGRESSION guards. They exist to
 * go red on a future "expend for nothing" path: an expend button, a payMana
 * call with no cost behind it, or a direct `state = 'expended'` write.
 *
 *  1. The reported board: the haste step, Keeper of Tithes in play, six open
 *     resources, nothing to play. The only legal action is doneHaste, and the
 *     end-of-haste trigger sees X = 0 and makes no unit.
 *  2. A seeded fuzz invariant. Every action that raises a seat's expended
 *     count is one of the paying action types, and the rise is fully accounted
 *     for by E.payMana calls made inside that action (so nothing writes
 *     'expended' behind payMana's back, and no non-paying action calls it).
 *     What it does NOT check: that the amount payMana charged equals the
 *     action's printed bill. That bill is spread over taxes, X windows,
 *     pay-or-decline decisions and debt, often across several actions, and
 *     recomputing it independently would be a second engine. The tally is the
 *     cheap, exact half: every expended resource has a payment behind it.
 *  3. A source check: no Action union member is named for expending, tapping,
 *     spending or floating mana.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, createGame } from '../src/apply.ts';
import { fuzzGame } from './fuzz.ts';
import { spawn, unitsOf, skipHasteStep, toDeployment } from './util.ts';
import { ENGINE_SRC_DIR } from '../scripts/paths.mjs';
import type { Action, GameState, Seat } from '../src/types.ts';

const expendedOf = (s: GameState): number[] =>
  s.players.map(p => p.resources.filter(r => r.state === 'expended').length);

test('CR 106.5: Keeper of Tithes with six open resources and nothing paid makes no token', () => {
  const h = new Harness(4701);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const keeper = spawn(h, A, 'Keeper of Tithes');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  // the #209 board: six open resources, nothing in hand or cache to spend them on
  const p = h.state.players[A]!;
  p.resources = [
    { kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'water', state: 'open' },
    { kind: 'water', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'shard', state: 'open' },
  ];
  p.hand = [];
  p.cache = [];
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.phase, 'planning');
  assert.ok(h.state.hasteDone && !h.state.hasteDone[A], 'the haste step is open for the Keeper seat');
  assert.deepEqual(h.legal(A).map(a => a.type), ['doneHaste'],
    'with nothing to pay for, the only legal action is to finish the haste step');
  assert.equal(expendedOf(h.state)[A], 0);
  const before = unitsOf(h, A).length;
  h.events.length = 0;
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle', 'the end-of-haste window closed');
  assert.equal(expendedOf(h.state)[A], 0, 'finishing the haste step expended nothing');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 6, 'all six stay open');
  assert.equal(unitsOf(h, A).filter(u => u.id !== keeper && u.token).length, 0, 'no token');
  assert.equal(unitsOf(h, A).length, before, 'X = 0, so no unit was created');
  assert.ok(h.events.some(e => e.msg.includes('Keeper of Tithes: no expended resources')),
    'the trigger resolved and read X = 0');
});

/** the action types that pay a mana cost, directly or by answering the
 * engine's question about one (decide: a chosen X, a pay-or-decline, a tax;
 * donePlanning: the resource step's automatic debt payment, CR 112.14a) */
const PAYING = new Set<Action['type']>([
  'playCard', 'playCached', 'playFromBin', 'prophesy', 'augment', 'graft',
  'activateAbility', 'castSpellToken', 'decide', 'donePlanning',
]);

test('CR 106.5: no action expends a resource except by paying a cost', () => {
  // count every E.payMana call, per seat, made while one action is applied
  const tally: number[] = [0, 0];
  const real = E.prototype.payMana;
  E.prototype.payMana = function (this: E, seat: Seat, mana: number): void {
    tally[seat] = (tally[seat] ?? 0) + mana;
    real.call(this, seat, mana);
  };
  const rises: Record<string, number> = {};
  let steps = 0;
  try {
    for (const [mode, seeds] of [['shared', [4701, 4706]], ['draft', [4751, 4756]]] as const) {
      for (let seed = seeds[0]; seed <= seeds[1]; seed++) {
        const r = fuzzGame(seed, 1500, mode);
        let { state } = createGame(seed, undefined, mode);
        for (const [i, a] of r.actions.entries()) {
          const before = expendedOf(state);
          tally[0] = 0; tally[1] = 0;
          const next = apply(state, a).state;
          const after = expendedOf(next);
          steps++;
          const where = `seed ${seed} (${mode}), action ${i}: ${JSON.stringify(a)}`;
          for (const seat of [0, 1] as const) {
            const rise = after[seat]! - before[seat]!;
            const paid = tally[seat]!;
            if (paid > 0) {
              assert.ok(PAYING.has(a.type), `${a.type} charged seat ${seat} [${paid}] but pays no cost — ${where}`);
            }
            if (rise > 0) {
              rises[a.type] = (rises[a.type] ?? 0) + 1;
              assert.ok(PAYING.has(a.type), `${a.type} expended ${rise} of seat ${seat}'s resources but pays no cost — ${where}`);
              assert.ok(rise <= paid,
                `seat ${seat} gained ${rise} expended resources but only [${paid}] was paid — ${where}`);
            }
          }
          state = next;
        }
      }
    }
  } finally {
    E.prototype.payMana = real;
  }
  // the sweep is not blind: real payments happened and were seen
  assert.ok(steps > 5000, `only ${steps} actions replayed`);
  assert.ok((rises['playCard'] ?? 0) > 0, `no playCard paid anything: ${JSON.stringify(rises)}`);
});

test('CR 106.5: the Action union has no expend, tap, spend or float action', () => {
  const src = fs.readFileSync(path.join(ENGINE_SRC_DIR, 'types.ts'), 'utf8');
  const start = src.indexOf('export type Action =');
  assert.ok(start >= 0, 'types.ts still declares the Action union');
  const end = src.indexOf('\nexport ', start + 1);
  const union = src.slice(start, end < 0 ? undefined : end);
  const names = [...union.matchAll(/type:\s*'([A-Za-z]+)'/g)].map(m => m[1]!);
  assert.ok(names.includes('doneHaste') && names.includes('playCard'), `the union was read: ${names.join(', ')}`);
  const bad = names.filter(n => /expend|tap|spend|float|mana/i.test(n));
  assert.deepEqual(bad, [], 'a resource is expended only by paying a cost, never by an action of its own');
});
