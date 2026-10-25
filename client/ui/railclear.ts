/* CT-369 — THE PICK DIALOG KEEPS OFF THE RAIL.
 *
 * With a draft or bottom pick up, a click on the rail's report button hid the
 * pick and opened nothing. Measured in headless Chrome (room DRFT, a draft
 * pick, 1440x900): the pick box is min(1180px, 96vw) wide and centred on the
 * WINDOW, so it ran 128px into the rail — and its own "look at the board"
 * button sat exactly over the rail's report button. Narrower boxes miss the
 * button and land on the dim outside the box instead, which hides the pick too.
 *
 * So while the pick is up the rail stands above the pick's dim (style.css,
 * `#app.board.pickup > .side`), and the dialog is centred in what is left of
 * the window: this is how much to leave clear on the right. Pure, so a test
 * can hand it boxes; main.ts relayout() applies it as `--pick-railclear`.
 */

export interface RailBox { left: number; top: number; width: number }

/**
 * Pixels the pick dialog must leave clear on the window's right for the rail.
 * Zero when there is no rail beside the table — none drawn, the rail stacked
 * under the board on a narrow screen, or the narrow board's drawer parked off
 * the window's right edge.
 */
export function railClearance(viewW: number, side: RailBox | null): number {
  if (!side || !(side.width > 0)) return 0;
  // beside the table means: starting in the window's right half, inside it
  if (side.left <= viewW / 2 || side.left >= viewW) return 0;
  return Math.ceil(viewW - side.left);
}
