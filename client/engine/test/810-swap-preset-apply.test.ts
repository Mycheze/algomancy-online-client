/* A SWAP PRESET — engine/src/matchdeck.ts applyPreset and presetBetween
 * (docs/22 §4.6).
 *
 * A preset is a TARGET relative to the registered deck, never a delta on the
 * current configuration: two clicks give what one does, and a preset is valid
 * in game 3 whatever game 2 used. Validity is computed; a stale one says why.
 *
 *  §1 absolute and idempotent: applying it to its own result changes nothing
 *     a player can see, because it is applied to the REGISTERED deck each time
 *  §2 the result is a legal configuration of the same cards (checkSwap)
 *  §3 a stale preset reports its reason: a card short on either board, a main
 *     under 30, a sideboard over 7
 *  §4 presetBetween is its inverse ("set from current")
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, checkSwap, presetBetween, type MatchConfig } from '../src/matchdeck.ts';
import { DECK_LIST } from '../src/cards/registry.ts';

const POOL = DECK_LIST.filter(n => n !== 'Counter Thief');
const REG: MatchConfig = { main: POOL.slice(0, 31), side: POOL.slice(31, 37) };
const sorted = (l: string[]): string[] => [...l].sort();
const ok = (r: MatchConfig | { error: string }): MatchConfig => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

test('§1 a preset is applied to the registered deck, so it is idempotent', () => {
  const p = { out: [REG.main[0]!], in: [REG.side[0]!, REG.side[1]!] };
  const once = ok(applyPreset(REG, p));
  assert.equal(once.main.length, 32);
  assert.equal(once.side.length, 5);
  assert.ok(once.side.includes(REG.main[0]!) && once.main.includes(REG.side[1]!));
  // a second click — the caller passes the registered deck again — is the same configuration
  assert.deepEqual(ok(applyPreset(REG, p)), once);
  // and it does not depend on where the player had got to: whatever another preset did first
  const other = ok(applyPreset(REG, { out: [REG.main[5]!], in: [] }));
  assert.notDeepEqual(other, once);
  assert.deepEqual(ok(applyPreset(REG, p)), once, 'the second preset ignores the first');
});

test('§2 the result is a legal configuration of the registered cards', () => {
  const p = { out: [REG.main[0]!, REG.main[1]!], in: [REG.side[2]!] };
  const r = ok(applyPreset(REG, p));
  assert.ok(checkSwap(REG, r).ok);
  assert.deepEqual(sorted([...r.main, ...r.side]), sorted([...REG.main, ...REG.side]));
  // the main keeps its order with the leavers out, arrivals appended
  assert.deepEqual(r.main, [...REG.main.slice(2), REG.side[2]!]);
  // aliases in a preset are the card they name
  const reg2: MatchConfig = { main: [...POOL.slice(0, 30), 'Counter Thief'], side: [] };
  const a = ok(applyPreset(reg2, { out: ['Counter Theif'], in: [] }));
  assert.deepEqual(a.side, ['Counter Thief']);
});

test('§3 a stale preset is refused with the reason', () => {
  const twice = applyPreset(REG, { out: [REG.main[0]!, REG.main[0]!], in: [] });
  assert.deepEqual(twice, { error: `needs 2× ${REG.main[0]} in the main deck` });
  const notSide = applyPreset(REG, { out: [], in: [REG.main[0]!] });
  assert.deepEqual(notSide, { error: `needs 1× ${REG.main[0]} in the sideboard` });
  const under = applyPreset(REG, { out: [REG.main[0]!, REG.main[1]!], in: [] });
  assert.ok('error' in under && /main deck at 29/.test(under.error), JSON.stringify(under));
  const big: MatchConfig = { main: POOL.slice(0, 33), side: POOL.slice(33, 38) };
  const over = applyPreset(big, { out: [big.main[0]!, big.main[1]!, big.main[2]!], in: [] });
  assert.ok('error' in over && /8 cards in the sideboard/.test(over.error), JSON.stringify(over));
});

test('§4 presetBetween captures a configuration that applyPreset gives back', () => {
  const current: MatchConfig = {
    main: [...REG.main.slice(3), REG.side[0]!, REG.side[4]!],
    side: [...REG.side.filter((_, i) => i !== 0 && i !== 4), ...REG.main.slice(0, 3)],
  };
  const p = presetBetween(REG, current);
  assert.deepEqual(sorted(p.out), sorted(REG.main.slice(0, 3)));
  assert.deepEqual(sorted(p.in), sorted([REG.side[0]!, REG.side[4]!]));
  const back = ok(applyPreset(REG, p));
  assert.deepEqual(sorted(back.main), sorted(current.main));
  assert.deepEqual(sorted(back.side), sorted(current.side));
  assert.deepEqual(presetBetween(REG, REG), { out: [], in: [] });
});
