# `data/comprehensive-rules/` — the comprehensive-rules export

> **UNOFFICIAL.** This is a numbered rules document for **this project's
> digital client**: what the client enforces, and why. It is not Caleb Gannon's
> rulebook and does not speak for the game. Where it and the published
> Manual disagree, the Manual is the game; this document is our client. The
> card text and rules text it quotes are Caleb Gannon's, used with permission
> on the terms in [`../NOTICE.md`](../NOTICE.md).

Built by the scripts in `client/engine/scripts/cr/` from four kinds of input:
the printed text (`data/rules/`, the card pool), the designer's own answers
(the RAQ threads in the Discord export), our R-rulings
(`client/docs/digital-rules.md`), and the engine's tests. Every path below is
named in `client/engine/scripts/paths.mjs` (`CR_*`); `bot/paths.py` names the
directory and the document. Do not spell them again.

## Layout

```
data/comprehensive-rules/
  README.md                            this file
  Algomancy-Comprehensive-Rules.md     THE document              generated   CR_DOC
  Algomancy-Comprehensive-Rules.html   the same, one HTML page   generated   CR_DOC_HTML
  Algomancy-Comprehensive-Rules.txt    the same, plain text      generated   CR_DOC_TXT
  Annex-D-Digital-Conventions.md       digital-only conventions  generated   CR_ANNEX_D
  rules/*.json                         the rule records, one file per section   CR_RULES_DIR
  rules/glossary.json                  the glossary: pointer rows (term → rule)  CR_RULES_DIR
  ledger.json                          rule key -> number        reviewed    CR_LEDGER
  supersession.json                    ruling -> ruling edges    reviewed    CR_SUPERSESSION
  classification.json                  ruling -> scope, sections reviewed    CR_CLASSIFICATION
  verdicts/<unit>.json                 the verifier's verdicts   reviewed    CR_VERDICTS_DIR
  discrepancies/<unit>.json            what did not reconcile    records     CR_DISCREPANCIES_DIR
  discrepancies.md                     the report, four tiers    generated   CR_DISCREPANCIES_MD
  owner-questions.md                   its tier 1: the owner's questions  generated  CR_OWNER_QUESTIONS
  findings/<unit>.json                 engine bugs -> CT tickets records     CR_FINDINGS_DIR
  changelog.md                         what changed per edition  generated   CR_CHANGELOG
  outline.json                         chapters, sections, slots reviewed    CR_OUTLINE
  front-matter.md                      the introduction          hand-written CR_FRONT_MATTER
  build/                               extract output, packs     gitignored  CR_BUILD_DIR
  build/verify-input/, build/verdicts/ the verifier's in and out gitignored  CR_VERIFY_INPUT_DIR, CR_VERIFY_OUTPUT_DIR
  build/harness/<unit>/                mutants, judgements, feedback gitignored CR_HARNESS_DIR
  build/review.json                    the review page's document, for debugging only  gitignored  CR_REVIEW_DEBUG_JSON
```

The rules review page in the client (`/api/cr/*`, `client/ui/crreview.ts`)
reads no file here of its own: the game server calls `render.mjs`
`buildReview()` on the records, the same code that writes the editions, and
caches the result until one of the files it read changes. So nothing
review-shaped is committed, and the page cannot disagree with the document.
`npm --prefix client run cr:render -- --review-json` writes what it builds to
`build/review.json` (and writes nothing else).

The scripts are `client/engine/scripts/cr/*.mjs`. The gate is
`client/engine/test/409-comprehensive-rules.test.ts`.

## Generated vs reviewed — never hand-edit either

| kind | files | how it changes |
|---|---|---|
| **generated** | the document (`.md` `.html` `.txt`), Annex D, `discrepancies.md`, `owner-questions.md`, `changelog.md` | re-run the scripts. A wrong sentence is fixed in its record, re-verified, re-rendered — never in the output. |
| **records** | `rules/*.json`, `discrepancies/*.json`, `findings/*.json` (one file per drafting unit) | written by the draft/verify rounds (findings also by `harness.mjs finalize`); the document's source. |
| **committed reviewed state** | `ledger.json`, `supersession.json`, `classification.json`, `verdicts/*.json` | append/edit only through the cr scripts. A decision someone made; nothing can rebuild it. |
| **gitignored** | `build/` | scratch, rebuilt on every run |

### The discrepancy tiers

Each `discrepancies/<unit>.json` row carries a `tier`:

1. **Questions for the owner**: only where the authoritative source's own words
   support two readings and no higher source decides. Such a row carries a
   `question` (`topic`, `ask`, `readings[{label, text, table}]`, `follows`,
   `recommend`), and `owner-questions.md` is rendered from those rows alone.
2. **Register and test fixes**: settled by the authority order, with a fix on
   our side (a register mark, a test title, a glossary row, an engine CT ticket,
   or a rule to redraft).
3. **Engine-only and owner-only rules**: no printed or designer source; the
   rule awaits sign-off.
4. **Everything else.**

A question filed by more than one unit is kept once; the others are listed in
its `seeAlso` (`{id, rule}`), their quotes unioned into its `sides`, and the
document points at the kept row from every one of those rules.

`ledger.json` is **append-only**: a published number is a citation someone may
hold.

## Authority order

From strongest to weakest:

1. A RAQ `[Solved]` write-up by `_passer`, or `calebgannon`'s own words.
2. Printed text, read literally. Where Caleb states an intent that differs from
   print, follow Caleb.
3. Our R-rulings.
4. Owner calls with no designer source: still the engine's law, but
   basis = owner.

Other players are not authority. A thread that is still open is not a ruling.
`client/ui/glossary.ts` is OUR text (typed `ours`) and never counts as
authority. When two readings are equally available, take the permissive one.

When a ruling and the engine disagree, the rule states the RULING (current
law under this order) and carries an inline marker "engine differs, see
<finding id>"; the divergence is filed as a CT ticket in
`client/ledgers/card-todo.ts`, not fixed here.

## THE ANTI-HALLUCINATION CONTRACT (the owner's main worry; every agent follows it)
1. **No claim without checkable evidence.** Every rule record carries at least one evidence item that a script can
   check:
   - (a) a verbatim quote (≤200 chars, from one line) from a printed, designer or R-ruling source; or
   - (b) an engine code quote PLUS a test that was executed and asserts the claim. For an Annex D rule
     (key `annexd.*`, the digital conventions) the code quote may also come from `client/ui/` or
     `client/server/` source, never their tests; a game rule's still has to be engine source.
2. **Behaviour must be demonstrated.** Every rule that says how play proceeds needs an executed test asserting
   it: an existing guard, or a new CR example test written by the verifier. CR example tests are promoted into
   `client/engine/test/NNN-cr-<unit>.test.ts`, numbers reserved below. A rule with no executed demonstration
   ships marked `untested`.
3. **Separation.** The DRAFTER reads rulings, RAQ claims, printed text and tests, and never `client/engine/src`.
   The VERIFIER gets the rule records with the drafter's notes and confidence stripped out, reads the engine,
   RUNS the tests, and may write probe tests. The verifier is the only path from code into the document.
4. **Mutants.** Every verify batch has 2–3 falsified rules planted in it by the orchestrator's harness. A batch
   whose verifier confirms any mutant has ALL its verdicts discarded, and is re-run by a fresh verifier.
5. **Quotes are checked mechanically** (whitespace-normalised substring match). Test titles are resolved by a
   real JS string-literal parser or by running the test, never by a naive regex: titles contain `\'`.
6. **At most 3 draft/verify rounds.** Residue ships marked `partial`, with the verifier's note shown, and goes
   into the discrepancy report.
7. **Second opinion.** A different model (Sonnet) re-verifies a random 10% of confirmed rules. Its disagreement
   rate is reported as the measured false-confirm rate.
8. **Engine-only (derived) rules** are visibly marked, listed in Annex P, and await owner sign-off.

## Rule record

One JSON object per rule, in `rules/<section>.json`:

| field | |
|---|---|
| `num` | the published number, e.g. `608.2b` — from the ledger, never chosen by hand |
| `key` | the permanent dotted key, e.g. `combat.damage.substeps.column-attributes` |
| `text` | the rule. It may name another rule by key (`see rule effects.stripping.mutual`); the renderer prints the key's live number, and `cr:check` fails (`ref-unresolved`) on a key or a `rule N` that names no live rule |
| `examples[]` | `{ text, test }` — `test` is `<file>::<test title>` of an executed test |
| `see[]` | cross-references, by number |
| `sources.printed[]` | `{ ref, quote }`; `ref` is `Manual p.N`, `Rulebook 2023 p.N` or `card: <Name>` |
| `sources.designer[]` | `{ ref: "RAQ <threadId>#<i>", quote }` |
| `sources.ours[]` | `{ ref, quote }` from our own text (the glossary) — never authority |
| `sources.rulings[]` | current R-rulings only |
| `sources.history[]` | `{ ruling, relation }` — superseded or narrowed rulings, and how |
| `sources.engine[]` | engine symbols (the verifier's citations) |
| `sources.tests[]` | test files that demonstrate the rule |
| `basis` | `printed` \| `designer` \| `owner` \| `engine` \| `mixed` |
| `confidence` | `high` \| `medium` \| `low` |
| `notes` | the drafter's reasoning; stripped before verification |
| `engineDiffers?` | `[findingId]` (`F-U12-3`) — the ruling is stated; the engine does otherwise |
| `untested?` | `true` when no executed test or probe demonstrates it — set by `harness.mjs finalize`, cleared when a probe is promoted |
| `sourceHashes` | `{"R114": bodyHash, "RAQ <id>#<i>": textHash}` of what was cited — filled by `harness.mjs stamp` |

A verdict pins the record by `recordHash` (schema.mjs): its text, plus its
examples and their test bindings. An example bound to a promoted
`NNN-cr-<unit>.test.ts` does not count, since the gate runs that test itself.

## The glossary (`rules/glossary.json`)

A pointer layer, as in the MTG CR. Each row is one sentence paraphrasing the
first sentence of the rule it points at, plus `see[]` (keys; the first is the
defining rule). It never states a rule the numbered rules do not state. A row
has `term` instead of `parent`/`order`, takes no number, and carries no basis or
verdict: the rule it points at carries those.

- The term list is **derived**, and `cr:check` holds it there
  (`check.mjs glossaryTags`): every zone, phase, battle step and damage
  sub-step of the engine's enum exports, every attribute, every row of
  `client/ui/glossary.ts` and every top-level rule of 801 and 803 must be
  covered by a row's `derived` tags (`glossary-term-missing`), and a tag that
  names nothing fails (`glossary-tag-unknown`). Terms a rule defines ("X is …")
  are added by hand from the rules.
- A `see` target that is no live rule fails `cr:check`
  (`glossary-see-unresolved`) and makes `cr:render` refuse to render.
- A term that changed name stays as an `obsolete` row pointing at the new one,
  only where a source really uses the old name: `usedBy[{ref, quote}]`, the
  quote checked verbatim (`file: <repo path>` reaches the old rules glossary).
- A term no rule defines says so ("Not defined by these rules: …") and is filed
  as a tier-4 discrepancy in `discrepancies/glossary.json`.

## Numbering and the ledger

- Three levels, MTG style: section `608`, rule `608.2`, subrule `608.2b`.
  Subrule letters skip `l` and `o`.
- Every rule has a permanent dotted `key`. The ledger maps key → number.
- The ledger allocates each number **once**. A number is never moved and never
  reused. A removed rule becomes a tombstone that keeps its number.
- `802.N` follows the engine's `Attr` order (`client/engine/src/types.ts`).
- The engine's turn structure is read from runtime arrays, not copied:
  `PHASES`, `BATTLE_STEPS`, `DAMAGE_SUBSTEPS`, `DECISION_KINDS`, `ZONES` in
  `types.ts`, proven equal to their unions at compile time
  (`410-enum-exports.test.ts`).

## How to regenerate

Run from the repo root. Every step is deterministic except the agent roles in
step 3. The gate (step 4) runs inside `npm --prefix client run check`.

### 1. Extract the sources

```bash
npm --prefix client run cr:extract      # -> build/extract.json: rulings, supersession
                                        #    CANDIDATES, RAQ claims, glossary, cards,
                                        #    printed pages, enums, test titles, engine symbols
node client/engine/scripts/cr/extract-printed-pages.mjs
                                        # ONLY for a new Manual/Rulebook PDF: rewrites
                                        # sources/printed-pages.json (needs poppler-utils)
```

The supersession candidates come out of the extract (there is no separate
script). They are proposals: each is decided by hand in `supersession.json`.
Every ruling gets a row in `classification.json`, and every RAQ claim, RAQ
thread and printed page a row in `source-classification.json`. The gate is red
until all three are complete.

### 2. Pack a drafting unit

```bash
node client/engine/scripts/cr/pack.mjs U12            # -> build/packs/U12/
node client/engine/scripts/cr/pack.mjs all            # every unit in units.json
node client/engine/scripts/cr/pack.mjs U12 --seed <dir>   # also copy a pilot's records into seed/
```

A pack holds everything the drafter of one unit may read: its current
rulings, the history of the superseded ones, its RAQ claims, its printed
pages, its keyword cards, our glossary rows (marked as not authority) and its
test titles. It never includes engine source.

### 3. Draft, verify and revise: the wave workflow

The units (`units.json`, U01–U24) are drafted in waves. Each unit runs this
loop, using the harness commands below:

1. **draft**: write `rules/<unit>.json` from the pack; `stamp`; `check --unit`.
2. **mutate**: choose the round's mutants (round 1) or decoys (rounds 2–3).
   Then `plant`.
3. **verify**: a fresh agent, which never sees the drafter's notes, writes
   `build/verdicts/<unit>-rK.json`. Then `judge`. If the batch is invalid, a new
   verifier runs the next attempt.
4. **revise**: work from `feedback`, list the changed keys, then `stamp` and
   `check --unit`. Back to mutate, up to three rounds in all.
5. **finalize**, then **test** (a tester turns each `untested` rule into a probe)
   and **promote** (probes become `engine/test/4NN-cr-<unit>.test.ts`, 412–435).
6. **wave end**: one agent runs `cr:render`, `cr:check` and 409, and commits
   the wave. Units never commit.

**The role briefs are not in git.** Each role above has a brief: `C-draft`,
`C-mutate`, `C-verify`, `C-revise`, `C-test`, `C-promote` and `C-waveend`,
plus the Stage A, B and D briefs. They live in the orchestrating Claude Code
session's scratchpad,
`/tmp/claude-1000/-home-bena-Documents-Algomancy/<session>/scratchpad/cr/briefs/*.md`.
The workflow scripts that ran the waves are in
`~/.claude/projects/<project>/<session>/workflows/scripts/cr-stage-*.js`, and
the control file with every stage's decisions is in the same scratchpad
(`cr/CONTROL.md`). `/tmp` does not survive a reboot. Treat that copy as
disposable: the contract the briefs implement is the one written out in this
file and in ruling R343 of `client/docs/digital-rules.md`.

### 4. Render and check

```bash
npm --prefix client run cr:render   # number unseen keys (ledger.json), write the document,
                                    # Annex D, discrepancies.md, owner-questions.md, changelog.md
npm --prefix client run cr:check    # the mechanical checks; exits 1 on any problem
node client/engine/scripts/cr/check.mjs --unit U12   # one unit's problems only (unnumbered is a note)
(cd client/engine && node --test test/409-comprehensive-rules.test.ts)   # the gate
npm --prefix client run check       # everything, the CR tests included (about 5 minutes, background it)
```

The changelog is rendered from the ledger's `since` stamps. In the first
edition every key is new.

### 5. Retire or rename a rule

```bash
node client/engine/scripts/cr/ledger.mjs remove <key> "<reason>" [replacedByKey]   # tombstone a rule
node client/engine/scripts/cr/ledger.mjs alias <oldKey> <newKey>                  # rename a key
```

### The harness commands, for step 3 (`client/engine/scripts/cr/harness.mjs`)

Each subcommand prints one JSON object. U = unit, K = round, A = attempt.

```bash
H="node client/engine/scripts/cr/harness.mjs"
$H keys     --unit U12 --round 1                     # `mutable`: the keys round 1 may replace
$H keys     --unit U12 --round K --decoy-pool        # K>=2: `decoyPool`, the bases a decoy may copy
$H plant    --unit U12 --round K --mutants m.json    # -> build/verify-input/U12-rK.json (+ hidden truth)
#   m.json: round 1 [{key, mutant, why_false}] x2-3; round K>=2 [{baseKey, mutant, why_false}] x1-2
#   the verifier writes build/verdicts/U12-rK.json (attempt A>1: U12-rK-aA.json)
$H judge    --unit U12 --round K [--attempt A]       # batchValid = every mutant caught
$H feedback --unit U12 --round K                     # the reviser's input, mutants removed
#   the reviser writes build/harness/U12/changed-rK.json
$H finalize --unit U12                               # verdicts/U12.json, findings/U12.json, `untested`
$H stamp    --unit U12                               # fill sourceHashes from the extract
$H status   [--unit U12]                             # one line per unit
```

Round 1 verifies every rule, with 2–3 of them REPLACED by false text; those
are verified for real in round 2. Round K>1 verifies the keys the reviser
changed plus the keys round K-1 left unverified, and plants 1–2 DECOYS: a rule
outside the batch (one confirmed earlier, preferably), copied with false text
under a fresh key in its area. A decoy lives only in the verifier input and the
hidden truth, never in rules/, verdicts/, findings/ or the feedback, so no
real rule goes unverified in its round. A batch that misses any mutant or
decoy is discarded whole; a fresh verifier re-runs it as the next attempt.


## How to answer the owner questions

`owner-questions.md` lists the tier-1 discrepancies. In each of them, the
strongest source's own words support two readings, and no higher source
decides. Each question gives its readings (A, B, …) with what each means at the
table, the reading the document follows today, and a recommendation.

1. **Answer outside the generated file.** Reply with one line per question
   (for example "2: A"). `owner-questions.md` is regenerated, so anything
   written in it is lost.
2. **Record the answer as a ruling.** Add a new `## R<n>` to
   `client/docs/digital-rules.md` (basis owner, unless a RAQ thread or Caleb
   decides it). Classify it in `classification.json` and decide any candidate
   edges in `supersession.json`. 409 stays red until both are done.
3. **Close the discrepancy.** In `discrepancies/<unit>.json`, drop the row's
   `question`, move it to tier 2 (or 4), and write a `resolution` that names the
   ruling.
4. **Redraft the rules it names** (the row's `rule` and its `seeAlso`). Cite the
   new ruling and run `harness.mjs stamp --unit <unit>`. If the engine does
   otherwise, add `engineDiffers`, a finding and a CT ticket. If the answer
   makes a filed CT ticket moot, close that ticket.
5. **Re-verify.** A record whose text changed renders as "not verified (the
   text changed after verification)" until a verify round confirms it again.
6. **Then** `cr:render`, `cr:check` and 409.

---

Algomancy is designed by [Caleb Gannon](https://calebgannon.com/). Card and rules
text are his, used with permission — see [`../NOTICE.md`](../NOTICE.md).
