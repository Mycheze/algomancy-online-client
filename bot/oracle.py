#!/usr/bin/env python3
"""
oracle.py — the card transcription, with the corrections this repo carries.

WHY THIS EXISTS
---------------
`data/cards/AlgomancyCards-OracleText.json` is Caleb's transcription and is
canonical upstream: this repo never rewrites it. Where a field in it is
demonstrably wrong AND the owner has ruled on the correction, the correction is
declared in `client/engine/scripts/printed-overrides.mjs`, and the client's
extractor bakes it into `client/engine/src/cards/printed.json`.

That fixed exactly ONE of the three consumers. The Python bot and the RAG corpus
read the oracle file directly, so they went on serving the uncorrected text —
and this was not theoretical. Measured 2026-09-01, the bot answered a lookup for
**Might of the Grove** with the type line `{Battle}Tree Tree Druid Spell`, a
duplicated word and a missing space that the owner had ruled on five days
earlier; and **Arbiter of Armistice** with a `{Switch}` the card does not have.
The client had been right the whole time. That is a live, player-facing defect
in our own software, and closing it is what this module does.

ONE SOURCE OF TRUTH, AND IT IS NOT THIS FILE
--------------------------------------------
The corrections are NOT restated here. `npm run extract` emits them from the
same override table into `data/cards/oracle-corrections.json`, and this module
applies that generated artifact. A second copy of the table in Python is exactly
the failure this repo has already paid for once (two `paths` modules drifting),
and it would rot the same way — silently, and only in the half nobody is
looking at.

⚠ A CORRECTION IS REFUSED IF ITS BASELINE NO LONGER MATCHES. The artifact
carries `fromRaw`, the value the oracle held when the correction was written. If
the file has since changed — because Caleb fixed it at source, which is the
outcome we want — applying the correction would rewrite a field that is already
right, and the stale entry would live on forever with nobody noticing. So it
raises instead. That is the same discipline `applyOverride` runs on the
JavaScript side, and for the same reason.

⚠ MISSING ARTIFACT IS NOT AN ERROR. A checkout that has never run `npm run
extract`, or a deployment mid-`git pull`, gets the uncorrected oracle and a
warning rather than a crash — the bot answering slightly wrong about two cards
is better than the bot not starting. The guard that the file EXISTS and is
current lives in the test suite, where it belongs.
"""

import json
import sys
from pathlib import Path

from paths import ORACLE_JSON, ORACLE_CORRECTIONS


class StaleCorrectionError(Exception):
    """A declared correction no longer describes what the oracle file says."""


#: warn once per process, not once per CardIndex — six modules construct one.
_WARNED = set()


def load_corrections(path=ORACLE_CORRECTIONS):
    """The generated corrections, or [] when the artifact has not been built.

    A missing artifact is NOT an error: a checkout that has never run
    `npm run extract`, or a deployment caught mid-`git pull`, should get the
    uncorrected oracle and keep serving. It says so once, because silently
    serving text the owner has already ruled wrong is the exact defect this
    module exists to close, and the operator is the only one who can fix it.
    """
    p = Path(path)
    if not p.exists():
        key = str(p)
        if key not in _WARNED:
            _WARNED.add(key)
            print(
                f"[oracle] {p} is missing — serving the UNCORRECTED transcription. "
                "Run `npm --prefix client/engine run extract` to generate it.",
                file=sys.stderr,
            )
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("corrections", [])


def apply_corrections(data, corrections):
    """Apply each correction to `data` in place. Returns the number applied.

    `data` is the oracle file's shape: name -> [face, ...]. Corrections address
    the FRONT face, which is the one every consumer reads (cards.py keeps
    `faces[0]`, and the pipelines iterate the same way).
    """
    applied = 0
    for c in corrections:
        faces = data.get(c["card"])
        if not faces:
            raise StaleCorrectionError(
                f"oracle-corrections.json names {c['card']!r}, which is not in "
                f"{ORACLE_JSON}. Re-run `npm run extract`; if the card is genuinely "
                "gone, the override entry should be deleted rather than kept.")
        face = faces[0]
        # the baseline the correction was written against — see the module
        # docstring. `fromRaw` is what the oracle literally held; `from` is the
        # same value after the client's normalisePrinted, kept for comparison.
        expected = c.get("fromRaw", c["from"])
        actual = face.get(c["field"], "")
        if actual == c["to"]:
            continue                     # already correct at source: nothing to do
        if actual != expected:
            raise StaleCorrectionError(
                f"correction for {c['card']} ({c['field']}) is STALE: expected "
                f"{expected!r}, the oracle now has {actual!r}. Someone changed the "
                "upstream file. Re-check the entry in "
                "client/engine/scripts/printed-overrides.mjs and DELETE it if the "
                "source has been corrected, then re-run `npm run extract`.")
        face[c["field"]] = c["to"]
        applied += 1
    return applied


def load_oracle(path=ORACLE_JSON, corrections_path=ORACLE_CORRECTIONS):
    """The oracle transcription with this repo's corrections applied.

    THE ONE LOADER. `cards.py`'s CardIndex, `pipeline/build_corpus.py` and
    `pipeline/build_anchors.py` all come through here, so a correction reaches
    the card lookup, the search index, the RAG corpus and the art anchors
    together — three `json.loads` of the same file was how they drifted apart in
    the first place.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    apply_corrections(data, load_corrections(corrections_path))
    return data
