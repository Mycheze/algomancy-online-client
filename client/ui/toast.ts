/* R276 / CT-142 — THE COST TOAST: one shared channel for "you paid for that
 * and it did not happen".
 *
 * ── WHERE THIS COMES FROM
 *
 * R266 (the owner, round 32): *"NOTHING should only exist in the log. The log
 * is for checking past things."* `test/244-log-is-not-the-only-surface` turned
 * that into a MEASUREMENT rather than a slogan: every `ev()` announcement in
 * `engine.ts`/`apply.ts` is parsed out of the source and asked whether the
 * client shows it anywhere but the log. Two things fell out of it.
 *
 *   1. The class that CANNOT have a board surface is the class that announces
 *      an ABSENCE. Nothing moved, nothing died, no badge changed — there is
 *      literally nothing on the table to point at, so the player has to infer
 *      it or read the log.
 *   2. Of those, the ones that MATTER are the ones where the absence COST the
 *      player something they had already paid for: a spell that fizzles, a
 *      cost that cannot be paid so the effect is skipped, a trigger a tax
 *      prevented, a declined `[cost]`, a copy not made, a discount that
 *      expired unused, a life lock, a column that dealt no damage, nothing
 *      lured.
 *
 * CT-142 asked which of those deserve a surface and refused to guess, because
 * it is a product call. The owner made it on 2026-08-30: **a shared toast
 * tier** — one notice channel they all use, brief, near the board, no new
 * permanent UI, easy to extend when a twentieth turns up. This is that
 * channel.
 *
 * ── ⚠ THE RULE IS DERIVED, AND THAT IS THE WHOLE POINT
 *
 * The obvious implementation is a list of the nineteen sentences. It is also
 * the exact defect this repo keeps paying for (docs/13-assessment §7.2, and
 * report #46, closed with a one-card fix and re-filed by the owner twice as
 * the same class): a hand-typed list stops covering the class the day somebody
 * adds a twentieth member, and nothing goes red.
 *
 * So `costToast` is a PREDICATE over the event itself, and every clause of it
 * is either a regex over the engine's own prose or a QUESTION PUT TO AN
 * EXISTING SURFACE:
 *
 *   `beatKeys`        (ui/flash.ts) — does the board pulse anything for this?
 *   `fizzledIds`      (ui/flash.ts) — R271: does the stack strip mark it?
 *   `negatedIds`      (ui/flash.ts) — same, for an answered item
 *   `tokenLossNotice` (ui/inspect.ts) — R266: does the prompt bar already have it?
 *   the R65 erased pile — does `erasedDialogHtml` already draw it?
 *
 * Every one of those is imported rather than restated, so WIDENING A SURFACE
 * NARROWS THIS TIER automatically and no toast is ever the second thing
 * saying the same sentence. That is the direction the ruling wants; it is also
 * the direction a hand-typed list could not move in.
 *
 * ── WHAT THIS IS NOT
 *
 * It is not a confirmation and not a question. Everything here has already
 * happened and none of it can be undone (R194 argues the general case). The
 * player may ignore every toast and lose nothing that is not already in the
 * log — R266 is about the log not being the ONLY surface, not about replacing
 * it, and nothing here removes a line from it.
 *
 * It is also NOT the R266 prompt bar. The owner put the regroup token loss in
 * "the normal warning and choice area" because it is a single, rare, personal
 * loss with a name on it; `244` asserts in so many words that it is not a
 * corner toast. This tier is the other shape: many small losses, several of
 * which can land in one resolution, none of which is worth displacing a live
 * question. `costToast` asks `tokenLossNotice` first so the two can never both
 * fire on the same event.
 *
 * ── SEVERAL CAN FIRE IN ONE RESOLUTION
 *
 * They coalesce, then they queue, and they never truncate silently:
 *
 *   - COALESCE. Identical sentences inside one batch fold into one row with a
 *     `×N` count. Three copies of a cost failing is one fact with a number on
 *     it, not three things to read.
 *   - QUEUE. Distinct sentences stack, oldest at the top, each with its own
 *     expiry staggered by `STAGGER_MS` so a burst does not arrive and vanish
 *     as one block.
 *   - CAP. At most `COST_TOAST_MAX` rows are drawn; anything beyond that is
 *     counted in a `+N more` line that names the log. Dropping the overflow
 *     silently would be a miniature of the bug this fixes.
 *
 * ── TIMING: IT RIDES THE PACING, IT DOES NOT COMPETE WITH IT
 *
 * `HOLD_MS` and `STAGGER_MS` are imported from ui/flash.ts — the constants the
 * beat queue already paces the story with (`STAGGER_MS` is `PACE_MS`, the
 * owner's "1 thing per second"). Nothing here invents a duration, so a change
 * to the client's tempo moves the toasts with it.
 *
 * And the feed point matters as much as the constants: main.ts absorbs these
 * in `applyUpdate`, which runs when ui/pace.ts RELEASES an update, not when it
 * arrives. A held batch's toasts therefore surface with the board that
 * explains them and never ahead of it. That is the same place, and the same
 * reason, as `absorbGlimpse` and `absorbTokenLoss`.
 *
 * ── WHO SEES IT
 *
 * Both seats, unfiltered — deliberately. Six of these announcements carry a
 * `seat` in their data and the rest carry nothing at all, so a seat filter
 * would apply to a quarter of the tier and silently skip the rest, which is
 * worse than not filtering. It leaks nothing: `server/view.ts` has already
 * redacted the batch, so an event that reaches this client is one this client
 * was allowed to be told, and it is a public log line either way.
 */
import { beatKeys, fizzledIds, HOLD_MS, negatedIds, STAGGER_MS } from './flash.ts';
import { tokenLossNotice } from './inspect.ts';
import { esc } from './util.ts';
import type { EngineEvent, EventType } from '../engine/src/types.ts';

/**
 * ⚠ THE CANONICAL CLASSIFIERS. `test/244-log-is-not-the-only-surface` derives
 * the log-only inventory with the same two regexes, and `test/256` asserts the
 * two copies are character-identical — widen one and the other goes red rather
 * than quietly disagreeing about what the class is.
 */

/** does this sentence announce that something DID NOT HAPPEN? */
export const ABSENCE = new RegExp([
  'no ', 'not ', 'nothing', 'never', 'cannot', "can't", 'can no longer', 'declines?',
  'declined', 'skipped', 'prevented', 'unused', 'stays?', 'already', 'is spent',
  'does nothing', 'is not', 'are not', 'fizzl',
].map(w => `\\b${w}`).join('|'), 'i');

/** …and of those, the ones where the absence COST the player something they
 * had already paid for */
export const COSTLY = /(skipped|does nothing|fizzl|is prevented|not copied|is spent|unused|no legal target|cannot be paid|can no longer be paid|is not gained|is not lost|nothing is paid|nothing is lured|no damage through)/i;

/**
 * Event types that ARE an entity arriving in or leaving a zone the board
 * draws. "The unit is gone from the board" is a surface for "the unit died",
 * so an absence worded onto one of these already has somewhere to be seen.
 * Same set, same argument, as 244's — including the deliberate omission of
 * 'erased', the one removal that leaves nothing behind to point at.
 */
export const ZONE_CHANGE: ReadonlySet<string> = new Set<EventType>([
  'spawned', 'died', 'despawned', 'trashed', 'tokenCreated', 'controlChanged',
  'leftBin', 'cached', 'prophesied', 'handEntered', 'draw', 'recycle',
  'draft', 'spellPlayed', 'stackPushed', 'resolved', 'negated',
]);

/** the one label the whole tier wears. ONE string, because a per-case label
 * map is a hand-typed list wearing a different hat — a twentieth announcement
 * would arrive with no label, or with the wrong one. */
export const COST_TOAST_HEAD = '⚠ this did nothing';

/** how many rows are drawn at once; the rest are counted, never dropped */
export const COST_TOAST_MAX = 4;

/** one coalesced notice: the engine's own sentence, and how many times it
 * landed in the batch */
export interface CostToast {
  /** identity for coalescing and for merging a repeat into a live row */
  key: string;
  /** the engine's sentence, verbatim. The client adds no prose of its own —
   * same rule as the R266 bar, and for the same reason: the engine already
   * said it better than a paraphrase could, and a paraphrase drifts. */
  msg: string;
  /** how many identical sentences folded into this row */
  n: number;
}

/** a toast that is up, and the clock reading it comes down at */
export interface LiveCostToast extends CostToast { until: number }

/** the R65 erased pile: `E.ev()` files an 'erased' event's card names on the
 * seat's public erased list, and `erasedDialogHtml` draws that list. So an
 * erase WITH names has a surface and one without does not — the engine's own
 * gate, asked rather than restated. */
function inErasedPile(ev: EngineEvent): boolean {
  const d = ev.data ?? {};
  return ev.type === 'erased' && typeof d['seat'] === 'number'
    && ('cards' in d || 'card' in d);
}

/**
 * THE PURE RULE. Does this one event earn a toast, and what does it say?
 *
 * Pure: no DOM, no clock, no module state. Everything it consults is either
 * the event or another module's exported answer about surfaces.
 */
export function costToast(ev: EngineEvent): CostToast | null {
  const msg = (ev.msg ?? '').trim();
  if (!msg) return null;                        // signal-only: not even a log line
  if (!ABSENCE.test(msg)) return null;          // it announces a change; the board has it
  if (!COSTLY.test(msg)) return null;           // an absence, but nobody paid for it
  if (ZONE_CHANGE.has(ev.type)) return null;    // the zone it left is the surface
  if (beatKeys(ev).length) return null;         // the board pulses it
  if (inErasedPile(ev)) return null;            // the erased dialog draws it
  if (fizzledIds([ev]).length) return null;     // R271: the stack strip marks it
  if (negatedIds([ev]).length) return null;     // …and marks an answered item too
  if (tokenLossNotice([ev], null)) return null; // R266: the prompt bar has it
  return { key: `${ev.type} ${msg}`, msg, n: 1 };
}

/** every toast one batch of events earns, in order, identical sentences folded */
export function costToasts(events: readonly EngineEvent[]): CostToast[] {
  const out: CostToast[] = [];
  const at = new Map<string, CostToast>();
  for (const ev of events) {
    const t = costToast(ev);
    if (!t) continue;
    const seen = at.get(t.key);
    if (seen) { seen.n++; continue; }
    at.set(t.key, t);
    out.push(t);
  }
  return out;
}

/**
 * Fold a batch into the live stack.
 *
 * Expired rows are dropped first, so the queue cannot grow without bound
 * across a long game. A sentence that is ALREADY up is merged rather than
 * duplicated — its count grows and its clock restarts — because two rows
 * saying the same thing is the noise the coalescing exists to prevent.
 *
 * The stagger is `STAGGER_MS` per NEW row, so a resolution that costs the
 * player four different things does not put four rows up and take them all
 * away in the same frame.
 */
export function queueCostToasts(
  live: readonly LiveCostToast[], events: readonly EngineEvent[], now: number,
): LiveCostToast[] {
  const out = live.filter(t => t.until > now).map(t => ({ ...t }));
  let added = 0;
  for (const t of costToasts(events)) {
    added++;
    const until = now + HOLD_MS + added * STAGGER_MS;
    const seen = out.find(o => o.key === t.key);
    if (seen) { seen.n += t.n; seen.until = Math.max(seen.until, until); continue; }
    out.push({ ...t, until });
  }
  return out;
}

/** what is on screen right now: the newest `COST_TOAST_MAX`, and how many live
 * rows did not fit. Never a silent truncation — the caller draws the count. */
export function visibleCostToasts(
  live: readonly LiveCostToast[], now: number,
): { shown: LiveCostToast[]; more: number } {
  const up = live.filter(t => t.until > now);
  const shown = up.slice(Math.max(0, up.length - COST_TOAST_MAX));
  return { shown, more: up.length - shown.length };
}

/** the next clock reading at which the stack changes, or null if it never
 * does. Same shape and same job as `nextFlashWake` — one repaint, scheduled,
 * so a notice about a moment cannot outlive the moment by minutes just
 * because nothing else happened to repaint the board. */
export function nextCostToastWake(live: readonly LiveCostToast[], now: number): number | null {
  let best: number | null = null;
  for (const t of live) {
    if (t.until <= now) continue;
    if (best === null || t.until < best) best = t.until;
  }
  return best;
}

/**
 * The strip itself. A string, like every other piece of markup in this client;
 * the caller drops it into the page.
 *
 * Whole-strip click to dismiss, exactly like the glimpse notice — there is
 * nothing to choose here, so a per-row button would be four buttons that all
 * do the same nothing.
 */
export function costToastHtml(live: readonly LiveCostToast[], now: number): string {
  const { shown, more } = visibleCostToasts(live, now);
  if (!shown.length) return '';
  const rows = shown.map(t => `<div class="costtoast"><b class="costtoasthead">${COST_TOAST_HEAD}</b>`
    + `<span class="costtoastmsg">${esc(t.msg)}</span>`
    + (t.n > 1 ? `<i class="costtoastn">×${t.n}</i>` : '')
    + '</div>').join('');
  const tail = more > 0
    ? `<div class="costtoastmore">+${more} more — all of it is in the log</div>` : '';
  return `<div class="costtoasts" data-btn="costtoastclose" title="nothing here can be undone — click to dismiss">${rows}${tail}</div>`;
}
