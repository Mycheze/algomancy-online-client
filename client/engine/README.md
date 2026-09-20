# `engine/` — the rules, as a pure reducer

The implementation of record for Algomancy's rules. No I/O, no clock, no DOM:
`apply(state, action)` returns a new state, the events it produced and any
decision it is waiting on. The game server and the browser call the same
function, which is why the same client can play online, hotseat, or against
an in-page tutorial bot.

```
engine/
  src/types.ts          state, action, event and decision types
  src/engine.ts         class E: queries, primitives, triggers, the stack, combat, phases
  src/apply.ts          createGame, apply (dispatch + validation), legalActions, replay
  src/harness.ts        a stateful wrapper for tests and the hotseat rig
  src/draftdeal.ts      the numbers a deal is made from, and custom rules resolved into them
  src/lessondeal.ts     the scripted deals the tutorial uses
  src/rng.ts            mulberry32; the only entropy, and it lives inside the state
  src/cards/dsl.ts      the card-definition DSL and the effect vocabulary
  src/cards/registry.ts card(name, behaviour): joins behaviour to printed data by name
  src/cards/sets/       every card's behaviour, in batches; index.ts is APPEND-ONLY
  src/cards/printed.json    GENERATED: the printed data of every scripted card
  src/cards/catalogue.json  GENERATED: browse data for the card browser; nothing in src/ may import it
  scripts/              the build tooling: extract, gen-card, audit, paths.mjs, fetch-reports
  test/                 200 test files: rulings, one per card, conformance sweeps, the fuzzer
```

## Run it

```bash
npm install          # once: typescript, esbuild, @types/node
npm run check        # typecheck + the whole suite, about three minutes; the gate before any commit
npm test             # the suite alone: node --test test/**/*.test.ts
npm run typecheck    # tsc --noEmit, strict
npm run extract      # rebuild printed.json and catalogue.json from the oracle JSON
npm run fuzz         # random legal games, then replay each and demand a bit-identical state
npm run fuzz:par     # the same across workers, for long runs
npm run audit:cards  # every scripted card against its oracle text
```

## The shape

- **Pure reducer.** `apply` clones the input state; inside, the rules code is
  imperative over the draft (class `E`). Nothing is cached: a unit's stats are
  six layers computed on demand, and whether it is Flying right now is
  answered by scanning statics, mods, its column and any suppression at the
  moment of asking.
- **Seed plus action log is the game.** `replay(seed, actions)` folds `apply`
  from the start. The fuzz suite proves replays bit-identical, and every saved
  room on the server is exactly that pair.
- **`legalActions(state, seat)` is first-class.** It powers the UI's
  highlighting, the server's validation, the fuzzer and auto-pass. For
  formation-shaped actions it returns a representative set; `apply` validates
  any formation.
- **A decision is data, not a callback.** When a card needs a target, a
  trigger order or a mid-resolution payment, the engine pauses as
  `state.decision` and `state.suspension` and returns. The answer arrives as
  an ordinary action; the resolving part rolls back to its boundary and
  re-runs with the answer filled in. The RNG rolls back with it, so replay
  stays deterministic.
- **Events are the log.** Every `EngineEvent` carries a rendered sentence.
  The transparency a paper game gets from table talk comes from the rules
  code itself.

## How a card is made

A card is two halves joined by its name.

1. **Printed data is never typed by hand.** `npm run extract` pulls cost,
   stats, kind, timing, attributes, burst, ambush and the text out of
   `data/cards/AlgomancyCards-OracleText.json` into `printed.json`. A wrong
   field is fixed in the oracle file with the reason in the commit, and the
   build is rerun.
2. **Behaviour is written.** A card's rules live in one of the
   `src/cards/sets/batch-*.ts` files, in a small DSL: targets, cast costs,
   `run`, triggers, statics, replacements, projections, restrictions.
3. **Registration joins them.** `card(name, behaviour)` looks the name up in
   `printed.json` and refuses a duplicate or a stranger. Import order in
   `sets/index.ts` is registration order is deck order, which feeds the
   seeded shuffle, so that file is append-only and
   `test/150-registration-order.test.ts` enforces it.
4. **The test is the definition of done.** Every card has one. `scripts/gen-card.mjs
   "Card Name"` validates the name against the oracle, grows
   `scripts/pool.mjs`, re-extracts, and emits a DSL skeleton and a test stub.

The pool is 492 cards, the base set and the Light & Dark expansion, and no
card is parked: `../ledgers/card-ledger.ts`, which would declare clauses that
do nothing, is empty, and `test/71-card-ledger.test.ts` proves it both ways.
A gap that cannot be built yet is a ticket in `../ledgers/card-todo.ts`, never
a `todo` test, because a test that cannot fail tracks nothing.

## The ruling register

`../docs/digital-rules.md` is this package's specification. Every place the
paper rules were silent or ambiguous, the engine had to decide, and each
decision is a numbered ruling with its source (the Manual, a designer answer
on Discord, the owner) and the test that encodes it.
`test/184-ruling-register.test.ts` checks the register against the code, and
`test/238-question-sheets.test.ts` checks every answer the owner has given
against it.

Still approximated, on the record:

- A true power/defense **switch** is done as a delta off the effective stats
  at resolution (R66). Parked on a ruling, not a primitive: the Manual's six
  stat layers have no switch in them.
- Combat damage is auto-assigned lethal front to back; voluntary
  over-assignment (R7) has no observable effect in this pool.
- Burst tokens cast in deterministic id order rather than player-chosen order.

## What the suite is

Two hundred files, about two and a half minutes. Rulings (`05-rulings.test.ts` and
the numbered files after it), one file per card batch, and the **conformance
sweeps**: whole-pool tests that parse the set files and refuse a card whose
text names a target it never declares, a clause that does nothing, or an
exported helper nothing uses.
`test/util.ts` and `test/drill.ts` are the harnesses; `test/fuzz.ts` is the
random-game generator the server's account tests borrow.

The browser client's tests are in `../ui/test/` and the server's in
`../server/test/` and `../server/e2e/`; this directory holds only the
engine's.
