/* League test rig: nine simulated players (client/docs/20-league.md §10b).
 *
 *   node client/server/e2e/league-seed.ts [--base http://127.0.0.1:5177]
 *        [--organizer <your name> --password <yours>] [--season <id>]
 *
 * Registers nine accounts (or logs back into them), each with a DIFFERENT
 * time zone and week of hours — chosen so pairing has real choices to make:
 * a European evening cluster, an American one, a weekend-only player, an
 * Australian who overlaps almost nobody, and a lunchtime player who overlaps
 * nobody at all (to see the organizer preview's red rows).
 *
 * With --organizer/--password/--season it also ADDS them to that season via
 * the organizer route, which skips the Discord check: the sims have no
 * Discord link, and with ALGO_LEAGUE_DM_REDIRECT set on the test bot their
 * DMs come to you anyway. The organizer must already be an admin — the
 * §10b checklist grants it with the tester token first.
 *
 * Not a test (no test- prefix, so suite.test.ts does not run it). It refuses
 * to point at the deployed site.
 */
const arg = (k: string, d = ''): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] ?? d : d;
};
const BASE = arg('base', 'http://127.0.0.1:5177').replace(/\/+$/, '');
if (/algomancy\.online|algomancyonline|benslanguagelab/.test(BASE)) {
  console.error('refusing: this seeds fake players, and that is the live site');
  process.exit(1);
}
const PASSWORD = 'sim-player-password';

/** hours on the given days (0 = Monday), local, `to` may pass 24 */
function grid(days: number[], from: number, to: number, extra: [number[], number, number][] = []): string {
  const g = new Array<string>(168).fill('0');
  for (const [ds, f, t] of [[days, from, to] as [number[], number, number], ...extra]) {
    for (const d of ds) for (let h = f; h < t; h++) g[(d * 24 + h) % 168] = '1';
  }
  return g.join('');
}
const WEEKNIGHTS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const EVERY = [0, 1, 2, 3, 4, 5, 6];

const SIMS: { name: string; tz: string; grid: string; note: string }[] = [
  { name: 'SimLondon', tz: 'Europe/London', grid: grid(WEEKNIGHTS, 19, 23), note: 'UK weeknights' },
  { name: 'SimParis', tz: 'Europe/Paris', grid: grid(WEEKNIGHTS, 20, 23, [[[5], 14, 18]]), note: 'weeknights + Saturday afternoon' },
  { name: 'SimBerlin', tz: 'Europe/Berlin', grid: grid(WEEKEND, 10, 22), note: 'weekends only' },
  { name: 'SimNewYork', tz: 'America/New_York', grid: grid(WEEKNIGHTS, 19, 23), note: 'US east weeknights' },
  { name: 'SimChicago', tz: 'America/Chicago', grid: grid(WEEKNIGHTS, 18, 22, [[[6], 12, 18]]), note: 'weeknights + Sunday' },
  { name: 'SimLA', tz: 'America/Los_Angeles', grid: grid(WEEKNIGHTS, 18, 22), note: 'US west weeknights' },
  { name: 'SimNightOwl', tz: 'America/New_York', grid: grid(EVERY, 21, 26), note: 'every night 9pm–2am, bridges US and Europe mornings' },
  { name: 'SimSydney', tz: 'Australia/Sydney', grid: grid(WEEKNIGHTS, 19, 23), note: 'overlaps almost nobody' },
  { name: 'SimLunch', tz: 'UTC', grid: grid(WEEKNIGHTS, 11, 14), note: 'weekday lunchtimes — should show as a red row' },
];

async function post(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (r.status === 404) return { ok: false, error: `404 from ${path} (not an admin? wrong server?)` };
  return await r.json() as Record<string, unknown>;
}

/* The server brakes both doors at ten a minute from one address — failed
 * logins and new accounts — and a fresh store spends nine of each here, so
 * a brake is waited out rather than fatal. */
async function signIn(name: string, password: string): Promise<string> {
  for (let tries = 0; ; tries++) {
    let r = await post('/api/auth/login', { username: name, password });
    if (!r['ok'] && !/wait a minute/.test(String(r['error']))) r = await post('/api/auth/register', { username: name, password });
    if (r['ok']) return r['token'] as string;
    if (tries < 2 && /wait a minute/.test(String(r['error']))) {
      console.log(`  … the server's sign-in brake is on; waiting a minute (${name})`);
      await new Promise(res => setTimeout(res, 61_000));
      continue;
    }
    throw new Error(`${name}: ${r['error']}`);
  }
}

console.log(`seeding ${SIMS.length} simulated players on ${BASE}`);
for (const s of SIMS) {
  const token = await signIn(s.name, PASSWORD);
  const av = await post('/api/league/availability', { tz: s.tz, grid: s.grid, contact: `${s.name.toLowerCase()}_discord` }, token);
  console.log(`  ${av['ok'] ? '✓' : '✗'} ${s.name.padEnd(12)} ${s.tz.padEnd(20)} ${s.note}${av['ok'] ? '' : ` — ${av['error']}`}`);
}

const org = arg('organizer'), season = arg('season');
if (org && season) {
  const token = await signIn(org, arg('password'));
  for (const s of SIMS) {
    const r = await post('/api/league/admin/add', { id: season, name: s.name }, token);
    console.log(`  ${r['ok'] ? '✓ added' : `✗ ${r['error']}`}  ${s.name}`);
  }
} else {
  console.log('(no --organizer/--password/--season: players made, not added to a season)');
}
console.log(`\nevery sim's password is "${PASSWORD}" — sign in as one in another browser (or at localhost vs 127.0.0.1) to see their view`);
