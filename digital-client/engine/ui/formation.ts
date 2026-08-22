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

/** what a re-key did to an in-progress block preview */
export interface Rekeyed {
  /** the preview, re-keyed onto the attacking line as it stands NOW */
  columns: EntityId[][];
  /** blockers whose attacking column left the line — unplaced again, and the
   * one thing the player has to be told about */
  dropped: EntityId[];
  /** true when any key moved or any blocker came loose — nothing to repaint
   * or republish otherwise */
  changed: boolean;
}

/**
 * Carry an in-progress block preview across an R72 collapse or an R75
 * left-insert.
 *
 * THE INDEX IS THE MEANING (see `publishCols`) — and R72 made that a hazard
 * rather than a convention, because the attacking line's indices are still
 * MOVING during the `blocks` step. When the last unit in a column dies the
 * columns beside it close in ("HOLD THE LINE": *only* before blocks are
 * declared, which is exactly this window), and every key at or right of the
 * hole shifts left by one. R75's left-insert shifts them the other way. The
 * defender is mid-click through both.
 *
 * **The keys are re-keyed by WHO IS STANDING IN THE COLUMN, never by index
 * arithmetic off a length delta.** Two reasons, and the second is the one that
 * decided it:
 *
 * - A length delta is not a reliable signal. One action can collapse a column
 *   AND place a unit at the right-hand end (R75 resolves placements on the
 *   same death that empties a column), so the line can shift a full lane with
 *   `columns.length` unchanged between two paints. And the converse: a
 *   plain right-hand append changes the length while shifting NOTHING, so a
 *   length trigger would throw the player's work away for free.
 * - The player never chose "column 3". They chose *that Whale*. Following the
 *   attacker preserves what they actually meant, so a remap cannot silently
 *   move a blocker somewhere they did not point at — the failure mode that
 *   makes remapping-by-index worse than losing the work.
 *
 * The one case with no honest answer is a column that is **gone** — every
 * attacker in it died, so there is nothing left for those blockers to answer.
 * Their work cannot be preserved without inventing a choice, so they are
 * handed back unplaced and reported in `dropped`; the caller says so out loud.
 * That is the only part that is a re-seed, and it is the smallest part that
 * can be.
 *
 * Resync-proof by construction: entity ids survive the JSON the server pushes,
 * and `building` state does not — so a rule written in ids keeps working
 * across exactly the reload that a rule written in indices cannot see.
 *
 * @param before the attacking line as it stood when `build` was last keyed
 * @param after  the attacking line now
 * @param build  my in-progress blockers, keyed to `before`
 */
export function rekeyBuild(
  before: readonly (Col | undefined)[],
  after: readonly (Col | undefined)[],
  build: readonly (Col | undefined)[],
): Rekeyed {
  // where every attacker stands NOW. First column wins: a unit is in exactly
  // one column, and a malformed line must not be able to steer the re-key.
  const at = new Map<EntityId, number>();
  after.forEach((col, ci) => (col ?? []).forEach(id => { if (!at.has(id)) at.set(id, ci); }));
  const columns: EntityId[][] = [];
  const dropped: EntityId[] = [];
  const taken = new Set<number>();
  let changed = false;
  build.forEach((col, ci) => {
    if (!col || !col.length) return;
    const was = before[ci] ?? [];
    let to = -1;
    for (const id of was) {
      const j = at.get(id);
      if (j !== undefined) { to = j; break; }
    }
    // A column with nobody in it cannot be identified — but it also cannot
    // exist here, since an emptied column collapses in this very window. Left
    // where it is rather than dropped, so the unreachable case fails quiet.
    if (to === -1 && !was.length && ci < after.length) to = ci;
    // two old columns landing on one new one is likewise impossible (a unit
    // stands in one column); if it happens the second loses rather than
    // overwriting the first
    if (to === -1 || taken.has(to)) { dropped.push(...col); changed = true; return; }
    taken.add(to);
    if (to !== ci) changed = true;
    columns[to] = [...col];
  });
  // holes are lanes, not absences — publishCols says why
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];
  return { columns, dropped, changed };
}
