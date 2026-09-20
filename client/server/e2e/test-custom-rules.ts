/* BL-43 — custom rules on a live draft, on the server (run: node test-custom-rules.ts).
 *
 * Two halves, same style as test-lobby.ts:
 *   1. In-process: every deal site passes the deal; a reservation carries the
 *      rules and a join cannot override them; a rematch copies them; the
 *      matchmaker never makes a custom room; the forensic replay deals the
 *      custom game and the historical probe refuses it; the stats folds skip
 *      a custom game while the history keeps it.
 *   2. Integration: the real server. POST /api/new refuses rules it cannot
 *      play, deals packs of 5 for the beginner preset, keeps the rules across a
 *      restart, refuses to restore a file whose rules it cannot read, and runs
 *      a two-element lobby.
 *
 * The property that matters most is the restart: live rooms are replayed onto
 * the server on every deploy, and a custom room re-dealt as a standard game
 * under its own log would be a game nobody played.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-custom-test-'));
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;
mkdirSync(GAMES, { recursive: true });

const {
  applyToRoom, createMatch, createRematch, createRoom, joinableRoom, reserveRoomCode, resolveLobby, roomElementCount,
} = await import('../rooms.ts');
const { BEGINNER_RULES, STANDARD_RULES, checkCustomRules } = await import('../../ui/customrules.ts');
const { analyze } = await import('../replay-room.ts');
const { probe } = await import('../replay-probe.ts');
const { matchLengths, recordLiveGame } = await import('../history.ts');
const { accountById, gameHistory, recentGames, register } = await import('../accounts.ts');
const { isRated } = await import('../rating.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const SRC = (f: string): string => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

/** every call `name(...)` in `src` that is code, not a comment or the definition */
function callsOf(src: string, name: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    const start = m.index!;
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const before = src.slice(lineStart, start);
    if (/^\s*(\*|\/\/|\/\*)/.test(before) || /function\s+$/.test(before) || /`[^`]*$/.test(before)) continue;
    let depth = 0, i = start + name.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

// ── 1. every deal site passes the deal ────────────────────────────────

console.log('\n[BL-43: every re-deal passes the custom deal]');
{
  const rooms = SRC('rooms.ts');
  const fresh = callsOf(rooms, 'fresh');
  const rebuild = callsOf(rooms, 'rebuild');
  ok(fresh.length >= 7 && rebuild.length >= 2, `non-vacuous: ${fresh.length} fresh() and ${rebuild.length} rebuild() calls found in rooms.ts`);
  for (const call of [...fresh, ...rebuild]) ok(/\bdeal\b/.test(call), `rooms.ts passes the deal: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
  for (const file of ['stats.ts', 'replay-room.ts']) {
    const calls = callsOf(SRC(file), 'dealScenario');
    ok(calls.length >= 1, `non-vacuous: ${file} deals`);
    for (const call of calls) ok(/deal/.test(call.replace('dealScenario(', '')), `${file} passes the deal: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
}

// ── 2. the reservation carries the rules, the join cannot ─────────────

const verdict = checkCustomRules(BEGINNER_RULES, ['fire', 'wood']);
ok(!verdict.error && verdict.rules && verdict.deal, 'the beginner rules resolve with fire + wood fixed');
const CUSTOM = { rules: verdict.rules!, deal: verdict.deal! };

console.log('\n[BL-43: a reservation brings its rules; a join cannot change them]');
const fixedRoom = (() => {
  reserveRoomCode('CUSA', CUSTOM, ['fire', 'wood']);
  const room = joinableRoom('CUSA', 'draft', ['water', 'earth', 'dark'], undefined, null)!;
  eq(room.els, ['fire', 'wood'], 'the reserved elements, not the join message ones');
  eq(room.state.packs[0]!.length, 5, 'packs of 5');
  ok(room.custom && room.custom.deal.packSize === 5, 'the room keeps its custom rules');
  ok(room.lobby === null, 'fixed elements skip the lobby');

  reserveRoomCode('CUSB', CUSTOM);
  const shared = joinableRoom('CUSB', 'shared')!;
  ok(!shared.custom && !shared.state.draftDeal, 'a non-draft join plays standard even from a custom reservation');

  reserveRoomCode('CUSC', CUSTOM);
  const lobbied = joinableRoom('CUSC', 'draft')!;
  ok(!!lobbied.lobby, 'a custom draft without fixed elements opens the lobby');
  eq(roomElementCount(lobbied), 2, 'choosing two elements');

  reserveRoomCode('CUSD');
  const plain = joinableRoom('CUSD', 'draft', ['water', 'earth', 'dark'], undefined, null)!;
  ok(!plain.custom, 'a plain reservation makes a standard room');
  eq(plain.state.packs[0]!.length, 10, 'with packs of 10');

  const sharedWithRules = createRoom('CUSG', 1, undefined, 'shared', undefined, undefined, undefined, null, CUSTOM);
  ok(!sharedWithRules.custom, 'createRoom drops custom rules outside a live draft');
  return room;
})();

// ── 3. rematch and matchmaker ─────────────────────────────────────────

console.log('\n[BL-43: a rematch keeps the rules; the matchmaker never makes them]');
{
  const again = createRematch(fixedRoom, 'CUSE');
  eq(again.custom, fixedRoom.custom, 'the rematch carries the same resolved deal');
  eq(again.lobby?.previousTrio, ['fire', 'wood'], 'and offers to run back the pair');
  again.lobby!.locked = [true, true];
  resolveLobby(again, []);
  eq(again.els, ['fire', 'wood'], 'running it back replays the pair');
  eq(again.state.packs[1]!.length, 5, 'with packs of 5');

  const match = createMatch({ userId: 'u1', username: 'Ann' }, { userId: 'u2', username: 'Bob' }, 'draft', 'CUSF');
  ok(!match.custom, 'a matchmade draft is never custom');
}

// ── 4. forensics ──────────────────────────────────────────────────────

console.log('\n[BL-43: replay-room deals the custom game; the historical probe refuses it]');
{
  applyToRoom(fixedRoom, { type: 'draftCommit', seat: 0, packIndices: [6, 7, 8, 9, 10] });
  applyToRoom(fixedRoom, { type: 'draftCommit', seat: 1, packIndices: [6, 7, 8, 9, 10] });
  const raw = JSON.parse(readFileSync(join(GAMES, 'CUSA.json'), 'utf8'));
  ok(raw.custom?.deal?.packSize === 5 && raw.custom?.rules?.simpleOnly === true, 'the saved file carries the rules and the deal');
  const an = analyze(raw);
  ok(an.divergedAt === null && an.refusals.length === 0, 'the replay of a custom game is faithful');
  eq(an.state.packs, fixedRoom.state.packs, 'and reaches the same packs');
  const { custom: _dropped, ...bare } = raw;
  ok(JSON.stringify(analyze(bare).state.packs) !== JSON.stringify(fixedRoom.state.packs), 'control: the same log without its rules is a different game');
  let threw = '';
  try { analyze({ ...raw, custom: { deal: 'garbage' } }); } catch (err) { threw = String(err); }
  ok(/custom rules/.test(threw), 'a file naming rules this build cannot read is refused');
  const probed = await probe({ seed: raw.seed, mode: raw.mode, els: raw.els, actions: raw.actions, custom: raw.custom } as never);
  ok(!probed.ok && /custom rules/.test(probed.error ?? ''), 'replay-probe refuses a custom game');
}

// ── 5. the stats ──────────────────────────────────────────────────────

console.log('\n[BL-43: recorded and tagged, counted nowhere]');
{
  const reg = register('customtester', 'a long enough password 42');
  ok(reg.ok, 'an account to record against');
  const id = reg.ok ? reg.account.id : '';
  const game = {
    seed: fixedRoom.seed, mode: 'draft' as const, els: fixedRoom.els, names: ['customtester', 'Other'] as [string, string],
    users: [id, null] as [string | null, string | null], winner: 0 as const, actions: fixedRoom.actions,
    decks: undefined, matchMs: 600_000,
  };
  recordLiveGame({ ...game, code: 'CUSH', custom: CUSTOM });
  const row = gameHistory().find(g => g.code === 'CUSH');
  ok(!!row, 'the custom game is in the history');
  eq(row?.custom, CUSTOM.rules, 'tagged with its rules');
  eq(accountById(id)?.profile.games, 0, 'and counted in no profile total');

  recordLiveGame({ ...game, code: 'CUSI', seed: 5, els: ['fire', 'water', 'earth'], actions: [] });
  eq(accountById(id)?.profile.games, 1, 'control: a standard game counts');
  const mine = recentGames(id);
  eq(mine.find(g => g.code === 'CUSH')?.custom, ['2 elements', 'Packs of 5', 'Simple cards only'], 'the match history row lists the rules');
  ok(!mine.find(g => g.code === 'CUSI')?.custom, 'and a standard row lists none');
  eq(matchLengths(gameHistory().filter(g => g.code === 'CUSH' || g.code === 'CUSI')).n, 1, 'the average game length skips the custom game');

  const ratable = { code: 'X', playedAt: '2026-09-14', mode: 'draft' as const, finished: true, winner: 0 as const, users: ['a', 'b'] as [string, string], rated: true };
  ok(isRated(ratable), 'control: a finished matchmade game between two accounts is rated');
  ok(!isRated({ ...ratable, custom: CUSTOM.rules }), 'the same game with custom rules is not');
}

// ── 6. the real server ────────────────────────────────────────────────

console.log('\n[BL-43: the server end to end]');

interface Msg { t: string; view?: any; waiting?: any; trio?: any; custom?: any; msg?: string; log?: string[] }

let server = await spawnServer();
let PORT = server.port;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  constructor() { this.ws = new WebSocket(`ws://localhost:${PORT}`); }
  open(): Promise<void> {
    return new Promise(res => {
      this.ws.addEventListener('message', ev => this.msgs.push(JSON.parse(String((ev as MessageEvent).data))));
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m.t === t); }
  async settle(ms = 400): Promise<void> { await new Promise(r => setTimeout(r, ms)); }
}

async function newRoom(body?: unknown): Promise<{ status: number; json: { code?: string; error?: string } }> {
  const r = body === undefined
    ? await fetch(`http://localhost:${PORT}/api/new`)
    : await fetch(`http://localhost:${PORT}/api/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() as { code?: string; error?: string } };
}

try {
  // refusals, before any room exists
  const tight = await newRoom({ rules: { ...STANDARD_RULES, elements: 2, simpleOnly: true } });
  eq(tight.status, 400, 'too small a pool is refused');
  ok(/Choose the elements now/.test(tight.json.error ?? ''), 'with the fix in the message');
  const guessed = await newRoom({ rules: { ...STANDARD_RULES, query: '(fire' } });
  ok(guessed.status === 400 && /^Card filter:/.test(guessed.json.error ?? ''), 'a card filter the parser guessed at is refused');

  const standard = await newRoom({ rules: STANDARD_RULES });
  eq(standard.status, 200, 'untouched rules make a room');
  const s = new Client(); await s.open();
  s.send({ t: 'join', room: standard.json.code, seat: 0, name: 'Std', mode: 'draft' });
  await s.settle();
  ok(s.last('joined')?.waiting?.trio?.count === 3 && !s.last('joined')?.waiting?.custom, 'and it is a standard three-element lobby');
  s.ws.close();

  // the beginner preset, elements fixed
  const beginner = await newRoom({ rules: BEGINNER_RULES, els: ['wood', 'fire'] });
  const room = beginner.json.code!;
  const a = new Client(); await a.open();
  a.send({ t: 'join', room, seat: 0, name: 'Ann', mode: 'draft', els: ['water', 'earth', 'dark'] });
  await a.settle();
  const joined = a.last('joined')!;
  eq(joined.view?.packs?.[0]?.length, 5, 'the beginner room deals packs of 5');
  eq(joined.view?.elements, ['fire', 'wood'], 'with the fixed elements, not the ones the join sent');
  ok(joined.custom?.summary?.includes('Simple cards only'), 'both the rules and their summary reach the seat');
  ok(joined.log?.some(l => l.startsWith('Custom rules:')), 'and the game log says so');

  const b = new Client(); await b.open();
  b.send({ t: 'join', room, seat: 1, name: 'Bob', mode: 'draft' });
  await b.settle();
  ok(b.last('joined')?.custom?.summary?.includes('Packs of 5'), 'the second seat sees the rules too');

  a.send({ t: 'action', action: { type: 'draftCommit', seat: 0, packIndices: [6, 7, 8, 9, 10] } });
  b.send({ t: 'action', action: { type: 'draftCommit', seat: 1, packIndices: [6, 7, 8, 9, 10] } });
  await a.settle(700);
  const before = a.last('update')?.view ?? a.last('joined')?.view;
  const saved = JSON.parse(readFileSync(join(GAMES, `${room}.json`), 'utf8'));
  ok(saved.custom?.deal?.packSize === 5, 'the room file carries the deal');
  a.ws.close(); b.ws.close();

  // a file whose rules this build cannot read
  writeFileSync(join(GAMES, 'BADC.json'), JSON.stringify({ ...saved, custom: { rules: saved.custom.rules, deal: 'garbage' } }));

  // restart
  await server.stop();
  server = await spawnServer();
  PORT = server.port;
  const back = new Client(); await back.open();
  back.send({ t: 'join', room, seat: 0, name: 'Ann', mode: 'draft' });
  await back.settle(700);
  const after = back.last('joined')?.view;
  eq(after?.players?.[0]?.hand, before?.players?.[0]?.hand, 'after a restart the hand is the same');
  eq(after?.packs?.[0]?.length ?? 0, before?.packs?.[0]?.length ?? 0, 'and so is the pack');
  ok(back.last('joined')?.custom?.summary?.includes('Packs of 5'), 'and the rules came back with the room');
  back.send({ t: 'join', room: 'BADC', seat: 0, name: 'Ann', mode: 'draft' });
  await back.settle();
  ok(/No game with code BADC/.test(back.last('error')?.msg ?? ''), 'a room whose rules cannot be read is not restored as a standard game');
  back.ws.close();

  // a two-element lobby
  const pair = await newRoom({ rules: { ...STANDARD_RULES, elements: 2, packSize: 5 } });
  eq(pair.status, 200, 'two elements with packs of 5 clears the floor for every pair');
  const p = new Client(); await p.open();
  p.send({ t: 'join', room: pair.json.code, seat: 0, name: 'Ann', mode: 'draft' });
  await p.settle();
  eq(p.last('joined')?.waiting?.trio?.count, 2, 'the lobby is choosing two elements');
  ok(p.last('joined')?.waiting?.custom?.summary?.includes('2 elements'), 'and shows the rules before the deal');
  const q = new Client(); await q.open();
  q.send({ t: 'join', room: pair.json.code, seat: 1, name: 'Bob', mode: 'draft' });
  await q.settle();
  p.send({ t: 'lobby', submission: { element: 'dark' }, lock: true });
  q.send({ t: 'lobby', submission: { element: 'fire' }, lock: true });
  await p.settle(700);
  eq(p.last('joined')?.trio?.els, ['fire', 'dark'], 'the two picks are the pair');
  eq(p.last('joined')?.view?.packs?.[0]?.length, 5, 'and the pair is dealt packs of 5');
  p.ws.close(); q.ws.close();
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
