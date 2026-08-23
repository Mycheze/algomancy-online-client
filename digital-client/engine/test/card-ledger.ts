/**
 * THE CARD LEDGER — every card in the pool whose printed text is not fully
 * implemented, in one reviewable place.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-22 the owner lost a constructed game and conceded, because
 * Harbinger of Immolation's printed second half — "[Augment] Your spell tokens
 * stay through regroup" — had never been implemented. His whole spell-token
 * deck was, in his words, "entirely non functional". He had reported the same
 * card two days earlier (room ZQPC, playtest ledger #28) and nothing was done.
 *
 * The part that matters is WHY nothing could notice. The card was not
 * forgotten. It carried:
 *
 *   - an accurate PARKED note in batch-fire-a.ts's header, and
 *   - a `{ todo: true }` test naming exactly what was missing.
 *
 * and its behaviour was:
 *
 *   augmentText: [{
 *     type: 'triggered', events: [],   // PARKED — never fires
 *     label: 'your spell tokens stay through regroup (not implemented)',
 *     effect: { run: () => {} },
 *   }]
 *
 * A `{todo:true}` test can never fail, and a comment cannot fail at all. So
 * the suite stayed green for two days while the card stayed dead, and the only
 * way to discover it was to read 22 batch files of prose. The park note LOOKED
 * like tracking. It was not tracking; it was a comment.
 *
 * The owner's instruction, verbatim: "Things that I mention as being
 * problematic in games should STOP BEING PROBLEMS."
 *
 * So this file is the DECLARATION. A card half that does nothing is listed
 * here, with the printed clause quoted, or `71-card-ledger.test.ts` fails.
 * `70-playtest-ledger.ts` is the sibling for bug REPORTS; this one is for
 * CARDS, and the two share the same rule: a claim that cannot fail is not a
 * claim.
 *
 * HOW TO USE IT
 *
 *  - Implementing a card: DELETE its entry in the same commit. The test
 *    asserts every entry is still needed, so a leftover entry fails and tells
 *    you to remove it. That self-invalidation is the whole point — it is what
 *    keeps this file from rotting into the same kind of lie the park notes
 *    became.
 *  - Parking a new card: add an entry. The shape sweep in the test finds bare
 *    definitions and inert abilities on its own, so a new Harbinger cannot be
 *    added without this file failing.
 *  - Never quote the clause from memory. `missing` is copied out of
 *    `printed.json`, the same rule the card files follow.
 *
 * WHAT IS *NOT* IN HERE
 *
 * Documented behavioural APPROXIMATIONS that do something reasonable are left
 * in their batch headers under "⚠ ENGINE APPROXIMATIONS" — the card works, it
 * just diverges. The exception is an approximation that has a `{todo:true}`
 * test: that test is sitting in the same never-fails trap Harbinger was in, so
 * it is listed here as `approximated` and the trap is at least visible.
 */

/**
 * How badly the card is broken.
 *
 *   'dead'         — a printed clause does LITERALLY NOTHING. The card is a
 *                    trap in a constructed deck: it reads as though it works.
 *   'partial'      — some named clause works and another named clause does
 *                    not. `missing` quotes only the dead half.
 *   'approximated' — the clause DOES something, but measurably not the printed
 *                    thing. Listed only when a {todo:true} test documents it.
 */
export type CardGap = 'dead' | 'partial' | 'approximated';

/**
 * How badly the gap distorts a real game — the ranking the owner asked for,
 * so he knows what to keep out of a constructed deck.
 *
 *   'deck-enabler' — the missing half is the reason you would build the deck.
 *                    Harbinger's was this: without it a spell-token deck has
 *                    no engine at all. Losing one of these loses games.
 *   'high'         — a whole card, or the card's main line, does nothing.
 *   'medium'       — a real clause is dead but the body still does its job.
 *   'low'          — a divergence you would have to look for, or a card that
 *                    cannot appear in a constructed deck at all.
 */
export type CardSeverity = 'deck-enabler' | 'high' | 'medium' | 'low';

export interface CardLedgerEntry {
  /** must be a registered card name (the test resolves it through getCard) */
  card: string;
  gap: CardGap;
  severity: CardSeverity;
  /**
   * The printed clause that does nothing, QUOTED from printed.json. Not
   * paraphrased: the owner reads this list against the physical cards, and a
   * paraphrase is how "it looked handled" happens.
   */
  missing: string;
  /**
   * What it waits on — the engine primitive, seam or ruling. Say what is
   * ACTUALLY missing today, not what was missing when the card was written:
   * this repo has a history of park notes outliving their reason (Infernal
   * Wispweaver waited on trigger suppression that had already shipped).
   */
  waitingOn: string;
  /**
   * The `{ todo: true }` test that documents this, as `file::substring`. The
   * test asserts it exists AND is still a todo — if someone implemented the
   * card and promoted the todo to a real test, this entry is stale and the
   * suite says so.
   */
  todoTest?: string;
  /**
   * A printed ATTRIBUTE the engine's stat layers do not implement. These cards
   * are invisible to the shape sweep — the whole card IS the attribute, so the
   * definition is legitimately `card('X', {})` with no printed text to flag.
   * The test verifies the card still prints it and the engine still carries
   * the unimplemented-layer placeholder.
   */
  deadAttr?: 'Unaware' | 'Inverted';
  /**
   * The dangerous class, and the reason this file exists: a dead half with NO
   * machine-checkable trace anywhere else in the repo — the definition reads as
   * alive, there is no `{todo:true}` test, and no printed attribute to point
   * at. Nothing but a batch-header comment was ever tracking it, which is
   * exactly how Harbinger's second half survived two reports and a conceded
   * game. Setting this says "this entry IS the tracking"; the test accepts it
   * as evidence and the tally names these cards out loud on every run.
   *
   * Requires a `note` saying how the gap was confirmed, since no automation
   * can re-confirm it later.
   */
  onlyTrackedHere?: boolean;
  /**
   * Set when nobody has actually confirmed the current behaviour end to end.
   * An entry saying "unverified" is useful; a wrong "fine" is not. Requires a
   * `note` saying what was and was not checked, and the tally counts these
   * separately so the size of the unknown is visible.
   */
  unverified?: boolean;
  /** anything the fields above cannot carry */
  note?: string;
}

export const CARD_LEDGER: CardLedgerEntry[] = [

  // ── DECK ENABLERS ───────────────────────────────────────────────────────
  // The Harbinger class: cards you build a deck AROUND, whose payoff half is
  // dead. These are the ones that lose games rather than fizzle a turn.

  {
    card: 'Deferral Drone', gap: 'partial', severity: 'low',
    missing:
      'nothing printed. The card works as of round 17 — gain 4 debt, the next card you '
      + 'play this turn costs [3] less, once per turn, and applying a MOD does not '
      + 'burn the charge (R37/R59: applying a mod is not playing). What is listed here '
      + 'is an UNSOURCED behaviour, not a dead clause.',
    waitingOn:
      'A RULING, not a seam. The charge lives on `Entity.budgets` (the same '
      + 'per-turn store R9\'s [once] abilities use, wiped by E.startTurn), and the '
      + 'discount is a `CostMod`, which radiates from the anchor — so sacrificing the '
      + 'Drone in response evaporates a charge you already paid 4 debt for. A resolved '
      + 'effect arguably should not care who paid for it. Making it survive means '
      + 'moving the charge onto PlayerState, which is a core change AND a ruling. The '
      + 'whole rulings export has ZERO hits for "Deferral", "next card you play" or '
      + '"costs [3] less", so there is nothing to look up — the owner has to decide. '
      + 'The park note this replaces was wrong on BOTH halves it claimed were missing.',
    todoTest: '45-hybrids-ld-b.test.ts::Deferral Drone: PARKED — the charge does not survive',
  },

  // ── WHOLE CARDS THAT DO NOTHING ─────────────────────────────────────────

  {
    card: 'Worldbender', gap: 'dead', severity: 'high',
    missing:
      '"Skip your draft step. When you do, draw a card. You also lose 3 life if '
      + 'playing a constructed format."',
    waitingOn:
      'Draft-step SKIP machinery (the engine has draft state — state.draftDone, mode '
      + "'draft' — but nothing that can skip the step), and a format flag for the "
      + 'constructed life clause.',
    todoTest: '28-metal-c.test.ts::Worldbender',
    note:
      'Registered as a vanilla 2/2 {Feeble}. Ironically the one clause that only '
      + 'matters in constructed ("you also lose 3 life") is dead too, so the card is '
      + 'strictly BETTER than printed there — it just never draws.',
  },
  {
    card: 'Writhing Host', gap: 'dead', severity: 'high',
    missing:
      '"If I am in your bin, you may play a unit as if it had [Haste] by erasing me '
      + 'as an additional cost to play that unit."',
    waitingOn:
      'A play permission whose GRANTOR IS IN THE BIN, plus an additional cost attached to '
      + "ANOTHER card's play action. R97 (Dispatch Courier) built the play-permission family "
      + 'this round and deliberately does NOT unpark this card — `PlayPermission` radiates '
      + 'through `E.anchored()`, which walks units in play and augment mods only, never a bin, '
      + 'and `PlayCtx` has no room to bolt a cost onto someone else\'s play. The ledger used to '
      + 'imply shared credit with Dispatch Courier; there is none.',
    todoTest: "42-dark-b.test.ts::Writhing Host",
    note: 'Registered as a plain 3/1 body so it enters DECK_LIST and never crashes.',
  },
  {
    card: 'Rotling', gap: 'dead', severity: 'high',
    missing: '"When I leave your bin, [Switch1] You may pay [1] to draw a card and gain 1 rot."',
    waitingOn:
      'A "card left a bin" EVENT. R51 gave the card a trigger SURFACE (`zone: \'bin\'` '
      + 'dispatches to a card sitting in a zone), but nothing fires when a card LEAVES '
      + 'one: bins are spliced directly from a dozen card effects and from engine code, '
      + 'with no choke point to instrument.',
    todoTest: '43-dark-c.test.ts::Rotling',
    note: 'Registered bare. The recursion payoff never happens.',
  },
  {
    card: 'The Everywhere', gap: 'approximated', severity: 'low',
    missing:
      'the CONTINUOUS duration of "(as long as I am in their region)" — the silence is '
      + 'applied once, at naming time, and expires at regroup.',
    waitingOn:
      'A STRING field on Entity to hold the named card (`budgets` is numeric-only), plus '
      + 'a StaticMod that matches on a card NAME rather than an entity id. The naming '
      + 'action and the suppression both shipped in R91 — `ctx.choose` with '
      + 'DecisionOption.card was the "name a card" action the old park note said did not '
      + 'exist, and R62 E.suppress does the silencing. ⚠ Consequence of shipping it '
      + 'region-strict (Caleb: "the single rule we\'ll never violate is nothing can send '
      + 'information across regions"): at end-of-haste every unit is still home, so today '
      + 'the card can only silence ALLIES. The printed card reaches an enemy by attacking '
      + 'into their region later, which is exactly why its effect has to be continuous. '
      + 'That is the whole remaining gap.',
    todoTest: '38-light-a.test.ts::The Everywhere: the silence should be CONTINUOUS',
  },
  {
    card: 'Slurpr', gap: 'dead', severity: 'medium',
    missing: '"[Augment] You can apply other mods during [Haste] as if it was deployment."',
    waitingOn:
      'The MOD-timing twin of R95. Rook shipped this round as `ModPermission.augmentInBattle` '
      + '(a per-card, OR-folded permission gathered by E.mayAugmentInBattle, with one shared '
      + 'predicate that both doAugment and legalActions call) and Dispatch Courier shipped as '
      + 'R97\'s play sibling — neither touches this card. What is needed is a `deploymentTiming` '
      + 'sibling in the same `ModPermission` family. The family now exists, so this is a small '
      + 'job rather than a design one.',
    todoTest: '40-light-c.test.ts::Slurpr',
    note: 'Plays and augments as a vanilla 2/2.',
  },

  // ── DEAD [Augment] HALVES (the exact Harbinger shape) ───────────────────
  // Every one of these is `type: 'triggered', events: []` with an empty run —
  // an "inert augmentText entry", registered so the card still counts as an
  // augment and never crashes. That is precisely what Harbinger looked like.

  {
    card: 'Crevice Lurker', gap: 'dead', severity: 'medium',
    missing:
      '"[Augment] Abilities cost [one] more to activate or trigger during battle."',
    waitingOn:
      'Ability-cost TAXATION plus a pay-to-trigger gate. R59\'s CostMod taxes CARD '
      + 'plays only; doActivateAbility has no cost-modification layer, and triggers '
      + 'have no payment gate at all (the reminder text\'s "choosing to not pay this '
      + 'prevents the abilities from triggering" needs the second half too).',
    todoTest: '16-earth-a.test.ts::Crevice Lurker',
  },
  {
    card: 'Oorblak', gap: 'partial', severity: 'medium',
    missing:
      'the PIERCING-EXCESS half only. The redirect itself works (round 17): combat '
      + 'damage aimed at Oorblak\'s controller is dealt to Oorblak instead, it can die '
      + 'of it, and the life total is spared. What is still wrong is the leftover.',
    waitingOn:
      'ONLY the card rewrite now — both seams it was blocked on landed in R98. '
      + '`replaceCombatDamageToPlayer`\'s `info` carries `attrs` (the striking column\'s live '
      + 'attributes) and `pure` (R61), so the hook can finally tell a Piercing hit from an '
      + 'ordinary one; and its return type is `boolean | number`, a number being the damage LET '
      + 'THROUGH, so it can hand the excess back instead of being all-or-nothing. `true`/`false` '
      + 'keep their old meaning, which is why Blightsea Polyp and Oorblak both still pass '
      + 'unedited. The ruling to implement, Caleb: "oorblak takes 5 piercing damage, 1 is enough '
      + 'to kill it and the remaining 4 hit the player."',
    todoTest: '17-earth-b.test.ts::Oorblak: PARKED — Piercing excess',
  },
  {
    card: 'Apex Prime', gap: 'partial', severity: 'medium',
    missing:
      'the copied NAME, the copied `statics`, and the copied ACTIVATED abilities. Base '
      + 'stats, attributes and triggered/[Augment] text all copy as of R92.',
    waitingOn:
      'Three core layers. (1) A copy-NAME layer — `Entity.card` is the identity that '
      + 'bins, "name a card" effects and counters-by-name all key off, so it cannot be '
      + 'overwritten casually. (2) A granted-STATIC channel beside `Entity.granted`; '
      + '`staticsFor()` reads statics off the printed card only. (3) `pushActivatedOptions` '
      + '(apply.ts:1785-1793) offers `getCard(u.card).abilities` and never reads `granted`. '
      + 'Borrower of Forms waits on the same three. The old park note claimed effStats had '
      + 'no copy layer at all, which was overstated: three of the four already existed '
      + '(E.setBase for base stats R66, E.addTempAttr for attributes, E.grantText for text '
      + 'R63), and all three expire at regroup, which IS this card\'s printed duration. '
      + 'Source for the copy semantics, the Borrower of Forms RAQ: Caleb — "it inherits '
      + 'all of the combined text", and counters copy too.',
    todoTest: '44-hybrids-ld-a.test.ts::Apex Prime: the copy does not carry the NAME',
  },
  {
    card: 'Vengeance', gap: 'dead', severity: 'medium',
    missing:
      '"[Augment] Cards your opponents play during battle gain \'[Sacrifice a unit]\'."',
    waitingOn:
      'A channel for IMPOSING an additional cast cost on another player\'s cards. '
      + "R59's CostMod carries `delta` (extra mana) and `life` (extra life) and "
      + 'nothing else; a sacrifice is neither.',
    todoTest: '45-hybrids-ld-b.test.ts::Vengeance',
  },
  // ── BARE DEFINITIONS WITH LIVE PRINTED TEXT ─────────────────────────────

  {
    card: 'Trench Stalker', gap: 'dead', severity: 'medium',
    missing:
      '"[Discard two cards]{/n}I can be played directly into formation, and played '
      + 'from your bin."',
    waitingOn:
      'ONE of its original three (corrected 2026-08-22). R49 supplied the cost — '
      + "`castCost: { kind: 'discardCard', n: 2 }` is expressible — and R29 has now "
      + 'supplied "played directly into formation": `CardBehavior.playsIntoFormation` '
      + 'is exactly this clause, built for Tiderunner Initiate, asked in the cast '
      + 'window and taken atomically with the spawn. What is genuinely left is the '
      + 'play-from-bin ACTION, which nothing in legalActions ever offers (the same '
      + 'missing permission parks Abyssal Evocation and Writhing Host). Unparking '
      + 'this card is now a two-piece job, not a three-piece one — and it must land '
      + 'whole: the cost is deliberately NOT added on its own, because it would make '
      + 'the card strictly worse than the vanilla body.',
    todoTest: '46-hybrids-ld-c.test.ts::Trench Stalker',
    note:
      'Registered bare, so it is an ordinary [2] {Battle} 6/2 — strictly BETTER than '
      + 'printed (no discard) and strictly less flexible (no bin, no direct '
      + 'formation entry). Both directions are wrong.',
  },
  {
    card: 'Fire Resource', gap: 'dead', severity: 'low',
    missing:
      '"When I activate, if you have at least [r][r][r], create a Shard. {i}(It spawns dormant.)"',
    waitingOn:
      'The resource-CARD model. Resources are anonymous ResourceState entries with '
      + 'no entity behind them, and doActivateResource does not fireEvent, so "when I '
      + 'activate" has nothing to listen to. (The Shard half SHIPPED — E.createShard '
      + "and a real 'shard' ResourceKind exist; the payload is ready and waiting for "
      + 'the trigger.)',
    todoTest: '12-fire-a.test.ts::Fire Resource',
    note:
      'NOT constructed-relevant: DECK_LIST filters every /\\bResource\\b/ type out, so '
      + 'no resource face can be in a deck. Listed for completeness.',
  },
  {
    card: 'Water Resource', gap: 'dead', severity: 'low',
    missing:
      '"When I activate, if you have at least [b][b][b], create a Shard. {i}(It spawns dormant.)"',
    waitingOn: 'Identical to Fire Resource: the resource-CARD model and a dispatched activation event.',
    todoTest: '15-water-b.test.ts::Water Resource',
    note: 'Not in DECK_LIST (resource face).',
  },
  {
    card: 'Earth Resource', gap: 'dead', severity: 'low',
    missing:
      '"When I activate, if you have at least [e][e][e], create a Shard. {i}(It spawns dormant.)"',
    waitingOn: 'Identical to Fire Resource: the resource-CARD model and a dispatched activation event.',
    unverified: true,
    note:
      'Not in DECK_LIST (resource face). ⚠ Unlike its Fire and Water siblings this '
      + 'one has NO {todo:true} test anywhere — the batch-earth-a header is the only '
      + 'thing that ever mentioned it. Flagged as unverified because nothing but a '
      + 'comment was tracking it; the behaviour matches the other two by inspection.',
  },

  // ── PARTIAL: one clause works, another does not ─────────────────────────

  {
    card: 'Ancient One', gap: 'partial', severity: 'medium',
    missing:
      '"[Augment] I have all abilities of adjacent allies." — ACTIVATED abilities and '
      + 'STATICS of the neighbours.',
    waitingOn:
      'NEIGHBOUR PROJECTION. Triggered abilities ARE delivered (a bookkeeping when() '
      + "scans adjacent allies and queues copies as the Ancient One's own triggers). "
      + 'What card code still cannot do is project an adjacent ally\'s activated '
      + 'abilities or statics: both are read off the holder\'s own card definition, '
      + 'and there is no "borrow that unit\'s" seam.',
    todoTest: '26-metal-a.test.ts::Ancient One',
  },

  // ── PRINTED ATTRIBUTES THE STAT LAYERS DO NOT IMPLEMENT ─────────────────
  // EMPTY as of 2026-08-23, and kept as a heading because the class is real
  // and will recur. It held Bubb, Trashling and Haboob, whose whole card IS
  // {Unaware} — invisible to the shape sweep, because `card('X', {})` is the
  // CORRECT definition when there is no printed text to flag, which is the
  // mismatch that hid Harbinger in reverse. R106 shipped stat layer 6 (an
  // Unaware unit's numbers are its base numbers, for everybody) and all three
  // came off, exactly as Its Dark Bubb and Reality Bender came off when R93
  // shipped layer 5. Both stat-layer placeholders in effStats() are now code.

  // ── APPROXIMATIONS SITTING BEHIND A {todo:true} ─────────────────────────
  // These cards DO something. They are here because a todo test — which can
  // never fail — is the only thing recording that what they do is not what
  // they print. That is the Harbinger trap, so they are at least visible.

  {
    card: 'Borrower of Forms', gap: 'approximated', severity: 'medium',
    missing: 'card text, attributes and mods are not copied — only base stats are.',
    waitingOn:
      'The same COPY layer Apex Prime waits on. Base stats copy via R66\'s E.setBase; '
      + 'everything else about the copied card does not travel.',
    todoTest: '26-metal-a.test.ts::Borrower of Forms',
  },
  {
    card: 'Witness of the Crossing', gap: 'approximated', severity: 'low',
    missing:
      '"[Switch1][Switch1][Switch1]" — three copies of each attached graft as one trigger.',
    waitingOn:
      'Extra copies of a TARGETED graft effect cannot collect extra targets '
      + '(composeParts collects one target set per part), so a targeted graft runs '
      + 'once instead of three times. Untargeted grafts do get all three.',
    todoTest: '40-light-c.test.ts::Witness of the Crossing',
  },
  {
    card: 'Deformant', gap: 'approximated', severity: 'low',
    missing:
      '"Sacrifice me and another ally:" as ONE indivisible activation cost.',
    waitingOn:
      'NOT the compound cost shape this note used to blame — that claim is stale. A single '
      + '`AbilityCost` carries `sacrificeSelf` AND `sacrificeOther` together, and both are '
      + 'paid inside the one cast window (payActivationCost for self, collectItemCosts for '
      + 'other), so the PAYMENT is expressible today. What actually blocks moving Deformant '
      + 'into the cast window is the RECEIPT, because its effect needs the sacrificed '
      + "units' COUNTERS: `costPaid.sacrificedUnits` (types.ts:368) snapshots "
      + '`{card, power, defense}` and not `counters`; `item.paidCosts.sacrificed` is a bare '
      + 'CardName; and `EffectCtx` never exposes `item.paidCosts` at all, so with the '
      + 'two-channel shape run() could not even learn WHICH ally was sacrificed. Nor can '
      + 'the counters be reconstructed from effStats, because Caleb rules they NET and that '
      + 'temp buffs are not counters at all — "if I have +1/+1 and -1/-1 on the 2 cards, '
      + 'what\'s the total number?" -> "0, they cancel out"; and of an until-regroup buff, '
      + '"oh, no those are not counters". Minimum fix: add `counters` (and ideally the '
      + 'entity id) to both receipt shapes, and surface `item.paidCosts` on EffectCtx.',
    todoTest: '26-metal-a.test.ts::Deformant',
    note: 'Observable as a response window that should not exist between cost and effect.',
  },
  {
    card: 'Eldritch Dreamtender', gap: 'approximated', severity: 'low',
    missing:
      'WHICH combat-damage sub-step "when my column deals combat damage" fires in.',
    waitingOn:
      'A RULING, not a primitive — the only entry here that is not an engine gap. '
      + 'R73 settled that the sacrifice is a cast cost; it left the sub-step open. '
      + 'Needs Bena.',
    todoTest: '53-playtest-round7.test.ts::Eldritch Dreamtender',
  },
];
