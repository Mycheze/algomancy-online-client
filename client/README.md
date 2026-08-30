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
| [docs/01-existing-assets.md](docs/01-existing-assets.md) | what the bot project already gives us (card DB, `wtp.py` state model, board renderer, icons, draft, mods logic) |
| [docs/02-how-others-did-it.md](docs/02-how-others-did-it.md) | MTGO/Arena, Forge, XMage, Hearthstone sims, Cockatrice, boardgame.io, Argentum — patterns + effort data |
| [docs/03-mechanics-inventory.md](docs/03-mechanics-inventory.md) | the complete Algomancy mechanics surface an engine must implement, incl. the 8 architectural deltas vs MTG |
| [docs/04-architecture-spec.md](docs/04-architecture-spec.md) | proposed design: pure TS engine, state model, events/triggers/stack, card DSL, server, client |
| [docs/05-hard-questions.md](docs/05-hard-questions.md) | rules gaps needing adjudication, product decisions (Bena's call), risk list |
| [docs/06-roadmap.md](docs/06-roadmap.md) | M0 shared tabletop → M1 engine core → M2 enforced client → M3 card burn-down → M4 full game |
| [docs/07-visual-redesign.md](docs/07-visual-redesign.md) | the "MTGO-grade" client spec: board layout, per-phase focus layouts, interaction model |
| [docs/08-light-and-dark.md](docs/08-light-and-dark.md) | the Light & Dark expansion: new attributes and mechanics, and what is still parked |
| [docs/09-visual-clarification.md](docs/09-visual-clarification.md) | card-motion animations + targeting arrows: why a state-census diff rather than an event feed |
| [docs/10-sound.md](docs/10-sound.md) | phase/priority cues and the idle thump: the one-cue rule, and staying silent on a resync |
| [docs/11-stack-on-the-table.md](docs/11-stack-on-the-table.md) | the stack as overlapping cards on the field, and giving unrespondable effects a beat on it |
| [docs/12-card-text.md](docs/12-card-text.md) | the card-text engine: how printed text becomes the rendered, icon-bearing card |
| [docs/13-assessment.md](docs/13-assessment.md) | the standing assessment — floor and ceiling, what is solid and what is unmeasured |
| [docs/14-scenario-tester.md](docs/14-scenario-tester.md) | the human oracle for card correctness — the commission spec behind `server/scenarios-*.ts` |
| [docs/15-card-browser.md](docs/15-card-browser.md) | the card browser and its query language (the syntax of record is `ui/cardsearch.ts`) |
| [docs/16-divergence-inventory.md](docs/16-divergence-inventory.md) | the 2026-08-25 sweep of all 30 card-set files: everything known to differ from printed text |
| [docs/17-oracle-text-audit.md](docs/17-oracle-text-audit.md) | the whole-pool oracle-text typo sweep (R240) |
| [docs/digital-rules.md](docs/digital-rules.md) | **the digital comprehensive rules** — every adjudication the engine forced, with its source |
| `docs/questions-round*.md` | the open-question sheets put to the owner each round. **Live, not archive**: `engine/test/238-question-sheets.test.ts` reads them off disk and cross-checks every `ANSWER:` line against `digital-rules.md`. |

⚠ `docs/` is a **test fixture directory**. `digital-rules.md`, `13-assessment.md`
and `questions-round*.md` are read off disk by six tests — renaming or
restructuring them breaks the engine suite.

## The engine

**[engine/](engine/README.md)** is the implementation of record: a pure TypeScript reducer
with `legalActions()`, seeded-RNG action-log replay, real regions, proper graft composition,
**493 scripted cards**, the rulings encoded as tests (R1–R267 and counting), a fuzzer, and the browser client
built on top. `npm run check` is the gate (typecheck + ~1000 tests + bundle); `npm run
npm --prefix ui run build` then opening `ui/index.html` gives you the hotseat rig, `?demo` for a
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

The server has its own gate: `npm --prefix server test` — 13 files, 465 assertions, ~30s,
run against throwaway game/account directories so it is safe on the deploy box. It carries
the guards the engine cannot hold, because they are about redaction, persistence and the
socket rather than the rules. The whole gate is one command from this directory —
`npm run check` (this package's `package.json` fans out to engine, server and
backlog, and `engine/test/153-typecheck-reach.test.ts` proves every project it
names actually reaches a real `tsc`). There is no CI; deploy is a git pull and a
restart.

Also since **2026-08-21**, a live draft opens a **lobby** instead of a game: the two of you
choose the three elements together — one each with the third drawn, a trio you have never
played, or a weighted draw from your combined rankings of all seven — and no cards are dealt
until you have both locked in, so nobody gets an early look at their first pack. All three
methods are blind, seeded off the room seed, and show their working when they resolve. And a
game now ends on a **post-game screen** — who won, both players' numbers side by side, what it
unlocked, and a rematch handshake that carries the format, the seats and (for a draft) a
one-click "run it back" into the next room.

Since **2026-08-21** it also carries **accounts**: a username and a password (no email, no
recovery), a lifetime stat sheet, 53 achievements, a friends list and a match history.
Everything downstream is a fold over the saved games themselves — `games/<CODE>.json` →
`summarizeGame()` → history → profiles → achievements — so a game counts as soon as it is
played, finished or not, and re-running the fold after a change to how a stat is counted
updates the numbers instead of doubling them. Signing up with a name you have already
played under claims those games. Playing signed out records nothing.

Since **2026-08-27** an account also carries a **deck collection** (BL-14): the five bundled
algomancer.cc decks are copied into it the first time you look, and from there you build,
rename, cut, duplicate, delete and import decks, pick the card whose art the deck wears, and
bring one to a constructed game. The page draws the deck as card scans grouped by mana value,
and beside it the three numbers a build is actually decided on — the curve, the unit/spell
split, and **the affinity table**: how much of each element you need *open by then* at every
mana value, carried up the curve, with the ceiling that casts the whole deck on the bottom
row. Editing saves itself; a deck may sit at 29 cards and simply say so, and only a legal one
is offered to a game. Each deck's win/loss record is a fold over the game history filtered by
the deck id the seat brought, so it can never disagree with the games list. See
`server/collection.ts` for the three design commitments and `ui/deckstats.ts` for the
arithmetic (tested, DOM-free, in `engine/test/188-deck-stats.test.ts`).

## The old prototype

The pre-engine JavaScript prototype (`prototype/` — a no-build `index.html`, its own
`engine.js` and 56 tests) was the reference artifact `engine/` was rebuilt from. It was
superseded in 2026-07 and removed from the tree in 2026-08; `git log -- digital-client/prototype`
still has every version if you want to see what was real vs cut at the time.

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
