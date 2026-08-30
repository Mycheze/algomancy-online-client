/* R272 — WHAT A REPAINT IS ALLOWED TO DO TO THE HOVER.
 *
 * Report [142] (CT-155), room QJEY: *"the page resets/scrolls to the top on
 * any change … and also resets the hover effects. It even happens when the
 * other player is doing things in a hidden zone, which just feels clunky."*
 *
 * `hideHoverTip()` was the first statement of `renderNow()`, unconditionally,
 * so the long-hover text box closed on every paint — including the paints
 * driven by an opponent shuffling a hidden zone, which change nothing this
 * seat can see. Measured in headless Chrome with real
 * `Input.dispatchMouseEvent`: hover a board card, repaint without moving the
 * mouse, and `#hovertip` goes from opacity 1 to 0 while the CSS `:hover`
 * highlight and the `#preview` focus rail both survive untouched. The tooltip
 * is the whole of "resets the hover effects".
 *
 * ── WHY THIS IS A MODULE AND NOT A LINE IN main.ts ──────────────────────
 *
 * R230 answered the same shape of question — "may a scroll hide the tip?" —
 * and test/199-hover-scroll.test.ts says at length why the answer cannot be
 * asserted through test/ui-driver.ts: the driver dispatches no mouseover, has
 * `hovertip` in its ABSENT set, and answers `classList.contains` with a flat
 * false, so "the tip is showing" and "the tip is not showing" are the same
 * answer. R230's fix was to move the DECISION out of the listener and into a
 * pure function a test can reach. This is that, for the paint.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────
 *
 * It is R230's question asked of a repaint instead of a scroll: could this
 * have moved the card out from under the cursor?
 *
 *   · the card is GONE from the new board — it died, it was played, it left
 *     for a zone this seat cannot see. The box would be describing something
 *     that is not there, which is exactly why the unconditional hide was
 *     written. Drop it.
 *   · the card MOVED — a column closed ranks, a unit left the hand for the
 *     table. It still exists, but the cursor is now over whatever slid into
 *     its place, so the box would be describing the wrong card. Drop it.
 *   · otherwise the card is where it was, under the same cursor, saying the
 *     same thing. Nothing happened to it, and closing the box the player is
 *     reading is the report. Keep it.
 *
 * The caller re-derives the box's CONTENT from the state that just landed
 * either way, so a kept tip is never stale — `keep` is a decision about the
 * card, not about the text.
 */

/** Everything the decision needs, and nothing that needs a DOM to describe. */
export interface HoverPaint {
  /** the card the tip is about — `e<id>` for a unit, `c<name>` for a card
   * hovered by name (a log line, a decision button). `''` when nothing is
   * hovered, which is the common case by far. */
  key: string;
  /** a node for that SAME card is in the board that was just painted */
  present: boolean;
  /** …and it is somewhere else than it was. Meaningless, and ignored, when
   * the card is not present at all. */
  moved: boolean;
}

/** Does the long-hover tip (and the dwell still counting down towards one)
 * survive the paint that just happened? Total over its whole domain — see
 * test/252 §3e, which enumerates all eight inputs. */
export function hoverSurvivesPaint(p: HoverPaint): boolean {
  if (!p.key) return false;        // nothing is hovered: nothing to keep
  if (!p.present) return false;    // the card is gone
  return !p.moved;                 // …or it is somewhere else now
}
