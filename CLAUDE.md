# Algomancy — repo guide

Three things live here. Keep them straight and most of this repo explains itself.

| | what | language |
|---|---|---|
| `data/` | the **shared** card, rules and corpus data. No code. Both halves read it. | JSON / md / images |
| `bot/` | the **RAG rules bot** — a Discord bot and a FastAPI web app that answer rules questions | Python, ~9k lines |
| `client/` | the **digital client** — a rules-enforcing online Algomancy game | TypeScript, ~200k lines |

The repo began as the bot and grew the client inside it. The client is now ~20×
the size, but the two are peers: they share `data/`, and nothing else.

## Where things are

```
data/           cards/ (528 scans + the oracle JSON) · icons/ · rules/ · corpus/ · rulings/
bot/            the runtime modules · app.py (web) · bot.py (Discord) · web/ · puzzles/ · test/
bot/pipeline/   the scripts that BUILD data/ — run by hand, never on a request path
client/engine/  src/ (the rules reducer) · ui/ (the whole browser client) · test/ · scripts/
client/server/  the WebSocket game server, and the live games/ + accounts/ stores
client/ledgers/ every work queue: card-todo, playtest-ledger, backlog, and the derived ones
client/docs/    the specs — and a test fixture directory, see below
logs/           the bot's runtime state. gitignored. never commit anything under it.
```

## Paths are named once. Do not spell them again.

Every location lives in exactly one of three modules. If you are about to write
`../../../AlgomancyCards` or `Path(__file__).parent / "Rules"`, stop and import
it instead:

- `bot/paths.py` — every path the Python side uses
- `client/engine/scripts/paths.mjs` — every path the node scripts and tests use
- `client/ui/assets.ts` — the browser's asset **URLs** (not paths)

⚠ `ART_BASE` in `assets.ts` is relative and its **depth is load-bearing twice** —
it must resolve correctly both over HTTP (where the excess `..` clamps to the
route the server serves) and over `file://` (where it walks three real
directories to the repo root, which is the only reason the no-server hotseat rig
shows card art). Change it and the served client keeps working while `file://`
silently breaks. `client/engine/test/247-asset-paths.test.ts` is the only thing
that notices. Read it before touching that string.

## Generated vs canonical — never hand-edit a generated file

| file | |
|---|---|
| `data/cards/AlgomancyCards-OracleText.json` | **canonical**, upstream (the designer's transcription). Corrections go in `engine/scripts/printed-overrides.mjs`, never here. |
| `engine/src/cards/printed.json` | **generated** by `npm run extract`. The engine's trusted pool. |
| `engine/src/cards/catalogue.json` | **generated**. Browse data. **Nothing in `engine/src/` may import it.** |
| `data/cards/mod_anchors.json` | **generated** by `bot/pipeline/build_anchors.py` |
| `data/corpus/algomancy_corpus.jsonl` | **generated** by `bot/pipeline/build_corpus.py`. Committed on purpose: its hash is part of the bot's engine version. |

## Things that are not what they look like

- **`client/docs/` is a test fixture directory.** Six tests read `digital-rules.md`,
  `13-assessment.md` and `questions-round*.md` off disk. Renaming or
  restructuring them breaks the suite.
- **`digital-rules.md` is the engine's spec**, not documentation — R1–R267, every
  adjudication the engine forced. A ruling gets exactly one `## R<n>` heading;
  demote every heading inside a pasted write-up or `184-ruling-register` will
  read it as a new ruling.
- **`client/ledgers/` holds every work queue** — `card-todo.ts` (the one that
  matters), `playtest-ledger.ts`, `backlog.ts` and the derived queues. They are
  data, not tests; four of them used to sit in `engine/test/` and read as tests.
  `engine/test/` now holds only `*.test.ts` and six real harnesses.
- **`ui/` is the entire browser client**, not part of the engine.
- **`sets/index.ts` is append-only.** Import order = registration order = deck
  order, and replays depend on it. Never reorder. `150-registration-order.test.ts`
  enforces it.

## The gates

```bash
npm --prefix client run check     # typecheck + ~3500 assertions + bundle
```

That one command fans out to engine, server and backlog, and
`153-typecheck-reach.test.ts` proves every project it names reaches a real `tsc`.

- It takes **~5 minutes. Run it in the background with a redirect**, never in the
  foreground.
- **Never run two at once.** The server suite binds a port; two runs deadlock and
  the second just stalls with no error.
- Python: `.venv/bin/python bot/test/test_wtp.py` (and `test_draft`, `test_mods`,
  `test_search`). These are standalone scripts, not pytest — each prints its own
  pass line.

## Working in this tree

- **Other sessions edit this repo live.** Check `git worktree list` if the tree
  looks strange. Never revert a shared file with `cp` or `git checkout` — undo
  your own change with a targeted edit. A typecheck failing on identifiers you
  have never seen is someone else's half-written work, not yours; `git diff
  --stat` tells them apart.
- Land anything large from a worktree, then `git push origin <branch>:master`.
- **Never `pkill -f` or `pgrep -f` the services.** Both match the killing shell's
  own command line — over SSH that includes the pattern, so the lookup kills the
  script running it. List with `ps -eo pid,cmd | grep …`, then `kill <literal pids>`.

## Deploy

The server is `benshomeserver.local` (**not** the dev laptop), same repo path.
`bot.py` and `app.py` are systemd units (`algomancy-bot`, `algomancy-web`,
`Restart=always`); the game server on :5000 is a `run-server.sh` respawn loop.
A client-only change needs no restart — rebuild the bundle and the next page load
has it. Logs are in the journal, not `logs/`.
