/* CARD STATS — a refs-only game counts the cards it played FROM THE CACHE.
 *
 * Fix 8b88225 (2026-10-23). `referenceKey` (rooms.ts) writes a cache slot as
 * the cache ENTRY's JSON — `0:{"card":"Hooba-Lin","uid":3,…}` — never as a
 * quoted name, so `parseRef().named` holds nothing for it, and the refs-read
 * ledger (`refsLedger`) dropped every cached play and every augment, graft and
 * prophecy from the cache. 332 (c) found it only because its random walk
 * happened onto a cache augment; this file builds the refs by hand so the
 * guard does not depend on any walk.
 *
 * The file below cannot be replayed (its first action is refused on a fresh
 * deal), so the ledger is read from the refs alone — the `refs` rung of the
 * ladder in cardledger.ts. A play from the hand rides along as the control:
 * it was always counted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../../engine/src/types.ts';
import { ledgerForFile, type LedgerFile } from '../cardledger.ts';

const entry = (card: string, uid: number): string => JSON.stringify({ card, uid, playableUntilTurn: 4 });

/** [action, ref] — every ref spelled exactly as referenceKey + zoneDelta write it */
const LOG: [Action, string][] = [
  [{ type: 'playCached', seat: 0, index: 0 } as Action,
    `playCached|0:${entry('Hooba-Lin', 1)}|-1c:${entry('Hooba-Lin', 1)}`],
  [{ type: 'augment', seat: 0, from: 'cache', index: 0, hostId: 4 } as Action,
    `augment|cache|0:${entry('Gravitational Correction', 2)}|t1#1|-|-1c:${entry('Gravitational Correction', 2)}`],
  [{ type: 'graft', seat: 0, from: 'cache', index: 0, hostId: 4, position: 0 } as Action,
    `graft|cache|0:${entry('Child of Aether', 3)}|t1#1|0|-1c:${entry('Child of Aether', 3)}`],
  [{ type: 'prophesy', seat: 0, from: 'cache', index: 0 } as Action,
    `prophesy|cache|0:${entry('Oracle of Foretelling', 5)}|-1c:${entry('Oracle of Foretelling', 5)}`],
  [{ type: 'playCard', seat: 0, handIndex: 0 } as Action,
    'playCard|0:"Slag Spewer"|-|-1h:Slag Spewer'],
];

test('card stats: a refs-only game counts cached plays and augments, grafts and prophecies from the cache (fix 8b88225)', () => {
  const file: LedgerFile = {
    seed: 1, mode: 'shared', names: ['A', 'B'],
    actions: LOG.map(([a]) => a), refs: LOG.map(([, r]) => r),
  };
  const { ledger, audit } = ledgerForFile(file);
  assert.equal(audit.source, 'refs', `the fixture must be read from the refs alone (${audit.why})`);
  const me = ledger.seats[0];
  assert.equal(me.played['Slag Spewer'], 1, 'control: a play from the hand is counted');
  assert.equal(me.played['Hooba-Lin'], 1, 'a cached play is a play');
  assert.equal(me.played['Gravitational Correction'], 1, 'an augment from the cache is a play');
  assert.equal(me.played['Child of Aether'], 1, 'a graft from the cache is a play');
  assert.equal(me.prophesied['Oracle of Foretelling'], 1, 'a prophecy from the cache is counted as one');
  assert.equal(me.firstTurn['Hooba-Lin'], 1, 'and each carries the turn it was first played on');
});
