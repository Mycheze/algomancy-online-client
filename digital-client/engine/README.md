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

Card pool: **64** (59 deck cards + 5 tokens), grown in waves:
- prototype 15 + graft/rulings additions (registry.ts)
- mechanics batch 2 (registry.ts): stat layer 4 (Tough/Balanced — R19),
  Deadly (R21), Sneaky (R20), Feeble, the planning haste step (R18),
  "dealt damage" triggers, Robot/Wisp tokens, the Ambush mode (R22)
- attribute batch (`src/cards/sets/batch-attrs.ts`): **Powerful, Vulnerable,
  Poisonous, Resonant, Thieving** (R23-R24) + Poison/Crystal counter tokens
- water/metal + fire/wood batches (`src/cards/sets/batch-*.ts`): 20 more
  cards — despawn/lifeLost/spellPlayed triggers, counter manipulation,
  donated activated abilities (R25-R27)

Printed data is generated from `AlgomancyCards-OracleText.json` by
`scripts/extract-printed.mjs` (pool list in `scripts/pool.mjs`) — only
behavior is hand-authored. `DECK_LIST` is computed from the registry in
registration order (deck order feeds the seeded shuffle: batch modules in
`src/cards/sets/index.ts` are append-only, never reorder).

**Online play (M2 slice)** lives in `../server/`: WebSocket server with room
codes, server-authoritative apply, per-seat redacted views, reconnect; the
hotseat UI doubles as the network client (`?ws=1&room=CODE&seat=0`). See
`../server/README.md`.

## Deliberate M1 cuts (parked, not forgotten)

- Stat layers 5-6 (Inverted/Unaware) — seams exist in `effStats`, no pool
  card needs them; R10 is a `todo` test.
- Combat damage split is auto-assigned lethal front-to-back; voluntary
  over-assignment (R7) has no observable effect in this pool.
- Burst tokens cast in deterministic id order rather than player-chosen order.
- Shard resources / free-shard-at-3-affinity.
- No draft (shared deck, draw 2 — per roadmap, draft is M4).

## Files

| path | what |
|---|---|
| `src/types.ts` | state / action / event / decision types |
| `src/engine.ts` | class `E`: queries, primitives, triggers, stack, combat, phases |
| `src/apply.ts` | `createGame`, `apply` dispatch + validation, `legalActions`, `replay` |
| `src/cards/dsl.ts` | card-definition DSL + registry + effect keys |
| `src/cards/registry.ts` | the 34-card pool (behavior only) |
| `src/cards/printed.json` | generated printed data — do not edit |
| `src/harness.ts` | stateful wrapper for tests/UI (accumulates log + action log) |
| `scripts/gen-card.mjs` | card-scripting pipeline: oracle → skeleton + test stub |
| `scripts/pool.mjs` | the pool list (grown by gen-card.mjs) |
| `test/` | suites 01-08 + fuzz (`node --test 'test/**/*.test.ts'`) |
| `test/fuzz-parallel.ts` | multi-process fuzz runner for big runs |
| `ui/` | hotseat browser client (esbuild bundle) |
