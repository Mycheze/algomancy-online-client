/* DOM-free shaping for the battle panel's columns.
 *
 * Same split the motion and sound layers use (ui/motion.ts, ui/sfx.ts): the
 * decisions live here and are unit-tested, ui/main.ts only paints them. Both
 * functions came out of playtest DEYK, and both are the kind of off-by-a-lane
 * arithmetic that is invisible in a screenshot and obvious in a test.
 */
import type { EntityId } from '../engine/src/types.ts';

/** a formation column: 0-2 units, front row first */
export type Col = readonly EntityId[];

/** the game's own limit — front row and back row, and that is all */
export const MAX_ROWS = 2;

/**
 * Everything the battle panel can be holding while a declaration is being
 * built, and nothing that is not part of it.
 *
 * One shape for all three declarations, because from the player's side they
 * are one interaction: pick a unit up, put it down somewhere. Attacking fills
 * `columns` (my line, left to right). Blocking fills `columns` too — but keyed
 * by the ATTACKER's column, sparse, see `publishCols` — and `send` with the
 * counterattackers going back the other way. `spellTokens` is [69]'s
 * ride-along on the attack side; the block side keeps its riders in `send`,
 * which `splitCounterattack` separates out at declaration time.
 *
 * `ui.columns` in ui/main.ts is a possibly-sparse array, so every reader here
 * has to survive a hole — never assume `columns[i]` is an array.
 */
export interface Build {
  /** my attack line, or my blockers keyed by attacker column (sparse) */
  columns: EntityId[][];
  /** counterattackers sent back, and the spell tokens riding with them */
  send: EntityId[];
  /** [69] spell tokens riding along with the attack being built */
  spellTokens: EntityId[];
  /** the unit picked up and not yet put down */
  carrying: EntityId | null;
  /** [69] whether the ride-along question has been answered for THIS build */
  rideAnswered: boolean;
}

/**
 * Is there any assignment here worth offering to clear?
 *
 * `carrying` deliberately does not count. A carried unit has not been assigned
 * to anything yet, and Esc drops it by its own earlier rule — a build that is
 * nothing but a unit in hand has nothing to reset.
 *
 * This exists because the two prompt bars each hand-rolled the question and
 * each got a different answer: the attack bar asked about `columns` and
 * `spellTokens`, the block bar about `columns` and `send`, and the Esc key
 * about all three. Three readings of "is anything built" is two too many —
 * whichever one is wrong hides the Clear button from a player who has
 * something to clear.
 */
export function hasBuild(b: Build): boolean {
  return b.columns.some(c => !!c && c.length > 0)
    || b.send.length > 0 || b.spellTokens.length > 0;
}

/**
 * The build a "Clear" leaves behind: a completely empty one.
 *
 * BL-19, straight from the owner — *"reset blocks"*. Un-assigning a six-blocker
 * line one column at a time is the whole complaint, and it is the same
 * complaint on an attack formation and on a counterattack send, so all three
 * share this.
 *
 * It is a fresh object every call, and that matters twice over: the caller
 * copies these arrays into `ui`, so two clears must not end up aliasing one
 * array, and the emptied `columns` must be a NEW array rather than the old one
 * truncated — the old one is what `rekeyBuild` may still be holding as
 * `before`.
 *
 * **Emptying is the whole of it.** Do not be tempted to normalise, compact or
 * re-index on the way through: `columns` is sparse ON PURPOSE and the index is
 * the meaning (`publishCols`), so a clear that "tidies up" is a clear that
 * teaches the next assignment to lie. `[]` has no indices to get wrong, which
 * is exactly why a reset is the safe operation on this array and a compaction
 * is not.
 *
 * Purely local, and it has to stay that way — nothing here declares, sends or
 * commits anything. The one thing the caller still owes is a re-publish:
 * `publishCols` of a cleared build is `[]`, and until that empty payload goes
 * out the opponent's live preview keeps showing a formation that no longer
 * exists.
 */
export function clearBuild(): Build {
  return { columns: [], send: [], spellTokens: [], carrying: null, rideAnswered: false };
}

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

/**
 * Drop the unit you are carrying into row `row` of one column.
 *
 * Playtest BRDM (2026-08-20): *"Sometimes the system wants you to block in a
 * specific order. I was forced to do creature B as a blocker before creature A
 * despite it being pointless."* The column offered ONE open slot at a time and
 * the drop was an append, so the order you clicked units in was the order they
 * ended up standing in — and the front row (which takes the damage) could only
 * ever be the unit you happened to click first. Wanting A in front and B behind
 * meant clicking A first; wanting to change your mind meant taking the whole
 * column apart.
 *
 * So the row you click is the row you get. Dropping into the FRONT of an
 * occupied column pushes the unit standing there back rather than refusing —
 * that is the whole point of the report, and it is why this is a splice and
 * not a push. `Math.min` keeps a click on the back row of an empty column
 * honest (there is no floating unit in a back row with nothing in front).
 *
 * A full column takes no more: `MAX_ROWS` is the game's own limit and the
 * engine refuses a third unit, so the client must not build one either. The
 * caller drops what it was carrying either way — a click on a full column is
 * an answered click, not a swallowed one.
 */
export function dropIntoRow(col: Col, row: number, id: EntityId): EntityId[] {
  const out = [...col];
  if (out.length >= MAX_ROWS) return out;
  out.splice(Math.min(Math.max(row, 0), out.length), 0, id);
  return out;
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
