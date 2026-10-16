/* BL-46 — AGREED FIXES: what an edit says, in words, and whether it can land.
 *
 * The owner, 2026-10-16: *"Assuming both players agree, it doesn't change
 * anything in the game. it'll only be used to solve broken engine/game
 * issues."* One seat proposes, the other agrees, and the server logs the edit
 * as an `amend` action (types.ts). This module is the part both halves share:
 *
 *   · `amendProblem` — why an edit cannot land on this board (null: it can).
 *     apply.ts refuses by it; the server asks it BEFORE showing a proposal to
 *     the other seat, so nobody is asked to agree to an edit that would bounce.
 *   · `amendText` — the one sentence for it. The proposal bar, the game log
 *     line and the bug report the accept files all read this, so the three
 *     cannot describe the same fix differently.
 *
 * Pure: it reads a state and changes nothing.
 */
import type { AmendEdit, GameState, Seat } from './types.ts';
import { AMEND_DESTS, AMEND_SOURCES, AMEND_UNIT_DESTS } from './types.ts';

/** the highest life a fix may set. Life is not capped by the rules; this only
 * stops a fat-fingered number becoming an unreadable board. */
export const AMEND_MAX_LIFE = 999;
/** the most cards one fix may draw — "Debeli's card draw didn't trigger
 * (twice)" is the case; ten is room to spare */
export const AMEND_MAX_DRAW = 10;

const DEST_WORDS: Record<string, string> = {
  hand: 'hand', bin: 'bin', cache: 'cache',
  deckTop: 'the top of the deck', deckBottom: 'the bottom of the deck',
};

const isSeat = (s: unknown): s is Seat => s === 0 || s === 1;

/** the cards a `move` may name: the proposer's own zone */
function zoneOf(s: GameState, seat: Seat, from: string): readonly string[] {
  const p = s.players[seat];
  if (!p) return [];
  if (from === 'hand') return p.hand;
  if (from === 'bin') return p.bin;
  if (from === 'cache') return (p.cache ?? []).map(c => c.card);
  return [];
}

/**
 * Why `edit`, proposed by `seat`, cannot land on `s` — or null when it can.
 * Timing (an open decision) is apply.ts's, not this: a rewind is
 * judged by the server and an edit by both, and the timing words differ.
 */
export function amendProblem(s: GameState, seat: Seat, edit: AmendEdit): string | null {
  if (!edit || typeof edit !== 'object') return 'no fix given';
  switch (edit.kind) {
    case 'life': {
      if (!isSeat(edit.target)) return 'whose life?';
      const n = edit.life;
      if (typeof n !== 'number' || !Number.isInteger(n)) return 'life must be a whole number';
      if (n < 1 || n > AMEND_MAX_LIFE) return `life must be between 1 and ${AMEND_MAX_LIFE} — to end the game, concede`;
      if (s.players[edit.target]!.life === n) return 'that is already the life total';
      return null;
    }
    case 'drawCards': {
      if (!isSeat(edit.target)) return 'who draws?';
      const n = edit.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > AMEND_MAX_DRAW) {
        return `draw between 1 and ${AMEND_MAX_DRAW} cards`;
      }
      return null;
    }
    case 'move': {
      if (!(AMEND_SOURCES as readonly string[]).includes(edit.from)) return `no such zone '${String(edit.from)}'`;
      if (!(AMEND_DESTS as readonly string[]).includes(edit.to)) return `no such place '${String(edit.to)}'`;
      if (edit.from === edit.to) return 'the card is already there';
      const zone = zoneOf(s, seat, edit.from);
      if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= zone.length) {
        return `there is no card at that place in your ${edit.from}`;
      }
      if (zone[edit.index] !== edit.card) {
        return `the card there is no longer ${String(edit.card)} — open the fix again`;
      }
      return null;
    }
    case 'unit': {
      if (!(AMEND_UNIT_DESTS as readonly string[]).includes(edit.to)) return `no such place '${String(edit.to)}'`;
      const u = s.entities[edit.id];
      if (!u || u.kind !== 'unit') return 'that unit is no longer on the board';
      if (u.card !== edit.card) return `that unit is no longer ${String(edit.card)} — open the fix again`;
      return null;
    }
    default:
      return `unknown fix '${String((edit as { kind?: unknown }).kind)}'`;
  }
}

/** The fix in one sentence, read against the board BEFORE it lands. Call only
 * on an edit `amendProblem` passed. */
export function amendText(s: GameState, seat: Seat, edit: AmendEdit): string {
  const name = (p: Seat): string => s.players[p]?.name ?? `Player ${p + 1}`;
  switch (edit.kind) {
    case 'life':
      return `set ${name(edit.target)}'s life to ${edit.life} (it was ${s.players[edit.target]!.life})`;
    case 'drawCards':
      return `${name(edit.target)} draws ${edit.n} card${edit.n === 1 ? '' : 's'}`;
    case 'move':
      return `move ${name(seat)}'s ${edit.card} from their ${edit.from} to `
        + (edit.to === 'hand' || edit.to === 'bin' || edit.to === 'cache' ? `their ${edit.to}` : DEST_WORDS[edit.to]);
    case 'unit': {
      const u = s.entities[edit.id];
      const whose = u ? name(u.controller) : 'a';
      const to = edit.to === 'deckBottom' ? DEST_WORDS[edit.to] : `their ${edit.to}`;
      return `take ${whose}'s ${edit.card}${u?.token ? ' (a token — it is gone)' : ''} off the board${u?.token ? '' : `, to ${to}`}`;
    }
  }
}
