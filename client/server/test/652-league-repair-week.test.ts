/* The organizer pairs the running week again (owner, 2026-10-25: a player
 * pressed "sit out" on week 3 three weeks early, by accident, and found out
 * when week 3 was paired without her).
 *
 * §1 ⭐ "Put back in" clears her skip for the running week, pairs the week
 *    again with her in it, and the old week's pairing messages are gone —
 *    nobody's bell keeps the opponents they no longer have
 * §2 refused once anybody has started on the week: a result, a room, a time
 * §3 refused outside a running week, and for a player who is not sitting it out
 * §4 the organizer's view says why not (the Discord post's mentions: ui test 653)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountById, accountByName, register, setLeagueAvailability, useAccountsFile, type Account } from '../accounts.ts';
import { defaultGrid } from '../league.ts';
import {
  advance, createSeason, joinSeason, outboxRows, recordPlayed, repairWeek, seasonById, seasonView, setSkip,
  suggestTime, useLeagueFile, type Season,
} from '../league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-repair-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

const T0 = Date.parse('2026-10-05T00:00:00Z');
const DAY = 24 * 3_600_000;

function player(name: string): Account {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `register ${name}`);
  const a = accountByName(name)!;
  setLeagueAvailability(a, 'Europe/London', defaultGrid());
  a.linked = { discord: { id: `d-${name}`, username: name.toLowerCase(), linkedAt: new Date(T0).toISOString() } };
  return a;
}

/** a season in week 1 with `names` in it and the first one sitting week 1 out */
function seasonInWeek1(id: string, names: string[]): { s: Season; p: Account[] } {
  const r = createSeason({
    id, name: `Test ${id}`, signupOpens: new Date(T0).toISOString(), start: new Date(T0 + 7 * DAY).toISOString(),
    weeks: 3, perWeek: 2, auto: false, hidden: false,
  }, T0 - DAY);
  assert.ok(r.ok);
  const s = seasonById(id)!;
  const p = names.map(player);
  advance(s, T0);
  for (const a of p) assert.ok(joinSeason(s, a, T0 + 1).ok);
  assert.ok(setSkip(s, p[0]!, 1, true, T0 + 2).ok);
  assert.ok(advance(s, T0 + 7 * DAY).ok);
  return { s, p };
}

const week1 = (s: Season) => s.matches.filter(m => m.week === 1);
const rows = (s: Season, kind: string) => outboxRows().filter(r => r.season === s.id && r.kind === kind && r.data['week'] === 1);

test('league repair §1 ⭐ put back in: she is paired, the old messages are gone', () => {
  const { s, p } = seasonInWeek1('r1', ['Gem', 'Ann', 'Bob', 'Cat', 'Dan']);
  const gem = p[0]!.id;
  assert.ok(week1(s).every(m => m.a !== gem && m.b !== gem), 'she sat week 1 out');
  assert.equal(rows(s, 'sitting-out').length, 1);
  const before = rows(s, 'pairings').map(r => r.id);

  const r = repairWeek(s, T0 + 7 * DAY + 60_000, { putBack: gem });
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.deepEqual(s.entrants.find(e => e.userId === gem)!.skips, [], 'her skip is cleared');
  assert.ok(week1(s).some(m => m.a === gem || m.b === gem), '⭐ she is paired now');
  assert.equal(week1(s).length, r.matches);
  assert.equal(new Set(week1(s).map(m => m.id)).size, week1(s).length, 'match ids are not doubled up');
  assert.equal(rows(s, 'sitting-out').length, 0, 'nobody is told they sit out');
  assert.ok(rows(s, 'pairings').every(r => !before.includes(r.id)), '⭐ the old pairing messages are gone');
  assert.ok(rows(s, 'pairings').some(r => r.to === gem), 'she gets her opponents');
  assert.equal(rows(s, 'week-pairings').length, 1, 'one channel post for the week, the new one');
  assert.ok(s.log.some(l => /put back into week 1/.test(l.what)));
});

test('league repair §2 refused once anybody has started on the week', () => {
  for (const [id, start] of [
    ['r2a', (s: Season) => { const m = week1(s)[0]!; recordPlayed(m.id, m.a, 'ROOM', T0 + 8 * DAY); }],
    ['r2b', (s: Season) => { week1(s)[0]!.room = 'ABCD'; }],
    ['r2c', (s: Season) => {
      const m = week1(s)[0]!;
      assert.ok(suggestTime(s, accountById(m.a)!, m.id, T0 + 9 * DAY, T0 + 7 * DAY + 1).ok);
    }],
  ] as const) {
    const { s, p } = seasonInWeek1(id, ['Gem', 'Ann', 'Bob', 'Cat', 'Dan'].map(n => `${n}${id}`));
    start(s);
    const before = week1(s).map(m => m.id + m.a + m.b);
    const r = repairWeek(s, T0 + 8 * DAY, { putBack: p[0]!.id });
    assert.equal(r.ok, false, `${id}: refused`);
    assert.match(r.ok ? '' : r.error, /has already started/);
    assert.deepEqual(week1(s).map(m => m.id + m.a + m.b), before, `${id}: the week is untouched`);
    assert.deepEqual(s.entrants.find(e => e.userId === p[0]!.id)!.skips, [1], `${id}: her skip stays`);
  }
});

test('league repair §3 refused outside a running week, and for a player who is playing', () => {
  const { s, p } = seasonInWeek1('r3', ['GemR3', 'AnnR3', 'BobR3', 'CatR3']);
  const r = repairWeek(s, T0 + 8 * DAY, { putBack: p[1]!.id });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /not sitting week 1 out/);
  const r0 = createSeason({
    id: 'r3z', name: 'Signups', signupOpens: new Date(T0).toISOString(), start: new Date(T0 + 7 * DAY).toISOString(),
    weeks: 3, perWeek: 2, auto: false, hidden: false,
  }, T0 - DAY);
  assert.ok(r0.ok);
  const z = seasonById('r3z')!;
  advance(z, T0);
  assert.equal(repairWeek(z, T0 + 1).ok, false, 'sign-up week has no pairings to redo');
});

test('league repair §4 the organizer sees why not', () => {
  const { s } = seasonInWeek1('r4', ['GemR4', 'AnnR4', 'BobR4', 'CatR4']);
  const admin = seasonView(s, undefined, { admin: true, now: T0 + 7 * DAY });
  assert.equal(admin.repairProblem, null);
  assert.equal('repairProblem' in seasonView(s, undefined, { admin: false, now: T0 + 7 * DAY }), false,
    'a player is not shown the organizer\'s controls');
  week1(s)[0]!.room = 'WXYZ';
  assert.match(seasonView(s, undefined, { admin: true }).repairProblem ?? '', /has already started/);
});

