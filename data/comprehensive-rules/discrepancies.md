# Algomancy Comprehensive Rules: Discrepancy Report

Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision; every other item already says which side the document follows.

## 1. Questions for the owner (6)

### D-U07-3 · Sources disagree · rule 405.5

Does a dying {Unstable} card enter the bin (and get trashed) before it is erased? The printed reminder and Caleb say it is erased in place of entering the bin. R137 (owner) says it enters the bin, is trashed there, and is then erased, and the engine does that.

- card: Abyssal Evocation: "(If they would enter a bin, erase them instead.)"
- R145: ""Unstable": "If an unstable card would enter a bin from an active"
- R137 (its body-trash ruling and its Rector and Distiller notes): "Unstable units still die, they just get erased instead of ending up in the"
- R137 (its body-trash ruling and its Rector and Distiller notes): "**An Unstable card that dies enters a bin, is trashed there, and is only then"

**Resolution:** Question for the owner. Caleb's 2025-04-08 words, "erased instead of ending up in the bin", can be read two ways: (A) the card never enters the bin, so it is not trashed; (B) it does not stay in the bin, so it may pass through it and be trashed. The printed reminder ("If they would enter a bin, erase them instead") and Caleb's glossary line in R145 read only as (A). R137 takes (B) on purpose and calls (A) "the plain sense of the text". For tokens the designer does use the pass-through model (RAQ 1355689559609839787#4: "they enter your hand/bin and then are instantly erased"), and R137 builds its argument on that. Under the authority order print and designer outrank an owner call, so zones.bin.unstable states (A) at low confidence and F-U07-6 records the engine divergence. If the owner keeps R137 as a deliberate divergence, as R262 did for the Manual's recall sentence, restate zones.bin.unstable as (B) and close F-U07-6.

### D-U07-5 · Sources disagree · rule 407.3

Do tokens belong on the erased pile? R306 and R167 record a dying token, and a token mod whose host leaves play. R219 refuses to file a token mod erased off a living host, because "R65's pile is a list of cards".

- R219: "- **A token mod is not filed.** R133: a token is not a card, and R65's pile is a"
- R306: "unchanged: the `died` event still says `to: 'bin'`, anything reading the bin in"
- R167: "reaches the public erased pile exactly once on each of the three routes."

**Resolution:** Question for the owner. R65's purpose, "there's currently no way to view erased cards", can be read two ways: (A) the pile lists the cards that left the game, and tokens are not cards (R133), so no token belongs there; (B) the pile records everything erased, tokens included. R306, R156 and R167 follow (B); R219 follows (A) for one route and says "that disagreement predates this and was left alone rather than widened". zones.erased.tokens states (B), the majority, at medium confidence.

### D-U12-11 · Other · rule 608.3d

A half-column that gains Sluggish during the step when no Sluggish sub-step was scheduled: the designer says it strikes in the Sluggish sub-step and that the presence of Sluggish opens a new stack before the next damage step; R295 fixes the schedule when the step begins, so no window opens before that strike.

- RAQ 1363298910528864318#2: "It's still possible to give this column Sluggish attribute and it will deal damage during sluggish-combat-damage (for effective doublestrike)"
- RAQ 1540678747953569832#2: "presence of Swift or/and Sluggish opens new stacks which must be resolved before you move to next combat damage step (swift->normal->sluggish)"
- R295: "when the damage step opens, and never recomputed. A Swift unit dying in the Swift"

**Resolution:** Question for the owner. The designer's words 'presence of Swift or/and Sluggish opens new stacks' support two readings: (1) presence is judged when the step begins (R295, the document: the column strikes but no window opens before it, 608.3c); (2) presence is judged live, so the gained Sluggish opens a window after the normal sub-step and the normal sub-step's triggers resolve there instead of after combat. The RAQ example that covers the gain had a Sluggish column already scheduled, so it does not decide this.

### D-U12-12 · Other · rule 608.2d

Pure in combat is defined per attacking-half/blocking-half pair; an unblocked column holding a Pure unit has no pair, and no source says whether its own attributes (Swift, Powerful, Thieving) apply to its damage to the player.

- card: Just a Unit: "Pure cards and cards they are interacting with ignore all other attributes."
- R61: "Combat is where attributes live, and combat already resolves per"

**Resolution:** Question for the owner. The printed words support two readings: (1) a Pure card always ignores its own other attributes, so an unblocked Pure column strikes in the normal sub-step with none of its attributes; (2) Pure acts only within an interaction with another card, so an unblocked Pure column keeps its attributes against the player.

### D-U14-11 · Other · rule 701.1e

R26 says Bloomcaster's trigger fires on its own play and dates itself to the 2026-07-16 engine. The current engine hears plays only from cards in play, and a played card is on the stack, not in play, when its play fires; the designer write-up describes that state for Mycelial Mentor. The engine now makes no 1/1 for Bloomcaster's own play (F-U14-5).

- R26: "Bloomcaster's "[Augment] Whenever you play a unit" (no "another") **fires on its own"
- RAQ 1353862592661164152#0: "He goes on the stack (but is not Spawned / In play yet)"
- card: Bloomcaster: "Whenever you play a unit"

**Resolution:** Question for the owner. The printed words "Whenever you play a unit" support two readings: (1) the card's own play counts, as R26 rules; (2) only units played while Bloomcaster is already in play count, which is what the engine now does and fits the RAQ stack model. The rule states R26 (current) and is marked engine-differs until the owner confirms or supersedes it.

### D-U14-7 · Sources disagree · rule 701.1c

The Rulebook 2023 calls tokens "temporary cards" and spell tokens "cards" that are cast from play. The owner ruled that tokens are not cards, and R305 makes "card" costs and watchers ignore a spell token cast.

- Rulebook 2023 p.4: "Tokens are temporary cards that are created directly into play"
- Rulebook 2023 p.4: "only cards currently that are “cast” from play, which functions the same way as if they were cast from your hand, but you may"
- R305: "**A token is still not a CARD.**"

**Resolution:** Question for the owner. The printed words support two readings: (1) "cards" in the Rulebook is loose description, so a token is not a "card" for card text (R133/R305, which the rule follows); (2) a token is a card, so "Cards played during battle" (Arbiter of Armistice) and Vengeance would tax a spell token. Printed text outranks an R-ruling, so the rule as written stands only if reading (1) is right.

## 2. Register and test fixes (15)

### D-U07-10 · Other · rule 400.4

R262 says it knowingly overrules a Manual sentence ("a recall goes to its owner's hand"), but no page of the printed Manual or Rulebook that this project extracts contains that sentence.

- R262: "**1. The Manual's recall sentence is overruled, knowingly.** The Manual says a"

**Resolution:** The rule states R262. Find the sentence R262 means, or correct R262's attribution. Question for the owner only if the judge's CR quotes such a printed sentence.

### D-U07-15 · Sources disagree · rule 410.1a

Does only a change of zone make a target fail? Caleb says things "only" fail to resolve when a unit changed location; the [Solved] "Valid targets becomes invalid" write-up says a target that became invalid fizzles, and R324 follows it.

- RAQ 1454169054402314362#2: "Things only wouldn't resolve if a unit changed to a different location (like went to your hand, the bin, etc)"
- RAQ 1355466429788328066#1: "If you did target something which was valid, but became invalid target then effect will fizzle on resolution."
- R324: "A target that fails is lost exactly like a target that left play. If every"

**Resolution:** Resolved without asking, both sources being tier 1: Caleb was answering whether a second effect aimed at a unit Organic Exchange also targets still resolves, where the unit stayed a legal target; the _passer write-up answers the case where a target stops being legal, and R324 encodes it. The rule states both. Question for the owner only if Caleb's "only" is meant to cover a target that is still in play but no longer legal.

### D-U07-16 · Sources disagree · rule 410.4d

Is a modded unit that is exchanged trashed before it is erased? R157 §3 calls an exchange "a despawn and trashing", and R146/R152 put a modded exchanged body through the bin and trash it before the sweep. The printed {Unstable} reminder replaces the bin entry, which would mean no trash. This is D-U07-3 on the exchange route.

- card: Abyssal Evocation: "(If they would enter a bin, erase them instead.)"
- R157 (§3): "It's not a death, but it is a despawn and trashing. Weird corner case."

**Resolution:** Follows D-U07-3. zones.changes.mods.exchanged states only that the unit and its mods are erased, which every source agrees on; it says nothing about a trash. If the owner keeps R137, the exchange route trashes the body too (as R146 encodes); if not, neither route does.

### D-U07-4 · Register chain wrong · rule 400.4

R145 sends an {Unstable} card leaving the stack "straight to the owner's public erased pile". The register now says every erased pile follows control (R262, applied by B4 to R156 and R172), but R145's "owner's" is not marked.

- R145: "**From the stack** — straight to the owner's public erased pile (R65)."
- R262: "(a) All four follow control"

**Resolution:** Add a narrowing mark on R145 for the stack route if the owner's "one rule, no seam" reaches it, as the B4 adjudication did for R156 and R172. Question for the owner only if the stack route (a card that never left play) is meant to differ, since R262's four routes are all departures from play.

### D-U07-6 · Register chain wrong · rule 403.5

R206 says an expired glimpse card is still "moddable", and our glossary's Glimpse row still says "still moddable out of the zone at full price". R303 (later) says an expired glimpse is no permission for any verb. R206's clause is not marked superseded.

- R206: "over-broad — an expired glimpse card is still public, targetable and moddable),"
- R303: "expired glimpse, unfulfilled banner, or neither | refused | refused"
- glossary: Glimpse: "still moddable out of the zone at full price"

**Resolution:** R303 is current and is stated (zones.cache.lapse, zones.cache.no-permission). Mark R206's Glimpse-row clause as reversed by R303, and fix the glossary row (F-U07-5).

### D-U12-13 · Engine only · rule 608.8c

Caleb's 'replacement effects only apply once in an effect' can be read per damage (the leftover is not replaced again by anything) or per effect (each replacement effect applies once, so another Oorblak or a Blightsea Polyp may take the leftover). The engine takes the per-effect reading.

- RAQ 1397188292239163454#0: "replacement effects only apply once in an effect Unless a new trigger occurs"
- file: client/ledgers/raq.ts: "the other 6 still reach the player, and are not redirected again."

**Resolution:** The document states the per-damage reading, as the register states the claim, and files the engine's behaviour as F-U12-1. Question for the owner only if the per-effect reading was intended (then two Oorblaks would each take their share and only the rest reach the player).

### D-U12-15 · Other · rule 608.4c

R185 treats 'a blocked column stays blocked' as an owner decision over an engine accident, and attributes the owner's R72 words ('stays, but has nothing to deal damage to') to the Manual. Both books print the stays-blocked rule; the Manual does not say the quoted words.

- R185: "MIRROR case — a blocker whose attackers have all died *"stays, but has nothing"
- R72: "> "It stays, but has nothing to deal damage to, so it doesn't deal damage. But"
- Manual p.23: "The column is considered blocked even if the defending unit is removed"

**Resolution:** 608.4c cites the printed books (basis mixed); 608.4e cites R72 and the designer RAQ, not the Manual. Fix R185's attribution in the register.

### D-U12-16 · Other · rule 608.2e

The RAQ register's note on the Swift-gains-Sluggish claim says the engine keeps no strike memory; R320 added it.

- RAQ 1363298910528864318#2: "It's still possible to give this column Sluggish attribute and it will deal damage during sluggish-combat-damage (for effective doublestrike)"
- file: client/ledgers/raq.ts: "Green today only because the engine keeps NO strike memory at all."

**Resolution:** The register note is stale: R320 is the strike memory it was waiting for, and R320 says a Swift mark bars only normal damage, so the double strike is now held by rule. Update the note in client/ledgers/raq.ts.

### D-U12-18 · Other · rule 608.2a

Our glossary's Swift row says triggers from Swift damage resolve before normal damage and cites R117. R117 does not say it; the chain is R31 (said it) → R261 (reversed it) → R295 (restored it, on the stack with priority, in a split step).

- glossary: Swift: "triggers from that damage resolve before normal damage."
- R261: "They no longer land before normal damage. They land after combat, with everything else. A"

**Resolution:** The glossary sentence matches current law (any battle where a Swift strike is followed by normal damage is split), but it should cite R295. Glossary fix, not a rules change.

### D-U12-19 · Other · rule 608.5b

R23 still carries an engine-call warning for its Vulnerable/Piercing ordering, which the designer has since confirmed.

- R23: "Deadly's 1-is-lethal applies to the pool. ⚠ Engine call: the Manual gives no explicit"
- RAQ 1372451771632320512#3: "you are required to assing atleast 4 damage to Crumbling (which gets doubled due to Vulnerable)"

**Resolution:** Re-ground R23's Vulnerable half on RAQ 1372451771632320512 and drop that part of the warning. Its Powerful-before-division half stays an engine call (D-U12-7).

### D-U14-12 · Other · rule 702.2d

R311 says the hand's timing-widening rules (R97/R123 haste grants, the battle {Virus} window, Ambush) apply to cached cards. The sources are silent on whether they also apply to a card played from a bin under a permission.

- R311: "own widening rules apply: R97/R123 haste grants, the battle {Virus} window,"
- R311: "Timing is the card's printed timing on both routes (R42/R45). A cached unit"

**Resolution:** Sources silent on bin plays. The rule states the cache case only. Question for the owner only if a bin-play permission and a timing grant ever meet on one card.

### D-U14-2 · Sources disagree · rule 704.6c

R5 says an effect whose every target is required (a fight) fizzles when it loses one. The designer says such an effect does not fizzle but does nothing.

- R5: "make sense (e.g. Battle/fight effects needing both units), the whole effect **fizzles**;"
- RAQ 1354013430805434389#1: "It won't fizzle, but will do nothing."
- Manual p.43: "if one of the targets for a fight or an exchange is removed, the effect will not be able to happen (it takes"

**Resolution:** Follow the designer (authority order): the rule says the effect does nothing and does not fizzle. R5's word "fizzles" should be marked as amended by the RAQ in the register.

### D-U14-3 · Sources disagree · rule 702.8b

The designer says a graft trigger whose required target has no legal candidate cannot be put on the stack. R102 says a trigger with no legal target is not a cast, so the cast-illegal rule does not apply and the part is skipped; R86 has such an item fizzle.

- RAQ 1410252965276684418#2: "can't be put on the stack unless you target such unit in your bin."
- R102: "does not apply, because this is not a cast. In practice it is unreachable:"
- R86: "| a **required** target the item never had a legal candidate for | fizzles | fizzles — it wanted a target and has none |"

**Resolution:** Follow the designer for a graft composite (the case the designer answered). Whether the same holds for every triggered ability with a required target is not stated by the designer; R102 and R86 should be marked where they conflict. Filed as F-U14-1.

### D-U14-4 · Register chain wrong · rule 704.5

R88 and R144 still say that a target restriction is asked at cast and never re-asked at resolution. R324 re-checks every target against its restriction as the effect begins to resolve. The register marks R64 and R256 as amended by R324 for the same sentence, but not R88 or R144.

- R88: "cast and is never re-asked (R5/R56), so the world may legally stop satisfying"
- R144: "re-asked at resolution**, and a card that needs it re-checked does so in its"
- R324: "When an item begins to resolve, every target it declared is judged again by the"

**Resolution:** R324 is later and is designer-backed. Add amended-by-R324 marks to R88 and R144 for that sentence.

### D-U14-5 · Register chain wrong · rule 703.5

R198 explains its in-place gate by saying that between combat sub-steps triggers are special actions and nobody gets priority. R261 moved combat-damage triggers to the stack after combat, and R295 opened priority windows at sub-step boundaries of a split damage step. R198 is still classified current with no mark on that sentence.

- R198: "sub-steps triggers are special actions and R3 says nobody gets priority. And"
- R261: "Combat-damage triggers resolve AFTER combat, on the stack, respondable"

**Resolution:** Mark that sentence of R198 as overtaken by R261 and R295. The rule text does not rely on it.

## 3. Engine-only and owner-only rules (13)

### D-U07-12 · Owner call only · rule 408.2

The recycle mark has no printed or designer source. Print says only that recycling puts a card "on the bottom of the deck"; the owner learned the mark from a judge-level player.

- R296: "Not a printed rule anywhere in this repository. The owner, 2026-09-16, after a"
- Rulebook 2023 p.7: "recycling a card in your hand (putting it on the bottom of the deck)"

**Resolution:** Owner call, stated as zones.recycle.mark with basis owner. It does not contradict print: print never says recycled cards keep their order.

### D-U07-13 · Engine only · rule 406.4b

That a negated or fizzled "Erase me" spell goes to the bin, not the erased pile, is stated only by test titles.

- card: Suspend: "Target player's life total can't change during this battle. Erase me."

**Resolution:** Engine-derived rule (zones.stack.leaving.self-erase-negated), awaiting owner sign-off.

### D-U07-14 · Owner call only · rule 410.5c

That a cached token enters the cache before it is erased is "the engine's call, not a ruling". No designer statement exists.

- R69 (its zone-visit and timing halves): "The CACHE is the engine's call, not a ruling."

**Resolution:** Stated at low confidence (zones.changes.tokens.cached). R69 says the owner may overturn it "with no other change".

### D-U12-10 · Engine only · rule 608.3c

A scheduled sub-step whose strikers have all been destroyed still gets its window (pilot verifier's probe), while R295's prose requires that the sub-step 'struck'.

- R295: "A window opens after a sub-step only when that sub-step **struck** and a **later"
- R295: "when the damage step opens, and never recomputed. A Swift unit dying in the Swift"

**Resolution:** Follow the engine's reading (608.3b, 608.3c say 'scheduled'), because R295 also fixes the schedule so that deaths cannot remove a window. Question for the owner only if 'struck' was meant literally: then an emptied sub-step would offer no window.

### D-U12-14 · Owner call only · rule 608.9a

'When my column deals combat damage' firing in each sub-step its own column strikes in, only for its own column's damage, and the column-power gate are owner rulings with no designer source.

- R117: "> It fires in the sub-step its **own column** strikes in — a {Swift} column fires in the"
- R195: "So the COLUMN is the dealer of a column-scoped clause — a 0-power anchor beside"

**Resolution:** Follow R117 as corrected by R157 §5, with R157 §4 and R195 (owner). R117's own line ('otherwise the normal one') is incomplete for Sluggish columns.

### D-U12-17 · Engine only · rule 608.6e

Three parts of the lethal-damage definition rest only on R120's engine text: Vulnerable rounded UP for odd defense, printed defense under Unaware, and counting damage already marked from an earlier sub-step.

- R120: "rounded up under {Vulnerable}, 1 under {Deadly}, printed defense in an {Unaware}"
- RAQ 1372451771632320512#3: "you are required to assing atleast 4 damage to Crumbling (which gets doubled due to Vulnerable)"

**Resolution:** Follow the engine; flag for comparison. The designer's example (a 3/8 needs 4) has even defense and does not decide rounding.

### D-U12-21 · Owner call only · rule 608.8a

That a replaced combat hit still counts as dealt rests on the owner (R238); Caleb's 'Yes' (2024-10-24) is quoted only inside R238, from the rules-questions channel, not a RAQ thread.

- R238: "> **"Yes, blightsea pollup says it deals damage as, so its still damage. Just"

**Resolution:** Follow R238 (owner). Basis owner.

### D-U12-5 · Owner call only · rule 608.5a

That a 0-power unit adds nothing but does not stop its column, and that a 0-power column deals nothing, rests on the owner alone.

- R157: "> *"Only if the other unit in the column has a positive power. 0 power units do"

**Resolution:** Follow R157 §4 (owner); basis owner. No designer or printed source.

### D-U12-7 · Engine only · rule 608.5b

Powerful doubling a column's total once, BEFORE it is divided (so Piercing excess is computed on the doubled pool), is R23's engine call; the designer only confirms that Powerful doubles combat damage.

- R23: "**Powerful** doubles the source's total damage once, **before** assignment/overflow (a"
- RAQ 1362838395298119912#2: "2/4 Resonant Powerful would deal 4 combat damage to enemy unit"

**Resolution:** Follow R23. Question for the owner only if a judge's CR doubles per unit after assignment: the two readings give different Piercing excess.

### D-U12-9 · Owner call only · rule 608.3

When a split step's windows open (after a sub-step that struck, only if a later one will strike) and that the schedule is fixed when the step begins are owner calls; the designer says only that windows 'may' exist when Swift or Sluggish units are present.

- RAQ 1363298910528864318#0: "There *may* be additional opportunity windows between swift-regular-sluggish"
- R295: "A window opens after a sub-step only when that sub-step **struck** and a **later"

**Resolution:** Follow R295 (owner). Basis of 608.3d is owner. The designer's wording is looser but does not contradict it.

### D-U14-10 · Engine only · rule 704.1

No printed, designer or owner source states that an effect's instructions are carried out in printed order with each later one seeing the earlier results. The engine does so; R68 records it only as the implemented reading for Finality and asks for a ruling.

- R68: "The straightforward reading of the printed text is implemented — the sentences"
- R68: "clause just filled. **Bena to rule.** If the answer is "no, a card negated by"

**Resolution:** The rule states the engine behaviour with basis engine. Question for the owner only if a later instruction is ever meant not to see an earlier one (Finality is D-U14-6).

### D-U14-13 · Engine only · rule 704.1

R324 fixes target legality once, as an item begins to resolve, so an earlier part cannot make a later part's target illegal. R56 says only to re-validate at resolution. No printed, designer or owner source says whether a target that an earlier instruction removes from play is lost to a later instruction of the same effect; the verifier reports the engine loses it.

- R324: "the same item therefore cannot make a later part's target illegal"
- R56: "never what will still be true later. Redirection, death, region changes and"

**Resolution:** Engine decides. The rule states only R324's legality exception; the leaving-play case is left to the engine until a source speaks.

### D-U14-6 · Owner call only · rule 704.1

R68 implements the straightforward reading for Finality (its second sentence erases the cards its first sentence just negated) and asks the owner to rule, because the reading increases the card's power. No designer source.

- R68: "The straightforward reading of the printed text is implemented — the sentences"
- R68: "clause just filled. **Bena to rule.** If the answer is "no, a card negated by"

**Resolution:** The rule states the straightforward reading, which R68 implements. Question for the owner only if Finality is not meant to erase the cards it has just negated.

## 4. Everything else (17)

### D-U07-1 · Sources disagree · rule 410.5

The Manual says a unit token that leaves play goes to the token pile "instead of the hand or bin". The designer's RAQ write-up says a recalled or dying token enters the hand or bin and is then erased.

- Manual p.15: "into the token pile instead of the hand or bin."
- RAQ 1355689559609839787#4: "they enter your hand/bin and then are instantly erased"
- R69 (its zone-visit and timing halves): "Against `data/rules/Algomancy-Manual.txt:361-362`, which says tokens go to the token"

**Resolution:** Authority order: the RAQ [Solved] write-up beats print. zones.changes.tokens states the RAQ. R69 also records an older Caleb line (2025-03-09) agreeing with the Manual; the RAQ write-up supersedes it. Rulebook 2023 p.4 ("If they leave play or enter a zone such as a hand or discard, they are erased") fits either reading.

### D-U07-11 · Other · rule 400.1

Print names a "token pile" that tokens return to. No ruling treats it as a zone. In this document a token that ceases to exist is recorded on the erased pile instead (R306, R69).

- Manual p.15: "erased from the game and returned to the token pile."
- R306: "unchanged: the `died` event still says `to: 'bin'`, anything reading the bin in"

**Resolution:** The token pile is the physical supply of token cards, not a game zone. Not listed in zones.general.list.

### D-U07-2 · Sources disagree · rule 403.3b

The Manual says the virus ability "only works from hand". The designer's RAQ claim, and R311, let a glimpsed Virus be applied out of the cache during battle.

- Manual p.34: "as a virus again, since the virus ability only works from hand."
- RAQ 1537748882501668934#3: "A glimpsed Virus can be applied out of the cache during battle."
- R311: "functions 100% like the hand* except *for the fact that it's not considered your"

**Resolution:** Authority order: the RAQ beats print. zones.cache.no-permission.like-hand states the RAQ and R311. The Manual sentence still holds for the bin (zones.bin.mods-from-bin.virus).

### D-U07-7 · Other · rule 405.1

The sources are silent on whether a bin is public. The cache (R41), the erased pile (R65) and the recycle pile's count (R296) are each stated, the hand and deck are hidden (R197b), and the pack is private (print). Nothing says who may look at a bin.

- Manual p.19: "Additionally, if a player enters a region, their bin, hand,"

**Resolution:** No rule written. Manual p.19 says a present player's bin can be "interacted with", which says nothing about looking at it.

### D-U07-8 · Other · rule 400.4c

The sources are silent on who owns a card in live draft, where every card comes out of one shared deck. R262 defines the owner only for constructed.

- R262: "Only exception is that "owner" in constructed is always the person's who"

**Resolution:** No rule written for live draft. Ownership still matters there (R250: "whose card is this? its OWNER's, always, forever").

### D-U07-9 · Other · rule 400.2

The sources are silent on whether the recycle pile and the pack are active or inactive. R145's list names play and the stack as active and five zones as inactive, but neither of these two.

- R145: "Hand, deck, bin, cache and the erased pile are **inactive**."

**Resolution:** No rule written. Nothing in the pool enters a bin from either zone, so the question has no effect today.

### D-U12-1 · Sources disagree · rule 608.3a

The 2023 Rulebook gives the damage step a priority window; the designer and the owner say an unsplit damage step has none, and the Manual's turn lists show none.

- Rulebook 2023 p.13: "block, damage and after combat steps all have a priority"
- RAQ 1363298910528864318#0: "Those windows are only present if there are any Swift/Sluggish units"
- R300: "> die. There is no window of reaction for players between those, but they're technically"
- Manual p.27: "5. Combat damage"

**Resolution:** Follow the designer (authority order), which the later Manual's turn lists agree with: an unsplit step has no priority window. The Rulebook's 'damage' window may mean the window before damage (Rulebook 2023 p.11 moves to the damage step once both players have passed after blocks).

### D-U12-2 · Sources disagree · rule 608.6c

The Manual's DAMAGE text describes a forced front-to-back flow (excess goes to the back unit); the designer and the Manual's own Q&A let the dealing player overkill the front unit and send nothing behind.

- Manual p.23: "would be enough to kill the front row, any excess damage is dealt to the unit in the back row. Excess damage"
- RAQ 1353888077625561108#1: "You can even decide to deal all damage to the front and 0 to the back."
- Manual p.43: "assign additional damage beyond lethal to a unit"

**Resolution:** Follow the designer. The p.23 text is read as the default split; the document states the elective rule (608.6c).

### D-U12-20 · Other · rule 608.6d

R114 attributes its two quotes to the designer; the 05-rulings test attributes the first of them to Bena (report #84).

- R114: "*(Designer, 2026-08-23, two answers in one sitting — playtest reports #84 and #79.)*"
- file: client/engine/test/05-rulings.test.ts: "// Report #84 (Bena, 2026-08-23): "ALL damage is dealt to units, even if it"

**Resolution:** No rule here depends on the attribution: the _passer RAQ claims 1353888077625561108#0–#2 state the same rules. Question for the owner only if R114 ever becomes the only source of a rule.

### D-U12-22 · Other · rule 608.4d

The U12 pack omits RAQ claims that 608 rules rest on: 'What is blocked?' (1366447016653361192), Poisonous vs Phytochemical Protection (1354148437355925554), and the initiative-first claim 1540678747953569832#1.

- RAQ 1366447016653361192#1: "I think it would be considered blocked even against an empty column."
- RAQ 1540678747953569832#1: "Initiative (IT) player put all of his effects on the stack first, then non-Initiative (NIT) player puts his."

**Resolution:** Pack gap, not a rules conflict. Rules 608.4d, 608.7a and 608.9b cite these claims, read from the extract. pack.mjs should add them to U12.

### D-U12-3 · Sources disagree · rule 608.2a

The 2023 Rulebook names 'Ranged' as the attribute that deals combat damage first (and blocks fliers); the Manual and the card pool use Swift.

- Rulebook 2023 p.12: "Similarly, Spike has the “Ranged” attribute,"
- Manual p.25: "Dune Drifter has the “Swift” attribute, which allows it to"

**Resolution:** Follow the Manual (the later printing) and the card pool: Swift. 'Ranged' is an obsolete name; its flier-blocking half is outside this section.

### D-U12-4 · Sources disagree · rule 608.4d

The printed books set defending formations in the block step; the designer (hedged) and R322 let a unit put in front of an unblocked column after blocks make it blocked.

- Rulebook 2023 p.10: "the attack step and defensive formations are set during the block step."
- RAQ 1366447016653361192#1: "I think it would be considered blocked even against an empty column."

**Resolution:** Follow the designer (608.4, 608.4d) at medium confidence: the answer is hedged ('I think'). The printed text describes the block step and does not forbid a later block.

### D-U12-6 · Other · rule 608.5c

Manual p.42 says a unit with negative power 'deals 0 damage'; combat damage is the column's 'combined power'. The words allow two readings for a negative unit in a column.

- Manual p.42: "A: It deals 0 damage."
- Manual p.23: "formation deals damage equal to the combined power"

**Resolution:** Reading (1): the unit counts as 0 in its column's total (the document, and what the pilot verifier measured: Lithoghul 4 beside a -2/3 dealt 4). Reading (2): the unit itself deals nothing, but its negative power still lowers the column's combined power. Question for the owner only if a judge's CR takes reading (2).

### D-U12-8 · Other · rule 608.5b

Sources are silent on additive modifiers to combat damage: the additive-before-Powerful order is ruled for noncombat damage only.

- R316: "When a source would deal noncombat damage, additive modifiers (Conduit of Pain's"

**Resolution:** The document says nothing about additive modifiers to combat damage. Question for the owner only if a card that adds to combat damage is printed.

### D-U14-1 · Sources disagree · rule 703.3b

The Rulebook 2023 gives the combat damage step a priority window. The Manual lists only the attack, block and after combat steps, and the designer says the damage step has windows only between its sub-steps, when Swift or Sluggish units are present.

- Rulebook 2023 p.13: "block, damage and after combat steps all have a priority"
- Manual p.30: "followed by a priority window inside of each region:"
- RAQ 1363298910528864318#0: "Those windows are only present if there are any Swift/Sluggish units"

**Resolution:** Follow the designer (authority order). The rule states the Manual's three steps plus the sub-step windows of a split damage step; the Rulebook 2023 wording is recorded here.

### D-U14-8 · Sources disagree · rule 703.3a

For a region with three players, the Manual p.36 says the player closest to the initiative player clockwise gains priority first. The Manual p.30 says the initiative player receives priority first, and the nearest player clockwise only when the initiative player is absent.

- Manual p.36: "of back and forth. The player closest to the initiative"
- Manual p.36: "player in a clockwise direction gains priority first and"
- Manual p.30: "Within a priority window, first the initiative player will receive"

**Resolution:** The rule follows p.30, which addresses the order directly. Question for the owner only if a three-player region is ever supported: p.36 can be read as the initiative player first (being closest to themselves) or as the next player clockwise first. The engine is two-player only (R197 §3).

### D-U14-9 · Other · rule 703.1

Sources silent on whether each region has its own stack. The Manual places priority windows inside each region and lets the other players in the region respond; R250 notes that the engine keeps one stack for the whole game.

- Manual p.30: "followed by a priority window inside of each region:"
- R250: "The STACK is not regional and is deliberately left global; narrowing"

**Resolution:** No rule states either way. In two-player play only one battle region is open at a time, so it rarely matters. Recorded, not resolved.
