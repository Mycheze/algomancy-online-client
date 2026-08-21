# Digital Algomancy client

Subproject exploring an online, rules-enforced Algomancy client ("our favorite spreadsheet
simulator", MTGO-style: correctness over animations). Kept separate from the bot code.

Research pass done **2026-07-16**: repo reuse audit, full mechanics inventory from the rules
corpus, survey of how real digital TCGs are engineered, a proposed architecture, the open
hard questions, a roadmap — and a playable hotseat prototype with 15 real cards.

Since then it stopped being research. As of **2026-08-20** two people play enforced
1v1 games over the network, in draft or constructed, with 493 scripted cards and the
Light & Dark expansion in — and the bug reports in this repo's history come from those
games rather than from reading the rulebook.

## Read in this order

| doc | what |
|---|---|
| [docs/01-existing-assets.md](docs/01-existing-assets.md) | what the bot project already gives us (a lot: card DB, `wtp.py` state model, board renderer, icons, draft, mods logic) |
| [docs/02-how-others-did-it.md](docs/02-how-others-did-it.md) | MTGO/Arena, Forge, XMage, Hearthstone sims, Cockatrice, boardgame.io, Argentum — patterns + effort data |
| [docs/03-mechanics-inventory.md](docs/03-mechanics-inventory.md) | the complete Algomancy mechanics surface an engine must implement, incl. the 8 architectural deltas vs MTG |
| [docs/04-architecture-spec.md](docs/04-architecture-spec.md) | proposed design: pure TS engine, state model, events/triggers/stack, card DSL, server, client |
| [docs/05-hard-questions.md](docs/05-hard-questions.md) | rules gaps needing adjudication, product decisions (Bena's call), risk list |
| [docs/06-roadmap.md](docs/06-roadmap.md) | M0 shared tabletop → M1 engine core → M2 enforced client → M3 card burn-down → M4 full game |
| [docs/07-visual-redesign.md](docs/07-visual-redesign.md) | the "MTGO-grade" client spec: board layout, per-phase focus layouts, interaction model |
| [docs/08-light-and-dark.md](docs/08-light-and-dark.md) | the Light & Dark expansion: new attributes and mechanics, and what is still parked |
| [docs/09-visual-clarification.md](docs/09-visual-clarification.md) | card-motion animations + targeting arrows: why a state-census diff rather than an event feed |
| [docs/10-sound.md](docs/10-sound.md) | phase/priority cues and the idle thump: the one-cue rule, and staying silent on a resync |
| [docs/digital-rules.md](docs/digital-rules.md) | **the digital comprehensive rules** — R1-R61, every adjudication the engine forced, with its source |

## The engine

**[engine/](engine/README.md)** is the implementation of record: a pure TypeScript reducer
with `legalActions()`, seeded-RNG action-log replay, real regions, proper graft composition,
**493 scripted cards**, the rules R1-R61 encoded as tests, a fuzzer, and the browser client
built on top. `npm run check` is the gate (typecheck + ~1000 tests + bundle); `npm run
build:ui` then opening `engine/ui/index.html` gives you the hotseat rig, `?demo` for a
mid-battle.

The client's three presentation layers each split DOM-free logic from DOM playback, so the
decisions are unit-tested and only the painting is not: **motion** (`ui/motion.ts` +
`ui/anim.ts`, docs/09), **sound** (`ui/sfx.ts` + `ui/audio.ts`, docs/10) and the battle
line's column arithmetic (`ui/formation.ts`).

## Online play

**[server/](server/README.md)** is the M2 slice: a WebSocket server with room codes,
server-authoritative `apply`, per-seat redacted views and reconnect. The same client is the
network client (`?ws=1&room=CODE&seat=0`). Games are saved as `{seed, mode, els, actions}`
and `node replay-room.ts games/CODE.json` replays one through the current engine — which is
how a playtest report gets checked against what actually happened. In-game `🐛 bug` reports
append to `server/issues.jsonl`, stamped with the room and action index.

Since **2026-08-21** it also carries **accounts**: a username and a password (no email, no
recovery), a lifetime stat sheet, 28 achievements, a friends list and a match history.
Everything downstream is a fold over the saved games themselves — `games/<CODE>.json` →
`summarizeGame()` → history → profiles → achievements — so a game counts as soon as it is
played, finished or not, and re-running the fold after a change to how a stat is counted
updates the numbers instead of doubling them. Signing up with a name you have already
played under claims those games. Playing signed out records nothing.

## Try the old prototype

Open **[prototype/index.html](prototype/index.html)** in a browser (no build, no server;
`?demo` jumps into a mid-battle with a spell on the stack). `node prototype/test.js` runs
the 56 engine tests. See [prototype/README.md](prototype/README.md) for what's real vs cut.
It's the reference artifact the engine was rebuilt from — superseded by `engine/`.

## The original one-paragraph verdict (2026-07-16)

Very doable as a hobby project in 2026, and this repo is unusually well positioned (card DB,
rules corpus, board renderer, and a rulings pipeline already exist). The real work is not
code: it's writing the "digital comprehensive rules" — Algomancy's paper rules leave gaps
(trigger ordering, fizzle details, region edge cases) that an engine forces answers to. The
recommended path is hybrid: ship a Cockatrice-style manual tabletop on an engine-shaped data
model in weeks, then grow rules enforcement inside it, scripting the 370 cards as an
LLM-drafted, human-reviewed, per-card-tested burn-down. Biggest Algomancy-specific engine
problems: runtime card composition (augment/graft), region scoping, the formation grid with
column-shared attributes, and simultaneous-commitment steps.
