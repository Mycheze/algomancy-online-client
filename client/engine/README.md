# Engine — M1 core (pure TypeScript reducer)

The real engine (docs/04 architecture) and the implementation of record. It
replaced the pre-engine JavaScript `prototype/`, which was removed from the tree
in 2026-08 — `git log -- client/prototype` still has every version.

⚠ This package is not only the engine. `src/` is the pure reducer, `test/` is the
suite, `scripts/` is the build tooling — and `ui/` is the entire browser client
(~26k lines), which the game server serves from here.

## Run it

```bash
npm install          # once (dev deps: typescript, esbuild, @types/node)
npm test             # full suite: rulings, per-card tests, conformance sweeps,
                     #   40-game fuzz + replay determinism (~142s — background it)
npm run typecheck    # tsc --noEmit (strict)
npm run fuzz         # standalone fuzzer: node test/fuzz-run.ts [games] [maxActions]
npm run extract      # re-pull printed card data from AlgomancyCards-OracleText.json
npm run build:ui     # bundle the hotseat UI → ui/bundle.js
npm run fuzz:par     # parallel fuzzer: node test/fuzz-parallel.ts [games] [workers]
npm run check        # the gate before any commit: typecheck + test + build:ui
```

Scripting a new card (the M3 burn-down pipeline):

```bash
node scripts/gen-card.mjs "Card Name" ...   # validates against the oracle JSON,
                                            # grows scripts/pool.mjs, re-extracts
                                            # printed.json, emits a DSL skeleton +
                                            # test stub per card (all TODO-marked)
```

Then finish the skeleton in `src/cards/registry.ts`, make the test stub real
(a test per card = definition of done), add nontoken cards to `DECK_LIST`,
and `npm run check`.

Hotseat game: open **ui/index.html** in a browser after `build:ui`
(`?demo` jumps into a mid-battle with a spell on the stack).

The UI's visual-clarification layer — cards that visibly travel between zones,
and arrows from an effect to its targets — is `ui/motion.ts` (pure state diff,
tested in `test/51-ui-motion.test.ts`) plus `ui/anim.ts` (FLIP, ghost flights,
the SVG arrow overlay). See [../docs/09-visual-clarification.md](../docs/09-visual-clarification.md);
the `✨ motion` button in the side panel turns it all off.

**What a card's text box says right now** is its own layer, and the biggest
one: printed text is the card's history, not its rules. `ui/cardtext.ts` (pure,
tested in `test/57-ui-cardtext.test.ts`) composes the live box out of queries
the rules themselves run — the printed clause, each mod's donated clause, a
graft composite rendered as the single ability it is (Manual p.33), text
granted until regroup (R63), what other cards are projecting onto it, which
halves are switched off and by whom (R62), and stat arithmetic that reconciles
to `effStats` term by term. `textBoxHtml()` in `ui/main.ts` renders it, and
three surfaces show the same markup: the side-rail focus viewer, a long-hover
box that comes to the cursor after half a second, and the card inspector.
See [../docs/12-card-text.md](../docs/12-card-text.md).

The battle panel's column arithmetic is split out the same way:
`ui/formation.ts` (what to publish to the opponent while you build a formation,
and how many rows each half of the battle line must reserve — tested in
`test/55-ui-formation.test.ts`). Both halves of it are index arithmetic that a
screenshot cannot check.

The stack itself is on the table rather than in the side rail: `ui/flash.ts`
(pure — which items are on the VISUAL stack right now, tested in
`test/56-ui-flash.test.ts`) plus `stackBoardHtml()` in `ui/main.ts`. It draws
the real stack as overlapping card scans, and mixes in the items that resolve
with no response window (haste, deployment, triggers between combat sub-steps)
so they get a beat on the stack instead of happening invisibly. The engine
announces those as a silent, rules-inert `stackFlash` event. See
[../docs/11-stack-on-the-table.md](../docs/11-stack-on-the-table.md); the
`✨ motion` button turns the beat off with everything else.

The sound layer follows the same split: `ui/sfx.ts` (pure state diff → at most
one cue, tested in `test/54-ui-sfx.test.ts`) plus `ui/audio.ts` (WebAudio
playback, the mix, and the idle timer). Samples are CC0 from Kenney's Interface
Sounds pack, one `.ogg` per cue in `ui/sfx/` — replace a file to change how a
cue sounds, edit `GAIN` in `ui/audio.ts` to change how loud it is. The
`🔊 sound` button in the side panel turns it all off (remembered per browser).
See [../docs/10-sound.md](../docs/10-sound.md).

## Shape (docs/04 §1, delivered)

- **Pure reducer**: `apply(state, action) → { state, events, pendingDecisions }`.
  No I/O, no clock; RNG state lives in `GameState.rngState`. `apply` clones the
  input state; internally the rules code is imperative over the draft (class `E`).
- **Replay = seed + action log**: `replay(seed, actions)`; the fuzz suite proves
  bit-identical replays.
- **`legalActions(state, seat)`** is first-class: powers the UI highlighting,
  the fuzzer, and auto-pass. For formation-shaped actions (attack/block
  declarations) it returns a representative set, not an exhaustive one; `apply`
  validates arbitrary formations.
- **Decision-point model**: the engine pauses as pure data
  (`state.decision` + `state.suspension`) for targets, trigger ordering (R2),
  electric paths (R4) and mid-resolution payments (R6). Mid-part choices use
  replay-suspension: the part rolls back to its boundary and re-runs with the
  answer filled in — deterministic because the RNG state rolls back too.
- **Events double as the game log**: every `EngineEvent` carries a rendered
  message (rules transparency is a product feature).

## What's implemented

Phases (planning → battle → regroup → deployment → EOT), resources as
permanents (dormant/open/expended, affinity, 2 activations; Prismites start
dormant, give no affinity, and exchange into any element during planning — R17),
**real regions** (attackers physically move, targeting and triggers are
region-scoped — R12), the FILO stack with priority windows, negation, fizzle
vs partial resolution (R5), triggered abilities with event-time conditions
(R1), owner-ordered simultaneous triggers with NIT-resolves-first (R2),
column combat with shared attributes (Flying/Evasive/Piercing/Swift/Sluggish/
Electric/Reaping), Swift/Sluggish damage sub-steps with no priority between
(R3), the 1v1 **counterattack rule** (NIT sends units at block time; they
"don't exist" until round 2), Burst tokens, spell tokens riding with
attackers, and the full mods system:

- **Augments**: type-line `[Augment]` transfers attributes, text-box
  `[Augment]` transfers text only (matches mods.py; the prototype wrongly
  donated attrs from the text-box case).
- **Virus**: augments from hand during battle, on the stack, negatable,
  drawback donation works.
- **Grafts** (properly, unlike the prototype): cause→effect composition per
  Manual p.32-33 and the "Graft 101" Discord ruling — both cards need the
  symbol, host needs its own cause, composite fires as ONE stack item
  resolving top-to-bottom, single negation kills all of it, new grafts insert
  anywhere below the base and never reorder, bounded cause bounds the whole
  composite, bounded effects skip per-card per-turn (R9), grafting is
  targeting, from hand or bin.

Card pool: **493 registered** — 483 in `DECK_LIST` plus 10 tokens — grown in
waves, each batch its own append-only module so parallel scripting never
collides:

| wave | where | what it brought |
|---|---|---|
| prototype 15 + graft/rulings | `src/cards/registry.ts` (34) | the base pool |
| mechanics batch 2 | same file | stat layer 4 (Tough/Balanced, R19), Deadly (R21), Sneaky (R20), Feeble, the planning haste step (R18), "dealt damage" triggers, Robot/Wisp tokens, Ambush (R22) |
| attributes | `sets/batch-attrs.ts` | Powerful, Vulnerable, Poisonous, Resonant, Thieving (R23-R24) + Poison/Crystal counter tokens |
| water/metal, fire/wood | `sets/batch-water-metal.ts`, `batch-fire-wood.ts` | despawn/lifeLost/spellPlayed triggers, counter manipulation, donated activated abilities (R25-R27) |
| the five base elements | `sets/batch-{fire,water,earth,wood,metal}-{a,b,c}.ts` | the mono-element bulk |
| base hybrids | `sets/batch-hybrids-fwe.ts`, `batch-hybrids-wm-{a,b}.ts` | two-element cards |
| **Light & Dark** | `sets/batch-{light,dark}-{a,b,c}.ts`, `batch-hybrids-ld-{a,b,c}.ts` | the expansion — see [../docs/08-light-and-dark.md](../docs/08-light-and-dark.md) |

**No card is parked.** `CARD_LEDGER` (`test/card-ledger.ts`), which declares
card by card which printed clauses do nothing, is empty, and
`71-card-ledger.test.ts` proves that in both directions on every run.

This used to read "a handful of cards are deliberately parked … each carries a
`{ todo: true }` test naming the primitive it is waiting on, so the count is the
backlog". That was the practice that let Harbinger of Immolation's second half
stay dead for two days behind a green suite: **a `{ todo: true }` test can never
fail**, so it tracks nothing. The count of them in `test/` is now zero and
`90-coverage-census.test.ts` asserts it stays there (R155). A gap that genuinely
cannot be built yet goes in `test/card-ledger.ts` (a dead card half) or
`test/card-todo.ts` (anything else) — both are checked against reality.

Printed data is generated from `AlgomancyCards-OracleText.json` by
`scripts/extract-printed.mjs` (pool list in `scripts/pool.mjs`) — only
behavior is hand-authored. `DECK_LIST` is computed from the registry in
registration order (deck order feeds the seeded shuffle: batch modules in
`src/cards/sets/index.ts` are append-only, never reorder).

**Online play (M2 slice)** lives in `../server/`: WebSocket server with room
codes, server-authoritative apply, per-seat redacted views, reconnect; the
hotseat UI doubles as the network client (`?ws=1&room=CODE&seat=0`). See
`../server/README.md`.

## Still cut (parked, not forgotten)

- A true power/defense SWITCH (Invasive Reassignment) — done as a delta off the
  effective stats at resolution, which is right until something changes the two
  numbers asymmetrically afterwards. The last approximation in the stat layers
  (R66). Parked on a RULING, not on a primitive: the Manual's six layers have
  no switch in them ({Inverted} is a sign-flip, not a swap), so where it sits
  is an open question rather than something to guess.
- Combat damage split is auto-assigned lethal front-to-back; voluntary
  over-assignment (R7) has no observable effect in this pool.
- Burst tokens cast in deterministic id order rather than player-chosen order.
  (WHICH tokens go together is exact as of R81: same name, not merely both
  Burst.)
Attribute/ability **suppression** was on this list and is not any more — it is
a real layer now (R62), which took Monke, Suppression Field, Transmogrifant and
Formless's second clause off it. So was `{Pure}`, which turned out to need one
interaction's worth of scoping rather than a layer (R61), and granting rules
text (R63, Reforge the Dead). And so were **targeting restrictions** (R64:
`TargetSpec.restrict`, which also took Gatekeeper of Souls off the parked list)
and the wider **cast-time cost** kinds (R64: `sacrificeUnits` /
`removeCounters` / `eraseBin`, and `n: 'X'` for all of them). R67 then spent
those seams: eleven cards that printed "target" but re-derived it mid-resolution
now declare it and are aimed in the cast window, and `what: 'player'` /
`TargetCtx.event` were added for the last two of them.

Shipped since this list was written, and no longer cut: **shards**
(free-shard-at-3-affinity, Manual p.18) and the **live draft** (Manual
p.16-17 — `mode: 'draft'`, per-player packs that pass). Three more came off it
on 2026-08-25, having shipped without the list being updated — the rot R155
swept up:

- **Stat layers 5 and 6.** Layer 5, `{Inverted}` (R93), negates the NET stat
  change from base — `2·base − current`, applied once after layer 4
  (`src/engine.ts`, `effStats`). Layer 6, `{Unaware}` (R106), reads at PRINTED
  stats and drops everything above layer 1. All six layers are live; R10 is a
  real passing test (`test/05-rulings.test.ts`), not a todo, and the layers
  have their own files in `test/79-round17-layers.test.ts`,
  `test/92-unaware.test.ts` and `test/43-dark-c.test.ts`.
- **Naming a card as a decision** — R91. `Entity.named` (`src/types.ts`) holds
  the memory; The Everywhere is built on it, with the region rule intact.
- **A *consumable* cost modifier** — R119. `GameState.nextPlayDiscount` is a
  per-seat charge set by Deferral Drone, read in `E.manaToPlay` and spent at
  the two sites a play already emits from. Both continuous currencies were
  already done: mana (R59) and life (R60).

## Files

| path | what |
|---|---|
| `src/types.ts` | state / action / event / decision types |
| `src/engine.ts` | class `E`: queries, primitives, triggers, stack, combat, phases |
| `src/apply.ts` | `createGame`, `apply` dispatch + validation, `legalActions`, `replay` |
| `src/cards/dsl.ts` | card-definition DSL + registry + effect keys |
| `src/cards/registry.ts` | the base 34 cards (behavior only) |
| `src/cards/sets/*.ts` | every later batch; `sets/index.ts` is append-only |
| `src/cards/printed.json` | generated printed data — do not edit |
| `src/harness.ts` | stateful wrapper for tests/UI (accumulates log + action log) |
| `scripts/gen-card.mjs` | card-scripting pipeline: oracle → skeleton + test stub |
| `scripts/pool.mjs` | the pool list (grown by gen-card.mjs) |
| `test/` | suites 01-08 + fuzz (`node --test 'test/**/*.test.ts'`) |
| `test/fuzz-parallel.ts` | multi-process fuzz runner for big runs |
| `ui/cardtext.ts` | the card-text engine: a card's text box as the game sees it |
| `ui/` | hotseat browser client (esbuild bundle) |
