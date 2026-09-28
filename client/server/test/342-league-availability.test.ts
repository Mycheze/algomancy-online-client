/* The league's availability and overlap (docs/20-league.md §3).
 *
 * §1 a grid and a zone are validated, never trusted
 * §2 ⭐ LOCAL TIME IS LOCAL ACROSS A DST CHANGE — the pilot season straddles
 *    the UK change (Sun 25 Oct 2026) and the US one (Sun 1 Nov 2026), so the
 *    same London/New York pair shares 4, then 3, then 4 hours a weeknight
 * §3 a window is ≥ 2 shared hours in a row, and runs over UTC midnight
 * §4 the overlap score counts distinct days, not windows
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_LEN, HOUR_MS, defaultGrid, hoursIn, localSlot, overlapScore, sanitizeGrid, sharedWindows,
  validTz, type Availability,
} from '../league.ts';

/** a grid with `hours` (local, 0–23, may pass 24) marked on the given days (0 = Monday) */
function grid(days: number[], from: number, to: number): string {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (const d of days) for (let h = from; h < to; h++) g[(d * 24 + h) % GRID_LEN] = '1';
  return g.join('');
}
const WEEKDAYS = [0, 1, 2, 3, 4];
const mon = (iso: string): number => Date.parse(iso);

test('league §1 a grid and a zone are checked', () => {
  assert.ok(validTz('Europe/London'));
  assert.ok(validTz('Asia/Kolkata'), 'a half-hour zone is a zone');
  assert.ok(!validTz('Mars/Olympus'));
  assert.ok(!validTz(''));
  assert.ok(!validTz(42));
  assert.equal(sanitizeGrid('1'.repeat(GRID_LEN)), '1'.repeat(GRID_LEN));
  assert.equal(sanitizeGrid('1'.repeat(GRID_LEN - 1)), null, 'a short grid is refused');
  assert.equal(sanitizeGrid('2'.repeat(GRID_LEN)), null);
  assert.equal(sanitizeGrid(null), null);
  assert.equal(hoursIn(defaultGrid()), 20, 'the starter grid is weeknights 7–11pm: 5 × 4 hours');
});

test('league §2 ⭐ local time stays local across the October 2026 DST changes', () => {
  // Monday 18:00 UTC is 19:00 in London in BST (19 Oct) and 18:00 in GMT (26 Oct)
  assert.equal(localSlot(mon('2026-10-19T18:00:00Z'), 'Europe/London'), 19);
  assert.equal(localSlot(mon('2026-10-26T18:00:00Z'), 'Europe/London'), 18);
  // Monday 23:00 UTC is 19:00 in New York in EDT (26 Oct) and 18:00 in EST (2 Nov)
  assert.equal(localSlot(mon('2026-10-26T23:00:00Z'), 'America/New_York'), 19);
  assert.equal(localSlot(mon('2026-11-02T23:00:00Z'), 'America/New_York'), 18);
  // Sunday is the grid's last day
  assert.equal(localSlot(mon('2026-10-25T12:00:00Z'), 'UTC'), 6 * 24 + 12);

  const london: Availability = { tz: 'Europe/London', grid: grid(WEEKDAYS, 20, 24) };
  const newYork: Availability = { tz: 'America/New_York', grid: grid(WEEKDAYS, 15, 19) };
  const lengths = (week: string): number[] => sharedWindows(london, newYork, mon(week)).map(w => w.hours);
  assert.deepEqual(lengths('2026-10-19T00:00:00Z'), [4, 4, 4, 4, 4], 'both on summer time: 19–23 UTC both');
  assert.deepEqual(lengths('2026-10-26T00:00:00Z'), [3, 3, 3, 3, 3],
    '⭐ London has changed and New York has not: 20–24 vs 19–23 UTC, three hours shared');
  assert.deepEqual(lengths('2026-11-02T00:00:00Z'), [4, 4, 4, 4, 4], 'both on winter time: 20–24 UTC both');
});

test('league §3 a window is two shared hours in a row, and may cross UTC midnight', () => {
  const week = mon('2026-10-12T00:00:00Z');
  const a: Availability = { tz: 'UTC', grid: grid([0], 22, 26) };          // Mon 22:00 → Tue 02:00
  const b: Availability = { tz: 'UTC', grid: grid([0], 23, 25) };          // Mon 23:00 → Tue 01:00
  assert.deepEqual(sharedWindows(a, b, week), [{ start: week + 23 * HOUR_MS, hours: 2 }]);

  const one: Availability = { tz: 'UTC', grid: grid([2], 10, 11) };
  assert.deepEqual(sharedWindows(one, one, week), [], 'one shared hour is not enough for a live draft');
  assert.deepEqual(sharedWindows(a, null, week), [], 'nobody to meet');

  // the week wraps: Sunday 23:00 local does not join Monday 00:00 of the SAME week
  const sun: Availability = { tz: 'UTC', grid: grid([6], 22, 24) + '' };
  assert.equal(sharedWindows(sun, sun, week).length, 1);
});

test('league §4 the overlap score counts days, not windows', () => {
  const week = mon('2026-10-12T00:00:00Z');
  const split: Availability = {
    tz: 'UTC',
    grid: grid([0], 12, 14).split('').map((c, i) => (c === '1' || (i >= 18 && i < 22) ? '1' : '0')).join(''),
  };
  const ws = sharedWindows(split, split, week);
  assert.equal(ws.length, 2, 'lunch and evening on Monday are two windows…');
  assert.equal(overlapScore(ws), 1, '⭐ …and one day: one chance to meet');

  const three: Availability = { tz: 'UTC', grid: grid([0, 2, 4], 18, 21) };
  assert.equal(overlapScore(sharedWindows(three, three, week)), 3);
});
