/* 610 — A CLOSED LEAGUE SEASON'S TROPHY SHOWS (docs/20-league.md §7).
 *
 * The season's close writes every entrant's place onto their account
 * (server league-store.ts closeSeason → accounts.ts setLeagueHonour), the
 * season DM tells them "The season's badge is on your profile" — and until
 * this test, nothing drew it. A real season is run to its close in process,
 * and the page is fed exactly what the server's routes would send:
 *
 *   §1 ⭐ the champion's profile header carries a Champion chip naming the
 *      season, beside the badge; the finalist's says Finalist, a player who
 *      only played a week says Participant
 *   §2 the League page's standings of the closed season mark the champion
 *      and the finalist with the same chip
 *   §3 somebody who never finished a season has no chip at all
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, privateView, register, setLeagueAvailability, useAccountsFile, type Account } from '../../server/accounts.ts';
import { defaultGrid, MIN_HOURS } from '../../server/league.ts';
import {
  advance, allSeasons, createSeason, joinSeason, recordPlayed, seasonById, seasonView, useLeagueFile,
} from '../../server/league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'trophy-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

// ── a whole (one-week) season, run to its close ──────────────────────
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
const made = createSeason({
  id: 'pilot', name: 'October 2026 pilot', signupOpens: new Date(T0).toISOString(),
  start: new Date(T0 + 7 * DAY).toISOString(), weeks: 1, perWeek: 1, auto: false, hidden: false,
}, T0 - DAY);
assert.ok(made.ok);
const season = seasonById('pilot')!;
const players = ['Ann', 'Bob', 'Cat', 'Dan'].map(player);
const outsider = player('Eve');
advance(season, T0);
for (const p of players) assert.deepEqual(joinSeason(season, p, T0 + 1), { ok: true });
assert.ok(advance(season, T0 + 7 * DAY).ok, 'week 1');
for (const m of season.matches.filter(x => x.week === 1)) assert.ok(recordPlayed(m.id, m.a, 'W1', T0 + 8 * DAY));
assert.ok(advance(season, T0 + 14 * DAY).ok, 'the final');
const fin = season.matches.find(m => m.final)!;
assert.ok(recordPlayed(fin.id, fin.b, 'FIN', T0 + 15 * DAY));
assert.ok(advance(season, T0 + 21 * DAY).ok, 'closed');
const byId = (id: string): Account => players.find(p => p.id === id)!;
const champion = byId(fin.b), finalist = byId(fin.a);
const participant = players.find(p => p !== champion && p !== finalist)!;
assert.equal(champion.league?.seasons?.[0]?.place, 'champion', 'the close wrote the honour');

// ── the page, signed in as whoever `who` is, fed by the real views ───
let who: Account = champion;
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok' };
const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
g['__UI_DRIVER_FETCH'] = (url: string) => {
  if (url === '/api/me') return reply({ ok: true, me: privateView(who, () => false) });
  if (url.startsWith('/api/league')) {
    return reply({
      ok: true, season: seasonView(season, who, { admin: false, now: T0 + 22 * DAY }),
      seasons: allSeasons().map(x => ({ id: x.id, name: x.name, phase: x.phase, weeks: x.weeks, hidden: x.hidden })),
      signedIn: true, availability: null, contact: null, minHours: MIN_HOURS, organizer: false,
    });
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const acct = await import('../account.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();
const ui = home();

/** the profile header's h1, for whoever is signed in */
async function profileHead(): Promise<string> {
  acct.reloadMe();
  await settle(); await settle();
  if (!ui.has({ btn: 'acct-close' })) ui.click({ btn: 'acct-open-profile' });
  await settle();
  const h1 = /<div class="accthead">[\s\S]*?<h1>([\s\S]*?)<\/h1>/.exec(ui.html());
  assert.ok(h1, 'the profile header did not paint');
  return h1[1]!;
}

test('§1 docs20 league trophies: a closed season puts its place on the profile, beside the badge', async () => {
  who = champion;
  const head = await profileHead();
  assert.match(head, /class="badgechip trophy champion"[^>]*>🏆 Champion · October 2026 pilot</, '⭐ the champion has no trophy chip');
  who = finalist;
  assert.match(await profileHead(), /class="badgechip trophy finalist"[^>]*>🥈 Finalist · October 2026 pilot</);
  who = participant;
  assert.match(await profileHead(), /class="badgechip trophy participant"[^>]*>🏅 Participant · October 2026 pilot</);
});

test('§2 the closed season standings mark the champion and the finalist with the same chip', async () => {
  who = participant;
  ui.click({ btn: 'acct-close' });
  await settle();
  ui.click({ btn: 'nav-league' });
  await settle(); await settle();
  const html = ui.html();
  const table = /<h3>Standings<\/h3>([\s\S]*?)<\/table>/.exec(html)?.[1] ?? '';
  assert.ok(table, 'the standings did not paint');
  const row = (a: Account): string => new RegExp(`<td>${a.username}([^<]*(?:<span[^>]*>[^<]*</span>)?)</td>`).exec(table)?.[1] ?? '';
  assert.match(row(champion), /badgechip trophy champion[^>]*>🏆 Champion</);
  assert.match(row(finalist), /badgechip trophy finalist[^>]*>🥈 Finalist</);
  assert.doesNotMatch(row(participant), /badgechip/, 'only the final two are marked in the table');
  ui.click({ btn: 'lg-close' });
  await settle();
});

test('§3 somebody who never finished a season has no trophy chip', async () => {
  who = outsider;
  assert.doesNotMatch(await profileHead(), /trophy/);
  assert.equal(acct.trophyChipsHtml(undefined), '');
  assert.equal(acct.trophyChipsHtml([{ season: 'x', name: 'X', place: 'emperor' as never, w: 0, l: 0 }]), '',
    'a place this page does not know shows nothing rather than a broken chip');
});
