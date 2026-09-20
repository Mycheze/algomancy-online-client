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
  // R277: there is deliberately NO release-timing field here. A trailing
  // "[Haste]" on the banner (Divine Intervention) marks the PROPHESY window —
  // it is the printed exception to R42's deployment-only rule and is consumed
  // by E.mayProphesy, before there is a cache entry to record it on. The
  // RELEASE is always at the card's printed timing (E.cachedTiming): R42 plays
  // a fulfilled card "as if it were in your hand". A copy of the marker here
  // could only be read by something asking the wrong question, and for a year
  // one was.
  /** R43: the turn this was prophesied on ("Two Turns Pass" = turn + 2) */
  turn: number;
  /** R43: battles completed before this was prophesied ("One Battle Passes") */
  battles: number;
  /** R43/R302: deaths THIS SEAT had witnessed before it prophesied ("13 Units
   * Die", Vengeance) — snapshotted from `deathsSeen[seat]`, so it is the
   * controller's count and nobody else's. Optional and additive: a state
   * cached before this existed simply counts from zero, which can only ever
   * fulfil EARLIER, never later — a stale save is generous, not broken. */
  deaths?: number;
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
  /** R65: every card erased out of this player's zones, in the order it went.
   * Erasing takes a card OUT OF THE GAME — it is not a zone anyone plays
   * from — but the pile is public information and players need to be able to
   * look at it ("there's currently no way to view erased cards"). Additive
   * and optional like `rot`/`debt`; read it through E.erased(seat). */
  erased?: CardName[];
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
  /**
   * R96 {Unstable}, as an until-regroup STAMP rather than a derivation.
   *
   * A modded card is Unstable because it has mods (R69) — that is derived and
   * needs no field. This is the OTHER way in: "you may play spells from your
   * bin. If you do, they gain {p}unstable until regroup" (Abyssal Evocation,
   * Spell Excavation). The card SAYS "gain … until regroup", so it has to
   * survive the permission lapsing and even the card being played again, which
   * a derivation cannot do.
   *
   * ⚠ Not an `Attr` — {Unstable} is absent from the Attr union on purpose (it
   * is a bin REPLACEMENT, not a combat attribute), so it cannot ride tempAttrs
   * and needs its own flag. Cleared in the R11 step-3 sweep beside
   * `suppressed`, which is what makes "until regroup" free.
   */
  unstable?: boolean;
  /**
   * R98: "Until regroup, prevent all damage that would be dealt to target
   * unit" (Phytochemical Protection). The value is the CARD that put the
   * shield up, exactly as `suppressed` names the card that switched a layer
   * off — the log line has to say what stopped the damage.
   *
   * A field on the ENTITY rather than a radiating `StaticMod` because the
   * shield belongs to a resolved SPELL with no permanent behind it: there is
   * nothing in play for a static to hang on. Cleared in the R11 step-3 sweep
   * beside `suppressed` and `unstable`, which is what makes "until regroup"
   * free. Additive/optional — states serialized before R98 read as unshielded.
   *
   * ⚠ Prevention is NOT the R38 REPLACEMENT hooks' semantics. Caleb ruled
   * (2024-10-24) that replacing damage does not unmake it, so {Lethal} still
   * kills through a Blightsea Polyp. Prevention DOES unmake it — RAQ "[Solved]
   * Poisonous vs 'Whenever I am dealt damage' vs Phytochemical Protection":
   * "damage is dealt in the form of -1/-1 counters, which means if there is
   * not damage being dealt, then no counters are placed", and "Jollyglop
   * doesn't trigger". Read `E.preventUnitDamage`, never this raw.
   */
  damageShield?: CardName;
  /**
   * R98: damage prevented by `damageShield` that has not yet been paid out as
   * +1/+1 counters ("Put a +1/+1 counter on it for each damage prevented this
   * way"). Held rather than paid on the spot because both commit loops mark a
   * whole batch of damage before checking any deaths — `addCounters` runs
   * `checkDeaths`, and paying mid-loop would kill a unit that the rest of the
   * batch is still being dealt to, which is exactly what R80 made simultaneous.
   * `E.settleDamagePrevention()` drains it at the end of each commit.
   */
  shieldPending?: number;
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
  /**
   * R91: the card this entity has NAMED — "[Augment] During [Haste] name a
   * card. My last named card loses all abilities. {i}(As long as I am in their
   * region.)" (The Everywhere).
   *
   * A STRING and not a budget, because `budgets` is numeric-only and what has
   * to be remembered here is a CardName. It is the anchor's memory: for text
   * donated by an [Augment] the naming trigger already fires with the HOST as
   * `sourceId` (E.queueTrigger passes `host.id`), which is the same entity
   * `staticsFor` picks as the static's anchor — so one field serves both the
   * played-normally and the donated case, exactly as it does for Transmogrifant.
   *
   * ⚠ NOT cleared by the R11 step-3 regroup sweep, deliberately. "My LAST
   * named card" is a MEMORY, not an until-regroup effect: the duration clause
   * is "(as long as I am in their region)", which the StaticMod's own region
   * scope evaluates live, every time it is asked. Wiping the name at regroup
   * would make the card re-name-or-forget every turn, which is not what it
   * prints. A later naming simply overwrites this (that is "last").
   *
   * Read through `E.nameOf(entity)` rather than comparing `Entity.card`
   * directly — see that method for why (a copy-NAME layer is a known future
   * change and this is its one hook).
   *
   * Additive/optional, so states serialized before the field still load.
   */
  named?: CardName;
  /**
   * R101/R157 §10 — this physical card is TURNED OVER. `card` is the BACK
   * face it is currently showing; this is the FRONT face printed on the other
   * side of the same piece of cardboard.
   *
   * The owner (2026-08-25), asked what happens to a transformed Scholar of the
   * Void when it leaves play: *"Turns back over. In all zones, other than
   * play, it exists as the front side. And the back is NOT a token."* So a
   * transform is no longer the permanent, total identity change R101 assumed
   * (see `copies`' note, which said so): PLAY is the only zone where the back
   * face exists at all, and the card that reaches a bin, a hand, a cache or
   * the erased pile is the front one.
   *
   * That makes "which side is up" a fact about the ENTITY — it lives here
   * rather than in a registry lookup, so the engine never has to know which
   * cards have back faces, a GRANTED transform would work with no new data,
   * and the pairing survives serialization. Written only by
   * `E.transformFace`, cleared only by `E.revertFace`, which every leave-play
   * route runs (`E.leavePlay`, `E.disposeToBin`, `E.eraseFromPlay`).
   *
   * Additive/optional, so states serialized before the field still load — and
   * a state saved mid-transform under the old code reads as "not turned over",
   * which is the pre-R157 behaviour rather than a crash.
   */
  frontFace?: CardName;
  /** unit token (erased on leaving play, survives regroup) */
  token?: boolean;
  tokenStats?: [number, number];
  /**
   * LAYER 2 of the Manual's six-layer stat model: "base stats, which can be
   * changed to be different from what's printed". Set until regroup by cards
   * that rewrite the base rather than adjust it — Formless ("becomes a base
   * 4/4"), Body Swap ("exchange the BASE stats of two target units").
   *
   * The CONTINUOUS half of layer 2 lives on StaticMod (`baseP`/`baseT`,
   * radiating like any other static — Aberrant Statweaver). Never read either
   * raw: E.baseStatsOf is the one authority and resolves both together.
   *
   * Additive/optional so older serialized states still load. Cleared with the
   * other until-regroup changes (R11 step 3), and read only through
   * E.baseStatsOf — layer 3 (counters, temp deltas, static projections) then
   * applies ON TOP, which is the whole reason this cannot be a delta: two
   * base-setting effects on one unit must not stack (playtest 2026-08-20,
   * Formless on a Body-Swapped Bloated Manablub made it a 6/9).
   */
  baseSet?: [number, number];
  /**
   * When `baseSet` was stamped, as a tick of the global `nextId` clock. Layer
   * 2 resolves LAST-WINS, so a rewrite needs a timestamp to be compared with
   * the continuous base-setters (whose timestamp is the id of the entity
   * carrying the text — the same clock). Undefined on a state serialized
   * before the field, which reads as "oldest" and so loses to a live static.
   */
  baseSetSeq?: number;
  /** the game turn this entity ARRIVED in play (GameState.turn at spawn time).
   * Additive/optional so states serialized before it still load — read it
   * through E.spawnedTurn(u), which answers undefined for an entity that
   * predates the field. Behind "erase all units that spawned this turn"
   * (Banishment) and "if I spawned this turn …". Mods carry it too; the field
   * is stamped by newEntity, so it is simply "when this entity was made". */
  spawnedTurn?: number;
  /**
   * R62, the until-regroup half of the SUPPRESSION layer: this unit's own
   * attribute layer and/or ability layer is switched off, and the value is the
   * card that switched it off (the text box names the culprit). "Loses all
   * attributes and abilities until regroup" — Suppression Field, Formless's
   * attribute half.
   *
   * The other half of R62 is CONTINUOUS and lives on StaticMod
   * (`suppressAttrs` / `suppressAbilities`, radiating like any other static —
   * Monke, Transmogrifant). Never read either raw: E.suppressionOf(e) is the
   * one authority and unions both halves.
   *
   * Additive/optional, so states serialized before the layer existed still
   * load. Cleared with the other until-regroup changes (R11 step 3).
   */
  suppressed?: { attrs?: CardName; abilities?: CardName };
  /**
   * R63: rules text GRANTED to this unit until regroup — "Your units gain
   * 'When I die, create a Robot 3.' until regroup" (Reforge the Dead). A grant
   * is a REFERENCE to an authored ability on some card, not a copy of it, so
   * it stays serializable and replays bit-identically; fireEvent scans these
   * alongside the unit's own lists, and the composed effect key
   * (`ability:<card>#<i>`) resolves through the registry exactly as a printed
   * one does.
   *
   * Additive/optional; cleared at regroup with everything else temporary.
   */
  granted?: GrantedText[];
  /**
   * R118 — THE COPY LAYER (layer 0). The faces this entity is WEARING, oldest
   * first. Empty/absent is the overwhelmingly common case: the entity simply
   * is its own card.
   *
   * ⚠ `Entity.card` is NEVER rewritten by a copy. R118's split identity: a
   * copy changes the GAME name (statics, "name a card", targeting by name, the
   * text box) but not the PHYSICAL card, which is what bins, what is erased and
   * what belongs to a deck. A Borrower of Forms that became a Good Whale and
   * then died puts **Borrower of Forms** in the bin. That is why this is an
   * indirection in front of the identity rather than a mutation of it — and it
   * is the one thing R101 (transform) could get away with mutating, because a
   * transform is permanent and total while a copy reverts (Apex Prime) and is
   * re-evaluated continuously (Ancient One).
   *
   * Read through `E.facesOf` / `E.faceName` / `E.faceDef` / `E.facesWith`;
   * never read raw. Additive/optional so older serialized states still load,
   * and pure data so `seed + actions` replays bit-identically.
   */
  copies?: CopyRef[];
  /**
   * R84 {Alluring}: this unit has been LURED — an Alluring column's on-attack
   * trigger resolved naming it. Two effects, with two different lifetimes:
   *
   *  - **it cannot attack** for the rest of this battle phase. That is the
   *    presence of the field itself, whatever round stamped it: it may not be
   *    sent out as a counterattacker at block time and it may not be declared
   *    as an attacker in round 2. It survives the allurer's death (Caleb:
   *    *"You can't attack but you can block other things"*).
   *  - **it must block those attack columns if able**, but only in the round
   *    that lured it — `round` is `BattleState.round`, and a mark from an
   *    earlier round carries only the can't-attack half.
   *
   * `columns` is a LIST because two Alluring columns may name the same unit
   * (Alluring does not stack within one column, but two columns are two
   * triggers). Blocking any one of them discharges all of them — a unit
   * cannot block twice, and "if able" is the whole of the compulsion.
   *
   * The entries are attack-column INDICES, which are the column's identity
   * (R72), so they are re-keyed by `E.rekeyColumns` with `BattleState.blocks`
   * and drop out when their column ceases to exist — which is exactly how the
   * must-block duty dies with the column.
   *
   * Additive/optional; cleared at regroup with everything else temporary.
   */
  allured?: { round: number; columns: number[] };
}

/**
 * R63: one granted ability on an entity. `card`/`via`/`index` address the
 * authored ability (dsl.ts's registry — the GRANTING card usually carries the
 * granted ability in its own `abilities` list, where nothing else can ever
 * fire it: a spell is never a unit in play). `text` is the clause as the
 * granting card prints it, for the text box; `from` names the granter.
 */
export interface GrantedText {
  card: CardName;
  via: 'ability' | 'augment';
  index: number;
  text: string;
  from: CardName;
}

/**
 * R118: which half of a card a copied FACE contributes. A face that carries
 * `name` is a whole-identity replacement — the entity's game name, type line,
 * printed numbers and printed text all become the copied card's — and only
 * such a face may ever be `facesOf()[0]`.
 *
 * Ancient One's continuous projection is the ADDITIVE case: it contributes
 * `statics` / `activated` / `triggered` / `behavior` and NOTHING else, which is
 * why "I have all abilities of adjacent allies" never changes the Ancient One's
 * name or makes it a 3/3.
 *
 * R127 added `behavior`, the CATCH-ALL for every remaining channel a card can
 * radiate from play — `costMods`, `effectAttrs`, `amountMods`,
 * `modPermissions`, `playPermissions`, `mustBeTargeted` and the seven
 * `replace*` hooks. The owner, on Ancient One: *"it basically just copies the
 * whole text box of adjacent allies"*, and the ONE stated exclusion is
 * attributes, which is why `attrs` stayed a facet of its own instead of being
 * folded in here.
 */
export type CopyFacet =
  'name' | 'stats' | 'attrs' | 'statics' | 'activated' | 'triggered' | 'behavior';

/**
 * R118: one face worn by an entity — the serializable half of the copy layer.
 *
 * `seq` is a tick of the shared `nextId` clock, so two copies applied to the
 * same unit resolve LAST-WINS exactly the way `baseSet`/`baseSetSeq` does
 * against a continuous base-setter. Nothing here is an entity id and nothing
 * here is derived, so a state carrying copies replays bit-identically.
 */
export interface CopyRef {
  /** the card whose face is worn — resolved through the registry by NAME, so
   * a copy of a copy chains through this field (MTG's "copiable values"). */
  card: CardName;
  facets: CopyFacet[];
  /** 'regroup' is swept by R11 step 3 (Apex Prime); 'permanent' never lapses
   * (Borrower of Forms — "I BECOME an exact copy", and the live test that
   * pins it says so). */
  until: 'regroup' | 'permanent';
  /** the card that caused the copy, for the log and the text box */
  from: CardName;
  seq: number;
  /**
   * LAYER 1 OVERRIDE — this face's "printed" numbers, when they are not the
   * copied card's printed numbers.
   *
   * Only Borrower of Forms sets it, and only because its reminder text says
   * so verbatim: "(I copy all stat changes, counters, card text and mods)".
   * The stat CHANGES are copied, so the face is snapshotted at the target's
   * base stats (layers 1-2) rather than at the card's printed pair. Everything
   * else leaves it undefined and reads the real printed numbers, which is what
   * makes R106 {Unaware} read the copied face correctly.
   */
  printedStats?: [number, number];
  /**
   * R118 ruling 2, the owner verbatim: *"Inherit the mods text, but it IS
   * Unstable. Anything that's modded is unstable and the copy is still
   * considered modded."*
   *
   * So a copy of a MODDED unit inherits the mods' TEXT (quoted in `modText`
   * for the box — no mod ENTITIES are ever cloned, which is why `Entity.mods`
   * stays untouched), counts as modded, and is therefore {Unstable}: it is
   * ERASED instead of binned when it dies (R69). Read through
   * `E.isUnstable(e)`, never raw.
   */
  modded?: boolean;
  /** the copied mods' donated clauses, verbatim, for the text box only */
  modText?: string[];
}

/**
 * R147 — the whole BODY a spell unit enters play wearing, when it is not the
 * body its own card prints. Borrower of Forms is the only card that has one:
 * *"Erase target unit. I become an exact copy of that unit."*
 *
 * Everything here has to be in place BEFORE the `spawned` event fires, because
 * that event is the only moment the rest of the board gets to look. The face
 * carries the name, the text and the layer-1 numbers (`CopyRef.printedStats`);
 * the three numbers beside it are the parts of *"I copy all stat changes,
 * counters, card text and mods"* that are facts about the UNIT rather than
 * about its identity, and so cannot ride a face.
 *
 * Plain serializable data, for `StackItem`'s R85 reason: it is prepared while
 * the spell part runs and read a moment later in `E.afterParts`, with a
 * possible suspension and a structuredClone in between.
 */
export interface SpawnFace {
  copy: CopyRef;
  /** the copied unit's +1/+1 counters — real counters, put on the body */
  counters?: number;
  tempPower?: number;
  tempToughness?: number;
}

// ── battle ────────────────────────────────────────────────────────────

export type BattleStep =
  | 'declare' | 'attackWindow' | 'blocks' | 'blockWindow' | 'damageWindow' | 'afterWindow';

export interface BattleState {
  /** round 1: IT attacks into NIT's region; round 2: NIT (counter)attacks IT's region */
  round: 1 | 2;
  attacker: Seat;
  defender: Seat;
  region: number;
  step: BattleStep;
  /**
   * attacking columns, each [frontId, backId?].
   *
   * R72: an entry may legitimately be EMPTY — a permanent "hole" in the line.
   * The Manual ("HOLD THE LINE"): an emptied column's neighbours close in to
   * fill the gap ONLY before blocks are declared; after blocks, columns never
   * move. So a column index is stable for the whole of combat, and mutable
   * only in the attack/block steps — where `E.repairFormation()` (a gap
   * closing) and `E.placeInFormation()` (a column opened on the left) are the
   * only two things allowed to change it, both through `E.rekeyColumns`.
   * Never cache a column index across either.
   */
  columns: EntityId[][];
  /** colIdx -> blocking column [frontId, backId?]. Key presence = sticky "blocked" flag.
   * R72: the index is the ATTACK column's identity, and `repairFormation()` is
   * the only thing allowed to change it — atomically, for every entry at once. */
  blocks: Record<number, EntityId[]>;
  /** units NIT sent out at block time — they attack in round 2 (1v1 battle, Manual p.20-21) */
  sentAttackers: EntityId[];
  /** round 2 after a round-1 battle: only these ids may attack (null = unrestricted) */
  attackerPool: EntityId[] | null;
  /** an attack was declared (gates "after combat" triggers) */
  happened: boolean;
  /** combat damage in progress: the next sub-step to run ('after' = run the
   * after-combat tail). Survives suspension: settle() resumes the pump once
   * decisions drain.
   *
   * ⚠ THE COMMENT HERE USED TO SAY triggers fired by a sub-step "resolve
   * IMMEDIATELY (special actions, no priority — R3) before the next
   * sub-step". That was the pre-R261 engine, and it had already been wrong
   * for three weeks when R295 found it. What is true now is in two places:
   * R261 holds the trigger queue across an UNSPLIT damage step (one batch,
   * drained after combat, respondable), and R295 hands priority over BETWEEN
   * sub-steps when the step is split — see `damageSubs` below. */
  damageStep?: 'Swift' | 'normal' | 'Sluggish' | 'after' | null;
  /** R295: the sub-steps that actually have a column striking in them, fixed
   * ONCE when the damage step opens. Two or more of them means the step is
   * SPLIT: each is a real step, and priority is offered at every boundary
   * between two of them. Fixed once on purpose — a Swift unit dying in the
   * Swift sub-step must not retroactively make the battle unsplit and strand
   * the triggers its own death queued. Absent in states saved before R295,
   * which reads as "not split": the old behaviour, for an old game. */
  damageSubs?: ('Swift' | 'normal' | 'Sluggish')[];
  /** R295: while `step` is 'damageWindow', the sub-step the pump resumes into
   * once both players pass and the stack is empty. */
  pendingSub?: 'Swift' | 'normal' | 'Sluggish' | 'after' | null;
  /** R120 (elective split): per-strike assignment plans for the sub-step
   * currently collecting or assigning, keyed `${sub}:atk|blk:${colIdx}`.
   * Filled one `decide` at a time while the pump is suspended (see the
   * 'combatAssign' suspension); consumed by the sub-step's assignment and
   * cleared before its commit. Absent in every state saved before R120 —
   * and in any combat with no real split choice — which reads as "no
   * elections recorded": exactly right for both. */
  assignPlans?: Record<string, AssignPlan> | null;
}

/** R120: one strike's recorded elective-split answers. `picks` are the chosen
 * pool amounts in ask order (front-to-back over the victims that carried a
 * real choice — with two-unit columns that is only ever the front); `def`
 * short-circuits the walk with the default front-to-back share instead. */
export interface AssignPlan { picks: number[]; def?: boolean }

// ── the stack ─────────────────────────────────────────────────────────

/** R41: a card sitting in someone's cache, addressed by its stable `uid`
 * (CachedCard.uid) rather than by index. The cache is PUBLIC information, so
 * BOTH players' caches are legal targets. */
export interface CachedRef { seat: Seat; uid: number }

/** R64: a card in a bin. A bin holds plain card NAMES, so two copies of one
 * card there are genuinely indistinguishable — the card name plus which copy
 * IS the whole identity, and no uid is needed (contrast CachedRef, whose
 * entries carry prophecies).
 *
 * `nth` is the 0-based occurrence among entries with that name, and exists so
 * a two-target spell can reach both copies of one card ("Recall two target
 * units in your bin"). If that copy has left by resolution the ref simply
 * slides to whichever copies remain — which is exactly right, because copies
 * of one card in a bin are interchangeable. */
export interface BinRef { seat: Seat; card: CardName; nth?: number }

/**
 * R184: a FORMATION — one player's whole side of the current battle's grid.
 *
 * RULED 2026-08-25 (owner): "target formation" is THE WHOLE SIDE — a player's
 * entire formation in that region, every unit arrayed there. Not a column.
 *
 * The formation is named by the SEAT that owns it (attacking columns for the
 * battle's attacker, blocking columns for its defender) rather than by a grid
 * snapshot, because the grid moves under it: R72 lets columns close up and
 * open while the battle runs, so a ref naming a column index would quietly
 * become a different formation between cast and resolution.
 *
 * It exists because Galactic Germination prints "Create a 1/1 unit for each
 * unit in target formation" and had no way to say so — it targeted a UNIT and
 * took the grid side containing it. That COUNTED right (and still does, R184
 * changes no count) but lied about everything else: nothing could redirect it
 * as a formation, nothing could read it as one, and the log said it had
 * targeted a unit.
 */
export type TargetRef =
  | { unit: EntityId }
  | { player: Seat }
  | { stack: number }
  | { cached: CachedRef }
  | { bin: BinRef }
  | { formation: Seat };

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
  /**
   * CARD-TODO #18 — this part's run said "I did nothing; give the [once] back".
   *
   * A `bounded` ability reserves its budget at COMPOSITION time (see
   * `E.composeParts`), which is also the re-entrancy guard and has to stay
   * there. But composition happens before the run has any chance to discover
   * that it can do nothing, so a trigger that was never even ASKED — Hexbane
   * Shiitake during the end-of-turn window — burnt its `[once]` anyway.
   *
   * RULED 2026-08-23 (owner): DECLINING NEVER SPENDS IT. Saying no to a "you
   * may" leaves the budget intact and the same trigger may ask again later the
   * same turn. `EffectCtx.refundBudget()` raises this flag and
   * `E.settleBudgetRefund` pays it out once the part has FINISHED.
   *
   * NARROWED THE SAME DAY BY R113 (designer): the reason the budget survives is
   * that the ability was DECLINED, not that it "did nothing". A bounded use is
   * spent by being activated or put on the stack, "regardless of if that
   * ability resolves or doesn't" — so a fizzle, a negation, and a run that was
   * used and found nothing to work on all SPEND it. This flag is for the one
   * shape R113 keeps: the player was offered the ability and refused, or no
   * offer could be made at all. 94-bounded-uses.test.ts guards both sides.
   *
   * ON THE PART, exactly like `StackItem.eraseSelf` and for the same reason: a
   * part can suspend mid-resolution and be replayed out of the serialised
   * suspension (R85). `item` — and therefore `item.parts` — is what the
   * suspension carries, so the flag survives the round trip; and because R85
   * rolls the world back to the part BOUNDARY, a replay starts with the flag
   * clear and re-raises it only if it reaches the same branch again. That is
   * what makes the refund idempotent: it is paid once, after the last replay,
   * and a run that ends up doing something never raises it at all.
   *
   * "Emitted no event" is deliberately NOT the test. CARD-TODO #3's sweep gave
   * every one of these bail-out branches an announcement, which was the whole
   * point of it, so an event-count heuristic would refund nothing.
   */
  refunded?: boolean;
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
    /**
     * 'sacrificeUnits': every unit sacrificed, snapshotted at payment.
     *
     * `counters` is `Entity.counters` RAW, and that is the ruling rather than
     * an implementation shortcut: counters NET (+1/+1 and -1/-1 cancel
     * pairwise — "if I have +1/+1 and -1/-1 on the 2 cards, what's the total
     * number?" → "0, they cancel out") and a temporary buff is not a counter
     * at all ("oh, no those are not counters"), so it cannot be reconstructed
     * from `effStats`. Deformant's "the total number of counters on us" reads
     * exactly this, summed over the list.
     *
     * `unit` is the entity id, so a resolution can tell WHICH unit each
     * receipt belongs to. Both are snapshots: the units are already dead by
     * the time the effect runs, and re-reading the board would find nothing.
     */
    sacrificedUnits?: {
      unit: EntityId; card: CardName; power: number; defense: number; counters: number;
    }[];
    /** 'removeCounters': how many +1/+1 counters came off, and from where */
    counters?: { unit: EntityId; card: CardName; n: number }[];
    /** 'eraseBin': the cards erased out of the bin, in the order chosen */
    erased?: CardName[];
    /** R196 'payMana': the mana actually paid for a printed "[x]" — which
     * under R157 §1 IS what the ability cost, and (for `n: 'X'`) is its X. */
    mana?: number;
    /** R196 'recallUnit': the ally recalled to pay the cost, snapshotted at
     * payment — it is in a hand, not on the board, by the time this resolves. */
    recalled?: { unit: EntityId; card: CardName }[];
    /** R196 'eraseMod': the mod erased off the source to pay the cost. The
     * entity is GONE, so the receipt is the only record the resolution has. */
    erasedMods?: { mod: EntityId; card: CardName }[];
    /** R64: a VARIABLE cast cost ('X') defines the spell's X — the number of
     * units actually paid. Read by the effect as ctx.x, which prefers this
     * over the item-wide mana X so a grafted rider paying its own variable
     * cost cannot collide with its carrier's. */
    x?: number;
    /** R64: the payer said "that's enough" — the idempotence guard for a
     * variable cost, whose receipt is otherwise indistinguishable from a
     * partially-paid one across a replay. */
    xDone?: boolean;
  };
  /** {Modular}: the mods riding on this item, mirrored onto every part so the
   * resolution can read them out of EffectCtx (they are also on the item, for
   * the stack display) */
  mods?: CardName[];
  /**
   * R57 — a MODAL effect's chosen half ("[Put a -1/-1 counter on each enemy
   * or put a +1/+1 counter on each of your units]"), picked in the CAST
   * window by `E.collectModes` and read back at resolution as `ctx.mode`.
   *
   * Every caster-facing mode used to be a mid-resolution `ctx.choose`, which
   * meant the item sat on the stack with its mode UNKNOWN: the opponent spent
   * a card responding to a Burgeon whose half had not been declared, the
   * response resolved, and only then was the caster asked — with the option
   * labels recomputed off the post-response stats. That is free information
   * the opponent paid for. A mode is part of DECLARING the effect, exactly as
   * X, mods, targets and bracketed costs are (R35/R57).
   *
   * ON THE PART, not the item, for the same reason `costPaid` is: a graft
   * composite can carry two modal parts (a Burgeon grafted onto a Burgeon),
   * and `part` is what the suspension carries (R85). Its PRESENCE is the
   * idempotence guard — collectTargets re-runs from the top after every
   * answered decision — so a mode with nothing to choose between is recorded
   * as `null` rather than left undefined.
   *
   * NOT for a mode somebody ELSE picks. R6's "unless its controller pays"
   * (Abduct) is the OPPONENT's decision, made when the effect reaches them;
   * docs/digital-rules.md:51 puts payment inside resolution. Nor for a
   * replacement-effect mode (Cosmic Conspirator), which is raised before the
   * thing it is about exists.
   *
   * ⚠ R284 DELETED the one carve-out that used to stand here — "each opponent
   * discards a [unit or spell]" (Void Memory), filed as the OPPONENT's pick
   * under R67's not-a-target rule. A printed bracket is never theirs: the
   * owner of the effect picks the half, at cast, no exceptions. What R6 and
   * R284 actually divide is *bracket vs. no bracket*, not *caster vs.
   * opponent* — Abduct's ransom is unbracketed prose ("unless its controller
   * pays"), and the bracket is the marker for the thing the owner declares.
   */
  mode?: unknown;
  /**
   * R144 — the entity this part is AIMED AT, declared in the stack window and
   * read back at resolution as `ctx.subject`. A SUBJECT, deliberately not a
   * target (see `EffectDef.subject` in cards/dsl.ts for what that distinction
   * buys and what it refuses).
   *
   * Three states, and the difference between the last two is the whole ruling:
   *  · `undefined` — not collected yet, or this part declares no subject at
   *    all. Its absence is the idempotence guard, exactly like `mode`'s
   *    presence is: `collectTargets` re-runs from the top after every answered
   *    decision and must not ask twice.
   *  · `null` — collected, and there was NOTHING to aim at. The part declared
   *    nothing, so it has nothing to lose: it resolves and its `run` says so
   *    (R71's "with no ally it simply does nothing — it cannot fizzle").
   *  · an `EntityId` — aimed. If that entity is gone by the time the part
   *    resolves, the part is lost and the item FIZZLES, which is what the
   *    owner asked for: several triggers may all be aimed at one unit and the
   *    ones that outlive it fizzle rather than being re-aimed at a bystander.
   *
   * ON THE PART, not the item, for the same reason `mode` and `costPaid` are:
   * a graft composite can carry several subject-bearing parts, and `part` is
   * what an R85 suspension carries across the round trip.
   */
  subject?: EntityId | null;
}

/**
 * R29 — an open spot in a formation, named in a way that SURVIVES the board
 * moving. A play-time placement is chosen at cast and taken at resolution, and
 * between the two a column can collapse (R72), widen, or lose the unit the
 * spot was measured against (R5/R56). An index into a slot list would quietly
 * become a different slot; each of these is re-derived against a freshly
 * computed `E.formationSlots` and simply fails to match when it is gone.
 *
 *  · `end`    — a new column at the left or right end of the attacking line
 *  · `behind` — the back slot of the column that unit is standing in, alone
 *  · `hole`   — the front slot of an emptied column (an R72 hole)
 *  · `out`    — the printed "you MAY": played, but not into the formation
 */
export type FormationSpot =
  | { kind: 'out' }
  | { kind: 'end'; end: 'left' | 'right' }
  | { kind: 'behind'; unit: EntityId }
  | { kind: 'hole'; column: number };

export interface StackItem {
  id: number;
  kind: 'unit' | 'spell' | 'spellUnit' | 'spellToken' | 'virus' | 'triggered' | 'activated' | 'ambush';
  card?: CardName;
  label: string;
  controller: Seat;
  region: number;
  x?: number;
  negated: boolean;
  parts: EffectPart[];
  /** R35 + {Modular}: mods applied to this card AS IT WAS PLAYED (Spellbind).
   * They are an additional CAST COST — paid before the item reaches the stack
   * — so they ride on the stack with the spell and a copy would copy them
   * (Caleb 2025-02-07). A graftable mod also contributes its [Switch] effect
   * as an extra part, exactly like a graft under a unit's graft cause.
   *
   * R105: ANY card may be applied, not just a graftable one (owner ruling,
   * 2026-08-23). A mod's type-line [Augment] attributes are donated to the
   * resolving effect via `E.stackModAttrs`; its text-box [Augment] abilities
   * donate nothing, because a spell has no body for them to live on. A card
   * with neither rides along inertly, which is legal and deliberate.
   *
   * Anything in this list makes the carrier {Unstable}: `payModularMod` stamps
   * `unstable` below, and the pile is ERASED rather than binned (Manual p.35 —
   * "even though mods can be applied from the bin, they are generally only
   * able to be applied once"). */
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
  // R263: `'deck'` joined the union. Tides of the Cosmos plays off the REVEALED
  // TOP OF THE DECK, and the owner's ruling is about where a play originates —
  // *"If it originates from the cache or bin or somewhere else, it's not played
  // from the hand."* Forcing that into one of the other three would make Proph
  // and Stalwart Sentinel read a lie rather than a blank.
  from?: 'hand' | 'cache' | 'bin' | 'deck';
  /** R29: for a card whose text is "you may PLAY me into an open spot in your
   * formation" (CardBehavior.playsIntoFormation) — WHERE it is being played,
   * chosen at cast like every other part of how a card is played (R35) and
   * taken at resolution, atomically with the spawn. Absent on every other
   * item, and absent even on this one when the caster has no formation to join
   * (nothing is asked). Contrast R75, where placement is an EFFECT resolving
   * and is chosen then. */
  formationSpot?: FormationSpot;
  /** R49: non-mana ACTIVATION costs that carry a CHOICE (which card to
   * discard, which unit to sacrifice), still to be paid. Collected in the cast
   * window — before the item reaches the stack — so nobody may respond between
   * an activation's cost and its effect. Atoms are popped as they are paid;
   * the list is deleted when it empties.
   *
   * R122: 'playSacrifice' is not an activation's cost but an IMPOSED
   * additional cast cost on the PLAY itself — "Cards your opponents play
   * during battle gain '[Sacrifice a unit]'" (Vengeance, CostMod.sacrifice).
   * Attached by playAtTiming with `n` = the summed count, paid by the paying
   * player's own picks through the same collector, mandatory once the play
   * is declared (castability already gated on it being payable). */
  pendingCosts?: {
    kind: 'discard' | 'sacrificeOther' | 'discardOrSacrifice' | 'playSacrifice';
    n: number;
    /** R196 (`AbilityCost.sacrificeNontoken`): "another NONTOKEN unit" —
     * narrows which units this atom may name, and what payability asks about. */
    nontoken?: true;
  }[];
  /** R57: the choice-free half of an activation cost (mana, life, debt,
   * sacrifice-self), carried on the item so it can be charged AFTER the
   * ability's targets are chosen rather than at the moment of activation.
   * Deleted the instant it is paid, which is also the idempotence guard —
   * collectTargets re-runs from the top after every answered decision. */
  activationCost?: import('./cards/dsl.ts').AbilityCost;
  /** R49: receipt of the item-level activation costs above */
  paidCosts?: { discarded?: CardName[]; sacrificed?: CardName[] };
  /** R79: viruses augmented onto this item WHILE IT SAT ON THE STACK
   * (Caleb 2025-04-06: "In Battle, can you augment a spell with a virus …
   * Yes. This notably only works with attributes."). Only the donated
   * `augmentAttrs` do anything — a spell has no body for a static or a
   * triggered ability to live on (Caleb 2025-04-24). Distinct from `mods`,
   * which is the {Modular} CAST COST paid on the way to the stack: these were
   * applied afterwards, as a response, by either player. A carrier is MODDED,
   * so it is {Unstable} and its card never reaches a bin (R69).
   *
   * `by` is who APPLIED it, which is not the item's controller when you virus
   * an enemy spell — a card belongs to its owner, so that is the erased pile
   * it lands in and the mod owner it becomes on a spell unit's body. */
  augments?: { card: CardName; by: Seat }[];
  /**
   * R96/R105: this card is {Unstable}. A STAMP, not a derivation, and TWO
   * cards write it:
   *
   *  · R96 — it was played from a zone that makes it Unstable (today, out of a
   *    bin under Abyssal Evocation). It rides onto the spawned body of a spell
   *    UNIT played this way (Entity.unstable), which is the edge Spell
   *    Excavation's own note left open.
   *  · R105 — a {Modular} mod was applied to it as it was played. Stamped in
   *    `payModularMod`, at CAST, before the item ever reaches the stack: a
   *    modded card is Unstable (Manual p.35), and stamping at the moment of
   *    modding means every exit — resolution, R5 fizzle, negation — reads one
   *    flag rather than re-deriving the same fact three times.
   *
   * `augments` (R79) is the THIRD way in and is derived rather than stamped,
   * so `dischargeItem` and `negate` check both this flag and that list.
   */
  unstable?: boolean;
  /**
   * R164 — this item is a COPY of a spell (Earthbound Replicator, Maelstrom
   * Charger), not the spell itself. It is a real stack item: respondable,
   * negatable, targetable as an effect.
   *
   * RAQ "[Solved] Earthbound Replicator. No, it's not infinity" (_passer):
   * *"Copy is new spell effect on stack"* and *"Copy spell is not a token."*
   * — hence a genuine `StackItem` of the ORIGINAL's kind carrying this flag,
   * rather than a reused `spellToken` kind.
   *
   * WHAT THE FLAG BUYS, and it is one thing: **a copy has no card.** The card
   * is still the original's, sitting on the stack underneath it (or already in
   * a bin). So every disposal path has to be told that this item's `card`
   * names what it is a copy OF and is not an object it may move:
   * `dischargeItem` bins nothing, `negate` bins nothing, `itemIsUnstable`
   * cannot erase a card that does not exist, `disposeItemMods` does not erase
   * the ORIGINAL's mods a second time, and `EffectCtx.eraseSelf()` — "Erase
   * me." on Suspend / Temporal Rift — correctly does nothing at all.
   *
   * IT IS ALSO NOT PLAYED, which is the other half of the same RAQ: *"He
   * copies only PLAYED non-unit Spells. This means targeting him with copy he
   * created is possible, but he won't make 2nd copy, since 1st copy wasn't
   * 'played'. Sorry. No infinite loop there."* So a copy fires no
   * `spellPlayed` and no `cardPlayed`, bumps no `spellsPlayed:` ledger and
   * spends no play discount — `E.pushSpellCopy` bypasses `commitItem` and
   * pushes. It DOES dispatch `targeted` for its own targets: a copy that
   * points at your unit is targeting it, whoever put it there.
   */
  copy?: boolean;
  /**
   * R178 — the answers to every AS-YOU-PLAY option offered against this play
   * (`CardBehavior.asYouPlay`; Maelstrom Charger is the only card printing one
   * today). Collected in the cast window, LAST, by `E.collectAsYouPlay`.
   *
   * ON THE ITEM for `formationSpot`'s and `mode`'s reason: the collector is
   * resumable — `collectTargets` re-runs from the top after every answered
   * decision — so where it had got to has to be serializable state and not a
   * local. `asked` is the idempotence guard and holds `${anchorId}:${face}`
   * keys, NOT card names: an Ancient One projecting a Charger's face is a
   * second, separate offer made by a different body (RAQ: *"This works with
   * Ancient One adjacent to Maelstrom Charger"*), and one anchor can in
   * principle carry two faces that both print an option.
   *
   * `copies` is what the accepted options BOUGHT: one entry per copy owed,
   * materialised by `E.pushSpellCopy` only once the original is on the stack,
   * so the copy lands ABOVE it (RAQ: *"above original spell effect"*) and
   * resolves first. `aim`/`targets` are the printed "you may choose new
   * targets for the copy", asked in this same window so that the opponent's
   * first response window sees a fully declared copy (R57).
   *
   * ⚠ NOT cloned onto a copy by `pushSpellCopy`: these are facts about a PLAY,
   * and a copy is not played.
   */
  asYouPlay?: {
    asked: string[];
    copies: {
      /** the anchor that paid — for the log, and it may be dead by now */
      by: EntityId;
      /** the face the option was printed on (Ancient One projects it) */
      via: CardName;
      /** undefined = not yet asked; 'keep' = the original's targets ride */
      aim?: 'keep' | 'new';
      targets?: TargetRef[];
      done?: boolean;
    }[];
  };
  /**
   * The printed "Erase me." / "Erase this spell." clause — Collect Remains,
   * Suspend, Temporal Rift.
   *
   * A resolving spell is disposed of by `E.dischargeItem` AFTER its effect has
   * run, so a self-erase cannot erase a card that is still on the stack: it has
   * to REDIRECT that disposal. This is the redirect. `EffectCtx.eraseSelf()`
   * raises it while the effect resolves, and `dischargeItem` sends the card to
   * the erased pile (R65) instead of the bin.
   *
   * ON THE ITEM, not on a field of the engine, because the whole game is
   * `seed + actions` and a resolution can suspend mid-part (R85): the flag has
   * to survive being structuredCloned into the suspension and replayed out of
   * it, and anything living outside GameState would not.
   *
   * NOT `unstable`, which is next door and looks like the same thing. R79's
   * Unstable is a STAMP on the object — a virus rode it, or it was played out
   * of a bin — and it therefore survives negation and fizzling, which is
   * exactly why `dischargeItem` erases a negated carrier. "Erase me" is an
   * INSTRUCTION in the effect text, so it only exists once the effect has
   * actually resolved. Two different reasons, two different log lines.
   */
  eraseSelf?: boolean;
  /**
   * R143 — "…gains control of me" on a SPELL UNIT: the seat the body ENTERS
   * under. `afterParts` spawns it as this seat's unit and keeps `controller`
   * (the caster) as its OWNER, which is exactly R107's owner≠controller split.
   *
   * The same shape as `eraseSelf` directly above, raised by
   * `EffectCtx.spawnUnder()` while the spell part runs, and ON THE ITEM for
   * the same R85 reason: a part may suspend mid-resolution and be replayed out
   * of the serialised suspension, and `item` is what the suspension carries.
   *
   * WHY IT IS NOT A HANDOVER. Hush Mush used to spawn under its caster and
   * change hands from its own `spawned` trigger. That intermediate state is
   * observable — every "whenever another ally spawns" watcher the CASTER
   * controls fires on a body that was never meant to be theirs (report #96,
   * Flourishing Flora). One spell resolution, one controller: the body has to
   * arrive already theirs, so there is no window to observe.
   *
   * Absent on every item whose body enters under its own controller, which is
   * all of them but this one. Per ITEM, so two copies resolving in one region
   * cannot share an answer.
   */
  spawnUnder?: Seat;
  /**
   * R147 — *"I become an exact copy of that unit."* on a SPELL UNIT (Borrower
   * of Forms): the BODY the spell unit enters play wearing.
   *
   * `spawnUnder` directly above answers "whose is it?"; this answers "what is
   * it?", and for exactly the same reason and in exactly the same place. The
   * body is spawned by `afterParts`, after every part has run, so an effect
   * cannot reach it; raised by `EffectCtx.spawnWearing()` while the spell part
   * runs, and ON THE ITEM so it survives an R85 suspension round trip.
   *
   * WHY IT IS NOT A TRIGGER. Borrower of Forms used to park the copied face on
   * a per-REGION ledger (`copyParks`) with the copied numbers on `bof:*`
   * battle counters, and claim both from the body's own `spawned` trigger. The
   * body therefore ENTERED as a plain 2/2 Borrower of Forms and became the
   * copy a whole resolution later: R1's own worked example, Nectar Ridge
   * Oracle's *"when an ally with greater defense than power spawns"*, read the
   * wrong body, and the caster was asked to order the copy trigger against
   * every other ally-spawn trigger it raced. One spell resolution, one body.
   *
   * The ledger was also a COLLISION: keyed by region and not by caster, two
   * Borrowers resolving in one region before the first's trigger resolved shared
   * one slot — the second ate the first's face and both sets of copied
   * counters, and the first body stayed a Borrower of Forms for good. Per ITEM,
   * that cannot be expressed.
   */
  spawnWearing?: SpawnFace;
  /** triggered/activated: source entity (may be gone by resolution) */
  sourceId?: EntityId;
  /** R131: carried over from PendingTrigger — the MOD ENTITY whose donated
   * [Augment] text is resolving, so "my other Augments" can exclude exactly
   * one entity (itself) by id rather than by card name. */
  selfModId?: EntityId;
  /** virus: host target */
  hostId?: EntityId;
  /** R79: virus — the STACK ITEM this virus is being augmented onto, when its
   * host is a spell rather than a unit. Exactly one of hostId / hostStack. */
  hostStack?: number;
  /** R1 event snapshot for triggered abilities (amounts still read live state) */
  event?: EngineEvent | null;
}

// ── decisions (docs/04 decision-point model) ──────────────────────────

export type DecisionKind =
  | 'targets'        // choose a target for a part of a pending cast/trigger
  | 'orderTriggers'  // order your simultaneous triggers (R2)
  | 'electricPath'   // choose next unit for electric excess (R4) — options are RAW ENTITY IDS
  | 'formationSlot'  // R75/R29: which open formation slot a unit joins (values are NOT entity ids)
  | 'payOrDecline'   // "unless its controller pays [x]" (R6)
  | 'mode'           // which half of a modal effect (R57, EffectPart.mode)
  | 'assignDamage'   // R120: elective combat-damage split over a column's victims
  | 'number';        // R197: TYPE A NUMBER — `choice` IS the value, not an index
  // (graft insert position rides on the graft ACTION itself, not a decision)

/**
 * R197 — the range a `kind: 'number'` decision will accept.
 *
 * ⚠ THIS KIND CHANGES WHAT `Action.choice` MEANS, and that is exactly why it
 * is a kind of its own. For every other DecisionKind `choice` is an INDEX into
 * `options`; for `'number'` it is **the number itself**, and `options` is
 * EMPTY so that no caller can read an index out of it by habit. A decision
 * kind is a CONTRACT about what its values mean, and the last time one was
 * reused loosely — `electricPath`, whose values are raw entity ids, beside
 * `formationSlot`, whose values are slot indexes — the client pinged the wrong
 * units and it read to the player as "placement isn't working".
 *
 * WHY it exists: "Predict your life total" (Prediction Prophet) takes ANY
 * number. An option list is finite, so the menu ran `0 … life + 5` and a
 * prediction further above where you stand could not be entered at all. The
 * owner's standing steer (2026-08-24) is that cards are literal and open —
 * *"Don't assume that cards are limited, they're designed to be open ended…
 * It's not on rails"* — so an arbitrary cap is precisely the narrowing that
 * steer forbids, and the answer is a real numeric entry, not a bigger guess.
 *
 * `legalActions` cannot enumerate an unbounded range, so — exactly as
 * `pickOrder` already does for permutations — it offers REPRESENTATIVES and
 * `apply()` validates any value in range the client builds.
 */
export interface NumericEntry {
  /** smallest accepted value (inclusive) */
  min: number;
  /** largest accepted value (inclusive), or `null` for "no ceiling at all" */
  max: number | null;
  /** where a client's dial starts, and the value the prompt is anchored on
   * ("where you stand now"). Always inside [min, max]. */
  suggest: number;
  /** how the client labels the suggestion, when it is worth naming */
  suggestLabel?: string;
}

export interface DecisionOption {
  label: string;
  /** payload the UI/fuzzer sends back as the choice */
  value: unknown;
  /** when the option IS a card (hand looks, deck tops, bin picks), its name —
   * the client renders the real scan instead of a text label */
  card?: CardName;
  /** R74: this option is LEGAL but is a known trap — taking it makes the
   * effect a guaranteed no-op. The text is already appended to `label`, so a
   * client that ignores this field still shows the warning; the field exists
   * so a client that cares can STYLE it as a warning rather than as prose.
   * Never a prohibition: the option is offered and may be taken. */
  warning?: string;
  /**
   * R288 / BL-30 — this option is LEGAL and probably a MISCLICK: the client
   * should ask before taking it. The text is the question to ask.
   *
   * The owner, 2026-08-26: *"there are many cards in the game that you can
   * TECHNICALLY point at several of your own units (Fight, Organic Exchange).
   * We shouldn't stop that from happening, they're legal targets, but it might
   * be nice to add a small warning … (Did you mean to target allies with this
   * spell? Yes or No, rechoose targets)."*
   *
   * ⚠ A SECOND FIELD RATHER THAN A SECOND MEANING FOR `warning`, and the two
   * are genuinely different questions. R74's warning says *this will do
   * nothing* — a fact about the effect, shown as prose beside an option a
   * player may well want anyway. This says *you may have clicked the wrong
   * thing* — a guess about the PLAYER, which is only worth making if something
   * interrupts them. Folding them together would have put a confirm dialogue
   * in front of every R74 option that has never needed one.
   *
   * ⚠ AND IT IS NOT APPENDED TO `label`, which is where R74's convention had
   * to be broken. `server/rooms.ts::referenceKey` records a `decide` by its
   * chosen options' LABELS, so text moved into a label re-keys every saved
   * game holding that decision and R200 reports the cosmetic change as
   * divergence — the same trap `count` documents two fields up. The client is
   * the only reader and reads this field.
   *
   * NEVER A PROHIBITION. The option is offered, it is legal, and answering
   * "yes" resolves it exactly as it would have resolved without this field.
   */
  confirm?: string;
  /** HOW MANY objects this one option stands for. Only set where the menu
   * deliberately collapses indistinguishable copies into a single row — today
   * that is the bin (R124/R131: a bin holds bare card names, so `{erase: name}`
   * names the card and two rows reading "The Foretold" would be the same
   * option twice).
   *
   * The count is NOT in `label`, and that is deliberate: `referenceKey`
   * (server/rooms.ts) records a `decide` by its chosen options' labels, so
   * moving the count into the label would re-key every saved game holding one
   * of these decisions and report cosmetic drift as R200 divergence.
   *
   * Playtest report DWYV/2026-08-27: a two-card bin drew ONE scan with nothing
   * saying so, which reads as "there is one card here". The owner picked twice
   * to make it register, paid X = 2 on a scenario built to test X = 1, and the
   * branch under test never ran. */
  count?: number;
  /**
   * Report #107 — WHERE on the board this option puts a unit, for a
   * `kind: 'formationSlot'` decision. DISPLAY ONLY: the client draws a drop
   * target on the line instead of a button in the top bar, because with only
   * `label` prose it could not do that even in principle — the data was not
   * there.
   *
   * ⚠ THE ANSWER NAMESPACE IS UNCHANGED AND MUST STAY UNCHANGED. R75's
   * `placeInFormation` is still answered by the option's INTEGER INDEX
   * (`value`), which is what `server/rooms.ts` `referenceKey` and the R200
   * forensic stack key every saved game's `decide` on. Nothing may read this
   * field to RESOLVE an answer; it is a second, redundant spelling of the same
   * option, carried so a client can point at it. (R29's own ask already sends
   * the spot as its `value`; there it is set to the same thing, so every
   * formation ask has one payload shape.)
   */
  spot?: FormationSpot;
}

export interface Decision {
  id: number;
  seat: Seat;
  kind: DecisionKind;
  prompt: string;
  options: DecisionOption[];
  /** multi-pick decisions (orderTriggers) expect an array of option indices */
  pickOrder?: boolean;
  /** BL-25/R139: this decision takes COUNTERS off something, and this is the
   * most one pick of it may take — the number a client's quantity stepper
   * maxes out at and its "All" button jumps to. Set by the engine (never
   * recomputed client-side: `E.counterPickMax` reads the same `counterPool`
   * the payability check does, so the two cannot drift). Absent on every
   * decision that is not about a quantity of counters. */
  counterMax?: number;
  /** R197: present on exactly the `kind: 'number'` decisions, and on nothing
   * else. See `NumericEntry` — it is the whole question, because `options` is
   * empty and `choice` is the value. */
  numeric?: NumericEntry;
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
       * bracketed [cast cost] (EffectDef.castCost).
       * 'formation' (R29): WHERE a "play me into an open spot in your
       * formation" card is being played — part of the play, so part of the
       * cast window, and the answer rides on the item as `formationSpot`.
       * 'mode' (R57): WHICH HALF of a modal effect ("[… or …]"), answered
       * onto `parts[partIndex].mode` — declared before the item reaches the
       * stack so the opponent can see what they are responding to.
       * 'subject' (R144): WHICH ENTITY an untargeted effect is aimed at
       * ("put a -1/-1 counter on an ally"), answered onto
       * `parts[partIndex].subject`. Same window and same reason as 'mode' —
       * the aim is part of declaring the effect — but it can go STALE, and a
       * part whose subject has left play fizzles.
       * 'asYouPlay' (R178): a cost-shaped, NON-STACK, optional decision that
       * ANOTHER card in play offers while this one is being played ("As you
       * play a nonunit spell, you may sacrifice me…" — Maelstrom Charger).
       * The LAST stage of the window, so everything else about the play is
       * declared before it is asked; the answers land on
       * `StackItem.asYouPlay`, and `E.applyAsYouPlay` reads them back. */
      stage?: 'x' | 'mods' | 'cost' | 'itemCost' | 'formation' | 'mode' | 'subject'
        | 'asYouPlay';
    }
  | {
      /** ordering simultaneous triggers for one seat (R2) */
      type: 'orderTriggers';
      seat: Seat;
    }
  | {
      /** R120: collecting one striking column's ELECTIVE damage split, one
       * victim at a time, before the sub-step assigns anything. `key` names
       * the strike (`${sub}:atk:${ci}` / `${sub}:blk:${ci}`) in
       * `BattleState.assignPlans`; the `decide` answer lands there and the
       * damage pump re-runs the collection pass, which either asks about the
       * next victim or finds every plan complete and lets the sub-step
       * assign. Same discipline as 'orderTriggers': the suspension is raised
       * BEFORE anything is mutated, so the replay is a from-scratch re-entry,
       * not a rollback. */
      type: 'combatAssign';
      seat: Seat;
      key: string;
    }
  | {
      /** R121: Crevice Lurker's pay-to-trigger gate — `trigger` has been
       * taken off the triggerQueue and waits on its controller's
       * payOrDecline answer: pay `tax` and it goes to the stack, decline and
       * it simply does not happen (its bounded [once] handed back,
       * R108/R113). Plain serializable data like every arm here, so the
       * pending question survives a JSON round-trip and a replay. */
      type: 'payTrigger';
      trigger: PendingTrigger;
      tax: number;
    }
  | {
      /** mid-resolution choice (R4 electric, R6 payments): replay item.parts[partIndex]
       * with answers filled in until it completes without suspending */
      type: 'resolve';
      item: StackItem;
      partIndex: number;
      answers: Record<string, unknown>;
      pendingKey: string;
      /**
       * The rest of a multi-item cast chain ({Burst} tokens) and the `then`
       * `castChain` was running it with. castChain keeps the unstarted items in
       * a local, and a PartChoice thrown out of the FIRST item's resolution
       * abandons that local — so without these two the chain's tail was simply
       * lost. Carried from commitItem → resolveItem → resolveParts onto the
       * suspension, and doDecide's resolve branch runs `castChain(moreItems,
       * then)` once the resumed item has finished, exactly where castChain's
       * loop would have picked up.
       *
       * Optional: a suspension saved before these existed has neither and
       * resumes exactly as it always did (the item alone); and a 'resolve'
       * suspension raised from OUTSIDE a chain (resolveTop, a trigger resolving
       * inline in settle) carries none either.
       */
      then?: 'push' | 'resolve';
      moreItems?: StackItem[];
      /**
       * R85 — the state the replay restarts FROM, kept here instead of being
       * applied the instant the part suspends.
       *
       * `ctx.choose` is not a coroutine: it throws, and the part is re-run from
       * the top with the recorded `answers`. That needs the world back at the
       * part boundary, and until playtest round 15 the rollback happened AT
       * THE SUSPENSION — which meant the state published while a player was
       * being asked something showed NOTHING of the resolution so far. "During
       * the resolution of Insidious Invitation, I should have seen what my
       * opponent played … I couldn't see anything until I declined" (UFAB,
       * 2026-08-22): the caster's unit was not in play and the draw had not
       * happened, because both had just been rolled back.
       *
       * So the rollback moved to RESUME (E.resumeResolve). The state that sits
       * on the table while the question is open is the real, partly-resolved
       * one; this snapshot is what the engine quietly rewinds to the moment the
       * answer arrives. Engine-internal and completely unredacted — server/
       * view.ts strips it before any client sees a suspension.
       *
       * Optional: a suspension serialized before round 15 simply has no
       * snapshot, and E.resumeResolve replays from wherever it is — exactly the
       * old behaviour, which is what those states were saved under.
       */
      snapshot?: GameState;
      /**
       * How many events THIS part has already emitted onto the table. The
       * replay deterministically re-emits every one of them before it reaches
       * the answered choice, so resolveParts drops that many from the front of
       * the replay's output and the log never doubles.
       */
      shown?: number;
    };

// ── events ────────────────────────────────────────────────────────────

export type EventType =
  | 'phase' | 'turn' | 'draw' | 'draft' | 'recycle' | 'resourceActivated'
  | 'spawned' | 'died' | 'despawned' | 'erased'
  | 'spellPlayed' | 'stackPushed' | 'resolved' | 'negated' | 'fizzled'
  // R129: "when a CARD is played". `spellPlayed` is the NARROW event and keeps
  // its exact meaning (spell / spell unit / spell token); `cardPlayed` is the
  // wide one and fires ALONGSIDE it for the kinds that are a CARD being
  // played — spell, spell unit, {Battle} unit and Ambush. NOT a spell token
  // ("Tokens are NOT cards", owner 2026-08-24) and NOT a mod application
  // (R37). Signal-only: `msg` is '' because every play already announces
  // itself on `spellPlayed`/`spawned`, so this adds no log line.
  | 'cardPlayed'
  | 'triggered' | 'targeted' | 'modApplied' | 'grafted'
  | 'attackDeclared' | 'blocksDeclared' | 'attacked' | 'blocked'
  | 'combatDamage' | 'afterCombat'
  // R238: ONE SEAT'S FACE DAMAGE FROM ONE COMBAT SUB-STEP — the event every
  // "when my column deals combat damage to a player" clause is really about.
  // `lifeLost` used to stand in for it and could not: a hit the R38 hooks
  // REPLACE (Blightsea Polyp's "as 1 rot") costs no life, so no `lifeLost`
  // fires at all, and Caleb ruled 2024-10-24 that a replaced hit still counts
  // as DEALT. Emitted per victim seat per sub-step whenever any of the
  // attacker's columns dealt face damage, replaced or not, with
  // `{ seat, by, n, why: 'combat', hits }` — `hits` is engine.ts's
  // `FaceDamageHit[]` breakdown and `n` is the damage DEALT, which is not the
  // life lost. Signal-only (`msg` is ''): the loss, or the replacement, has
  // already announced itself.
  | 'combatFaceDamage'
  | 'damage' | 'lifeLost' | 'lifeGained' | 'tokenCreated' | 'statChanged' | 'countersChanged'
  // Light & Dark player counters and the trash zone-change (R38/R39/R40)
  | 'rotGained' | 'debtGained' | 'debtPaid' | 'trashed'
  // R179: the two player counters going the OTHER way (Burn the Blight,
  // "Remove all counters from units and players"). Fired by E.loseRot /
  // E.loseDebt with `{ seat, n, total }` — `n` is how much actually went,
  // after the clamp at zero — so a card watching a player's counters can see
  // them leave as well as arrive. NOT scaled by an AmountMod: the owner ruled
  // that "Resonater says 'put on'", and a removal is not putting on.
  | 'rotLost' | 'debtLost'
  // R179: ONE OR MORE CARDS ENTERED A HAND. Fired by `E.toHand` — the one
  // hand-entry point every route in the tree now goes through (a draw, a
  // recall out of play, a bin recursion, a pull off the stack, an uncache,
  // and a card taken out of an opponent's hand) — with
  // `data: { seat, from, cards, card, n }`, plus `unit` when the move is a
  // recall (so "one or more OTHER cards" can exclude the carrier) and `token`
  // for R69's hand window. `seat` is the hand that was ENTERED, never the
  // card's owner and never the mover.
  //
  // ⚠ A MULTI-CARD MOVE IS ONE EVENT, exactly as a multi-card 'draw' is
  // (`n` carries the count), because the three cards that read it print
  // "whenever ONE OR MORE other cards enter a player's hand".
  //
  // Signal-only (`msg` is ''): every call site already announces itself in its
  // own words. Dispatched only during battle, for the reason `draw` gives.
  | 'handEntered'
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
  // R102: a card's `replaceRotDamage` hook consumed a player's rot damage.
  // Fired by E.replaceRotDamage the moment a hook returns true, INSIDE
  // rotDamage()'s settle() window, so the replacement can put a real triggered
  // effect on the stack instead of having to finish inline: the hook's
  // signature has no EffectCtx and no ctx.choose, which is exactly why
  // "put that many -1/-1 counters on TARGET unit instead" (Beyond, Codex
  // Incarnate) had nowhere to ask its question. `data` carries `seat` (who
  // would have taken it), `n` (how much was replaced), `card`, and `unit` —
  // the ANCHOR entity, so a `self: true` listener on the replacing card
  // matches and nobody else's does.
  | 'rotReplaced'
  // R124: a card LEFT a player's bin. Fired by E.removeFromBin — the ONE choke
  // point every bin removal in the tree goes through — with
  // `data: { seat, card, reason }` (`seat` = the bin's owner, `reason` a short
  // verb like 'recalled'/'erased'/'cached'/'modded' (an augment or graft
  // applied out of the bin) for anyone reading the event
  // stream). A bulk sweep (Finality, Reality Siphoner, Zephyrzoa) fires it
  // once PER CARD, back-to-front. `msg` is '' on purpose: every removal site
  // already announces itself in its own words, so this is a signal-only event
  // (the harness keeps empty messages out of the game log — the stackFlash
  // precedent).
  | 'leftBin'
  // R148: a unit (or a spell token) CHANGED CONTROLLER. Fired by
  // `E.giveControl` — the one control-change primitive every card routes
  // through (CT-38) — with `data: { unit, card, from, to, region }`, where
  // `region` is where the unit stands AFTER the move, so the R12 scoping in
  // fireEvent hands it to both present seats' listeners and to nobody else.
  // It carries the log line the primitive used to emit as plain `info`, so
  // this is not a signal-only event: the message is unchanged.
  //
  // ⚠ It fires only when something really changed hands. The two "nothing
  // changes hands" branches (the unit is gone, or the seat already controls
  // it) still emit `info` and dispatch nothing, because no controller changed.
  // Nothing in the pool listens for this YET — it was added WITH CT-38's three
  // fixes, which is what makes it testable rather than untested surface.
  | 'controlChanged'
  | 'regroup' | 'endOfTurn' | 'gameOver' | 'info'
  // CLIENT-ONLY, and the one event with no log line of its own (msg is ''):
  // an item that resolved with no response window ever gets to sit on the
  // stack, so the client would never see it there. This carries the whole
  // StackItem, snapshotted the instant before it resolves, so ui/flash.ts can
  // put it on the visual stack for a beat. Nothing in the rules reads it, and
  // the empty message keeps it out of the game log (harness.ts / view.ts).
  | 'stackFlash';

/** Engine events double as the game log: every one carries a rendered message. */
export interface EngineEvent {
  type: EventType;
  msg: string;
  data?: Record<string, unknown>;
}

// ── actions ───────────────────────────────────────────────────────────

/**
 * WHICH ability list an `activateAbility` addresses — the other half of
 * `abilityIndex`, which indexes into whatever this names.
 *
 *   undefined                the unit's own `abilities`, read off its IDENTITY
 *                            face (R118): the copied card when it is wearing
 *                            one, its own card when it is not.
 *   'augment'                the same face's text-box [Augment] clause, which
 *                            is live when the card is played normally.
 *   { mod }                  text donated by that augment mod. A mod is never
 *                            copied, so this arm always means the mod's own
 *                            physical card.
 *   { face }                 R118: a face that is NOT the identity one — one
 *                            being projected onto the unit right now ("I have
 *                            all abilities of adjacent allies", Ancient One).
 *                            `text: 'augment'` selects that face's
 *                            `augmentText` instead of its `abilities`, which
 *                            is how a neighbour's augment-donated ability is
 *                            addressed at all.
 *
 * ⚠ ADDITIVE, and it has to stay that way: the first three arms are byte for
 * byte what they always were, so an action log recorded before the `{ face }`
 * arm existed still parses and still replays identically. Nothing that was
 * previously expressible changed shape, and `text` is omitted for the common
 * `abilities` case so a new log stays minimal too.
 *
 * `pushActivatedOptions` (the offer) and `activationSource` (the accept) in
 * apply.ts BOTH derive this from `E.facesWith(u, 'activated')` and must keep
 * agreeing — the fuzzer's "legalActions lied" invariant is the guard.
 */
export type ActivateVia =
  | 'augment'
  | { mod: EntityId }
  | { face: CardName; text?: 'ability' | 'augment' };

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
   * trashed" trigger (Dropslime, Nothyr).
   * `eraseGrant` (R123): this haste-step play is funded by a grantor card in
   * the seat's OWN bin ("play a unit as if it had [Haste] by erasing me as an
   * additional cost" — Writhing Host). No bin index rides on the action:
   * every grantor is a fungible copy of one card, so apply re-finds the first
   * (E.binHasteGrantorIndex) and erases it when the play's costs are paid —
   * a stale index cannot desync a replay. */
  | { type: 'playCard'; seat: Seat; handIndex: number; mode?: 'ambush' | 'discardMe'; eraseGrant?: boolean }
  /** R42: cache a card with a printed prophecy banner, paying the banner's
   * plain mana (no affinity pips). DEPLOYMENT ONLY. `from` is 'hand' unless
   * the card itself says otherwise ("I can be prophesied from your bin" —
   * Angel of Anguish, CardBehavior.prophesyFromBin). */
  | { type: 'prophesy'; seat: Seat; from: 'hand' | 'bin'; index: number }
  /**
   * R96: play a spell out of your OWN bin, under a permission granted this
   * battle ("In this battle, you may play spells from your bin" — Abyssal
   * Evocation). Its own variant, following `prophesy`'s precedent, rather than
   * a loosened `playCard`: `playCard` means "out of your hand" everywhere in
   * the engine, replay corpus included, and widening it would silently
   * re-index every saved game's hand plays.
   */
  | { type: 'playFromBin'; seat: Seat; binIndex: number }
  /** R42/R45: play a card out of your cache. Legal only with permission — a
   * fulfilled prophecy (free, ignoring affinity) or a glimpse-style
   * play-until-end-of-turn stamp (pay the mana, ignore affinity). Normal
   * TIMING still applies: it is played "as if it were in your hand". */
  | { type: 'playCached'; seat: Seat; index: number }
  | { type: 'castSpellToken'; seat: Seat; entityId: EntityId }
  /** see ActivateVia. abilityIndex indexes the resolved list. */
  | { type: 'activateAbility'; seat: Seat; entityId: EntityId; abilityIndex: number; via?: ActivateVia }
  // R41: 'cache' is a legal mod source — "you CAN augment or graft from cache"
  // (Caleb 2024-12-02), paying the mod's normal cost; a FULFILLED prophecy on
  // the cached card makes it free instead (Caleb 2024-12-03).
  // R79: `hostStack` aims a Virus at a SPELL ON THE STACK instead of a unit.
  // Exactly one of the two is given; the virus goes on the stack above its
  // host and resolves first, like any other response.
  | { type: 'augment'; seat: Seat; from: 'hand' | 'bin' | 'cache'; index: number; hostId?: EntityId; hostStack?: number }
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
      /**
       * R87 — the spell tokens riding out WITH those counterattackers, named
       * in the same field, with the same meaning, as `declareAttack`'s.
       *
       * Playtest report #67 (game GETD, 2026-08-22): *"What happened to
       * Rashi's Poison tokens here? She just wanted to bring them with her
       * attackers but they somehow went onto the stack"*. `declareAttack` has
       * always had this field and `declareBlocks` had not, so the client had
       * nowhere to put them and the only remaining use for a token was to cast
       * it where it stood — which is action 94 of that game, three Poison 1s
       * fired into a region everything had just left.
       *
       * Optional, and the two lists are simply concatenated on the way in, so
       * every saved game that put a token in `send` (which `apply` has always
       * accepted, even though nothing ever offered it) replays unchanged.
       */
      spellTokens?: EntityId[];
    }
  | { type: 'passPriority'; seat: Seat }
  | { type: 'doneDeploying'; seat: Seat }
  | { type: 'decide'; seat: Seat; choice: number | number[] }
  /** R65: give up. A real action so it lands in the log, replays with the
   * game, and reaches the result record the same way a lethal blow does.
   * Deliberately NOT in legalActions — it is never a move to consider, only
   * one to choose, and the fuzzer must never wander into it. */
  | { type: 'concede'; seat: Seat }
  /* ── BL-06: THE FOUR TEST-MODE CHEATS ───────────────────────────────────
   *
   * They are ACTIONS, and that is the whole design. The engine is a pure
   * reducer and replay/undo/the fuzzer all rest on that; a sandbox that
   * reached in and mutated a room's state out of band would break replay for
   * the one mode most likely to be used to reproduce a bug report. In the log
   * they rebuild with the game like anything else.
   *
   * ⚠ Every one of them is refused unless `GameState.sandbox` is true, and
   * that flag is set at DEAL TIME (server/scenarios.ts `dealSandbox`) — never
   * by an action. So no sequence of actions can turn an ordinary game into a
   * sandbox, and a log full of these replayed against a normal deal is refused
   * from the first one rather than quietly rewriting somebody's game.
   *
   * Like `concede`, none of them is in `legalActions`: they are never a move
   * to consider, and the fuzzer must never wander into them. */
  /** put any registered card into your hand, your board, or your bin. `to:
   * 'play'` needs a card with a body — a spell has none, and is refused by
   * name rather than spawned as an empty one. */
  | { type: 'sandboxSpawn'; seat: Seat; card: CardName; to: 'hand' | 'play' | 'bin' }
  /**
   * SET your open mana pool: `pool[kind]` open resources of each kind, and
   * nothing else.
   *
   * A set rather than an add, and the pool is REBUILT in a canonical kind
   * order (apply.ts `SANDBOX_KINDS`) rather than in the order the record's own
   * keys happen to arrive in. `PlayerState.resources` is indexed by
   * `activateResource` / `exchangePrismite`, so its order is part of the
   * board: deriving it from a fixed list makes the same action produce the
   * same array whatever a client's JSON did with the key order.
   */
  | { type: 'sandboxResources'; seat: Seat; pool: Partial<Record<ResourceKind, number>> }
  /** set a life total (a sandbox is dealt on 1000, and this is how you get
   * back there — or down to 3 to watch something lethal land) */
  | { type: 'sandboxLife'; seat: Seat; life: number }
  /**
   * Close the step the table is waiting on, FOR BOTH SEATS, until the phase
   * moves — so a solo sandbox can walk into deployment or into battle without
   * a second player and without a legal play to make.
   *
   * ⚠ It does NOT assign `phase`. server/scenarios.ts's `Scenario.prologue`
   * records why: "`GameState.phase` is not a knob, it is the consequence of
   * the actions taken to reach it, and assigning it directly would leave
   * `battle`, `priority`, `hasteDone` and the segment key describing a game
   * that never happened." This takes the real step-closing actions instead,
   * chosen out of each seat's own `legalActions`, so every trigger and every
   * end-of-step really runs. It stops the moment a decision opens: a question
   * is the human's to answer, not a step to skip.
   */
  | { type: 'sandboxAdvance'; seat: Seat };

// ── the whole game ────────────────────────────────────────────────────

export interface GameState {
  /**
   * BL-06 — this game was dealt as a TEST-MODE SANDBOX, and the four
   * `sandbox*` actions are legal in it.
   *
   * Set once, at the deal (server/scenarios.ts `dealSandbox`), and never by an
   * action: a room's state is a function of `(seed, mode, els, decks, deal id,
   * actions)`, so a sandbox is a property of the DEAL the way a scenario board
   * is. Every deal site routes through `dealScenario`, so the flag comes back
   * on a rebuild, a forensic replay and a stats fold alike — which is what
   * lets a sandbox game replay like any other game.
   *
   * Additive/optional: absent on every state serialized before it existed, and
   * absent on every ordinary game.
   */
  sandbox?: true;
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
  /**
   * R99, mode 'constructed' ONLY: the elements each seat's DECK is built from —
   * `deckElements[seat]` is the union of `getCard(n).factions` over that seat's
   * decklist, in the canonical `ALL_ELEMENTS` order.
   *
   * ⚠ THIS IS A PRESENTATION HINT, NOT A RULE. Ledger #63 (GETD, 2026-08-22):
   * "In constructed, the resource options from recycling and prismites should
   * be limited just to the elements that are in your deck. No need to put the
   * whole list for every single game when they're not relevant." — and it is a
   * MENU complaint, so it gets a menu answer. `legalActions` still offers all
   * seven, `doRecycleForResource` and `doExchangePrismite` still accept all
   * seven, and every saved game therefore still replays: nothing that was legal
   * became illegal.
   *
   * That restraint is load-bearing, not caution — BL-44, the owner, 2026-09-19:
   * *"it's technically legal to make a Fire resource, even if you don't have
   * any Fire cards in the deck […] we should be faithful to the game."* Making
   * an off-element resource is a legal play in its own right, whatever is in
   * the deck, so the client should DEFAULT the menu to this list and keep the
   * other elements reachable.
   *
   * ⚠ THIS USED TO CITE REAP THE DUE — "mono-light and scales off DARK
   * affinity, so a mono-light deck running it must still be able to take dark
   * resources or the card is blank". That was never true of the card: the
   * oracle file mis-transcribed its light pip as [d] and the example inherited
   * the error (corrected at source 2026-09-20; see
   * 309-element-identity.test.ts). The BEHAVIOUR was right for the reason
   * above and has not changed; only the example was wrong.
   *
   * Absent in 'shared' and 'draft': shared plays all seven, and draft already
   * narrows `elements` to its trio, so a second narrowing would be noise. A
   * client reading this must fall back to `elements` when it is undefined.
   *
   * Additive/optional — states serialized before R99 simply lack it.
   *
   * ⚠ OPEN, and shipped the conservative way: is a constructed deck's element
   * identity PUBLIC at game start? Right now this field is not redacted, so
   * BOTH seats can read both entries. See R99 for the one line in
   * server/view.ts that makes it owner-only if the owner rules it private.
   */
  deckElements?: Element[][];
  sharedDeck: CardName[];
  /** mode 'constructed': decks[seat] = that seat's own deck (top = index 0).
   * Absent in 'shared'/'draft', where sharedDeck is the one deck. */
  decks?: CardName[][];
  /**
   * R298, mode 'constructed' ONLY: a SINGLE CARD DUEL — both decks are thirty
   * copies of one card. The owner, 2026-09-18: *"there's no need to do the
   * draft step at all in this game since it's irrelevant to put cards on
   * bottom. Better to just draw two cards and go right to resources."* So the
   * turn's card step is shared's flat draw of 2 (Worldbender replaces it the
   * same way), and the constructed draw-4/bottom-2 never runs.
   *
   * Set by `createGame` off the decks themselves, not passed in: two
   * single-card decks can only be a duel (`checkDeck` refuses one anywhere
   * else), and deriving it means no deal site can forget it. Absent on every
   * other game, including every one saved before R298.
   */
  singleCard?: true;
  /**
   * R296 — THE RECYCLE PILE: everything that has been recycled since the deck
   * was last shuffled, waiting behind the mark.
   *
   * Recycling does not put a card on the bottom of the live deck. The
   * original end of the library is MARKED, recycled cards go past the mark,
   * and when the deck runs out the pile is shuffled and becomes the new deck
   * (with a fresh, empty pile behind a new mark). The owner, 2026-09-16:
   * *"This removes the need to try and remember (or worry about) what you
   * recycled and in what order."*
   *
   * Shaped exactly like the two fields above, and read through the same
   * seat-to-zone door: `E.recycleOf(seat)` is `E.deckOf(seat)`'s twin.
   * `sharedRecycled` is the communal pile in 'shared' and 'draft';
   * `recycled[seat]` is a seat's own in 'constructed'.
   *
   * Both are OPTIONAL and both are absent in every state serialized before
   * R296, which reads as "nothing recycled yet" — exactly right for an old
   * game, and what lets a pre-R296 room file restore and replay.
   *
   * The contents are secret like a deck's and are redacted by the same two
   * lines in `server/view.ts`; the COUNT is public, and is the second number
   * the client shows beside the deck.
   */
  sharedRecycled?: CardName[];
  /** mode 'constructed': recycled[seat] = that seat's own pile. See
   *  `sharedRecycled` — this is the same zone, per seat. */
  recycled?: CardName[][];
  /** mode 'constructed': non-null while the draw phase's bottoming runs;
   * bottomDone[seat] = that seat has put their 2 cards back this turn.
   * Cleared (null) once everyone is done. Mirrors draftDone. */
  bottomDone?: boolean[] | null;
  /** BL-43, mode 'draft' ONLY: the parts of a custom deal that play reads after
   * the deal itself — pack size (at every deal and refresh) and draws per turn.
   * The rest of the deal (elements, opening hand, life, the excluded cards) is
   * spent inside createGame and deliberately NOT carried here: a view is cloned
   * on every push, and a hundred excluded names would ride along each time.
   * Absent on every standard game and on every state from before BL-43. */
  draftDeal?: { packSize: number; draftDraw: number };
  /** R297, mode 'constructed' ONLY: a Learn to Play game's per-turn rules —
   * draws per seat (replacing the draw-4/bottom-2 step) and the Shard income.
   * The rest of the lesson deal (hands, stacking, prismites, life) is spent in
   * createGame. Absent on every other game. */
  lesson?: import('./lessondeal.ts').LessonRules;
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
   * unknowably (their draft-step merge). null = never seen / stale.
   *
   * CT-174(b) / report #156: `pending` is the seat whose hand this was taken
   * from, present only while the REVEALING MOMENT is still running. Every
   * hand-reveal in the pool but two goes on to move a card out of that hand
   * (a discard, a recycle, a cache, a take), and the snapshot is taken before
   * it — so the list told the looker to remember a card that is already gone.
   * `E.settleSeenHands` reconciles once, at the first safe point after the
   * moment ends, and deletes this field. Absent = already reconciled, and
   * NOTHING may touch `cards` after that: a snapshot that kept tracking the
   * hand would leak every later discard and play the looker never saw. */
  seenHand: ({ turn: number; cards: CardName[]; pending?: Seat } | null)[];
  players: PlayerState[];
  regions: Region[];
  entities: Record<EntityId, Entity>;
  stack: StackItem[];
  battle: BattleState | null;
  /** 0 = not in battle phase, else which battle round */
  battleRound: 0 | 1 | 2;
  /** per-seat counters reset each battle PHASE ("second ally death this battle") */
  battleCounters: Record<string, number>[];
  /* R147 DELETED `copyParks`, the per-region slot Borrower of Forms parked a
   * prepared face in between its spell resolution and its body's own spawn
   * trigger. There is no gap to relay across any more: the face rides the
   * spell's own `StackItem.spawnWearing` and is worn AS the body spawns. The
   * slot was keyed by region rather than by caster, so it was a collision as
   * well as a window — see `StackItem.spawnWearing`. */
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
  /** R102: the START-OF-DEPLOYMENT opening is in progress — R38's rot damage
   * (and anything it queued) is still draining, and the 'startOfDeployment'
   * event has NOT fired yet. The event waits for it (E.finishDeployStart,
   * called from settle()), exactly the way `hasteEnding` defers the phase flip
   * and `turnEnding` the turn flip.
   *
   * This exists because R102 gave the rot REPLACEMENT a target to choose:
   * Beyond, Codex Incarnate queues a triggered effect from inside
   * E.rotDamage(), and the decision that effect raises suspends out of
   * startDeployment() entirely. Before this flag the resumed decision landed
   * in doDecide's collectTargets/commitItem/settle path, which knows nothing
   * about the rest of startDeployment — so 'startOfDeployment' was never fired
   * and every "At the start of deployment, …" card on the board (Scholar of
   * the Void, Xzydris, Prediction Prophet, Invasive Species) silently missed
   * its turn. Additive/optional. */
  deployStarting?: boolean;
  /** R43: mana each seat has spent DURING the current haste step, behind
   * Tithe Enforcer's "End [Haste] with used mana" prophecy. Zeroed when the
   * haste step opens and again once the end-of-haste fulfilment sweep has
   * read it, so it is nonzero only inside its own window. Additive/optional
   * (pre-expansion states read as 0). */
  hasteManaSpent?: number[];
  /**
   * R97: grant-funded plays each seat has made in the current haste step —
   * cards played there under a `PlayPermission` despite a printed timing that
   * is not [Haste] ("[Augment] Each turn, you may play a unit during the mana
   * step as if it had [Haste]", Dispatch Courier).
   *
   * A sibling of `hasteManaSpent` on purpose: same shape, same per-seat
   * lifetime, zeroed by the same `startHasteStep`. A PLAY is not an ability
   * activation, so `Entity.budgets` never sees one and the printed "Each turn"
   * has nowhere else to live; the haste step happens exactly once a turn, so
   * "per haste step" and "each turn" are the same window here.
   *
   * Additive/optional — states serialized before R97 read as 0, and no saved
   * game replays differently for it (nothing that was legal became illegal).
   */
  hastePlaysUsed?: number[];
  /**
   * R119: mana off the NEXT card each seat plays this turn — Deferral Drone's
   * "[once] Gain 4 debt: The next card you play this turn costs [3] less".
   *
   * A PLAYER-side charge, deliberately, and NOT a radiating `CostMod`. The
   * ability has RESOLVED and the 4 debt is paid, so the source leaving play
   * cannot take the charge back (owner's ruling, 2026-08-23: *"you paid for
   * it"* — sacrificing the Drone in response used to evaporate a charge the
   * player had already bought). A CostMod radiates from an anchor and dies
   * with it, which is exactly the behaviour the ruling rejects; the spend half
   * could not stay card-side either, since a dead Drone would leave the charge
   * unspendable.
   *
   * On `GameState` rather than `PlayerState`, following the two existing
   * per-seat-per-turn charges: `hasteManaSpent` (R43) and `hastePlaysUsed`
   * (R97) are both top-level arrays. `PlayerState` is the redaction-sensitive
   * object — server/view.ts swaps `players[opponent]` wholesale for the
   * segment-start snapshot inside a hidden simultaneous segment and rewrites
   * hand/resources on top — so bookkeeping that must read live for the acting
   * seat belongs beside its siblings, not inside it.
   *
   * CONSEQUENCE, named in R119: a `CostMod` is region-scoped (R12); a per-seat
   * charge is not. A seat acting in two regions in one turn now gets the
   * discount wherever they play. "The next card YOU play" is player-scoped,
   * and R12 exists to stop information crossing regions rather than to fence a
   * player's own resolved bookkeeping.
   *
   * Zeroed by `E.startTurn` beside the `Entity.budgets` wipe. Additive/
   * optional — states serialized before R119 read as 0.
   */
  nextPlayDiscount?: number[];
  /**
   * R124 / CARD-TODO #21: the [once]/[Switch1] budgets of ZONE-dispatched
   * triggers ("When I leave your bin, [Switch1] ...", Rotling). R51 anchors a
   * zone trigger on a throwaway stand-in whose `Entity.budgets` dies with the
   * call, so a bounded zone trigger had nowhere real to keep its reservation.
   * It lives here instead, keyed `${seat}:${prefix}:${card}#${abilityIndex}` —
   * CARD-TODO #21's design question ("what does 'per card' (R9) mean for a
   * card not in play?") answered as PER SEAT PER CARD NAME: a bin holds bare
   * names, not instances, so the name in that seat's zone IS the card as far
   * as the rules can see, and three copies leaving one bin share one budget
   * the same way R51 gives three copies one firing.
   *
   * Written by composeParts (stand-in branch), refunded by refundPart
   * (sourceId -1 branch, so R113 holds from a zone), cleared by E.startTurn
   * beside the Entity.budgets wipe. Additive/optional — states serialized
   * before R124 read as empty.
   */
  zoneBudgets?: Record<string, number>;
  /** R43: battle ROUNDS completed so far this game — the forward anchor for
   * "One Battle Passes". In 1v1 both the initiative battle and the
   * counterattack battle tick it (Caleb 2024-09-24). Additive/optional. */
  battlesCompleted?: number;
  /** R302: per seat, the unit deaths that seat WITNESSED — a death counts for
   * you only if you were present in the region it happened in
   * (`Region.presentSeats`). Not a global tally: the two seats disagree, and
   * they are meant to. See R302; Vengeance's "13 Units Die" reads this.
   *
   * Counted at the single point that fires 'died', so it counts exactly what
   * every "when I die" card in the pool hears — sacrifices and Unstable
   * erasures included, because those fire 'died' too (R137). */
  deathsSeen?: number[];
  /** deployment is SIMULTANEOUS (house rule; regions can't interact anyway):
   * per-seat done flags, null outside the deploy phase. The server keeps each
   * player's deploy actions hidden from the other until both are done. */
  deployDone: boolean[] | null;
  /** derived convenience: the initiative-ordered first seat still deploying
   * (null when deployment is over). Kept for sequential drivers/tests. */
  deployPlayer: Seat | null;
  /** Report #86 (room EGCW, 2026-08-23) / CARD-TODO 22: has this seat taken
   * ANY action during the current turn's deployment other than hitting Done?
   * Owner's ruling (2026-08-23): "the idea is that YOU did something during
   * deployment other than just hitting Done" — plays, mods, grafts and
   * ability activations all count. It lives on GameState because the acting
   * seat is a REDUCER fact: deployment is simultaneous, `deployPlayer` above
   * is only a derived initiative marker, and card-level event bookkeeping
   * cannot tell WHOSE action fired an event (that was the bug — Mirage Walker
   * read `deployPlayer` and misfired both ways). Stamped at the dispatch
   * choke point in apply.ts; zeroed by startDeployment; `decide` never stamps
   * (a pending decision was raised by an action that already did). End-of-turn
   * triggers read it after deployment ends and before the NEXT deployment
   * zeroes it. Additive/optional so pre-fix saved games load — absent reads
   * as "did not act". */
  deployActed?: boolean[];
  /** triggers waiting to be ordered/targeted/stacked, in collection order */
  triggerQueue: PendingTrigger[];
  /** seats whose current trigger batch is already ordered (reset on new arrivals) */
  triggerOrderedSeats: Seat[];
  suspension: Suspension | null;
  decision: Decision | null;
  /** R85: the highest decision id ever issued. Decision ids come off `nextId`,
   * which a resolution replay rewinds to the part boundary — so without a
   * high-water mark the second question of a multi-step resolution can be
   * handed an id the first one already used, and ui/sfx.ts (which reads a
   * changed id as "a new question") would fall silent. Additive/optional. */
  decisionHigh?: number;
  /** R78: the item that is RESOLVING RIGHT NOW — off the stack (nobody may
   * respond to it or negate it any more) but not yet finished, because its
   * resolution suspended on a mid-resolution choice. Null the rest of the
   * time, which is almost always: resolution is synchronous unless somebody
   * has to answer something.
   *
   * The client reads THIS to say "Opponent is resolving X" instead of showing
   * the stack silently empty while its controller picks. Deliberately NOT a
   * member of `stack`: everything that reads `s.stack` — negation, R60's
   * "target effect" candidates, "negate all OTHER effects" sweeps, the
   * stack-empty gates in settle()/passPriority — must keep seeing exactly the
   * items still WAITING to resolve.
   *
   * Battle phase only (see E.resolveTop / E.commitItem): outside battle,
   * resolution happens inside a hidden simultaneous segment (resource step,
   * haste step, deployment) whose whole point is that the opponent cannot see
   * you act, and server/view.ts does not redact this field.
   *
   * Aliased to `suspension.item` for a 'resolve' suspension — ONE object, so a
   * structuredClone at the apply() boundary keeps them in step. Additive and
   * optional: a pre-R78 saved state reads as "nothing is resolving". */
  resolving?: StackItem | null;
}

export interface PendingTrigger {
  sourceId: EntityId;
  sourceCard: CardName;
  controller: Seat;
  abilityIndex: number;
  label: string;
  /** graft composition computed at fire time: base part + graft parts (no targets yet) */
  parts: EffectPart[];
  /** R70: the region the trigger's SOURCE was in when it fired. Needed because
   * a source can be gone by the time the trigger resolves — every "when I die"
   * trigger is exactly that case — and the fallback (the controller's action
   * region) is not the region the unit died in. Optional/additive: a state
   * serialized before this existed falls back to the old behaviour. */
  region?: number;
  /** R131: the MOD ENTITY whose donated [Augment] text queued this trigger,
   * when it was donated by one. `sourceId` names the HOST — "my" on a mod's
   * text means the host — so without this the text has no way to name the one
   * entity it must exclude from "my OTHER Augments" (Rotbeast), and every
   * implementation fell back to filtering by card NAME, which wrongly excludes
   * a second copy too. Absent for a card's own text and for granted text: no
   * mod carries those, so nothing is excluded. */
  selfModId?: EntityId;
  event: EngineEvent | null;
}

export interface ApplyResult {
  state: GameState;
  events: EngineEvent[];
  pendingDecisions: Decision[];
}
