/* A WAITING ROOM'S "CHANGE": the seat whose deck (or Single Card Duel card) is
 * in opens the picker again. Nothing is withdrawn — the one already in stays
 * in, and is what deals if the opponent finishes first, until the room's Play
 * button sends another, which the server puts in its place (server/rooms.ts
 * setRoomDeck replaces a waiting seat's deck).
 *
 * Kept per room, so a rematch or another room never opens on the picker.
 * What was in is remembered at the press: the picker moves the browser's
 * choice, and the seat line must keep naming the one the server holds — and
 * Keep puts the choice back on it.
 */
import type { ChosenDeck } from './util.ts';

export interface InPlay { deck: ChosenDeck | null; card: string | null }

let open: ({ room: string } & InPlay) | null = null;

/** Change pressed in `room`, with this deck or card in */
export function startChange(room: string, inPlay: InPlay): void {
  open = { room, deck: inPlay.deck ? { ...inPlay.deck, cards: [...inPlay.deck.cards] } : null, card: inPlay.card };
}

/** Keep pressed, or another deck or card sent */
export function endChange(): void { open = null; }

/** what is in while the picker is open again in `room`; null when it is not */
export function changing(room: string): InPlay | null {
  return open && open.room === room ? { deck: open.deck, card: open.card } : null;
}
