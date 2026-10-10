# Algomancy Comprehensive Rules

*Unofficial. Generated from this project's digital client.*

## Introduction

**This document is UNOFFICIAL.** It describes this digital client's
implementation of Algomancy, not Caleb Gannon's game. Where it and the
published Manual disagree, the Manual is the game and this document is our
client. The card text and rules text it quotes are Caleb Gannon's, used with
permission on the terms in `data/NOTICE.md`.

Edition: First generation (draft). Effective 2026-10-10. Engine at commit 76d01fa.

### How to read a rule

Every rule carries its provenance: the sources that state it. In the HTML
edition it is folded under the rule; in this edition it is the small line
beneath it. Each rule also carries a **basis**, the strongest kind of source
that actually states it:

- **Printed**: the Manual, the 2023 Rulebook or a card's printed text, read literally.
- **Designer**: Caleb Gannon's own answer in the rules-questions threads.
- **Mixed**: more than one kind of source states it together.
- **Owner call**: a ruling by this project's owner, with no designer source.
  It is the client's law, and it may not be the game's.
- **Engine only**: no source states it; it is what the engine does. These rules
  are listed in Annex P and await the owner's sign-off.

Our own glossary is quoted where it helps, and is never counted as a source.

Where a ruling and the engine disagree, the rule states the ruling and says
"engine differs", with a link to the finding. The engine is the one that is
wrong, and the finding is filed as a bug.

Each rule also shows whether an independent verifier confirmed it against the
engine and its tests, and in which round.

### Examples are not rules

An example illustrates the rule above it. It is never a rule in its own
right, and where it seems to say more than the rule, the rule wins. Most
examples are bound to a test that was run and asserts them.

### How numbering works

Rules are numbered in three levels: section 608, rule 608.2, subrule 608.2b.
Subrule letters skip l and o. A number, once published, never moves and is
never reused. A new rule goes to the end of its section, even when it would
read better earlier. A removed rule keeps its number and reads
"[Removed: …]". Section 802 has one rule per attribute, in the engine's own
order.

## Contents

- 1. Game Concepts
  - [100. General](#r100)
  - [101. Golden Rules](#r101)
  - [102. Players, Ownership and Control](#r102)
  - [103. Starting the Game](#r103)
  - [104. Ending the Game](#r104)
  - [105. Elements and Affinity](#r105)
  - [106. Resources](#r106)
  - [107. Numbers, X and Symbols](#r107)
  - [108. Cards, Tokens, Faces and Copies](#r108)
  - [109. Abilities](#r109)
  - [110. Targets](#r110)
  - [111. Costs](#r111)
  - [112. Life, Damage, Rot and Debt](#r112)
  - [113. Timestamps](#r113)
- 2. Parts of a Card
  - [200. General](#r200)
  - [201. Name](#r201)
  - [202. Cost Orb and Pips](#r202)
  - [203. Alternative-Cost Banner](#r203)
  - [204. Type Line](#r204)
  - [205. Text Box and Bracketed Text](#r205)
  - [206. Power and Defense](#r206)
  - [207. Timing Glyph](#r207)
  - [208. Augment Box](#r208)
  - [209. Complexity Glyph](#r209)
- 3. Card Types
  - [300. General](#r300)
  - [301. Units](#r301)
  - [302. Spells](#r302)
  - [303. Spell Units](#r303)
  - [304. Tokens](#r304)
  - [305. Modifications](#r305)
- 4. Zones
  - [400. General](#r400)
  - [401. Deck](#r401)
  - [402. Hand](#r402)
  - [403. Cache](#r403)
  - [404. Play](#r404)
  - [405. Bin](#r405)
  - [406. The Stack](#r406)
  - [407. Erased Pile](#r407)
  - [408. Recycling](#r408)
  - [409. The Pack](#r409)
  - [410. Zone Changes](#r410)
- 5. Turn Structure
  - [500. General](#r500)
  - [501. Planning Phase](#r501)
  - [502. Resource Step](#r502)
  - [503. Draw and Draft Step](#r503)
  - [504. Haste Step](#r504)
  - [505. Battle Phase](#r505)
  - [506. Regroup Phase](#r506)
  - [507. Deployment Phase](#r507)
  - [508. Passing the Initiative](#r508)
- 6. Regions, Formations and Battle
  - [600. General](#r600)
  - [601. Regions](#r601)
  - [602. Formations](#r602)
  - [603. Columns, Adjacency and Edges](#r603)
  - [604. Attacking](#r604)
  - [605. Attack Window](#r605)
  - [606. Blocking](#r606)
  - [607. Block Window](#r607)
  - [608. Combat Damage Step](#r608)
  - [609. After Combat](#r609)
  - [610. Counterattacks and Later Battle Rounds](#r610)
- 7. Spells, Abilities and Effects
  - [700. General](#r700)
  - [701. Playing and Applying](#r701)
  - [702. Casting Spells](#r702)
  - [703. The Stack and Priority](#r703)
  - [704. Resolution and Fizzling](#r704)
  - [705. Activated Abilities](#r705)
  - [706. Triggered Abilities](#r706)
  - [707. Static Abilities](#r707)
  - [708. Replacement and Prevention Effects](#r708)
  - [709. Continuous Effects and Timestamps](#r709)
  - [710. Copies and Faces](#r710)
  - [711. Control Change](#r711)
  - [712. Stripping and Suppression](#r712)
  - [713. State Checks](#r713)
  - [714. Last-Known State](#r714)
  - [720. Modifications, General](#r720)
  - [721. Augment](#r721)
  - [722. Graft](#r722)
  - [723. Virus](#r723)
  - [724. Modular](#r724)
- 8. Keywords
  - [800. General](#r800)
  - [801. Keyword Actions](#r801)
  - [802. Attributes](#r802)
  - [803. Other Keyword Abilities](#r803)
- 9. Multiplayer and Formats
  - [900. General](#r900)
  - [901. Constructed](#r901)
  - [902. Draft and Cube](#r902)
  - [903. Free-for-All](#r903)
  - [904. Teams](#r904)
  - [905. Intent Cards](#r905)
- Annex P — Provenance and Coverage
- Glossary
- Changelog
- Annex D — Digital Play Conventions (a separate document)

## 1. Game Concepts

<a id="r100"></a>
### 100. General

*No rules drafted yet.*

<a id="r101"></a>
### 101. Golden Rules

*No rules drafted yet.*

<a id="r102"></a>
### 102. Players, Ownership and Control

*No rules drafted yet.*

<a id="r103"></a>
### 103. Starting the Game

*No rules drafted yet.*

<a id="r104"></a>
### 104. Ending the Game

*No rules drafted yet.*

<a id="r105"></a>
### 105. Elements and Affinity

*No rules drafted yet.*

<a id="r106"></a>
### 106. Resources

*No rules drafted yet.*

<a id="r107"></a>
### 107. Numbers, X and Symbols

*No rules drafted yet.*

<a id="r108"></a>
### 108. Cards, Tokens, Faces and Copies

*No rules drafted yet.*

<a id="r109"></a>
### 109. Abilities

*No rules drafted yet.*

<a id="r110"></a>
### 110. Targets

*No rules drafted yet.*

<a id="r111"></a>
### 111. Costs

*No rules drafted yet.*

<a id="r112"></a>
### 112. Life, Damage, Rot and Debt

*No rules drafted yet.*

<a id="r113"></a>
### 113. Timestamps

*No rules drafted yet.*

## 2. Parts of a Card

<a id="r200"></a>
### 200. General

*No rules drafted yet.*

<a id="r201"></a>
### 201. Name

*No rules drafted yet.*

<a id="r202"></a>
### 202. Cost Orb and Pips

*No rules drafted yet.*

<a id="r203"></a>
### 203. Alternative-Cost Banner

*No rules drafted yet.*

<a id="r204"></a>
### 204. Type Line

*No rules drafted yet.*

<a id="r205"></a>
### 205. Text Box and Bracketed Text

*No rules drafted yet.*

<a id="r206"></a>
### 206. Power and Defense

*No rules drafted yet.*

<a id="r207"></a>
### 207. Timing Glyph

*No rules drafted yet.*

<a id="r208"></a>
### 208. Augment Box

*No rules drafted yet.*

<a id="r209"></a>
### 209. Complexity Glyph

*No rules drafted yet.*

## 3. Card Types

<a id="r300"></a>
### 300. General

*No rules drafted yet.*

<a id="r301"></a>
### 301. Units

*No rules drafted yet.*

<a id="r302"></a>
### 302. Spells

*No rules drafted yet.*

<a id="r303"></a>
### 303. Spell Units

*No rules drafted yet.*

<a id="r304"></a>
### 304. Tokens

*No rules drafted yet.*

<a id="r305"></a>
### 305. Modifications

*No rules drafted yet.*

## 4. Zones

<a id="r400"></a>
### 400. General

*No rules drafted yet.*

<a id="r401"></a>
### 401. Deck

*No rules drafted yet.*

<a id="r402"></a>
### 402. Hand

*No rules drafted yet.*

<a id="r403"></a>
### 403. Cache

*No rules drafted yet.*

<a id="r404"></a>
### 404. Play

*No rules drafted yet.*

<a id="r405"></a>
### 405. Bin

*No rules drafted yet.*

<a id="r406"></a>
### 406. The Stack

*No rules drafted yet.*

<a id="r407"></a>
### 407. Erased Pile

*No rules drafted yet.*

<a id="r408"></a>
### 408. Recycling

*No rules drafted yet.*

<a id="r409"></a>
### 409. The Pack

*No rules drafted yet.*

<a id="r410"></a>
### 410. Zone Changes

*No rules drafted yet.*

## 5. Turn Structure

<a id="r500"></a>
### 500. General

*No rules drafted yet.*

<a id="r501"></a>
### 501. Planning Phase

*No rules drafted yet.*

<a id="r502"></a>
### 502. Resource Step

*No rules drafted yet.*

<a id="r503"></a>
### 503. Draw and Draft Step

*No rules drafted yet.*

<a id="r504"></a>
### 504. Haste Step

*No rules drafted yet.*

<a id="r505"></a>
### 505. Battle Phase

*No rules drafted yet.*

<a id="r506"></a>
### 506. Regroup Phase

*No rules drafted yet.*

<a id="r507"></a>
### 507. Deployment Phase

*No rules drafted yet.*

<a id="r508"></a>
### 508. Passing the Initiative

*No rules drafted yet.*

## 6. Regions, Formations and Battle

<a id="r600"></a>
### 600. General

*No rules drafted yet.*

<a id="r601"></a>
### 601. Regions

*No rules drafted yet.*

<a id="r602"></a>
### 602. Formations

*No rules drafted yet.*

<a id="r603"></a>
### 603. Columns, Adjacency and Edges

*No rules drafted yet.*

<a id="r604"></a>
### 604. Attacking

*No rules drafted yet.*

<a id="r605"></a>
### 605. Attack Window

*No rules drafted yet.*

<a id="r606"></a>
### 606. Blocking

*No rules drafted yet.*

<a id="r607"></a>
### 607. Block Window

*No rules drafted yet.*

<a id="r608"></a>
### 608. Combat Damage Step

*No rules drafted yet.*

<a id="r609"></a>
### 609. After Combat

*No rules drafted yet.*

<a id="r610"></a>
### 610. Counterattacks and Later Battle Rounds

*No rules drafted yet.*

## 7. Spells, Abilities and Effects

<a id="r700"></a>
### 700. General

*No rules drafted yet.*

<a id="r701"></a>
### 701. Playing and Applying

*No rules drafted yet.*

<a id="r702"></a>
### 702. Casting Spells

*No rules drafted yet.*

<a id="r703"></a>
### 703. The Stack and Priority

*No rules drafted yet.*

<a id="r704"></a>
### 704. Resolution and Fizzling

*No rules drafted yet.*

<a id="r705"></a>
### 705. Activated Abilities

*No rules drafted yet.*

<a id="r706"></a>
### 706. Triggered Abilities

*No rules drafted yet.*

<a id="r707"></a>
### 707. Static Abilities

*No rules drafted yet.*

<a id="r708"></a>
### 708. Replacement and Prevention Effects

*No rules drafted yet.*

<a id="r709"></a>
### 709. Continuous Effects and Timestamps

*No rules drafted yet.*

<a id="r710"></a>
### 710. Copies and Faces

*No rules drafted yet.*

<a id="r711"></a>
### 711. Control Change

*No rules drafted yet.*

<a id="r712"></a>
### 712. Stripping and Suppression

*No rules drafted yet.*

<a id="r713"></a>
### 713. State Checks

*No rules drafted yet.*

<a id="r714"></a>
### 714. Last-Known State

*No rules drafted yet.*

<a id="r720"></a>
### 720. Modifications, General

*No rules drafted yet.*

<a id="r721"></a>
### 721. Augment

*No rules drafted yet.*

<a id="r722"></a>
### 722. Graft

*No rules drafted yet.*

<a id="r723"></a>
### 723. Virus

*No rules drafted yet.*

<a id="r724"></a>
### 724. Modular

*No rules drafted yet.*

## 8. Keywords

<a id="r800"></a>
### 800. General

*No rules drafted yet.*

<a id="r801"></a>
### 801. Keyword Actions

*No rules drafted yet.*

<a id="r802"></a>
### 802. Attributes

<a id="r802.1"></a>**802.1. General.**

<a id="r802.2"></a>**802.2. Flying.**

<a id="r802.3"></a>**802.3. Deadly.**

<a id="r802.4"></a>**802.4. Swift.**

<a id="r802.5"></a>**802.5. Sluggish.**

<a id="r802.6"></a>**802.6. Tough.**

<a id="r802.7"></a>**802.7. Balanced.**

<a id="r802.8"></a>**802.8. Inverted.**

<a id="r802.9"></a>**802.9. Unaware.**

<a id="r802.10"></a>**802.10. Powerful.**

<a id="r802.11"></a>**802.11. Vulnerable.**

<a id="r802.12"></a>**802.12. Feeble.**

<a id="r802.13"></a>**802.13. Evasive.**

<a id="r802.14"></a>**802.14. Sneaky.**

<a id="r802.15"></a>**802.15. Alluring.**

<a id="r802.16"></a>**802.16. Piercing.**

<a id="r802.17"></a>**802.17. Electric.**

<a id="r802.18"></a>**802.18. Poisonous.**

<a id="r802.19"></a>**802.19. Resonant.**

<a id="r802.20"></a>**802.20. Thieving.**

<a id="r802.21"></a>**802.21. Reaping.**

<a id="r802.22"></a>**802.22. Blessed.**

<a id="r802.23"></a>**802.23. Afflicting.**

<a id="r802.24"></a>**802.24. Lethal.**

<a id="r802.25"></a>**802.25. Pure.**

<a id="r802.26"></a>**802.26. Modular.**

<a id="r803"></a>
### 803. Other Keyword Abilities

*No rules drafted yet.*

## 9. Multiplayer and Formats

<a id="r900"></a>
### 900. General

*No rules drafted yet.*

<a id="r901"></a>
### 901. Constructed

*No rules drafted yet.*

<a id="r902"></a>
### 902. Draft and Cube

*No rules drafted yet.*

<a id="r903"></a>
### 903. Free-for-All

*No rules drafted yet.*

<a id="r904"></a>
### 904. Teams

*No rules drafted yet.*

<a id="r905"></a>
### 905. Intent Cards

*No rules drafted yet.*

## Annex P — Provenance and Coverage

Generated from the records, the verdicts and the ruling classification. Nothing here is a rule.

### Basis

0 numbered rules.

| basis | rules |
|---|---|
| Printed | 0 |
| Designer | 0 |
| Owner call | 0 |
| Engine only | 0 |
| Mixed | 0 |

### Verification

| verdict | rules |
|---|---|
| confirmed | 0 |
| partial | 0 |
| contradicted | 0 |
| unsupported | 0 |
| untested | 0 |
| not verified | 0 |
| text changed | 0 |

### Engine-only rules (awaiting the owner's sign-off)

None.

### Findings: where the engine differs

None.

### Game rulings no rule cites

R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R35, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62, R63, R64, R65, R66, R67, R68, R69, R70, R71, R72, R73, R74, R75, R76, R77, R78, R79, R80, R81, R82, R83, R84, R86, R87, R88, R89, R90, R91, R92, R93, R94, R95, R96, R97, R98, R99, R100, R101, R102, R103, R104, R105, R106, R107, R108, R110, R111, R112, R113, R114, R115, R116, R117, R118, R119, R120, R121, R122, R123, R124, R125, R126, R127, R128, R129, R130, R131, R132, R133, R137, R140, R143, R144, R145, R146, R147, R148, R152, R153, R154, R156, R157, R158, R160, R161, R162, R164, R165, R166, R167, R168, R172, R178, R179, R184, R185, R187, R190, R191, R194, R195, R196, R197, R197b, R198, R206, R207, R208, R212, R216, R219, R221, R223, R224, R225, R226, R227, R228, R237, R238, R239, R240, R243, R244, R250, R256, R261, R262, R263, R264, R265, R268, R269, R270, R277, R278, R281, R282, R283, R284, R286, R289, R291, R293, R294, R295, R296, R299, R300, R301, R302, R303, R304, R305, R306, R307, R308, R309, R311, R313, R314, R315, R316, R317, R318, R319, R320, R321, R322, R323, R324, R325, R326, R328, R329, R331, R332, R333, R334, R335, R336, R337, R338, R339, R340, R341, R342

### Process rulings, excluded

- R155: a `{ todo: true }` test is not a record of anything, and a static can be a park too
- R169: A replay that misreports is a tool that manufactures wrong conclusions
- R171: a gated promise needs evidence from a run that could satisfy its gate
- R173: a guard that cannot reach the reported code path is not a guard
- R174: a park note is a claim with a DATE on it, and three of them had outlived their reason
- R180: the [Augment] box and the trigger fixtures: 218 unchecked printed promises down to 52
- R181: a check that never ran is worse than no check, because the config is what everyone reads as proof
- R182: a conformance drive must not depend on behaviour it is not testing; and what a guard DRIVES cannot tell you what it GUARDS
- R193: an exemption list that nothing checks is a blanket; and the sweep that says "clean" over `ui/` is not looking
- R199: The card was already in the battle. Nothing was waiting for it there.
- R200: a saved game names the engine that recorded it, and a divergence is measured rather than bounded
- R201: `${ … }` inside a template literal is CODE, and every sweep in the repo rests on knowing that
- R203: a secrecy assertion must be able to fail, so the test log grew seats
- R204: A test may not hold a resource it is not using, nor believe a view that has a message still in flight
- R210: (CT-83) — an exemption list is a claim about the code, and six of them had nothing checking it
- R211: an evidence window that never closed is INCONCLUSIVE, not evidence
- R214: the card pool is 495, and eight pool-wide sweeps could only see 494
- R215: a ruling number cited in the code must resolve to a ruling
- R217: two readings of the same text that agree are not two pieces of evidence
- R218: twenty-four scenarios, four authors, one keyspace: what parallel authoring needs
- R220: rank scenarios by how RARE the action is, and build every board out of two rules meeting
- R231: the absorb rule lives in one place, and the lint keys on SHAPE not on NAME
- R232: the drill refuses a second activation instead of overwriting the first
- R233: a warning box is not a control: docs/13's own numbers are now asserted
- R234: the register is checked in BOTH directions: an open ticket may not contradict a settled ruling
- R259: A BLANK ANSWER LINE IS NOT PROOF A QUESTION IS OPEN
- R260: `partial` IS NOT `live`, AND FOLDING THEM MADE A GUARD PUSH FOR THE BUG IT EXISTS TO CATCH
- R275: a recovery command names its paths from the constants, or it rots
- R285: a verdict is a report, and it gets the same lock

## Glossary

*No entries yet.*

## Changelog

Keyed by rule key. A number never moves, so a rule is new, removed or renamed; text changes to a rule are not listed yet.

### First generation (draft)

- New: 26 rules and 99 sections.
