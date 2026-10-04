/* The league over HTTP, against the real server (run: node test-league.ts).
 * docs/20-league.md; the logic is pinned in-process by test/376–379 — this is
 * the transport, the gates, a league game played over the socket, and a restart.
 *
 * §1 ⭐ THREE GATES, EACH A PLAIN 404: /api/league/admin/* to a non-admin and
 *    to nobody; /api/league/bot/* without the bot token and with a wrong one
 * §2 the organizer creates a manual season and opens sign-ups
 * §3 a player: availability is validated, sign-up refuses without a Discord
 *    NAME — typed, not linked (owner, 2026-10-04) — and works once given;
 *    a linked account's handle also serves
 * §4 ⭐ the availability is PRIVATE: /api/me has it, /api/player does not
 * §5 week 1: pairings, "my matches" with the shared windows
 * §6 ⭐ THE OUTBOX: the bot sees each player's rows with their Discord id,
 *    acks them, and an acked row is not offered again
 * §7 the bot's own routes: join by Discord id, status
 * §9 ⭐ A LEAGUE MATCH, PLAYED: Play opens one room for both players and
 *    nobody else, the trio method is fixed to random, a concede settles the
 *    match, and the saved room is tagged and rated
 * §8 ⭐ A RESTART keeps the season, the pairings, the result and the unsent rows
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer, type ServerHandle } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-league-e2e-'));
const BOT = 'league-bot-token';
const TESTER = 'league-tester-token';
const ENV = {
  ALGO_BOT_TOKEN: BOT, ALGO_TESTER_TOKEN: TESTER,
  ALGO_ACCOUNTS_FILE: join(SCRATCH, 'accounts.json'), ALGO_GAMES_DIR: join(SCRATCH, 'games'),
  ALGO_ISSUES_FILE: join(SCRATCH, 'issues.jsonl'), ALGO_LEAGUE_FILE: join(SCRATCH, 'league.json'),
};

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

let server: ServerHandle = await spawnServer(ENV);
const url = (p: string): string => `http://localhost:${server.port}${p}`;
type J = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; type: string; json: J }> {
  const res = await fetch(url(p), {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, json: type.includes('json') ? await res.json() as J : {} };
}
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const bot = (token = BOT) => ({ 'x-algo-bot': token });

async function register(name: string): Promise<string> {
  const r = await call('POST', '/api/auth/register', { username: name, password: 'correct horse battery' });
  if (!r.json['ok']) throw new Error(`register ${name}: ${r.json['error']}`);
  return r.json['token'] as string;
}
async function link(token: string, discordId: string, name: string): Promise<boolean> {
  const code = (await call('POST', '/api/link/discord/code', {}, as(token))).json['code'];
  return (await call('POST', '/api/bot/link/claim', { code, discordId, discordName: name }, bot())).json['ok'] === true;
}
const EVENINGS = Array.from({ length: 168 }, (_, i) => (i % 24 >= 18 && i % 24 < 23 ? '1' : '0')).join('');

try {
  const org = await register('Organizer');
  const p1 = await register('Pia');

  console.log('\n[§1 ⭐ three gates, each a plain 404]');
  for (const [who, h] of [['nobody', {}], ['a player', as(p1)]] as const) {
    const r = await call('POST', '/api/league/admin/create', { id: 'x' }, h);
    eq([r.status, r.type.startsWith('text/plain')], [404, true], `admin route to ${who}`);
  }
  for (const [who, h] of [['no token', {}], ['a wrong token', bot('nope')], ['a player session', as(p1)]] as const) {
    const r = await call('GET', '/api/league/bot/outbox', undefined, h);
    eq([r.status, r.type.startsWith('text/plain')], [404, true], `bot route with ${who}`);
  }
  const none = await call('GET', '/api/league');
  eq([none.status, none.json['season'], none.json['organizer']], [200, null, false], 'the public page answers with no season');

  console.log('\n[§2 the organizer creates a season]');
  const grant = await call('POST', '/api/admin/grant', { name: 'Organizer' }, { 'x-algo-tester': TESTER });
  eq(grant.json['ok'], true, 'the organizer is an admin');
  const now = Date.now();
  const created = await call('POST', '/api/league/admin/create', {
    id: 'e2e', name: 'E2E Season', signupOpens: new Date(now + 86_400_000).toISOString(),
    start: new Date(now + 7 * 86_400_000).toISOString(), weeks: 2, perWeek: 2, auto: false, hidden: false,
  }, as(org));
  eq(created.json, { ok: true, id: 'e2e' }, 'created');
  eq((await call('POST', '/api/league/admin/create', { id: 'e2e', name: 'Again', signupOpens: new Date(now).toISOString(), start: new Date(now).toISOString(), weeks: 2, perWeek: 2 }, as(org))).json['ok'],
    false, 'the same id twice is refused');
  const opened = await call('POST', '/api/league/admin/advance', { id: 'e2e' }, as(org));
  eq([opened.json['ok'], opened.json['label']], [true, 'Sign-up week'], 'Advance opens sign-ups ahead of the calendar');

  console.log('\n[§3 a player signs up]');
  eq((await call('POST', '/api/league/availability', { tz: 'Mars/Olympus', grid: EVENINGS }, as(p1))).json['error'], 'unknown time zone', 'a made-up zone');
  eq((await call('POST', '/api/league/availability', { tz: 'Europe/London', grid: '1' }, as(p1))).json['ok'], false, 'a grid that is not a week');
  eq((await call('POST', '/api/league/availability', { tz: 'Europe/London', grid: EVENINGS })).status, 401, 'signed out');
  eq((await call('POST', '/api/league/availability', { tz: 'Europe/London', grid: EVENINGS }, as(p1))).json['ok'], true, 'a real week');
  const refused = await call('POST', '/api/league/join', { season: 'e2e' }, as(p1));
  ok(/Discord name/.test(String(refused.json['error'])), `⭐ no Discord name → refused, asking for one (${refused.json['error']})`);
  ok(await link(p1, '9001', 'pia'), 'linked the real way: a minted code, claimed by the bot');
  eq((await call('POST', '/api/league/join', { season: 'e2e' }, as(p1))).json, { ok: true }, '…and a linked handle serves as the name');

  const others: string[] = [];
  const tokenOf: Record<string, string> = { Pia: p1 };
  for (const [i, tz] of ['America/New_York', 'Europe/Berlin', 'Europe/Madrid'].entries()) {
    const t = await register(`Player${i}`);
    const saved = await call('POST', '/api/league/availability', { tz, grid: EVENINGS, contact: `@player${i}_dc` }, as(t));
    eq(saved.json['contact'], `player${i}_dc`, `Player${i} types a Discord name (the @ is dropped)`);
    eq((await call('POST', '/api/league/join', { season: 'e2e' }, as(t))).json['ok'], true, `⭐ Player${i} joins with no link at all`);
    others.push(t);
    tokenOf[`Player${i}`] = t;
  }
  eq((await call('POST', '/api/league/availability', { tz: 'Europe/London', grid: EVENINGS, contact: 'x'.repeat(41) }, as(p1))).json['ok'],
    false, 'a Discord name over 40 characters');
  eq((await call('POST', '/api/league/skip', { season: 'e2e', week: 2, skip: true }, as(others[2]!))).json['skips'], [2], 'a skip for week 2');

  console.log('\n[§4 ⭐ availability is private]');
  const me = await call('GET', '/api/me', undefined, as(p1));
  eq(me.json['me']['availability']?.['tz'], 'Europe/London', '/api/me has it');
  const pub = await call('GET', '/api/player?name=Pia');
  ok(!('availability' in pub.json['player']) && !JSON.stringify(pub.json).includes(EVENINGS), '⭐ /api/player does not');
  eq(pub.json['player']['trophies'], [], '…but shows trophies (none yet)');

  console.log('\n[§5 week 1]');
  const preview = await call('POST', '/api/league/admin/preview', { id: 'e2e' }, as(org));
  eq([preview.json['week'], preview.json['edges'].length], [1, 4], 'the preview: four players × two opponents');
  ok((preview.json['edges'] as J[]).every(e => (e['a'] === 'Player0' || e['b'] === 'Player0') === (e['score'] < 2)),
    '⭐ the preview flags exactly the pairs that cannot meet');
  eq((await call('POST', '/api/league/admin/advance', { id: 'e2e' }, as(org))).json['label'], 'Week 1 of 2', 'advanced');
  const page = await call('GET', '/api/league', undefined, as(p1));
  const mine = page.json['season']['me']['matches'] as J[];
  eq(mine.length, 2, 'Pia has her two opponents');
  // Player0 is in New York: 18:00–23:00 there overlaps a European evening by
  // an hour at most, so his matches have NO window and every other one does
  ok(mine.every(m => (m['opponent']['name'] === 'Player0') === (m['windows'].length === 0)),
    'each European pair shares its evenings; a match with New York shares none');
  eq(page.json['season']['matches'].length, 4, 'four matches in the week');
  ok(!('log' in page.json['season']) && !('outbox' in page.json['season']), 'a player does not see the organizer\'s log or outbox');
  const orgPage = await call('GET', '/api/league', undefined, as(org));
  ok(Array.isArray(orgPage.json['season']['outbox']), 'the organizer does');

  console.log('\n[§6 ⭐ the outbox]');
  const box = await call('GET', '/api/league/bot/outbox?limit=100', undefined, bot());
  const rows = box.json['rows'] as J[];
  const pairings = rows.filter(r => r['kind'] === 'pairings');
  eq(pairings.length, 4, 'four pairings messages');
  ok(pairings.every(r => r['to']['discordId'] === '9001' || /^player\d_dc$/.test(r['to']['contact'])),
    '⭐ each addressed by Discord id when linked, else carrying the typed name');
  ok(pairings.every(r => r['data']['opponents'].every((o: J) => r['people'][o['id']]?.['contact'])),
    'every opponent it names comes with a Discord name');
  ok(rows.some(r => r['kind'] === 'week-pairings' && r['to'] === null), 'and one for the channel');
  const ack = await call('POST', '/api/league/bot/ack', { sent: pairings.map(r => r['id']), failed: { [rows[0]!['id']]: 'dm-closed' } }, bot());
  ok((ack.json['updated'] as number) >= 4, `acked (${ack.json['updated']})`);
  const after = (await call('GET', '/api/league/bot/outbox?limit=100', undefined, bot())).json['rows'] as J[];
  ok(!after.some(r => pairings.some(p => p['id'] === r['id'])), '⭐ an acked row is not offered again');
  const pending = after.map(r => r['id']);

  console.log('\n[§7 the bot\'s own routes]');
  const st = await call('GET', '/api/league/bot/status?discord=9001', undefined, bot());
  eq([st.json['linked'], st.json['season']['me']['entered']], [true, true], 'status by Discord id');
  eq((await call('GET', '/api/league/bot/status?discord=1234', undefined, bot())).json['linked'], false, 'an unknown Discord id is not linked');
  eq((await call('POST', '/api/league/bot/join', { discordId: '1234' }, bot())).json['error'], 'not-linked', 'joining from an unlinked Discord');
  eq((await call('POST', '/api/league/bot/skip', { discordId: '9001', week: 2, skip: true }, bot())).json['skips'], [2], 'a skip from Discord');

  console.log('\n[§9 ⭐ a league match, played]');
  const pm = (await call('GET', '/api/league', undefined, as(p1))).json['season']['me']['matches'][0] as J;
  const oppTok = tokenOf[pm['opponent']['name']]!;
  ok(pm['playable'] === true && typeof pm['opponent']['contact'] === 'string', 'Pia\'s match is playable, with her opponent\'s Discord name');
  const third = Object.entries(tokenOf).find(([n]) => n !== 'Pia' && n !== pm['opponent']['name'])![1];
  const o1 = await call('POST', '/api/league/play', { season: 'e2e', match: pm['id'] }, as(p1));
  const o2 = await call('POST', '/api/league/play', { season: 'e2e', match: pm['id'] }, as(oppTok));
  ok(o1.json['ok'] && typeof o1.json['room'] === 'string', `Play opens a room (${o1.json['room'] ?? o1.json['error']})`);
  eq(o2.json['room'], o1.json['room'], '⭐ both players land in the SAME room');
  ok((o1.json['seat'] as number) + (o2.json['seat'] as number) === 1, 'each is told their own seat');
  eq((await call('POST', '/api/league/play', { season: 'e2e', match: pm['id'] }, as(third))).json['error'],
    'that is not your match', 'a third player cannot open it');
  const ROOM = o1.json['room'] as string;
  const waits = ((await call('GET', '/api/league/bot/outbox?limit=100', undefined, bot())).json['rows'] as J[])
    .filter(r => r['kind'] === 'waiting');
  eq(waits.length, 1, 'the first Play told the other player somebody is waiting — once per half hour, not on every press');

  type Msg = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const client = async (): Promise<{ ws: WebSocket; msgs: Msg[] }> => {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    const msgs: Msg[] = [];
    ws.addEventListener('message', ev => msgs.push(JSON.parse(String((ev as MessageEvent).data)) as Msg));
    await new Promise(r => ws.addEventListener('open', () => r(null), { once: true }));
    return { ws, msgs };
  };
  const settle = (ms = 500): Promise<void> => new Promise(r => setTimeout(r, ms));
  const a = await client(), b = await client(), c = await client();
  a.ws.send(JSON.stringify({ t: 'join', room: ROOM, seat: o1.json['seat'], token: p1, mode: 'draft' }));
  b.ws.send(JSON.stringify({ t: 'join', room: ROOM, seat: o2.json['seat'], token: oppTok, mode: 'draft' }));
  c.ws.send(JSON.stringify({ t: 'join', room: ROOM, token: third, mode: 'draft' }));
  await settle();
  ok(c.msgs.some(m => m['t'] === 'error'), '⭐ a third account is refused a seat');
  const trio = [...a.msgs].reverse().find(m => m['waiting']?.['trio'])?.['waiting']['trio'] as Msg | undefined;
  eq([trio?.['method'], (trio?.['methods'] as Msg[] | undefined)?.map(x => x['id'])], ['random', ['random']],
    '⭐ the lobby offers one method: random');
  a.ws.send(JSON.stringify({ t: 'lobby', method: 'pick-one' }));
  await settle(300);
  const kept = [...a.msgs].reverse().find(m => m['waiting']?.['trio'])?.['waiting']['trio'] as Msg | undefined;
  eq(kept?.['method'], 'random', 'and it cannot be changed');
  a.ws.send(JSON.stringify({ t: 'lobby', submission: {}, lock: true }));
  b.ws.send(JSON.stringify({ t: 'lobby', submission: {}, lock: true }));
  await settle();
  const dealt = [...a.msgs].reverse().find(m => m['trio']?.['els']);
  ok(dealt && (dealt['trio']['els'] as string[]).length === 3 && /random/.test(String(dealt['trio']['how'])),
    `both ready → a random trio (${dealt?.['trio']?.['els']})`);
  a.ws.send(JSON.stringify({ t: 'action', action: { type: 'concede', seat: o1.json['seat'] } }));
  await settle(800);
  const settled = ((await call('GET', '/api/league', undefined, as(p1))).json['season']['me']['matches'] as J[])
    .find(m => m['id'] === pm['id'])!;
  eq([settled['result']?.['outcome'] === 'a' || settled['result']?.['outcome'] === 'b', settled['result']?.['how'],
    settled['won'], settled['result']?.['code']], [true, 'played', false, ROOM], '⭐ the concede settled the match for her opponent');
  const savedRoom = JSON.parse(readFileSync(join(SCRATCH, 'games', `${ROOM}.json`), 'utf8')) as J;
  eq([savedRoom['league']?.['match'], savedRoom['rated']], [pm['id'], true], '⭐ the saved room is tagged and rated');
  eq((await call('POST', '/api/league/play', { season: 'e2e', match: pm['id'] }, as(p1))).json['error'],
    'that match is already decided', 'Play is done for it');
  for (const x of [a, b, c]) x.ws.close();

  console.log('\n[§8 ⭐ a restart keeps everything]');
  await server.stop();
  server = await spawnServer(ENV);
  const again = await call('GET', '/api/league', undefined, as(p1));
  eq([again.json['season']['label'], again.json['season']['matches'].length], ['Week 1 of 2', 4], 'the season and its pairings');
  eq((again.json['season']['matches'] as J[]).filter(m => m['result']?.['how'] === 'played').length, 1, 'and the played result');
  const still = (await call('GET', '/api/league/bot/outbox?limit=100', undefined, bot())).json['rows'] as J[];
  ok(pending.every(id => still.some(r => r['id'] === id)), '⭐ the same rows are still waiting for the bot');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : '\nall league e2e checks passed');
process.exit(failures ? 1 : 0);
