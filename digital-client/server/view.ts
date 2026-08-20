/* Per-seat redaction (docs/04 §6 viewFor, docs/03 hidden information).
 *
 * The engine state is fully authoritative and contains hidden information:
 * both hands, the shared deck order, and each player's face-down (dormant)
 * resource elements. Never send the raw state to a client — the client is
 * untrusted by construction. viewFor(state, seat) returns the slice `seat` is
 * allowed to see; redactEvent blurs log lines that would leak the same.
 *
 * What is hidden from a seat (everything else is public):
 *  - the OPPONENT's hand contents        -> count only (card backs)
 *  - the shared deck contents & order    -> count only (deck order is derivable
 *                                           from the seed, so we also drop it)
 *  - the OPPONENT's DORMANT resources     -> element hidden (they are face-down)
 *  - the seed / rngState                 -> dropped (deck order derivation)
 *  - a decision (+ its options/suspension) that belongs to the other seat
 *
 * Public (sent as-is): bins, life, in-play entities (units/tokens/mods),
 * formations/battle, the stack, phase/turn, and each seat's own everything.
 */
import { packCycle } from '../engine/src/engine.ts';
import type { EngineEvent, GameState, Seat } from '../engine/src/types.ts';

/** Placeholder card name for a hidden card (opponent hand / deck). The client
 * renders any card by this exact name as a face-down back. */
export const HIDDEN_CARD = '__HIDDEN__';

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** Draft-mode pack metadata for the pack `seat` is currently looking at
 * (additive; present in the view only while the draft step is open, i.e.
 * draftDone !== null — after the packs pass, packs[seat] is next turn's pack
 * and describing it would mislead). */
export interface PackInfo {
  /** 1-based deal serial of this physical pack (which dealt pack this is) */
  packNumber: number;
  /** cards dealt into it (10, unless the deck ran short) */
  originalSize: number;
  /** cards in it right now (the commit invariant conserves size, so this
   * normally equals originalSize — kept for the UI and for future rules) */
  remaining: number;
  /** hand↔pack merges already committed on this pack since it was dealt —
   * how picked-over it is (your own commit counts once you've made it) */
  picksMade: number;
  /** looks this pack gets in total before it is recycled (N+1 — 3 in 1v1) */
  picksTotal: number;
  /** what becomes of this pack after your current commit — see
   * engine.ts packCycle, which is the single source of this schedule.
   * 'recycled' is the one the UI used to get wrong: on the cycle's final
   * look the leftovers go to the bottom of the deck, NOT to your opponent. */
  after: 'returns' | 'others' | 'recycled';
}

export type SeatView = GameState & { packInfo?: PackInfo };

/** The redacted GameState that `seat` is allowed to receive.
 *
 * `frozenOpp`: during SIMULTANEOUS deployment, each seat's view of the
 * opponent is served from the deploy-start snapshot — the opponent's live
 * moves stay invisible until both players are done (main.ts then flushes the
 * held events as the reveal). */
export function viewFor(state: GameState, seat: Seat, frozenOpp?: GameState | null): SeatView {
  const v = structuredClone(state) as SeatView;

  if (frozenOpp && state.phase === 'deploy') {
    const o = other(seat);
    // the opponent's half of the world, exactly as deployment began
    v.players[o] = structuredClone(frozenOpp.players[o]!);
    for (const key of Object.keys(v.entities)) {
      if (v.entities[Number(key)]!.controller === o) delete v.entities[Number(key)];
    }
    for (const [key, en] of Object.entries(frozenOpp.entities)) {
      if (en.controller === o) v.entities[Number(key)] = structuredClone(en);
    }
    // done-flags stay live: "opponent finished deploying" is public
  }

  // deck order is hidden (and derivable from the seed) — send a count only.
  // Constructed per-player decks too: even your OWN deck's order is hidden.
  v.sharedDeck = v.sharedDeck.map(() => HIDDEN_CARD);
  if (v.decks) v.decks = v.decks.map(d => d.map(() => HIDDEN_CARD));

  // packs are face-down (Manual p.17: "packs may only be interacted with and
  // looked at during the draft step, and players may not look at the packs of
  // other players") — a seat sees their OWN pack only while their draft step
  // is open (uncommitted); counts are always public.
  const draftOpen = state.mode === 'draft' && state.phase === 'planning'
    && state.draftDone !== null && !state.draftDone[seat];
  v.packs = state.packs.map((pack, s) =>
    s === seat && draftOpen ? [...pack] : pack.map(() => HIDDEN_CARD));
  // seed/rngState would let a client reconstruct the deck order.
  v.seed = 0;
  v.rngState = 0;

  const opp = other(seat);
  for (const p of v.players) {
    if (p.seat === opp) {
      // opponent hand -> card backs (count preserved for layout)
      p.hand = p.hand.map(() => HIDDEN_CARD);
      // opponent DORMANT resources are face-down: hide the element. Open and
      // expended resources are public (they have been turned face-up).
      p.resources = p.resources.map(r =>
        r.state === 'dormant' ? { ...r, kind: 'hidden' as unknown as typeof r.kind } : r,
      );
    }
  }

  // a pending decision (and the suspension carrying its private options) is
  // only ever shown to the seat that must answer it.
  if (v.decision && v.decision.seat !== seat) {
    v.decision = null;
    v.suspension = null;
  }

  // draft mode: identify the pack this seat is looking at (additive field —
  // older clients ignore it). Only while the draft step is running: once the
  // packs pass, packs[seat] belongs to NEXT turn's look.
  if (state.mode === 'draft' && state.draftDone !== null) {
    const meta = state.packMeta?.[seat];
    if (meta) {
      const cyc = packCycle(state.turn, state.players.length);
      v.packInfo = {
        packNumber: meta.serial,
        originalSize: meta.originalSize,
        remaining: state.packs[seat]!.length,
        picksMade: meta.commits,
        picksTotal: cyc.total,
        after: cyc.after,
      };
    }
  }

  return v;
}

/** Blur a single event's rendered message for `seat`. Returns a copy; the
 * original (authoritative) event is kept server-side untouched. */
export function redactEvent(ev: EngineEvent, seat: Seat, names: string[]): EngineEvent {
  // recycle names the card that went to the (hidden) bottom of the deck.
  if (ev.type === 'recycle' && typeof ev.data?.['seat'] === 'number' && ev.data['seat'] !== seat) {
    const who = names[ev.data['seat'] as number] ?? 'Opponent';
    return { ...ev, msg: `${who} recycles a card for a dormant resource.` };
  }
  return ev;
}

/** Redacted log lines for `seat` from the full event history. */
export function redactLog(events: EngineEvent[], seat: Seat, names: string[]): string[] {
  return events.map(e => redactEvent(e, seat, names).msg);
}
