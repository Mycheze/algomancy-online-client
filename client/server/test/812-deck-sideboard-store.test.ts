/* THE SIDEBOARD, AT REST — server/collection.ts and the /api/decks routes
 * (docs/22 §4.3, §4.4).
 *
 *  §1 the sideboard is stored, canonicalised and sanitized like `maybe`; an
 *     absent one reads as []; an over-full one is STORED (you are still
 *     cutting) and `ccProblems` says why it cannot be registered
 *  §2 SAVED SWAPS WERE TAKEN OUT (owner, 2026-11-03): a deck stored with
 *     them still loads, the field is dropped on read (so never sent) and is
 *     gone from the store at its next save; a write that sends them stores none
 *  §3 duplicating your own deck copies the sideboard
 *  §4 the API carries it through create, update and import, and a deck
 *     exported as a file imports back with its sideboard
 *  §5 matchDeckForPlay: the collection's own main and side, CC-checked
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, saveAccounts, useAccountsFile } from '../accounts.ts';
import {
  collectionView, createDeck, decksOf, duplicateDeck, matchDeckForPlay, updateDeck,
} from '../collection.ts';
import { deckRoutes } from '../api-decks.ts';
import { buildDeckFile, deckFileText } from '../../ui/deckformat.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

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

test('§2 a deck stored with swaps loads; they are dropped on read and gone at the next save', () => {
  const d = fresh({ sideboard: SIDE });
  // as a 2026-11-02 build stored it
  (reread(d.id) as unknown as Record<string, unknown>)['swaps'] = [{ id: 'p1', name: 'vs. control', out: [MAIN[0]], in: [SIDE[0]] }];
  saveAccounts();
  assert.match(readFileSync(join(root, 'accounts.json'), 'utf8'), /vs\. control/, 'the store holds the old field');
  const v = view(d.id);
  assert.deepEqual(v.sideboard, SIDE, 'the deck loads, sideboard intact');
  assert.ok(!('swaps' in v), 'and its swaps are not sent');
  assert.ok(!('swaps' in reread(d.id)));
  updateDeck(me, d.id, { name: 'resaved' });
  assert.doesNotMatch(readFileSync(join(root, 'accounts.json'), 'utf8'), /vs\. control/, 'gone from the store at its next save');
  // a client that still sends them stores nothing
  updateDeck(me, d.id, { swaps: [{ id: 'p2', name: 'late', out: [MAIN[0]], in: [SIDE[0]] }] } as never);
  assert.ok(!('swaps' in reread(d.id)));
  const c = createDeck(me, { name: 'with swaps', cards: MAIN, sideboard: SIDE, swaps: [{ id: 'x', name: 'y', out: [], in: [] }] } as never);
  assert.ok(c.ok && !('swaps' in c.deck));
});

test('§3 duplicating your own deck copies the sideboard', () => {
  const d = fresh({ sideboard: SIDE });
  const r = duplicateDeck(me, d.id);
  assert.ok(r.ok);
  assert.deepEqual(r.deck.sideboard, SIDE);
  assert.ok(!('swaps' in r.deck));
});

test('§4 the API carries the sideboard, and a file export imports back with it', async () => {
  const c = await post('/api/decks/create', { name: 'api', cards: MAIN, sideboard: SIDE,
    swaps: [{ id: 'a', name: 'first', out: [MAIN[0]], in: [SIDE[0]] }] });
  assert.equal(c['ok'], true);
  const id = String(c['id']);
  assert.deepEqual(reread(id).sideboard, SIDE);
  assert.ok(!('swaps' in reread(id)), 'an old client\'s swaps are not stored');
  const u = await post('/api/decks/update', { id, sideboard: SIDE.slice(0, 5) });
  assert.equal(u['ok'], true);
  assert.deepEqual(reread(id).sideboard, SIDE.slice(0, 5));
  // a rename alone leaves it
  await post('/api/decks/update', { id, name: 'renamed' });
  assert.equal(reread(id).sideboard!.length, 5);
  // export (the owner's export panel builds the file from their view) and import
  const text = deckFileText(buildDeckFile(view(id)));
  const imp = await post('/api/decks/import', { text });
  assert.equal(imp['ok'], true, String(imp['error'] ?? ''));
  const back = reread(String(imp['id']));
  assert.deepEqual([...back.cards].sort(), [...MAIN].sort());
  assert.deepEqual([...back.sideboard!].sort(), SIDE.slice(0, 5).sort());
});

test('§5 matchDeckForPlay returns the stored main and side only when CC-legal', () => {
  const d = fresh({ sideboard: SIDE });
  const m = matchDeckForPlay(me.id, d.id);
  assert.ok(m);
  assert.deepEqual(m.main, MAIN);
  assert.deepEqual(m.side, SIDE);
  assert.deepEqual(Object.keys(m).sort(), ['id', 'main', 'side'], 'the lists and the id — nothing else');
  updateDeck(me, d.id, { sideboard: [...SIDE, POOL[40]!] });
  assert.equal(matchDeckForPlay(me.id, d.id), null, 'eight in the sideboard is not registrable');
  assert.equal(matchDeckForPlay(null, d.id), null);
  assert.equal(matchDeckForPlay(me.id, 'no such deck'), null);
});
