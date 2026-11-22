/* "Rank all seven": the trio is the top of the combined ranking, and chance
 * only breaks a tie at the cut — two players who agree on their top three get it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Element } from '../../engine/src/types.ts';
import { resolveTrio } from '../trio.ts';

const rank = (a: Element[], b: Element[], rng: number, count = 3) => resolveTrio({
  method: 'rank', submissions: [{ ranking: a }, { ranking: b }], names: ['mycheze', 'Gember'], history: [], rng, count,
});

const MYCHEZE: Element[] = ['earth', 'dark', 'water', 'metal', 'wood', 'light', 'fire'];
const GEMBER: Element[] = ['earth', 'dark', 'water', 'fire', 'wood', 'metal', 'light'];

test('rank vote: two ballots sharing a top three get exactly that trio, on every seed', () => {
  for (let seed = 0; seed < 500; seed++) {
    assert.deepEqual(rank(MYCHEZE, GEMBER, seed * 7919 + 1).els, ['water', 'earth', 'dark'], `seed ${seed}`);
  }
});

test('rank vote: a lower combined rank always beats a higher one', () => {
  // earth 2 · dark 4 · water 6 · wood 10 · metal 10 · fire 11 · light 13
  for (let seed = 0; seed < 200; seed++) {
    const four = rank(MYCHEZE, GEMBER, seed, 4).els;
    assert.ok(four.includes('earth') && four.includes('dark') && four.includes('water'), `seed ${seed}`);
    assert.ok(!four.includes('fire') && !four.includes('light'), `seed ${seed}: ${four.join('+')}`);
  }
});

test('rank vote: a tie at the cut is broken at random, and the working says so', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 100; seed++) {
    const r = rank(MYCHEZE, GEMBER, seed, 4);
    seen.add(r.els.join('+'));
    assert.ok(r.detail.some(d => /wood \+ metal tied at 10/.test(d)), r.detail.join('\n'));
  }
  assert.deepEqual([...seen].sort(), ['water+earth+wood+dark', 'water+earth+metal+dark'].sort());
});

test('rank vote: the working ends on the top three, and no tie line when none decided it', () => {
  const r = rank(MYCHEZE, GEMBER, 42);
  assert.equal(r.detail.at(-1), 'Your top three: water + earth + dark.');
  assert.ok(!r.detail.some(d => /tied/.test(d)));
});
