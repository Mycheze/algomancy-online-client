/**
 * WHAT THE MAIN BUTTON DOES — the prompt bar's primary button says where a
 * click takes you ("To Blockers", "Resolve Jelly", "End Turn"), not "Pass".
 *
 * Board round 8 (owner's choice): the destination on the button, and — when
 * yours is the FIRST of the two passes a battle window needs — a small second
 * line, "‹opponent› can reply", because the destination is only reached if
 * they pass too.
 *
 * Pure: engine TYPES only, so a test can drive it over bare fixture states.
 *
 * ⚠ `passOutcome` MIRRORS THE ENGINE'S PASS RULE (engine.ts `passPriority` /
 * `advanceBattleStep` / `pumpCombatDamage` / `endBattleRound`). If those
 * change, this changes with them — 706 pins each row.
 *   - two passes resolve the top of the WINDOW's stack if it has any item;
 *     an item in a region where only one player is present is not in the
 *     window (CR 703.7, engine `soloStacked`) and drains on its own
 *   - otherwise the step advances: attackWindow → blocks, blockWindow →
 *     damage, damageWindow → `pendingSub` (null reads as 'after'),
 *     afterWindow → the counterattack round, or the end of the battle phase
 *     when round 1 happened and nobody was sent (round 2 ends the instant it
 *     starts — the same test as ui/passrelease.ts passEndsBattlePhase).
 */
import type { BattleState, GameState, Seat, StackItem } from '../engine/src/types.ts';

export interface PassLabel {
  /** the button's text */
  text: string;
  /** a small second line under it, or absent */
  note?: string;
}

/** what two passes in a row do from here */
export type PassOutcome =
  | { kind: 'resolve'; item: StackItem }
  | { kind: 'blocks' }
  | { kind: 'damage' }
  | { kind: 'substep'; sub: NonNullable<BattleState['pendingSub']> }
  | { kind: 'counterattack' }
  | { kind: 'endBattle' }
  | { kind: 'unknown' };

const other = (p: Seat): Seat => (p === 0 ? 1 : 0);

/** engine `soloStacked`: a battle-phase item whose region has fewer than two
 * players present never enters the priority window */
export function soloStacked(s: GameState, item: StackItem): boolean {
  return s.phase === 'battle' && (s.regions[item.region]?.presentSeats ?? []).length < 2;
}

/** engine `resolveTop` in battle: the topmost item that is in the window */
export function windowTop(s: GameState): StackItem | null {
  for (let i = s.stack.length - 1; i >= 0; i--) {
    const it = s.stack[i]!;
    if (!soloStacked(s, it)) return it;
  }
  return null;
}

/** what happens when both players pass the current battle window */
export function passOutcome(s: GameState): PassOutcome {
  const b = s.battle;
  if (s.phase !== 'battle' || !b) return { kind: 'unknown' };
  const top = windowTop(s);
  if (top) return { kind: 'resolve', item: top };
  switch (b.step) {
    case 'attackWindow': return { kind: 'blocks' };
    case 'blockWindow': return { kind: 'damage' };
    case 'damageWindow': return { kind: 'substep', sub: b.pendingSub ?? 'after' };
    case 'afterWindow':
      // engine endBattleRound: round 1 hands over to round 2, which ends at
      // once when round 1 was a real battle and nobody was sent at block time
      if (s.battleRound === 1 && !(b.happened && b.sentAttackers.length === 0)) return { kind: 'counterattack' };
      return { kind: 'endBattle' };
    default: return { kind: 'unknown' };
  }
}

const SUB_NAME: Record<NonNullable<BattleState['pendingSub']>, string> = {
  Swift: 'Swift damage', normal: 'normal damage', Sluggish: 'Sluggish damage', after: 'After Combat',
};

/** the button's words for this battle window */
function battleText(s: GameState): string {
  const o = passOutcome(s);
  switch (o.kind) {
    case 'resolve': return `Resolve ${o.item.card ?? o.item.label}`;
    case 'blocks': return 'To Blockers';
    case 'damage': return 'To Damage';
    case 'substep': return `To ${SUB_NAME[o.sub]}`;
    case 'counterattack': return 'To Counterattack';
    case 'endBattle': return 'End Battle';
    default: return 'Pass';
  }
}

/**
 * The main button's label for `seat` in this state. `seat` is the seat the
 * button belongs to: the priority holder in battle, the done-button's seat in
 * planning, haste and deployment.
 */
export function passLabel(s: GameState, seat: Seat): PassLabel {
  if (s.phase === 'planning') return { text: s.hasteDone ? 'To Battle' : 'Done Planning' };
  if (s.phase === 'deploy') return { text: s.deployDone?.[other(seat)] ? 'End Turn' : 'Done Deploying' };
  if (s.phase === 'battle') {
    const b = s.battle;
    if (b?.step === 'blocks') return { text: 'Confirm Blocks' };
    const text = battleText(s);
    // the first of the two passes: nothing happens unless the opponent passes too
    return s.passes === 0
      ? { text, note: `${s.players[other(seat)]!.name} can reply` }
      : { text };
  }
  return { text: 'Pass' };
}
