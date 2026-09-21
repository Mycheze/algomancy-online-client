# 08 — Light & Dark: mechanics spec

**This file is the contract for the expansion.** Every agent scripting a Light or Dark
card codes against it, and every rule here should end up as a test. Rulings are numbered
in [digital-rules.md](digital-rules.md) (R38–R48); this doc is the readable version with
the card inventory attached.

## Provenance

Unlike the base set there is no official Light & Dark rulebook — the Manual PDF has not
changed since 2024-05. Everything below has one of three sources, named per rule:

- **printed** — reminder/banner text on the cards themselves.
- **Caleb** — a designer statement, with date, from the Discord exports in
  `../../data/rulings/exports/` or relayed by Bena.
- **Bena** — a local adjudication where the above run out.

Bena supplied the rot, debt, trash, prophecy and Wight rulings on 2026-08-19 as official
findings from Caleb; they are treated as authoritative here, not provisional.

⚠ **2026-08-21 supersedes two of those.** The **Wraith token was redesigned** — Bena
supplied the physical card, and it is a **3/3** with two entirely different triggers (see
[The Wraith](#the-wraith-retired-name-wight)). And **tokens CAN be trashed**, reversing the
"tokens are excluded" line below. A sourced ruling can go stale when the *card* changes;
prefer the newest date.

## The two elements

`light` (pip `l`) and `dark` (pip `d`) join fire/water/earth/wood/metal. Canonical order
is `fire, water, earth, wood, metal, light, dark` everywhere (`ALL_ELEMENTS`).

163 new cards: 54 mono-light, 54 mono-dark, 55 hybrids (11 new pairs × 5, including
light/dark). Totals become **7 elements, 21 hybrid pairs, 483 draftable cards, C(7,3) =
35 draft trios**, each trio still exactly 177 cards (3 × 54 + 3 × 5).

---

## Rot

A counter accumulated by a **player**, not a unit. `PlayerState.rot: number`.

> **At the start of deployment, you take damage equal to the number of rot you have.**
> Rot never decreases on its own.

*Source: printed (the Rot Counter card from Caleb's own card library, 2026-01-15);
confirmed by Bena 2026-08-19.*

- Every player takes this damage each turn, in initiative order for determinism.
- It is **damage**, so it interacts with everything damage does.
- The source is the damaged player's own rot: *"Your rot is a source you control. But if
  you give an opponent rot, that won't be a source you control damaging them"* (Caleb,
  2024-08-20). So the rot damage a player takes is from a source **they** control.
- It lands in the same window as regroup triggers (Caleb, 2024-04-06), and since there is
  no priority during deployment (Caleb, 2024-10-23) **it cannot be responded to**.
- Gaining rot is not damage and is not a trigger of its own beyond `rotGained`.

**Replacement — Skittering Blight**: "If rot would deal damage to you, instead put that
many +1/+1 counters on me." So the start-of-deployment rot damage must run through a
replacement hook, not be applied inline.

**Replacement — Blightsea Polyp**: "[Augment] Columns deal combat damage to players as 1
rot. *(For example, a column of a 4/4 unit and 2/2 unit would give the opponent 1 rot,
without changing their life total.)*" — per **column**, regardless of the column's total
power. Critically, Caleb ruled (2024-10-24) that the damage **still counts as having been
dealt**, so a `{Lethal}` unit in such a column still kills the player.

**Cards (15):** Blightmound, Blightsea Polyp, Cosmic Devourer, Fester, Legion of the
Depths, Pale Tormentor, Pestilent Titan, Plague Ritual, Primordial Coalescence, Rotling,
Rotwall, Skittering Blight, Spellbind, Thought Extraction, Umbral Decay.

---

## Debt

A counter accumulated by a **player**. `PlayerState.debt: number`.

> **After the planning phase's resource step, you must pay 1 mana per debt you have.
> Each mana paid removes one debt. If you cannot pay it all, the remainder carries over
> to the next turn.** You cannot activate mana after paying debt.

*Source: Caleb 2024-09-10 (the Light element announcement), refined 2024-12-02
("Debt technically doesn't replace refresh. It happens at the end of the resource step");
confirmed by Bena 2026-08-19.*

- 1 debt = 1 mana. Payment is **mandatory** and automatic — it is not a player choice and
  needs no new action.
- Partial payment is fine; leftover debt simply stays.
- There is **no** other penalty for being unable to pay (no life loss).
- Paying happens at the very end of the resource step — i.e. when the player finishes
  planning — precisely so no further mana can be activated afterwards. The mana paid is
  expended and is therefore unavailable for casting this turn, which is the whole cost:
  *"essentially, you lose X mana on your following turn when you gain X debt."*
- Debt goes away as it is paid, unlike rot: *"Rot stays debt goes [away]"* (Caleb,
  2025-03-19).

**Cards (8):** Blurf, Covenant of the Damned, Debt Blep, Deferral Drone, Glutton of
Absolution, Greed Angel, Hyper Beam, Reap the Due. `Hyper Beam` prints `[Gain 4 debt]` as
a bracketed cast-time cost (extracted as `printed.gainDebt`); the rest gain debt through
rules text or an activated-ability cost.

---

## Cache

A fourth zone alongside hand, bin and deck. Caleb: *"basically exile with the intent to be
referenced later"*, *"a neutral zone like the hand and bin"* (2024-02-25).

- **Cache is public information** (⚠ R41, Bena's call): glimpse reveals, and Prismatic
  Observer targets a cached card, so both players can see it. No server-side redaction.
- A cached card **stays cached** if never used. It is not discarded, binned or erased.
- Being in cache does **not** by itself permit playing: *"You can only play cached cards
  that allow you to play them (like glimpse)"* (Caleb, 2024-12-03). Permission comes from
  a fulfilled prophecy or from a glimpse-style "you may play it until end of turn".
- You **can** augment or graft from cache (Caleb, 2024-12-02) — but on the SAME permission
  as a play, and at the same price: free off a fulfilled prophecy, the card's mana off a
  live glimpse, affinity waived either way, and nothing at all once the window has closed.
  ⚠ These two bullets sat next to each other for a year while the engine read the second as
  overriding the first, which is how an expired glimpse stayed a live graft forever. See
  [R303](digital-rules.md#r303--the-caches-mod-verbs-are-gated-on-the-same-permission-as-its-play-verb).
- When a card in play with mods on it is cached, **the mods go to the bin**, they do not
  travel with it (Caleb, 2024-09-15).

**Cards (12 L&D):** Big Glimpse Card, Blurf, Delver of the Ephemeral, Divine Foresight,
Grob, Living Vault, Lurking Dread, Murkdrop Distiller, Prismatic Observer, Prophecy Bug,
Visionary Construct, Waxen Witness.
**Base-set cards already using cache (5):** Celestial Purge, Dematerialize, Foretell,
Oracle of Foretelling, Premonition — these currently have no real cache to go to and
should be revisited once the zone exists.

---

## Prophecy

Printed reminder text:

> **To prophecy, cache this card during deployment by paying its prophecy cost. You may
> play it for free, as if it were in your hand, if the prophecy has been fulfilled.**

*Source: printed, relayed by Bena 2026-08-19. Matches Caleb's 2024-09-10 announcement:
"Cache the card from your hand for its prophecy cost. Then anytime after the condition has
been met, you may play it for free as if it was in your hand."*

The banner is a second bar under the title: `[2] Prophecy — Two Turns Pass`. The
extractor emits it as `printed.prophecy = { mana, condition }`.

**Prophesying** is a new action, legal **only during the deployment phase** (Caleb,
2025-05-09: *"Only during deployment"*). It costs the banner's mana — a plain number, no
affinity pips — and moves the card from hand to cache with the prophecy attached.
`Angel of Anguish` prints "I can be prophesied from your bin", so the action takes a
source zone; **no card may be prophesied from the bin unless it says so.**

**Fulfilment counts forward from the moment of prophesying** (Caleb, 2024-09-22:
*"It needs to be prophecied beforehand … Same way that 'Four turns pass' can't just be
played on turn 5"*). ⚠ R44 (Bena's call): once fulfilled, a prophecy **latches** —
"anytime after the condition has been met" reads as permanent, so a card prophesied on
"your life is 5 or less" stays playable even if you gain life back.

**Playing from cache** is free — and "for free" **also ignores affinity** (Caleb,
2024-10-28, after changing his mind mid-thread: *"it is easier if 'for free' also ignores
affinity across the board"*). "As if it were in your hand" means normal **timing** still
applies: a unit needs deployment, a `{Battle}` spell needs battle, and so on.

A fulfilled prophecy also lets you **graft or augment the card for free** (Caleb,
2024-12-03), not only play it.

**Conditions to implement**, with their cards:

| condition | cards | evaluation |
|---|---|---|
| `One Turn Passes` / `Two Turns Pass` / `Three Turns Pass` / `X Turns Pass` | The Foretold, Angel of Anguish, Big Glimpse Card, Flzzz, Blurf, Divine Foresight, Living Vault, Prophecy Bug | turns elapsed since prophesying ≥ N |
| `One Battle Passes` | Grob, Waxen Witness | battles **completed** since prophesying ≥ 1. In 1v1 both the initiative battle and the counterattack each tick it (Caleb, 2024-09-24) |
| `Your life is 5 or less` | Divine Intervention | live check, then latched |
| `Your units have four unique costs.` | Air Plant | count distinct printed mana costs among your units in play ≥ 4 |
| `End [Haste] with used mana` | ~~Tithe Enforcer~~ — **no printed card since 2026-09-21** | at the end of the haste step, you spent ≥ 1 mana **during that haste step** — i.e. you must haste something *else* to fulfil it (Bena, 2026-08-19). Caleb removed the banner from Tithe Enforcer; the `hasteWithUsedMana` rule is kept and is driven by a synthetic card in `36-cache-prophecy` |

The trailing `[Haste]` on Divine Intervention's banner is a **timing marker on the
release**, not part of the condition — split it off.

Six cards **grant** a prophecy to another card via rules text rather than printing a
banner, so the engine must be able to attach a prophecy to an arbitrary card as it is
cached: Blurf, Divine Foresight, Grob, Living Vault, Prophecy Bug, Waxen Witness. Note
`Prophecy Bug`'s "X Turns Pass, where X is half of its cost, rounded up" and `Blurf`'s
inconsistent transcription `'Prophecy: 1 turn passes'` — normalise both.

**Counterplay:** `Prismatic Observer` ("Recall up to one target cached card") exists
specifically to answer a nearly-fulfilled prophecy (Caleb, 2025-12-06).

**Cards printing a banner (6):** Air Plant, Angel of Anguish, Big Glimpse Card, Divine
Intervention, Flzzz, The Foretold. *(Seven until 2026-09-21, when Caleb removed the
banner from **Tithe Enforcer** — the whole of that card's text. It was the only one whose
condition was about the haste step, and the only banner paired with a {Haste} printed
timing, so `E.cachedTiming`'s trailing-marker branch now has Divine Intervention alone.
CARD-TODO #188.)*

---

## Glimpse

> *(Reveal the top X cards of the deck and **cache one**. Until end of turn, you may play
> it as if it was in your hand, ignoring affinity. **Recycle the rest**.)* — printed on
> Premonition, Oracle of Foretelling, Celestial Purge and Dematerialize

*Glimpse predates the expansion but has never been implemented correctly.*

- **Glimpse N reveals the top N cards, caches exactly ONE (the glimpser's choice), and
  recycles the other N−1.** ⚠ An earlier draft of this spec said "caches them all"; that
  was wrong. Every card that prints the N>1 reminder text says "cache one … recycle the
  rest", and the N=1 cards ("reveal the top card and cache it") are simply the degenerate
  case where those two readings coincide. Glook's "Glimpse 1, X times" is X separate
  one-card glimpses, not a single Glimpse X.
- Ignores affinity (Caleb, 2024-10-28) but **you still pay the mana cost** (Caleb,
  2023-08-13), and **timing restrictions still apply** (Caleb, 2025-12-28).
- The permission expires at end of turn; the cached card remains in cache afterwards, inert.
- **`Big Glimpse Card` is a deliberate variant, not a counterexample**: it says "Cache one
  **pile**" and "Recycle the other pile" — it spells out pile-wise wording precisely
  because it departs from the one-card default.

**Cards (6 L&D):** Glook, Lifebound Seer, Lilbot, Maw of Despair, Seer of Empty Spaces,
Visionary Construct. Plus the 5 base-set cache cards above.

---

## Trash

> **A nontoken card entering a bin from anywhere other than the stack is trashed.**

*Source: printed reminder text (Void Scavenger, a Feb-2025 playtest card), Caleb the same
day (2025-02-01: "basically when a card enters your bin but wasn't played"), confirmed and
broadened by Bena 2026-08-19.*

**Counts as trashing:** discarding from hand, sacrificing, milling from the deck, and a
unit **dying in combat** (Caleb confirmed a unit dying is trashed, 2025-02-01).

**Does not count:** a spell or ability going to the bin after resolving (that is the stack,
which is explicitly excluded — so countering/negating a spell is not trashing either);
**erasing**, which never touches the bin at all and is a permanent one-way zone (Caleb,
2025-12-06).

### ⚠ Tokens CAN be trashed (Bena, 2026-08-21 — REVERSES the earlier position)

This doc previously excluded **tokens** of any kind, on the strength of the word
*nontoken* in the reminder text. That is now wrong. A token that reaches a bin **is
trashed**, and fires every "when a card is trashed" trigger.

The evidence:

1. **A token IS a card in Algomancy.** Both rulebooks say so outright — *"Tokens are
   temporary **cards**"* (`data/rules/Algomancy-Manual.txt:330`,
   `data/rules/Algomancy-Rulebook-2023-07.txt:116`). This is the opposite of Magic, where
   "token" and "card" are disjoint; the Magic instinct is where the exclusion came from.
2. **The one "nontoken" is on a cut card.** The qualifier survives only in the reminder
   text of **Void Scavenger**, which has been **cut from the set**. Caleb's own paraphrase
   the same day — *"basically when a card enters your bin but wasn't played"*
   (2025-02-01) — has no such qualifier.
3. **A dying token really does enter the bin.** Caleb, 2025-03-12, asked whether a token
   entering the bin counts: *"yes, for the purposes of triggers"*. And 2025-06-15, on the
   same point for the hand: *"Technically it does enter your hand and then gets erased
   immediately. So it would trigger any 'enters hand' stuff"*. The token touches the zone,
   fires what triggers off the zone, and is erased only afterwards.

⚠ **Unnoted conflict with the printed Manual.** `data/rules/Algomancy-Manual.txt:361-362` says a
unit token leaving play is *"placed back into the token pile **instead of** the hand or
bin"* — i.e. it never touches a bin at all. That is **contradicted** by the two 2025 Caleb
rulings above, and no source in this repo previously flagged the contradiction. Follow the
rulings (a designer ruling that contradicts an older rulebook means the game *changed*),
but treat this as **provisional**: there is no official L&D rulebook or errata to settle
it.

The card is trashed **by the owner of the bin it enters**. "When you trash a card" means
your own bin; "when another card is trashed" excludes the trigger source itself.

**Per-battle counter required:** `Dropslime` deals damage equal to "the number of cards
trashed **in this battle**" and `Muck Rummager` triggers "when you trash a card **during
battle**". Use the existing `battleCounters` mechanism.

**Cards (14):** Afflicting Anima, Blightwalker, Cerebrox, Cthyrian Culler, Cthyrian
Rector, Dropslime, Maw of Despair, Muck Rummager, Murkdrop Distiller, Murkstalker, Nothyr,
Splort, Thoughtripper, Unrelenting Horror.

⚠ Note `Dropslime` ("1 Discard me") and `Nothyr` ("2 `[d]` Discard Me. `{Battle}`") print a
**discard-me cost line**: pay the mana, discard the card from hand, which trashes it and so
fires its own "when I am trashed" trigger. This is a new play mode, like Ambush.

*Grep warning: `Trashling` is an unrelated base-set Metal virus.*

---

## The Wraith (retired name: Wight)

The token was **renamed FROM "Wight" TO "Wraith"** (Bena, 2026-08-19) and then
**REDESIGNED** (Bena supplied the physical card, 2026-08-21). Register it under the
CURRENT name **`Wraith`** and alias the retired `Wight` to it, so an old printing still
looks up but state only ever stores `Wraith`.

**This is the authoritative printed card:**

```
Wraith — cost 0, 3/3, "Blight Zombie Token Unit"
[Augment] At the start of deployment, put a -1/-1 counter on an ally.
          When I die, Augment a Wraith onto an ally.
```

⚠ **Everything the previous revision of this section said is obsolete.** It recorded a
**4/4** whose triggers read *"When I attack or block, put a -1/-1 counter on **me**"* and
*"When I die, augment **me** onto **target** ally"*, and described it as a body that shrinks
as it fights and then re-attaches itself. All of that is now wrong — the stats, both
trigger conditions, and both effects. Also wrong: the claim that the printed token card
still shows the retired title. **The printed token card says `Wraith`.** The only place the
retired name survives is inside `Blight's End`'s own printed text (see below).

It is a **real 3/3 body**, not merely a mod, and it also carries `[Augment]` so it can be
created directly as a mod. Both text lines are **live on a Wraith standing in play as a
unit** — a card's own `[Augment]` text is live while the card is itself a unit; it is not
dormant text that only switches on once attached to a host (Bena, 2026-08-21).

Engine consequences:

- "**Create** a Wraith" spawns it as a **3/3** unit token.
- "**Augment** a Wraith on/onto a unit" creates it directly as an augment mod on that unit
  — the same token, applied rather than spawned.
- **Trigger 1 is a deployment-phase debuff pointed OUTWARD.** At the start of deployment,
  its controller puts a -1/-1 counter on **an ally**. It is not a combat trigger and it
  does not shrink itself. A Wraith standing in play grinds down the board it is on.
- **Trigger 2 does NOT move the dying Wraith.** The dying Wraith is **erased like any
  other token**; the trigger **mints a NEW Wraith** and attaches it as an augment on an
  ally. It is a fresh token, not a relocation — counters, damage and other mods on the
  dying body do not carry across, and the effect works even if the Wraith is erased,
  since the new one is created from the token pile (Bena, 2026-08-21).
- **"An ally" is NOT a target.** It is chosen **on resolution**, so it cannot be
  redirected by anything that redirects targets, and the trigger cannot **fizzle** for
  want of a legal target. Do not route either trigger through the targeting/restriction
  seam; pick on resolve (Bena, 2026-08-21).
- A Wraith dying **IS** trashing — see [Tokens CAN be trashed](#-tokens-can-be-trashed-bena-2026-08-21--reverses-the-earlier-position)
  above (Bena, 2026-08-21). The old "tokens are excluded" line is reversed.

⚠ **R47 is now materially wrong.** It encodes the old behaviour — that a dying Wraith is
*not* erased and re-attaches *itself* as a mod, ceasing to exist only when no legal ally
exists. Under the new card the dying Wraith **is** erased and a **new** token is created.
R47 is being rewritten by the engine work in this same round; see
[digital-rules.md](digital-rules.md) for the current wording. **This doc does not edit
that file** — treat digital-rules.md as the ruling of record once it lands.

**Cards (7):** Afflicting Anima, Blight's End, Cosmic Devourer, Legion of the Depths,
Plague Ritual, Primordial Coalescence, Xzydris.

⚠ The printed data is mid-transition: six cards already print the current **"Wraith"**,
while **`Blight's End` still carries the retired "Wight"** ("Augment a Wight onto X target
units") — preserve that card's text verbatim. Both must resolve to the same token —
canonical `Wraith`, alias `Wight` — and a card-name lookup must never treat them as two
things.

The token now has a proper entry in `data/cards/AlgomancyCards-OracleText.json` under
`Wraith` (image `Wraith.jpg`), so it no longer has to be registered synthetically for art
to resolve.

---

## New attributes

| attribute | reminder text | cards |
|---|---|---|
| `{Blessed}` | Damage dealt by a blessed source causes its controller to gain that much life. | Blessed Thing, Flzzz, Godray, Hammer of Justice, Shib |
| `{Afflicting}` | When an afflicting source kills one or more units, those units' controllers gain a rot. | Umbral Decay |
| `{Lethal}` | Any combat damage from a lethal unit will kill a player. | Gublin |
| `{Pure}` | Pure cards and cards they are interacting with ignore all other attributes. | Just a Unit — **LIVE** (R61), see below |
| `{Modular}` | You can apply mods to a modular card from your hand and/or bin as it is played. You still pay their costs. | Spellbind |

**Blessed** is lifelink, and it is *simultaneous*: Caleb, 2024-09-15 — *"Simultaneous"*;
2025-03-18 — *"blessed gain and damage happen on the same game state check"*, *"(similar
to lifelink in mtg)"*, and explicitly yes to "if it would deal lethal damage to you, do
you heal before you die". So the life gain applies **before** the lethal state check; a
blessed source cannot kill its own controller through its own damage.

**Afflicting** fires on **-1/-1 counter kills**, not only damage kills — Caleb, 2024-09-10:
*"we check damage and stats of units that were interacted with during spell resolutions"*.
This matters because Umbral Decay's own effect *is* two -1/-1 counters. Per the reminder
text it is one rot per affected controller per kill event, however many units died.
⚠ R48 marks that last point as Bena's reading; no designer statement was found.

**Lethal** kills a player outright on any combat damage. Note the Blightsea Polyp
interaction above: rot replacing the column's damage still counts as damage dealt, so
Lethal still kills.

**Modular** mods are attached at cast time and ride on the stack with the spell — Caleb,
2025-02-07: *"spellbind is an additional cost so it shows up on the stack with all it's
mods"*, and a copy of the spell would copy the mods too.

**`{Pure}` is LIVE as of R61** — the parking call above turned out to be wrong, and it is
worth saying why. It was parked because it looked like it needed the attribute-suppression
layer still parked for Monke, Suppression Field and Transmogrifant. It does not: those
suppress a card's attributes *globally and durably*, whereas Pure is scoped to a single
**interaction** and switches both sides of it off at once. Combat already resolves per
attack-column/block-column pair — which is exactly that interaction — so Pure needed no new
layer, just the existing choke points (`E.pure`). Playtest DEYK reopened it: "Pure units
should be able to block evasive or flying units". Still parked: Pure outside combat.

The other three are genuinely different and stay parked.

---

## Playing vs applying (recap of R37)

Only **units and spells** are played. Applying a mod — Virus, graft or augment, from hand,
bin or cache — is **not** playing a card, so "when(ever) you play a …" triggers do not
fire. This matters most for the Light cards that care about playing cards. Bena's
provisional local errata, 2026-08-19.

---

## Deliberately out of scope

- Attribute suppression proper (Monke, Suppression Field, Transmogrifant) —
  `{Pure}` is done and needed none of it (above).
- ~~The general cost-modifier layer.~~ Delivered in two halves: mana in R59
  (Tranquility) and life in R60 (Arbiter of Armistice). `Deferral Drone` ("the next card
  you play this turn costs `[3]` less") is still parked — it wants a *consumable*
  modifier, which neither half is.
- Multiplayer prophecy counting (per-player turn vs table round) — 1v1 only, so
  unambiguous here.

---

## Engine wave D (2026-08-19): what the nine card batches asked for, and got

All nine batch agents independently reported the same short list of missing
primitives. They are built; the rulings are R49–R51 in `docs/digital-rules.md`.

**Built.** A `lifeGained:<seat>` battle ledger mirroring `lifeLost` (Life
Channel, Riftspawn Remnant, Retribution Thing). An `endOfHaste` event, fired
before the R43 mana-tally sweep (Keeper of Tithes, Debt Plant). A
`startOfDeployment` event, fired after R38's rot damage (Xzydris, Scholar of the
Void, Prediction Prophet, and the base set's Invasive Species). Real non-mana
costs on both spells (`payLife` / `discardCard` / `gainDebt`, plus the printed
`gainDebt` line) and activated abilities (life / debt / discard N /
sacrifice-another N / the printed either-or), all of which **gate** the action
instead of fizzling at resolution. Per-ability `{Battle}` / `{Deployment}`
timing (Grox, Cadaverous Cultivator). `Entity.spawnedTurn` (Banishment). A
source `from` zone on the play events (Proph, Stalwart Sentinel). Zone-resident
trigger listeners for cards sitting in a bin or a cache (Lurking Dread,
Inexorable Miasma, Xzydris, and the base set's Cinder Scuttler).

**Deliberately not built**, and still parked by decision: the copy layer, the
attribute-suppression layer (`{Pure}`), the general cost-modifier layer, and a
general replacement framework. Additionally still missing, each flagged on its
own card: a "a card LEFT a bin" event (Rotling), transform machinery (Scholar of
the Void), a "predict a number" player action (Prediction Prophet), a
play-from-bin action and a play-into-formation mode (Trench Stalker, Writhing
Host), a cost whose amount the payer chooses (Flesh Tithe, No Hand Killer,
Glook) and a bin-zone cost (Grox).

## Engine wave G (2026-08-19): the repair pass

Four fixes, all cross-file, made once the whole repo was held by a single
agent:

1. **`E.glimpse` now implements R45 as corrected** — reveal N, cache exactly
   ONE of the glimpser's choice, recycle the other N-1 to the bottom of the
   deck. The choose-one is raised through the resolving part's own
   `ctx.choose` via a new `E.partChoose` seam, so every one of the eleven
   callers (`Celestial Purge`, `Oracle of Foretelling`, `Premonition`,
   `Dematerialize`, `Foretell`, `Lifebound Seer`, `Maw of Despair`, `Lilbot`,
   `Glook`, `Seer of Empty Spaces`, `Visionary Construct`) became correct with
   **no card-code change**. `Big Glimpse Card` is untouched — it is the
   deliberate pile variant.
2. **`E.destroy(u, verb, { binTo })`** — R40's "trashed by the owner of the bin
   it enters" needed the bin push and the trash attribution to be one
   decision. `Pull Under`'s reroute-after-the-fact block is gone.
3. **Two base-set cards unparked** by the R50/R51 primitives: `Invasive
   Species` (a `startOfDeployment` trigger) and `Cinder Scuttler` (a
   `zone: 'bin'` trigger). `Abyssal Evocation` stays parked — it needs a
   bin-play permission in `doPlayCard`, a different gap.
4. **R52** settles where created units arrive (the controller's home region),
   closing R33's open question in favour of R28. Six Light & Dark cards moved.
   **⚠ REVERSED 2026-08-23: R52 and R28 are WITHDRAWN by R115** (a created unit
   arrives where its SOURCE is, `ctx.region`), which absorbs R33 as the general
   rule and moves those six cards back where they started.
