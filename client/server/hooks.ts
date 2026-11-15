/* Queue events for the Discord bot, which reads them back by sequence number
 * (`GET /api/bot/events?since=`, api-bot.ts).
 *
 * A ring and not a snapshot: /api/queue returns counts only, on purpose, and a
 * join can pair and resolve inside one tick of the 1s sweep, so only a log of
 * facts lets the bot name the player and correct the invitation it posted.
 *
 * `emit()` is synchronous and does no I/O. It runs inside sweepQueue(), on the
 * timer that ends stalled rated games; a feature that only decorates Discord
 * must never be able to block it.
 *
 * The server emits FACTS. Which channel, which role, how often — all of that
 * is the bot's business. The game server must never learn a Discord role id.
 */
import { randomUUID } from 'node:crypto';

/** This process. A `seq` from another boot means nothing here: the bot
 * resynchronises from /api/bot/queue when this changes. */
export const BOOT_ID = randomUUID();

/** How many past events the bot can read back. ~500 is minutes of a busy evening. */
const RING_MAX = 500;

export type BotEvent =
  | { t: 'queue.join'; userId: string; username: string; discordId: string | null;
      mode: string; ranked: boolean; rating: number; counts: unknown }
  | { t: 'queue.leave'; userId: string; username: string; discordId: string | null;
      mode: string; reason: 'left' | 'disconnected'; counts: unknown }
  | { t: 'queue.offer'; mode: string; players: { userId: string; username: string; rating: number }[] }
  | { t: 'queue.lapse'; mode: string; backInLine: string[]; dropped: string[] }
  | { t: 'queue.match'; room: string; mode: string;
      seats: { userId: string; username: string; seat: number; rating: number }[] };

export interface Envelope { seq: number; ts: string; bootId: string; event: BotEvent }

const ring: Envelope[] = [];
let seq = 0;

/** Record an event for the bot. */
export function emit(event: BotEvent): void {
  ring.push({ seq: ++seq, ts: new Date().toISOString(), bootId: BOOT_ID, event });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

/** Every event after `from` (the whole ring fits one answer). */
export function since(from: number): { events: Envelope[]; nextSeq: number; truncated: boolean } {
  const oldest = ring.length ? ring[0]!.seq : seq + 1;
  // ⚠ Say so when events after `from` have left the ring: an empty list would
  // read as "nothing happened" and the bot would go on believing it.
  const truncated = from + 1 < oldest;
  return { events: ring.filter(e => e.seq > from), nextSeq: seq, truncated };
}
