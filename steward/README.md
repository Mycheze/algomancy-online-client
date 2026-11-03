# steward/ — the night worker

An unattended Claude that works through the queues while the owner sleeps:
**one item per run, fresh context every run**, on the home box
(`benshomeserver.local`), never the VPS. It ships what is safe, stages what a
human should see, and writes up what needs a decision, so that a morning
review is a few minutes of `steward/review.sh`.

## The shape

```
 systemd user timer (home box), every 5 min after the last tick ends
   └─ run-once.sh  ── the RUNNER: deterministic bash, owns every side effect
        1. any hour   deploy that was waiting for a quiet server
                      land approved branches (steward-approved/*): rebase → full gate → master → deploy
        2. 23–08 Prague only, unless paused / backing off:
                      fetch reports → queue.mjs → ONE `claude -p` (the steward skill)
                      → outcome.json → full gate HERE → policy.mjs → ship | stage
```

| file | what |
|---|---|
| `../.claude/skills/steward/SKILL.md` | **the process** the agent follows: pick → prove it is real → how deep → rules due diligence → plan → fix → test and break → verdict |
| `run-once.sh` | the runner. The model proposes; this disposes. |
| `queue.mjs` | what may be picked, in order — `node steward/queue.mjs --why` |
| `policy.mjs` | may a diff ship unseen? `node steward/policy.mjs <base> <head>` |
| `hold.txt` | items the steward must leave alone (committed; edit freely) |
| `review.sh` | **the owner's end**, on the laptop |
| `vps-fetch.sh` | the agent's one read-only window onto the live server (game files) |
| `claude-settings.json` | the agent's permissions: no push, fetch, ssh, sudo, full gate |
| `thermal.sh` | the governor that keeps the box silent (see Install §4) |
| `systemd/` | the user units, and the one root unit (the CPU cap) |

### What ships without the owner (the owner's rule, 2026-11-03)

"Anything but UI flows", on a green full gate the runner ran itself. In code
(`policy.mjs`), a `ship` is downgraded to `stage` when the diff:

- touches `client/ui/` or `client/storybook/` (except `updates.ts`,
  `does-lines.json` and tests);
- touches `steward/`, `.claude/`, `deploy/`, `CLAUDE.md`, a `package.json` or
  lockfile, `.gitignore`, `requirements.txt`;
- deletes a test, removes lines from an append-only file (`sets/index.ts`, the
  CR `ledger.json`), shrinks the bot corpus, or guts a `*-closed.ts` ledger;
- changes more than 600 lines outside tests, ledgers and generated rules.

The agent may always choose `stage` itself, and is told to whenever it is
unsure. A deploy that restarts a service waits until no game or challenge
file on the VPS has been written for 10 minutes; a failed health check rolls
the box back to the previous commit and **pauses the steward**.

### Rules questions

The skill makes the agent work the CR, the RAQ threads, the designer's Q&A,
the scan and the engine's analogous cards *before* asking, and apply the
"of course, you fool" test: if it can name the source that would make the
owner say "obviously", it is not a question. A real question arrives in the
handoff with both readings, their quoted evidence, and a Discord-ready
version to paste.

## The owner's morning

```bash
steward/review.sh                 # what happened, what is waiting
steward/review.sh show CT-424     # the write-up, the commits, the policy's reasons
steward/review.sh try BL-56       # a worktree + the one command to run it locally
steward/review.sh approve CT-424 BL-56      # or: approve --all
steward/review.sh reject BL-58 "the green is on purpose — leave the commit button alone"
steward/review.sh answer CT-435 "one batch: they die together"
steward/review.sh pause | resume
```

A rejection's reason goes into the journal the agent reads at the start of
every run — write it as an instruction. `--retry` lets it have another go.

## Install (home box, once)

Done on 2026-11-03; kept here so it can be redone.

1. User-local toolchain, no sudo: Node at `~/.local/node` (the VPS's version),
   `uv` + Python 3.14, Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`).
2. The worker's own clone: `git clone git@github-steward:Mycheze/algomancy-online-client.git ~/algomancy-steward/repo`
   — `github-steward` is an ssh alias in `~/.ssh/config` for the WRITE deploy
   key `~/.ssh/algomancy_steward` ("algomancy-steward" on GitHub; the box's
   other key is read-only). `npm ci` in `client/engine` and `client/server`,
   `uv venv --python 3.14 .venv && uv pip install -r bot/requirements.txt`,
   then `steward/review.sh sync-rulings` from the laptop (the rulings export
   is gitignored and the rules due diligence needs it).
3. `claude setup-token` (interactive, on any machine) and put the token in
   `~/.config/algomancy-steward/env` (mode 600):
   ```
   CLAUDE_CODE_OAUTH_TOKEN=…
   STEWARD_MODE=live          # dry = do everything but push and deploy
   STEWARD_WINDOW=23-08
   STEWARD_TZ=Europe/Prague
   STEWARD_WEBHOOK=           # optional: a Discord webhook URL for one line per event
   ```
4. **The one root step — the thermal cap.** The box is an i7-10750H laptop;
   one pinned core at turbo went 46 → 89 °C in 15 s on 2026-11-03. Pinning
   limits how much runs, not how hot a core gets, so `thermal.sh` holds the
   package under 55 °C by moving cpu5/cpu11's frequency ceiling, and the runner
   refuses heavy work if it cannot:
   ```bash
   sudo cp ~/algomancy-steward/repo/steward/systemd/algomancy-steward-cpucap.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now algomancy-steward-cpucap
   ```
5. Units:
   ```bash
   mkdir -p ~/.config/systemd/user ~/algomancy-steward/bin
   cp ~/algomancy-steward/repo/steward/systemd/* ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now algomancy-steward.timer
   ```
   (`loginctl enable-linger bena` is already on, so it runs with nobody logged in.)

## Things that are not what they look like

- **`steward/*` and `steward-approved/*` are the only branches besides master
  that may exist.** They are pending review, not unlanded rounds. A landed or
  rejected one is archived at `refs/archive/steward/<item>` and deleted.
- **The agent never runs the full gate**; the runner does, once per item, on
  one pinned, frequency-governed core. The box must stay silent — that is the
  owner's one hard requirement for it — so the gate is slow there, and that is fine.
- **The guard rails are rails, not a sandbox.** The agent runs as `bena` with
  the box's keys on disk. What stops it pushing is a refusing
  `GIT_SSH_COMMAND` and denied commands, plus the fact that the runner, not
  the agent, decides what ships.
- The worker keeps its state in `~/algomancy-steward/state`, outside the
  repo: `journal.jsonl` (append-only, one row per event, the agent's memory),
  `handoffs/`, `answers/`, `redgate/`, `outcomes/`, and the flags `paused`,
  `backoff-until`, `pending-deploy`.
