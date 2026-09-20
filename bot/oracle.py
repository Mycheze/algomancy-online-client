#!/usr/bin/env python3
"""
oracle.py — the one loader for the card transcription.

`data/cards/AlgomancyCards-OracleText.json` is this repo's card data: Caleb's
transcription of the base set, our own transcription of Light & Dark, and every
correction the owner has ruled on, edited in place (the reason for each is in
the commit that made it). It used to be treated as an untouchable upstream file
with a patch table applied on load; that layer is gone, and a wrong field is
fixed in the file itself.

Every Python reader comes through `load_oracle()` — cards.py's CardIndex,
pipeline/build_corpus.py and pipeline/build_anchors.py — so there is one place
to change if the file's shape ever does.
"""

import json
from pathlib import Path

from paths import ORACLE_JSON


def load_oracle(path=ORACLE_JSON):
    """The transcription: name -> [face, ...]; consumers read `faces[0]`."""
    return json.loads(Path(path).read_text(encoding="utf-8"))
