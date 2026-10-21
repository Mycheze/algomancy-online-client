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
 *   §3 the stamp carries both numbers, and the order is raw's
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { better, skillOf, type RunScore } from '../src/challenge.ts';

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

test('§3 a stamp carries raw and Skill; the order is raw\'s, exact where Skill rounds', () => {
  const s = (r: number): RunScore => ({ unique: 1, extra: 0, cards: 1, elements: 1, turns: r, raw: r, skill: skillOf(1000, r) });
  // 1000/1999 and 1000/2001 both round to 50: raw still tells them apart
  assert.equal(s(1999).skill, s(2001).skill);
  assert.equal(better(s(1999), s(2001)), true);
  assert.equal(better(s(2001), s(1999)), false);
});
