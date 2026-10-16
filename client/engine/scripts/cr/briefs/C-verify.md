# C-verify (polish round 4): verify seven batches of comprehensive-rules records

You are the VERIFIER for the Algomancy comprehensive rules (CR). You never saw these
records drafted. Your job: decide, for each record, whether its text is TRUE — supported
by its cited sources, read in context, and (for how-play-proceeds claims) by what the
engine actually does, demonstrated by an executed test or a probe you write.

## Where you work

Everything happens in this directory, a scratch copy of the repo (call it MIRROR):

    <MIRROR: a scratch copy of the repo>

Do NOT read or write anything outside MIRROR, and inside MIRROR do NOT open:
`data/comprehensive-rules/rules/`, `findings/`, `discrepancies/`, `verdicts/`,
`build/harness/`, `build/verdicts/` (except to write your output), the generated
documents `data/comprehensive-rules/*.md|*.html|*.txt`, or `client/ledgers/card-todo*.ts`.
They hold the drafter's reasoning and the answers; reading them voids your batch.
Never run `npm run check` (the full gate). Do not use git.

## Your input

Seven files, one per drafting unit: `data/comprehensive-rules/build/verify-input/<U>-r4.json`
for U = U02, U03, U08, U10, U14, U18, U19. Each is an array of records:
`{key, text, examples[{text, test}], see, sources{printed, designer, ours, owner, engine,
tests}, basis, scope, engineDiffers?}`. ⚠ Some batches contain deliberately FALSE records,
planted to test you. A batch in which you confirm any false record is discarded whole.
Judge every record on the evidence, never on how plausible it sounds.

## Where the sources are (all inside MIRROR)

- Printed pages: `data/comprehensive-rules/sources/printed-pages.json` (`pages[]` with
  `doc` = "Manual" | "Rulebook 2023", `page`, `text`). A ref "Manual p.19" is doc Manual, page 19.
  Quotes are matched whitespace-normalised; a page may break a word across a line ("defend-\ning").
- Cards: `client/engine/src/cards/printed.json` (front faces, by name), and
  `data/cards/AlgomancyCards-OracleText.json` (also has printed card BACKS, `"Side": "Back"`).
  A ref "card: <Name>" is that card's printed text.
- Designer (Caleb / RAQ write-ups): `client/ledgers/raq.ts`. A ref "RAQ <threadId>#<i>" is
  claim i (0-based) of the thread with that id; check its `claim`, `source`, and `status`
  (an `outdated` claim is not authority).
- Designer (Caleb in the flat rules-questions channel): `client/ledgers/rules-questions.snapshot.jsonl`,
  one JSON row per message. A ref "RQ <messageId>" is the row with that `id`; the quote must be in
  its `content`. Its `author` must be `calebgannon` (anyone else is not authority). Read
  `replyTo` (the message it answers; `missing: true` = deleted) and `before` (the messages just
  before it, ending at the question) to judge what he was answering: a bare "Yes" supports only
  what the question asked. The full export is not in MIRROR; the snapshot is the source.
- Owner calls: `sources.owner[]` in the record itself — `{quote, adopted, from}`, the owner's
  words and the date he adopted them. The quote is its own evidence (there is no register to
  check it against); judge whether it says what the record uses it for, and whether a printed
  or designer source outranks it.
- The engine: `client/engine/src/` (rules reducer), plus `client/ui/` and `client/server/`
  for Annex D (`annexd.*`) rules only. Tests: `client/engine/test/`, `client/ui/test/`,
  `client/server/test/`.

Authority, strongest first: a RAQ `[Solved]` write-up by `_passer` or Caleb's own words;
printed text read literally; the owner's calls (`sources.owner`) where neither speaks.
Other players are not authority. Our glossary is never authority.
`basis` must match: `printed`, `designer`, `owner` (owner calls only), `engine` (code + test
only), or `mixed` (more than one kind).

## What to check, per record

1. Every quote is verbatim in the source it names, and the source, read around the quote,
   says what the record uses it for. A quote that is verbatim but does not support the
   sentence it is cited for is `partial` or `unsupported`.
2. Every sentence of `text` is supported by some cited current source. A sentence with no
   support is a problem even if it sounds right.
3. Behaviour: find where the engine does it and RUN the bound tests:
   `cd client/engine && node --test --test-name-pattern "<title prefix>" test/<file>`
   (titles may contain `\'`; match on a prefix). If no executed test demonstrates a
   behaviour claim, write a probe test in `client/engine/test/zz-probe-<unit>-<n>.test.ts`
   (copy the harness use of a nearby test), run it, and record it. Probes stay uncommitted.
4. `engineDiffers: [id]` means the record states the RULE and the engine is known to do
   otherwise. Then: confirm the rule is supported by the sources; check the engine really
   differs (`engine[].agrees: false`); the record is still `confirmed` if both hold.
   If the engine differs and the record does NOT say engineDiffers, the record can still be
   confirmed when its sources are authoritative, but report the divergence under `bugs`.
5. Examples: an example's `test` must exist, pass, and assert what the example says.

Verdicts: `confirmed` (all of the above holds) · `partial` (part holds; say which part fails)
· `contradicted` (sources or engine say otherwise) · `unsupported` (no source supports it) ·
`untested` (sources support it but no test or probe could demonstrate the behaviour).
Every non-confirmed verdict needs a non-empty `problem`.

## Your output

For each unit write `data/comprehensive-rules/build/verdicts/<U>-r4.json` in MIRROR:

```json
{ "unit": "U18", "round": 4,
  "verdicts": [
    { "key": "<record key>", "verdict": "confirmed",
      "engine": [{ "loc": "client/engine/src/<file>.ts:<symbol>", "agrees": true, "note": "" }],
      "tests_run": [{ "file": "<test file>", "pattern": "<title prefix>", "passed": true, "asserts_claim": true }],
      "probes": [{ "file": "client/engine/test/zz-probe-U18-1.test.ts", "test": "<title>", "passed": true, "demonstrates": "yes: …" }],
      "source_checks": [{ "ref": "<ref as cited>", "supports": "yes", "note": "" }],
      "quote_spans": [{ "file": "<repo-relative path>", "text": "<verbatim span you relied on>" }],
      "basis_ok": true, "problem": "" } ],
  "bugs": [ { "rule": "<record key>", "title": "<one line>", "summary": "<what the engine does vs the rule>",
              "evidence": [{ "file": "<repo-relative path>", "quote": "<verbatim, one line, ≤200 chars>" }] } ] }
```

One verdict per record in the input, keyed by `key`. `quote_spans[].text` must be verbatim
from that file. When done, reply with one line per record (unit, key, verdict, the reason
in a few words) and the probe files you wrote.
