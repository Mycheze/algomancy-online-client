/* BL-48 — DISPUTE A FINISHED GAME, from the post-game screen.
 *
 * Report #231 (a rated league game): the loser wanted to be able to "concede
 * the win to the opponent after a match — for instance, if you ended up
 * winning due to a bug." The owner, 2026-10-21: "Maybe just a 'dispute game'
 * button right on the final screen, by 'rematch'".
 *
 * A dispute files a report, tags the game and (in a league) flags the match
 * for the organizer. It changes no result, rating or stat.
 *
 *   §1 a dispute files a report row and marks the room; the result stands
 *   §2 refused: no seat, an unfinished game, a second dispute, no note, and
 *      a scenario or test-mode room
 *   §3 the mark survives a restore, and the re-imported history row has it
 *   §4 the match history and the admin games list show the tag
 *   §5 a league match: the organizer sees a line on the match; a player does
 *      not; a later friendly in the same room flags nothing
 *   §6 over the wire: the post-game payload offers it, a spectator is refused,
 *      both seats hear it, a second is refused, and a restart keeps it
 *
 * Seeds 52000-52099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { mintRoom, spawnServer, type ServerHandle } from '../e2e/test-util.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-520-'));
process.env['ALGO_GAMES_DIR'] = join(DIR, 'games');
process.env['ALGO_ISSUES_FILE'] = join(DIR, 'issues.jsonl');
type Rooms = typeof import('../rooms.ts');
const R: Rooms = await import('../rooms.ts');
const A = await import('../accounts.ts');
const L = await import('../league-store.ts');
const { fileDispute } = await import('../dispute.ts');
const { importGame, recordLiveGame } = await import('../history.ts');
const { gameRows } = await import('../admin.ts');
const { GRID_LEN } = await import('../league.ts');
const { SANDBOX_ID, scenarioIds } = await import('../scenarios.ts');

const restoreAccounts = A.useAccountsFile(join(DIR, 'accounts.json'));
const restoreLeague = L.useLeagueFile(join(DIR, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(DIR, { recursive: true, force: true }); });

for (const n of ['Ann520', 'Bo520', 'Cy520']) assert.ok(A.register(n, 'correct horse battery').ok);
const ann = A.accountByName('Ann520')!, bo = A.accountByName('Bo520')!, cy = A.accountByName('Cy520')!;

const issues = (): any[] => {
  try { return readFileSync(process.env['ALGO_ISSUES_FILE']!, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
};

/** a two-player room that `loser` concedes — a finished game */
function finished(code: string, seed: number, loser: Seat = 0, users = true): import('../rooms.ts').Room {
  const room = R.createRoom(code, seed, ['Ann520', 'Bo520']);
  if (users) { R.setSeatUser(room, 0, ann.id); R.setSeatUser(room, 1, bo.id); }
  R.applyToRoom(room, { type: 'concede', seat: loser });
  assert.equal(R.decidedWinner(room), loser === 0 ? 1 : 0, 'fixture: the concede decided it');
  return room;
}

test('§1 a dispute files a report row and marks the room; the result stands', async () => {
  const room = finished('DSP1', 52000);
  const before = issues().length;
  const r = await fileDispute(room, 0, '  I won because a trigger fired twice  ');
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.deepEqual(r.disputed, [true, false]);
  assert.equal(room.disputes.length, 1);
  assert.equal(room.disputes[0]!.note, 'I won because a trigger fired twice', 'the note, trimmed');
  assert.equal(R.decidedWinner(room), 1, 'the result is not touched');
  const rows = issues();
  assert.equal(rows.length, before + 1, 'one report row');
  const row = rows.at(-1);
  assert.equal(row.room, 'DSP1');
  assert.equal(row.seat, 0);
  assert.equal(row.actionIndex, room.actions.length, 'filed at the final board');
  assert.equal(row.kind, 'bug');
  assert.equal(row.severity, 'gamebreaking');
  assert.equal(row.page, 'game');
  assert.match(row.note, /^\[Dispute\] I won because a trigger fired twice$/);
  assert.deepEqual(row.dispute, { winner: 1 }, 'tagged as a dispute, with the result as it stood');
  assert.equal(row.by.name, 'Ann520', 'filed as the seat\'s account');
  const file = JSON.parse(readFileSync(join(DIR, 'games', 'DSP1.json'), 'utf8'));
  assert.equal(file.disputes.length, 1, 'saved with the game');
  assert.equal(file.winner, 1, 'and the saved result is the same');
});

test('§2 refused: no seat, an unfinished game, a second dispute, no note, a scenario or test-mode room', async () => {
  const before = issues().length;
  const room = finished('DSP2', 52001);
  const no = async (r: import('../rooms.ts').Room, seat: Seat | null, note: string, why: RegExp, label: string) => {
    const out = await fileDispute(r, seat, note);
    assert.equal(out.ok, false, `${label}: refused`);
    assert.match(out.ok ? '' : out.error, why, label);
  };
  await no(room, null, 'watching', /only a player/, 'a spectator (no seat)');
  await no(room, 1, '   ', /what went wrong/, 'an empty note');
  const live = R.createRoom('DSP3', 52002, ['Ann520', 'Bo520']);
  await no(live, 0, 'too early', /not over/, 'an unfinished game');
  assert.equal(R.disputeRefusal(live, 0), 'the game is not over');
  assert.ok((await fileDispute(room, 1, 'first')).ok, 'the first dispute by a seat lands');
  await no(room, 1, 'again', /already disputed/, 'a second by the same seat');
  assert.ok((await fileDispute(room, 0, 'mine too')).ok, 'the other seat still may');
  // a scenario room and a test-mode room are not a game between two players,
  // even once decided
  const scenario = scenarioIds()[0]!;
  for (const id of [SANDBOX_ID, scenario]) {
    const r = R.createRoom(`DSPS${id === SANDBOX_ID ? 'B' : 'C'}`, 52003, ['Seat 1', 'Seat 2'], 'shared', undefined, undefined, id);
    r.winner = 0;
    assert.notEqual(R.disputesRefusal(r), null, `${id}: takes no disputes`);
    await no(r, 0, 'wrong', /between two players/, `a ${id} room`);
  }
  assert.equal(issues().length, before + 2, 'only the two accepted disputes filed rows');
  assert.deepEqual(room.disputes.map(d => d.seat), [1, 0]);
});

test('§3 the mark survives a restore, and the re-imported history row carries it', async () => {
  const room = finished('DSP4', 52004, 1);
  assert.ok((await fileDispute(room, 1, 'the clock ran out during a freeze')).ok);
  const fresh = await import(`../rooms.ts?r520=${Math.random()}`) as Rooms;
  fresh.restoreRooms();
  const back = fresh.getRoom('DSP4');
  assert.ok(back, 'restored');
  assert.deepEqual(back!.disputes.map(d => [d.seat, d.note]), [[1, 'the clock ran out during a freeze']]);
  assert.equal(fresh.decidedWinner(back!), 0, 'with the same result');
  assert.deepEqual(fresh.disputedSeats(back!), [false, true]);
  assert.equal(fresh.disputeRefusal(back!, 1), 'you have already disputed this game', 'one per seat, across a restart');
  assert.equal(fresh.disputeRefusal(back!, 0), null);
  const raw = JSON.parse(readFileSync(join(DIR, 'games', 'DSP4.json'), 'utf8'));
  const g = importGame(raw, 'DSP4', '2026-10-21T12:00:00.000Z').game;
  assert.deepEqual(g.disputed, [1], 'the history row read off the file has the tag');
  assert.equal(g.winner, 0, 'and the result');
});

test('§4 the match history and the admin games list show the tag; nothing else moves', async () => {
  const room = finished('DSP5', 52005, 0);
  recordLiveGame(room);
  const winsBefore = A.accountByName('Bo520')!.profile.wins;
  assert.equal(A.recentGames(ann.id).find(r => r.code === 'DSP5')!.disputed, undefined, 'no tag before');
  assert.ok((await fileDispute(room, 0, 'I misclicked concede while the board was frozen')).ok);
  assert.deepEqual(A.recentGames(ann.id).find(r => r.code === 'DSP5')!.disputed, { mine: true, theirs: false });
  assert.deepEqual(A.recentGames(bo.id).find(r => r.code === 'DSP5')!.disputed, { mine: false, theirs: true });
  assert.equal(gameRows().find(r => r.code === 'DSP5')!.disputed, 1);
  const row = A.gameHistory().find(g => g.code === 'DSP5')!;
  assert.equal(row.winner, 1, 'the recorded result stands');
  A.rebuildProfiles();
  assert.equal(A.accountByName('Bo520')!.profile.wins, winsBefore, 'and so do the stats');
});

test('§5 a league match: the organizer sees the dispute, a player does not, a friendly flags nothing', async () => {
  const OPEN = Date.parse('2026-10-04T09:00:00Z'), WEEK1 = Date.parse('2026-10-11T07:00:00Z'), HOUR = 3_600_000;
  assert.ok(L.createSeason({ id: 'dp520', name: 'Test dp', signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(), weeks: 3, perWeek: 2, auto: false, hidden: false }, OPEN - HOUR).ok);
  const s = L.seasonById('dp520')!;
  L.advance(s, OPEN);
  const grid = new Array<string>(GRID_LEN).fill('1').join('');
  for (const a of [ann, bo]) { A.setLeagueAvailability(a, 'Europe/London', grid); A.setLeagueContact(a, `${a.username}_dc`); L.joinSeason(s, a, OPEN + 1); }
  const ch = L.challenge(s, ann, bo.id, OPEN + HOUR);
  assert.ok(ch.ok);
  const matchId = ch.ok ? ch.match : '';
  const room = finished('DSP6', 52006, 0);
  room.league = { season: 'dp520', match: matchId };
  assert.ok(L.recordPlayed(matchId, bo.id, 'DSP6', OPEN + 2 * HOUR), 'fixture: the room settled the match');
  const r = await fileDispute(room, 0, 'Bo won off a bugged trigger', OPEN + 3 * HOUR);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.row.dispute, { winner: 1, league: matchId }, 'the report names the league match');
  const m = s.matches.find(x => x.id === matchId)!;
  assert.equal(m.result!.outcome, 'b', 'the result stands');
  assert.deepEqual(m.disputes!.map(d => [d.by, d.code]), [[ann.id, 'DSP6']], 'the match is flagged');
  assert.ok(s.log.some(l => /disputed the result \(DSP6\)/.test(l.what)), 'a line in the season log');
  const asOrg = L.seasonView(s, cy, { admin: true }).matches.find(x => x.id === matchId) as any;
  assert.equal(asOrg.disputes[0].name, 'Ann520', 'the organizer\'s view of the match names who');
  assert.match(asOrg.disputes[0].note, /bugged trigger/, 'and what they said');
  const asPlayer = L.seasonView(s, bo, { admin: false }).matches.find(x => x.id === matchId) as any;
  assert.equal(asPlayer.disputes, undefined, 'a player\'s view does not carry it');
  // a later game in the same league room is a friendly: it settled nothing
  const friendly = finished('DSP7', 52007, 1);
  friendly.league = { season: 'dp520', match: matchId };
  const f = await fileDispute(friendly, 1, 'friendly went wrong', OPEN + 4 * HOUR);
  assert.ok(f.ok, 'the dispute itself is filed');
  assert.equal(f.ok && f.row.dispute?.league, undefined, 'but it flags no league match');
  assert.equal(m.disputes!.length, 1);
  // the organizer's page draws the line
  const ui = readFileSync(join(import.meta.dirname, '..', '..', 'ui', 'league.ts'), 'utf8');
  assert.match(ui, /\$\{resultText\(m\)\}\$\{disputesHtml\(m\)\}/, 'the league page prints it beside the result');
});

// ── §6 over the wire ──────────────────────────────────────────────────

interface Msg { t: string; msg?: string; disputed?: [boolean, boolean]; disputable?: boolean; [k: string]: unknown }

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(String((ev as MessageEvent).data)) as Msg;
      this.msgs.push(m);
      const i = this.waiters.findIndex(w => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
    });
  }
  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise(res => this.ws.addEventListener('open', () => res(), { once: true }));
  }
  next(pred: (m: Msg) => boolean, after = 0, timeoutMs = 8000): Promise<Msg> {
    const past = this.msgs.findIndex((m, i) => i >= after && pred(m));
    if (past >= 0) return Promise.resolve(this.msgs[past]!);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  ask(obj: unknown, pred: (m: Msg) => boolean): Promise<Msg> {
    const mark = this.msgs.length;
    this.send(obj);
    return this.next(pred, mark);
  }
}

test('§6 over the wire: offered on the post-game screen, a spectator refused, both seats told, kept across a restart', async () => {
  const WIRE = join(DIR, 'wire');
  const env = {
    ALGO_GAMES_DIR: join(WIRE, 'games'), ALGO_ISSUES_FILE: join(WIRE, 'issues.jsonl'),
    ALGO_ACCOUNTS_FILE: join(WIRE, 'accounts.json'),
  };
  let server: ServerHandle = await spawnServer(env);
  const clients: Client[] = [];
  try {
    const ROOM = await mintRoom(server.port);
    const a = new Client(server.port), b = new Client(server.port), w = new Client(server.port);
    clients.push(a, b, w);
    await Promise.all([a.open(), b.open(), w.open()]);
    a.send({ t: 'join', room: ROOM, seat: 0, name: 'Ann' });
    await a.next(m => m.t === 'joined');
    b.send({ t: 'join', room: ROOM, seat: 1, name: 'Bo' });
    await b.next(m => m.t === 'joined');
    w.send({ t: 'watch', room: ROOM });
    await w.next(m => m.t !== 'error');
    const early = await a.ask({ t: 'dispute', note: 'too soon' }, m => m.t === 'disputeerr');
    assert.match(early.msg ?? '', /not over/, 'a game still being played cannot be disputed');
    const markB = b.msgs.length;
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const over = await b.next(m => m.t === 'gameover', markB);
    assert.equal(over.disputable, true, 'the post-game screen offers it');
    assert.deepEqual(over.disputed, [false, false]);
    const spect = await w.ask({ t: 'dispute', note: 'I saw a bug' }, m => m.t === 'disputeerr');
    assert.match(spect.msg ?? '', /only a player/, 'a spectator is refused');
    const markA = a.msgs.length;
    const told = await b.ask({ t: 'dispute', note: 'I only won because of a bug' }, m => m.t === 'dispute');
    assert.deepEqual(told.disputed, [false, true], 'the disputer hears it');
    assert.deepEqual((await a.next(m => m.t === 'dispute', markA)).disputed, [false, true], 'and so does the other seat');
    const again = await b.ask({ t: 'dispute', note: 'again' }, m => m.t === 'disputeerr');
    assert.match(again.msg ?? '', /already disputed/);
    const rows = readFileSync(env.ALGO_ISSUES_FILE, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.filter(r => r.dispute).length, 1, 'one dispute row in the journal');
    assert.equal(rows.at(-1).room, ROOM);
    // a restart: the dispute is part of the saved game
    for (const c of clients) c.ws.close();
    clients.length = 0;
    await server.stop();
    server = await spawnServer(env);
    const b2 = new Client(server.port);
    clients.push(b2);
    await b2.open();
    b2.send({ t: 'join', room: ROOM, seat: 1, name: 'Bo' });
    const back = await b2.next(m => m.t === 'gameover');
    assert.equal(back.disputable, true);
    assert.deepEqual(back.disputed, [false, true], 'the rejoined post-game screen still says it was disputed');
    const still = await b2.ask({ t: 'dispute', note: 'once more' }, m => m.t === 'disputeerr');
    assert.match(still.msg ?? '', /already disputed/, 'still once per seat after the restart');
  } finally {
    for (const c of clients) { try { c.ws.close(); } catch { /* closing */ } }
    await server.stop();
  }
});
