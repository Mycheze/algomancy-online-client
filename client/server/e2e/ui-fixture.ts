/* A made-up world for photographing the client (ui-shots.mjs).
 *
 *   node client/server/e2e/ui-fixture.ts --out <dir> [--cc]
 *
 * Boots the REAL server on throwaway state under <dir>/var and fills it
 * through the server's own routes and sockets — the same way the e2e tests
 * do (spawnServer, /api/auth/register, the tester-token admin grant, the
 * league organizer routes, games played over WebSockets and conceded) — never
 * by writing store files by hand. Writes <dir>/fixture.json: who is who, the
 * session tokens, the deck and season ids the shots need.
 *
 * EVERY NAME IS MADE UP. The repo is public; no real player appears here.
 *
 * ⭐ THE CLOCK IS PINNED. The server runs under pinned-server.mjs (NODE_OPTIONS
 * --import), its Date starting at a fixed instant and its Math.random and
 * crypto.randomInt seeded, so every stamp lands on the same
 * date whenever the fixture is built, and the league calendar and the weekly
 * challenge week are the same ones every time:
 *   phase A  SEED_CHALLENGE_NOW (Wed 28 Oct 2026) — Token Gesture's week is
 *            open; the challenge runs for it are submitted then
 *   phase B  SEED_NOW (Wed 4 Nov 2026) — the restart closes Token Gesture
 *            (its frozen board is written) and Something Big is open;
 *            everything else is seeded here
 *   shots    SHOTS_NOW, an hour later (ui-shots.mjs runs its server and
 *            freezes the browser's Date there)
 *
 * --cc adds the Competitive Constructed world (docs/22), which the shared
 * fixture predates: a deck with a sideboard and a swap preset, and a Best of
 * three paused between games 1 and 2 (so "Your matches" lists it and its room
 * shows the between-games screen). Off by default, so a rebuild of the
 * shared fixture without it seeds exactly what it did before; it runs LAST in
 * phase B for the same reason (the seeded randomness before it is untouched).
 *
 * What it does NOT make deterministic: ids, room codes and tokens are random
 * per build, and the seconds inside a stamp drift with how long a step took.
 * So build it ONCE and photograph the same <dir> before and after a change;
 * ui-shots.mjs copies <dir>/var into a fresh scratch directory for every run,
 * so a run never changes the fixture it read.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnServer, type ServerHandle } from './test-util.ts';
import { defaultDecks } from '../decks.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, 'pinned-server.mjs');

export const SEED_CHALLENGE_NOW = '2026-10-28T12:00:00.000Z';
export const SEED_NOW = '2026-11-04T12:00:00.000Z';
export const SHOTS_NOW = '2026-11-04T13:00:00.000Z';
export const TESTER = 'ui-fixture-tester-token';
export const PASSWORD = 'fixture-password-1';

/** the account names — all invented */
export const NAMES = {
  me: 'Quillon', friend: 'Marigold', asker: 'Tamsin',
  others: ['Oberon', 'Juniper', 'Fennick'], admin: 'Warden',
} as const;

/** Every state path the server reads, under one directory, plus the pinned
 * clock and randomness. Also used by ui-shots.mjs for the server it photographs. */
export function fixtureEnv(varDir: string, now: string): Record<string, string> {
  const opts = [process.env['NODE_OPTIONS'] ?? '', `--import=${pathToFileURL(PRELOAD).href}`].filter(Boolean).join(' ');
  return {
    ALGO_ACCOUNTS_FILE: join(varDir, 'accounts.json'),
    ALGO_GAMES_DIR: join(varDir, 'games'),
    ALGO_ISSUES_FILE: join(varDir, 'issues.jsonl'),
    ALGO_REPORT_RUNS_FILE: join(varDir, 'report-runs.jsonl'),
    ALGO_REPORT_MARKS_FILE: join(varDir, 'report-marks.jsonl'),
    ALGO_VERDICTS_FILE: join(varDir, 'verdicts.jsonl'),
    ALGO_LEAGUE_FILE: join(varDir, 'league.json'),
    ALGO_CR_COMMENTS_FILE: join(varDir, 'cr-comments.jsonl'),
    ALGO_CHALLENGES_DIR: join(varDir, 'challenges'),
    // docs/22: the Competitive match store. Missing until 2026-11-03, when
    // nothing in the fixture made a match; without it a match would be
    // written to the checkout's own var/matches
    ALGO_MATCHES_DIR: join(varDir, 'matches'),
    ALGO_OG_CACHE_DIR: join(varDir, 'og-cache'),
    ALGO_TESTER_TOKEN: TESTER,
    // off, whatever the operator's shell exported (suite.test.ts says why)
    ALGO_BOT_TOKEN: '', ALGO_BOT_PUSH_URL: '', ALGO_PUBLIC_URL: '',
    // the judge / card-info proxy goes nowhere: a bot app that happens to be
    // running on :8000 must not leak into a photograph
    ALGO_BOT_URL: 'http://127.0.0.1:9',
    ALGO_FIXED_NOW: now,
    ALGO_FIXED_RANDOM: '20261104',
    NODE_OPTIONS: opts,
  };
}

export interface FixtureInfo {
  builtAt: string;
  password: string;
  tester: string;
  names: typeof NAMES;
  /** session tokens, by account name */
  tokens: Record<string, string>;
  /** the signed-in player's own decks, by role */
  decks: { pub: string; unlisted: string; maybe: string };
  /** a deck of somebody else's that is public (the shared-deck view) */
  sharedDeck: string;
  seasons: Record<'announced' | 'signup' | 'running' | 'final' | 'finished', string>;
  challenge: { current: string; past: string };
  /** --cc only: the Competitive Constructed world (absent from the shared fixture) */
  cc?: {
    /** the signed-in player's deck with a sideboard and a swap preset */
    deck: string;
    /** the Best of three, game 1 won by the signed-in player, paused between games */
    match: string;
    /** the room the match waits in for game 2, and the signed-in player's seat in it */
    room: string;
    seat: number;
  };
  gaps: string[];
}

// ── plumbing ────────────────────────────────────────────────────────────

type J = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let server: ServerHandle | null = null;
let ip = 0;
const base = (): string => `http://localhost:${server!.port}`;

async function call(method: string, path: string, body?: unknown, token?: string, fresh = false): Promise<J> {
  const res = await fetch(base() + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // the sign-up brake is ten a minute per address; the server reads the
      // forwarded address from a loopback peer, so each sign-up gets its own
      ...(fresh ? { 'x-forwarded-for': `10.9.0.${++ip}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') ?? '';
  const json = type.includes('json') ? await res.json() as J : { text: await res.text() };
  return { ...json, _status: res.status };
}
const post = (p: string, b: unknown, t?: string): Promise<J> => call('POST', p, b, t);
const get = (p: string, t?: string): Promise<J> => call('GET', p, undefined, t);

function must(r: J, what: string): J {
  if (!r['ok']) throw new Error(`${what}: ${JSON.stringify(r).slice(0, 300)}`);
  return r;
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// ── a seat over a WebSocket, and a game driven to a given turn ─────────

interface Act { type: string; seat?: number; columns?: unknown[]; blocks?: Record<string, unknown>; [k: string]: unknown }

class Sock {
  ws: WebSocket;
  msgs: J[] = [];
  legal: Act[] = [];
  view: J | null = null;
  seat = -1;
  constructor() { this.ws = new WebSocket(`ws://localhost:${server!.port}`); }
  async open(): Promise<this> {
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(String((ev as MessageEvent).data)) as J;
      this.msgs.push(m);
      if (Array.isArray(m['legal'])) this.legal = m['legal'] as Act[];
      if (m['view']) this.view = m['view'] as J;
      if (typeof m['seat'] === 'number') this.seat = m['seat'] as number;
    });
    await new Promise(r => this.ws.addEventListener('open', () => r(null), { once: true }));
    return this;
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(pred: (m: J) => boolean): J | undefined { return [...this.msgs].reverse().find(pred); }
  close(): void { try { this.ws.close(); } catch { /* gone */ } }
}

/** the "do nothing" move for whatever step this is (test-drive.ts passAction),
 * plus putting back the first two cards of the opening hand */
function passMove(legal: Act[]): Act | null {
  const noop = (a: Act): boolean =>
    a.type === 'donePlanning' || a.type === 'doneHaste' || a.type === 'doneDeploying' ||
    a.type === 'passPriority' ||
    (a.type === 'declareAttack' && Array.isArray(a.columns) && a.columns.length === 0) ||
    (a.type === 'declareBlocks' && !!a.blocks && Object.keys(a.blocks).length === 0);
  return legal.find(a => a.type === 'bottomCards') ?? legal.find(noop) ?? null;
}

/** Both seats pass until the game reaches `turn`, then `loser` concedes. A
 * concession on turn 1 is a walkover and moves no rating or card ladder
 * (CR D8.5), so the default is turn 3. */
async function driveAndConcede(seats: [Sock, Sock], loser: 0 | 1, turn = 3): Promise<void> {
  const bySeat = (s: number): Sock => (seats[0].seat === s ? seats[0] : seats[1]);
  for (let i = 0; i < 600; i++) {
    const t = Number(seats[0].view?.['turn'] ?? 0);
    if (t >= turn) break;
    let moved = false;
    for (const c of seats) {
      const mv = passMove(c.legal.filter(a => a.seat === undefined || a.seat === c.seat));
      if (!mv) continue;
      const before = c.msgs.length;
      c.send({ t: 'action', action: mv });
      for (let w = 0; w < 100 && c.msgs.length === before; w++) await sleep(10);
      await sleep(15);
      moved = true;
      break;
    }
    if (!moved) await sleep(40);
  }
  const l = bySeat(loser);
  l.send({ t: 'action', action: { type: 'concede', seat: loser } });
  await sleep(500);
}

// ── the build ───────────────────────────────────────────────────────────

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export async function buildFixture(outDir: string, opts: { cc?: boolean } = {}): Promise<FixtureInfo> {
  const out = resolve(outDir);
  const varDir = join(out, 'var');
  rmSync(varDir, { recursive: true, force: true });
  mkdirSync(join(varDir, 'games'), { recursive: true });
  const gaps: string[] = [];
  const tokens: Record<string, string> = {};
  const everyone = [NAMES.me, NAMES.friend, NAMES.asker, ...NAMES.others, NAMES.admin];
  const tok = (n: string): string => tokens[n]!;

  // ── phase A: last week's challenge is open ──
  server = await spawnServer(fixtureEnv(varDir, SEED_CHALLENGE_NOW));
  try {
    for (const n of everyone) {
      const r = must(await call('POST', '/api/auth/register', { username: n, password: PASSWORD }, undefined, true), `register ${n}`);
      tokens[n] = r['token'] as string;
    }
    const past = '2026-11-01-tokens';
    const ref = JSON.parse(readFileSync(join(HERE, '..', 'challenge-runs', `${past}.json`), 'utf8')) as J;
    for (const n of [NAMES.friend, NAMES.others[0], NAMES.others[1]]) {
      const r = await post('/api/challenge/run', { challengeId: past, deck: ref['deck'], actions: ref['actions'] }, tok(n));
      if (!r['ok']) gaps.push(`past challenge run by ${n}: ${r['error']}`);
    }
  } finally { await server.stop(); }

  // ── phase B: this week ──
  server = await spawnServer(fixtureEnv(varDir, SEED_NOW));
  let info: FixtureInfo;
  try {
    const grant = await fetch(`${base()}/api/admin/grant`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-algo-tester': TESTER },
      body: JSON.stringify({ name: NAMES.admin }),
    }).then(r => r.json()) as J;
    must(grant, 'admin grant');
    const badge = await post('/api/admin/setbadge', { name: NAMES.admin, owner: true }, tok(NAMES.admin));
    if (!badge['ok']) gaps.push(`admin badge: ${badge['error'] ?? badge['_status']}`);

    // favourites (the profile's element chip)
    const favs: Record<string, string> = { [NAMES.me]: 'fire', [NAMES.friend]: 'water', [NAMES.others[0]]: 'earth' };
    for (const [n, el] of Object.entries(favs)) await post('/api/me/favorite', { element: el }, tok(n));

    // ── friends: one friend, one request waiting ──
    must(await post('/api/friends/request', { username: NAMES.friend }, tok(NAMES.me)), 'friend request');
    const fme = await get('/api/me', tok(NAMES.friend));
    const reqs = JSON.stringify(fme['me'] ?? {});
    const meId = (await get('/api/me', tok(NAMES.me)))['me']?.['id'] as string | undefined;
    if (meId && reqs.includes(meId)) must(await post('/api/friends/accept', { id: meId }, tok(NAMES.friend)), 'friend accept');
    else gaps.push('friend accept: could not find the request id');
    must(await post('/api/friends/request', { username: NAMES.me }, tok(NAMES.asker)), 'pending friend request');

    // ── decks ──
    const defs = defaultDecks().filter(d => !d.problems.length);
    if (defs.length < 4) throw new Error('fewer than four playable default decks');
    const mk = async (who: string, name: string, cards: string[], extra: J = {}): Promise<string> => {
      const r = must(await post('/api/decks/create', { name, cards }, tok(who)), `deck ${name}`);
      const id = (r['deck']?.['id'] ?? r['id']) as string;
      if (Object.keys(extra).length) must(await post('/api/decks/update', { id, ...extra }, tok(who)), `deck update ${name}`);
      return id;
    };
    await get('/api/decks', tok(NAMES.me));   // seeds the starter five first, as a first visit does
    const dPub = await mk(NAMES.me, 'Ember Rush', defs[0]!.cards, {
      visibility: 'public',
      description: 'A fast deck that wants the game over by turn six.\n\nKeep two cheap units in the opening hand and attack every turn.',
    });
    const dUnl = await mk(NAMES.me, 'Tidecaller Control', defs[1]!.cards, { visibility: 'unlisted' });
    const dMaybe = await mk(NAMES.me, 'Grove Keepers', defs[2]!.cards, { maybe: defs[3]!.cards.slice(0, 6) });
    const shared = await mk(NAMES.others[0], 'Stonewall', defs[3]!.cards, {
      visibility: 'public', description: 'Big blockers, then one big swing.',
    });
    await mk(NAMES.others[1], 'Night Market', defs[1]!.cards, { visibility: 'public' });
    await mk(NAMES.friend, 'Undertow', defs[2]!.cards, { visibility: 'public', description: 'Water and dark, slow and mean.' });
    const deckOf: Record<string, string> = {
      [NAMES.me]: dPub,
      [NAMES.friend]: await mk(NAMES.friend, 'Practice Deck', defs[0]!.cards),
      [NAMES.others[0]]: shared,
      [NAMES.others[1]]: await mk(NAMES.others[1], 'Practice Deck', defs[2]!.cards),
    };

    // ── rated games through the queue (the ladder shows a player from their
    //    fifth rated game): a round robin of four, two games a pair ──
    const ladder = [NAMES.me, NAMES.friend, NAMES.others[0], NAMES.others[1]];
    let rated = 0;
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < ladder.length; i++) {
        for (let j = i + 1; j < ladder.length; j++) {
          const [na, nb] = [ladder[i]!, ladder[j]!];
          const a = await new Sock().open(), b = await new Sock().open();
          try {
            a.send({ t: 'queue', token: tok(na), q: 'join', mode: 'constructed', ranked: true, deckId: deckOf[na] });
            await sleep(150);
            b.send({ t: 'queue', token: tok(nb), q: 'join', mode: 'constructed', ranked: true, deckId: deckOf[nb] });
            for (let w = 0; w < 50 && !(a.last(m => m['queue']?.['offer'] || m['offer']) && b.last(m => m['queue']?.['offer'] || m['offer'])); w++) await sleep(50);
            a.send({ t: 'queue', token: tok(na), q: 'accept' });
            b.send({ t: 'queue', token: tok(nb), q: 'accept' });
            let ma: J | undefined, mb: J | undefined;
            for (let w = 0; w < 60 && !(ma && mb); w++) {
              await sleep(50);
              ma = a.last(m => !!m['matched'])?.['matched'] as J | undefined;
              mb = b.last(m => !!m['matched'])?.['matched'] as J | undefined;
            }
            if (!ma || !mb) { gaps.push(`queue match ${na} v ${nb}: no match`); continue; }
            const ga = await new Sock().open(), gb = await new Sock().open();
            ga.send({ t: 'join', room: ma['room'], seat: ma['seat'], token: tok(na) });
            gb.send({ t: 'join', room: mb['room'], seat: mb['seat'], token: tok(nb) });
            for (let w = 0; w < 60 && !(ga.view && gb.view); w++) await sleep(50);
            // vary the winner so the ladder is not one long streak
            const loserName = (i + j + round) % 3 === 0 ? na : nb;
            const loserSeat = (loserName === na ? ma['seat'] : mb['seat']) as 0 | 1;
            await driveAndConcede([ga, gb], loserSeat);
            ga.close(); gb.close();
            rated++;
          } finally { a.close(); b.close(); }
        }
      }
    }
    if (rated < 12) gaps.push(`only ${rated} of 12 rated games were played`);

    // ── single card duels (the card ladder): signed in, turn 3, conceded ──
    // a card is ranked from its fifth non-mirror duel: three cards, four
    // rounds of the three pairings, so each has eight; and one mirror
    const trio = ['Soul Swallower', 'Flame Shield', 'Hearthwood Ancient'];
    const duelCards: [string, string][] = [];
    for (let r = 0; r < 4; r++) for (const [x, y] of [[0, 1], [1, 2], [2, 0]] as const) duelCards.push([trio[x]!, trio[y]!]);
    duelCards.push([trio[0]!, trio[0]!]);
    for (const [k, [x, y]] of duelCards.entries()) {
      const code = (await get('/api/new'))['code'] as string;
      const a = await new Sock().open();
      a.send({ t: 'join', room: code, seat: 0, token: tok(NAMES.me), mode: 'constructed', single: x });
      await sleep(300);
      const b = await new Sock().open();
      b.send({ t: 'join', room: code, seat: 1, token: tok(NAMES.friend), mode: 'constructed', single: y });
      for (let w = 0; w < 60 && !(a.view && b.view); w++) await sleep(50);
      if (!a.view) { gaps.push(`single card duel ${x} v ${y}: not dealt (${JSON.stringify(a.last(m => m['t'] === 'error') ?? {})})`); a.close(); b.close(); continue; }
      await driveAndConcede([a, b], ((k * 7) % 3 === 0 ? 1 : 0) as 0 | 1);
      a.close(); b.close();
    }

    // ── this week's challenge: the signed-in player and two others ──
    const cur = '2026-11-08-giant';
    const ref = JSON.parse(readFileSync(join(HERE, '..', 'challenge-runs', `${cur}.json`), 'utf8')) as J;
    for (const n of [NAMES.me, NAMES.others[2], NAMES.friend]) {
      const r = await post('/api/challenge/run', { challengeId: cur, deck: ref['deck'], actions: ref['actions'] }, tok(n));
      if (!r['ok']) gaps.push(`challenge run by ${n}: ${r['error']}`);
    }

    // ── the league: one season in each phase the calendar has ──
    const org = tok(NAMES.admin);
    const day = (iso: string): string => new Date(iso).toISOString();
    const entrants = [NAMES.me, NAMES.friend, NAMES.asker, ...NAMES.others];
    const zones = ['Europe/London', 'America/New_York', 'Europe/Berlin', 'Australia/Sydney', 'America/Chicago', 'UTC'];
    const EVENINGS = Array.from({ length: 168 }, (_, h) => (h % 24 >= 18 && h % 24 < 23 ? '1' : '0')).join('');
    const WEEKENDS = Array.from({ length: 168 }, (_, h) => (h >= 120 && h % 24 >= 10 && h % 24 < 20 ? '1' : '0')).join('');
    for (const [k, n] of entrants.entries()) {
      must(await post('/api/league/availability', {
        tz: zones[k % zones.length], grid: k % 3 === 2 ? WEEKENDS : EVENINGS, contact: `${n.toLowerCase()}_plays`,
      }, tok(n)), `availability ${n}`);
    }
    const create = async (id: string, name: string, signupOpens: string, start: string, weeks: number, format?: string): Promise<void> => {
      must(await post('/api/league/admin/create', {
        id, name, signupOpens: day(signupOpens), start: day(start), weeks, perWeek: 2, auto: false, hidden: false,
        ...(format ? { format } : {}),
      }, org), `season ${id}`);
    };
    const advance = async (id: string): Promise<void> => { must(await post('/api/league/admin/advance', { id }, org), `advance ${id}`); };
    const joinAll = async (id: string, who: readonly string[]): Promise<void> => {
      for (const n of who) must(await post('/api/league/join', { season: id }, tok(n)), `join ${id} ${n}`);
    };
    /** settle every undecided match of the current week, sparing `keep` */
    const settle = async (id: string, keepFor?: string): Promise<void> => {
      const page = await get(`/api/league?season=${id}`, org);
      const matches = (page['season']?.['matches'] ?? []) as J[];
      const meName = keepFor;
      for (const [k, m] of matches.entries()) {
        if (m['result']) continue;
        const names = JSON.stringify(m);
        if (meName && names.includes(`"${meName}"`)) continue;
        await post('/api/league/admin/result', { id, match: m['id'], outcome: k % 4 === 3 ? 'unplayed' : k % 2 ? 'a' : 'b', note: '' }, org);
      }
    };

    // finished: a two-week season, every match settled, the final played
    await create('equinox', 'Equinox Open', '2026-09-20T07:00:00Z', '2026-09-27T07:00:00Z', 2);
    await advance('equinox');
    await joinAll('equinox', entrants.slice(0, 4));
    await advance('equinox'); await settle('equinox');
    await advance('equinox'); await settle('equinox');
    await advance('equinox'); await settle('equinox');   // the final
    await advance('equinox');                             // closed

    // the final: weeks done, the final waiting
    await create('solstice', 'Solstice Cup', '2026-10-04T07:00:00Z', '2026-10-11T07:00:00Z', 3);
    await advance('solstice');
    await joinAll('solstice', entrants.slice(0, 4));
    for (let w = 0; w < 3; w++) { await advance('solstice'); await settle('solstice'); }
    await advance('solstice');

    // running: week 2 of 3, the signed-in player's own matches still to play
    await create('harvest', 'Harvest League', '2026-10-18T07:00:00Z', '2026-10-25T07:00:00Z', 3);
    await advance('harvest');
    await joinAll('harvest', entrants);
    await advance('harvest'); await settle('harvest');
    await advance('harvest'); await settle('harvest', NAMES.me);

    // sign-up week, constructed
    await create('autumn', 'Autumn Constructed', '2026-11-01T07:00:00Z', '2026-11-08T07:00:00Z', 3, 'constructed');
    await advance('autumn');
    await joinAll('autumn', [NAMES.friend, NAMES.asker, ...NAMES.others]);   // the signed-in player has not joined yet

    // announced: sign-ups not open
    await create('winter', 'Winter Cup', '2026-11-29T07:00:00Z', '2026-12-06T07:00:00Z', 4);

    // ── playtest reports (the admin's Reports tab) ──
    const reports: [string, string, string][] = [
      ['bug', 'major', 'The deck page jumped back to the top after I renamed a deck.'],
      ['rules', 'minor', 'Should the shield come off before or after damage is dealt?'],
      ['idea', 'minor', 'It would be nice to sort the card list by cost.'],
    ];
    for (const [k, [kind, severity, note]] of reports.entries()) {
      await post('/api/report', { room: '', note, kind, severity, page: k ? 'decks' : 'home' }, tok(k === 1 ? NAMES.friend : NAMES.me));
    }

    // ── a rules-review comment (the badge-gated review page) ──
    const cr = await post('/api/cr/comment', { op: 'add', target: 'sec:608', body: 'This sentence could say who the "players" are.' }, tok(NAMES.admin));
    if (!cr['ok']) gaps.push(`rules review comment: ${cr['error'] ?? cr['_status']}`);

    // ── --cc: Competitive Constructed (docs/22). LAST, so nothing above moves ──
    let cc: FixtureInfo['cc'];
    if (opts.cc) {
      /** a sideboard of `n` cards that keeps every card at two across both boards (CR 901.9b) */
      const sideFor = (main: string[], from: string[], n: number): string[] => {
        const count = new Map<string, number>();
        for (const c of main) count.set(c, (count.get(c) ?? 0) + 1);
        const side: string[] = [];
        for (const c of from) {
          if (side.length >= n) break;
          if ((count.get(c) ?? 0) >= 2 || side.includes(c)) continue;
          count.set(c, (count.get(c) ?? 0) + 1);
          side.push(c);
        }
        return side;
      };
      const meMain = defs[0]!.cards, frMain = defs[2]!.cards;
      const meSide = sideFor(meMain, [...defs[1]!.cards, ...defs[3]!.cards], 5);
      const frSide = sideFor(frMain, [...defs[3]!.cards, ...defs[1]!.cards], 3);
      const ccMe = await mk(NAMES.me, 'Ember Rush (Competitive)', meMain, {
        sideboard: meSide,
        swaps: [
          { id: 'fx-swap-control', name: 'Against control', out: meMain.slice(0, 2), in: meSide.slice(0, 2) },
          { id: 'fx-swap-wide', name: 'Against go-wide', out: [meMain[4]!], in: [meSide[2]!] },
        ],
      });
      const ccFr = await mk(NAMES.friend, 'Undertow (Competitive)', frMain, { sideboard: frSide });
      const code = (await get('/api/new'))['code'] as string;
      const a = await new Sock().open();
      a.send({ t: 'join', room: code, seat: 0, mode: 'constructed', cc: { bestOf: 3 }, deckId: ccMe, token: tok(NAMES.me) });
      for (let w = 0; w < 60 && !a.last(m => m['t'] === 'joined'); w++) await sleep(50);
      const b = await new Sock().open();
      b.send({ t: 'join', room: code, deckId: ccFr, token: tok(NAMES.friend), pick: true });
      for (let w = 0; w < 80 && !(a.view && b.view); w++) await sleep(50);
      if (!a.view || !b.view) {
        gaps.push(`cc match: game 1 not dealt (${JSON.stringify(a.last(m => m['t'] === 'error') ?? b.last(m => m['t'] === 'error') ?? {})})`);
      } else {
        // game 1: the friend concedes, so the signed-in player leads 1-0 and
        // the friend (the loser) chooses the initiative for game 2
        b.send({ t: 'action', action: { type: 'concede', seat: b.seat } });
        let next: J | undefined;
        for (let w = 0; w < 80 && !(next = a.last(m => m['t'] === 'match')); w++) await sleep(50);
        const room = next?.['room'] as string | undefined;
        if (!room) gaps.push('cc match: no next room after game 1');
        else {
          // both into the next room, then a pause both agree to: a paused
          // match survives the restart into the shots server unchanged
          // (server test 818), and its screen does not count down
          const a2 = await new Sock().open(), b2 = await new Sock().open();
          a2.send({ t: 'join', room, token: tok(NAMES.me) });
          for (let w = 0; w < 60 && !a2.last(m => m['t'] === 'joined'); w++) await sleep(50);
          b2.send({ t: 'join', room, token: tok(NAMES.friend) });
          for (let w = 0; w < 60 && !b2.last(m => m['t'] === 'joined'); w++) await sleep(50);
          b2.send({ t: 'cc', op: 'pause' });
          await sleep(300);
          a2.send({ t: 'cc', op: 'pause' });
          for (let w = 0; w < 60 && !a2.last(m => m['waiting']?.['match']?.['phase'] === 'paused'); w++) await sleep(50);
          if (!a2.last(m => m['waiting']?.['match']?.['phase'] === 'paused')) gaps.push('cc match: the pause was not agreed');
          const mine = await get('/api/matches/mine', tok(NAMES.me));
          const listed = ((mine['matches'] ?? []) as J[])[0];
          cc = { deck: ccMe, match: String(listed?.['id'] ?? ''), room, seat: Number(a2.seat) };
          a2.close(); b2.close();
        }
      }
      a.close(); b.close();
    }

    info = {
      builtAt: SEED_NOW, password: PASSWORD, tester: TESTER, names: NAMES, tokens,
      decks: { pub: dPub, unlisted: dUnl, maybe: dMaybe }, sharedDeck: shared,
      seasons: { announced: 'winter', signup: 'autumn', running: 'harvest', final: 'solstice', finished: 'equinox' },
      challenge: { current: cur, past: '2026-11-01-tokens' },
      ...(cc ? { cc } : {}),
      gaps,
    };
  } finally {
    await server.stop();
    server = null;
  }

  // ⚠ A GAME FILE'S MTIME IS ITS DATE. history.ts reads it as "when this game
  // was played" on every boot and re-folds the profile when it differs from
  // the row it has — and the OS stamps a write in real time, which the pinned
  // clock cannot reach. So pin each file to its own last move (what rooms.ts
  // pinMtime does for a closed file), then boot once so that import settles
  // into accounts.json; every later boot finds nothing to change.
  const pinGames = (): void => {
    const dir = join(varDir, 'games');
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const p = join(dir, f);
      const raw = JSON.parse(readFileSync(p, 'utf8')) as J;
      const at = Number(raw['lastActionAt'] ?? raw['startedAt'] ?? Date.parse(SEED_NOW));
      utimesSync(p, at / 1000, at / 1000);
    }
  };
  pinGames();
  server = await spawnServer(fixtureEnv(varDir, SEED_NOW));
  try { await get('/api/me', tokens[NAMES.me]); } finally { await server.stop(); server = null; }
  pinGames();
  writeFileSync(join(out, 'fixture.json'), JSON.stringify(info, null, 2) + '\n');
  return info;
}

/** copy a built fixture's state into a fresh directory for one run */
export function copyFixtureVar(fixtureDir: string, runVar: string): void {
  rmSync(runVar, { recursive: true, force: true });
  // timestamps kept: a game file's mtime is its date (see buildFixture)
  cpSync(join(resolve(fixtureDir), 'var'), runVar, { recursive: true, preserveTimestamps: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = arg('out');
  if (!outDir) { console.error('usage: node ui-fixture.ts --out <dir>'); process.exit(2); }
  if (existsSync(join(outDir, 'fixture.json')) && !process.argv.includes('--force')) {
    console.error(`${outDir}/fixture.json exists — pass --force to rebuild (and re-shoot your "before")`);
    process.exit(2);
  }
  const t = Date.now();
  const r = await buildFixture(outDir, { cc: process.argv.includes('--cc') });
  console.log(`fixture built in ${((Date.now() - t) / 1000).toFixed(0)}s at ${resolve(outDir)}`);
  if (r.gaps.length) console.log(`gaps:\n  ${r.gaps.join('\n  ')}`);
}
