/* 492 — AGREEING WHEN TO PLAY A LEAGUE MATCH, AND THE BELL'S LEAGUE NEWS.
 *
 * Owner, 2026-10-18: the bell carries the league's messages, and a player can
 * suggest a time for a match — one suggestion at a time, the opponent sees it
 * in their own zone and accepts or suggests another — with a reminder to both
 * fifteen minutes before an agreed time. league-store.ts §"agreeing a time".
 *
 *   §1 suggesting: only your own match, only this week's, only a time ahead
 *      and before the week closes; the opponent is sent a 'time' row
 *   §2 accepting: only the OTHER player; the suggester is sent 'time-agreed';
 *      suggesting the very time already on the table accepts it; a new
 *      suggestion replaces the old (and un-agrees it)
 *   §3 ⭐ the reminder: fifteen minutes out, to both, ONCE — not early, not
 *      for a match already played, not after the time has passed
 *   §4 the bell: a player's own rows newest first WITHOUT the 'time' row (the
 *      live suggestion stands in for it), read once marked; the suggestion
 *      waiting on an answer is listed for the one who must answer it only
 *   §5 the League page's view carries the time, and whose it is
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, register, setLeagueAvailability, setLeagueContact, useAccountsFile, type Account } from '../accounts.ts';
import { GRID_LEN } from '../league.ts';
import {
  REMIND_BEFORE_MS, acceptTime, advance, createSeason, joinSeason, markNotesRead, notesFor, outboxRows,
  recordPlayed, seasonById, seasonView, suggestTime, tick, timesAskedOf, useLeagueFile, type Season,
} from '../league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-times-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

const OPEN = Date.parse('2026-10-04T09:00:00Z');
const WEEK1 = Date.parse('2026-10-11T07:00:00Z');
const WEEK2 = WEEK1 + 7 * 86_400_000;
const HOUR = 3_600_000;
const NOW = WEEK1 + 2 * HOUR;

const evenings = (): string => {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = 18; h < 23; h++) g[d * 24 + h] = '1';
  return g.join('');
};

function player(name: string): Account {
  assert.ok(register(name, 'correct horse battery').ok);
  const a = accountByName(name)!;
  setLeagueAvailability(a, 'Europe/London', evenings());
  setLeagueContact(a, `${name.toLowerCase()}_dc`);   // a Discord name is required to join
  return a;
}

/** a season in week 1 with one match, a vs b */
function weekOne(id: string): { s: Season; a: Account; b: Account; match: string } {
  const r = createSeason({
    id, name: `Test ${id}`, signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(),
    weeks: 3, perWeek: 1, auto: false, hidden: false,
  }, OPEN - HOUR);
  assert.ok(r.ok);
  const s = seasonById(id)!;
  advance(s, OPEN);
  const a = player(`${id}A`), b = player(`${id}B`);
  assert.deepEqual(joinSeason(s, a, OPEN + 1), { ok: true });
  assert.deepEqual(joinSeason(s, b, OPEN + 1), { ok: true });
  advance(s, WEEK1);
  const m = s.matches.find(x => x.week === 1)!;
  assert.ok(m, 'week 1 paired them');
  return { s, a, b, match: m.id };
}

const rowsTo = (id: string, kind: string) => outboxRows().filter(r => r.to === id && r.kind === kind);

test('§1 suggesting a time: whose, when, and the opponent is told', () => {
  const { s, a, b, match } = weekOne('t1');
  const stranger = player('t1C');
  const at = NOW + 24 * HOUR;
  assert.equal(suggestTime(s, stranger, match, at, NOW).ok, false, 'not your match');
  const soon = suggestTime(s, a, match, NOW + 5 * 60_000, NOW);
  assert.match(soon.ok ? '' : soon.error, /ten minutes/, 'too soon to answer');
  const late = suggestTime(s, a, match, WEEK2 + HOUR, NOW);
  assert.match(late.ok ? '' : late.error, /before this week/, 'after the week closes');
  assert.equal(suggestTime(s, a, match, Number.NaN, NOW).ok, false, 'not a time');

  assert.ok(suggestTime(s, a, match, at + 37_123, NOW).ok);
  const m = s.matches.find(x => x.id === match)!;
  assert.deepEqual(m.time, { at, by: a.id }, 'kept to the minute, and whose it is');
  const sent = rowsTo(b.id, 'time');
  assert.equal(sent.length, 1, 'the opponent is sent a time row');
  assert.equal(sent[0]!.data['at'], Math.floor(at / 1000), 'in unix seconds, like every other league time');
});

test('§2 accepting, the same time, and replacing', () => {
  const { s, a, b, match } = weekOne('t2');
  const m = s.matches.find(x => x.id === match)!;
  const at = NOW + 24 * HOUR;
  assert.equal(acceptTime(s, b, match, NOW).ok, false, 'nothing to accept yet');
  suggestTime(s, a, match, at, NOW);
  const own = acceptTime(s, a, match, NOW);
  assert.match(own.ok ? '' : own.error, /your own suggestion/);
  assert.ok(acceptTime(s, b, match, NOW).ok);
  assert.equal(m.time!.agreed, true);
  assert.equal(rowsTo(a.id, 'time-agreed').length, 1, 'the suggester hears it was accepted');

  // a new suggestion replaces the agreed one and needs answering again
  suggestTime(s, b, match, at + HOUR, NOW);
  assert.deepEqual(m.time, { at: at + HOUR, by: b.id });
  // naming the time already on the table is accepting it
  assert.ok(suggestTime(s, a, match, at + HOUR, NOW).ok);
  assert.equal(m.time!.agreed, true, '⭐ the same time back is a yes, not a second suggestion');
  assert.equal(m.time!.by, b.id, 'and it stays the suggester\'s');
});

test('§3 ⭐ the reminder: fifteen minutes out, to both, once', () => {
  const { s, a, b, match } = weekOne('t3');
  const at = NOW + 6 * HOUR;
  suggestTime(s, a, match, at, NOW);
  acceptTime(s, b, match, NOW);
  const count = (): number => rowsTo(a.id, 'time-reminder').length + rowsTo(b.id, 'time-reminder').length;
  tick(at - REMIND_BEFORE_MS - 60_000);
  assert.equal(count(), 0, 'not early');
  tick(at - REMIND_BEFORE_MS + 1000);
  assert.equal(count(), 2, 'both, at fifteen minutes');
  tick(at - 60_000);
  assert.equal(count(), 2, 'once');
  const r = rowsTo(b.id, 'time-reminder')[0]!;
  assert.equal((r.data['opponent'] as { id: string }).id, a.id, 'naming the opponent');

  // a match already played, or a time already gone, is not reminded
  const two = weekOne('t3b');
  suggestTime(two.s, two.a, two.match, NOW + 6 * HOUR, NOW);
  acceptTime(two.s, two.b, two.match, NOW);
  recordPlayed(two.match, two.a.id, 'ABCD', NOW + HOUR);
  tick(NOW + 6 * HOUR - 60_000);
  assert.equal(rowsTo(two.a.id, 'time-reminder').length, 0, 'played: no reminder');
  const three = weekOne('t3c');
  suggestTime(three.s, three.a, three.match, NOW + 6 * HOUR, NOW);
  acceptTime(three.s, three.b, three.match, NOW);
  tick(NOW + 6 * HOUR + 60_000);
  assert.equal(rowsTo(three.a.id, 'time-reminder').length, 0, 'past the time: no reminder');
});

test('§4 the bell: league news, read once, and the suggestion to answer', () => {
  const { s, a, b, match } = weekOne('t4');
  suggestTime(s, a, match, NOW + 24 * HOUR, NOW);
  const notes = notesFor(b.id, NOW);
  assert.ok(notes.some(n => n.kind === 'pairings'), 'the week\'s pairings are in it');
  assert.ok(!notes.some(n => n.kind === 'time'), '⭐ the time row is not: the live suggestion stands in for it');
  assert.ok(notes.every((n, i) => i === 0 || n.id < notes[i - 1]!.id), 'newest first');
  assert.ok(notes.every(n => !n.read));
  markNotesRead(b.id, Math.max(...notes.map(n => n.id)), NOW);
  assert.ok(notesFor(b.id, NOW).every(n => n.read), 'read once marked');
  assert.ok(notesFor(a.id, NOW).some(n => !n.read), 'and only for the one who read them');

  assert.deepEqual(timesAskedOf(b.id, NOW).map(t => [t.match, t.from]), [[match, `${a.username}`]],
    'the suggestion waits on the opponent');
  assert.deepEqual(timesAskedOf(a.id, NOW), [], 'not on the one who made it');
  acceptTime(s, b, match, NOW);
  assert.deepEqual(timesAskedOf(b.id, NOW), [], 'answered: gone');
});

test('§5 the League page shows the time and whose it is', () => {
  const { s, a, b, match } = weekOne('t5');
  const at = NOW + 24 * HOUR;
  suggestTime(s, a, match, at, NOW);
  const mine = seasonView(s, a, { admin: false, now: NOW }).me!.matches.find(m => m.id === match)!;
  const theirs = seasonView(s, b, { admin: false, now: NOW }).me!.matches.find(m => m.id === match)!;
  assert.deepEqual(mine.time, { at, mine: true, agreed: false });
  assert.deepEqual(theirs.time, { at, mine: false, agreed: false });
});
