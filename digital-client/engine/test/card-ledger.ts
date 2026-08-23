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

  // Worldbender's entry was DELETED on 2026-08-23 when the card was built
  // (playtest report #87 supplied the numbers the entry was waiting on): it is
  // a `replaceCardStep` static now, live in both formats that have a card
  // step, with real tests in 28-metal-c.test.ts. Per the house rule at the head
  // of this file the entry goes in the same commit as the fix — this comment is
  // a signpost for anyone following the old `todoTest` reference, not a park.
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
  // The Everywhere's entry was DELETED on 2026-08-23 when the continuous half
  // was built, per the house rule at the head of this file. It waited on "a
  // STRING field on Entity to hold the named card, plus a StaticMod that
  // matches on a card NAME rather than an entity id" — both are in the tree
  // now (`Entity.named` in types.ts, the `statics` entry on the card in
  // batch-light-a.ts), and the printed "(As long as I am in their region.)" is
  // `staticsFor`'s own region scope, evaluated live. Its todo was promoted to
  // real tests in 38-light-a.test.ts. Signpost, not a park.
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
  // Oorblak's entry was DELETED on 2026-08-23 when its PIERCING-EXCESS half was
  // written against R98's wider `replaceCombatDamageToPlayer` (`info.attrs` /
  // `info.pure`, and a numeric return meaning "damage let through"). The
  // `{ todo: true }` park test it used to cite is now four real tests in
  // 17-earth-b.test.ts, Caleb's own case among them. Signpost for anyone
  // following the old `todoTest` reference, not a park.
  {
    card: 'Apex Prime', gap: 'partial', severity: 'low',
    missing:
      'the copied ACTIVATED abilities. "Become a copy of target unit" now carries the '
      + 'NAME, the base stats, the attributes, the STATICS and the triggered/[Augment] '
      + 'text — R118 shipped the copy layer and all five travel as one face.',
    waitingOn:
      'TWO READS IN apply.ts, and nothing else. The engine side is BUILT: `E.becomeCopy` '
      + 'stamps `Entity.copies`, and `E.facesWith(u, \'activated\')` already answers with '
      + 'the copied card. But `pushActivatedOptions` offers `getCard(u.card).abilities` / '
      + '`.augmentText`, so a copied activated ability never reaches `legalActions`, and '
      + '`activationSource` resolves `via === undefined` the same way, so it would refuse '
      + 'the action even if it were offered. Both want `E.facesWith(u, \'activated\')` in '
      + 'place of `u.card`, plus a `via: { face }` arm so `composeParts` keys the R9 budget '
      + 'on the right card; `ui/inspect.ts` (lines 102 and 942) mirrors the same read and '
      + 'moves with it. Ancient One and Borrower of Forms wait on exactly these two reads — '
      + 'one change unparks all three. This entry is what is LEFT of the three-layer note '
      + 'R92 wrote: the NAME layer and the granted-STATIC channel both shipped as R118.',
    todoTest: '44-hybrids-ld-a.test.ts::a copied ACTIVATED ability is never offered — Apex Prime',
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

  // ── PARTIAL: one clause works, another does not ─────────────────────────

  {
    card: 'Ancient One', gap: 'partial', severity: 'low',
    missing:
      '"[Augment] I have all abilities of adjacent allies." — the neighbours\' ACTIVATED '
      + 'abilities. Their TRIGGERED abilities are delivered (a bookkeeping when() that '
      + 'labels each mimicked trigger "Ancient One (as X)"), and R118 added their STATICS '
      + 'as a continuous `CardDef.projects` declaration, re-evaluated on every read so a '
      + 'column collapsing mid-combat takes the borrowed static with it.',
    waitingOn:
      'The SAME two reads in apply.ts that Apex Prime waits on — `pushActivatedOptions` '
      + 'and `activationSource` both go to `getCard(u.card).abilities` rather than the '
      + 'face. R118 built everything up to them: the projection radiates through '
      + '`E.anchored()` like a StaticMod and `E.facesWith(u, \'activated\')` already '
      + 'returns the neighbours\' card names. One change unparks Ancient One, Apex Prime '
      + 'and Borrower of Forms together. The old note here — "there is no seam for '
      + '\'borrow that unit\'s\'" — is closed; the seam is `CardDef.projects`.',
    todoTest: '26-metal-a.test.ts::Ancient One and Borrower of Forms',
  },

  // ── PRINTED ATTRIBUTES THE STAT LAYERS DO NOT IMPLEMENT ─────────────────
  // EMPTY as of 2026-08-23, and kept as a heading because the class is real
  // and will recur. It held Bubb, Trashling and Haboob, whose whole card IS
  // {Unaware} — invisible to the shape sweep, because `card('X', {})` is the
  // CORRECT definition when there is no printed text to flag, which is the
  // mismatch that hid Harbinger in reverse. R106 shipped stat layer 6 (an
  // Unaware card, and everything it fights or damages, reads at PRINTED stats)
  // and all three came off, as Its Dark Bubb and Reality Bender came off when R93
  // shipped layer 5. Both stat-layer placeholders in effStats() are now code.

  // ── APPROXIMATIONS SITTING BEHIND A {todo:true} ─────────────────────────
  // These cards DO something. They are here because a todo test — which can
  // never fail — is the only thing recording that what they do is not what
  // they print. That is the Harbinger trap, so they are at least visible.

  {
    card: 'Borrower of Forms', gap: 'partial', severity: 'low',
    missing:
      'the ACTIVATED abilities of the copied unit. "I become an exact copy of that unit. '
      + '{i}(I copy all stat changes, counters, card text and mods)" otherwise copies in '
      + 'full as of R118: the NAME, the stat changes (the face snapshots the target\'s '
      + 'BASE, layers 1-2), the counters, the attributes, the statics, the triggered and '
      + '[Augment] text, and the MODS as R118 ruling 2 rules them — the mods\' TEXT is '
      + 'inherited, no mod entity is cloned, and the copy counts as modded and is '
      + 'therefore {Unstable}. The face is PERMANENT and survives regroup.',
    waitingOn:
      'The SAME two reads in apply.ts as Apex Prime and Ancient One — `pushActivatedOptions` '
      + 'and `activationSource` read `getCard(u.card).abilities` rather than the face. '
      + 'Nothing card-side and nothing engine-side is left. The old entry here blamed "the '
      + 'same COPY layer Apex Prime waits on"; that layer is R118 and it shipped.',
    todoTest: '26-metal-a.test.ts::Ancient One and Borrower of Forms',
  },
  // Witness of the Crossing's entry was DELETED on 2026-08-23, per the house
  // rule at the head of this file. It was never an engine backlog item: it sat
  // at `unverified: true` waiting on ONE thing, a confirmation of the PRINTED
  // reading, because the card prints three [Switch1] marks and no reminder
  // text. The owner supplied it, verbatim: "Amphivavor is the same. It creates
  // a special Grafted ability with everything on there three times"
  // ("Amphivavor" = Amphivore). That is R110's `graftCopies: 3`, which both
  // cards already share, so no code changed. Its todo was promoted to a real
  // two-graft, one-targeted test in 40-light-c.test.ts. Signpost, not a park.
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
  // Eldritch Dreamtender's entry was DELETED on 2026-08-23, per the house rule
  // at the head of this file. It waited on a RULING and got one: R117 — the
  // trigger fires in the sub-step its OWN COLUMN strikes in. The gate is
  // `E.strikesInCurrentSubStep` (over the new public `E.combatSubStepOf`),
  // asked from `when()`, and Zephyrzoa and Blightmound carry the same one. Its
  // todo was promoted to five real tests in 53-playtest-round7.test.ts.
  // Signpost, not a park.
];
