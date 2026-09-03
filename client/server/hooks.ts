/* Queue and game events, pushed to the Discord bot.
 *
 * The bot wants to say "Ben just joined the constructed queue — come play".
 * Polling cannot answer that. `/api/queue` returns counts only, on purpose
 * (main.ts says why), so a poller could not name anybody; and a join can pair,
 * be offered and resolve inside ONE tick of the 1s sweep, so a poll would not
 * reliably see the join at all. Hence a push.
 *
 * But a push to a bot that is restarting loses the event permanently, and the
 * bot is a systemd unit with Restart=always, so restarts are ordinary. Hence a
 * push AND a bounded replay ring the bot can catch up from, keyed by a boot id
 * so it can tell "nothing happened" from "the counter was reset".
 *
 * ══ THE PART THAT MUST NOT GO WRONG ══════════════════════════════════
 *
 * These hooks are called from inside `sweepQueue()`, which runs on the shared
 * 1-second `expiryTimer` — the same timer that drives `sweepExpiry()`, which
 * is the only thing making a stalled rated game end in a result (BL-27). A
 * push that blocks that timer is a bug in the GAME, caused by a feature that
 * only decorates Discord.
 *
 * So the safety is structural rather than a matter of remembering:
 *
 *  1. `emit()` is SYNCHRONOUS and returns void, so no call site can `await` it
 *     even by accident. It appends and pokes the drain.
 *  2. ONE in-flight request, ever — a single-consumer FIFO. A slow bot grows a
 *     bounded queue instead of opening a socket every second.
 *  3. Both buffers are capped. Overflow drops the OLDEST and counts it, which
 *     the events endpoint reports: a silent gap is how the bot would miss a
 *     join for ever and never know.
 *  4. `AbortSignal.timeout(2000)` on every push, matching the /api/judge proxy.
 *  5. ⚠ A `.catch()` ON EVERY PROMISE. Node exits on an unhandled rejection;
 *     systemd would respawn mid-game and every live room would
 *     replay-restore. This is the single most dangerous line in the feature.
 *  6. A circuit breaker, so a bot that is down for the night does not mean a
 *     DNS lookup every second until morning.
 *  7. ⚠ NOTHING IS PUSHED WHEN `ALGO_BOT_PUSH_URL` IS UNSET — which is every
 *     test boot and every deploy that has not opted in. That matters beyond
 *     tidiness: an in-flight `fetch` holds a libuv handle that is NOT
 *     unref'd, which would partly defeat `expiryTimer.unref()`.
 *
 * The server emits FACTS. Which channel, which role to ping, how often not to
 * repeat itself — all of that is the bot's business. The game server must
 * never learn a Discord role id.
 */
import { randomUUID } from 'node:crypto';

/** Set by main.ts once, at boot. Empty means: do not push at all. */
const PUSH_URL = process.env['ALGO_BOT_PUSH_URL'] ?? '';
const PUSH_TOKEN = process.env['ALGO_BOT_TOKEN'] ?? '';

/** This process. ⚠ A bot that treats `seq` as durable across a respawn will
 * silently stop catching up; the boot id is what tells it the counter reset. */
export const BOOT_ID = randomUUID();

/** How many past events the bot can replay. ~500 is minutes of a busy evening. */
const RING_MAX = 500;
/** How many may pile up waiting for a slow bot before the oldest are dropped. */
const FIFO_MAX = 100;
const PUSH_TIMEOUT_MS = 2000;
const BREAKER_FAILURES = 5;
const BREAKER_COOLDOWN_MS = 60_000;

export type BotEvent =
  | { t: 'queue.join'; userId: string; username: string; discordId: string | null;
      mode: string; ranked: boolean; rating: number; counts: unknown }
  | { t: 'queue.leave'; userId: string; username: string; discordId: string | null;
      mode: string; reason: 'left' | 'disconnected'; counts: unknown }
  | { t: 'queue.offer'; mode: string; players: { userId: string; username: string; rating: number }[] }
  | { t: 'queue.lapse'; mode: string; backInLine: string[]; dropped: string[] }
  | { t: 'queue.match'; room: string; mode: string;
      seats: { userId: string; username: string; seat: number; rating: number }[] }
  | { t: 'game.finished'; room: string; mode: string; rated: boolean;
      winner: number | null; turns: number };

export interface Envelope { seq: number; ts: string; bootId: string; event: BotEvent }

const ring: Envelope[] = [];
const pending: Envelope[] = [];
let seq = 0;
let dropped = 0;
let inFlight = false;
let failures = 0;
let breakerUntil = 0;

/** Record an event, and (if configured) get it to the bot. NEVER await this. */
export function emit(event: BotEvent): void {
  const envelope: Envelope = {
    seq: ++seq, ts: new Date().toISOString(), bootId: BOOT_ID, event,
  };
  ring.push(envelope);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);

  if (!PUSH_URL) return;                       // see rule 7
  pending.push(envelope);
  if (pending.length > FIFO_MAX) {
    dropped += pending.length - FIFO_MAX;
    pending.splice(0, pending.length - FIFO_MAX);
  }
  // Deliberately not awaited, and the drain catches everything (rule 5).
  drain();
}

function drain(): void {
  if (inFlight || pending.length === 0) return;
  if (Date.now() < breakerUntil) return;
  inFlight = true;
  // Take everything that has accumulated: batching is the natural backpressure
  // absorber, and one request for ten events beats ten requests.
  const batch = pending.splice(0, pending.length);
  void fetch(PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-algo-bot': PUSH_TOKEN },
    body: JSON.stringify({ bootId: BOOT_ID, events: batch }),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  })
    .then(() => { failures = 0; })
    .catch(() => {
      // The events are NOT put back: they are in the ring, and the bot's
      // catch-up path is `since=`. Re-queueing them would mean a bot that is
      // down for an hour gets an hour of backlog the moment it returns.
      failures++;
      if (failures >= BREAKER_FAILURES) {
        breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
        failures = 0;
        console.log('[hooks] bot unreachable; pausing pushes for 60s');
      }
    })
    .finally(() => { inFlight = false; if (pending.length) drain(); });
}

/** Events after `since`, for a bot catching up after a restart. */
export function since(from: number, limit = 200): {
  events: Envelope[]; nextSeq: number; dropped: number; truncated: boolean;
} {
  const oldest = ring.length ? ring[0]!.seq : seq + 1;
  // ⚠ SAY SO WHEN THERE IS A GAP. Answering an out-of-range `since` with an
  // empty list is indistinguishable from "nothing happened", and the bot would
  // go on believing it was up to date.
  const truncated = from > 0 && from + 1 < oldest;
  const events = ring.filter(e => e.seq > from).slice(0, limit);
  return { events, nextSeq: seq, dropped, truncated };
}

/** Test seam: forget everything. Never called in production. */
export function resetHooks(): void {
  ring.length = 0; pending.length = 0;
  seq = 0; dropped = 0; failures = 0; breakerUntil = 0;
}

export const pushConfigured = (): boolean => Boolean(PUSH_URL);
