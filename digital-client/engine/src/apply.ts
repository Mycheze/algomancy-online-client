/* The public reducer: apply(state, action) -> { state, events, pendingDecisions }
 * plus legalActions(state, seat) and createGame(seed).
 *
 * apply() clones the state, dispatches through E, and catches the control
 * signals. It never mutates its input; on IllegalAction it throws and the
 * caller keeps the old state.
 */
import type {
  Action, ActivateVia, ApplyResult, CardName, EffectPart, Element, EngineEvent, Entity, EntityId,
  FormationSpot, GameMode, GameState, ResourceKind, Seat, StackItem, TargetRef,
} from './types.ts';
import { ACTIVATIONS_PER_TURN, E, GameEnded, IllegalAction, Suspended, other, type ChainRest } from './engine.ts';
import {
  affinityPips, effectByKey, getCard, graftCauseIndex, isAugment, isGraftable,
  registerSynthetic, specForSlot, type AbilityCost, type ActivatedAbility, type CardDef,
  type EffectDef,
} from './cards/dsl.ts';
import { DECK_LIST, draftDeckList } from './cards/registry.ts';
import { rngShuffle, rngNext } from './rng.ts';

export { IllegalAction };

const ELEMENTS: ResourceKind[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

// ── game creation ─────────────────────────────────────────────────────

export const ALL_ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** the default trio when none is chosen (the first fully-scripted one) */
export const DRAFT_TRIO: Element[] = ['fire', 'water', 'earth'];

/** Sanitize a requested draft trio: exactly 3 distinct real elements, in
 * canonical order — anything else falls back to the default trio. */
export function sanitizeTrio(els: unknown): Element[] {
  if (!Array.isArray(els)) return [...DRAFT_TRIO];
  const picked = ALL_ELEMENTS.filter(e => els.includes(e));
  return picked.length === 3 ? picked : [...DRAFT_TRIO];
}

/** Constructed deck rules (Manual: min 30 cards, max 2 copies) against the
 * scripted pool. Returns the cleaned list or a human-readable error. */
export function checkDeck(cards: unknown): { ok: true; cards: CardName[] } | { ok: false; error: string } {
  if (!Array.isArray(cards) || cards.some(c => typeof c !== 'string')) {
    return { ok: false, error: 'a deck must be a list of card names' };
  }
  const list = cards as CardName[];
  const pool = new Set(DECK_LIST);
  const unknown = [...new Set(list.filter(n => !pool.has(n)))];
  if (unknown.length) {
    return { ok: false, error: `not in the scripted pool: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` (+${unknown.length - 5} more)` : ''}` };
  }
  if (list.length < 30) return { ok: false, error: `a constructed deck needs at least 30 cards (got ${list.length})` };
  const counts = new Map<string, number>();
  for (const n of list) counts.set(n, (counts.get(n) ?? 0) + 1);
  const over = [...counts.entries()].filter(([, c]) => c > 2).map(([n]) => n);
  if (over.length) return { ok: false, error: `max 2 copies of each card: ${over.slice(0, 5).join(', ')}` };
  return { ok: true, cards: [...list] };
}

export function createGame(
  seed: number,
  names: [string, string] = ['Player 1', 'Player 2'],
  mode: GameMode = 'shared',
  draftElements?: Element[],
  /** mode 'constructed': each seat's deck list (validate with checkDeck first) */
  decks?: [CardName[], CardName[]],
): ApplyResult {
  let rngState = seed >>> 0;
  const trio = sanitizeTrio(draftElements ?? DRAFT_TRIO);
  const deckCards: CardName[] = [];
  if (mode === 'draft') {
    // the physical live-draft deck: one copy of each card of the chosen trio
    // (54 per element + 5 per hybrid pair = 177 for a trio)
    deckCards.push(...draftDeckList(trio));
  } else if (mode !== 'constructed') {
    for (const n of DECK_LIST) deckCards.push(n, n);
  }
  let deck: CardName[];
  [deck, rngState] = rngShuffle(deckCards, rngState);
  // constructed: per-player decks, each shuffled with the seeded RNG (seat 0
  // first — deterministic, so replay = seed + decks + actions)
  let seatDecks: CardName[][] | undefined;
  /** R99: constructed only — each seat's deck ELEMENT IDENTITY, for the client
   * to default its resource menu to (ledger #63). Computed off the decklist as
   * given, BEFORE the shuffle, because it is a property of the deck and not of
   * the order it happens to be in. Same `getCard(n).factions` idiom
   * `registry.ts`'s `draftDeckList` uses, and ordered by ALL_ELEMENTS so two
   * identical decks always produce the identical array (replay determinism). */
  let deckElements: Element[][] | undefined;
  if (mode === 'constructed') {
    if (!decks || decks.length !== 2) throw new Error('constructed mode needs a deck per player');
    for (const d of decks) {
      const check = checkDeck(d);
      if (!check.ok) throw new Error(check.error);
    }
    deckElements = decks.map(d => {
      const seen = new Set<string>();
      for (const n of d) for (const f of getCard(n).factions ?? []) seen.add(f);
      return ALL_ELEMENTS.filter(el => seen.has(el));
    });
    seatDecks = [];
    for (const d of decks) {
      let shuffled: CardName[];
      [shuffled, rngState] = rngShuffle(d, rngState);
      seatDecks.push(shuffled);
    }
  }
  let initRoll: number;
  [initRoll, rngState] = rngNext(rngState);

  const state: GameState = {
    seed, rngState, actionCount: 0, turn: 0, phase: 'planning',
    initiative: initRoll < 0.5 ? 0 : 1, winner: null, nextId: 1,
    mode, packs: [[], []], draftDone: null, seenHand: [null, null],
    elements: mode === 'draft' ? trio : [...ALL_ELEMENTS],
    sharedDeck: deck,
    // R99: absent outside constructed — shared plays all seven and draft has
    // already narrowed `elements` to its trio, so a client falls back to
    // `elements` when this is undefined.
    ...(deckElements ? { deckElements } : {}),
    ...(seatDecks ? { decks: seatDecks, bottomDone: null } : {}),
    players: names.map((name, seat) => ({
      seat, name, life: 30, hand: [], bin: [],
      // starting Prismites are dealt face-down (Manual: "they start dormant");
      // they typically receive turn 1's two activations
      resources: [
        { kind: 'prismite', state: 'dormant' },
        { kind: 'prismite', state: 'dormant' },
      ],
      activationsLeft: ACTIVATIONS_PER_TURN,
      // Light & Dark player counters (R38/R39) and the cache zone (R41).
      // Optional on the type so pre-expansion saved games still load; new
      // games start them explicitly.
      rot: 0, debt: 0, cache: [],
    })),
    regions: [0, 1].map(owner => ({ owner, presentSeats: [owner] })),
    entities: {}, stack: [], battle: null, battleRound: 0,
    battleCounters: [{}, {}], priority: null, passes: 0,
    planningDone: [false, false], hasteDone: null, deployDone: null, deployPlayer: null,
    // R43 forward-counting anchors for prophecy conditions (additive)
    hasteManaSpent: [0, 0], battlesCompleted: 0,
    triggerQueue: [], triggerOrderedSeats: [], suspension: null, decision: null,
    resolving: null,
  };
  const e = new E(state);
  if (mode === 'draft') {
    // Manual p.16: opening hand (4) is dealt together with turn 1's draws (2),
    // then each player gets a pack of 10 — clockwise from initiative.
    for (const seat of e.dealOrder()) e.draw(seat, 6, true);
    e.dealPacks();
  } else if (mode === 'constructed') {
    // opening hand 4 (like draft); turn 1's draw phase (draw 4, bottom 2)
    // comes with startTurn, netting the same 6-card start
    for (const seat of [0, 1]) e.draw(seat, 4, true);
  } else {
    for (const seat of [0, 1]) e.draw(seat, 5, true);
  }
  e.startTurn();
  return { state: e.s, events: e.events, pendingDecisions: [] };
}

// ── the reducer ───────────────────────────────────────────────────────

export function apply(state: GameState, action: Action): ApplyResult {
  if (state.phase === 'gameover') throw new IllegalAction('the game is over');
  const draft = structuredClone(state);
  draft.actionCount++;
  const e = new E(draft);
  try {
    dispatch(e, action);
  } catch (sig) {
    if (!(sig instanceof Suspended) && !(sig instanceof GameEnded)) throw sig;
  }
  return {
    state: e.s,
    events: e.events,
    pendingDecisions: e.s.decision ? [e.s.decision] : [],
  };
}

/** Replay = seed + action log (docs/04 §1; constructed also needs the decks).
 * `events` deliberately stays the CREATION events, not an accumulation —
 * callers only read `.state` (server/rooms.ts rebuild() accumulates its own
 * full history when it needs one). */
export function replay(seed: number, actions: Action[], names?: [string, string], mode?: GameMode, draftElements?: Element[], decks?: [CardName[], CardName[]]): ApplyResult {
  let r = createGame(seed, names, mode, draftElements, decks);
  for (const a of actions) r = { ...apply(r.state, a), events: r.events };
  return r;
}

// ── dispatch ──────────────────────────────────────────────────────────

function dispatch(e: E, action: Action): void {
  // R65: conceding is the one thing you may always do — including while the
  // pending decision is the reason you want to stop.
  if (e.s.decision && action.type !== 'decide' && action.type !== 'concede') {
    e.illegal(`a decision is pending for ${e.pname(e.s.decision.seat)}`);
  }
  switch (action.type) {
    case 'recycleForResource': return doRecycle(e, action.seat, action.handIndex, action.element);
    case 'activateResource': return doActivateResource(e, action.seat, action.index);
    case 'exchangePrismite': return doExchangePrismite(e, action.seat, action.index, action.element);
    case 'donePlanning': return doDonePlanning(e, action.seat);
    case 'draftCommit': return doDraftCommit(e, action.seat, action.packIndices);
    case 'doneHaste': return doDoneHaste(e, action.seat);
    case 'bottomCards': return doBottomCards(e, action.seat, action.handIndices);
    case 'playCard': return doPlayCard(e, action.seat, action.handIndex, action.mode);
    case 'prophesy': return doProphesy(e, action.seat, action.from, action.index);
    case 'playCached': return doPlayCached(e, action.seat, action.index);
    case 'playFromBin': return doPlayFromBin(e, action.seat, action.binIndex);
    case 'castSpellToken': return doCastSpellToken(e, action.seat, action.entityId);
    case 'concede': return doConcede(e, action.seat);
    case 'activateAbility': return doActivateAbility(e, action.seat, action.entityId, action.abilityIndex, action.via);
    case 'augment': return doAugment(e, action.seat, action.from, action.index, action.hostId, action.hostStack);
    case 'graft': return doGraft(e, action.seat, action.from, action.index, action.hostId, action.position);
    case 'declareAttack': return doDeclareAttack(e, action.seat, action.columns, action.spellTokens ?? []);
    case 'declareBlocks':
      // R87: the tokens ride out with the counterattackers, so they are the
      // same list to everything downstream — `send` has always carried them,
      // `spellTokens` is the field the client can SEE (types.ts).
      return doDeclareBlocks(e, action.seat, action.blocks,
        [...(action.send ?? []), ...(action.spellTokens ?? [])]);
    case 'passPriority': return e.passPriority(action.seat);
    case 'doneDeploying': return doDoneDeploying(e, action.seat);
    case 'decide': return doDecide(e, action.seat, action.choice);
    // a type the switch does not know must be refused, not silently recorded:
    // the action log's whole contract is "seed + actions reproduces this game",
    // and a no-op entry from a buggy client would pollute it forever
    default: return e.illegal(`unknown action type ${String((action as { type?: unknown }).type)}`);
  }
}

// ── planning ──────────────────────────────────────────────────────────

/** Draft step (mode 'draft', Manual p.16-17): commit the hand↔pack merge.
 * The merged pile is hand.concat(pack); the player names which pile indices
 * go back to the pack — exactly as many as the pack held (the leave-exactly-10
 * invariant), so hand size is conserved. */
function doDraftCommit(e: E, seat: Seat, packIndices: number[]): void {
  e.need(e.s.mode === 'draft', 'not a draft game');
  e.need(e.s.phase === 'planning' && e.s.draftDone !== null, 'not the draft step');
  e.need(!e.s.draftDone[seat], 'you already finished drafting');
  const p = e.player(seat);
  const pack = e.s.packs[seat]!;
  const pile = [...p.hand, ...pack];
  e.need(Array.isArray(packIndices) && packIndices.length === pack.length,
    `you must leave exactly ${pack.length} cards in the pack`);
  const seen = new Set<number>();
  for (const i of packIndices) {
    e.need(Number.isInteger(i) && i >= 0 && i < pile.length && !seen.has(i),
      'bad pack selection');
    seen.add(i);
  }
  e.s.packs[seat] = packIndices.map(i => pile[i]!);
  p.hand = pile.filter((_, i) => !seen.has(i));
  // pack identity bookkeeping (additive): one more merge committed on this pack
  const meta = e.s.packMeta?.[seat];
  if (meta) meta.commits++;
  // this hand just mixed with a pack — anything the opponent SAW of it is stale
  e.s.seenHand[other(seat)] = null;
  e.s.draftDone[seat] = true;
  e.ev('draft', `${e.pname(seat)} finishes drafting and passes their pack.`, { seat });
  if (e.s.draftDone.every(Boolean)) e.passPacks();
}

/** Constructed draw phase: put exactly 2 cards (fewer only when the hand is
 * shorter) on the bottom of your own deck, in the order given. */
function doBottomCards(e: E, seat: Seat, handIndices: number[]): void {
  e.need(e.s.mode === 'constructed', 'not a constructed game');
  e.need(e.bottomPending(seat), 'not your draw phase');
  const p = e.player(seat);
  const required = Math.min(2, p.hand.length);
  e.need(Array.isArray(handIndices) && handIndices.length === required,
    `select exactly ${required} cards to put back`);
  const seen = new Set<number>();
  for (const i of handIndices) {
    e.need(Number.isInteger(i) && i >= 0 && i < p.hand.length && !seen.has(i), 'bad card selection');
    seen.add(i);
  }
  const putBack = handIndices.map(i => p.hand[i]!);
  p.hand = p.hand.filter((_, i) => !seen.has(i));
  for (const name of putBack) e.recycleToBottom(seat, name);
  e.s.bottomDone![seat] = true;
  e.ev('draw', `${e.pname(seat)} puts ${putBack.length} card${putBack.length === 1 ? '' : 's'} on the bottom of their deck.`, { seat, n: putBack.length });
  if (e.s.bottomDone!.every(Boolean)) e.s.bottomDone = null;
}

function doRecycle(e: E, seat: Seat, handIndex: number, element: ResourceKind): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.need(!e.bottomPending(seat), 'finish your draw phase first');
  e.need((e.s.elements as string[]).includes(element), 'not an element of this game');
  const card = e.player(seat).hand[handIndex];
  e.need(card !== undefined, 'no such card in hand');
  e.player(seat).hand.splice(handIndex, 1);
  e.recycleToBottom(seat, card);
  e.player(seat).resources.push({ kind: element, state: 'dormant' });
  e.ev('recycle', `${e.pname(seat)} recycles ${card} for a dormant resource.`, { seat });
}

function doActivateResource(e: E, seat: Seat, index: number): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.need(!e.bottomPending(seat), 'finish your draw phase first');
  const r = e.player(seat).resources[index];
  e.need(r && r.state === 'dormant', 'not a dormant resource');
  e.need(e.player(seat).activationsLeft > 0, `max ${ACTIVATIONS_PER_TURN} activations per turn`);
  r.state = 'open';
  e.player(seat).activationsLeft--;
  e.ev('resourceActivated', `${e.pname(seat)} activates a ${r.kind} resource.`, { seat, kind: r.kind });
  maybeGrantShard(e, seat, r.kind);
}

/** Manual p.18 (Shards and Affinity Bonuses): "The elemental resources can
 * provide free Shards when they are activated if the player has at least
 * three affinity towards that resource." The shard arrives dormant like any
 * created resource and gives no affinity — mana only. Caleb, asked whether
 * the bonus is once or repeatable: "Every time" — so this is unbounded.
 *
 * The resource being activated counts toward its own three: `r.state` is set
 * to 'open' before this is called, so activating your 3rd fire pays out.
 *
 * THIS IS THE ONLY IMPLEMENTATION, and it is general — it fires for all seven
 * elements. The `[element] Resource` card FACES print the same sentence as
 * reminder text, but only three of the seven exist in printed.json (fire,
 * water, earth), so routing the rule through card definitions would silently
 * drop the bonus for wood/metal/light/dark. Do not "implement" those faces;
 * the conformance sweep in `12-fire-a.test.ts` fails loudly if anyone does.
 *
 * ONE CALLER, by R116: activation. An exchange is not an activation. */
function maybeGrantShard(e: E, seat: Seat, kind: ResourceKind): void {
  if (kind === 'prismite' || kind === 'shard') return;
  if (e.affinity(seat, kind) < 3) return;
  e.player(seat).resources.push({ kind: 'shard', state: 'dormant' });
  e.ev('resourceActivated',
    `${e.pname(seat)} has ${e.affinity(seat, kind)} ${kind} affinity — a free Shard appears (dormant).`,
    { seat, kind: 'shard' });
}

function doExchangePrismite(e: E, seat: Seat, index: number, element: ResourceKind): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.need(!e.bottomPending(seat), 'finish your draw phase first');
  e.need((e.s.elements as string[]).includes(element), 'not an element of this game');
  const r = e.player(seat).resources[index];
  e.need(r && r.kind === 'prismite', 'not a prismite');
  // only ACTIVE (face-up) prismites can be exchanged (Manual p.18) — the
  // new resource keeps the prismite's state (expended stays expended)
  e.need(r.state !== 'dormant', 'a dormant prismite cannot be exchanged');
  r.kind = element;
  e.ev('resourceActivated', `${e.pname(seat)} exchanges a Prismite for a ${element} resource.`, { seat, kind: element });
  // R116: NO affinity shard here. An exchange is not an activation. The
  // printed text pays out "when I ACTIVATE", and Caleb draws the line
  // explicitly: "'activating the prismite' is like playing your land for
  // turn, but cracking the fetchland doesn't take an additional land drop."
  // The prismite was activated as a PRISMITE (which pays nothing, p.18), and
  // trading it in later does not retroactively make that an activation of the
  // element. Only doActivateResource calls maybeGrantShard.
}

/**
 * R65: concede. The one action with no timing, no priority and no phase — a
 * player may give up whenever the game is still going, including while a
 * decision they do not want to answer is pending. It ends the game exactly as
 * a lethal blow does (winner set, phase 'gameover', a 'gameOver' event), so
 * everything downstream — the post-game screen, the stats record, the replay —
 * needs no special case for it.
 */
function doConcede(e: E, seat: Seat): void {
  e.need(e.s.winner === null, 'the game is already over');
  e.ev('info', `${e.pname(seat)} concedes.`, { seat });
  e.concede(seat);
}

function doDonePlanning(e: E, seat: Seat): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.need(!e.bottomPending(seat), 'finish your draw phase first');
  // R39: debt is paid HERE — the last thing in the resource step. planningDone
  // is set first on purpose: every resource action (recycleForResource,
  // activateResource, exchangePrismite) requires !planningDone[seat], so by
  // the time the mana leaves it is structurally impossible to activate more.
  e.s.planningDone[seat] = true;
  e.payDebt(seat);
  if (e.s.planningDone.every(Boolean)) e.startHasteStep();
}

function doDoneHaste(e: E, seat: Seat): void {
  e.need(e.s.phase === 'planning' && e.s.hasteDone !== null, 'not the haste step');
  e.need(!e.s.hasteDone![seat], 'you already finished the haste step');
  e.s.hasteDone![seat] = true;
  if (e.s.hasteDone!.every(Boolean)) e.startBattlePhase();
}

// ── playing cards ─────────────────────────────────────────────────────

function timingAllowsDeploy(c: CardDef): boolean { return c.timing === 'deploy' || c.timing === 'haste'; }

/** targeted casts need at least one candidate up front; a spell with a
 * bracketed cast cost (R35/R49) needs the cost to be payable — the cost is
 * part of casting, so with nothing to sacrifice / discard, too little life, or
 * (R49) not enough life to SURVIVE paying, the cast is ILLEGAL. A printed
 * "[Gain N debt]" line (Printed.gainDebt, Hyper Beam) is a real cast cost too,
 * and one that is always payable. */
function castable(e: E, c: CardDef, region: number, seat: Seat, from: 'hand' | 'cache' | 'bin' = 'hand'): boolean {
  // the card is still in the hand this check reads, and a spell cannot discard
  // ITSELF to pay its own [Discard a card] cost
  const reserve = from === 'hand' ? 1 : 0;
  if (c.gainDebt !== undefined && !e.canPayCastCost(seat, { kind: 'gainDebt', n: c.gainDebt }, region, reserve)) return false;
  const eff = c.spellEffect;
  if (!eff) return true;
  if (eff.castCost && !e.canPayCastCost(seat, eff.castCost, region, reserve)) return false;
  // an "up to N" spec (min 0) may legally be cast at nothing. R58/R64: the
  // gate is the FIRST SLOT's spec — its own kind and its own restriction —
  // not the spec-wide fallback, which for Fight ("target ally and another
  // target unit") is the looser of the two.
  if (eff.targets && (eff.targets.min ?? 1) > 0
    && e.targetCandidates(specForSlot(eff.targets, 0), region, undefined, seat).length === 0) return false;
  return true;
}

/** the [Battle] Ambush alternative cost: <mana> with <pips> affinity */
function canPayAmbush(e: E, seat: Seat, c: CardDef): boolean {
  if (!c.ambush) return false;
  if (e.openMana(seat) < c.ambush.mana) return false;
  for (const [el, n] of Object.entries(affinityPips(c.ambush.cost))) {
    if (e.affinity(seat, el) < n) return false;
  }
  return true;
}

function baseItem(e: E, c: CardDef, seat: Seat, region: number,
  from?: 'hand' | 'cache' | 'bin', unstable = false, fixedX?: number): StackItem {
  const parts: EffectPart[] = c.spellEffect ? [{ effectKey: `spell:${c.name}`, targets: [] }] : [];
  return {
    id: e.s.nextId++, kind: c.kind, card: c.name, label: c.name,
    controller: seat, region, negated: false, parts,
    // R111: a FREE release (fulfilled prophecy) casts an X spell for X = 0 —
    // "for free" waives the whole mana cost, X included, so there is no X
    // to choose and collectX has nothing to ask (Bena 2026-08-23, the Magic
    // rule). An X that is a bracketed additional cost is not this X.
    ...(fixedX !== undefined ? { x: fixedX } : {}),
    // R49: the zone this card is being played out of, carried into the
    // 'spellPlayed' / 'spawned' events (Proph, Stalwart Sentinel)
    ...(from ? { from } : {}),
    // R96: "If you do, they gain {p}unstable until regroup." A STAMP taken at
    // the moment of playing, not a property of the zone — the card is Unstable
    // even after the permission that let it out of the bin has lapsed.
    ...(unstable ? { unstable: true } : {}),
  };
}

/**
 * The phase/timing gate every "play this card" shares, whatever zone the card
 * comes from. `timing` is the timing the card is played AT — normally its
 * printed timing, but a prophecy release marked [Haste] overrides it for a
 * cache release (R42). `take` pulls the card out of its zone and `pay` pays
 * for it; both run only once the play is known to be legal.
 */
function playAtTiming(
  e: E, seat: Seat, c: CardDef, timing: CardDef['timing'],
  take: () => void, pay: () => void, from: 'hand' | 'cache' | 'bin',
  unstable = false, fixedX?: number,
): void {
  const canCast = (region: number) => castable(e, c, region, seat, from);
  /** R49: the printed "[Gain N debt]" bracketed line (Hyper Beam) is a real
   * additional CAST cost — taken here, with the rest of the payment, before
   * the item exists. A negated Hyper Beam therefore still cost its caster the
   * debt, which is the whole point of a cost. It applies on every route into
   * play, cache releases included: a fulfilled prophecy waives the MANA, not
   * a separate bracketed cost. */
  const payAll = () => {
    pay();
    if (c.gainDebt) {
      e.ev('info', `${e.pname(seat)} gains ${c.gainDebt} debt — the [cost] of ${c.name}.`, { seat, card: c.name });
      e.gainDebt(seat, c.gainDebt);
    }
  };
  if (e.s.phase === 'planning') {
    // haste step (R18): only haste cards, resolving immediately
    e.need(e.s.hasteDone !== null && !e.s.hasteDone[seat], 'not your haste step');
    const region = e.homeRegion(seat);
    // R97: the printed timing is the default, and a PlayPermission granted by
    // a unit in this region can widen it ("Each turn, you may play a unit
    // during the mana step as if it had [Haste]" — Dispatch Courier). Gate 3
    // of three; `E.mayPlayAtHaste` is the shared predicate all three call, and
    // it refuses a {Battle} card whatever the grant says (RAQ "[Solved]
    // Dispatch Courier vs Battle Timing").
    const granted = timing !== 'haste' && e.mayPlayAtHaste({ seat, card: c, from, region });
    e.need(timing === 'haste' || granted, 'only haste cards during the haste step');
    e.need(canCast(region), 'no legal targets or an unpayable [cost]');
    take();
    payAll();
    // charged only once the play is known to be legal and paid for — an
    // illegal attempt must not eat the turn's allowance
    if (granted) {
      e.chargeHastePlay(seat);
      e.ev('info', `${c.name} is played during the haste step as if it had [Haste].`,
        { seat, card: c.name });
    }
    e.castChain([baseItem(e, c, seat, region, from, unstable, fixedX)], 'resolve');
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(timing === 'deploy' || timing === 'haste', 'battle cards can only be played during battle');
    const region = e.homeRegion(seat);
    e.need(canCast(region), 'no legal targets or an unpayable [cost]');
    take();
    payAll();
    e.castChain([baseItem(e, c, seat, region, from, unstable, fixedX)], 'resolve');
  } else if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(timing === 'battle', 'only battle cards can be played now');
    const region = e.s.battle!.region;
    e.need(canCast(region), 'no legal targets or an unpayable [cost]');
    take();
    payAll();
    e.castChain([baseItem(e, c, seat, region, from, unstable, fixedX)], 'push');
    e.settle();
  } else {
    e.illegal('cards are played during deployment or battle');
  }
}

function doPlayCard(e: E, seat: Seat, handIndex: number, mode?: 'ambush' | 'discardMe'): void {
  const name = e.player(seat).hand[handIndex];
  e.need(name !== undefined, 'no such card in hand');
  const c = e.card(name);
  if (mode === 'ambush') return doAmbush(e, seat, handIndex, c);
  if (mode === 'discardMe') return doDiscardMe(e, seat, handIndex, c);
  // R100: "I can't be played from your hand" (Calming Force). Checked here and
  // nowhere near playAtTiming, because it is about the ZONE, not the timing —
  // and the two alternative play MODES above are deliberately upstream of it:
  // Ambush and "Discard me" are their own printed play modes with their own
  // cost lines, and no card yet prints both this restriction and one of them.
  e.need(!c.noPlayFromHand, `${c.name} can't be played from your hand`);
  e.need(e.canPayCard(seat, name), 'cannot pay for that');
  playAtTiming(e, seat, c, c.timing,
    () => { e.player(seat).hand.splice(handIndex, 1); },
    () => { e.payCard(seat, name); },
    'hand');
}

/**
 * R42: prophesy — cache a card with a printed prophecy banner, paying the
 * banner's mana. DEPLOYMENT ONLY (Caleb 2025-05-09: "Only during deployment"),
 * and the cost is a plain number: no affinity pips are required, which is why
 * this pays through payMana() rather than payCard().
 *
 * The source zone is 'hand' unless the card itself grants otherwise — "I can
 * be prophesied from your bin" (Angel of Anguish, CardBehavior.prophesyFromBin).
 * No card may be prophesied from the bin without that text.
 */
function doProphesy(e: E, seat: Seat, from: 'hand' | 'bin', index: number): void {
  e.need(e.deploying(seat), 'prophesying is a deployment action');
  const zone = from === 'bin' ? e.player(seat).bin : e.player(seat).hand;
  const name = zone[index];
  e.need(name !== undefined, `no such card in ${from}`);
  const c = e.card(name);
  const banner = c.prophecy;
  e.need(banner, 'that card has no prophecy banner');
  e.need(from === 'hand' || c.prophesyFromBin, 'that card cannot be prophesied from your bin');
  e.need(e.openMana(seat) >= banner.mana, 'cannot pay the prophecy cost');
  zone.splice(index, 1);
  e.payMana(seat, banner.mana);   // R42: plain mana, no affinity
  const ev = e.ev('prophesied',
    `${e.pname(seat)} prophesies ${name} from ${from} for [${banner.mana}].`,
    { seat, card: name, from, mana: banner.mana, condition: banner.condition });
  e.fireEvent('prophesied', ev);
  e.cacheCard(seat, name, from, { prophecy: banner.condition });
  e.settle();
}

/**
 * R42/R45: play a card out of your cache. Permission is the whole point — a
 * cached card with neither a fulfilled prophecy nor a live glimpse stamp
 * cannot be played at all (Caleb 2024-12-03).
 *
 *  - via a fulfilled prophecy: FREE, and "for free" also ignores affinity
 *    (Caleb 2024-10-28). A [Haste] release marker on the banner moves the
 *    release into the haste step.
 *  - via glimpse: pay the mana cost (Caleb 2023-08-13), ignore affinity.
 *
 * In both cases normal TIMING applies — the card is played "as if it were in
 * your hand", so a unit still needs deployment and a {Battle} spell still
 * needs battle (Caleb 2025-12-28).
 */
function doPlayCached(e: E, seat: Seat, index: number): void {
  const cc = e.cache(seat)[index];
  e.need(cc !== undefined, 'no such cached card');
  const via = e.cachePermission(seat, index);
  e.need(via, 'you have no permission to play that cached card');
  const c = e.card(cc.card);
  const free = via === 'prophecy';
  // affinity is ignored either way; only the glimpse route still needs mana
  e.need(free || e.canPayManaOnly(seat, cc.card), 'cannot pay for that');
  playAtTiming(e, seat, c, e.cachedTiming(seat, index, via),
    () => { e.uncache(seat, index); },
    () => {
      if (free) {
        e.ev('info', `${cc.card} is released from ${e.pname(seat)}'s cache for FREE (prophecy fulfilled: ${cc.prophecy!.condition})`
          + (c.mana === 'X' ? ' — an X spell released for free is cast for X = 0.' : '.'));
      } else {
        e.payCard(seat, cc.card);
        e.ev('info', `${cc.card} is played from ${e.pname(seat)}'s cache, ignoring affinity.`);
      }
    },
    'cache', false,
    // R111: free waives the mana cost entirely — X included (see baseItem)
    free && c.mana === 'X' ? 0 : undefined);
}

/** R96: the cards a bin-play permission reaches. "You may play SPELLS from
 * your bin" — a spell UNIT is one too: playing it casts the spell and then
 * spawns the body, which is why `isSpellCard` in batch-fire-a reads the same
 * way. Units, resources and anything else stay where they are. */
function binPlayable(c: CardDef): boolean {
  return c.kind === 'spell' || c.kind === 'spellUnit';
}

/**
 * R96: play a spell out of your own BIN, under a permission granted this
 * battle ("In this battle, you may play spells from your bin. If you do, they
 * gain {p}unstable until regroup." — Abyssal Evocation).
 *
 * Modelled on `doPlayCached`, which is THE "play from a non-hand zone gated on
 * a permission" function — same shape, down to needing the permission before
 * anything else happens. The `bin` arm of `castable` / `baseItem` /
 * `playAtTiming` / `StackItem.from` was pre-wired with no callers; this is the
 * caller.
 *
 * ⚠ TIMING IS RESTRICTIVE, and deliberately: `playAtTiming` applies the card's
 * PRINTED timing, so only {Battle} spells in your bin are playable and a bin
 * full of deploy-timing spells is inert under this card. That is R42/R45's
 * answer to the analogous CACHE question — "normal TIMING applies — the card
 * is played 'as if it were in your hand' … (Caleb 2025-12-28)" — applied here
 * because nothing says otherwise. The permissive reading would need an
 * explicit override; flagged in R96 rather than assumed.
 */
function doPlayFromBin(e: E, seat: Seat, binIndex: number): void {
  const name = e.player(seat).bin[binIndex];
  e.need(name !== undefined, 'no such card in your bin');
  const c = e.card(name);
  // "IN THIS BATTLE": no battle, no permission — which is also why the region
  // comes from the battle rather than from the seat's home.
  const region = e.s.battle?.region;
  e.need(region !== undefined && e.mayPlaySpellsFromBin(seat, region),
    'you have no permission to play cards from your bin');
  e.need(binPlayable(c), 'only spells may be played from your bin');
  e.need(e.canPayCard(seat, name), 'cannot pay for that');
  playAtTiming(e, seat, c, c.timing,
    () => { e.player(seat).bin.splice(binIndex, 1); },
    () => {
      e.payCard(seat, name);
      e.ev('info', `${name} is played from ${e.pname(seat)}'s bin — it is Unstable until regroup.`,
        { seat, card: name });
    },
    'bin', true);
}

/** [Battle] Ambush (Manual p.40): play the unit during battle as an effect —
 * "Recall target ally, put me into their position in play." Pays the ambush
 * cost, uses the stack, negatable; fizzles → the ambusher is binned (R22). */
function doAmbush(e: E, seat: Seat, handIndex: number, c: CardDef): void {
  e.need(c.ambush, 'that card has no Ambush mode');
  e.need(e.s.phase === 'battle', 'Ambush is played during battle');
  e.need(e.s.priority === seat, 'you do not have priority');
  e.need(canPayAmbush(e, seat, c), 'cannot pay the ambush cost');
  const region = e.s.battle!.region;
  const item: StackItem = {
    id: e.s.nextId++, kind: 'ambush', card: c.name,
    label: `${c.name} (Ambush)`, controller: seat, region,
    negated: false, parts: [{ effectKey: `ambush:${c.name}`, targets: [] }],
    from: 'hand',   // R49: an Ambush is the card being played, out of the hand
  };
  e.need(e.targetCandidates({ what: 'allyUnit', prompt: '' }, region, undefined, seat).length > 0,
    'no ally to ambush');
  e.player(seat).hand.splice(handIndex, 1);
  e.payMana(seat, c.ambush!.mana);
  e.castChain([item], 'push');
  e.settle();
}

/** the printed "Discard me" cost line: <mana> at <pips> affinity */
function canPayDiscardMe(e: E, seat: Seat, c: CardDef): boolean {
  if (!c.discardMe) return false;
  if (e.openMana(seat) < c.discardMe.mana) return false;
  for (const [el, n] of Object.entries(affinityPips(c.discardMe.cost))) {
    if (e.affinity(seat, el) < n) return false;
  }
  return true;
}

/**
 * R40: the "Discard me" play mode (Dropslime's "1 Discard me", Nothyr's
 * "2 [d] Discard Me. {Battle}") — pay the printed cost line, discard the card
 * from your hand, and the resulting TRASH fires the card's own "when I am
 * trashed" trigger. Modelled on Ambush (doAmbush): an alternative cost and an
 * alternative mode of the same playCard action.
 *
 * Nothing goes on the stack: the discard is the whole action, and what reaches
 * the stack (in battle) or resolves immediately (in deployment) is the trash
 * TRIGGER, through the ordinary trigger machinery.
 *
 * R65 — TIMING. Discarding is not playing (R37): the card never goes to the
 * stack, never spawns, and the only thing that reaches anyone is its own
 * "when I am trashed" trigger. So the mode is available at INSTANT SPEED —
 * during battle, whenever you hold priority — as well as during your own
 * deployment. A printed {Battle} marker on the discard line (Nothyr) still
 * restricts it to battle; nothing restricts it to deployment.
 *
 * Bena, playtest PEMC: "I can't discard Sacrifice Dude at instant speed. It
 * has to work like that, otherwise the alternate cost doesn't make sense
 * (since you don't have opponent's during deployment)." Exactly so — Sacrifice
 * Dude's payoff is "each opponent sacrifices a nontoken unit", and in
 * deployment the opponent is not in your region at all (R25), so the
 * deployment-only reading made the mode unusable on its own card.
 */
function doDiscardMe(e: E, seat: Seat, handIndex: number, c: CardDef): void {
  e.need(c.discardMe, 'that card has no "Discard me" mode');
  e.need(canPayDiscardMe(e, seat, c), 'cannot pay the discard cost');
  if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
  } else {
    // a {Battle}-marked discard line is a battle action and nothing else
    e.need((c.discardMe!.timing ?? c.timing) !== 'battle', 'that mode is a battle action');
    e.need(e.deploying(seat), 'not your deployment');
  }
  e.payMana(seat, c.discardMe!.mana);
  e.ev('info', `${e.pname(seat)} pays [${c.discardMe!.mana}${c.discardMe!.cost}] to discard ${c.name}.`,
    { seat, card: c.name });
  e.discardFromHand(seat, handIndex);   // trashes it → fires its own trashed trigger
  e.settle();
}

function doCastSpellToken(e: E, seat: Seat, entityId: EntityId): void {
  const tok = e.entity(entityId);
  e.need(tok && tok.kind === 'spellToken' && tok.controller === seat, 'not your spell token');
  const c = e.card(tok.card);
  let region: number;
  let then: 'push' | 'resolve';
  if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(tok.region === e.s.battle!.region, 'spell tokens are castable only in their region');
    region = e.s.battle!.region;
    then = 'push';
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(timingAllowsDeploy(c), 'battle spell tokens can only be cast during battle');
    e.need(tok.region === e.homeRegion(seat), 'spell tokens are castable only in their region');
    region = tok.region;
    then = 'resolve';
  } else {
    e.illegal('spell tokens are cast during battle or deployment');
  }
  // R16/R81: Burst casts all your burst tokens OF THE SAME NAME in this region
  // at once, in deterministic id order. Playtest VEAV: "the game is trying to
  // force me to cast my Fireball here, but Burst only applies to spell tokens
  // with the same NAME — I should be allowed to play Poison, let it resolve,
  // then play Fireball." Sourced: "a player must play all burst spells they
  // control OF THE SAME TYPE at the same time" (The Rules of Algomancy,
  // §spell tokens). This used to sweep every burst token you controlled here,
  // which fused a Poison and a Fireball into one uninterruptible group.
  const group = c.burst
    ? e.tokensOf(seat, tok.region).filter(t => t.card === tok.card).sort((a, z) => a.id - z.id)
    : [tok];
  const items: StackItem[] = [];
  for (const t of group) {
    // R89: an augment applied in DEPLOYMENT rides the token onto the stack, as
    // the `item.augments` R79 already built for the battle-time version. Doing
    // it this way rather than teaching resolution about the entity's `mods` is
    // what buys the whole rule for free: `EffectCtx.grantedAttrs`,
    // `E.itemAttrs` and `dischargeItem`'s Unstable erase all read `augments`
    // and none of them has to know where the virus was applied. It also
    // enforces "you can only do this with attributes" by construction —
    // `stackAugmentAttrs` unions `augmentAttrs` and reads nothing else, so a
    // text-only augment donates exactly nothing.
    const riding = t.mods
      .map(id => e.entity(id))
      .filter((m): m is Entity => !!m && m.appliedAs === 'augment');
    delete e.s.entities[t.id];
    for (const m of riding) delete e.s.entities[m.id];
    const item = baseItem(e, e.card(t.card), seat, region);
    item.kind = 'spellToken';
    item.x = t.x;
    item.label = `${t.card} ${t.x ?? ''}`.trim();
    if (riding.length) item.augments = riding.map(m => ({ card: m.card, by: m.owner }));
    items.push(item);
  }
  e.castChain(items, then);
  e.settle();
}

/**
 * Resolve which ability list an activateAbility action refers to (see
 * `ActivateVia`) — the ACCEPT side of `pushActivatedOptions`.
 *
 * R118: both sides read `E.facesWith(u, 'activated')` and both decide
 * "is this the identity face?" with `E.faceName(u)`, so the offer and the
 * accept cannot drift. A face the unit is not wearing is REFUSED here rather
 * than silently resolved off the physical card, which is what would turn a
 * stale action log into a different game.
 *
 * `viaCard` is the card the R9 budget and the effect key are keyed on, and it
 * is always a FACE (or a mod's own card) — never `Entity.card`. That is what
 * keeps two faces' [once] abilities in two budgets instead of one.
 */
function activationSource(e: E, u: Entity, via?: ActivateVia):
  { list: ReturnType<typeof getCard>['abilities']; prefix: 'ability' | 'augment'; viaCard?: CardName } {
  if (via === undefined || via === 'augment') {
    // the unit's OWN text — off the identity face, which is the copied card
    // when it is wearing one (Apex Prime, Borrower of Forms)
    const face = e.faceName(u);
    e.need(e.facesWith(u, 'activated').includes(face), 'that unit has no abilities of its own');
    return via === undefined
      // viaCard stays undefined so composeParts falls through to faceName(u) —
      // the same card, and the same budget key, by the shorter road
      ? { list: getCard(face).abilities, prefix: 'ability' }
      : { list: getCard(face).augmentText, prefix: 'augment', viaCard: face };
  }
  if ('face' in via) {
    e.need(e.facesWith(u, 'activated').includes(via.face), 'that unit does not have that ability');
    const def = getCard(via.face);
    return via.text === 'augment'
      ? { list: def.augmentText, prefix: 'augment', viaCard: via.face }
      : { list: def.abilities, prefix: 'ability', viaCard: via.face };
  }
  const mod = e.entity(via.mod);
  e.need(mod && mod.appliedAs === 'augment' && mod.modOf === u.id, 'no such augment on that unit');
  return { list: getCard(mod.card).augmentText, prefix: 'augment', viaCard: mod.card };
}

/**
 * R49: every non-mana activation cost an ability can carry, checked as a
 * GATE — an ability whose cost cannot be paid is neither offered nor accepted.
 * `u` is the source, excluded from a "sacrifice another" count.
 */
function canPayAbilityCost(e: E, seat: Seat, cost: AbilityCost, u: Entity, region: number): boolean {
  if (e.openMana(seat) < (cost.mana ?? 0)) return false;
  if (cost.life !== undefined && !e.canPayLife(seat, cost.life)) return false;
  if (cost.discard !== undefined && e.player(seat).hand.length < cost.discard) return false;
  if (cost.sacrificeOther !== undefined
    && e.unitsOf(seat, region).filter(o => o.id !== u.id).length < cost.sacrificeOther) return false;
  if (cost.discardOrSacrifice !== undefined) {
    const sacs = e.unitsOf(seat, region).filter(o => o.id !== u.id && !o.token).length;
    if (e.player(seat).hand.length + sacs < cost.discardOrSacrifice) return false;
  }
  return true;
}

/**
 * R64/R77: everything other than the activation cost that decides whether an
 * ability can be used at all. Three gates, one predicate, called from both
 * `legalActions` (do not offer it) and `doActivateAbility` (refuse it):
 *
 *  - R77: a printed precondition — "Activate this ability only if …";
 *  - R64: a bracketed [cost] on the EFFECT that cannot be paid;
 *  - R64: a mandatory target with nothing legal to aim at.
 *
 * All three used to be discovered halfway through: you paid the mana, the
 * ability went on the stack, and the part was silently skipped at resolution.
 * An ability you cannot use is not offered and is refused, exactly like a spell
 * you cannot cast.
 */
function abilityUnusable(
  e: E, seat: Seat, ab: { effect: EffectDef; usableWhen?: ActivatedAbility['usableWhen'] },
  u: Entity, region: number,
): string | null {
  // R77 first: the precondition is about the source, and a self-sacrificing
  // ability's cost would otherwise remove the thing the condition asks about
  if (ab.usableWhen && !ab.usableWhen(e, u, seat)) {
    return 'that ability cannot be activated right now';
  }
  const eff = ab.effect;
  if (eff.castCost && !e.canPayCastCost(seat, eff.castCost, region, 0, u.id)) {
    return 'that ability has nothing it can be used on';
  }
  if (eff.targets && (eff.targets.min ?? 1) > 0
    && e.targetCandidates(specForSlot(eff.targets, 0), region, undefined, seat, u.id).length === 0) {
    return 'that ability has nothing it can be used on';
  }
  return null;
}

function doActivateAbility(e: E, seat: Seat, entityId: EntityId, abilityIndex: number, via?: ActivateVia): void {
  const u = e.entity(entityId);
  e.need(u && u.kind === 'unit' && u.controller === seat && !u.absent, 'not your unit');
  // R62: a silenced unit has no activated abilities to activate
  e.need(!e.abilitiesSuppressed(u), 'that unit has lost its abilities');
  const { list, prefix, viaCard } = activationSource(e, u, via);
  const ability = list?.[abilityIndex];
  e.need(ability && ability.type === 'activated', 'no such activated ability');
  let region: number;
  let then: 'push' | 'resolve';
  if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(u.region === e.s.battle!.region, 'that unit is in another region');
    // R49: a printed {Battle}/{Deployment} marker on the ABILITY (Grox,
    // Cadaverous Cultivator) — enforced here, at activation, not at resolution
    e.need(ability.timing !== 'deploy', 'that ability is a deployment ability');
    region = u.region; then = 'push';
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(u.region === e.homeRegion(seat), 'that unit is in another region');
    e.need(ability.timing !== 'battle', 'that ability can only be activated during battle');
    region = u.region; then = 'resolve';
  } else {
    e.illegal('abilities are activated during battle or deployment');
  }
  const cost = ability.cost;
  e.need(canPayAbilityCost(e, seat, cost, u, region), 'cannot pay the activation cost');
  // compose BEFORE paying costs: a spent bounded cause makes this illegal
  const parts = e.composeParts(u, abilityIndex, prefix, viaCard);
  e.need(parts, 'that ability was already used this turn');
  // R64: …and only then, whether the effect has anything to spend itself on
  const unusable = abilityUnusable(e, seat, ability, u, region);
  e.need(!unusable, unusable ?? '');
  // R118: the log and the stack row name the FACE — the card this unit
  // currently IS. For anything not wearing a copy that is `u.card` verbatim,
  // so every existing label is unchanged.
  const faceCard = e.faceName(u);
  const srcCard = viaCard ?? faceCard;
  const item: StackItem = {
    id: e.s.nextId++, kind: 'activated', card: srcCard,
    label: `${srcCard === faceCard ? faceCard : `${srcCard} (on ${faceCard})`}: ${ability.label}`,
    controller: seat, region,
    negated: false, parts, sourceId: u.id, event: null,
  };
  // R57: NOTHING is charged here. Every part of the cost rides on the item and
  // is paid inside the cast window, AFTER the ability's targets are chosen —
  // still before the item reaches the stack, so nobody may respond between
  // cost and effect. This used to pay mana/life/debt and run
  // `e.destroy(u, 'is sacrificed')` right here, which meant a "Sacrifice me:"
  // ability ate its own unit the instant you clicked it, before you had seen
  // the target list and with no way back if you had misclicked mid-battle.
  item.activationCost = cost;
  const pending: NonNullable<StackItem['pendingCosts']> = [];
  if (cost.discard) pending.push({ kind: 'discard', n: cost.discard });
  if (cost.sacrificeOther) pending.push({ kind: 'sacrificeOther', n: cost.sacrificeOther });
  if (cost.discardOrSacrifice) pending.push({ kind: 'discardOrSacrifice', n: cost.discardOrSacrifice });
  if (pending.length) item.pendingCosts = pending;
  e.castChain([item], then);
  e.settle();
}

// ── mods ──────────────────────────────────────────────────────────────

/** R41: the three zones a mod can be applied from. The cache is one of them —
 * "you can augment or graft from cache" (Caleb 2024-12-02) — but it holds
 * CachedCard records rather than bare names, so the zone access goes through
 * these two helpers instead of indexing PlayerState directly. */
type ModZone = 'hand' | 'bin' | 'cache';

function zonePeek(e: E, seat: Seat, from: ModZone, index: number): CardName | undefined {
  return from === 'cache' ? e.cache(seat)[index]?.card : e.player(seat)[from][index];
}

function zoneTake(e: E, seat: Seat, from: ModZone, index: number): void {
  if (from === 'cache') e.uncache(seat, index);
  else e.player(seat)[from].splice(index, 1);
}

/**
 * R42: what applying the mod at `from`/`index` costs.
 * A FULFILLED prophecy makes the graft or augment free as well, not only the
 * play (Caleb 2024-12-03) — and "for free" ignores affinity. Modding out of
 * the cache WITHOUT a fulfilled prophecy is still allowed (Caleb 2024-12-02)
 * and costs the mod's normal price: a glimpse's "ignoring affinity" is a
 * permission to PLAY, and applying a mod is not playing (R37).
 */
function modIsFree(e: E, seat: Seat, from: ModZone, index: number): boolean {
  return from === 'cache' && e.cachePermission(seat, index) === 'prophecy';
}

/**
 * R95: may `seat` apply `c` as an augment during battle, out of `from`?
 *
 * THE ONE PREDICATE. `doAugment` and `legalActions` both call it and neither
 * has its own copy — the fuzzer's "legalActions lied" check has already caught
 * that class of split once, and a permission grows a second implementation
 * faster than most things.
 *
 * The base rule is the printed one: a {Virus}, from hand, and nothing else.
 * On top of that sits R95's opt-in permission layer, which today is Rook
 * ("[Augment] You may augment cards from hand and bin during battle as if they
 * were [Virus]") and which the designer is explicit must be opt-in — asked
 * whether an ordinary card grants it, calebgannon: "It shouldn't" … "If it
 * said 'as if it was in your hand' then it could work" → `$card rook` → "Does
 * do that".
 */
function battleAugmentAllowed(e: E, seat: Seat, c: CardDef, from: ModZone, region: number): boolean {
  if (c.virus && from === 'hand') return true;
  return e.mayAugmentInBattle({ seat, card: c, from, region });
}

/**
 * R95's HASTE-timing sibling: may `seat` apply `c` as a mod (augment OR graft)
 * during the R18 haste step — "[Augment] You can apply other mods during
 * [Haste] as if it was deployment" (Slurpr)?
 *
 * THE ONE PREDICATE, exactly as `battleAugmentAllowed` is for the battle
 * window: `doAugment`, `doGraft`, `pushHasteMods` (the legalActions offer) and
 * `E.startHasteStep`'s `canHaste` all call this and none has its own copy.
 * There are FOUR gates here rather than R95's two, and the load-bearing one is
 * `canHaste`: it skips the haste step outright when nobody has anything to do
 * in it, so a board with a Slurpr and a hand of nothing but mods would never
 * reach the other three and the grant would be invisible. That is playtest
 * report #74 (R97's `hastePlayAllowance`) in mod form.
 *
 * There is NO base case, unlike the battle window's {Virus}: nothing is
 * printed as haste-timed modding, so the whole permission is the grant.
 *
 * The window test is here rather than in the engine gatherer because it is
 * about the STEP, not about the permission: outside the haste step there is
 * nothing to widen, and the deploy and battle branches answer for themselves.
 */
function hasteModAllowed(e: E, seat: Seat, c: CardDef, from: ModZone,
  kind: 'augment' | 'graft'): boolean {
  // the R18 haste step, and this seat has not already finished it
  if (e.s.phase !== 'planning' || e.s.hasteDone === null || e.s.hasteDone[seat]) return false;
  // R12: the grantor has to be in the region the modding happens in, which
  // during the haste step is always this seat's home region.
  return e.mayApplyModAtHaste({ seat, card: c, from, region: e.homeRegion(seat), kind });
}

/**
 * R79: the stack-item kinds a Virus may be augmented onto.
 *
 * SPELLS, and only spells. Caleb 2025-04-06 asks and answers exactly this
 * ("can you augment a spell with a virus, such as applying Chitin Shredder as
 * an augment on Arc Lightning? Yes"), and 2025-03-06 adds spell TOKENS by
 * name. A spell UNIT is a spell on the way to being a body, and its viruses
 * simply arrive with it as the augment mods they already were.
 *
 * Deliberately NOT here, each for its own reason:
 *  - 'triggered' / 'activated' — an ability is an effect but not a spell, and
 *    it has no card of its own for a mod to sit under. R60 lets you NEGATE
 *    one; that is not the same permission.
 *  - 'virus' — a virus is itself a mod in flight, not a host.
 *  - 'unit' — a {Battle} unit mid-cast. A virus wants to be a mod on the body
 *    it lands on, which is the ordinary augment, available the moment it
 *    spawns; nothing in the rules asks for the mid-cast version.
 *  - 'ambush' — an ambusher is a unit played face-down, not a spell, and R22
 *    only makes it negatable.
 * All four exclusions are ⚠ judgement calls, not sourced answers — see
 * docs/digital-rules.md R79.
 */
const STACK_VIRUS_HOSTS = new Set<StackItem['kind']>(['spell', 'spellUnit', 'spellToken']);

function doAugment(e: E, seat: Seat, from: ModZone, index: number,
  hostId?: EntityId, hostStack?: number): void {
  const name = zonePeek(e, seat, from, index);
  e.need(name !== undefined, `no such card in ${from}`);
  const c = e.card(name);
  e.need(isAugment(name), 'that card is not an augment');
  const free = modIsFree(e, seat, from, index);
  // R37/R59: applying a mod is not PLAYING, so a "spells cost more to play"
  // modifier must not tax it — the cost is looked up with purpose 'mod'.
  e.need(free || e.canPayCard(seat, name, { purpose: 'mod' }), 'cannot pay for that');

  // R79: a Virus onto a SPELL ON THE STACK ("It's perfectly legal in the game
  // to put the powerful guy onto a giant fireball you're casting"; Caleb
  // 2025-04-06 confirms it, attributes only).
  if (hostStack !== undefined) {
    e.need(hostId === undefined, 'name one host, not two');
    e.need(e.s.phase === 'battle', 'a spell on the stack can only be augmented during battle');
    // R95: the permission layer, and the ONE predicate legalActions also uses.
    // ⚠ OPEN: Rook says "as if they were [Virus]", and R79 is what a Virus may
    // do to a spell on the stack, so the permissive reading unlocks this
    // branch too and that is what ships. Flagged in R95: if the owner rules
    // that the permission is only about hand-and-bin TIMING and not about
    // stack hosts, this line goes back to `c.virus && from === 'hand'` and the
    // unit branch below keeps the permission.
    e.need(battleAugmentAllowed(e, seat, c, from, e.s.battle!.region),
      'only Virus cards can augment from hand during battle');
    e.need(e.s.priority === seat, 'you do not have priority');
    const target = e.s.stack.find(it => it.id === hostStack);
    // R78: `s.stack` and nothing else — an item that is RESOLVING has left the
    // stack and is past being responded to, exactly as it is past negation.
    e.need(target !== undefined && STACK_VIRUS_HOSTS.has(target.kind),
      'no such spell on the stack');
    e.need(target!.region === e.s.battle!.region, 'that spell is in another region');
    // R95: zoneTake, NOT hand.splice. Once the battle window can be entered
    // from the bin, a hardcoded `hand.splice(index)` deletes an unrelated card
    // out of the hand and leaves the bin card in place — the single most
    // dangerous line in this change, in both branches.
    zoneTake(e, seat, from, index);
    e.payCard(seat, name, { purpose: 'mod' });   // R37/R59: a Virus augment is a mod
    const item: StackItem = {
      id: e.s.nextId++, kind: 'virus', card: name,
      label: `${name} (Virus augment on ${target!.label})`, controller: seat,
      region: target!.region, negated: false, parts: [], hostStack,
    };
    // R53's "when I become targeted" listeners all read `data.unit`; there is
    // no unit here, so they correctly do not match. The event is still fired
    // and logged so the targeting is public and auditable.
    const ev = e.ev('targeted', `${name} targets ${target!.label} on the stack.`,
      { item: hostStack, region: target!.region });
    e.fireEvent('targeted', ev);
    // R37: applying a mod is not playing, and this is a response — it goes on
    // the stack ABOVE its host and therefore resolves first, with no
    // special-casing: pushItem hands priority to the other player.
    e.pushItem(item);
    e.settle();
    return;
  }

  const host = e.entity(hostId!);
  // R95 (haste sibling): "as if it was deployment" — Slurpr. Computed ONCE,
  // here, because it is read three times below: it opens the deploy branch,
  // it stands in for that branch's `deploying(seat)` test, and it carries the
  // R89 spell-token host with it (the grant is "as if it was DEPLOYMENT", so
  // the deployment branch runs verbatim and every other refusal in it still
  // refuses — paying at `purpose: 'mod'`, the host being in your own region).
  const hasteMod = hasteModAllowed(e, seat, c, from, 'augment');
  // R89 — R79's missing half. Caleb, rules-questions 2025-03-06, answering
  // "can i augment my spells during deployment?":
  //
  //   "You can augment spells during deployment but currently that would only
  //    be possible with spell tokens. Also you can only do this with
  //    attributes." (and immediately after: "Mostly, deadly, piercing and
  //    powerful are impacted by this. Especially deadly")
  //
  // A spell token in play is an `Entity` with `kind: 'spellToken'`, and this
  // line has always demanded a unit, so R79 had to list the whole half as
  // "⚠ Not in scope". It is in scope now, in DEPLOYMENT only: during battle a
  // token is a spell you cast, and the host you want is the stack item the
  // `hostStack` branch above already reaches.
  const tokenHost = (e.s.phase === 'deploy' || hasteMod)
    && host?.kind === 'spellToken' && host.controller === seat;
  e.need(host && (host.kind === 'unit' || tokenHost) && !host.absent,
    tokenHost ? 'no such spell token' : 'no such unit');

  if (e.s.phase === 'battle') {
    // Virus: an augment playable from hand during battle, on the stack —
    // plus R95's opt-in permission layer (Rook), through the one predicate.
    e.need(battleAugmentAllowed(e, seat, c, from, e.s.battle!.region),
      'only Virus cards can augment from hand during battle');
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(host.region === e.s.battle!.region, 'that unit is in another region');
    zoneTake(e, seat, from, index);
    e.payCard(seat, name, { purpose: 'mod' });   // R37/R59: a Virus augment is a mod
    const item: StackItem = {
      id: e.s.nextId++, kind: 'virus', card: name,
      label: `${name} (Virus augment on ${host.card})`, controller: seat,
      region: host.region, negated: false, parts: [], hostId: host.id,
    };
    const ev = e.ev('targeted', `${name} targets ${host.card}.`, { unit: host.id, region: host.region });
    e.fireEvent('targeted', ev);
    e.pushItem(item);
    e.settle();
  } else if (e.s.phase === 'deploy' || hasteMod) {
    // the ONLY line the haste grant changes: the phase test. Everything below
    // is the deployment branch verbatim.
    e.need(hasteMod || e.deploying(seat), 'not your deployment');
    e.need(host.region === e.homeRegion(seat), 'you can only mod units in your region');
    zoneTake(e, seat, from, index);
    if (free) e.ev('info', `${name} augments for FREE — its prophecy is fulfilled.`);
    else e.payCard(seat, name, { purpose: 'mod' });
    const ev = e.ev('targeted', `${name} targets ${host.card}.`, { unit: host.id, region: host.region });
    e.fireEvent('targeted', ev);
    e.attachMod(host, name, seat, 'augment');
    // R89: "you can only do this with attributes" — the same restriction R79
    // enforces on the stack, said out loud HERE because this is the moment the
    // player commits the card. A text-only augment (Graxxlid, Skybreaker) is
    // still a legal thing to do and still does nothing to a spell; the log
    // says which of the two just happened rather than leaving the player to
    // discover it when the token resolves for the same damage as before.
    if (tokenHost) {
      const granted = c.augmentAttrs;
      e.ev('info', `${name} augments ${host.card} ${host.x ?? ''}`.trimEnd()
        + (granted.length
          ? ` — the spell gains {${granted.join('} {')}} when it is cast.`
          : ' — but a spell can only gain ATTRIBUTES, and this grants none, so nothing changes.'),
        { unit: host.id, card: name, seat });
    }
    e.settle();
  } else {
    e.illegal('modding is a deployment action (or a battle Virus)');
  }
}

function doGraft(e: E, seat: Seat, from: ModZone, index: number, hostId: EntityId, position: number): void {
  // ⚠ THE TIMING GATE MOVED DOWN. It used to be this function's first line,
  // and it cannot be any more: R95's haste sibling asks the granting card
  // about the CardDef being applied ("other mods" is a per-card question), so
  // the zone lookup has to happen first. The refusal is otherwise unchanged —
  // same test, same message, still before anything is taken or paid.
  const name = zonePeek(e, seat, from, index);
  e.need(name !== undefined, `no such card in ${from}`);
  e.need(isGraftable(name), 'that card has no graft symbol');
  // R95 (haste sibling): "you can apply other MODS during [Haste] as if it was
  // deployment" — R37's "mod" is an augment OR a graft, so Slurpr opens this
  // door too. "As if it was deployment" means every line below still applies.
  e.need(e.deploying(seat) || hasteModAllowed(e, seat, e.card(name!), from, 'graft'),
    'grafting is a deployment action');
  const host = e.entity(hostId);
  e.need(host && host.kind === 'unit' && !host.absent, 'no such unit');
  e.need(host.region === e.homeRegion(seat), 'you can only mod units in your region');
  // both cards must carry the graft symbol: the host needs its own graft cause
  e.need(graftCauseIndex(host.card) >= 0, 'the target has no graft cause');
  const free = modIsFree(e, seat, from, index);
  e.need(free || e.canPayCard(seat, name, { purpose: 'mod' }), 'cannot pay for that');  // R37/R59
  // new grafts insert anywhere below the base card, never reorder the rest
  e.need(Number.isInteger(position) && position >= 0 && position <= host.mods.length, 'bad graft position');
  zoneTake(e, seat, from, index);
  if (free) e.ev('info', `${name} grafts for FREE — its prophecy is fulfilled.`);
  else e.payCard(seat, name, { purpose: 'mod' });
  const ev = e.ev('targeted', `${name} targets ${host.card}.`, { unit: host.id, region: host.region });
  e.fireEvent('targeted', ev);   // grafting is targeting (Graft 101 §5)
  e.attachMod(host, name, seat, 'graft', position);
  e.settle();
}

// ── combat declarations ───────────────────────────────────────────────

function validFormation(e: E, seat: Seat, columns: EntityId[][], fromRegion: number, pool: EntityId[] | null): void {
  const used = new Set<EntityId>();
  for (const col of columns) {
    e.need(col.length >= 1 && col.length <= 2, 'columns hold 1-2 units');
    for (const id of col) {
      const u = e.entity(id);
      e.need(u && u.kind === 'unit' && u.controller === seat && !u.absent, 'not your unit');
      e.need(u.region === fromRegion, 'that unit is in another region');
      e.need(!used.has(id), 'a unit can only be in one column');
      e.need(!pool || pool.includes(id), 'only units sent at block time may counterattack');
      // R84 {Alluring}: a lured unit cannot attack for the rest of this battle
      // phase — the half of the attribute that survives the allurer's death
      e.need(!u.allured, `Alluring: ${u.card} was lured and cannot attack this battle`);
      used.add(id);
    }
  }
}

/**
 * R87 — may this spell token ride out with a formation leaving `fromRegion`?
 *
 * "Yes, spell tokens can move into other regions on attack/counter-attack
 * step. But they always need a unit to take them with them" (lofavreel,
 * rules-questions 2023-08-19), and Caleb himself: "you can only play spell
 * tokens in the region they are in (or you can bring them into enemy regions
 * during an attack, if they were created in your own region)" (2025-04-21).
 *
 * ONE helper for both declarations, deliberately: an attack and a
 * counterattack are the same movement seen from the two sides of the table
 * ("if your opponent declares a counter attack they create a formation and
 * move those units + some/all spell tokens to your region" — tecera,
 * 2025-12-23), and the whole of playtest report #67 is the two of them having
 * been allowed to disagree. The "needs a unit to take it" half is enforced at
 * each call site, because that is where the units are.
 */
function needRidingToken(e: E, seat: Seat, id: EntityId, fromRegion: number): void {
  const t = e.entity(id);
  e.need(t && t.kind === 'spellToken' && t.controller === seat && !t.absent
    && t.region === fromRegion, 'not your spell token');
}

function doDeclareAttack(e: E, seat: Seat, columns: EntityId[][], spellTokens: EntityId[]): void {
  const b = e.s.battle;
  e.need(e.s.phase === 'battle' && b && b.step === 'declare' && seat === b.attacker, 'not your attack step');
  if (!columns.length) {
    e.ev('info', `${e.pname(seat)} does not attack.`);
    e.endBattleRound();
    return;
  }
  // round 1: attack out of your home region. Round 2 after a real round-1
  // battle: only the counterattackers, already standing in the region. Round 2
  // when round 1 didn't happen (attackerPool null): a FRESH attack from home —
  // the units still have to travel (found live: "unit is in another region"
  // whenever the initiative player had nothing to attack with in round 1).
  const fromRegion = b.round === 1 || b.attackerPool === null ? e.homeRegion(seat) : b.region;
  validFormation(e, seat, columns, fromRegion, b.attackerPool);
  for (const id of spellTokens) {
    needRidingToken(e, seat, id, fromRegion);
    e.need(!b.attackerPool || b.attackerPool.includes(id), 'only tokens sent at block time may come along');
  }
  b.columns = columns.map(c => c.slice());
  b.happened = true;
  // attackers (and riding spell tokens, and the player) enter the region
  for (const id of [...columns.flat(), ...spellTokens]) e.entity(id)!.region = b.region;
  const present = e.s.regions[b.region]!.presentSeats;
  if (!present.includes(seat)) present.push(seat);
  const ev = e.ev('attackDeclared', `${e.pname(seat)} attacks with ${columns.length} column(s).`, { seat, region: b.region });
  e.fireEvent('attackDeclared', ev);
  // R84: {Alluring} is an on-attack trigger that targets — one per Alluring
  // column, queued alongside the card triggers this same event just fired
  queueAlluringTriggers(e, seat, ev);
  for (const id of columns.flat()) {
    const u = e.entity(id);
    if (!u) continue;
    const uev = e.ev('attacked', `${u.card} attacks.`, { unit: id, region: b.region, seat });
    e.fireEvent('attacked', uev);
  }
  e.openPriority('attackWindow');
  e.settle();
}

/* ── R84 {Alluring} — an on-attack triggered ability that TARGETS ──────────
 *
 * The attribute reads: when a column with {Alluring} attacks, it targets ONE
 * enemy unit; that unit cannot attack, and must block THIS column this combat
 * if able. Caleb, asked "does alluring stop a whole enemy from attacking or a
 * single unit?" — *"single unit … meaning target unit controlled by an
 * opponent"*. The community summary he let stand: *"when your formation enters
 * enemy region, you can use Alluring to target 1 enemy unit. It won't be able
 * to 'counter-attack' into your region and will be forced to block column
 * which has Alluring unit."*
 *
 * It is a real triggered ability, on the real stack: *"'Alluring' effect goes
 * to stack and can be negated?" — "Yep!"*, and *"this would stop the trigger
 * if you kill the allurer while the effect is on the stack"*. Modelling it as
 * a trigger rather than as a block-time validator rule is what buys all of
 * that — negation, fizzling, the target-picking UI — for nothing.
 *
 * It does not stack (*"Nah alluring doesn't stack … It's just one attribute …
 * It's like how you can't gain flying flying"*), so it is ONE trigger per
 * Alluring COLUMN, not one per unit — and Alluring is shared to the column
 * like every other combat attribute (`E.colAttrs`).
 */

/** the synthetic card the Alluring trigger's effect hangs on.
 *
 * `EffectPart.effectKey` is a registry lookup, and there is deliberately no
 * back door: `effectByKey` resolves `ability:<card>#<i>` through `getCard`,
 * and CARD code (Divine Intervention, Gravitational Correction, Hexbane
 * Shiitake) calls it on the parts of an arbitrary stack item it is retargeting
 * — an Alluring trigger included, since it is a legal "target effect". A
 * rules-owned effect therefore has to be a registered card or those three
 * would throw on it.
 *
 * `kind: 'spellToken'` keeps it out of `DECK_LIST` (which takes only unit /
 * spell / spellUnit), and the two-word name appears in no card's printed text
 * and in no log line — the stack item carries the ALLURER's card name, not
 * this one — so the client's log scanner and token scanner never see it. Its
 * own `text` is the attribute written out as rules text, which is what
 * test/68's target conformance reads the declared kind off. */
const ALLURING_CARD = 'Alluring Attribute';
const ALLURING_KEY = `ability:${ALLURING_CARD}#0`;

/** The live {Alluring} attack column at index `ci`, or null.
 *
 * Asked at three moments — when the trigger is queued, when it resolves, and
 * when blocks are declared — because all three can disagree: the allurer can
 * die, be silenced (R62 switches the attribute layer off) or be blanked by a
 * {Pure} column-mate in between, and each of those genuinely ends the duty. */
function alluringColumn(e: E, ci: number): EntityId[] | null {
  const b = e.s.battle;
  if (!b) return null;
  const col = b.columns[ci];
  if (!col) return null;
  const live = col.filter(id => e.entity(id));
  if (!live.length) return null;
  // R61 {Pure}: a column that is itself Pure ignores its own other attributes
  // — Alluring included — so it compels nobody.
  if (e.pure(live)) return null;
  if (!e.colAttrs(live).has('Alluring')) return null;
  return live;
}

/**
 * R84 — could `u` discharge column `ci`'s Alluring duty **on its own**?
 *
 * This is the printed word "able", and it is a property of the UNIT and THAT
 * COLUMN only: region, controller, {Feeble}, {Flying}, R20's lone {Sneaky}
 * attacker, {Evasive}'s second blocker, and R61's {Pure} exceptions to all of
 * them. It deliberately does NOT look at what the defender has done with `u`
 * elsewhere in the same declaration.
 *
 * That dependency was the UFAB bug (playtest 2026-08-22): the old rule
 * computed each duty's candidate pool AFTER subtracting the units the defender
 * had already committed to other columns, so committing every blocker
 * somewhere else manufactured the "nobody is able" excuse and the Alluring
 * column walked through unblocked for 6.
 */
function canBlockAlone(e: E, u: Entity, ci: number): boolean {
  const b = e.s.battle;
  const live = alluringColumn(e, ci);
  if (!b || !live) return false;
  if (u.kind !== 'unit' || u.absent || u.region !== b.region) return false;
  // R61 {Pure}: one Pure card in either column switches the attribute layer
  // off for that exchange — the blocker's own {Feeble} included.
  const pure = e.pure(live, [u.id]);
  const atkAttrs = pure ? new Set<string>() : e.colAttrs(live);
  const own = e.ownAttrs(u);
  if (own.has('Feeble') && !own.has('Pure')) return false;
  if (atkAttrs.has('Flying') && !own.has('Flying')) return false;
  // R20: a LONE Sneaky attacker cannot be blocked at all, so nobody is able to
  // block it — except a Pure blocker, which sees through Sneaky (R61).
  const atkUnits = b.columns.flat().filter(id => e.entity(id));
  if (atkUnits.length === 1 && e.colAttrs(atkUnits).has('Sneaky') && !e.pure(atkUnits, [u.id])) return false;
  // {Evasive} wants two blockers, so one unit alone cannot satisfy the column
  // — and this is the case the solved RAQ thread turns on.
  if (atkAttrs.has('Evasive')) return false;
  return true;
}

/** the Alluring duties `seat` is under right now, grouped by the lured unit */
function alluredUnits(e: E, seat: Seat): { u: Entity; cols: number[] }[] {
  const b = e.s.battle;
  if (!b) return [];
  const out: { u: Entity; cols: number[] }[] = [];
  for (const u of e.unitsOf(seat, b.region)) {
    if (u.allured?.round !== b.round) continue;      // an older round: can't-attack only
    const cols = u.allured.columns.filter(ci => alluringColumn(e, ci));
    if (cols.length) out.push({ u, cols });
  }
  return out;
}

/**
 * R84 — why a block declaration is illegal under {Alluring}, or null.
 *
 * Two clauses per duty, and every case in the solved RAQ thread falls out of
 * them (A is the lured unit, the column is Alluring+Evasive so it needs two):
 *
 *  - **If the column IS blocked, A must be among its blockers.** *"If another
 *    unit B wants to block the alluring column then suddenly A can and also
 *    has to."* So with three units A/B/C, A+B and A+C are legal and **B+C is
 *    not** — you do not get to send a substitute.
 *  - **If the column is NOT blocked, that is legal only if A could not have
 *    satisfied it alone.** With one unit A, A cannot cover an Evasive column
 *    by itself, so nothing compels it and it is free to block elsewhere; with
 *    two, the defender may block A+B or forgo the column, and those are the
 *    only two options. Plain (non-Evasive) Alluring collapses to "A must block
 *    it", which is the whole point of the attribute.
 *
 * Nobody is mind-controlled: *"Yeah they can not block. You don't get to mind
 * control the opponent 🙂"* — the compulsion never reaches past what ONE unit
 * can do on its own.
 *
 * ⚠ **Two duties on one unit.** Two Alluring columns may name the same unit,
 * and it cannot block both. Discharging either one excuses the rest — and the
 * "must be among its blockers" clause is waived for the excused ones too,
 * because otherwise a defender who does exactly what one duty demands is then
 * refused for the other, and some positions have no legal declaration at all.
 * That waiver is the ONLY place "able" is allowed to look at the rest of the
 * declaration, and it is bounded: only another ALLURING duty can excuse one.
 * Blocking a plain column, or being sent to counterattack, excuses nothing.
 * (Judgement call, 2026-08-22 — see docs/digital-rules.md R84.)
 */
export function allureViolation(
  e: E, seat: Seat, blocks: Record<number, EntityId[]>,
): string | null {
  for (const { u, cols } of alluredUnits(e, seat)) {
    // discharged: it is blocking one of the columns that lured it
    if (cols.some(ci => (blocks[ci] ?? []).includes(u.id))) continue;
    for (const ci of cols) {
      const lure = e.entity(alluringColumn(e, ci)![0]!)?.card ?? 'that attacker';
      if ((blocks[ci] ?? []).length) {
        return `Alluring: ${lure} lured ${u.card}, so ${u.card} must be one of that column's blockers`;
      }
      if (canBlockAlone(e, u, ci)) {
        return `Alluring: ${u.card} was lured by ${lure} and must block that column`;
      }
    }
  }
  return null;
}

/**
 * R84 — the block assignment every Alluring duty on the board demands, and the
 * reason `legalActions` can always offer something at the block step.
 *
 * Alluring is compulsory and conjunctive across columns, so a declaration is
 * legal only if it answers every duty at once. `legalActions` offers a
 * representative set of declarations that vary ONE column at a time, which
 * cannot express that on its own: with two Alluring columns and two able
 * blockers, every single-column option left the other duty unmet, every option
 * was filtered out, and the game HUNG with no legal action for anyone (fuzz
 * seed 1993 — R76). Every option is therefore built on top of this core, and
 * the bare core is always offered.
 *
 * Under the new model this is no search at all: each duty NAMES its unit, and
 * two duties can only collide by naming the same unit — in which case
 * discharging one excuses the others, so taking the first is right. Distinct
 * lured units have disjoint duty columns (one target per column), so the
 * assignments can never contend for a column either. The result is legal by
 * construction.
 */
export function compulsoryBlocks(e: E, seat: Seat): Record<number, EntityId[]> {
  const blocks: Record<number, EntityId[]> = {};
  for (const { u, cols } of alluredUnits(e, seat)) {
    const ci = cols.find(c => canBlockAlone(e, u, c));
    if (ci !== undefined) blocks[ci] = [u.id];
  }
  return blocks;
}

/**
 * R84 — the trigger, queued at the `attackDeclared` seam. One per Alluring
 * COLUMN (it does not stack), anchored on the unit in it that actually carries
 * the attribute so that killing THAT unit is what stops it.
 *
 * Queued by hand rather than through `E.fireEvent`, because there is no card
 * here: the label and the source card name are the ALLURER's, so the stack,
 * the log and the client's card scan all say which attacker is doing this.
 */
function queueAlluringTriggers(e: E, seat: Seat, ev: EngineEvent): void {
  const b = e.s.battle!;
  let queued = false;
  b.columns.forEach((_col, ci) => {
    const live = alluringColumn(e, ci);
    if (!live) return;
    const srcId = live.find(id => e.ownAttrs(e.entity(id)!).has('Alluring')) ?? live[0]!;
    const src = e.entity(srcId)!;
    e.s.triggerQueue.push({
      sourceId: srcId, sourceCard: src.card, controller: seat, abilityIndex: 0,
      label: `${src.card}: {Alluring}`,
      parts: [{ effectKey: ALLURING_KEY, targets: [] }],
      region: b.region, event: ev,
    });
    e.ev('triggered', `Trigger: ${src.card} — {Alluring}.`, { unit: srcId, region: b.region });
    queued = true;
  });
  // a fresh batch: (re)ask the ordering, exactly as fireEvent does
  if (queued) e.s.triggerOrderedSeats = [];
}

const ALLURING_EFFECT: EffectDef = {
  targets: {
    what: 'enemyUnit',
    prompt: '{Alluring}: target an enemy unit — it cannot attack, and must block this column if able',
  },
  run: (g, ctx) => {
    const b = g.s.battle;
    const src = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    const ci = b && src ? b.columns.findIndex(c => c.includes(src.id)) : -1;
    // Caleb: *"this would stop the trigger if you kill the allurer while the
    // effect is on the stack"*. The allurer has to still be attacking, and its
    // column has to still be Alluring, or there is no column to be lured to.
    // (Once it has RESOLVED the mark stands on its own — killing the allurer
    // then frees the block and leaves the can't-attack half: *"You can't
    // attack but you can block other things"*.)
    if (!b || !src || ci < 0 || !alluringColumn(g, ci)) {
      g.ev('info', `${ctx.sourceName}: the {Alluring} attacker is no longer in the line — nothing is lured.`);
      return;
    }
    const t = ctx.targets[0];
    if (!t || !('id' in (t as object))) {
      g.ev('info', `${ctx.sourceName}: nothing left to lure.`);
      return;
    }
    const u = t as Entity;
    if (!u.allured || u.allured.round !== b.round) u.allured = { round: b.round, columns: [] };
    if (!u.allured.columns.includes(ci)) u.allured.columns.push(ci);
    g.ev('info',
      `${u.card} is lured by ${src.card}: it cannot attack this battle, and must block that column if able.`,
      { unit: u.id, region: b.region });
  },
};

registerSynthetic({
  name: ALLURING_CARD, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Attribute', kind: 'spellToken', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  // the attribute as printed rules text, so test/68's target conformance can
  // read the declared kind off it like it does for every real card
  text: "When my column attacks, target unit controlled by an opponent can't attack "
    + 'this battle, and must block my column this combat if able.',
}, {
  abilities: [{
    type: 'triggered', events: ['attackDeclared'], label: '{Alluring}',
    // never found by a scan: this card is never in play, and the trigger is
    // queued by hand from doDeclareAttack. The guard is belt-and-braces.
    when: () => false,
    effect: ALLURING_EFFECT,
  }],
});

/**
 * R84's judgement, widened to EVERY block-legality reason: WHY this block
 * declaration would be refused, or null.
 *
 * Playtest ledger #77 (WEHH, 2026-08-22): *"Trying to declare illegal blocks
 * entirely resets the board, which is really annoying. Instead, it should
 * reset only the 'affected' units and give a notice as well as a 'Reset
 * blockers?' button. That way, if there's a massive block, the player doesn't
 * have to entirely rebuild it for forgetting about a single thing."*
 *
 * R84 already built the shape that answers this: `allureViolation` is a pure
 * predicate the CLIENT reads (ui/inspect.ts `blockPlanIssue`) so that a
 * compulsory block is NAMED up front instead of discovered by being refused.
 * The only reason that shape stopped at {Alluring} is that the rest of the
 * legality — Feeble, Flying, Evasive, lone Sneaky, one column per unit,
 * 1-2 per column, what may be sent — lived inside `doDeclareBlocks` as a run
 * of `e.need` calls that could only be reached by actually declaring.
 *
 * So the run of checks is lifted out here, VERBATIM and in the same order,
 * and `doDeclareBlocks` now calls it. Nothing about which blocks are legal
 * changes — this is a seam, not a rule. What it buys is that a client can ask
 * "would you take this?" of a plan it is holding, which is what makes it
 * possible to keep the parts that are fine and clear only the parts that are
 * not (ui/battle.ts `blockVerdict`).
 *
 * Returns the number of UNITS in `send` (as opposed to spell tokens riding
 * with them), which the declaration's log line needs and which is computed
 * here anyway.
 */
function checkBlocks(e: E, seat: Seat, blocks: Record<number, EntityId[]>, send: EntityId[]): number {
  const b = e.s.battle;
  e.need(e.s.phase === 'battle' && b && b.step === 'blocks' && seat === b.defender, 'not your block step');
  const used = new Set<EntityId>();
  // R20: a lone Sneaky attacker (the only attacking unit) cannot be blocked
  const atkUnits = b.columns.flat().filter(id => e.entity(id));
  if (atkUnits.length === 1 && e.colAttrs(atkUnits).has('Sneaky')) {
    // R61 {Pure}: Sneaky is an attribute like any other, so a Pure blocker
    // sees straight through it — the interaction blinds both sides.
    const blockingWith = Object.values(blocks).flat();
    e.need(blockingWith.length === 0 || e.pure(atkUnits, blockingWith),
      'a lone Sneaky attacker cannot be blocked');
  }
  for (const [ciStr, col] of Object.entries(blocks)) {
    const ci = Number(ciStr);
    const atkCol = b.columns[ci];
    e.need(atkCol, 'no such attacking column');
    e.need(col.length >= 1 && col.length <= 2, 'blocking columns hold 1-2 units');
    for (const id of col) {
      const u = e.entity(id);
      e.need(u && u.kind === 'unit' && u.controller === seat && !u.absent, 'not your unit');
      e.need(u.region === b.region, 'that unit is in another region');
      e.need(!used.has(id), 'a unit can only block in one column');
      // Feeble: can't block (own/augment attrs — a Feeble unit never joins a
      // blocking column). R61: a Pure card ignores its OWN other attributes
      // too, so Pure+Feeble blocks.
      e.need(!e.ownAttrs(u).has('Feeble') || e.ownAttrs(u).has('Pure'),
        'Feeble units cannot block');
      used.add(id);
    }
    // R61 {Pure}: one Pure card in either column switches the attribute layer
    // off for this whole exchange, so neither evasion rule survives it.
    const pure = e.pure(atkCol, col);
    const atkAttrs = pure ? new Set<string>() : e.colAttrs(atkCol.filter(id => e.entity(id)));
    // Flying: only a flying column can block a flying column
    if (atkAttrs.has('Flying')) e.need(e.colAttrs(col).has('Flying'), 'only flying units can block flying units');
    // Evasive: requires two blockers
    if (atkAttrs.has('Evasive')) e.need(col.length >= 2, 'Evasive requires two blockers');
  }
  // counterattackers leave now and "don't exist" until round 2 (1v1 battle rule)
  e.need(b.round === 1 || send.length === 0, 'no counter-counterattacks');
  let sentUnits = 0;
  for (const id of send) {
    const t = e.entity(id);
    e.need(t && (t.kind === 'unit' || t.kind === 'spellToken') && t.controller === seat && !t.absent, 'cannot send that');
    // R87: a token riding a counterattack answers to exactly the question an
    // attack asks of a rider, from the one helper both declarations use. (A
    // unit keeps its own line below — a counterattacker leaves from the region
    // it is DEFENDING, which is `b.region` for both kinds.)
    if (t.kind === 'spellToken') needRidingToken(e, seat, id, b.region);
    e.need(t.region === b.region, 'that is in another region');
    e.need(!used.has(id), 'blockers cannot also be sent to attack');
    // R84 {Alluring}: "it won't be able to counter-attack into your region" —
    // going out as a counterattacker IS attacking, so a lured unit may not
    e.need(!t.allured, `Alluring: ${t.card} was lured and cannot counterattack`);
    used.add(id);
    if (t.kind === 'unit') sentUnits++;
  }
  // R87, and it is the oldest half of the rule: "they always need a unit to
  // take them with them" (lofavreel 2023-08-19) — "In order to move spell
  // tokens, you must have attacked opponent Region. In order to attack
  // opponent Region, you must send atleast 1 of your unit" (_passer
  // 2025-05-10). A counterattack of tokens alone is not a counterattack.
  e.need(send.length === 0 || sentUnits > 0, 'spell tokens travel only with units');

  // R84 {Alluring}: each lured unit must be among its column's blockers, and
  // may only leave that column unblocked when it could not have covered it
  // alone. Judged against the unit and the column ONLY — never against what
  // the defender did with it elsewhere (that was the UFAB bug).
  const allured = allureViolation(e, seat, blocks);
  e.need(!allured, allured ?? '');
  return sentUnits;
}

/**
 * `checkBlocks` as a value instead of a throw — the client-facing form.
 *
 * The state must be a CLONE: `E` is a mutator that only happens to be read
 * from here, the same reason `legalActions` and `blockPlanIssue` clone before
 * they look. Nothing in `checkBlocks` writes, but nothing in it promises not
 * to either, and a client asking a question must not be able to move the game.
 */
export function blockDeclarationIssue(
  e: E, seat: Seat, blocks: Record<number, EntityId[]>, send: EntityId[],
): string | null {
  try { checkBlocks(e, seat, blocks, send); return null; }
  catch (err) { if (err instanceof IllegalAction) return err.message || 'that block cannot be declared'; throw err; }
}

function doDeclareBlocks(e: E, seat: Seat, blocks: Record<number, EntityId[]>, send: EntityId[]): void {
  const b = e.s.battle!;
  const sentUnits = checkBlocks(e, seat, blocks, send);

  b.blocks = {};
  for (const [ciStr, col] of Object.entries(blocks)) b.blocks[Number(ciStr)] = col.slice();
  for (const id of send) e.entity(id)!.absent = true;
  b.sentAttackers = send.slice();
  const ev = e.ev('blocksDeclared',
    `${e.pname(seat)} blocks ${Object.keys(blocks).length} column(s)` +
    // R87: the tokens are counted separately, because "3 counterattackers"
    // when one of them is a Poison is exactly the confusion report #67 opened
    // with. Identical wording to before whenever no token rides along.
    (send.length ? ` and sends ${sentUnits} counterattacker(s)`
      + (send.length > sentUnits ? ` with ${send.length - sentUnits} spell token(s)` : '') : '') + '.',
    { seat, region: b.region });
  e.fireEvent('blocksDeclared', ev);
  for (const col of Object.values(b.blocks)) {
    for (const id of col) {
      const u = e.entity(id);
      if (!u) continue;
      const uev = e.ev('blocked', `${u.card} blocks.`, { unit: id, region: b.region, seat });
      e.fireEvent('blocked', uev);
    }
  }
  e.openPriority('blockWindow');
  e.settle();
}

// ── deployment done / end of turn ─────────────────────────────────────

function doDoneDeploying(e: E, seat: Seat): void {
  e.need(e.deploying(seat), 'not your deployment');
  e.s.deployDone![seat] = true;
  e.ev('phase', `${e.pname(seat)} is done deploying.`);
  if (e.s.deployDone!.every(Boolean)) {
    e.s.deployDone = null;
    e.s.deployPlayer = null;
    e.endTurn();
    return;
  }
  // derived sequential marker: initiative-ordered first seat still deploying
  e.s.deployPlayer = [e.initiative, other(e.initiative)].find(s => !e.s.deployDone![s]) ?? null;
}

// ── decisions ─────────────────────────────────────────────────────────

function doDecide(e: E, seat: Seat, choice: number | number[]): void {
  const dec = e.s.decision;
  const sus = e.s.suspension;
  e.need(dec && sus, 'no decision is pending');
  e.need(dec.seat === seat, 'not your decision');
  e.s.decision = null;
  e.s.suspension = null;

  if (sus.type === 'cast') {
    e.need(typeof choice === 'number' && dec.options[choice], 'bad choice');
    const val = dec.options[choice]!.value;
    if (sus.stage === 'x') {
      // cast-time X (R35): store it, pay it — fixed before anyone responds
      const x = val as number;
      sus.item.x = x;
      sus.item.label = `${sus.item.card} (X=${x})`;
      e.payMana(sus.item.controller, x);
      e.ev('info', `${e.pname(seat)} chooses X = ${x} for ${sus.item.card} and pays it.`);
    } else if (sus.stage === 'mods') {
      // {Modular}: a mod applied as the card is played — an additional cast
      // cost, paid now, riding on the stack with the spell (R35)
      e.payModularMod(sus.item, val);
    } else if (sus.stage === 'cost') {
      // cast-time bracketed cost (R35): paid now, before the stack push
      e.payCastCost(sus.item, sus.partIndex, val);
    } else if (sus.stage === 'itemCost') {
      // R49: an activation cost that carries a choice — same window, same rule
      e.payItemCost(sus.item, val);
    } else if (sus.stage === 'formation') {
      // R29: WHERE this card is being played. Part of the play, so it is fixed
      // in the cast window with everything else; it is taken at resolution,
      // and re-derived there because the line may have moved (R5/R56).
      sus.item.formationSpot = val as FormationSpot;
    } else if (sus.stage === 'mode') {
      // R57: WHICH HALF of a modal effect. Declared here, in the cast window,
      // so it rides onto the stack with the item — the opponent responds to a
      // fully declared effect, not to a question that is still open.
      sus.item.parts[sus.partIndex]!.mode = val;
    } else if (typeof val === 'object' && val !== null && 'doneTargets' in val) {
      sus.item.parts[sus.partIndex]!.targetsDone = true;
    } else {
      sus.item.parts[sus.partIndex]!.targets.push(val as TargetRef);
    }
    let chain = sus.moreItems;
    e.collectTargets(sus.item, sus.then, chain);   // may suspend again
    e.commitItem(sus.item, sus.then, chain);   // a 'resolve' suspension carries chain too
    e.castChain(chain, sus.then);
    e.settle();
    return;
  }

  if (sus.type === 'orderTriggers') {
    const mine = e.s.triggerQueue.filter(t => t.controller === sus.seat);
    e.need(Array.isArray(choice), 'ordering expects an array of indices');
    e.need(choice.length === mine.length && new Set(choice).size === mine.length
      && choice.every(i => Number.isInteger(i) && i >= 0 && i < mine.length), 'bad ordering');
    const reordered = choice.map(i => mine[i]!);
    let k = 0;
    e.s.triggerQueue = e.s.triggerQueue.map(t => (t.controller === sus.seat ? reordered[k++]! : t));
    e.s.triggerOrderedSeats.push(sus.seat);
    e.processTriggerQueue();
    e.settle();
    return;
  }

  // sus.type === 'resolve': fill the answer and replay the part.
  // R85: the rollback to the part boundary happens HERE, not when the part
  // suspended — so the board everybody was looking at while this question was
  // open showed the resolution as far as it had actually got. `shown` is how
  // much of the part's log they were shown, which the replay must not repeat.
  e.need(typeof choice === 'number' && dec.options[choice], 'bad choice');
  sus.answers[sus.pendingKey] = dec.options[choice]!.value;
  const shown = e.resumeResolve(sus);
  // the rest of the cast chain this item heads (a {Burst} token's siblings),
  // handed back to the replay so a SECOND question from the same item keeps
  // carrying it, and run below once the item is done
  const chain: ChainRest | undefined = sus.moreItems && sus.then
    ? { then: sus.then, moreItems: sus.moreItems } : undefined;
  e.resolveParts(sus.item, sus.partIndex, sus.answers, shown, chain);
  e.afterParts(sus.item);
  // R78: it has ACTUALLY resolved now — clear the marker (resolveParts throws
  // straight past this if the item still owes another choice, which is exactly
  // how it stays marked across a chain of mid-resolution decisions).
  e.endResolving(null);
  e.finishResolutionTail();
  // castChain's loop, resumed: the item that suspended was `chain[0]` of some
  // cast; commitItem's own tail (endResolving + settle) has its counterpart
  // just above, and the items behind it are cast exactly as the loop would
  // have — each collecting its own targets, with the remainder riding along.
  if (chain?.moreItems.length) e.castChain(chain.moreItems, chain.then);
}

// ── forced actions ────────────────────────────────────────────────────

/** The action a player is FORCED to take because they literally have no
 * choice: "attack" with no eligible units, "declare blocks" with no units in
 * the region. The server and the local UI auto-submit these so nobody is
 * asked to confirm an empty board; they still go through apply() and into
 * the action log, so replays stay explicit. Returns null when someone has a
 * real decision to make. */
export function forcedAction(state: GameState): Action | null {
  if (state.decision || state.phase !== 'battle' || !state.battle) return null;
  const b = state.battle;
  const e = new E(structuredClone(state));   // queries only
  if (b.step === 'declare') {
    const from = b.round === 1 || b.attackerPool === null ? e.homeRegion(b.attacker) : b.region;
    const eligible = e.unitsOf(b.attacker, from)
      // R84: a lured unit cannot attack, so it is not eligible and cannot make
      // the difference between "no attack is possible" and a real choice
      .filter(u => (!b.attackerPool || b.attackerPool.includes(u.id)) && !u.allured);
    if (!eligible.length) return { type: 'declareAttack', seat: b.attacker, columns: [] };
    // round-2 counterattack with EXACTLY one sent unit and no sent spell
    // token that could ride along: the only sensible formation is that unit
    // alone — auto-declare it (the player already committed it at block time)
    if (b.round === 2 && b.attackerPool !== null && eligible.length === 1) {
      const ridableTokens = e.tokensOf(b.attacker, from).filter(t => b.attackerPool!.includes(t.id));
      if (!ridableTokens.length) {
        return { type: 'declareAttack', seat: b.attacker, columns: [[eligible[0]!.id]] };
      }
    }
  }
  if (b.step === 'blocks' && !e.unitsOf(b.defender, b.region).length) {
    return { type: 'declareBlocks', seat: b.defender, blocks: {} };
  }
  return null;
}

// ── legalActions ──────────────────────────────────────────────────────

/**
 * Every action returned is legal. For formation-shaped actions
 * (declareAttack / declareBlocks) the enumeration is representative, not
 * exhaustive — the UI builds formations interactively and the fuzzer has its
 * own generator; apply() validates whatever they produce.
 *
 * A dispatcher: the phase blocks are independent of each other and each
 * lives in its own `legal…Actions` function below. The ORDER actions are
 * pushed inside each is load-bearing — the UI and the fuzzer index into
 * this list — so a split must never reorder a push.
 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  const e = new E(structuredClone(state));   // E for queries only
  const s = e.s;
  if (s.phase === 'gameover') return [];
  if (s.decision) return legalDecisionActions(e, seat);
  if (s.phase === 'planning' && s.hasteDone) return legalHasteActions(e, seat);   // haste step (R18)
  if (s.phase === 'planning' && !s.planningDone[seat]) return legalPlanningActions(e, seat);
  if (s.phase === 'battle' && s.battle) return legalBattleActions(e, seat);
  // simultaneous deployment: EVERY not-yet-done seat gets its options (the
  // playtest bug: this still gated on the derived initiative-first
  // deployPlayer, so the other seat saw nothing playable until the first
  // finished — the engine accepted the plays, but they were never offered)
  if (e.deploying(seat)) return legalDeployActions(e, seat);
  return [];
}

/** a pending decision: only its seat may answer, and only from its options */
function legalDecisionActions(e: E, seat: Seat): Action[] {
  const dec = e.s.decision!;
  const out: Action[] = [];
  if (dec.seat !== seat) return out;
  if (dec.pickOrder) {
    // small sets: every ordering; large sets: a representative pair
    // (like formations, apply() validates ANY permutation the UI builds)
    const n = dec.options.length;
    if (n <= 4) {
      for (const perm of permutations(n)) out.push({ type: 'decide', seat, choice: perm });
    } else {
      const identity = Array.from({ length: n }, (_, i) => i);
      out.push({ type: 'decide', seat, choice: identity });
      out.push({ type: 'decide', seat, choice: [...identity].reverse() });
    }
  } else {
    dec.options.forEach((_, i) => out.push({ type: 'decide', seat, choice: i }));
  }
  return out;
}

/** the haste step (R18): done, or a haste-timed play from hand / cache */
function legalHasteActions(e: E, seat: Seat): Action[] {
  const out: Action[] = [];
  if (e.s.hasteDone![seat]) return out;
  out.push({ type: 'doneHaste', seat });
  const home = e.homeRegion(seat);
  e.player(seat).hand.forEach((name, i) => {
    const c = getCard(name);
    // R97, gate 2 of three: the printed [Haste] timing OR a live grant. The
    // client's play affordance is built from this list, and a refusal the UI
    // still offers as a legal click is its own playtest report — so this must
    // route through the same `E.mayPlayAtHaste` that `playAtTiming` enforces.
    const playable = c.timing === 'haste'
      || e.mayPlayAtHaste({ seat, card: c, from: 'hand', region: home });
    if (playable && !c.noPlayFromHand    // R100
      && e.canPayCard(seat, name) && castable(e, c, home, seat)) {
      out.push({ type: 'playCard', seat, handIndex: i });
    }
  });
  pushCachedPlays(e, seat, t => t === 'haste', home, out);
  // R95 (haste sibling), gate 2 of three: a mod applied "as if it was
  // deployment" (Slurpr). Pushed AFTER the plays, so no existing index into
  // this list moves.
  pushHasteMods(e, seat, home, out);
  return out;
}

/** planning: the draft merge / constructed bottoming gates first, then the
 * resource actions and donePlanning */
function legalPlanningActions(e: E, seat: Seat): Action[] {
  const s = e.s;
  const out: Action[] = [];
  const hand = e.player(seat).hand;
  // draft step first: nothing else until this seat commits their merge.
  // Options are representative (like formations): the no-op keep plus every
  // single hand↔pack swap; the UI builds arbitrary merges interactively and
  // apply() validates whatever it sends.
  if (e.draftPending(seat)) {
    const pack = s.packs[seat]!;
    const H = hand.length;
    const noop = Array.from({ length: pack.length }, (_, i) => H + i);
    out.push({ type: 'draftCommit', seat, packIndices: noop });
    for (let h = 0; h < H; h++) {
      for (let p = 0; p < pack.length; p++) {
        out.push({ type: 'draftCommit', seat, packIndices: noop.map((v, j) => (j === p ? h : v)) });
      }
    }
    return out;
  }
  // constructed draw phase: nothing else until the 2 cards go back. Every
  // pair (ordered pairs collapse to one representative; apply() accepts any
  // order) — hands are small, so full enumeration stays tiny.
  if (e.bottomPending(seat)) {
    const required = Math.min(2, hand.length);
    if (required <= 1) {
      out.push({ type: 'bottomCards', seat, handIndices: hand.map((_, i) => i).slice(0, required) });
      return out;
    }
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        out.push({ type: 'bottomCards', seat, handIndices: [i, j] });
      }
    }
    return out;
  }
  for (let i = 0; i < hand.length; i++) {
    for (const el of s.elements) out.push({ type: 'recycleForResource', seat, handIndex: i, element: el });
  }
  if (e.player(seat).activationsLeft > 0) {
    e.player(seat).resources.forEach((r, i) => {
      if (r.state === 'dormant') out.push({ type: 'activateResource', seat, index: i });
    });
  }
  e.player(seat).resources.forEach((r, i) => {
    if (r.kind === 'prismite' && r.state !== 'dormant') {
      for (const el of s.elements) out.push({ type: 'exchangePrismite', seat, index: i, element: el });
    }
  });
  out.push({ type: 'donePlanning', seat });
  return out;
}

/** battle: one of three windows depending on the step and the seat */
function legalBattleActions(e: E, seat: Seat): Action[] {
  const s = e.s;
  const b = s.battle!;
  if (b.step === 'declare' && seat === b.attacker) return legalDeclareAttackActions(e, seat);
  if (b.step === 'blocks' && seat === b.defender) return legalDeclareBlocksActions(e, seat);
  if (s.priority === seat) return legalBattlePriorityActions(e, seat);
  return [];
}

/** the attacker's declare step: representative formations */
function legalDeclareAttackActions(e: E, seat: Seat): Action[] {
  const b = e.s.battle!;
  const out: Action[] = [];
  out.push({ type: 'declareAttack', seat, columns: [] });
  const fromRegion = b.round === 1 || b.attackerPool === null ? e.homeRegion(seat) : b.region;
  const mine = e.unitsOf(seat, fromRegion)
    .filter(u => (!b.attackerPool || b.attackerPool.includes(u.id)) && !u.allured);   // R84
  for (const u of mine) out.push({ type: 'declareAttack', seat, columns: [[u.id]] });
  if (mine.length > 1) out.push({ type: 'declareAttack', seat, columns: mine.map(u => [u.id]) });
  return out;
}

/** the defender's block step: representative block declarations on top of
 * the compulsory (Alluring) core, plus round-1 counterattack sends */
function legalDeclareBlocksActions(e: E, seat: Seat): Action[] {
  const b = e.s.battle!;
  const out: Action[] = [];
  // Alluring makes some of these illegal — filter at the end, from the one
  // predicate the validator uses, so the two can never drift (the fuzzer's
  // "legalActions lied" check is what caught them drifting)
  const legalBlock = (a: Action): boolean => a.type !== 'declareBlocks'
    || !allureViolation(e, seat, a.blocks);
  // R84/R76: Alluring duties are compulsory and must ALL be discharged at
  // once, which no single-column declaration can do once there are two
  // Alluring columns and two lured blockers. Every option below is
  // therefore built on top of the compulsory core, and the core alone is
  // always offered — it is legal by construction, so this list is never
  // empty.
  const core = compulsoryBlocks(e, seat);
  const spoken = new Set<EntityId>(Object.values(core).flat());
  const onCore = (blocks: Record<number, EntityId[]>): Record<number, EntityId[]> =>
    ({ ...core, ...blocks });
  out.push({ type: 'declareBlocks', seat, blocks: onCore({}) });
  const mine = e.unitsOf(seat, b.region);
  // Feeble can't block — unless it is also Pure, which ignores its own
  // other attributes (R61)
  // a unit the compulsory core already spent is not free to be offered again
  const blockers = mine.filter(u =>
    !spoken.has(u.id) && (!e.ownAttrs(u).has('Feeble') || e.pure([u.id])));
  // R20: a lone Sneaky attacker cannot be blocked at all — R61: except by
  // a Pure blocker, which is blind to Sneaky like every other attribute
  const atkUnits = b.columns.flat().filter(id => e.entity(id));
  const sneakyAlone = atkUnits.length === 1 && e.colAttrs(atkUnits).has('Sneaky');
  b.columns.forEach((atkCol, ci) => {
    const live = atkCol.filter(id => e.entity(id));
    const rawAttrs = e.colAttrs(live);
    // this exchange's attrs depend on WHO blocks, so they are resolved per
    // candidate column rather than once for the attacker
    const attrsWith = (ids: EntityId[]) =>
      e.pure(live, ids) ? new Set<string>() : rawAttrs;
    for (const u of blockers) {
      const atkAttrs = attrsWith([u.id]);
      if (sneakyAlone && atkAttrs.has('Sneaky')) continue;
      if (atkAttrs.has('Flying') && !e.colAttrs([u.id]).has('Flying')) continue;
      if (atkAttrs.has('Evasive')) continue;   // needs 2; single-blocker option invalid
      out.push({ type: 'declareBlocks', seat, blocks: onCore({ [ci]: [u.id] }) });
    }
    for (let i = 0; i < blockers.length; i++) {
      for (let j = i + 1; j < blockers.length; j++) {
        const pair = [blockers[i]!.id, blockers[j]!.id];
        const atkAttrs = attrsWith(pair);
        if (atkAttrs.has('Flying') && !e.colAttrs(pair).has('Flying')) continue;
        if (sneakyAlone && atkAttrs.has('Sneaky')) continue;
        out.push({ type: 'declareBlocks', seat, blocks: onCore({ [ci]: pair } ) });
      }
    }
  });
  // send options (round 1 only — no counter-counterattacks):
  // each single non-blocking unit, representative
  if (b.round === 1) {
    // R87: the tokens standing where the counterattack leaves from. A
    // token rides only WITH a unit ("they always need a unit to take them
    // with them"), so the rider is offered on top of each unit send rather
    // than on its own — which is also what makes every one of these legal
    // by construction, the way the fuzzer's "legalActions lied" check
    // insists.
    const riders = e.tokensOf(seat, b.region).map(t => t.id);
    for (const u of mine) {
      if (spoken.has(u.id)) continue;   // it is already blocking, compulsorily
      // R84: a lured unit cannot counterattack — and sending anyone ELSE
      // away cannot change who is "able", so the core is reused verbatim
      if (u.allured) continue;
      out.push({ type: 'declareBlocks', seat, blocks: compulsoryBlocks(e, seat), send: [u.id] });
      // playtest report #67, game GETD: the counterattack went out and
      // three Poison 1s stayed behind, because nothing — not the engine's
      // own enumeration, not the client — ever said they could come. One
      // representative rider per unit; the builder composes any subset and
      // apply() validates it, exactly as it does for a formation.
      if (riders.length) {
        out.push({
          type: 'declareBlocks', seat, blocks: compulsoryBlocks(e, seat),
          send: [u.id], spellTokens: riders.slice(),
        });
      }
    }
  }
  return out.filter(legalBlock);
}

/** a battle priority window: pass, battle-timed plays, ambush, discardMe,
 * augments, cached / bin plays, spell tokens, activated abilities */
function legalBattlePriorityActions(e: E, seat: Seat): Action[] {
  const b = e.s.battle!;
  const out: Action[] = [];
  out.push({ type: 'passPriority', seat });
  const hand = e.player(seat).hand;
  hand.forEach((name, i) => {
    const c = getCard(name);
    if (c.timing === 'battle' && !c.noPlayFromHand   // R100
      && e.canPayCard(seat, name) && castable(e, c, b.region, seat)) {
      out.push({ type: 'playCard', seat, handIndex: i });
    }
    if (c.ambush && canPayAmbush(e, seat, c)
      && e.targetCandidates({ what: 'allyUnit', prompt: '' }, b.region, undefined, seat).length > 0) {
      out.push({ type: 'playCard', seat, handIndex: i, mode: 'ambush' });
    }
    // R40: a "Discard me" line whose own marker makes it battle timing (Nothyr)
    // R65: discarding is not playing — every "Discard me" line works at
    // instant speed, whatever the card's own timing says
    if (c.discardMe && canPayDiscardMe(e, seat, c)) {
      out.push({ type: 'playCard', seat, handIndex: i, mode: 'discardMe' });
    }
  });
  // R95: the battle AUGMENT window, hand and bin together. It used to be a
  // `c.virus && from === 'hand'` clause inside the hand walk above; there
  // was no bin leg at all, which is why Rook's whole text was unreachable
  // even though bin-augmenting is fully plumbed for deployment.
  pushBattleAugments(e, seat, b.region, out);
  pushCachedPlays(e, seat, t => t === 'battle', b.region, out);
  pushBinPlays(e, seat, b.region, out);   // R96
  for (const t of e.tokensOf(seat, b.region)) out.push({ type: 'castSpellToken', seat, entityId: t.id });
  pushActivatedOptions(e, seat, b.region, out);
  return out;
}

/** the deployment phase (simultaneous — see the dispatcher's note) */
function legalDeployActions(e: E, seat: Seat): Action[] {
  const out: Action[] = [];
  const region = e.homeRegion(seat);
  out.push({ type: 'doneDeploying', seat });
  e.player(seat).hand.forEach((name, i) => {
    const c = getCard(name);
    if (timingAllowsDeploy(c) && !c.noPlayFromHand   // R100
      && e.canPayCard(seat, name) && castable(e, c, region, seat)) {
      out.push({ type: 'playCard', seat, handIndex: i });
    }
    // R40: the "Discard me" mode (Dropslime) — a deployment action unless
    // its own cost line carries a {Battle} marker
    if (c.discardMe && (c.discardMe.timing ?? c.timing) !== 'battle' && canPayDiscardMe(e, seat, c)) {
      out.push({ type: 'playCard', seat, handIndex: i, mode: 'discardMe' });
    }
  });
  // R42: prophesying is a deployment action, and the banner cost is plain
  // mana — no affinity pips, so this checks openMana rather than canPayCard.
  // 'bin' only for a card that says it may be (Angel of Anguish).
  for (const from of ['hand', 'bin'] as const) {
    e.player(seat)[from].forEach((name, i) => {
      const c = getCard(name);
      if (!c.prophecy) return;
      if (from === 'bin' && !c.prophesyFromBin) return;
      if (e.openMana(seat) < c.prophecy.mana) return;
      out.push({ type: 'prophesy', seat, from, index: i });
    });
  }
  // R42/R45: releasing a permitted cached card at deployment timing
  pushCachedPlays(e, seat, t => t === 'deploy' || t === 'haste', region, out);
  // R41: mods may come from the cache as well as hand and bin
  pushMods(e, seat, region, out);
  for (const t of e.tokensOf(seat, region)) {
    if (timingAllowsDeploy(getCard(t.card))) out.push({ type: 'castSpellToken', seat, entityId: t.id });
  }
  pushActivatedOptions(e, seat, region, out);
  return out;
}

/**
 * R42/R45: the cached cards `seat` may release right now, at `timing`.
 *
 * Offered ONLY with permission — a fulfilled prophecy or a live glimpse stamp
 * (E.cachePermission). Mirrors the hand's own gate: the timing has to match
 * (a cached unit still needs deployment), the mana has to be there (free via
 * a prophecy, printed cost via a glimpse; affinity is ignored on both paths),
 * and a targeted cast still needs a candidate.
 */
/**
 * R95: every legal battle-window AUGMENT for `seat`, hand and bin.
 *
 * Routes through `battleAugmentAllowed`, the SAME predicate `doAugment`
 * enforces — the fuzzer checks that `legalActions` never offers something
 * `apply` refuses, and a permission with two implementations is precisely how
 * that check gets tripped.
 *
 * The cache is deliberately not walked: no card grants a battle-window
 * permission out of it (Rook prints "hand and bin"), and the zone list lives
 * in the granting card, so a future card that does want the cache needs no
 * change here.
 */
/**
 * R96: every legal bin play for `seat` right now. Shaped on `pushCachedPlays`,
 * and routed through the SAME `E.mayPlaySpellsFromBin` predicate `doPlayFromBin`
 * enforces — the fuzzer asserts legalActions never offers what apply refuses,
 * and this class of split has already been caught once.
 */
function pushBinPlays(e: E, seat: Seat, region: number, out: Action[]): void {
  if (!e.mayPlaySpellsFromBin(seat, region)) return;
  e.player(seat).bin.forEach((name, i) => {
    const c = getCard(name);
    if (!binPlayable(c)) return;
    // R42/R45: printed timing applies, so the battle window offers {Battle}
    // spells only (see doPlayFromBin's note).
    if (c.timing !== 'battle') return;
    if (!e.canPayCard(seat, name)) return;
    if (!castable(e, c, region, seat, 'bin')) return;
    out.push({ type: 'playFromBin', seat, binIndex: i });
  });
}

function pushBattleAugments(e: E, seat: Seat, region: number, out: Action[]): void {
  for (const from of ['hand', 'bin'] as const) {
    e.player(seat)[from].forEach((name, i) => {
      if (!isAugment(name)) return;
      const c = getCard(name);
      if (!battleAugmentAllowed(e, seat, c, from, region)) return;
      if (!e.canPayCard(seat, name, { purpose: 'mod' })) return;
      for (const host of e.unitsIn(region)) {
        out.push({ type: 'augment', seat, from, index: i, hostId: host.id });
      }
      // R79: and onto a spell on the stack — either player's
      for (const it of e.s.stack) {
        if (!STACK_VIRUS_HOSTS.has(it.kind) || it.region !== region) continue;
        out.push({ type: 'augment', seat, from, index: i, hostStack: it.id });
      }
    });
  }
}

/**
 * R41: every mod `seat` may apply into `region` right now — augments and
 * grafts, out of hand, bin and cache.
 *
 * ONE walk, shared by the deployment offer and (through `gate`) by the R18
 * haste-step offer, because "as if it was deployment" is exactly a claim that
 * the two lists are the same list. Extracted rather than copied for the reason
 * `battleAugmentAllowed` is one predicate: the fuzzer checks that legalActions
 * never offers what apply refuses, and a second copy of a mod-offer walk is
 * how that check gets tripped. The push ORDER is unchanged from the
 * deployment-only version — the UI and the fuzzer index into this list.
 *
 * `gate` is the per-card permission question. Deployment asks nothing (a mod
 * is a deployment action by default); the haste step asks R95's haste sibling
 * about each card, since the grant is per-card by construction ("other mods").
 */
function pushMods(e: E, seat: Seat, region: number, out: Action[],
  gate: (c: CardDef, from: ModZone, kind: 'augment' | 'graft') => boolean = () => true): void {
  for (const from of ['hand', 'bin', 'cache'] as const) {
    const names = from === 'cache' ? e.cache(seat).map(cc => cc.card) : e.player(seat)[from];
    names.forEach((name, i) => {
      // a fulfilled prophecy makes the mod free (R42); otherwise pay normally
      const affordable = modIsFree(e, seat, from, i) || e.canPayCard(seat, name, { purpose: 'mod' });
      if (!getCard(name) || !affordable) return;
      const c = getCard(name);
      if (isAugment(name) && gate(c, from, 'augment')) {
        for (const host of e.unitsOf(seat, region)) out.push({ type: 'augment', seat, from, index: i, hostId: host.id });
        // R89: and the spell tokens standing in the same region. This is the
        // line whose absence made the ruling invisible — R79 shipped the
        // stack half and `legalActions` never offered it either, which is
        // precisely how it stayed unreachable for a whole round.
        for (const host of e.tokensOf(seat, region)) {
          out.push({ type: 'augment', seat, from, index: i, hostId: host.id });
        }
      }
      if (isGraftable(name) && gate(c, from, 'graft')) {
        for (const host of e.unitsOf(seat, region)) {
          if (graftCauseIndex(host.card) < 0) continue;
          for (let p = 0; p <= host.mods.length; p++) {
            out.push({ type: 'graft', seat, from, index: i, hostId: host.id, position: p });
          }
        }
      }
    });
  }
}

/**
 * R95 (haste sibling), offer gate 2 of the three: every mod `seat` may apply
 * during the R18 haste step. Shaped on `pushBattleAugments` and routed through
 * the SAME `hasteModAllowed` predicate `doAugment` and `doGraft` enforce.
 *
 * Hand, bin AND cache, for both kinds, because "as if it was deployment"
 * grants whatever deployment grants and deployment walks all three (R41).
 * Unlike Rook — which prints "from hand and bin" and so refuses the cache in
 * the CARD — Slurpr names no zone list at all.
 */
function pushHasteMods(e: E, seat: Seat, region: number, out: Action[]): void {
  pushMods(e, seat, region, out,
    (c, from, kind) => hasteModAllowed(e, seat, c, from, kind));
}

function pushCachedPlays(e: E, seat: Seat, allowed: (t: CardDef['timing']) => boolean, region: number, out: Action[]): void {
  e.cache(seat).forEach((cc, i) => {
    const via = e.cachePermission(seat, i);
    if (!via) return;
    if (!allowed(e.cachedTiming(seat, i, via))) return;
    if (via === 'glimpse' && !e.canPayManaOnly(seat, cc.card)) return;
    if (!castable(e, e.card(cc.card), region, seat, 'cache')) return;
    out.push({ type: 'playCached', seat, index: i });
  });
}

function pushActivatedOptions(e: E, seat: Seat, region: number, out: Action[]): void {
  const battle = e.s.phase === 'battle';
  for (const u of e.unitsOf(seat, region)) {
    if (e.abilitiesSuppressed(u)) continue;                     // R62
    const offer = (list: ReturnType<typeof getCard>['abilities'], prefix: 'ability' | 'augment',
      budgetCard: CardName, via?: ActivateVia) => {
      (list ?? []).forEach((ab, i) => {
        if (ab.type !== 'activated') return;
        // R49: a per-ability {Battle}/{Deployment} marker, and the full
        // activation cost (life, discard, sacrifice-another, debt) as a gate
        if (ab.timing !== undefined && ab.timing !== (battle ? 'battle' : 'deploy')) return;
        if (!canPayAbilityCost(e, seat, ab.cost, u, region)) return;
        if (ab.bounded && (u.budgets[`${prefix}:${budgetCard}#${i}`] ?? 0) > 0) return;
        if (abilityUnusable(e, seat, ab, u, region)) return;                     // R64/R77
        out.push({ type: 'activateAbility', seat, entityId: u.id, abilityIndex: i, ...(via ? { via } : {}) });
      });
    };
    // R118 layer 0: the activated text comes off the FACES the unit is
    // wearing, not off `u.card`. `facesWith` puts the IDENTITY face first (the
    // copied card for Apex Prime / Borrower of Forms, the unit's own card
    // otherwise) and then whatever is being projected onto it right now
    // (Ancient One's adjacent allies, and the cards augmented onto them).
    //
    // The identity face keeps the two `via` shapes it has always had —
    // undefined and 'augment' — so a pre-R118 action log replays unchanged;
    // every other face is addressed by `{ face }`. `activationSource` resolves
    // the same list from the same call, and the two MUST agree action for
    // action: the fuzzer's "legalActions lied" invariant is the guard, and
    // this class of split has already been caught here once.
    const idFace = e.faceName(u);
    for (const face of e.facesWith(u, 'activated')) {
      const own = face === idFace;
      offer(getCard(face).abilities, 'ability', face, own ? undefined : { face });
      // a card's own [Augment] text is active when played normally (Manual Q&A)
      offer(getCard(face).augmentText, 'augment', face,
        own ? 'augment' : { face, text: 'augment' });
    }
    // activated abilities donated by augment mods (controller of the unit controls its mods)
    for (const modId of u.mods) {
      const mod = e.entity(modId);
      if (mod && mod.appliedAs === 'augment') {
        offer(getCard(mod.card).augmentText, 'augment', mod.card, { mod: modId });
      }
    }
  }
}

function permutations(n: number): number[][] {
  if (n > 5) throw new Error('permutations() is for small sets — callers cap n');
  const out: number[][] = [];
  const rec = (acc: number[], rest: number[]) => {
    if (!rest.length) { out.push(acc); return; }
    for (let i = 0; i < rest.length; i++) rec([...acc, rest[i]!], rest.filter((_, j) => j !== i));
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}
