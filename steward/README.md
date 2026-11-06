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
        2. inside STEWARD_WINDOW (23-08 Prague, or "always"), unless paused / backing off:
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
| `fetch-file.mjs` | downloads an image/PDF the owner sent — `discord.mjs` fetches every link in his messages on arrival; the agent runs it by hand for anything else (curl/wget stay denied) |
| `retro.mjs` | the daily digest of the last day's runs, read off their own transcripts (denials, errors, loops, half-done) — the input to the `retro` item |
| `claude-settings.json` | the agent's permissions: no push, fetch, ssh, sudo, full gate |
| `thermal.sh` | the governor that keeps the box silent (see Install §4) |
| `systemd/` | the user units, and the one root unit (the CPU cap) |

### What ships without the owner (the owner's rule, 2026-11-03; sharpened 2026-11-05)

"Anything but UI flows", on a green full gate the runner ran itself. On
2026-11-05 he woke to ten approval threads, nearly all of them fixes he would
have waved through ("I don't want to manually approve all those things"), so
the line is now drawn at what actually needs him. A **flow** is a screen
added, removed or rebuilt; a fix inside an existing screen (a wording, a
clipped glow, an export that dropped the sideboard) ships. In code
(`policy.mjs`), a `ship` is downgraded to `stage` when the diff:

- adds or deletes a file under `client/ui/` or `client/storybook/` (tests,
  `updates.ts` and `does-lines.json` excepted), or changes more than 250 lines
  of them;
- touches `steward/`, `.claude/`, `deploy/`, `CLAUDE.md`, a `package.json` or
  lockfile, `.gitignore`, `requirements.txt` — except the steward skill's own
  text (`.claude/skills/steward/`), which ships up to 150 changed lines, so the
  daily retro can improve the instructions by itself (owner, 2026-11-06);
- deletes a test, removes lines from an append-only file (`sets/index.ts`, the
  CR `ledger.json`), loses non-rules rows from the bot corpus (lost rulings), or
  guts a `*-closed.ts` ledger;
- changes more than 600 lines outside tests, ledgers and generated rules.

The agent may choose `stage` itself only for the reasons in the skill's §8 (a
flow, a real choice no source settles, a big refactor, its own harness) — not
"wording players read", "no browser could look", a cosmetic A/B, or "someone
should try it on an iPad" (those ship, and go in the night log). A branch the
worker cannot get green twice is archived and retried in a week, never posted.
A deploy that restarts a service waits until no game or challenge
file on the VPS has been written for 10 minutes; a failed health check rolls
the box back to the previous commit and **pauses the steward**.

A thread that does reach the owner opens on **Needs from you** (one question he
can answer in one reply) and **In short** (plain words: what players saw, what
changes, why it needs him, what yes and no do). No test numbers, file names,
rule numbers or commands; the technical record is the attached file.

### When master itself is red

A red master turns every branch red (the first night, 2026-11-03: one
hand-written path in `vps-fetch.sh`, six items, six red gates). So the runner
gates clean master whenever master moves, at any hour (no Claude is spent;
the governor keeps it silent), into `state/master-gate.json`. Red → a journal row, a webhook note, and
`fix-master` first in the queue; repairs wait. A branch that went red while
master was red is marked `masterRed` and, once master is green, re-gated by the
runner alone (rebase + gate, no Claude) and shipped or staged as the agent
meant — only a branch still red after that reaches the agent as a repair.

The fetched report rows (`client/ledgers/*.snapshot.jsonl`) belong to the
triage item alone; on any other item the runner puts them back to master's
before it commits or gates.

The code that judges the agent never runs from the tree it worked in:
`policy.mjs` is extracted from `origin/master` at the start of each tick, and
the unit copies `run-once.sh` from `origin/master` too.

### The daily retro (2026-11-06)

Once a day, from the summary hour, the runner writes `state/retro/<day>.md`
(`retro.mjs`, no Claude): every run of the last day ranked by how much it
deserves a look — permission denials, tool errors, commands run over and over,
minutes and turns, a summary that admits stopping short, the owner's replies.
The queue then offers `retro retro-<day>` (after the owner's own asks), and the
agent follows the skill's §15: open the worst transcripts, name the cause, and
fix it in the skill (ships) or in `steward/` (staged for the owner). Why: on
2026-11-06 a card update shipped half done because the run could not download
the new scan; its transcript listed all three denied attempts, and nothing read it.

### Card updates

The designer's card changes reach us as a message in #steward ("Mindburn has a
new version", the scan attached or linked). The skill's §14 is the whole recipe
— scan into `data/cards/`, every field read off it, the scan readers re-run,
engine, tests, challenges, the bot's corpus, the update line — and a short
message is the whole brief. The scan is the authority; algomancer.cc is not
evidence (the bot's daily check against it was retired the same day).

### Rules questions

The skill makes the agent work the CR, the RAQ threads, the designer's Q&A,
the scan and the engine's analogous cards *before* asking, and apply the
"of course, you fool" test: if it can name the source that would make the
owner say "obviously", it is not a question. A real question arrives in the
handoff with both readings, their quoted evidence, and a Discord-ready
version to paste.

## The owner's morning — on Discord

The owner should not have to know a command (2026-11-04). Everything that
waits on him arrives as a post in **#steward**, a private forum in Ben's
Personal Server that only he and the bot can see (`steward/discord.mjs`):

- **one post per item** — only when he is genuinely needed (above): the question, the
  plain-words short version, the full write-up attached, and the "Discord-ready" question as a message of its own, so asking
  the wider server is a forward;
- **📓 night log** — every ship, stage, deploy and red as it happens, and a
  summary every morning (the first tick from 08:00 Prague, `STEWARD_SUMMARY_HOUR`).

- **the inbox** — a plain message of his in the channel (not in a thread) is a
  request, taken like a report: the bot opens a thread on it ("queued"), the
  queue offers it right after triage, and that thread is where the worker asks,
  shows a staged branch, or says it is done (state/inbox/). A ✅ and that
  thread come within a minute, whatever the worker is doing: their own timer
  (`algomancy-steward-inbox.timer`) checks the channel every minute, because the
  tick only reads it when it starts, and a tick can run for hours.

He replies in the post: **approve** · **reject** <why> · **retry** <why> · or
just answers in words, with screenshots if he likes (they are saved beside the
answer for the worker to look at). **pause** / **resume** in the night log.
Only his messages count (`STEWARD_DISCORD_OWNER`); a ✅ means it was taken.
The runner reads the replies at the start of every tick, any hour, so an
approval starts landing within minutes. `node steward/test-discord.mjs` runs
the whole loop against a fake Discord.

Config on the box (`~/.config/algomancy-steward/env`): `STEWARD_DISCORD_TOKEN`
(the bot's token), `STEWARD_DISCORD_FORUM` (the forum's channel id),
`STEWARD_DISCORD_OWNER` (his user id). Unset = the old webhook, if any.

### The same from a terminal

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
   `uv venv --python 3.14 .venv && uv pip install -r bot/requirements.txt -r bot/pipeline/requirements.txt`
   (the runner keeps both in step; the pipeline half is what re-reads a card scan and rebuilds the corpus),
   then `steward/review.sh sync-rulings` from the laptop (the rulings export
   is gitignored and the rules due diligence needs it).
3. `claude setup-token` (interactive, on any machine) and put the token in
   `~/.config/algomancy-steward/env` (mode 600):
   ```
   CLAUDE_CODE_OAUTH_TOKEN=…
   STEWARD_MODE=live          # dry = do everything but push and deploy
   STEWARD_WINDOW=23-08        # or "always" — since 2026-11-04 the plan's limit is one weekly budget,
                               # so the owner runs it round the clock and types "pause" in the night log
                               # when he wants the quota for himself
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
   systemctl --user daemon-reload && systemctl --user enable --now algomancy-steward.timer algomancy-steward-inbox.timer
   ```
   (`loginctl enable-linger bena` is already on, so it runs with nobody logged in.)

## Things that are not what they look like

- **`steward/*` and `steward-approved/*` are the only branches besides master
  that may exist.** They are pending review, not unlanded rounds. A landed or
  rejected one is archived at `refs/archive/steward/<item>` and deleted — and so
  is an approved one whose item already shipped another way (a repair run that
  re-applied it): the runner journals `landed-elsewhere` instead of rebasing it
  onto its own landed patch and queueing the same repair every tick (BL-68).
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
