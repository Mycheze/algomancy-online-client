/* 1530 · A SHARED DECK TABLE (server/collab.ts, server/api-collab.ts, docs/26).
 *
 *   §1 a move is replayed through the builder's arithmetic against the session's copy
 *   §2 a move made against a table someone else has since changed is refused, never misapplied
 *   §3 the copy cap holds across everyone's moves
 *   §4 Undo takes back only your own change, and only where nobody has touched it since; Redo puts it back
 *   §5 what arrives off the wire is checked: a non-card, a strip, a whole-deck `set` are refused
 *   §6 the channel: two people at the table, both see a move, each with their own ack
 *   §7 the host's deck keeps the table; its update route leaves the cards alone meanwhile
 *   §8 the host leaving: the grace clock, coming back inside it, and the end when it runs out
 *   §9 the host removes someone, who cannot come back; only the host may
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import {
  move, newSession, parseCarry, parsePlace, step, tableOf, type Session,
} from '../collab.ts';

const units = DECK_LIST.filter(n => getCard(n).kind === 'unit');
const [A, B, C] = [units[0]!, units[1]!, units[2]!];

function session(cards: string[]): Session {
  return newSession('TESTCODE01', { id: 'h', name: 'Host' }, 'deck1', tableOf({ cards }));
}
const where = (s: Session, name: string): string[] =>
  s.table.piles.flatMap(p => p.cards.map((c, i) => (c === name ? `${p.id}#${i}` : ''))).filter(Boolean);

test('§1 a move is replayed against the session’s copy', () => {
  const s = session([A, B]);
  const before = s.version;
  const r = move(s, 'h', { from: 'binder', name: C }, { at: 'auto' });
  assert.deepEqual(r, { ok: true });
  assert.ok(s.table.cards.includes(C), 'the card is in the deck');
  assert.equal(s.table.piles.flatMap(p => p.cards).length, 3, 'and on the table');
  assert.equal(s.version, before + 1);
  const p = s.table.piles[0]!;
  const r2 = move(s, 'g', { from: 'pile', pile: p.id, index: 0, name: p.cards[0]! }, { at: 'maybe' });
  assert.deepEqual(r2, { ok: true });
  assert.equal(s.table.maybe.length, 1, 'to Maybe: out of the deck, onto the shelf');
  assert.equal(s.table.cards.length, 2);
});

test('§2 a stale move is refused, not applied to another card', () => {
  const s = session([A, B]);
  const p = s.table.piles.find(x => x.cards.includes(A))!;
  const i = p.cards.indexOf(A);
  // two people grab the same copy; the first wins
  assert.deepEqual(move(s, 'h', { from: 'pile', pile: p.id, index: i, name: A }, { at: 'side' }), { ok: true });
  const r = move(s, 'g', { from: 'pile', pile: p.id, index: i, name: A }, { at: 'maybe' });
  assert.equal(r.ok, false, 'the second finds nothing there');
  assert.deepEqual(s.table.side, [A]);
  assert.deepEqual(s.table.maybe, [], 'and nothing else moved');
});

test('§3 the copy cap holds across everyone', () => {
  const s = session([A]);
  assert.deepEqual(move(s, 'h', { from: 'binder', name: A }, { at: 'auto' }), { ok: true });
  const r = move(s, 'g', { from: 'binder', name: A }, { at: 'auto' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.note, /Max 2 of/);
});

test('§4 Undo is your own, and only where nobody has touched it since', () => {
  const s = session([A, B, C]);
  // the host sends A to the sideboard; a guest sends B to Maybe
  const pa = s.table.piles.find(x => x.cards.includes(A))!;
  move(s, 'h', { from: 'pile', pile: pa.id, index: pa.cards.indexOf(A), name: A }, { at: 'side' });
  const pb = s.table.piles.find(x => x.cards.includes(B))!;
  move(s, 'g', { from: 'pile', pile: pb.id, index: pb.cards.indexOf(B), name: B }, { at: 'maybe' });
  // the guest's own Undo brings B back; the host's A stays in the sideboard
  assert.deepEqual(step(s, 'g', 'undo'), { ok: true });
  assert.deepEqual(s.table.maybe, []);
  assert.ok(s.table.cards.includes(B), 'B is back in the deck');
  assert.deepEqual(s.table.side, [A], 'the host’s change is untouched');
  assert.equal(where(s, B).length, 1, 'and on the table once');
  // Redo puts it back
  assert.deepEqual(step(s, 'g', 'redo'), { ok: true });
  assert.deepEqual(s.table.maybe, [B]);
  // the host's change, built on by someone else, can no longer be undone
  move(s, 'g', { from: 'side', index: 0, name: A }, { at: 'maybe' });
  const r = step(s, 'h', 'undo');
  assert.equal(r.ok, false, 'the sideboard has moved on');
  assert.deepEqual(s.table.maybe, [B, A], 'and nothing changed');
  assert.equal(step(s, 'nobody', 'undo').ok, false, 'nothing of yours to undo');
});

test('§5 the wire is checked', () => {
  assert.equal(parseCarry({ from: 'binder', name: 'Not A Card' }), null);
  assert.equal(parseCarry({ from: 'strip', index: 0, name: A }), null, 'a deck has no strip');
  assert.equal(parseCarry({ from: 'pile', pile: '../x', index: 0, name: A }), null);
  assert.equal(parseCarry({ from: 'pile', pile: 'p1', index: -1, name: A }), null);
  assert.deepEqual(parseCarry({ from: 'pile', pile: 'p1', index: 2, name: A }), { from: 'pile', pile: 'p1', index: 2, name: A });
  assert.equal(parsePlace({ at: 'arrange', edit: { op: 'set', cards: [A] } }), null, 'no whole-deck replace');
  assert.equal(parsePlace({ at: 'arrange', edit: { op: 'undo' } }), null, 'Undo is `step`, not a move');
  assert.equal(parsePlace({ at: 'strip' }), null);
  assert.deepEqual(parsePlace({ at: 'arrange', edit: { op: 'resort', by: 'type' } }), { at: 'arrange', edit: { op: 'resort', by: 'type' } });
  assert.equal(parsePlace({ at: 'arrange', edit: { op: 'resort', by: 'rarity' } }), null);
});

// ── the channel, over fake sockets and a throwaway account store ──

interface Fake { readyState: number; OPEN: number; got: Record<string, unknown>[]; send(s: string): void }
const sock = (): Fake => ({ readyState: 1, OPEN: 1, got: [], send(s) { this.got.push(JSON.parse(s)); } });
const last = (w: Fake, key: string): Record<string, unknown> | undefined => [...w.got].reverse().find(m => key in m);

async function channel() {
  const dir = mkdtempSync(join(tmpdir(), 'collab-'));
  const Acc = await import('../accounts.ts');
  const restore = Acc.useAccountsFile(join(dir, 'accounts.json'));
  const Col = await import('../collection.ts');
  const API = await import('../api-collab.ts');
  API.resetCollab();
  const reg = (u: string) => {
    const r = Acc.register(u, 'correct horse battery');
    if (!r.ok) throw new Error(r.error);
    return { acct: r.account!, token: r.token! };
  };
  const host = reg(`Host${Math.floor(Math.random() * 1e6)}`);
  const guest = reg(`Guest${Math.floor(Math.random() * 1e6)}`);
  const deck = Col.decksOf(host.acct)[0]!;
  // start, through the route's own function: a POST the test drives by hand
  const res = { code: 0, body: '' };
  const fakeRes = { writeHead(c: number) { res.code = c; return this; }, setHeader() {}, end(b: string) { res.body = b; } };
  const { Readable } = await import('node:stream');
  const req = Object.assign(Readable.from([JSON.stringify({ deck: deck.id })]), {
    method: 'POST', headers: { authorization: `Bearer ${host.token}` }, socket: { remoteAddress: '127.0.0.1' },
  });
  await API.collabRoutes(req as never, fakeRes as never, '/api/collab/start');
  const code = JSON.parse(res.body).code as string;
  assert.ok(code, `started: ${res.body}`);
  const sub = (w: Fake, token: string) => API.collabSocketMessage(w as never, { t: 'collab', op: 'sub', code, token } as never);
  const say = (w: Fake, m: Record<string, unknown>) => API.collabSocketMessage(w as never, { t: 'collab', ...m } as never);
  const done = () => { API.resetCollab(); restore(); rmSync(dir, { recursive: true, force: true }); };
  return { API, Col, host, guest, deck, code, sub, say, done };
}

test('§6 two at the table both see a move, each with their own ack', async () => {
  const T = await channel();
  try {
    const h = sock(), g = sock();
    T.sub(h, T.host.token);
    T.sub(g, T.guest.token);
    const v = last(g, 'view')!['view'] as { piles: { id: string; cards: string[] }[]; members: { here: boolean }[] };
    assert.equal(v.members.filter(m => m.here).length, 2, 'both are here');
    const p = v.piles[0]!;
    T.say(g, { op: 'move', seq: 1, carry: { from: 'pile', pile: p.id, index: 0, name: p.cards[0] }, to: { at: 'maybe' } });
    const hv = last(h, 'view')!['view'] as { maybe: string[]; ack: number };
    const gv = last(g, 'view')!['view'] as { maybe: string[]; ack: number };
    assert.deepEqual(hv.maybe, [p.cards[0]], 'the host sees it');
    assert.equal(gv.ack, 1, 'the mover’s view acknowledges its move');
    assert.equal(hv.ack, 0, 'the host’s does not');
    // the same seq again is a resend: nothing happens twice
    T.say(g, { op: 'move', seq: 1, carry: { from: 'pile', pile: p.id, index: 0, name: p.cards[1] ?? p.cards[0] }, to: { at: 'maybe' } });
    assert.equal((last(h, 'view')!['view'] as { maybe: string[] }).maybe.length, 1);
    // a stale move: refused to its sender, with the reason
    T.say(g, { op: 'move', seq: 2, carry: { from: 'maybe', index: 5, name: p.cards[0] }, to: { at: 'side' } });
    assert.equal((last(g, 'refused')!['refused'] as { seq: number }).seq, 2);
    // a pointer goes to everyone else, not back
    const before = g.got.length;
    T.say(h, { op: 'cursor', at: { z: 'maybe', x: 0.5, y: 0.5 }, held: null });
    assert.equal(g.got.length, before + 1);
    assert.equal(last(h, 'cursor'), undefined);
  } finally { T.done(); }
});

test('§7 the host’s deck keeps the table, and the deck route leaves it alone meanwhile', async () => {
  const T = await channel();
  try {
    const h = sock();
    T.sub(h, T.host.token);
    assert.equal(T.API.collabOpenOn(T.deck.id), true);
    const v = last(h, 'view')!['view'] as { piles: { id: string; cards: string[] }[] };
    const p = v.piles[0]!;
    T.say(h, { op: 'move', seq: 1, carry: { from: 'pile', pile: p.id, index: 0, name: p.cards[0] }, to: { at: 'side' } });
    T.say(h, { op: 'end' });
    assert.ok(last(h, 'ended'), 'the host’s own tab is told');
    const d = T.Col.decksOf(T.host.acct).find(x => x.id === T.deck.id)!;
    assert.deepEqual(d.sideboard, [p.cards[0]], 'the end saved the table into the deck');
    assert.equal(T.API.collabOpenOn(T.deck.id), false);
  } finally { T.done(); }
});

test('§8 the host leaving: the grace clock, and the end', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const T = await channel();
  try {
    const h = sock(), g = sock();
    T.sub(h, T.host.token);
    T.sub(g, T.guest.token);
    T.API.collabSocketClosed(h as never);
    const v = last(g, 'view')!['view'] as { hostAway: number | null };
    assert.notEqual(v.hostAway, null, 'the guest sees the host is away');
    // back inside the grace: the session goes on
    t.mock.timers.tick(30_000);
    const h2 = sock();
    T.sub(h2, T.host.token);
    t.mock.timers.tick(60_000);
    assert.equal(last(g, 'ended'), undefined, 'still open');
    // gone for good: it ends
    T.API.collabSocketClosed(h2 as never);
    t.mock.timers.tick(60_001);
    assert.match(String(last(g, 'ended')?.['ended']), /host left/);
  } finally { T.done(); }
});

test('§9 the host removes someone, who cannot come back; only the host may', async () => {
  const T = await channel();
  try {
    const h = sock(), g = sock();
    T.sub(h, T.host.token);
    T.sub(g, T.guest.token);
    T.say(g, { op: 'kick', user: T.host.acct.id });
    assert.match(String(last(g, 'error')?.['error']), /Only the host/);
    T.say(h, { op: 'kick', user: T.guest.acct.id });
    assert.match(String(last(g, 'ended')?.['ended']), /removed you/);
    const g2 = sock();
    T.sub(g2, T.guest.token);
    assert.match(String(last(g2, 'ended')?.['ended']), /removed you/, 'the link no longer lets them in');
  } finally { T.done(); }
});
