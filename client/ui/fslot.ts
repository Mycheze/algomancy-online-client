/**
 * REPORT #107 / CARD-TODO #94 — WHERE ON THE BATTLE PANEL A FORMATION
 * PLACEMENT OPTION POINTS.
 *
 * The owner: *"Spawning something in formation does now work, but I should be
 * able to click WHERE rather than using a button in the top bar. Clicking on
 * the battlefield is better UX"*.
 *
 * The engine half shipped first: every `kind: 'formationSlot'` option now
 * carries a display-only `spot: FormationSpot` beside its label, because with
 * only label prose the client could not draw a drop target even in principle.
 * This module is the other half — it turns a spot back into a place on screen.
 *
 * ⚠ THE ANSWER NAMESPACE IS UNCHANGED, AND NOTHING HERE MAY CHANGE IT. A
 * placement is still answered by the option's INTEGER INDEX; `spot` is a
 * second, redundant spelling of the same option that exists so a client can
 * point at it. `FormationSlotOffer.targets[].i` is that index, carried
 * through untouched, and `server/rooms.ts` `referenceKey` and the R200
 * forensic stack keep working because they never see this file.
 *
 * ── WHY THIS IS A SEPARATE MODULE, AND WHY IT DERIVES ─────────────────
 *
 * `ui/main.ts` is the page entry point and cannot be imported by a test. Every
 * judgement here is one a test can put a number on, so it lives out here with
 * the rest of `ui/inspect.ts`'s kin.
 *
 * And every judgement DERIVES rather than enumerates. There is no list of the
 * cards that ask this question, no list of the three ask sites, and no copy of
 * `E.formationSlots`. `215-formation-click.test.ts` checks the derivations
 * against the engine's own `formationSlots` output — by REFERENCE EQUALITY on
 * the column array the engine hands back — so a fourth ask site, or a change
 * to what a grid is, is caught rather than silently mis-drawn.
 */
import type { Decision, EntityId, FormationSpot, GameState, Seat } from '../engine/src/types.ts';

/**
 * A place on the committed battle panel, in the coordinates `battleHtml`
 * actually draws in — which are ATTACK COLUMN INDEXES for both seats, because
 * a blocking column is keyed to the attacking column it blocks (R72) and the
 * panel stacks the two halves of one `ci` in one `.col`.
 *
 * ⚠ `ci` is therefore NOT the grid index the engine's `hole` spot carries for
 * a defender. `attackColumnOf` below is the whole of that translation, and it
 * is the one thing in this file a reader is likely to get wrong.
 */
export type SpotAnchor =
  | { kind: 'end'; end: 'left' | 'right' }
  | { kind: 'col'; ci: number }
  | { kind: 'out' };

export interface SpotTarget {
  /** THE ANSWER — the option's index in `Decision.options`, untouched */
  i: number;
  anchor: SpotAnchor;
  /** the engine's own prose for this option, for the target's tooltip */
  label: string;
}

export interface FormationSlotOffer {
  /** whose GRID these spots are in — see `gridSeatOf` */
  gridSeat: Seat;
  /** every option that resolves to a place on screen, in option order. An
   * option whose spot no longer names anything (the board moved under it) is
   * absent: the top-bar button still answers it. */
  targets: SpotTarget[];
}

/**
 * WHOSE GRID a formation question is about, derived from the question itself.
 *
 * The engine does not send this, and it is NOT `Decision.seat`: under R225 the
 * slots come from the grid the SOURCE ENTITY is standing in, which control
 * theft can make somebody else's. But `E.formationSlots` offers "a new column
 * on the left/right" if and ONLY if the grid is the attacker's — a blocking
 * column is keyed to an attacking column, so a new one has no index to exist
 * at — and it offers both or neither. So the presence of an `end` spot IS the
 * answer, and it is an answer the engine cannot drift away from without the
 * conformance test in `215-formation-click.test.ts` going red.
 */
export function gridSeatOf(s: GameState, dec: Decision): Seat | null {
  const b = s.battle;
  if (!b) return null;
  return dec.options.some(o => o.spot?.kind === 'end') ? b.attacker : b.defender;
}

/** the ATTACK column index the engine's grid index `gi` is drawn at */
function attackColumnOf(s: GameState, gridSeat: Seat, gi: number): number | null {
  const b = s.battle;
  if (!b) return null;
  // the attacker's grid IS `b.columns`, so its index is already the panel's
  if (gridSeat === b.attacker) return gi < b.columns.length ? gi : null;
  // the defender's grid is `b.blocks` READ IN KEY ORDER (E.formationGrid), and
  // the keys are the attack columns being blocked — which is exactly what the
  // panel indexes by. The compaction is the whole reason this function exists.
  const keys = Object.keys(b.blocks).map(Number).sort((a, z) => a - z);
  const ci = keys[gi];
  return ci === undefined ? null : ci;
}

/** the attack column whose half is holding `unit`, on `gridSeat`'s side */
function columnHolding(s: GameState, gridSeat: Seat, unit: EntityId): number | null {
  const b = s.battle;
  if (!b) return null;
  if (gridSeat === b.attacker) {
    const ci = b.columns.findIndex(col => col.includes(unit));
    return ci >= 0 ? ci : null;
  }
  for (const [k, col] of Object.entries(b.blocks)) if (col.includes(unit)) return Number(k);
  return null;
}

/**
 * One spot, as a place on screen — or null when it names nothing the panel is
 * drawing. Null is a real answer and not a failure: a spot is deliberately
 * something that SURVIVES the board moving (R29), so it can outlive the thing
 * it was measured against, and the engine's own `slotForSpot` returns null in
 * the same cases. A target we cannot draw is simply not drawn, and the
 * decision bar's button still answers it.
 */
export function spotAnchor(s: GameState, gridSeat: Seat, spot: FormationSpot): SpotAnchor | null {
  if (spot.kind === 'out') return { kind: 'out' };
  if (spot.kind === 'end') return { kind: 'end', end: spot.end };
  const ci = spot.kind === 'behind'
    ? columnHolding(s, gridSeat, spot.unit)
    : attackColumnOf(s, gridSeat, spot.column);
  return ci === null ? null : { kind: 'col', ci };
}

/**
 * The whole offer for the open decision, or null when there is nothing to
 * draw. Null for every decision that is not a `formationSlot`, for a board
 * with no battle on it, and — deliberately — for an offer where NOT ONE spot
 * resolved, so the panel never lights up an empty invitation.
 */
export function formationSlotOffer(s: GameState, dec: Decision | null | undefined): FormationSlotOffer | null {
  if (!dec || dec.kind !== 'formationSlot' || !s.battle) return null;
  const gridSeat = gridSeatOf(s, dec);
  if (gridSeat === null) return null;
  const targets: SpotTarget[] = [];
  dec.options.forEach((o, i) => {
    if (!o.spot) return;
    const anchor = spotAnchor(s, gridSeat, o.spot);
    if (anchor) targets.push({ i, anchor, label: o.label });
  });
  return targets.length ? { gridSeat, targets } : null;
}
