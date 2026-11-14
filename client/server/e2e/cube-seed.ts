/* Cube test rig: simulated players for a whole cube event (docs/25-cube-draft.md).
 *
 *   node client/server/e2e/cube-seed.ts --code ABCD [--base http://127.0.0.1:5177]
 *        [--sims 7] [--pick-ms 1500] [--concede-to-humans 0] [--seed 1]
 *        [--host-too --host <name> --host-password <pw> [--start] [--end-after <matches>]]
 *        [--create swiss|roundrobin|exhibition [--best-of 1|3] [--rounds 3]]   (needs --host-too)
 *
 * For testing a cube event ALONE on the dev server. Create the event in the
 * browser, then run this with its code: N sims (the same names every run, so
 * a re-run logs back into the same accounts) join the lobby and play the
 * other seats until the event is over:
 *
 *   drafting   each sim takes the view's `suggest` card after --pick-ms (or
 *              half its remaining clock, whichever is sooner)
 *   building   Suggest a deck, then submit it
 *   exhibition Ready stays on
 *   matches    sim vs sim: the alphabetically-first name presses Play, both
 *              join the room, and a seeded coin flip (per pairing and game:
 *              --seed) says who concedes — game after game, so a Best of 3
 *              goes through its between-games lobby, sometimes to game 3. Sim vs you: the sim joins once you press
 *              Play and then waits for you (it loses on time, or you concede);
 *              --concede-to-humans <s> makes it concede each game after s
 *              seconds, to click through rounds fast.
 *
 * --host-too drives the HOST account as one more sim (it is a player in its
 * own event): with --start it presses Start once every sim is in, and with
 * --create it makes the event itself — so a whole event runs with nobody
 * watching. Exhibition never ends by itself: --end-after <n> has the host end
 * it after n decided matches (otherwise you press End).
 *
 * One plain line per thing that happens; exits when the event is done or
 * cancelled. Not a test (no test- prefix: suite.test.ts does not run it), and
 * it refuses to point at the deployed site.
 */
import type { CubeMatchView, CubeView } from '../cube-types.ts';

const argv = process.argv.slice(2);
const flag = (k: string): boolean => argv.includes(`--${k}`);
const arg = (k: string, d = ''): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] ?? d : d;
};
const num = (k: string, d: number): number => {
  const v = Number(arg(k, String(d)));
  return Number.isFinite(v) ? v : d;
};

const BASE = arg('base', 'http://127.0.0.1:5177').replace(/\/+$/, '');
if (/algomancy\.online|algomancyonline|benslanguagelab/.test(BASE)) {
  console.error('refusing: this seeds fake players, and that is the live site');
  process.exit(1);
}
const WS_URL = BASE.replace(/^http/, 'ws');
const PASSWORD = 'sim-player-password';
const NAMES = ['Sim Ada', 'Sim Bram', 'Sim Cleo', 'Sim Dov', 'Sim Edda', 'Sim Finn', 'Sim Gus', 'Sim Hana',
  'Sim Ivo', 'Sim Juno', 'Sim Kai'];
const SIMS = Math.max(0, Math.min(NAMES.length, num('sims', 7)));
const PICK_MS = Math.max(0, num('pick-ms', 1500));
const CONCEDE_TO_HUMANS_MS = Math.max(0, num('concede-to-humans', 0)) * 1000;
const SEED = num('seed', 1);
const HOST_TOO = flag('host-too');
const END_AFTER = num('end-after', 0);
let CODE = arg('code').toUpperCase();

if (!HOST_TOO && (flag('start') || arg('create') || END_AFTER)) {
  console.error('--start, --create and --end-after drive the host: they need --host-too --host <name> --host-password <pw>');
  process.exit(1);
}
if (HOST_TOO && (!arg('host') || !arg('host-password'))) {
  console.error('--host-too needs --host <name> --host-password <pw>');
  process.exit(1);
}
if (!CODE && !arg('create')) {
  console.error('usage: node client/server/e2e/cube-seed.ts --code <event code> [--sims 7] [--pick-ms 1500] (see the header)');
  process.exit(1);
}

const say = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

type J = Record<string, any>;
async function http(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<J> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  try { return await r.json() as J; } catch { return { ok: false, error: `${r.status} from ${path}` }; }
}

/* The server brakes failed logins and new accounts at ten a minute from one
 * address; a fresh store spends one of each per sim, so a brake is waited out. */
async function signIn(name: string, password: string, mayRegister: boolean): Promise<string> {
  for (let tries = 0; ; tries++) {
    let r = await http('POST', '/api/auth/login', { username: name, password });
    if (!r['ok'] && mayRegister && !/wait a minute/.test(String(r['error']))) {
      r = await http('POST', '/api/auth/register', { username: name, password });
    }
    if (r['ok']) return r['token'] as string;
    if (tries < 3 && /wait a minute/.test(String(r['error']))) {
      say(`… the server's sign-in brake is on; waiting a minute (${name})`);
      await sleep(61_000);
      continue;
    }
    throw new Error(`${name}: ${r['error']}`);
  }
}

/** a stable 32-bit hash: the per-pairing coin flip */
function hash(s: string): number {
  let h = 2166136261 ^ SEED;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // FNV's low bit is just the parity of the input's: mix before the caller takes `& 1`
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

/* ── one simulated player ──────────────────────────────────────────────── */

class Sim {
  name: string;
  token = '';
  id = '';
  isHost = false;
  view: CubeView | null = null;
  cube!: WebSocket;
  game: WebSocket | null = null;
  /** the game room this sim's game socket sits in, and its seat there */
  room: string | null = null;
  seat: 0 | 1 | null = null;
  /** a game is dealt in `room` (not the between-games lobby) */
  dealt = false;
  /** the match being played in `room`, and every room joined (a Bo3 moves room each game, and
   *  the event view is not re-pushed on a move — a view naming an old room must not pull us back) */
  match: CubeMatchView | null = null;
  visited = new Set<string>();
  pickTimer: ReturnType<typeof setTimeout> | null = null;
  pickKey = '';
  busy = new Set<string>();      // in-flight HTTP ops, by name
  submitted = false;
  humanTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(name: string) { this.name = name; }

  async login(password: string, mayRegister: boolean): Promise<void> {
    this.token = await signIn(this.name, password, mayRegister);
    const me = await http('GET', '/api/me', undefined, this.token);
    this.id = String(me['me']?.id ?? '');
  }

  post(op: string, body: unknown = {}): Promise<J> {
    return http('POST', `/api/cube/${CODE}/${op}`, body, this.token);
  }

  /** run `op` once at a time; its refusal is logged, not thrown */
  async once(key: string, f: () => Promise<J>): Promise<J | null> {
    if (this.busy.has(key)) return null;
    this.busy.add(key);
    try {
      const r = await f();
      // two sims pressing Play at once (round robin, exhibition) is an ordinary race: the loser retries
      if (!r['ok'] && !(key === 'play' && /already playing|still playing/.test(String(r['error'])))) {
        say(`${this.name}: ${key} refused — ${r['error']}`);
      }
      this.busy.delete(key);   // before the view: the step it runs may need this op again
      if (r['view']) this.onView(r['view'] as CubeView);
      return r;
    } finally { this.busy.delete(key); }
  }

  openCube(): Promise<void> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(WS_URL);
      this.cube = ws;
      ws.addEventListener('open', () => { ws.send(JSON.stringify({ t: 'cube', op: 'sub', code: CODE, token: this.token })); res(); });
      ws.addEventListener('error', () => rej(new Error(`${this.name}: the cube socket did not open`)));
      ws.addEventListener('close', () => { if (!finished) say(`${this.name}: the cube socket closed`); });
      ws.addEventListener('message', ev => {
        const m = JSON.parse(String((ev as MessageEvent).data)) as J;
        if (m['t'] !== 'cube') return;
        if (m['view']) this.onView(m['view'] as CubeView);
        else if (m['error']) say(`${this.name}: the event said “${m['error']}”`);
      });
    });
  }

  openGame(): Promise<void> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(WS_URL);
      this.game = ws;
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', () => rej(new Error(`${this.name}: the game socket did not open`)));
      ws.addEventListener('message', ev => this.onGame(JSON.parse(String((ev as MessageEvent).data)) as J));
    });
  }

  joinRoom(room: string, match?: CubeMatchView): void {
    if (this.room === room) return;
    if (match) this.match = match;
    this.visited.add(room);
    this.room = room;
    this.seat = null;
    this.dealt = false;
    this.game?.send(JSON.stringify({ t: 'join', room, token: this.token }));
  }

  onGame(m: J): void {
    if (m['t'] === 'joined' && m['room'] === this.room) {
      this.seat = m['seat'] as 0 | 1;
      this.dealt = !!m['view'];
      if (!this.dealt && m['waiting']?.match?.phase === 'between' && m['waiting'].match.chooser !== null) {
        this.readyUp(!!m['waiting'].match.locked);
      }
      afterGameChange(this);
    } else if (m['t'] === 'update' && m['waiting']?.match && this.room && !this.dealt) {
      // the between-games lobby: once the window locks only the chooser's Ready is left, so a
      // lock is the one push that may need a second Ready
      const mi = m['waiting'].match;
      if (mi.phase === 'between' && mi.chooser !== null && this.seat !== null && !mi.ready?.[this.seat]) this.readyUp(!!mi.locked);
    } else if (m['t'] === 'match') {
      // where the match went: its next game's room, or null = it is over (`match.room` is then the
      // room the last game was played in). An "over" for a room this socket has already left —
      // the view sent it on to its next pairing first — is old news.
      const next = m['room'] as string | null;
      if (!next && this.room !== m['match']?.room) return;
      this.dealt = false;
      if (this.humanTimer) { clearTimeout(this.humanTimer); this.humanTimer = null; }
      if (next && next !== this.room) this.joinRoom(next);
      else if (!next) {
        this.room = null; this.seat = null; this.match = null;
        // the event's push for this result can come BEFORE this message, while we still sat in
        // the room — so take the next step now, off the view we already have
        if (this.view) this.onView(this.view);
      }
    } else if (m['t'] === 'error' || m['t'] === 'kicked') {
      say(`${this.name}: the game said “${m['msg']}”`);
    }
  }

  /** between games: Ready, carrying the initiative choice (only the loser's counts) */
  readied = '';
  readyUp(locked: boolean): void {
    const key = `${this.room}:${locked}`;
    if (this.seat === null || this.readied === key) return;
    this.readied = key;
    this.game?.send(JSON.stringify({ t: 'cc', op: 'ready', ready: true, initiative: this.seat }));
  }

  concede(): void {
    if (this.seat === null || !this.dealt) return;
    this.game?.send(JSON.stringify({ t: 'action', action: { type: 'concede', seat: this.seat } }));
    this.dealt = false;
  }

  onView(v: CubeView): void {
    this.view = v;
    noteEvent(v);
    if (finished) return;
    if (v.phase === 'drafting') this.draftStep(v);
    else if (v.phase === 'building') this.buildStep(v);
    else if (v.phase === 'playing') this.playStep(v);
    if (this.isHost) hostStep(this, v);
  }

  draftStep(v: CubeView): void {
    const d = v.draft;
    if (!d?.pack || !d.pack.length) return;
    const key = `${d.packNo}:${d.pickNo}`;
    if (key === this.pickKey) return;
    this.pickKey = key;
    if (this.pickTimer) clearTimeout(this.pickTimer);
    const left = d.deadline !== null ? d.deadline - v.now : PICK_MS * 2;
    const wait = Math.max(50, Math.min(PICK_MS, left / 2));
    this.pickTimer = setTimeout(() => {
      this.pickTimer = null;
      const now = this.view?.draft;
      if (!now?.pack || `${now.packNo}:${now.pickNo}` !== key) return;   // the clock took it
      const card = now.suggest ?? now.pack[0]!;
      this.cube.send(JSON.stringify({ t: 'cube', op: 'pick', card }));
      if (!QUIET_PICKS) say(`${this.name} picked ${card} (pack ${now.packNo} pick ${now.pickNo})`);
    }, wait);
  }

  buildStep(v: CubeView): void {
    const meRow = v.players.find(p => p.user === v.me);
    if (!meRow || meRow.submitted || this.submitted) return;
    void this.once('deck', async () => {
      const s = await this.post('suggest');
      if (!s['ok']) return s;
      const r = await this.post('deck', { main: s['main'], side: s['side'] });
      if (r['ok']) { this.submitted = true; say(`${this.name} submitted a deck (${(s['main'] as string[]).length} + ${(s['side'] as string[]).length})`); }
      return r;
    });
  }

  playStep(v: CubeView): void {
    const meRow = v.players.find(p => p.user === v.me);
    if (!meRow || meRow.dropped) return;
    if (!meRow.submitted) this.buildStep({ ...v, phase: 'building' });
    if (v.config.tournament === 'exhibition' && !meRow.ready && !meRow.inMatch && meRow.submitted && !v.breakUntil
      && !v.myMatch) {
      void this.once('ready', () => this.post('ready', { on: true }));
    }
    const mine = v.matches.filter(x => x.b && x.status !== 'done' && (x.a.user === v.me || x.b.user === v.me));
    // a live match of mine: be in its room
    const live = mine.find(x => x.status === 'live' && x.room);
    if (live) {
      if (!this.visited.has(live.room!) && !this.busy.has('play')) this.joinRoom(live.room!, live);
      return;
    }
    if (meRow.inMatch || this.room) return;
    // sim vs sim, not started: the first name of the two presses Play (round robin: whichever
    // opponent is free right now)
    const busyNow = new Set(v.players.filter(p => p.inMatch).map(p => p.user));
    const mineToStart = mine.filter(x => x.status === 'waiting' && !busyNow.has(opp(x, v.me!).user)
      && simById.has(opp(x, v.me!).user) && this.name.localeCompare(opp(x, v.me!).name) < 0);
    const p = mineToStart[0];
    if (!p) return;
    void this.once('play', async () => {
      const r = await this.post('play', { pairing: p.pairing });
      if (r['ok'] && r['room']) this.joinRoom(String(r['room']), p);
      return r;
    });
  }
}

const opp = (x: CubeMatchView, me: string): { user: string; name: string } => (x.a.user === me ? x.b! : x.a);

/* ── the coin flip, and the human opponent's timer ─────────────────────── */

const simById = new Map<string, Sim>();
const conceded = new Set<string>();   // room codes a game was conceded in
const gamesPlayed = new Map<string, number>();   // pairing id → games conceded so far

/** on any change of a sim's game socket: does somebody concede now? */
function afterGameChange(s: Sim): void {
  const p = s.match;
  if (!s.room || !s.dealt || !p || !p.b) return;
  const other = opp(p, s.id);
  const partner = simById.get(other.user);
  if (partner) {
    // sim vs sim: both must be dealt into this room, then the flip's loser concedes
    if (partner.room !== s.room || !partner.dealt || conceded.has(s.room)) return;
    // a coin per game of the pairing, so a Best of 3 also reaches its third game
    const game = (gamesPlayed.get(p.pairing) ?? 0) + 1;
    gamesPlayed.set(p.pairing, game);
    const loserIsA = (hash(`${CODE}:${p.pairing}:${game}`) & 1) === 0;
    const loser = simById.get(loserIsA ? p.a.user : p.b.user)!;
    conceded.add(s.room);
    const room = s.room;
    setTimeout(() => { if (loser.room === room) loser.concede(); }, 200);
  } else if (CONCEDE_TO_HUMANS_MS > 0 && !s.humanTimer) {
    const room = s.room;
    s.humanTimer = setTimeout(() => {
      s.humanTimer = null;
      if (s.room === room && s.dealt) { say(`${s.name} concedes to ${other.name}`); s.concede(); }
    }, CONCEDE_TO_HUMANS_MS);
  }
}

/* ── the host, when the script drives it ───────────────────────────────── */

let started = false;
let ending = false;
function hostStep(h: Sim, v: CubeView): void {
  if (v.phase === 'lobby' && flag('start') && !started && v.players.length >= sims.length) {
    started = true;
    void h.once('start', () => h.post('start'));
  }
  if (v.phase === 'playing' && END_AFTER > 0 && !ending && v.matches.filter(x => x.status === 'done' && x.b).length >= END_AFTER) {
    ending = true;
    say(`${h.name} (host) ends the event after ${END_AFTER} matches`);
    void h.once('end', () => h.post('end'));
  }
}

/* ── one line per thing that happens (read off whichever view comes first) ── */

const QUIET_PICKS = flag('quiet-picks');
const PHASES: CubeView['phase'][] = ['lobby', 'drafting', 'building', 'playing', 'done', 'cancelled'];
let lastPhase = '';
let finished = false;
const loggedMatches = new Set<string>();
const postedMatches = new Set<string>();
const t0 = Date.now();

function noteEvent(v: CubeView): void {
  noteMatches(v);
  // each sim's socket is its own stream, so one sim's last 'building' can land after another's
  // 'playing': the phase only ever moves forward
  if (PHASES.indexOf(v.phase) > PHASES.indexOf(lastPhase as CubeView['phase'])) {
    lastPhase = v.phase;
    const extra = v.phase === 'drafting' && v.draft
      ? ` — ${v.draft.seats.length} seats (${v.draft.seats.filter(s => s.bot).length} bots), ${v.draft.packs} packs of ${v.draft.packSize}`
      : v.phase === 'playing' ? ` — ${v.config.tournament}, Best of ${v.config.bestOf}` : '';
    say(`event ${v.code} is ${v.phase}${extra}`);
  }
  finish(v);
}

function noteMatches(v: CubeView): void {
  for (const x of v.matches) {
    const label = v.config.tournament === 'exhibition' ? `match ${x.pairing}` : `round ${x.round}`;
    if (!postedMatches.has(x.pairing) && x.status !== 'done') {
      postedMatches.add(x.pairing);
      if (x.b) say(`${label}: ${x.a.name} vs ${x.b.name}`);
    }
    if (x.status !== 'done' || loggedMatches.has(x.pairing)) continue;
    loggedMatches.add(x.pairing);
    postedMatches.add(x.pairing);
    if (!x.b) { say(`${label}: ${x.a.name} has a bye`); continue; }
    if (!x.winner) { say(`${label}: ${x.a.name} and ${x.b.name} — ${x.score ?? 'no result'}`); continue; }
    // the view's score is a's–b's; the line reads winner first
    const aWon = x.winner === x.a.user;
    const [w, l] = aWon ? [x.a, x.b] : [x.b, x.a];
    const sc = (x.score ?? '').split('–');
    say(`${label}: ${w.name} beat ${l.name}${sc.length === 2 ? ` ${aWon ? sc.join('–') : `${sc[1]}–${sc[0]}`}` : ''}`);
  }
}

function finish(v: CubeView): void {
  if ((v.phase === 'done' || v.phase === 'cancelled') && !finished) {
    finished = true;
    if (v.phase === 'done') {
      say(`standings after ${Math.round((Date.now() - t0) / 1000)} s:`);
      for (const r of v.standings) say(`  ${String(r.rank).padStart(2)}. ${r.name.padEnd(20)} ${r.points} pts  ${r.w}-${r.l}-${r.d}${r.dropped ? '  (dropped)' : ''}`);
    }
    setTimeout(() => {
      for (const s of sims) { try { s.cube.close(); } catch { /* closing */ } try { s.game?.close(); } catch { /* closing */ } }
      process.exit(0);
    }, 300);
  }
}

/* ── go ────────────────────────────────────────────────────────────────── */

const sims: Sim[] = [];
let host: Sim | null = null;
if (HOST_TOO) {
  host = new Sim(arg('host'));
  host.isHost = true;
  await host.login(arg('host-password'), false);
  sims.push(host);
}
say(`signing in ${SIMS} sims on ${BASE}`);
for (const n of NAMES.slice(0, SIMS)) {
  const s = new Sim(n);
  await s.login(PASSWORD, true);
  sims.push(s);
}
for (const s of sims) {
  if (!s.id) throw new Error(`${s.name}: signed in, but /api/auth/me named no account id`);
  simById.set(s.id, s);
}

if (arg('create')) {
  const tournament = arg('create');
  const r = await http('POST', '/api/cube/new', {
    config: { name: `Sim ${tournament}`, tournament, maxPlayers: num('seats', sims.length), fillBots: true,
      bestOf: num('best-of', 1) === 3 ? 3 : 1, swissRounds: num('rounds', 3) },
  }, host!.token);
  if (!r['ok']) { console.error(`could not create the event: ${r['error']}`); process.exit(1); }
  CODE = String(r['code']);
  say(`${host!.name} created event ${CODE} (${tournament})`);
}

for (const s of sims) {
  if (s.isHost) continue;
  const r = await s.post('join');
  if (!r['ok'] && !/already/.test(String(r['error']))) say(`${s.name}: join refused — ${r['error']}`);
  else say(`${s.name} joined ${CODE}`);
}
for (const s of sims) { await s.openGame(); await s.openCube(); }
say(`${sims.length} driven; waiting for the event to finish${flag('start') ? '' : ' (press Start when you are ready)'}`);
