# Algomancy — repo guide

Three things live here. Keep them straight and most of this repo explains itself.

| | what | language |
|---|---|---|
| `data/` | the **shared** card, rules and corpus data. No code. Both halves read it. | JSON / md / images |
| `bot/` | the **RAG rules bot** — a Discord bot and a FastAPI web app that answer rules questions | Python, ~11k lines |
| `client/` | the **digital client** — a rules-enforcing online Algomancy game | TypeScript, ~200k lines |

The repo began as the bot and grew the client inside it. The client is now ~20×
the size, but the two are peers: they share `data/`, and — since the Discord
integration — a little HTTP.

**The two halves talk, both ways, over loopback.** The game server proxies
`/api/cardinfo` and `/api/judge` to `bot/app.py` on :8000 (the in-game card
inspector and the judge box). The bot reads `/api/cardsearch`, `/api/bot/*` and
`/api/players` off the game server on :5000, and the server pushes queue events
to the bot on :8765. All of it is gated on `ALGO_BOT_TOKEN`; unset means the
integration is absent rather than broken, on both sides. See `.env.example`.

## Where things are

```
data/           cards/ (528 scans + the oracle JSON) · icons/ · rules/ · corpus/ · rulings/
bot/            the runtime modules · app.py (web) · bot.py (Discord) · cogs/ · web/ · test/
bot/pipeline/   the scripts that BUILD data/ — run by hand, never on a request path
client/engine/  src/ (the rules reducer) · test/ · scripts/ — the engine, and only the engine
client/ui/      the whole browser client (~26k lines). It imports the engine; it is not in it.
client/server/  the WebSocket game server
client/ledgers/ every work queue: card-todo, playtest-ledger, backlog, and the derived ones
client/docs/    the specs — and a test fixture directory, see below
var/            ALL mutable runtime state: the bot's logs, saved games, the account
                store, playtest reports, card verdicts. Gitignored whole. Never commit
                anything under it; back it up, because none of it can be rebuilt.
```

## Paths are named once. Do not spell them again.

Every location lives in exactly one of three modules. If you are about to write
`../../data/cards` or `Path(__file__).parent / "data" / "rules"`, stop and
import it instead:

- `bot/paths.py` — every path the Python side uses
- `client/engine/scripts/paths.mjs` — every path the node scripts and tests use
- `client/ui/assets.ts` — the browser's asset **URLs** (not paths)

⚠ `ART_BASE` in `assets.ts` is relative and its **depth is load-bearing twice** —
it must resolve correctly both over HTTP (where the excess `..` clamps to the
route the server serves) and over `file://` (where it walks two real
directories to the repo root, which is the only reason the no-server hotseat rig
shows card art). It has already changed once, when `ui/` left `engine/`. Change
it again and the served client keeps working while `file://` silently breaks.
`client/engine/test/247-asset-paths.test.ts` is the only thing that notices.
Read it before touching that string.

## Generated vs canonical — never hand-edit a generated file

| file | |
|---|---|
| `data/cards/AlgomancyCards-OracleText.json` | **canonical**, upstream (the designer's transcription). Corrections go in `client/engine/scripts/printed-overrides.mjs`, never here. |
| `client/engine/src/cards/printed.json` | **generated** by `npm run extract`. The engine's trusted pool. |
| `client/engine/src/cards/catalogue.json` | **generated**. Browse data. **Nothing in `client/engine/src/` may import it.** |
| `data/cards/oracle-corrections.json` | **generated** by `npm run extract` from `printed-overrides.mjs`. The corrections the client carries, emitted for the readers that are *not* the client — `bot/oracle.py` applies them so the bot and the RAG corpus stop serving text the owner has already ruled wrong. |
| `data/cards/mod_anchors.json` | **generated** by `bot/pipeline/build_anchors.py` |
| `data/corpus/algomancy_corpus.jsonl` | **generated** by `bot/pipeline/build_corpus.py`. Committed on purpose: its hash is part of the bot's engine version. |

## Things that are not what they look like

- **`client/docs/` is a test fixture directory.** Six tests read `digital-rules.md`,
  `13-assessment.md` and `questions-round*.md` off disk. Renaming or
  restructuring them breaks the suite.
- **`digital-rules.md` is the engine's spec**, not documentation — R1–R288 (a number
  `184-ruling-register.test.ts` checks against the register, here and in `client/README.md`), every
  adjudication the engine forced. A ruling gets exactly one `## R<n>` heading;
  demote every heading inside a pasted write-up or `184-ruling-register` will
  read it as a new ruling.
- **`client/ledgers/` holds every work queue** — `card-todo.ts` (the one that
  matters), `playtest-ledger.ts`, `backlog.ts` and the derived queues. They are
  data, not tests; four of them used to sit in `engine/test/` and read as tests.
  `engine/test/` holds only `*.test.ts` and its harnesses — and only the ENGINE's
  tests since 2026-09-03: the ui-only ones are in `client/ui/test/`, the
  server-only ones in `client/server/test/`. A ledger names a guard test by bare
  filename and every resolver looks in all three. Each ledger is split in two:
  `card-todo.ts` is the type and the open entries, `card-todo-closed.ts` the
  closed ones (same for `backlog` and `playtest-ledger`); the closed half still
  runs — every proof is a regression guard — it is just not the file you open.
- **`client/ui/` is the entire browser client.** It was `engine/ui/` until the
  reorg, which is why older commits and comments put it there.
- **`client/engine/src/cards/sets/index.ts` is append-only.** Import order =
  registration order = deck order, and replays depend on it. Never reorder.
  `150-registration-order.test.ts` enforces it.

## The gates

```bash
npm --prefix client run check     # typecheck + every suite + the UI bundle + the bot's tests
```

That one command fans out to engine, ui, server and ledgers, and
`153-typecheck-reach.test.ts` proves every project it names reaches a real `tsc`.

- It takes **~5 minutes. Run it in the background with a redirect**, never in the
  foreground.
- **Never run two at once.** The server suite binds a port; two runs deadlock and
  the second just stalls with no error.
- Python: `.venv/bin/python bot/test/run_all.py` runs all nine scripts
  (`test_slash`, `test_components`, `test_embeds`, `test_queuewatch`,
  `test_gameserver`, `test_draft`, `test_mods`, `test_search`, `test_oracle`)
  and fails if any does; `run_all.py slash` runs one. Standalone scripts, not
  pytest — each prints its own pass line. They point `ALGO_VAR_DIR` at a
  throwaway directory (`bot/test/_scratch_var.py`, imported first): the suite
  used to append to the deployment's own logs.
  `npm run check` reaches them last, as `test:py`. It did not until 2026-09-03,
  and that is how the puzzle command stayed broken from July to September and
  how every draft button and every queue match could raise for a day with all
  nine scripts green — nothing ran them, and they constructed everything and
  clicked nothing. They click now.

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
All three services are systemd units — `algomancy-game` (:5000),
`algomancy-web` (:8000, loopback), `algomancy-bot` — and the unit files live in
`deploy/`, with `deploy/README.md` as the install recipe. The game server was a
hand-started `run-server.sh` loop until 2026-09-03; that script is gone, and
starting anything with `setsid nohup` beside its unit duplicates it. Secrets
come from the gitignored `.env` (and `client/server/tester.env`) through
`EnvironmentFile=`, never from the command line. A client-only change needs no
restart — rebuild the bundle and the next page load has it (the page reloads
itself when it reconnects to a restarted server). Logs are in the journal, not
`var/logs/`.

`var/` is backed up by `deploy/backup-var.sh` on `algomancy-backup.timer`,
daily, fourteen kept, mirrored off the box when `ALGO_BACKUP_REMOTE` is set.
Before 2026-09-03 nothing backed it up at all.

The UI bundle is `npm --prefix client/ui run build` (it was
`--prefix client/engine run build:ui` before the reorg).
