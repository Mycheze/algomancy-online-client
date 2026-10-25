/* CT-384 — THE SECOND OF TWO QUICK PLAYS FLIES FROM THE HAND TOO.
 *
 * A play nobody can respond to makes one journey: hand → stack beat → board
 * (owner, 2026-10-03). The beats are paced one a second (ui/flash.ts), so when
 * two plays land inside that second the second beat WAITS. Measured in
 * headless Chrome (playback-deploy, seat 1 deploying Ephemeral Skywalker then
 * Sparkwraith 250ms apart, every animation frame sampled):
 *
 *   at the second play's paint its hand card left the census with nowhere to
 *   go — its beat was not on the strip yet, so it had no stack slot to pair
 *   with — and it shrank out where it stood in the hand; a second later its
 *   beat started and the stack card, born from nothing, dropped in.
 *
 * So the leave is PARKED: a hand card that leaves at a paint where a beat for
 * that same card (same seat, same name — any name for a hidden hand) is
 * queued but not yet showing keeps the rect it was drawn at, and no fade. When
 * the beat's stack card is born, the flight starts from that rect: the card
 * flies from the hand into the stack window at its turn, as the first one did.
 *
 * Pure over a frame, a motion and the flash queue; `parked` is the caller's
 * memory between paints (main.ts keeps one).
 */
import { HIDDEN_CARD, type Motion, type Move } from './motion.ts';
import type { Flash } from './flash.ts';

/** a hand card's last rect, waiting for its beat (keyed by the beat's `s<id>`) */
export type Parked = Map<string, { rect: DOMRect; until: number }>;

/** the frame key a parked flight starts from */
const parkKey = (phantom: string): string => `park:${phantom}`;

/**
 * Rewrite one paint's motion: park the hand cards whose beat is still waiting,
 * and start the beats that were parked from where their card was. `frame` is
 * the pre-paint frame playMotion reads its sources from; a started park is
 * written into it under its own key.
 */
export function waitingFlights(
  frame: Map<string, DOMRect>, m: Motion, flashes: readonly Flash[], now: number, parked: Parked,
): Motion {
  for (const [k, p] of parked) if (now >= p.until) parked.delete(k);
  const moves: Move[] = [];
  for (const mv of m.moves) {
    // a parked beat starting: its stack card was born with nothing to fly from
    if (mv.kind === 'enter' && mv.to && parked.has(mv.to)) {
      const from = parkKey(mv.to);
      frame.set(from, parked.get(mv.to)!.rect);
      parked.delete(mv.to);
      moves.push({ ...mv, from, fromAnchor: null, kind: 'move' });
      continue;
    }
    // a hand card leaving for a beat that has not started yet
    if (mv.kind === 'leave' && mv.from && mv.fromAnchor === `@hand:${mv.seat}`) {
      const rect = frame.get(mv.from);
      const f = flashes.find(fl => now < fl.at && !parked.has(`s${fl.item.id}`)
        && fl.item.controller === mv.seat && (mv.card === HIDDEN_CARD || fl.item.card === mv.card));
      if (rect && f) {
        parked.set(`s${f.item.id}`, { rect, until: f.until });
        continue;
      }
    }
    moves.push(mv);
  }
  return { ...m, moves };
}
