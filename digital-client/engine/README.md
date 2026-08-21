# Engine — M1 core (pure TypeScript reducer)

The real engine (docs/04 architecture), replacing `../prototype/` as the
implementation of record. The prototype stays as a reference artifact.

## Run it

```bash
npm install          # once (dev deps: typescript, esbuild, @types/node)
npm test             # full suite: ported prototype tests, rulings R1-R12,
                     #   per-card tests, 40-game fuzz + replay determinism
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

A handful of cards are deliberately **parked** rather than half-scripted: each
registers crash-free with its printed body and carries a `{ todo: true }` test
naming exactly the primitive it is waiting on. `npm test` reports them as todo,
so the count is the backlog.

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

- Stat layers 5-6 (Inverted/Unaware) — the seam is in `effStats`, no pool card
  needs them; R10 is a `todo` test. (Layers 1-4 are all live: layer 2, base
  stats, arrived with Formless and Body Swap.)
- Combat damage split is auto-assigned lethal front-to-back; voluntary
  over-assignment (R7) has no observable effect in this pool.
- Burst tokens cast in deterministic id order rather than player-chosen order.
- Naming a card as a decision (The Everywhere's "During [Haste] name a card").
  Attribute/ability **suppression** was on this list and is not any more —
  it is a real layer now (R62), which took Monke, Suppression Field,
  Transmogrifant and Formless's second clause off it. So was `{Pure}`, which
  turned out to need one interaction's worth of scoping rather than a layer
  (R61), and granting rules text (R63, Reforge the Dead).
- A *consumable* cost modifier (Deferral Drone). The continuous one is done in
  both currencies: mana (R59) and life (R60).

Shipped since this list was written, and no longer cut: **shards**
(free-shard-at-3-affinity, Manual p.18) and the **live draft** (Manual
p.16-17 — `mode: 'draft'`, per-player packs that pass).

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
