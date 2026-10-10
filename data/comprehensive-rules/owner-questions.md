# Algomancy Comprehensive Rules: Questions for the Owner

15 questions. In each, the authoritative source's own words support two readings and no higher source decides between them; everything else in discrepancies.md is already decided by the authority order or awaits sign-off there. Answer each with one line: the reading you choose. Each item's full record, with every quote, is in discrepancies.md under its id.

## Resources and affinity

### 1. Does a dormant (face-down) resource count toward affinity?

*D-U02-2, rule 105.4c.*

- RAQ 1358299200953126963#0: "The affinity dots just require you have at least that many resources of that type somewhere in your manabase"
- Manual p.12: "Resource types needed to be present among your resources"
- R151: "counts what is **awake** ("dormant gives no affinity"; "expended still counts")."

- **A.** Yes: every resource you have counts, face-down ones included ("somewhere in your manabase"). *At the table:* A resource created this turn counts toward affinity before it is activated, so a player may meet [r][r][r] with one active and two dormant fire resources.
- **B.** No: only resources whose type is showing (active) count. *At the table:* As today: a dormant resource gives nothing until it is activated.

**Today:** B, the engine's behaviour (basis engine, low confidence). R151 only quotes the engine.

**Recommended:** A. Caleb puts no condition on the resource ("You don't care if it's tapped or not"), and A is the permissive reading. Take B only if a face-down resource's type is meant to be unknown at the table.

**Answer:**

## Triggers and the stack

### 2. When a graft (or a deployment augment) is applied to Mohruung, is the Crystal made before the mod attaches?

*D-U03-13, rule 110.11; also filed as D-U03-14 (rule 110.11), D-U17-13 (rule 722.3c).*

- RAQ 1355115946032889914#4: "Applying Graft is 'targeting' effect, so if you try to Graft something underneath the Mohruung, he will trigger first"
- R53: "the stack **above** the spell that targeted — the trigger resolves first."
- file: client/engine/src/apply.ts: "e.fireEvent('targeted', ev);   // grafting is targeting (Graft 101 §5)"
- card: Mohruung: "When I become targeted, [Switch1] Create a Crystal 2."

- **A.** Yes: "he will trigger first" means the trigger resolves before the graft is applied. *At the table:* The Crystal exists before the graft attaches, so a graft that counts or reads units sees it; engine change, CT-242.
- **B.** No: the trigger only fires first; the graft attaches, then the Crystal is made. *At the table:* As today; CT-242 closes as not a bug.

**Today:** A (rule 110.11); the engine does B.

**Recommended:** A. A graft has no stack item, so "trigger first" says something only if the trigger resolves first. Apply the same answer to an augment applied in deployment (D-U03-14).

**Answer:**

### 3. Does Bloomcaster's "Whenever you play a unit" trigger on its own play?

*D-U14-11, rule 701.1e.*

- R26: "Bloomcaster's "[Augment] Whenever you play a unit" (no "another") **fires on its own"
- RAQ 1353862592661164152#0: "He goes on the stack (but is not Spawned / In play yet)"
- card: Bloomcaster: "Whenever you play a unit"

- **A.** Yes: it prints no "another", so its own play counts (R26). *At the table:* Playing Bloomcaster makes a 1/1; engine change, CT-254.
- **B.** No: a card's abilities work only once it is in play, and a card being played is on the stack (the Mycelial Mentor write-up), so only units played while Bloomcaster is in play count. *At the table:* As today; CT-254 closes as not a bug.

**Today:** A (R26), marked engine-differs.

**Recommended:** A: the literal text, the pool's use of "another" for not-me (R265) and the permissive steer all point there; the Mentor write-up answers a different question.

**Answer:**

### 4. Is a deleted unit a unit that dies, so that "When I die" and "whenever a unit dies" trigger?

*D-U18-9, rule 801.5.*

- Manual p.13: "a unit dies or is deleted, it is placed in the bin (discard"
- R70: "| `verb` | `dies` / `is deleted` / `is sacrificed` |"
- card: Unstable Singularity: "When I die, [Switch1] Delete target unit."

- **A.** Yes: deletion is one way of dying, named separately because cards say "delete". *At the table:* As today (the engine fires the death event).
- **B.** No: dying and being deleted are two events that end in the same bin. *At the table:* Death triggers ignore a deletion; Unstable Singularity's "When I die" would not fire when it is deleted.

**Today:** Neither: rule 801.5 states only where the unit goes. The engine does A.

**Recommended:** A, the permissive reading, which the engine already plays.

**Answer:**

### 5. Do abilities triggered by one rockfall resolve before the next rockfall of the same Meteor Shower?

*D-U18-4, rule 801.12c.*

- RAQ 1353899470156206152#2: "any check for triggers will happen in-between resolving each Rockfall 3"
- card: Meteor Shower: "Rockfall 3 three times."
- RAQ 1353899470156206152#4: "They resolve one by one and you always must choose alive unit (or none if you don't have any in that Region)."
- R80: "three batches for the same reason."

- **A.** Yes: "any check for triggers will happen in-between resolving each Rockfall 3" is a statement about rockfalls in general. *At the table:* A Mirage Scuttler chosen three times grows between hits; engine change.
- **B.** No: it described three separate copies, which the card no longer makes; as one spell, triggers wait until it finishes. *At the table:* As today.

**Today:** Neither: rule 801.12c says nothing; the engine does B.

**Recommended:** A: the designer's words describe the mechanic, not the copies, and A is the permissive reading.

**Answer:**

## Cards and tokens

### 6. Is a token a card, so that card text saying "card" reaches tokens?

*D-U06-1, rule 304.2; also filed as D-U03-1 (rule 108.2a), D-U14-7 (rule 701.1c).*

- Manual p.15: "Tokens are temporary cards that are created directly"
- Rulebook 2023 p.4: "Tokens are temporary cards that are created directly into play"
- card: Void Mandible: "When a nontoken card is played during battle, sacrifice me."
- R133: "Tokens are NOT cards, however."
- R306: "Tokens are specifically not considered cards in terms of specific semantics"
- R129: "Everything is a card, including units. Tokens are NOT cards, however."
- R133: "> "I think Void Mandible is just trying to save space (card < unit or spell)."
- Rulebook 2023 p.4: "only cards currently that are “cast” from play, which functions the same way as if they were cast from your hand, but you may"
- R305: "**A token is still not a CARD.**"

- **A.** Yes: "temporary cards" uses the rules word, and Void Mandible's "nontoken card" is a real qualifier. *At the table:* Arbiter of Armistice ("Cards played during battle") and Vengeance tax a spell token cast; a token counts for "card" text; R133, R305 and R306's noun table are reversed.
- **B.** No: "temporary cards" describes the physical token pieces, and the rules word "card" means a card with an Algomancy back (R306). *At the table:* As today: "card" text ignores tokens, and Void Mandible's "nontoken" is shorthand.

**Today:** B (R129, R133, R305, R306).

**Recommended:** A, on the literal steer: both rulebooks say "temporary cards" and Void Mandible prints "nontoken card". Keep B only if the owner wants R306's noun table to stand as a deliberate reading.

**Answer:**

## Mods

### 7. In battle, may a Virus be augmented onto a spell token standing in play (not one being cast)?

*D-U06-9, rule 305.6; also filed as D-U17-4 (rule 721.4a).*

- R89: "- **Augmenting a token ENTITY during BATTLE.** `_passer`'s "not without help of"
- R89: "> "But since Bubb is not a virus, you couldn't mod Fireball **during combat**"
- R89: "and response-window design. Left alone deliberately; **Bena to rule** whether"
- R89: "it is worth the second path."
- Manual p.34: "Viruses have the extra ability to mod units directly from your hand during combat in addition to being playable and augmentable normally during the deployment phase."
- R89: ""It's very similar to how regular viruses work. So you can hit enemy spells,"

- **A.** Yes: a spell token is a spell, and a Virus may "hit enemy spells" in battle (Caleb), so a token in play is a legal battle host. *At the table:* A Virus, or a Rook-enabled augment, can give a Fireball token standing on the board Deadly or Powerful mid-battle; the engine needs the second path R89 describes.
- **B.** No: in battle a Virus reaches units in the region (the Manual's "mod units") and spells on the stack only. *At the table:* As today.

**Today:** Neither: no rule is written. The engine does B.

**Recommended:** A, the permissive reading. R89 already reads {Virus} as buying the timing, not the host.

**Answer:**

## Battle

### 8. Does Temporal Rift's "End this battle" also cancel the second battle round (the counterattack)?

*D-U09-4, rule 505.3f; also filed as D-U13-1 (rule 610.4).*

- RAQ 1353986897902567424#0: "calebgannon (2025-03-30): "Yeah I'm still working on the ruling""
- RAQ 1353986897902567424#1: "Should allow for 2nd Battle to happen if it was cast AFTER blocker/counter-attack"
- Manual p.20: "The NIT can still declare attacks even if the IT decides not to attack."
- card: Temporal Rift: "End this battle. Erase this spell."
- R12: "effect (Temporal Rift) affects only that region's battle and stack — other regions resolve"

- **A.** No: it ends the current battle round in this region; the second round still happens, and cast before blocks the non-initiative player may still attack in round 2, as when the initiative player declines (Manual p.20 note). *At the table:* Engine change: a Rift no longer denies the counterattack.
- **B.** Yes: it ends the region's whole battle phase, so there is no second round. *At the table:* As today.

**Today:** Neither: no rule is written, because the RAQ thread is open and Caleb said he was "still working on the ruling". The engine does B.

**Recommended:** A: the thread itself calls the second round a "2nd Battle", _passer lists it as the consideration for a cast after blocks, and it is the permissive reading. Revisit if Caleb rules.

**Answer:**

### 9. Does a Pure unit in an unblocked column keep its own other attributes (Swift, Powerful, Thieving) when it strikes the player?

*D-U12-12, rule 608.2d.*

- card: Just a Unit: "Pure cards and cards they are interacting with ignore all other attributes."
- R61: "Combat is where attributes live, and combat already resolves per"

- **A.** No: "Pure cards … ignore all other attributes" has no condition on the Pure card itself. *At the table:* An unblocked Pure column strikes in the normal sub-step and does not double or draw.
- **B.** Yes: Pure works only within an interaction with another card, and a player is not a card. *At the table:* An unblocked Pure Swift column strikes first, a Powerful one doubles.

**Today:** Neither for this case: rule 802.1n is worded per interaction, which leans to B.

**Recommended:** A, on the literal grammar of the reminder. B is the more permissive reading, so choose it if Pure is meant to matter only between cards.

**Answer:**

### 10. If a column gains Sluggish during the damage step, does a priority window open before its Sluggish strike?

*D-U12-11, rule 608.3d.*

- RAQ 1363298910528864318#2: "It's still possible to give this column Sluggish attribute and it will deal damage during sluggish-combat-damage (for effective doublestrike)"
- RAQ 1540678747953569832#2: "presence of Swift or/and Sluggish opens new stacks which must be resolved before you move to next combat damage step (swift->normal->sluggish)"
- R295: "when the damage step opens, and never recomputed. A Swift unit dying in the Swift"

- **A.** Yes: Sluggish is present when the strike happens, so it opens a stack after the normal sub-step. *At the table:* Triggers from normal damage resolve in that window, before the Sluggish strike; engine change.
- **B.** No: presence is judged when the step begins (R295); the column still strikes in the Sluggish sub-step, but no window opens before it. *At the table:* As today: normal-damage triggers wait until after combat.

**Today:** B (R295).

**Recommended:** A: the designer says the presence of Sluggish opens the stacks, and the gained Sluggish is present when it strikes; it is also the permissive reading.

**Answer:**

### 11. After sending counterattackers, may the non-initiative player decline to attack with them in round 2?

*D-U13-4, rule 610.4e.*

- Manual p.20: "1. The NIT puts their attacking units into formation."
- Rulebook 2023 p.5: "▪ Second, the counterattacking units are put"
- R194: "* So a round-2 decline is the whole difference between a live Fireball and"
- file: client/engine/test/32-cast-costs.test.ts: "// time and attacking with it in round 2 are two actions with a whole damage"

- **A.** Yes: round 2's attack step is optional like any attack step; sending moves the units, and attacking is a second choice. *At the table:* As today (document and engine).
- **B.** No: sending them commits them, and "The NIT puts their attacking units into formation" is mandatory. *At the table:* A sent unit always attacks; the round-2 decline goes.

**Today:** A (R194 and the engine).

**Recommended:** A, the permissive reading. Under A the player may also attack with only some of the sent units, which no source addresses.

**Answer:**

## Stats and attributes

### 12. A Balanced unit gets Tough from an augment: is it doubled, then balanced, or balanced, then doubled?

*D-U16-1, rule 709.4b; also filed as D-U19-1 (rule 802.1m).*

- Manual p.42: "“Tough” is augmented onto a “Balanced” unit, or if a"
- Manual p.42: "will have its defense doubled, then its stats balanced."
- Manual p.42: "If “Tough” is applied to a “Balanced” unit, it will have"
- Manual p.42: "its stats balanced, then its defense doubled."
- Manual p.42: "A: Attributes apply in order from top to bottom. So if"
- R19: "attrs in type-line order, then augment-granted attrs in mod-stack order, then"
- R19: "⚠ Engine call: the Manual doesn't specify an order for printed-vs-granted-vs-shared;"

- **A.** Doubled, then balanced: the Manual's first sentence names this exact case ("augmented onto"); its last sentence ("applied to") is a different grant, such as an effect. *At the table:* Child of Aether with Rampart Guardian is a 2/2; engine change, CT-257.
- **B.** The Manual's two sentences describe the same case and contradict each other, so the engine's order (R19: printed attributes first) stands: balanced, then doubled. *At the table:* As today: the same unit is a 2/4.

**Today:** Split: rule 802.1m states A; rule 709.4b states both and the engine's order.

**Recommended:** A: the Manual names the case, and printed text is read literally.

**Answer:**

### 13. May a unit without Flying block a Flying column together with a Flying unit in the same blocking column?

*D-U19-5, rule 802.2a.*

- card: Air Plant: "Only flying units can block flying units."
- Manual p.24: "blocked unless the blocking unit has flying."
- Rulebook 2023 p.12: "Flying attribute and the entire column cannot be blocked unless the defending player"
- R248: "blocks by COLUMN and the authored row said so."
- glossary: Flying: "Its column can only be blocked by a column with Flying."

- **A.** Yes: attributes are shared in a column in all situations, so the non-Flying unit has Flying and the column may block. *At the table:* A Flying blocker lets its column-mate join the block.
- **B.** No: every unit that blocks a Flying column must have Flying itself. *At the table:* A non-Flying unit may never stand in a column blocking Flying.

**Today:** Neither: the rule states only the restriction both readings share. Our glossary row and R248 ("blocks by COLUMN") describe A.

**Recommended:** A: Caleb says column-mates share attributes "in all situations" (R93), and A is the permissive reading.

**Answer:**

### 14. Does Inverted invert from the printed stats, or from a rewritten base?

*D-U19-3, rule 802.8c.*

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

- **A.** From the rewritten base: a base rewrite is a new base, not a stat change (R93; spikeydog). *At the table:* A 10/15 made base 4/4 with a +1/+1 counter, Inverted, is a 3/3.
- **B.** From the printed stats: any difference from the printed stats is a stat change (R157 §14; _passer's two posts). *At the table:* The same unit, Inverted, is a 15/25.

**Today:** A (R93), the owner's ruling of 2026-08-22.

**Recommended:** B, for one definition of a stat change: the owner's later general words (R157 §14) and _passer agree, and Unaware already reads a base rewrite as a change. Keep A only if R93 was meant as a deliberate exception for Inverted.

**Answer:**

### 15. Is a Sneaky unit "attacking alone" judged when attacks are declared, or when blocks are declared?

*D-U20-2, rule 802.14a.*

- file: client/ui/scan-reminders.json: ""text": "Sneaky units can't be blocked if attacking alone.", "card": "Whispering Mantid""
- R20: "A Sneaky column cannot be blocked iff its unit is **the only attacking unit in the"

- **A.** When blocks are declared: if its fellow attackers are gone by then, it is alone and cannot be blocked. *At the table:* Removing a co-attacker in the attack window makes the Sneaky unit unblockable.
- **B.** When attacks are declared: only a unit declared as the only attacker is alone. *At the table:* It stays blockable once declared with company.

**Today:** Neither: the rule states R20 only.

**Recommended:** A: "can't be blocked" applies at the block, so "attacking alone" is read then; it is also the permissive reading.

**Answer:**
