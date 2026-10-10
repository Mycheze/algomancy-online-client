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

<a id="r400.1"></a>**400.1.** The zones of the game are the deck, the hand, the cache, play, the bin, the stack, the erased pile, the recycle pile and the pack. See rules 401, 402, 403, 404, 405, 406, 407, 408, 409.

> *Example (non-normative): The engine keeps cards in exactly nine zones: deck, hand, cache, play, bin, stack, erased pile, recycle pile and pack.* <sub>test: 418-cr-zones.test.ts::cr:zones.general.list — the engine keeps cards in exactly nine zones: deck, hand, cache, play, bin, stack, erased pile, recycle pile and pack</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16 · Rulings: R145, R145, R296 · Tests: 418-cr-zones.test.ts · Key: zones.general.list</sub>

<sub>Discrepancies: D-U07-11 (discrepancies.md)</sub>

<a id="r400.2"></a>**400.2.** Play and the stack are the active zones. The hand, the deck, the bin, the cache and the erased pile are inactive zones. See rules 404, 406, 803.

> *Example (non-normative): A printed Unstable card is erased leaving play or the stack, and only binned leaving the hand, the deck or the cache.* <sub>test: 418-cr-zones.test.ts::cr:zones.general.active — a printed Unstable card is erased leaving play or the stack, and only binned leaving the hand, the deck or the cache</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R145, R145 · Tests: 418-cr-zones.test.ts · Key: zones.general.active</sub>

<sub>Discrepancies: D-U07-9 (discrepancies.md)</sub>

<a id="r400.2a"></a>**400.2a** Whether a zone is active matters to {Unstable}: an {Unstable} card is erased in place of entering a bin only when it leaves an active zone. A card leaving an inactive zone for a bin is binned normally, {Unstable} or not. See rules 405, 803.

> *Example (non-normative): Aberrant Statweaver (printed {Unstable}) discarded from a hand goes to the bin and stays there: the hand is inactive.* <sub>test: 125-active-zone.test.ts::R145: a printed-Unstable card DISCARDED FROM HAND bins and TRASHES — hand is inactive</sub>

> *Example (non-normative): The same card negated off the stack is erased: the stack is active.* <sub>test: 125-active-zone.test.ts::R145: Aberrant Statweaver negated off the stack is ERASED, not binned</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R145, R145 · Tests: 125-active-zone.test.ts · Key: zones.general.active.unstable</sub>

<a id="r400.3"></a>**400.3.** Each player has their own hand, cache, bin and erased pile. See rules 402, 403, 405, 407.

> *Example (non-normative): A card put in one player hand, cache, bin or erased pile leaves the other player four zones untouched.* <sub>test: 418-cr-zones.test.ts::cr:zones.general.per-player — a card put in one player hand, cache, bin or erased pile leaves the other player four zones untouched</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.19 · Rulings: R250 (its §4 zones-follow-control half), R262 · Tests: 418-cr-zones.test.ts · Key: zones.general.per-player</sub>

<a id="r400.4"></a>**400.4.** A card that leaves play for a bin, a hand, a cache or an erased pile goes to that zone of the player who controlled it when it left play, not to its owner's. See rules 102, 711. *(Engine differs, see F-U07-7.)*

> *Example (non-normative): A unit stolen with a control-changing effect is recalled. It goes to the hand of the player who stole it.* <sub>test: 246-zones-follow-control.test.ts::R262 §1: a stolen unit recalled goes to the THIEF hand, not the owner</sub>

> *Example (non-normative): A stolen unit dies. It goes to its controller's bin, and its controller trashes it.* <sub>test: 229-cosmic-and-control.test.ts::R250: a stolen unit that dies is trashed by its CONTROLLER, into the controller bin</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R250 (its §4 zones-follow-control half), R262 · Replaces: R107 (its destination half (a card put into play from another player's bin dies to its OWNER's bin) reversed by R250); R244 (§1 "THE DESTINATION DOES NOT MOVE" (a mod goes to its owner's bin) reversed by R250); R140 (its Biomass Devourer premise that a dying card bins to its owner superseded by R250); R152 (§2 each nontoken mod goes to its own owner's bin; superseded by R250); R153 (step 1 nontoken mods go to their own owner's bin; superseded by R250); R156 (the token-mod erased-pile entry filed under the host's owner; corrected by R262); R172 (§2 item 3 an erased-from-play card filed on its owner's erased pile; corrected by R262) · Tests: 246-zones-follow-control.test.ts, 229-cosmic-and-control.test.ts · Key: zones.general.follow-control</sub>

<sub>Discrepancies: D-U07-10, D-U07-4 (discrepancies.md)</sub>

<a id="r400.4a"></a>**400.4a** A card's owner never changes. Changing zones, changing controller and being put into play out of another player's zone all leave the card owned by the same player.

> *Example (non-normative): Wake the Dead puts a unit from the opponent's bin into play under the caster's control; the opponent still owns it.* <sub>test: 93-engine-defects.test.ts::Wake the Dead raising a unit from the ENEMY bin gives the caster control, not ownership</sub>

> *Example (non-normative): A stolen unit that is recalled is still owned by the player it was stolen from.* <sub>test: 246-zones-follow-control.test.ts::R262 §3: ownership does NOT move — only the destination does</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R250 (its §4 zones-follow-control half), R262, R107 (its ownership half) · Tests: 93-engine-defects.test.ts, 246-zones-follow-control.test.ts · Key: zones.general.follow-control.ownership</sub>

<a id="r400.4b"></a>**400.4b** If the effect that moves a card names where it goes, the card goes there instead.

> *Example (non-normative): Pull Under: "Delete target unit. If you do, put it and all of its mods into your bin." The deleted unit and its mods go to the bin of Pull Under's caster, whoever controlled the unit.* <sub>test: 15-water-b.test.ts::Pull Under: deletes the target; it and its mods land in YOUR bin</sub>

> *Example (non-normative): Grob makes the target unit's controller cache it, so a stolen unit goes to the thief's cache.* <sub>test: 135-exchange-and-zones.test.ts::Grob caches a STOLEN unit into the CONTROLLER</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: card: Pull Under; card: Cosmic Reversal · Rulings: R262, R157 (§27) · Tests: 246-zones-follow-control.test.ts, 15-water-b.test.ts, 135-exchange-and-zones.test.ts · Key: zones.general.follow-control.printed-destination</sub>

<a id="r400.4c"></a>**400.4c** In constructed, a card's owner is the player who brought it to the game. See rule 901.

> *Example (non-normative): In constructed every card a seat holds comes from the deck that seat brought, and a unit it plays is owned by it even after control changes.* <sub>test: 418-cr-zones.test.ts::cr:zones.general.follow-control.constructed-owner — in constructed every card a seat holds comes from the deck that seat brought, and a unit it plays is owned by it even after control changes</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R262 · Tests: 418-cr-zones.test.ts · Key: zones.general.follow-control.constructed-owner</sub>

<sub>Discrepancies: D-U07-8 (discrepancies.md)</sub>

<a id="r400.5"></a>**400.5.** An ability that works while its card is in a bin or a cache ("if I am in your bin") works only while the card is in that zone. It never works while the card is in play. See rule 706.

> *Example (non-normative): Cinder Scuttler ("When you deal combat damage to an opponent, if I am in your bin, recall me.") dies in the same combat damage sub-step in which another attacker hits the opponent. It was not in the bin when the damage was dealt, so it is not recalled.* <sub>test: 310-zone-abilities.test.ts::§3 Cinder Scuttler does NOT recall off the damage step it died in</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R300, R51 · Tests: 310-zone-abilities.test.ts · Key: zones.general.zone-text</sub>

<a id="r400.5a"></a>**400.5a** Copies of one card in the same bin or cache share one such ability: it triggers once for that zone, not once per copy.

> *Example (non-normative): Two Cinder Scuttlers in a bin: one combat hit on the opponent recalls one of them, not both.* <sub>test: 12-fire-a.test.ts::Cinder Scuttler: one firing per bin, not per copy (R51)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R51 · Tests: 12-fire-a.test.ts · Key: zones.general.zone-text.one-firing</sub>

<a id="r400.5b"></a>**400.5b** "Your bin" in such an ability means the bin the card is in: the player whose bin it is controls the ability, whoever once played the card.

> *Example (non-normative): Rotling ("When I leave your bin, … You may pay [1] to draw a card") leaves the opponent's bin. The opponent, whose bin it left, is the one offered the draw.*

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Rotling · Rulings: R124 · Key: zones.general.zone-text.your-bin</sub>

<a id="r401"></a>
### 401. Deck

<a id="r401.1"></a>**401.1.** The deck is the face-down pile that cards are drawn from and that packs are dealt from. See rule 503.

> *Example (non-normative): The deck is face down to every seat, a draw takes its top card, and the live-draft packs are dealt out of it.* <sub>test: 418-cr-zones.test.ts::cr:zones.deck.what — the deck is face down to every seat, a draw takes its top card, and the live-draft packs are dealt out of it</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16; Rulebook 2023 p.2 · Tests: 418-cr-zones.test.ts · Key: zones.deck.what</sub>

<a id="r401.2"></a>**401.2.** The cards in the deck are hidden: no player may look at them or at their order. A card put on the bottom of the deck is not revealed unless the effect says so. See rule 408.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197b, R296 · Key: zones.deck.hidden</sub>

<a id="r401.3"></a>**401.3.** In live draft, all players draw from one shared deck. See rule 902.

> *Example (non-normative): In live draft both players draw from the one shared deck.* <sub>test: 418-cr-zones.test.ts::cr:zones.deck.shared — in live draft both players draw from the one shared deck</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.11; Manual p.16 · Tests: 418-cr-zones.test.ts · Key: zones.deck.shared</sub>

<a id="r401.3a"></a>**401.3a** In constructed, there is no shared deck: each player has their own deck. See rule 901.

> *Example (non-normative): In constructed there is no shared deck and each seat draws from its own.* <sub>test: 418-cr-zones.test.ts::cr:zones.deck.shared.constructed — in constructed there is no shared deck and each seat draws from its own</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.10; Manual p.16 · Tests: 418-cr-zones.test.ts · Key: zones.deck.shared.constructed</sub>

<a id="r401.3b"></a>**401.3b** "The deck" in card text means the deck of the effect's controller: the shared deck in live draft, that player's own deck in constructed.

> *Example (non-normative): In constructed a Glimpse 1 reveals the top of the deck of the effect controller, not of the opponent.* <sub>test: 418-cr-zones.test.ts::cr:zones.deck.the-deck — in constructed a Glimpse 1 reveals the top of the deck of the effect controller, not of the opponent</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R157 (§18), R157 (§18) · Tests: 418-cr-zones.test.ts · Key: zones.deck.the-deck</sub>

<a id="r401.4"></a>**401.4.** A player who must draw from an empty deck when the recycle pile is also empty draws as many cards as there are. Running out of cards does not make a player lose. See rules 408, 104.

> *Example (non-normative): With deck and recycle pile both empty, a draw of two draws nothing and the game goes on.* <sub>test: 300-recycle-mark.test.ts::R296 §4 an empty deck AND an empty pile draws fewer</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R296 · Tests: 300-recycle-mark.test.ts · Key: zones.deck.empty</sub>

<a id="r402"></a>
### 402. Hand

<a id="r402.1"></a>**402.1.** Each player has a hand. Drawn cards go to the hand, and cards in the hand are played from there. See rules 503, 702.

> *Example (non-normative): A drawn card goes to the hand, and a card is played out of the hand.* <sub>test: 418-cr-zones.test.ts::cr:zones.hand.what — a drawn card goes to the hand, and a card is played out of the hand</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16; Rulebook 2023 p.15 · Tests: 418-cr-zones.test.ts · Key: zones.hand.what</sub>

<a id="r402.2"></a>**402.2.** A hand is hidden from the other players.

> *Example (non-normative): The server view shows a hand to its holder and only card backs to the other player.* <sub>test: 418-cr-zones.test.ts::cr:zones.hand.hidden — the server view shows a hand to its holder and only card backs to the other player</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R197b · Tests: 418-cr-zones.test.ts · Key: zones.hand.hidden</sub>

<a id="r402.2a"></a>**402.2a** An effect that lets a player "look at" a hand shows it to that player only. An effect that makes a player "reveal" their hand shows it to every player.

> *Example (non-normative): Thought Extraction aimed at its caster's own hand shows that hand to nobody else.* <sub>test: 173-look-at-a-hand.test.ts::R197b §1 Thought Extraction: aimed at YOUR OWN hand</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197b, R197b · Tests: 173-look-at-a-hand.test.ts, 418-cr-zones.test.ts · Key: zones.hand.hidden.look-at</sub>

<a id="r402.3"></a>**402.3.** A spell token is never in a hand. An effect that counts or refers to the cards in a hand does not count a spell token. See rule 304.

> *Example (non-normative): Dreadspawn Horror does not count spell tokens as cards in hand.* <sub>test: 408-raq-new-threads.test.ts::RAQ Spell Tokens vs Hand: Dreadspawn Horror does not count spell tokens</sub>

> *Example (non-normative): Nor does Astral Tidewraith.* <sub>test: 408-raq-new-threads.test.ts::RAQ Spell Tokens vs Hand: Astral Tidewraith</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1355689559609839787#0; RAQ 1355689559609839787#1 · Rulings: R342 · Tests: 408-raq-new-threads.test.ts · Key: zones.hand.spell-tokens</sub>

<a id="r402.4"></a>**402.4.** A card enters a hand whenever an effect puts it there: a draw, a recall, or a move out of a bin, the stack, a cache or another hand. Several cards that enter one hand in a single move enter it together, as one event ("one or more cards enter a hand"). See rule 706.

> *Example (non-normative): Collect Remains puts a card from a bin into its caster's hand during battle; Rider of the Tides sees a card enter a hand, though it was neither drawn nor recalled.* <sub>test: 152-hand-entry.test.ts::Rider of the Tides: a BIN recursion (Collect Remains) is a card entering a hand</sub>

> *Example (non-normative): A recall of two cards from a bin is one entry, not two.* <sub>test: 152-hand-entry.test.ts::a multi-card move fires exactly ONE handEntered</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R179 · Tests: 152-hand-entry.test.ts · Key: zones.hand.entering</sub>

<a id="r402.5"></a>**402.5.** Discarding a card moves it from its hand to the bin. Discarding is not playing the card: nothing goes on the stack. See rules 405, 701, 801.

> *Example (non-normative): A card discarded from a hand goes to the bin and is trashed.* <sub>test: 35-rot-debt-trash.test.ts::R40: discarding from hand trashes</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R65 (its discard-me and erased-pile halves), R40 (its definition: a card entering a bin from anywhere but the stack) · Tests: 35-rot-debt-trash.test.ts · Key: zones.hand.discard</sub>

<a id="r402.6"></a>**402.6.** Card text that restricts playing a card "from your hand" restricts only the hand. The card may still be played from any other zone an effect allows.

> *Example (non-normative): Calming Force ("I can't be played from your hand.") cannot be cast from the hand, but a copy in the cache under a live permission can be played.* <sub>test: 40-light-c.test.ts::is enforced, and not just un-offered</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Calming Force · Rulings: R100, R311 · Tests: 40-light-c.test.ts · Key: zones.hand.only-the-hand</sub>

<a id="r403"></a>
### 403. Cache

<a id="r403.1"></a>**403.1.** The cache is a zone of its own, beside the hand, the bin and the deck. Effects put cards into it ("cache"), out of the hand, the bin, the deck or play. See rules 801, 803.

> *Example (non-normative): Cards can be cached out of the hand, the bin and the top of the deck.* <sub>test: 36-cache-prophecy.test.ts::R41: the cache primitives move cards out of hand, bin and deck</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R41 · Our glossary (not a source): Cache · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.what</sub>

<a id="r403.2"></a>**403.2.** The cache is public. Every player can see every cached card, and any prophecy attached to it.

> *Example (non-normative): Both players read the same cache, with nothing hidden.* <sub>test: 36-cache-prophecy.test.ts::R41: the cache is PUBLIC</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R41 · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.public</sub>

<a id="r403.3"></a>**403.3.** Being in the cache does not by itself let a player do anything with a card.

> *Example (non-normative): A card cached with no permission can never be played.* <sub>test: 36-cache-prophecy.test.ts::R41: being in the cache is NOT permission</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R303, R303 · Our glossary (not a source): Cache · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.no-permission</sub>

<a id="r403.3a"></a>**403.3a** A cached card can be used only while a permission on it is live: a prophecy on it that has been fulfilled, or a glimpse that cached it this turn. See rules 801, 803.

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R303 · Tests: 36-cache-prophecy.test.ts, 315-cache-mod-permission.test.ts · Key: zones.cache.no-permission.live</sub>

<a id="r403.3b"></a>**403.3b** While a permission is live, the cached card can be used in every way the same card could be used from the hand: in every play mode, in every window, and as a mod.

> *Example (non-normative): A glimpsed Virus in the cache is augmented onto an enemy unit during battle.* <sub>test: 370-cached-virus-in-battle.test.ts::R311: a glimpsed Virus in the cache goes onto an ENEMY unit in battle</sub>

> *Example (non-normative): A live glimpse lets the cached card be grafted.* <sub>test: 315-cache-mod-permission.test.ts::R303: a LIVE glimpse grafts for the card's mana, ignoring affinity</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 3 tests run · Designer: RAQ 1537748882501668934#3; RAQ 1537748882501668934#4 · Rulings: R311 · Tests: 370-cached-virus-in-battle.test.ts, 315-cache-mod-permission.test.ts, 369-cache-is-the-hand.test.ts · Key: zones.cache.no-permission.like-hand</sub>

<sub>Discrepancies: D-U07-2 (discrepancies.md)</sub>

<a id="r403.3c"></a>**403.3c** A card used under a fulfilled prophecy costs nothing and ignores affinity. A card used under a glimpse costs its mana but ignores affinity. This holds for every way of using it, mods included.

> *Example (non-normative): A released prophecy is played for free, ignoring affinity.* <sub>test: 36-cache-prophecy.test.ts::R42: a released prophecy is FREE and ignores affinity</sub>

> *Example (non-normative): A live glimpse does not waive the mana: a player who cannot pay is refused.* <sub>test: 315-cache-mod-permission.test.ts::R303: the glimpse waives the pips, NOT the mana</sub>

> *Example (non-normative): A live glimpse grafts for the card's mana, ignoring affinity.* <sub>test: 315-cache-mod-permission.test.ts::R303: a LIVE glimpse grafts for the card's mana, ignoring affinity</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 4 tests run · Rulings: R311, R311 · Tests: 36-cache-prophecy.test.ts, 315-cache-mod-permission.test.ts · Key: zones.cache.no-permission.price</sub>

<a id="r403.3d"></a>**403.3d** A cached card keeps its printed timing. A permission says that the card may be used, not when.

> *Example (non-normative): A released {Battle} card is refused in deployment.* <sub>test: 36-cache-prophecy.test.ts::R42: normal TIMING still applies</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R311 · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.no-permission.timing</sub>

<a id="r403.4"></a>**403.4.** The cache is not the hand. A cached card cannot be discarded, and card text that names the hand does not reach the cache. See rule 402.6.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R311, R311 · Tests: 369-cache-is-the-hand.test.ts · Key: zones.cache.not-the-hand</sub>

<a id="r403.5"></a>**403.5.** When a glimpse permission ends, the card stays in the cache, with no permission.

> *Example (non-normative): The glimpse permission ends at end of turn; the card is still in the cache.* <sub>test: 36-cache-prophecy.test.ts::R45: the glimpse permission expires at end of turn</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R303, R45 · Tests: 36-cache-prophecy.test.ts, 315-cache-mod-permission.test.ts · Key: zones.cache.lapse</sub>

<sub>Discrepancies: D-U07-6 (discrepancies.md)</sub>

<a id="r403.6"></a>**403.6.** A cached card can be targeted. A player's cache can be targeted only by an effect that resolves in a region where that player is present. See rules 110, 601.

> *Example (non-normative): In deployment, Prismatic Observer can recall only a card from its own player's cache.* <sub>test: 293-cached-targets-are-regional.test.ts::R291 §2 the report</sub>

> *Example (non-normative): In battle, with both players present, it can reach the opponent's cache.* <sub>test: 293-cached-targets-are-regional.test.ts::R291 §3 the control</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: card: Prismatic Observer; Manual p.19 · Rulings: R291, R291 · Tests: 293-cached-targets-are-regional.test.ts · Key: zones.cache.targetable</sub>

<a id="r403.7"></a>**403.7.** When a unit in play is cached, only the card goes to the cache. Its mods go to the bin. See rules 410, 720.

> *Example (non-normative): A cached unit's mods go to the bin (and are trashed there).* <sub>test: 36-cache-prophecy.test.ts::R46: caching a unit sheds its mods to the bin</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R46 · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.from-play</sub>

<a id="r403.8"></a>**403.8.** A card in the cache under a live glimpse permission may be prophesied where it stands. It does not move and is not cached a second time, and the glimpse permission is used up. See rule 803.

> *Example (non-normative): A glimpsed card with a prophecy banner is prophesied in deployment without leaving the cache.* <sub>test: 36-cache-prophecy.test.ts::R308: a GLIMPSED card with a banner may be prophesied where it stands in the cache</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R308, R308 · Tests: 36-cache-prophecy.test.ts · Key: zones.cache.prophesy-in-place</sub>

<a id="r404"></a>
### 404. Play

<a id="r404.1"></a>**404.1.** Play is the zone of the units, resources and tokens on the table. A unit stays in play until something removes it. See rules 601, 602.

> *Example (non-normative): A unit in play stays there through whole turns until something removes it.* <sub>test: 418-cr-zones.test.ts::cr:zones.play.what — a unit in play stays there through whole turns until something removes it</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.13; Manual p.18 · Rulings: R145 · Tests: 418-cr-zones.test.ts · Key: zones.play.what</sub>

<a id="r404.1a"></a>**404.1a** A token is created directly into play, in the region where it was created. See rule 304.

> *Example (non-normative): Galactic Germination cast by the attacker creates its unit tokens straight into play in the battle region.* <sub>test: 418-cr-zones.test.ts::cr:zones.play.tokens — Galactic Germination cast by the attacker creates its unit tokens straight into play in the battle region</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.15; Manual p.15; Manual p.15 · Tests: 418-cr-zones.test.ts · Key: zones.play.tokens</sub>

<a id="r404.1b"></a>**404.1b** A spell unit enters play as it resolves, in place of going to the bin. See rule 303.

> *Example (non-normative): Jelly resolves into play as a unit and does not go to the bin.* <sub>test: 418-cr-zones.test.ts::cr:zones.play.spell-units — Jelly resolves into play as a unit and does not go to the bin</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.3 · Tests: 418-cr-zones.test.ts · Key: zones.play.spell-units</sub>

<a id="r405"></a>
### 405. Bin

<a id="r405.1"></a>**405.1.** The bin is a player's discard pile. See rule 400.3.

> *Example (non-normative): A discarded card goes to the bin of the player who discarded it.* <sub>test: 418-cr-zones.test.ts::cr:zones.bin.what — a discarded card goes to the bin of the player who discarded it</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.44 · Tests: 418-cr-zones.test.ts · Key: zones.bin.what</sub>

<sub>Discrepancies: D-U07-7 (discrepancies.md)</sub>

<a id="r405.2"></a>**405.2.** A card goes to the bin when: a unit dies or is deleted; a unit is sacrificed; a spell resolves; a card is discarded; or a card that was being played is negated or fails to resolve, unless a rule sends it elsewhere. See rules 704, 801.

> *Example (non-normative): A unit that dies, is deleted or is sacrificed, and a discarded card, each go to the bin.* <sub>test: 418-cr-zones.test.ts::cr:zones.bin.entering — a unit that dies, is deleted or is sacrificed, and a discarded card, each go to the bin</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.41; Rulebook 2023 p.3; Manual p.34 · Tests: 418-cr-zones.test.ts · Key: zones.bin.entering</sub>

<a id="r405.2a"></a>**405.2a** A spell unit that is prevented from resolving (for example because its targets became invalid) does not spawn. It goes to the bin.

> *Example (non-normative): A negated Jelly, a spell unit played through Hooba-Pon, does not enter play.* <sub>test: 396-raq-timing.test.ts::RAQ Hooba-Pon spell unit: negated, the unit does not enter play</sub>

<sub>Basis: Printed · Verified: confirmed, round 2, 1 test run · Printed: Manual p.13; Manual p.13 · Tests: 396-raq-timing.test.ts, 418-cr-zones.test.ts · Key: zones.bin.entering.spell-unit-fails</sub>

<a id="r405.2b"></a>**405.2b** An ambushing unit whose ambush fails to resolve goes to the bin. See rule 803.

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.40 · Key: zones.bin.entering.ambush-fizzle</sub>

<a id="r405.3"></a>**405.3.** A unit that dies goes to the bin of the player who controlled it when it died, unless the effect that kills it names another bin or the unit is {Unstable} (see zones.bin.unstable). If it is a card, the player whose bin it enters trashes it; a token is never trashed. See rules 400.4, 801, 405.5, 405.4.

> *Example (non-normative): Every unit-shaped card in the pool, dying under a controller who is not its owner, goes to the controller's bin.* <sub>test: 229-cosmic-and-control.test.ts::R250 whole pool: every unit-shaped card dies into the bin of whoever controls it</sub>

> *Example (non-normative): Pull Under deletes an enemy unit and puts it into its caster's bin; the caster trashes it.* <sub>test: 15-water-b.test.ts::Pull Under: an ENEMY unmodded victim is trashed by the CASTER, exactly once</sub>

> *Example (non-normative): A token that Pull Under deletes enters the caster's bin but is not trashed.* <sub>test: 15-water-b.test.ts::Pull Under: a TOKEN victim enters the CASTER bin untrashed</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 3 tests run · Printed: card: Pull Under · Rulings: R250 (its §4 zones-follow-control half), R306 · Replaces: R140 (its Biomass Devourer premise that a dying card bins to its OWNER, superseded by R250) · Tests: 229-cosmic-and-control.test.ts, 15-water-b.test.ts, 338-tokens-are-not-trashed.test.ts · Key: zones.bin.controller</sub>

<a id="r405.4"></a>**405.4.** A card that enters a bin from any zone except the stack is trashed. A card that comes from the stack is not, and a token is never trashed. A nontoken mod erased together with its {Unstable} host is not trashed either. See 801. See rule 801.

> *Example (non-normative): A spell going to the bin after resolving is not trashed.* <sub>test: 35-rot-debt-trash.test.ts::R40: a spell going to the bin after RESOLVING is not trashed</sub>

> *Example (non-normative): A dying token enters the bin but is not trashed.* <sub>test: 35-rot-debt-trash.test.ts::R69 + R306: a TOKEN dying enters the bin, is NOT trashed, and is then erased</sub>

> *Example (non-normative): A nontoken mod on an {Unstable} host that dies is erased with it and is not trashed.* <sub>test: 224-mod-trash.test.ts::R244: a nontoken mod erased with its Unstable host is not trashed at all</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 3 tests run · Rulings: R40 (its definition: a card entering a bin from anywhere but the stack), R306, R244 (its §2: a mod erased with its host) · Replaces: R40 (its 2026-08-21 amendment that tokens CAN be trashed, reversed by R306); R137 (its section "The mods ride with it" (a mod erased with its host is trashed), reversed by R244) · Tests: 35-rot-debt-trash.test.ts, 338-tokens-are-not-trashed.test.ts, 224-mod-trash.test.ts · Key: zones.bin.trash</sub>

<a id="r405.4a"></a>**405.4a** A spell played for free while another effect resolves (for example by Tides of the Cosmos) and then put into the bin counts as coming from the stack, so it is not trashed.

> *Example (non-normative): Tides of the Cosmos plays an ordinary spell for free; it goes to the bin and is not trashed.* <sub>test: 15-water-b.test.ts::R146: Tides plays an ORDINARY spell for free → the bin, and it is NOT a trash</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R146 · Tests: 15-water-b.test.ts · Key: zones.bin.trash.inline-play</sub>

<a id="r405.5"></a>**405.5.** An {Unstable} card that would enter a bin from an active zone is erased instead: it goes to the erased pile, not the bin. See 803. See rules 803, 713, 400.2a. *(Engine differs, see F-U07-6.)*

> *Example (non-normative): A unit carrying a mod is {Unstable}. When it dies, it ends on the erased pile and is not left in the bin.* <sub>test: 418-cr-zones.test.ts::cr:zones.bin.unstable — a modded unit that dies ends on the erased pile, not in the bin</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 3 tests run · Printed: card: Abyssal Evocation · Rulings: R145 (the Unstable glossary line it quotes; its from-play bullet defers to R137 and is not cited), R145 (its active-zone list) · Replaces: R137 (STILL CURRENT as an owner ruling and NOT followed here: a dying {Unstable} card enters the bin, is trashed there and is only then erased. It records itself as a deliberate divergence from the printed reminder and from Caleb 2025-04-08; under the authority order print and designer outrank it (D-U07-3, F-U07-6)); R69 (its Unstable-death branch, amended by R137) · Tests: 125-active-zone.test.ts, 224-mod-trash.test.ts, 418-cr-zones.test.ts · Key: zones.bin.unstable</sub>

<sub>Discrepancies: D-U07-3 (discrepancies.md)</sub>

<a id="r405.6"></a>**405.6.** Copies of one card in a bin cannot be told apart. A card in a bin is identified only by its name and by which copy of that name it is.

> *Example (non-normative): A bin holds bare card names, and two copies of one card are offered as the same name told apart only by which copy.* <sub>test: 418-cr-zones.test.ts::cr:zones.bin.identity — a bin holds bare card names, and two copies of one card are offered as the same name told apart only by which copy</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R140 (its rule: a responder names the copy the event named), R131 · Tests: 418-cr-zones.test.ts · Key: zones.bin.identity</sub>

<a id="r405.6a"></a>**405.6a** "Another" said by a card in a bin excludes that one copy, not every card with its name. See rule 110.

> *Example (non-normative): Blightwalker is trashed while another Blightwalker is already in the bin; the older copy is "another" and can be chosen.* <sub>test: 121-another-identity.test.ts::R131 Blightwalker: a Blightwalker ALREADY in the bin is</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R131 · Tests: 121-another-identity.test.ts · Key: zones.bin.identity.another</sub>

<a id="r405.6b"></a>**405.6b** An effect that refers back to a card that just entered a bin ("that card", "it") means that copy. If that copy has left the bin, the effect finds nothing. It never takes a different copy of the same name.

> *Example (non-normative): A token or {Unstable} copy is swept out of the bin before Biomass Devourer resolves; an older copy of the same card in that bin is not erased.* <sub>test: 26-metal-a.test.ts::R140: Biomass Devourer does NOT erase an innocent older copy when the dead one was swept</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R140 (its rule: a responder names the copy the event named) · Tests: 26-metal-a.test.ts · Key: zones.bin.identity.that-card</sub>

<a id="r405.7"></a>**405.7.** A card leaves a bin whenever an effect takes it out, for any reason: recalled, played, cached, erased, recycled, prophesied, or applied as a mod. A "when I leave your bin" ability triggers on every such departure.

> *Example (non-normative): Writhing Host leaves the bin when it is erased to pay for a haste play.* <sub>test: 42-dark-b.test.ts::Writhing Host (R123/R124): the grantor leaves through the R124 choke point</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Rotling · Rulings: R124 · Tests: 42-dark-b.test.ts · Key: zones.bin.leaving</sub>

<a id="r405.8"></a>**405.8.** An augment or graft may be applied from the bin as well as from the hand, during deployment, if its cost is paid and its affinity met. See rules 720, 721, 722.

> *Example (non-normative): A graft comes from the bin as well as the hand, and only when its cost and affinity are met.* <sub>test: 393-raq-mods.test.ts::RAQ Graft 101 point 3</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Rulebook 2023 p.15; Manual p.34 · Designer: RAQ 1355115946032889914#2 · Tests: 393-raq-mods.test.ts · Key: zones.bin.mods-from-bin</sub>

<a id="r405.8a"></a>**405.8a** A {Virus} card in a bin can be applied only as an ordinary mod during deployment. It cannot be used as a mod during battle. See rule 723.

> *Example (non-normative): Bumblecrab, a {Virus}, sits in a player's bin. In deployment it can augment out of the bin; in battle it is offered only from the hand.* <sub>test: 418-cr-zones.test.ts::cr:zones.bin.mods-from-bin.virus — a Virus card in the bin is offered as an augment in deployment, never in battle</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.34; Manual p.34 · Tests: 418-cr-zones.test.ts · Key: zones.bin.mods-from-bin.virus</sub>

<a id="r405.9"></a>**405.9.** A card can be played from a bin only when an effect or the card's own text allows it. The card keeps its printed timing unless the permission says it may be played "now". See rule 702.

> *Example (non-normative): Abyssal Evocation lets its caster play spells from the bin in this battle; only {Battle} spells there can be played.* <sub>test: 12-fire-a.test.ts::Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Abyssal Evocation; card: Trench Stalker · Rulings: R157 (§12) · Tests: 12-fire-a.test.ts · Key: zones.bin.play-from-bin</sub>

<a id="r405.9a"></a>**405.9a** A card played from a bin is {Unstable} only if the permission says so. A card played from a bin under its own text does not become {Unstable}. See rule 803.

> *Example (non-normative): A spell played from the bin under Abyssal Evocation gains {Unstable}, so it is erased rather than going back to the bin.* <sub>test: 12-fire-a.test.ts::Abyssal Evocation: a bin-played spell is {Unstable}</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: card: Abyssal Evocation · Rulings: R123 · Tests: 12-fire-a.test.ts · Key: zones.bin.play-from-bin.unstable</sub>

<a id="r406"></a>
### 406. The Stack

<a id="r406.1"></a>**406.1.** The stack is the zone where cards being played, and abilities, wait to resolve. The last thing put on the stack resolves first. See 703. See rules 703, 704.

> *Example (non-normative): Two spells wait on the stack and the one put there last resolves first.* <sub>test: 418-cr-zones.test.ts::cr:zones.stack.what — two spells wait on the stack and the one put there last resolves first</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.14; Manual p.34 · Tests: 418-cr-zones.test.ts · Key: zones.stack.what</sub>

<a id="r406.2"></a>**406.2.** A spell unit on the stack is not yet in play. It enters play only when it resolves. See rule 303.

> *Example (non-normative): Mycelial Mentor, played with Bloomcaster out, is still on the stack while Bloomcaster's 1/1 is made, so the Mentor never sees the 1/1.* <sub>test: 396-raq-timing.test.ts::RAQ Bloomcaster: its 1/1 resolves before the Mycelial Mentor it was played with arrives</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353862592661164152#0 · Tests: 396-raq-timing.test.ts · Key: zones.stack.not-in-play</sub>

<a id="r406.3"></a>**406.3.** A spell token that has been cast is on the stack, and is still a token there. See rule 304.

> *Example (non-normative): Download can take a Fireball token already cast and on the stack.* <sub>test: 393-raq-mods.test.ts::RAQ Download: a Fireball already cast and on the stack is a token it can take</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353864175910387742#1 · Tests: 393-raq-mods.test.ts · Key: zones.stack.tokens</sub>

<a id="r406.4"></a>**406.4.** When a card on the stack resolves, is negated or fails to resolve, it goes to the bin unless it enters play or something sends it elsewhere: an {Unstable} card is erased (see zones.bin.unstable), a card whose own text erases it goes to the erased pile (see zones.stack.leaving.self-erase), and a recall puts it into a hand. A card that goes to the bin this way is not trashed, because it comes from the stack. See rules 704, 405.4, 405.5, 406.4a.

> *Example (non-normative): A non-{Unstable} virus negated off the stack goes to the bin.* <sub>test: 125-active-zone.test.ts::R145 negative control: a NON-Unstable virus negated off the stack still BINS</sub>

> *Example (non-normative): A negated spell is not trashed.* <sub>test: 35-rot-debt-trash.test.ts::R40: a NEGATED spell is not trashed either</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Printed: Rulebook 2023 p.3; Manual p.34; card: Cosmic Reversal · Rulings: R145, R40 (its definition: a card entering a bin from anywhere but the stack), R145 (its stack route) · Tests: 125-active-zone.test.ts, 35-rot-debt-trash.test.ts · Key: zones.stack.leaving</sub>

<a id="r406.4a"></a>**406.4a** A spell whose text says "Erase me" goes to the erased pile when it resolves, instead of the bin. See rule 407.

> *Example (non-normative): Tides of the Cosmos plays Suspend for free; Suspend goes to the erased pile, never the bin.* <sub>test: 15-water-b.test.ts::R146: Tides plays "Erase me." (Suspend) for free → the ERASED pile, never a bin</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 2 tests run · Printed: card: Suspend; card: Collect Remains · Tests: 15-water-b.test.ts, 89-self-erase.test.ts · Key: zones.stack.leaving.self-erase</sub>

<a id="r406.4b"></a>**406.4b** A self-erasing spell that is negated or fails to resolve goes to the bin. Its "Erase me" never happened.

> *Example (non-normative): A negated self-erase spell is binned.* <sub>test: 89-self-erase.test.ts::a NEGATED self-erase spell is binned, not erased</sub>

> *Example (non-normative): So is one whose target went away.* <sub>test: 89-self-erase.test.ts::a FIZZLED self-erase spell is binned too</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 89-self-erase.test.ts · Key: zones.stack.leaving.self-erase-negated</sub>

<sub>Discrepancies: D-U07-13 (discrepancies.md)</sub>

<a id="r407"></a>
### 407. Erased Pile

<a id="r407.1"></a>**407.1.** Erasing a card takes it out of the game. An erased card goes to the erased pile. See rule 801.

> *Example (non-normative): Celestial Purge takes a unit out of the game onto the erased pile: no bin and no death.* <sub>test: 418-cr-zones.test.ts::cr:zones.erased.what — Celestial Purge takes a unit out of the game onto the erased pile: no bin and no death</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.15 · Rulings: R65 (its erased-pile half) · Tests: 418-cr-zones.test.ts · Key: zones.erased.what</sub>

<a id="r407.1a"></a>**407.1a** The erased pile is public.

> *Example (non-normative): The server view shows each erased pile in full to both seats.* <sub>test: 418-cr-zones.test.ts::cr:zones.erased.public — the server view shows each erased pile in full to both seats</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R65 (its erased-pile half) · Tests: 418-cr-zones.test.ts · Key: zones.erased.public</sub>

<a id="r407.1b"></a>**407.1b** Nothing takes a card back out of the erased pile.

> *Example (non-normative): A card on the erased pile adds nothing to the legal actions, where the same card in the bin does.* <sub>test: 418-cr-zones.test.ts::cr:zones.erased.final — a card on the erased pile adds nothing to the legal actions, where the same card in the bin does</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R65 (its erased-pile half), R137 (its body-trash ruling and its Rector and Distiller notes) · Tests: 418-cr-zones.test.ts · Key: zones.erased.final</sub>

<a id="r407.1c"></a>**407.1c** Erasing is not dying and not trashing: an erased card never enters a bin. See rule 410.2.

> *Example (non-normative): A unit erased by Banishment does not die and is not trashed.* <sub>test: 145-erase-routes.test.ts::R172 (vii): Banishment still fires no 'died' and no 'trashed'</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R172 (its §1 erase-is-a-despawn and §4 Download halves), R40 (its definition: a card entering a bin from anywhere but the stack) · Tests: 145-erase-routes.test.ts · Key: zones.erased.not-death</sub>

<a id="r407.2"></a>**407.2.** A card that an effect erases goes to the erased pile, including a mod erased off a host that stays in play (for example to pay a cost). See rule 720.

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R219 · Replaces: R208 (its held behaviour that a mod erased off a living host files nothing on the erased pile, reversed by R219) · Tests: 178-played-item-and-erased-mods.test.ts · Key: zones.erased.says-erase</sub>

<a id="r407.2a"></a>**407.2a** A mod taken off its host and put into play as a card of its own (Reclaim the Fallen) does not leave the game and does not go to the erased pile.

> *Example (non-normative): Reclaim the Fallen: the card stands in play and no erase names it.* <sub>test: 178-played-item-and-erased-mods.test.ts::R208 Reclaim the Fallen: leavesGame:false</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R219 · Tests: 178-played-item-and-erased-mods.test.ts · Key: zones.erased.says-erase.into-play</sub>

<a id="r407.3"></a>**407.3.** A token that ceases to exist after entering a zone is recorded on the erased pile. See rule 410.5.

> *Example (non-normative): A dying token enters the bin, is erased from it, and is recorded on the erased pile.* <sub>test: 35-rot-debt-trash.test.ts::R69 + R306: a TOKEN dying enters the bin, is NOT trashed, and is then erased</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R306 · Tests: 35-rot-debt-trash.test.ts, 418-cr-zones.test.ts · Key: zones.erased.tokens</sub>

<sub>Discrepancies: D-U07-5 (discrepancies.md)</sub>

<a id="r407.3a"></a>**407.3a** A token mod is recorded on the erased pile once when its host leaves play, however the host leaves.

> *Example (non-normative): One token mod reaches the erased pile once on a death, a recall and a cache alike.* <sub>test: 129-disposal-tail.test.ts::R65: a TOKEN mod reaches the erased pile however its host leaves play</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R167, R156 (its announcement on every route) · Tests: 129-disposal-tail.test.ts, 141-despawn-mods.test.ts · Key: zones.erased.tokens.mods</sub>

<a id="r407.4"></a>**407.4.** A transformed card is recorded on the erased pile as its front face. See rule 410.3.

> *Example (non-normative): A transformed Scholar of the Void erased by Banishment is recorded as Scholar of the Void.* <sub>test: 145-erase-routes.test.ts::R172 (iii)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R160 · Tests: 145-erase-routes.test.ts · Key: zones.erased.front-face</sub>

<a id="r408"></a>
### 408. Recycling

<a id="r408.1"></a>**408.1.** To recycle a card is to put it on the bottom of the deck. A recycled card has not left the game. See rule 801.

> *Example (non-normative): A card recycled for a resource is drawn again once the rest of the deck is gone, so it never left the game.* <sub>test: 418-cr-zones.test.ts::cr:zones.recycle.what — a card recycled for a resource is drawn again once the rest of the deck is gone, so it never left the game</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.18; Rulebook 2023 p.7 · Rulings: R190 (its Recycle-row correction) · Tests: 418-cr-zones.test.ts · Key: zones.recycle.what</sub>

<a id="r408.2"></a>**408.2.** A deck has a mark where it originally ended. A card put on the bottom of the deck goes past the mark, into the recycle pile, not onto the bottom of the cards still to be drawn.

> *Example (non-normative): A recycled card stays behind the mark while the deck still has cards.* <sub>test: 300-recycle-mark.test.ts::R296 §1 a recycled card stays behind the mark</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R296, R296 · Tests: 300-recycle-mark.test.ts · Key: zones.recycle.mark</sub>

<sub>Discrepancies: D-U07-12 (discrepancies.md)</sub>

<a id="r408.2a"></a>**408.2a** Every card put on the bottom of the deck goes past the mark, whatever put it there: recycling for a resource, the constructed put-back, the cards a glimpse did not cache, and recycled packs alike.

> *Example (non-normative): Every effect that reads the deck reshuffles at the mark, not only drawing.* <sub>test: 300-recycle-mark.test.ts::R296 §6 every reader of the deck reshuffles at the mark</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R296, R296 · Tests: 300-recycle-mark.test.ts · Key: zones.recycle.mark.scope</sub>

<a id="r408.2b"></a>**408.2b** When the deck runs out and more cards are needed, the recycle pile is shuffled and becomes the new deck, with a new mark and an empty recycle pile. See rule 401.4.

> *Example (non-normative): The deck runs out, the pile is shuffled in, and drawing continues.* <sub>test: 300-recycle-mark.test.ts::R296 §2 when the deck runs out the pile is shuffled in</sub>

> *Example (non-normative): A glimpse wider than the deck reshuffles mid-reveal and still reveals N.* <sub>test: 300-recycle-mark.test.ts::R296 §6b a glimpse WIDER than the deck</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R296, R296 · Tests: 300-recycle-mark.test.ts · Key: zones.recycle.mark.reshuffle</sub>

<a id="r408.2c"></a>**408.2c** Every player can see how many cards are in the recycle pile. No player may look at them.

> *Example (non-normative): Nothing in the pile is named to any player.* <sub>test: 300-recycle-mark.test.ts::R296 §7 nothing in the pile is a card anybody can name</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R296 · Tests: 300-recycle-mark.test.ts · Key: zones.recycle.mark.public-count</sub>

<a id="r408.2d"></a>**408.2d** The order in which cards were recycled does not matter to the game.

> *Example (non-normative): The recycle pile is hidden from both seats and is shuffled before it is drawn again.* <sub>test: 418-cr-zones.test.ts::cr:zones.recycle.mark.order — the recycle pile is hidden from both seats and is shuffled before it is drawn again</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R296 · Tests: 418-cr-zones.test.ts · Key: zones.recycle.mark.order</sub>

<a id="r408.2e"></a>**408.2e** Each deck has its own recycle pile. In live draft, all players share one pile; in constructed, each player has their own. See rule 401.3.

> *Example (non-normative): In a shared-deck game both players recycle into one pile.* <sub>test: 300-recycle-mark.test.ts::R296 §5 constructed gives each seat its own pile</sub>

> *Example (non-normative): In constructed, a card one player recycles goes into that player's own pile, not the opponent's. (illustrative)*

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R296, R157 (§18) · Tests: 300-recycle-mark.test.ts, 418-cr-zones.test.ts · Key: zones.recycle.mark.whose</sub>

<a id="r408.3"></a>**408.3.** A card recycled out of a hand is not revealed unless the effect says so.

> *Example (non-normative): Bripp recycles a card from a hand without naming it to the table.* <sub>test: 173-look-at-a-hand.test.ts::R197b §1 Bripp: "Look at target player's hand" — and the card it recycles is not named to the table either</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197b · Tests: 173-look-at-a-hand.test.ts, 418-cr-zones.test.ts · Key: zones.recycle.hidden</sub>

<a id="r408.4"></a>**408.4.** During the resource step, a player may recycle a card from their hand to create a resource. See 502. See rules 502, 106.

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.18 · Rulings: R299 · Tests: 308-recycle-for-prismite.test.ts · Key: zones.recycle.for-resource</sub>

<a id="r409"></a>
### 409. The Pack

<a id="r409.1"></a>**409.1.** In live draft, each player has a pack: a face-down pile of 10 cards dealt from the deck at the start of the game, which that player drafts from. See rules 503, 902.

> *Example (non-normative): A live draft deals each seat a 10-card pack from the deck at the start, and the pack is what that seat drafts from.* <sub>test: 418-cr-zones.test.ts::cr:zones.pack.what — a live draft deals each seat a 10-card pack from the deck at the start, and the pack is what that seat drafts from</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16; Rulebook 2023 p.6 · Tests: 418-cr-zones.test.ts · Key: zones.pack.what</sub>

<a id="r409.1a"></a>**409.1a** Constructed has no packs. See rule 901.

> *Example (non-normative): A constructed game has no packs and no draft step.* <sub>test: 418-cr-zones.test.ts::cr:zones.pack.what.constructed — a constructed game has no packs and no draft step</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16 · Tests: 418-cr-zones.test.ts · Key: zones.pack.what.constructed</sub>

<a id="r409.2"></a>**409.2.** A pack may be looked at and used only during the draft step, and no player may look at another player's pack.

> *Example (non-normative): A seat sees its own pack only while its draft step is open, and never the other pack.* <sub>test: 418-cr-zones.test.ts::cr:zones.pack.private — a seat sees its own pack only while its draft step is open, and never the other pack</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16; Manual p.16 · Tests: 418-cr-zones.test.ts · Key: zones.pack.private</sub>

<a id="r409.3"></a>**409.3.** In the draft step, a player combines the non-token, non-resource cards in their hand with their pack, keeps any of them, and passes the pack on with exactly 10 cards in it. See 503. See rule 503.

> *Example (non-normative): The draft commit merges hand and pack, keeps any cards, and passes on a pack of exactly 10.* <sub>test: 418-cr-zones.test.ts::cr:zones.pack.drafting — the draft commit merges hand and pack, keeps any cards, and passes on a pack of exactly 10</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.6; Manual p.17 · Tests: 418-cr-zones.test.ts · Key: zones.pack.drafting</sub>

<a id="r409.4"></a>**409.4.** After each cycle of N+1 turns, where N is the number of players, every pack is recycled and each player is dealt a new pack of 10 cards.

<sub>Basis: Printed · Verified: confirmed, round 2, 2 tests run · Printed: Manual p.16; Manual p.16; Rulebook 2023 p.6 · Key: zones.pack.refresh</sub>

<a id="r409.4a"></a>**409.4a** In team draft, packs are never refreshed. See rule 904. *(Untested: no executed test demonstrates it.)*

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.6 · Key: zones.pack.refresh.team-draft</sub>

<a id="r409.5"></a>**409.5.** When a player is eliminated, their pack is recycled. See rule 104. *(Untested: no executed test demonstrates it.)*

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.16; Rulebook 2023 p.6 · Key: zones.pack.eliminated</sub>

<a id="r410"></a>
### 410. Zone Changes

<a id="r410.1"></a>**410.1.** A card that leaves play and comes back is a new object. It does not remember its earlier time in play.

> *Example (non-normative): Engorged Caudex is recalled and played again; its once-per-turn grafted draw works again the same turn.* <sub>test: 393-raq-mods.test.ts::RAQ Graft 101 calebgannon: a recalled and replayed Engorged Caudex is a new object</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1355115946032889914#16; RAQ 1355115946032889914#16 · Tests: 393-raq-mods.test.ts · Key: zones.changes.new-object</sub>

<a id="r410.1a"></a>**410.1a** An effect aimed at a card that has since changed zones does not affect it. An effect aimed at a card that is still in the same zone affects it only if the card is still a legal target for the slot it was chosen for; otherwise that target is lost as well. If every target is lost, the effect fails to resolve. See rules 704, 110.

> *Example (non-normative): Organic Exchange may target two of its caster's own units, and another spell aimed at one of them still resolves.* <sub>test: 396-raq-timing.test.ts::RAQ Another set: Organic Exchange may target two of your own units</sub>

> *Example (non-normative): An Ambush whose target ally was stolen in response recalls nothing: the unit is no longer its controller's ally.* <sub>test: 390-raq-stack.test.ts::RAQ valid targets: an Ambush whose ally changed sides before it resolves recalls nothing</sub>

> *Example (non-normative): Minor Kraken's target grows past 5 defense before it resolves, and is not recalled.* <sub>test: 390-raq-stack.test.ts::RAQ valid targets: a target that grows past 5 defense before Minor Kraken resolves is not recalled</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 3 tests run · Printed: Manual p.40 · Designer: RAQ 1454169054402314362#2; RAQ 1355466429788328066#1; RAQ 1355466429788328066#2 · Rulings: R324 · Tests: 396-raq-timing.test.ts, 390-raq-stack.test.ts, 418-cr-zones.test.ts · Key: zones.changes.new-object.targets</sub>

<sub>Discrepancies: D-U07-15 (discrepancies.md)</sub>

<a id="r410.1b"></a>**410.1b** Moving a mod from one unit to another is not a zone change: the mod never leaves play, and nothing despawns. See rule 720.

> *Example (non-normative): Reconfigure moves Bubb and its Growing Plague onto a Robot; Growing Plague's "when I despawn" does not trigger.* <sub>test: 393-raq-mods.test.ts::RAQ Reconfigure vs Despawn: moving Bubb and its Growing Plague onto a Robot fires no despawn</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353847640214999170#0; RAQ 1353847640214999170#0 · Tests: 393-raq-mods.test.ts · Key: zones.changes.new-object.reconfigure</sub>

<a id="r410.2"></a>**410.2.** A unit despawns whenever it leaves play, by any route: dying, being recalled, being cached, being exchanged or being erased. A "when I despawn" ability triggers whichever way the unit leaves. See rule 706.

> *Example (non-normative): A donated "[Augment] When I despawn" triggers when its host is recalled.* <sub>test: 141-despawn-mods.test.ts::R167 (i): a donated</sub>

> *Example (non-normative): An erased ally is seen despawning by Demon of the Depths.* <sub>test: 145-erase-routes.test.ts::R172 (i): an ERASE fires 'despawned'</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 4 tests run · Rulings: R167, R172 (its §1 erase-is-a-despawn and §4 Download halves) · Tests: 141-despawn-mods.test.ts, 145-erase-routes.test.ts · Key: zones.changes.despawn</sub>

<a id="r410.2a"></a>**410.2a** A unit exchanged out of play (Hooba-Mon, Necromorph) despawns and goes to the bin, where it is trashed, but it does not die.

> *Example (non-normative): Necromorph's exchange triggers no death ability, but the unit despawns and is trashed.* <sub>test: 135-exchange-and-zones.test.ts::exchange fires NO death trigger</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R157 (§3) · Tests: 135-exchange-and-zones.test.ts, 129-disposal-tail.test.ts · Key: zones.changes.despawn.exchange</sub>

<a id="r410.3"></a>**410.3.** A transformed card exists as its front face in every zone except play. It turns back over as it leaves play, before anything sees it leave.

> *Example (non-normative): A transformed Scholar of the Void that dies goes to the bin as Scholar of the Void.* <sub>test: 135-exchange-and-zones.test.ts::a transformed Scholar killed in play BINS as</sub>

> *Example (non-normative): It can then be returned from the bin as a Scholar.* <sub>test: 135-exchange-and-zones.test.ts::a transformed Scholar that died is RECURRABLE from the bin</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R157 (§10), R160 · Tests: 135-exchange-and-zones.test.ts, 145-erase-routes.test.ts · Key: zones.changes.face</sub>

<a id="r410.3a"></a>**410.3a** A unit that is copying another card (Borrower of Forms) leaves play as itself. If it dies it goes to the bin as Borrower of Forms; if it is recalled it goes to the hand as Borrower of Forms. See rule 710.

> *Example (non-normative): A Borrower that became something else still goes to the bin as Borrower of Forms.* <sub>test: 26-metal-a.test.ts::a Borrower that became something else still bins as BORROWER OF FORMS</sub>

> *Example (non-normative): Recalled, it goes back to the hand as Borrower of Forms.* <sub>test: 393-raq-mods.test.ts::RAQ Borrower of Forms: recalled, it goes back to the hand as Borrower of Forms</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1372468222158180424#2; RAQ 1372468222158180424#7 · Tests: 26-metal-a.test.ts, 393-raq-mods.test.ts · Key: zones.changes.face.copies</sub>

<a id="r410.4"></a>**410.4.** When a modded unit is recalled or cached, its mods go to the bin and the unit goes on alone. A token mod ceases to exist instead (see zones.changes.mods.token-mod). See rules 720, 403.7, 410.4d, 410.4c.

> *Example (non-normative): A recalled modded unit goes to the hand; its mods go to the bin and are trashed there.* <sub>test: 35-rot-debt-trash.test.ts::R40: recalling a modded unit trashes its MODS</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 3 tests run · Printed: Manual p.35; Manual p.35; Rulebook 2023 p.15 · Designer: RAQ 1372468222158180424#8 · Rulings: R46 · Tests: 35-rot-debt-trash.test.ts, 141-despawn-mods.test.ts · Key: zones.changes.mods</sub>

<a id="r410.4a"></a>**410.4a** A mod that goes to a bin when its host leaves play goes to the bin of the host's controller. See rule 400.4.

> *Example (non-normative): A virus on an opponent's unit goes to that opponent's bin when the unit leaves play.* <sub>test: 229-cosmic-and-control.test.ts::R250: a MOD goes to the HOST CONTROLLER bin, superseding R244 destination half</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R250 (its §4 zones-follow-control half) · Replaces: R244 (§1 "THE DESTINATION DOES NOT MOVE" paragraph (a mod goes to its own owner's bin), reversed by R250) · Tests: 229-cosmic-and-control.test.ts, 129-disposal-tail.test.ts · Key: zones.changes.mods.whose-bin</sub>

<a id="r410.4b"></a>**410.4b** A modded card is {Unstable}. When it dies or is erased, it and all of its mods are erased. See rules 803, 405.5.

<sub>Basis: Printed · Verified: confirmed, round 1, 2 tests run · Printed: Manual p.35; Rulebook 2023 p.15 · Key: zones.changes.mods.dies</sub>

<a id="r410.4c"></a>**410.4c** A token mod has no card of its own. It never enters a bin; when its host leaves play it ceases to exist.

> *Example (non-normative): A token mod on a dying {Unstable} unit is erased, never binned or trashed.* <sub>test: 35-rot-debt-trash.test.ts::R137: a TOKEN mod on a dying Unstable carrier is erased, never binned or trashed</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R244 (its §2 and token-mod sentence) · Tests: 35-rot-debt-trash.test.ts, 141-despawn-mods.test.ts · Key: zones.changes.mods.token-mod</sub>

<a id="r410.4d"></a>**410.4d** An exchange is not a death. But a modded unit is {Unstable}, so when it is exchanged out of play, it and all of its mods are erased, just as they would be if it died. See rules 410.4b, 405.5, 801.

> *Example (non-normative): Hooba-Mon exchanges itself while it carries a mod; it is erased, not left in a bin.* <sub>test: 42-dark-b.test.ts::R146: Hooba-Mon exchanges a MODDED host → the host is trashed, then ERASED (not left in a bin)</sub>

> *Example (non-normative): An unmodded Hooba-Mon exchanged the same way stays in the bin.* <sub>test: 42-dark-b.test.ts::R146 control: Hooba-Mon exchanges an UNMODDED host → it still BINS and stays there</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Printed: Manual p.35; card: Abyssal Evocation · Rulings: R157 (§3), R152 (its exchange route; the own-owner's-bin destination is superseded by R250) · Tests: 42-dark-b.test.ts, 135-exchange-and-zones.test.ts, 418-cr-zones.test.ts · Key: zones.changes.mods.exchanged</sub>

<sub>Discrepancies: D-U07-16 (discrepancies.md)</sub>

<a id="r410.5"></a>**410.5.** A token that leaves play goes to the zone it was sent to (a hand, a bin, a cache) and really is there. It ceases to exist there the next time state-based actions are checked, which is before anything it caused to trigger can resolve. See rules 304, 713, 400.2.

<sub>Basis: Mixed · Verified: confirmed, round 1, 3 tests run · Designer: RAQ 1355689559609839787#4 · Rulings: R152 (its §4 token-body ruling), R69 (its zone-visit and timing halves) · Replaces: R69 (its subsection "a dying token is trashed", reversed by R306) · Tests: 35-rot-debt-trash.test.ts · Key: zones.changes.tokens</sub>

<sub>Discrepancies: D-U07-1 (discrepancies.md)</sub>

<a id="r410.5a"></a>**410.5a** A unit token that dies enters the bin and is then erased. It is not trashed. See rule 801.

> *Example (non-normative): A dying token enters the bin, is not trashed, and is then erased.* <sub>test: 35-rot-debt-trash.test.ts::R69 + R306: a TOKEN dying enters the bin, is NOT trashed, and is then erased</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Designer: RAQ 1355689559609839787#4 · Rulings: R306 · Tests: 35-rot-debt-trash.test.ts, 338-tokens-are-not-trashed.test.ts · Key: zones.changes.tokens.dies</sub>

<a id="r410.5b"></a>**410.5b** A recalled token, unit or spell, enters its controller's hand and is then erased. It counts as a card entering a hand for anything that is watching. See rule 402.4.

> *Example (non-normative): A Fireball token recalled off the stack enters its controller's hand, Rider of the Tides sees it, and it is erased.* <sub>test: 393-raq-mods.test.ts::RAQ Recall Spell Token: a Fireball token recalled off the stack enters its controller hand</sub>

> *Example (non-normative): Recalling a unit token triggers Rider of the Tides too.* <sub>test: 15-water-b.test.ts::Rider of the Tides: recalling a TOKEN triggers it too</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1355689559609839787#3 · Rulings: R335 · Replaces: R250 (§1's stack half (a recalled spell token is erased straight off the stack), amended by R335) · Tests: 393-raq-mods.test.ts, 15-water-b.test.ts, 403-raq-fix-mods.test.ts · Key: zones.changes.tokens.recalled</sub>

<a id="r410.5c"></a>**410.5c** A token put into a cache enters the cache and is then erased.

> *Example (non-normative): A cached token is in the cache while the cache event happens, then is swept out.* <sub>test: 35-rot-debt-trash.test.ts::R69: a CACHED token visits the cache and is erased out of it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R69 (its zone-visit and timing halves) · Tests: 35-rot-debt-trash.test.ts · Key: zones.changes.tokens.cached</sub>

<sub>Discrepancies: D-U07-14 (discrepancies.md)</sub>

<a id="r410.5d"></a>**410.5d** Any spell tokens still in play are erased during regroup. See rule 506.

> *Example (non-normative): A Fireball spell token left unused is erased at regroup.* <sub>test: 418-cr-zones.test.ts::cr:zones.changes.tokens.spell-tokens-regroup — a Fireball spell token left unused is erased at regroup</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.15; Manual p.15 · Tests: 418-cr-zones.test.ts · Key: zones.changes.tokens.spell-tokens-regroup</sub>

<a id="r410.6"></a>**410.6.** A card is played from the zone it came out of, even when another effect plays it as it resolves. A card played from the cache, a bin or the deck is not played from the hand. See rules 701, 702.

> *Example (non-normative): Tides of the Cosmos plays cards off the top of the deck; Proph and Stalwart Sentinel ("from anywhere other than your hand") both see it.* <sub>test: 241-played-from-zone.test.ts::R263 §5: Tides of the Cosmos plays off the top of the deck</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R263, R263 · Tests: 241-played-from-zone.test.ts · Key: zones.changes.played-from</sub>

<a id="r410.6a"></a>**410.6a** A spell token is cast from where it stands in play, so it is played from somewhere other than the hand. See rule 304.

> *Example (non-normative): Casting a Fireball token triggers Stalwart Sentinel.* <sub>test: 408-raq-new-threads.test.ts::RAQ Spell Tokens vs Hand: casting a Fireball token triggers Stalwart Sentinel</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Rulebook 2023 p.4 · Rulings: R342 · Tests: 408-raq-new-threads.test.ts · Key: zones.changes.played-from.spell-token</sub>

<a id="r410.6b"></a>**410.6b** A token created by an effect was not played and came from no zone.

> *Example (non-normative): An effect-created token fires neither Proph nor Stalwart Sentinel.* <sub>test: 241-played-from-zone.test.ts::R263 §7: an effect-created token carries no zone at all</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R263 · Tests: 241-played-from-zone.test.ts · Key: zones.changes.played-from.created</sub>

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

<a id="r608.1"></a>**608.1.** The combat damage step is the step of a battle in which the units in formation deal combat damage. It begins once blocks have been declared and all players have passed priority in the window that follows them, and it is followed by the after combat step (see rule 609). See rules 607, 609.

> *Example (non-normative): Example (illustrative): A 2/5 attacks and is blocked by a 2/5. After blocks, the block window opens; once both players pass, each deals 2 to the other, and then the after combat step begins.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.overview — the step begins only once blocks are declared and both players pass, and the after combat step follows it</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.20; Rulebook 2023 p.11; Manual p.27 · Tests: 423-cr-combat-damage.test.ts · Key: combat.damage.overview</sub>

<a id="r608.1a"></a>**608.1a** The combat damage step takes place separately in each region where a battle takes place. A region that was not attacked has no combat damage step. See rules 601, 609.

> *Example (non-normative): Example (illustrative): The first attacker declares no attack, so the defending player’s region has no combat damage step. The second player then attacks, and the only combat damage step of the turn is in the first player’s region.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.overview.per-region — a battle round with no attack has no combat damage step</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.20; Manual p.20 · Tests: 423-cr-combat-damage.test.ts · Key: combat.damage.overview.per-region</sub>

<a id="r608.1b"></a>**608.1b** All combat damage is dealt simultaneously, unless an ability changes when a column deals its damage. Swift and Sluggish are the attributes that do (see rule 608.2). See rules 608.2, 802.4, 802.5.

> *Example (non-normative): Example (illustrative): A 3/3 attacks and is blocked by a 3/3. Both are dealt 3 at the same time, so both die.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.overview.simultaneous — two 3/3s in one exchange both deal their damage before either dies</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.23; Manual p.23; card: Rime Wraith · Tests: 423-cr-combat-damage.test.ts · Key: combat.damage.overview.simultaneous</sub>

<a id="r608.1c"></a>**608.1c** Combat damage is dealt by columns. The attacking units of one column deal their combat damage together, as one source, and so do the blocking units of one column. In this section, each of these two groups is called a half-column: a column has an attacking half and a blocking half. See rules 603, 802.20.

> *Example (non-normative): Two Slinks (Thieving) attack in one column and are not blocked. The column is one source of combat damage, so its controller draws one card, not two.* <sub>test: 388-raq-blocks-and-windows.test.ts::RAQ Thieving: two Thieving units in one column draw ONE card</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.23; card: Blightsea Polyp · Designer: RAQ 1460213341011050536#0 · Rulings: R320 · Tests: 388-raq-blocks-and-windows.test.ts · Key: combat.damage.overview.column-source</sub>

<a id="r608.2"></a>**608.2.** The combat damage step has three damage sub-steps, taken in this order: the Swift sub-step, the normal sub-step and the Sluggish sub-step. Each half-column strikes (deals its combat damage) only in the sub-steps that rule 608.2a gives it. The two halves of one column are scheduled separately. See rules 802.4, 802.5.

> *Example (non-normative): Example (illustrative): Dune Drifter (2/1, Swift) is blocked by a 1/5, and Ambling Mountaintop (Sluggish) attacks unblocked. The Drifter deals 2 in the Swift sub-step, the 1/5 strikes back in the normal sub-step and kills it, and the Mountaintop deals its damage last.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.substeps — Swift, then normal, then Sluggish, and the two halves of one column strike in their own sub-steps</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.43; Manual p.43 · Designer: RAQ 1540678747953569832#2 · Rulings: R295, R320 · Replaces: R3 (its first clause (immediate recalculation between sub-steps) stands; its second clause (no priority window between sub-steps) was amended by R295); R117 (states the order 'Swift → normal → Sluggish' and attributes it to R3, which does not state it) · Tests: 297-damage-substeps-are-steps.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.substeps</sub>

<a id="r608.2a"></a>**608.2a** A half-column that has Swift strikes in the Swift sub-step. A half-column that has Sluggish strikes in the Sluggish sub-step. A half-column that has neither strikes in the normal sub-step. See rules 802.4, 802.5.

> *Example (non-normative): Dune Drifter (2/1, Swift) and Rune Channeler (4/3) attack in one column and are blocked by a 2/2. The attacking half deals its 6 damage in the Swift sub-step; when that sub-step ends the 2/2 has been destroyed and the attackers are undamaged.* <sub>test: 02-combat.test.ts::R3/Swift: swift column deals damage first</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: card: Rime Wraith; card: Rime Wraith; Manual p.25 · Rulings: R295 · Tests: 02-combat.test.ts, 297-damage-substeps-are-steps.test.ts · Key: combat.damage.substeps.schedule</sub>

<sub>Discrepancies: D-U12-18, D-U12-3 (discrepancies.md)</sub>

<a id="r608.2b"></a>**608.2b** Whether a half-column has Swift or Sluggish depends on the combat attributes its units share: an attribute of any unit in a column is shared by every unit in that column (see rule 603). When a unit leaves a column, the other units in it lose the attributes that unit was sharing at once. See rules 603, 802.1.

> *Example (non-normative): Dune Drifter (Swift) and Lithoghul attack in one column, so Lithoghul would strike in the Swift sub-step. If Dune Drifter is recalled, Lithoghul at once strikes in the normal sub-step instead.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.substeps.column-attributes — a unit leaving a column takes the Swift it shared with it</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.24; Rulebook 2023 p.12; Manual p.24 · Engine: colAttrs · Tests: 423-cr-combat-damage.test.ts · Key: combat.damage.substeps.column-attributes</sub>

<a id="r608.2c"></a>**608.2c** A half-column that has both Swift and Sluggish strikes twice: once in the Swift sub-step and once in the Sluggish sub-step. It does not strike in the normal sub-step. See rules 802.4, 802.5.

> *Example (non-normative): Rime Wraith (2/1, Swift and Sluggish) and Vroot (4/4) attack in one column and are not blocked. The column deals 6 in the Swift sub-step and 6 more in the Sluggish sub-step.* <sub>test: 134-column-and-substep.test.ts::R157 §5 — a {Swift}{Sluggish} column strikes twice</sub>

> *Example (non-normative): Rime Wraith attacks alone and is not blocked. It deals 2 in the Swift sub-step, nothing strikes in the normal sub-step, and it deals 2 more in the Sluggish sub-step.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §5 a {Swift}{Sluggish} column strikes in two sub-steps</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Printed: Manual p.43 · Designer: RAQ 1363298910528864318#2 · Rulings: R157 (§5, its both-sub-steps answer), R295, R320 · Replaces: R157 (§5's ordering claim (triggers fire inside the sub-step) superseded by R261; its boundary amended by R295) · Tests: 134-column-and-substep.test.ts, 297-damage-substeps-are-steps.test.ts, 388-raq-blocks-and-windows.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.substeps.swift-and-sluggish</sub>

<a id="r608.2d"></a>**608.2d** If either half of a column contains a Pure card, neither half of that column has Swift or Sluggish for that exchange, so both halves strike in the normal sub-step. See rule 802.25.

> *Example (non-normative): A printed Swift column blocked by a Pure unit strikes in the normal sub-step.* <sub>test: 53-playtest-round7.test.ts::R117 threads {Pure}: a printed {Swift} column blocked by a Pure unit strikes in the NORMAL sub-step</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Just a Unit · Rulings: R61, R117 (its {Pure} pairing paragraph) · Tests: 53-playtest-round7.test.ts · Key: combat.damage.substeps.pure</sub>

<sub>Discrepancies: D-U12-12 (discrepancies.md)</sub>

<a id="r608.2e"></a>**608.2e** A half-column that has struck in the Swift sub-step does not strike in the normal sub-step, even if the unit that gave it Swift has since left the column, and even if a new unit has since been put into that column. A half-column that has struck in the normal sub-step does not strike in the Sluggish sub-step, even if it has since gained Sluggish. A half-column that struck in the Swift sub-step and has Sluggish in the Sluggish sub-step strikes again then (rule 608.2c). This record belongs to the half-column, not to the units in it, and it stays with that column if the columns are renumbered (for example, when a new column is opened to its left). See rule 603.

> *Example (non-normative): Dune Drifter (2/1, Swift) and a 3/3 attack in one column; a 1/1 attacks in another. The Swift column deals 5 in the Swift sub-step. Dune Drifter is then recalled. In the normal sub-step only the 1/1's column strikes.* <sub>test: 388-raq-blocks-and-windows.test.ts::RAQ Swift: a column that dealt Swift damage deals no normal damage</sub>

> *Example (non-normative): After Dune Drifter's column strikes in the Swift sub-step, Dune Drifter is recalled and Tiderunner Initiate is played into the emptied column. Tiderunner Initiate deals no normal combat damage.* <sub>test: 388-raq-blocks-and-windows.test.ts::RAQ Swift: a Tiderunner played into an emptied Swift column deals no normal damage</sub>

> *Example (non-normative): A column that struck in the Swift sub-step keeps its record when a new column is opened on its left.* <sub>test: 400-raq-fix-blocks.test.ts::R320 a struck mark moves with its column when a new column opens on the left</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 3 tests run · Designer: RAQ 1363298910528864318#1; RAQ 1363298910528864318#3; RAQ 1363298910528864318#4 · Rulings: R320 · Engine: struck · Tests: 388-raq-blocks-and-windows.test.ts, 400-raq-fix-blocks.test.ts · Key: combat.damage.substeps.struck-mark</sub>

<sub>Discrepancies: D-U12-16 (discrepancies.md)</sub>

<a id="r608.2f"></a>**608.2f** Whether a half-column strikes in a sub-step is determined as that sub-step begins, from the units then in the column and the attributes they then share. See rule 603.

> *Example (non-normative): A column strikes in the Swift sub-step and then gains Sluggish. It strikes again in the Sluggish sub-step.* <sub>test: 388-raq-blocks-and-windows.test.ts::RAQ Swift: a Swift column that gains Sluggish strikes again in the Sluggish sub-step</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.24 · Designer: RAQ 1363298910528864318#2 · Rulings: R3 (its recalculation clause) · Replaces: R3 (only its first clause is cited here; its second clause (no priority window between sub-steps) was amended by R295) · Tests: 388-raq-blocks-and-windows.test.ts · Key: combat.damage.substeps.live-attributes</sub>

<a id="r608.3"></a>**608.3.** A combat damage step is split if, when the step begins, half-columns are scheduled to strike in two or more different sub-steps. Otherwise it is unsplit. Only Swift and Sluggish can split a step. See rules 802.4, 802.5.

> *Example (non-normative): Example (illustrative): Dune Drifter (Swift) is blocked by a unit without Swift or Sluggish. The attacking half strikes in the Swift sub-step and the blocking half in the normal one, so the step is split.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.split — a Swift attacking half over a normal blocking half splits the step into two sub-steps with a window between them</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Designer: RAQ 1363298910528864318#0; RAQ 1540678747953569832#2 · Rulings: R295 · Replaces: R261 (made the hold of combat-damage triggers unconditional; R295 made it apply only to an unsplit step); R3 (its second clause ('no priority window between damage sub-steps') was amended by R295) · Tests: 297-damage-substeps-are-steps.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.split</sub>

<sub>Discrepancies: D-U12-9 (discrepancies.md)</sub>

<a id="r608.3a"></a>**608.3a** In an unsplit step, all combat damage is dealt at once, as one step. No player receives priority during it, and abilities that trigger during it wait until the after combat step (see rule 608.9b). See rules 609, 703.

> *Example (non-normative): Lithoghul (4/4) and Geode (1/1) attack in separate columns and are not blocked. Neither has Swift or Sluggish, so the step is unsplit; the 5 damage is dealt at once and the game goes straight to the after combat step.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §3 the control: with no {Swift} and no {Sluggish} anywhere</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1363298910528864318#0; RAQ 1540678747953569832#0 · Rulings: R295, R300, R261 (its unsplit hold) · Tests: 297-damage-substeps-are-steps.test.ts, 239-damage-triggers-after-combat.test.ts · Key: combat.damage.split.unsplit</sub>

<sub>Discrepancies: D-U12-1 (discrepancies.md)</sub>

<a id="r608.3b"></a>**608.3b** In a split step, each sub-step that was scheduled, when the step began, to have a half-column strike in it is a separate step. After each such sub-step except the last scheduled one, the abilities that triggered during it are put on the stack and players receive priority; the next sub-step deals no damage until that stack has resolved and all players have passed priority in succession with it empty. State-based changes (deaths, back-row units moving forward, lost shared attributes) have already happened when this window opens. See rules 703, 706.

> *Example (non-normative): Bripp (4 power) and Bloated Manablub (2 power) attack in normal columns, and Adversary of the Deep (2/2, Sluggish; 'Whenever a player loses life, put that many +1/+1 counters on me') attacks in a third column. None are blocked. The normal sub-step deals 6; the step stops, Adversary's trigger resolves with priority, and Adversary strikes in the Sluggish sub-step for 8.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §1 the report</sub>

> *Example (non-normative): At the boundary, the stack holds Adversary of the Deep's trigger and priority is with the player who does not control it.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §2 the boundary is a real priority window</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1540678747953569832#2; RAQ 1363298910528864318#0 · Rulings: R295, R295 · Replaces: R31 (said sub-step triggers resolve immediately, as special actions, with no priority window; superseded by R261 and R295); R3 (its second clause (no priority window between sub-steps) was amended by R295); R261 (its unconditional hold was made conditional on an unsplit step by R295) · Engine: pumpCombatDamage · Tests: 297-damage-substeps-are-steps.test.ts, 239-damage-triggers-after-combat.test.ts, 21-fixes.test.ts · Key: combat.damage.split.boundary-window</sub>

<a id="r608.3c"></a>**608.3c** A sub-step in which no half-column was scheduled to strike when the step began is not a separate step: no window opens after it. A scheduled sub-step keeps its window even if every half-column scheduled for it has since been destroyed. No window opens after the last scheduled sub-step; a half-column that still strikes in a later sub-step (rule 608.2f) strikes without a window before it, and then the after combat step begins.

> *Example (non-normative): Dune Drifter (Swift) and Lithoghul attack in separate columns and are not blocked. Half-columns strike in the Swift and normal sub-steps and nothing strikes in the Sluggish sub-step, so there is exactly one window, between the Swift and normal sub-steps.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §3b an EMPTY sub-step opens no window</sub>

> *Example (non-normative): Example (illustrative): Dune Drifter (Swift) and a 1/1 attack in separate columns and are not blocked. At the window after the Swift sub-step, Dune Drifter's column gains Sluggish. The 1/1 strikes in the normal sub-step and no window follows; Dune Drifter's column then strikes in the Sluggish sub-step, and the after combat step begins.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.split.empty-substep — a column that gains Sluggish after the last scheduled sub-step strikes with no window before it, then after combat begins</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Rulings: R295, R295 · Engine: pumpCombatDamage · Tests: 297-damage-substeps-are-steps.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.split.empty-substep</sub>

<sub>Discrepancies: D-U12-10 (discrepancies.md)</sub>

<a id="r608.3d"></a>**608.3d** Which sub-steps are separate steps is determined once, when the combat damage step begins. A unit that dies, leaves or loses an attribute during the step does not make a split step unsplit.

> *Example (non-normative): Dune Drifter (Swift) attacks beside Lithoghul and is blocked by another Dune Drifter. Both Swift units destroy each other in the Swift sub-step; the window before the normal sub-step still opens, and the death triggers can be answered there.* <sub>test: 297-damage-substeps-are-steps.test.ts::R295 §4 damageSubs is fixed when the step opens</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R295 · Tests: 297-damage-substeps-are-steps.test.ts · Key: combat.damage.split.schedule-fixed</sub>

<sub>Discrepancies: D-U12-11 (discrepancies.md)</sub>

<a id="r608.3e"></a>**608.3e** Between sub-steps, the game's state is updated before anything else: units with lethal damage are destroyed, a unit behind a removed unit moves to the front row, and attributes shared by a removed unit are lost. A unit destroyed in an earlier sub-step deals no damage in a later one, and damage in a later sub-step is assigned to the formation as it then stands. Columns do not close gaps after blocks have been declared. See rules 602, 603.

> *Example (non-normative): Dune Drifter (2/1, Swift) is blocked by a 2/2 in front of a 4/3. Its Swift damage destroys the 2/2; the 4/3 is already in front when the boundary window opens, and in the normal sub-step it destroys Dune Drifter while taking no damage.* <sub>test: 05-rulings.test.ts::R3 + R295: formation recalc between damage sub-steps is immediate</sub>

> *Example (non-normative): A blocking column whose attacker was destroyed in an earlier sub-step deals nothing in a later sub-step.* <sub>test: 64-formation-collapse.test.ts::R72 (ruling): a hole deals nothing in a LATER sub-step either</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: Manual p.22; Manual p.22; Manual p.24 · Rulings: R3 (its recalculation clause), R295, R300, R72 (its two halves of formation gravity) · Replaces: R3 (first clause cited; second clause amended by R295); R261 (claimed both halves of R3 'still true'; R295 amended the second half) · Tests: 05-rulings.test.ts, 64-formation-collapse.test.ts · Key: combat.damage.split.state-between</sub>

<a id="r608.4"></a>**608.4.** Each attacking half-column deals its combat damage either to the defending player or to the blocking half-column in front of it, and each blocking half-column deals its combat damage to the attacking half-column it blocks. Piercing can also carry combat damage to a player (see rule 802.16). An attacking column is blocked once a blocking unit has been placed in front of it, normally in the block step (see rule 606) or later as rule 608.4d allows. See rules 606, 802.16.

> *Example (non-normative): Example (illustrative): A 3/5 and a 4/5 attack in two columns; a 2/5 blocks the 3/5. The 3/5 deals 3 to the blocker, the blocker deals 2 to the 3/5, and the 4/5 deals 4 to the defending player.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.pairing — an unblocked attacking column hits the player, a blocked one hits its blocker, and the blocker hits the column it blocks</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.11; Rulebook 2023 p.11; Manual p.23 · Rulings: R322 · Tests: 423-cr-combat-damage.test.ts · Key: combat.damage.pairing</sub>

<a id="r608.4a"></a>**608.4a** An attacking half-column that is not blocked deals its combat damage to the defending player.

> *Example (non-normative): Slink (2/3) attacks and is not blocked. The defending player is dealt 2 combat damage.* <sub>test: 09-attrs.test.ts::Thieving: Slink draws when its column deals combat damage to a player</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.23; Manual p.20 · Tests: 387-raq-combat.test.ts, 09-attrs.test.ts · Key: combat.damage.pairing.unblocked</sub>

<a id="r608.4b"></a>**608.4b** An attacking half-column that is blocked deals its combat damage to the units of the blocking half-column in front of it, and that blocking half-column deals its combat damage to the units of the attacking half-column. A blocked attacking half-column deals no combat damage to the defending player, except as Piercing allows (see rule 802.16). See rule 802.16.

> *Example (non-normative): Example (illustrative, from the Manual p.23): The column of Living Forge and A Pile of Rubbish deals a combined 3 damage to the Tiderunner Initiate blocking it; the Tiderunner deals 2 back, all to Living Forge because it is in the front.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.pairing.blocked — the Manual p.23 example: Living Forge and A Pile of Rubbish deal 3 to the blocking Tiderunner Initiate, which deals 2 back, and the player takes nothing</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.23; Manual p.23; Manual p.23 · Tests: 02-combat.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.pairing.blocked</sub>

<a id="r608.4c"></a>**608.4c** Once an attacking column is blocked, it remains blocked for the rest of the battle, however its blockers leave the blocking half-column: destroyed, recalled, erased or stolen. If no blocking unit remains when that column strikes, an attacking half-column without Piercing deals no combat damage at all, and one with Piercing deals all of its damage to the defending player (see rule 802.16). See rules 606, 802.16.

> *Example (non-normative): A vanilla attacker is blocked; the blocker is then recalled before damage. The column stays blocked and the defending player is dealt no damage.* <sub>test: 157-blocked-stays-blocked.test.ts::R185: a blocker that is RECALLED leaves the column blocked</sub>

> *Example (non-normative): Good Whale (7/5, Piercing) is blocked by a 1/1 that dies before damage. All 7 of its damage is dealt to the defending player.* <sub>test: 387-raq-combat.test.ts::RAQ Piercing: a Piercing column whose blocker died before damage puts its full power into the player</sub>

> *Example (non-normative): A 7/5 without Piercing is blocked by a 1/1 that dies before damage. It deals nothing to the defending player.* <sub>test: 387-raq-combat.test.ts::RAQ Piercing: a blocked NON-Piercing column whose blocker died deals nothing to the player</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 3 tests run · Printed: Manual p.23; Rulebook 2023 p.11 · Designer: RAQ 1365594171867664445#1 · Rulings: R185, R13 (its conclusion) · Replaces: R13 (its conclusion stands; its reason ('piercing excess is automatic per R7') rests on R7's Piercing half, reversed by R319) · Tests: 157-blocked-stays-blocked.test.ts, 387-raq-combat.test.ts · Key: combat.damage.pairing.stays-blocked</sub>

<sub>Discrepancies: D-U12-15 (discrepancies.md)</sub>

<a id="r608.4d"></a>**608.4d** If, after blocks have been declared and before combat damage is over, a unit is put into the defending formation in front of an unblocked attacking column, that column becomes blocked, and it stays blocked if that unit later leaves. The defending player may do this even if they declared no blockers. See rules 606, 607.

> *Example (non-normative): Tiderunner Initiate is played in front of an unblocked attacker after blocks; the attacker deals its damage to the Tiderunner instead of the defending player.* <sub>test: 400-raq-fix-blocks.test.ts::R322 a Tiderunner put in front of an unblocked attacker fights it</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1366447016653361192#1; RAQ 1366447016653361192#1 · Rulings: R322 · Tests: 400-raq-fix-blocks.test.ts, 388-raq-blocks-and-windows.test.ts · Key: combat.damage.pairing.late-blocker</sub>

<sub>Discrepancies: D-U12-22, D-U12-4 (discrepancies.md)</sub>

<a id="r608.4e"></a>**608.4e** A blocking half-column with no attacking unit left in front of it when it would strike deals no combat damage, even if it has Piercing. See rule 802.16.

> *Example (non-normative): Good Whale (7/5, Piercing) blocks a column whose only attacker is destroyed in the block window. Good Whale deals no damage to the attacking player and takes none.* <sub>test: 64-formation-collapse.test.ts::R72 (ruling): a hole deals and takes no damage — Piercing included</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1365594171867664445#3 · Rulings: R72 (its blocker-whose-attackers-died paragraph) · Tests: 64-formation-collapse.test.ts · Key: combat.damage.pairing.attackers-gone</sub>

<a id="r608.4f"></a>**608.4f** A unit blocking where no attacking unit is (a side-block) forms a blocking half-column with no attacker in front of it. It deals no combat damage, even if it has Piercing, and it never makes the combat damage step split. See rules 606, 802.16.

> *Example (non-normative): A Piercing unit side-blocks. It deals no combat damage to the attacking player.* <sub>test: 400-raq-fix-blocks.test.ts::R321 a Piercing side-blocker deals no combat damage to the attacking player</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.23 · Designer: RAQ 1365594171867664445#2 · Rulings: R321, R321 · Tests: 400-raq-fix-blocks.test.ts · Key: combat.damage.pairing.side-block</sub>

<a id="r608.5"></a>**608.5.** A half-column's combat damage is the combined power of the units in it when it strikes, counted as rule 608.5c describes. See rule 206.

> *Example (non-normative): Example (illustrative): A 1/1 and a 2/2 attack in one column beside a Swift column. In the window after the Swift sub-step the 1/1 gets two +1/+1 counters, so the column deals 3 + 2 = 5 in the normal sub-step.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.amount — a column deals the combined power of its units as it is when it strikes, read after a pump between sub-steps</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.23; Rulebook 2023 p.10 · Tests: 02-combat.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.amount</sub>

<a id="r608.5a"></a>**608.5a** A unit with 0 power deals no damage, but it does not stop its column from dealing the combined power of the other units in it. A half-column whose combined power is 0 deals no combat damage.

> *Example (non-normative): Zephyrzoa, reduced to 0 power, is in a column with a powered unit. The column deals combat damage and Zephyrzoa's 'when my column deals combat damage' ability triggers.* <sub>test: 134-column-and-substep.test.ts::R157 §4 — Zephyrzoa: a 0-power anchor in a POWERED column still fires</sub>

> *Example (non-normative): Zephyrzoa, reduced to 0 power, attacks alone. Its column deals no combat damage and its ability does not trigger.* <sub>test: 134-column-and-substep.test.ts::R157 §4 — Zephyrzoa: alone in a 0-POWER column it hears nothing</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R157 (§4) · Tests: 134-column-and-substep.test.ts · Key: combat.damage.amount.zero-power</sub>

<sub>Discrepancies: D-U12-5 (discrepancies.md)</sub>

<a id="r608.5b"></a>**608.5b** Powerful doubles a half-column's combined power once, before that damage is divided among its recipients (see rule 802.10). Vulnerable does not change the amount a half-column deals; it doubles what a Vulnerable unit is dealt (see rule 802.11). See rules 802.10, 802.11.

> *Example (non-normative): Chitin Shredder (Powerful) attacks unblocked; the defending player is dealt double its column's power.* <sub>test: 09-attrs.test.ts::Powerful: Chitin Shredder deals double combat damage to a player</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1362838395298119912#2; RAQ 1372451771632320512#3 · Rulings: R23 · Tests: 09-attrs.test.ts, 387-raq-combat.test.ts · Key: combat.damage.amount.modifier-order</sub>

<sub>Discrepancies: D-U12-19, D-U12-7, D-U12-8 (discrepancies.md)</sub>

<a id="r608.5c"></a>**608.5c** When a half-column's combined power is counted, a unit with negative power counts as 0: it deals no damage and does not reduce its column's damage. In an exchange in which Unaware applies, each unit's printed power is used. See rule 802.9.

> *Example (non-normative): Example (illustrative): Lithoghul (4/4) and a -2/3 token attack in one column and are not blocked. The column deals 4.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.amount.counting — a negative-power unit counts as 0 and does not reduce its column</sub>

> *Example (non-normative): An Unaware blocker and the column it blocks both read their printed stats.* <sub>test: 05-rulings.test.ts::R10/R106: an Unaware blocker and what it blocks BOTH read at printed</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.42; Manual p.42 · Rulings: R106 · Tests: 05-rulings.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.amount.counting</sub>

<sub>Discrepancies: D-U12-6 (discrepancies.md)</sub>

<a id="r608.6"></a>**608.6.** When a half-column deals combat damage to the units of the opposing half-column, its damage is divided among those units, starting with the front unit and then the unit behind it. See rule 602.

> *Example (non-normative): Example (from the Manual p.23): Living Forge and A Pile of Rubbish attack in one column and are blocked by Tiderunner Initiate. All 2 of the Tiderunner’s damage goes to Living Forge, in front; none goes to A Pile of Rubbish behind it.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.assignment — the Manual p.23 example: the blocking half-column damage goes to the front unit first, none to the unit behind it</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Printed: Manual p.23 · Designer: RAQ 1353888077625561108#2 · Rulings: R114 (its elective-split and dealt-in-full halves) · Tests: 100-elective-assign.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.assignment</sub>

<a id="r608.6a"></a>**608.6a** The controller of the half-column dealing the damage divides it: the attacking player divides an attacking half-column's damage among the blocking units, and the defending player divides a blocking half-column's damage among the attacking units. See rule 608.6.

> *Example (non-normative): A 4-power attacker is blocked by two 1/1s. The attacking player is asked how to divide the 4.* <sub>test: 100-elective-assign.test.ts::R120 (a): the ATTACKER is asked</sub>

> *Example (non-normative): The defending player divides a blocking half-column's damage and may put all of it on the front attacker.* <sub>test: 100-elective-assign.test.ts::R120 (h): the BLOCK-side strike multi-assigns too</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Printed: Manual p.43 · Rulings: R7 (its who-decides half), R120 (the dealing side is asked) · Replaces: R7 (its Piercing half ('Piercing is automatic, not elective') was reversed by R319); R120 (its exclusion of Piercing strikes from the elective split was reversed by R319) · Tests: 100-elective-assign.test.ts · Key: combat.damage.assignment.chooser</sub>

<a id="r608.6b"></a>**608.6b** Lethal damage (rule 608.6e) must be assigned to a unit before any damage is assigned to the unit behind it.

> *Example (non-normative): Amounts below the front unit's lethal damage are never offered while any damage could go behind it.* <sub>test: 100-elective-assign.test.ts::R120 (c): amounts below the front unit</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.23 · Designer: RAQ 1353888077625561108#2 · Rulings: R114 (its elective-split and dealt-in-full halves) · Tests: 100-elective-assign.test.ts · Key: combat.damage.assignment.lethal-first</sub>

<a id="r608.6c"></a>**608.6c** A unit may be assigned more than lethal damage. The dealing player may assign all of a half-column's damage to the front unit and none to the unit behind it, even if there is enough to destroy both.

> *Example (non-normative): A 4-power attacker is blocked by a 1/1 in front of a 1/1. The attacking player assigns all 4 to the front 1/1; the back 1/1 is untouched.* <sub>test: 100-elective-assign.test.ts::R120 (a): the ATTACKER is asked</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.43 · Designer: RAQ 1353888077625561108#1 · Rulings: R114 (its elective-split and dealt-in-full halves) · Tests: 100-elective-assign.test.ts · Key: combat.damage.assignment.overkill</sub>

<sub>Discrepancies: D-U12-2 (discrepancies.md)</sub>

<a id="r608.6d"></a>**608.6d** All combat damage assigned to a unit is dealt to that unit, including any beyond its lethal damage; none of it is lost. A half-column without Piercing that has at least one unit to deal damage to assigns all of its damage to those units, so none of it reaches the player; any of its damage still unassigned when the last unit is reached is assigned to that unit. See rules 802.16, 608.4c.

> *Example (non-normative): Rune Channeler (4/3, no Piercing) is blocked by a 1/1. All 4 damage is dealt to the 1/1; none is lost and none reaches the player.* <sub>test: 05-rulings.test.ts::R114: without Piercing the excess is not lost, it lands on the unit</sub>

> *Example (non-normative): An overkill combat hit on Mirage Scuttler marks the whole amount, not only the lethal part.* <sub>test: 17-earth-b.test.ts::Mirage Scuttler: an overkill combat hit marks the WHOLE amount</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: Manual p.23 · Designer: RAQ 1353888077625561108#0 · Rulings: R114 (its elective-split and dealt-in-full halves) · Replaces: R98 (its open item 1 (prevention counters capped at lethal because excess combat damage was dropped) was superseded by R114); R114 (its description of Piercing's leftover as always carried to the face was amended by R319) · Tests: 05-rulings.test.ts, 24-wood-b.test.ts, 17-earth-b.test.ts · Key: combat.damage.assignment.dealt-in-full</sub>

<sub>Discrepancies: D-U12-20 (discrepancies.md)</sub>

<a id="r608.6e"></a>**608.6e** Lethal damage, for assignment, is the smallest amount of the half-column's damage that would destroy the unit, given the damage already marked on it: its remaining defense; half of that, rounded up, if the unit is Vulnerable; 1 if the half-column has Deadly. In an exchange in which Unaware applies, the unit's printed defense, less the damage already marked on it, is used. In an exchange involving a Pure card, neither Vulnerable nor Deadly changes lethal damage. See rules 802.3, 802.9, 802.11, 802.25.

> *Example (non-normative): A Deadly half-column's lethal damage for each blocker is 1.* <sub>test: 100-elective-assign.test.ts::R120 (e): {Deadly} floors are 1</sub>

> *Example (non-normative): A 10-power Piercing half-column blocked by a Vulnerable 3/8 must assign 4 to it, and the other 6 may go to the player.* <sub>test: 387-raq-combat.test.ts::RAQ Vulnerable: a 10-power Piercing column into a Vulnerable 3/8 assigns 4 and 6 goes to the player</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 2 tests run · Designer: RAQ 1353888077625561108#3; RAQ 1372451771632320512#3 · Rulings: R120 (the dealing side is asked), R61 · Tests: 100-elective-assign.test.ts, 387-raq-combat.test.ts, 134-column-and-substep.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.assignment.lethal-defined</sub>

<sub>Discrepancies: D-U12-17 (discrepancies.md)</sub>

<a id="r608.6f"></a>**608.6f** If the opposing half-column has only one unit, all of the damage is assigned to that unit; with Piercing, the dealing player may instead send damage beyond that unit's lethal damage to its controller (see rule 802.16). See rule 802.16.

> *Example (non-normative): A Piercing attacker with 10 power is blocked by a lone Vulnerable 3/8. It may assign all 10 to that unit (dealt as 20), and then none reaches the player.* <sub>test: 399-raq-fix-combat.test.ts::R319: a Piercing attacker may put all 10 into a lone Vulnerable 3/8</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353888077625561108#0; RAQ 1372451771632320512#4 · Rulings: R319 (its combat Piercing election) · Tests: 05-rulings.test.ts, 399-raq-fix-combat.test.ts · Key: combat.damage.assignment.lone-unit</sub>

<a id="r608.6g"></a>**608.6g** Damage prevention on a unit does not change its lethal damage. Lethal damage is worked out as if the unit were not protected, and the prevention applies when the damage is dealt (rule 608.7a). See rule 708.

> *Example (non-normative): A shielded 0/5 Awoken Tomb is in front of a 5/6. At least 5 must be assigned to the Tomb before any is assigned to the 5/6.* <sub>test: 387-raq-combat.test.ts::RAQ Excessive: a shielded Awoken Tomb in front must still be assigned its 5</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353888077625561108#8 · Rulings: R98 (its assignment and prevention paragraphs) · Tests: 387-raq-combat.test.ts · Key: combat.damage.assignment.shields-ignored</sub>

<a id="r608.6h"></a>**608.6h** In each sub-step, every half-column's damage is divided before any damage in that sub-step is dealt.

> *Example (non-normative): Example (illustrative): Two 10/20 attackers are each blocked by two 1/3s. Both attackers are asked how to divide their damage, and no damage is dealt until both have answered.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.assignment.timing — both columns are asked for their split before any damage of the sub-step is dealt</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R120 (the dealing side is asked) · Tests: 100-elective-assign.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.assignment.timing</sub>

<a id="r608.7"></a>**608.7.** All the combat damage of one sub-step is dealt simultaneously. Damage dealt to a unit is marked on it; a Vulnerable unit is dealt double the damage assigned to it (see rule 802.11), and a Poisonous source deals its damage to units in the form of -1/-1 counters (see rule 802.18). See rules 802.11, 802.18.

> *Example (non-normative): Crumbling Ancient (Vulnerable) is marked with double the combat damage assigned to it.* <sub>test: 09-attrs.test.ts::Vulnerable: Crumbling Ancient marks double the combat damage it receives</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.23; card: Blightmound · Designer: RAQ 1372451771632320512#4 · Rulings: R237 · Tests: 09-attrs.test.ts · Key: combat.damage.dealing</sub>

<a id="r608.7a"></a>**608.7a** Prevention applies as combat damage is dealt. Damage that is prevented is not dealt: it is not marked, it places no -1/-1 counters, it does not trigger abilities that trigger on a unit being dealt damage, and it cannot destroy a unit through Deadly. See rule 708.

> *Example (non-normative): A 12-power half-column is blocked by an Awoken Tomb under Phytochemical Protection in front of a 5/6. The 5 combat damage assigned to the Tomb is prevented: none is marked, and the Tomb’s “when I am dealt damage” ability does not trigger.* <sub>test: 387-raq-combat.test.ts::RAQ Excessive: a shielded Awoken Tomb in front must still be assigned its 5 before anything goes behind it</sub>

> *Example (non-normative): A Deadly half-column cannot destroy a unit whose damage is prevented.* <sub>test: 24-wood-b.test.ts::Phytochemical Protection: {Deadly} cannot kill through it</sub>

<sub>Basis: Mixed · Verified: confirmed, round 2, 4 tests run · Designer: RAQ 1354148437355925554#1 · Rulings: R98 (its assignment and prevention paragraphs) · Tests: 24-wood-b.test.ts, 387-raq-combat.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.dealing.prevention</sub>

<a id="r608.7b"></a>**608.7b** After a sub-step's damage has been dealt, units with lethal damage, and units dealt damage by a Deadly source, are destroyed before the next sub-step begins. See rules 713, 802.3.

> *Example (non-normative): A Swift half-column destroys its 2/2 blocker in the Swift sub-step; the blocker never strikes back in the normal sub-step.* <sub>test: 02-combat.test.ts::R3/Swift: swift column deals damage first</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R21 (its Deadly-kill timing), R300, R3 (its recalculation clause) · Replaces: R21 (its 'auto-assignment' wording for Deadly + Piercing is now only the default (R319)) · Tests: 02-combat.test.ts, 239-damage-triggers-after-combat.test.ts · Key: combat.damage.dealing.deaths</sub>

<a id="r608.7c"></a>**608.7c** Damage marked on units remains until the regroup phase, when it is removed. See rule 506.

> *Example (non-normative): An attacker and its blocker each have 2 damage marked in the first battle of the turn. Both still have 2 damage marked when the second battle begins; it is removed in the regroup phase.* <sub>test: 423-cr-combat-damage.test.ts::cr:combat.damage.dealing.regroup — damage from the first battle of the turn is still marked when the second battle starts, and is removed in regroup</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.11; Manual p.27 · Tests: 05-rulings.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.dealing.regroup</sub>

<a id="r608.8"></a>**608.8.** Combat damage is dealt to a player in two ways: by an unblocked attacking half-column (rule 608.4a), and as Piercing excess from an attacking half-column, or from a blocking half-column with an attacker in front of it (see rule 802.16). Combat damage dealt to a player causes that player to lose that much life, unless an effect replaces that damage or changes the life lost. See rules 112, 802.16.

> *Example (non-normative): A Piercing attacker is not blocked; all of its damage is dealt to the defending player.* <sub>test: 387-raq-combat.test.ts::RAQ Piercing: an unblocked Piercing column hits the player</sub>

> *Example (non-normative): A blocking Piercing half-column with an attacker in front of it deals its excess to the attacking player.* <sub>test: 387-raq-combat.test.ts::RAQ Piercing: a defending Piercing column with an attacker in front of it carries its excess to the attacker</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: card: Adversary of the Deep; Manual p.23 · Designer: RAQ 1365594171867664445#3 · Tests: 387-raq-combat.test.ts · Key: combat.damage.player</sub>

<a id="r608.8a"></a>**608.8a** Combat damage to a player that an effect replaces (for example, Blightsea Polyp's rot) was still dealt. An ability that triggers when a column deals combat damage to a player still triggers, and reads the damage dealt, even if the player lost no life. See rules 708, 112.

> *Example (non-normative): A fully replaced combat hit still counts as dealt: Vroot's 'that much' pays out the damage its column dealt, not the life the player lost.* <sub>test: 207-replaced-hit-was-dealt.test.ts::R238: the payout is the DAMAGE DEALT, not the life lost</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R238, R195 (its per-column attribution) · Replaces: R195 (its reading of 'my column deals combat damage' off the life lost was amended by R238 to read the damage dealt) · Tests: 207-replaced-hit-was-dealt.test.ts · Key: combat.damage.player.replaced-still-dealt</sub>

<sub>Discrepancies: D-U12-21 (discrepancies.md)</sub>

<a id="r608.8b"></a>**608.8b** Damage dealt by an ability that a source's combat damage causes, such as Resonant's extra damage, is not combat damage, even when it is dealt during or because of combat. See rule 802.19.

> *Example (non-normative): Resonant's extra damage to a player is not combat damage, so Oorblak does not take it; the player does.* <sub>test: 387-raq-combat.test.ts::RAQ Resonant: the extra damage is not combat damage</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1362838395298119912#0 · Rulings: R315 (its rider-is-the-source's-trigger ruling) · Tests: 387-raq-combat.test.ts, 399-raq-fix-combat.test.ts · Key: combat.damage.player.not-combat</sub>

<a id="r608.8c"></a>**608.8c** If combat damage that would be dealt to a player is dealt to a unit instead (as Oorblak's ability does), the replacement applies to that damage once. Without Piercing, all of that damage is dealt to the unit. With Piercing, the damage beyond the unit's lethal damage is dealt to the player, and it is not redirected again. See rules 708, 802.16. *(Engine differs, see F-U12-1.)*

> *Example (non-normative): 10 Piercing combat damage that would be dealt to a player is redirected into a 2/4 Oorblak. 4 destroy it, and the other 6 are dealt to the player.* <sub>test: 387-raq-combat.test.ts::RAQ Oorblak: 10 Piercing combat damage redirected into a 2/4 Oorblak</sub>

> *Example (non-normative): A non-Piercing overkill redirected into Oorblak is absorbed whole; nothing reaches the player.* <sub>test: 17-earth-b.test.ts::Oorblak: a NON-Piercing overkill is absorbed whole</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Printed: card: Oorblak · Designer: RAQ 1397188292239163454#0; RAQ 1397188292239163454#0 · Tests: 387-raq-combat.test.ts, 17-earth-b.test.ts · Key: combat.damage.player.redirect</sub>

<sub>Discrepancies: D-U12-13 (discrepancies.md)</sub>

<a id="r608.9"></a>**608.9.** An ability that triggers on combat damage, or on something combat damage causes (such as a unit being destroyed), triggers when that event happens, during the combat damage step, and its trigger condition is checked then. It is put on the stack later, as rules 608.9b and 608.9c describe, and only then are its targets chosen. See rules 706, 703.

> *Example (non-normative): A combat-damage trigger is announced inside the damage step and pushed to the stack after it.* <sub>test: 239-damage-triggers-after-combat.test.ts::R261: a combat-damage trigger is announced INSIDE the damage step</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1540678747953569832#0 · Rulings: R261 (its announce-then-hold mechanism), R300 · Replaces: R31 (said such triggers resolve immediately inside the damage step; superseded by R261 and R295) · Tests: 239-damage-triggers-after-combat.test.ts · Key: combat.damage.triggers</sub>

<a id="r608.9a"></a>**608.9a** An ability that triggers 'when my column deals combat damage' triggers in each sub-step in which its own column deals combat damage, and only for damage its own column dealt; another column's damage does not trigger it. A 0-power unit with such an ability triggers if its column's combined power is greater than 0. See rule 706.

> *Example (non-normative): A Swift and Sluggish column with Vroot strikes twice, and Vroot's ability triggers twice.* <sub>test: 134-column-and-substep.test.ts::R157 §5 — a {Swift}{Sluggish} column strikes twice</sub>

> *Example (non-normative): Vroot's 'that much' is its own column's damage, not the total dealt to the player by every column.* <sub>test: 166-face-damage-attribution.test.ts::R195 — Vroot: "[Augment] When my column deals combat damage, each opponent gains that much life"</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R117 (its own-column gate), R157 (§4), R157 (§5, its both-sub-steps answer), R195 (its per-column attribution) · Replaces: R117 ('otherwise the normal one' was corrected by R157 §5 (a Swift+Sluggish column fires in both); its claim that the trigger resolves inside its sub-step was superseded by R261) · Tests: 134-column-and-substep.test.ts, 166-face-damage-attribution.test.ts · Key: combat.damage.triggers.my-column</sub>

<sub>Discrepancies: D-U12-14 (discrepancies.md)</sub>

<a id="r608.9b"></a>**608.9b** In an unsplit step, every ability that triggered during the combat damage step is put on the stack in the after combat step, together with the abilities that trigger at the start of the after combat step, as one batch. The initiative player puts all of theirs on the stack first, in the order they choose, and then the other player puts theirs; each player may interleave the two kinds in any order. All players may respond to them. See rules 609, 706.

> *Example (non-normative): One player's combat-damage trigger and after-combat trigger are ordered together, in one decision.* <sub>test: 239-damage-triggers-after-combat.test.ts::R261 THE RAQ BATCH</sub>

> *Example (non-normative): The initiative player's triggers go on the stack first and sit at the bottom.* <sub>test: 239-damage-triggers-after-combat.test.ts::R261 RAQ STACK ORDER</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1540678747953569832#0; RAQ 1540678747953569832#1 · Rulings: R261 (its unsplit hold), R295 · Tests: 239-damage-triggers-after-combat.test.ts, 423-cr-combat-damage.test.ts · Key: combat.damage.triggers.unsplit</sub>

<a id="r608.9c"></a>**608.9c** In a split step, the abilities that triggered during a sub-step other than the last scheduled one are put on the stack, in the same order as in rule 608.9b, at the window after that sub-step, and resolve before the next sub-step deals damage (rule 608.3b). The abilities that trigger during the last sub-step in which damage is dealt join the after combat batch as in rule 608.9b. See rules 609, 706.

> *Example (non-normative): In a split step, a death trigger from the Swift sub-step resolves at the window before the normal sub-step, not after combat.* <sub>test: 239-damage-triggers-after-combat.test.ts::R295: in a SPLIT damage step a death trigger resolves at the boundary</sub>

> *Example (non-normative): With Sluggish last, a death in the Sluggish sub-step joins the after combat batch.* <sub>test: 408-raq-new-threads.test.ts::RAQ Combat Damage & After Combat: with Sluggish last</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1540678747953569832#2; RAQ 1540678747953569832#3 · Rulings: R295 · Tests: 239-damage-triggers-after-combat.test.ts, 408-raq-new-threads.test.ts · Key: combat.damage.triggers.split</sub>

<a id="r608.9d"></a>**608.9d** Abilities that trigger during the combat damage step trigger during battle, so an effect that makes abilities cost more to trigger during battle applies to them. See rules 111, 706.

> *Example (non-normative): Crevice Lurker taxes a combat-damage trigger; on the same board without the Lurker there is no tax.* <sub>test: 239-damage-triggers-after-combat.test.ts::R121 WIDENED BY R261</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Crevice Lurker · Rulings: R261 (its widening of the battle tax) · Tests: 239-damage-triggers-after-combat.test.ts · Key: combat.damage.triggers.tax</sub>

<a id="r608.9e"></a>**608.9e** An ability that works only while its card is in the bin can trigger on combat damage only if the card is already in the bin when that damage is dealt. A unit destroyed by combat damage is not in the bin while that same damage is dealt, but a unit destroyed in an earlier sub-step is. See rules 405, 706.

> *Example (non-normative): Cinder Scuttler is destroyed in the same sub-step in which another of its controller's columns deals combat damage to the opponent. It does not return.* <sub>test: 310-zone-abilities.test.ts::§3 Cinder Scuttler does NOT recall off the damage step it died in</sub>

> *Example (non-normative): A Swift unit destroys Cinder Scuttler in the Swift sub-step; in the normal sub-step its controller deals combat damage to the opponent, and it returns.* <sub>test: 310-zone-abilities.test.ts::§4 but a Swift unit bins it BEFORE the normal step</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: card: Cinder Scuttler · Rulings: R300, R300 · Tests: 310-zone-abilities.test.ts · Key: combat.damage.triggers.bin-cards</sub>

<a id="r609"></a>
### 609. After Combat

*No rules drafted yet.*

<a id="r610"></a>
### 610. Counterattacks and Later Battle Rounds

*No rules drafted yet.*

## 7. Spells, Abilities and Effects

<a id="r700"></a>
### 700. General

<a id="r700.1"></a>**700.1.** An effect is anything on the stack. Whenever a card is played, or an ability is activated or triggered, it is added to the stack as an effect. A unit or spell unit on the stack is an effect too. See rule 703.

> *Example (non-normative): a {Battle} unit being played sits on the stack and can be chosen by an effect that says "target effect" (Dematerialize).* <sub>test: 118-stack-effect.test.ts::R128: a unit on the stack is a legal "target effect" (Dematerialize)</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.28; Manual p.28 · Rulings: R128 · Replaces: R60 (its sentence that a unit on the stack is not an effect was reversed by R128) · Tests: 118-stack-effect.test.ts · Key: effects.general.effect</sub>

<a id="r700.1a"></a>**700.1a** A spell effect is an effect that is a spell: a spell, a spell unit or a spell token on the stack, or an ambush. A unit on the stack is an effect but not a spell effect, so a card that says "spell effect" cannot affect it.

> *Example (non-normative): Null Drone ("target spell effect") cannot choose a plain unit on the stack, but can choose a spell unit.* <sub>test: 118-stack-effect.test.ts::"target spell effect" refuses a plain unit but takes a spell unit</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R128, R128 · Tests: 118-stack-effect.test.ts · Key: effects.general.effect.spell-effect</sub>

<a id="r700.1b"></a>**700.1b** A nonspell effect is any effect that is not a spell effect: a triggered ability, an activated ability, a Virus being applied, or a unit on the stack.

> *Example (non-normative): Nothyr ("negate up to one target nonspell effect") can choose a {Battle} unit on the stack.* <sub>test: 118-stack-effect.test.ts::Nothyr's "target nonspell effect" reaches a unit on the stack</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R128 · Tests: 118-stack-effect.test.ts · Key: effects.general.effect.nonspell-effect</sub>

<a id="r700.2"></a>**700.2.** Casting a spell is playing it. The printed rules use "cast" and "play" for the same act, and casting a spell token is playing a spell. See rule 701.

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Rulebook 2023 p.13; Manual p.30 · Rulings: R305, R263 · Replaces: R59 (its carve-out that a spell token is cast from play rather than played was amended by R305) · Key: effects.general.cast-is-play</sub>

<a id="r700.3"></a>**700.3.** Players interact by playing cards and activating abilities in response to one another. All interaction uses the stack (rule 703). See rule 703.

> *Example (non-normative): in a battle, a spell, a {Battle} unit, a Virus and an activated ability are each put on the stack as they are played or activated.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.general.interaction — a spell, a battle unit, a virus and an activated ability played in battle all go on the stack</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.14 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.general.interaction</sub>

<a id="r701"></a>
### 701. Playing and Applying

<a id="r701.1"></a>**701.1.** Only units and spells are played, whatever zone they are played from. Applying a modification is not playing a card (701.2).

> *Example (non-normative): Godray and Monke played from hand, and Trench Stalker played from the bin, are plays; a Virus applied to the attacker is not.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.playing.what-is-played — a unit and a spell played from hand and a unit played from the bin are plays; a virus applied is not</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Designer: RAQ 1537748882501668934#0 · Rulings: R37 · Tests: 105-semantics-playwatch.test.ts, 119-play-and-token-events.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.playing.what-is-played</sub>

<a id="r701.1a"></a>**701.1a** Playing a spell unit is playing a spell.

> *Example (non-normative): a spell unit played through Hooba-Pon counts as a spell played.* <sub>test: 396-raq-timing.test.ts::RAQ Hooba-Pon spell unit: it counts as playing a spell</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1461450216874967235#2 · Tests: 396-raq-timing.test.ts · Key: effects.playing.what-is-played.spell-unit</sub>

<a id="r701.1b"></a>**701.1b** Casting a spell token is playing a spell. A spell token is never in a hand; it is cast from play, so it is played from somewhere other than the hand. See rule 702.7.

> *Example (non-normative): casting a Fireball token triggers Stalwart Sentinel ("when you play a card from anywhere other than your hand").* <sub>test: 408-raq-new-threads.test.ts::casting a Fireball token triggers Stalwart Sentinel</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1355689559609839787#2 · Rulings: R342, R305 · Replaces: R59 (its carve-out "a spell token is cast from play, not played" was amended by R305) · Tests: 408-raq-new-threads.test.ts, 337-spell-tokens-are-played.test.ts · Key: effects.playing.what-is-played.spell-token</sub>

<a id="r701.1c"></a>**701.1c** A token is not a card. An ability or cost modifier that refers to a "card" being played does not apply to a spell token being cast; one that refers to a "spell" does; one that refers to a "nontoken spell" does not. See rule 108.

> *Example (non-normative): Arbiter of Armistice ("Cards played during battle gain [Pay 2 life]") does not make a spell token cost life.* <sub>test: 337-spell-tokens-are-played.test.ts::R305: Arbiter of Armistice prints Cards, so a token cast pays no life</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R305, R305, R305 · Tests: 337-spell-tokens-are-played.test.ts · Key: effects.playing.what-is-played.token-not-card</sub>

<sub>Discrepancies: D-U14-7 (discrepancies.md)</sub>

<a id="r701.1d"></a>**701.1d** Creating a token is not playing it. See rule 304.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R26 · Tests: 119-play-and-token-events.test.ts · Key: effects.playing.what-is-played.token-creation</sub>

<a id="r701.1e"></a>**701.1e** An ability that triggers whenever its controller plays a unit, and that does not say "another", triggers when its own card is played. See rule 706. *(Engine differs, see F-U14-5.) (Untested: no executed test demonstrates it.)*

> *Example (non-normative): Bloomcaster is played from hand; its "Whenever you play a unit" sees its own play and makes a 1/1 (illustrative; the engine makes none, see F-U14-5).*

<sub>Basis: Owner call · Verified: confirmed, round 2, 0 tests run · Rulings: R26 · Key: effects.playing.what-is-played.includes-itself</sub>

<sub>Discrepancies: D-U14-11 (discrepancies.md)</sub>

<a id="r701.2"></a>**701.2.** Applying a modification (an augment, a graft, or a Virus) is not playing a card. A modification is applied, whether it comes from a hand, a bin, a cache or elsewhere. Applying a modification is a special action. See rule 720.

> *Example (non-normative): a graft applied from hand and a Virus applied from the cache are not plays.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.playing.applying — a graft from hand and a virus from the cache are applied, never played</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.32 · Designer: RAQ 1537748882501668934#0 · Rulings: R37 · Tests: 105-semantics-playwatch.test.ts, 119-play-and-token-events.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.playing.applying</sub>

<a id="r701.2a"></a>**701.2a** An ability that triggers when a player plays a unit, a spell or a card does not trigger when a modification is applied, including one applied from the bin.

> *Example (non-normative): Ravenous Fireslinger does not trigger when its controller applies an augment, and does trigger on a real spell.* <sub>test: 105-semantics-playwatch.test.ts::Ravenous Fireslinger: R37</sub>

> *Example (non-normative): a Virus applied during battle fires no play event, and Void Mandible does not react to it.* <sub>test: 119-play-and-token-events.test.ts::R37 holds: applying a VIRUS fires neither event</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1537748882501668934#0 · Rulings: R37 · Tests: 105-semantics-playwatch.test.ts, 119-play-and-token-events.test.ts · Key: effects.playing.applying.no-play-triggers</sub>

<a id="r701.2b"></a>**701.2b** A modifier to the cost of playing cards does not change the cost of applying a modification. A modification still needs its own affinity and its own mana cost to be applied. See rule 111.

> *Example (non-normative): a Virus applied in battle needs its affinity and pays its cost.* <sub>test: 408-raq-new-threads.test.ts::RAQ Mods are NOT Played: a Virus in battle needs its affinity and pays its cost</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.32 · Rulings: R59 (its play-versus-apply half), R60 (its life-tax half) · Tests: 408-raq-new-threads.test.ts · Key: effects.playing.applying.cost</sub>

<a id="r701.2c"></a>**701.2c** Tides of the Cosmos is the one exception. Although it says "play", it may put a Virus card onto a unit as a Virus, and it may play a card as an Ambush or a Prophecy. It cannot graft a card or apply a non-Virus augment.

> *Example (non-normative): a Virus card that Tides of the Cosmos plays as a Virus is attached to a unit and never enters play.* <sub>test: 404-raq-fix-tides.test.ts::R337: a Virus card played by Tides as a Virus augments a unit and never enters play</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 3 tests run · Designer: RAQ 1537748882501668934#2; RAQ 1396955380000755795#2; RAQ 1396955380000755795#3; RAQ 1357483405276614856#1 · Rulings: R337 · Tests: 404-raq-fix-tides.test.ts, 396-raq-timing.test.ts · Key: effects.playing.applying.tides</sub>

<a id="r701.3"></a>**701.3.** Putting a card into play is not playing it. Whether an effect plays a card or puts it into play is decided by the verb the effect prints.

> *Example (non-normative): Covenant of the Damned puts a unit from the bin into play; only Covenant itself was played.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.playing.put-into-play — a unit put into play by Covenant of the Damned is not played</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.43 · Rulings: R165 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.playing.put-into-play</sub>

<a id="r701.3a"></a>**701.3a** A spell unit that enters play without being played (for example, one put into play from a bin) does not produce its spell effect.

> *Example (non-normative): Covenant of the Damned puts Lonely Forager into play from the bin; Forager does not draw a card.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.playing.put-into-play.spell-unit — Lonely Forager put into play from the bin by Covenant of the Damned draws no card</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.43; Manual p.43 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.playing.put-into-play.spell-unit</sub>

<a id="r701.4"></a>**701.4.** A card played during the resolution of another effect is played. During battle it is put on the stack and can be responded to (rule 703.5), and abilities that trigger on a play see it. See rule 703.5. *(Engine differs, see F-U14-3.)*

> *Example (non-normative): Bloomcaster hears a unit that Tides of the Cosmos plays.* <sub>test: 396-raq-timing.test.ts::RAQ Tides 7: a free play is a play</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1396955380000755795#8 · Rulings: R198 · Tests: 169-mid-resolution-window.test.ts, 396-raq-timing.test.ts · Key: effects.playing.mid-resolution</sub>

<a id="r701.4a"></a>**701.4a** A card played by an effect is played from the zone it came out of. If it came out of a hand, it is played from the hand. If it came out of the cache, a bin, the deck or anywhere else, it is not played from the hand.

> *Example (non-normative): Tides of the Cosmos plays a card off the top of the deck, so Proph and Stalwart Sentinel see a play from somewhere other than the hand.* <sub>test: 241-played-from-zone.test.ts::R263 §5: Tides of the Cosmos plays off the top of the deck</sub>

> *Example (non-normative): Hooba-Pon plays a unit from its controller's hand, so neither watcher fires.* <sub>test: 241-played-from-zone.test.ts::R263 §3: Hooba-Pon plays from the hand</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R263, R263 · Tests: 241-played-from-zone.test.ts · Key: effects.playing.mid-resolution.zone</sub>

<a id="r701.5"></a>**701.5.** A copy of a spell is not played. It does not trigger abilities that trigger on playing, and it is not counted as a played spell. See rule 710.

> *Example (non-normative): Earthbound Replicator does not copy its own copy.* <sub>test: 138-spell-copy.test.ts::a copy is not PLAYED, so it fires no play event</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1355613076506017894#1 · Rulings: R164 · Tests: 138-spell-copy.test.ts · Key: effects.playing.copy-not-played</sub>

<a id="r702"></a>
### 702. Casting Spells

<a id="r702.1"></a>**702.1.** To play a card, a player must meet its affinity requirement, pay its mana cost, select its targets as it is played, and resolve whatever is inside its brackets (an additional cost to pay or a mode to choose). See rules 105, 110, 111.

> *Example (non-normative): Arc Lightning (rr, cost 4) cannot be played with four water resources (no affinity) or with only two fire resources (not enough mana); with two fire and two water it can.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.requirements — Arc Lightning is not playable without its affinity, nor without its mana, and is with both</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.13; Manual p.13; Manual p.13 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.requirements</sub>

<a id="r702.1a"></a>**702.1a** A player must meet a card's affinity requirement to be able to play it, unless an effect lets it be played ignoring affinity. See rule 105.

> *Example (non-normative): Tides of the Cosmos plays a fire unit for a player who has only water resources.* <sub>test: 396-raq-timing.test.ts::RAQ Tides 1: a free play ignores affinity</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.13 · Designer: RAQ 1396955380000755795#0 · Tests: 396-raq-timing.test.ts · Key: effects.casting.requirements.affinity</sub>

<a id="r702.1b"></a>**702.1b** To pay a card's mana cost, the player expends a number of unexpended resources equal to that cost. See rule 106.

> *Example (non-normative): playing Arc Lightning, cost 4, expends four of the player’s unexpended resources.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.requirements.mana — playing Arc Lightning (cost 4) expends four unexpended resources</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.13 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.requirements.mana</sub>

<a id="r702.1c"></a>**702.1c** A card can be played only when its timing allows (rule 207). A card with no timing icon can be played only during deployment. See rules 207, 504.

> *Example (non-normative): Lonely Forager has no timing icon: it is offered in deployment and refused in battle.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.requirements.timing — a card with no timing icon is playable in deployment and not in battle</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.requirements.timing</sub>

<a id="r702.2"></a>**702.2.** A card in the cache under a live permission may be played in every way it could be played from the hand. It is still not in the hand. See rule 403.

> *Example (non-normative): a glimpsed Virus in the cache can be applied onto an enemy unit in battle.* <sub>test: 370-cached-virus-in-battle.test.ts::R311: a glimpsed Virus in the cache goes onto an ENEMY unit in battle</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R311 · Tests: 369-cache-is-the-hand.test.ts, 370-cached-virus-in-battle.test.ts · Key: effects.casting.other-zones</sub>

<a id="r702.2a"></a>**702.2a** A card played from the cache or a bin under a permission still obeys its own printed timing; the permission itself never waives timing. Apart from the timing grants that also work from the cache (rule effects.casting.other-zones.cache-widening), only an effect that says the card may be played now, such as Tides of the Cosmos, lets it ignore its timing. See rules 207, 405.

> *Example (non-normative): Tides of the Cosmos plays a deploy-timing unit in battle.* <sub>test: 396-raq-timing.test.ts::RAQ Tides 2: a free play ignores timing</sub>

<sub>Basis: Mixed · Verified: confirmed, round 3, 1 test run · Designer: RAQ 1396955380000755795#1 · Rulings: R157 (its §12), R311 · Tests: 396-raq-timing.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.casting.other-zones.timing</sub>

<a id="r702.2b"></a>**702.2b** A card that says it can't be played from your hand is restricted from that zone only. It may still be played from another zone that allows it.

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: card: Calming Force · Rulings: R100 · Tests: 40-light-c.test.ts · Key: effects.casting.other-zones.hand-restriction</sub>

<a id="r702.2c"></a>**702.2c** Permission to play a card "as if it had [Haste]" does not let a {Battle} card be played outside battle. See rule 504.

> *Example (non-normative): Dispatch Courier cannot let a {Battle} spell unit be played in the haste step.* <sub>test: 396-raq-timing.test.ts::RAQ Dispatch Courier: a Battle spell unit is not playable in the haste step either</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1465292396664193171#0 · Rulings: R97 · Tests: 396-raq-timing.test.ts · Key: effects.casting.other-zones.haste-grant</sub>

<a id="r702.2d"></a>**702.2d** The rules that widen a card's timing when it is played from hand also widen it when it is played from the cache: a haste grant such as Dispatch Courier's, the erase-funded haste play of Writhing Host, Ambush, and the battle {Virus} augment window. See rules 504, 702.2c.

> *Example (non-normative): a glimpsed {Virus} card in the cache can be augmented onto a unit in a battle window, as it could from hand.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.other-zones.cache-widening — a glimpsed Virus in the cache augments onto a unit in a battle window</sub>

<sub>Basis: Owner call · Verified: partial, round 3, 2 tests run · Rulings: R311, R97 · Tests: 369-cache-is-the-hand.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.casting.other-zones.cache-widening</sub>

<sub>Discrepancies: D-U14-12 (discrepancies.md)</sub>

<a id="r702.3"></a>**702.3.** Playing a card follows the steps below, in order. Everything the play needs is declared and paid before the card is put on the stack, so no player can respond to an undeclared or unpaid play.

> *Example (non-normative): while Sacrificial Burst’s target and sacrifice are being chosen, nothing is on the stack and the opponent has no action; it reaches the stack only once both are done.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.procedure — while Sacrificial Burst is being declared and paid it is not on the stack and the opponent cannot act</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Designer: RAQ 1355115946032889914#12 · Rulings: R198, R178 (its §3, as-you-play) · Replaces: R57 (its order "X → {Modular} mods → targets → costs" stands for fixed costs; R64 moved variable costs up beside X) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.procedure</sub>

<a id="r702.3a"></a>**702.3a** Step 1: if the card has an X, the player chooses X. A variable additional cost (one whose amount is X) is paid at this step, and the amount paid is X. The card's mana cost is paid at the start of the play. See rule 107.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R64 (its cost half), R57 (its fixed-cost order) · Key: effects.casting.procedure.x</sub>

<a id="r702.3b"></a>**702.3b** Step 2: the player chooses any {Modular} modifications for the card. See rule 724.

> *Example (non-normative): Spellbind asks for its {Modular} mods as it is played; the chosen mod is on the stack item with it.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.procedure.modular — Spellbind asks for its Modular mods as it is played, and the chosen mod rides onto the stack with it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R57 (its fixed-cost order) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.procedure.modular</sub>

<a id="r702.3c"></a>**702.3c** Step 3: the player declares every target the card's text names (rule 110). See rule 110.

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.13 · Rulings: R67 · Tests: 68-target-conformance.test.ts · Key: effects.casting.procedure.targets</sub>

<a id="r702.3d"></a>**702.3d** Step 4: if a bracket in the card's text offers a choice of modes, the owner of the effect chooses one. See rule 702.5.

> *Example (non-normative): Wither and Bloom declares which half it is before anyone may respond.* <sub>test: 97-mode-conformance.test.ts::R57: Wither and Bloom declares which half before anyone may respond</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R284 · Tests: 97-mode-conformance.test.ts · Key: effects.casting.procedure.modes</sub>

<a id="r702.3e"></a>**702.3e** Step 5: a card that may be played into a formation has its place in the formation chosen. See rule 602.

> *Example (non-normative): Tiderunner Initiate’s place in the formation is chosen as it is played, before it is on the stack.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.procedure.spot — Tiderunner Initiate has its formation spot chosen as it is played, and the spot rides on the stack</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R29 (its cast-time spot half) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.procedure.spot</sub>

<a id="r702.3f"></a>**702.3f** Step 6: the player pays the card's fixed additional costs, after everything else has been declared. See rule 111.

> *Example (non-normative): Sacrificial Burst asks for its target before its sacrifice; Trench Stalker asks for its formation spot before its two discards.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.procedure.fixed-costs — Sacrificial Burst asks for its target before its sacrifice, and Trench Stalker for its spot before its discards</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R64 (its cost half), R338 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.procedure.fixed-costs</sub>

<a id="r702.3g"></a>**702.3g** Step 7: options that a card offers "as you play" a spell (Maelstrom Charger) are taken. Such an option is not an effect: it never goes on the stack and cannot be responded to. See rule 710.

> *Example (non-normative): the Maelstrom Charger option is asked while the spell is played and never reaches the stack.* <sub>test: 151-copy-and-moved-mods.test.ts::R178 Maelstrom Charger: the option is asked in the cast window and never reaches the stack</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1379132904931594372#0 · Rulings: R178 (its §3, as-you-play) · Tests: 151-copy-and-moved-mods.test.ts · Key: effects.casting.procedure.as-you-play</sub>

<a id="r702.3h"></a>**702.3h** Step 8: the card is put on the stack as an effect (rule 703). See rule 703.

> *Example (non-normative): once Arc Lightning has been declared and paid, it is on the stack as a spell effect controlled by its player, and no longer in hand.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.procedure.stack — once declared and paid, Arc Lightning is on the stack as a spell effect, out of the hand</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.28; Manual p.28 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.procedure.stack</sub>

<a id="r702.4"></a>**702.4.** Every cost of playing a card is paid before the card is put on the stack. No player can respond to the payment, or between a cost and the effect it pays for. See rule 111.

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1355115946032889914#12 · Rulings: R67 · Key: effects.casting.costs</sub>

<a id="r702.4a"></a>**702.4a** A card whose costs cannot all be paid cannot be played.

> *Example (non-normative): with nothing to sacrifice, Tides of the Cosmos does not offer Volatile Toxicity.* <sub>test: 404-raq-fix-tides.test.ts::R338: with nothing to sacrifice, Tides does not offer Volatile Toxicity</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R35 (its spell-cost half), R49 (its cost-gating half) · Tests: 404-raq-fix-tides.test.ts · Key: effects.casting.costs.unpayable</sub>

<a id="r702.4b"></a>**702.4b** Negating a card does not refund the costs paid to play it. See rule 704.4.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R35 (its spell-cost half) · Key: effects.casting.costs.no-refund</sub>

<a id="r702.4c"></a>**702.4c** A unit sacrificed to pay a cost is gone before the card is played, so it does not see that card being played.

> *Example (non-normative): Ravenous Fireslinger sacrificed to pay for Sacrificial Burst does not trigger on it.* <sub>test: 390-raq-stack.test.ts::RAQ cost vs trigger: a unit sacrificed to pay a spell cost never sees that spell played</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1460212274936414381#0 · Tests: 390-raq-stack.test.ts · Key: effects.casting.costs.sacrifice-gone</sub>

<a id="r702.4d"></a>**702.4d** A cost cannot be paid with something that does not exist yet: not with units the effect itself would create, and not with a unit played by the same effect, which is on the stack and not in play.

> *Example (non-normative): Volatile Toxicity played by Tides of the Cosmos cannot sacrifice a Towering Colossus played by the same Tides.* <sub>test: 396-raq-timing.test.ts::RAQ Tides 5:</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1355115946032889914#12 · Rulings: R338 · Tests: 396-raq-timing.test.ts · Key: effects.casting.costs.not-yet-in-play</sub>

<a id="r702.4e"></a>**702.4e** A card played during another effect's resolution pays its bracketed additional cost exactly as if it were played from a hand.

> *Example (non-normative): a Trench Stalker played through Hooba-Pon discards two cards.* <sub>test: 404-raq-fix-tides.test.ts::R338: a unit played by Hooba-Pon pays its additional cost</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R338 · Tests: 404-raq-fix-tides.test.ts · Key: effects.casting.costs.mid-resolution</sub>

<a id="r702.5"></a>**702.5.** A printed square bracket in a card's text is either an additional cost or a choice of modes. The owner of the effect pays that cost or chooses that mode, when the effect is played or put on the stack, and at no other time. See rules 205, 111.

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.13 · Rulings: R284, R284 · Key: effects.casting.brackets</sub>

<a id="r702.5a"></a>**702.5a** A payment an effect's text asks for without brackets, such as "unless its controller pays [x]", is not a cost of playing. It is made while the effect resolves, by the player the text names (rule 704.1). See rule 704.1.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R284, R6 · Key: effects.casting.brackets.unbracketed-payment</sub>

<a id="r702.6"></a>**702.6.** X is chosen when the card is played, before it is put on the stack. Only values the player can pay may be chosen, and responses see the X already fixed. See rule 107.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R35 (its spell-cost half) · Key: effects.casting.x</sub>

<a id="r702.6a"></a>**702.6a** If a card says X can't be zero, X must be at least 1. A player with less open mana than the smallest legal X cannot play the card.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R35 (its spell-cost half) · Key: effects.casting.x.minimum</sub>

<a id="r702.6b"></a>**702.6b** A variable additional cost sets X. The player pays it one unit at a time until they stop, and the amount paid is X.

> *Example (non-normative): Discharge ("[Remove X +1/+1 counters from allies]: I deal X damage to target unit") deals as much damage as the counters removed (illustrative).*

> *Example (non-normative): a player removes two +1/+1 counters for Discharge, one at a time, then stops; X is 2 and Discharge deals 2 damage.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.x.variable-cost — Discharge with two counters removed one at a time has X = 2 and deals 2</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R64 (its cost half) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.x.variable-cost</sub>

<a id="r702.6c"></a>**702.6c** An X spell released for free by a fulfilled prophecy is cast with X = 0. A variable bracketed cost on it is still collected. See rule 803.

> *Example (non-normative): a fulfilled prophecy releases an X spell; no X is asked, X is 0 and no mana is paid.* <sub>test: 36-cache-prophecy.test.ts::R111: a fulfilled prophecy releases an X spell for X = 0</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R111, R111 · Tests: 36-cache-prophecy.test.ts · Key: effects.casting.x.free</sub>

<a id="r702.7"></a>**702.7.** A spell token is cast from play, and only in the region the token is in. Otherwise it is cast the same way as a spell from the hand. See rule 304.

> *Example (non-normative): a Fireball in the battle region is cast with a target and goes on the stack like a spell from hand; a Fireball in another region cannot be cast.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.spell-tokens — casting a spell token asks for its target and puts it on the stack, as a spell from hand would</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.4; Rulebook 2023 p.4 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.spell-tokens</sub>

<a id="r702.7a"></a>**702.7a** A modifier to the cost of playing spells applies to casting a spell token, and a spell token cast counts as a spell played. See rule 111.

> *Example (non-normative): Tranquility makes a spell token cost [1] more in battle.* <sub>test: 337-spell-tokens-are-played.test.ts::R305: Tranquility taxes a spell token [1] in battle</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R305 · Replaces: R59 (its carve-out that a token is not played was amended by R305) · Tests: 337-spell-tokens-are-played.test.ts · Key: effects.casting.spell-tokens.taxed</sub>

<a id="r702.7b"></a>**702.7b** A spell token with Burst is cast together with all of its controller's spell tokens of the same name in the same region as it. They are still separate spells. See rules 803, 703.4.

> *Example (non-normative): a player with two Fireballs in the battle region casts one; both go on the stack. A Fireball the same player has in another region is not cast (illustrative).* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.casting.spell-tokens.burst — both battle-region Fireballs are cast together and one in another region is not</sub>

<sub>Basis: Printed · Verified: confirmed, round 2, 2 tests run · Printed: Rulebook 2023 p.4; Rulebook 2023 p.4; Rulebook 2023 p.4 · Rulings: R309 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.casting.spell-tokens.burst</sub>

<a id="r702.8"></a>**702.8.** A card or ability that needs targets can be played only if every target it requires can be chosen at the same time, each one legal and different from the others. See rule 110.

> *Example (non-normative): Fight cannot be played unless the region holds an ally and another unit.* <sub>test: 390-raq-stack.test.ts::RAQ target requirements: Fight cannot be played without an ally and another unit in the region</sub>

> *Example (non-normative): Tidal Reversion cannot be played while one player has no unit to recall.* <sub>test: 390-raq-stack.test.ts::RAQ target requirements: Tidal Reversion is not playable while one player has no unit to recall</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 3 tests run · Designer: RAQ 1410252965276684418#0; RAQ 1410252965276684418#1; RAQ 1410252965276684418#3 · Rulings: R323 · Tests: 390-raq-stack.test.ts, 401-raq-fix-stack.test.ts · Key: effects.casting.targets-required</sub>

<a id="r702.8a"></a>**702.8a** A card that targets nothing has no target requirement.

> *Example (non-normative): Rebalance can be played by a player with no unit.* <sub>test: 396-raq-timing.test.ts::Rebalance is playable with no unit of your own</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1454169054402314362#1 · Tests: 396-raq-timing.test.ts · Key: effects.casting.targets-required.untargeted</sub>

<a id="r702.8b"></a>**702.8b** A triggered graft composite whose targeted part has no legal target is not put on the stack at all, and its untargeted parts do not happen either. See rules 722, 706. *(Engine differs, see F-U14-1.)*

> *Example (non-normative): Megadeath grafted with Resurrect, and no unit of cost 2 or less in the bin: no Poison 5 is made.* <sub>test: 390-raq-stack.test.ts::RAQ target requirements: a graft trigger with a required target and none available makes nothing at all</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1410252965276684418#2 · Tests: 390-raq-stack.test.ts · Key: effects.casting.targets-required.graft-trigger</sub>

<sub>Discrepancies: D-U14-3 (discrepancies.md)</sub>

<a id="r703"></a>
### 703. The Stack and Priority

<a id="r703.1"></a>**703.1.** The stack is "first in, last out". A new effect is put on top of the effects already there. When it is time to resolve, the top effect resolves first, so the effect put on last resolves first.

> *Example (non-normative): Mycelial Mentor is played with Bloomcaster out. Bloomcaster's trigger goes on the stack above the Mentor, so its 1/1 is made before the Mentor arrives and the Mentor never sees it.* <sub>test: 396-raq-timing.test.ts::RAQ Bloomcaster: its 1/1 resolves before the Mycelial Mentor it was played with arrives</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Rulebook 2023 p.14; Rulebook 2023 p.14 · Tests: 396-raq-timing.test.ts · Key: effects.priority.stack</sub>

<sub>Discrepancies: D-U14-9 (discrepancies.md)</sub>

<a id="r703.1a"></a>**703.1a** An effect put on the stack does not resolve immediately. This gives the other players in the region a chance to respond to it.

> *Example (non-normative): Luminous Arc is cast at a unit; the unit is undamaged while the Arc waits on the stack, and the other player may respond.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.stack.not-immediate — a cast Luminous Arc waits on the stack, its target untouched, while the other player may respond</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.28; Manual p.28 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.stack.not-immediate</sub>

<a id="r703.1b"></a>**703.1b** New effects can be added on top of the stack after it has started resolving, between the resolutions of the effects on it.

> *Example (non-normative): two Luminous Arcs are on the stack; after the top one resolves, a third Arc is cast and resolves before the one still waiting.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.stack.add-while-resolving — after the top of a two-item stack resolves, a new spell goes on above the remaining item and resolves first</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.14; Manual p.28 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.stack.add-while-resolving</sub>

<a id="r703.1c"></a>**703.1c** A triggered ability put on the stack can be responded to like any other effect. See rule 706.

> *Example (non-normative): Xenopod Progenitor's trigger is negated on the stack, and its controller is never asked to pay its [1].* <sub>test: 390-raq-stack.test.ts::RAQ Xenopod: negated on the stack, it never asks for the [1]</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: Manual p.28 · Designer: RAQ 1397189214352703590#1 · Rulings: R250 (the owner's §3 statement that all triggers are respondable) · Replaces: R250 (its §3 conclusion that combat-damage triggers are not respondable was reversed by R261; its deployment half was amended by R286) · Tests: 229-cosmic-and-control.test.ts, 390-raq-stack.test.ts · Key: effects.priority.stack.triggers-respondable</sub>

<a id="r703.2"></a>**703.2.** Priority is the ability to take game actions such as playing cards or activating abilities. A player with priority can take such actions; a player without priority cannot.

> *Example (non-normative): in the attack window only the initiative player, who holds priority, is offered a card; the other player’s play is refused.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.priority — only the player with priority may play a card</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.priority</sub>

<a id="r703.2a"></a>**703.2a** A player who uses priority to take an action may keep priority and take further actions. Each action goes on the stack as an effect; none of them happens immediately. *(Engine differs, see F-U14-2.) (Untested: no executed test demonstrates it.)*

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30 · Key: effects.priority.priority.hold</sub>

<a id="r703.2b"></a>**703.2b** When a player passes priority after taking one or more actions, each other player receives priority, so that they can respond. This continues until all players pass priority in succession.

> *Example (non-normative): after a cast the other player receives priority and responds; the first player then receives priority again, and the top item resolves only after both pass in succession.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.priority.pass — after an action the other player receives priority, and the item resolves only once both pass in succession</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.priority.pass</sub>

<a id="r703.2c"></a>**703.2c** A player cannot respond to another player passing priority. A player who passes may not get another chance to act.

> *Example (non-normative): the defender passes on an Arc and the attacker passes; the Arc resolves at once, with no further chance for the defender.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.priority.no-response-to-pass — after one player passes, the other passing resolves the item with no further chance for the first</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Rulebook 2023 p.13 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.priority.no-response-to-pass</sub>

<a id="r703.2d"></a>**703.2d** All players on a team share priority and can act in whichever order they choose among themselves. Teams pass and receive priority as one. See rule 904. *(Untested: no executed test demonstrates it.)*

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30 · Key: effects.priority.priority.teams</sub>

<a id="r703.3"></a>**703.3.** A priority window is a sequence in which the players (or teams) each receive priority in order.

> *Example (non-normative): in an empty attack window the initiative player receives priority, then the other player; when both have passed the step ends.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.window — in an empty attack window each player receives priority in turn, initiative first, and then the step moves on</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.window</sub>

<a id="r703.3a"></a>**703.3a** In a priority window the initiative player receives priority first. If they decline to act, priority passes clockwise to the next non-initiative player in the region. If the initiative player is not in the region, priority begins with the player nearest to the initiative player, clockwise. See rules 508, 903.

> *Example (non-normative): the defender casts a spell, which resolves; the new window opens with the initiative player, not the caster.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.window.order — a new window opens with the initiative player even when the other player cast the item that just resolved</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30; Manual p.30 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.window.order</sub>

<sub>Discrepancies: D-U14-8 (discrepancies.md)</sub>

<a id="r703.3b"></a>**703.3b** In each region, the attack step, the block step and the after combat step each have a priority window. The combat damage step has a priority window only between its sub-steps, and only when Swift or Sluggish units split it (rule 608). See rules 604, 605, 607, 608, 609.

<sub>Basis: Mixed · Verified: confirmed, round 1, 2 tests run · Printed: Manual p.30 · Designer: RAQ 1363298910528864318#0 · Tests: 297-damage-substeps-are-steps.test.ts · Key: effects.priority.window.steps</sub>

<sub>Discrepancies: D-U14-1 (discrepancies.md)</sub>

<a id="r703.3c"></a>**703.3c** When all players pass priority in succession with an effect on the stack, the top effect resolves. All players then receive priority in order again, which is a new priority window. When all players pass priority with the stack empty, the game moves to the next step.

> *Example (non-normative): two passes resolve Luminous Arc; a new window opens in the same step with the initiative player; two passes on the empty stack end the step.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.window.resolve — two passes resolve the top item, a new window opens, and two passes on the empty stack end the step</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.30; Manual p.30; Rulebook 2023 p.13 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.window.resolve</sub>

<a id="r703.4"></a>**703.4.** When several effects are put on the stack at the same time, each player chooses the order of their own. The initiative player puts all of theirs on first, then the non-initiative player, so the non-initiative player's effects resolve first. See rule 706.

> *Example (non-normative): with one trigger per player, the initiative player's trigger is at the bottom of the stack.* <sub>test: 239-damage-triggers-after-combat.test.ts::R261 RAQ STACK ORDER</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.43; Manual p.43 · Designer: RAQ 1540678747953569832#1 · Rulings: R2 · Tests: 239-damage-triggers-after-combat.test.ts · Key: effects.priority.simultaneous</sub>

<a id="r703.4a"></a>**703.4a** Cards played by one effect at the same time are separate effects, put on the stack at the same time in an order their controller chooses.

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1396955380000755795#4 · Tests: 169-mid-resolution-window.test.ts · Key: effects.priority.simultaneous.same-effect</sub>

<a id="r703.4b"></a>**703.4b** A Burst group of spell tokens goes on the stack all at once. Its caster chooses the order, one token at a time, and aims each; the token chosen first resolves first. The other players receive priority only when the whole group is on the stack. See rule 803.

> *Example (non-normative): the first Fireball picked ends on top of the stack.* <sub>test: 358-burst-order.test.ts::R309: the caster picks each Fireball in RESOLVE order and aims it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R309, R309 · Tests: 358-burst-order.test.ts · Key: effects.priority.simultaneous.burst</sub>

<a id="r703.5"></a>**703.5.** A card played during another effect's resolution waits on the stack until that resolution has finished. Only then do players receive priority, and they may respond to the played card before it resolves. See rule 701.4. *(Engine differs, see F-U14-3.)*

> *Example (non-normative): a card Tides of the Cosmos plays for free can be answered on the stack.* <sub>test: 169-mid-resolution-window.test.ts::a free play is still a play, so it can be answered on the stack</sub>

<sub>Basis: Designer · Verified: confirmed, round 2, 1 test run · Designer: RAQ 1396955380000755795#4 · Rulings: R198 · Tests: 169-mid-resolution-window.test.ts · Key: effects.priority.mid-resolution</sub>

<sub>Discrepancies: D-U14-5 (discrepancies.md)</sub>

<a id="r703.6"></a>**703.6.** Once an effect has begun to resolve, no player can respond to it. It can no longer be targeted, negated or augmented.

> *Example (non-normative): while Premonition is resolving, the other player is offered nothing, it is not a legal target, and a negation or a Virus aimed at it is refused.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.resolving — while Premonition is resolving it cannot be targeted, negated, augmented or responded to</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R78, R79 (its stack-virus half) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.resolving</sub>

<a id="r703.7"></a>**703.7.** Deployment uses the stack, but each player has a stack of their own there. Only that player sees it and holds priority over it; no other player can respond to it or is made to wait on it. See rule 507.

> *Example (non-normative): a deploy-timing spell played in deployment is a real stack item, so Earthbound Replicator can copy it.* <sub>test: 138-spell-copy.test.ts::R286/CT-176: a deploy-timing play names a REAL stack item</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R286, R286 · Replaces: R144 (its half (a) (deployment triggers on one shared stack) was amended by R286); R250 (its §3 deployment half (no priority in deployment) was amended by R286) · Tests: 138-spell-copy.test.ts · Key: effects.priority.deployment</sub>

<a id="r703.8"></a>**703.8.** There is no priority in the haste step. Haste cards are played there as special actions. See rule 504.

> *Example (non-normative): Molten Upheaval played in the haste step makes its Fireball at once; no one has priority and nothing waits on a stack.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.priority.haste-step — in the haste step nobody has priority and a haste card resolves at once with no stack</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13 · Rulings: R97 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.priority.haste-step</sub>

<a id="r704"></a>
### 704. Resolution and Fizzling

<a id="r704.1"></a>**704.1.** When an effect resolves, its instructions are carried out in the order printed, and a later instruction sees the results of an earlier one. The exception is target legality: it is judged once, as the effect begins to resolve (effects.resolution.recheck), so an earlier instruction cannot make a later instruction's target illegal. See rule 704.5.

> *Example (non-normative): Finality ("Negate all other effects. Erase all cards in bins.") erases the cards it has just negated, because they are in bins by its second sentence.* <sub>test: 61-negation.test.ts::Finality erases the very cards it just negated</sub>

<sub>Basis: Mixed · Verified: partial, round 3, 1 test run · Rulings: R68 (its Finality ordering note), R324 · Engine: markIllegalTargets · Tests: 61-negation.test.ts · Key: effects.resolution.order</sub>

<sub>Discrepancies: D-U14-10, D-U14-13, D-U14-6 (discrepancies.md)</sub>

<a id="r704.1a"></a>**704.1a** Choices an effect makes that are not targets (how to divide damage among a player's units, which card to discard, whether to pay an optional amount inside the effect) are made while it resolves. See rule 702.5.

> *Example (non-normative): Xenopod Progenitor's trigger goes on the stack with no payment asked; its [1] is asked as it resolves.* <sub>test: 390-raq-stack.test.ts::RAQ Xenopod: the trigger goes on the stack with no payment asked</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1397189214352703590#0 · Rulings: R67 · Tests: 390-raq-stack.test.ts · Key: effects.resolution.order.choices</sub>

<a id="r704.1b"></a>**704.1b** No priority window opens around a payment or choice made while an effect resolves.

> *Example (non-normative): while Premonition asks its controller which card to cache, the other player has no action; the choice made, Premonition finishes without any pass.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.order.no-window — the choice Premonition asks while resolving opens no priority window, and the item finishes as soon as it is made</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R6 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.resolution.order.no-window</sub>

<a id="r704.2"></a>**704.2.** When a spell resolves it goes to its controller's bin. When a spell unit resolves it enters play as a unit instead. See rule 405.

> *Example (non-normative): a resolved Luminous Arc is in its controller’s bin; a resolved Jelly is in play as a unit.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.destination — a resolved spell goes to its controller bin, and a resolved spell unit enters play</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.13; Manual p.13 · Rulings: R250 (§4, zones follow control) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.resolution.destination</sub>

<a id="r704.2a"></a>**704.2a** A card that goes to a bin from the stack is not trashed. See rule 801.

> *Example (non-normative): two Luminous Arcs reach the bin from the stack, one resolved and one fizzled; neither is trashed.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.destination.not-trashed — a spell that resolves into the bin and one that fizzles into it fire no trashed event</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R68 (its removal-and-destination half) · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.resolution.destination.not-trashed</sub>

<a id="r704.2b"></a>**704.2b** A spell token never goes to a bin; it is erased. See rule 304.

<sub>Basis: Printed · Verified: confirmed, round 1, 1 test run · Printed: Rulebook 2023 p.4; Rulebook 2023 p.4 · Rulings: R68 (its removal-and-destination half) · Tests: 61-negation.test.ts · Key: effects.resolution.destination.token</sub>

<a id="r704.2c"></a>**704.2c** A spell that is Unstable, or that carries a Virus applied to it on the stack, is erased instead of going to a bin, whether it resolves, fizzles or is negated. See rule 723.

> *Example (non-normative): a spell played from the bin under Abyssal Evocation is Unstable, so it is erased and not put back in the bin.* <sub>test: 12-fire-a.test.ts::Abyssal Evocation: a bin-played spell is {Unstable}</sub>

> *Example (non-normative): a spell played from the bin under Abyssal Evocation that fizzles is erased too.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.destination.unstable — a spell played from the bin under Abyssal Evocation that fizzles is erased, not binned</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R79 (its stack-virus half), R96 · Replaces: R68 (its bin destination for a negated card is narrowed by R79: an Unstable one is erased) · Tests: 12-fire-a.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.resolution.destination.unstable</sub>

<a id="r704.2d"></a>**704.2d** A copy of a spell has no card. When it resolves or leaves the stack, nothing goes to a bin. See rule 710.

> *Example (non-normative): a resolved copy of Suspend bins nothing, and its "Erase me." erases nothing.* <sub>test: 138-spell-copy.test.ts::a resolved copy bins nothing</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R164 · Tests: 138-spell-copy.test.ts · Key: effects.resolution.destination.copy</sub>

<a id="r704.3"></a>**704.3.** A spell unit's spell effect happens first; if it resolves, the unit then enters play. If the spell unit is prevented from resolving (negated, or with its targets made invalid), the unit does not enter play and the card goes to the bin. See rule 303.

> *Example (non-normative): a spell unit played through Hooba-Pon has its spell part happen, then spawns into the formation.* <sub>test: 396-raq-timing.test.ts::RAQ Hooba-Pon spell unit: the spell part happens, then the unit spawns into the formation</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.13 · Designer: RAQ 1461450216874967235#1 · Rulings: R97 · Tests: 396-raq-timing.test.ts · Key: effects.resolution.spell-unit</sub>

<a id="r704.4"></a>**704.4.** A negated effect is removed from the stack at once, when the effect that negates it resolves. It does not resolve.

> *Example (non-normative): one mass negate removes all its victims from the stack together, with no extra priority rounds.* <sub>test: 61-negation.test.ts::R68: a mass negate empties the stack of its victims AT ONCE</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R68 (its removal-and-destination half) · Tests: 61-negation.test.ts · Key: effects.resolution.negation</sub>

<a id="r704.4a"></a>**704.4a** A negated spell, spell unit, unit, ambush or Virus goes to its controller's bin, and a negated Virus cannot be used as a Virus again. A negated spell token is erased. A negated triggered or activated ability just leaves the stack, because it has no card of its own.

> *Example (non-normative): a negated spell token is erased, never binned.* <sub>test: 61-negation.test.ts::R68: a negated spell TOKEN is erased, never binned</sub>

<sub>Basis: Mixed · Verified: confirmed, round 1, 1 test run · Printed: Manual p.34; Manual p.34 · Rulings: R68 (its removal-and-destination half), R68 (its removal-and-destination half) · Replaces: R68 (narrowed by R79: a negated card that is Unstable is erased instead of binned) · Tests: 61-negation.test.ts · Key: effects.resolution.negation.destination</sub>

<a id="r704.4b"></a>**704.4b** A negated unit or spell unit never enters play.

> *Example (non-normative): negating a unit on the stack: it never arrives, and its card goes to the bin.* <sub>test: 118-stack-effect.test.ts::R128: negating a unit on the stack</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1461450216874967235#1 · Rulings: R128 · Tests: 118-stack-effect.test.ts, 396-raq-timing.test.ts · Key: effects.resolution.negation.no-arrival</sub>

<a id="r704.5"></a>**704.5.** As an effect begins to resolve, each target it declared is checked again by the rule it was chosen under: its kind, its printed restriction, its region, and being different from the other targets. A target that fails the check is lost, exactly like a target that has left play. See rule 110.

> *Example (non-normative): an Ambush whose ally was stolen in response recalls nothing.* <sub>test: 390-raq-stack.test.ts::RAQ valid targets: an Ambush whose ally changed sides before it resolves recalls nothing</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1355466429788328066#1; RAQ 1355466429788328066#2 · Rulings: R324, R324, R56 · Replaces: R64 (its statement that a printed restriction is not re-asked at resolution was amended by R324); R256 (its remark that a restriction is never re-asked was amended by R324) · Tests: 390-raq-stack.test.ts · Key: effects.resolution.recheck</sub>

<sub>Discrepancies: D-U14-4 (discrepancies.md)</sub>

<a id="r704.5a"></a>**704.5a** The check is made once, as the effect begins to resolve. An earlier part of the effect cannot make a later part's target illegal in the middle of its resolution. *(Engine differs, see F-U14-9.) (Untested: no executed test demonstrates it.)*

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R324 · Key: effects.resolution.recheck.once</sub>

<a id="r704.5b"></a>**704.5b** A target remains the same object while it stays where it is. A target that changes zone (to a hand, a bin, and so on) is gone, and the effect does not follow it to a new object. A target that stays put is still a legal target even if another effect also targets it. See rule 410.

> *Example (non-normative): Organic Exchange may target two of its controller's own units, and another spell aimed at one of them still resolves.* <sub>test: 396-raq-timing.test.ts::Organic Exchange may target two of your own units</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.40 · Designer: RAQ 1454169054402314362#2 · Tests: 396-raq-timing.test.ts · Key: effects.resolution.recheck.same-object</sub>

<a id="r704.5c"></a>**704.5c** Several effects may target the same unit, even if together they would do more than destroying it takes. If an earlier one removes it, the later ones lose that target.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R144 (its half (b)), R144 (its half (b)) · Key: effects.resolution.recheck.shared-target</sub>

<a id="r704.5d"></a>**704.5d** Changing an effect's targets before it resolves can save it from fizzling. See rule 110.

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1354013430805434389#2 · Tests: 12-fire-a.test.ts · Key: effects.resolution.recheck.retarget</sub>

<a id="r704.6"></a>**704.6.** An effect fizzles if, as it resolves, it has lost all of its targets. A fizzled effect does nothing, and a fizzled spell goes to the bin. See rule 110.

> *Example (non-normative): Arc Lightning’s only target dies before it resolves; Arc Lightning fizzles, deals no damage and goes to the bin.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle — Arc Lightning whose only target died fizzles, does nothing, and goes to the bin</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.43 · Designer: RAQ 1354013430805434389#0 · Rulings: R86 · Tests: 78-round17-core.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.resolution.fizzle</sub>

<a id="r704.6a"></a>**704.6a** When an effect fizzles, none of it happens, including parts of it that had no target.

> *Example (non-normative): a graft composite that loses its only target fizzles whole; its untargeted grafts make no Poison.* <sub>test: 78-round17-core.test.ts::R86: a graft composite that loses its ONLY target fizzles whole</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1354013430805434389#0 · Rulings: R86 · Tests: 78-round17-core.test.ts · Key: effects.resolution.fizzle.whole</sub>

<a id="r704.6b"></a>**704.6b** If an effect has lost some but not all of its targets, it resolves as best it can against those that remain, untargeted parts included.

> *Example (non-normative): an effect with two targets and an untargeted draw loses one target before it resolves; it acts on the remaining target and the draw still happens (illustrative).*

> *Example (non-normative): Tidal Reversion still recalls the other unit when one of its targets is removed.* <sub>test: 390-raq-stack.test.ts::RAQ target requirements: Tidal Reversion still recalls the other unit when one target is removed</sub>

> *Example (non-normative): a graft composite whose one target survives also carries out its untargeted grafts.* <sub>test: 78-round17-core.test.ts::R86: one surviving target carries the untargeted grafts through</sub>

> *Example (non-normative): Twin Flame loses one of its two targets before it resolves; the remaining target still takes its 2 damage.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle.partial — Twin Flame with one of two targets gone still damages the other</sub>

> *Example (non-normative): a graft composite with two targeted grafts loses one of the targets; the untargeted grafts still make their Poison tokens.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle.partial — a graft composite with two targets losing one still runs its untargeted part</sub>

<sub>Basis: Designer · Verified: confirmed, round 3, 3 tests run · Printed: Manual p.43 · Designer: RAQ 1410252965276684418#4; RAQ 1354013430805434389#0 · Rulings: R86 · Tests: 78-round17-core.test.ts, 390-raq-stack.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.resolution.fizzle.partial</sub>

<a id="r704.6c"></a>**704.6c** An effect that needs two of its targets together (a fight or an exchange) does nothing if it loses one of them. It does not fizzle.

> *Example (non-normative): Fight that loses one of its two targets does nothing to the survivor.* <sub>test: 390-raq-stack.test.ts::RAQ fizzles: Fight that loses one of its two targets does nothing to the survivor</sub>

> *Example (non-normative): Organic Exchange that loses one of its two targets exchanges nothing; the survivor stays with its controller.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle.pair — Organic Exchange that loses one target exchanges nothing</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Printed: Manual p.43 · Designer: RAQ 1354013430805434389#1 · Tests: 390-raq-stack.test.ts, 425-cr-casting-and-stack.test.ts · Key: effects.resolution.fizzle.pair</sub>

<sub>Discrepancies: D-U14-2 (discrepancies.md)</sub>

<a id="r704.6d"></a>**704.6d** An effect that has no targeting part anywhere cannot fizzle. Nor can a part whose target was optional ("up to") and was left empty: declaring no target was a legal choice, and the rest of the effect still happens. See rule 704.6g.

> *Example (non-normative): an item with no targeting part anywhere never fizzles.* <sub>test: 78-round17-core.test.ts::R86: an item that declares NO target anywhere never fizzles</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R86, R86, R86 · Tests: 78-round17-core.test.ts · Key: effects.resolution.fizzle.untargeted</sub>

<a id="r704.6e"></a>**704.6e** An ambush is a targeted effect. If its target is removed, the ambush fizzles and the ambushing unit is put into the bin. See rule 803.

> *Example (non-normative): the ally targeted by Lurking Slimebeast’s ambush dies; the ambush fizzles and Slimebeast goes to the bin.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle.ambush — Lurking Slimebeast whose ambush target died fizzles and goes to the bin</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.40; Manual p.40 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.resolution.fizzle.ambush</sub>

<a id="r704.6f"></a>**704.6f** A Virus whose target has become invalid when it resolves is put into the bin, and cannot be used as a Virus again. See rule 723.

> *Example (non-normative): a Virus’s host dies before the Virus resolves; the Virus goes to the bin and is not offered as a Virus from there.* <sub>test: 425-cr-casting-and-stack.test.ts::cr:effects.resolution.fizzle.virus — a virus whose host died before it resolved goes to the bin and is not offered as a virus again</sub>

<sub>Basis: Printed · Verified: confirmed, round 1, 0 tests run · Printed: Manual p.34; Manual p.34 · Tests: 425-cr-casting-and-stack.test.ts · Key: effects.resolution.fizzle.virus</sub>

<a id="r704.6g"></a>**704.6g** An effect with a required target that never had a legal candidate fizzles, although it declared no target. See rule 704.6d.

> *Example (non-normative): an item whose required target had no legal candidate when it was cast fizzles.* <sub>test: 78-round17-core.test.ts::R86: a required target with no legal candidate at cast still fizzles</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R86 · Tests: 78-round17-core.test.ts · Key: effects.resolution.fizzle.never-had-target</sub>

<a id="r704.7"></a>**704.7.** An effect stays on the stack, and still resolves, if its source leaves play. See rule 714.

> *Example (non-normative): an effect stays on the stack when its unit dies, and still resolves.* <sub>test: 390-raq-stack.test.ts::RAQ dead unit: an effect stays on the stack when its unit dies and still resolves</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353895783266516992#0 · Rulings: R325 · Replaces: R225 (its first grade (a source that died with its trigger on the stack places nothing) was reversed by R325) · Tests: 390-raq-stack.test.ts · Key: effects.resolution.source-gone</sub>

<a id="r704.7a"></a>**704.7a** Where such an effect reads its source (its attributes, power, defense, or the formation it stood in), it uses the source's last-known state: what the source was at the moment it left play. See rule 714.

> *Example (non-normative): Bellowing Boulder dies with its ping on the stack; the ping is still Deadly, from its last state.* <sub>test: 390-raq-stack.test.ts::RAQ dead unit: Bellowing Boulder dead with its ping on the stack still pings with Deadly, its last state</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 1 test run · Designer: RAQ 1353895783266516992#6 · Rulings: R325 · Tests: 390-raq-stack.test.ts, 401-raq-fix-stack.test.ts · Key: effects.resolution.source-gone.last-known</sub>

<a id="r704.7b"></a>**704.7b** An effect that acts on its source itself, or that says "if I am still in formation", does nothing if the source is gone. See rule 714.

> *Example (non-normative): Hooba-Nan gone with its trigger on the stack makes nothing.* <sub>test: 390-raq-stack.test.ts::RAQ dead unit: Hooba-Nan gone with its trigger on the stack makes nothing</sub>

<sub>Basis: Designer · Verified: confirmed, round 1, 2 tests run · Designer: RAQ 1353895783266516992#1 · Rulings: R325 · Tests: 390-raq-stack.test.ts · Key: effects.resolution.source-gone.needs-body</sub>

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

261 numbered rules.

| basis | rules |
|---|---|
| Printed | 56 |
| Designer | 46 |
| Owner call | 92 |
| Engine only | 1 |
| Mixed | 66 |

### Verification

| verdict | rules |
|---|---|
| confirmed | 259 |
| partial | 2 |
| contradicted | 0 |
| unsupported | 0 |
| untested | 0 |
| not verified | 0 |
| text changed | 0 |

### Engine-only rules (awaiting the owner's sign-off)

- [406.4b](#r406.4b) A self-erasing spell that is negated or fails to resolve goes to the bin. Its "Erase me" never happened.

### Findings: where the engine differs

- <a id="F-U07-1"></a>**F-U07-1** Biomass Devourer test title and comments still assert a stolen unit dies to its OWNER's bin. Rule 405.3. R250 reversed this: a dying unit goes to its controller's bin. The 26-metal-a test is titled and commented for the owner's bin, but its assertions pass either way: the thief's bin ends with one copy and the owner's with none whichever bin received the dead card. So the title states superseded law and the test cannot tell the two apart. Retitle it and assert that the controller's bin received the dead copy.
- <a id="F-U07-2"></a>**F-U07-2** Two test titles disagree about a token being cached. Rule 410.5c. 36-cache-prophecy says a token cached from play "is erased, not cached". 35-rot-debt-trash (R69) says it "visits the cache and is erased out of it". Both assert the same end state, so neither can fail on the visit, but the 36 title states the pre-R69 model.
- <a id="F-U07-3"></a>**F-U07-3** Abyssal Evocation timing test is still titled OPEN after R157 §12 ruled it. Rule 405.9. R96 left open whether a bin-played card obeys its printed timing. R157 §12 (owner) answered: a bin-play grant does not waive printed timing ("Already correct — Abyssal Evocation, Writhing Host."). The test and its comment still call the question open and say the assertion "flips" if the owner rules otherwise.
- <a id="F-U07-4"></a>**F-U07-4** Two R208 test titles assert law that R219 reversed (cost-erased mods and the erased pile). Rule 407.2. R219 rules that a mod erased off a living host goes to the erased pile (Slag Spewer's cost, Suppression Field). The 178 test titles still say "Q3 is OPEN" and "the pile is untouched". The assertions may have been updated without the titles; check them.
- <a id="F-U07-5"></a>**F-U07-5** Glossary Glimpse row says an expired glimpse card is still moddable; R303 says it is not. Rule 403.5. Our Glimpse row ends "public, targetable, and still moddable out of the zone at full price". R303 refuses grafting and augmenting from an expired glimpse ("an expired glimpse is not a graft, not an augment, not anything"), and the Cache row of the same glossary agrees with R303. Test 177 does not catch it. Fix the Glimpse row.
- <a id="F-U07-6"></a>**F-U07-6** Engine trashes a dying {Unstable} body via the bin; print and Caleb say it never enters the bin. Rule 405.5. Per R137 the engine pushes a dying {Unstable} card into the bin, trashes it there, then sweeps it to the erased pile. The printed reminder ("If they would enter a bin, erase them instead.") and Caleb's glossary line in R145 make it a replacement for entering the bin, which would mean no trash. Under the authority order zones.bin.unstable states the printed reading. A divergence, not necessarily a bug: it is open as D-U07-3 and depends on the owner's answer there.
- <a id="F-U07-7"></a>**F-U07-7** A stolen unit erased from play is filed on its OWNER's erased pile, not its controller's. Rule 400.4. R262 ("All four follow control") corrected R172 item 3, and every other route (bin, hand, cache, a mod erased off a host, an {Unstable} death's sweep) files the card under the controller. Erasing a unit from play still emits the erased event with the owner's seat, so a stolen unit erased by Banishment or Celestial Purge lands on its owner's erased pile. Measured by the round-1 verifier probe; test 246 covers only the mod route.
- <a id="F-U07-8"></a>**F-U07-8** The R296 §5 recycle test is titled for constructed but never builds a constructed game. Rule 408.2e. The title says "constructed gives each seat its own pile; shared and draft share one". The body asserts the harness is NOT constructed and checks only the shared pile, so the per-seat constructed pile is untested by the suite. Add a constructed case (the round-1 verifier probe shows one).
- <a id="F-U07-9"></a>**F-U07-9** eraseFromPlay files a stolen unit on its OWNER's erased pile. Rule 400.4. E.eraseFromPlay emits the erased event with seat: u.owner, so a stolen unit erased from play (Banishment, Celestial Purge) is recorded on its owner's erased pile. R262 ("All four follow control") superseded R172 item 3; every other route (bin, hand, cache, eraseMod, an Unstable death's sweep) uses the controller.
- <a id="F-U07-10"></a>**F-U07-10** Unstable card dying from play is binned and trashed before erasure (documented owner divergence from the designer). Rule 405.5. R137 has an Unstable unit that dies enter the bin, be trashed, then be erased; Caleb (2025-04-08) and the printed reminder say it is erased INSTEAD of entering the bin. Recorded on purpose in R137, so not a regression — listed because the brief asks for any engine/designer contradiction.
- <a id="F-U07-11"></a>**F-U07-11** A dying {Unstable} card enters the bin and is trashed before being erased. Rule 405.5. disposeToBin pushes an Unstable card into the bin, fires died(to:'bin') and noteTrashed, then sweeps it to the erased pile. The printed reminder ('If they would enter a bin, erase them instead.') and Caleb 2025-04-08 ('they just get erased instead of ending up in the bin') say it never enters the bin, so no trash should happen. This is a deliberate, recorded owner divergence (R137, still current); listed because the engine contradicts print and the designer.
- <a id="F-U12-1"></a>**F-U12-1** A redirected Piercing leftover is offered to other replacement holders. Rule 608.8c. The designer: Piercing combat damage redirected into Oorblak is dealt to Oorblak up to its lethal damage and the leftover goes to the player, because 'replacement effects only apply once in an effect'; the register states the claim as 'not redirected again'. The pilot verifier measured that the engine stops only the SAME replacement from applying again: a second Oorblak or a Blightsea Polyp in the region takes the leftover, and only a holder with a higher entity id sees it (a lower-id Polyp consumes the whole hit first). The rule states the ruling (no further redirection).
- <a id="F-U12-2"></a>**F-U12-2** 02-combat test title asserts the superseded no-priority-between-sub-steps law. Rule 608.3b. 02-combat.test.ts 'R3/Swift: swift column deals damage first, no priority between sub-steps' names R3's second clause, which R295 amended: a split damage step opens a priority window between sub-steps. The pilot verifier's probe found this test's own board stops at that window (damageSubs Swift and normal, step damageWindow); its assertions are made there and prove only the Swift strike. Retitle it.
- <a id="F-U12-3"></a>**F-U12-3** 239 'R3 STILL STANDS' asserts at the Swift window, before the normal sub-step runs. Rule 608.3e. 239-damage-triggers-after-combat.test.ts 'R3 STILL STANDS' claims the Swift-killed Sprite dealt nothing in the normal sub-step and that only the trigger queue waits. Its board is a split step (a Swift blocker against a normal attacker), so after pass/pass/answerElections it is paused at the Swift/normal window: the 'dealt NOTHING in the normal sub-step' assertion is taken before the normal sub-step runs, and in a split step the trigger queue resolves at that window rather than waiting until after combat (R295). The test does not assert its title.
- <a id="F-U14-1"></a>**F-U14-1** A graft trigger with no legal target goes on the stack and fizzles instead of not being put on the stack. Rule 702.8b. The designer says a graft composite whose targeted part has no legal target cannot be put on the stack. The RAQ register's own note says the engine reaches the same visible result (no Poison) by putting the item on the stack and fizzling it under R86. Then the opponent gets a priority window, and the item can be taxed or negated, though it should never exist. Suspected; not checked against the engine.
- <a id="F-U14-2"></a>**F-U14-2** The engine appears to pass priority to the other player after every action, so a player cannot hold priority. Rule 703.2a. The Manual says a player who acts may keep priority and take further actions before passing. R250 and R198 describe the engine handing priority to the other seat whenever an item is pushed. If so, a player can never stack two of their own actions before the opponent may respond (the Manual names Burst as the usual exception, and Burst is handled separately). Suspected from ruling text only; Annex D may record a digital convention that settles it. Measured by the U14 tester: after a battle cast of Luminous Arc, priority is on the other seat, not the caster (pushItem hands it to other(controller)).
- <a id="F-U14-3"></a>**F-U14-3** Units played by Wake the Dead and The Bonesculptor spawn in place, never on the stack, and a spell unit they play skips its spell. Rule 701.4. R198 rules that a card played during a resolution is played and goes on the stack, where it can be responded to. R207 records that the spawn route used for cards that print "play" (Wake the Dead, The Bonesculptor) predates R198 and still spawns the unit in place, so nobody can answer it. R165 records that a spell unit raised by Wake the Dead does not cast its spell, though a played spell unit's spell part should happen (RAQ, Hooba-Pon). Suspected still open. Verifier probe (U14 round 1): a unit Wake the Dead plays in battle is in play at once and never on the stack. Affects effects.priority.mid-resolution too. Round 2 probe: onStack=false, inPlay=true; the Wake the Dead comment calls this "the standing playInline approximation", but playInline itself now pushes in battle.
- <a id="F-U14-4"></a>**F-U14-4** A test title still marks as OPEN whether a bin-played card obeys its printed timing. Rule 702.2a. R96 shipped the restrictive answer (printed timing applies) and flagged the question OPEN. R157 §12 later answered it the same way ("Already correct — Abyssal Evocation"). The test title and R96 heading still present it as open.
- <a id="F-U14-5"></a>**F-U14-5** Bloomcaster does not hear its own play. Rule 701.1e. R26 (current) says Bloomcaster's "Whenever you play a unit" fires on its own arrival when played normally. The verifier measured no 1/1 when Bloomcaster is played from hand: the card listens on cardPlayed from holders in play, and Bloomcaster is on the stack when its own play fires. Either the engine regressed when Bloomcaster moved to cardPlayed (R129/R165), or R26 is stale and should be superseded (D-U14-11).
- <a id="F-U14-6"></a>**F-U14-6** Wake the Dead / The Bonesculptor plays never reach the stack. Rule 703.5. R198 rules that a card played mid-resolution is played and goes on the stack, respondable. Wake the Dead ({Battle}, "Play up to two units ... now") spawns its units with spawnUnit(asPlay) inside its own resolution: no stack item, no window, not negatable (probe: unit in play immediately).
- <a id="F-U14-7"></a>**F-U14-7** Wake the Dead and The Bonesculptor play units mid-resolution with no stack item. Rule 703.5. R198 (and the designer on Tides) says a card played during a resolution goes on the stack and is respondable once the resolution finishes. Wake the Dead and The Bonesculptor still spawn the played unit in place (spawnUnit asPlay), so nobody can respond to or negate it. Probe: onStack=false, inPlay=true. The Wake the Dead comment calls this "the standing playInline approximation", but playInline itself now pushes in battle.
- <a id="F-U14-8"></a>**F-U14-8** Bloomcaster does not trigger on its own play (contradicts R26). Rule 701.1e. R26 says Bloomcaster's "Whenever you play a unit" fires on its own arrival. The trigger listens on cardPlayed, which fires at commit while Bloomcaster is on the stack, so it never hears itself. Probe measured 0 tokens. The card file comment still claims "playing Bloomcaster itself still makes a 1/1".
- <a id="F-U14-9"></a>**F-U14-9** Cards that re-check their target restriction by hand let an earlier part make a later part’s target illegal mid-resolution. Rule 704.5a. The rule (R324’s encoding) says target legality is judged once, as the item begins to resolve, so an earlier part of the same item cannot make a later part’s target illegal. markIllegalTargets does judge once, but Minor Kraken (and, by the same pattern, Throw off a Cliff and Leave None Pure) re-checks its printed restriction inside its own run. Measured by the U14 tester: a composite whose first part puts 11 +1/+1 counters on a 0/2 and whose second part is Minor Kraken’s recall does not recall it (control without the counters: recalled).

### Game rulings no rule cites

R1, R4, R5, R8, R9, R10, R11, R12, R14, R15, R16, R17, R18, R19, R20, R22, R24, R25, R27, R28, R30, R32, R33, R38, R39, R42, R43, R44, R47, R48, R50, R52, R53, R54, R55, R58, R62, R63, R66, R70, R71, R73, R74, R75, R76, R77, R80, R81, R82, R83, R84, R87, R88, R89, R90, R91, R92, R93, R94, R95, R99, R101, R102, R103, R104, R105, R108, R110, R112, R113, R115, R116, R118, R119, R121, R122, R125, R126, R127, R129, R130, R132, R133, R143, R147, R148, R154, R158, R161, R162, R166, R168, R184, R187, R191, R194, R196, R197, R206, R207, R212, R216, R221, R223, R224, R226, R227, R228, R239, R240, R243, R264, R265, R268, R269, R270, R277, R278, R281, R282, R283, R289, R293, R294, R301, R302, R304, R307, R313, R314, R316, R317, R318, R326, R328, R329, R331, R332, R333, R334, R336, R339, R340, R341

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

- New: 287 rules and 99 sections.
