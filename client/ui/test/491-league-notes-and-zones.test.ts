/* 491 — THE BELL'S LEAGUE LINES, AND LEAGUE TIMES IN A NAMED ZONE.
 *
 *   §1 ⭐ every kind the server's league outbox can send (league-store.ts
 *      `OutboxKind`, read off the source — never a list kept here) has its
 *      own line in ui/leaguenotes.ts, not the "News from…" fallback a kind
 *      newer than the page gets; a time is shown through the caller's
 *      formatter (the viewer's zone), and nothing a player typed is markup
 *   §2 ui/zonetime.ts: a wall time in a named zone → the instant, on both
 *      sides of a daylight-saving change, the skipped hour, a half-hour zone;
 *      and the days of a week in that zone
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUE_STORE_TS } from '../../engine/scripts/paths.mjs';
import { noteLine, type LeagueNote } from '../leaguenotes.ts';
import { daysBetween, zonedEpoch } from '../zonetime.ts';

function serverKinds(): string[] {
  const src = readFileSync(LEAGUE_STORE_TS, 'utf8');
  const union = /export type OutboxKind =([\s\S]*?);/.exec(src);
  assert.ok(union, 'OutboxKind not found in league-store.ts');
  return [...union[1]!.replace(/\/\/[^\n]*/g, '').matchAll(/'([a-z-]+)'/g)].map(m => m[1]!);
}

const note = (kind: string, data: Record<string, unknown> = {}): LeagueNote =>
  ({ id: 1, kind, season: 's', at: 0, read: false, data: { season: 'October', ...data } });

test('§1 ⭐ every league message the server can send has a line in the bell', () => {
  const kinds = serverKinds();
  assert.ok(kinds.length >= 14 && kinds.includes('time-reminder'), `found ${kinds.join(', ')}`);
  const fallback = noteLine(note('a-kind-from-the-future'), () => '').html;
  for (const k of kinds) {
    const { html } = noteLine(note(k, { week: 2, at: 1_800_000_000, from: { name: 'Ben' }, opponent: { name: 'Ben' } }), () => 'WHEN');
    assert.notEqual(html, fallback, `${k} falls through to the fallback line`);
    assert.ok(html.length > 10, `${k} says something`);
  }
  const t = noteLine(note('time-reminder', { at: 1_800_000_000, opponent: { name: 'Ben' } }), u => `T${u}`);
  assert.match(t.html, /T1800000000/, 'a time goes through the viewer\'s formatter');
  assert.equal(t.action, 'play', 'a reminder carries Play');
  const evil = noteLine(note('waiting', { from: { name: '<img src=x onerror=alert(1)>' } }), () => '').html;
  assert.ok(!evil.includes('<img'), 'a typed name is escaped');
});

test('§2 a wall time in a named zone, across daylight saving', () => {
  const iso = (ms: number): string => new Date(ms).toISOString();
  assert.equal(iso(zonedEpoch('2026-10-21', 20 * 60, 'America/New_York')), '2026-10-22T00:00:00.000Z', 'EDT, −4');
  assert.equal(iso(zonedEpoch('2026-11-02', 20 * 60, 'America/New_York')), '2026-11-03T01:00:00.000Z', 'EST, −5');
  assert.equal(iso(zonedEpoch('2026-10-25', 9 * 60, 'Europe/Prague')), '2026-10-25T08:00:00.000Z', 'the morning Prague falls back');
  assert.equal(iso(zonedEpoch('2026-03-08', 150, 'America/New_York')), '2026-03-08T07:30:00.000Z',
    'the skipped 02:30 lands an hour later, at 03:30');
  assert.equal(iso(zonedEpoch('2026-10-25', 30, 'Asia/Kolkata')), '2026-10-24T19:00:00.000Z', 'a half-hour zone');
  assert.deepEqual(daysBetween(Date.parse('2026-10-18T10:00Z'), Date.parse('2026-10-25T06:59Z'), 'America/Los_Angeles'),
    ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
    'the days of a league week in Los Angeles');
});
