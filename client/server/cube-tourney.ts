/* CUBE DRAFT EVENTS — the tournament, the pure half (docs/25-cube-draft.md §7).
 *
 * Standings, Swiss / round-robin / exhibition pairing, and the host's swap. Every function is a
 * function of its arguments: no I/O, no clock, no accounts, and NOTHING HERE MUTATES ITS INPUTS —
 * each returns new values. cube.ts (the controller) owns the event and calls in.
 *
 * ── WHAT COUNTS ─────────────────────────────────────────────────────────────
 * A pairing counts toward the standings when it is POSTED and has a RESULT. Nothing else does.
 * That is what makes a pre-resulted bye safe: `pairSwiss` returns a bye already carrying
 * `{kind: 'bye', at: 0, by: 'play'}` (so the controller never has to "play" one), but while the
 * round sits unposted in the break it scores nothing; posting it is what records it.
 *
 * ── POINTS AND TIE-BREAKS (the MTG standard, docs/25 §12 item 7) ────────────
 * 3 a win, 1 a draw, 0 a loss. A bye is a match win, played 2–0 in games.
 * Ties are broken, in order, by:
 *   OMW%  the mean of each opponent's match-win % (match points / 3 × matches), each floored at ⅓.
 *         Byes are not opponents. No opponents → 0.
 *   GW%   game points / games played (games won / games played — a game draw is not recorded),
 *         floored at ⅓. Games come from `result.games` ([a's, b's]) when present; otherwise a win
 *         is 1–0 (a Bo1), a draw is 0–0 (no games), a bye 2–0. No games played → ⅓.
 *   OGW%  the mean of each opponent's GW% (floored as above). No opponents → 0.
 *   join order (`joinedAt`, then the players array's order).
 * Every player keeps a distinct rank (1-based) in that final order. A player's own MW%/GW% include
 * their byes; only the opponents' averages leave the bye out.
 *
 * ── SWISS PAIRING ───────────────────────────────────────────────────────────
 * Round 1 is a seeded shuffle. Later rounds walk the standings top-down: the highest unpaired
 * player takes the highest player below them they have not met, and if that leaves the rest
 * unpairable the search backs up (memoised on the set left, so n = 16 is instant). That is
 * "pair within the points group, float down when needed", and it finds a no-rematch pairing
 * whenever one exists. Only when none exists does it allow rematches. With an odd count the bye
 * goes to the lowest-ranked player who has not had one (if all have, the lowest-ranked) — the
 * first such player whose bye still leaves the rest pairable without a rematch.
 */

import { rngShuffle } from '../engine/src/rng.ts';
import type { CubePlayer, Pairing, StandingRow } from './cube-types.ts';

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const PCT_FLOOR = 1 / 3;
/** a bye is a 2–0 match win */
export const BYE_GAMES: [number, number] = [2, 0];

const EPS = 1e-9;

/** does this pairing count toward the standings? */
const counts = (p: Pairing): boolean => p.posted && !!p.result;

const pairKey = (x: string, y: string): string => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

/** the games of one decided, non-bye pairing as [a's, b's] */
function gamesOf(p: Pairing): [number, number] {
  const r = p.result!;
  if (r.kind === 'bye') return [...BYE_GAMES];
  if (r.games) return [r.games[0], r.games[1]];
  if (r.kind === 'draw') return [0, 0];
  return r.winner === p.a ? [1, 0] : [0, 1];
}

interface Rec {
  w: number; l: number; d: number;
  gw: number; gp: number;          // games won, games played
  opps: string[];                  // one entry per non-bye match
}

function records(pairings: readonly Pairing[]): Map<string, Rec> {
  const recs = new Map<string, Rec>();
  const rec = (u: string): Rec => {
    let r = recs.get(u);
    if (!r) { r = { w: 0, l: 0, d: 0, gw: 0, gp: 0, opps: [] }; recs.set(u, r); }
    return r;
  };
  for (const p of pairings) {
    if (!counts(p)) continue;
    const res = p.result!;
    const ra = rec(p.a);
    if (p.b === null || res.kind === 'bye') {
      ra.w++; ra.gw += BYE_GAMES[0]; ra.gp += BYE_GAMES[0] + BYE_GAMES[1];
      continue;
    }
    const rb = rec(p.b);
    ra.opps.push(p.b); rb.opps.push(p.a);
    const [ga, gb] = gamesOf(p);
    ra.gw += ga; rb.gw += gb; ra.gp += ga + gb; rb.gp += ga + gb;
    if (res.kind === 'draw') { ra.d++; rb.d++; }
    else if (res.winner === p.a) { ra.w++; rb.l++; }
    else { rb.w++; ra.l++; }
  }
  return recs;
}

const pointsOf = (r: Rec | undefined): number => (r ? r.w * POINTS_WIN + r.d * POINTS_DRAW : 0);
function mwPct(r: Rec | undefined): number {
  if (!r) return PCT_FLOOR;
  const n = r.w + r.l + r.d;
  return n ? Math.max(PCT_FLOOR, pointsOf(r) / (POINTS_WIN * n)) : PCT_FLOOR;
}
const gwPct = (r: Rec | undefined): number => (r && r.gp ? Math.max(PCT_FLOOR, r.gw / r.gp) : PCT_FLOOR);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** the table, best first. Dropped players stay in it (`dropped: true`). */
export function standings(players: CubePlayer[], pairings: Pairing[]): StandingRow[] {
  const recs = records(pairings);
  const rows = players.map((pl, i) => {
    const r = recs.get(pl.user);
    const opps = r ? r.opps : [];
    return {
      i,
      joinedAt: pl.joinedAt,
      row: {
        user: pl.user, name: pl.name, rank: 0,
        points: pointsOf(r),
        w: r?.w ?? 0, l: r?.l ?? 0, d: r?.d ?? 0,
        omw: mean(opps.map(o => mwPct(recs.get(o)))),
        gw: gwPct(r),
        ogw: mean(opps.map(o => gwPct(recs.get(o)))),
        dropped: !!pl.dropped,
      } satisfies StandingRow,
    };
  });
  const cmp = (x: number, y: number): number => (Math.abs(x - y) < EPS ? 0 : y - x);
  rows.sort((x, y) => cmp(x.row.points, y.row.points) || cmp(x.row.omw, y.row.omw)
    || cmp(x.row.gw, y.row.gw) || cmp(x.row.ogw, y.row.ogw)
    || x.joinedAt - y.joinedAt || x.i - y.i);
  return rows.map((r, k) => ({ ...r.row, rank: k + 1 }));
}

/** every pair that has met (or been paired) outside `round` */
function metPairs(pairings: readonly Pairing[], skipRound?: number): Set<string> {
  const met = new Set<string>();
  for (const p of pairings) if (p.b !== null && p.round !== skipRound) met.add(pairKey(p.a, p.b));
  return met;
}

/**
 * Pair `order` top-down: the first unpaired takes the first partner below it it may meet, backing
 * up when the rest cannot be paired. Returns index pairs into `order`, or null. `order.length` even.
 */
function pairTopDown(order: readonly string[], met: Set<string>, allowRematch: boolean): [number, number][] | null {
  const n = order.length;
  const failed = new Set<bigint>();
  const out: [number, number][] = [];
  const full = (1n << BigInt(n)) - 1n;
  const go = (used: bigint): boolean => {
    if (used === full) return true;
    if (failed.has(used)) return false;
    let i = 0;
    while ((used >> BigInt(i)) & 1n) i++;
    for (let j = i + 1; j < n; j++) {
      if ((used >> BigInt(j)) & 1n) continue;
      if (!allowRematch && met.has(pairKey(order[i]!, order[j]!))) continue;
      out.push([i, j]);
      if (go(used | (1n << BigInt(i)) | (1n << BigInt(j)))) return true;
      out.pop();
    }
    failed.add(used);
    return false;
  };
  return go(0n) ? out : null;
}

const BYE_RESULT = { kind: 'bye', at: 0, by: 'play' } as const;

/**
 * One Swiss round's pairings, `posted: false`, ids `r<round>p<n>` (the bye last). The bye comes
 * pre-resulted (`{kind:'bye', at: 0, by:'play'}`); it counts once posted. Dropped players are not
 * paired. Pairings already in `pairings` for this same round are ignored (a recomputation).
 */
export function pairSwiss(players: CubePlayer[], pairings: Pairing[], round: number, seed: number): Pairing[] {
  const active = players.filter(p => !p.dropped);
  const prior = pairings.filter(p => p.round !== round);
  const met = metPairs(prior);
  let order: string[];
  if (round <= 1) {
    order = rngShuffle(active.map(p => p.user), seed >>> 0)[0];
  } else {
    const on = new Set(active.map(p => p.user));
    order = standings(players, prior).filter(r => on.has(r.user)).map(r => r.user);
  }

  let bye: string | null = null;
  let rest = order;
  let pairs: [number, number][] | null = null;
  if (order.length % 2 === 1) {
    const hadBye = new Set(prior.filter(p => p.b === null).map(p => p.a));
    const bottomUp = [...order].reverse();
    const candidates = [...bottomUp.filter(u => !hadBye.has(u)), ...bottomUp.filter(u => hadBye.has(u))];
    for (const c of candidates) {
      const r = order.filter(u => u !== c);
      const found = pairTopDown(r, met, false);
      if (found) { bye = c; rest = r; pairs = found; break; }
    }
    if (!pairs) {
      bye = candidates[0]!;
      rest = order.filter(u => u !== bye);
      pairs = pairTopDown(rest, met, true);
    }
  } else {
    pairs = pairTopDown(rest, met, false) ?? pairTopDown(rest, met, true);
  }

  const out: Pairing[] = (pairs ?? []).map(([i, j], k) => ({
    id: `r${round}p${k + 1}`, round, a: rest[i]!, b: rest[j]!, posted: false,
  }));
  if (bye !== null) {
    out.push({ id: `r${round}p${out.length + 1}`, round, a: bye, b: null, posted: false, result: { ...BYE_RESULT } });
  }
  return out;
}

/**
 * The whole round-robin schedule (circle method), `posted: false`, ids `rr<round>p<n>`, `round` =
 * the schedule round. Every pair of non-dropped players exactly once, nobody twice in a round.
 * With an odd count one player sits each schedule round out — no bye pairing, no points.
 */
export function roundRobin(players: CubePlayer[], seed: number): Pairing[] {
  const ids: (string | null)[] = rngShuffle(players.filter(p => !p.dropped).map(p => p.user), seed >>> 0)[0];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const out: Pairing[] = [];
  if (n < 2) return out;
  // seat 0 is fixed; the others rotate one place a round
  let ring = ids.slice(1);
  for (let r = 1; r <= n - 1; r++) {
    const table = [ids[0]!, ...ring];
    let k = 0;
    for (let i = 0; i < n / 2; i++) {
      let x = table[i]!, y = table[n - 1 - i]!;
      if (x === null || y === null) continue;
      if (i === 0 && r % 2 === 0) [x, y] = [y, x];   // the fixed seat alternates sides
      out.push({ id: `rr${r}p${++k}`, round: r, a: x, b: y, posted: false });
    }
    ring = [ring[ring.length - 1]!, ...ring.slice(0, -1)];
  }
  return out;
}

/**
 * Exhibition: the next pair to start, or null. Candidates are not dropped, `ready`, and not in a
 * posted pairing that is still undecided. The pair must never have been paired before; among those,
 * the smallest points gap, then the longest combined wait (`now - readySince`), then join order.
 * The pair comes back in players-array order.
 */
export function pairExhibition(players: CubePlayer[], pairings: Pairing[], now: number): [string, string] | null {
  const busy = new Set<string>();
  for (const p of pairings) {
    if (p.posted && !p.result) { busy.add(p.a); if (p.b !== null) busy.add(p.b); }
  }
  const met = metPairs(pairings);
  const pts = new Map(standings(players, pairings).map(r => [r.user, r.points]));
  const cand = players.filter(p => !p.dropped && p.ready && !busy.has(p.user));
  const wait = (p: CubePlayer): number => Math.max(0, now - (p.readySince ?? now));
  let best: { a: string; b: string; gap: number; wait: number } | null = null;
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const x = cand[i]!, y = cand[j]!;
      if (met.has(pairKey(x.user, y.user))) continue;
      const gap = Math.abs((pts.get(x.user) ?? 0) - (pts.get(y.user) ?? 0));
      const w = wait(x) + wait(y);
      // strict improvements only, so the first pair in players order wins a full tie
      if (!best || gap < best.gap || (gap === best.gap && w > best.wait)) best = { a: x.user, b: y.user, gap, wait: w };
    }
  }
  return best ? [best.a, best.b] : null;
}

/** every posted pairing of `round` has a result — false when the round has none posted */
export function roundDone(pairings: Pairing[], round: number): boolean {
  const posted = pairings.filter(p => p.round === round && p.posted);
  return posted.length > 0 && posted.every(p => !!p.result);
}

/** can the host still move people in or out of this pairing? A bye never "starts". */
const unstarted = (p: Pairing): boolean => p.b === null || (!p.match && !p.result);

/**
 * Swap two players between `round`'s un-started pairings (no match opened, no result), the bye
 * included — swapping someone with the bye player moves the bye. Returns a new array (every
 * pairing copied), or an error for the host.
 */
export function swapPlayers(pairings: Pairing[], round: number, u1: string, u2: string): Pairing[] | { error: string } {
  if (u1 === u2) return { error: 'Pick two different players.' };
  const out = pairings.map(p => ({ ...p }));
  const find = (u: string): Pairing | undefined => out.find(p => p.round === round && (p.a === u || p.b === u));
  const p1 = find(u1), p2 = find(u2);
  if (!p1 || !p2) return { error: 'That player is not in this round.' };
  if (p1 === p2) return { error: 'They are already playing each other.' };
  if (!unstarted(p1) || !unstarted(p2)) return { error: 'That match has already started.' };
  const put = (p: Pairing, from: string, to: string): void => { if (p.a === from) p.a = to; else p.b = to; };
  put(p1, u1, u2);
  put(p2, u2, u1);
  return out;
}

/** the score shown beside the names, always a's–b's: "2–1", "1–0", "Bye", "Draw"; null undecided */
export function scoreLine(p: Pairing): string | null {
  const r = p.result;
  if (!r) return null;
  if (r.kind === 'bye' || p.b === null) return 'Bye';
  if (r.kind === 'draw') return 'Draw';
  const [ga, gb] = gamesOf(p);
  return `${ga}–${gb}`;
}
