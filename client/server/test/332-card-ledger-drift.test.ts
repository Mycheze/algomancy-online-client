/* CARD STATS §3 — THE LADDER, AND THE DRIFT IT EXISTS FOR.
 *
 * `ledgerForFile` reads a saved game's card facts from the best source the
 * file has (cardledger.ts header). The failure it guards against is silent:
 * a DRAFT deal is a function of the card registry, so once a card is added a
 * replay of an old draft deals different packs and hands and refuses nothing.
 * Changing the file's `seed` is the cheapest faithful stand-in for that — the
 * log is untouched and the deal underneath it is a different one.
 *
 *   (a) a recorded ledger does not move when the deal underneath it does
 *   (b) a file with fingerprints but no card log replays, VERIFIES, and gives
 *       the same ledger the game recorded
 *   (c) with the deal moved and no card log, the replay is caught at action
 *       0 and the refs are read instead — every fact about what the actor DID
 *       is still exact; the hands and draws are honestly marked unknown
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action } from '../../engine/src/types.ts';
import { ledgerForFile, type GameLedger, type LedgerFile, type SeatLedger } from '../cardledger.ts';

async function playedFile(code: string, seed: number, steps: number, rngSeed: number): Promise<LedgerFile> {
  const dir = mkdtempSync(join(tmpdir(), 'cardlog-drift-'));
  try {
    process.env['ALGO_GAMES_DIR'] = dir;
    const mod = await import(`../rooms.ts?drift=${Math.random()}`) as typeof import('../rooms.ts');
    const room = mod.createRoom(code, seed, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    let x = rngSeed;
    const rnd = (k: number): number => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % k; };
    for (let i = 0; i < steps && room.state.winner === null; i++) {
      const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)]
        .filter(a => a.type !== 'concede');
      if (!legal.length) break;
      // a uniform pick recycles every card it holds and never plays one, so
      // playing is weighted up and recycling down — a game that tests nothing
      // about plays would pass every assertion about them
      const weighted = legal.flatMap(a => Array<Action>(WEIGHT[a.type] ?? 2).fill(a));
      mod.applyToRoom(room, weighted[rnd(weighted.length)]!);
    }
    return JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as LedgerFile;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const WEIGHT: Partial<Record<Action['type'], number>> = { playCard: 12, augment: 6, graft: 6, recycleForResource: 1 };

const strip = (f: LedgerFile): LedgerFile => { const c = structuredClone(f); delete c.cardLog; delete c.cardOpen; return c; };
const actorFacts = (s: SeatLedger) => ({
  played: s.played, firstTurn: s.firstTurn, recycled: s.recycled, bottomed: s.bottomed,
  picked: s.picked, given: s.given, offered: s.offered, pickPos: s.pickPos, elements: s.elements,
});
const total = (l: GameLedger, k: keyof SeatLedger): number =>
  l.seats.reduce((n, s) => n + Object.values(s[k] as Record<string, number>).reduce((a, b) => a + b, 0), 0);

test('card stats drift (a) a recorded ledger does not move when the deal underneath it does', async () => {
  const file = await playedFile('DR1', 2024, 160, 21);
  const live = ledgerForFile(file).ledger;
  assert.equal(live.source, 'live');
  assert.ok(total(live, 'picked') > 0 && total(live, 'played') > 0, 'the game never took or played a card — untested');
  const moved = { ...file, seed: file.seed + 1 };
  assert.deepEqual(ledgerForFile(moved).ledger, live,
    'the ledger was re-derived from the file\'s seed. For an old draft that reads the hands of a reshuffled deal.');
});

test('card stats drift (b) fingerprints and no card log: the replay verifies and agrees with the record', async () => {
  const file = await playedFile('DR2', 777, 160, 5);
  const live = ledgerForFile(file).ledger;
  const { ledger, audit } = ledgerForFile(strip(file));
  assert.equal(audit.source, 'replay-sigs', audit.why);
  assert.deepEqual({ ...ledger, source: 'live' }, live, 'a verified replay must be the recorded game, fact for fact');
});

test('card stats drift (c) the deal moved and nothing recorded it: caught at 0, and the refs still say what was DONE', async () => {
  const file = await playedFile('DR3', 31, 200, 99);
  const live = ledgerForFile(file).ledger;
  const { ledger, audit } = ledgerForFile({ ...strip(file), seed: file.seed + 1 });
  assert.equal(audit.source, 'refs', audit.why);
  assert.equal(audit.validUpTo, 0, 'a moved deal is a different game from the very first action');
  assert.equal(ledger.coverage.open, false, 'the opening of a game nobody can replay is not known');
  assert.equal(ledger.coverage.draws, false, 'and neither is every draw — "never saw it" is not a fact here');
  assert.equal(ledger.init, null);
  for (const s of [0, 1] as const) {
    assert.deepEqual(actorFacts(ledger.seats[s]), actorFacts(live.seats[s]),
      `seat ${s}: the refs are written in card names at play time, so what the actor did survives any deal`);
  }
  assert.ok(total(live, 'offered') > 0, 'non-vacuous: packs were offered');
});
