# 03 — Algomancy mechanics inventory (what the engine must implement)

Compiled from `Rules/Algomancy-Manual.txt` (authoritative), the 2023 rulebook, the glossary
(⚠ partially outdated: "discard/creature/skirmish" → Manual's "bin/unit/battle"), and a scan of
all 370 card entries (328 real game cards after removing help/promo/tracker/resource entries).

## 1. Game structure — one global turn, no player turns

Formats: Live Draft (standard, shared deck drafted in-game), Constructed (30+ cards, max 2
copies), Cube/Pre-Draft, Team Draft. Setups: 1v1, FFA 2-9, Teams 2v2/3v3, Archenemy 2v1.
Life 30 → 0. A rotating **Initiative token** resolves all ordering questions.

Four phases per global turn:

1. **Planning** — refresh resources; draw 2; draft step (merge hand+pack, leave exactly 10,
   pass clockwise; constructed: draw 2 more / recycle 2); resource step (create any number of
   resources by recycling a card each — they spawn dormant/face-down; **activate max 2/turn**);
   haste step (only Haste cards playable).
2. **Battle** — the *only* interactive phase. See §8.
3. **Regroup** — global cleanup, no priority, no actions: units return home, damage cleared,
   temporary stat changes cleared, spell tokens erased, formations dissolve. Note regroup runs
   *before* deployment → deployment buffs persist into next turn's battle.
4. **Deployment** — play cards, activate abilities, apply mods (from hand or bin). Players are
   alone in their regions — **zero interaction**. Battle-icon cards unplayable. Then an
   **End of Turn step** whose triggers resolve as special actions — *cannot be responded to*.

### Simultaneity map
| Step | FFA | 1v1 / Teams |
|---|---|---|
| Planning | fully simultaneous | fully simultaneous |
| Attack declaration | **simultaneous, via face-down Intent cards** (Left/Right/Stay), flipped at once | sequential: Initiative Team (IT) attacks first; NIT then declares blocks *and* counterattacks together |
| Priority | per region, clockwise from nearest-to-initiative | IT first, then around |
| Combat damage | simultaneous within a region's damage step | same |
| Deployment | fully simultaneous | sequential: IT deploys everything first, then NIT (deliberate info asymmetry) |

**1v1/team battle is two sub-phases** (Manual p.20-21): Phase 1 in NIT regions — IT attacks;
priority; NIT blocks and simultaneously sends counterattackers out (they "leave the region and
are treated as if they don't exist until phase 1 finishes"); priority; simultaneous damage;
after-combat priority. Phase 2 in IT regions — same 6 steps with roles reversed. NIT may attack
even if IT declined. No counter-counterattacks.

**Region resolution order** (Manual p.21): battles resolve one region at a time, clockwise from
left of initiative; initiative player's region **last**. While a region resolves, everything in
other regions is "treated as though it doesn't exist" (no triggers, no interaction — Sparkwraith
example). Regions with disjoint participants may resolve in parallel.
**Engine takeaway: each region is an isolated sub-game with its own stack; a scheduler
serializes regions sharing a participant.**

Elimination: pack recycled, neighbors' regions become adjacent, game continues.

## 2. Zones

1. **Shared deck** (live draft) — face-down, communal; "recycle" = bottom, in random order.
   Constructed: per-player deck.
2. **Pack** (per player) — 10 face-down cards, viewable only during your draft step, passed
   clockwise, refreshed every N+1 turns.
3. **Hand** — hidden.
4. **Region** (per player, arranged in a circle) — the in-play zone. Holds units, resources,
   spell tokens, *and the player*. Attackers physically move into a neighbor's region until
   regroup; a player who entered a region can keep interacting there even after their units die.
   During battle a region contains a **formation grid**: front row + back row, unlimited
   columns. No adjacency outside formation.
5. **Bin** (per player, public) — dead un-modded units, resolved spells, discards. Mods can be
   played *from the bin*.
6. **Erased** — out of game. Erase ≠ death; Delete = bin, counts as death.
7. **Cache** — temp zone used by Glimpse (playable until end of turn "as if in your hand,
   ignoring affinity").
8. **The stack** — per active region.

Physical components the digital client absorbs: Intent cards, Initiative token, dice-as-counters,
effect trackers, "Stolen" proxies.

## 3. Resources

- 5 elements — fire(r), water(b), earth(e), wood(g), metal(m) — plus **Prismite** (wild
  starter, exchangeable for any element) and **Shard** (mana, no affinity).
- Resources are **permanents in play**: each grants 1 permanent **affinity** of its element
  (even while expended) and may be **expended for 1 mana** once per turn; refresh each turn.
- Playing a card: meet the affinity requirement (pip count of that element among your
  in-region resources) AND expend resources equal to the mana cost (generic). `total_cost` can
  be X (7 cards). Bracketed additional costs/modes resolve at declaration.
- Resource creation is the card economy: recycle a card from hand per resource created
  (unlimited), max **2 activations** per turn (dormant → active). Activating with 3+ affinity of
  that element grants a free Shard (counts toward the 2; some card-granted shards don't).

## 4. Card types & object state

Types: **Unit**, **Spell**, **Spell Unit** (spawns as a unit on resolution; if negated/fizzled
it never spawns), **Unit Token** (persists through regroup; erased on leaving play),
**Spell Token** (a castable card *in play*, region-bound, rides along with attackers, erased at
regroup), **Resource**. ~40 typal subtypes cards care about ("Your wisps gain +2/+1").

Timing icons: none = deployment only; **Haste** (15) also haste step; **Battle** (92) only
during battle with another player; **Virus** (39) also playable as an augment from hand during
battle; **Burst** (3) spell tokens must all be played at once.

**Six stat layers** (Manual Q&A p.42): 1 printed → 2 base-setting ("becomes base 5/0") →
3 stat changes (temp ±X/±X *and* +1/+1 / −1/−1 counters, which cancel pairwise) → 4 attributes
that alter stats (Tough doubles defense; Balanced; ordered by **application order**) →
5 Inverted (sign-flips layer 3) → 6 Unaware (it *and units interacting with it* ignore stat
changes — a pairwise-relative modifier).

Other state: marked damage (persists the whole battle phase, cleared at regroup); expended/
dormant; formation position; ordered mod stack; **Unstable** (any modded card → erased on
death, "permadeath" — R137: it still passes through the bin and IS trashed on the way);
control vs ownership; negative power deals 0; defense ≤ 0 dies.

## 5. Stack, priority, responses

- Full FILO stack (Manual p.28-29 has a worked 7-step example). An **Effect** = played card,
  activated ability, or triggered ability — all use the stack. **Replacement effects**
  ("If… instead") don't.
- Priority windows per region: attack step, block step, after-combat step, and after each
  resolution. Damage step has no window (Manual supersedes the 2023 rulebook here). Activated
  abilities usable during battle and deployment, unlimited.
- Order: initiative player/team first, clockwise. Teams share priority collectively. Top of
  stack resolves when all pass; step ends when all pass on an empty stack.
- Simultaneous triggers: each player orders their own; **NIT effects enter the stack last, so
  they resolve first** (Manual Q&A p.43).
- Anything on the stack can be negated — including virus augmentations. Negation targets vary:
  target effect / spell effect / all activated and triggered effects / all other effects.
- Targeting: chosen at play, region-restricted. Some targets invalid at resolution → partial
  resolution; all invalid → **fizzle** to bin (spell units never spawn).
- End-of-turn triggers: un-respondable.

## 6. Keywords

### Combat attributes (gold; **shared vertically within a formation column**, lost the moment
the sharer leaves the column — the game's combo engine)
| Attribute | Semantic | Engine category |
|---|---|---|
| Flying | only fliers block fliers | blocking restriction |
| Deadly | any damage kills | damage modifier |
| Swift | deals combat damage first | ordering (Swift+Sluggish = hits twice) |
| Sluggish | deals combat damage last | ordering |
| Tough | defense doubled | stat layer 4 |
| Balanced | power & defense = max of the two | stat layer 4 |
| Inverted | stat changes sign-flipped | stat layer 5 |
| Unaware | it + interacting units ignore stat changes | stat layer 6 |
| Powerful | deals double damage | damage replacement |
| Vulnerable | receives double damage | damage replacement |
| Feeble | can't block | restriction |
| Evasive | needs two blockers | restriction |
| Sneaky | unblockable if attacking alone | restriction |
| Alluring | target enemy can't attack, must block this column | targeted on-attack trigger + forced-block (R84) |
| Piercing | excess damage → defending player (trample) | damage assignment |
| Electric | excess damage → adjacent unit, **recursively, non-overlapping path** | damage assignment + pathfinding |
| Poisonous | damage dealt as −1/−1 counters | damage replacement |
| Resonant | damage to a unit also hits its controller | damage rider |
| Thieving | combat damage to opponent → draw | trigger |
| Reaping | kills → draw, loses reaping until regroup | trigger + per-battle self-mod |

Attributes appear on spells too ("your single-target spell effects are Electric").
Non-combat (purple, not column-shared): Burst, Unstable, timing markers.

### Named mechanics
- **Augment** (120 cards): special action (deployment; from hand or bin; pay cost+affinity;
  target a card in play) — slide under target; the pair is one card with merged text. The
  `[Augment]` symbol can prefix an ability paragraph or the type line (granting attributes).
  Augment text also works when the card is played normally. Unlimited augments per card
  (well, MAX_MODS 4 per current data).
- **Graft** `[Switch]` unbounded (24) / `[Switch1]` bounded once-per-turn (77): cause→effect
  composition — grafts add effects to the topmost card's cause, resolving top-to-bottom as ONE
  ability, negatable as one. New grafts insert anywhere below the base; existing order
  immutable. A bounded *cause* limits the whole composite.
- Mod shared rules: modded card gains Unstable → dies = card + mods **erased** (R137: via the
  bin, so card and nontoken mods are all **trashed** on the way out). Leaves play
  without dying → mods to bin, base to hand. **Controller of the unit controls its mods** —
  augmenting an enemy unit donates the text (drawback-donation is a real strategy). Grafts
  detach if graftability is lost.
- **Virus**: augment playable from *hand* during *battle* — interactive, uses the stack,
  negatable.
- **Ambush**: battle-played unit "recall target ally, take their position"; fizzles if target
  disappears (loses both).
- **Spell tokens** (Fireball X / Crystal X / Poison X): created into play, castable only in
  their region, travel with attackers, erased at regroup.
- **Unit tokens**: Wisp 0/1 Feeble "after combat, sacrifice me"; Robot 0/0 spawning with X
  +1/+1 counters (X *is* the counters); Generic X/X. Spawn outside formation.
- **Glimpse N**: reveal top N of shared deck, cache one (playable until EOT ignoring affinity),
  recycle rest.
- Event taxonomy: **Recycle** (bottom of deck, random order), **Recall** (to hand), **Delete**
  (bin, is a death), **Erase** (out of game, not a death), **Sacrifice** (own, in your current
  region, is a death), **Spawn/Despawn** (enter/leave play umbrella events).
- **Fight/Exchange**: two units hit each other for power.

## 7. Trigger/ability taxonomy from the card corpus (what the event system must support)

**Trigger events actually used** (counts from oracle-text scan):
- Combat cycle: after combat (20), when I attack or block (12+), when I attack (6+, one "in a
  formation of 4+"), when my column deals combat damage to a player (6), after blocking step (1),
  combat-damage-to-player variants (3).
- Lifecycle: when I die (10), when I despawn (9), when I spawn (5), spawn-or-die (3), whenever
  a (your/nontoken) unit dies (9+), when an ally spawns (5, with filters), **"when the second
  ally dies in this battle"** (ordinal-within-battle!), when you sacrifice (1), token created (2).
- Spell-play: whenever you play a (nontoken) spell (10), another player plays a spell (2),
  spell targeting me (1), **"a player's first spell in this battle"** (1), "the second nontoken
  spell played in this battle" (1).
- Damage/life: when I'm dealt damage (8), whenever I survive damage (3), a player loses life (2).
- Counters/mods: counters put on units (3), when modded / applied as mod (4).
- Zones: card enters a hand (3), when I become targeted (2).
- Clock: at end of turn (4+, un-respondable), at start of deployment (1). Reflexive "when you do" (1).

**Activated abilities**: `cost: effect`, any time with priority in battle/deployment. Cost
atoms: mana, sacrifice (me/another/X units), remove counters, erase a mod, recall an ally,
combinations, `[once]` per-turn limiter.

**Statics/replacements**: region-scoped stat counts ("+1/+1 for each other ally"); base-setting
("your units are base 3/3"); attribute grants; rule-overriding ("your wisps don't sacrifice");
cost taxes ("spells with base cost 3 or less cost 3 during battle"); replacement effects
(counter-doubling, token-creation doubling, Unstable's bin→erase, Poisonous damage→counters);
rule-modifiers ("your spell tokens survive regroup", "skip your draft step").

## 8. Combat

1. **Attack**: move units + spell tokens into a *neighboring* region (attacks target players,
   never units). Set an attacking formation: unlimited columns × 2 rows, front-filled first;
   spell tokens need ≥1 unit. Entering a region puts *the player* there — their hand, bin,
   resources become legal interaction subjects there.
2. Priority window.
3. **Block**: defender forms a defending formation opposite the attack — may include empty
   columns, may block empty columns (adjacency synergy), may be wider than the attack.
   **A blocked column stays blocked even if the blocker dies.**
4. Priority window.
5. **Damage — simultaneous** (Swift first / Sluggish last sub-steps): each column deals its
   combined power; unblocked columns hit the player; blocked columns and blockers hit each
   other; damage assigns front-to-back with overflow to the back row only, never the player
   (except Piercing); attacker may voluntarily over-assign to the front unit.
6. **After combat**: last window; "after combat" triggers fire (only where a battle happened).

Formation maintenance: back row advances instantly when the front dies (state-based, no
response); columns close horizontal gaps only *before* blocks. Adjacency = orthogonal in
formation only. **No summoning sickness**; mid-battle spawns are in-region but out of formation.

## 9. Hidden info & randomness

Hidden: hands; shared deck order+contents; packs (from everyone, always, except owner during
draft step); **dormant resources are face-down** (element choice is hidden info!); FFA intent
cards until simultaneous reveal; Glimpse caches. Public: bins, life, counters, formations.

Randomness: initial shuffle, pack deals, recycle order, initiative assignment. **No card in the
current set uses coins/dice.** All randomness is server-side shuffling.

## 10. Hard-case risk list (the things that will bite)

1. **Region-scoped everything** — "each player/all units/each opponent" implicitly mean *this
   region*; statics count in-region only; elsewhere-cards are nonexistent during another
   region's battle resolution. Every query and trigger listener must be region-gated.
2. **Runtime text composition** (augment/graft) — cards are *ability lists mutable at runtime*:
   ordered mod stacks, insert-never-reorder, bounded budgets, composite single-negation,
   permadeath, mods-detach-on-bounce, control-follows-base (drawback donation), copy effects
   that copy "stat changes, counters, card text and mods" (Borrower of Forms).
3. **Six stat layers** with application-order inside layer 4 and the pairwise-relative Unaware.
4. **Formation as mutable spatial state** — promotion/compaction rules differing pre/post
   block, sticky blocked flags, column-shared attributes, Electric's recursive non-overlapping
   damage pathing, Ancient One's "I have all abilities of adjacent allies" dynamic mirroring.
5. **Two-phase team battle** with counterattackers in superposition ("don't exist until phase 1
   finishes").
6. **Phase/rule-modifying cards** — Temporal Rift ("end this battle, negate all effects"),
   Worldbender (skip draft step; knows the format), Harbinger of Immolation (tokens survive
   regroup), Stasis Sentry (battle cost floor).
7. **Mid-resolution decisions/payments** — "unless its controller pays [x]", each-player-
   chooses, may-pay branches, declaration-time modes.
8. **Stack exotica** — exchange a unit for a spell *on the stack* + retarget (Hexbane
   Shiitake); copy-as-you-play (Maelstrom Charger); recall spells from the stack (Cosmic
   Reversal); mass-negation.
9. **Control & politics** — 11 control-change cards incl. forced donations; where does a
   donated unit stand? FFA "each opponent" with 3 players in one region.
10. **Shared deck as contested resource** — Glimpse/play-from-top on a *communal* deck,
    play-permission objects with expiry.
11. **Draft as a game phase** — hand↔pack merge with leave-exactly-10, passing, refresh cycles.
    (Only ONE card touches the draft — it can be a separate subsystem.)
12. **Battle-scoped memory** — "second ally death this battle", "first spell this battle",
    Reaping until regroup, per-turn graft budgets → per-battle/per-turn counters on abilities.
13. **End-of-turn no-response zone.**
14. **FFA intent commitment** — commit/reveal with deliberate bluffing support.

## Bottom line — architectural deltas vs MTG

1. N concurrent region-scoped sub-games + a serializer, not one battlefield.
2. Simultaneous phase completion + commit-reveal attacks, not turn ownership.
3. Runtime-composable card text (mods), not immutable oracle text.
4. A spatial formation grid with column-shared keywords inside combat.
5. Initiative / IT-NIT as the universal tiebreaker (replaces APNAP).
6. Damage & buffs persist a whole battle phase; clear at regroup.
7. A draft loop embedded in the turn.
8. The deck as a shared, bottom-recycled object.

The *stack/priority core*, the triggered/activated/static/replacement taxonomy, and counters
are close enough to MTG to reuse standard engine designs.
