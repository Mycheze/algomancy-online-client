/* THE SIDEBOARD AND THE SWAPS, AT REST — server/collection.ts and the
 * /api/decks routes (docs/22 §4.3, §4.4, §4.6).
 *
 *  §1 the sideboard is stored, canonicalised and sanitized like `maybe`; an
 *     absent one reads as []; an over-full one is STORED (you are still
 *     cutting) and `ccProblems` says why it cannot be registered
 *  §2 swaps: caps, ids, names canonical, a card in neither board dropped —
 *     and a preset is NEVER made valid; a later deck edit leaves it stale
 *  §3 duplicating your own deck copies the sideboard and the swaps
 *  §4 the API carries both through create, update and import, and a deck
 *     exported as a file imports back with its sideboard and swaps
 *  §5 matchDeckForPlay: the collection's own main and side, CC-checked
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, useAccountsFile } from '../accounts.ts';
import {
  collectionView, createDeck, decksOf, duplicateDeck, matchDeckForPlay, updateDeck,
} from '../collection.ts';
import { deckRoutes } from '../api-decks.ts';
import { buildDeckFile, deckFileText } from '../../ui/deckformat.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { PRESETS_MAX } from '../../engine/src/matchdeck.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-812-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  deckRoutes(req, res, url.pathname).then(handled => {
    if (!handled) { res.writeHead(404); res.end(); }
  }, err => { res.writeHead(500); res.end(String(err)); });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>(r => server.close(() => r()));
  restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

const made = register('Sideboarder', 'a good password');
if (!made.ok) throw new Error(made.error);
const me = made.account;
const TOKEN = made.token;

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

const POOL = DECK_LIST.filter(n => n !== 'Counter Thief');
const MAIN = POOL.slice(0, 30);
const SIDE = POOL.slice(30, 37);
const reread = (id: string) => decksOf(me).find(d => d.id === id)!;
const view = (id: string) => collectionView(me).find(d => d.id === id)!;
function fresh(init: Record<string, unknown> = {}) {
  const r = createDeck(me, { name: `t ${Math.random()}`, cards: MAIN, ...init });
  if (!r.ok) throw new Error(r.error);
  return r.deck;
}

test('§1 the sideboard is stored canonical, and over seven is stored with a CC problem', () => {
  const d = fresh({ sideboard: [...SIDE.slice(0, 6), 'Counter Theif', 'Not A Card'] });
  assert.deepEqual(reread(d.id).sideboard, [...SIDE.slice(0, 6), 'Counter Thief'], 'alias respelled, non-card dropped');
  assert.deepEqual(view(d.id).ccProblems, [], 'a 30 + 7 deck is CC-legal');
  const r = updateDeck(me, d.id, { sideboard: [...SIDE, POOL[40]!] });
  assert.ok(r.ok);
  assert.equal(reread(d.id).sideboard!.length, 8, 'eight is stored: a deck may be illegal while you build');
  assert.match(view(d.id).ccProblems[0] ?? '', /at most 7/);
  assert.deepEqual(view(d.id).problems, [], 'and casual legality does not look at the sideboard');
  const n = updateDeck(me, d.id, { sideboard: ['Not A Card'] });
  assert.ok(n.ok && /Not A Card/.test(n.note ?? ''), 'a dropped sideboard card is reported, not lost silently');
  // an old deck with no field reads as an empty sideboard
  const old = fresh();
  delete (reread(old.id) as { sideboard?: unknown }).sideboard;
  assert.deepEqual(view(old.id).sideboard, []);
  assert.deepEqual(view(old.id).ccProblems, []);
  assert.ok(!('sideboard' in reread(old.id)), 'reading it migrates nothing');
});

test('§2 swaps are sanitized but never made valid, and a later edit leaves them stale', () => {
  const d = fresh({ sideboard: SIDE });
  updateDeck(me, d.id, { swaps: [
    { id: 'p1', name: '  vs. control  ', out: [MAIN[0], MAIN[0], MAIN[1]], in: ['Not A Card', SIDE[0], POOL[50]] },
    { id: 'p1', name: 'x'.repeat(90), out: [], in: [] },
    { id: 'bad id!', name: '', out: 'nope', in: [SIDE[1]] },
  ] });
  const swaps = reread(d.id).swaps!;
  assert.equal(swaps.length, 3);
  assert.deepEqual(swaps[0], { id: 'p1', name: 'vs. control', out: [MAIN[0], MAIN[0], MAIN[1]], in: [SIDE[0]] },
    'a card in neither board is dropped; two of a one-off main card is KEPT as sent');
  assert.notEqual(swaps[1]!.id, 'p1', 'a duplicate id gets a fresh one');
  assert.equal(swaps[1]!.name.length, 40);
  assert.match(swaps[2]!.id, /^[A-Za-z0-9_-]{1,16}$/);
  assert.equal(swaps[2]!.name, 'Swap 3');
  assert.deepEqual(swaps[2]!.out, []);
  // caps
  updateDeck(me, d.id, { swaps: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, name: `n${i}`, out: [], in: [] })) });
  assert.equal(reread(d.id).swaps!.length, PRESETS_MAX);
  // a later deck edit does NOT touch them — the stale preset is the player's
  updateDeck(me, d.id, { swaps: [{ id: 'p1', name: 'keep', out: [MAIN[0]], in: [SIDE[0]] }] });
  updateDeck(me, d.id, { cards: MAIN.slice(1), sideboard: SIDE.slice(1) });
  assert.deepEqual(reread(d.id).swaps, [{ id: 'p1', name: 'keep', out: [MAIN[0]], in: [SIDE[0]] }]);
  // null and [] clear them, to ABSENT
  updateDeck(me, d.id, { swaps: null });
  assert.ok(!('swaps' in reread(d.id)));
});

test('§3 duplicating your own deck copies the sideboard and the swaps', () => {
  const d = fresh({ sideboard: SIDE });
  updateDeck(me, d.id, { swaps: [{ id: 'p1', name: 'mine', out: [MAIN[0]], in: [SIDE[0]] }] });
  const r = duplicateDeck(me, d.id);
  assert.ok(r.ok);
  assert.deepEqual(r.deck.sideboard, SIDE);
  assert.deepEqual(r.deck.swaps, [{ id: 'p1', name: 'mine', out: [MAIN[0]], in: [SIDE[0]] }]);
  assert.notEqual(r.deck.swaps, reread(d.id).swaps, 'a copy, not a shared array');
});

test('§4 the API carries the sideboard and swaps, and a file export imports back with both', async () => {
  const c = await post('/api/decks/create', { name: 'api', cards: MAIN, sideboard: SIDE,
    swaps: [{ id: 'a', name: 'first', out: [MAIN[0]], in: [SIDE[0]] }] });
  assert.equal(c['ok'], true);
  const id = String(c['id']);
  assert.deepEqual(reread(id).sideboard, SIDE);
  const u = await post('/api/decks/update', { id, sideboard: SIDE.slice(0, 5),
    swaps: [{ id: 'b', name: 'second', out: [MAIN[1], MAIN[2]], in: [SIDE[1]] }] });
  assert.equal(u['ok'], true);
  assert.deepEqual(reread(id).sideboard, SIDE.slice(0, 5));
  assert.deepEqual(reread(id).swaps, [{ id: 'b', name: 'second', out: [MAIN[1], MAIN[2]], in: [SIDE[1]] }]);
  // a rename alone leaves both
  await post('/api/decks/update', { id, name: 'renamed' });
  assert.equal(reread(id).sideboard!.length, 5);
  assert.equal(reread(id).swaps!.length, 1);
  // export (the owner's export panel builds the file from their view) and import
  const text = deckFileText(buildDeckFile(view(id)));
  const imp = await post('/api/decks/import', { text });
  assert.equal(imp['ok'], true, String(imp['error'] ?? ''));
  const back = reread(String(imp['id']));
  assert.deepEqual([...back.cards].sort(), [...MAIN].sort());
  assert.deepEqual([...back.sideboard!].sort(), SIDE.slice(0, 5).sort());
  assert.equal(back.swaps?.length, 1);
  assert.equal(back.swaps![0]!.name, 'second');
  assert.deepEqual([...back.swaps![0]!.out].sort(), [MAIN[1], MAIN[2]].sort());
  assert.deepEqual(back.swaps![0]!.in, [SIDE[1]]);
});

test('§5 matchDeckForPlay returns the stored main and side only when CC-legal', () => {
  const d = fresh({ sideboard: SIDE });
  updateDeck(me, d.id, { swaps: [{ id: 'p1', name: 'mine', out: [MAIN[0]], in: [SIDE[0]] }] });
  const m = matchDeckForPlay(me.id, d.id);
  assert.ok(m);
  assert.deepEqual(m.main, MAIN);
  assert.deepEqual(m.side, SIDE);
  assert.equal(m.presets.length, 1);
  updateDeck(me, d.id, { sideboard: [...SIDE, POOL[40]!] });
  assert.equal(matchDeckForPlay(me.id, d.id), null, 'eight in the sideboard is not registrable');
  assert.equal(matchDeckForPlay(null, d.id), null);
  assert.equal(matchDeckForPlay(me.id, 'no such deck'), null);
});
