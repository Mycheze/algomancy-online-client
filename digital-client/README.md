# Digital Algomancy client — research & prototype

Subproject exploring an online, rules-enforced Algomancy client ("our favorite spreadsheet
simulator", MTGO-style: correctness over animations). Kept separate from the bot code.

Research pass done **2026-07-16**: repo reuse audit, full mechanics inventory from the rules
corpus, survey of how real digital TCGs are engineered, a proposed architecture, the open
hard questions, a roadmap — and a playable hotseat prototype with 15 real cards.

## Read in this order

| doc | what |
|---|---|
| [docs/01-existing-assets.md](docs/01-existing-assets.md) | what the bot project already gives us (a lot: card DB, `wtp.py` state model, board renderer, icons, draft, mods logic) |
| [docs/02-how-others-did-it.md](docs/02-how-others-did-it.md) | MTGO/Arena, Forge, XMage, Hearthstone sims, Cockatrice, boardgame.io, Argentum — patterns + effort data |
| [docs/03-mechanics-inventory.md](docs/03-mechanics-inventory.md) | the complete Algomancy mechanics surface an engine must implement, incl. the 8 architectural deltas vs MTG |
| [docs/04-architecture-spec.md](docs/04-architecture-spec.md) | proposed design: pure TS engine, state model, events/triggers/stack, card DSL, server, client |
| [docs/05-hard-questions.md](docs/05-hard-questions.md) | rules gaps needing adjudication, product decisions (Bena's call), risk list |
| [docs/06-roadmap.md](docs/06-roadmap.md) | M0 shared tabletop → M1 engine core → M2 enforced client → M3 card burn-down → M4 full game |

## The engine (M1, started 2026-07-16)

**[engine/](engine/README.md)** is the real implementation: a pure TypeScript reducer with
`legalActions()`, seeded-RNG action-log replay, real regions, proper graft composition,
22 scripted cards, rulings R1-R12 as tests, a fuzzer, and the hotseat UI rebuilt on top
(`npm test` · `npm run build:ui` → open `engine/ui/index.html`, `?demo` for a mid-battle).

## Try the old prototype

Open **[prototype/index.html](prototype/index.html)** in a browser (no build, no server;
`?demo` jumps into a mid-battle with a spell on the stack). `node prototype/test.js` runs
the 56 engine tests. See [prototype/README.md](prototype/README.md) for what's real vs cut.
It's the reference artifact the engine was rebuilt from — superseded by `engine/`.

## The one-paragraph verdict

Very doable as a hobby project in 2026, and this repo is unusually well positioned (card DB,
rules corpus, board renderer, and a rulings pipeline already exist). The real work is not
code: it's writing the "digital comprehensive rules" — Algomancy's paper rules leave gaps
(trigger ordering, fizzle details, region edge cases) that an engine forces answers to. The
recommended path is hybrid: ship a Cockatrice-style manual tabletop on an engine-shaped data
model in weeks, then grow rules enforcement inside it, scripting the 370 cards as an
LLM-drafted, human-reviewed, per-card-tested burn-down. Biggest Algomancy-specific engine
problems: runtime card composition (augment/graft), region scoping, the formation grid with
column-shared attributes, and simultaneous-commitment steps.
