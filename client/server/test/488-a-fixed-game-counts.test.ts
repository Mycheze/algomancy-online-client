/* BL-46 — A FIXED GAME COUNTS FOR EVERYTHING, AND SAYS SO.
 *
 * The owner, 2026-10-16: "Assuming both players agree, it doesn't change
 * anything in the game." So a game that took agreed fixes counts for the
 * result, the rating, the league, achievements and card stats — and only gets
 * a visible "fixed" tag in the match history and the organizer's view.
 *
 *   §1 the history row carries the tag (and a game nobody fixed carries none)
 *   §2 …and counts: the profile, the rating gate, the card-stats gate
 *   §3 the match history and the admin's games list show it
 *   §4 the league result carries it, and the room's result reaches it
 *
 * Seeds 48800-48899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action, Seat } from '../../engine/src/types.ts';
import { accountByName, rebuildProfiles, recentGames, register, setLeagueAvailability, setLeagueContact, useAccountsFile } from '../accounts.ts';
import { importGame } from '../history.ts';
import { isRated } from '../rating.ts';
import { eligible } from '../cardstats.ts';
import { gameRows } from '../admin.ts';
import { GRID_LEN } from '../league.ts';
import { advance, challenge, createSeason, joinSeason, recordPlayed, seasonById, useLeagueFile } from '../league-store.ts';
import type { Amendment } from '../types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'algo-488-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

for (const n of ['Ann488', 'Bo488']) assert.ok(register(n, 'correct horse battery').ok);
const ann = accountByName('Ann488')!, bo = accountByName('Bo488')!;

/** a real log of `n` plain actions, so the summary replays a real game */
function plainLog(seed: number, n: number): Action[] {
  const h = new Harness(seed, ['Ann488', 'Bo488']);
  const log: Action[] = [];
  for (let i = 0; i < n; i++) {
    const seat = ([0, 1] as Seat[]).find(s => legalActions(h.state, s).length)!;
    const a = legalActions(h.state, seat).find(x => ['donePlanning', 'doneHaste', 'doneDeploying', 'passPriority'].includes(x.type))
      ?? legalActions(h.state, seat)[0]!;
    h.do(a);
    log.push(a);
  }
  return log;
}

const FIX: Amendment = { kind: 'edit', at: 3, seat: 0, by: 1, what: 'Ann488 draws 1 card', reason: 'the draw was skipped', when: '2026-10-16T12:00:00.000Z', edit: { kind: 'drawCards', target: 0, n: 1 } };

function record(code: string, seed: number, amendments?: Amendment[]) {
  return importGame({
    seed, mode: 'shared', els: ['fire', 'water', 'earth'], names: ['Ann488', 'Bo488'],
    actions: plainLog(seed, 14), winner: 0, users: [ann.id, bo.id], rated: true,
    ...(amendments ? { amendments } : {}),
  } as never, code, '2026-10-16T12:00:00.000Z').game;
}

test('§1 the history row of a fixed game carries the tag, and an unfixed one none', () => {
  const fixed = record('FXD1', 48800, [FIX]);
  assert.equal(fixed.amended, 1);
  const plain = record('FXD2', 48801);
  assert.equal(plain.amended, undefined, 'no field on a game nobody fixed');
});

test('§2 a fixed game counts: the profile, the rating gate, the card-stats gate', () => {
  const fixed = record('FXD3', 48802, [FIX, { ...FIX, at: 5 }]);
  assert.equal(fixed.amended, 2);
  rebuildProfiles();
  const p = accountByName('Ann488')!.profile;
  assert.ok(p.wins >= 1 && p.games >= 1, 'the win is on the profile');
  assert.equal(isRated({ ...fixed, mode: 'draft' }), true, 'a rated fixed game moves ratings');
  assert.equal(eligible({ ...fixed, mode: 'draft' } as never, { mode: 'all' }), true, 'and is in the card stats');
});

test('§3 the match history and the admin games list show the tag', () => {
  record('FXD4', 48803, [FIX]);
  const row = recentGames(ann.id).find(r => r.code === 'FXD4')!;
  assert.equal(row.amended, 1);
  assert.equal(recentGames(ann.id).find(r => r.code === 'FXD2')!.amended, undefined);
  const admin = gameRows().find(r => r.code === 'FXD4')!;
  assert.equal(admin.amended, 1);
  const ui = readFileSync(join(HERE, '..', '..', 'ui', 'account.ts'), 'utf8');
  assert.match(ui, /\$\{customTag\(g\)\}\$\{fixedTag\(g\)\}/, 'the games tab draws fixedTag beside the other tags');
});

test('§4 the league result carries the tag, and a fixed room reports it', () => {
  const OPEN = Date.parse('2026-10-04T09:00:00Z'), WEEK1 = Date.parse('2026-10-11T07:00:00Z'), HOUR = 3_600_000;
  const r = createSeason({ id: 'fx488', name: 'Test fx', signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(), weeks: 3, perWeek: 2, auto: false, hidden: false }, OPEN - HOUR);
  assert.ok(r.ok);
  const s = seasonById('fx488')!;
  advance(s, OPEN);
  const grid = new Array<string>(GRID_LEN).fill('1').join('');
  for (const a of [ann, bo]) { setLeagueAvailability(a, 'Europe/London', grid); setLeagueContact(a, `${a.username}_dc`); joinSeason(s, a, OPEN + 1); }
  const m = challenge(s, ann, bo.id, OPEN + HOUR);
  assert.ok(m.ok);
  assert.ok(recordPlayed(m.ok ? m.match : '', ann.id, 'FXD5', OPEN + 2 * HOUR, { fixed: true }));
  const res = s.matches.find(x => x.id === (m.ok ? m.match : ''))!.result!;
  assert.equal(res.fixed, true, 'the organizer sees the game took fixes');
  assert.equal(res.outcome, 'a', 'and it still settled the match');
  // the room's own result reaches it (main.ts recordFinishedGame)
  const main = readFileSync(join(HERE, '..', 'main.ts'), 'utf8');
  assert.match(main, /leagueRecordPlayed\(.*\{ fixed: room\.amendments\.length > 0 \}\)/);
  const leagueUi = readFileSync(join(HERE, '..', '..', 'ui', 'league.ts'), 'utf8');
  assert.match(leagueUi, /r\.fixed \? .*\(fixed\)/, 'and the league page prints it beside the result');
});
