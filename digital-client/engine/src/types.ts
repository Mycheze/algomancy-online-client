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

export type Element = 'fire' | 'water' | 'earth' | 'wood' | 'metal';
export type ResourceKind = Element | 'prismite';

export type Phase = 'planning' | 'battle' | 'regroup' | 'deploy' | 'gameover';

/** 'shared' = the constructed-ish default (shared deck, draw 2, no packs);
 * 'draft' = live draft (Manual p.16-17): per-player 10-card packs, a draft
 * step each planning phase, clockwise passing, N+1-turn pack refresh. */
export type GameMode = 'shared' | 'draft';

export type Attr =
  | 'Flying' | 'Deadly' | 'Swift' | 'Sluggish' | 'Tough' | 'Balanced'
  | 'Inverted' | 'Unaware' | 'Powerful' | 'Vulnerable' | 'Feeble' | 'Evasive'
  | 'Sneaky' | 'Alluring' | 'Piercing' | 'Electric' | 'Poisonous' | 'Resonant'
  | 'Thieving' | 'Reaping';

export interface ResourceState {
  kind: ResourceKind;
  state: 'dormant' | 'open' | 'expended';
}

export interface PlayerState {
  seat: Seat;
  name: string;
  life: number;
  hand: CardName[];
  bin: CardName[];
  resources: ResourceState[];
  activationsLeft: number;
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
}

// ── the stack ─────────────────────────────────────────────────────────

export type TargetRef =
  | { unit: EntityId }
  | { player: Seat }
  | { stack: number };

/**
 * One sub-effect of a stack item with its declared targets.
 * A plain spell has one part; a graft composite has base + one per graft mod,
 * top-to-bottom — the whole item resolves as ONE ability (Manual p.33).
 */
export interface EffectPart {
  /** registry lookup: which EffectDef runs (see cards/dsl.ts resolveEffectKey) */
  effectKey: string;
  targets: TargetRef[];
  /** the mod entity this part came from (bounded budget bookkeeping, R9) */
  fromMod?: EntityId;
  /** skip at resolution (bounded graft effect already used this turn) */
  spent?: boolean;
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
      /** collecting targets for a stack-item-under-construction */
      type: 'cast';
      item: StackItem;
      partIndex: number;
      targetIndex: number;
      /** what to do once every part has targets */
      then: 'push' | 'resolve';
      /** rest of a multi-item cast chain (Burst tokens) */
      moreItems: StackItem[];
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
  | 'damage' | 'lifeLost' | 'tokenCreated' | 'statChanged' | 'countersChanged'
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
  /** mode 'ambush': play a [Battle] Ambush card during battle (recall target
   * ally, take their position) paying printed.ambush instead of the card cost */
  | { type: 'playCard'; seat: Seat; handIndex: number; mode?: 'ambush' }
  | { type: 'castSpellToken'; seat: Seat; entityId: EntityId }
  /** via: undefined = the card's own abilities list; 'augment' = the card's own
   * [Augment] text (live when played normally); { mod } = text donated by that
   * augment mod. abilityIndex indexes the resolved list. */
  | { type: 'activateAbility'; seat: Seat; entityId: EntityId; abilityIndex: number; via?: 'augment' | { mod: EntityId } }
  | { type: 'augment'; seat: Seat; from: 'hand' | 'bin'; index: number; hostId: EntityId }
  | {
      type: 'graft'; seat: Seat; from: 'hand' | 'bin'; index: number; hostId: EntityId;
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
  sharedDeck: CardName[];
  /** mode 'draft': packs[seat] = that seat's face-down pack (normally 10 cards;
   * viewable only by its holder during their draft step). Empty in 'shared'. */
  packs: CardName[][];
  /** mode 'draft': non-null while the draft step runs; draftDone[seat] = that
   * seat has committed their hand↔pack merge this turn. Cleared (null) once
   * everyone commits and the packs pass. Always null in 'shared'. */
  draftDone: boolean[] | null;
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
