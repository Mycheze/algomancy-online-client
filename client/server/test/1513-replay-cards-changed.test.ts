/* `GET /api/replay/<CODE>` names the cards in the game that changed since it
 * was played (`cardsChanged`), from the file's first version stamp and the
 * real git history.
 *
 * The game is a single card duel, Murkstalker against Seer of Empty Spaces,
 * stamped at the commit before 26e536f0, which reprinted both of them and The
 * Everywhere. Both duel cards are named; The Everywhere is not in the game and
 * is not. A stamp of `unknown` says "can't tell", and the verdict is still the
 * fingerprints' alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SCRATCH = mkdtempSync(join(tmpdir(), 'cards-changed-'));
const GAMES = join(SCRATCH, 'games');
mkdirSync(GAMES, { recursive: true });
process.env['ALGO_GAMES_DIR'] = GAMES;
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const { register } = await import('../accounts.ts');
const { replayRoutes, resetReplayCache } = await import('../api-replay.ts');
const { repoDir } = await import('../engine-version.ts');

const me = register('alice', 'correct horse battery');
assert.ok(me.ok);
const ALICE = { id: me.account.id, token: me.token };

const PARENT = execFileSync('git', ['-C', repoDir(), 'rev-parse', '26e536f0^'], { encoding: 'utf8' }).trim();

function writeGame(code: string, sha: string): void {
  writeFileSync(join(GAMES, `${code}.json`), JSON.stringify({
    seed: 77, mode: 'constructed', single: true, names: ['alice', 'bob'], users: [ALICE.id, null],
    decks: [Array(30).fill('Murkstalker'), Array(30).fill('Seer of Empty Spaces')],
    actions: [], sigs: [], versions: [{ at: '2026-11-01T10:00:00.000Z', sha, from: 0 }],
  }));
  resetReplayCache();
}

interface Body { ok: boolean; verdict: string; cardsChanged: unknown }

async function get(code: string): Promise<Body> {
  const req = { method: 'GET', headers: { authorization: `Bearer ${ALICE.token}` } } as unknown as IncomingMessage;
  let payload = '';
  const res = {
    writeHead() { return res; }, end(b?: string) { payload = b ?? ''; return res; }, setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  await replayRoutes(req, res, `/api/replay/${code}`, { liveRoom: () => false, playing: () => false });
  return JSON.parse(payload) as Body;
}

test('replay cards changed: a game stamped before a card update names its changed cards', async () => {
  writeGame('OLDC', PARENT);
  const r = await get('OLDC');
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.cardsChanged), `a readable stamp gives a list, got ${JSON.stringify(r.cardsChanged)}`);
  const names = (r.cardsChanged as { card: string }[]).map(c => c.card).sort();
  assert.deepEqual(names, ['Murkstalker', 'Seer of Empty Spaces'],
    'both duel cards were reprinted since; The Everywhere was too, and is not in this game');
  assert.notEqual(r.verdict, 'reconstruction', 'the note does not move the verdict');
});

test('replay cards changed: an unknown stamp says cant-tell', async () => {
  writeGame('UNKC', 'unknown');
  const r = await get('UNKC');
  assert.equal(r.ok, true);
  assert.equal(r.cardsChanged, 'cant-tell');
});

test('replay cards changed: a file with no version stamp says cant-tell', async () => {
  writeGame('NOVC', PARENT);
  const path = join(GAMES, 'NOVC.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  delete raw['versions'];
  writeFileSync(path, JSON.stringify(raw));
  resetReplayCache();
  const r = await get('NOVC');
  assert.equal(r.cardsChanged, 'cant-tell');
});

test('replay cards changed: the cards a file never names are read through its replay', async () => {
  // a game's actions are indices, and its file names only the cards that were
  // seen: the rest of a deck, like a draft's picks, exists only in the replay
  const { createRoom, applyToRoom } = await import('../rooms.ts');
  const { legalActions } = await import('../../engine/src/apply.ts');
  const { analyze } = await import('../replay-room.ts');
  const { stringsIn } = await import('../card-history.ts');
  const room = createRoom('SHRC', 4242, ['alice', 'bob'], 'shared');
  room.users = [ALICE.id, null];
  for (let i = 0; i < 20; i++) {
    const legal = [...legalActions(room.state, 0), ...legalActions(room.state, 1)];
    if (!legal.length || room.state.winner !== null) break;
    applyToRoom(room, legal[0]!);
  }
  const path = join(GAMES, 'SHRC.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  raw['versions'] = [{ at: '2026-11-01T10:00:00.000Z', sha: PARENT, from: 0 }];
  delete raw['live'];   // a finished game keeps no stored state
  writeFileSync(path, JSON.stringify(raw));
  resetReplayCache();

  const r = await get('SHRC');
  assert.ok(Array.isArray(r.cardsChanged));
  const listed = (r.cardsChanged as { card: string; was?: string }[]);
  assert.ok(listed.length > 0, 'a shared deck holds cards reprinted since that commit');
  const inFile = stringsIn(raw);
  const an = analyze(raw as unknown as Parameters<typeof analyze>[0]);
  const inGame = stringsIn(an.state, an.events);
  for (const c of listed) {
    assert.ok(inGame.has(c.card) || (c.was !== undefined && inGame.has(c.was)), `${c.card} is on this table`);
  }
  assert.ok(listed.some(c => !inFile.has(c.card)), 'at least one is named only by the replay (a card still in the deck)');
});
