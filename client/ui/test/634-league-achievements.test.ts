/* 634 — THE LEAGUE ACHIEVEMENTS UNLOCK WHEN A SEASON CLOSES (docs/20-league.md §7, CT-372).
 *
 * docs/20 §7: "League regular" (seasons played: 1/3/6 tiers) and "League
 * champion" (seasons won), counted from `Account.league.seasons`;
 * `refreshAchievements` runs at season close. "Played a season" is exactly a
 * row in `Account.league.seasons`, which the close writes for every entrant
 * who played at least one decided league match that season (league-store.ts
 * closeSeason) — the same rule the trophy chip uses, so the chip and the
 * achievement can never disagree.
 *
 * A real one-week season is run to its close in process, with six entrants:
 * two week-1 matches are played, the third pair never plays theirs.
 *
 *   §1 ⭐ at the close the champion holds League Regular and League Champion,
 *      stamped then (not at their next game), and a finalist holds League
 *      Regular only
 *   §2 a player who signed up and was paired but never played gets neither
 *   §3 the stamps survive a restart: the accounts file is re-read from disk
 *   §4 the counters read Account.league.seasons, so any past season counts
 *      and the 3 and 6 season rungs follow
 *   §5 the profile's achievements tab shows them, in a League section
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountById, accountByName, emptyProfile, loadAccounts, privateView, register, setLeagueAvailability,
  useAccountsFile, type Account, type LeagueHonour,
} from '../../server/accounts.ts';
import { evaluateAchievements } from '../../server/achievements.ts';
import { defaultGrid } from '../../server/league.ts';
import { advance, createSeason, joinSeason, recordPlayed, seasonById, useLeagueFile } from '../../server/league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-ach-'));
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
  a.linked = { discord: { id: `d-${name}`, username: name, linkedAt: new Date(T0).toISOString() } };
  return a;
}
assert.ok(createSeason({
  id: 'pilot', name: 'October 2026 pilot', signupOpens: new Date(T0).toISOString(),
  start: new Date(T0 + 7 * DAY).toISOString(), weeks: 1, perWeek: 1, auto: false, hidden: false,
}, T0 - DAY).ok);
const season = seasonById('pilot')!;
const players = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'].map(player);
advance(season, T0);
for (const p of players) assert.deepEqual(joinSeason(season, p, T0 + 1), { ok: true });
assert.ok(advance(season, T0 + 7 * DAY).ok, 'week 1');
const week1 = season.matches.filter(x => x.week === 1);
assert.equal(week1.length, 3, 'six entrants, one opponent each: three week-1 matches');
const [m1, m2, idle] = week1 as [typeof week1[0], typeof week1[0], typeof week1[0]];
assert.ok(recordPlayed(m1.id, m1.a, 'W1A', T0 + 8 * DAY));
assert.ok(recordPlayed(m2.id, m2.a, 'W1B', T0 + 8 * DAY));
assert.ok(advance(season, T0 + 14 * DAY).ok, 'the final');
const fin = season.matches.find(m => m.final)!;
assert.ok(recordPlayed(fin.id, fin.b, 'FIN', T0 + 15 * DAY));
const id = (a: Account): string => a.id;
const champId = fin.b, finalistId = fin.a;
const neverIds = [idle.a, idle.b];
assert.ok(![champId, finalistId].some(x => neverIds.includes(x)), 'the idle pair did not reach the final');
const before: Record<string, string[]> = Object.fromEntries(players.map(p => [id(p), Object.keys(p.achievements)]));
assert.ok(advance(season, T0 + 21 * DAY).ok, 'closed');

const LEAGUE_IDS = ['league-regular', 'league-stalwart', 'league-lifer', 'league-champion'];
const stamped = (a: Account): string[] => LEAGUE_IDS.filter(x => !!a.achievements[x]);

test('§1 CT-372: at the season close the champion holds League Regular and League Champion, a finalist League Regular', () => {
  const champ = accountById(champId)!, finalist = accountById(finalistId)!;
  assert.equal(champ.league?.seasons?.[0]?.place, 'champion', 'the close wrote the honour');
  assert.deepEqual(before[champId]!.filter(x => LEAGUE_IDS.includes(x)), [], 'nothing league was stamped before the close');
  assert.deepEqual(stamped(champ), ['league-regular', 'league-champion'],
    'the close itself stamped the champion: League Regular and League Champion');
  assert.deepEqual(stamped(finalist), ['league-regular'], 'the finalist is a League Regular, not a champion');
});

test('§2 CT-372: a player who signed up and was paired but never played a league game gets no League Regular', () => {
  for (const nid of neverIds) {
    const a = accountById(nid)!;
    assert.equal(a.league?.seasons?.length ?? 0, 0, `${a.username} has no season honour`);
    assert.deepEqual(stamped(a), [], `${a.username} never played: no league achievement`);
    const st = evaluateAchievements(a.profile, a).find(s => s.id === 'league-regular')!;
    assert.equal(st.earned, false);
    assert.equal(st.have, 0);
  }
});

test('§3 CT-372: the league achievements survive a server restart', () => {
  const at = accountById(champId)!.achievements['league-champion'];
  assert.ok(at, 'stamped at the close');
  loadAccounts();                       // what a restart does: re-read accounts.json from disk
  const champ = accountById(champId)!;
  assert.notEqual(champ, undefined);
  assert.equal(champ.achievements['league-champion'], at, 'the stamp was persisted, with its time');
  assert.equal(champ.achievements['league-regular'] !== undefined, true);
  const st = evaluateAchievements(champ.profile, champ).find(s => s.id === 'league-champion')!;
  assert.equal(st.earned, true);
});

test('§4 CT-372: the counters read Account.league.seasons, so any past season counts and the 3 and 6 rungs follow', () => {
  const h = (n: number, place: LeagueHonour['place']): LeagueHonour => ({ season: `s${n}`, name: `S${n}`, place, w: 1, l: 0 });
  const base = accountById(neverIds[0])!;
  const at = (seasons: LeagueHonour[]): Record<string, { have: number; need: number; earned: boolean }> => {
    const acct = { ...base, achievements: {}, league: { seasons } } as Account;
    return Object.fromEntries(evaluateAchievements(emptyProfile(), acct)
      .filter(s => LEAGUE_IDS.includes(s.id)).map(s => [s.id, { have: s.have, need: s.need, earned: s.earned }]));
  };
  const none = at([]);
  assert.deepEqual(Object.values(none).map(s => s.earned), [false, false, false, false]);
  assert.deepEqual(LEAGUE_IDS.map(x => none[x]!.need), [1, 3, 6, 1], 'tiers 1 / 3 / 6, and one season won');
  const three = at([h(1, 'participant'), h(2, 'finalist'), h(3, 'participant')]);
  assert.equal(three['league-stalwart']!.earned, true, 'three seasons played');
  assert.equal(three['league-lifer']!.earned, false);
  assert.equal(three['league-lifer']!.have, 3);
  assert.equal(three['league-champion']!.earned, false, 'a finalist is not a champion');
  const six = at([1, 2, 3, 4, 5, 6].map(n => h(n, n === 4 ? 'champion' : 'participant')));
  assert.equal(six['league-lifer']!.earned, true, 'six seasons played');
  assert.equal(six['league-champion']!.earned, true, 'one season won, whichever it was');
});

test('§5 CT-372: the profile achievements tab shows the league achievements in a League section', async () => {
  const champ = accountById(champId)!;
  const g = globalThis as unknown as Record<string, unknown>;
  g['__UI_DRIVER_SEARCH'] = '';
  g['__UI_DRIVER_STORE'] = { algoToken: 'tok' };
  const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  g['__UI_DRIVER_FETCH'] = (url: string) => url === '/api/me'
    ? reply({ ok: true, me: privateView(champ, () => false) })
    : new Promise(() => {});
  const { home } = await import('./ui-driver.ts');
  const acct = await import('../account.ts');
  const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
  await settle();
  const ui = home();
  acct.reloadMe();
  await settle(); await settle();
  ui.click({ btn: 'acct-open-profile' });
  await settle();
  ui.click({ btn: 'acct-tab', tab: 'achievements' });
  await settle();
  const html = ui.html();
  const head = /<h4>League <span class="acctcount">(\d+)\/(\d+)<\/span><\/h4>/.exec(html);
  assert.ok(head, 'the achievements tab has a League section');
  assert.equal(head[1], '2', 'two league achievements earned (League Regular, League Champion)');
  assert.equal(head[2], '4', 'four in the section: three rungs of seasons played, and the champion');
  const rest = html.slice(head.index);
  const section = rest.slice(0, (rest.indexOf('<div class="achgroup">', 1) + 1 || rest.length + 1) - 1);
  assert.match(section, /<div class="ach got ">[\s\S]*?League Champion/, 'League Champion shows, earned');
  // the seasons-played ladder collapses to its next rung, with a pip per rung
  assert.match(section, /League Stalwart[\s\S]*?title="1 of 3 earned"/, 'the ladder shows its next rung and one pip earned');
  assert.match(section, /1 \/ 3/, 'with the progress toward three seasons');
});
