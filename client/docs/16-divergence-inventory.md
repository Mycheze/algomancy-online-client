# 16 — The divergence inventory — everything known to differ from printed text

**Built 2026-08-25** by a three-agent sweep of all 30 files in
`engine/src/cards/sets/` (457 cards examined), then triaged against the owner's
27 answers of 2026-08-25. This file is the durable record; the sweep itself is
gone.

> ## ⚠ ROUND 26 (2026-08-25) WORKED THIS FILE. Read this block first.
>
> **§1 has a real number now.** The 316 gated promises were partitioned by WHAT
> WOULD HAVE TO HAPPEN before they are owed, and the drill learned to activate
> (see 84-card-semantics). The suggested attack below was WRONG about where the mass is —
> activated abilities are **35 of 316 (11%)**, a cheap ninth and not "the cheap
> third". The `[Augment]` box is **152 (48%)**. Re-order the next round
> accordingly: stage 4 unblocks nearly half the heap, stage 3 a third.
>
> | gate | claims | cards | needs | observed |
> |---|---:|---:|---|---:|
> | `augment` | 152 | 117 | a graft HOST | 0 |
> | `trigger` | 110 | 99 | a fixture firing the EVENT | 56 |
> | `activated` | 35 | 24 | somebody to PAY & ACTIVATE | **35** |
> | `condition` | 19 | 17 | a BOARD meeting the clause | 7 |
>
> **"316 have never been observed" was itself wrong**: attributed honestly, 80
> already had evidence. Stage 2 took it to **98/316**. The number to NOT quote
> is the naive 157/316 — it is inflated by counting a card's own body arriving
> as evidence for its activated ability.
>
> **§2 CLOSED, with rulings:** SPELL-COPY (CR 710.8) · SPAWN-COUNTERS (CR 301.8) ·
> PLAY-VS-PUT-INTO-PLAY (CR 701.3) · DOUBLING OVERSHOOTS (CR 709.7) · ORIGON, both
> halves · SURVIVE-DAMAGE (CR 802.3a) · KEEP-THIS-TARGET (CR 110.9a) ·
> DESPAWN ON RECALL (CR 721.1f) · STATIC-VS-TRIGGER (CR 707.3) · MODULE-LEVEL LATCH
> · MID-BATTLE FORMATION JOIN (CR 711.3, ruled) · both §2c erase copies and
> both §2c stack lookups.
>
> **§3 CLEARED** — 18 comments, plus a guard (`147-comment-conformance`) so the
> shapes cannot rot again. **§3 was WRONG about Counter Theif** — see below.
>
> **Corrections this file needs to carry** (each cost real work to find):
> - **DESPAWN ON RECALL named 7 cards; it is 6.** Tempest Oracle was never
>   affected — its "When I despawn" is in `abilities` with no `[Augment]`
>   marker, so it rides `fireEvent`'s `dyingUnit` unshift. Pinned as a control.
> - **SPELL-COPY's consequence list was BACKWARDS.** Two `[Solved]` designer RAQ
>   threads (verified verbatim in `data/rulings/exports/`) say *"he won't make 2nd
>   copy, since 1st copy wasn't 'played'. Sorry. No infinite loop there."* The
>   eight cards listed as "missing it" all print "play"/"played" and correctly
>   miss a copy. `eraseSelf: () => {}` was CORRECT, not a defect.
> - **§2c said three erase copies; there are two.** Celestial Purge always
>   *called* the helper.
> - **§3 said "Nothing is misspelled" about Counter Theif. It is wrong.** The
>   PHYSICAL card prints "Theif"; our data was corrected at the owner's
>   instruction on 2026-08-24 and `registerAlias` keeps the printed spelling
>   resolving. Writing §3's line into the file would have destroyed a real fact.
> - **Burgeon's overshoot needs NO combo**: Rampart Guardian is a printed
>   `{Tough}` 0/4 and a legal target. A Burgeoned one read 24 where the card
>   promises 16.
>
> **New owner rulings**, recorded in the retired ruling register: "target formation" is
> the WHOLE SIDE · a token stolen mid-battle SITS OUT UNTIL REGROUP (today's
> behaviour, now deliberate and pinned) · a mod that moves takes everything
> with it including `{Unstable}` (*"Unstable is just an attribute granted to
> all entities that are modded. Of course it moves with the mods."*) · a
> counter REMOVAL is not scaled by the amount layer (*"Resonater says 'put on'
> so this question is irrelevant"* — the scope of a layer is read off the
> printed text of the card that DEFINES it).

> ## ⚠⚠⚠ ROUND 27 (2026-08-26) — RESPONSE WINDOW MID-RESOLUTION IS CLOSED
>
> Read this before the two blocks below it. As always, the tables themselves are
> left exactly as written so the original reasoning stays readable; closure is
> recorded here.
>
> **§2a `RESPONSE WINDOW MID-RESOLUTION` CLOSED (CR 703.5).** The row was right on
> every fact and the premise was re-measured per card before anything changed —
> Hooba-Pon, Insidious Invitation, Tides of the Cosmos and Spell Excavation each
> produced zero `stackPushed` events for the card they played, an empty stack
> the instant the outer effect finished, and the played card's effect already
> done. `playInline` now builds a real `StackItem`, declares the play's target
> (CR 702.3c), mode (CR 702.5) and formation spot (CR 702.3e) through the OUTER resolution's
> `ctx.choose`, and hands it to `E.commitItem(…, 'push')`; the resolution
> finishes and `finishResolutionTail` opens the window. Guarded by
> `169-mid-resolution-window.test.ts` (7 tests, one per card plus the gate and
> the hazard), every one red-checked against the old behaviour.
>
> **The row said the engine "has no pause-resume seam". It does not need one.**
> The seam that was missing is not "suspend a resolution and hand out priority
> in the middle of it" — that shape is UNSAFE at this commit and would have
> re-opened the suspend-and-roll-back hazard the seat-aware gate closed (CR D2.1c) (a `'resolve'` suspension carries a
> whole-`GameState` snapshot; `resumeResolve` does `this.s = snap`). The seam
> that was missing is **defer the play to the stack and let the resolution
> finish**, which is what the spell-copy fix (CR 710.8) had already built for a spell copy. The window
> therefore never coexists with a live snapshot, and **`apply.ts` is untouched**
> — the seat-aware gate did not need widening and must not be widened for this.
>
> **Three corrections to the row, and one to the brief that drove it:**
> - The helper is at `batch-water-a.ts:82` as stated, but the four callers all
>   had to change too (a `'stacked'` outcome the caller must not bin, place or
>   erase). Spell Excavation's body was touched in exactly two places, both
>   inside its `run`.
> - `E.afterParts` never passed `formationSpot` to a SPELL UNIT's body, so a
>   spell unit played into a formation would have declared a spot and then
>   arrived beside the line. Dormant until now (`playsIntoFormation` is on one
>   card and it is a plain unit); one line in `engine.ts`.
> - The apply.ts gate is **already seat-aware** (`decisionBlocks`; CR D2.1b, D2.1c), and
>   already blocks the other seat specifically when a resolve-snapshot is live.
>   "A global gate that refuses actions from EITHER seat" describes the
>   engine before that gate became seat-aware.
>
> **What is left in §2 after this:** `PER-COLUMN FACE DAMAGE` ·
> `VARIABLE-COST ACTIVATED ABILITIES` · `PREDICTION CAP` ·
> `UNTIL-REGROUP PLAY WINDOW` · `MULTIPLAYER ATTRIBUTION`.
>
> **Two approximations the mid-resolution fix leaves standing, deliberately, and names rather than hiding:** the window starts with the INITIATIVE player
> rather than the responder (the engine's standing convention for every window,
> and both seats get priority before the item resolves); and Insidious
> Invitation still collects every seat's declaration before opening any window,
> so the second player cannot respond to the first player's play before making
> their own. Both are ORDERING, not absence.

> ## ⚠⚠ WAVE 2 OF ROUND 26 (same day) — §2 IS NEARLY EMPTY NOW
>
> Read this AFTER the wave-1 block below it. Between them they supersede most of
> §2's tables; the tables themselves are left as written so the original
> reasoning stays readable.
>
> **§2a CLOSED:** HAND-ENTRY (**CR 402.4** — `E.toHand` + `'handEntered'`;
> ⚠ the table below says "14 bare sites", the real count is **18 across 11 card
> files**, plus 2 in `engine.ts` the table never counted) · ROT/DEBT REMOVAL
> (**CR 112.15**, `E.loseRot`/`E.loseDebt`) · REAPING AS A GENERAL HOOK (**CR 802.21b** —
> and it turned out **the Afflicting ruling (now CR 802.23c) had already built the machinery** for `{Afflicting}`,
> so this was a SHARED hook, not a new one) · FORMATION AS A TARGET (**CR 110.3d**,
> a real `TargetRef` arm; the count never changed, per the owner's ruling) ·
> MOVE-A-MOD (**CR 720.10**, `E.moveMod` — `{Unstable}` is DERIVED from
> `mods.length`, not stored, so re-pointing one field moves it and all fourteen
> radiated channels at once) · MID-BATTLE FORMATION JOIN (**CR 711.3**, ruled and
> pinned; today's behaviour was correct but accidental).
>
> **§2b CLOSED:** ORIGON, SURVIVE-DAMAGE, KEEP-THIS-TARGET, DOUBLING OVERSHOOTS
> (all settled 2026-08-25) · MODULE-LEVEL LATCH · SPAWN-COUNTERS,
> PLAY-VS-PUT-INTO-PLAY (**CR 301.8, 701.3**) · STATIC-VS-TRIGGER (**CR 707.3**) ·
> DESPAWN ON RECALL (**CR 721.1f**).
>
> **§2c CLOSED** — and note the correction: there
> were **two** hand-rolled erase copies, not three; Celestial Purge always
> *called* the helper. The stack lookups are better than the table asks: the fix (CR 706.13)
> put the played item's **id on the `spellPlayed` payload**, so Earthbound
> Replicator is an identity match rather than a reverse scan. Origon and Hexbane
> Shiitake can follow — that is **CARD-TODO #69**.
>
> ### WHAT IS ACTUALLY LEFT IN §2
> `PER-COLUMN FACE DAMAGE` · `RESPONSE WINDOW MID-RESOLUTION` ·
> ~~`VARIABLE-COST ACTIVATED ABILITIES`~~ (**CR 111.7**, wave 3) · `PREDICTION CAP` ·
> `UNTIL-REGROUP PLAY WINDOW` · `MULTIPLAYER ATTRIBUTION`. That is the whole
> remainder, and it is what **CARD-TODO #50** now means.
>
> ### ⚠ ONE ROW OF §2 WAS WRONG AND IS NOT A DEFECT AT ALL
> An agent reported that `{Reaping}` had no COMBAT seam, since all four Reaping
> cards are `{Battle}` spells with printed bodies that "stand in the formation
> and fight". **Measured: a resolved spell leaves NO body**, `{Reaping}` is on
> exactly four cards all `kind: spell`, none `virus`, none with `augmentAttrs`,
> and **no card grants it by text**. A unit can never have `{Reaping}`, so the
> gap is unreachable. A fix for it was written and **reverted** — no test could
> have failed. Verify a reported bug's PREMISE before fixing it.
>
> ### §1 is nearly done — see CARD-TODO #49
> 98/316 gated promises observed → **264/316**; never-observed **218 → 52**. The
> `[Augment]` box went 0/152 → 129. **Zero broken cards**, measured. The 52 that
> remain are named individually with the precondition each lacks; the biggest
> family is REGION (CR 601.2, 6 cards) and the next thing worth building is **an
> attacking position with the card actually IN the battle**.

> ## ⚠⚠⚠ ROUND 27 (2026-08-26) — §2a `PER-COLUMN FACE DAMAGE` is **CLOSED** by the per-column attribution fix (CR 608.9a)
>
> The table row below is left exactly as it was written, so the reasoning stays
> readable. This block is the closure record.
>
> **CLOSED: PER-COLUMN FACE DAMAGE — CR 608.9a.** The `lifeLost` stays ONE event per
> seat per sub-step (it is one simultaneous strike; splitting it would make
> "when a player loses life" fire once per column) and now CARRIES the
> breakdown: `data.hits: FaceDamageHit[]`, one entry per column, with `col`
> (the live column — the dealer of a column-scoped clause) and `units` (its
> positive-power members — the dealer of a UNIT-scoped one, CR 608.5a, 608.5c). Read
> through `E.combatFaceHits` / `E.faceDamageDealtBy` / `E.unitsDealingFaceDamage`;
> `columnDealtCombatDamage`'s `'face'` arm ASKS instead of reconstructing.
> Guarded by `166-face-damage-attribution.test.ts` (18 cases, 10 of them red on
> the old code; the other 8 are controls).
>
> **Corrections this row cost, each one measured:**
> - **"R159's shared predicate" does not exist.** There was no such ruling. The shared
>   predicate is `E.columnDealtCombatDamage` (**CR 608.9a**), with its
>   sub-step gate inside it. Building on it was still the right instruction.
> - **The row names six cards; it is NINE.** Missing: **Eldritch Dreamtender**
>   (free, it already shared the predicate), **Bloodwind Revenant**
>   (`batch-fire-a.ts`) and **Flowstone Arcanite** (`batch-earth-a.ts`) — both
>   hand-rolled the identical geometric reconstruction, and Bloodwind Revenant's
>   own comment hedged it as "no such column exists in normal play". One does.
> - **The row over-claims Blightmound**, and Vroot and Flowstone Arcanite in the
>   same way. Their clause is UNQUALIFIED — no "to an opponent" — so they hear
>   UNIT damage too, and on the absorbed-{Piercing} board their column really
>   had dealt combat damage to the blockers. Firing there is CORRECT. Their face
>   bug needs a column that deals literally nothing, which needs a CR 112.11 shield.
>   A test for any of the three on the absorbed board **cannot go red**; the
>   Blightmound control is pinned so nobody writes one.
> - **The real defect is bigger than "cannot be attributed" for Vroot**: it read
>   the AGGREGATE as "that much", so it handed an opponent another column's
>   damage back as life. Measured: dealt 4, gave 5.
> - **`MULTIPLAYER ATTRIBUTION` (Cinder Scuttler) is now free** — `hits[].by` is
>   the dealing seat, which is exactly what a bin-resident card with no column
>   needs. Deliberately NOT taken here; that row belongs to another commit.
>
> ### WHAT IS LEFT IN §2 AFTER THIS
> `RESPONSE WINDOW MID-RESOLUTION` · `VARIABLE-COST ACTIVATED ABILITIES` ·
> `PREDICTION CAP` · `UNTIL-REGROUP PLAY WINDOW` · `MULTIPLAYER ATTRIBUTION`
> (minus whatever else round 27 closed in parallel).

> ## ⚠⚠⚠ WAVE 3 OF ROUND 27 (2026-08-26) — §2a's LAST COST ROW IS CLOSED
>
> **§2a CLOSED: VARIABLE-COST ACTIVATED ABILITIES (CR 111.7).** All six cards pay
> in the cast window now: Celestial Shifter, Instrument of Reassignment, Auric
> Ascendant, Slag Spewer, Glook, Infernal Cultivator. Guarded by
> `test/167-variable-ability-costs.test.ts` — one NAMED case per card quoting
> its printed clause, each red on a revert of that card.
>
> **Corrections the table below needs** (measured, not argued):
> - **"all … are paid at RESOLUTION" was half wrong for TWO of the six.** Auric
>   Ascendant's and Slag Spewer's printed `[one]` is an `AbilityCost.mana` and
>   was ALWAYS charged in the cast window. Only the other half of each was late.
>   Measured by activating all six in battle with the opponent on priority.
> - **The row's own title fits four of its six cards.** "Variable-cost" is
>   Celestial Shifter, Instrument, Glook and Infernal Cultivator. "Recall
>   another ally" and "erase one of my mods" are FIXED N = 1 and choice-bearing;
>   what they lacked was an atom of any kind, not a variable one.
> - **The fix the row implies — a variable-N atom on `AbilityCost` — is the
>   wrong one.** The engine already has variable-cost machinery
>   (`CastCost` + `n: 'X'`), and `EffectDef.castCost` already reaches an
>   activated ability and is already what `abilityUnusable` gates the OFFER on
>   (the Deformant precedent). **Two of the six needed NO new engine code at
>   all.** The other four needed three new `CastCost` kinds — `payMana`,
>   `recallUnit`, `eraseMod` — plus `AbilityCost.sacrificeNontoken`.
> - **The half-pay warning on the row is real but was never reachable.** It
>   imagined a response taking the payment away mid-window; nothing can act
>   inside the cast window at all. The live shape is the PAYER's own earlier
>   atom eating a later one's pool, which no card has. Fixed at the root anyway
>   (`E.gateCompoundCost`, CR 111.14's all-or-nothing one scope up) and tested
>   white-box, because three cards are compound now.
> - **It changes when a `[once]` is SPENT, for two cards.** Auric Ascendant and
>   Slag Spewer used to whiff ("no other ally", "no mod to erase") and the spent-on-use rule (CR 109.9a) put that in the SPENDS family. A cost cannot whiff: with nothing to pay they are
>   not OFFERED, so the `[once]` survives and the `[one]` is never paid (CR 705.4).
>   Ruled with the variable-cost row.

> ## ⚠ ROUND 27 (2026-08-26) — THREE MORE §2b ROWS CLOSED (one of them by NOT fixing it)
>
> Read this AFTER both blocks above. The tables below are still left as
> written; this records what closed and what the closing cost.
>
> **§2b CLOSED: PREDICTION CAP** (**CR 107.9**). `DecisionKind` grew `'number'` —
> the ONE kind whose `Action.choice` is the VALUE and whose `options` is empty
> (`Decision.numeric` / `NumericEntry` carries the range). Prediction Prophet
> takes any number now, with no ceiling at all; the floor of 0 is not a
> narrowing, because `E.loseLife` ends the game at 0 and `startOfDeployment`
> can never observe a negative total. ⚠ A decision kind is a CONTRACT: the
> client was wired too (`ui/inspect.ts::numberEntry` + a real typed box and
> dial in `ui/main.ts`), `legalActions` offers representatives the way
> `pickOrder` does for permutations, and the fuzzer's `decision with no
> options` invariant moved onto the RANGE instead of being deleted.
>
> **§2b CLOSED: UNTIL-REGROUP PLAY WINDOW** (**CR 405.9**). Spell Excavation grants
> `E.grantBinCardPlay` — the blanket bin-play permission, one card wide and
> phase-wide — instead of playing the spell inline. ⚠ The inline play was ALSO
> a silent timing waiver (`playInline` never reaches `playAtTiming`), so a
> deploy-timing spell in the bin was castable mid-battle; CR 702.2a says a
> bin-play grant waives no timing, and it no longer does. The card's target
> restriction lost its affordability check and its `targetCandidates` probe —
> both are questions for when you PLAY it, which is later — and the `probing`
> re-entrancy guard went with the nesting that needed it.
>
> **§2b CLOSED: MULTIPLAYER ATTRIBUTION** (**CR 900.6**) — **as UNREACHABLE, with
> nothing built.** Measured: `createGame` takes a two-tuple of names and builds
> exactly two players and two regions, `other(seat)` is the literal `1 - seat`
> (so `other(2)` is -1), and `commitPlayerDamage`/`thievingDraws` iterate the
> literal `[initiative, nit]`. There is no board on which a third player's
> damage can fire Cinder Scuttler. Deliberately NOT built, for a second reason:
> the honest fix reads `CombatLedger.playerHits`, which is PER-COLUMN FACE
> DAMAGE's seam, and two implementations of one seam is how `legalActions` and
> `apply` drift apart. Pinned with a test for the 1v1 reading instead.
>
> ### ⚠ ONE REACHABLE 1v1 GAP THE MEASUREMENT TURNED UP, still open
> A combat hit that is **fully REPLACED** — Blightsea Polyp's *"as 1 rot"*,
> `E.replaceCombatDamage` returning 0 — fires no `lifeLost` at all, and Caleb
> ruled (2024-10-24) that a replaced hit still counts as DEALT ({Thieving} and
> {Blessed} read `playerHits` for exactly that reason). So Cinder Scuttler
> misses a hit the rules say it saw. Suspend's life lock is the same shape from
> the other side. **This belongs to PER-COLUMN FACE DAMAGE**, and is one line
> per card once `playerHits` is readable from card code.
>
> ### WHAT IS LEFT IN §2 AFTER THIS ROUND
> `PER-COLUMN FACE DAMAGE` · `RESPONSE WINDOW MID-RESOLUTION` ·
> `VARIABLE-COST ACTIVATED ABILITIES`. Three rows, all §2a, all needing an
> engine primitive.
>

> ## ✅✅ ROUND 27 (2026-08-26) — **§2 IS EMPTY.** Read this first.
>
> The last three rows closed today, and with them CARD-TODO #50.
>
> | row | closed by | the correction it cost |
> |---|---|---|
> | `PER-COLUMN FACE DAMAGE` | **the per-column attribution fix (CR 608.9a)** | the row said 6 cards; it is **9**. Eldritch Dreamtender, Bloodwind Revenant and Flowstone Arcanite were missing — and **Flowstone Arcanite's own comment named all three** while the row did not. It also cited "R159's shared predicate"; **there was no such ruling** — it is the per-column rule with its sub-step gate inside it (CR 608.9a). |
> | `VARIABLE-COST ACTIVATED ABILITIES` | **CR 111.7** | "all six paid at RESOLUTION" is half wrong for two (Auric Ascendant and Slag Spewer's printed `[one]` was always charged at activation), and the title fits four of the six — "recall another ally" and "erase one of my mods" are FIXED N=1 and *choice-bearing*, so what they lacked was an atom of any kind, not a variable one. **And the prescribed fix was wrong**: the engine already had complete variable-cost machinery (`CastCost` + `n: 'X'`), so two of the six closed with **no new engine code at all**. |
> | `RESPONSE WINDOW MID-RESOLUTION` | **CR 703.5** | called "structurally the hardest item here", and it was buildable safely — because the safe shape is not the one the row implies. "Suspend mid-resolution and hand out priority" is the unsafe move; "defer the play to the stack and let the resolution finish" is the safe one, and **the spell-copy fix (CR 710.8) had already built it** for a spell copy. `apply.ts` was never touched. |
> | `PREDICTION CAP` · `UNTIL-REGROUP PLAY WINDOW` | **CR 107.9, 702.2a** | Spell Excavation was worse than the row said: not merely "collapsed to right now" but a **silent timing waiver**, a deploy-timing spell castable mid-battle, which is exactly what CR 702.2a forbids. |
> | `MULTIPLAYER ATTRIBUTION` | **CR 900.6 — measured UNREACHABLE, nothing built** | `createGame` builds exactly 2 players, `other(seat)` is the literal `1 - seat`, and combat iterates `[initiative, nit]`. No third seat is representable, so there is no misattribution to fix. The deliverable is the measurement plus tests pinning the 1v1 reading. |
>
> ### ⚠ FOUR ROWS IN THE §2a TABLE BELOW WERE ALREADY FIXED IN ROUND 26 AND STILL READ AS OPEN
> `REAPING AS A GENERAL HOOK` (CR 802.21b), `MOVE-A-MOD` (CR 720.10, `E.moveMod`), `ROT/DEBT REMOVAL`
> (CR 112.15, `E.loseRot`/`E.loseDebt`), `FORMATION AS A TARGET` (CR 110.3d, a real `TargetRef`
> arm), and `HAND-ENTRY` (CR 402.4, `E.toHand`). Verified at HEAD by the round-27 class
> audit, each against the primitive's existence. **A closure recorded only in a header
> block is a closure the table still contradicts** — which is the same failure mode as a
> stale PARKED note, one level up.
>
> ### ⚠ ONE ROW SUPERSEDED ANOTHER, SAME DAY
> The mid-resolution stack fix taught Spell Excavation's inline play to push a real StackItem; the until-regroup fix then removed that call site entirely, because "you MAY play target spell from your bin **until
> regroup**" is a GRANT, not a play. `doPlayFromBin` now carries the window. The mid-resolution stack fix's inline
> work still serves the other three mid-resolution plays. **Both rulings are correct and
> the later one wins for this card** — recorded rather than quietly overwritten.
>
> ### What round 27 found that was NOT in this file
> Two hidden-information leaks, neither of them a divergence from printed text and so
> invisible to a sweep built on this file's question: **the hand-entry leak (CR D6.5)** (`handEntered` named the
> opponent's incoming cards on the wire, in every phase) and **the look-at-a-hand leak (CR D6.5a)** (three cards
> printing "look at" published a whole hand to the shared log). Both were invisible to all
> 153 engine test files for the same structural reason — see CARD-TODO #84.

**Status key:** `DONE` fixed and guarded · `OPEN` real, unfixed · `STALE` a code
comment that outlived its cause · `RULED-OK` the engine is right and an answer
says so.

> **Read [CR 101.4, 101.1](../../data/comprehensive-rules/Algomancy-Comprehensive-Rules.md#r101.4) and [[card-ruling-steer]] first.** The
> standing steer decides every ambiguity below: *"Algomancy is meant to be a
> highly exploratory and synergistic game where anything is possible"* and
> **"Printed text always wins."** Take the permissive reading.

---

## 1. THE BIG ONE — 316 printed promises nobody has ever checked

`84-card-semantics.test.ts` prints this on every run:

```
347 cards carry 439 printed promises (123 unconditional, 316 behind a
trigger/condition/activation)
114/123 unconditional promises were observed being delivered
```

**72% of what the cards promise has never been observed being delivered.**
Those clauses sit behind "When…", "if…", an activated ability's colon, or an
`[Augment]` box, and `drill.ts`'s three board states cannot fire them, so the
suite counts them out loud instead of checking them.

And the floor is lower than it looks even where it passes — the file says so
itself: *a card that prints "deal 3 damage to target unit" and deals 3 to the
**wrong** unit passes here.* It catches "promises something countable, delivers
nothing of the kind". It does not check correctness.

**This is CARD-TODO #49 and it is the next round's work.** Suggested attack, in
the order that gets signal fastest:

1. **Classify the 316 by what they need to fire.** `claims.ts` already tags each
   claim `conditional`; extend the tag to WHY (trigger event / activated cost /
   augment box / conditional clause). That partition tells you how many need a
   board and how many just need an activation.
2. **Activated abilities are the cheap third** — the drill can pay a cost and
   activate without any new machinery. Do those first and re-measure.
3. **Trigger-gated promises need a board that fires the event.** Build a
   per-EVENT fixture library (a unit dies / a card is trashed / a spell is
   played / a player loses life / a counter is placed), then drive every card
   whose claim is gated on that event through the matching fixture.
4. **`[Augment]` boxes need a host.** The drill already knows how to graft.
5. Re-measure after each stage and print the number. The goal is the printed
   number going down, and it must never be allowed to go down because the
   EXTRACTOR got weaker — `84`'s `req >= 115` floor exists for that reason;
   add the same kind of floor to the conditional count.

⚠ Do NOT "fix" this by loosening what counts as a promise. Tightening the
conditional test moved 316 claims out of the required set once already, and
every one of those moves removed a false failure rather than weakening a check.

---

## 2. OPEN approximations — the intent is clear, the engine diverges

Grouped by what a fix needs. Card file paths are `engine/src/cards/sets/`.

### 2a. Needs an engine primitive that does not exist

| id | cards | what diverges |
|---|---|---|
| **SPELL-COPY** | Earthbound Replicator, Maelstrom Charger (`batch-hybrids-wm-a.ts`) | **Biggest item in the inventory.** `runSpellCopy` calls `def.run(...)` in place, off the stack. The copy is unrespondable, un-negatable (Dematerialize/Calming Force/Containment Protocol/Malevolent Machinations all sweep the stack and never see it), fires no `spellPlayed`/`cardPlayed` (so Stalwart Sentinel, Proph, Dragnol, Death Greeter, Aethercap Siphoner, Void Mandible, Origon, The Silent all miss it), and `eraseSelf: () => {}` means a copy of Suspend or Temporal Rift erases nothing. Fix = clone the `StackItem` and `pushItem` it. Hard parts: must not re-pay the cast cost (CR 111.5 receipt is inherited) nor re-ask the mode (CR 710.8a); `dischargeItem` has nowhere to put a non-card; target re-collection belongs in `collectTargets`, not before the copy. |
| **HAND-ENTRY** | Rider of the Tides, Xenopod Progenitor, Galerider Eel (`batch-water-a/b.ts`) | There is no `E.toHand` and no `'handEntered'` event. All three print "whenever a card enters a player's hand during battle" and listen on `'despawned'`+`'draw'` — a recall and a draw. **14 bare `player(seat).hand.push(name)` sites** across the card files announce nothing. Fix = `E.toHand(seat, name, from)` firing `'handEntered'`, all 14 routed through it. ⚠ "one or more cards" must fire ONE event for a multi-card move, matching `'draw'`. |
| **PER-COLUMN FACE DAMAGE** | Blightmound, Sarcophage (`batch-dark-b.ts`), Amphivore, Rippleback Skulker (`batch-water-a/b.ts`), Vroot, Zephyrzoa | `commitPlayerDamage` folds every connecting column's face damage into ONE `lifeLost` per seat per sub-step, so "a unit deals combat damage to a player" cannot be attributed. Sarcophage strips counters off a 0-power passenger; a Piercing column fully absorbed by blockers still reads another column's hit as its own. `engine.ts`'s own comment names the blast radius. The shared column-damage predicate narrowed this but did not close it. |
| **RESPONSE WINDOW MID-RESOLUTION** | Hooba-Pon, Insidious Invitation, Spell Excavation, Tides of the Cosmos (`batch-water-a/b.ts`, helper at `batch-water-a.ts:82`) | `playInline` builds no `StackItem` — nobody gets priority between "you play it" and "it resolves". The engine has no "pause this resolution, open a priority window, resume" seam; `ctx.choose` suspends for *questions*, not windows. Structurally the hardest item here. |
| **VARIABLE-COST ACTIVATED ABILITIES** | Celestial Shifter (`batch-metal-a.ts`), Instrument of Reassignment (`batch-metal-b.ts`), Auric Ascendant (`batch-hybrids-wm-b.ts`), Slag Spewer (`batch-hybrids-fwe.ts`), Glook (`batch-dark-a.ts`), Infernal Cultivator (`batch-fire-a.ts`) | `AbilityCost` atoms are fixed-N; only `CastCost` grew `n: 'X'`. So X-mana abilities, "sacrifice X units", "erase one of my mods" and "recall another ally" are all paid at RESOLUTION — the ability reaches the stack with its size unknown and the opponent responds blind. ⚠ `collectItemCosts` has a documented latent half-pay bug for COMPOUND costs (mana + a choice-bearing atom); Auric Ascendant would be the second card to hit it. |
| **REAPING AS A GENERAL HOOK** | Invasive Reassignment (`batch-metal-b.ts`), Noxious Demise (`batch-wood-b.ts`) | `{Reaping}` lives in `dealEffectDamage`, so a kill by a STAT SWAP or by a COUNTER never sees it. Both cards hand-roll the rider in card code. Fix = a general "this effect killed a unit" hook. |
| **MOVE-A-MOD** | Rotbeast (`batch-dark-b.ts`), Reconfigure | No primitive; the mod entity is re-parented by hand (5 fields + two arrays) in two places. Fix = `E.moveMod(mod, host)`. Must decide what a move does to host-anchored statics/costMods, `{Unstable}` derivation on both hosts, and a bounded budget the mod carries. |
| **ROT/DEBT REMOVAL** | Burn the Blight (`batch-dark-a.ts`) | `gainRot(-n)` is a no-op by design (CR 112.13a: rot never decreases on its own), so the card zeroes `p.rot`/`p.debt` **directly** — the only writes outside `gainRot`/`gainDebt`. No event fires, so nothing watching player counters can see it. Fix = `E.loseRot`/`E.loseDebt` firing a real event. Decide whether an `AmountMod` scales removals (probably not). |
| **FORMATION AS A TARGET** | Galactic Germination (`batch-hybrids-wm-b.ts`) | Prints "target formation"; proxied by targeting a unit and then taking the whole grid SIDE. `TargetRef` has no formation arm. ⚠ Confirm with the owner whether "formation" means the side or the column — if column, the count changes materially and this becomes a ruling. |
| **MID-BATTLE FORMATION JOIN** | Download (`batch-metal-a.ts`) | `E.giveControl` unslots the stolen unit and never re-slots it, so a stolen Robot fights for nobody for the rest of the battle. `E.placeInFormation` exists (Hooba-God uses it). Needs a ruling on whether it joins mid-battle or waits for regroup. |

### 2b. Card-local, no new primitive needed

| id | card | what diverges |
|---|---|---|
| **SPAWN-COUNTERS** | Powerforge Synergist (`batch-metal-b.ts`), Aethercap Siphoner (`batch-hybrids-wm-b.ts`) | "I spawn with N counters" is a trigger/`when()`-mutation, so the counters land AFTER the spawn event and every spawn watcher reads the wrong body (Iyngstra gains 4 not 1; The World Shepherd, Aether Channeler, Transmutide Enigma, Stalwart Sentinel all see a 4/4). Powerforge additionally writes the field RAW, bypassing CR 707.5a's amount layer — so "I spawn with two +1/+1 counters" and "Create a Robot 2" get different answers under a Flux Resonator. Fix = a declarative `spawnsWithCounters` that `spawnUnit` applies through `amountDelta` before firing `'spawned'`. Same class CR 303.11 settled for Borrower of Forms. |
| **PLAY-VS-PUT-INTO-PLAY** ✅ FIXED 2026-10-22 (CT-245, CT-255) | Wake the Dead (`batch-dark-a.ts`), The Bonesculptor (`batch-earth-c.ts`) | **Fixed:** Wake the Dead's units are now real plays on the stack (CT-245), and The Bonesculptor's (and Gridxlan's) bin play is a standing permission, an ordinary play from the bin (CT-255, CR 707.10). What the row said before: both print "**play**" and call `spawnUnit`, so no stack item and no `'cardPlayed'`. Exhume/Resurrect/Rousing Spirit/Lurking Dread print "put into play" and are correctly `spawnUnit`. Same defect fixed on Bloomcaster in `36bb4ed`. Hard part: Wake the Dead's units come from EITHER bin with a separate owner, and "for free" must skip payment while still being a play. |
| **DOUBLING OVERSHOOTS** | Burgeon (`batch-wood-a.ts`), Surly Stalker (`batch-water-b.ts`) | "Double" is `addTemp(+current)` — stat layer 3 — but `{Tough}`/`{Balanced}` apply at layer 4, so doubling a `{Tough}` 0/4 gives 0/24 where "double its defense (8)" is 16. ⚠ The comment claiming "no pool combo hits this today" is **FALSE**: Rampart Guardian ({Tough}), Child of Aether ({Balanced}) and Reality Bender ({Inverted}) are all `virus: true` and can donate to any unit. |
| **STATIC-VS-TRIGGER** | Aetherflux Golem (`batch-earth-a.ts`) | "[Augment] I gain +2/+2" is a trigger adding two counters, while two cards printing the SAME sentence are plain statics after a playtest ruling — Malformed Monstrosity and Tenebrous Bulborb, whose comment quotes the owner: *"The 'I get -2/-2' isn't a trigger that should go on the stack. It's a static effect."* Changing it also changes counter-matters cards, respondability, and pairwise cancellation with −1/−1 counters. |
| **DESPAWN ON RECALL** | Celestial Fluxmorph (`batch-metal-a.ts`), A Pile of Runes, Tempest Oracle, Demon of the Depths (`batch-hybrids-fwe.ts`), Verdant Necrophage, Pathogenic Enclave, Growing Plague (`batch-wood-*.ts`) | `E.leavePlay` deletes every mod entity BEFORE `afterDespawn` fires `'despawned'`, so a donated "[Augment] When I despawn" listener has no anchor left. `destroy()` deliberately fires the death BEFORE erasing mods and says so in a comment. So donated despawn text works on a DEATH and is dead on a RECALL or CACHE — half the printed word. ⚠ The transform fix (CR 410.3) added `revertFace` at the top of `leavePlay` but did NOT change the mod-deletion ordering. |
| **ORIGON'S FIRST SPELL** | Origon (`batch-hybrids-fwe.ts`) | Counts only spells played while the carrier was in play, so an Origon entering mid-battle negates the first spell IT sees, not the seat's actual first. **Cheap fix exists**: `commitItem` already bumps `spellsPlayed:<seat>` per region BEFORE firing `spellPlayed`. Wrinkle: that counter skips `spellToken` while this batch's convention counts tokens as spells (CR 302.3) — pick one and say so. |
| **SURVIVE-DAMAGE** | Molten Tormentor (`batch-hybrids-fwe.ts`) | "Whenever I survive damage" is `u.damage < toughness` at event time, so a `{Deadly}` hit below toughness "survives" and pays out, then the unit dies. Needs a `lethal` fact on the `damage` event. |
| **PREDICTION CAP** | Prediction Prophet (`batch-light-c.ts`) | "Predict your life total" is an option list capped at `life + 5`. Any number is legal on the card. Needs a numeric-entry `Decision` kind (new UI affordance + validation surface) or a provably sufficient headroom. |
| **UNTIL-REGROUP PLAY WINDOW** | Spell Excavation (`batch-water-b.ts`) | "You may play target spell from your bin **until regroup**" is collapsed to "right now". `CachedCard.playableUntilTurn` is the nearest primitive but lives in the CACHE and expires end-of-turn, not at regroup. |
| **KEEP-THIS-TARGET** | Divine Intervention (`batch-light-b.ts`) | "You may change the targets" re-picks EVERY slot with no explicit "leave this one". Trivial. Check Gravitational Correction matches. |
| **MODULE-LEVEL LATCH** | Ancient One (`batch-metal-a.ts`) | `let aoScanning = false` — the last of the module-level reentrancy flags playtest report #60 named; the replacement layer removed five others. Not serialised, lost on a JSON round trip. Harmless today (set and cleared inside one synchronous `when()`), but the same class. |
| **MULTIPLAYER ATTRIBUTION** | Cinder Scuttler (`batch-fire-a.ts`) | Reads "you deal combat damage" off aggregated `lifeLost`; in 1v1 exact, in multiplayer a third player's damage fires it. Low priority while the game is 1v1. |

### 2c. Card-side copies of an engine choke point (drift risk, not yet drifted)

- **Three erase copies bypass `E.eraseFromPlay`** — `src/cards/sets/helpers.ts:141`, `batch-hybrids-ld-a.ts:115`, and Celestial Purge in `batch-water-a.ts`. CR 410.3 gives this a new consequence: a transformed card erased through any of them does **not** turn back over, so the erased pile records "Beyond, Codex Incarnate". Banishment (`batch-light-b.ts:99`) uses the helpers copy, so it is reachable today.
- **Hexbane Shiitake** (`batch-wood-a.ts:416`) and **Origon** (`batch-hybrids-fwe.ts:125`) both locate a spell by `(card, controller)` on the stack. Neither can see a `commitItem(…, 'resolve')` play. **Origon uses `.find()` not `.reverse().find()`, so with two copies of a card on the stack it negates the BOTTOM one — the wrong item.**

---

## 3. STALE comments — a note that outlived its cause

The sweep found ~20. A later cleanup round cleared several; these were reported and are believed
to remain. Each makes a LIVE card look parked or an approximation look present.

- `batch-fire-b.ts:13-17` — the whole approximations block; all three costs are cast-time now and the promised `⚠` markers are gone.
- `batch-earth-c.ts:42-52` — Bonesculptor's "wastes the once-per-turn budget" (now has `usableWhen` + two refunds); Throwing Boulder's "checked at RESOLUTION" (since fixed, CR 111.7b); Squish's "printed attrs" (it sets `sourceId`).
- `batch-dark-c.ts:66-70` — Grox "STILL AT RESOLUTION" — it is `castCost: { kind: 'eraseBin', n: 2 }`, and the SAME header retracts it 20 lines up.
- `batch-dark-c.ts:216` — Collect Remains "'Erase me' is still approximated" — `ctx.eraseSelf()` is real since CARD-TODO #15.
- `batch-fire-a.ts:266-271` — Delver of Mysteries "the bin isn't a target zone" — it is `what: 'binCard'`, and the correction sits directly below the stale paragraph.
- `batch-fire-wood.ts:12` — "Nothing parked in this batch", while Bloomcaster's own comment points at a `⚠` note that does not exist.
- `batch-water-a.ts:20-35` — a block titled `PARKED (needs engine primitives…)` whose every entry says `NO LONGER parked`.
- `batch-metal-c.ts:29-38` — Technological Superiority and Void Memory filed under "⚠ ENGINE APPROXIMATIONS" while both are **provably exact**. Move them out.
- `batch-wood-a.ts:66` — Burgeon's "No pool combo hits this today" is **false** (see 2b).
- `batch-hybrids-ld-c.ts:49-53` — "STILL AT RESOLUTION: No Hand Killer's Discard X" — it is a cast cost, and the card's own comment 600 lines below says so.
- `batch-hybrids-wm-a.ts:777` — Hearthwood Ancient "paid at resolution", two lines above a `cost: { sacrificeOther: 1 }`.
- `batch-metal-a.ts:24-33` — the Deformant half is stale (its receipt and both engine edits shipped); the Celestial Shifter half is live.
- `batch-hybrids-ld-c.ts:466` — Counter Thief "the printed NAME is misspelled". Nothing is misspelled.
- `batch-light-a.ts:83-97` — a `payLife` helper that is **dead code** (all three life-cost cards moved to real costs) with a doc asserting the opposite. `tsconfig` has `strict` but no `noUnusedLocals`, which is why it survived.
- `batch-metal-a.ts:579` — Celestial Shifter's "base X/X is a temp delta". It is `g.setBase` — a layer-2 replacement. Behaviour right, description wrong in the direction that misleads about layer order.
- Three `PARKED` section headings with nothing parked under them: `batch-hybrids-ld-c.ts:76-88`, `batch-hybrids-wm-a.ts:86-100`, `batch-light-c.ts:68-88`.

---

## 4. RULED-OK — the engine is right and an answer says so

Recorded so nobody re-opens them. All from the owner's answers of 2026-08-25 unless noted: §6 (a {Virus}
[Augment]'s "you" is the host's controller), §7 (Necromantic Rebuke's X IS the
printed additional cost), §9 (unqualified "gain rot" = the controller), §12 (a
bin-play grant does not waive printed timing), §13 (tokens ARE spells), §14 (any
difference from printed stats is a stat change), §17 (Torrential Reclamation
distributes over both clauses), §18 (Big Glimpse Card), §19 (a Bloppert tie does
nothing), §5's damage half ({Swift}+{Sluggish} striking twice is intended —
"Algomancy's answer to double strike"), §8 (Dropslime's discard line already
works in battle), §26 (Rook already reached enemy hosts and stack hosts).

Also ruled and implemented: **Might of the Grove**'s type line is
`{Battle} Tree Druid Spell` (Bena, 2026-08-25). **Interdiction Rift**
(`{Battle}AI Cosmic Spell`) is a repair of identical shape that is **still
unruled**.

⚠ Both are still wrong UPSTREAM in `AlgomancyCards-OracleText.json`, which the
RAG corpus and the Discord bot read directly. One message to Caleb fixes it
everywhere instead of three extractor overrides.

---

## 5. Still needing an owner answer

- **The multiplier ruling's second half.** The multiplier formula is `v × 2 × n`, but how a multiplier composes with an ADDITIVE amount mod was never answered. Implemented as multiplier-AFTER-additive, marked unruled, pinned by a test in `137-multiplier-and-mode.test.ts` so a future ruling changes two lines and one test. ⚠ The formula is also LINEAR in n — three Arbiters give 6×, where a purely multiplicative reading gives 8×. Worth confirming.
- ~~**"Formation" for Galactic Germination**~~ — **ANSWERED 2026-08-25: the WHOLE SIDE.** So the engine's proxy gives the right count; what is still missing is a real `TargetRef` formation arm, so "target formation" can be targeted, redirected and read as a formation by anything else.
- **Interdiction Rift's type line** (above).
