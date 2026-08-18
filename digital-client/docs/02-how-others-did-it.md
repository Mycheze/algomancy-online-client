# 02 — How real digital card games are built

Survey of reference implementations and the architecture patterns they converge on.
(Sources linked at the bottom; this is condensed from a web research pass, 2026-07-16.)

## The reference implementations

### MTG Arena — the GRE
Arena's rules engine is C++ plus CLIPS (a declarative rules language). The core engine knows
*only* the general rules — priority, turn structure, casting, damage, state-based actions —
and **nothing about any individual card**. Card behavior is generated CLIPS rules, machine-
translated from oracle text by a Python "Game Rules Parser" (~80% of new cards just work).
Cards compose because they never call each other: each reacts to shared state/event facts.

**Transferable idea:** not the NLP parsing (needs WotC-scale templating discipline and a team) —
the *separation*. Small core owning turn structure + state checks; card logic as declarative
data reacting to events. Modern substitute for their parser: an LLM-assisted "card text → our
DSL" pipeline with human review — which we are unusually well set up for, given the bot project.

### Forge — data-driven DSL (30,000 cards)
One text file per card, key:value lines composing parameterized effect primitives:
```
A:SP$ DealDamage | ValidTgts$ Any | TgtPrompt$ Select any target | NumDmg$ 3
```
Pros: card authoring without compiling; non-programmers contribute; lintable in bulk.
Cons: 15 years of organic growth → hundreds of stringly-typed parameters, no schema, SVar
spaghetti on complex cards; weird cards still require engine changes.

### XMage — code-per-card (Java class per card)
Full language power, type-checked. Cons: massive boilerplate, consistency drift, and
copy-paste bugs as the signature failure mode (a PVS-Studio static-analysis pass found piles).

### Hearthstone community sims — the nicest hobby-scale pattern
- **Fireplace** (Python): entities are dicts of tags; cards are declarative class bodies
  composing primitives: `play = Damage(TARGET, 3), Draw(CONTROLLER)`. Selectors compose
  algebraically. Internal DSL in a real language = DSL ergonomics + escape hatch.
- **SabberStone** (C#): key refinement — cards never mutate other entities; they attach
  **Enchantment entities** carrying effects ("+2 ATK"). Removing the enchantment removes the
  effect. Durations, source-death cleanup, copies all become entity lifecycle. This is exactly
  the model for Algomancy counters/modifiers.

### Legends of Runeterra — engine/script split at studio scale
C# engine + Python card scripts. Once the scripting layer matured, the card team went from
2 designers/4 engineers to ~15 designers/3 engineers. Lesson: investment in the card-authoring
layer is what scales card production.

### Cockatrice / untap.in / TTS — the no-rules-engine approach
Server owns zones, positions, counters, life, and the RNG (server-side shuffle so nobody stacks
a deck) but enforces **zero rules** — players push cards around like paper over webcam.
Legitimate v1: "play Algomancy online" at ~5-10% of the engine effort. Crucially, the shared-
tabletop substrate (zones, server-authoritative hidden state) is the *same substrate* a rules
engine later sits on — not throwaway if the state model is designed first.

### boardgame.io
Gives: reducer-style moves, phases/stages (including **multiple simultaneously-active
players** — maps to Algomancy's simultaneous turns), WebSocket sync, lobbies, per-player
`playerView` redaction. Doesn't give: stack, triggers, continuous effects, targeting — all the
hard parts. Project is in maintenance mode. Serious TCG projects build the engine as a pure
standalone library and write a thin WebSocket wrapper (~a weekend).

### Argentum — the datapoint that matters most
Solo dev + Claude Code: an MTG rules engine + browser client, ~41k lines Kotlin + 12k TS, in
**~1.5 weeks** (his own no-AI estimate: 6+ months). Architecture: pure immutable-state engine,
base-state vs projected-state for continuous effects, data-driven card DSL over effect
primitives, dumb-terminal React client, information filtering in the server layer. This is
almost exactly our project, one year early, and the architecture to copy.

## The patterns everyone converges on

1. **Authoritative server, command/event model.** Clients send small intents ("play card #142
   targeting #17"); the server validates, applies, and broadcasts *redacted* views. If a client
   ever holds the opponent's hand or deck order, it's cheatable with devtools.

2. **Deterministic reducer + action log.** `newState = apply(state, action)`, pure, seeded RNG
   injected. Buys replay (seed + log = whole game in KB), reconnect (send fresh snapshot),
   undo/takebacks, testing, and **fuzzing** — random legal actions for millions of games is the
   single highest-leverage QA technique for a solo dev. Retrofitting determinism later is
   brutal; it's nearly free on day one.

3. **Base state + projection for continuous effects.** Never mutate stats in place. Store base
   values + a list of modifier entities (source, target, duration, effect); compute effective
   values through a projection function with a defined ordering. MTG needs 7 layers; Algomancy
   likely needs 2-3 ordering categories. Only the projection function reads modifiers.

4. **Typed event bus for triggers.** Engine emits events (`UnitDied`, `DamageDealt`,
   `PhaseStarted`…); cards register declarative listeners (event + filter + effect) on entering
   a zone, deregister on leaving. Simultaneous triggers collect into a pending set, ordered by
   a deterministic rule. Evaluate trigger filters against state *at event time* — the paper
   rules are probably silent on this; our digital spec must not be.

5. **Stack as explicit data.** `StackItem { source, controller, effect, targets, choices }`,
   visible in the UI. Targets locked at cast; re-validated at resolution (fizzle rules must be
   specced exactly).

6. **Priority UX is a day-one design concern.** MTGO: stops + F-keys (F6 yield turn, F8
   auto-pass when no action). Arena: server computes each player's legal action set at every
   decision point and auto-passes when it's empty. All of it requires server-computed legal
   actions — which also powers click-to-act UI. For simultaneous turns this becomes: only open
   a response window when someone *can* respond; auto-commit players with no options.

7. **Simultaneous turns = commitment windows.** Server opens a window ("choose attackers"),
   each client submits secretly, server tells others only "opponent committed", reveals when
   all are in (or a timer defaults), merges in a defined deterministic order, resolves. No
   cryptography needed — the server is the trusted party. Spec explicitly: merge order on
   conflicts, and timers so an AFK player can't hang the game.

## Card registry verdict

| Approach | Verdict |
|---|---|
| Code-per-card (XMage) | Proven but boilerplate-heavy; copy-paste bugs |
| Pure data DSL (Forge/Arena) | Scales authoring; DSL accretes parameters forever |
| **Hybrid: internal DSL + escape hatch** (Fireplace, SabberStone, LoR, Argentum) | **Where everyone modern lands** |

For Algomancy: declarative card definitions in the engine language composing a primitive
library (`damage()`, `draw()`, `attachModifier()`, trigger/selector combinators), with any card
allowed a raw `(state, ctx) => events` function when genuinely weird. Printed rules text stored
adjacent to each definition so review = compare text to code.

**Effort for ~370 cards** (far more regular than Magic — one designer, consistent templating):
- Primitive library: ~40-80 effects + ~15 trigger types + ~20 selectors; 2-4 weeks of
  AI-assisted evenings, grown incrementally as real cards need them (never speculatively).
- Cards: ~50% trivial / 40% typical / 10% weird → 150-250h unassisted; with LLM bulk-drafting
  into the DSL + human review + per-card tests, plausibly **60-100h**, grindy but parallelizable.

## Effort estimates & failure modes

| Milestone | AI-assisted estimate |
|---|---|
| M0 — rules-free shared tabletop (Cockatrice-style), all 370 cards as data+images | 2-6 weeks |
| M1 — engine core (reducer, phases, stack, triggers, modifiers, legal actions, fuzz harness, ~20 cards) | 4-8 weeks |
| M2 — client on engine (highlighting, targeting, prompts, auto-pass, reconnect, spectate) | 3-5 weeks |
| M3 — card burn-down to 370 with per-card tests | 6-12 weeks |
| M4 — accounts, lobby, replay viewer, draft mode | open-ended |

Hidden cost specific to us: **Algomancy's rules have gaps a digital implementation will
expose** (trigger ordering, simultaneous-conflict resolution, exact fizzle rules). Writing the
"digital comprehensive rules" is design work that must be done by a human who knows the game —
and the RAG corpus is the mine for it.

Failure modes to guard against:
1. Rules-engine rabbit hole (generalizing for cards that don't exist — keep a weird-card
   parking lot and ship without them).
2. Card-backlog death march (antidote: LLM-draft pipeline + per-card test as definition of
   done + play with partial pools).
3. Pretty client first (placeholder UI until the engine is trustworthy).
4. 90/90 rule — edge cases and disconnects take as long as everything else; fuzzing is the defense.

**Recommended sequencing (hybrid):** build the M0 tabletop, but on the engine-shaped data model
(zones, entities, redacted server state, action log). Ship it rules-free so games happen
immediately; then grow enforcement *inside* the same substrate — legality checks, then
automated turn structure, then stack/triggers — promoting cards from "manual" to "scripted"
in batches. Many small shippable increments beats one big-bang engine.

## Sources
- MTG Arena GRE: https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough
- Argentum (MTG engine in 2 weeks w/ Claude Code): https://wingedsheep.com/building-argentum-a-magic-the-gathering-rules-engine/ · https://github.com/wingedsheep/argentum-engine
- Forge card scripting: https://github.com/Card-Forge/forge/wiki/Card-scripting-API
- XMage: https://github.com/magefree/mage · PVS-Studio analysis: https://pvs-studio.com/en/blog/posts/java/0758/
- Fireplace card API: https://github.com/jleclanche/fireplace/wiki/1:-The-Fireplace-Card-API
- SabberStone model: https://github.com/HearthSim/SabberStone/wiki/Model
- LoR designer tooling: https://technology.riotgames.com/news/engineering-tools-designers-legends-runeterra
- Cockatrice rules-enforcement refusal: https://github.com/Cockatrice/Cockatrice/issues/1679
- boardgame.io secret state: https://github.com/boardgameio/boardgame.io/blob/main/docs/documentation/secret-state.md
- Event-driven poker platform: https://monadical.com/posts/event-driven-architecture-1.html
- MTGO priority UX: https://www.mtgotraders.com/articles/mtgotipsandtricks.html
- Simultaneous action selection: https://en.wikipedia.org/wiki/Simultaneous_action_selection
