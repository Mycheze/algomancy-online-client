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
5. **Never edit** `deploy/`, `CLAUDE.md`, `.claude/` outside `.claude/skills/steward/`,
   any `package.json` or lockfile. If
   one of those is the problem, say so in a handoff. `steward/` and
   `.claude/skills/steward/` (your own harness) you MAY fix when the item's fault
   is there, and in a `retro` (§15). A change to this skill's TEXT alone ships
   (up to 150 lines); anything in `steward/` goes to the owner (outcome `stage`,
   and the policy forces it anyway), and the runner judges your work with its own
   copy of `steward/`, never yours. Do not edit them for any other reason.
6. **Downloading.** `curl` and `wget` are denied. A file the owner sent — an
   attachment OR a link in his text — is **already on disk**: the request (or
   answer) lists it under "Files he sent — ALREADY DOWNLOADED". For any other
   image or PDF link, `node steward/fetch-file.mjs '<url>'` saves it and prints
   the path. **Never ask the owner for a file you have a link to** (2026-11-06:
   he sent Mindburn's new scan as a link, the run left the old scan in place and
   asked him to paste it — "Like you can't figure out how to download an
   IMAGE?"). Only if the helper fails too (an expired Discord link says so) do
   you ask, and then for an attachment.
7. **Commit your work** on the detached HEAD before you finish — the runner
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
skip, say why in your verdict (outcome `skip`; when you skip lines to take a
later one, the reasons go in `skipped`, not the summary):

- it is already fixed on master (then it is not a skip — close it: see §8,
  `already-fixed`);
- a journal rejection says not to do it this way and you have no other way;
- it needs a decision nobody has made, AND you cannot even prepare it (rare —
  usually you *can* prepare it; that is outcome `needs-human`).

Queue line kinds: `fix-master` (master's own gate is red — §12), `repair
<branch>` (a staged branch whose gate went red — fix it on that branch, see §9),
`resume <item>` (answered — finish it), `triage #a-#b` (new reports — see §10),
`inbox inbox-<id>` (a request the owner typed into #steward — §13),
`retro retro-<day>` (the daily look at your own weak points — §15),
`report #N`, `CT-N`, `BL-N`, `tidy` (§11).

**Never skip `fix-master` to work on something else**: while master is red every
branch you make is red too, and a night of red branches is a night lost
(2026-11-03: six items, six red gates, all for one line on master).

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

A real question goes in the handoff (§8b) in two forms: one for the
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

**The owner's standing order (2026-11-05):** the point of you is that things get
fixed *without him*. On the morning of 2026-11-05 he woke to ten approval
threads — a one-sentence glossary fix, a "pay"/"pays" typo, dead code, a
sideboard export, a clipped glow — and said: *"I don't want to manually approve
all those things I can just approve … make sure the actual approval requests are
important."* Every thread you open costs him attention. Open one only when his
answer would change what you do.

| outcome | when | commits? |
|---|---|---|
| `ship` | **the default.** Fixed, guarded, mutation-checked. This includes: wording that now matches the rules or the printed card; a typo or grammar fix; a layout or styling fix inside an existing screen (clipping, overflow, a glow, an ellipsis); a fix that makes an existing button or export do what it says; dead code removed; ledger/CR work; a rules fix that follows a designer quote, a RAQ thread or an owner answer; a test baseline that moved *because of* your fix (§8a) | yes |
| `stage` | **only** these: (1) a UI **flow** — a screen, dialog or step added, removed or rebuilt, or a button that now does something different from what players expect; (2) a choice with two genuinely different results players would notice, that no source settles and that is not cosmetic; (3) a refactor too big to read in a commit message; (4) your own harness's CODE (`steward/`) — this skill's text alone ships | yes |
| `needs-human` | blocked on a decision only the owner can make (a rules question that passed the "of course, you fool" test in §5, or a design call under `stage` (2)) — go as far as is sensible first | maybe (reproducer, plan) |
| `already-fixed` | it is fixed on master; you closed the ledger entry with evidence | yes (ledger) |
| `not-a-bug` | by design / cannot reproduce; ledger updated with the evidence | yes (ledger) |
| `skip` | §2's reasons | no |
| `gave-up` | stuck; say exactly what you tried and where it stopped | maybe |

**Never stage for these** — each one was a real thread on 2026-11-05 that should
not have been:

- *"Wording players read."* If it now matches the CR and the printed card, ship.
- *"No browser on the box could look at it."* The tests you wrote and broke are
  the check. Ship, and say in the summary what you could not see.
- *"The CT left a choice to the owner"* when the choice is cosmetic or minor
  (glow size A vs B, which of two sensible defaults). Pick the one that changes
  the least, ship, and name the other option in the summary — he can reverse it
  with one message. ("This is minor and I don't care" — owner, on exactly that.)
- *"It touches a UI file."* The runner's policy decides that, not you.
- *"Someone should try it on a real iPad / device."* Ship what you have; put the
  device check in `followups` (it appears in the night log). It is never an
  approval request.
- *"Less than sure."* Being unsure of a small fix means test it more, not ask.
  Being unsure whether a *rule* is right is §5, and §5 almost always has an answer.

### 8a. A golden or census test moved because of your fix

`800-cc-drift-guard` ("NEVER re-bless"), the announcement censuses, and other
pinned baselines exist to catch *unintended* change. When your fix is a rules
change and the baseline moved because of it: replay or list exactly which
entries moved, confirm **every** one involves the cards or the rule you changed,
re-bless only those, and say so in the commit message and the summary ("800:
one reference run changes — it pays Malevolent Machinations with two units,
which now die together"). That is `ship`. If any moved entry has nothing to do
with your change, you broke something: fix it, do not re-bless.

You can always choose `stage` over `ship` — but only for the reasons above. The
runner's policy can downgrade your `ship` (a new screen, protected files, size);
never the other way round.

Write `$STEWARD_STATE/outcome.json`. **`item` is exactly the queue line's id
token** — `CT-424`, `#226`, `BL-56`, `triage`, `tidy` (for `repair`/`resume`,
the original item's id) — because the queue keys its memory on it:

```json
{
  "item": "CT-424",
  "outcome": "ship",
  "title": "stolen units can block for their new controller",
  "summary": "Two to four plain sentences a player could follow: what was wrong at the table, what it does now, and how you know. No test numbers, file names or rule numbers — those go in verified/guards.",
  "verified": ["replayed QJEY: action 212 refuses the block", "…"],
  "hypothesis": ["…"],
  "rootCause": "one sentence",
  "class": "every site of the same shape, file:line",
  "guards": ["client/engine/test/NNN-x.test.ts::title substring"],
  "mutationChecked": true,
  "playerVisible": true,
  "followups": ["CT-NNN filed: …", "worth a look on a real iPad: …"],
  "skipped": "queue lines you passed over and why — never in the summary"
}
```

The `title` and `summary` are what the owner reads in the night log and when a
thread closes. Write them in the "Recent updates" register (CLAUDE.md): what a
player would notice, in plain words.

### 8b. The handoff — only for `stage` and `needs-human`

Write `$STEWARD_STATE/handoffs/<file>.md`, where `<file>` is the item with a
leading `#` spelled `report-` (`report-226.md`, `CT-424.md`, `BL-56.md`) — the
same spelling as the branch the runner pushes.

**The reader** is the owner, on his phone, in Discord, first thing in the
morning. He has *not* read the CT, the CR record, the test, or anything you
read tonight; he does not remember what CT-474 is; he cannot run a command.
The Discord post shows **Needs from you** and **In short**, and attaches the
rest. Those two must stand alone: if he reads only them, he can answer.

Rules for **Needs from you** and **In short** (the reviewer of 2026-11-05 could
not decode *"Verified: the second gate's only failure was 409 (6), the
stale-rules pin. Closed finding F-U24-4 quotes 244's …"*):

- Name the card, the screen and the moment in the game, as a player would.
- No test numbers, file names, function names, CR/rule numbers, finding ids,
  branch names, commit hashes, "gate", "golden", "guard", "policy". No command
  to run — ever. (The technical record goes under **Details**.)
- Say what happens if he says yes, and what happens if he says no.
- **Needs from you** is a question he can answer in one reply: "Should X or Y?",
  "OK for the deck screen to work like this?" — never just "approve the branch".

```markdown
# <item> — <plain title, what a player would notice>

**Needs from you:** <one question, answerable in one reply>

## In short
<3–6 plain sentences. What players saw before. What was wrong. What it does now
(on this branch). Why this one needs him (the one §8 `stage`/`needs-human`
reason, in plain words). What yes does, what no does.>

## The choice          (only when there is one)
- **A — <name>:** what players would see. <This branch / the engine today.>
- **B — <name>:** what players would see.
- For a UX choice, your pick and why. For a rules question, what the sources
  say for each reading (quoted, with who said it) — never a recommendation.

**Discord-ready:**      (rules questions only)
> <self-contained question for the server, card text quoted, no jargon>

## Details
Verified: … · Hypothesis: …
Branch `steward/<item>`: commits, files, guards, the mutation check. Anything a
developer would want; this part may be as technical as it needs to be.
```

## 9. `repair <branch>` — a staged branch whose gate went red

`git checkout <branch>` (the runner fetched it), read the gate log path in the
queue line, fix the failure (your own earlier work — not by weakening a test),
commit, and give the verdict for the *original* item again.

You only see real failures here: a branch that was red only because master was
is re-gated by the runner itself once master is green, and never queued.

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

**Only a triage run commits the snapshots.** On any other item the fetched rows
are in your tree but not yours: leave them uncommitted (`70-playtest-ledger`
may be red in your targeted runs because of them — that is expected), and the
runner puts the snapshot back to master's before it commits or gates anything.
Outcome `ship` (ledger-only). The fixes come on later nights, one per run.

## 11. `tidy` — keep the queues honest (ledger-only)

Pick at most a handful of these and stop: a BL whose work has shipped but is
still `open` (close with `evidence`); a CT whose proof is already false; a
duplicate pair; a `touches` path that moved; a parked note whose primitive now
exists. Never invent new work here. Outcome `ship`.

## 12. `fix-master` — master's own gate is red

The runner gated clean `origin/master` and it failed; the queue line names the
failures and the log. Nothing else can go green until this is fixed, so:

1. Read the log. Confirm it on clean master with the one test file (not the gate).
2. Find what introduced it (`git log -S`, `git log -- <file>`). Fix the cause in
   the smallest honest way — never by loosening the test that caught it, unless
   the test itself is provably wrong (then say exactly why in the handoff).
3. Item id `fix-master`. Outcome `ship` when the fix is ordinary code the policy
   allows; `stage` when it is in `steward/`, `.claude/` or anything else
   protected (rule 5) — write the handoff (§8b) so the owner can approve it in one
   read: what broke, why, the fix, in plain words; the technical record under Details.
4. If the fix is in `deploy/`, `CLAUDE.md` or a lockfile, outcome `needs-human`
   with the exact change written out.

## 13. `inbox inbox-<id>` — the owner asked for something directly

He typed it into #steward; the queue line names the file
(`$STEWARD_STATE/inbox/<item>.md`: his words, and screenshots to Read). Treat it
like a report from the one player whose word is final on how the game should
behave — but still prove before you change: reproduce a bug, find the rule for a
rules point (§5), find the code for a UI point.

- **A card changed** — a new scan, new text, a new cost, "X has the wrong
  version": §14, the whole recipe, in this one run. A card update is never "too
  big for one run" and never half-shipped.
- **Small and clear** (a wording, a value, a bug he describes exactly): do it,
  the usual way — evidence, fix, guard, mutation check. Outcome by §8 (a fix ships; only a
  new or rebuilt screen is `stage`).
- **Too big for one run**: file it (a BL in `backlog.ts`, or a CT), with his
  words quoted and what you found; outcome `ship` (ledger-only), and the summary
  names the ticket.
- **Unclear, or two real readings**: `needs-human` with the handoff's questions —
  it is posted in the thread on his message, and his reply resumes you.
- **A question, not a change**: answer it in the summary (with the source), outcome
  `not-a-bug` if nothing needs changing.

Item id is the `inbox-<id>` token. Your **summary is what he reads** in the thread
when it closes: say in plain words what you did and what he will see — the same
standard as the "Recent updates" lines (CLAUDE.md), not repo jargon.

## 14. A card changed — the card-update recipe

The designer (Caleb) is changing Light & Dark cards again, and his changes reach
us only as the owner's message in #steward: a card name, usually the new scan
(attached or linked), sometimes the new words typed out. A message that short is
the whole brief — **do every step below without being asked**, for every card
in the message, in one run. Done is: the new scan is in the repo, every field
matches it, the engine plays the new text, the tests prove it, the bot's corpus
says it, and players get an update line. The 2026-11-06 round (Mindburn,
Murkstalker, The Everywhere, Seer of Empty Spaces) is the worked example:
`git log --grep='card update' -i`.

**THE SCAN IS THE AUTHORITY.** Our oracle and scans are now the most current
record of the cards anywhere; algomancer.cc is not Caleb's site, is stale, and is
never evidence (its daily check was retired on 2026-11-06 for being wrong).
When his typed text and the scan say the same thing in different notation, the
scan wins silently. When they differ **in meaning** (2026-11-06: he typed "As I
spawn, name a card. That card loses all abilities"; The Everywhere's scan says
"As I am played or modded, name a card. My last named card loses all
abilities"), that is a real question: do everything else, then `needs-human`
with both wordings quoted (it was the scan, that time). No scan at all → the
typed text is the source; say in the summary that the scan is still the old one.

1. **The scan.** Use the downloaded file (rule 6). Our scans are
   `data/cards/<Card-Name-With-Hyphens>.jpg`, 720x1000 JPEG — find the existing
   name with `ls data/cards | grep -i <word>`. Convert a webp/png or a different
   size with Pillow (`.venv/bin/python`, `Image.open(..).convert('RGB').resize((720,1000)).save(.., quality=92)`).
   A brand-new card is a new name: see how `7395cb62` and the Light & Dark
   batches registered one before you start (sets/index.ts is append-only).
2. **Read both scans** (Read the image files — old from `git show HEAD:data/cards/<file>`
   into the scratch dir). Compare EVERY field, not just the one he named: name,
   the cost orb (number = `total_cost`; pips = `cost` letters — crop and zoom
   the orb, pips are what transcriptions get wrong), power/toughness, the type
   line and its glyphs (`{Haste}` chevrons, `{Battle}`), an alternative-cost
   banner, the rules text. Write down old → new for each.
3. **The oracle row**, in place in `data/cards/AlgomancyCards-OracleText.json`:
   the changed fields in house notation (`[Switch1]`, `[Augment]`, `{i}(…)`
   reminder text, `{/n}` only where the card breaks the line), and
   `revision_date_time` = today. Nothing else in the row.
4. **Regenerate what reads the scans** — all four, in this order (each walks
   every scan; minutes each on the box, run them in the background):
   `.venv/bin/python bot/pipeline/build_anchors.py`, `classify_complexity.py`,
   `read_text_boxes.py`, `read_card_faces.py`, then `read_card_faces.py --report`:
   **zero contradictions for the changed cards**, or the oracle row is still
   wrong. Score drift on other cards is normal; a changed classification is not.
   Then `npm --prefix client/engine run extract`.
5. **The engine.** `grep -rn "card('<Name>'" client/engine/src/cards/sets/` — its
   definition, its comment (which quotes the printed text: update the quote and
   say when and why it changed), every hard-coded amount. A new trigger timing
   or new verb: find the analogous cards (§5.5) and reuse their machinery. A
   cost change needs no engine edit (it reads printed.json) but does need the
   checks in 7.
6. **Everything that names the card**: `grep -rln "<Name>" client/ data/comprehensive-rules/rules bot/test`.
   Tests that pin the old behaviour (rewrite them for the new text — and add
   one that would have failed on the old text; break it to see it red),
   `client/ui/does-lines.json` (test 344), scenario prompts in
   `client/server/scenarios-*.ts`, CR records that quote the old text (fix the
   record, re-verify and re-render through `client/engine/scripts/cr/`, never
   the output).
7. **Weekly Challenges** use real cards with stored solutions:
   `grep -ln "<Name>" client/server/challenge-solve.ts client/server/challenge-runs/*.json`.
   If any hit, run `506-challenge-reference-runs` and `800-cc-drift-guard`. A
   stored run that no longer plays out is a challenge the change broke: if that
   challenge is not live yet, re-solve it (`challenge-solve.ts`); if it is live
   or past, `needs-human` — say which week and what broke.
8. **The bot's corpus**: `.venv/bin/python bot/pipeline/build_corpus.py` (it needs
   PyMuPDF — the runner installs `bot/pipeline/requirements.txt` — and the
   rulings export, which `steward/review.sh sync-rulings` put in this clone).
   Commit `data/corpus/algomancy_corpus.jsonl`; then the bot's tests
   (`.venv/bin/python bot/test/run_all.py`), whose goldens may quote the card.
9. **Targeted tests**: every file from 6 and 7, plus 142 (static conformance),
   150 (registration order), 344 (does-lines), 81 (the card drill). The
   runner runs the full gate.
10. **The update line** in `client/ui/updates.ts`, one per batch: what a player
    will notice — "Murkstalker now costs 2 and drains 1 instead of 3." Then
    outcome `ship`: a card that now matches its printed face is a rule-spelled
    fix (§8), whatever it touched.

The summary he reads lists each card and what changed on it (cost, text, art),
and anything you could not do, plainly — never "see the commit".

## 15. `retro retro-<day>` — make tomorrow's runs better than today's

Once a day the runner measures the last day's runs (`steward/retro.mjs`) and
the queue hands you the digest: every run ranked by how much it deserves a look,
with its permission denials, tool errors, repeated commands, minutes, turns,
the places its summary admitted stopping short, and what the owner said back.
Your item is the **harness**, not the game: find what made runs slow, stuck or
half-done, and fix the CAUSE so no future run hits it.

1. Read the digest. Then `git log --oneline -25 -- .claude/skills/steward steward/`
   and the journal's last `retro-*` rows: do not re-fix what an earlier retro
   already fixed. If its fix did not take, that is the finding.
2. Open the transcripts of the top two or three runs (the digest gives the path
   and a `jq` line). Find the moment the run lost its way: the denied command
   and what it was trying to do, the loop it went round, the half-hour test it
   ran four times, the question it asked the owner that a source answered.
3. Name the cause, one of:
   - **the skill did not say** — the run had to work out something a sentence
     would have told it (a recipe, where a file is, which test covers what):
     write that sentence, in the section the run was in;
   - **the skill said, the run did not do it** — the instruction is buried or
     vague: move it up, make it a rule with its incident, cut what surrounds it;
   - **a tool, permission or dependency is missing** — the run could not do the
     right thing at all (2026-11-06: no way to download an image): fix it in
     `steward/` (a helper, the deps the runner installs, the settings), which is
     `stage`, and say in the skill how to use it;
   - **the repo is in the way** — a flaky or slow test, a misleading error: a CT
     or BL with the evidence, not a fix tonight.
4. Keep the skill short. **Replace before you add**; every new rule names the
   incident it comes from (date, item), the way the rules above do. Never more
   than 150 changed lines. A day with nothing worth changing is outcome
   `not-a-bug`, summary "a quiet day" and the one number you watched.
5. Outcome `ship` when only this skill changed; `stage` when `steward/` did
   (the policy decides anyway). The summary goes to the night log: in plain
   words, what went wrong yesterday and what you changed so it won't again —
   "Runs were asking you for card images they could not download. They now
   fetch the links you send." Not file names.

