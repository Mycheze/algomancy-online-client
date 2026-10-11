# `verdicts/` — the verifier's verdicts (frozen history)

One file per drafting unit, written by `harness.mjs finalize`. A verdict is a
record of what a verifier checked and when: the rule's text and examples (pinned
by `textHash`), the engine code it quoted, the tests it ran.

**R-numbers in these files refer to the retired ruling register**
(`client/docs/digital-rules.md`, `R1`–`R350`), archived at
`refs/archive/r-register-final`. The register was retired on 2026-10-11, when
its owner calls were absorbed into the rule records (`sources.owner`) and every
citation elsewhere became a `CR` number. These files were left as they were, by
the owner's decision: a verdict says what was checked against what existed then,
and rewriting its references would falsify it. `source_checks[].ref` naming an
`R<n>`, a `tests_run[].pattern` naming an old test title, a `problem` quoting
the register — all of it is history.

The one thing the migration did change is `textHash`, and only where the
record's text and every example's words were unchanged and only an example's
test BINDING moved because its test was retitled (`R84: …` → `CR 802.15c: …`):
the verifier's subject did not change, so the pin was moved with it
(`client/engine/scripts/cr/migrate/repin.mjs`).
