/* THE LIVE COUNT ON A CARD — what a card that reads a battle ledger shows
 * while it is in your hand or on the stack (#5, #85, #130; owner 2026-11-03).
 *
 * The engine says WHAT the number is (`CardBehavior.xPreview` / `xPreviewRows`,
 * UI-only, PURE); this module says how it is written. The owner, on Mischievous
 * Reclaimer's "X=0 now" chip and its zoom line "X = 0 right now — your allies
 * dead this battle (it draws on the 2nd)": *"It's not X, there's no X on the
 * card. And it spells out how the card works in the bonus area for some
 * reason, despite the card being very clear."* So:
 *
 *   1. The letter X only on a card whose printed text has an X: "X=3".
 *   2. A card that counts without an X shows the count in its own terms, as
 *      briefly as it can ("1/2" toward "the second ally dies"), or nothing
 *      where the number tells the player nothing the board does not.
 *   3. The zoom never explains the card: at most the chip's bare count. A
 *      label survives only where it NAMES a row of several (a seat, a mode).
 *
 * The rows' labels stay in the engine data: the stack still narrows by them
 * (a declared mode, a targeted player) and the tests read them.
 */
import { getCard, type XPreviewRow } from '../engine/src/cards/dsl.ts';

/** does the card's printed text carry the letter X? */
export function printsX(name: string): boolean {
  try { return /\bX\b/.test(getCard(name).text ?? ''); } catch { return false; }
}

/** The ONE row the chip shows when a card has several (owner, 2026-09-27,
 * MBRE): the row the card marks, else the highest — the value the player can
 * choose to get (the target, the mode). */
export const xHeadline = (rows: readonly XPreviewRow[]): XPreviewRow =>
  rows.find(r => r.headline) ?? rows.reduce((a, b) => (b.x > a.x ? b : a));

const top = (rows: readonly XPreviewRow[]): number => Math.max(...rows.map(r => r.x));

/**
 * Every card that counts something WITHOUT printing an X, and its count in
 * its own terms; null = show nothing. test/1060 §8 derives the set from the
 * registry, so a new card with a live count and no X fails until it is here.
 */
export const COUNT_TERMS: Readonly<Record<string, (rows: readonly XPreviewRow[]) => string | null>> = {
  // "When the second ally dies in this battle, Draw a card."
  'Mischievous Reclaimer': r => `${Math.min(r[0]!.x, 2)}/2`,
  // "…equal to the number of units that died in this battle."
  'Burning Vengeance': r => `${r[0]!.x} died`,
  // "…equal to the number of cards trashed in this battle…"
  'Dropslime': r => `${r[0]!.x} trashed`,
  // "Your units gain +1/+0 for each nontoken spell you've played in this battle."
  'Animated Spark': r => `+${r[0]!.x}/+0`,
  // "Spells cost each player [two] more to play for each spell their team has
  // previously played in this battle." — what YOUR next spell costs extra
  'The Silent': r => `+${xHeadline(r).x} to play`,
  // "Negate target spell effect if its cost is less than or equal to the
  // greatest amount of life lost by a player in this battle."
  'Null Drone': r => `≤${top(r)}`,
  // "If you have gained or lost life in this battle, I gain +4/-4." — on or off
  'Riftspawn Remnant': r => (r[0]!.x > 0 ? '+4/-4' : null),
  // "…equal to the number of units you control." — the board shows them
  'Verdant Vengeance': () => null,
};

/** the chip on the card: "X=N" on an X card, the count in a counting card's
 * own terms, or null for no chip */
export function liveChip(name: string, rows: readonly XPreviewRow[]): string | null {
  if (!rows.length) return null;
  if (printsX(name)) return `X=${xHeadline(rows).x}`;
  return COUNT_TERMS[name]?.(rows) ?? null;
}

/** a row's label, when it NAMES the row among several (a seat, a one-word
 * mode like "lost" or "gained") rather than explaining the card */
const rowName = (r: XPreviewRow, rows: readonly XPreviewRow[]): string =>
  rows.length > 1 && (r.seat !== undefined || /^\S+$/.test(r.label)) ? r.label : '';

/** the same thing where there is room (the zoom, the inspector, the stack
 * viewer): one line per row on an X card, the chip's text once on a
 * counting card, nothing else. `forecast` (the stack viewer, CR annexd
 * x-forecast) words an X as a forecast — "X = 7 now" — beside the paid X it
 * must not be mistaken for */
export function liveLines(name: string, rows: readonly XPreviewRow[], opts: { forecast?: boolean } = {}): string[] {
  if (!rows.length) return [];
  if (!printsX(name)) { const c = COUNT_TERMS[name]?.(rows); return c ? [c] : []; }
  return rows.map(r => {
    const who = rowName(r, rows);
    return `X = ${r.x}${opts.forecast ? ' now' : ''}${who ? ` (${who})` : ''}`;
  });
}
