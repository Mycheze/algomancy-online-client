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
 *  - a decision (+ its options/suspension) that belongs to the other seat.
 *    R247: the FACT that a seat owes an answer is public even so, and rides as
 *    `pendingAsk` — the asking seat plus, at most, an entity id the receiving
 *    seat already holds. Never the question. See `PendingAsk`.
 *  - R144: the OPPONENT's STACK ITEMS, inside a hidden simultaneous segment
 *    only (see viewFor). Outside one — i.e. in battle — the stack is public.
 *
 * Public (sent as-is): bins, life, in-play entities (units/tokens/mods),
 * formations/battle, the battle stack, phase/turn, and each seat's own
 * everything.
 */
import { packCycle } from '../engine/src/engine.ts';
import type { EngineEvent, EntityId, GameState, Seat } from '../engine/src/types.ts';

/** Placeholder card name for a hidden card (opponent hand / deck). The client
 * renders any card by this exact name as a face-down back. */
export const HIDDEN_CARD = '__HIDDEN__';

/** The opposing seat. Shared: main.ts and rooms.ts flip seats constantly. */
export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

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

/**
 * R247 — THAT A SEAT OWES AN ANSWER IS PUBLIC; WHAT IS BEING CHOSEN IS NOT.
 *
 * Playtest report #117: *"opponent's should see the same effect like thing on
 * the stack that's lightly flashing to indicate when an opponent is choosing
 * targets for a trigger (like here with the Alluring trigger). Show me that
 * Rashi is choosing that."*
 *
 * Measured against the report's own example — a real {Alluring} on-attack
 * trigger — the other seat's view at that instant held `decision: null`,
 * `stack: []`, `resolving: null` and an empty legal list. The {Alluring} target
 * is chosen while the trigger is being PUT ON the stack, so there is nothing on
 * the stack to flash on either screen, and the decision is nulled below before
 * it reaches anyone. The client could say "waiting" and nothing more, because
 * nothing more ever arrived.
 *
 * ⚠ THIS IS DELIBERATELY THE SMALLEST POSSIBLE THING. Two fields, and the
 * second one is an ENTITY ID THE SEAT ALREADY HOLDS — the client reads the name
 * off its own `entities` map. No prompt, no options, no candidate targets, no
 * decision kind, not even the card name as a string: a stub that narrows what
 * the opponent is about to pick is worse than no stub at all, and the cheapest
 * way to be sure of that is for the stub to carry no value the receiving seat
 * did not already have. `server/test-pending-ask.ts` asserts exactly that, by
 * walking the stub's leaves against the rest of the same seat's view rather
 * than against a list of fields somebody remembered to check.
 */
export interface PendingAsk {
  /** the seat that owes an answer */
  seat: Seat;
  /**
   * The entity whose ability raised the question — present only when it is
   * ALREADY in this seat's redacted view.
   *
   * `StackItem.sourceId` is set for `triggered` and `activated` items and for
   * nothing else, which is the natural half of the gate: a spell being cast out
   * of a hand has no source entity, so a card nobody can see can never be named
   * here. The other half is the lookup against `v.entities` — the map as this
   * seat actually receives it — so "already public" is measured against the
   * redaction rather than argued about.
   */
  source?: EntityId;
}

export type SeatView = GameState & { packInfo?: PackInfo; pendingAsk?: PendingAsk };

/**
 * The stub, or null when there is nothing publishable.
 *
 * `frozenOpp` gates the whole thing, and it is the SAME gate R144 uses for the
 * stack a few lines up — for the same reason and with no second opinion about
 * it. Inside a hidden simultaneous segment the opponent's half of the world is
 * served from the segment-start snapshot; "they are being asked something about
 * their Blightmound" is a live readout of activity behind that freeze, which is
 * the one thing the freeze exists to prevent. Outside a segment the stack is
 * public and so is this.
 */
function pendingAskFor(v: SeatView, seat: Seat, frozenOpp?: GameState | null): PendingAsk | null {
  const asker = v.decision?.seat;
  if (asker === undefined || asker === seat || frozenOpp) return null;
  const ask: PendingAsk = { seat: asker };
  const susp = v.suspension;
  const source = susp?.type === 'cast' || susp?.type === 'resolve'
    ? susp.item.sourceId
    : susp?.type === 'payTrigger' ? susp.trigger.sourceId : undefined;
  // the lookup IS the "already public" test: `v.entities` here is the map this
  // seat receives, after every redaction above has run on it
  if (source !== undefined && v.entities[source]) ask.source = source;
  return ask;
}

/** The redacted GameState that `seat` is allowed to receive.
 *
 * `frozenOpp`: inside a HIDDEN SIMULTANEOUS SEGMENT (the resource step, the
 * haste step, deployment — see rooms.ts segmentKey), each seat's view of the
 * opponent is served from the segment-start snapshot, so the opponent's live
 * moves stay invisible until both players are done and main.ts flushes the
 * held events as the reveal. The caller passes null outside a segment, which
 * is the ONLY gate: testing the phase here as well would silently disable the
 * planning freeze. */
export function viewFor(state: GameState, seat: Seat, frozenOpp?: GameState | null): SeatView {
  const v = structuredClone(state) as SeatView;

  if (frozenOpp) {
    const o = other(seat);
    // a name is cosmetic and never hidden — and renameSeat() writes it
    // OUTSIDE the action log, so the snapshot (turn 1's is taken at room
    // creation, before anyone has typed one) can hold a stale placeholder.
    // The live name wins over the frozen slot.
    const liveName = v.players[o]!.name;
    const liveOppHand = v.players[o]!.hand.length;
    // the opponent's half of the world, exactly as the segment began
    v.players[o] = structuredClone(frozenOpp.players[o]!);
    v.players[o]!.name = liveName;
    for (const key of Object.keys(v.entities)) {
      if (v.entities[Number(key)]!.controller === o) delete v.entities[Number(key)];
    }
    for (const [key, en] of Object.entries(frozenOpp.entities)) {
      if (en.controller === o) v.entities[Number(key)] = structuredClone(en);
    }
    // The DECK is the back door out of the freeze: a recycle puts the card on
    // the bottom of a deck, so a live deck count is a live readout of how many
    // resources the opponent has just made — the very thing the resource step
    // is meant to hide. Constructed decks are per-seat, so the opponent's is
    // simply served frozen.
    if (v.decks && frozenOpp.decks?.[o]) v.decks[o] = [...frozenOpp.decks[o]];
    // The shared deck is both players' at once and cannot just be frozen (your
    // OWN recycles must still show up in it). In the RESOURCE step the
    // arithmetic is exact instead: the only way a hand shrinks there is onto
    // the bottom of that deck (a draft merge conserves hand size, and nothing
    // draws), so subtract the opponent's own contribution back out.
    if (frozenOpp.phase === 'planning' && !frozenOpp.hasteDone) {
      const oppAdded = Math.max(0, frozenOpp.players[o]!.hand.length - liveOppHand);
      if (oppAdded) v.sharedDeck = v.sharedDeck.slice(0, Math.max(0, v.sharedDeck.length - oppAdded));
    }
    // done-flags stay live and public — planningDone / draftDone / bottomDone
    // / deployDone all read off `state`, not the freeze. "They are finished" is
    // exactly what you can see across a table. (hasteDone is the ONE
    // exception, and it is redacted below rather than here: the freeze is not
    // where it belongs, because it must be hidden whether or not a segment
    // snapshot exists.)
    //
    // R144(a): THE STACK IS PUBLIC IN BATTLE AND ONLY IN BATTLE. A battle
    // stack is public because it exists to be responded to; a HIDDEN
    // SIMULTANEOUS SEGMENT has no responses and no priority, and everything
    // else about the opponent's half of it is already served frozen (their
    // entities, their resources, their held log lines). Until R144 nothing
    // ever sat on the stack inside a segment, so this had nothing to redact
    // and did not exist. Now a start-of-deployment trigger does sit there
    // while its controller is being asked something — carrying its label, its
    // region and its declared targets/subjects — and a live `v.stack` would
    // be a live readout of what your opponent is doing behind the freeze,
    // which is the one thing the freeze is for. Same rule and same reason as
    // `E.beginResolving`, which publishes `s.resolving` in the battle phase
    // only.
    //
    // Dropped rather than frozen: the segment snapshot's own stack is empty by
    // construction (a segment begins at a phase boundary, and settle() drains
    // the deployment stack before any action can end), so "serve it from the
    // freeze" and "serve nothing" are the same array. Your OWN items stay —
    // you may see what you are being asked about.
    v.stack = v.stack.filter(it => it.controller === seat);
  }

  /* R236: WHO IS READY IN THE HASTE STEP IS NOT PUBLIC WHILE THE STEP IS OPEN.
   *
   * R228 made the step unconditional precisely because `hasteDone` is served
   * live and public: a step that appeared only when somebody COULD act was a
   * readout of a hidden hand. R224 recorded the debt that left — "an
   * always-open window is a tax on every turn unless passing through it is
   * cheap" — and R236 pays it: a client with nothing legal in the step but
   * `doneHaste` readies itself the moment the step opens.
   *
   * ⚠ THAT MOVES THE LEAK FROM THE STEP'S PRESENCE TO ITS TIMING. `ready ✓`
   * appearing on the opponent's side within milliseconds says exactly what the
   * old skipped step said — "they hold nothing hasteable" — and it says it
   * about a hand this same function redacts to `__HIDDEN__` four lines down.
   * The bluff toggle would then protect only the player who found it, and
   * everyone else would be leaking by default. So the per-seat readiness of
   * the OTHER seat is simply not served while the step is open.
   *
   * WHAT IS STILL PUBLIC, and it is the part that matters: THE STEP'S END. It
   * ends by `hasteDone` going null (engine.ts startBattlePhase), which no seat
   * masks, and the phase moves on with the segment reveal. The only thing lost
   * is the interval between one seat finishing and the other — during which
   * the finished seat's `legalHasteActions` is already empty, so they could
   * not act on it anyway and nothing about the board is being hidden.
   *
   * Your OWN flag is untouched: you must be able to see that you are done.
   * (Symmetric by construction — every seat is served the same shape, so the
   * redaction cannot itself be a tell.) */
  if (v.hasteDone) v.hasteDone = v.hasteDone.map((done, s) => (s === seat ? done : false));

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
  //
  // R247: but THAT one is owed is public, and — when the question came from an
  // ability of something already on this seat's board — so is what it came
  // from. `pendingAsk` is that, and only that. Built BEFORE the decision is
  // nulled, because it is derived from it.
  if (v.decision && v.decision.seat !== seat) {
    const ask = pendingAskFor(v, seat, frozenOpp);
    if (ask) v.pendingAsk = ask;
    v.decision = null;
    v.suspension = null;
  }

  // R85: a 'resolve' suspension carries a WHOLE unredacted state snapshot —
  // the world as it stood at the boundary of the part being resolved, which
  // the engine rewinds to when the answer arrives. It is engine-internal, and
  // it holds both hands and the deck order, so it never leaves the server —
  // not even to the seat that owns the decision.
  if (v.suspension?.type === 'resolve') delete v.suspension.snapshot;

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
  // R202: `handEntered` NAMED THE OPPONENT'S INCOMING CARDS, IN EVERY PHASE.
  //
  // R179's `E.toHand` emits `{ seat, from, cards: names, card: names[0], n }`
  // for every route a card takes into a hand — a draw, a bin recursion, a
  // recall, an uncache, a pull off the stack, a card taken out of a hand. The
  // STATE channel redacts an opponent's hand to `HIDDEN_CARD` (see `viewFor`,
  // and this file's own header says so at the top: "the OPPONENT's hand
  // contents -> count only"). The EVENT channel did not, and `sendUpdate`
  // ships raw event objects filtered only by `visibleToSeat` — which gates on
  // `data.privateTo`, a field `handEntered` never carried. So the same update
  // that hid nine card backs also carried the two names that had just gone in.
  //
  // `msg` is '' (an empty line never reaches the log), which is exactly why it
  // went unnoticed for a week: nothing was VISIBLE. But the client parses
  // `data.cards[]` deliberately — `ui/inspect.ts::namesInEvents` feeds
  // `growCardLedger` from it — so the names were not merely on the wire, they
  // were being read.
  //
  // Redacted rather than tagged `privateTo`, and that choice is load-bearing:
  // `toHand` DISPATCHES `handEntered` to card listeners inside a battle
  // (Rider of the Tides, Xenopod Progenitor, Galerider Eel all print "whenever
  // a card enters a player's hand during battle"), so suppressing the event
  // engine-side would silently break three cards. The count stays — hand SIZE
  // is already public from the card backs — and only the names go.
  if (ev.type === 'handEntered' && typeof ev.data?.['seat'] === 'number'
      && ev.data['seat'] !== seat) {
    const { cards: _cards, card: _card, ...rest } = ev.data as Record<string, unknown>;
    return { ...ev, data: rest };
  }
  return ev;
}

/**
 * Is this event's line for `seat` to read at all?
 *
 * An event tagged `data.privateTo` belongs to ONE seat, permanently — not
 * "held until the reveal" the way a hidden segment's events are (heldEvents,
 * which empties at the barrier). Playtest VEAV: "I was able to see in the
 * deployment recap that 'Rashi undid an action.' No need to show that to the
 * other person, it's just confusing, since you can't see what they undid."
 * The undo note rode the reveal because holding it was all the server could
 * do; this is the seam that lets it simply not be theirs.
 *
 * R235 is the third case, and it is neither of these: an event that a hidden
 * segment does NOT hold (`rooms.ts::escapesHold` — a `glimpsed` reveal, which
 * the card prints as REVEAL and which is therefore public the moment it
 * happens). Nothing here changes for it: it is not private, so this returns
 * true, and it is not held, so it simply travels at once. The three channels
 * are independent — `privateTo` is "never yours", the hold is "not yet", and
 * an exemption from the hold is "now".
 */
export function visibleToSeat(ev: EngineEvent, seat: Seat): boolean {
  const to = ev.data?.['privateTo'];
  return typeof to !== 'number' || to === seat;
}

/** Redacted log lines for `seat` from the full event history. Events with an
 * empty message ('stackFlash', a signal for the client's visual stack) are not
 * log lines and are dropped here, exactly as the hotseat Harness drops them. */
export function redactLog(events: EngineEvent[], seat: Seat, names: string[]): string[] {
  return events.filter(e => e.msg && visibleToSeat(e, seat)).map(e => redactEvent(e, seat, names).msg);
}
