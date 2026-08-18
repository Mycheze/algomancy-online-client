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
import type { EngineEvent, GameState, Seat } from '../engine/src/types.ts';

/** Placeholder card name for a hidden card (opponent hand / deck). The client
 * renders any card by this exact name as a face-down back. */
export const HIDDEN_CARD = '__HIDDEN__';

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** The redacted GameState that `seat` is allowed to receive.
 *
 * `frozenOpp`: during SIMULTANEOUS deployment, each seat's view of the
 * opponent is served from the deploy-start snapshot — the opponent's live
 * moves stay invisible until both players are done (main.ts then flushes the
 * held events as the reveal). */
export function viewFor(state: GameState, seat: Seat, frozenOpp?: GameState | null): GameState {
  const v = structuredClone(state) as GameState;

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
  v.sharedDeck = v.sharedDeck.map(() => HIDDEN_CARD);

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
