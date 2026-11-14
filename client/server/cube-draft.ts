/* THE POD DRAFT — a cube event's draft as a state machine (docs/25-cube-draft.md §3, §4).
 *
 * PURE: time is passed in, randomness comes from the event's seed, and every function MUTATES the
 * DraftState it is given (the controller persists it as part of the event record).
 *
 *   startDraft  shuffle the seat order and the pool, deal seats × packs packs, open pack round 0
 *   reserve     mark a card of my current pack (no clock change)
 *   pick        take a card of my current pack, pass the rest on; picks are never undone
 *   advance     run everything that is due by `now`, in TIME ORDER: bot picks (BOT_DELAY_MS after a
 *               bot's pack became current) and human timeouts (the reserved card, else choose(seat))
 *
 * The table: seat i passes LEFT to seat i+1 (and right to i−1); pack rounds alternate left, right,
 * left. Each seat holds a FIFO queue of packs; queue[0] is the current pack and `since` is when it
 * became current — its clock is msPerCard × the cards in it. A pack round ends when every pack is
 * empty, and the next opens at once, every clock starting at the moment the round ended.
 *
 * ⚠ advance() replays the overdue past one event at a time, earliest first, and stamps each
 * consequence with the time of the event that caused it — not with `now`. After a server restart
 * (or one slow sweep) a bot pick due at t=1000 hands a pack to a human whose clock starts at 1000,
 * so that human may itself be overdue by `now` and time out in the same call.
 */

import type { CubeDraftView, CubeSeatView, DraftSeat, DraftState } from './cube-types.ts';
import { rng } from './league.ts';

export type Res = { ok: true } | { ok: false; error: string };

function envMs(): number {
  const v = Number(process.env.ALGO_CUBE_PICK_MS_PER_CARD);
  return Number.isFinite(v) && v > 0 ? v : 6000;
}
/** the pick clock per card in the pack (docs/25 §1: 6 s × cards) */
export const PICK_MS_PER_CARD: number = envMs();
/** a bot picks this long after its pack became current (instant feels broken beside a human) */
export const BOT_DELAY_MS = 1000;

const AUTO_PACKS = 3;
const MAX_AUTO_PACK = 15;
const MIN_PACK = 5;

/** The pack numbers for a pool and a table: packs default 3, pack size defaults to the largest
 *  that fits (at most 15). ok = a pack of at least 5 and enough cards to deal every pack. */
/** every player must draft at least a deck's worth (docs/25 §3: main ≥ 30) */
export const MIN_PICKS = 30;

export function packMath(poolSize: number, seats: number, packs: number | null, packSize: number | null):
  { seats: number; packs: number; packSize: number; ok: boolean } {
  const p = packs ?? AUTO_PACKS;
  const size = packSize ?? (seats > 0 && p > 0 ? Math.min(MAX_AUTO_PACK, Math.floor(poolSize / (seats * p))) : 0);
  const ok = Number.isInteger(seats) && seats >= 1 && Number.isInteger(p) && p >= 1 && Number.isInteger(size)
    && size >= MIN_PACK && p * size >= MIN_PICKS && seats * p * size <= poolSize;
  return { seats, packs: p, packSize: size, ok };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** Shuffle the seat order and the pool, deal every pack without replacement (leftovers unused),
 *  and open pack round 0 at `now`. Throws if the pool cannot deal them (check packMath first). */
export function startDraft(seats: { user: string | null; name: string }[], pool: string[], packs: number, packSize: number,
  seed: number, now: number, msPerCard: number = PICK_MS_PER_CARD): DraftState {
  if (seats.length < 1) throw new Error('startDraft: no seats');
  if (seats.length * packs * packSize > pool.length) {
    throw new Error(`startDraft: ${pool.length} cards cannot deal ${seats.length} × ${packs} packs of ${packSize}`);
  }
  const rand = rng(seed);
  const order = shuffle(seats.map(s => ({ ...s })), rand);
  const cards = shuffle([...pool], rand);
  const unopened: string[][][] = [];
  let at = 0;
  for (let r = 0; r < packs; r++) {
    const round: string[][] = [];
    for (let s = 0; s < order.length; s++) { round.push(cards.slice(at, at + packSize)); at += packSize; }
    unopened.push(round);
  }
  const d: DraftState = {
    seed, packs, packSize, round: 0,
    seats: order.map((s): DraftSeat => ({ user: s.user, name: s.name, picks: [], queue: [], since: null, reserved: null })),
    unopened, msPerCard, done: packs < 1 || packSize < 1,
  };
  if (!d.done) openRound(d, 0, now);
  return d;
}

/** every seat opens its pack of round r; their clocks start at `at` */
function openRound(d: DraftState, r: number, at: number): void {
  d.round = r;
  const packs = d.unopened[r] ?? [];
  d.seats.forEach((s, i) => {
    const pack = packs[i] ?? [];
    s.queue = pack.length ? [pack] : [];
    s.since = pack.length ? at : null;
    s.reserved = null;
  });
  if (packs.length) d.unopened[r] = packs.map(() => []);
}

/** +1 = left (seat i → i+1), −1 = right; round 0 left, then alternating */
const step = (round: number): 1 | -1 => (round % 2 === 0 ? 1 : -1);

function seatCheck(d: DraftState, seat: number): DraftSeat | string {
  if (d.done) return 'the draft is over';
  const s = d.seats[seat];
  if (!s) return 'no such seat';
  if (!s.queue[0]?.length) return 'no pack to pick from yet';
  return s;
}

/** Mark a card of my current pack; the clock does not change. */
export function reserve(d: DraftState, seat: number, card: string): Res {
  const s = seatCheck(d, seat);
  if (typeof s === 'string') return { ok: false, error: s };
  if (!s.queue[0]!.includes(card)) return { ok: false, error: 'that card is not in your pack' };
  s.reserved = card;
  return { ok: true };
}

/** Take a card of my current pack at `now` and pass the rest on. */
export function pick(d: DraftState, seat: number, card: string, now: number): Res {
  const s = seatCheck(d, seat);
  if (typeof s === 'string') return { ok: false, error: s };
  if (!s.queue[0]!.includes(card)) return { ok: false, error: 'that card is not in your pack' };
  take(d, seat, card, now);
  return { ok: true };
}

/** the pick itself, at time t: no checks; ends the round (and the draft) when it was the last card */
function take(d: DraftState, seat: number, card: string, t: number): void {
  const s = d.seats[seat]!;
  const pack = s.queue.shift()!;
  pack.splice(pack.indexOf(card), 1);
  s.picks.push(card);
  s.reserved = null;
  s.since = s.queue.length ? t : null;
  if (pack.length) {
    const n = d.seats.length;
    const to = d.seats[(((seat + step(d.round)) % n) + n) % n]!;
    to.queue.push(pack);
    if (to.queue.length === 1) to.since = t;
  }
  if (d.seats.every(x => x.queue.length === 0)) {
    if (d.round + 1 < d.packs) openRound(d, d.round + 1, t);
    else d.done = true;
  }
}

/** when seat i's current pack is due: a bot's pick, or a human's clock running out */
function dueAt(d: DraftState, s: DraftSeat): number | null {
  const pack = s.queue[0];
  if (!pack?.length || s.since == null) return null;
  return s.since + (s.user == null ? BOT_DELAY_MS : d.msPerCard * pack.length);
}

/** the earliest due seat (ties: the lower seat), or null */
function earliest(d: DraftState): { seat: number; at: number } | null {
  if (d.done) return null;
  let best: { seat: number; at: number } | null = null;
  for (let seat = 0; seat < d.seats.length; seat++) {
    const at = dueAt(d, d.seats[seat]!);
    if (at != null && (best == null || at < best.at)) best = { seat, at };
  }
  return best;
}

/** The earliest time advance() would do something, or null (draft over). */
export function nextWake(d: DraftState): number | null {
  return earliest(d)?.at ?? null;
}

/**
 * Run every pick due by `now`, earliest first: bots pick choose(seat); a human who timed out gets
 * the reserved card, else choose(seat). Each pick happens AT its due time, so the packs it passes
 * start their clocks then. Loops until nothing is due. Returns true if anything was picked.
 * A choose() that names a card not in the pack is ignored for the pack's first card.
 */
export function advance(d: DraftState, now: number, choose: (seat: number) => string): boolean {
  let changed = false;
  for (let e = earliest(d); e && e.at <= now; e = earliest(d)) {
    const s = d.seats[e.seat]!;
    const pack = s.queue[0]!;
    let card = s.user != null && s.reserved != null && pack.includes(s.reserved) ? s.reserved : choose(e.seat);
    if (!pack.includes(card)) card = pack[0]!;
    take(d, e.seat, card, e.at);
    changed = true;
  }
  return changed;
}

/** The seat a user sits in, or −1. */
export function seatOf(d: DraftState, user: string): number {
  return d.seats.findIndex(s => s.user === user);
}

/** What the player in `seat` sees: never another seat's picks. (`now` is not read: the view carries
 *  the absolute deadline and the controller stamps the server's `now` on the whole CubeView.) */
export function draftView(d: DraftState, seat: number, _now: number, suggest: string | null): CubeDraftView {
  const me = d.seats[seat];
  const pack = !d.done && me?.queue[0]?.length ? me.queue[0] : null;
  const due = me && pack ? dueAt(d, me) : null;
  const inRound = me ? me.picks.length - d.round * d.packSize : 0;
  const seats: CubeSeatView[] = d.seats.map((s, i) => ({
    name: s.name, bot: s.user == null, waiting: s.queue.length, picks: s.picks.length, me: i === seat,
  }));
  return {
    packNo: d.round + 1,
    pickNo: Math.max(1, Math.min(d.packSize, inRound + 1)),
    packs: d.packs,
    packSize: d.packSize,
    direction: step(d.round) === 1 ? 'left' : 'right',
    seats,
    pack: pack ? [...pack] : null,
    deadline: due,
    reserved: pack ? me!.reserved : null,
    suggest: pack && suggest != null && pack.includes(suggest) ? suggest : null,
    picks: me ? [...me.picks] : [],
  };
}
