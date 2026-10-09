/**
 * How long a playback may hold a seat's clock if its client never says it has
 * finished (server/main.ts sendUpdate → setWatchHold). It must be comfortably
 * MORE than the client takes — ui/pace.ts playbackGapsOf: a tempo per stack
 * beat, a tempo for a frame without one, then the longer pause before the
 * hand-over (PLAYBACK_END_MS, report #193) — because this is a backstop for a
 * silent client, not the normal end of the hold. The normal end is
 * `playbackdone`, or the seat acting.
 *
 * Report #198: a playback now STOPS for the player to confirm (ui/pace.ts
 * playbackStopsOf), and this budget does not wait for them. A seat that sits
 * on a stop past it is back on its clock — deliberately: it is no longer
 * watching anything, it is choosing when to go on.
 *
 * Its own module, and built from the client's own constants, so the two sides
 * cannot drift: ui/test/372-recap-end-pause.test.ts holds the budget above the
 * client's schedule for the same frames.
 */
import { PACE_MS, PLAYBACK_END_MS } from '../ui/pace.ts';

export const PLAYBACK_SLACK_MS = 3000;
export const PLAYBACK_MAX_MS = 60_000;

export function playbackBudget(frames: readonly { events: readonly { type: string }[] }[]): number {
  const beats = (f: { events: readonly { type: string }[] }): number =>
    Math.max(1, f.events.filter(e => e.type === 'stackFlash').length);
  const total = frames.reduce((ms, f) => ms + beats(f) * PACE_MS, PLAYBACK_END_MS) + PLAYBACK_SLACK_MS;
  return Math.min(PLAYBACK_MAX_MS, total);
}
