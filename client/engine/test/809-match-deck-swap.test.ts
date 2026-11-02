/* A BETWEEN-GAMES CONFIGURATION — engine/src/matchdeck.ts checkSwap (docs/22
 * §4.1). Like Magic (owner, docs/22 §0): any card either way, main at least 30,
 * sideboard at most 7 — and always the cards that were REGISTERED.
 *
 *  §1 any reshuffle of the same cards that is legal passes, from any legal start
 *  §2 a card that was not registered, or one that went missing, is refused
 *  §3 the main deck may not drop under 30, the sideboard may not pass 7
 *  §4 aliases are the card they name on both sides of the comparison
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSwap, type MatchConfig } from '../src/matchdeck.ts';
import { DECK_LIST } from '../src/cards/registry.ts';

const POOL = DECK_LIST.filter(n => n !== 'Counter Thief');
const REG: MatchConfig = { main: POOL.slice(0, 31), side: POOL.slice(31, 37) };
const err = (r: { ok: boolean }): string => (r as { error?: string }).error ?? '';

test('§1 the same cards in any legal split pass', () => {
  assert.ok(checkSwap(REG, REG).ok, 'the registered deck itself');
  // two out, one in: main 30, side 7, main size changed
  const next = { main: [...REG.main.slice(2), REG.side[0]!], side: [...REG.side.slice(1), REG.main[0]!, REG.main[1]!] };
  const r = checkSwap(REG, next);
  assert.ok(r.ok, err(r));
  // and from THAT configuration onward (game 3 starts from game 2's)
  const back = { main: [...next.main.slice(0, -1), next.side[5]!, next.side[6]!], side: [...next.side.slice(0, 5), next.main[next.main.length - 1]!] };
  assert.ok(checkSwap(REG, back).ok, err(checkSwap(REG, back)));
});

test('§2 a card from outside the registration, or a lost one, is refused', () => {
  const stranger = POOL[40]!;
  const r = checkSwap(REG, { main: REG.main, side: [...REG.side.slice(1), stranger] });
  assert.equal(r.ok, false);
  assert.match(err(r), new RegExp(`not in the registered deck: ${stranger}`));
  const lost = checkSwap(REG, { main: REG.main, side: REG.side.slice(1) });
  assert.equal(lost.ok, false);
  assert.match(err(lost), /missing from both boards/);
  assert.equal(checkSwap(REG, { main: REG.main } as unknown as MatchConfig).ok, false, 'both boards must be sent');
});

test('§3 the main deck stays at 30 or more and the sideboard at 7 or fewer', () => {
  // two from main to side: main 29, side 8
  const r = checkSwap(REG, { main: REG.main.slice(2), side: [...REG.side, REG.main[0]!, REG.main[1]!] });
  assert.equal(r.ok, false);
  assert.match(err(r), /at least 30/);
  const big: MatchConfig = { main: POOL.slice(0, 36), side: POOL.slice(36, 37) };
  // six to the main is fine (main 37 + side 0); the reverse of a 36+1 into 29+8 is not
  assert.ok(checkSwap(big, { main: POOL.slice(0, 37), side: [] }).ok);
  const r2 = checkSwap(big, { main: POOL.slice(0, 29), side: POOL.slice(29, 37) });
  assert.equal(r2.ok, false);
});

test('§4 an alias on either side of the comparison is its card', () => {
  const reg: MatchConfig = { main: [...POOL.slice(0, 30), 'Counter Theif'], side: [] };
  const r = checkSwap(reg, { main: [...POOL.slice(0, 30)], side: ['Counter Thief'] });
  assert.ok(r.ok, err(r));
  assert.deepEqual((r as { side: string[] }).side, ['Counter Thief']);
});
