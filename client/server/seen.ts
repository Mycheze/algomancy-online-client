/* R312 — SEEING HIDDEN CARDS ENDS YOUR UNDO.
 *
 * The owner, 2026-10-04: an action that showed you hidden cards cannot be
 * taken back, nor anything before it — "once you've seen the cards, it
 * stands". The hole it closes: activate Lilbot during deployment, look at the
 * top two cards of the deck, undo. The deck's order is fixed by the seed, so
 * the cards are still there, in the same order, and you now know them — a free
 * peek, as often as the undo button allows.
 *
 * ── MEASURED, NOT ENUMERATED ─────────────────────────────────────────────
 *
 * There is no list here of the cards or events that "reveal". A list is what
 * goes stale: `glimpsed` is one way to see a hidden card, but Tides of the
 * Cosmos and Big Glimpse Card reveal through an `info` line and a question,
 * Bripp looks at a hand through `seenHand`, and a draw just puts a card in
 * your hand. What they share is the DEFINITION: what you were shown depended
 * on cards you could not see.
 *
 * So that is what is asked, directly. The action is applied a second time to
 * the same board with the hidden cards SHUFFLED — every deck and recycle pile
 * reordered, and the hands of the seats this seat cannot see — and the seat's
 * redacted view (`viewFor`, the very object the wire carries) plus the event
 * lines that reach it are compared. If anything the seat is shown came out
 * different, the seat saw hidden cards. An action that only moved cards it
 * could already see (a spawn from hand, a recycle, putting a card on the
 * bottom of a deck) shows the same thing whatever order the deck is in, and
 * locks nothing. Two different reorderings (reverse, rotate by one) are tried,
 * so a deck whose top cards happen to repeat does not hide a peek.
 *
 * A thirty-copy Single Card Duel deck is the edge case that proves the point:
 * reordering it changes nothing, and nothing in it is hidden.
 *
 * ── WHO IT LOCKS (the shared-deck call) ─────────────────────────────────
 *
 * Only the seat that SAW. Your opponent's glimpse off a shared deck changes
 * the deck you will draw from, but you were shown nothing — in a hidden step
 * every event of theirs is held from you until the barrier (R310), and their
 * half of the board is frozen in your view — so it does not lock your undo.
 * That falls out of the measurement: the reordering changes their view and
 * not yours. The other half of the same principle is enforced by the undo
 * itself (rooms.ts `undoActionAt`): YOUR take-back may not change the cards
 * THEY have already been shown, so each revealing action also records what
 * the seat saw, and a splice that would change it is refused.
 *
 * This module is pure (engine + view only, no node imports) so the Learn to
 * Play runner in the browser (ui/solo.ts) applies the same floor.
 */
import type { Action, EngineEvent, GameState, Seat } from '../engine/src/types.ts';
import { apply } from '../engine/src/apply.ts';
import { redactEvent, viewFor, visibleToSeat } from './view.ts';
import { zoneCards } from './zonedelta.ts';

/**
 * Per seat, what one action showed it of the hidden cards: `null` (nothing
 * hidden) or a description of what it was shown (its own zones, the question
 * it is being asked, the hand it looked at, the lines it was sent). `[]` is
 * "nothing, to anybody" — the common case, kept small.
 */
export type Seen = readonly (string | null)[];

export const NOTHING_SEEN: Seen = [];

/** The refusal a player reads. */
export const SEEN_REFUSAL = "you've seen those cards — that can't be taken back";

export interface SeenContext {
  /** the hidden step's frozen board (the opponent's half as the step began), or null outside one */
  frozen: GameState | null;
  /** is this action inside a hidden step, where the other seat's events are held for the barrier? */
  holding: boolean;
  /** seat names, for the event redaction */
  names: readonly string[];
}

type Reorder = <T>(xs: T[]) => void;
const REORDERINGS: readonly Reorder[] = [
  xs => { xs.reverse(); },
  xs => { if (xs.length > 1) xs.push(xs.shift()!); },
];

/** Reorder, in place, every card `seat` cannot see: all decks and recycle
 * piles, and the hands of every seat not in `keep` (whose hands are known —
 * the viewer's own, and the actor's, whose move names an index into it). The
 * R85 resume snapshot is the world a pending answer re-runs from, so it is
 * reordered the same way. Packs are left alone: an open pack is the viewer's
 * own, and nothing reaches into the other one. */
function reorderHidden(s: GameState, keep: ReadonlySet<Seat>, by: Reorder): void {
  by(s.sharedDeck);
  for (const d of s.decks ?? []) by(d);
  if (s.sharedRecycled) by(s.sharedRecycled);
  for (const d of s.recycled ?? []) by(d);
  for (const p of s.players) if (!keep.has(p.seat)) by(p.hand);
  const sus = s.suspension as { snapshot?: GameState } | null | undefined;
  if (sus?.snapshot) reorderHidden(sus.snapshot, keep, by);
}

/** the events of one action that reach `seat` now: all of its own (bar
 * another seat's private lines); none of the other seat's inside a hidden
 * step (R310 holds them all); everything visible to it outside one */
function reaching(events: readonly EngineEvent[], seat: Seat, actor: Seat, holding: boolean): EngineEvent[] {
  return seat === actor || !holding ? events.filter(e => visibleToSeat(e, seat)) : [];
}

/** everything `seat` is shown after an action, as one comparable string */
function shown(after: GameState, events: readonly EngineEvent[], seat: Seat, actor: Seat, c: SeenContext): string {
  const evs = reaching(events, seat, actor, c.holding).map(e => redactEvent(e, seat, [...c.names]));
  return JSON.stringify([viewFor(after, seat, c.frozen), evs]);
}

/** What `seat` was shown, in terms that survive an undo's renumbering (card
 * names and labels, never entity or decision ids): the comparison
 * `undoActionAt` makes for the OTHER seat's revealing actions. */
function seenText(after: GameState, events: readonly EngineEvent[], seat: Seat, actor: Seat, c: SeenContext): string {
  const d = after.decision;
  const p = after.players[seat];
  return JSON.stringify({
    // card names only: a cached card's `uid` comes off the id clock, which a
    // splice legitimately moves
    zones: p ? [p.hand, p.bin, (p.cache ?? []).map(c => c.card), p.erased ?? []] : null,
    ask: d && d.seat === seat ? [d.kind, d.prompt, d.options.map(o => [o.label, o.card ?? null])] : null,
    hand: after.seenHand?.[seat]?.cards ?? null,
    lines: reaching(events, seat, actor, c.holding).map(e => [e.type, redactEvent(e, seat, [...c.names]).msg]),
  });
}

function dependsOnHidden(before: GameState, action: Action, after: GameState, events: readonly EngineEvent[],
  seat: Seat, c: SeenContext): boolean {
  const actor = action.seat;
  const base = shown(after, events, seat, actor, c);
  const keep = new Set<Seat>([seat, actor]);
  for (const by of REORDERINGS) {
    const alt = structuredClone(before);
    reorderHidden(alt, keep, by);
    let r;
    try {
      r = apply(alt, action);
    } catch {
      // the move itself depended on the hidden cards (an answer to a question
      // whose options were deck cards). The actor saw that question; the
      // other seat saw only what reached its own cards.
      if (seat === actor) return true;
      return JSON.stringify(zoneCards(before, seat)) !== JSON.stringify(zoneCards(after, seat))
        || JSON.stringify(before.seenHand?.[seat] ?? null) !== JSON.stringify(after.seenHand?.[seat] ?? null);
    }
    if (shown(r.state, r.events, seat, actor, c) !== base) return true;
  }
  return false;
}

/** R312: what this action showed each seat of the hidden cards. */
export function seenBy(before: GameState, action: Action, after: GameState, events: readonly EngineEvent[],
  c: SeenContext): Seen {
  const out: (string | null)[] = [];
  let any = false;
  for (const p of after.players) {
    const s = p.seat;
    const saw = dependsOnHidden(before, action, after, events, s, c);
    out[s] = saw ? seenText(after, events, s, action.seat, c) : null;
    any ||= saw;
  }
  return any ? out : NOTHING_SEEN;
}

/** Did this record show `seat` hidden cards? */
export const sawHidden = (s: Seen | undefined, seat: Seat): boolean => typeof s?.[seat] === 'string';

/**
 * R312: the index of the most recent action at or after `from` that showed
 * `seat` hidden cards, or -1. An undo walks back no further than just after
 * it: that action stands, and so does everything before it.
 */
export function lastSeen(seen: readonly (Seen | undefined)[], seat: Seat, from = 0): number {
  for (let i = seen.length - 1; i >= Math.max(0, from); i--) if (sawHidden(seen[i], seat)) return i;
  return -1;
}
