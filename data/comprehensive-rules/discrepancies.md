# Algomancy Comprehensive Rules: Discrepancy Report

Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision, and owner-questions.md lists it on its own; every other item already says which source decides and which side the document follows. An item filed by more than one drafting unit is kept once, and names the others under "Also filed as".

## 1. Questions for the owner (15)

### D-U02-2 · Engine only · rule 105.4c

Whether a dormant (face-down) resource counts toward affinity. The engine says no. The designer says affinity counts the resources "somewhere in your manabase", tapped or not, and says nothing of face-down ones.

- RAQ 1358299200953126963#0: "The affinity dots just require you have at least that many resources of that type somewhere in your manabase"
- Manual p.12: "Resource types needed to be present among your resources"
- R151: "counts what is **awake** ("dormant gives no affinity"; "expended still counts")."

**Question:** Does a dormant (face-down) resource count toward affinity?

- **Reading A.** Yes: every resource you have counts, face-down ones included ("somewhere in your manabase"). *At the table:* A resource created this turn counts toward affinity before it is activated, so a player may meet [r][r][r] with one active and two dormant fire resources.
- **Reading B.** No: only resources whose type is showing (active) count. *At the table:* As today: a dormant resource gives nothing until it is activated.

**The document today:** B, the engine's behaviour (basis engine, low confidence). R151 only quotes the engine.

**Recommended:** A. Caleb puts no condition on the resource ("You don't care if it's tapped or not"), and A is the permissive reading. Take B only if a face-down resource's type is meant to be unknown at the table.

**Resolution:** Question for the owner. The rule states the engine, basis engine, low confidence; R151 is a presentation ruling that quotes the engine, not a rules decision.

### D-U03-13 · Other · rule 110.11

The designer says a graft onto Mohruung makes "he will trigger first". A graft in deployment is not put on the stack, so R53's "above the spell that targeted" does not order it. The engine queues the trigger first but attaches the graft before the trigger resolves (round-2 probe: the graft line precedes the Crystal line in the log).

*Also filed as D-U03-14 (rule 110.11), D-U17-13 (rule 722.3c).*

- RAQ 1355115946032889914#4: "Applying Graft is 'targeting' effect, so if you try to Graft something underneath the Mohruung, he will trigger first"
- R53: "the stack **above** the spell that targeted — the trigger resolves first."
- file: client/engine/src/apply.ts: "e.fireEvent('targeted', ev);   // grafting is targeting (Graft 101 §5)"
- card: Mohruung: "When I become targeted, [Switch1] Create a Crystal 2."

**Question:** When a graft (or a deployment augment) is applied to Mohruung, is the Crystal made before the mod attaches?

- **Reading A.** Yes: "he will trigger first" means the trigger resolves before the graft is applied. *At the table:* The Crystal exists before the graft attaches, so a graft that counts or reads units sees it; engine change, CT-242.
- **Reading B.** No: the trigger only fires first; the graft attaches, then the Crystal is made. *At the table:* As today; CT-242 closes as not a bug.

**The document today:** A (rule 110.11); the engine does B.

**Recommended:** A. A graft has no stack item, so "trigger first" says something only if the trigger resolves first. Apply the same answer to an augment applied in deployment (D-U03-14).

**Resolution:** Question for the owner. The rule states reading A; the engine attaches the graft before the trigger resolves: F-U03-5 (CT-242). Under B the rule's last sentence becomes "triggers when the graft is applied" and F-U03-5 (CT-242) closes. Merged here: the same order for an augment applied in deployment (D-U03-14), and whether the graft being applied joins Mohruung's triggered composite (D-U17-13: the engine fixes the composite before the graft attaches, which fits both readings).

### D-U06-1 · Sources disagree · rule 304.2

Both printed rulebooks call tokens "temporary cards", and Void Mandible prints "nontoken card", which only makes sense if a token can be a card. The owner ruled that a token is not a card (R129, R133) and confirmed it in R306.

*Also filed as D-U03-1 (rule 108.2a), D-U14-7 (rule 701.1c).*

- Manual p.15: "Tokens are temporary cards that are created directly"
- Rulebook 2023 p.4: "Tokens are temporary cards that are created directly into play"
- card: Void Mandible: "When a nontoken card is played during battle, sacrifice me."
- R133: "Tokens are NOT cards, however."
- R306: "Tokens are specifically not considered cards in terms of specific semantics"
- R129: "Everything is a card, including units. Tokens are NOT cards, however."
- R133: "> "I think Void Mandible is just trying to save space (card < unit or spell)."
- Rulebook 2023 p.4: "only cards currently that are “cast” from play, which functions the same way as if they were cast from your hand, but you may"
- R305: "**A token is still not a CARD.**"

**Question:** Is a token a card, so that card text saying "card" reaches tokens?

- **Reading A.** Yes: "temporary cards" uses the rules word, and Void Mandible's "nontoken card" is a real qualifier. *At the table:* Arbiter of Armistice ("Cards played during battle") and Vengeance tax a spell token cast; a token counts for "card" text; R133, R305 and R306's noun table are reversed.
- **Reading B.** No: "temporary cards" describes the physical token pieces, and the rules word "card" means a card with an Algomancy back (R306). *At the table:* As today: "card" text ignores tokens, and Void Mandible's "nontoken" is shorthand.

**The document today:** B (R129, R133, R305, R306).

**Recommended:** A, on the literal steer: both rulebooks say "temporary cards" and Void Mandible prints "nontoken card". Keep B only if the owner wants R306's noun table to stand as a deliberate reading.

**Resolution:** Question for the owner. The rules state the owner's ruling, basis owner. Printed text outranks an R-ruling, so they stand only if reading B is right. Under A, rule 300.5d and R305's noun table change, and the split over tokens on the erased pile (D-U07-5) resolves.

### D-U06-9 · Other · rule 305.6

Sources do not say whether a Virus may be applied during battle to a spell token standing in play. R89 left it for the owner to rule. A player's remark implies it can be.

*Also filed as D-U17-4 (rule 721.4a).*

- R89: "- **Augmenting a token ENTITY during BATTLE.** `_passer`'s "not without help of"
- R89: "> "But since Bubb is not a virus, you couldn't mod Fireball **during combat**"
- R89: "and response-window design. Left alone deliberately; **Bena to rule** whether"
- R89: "it is worth the second path."
- Manual p.34: "Viruses have the extra ability to mod units directly from your hand during combat in addition to being playable and augmentable normally during the deployment phase."
- R89: ""It's very similar to how regular viruses work. So you can hit enemy spells,"

**Question:** In battle, may a Virus be augmented onto a spell token standing in play (not one being cast)?

- **Reading A.** Yes: a spell token is a spell, and a Virus may "hit enemy spells" in battle (Caleb), so a token in play is a legal battle host. *At the table:* A Virus, or a Rook-enabled augment, can give a Fireball token standing on the board Deadly or Powerful mid-battle; the engine needs the second path R89 describes.
- **Reading B.** No: in battle a Virus reaches units in the region (the Manual's "mod units") and spells on the stack only. *At the table:* As today.

**The document today:** Neither: no rule is written. The engine does B.

**Recommended:** A, the permissive reading. R89 already reads {Virus} as buying the timing, not the host.

**Resolution:** Question for the owner. No rule states either reading: R89 leaves it as "Bena to rule" and names the engine work reading A needs. The _passer remark R89 quotes ("not without help of Rook") is from #rules-questions, not a [Solved] write-up.

### D-U09-4 · RAQ open · rule 505.3f

If Temporal Rift ends round 1 before blocks, can the non-initiative player still attack in round 2? The RAQ thread is open, and Caleb said he was "still working on the ruling". Today the engine ends the battle phase: no counterattack and no round 2.

*Also filed as D-U13-1 (rule 610.4).*

- RAQ 1353986897902567424#0: "calebgannon (2025-03-30): "Yeah I'm still working on the ruling""
- RAQ 1353986897902567424#1: "Should allow for 2nd Battle to happen if it was cast AFTER blocker/counter-attack"
- Manual p.20: "The NIT can still declare attacks even if the IT decides not to attack."
- card: Temporal Rift: "End this battle. Erase this spell."
- R12: "effect (Temporal Rift) affects only that region's battle and stack — other regions resolve"

**Question:** Does Temporal Rift's "End this battle" also cancel the second battle round (the counterattack)?

- **Reading A.** No: it ends the current battle round in this region; the second round still happens, and cast before blocks the non-initiative player may still attack in round 2, as when the initiative player declines (Manual p.20 note). *At the table:* Engine change: a Rift no longer denies the counterattack.
- **Reading B.** Yes: it ends the region's whole battle phase, so there is no second round. *At the table:* As today.

**The document today:** Neither: no rule is written, because the RAQ thread is open and Caleb said he was "still working on the ruling". The engine does B.

**Recommended:** A: the thread itself calls the second round a "2nd Battle", _passer lists it as the consideration for a cast after blocks, and it is the permissive reading. Revisit if Caleb rules.

**Resolution:** Question for the owner, because the designer has not ruled: the RAQ thread is open ([Considered]). No rule states either reading. Revisit if Caleb rules.

### D-U12-11 · Other · rule 608.3d

A half-column that gains Sluggish during the step when no Sluggish sub-step was scheduled: the designer says it strikes in the Sluggish sub-step and that the presence of Sluggish opens a new stack before the next damage step; R295 fixes the schedule when the step begins, so no window opens before that strike.

- RAQ 1363298910528864318#2: "It's still possible to give this column Sluggish attribute and it will deal damage during sluggish-combat-damage (for effective doublestrike)"
- RAQ 1540678747953569832#2: "presence of Swift or/and Sluggish opens new stacks which must be resolved before you move to next combat damage step (swift->normal->sluggish)"
- R295: "when the damage step opens, and never recomputed. A Swift unit dying in the Swift"

**Question:** If a column gains Sluggish during the damage step, does a priority window open before its Sluggish strike?

- **Reading A.** Yes: Sluggish is present when the strike happens, so it opens a stack after the normal sub-step. *At the table:* Triggers from normal damage resolve in that window, before the Sluggish strike; engine change.
- **Reading B.** No: presence is judged when the step begins (R295); the column still strikes in the Sluggish sub-step, but no window opens before it. *At the table:* As today: normal-damage triggers wait until after combat.

**The document today:** B (R295).

**Recommended:** A: the designer says the presence of Sluggish opens the stacks, and the gained Sluggish is present when it strikes; it is also the permissive reading.

**Resolution:** Question for the owner. The RAQ example that covers the gain had a Sluggish column already scheduled, so it does not decide this. The document states R295.

### D-U12-12 · Other · rule 608.2d

Pure in combat is defined per attacking-half/blocking-half pair; an unblocked column holding a Pure unit has no pair, and no source says whether its own attributes (Swift, Powerful, Thieving) apply to its damage to the player.

- card: Just a Unit: "Pure cards and cards they are interacting with ignore all other attributes."
- R61: "Combat is where attributes live, and combat already resolves per"

**Question:** Does a Pure unit in an unblocked column keep its own other attributes (Swift, Powerful, Thieving) when it strikes the player?

- **Reading A.** No: "Pure cards … ignore all other attributes" has no condition on the Pure card itself. *At the table:* An unblocked Pure column strikes in the normal sub-step and does not double or draw.
- **Reading B.** Yes: Pure works only within an interaction with another card, and a player is not a card. *At the table:* An unblocked Pure Swift column strikes first, a Powerful one doubles.

**The document today:** Neither for this case: rule 802.1n is worded per interaction, which leans to B.

**Recommended:** A, on the literal grammar of the reminder. B is the more permissive reading, so choose it if Pure is meant to matter only between cards.

**Resolution:** Question for the owner. Pure in combat is defined per pair of an attacking half and a blocking half (rule 608.2d); an unblocked column has no pair, and no source speaks to it.

### D-U13-4 · Sources disagree · rule 610.4e

The printed round-2 procedure reads as if the sent counterattackers are always put into formation; R194 and the engine's test let the non-initiative player decline the round-2 attack after sending units.

- Manual p.20: "1. The NIT puts their attacking units into formation."
- Rulebook 2023 p.5: "▪ Second, the counterattacking units are put"
- R194: "* So a round-2 decline is the whole difference between a live Fireball and"
- file: client/engine/test/32-cast-costs.test.ts: "// time and attacking with it in round 2 are two actions with a whole damage"

**Question:** After sending counterattackers, may the non-initiative player decline to attack with them in round 2?

- **Reading A.** Yes: round 2's attack step is optional like any attack step; sending moves the units, and attacking is a second choice. *At the table:* As today (document and engine).
- **Reading B.** No: sending them commits them, and "The NIT puts their attacking units into formation" is mandatory. *At the table:* A sent unit always attacks; the round-2 decline goes.

**The document today:** A (R194 and the engine).

**Recommended:** A, the permissive reading. Under A the player may also attack with only some of the sent units, which no source addresses.

**Resolution:** Question for the owner. The rule follows reading A, which the engine plays (32-cast-costs.test.ts). A related point no source addresses: whether the non-initiative player may attack with only some of the sent units.

### D-U14-11 · Other · rule 701.1e

R26 says Bloomcaster's trigger fires on its own play and dates itself to the 2026-07-16 engine. The current engine hears plays only from cards in play, and a played card is on the stack, not in play, when its play fires; the designer write-up describes that state for Mycelial Mentor. The engine now makes no 1/1 for Bloomcaster's own play (F-U14-5 (CT-254)).

- R26: "Bloomcaster's "[Augment] Whenever you play a unit" (no "another") **fires on its own"
- RAQ 1353862592661164152#0: "He goes on the stack (but is not Spawned / In play yet)"
- card: Bloomcaster: "Whenever you play a unit"

**Question:** Does Bloomcaster's "Whenever you play a unit" trigger on its own play?

- **Reading A.** Yes: it prints no "another", so its own play counts (R26). *At the table:* Playing Bloomcaster makes a 1/1; engine change, CT-254.
- **Reading B.** No: a card's abilities work only once it is in play, and a card being played is on the stack (the Mycelial Mentor write-up), so only units played while Bloomcaster is in play count. *At the table:* As today; CT-254 closes as not a bug.

**The document today:** A (R26), marked engine-differs.

**Recommended:** A: the literal text, the pool's use of "another" for not-me (R265) and the permissive steer all point there; the Mentor write-up answers a different question.

**Resolution:** Question for the owner. The rule states R26 (the current ruling) and is marked engine-differs, F-U14-5 (CT-254). The RAQ write-up on Mycelial Mentor answers whether a card waiting on the stack sees a token made meanwhile; it does not say a card's play-trigger cannot hear its own play, so it does not decide this.

### D-U16-1 · Sources disagree · rule 709.4b

The Manual Q&A on Tough and Balanced gives opposite orders for a Tough mod on a Balanced unit. Its first sentence says Tough "augmented onto" a Balanced unit is doubled, then balanced; its last sentence says Tough "applied to" a Balanced unit is balanced, then doubled. R19 says the order between printed, mod-given and column-shared attributes is the engine's own call, and the engine balances first.

*Also filed as D-U19-1 (rule 802.1m).*

- Manual p.42: "“Tough” is augmented onto a “Balanced” unit, or if a"
- Manual p.42: "will have its defense doubled, then its stats balanced."
- Manual p.42: "If “Tough” is applied to a “Balanced” unit, it will have"
- Manual p.42: "its stats balanced, then its defense doubled."
- Manual p.42: "A: Attributes apply in order from top to bottom. So if"
- R19: "attrs in type-line order, then augment-granted attrs in mod-stack order, then"
- R19: "⚠ Engine call: the Manual doesn't specify an order for printed-vs-granted-vs-shared;"

**Question:** A Balanced unit gets Tough from an augment: is it doubled, then balanced, or balanced, then doubled?

- **Reading A.** Doubled, then balanced: the Manual's first sentence names this exact case ("augmented onto"); its last sentence ("applied to") is a different grant, such as an effect. *At the table:* Child of Aether with Rampart Guardian is a 2/2; engine change, CT-257.
- **Reading B.** The Manual's two sentences describe the same case and contradict each other, so the engine's order (R19: printed attributes first) stands: balanced, then doubled. *At the table:* As today: the same unit is a 2/4.

**The document today:** Split: rule 802.1m states A; rule 709.4b states both and the engine's order.

**Recommended:** A: the Manual names the case, and printed text is read literally.

**Resolution:** Question for the owner. rule 802.1m states reading A, the Manual's first sentence, and files the engine's order as F-U19-5 (CT-257); rule 709.4b states both sentences and the engine's order, F-U16-4 (CT-257). Whichever reading the owner takes, the two rules are redrafted to state it alone.

### D-U18-4 · RAQ open · rule 801.12c

Do abilities triggered by one rockfall resolve before the next rockfall of the same effect? The designer's write-up said they do, when Meteor Shower made three copies of itself. The card now prints one spell ("Rockfall 3 three times"), the RAQ register marks the claim outdated, and the engine lets the triggers wait until the whole spell has resolved.

- RAQ 1353899470156206152#2: "any check for triggers will happen in-between resolving each Rockfall 3"
- card: Meteor Shower: "Rockfall 3 three times."
- RAQ 1353899470156206152#4: "They resolve one by one and you always must choose alive unit (or none if you don't have any in that Region)."
- R80: "three batches for the same reason."

**Question:** Do abilities triggered by one rockfall resolve before the next rockfall of the same Meteor Shower?

- **Reading A.** Yes: "any check for triggers will happen in-between resolving each Rockfall 3" is a statement about rockfalls in general. *At the table:* A Mirage Scuttler chosen three times grows between hits; engine change.
- **Reading B.** No: it described three separate copies, which the card no longer makes; as one spell, triggers wait until it finishes. *At the table:* As today.

**The document today:** Neither: rule 801.12c says nothing; the engine does B.

**Recommended:** A: the designer's words describe the mechanic, not the copies, and A is the permissive reading.

**Resolution:** Question for the owner; the RAQ register's own note already asks it. The card now prints one spell ("Rockfall 3 three times"), the register marks the claim outdated, and "They resolve one by one" (claim #4) fits either reading.

### D-U18-9 · Other · rule 801.5

Is a deleted unit a unit that dies? The Manual names the two side by side. No source says a deletion is a death; the engine treats it as one (it fires the death event, so "When I die" and "whenever a unit dies" see it).

- Manual p.13: "a unit dies or is deleted, it is placed in the bin (discard"
- R70: "| `verb` | `dies` / `is deleted` / `is sacrificed` |"
- card: Unstable Singularity: "When I die, [Switch1] Delete target unit."

**Question:** Is a deleted unit a unit that dies, so that "When I die" and "whenever a unit dies" trigger?

- **Reading A.** Yes: deletion is one way of dying, named separately because cards say "delete". *At the table:* As today (the engine fires the death event).
- **Reading B.** No: dying and being deleted are two events that end in the same bin. *At the table:* Death triggers ignore a deletion; Unstable Singularity's "When I die" would not fire when it is deleted.

**The document today:** Neither: rule 801.5 states only where the unit goes. The engine does A.

**Recommended:** A, the permissive reading, which the engine already plays.

**Resolution:** Question for the owner. The Manual says a sacrifice causes a unit "to die" and says no such thing of a deletion; nothing else speaks to it.

### D-U19-3 · Sources disagree · rule 802.8c

What Inverted inverts from when a base rewrite is in play: R93 (owner, 2026-08-22) inverts from the rewritten base; the owner's later general answer that any difference from printed stats is a stat change, and a _passer post in #rules-questions, invert from the printed stats instead.

- card: Its Dark Bubb: "Invert the stat changes of inverted units. For example, -1/+2 would become +1/-2."
- R93: "(R66) — redefines what base *is*, so it is the thing inverted FROM and is never"
- R93: "> "Inverted looks at Printed base stats, looks what unit is 'currently' and"
- R157: "Literally any change to a unit's stats counts. If they're different from the"
- R93: "Its base stats aren't being inverted. Just the modifications to those stats by counters, stat-altering augments, or attributes."
- R93: "invert the difference""
- R93: ""So if there was 10/15 which base stats were changed to be 4/4 (Formless does"
- R93: "this), it had +1/+1 counter, then: 10/15 → 4/4 → 5/5. If you invert it now it"
- R93: "sees that total diff from original stat is -5/-10, so it traces back to"
- R93: "original stats (10/15) and add inverted values (+5/+10) to 15/25""

**Question:** Does Inverted invert from the printed stats, or from a rewritten base?

- **Reading A.** From the rewritten base: a base rewrite is a new base, not a stat change (R93; spikeydog). *At the table:* A 10/15 made base 4/4 with a +1/+1 counter, Inverted, is a 3/3.
- **Reading B.** From the printed stats: any difference from the printed stats is a stat change (R157 §14; _passer's two posts). *At the table:* The same unit, Inverted, is a 15/25.

**The document today:** A (R93), the owner's ruling of 2026-08-22.

**Recommended:** B, for one definition of a stat change: the owner's later general words (R157 §14) and _passer agree, and Unaware already reads a base rewrite as a change. Keep A only if R93 was meant as a deliberate exception for Inverted.

**Resolution:** Question for the owner. The rule follows R93, which the owner ruled on 2026-08-22 with both worked examples in view (the R93 addendum quotes _passer in full). R157 §14, three days later, defines a stat change generally ("If they're different from the printed stats, they are changed"), and Unaware (rule 802.9) already reads a base rewrite as a stat change under it. The _passer posts are in #rules-questions, not a [Solved] RAQ write-up, so they do not outrank the owner. If the owner chooses B, the engine change is one line in effStats (79-round17-layers.test.ts names it).

### D-U19-5 · Sources disagree · rule 802.2a

Whether a unit without Flying may block a Flying column together with a Flying unit in the same blocking column. The printed reminder names units; the Manual says "the blocking unit"; the Rulebook says "unless the defending player also has flying units"; R248 records that the client "blocks by COLUMN".

- card: Air Plant: "Only flying units can block flying units."
- Manual p.24: "blocked unless the blocking unit has flying."
- Rulebook 2023 p.12: "Flying attribute and the entire column cannot be blocked unless the defending player"
- R248: "blocks by COLUMN and the authored row said so."
- glossary: Flying: "Its column can only be blocked by a column with Flying."

**Question:** May a unit without Flying block a Flying column together with a Flying unit in the same blocking column?

- **Reading A.** Yes: attributes are shared in a column in all situations, so the non-Flying unit has Flying and the column may block. *At the table:* A Flying blocker lets its column-mate join the block.
- **Reading B.** No: every unit that blocks a Flying column must have Flying itself. *At the table:* A non-Flying unit may never stand in a column blocking Flying.

**The document today:** Neither: the rule states only the restriction both readings share. Our glossary row and R248 ("blocks by COLUMN") describe A.

**Recommended:** A: Caleb says column-mates share attributes "in all situations" (R93), and A is the permissive reading.

**Resolution:** Question for the owner. No test plays the shared case and no designer source addresses it: the printed reminder names units, the Manual "the blocking unit", and the Rulebook "the defending player".

### D-U20-2 · Other · rule 802.14a

Sources are silent on WHEN "attacking alone" is judged. If a Sneaky unit attacks with one other unit and that unit is removed in the attack window, it is not said whether the Sneaky unit is then alone when blocks are declared.

- file: client/ui/scan-reminders.json: ""text": "Sneaky units can't be blocked if attacking alone.", "card": "Whispering Mantid""
- R20: "A Sneaky column cannot be blocked iff its unit is **the only attacking unit in the"

**Question:** Is a Sneaky unit "attacking alone" judged when attacks are declared, or when blocks are declared?

- **Reading A.** When blocks are declared: if its fellow attackers are gone by then, it is alone and cannot be blocked. *At the table:* Removing a co-attacker in the attack window makes the Sneaky unit unblockable.
- **Reading B.** When attacks are declared: only a unit declared as the only attacker is alone. *At the table:* It stays blockable once declared with company.

**The document today:** Neither: the rule states R20 only.

**Recommended:** A: "can't be blocked" applies at the block, so "attacking alone" is read then; it is also the permissive reading.

**Resolution:** Question for the owner. R20 says what "alone" means (the only attacking unit in the formation; spell tokens do not count) but not when it is judged.

## 2. Register and test fixes (50)

### D-U01-10 · Other · rule 102.4

The RAQ register's paraphrase of claim 1372468222158180424#8 says the mods go to "their owner's bin". _passer's words say "your bin/discard", and under R250/R262 a card leaving play goes to its controller's zone.

- RAQ 1372468222158180424#8: "Mods attached to it after it resolved go to their owner's bin when it is recalled."
- RAQ 1372468222158180424#8: "Those would go to your bin/discard as usual."
- R250 (its §4, zones follow control): "| which zone does it go to? | its CONTROLLER's |"

**Resolution:** In the thread's case (you attached the mods to your own BoFy) owner and controller are the same player, so nothing conflicts. Reword the register claim to "go to the bin as usual" or "their controller's bin", so the paraphrase does not assert the owner rule that R250 reversed.

### D-U01-12 · Sources disagree · rule 101.6

The Manual and Caleb say every effect is region-specific and never impacts anything in another region. R265 says the stack, bins and cache have no region, so Frosted Denial, Woodland Warding and Molten Riftbreaker reach across regions.

*Also filed as D-U10-5 (rule 601.2a), D-U14-9 (rule 703.1).*

- Manual p.19: "place in, meaning it will never impact anything in any"
- RAQ 1454169054402314362#0: "Yes everything in the game is region specific. Just add 'in this region' to every card if it helps."
- R265: "Three zones have no region and are deliberately global — the **stack**"
- Manual p.19: "Additionally, if a player enters a region, their bin, hand,"
- R12: "effect (Temporal Rift) affects only that region's battle and stack — other regions resolve"
- Manual p.19: "Every single effect is specific to the region it takes"
- Manual p.30: "followed by a priority window inside of each region:"
- R250: "The STACK is not regional and is deliberately left global; narrowing"

**Resolution:** Settled by the authority order: Manual p.19 and Caleb ("everything in the game is region specific") outrank R265 and R250, so rule 101.6 states them, and the client's regionless stack, bins and cache are an engine divergence, F-U01-2 (CT-234, filed as an owner decision on whether to change the engine). Document fix: done 2026-10-10. rule 601.2a stated R265's premise (the stack, the bins and the cache are in no region); it now states the regional rule for the stack, bins, hands and caches and is marked engine-differs (F-U01-2). In two-player play the difference is small: battle resolves one region at a time (Manual p.21) and each seat has its own deployment stack (R286), so the one stack only ever holds one region's items. Register fix: mark the "deliberately global" sentences of R250 and R265 as outranked by Manual p.19.

### D-U02-8 · Sources disagree · rule 106.8d

Whether a Prismite can be exchanged into a Shard. The card says "a non-prismite resource" and the Manual "other resources"; a Shard is a resource. R299 says an exchange names an element, and the engine and test 308 refuse a Shard.

- R132: ""Erase me: Create a non-prismite resource, **then activate it**. Do this only"
- Manual p.18: "exchanged for other resources, meaning players essentially get to pick their two"
- R299: "Exchanging a Prismite *into* a Prismite stays illegal — an exchange names an element."

**Resolution:** Printed text, read literally, outranks R299, and the permissive reading is taken: the rule allows a Shard. The engine refuses it: F-U02-3 (CT-237). A Shard is never better than an element resource, so the fix is low priority. Question for the owner only if R299's "an exchange names an element" was a deliberate ruling on Shards rather than the reason a Prismite cannot become a Prismite.

### D-U03-11 · Register chain wrong · rule 109.8a

R63, presented as current, says granted text is silenced by R62 exactly like printed text. R328 reversed R62's veto: an ability gained after the strip is not removed. The register marks R62 reversed by R328 but does not mark R63 amended.

- R63: "Granted text is silenced by R62 exactly like printed text — it is an ability the"
- R328: "stripping applies**. Anything the unit gains **afterwards** — a mod attached, an"

**Resolution:** Mark R63's silencing sentence amended by R328 (only granted text that predates the strip is silenced). The rule follows R328.

### D-U03-3 · Register chain wrong · rule 110.8

R88 and R144 still say that a target restriction is asked when targets are chosen and never asked again at resolution. R324 (later) judges every target again against its restriction as the effect begins to resolve. The register marks R64 and R256 as amended by R324, but not R88 or R144.

*Also filed as D-U14-4 (rule 704.5).*

- R88: "cast and is never re-asked (R5/R56), so the world may legally stop satisfying"
- R144: "re-asked at resolution**, and a card that needs it re-checked does so in its"
- R324: "When an item begins to resolve, every target it declared is judged again by the"

**Resolution:** R324 is later and designer-backed; the rule follows it. The register should mark R88's sentence, and the census sentence in R144, as amended by R324, as it already does for R64 and R256.

### D-U03-4 · Register chain wrong · rule 109.3d

R161 §16, presented as current, says the engine still makes ONE trigger that creates two tokens for two targeted allies, and that the engine change was not made. Test 136 asserts two separate triggers on the stack. R184 credits the fix (the 'targeted' event's seat and kind) to "R163", and digital-rules.md has no R163.

- R161: "left.** The owner says two *triggers*; this is one trigger creating two tokens."
- R184: "dispatched, carrying `formation` plus R163's `seat` + `kind`."
- file: client/engine/test/136-triggers-and-modes.test.ts: "test('R157 §16: two targeted allies are TWO TRIGGERS on the stack, not one that makes two', () => {"

**Resolution:** The rule follows R157 §16 (two targets, two triggers), which the test now asserts. The register should mark R161 §16's approximation paragraph as closed by whichever ruling closed it, and either restore R163 or correct R184's citation of it.

### D-U04-2 · Sources disagree · rule 111.8

Eldritch Dreamtender, Cthyrian Rector and Void Mandible print "sacrifice me. If you do, …" as effect text, with no bracket. R73 reads the sacrifice as a cost paid as the ability goes on the stack, and says so.

- card: Eldritch Dreamtender: "sacrifice me. If you do, look at that player's hand and discard a card from it."
- R73: "`[cost]`; the ruling reads it as a cost anyway."
- R73: "printed prose as a bracketed cost.**"
- card: Void Mandible: "sacrifice me. If you do, negate that effect. {i}(This is not optional.)"

**Resolution:** Settled by printed text, read literally: Eldritch Dreamtender, Cthyrian Rector and Void Mandible print "sacrifice me. If you do, …" as effect text after a "When …" trigger condition, with no cost brackets, so the sacrifice is a step of the effect, carried out as the ability resolves; a player may respond while the unit is still in play, and if it has gone by then, "If you do" fails. The sacrifice stays mandatory (no "may"; Void Mandible prints "(This is not optional.)"). R73 reads the prose as a bracketed cost on the owner's understanding that the unit "needs to be sacrificed for its ability to go on the stack", and says itself that the card has no brackets; print outranks it. Maelstrom Charger ("As you play a nonunit spell, you may sacrifice me") is a different shape, settled by its own RAQ write-up. Document fix: done 2026-10-10 (rule 111.8 states print, marked engine-differs). The engine pays the sacrifice as the ability is stacked: F-U04-5. Register fix: mark R73 as outranked by the printed text.

### D-U04-3 · Sources disagree · rule 111.10k

R119 quotes Deferral Drone as "The next card you play this turn" and clears the charge at the start of each turn. The printed card says "this phase", and a test in 45-hybrids-ld-b shows the charge ending at a phase boundary within one turn.

- card: Deferral Drone: "The next card you play this phase costs [3] less."
- R119: "turn costs [3] less."*"
- R119: "| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |"

**Resolution:** Printed text wins (authority order): the rule says the charge lasts until the phase ends. R119's quotation of the card and its "clear" row should be marked corrected in the register (see F-U04-1 (CT-235)).

### D-U04-4 · Sources disagree · rule 111.10e

R122 says an Ambush sits outside the play-tax layer and that widening it is a future decision. R129 counts an Ambush as a card played, and Arbiter of Armistice and Vengeance tax "cards" played during battle.

- R122: "printed cost line and today sits outside the R59/R60/R122 play-tax layer"
- R129: "'cardPlayed': a {Battle} unit and an Ambush are cards being played"
- card: Arbiter of Armistice: "Cards played during battle gain [Pay 2 life]."

**Resolution:** The printed noun "Cards" read literally, with R129, puts an Ambush play under the imposed cost, so the rule says so with an engine-differs marker (F-U04-2 (CT-243)). Question for the owner only if R122's deferral was meant as a ruling that an Ambush is exempt.

### D-U04-8 · Register chain wrong · rule 111.8

R73 is presented as current, but its ⚠ paragraph on timing says a Dreamtender's combat-damage trigger resolves immediately inside the damage step. R261 moved combat-damage triggers onto the stack after combat, and R295 made a split step resolve them at the sub-step boundary, with priority.

*Also filed as D-U15-6 (rule 706.3b).*

- R73: "and R3/R31 resolve it immediately, so a Dreamtender in a Swift column is gone"
- R261: "**[R117] / [R157] §5 keep their gate and lose their ordering claim.** R117's finding — that"
- R295: "- **R261**: the hold is conditional now. Its unsplit case is untouched."
- R73: "trigger fires off the aggregated combat `lifeLost` event and R3/R31 resolve it"
- R261: "They no longer land before normal damage. They land after combat, with everything else. A"

**Resolution:** Mark R73's ⚠ "WHEN inside combat damage" paragraph as superseded by R261 and R295 in the register. The cost reading R73 rules is not affected. Combat-damage trigger timing is rule 608.

### D-U04-9 · Sources disagree · rule 111.10f

R121 calls Augment and Ambush "alternative ways to PLAY a card". The designer says mods are not played: they are applied.

- R121: "- (R37 family) Augment/Ambush are alternative ways to PLAY a card, not"
- RAQ 1537748882501668934#0: "Mods are not considered 'played'"

**Resolution:** The designer wins. R121's conclusion (applying an augment is not taxed as an ability) is unaffected; its wording about Augment should be corrected in the register.

### D-U05-12 · Other · rule 200.2

R162 and R240 still describe a type-line override table in the extractor (two entries left, Might of the Grove and Arbiter of Armistice). That patch layer was removed on 2026-09-20; the oracle file now carries both corrected lines.

- R240: "overrides remain (Might of the Grove, Arbiter of Armistice), both still wrong upstream,"
- R162: "the rules bot and corpus outside this package. The correction therefore lives"
- file: CLAUDE.md: "There is no patch layer any more (removed 2026-09-20)."
- file: data/cards/AlgomancyCards-OracleText.json: ""type": "{Battle} Tree Druid Spell","

**Resolution:** The rulings stand; their notes on where the correction lives are stale. Register fix: mark those passages historical (commit 3c4cc20 folded the override table into the oracle file).

### D-U05-13 · Other · rule 202.6

R158 says Living Vault still refuses an X-cost card in hand. A current test says Living Vault offers it at pay [0].

- R158 §1: "of the Cosmos' deck, Blurf's deck) and one still refuses (Living Vault's"
- file: client/engine/test/39-light-b.test.ts: "test('Living Vault: an X-cost card in hand is offered at pay [0] (R157 §1)', () => {"

**Resolution:** The test is the later state, and the rule follows R158's principle (0, not refused). Register fix: mark R158's Living Vault sentence as fixed.

### D-U05-6 · Other · rule 206.6a

The register lists four claims from the RAQ counters thread as covered designer claims, but every answer in that thread is a player's (nyarlathotep8457), not the designer's.

*Also filed as D-U15-9 (rule 708.8a).*

- RAQ 1364890301147250798#0: "Counters are seperate, even though we represent them with a single die most of the time."
- RAQ 1364890301147250798#1: "If a unit has both a +1/+1 and -1/-1 counter on it they both get removed"
- Manual p.40: "changes on units. If both a +1/+1 counter and -1/-1 counter are placed on a unit, the two cancel out and will both"

**Resolution:** Other players are not authority. The cancel rule rests on Manual p.40. "Two counters, not one +2/+2" and "Pestilent Mycelion still triggers on the cancelled -1/-1" have no designer or printed source in this pack and are not stated as rules here. Register fix: mark the thread as answered by a player.

### D-U06-10 · Other · rule 304.10

R69 still warns that Caleb once said the opposite (2025-03-09: tokens go to the token pile "instead of sending them to your bin"), and that "this rule and R40's amendment both fall" if that line is the intended one. The [Solved] RAQ write-up has since settled it in R69's favour, so the warning is stale.

- R69: "⚠ **A conflicting ruling, recorded rather than smoothed over.** Caleb"
- RAQ 1355689559609839787#4: "3. Same applies to Unit Tokens being Recalled or Dying (they enter your hand/bin and then are instantly erased)"

**Resolution:** Register fix: mark R69's conflicting-ruling warning as answered by RAQ 1355689559609839787 (point 3). No change to the rule.

### D-U07-10 · Other · rule 400.4

R262 says it knowingly overrules a Manual sentence ("a recall goes to its owner's hand"), but no page of the printed Manual or Rulebook that this project extracts contains that sentence.

*Also filed as D-U18-5 (rule 801.7a).*

- R262: "**1. The Manual's recall sentence is overruled, knowingly.** The Manual says a"
- R262: "recall goes to its *owner's* hand, and a stolen unit recalled now bounces into"
- card: Cosmic Reversal: "(Negate them and put them into their controller's hands.)"
- card: Tidal Reversion: "(Return it to their hand.)"

**Resolution:** The rule states R262. Find the sentence R262 means, or correct R262's attribution. Question for the owner only if the judge's CR quotes such a printed sentence.

### D-U07-3 · Sources disagree · rule 405.5

Does a dying {Unstable} card enter the bin (and get trashed) before it is erased? The printed reminder and Caleb say it is erased in place of entering the bin. R137 (owner) says it enters the bin, is trashed there, and is then erased, and the engine does that.

*Also filed as D-U18-1 (rule 801.2h), D-U07-16 (rule 410.4d).*

- card: Abyssal Evocation: "(If they would enter a bin, erase them instead.)"
- R145: ""Unstable": "If an unstable card would enter a bin from an active"
- R137 (its body-trash ruling and its Rector and Distiller notes): "Unstable units still die, they just get erased instead of ending up in the"
- R137 (its body-trash ruling and its Rector and Distiller notes): "**An Unstable card that dies enters a bin, is trashed there, and is only then"
- R137 (its body-trash ruling): "therefore no trash". That reading is what the engine implemented until today,"
- R244 (its attribution and mod-erase halves): "Trashing means it goes to the BIN. But the unit that died was unstable, so"
- R157 (§3): "It's not a death, but it is a despawn and trashing. Weird corner case."

**Resolution:** Settled by the authority order. The printed reminder ("If they would enter a bin, erase them instead") has one reading: the card never enters the bin, so it is not trashed. Caleb's "erased instead of ending up in the bin" fits it, R137 itself calls it "the plain sense of the text", and the owner's own words in R244 ("it didn't go to the bin") argue it too. Print and designer outrank R137, so rule 405.5 and rule 801.2h state that reading, and the exchange route follows (rule 410.4d says only that the unit and its mods are erased). The engine passes the card through the bin and trashes it: F-U07-6 (CT-246, filed as an owner decision on whether to change the engine). Register fix: mark R137's body-trash ruling, and R146/R152's trash on the exchange route, as outranked by the printed reminder.

### D-U07-4 · Register chain wrong · rule 400.4

R145 sends an {Unstable} card leaving the stack "straight to the owner's public erased pile". The register now says every erased pile follows control (R262, applied by B4 to R156 and R172), but R145's "owner's" is not marked.

- R145: "**From the stack** — straight to the owner's public erased pile (R65)."
- R262: "(a) All four follow control"

**Resolution:** Add a narrowing mark on R145 for the stack route if the owner's "one rule, no seam" reaches it, as the B4 adjudication did for R156 and R172. Question for the owner only if the stack route (a card that never left play) is meant to differ, since R262's four routes are all departures from play.

### D-U07-6 · Register chain wrong · rule 403.5

R206 says an expired glimpse card is still "moddable", and our glossary's Glimpse row still says "still moddable out of the zone at full price". R303 (later) says an expired glimpse is no permission for any verb. R206's clause is not marked superseded.

*Also filed as D-U18-10 (rule 801.9i).*

- R206: "over-broad — an expired glimpse card is still public, targetable and moddable),"
- R303: "expired glimpse, unfulfilled banner, or neither | refused | refused"
- glossary: Glimpse: "still moddable out of the zone at full price"
- R303: "was a mod zone with no door on it. A glimpsed card you failed to play stayed a live graft"
- R45: "makes "inert" mean it: the same permission, and the same "ignoring affinity","
- file: client/ui/glossary.ts: "and still moddable out of the zone at full price."

**Resolution:** R303 is current and is stated (rule 403.5, rule 403.3). Mark R206's Glimpse-row clause as reversed by R303, and fix the glossary row (F-U07-5 (CT-231)).

### D-U08-1 · Sources disagree · rule 501.4

The printed rules have the initiative player take the resource step and the haste step first, then the non-initiative player, who gets to see what the initiative player did. R18 (its standing half) has both players act at once, interleaved in any order, inside a hidden simultaneous segment.

*Also filed as D-U08-11 (rule 500.3), D-U09-1 (rule 507.3a).*

- Rulebook 2023 p.5: "phases, the initiative team must make all of their plays first while the non-intiative gets to wait"
- Manual p.27: "IT FIRST, THEN NIT"
- Manual p.20: "Teams always act together in all situations and phases of"
- R18: "no stack, no responses), players may interleave plays in any order, and a player with no"
- R18: "false: the haste step is a **hidden simultaneous segment** — nobody sees the"
- Rulebook 2023 p.5: "together and are required to act first in all situations. For example, during the mana and main"
- Manual p.20: "plays first, allowing the Non-initiative-Team (NIT) to act"
- Manual p.38: "to the non-initiative team that will all do the same."
- Manual p.42: "treat all other players as if they don’t exist."
- R286: "playing different games during deployment"

**Resolution:** Settled by the authority order: Manual p.27 ("IT FIRST, THEN NIT"), Manual p.38 and Rulebook 2023 p.5 have the initiative side take the resource step, the haste step and deployment first, and the non-initiative side "wait and see". They outrank R18's hidden simultaneous segment, so rule 501.4, rule 500.3 and rule 507.3 state print. The client's simultaneous hidden steps are F-U08-1 (CT-247, filed as an owner decision: keep them as a digital convention in Annex D, or change the engine). rule 507.3a states the client today; if the owner keeps it, it belongs in Annex D. The argument that the order is moot because each player is in a separate region during deployment (Manual p.42) does not make the two the same: under print the non-initiative player chooses after the initiative player has finished.

### D-U08-10 · Other · rule 501.4a

Print syncs every step: no player begins the resource step until every player has finished the draft step. The engine lets a seat that has drafted (or, in constructed, recycled its 2) begin and even finish its resource step while the other seat still drafts. No ruling states the early start.

- Rulebook 2023 p.5: "Turns in Algomancy are global, meaning all players share the same phases, and sync up at the end of each step."
- Manual p.16: "Once all players have passed their pack, the draft step"
- file: client/engine/test/20-draft.test.ts: "// committed seat may proceed simultaneously while the opponent drafts"

**Resolution:** The rule states print; the engine behaviour is F-U08-4 (CT-248). The early start happens inside the hidden plan segment, so the drafting seat cannot see it and the information effect may be nil. Question for the owner only if the early start should be kept as a digital convention (Annex D) rather than fixed.

### D-U08-3 · Sources disagree · rule 504.1

Rulebook 2023 p.7 has a single "mana step" in which players take resources and play haste cards. The Manual splits it into a resource step and a later haste step. R97 equates the printed "mana step" with the haste step alone, but the Prismite card says its exchange may be done "only during the mana step", and R17 and the engine place the exchange in the resource step.

*Also filed as D-U02-6 (rule 106.8a).*

- Rulebook 2023 p.7: "The mana step is when players have the ability to take and play resources, as well as"
- Manual p.18: "After the resource step is the very short haste step, where players can only play"
- R97: "So **the printed "mana step" IS this engine's R18 haste step**, and Dispatch Courier"
- R132: "during the mana step. {i}(This does not use one of your activations for turn.)""
- R17: "exchange: during planning, an **active** (face-up) Prismite may be swapped for a"
- Manual p.18: "The resource step of the planning phase is when players have the ability to create and activate resources. During this step, any resource can be created from"

**Resolution:** Settled by the designer: each card's printed "mana step" is the step that card was written for. Caleb (Discord rules-questions, 2024-03-27, calebgannon) was asked about both cards that print it. Of Dispatch Courier ("shouldn't this say "haste step"") he said "Yes". Of the Prismite he said "That should be mana step" and "Unless I used resource step in the rulebook"; told that the rules say resource step, "good catch". So Courier's mana step is the haste step (R97 is right for it, rule 504.7) and the Prismite's is the resource step (the Manual p.18 paragraph that describes the exchange; rule 106.8a and rule 502.2c). Rulebook 2023 p.7's single "mana step" (resources and haste cards together, as in Caleb's 2023 "you can play haste cards and resources as special actions", R97) is the older name for the two steps the Manual later split. The engine agrees: it refuses an exchange once the player has finished the resource step (413). Register fix (wording only): R97's "the printed mana step IS this engine's haste step" holds for Dispatch Courier, not for every card that prints the words, and R17's "during planning" is wider than the card. The first synthesis of this item read the Prismite's mana step as both steps; it had not seen the 2024-03-27 exchange, which is not a RAQ claim and so cannot be checked mechanically: it is in the rules-questions export.

### D-U09-2 · Register chain wrong · rule 507.5

R38 is presented as current and still says "there is no priority during deployment". R286 later gave each player priority over their own deployment stack. The register marks R250's deployment half as amended by R286, but not R38's identical clause. The engine still gives nobody priority in deployment: a test asserts priority is null there, and R287 records that the deployment stop is not built (CT-185).

- R38: "window as regroup triggers, and because there is no priority during"
- R286: "2. **That stack belongs to one seat**, and so does the priority over it. The"
- R287: "⚠ **THE DEPLOYMENT CLAUSE IS NOT BUILT.** *"Even during deployment, nothing"

**Resolution:** Mark R38's no-priority clause as amended by R286 in the register (the reason why rot cannot be responded to). The rule that rot itself cannot be responded to stands either way, because rot damage never goes on a stack (R50). The engine gap, no priority stop on your own deployment stack, is already CT-185. It is not filed again here.

### D-U10-6 · Other · rule 602.6f

Sources silent on a remembered formation that holds no living unit: a source that attacked alone and died under its own trigger before blocks leaves a line that has closed to nothing. The designer says Hooba-style effects remember the formation and work; R75 says a formation with no living unit cannot be joined; R184 says an emptied formation is still a formation while its battle runs.

- RAQ 1353895783266516992#2: "But there are some which will remember they were in formation and will work fine (Hooba-Bot, Hooba-Pon, Hooba-Lin, Embermaw Fledgling, Lumengrove Lurker)."
- R75: "always grow at an end. A formation you are not standing in cannot be joined at"
- R184: "legal exactly while its battle runs; **emptying it does not remove it**"

**Resolution:** The rule states the designer's answer: the effect places into the formation the source was in, and 602.6k names this as an exception to R75's 'no slots'. The engine places nothing for a lone source that dies before blocks (F-U10-6 (CT-250)). Question for the owner only if a lone source that dies under its own trigger is meant to place nothing, in which case F-U10-6 (CT-250) closes as no-bug and 602.6f gains the qualifier.

### D-U10-7 · Other · rule 603.2

Sources do not say in so many words whether two blockers with an unblocked attacking column between them are neighbours. The rule reads the Manual literally (a column with no blocker is an empty position between them); the engine treats them as neighbours and calls that an approximation.

- Manual p.23: "where attackers aren’t, which can be beneficial for"
- R304: "- **Attacking line only.** A blocking column is keyed to the attacking column it"
- file: client/engine/src/engine.ts: "    // treated as adjacent (⚠ approximation: two blocks on columns 1 and 5 read"

**Resolution:** The rule follows the Manual: where a blocker stands matters for adjacency, and blocking columns are keyed to the attacking columns they face, so an unblocked column is a gap. The engine differs: F-U10-3 (CT-249).

### D-U12-13 · Engine only · rule 608.8c

Caleb's 'replacement effects only apply once in an effect' can be read per damage (the leftover is not replaced again by anything) or per effect (each replacement effect applies once, so another Oorblak or a Blightsea Polyp may take the leftover). The engine takes the per-effect reading.

*Also filed as D-U15-11 (rule 708.4a).*

- RAQ 1397188292239163454#0: "replacement effects only apply once in an effect Unless a new trigger occurs"
- file: client/ledgers/raq.ts: "the other 6 still reach the player, and are not redirected again."
- R104: "Substitutes or redirects the thing itself. A thing can only be replaced once, so"

**Resolution:** Settled by the designer: "replacement effects only apply once in an effect", with the Oorblak example (the leftover 6 "goes to players face"), reads per damage: a leftover one redirect let through is not redirected again. R104 says the same ("A thing can only be replaced once"). rule 608.8c and rule 708.4a state it. The engine offers the leftover to every further holder: F-U12-1 (CT-228).

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

### D-U13-2 · Other · rule 610.4d

R15's heading says it was resolved by the RAQ thread 'Temporal Rift vs NIT sending counter-attack', but that thread is still open ([Considered]), so the claim it relies on is not a ruling. The rule stands anyway, on the Manual's NOTE.

*Also filed as D-U09-5 (rule 505.3e), D-U11-4 (rule 604.4a).*

- RAQ 1353986897902567424#2: "Counter-attacks ARE allowed even if IT players decides to Pass his attack opportunity."
- Manual p.20: "The NIT can still declare attacks even if the IT decides not to attack."
- R15: "## R15 ⚠ — Round-2 attackers when round 1 had no battle (⚠ resolved by RAQ "Temporal Rift vs NIT sending counter-attack")"

**Resolution:** The rule cites the printed NOTE as its authority and R15 for 'any of its units'. Register fix: R15's heading mark should cite the Manual p.20 NOTE rather than an open thread (or say the thread is open).

### D-U13-3 · Register chain wrong · rule 610.4e

R36 ('A lone sent counterattacker auto-forms in round 2') is still presented as current, but the guard test was flipped on 2026-08-24 to assert the opposite: a single sent counterattacker is NOT auto-formed and declining is legal. No ruling records the reversal.

*Also filed as D-U23-17 (rule D1.2c).*

- R36: "that could ride along, the only-unit formation is auto-declared (a forced"
- file: client/engine/test/32-cast-costs.test.ts: "// FLIPPED 2026-08-24 (decisions-for-the-player audit). This test used to"
- file: client/engine/test/32-cast-costs.test.ts: "'one sent counterattacker is still a real choice: attack, or decline');"
- file: client/engine/src/apply.ts: "// There used to be a second branch here: a round-2 counterattack with"

**Resolution:** R36 is a digital convention (Annex D, U23); the game rule here states what the current test asserts. Register fix: mark R36 as reversed and record the 2026-08-24 audit that reversed it: F-U13-1 (CT-251). The Annex D sub-rule D1.2c states R36 with an engine-differs marker (F-U23-4 (CT-251)) and goes when R36 is marked.

### D-U13-6 · Other · rule 610.2c

R270 leaves open, as a question for the owner, whether a unit away counterattacking still counts as an ally in the region it left. The Manual's own words give one reading: it does not.

*Also filed as D-U16-7 (rule 713.7a).*

- R270: "rule on: **does a unit that is out counterattacking still count as an ally in"
- R270: "the region it left?** Under the Manual's "doesn't exist" it does not — but a"
- Manual p.20: "the region and are treated as if they don’t exist until"
- R270: "That is the current answer and `test/250-ally-count-and-absence.test.ts` pins"

**Resolution:** Printed text outranks an owner call and reads one way only, so this is not a question for the owner. The rules (rule 610.2c, rule 713.7a) state the current answer, not counted, which the Manual supports. Register fix: R270's open question can be closed by citing Manual p.20.

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

**Resolution:** Follow the designer for a graft composite (the case the designer answered). Whether the same holds for every triggered ability with a required target is not stated by the designer; R102 and R86 should be marked where they conflict. Filed as F-U14-1 (CT-252).

### D-U14-5 · Register chain wrong · rule 703.5

R198 explains its in-place gate by saying that between combat sub-steps triggers are special actions and nobody gets priority. R261 moved combat-damage triggers to the stack after combat, and R295 opened priority windows at sub-step boundaries of a split damage step. R198 is still classified current with no mark on that sentence.

- R198: "sub-steps triggers are special actions and R3 says nobody gets priority. And"
- R261: "Combat-damage triggers resolve AFTER combat, on the stack, respondable"

**Resolution:** Mark that sentence of R198 as overtaken by R261 and R295. The rule text does not rely on it.

### D-U15-7 · Register chain wrong · rule 706.11

R94 is presented as current, but its "OPEN" section says the engine computes the {Resonant} rider from the undoubled amount and that this was deliberately not changed. R315 later made the rider damage from the source, so {Powerful} doubles it (the RAQ's 2/4 Powerful Resonant deals 8 to the face). R94 carries no partial-supersession mark.

- R94: "### ⚠ OPEN — the RESONANT rider is doubled twice in the RAQ, once in the engine"
- R315: "So everything that prices damage from that source prices the rider: {Powerful}"

**Resolution:** The rule follows R315. Mark R94's "OPEN — the RESONANT rider" section as superseded by R315 in the register.

### D-U16-14 · Sources disagree · rule 712.1a

Whether a unit stripped by a continuous effect (Transmogrifant, Monke) stops applying its own static abilities. Printed text strips all abilities and R62 says a static is an ability; R62 and R328 encode static-vs-static in one pass that reads only the one-time stamp, so such a unit keeps applying its statics. R62 justifies the one pass only by the mutual case.

- card: Transmogrifant: "Your other units gain +2/+2 and lose all attributes and abilities."
- R62: "radiates — a static *is* an ability — and both R38 replacement hooks."
- R62: "*entity flag* is set, not one silenced by another static. So a unit silenced by"
- R62: "a spell stops radiating immediately, while two Monkes — each the other's"
- R328: "**Unchanged:** static-vs-static still resolves in one pass (`staticsFor` reads only"

**Resolution:** Settled by printed text: Transmogrifant's "lose all attributes and abilities" takes every ability, and a static is an ability (R62). R62's one-pass sentence is reasoned only from the mutual case, which rule 712.5 keeps. rule 712.1a states print; the engine keeps a one-sided stripped unit's statics on: F-U16-3 (CT-256).

### D-U18-8 · Other · rule 801.8a

403.3a and R303 name only two permissions that make a cached card usable: a fulfilled prophecy and a live glimpse. Murkdrop Distiller and Big Glimpse Card grant a play of the cards they cache in their own text.

- R303: "may be played only while a prophecy on it is fulfilled or a glimpse stamp is live — and"
- card: Murkdrop Distiller: "you may cache it. If you do, you may play it until end of turn."
- card: Big Glimpse Card: "You may play those cards until end of turn, ignoring affinity."

**Resolution:** rule 801.8a adds "the text of the effect that cached it" as a third permission, because printed text wins. Widen 403.3a (U07) the same way. Whether such a card-text permission also covers mods (R303's table) is not stated; question for the owner only if a judge's CR rules on it.

### D-U19-2 · Sources disagree · rule 802.1n

Pure's printed reminder ignores "all other attributes"; the rulings keep the stat attributes on in a Pure interaction (R289: Tough, Balanced and Inverted "still read"; R106: the combat Unaware collapse "survives {Pure}") while R289 itself switches Unaware off in a noncombat Pure pairing.

*Also filed as D-U20-13 (rule 802.25e).*

- Manual p.42: "counters, 4. Attributes like Tough, 5. Inverted, 6.Unaware"
- R289: "{Tough}, {Balanced} and {Inverted} still read (they are stat layers, R61)."
- R289: "are off against it, and so are its own {Vulnerable} and {Unaware}."
- R106: "The collapse survives {Pure}: R61 switches the ATTRIBUTE layer off for an exchange, and"
- card: Just a Unit: "(Pure cards and cards they are interacting with ignore all other attributes.)"
- R289: "{Unaware} are all off, against units and against players alike — "its own"

**Resolution:** Settled by printed text, read literally: Pure ignores "all other attributes", and the Manual names Tough as an attribute ("4. Attributes like Tough"), so Tough, Balanced, Inverted and Unaware do not apply in a Pure interaction. R61's "stats are not attributes" is our ruling and does not change what the Manual calls Tough. rule 802.1n states print; the engine keeps the stat attributes on: F-U19-1 (CT-260, filed as an owner decision on whether to change the engine). Document fix: done 2026-10-10. rule 802.25e (which stated R289) and rule 802.25f (which stated R106) contradicted rule 802.1n; both now state print and are marked engine-differs (F-U19-1, F-U19-2). Register fix: mark R289's "still read" sentence and R106's "survives {Pure}" as outranked by the printed reminder.

### D-U19-6 · Register chain wrong · rule 802.9h

R106 is unmarked although its "one open edge" paragraph (targeting is deliberately not implemented) was answered by R281; only R206's Unaware row carries the R281 mark.

- R106: "so targeting is **deliberately not implemented**. "Delete target unit with base power 2 or"
- R281: "*"You can target things with unaware, of course, but if that thing does a stat"

**Resolution:** Follow R281: an Unaware card can be targeted, and stat changes put on it do nothing while it is Unaware. Mark R106's targeting paragraph "(answered by R281)". Still open, and conditional: whether a stat-gated target restriction ("base power 2 or less") reads the printed stats of a non-Unaware target when the effect's source is Unaware. Question for the owner only if a card can put such a restriction on an Unaware source (no printed card does today: Bubb, Trashling and Haboob have no targeted text).

### D-U20-6 · Other · rule 802.19h

The RAQ register's note on the Containment Protocol claim says Resonant never waits on the stack. Since R315 the Resonant trigger does go on the stack, so the note is stale.

- file: client/ledgers/raq.ts: "Resonant never waits on the stack, so there is nothing to negate."
- R315: "the resonant source**, put on the stack as that source's trigger — not life loss"

**Resolution:** Register fix: update the note on RAQ 1366446116274442291#2 to say the Resonant trigger waits on the stack (R315) and would be negated by the engine.

### D-U20-8 · Other · rule 802.17e

Our glossary's Electric row still says the excess is lost when the chain runs out. R317 (from the RAQ) deals it to the last unit.

- glossary: Electric: "When the chain runs out the excess is lost"
- R317: "no {Piercing} is read: it stays on the last unit — dealt, never lost (R114's "ALL"
- RAQ 1372451771632320512#2: "All 12 damage sink into Crumbling - this has its use if you had Ember of Life in play"

**Resolution:** Glossary fix (our text, not authority): the row should say the remainder stays on the last unit, and that with Piercing it is elective. Filed as the register-level finding F-REG-2 (CT-231).

### D-U20-9 · Register chain wrong · rule 802.18b

R166, still current with no supersession mark, says Poisonous "replaces the damage with counters and never reaches the branch". R237 later ruled, on Caleb's words, that Poisonous is a form of dealing damage and not a replacement.

- R166: "{Resonant} drains life, {Poisonous} replaces the damage with counters and never"
- R237: "**{Poisonous} is a MARK, not a substitution.** Everything above the mark —"
- RAQ 1354148437355925554#0: "Poisonous damage is damage dealt: it fires "when I am dealt damage" (Awoken Tomb makes its X/X)."

**Resolution:** Register fix: mark R166's Poisonous sentence as corrected by R237 (a scoped supersession edge). The document follows R237 and the RAQ.

### D-U21-1 · Register chain wrong · rule 803.6e

R22 is classified current, but its sentence on where a recalled ally goes ("base card to its owner's hand, its mods to their owners' bins") was overtaken by R250 §4, "Zones ALWAYS follow control": a card leaving play goes to its controller's zone. The two differ when the ambushed ally is a stolen unit or carries an opponent's mod. R22 carries no mark for this.

- R22: "ambusher to the bin ("you lose both", card ruling). Recall = base card to its **owner's"
- R22: "hand**, its mods to their owners' **bins**, a token target is erased. ⚠ Engine calls:"
- R250 (its §4: zones follow control): "> "**Zones ALWAYS follow control. One rule, no split.** Whoever CONTROLLED the"

**Resolution:** Mark R22's recall sentence as narrowed by R250 in digital-rules.md. The ambush rules cite R22 only for the target, the slot and the fizzle, and leave the destination to the recall rule (rule 801.7a, controller's hand). Question for the owner only if the engine's ambush path still recalls to the owner's hand; the verifier should check.

### D-U23-13 · Register chain wrong · rule D2.4

R236 §5 describes the haste auto-ready's latch (its own hasteAutoAt). R245(b) reports that this client re-sent doneHaste once per arriving state, and replaced the latch with one keyed on the answer being outstanding. supersession.json has no R245 → R236 edge.

- R236: "The one guard that is *not* borrowed: the send is latched on its own"
- R245: "client re-sent `doneHaste` once per arriving state, and the extras came back"

**Resolution:** The rule states R245(b). Proposed register edge: R245 amends R236 (scope: §5's latch).

### D-U23-16 · Engine only · rule D2.9

No ruling says a player cannot keep priority after acting. Test 272 records that casting hands priority to the opponent, and calls it a finding. U14's F-U14-2 (CT-253) suspects this contradicts the Manual's rule that a player who acts may keep priority.

- file: client/ui/test/272-full-control.test.ts: "// the window here: `engine.ts` hands priority to the other seat as soon as"

**Resolution:** The rule states the engine's convention as basis engine and points at 703. If F-U14-2 (CT-253) is upheld (the Manual wins), this Annex D rule is withdrawn rather than kept as a convention.

### D-U23-18 · Register chain wrong · rule D5.5

R150 and R258 still describe a 'catching up (n) — skip' chip as the visible way out of the pacing. The owner removed the chip on 2026-09-28; only the S key skips now, and test 237 asserts the chip is absent. Neither ruling is marked.

- R150: "- **Skip**: a `catching up (n) — ⏭ skip` chip beside the standing-pass chip"
- R258: "- **the ⏭ `catching up (n) — skip` chip.** It is the only *visible* way out of"
- file: client/ui/main.ts: "GONE (the owner, 2026-09-28: "that catching up banner doesn't need to be"
- file: client/engine/test/237-live-while-held.test.ts: "assert.equal(ui.has({ btn: 'paceskip' }), false, 'the owner cut the chip: no skip button');"

**Resolution:** The rules follow the owner's later call: no chip, S skips. Mark the chip halves of R150 and R258 as superseded (2026-09-28) in the register.

### D-U23-6 · Sources disagree · rule D2.4

R245(b) rules that an automatic answer, naming both the haste-step ready and the automatic pass, is latched by being unanswered and never by a state counter. R258, describing the code later, says the automatic pass is latched once per actionCount, and test 70 [59] asserts that a new state number releases the latch.

- R245: "### (b) An automatic answer is latched by the FACT of being unanswered, never"
- R245: "The client sends intents the player did not: the haste-step ready (R236) and"
- R258: "[59]/R245 latch it to one send per `actionCount` (`takeAutoPass` in"
- file: client/ui/test/70-playtest-round15.test.ts: "assert.equal(takeAutoPass(plan, 41, latch), true, 'a new state is a new window');"

**Resolution:** The rule states R245(b), the ruling, with 'engine differs, see F-U23-2 (CT-262)'. Question for the owner only if R245(b) was meant for the haste-step ready alone: its words name both automatics, so the rule reads it as covering both.

### D-U24-5 · Register chain wrong · rule D7.4

R266 still says that nineteen costly announcements remain log-only and that choosing a surface for them is a later product call. R276 made that call (a shared toast tier) and gave them a surface. R266 carries no mark saying so.

*Also filed as D-U24-9 (rule D7.4).*

- R276: "CT-142 asked which log-only announcements deserve a surface and refused to guess,"
- R276: "**shared toast tier** — one notice channel they all use, a brief toast near the"
- R266: "An announcement the player is expected to act on, or to have lost something by, must reach a surface other than the log."
- R266: "Nineteen tier-1 announcements remain log-only. That is a ticket list, not a bug list: which of them deserve a second surface is a product call"

**Resolution:** Mark R266's closing count as answered by R276 in the register ("its log-only count answered by R276"); CT-236 tracks the stale sentence. The rules follow R276 (rule D7.4b). rule D7.4 states R266's standard; its engine-differs marker for F-U24-4 (CT-236) has been dropped, because the toast tier gives every such announcement a surface. D-U24-9 is this item from the rule's side: its count of nineteen against the inventory test's 21 is the same stale sentence.

## 3. Engine-only and owner-only rules (92)

### D-U01-13 · Engine only · rule 103.3a

No source gives the constructed opening hand (rule 103.3b) or says whether the first turn takes the constructed draw phase (rule 103.3a). The client deals 4 and runs the phase on turn 1 (draw 4, put 2 back).

*Also filed as D-U08-5 (rule 503.4b).*

- Rulebook 2023 p.6: "Players draw 2 cards during the draw step on every turn after the first."
- Rulebook 2023 p.6: "the draw phase in constructed, players draw 4 cards, then select 2 cards from their hand and put them on the bottom of the"
- Manual p.16: "their opening hand, in which case they should not draw"
- file: client/engine/src/apply.ts: "// opening hand 4 (like draft); turn 1's draw phase (draw 4, bottom 2)"
- Manual p.16: "the draft step in constructed, players simply draw 2"

**Resolution:** The rule states the engine with basis engine, awaiting owner sign-off (Annex P). It ends where print would if Manual p.16's shortcut were applied to constructed (a 6-card opening hand, then draw 2 and recycle 2): both see 8 cards and keep 6. Question for the owner only if a judge's CR deals constructed differently.

### D-U01-15 · Other · rule 101.5

Sources silent on "do as much as you can" as a general principle. Print says it of a spell that lost some of its targets; Caleb says it of one graft; the only general statement is R30, which the register marks provisional (⚠).

- Manual p.43: "spell will attempt to resolve as best as it can. For"
- RAQ 1353859961855148103#3: "You just can't give Ralph, but that's okay - rest of graft still happens."
- R30: "recall still loses 2. (Do as much as you can; the two clauses are not linked"

**Resolution:** The rule states the general principle at medium confidence: print and Caleb each apply it, and nothing in the sources limits it. Question for the owner only if R30 is to lose its ⚠ or a judge's CR limits the principle to targets.

### D-U01-5 · Owner call only · rule 101.1

"Printed text always wins" is the owner's statement (R157). No printed page or designer answer in the sources states it as a rule.

- R157 (its §27): "> *"Controller's cache — the printed text wins. Printed text always wins."*"

**Resolution:** Basis owner. A judge's CR may phrase the card-beats-rules principle differently; compare.

### D-U01-6 · Owner call only · rule 101.4

Taking the reading that lets more things happen is the owner's standing steer (R157). No printed or designer source states it.

- R157 (its standing steer): "and neither is absurd, take the one that lets more things happen."

**Resolution:** Basis owner. It is a tie-break between readings, not a rule of play, and a judge may use a different one.

### D-U01-7 · Owner call only · rule 104.4

Conceding, and conceding at any time including while a decision is pending, rest on R65 alone. The printed rules do not mention conceding.

- R65 (its concede half): "with no timing, no priority and no phase, and the one thing you may do while a"

**Resolution:** Basis owner.

### D-U01-8 · Owner call only · rule 104.5

That running out of cards does not lose the game rests on R296 alone. The printed rules do not say what happens when a deck runs out.

- R296: "**No deck-out loss.** A player whose deck *and* pile are both empty simply draws"

**Resolution:** Basis owner. A judge's CR may have a deck-out rule; compare.

### D-U02-10 · Other · rule 106.3b

No printed source says a dormant resource cannot be expended. Manual p.14 says all resources can be expended; the rulings say a Shard and a made Prismite pay mana once activated.

- Manual p.14: "All resources have the ability to be expended for 1"
- R54: "gives **one generic mana** once activated, gives **no affinity**, and **cannot"
- Manual p.18: "typically receive the two activations for the first turn. Active Prismites may be"

**Resolution:** The rule states the rulings, basis owner. The Manual's two-activations limit only does anything if a resource must be activated before it is used, so print implies the rule without saying it.

### D-U02-3 · Owner call only · rule 105.9

The client limits the resources a player may create (by recycling or by exchanging a Prismite) to the game's elements: in a live draft, the three selected. The Manual and R17 put no such limit.

- Manual p.18: "The resource step of the planning phase is when players have the ability to create and activate resources. During this step, any resource can be created from"
- R17: "resource of any element, keeping its current state ("players essentially get to pick"
- R299: "early on a prismite), and once active may be exchanged for any element of the game."

**Resolution:** The rule states R299 ("any element of the game"), an owner call with no printed or designer source. Question for the owner only if the Manual's "any resource" is meant to reach elements outside a live draft's selection (for example a fire resource in a water-wood-metal draft).

### D-U03-10 · Engine only · rule 109.9n

Sources silent on how [Switch1] bounds a "When I am trashed" ability. R124's per-player-per-name limit covers abilities that listen from the bin; the engine fires a trash trigger from a fresh stand-in per trashed card, so two copies trashed in one turn both trigger.

- card: Maw of Despair: "When I am trashed, [Switch1] Glimpse 2."
- R124: "card name**: a bin holds bare names, not instances, so the name in that seat's"
- file: client/engine/src/engine.ts: "which is right: each trashed card is its own instance. Its id is not in"

**Resolution:** The rule states the engine's behaviour with basis engine. Question for the owner only if "once per turn" on a trash trigger is meant per player and card name, as R124 reads it for a card in a bin; then the second copy trashed in a turn would not trigger.

### D-U03-2 · Sources disagree · rule 108.3a

R101 transcribes the back face Beyond, Codex Incarnate with the type line "Book Token Unit". R157 §10 (owner, later) rules that the back face is NOT a token.

*Also filed as D-U06-5 (rule 304.7).*

- R157: "side. And the back is NOT a token."
- R101: "> **Beyond, Codex Incarnate** — cost 0, 8/3, *Book Token Unit*"
- R157: ""Turns back over. In all zones, other than play, it exists as the front"

**Resolution:** An owner call where the print has two readings. Checked 2026-10-10: the scan data/cards/Beyond-Codex-Incarnate.jpg prints the type line "Book Token Unit", as R101 transcribed it. R157 §10 reads that word as marking a face that never enters a deck (which is how the engine uses it), not as making the card a token, and R160 turns the card back over before it leaves play, so it reaches the bin as Scholar of the Void and can be recurred. The rules (rule 108.3a, rule 304.7) state R157 §10 with basis owner, for sign-off. A judge who reads the type line literally would make the turned card a token while it is in play (so "nontoken" text would not count it); the bin result is the same either way.

### D-U03-6 · Owner call only · rule 109.9m

How a once-per-turn limit works for a card in a bin (one use per player per card name, shared by copies in one bin) is an owner reading of "per card" for a card not in play. No printed or designer source.

- R124: "card name**: a bin holds bare names, not instances, so the name in that seat's"

**Resolution:** Owner call; the rule states it with basis owner.

### D-U03-7 · Owner call only · rule 110.4a

That "an ally" and "target ally" include the effect's own source rests on the owner's reading of the printed words (the pool says "another" when it means not-me). No designer source.

- R265: "Yes, an ally includes itself. Otherwise it'd say "Another target ally"."
- R71: "**"An ally" MAY be the Wraith (or its host) ITSELF — a unit is its own"

**Resolution:** Owner call, and the permissive reading; the rule states it.

### D-U04-1 · Owner call only · rule 111.6b

That a player may pay N life only while they have more than N is the engine's own ruling. No designer statement was found either way.

- R49: "while you have **more** than N — paying your last life is refused too. Life"
- R49: "designer statement was found either way — this is the engine's ruling"

**Resolution:** Stated as the engine's law, basis owner. Question for the owner only if a designer statement turns up, or a card is found whose life cost is meant to be paid down to 0.

### D-U04-10 · Owner call only · rule 111.10k

That a paid-for cost reduction outlives its source, and is not limited to one region, is the owner's call. No designer source speaks to Deferral Drone.

- R119: "**Bena, 2026-08-23:** *the charge survives — **"you paid for it."***"
- R119: "regions in one turn gets the discount wherever they play.**"

**Resolution:** Stated as the engine's law, basis owner (with the printed card for its duration).

### D-U04-12 · Sources disagree · rule 111.15

The designer says an unpayable grafted cost keeps "the whole Graft Effect" off the stack. R334 reads that as the whole composite for a triggered or activated item, but keeps a per-part skip for a played spell with a {Modular} graft part.

*Also filed as D-U17-9 (rule 724.4c).*

- R334: "- A played **spell** that carries a `{Modular}` graft part keeps the per-part skip. Withholding a card already paid for would strand it."
- RAQ 1355115946032889914#10: "if you can't pay it (no units to sacrifice) then the whole Graft Effect won't go on the stack."

**Resolution:** An owner call where the designer is silent. Graft 101 point 11 ("the whole Graft Effect won't go on the stack") answers a triggered or activated graft composite, and the rule follows it for those. A played spell with a {Modular} graft part is a case the designer did not address: the spell is already paid for and on its way to the stack. R334 keeps a per-part skip for it, on the owner's reason that withholding a card already paid for would strand it. The rule states R334 with the carve-out, basis owner, for sign-off.

### D-U04-13 · Engine only · rule 111.3a

Only the engine says a cost that removes counters from allies, or recalls an ally, uses only units in the region where it is paid. R35's "region-scoped" predates those cost kinds and was written about sacrifice.

- R35: "sacrificed unit's defense as it was then), the cost is region-scoped (the"
- file: client/engine/src/engine.ts: "case 'sacrificeUnit': return this.unitsOf(seat, region).length > 0;"

**Resolution:** Stated as the engine's behaviour, basis engine (verifier r1: E.canPayCastCost draws removeCounters and recall candidates from unitsOf(seat, region)). Question for the owner only if a card's unit cost is meant to reach another region.

### D-U04-7 · Other · rule 112.13

Sources silent: neither the Manual nor the Rulebook 2023 defines rot or debt. Both rules come from R38 and R39, which cite Caleb (and a Rot Counter card in Caleb's card library) by date; no RAQ claim or printed page in the sources holds his words.

- R38: "itself. (Printed: the Rot Counter card, Caleb's card library 2026-01-15; via"
- R39: "casting this turn. (Caleb 2024-09-10, refined 2024-12-02; via Bena 2026-08-19.)"
- glossary: Rot: "At the start of deployment, you take damage equal to the number of rot you have. Rot does not go away."

**Resolution:** The rot and debt rules ship with basis owner. Adding the Rot Counter card text (and Caleb's debt answers) to the printed sources would raise them to a printed or designer basis.

### D-U05-15 · Owner call only · rule 202.3

That the affinity pips are not part of a card's cost is an owner call with no designer source.

- R157 §1: "> *"Pips aren't a relevant part of looking at the cost of a card in Algomancy."
- Manual p.12: "This many resources must be"

**Resolution:** Owner call; consistent with the Manual, which lists mana cost and affinity as separate parts. A judge may count pips toward a card's cost; this document does not.

### D-U05-16 · Owner call only · rule 207.8

That a "Discard me" line with no icon of its own can be used in battle on a card with no timing icon is an owner call. Read literally, the Manual says a card with no icon can only be played during deployment.

- Manual p.13: "Cards with no icon can only be played during deployment."
- R65 (its discard-me half): "(Nothyr) still restricts it to battle; nothing restricts it to deployment."
- R157 §8: "> *"It doesn't have a battle icon, but that is just an activated ability that"

**Resolution:** Owner call: discarding is not playing, so the card's timing does not govern the line. A judge reading the Manual literally may disagree.

### D-U05-17 · Owner call only · rule 204.2a

That a Spell Unit answers an effect asking for either a unit or a spell is the owner's permissive reading.

- R284: "A {Spell Unit} answers **both** halves, on the permissive reading, and the"

**Resolution:** Owner call. The RAQ thread on spell units played as units (quoted in R97) agrees for "playing a spell".

### D-U06-6 · Owner call only · rule 304.12a

Both printed rulebooks and Caleb speak only of bringing spell tokens along on an attack. That a counterattack may bring them rests on players' answers quoted in R87, not on a designer source.

- Manual p.15: "During the attack step, spell tokens can be brought"
- R87: "> "you can only play spell tokens in the region they are in (**or you can bring"
- R87: "> "If your opponent declares a counter attack they create a formation and move"

**Resolution:** Owner call (R87), stated with basis owner. It does not contradict print: the counterattack is the same movement in the other direction.

### D-U06-7 · Owner call only · rule 305.6

Caleb said spell tokens can be augmented during deployment, with attributes only. R89 reads that as allowing any augment, not just a Virus, and says that reading is sourced to a player rather than to Caleb.

*Also filed as D-U17-11 (rule 723.1b).*

- R89: "The reading taken, and it is a reading — sourced to the community rather than to"
- R89: "> deployment but currently that would only be possible with spell tokens. Also"

**Resolution:** Owner call, stated as part of rule 305.6 with basis owner. It is the permissive reading.

### D-U06-8 · Owner call only · rule 303.10

That a spell unit which gives itself away enters play under the other player (never controlled by its caster) is the owner's reading of Hush Mush. No designer source.

- card: Hush Mush: "Negate target effect. Its controller gains control of me."
- R143: "A spell unit whose text says another player gains control of it ENTERS as"

**Resolution:** Owner call (R143), stated with basis owner. Print says only that control changes, not when; R143 reads both sentences as one resolution.

### D-U07-12 · Owner call only · rule 408.2

The recycle mark has no printed or designer source. Print says only that recycling puts a card "on the bottom of the deck"; the owner learned the mark from a judge-level player.

*Also filed as D-U18-13 (rule 801.10).*

- R296: "Not a printed rule anywhere in this repository. The owner, 2026-09-16, after a"
- Rulebook 2023 p.7: "recycling a card in your hand (putting it on the bottom of the deck)"
- Manual p.16: "recycled (put on the bottom of the deck) and each"
- R296: "**past the mark**, into the recycle pile, not onto the bottom of the live deck."

**Resolution:** Owner call, stated as rule 408.2 with basis owner. It does not contradict print: print never says recycled cards keep their order.

### D-U07-13 · Engine only · rule 406.4b

That a negated or fizzled "Erase me" spell goes to the bin, not the erased pile, is stated only by test titles.

- card: Suspend: "Target player's life total can't change during this battle. Erase me."

**Resolution:** Engine-derived rule (rule 406.4b), awaiting owner sign-off.

### D-U07-14 · Owner call only · rule 410.5c

That a cached token enters the cache before it is erased is "the engine's call, not a ruling". No designer statement exists.

- R69 (its zone-visit and timing halves): "The CACHE is the engine's call, not a ruling."

**Resolution:** Stated at low confidence (rule 410.5c). R69 says the owner may overturn it "with no other change".

### D-U07-5 · Sources disagree · rule 407.3

Do tokens belong on the erased pile? R306 and R167 record a dying token, and a token mod whose host leaves play. R219 refuses to file a token mod erased off a living host, because "R65's pile is a list of cards".

*Also filed as D-U17-1 (rule 720.9a).*

- R219: "- **A token mod is not filed.** R133: a token is not a card, and R65's pile is a"
- R306: "unchanged: the `died` event still says `to: 'bin'`, anything reading the bin in"
- R167: "reaches the public erased pile exactly once on each of the three routes."
- R219: "list of cards. (`disposeToBin` does file token mods; that disagreement"
- R156: "event `disposeToBin` emits, anchored on the host's owner. No zone changes, no"
- R208: "disagree about it — `disposeToBin` **does** announce token mods on the erased"

**Resolution:** Two owner rulings disagree by route, and no printed or designer source speaks to the erased pile, a digital surface (R65). R306, R156 and R167 record tokens and token mods on it; R219 does not file a token mod erased off a host that stays in play, and says it left that disagreement alone. The rules state each route as its ruling says: rule 407.3 records tokens, rule 720.9a does not record that one route, and the Return to Nature path is filed as F-U17-4 (CT-259). Sign-off: one rule for every route. If the owner answers that a token is a card (D-U06-1, reading A), R219's reason falls and every route files.

### D-U08-6 · Owner call only · rule 504.5

That the haste step happens every turn, even when nobody can play anything, is the owner's call. The Manual says only that the step ends when everyone has played what they want, "which can be none".

- R224: ""Always offer the step.""
- Manual p.18: "the haste cards they wanted to play (which can be none)."

**Resolution:** Owner call; no designer source. Consistent with print (an empty step is allowed), and it keeps the step's presence from revealing a hidden hand (Annex D).

### D-U08-7 · Owner call only · rule 503.5b

That a player's units are not checked for death between the draw of 4 and the recycle of 2 in constructed is the owner's call (2026-10-06, quoted in R313). No designer source rules on it.

*Also filed as D-U16-15 (rule 713.3).*

- R313: "- **Constructed's draw phase is one step.** Draw 4 and put 2 back are two"
- R313: "actions, but a seat's units are not checked while that seat still owes its"

**Resolution:** Owner call; consistent with Manual p.16 calling the two steps one combined step in practice ("two steps by drawing 4 cards, then recycling 2").

### D-U08-9 · Owner call only · rule 504.9

That a [Haste] at the end of a prophecy condition lets the card be prophesied in the haste step is the owner's reading of the marker; no designer source explains the marker.

- R277: "2. **A trailing `[Haste]` in the printed CONDITION widens the PROPHESY"

**Resolution:** Owner call (R277). Only one card in the pool carries the marker (Divine Intervention, per R277).

### D-U09-3 · Owner call only · rule 505.2b

Manual p.20 lists a priority window after the attack declaration without a condition. It says only that combat and after-combat are skipped in a region that was not attacked. The client opens no window at all after a declined attack, on R194's reasoning, an owner call.

- Manual p.20: "2. There is a priority window for interaction."
- R194: "1. **It is a rules change.** A declined attack fights no combat, so there is no"

**Resolution:** Owner call stands as the client's law (basis owner). Sources are silent on whether the step-2 window opens when nothing was declared.

### D-U09-6 · Owner call only · rule 505.6

Cards print "in this battle", but no printed or designer source says the count is per region and resets each battle phase. That is R14, marked as an engine call.

- R14: "## R14 ⚠ — "In this battle" counters are per region-battle"
- card: Seabed Shellcaster: "When the second nontoken spell is played in {/n}this battle"

**Resolution:** Owner call stands. Sources are silent on the scope of "this battle".

### D-U10-10 · Owner call only · rule 602.6k

'A formation with no living unit offers no position' is R75's own prose, not the owner's quoted words. R184 rules that an emptied formation is still a formation while its battle runs, which a reader might take to leave its hole open to a late play.

- R75: "all — with no living unit in the grid the answer is "no slots", not "open a"
- R184: "legal exactly while its battle runs; **emptying it does not remove it**"

**Resolution:** The rules state R75 (602.6k, 602.7c), basis owner, medium confidence, with two exceptions: R322's after-blocks spot for the defender (602.6c) and the designer's remembered formation (602.6f). The engine follows R75 and R322. R184 is about a formation as a TARGET and does not speak to joining one. Awaits owner sign-off with the other owner-only rules. For an effect whose source has left play, see D-U10-6.

### D-U10-4 · Owner call only · rule 602.6a

Two parts of the placement rule are readings added by R75's author, not in the owner's quoted words: the hole as a third legal position, and 'either side of the existing units' read as the two ends only.

*Also filed as D-U10-3 (rule 602.6c).*

- R75: "to either side of the existing units OR in the second slot of a column for a"
- R75: "**The hole is a third kind the ruling does not enumerate.**"
- R75: "**"Either side of the existing units" is read as the two ENDS, not as an"
- R304: "**Attacking line only.** A blocking column is keyed to the attacking column it"
- R321: "Side-blocks may stand to either side of the attack."
- Manual p.23: "where attackers aren’t, which can be beneficial for"

**Resolution:** Owner-only readings of R75, which no printed or designer source addresses: the hole as a third legal position; "either side of the existing units" read as the two ends; and, for a DEFENDING formation, no end columns at all (R75 and R304: a blocking column is keyed to the attacking column it answers), so a blocking Hooba-Bot or Hooba-God whose column is full places nothing. R321 has since let a block declaration open side columns, which weakens R304's reason, and the permissive reading would give a defending formation a side column too. The rules state R75 and R304 with basis owner, medium confidence, for sign-off (Annex P).

### D-U10-8 · Engine only · rule 603.1c

Sources silent on whether two side-blockers may share one side-block column. Caleb permitted a separate column each; R321 restates it as 'each as its own column'. The engine accepts two side-blockers front and back in one side column.

- RAQ 1366447016653361192#3: "Yep you should be able to"
- R321: "- **Any number** of units may side-block, each as its own column — *"if I have"

**Resolution:** The rule states the engine's behaviour, basis engine. Every column holds a front and a back slot, and nothing printed forbids a side-block column from using both. Question for the owner only if R321's 'each as its own column' was meant as a requirement.

### D-U10-9 · Engine only · rule 602.6j

Sources silent on placing a unit into a blocking column whose blockers have all left after blocks. R75's hole is a column emptied of attackers, and R322's spot is a column with no block entry; the engine offers the emptied blocking column's front slot as well.

- R75: "- **the front slot of an R72 hole** — a column emptied of attackers that its"
- R322: "So after blocks are declared, a unit joining the DEFENDING formation may stand"
- file: client/engine/src/engine.ts: "    // Only the ATTACKING grid can widen. A blocking column is keyed to an"

**Resolution:** The rule states the engine's behaviour, basis engine. It is consistent with R322's reason (the column is still blocked, R13, and the new unit answers the attacker in front of it). Question for the owner only if the defending line was meant to have no hole kind.

### D-U11-1 · Owner call only · rule 604.4

Printed text lists a priority window for the attack step and skips only combat and after combat in a region that was not attacked. It does not say what happens to the attack window and the block step when the attacking player declares no attack. R194 and R15 (owner calls) say a declined attack opens no window at all and gives no block step.

- Rulebook 2023 p.13: "block, damage and after combat steps all have a priority"
- Manual p.20: "did not get attacked, in which case combat and after"
- R194: "A declined attack fights no combat, so there is no"
- R15: "If IT declines to attack (no round-1 battle), NIT never gets a block step and so"

**Resolution:** The rule states R194/R15: no attack window, block step, block window, combat damage or after combat step. The printed lists describe a battle that happens, and a region that was not attacked has none. No designer source covers the attack window after a declined attack. This is an owner call.

### D-U11-10 · Engine only · rule 604.2c

The sources say spell tokens cannot travel on their own, but not what happens to an ATTACK declaration that names spell tokens and no unit. The engine takes it as declining to attack and the token stays home; a counterattack naming only tokens is refused instead.

- Manual p.15: "so on their own, however and must follow at least one"
- file: client/engine/src/apply.ts: "if (!columns.length) {"
- file: client/engine/src/apply.ts: "e.ev('info', `${e.pname(seat)} does not attack.`);"

**Resolution:** Engine only. The rule states the printed requirement; that an attack of tokens alone is a decline (rather than a refusal, as for a counterattack) is the engine's. Question for the owner only if the two declarations should behave the same.

### D-U11-2 · Owner call only · rule 606.4c

The Manual and the RAQ allow side-blocks, and any number of them, but say nothing about how far from the attack a side-block may stand. R321's encoding limits a declaration to reach no further out than it has blocking columns.

- Manual p.23: "columns. Units may even be placed blocking in slots"
- RAQ 1366447016653361192#3: "Yep you should be able to"
- R321: "reach no further out than it has blocking columns"

**Resolution:** The rule states R321's limit and is marked basis owner. No printed or designer source sets a distance.

### D-U11-5 · Owner call only · rule 607.2d

Two details of the late-blocker rule are R322 encoding decisions with no designer source. (1) The spot is offered from the block window until combat damage is over; the RAQ question spoke only of the 'after block' window. (2) No 'blocked' event fires for the late blocker, so it was not 'declared' as a blocker; whether a 'When I block' unit put in this way triggers is not addressed by any designer source.

*Also filed as D-U10-12 (rule 602.6c).*

- R322: "attacker and no block entry, from the block window until combat damage is"
- R322: "No `blocked` event fires for the late blocker"
- RAQ 1366447016653361192#1: "A unit played in as a blocker after blocks (Tiderunner Initiate) blocks an unblocked column"
- R322: "> *"3. If there is unblocked column and during 'after block' window as defender"

**Resolution:** The rules state R322 and are marked basis owner (rule 607.2d, rule 607.2e). Question for the owner only if a unit with a 'When I block' ability can reach a blocking spot after blocks (for example one played by a blocking Hooba-Pon 'into an open position in my formation'); then whether its trigger fires needs a decision.

### D-U11-6 · Engine only · rule 606.7

That the block step still takes place when every attacking unit has gone before blocks is stated only by a test. The Manual says the attacking player stays present after its units are removed, but not whether the block step happens.

- Manual p.19: "if the units they’ve sent into the region are removed."
- file: client/ui/test/53-playtest-round7.test.ts: "R84: an attack that has collapsed to nothing still lets the defender declare"

**Resolution:** The rule is basis engine and awaits owner sign-off (Annex P). It matters because the defending player may still want to side-block or send counterattackers.

### D-U11-9 · Engine only · rule 604.3c

Sources silent on exactly when 'When I attack' and 'When I block' triggers reach the stack relative to the following priority window, and on when 'After the blocking step' resolves. Only R84 (for Alluring: it goes on the stack and can be negated) and the tests say so. The same applies to rule 606.6 and rule 607.3.

- card: Palewing: "When I attack or block, [Switch1] Discard a card."
- card: Roving Quillback: "[Augment] After the blocking step, I deal 1 damage to each opponent for each blocked column."
- R84: "It goes on the stack and can be negated."

**Resolution:** The rules state the timing the tests show (the trigger is on the stack when the attack window or block window opens) and are marked medium confidence. The general ordering of triggers is section 706.

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

*Also filed as D-U20-18 (rule 802.20d), D-U20-24 (rule 802.24c), D-U15-10 (rule 708.3).*

- R238: "> **"Yes, blightsea pollup says it deals damage as, so its still damage. Just"
- R238: "- **Caleb was shown {Lethal} only.** The client's extension of the ruling to"
- R238: "> **Caleb Gannon, 2024-10-24T00:23:09** *(reply)*: **"Yes"**"
- file: client/engine/src/engine.ts: "if (hit.attrs.has('Lethal')) this.killPlayer(hit.seat, `${hit.label} is Lethal`);"
- R238: "Two cards, and **both consume a hit WHOLE**: Blightsea Polyp returns `true`"

**Resolution:** Owner extensions of one designer answer. Caleb said "Yes" (2024-10-24, in #rules-questions, quoted in R238) to a replaced hit still counting as dealt when Blightsea Polyp turns it into rot for the same player, and he was shown Lethal only. R238 extends it to Thieving and Blessed, and the engine to a hit Oorblak redirects to itself, where the player is dealt nothing (rule 802.24c: a Lethal hit redirected into Oorblak still kills the player). The rules state R238 with basis owner, for sign-off. Read literally, Lethal's reminder ("will kill a player") and Oorblak's "that damage is dealt to me instead" suggest a redirected hit kills no player, so the Oorblak extension is the one to confirm. The same answer decides whether a redirected hit counts for "when my column deals combat damage to an opponent" (rule 708.3).

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

### D-U13-5 · Owner call only · rule 610.2e

That a sent counterattacker is not checked for death while away, and is checked on its return, is an owner call. No printed or designer source speaks to state checks on an absent unit.

- R270: "A sent counterattacker is not death-checked"
- Manual p.20: "the region and are treated as if they don’t exist until"

**Resolution:** The rule states R270, basis owner. It is consistent with the Manual's 'treated as if they don't exist'. It awaits owner sign-off like every owner-only rule.

### D-U14-10 · Engine only · rule 704.1

No printed, designer or owner source states that an effect's instructions are carried out in printed order with each later one seeing the earlier results. The engine does so; R68 records it only as the implemented reading for Finality and asks for a ruling.

*Also filed as D-U14-6 (rule 704.1).*

- R68: "The straightforward reading of the printed text is implemented — the sentences"
- R68: "clause just filled. **Bena to rule.** If the answer is "no, a card negated by"

**Resolution:** The rule states the engine behaviour with basis engine. R68 implements that reading for Finality (its second sentence erases the cards its first sentence just negated) and asks the owner to rule, because it makes the card stronger (D-U14-6, merged here). Sign-off: the order in general, and Finality's reading in particular.

### D-U14-13 · Engine only · rule 704.1

R324 fixes target legality once, as an item begins to resolve, so an earlier part cannot make a later part's target illegal. R56 says only to re-validate at resolution. No printed, designer or owner source says whether a target that an earlier instruction removes from play is lost to a later instruction of the same effect; the verifier reports the engine loses it.

- R324: "the same item therefore cannot make a later part's target illegal"
- R56: "never what will still be true later. Redirection, death, region changes and"

**Resolution:** Engine decides. The rule states only R324's legality exception; the leaving-play case is left to the engine until a source speaks.

### D-U15-3 · Owner call only · rule 708.4a

When two effects could each replace or redirect the same event, only one applies. No printed or designer source says which one; R104 takes the first in entity order ("ties break by entity id"), an engine choice.

- R104: "the first claimant takes it and ties break by entity id, exactly as `replaceRotDamage`"

**Resolution:** The rule states only that one applies. Which one is the engine's order. Question for the owner only if two such effects controlled by different players can claim the same event in a real game (two Counter Thieves on opposite sides of a battle), where the choice decides who gets the counters.

### D-U15-4 · Owner call only · rule 708.6a

The order "add, then double" is the designer's for damage and {Powerful} (R316, from the RAQ). For a life-total multiplier (Arbiter of Vitality) beside an additive modifier, R264 says the composition is still unruled and the engine's order is an interim decision.

*Also filed as D-U04-6 (rule 112.3).*

- R316: "> "Bellowing Boulder with Powerful and Conduit of Pain: (1+1)x2 damage to each unit ="
- R264: "**⚠ THE ADDITIVE COMPOSITION IS STILL UNRULED, and Q4 asked about it.** R157 §23"
- RAQ 1362838395298119912#4: "Conduit of Pain adds its 1 BEFORE Powerful doubles"

**Resolution:** The rule states one order for both, add first and then double, which is the designer's order for damage and the engine's interim order for life. Question for the owner only if the RAQ order for {Powerful} is not meant to carry over to Arbiter of Vitality.

### D-U16-10 · Engine only · rule 710.8d

R164 says a Virus applied to the original spell while it was on the stack is not copied, so its attributes do not reach the copy. This is named as an engine approximation; no printed or designer source covers it. Caleb is quoted only for {Modular} mods, which are copied.

- R164: "onto the ORIGINAL while it sat on the stack are **not** copied, so their"

**Resolution:** The rule states only the {Modular} half, which has a designer source. The Virus half is left unstated as engine behaviour with no ruling. Question for the owner only if the judge's CR says what a copy does with a Virus on the original.

### D-U16-11 · Owner call only · rule 711.3

That a unit stolen during a battle stays out of formation until regroup, attacking and blocking for nobody, is the owner's call on Download. No printed or designer source covers it, and R8 had said the stolen unit joins its new controller's formations.

- R8: "including joining the new controller's formations"
- R172: "it sits out until regroup."

**Resolution:** Owner call. The rule states R172; R8's formation clause is cited as history.

### D-U16-16 · Engine only · rule 713.3a

The sources are silent on whether deaths are checked part-way through an effect's resolution. R313 makes the end of every action a safe point and says a suspended action is not at one; it does not say whether the effect's own changes are checked as they happen. The engine checks after each counter placement and after each part of a composite effect, so units an 'each unit' effect kills (Pestilent Titan) die one at a time, not together.

- R313: "safe point — the engine's state-based check. The end of every action is a safe"
- R237: "because `addCounters` runs `checkDeaths` and a lethal poison hit would otherwise"
- file: client/engine/src/engine.ts: "this.checkDeaths();   // sequential within the composite; triggers wait for settle()"
- card: Pestilent Titan: "When I attack or block, [Switch1] Put a -1/-1 counter on each unit. Each player gains a rot."

**Resolution:** The rule states the engine's behaviour with basis engine. Question for the owner only if the judge's CR has an 'each unit' effect finish before any death is checked, so that units it kills die together (rule 713.6).

### D-U16-4 · Engine only · rule 709.8

The sources are silent on where an effect that switches power and defense applies in the stat layers. The Manual's six layers include no switch, and R66 calls the engine's handling an approximation and the question an open ruling.

- R66: "Where a real switch belongs is an OPEN RULING, and this line previously guessed"
- Manual p.42: "A: Stats have 6 layers to them, which are applied in"

**Resolution:** The rule states the engine's handling (a layer-3 change worked out at resolution, so a later change is not switched) with basis engine, and says the ruling is open. Question for the owner only if the judge's CR places the switch elsewhere.

### D-U17-10 · Owner call only · rule 723.5c

That Rook's permission works only in Rook's region rests on a player's chat remark, quoted in R95. Players are not authority; Rook's printed text names no region.

- R95: "the rules'. Region scoping is not a convenience either; on this exact card, rodanaw in"
- card: Rook: "You may augment cards from hand and bin during battle as if they were [Virus]."

**Resolution:** The rule states the engine's region scope, basis owner. It is the general region scope the client applies to every permission; owner sign-off needed.

### D-U17-2 · Engine only · rule 723.4e

Which stack items a Virus may be augmented onto rests on R79's own judgement calls. Caleb names spells (and spell tokens); R79 excludes triggered and activated abilities, Viruses, units being cast and Ambushes, and marks each exclusion "not sourced" and "Bena to rule".

- R79: "The four ⚠ are judgement calls, not sourced answers. **Bena to rule** if any of"
- R79: "`STACK_VIRUS_HOSTS = { spell, spellUnit, spellToken }`. The ruling names spells"

**Resolution:** The rule states the engine's exclusions (apply.ts STACK_VIRUS_HOSTS), basis engine, confidence low; the positive host set stays in rule 723.4a. Owner sign-off needed; nothing in print or the RAQ decides the four exclusions.

### D-U17-3 · Owner call only · rule 723.4c

Caleb says a spell carrying a Virus "gets erased on resolution". R79 makes an exception for spell units, which enter play with the Virus as an augment instead, and says no ruling asks for it.

- R79: "> and the spell gets erased on resolution**. You can augment spells during"
- R79: "*arrives*. Erasing its card would delete a unit on its way into play, which no"

**Resolution:** The rule states R79's exception, basis owner. Its reasoning: {Unstable} replaces a bin entry (R69), and a resolving spell unit does not go to a bin. Owner sign-off needed; question for the owner only if he reads Caleb's "the spell gets erased" as covering spell units.

### D-U18-11 · Owner call only · rule 801.2e

Every rule about who trashes and what is trashed rests on owner calls with no designer source: the trasher is the player whose bin the card enters (R40, R250), a mod's trash belongs to the host's controller (R244), a token is never trashed (R306), and an exchange trashes the unit that leaves (R157 §3).

- R250 (its §4, zones follow control): "| who trashed it? | its CONTROLLER (R244, unchanged) |"
- R244 (its attribution and mod-erase halves): "**1. Where a mod IS trashed, the HOST'S CONTROLLER trashes it.** Not the mod's"
- R306: "trashed.* A token is not a card (R133's first half, which stands), so a token"
- R157 (§3): "> *"It's not a death, but it is a despawn and trashing. Weird corner case."*"

**Resolution:** The rules ship with basis owner, as the engine's law. Fourteen cards print trash triggers, so these calls decide real games; they are the first to compare against a judge's CR. Question for the owner only if the judge's CR attributes a trash differently.

### D-U19-10 · Owner call only · rule 802.9c

What counts as "interacting with" an Unaware card (dealing or being dealt damage, and combat) rests on the owner's operational statement; the RAQ covers only the Squish/Fight/Battle cases, and R10's wider reading (targeting too) was replaced.

- R106: "> 'involved' (self or others when dealing damage or in combat when dealing/receiving). So"
- RAQ 1402292180499955884#4: "Squish to make Robot 10 deal its defense as damage to Bubb will cause no harm to Bubb"

**Resolution:** Follow R106 (owner) for the scope, with R281 for targeting. Question for the owner only if a comparison CR treats other interactions (an ability that reads another card's stats, a stat-gated target restriction) as "interacting".

### D-U19-12 · Engine only · rule 802.1m

Which way mod-stack order runs for augment-granted attributes rests only on R19's engine reading ("order gained": the first attached applies first). The Manual says attributes apply "top to bottom" but does not say whether a later augment sits above or below an earlier one.

- Manual p.42: "A: Attributes apply in order from top to bottom. So if"
- R19: ""order gained" is the engine's reading. (Engine 2026-07-16.)"
- R19: "⚠ Engine call: the Manual doesn't specify an order for printed-vs-granted-vs-shared;"

**Resolution:** The rule states the engine reading (first attached first), pinned by 08-cards2.test.ts (Rampart Guardian then Child of Aether makes a 3/1 a 3/3; the other order a 3/6). Question for the owner only if a later augment is meant to sit on top of earlier ones, so that "top to bottom" applies the newest augment first.

### D-U19-9 · Owner call only · rule 802.8d

The Tough + Inverted law rests on the owner's retracted bug report and R226's derivation; the owner's own words ("always kills") are stronger than the law R226 pins (a shrunk unit survives).

- R226: "> works. So tough + inverted always kills the unit since +0/+X is just -0/-X"
- R226: "> ### **final defense = −2Δ.** The base cancels out completely."

**Resolution:** Follow R226: the rule states the law (defense = -2 x the net change), which is the owner's statement for every board where the defense has not been reduced. No designer source; Caleb's nearby remark ("tough inverted would die before you could add more", R93) agrees with the common case.

### D-U20-11 · Other · rule 802.21c

Reaping's second printed sentence ("It loses reaping until regroup.") is deliberately not built: R283 says no source in the pool can kill twice with Reaping, because all four Reaping cards are spells and nothing can give a unit Reaping. A guard test goes red if that changes.

- R283: "### 2. "It loses reaping until regroup" is deliberately NOT built"
- R283: "clause would bite only if a UNIT could carry {Reaping}, and nothing in the pool"

**Resolution:** The document states the printed rule (basis owner, confidence low, citing R283's quote of the reminder). No engine bug while it stays unreachable; 263 §4 is the tripwire.

### D-U20-12 · Owner call only · rule 802.23b

One rot per controller per kill event, however many of that player's units died, is the owner's reading of the Afflicting reminder; R48 says no designer statement was found.

- R48: "kills anything. ⚠ One rot per affected controller per kill event, however"
- card: Umbral Decay: "(When an afflicting source kills one or more units, those units' controllers gain a rot.)"

**Resolution:** Stands as owner law. The printed "those units' controllers gain a rot" (singular rot, plural units) supports it.

### D-U20-14 · Owner call only · rule 802.26g

The Manual makes a modded card Unstable "when it dies or is erased". A resolving or negated spell does neither. R105 extends the erase to a modded Modular spell leaving the stack, on the owner's design reason (Spellbind is a flashback).

- Manual p.35: "As long as a card is modded, it has the unstable attribute, meaning when it dies or is erased, it and all of its"
- R105: "> "A modded Spellbind should also have unstable. It basically works as a"

**Resolution:** Stands as owner law. The Manual's next sentence ("even though mods can be applied from the bin, they are generally only able to be applied once") has only Modular as a referent, which supports the owner.

### D-U20-20 · Owner call only · rule 802.19c

That Resonant's "that much damage" is the damage the unit received, after Vulnerable doubled it and after prevention, is R315's own reading. The RAQ examples never involve Vulnerable.

- R315: "The amount is what the unit **received** ("that much damage"): after {Vulnerable},"

**Resolution:** Stands as owner law.

### D-U20-21 · Engine only · rule 802.17f

Sources are silent on what "adjacent" means for Electric outside a battle. The printed reminder says only "an adjacent unit"; the engine reads adjacency off the two battle grids, so outside a formation no unit is adjacent and Electric excess stays on the unit it hit (measured by the round-1 verifier's probe).

- card: Envoy of Lightning: "Excess damage from electric sources can {/n}be directed to an adjacent unit, recursively."
- file: client/engine/src/engine.ts: "push(grid[ci]![1 - ri]);"

**Resolution:** The rule states the engine (formation adjacency only), basis mixed, awaiting owner sign-off (Annex P). Question for the owner only if a judge's CR treats units in the same region, or deployed side by side, as adjacent outside combat.

### D-U20-3 · Owner call only · rule 802.14a

What "attacking alone" means (the only attacking unit in the formation; spell tokens do not count; two Sneaky attackers are both blockable) is R20's engine reading, marked ⚠, with no designer source.

- R20: "attacking are NOT alone — both blockable. ⚠ Engine reading of "unblockable if attacking"

**Resolution:** Stands as owner law (basis owner). Seek a designer answer if a judge disputes it.

### D-U20-4 · Owner call only · rule 802.15k

When two Alluring triggers target the same unit, R84 lets blocking either column excuse both duties. R84 calls this a judgement call by the owner; no designer source.

- R84: "### ⚠ Two duties on one unit — a judgement call"
- R84: "**Discharging either duty excuses the rest**, and the "must be among its"

**Resolution:** Stands as owner law (basis owner).

### D-U20-7 · Owner call only · rule 802.17b

That Electric excess never jumps back to a unit already in the chain is stated only by R206's description of the engine (a visited chain) and our glossary; no printed or designer source says so. "Recursively" does not settle it.

- R206: "A `visited` chain (engine.ts:4123-4160), and Envoy of Lightning's printed reminder names it"
- card: Envoy of Lightning: "Excess damage from electric sources can {/n}be directed to an adjacent unit, recursively."

**Resolution:** Stands as owner law (basis owner, confidence medium). No reachable card makes it matter often; ask Caleb if a judge disputes it.

### D-U21-5 · Owner call only · rule 803.7g

That a fulfilled prophecy stays fulfilled is the owner's call (R44), reasoned from the reminder text and an announcement by Caleb that the pack does not hold verbatim. No designer ruling decides it.

- R44: "text says the card may be played "if the prophecy has been fulfilled" and"
- R44: "of which read as a one-way latch. (Bena's call 2026-08-19.)"

**Resolution:** Stated as the owner's call. If Caleb's announcement ("anytime after the condition has been met") can be found in the Discord export, add it as a designer source and raise the basis.

### D-U21-6 · Owner call only · rule 803.8a

Caleb's glossary line limits Unstable to a card entering a bin "from an active zone", but he never lists the active zones. The list (play and the stack) is the owner's fill, and R145 says not to attribute it to Caleb.

- R145: "is worth being honest that it is a fill and not a citation: **do not attribute"
- R145: "> "in play and the stack are active zones (which is relevant for cards that have"

**Resolution:** Stated as the owner's ruling with the zone list marked owner. Question for the owner only if a judge's CR lists the active zones differently (for example, including the cache).

### D-U21-7 · Owner call only · rule 803.6h

R22 labels two Ambush behaviours as engine calls with no designer source: an Ambush on the stack counts as a spell effect for negation, and an ambusher takes the ally's slot exactly, including a blocking slot.

- R22: "an ambush on the stack counts as a "spell effect" for negation targeting (Dreadwave"
- R22: "the slot exactly (including a blocking slot). (Engine 2026-07-16.)"

**Resolution:** Stated with basis owner (803.6h; the slot half sits in 803.6e beside the printed "their position in play"). Question for the owner only if a judge's CR treats an Ambush as a non-spell effect.

### D-U21-8 · Owner call only · rule 803.8m

Pull Under tells its caster to put the deleted unit and its mods into a bin; Unstable says a modded card that would enter a bin is erased instead. R137 records the engine's reading that the card's own destination wins. No designer source decides between the two printed texts.

- card: Pull Under: "Delete target unit. If you do, put it and"
- card: Abyssal Evocation: "{i}(If they would enter a bin, erase them instead.)"
- R137 (its Pull Under section): "destination wins over the Unstable erase. That override used to be card code"

**Resolution:** Stated as the engine's reading (basis owner). It agrees with "the card beats the rules" where Pull Under is the more specific text. Question for the owner only if a judge's CR erases Pull Under's victim.

### D-U22-8 · Owner call only · rule 901.8

Single Card Duel is an owner format with no printed or designer source. It breaks the printed 2-copy limit (30 copies of one card) and replaces constructed's draw phase with a flat draw of 2.

- R298: "It is the ONE exception to the Manual's two-copy cap, and it is not a new mode: the room"
- Manual p.16: "pre-built decks to the game with up to 2 copies of each"

**Resolution:** Stated as the client's variant, basis owner, and labelled as not the printed game. The owner calls it "a goofy thought experiment format"; no sign-off beyond R298 is needed, but it belongs in Annex P's owner-only list.

### D-U22-9 · Owner call only · rule 902.5

Custom live-draft rules (pack size, element count, hand, draws, life, simple-only, bans, filter) are an owner feature with no printed or designer source. Pack sizes other than 10 contradict print, which always uses 10-card packs.

- R292: "**Not rulebook text.** 5-card packs are not in the printed rules this repository"
- Rulebook 2023 p.6: "At the start of a game or when the draft is refreshed (see below), each player is dealt a Pack of cards. Packs in Algomancy always"

**Resolution:** Stated as the client's variant, basis owner. A custom game is not the printed game, and R292 itself says so; the standard game is unchanged.

### D-U23-1 · Owner call only · rule D3.1

The clock banks (no clock, 45 minutes, 60 minutes) and the per-mode defaults are an owner answer on a question sheet, not an R-ruling. The rules are therefore engine-only, backed by test 271.

- file: client/docs/questions-round36.md: "ANSWER: Let's do: 45m (default for constructed), 60m (default for live draft) and allow the clock to be turned off when doing room settings, for friendly games."

**Resolution:** The rules state the engine's banks and defaults as basis engine. Register the owner's Q4 answer as a ruling if it is to count as owner basis.

### D-U23-11 · Engine only · rule D4.1c

No ruling says that battle actions cannot be undone. Test 373's title is the only statement.

- file: client/ui/test/373-no-confirm-where-undo-works.test.ts: "nothing there is undone"

**Resolution:** The rule ships as engine-derived (Annex P).

### D-U23-19 · Engine only · rule D3.1d

Sources silent on when a clock is shown as critical. Only the client and test 271 decide it: a tenth of the bank, capped at one minute.

- file: client/ui/main.ts: "return Math.min(60_000, start / 10);"
- file: client/ui/test/271-clock-picker-and-warning.test.ts: "// …and the cap is real: a tenth of a very long bank would be a warning"

**Resolution:** The rule states the engine's threshold, basis engine, for owner sign-off in Annex P.

### D-U23-2 · Engine only · rule D3.2

Sources silent on when a clock runs, what happens when it runs out, the recap's clock hold and the closing of idle games. No ruling, designer source or printed page covers clocks; everything in D3 comes from tests (e2e/test-clock.ts, 360, 367, 372).

- file: client/server/e2e/test-clock.ts: " *   - chess clock: CLOCK_START_MS per seat, runs only for seats the game is"
- file: client/server/e2e/test-clock.ts: "console.log('\n[BL-27: a seat that stops acting runs out of time and LOSES]');"

**Resolution:** The D3 rules ship as engine-derived (Annex P) and await owner sign-off. e2e/test-clock.ts is not in the test-title index, so its rules carry only a file-level citation of suite.test.ts.

### D-U23-21 · Engine only · rule D1.2b

Sources silent on which actions the game takes for a player. The only ruling naming a forced action is R36 (the lone round-2 counterattacker), whose branch the engine removed. The two cases the engine forces, the empty attack and the empty block, rest on forcedAction and tests 21 and 273 alone.

- R36: "that could ride along, the only-unit formation is auto-declared (a forced"
- file: client/engine/src/apply.ts: "if (!eligible.length) return { type: 'declareAttack', seat: b.attacker, columns: [] };"
- file: client/engine/src/apply.ts: "return { type: 'declareBlocks', seat: b.defender, blocks: {} };"

**Resolution:** The rule states the engine's two forced cases, basis engine, for owner sign-off in Annex P; R36's case stays a sub-rule stating the ruling (F-U23-4 (CT-251), D-U13-3).

### D-U23-22 · Engine only · rule D5.5c

R150 describes S as spending the whole held queue to the live state in one step. In a recap playback the engine's Skip goes only to the next stop (and continues from a stop), and a Skip button is drawn on the play bar. No ruling covers skipping inside a playback; only owner report #198 and test 383 do.

- R150: "the `S` key. `paceFlush` spends the whole queue in one step. Deliberately not"
- file: client/ui/main.ts: "if (NET?.playbackStopped()) { NET.continuePlayback(); return; }"
- file: client/ui/test/383-recap-stops.test.ts: "test('report #198: Skip jumps to the next stop, never past it', () => {"

**Resolution:** rule D5.5 is scoped to outside a playback; the playback behaviour ships as an engine-derived sub-rule (Annex P). Register note: R150's S-key flush is now the out-of-playback case only.

### D-U23-3 · Owner call only · rule D3.2b

That a standing pass stops the clock, with a server backstop pass, rests on an owner sentence quoted only in a test comment. No R-ruling records it.

- file: client/server/e2e/test-passall-clock.ts: " * The owner, 2026-09-28: *"When a player is 'Pass all'ed, their timer should"
- file: client/server/e2e/test-passall-clock.ts: " * never go down."* He chose PAUSE + BACKSTOP: the client tells the server when"

**Resolution:** The rule states the engine's behaviour as basis engine. Register the owner's call as a ruling if it is to count as owner basis.

### D-U23-4 · Owner call only · rule D2.7a

R287 gives the owner's full-control sentence, including deployment, and records that the deployment clause is not built. It was filed as CT-185 and left as the owner's call.

- R287: "> the haste step or anything. Even during deployment, nothing will"
- R287: "⚠ **THE DEPLOYMENT CLAUSE IS NOT BUILT.** *"Even during deployment, nothing"

**Resolution:** Under owner decision 2 the rule states the ruling, with the marker 'engine differs, see F-U23-1 (CT-185)'. Whether to build it (a replay-safe holdStack action) is CT-185's open owner call.

### D-U23-7 · Owner call only · rule D4.1

The basic undo convention (undo your own actions back toward the start of a hidden step, whatever the opponent does, but not past what the step itself did as it began) has no ruling of its own. R312 states it only in the past tense, as what it narrows. The owner's words survive only in an e2e test's header.

- R312: "Undo inside a hidden step (planning, haste, deployment) used to walk back any"
- file: client/server/e2e/test-undo-segment.ts: " *    to undo everything, up to the beginning of that phase (unless there is"

**Resolution:** D4.1 cites R312 for the baseline. Its opponent and floor sub-rules are engine-only. Register the owner's 2026-08-23 answer (ledger #37/#76) as a ruling if they are to count as owner basis.

### D-U23-8 · Engine only · rule D5.3

Sources silent on the recap's structure: no ruling defines the recap, its frames, where it pauses, or its end pause. R310 describes it only in passing. Tests 360, 372 and 383 carry it.

- R310: "(playback), at the moment it happened, with its card popup. The glimpser still"

**Resolution:** The frame and pause rules ship as engine-derived (Annex P).

### D-U23-9 · Engine only · rule D2.3

Sources silent on when the auto-pass preference passes. R150 says only what turning it on means to the player; the condition (pass only when passing is the only legal action, never through a decision) is in test 70 alone.

- R150 (its CT-28 pacing half): "armed. Auto-pass is the player having said out loud that these windows are"

**Resolution:** The rule ships as engine-derived (Annex P).

### D-U24-2 · Owner call only · rule D6.6e

R99 ships a constructed deck's element identity to both players, and says in its own words that whether it is public at game start is an open question for the owner.

- R99: "### ⚠ OPEN QUESTION FOR THE OWNER — is deck element identity PUBLIC at game start?"
- R99: "It decides whether `deckElements` belongs in both players' views or only the owner's."

**Resolution:** An owner-only presentation call with no printed or designer source. R99 names it as the owner's open question: is a constructed deck's element identity public at game start? The client shows it to both players, and the rule states that default at low confidence, for sign-off.

### D-U24-3 · Owner call only · rule D6.3

R78 left one presentation call open: the log line "X resolves." is written when resolution STARTS, so it is in the log while the controller is still choosing. R78 asks the owner to rule.

- R78: "### ⚠ "X resolves." still logs at the START of resolution — Bena to rule"
- R78: "follow — and the event is log-only (nothing dispatches on it), so moving it is"

**Resolution:** An owner-only presentation call. R78 leaves "X resolves." logged when resolution starts, and asks the owner to rule. No rule states it (rule D6.3 covers only what the board shows). Sign-off: keep the line as the heading of the effect lines under it (today), or log it only once the item has resolved.

## 4. Everything else (123)

### D-GL-1 · Other · rule 304.11

Glossary term with no defining rule: "Conjure". data/rules/Algomancy-Rules-Glossary.md uses the word, no numbered rule defines it, and no card in the pool prints it.

- file: data/rules/Algomancy-Rules-Glossary.md: "Conjure is a mechanic that creates a spell token that is cast at a specific time."

**Resolution:** The glossary keeps "Conjure" as an obsolete entry that says no rule defines it and points at rule 304.11, the nearest current rule. No rule is written for it: nothing in play uses it.

### D-GL-2 · Other · rule 802.1

Glossary term with no defining rule: "Devastating". data/rules/Algomancy-Rules-Glossary.md uses the word, no numbered rule defines it, and no card in the pool prints it.

- file: data/rules/Algomancy-Rules-Glossary.md: "Things like Deadly, Flying, Poisonous, Electric and Devastating."

**Resolution:** The glossary keeps "Devastating" as an obsolete entry that says no rule defines it and points at rule 802.1, the nearest current rule. No rule is written for it: nothing in play uses it.

### D-GL-3 · Other · rule 802.4

Glossary term with no defining rule: "Ranged". Rulebook 2023 p.12 uses the word, no numbered rule defines it, and no card in the pool prints it.

- Rulebook 2023 p.12: "Spike has the “Ranged” attribute, which allows it to deal combat damage first and block fliers."

**Resolution:** The glossary keeps "Ranged" as an obsolete entry that says no rule defines it and points at rule 802.4 and rule 802.2, the nearest current rules. No rule is written for it: nothing in play uses it.

### D-U01-1 · Sources disagree · rule 101.6a

The Manual says there is "zero information or interaction between regions". R243 says regions do NOT scope information: a player may read what happens in a region they are not in.

*Also filed as D-U10-1 (rule 601.8).*

- Manual p.19: "regions. This means there is zero information or interaction between regions."
- R243: "Regions do NOT scope information, but they do scope 'global' things (every"
- R91: "**the single rule we'll never violate is 'nothing can send information across"

**Resolution:** Settled without asking. The Manual sentence and Caleb's line in R91 each have two readings on their own, but Caleb was answering whether something can be done with units across regions, and Manual p.42 ("Each region treats the players and cards in other regions as if they don’t exist") is about what cards and players interact with. Read so, print and Caleb say what R243 says: no effect carries information from one region into another, while a player may watch any region (at a table every region is in plain view). rule 101.6a states that. A question only if the owner meant that a player must not learn what happens in a region they are not in.

### D-U01-11 · Sources disagree · rule 101.1

R157 says "Printed text always wins". Caleb says Crevice Lurker works against its printed word "Abilities" because his intent differs, so printed text does not always win.

- R157: "> *"Controller's cache — the printed text wins. Printed text always wins."*"
- RAQ 1366446116274442291#1: "So as written it wouldn't work but my intent is for it to stop those from triggering"

**Resolution:** The designer outranks R157 (authority order), so the rule scopes "always": printed text beats general rules and engine defaults, and yields only to the designer's stated intent for that card (rule 101.2). R157 was about print against defaults, so the two do not otherwise conflict.

### D-U01-14 · Other · rule 104.1a

Sources silent on whether R49's refusal of a lethal life cost looks at the printed amount or at the amount a life-loss multiplier would make the payer lose. The verifier reports the game can end mid-cost only through such a multiplier.

- R49 (its life-cost half): "⚠ **May a life cost be paid if it would kill you? No.** You may pay N life only"

**Resolution:** Belongs to 111 (U04). Question for the owner only if U04's sources are silent too: R49's words "pay N life" support (A) N is the printed cost, or (B) N is the life actually lost after multipliers.

### D-U01-2 · Sources disagree · rule 103.1f

The two printed editions set the game up differently. The Rulebook 2023 quick start deals 16 cards to the hand and 2 "Mana converters" in play. The Manual deals the 16 as 4 hand + 10 pack + 2 first draws, and the 2 prismites dormant.

- Rulebook 2023 p.2: "•Deal 16 cards and 2 Mana converters"
- Rulebook 2023 p.2: "x16 in hand"
- Manual p.11: "Deal each player 16 cards: 4 for their starting hand,"
- Manual p.11: "Deal 2 prismites to each player face down (dormant)."

**Resolution:** The rules state the Manual, which R17 (prismites start dormant) and R292 (opening hand 6 = Manual p.16's 4 plus turn 1's 2) both follow. The Rulebook's "x16 in hand" may only show where the 16 cards start before the first draft step combines hand and pack (Rulebook 2023 p.6), so the conflict may be smaller than it looks. Question for the owner only if a judge's CR follows the Rulebook 2023 setup.

### D-U01-3 · Other · rule 104.2

Sources silent on a game in which every remaining player is eliminated at once: whether it is a draw, and who wins. No printed, designer or ruling source speaks of a normal game ending in a draw.

- Rulebook 2023 p.1: "In order to win a game of Algomancy, you must eliminate all of your opponents by reducing their life total to zero. In team"
- R49 (its life-cost half): "reaching 0 ends the game inside `loseLife`, so paying at cast would hand the"

**Resolution:** No rule written. R49 describes an engine that ends the game when the FIRST life total reaches 0, which would decide a simultaneous loss by the order the life is taken, but that is a description of the code, not a rule. Cards that make every player lose life at once exist (Visage of Ruin: "each player loses half of their life total, rounded up"; Recall). Question for the owner only if a judge's CR rules on simultaneous elimination.

### D-U01-4 · Other · rule 104.1

Sources silent on whether a life total can go below 0. The printed rules say "bringing their life to 0" / "reducing their life total to zero"; nothing says what a total of -4 is.

- Manual p.6: "opponents by bringing their life to 0."
- R197 (its §1, predict your life total): "The floor is 0 and that is **not** a narrowing: `E.loseLife` ends the game the"

**Resolution:** The rule says "reaches 0". The verifier should check whether the engine also treats a total below 0 as eliminated (the 02-combat win-condition test reduces a player from 3 life with one attacker).

### D-U01-9 · Other · rule 100.4

The client plays two-player games only, so the printed rules for more than two players (the game continues after an elimination, neighbouring regions join, the eliminated player's pack is recycled, team wins) have nothing in the client to enforce or demonstrate them.

- R27: "**v1 formats**: 1v1 live draft + 1v1 constructed."
- Manual p.19: "neighboring regions move next to each other and the"

**Resolution:** Those rules (rule 104.3, rule 104.3a, rule 104.2a) are stated from print and will ship untested, with the reason that the client has no game of more than two players.

### D-U02-1 · Other · rule 105.1

The Manual says Algomancy has five elements. The client plays seven: the Light & Dark expansion adds two, and no printed rules page in the sources covers them.

- Manual p.8: "Algomancy consists of 5 Elements, which all offer different ways to play and interact"
- R54: "silently drop the bonus for wood, metal, light and dark, and keeping both would"

**Resolution:** Not a conflict of rules: the Manual predates the expansion. The rule states both counts. Every general rule in 105-106 that the Manual states for "the elements" is applied to Light and Dark too (for example the affinity Shard, R54); that extension has no printed source.

### D-U02-11 · Other · rule 107.2c

"X can't be zero" is printed on two kinds of X: Frosted Denial's mana cost and Instrument of Reassignment's activated ability. Only the first is a floor on playing the card; Instrument is played for a fixed [2] and can be played free (by Tides of the Cosmos).

- card: Frosted Denial: "X can't be zero."
- R339: "can't be zero" therefore has no legal free play, and Tides of the Cosmos does"
- R35: "than the smallest legal X ("X can't be zero" → 1) — the cast is ILLEGAL."

**Resolution:** No conflict. The rules here are worded for an X spell; a judge's CR that says "a card that prints X can't be zero" would wrongly bar Instrument of Reassignment from a free play. The engine agrees with the narrow reading (verifier probe).

### D-U02-4 · Sources disagree · rule 106.3a

The 2023 Rulebook starts each player with two Mana Converters in play that count as the turn's two resources. The Manual deals two Prismites face down (dormant).

- Rulebook 2023 p.7: "begins the game with two Mana Converters in play, which count as their two resources for the turn. They may be exhanged with other resources if desired or held"
- Manual p.11: "Deal 2 prismites to each player face down (dormant)."
- R17: "Prismites start the game **dormant** (Manual p.10 setup), can be expended for 1 mana"

**Resolution:** Both are printed. The Manual is the later edition and R17 follows it; the rule states the Manual. Mana Converter is the 2023 name for the Prismite.

### D-U02-5 · Sources disagree · rule 106.7

The 2023 Rulebook gives the affinity Shard when an elemental resource ENTERS PLAY, into the hand, to be played at once. The printed resource face and the Manual give it when the resource is ACTIVATED, and the Shard spawns dormant.

- Rulebook 2023 p.7: "All of the basic elemental resources have the ability “When I enter play, if you have at least three of my affinity, take a"
- card: Fire Resource: "When I activate, if you have at least [r][r][r], create a Shard."
- Manual p.18: "three affinity towards that resource."

**Resolution:** The printed card face and the later Manual agree; the rule states them. The 2023 Rulebook is kept only for the two points it alone states clearly and does not contradict: the activated resource counts toward the three, and the bonus repeats.

### D-U02-7 · Sources disagree · rule 106.8a

What an EXPENDED Prismite exchanges into. The card says the Prismite is erased and a new resource is created and then activated, which read literally is a fresh, un-expended resource. R17 says the new resource keeps the Prismite's current state.

- R132: ""Erase me: Create a non-prismite resource, **then activate it**. Do this only"
- R17: "resource of any element, keeping its current state ("players essentially get to pick"
- Manual p.18: "Sometimes it can be advantageous to delay exchanging them."

**Resolution:** Settled by the designer, for R17. Caleb (Discord rules-questions, 2024-07-23, calebgannon), asked whether Prismites can give 4 mana on turn 1, answered that exchanging a Prismite uses no activation, "However when you do that you're losing the prismite, so you can only ever have 2 total mana on the first turn". A fresh, un-expended resource after an expended Prismite would be a third mana, so the designer's stated intent outranks the literal "then activate it" (authority order: where Caleb states an intent that differs from print, follow Caleb), and R17's "keeping its current state" is the law. rule 106.8a states it (redrafted 2026-10-10 to say so outright). The engine agrees (413 sets an active Prismite expended, exchanges it, and the fire resource is still expended). No engine change, no register change. The first synthesis of this item ruled for the literal print reading; it had not seen Caleb's line, which is not a RAQ claim and so cannot be checked mechanically: it is in the rules-questions export under calebgannon on that date.

### D-U02-9 · Other · rule 107.1

Sources silent on general number handling: rounding, negative results, and what a card's own element is (the cards and the Manual's element pages show it; no text defines it). Cards that halve say their own rounding.

- card: Prophecy Bug: "It gains 'Prophecy — X Turns Pass', where X is half of its cost, rounded up."

**Resolution:** No general rule is written. 107 says only what the sources say; a card that needs rounding prints it.

### D-U03-12 · Sources disagree · rule 109.5a

The Manual says replacement effects don't use the stack. R102 (owner) puts the substitute of a replacement that names a target (Beyond, Codex Incarnate's rot clause) on the stack as a triggered ability, while the event itself is replaced at once.

- Manual p.41: "Instead” are called replacement effects. Unlike triggered abilities, replacement effects don’t use the stack"
- R102: "2. **A replacement that names a TARGET still uses the stack.** A target has to be"

**Resolution:** The rules follow both: the replacement itself never waits on the stack (R102 replaces the damage before anything is queued), and only a substitute that needs a target goes on the stack. Question for the owner only if the Manual's sentence is meant to cover the substitute too; then a target would have to be chosen with no stack, and Beyond's clause would not be respondable.

### D-U03-5 · Other · rule 110.5

Sources silent on whether a plain "target unit" can reach a unit in another region. R265 defines ally and enemy by region, and then reports an engine measurement that no unit target reaches another region; R12 says only that things exist in one region at a time.

- R265: "Claim 3 — ally and enemy are region-scoped"
- R12: "**Things exist in exactly one region at a time.**"

**Resolution:** No printed, designer or owner sentence states the rule for plain unit targets. The rule states R265's measured behaviour at medium confidence, as the owner's law. Question for the owner only if some card is meant to target a unit in another region.

### D-U03-8 · Other · rule 110.6

Sources silent on whether two different grafts in one graft composite may target the same object. R307 rules distinct targets only within one part, and says so. The RAQ treats the whole composite as a single effect.

- R307: "Not decided here: whether two **different** parts of a graft composite may"
- RAQ 1355115946032889914#7: "Triggered/Activated Graft is SINGLE effect on the stack"

**Resolution:** The rule states only the settled case (targets asked for together, as in Twin Flame). Question for the owner only if a composite with two targeted grafts is meant to be barred from naming one object twice: the RAQ's "SINGLE effect" would then extend the rule to the whole composite.

### D-U03-9 · Other · rule 109.9a

R113 says a bounded use is spent once the ability is put on the stack and that nothing hands it back after that; its own keep-list (and the engine) leaves the use unspent when a "you may" is declined or cannot be offered as the ability resolves, after it was stacked.

- R113: "the ability is activated, or when it is put on the stack.** Before that moment the player"
- R113: "Hexbane Shiitake declined, or never asked in the end-of-turn window; Murkdrop Distiller with nothing in the bin to cache"
- R113: "> "Its ability can only be triggered once per turn, but you can choose for each spell if"

**Resolution:** The rule follows the keep-list: a declined or impossible optional choice never spends the use, whenever it is made. Question for the owner only if the designer's "you can choose for each spell if you want to let it trigger and to put the ability on the stack" means the choice must be made before the trigger is stacked; then a decline at resolution would come too late and would spend the use.

### D-U04-11 · Other · rule 112.4

Sources silent on whether damage dealt to a player whose life total "can't change" still counts as damage dealt. R238 says the engine treats it as dealt but that this was never asked.

- R238: "  It now fires `combatFaceDamage` like any other damaged seat, because the"
- card: Suspend: "Target player's life total can't change during this battle."

**Resolution:** The rule states only the card's words. Question for the owner only if a card that triggers on damage dealt to a player meets Suspend.

### D-U04-5 · Sources disagree · rule 112.13c

R50 treats rot damage as an automatic charge that opens deployment, "not a trigger", and orders it before start-of-deployment triggers by its own ruling. The owner, quoted in R102's addendum, calls rot damage "a trigger to deal you that damage".

- R50: "charge, not a trigger — so a start-of-deployment trigger cannot pre-empt it."
- R50: "has settled. ⚠ That order is a ruling: nothing in the printed rules sequences"
- R102: "> instead, as or if and don't mention targets'. Plus, rot damage is a trigger to"

**Resolution:** The rule follows R50's order, which R102 itself keeps ("R50's ordering is preserved"). The owner's remark was a reason for letting Beyond's replacement use the stack, not a ruling on timing. Question for the owner only if a card can tell the two apart, for example one that taxes, copies or negates a trigger during deployment.

### D-U05-1 · Sources disagree · rule 200.1

The 2023 Rulebook and the Manual name the same card parts and steps with different words: threshold / affinity, health / defense, main phase / deployment, mana step / haste step, discard / bin.

*Also filed as D-U21-11 (rule 803.2a).*

- Rulebook 2023 p.3: "▪ Threshold (3) denotes how much affinity is required to play a card."
- Manual p.13: "Affinity: To have the ability to play a card, a player"
- Rulebook 2023 p.3: "▪ Stats (5) which denote power and health, respectively."
- Manual p.12: "Denote the power and defense"
- Rulebook 2023 p.3: "▪ Cards with no icon (9) can only be played during the main"
- Manual p.13: "Cards with no icon can only be played during deployment."
- R97: "So **the printed "mana step" IS this engine's R18 haste step**, and Dispatch Courier"
- Rulebook 2023 p.3: "▪ Cards with the haste icon (10) can be played during the mana step"
- Rulebook 2023 p.3: "with another player (and not during the main phase!)"

**Resolution:** Wording only; no rule differs. This document uses the Manual's words. R97 quotes Caleb that the Rulebook's "mana step" is the haste step. A judge's CR built from the 2023 Rulebook will say threshold, health, main phase, mana step and discard for the same things.

### D-U05-10 · Other · rule 204.5

The Manual calls Burst and Unstable attributes (purple, non-combat). This document numbers them under 803 (other keyword abilities), not 802 (attributes).

- Manual p.25: "Some attributes, like burst and unstable, are written in a"

**Resolution:** Numbering only. The outline follows the engine's attribute list, which does not include them. A judge's CR may number them as attributes.

### D-U05-11 · Other · rule 205.2

The sources are silent on whether reminder text has rules force of its own. They say it is there to help players remember.

- Manual p.24: "italics to help players remember what each attribute"
- R55: "text is **not** a marker — that is what keeps **Reconfigure**, a spell that"

**Resolution:** The rule says what reminder text is for and that a symbol mentioned in it is not a symbol. It does not say reminder text lacks force.

### D-U05-14 · Other · rule 209.2

The sources are silent on whether complexity has any effect during play. The 2023 Rulebook also calls the gold-symbol cards "rare" on one page and says the colour shows "complexity" on the next.

- Rulebook 2023 p.2: "all of the rare cards from the decks (gold set symbol). Shuffle the"
- Rulebook 2023 p.3: "denotes the complexity of the card."
- Manual p.12: "its color denotes the complexity of the card (gold ="

**Resolution:** The rule says only that complexity is used to choose cards for a game. It does not claim that no rule reads it.

### D-U05-2 · Sources disagree · rule 204.5

The 2023 Rulebook says units in a column share attributes, with no exception. The Manual says purple (non-combat) attributes such as Burst and Unstable are not shared in formation.

- Rulebook 2023 p.12: "Units in the same column of a formation share attributes, meaning that if Smoke"
- Manual p.25: "These attributes are not shared in formation, and simply"
- Rulebook 2023 p.12: "In addition to stats, some units have Attributes (1), which can change how they engage"

**Resolution:** The rule states the Manual. The Rulebook passage introduces attributes as those that "change how they engage in combat", so the two read together: combat attributes are shared, purple ones are not. No owner question.

### D-U05-3 · Sources disagree · rule 207.4a

Caleb answered twice. In a 2025-03-24 screenshot he said a Battle card that gains Haste can be played in the haste step; on 2026-01-25, in the same thread, he said it cannot.

*Also filed as D-U08-8 (rule 504.2a), D-U21-2 (rule 803.3a).*

- RAQ 1464899726796390433#0: "it's gotta be no"
- RAQ 1464899726796390433#1: "haste basically says 'This card can be played during the haste step in addition to its other timings' … so it should work"

**Resolution:** The designer's later answer reverses his earlier one, and the [Solved] Dispatch Courier write-up agrees with the later one. The register marks the 2025 claim outdated. The rule states the later answer. A judge's CR that cites the 2025 screenshot will disagree.

### D-U05-4 · RAQ open · rule 207.4a

Whether gaining Haste changes a banner play mode (Ambush, Prophecy) is only assumed in the thread, never answered.

*Also filed as D-U21-3 (rule 803.2b).*

- RAQ 1464899726796390433#2: "I assume that gaining :haste: doesn't affect 'playmode' like Ambush or Prophecy"

**Resolution:** Not stated as a rule: an assumption in a thread with no designer answer on the point. Question for the owner only if a card can grant Haste to a card while its banner mode is the play being made.

### D-U05-5 · RAQ open · rule 206.5

What happens to two base stats swapped by Body Swap when the Aberrant Statweaver that set one of them leaves play is open in the RAQ thread.

*Also filed as D-U16-3 (rule 709.6).*

- RAQ 1357965714807586897#2: "Ruling for this is still under consideration"

**Resolution:** Not stated. The rule says only that a later base rewrite wins while both apply. Question for the owner only if the designer does not rule.

### D-U05-7 · Other · rule 204.3

The sources are silent on what a subtype does in play. They say only which words are subtypes.

- R240: "spurious token is, by construction, a population-of-one subtype. The pool has twenty real"

**Resolution:** The rule says only what subtypes are. A card that names a subtype says what it does with it.

### D-U05-8 · Other · rule 206.2

The sources are silent on whether a spell has a power or defense. They say stats mark a unit.

- Rulebook 2023 p.3: "Units are permanents, meaning when summoned, they will stay in play until removed. They can be easily recognized by the existence of stats on the card (5)."

**Resolution:** The rule says only that stats mark a unit and that spell units have them. The card data gives 91 spells stat values: F-U05-1 (CT-244).

### D-U05-9 · Other · rule 203.1

The sources are silent on whether a "Discard me" line (Sacrifice Dude, Dropslime, Nothyr) is printed in an alternative-cost banner like Ambush and Prophecy.

- R65 (its discard-me half): "me"* line as an alternative play MODE, and inherited the card's own timing with"

**Resolution:** This document treats "Discard me" under 207.8 and 801, not 203, because discarding is not playing (R37, R65). Where it is printed is a question for the scans, not a ruling.

### D-U06-11 · Sources disagree · rule 305.1

Print says a modified card is treated as one card with its mods' text. Caleb's answer quoted in R89 says a mod on a spell gives it only attributes.

- Manual p.32: "When a card is augmented, it is treated as if it were a single"
- Rulebook 2023 p.15: "When a card is modified, it is simply treated as if it"
- R89: "you can only do this with attributes."

**Resolution:** The designer's words win under the authority order: the general rule stands for units, and a modified spell or spell token gains only attributes. Stated in rule 305.1 and in 721.

### D-U06-12 · Other · rule 300.1

Sources silent on a single list of card types. The printed books treat resources as cards ("RESOURCE CARDS", "non-token, non-resource cards") but describe units, spells and spell units separately.

- Manual p.5: "RESOURCE CARDS"
- Rulebook 2023 p.6: "During the draft step, players combine all of the non-token, non-resource cards in their hand with the pack and can draft a"
- Rulebook 2023 p.3: "There are also spell units, which have a one time effect like spells but"

**Resolution:** The rule scopes the three types to non-resource cards and points resources at 106. No source decides whether "resource" is a fourth card type or a category of its own.

### D-U06-2 · Sources disagree · rule 304.10

The Manual says a token that leaves play goes back to the token pile instead of the hand or bin. The designer (RAQ write-up) says a recalled or dying token enters the hand or bin and is then erased.

*Also filed as D-U07-1 (rule 410.5).*

- Manual p.15: "into the token pile instead of the hand or bin."
- Manual p.15: "erased from the game and returned to the token pile."
- RAQ 1355689559609839787#4: "3. Same applies to Unit Tokens being Recalled or Dying (they enter your hand/bin and then are instantly erased)"
- R69 (its zone-visit and timing halves): "Against `data/rules/Algomancy-Manual.txt:361-362`, which says tokens go to the token"

**Resolution:** The designer source wins under the authority order. The rule states the zone visit, then the erase. The erase itself agrees with print.

### D-U06-3 · Sources disagree · rule 301.4

The Manual calls a unit's second stat "defense"; the Rulebook 2023 calls it "health".

- Manual p.13: "damage they deal in combat as well as a defense value,"
- Rulebook 2023 p.3: "▪ Stats (5) which denote power and health, respectively."

**Resolution:** The same stat under two names. This document uses the Manual's word "defense", which is also what card text uses.

### D-U06-4 · Other · rule 301.6

The Manual Q&A answers "Can units that spawn during battle attack?" with "Yes! Algomancy has no summoning sickness", but Manual p.15 puts a unit that spawns during battle outside of formation, "not attacking or blocking".

- Manual p.43: "Q: Can units that spawn during battle attack?"
- Manual p.43: "A: Yes! Algomancy has no summoning sickness. As"
- Manual p.15: "of formation (meaning it is not attacking or blocking), but still in the same region."

**Resolution:** Both are stated. rule 301.6 states only that there is no waiting period; rule 301.7 puts a mid-battle arrival outside of formation for that battle. The Q&A is read as being about later attacks. No test shows a newly arrived unit attacking in a later battle round; the verifier should check.

### D-U07-11 · Other · rule 400.1

Print names a "token pile" that tokens return to. No ruling treats it as a zone. In this document a token that ceases to exist is recorded on the erased pile instead (R306, R69).

- Manual p.15: "erased from the game and returned to the token pile."
- R306: "unchanged: the `died` event still says `to: 'bin'`, anything reading the bin in"

**Resolution:** The token pile is the physical supply of token cards, not a game zone. Not listed in rule 400.1.

### D-U07-15 · Sources disagree · rule 410.1a

Does only a change of zone make a target fail? Caleb says things "only" fail to resolve when a unit changed location; the [Solved] "Valid targets becomes invalid" write-up says a target that became invalid fizzles, and R324 follows it.

- RAQ 1454169054402314362#2: "Things only wouldn't resolve if a unit changed to a different location (like went to your hand, the bin, etc)"
- RAQ 1355466429788328066#1: "If you did target something which was valid, but became invalid target then effect will fizzle on resolution."
- R324: "A target that fails is lost exactly like a target that left play. If every"

**Resolution:** Resolved without asking, both sources being tier 1: Caleb was answering whether a second effect aimed at a unit Organic Exchange also targets still resolves, where the unit stayed a legal target; the _passer write-up answers the case where a target stops being legal, and R324 encodes it. The rule states both. Question for the owner only if Caleb's "only" is meant to cover a target that is still in play but no longer legal.

### D-U07-2 · Sources disagree · rule 403.3b

The Manual says the virus ability "only works from hand". The designer's RAQ claim, and R311, let a glimpsed Virus be applied out of the cache during battle.

- Manual p.34: "as a virus again, since the virus ability only works from hand."
- RAQ 1537748882501668934#3: "A glimpsed Virus can be applied out of the cache during battle."
- R311: "functions 100% like the hand* except *for the fact that it's not considered your"

**Resolution:** Authority order: the RAQ beats print. rule 403.3b states the RAQ and R311. The Manual sentence still holds for the bin (rule 405.8a).

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

### D-U08-2 · Sources disagree · rule 502.3

Manual p.18 says the planning phase ends once everyone has created and activated resources, yet the same page puts the haste step after the resource step and p.27 lists the haste step as the fifth planning step.

- Manual p.18: "The planning phase ends when all players have created and activated their desired resources."
- Manual p.18: "After the resource step is the very short haste step, where players can only play"
- R97: "2. `legalActions`' `phase === 'planning' && s.hasteDone` branch — the client's affordance."

**Resolution:** This document reads the p.18 sentence as the end of the resource step and places the haste step as the last step of the planning phase (rule 504.1), per p.27 and the engine's phase model quoted in R97. No rules consequence found: nothing in the pack depends on whether the haste step is "in" planning.

### D-U08-4 · Sources disagree · rule 504.7

The RAQ write-up on Dispatch Courier says the unit is played "despite gaining" haste; R123 says a play "as if it had [Haste]" is timing only and the unit never carries the attribute.

- RAQ 1465292396664193171#0: "No, despite gaining :haste: they can still only be played during :battle:."
- R123: "it had [Haste]" is TIMING ONLY — the played unit never carries the attribute."

**Resolution:** The RAQ answers a timing question and its "gaining" is incidental wording; rule 504.7 states only the timing, which both sides agree on. Question for the owner only if a card ever reads whether a unit in play has [Haste]: then the RAQ wording (the authority) would say the granted unit has it.

### D-U09-10 · Sources disagree · rule 508.3a

The printed sources place the pack pass in two places. Manual p.16 and Rulebook 2023 p.6 have each player pass their pack clockwise when they finish drafting, ending the draft step. Manual p.26 and Rulebook 2023 p.5 list "any draft packs" as passed with the initiative when the turn ends.

*Also filed as D-U09-8 (rule 508.3a).*

- Manual p.16: "sure the pack contains 10 cards and pass it clockwise"
- Manual p.26: "The initiative token and any draft packs are passed to"
- Rulebook 2023 p.6: "Once you have finished a draft portion, you will pass your pack clockwise to the next player as an indicator that you are finished."
- Rulebook 2023 p.5: "After the main phase, the turn is over. The initiative and any draft packs are passed to the next player in a clockwise direction"
- Manual p.16: "player will draft a second time from the pack they were"
- file: client/engine/test/20-draft.test.ts: "no-op commit preserves hand and pack exactly; both commits pass the packs"

**Resolution:** One pass per turn, not two: the N+1 refresh cycle on p.16 (in 1v1 a player drafts from their first pack again on turn 3) only works if packs move once a turn. The CR follows the detailed draft section (p.16), which the client also does; the turn-end listing names the same pass. A pack is used only in the draft step, so the timing changes nothing a player can do. Not a question for the owner.

### D-U09-11 · Other · rule 507.2a

The designer says grafting is always a deployment action, whatever the card's speed. Slurpr prints a grant to apply other mods in the haste step as if it were deployment, and R95 reads "other mods" as grafts as well as augments (R37's word for both). The earlier draft of this rule said "never in the haste step" without the card exception.

- RAQ 1355115946032889914#0: "Yes. Always in deployment. No matter what cards speed is"
- card: Slurpr: "[Augment] You can apply other mods during [Haste] as if it was deployment."
- R95: "**"Other mods" is augments AND grafts** — R37's word for both — which is why `ctx.kind` is"

**Resolution:** No conflict once read as general rule and card exception: the RAQ answers a question about the card's own speed, and Slurpr is an explicit grant. The rule states the deployment default and the Slurpr-style exception; the engine agrees (verifier r2 probe). Not a question for the owner.

### D-U09-7 · Other · rule 506.2

R11 says regroup runs in a set order and takes the order from Manual p.7, with spell-token erasure added at the end. Manual p.26 lists the same five things with tokens erased fourth and formation left fifth, and it does not say the list is an order. R11 itself says to verify the order when it first matters in play.

- R11: "detailed regroup section confirms this exact sequence when it first matters in play."
- Manual p.26: "All Spell Tokens are erased"
- Manual p.7: "temporary stat changes are removed, and units"

**Resolution:** No observable difference is known, and the CR keeps R11's order. The R11 test checks only the end state (F-U09-2 (CT-241)), so nothing would notice if the order changed. Question for the owner only if a card is found whose outcome depends on the order.

### D-U09-9 · Other · rule 508.3

Sources silent on test coverage: no test asserts that the initiative changes hands between turns. The printed rule is plain; the gap is evidence, not law.

- Rulebook 2023 p.5: "teams trade off having the initative every turn"

**Resolution:** Done: 420-cr-battle-regroup-deploy.test.ts now asserts that the initiative passes when the turn ends and alternates back, and rule 508.3 is confirmed on it.

### D-U10-11 · Other · rule 602.2b

R172 rules on a one-sided theft mid-battle (Download): the stolen unit sits out until regroup. Sources are silent on a control EXCHANGE mid-battle; Organic Exchange's printed text also swaps the two units' positions, which keeps both in formation.

- R172: "It changes controller **immediately**, is **out of the formation for the rest"
- card: Organic Exchange: "Exchange control of two target units and swap their positions."

**Resolution:** Printed text governs the card: the effect that changes control itself gives each unit a position, so neither sits out. The rule states R172 as the default and the card's own positioning as the exception. The engine matches both.

### D-U10-2 · Other · rule 603.2a

Sources silent on whether a unit is adjacent to the enemy unit facing it across its column. The Manual's 'front and back neighbors' could name the other row of the unit's own column, or the opposing unit in front of it; R75 fixes the three positions inside one formation; a test comment calls a facing blocker 'an adjacent ENEMY'.

- Manual p.22: "adjacent to their left, right, front and back neighbors until"
- R75: "it's referring to its sides and above/below. Nothing diagonal."
- file: client/engine/test/18-earth-c.test.ts: "// an adjacent ENEMY"

**Resolution:** The rule follows R75: adjacency is within the unit's own formation. The Manual sentence describes one formation and its two rows, and Manual p.23 puts blockers 'in front of the formation that is attacking them', not in it. Question for the owner only if a card is meant to count the facing enemy as adjacent (Electric's 'directed to an adjacent unit' is the likeliest place; see 802.17). See F-U10-2 (CT-241).

### D-U11-11 · Other · rule 604.4

A declined attack fights no combat, but the engine still counts the round as a completed battle for 'One Battle Passes'. R43 says both battles in a turn tick it, without saying whether a round with no attack is one of them.

- R43: "battles in a turn tick "One Battle Passes" (Caleb 2024-09-24)."
- R194: "A declined attack fights no combat, so there is no"

**Resolution:** The rule says 'no combat', not 'no battle', so it does not contradict the engine's count. Question for the owner only if 'both battles in a turn' should exclude a battle round in which nobody attacked: the words support 'both battle rounds' and 'both battles actually fought'.

### D-U11-3 · Sources disagree · rule 607.2

Caleb said a unit put in as a blocker after blocks would be 'considered blocked even against an empty column'. R322 offers the late-blocker spot only for an attacking column that 'still has an attacker' and no block. Caleb's words support two readings.

- RAQ 1366447016653361192#1: "3.) I think it would be considered blocked even against an empty column."
- R322: "for every attacking column that still has an"

**Resolution:** Settled by context, not a question. Caleb was answering _passer's point 3, which asks about an unblocked column in the after-block window (R322 quotes it); "empty column" there means a column with no blocker. R322 encodes that, and the rule follows it. A column whose attackers have all died after blocks is a different case that no source addresses; it becomes a question only if a game reaches it.

### D-U11-7 · Other · rule 606.1e

Sources silent on whether one unit can block more than one attacking column. The printed text speaks of a unit placed in front of an attacking column; nothing says in words that a unit blocks one column only.

- Manual p.23: "Once a defending unit has been placed in front of an attacking column, that entire column is considered blocked."
- file: client/engine/src/apply.ts: "e.need(!used.has(id), 'a unit can only block in one column');"

**Resolution:** The rule states the printed half (a unit in front of a column blocks it) and the engine's half (one unit blocks one column only), basis mixed. Question for the owner only if one unit should be able to block two columns.

### D-U11-8 · Other · rule 604.2b

The Manual Q&A says 'as long as a unit is in play, it can attack/block'. Read literally, any unit could attack in the second battle round. The Manual's battle sequence and the Rulebook limit the second round's attackers to the units sent to counterattack.

- Manual p.43: "long as a unit is in play, it can attack/block."
- Manual p.20: "1. The NIT puts their attacking units into formation."
- Rulebook 2023 p.5: "so there are no additional counter attacks here."

**Resolution:** The Q&A answers summoning sickness; the round-2 pool is the more specific printed rule (rule 604.2f, R15). No change.

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

*Also filed as D-U19-8 (rule 802.2).*

- Rulebook 2023 p.12: "Similarly, Spike has the “Ranged” attribute,"
- Manual p.25: "Dune Drifter has the “Swift” attribute, which allows it to"
- Rulebook 2023 p.12: "which allows it to deal combat damage first"

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

### D-U13-7 · Other · rule 610.6

The sources are silent on which initiative-team region a counterattacker enters in a team game, and on whether a counterattacker may enter a region other than the attacker's. The Manual says only that the NIT attacks 'IT regions' in phase 2.

- Manual p.27: "1. NIT attack IT regions with units sent in Phase 1"
- Rulebook 2023 p.9: "• Then, combat in the counter-attacking regions is resolved."

**Resolution:** No rule is written beyond the order of resolution. Question for the owner only if the client is to support team games.

### D-U14-1 · Sources disagree · rule 703.3b

The Rulebook 2023 gives the combat damage step a priority window. The Manual lists only the attack, block and after combat steps, and the designer says the damage step has windows only between its sub-steps, when Swift or Sluggish units are present.

- Rulebook 2023 p.13: "block, damage and after combat steps all have a priority"
- Manual p.30: "followed by a priority window inside of each region:"
- RAQ 1363298910528864318#0: "Those windows are only present if there are any Swift/Sluggish units"

**Resolution:** Follow the designer (authority order). The rule states the Manual's three steps plus the sub-step windows of a split damage step; the Rulebook 2023 wording is recorded here.

### D-U14-12 · Other · rule 702.2d

R311 says the hand's timing-widening rules (R97/R123 haste grants, the battle {Virus} window, Ambush) apply to cached cards. The sources are silent on whether they also apply to a card played from a bin under a permission.

- R311: "own widening rules apply: R97/R123 haste grants, the battle {Virus} window,"
- R311: "Timing is the card's printed timing on both routes (R42/R45). A cached unit"

**Resolution:** Sources silent on bin plays. The rule states the cache case only. Question for the owner only if a bin-play permission and a timing grant ever meet on one card.

### D-U14-8 · Sources disagree · rule 703.3a

For a region with three players, the Manual p.36 says the player closest to the initiative player clockwise gains priority first. The Manual p.30 says the initiative player receives priority first, and the nearest player clockwise only when the initiative player is absent.

*Also filed as D-U22-3 (rule 903.6).*

- Manual p.36: "of back and forth. The player closest to the initiative"
- Manual p.36: "player in a clockwise direction gains priority first and"
- Manual p.30: "Within a priority window, first the initiative player will receive"
- Manual p.30: "region. If the initiative player is not present in the region,"

**Resolution:** The rule follows p.30, which addresses the order directly. Question for the owner only if a three-player region is ever supported: p.36 can be read as the initiative player first (being closest to themselves) or as the next player clockwise first. The engine is two-player only (R197 §3).

### D-U15-1 · RAQ open · rule 706.11

Whether Containment Protocol ("negate all activated and triggered effects") can negate the trigger-like attributes ({Alluring}, {Resonant}) was asked in a RAQ thread and never answered. Caleb answered only the Crevice Lurker half (the tax). R315 states that Containment Protocol can negate a {Resonant} rider, and the engine negates a waiting {Alluring} trigger.

*Also filed as D-U20-5 (rule 802.15q).*

- RAQ 1366446116274442291#2: "Whether Containment Protocol ("triggered effects") negates trigger-like attributes."
- RAQ 1366446116274442291#0: "my intent is for it to stop those from triggering"
- R315: "Crevice Lurker taxes it, and Containment Protocol can negate it."
- card: Containment Protocol: "Negate all activated and triggered effects."

**Resolution:** An open thread is not a ruling. The rule follows R315 and the engine (they are put on the stack as triggered abilities, so they can be negated), which is consistent with Caleb's answer on the tax. Revisit if the thread is answered.

### D-U15-12 · Other · rule 707.3

R104's owner sentence names only 'When'/'Whenever' and colons as what reaches the stack, but the Manual's timed triggers ('After combat'), the trigger-like attributes (R315) and a targeted replacement's substitute (R102) also reach the stack. The sentence is a heuristic, not an exhaustive list.

- R104: "> effects that go onto the stack are cards that say 'When' or 'Whenever' or have"
- Manual p.41: "Triggered abilities may also take place at specified times,"
- R315: "Crevice Lurker taxes it, and Containment Protocol can negate it."

**Resolution:** Printed text and the later rulings extend the owner's heuristic; the rule lists all of them. No owner question.

### D-U15-2 · RAQ open · rule 707.4

A RAQ follow-up asks whether a static that removes attributes (Monke) also removes attributes a unit gains after it began to apply, and was never answered in its thread. The answered thread says only that such statics affect units entering play later. The engine lets an attribute gained later (a Powerful virus) stand.

- RAQ 1355685844467581081#2: "_passer's follow-up: does Monke's static (unlike a resolved Suppression Field) strip attributes a unit gains later?"
- RAQ 1355845893219287132#0: "Monke and Transmogrifant have Static Abilities meaning they work continuously and affect new units entering play"
- file: client/engine/test/393-raq-mods.test.ts: "RAQ Transmogrifant: an attribute a unit gains AFTER it is in play is not affected"

**Resolution:** The rule states only what the answered thread says (it applies to units entering later, and ends when the static leaves). How a later grant interacts with the static is a timestamp question for rule 709; the open follow-up is recorded, not answered.

### D-U15-5 · Other · rule 708.11

Sources silent on two prevention effects on one unit (two Phytochemical Protections). R98 says nothing in the corpus addresses it; the engine treats the second as re-applying the first, so the unit gets one counter per damage prevented, not two.

- R98: "2. **Two Phytochemical Protections on ONE unit.** The shield is a single named flag, so the"

**Resolution:** No rule is written for the case. Recorded so a judge does not read the engine's behaviour as a rule.

### D-U15-8 · Owner call only · rule 706.12a

The owner ruled that several Wraith deployment triggers may "target the same unit" and the surplus fizzles. R144 reads "target" as an aim chosen when the trigger goes on the stack, which can fizzle, but not as a real target: it fires no "when I become targeted" ability and cannot be redirected.

- R144: "> stack simultaneously and be allowed to target the same unit, even exceeding"
- R144: "R144 grants **1 and 2** — which is exactly and only what the owner asked for —"

**Resolution:** Settled by printed text: the Wraith prints "put a -1/-1 counter on an ally", not "target ally", so the choice is not a target and fires no "when I become targeted" ability. R144's "target the same unit" is loose wording for what the owner asked (several Wraiths may choose one unit, and the surplus fizzles). The rule states that.

### D-U16-12 · Other · rule 713.6a

R278 settles only that units dying in one batch hear each other's departures. It explicitly leaves open whether a batch-mate is visible to targeting or to a count made during the batch, while stating that today it is not.

- R278: "Whether a batch-mate should also be visible to **targeting** or to a"

**Resolution:** The rule states the current answer at medium confidence. Question for the owner only if a card needs a dying batch-mate counted or targeted.

### D-U16-13 · Other · rule 713.5

The owner's words in R152 ("a token ... ceases to exist in all zones other than in play/stack whenever SBAs are checked"), read literally, would send a token mod through a bin before it ceases to exist. R69 says a token mod has no card of its own and never enters a bin. R152 records this as "reported, not resolved".

- R152: "The one place this ruling and R69 do not meet — reported, not resolved"
- R152: "R69 says the opposite for mods"

**Resolution:** The rule states the token sweep for token bodies; a token mod ceasing to exist is 410.4c (R69). Question for the owner only if the judge's CR sends a token mod through a bin.

### D-U16-2 · Sources disagree · rule 709.4d

The Manual lists Inverted as its own layer after the attribute layer, and R226 makes the result independent of grant order. Caleb, quoted in R93, said "Tough inverted balanced would be different" from Tough balanced inverted, which reads as Inverted taking a place inside layer 4.

*Also filed as D-U19-4 (rule 802.1j).*

- Manual p.42: "counters, 4. Attributes like Tough, 5. Inverted, 6.Unaware"
- R226: "Order-independence is the substantive claim"
- R93: "> **calebgannon:** "Tough inverted balanced would be different" … "It would survive as a 1/1""
- R93: "The engine ships the clean layer — it is the reading his own worked example uses, it is"
- R93: ""Tough inverted balanced is basically impossible to make happen."

**Resolution:** Not a question: the two readings differ only for a unit that gains Tough, then Inverted, then Balanced, and Caleb himself says that order is "basically impossible to make happen", because Tough and Inverted together kill the unit first (R93; R226: they leave defense 0). The rules follow the Manual's layer list (Inverted after all of layer 4), which every reachable board agrees with. Caleb's "Tough inverted balanced would be different" is recorded; if a card ever grants the three in that order at once, his interleaved reading applies, and R93 names the engine change.

### D-U16-5 · Other · rule 712.5

The sources are silent on a general dependency rule: how one continuous effect that changes whether another applies is ordered against it. They give only the layer order, timestamps within a layer, and one case (two static strippers whose sources strip each other).

- R328: "static-vs-static still resolves in one pass"
- Manual p.42: "A: Stats have 6 layers to them, which are applied in"

**Resolution:** No dependency rule is written. 709 states the layer order and timestamps; 712 states the two-strippers case. Recorded so the judge's CR, if it has a dependency rule, is compared against nothing rather than against an invented one.

### D-U16-6 · Sources disagree · rule 712.7

R341 says text a copy inherits is as old as the copy's printed text, so any strip takes it. The RAQ says an attribute or ability a unit gains after a strip is not taken. The two part only for a copy that begins on a unit already stripped.

- R341: "so it is exactly as old as the copy's printed text (R328)"
- RAQ 1355845893219287132#1: "if any unit in play later gains Attribute or Ability, then timestamps takes precedence"

**Resolution:** Not a question today. R341 and the RAQ agree for Borrower of Forms, which enters play already a copy. They part only for an until-regroup copy (Apex Prime) made on a unit already stripped by Suppression Field or Formless: the RAQ's "later gains" (designer authority) would let the copied text survive the earlier strip if becoming a copy is gaining abilities, and R341 says it is not. The rule states R341. A question for the owner only if that board arises.

### D-U16-8 · Other · rule 714.5

In the same RAQ thread, a source that has left play remembers its formation (Hooba-Bot, Hooba-Pon, Hooba-Lin, Embermaw Fledgling, Lumengrove Lurker), but Flamebreath Initiate counts 0 adjacent allies. The thread does not say why neighbours are not remembered when the formation is.

- RAQ 1353895783266516992#2: "But there are some which will remember they were in formation and will work fine"
- RAQ 1353895783266516992#3: "If Flamebreath Initiate is removed with his trigger on the stack, the X=0 so he will still make Fireball 1."

**Resolution:** Both designer answers are stated as given (714.4 and 714.5). Recorded so a judge's CR that remembers adjacency, or forgets the formation, is compared against both.

### D-U16-9 · Other · rule 714.1

The sources are silent on what an ability that triggers on its own source leaving play ("when I die") reads when it reads the source itself (its power, its attributes). R325 says such a trigger gets no last-known snapshot in the engine, and that no card in the pool needs one.

- R325: "A trigger queued *after* its source left play ("when I die") gets no"

**Resolution:** No rule written for it beyond the departure facts (714.9). Question for the owner only if a card is printed whose "when I die" ability reads its own stats or attributes.

### D-U17-12 · Sources disagree · rule 722.3a

Graft 101 says grafting is done only in deployment, whatever the card's speed. Spellbind's printed {Modular} reminder and R105 let any card, a graft card included, be applied to a Modular card as it is played, and Spellbind is a {Battle} card; the engine applies a graft card to Spellbind in battle.

- RAQ 1355115946032889914#0: "Grafting can only be done during Deployment Phase"
- card: Spellbind: "You can apply mods to a modular card from your hand and/or bin as it is played."
- R105: "> "I think it's legal to apply ANYTHING to a Modular card. But many cards wont"

**Resolution:** The specific printed permission wins over the general statement: Graft 101 is read as being about grafting onto a unit, and the rule lists Modular as an exception (722.3a). Question for the owner only if he reads Graft 101 as forbidding a graft card on Spellbind in battle.

### D-U17-14 · Sources disagree · rule 723.2b

The Manual says flatly that a Virus in a bin cannot be used as a mod during battle; Rook lets cards from the bin be augmented during battle as if they were Viruses, and names no exception for a card that already is a Virus. The engine lets a bin Virus be augmented in battle under Rook (r2 verifier probe).

- Manual p.34: "cannot be used as a mod during battle."
- card: Rook: "You may augment cards from hand and bin during battle as if they were [Virus]."

**Resolution:** The card's specific permission is read as an exception to the Manual's general note, and the rule says so; the engine agrees. Question for the owner only if Rook's "as if they were [Virus]" is meant to reach only non-Virus cards.

### D-U17-5 · Other · rule 722.3b

R95 left open whether Rook's battle permission covers grafting. Rook's printed text says "augment".

- R95: "3. **Does it cover GRAFT?** Printed text says "augment", `doGraft` is deployment-only,"
- card: Rook: "You may augment cards from hand and bin during battle as if they were [Virus]."

**Resolution:** Printed text answers it (R219: "If the printed text answers it, it is not a question"). The rule states that Rook does not permit grafting in battle. Graft 101 point 1 (grafting only in deployment) agrees.

### D-U17-6 · RAQ open · rule 722.4f

The RAQ fizzle thread records that Caleb is considering a change under which a graft effect resolves even when it has lost all its targets.

- RAQ 1354013430805434389#3: "Caleb is considering change of ruling for graft-targeting-fizzle, so even if it loses all targets it will still happen."
- R86: "> **A:** "**If effect loses ALL of its targets and wants to resolve.**""

**Resolution:** A possible future change, not a ruling. The rule states the current answer (R86). Revisit if Caleb rules.

### D-U17-7 · Sources disagree · rule 722.7d

The Amphivore thread says an unpayable multiplied cost means "you don't get the effect". R110 read that as only that graft; Graft 101 point 11 says the whole graft effect stays off the stack, and R334 applies that to the multiplied case.

- RAQ 1353859961855148103#5: "No Sacrifice at all and you don't get the effect."
- RAQ 1355115946032889914#10: "if you can't pay it (no units to sacrifice) then the whole Graft Effect won't go on the stack."
- R334: "This narrows R110. R110 skipped "that effect", meaning only the graft whose cost failed, and the engine treated grafted costs as opt-in riders. That opt-in was never backed by a ruling. Now:"

**Resolution:** Both are designer sources; Graft 101 point 11 is explicit and the Amphivore line fits it. The rule states the whole composite stays off the stack (R334). No owner question.

### D-U17-8 · Other · rule 722.7

Sources silent on a graft multiplier grafted under another multiplier (for example a Lost Guardian grafted under an Amphivore). R110 calls it unruled.

- R110: "Two multipliers in one composite (a doubler grafted under a doubler) multiply;"
- R110: "unruled, and unreachable in the pool without someone trying. Tests: 17-earth-b"

**Resolution:** No rule is written for it. Question for the owner only if a game reaches it.

### D-U18-12 · Sources disagree · rule 801.9d

Whose deck does a glimpse read when an effect makes another player glimpse? Caleb's words quoted in R157 §18 say "the deck" is the effect controller's; the reminder on Celestial Purge and Dematerialize says the glimpser reveals from "their deck". The engine reads the glimpser's deck. It only matters in constructed, where each seat has its own deck.

- R157 (§18): "> 'The deck' always refers to the deck of the effect's controller. The targeted"
- card: Dematerialize: "(They reveal the top three cards of their deck and cache one. Until end of turn, they may play it as if it was in their hand, ignoring affinity. Recycle the rest.)"

**Resolution:** No conflict. Caleb's rule is about the words "the deck" ("'The deck' always refers to the deck of the effect's controller"); the reminder on Dematerialize and Celestial Purge says "their deck", which names the glimpser's. The rule follows the reminder, and both agree on Big Glimpse Card, the card Caleb was asked about.

### D-U18-2 · Other · rule 801.2

No printed text in the current pool defines trashing, and no designer words are quoted for it. R40 credits its definition to Void Scavenger's reminder text (a card cut from the set) and to a Caleb ruling of 2025-02-01 that it does not quote.

- R40 (its bin-entry definition, for cards): "per-battle trash count is required (Dropslime, Muck Rummager). (Printed: Void"
- R40 (its bin-entry definition, for cards): "Scavenger reminder text; Caleb 2025-02-01; broadened by Bena 2026-08-19.)"
- card: Dropslime: "When I am trashed, [Switch1] I deal damage equal to the number of cards trashed in this battle to any target."

**Resolution:** The trash rules carry basis owner. Fourteen cards print trash text without defining it. If Caleb's 2025-02-01 words can be found in the Discord export, add them as a designer source. Question for the owner only if a judge's CR defines trashing differently (for example, only for cards entering the bin from play).

### D-U18-3 · Other · rule 801.2a

R40 lists "milling" as a way of trashing, but no card prints "mill" and no printed or designer source defines it. In this client a card goes from the deck to a bin through rot and debt.

- R40 (its bin-entry definition, for cards): "Discarding, sacrificing, milling and dying in combat all trash. A spell or"
- R306: "An Unstable CARD still is (R137). Rot and debt trash cards from a deck or hand,"

**Resolution:** The rule keeps the word because a card moved from the deck to a bin does enter a bin from outside the stack, which is the definition. Define "mill" in the glossary as "put from the deck into the bin" if a judge's CR uses the word.

### D-U18-6 · Other · rule 801.11

Sources silent on whether the two hits of a fight are simultaneous, so that a unit killed by its opponent's damage still deals its own. Print says only "They deal damage to each other". R80 makes a fight two damage batches, one per fighter, and checks deaths once per batch.

- card: Fight: "(They deal damage to each other equal to their power.)"
- R80: "**different sources** (each unit deals its own damage), and a batch is per"
- R80: "- **deaths are checked once**, after all of it is marked, which is what"

**Resolution:** rule 801.11 states only the printed text. The engine's test (16-earth-a, "mutual power damage") has both units deal their damage. Question for the owner only if a judge's CR rules that the first fighter's damage can kill the second before it strikes.

### D-U18-7 · Other · rule 801.9

Sources silent on a glimpse of more cards than the deck can supply. The engine's test glimpses nothing from an empty deck; 408.2b says the recycle pile becomes the new deck when more cards are needed.

- R45: "Glimpse N reveals the top N cards of the deck, caches exactly **one** of the"
- file: client/engine/test/36-cache-prophecy.test.ts: "// an empty deck glimpses nothing rather than throwing"

**Resolution:** No rule written. The test empties the deck from inside the engine, with no recycle pile to fall back on, so it does not show what happens at a table. Question for the owner only if a judge's CR rules on it: does a glimpse that runs past the end of the deck shuffle the recycle pile in (408.2b) and keep revealing, or reveal fewer?

### D-U19-11 · Other · rule 802.12

Sources silent on whether a Feeble unit may attack or be sent to counterattack. The printed reminder restricts only blocking.

- glossary: Feeble: "Feeble units can't block."
- card: Spectrogenesis: "They are 0/1 units that can't block"

**Resolution:** No rule is written beyond "can't block". The literal reading (Feeble restricts nothing else) is the permissive one; question for the owner only if a comparison CR restricts attacking.

### D-U20-1 · Other · rule 802.13

Six attributes in this unit (Evasive, Sneaky, Alluring, Resonant, Thieving, Reaping) print their reminder only under the type line. The oracle text and the extract do not carry it, so the quote checker cannot verify the reminder sentence each 802.N rule states; those rules cite the rulings and RAQ claims that restate it instead.

*Also filed as D-U19-7 (rule 802.1a).*

- file: client/ui/scan-reminders.json: ""text": "Evasive units require two blockers.", "card": "Curio Drifter""
- file: client/ui/scan-reminders.json: ""text": "Sneaky units can't be blocked if attacking alone.", "card": "Whispering Mantid""
- file: client/ui/scan-reminders.json: ""text": "When an alluring column attacks, target enemy can't attack and must block it this combat if able.", "card": "Tempest Wrangler""
- file: client/ui/scan-reminders.json: ""text": "Whenever a resonant source deals damage to a unit, it deals that much damage to that unit's controller.", "card": "Resonant Form""
- file: client/ui/scan-reminders.json: ""text": "Whenever a thieving source deals combat damage to an opponent, draw a card.", "card": "Slink""
- file: client/ui/scan-reminders.json: ""text": "When a reaping source kills one or more units, draw a card. It loses reaping until regroup.", "card": "Flame of History""
- file: client/ui/scan-reminders.json: "Tough units have their defense doubled."
- file: client/ui/scan-reminders.json: "Vulnerable cards receive double damage."
- file: client/ui/scan-reminders.json: "Feeble units can't block."
- file: client/ui/scan-reminders.json: "Unaware cards and units they are interacting with ignore all stat changes."

**Resolution:** Tooling: let the extract fold client/ui/scan-reminders.json into each card's checkable text (or accept a scan reference as a printed source), then re-cite the six definitions as printed. The sentences themselves were read off the scans (R283 for Reaping).

### D-U20-10 · Sources disagree · rule 802.19h

Crevice Lurker prints "Abilities cost [one] more to activate or trigger"; Alluring and Resonant are attributes, not abilities, so read literally it does not tax them. Caleb says his intent is that it does.

- card: Crevice Lurker: "[Augment] Abilities cost [one] more to activate or trigger during battle."
- RAQ 1366446116274442291#1: "I think crevice lurker should say 'Effects cost 1 more to activate or trigger'. So as written it wouldn't work but my intent is for it to stop those from triggering"

**Resolution:** Follow Caleb (the authority order: where Caleb states an intent that differs from print, follow Caleb). The document says Crevice Lurker taxes both triggers.

### D-U20-15 · Other · rule 802.17

Sources are silent on Electric combat damage. The printed reminder speaks of "electric sources", which on its face includes a column, but no ruling or RAQ claim covers it, and no unit in the pool can have Electric: Envoy of Lightning grants it to spell effects only, and Arc Lightning is a spell. The pilot verifier recorded that the engine ignores Electric in combat.

- card: Envoy of Lightning: "[Augment] Your spell effects with a single target are {g}Electric."
- card: Arc Lightning: "{Battle} {Electric} Elemental Spell"

**Resolution:** No rule written. Question for the owner only if a card ever lets a unit have Electric.

### D-U20-16 · Other · rule 802.20a

Sources are silent on whether Thieving's draw is a triggered ability that uses the stack (and so can be negated or taxed) or happens as part of combat damage. The reminder reads "Whenever …, draw a card".

- file: client/ui/scan-reminders.json: ""text": "Whenever a thieving source deals combat damage to an opponent, draw a card.", "card": "Slink""
- R24: "damage to a player** in a damage sub-step (unblocked or Piercing overflow), not one per"

**Resolution:** No rule written on timing. Question for the owner only if Crevice Lurker or a negate is used against a Thieving draw in play.

### D-U20-17 · Other · rule 802.24a

No source says what it means for Lethal to "kill a player": whether the player is eliminated outright, or loses life equal to their life total (which a life-loss multiplier or a "life can't change" effect could then alter).

- card: Gublin: "(Any combat damage from a lethal unit will kill a player.)"
- R166: "{Piercing} carries excess to the PLAYER, {Lethal} kills a player outright,"

**Resolution:** The document states the printed words only. Question for the owner only if a life-total lock (rule 112.4) or a multiplier meets a Lethal hit.

### D-U20-19 · Other · rule 802.25k

No source applies R294's column sharing to Pure outside combat. The rule is derived: R294 makes both sides of a noncombat damage pairing read column-shared attributes, and Pure is an attribute.

- R294: "adjacent) share all of their attributes."* So both sides of a non-combat damage"
- R289: "- **A Pure recipient takes plain damage from anyone.** The source's attributes"

**Resolution:** Rule written as derived (basis owner, confidence medium). Question for the owner only if a judge disputes it.

### D-U20-22 · Other · rule 802.24d

Sources are silent on Lethal when combat damage to a player is prevented. R98's prevention ruling covers damage to units only, and no card in the pool prevents damage to a player, so the engine has no path for it. The rule was removed rather than derived by analogy.

- R98: "So a fully prevented hit produces **no `damage` event** ("whenever I am dealt damage" stays"
- R98: "{Lethal} still kills through it"*. **Replacement is a substitution; prevention is a"

**Resolution:** No rule. Question for the owner only if a card that prevents damage to a player is ever printed.

### D-U20-23 · Other · rule 802.16p

Since R319 the attacker may keep Piercing excess on a unit it strikes. No source says whether the same elective keep applies when the hit is redirected into Oorblak; the engine's redirect absorbs exactly lethal (1 if Deadly) and passes the rest on, with no choice (round-1 verifier).

- RAQ 1397188292239163454#0: "he takes 4 damage which is enough to kill him and leftover 6 damage is still Piercing so it goes to players face"
- RAQ 1353888077625561108#5: "You may still overkill front or back units, however with Piercing any excess damage you won't assign to front or back unit will be assigned to Opponent Health."

**Resolution:** The rule follows the Oorblak RAQ (exactly lethal into Oorblak, the rest to the player). Question for the owner only if a player asks to overkill a redirect target: the overkill RAQ speaks of units the attacker assigns to, and Oorblak is dealt the hit by its own replacement, not assigned it.

### D-U21-10 · Other · rule 803.5a

R81 quotes "The Rules of Algomancy" as saying burst spells "of the same type"; the Manual and the Rulebook 2023 both say "same name". R81 reads "type" as name.

- R81 (its name-grouping half): "the same type** at the same time"* (The Rules of Algomancy, spell tokens)."
- Manual p.15: "same name at once."

**Resolution:** The rules follow "same name". A judge's CR that groups by "type" (for example, all spell tokens) would disagree with 803.5a.

### D-U21-4 · Other · rule 803.5

Sources silent on a Burst group in which one token has no legal target. Burst requires every token of the name to be cast at once ("all or nothing"), but nothing says whether the group may then be cast with that token left out, must wait, or cannot be cast at all.

- Manual p.15: "Requires the player to"
- R309: "all tokens (of the same name) onto the stack at once … It's all or nothing"

**Resolution:** No rule is written for this case. Question for the owner only if a judge's CR or a playtest raises it; the verifier may record what the engine does.

### D-U21-9 · Sources disagree · rule 803.8a

The printed reminder has no zone limit: any card that would enter a bin is erased. Caleb's glossary line adds "from an active zone", so an Unstable card discarded from the hand or milled from the deck is binned normally.

- card: Abyssal Evocation: "{i}(If they would enter a bin, erase them instead.)"
- R145: "> `"Unstable": "If an unstable card would enter a bin from an active zone,"

**Resolution:** The designer's narrower wording governs (authority order: Caleb's stated intent over print). In practice the two printed granters only grant Unstable to cards being played, so the difference shows only on Oorblak and Aberrant Statweaver in a hand, deck or cache.

### D-U22-1 · Sources disagree · rule 902.8

The two printed editions size the team-draft deck differently. The Manual has each team bring 30 cards per player on the team (90 for 3v3); the 2023 Rulebook has each team build a 100-card deck. Both cap copies at 2.

- Manual p.6: "including 30 cards per player on the team with up to"
- Rulebook 2023 p.1: "• Team draft: Your team builds a large deck of 100 cards and a maximum of 2 copies of each card ahead of time and your team"

**Resolution:** The rule states the Manual: it is the later edition and supersedes the 2023 Rulebook where they differ (data/rules/README.md). The Rulebook's 100-card deck is kept as the labelled sub-rule 902.8d. No owner question; the client has no team draft.

### D-U22-10 · Other · rule 901.7b

The owner said the client's "shared" testing mode "I guess it'd be constructed?". R162 applied that to card text only (Worldbender's branch); a shared game still has no constructed draw phase (draw 4, put back 2), only a flat draw of 2, and its turn-1 hand differs (7 cards in the test title, against constructed's 4 + 4 − 2).

- R157: "> *"Shared mode isn't a real thing. You invented it for testing. So I guess"
- R162: "Shared has no draft step and no draw phase, so its card step is the flat"

**Resolution:** The rule states the narrow reading R162 implemented: shared counts as constructed where card text asks. Shared is a testing mode, not a format a player chooses, so no owner question unless shared games are ever offered to players.

### D-U22-11 · Other · rule 903.5a

Sources silent on how one player defends against two attacking formations in one region: whether they set one blocking formation or one per attacker, how columns face two formations, and how combat damage is assigned between them.

- Manual p.36: "battle together in one region. The defending player now is able to defend against the two incoming"
- Manual p.36: "attacking formations, and all three players are able to"

**Resolution:** The rule says only that the defender defends against both. A judge's CR may fill this in; nothing in this project's sources does, and the client cannot reach it.

### D-U22-2 · Sources disagree · rule 904.12

The two printed editions give the single player of a 2v1 archenemy game different advantages. The Manual gives them 1–2 turns before the other two begin; the 2023 Rulebook gives them bonus cards and resources against two weaker opponents. Neither says how many turns, cards or resources.

- Manual p.6: "take 1-2 turns before the other 2 begin the game."
- Rulebook 2023 p.1: "• 2v1: An archenemy style game where one player with bonus cards and resources faces off against two weaker opponents."

**Resolution:** The rule states the Manual (later edition) and keeps the Rulebook's version as a labelled sub-rule. The details are unwritten in both: a casual setup, not a format the client offers.

### D-U22-4 · Other · rule 905.1

Sources silent on the intent cards themselves: which intent cards there are, what actions they can show (attack left, attack right, stay home?), and what happens to a unit with no intent card in front of it.

- Manual p.37: "of their units and other cards such as spell tokens with their intended action. Once all players have"
- Rulebook 2023 p.9: "There is a lot of freedom in how you can do this, so feel free to get creative. You can group units together behind one intent card"

**Resolution:** The rules state only the procedure the books print (905). The intent cards are physical components; their faces are not in the printed text this project holds. The client has no FFA, so nothing depends on it.

### D-U22-5 · Other · rule 904.2

Sources silent on how joint players work: a team sharing one region is "effectively a 1v1 game with more players", but no source says whether the team shares a life total, a deck, a hand or resources, or how its players divide control.

- Manual p.6: "a single region (effectively a 1v1 game with more"

**Resolution:** The rule states only that the option exists. Everything else in 904 is written for split teams.

### D-U22-6 · Other · rule 902.2a

Sources silent on how elements are chosen competitively: the Manual gives a casual method and defers the competitive one to Algomancy.io, which is not among this project's sources.

- Manual p.11: "In casual games, players can alternate choosing elements to include in the game or assign them randomly. For the most up to date competitive rules for this"
- Manual p.11: "process, please see Algomancy.io."

**Resolution:** The rule says what print says. How the client picks a trio is Annex D.

### D-U22-7 · Other · rule 901.2

Sources silent on two deck-size limits: no source sets a maximum constructed deck size, and none says whether a deck drafted in a cube draft (or pre-draft) must obey the constructed limit of 2 copies; a cube built from two complete sets can yield more.

- Manual p.6: "of each card, with a minimum deck size of 30."
- Manual p.39: "Players then use these 30 card decks they have drafted for constructed matches."
- Rulebook 2023 p.1: "• Pre-Draft: You draft a complete deck of a minimum 30 cards before the game begins, and play games of constructed with it."

**Resolution:** The rules state the minimum only, and leave the cube copy question open. The client has no cube draft; its constructed deck check sets no maximum size.

### D-U23-10 · Sources disagree · rule D2.8a

The owner's first message names Organic Exchange among the cards that should warn; his later derivation ('target ally AND target unit on the same card') excludes it, since it prints two target units with no ally slot.

- R288: "> of your own units (Fight, Organic Exchange). We shouldn't stop that from"
- R288: "⚠ **THE OWNER'S TWO MESSAGES DISAGREE ABOUT ORGANIC EXCHANGE, and the later one"

**Resolution:** R288 follows the later message, and so does the rule. Organic Exchange's case is a known no-op warning (R74), not this confirmation.

### D-U23-12 · Other · rule D2.5

R228 parks R224's requirement that passing through the always-open haste step be cheap, as not yet met. R236 met it the same day. R228 still reads as owing it; the register already flags the warning as stale.

- R228: "⚠ **R224's own requirement is NOT yet met**: *"an always-open window is a tax on"
- R236: "This makes it cheap. Nothing in `engine/src/**` was touched: the step's"

**Resolution:** No rule change. Register note only: R228's 'Parked, and owed' section was discharged by R236.

### D-U23-14 · Other · rule D2.2

R245 leaves 'what should stop Pass All' to the owner. R251 is the owner's answer (three buttons). R245's open section still reads as open; the register already flags it as stale.

- R245: "**#123 "Pass All still isn't working right" is a DESIGN question, and the"
- R251: "by the owner on the round-31 sheet (Q6) after R245 established that the code was"

**Resolution:** No rule change. The rules state R251. Register note only.

### D-U23-15 · Other · rule D2.5

R236 §6 limits the auto-ready to the online client and justifies that by hotseat. Hotseat has since been removed (R170's amendment), and Learn to Play and the replay viewer now run a server inside the page over the ordinary network path. Sources silent on whether the haste auto-ready applies in Learn to Play.

- R236: "`planAutoPass` is `NET`-gated, so this changes nothing in hotseat. Deliberate:"
- R170: "### ⚠ AMENDED 2026-09-23 — HOTSEAT IS GONE; THE RULING IS NOT"

**Resolution:** The rule states no scope limit. Leave it to the verifier to measure whether Learn to Play auto-readies.

### D-U23-20 · Other · rule D1.1

Sources silent on whether the annex's presentation and confirmation conventions are rules. R150 says only of its own pacing/concurrency reports that they are not a rules change; nothing extends that to the rest of the annex.

- R150: "**CT-32** (#98). Both are pacing/concurrency, neither is a rules change, and"

**Resolution:** The rule is narrowed to pacing and concurrency. Whether presentation and confirmation conventions are likewise not rules is a question for the owner only if the export needs D1 to say so.

### D-U23-5 · Owner call only · rule D2.5e

R18 defines a hidden segment as one where nobody sees the other side's plays until everyone is done. R236 measures a residual channel, the live action counter, that tells a modified client when its opponent acts in every hidden segment. R236 leaves closing it to the owner.

- R18 (its hidden-segment half): "false: the haste step is a **hidden simultaneous segment** — nobody sees the"
- R236: "`GameState.actionCount` is served live to both seats and increments on **every**"
- R236: "`server/rooms.ts`** — both off limits this round, and a call for the owner. The"

**Resolution:** Decided by the owner: the residual channel is F-U23-3, which maps to CT-106, closed as wontfix (2026-08-29: "I am not worried about this"). The rule states the residual as R236 measured it. Nothing to ask.

### D-U24-1 · Other · rule D6.8

The outline gives Annex D part 2 three sections (D6 reveal timing, D7 confirmations and misclicks, D8 tutorial and single-card modes), but the unit's rulings also cover how the client draws cards and the board, its menus, its resource menu, custom rules, scenario rooms and how concessions count. Sources are not silent on these; the outline has no section for them. They are drafted under D6 (display, after the reveal rules), D7 (warnings and announcements) and D8 (custom rules, scenario rooms, concession weight).

- file: data/comprehensive-rules/outline.json: ""title": "Reveal Timing of Simultaneous Steps""
- file: data/comprehensive-rules/outline.json: ""title": "Tutorial and Single-Card Modes""

**Resolution:** Question for the orchestrator only if the outline should grow sections (for example D9 Display and D10 Records and ratings). If it does, the display rules and the custom-rules, scenario and concession rules (from rule D8.3 on) can move under the new sections without changing their text.

### D-U24-10 · Other · rule D7.3

Sources silent on whether a clause that does nothing, outside R209's class (a per-seat promise over an empty collection), must be announced when another clause of the same effect speaks. R209 also records that the whole-pool sweep can only convict a wholly silent run, so half-silent effects are guarded only member by member.

- R209: "> **A printed clause that promises a per-seat outcome and then resolves over an"
- R209: "not a gap to widen; it is a limit to write down, and to cover somewhere else."

**Resolution:** The rule states R187 for a whole effect and R209 for its stated class only, and does not generalise to every clause.

### D-U24-4 · Owner call only · rule D6.9a

R151 substitutes a token's live X into its text box but leaves the card's "modified" badge off, and says the badge question is the owner's to decide.

- R151: "`CardTextBox.modified` stays **false** for a specialised token. It is the flag"
- R151: "call and not something R151 should have made on the side."

**Resolution:** Question for the owner only if a specialised token (a Poison 5) should wear the "modified" badge. The rule does not mention the badge.

### D-U24-6 · Other · rule D7.1b

Three rulings this unit's sections need are classified to U23, not U24, so they were not in this unit's pack: R288 (the misclicked-ally question, D7), R236 (haste readiness hidden while the step is open, D6) and R194 (the confirm before a pass reaches Regroup, D7, quoted here through R266). They were read from digital-rules.md. U23 may state the same facts under D2-D5.

- R288: "**IT IS A QUESTION, NEVER A FILTER.** The owner says it twice — *"we shouldn't"
- R236: "who is ready stops being public while it is open"

**Resolution:** At assembly, keep one statement of each fact: the D7 confirmation rules here, and whichever unit's haste-readiness rule reads better. Classification could add U24 to R288 and R236.

### D-U24-7 · Other · rule D6.15

Some of this unit's digital rulings are about how the client is built or tested, not about a convention a player or judge meets. They are not drafted as rules: R192 (which click opens the cache panel), R205 (the test driver's DOM model), R230 and R272 parts a-b (hover tooltips and image sizing), R255 (arrowhead placement), R274 (a join error on the connecting screen), R206 and R281 (how the glossary is audited), and R209 sections 2 to 6 (how guards derive their lists). Their game halves, where they have one, belong to other units.

- R205: "> **A fake that answers a question about the DOM must model the part of the DOM"
- R230: "the hover tooltip cancelled itself: a scroll hides it only if it could have MOVED the card"

**Resolution:** No action unless the owner wants Annex D to describe client mechanics too. Annex P will list them as uncited.

### D-U24-8 · Other · rule D6.9e

R246 was asked for "all cards with an X in them" and makes a board-read X public on the stack as a forecast, but records that eighteen cards whose X is read from the board at resolution have no forecast and show nothing. The rule therefore states the forecast only for cards that declare one, and states the gap separately.

- R246: "The owner's quantifier — "all cards with an X in them" — is 45 cards. Four"
- R246: "cards are left: their X is read from the board at resolution and only a card"

**Resolution:** Recorded as shipped: the forecast covers cards that declare one. Question for the owner only if the eighteen listed cards are meant to gain a forecast; the rule text would then lose rule D6.9e.
