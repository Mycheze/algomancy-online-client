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
  ledger.json                          rule key -> number        reviewed    CR_LEDGER
  supersession.json                    ruling -> ruling edges    reviewed    CR_SUPERSESSION
  classification.json                  ruling -> scope, sections reviewed    CR_CLASSIFICATION
  verdicts/<unit>.json                 the verifier's verdicts   reviewed    CR_VERDICTS_DIR
  discrepancies/<unit>.json            what did not reconcile    records     CR_DISCREPANCIES_DIR
  discrepancies.md                     the report, four tiers    generated   CR_DISCREPANCIES_MD
  findings/<unit>.json                 engine bugs -> CT tickets records     CR_FINDINGS_DIR
  changelog.md                         what changed per edition  generated   CR_CHANGELOG
  outline.json                         chapters, sections, slots reviewed    CR_OUTLINE
  front-matter.md                      the introduction          hand-written CR_FRONT_MATTER
  build/                               extract output, packs     gitignored  CR_BUILD_DIR
  build/verify-input/, build/verdicts/ the verifier's in and out gitignored  CR_VERIFY_INPUT_DIR, CR_VERIFY_OUTPUT_DIR
  build/harness/<unit>/                mutants, judgements, feedback gitignored CR_HARNESS_DIR
```

The scripts are `client/engine/scripts/cr/*.mjs`. The gate is
`client/engine/test/409-comprehensive-rules.test.ts`.

## Generated vs reviewed — never hand-edit either

| kind | files | how it changes |
|---|---|---|
| **generated** | the document (`.md` `.html` `.txt`), Annex D, `discrepancies.md`, `changelog.md` | re-run the scripts. A wrong sentence is fixed in its record, re-verified, re-rendered — never in the output. |
| **records** | `rules/*.json`, `discrepancies/*.json`, `findings/*.json` (one file per drafting unit) | written by the draft/verify rounds (findings also by `harness.mjs finalize`); the document's source. |
| **committed reviewed state** | `ledger.json`, `supersession.json`, `classification.json`, `verdicts/*.json` | append/edit only through the cr scripts. A decision someone made; nothing can rebuild it. |
| **gitignored** | `build/` | scratch, rebuilt on every run |

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
   - (b) an engine code quote PLUS a test that was executed and asserts the claim.
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
| `text` | the rule |
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

Placeholders until the scripts land (Stage A2/A3); each later stage fills its
own line in.

```bash
node client/engine/scripts/cr/extract.mjs      # TODO(A2): sources -> build/
node client/engine/scripts/cr/supersede.mjs    # TODO(A2): propose supersession edges
npm --prefix client run cr:render   # number unseen keys (ledger.json), write the document, Annex D,
                                    # discrepancies.md and changelog.md
npm --prefix client run cr:check    # the mechanical checks; exits 1 on any problem
node client/engine/scripts/cr/ledger.mjs remove <key> "<reason>" [replacedByKey]   # tombstone a rule
node client/engine/scripts/cr/ledger.mjs alias <oldKey> <newKey>                  # rename a key
node client/engine/scripts/cr/check.mjs --unit U12   # one unit's problems only (unnumbered is a note)
node --test client/engine/test/409-comprehensive-rules.test.ts   # the gate
```

### The draft/verify loop, per unit (`client/engine/scripts/cr/harness.mjs`)

Each subcommand prints one JSON object. U = unit, K = round, A = attempt.

```bash
H="node client/engine/scripts/cr/harness.mjs"
$H keys     --unit U12 --round K                     # the round's keys; which may be mutated
$H plant    --unit U12 --round K --mutants m.json    # -> build/verify-input/U12-rK.json (+ hidden truth)
#   the verifier writes build/verdicts/U12-rK.json (attempt A>1: U12-rK-aA.json)
$H judge    --unit U12 --round K [--attempt A]       # batchValid = every mutant caught
$H feedback --unit U12 --round K                     # the reviser's input, mutants removed
#   the reviser writes build/harness/U12/changed-rK.json
$H finalize --unit U12                               # verdicts/U12.json, findings/U12.json, `untested`
$H stamp    --unit U12                               # fill sourceHashes from the extract
$H status   [--unit U12]                             # one line per unit
```

Round 1 verifies every rule; round K>1 the keys the reviser changed plus the
keys round K-1 left unverified (the mutated ones, and any the verifier
skipped), which may not be mutated again. A batch that misses any mutant is
discarded whole; a fresh verifier re-runs it as the next attempt.

---

Algomancy is designed by [Caleb Gannon](https://calebgannon.com/). Card and rules
text are his, used with permission — see [`../NOTICE.md`](../NOTICE.md).
