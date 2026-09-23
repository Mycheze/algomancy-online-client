# `client/` — the digital Algomancy client

A rules-enforcing Algomancy you play in a browser: two people in different
cities, a live draft or a constructed deck, 492 scripted cards, accounts,
ratings, a tutorial. Correctness over animation. Live at
<https://algomancy.online>.

Four packages and two directories of data:

| | what |
|---|---|
| [`engine/`](engine/README.md) | the rules, as a pure TypeScript reducer: `apply(state, action)`, `legalActions`, seeded replay, every card's behaviour, and the test suite that is the ruling register made executable |
| [`ui/`](ui/README.md) | the browser client. One esbuild bundle that imports the engine, so it can also run a game with no server at all |
| [`server/`](server/README.md) | the WebSocket game server: rooms, per-seat redacted views, hidden simultaneous steps, persistence, accounts, decks, matchmaking, and the HTTP the bot uses |
| [`ledgers/`](ledgers/README.md) | every work queue, open and closed: card tickets, playtest reports, the backlog, the owner's card verdicts |
| `docs/` | the specs, see below |
| `package.json` | the fan-out: `check`, `dev`, `reports` |

`ui/`, `server/` and `ledgers/` borrow `engine/node_modules`; there is one
`npm install` for the engine and one for the server's single dependency.

## Run it

```bash
npm --prefix engine install && npm --prefix server install
npm run dev              # builds the bundle, serves http://localhost:5177, state under ../var/dev/
```

`PORT=5200 npm run dev` picks another port. The home screen makes a room and
gives you a code; the other player joins with it. Press **New live draft** or
**New constructed game**, or **Learn to play** for the tutorial against a bot.

With no server, `npm --prefix ui run build` and open `ui/index.html?demo`
off disk: a scripted mid-battle, both boards visible, nothing to click.

## The gate

```bash
npm run check            # engine → ui → server → ledgers, then the bot's Python tests
```

About five minutes. Typecheck and tests for each package, the UI bundle, then
the eight bot scripts. The server suite spawns real servers on real ports, so
run it in the background and never two at once.
`engine/test/153-typecheck-reach.test.ts` proves every project the fan-out
names reaches a real `tsc`.

`npm run reports` fetches the live playtest reports, verdicts and admin marks
off the deploy box into `ledgers/*.snapshot.jsonl`, where the suite checks
every row has a ledger entry. That is step zero of a fix round; the ledgers
README explains the loop.

## The specs, in `docs/`

**Read these two first.**

| doc | what |
|---|---|
| [`digital-rules.md`](docs/digital-rules.md) | **the engine's spec.** Every adjudication the paper rules forced, R1–R303 and counting, each with its source and the test that encodes it. One `## R<n>` heading per ruling; `engine/test/184-ruling-register.test.ts` checks the register against the code |
| [`deck-format.md`](docs/deck-format.md) | the deck file the client exports and imports, meant to be read by other tools |

**The design docs**, in the order they were written. Each is the spec for a
subsystem and is kept current when that subsystem changes.

| doc | what |
|---|---|
| [`07-visual-redesign.md`](docs/07-visual-redesign.md) | the board: layout, per-phase focus, the interaction model. `prototypes/` holds the layout editor and reference layouts it was designed with |
| [`08-light-and-dark.md`](docs/08-light-and-dark.md) | the expansion's attributes and mechanics |
| [`09-visual-clarification.md`](docs/09-visual-clarification.md) | card motion and targeting arrows: a state-census diff, not an event feed |
| [`10-sound.md`](docs/10-sound.md) | the cues, the one-cue rule, silence on a resync |
| [`11-stack-on-the-table.md`](docs/11-stack-on-the-table.md) | the stack as overlapping cards on the field |
| [`12-card-text.md`](docs/12-card-text.md) | how printed text becomes the rendered, icon-bearing, live card |
| [`13-assessment.md`](docs/13-assessment.md) | the standing assessment: what is solid, what is unmeasured |
| [`14-scenario-tester.md`](docs/14-scenario-tester.md) | the human oracle for card correctness, behind `server/scenarios-*.ts` |
| [`15-card-browser.md`](docs/15-card-browser.md) | the card browser and its query language |
| [`16-divergence-inventory.md`](docs/16-divergence-inventory.md) | everything known to differ from printed text, across all card-set files |
| [`17-oracle-text-audit.md`](docs/17-oracle-text-audit.md) | the whole-pool oracle-text typo sweep |
| [`18-board-layout-v2.md`](docs/18-board-layout-v2.md) | the regions board: two interlocking Ls, region ≠ control, never scrolls — behind the ▦ board toggle |
| `questions-round*.md` | the open-question sheets put to the owner each round, live: `engine/test/238-question-sheets.test.ts` cross-checks every answer against the register |

**The July 2026 research pass**, `01` to `06`: what the bot project already
had, how other digital card games are built, the mechanics inventory, the
architecture as proposed, the hard questions, the roadmap. They are the record
of how the design was arrived at and are not updated; where they and the code
disagree, the code and the register are right.

⚠ `docs/` is also a **test fixture directory**. Eleven of these files are read
off disk by tests, by name. Rename or restructure them and the suite fails.

## Unofficial, free, and buy the real game

This is a fan project, made with Caleb Gannon's permission. `ui/legal.ts`
puts an unofficial notice above the wordmark on every screen that is not the
board, a footer that asks you to buy the physical game or the print-and-play,
and four pages behind it: About and attribution, AI disclosure, Privacy, Terms.
`ui/test/267-legal-and-attribution.test.ts` keeps three things true: the two
shop URLs are the owner's, verbatim and in that order; the privacy page's list
of what is stored is *derived* from the account store's real fields, so adding
a field fails the suite until the page says what it is; and the page says
there is no password reset for as long as there is none.

What is stored, and where, is on the privacy page and in
`server/statepaths.ts`; nothing under `../var/` is ever committed. Whose the
card art and rules are, and on what terms, is [`../data/NOTICE.md`](../data/NOTICE.md).

## History, in one paragraph

The client started as a research pass on 2026-07-16 with a no-build
JavaScript prototype of fifteen cards (`git log -- digital-client/prototype`
has every version; the directory was `digital-client/` until 2026-08-30). The
engine was rebuilt from it as a pure reducer, the card pool was scripted in
batches with a test per card, and by 2026-08-20 two people were playing
enforced games over the network. It has been live on the public internet since
2026-09-05. Everything since has come from playing it: the bug reports in the
ledgers are from real games, not from reading the rulebook.
