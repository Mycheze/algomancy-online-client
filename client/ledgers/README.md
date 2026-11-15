# `ledgers/` — every work queue, in one place

| file | what |
|---|---|
| `open/CT-n.ts` | one open card or engine ticket; deleted when it closes |
| `open/BL-n.ts` | one open backlog ticket: anything else the owner asked for |
| `settled.jsonl` | every settled report, ticket and verdict: append-only, last row per id wins, `merge=union` |
| `tickets.ts` | the reader, and the ticket types with a line on each field |
| `tickets.test.ts` | the locks (below) |
| `report.ts` | `npm run ready`: the open work and the next free ids |
| `card-ledger.ts` · `claims.ts` · `unreached.ts` · `scenario-queue.ts` | derived queues over the card pool |
| `playtest-issues.snapshot.jsonl` | committed copy of the server's live `var/issues.jsonl`; report `#N` is its line N, from 0 |
| `verdicts.snapshot.jsonl` | committed copy of `var/verdicts.jsonl` — the owner's card verdicts from the scenario tester |
| `report-marks.snapshot.jsonl` | committed copy of the admin's 👍/👎 marks |
| `raq.ts` | every Discord rulings thread, read against the engine (engine/test/386) |
| `raq-threads.snapshot.jsonl` | the index of those threads — `npm run raq:index` after `bot/pipeline/export_rulings.sh` |
| `rules-questions.snapshot.jsonl` | the designer's cited rules-questions messages, verbatim — `npm run rq:index -- <id>…` |

Nothing in here outranks the card and engine work: the CTs are the queue that
matters; a BL is for when that one is blocked.

## Step 0 of every round: `npm run reports`

```
cd client
npm run reports     # snapshot 405 -> server 409: 4 new reports
```

The in-game Report button appends to `var/issues.jsonl` on the deploy box, which
nothing in this repo can see; the snapshot is the committed copy, and a report it
does not hold does not exist as far as the suite is concerned. Run the fetch
before you look at the queue. 255-refresh-command keeps the command honest; no
test can tell you the snapshot is stale.

## The shape

A settled row:

```
{"id":"#399","on":"2026-11-15","as":"ticket","to":["CT-564"],"note":"what triage found"}
{"id":"CT-564","on":"2026-11-16","as":"done"}
{"id":"#399","on":"2026-11-16","as":"fixed","to":["CT-564"]}
{"id":"verdict:rebuke-refused@DWYV","as":"ticket","to":["CT-178"]}
```

`as` for a report: `ticket`, `partial`, `fixed`, `by-design`, `wontfix`,
`agreed-fix`; for a CT `done` or `wontfix`; for a BL `done`, `wontfix` or
`dropped`. The meaning of each is on `SettledRow` in `tickets.ts`. Rows migrated
from the old TS ledgers carry `legacy: true`; their prose is at
`refs/archive/ledgers-2026-11` (`git show refs/archive/ledgers-2026-11:client/ledgers/card-todo-closed.ts`).

- **Open a ticket**: copy a file in `open/` to the next free id (`npm run ready`
  prints it). Never reuse or renumber an id.
- **Close it**: delete the file, append its row, and append the outcome of every
  report whose `to` names it.
- **Guard it**: the test that fails when the fix regresses carries the id in its
  title (`CT-564: …`, `#399: …`).

## The locks (`tickets.test.ts`)

1. Every report in the snapshot has a `#N` row; every `to` names an open file or
   a settled row; a report still `ticket`/`partial` points at something open; a
   `by-design` cites its source.
2. Every open CT proof still holds — when one goes false the ticket looks fixed.
   An open id never has a settled row.
3. Every non-legacy `done`/`fixed` row has a test whose title carries its id.

264-verdict-loop adds the verdicts' lock: every standing non-`works` verdict has
a `verdict:<scenario>@<room>` row.

⚠ **The verdict file is a journal, not a set of statuses.** A later row for the
same scenario and room supersedes an earlier one: the owner retracts his own
verdicts, and a retraction is a `works` row. `grep -v '"works"'` finds the
outstanding verdicts and hides the retractions; read 264 §1a before filtering it.
