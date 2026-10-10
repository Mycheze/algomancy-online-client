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

The rulings are not classified yet.

### Process rulings, excluded

The rulings are not classified yet.

## Glossary

*No entries yet.*

## Changelog

Keyed by rule key. A number never moves, so a rule is new, removed or renamed; text changes to a rule are not listed yet.

### First generation (draft)

- New: 26 rules and 99 sections.
