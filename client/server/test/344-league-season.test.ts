/* A whole league season, in process (docs/20-league.md §2, §5, §6).
 *
 * §1 sign-up refuses what it should: not open, no availability, too few
 *    hours, no Discord link (when the deploy has a bot), a guest
 * §2 ⭐ a MANUAL season runs sign-ups → 3 weeks → final → closed on Advance
 *    alone, with a skip, a late entry, a result, unplayed matches at the
 *    deadline, the table picking the finalists, and honours on the accounts
 * §3 ⭐ every message a player should get is in the OUTBOX, survives a
 *    restart (a reload of the file), and an ack is idempotent
 * §4 an AUTOMATIC season follows its calendar; `hold` stops it at the next boundary
 * §5 a hidden season is seen only by admins and its own entrants, and only
 *    a hidden season can be deleted
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, setLeagueAvailability, useAccountsFile, accountByName, type Account } from '../accounts.ts';
import { GRID_LEN, WEEK_MS, defaultGrid } from '../league.ts';
import {
  ackOutbox, advance, canSee, createSeason, currentSeason, deleteSeason, joinProblem, joinSeason,
  leaveSeason, loadLeague, outboxRows, pendingOutbox, recordPlayed, seasonById, setSkip, table, tick,
  updateSeason, useLeagueFile, type Season,
} from '../league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

const T0 = Date.parse('2026-10-05T00:00:00Z');
const DAY = 24 * 3_600_000;

function player(name: string, opts: { grid?: string; discord?: boolean } = {}): Account {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `register ${name}: ${'error' in r ? r.error : ''}`);
  const a = accountByName(name)!;
  if (opts.grid !== '') setLeagueAvailability(a, 'Europe/London', opts.grid ?? defaultGrid());
  if (opts.discord !== false) a.linked = { discord: { id: `d-${name}`, username: name, linkedAt: new Date(T0).toISOString() } };
  return a;
}

function season(id: string, over: Partial<Parameters<typeof createSeason>[0]> = {}): Season {
  const r = createSeason({
    id, name: `Test ${id}`, signupOpens: new Date(T0).toISOString(), start: new Date(T0 + 7 * DAY).toISOString(),
    weeks: 3, perWeek: 2, auto: false, hidden: false, ...over,
  }, T0 - DAY);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return seasonById(id)!;
}

const kinds = (s: Season, to: string | null): string[] =>
  outboxRows().filter(r => r.season === s.id && r.to === to).map(r => r.kind);

test('league season §1 sign-up refuses what it should', () => {
  const s = season('s1');
  const ok = player('Ok1');
  assert.equal(joinProblem(s, ok, { requireDiscord: true }), 'sign-ups are not open yet');
  advance(s, T0);
  assert.equal(joinProblem(s, ok, { requireDiscord: true }), null);

  const none = player('NoHours', { grid: '' });
  assert.match(joinProblem(s, none, { requireDiscord: true })!, /usually free/);
  const few = player('FewHours', { grid: '1'.repeat(3) + '0'.repeat(GRID_LEN - 3) });
  assert.match(joinProblem(s, few, { requireDiscord: true })!, /at least 6 hours/);
  const unlinked = player('NoDiscord', { discord: false });
  assert.match(joinProblem(s, unlinked, { requireDiscord: true })!, /Discord/);
  assert.equal(joinProblem(s, unlinked, { requireDiscord: false }), null, 'a deploy without a bot does not ask for one');
  const guest = player('GuestX');
  guest.provisional = true;
  assert.match(joinProblem(s, guest, { requireDiscord: true })!, /guest/);
  assert.equal(joinProblem(s, few, { requireDiscord: true, byAdmin: true }), null, 'the organizer can add anyone with a zone and grid');
});

test('league season §2 ⭐ a manual season runs start to finish on Advance', () => {
  const s = season('s2');
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'];
  const p = Object.fromEntries(names.map(n => [n, player(n)]));
  advance(s, T0);                                   // sign-ups open
  for (const n of names.slice(0, 5)) assert.deepEqual(joinSeason(s, p[n]!, T0 + 1, { requireDiscord: true }), { ok: true });
  assert.equal(joinSeason(s, p['Ann']!, T0 + 2, { requireDiscord: true }).ok, false, 'no joining twice');
  assert.deepEqual(setSkip(s, p['Eve']!, 1, true, T0 + 3), { ok: true, skips: [1] });

  // week 1: Ann..Dan play (Eve skips), 2 opponents each = 4 matches
  assert.ok(advance(s, T0 + 7 * DAY).ok);
  const w1 = s.matches.filter(m => m.week === 1);
  assert.equal(w1.length, 4, 'four players, two opponents each');
  assert.ok(w1.every(m => m.a !== p['Eve']!.id && m.b !== p['Eve']!.id), 'Eve sat week 1 out');
  assert.deepEqual(kinds(s, p['Eve']!.id), ['signup', 'sitting-out']);
  assert.deepEqual(kinds(s, p['Ann']!.id), ['signup', 'pairings']);
  assert.equal(setSkip(s, p['Ann']!, 1, true, T0 + 7 * DAY).ok, false, 'a week already paired cannot be skipped');

  // a late entry during week 1 plays from week 2
  assert.equal(joinSeason(s, p['Fay']!, T0 + 8 * DAY, { requireDiscord: true }).ok, true);
  // results: two of the four played, one of them twice (the second ignored)
  const [m1, m2] = w1;
  assert.equal(recordPlayed(m1!.id, m1!.a, 'ROOM', T0 + 9 * DAY), true);
  assert.equal(recordPlayed(m1!.id, m1!.b, 'ROOM', T0 + 9 * DAY), false, '⭐ the first decided game settles the match');
  assert.equal(recordPlayed(m2!.id, 'somebody-else', 'X', T0 + 9 * DAY), false, 'only one of its two players can win it');
  assert.equal(recordPlayed(m2!.id, m2!.b, 'ROOM2', T0 + 9 * DAY), true);

  // week 2: week 1's two open matches go unplayed; six players now
  assert.ok(advance(s, T0 + 14 * DAY).ok);
  assert.equal(s.matches.filter(m => m.week === 1 && m.result?.outcome === 'unplayed').length, 2);
  const w2 = s.matches.filter(m => m.week === 2);
  assert.equal(w2.length, 6, 'six players × two opponents / 2');
  assert.ok(w2.some(m => m.a === p['Fay']!.id || m.b === p['Fay']!.id), 'the late entry is paired from week 2');
  assert.equal(joinSeason(s, player('Late2'), T0 + 15 * DAY, { requireDiscord: true }).ok, false,
    'late sign-ups close when week 2 is paired');
  for (const m of w2) recordPlayed(m.id, m.a, 'W2', T0 + 16 * DAY);

  // Cat leaves during week 2: not paired in week 3, her results stay
  assert.ok(leaveSeason(s, p['Cat']!, T0 + 17 * DAY).ok);
  assert.ok(advance(s, T0 + 21 * DAY).ok);          // week 3
  assert.ok(s.matches.filter(m => m.week === 3).every(m => m.a !== p['Cat']!.id && m.b !== p['Cat']!.id));
  for (const m of s.matches.filter(m => m.week === 3)) recordPlayed(m.id, m.b, 'W3', T0 + 22 * DAY);

  // the final: the table's top two who are still in
  assert.ok(advance(s, T0 + 28 * DAY).ok);
  const rows = table(s).filter(r => r.id !== p['Cat']!.id);
  const fin = s.matches.find(m => m.final)!;
  assert.deepEqual([fin.a, fin.b], [rows[0]!.id, rows[1]!.id], '⭐ the finalists are the top two of the table');
  recordPlayed(fin.id, fin.b, 'FINAL', T0 + 30 * DAY);

  assert.ok(advance(s, T0 + 35 * DAY).ok);
  assert.equal(s.champion, fin.b);
  assert.equal(advance(s, T0 + 36 * DAY).ok, false, 'a closed season does not advance');
  const honour = (id: string) => [...Object.values(p)].find(a => a.id === id)!.league?.seasons?.find(h => h.season === 's2');
  assert.equal(honour(fin.b)?.place, 'champion');
  assert.equal(honour(fin.a)?.place, 'finalist');
  const everyonePlayed = names.filter(n => s.matches.some(m => (m.a === p[n]!.id || m.b === p[n]!.id)
    && (m.result?.outcome === 'a' || m.result?.outcome === 'b')));
  for (const n of everyonePlayed) assert.ok(honour(p[n]!.id), `${n} played a match and has an honour`);
  assert.ok(kinds(s, null).includes('season'), 'the channel hears who won');
});

test('league season §3 ⭐ the outbox survives a restart and an ack is idempotent', () => {
  const pending = pendingOutbox(500);
  assert.ok(pending.length > 10, 'the seasons above left messages waiting');
  loadLeague();                                      // what a restart does
  assert.deepEqual(pendingOutbox(500).map(r => r.id), pending.map(r => r.id), 'the same rows after a reload');
  const [a, b] = pending;
  assert.equal(ackOutbox([a!.id], { [String(b!.id)]: 'dm-closed' }, T0 + 20 * DAY), 2);
  assert.equal(ackOutbox([a!.id], {}, T0 + 20 * DAY), 0, 'the same ack twice changes nothing');
  loadLeague();
  assert.ok(!pendingOutbox(500).some(r => r.id === a!.id || r.id === b!.id), 'acks are persisted');
  assert.equal(outboxRows().find(r => r.id === b!.id)?.failed, 'dm-closed');
});

test('league season §4 an automatic season follows its calendar, and hold stops it', () => {
  const s = season('s4', { auto: true, signupOpens: new Date(T0 + 100 * DAY).toISOString(), start: new Date(T0 + 107 * DAY).toISOString() });
  assert.equal(s.phase, -1);
  tick(T0 + 100 * DAY - 1);
  assert.equal(s.phase, -1, 'not a moment early');
  tick(T0 + 100 * DAY);
  assert.equal(s.phase, 0, 'sign-ups open on the dot');
  joinSeason(s, player('Au1'), T0 + 101 * DAY, { requireDiscord: true });
  joinSeason(s, player('Au2'), T0 + 101 * DAY, { requireDiscord: true });
  updateSeason('s4', { hold: true }, T0 + 102 * DAY);
  tick(T0 + 108 * DAY);
  assert.equal(s.phase, 0, 'a held season waits at its boundary');
  updateSeason('s4', { hold: false }, T0 + 108 * DAY);
  assert.equal(s.phase, 1, 'releasing the hold catches it up at once');
  assert.equal(s.matches.length, 1);
  tick(T0 + 107 * DAY + 3 * WEEK_MS + 1);
  assert.equal(s.phase, 4, 'three week boundaries later it is at the final');
  assert.equal(updateSeason('s4', { weeks: 5 }, T0 + 130 * DAY).ok, false, 'the calendar is fixed once paired');
});

test('league season §5 hidden seasons', () => {
  const s = season('s5', { hidden: true });
  const stranger = player('Stranger');
  const tester = player('Tester');
  advance(s, T0);
  joinSeason(s, tester, T0, { requireDiscord: true, byAdmin: true });
  assert.equal(canSee(s, stranger, false), false);
  assert.equal(canSee(s, stranger, true), true, 'an admin sees it');
  assert.equal(canSee(s, tester, false), true, 'its own entrants see it');
  assert.notEqual(currentSeason(stranger, false)?.id, 's5');
  assert.equal(deleteSeason('s2').ok, false, 'a real season is never deleted');
  assert.equal(deleteSeason('s5').ok, true);
  assert.equal(seasonById('s5'), undefined);
  assert.ok(!outboxRows().some(r => r.season === 's5'), 'its messages go with it');
});
