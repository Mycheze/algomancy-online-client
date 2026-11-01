/* /api/bot/simulate — THE BOARD IS THE SCENARIO TESTER'S BOARD (board.ts).
 *
 * `patchSide` and `closeHasteStep` moved out of scenarios.ts into board.ts
 * (2026-11-01) so the judge bot's calculator builds its board with the code
 * the scenario tester deals with. The move was verified byte-identical by
 * hashing every scenario's dealt state and events before and after (92 deals,
 * one hash); 185/186 are the standing guards on the scenarios themselves.
 * This file guards the seam:
 *
 * §1 ⭐ there is ONE copy: scenarios.ts imports both from board.ts and defines
 *    neither, and simulate.ts builds through board.ts too
 * §2 185 §3's clock/randomness scan, over board.ts — the code it used to
 *    scan in scenarios.ts lives here now, and a scan of the old file alone
 *    would have gone quietly blind to it
 * §3 ⭐ the same board through both doors: a simulation of the
 *    lithoghul-donated scenario's sides builds the units the scenario deals
 * §4 a simulation is a pure function of its spec: twice → the same answer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, dealScenario } from '../scenarios.ts';
import { simulate, type SimOk } from '../simulate.ts';
import { E } from '../../engine/src/engine.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f: string): string => readFileSync(join(HERE, '..', f), 'utf8');

/* ══ §1 ═════════════════════════════════════════════════════════════ */

test('§1 ⭐ one copy: scenarios.ts and simulate.ts both take patchSide/closeHasteStep from board.ts', () => {
  const sc = src('scenarios.ts');
  assert.match(sc, /import \{ closeHasteStep, patchSide \} from '\.\/board\.ts';/);
  assert.doesNotMatch(sc, /function\s+patchSide\s*\(/, 'scenarios.ts no longer defines patchSide');
  assert.doesNotMatch(sc, /function\s+closeHasteStep\s*\(/, 'scenarios.ts no longer defines closeHasteStep');
  const bd = src('board.ts');
  assert.match(bd, /export function patchSide\s*\(/);
  assert.match(bd, /export function closeHasteStep\s*\(/);
  const sim = src('simulate.ts');
  assert.match(sim, /import \{ closeHasteStep, patchSide, type BoardSide \} from '\.\/board\.ts';/);
  assert.match(sim, /patchSide\(e, seat, board, this\.ids\[side\]\)/, 'simulate.ts builds the board through patchSide');
  assert.match(sim, /closeHasteStep\(this\.state, this\.events\)/, '…and walks the haste step through closeHasteStep');
});

/* ══ §2 ═════════════════════════════════════════════════════════════ */

test('§2 board.ts names no clock and no unseeded randomness (185 §3, moved with the code)', () => {
  const bd = src('board.ts');
  for (const pattern of [/Date\s*\.\s*now\s*\(/, /Math\s*\.\s*random\s*\(/, /performance\s*\.\s*now\s*\(/, /crypto\./]) {
    assert.ok(!pattern.test(bd), `server/board.ts matches ${pattern} — a patched board must be a pure function of its inputs`);
  }
  assert.equal(/Math\s*\.\s*random\s*\(/.test('x = Math.random();'), true, 'the scan can see');
});

/* ══ §3 ═════════════════════════════════════════════════════════════ */

test('§3 ⭐ the same board through both doors (lithoghul-donated)', () => {
  const sc = SCENARIOS['lithoghul-donated']!;
  const dealt = dealScenario(216216216, ['You', 'Bot'], 'shared', ['fire', 'earth', 'light'], undefined, sc.id).state;
  const q = new E(structuredClone(dealt));
  const statsOf = (seat: 0 | 1): string[] => Object.values(q.s.entities)
    .filter(u => u.kind === 'unit' && u.controller === seat)
    .map(u => `${u.card} ${q.effStats(u).join('/')}`);

  const r = simulate({
    initiative: 'you',
    you: { hand: sc.you.hand, play: sc.you.play.map(p => p.card), resources: sc.you.resources },
    opponent: { hand: sc.opponent.hand, play: sc.opponent.play.map(p => p.card), resources: sc.opponent.resources },
    attack: [['you.0']],
  }) as SimOk;
  assert.ok(r.ok, JSON.stringify(r));
  const simStats = (side: 'you' | 'opponent'): string[] =>
    r.final.units.filter(u => u.ref.startsWith(side)).map(u => `${u.card} ${u.stats}`);
  assert.deepEqual(simStats('you'), statsOf(0), 'your units, with the statics live (The Foretold 5/5 under the Colossus\'s augment line)');
  assert.deepEqual(simStats('opponent'), statsOf(1));
  assert.deepEqual(r.final.hands.you, sc.you.hand);
  assert.equal(r.final.phase, 'battle round 1, attackWindow', 'the walk lands where the scenario\'s prologue does');
  assert.equal(dealt.phase, 'battle');
  assert.equal(dealt.battle?.step, 'attackWindow');
});

/* ══ §4 ═════════════════════════════════════════════════════════════ */

test('§4 a simulation is a pure function of its spec', () => {
  const spec = {
    you: { hand: ['Luminous Arc'], play: ['The Foretold'], resources: { fire: 3 } },
    opponent: { play: ['Towering Colossus'] },
    attack: [['you.0']],
    steps: [{ do: 'play', card: 'Luminous Arc', targets: ['opponent.0'] }],
    until: 'endOfTurn', showOffered: true,
  };
  const a = JSON.stringify(simulate(spec));
  const b = JSON.stringify(simulate(structuredClone(spec)));
  assert.equal(a, b);
  assert.match(a, /"ok":true/);
});
