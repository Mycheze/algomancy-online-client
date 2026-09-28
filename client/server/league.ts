/* THE LEAGUE — the pure half (docs/20-league.md).
 *
 * Everything here is a function of its arguments: availability and overlap,
 * pairing, standings, and the season's calendar. No I/O, no `Date.now()`, no
 * accounts — league-store.ts is the half that owns those and calls in. That
 * split is what lets the tests pin a pairing, run a season across the two
 * October DST changes, and brute-force the small cases, without a server.
 *
 * ── AVAILABILITY IS STORED IN THE PLAYER'S OWN LOCAL TIME ────────────────
 *
 * A grid of 168 hours (Monday 00:00 → Sunday 23:00, local) plus an IANA zone.
 * NOT a set of UTC hours: "weeknights 7–10pm" has to stay 7–10pm across a DST
 * change, and a UTC grid would silently slide it an hour twice a year. So
 * overlap is only ever computed for a CONCRETE week, by walking that week's
 * real UTC hours and asking each player's zone what local hour it is
 * (`utcHours`). The pilot season straddles the UK change (25 Oct 2026) and the
 * US one (1 Nov 2026); 342-league-availability pins both.
 */

export const DAYS = 7;
export const GRID_LEN = DAYS * 24;
export const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;

/** A playable window is at least this many shared hours in a row: a live
 * draft on a 60+60 clock can run well past one hour. */
export const WINDOW_HOURS = 2;
/** The pairing wants at least this many distinct days holding a window… */
export const OVERLAP_TARGET = 2;
/** …and prefers this many — the owner's "several time slot overlaps". */
export const OVERLAP_PREFERRED = 3;
/** Fewer marked hours than this a week and sign-up refuses (docs/20 §9 Q8). */
export const MIN_HOURS = 6;

/** Monday first, the grid's order. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface Availability {
  /** IANA zone, e.g. `Europe/London` */
  tz: string;
  /** 168 characters of '0'/'1', index = day * 24 + hour, day 0 = Monday, LOCAL */
  grid: string;
}

// ── availability ──────────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Is this a zone the runtime knows? */
export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { fmtFor(tz); return true; } catch { return false; }
}

/** A grid as the client sent it, or null if it is not one. */
export function sanitizeGrid(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length === GRID_LEN && /^[01]+$/.test(raw) ? raw : null;
}

export const hoursIn = (grid: string): number => [...grid].filter(c => c === '1').length;

/** The grid slot (day * 24 + hour, local, Monday = 0) that instant `ms` falls in. */
export function localSlot(ms: number, tz: string): number {
  let day = 0, hour = 0;
  for (const p of fmtFor(tz).formatToParts(ms)) {
    if (p.type === 'weekday') day = DAY_NAMES.indexOf(p.value as typeof DAY_NAMES[number]);
    else if (p.type === 'hour') hour = Number(p.value) % 24;
  }
  return day * 24 + hour;
}

/**
 * Which of the 168 UTC hours starting at `weekStartMs` this player is free
 * in. An hour that a DST change skips locally is simply never asked about; an
 * hour it repeats is asked twice. Both are what a person would expect.
 */
export function utcHours(av: Availability, weekStartMs: number): boolean[] {
  const key = `${av.tz}|${weekStartMs}|${av.grid}`;
  const hit = hoursMemo.get(key);
  if (hit) return hit;
  const out: boolean[] = [];
  for (let h = 0; h < GRID_LEN; h++) out.push(av.grid[localSlot(weekStartMs + h * HOUR_MS, av.tz)] === '1');
  // 168 Intl lookups each; a pairing asks for every player against every other
  if (hoursMemo.size > 2000) hoursMemo.clear();
  hoursMemo.set(key, out);
  return out;
}
const hoursMemo = new Map<string, boolean[]>();

/** A run of shared hours: `start` is epoch ms, `hours` its length. */
export interface Window { start: number; hours: number }

/** Every run of at least `min` consecutive hours both players are free, in
 * the week starting at `weekStartMs`. */
export function sharedWindows(
  a: Availability | null, b: Availability | null, weekStartMs: number, min = WINDOW_HOURS,
): Window[] {
  if (!a || !b) return [];
  const ua = utcHours(a, weekStartMs), ub = utcHours(b, weekStartMs);
  const out: Window[] = [];
  let run = 0;
  for (let h = 0; h <= GRID_LEN; h++) {
    if (h < GRID_LEN && ua[h] && ub[h]) { run++; continue; }
    if (run >= min) out.push({ start: weekStartMs + (h - run) * HOUR_MS, hours: run });
    run = 0;
  }
  return out;
}

/**
 * How many real chances two players have to meet: the number of distinct
 * (UTC) days on which a window starts. Three windows on one evening are one
 * chance, not three — within a day they are already merged into one run, and
 * a lunchtime and an evening on the same day still count once.
 */
export function overlapScore(windows: Window[]): number {
  return new Set(windows.map(w => Math.floor(w.start / (24 * HOUR_MS)))).size;
}

/** The grid every first-timer's editor starts from: weeknights 7–11pm. */
export function defaultGrid(): string {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 5; d++) for (let h = 19; h < 23; h++) g[d * 24 + h] = '1';
  return g.join('');
}

// ── seeded randomness ─────────────────────────────────────────────────

/** FNV-1a — a string to a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32 — small, fast, and the same everywhere */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── pairing ───────────────────────────────────────────────────────────

/**
 * The cost of pairing two players. The ORDER of these weights is the owner's
 * stated priority — availability first, then a fresh opponent, then record —
 * and the numbers are only tuning: one missing day of overlap (1000) must
 * outweigh any number of repeats a month can produce, and a repeat (60) must
 * outweigh any win gap a month can produce (12 matches × 10 = 120 is the
 * theoretical worst, two repeats beat it).
 */
export const PAIR_COST = {
  /** fewer than OVERLAP_TARGET distinct days: they probably cannot meet */
  noOverlap: 1000,
  /** at the target but short of "several" */
  thinOverlap: 30,
  /** per earlier meeting this season */
  repeat: 60,
  /** per league win of difference */
  winGap: 10,
} as const;

export interface PairingPlayer {
  id: string;
  /** league wins this season so far — the "record" in "matched by record" */
  wins: number;
  av: Availability | null;
  /** how many weeks this player has already been the short seat */
  shortCount: number;
  /** current standing, 1 = top; breaks the short-seat tie the Swiss way (a bye goes low) */
  rank: number;
}

export interface PairingEdge {
  a: string;
  b: string;
  windows: Window[];
  /** overlapScore of the windows */
  score: number;
  cost: number;
}

export interface Pairing {
  edges: PairingEdge[];
  /** the player with one opponent fewer this week, when the numbers are odd */
  short: string | null;
  /** every pair below OVERLAP_TARGET — what the organizer is shown before publishing */
  weak: PairingEdge[];
  total: number;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Pair one week: every player gets `perWeek` opponents (capped at n − 1), and
 * when n × perWeek is odd exactly one player — the short seat — gets one fewer.
 *
 * A small degree-constrained matching, solved by search rather than exactly:
 * a randomised Havel–Hakimi start (which always succeeds on these degree
 * sequences), a random walk of degree-preserving swaps, then a descent that
 * takes any swap (a–b, c–d) → (a–c, b–d) or (a–d, b–c) that lowers the total,
 * restarted many times. N is a few dozen at most; an exact max-weight
 * b-matching is not worth its code. Deterministic from `seed`, so an admin
 * preview and the real publish agree.
 */
export function pairWeek(input: {
  players: PairingPlayer[];
  perWeek: number;
  weekStartMs: number;
  /** pairKey → how many times these two have already met this season */
  met: ReadonlyMap<string, number>;
  seed: string;
  restarts?: number;
}): Pairing {
  const players = [...input.players].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const n = players.length;
  const d = Math.max(0, Math.min(input.perWeek, n - 1));
  const empty: Pairing = { edges: [], short: null, weak: [], total: 0 };
  if (n < 2 || d === 0) return { ...empty, short: n === 1 ? players[0]!.id : null };
  const rand = rng(hashSeed(input.seed));

  // who is short, when the degree sum is odd: fewest times short already,
  // then the lowest standing, then the seed
  let short = -1;
  if ((n * d) % 2 === 1) {
    const order = players.map((p, i) => ({ i, k: p.shortCount, r: -p.rank, t: rand() }))
      .sort((x, y) => x.k - y.k || x.r - y.r || x.t - y.t);
    short = order[0]!.i;
  }
  const want = players.map((_, i) => (i === short ? d - 1 : d));

  // the cost of every possible pair, once
  const windows: Window[][][] = players.map(() => []);
  const cost: number[][] = players.map(() => new Array<number>(n).fill(0));
  const score: number[][] = players.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = sharedWindows(players[i]!.av, players[j]!.av, input.weekStartMs);
      const s = overlapScore(w);
      const c = (s < OVERLAP_TARGET ? PAIR_COST.noOverlap : s < OVERLAP_PREFERRED ? PAIR_COST.thinOverlap : 0)
        + (input.met.get(pairKey(players[i]!.id, players[j]!.id)) ?? 0) * PAIR_COST.repeat
        + Math.abs(players[i]!.wins - players[j]!.wins) * PAIR_COST.winGap;
      windows[i]![j] = windows[j]![i] = w;
      score[i]![j] = score[j]![i] = s;
      cost[i]![j] = cost[j]![i] = c;
    }
  }

  let best: [number, number][] | null = null;
  let bestTotal = Infinity;
  const restarts = input.restarts ?? 40;
  for (let r = 0; r < restarts; r++) {
    const edges = havelHakimi(want, rand);
    if (!edges) break;   // not graphical — cannot happen for these sequences
    const has = new Set(edges.map(([a, b]) => a * n + b));
    const key = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
    const trySwap = (i: number, j: number, flip: boolean, accept: (delta: number) => boolean): boolean => {
      const [a, b] = edges[i]!, [c, e] = edges[j]!;
      if (a === c || a === e || b === c || b === e) return false;
      const [p, q, s, t] = flip ? [a, e, b, c] : [a, c, b, e];
      if (has.has(key(p, q)) || has.has(key(s, t))) return false;
      const delta = cost[p]![q]! + cost[s]![t]! - cost[a]![b]! - cost[c]![e]!;
      if (!accept(delta)) return false;
      has.delete(key(a, b)); has.delete(key(c, e));
      edges[i] = p < q ? [p, q] : [q, p];
      edges[j] = s < t ? [s, t] : [t, s];
      has.add(key(p, q)); has.add(key(s, t));
      return true;
    };
    // random walk: a different start every restart
    for (let k = 0; k < edges.length * 6; k++) {
      trySwap(Math.floor(rand() * edges.length), Math.floor(rand() * edges.length), rand() < 0.5, () => true);
    }
    // descent
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          if (trySwap(i, j, false, dl => dl < 0) || trySwap(i, j, true, dl => dl < 0)) improved = true;
        }
      }
    }
    const total = edges.reduce((sum, [a, b]) => sum + cost[a]![b]!, 0);
    if (total < bestTotal) { bestTotal = total; best = edges.map(e => [...e] as [number, number]); }
  }

  const out: PairingEdge[] = (best ?? [])
    .map(([i, j]) => ({
      a: players[i]!.id, b: players[j]!.id, windows: windows[i]![j]!, score: score[i]![j]!, cost: cost[i]![j]!,
    }))
    .sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  return {
    edges: out,
    short: short >= 0 ? players[short]!.id : null,
    weak: out.filter(e => e.score < OVERLAP_TARGET),
    total: bestTotal === Infinity ? 0 : bestTotal,
  };
}

/** A simple graph with exactly these degrees, or null if there is none.
 * Randomised only in how ties are broken. */
function havelHakimi(want: number[], rand: () => number): [number, number][] | null {
  const left = want.map((k, i) => ({ i, k, t: rand() }));
  const edges: [number, number][] = [];
  for (;;) {
    left.sort((x, y) => y.k - x.k || x.t - y.t);
    const top = left[0];
    if (!top || top.k === 0) return edges;
    if (top.k > left.length - 1) return null;
    for (let m = 1; m <= top.k; m++) {
      const o = left[m]!;
      if (o.k === 0) return null;
      o.k--;
      edges.push(top.i < o.i ? [top.i, o.i] : [o.i, top.i]);
    }
    top.k = 0;
  }
}

// ── matches and standings ─────────────────────────────────────────────

export type Outcome = 'a' | 'b' | 'unplayed' | 'double-loss';

export interface MatchResult {
  outcome: Outcome;
  /** how it was settled: at the table, by the week closing on it, or by the organizer */
  how: 'played' | 'deadline' | 'organizer';
  /** the room code, when it was played */
  code?: string;
  at: string;
  note?: string;
}

export interface LeagueMatch {
  id: string;
  /** 1..weeks for a week match; weeks + 1 for the final */
  week: number;
  final?: true;
  a: string;
  b: string;
  windows: Window[];
  result?: MatchResult;
  /** the room this match is being played in, once somebody opened it */
  room?: string;
}

export interface StandingRow {
  id: string;
  w: number;
  l: number;
  unplayed: number;
  points: number;
  /** opponents' match-win percentage, 0–1, each opponent floored at ⅓ */
  omw: number;
  rank: number;
}

export const POINTS_PER_WIN = 3;
export const OMW_FLOOR = 1 / 3;

/** Did this match produce a result anybody's record counts? */
const decided = (m: LeagueMatch): boolean => !!m.result && m.result.outcome !== 'unplayed';

/**
 * The table: 3 points a win; ties broken by OMW% (BL-04's settled tiebreak),
 * then head to head inside the tied group, then fewer unplayed, then id (so
 * the order is total and stable). The final is not in it — the table is what
 * PICKS the finalists.
 */
export function standings(ids: readonly string[], matches: readonly LeagueMatch[]): StandingRow[] {
  const games = matches.filter(m => !m.final);
  const rec = new Map(ids.map(id => [id, { w: 0, l: 0, unplayed: 0, opps: [] as string[] }]));
  for (const m of games) {
    const a = rec.get(m.a), b = rec.get(m.b);
    if (!m.result) continue;
    if (m.result.outcome === 'unplayed') { if (a) a.unplayed++; if (b) b.unplayed++; continue; }
    if (a) a.opps.push(m.b);
    if (b) b.opps.push(m.a);
    if (m.result.outcome === 'a') { if (a) a.w++; if (b) b.l++; }
    else if (m.result.outcome === 'b') { if (b) b.w++; if (a) a.l++; }
    else { if (a) a.l++; if (b) b.l++; }
  }
  const mw = (id: string): number => {
    const r = rec.get(id);
    if (!r || r.w + r.l === 0) return OMW_FLOOR;
    return Math.max(OMW_FLOOR, r.w / (r.w + r.l));
  };
  const rows: StandingRow[] = ids.map(id => {
    const r = rec.get(id)!;
    const omw = r.opps.length ? r.opps.reduce((s, o) => s + mw(o), 0) / r.opps.length : 0;
    return { id, w: r.w, l: r.l, unplayed: r.unplayed, points: r.w * POINTS_PER_WIN, omw, rank: 0 };
  });
  // head to head: wins against the others in the same points/OMW group
  const h2h = (id: string, group: Set<string>): number => games.filter(m => decided(m)
    && ((m.a === id && group.has(m.b) && m.result!.outcome === 'a')
      || (m.b === id && group.has(m.a) && m.result!.outcome === 'b'))).length;
  const tieKey = (r: StandingRow): string => `${r.points}|${r.omw.toFixed(6)}`;
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = tieKey(r);
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(r.id);
  }
  rows.sort((x, y) => y.points - x.points || y.omw - x.omw
    || h2h(y.id, groups.get(tieKey(y))!) - h2h(x.id, groups.get(tieKey(x))!)
    || x.unplayed - y.unplayed || (x.id < y.id ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** How many times each pair has met this season (decided or not — a pairing
 * that went unplayed still used up that pairing). */
export function meetings(matches: readonly LeagueMatch[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) {
    const k = pairKey(m.a, m.b);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

// ── the season's calendar ─────────────────────────────────────────────

/**
 * A season's phase is one number:
 *   -1          announced — sign-ups not open yet
 *    0          sign-ups
 *    1..weeks   week k
 *    weeks + 1  the final
 *    weeks + 2  closed
 */
export interface SeasonClock {
  signupOpens: string;
  /** week 1's first instant (ISO) — every later boundary is a whole week on */
  start: string;
  weeks: number;
}

export const finalPhase = (s: SeasonClock): number => s.weeks + 1;
export const closedPhase = (s: SeasonClock): number => s.weeks + 2;

/** When phase `p` begins, epoch ms. */
export function phaseStart(s: SeasonClock, p: number): number {
  if (p <= 0) return Date.parse(s.signupOpens);
  return Date.parse(s.start) + (Math.min(p, closedPhase(s)) - 1) * WEEK_MS;
}

/** The phase the calendar says it should be at `now`. */
export function calendarPhase(s: SeasonClock, now: number): number {
  let p = -1;
  while (p < closedPhase(s) && now >= phaseStart(s, p + 1)) p++;
  return p;
}

export function phaseLabel(s: SeasonClock, p: number): string {
  if (p < 0) return 'Announced';
  if (p === 0) return 'Sign-ups open';
  if (p <= s.weeks) return `Week ${p} of ${s.weeks}`;
  if (p === finalPhase(s)) return 'The final';
  return 'Finished';
}
