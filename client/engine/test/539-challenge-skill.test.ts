/* WEEKLY CHALLENGES — the shown Skill (docs/21 "Scoring", owner 2026-10-21).
 *
 * The owner did two runs, 8 cards · 2 elements · 5 turns and 6 · 2 · 5, saw
 * "Skill 80" and "Skill 60", and asked why the second was lower. So the
 * shown number turned round: Skill = par ÷ (cards × max(1, elements) × turns)
 * × 100, HIGHER is better, rounded half up, and the challenge's reference run
 * (whose raw IS the par) scores exactly 100.
 *
 *   §1 ⭐ the owner's example: par 10·1·9 = 90 → the 6·2·5 run shows 150 and
 *      the 8·2·5 run shows 113 (112.5, rounded half up)
 *   §2 par scores 100, a half always rounds up, and a zero raw cannot divide
 *   §3 ⭐ the boards (owner, 2026-10-23): the stamp still carries Skill, but
 *      nothing ranks by it. Full House's real runs, sorted four ways, put
 *      both turn-3 runs on top of fastest, and the 12-turn 3-card run —
 *      Skill 250 — second on leanest and nowhere near the top of overall.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_KINDS, compareScores, skillOf, type BoardKind, type RunScore } from '../src/challenge.ts';

const raw = (cards: number, elements: number, turns: number): number => cards * Math.max(1, elements) * turns;

test('§1 the owner\'s example: par 90; 6·2·5 shows 150 and 8·2·5 shows 113', () => {
  const par = raw(10, 1, 9);
  assert.equal(par, 90);
  assert.equal(skillOf(par, raw(6, 2, 5)), 150, '90 / 60 × 100');
  assert.equal(skillOf(par, raw(8, 2, 5)), 113, '90 / 80 × 100 = 112.5, rounded half up');
  assert.ok(skillOf(par, raw(6, 2, 5)) > skillOf(par, raw(8, 2, 5)), 'fewer cards: the higher Skill');
});

test('§2 par scores 100; halves round up; a zero raw cannot divide', () => {
  for (const p of [1, 81, 90, 104, 286]) assert.equal(skillOf(p, p), 100, `par ${p}`);
  assert.equal(skillOf(1, 8), 13, '12.5 → 13');
  assert.equal(skillOf(1, 3), 33, '33.3 → 33');
  assert.equal(skillOf(2, 3), 67, '66.7 → 67');
  assert.equal(skillOf(90, 0), skillOf(90, 1), 'raw 0 is read as 1');
});

test('§3 the four boards, on Full House\'s real runs (2026-10-23)', () => {
  const run = (name: string, cards: number, elements: number, turns: number): [string, RunScore] =>
    [name, { unique: cards, extra: 0, cards, elements, turns, raw: raw(cards, elements, turns), skill: skillOf(90, raw(cards, elements, turns)) }];
  // every distinct run on the live board that day, by player (cards/elements/turns)
  const runs = [
    run('Tomzy', 5, 5, 3), run('Tomzy', 3, 2, 5), run('Tomzy', 4, 2, 5), run('Tomzy', 5, 4, 6),
    run('Karanda', 7, 4, 3), run('Karanda', 4, 3, 6), run('Karanda', 4, 3, 9),
    run('mycheze', 4, 4, 4), run('mycheze', 7, 3, 5),
    run('LordZZX', 6, 4, 4), run('LordZZX', 7, 5, 4),
    run('Debeli', 8, 3, 4), run('Debeli', 8, 4, 5), run('Debeli', 10, 3, 7),
    run('Gember', 5, 2, 5), run('Gember', 6, 2, 6),
    run('Nyar', 5, 1, 6), run('Nyar', 4, 1, 9), run('Nyar', 3, 1, 12),
  ];
  const top = (k: BoardKind, n: number): string[] => {
    const best = new Map<string, RunScore>();
    for (const [who, s] of runs) { const b = best.get(who); if (!b || compareScores(k, s, b) < 0) best.set(who, s); }
    return [...best].sort((a, b) => compareScores(k, a[1], b[1])).slice(0, n)
      .map(([who, s]) => `${who} ${s.cards}/${s.elements}/${s.turns}`);
  };
  assert.deepEqual(top('fastest', 3), ['Tomzy 5/5/3', 'Karanda 7/4/3', 'mycheze 4/4/4']);
  assert.deepEqual(top('leanest', 3), ['Tomzy 3/2/5', 'Nyar 3/1/12', 'mycheze 4/4/4']);
  assert.deepEqual(top('purest', 3), ['Nyar 5/1/6', 'Tomzy 3/2/5', 'Gember 5/2/5']);
  assert.deepEqual(top('overall', 3), ['Tomzy 5/5/3', 'Karanda 7/4/3', 'mycheze 4/4/4']);
  // the run the old Skill liked best but one: 3·1·12 = 36, Skill 250
  assert.equal(skillOf(90, raw(3, 1, 12)), 250);
  assert.equal(top('overall', 7).findIndex(r => r.startsWith('Nyar')), 4, 'Nyar\'s best overall is the 6-turn run, fifth');
  // every board's order is total over different numbers, and a tie is 0
  for (const k of BOARD_KINDS) for (const [, a] of runs) assert.equal(compareScores(k, a, { ...a }), 0);
});
