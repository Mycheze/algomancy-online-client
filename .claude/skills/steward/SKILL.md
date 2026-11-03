---
name: steward
description: The unattended night worker's process — take ONE item off the steward queue, prove it is real, find how deep it goes, fix it properly, test it, and hand the runner a verdict. Run by steward/run-once.sh on the home box; not for interactive sessions.
---

# The steward — one item, done properly

You are running **unattended**, at night, on the home box, in the steward's own
clone (`~/algomancy-steward/repo`, detached at `origin/master`). Nobody is
watching. Your context is fresh: everything you know about earlier nights is in
the state files below. When you finish, a deterministic script
(`steward/run-once.sh`, "the runner") reads your verdict, runs the full gate
itself, applies the ship policy (`steward/policy.mjs`), and pushes, stages or
deploys. **You never push, deploy, ssh, or restart anything** — those are blocked,
and trying wastes the night.

Read `CLAUDE.md` first. Everything in it applies to you, especially: paths are
named once, never hand-edit a generated file, the comprehensive rules are the
spec, every player-visible change gets an update line in `client/ui/updates.ts`.

`$STEWARD_STATE` (the runner exports it; usually `~/algomancy-steward/state`) holds:

| file | what |
|---|---|
| `queue.txt` | tonight's candidates, best first, made by `steward/queue.mjs` |
| `journal.jsonl` | one row per earlier run — item, outcome, summary, and the owner's **rejections with reasons**. Read the last 40 rows. A rejection is the owner telling you how to work: honour it. |
| `handoffs/<item>.md` | write-ups waiting on the owner |
| `answers/<item>.md` | the owner's answers to those write-ups |
| `outcome.json` | **you write this** — your verdict (schema at the end) |

## The hard limits

1. **One item.** If you find a neighbouring bug, file it (a CT in
   `client/ledgers/card-todo.ts` or a BL in `backlog.ts`, with the evidence) and
   do not fix it tonight.
2. **Do not run the full gate** (`npm --prefix client run check`). The runner
   runs it after you, once. Run targeted test files and the typechecks.
3. **At most two subagents at a time**, and only for independent reading. The
   whole run is pinned to two CPU cores so the box stays silent; don't fight that.
4. **Never touch `var/`** except reading the files the runner fetched, and
   `steward/vps-fetch.sh` to bring down a game file.
5. **Never edit** `steward/`, `.claude/`, `deploy/`, `CLAUDE.md`, any
   `package.json` or lockfile. If one of those is the problem, say so in a
   handoff.
6. **Commit your work** on the detached HEAD before you finish — the runner
   only sees commits. Commit messages say *why* (the evidence, the CR number),
   in the repo's usual style, ending with
   `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 1. Read the room (5 minutes, no more)

- `cat $STEWARD_STATE/queue.txt`, `tail -40 $STEWARD_STATE/journal.jsonl`.
- `git log --oneline -15` — what landed since the last night. Another session may
  have fixed your item an hour ago.
- If the item has an `answers/` file, that answer is an **owner decision**: it
  settles the question it answers. Read the handoff it answers too.

## 2. Pick

Take the **first** queue line. Skip it only if one of these is true, and if you
skip, say why in your verdict (outcome `skip`):

- it is already fixed on master (then it is not a skip — close it: see §8,
  `already-fixed`);
- a journal rejection says not to do it this way and you have no other way;
- it needs a decision nobody has made, AND you cannot even prepare it (rare —
  usually you *can* prepare it; that is outcome `needs-human`).

Queue line kinds: `repair <branch>` (a staged branch whose gate went red — fix
it on that branch, see §9), `resume <item>` (answered — finish it), `triage
#a-#b` (new reports — see §10), `report #N`, `CT-N`, `BL-N`, `tidy` (§11).

## 3. Prove it is real — evidence before code

Write down, as you go, which claims are **verified** (you ran something and saw
it) and which are **hypothesis**. Your verdict carries both lists.

- **A report (`#N`)**: read its row in `client/ledgers/playtest-issues.snapshot.jsonl`
  and the ledger entry. If it has a room, fetch the game
  (`steward/vps-fetch.sh var/games/<ROOM>.json`) and replay it
  (`node client/server/replay-room.ts var/games/<ROOM>.json --log`). Check
  **deploy age**: was the game played before a fix for this landed? (`git log
  --since`). A row with `page` and no room is about a screen, not a game.
  Re-fetch before every replay; a stale copy replays clean and lies.
- **A CT**: its `proof` predicate returns true while the bug is there —
  `83-card-todo.test.ts` runs it. If the proof is now false, it was fixed by
  someone: close it (§8).
- **A BL**: read `said` (the owner's words; the tiebreaker) before `means`.
  Check whether what it asks for already exists and is merely unreachable — it
  has happened more than once (BL-19, BL-25).
- **Reproduce it in a test that fails.** Before any fix. If you cannot
  reproduce it, that is a finding: outcome `not-a-bug` or `needs-human`, with
  exactly what you tried.

## 4. How deep does it go — no band-aids

Before planning a fix, answer these in writing (they go in the verdict):

- **What is the class?** The reported card is one instance. Find every other
  site with the same shape — grep the engine, sweep `allCardNames()` (the
  registry, not printed.json: synthetic cards exist). A one-card fix for a class
  of bug is how it comes back.
- **Which layer?** A "rules bug" can be the presentation layer (an option
  payload read in the wrong namespace, a button that exists but is unreachable)
  and a "UI complaint" can be a dead code path.
- **Why did nothing catch it?** Find the guard that should have. Could it ever
  have failed on this behaviour? If not, your fix includes the guard that can.
- **Root cause in one sentence**, and every affected site as `file:line`.

If the honest fix is much bigger than the item (a seam rework, a new engine
primitive), do not start it at night unprepared: write the plan as a handoff
(outcome `needs-human`, decision "approve this plan"), with the reproducer
committed.

## 5. Rules questions — due diligence first

Any change to what the engine *does* is a rules claim. Settle it from the
sources, in this order, and record what each one said (or that it said nothing):

1. **The comprehensive rules** — `data/comprehensive-rules/Algomancy-Comprehensive-Rules.md`
   (rule text AND examples; `sources.owner` blocks in `rules/*.json` are the
   owner's past decisions).
2. **The RAQ** — `client/ledgers/raq.ts`, then the thread *titles* in
   `data/rulings/exports/` (`ls … | sed 's/Caleb Gannon.s Discord - //; s/ \[[0-9]*\].json//'`)
   — threads are named after the interaction they settle. `calebgannon` is the
   final word; `_passer`'s `[Solved]` summaries are reliable; everyone else is a
   player thinking aloud. Print the surrounding messages *with authors*, never
   one matching line. Two files can share a title and one can be empty.
3. **The designer's flat Q&A** — `client/ledgers/rules-questions.snapshot.jsonl`,
   `data/rulings/generated_rulings.jsonl`.
4. **The printed card** — the oracle JSON for words, the **scan image** for
   symbols (the transcription's symbols were wrong eleven times). Take the
   permissive reading; printed text beats engine defaults.
5. **How the engine already treats the analogous cards**, and the tests that pin it.

The RAQ beats our own earlier rulings: if a thread contradicts the CR record,
follow the thread, record the reversal in the CR record citing it, and fix the
engine. **Do not ask about that.**

**The "of course, you fool" test.** Before you write a question, write down the
answer you expect the owner to give and the one source that would make him
say *"obviously"*. If you can name that source, it is not a question — cite it
and act. A question is only allowed when the sources genuinely support two
readings and nothing decides between them, or when the engine is wrong in a way
only a judge can confirm.

Never *recommend* a rules answer. State what the sources say, with quotes and
where. Recommendations are for UX and process only.

A real question goes in the handoff (template below) in two forms: one for the
owner (short, with the readings and their evidence) and a **Discord-ready**
version he can paste as-is — self-contained, plain words, the card text quoted,
no repo jargon, no rule numbers the reader cannot look up.

Fix around an open question only when one reading is the engine's current
behaviour: leave the engine as it is, commit the reproducer as a test pinned to
current behaviour with a comment naming the question, and hand off.

## 6. Plan, then fix

Write a five-line plan (files, the guard tests, what is out of scope) into your
notes before editing. Then:

- Follow the repo's conventions: ledger rows in the same commit as the fix
  (`status: 'fixed'` + guards naming exactly one test title each), CR changes
  through `client/engine/scripts/cr/` (never the rendered output), generated
  data through its command (`npm run extract`, the cr scripts), never by hand.
  Regenerating `data/corpus/algomancy_corpus.jsonl` needs the gitignored
  rulings inputs; if its line count drops, you have lost rulings — stop.
- New test files take the next free number — `ls` all four test dirs
  (`client/engine/test`, `client/ui/test`, `client/server/test`,
  `client/ledgers`) first; numbers collide with other sessions.
- `client/engine/src/cards/sets/index.ts` is append-only.
- Player-visible change → one entry at the **top** of `UPDATES` in
  `client/ui/updates.ts`, dated **tomorrow's date if it is after midnight UTC
  already, else today's** — the day it goes live — written for a player (no
  ids, ≤240 chars). Nothing a player can see → no entry.

## 7. Test — and verify by breaking

- The reproducer is green now. Run every test file you touched or that covers
  the code you changed (`node --test <file>` from its package), plus
  `npm --prefix client/ui run typecheck` and
  `client/engine/node_modules/.bin/tsc --noEmit -p client/server/tsconfig.json`
  and the engine's typecheck when you touched those.
- **Mutation check:** undo the fix (one line), confirm the guard goes red,
  restore it. A guard you have not seen fail is not a guard. Say in the verdict
  that you did this, and what went red.
- Do not run the full gate; the runner does.

## 8. Decide — and write the verdict

| outcome | when | commits? |
|---|---|---|
| `ship` | fixed, guarded, mutation-checked, and **not a UI flow** | yes |
| `stage` | anything a human should look at: UI flows, layout, feel, wording players read, a design choice, a large refactor, anything you are less than sure of | yes |
| `needs-human` | blocked on an owner decision or a rules question; go as far as is sensible first | maybe (reproducer, plan) |
| `already-fixed` | it is fixed on master; you closed the ledger entry with evidence | yes (ledger) |
| `not-a-bug` | by design / cannot reproduce; ledger updated with the evidence | yes (ledger) |
| `skip` | §2's reasons | no |
| `gave-up` | stuck; say exactly what you tried and where it stopped | maybe |

You can always choose `stage` over `ship`. The runner can downgrade your `ship`
to `stage` (policy) — never the other way round. UI flows are the owner's call
because agents are bad at them: when in doubt, stage.

Write `$STEWARD_STATE/outcome.json`. **`item` is exactly the queue line's id
token** — `CT-424`, `#226`, `BL-56`, `triage`, `tidy` (for `repair`/`resume`,
the original item's id) — because the queue keys its memory on it:

```json
{
  "item": "CT-424",
  "outcome": "ship",
  "title": "stolen units can block for their new controller",
  "summary": "Two or three plain sentences: what was wrong, what you changed, how it is proven.",
  "verified": ["replayed QJEY: action 212 refuses the block", "…"],
  "hypothesis": ["…"],
  "rootCause": "one sentence",
  "class": "every site of the same shape, file:line",
  "guards": ["client/engine/test/NNN-x.test.ts::title substring"],
  "mutationChecked": true,
  "playerVisible": true,
  "followups": ["CT-NNN filed: …"]
}
```

For `stage` and `needs-human`, also write `$STEWARD_STATE/handoffs/<file>.md`,
where `<file>` is the item with a leading `#` spelled `report-` (`report-226.md`,
`CT-424.md`, `BL-56.md`) — the same spelling as the branch the runner pushes:

```markdown
# <item> — <title>

**Needs from you:** <one line: "approve the branch", "answer Q1", "approve this plan">

## What I found
Verified: … · Hypothesis: …

## What I changed
Branch `steward/<item>` (the runner pushes it). Commits, files, guards.

## Check it in two minutes
<the exact steps: `steward/review.sh try <item>`, then what to open and click, what you should see>

## Questions          (only if there are any)
### Q1 — <the question in one line>
- Reading A: … — supported by: <quote, source>
- Reading B: … — supported by: <quote, source>
- What the engine does now: A/B. What changes under the other: …
- What I checked that did not settle it: CR …, RAQ titles …, rules-questions …

**Discord-ready:**
> <self-contained question, card text quoted, no jargon>

Answer with: `steward/review.sh answer <item> "…"`
```

## 9. `repair <branch>` — a staged branch whose gate went red

`git checkout <branch>` (the runner fetched it), read the gate log path in the
queue line, fix the failure (your own earlier work — not by weakening a test),
commit, and give the verdict for the *original* item again.

## 10. `triage #a-#b` — new reports came in

The runner already ran `npm --prefix client run reports`; the snapshot has rows
the ledger lacks, and `70-playtest-ledger` is red until each has an entry. For
each new row: read it, find the room/page, check for duplicates and already-fixed,
and add its ledger entry in `client/ledgers/playtest-ledger.ts` — `fixed` only
with a real guard; `by-design`/`wontfix` with the evidence in `note`; otherwise
`agreed-fix` with a CT or BL filed for it (with the evidence you gathered). Do
NOT fix anything in a triage run. The fetch may also have changed `verdicts.snapshot.jsonl` (the owner's card
verdicts — a journal: a later row for the same scenario+room supersedes an
earlier one, and a retraction is a `works` row; `264-verdict-loop` wants a CT for
every standing non-`works` verdict) and `report-marks.snapshot.jsonl`. Handle
those the same way. Commit the snapshots and the ledgers together.
Outcome `ship` (ledger-only). The fixes come on later nights, one per run.

## 11. `tidy` — keep the queues honest (ledger-only)

Pick at most a handful of these and stop: a BL whose work has shipped but is
still `open` (close with `evidence`); a CT whose proof is already false; a
duplicate pair; a `touches` path that moved; a parked note whose primitive now
exists. Never invent new work here. Outcome `ship`.
