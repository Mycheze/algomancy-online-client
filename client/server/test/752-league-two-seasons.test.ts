/* 752 — TWO SEASONS AT ONCE: ONE MONTH'S FINAL IS THE NEXT ONE'S SIGN-UP WEEK.
 *
 * The owner, 2026-11-01: "Set up the next league that's happening after this
 * one finishes (sign up week is the same as the final week of the current
 * league, then starts Nov 7th). It's constructed". October's final runs
 * Sun 1 – Sat 7 Nov and closes Sun 8 Nov 07:00 UTC; November's sign-up week is
 * the same seven days. A finalist must be able to play the final AND join
 * November in that week.
 *
 *   §1  ⭐ the calendar as entered: November's phases fall on the dates the
 *       owner gave, and October's are untouched by November existing
 *   §2  ⭐ currentSeason is November; liveSeasons is both, oldest first; the
 *       October finalist opens the final (a DRAFT room, rated) while joining
 *       November, whose sign-up week game is a CONSTRUCTED room, unrated
 *   §3  ⭐ GET /api/league answers the current season AND the others still
 *       running; /api/league/play opens each in its own format; the bot's
 *       status carries the other season its player is in
 *   §4  October closes on its own clock and November carries on alone
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountByName, login, register, setLeagueAvailability, setLeagueContact, useAccountsFile, type Account } from '../accounts.ts';
import { GRID_LEN, phaseLabel, phaseStart } from '../league.ts';
import {
  challenge, createSeason, currentSeason, formatOf, isClosed, joinSeason, liveSeasons, matchToOpen,
  overrideResult, seasonById, tick, useLeagueFile, type Season,
} from '../league-store.ts';
import { leagueRoutes, type LeagueCtx } from '../api-league.ts';

const dir = mkdtempSync(join(tmpdir(), 'league-two-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

const HOUR = 3_600_000;
const at = (iso: string): number => Date.parse(iso);
const evenings = (): string => {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = 17; h < 23; h++) g[d * 24 + h] = '1';
  return g.join('');
};
const PASS = 'correct horse battery';
function player(name: string): Account {
  assert.ok(register(name, PASS).ok);
  const a = accountByName(name)!;
  setLeagueAvailability(a, 'America/New_York', evenings());
  setLeagueContact(a, `${name.toLowerCase()}_dc`);
  return a;
}

// the October season exactly as the box has it (var/league.json, 2026-11-01)
const OCT = { id: '2026-10', name: 'October 2026', signupOpens: '2026-10-04T10:17:00.000Z', start: '2026-10-11T07:00:00.000Z',
  weeks: 3, perWeek: 3, auto: true, hidden: false };
// November as the orchestrator enters it on the organizer form
const NOV_CREATED = at('2026-11-01T15:00:00Z');
const NOV = { id: '2026-11', name: 'November 2026 League', signupOpens: new Date(NOV_CREATED).toISOString(),
  start: '2026-11-08T07:00:00.000Z', weeks: 3, perWeek: 3, auto: true, hidden: false, format: 'constructed' as const };

let ann: Account, bob: Account, cy: Account, dee: Account;
let oct: Season, nov: Season;

test('two seasons §1 ⭐ November falls on the owner’s dates; October is untouched', () => {
  ann = player('TwoAnn'); bob = player('TwoBob'); cy = player('TwoCy'); dee = player('TwoDee');
  assert.ok(createSeason(OCT, at('2026-10-04T10:20:00Z')).ok);
  oct = seasonById('2026-10')!;
  for (const a of [ann, bob, cy, dee]) assert.deepEqual(joinSeason(oct, a, at('2026-10-05T12:00:00Z')), { ok: true });
  // October runs through its weeks; Ann and Bob top the table
  tick(at('2026-10-11T08:00:00Z'));
  for (const m of oct.matches.filter(x => x.week === 1)) {
    const aWins = m.a === ann.id || m.a === bob.id || (m.b !== ann.id && m.b !== bob.id);
    overrideResult(oct, m.id, aWins ? 'a' : 'b', '', at('2026-10-12T00:00:00Z'));
  }
  tick(at('2026-11-01T07:00:01Z'));
  assert.equal(oct.phase, 4, 'October is in its final from Sun 1 Nov 07:00 UTC');
  assert.equal(phaseLabel(oct, oct.phase), 'The final');
  const octBefore = JSON.stringify({ ...oct, log: [] });

  const r = createSeason(NOV, NOV_CREATED);
  assert.ok(r.ok, r.ok ? '' : r.error);
  nov = seasonById('2026-11')!;
  assert.equal(formatOf(nov), 'constructed');
  assert.equal(nov.phase, 0, 'an automatic season whose sign-ups are due opens at once');
  const iso = (p: number): string => new Date(phaseStart(nov, p)).toISOString();
  assert.equal(iso(1), '2026-11-08T07:00:00.000Z', '⭐ week 1: Sun 8 Nov 07:00 UTC (Sat 7 Nov evening in the US)');
  assert.equal(iso(2), '2026-11-15T07:00:00.000Z', 'week 2: 15 Nov');
  assert.equal(iso(3), '2026-11-22T07:00:00.000Z', 'week 3: 22 Nov');
  assert.equal(iso(4), '2026-11-29T07:00:00.000Z', 'the final: 29 Nov – 5 Dec');
  assert.equal(iso(5), '2026-12-06T07:00:00.000Z', 'closes Sun 6 Dec');
  assert.equal(phaseStart(oct, 5), phaseStart(nov, 1), '⭐ October closes the instant November’s week 1 starts');
  assert.equal(JSON.stringify({ ...oct, log: [] }), octBefore, 'creating November changes nothing in October');
});

test('two seasons §2 ⭐ the finalist plays October’s final and joins November the same week', () => {
  const now = at('2026-11-02T20:00:00Z');
  assert.equal(currentSeason(ann, false)?.id, '2026-11', 'the newest live season is the current one');
  assert.deepEqual(liveSeasons(ann, false).map(s => s.id), ['2026-10', '2026-11'], '⭐ both are live, oldest first');
  const fin = oct.matches.find(m => m.final)!;
  assert.ok(fin, 'October has its final');
  const finalist = accountByName([fin.a, fin.b].includes(ann.id) ? 'TwoAnn' : 'TwoBob')!;
  assert.ok(matchToOpen(oct, finalist, fin.id).ok, '⭐ the finalist can open the final');
  assert.deepEqual(joinSeason(nov, finalist, now), { ok: true }, '⭐ …and join November in the same week');
  assert.deepEqual(joinSeason(nov, cy, now), { ok: true });
  assert.ok(challenge(nov, finalist, cy.id, now).ok, 'and start a November sign-up week game');
  tick(now + HOUR);
  assert.equal(oct.phase, 4, 'October stays in its final');
  assert.equal(nov.phase, 0, 'November stays in sign-ups');
});

/** a request to leagueRoutes, as main.ts would hand it over */
async function call(method: string, path: string, body: unknown, token: string | null, ctx: Partial<LeagueCtx> = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  Object.assign(req, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let status = 0, text = '';
  const res = { writeHead(s: number) { status = s; return this; }, end(t?: string) { text = t ?? ''; } } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const handled = await leagueRoutes(req, res, url.pathname, url, { botAllowed: false, now: () => at('2026-11-03T20:00:00Z'), ...ctx });
  assert.ok(handled, `${path} is a league route`);
  return { status, body: JSON.parse(text || 'null') as Record<string, unknown> };
}

test('two seasons §3 ⭐ the page, Play and the bot see both seasons', async () => {
  const fin = oct.matches.find(m => m.final)!;
  const finalist = fin.a === ann.id || fin.b === ann.id ? 'TwoAnn' : 'TwoBob';
  const auth = login(finalist, PASS);
  assert.ok(auth.ok);
  const page = await call('GET', '/api/league', undefined, auth.token);
  const season = page.body['season'] as { id: string; format: string };
  const others = page.body['others'] as { id: string; format: string; me: { matches: { id: string; playable: boolean }[] } }[];
  assert.equal(season.id, '2026-11');
  assert.equal(season.format, 'constructed');
  assert.deepEqual(others.map(o => o.id), ['2026-10'], '⭐ the page is told about October too');
  assert.equal(others[0]!.format, 'draft');
  assert.ok(others[0]!.me.matches.some(m => m.id === fin.id && m.playable), '⭐ with the finalist’s Play-able final in it');
  const seasons = page.body['seasons'] as { id: string; format: string }[];
  assert.deepEqual(seasons.map(s => [s.id, s.format]), [['2026-10', 'draft'], ['2026-11', 'constructed']]);

  const opened: { match: string; mode: string; rated: boolean }[] = [];
  const openRoom: LeagueCtx['openRoom'] = req => {
    opened.push({ match: req.match, mode: req.mode, rated: req.rated });
    return { code: `R${opened.length}`, users: [req.a.userId, req.b.userId] };
  };
  const playFinal = await call('POST', '/api/league/play', { season: '2026-10', match: fin.id }, auth.token, { openRoom });
  assert.equal(playFinal.body['ok'], true);
  assert.equal(playFinal.body['mode'], 'draft', '⭐ October’s final is still a live draft');
  const w0 = nov.matches.find(m => m.week === 0)!;
  const playW0 = await call('POST', '/api/league/play', { season: '2026-11', match: w0.id }, auth.token, { openRoom });
  assert.equal(playW0.body['mode'], 'constructed', '⭐ a November game opens a constructed room');
  assert.deepEqual(opened, [
    { match: fin.id, mode: 'draft', rated: true },
    { match: w0.id, mode: 'constructed', rated: false },
  ], 'the final is rated; a sign-up week game is not — the same rule in both formats');

  // a passer-by sees both seasons as well (neither is hidden), with nothing of theirs in them
  const anon = await call('GET', '/api/league', undefined, null);
  assert.deepEqual((anon.body['others'] as { id: string }[]).map(o => o.id), ['2026-10']);
});

test('two seasons §3b ⭐ the bot’s status carries the other season its player is in', async () => {
  const fin = oct.matches.find(m => m.final)!;
  const finalist = accountByName(fin.a === ann.id || fin.b === ann.id ? 'TwoAnn' : 'TwoBob')!;
  finalist.linked = { ...(finalist.linked ?? {}), discord: { id: '555', username: 'fin' } } as Account['linked'];
  const st = await call('GET', '/api/league/bot/status?discord=555', undefined, null, { botAllowed: true });
  assert.equal((st.body['season'] as { id: string }).id, '2026-11');
  assert.deepEqual((st.body['others'] as { id: string }[]).map(o => o.id), ['2026-10'], '⭐ /league status shows the final too');
  const eve = player('TwoEve');
  joinSeason(nov, eve, at('2026-11-03T12:00:00Z'));
  eve.linked = { discord: { id: '556', username: 'eve' } } as Account['linked'];
  const newcomer = await call('GET', '/api/league/bot/status?discord=556', undefined, null, { botAllowed: true });
  assert.deepEqual(newcomer.body['others'], [], 'a newcomer who was never in October sees November alone');
});

test('two seasons §4 October closes on its own clock; November carries on alone', () => {
  tick(at('2026-11-08T07:00:01Z'));
  assert.ok(isClosed(oct), 'October closed at Sun 8 Nov 07:00 UTC');
  assert.equal(nov.phase, 1, 'November’s week 1 began at the same instant');
  assert.deepEqual(liveSeasons(ann, false).map(s => s.id), ['2026-11'], 'one live season again');
  assert.equal(nov.matches.filter(m => m.week === 0 && !m.result).length, 0, 'the unplayed sign-up week game is gone');
});
