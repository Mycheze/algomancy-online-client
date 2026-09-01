# `ledgers/` — every work queue, in one place

Five queues used to live in three places, and four of them were filed under
`engine/test/` — where they read as tests and were not. They are **data**: what
is outstanding, what was decided, and why. `backlog.test.ts` is the only actual
test here, and it exists to keep the entries honest.

| file | queue |
|---|---|
| `card-todo.ts` | **the one that matters** — card and engine tickets (CT-nn) |
| `playtest-ledger.ts` | every owner bug report, with what was done about it |
| `backlog.ts` | non-card work the owner asked for (BL-nn) — the rest of this README |
| `card-ledger.ts` · `claims.ts` · `unreached.ts` · `scenario-queue.ts` | derived queues over the card pool |
| `playtest-issues.snapshot.jsonl` | committed copy of the server's live `var/issues.jsonl` |
| `verdicts.snapshot.jsonl` | committed copy of the server's live `var/verdicts.jsonl` — the owner's card verdicts from the scenario tester |

## Step 0 of every round: `npm run reports`

```
cd client
npm run reports     # snapshot 135 -> server 147: 12 new reports
```

The owner's in-game 🐛 button appends to `var/issues.jsonl` **on the deploy
box**, and nothing in this repo can see that file. `playtest-issues.snapshot.jsonl`
is the committed copy, and `engine/test/70-playtest-ledger.test.ts` checks
`playtest-ledger.ts` against it row by row — so a report that has not been
copied down does not exist as far as the suite is concerned.

### The verdicts are the other half, and they had no lock at all

`npm run reports` also brings down the scenario tester's **verdicts** — the
owner's own judgement on a card he has just played, which docs/14 §6 says is
ground truth in a way no assertion is. Until round 36 those landed only in
gitignored `var/`, and `fetch-reports.mjs` said why in a comment: *"the
transcription in ledgers/unreached.ts is read by a human."*

That is the arrangement the snapshot above exists to replace, and it cost a
real item: **Necromantic Rebuke**, a `slightly off` verdict from 2026-08-27 that
was never ticketed, and whose only record was a prose comment in
`unreached.ts` where nothing could fail on it. It is CT-178 now.

So verdicts have a committed snapshot too, and
`engine/test/264-verdict-loop.test.ts` asserts that **every standing non-`works`
verdict has a `card-todo.ts` entry naming that card** — the same lock
`83-card-todo.test.ts` §4 already put on reports.

⚠ **THE VERDICT FILE IS A JOURNAL, NOT A SET OF STATUSES, AND READING IT AS ONE
IS THE TRAP.** A later row supersedes an earlier one for the same
**(scenario, room)** — the owner retracts his own verdicts, in his own words
*"supersedes the … verdict on this same room"*. Round 36 got this wrong three
times over: the sweep that found the gap, the guard's first version, and the
ruling's first draft all reported that a `broken` verdict on Vengeance had gone
unanswered for five days. He had **retracted it himself 20 minutes later**, and
the retraction was the last line of the file.

All three missed it identically — `grep -v '"works"'`, or the typed equivalent.
**The filter that finds the outstanding verdicts is exactly the filter that
hides the retractions**, because a retraction is a `works` row. `playtest-ledger.ts`
already knew this about reports (#114 retracted by #115 twenty-nine minutes
later, #80 and #128 withdrawn by their author) and carries the retraction as its
own row. If you are about to filter this file, read §1a of the guard first.

**Run it before you look at the ledger, not after.** On 2026-08-30 the snapshot
was 135 rows and the server had 147: twelve owner reports, four of them
engine-level, that nothing in the repo knew about while the ledger said "0
live" and the whole gate was green. The cause was mechanical, not sloppiness —
the documented refresh was an scp naming `client/server/issues.jsonl`, where
the file lived before the reorg moved it to `var/`. It fetched nothing, quietly,
for three rounds.

So the command is now a script (`engine/scripts/fetch-reports.mjs`), its paths
come from `engine/scripts/paths.mjs`, and it is loud when it cannot reach the
server. `engine/test/255-refresh-command.test.ts` fails if a remote path
written down anywhere in this repo stops matching those constants. What no test
can do is tell you the snapshot is stale — only the fetch talks to the server.
That gap is real; the one-word command is the whole mitigation.

## The backlog

Everything the owner wants built on the digital client that is **not** "make
the cards work", captured in enough detail that an agent with an idle hour can
pick one up and finish it without another interview.

It is a data structure, not a document, because that is what was asked for:

> "Instead of putting them in a text file, I want to give them to you to track
> and make a db of things to do with detail. That way, when there's down time,
> an agent could look to check something off." — 2026-08-24

## Priority

**Nothing in here outranks the card and engine work.** `card-todo.ts`, beside
this file, is the queue that matters. This is the queue for when that one is blocked, or
the session is too short to be useful there.

The one exception is `BL-24` — it turned out to be a bug report, not a feature,
and card bugs are the project's stated top priority.

## Using it

```
cd client/ledgers

node report.ts              # what is ready to pick up, shortest first
node report.ts --all        # every entry, grouped by status
node report.ts --asks       # the questions waiting on the owner
node report.ts BL-19        # one entry in full — enough to start from
node report.ts reset-blocks # same, by slug

npm run check               # typecheck + the honesty test
```

"Ready" means: open, no unmet dependency, no unanswered design question, and
not XL. Those exclusions are the point — a down-time slot is the wrong place to
start a project or to guess at a decision the owner has not made.

## Working an entry

1. `node report.ts <id>` and read the whole thing, including `ALREADY DECIDED`.
   Those are settled; re-opening them wastes the interview that produced them.
2. If you disagree with `WHICH MEANS`, read `THE OWNER SAID`. The quote is the
   tiebreaker, not the interpretation — several of the interpretations in this
   file were wrong on the first pass and had to be corrected.
3. Build it against `DONE WHEN`. Every line there is something a human can
   check in the running client.
4. Flip `status` to `'done'` and add `evidence: { commit, guards }`. The test
   refuses a `done` without a commit sha and a test that would fail if the work
   regressed — "done" in a commit message is not done, which is a lesson
   `playtest-ledger.ts` learned from reports #10 and #28.

## Editing it

Add entries freely; the schema is in `backlog.ts` and the test will tell you
what a new entry is missing. Two rules worth stating out loud:

- **Never renumber an id.** Commit messages and other files cite them.
- **`said` must be the owner's actual words.** An entry nobody can trace back to
  a request is an entry somebody invented, and the test rejects an empty one.

`backlog.test.ts` runs on `npm run check` from `client/`. Its most
useful assertion is that every path in `touches` still exists — when a file
moves, the suite names the entry that is now pointing at nothing, which is the
specific way a list like this usually rots into a text file again.

## Answers folded 2026-08-25

The 29 questions this backlog was carrying in `asks` were exported with
`node report.ts --asks`, put to the owner as a fill-in-the-blanks file, and all
29 came back answered. Every answer is now folded into `backlog.ts`: out of
`asks`, into `decided`, in his verbatim words, dated 2026-08-25.

**The source file was `~/Downloads/algomancy-open-questions.md`. It is not in
git and will not survive** — the `decided` lines are the only record of it, which
is exactly why they quote rather than summarise.

Three of the answers did more than close a question:

- **The clock is 60 minutes, not 40.** BL-04's question said "the 40:00 chess
  clock already exists per room"; `CLOCK_START_MS` in `server/rooms.ts` has been
  `60 * 60 * 1000` since 2026-08-20. `backlog.test.ts` now reads that constant
  and checks BL-26 against it, so the number cannot drift in prose again.
- **Four answers created work with no entry:** BL-26 and BL-27 (make the timers
  optional and configurable, then make running out of time lose the game),
  BL-28 (name-claiming is wrong for a public deploy), BL-29 (spectators and
  replays).
- **BL-09 lost its footing.** Asked whether docs/07 was still the visual brief,
  the owner answered "I don't know what docs/07 is". The entry is re-framed as a
  documentation reconciliation rather than kept or dropped quietly, and the real
  visual brief — "general light sprucing up ... mostly in non gameplay related
  areas" — now lives on BL-10.

`node report.ts` went from **3 ready of 20 open** to **15 ready of 24 open**.
One question is open again, on BL-29, and it was asked by this pass rather than
left over from the last one.
