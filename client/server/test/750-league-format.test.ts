/* 750 — A LEAGUE SEASON HAS A FORMAT: LIVE DRAFT, OR CASUAL CONSTRUCTED.
 *
 * The owner, 2026-11-01, setting up November: "It's constructed, but you're
 * perfectly allowed to change your deck every single game (or not). The stated
 * goal is 'casual constructed'." October was draft-only and its stored data
 * must read exactly as before.
 *
 *   §1  ⭐ a row with no format (every season written before November) reads
 *       as draft, and a draft season is written without the field at all
 *   §2  ⭐ a constructed season keeps its format across a reload, says so in
 *       its view, and says so in its sign-up messages
 *   §3  the format can change only until a league game has been opened, and
 *       only to one of the two
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, register, setLeagueAvailability, setLeagueContact, useAccountsFile, type Account } from '../accounts.ts';
import { GRID_LEN } from '../league.ts';
import {
  advance, createSeason, formatOf, formatProblem, joinSeason, loadLeague, matchOpened, outboxRows, seasonById,
  seasonView, updateSeason, useLeagueFile, challenge,
} from '../league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-format-'));
const file = join(dir, 'league.json');
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(file);
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

// November 2026: sign-ups from 1 Nov, week 1 Sun 8 Nov 07:00 UTC
const OPEN = Date.parse('2026-11-01T10:00:00Z');
const WEEK1 = Date.parse('2026-11-08T07:00:00Z');
const HOUR = 3_600_000;
const evenings = (): string => {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = 18; h < 23; h++) g[d * 24 + h] = '1';
  return g.join('');
};
function player(name: string): Account {
  assert.ok(register(name, 'correct horse battery').ok);
  const a = accountByName(name)!;
  setLeagueAvailability(a, 'Europe/London', evenings());
  setLeagueContact(a, `${name.toLowerCase()}_dc`);
  return a;
}
const base = { signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(), weeks: 3, perWeek: 3, auto: false, hidden: false };
const rawSeason = (id: string): Record<string, unknown> =>
  (JSON.parse(readFileSync(file, 'utf8')) as { seasons: Record<string, unknown>[] }).seasons.find(s => s['id'] === id)!;

test('league format §1 ⭐ an old row with no format is a draft, and a draft row stays as it was', () => {
  const r = createSeason({ id: 'oct', name: 'October 2026', ...base }, OPEN - HOUR);
  assert.ok(r.ok);
  assert.equal('format' in rawSeason('oct'), false, '⭐ a draft season is written WITHOUT the field: October’s row is unchanged');
  assert.equal(formatOf(seasonById('oct')!), 'draft');
  assert.equal(seasonView(seasonById('oct')!, undefined, { admin: false }).format, 'draft');

  // the live file's shape: a season row from before formats existed
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { seasons: Record<string, unknown>[] };
  stored.seasons.push({ ...rawSeason('oct'), id: 'legacy', name: 'Legacy' });
  writeFileSync(file, JSON.stringify(stored));
  loadLeague();
  assert.equal(formatOf(seasonById('legacy')!), 'draft', '⭐ a stored row with no format reads as draft');
  assert.equal(formatOf({ format: 'nonsense' }), 'draft', 'and so does anything that is not constructed');
});

test('league format §2 ⭐ a constructed season keeps its format and says so', () => {
  const r = createSeason({ id: 'nov', name: 'November 2026 League', ...base, format: 'constructed' }, OPEN - HOUR);
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.equal(rawSeason('nov')['format'], 'constructed');
  loadLeague();
  const s = seasonById('nov')!;
  assert.equal(formatOf(s), 'constructed', '⭐ the format survives a reload');
  assert.equal(seasonView(s, undefined, { admin: false }).format, 'constructed');

  advance(s, OPEN);
  const open = outboxRows().filter(x => x.season === 'nov' && x.kind === 'signups-open');
  assert.equal(open.length, 1);
  assert.equal(open[0]!.data['format'], 'constructed', '⭐ the sign-ups post knows the format (the bot words it)');
  const ann = player('FmtAnn');
  assert.deepEqual(joinSeason(s, ann, OPEN + HOUR), { ok: true });
  const mine = outboxRows().filter(x => x.season === 'nov' && x.kind === 'signup' && x.to === ann.id);
  assert.equal(mine[0]?.data['format'], 'constructed', 'and so does the sign-up DM');

  const bad = createSeason({ id: 'bad', name: 'Bad', ...base, format: 'sealed' as never }, OPEN);
  assert.equal(bad.ok, false, 'only the two formats exist');
});

test('league format §3 the format changes only until a league game is opened', () => {
  assert.ok(createSeason({ id: 'flip', name: 'Flip', ...base }, OPEN - HOUR).ok);
  const s = seasonById('flip')!;
  advance(s, OPEN);
  assert.deepEqual(updateSeason('flip', { format: 'constructed' }, OPEN).ok, true, 'a fresh season can be made constructed');
  assert.equal(formatOf(s), 'constructed');
  assert.deepEqual(updateSeason('flip', { format: 'draft' }, OPEN).ok, true, '…and back');
  assert.equal('format' in rawSeason('flip'), false, 'back to draft drops the field again');
  assert.equal(updateSeason('flip', { format: 'sealed' as never }, OPEN).ok, false);

  const a = player('FmtBea'), b = player('FmtCal');
  joinSeason(s, a, OPEN + 1); joinSeason(s, b, OPEN + 1);
  const c = challenge(s, a, b.id, OPEN + HOUR);
  assert.ok(c.ok);
  assert.equal(formatProblem(s), null, 'a sign-up week game nobody has opened does not fix the format');
  matchOpened(s, s.matches[0]!, a, 'ROOM1', OPEN + 2 * HOUR);
  assert.match(formatProblem(s) ?? '', /fixed/);
  const r = updateSeason('flip', { format: 'constructed' }, OPEN + 3 * HOUR);
  assert.equal(r.ok, false, '⭐ a room already built for a draft is not turned constructed under the players');
  assert.equal(formatOf(s), 'draft');
  assert.equal(updateSeason('flip', { name: 'Flip 2', format: 'draft' }, OPEN + 3 * HOUR).ok, true,
    'restating the same format is not a change');
  assert.equal(seasonView(s, undefined, { admin: true }).formatProblem !== null, true, 'the organizer is told why');
});
