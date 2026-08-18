/* The public reducer: apply(state, action) -> { state, events, pendingDecisions }
 * plus legalActions(state, seat) and createGame(seed).
 *
 * apply() clones the state, dispatches through E, and catches the control
 * signals. It never mutates its input; on IllegalAction it throws and the
 * caller keeps the old state.
 */
import type {
  Action, ApplyResult, CardName, Decision, EffectPart, Element, EntityId, GameMode, GameState,
  ResourceKind, Seat, StackItem, TargetRef,
} from './types.ts';
import { E, GameEnded, IllegalAction, Suspended, other } from './engine.ts';
import {
  affinityPips, effectByKey, getCard, graftCauseIndex, isAugment, isGraftable,
  type CardDef,
} from './cards/dsl.ts';
import { DECK_LIST, draftDeckList } from './cards/registry.ts';
import { rngShuffle, rngNext } from './rng.ts';

export { IllegalAction };

const ELEMENTS: ResourceKind[] = ['fire', 'water', 'earth', 'wood', 'metal'];

// ── game creation ─────────────────────────────────────────────────────

export const ALL_ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal'];

/** the default trio when none is chosen (the first fully-scripted one) */
export const DRAFT_TRIO: Element[] = ['fire', 'water', 'earth'];

/** Sanitize a requested draft trio: exactly 3 distinct real elements, in
 * canonical order — anything else falls back to the default trio. */
export function sanitizeTrio(els: unknown): Element[] {
  if (!Array.isArray(els)) return [...DRAFT_TRIO];
  const picked = ALL_ELEMENTS.filter(e => els.includes(e));
  return picked.length === 3 ? picked : [...DRAFT_TRIO];
}

export function createGame(
  seed: number,
  names: [string, string] = ['Player 1', 'Player 2'],
  mode: GameMode = 'shared',
  draftElements?: Element[],
): ApplyResult {
  let rngState = seed >>> 0;
  const trio = sanitizeTrio(draftElements ?? DRAFT_TRIO);
  const deckCards: CardName[] = [];
  if (mode === 'draft') {
    // the physical live-draft deck: one copy of each card of the chosen trio
    // (54 per element + 5 per hybrid pair = 177 for a trio)
    deckCards.push(...draftDeckList(trio));
  } else {
    for (const n of DECK_LIST) deckCards.push(n, n);
  }
  let deck: CardName[];
  [deck, rngState] = rngShuffle(deckCards, rngState);
  let initRoll: number;
  [initRoll, rngState] = rngNext(rngState);

  const state: GameState = {
    seed, rngState, actionCount: 0, turn: 0, phase: 'planning',
    initiative: initRoll < 0.5 ? 0 : 1, winner: null, nextId: 1,
    mode, packs: [[], []], draftDone: null, seenHand: [null, null],
    elements: mode === 'draft' ? trio : [...ALL_ELEMENTS],
    sharedDeck: deck,
    players: names.map((name, seat) => ({
      seat, name, life: 30, hand: [], bin: [],
      // starting Prismites are dealt face-down (Manual: "they start dormant");
      // they typically receive turn 1's two activations
      resources: [
        { kind: 'prismite', state: 'dormant' },
        { kind: 'prismite', state: 'dormant' },
      ],
      activationsLeft: 2,
    })),
    regions: [0, 1].map(owner => ({ owner, presentSeats: [owner] })),
    entities: {}, stack: [], battle: null, battleRound: 0,
    battleCounters: [{}, {}], priority: null, passes: 0,
    planningDone: [false, false], hasteDone: null, deployDone: null, deployPlayer: null,
    triggerQueue: [], triggerOrderedSeats: [], suspension: null, decision: null,
  };
  const e = new E(state);
  if (mode === 'draft') {
    // Manual p.16: opening hand (4) is dealt together with turn 1's draws (2),
    // then each player gets a pack of 10 — clockwise from initiative.
    for (const seat of e.dealOrder()) e.draw(seat, 6, true);
    e.dealPacks();
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

/** Replay = seed + action log (docs/04 §1). */
export function replay(seed: number, actions: Action[], names?: [string, string], mode?: GameMode, draftElements?: Element[]): ApplyResult {
  let r = createGame(seed, names, mode, draftElements);
  for (const a of actions) r = { ...apply(r.state, a), events: r.events };
  return r;
}

// ── dispatch ──────────────────────────────────────────────────────────

function dispatch(e: E, action: Action): void {
  if (e.s.decision && action.type !== 'decide') {
    e.illegal(`a decision is pending for ${e.pname(e.s.decision.seat)}`);
  }
  switch (action.type) {
    case 'recycleForResource': return doRecycle(e, action.seat, action.handIndex, action.element);
    case 'activateResource': return doActivateResource(e, action.seat, action.index);
    case 'exchangePrismite': return doExchangePrismite(e, action.seat, action.index, action.element);
    case 'donePlanning': return doDonePlanning(e, action.seat);
    case 'draftCommit': return doDraftCommit(e, action.seat, action.packIndices);
    case 'doneHaste': return doDoneHaste(e, action.seat);
    case 'playCard': return doPlayCard(e, action.seat, action.handIndex, action.mode);
    case 'castSpellToken': return doCastSpellToken(e, action.seat, action.entityId);
    case 'activateAbility': return doActivateAbility(e, action.seat, action.entityId, action.abilityIndex, action.via);
    case 'augment': return doAugment(e, action.seat, action.from, action.index, action.hostId);
    case 'graft': return doGraft(e, action.seat, action.from, action.index, action.hostId, action.position);
    case 'declareAttack': return doDeclareAttack(e, action.seat, action.columns, action.spellTokens ?? []);
    case 'declareBlocks': return doDeclareBlocks(e, action.seat, action.blocks, action.send ?? []);
    case 'passPriority': return e.passPriority(action.seat);
    case 'doneDeploying': return doDoneDeploying(e, action.seat);
    case 'decide': return doDecide(e, action.seat, action.choice);
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
  // this hand just mixed with a pack — anything the opponent SAW of it is stale
  e.s.seenHand[other(seat)] = null;
  e.s.draftDone[seat] = true;
  e.ev('draft', `${e.pname(seat)} finishes drafting and passes their pack.`, { seat });
  if (e.s.draftDone.every(Boolean)) e.passPacks();
}

function doRecycle(e: E, seat: Seat, handIndex: number, element: ResourceKind): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.need((e.s.elements as string[]).includes(element), 'not an element of this game');
  const card = e.player(seat).hand[handIndex];
  e.need(card !== undefined, 'no such card in hand');
  e.player(seat).hand.splice(handIndex, 1);
  e.recycleToBottom(card);
  e.player(seat).resources.push({ kind: element, state: 'dormant' });
  e.ev('recycle', `${e.pname(seat)} recycles ${card} for a dormant resource.`, { seat });
}

function doActivateResource(e: E, seat: Seat, index: number): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  const r = e.player(seat).resources[index];
  e.need(r && r.state === 'dormant', 'not a dormant resource');
  e.need(e.player(seat).activationsLeft > 0, 'max 2 activations per turn');
  r.state = 'open';
  e.player(seat).activationsLeft--;
  e.ev('resourceActivated', `${e.pname(seat)} activates a ${r.kind} resource.`, { seat, kind: r.kind });
  maybeGrantShard(e, seat, r.kind);
}

/** Manual p.18 (Shards and Affinity Bonuses): "The elemental resources can
 * provide free Shards when they are activated if the player has at least
 * three affinity towards that resource." The shard arrives dormant like any
 * created resource and gives no affinity — mana only. */
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
  e.need((e.s.elements as string[]).includes(element), 'not an element of this game');
  const r = e.player(seat).resources[index];
  e.need(r && r.kind === 'prismite', 'not a prismite');
  // only ACTIVE (face-up) prismites can be exchanged (Manual p.18) — the
  // new resource keeps the prismite's state (expended stays expended)
  e.need(r.state !== 'dormant', 'a dormant prismite cannot be exchanged');
  r.kind = element;
  e.ev('resourceActivated', `${e.pname(seat)} exchanges a Prismite for a ${element} resource.`, { seat, kind: element });
  // the exchange turns an already-activated resource into this element, so
  // the p.18 shard bonus applies just as if it had been activated as one
  maybeGrantShard(e, seat, element);
}

function doDonePlanning(e: E, seat: Seat): void {
  e.need(e.s.phase === 'planning' && !e.s.planningDone[seat], 'not your planning');
  e.need(!e.draftPending(seat), 'finish drafting first');
  e.s.planningDone[seat] = true;
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

/** targeted casts need at least one candidate up front */
function castable(e: E, c: CardDef, region: number, seat: Seat): boolean {
  if (!c.spellEffect?.targets) return true;
  return e.targetCandidates(c.spellEffect.targets, region, undefined, seat).length > 0;
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

function baseItem(e: E, c: CardDef, seat: Seat, region: number): StackItem {
  const parts: EffectPart[] = c.spellEffect ? [{ effectKey: `spell:${c.name}`, targets: [] }] : [];
  return {
    id: e.s.nextId++, kind: c.kind, card: c.name, label: c.name,
    controller: seat, region, negated: false, parts,
  };
}

function doPlayCard(e: E, seat: Seat, handIndex: number, mode?: 'ambush'): void {
  const name = e.player(seat).hand[handIndex];
  e.need(name !== undefined, 'no such card in hand');
  const c = e.card(name);
  if (mode === 'ambush') return doAmbush(e, seat, handIndex, c);
  e.need(e.canPayCard(seat, name), 'cannot pay for that');
  if (e.s.phase === 'planning') {
    // haste step (R18): only haste cards, resolving immediately
    e.need(e.s.hasteDone !== null && !e.s.hasteDone[seat], 'not your haste step');
    e.need(c.timing === 'haste', 'only haste cards during the haste step');
    const region = e.homeRegion(seat);
    e.need(castable(e, c, region, seat), 'no legal targets');
    e.player(seat).hand.splice(handIndex, 1);
    e.payCard(seat, name);
    e.castChain([baseItem(e, c, seat, region)], 'resolve');
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(timingAllowsDeploy(c), 'battle cards can only be played during battle');
    const region = e.homeRegion(seat);
    e.need(castable(e, c, region, seat), 'no legal targets');
    e.player(seat).hand.splice(handIndex, 1);
    e.payCard(seat, name);
    e.castChain([baseItem(e, c, seat, region)], 'resolve');
  } else if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(c.timing === 'battle', 'only battle cards can be played now');
    const region = e.s.battle!.region;
    e.need(castable(e, c, region, seat), 'no legal targets');
    e.player(seat).hand.splice(handIndex, 1);
    e.payCard(seat, name);
    e.castChain([baseItem(e, c, seat, region)], 'push');
    e.settle();
  } else {
    e.illegal('cards are played during deployment or battle');
  }
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
  };
  e.need(e.targetCandidates({ what: 'allyUnit', prompt: '' }, region, undefined, seat).length > 0,
    'no ally to ambush');
  e.player(seat).hand.splice(handIndex, 1);
  e.payMana(seat, c.ambush!.mana);
  e.castChain([item], 'push');
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
  // Burst: all your burst tokens here are cast at once (deterministic id order)
  const group = c.burst
    ? e.tokensOf(seat, tok.region).filter(t => e.card(t.card).burst).sort((a, z) => a.id - z.id)
    : [tok];
  const items: StackItem[] = [];
  for (const t of group) {
    delete e.s.entities[t.id];
    const item = baseItem(e, e.card(t.card), seat, region);
    item.kind = 'spellToken';
    item.x = t.x;
    item.label = `${t.card} ${t.x ?? ''}`.trim();
    items.push(item);
  }
  e.castChain(items, then);
  e.settle();
}

/** resolve which ability list an activateAbility action refers to (see Action.via) */
function activationSource(e: E, u: { card: CardName; id: EntityId; mods: EntityId[] }, via?: 'augment' | { mod: EntityId }):
  { list: ReturnType<typeof getCard>['abilities']; prefix: 'ability' | 'augment'; viaCard?: CardName } {
  if (via === undefined) return { list: getCard(u.card).abilities, prefix: 'ability' };
  if (via === 'augment') return { list: getCard(u.card).augmentText, prefix: 'augment', viaCard: u.card };
  const mod = e.entity(via.mod);
  e.need(mod && mod.appliedAs === 'augment' && mod.modOf === u.id, 'no such augment on that unit');
  return { list: getCard(mod.card).augmentText, prefix: 'augment', viaCard: mod.card };
}

function doActivateAbility(e: E, seat: Seat, entityId: EntityId, abilityIndex: number, via?: 'augment' | { mod: EntityId }): void {
  const u = e.entity(entityId);
  e.need(u && u.kind === 'unit' && u.controller === seat && !u.absent, 'not your unit');
  const { list, prefix, viaCard } = activationSource(e, u, via);
  const ability = list?.[abilityIndex];
  e.need(ability && ability.type === 'activated', 'no such activated ability');
  let region: number;
  let then: 'push' | 'resolve';
  if (e.s.phase === 'battle') {
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(u.region === e.s.battle!.region, 'that unit is in another region');
    region = u.region; then = 'push';
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(u.region === e.homeRegion(seat), 'that unit is in another region');
    region = u.region; then = 'resolve';
  } else {
    e.illegal('abilities are activated during battle or deployment');
  }
  const mana = ability.cost.mana ?? 0;
  e.need(e.openMana(seat) >= mana, 'cannot pay the mana cost');
  // compose BEFORE paying costs: a spent bounded cause makes this illegal
  const parts = e.composeParts(u, abilityIndex, prefix, viaCard);
  e.need(parts, 'that ability was already used this turn');
  e.payMana(seat, mana);
  if (ability.cost.sacrificeSelf) e.destroy(u, 'is sacrificed');   // cost, not respondable
  const srcCard = viaCard ?? u.card;
  const item: StackItem = {
    id: e.s.nextId++, kind: 'activated', card: srcCard,
    label: `${srcCard === u.card ? u.card : `${srcCard} (on ${u.card})`}: ${ability.label}`,
    controller: seat, region,
    negated: false, parts, sourceId: u.id, event: null,
  };
  e.castChain([item], then);
  e.settle();
}

// ── mods ──────────────────────────────────────────────────────────────

function doAugment(e: E, seat: Seat, from: 'hand' | 'bin', index: number, hostId: EntityId): void {
  const name = e.player(seat)[from][index];
  e.need(name !== undefined, `no such card in ${from}`);
  const c = e.card(name);
  e.need(isAugment(name), 'that card is not an augment');
  e.need(e.canPayCard(seat, name), 'cannot pay for that');
  const host = e.entity(hostId);
  e.need(host && host.kind === 'unit' && !host.absent, 'no such unit');

  if (e.s.phase === 'battle') {
    // Virus: an augment playable from hand during battle, on the stack
    e.need(c.virus && from === 'hand', 'only Virus cards can augment from hand during battle');
    e.need(e.s.priority === seat, 'you do not have priority');
    e.need(host.region === e.s.battle!.region, 'that unit is in another region');
    e.player(seat).hand.splice(index, 1);
    e.payCard(seat, name);
    const item: StackItem = {
      id: e.s.nextId++, kind: 'virus', card: name,
      label: `${name} (Virus augment on ${host.card})`, controller: seat,
      region: host.region, negated: false, parts: [], hostId: host.id,
    };
    const ev = e.ev('targeted', `${name} targets ${host.card}.`, { unit: host.id, region: host.region });
    e.fireEvent('targeted', ev);
    e.pushItem(item);
    e.settle();
  } else if (e.s.phase === 'deploy') {
    e.need(e.deploying(seat), 'not your deployment');
    e.need(host.region === e.homeRegion(seat), 'you can only mod units in your region');
    e.player(seat)[from].splice(index, 1);
    e.payCard(seat, name);
    const ev = e.ev('targeted', `${name} targets ${host.card}.`, { unit: host.id, region: host.region });
    e.fireEvent('targeted', ev);
    e.attachMod(host, name, seat, 'augment');
    e.settle();
  } else {
    e.illegal('modding is a deployment action (or a battle Virus)');
  }
}

function doGraft(e: E, seat: Seat, from: 'hand' | 'bin', index: number, hostId: EntityId, position: number): void {
  e.need(e.deploying(seat), 'grafting is a deployment action');
  const name = e.player(seat)[from][index];
  e.need(name !== undefined, `no such card in ${from}`);
  e.need(isGraftable(name), 'that card has no graft symbol');
  const host = e.entity(hostId);
  e.need(host && host.kind === 'unit' && !host.absent, 'no such unit');
  e.need(host.region === e.homeRegion(seat), 'you can only mod units in your region');
  // both cards must carry the graft symbol: the host needs its own graft cause
  e.need(graftCauseIndex(host.card) >= 0, 'the target has no graft cause');
  e.need(e.canPayCard(seat, name), 'cannot pay for that');
  // new grafts insert anywhere below the base card, never reorder the rest
  e.need(Number.isInteger(position) && position >= 0 && position <= host.mods.length, 'bad graft position');
  e.player(seat)[from].splice(index, 1);
  e.payCard(seat, name);
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
      used.add(id);
    }
  }
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
    const t = e.entity(id);
    e.need(t && t.kind === 'spellToken' && t.controller === seat && t.region === fromRegion, 'not your spell token');
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
  for (const id of columns.flat()) {
    const u = e.entity(id);
    if (!u) continue;
    const uev = e.ev('attacked', `${u.card} attacks.`, { unit: id, region: b.region, seat });
    e.fireEvent('attacked', uev);
  }
  e.openPriority('attackWindow');
  e.settle();
}

function doDeclareBlocks(e: E, seat: Seat, blocks: Record<number, EntityId[]>, send: EntityId[]): void {
  const b = e.s.battle;
  e.need(e.s.phase === 'battle' && b && b.step === 'blocks' && seat === b.defender, 'not your block step');
  const used = new Set<EntityId>();
  // R20: a lone Sneaky attacker (the only attacking unit) cannot be blocked
  const atkUnits = b.columns.flat().filter(id => e.entity(id));
  if (atkUnits.length === 1 && e.colAttrs(atkUnits).has('Sneaky')) {
    e.need(Object.keys(blocks).length === 0, 'a lone Sneaky attacker cannot be blocked');
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
      // Feeble: can't block (own/augment attrs — a Feeble unit never joins a blocking column)
      e.need(!e.ownAttrs(u).has('Feeble'), 'Feeble units cannot block');
      used.add(id);
    }
    const atkAttrs = e.colAttrs(atkCol.filter(id => e.entity(id)));
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
    e.need(t.region === b.region, 'that is in another region');
    e.need(!used.has(id), 'blockers cannot also be sent to attack');
    used.add(id);
    if (t.kind === 'unit') sentUnits++;
  }
  e.need(send.length === 0 || sentUnits > 0, 'spell tokens travel only with units');

  b.blocks = {};
  for (const [ciStr, col] of Object.entries(blocks)) b.blocks[Number(ciStr)] = col.slice();
  for (const id of send) e.entity(id)!.absent = true;
  b.sentAttackers = send.slice();
  const ev = e.ev('blocksDeclared',
    `${e.pname(seat)} blocks ${Object.keys(blocks).length} column(s)` +
    (send.length ? ` and sends ${send.length} counterattacker(s)` : '') + '.',
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
    const val = dec.options[choice]!.value as TargetRef | { doneTargets: true };
    if (typeof val === 'object' && val !== null && 'doneTargets' in val) {
      sus.item.parts[sus.partIndex]!.targetsDone = true;
    } else {
      sus.item.parts[sus.partIndex]!.targets.push(val as TargetRef);
    }
    let chain = sus.moreItems;
    e.collectTargets(sus.item, sus.then, chain);   // may suspend again
    e.commitItem(sus.item, sus.then);
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

  // sus.type === 'resolve': fill the answer and replay the part
  e.need(typeof choice === 'number' && dec.options[choice], 'bad choice');
  sus.answers[sus.pendingKey] = dec.options[choice]!.value;
  e.resolveParts(sus.item, sus.partIndex, sus.answers);
  e.afterParts(sus.item);
  e.finishResolutionTail();
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
      .filter(u => !b.attackerPool || b.attackerPool.includes(u.id));
    if (!eligible.length) return { type: 'declareAttack', seat: b.attacker, columns: [] };
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
 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  const e = new E(structuredClone(state));   // E for queries only
  const out: Action[] = [];
  const s = e.s;
  if (s.phase === 'gameover') return out;

  if (s.decision) {
    if (s.decision.seat !== seat) return out;
    if (s.decision.pickOrder) {
      // small sets: every ordering; large sets: a representative pair
      // (like formations, apply() validates ANY permutation the UI builds)
      const n = s.decision.options.length;
      if (n <= 4) {
        for (const perm of permutations(n)) out.push({ type: 'decide', seat, choice: perm });
      } else {
        const identity = Array.from({ length: n }, (_, i) => i);
        out.push({ type: 'decide', seat, choice: identity });
        out.push({ type: 'decide', seat, choice: [...identity].reverse() });
      }
    } else {
      s.decision.options.forEach((_, i) => out.push({ type: 'decide', seat, choice: i }));
    }
    return out;
  }

  if (s.phase === 'planning' && s.hasteDone) {   // haste step (R18)
    if (s.hasteDone[seat]) return out;
    out.push({ type: 'doneHaste', seat });
    e.player(seat).hand.forEach((name, i) => {
      const c = getCard(name);
      if (c.timing === 'haste' && e.canPayCard(seat, name) && castable(e, c, e.homeRegion(seat), seat)) {
        out.push({ type: 'playCard', seat, handIndex: i });
      }
    });
    return out;
  }

  if (s.phase === 'planning' && !s.planningDone[seat]) {
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

  if (s.phase === 'battle' && s.battle) {
    const b = s.battle;
    if (b.step === 'declare' && seat === b.attacker) {
      out.push({ type: 'declareAttack', seat, columns: [] });
      const fromRegion = b.round === 1 || b.attackerPool === null ? e.homeRegion(seat) : b.region;
      const mine = e.unitsOf(seat, fromRegion).filter(u => !b.attackerPool || b.attackerPool.includes(u.id));
      for (const u of mine) out.push({ type: 'declareAttack', seat, columns: [[u.id]] });
      if (mine.length > 1) out.push({ type: 'declareAttack', seat, columns: mine.map(u => [u.id]) });
      return out;
    }
    if (b.step === 'blocks' && seat === b.defender) {
      out.push({ type: 'declareBlocks', seat, blocks: {} });
      const mine = e.unitsOf(seat, b.region);
      const blockers = mine.filter(u => !e.ownAttrs(u).has('Feeble'));   // Feeble can't block
      // R20: a lone Sneaky attacker cannot be blocked at all
      const atkUnits = b.columns.flat().filter(id => e.entity(id));
      const sneakyAlone = atkUnits.length === 1 && e.colAttrs(atkUnits).has('Sneaky');
      if (!sneakyAlone) b.columns.forEach((atkCol, ci) => {
        const atkAttrs = e.colAttrs(atkCol.filter(id => e.entity(id)));
        for (const u of blockers) {
          if (atkAttrs.has('Flying') && !e.colAttrs([u.id]).has('Flying')) continue;
          if (atkAttrs.has('Evasive')) continue;   // needs 2; single-blocker option invalid
          out.push({ type: 'declareBlocks', seat, blocks: { [ci]: [u.id] } });
        }
        if (atkAttrs.has('Evasive') || !atkAttrs.has('Flying')) {
          for (let i = 0; i < blockers.length; i++) {
            for (let j = i + 1; j < blockers.length; j++) {
              const pair = [blockers[i]!.id, blockers[j]!.id];
              if (atkAttrs.has('Flying') && !e.colAttrs(pair).has('Flying')) continue;
              out.push({ type: 'declareBlocks', seat, blocks: { [ci]: pair } });
            }
          }
        }
      });
      // send options (round 1 only — no counter-counterattacks):
      // each single non-blocking unit, representative
      if (b.round === 1) {
        for (const u of mine) out.push({ type: 'declareBlocks', seat, blocks: {}, send: [u.id] });
      }
      return out;
    }
    if (s.priority === seat) {
      out.push({ type: 'passPriority', seat });
      const hand = e.player(seat).hand;
      hand.forEach((name, i) => {
        const c = getCard(name);
        if (c.timing === 'battle' && e.canPayCard(seat, name) && castable(e, c, b.region, seat)) {
          out.push({ type: 'playCard', seat, handIndex: i });
        }
        if (c.ambush && canPayAmbush(e, seat, c)
          && e.targetCandidates({ what: 'allyUnit', prompt: '' }, b.region, undefined, seat).length > 0) {
          out.push({ type: 'playCard', seat, handIndex: i, mode: 'ambush' });
        }
        if (c.virus && isAugment(name) && e.canPayCard(seat, name)) {
          for (const host of e.unitsIn(b.region)) out.push({ type: 'augment', seat, from: 'hand', index: i, hostId: host.id });
        }
      });
      for (const t of e.tokensOf(seat, b.region)) out.push({ type: 'castSpellToken', seat, entityId: t.id });
      pushActivatedOptions(e, seat, b.region, out);
      return out;
    }
    return out;
  }

  // simultaneous deployment: EVERY not-yet-done seat gets its options (the
  // playtest bug: this still gated on the derived initiative-first
  // deployPlayer, so the other seat saw nothing playable until the first
  // finished — the engine accepted the plays, but they were never offered)
  if (e.deploying(seat)) {
    const region = e.homeRegion(seat);
    out.push({ type: 'doneDeploying', seat });
    e.player(seat).hand.forEach((name, i) => {
      const c = getCard(name);
      if (timingAllowsDeploy(c) && e.canPayCard(seat, name) && castable(e, c, region, seat)) {
        out.push({ type: 'playCard', seat, handIndex: i });
      }
    });
    for (const from of ['hand', 'bin'] as const) {
      e.player(seat)[from].forEach((name, i) => {
        if (!getCard(name) || !e.canPayCard(seat, name)) return;
        if (isAugment(name)) {
          for (const host of e.unitsOf(seat, region)) out.push({ type: 'augment', seat, from, index: i, hostId: host.id });
        }
        if (isGraftable(name)) {
          for (const host of e.unitsOf(seat, region)) {
            if (graftCauseIndex(host.card) < 0) continue;
            for (let p = 0; p <= host.mods.length; p++) {
              out.push({ type: 'graft', seat, from, index: i, hostId: host.id, position: p });
            }
          }
        }
      });
    }
    for (const t of e.tokensOf(seat, region)) {
      if (timingAllowsDeploy(getCard(t.card))) out.push({ type: 'castSpellToken', seat, entityId: t.id });
    }
    pushActivatedOptions(e, seat, region, out);
    return out;
  }

  return out;
}

function pushActivatedOptions(e: E, seat: Seat, region: number, out: Action[]): void {
  for (const u of e.unitsOf(seat, region)) {
    const offer = (list: ReturnType<typeof getCard>['abilities'], prefix: 'ability' | 'augment',
      budgetCard: CardName, via?: 'augment' | { mod: EntityId }) => {
      (list ?? []).forEach((ab, i) => {
        if (ab.type !== 'activated') return;
        if ((ab.cost.mana ?? 0) > e.openMana(seat)) return;
        if (ab.bounded && (u.budgets[`${prefix}:${budgetCard}#${i}`] ?? 0) > 0) return;
        out.push({ type: 'activateAbility', seat, entityId: u.id, abilityIndex: i, ...(via ? { via } : {}) });
      });
    };
    offer(getCard(u.card).abilities, 'ability', u.card);
    // a card's own [Augment] text is active when played normally (Manual Q&A)
    offer(getCard(u.card).augmentText, 'augment', u.card, 'augment');
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
