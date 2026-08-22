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
    card: 'Emberflame Enlightener', gap: 'partial', severity: 'deck-enabler',
    missing: '"[Augment] Your units and spells gain {g}powerful." — the SPELLS half.',
    waitingOn:
      'A way to project an attribute onto a SPELL EFFECT. Statics reach in-play '
      + 'UNITS only, and the units half is live in both forms. R79 built the READ '
      + 'side — dealEffectDamage unions ctx.grantedAttrs into the source card\'s '
      + 'printed attrs — but the only thing that ever fills grantedAttrs is a VIRUS '
      + 'augmented onto an item on the stack (E.stackAugmentAttrs). A StaticMod has '
      + 'no channel into it. Half the primitive exists; the static-to-effect half '
      + 'does not.',
    onlyTrackedHere: true,
    note:
      'A spell deck augments this expecting doubled spell damage and gets none. '
      + 'Confirmed by reading the definition: `statics: [{ affects: t => t.kind === '
      + "'unit' && …, attrs: ['Powerful'] }]` — the units half and nothing else. No "
      + '{todo:true} test names the spells half anywhere in the suite; the only thing '
      + 'that ever tracked it was one bullet in the batch-fire-a header.',
  },
  {
    card: 'Abyssal Evocation', gap: 'dead', severity: 'deck-enabler',
    missing:
      '"In this battle, you may play spells from your bin. If you do, they gain '
      + '{p}unstable until regroup."',
    waitingOn:
      'A bin-play PERMISSION in apply.ts. `playAtTiming`/`castable` already take '
      + "from: 'hand' | 'cache' | 'bin', but nothing in legalActions ever offers a "
      + "play with from: 'bin' — the only bin action is doProphesy. Plus an "
      + '"unstable until regroup" marker on the cards played that way.',
    todoTest: '12-fire-a.test.ts::Abyssal Evocation',
    note:
      'The whole card. It resolves to an info line and goes to the bin, so a '
      + 'bin-recursion deck built on it has no recursion. Same missing permission '
      + 'parks Writhing Host and half of Trench Stalker.',
  },
  {
    card: 'Rook', gap: 'dead', severity: 'deck-enabler',
    missing:
      '"[Augment] You may augment cards from hand and bin during battle as if they '
      + 'were [Virus]."',
    waitingOn:
      "A continuous PLAY-PERMISSION layer over doApplyMod's legality rules in "
      + 'apply.ts. R59 shipped CostMod (continuous cost modification); this is its '
      + 'sibling for permissions and does not exist. Card code cannot reach '
      + "apply.ts's phase gate.",
    todoTest: '29-hybrids-wm-a.test.ts::Rook',
    note:
      'A mod-matters deck augments Rook to unlock battle-window augmenting and gets '
      + 'a vanilla 4/4. The permission is the entire card.',
  },
  {
    card: 'Deferral Drone', gap: 'dead', severity: 'deck-enabler',
    missing: '"[Augment][once] Gain 4 debt: The next card you play this turn costs [3] less."',
    waitingOn:
      'A ONE-SHOT cost reduction. R59\'s CostMod is the cost layer and it is '
      + 'continuous and stateless: it is asked "what does this card cost right now" '
      + 'and has nowhere to record "…and then stop applying". Nothing consumes a '
      + 'cost modifier on use.',
    todoTest: '45-hybrids-ld-b.test.ts::Deferral Drone',
    note:
      'Deliberately not activatable at all: the only half that DOES exist is "gain 4 '
      + 'debt", and offering the cost without the discount would be strictly worse '
      + 'than the printed card. A debt/ramp deck gets a 2/2.',
  },

  // ── WHOLE CARDS THAT DO NOTHING ─────────────────────────────────────────

  {
    card: 'Suspend', gap: 'dead', severity: 'high',
    missing: '"Target player\'s life total can\'t change during this battle. Erase me."',
    waitingOn:
      'A life-change LOCK. E.gainLife / E.loseLife commit immediately and have no '
      + 'replacement seam. The engine has exactly two replacement hooks '
      + '(replaceRotDamage, replaceCombatDamageToPlayer) and deliberately no '
      + 'framework; neither can stop a life change, only redirect one channel.',
    todoTest: '40-light-c.test.ts::Suspend',
    note:
      'Casting it picks a target player and logs "⚠ Suspend is PARKED". The card is '
      + 'a blank. Not caught by the shape sweep — its run does real work (it reads '
      + 'and names the target) and then does nothing with it, which is exactly the '
      + 'shape a sweep cannot see. Listed by hand.',
  },
  {
    card: 'Prediction Prophet', gap: 'dead', severity: 'high',
    missing:
      '"During [Haste], predict your life total. At the start of deployment, create '
      + 'a 5/5 unit if you matched the prediction."',
    waitingOn:
      'A "predict a number" PLAYER ACTION during the haste step, and somewhere in '
      + 'PlayerState/Entity to keep the prediction. R50 supplied the other half: the '
      + "'startOfDeployment' event exists and the card hears it — it just finds no "
      + 'prediction on record and logs the gap.',
    todoTest: '40-light-c.test.ts::Prediction Prophet',
    note: 'The 5/5 can never be created. The card is a vanilla body.',
  },
  {
    card: 'Phytochemical Protection', gap: 'dead', severity: 'high',
    missing:
      '"Until regroup, prevent all damage that would be dealt to target unit. Put a '
      + '+1/+1 counter on it for each damage prevented this way."',
    waitingOn:
      'A damage-PREVENTION / shield layer. dealEffectDamage and pumpCombatDamage '
      + 'have no prevention hook to install one on.',
    todoTest: '24-wood-b.test.ts::Phytochemical Protection',
    note:
      'Collects its target, logs, and does nothing. Worse than a blank in play: it '
      + 'reads like a combat trick and the unit dies anyway.',
  },
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
      'Two things, both in apply.ts/legalActions and out of card code\'s reach: '
      + 'granting HASTE TIMING to another card (the Dispatch Courier precedent), and '
      + "attaching an arbitrary additional cost to a DIFFERENT card's play action.",
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
    card: 'The Everywhere', gap: 'dead', severity: 'high',
    missing:
      '"[Augment] During [Haste] name a card. My last named card loses all abilities."',
    waitingOn:
      'A "name a card" PLAYER ACTION. That is the only thing left — this used to '
      + 'also wait on an ability-suppression layer, and R62 shipped it '
      + '(StaticMod.suppressAbilities; Monke, Suppression Field and Transmogrifant '
      + 'all use it today).',
    todoTest: '38-light-a.test.ts::The Everywhere',
  },
  {
    card: 'Slurpr', gap: 'dead', severity: 'medium',
    missing: '"[Augment] You can apply other mods during [Haste] as if it was deployment."',
    waitingOn:
      "The same play-timing permission layer Rook and Dispatch Courier wait on: "
      + "doApplyMod's phase gate lives in apply.ts and card code cannot reach it.",
    todoTest: '40-light-c.test.ts::Slurpr',
    note: 'Plays and augments as a vanilla 2/2.',
  },

  // ── DEAD [Augment] HALVES (the exact Harbinger shape) ───────────────────
  // Every one of these is `type: 'triggered', events: []` with an empty run —
  // an "inert augmentText entry", registered so the card still counts as an
  // augment and never crashes. That is precisely what Harbinger looked like.

  {
    card: 'Conduit of Pain', gap: 'dead', severity: 'high',
    missing:
      '"[Augment] If an allied source would deal noncombat damage, it deals that '
      + 'much damage plus 1 instead."',
    waitingOn:
      'A NONCOMBAT damage replacement hook. dealEffectDamage / dealEffectDamageAll '
      + 'have none, and the two hooks that exist (replaceRotDamage, '
      + 'replaceCombatDamageToPlayer) cover rot and column combat damage to players '
      + 'only.',
    todoTest: '12-fire-a.test.ts::Conduit of Pain',
    note: 'A burn deck augments this for +1 per ping and gets nothing.',
  },
  {
    card: 'Envoy of Lightning', gap: 'dead', severity: 'high',
    missing: '"[Augment] Your spell effects with a single target are {g}Electric."',
    waitingOn:
      'The same static-to-spell-effect projection Emberflame Enlightener waits on: '
      + 'statics reach in-play UNITS only, and R79\'s ctx.grantedAttrs (the read side) '
      + 'is filled by stack-augmented VIRUSES, never by a static.',
    todoTest: '12-fire-a.test.ts::Envoy of Lightning',
  },
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
    card: 'Oorblak', gap: 'dead', severity: 'high',
    missing:
      '"[Augment] If combat damage would be dealt to you, that damage is dealt to me '
      + 'instead."',
    waitingOn:
      '⚠ STALE PARK, CORRECTED 2026-08-22. The batch-earth-b note said this needs '
      + '"damage replacement hooks (combatSubStep calls loseLife directly, with no '
      + 'replacement seam)". That is no longer true: E.pumpCombatDamage consults '
      + 'E.replaceCombatDamage before loseLife, and CardBehavior.'
      + 'replaceCombatDamageToPlayer is the seam — Blightsea Polyp '
      + '(batch-hybrids-ld-c) already uses it, and it is anchored exactly right '
      + '(units in play AND augment mods reading from their host). What is genuinely '
      + 'left is small: a way to deal the redirected damage TO A UNIT from inside the '
      + 'hook, which takes an EffectCtx that the hook is not handed. This is the '
      + 'highest-value item in the ledger — most of the primitive already shipped.',
    todoTest: '17-earth-b.test.ts::Oorblak',
  },
  {
    card: 'Dispatch Courier', gap: 'dead', severity: 'medium',
    missing:
      '"[Augment] Each turn, you may play a unit during the mana step as if it had '
      + '[Haste]."',
    waitingOn:
      "Play-timing gating in apply.ts's haste-step legality. The original precedent "
      + 'for this class of park; Writhing Host, Slurpr and Rook all cite it.',
    todoTest: '26-metal-a.test.ts::Dispatch Courier',
  },
  {
    card: 'Apex Prime', gap: 'dead', severity: 'high',
    missing:
      '"[Augment] When I attack or block, if your life total is odd, you may have all '
      + 'of your units become a copy of target unit until regroup."',
    waitingOn:
      'A COPY layer — name, stats, attributes and abilities projected from another '
      + 'card and expiring at regroup. Nothing of the sort exists: effStats has no '
      + 'copy layer, and ownAttrs/abilities read straight off the printed card. '
      + '(Borrower of Forms is NOT a counterexample: it copies base stats only, and '
      + 'its own todo test says text, attributes and mods are not copied.)',
    todoTest: '44-hybrids-ld-a.test.ts::Apex Prime',
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
  {
    card: 'Counter Theif', gap: 'dead', severity: 'medium',
    missing:
      '"[Augment] If one or more counters would be placed on one or more units during '
      + 'battle, those counters are placed on me instead."',
    waitingOn:
      'A replacement effect on COUNTER PLACEMENT. E.addCounters has no hook at all, '
      + 'and the engine has deliberately no replacement framework — just the two '
      + 'named hooks.',
    todoTest: '46-hybrids-ld-c.test.ts::Counter Theif',
    note: 'Plays as a 0/5 and is recognised as an augment; the theft never happens.',
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
    card: 'Scholar of the Void', gap: 'partial', severity: 'high',
    missing:
      '"[Augment] At the start of deployment, you may discard your hand and transform '
      + 'me into Beyond, Codex Incarnate." — the transform.',
    waitingOn:
      "TWO things. R50's 'startOfDeployment' event exists and the trigger fires, but "
      + '(a) the engine has no transform layer, and (b) "Beyond, Codex Incarnate" is '
      + 'not in printed.json at all — the pool has no such card, so there is nothing '
      + 'to become. (b) is not an engine gap, it is missing printed data.',
    todoTest: '43-dark-c.test.ts::Scholar of the Void',
    note: 'The trigger resolves to an info line saying the option is declined.',
  },
  {
    card: 'Cosmic Conspirator', gap: 'partial', severity: 'medium',
    missing:
      '"If you would create a Robot, Poison, Crystal or Fireball, you may instead '
      + 'create a token of any of these types." — the SPELL-TOKEN half.',
    waitingOn:
      'A dispatchable event on spell-token creation. E.createSpellToken never calls '
      + 'fireEvent, so a Poison/Crystal/Fireball creation cannot be intercepted. The '
      + "ROBOT half IS live, via the 'spawned' event: creating a Robot does offer the "
      + 'swap.',
    todoTest: '26-metal-a.test.ts::Cosmic Conspirator',
  },
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
  {
    card: 'Calming Force', gap: 'partial', severity: 'medium',
    missing: '"I can\'t be played from your hand." — the zone restriction.',
    waitingOn:
      "A ZONE RESTRICTION on playing, enforceable only in apply.ts's doPlayCard. The "
      + 'other half ("Negate all other effects") is fully live and sweeps the whole '
      + 'stack.',
    todoTest: '40-light-c.test.ts::Calming Force',
    note:
      'This one is permissive rather than dead: the engine LETS you cast it from '
      + 'hand, which the printed card forbids. Strictly more powerful than printed, '
      + 'so it will never feel broken in a game — it will just quietly be a better '
      + 'card than it should be.',
  },

  // ── PRINTED ATTRIBUTES THE STAT LAYERS DO NOT IMPLEMENT ─────────────────
  // engine.ts's effStats() ends with the literal placeholder
  //   "// layer 5 (Inverted), 6 (Unaware) go here"
  // These cards carry the attribute in printed data — combat, targeting and
  // the UI all show it — and the engine does nothing with it. They are
  // invisible to the shape sweep: the whole card IS the attribute, so
  // `card('X', {})` is the CORRECT definition and there is no printed text to
  // flag. That mismatch is the same one that hid Harbinger, in reverse.

  {
    card: 'Its Dark Bubb', gap: 'dead', severity: 'high', deadAttr: 'Inverted',
    missing: '{Inverted} on the type line — "Invert the stat changes of inverted units."',
    waitingOn: 'Stat layer 5. effStats() has the seam and nothing in it.',
    todoTest: '43-dark-c.test.ts::Its Dark Bubb',
    note: 'The whole card is the attribute, so the whole card does nothing.',
  },
  {
    card: 'Reality Bender', gap: 'dead', severity: 'high', deadAttr: 'Inverted',
    missing: '"[Augment] {Inverted}" on the type line — the granted inversion.',
    waitingOn: 'Stat layer 5, exactly as Its Dark Bubb.',
    onlyTrackedHere: true,
    note:
      '⚠ No {todo:true} test names this card. The batch-earth-b header calls it '
      + '"PARTIAL — registered on printed data", and the card comment says the '
      + 'attribute "is carried" — both true and both misleading: carrying an '
      + 'attribute the engine ignores is indistinguishable from a blank. Applied as '
      + 'a virus to make an enemy pump backfire, it does nothing at all.',
  },
  {
    card: 'Bubb', gap: 'dead', severity: 'medium', deadAttr: 'Unaware',
    missing: '"[Augment] {Unaware}" on the type line.',
    waitingOn:
      'Stat layer 6, evaluated pairwise at every interaction site (R10 lists them: '
      + 'combat damage, targeting, "interacting with"). effStats() has the seam and '
      + 'nothing in it.',
    todoTest: '05-rulings.test.ts::R10: Unaware',
    note:
      '⚠ The todo test it points at is itself STALE: its title reads "no Unaware card '
      + 'in the M1 pool; layer-6 seam only", which stopped being true when Light & '
      + 'Dark shipped — Bubb, Trashling and Haboob all print {Unaware} today. The '
      + 'test lives in engine/test/05-rulings.test.ts and is another agent\'s file, '
      + 'so it is reported here rather than edited.',
  },
  {
    card: 'Trashling', gap: 'dead', severity: 'medium', deadAttr: 'Unaware',
    missing: '"[Augment] {Unaware}" on the type line, donated by the {Virus}.',
    waitingOn: 'Stat layer 6, exactly as Bubb.',
    todoTest: '05-rulings.test.ts::R10: Unaware',
    note:
      'The card comment says "all engine-level, no behavior" — true of the plumbing '
      + 'and false of the outcome: the attribute arrives and is then ignored.',
  },
  {
    card: 'Haboob', gap: 'partial', severity: 'low', deadAttr: 'Unaware',
    missing: '"{Unaware}" on the type line.',
    waitingOn: 'Stat layer 6, exactly as Bubb.',
    todoTest: '05-rulings.test.ts::R10: Unaware',
    note:
      'The printed EFFECT ("I deal 1 damage to each unit") is fully implemented; only '
      + 'the type-line attribute is inert. Lowest-impact of the five attribute cards.',
  },

  // ── APPROXIMATIONS SITTING BEHIND A {todo:true} ─────────────────────────
  // These cards DO something. They are here because a todo test — which can
  // never fail — is the only thing recording that what they do is not what
  // they print. That is the Harbinger trap, so they are at least visible.

  {
    card: 'Nullbringer', gap: 'approximated', severity: 'medium',
    missing:
      '"instead" — the printed text replaces a life GAIN; the engine reacts to one.',
    waitingOn:
      'A life-gain replacement seam (the same one Suspend waits on). Implemented as '
      + 'a trigger: gain N, then lose 2N, which lands on the right final total '
      + '(baseline − N) but SPIKES through the gain first.',
    todoTest: '40-light-c.test.ts::Nullbringer',
    note:
      'The spike is observable: anything watching lifeGained fires, and a gain that '
      + 'would cross a threshold crosses it before coming back.',
  },
  {
    card: 'Automaton of Abundance', gap: 'approximated', severity: 'low',
    missing: '"an additional copy of each UNIQUE token" — the batch semantics.',
    waitingOn: 'A settled reading of "unique" across one creation batch.',
    todoTest: '26-metal-a.test.ts::Automaton of Abundance',
    unverified: true,
    note:
      'Unverified: the todo test names the question and does not answer it, and I did '
      + 'not trace the creation path end to end. It may already be right.',
  },
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
      'A compound cost shape. AbilityCost expresses `sacrificeSelf: true` OR '
      + '`sacrificeOther: n`, never both as a single payment, so Deformant picks the '
      + 'ally and destroys both at RESOLUTION rather than in the cast window.',
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
