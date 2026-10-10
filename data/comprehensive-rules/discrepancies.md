# Algomancy Comprehensive Rules: Discrepancy Report

Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision; every other item already says which side the document follows.

## 1. Questions for the owner (21)

### D-U01-1 · Sources disagree · rule 101.6a

The Manual says there is "zero information or interaction between regions". R243 says regions do NOT scope information: a player may read what happens in a region they are not in.

- Manual p.19: "regions. This means there is zero information or interaction between regions."
- R243: "Regions do NOT scope information, but they do scope 'global' things (every"

**Resolution:** Question for the owner. The Manual's word "information" supports two readings. (A) Effects cannot read information across regions (a card cannot count or look at another region). This agrees with R243 §1 and leaves R243 §2 standing. (B) Players do not get information about other regions, which contradicts R243 §2. Manual p.42 ("Each region treats the players and cards in other regions as if they don’t exist") speaks of what effects and players can interact with and fits (A). Printed text outranks an R-ruling, so if the owner reads it as (B), concepts.golden.regions.information must change. Until then the rule states R243, at medium confidence.

### D-U01-12 · Sources disagree · rule 101.6

The Manual and Caleb say every effect is region-specific and never impacts anything in another region. R265 says the stack, bins and cache have no region, so Frosted Denial, Woodland Warding and Molten Riftbreaker reach across regions.

- Manual p.19: "place in, meaning it will never impact anything in any"
- RAQ 1454169054402314362#0: "Yes everything in the game is region specific. Just add 'in this region' to every card if it helps."
- R265: "Three zones have no region and are deliberately global — the **stack**"
- Manual p.19: "Additionally, if a player enters a region, their bin, hand,"

**Resolution:** Under the authority order print and Caleb outrank R265, so the rule states them, and the client's regionless stack, bins and cache are filed as F-U01-2. Question for the owner only if he holds R265's premise that a stack item, bin or cache is in no region: neither printed sentence says which region a stack item or a bin is in, and Manual p.19 ties a bin to its player being present in a region, which supports reading (A) a stack item is in the region it was cast in and a bin is reachable where its player is present, or (B) these zones sit outside every region, as R265 holds.

### D-U02-2 · Engine only · rule 105.4c

Whether a dormant (face-down) resource counts toward affinity. The engine says no. The designer says affinity counts the resources "somewhere in your manabase", tapped or not, and says nothing of face-down ones.

- RAQ 1358299200953126963#0: "The affinity dots just require you have at least that many resources of that type somewhere in your manabase"
- Manual p.12: "Resource types needed to be present among your resources"
- R151: "counts what is **awake** ("dormant gives no affinity"; "expended still counts")."

**Resolution:** The rule states the engine, basis engine, confidence low. Question for the owner: "at least that many resources of that type somewhere in your manabase" reads either as every resource in play, face-down ones included, or as the resources whose type is showing (face up). The permissive steer would favour the first; the engine takes the second. R151 is a presentation ruling quoting the engine, not a rules decision.

### D-U02-7 · Sources disagree · rule 106.8a

What an EXPENDED Prismite exchanges into. The card says the Prismite is erased and a new resource is created and then activated, which reads as a fresh, un-expended resource. R17 says the new resource keeps the Prismite's current state.

- R132: ""Erase me: Create a non-prismite resource, **then activate it**. Do this only"
- R17: "resource of any element, keeping its current state ("players essentially get to pick"
- Manual p.18: "Sometimes it can be advantageous to delay exchanging them."

**Resolution:** The rule states R17, confidence medium. Question for the owner: "Erase me: Create a non-prismite resource, then activate it" reads either as a new resource that is not expended, so a Prismite expended for mana and then exchanged gives a second mana that turn, or, as R17 has it, as a replacement that keeps the Prismite's expended state. The Manual's "advantageous to delay exchanging them" fits both.

### D-U03-1 · Sources disagree · rule 108.2a

The Manual calls tokens "temporary cards", and Void Mandible prints "nontoken card", which only makes sense if some cards are tokens. The owner ruled that tokens are not cards, and that "card" in card text never includes a token.

- Manual p.15: "Tokens are temporary cards that are created directly"
- card: Void Mandible: "When a nontoken card is played during battle, sacrifice me."
- R129: "Everything is a card, including units. Tokens are NOT cards, however."
- R133: "> "I think Void Mandible is just trying to save space (card < unit or spell)."

**Resolution:** Question for the owner (the same question as D-U14-7). The printed words support two readings: (1) "temporary cards" is loose description, so a token is not a "card" for card text, and Void Mandible's "nontoken card" is shorthand for "nontoken unit or spell" (R129, R133, R306; the rule follows this); (2) a token is a card, so card text that says "card" reaches tokens and Void Mandible's word is literal. Printed text outranks an R-ruling, so the rule as written stands only if reading (1) is right.

### D-U03-13 · Other · rule 110.11

The designer says a graft onto Mohruung makes "he will trigger first". A graft in deployment is not put on the stack, so R53's "above the spell that targeted" does not order it. The engine queues the trigger first but attaches the graft before the trigger resolves (round-2 probe: the graft line precedes the Crystal line in the log).

- RAQ 1355115946032889914#4: "Applying Graft is 'targeting' effect, so if you try to Graft something underneath the Mohruung, he will trigger first"
- R53: "the stack **above** the spell that targeted — the trigger resolves first."
- file: client/engine/src/apply.ts: "e.fireEvent('targeted', ev);   // grafting is targeting (Graft 101 §5)"

**Resolution:** Question for the owner. "he will trigger first" reads two ways: (1) the trigger resolves (the Crystal is made) before the graft is applied; (2) the trigger only fires first, and may resolve after the graft is attached. The rule states reading (1) and the engine does (2): F-U03-5. Under reading (2) the rule's last sentence becomes "triggers when the graft is applied" and F-U03-5 closes.

### D-U04-12 · Sources disagree · rule 111.15

The designer says an unpayable grafted cost keeps "the whole Graft Effect" off the stack. R334 reads that as the whole composite for a triggered or activated item, but keeps a per-part skip for a played spell with a {Modular} graft part.

- RAQ 1355115946032889914#10: "then the whole Graft Effect won't go on the stack."
- R334: "- A played **spell** that carries a `{Modular}` graft part keeps the per-part skip. Withholding a card already paid for would strand it."

**Resolution:** Question for the owner. The words "the whole Graft Effect" support two readings: (a) the whole composite, host and every graft (R334's reading for abilities, which would withhold a {Modular} spell too); (b) only the graft's own effect, which is the per-part skip R334 keeps for spells. The rule states R334 as it stands, carve-out included.

### D-U04-2 · Sources disagree · rule 111.8

Eldritch Dreamtender, Cthyrian Rector and Void Mandible print "sacrifice me. If you do, …" as effect text, with no bracket. R73 reads the sacrifice as a cost paid as the ability goes on the stack, and says so.

- card: Eldritch Dreamtender: "sacrifice me. If you do, look at that player's hand and discard a card from it."
- R73: "`[cost]`; the ruling reads it as a cost anyway."
- R73: "printed prose as a bracketed cost.**"

**Resolution:** Question for the owner. The printed words "sacrifice me. If you do," support two readings: (a) a step of the effect, carried out when the ability resolves, in the order the sentence gives; (b) a cost, paid as the ability goes on the stack (R73). The rule states R73, the current ruling; Void Mandible's own "(This is not optional.)" fits either reading.

### D-U06-1 · Sources disagree · rule 304.2

Both printed rulebooks call tokens "temporary cards", and Void Mandible prints "nontoken card", which only makes sense if a token can be a card. The owner ruled that a token is not a card (R129, R133) and confirmed it in R306.

- Manual p.15: "Tokens are temporary cards that are created directly"
- Rulebook 2023 p.4: "Tokens are temporary cards that are created directly into play"
- card: Void Mandible: "When a nontoken card is played during battle, sacrifice me."
- R133: "Tokens are NOT cards, however."
- R306: "Tokens are specifically not considered cards in terms of specific semantics"

**Resolution:** The rule states the owner's ruling (a token is not a card), with basis owner. Printed text outranks an R-ruling, so this is a question for the owner. The printed words have two readings. Reading 1: "temporary cards" uses "card" as the rules term, so tokens are cards and the noun "card" reaches them; Void Mandible's "nontoken" would then be a real qualifier. Reading 2: "temporary cards" describes the physical token pieces kept in the token pile, and the rules term "card" means a card with an Algomancy back, as R306 says. R133 already treats Void Mandible's noun as shorthand. Only reading 2 keeps types.general.nouns.card and R305's noun table.

### D-U06-5 · Sources disagree · rule 304.7

R101 transcribes the back face Beyond, Codex Incarnate as a "Book Token Unit". The owner later ruled that the back face is not a token (R157 §10). The back face is not in the printed card data, so no printed source in the extract can settle it.

- R101: "> **Beyond, Codex Incarnate** — cost 0, 8/3, *Book Token Unit*"
- R157: "And the back is NOT a token."

**Resolution:** The rule follows R157 §10, the later owner call. Question for the owner only if the printed back face really does read "Token" on its type line: printed text outranks an R-ruling, and then the owner's answer is an erratum to the card, not a reading of it.

### D-U06-9 · Other · rule 305.6

Sources do not say whether a Virus may be applied during battle to a spell token standing in play. R89 left it for the owner to rule. A player's remark implies it can be.

- R89: "- **Augmenting a token ENTITY during BATTLE.** `_passer`'s "not without help of"
- R89: "> "But since Bubb is not a virus, you couldn't mod Fireball **during combat**"
- R89: "and response-window design. Left alone deliberately; **Bena to rule** whether"

**Resolution:** Question for the owner. R89's words support two readings. Reading 1: a Virus may be applied in battle "onto units", and a spell token in play is not a unit, so it cannot be a battle host (the engine's current behaviour according to R89). Reading 2: a Virus buys the timing, not the host ("not without help of Rook" implies a Virus could do it), so a spell token in play is a legal Virus host in battle. The permissive steer favours reading 2. No rule states either reading yet.

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

### D-U09-1 · Sources disagree · rule 507.3a

The printed rules have the initiative team deploy first and then the non-initiative team. The 2023 Rulebook adds that the non-initiative team may "wait and see" what the initiative team does. The client lets both players deploy at the same time, hidden from each other. This is a house rule with no R-ruling, and the Manual's own region rules (zero information between regions) arguably make the order unobservable.

- Manual p.38: "to the non-initiative team that will all do the same."
- Rulebook 2023 p.5: "plays first while the non-intiative gets to wait"
- Manual p.42: "treat all other players as if they don’t exist."
- R286: "playing different games during deployment"

**Resolution:** Question for the owner. Manual p.38 says the initiative team deploys "before passing to the non-initiative team". That supports two readings. (1) The order is real game law: the non-initiative team acts after the initiative team, and per the 2023 Rulebook may "wait and see". The client's simultaneous deployment would then be a departure, and it would also change the order of anything both players' deployments set off. (2) The order is moot: Manual p.42 has each player "in separate regions during the deployment phase", with zero information between regions (p.19). On that reading, simultaneous hidden deployment is the same game, and the rule belongs in Annex D as a digital convention. The CR states both rules for now: turn.deploy.order (printed) and turn.deploy.order.simultaneous (the client).

### D-U09-4 · RAQ open · rule 505.3f

If Temporal Rift ends round 1 before blocks, can the non-initiative player still attack in round 2? The RAQ thread is open, and Caleb said he was "still working on the ruling". Today the engine ends the battle phase: no counterattack and no round 2.

- RAQ 1353986897902567424#0: "calebgannon (2025-03-30): "Yeah I'm still working on the ruling""
- RAQ 1353986897902567424#1: "Should allow for 2nd Battle to happen if it was cast AFTER blocker/counter-attack"
- Manual p.20: "The NIT can still declare attacks even if the IT decides not to attack."
- card: Temporal Rift: "End this battle. Erase this spell."

**Resolution:** Question for the owner, since the designer has not ruled. Two readings of the printed words. (1) "End this battle" ends the battle phase in that region before any block step, so no counterattackers were sent and there is no round 2 (what the engine does). (2) A Rift-ended round 1 is like an initiative player who "decides not to attack", so the NIT may still attack in round 2 with any unit (Manual p.20 NOTE, R15). The CR states no rule for this case. It belongs with 610 (U13).

### D-U10-3 · Other · rule 602.6c

R75 (placement) and R304 (edges) close the ends of a defending formation because 'a blocking column is keyed to the attacking column it answers'. R321 later let a block declaration open new columns beside the attack for side-blocks, and the Manual says side-blocks help 'adjacency matters cards'. The stated reason no longer holds, so the limit may be an engine artifact rather than a ruling.

- R75: "to either side of the existing units OR in the second slot of a column for a"
- R304: "**Attacking line only.** A blocking column is keyed to the attacking column it"
- R321: "Side-blocks may stand to either side of the attack."
- Manual p.23: "where attackers aren’t, which can be beneficial for"

**Resolution:** Question for the owner. The owner's words in R75, 'either side of the existing units', support two readings for a DEFENDING formation: (1) only the attacking line gains end columns, as R75's author read it, so a blocking Hooba-Bot or Hooba-God whose column is full places nothing (66: 'a full BLOCKING formation offers nothing'); (2) any formation gains a new column at either end, which for a defender is a side-block column, as R321 now permits at declaration. The rules state reading (1), as R75 and R304 do. R304's edge-adjacency half has the same dependency, but no card meets it today: every 'adjacent slots' card is a 'when I attack' trigger.

### D-U11-3 · Sources disagree · rule 607.2

Caleb said a unit put in as a blocker after blocks would be 'considered blocked even against an empty column'. R322 offers the late-blocker spot only for an attacking column that 'still has an attacker' and no block. Caleb's words support two readings.

- RAQ 1366447016653361192#1: "3.) I think it would be considered blocked even against an empty column."
- R322: "for every attacking column that still has an"

**Resolution:** Question for the owner. The words 'even against an empty column' have two readings. (1) 'Empty' means the defending half of the column (no blocker yet), the column _passer asked about. On this reading R322 is right and nothing changes. (2) 'Empty' means an attacking column with no attacker in it: a column whose attackers have all died after blocks (a hole), or a side position. On this reading a late blocker may also stand opposite such a column and make it blocked, which R322's 'still has an attacker' excludes. The rule follows R322 (reading 1) until the owner decides.

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

## 2. Register and test fixes (33)

### D-U01-10 · Other · rule 102.4

The RAQ register's paraphrase of claim 1372468222158180424#8 says the mods go to "their owner's bin". _passer's words say "your bin/discard", and under R250/R262 a card leaving play goes to its controller's zone.

- RAQ 1372468222158180424#8: "Mods attached to it after it resolved go to their owner's bin when it is recalled."
- RAQ 1372468222158180424#8: "Those would go to your bin/discard as usual."
- R250 (its §4, zones follow control): "| which zone does it go to? | its CONTROLLER's |"

**Resolution:** In the thread's case (you attached the mods to your own BoFy) owner and controller are the same player, so nothing conflicts. Reword the register claim to "go to the bin as usual" or "their controller's bin", so the paraphrase does not assert the owner rule that R250 reversed.

### D-U02-6 · Sources disagree · rule 106.8a

When a Prismite may be exchanged. The card (as R132 quotes it) says "only during the mana step", and the Manual describes the exchange inside the resource step; R17 says "during planning", which would also admit the haste step. The verifier measured that the engine allows it only in the resource step.

- R132: "during the mana step. {i}(This does not use one of your activations for turn.)"
- Manual p.18: "The resource step of the planning phase is when players have the ability to create and activate resources. During this step, any resource can be created from"
- R17: "exchange: during planning, an **active** (face-up) Prismite may be swapped for a"

**Resolution:** Printed text outranks an R-ruling: the rule states the resource step, which the engine already enforces. R17's "during planning" is loose wording, not a different law; tighten it to "during the resource step" in the register. Question for the owner only if the exchange is meant to be allowed in the haste step as well.

### D-U03-11 · Register chain wrong · rule 109.8a

R63, presented as current, says granted text is silenced by R62 exactly like printed text. R328 reversed R62's veto: an ability gained after the strip is not removed. The register marks R62 reversed by R328 but does not mark R63 amended.

- R63: "Granted text is silenced by R62 exactly like printed text — it is an ability the"
- R328: "stripping applies**. Anything the unit gains **afterwards** — a mod attached, an"

**Resolution:** Mark R63's silencing sentence amended by R328 (only granted text that predates the strip is silenced). The rule follows R328.

### D-U03-3 · Register chain wrong · rule 110.8

R88 and R144 still say that a target restriction is asked when targets are chosen and never asked again at resolution. R324 (later) judges every target again against its restriction as the effect begins to resolve. The register marks R64 and R256 as amended by R324, but not R88 or R144.

- R88: "cast and is never re-asked (R5/R56), so the world may legally stop satisfying"
- R144: "re-asked at resolution**, and a card that needs it re-checked does so in its"
- R324: "When an item begins to resolve, every target it declared is judged again by the"

**Resolution:** R324 is later and designer-backed; the rule follows it. The register should mark R88's sentence, and the census sentence in R144, as amended by R324, as it already does for R64 and R256. The same item as D-U14-4.

### D-U03-4 · Register chain wrong · rule 109.3d

R161 §16, presented as current, says the engine still makes ONE trigger that creates two tokens for two targeted allies, and that the engine change was not made. Test 136 asserts two separate triggers on the stack. R184 credits the fix (the 'targeted' event's seat and kind) to "R163", and digital-rules.md has no R163.

- R161: "left.** The owner says two *triggers*; this is one trigger creating two tokens."
- R184: "dispatched, carrying `formation` plus R163's `seat` + `kind`."
- file: client/engine/test/136-triggers-and-modes.test.ts: "test('R157 §16: two targeted allies are TWO TRIGGERS on the stack, not one that makes two', () => {"

**Resolution:** The rule follows R157 §16 (two targets, two triggers), which the test now asserts. The register should mark R161 §16's approximation paragraph as closed by whichever ruling closed it, and either restore R163 or correct R184's citation of it.

### D-U04-3 · Sources disagree · rule 111.10k

R119 quotes Deferral Drone as "The next card you play this turn" and clears the charge at the start of each turn. The printed card says "this phase", and a test in 45-hybrids-ld-b shows the charge ending at a phase boundary within one turn.

- card: Deferral Drone: "The next card you play this phase costs [3] less."
- R119: "turn costs [3] less."*"
- R119: "| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |"

**Resolution:** Printed text wins (authority order): the rule says the charge lasts until the phase ends. R119's quotation of the card and its "clear" row should be marked corrected in the register (see F-U04-1).

### D-U04-4 · Sources disagree · rule 111.10e

R122 says an Ambush sits outside the play-tax layer and that widening it is a future decision. R129 counts an Ambush as a card played, and Arbiter of Armistice and Vengeance tax "cards" played during battle.

- R122: "printed cost line and today sits outside the R59/R60/R122 play-tax layer"
- R129: "'cardPlayed': a {Battle} unit and an Ambush are cards being played"
- card: Arbiter of Armistice: "Cards played during battle gain [Pay 2 life]."

**Resolution:** The printed noun "Cards" read literally, with R129, puts an Ambush play under the imposed cost, so the rule says so with an engine-differs marker (F-U04-2). Question for the owner only if R122's deferral was meant as a ruling that an Ambush is exempt.

### D-U04-8 · Register chain wrong · rule 111.8

R73 is presented as current, but its ⚠ paragraph on timing says a Dreamtender's combat-damage trigger resolves immediately inside the damage step. R261 moved combat-damage triggers onto the stack after combat, and R295 made a split step resolve them at the sub-step boundary, with priority.

- R73: "and R3/R31 resolve it immediately, so a Dreamtender in a Swift column is gone"
- R261: "**[R117] / [R157] §5 keep their gate and lose their ordering claim.** R117's finding — that"
- R295: "- **R261**: the hold is conditional now. Its unsplit case is untouched."

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

### D-U08-1 · Sources disagree · rule 501.4

The printed rules have the initiative player take the resource step and the haste step first, then the non-initiative player, who gets to see what the initiative player did. R18 (its standing half) has both players act at once, interleaved in any order, inside a hidden simultaneous segment.

- Rulebook 2023 p.5: "phases, the initiative team must make all of their plays first while the non-intiative gets to wait"
- Manual p.27: "IT FIRST, THEN NIT"
- Manual p.20: "Teams always act together in all situations and phases of"
- R18: "no stack, no responses), players may interleave plays in any order, and a player with no"
- R18: "false: the haste step is a **hidden simultaneous segment** — nobody sees the"

**Resolution:** Authority order: printed beats an R-ruling. turn.planning.order states print (IT first, then NIT, for steps 4 and 5; steps 1-3 simultaneous, as the Manual p.27 legend colours mark them on the scan). The engine divergence is F-U08-1. R18 argued the hidden model is "indistinguishable from the printed" step, but it compared against Manual p.18 only and never against the p.27 legend or Rulebook 2023 p.5; under print the non-initiative player sees the initiative player's resources and haste plays before choosing.

### D-U08-10 · Other · rule 501.4a

Print syncs every step: no player begins the resource step until every player has finished the draft step. The engine lets a seat that has drafted (or, in constructed, recycled its 2) begin and even finish its resource step while the other seat still drafts. No ruling states the early start.

- Rulebook 2023 p.5: "Turns in Algomancy are global, meaning all players share the same phases, and sync up at the end of each step."
- Manual p.16: "Once all players have passed their pack, the draft step"
- file: client/engine/test/20-draft.test.ts: "// committed seat may proceed simultaneously while the opponent drafts"

**Resolution:** The rule states print; the engine behaviour is F-U08-4. The early start happens inside the hidden plan segment, so the drafting seat cannot see it and the information effect may be nil. Question for the owner only if the early start should be kept as a digital convention (Annex D) rather than fixed.

### D-U08-11 · Sources disagree · rule 500.3

Print has the initiative player act first "in all situations", the non-initiative player waiting to see what they do. R18's digital half makes the haste step (and, with it, the resource step and deployment) a hidden simultaneous segment, so initiative-first order survives only in battle.

- Rulebook 2023 p.5: "together and are required to act first in all situations. For example, during the mana and main"
- Manual p.20: "plays first, allowing the Non-initiative-Team (NIT) to act"
- R18: "false: the haste step is a **hidden simultaneous segment** — nobody sees the"

**Resolution:** Authority order: printed beats an R-ruling, so turn.general.initiative states print and the engine divergence is F-U08-1. The planning half is D-U08-1; deployment's order is 507/508 (U09).

### D-U09-2 · Register chain wrong · rule 507.5

R38 is presented as current and still says "there is no priority during deployment". R286 later gave each player priority over their own deployment stack. The register marks R250's deployment half as amended by R286, but not R38's identical clause. The engine still gives nobody priority in deployment: a test asserts priority is null there, and R287 records that the deployment stop is not built (CT-185).

- R38: "window as regroup triggers, and because there is no priority during"
- R286: "2. **That stack belongs to one seat**, and so does the priority over it. The"
- R287: "⚠ **THE DEPLOYMENT CLAUSE IS NOT BUILT.** *"Even during deployment, nothing"

**Resolution:** Mark R38's no-priority clause as amended by R286 in the register (the reason why rot cannot be responded to). The rule that rot itself cannot be responded to stands either way, because rot damage never goes on a stack (R50). The engine gap, no priority stop on your own deployment stack, is already CT-185. It is not filed again here.

### D-U10-7 · Other · rule 603.2

Sources do not say in so many words whether two blockers with an unblocked attacking column between them are neighbours. The rule reads the Manual literally (a column with no blocker is an empty position between them); the engine treats them as neighbours and calls that an approximation.

- Manual p.23: "where attackers aren’t, which can be beneficial for"
- R304: "- **Attacking line only.** A blocking column is keyed to the attacking column it"
- file: client/engine/src/engine.ts: "    // treated as adjacent (⚠ approximation: two blocks on columns 1 and 5 read"

**Resolution:** The rule follows the Manual: where a blocker stands matters for adjacency, and blocking columns are keyed to the attacking columns they face, so an unblocked column is a gap. The engine differs: F-U10-3.

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

## 3. Engine-only and owner-only rules (48)

### D-U01-13 · Engine only · rule 103.3a

No source gives the constructed opening hand (concepts.starting.constructed.opening-hand) or says whether the first turn takes the constructed draw phase (concepts.starting.constructed.first-draw). The client deals 4 and runs the phase on turn 1 (draw 4, put 2 back).

- Rulebook 2023 p.6: "Players draw 2 cards during the draw step on every turn after the first."
- Rulebook 2023 p.6: "the draw phase in constructed, players draw 4 cards, then select 2 cards from their hand and put them on the bottom of the"
- Manual p.16: "their opening hand, in which case they should not draw"
- file: client/engine/src/apply.ts: "// opening hand 4 (like draft); turn 1's draw phase (draw 4, bottom 2)"

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

### D-U03-14 · Engine only · rule 110.11

Sources silent on whether a "when I become targeted" trigger resolves before or after an augment applied in deployment is attached. R53 orders only an effect on the stack; the designer speaks only of grafts. The round-2 verifier reports the engine attaches the deployment augment first, then resolves the trigger (as it does for a graft).

- R53: "the stack **above** the spell that targeted — the trigger resolves first."
- card: Mohruung: "When I become targeted, [Switch1] Create a Crystal 2."

**Resolution:** No rule states the order for a deployment augment. Question for the owner only if the designer's graft answer is meant for every mod applied in deployment; then it follows D-U03-13.

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

### D-U04-13 · Engine only · rule 111.3a

Only the engine says a cost that removes counters from allies, or recalls an ally, uses only units in the region where it is paid. R35's "region-scoped" predates those cost kinds and was written about sacrifice.

- R35: "sacrificed unit's defense as it was then), the cost is region-scoped (the"
- file: client/engine/src/engine.ts: "case 'sacrificeUnit': return this.unitsOf(seat, region).length > 0;"

**Resolution:** Stated as the engine's behaviour, basis engine (verifier r1: E.canPayCastCost draws removeCounters and recall candidates from unitsOf(seat, region)). Question for the owner only if a card's unit cost is meant to reach another region.

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

- R89: "The reading taken, and it is a reading — sourced to the community rather than to"
- R89: "> deployment but currently that would only be possible with spell tokens. Also"

**Resolution:** Owner call, stated as part of types.mods.spell-token-host with basis owner. It is the permissive reading.

### D-U06-8 · Owner call only · rule 303.10

That a spell unit which gives itself away enters play under the other player (never controlled by its caster) is the owner's reading of Hush Mush. No designer source.

- card: Hush Mush: "Negate target effect. Its controller gains control of me."
- R143: "A spell unit whose text says another player gains control of it ENTERS as"

**Resolution:** Owner call (R143), stated with basis owner. Print says only that control changes, not when; R143 reads both sentences as one resolution.

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

### D-U08-5 · Other · rule 503.4b

The sources do not say whether the first turn of a constructed game has the draw of 4 and the recycle of 2. The Manual's first-turn shortcut (the first draws dealt with the opening hand) is written for live draft. The engine deals 4 and then has each player draw 4 and put 2 back on turn 1.

- Manual p.16: "their opening hand, in which case they should not draw"
- Manual p.16: "the draft step in constructed, players simply draw 2"
- Rulebook 2023 p.6: "Players draw 2 cards during the draw step on every turn after the first."

**Resolution:** Sources silent on constructed's opening hand size and on whether the first-turn shortcut applies there. turn.draw.constructed.first-turn rests on the Manual's "every turn" (confidence low), which is what the engine does (opening 4, then draw 4 and recycle 2 on turn 1). Question for the owner only if constructed should deal its first draw with the opening hand as live draft does. Rulebook 2023 p.6 ("every turn after the first") would put no draw on turn 1; the Manual supersedes it, and its opening hand differs.

### D-U08-6 · Owner call only · rule 504.5

That the haste step happens every turn, even when nobody can play anything, is the owner's call. The Manual says only that the step ends when everyone has played what they want, "which can be none".

- R224: ""Always offer the step.""
- Manual p.18: "the haste cards they wanted to play (which can be none)."

**Resolution:** Owner call; no designer source. Consistent with print (an empty step is allowed), and it keeps the step's presence from revealing a hidden hand (Annex D).

### D-U08-7 · Owner call only · rule 503.5b

That a player's units are not checked for death between the draw of 4 and the recycle of 2 in constructed is the owner's call (2026-10-06, quoted in R313). No designer source rules on it.

- R313: "- **Constructed's draw phase is one step.** Draw 4 and put 2 back are two"

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

**Resolution:** The rules state R75 (602.6k, 602.7c), basis owner, medium confidence; the engine matches. R184 is about a formation as a TARGET and does not speak to joining one. Awaits owner sign-off with the other owner-only rules. For an effect whose source has left play, see D-U10-6.

### D-U10-4 · Owner call only · rule 602.6a

Two parts of the placement rule are readings added by R75's author, not in the owner's quoted words: the hole as a third legal position, and 'either side of the existing units' read as the two ends only.

- R75: "to either side of the existing units OR in the second slot of a column for a"
- R75: "**The hole is a third kind the ruling does not enumerate.**"
- R75: "**"Either side of the existing units" is read as the two ENDS, not as an"

**Resolution:** The rules state both readings with basis owner and medium confidence (602.6a, 602.6b). They await owner sign-off with the other owner-only rules (Annex P). No printed or designer source speaks to either.

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

- R322: "attacker and no block entry, from the block window until combat damage is"
- R322: "No `blocked` event fires for the late blocker"
- RAQ 1366447016653361192#1: "A unit played in as a blocker after blocks (Tiderunner Initiate) blocks an unblocked column"

**Resolution:** The rules state R322 and are marked basis owner (combat.block-window.late-blocker.when, combat.block-window.late-blocker.not-declared). Question for the owner only if a unit with a 'When I block' ability can reach a blocking spot after blocks (for example one played by a blocking Hooba-Pon 'into an open position in my formation'); then whether its trigger fires needs a decision.

### D-U11-6 · Engine only · rule 606.7

That the block step still takes place when every attacking unit has gone before blocks is stated only by a test. The Manual says the attacking player stays present after its units are removed, but not whether the block step happens.

- Manual p.19: "if the units they’ve sent into the region are removed."
- file: client/ui/test/53-playtest-round7.test.ts: "R84: an attack that has collapsed to nothing still lets the defender declare"

**Resolution:** The rule is basis engine and awaits owner sign-off (Annex P). It matters because the defending player may still want to side-block or send counterattackers.

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

## 4. Everything else (74)

### D-U01-11 · Sources disagree · rule 101.1

R157 says "Printed text always wins". Caleb says Crevice Lurker works against its printed word "Abilities" because his intent differs, so printed text does not always win.

- R157: "> *"Controller's cache — the printed text wins. Printed text always wins."*"
- RAQ 1366446116274442291#1: "So as written it wouldn't work but my intent is for it to stop those from triggering"

**Resolution:** The designer outranks R157 (authority order), so the rule scopes "always": printed text beats general rules and engine defaults, and yields only to the designer's stated intent for that card (concepts.golden.designer-intent). R157 was about print against defaults, so the two do not otherwise conflict.

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

**Resolution:** Those rules (concepts.ending.continues, concepts.ending.continues.pack, concepts.ending.win.teams) are stated from print and will ship untested, with the reason that the client has no game of more than two players.

### D-U02-1 · Other · rule 105.1

The Manual says Algomancy has five elements. The client plays seven: the Light & Dark expansion adds two, and no printed rules page in the sources covers them.

- Manual p.8: "Algomancy consists of 5 Elements, which all offer different ways to play and interact"
- R54: "silently drop the bonus for wood, metal, light and dark, and keeping both would"

**Resolution:** Not a conflict of rules: the Manual predates the expansion. The rule states both counts. Every general rule in 105-106 that the Manual states for "the elements" is applied to Light and Dark too (for example the affinity Shard, R54); that extension has no printed source.

### D-U02-10 · Other · rule 106.3b

No printed source says a dormant resource cannot be expended. Manual p.14 says all resources can be expended; the rulings say a Shard and a made Prismite pay mana once activated.

- Manual p.14: "All resources have the ability to be expended for 1"
- R54: "gives **one generic mana** once activated, gives **no affinity**, and **cannot"
- Manual p.18: "typically receive the two activations for the first turn. Active Prismites may be"

**Resolution:** The rule states the rulings, basis owner. The Manual's two-activations limit only does anything if a resource must be activated before it is used, so print implies the rule without saying it.

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

### D-U02-8 · Sources disagree · rule 106.8d

Whether a Prismite can be exchanged into a Shard. The card says "a non-prismite resource" and the Manual "other resources"; a Shard is a resource. R299 says an exchange names an element, and the engine and test 308 refuse a Shard.

- R132: ""Erase me: Create a non-prismite resource, **then activate it**. Do this only"
- Manual p.18: "exchanged for other resources, meaning players essentially get to pick their two"
- R299: "Exchanging a Prismite *into* a Prismite stays illegal — an exchange names an element."

**Resolution:** Printed text, read literally, outranks R299, and the permissive reading is taken: the rule allows a Shard. The engine refuses it: F-U02-3. A Shard is never better than an element resource, so the fix is low priority. Question for the owner only if R299's "an exchange names an element" was a deliberate ruling on Shards rather than the reason a Prismite cannot become a Prismite.

### D-U02-9 · Other · rule 107.1

Sources silent on general number handling: rounding, negative results, and what a card's own element is (the cards and the Manual's element pages show it; no text defines it). Cards that halve say their own rounding.

- card: Prophecy Bug: "It gains 'Prophecy — X Turns Pass', where X is half of its cost, rounded up."

**Resolution:** No general rule is written. 107 says only what the sources say; a card that needs rounding prints it.

### D-U03-12 · Sources disagree · rule 109.5a

The Manual says replacement effects don't use the stack. R102 (owner) puts the substitute of a replacement that names a target (Beyond, Codex Incarnate's rot clause) on the stack as a triggered ability, while the event itself is replaced at once.

- Manual p.41: "Instead” are called replacement effects. Unlike triggered abilities, replacement effects don’t use the stack"
- R102: "2. **A replacement that names a TARGET still uses the stack.** A target has to be"

**Resolution:** The rules follow both: the replacement itself never waits on the stack (R102 replaces the damage before anything is queued), and only a substitute that needs a target goes on the stack. Question for the owner only if the Manual's sentence is meant to cover the substitute too; then a target would have to be chosen with no stack, and Beyond's clause would not be respondable.

### D-U03-2 · Sources disagree · rule 108.3a

R101 transcribes the back face Beyond, Codex Incarnate with the type line "Book Token Unit". R157 §10 (owner, later) rules that the back face is NOT a token.

- R101: "cost 0, 8/3, *Book Token Unit*"
- R157: "side. And the back is NOT a token."

**Resolution:** The back face is in none of the printed data this project extracts (printed.json, the Manual, the Rulebook); its type line is known only from the owner's transcription in R101. The rule follows R157 §10, the owner's later, explicit answer, and the register already marks R101's token clause as reversed. Question for the owner only if the physical back face really prints "Token" on its type line: printed text would then outrank R157 under the authority order.

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

### D-U04-6 · Other · rule 112.3

Sources silent on how an effect that multiplies life gained or lost composes with one that adds a fixed amount to it. R264 says that is still unruled. The designer's damage order (additive first, then Powerful doubles) is the nearest ruling.

- R264: "**⚠ THE ADDITIVE COMPOSITION IS STILL UNRULED, and Q4 asked about it.** R157 §23"
- RAQ 1362838395298119912#4: "Conduit of Pain adds its 1 BEFORE Powerful doubles"

**Resolution:** The rule states only that multipliers multiply. Question for the owner only if a card adds a fixed amount to life gained or lost and can meet Arbiter of Vitality.

### D-U04-7 · Other · rule 112.13

Sources silent: neither the Manual nor the Rulebook 2023 defines rot or debt. Both rules come from R38 and R39, which cite Caleb (and a Rot Counter card in Caleb's card library) by date; no RAQ claim or printed page in the sources holds his words.

- R38: "itself. (Printed: the Rot Counter card, Caleb's card library 2026-01-15; via"
- R39: "casting this turn. (Caleb 2024-09-10, refined 2024-12-02; via Bena 2026-08-19.)"
- glossary: Rot: "At the start of deployment, you take damage equal to the number of rot you have. Rot does not go away."

**Resolution:** The rot and debt rules ship with basis owner. Adding the Rot Counter card text (and Caleb's debt answers) to the printed sources would raise them to a printed or designer basis.

### D-U05-1 · Sources disagree · rule 200.1

The 2023 Rulebook and the Manual name the same card parts and steps with different words: threshold / affinity, health / defense, main phase / deployment, mana step / haste step, discard / bin.

- Rulebook 2023 p.3: "▪ Threshold (3) denotes how much affinity is required to play a card."
- Manual p.13: "Affinity: To have the ability to play a card, a player"
- Rulebook 2023 p.3: "▪ Stats (5) which denote power and health, respectively."
- Manual p.12: "Denote the power and defense"
- Rulebook 2023 p.3: "▪ Cards with no icon (9) can only be played during the main"
- Manual p.13: "Cards with no icon can only be played during deployment."
- R97: "So **the printed "mana step" IS this engine's R18 haste step**, and Dispatch Courier"

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

- RAQ 1464899726796390433#1: "haste basically says 'This card can be played during the haste step in addition to its other timings'"
- RAQ 1464899726796390433#0: "it's gotta be no"

**Resolution:** The designer's later answer reverses his earlier one, and the [Solved] Dispatch Courier write-up agrees with the later one. The register marks the 2025 claim outdated. The rule states the later answer. A judge's CR that cites the 2025 screenshot will disagree.

### D-U05-4 · RAQ open · rule 207.4a

Whether gaining Haste changes a banner play mode (Ambush, Prophecy) is only assumed in the thread, never answered.

- RAQ 1464899726796390433#2: "I assume that gaining :haste: doesn't affect 'playmode' like Ambush or Prophecy"

**Resolution:** Not stated as a rule: an assumption in a thread with no designer answer on the point. Question for the owner only if a card can grant Haste to a card while its banner mode is the play being made.

### D-U05-5 · RAQ open · rule 206.5

What happens to two base stats swapped by Body Swap when the Aberrant Statweaver that set one of them leaves play is open in the RAQ thread.

- RAQ 1357965714807586897#2: "Ruling for this is still under consideration"

**Resolution:** Not stated. The rule says only that a later base rewrite wins while both apply. Question for the owner only if the designer does not rule.

### D-U05-7 · Other · rule 204.3

The sources are silent on what a subtype does in play. They say only which words are subtypes.

- R240: "spurious token is, by construction, a population-of-one subtype. The pool has twenty real"

**Resolution:** The rule says only what subtypes are. A card that names a subtype says what it does with it.

### D-U05-8 · Other · rule 206.2

The sources are silent on whether a spell has a power or defense. They say stats mark a unit.

- Rulebook 2023 p.3: "Units are permanents, meaning when summoned, they will stay in play until removed. They can be easily recognized by the existence of stats on the card (5)."

**Resolution:** The rule says only that stats mark a unit and that spell units have them. The card data gives 91 spells stat values: F-U05-1.

### D-U05-9 · Other · rule 203.1

The sources are silent on whether a "Discard me" line (Sacrifice Dude, Dropslime, Nothyr) is printed in an alternative-cost banner like Ambush and Prophecy.

- R65 (its discard-me half): "me"* line as an alternative play MODE, and inherited the card's own timing with"

**Resolution:** This document treats "Discard me" under 207.8 and 801, not 203, because discarding is not playing (R37, R65). Where it is printed is a question for the scans, not a ruling.

### D-U06-11 · Sources disagree · rule 305.1

Print says a modified card is treated as one card with its mods' text. Caleb's answer quoted in R89 says a mod on a spell gives it only attributes.

- Manual p.32: "When a card is augmented, it is treated as if it were a single"
- Rulebook 2023 p.15: "When a card is modified, it is simply treated as if it"
- R89: "you can only do this with attributes."

**Resolution:** The designer's words win under the authority order: the general rule stands for units, and a modified spell or spell token gains only attributes. Stated in types.mods.what and in 721.

### D-U06-12 · Other · rule 300.1

Sources silent on a single list of card types. The printed books treat resources as cards ("RESOURCE CARDS", "non-token, non-resource cards") but describe units, spells and spell units separately.

- Manual p.5: "RESOURCE CARDS"
- Rulebook 2023 p.6: "During the draft step, players combine all of the non-token, non-resource cards in their hand with the pack and can draft a"
- Rulebook 2023 p.3: "There are also spell units, which have a one time effect like spells but"

**Resolution:** The rule scopes the three types to non-resource cards and points resources at 106. No source decides whether "resource" is a fourth card type or a category of its own.

### D-U06-2 · Sources disagree · rule 304.10

The Manual says a token that leaves play goes back to the token pile instead of the hand or bin. The designer (RAQ write-up) says a recalled or dying token enters the hand or bin and is then erased.

- Manual p.15: "into the token pile instead of the hand or bin."
- Manual p.15: "erased from the game and returned to the token pile."
- RAQ 1355689559609839787#4: "3. Same applies to Unit Tokens being Recalled or Dying (they enter your hand/bin and then are instantly erased)"

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

**Resolution:** Both are stated. types.units.no-summoning-sickness states only that there is no waiting period; types.units.spawn-in-battle puts a mid-battle arrival outside of formation for that battle. The Q&A is read as being about later attacks. No test shows a newly arrived unit attacking in a later battle round; the verifier should check.

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

### D-U08-2 · Sources disagree · rule 502.3

Manual p.18 says the planning phase ends once everyone has created and activated resources, yet the same page puts the haste step after the resource step and p.27 lists the haste step as the fifth planning step.

- Manual p.18: "The planning phase ends when all players have created and activated their desired resources."
- Manual p.18: "After the resource step is the very short haste step, where players can only play"
- R97: "2. `legalActions`' `phase === 'planning' && s.hasteDone` branch — the client's affordance."

**Resolution:** This document reads the p.18 sentence as the end of the resource step and places the haste step as the last step of the planning phase (turn.haste.what), per p.27 and the engine's phase model quoted in R97. No rules consequence found: nothing in the pack depends on whether the haste step is "in" planning.

### D-U08-3 · Sources disagree · rule 504.1

Rulebook 2023 p.7 has a single "mana step" in which players take resources and play haste cards. The Manual splits it into a resource step and a later haste step. R97 equates the printed "mana step" with the haste step alone, but the Prismite card says its exchange may be done "only during the mana step", and R17 and the engine place the exchange in the resource step.

- Rulebook 2023 p.7: "The mana step is when players have the ability to take and play resources, as well as"
- Manual p.18: "After the resource step is the very short haste step, where players can only play"
- R97: "So **the printed "mana step" IS this engine's R18 haste step**, and Dispatch Courier"
- R132: "during the mana step. {i}(This does not use one of your activations for turn.)""
- R17: "exchange: during planning, an **active** (face-up) Prismite may be swapped for a"

**Resolution:** The Manual supersedes Rulebook 2023 where they differ (data/rules/README.md), so the two-step order stands (turn.planning.steps). Read "mana step" on a card as the Rulebook defines it, the resource step and the haste step together; R97's equation is too narrow, though harmless for Dispatch Courier, whose grant only matters where plays happen (the haste step). Question for the owner only if a Prismite exchange should also be legal during the haste step: the card's "Do this only during the mana step" would allow it under the Rulebook's definition, while turn.resource.actions.exchange places it in the resource step.

### D-U08-4 · Sources disagree · rule 504.7

The RAQ write-up on Dispatch Courier says the unit is played "despite gaining" haste; R123 says a play "as if it had [Haste]" is timing only and the unit never carries the attribute.

- RAQ 1465292396664193171#0: "No, despite gaining :haste: they can still only be played during :battle:."
- R123: "it had [Haste]" is TIMING ONLY — the played unit never carries the attribute."

**Resolution:** The RAQ answers a timing question and its "gaining" is incidental wording; turn.haste.grants states only the timing, which both sides agree on. Question for the owner only if a card ever reads whether a unit in play has [Haste]: then the RAQ wording (the authority) would say the granted unit has it.

### D-U08-8 · Other · rule 504.2a

calebgannon reversed his own earlier answer: in 2025 he said haste adds the haste step to a card's timings, so a battle card with haste works there; on 2026-01-25 he said battle cards stay battle-only. The register marks the earlier claim OUTDATED.

- RAQ 1464899726796390433#1: "haste basically says 'This card can be played during the haste step in addition to its other timings'"
- RAQ 1464899726796390433#0: "it's gotta be no"

**Resolution:** The later designer answer, and the [Solved] write-up (RAQ 1465292396664193171#0), govern. turn.haste.plays.battle-stays states them.

### D-U09-10 · Sources disagree · rule 508.3a

The printed sources place the pack pass in two places. Manual p.16 and Rulebook 2023 p.6 have each player pass their pack clockwise when they finish drafting, ending the draft step. Manual p.26 and Rulebook 2023 p.5 list "any draft packs" as passed with the initiative when the turn ends.

- Manual p.16: "sure the pack contains 10 cards and pass it clockwise"
- Manual p.26: "The initiative token and any draft packs are passed to"
- Rulebook 2023 p.6: "Once you have finished a draft portion, you will pass your pack clockwise to the next player as an indicator that you are finished."
- Rulebook 2023 p.5: "After the main phase, the turn is over. The initiative and any draft packs are passed to the next player in a clockwise direction"
- Manual p.16: "player will draft a second time from the pack they were"

**Resolution:** One pass per turn, not two: the N+1 refresh cycle on p.16 (in 1v1 a player drafts from their first pack again on turn 3) only works if packs move once a turn. The CR follows the detailed draft section (p.16), which the client also does; the turn-end listing names the same pass. A pack is used only in the draft step, so the timing changes nothing a player can do. Not a question for the owner.

### D-U09-11 · Other · rule 507.2a

The designer says grafting is always a deployment action, whatever the card's speed. Slurpr prints a grant to apply other mods in the haste step as if it were deployment, and R95 reads "other mods" as grafts as well as augments (R37's word for both). The earlier draft of this rule said "never in the haste step" without the card exception.

- RAQ 1355115946032889914#0: "Yes. Always in deployment. No matter what cards speed is"
- card: Slurpr: "[Augment] You can apply other mods during [Haste] as if it was deployment."
- R95: "**"Other mods" is augments AND grafts** — R37's word for both — which is why `ctx.kind` is"

**Resolution:** No conflict once read as general rule and card exception: the RAQ answers a question about the card's own speed, and Slurpr is an explicit grant. The rule states the deployment default and the Slurpr-style exception; the engine agrees (verifier r2 probe). Not a question for the owner.

### D-U09-5 · RAQ open · rule 505.3e

R15's heading says it is "resolved by RAQ 'Temporal Rift vs NIT sending counter-attack'". That thread is still open ([Considered]); its relevant claim (#2) sits in an open thread and is not a ruling.

- R15: "## R15 ⚠ — Round-2 attackers when round 1 had no battle (⚠ resolved by RAQ "Temporal Rift vs NIT sending counter-attack")"
- RAQ 1353986897902567424#2: "Counter-attacks ARE allowed even if IT players decides to Pass his attack opportunity."

**Resolution:** No change to the rule. Its first sentence rests on Manual p.20's NOTE, which states it outright. The "any of its units" half stays R15's engine call. The R15 heading overstates its source; flag it for the register.

### D-U09-7 · Other · rule 506.2

R11 says regroup runs in a set order and takes the order from Manual p.7, with spell-token erasure added at the end. Manual p.26 lists the same five things with tokens erased fourth and formation left fifth, and it does not say the list is an order. R11 itself says to verify the order when it first matters in play.

- R11: "detailed regroup section confirms this exact sequence when it first matters in play."
- Manual p.26: "All Spell Tokens are erased"
- Manual p.7: "temporary stat changes are removed, and units"

**Resolution:** No observable difference is known, and the CR keeps R11's order. The R11 test checks only the end state (F-U09-2), so nothing would notice if the order changed. Question for the owner only if a card is found whose outcome depends on the order.

### D-U09-8 · Other · rule 508.3a

Print passes the draft packs with the initiative when the turn ends. The client passes them when both players commit their draft step.

- Manual p.26: "The initiative token and any draft packs are passed to"
- file: client/engine/test/20-draft.test.ts: "no-op commit preserves hand and pack exactly; both commits pass the packs"

**Resolution:** Superseded by D-U09-10: Manual p.16 itself puts the pass in the draft step, which is what the client does. The rule now states the p.16 timing.

### D-U09-9 · Other · rule 508.3

Sources silent on test coverage: no test asserts that the initiative changes hands between turns. The printed rule is plain; the gap is evidence, not law.

- Rulebook 2023 p.5: "teams trade off having the initative every turn"

**Resolution:** The tester should add a CR example test (420) asserting that the initiative alternates across a turn boundary.

### D-U10-1 · Sources disagree · rule 601.8

The Manual says there is 'zero information' between regions, and Caleb (quoted in R91) says nothing can send information across regions; R243 rules that regions do NOT scope information, so a player may read what happens in a region they are not in.

- Manual p.19: "regions. This means there is zero information or interaction between regions."
- R91: "**the single rule we'll never violate is 'nothing can send information across"
- R243: "Regions do NOT scope information, but they do scope 'global' things (every"

**Resolution:** The printed sentence and Caleb's words outrank R243, but their words support two readings: (1) no EFFECT may carry information from one region into another, which is what Caleb's surrounding quotes in R91 are about ('can something be done with units across regions? the answer is no') and which R243 keeps; (2) a PLAYER must not learn what happens in a region they are not in, which R243 §2 contradicts. The rule follows R243 under reading (1); at a physical table every region is in plain view. Question for the owner only if reading (2) was meant.

### D-U10-2 · Other · rule 603.2a

Sources silent on whether a unit is adjacent to the enemy unit facing it across its column. The Manual's 'front and back neighbors' could name the other row of the unit's own column, or the opposing unit in front of it; R75 fixes the three positions inside one formation; a test comment calls a facing blocker 'an adjacent ENEMY'.

- Manual p.22: "adjacent to their left, right, front and back neighbors until"
- R75: "it's referring to its sides and above/below. Nothing diagonal."
- file: client/engine/test/18-earth-c.test.ts: "// an adjacent ENEMY"

**Resolution:** The rule follows R75: adjacency is within the unit's own formation. The Manual sentence describes one formation and its two rows, and Manual p.23 puts blockers 'in front of the formation that is attacking them', not in it. Question for the owner only if a card is meant to count the facing enemy as adjacent (Electric's 'directed to an adjacent unit' is the likeliest place; see 802.17). See F-U10-2.

### D-U10-5 · Other · rule 601.2a

The register says the stack is not in any region and is deliberately global (R250, R265), while the printed rule says every effect is specific to its region, and R12 speaks of 'that region's battle and stack'.

- R250: "The STACK is not regional and is deliberately left global"
- R12: "effect (Temporal Rift) affects only that region's battle and stack — other regions resolve"
- Manual p.19: "Every single effect is specific to the region it takes"

**Resolution:** No conflict in play today. Battle is resolved one region at a time (Manual p.21), and during deployment each seat has its own stack (R286), so the stack only ever holds one region's items. The rule states that the stack has no region and does not use R12's Temporal Rift clause. Question for the owner only if regions are ever resolved at the same time (the Manual's table shortcut on p.21) or games with more than two players are supported.

### D-U10-6 · Other · rule 602.6f

Sources silent on a remembered formation that holds no living unit: a source that attacked alone and died under its own trigger before blocks leaves a line that has closed to nothing. The designer says Hooba-style effects remember the formation and work; R75 says a formation with no living unit cannot be joined; R184 says an emptied formation is still a formation while its battle runs.

- RAQ 1353895783266516992#2: "But there are some which will remember they were in formation and will work fine (Hooba-Bot, Hooba-Pon, Hooba-Lin, Embermaw Fledgling, Lumengrove Lurker)."
- R75: "always grow at an end. A formation you are not standing in cannot be joined at"
- R184: "legal exactly while its battle runs; **emptying it does not remove it**"

**Resolution:** The rule states the designer's answer: the effect places into the formation the source was in. R75's 'no slots' answer predates R325. Question for the owner only if a lone source that dies under its own trigger is meant to place nothing.

### D-U11-11 · Other · rule 604.4

A declined attack fights no combat, but the engine still counts the round as a completed battle for 'One Battle Passes'. R43 says both battles in a turn tick it, without saying whether a round with no attack is one of them.

- R43: "battles in a turn tick "One Battle Passes" (Caleb 2024-09-24)."
- R194: "A declined attack fights no combat, so there is no"

**Resolution:** The rule says 'no combat', not 'no battle', so it does not contradict the engine's count. Question for the owner only if 'both battles in a turn' should exclude a battle round in which nobody attacked: the words support 'both battle rounds' and 'both battles actually fought'.

### D-U11-4 · RAQ open · rule 604.4a

The only designer-thread claim that the non-initiative player may attack after the initiative player declines is in the Temporal Rift thread, which is still open ([Considered]). The claim is _passer's, and the thread's open question (Temporal Rift) is a different one.

- RAQ 1353986897902567424#2: "Counter-attacks ARE allowed even if IT players decides to Pass his attack opportunity."
- Manual p.20: "The NIT can still declare attacks even if the IT decides not to attack."

**Resolution:** The rule rests on the printed Manual note and on R15, not on the open thread. Revisit when the thread is solved. 'Any of its units' is R15's alone (owner call).

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

**Resolution:** The Q&A answers summoning sickness; the round-2 pool is the more specific printed rule (combat.attack.declaring.round-two, R15). No change.

### D-U11-9 · Engine only · rule 604.3c

Sources silent on exactly when 'When I attack' and 'When I block' triggers reach the stack relative to the following priority window, and on when 'After the blocking step' resolves. Only R84 (for Alluring: it goes on the stack and can be negated) and the tests say so. The same applies to combat.blocks.triggers and combat.block-window.after-blocking-triggers.

- card: Palewing: "When I attack or block, [Switch1] Discard a card."
- card: Roving Quillback: "[Augment] After the blocking step, I deal 1 damage to each opponent for each blocked column."
- R84: "It goes on the stack and can be negated."

**Resolution:** The rules state the timing the tests show (the trigger is on the stack when the attack window or block window opens) and are marked medium confidence. The general ordering of triggers is section 706.

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
