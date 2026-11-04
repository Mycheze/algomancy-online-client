/* UNDO AND REDO ON THE TABLE (BL-65) — the history, as pure stacks.
 *
 * The builder's Undo used to be one step, and only for a Re-sort. Now every
 * change the table makes can be taken back and put again, by a button in the
 * toolbar (no keyboard needed on an iPad) or Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y.
 *
 * A SNAPSHOT, NOT AN INVERSE. Each entry is the whole of what the table edits
 * — the deck, Maybe, the sideboard, the piles — as it was before a change.
 * Undo hands the controller the snapshot to commit; it goes through the
 * table's one door (ui/tabletop.ts place()) like any other change, so the host
 * saves it the way it saves a drop. An inverse operation per kind of edit would
 * be a second implementation of every edit; a snapshot is just the state.
 *
 * Per host: a history belongs to one table (`key`, the `?table=` value), and
 * opening another starts a fresh one. Capped at HISTORY_CAP entries.
 *
 * Pure: no DOM, no module state. ui/tabletop.ts holds the one History.
 */
import type { DeckPile } from './deckarrange.ts';

/** what the table edits, all of it */
export interface Snap {
  cards: readonly string[];
  /** null = the host has none (the challenge has no Maybe, no sideboard) */
  maybe: readonly string[] | null;
  side: readonly string[] | null;
  /** null = never arranged */
  piles: readonly DeckPile[] | null;
}

export interface History {
  key: string;
  /** oldest first; the last is what Undo restores */
  past: readonly Snap[];
  /** what Redo restores, the next one last */
  future: readonly Snap[];
}

export const HISTORY_CAP = 100;

export const emptyHistory = (key: string): History => ({ key, past: [], future: [] });

/** a deep copy, so a later edit of the host's arrays cannot reach back in */
export function snapOf(s: Snap): Snap {
  return {
    cards: [...s.cards],
    maybe: s.maybe ? [...s.maybe] : null,
    side: s.side ? [...s.side] : null,
    piles: s.piles ? s.piles.map(p => ({ ...p, cards: [...p.cards] })) : null,
  };
}

/** a change is about to be made: `before` is the state it changes. Redo's
 * stack goes (a new change forks the timeline). */
export function record(h: History, before: Snap): History {
  const past = [...h.past, snapOf(before)];
  return { key: h.key, past: past.length > HISTORY_CAP ? past.slice(past.length - HISTORY_CAP) : past, future: [] };
}

/** step back: the snapshot to restore, and the history after it (`now` goes
 * on Redo's stack). null when there is nothing to undo. */
export function undo(h: History, now: Snap): { h: History; to: Snap } | null {
  const to = h.past[h.past.length - 1];
  if (!to) return null;
  return { to, h: { key: h.key, past: h.past.slice(0, -1), future: [...h.future, snapOf(now)] } };
}

/** step forward again: the mirror of undo */
export function redo(h: History, now: Snap): { h: History; to: Snap } | null {
  const to = h.future[h.future.length - 1];
  if (!to) return null;
  return { to, h: { key: h.key, past: [...h.past, snapOf(now)], future: h.future.slice(0, -1) } };
}

export const canUndo = (h: History | null, key: string): boolean => !!h && h.key === key && h.past.length > 0;
export const canRedo = (h: History | null, key: string): boolean => !!h && h.key === key && h.future.length > 0;
