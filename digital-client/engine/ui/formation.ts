/* DOM-free shaping for the battle panel's columns.
 *
 * Same split the motion and sound layers use (ui/motion.ts, ui/sfx.ts): the
 * decisions live here and are unit-tested, ui/main.ts only paints them. Both
 * functions came out of playtest DEYK, and both are the kind of off-by-a-lane
 * arithmetic that is invisible in a screenshot and obvious in a test.
 */
import type { EntityId } from '../src/types.ts';

/** a formation column: 0-2 units, front row first */
export type Col = readonly EntityId[];

/** the game's own limit — front row and back row, and that is all */
export const MAX_ROWS = 2;

/**
 * The columns to publish to the opponent while you build a formation.
 *
 * THE INDEX IS THE MEANING. While blocking, `columns[ci]` is the blockers you
 * have assigned to the ATTACKER's column ci, so the array is sparse by design:
 * blocking columns 2, 6 and 8 of an eight-wide attack leaves five holes.
 * Compacting them out — which the client used to do — slides every block left,
 * and the attacker watches three blockers pile onto the wrong three columns.
 * It corrected itself the instant blocks were declared, because a declaration
 * is a map keyed by column index, which is exactly what the live preview was
 * throwing away.
 *
 * Holes are preserved as empty columns; only the trailing ones are dropped,
 * since nothing is left of them to misplace.
 */
export function publishCols(columns: readonly (Col | undefined)[]): EntityId[][] {
  const out = Array.from(columns, c => [...(c ?? [])]);
  while (out.length && !out[out.length - 1]!.length) out.pop();
  return out;
}

/**
 * How many rows one half of the battle line must reserve.
 *
 * Every column's front row sits on one shared line, so the halves are a fixed
 * height across the whole battle — but that height is the DEEPEST column in
 * play, not a hardcoded two. A battle of one-unit columns stops reserving a
 * second row nobody is standing in, which is most of them: "the fact that, at
 * every point during attacks, you can see the whole column, including the back
 * row (which might be totally empty) takes up space."
 *
 * `building` is the exception the same report asks for — "all the needed slots
 * in the formation should be shown when there's a choice to be made". While
 * the slots are yours to click, all of them are drawn.
 */
export function halfRows(cols: readonly (Col | undefined)[], building = false): number {
  if (building) return MAX_ROWS;
  // clamped: the engine already refuses a third unit in a column, and a
  // layout that trusts state it did not validate is a layout that can be
  // blown open by one bad column
  return Math.min(MAX_ROWS, cols.reduce((m, c) => Math.max(m, c?.length ?? 0), 0));
}
