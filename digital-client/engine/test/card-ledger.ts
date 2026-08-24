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

  // Deferral Drone's entry was DELETED on 2026-08-23 when the owner ruled the
  // last residue (R119: the charge SURVIVES the Drone — "you paid for it").
  // The entry was never a dead clause — it declared an UNSOURCED behaviour —
  // and the ruling is now code: `GameState.nextPlayDiscount`, set by
  // E.grantNextPlayDiscount, read by manaToPlay, spent at the spellPlayed /
  // spawned emit sites, cleared by startTurn. Its `{todo:true}` test was
  // promoted in the same change (45-hybrids-ld-b.test.ts). Per the house rule
  // at the head of this file the entry goes in the same commit as the fix —
  // this comment is a signpost for anyone following the old `todoTest`
  // reference, not a park.

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
  // Slurpr's entry was DELETED on 2026-08-23 when the MOD-timing twin of R95
  // was built, per the house rule at the head of this file. All three engine
  // seams it was waiting on are in the tree now: `E.mayApplyModAtHaste` (the
  // OR-folding gatherer beside `E.mayAugmentInBattle`), the haste branch in
  // `doAugment` and `doGraft` through apply.ts's one shared `hasteModAllowed`
  // predicate, and BOTH offer gates — `legalHasteActions`' `pushHasteMods` and,
  // the one that would otherwise have made the whole thing unreachable,
  // `startHasteStep`'s `canHaste` (report #74 in mod form). Its todo was
  // promoted to six real tests in 40-light-c.test.ts. Signpost, not a park.

  // ── DEAD [Augment] HALVES (the exact Harbinger shape) ───────────────────
  // Every one of these is `type: 'triggered', events: []` with an empty run —
  // an "inert augmentText entry", registered so the card still counts as an
  // augment and never crashes. That is precisely what Harbinger looked like.

  // Crevice Lurker's entry was DELETED on 2026-08-24 when R121 built both
  // halves it was waiting on, per the house rule at the head of this file:
  // the ability-cost TAX rides R59's CostMod layer under two new CostCtx
  // purposes ('activate' — folded into E.payActivationCost and the shared
  // canPayAbilityCost gate, so an unaffordable taxed activation is neither
  // offered nor accepted — and 'trigger'), and the pay-to-trigger gate is
  // E.gateTaxedTrigger at processTriggerQueue's single stack-bound choke
  // point, with the payOrDecline question carried by the serializable
  // 'payTrigger' suspension and answered only by the player (zero open mana
  // is prevented outright, announced in the log). Its `{ todo: true }` park
  // test is nine real tests in 16-earth-a.test.ts: taxed/refused activation,
  // untaxed deployment, the pay/decline/no-mana trigger gate, the kept
  // [once] (R108/R113), the untaxed mod application (R37), the donated form,
  // two-Lurker summing, and a JSON round-trip of the pending question.
  // Signpost, not a park. (It also handed the 71-card-ledger CANARY role on
  // to Vengeance, the remaining card with the exact Harbinger shape.)
  // Oorblak's entry was DELETED on 2026-08-23 when its PIERCING-EXCESS half was
  // written against R98's wider `replaceCombatDamageToPlayer` (`info.attrs` /
  // `info.pure`, and a numeric return meaning "damage let through"). The
  // `{ todo: true }` park test it used to cite is now four real tests in
  // 17-earth-b.test.ts, Caleb's own case among them. Signpost for anyone
  // following the old `todoTest` reference, not a park.
  //
  // Apex Prime's entry was DELETED on 2026-08-23 when the last of its four copy
  // layers landed. R118 had already shipped the face; what was left was the two
  // reads in apply.ts this entry named — `pushActivatedOptions` and
  // `activationSource` — and both now go through `E.facesWith(u, 'activated')`,
  // with a `via: { face }` arm for a face that is not the identity one. Its
  // `{ todo: true }` park test is two real tests in 44-hybrids-ld-a.test.ts
  // (offered, accepted, fires; and gone again at regroup). Ancient One and
  // Borrower of Forms came off in the SAME change, exactly as this entry said
  // they would. Signpost for anyone following the old `todoTest` reference.
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
  // EMPTY as of 2026-08-23, and kept as a heading because the class recurs:
  // R118's copy layer took the last three off it at once.
  //
  // Ancient One's entry was DELETED on 2026-08-23 with Apex Prime's and
  // Borrower of Forms': "one change unparks all three" is what it said, and it
  // was one change. `CardDef.projects` already radiated the neighbours' faces;
  // apply.ts now reads them, so an adjacent ally's ACTIVATED ability is offered
  // on the Ancient One (as `via: { face }`, so two neighbours' ability #0 are
  // two options with two R9 budgets) and stops the instant the column breaks.
  // Real tests in 26-metal-a.test.ts. The triggered half is unchanged — the
  // bookkeeping when() still labels each mimicked trigger "Ancient One (as X)".

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

  // Borrower of Forms' entry was DELETED on 2026-08-23 with Apex Prime's and
  // Ancient One's. The borrowed face is the Borrower's IDENTITY, so the copied
  // card's activated abilities are its own — offered under the same
  // `via: undefined` a pre-R118 action log carries, and PERMANENT, like the
  // rest of the face. Real tests in 26-metal-a.test.ts, next to the ones that
  // already pinned the name, the stats, the mods text and ruling 1.
  //
  // Witness of the Crossing's entry was DELETED on 2026-08-23, per the house
  // rule at the head of this file. It was never an engine backlog item: it sat
  // at `unverified: true` waiting on ONE thing, a confirmation of the PRINTED
  // reading, because the card prints three [Switch1] marks and no reminder
  // text. The owner supplied it, verbatim: "Amphivavor is the same. It creates
  // a special Grafted ability with everything on there three times"
  // ("Amphivavor" = Amphivore). That is R110's `graftCopies: 3`, which both
  // cards already share, so no code changed. Its todo was promoted to a real
  // two-graft, one-targeted test in 40-light-c.test.ts. Signpost, not a park.
  // Deformant's entry was DELETED on 2026-08-23, per the house rule at the
  // head of this file. It waited on two engine edits and both are in the tree:
  // `includeSelf?: true` on the `sacrificeUnits` CastCost (the source charged
  // choice-free first, excluded from the menu the rest is chosen from, and
  // `canPayCastCost` demanding BOTH halves up front so it never half-pays),
  // and the widened `costPaid.sacrificedUnits` receipt, which now snapshots
  // `unit` and the RAW `counters` at payment in both writers. The card moved
  // to the effect-level `castCost` route — deliberately NOT `AbilityCost`,
  // whose `collectItemCosts` half-pay would have bitten Deformant first — so
  // the mid-resolution `ctx.choose` is gone and with it the response window
  // this entry called out. Its todo was promoted to three real tests in
  // 26-metal-a.test.ts. Signpost, not a park.
  // Eldritch Dreamtender's entry was DELETED on 2026-08-23, per the house rule
  // at the head of this file. It waited on a RULING and got one: R117 — the
  // trigger fires in the sub-step its OWN COLUMN strikes in. The gate is
  // `E.strikesInCurrentSubStep` (over the new public `E.combatSubStepOf`),
  // asked from `when()`, and Zephyrzoa and Blightmound carry the same one. Its
  // todo was promoted to five real tests in 53-playtest-round7.test.ts.
  // Signpost, not a park.
];
