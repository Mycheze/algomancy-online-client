/* Core state / action / event / decision types for the Algomancy engine.
 *
 * Design contract (docs/04 §1):
 *   apply(state, action) -> { state, events, pendingDecisions }  — pure, no I/O.
 *   RNG state lives in GameState; seed + action log replays the whole game.
 *
 * 1v1 is the implemented format, but seats, regions and battle state are
 * arrays/indices so FFA and teams extend the model instead of rewriting it.
 */

export type Seat = number; // 0 | 1 in 1v1
export type EntityId = number;
export type CardName = string;

export type Element = 'fire' | 'water' | 'earth' | 'wood' | 'metal' | 'light' | 'dark';
/** 'shard': Manual p.18 — no affinity, still expendable for mana; granted
 * free when an element resource is activated at ≥3 affinity of its element */
export type ResourceKind = Element | 'prismite' | 'shard';

export type Phase = 'planning' | 'battle' | 'regroup' | 'deploy' | 'gameover';

/** 'shared' = the constructed-ish default (shared deck, draw 2, no packs);
 * 'draft' = live draft (Manual p.16-17): per-player 10-card packs, a draft
 * step each planning phase, clockwise passing, N+1-turn pack refresh;
 * 'constructed' = real constructed (Manual "Constructed"): per-player decks
 * brought to the game (30+ cards, max 2 copies), draw phase = draw 4 then
 * put 2 back on the bottom of your own deck. */
export type GameMode = 'shared' | 'draft' | 'constructed';

export type Attr =
  | 'Flying' | 'Deadly' | 'Swift' | 'Sluggish' | 'Tough' | 'Balanced'
  | 'Inverted' | 'Unaware' | 'Powerful' | 'Vulnerable' | 'Feeble' | 'Evasive'
  | 'Sneaky' | 'Alluring' | 'Piercing' | 'Electric' | 'Poisonous' | 'Resonant'
  | 'Thieving' | 'Reaping'
  // Light & Dark
  | 'Blessed' | 'Afflicting' | 'Lethal' | 'Pure' | 'Modular';

export interface ResourceState {
  kind: ResourceKind;
  state: 'dormant' | 'open' | 'expended';
}

/**
 * R42/R43/R44: a prophecy riding on a cached card — either the printed banner
 * paid for with the `prophesy` action, or one GRANTED by another card's rules
 * text ("It gains 'Prophecy — One Battle Passes'").
 *
 * `turn`/`battles` are the forward-counting anchors: R43 says a condition
 * counts from the moment of prophesying, never backwards, so the stamps are
 * taken when the card is cached and every counting condition reads the delta.
 */
export interface CachedProphecy {
  /** the condition as printed/granted, kept verbatim for the log and the UI */
  condition: string;
  /** the normalised, machine-readable form the condition table matches on
   * (see engine.ts normalizeProphecy / PROPHECY_RULES) */
  norm: string;
  /** R42: a TRAILING "[Haste]" on the banner (Divine Intervention) is a timing
   * marker on the RELEASE, not part of the condition — the card is played out
   * of cache in that step instead of at its printed timing. */
  release?: 'haste';
  /** R43: the turn this was prophesied on ("Two Turns Pass" = turn + 2) */
  turn: number;
  /** R43: battles completed before this was prophesied ("One Battle Passes") */
  battles: number;
  /** R44: fulfilment LATCHES — once true it never goes back to false, even if
   * the state that fulfilled it goes away. */
  fulfilled?: boolean;
}

/**
 * R41: one card sitting in a player's cache — "a neutral zone like the hand
 * and bin" (Caleb 2024-02-25). A bare CardName would not do: the zone carries
 * per-card metadata, because being in the cache is NOT by itself permission to
 * play the card. Permission comes from a fulfilled `prophecy` (free, ignoring
 * affinity) or from a glimpse-style `playableUntilTurn` stamp (pay the mana,
 * ignore affinity). A card with neither just sits there, indefinitely.
 *
 * The cache is PUBLIC information (R41), so nothing here is ever redacted.
 */
export interface CachedCard {
  card: CardName;
  /** A stable handle for TARGETING this entry (Prismatic Observer's "Recall up
   * to one target cached card"). Stamped from nextId when the card is cached,
   * because a cache INDEX is not stable: entries shift as cards are played,
   * grafted or recalled out of the zone, and a target has to be able to vanish
   * between cast and resolution. Optional/additive like the zone itself — an
   * entry from a state cached before this existed simply cannot be targeted. */
  uid?: number;
  /** R42: the prophecy attached as the card was cached, if any */
  prophecy?: CachedProphecy;
  /** R45 (glimpse): the last turn on which this may be played from cache.
   * Stored as a turn STAMP rather than cleared at end of turn — expiry is then
   * a comparison, so no cleanup pass can go missing on replay and the card
   * correctly stays in the cache, inert, afterwards. */
  playableUntilTurn?: number;
}

export interface PlayerState {
  seat: Seat;
  name: string;
  life: number;
  hand: CardName[];
  bin: CardName[];
  resources: ResourceState[];
  activationsLeft: number;
  /** R38 (Light & Dark): rot counters on the PLAYER. At the start of every
   * deployment you take damage equal to this; it never decays. Additive and
   * optional (like packMeta) so games serialized before the expansion still
   * load — read it through E.rot(seat), never raw. */
  rot?: number;
  /** R39 (Light & Dark): debt counters on the PLAYER. Paid off 1 mana each at
   * the very end of your resource step; the remainder carries over. Additive
   * and optional like `rot` — read it through E.debt(seat). */
  debt?: number;
  /** R41 (Light & Dark): the CACHE — a fourth zone beside hand, bin and deck.
   * Public information, so no server-side redaction applies to it. Additive
   * and optional like `rot`/`debt` so pre-expansion saved games still load —
   * read it through E.cache(seat), never raw. */
  cache?: CachedCard[];
}

export interface Region {
  owner: Seat;
  /** seats currently physically in this region (attackers enter, regroup returns them) */
  presentSeats: Seat[];
}

/** A unit, spell token, or mod card slid under a unit. */
export interface Entity {
  id: EntityId;
  card: CardName;
  owner: Seat;
  controller: Seat;
  kind: 'unit' | 'spellToken' | 'mod';
  region: number;
  damage: number;
  /** net counters: +1/+1 and -1/-1 cancel pairwise (Manual) */
  counters: number;
  tempPower: number;
  tempToughness: number;
  /** attributes granted "until regroup" (cleared with temp stats, R11 step 3) */
  tempAttrs?: Attr[];
  /** ordered mod stack; index 0 sits directly under the base card */
  mods: EntityId[];
  /** for kind 'mod': the host entity */
  modOf?: EntityId;
  /** how a mod was applied: augments grant attrs/text, grafts join the cause */
  appliedAs?: 'augment' | 'graft';
  /** spell token X value */
  x?: number;
  /** counterattacker sent during round-1 blocks: "treated as if it doesn't exist" */
  absent?: boolean;
  /** per-turn uses of bounded ([Switch1]/[once]) abilities, keyed by ability key (R9: per card) */
  budgets: Record<string, number>;
  /** unit token (erased on leaving play, survives regroup) */
  token?: boolean;
  tokenStats?: [number, number];
  /** the game turn this entity ARRIVED in play (GameState.turn at spawn time).
   * Additive/optional so states serialized before it still load — read it
   * through E.spawnedTurn(u), which answers undefined for an entity that
   * predates the field. Behind "erase all units that spawned this turn"
   * (Banishment) and "if I spawned this turn …". Mods carry it too; the field
   * is stamped by newEntity, so it is simply "when this entity was made". */
  spawnedTurn?: number;
}

// ── battle ────────────────────────────────────────────────────────────

export type BattleStep =
  | 'declare' | 'attackWindow' | 'blocks' | 'blockWindow' | 'afterWindow';

export interface BattleState {
  /** round 1: IT attacks into NIT's region; round 2: NIT (counter)attacks IT's region */
  round: 1 | 2;
  attacker: Seat;
  defender: Seat;
  region: number;
  step: BattleStep;
  /** attacking columns, each [frontId, backId?] */
  columns: EntityId[][];
  /** colIdx -> blocking column [frontId, backId?]. Key presence = sticky "blocked" flag. */
  blocks: Record<number, EntityId[]>;
  /** units NIT sent out at block time — they attack in round 2 (1v1 battle, Manual p.20-21) */
  sentAttackers: EntityId[];
  /** round 2 after a round-1 battle: only these ids may attack (null = unrestricted) */
  attackerPool: EntityId[] | null;
  /** an attack was declared (gates "after combat" triggers) */
  happened: boolean;
  /** combat damage in progress: the next sub-step to run ('after' = run the
   * after-combat tail). Triggers fired by a sub-step resolve IMMEDIATELY
   * (special actions, no priority — R3) before the next sub-step, so Swift
   * riders like Flowstone Arcanite land before normal damage. Survives
   * suspension: settle() resumes the pump once decisions drain. */
  damageStep?: 'Swift' | 'normal' | 'Sluggish' | 'after' | null;
}

// ── the stack ─────────────────────────────────────────────────────────

/** R41: a card sitting in someone's cache, addressed by its stable `uid`
 * (CachedCard.uid) rather than by index. The cache is PUBLIC information, so
 * BOTH players' caches are legal targets. */
export interface CachedRef { seat: Seat; uid: number }

export type TargetRef =
  | { unit: EntityId }
  | { player: Seat }
  | { stack: number }
  | { cached: CachedRef };

/**
 * One sub-effect of a stack item with its declared targets.
 * A plain spell has one part; a graft composite has base + one per graft mod,
 * top-to-bottom — the whole item resolves as ONE ability (Manual p.33).
 */
export interface EffectPart {
  /** registry lookup: which EffectDef runs (see cards/dsl.ts resolveEffectKey) */
  effectKey: string;
  targets: TargetRef[];
  /** multi-target spec: the caster said "done" before reaching the max */
  targetsDone?: boolean;
  /** the mod entity this part came from (bounded budget bookkeeping, R9) */
  fromMod?: EntityId;
  /** skip at resolution (bounded graft effect already used this turn, or a
   * cast-time [cost] that was unpayable / declined — R35) */
  spent?: boolean;
  /** receipt of the part's cast-time [cost] payment (R35): what was paid,
   * snapshotted at payment so the resolution can read it (e.g. Volatile
   * Toxicity's "X is the defense of the sacrificed unit"). One key per
   * CastCost kind; its PRESENCE is also how collectCastCosts knows the cost
   * is already settled and must not be charged twice on a replay. */
  costPaid?: {
    sacrificed?: { card: CardName; power: number; defense: number };
    /** 'payLife': the life actually paid (R49) */
    life?: number;
    /** 'gainDebt': the debt actually taken */
    debt?: number;
    /** 'discardCard': the cards discarded, in the order they were chosen */
    discarded?: CardName[];
  };
  /** {Modular}: the mods riding on this item, mirrored onto every part so the
   * resolution can read them out of EffectCtx (they are also on the item, for
   * the stack display) */
  mods?: CardName[];
}

export interface StackItem {
  id: number;
  kind: 'unit' | 'spell' | 'spellUnit' | 'spellToken' | 'virus' | 'triggered' | 'activated' | 'ambush';
  card?: CardName;
  label: string;
  controller: Seat;
  region: number;
  x?: number;
  negated: boolean;
  fizzled?: boolean;
  parts: EffectPart[];
  /** R35 + {Modular}: mods applied to this card AS IT WAS PLAYED (Spellbind).
   * They are an additional CAST COST — paid before the item reaches the stack
   * — so they ride on the stack with the spell and a copy would copy them
   * (Caleb 2025-02-07). A graftable mod also contributes its [Switch] effect
   * as an extra part, exactly like a graft under a unit's graft cause. */
  mods?: { card: CardName; from: 'hand' | 'bin' }[];
  /** {Modular}: the caster said "no more mods" (or had none to offer) — the
   * cast-time collector is resumable, so it needs the stop flag in state. */
  modsDone?: boolean;
  /** R49: the ZONE this card was played out of. Set by doPlayCard ('hand'),
   * doPlayCached ('cache') and any future play-from-bin action, and carried
   * into the 'spellPlayed' / 'spawned' events so "when you play a card from
   * anywhere other than your hand" (Proph, Stalwart Sentinel) is a field read
   * rather than a log scan. Absent on items that are not a played card
   * (triggers, activations, spell tokens created in play). */
  from?: 'hand' | 'cache' | 'bin';
  /** R49: non-mana ACTIVATION costs that carry a CHOICE (which card to
   * discard, which unit to sacrifice), still to be paid. Collected in the cast
   * window — before the item reaches the stack — so nobody may respond between
   * an activation's cost and its effect. The choice-free costs (mana, life,
   * debt, sacrifice-self) are paid outright by doActivateAbility and never
   * appear here. Atoms are popped as they are paid; the list is deleted when
   * it empties. */
  pendingCosts?: { kind: 'discard' | 'sacrificeOther' | 'discardOrSacrifice'; n: number }[];
  /** R49: receipt of the item-level activation costs above */
  paidCosts?: { discarded?: CardName[]; sacrificed?: CardName[] };
  /** triggered/activated: source entity (may be gone by resolution) */
  sourceId?: EntityId;
  /** virus: host target */
  hostId?: EntityId;
  /** R1 event snapshot for triggered abilities (amounts still read live state) */
  event?: EngineEvent | null;
}

// ── decisions (docs/04 decision-point model) ──────────────────────────

export type DecisionKind =
  | 'targets'        // choose a target for a part of a pending cast/trigger
  | 'orderTriggers'  // order your simultaneous triggers (R2)
  | 'electricPath'   // choose next unit for electric excess (R4)
  | 'payOrDecline'   // "unless its controller pays [x]" (R6)
  | 'insertGraft';   // choose graft insert position (below base, Manual p.33)

export interface DecisionOption {
  label: string;
  /** payload the UI/fuzzer sends back as the choice */
  value: unknown;
  /** when the option IS a card (hand looks, deck tops, bin picks), its name —
   * the client renders the real scan instead of a text label */
  card?: CardName;
}

export interface Decision {
  id: number;
  seat: Seat;
  kind: DecisionKind;
  prompt: string;
  options: DecisionOption[];
  /** multi-pick decisions (orderTriggers) expect an array of option indices */
  pickOrder?: boolean;
}

/** Why the engine is paused, and how to resume. All serializable data. */
export type Suspension =
  | {
      /** collecting cast-time decisions for a stack-item-under-construction:
       * choose X (stage 'x'), apply a {Modular} mod (stage 'mods'), pay a
       * part's [cost] (stage 'cost'), or — the default, stage absent — pick a
       * target (R35: X, mods and bracketed costs are all chosen and paid AT
       * CAST, before the item reaches the stack) */
      type: 'cast';
      item: StackItem;
      partIndex: number;
      targetIndex: number;
      /** what to do once every part has targets */
      then: 'push' | 'resolve';
      /** rest of a multi-item cast chain (Burst tokens) */
      moreItems: StackItem[];
      /** 'itemCost' (R49): an ITEM-level activation cost that carries a choice
       * (StackItem.pendingCosts), as opposed to 'cost', which is a PART's
       * bracketed [cast cost] (EffectDef.castCost). */
      stage?: 'x' | 'mods' | 'cost' | 'itemCost';
    }
  | {
      /** ordering simultaneous triggers for one seat (R2) */
      type: 'orderTriggers';
      seat: Seat;
    }
  | {
      /** mid-resolution choice (R4 electric, R6 payments): replay item.parts[partIndex]
       * with answers filled in until it completes without suspending */
      type: 'resolve';
      item: StackItem;
      partIndex: number;
      answers: Record<string, unknown>;
      pendingKey: string;
    };

// ── events ────────────────────────────────────────────────────────────

export type EventType =
  | 'phase' | 'turn' | 'draw' | 'draft' | 'recycle' | 'resourceActivated'
  | 'spawned' | 'died' | 'despawned' | 'erased'
  | 'spellPlayed' | 'stackPushed' | 'resolved' | 'negated' | 'fizzled'
  | 'triggered' | 'targeted' | 'modApplied' | 'grafted'
  | 'attackDeclared' | 'blocksDeclared' | 'attacked' | 'blocked'
  | 'combatDamage' | 'afterCombat'
  | 'damage' | 'lifeLost' | 'lifeGained' | 'tokenCreated' | 'statChanged' | 'countersChanged'
  // Light & Dark player counters and the trash zone-change (R38/R39/R40)
  | 'rotGained' | 'debtGained' | 'debtPaid' | 'trashed'
  // Light & Dark cache zone (R41-R46). 'prophecyFulfilled' and 'glimpsed' are
  // LOG-ONLY: they are emitted from sweep points (startTurn, endBattleRound)
  // that are not inside a settle() window, so they deliberately do not fire
  // triggers. 'cached' and 'prophesied' do dispatch to listeners.
  | 'cached' | 'prophesied' | 'prophecyFulfilled' | 'glimpsed'
  // R50: the two turn-structure seams that had no dispatched event. Both are
  // fired inside a proper settle() window, so they DO trigger cards.
  // 'endOfHaste' fires while hasteDone still describes the step that is
  // closing (before it is nulled and before the R44 prophecy sweep reads the
  // mana tally); 'startOfDeployment' fires AFTER R38's rot damage has settled.
  | 'endOfHaste' | 'startOfDeployment'
  | 'regroup' | 'endOfTurn' | 'gameOver' | 'info';

/** Engine events double as the game log: every one carries a rendered message. */
export interface EngineEvent {
  type: EventType;
  msg: string;
  data?: Record<string, unknown>;
}

// ── actions ───────────────────────────────────────────────────────────

export type Action =
  | { type: 'recycleForResource'; seat: Seat; handIndex: number; element: ResourceKind }
  | { type: 'activateResource'; seat: Seat; index: number }
  /** planning: swap an ACTIVE Prismite for a resource of any element (R17) */
  | { type: 'exchangePrismite'; seat: Seat; index: number; element: ResourceKind }
  | { type: 'donePlanning'; seat: Seat }
  /** draft step (mode 'draft'): commit the hand↔pack merge. packIndices are
   * indices into the merged pile hand.concat(pack) — exactly pack.length of
   * them (normally 10) go back to the pack; the rest become the new hand. */
  | { type: 'draftCommit'; seat: Seat; packIndices: number[] }
  /** haste step (between planning and battle): done playing haste cards */
  | { type: 'doneHaste'; seat: Seat }
  /** constructed draw phase (Manual: "draw 4 cards, then select 2 cards from
   * their hand and put them on the bottom of the deck in any order"): the
   * chosen hand indices go to the bottom of YOUR deck in the order given */
  | { type: 'bottomCards'; seat: Seat; handIndices: number[] }
  /** mode 'ambush': play a [Battle] Ambush card during battle (recall target
   * ally, take their position) paying printed.ambush instead of the card cost.
   * mode 'discardMe' (R40): pay the printed "1 Discard me" cost line and
   * discard the card from hand — which TRASHES it, firing its own "when I am
   * trashed" trigger (Dropslime, Nothyr). */
  | { type: 'playCard'; seat: Seat; handIndex: number; mode?: 'ambush' | 'discardMe' }
  /** R42: cache a card with a printed prophecy banner, paying the banner's
   * plain mana (no affinity pips). DEPLOYMENT ONLY. `from` is 'hand' unless
   * the card itself says otherwise ("I can be prophesied from your bin" —
   * Angel of Anguish, CardBehavior.prophesyFromBin). */
  | { type: 'prophesy'; seat: Seat; from: 'hand' | 'bin'; index: number }
  /** R42/R45: play a card out of your cache. Legal only with permission — a
   * fulfilled prophecy (free, ignoring affinity) or a glimpse-style
   * play-until-end-of-turn stamp (pay the mana, ignore affinity). Normal
   * TIMING still applies: it is played "as if it were in your hand". */
  | { type: 'playCached'; seat: Seat; index: number }
  | { type: 'castSpellToken'; seat: Seat; entityId: EntityId }
  /** via: undefined = the card's own abilities list; 'augment' = the card's own
   * [Augment] text (live when played normally); { mod } = text donated by that
   * augment mod. abilityIndex indexes the resolved list. */
  | { type: 'activateAbility'; seat: Seat; entityId: EntityId; abilityIndex: number; via?: 'augment' | { mod: EntityId } }
  // R41: 'cache' is a legal mod source — "you CAN augment or graft from cache"
  // (Caleb 2024-12-02), paying the mod's normal cost; a FULFILLED prophecy on
  // the cached card makes it free instead (Caleb 2024-12-03).
  | { type: 'augment'; seat: Seat; from: 'hand' | 'bin' | 'cache'; index: number; hostId: EntityId }
  | {
      type: 'graft'; seat: Seat; from: 'hand' | 'bin' | 'cache'; index: number; hostId: EntityId;
      /** insert position in the host's mod stack: 0 = directly under the base … mods.length */
      position: number;
    }
  | { type: 'declareAttack'; seat: Seat; columns: EntityId[][]; spellTokens?: EntityId[] }
  | {
      type: 'declareBlocks'; seat: Seat; blocks: Record<number, EntityId[]>;
      /** counterattackers sent out with the block declaration (1v1 battle rule) */
      send?: EntityId[];
    }
  | { type: 'passPriority'; seat: Seat }
  | { type: 'doneDeploying'; seat: Seat }
  | { type: 'decide'; seat: Seat; choice: number | number[] };

// ── the whole game ────────────────────────────────────────────────────

export interface GameState {
  seed: number;
  rngState: number;
  actionCount: number;
  turn: number;
  phase: Phase;
  /** end-of-turn is in progress: EOT triggers ran, the turn flip is pending.
   * Lets a mid-EOT decision suspension resume into the turn flip (settle()
   * finishes it) instead of stranding the game — found by the fuzzer. */
  turnEnding?: boolean;
  initiative: Seat;
  winner: Seat | null;
  nextId: number;
  mode: GameMode;
  /** the elements in this game (draft: the trio) — resources outside this
   * list cannot be created and the UI never offers them */
  elements: Element[];
  sharedDeck: CardName[];
  /** mode 'constructed': decks[seat] = that seat's own deck (top = index 0).
   * Absent in 'shared'/'draft', where sharedDeck is the one deck. */
  decks?: CardName[][];
  /** mode 'constructed': non-null while the draw phase's bottoming runs;
   * bottomDone[seat] = that seat has put their 2 cards back this turn.
   * Cleared (null) once everyone is done. Mirrors draftDone. */
  bottomDone?: boolean[] | null;
  /** mode 'draft': packs[seat] = that seat's face-down pack (normally 10 cards;
   * viewable only by its holder during their draft step). Empty in 'shared'. */
  packs: CardName[][];
  /** mode 'draft': non-null while the draft step runs; draftDone[seat] = that
   * seat has committed their hand↔pack merge this turn. Cleared (null) once
   * everyone commits and the packs pass. Always null in 'shared'. */
  draftDone: boolean[] | null;
  /** mode 'draft' (additive; optional so older serialized states still load):
   * packMeta[seat] = identity of the PHYSICAL pack currently in packs[seat].
   * Stamped at deal time and travelling with the pack when packs pass.
   * serial = 1-based deal order across the whole game (generation g of a
   * 2-player game deals serials 2g-1 and 2g, initiative player first);
   * originalSize = cards dealt into it; commits = how many hand↔pack merges
   * have been committed on this pack since it was dealt. */
  packMeta?: ({ serial: number; originalSize: number; commits: number } | null)[];
  /** running counter behind packMeta serials (additive) */
  packSerial?: number;
  /** seenHand[viewer] = the opponent's hand as `viewer` last SAW it (a hand-
   * reveal effect like Bripp), with the turn it happened — honest note-taking
   * so nobody needs pen and paper. Cleared when the owner's hand next mixes
   * unknowably (their draft-step merge). null = never seen / stale. */
  seenHand: ({ turn: number; cards: CardName[] } | null)[];
  players: PlayerState[];
  regions: Region[];
  entities: Record<EntityId, Entity>;
  stack: StackItem[];
  battle: BattleState | null;
  /** 0 = not in battle phase, else which battle round */
  battleRound: 0 | 1 | 2;
  /** per-seat counters reset each battle PHASE ("second ally death this battle") */
  battleCounters: Record<string, number>[];
  priority: Seat | null;
  passes: number;
  planningDone: boolean[];
  /** haste step (Manual p.18): non-null while it runs; true = done playing
   * haste cards. Skipped entirely when nobody has a legal haste play. */
  hasteDone: boolean[] | null;
  /** R50: the END-OF-HASTE window is in progress — the 'endOfHaste' event has
   * fired and whatever it triggered is still draining. The phase flip into
   * battle waits for it (E.finishHasteEnd, called from settle()), exactly the
   * way `turnEnding` defers the turn flip: a trigger that suspends on a
   * decision would otherwise strand the game between the haste step and the
   * battle phase. Additive/optional. */
  hasteEnding?: boolean;
  /** R43: mana each seat has spent DURING the current haste step, behind
   * Tithe Enforcer's "End [Haste] with used mana" prophecy. Zeroed when the
   * haste step opens and again once the end-of-haste fulfilment sweep has
   * read it, so it is nonzero only inside its own window. Additive/optional
   * (pre-expansion states read as 0). */
  hasteManaSpent?: number[];
  /** R43: battle ROUNDS completed so far this game — the forward anchor for
   * "One Battle Passes". In 1v1 both the initiative battle and the
   * counterattack battle tick it (Caleb 2024-09-24). Additive/optional. */
  battlesCompleted?: number;
  /** deployment is SIMULTANEOUS (house rule; regions can't interact anyway):
   * per-seat done flags, null outside the deploy phase. The server keeps each
   * player's deploy actions hidden from the other until both are done. */
  deployDone: boolean[] | null;
  /** derived convenience: the initiative-ordered first seat still deploying
   * (null when deployment is over). Kept for sequential drivers/tests. */
  deployPlayer: Seat | null;
  /** triggers waiting to be ordered/targeted/stacked, in collection order */
  triggerQueue: PendingTrigger[];
  /** seats whose current trigger batch is already ordered (reset on new arrivals) */
  triggerOrderedSeats: Seat[];
  suspension: Suspension | null;
  decision: Decision | null;
}

export interface PendingTrigger {
  sourceId: EntityId;
  sourceCard: CardName;
  controller: Seat;
  abilityIndex: number;
  label: string;
  /** graft composition computed at fire time: base part + graft parts (no targets yet) */
  parts: EffectPart[];
  event: EngineEvent | null;
}

export interface ApplyResult {
  state: GameState;
  events: EngineEvent[];
  pendingDecisions: Decision[];
}
