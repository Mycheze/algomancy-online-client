/* BL-01 — the matchmaking queue.
 *
 * Two halves, split on purpose. Everything above the "── the store ──" line is
 * PURE: entries in, pairs out, no sockets, no clock, no globals. That is where
 * every rule anybody will ever argue about lives (who may play whom, how the
 * search widens, who waits longest), and it is testable by calling it. The
 * store below it is a Map and some bookkeeping.
 *
 * ── WHY ONE QUEUE AND NOT TWO ────────────────────────────────────────
 *
 * The owner asked for two ways to queue: RANKED (paired only with someone near
 * your rating) and OPEN (anyone — and it still moves your rating). The obvious
 * build is two pools per format. That is four pools between two formats, and on
 * a deploy with six people online it means nobody ever gets a game.
 *
 * So there is ONE pool per format and the mode is a property of the ENTRY. Two
 * entries may pair iff every constraint EITHER of them imposes is satisfied: an
 * open entry imposes nothing, a ranked entry imposes its current band. A ranked
 * player and an open player therefore pair the moment the open player happens
 * to be inside the ranked player's window — which costs the open player nothing
 * (they said anyone) and costs the ranked player nothing (it is inside the
 * window they were shown). Nobody is ever handed a match they were promised
 * they would not get, and the pool is as large as it can honestly be.
 *
 * ── WHY THE BAND WIDENS ──────────────────────────────────────────────
 *
 * A fixed window does not pair on a small population; it just leaves people
 * sitting there. A window that widens to "anyone" makes ranked mean *it tried
 * hard*, rather than *it refuses*. The schedule is deliberately visible in the
 * client (the searching line spells out the current ±) so that a wide match at
 * three minutes is something the player watched happen rather than something
 * that happened to them.
 */
import type { CardName } from '../engine/src/types.ts';
import type { RatedMode } from './rating.ts';

// ── the pure half ─────────────────────────────────────────────────────

/** One player waiting. */
export interface QueueEntry {
  userId: string;
  username: string;
  mode: RatedMode;
  /** ranked = only pair me near my rating (for now — see `band`) */
  ranked: boolean;
  /** this player's rating IN `mode`, read when they joined */
  rating: number;
  /** constructed only: the deck they queued with, resolved at join time */
  deck?: CardName[];
  deckId?: string;
  /** epoch ms they joined. ⚠ PRESERVED across a failed offer — see `requeue` */
  since: number;
}

/**
 * The widening schedule: how far from my rating I will accept, after waiting
 * this long. `null` is no limit at all.
 *
 * Read as "at or after this many ms, the band is this wide". The last step is
 * `null` rather than a big number so that "anyone" is a state the UI can name,
 * not a ± it has to pretend to mean.
 */
export const BAND_STEPS: readonly { after: number; band: number | null }[] = [
  { after: 0, band: 100 },
  { after: 30_000, band: 150 },
  { after: 60_000, band: 200 },
  { after: 120_000, band: 300 },
  { after: 180_000, band: null },
];

/** How wide this player's search is after waiting `waitedMs`. */
export function band(waitedMs: number): number | null {
  let out: number | null = BAND_STEPS[0]!.band;
  for (const step of BAND_STEPS) {
    if (waitedMs >= step.after) out = step.band;
  }
  return out;
}

/** How wide THIS entry's search is now. An open entry never has a limit. */
export const bandFor = (e: QueueEntry, now: number): number | null =>
  e.ranked ? band(Math.max(0, now - e.since)) : null;

/**
 * May these two be put in a game together?
 *
 * ⚠ SYMMETRIC BY CONSTRUCTION: the rating gap is compared against BOTH bands,
 * so a player who has waited three minutes cannot drag a player who just
 * arrived outside the window that player is currently being shown. Checking
 * only the longer-waiting side is the natural mistake and it makes "ranked"
 * a lie for whoever queued most recently.
 */
export function compatible(a: QueueEntry, b: QueueEntry, now: number): boolean {
  if (a.userId === b.userId) return false;
  if (a.mode !== b.mode) return false;
  const gap = Math.abs(a.rating - b.rating);
  for (const limit of [bandFor(a, now), bandFor(b, now)]) {
    if (limit !== null && gap > limit) return false;
  }
  return true;
}

/**
 * Pair off as many waiting players as possible.
 *
 * Longest wait first, and for each of them the CLOSEST compatible opponent
 * rather than the next one in line. Greedy-by-wait is the fair ordering (the
 * person who has been sitting there longest gets served first); closest-match
 * within that is what stops a 1400 being handed a 1100 at the three-minute
 * mark while a 1390 was also available.
 *
 * Returns disjoint pairs — every entry appears at most once — so the caller
 * can act on all of them without re-checking.
 */
export function pairUp(entries: readonly QueueEntry[], now: number): [QueueEntry, QueueEntry][] {
  const waiting = [...entries].sort((a, b) => a.since - b.since || a.userId.localeCompare(b.userId));
  const taken = new Set<string>();
  const pairs: [QueueEntry, QueueEntry][] = [];
  for (const a of waiting) {
    if (taken.has(a.userId)) continue;
    let best: QueueEntry | null = null;
    let bestGap = Infinity;
    for (const b of waiting) {
      if (taken.has(b.userId) || b.userId === a.userId) continue;
      if (!compatible(a, b, now)) continue;
      const gap = Math.abs(a.rating - b.rating);
      // ties break on the longer wait, which `waiting` is already ordered by
      if (gap < bestGap) { best = b; bestGap = gap; }
    }
    if (!best) continue;
    taken.add(a.userId);
    taken.add(best.userId);
    pairs.push([a, best]);
  }
  return pairs;
}

/** What the homepage shows at a glance. */
export interface QueueCounts {
  total: number;
  byMode: Record<RatedMode, number>;
}

export function countsOf(entries: readonly QueueEntry[]): QueueCounts {
  const byMode: Record<RatedMode, number> = { constructed: 0, draft: 0 };
  for (const e of entries) byMode[e.mode]++;
  return { total: entries.length, byMode };
}

// ── offers ────────────────────────────────────────────────────────────

/** How long two matched players have to accept before the offer lapses. */
export const OFFER_MS = 10_000;

/** A pair being offered to both players, waiting on their clicks. */
export interface Offer {
  id: string;
  entries: [QueueEntry, QueueEntry];
  accepted: [boolean, boolean];
  /** epoch ms the offer was made */
  made: number;
}

/** Has this offer run out of time? */
export const offerExpired = (o: Offer, now: number): boolean => now - o.made >= OFFER_MS;

/**
 * What happens to an offer that did not go through: everybody who DID accept
 * goes back in the queue, everybody who did not is dropped.
 *
 * ⚠ THE RETURNED ENTRY KEEPS ITS ORIGINAL `since`. A player who accepted
 * promptly and was let down by the other side has already waited that time;
 * restarting their band at ±100 would punish them for somebody else's flake
 * and could loop — the same two would be offered each other again, widen
 * together, and fail together. Keeping `since` means their search goes on
 * widening from where it was and the next attempt reaches further.
 */
export function survivors(o: Offer): QueueEntry[] {
  return o.entries.filter((_, i) => o.accepted[i]);
}

// ── the store ─────────────────────────────────────────────────────────

/**
 * One entry per ACCOUNT, not per socket.
 *
 * Two tabs of one browser share a session token (accounts.ts's own caveat), so
 * keying on the account and letting a second join replace the first is the
 * same move `pickSeat` already makes for a seat: the newest connection is the
 * one the player is looking at. The caller is told which socket was displaced
 * so it can tell that tab why it stopped searching.
 */
const entries = new Map<string, QueueEntry>();
const offers = new Map<string, Offer>();
/** userId → the offer they are held by; held players are not pairable */
const heldBy = new Map<string, string>();

let nextOfferId = 1;

export const queued = (): QueueEntry[] => [...entries.values()];
export const queueCounts = (): QueueCounts => countsOf([...entries.values()]);
export const entryFor = (userId: string): QueueEntry | undefined => entries.get(userId);
export const offerFor = (userId: string): Offer | undefined => {
  const id = heldBy.get(userId);
  return id ? offers.get(id) : undefined;
};

/** Put somebody in the queue (or move them to a different format/mode). */
export function enqueue(e: QueueEntry): void {
  entries.set(e.userId, e);
}

/**
 * Take somebody out — leaving, disconnecting, or joining a room.
 *
 * ⚠ Returns the offer they were being held by, if any, so the caller can tell
 * the OTHER player rather than leaving them staring at a countdown for
 * somebody who has gone. A player who vanishes mid-offer is a decline.
 */
export function dequeue(userId: string): Offer | undefined {
  entries.delete(userId);
  const offer = offerFor(userId);
  if (offer) {
    const i = offer.entries[0]!.userId === userId ? 0 : 1;
    offer.accepted[i] = false;
  }
  return offer;
}

/** Everybody who is actually pairable right now: queued and not held. */
export const pairable = (): QueueEntry[] => [...entries.values()].filter(e => !heldBy.has(e.userId));

/** Hold a pair in an offer. Both leave the pairable set until it resolves. */
export function makeOffer(pair: [QueueEntry, QueueEntry], now: number): Offer {
  const offer: Offer = { id: `o${nextOfferId++}`, entries: pair, accepted: [false, false], made: now };
  offers.set(offer.id, offer);
  for (const e of pair) heldBy.set(e.userId, offer.id);
  return offer;
}

/** Record one side's acceptance. Returns true when BOTH have accepted. */
export function acceptOffer(offer: Offer, userId: string): boolean {
  const i = offer.entries[0]!.userId === userId ? 0 : 1;
  offer.accepted[i] = true;
  return offer.accepted[0] && offer.accepted[1];
}

/**
 * Tear an offer down. Whoever accepted goes back in the queue with their
 * original `since` (see `survivors`); whoever did not is out and must re-join.
 *
 * `settled` is for the happy path — the room was made, so neither player goes
 * back in.
 */
export function closeOffer(offer: Offer, settled: boolean): QueueEntry[] {
  offers.delete(offer.id);
  for (const e of offer.entries) {
    heldBy.delete(e.userId);
    entries.delete(e.userId);
  }
  if (settled) return [];
  const back = survivors(offer);
  for (const e of back) entries.set(e.userId, e);
  return back;
}

/** Every offer that has run out of time. */
export const expiredOffers = (now: number): Offer[] =>
  [...offers.values()].filter(o => offerExpired(o, now));

/** Tests only: forget everything. */
export function resetQueue(): void {
  entries.clear();
  offers.clear();
  heldBy.clear();
  nextOfferId = 1;
}
