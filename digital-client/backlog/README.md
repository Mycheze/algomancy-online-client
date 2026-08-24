# The backlog

Everything the owner wants built on the digital client that is **not** "make
the cards work", captured in enough detail that an agent with an idle hour can
pick one up and finish it without another interview.

It is a data structure, not a document, because that is what was asked for:

> "Instead of putting them in a text file, I want to give them to you to track
> and make a db of things to do with detail. That way, when there's down time,
> an agent could look to check something off." — 2026-08-24

## Priority

**Nothing in here outranks the card and engine work.** `engine/test/card-todo.ts`
is the queue that matters. This is the queue for when that one is blocked, or
the session is too short to be useful there.

The one exception is `BL-24` — it turned out to be a bug report, not a feature,
and card bugs are the project's stated top priority.

## Using it

```
cd digital-client/backlog

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

`backlog.test.ts` runs on `npm run check` from `digital-client/`. Its most
useful assertion is that every path in `touches` still exists — when a file
moves, the suite names the entry that is now pointing at nothing, which is the
specific way a list like this usually rots into a text file again.
