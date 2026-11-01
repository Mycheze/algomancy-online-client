#!/usr/bin/env python3
"""
test_terms.py — offline tests for terms.py: the CR glossary definition of a
game term goes on the slate beside the passages that use it. No network, no key.

Why it exists: response b5ffba60 (2026-11-01) said Null Drone "is a spell unit,
not a spell effect" — CR 700.1a says a spell unit on the stack IS one. The
question never used the term, only Null Drone's card text did, so retrieval
(which reads the question) never brought the definition, and the model read
the term off its words. Covers: the definition arrives for that exact question
off the real corpus; a longer term claims its span ("spell effect", not "spell"
+ "effect"); a card's name and stat lines are not read; a term whose rule is
already on the slate is not repeated; the cap; the rows are marked, labelled in
the passages block and citable; and ALGO_DEFINITIONS=off turns it off.
"""

import os
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402  — before any bot import

import core  # noqa: E402
import terms  # noqa: E402

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


BY_ID = {r["id"]: r for r in core.retriever.rows}
TI = core.term_index()

# ── the reported question, on the real corpus and the real retriever ─────────
Q = ("can gravitational correction change the target of a null drone to a) the null drone "
     "itself, b) the gravitational correction itself?")
hits = core.retriever.search(Q, k=core.TOP_K)
ids = [r["id"] for _s, r in hits]
check("the reported question still retrieves Null Drone's card", "card:Null Drone" in ids)
check("... and still does NOT retrieve the spell-effect definition on its own",
      "cr:glossary.spell-effect" not in ids
      and not any(core.cr_chunk_covers(r, "700.1a") for _s, r in hits))
full = core.with_definitions(Q, hits)
added = {r["id"]: r for _s, r in full[len(hits):]}
check("with_definitions adds the spell-effect definition (from Null Drone's card text)",
      "cr:glossary.spell-effect" in added)
check("basic vocabulary (target, augment) is not defined", "cr:glossary.target" not in added and not any(r["id"] == "cr:glossary.augment" for _s, r in core.with_definitions("With Envoy of Lightning out, is Twin Flame Electric?", core.retriever.search("With Envoy of Lightning out, is Twin Flame Electric?", k=core.TOP_K))))
check("the original slate is kept, in order, in front", full[:len(hits)] == hits)
check("each added row is a marked COPY scored 0.0",
      all(s == 0.0 and r.get("definition") for s, r in full[len(hits):])
      and "definition" not in BY_ID["cr:glossary.spell-effect"])
check("at most MAX_DEFS are added", len(added) <= terms.MAX_DEFS)

ctx = core.build_context(full)
check("the passages block labels a definition as one",
      f"[cr:glossary.spell-effect] (authority" in ctx and core.DEFINITION_LABEL in ctx)
check("a definition is citable: the renderer footnotes it",
      core.render_citations("It is one [cr:glossary.spell-effect].", full)[1][0][1]["id"]
      == "cr:glossary.spell-effect")

# ── matching ─────────────────────────────────────────────────────────────────
m = TI.matches("Negate target spell effect if its cost is less than or equal to the life lost.")
check("a longer term claims its span: 'spell effect', not also 'spell'/'effect' there",
      "Spell effect" in m and "Spell" not in m and "Effect" not in m)
check("inflections match: trashed -> Trash, allies -> Ally, negated -> Negate",
      {"Trash", "Ally", "Negate"} <= set(TI.matches("It was trashed; your allies negated it.")))
check("whole words only: 'castle' is not Cast", "Cast" not in TI.matches("the castle"))
nd = terms.card_rules_text(BY_ID["card:Null Drone"])
check("a card is read by its type line and text box",
      "Spell Unit" in nd and "Negate target spell effect" in nd)
check("... not by its name or its cost/factions lines",
      "Null Drone" not in nd and "Factions" not in nd and "Cost:" not in nd)

# ── no repeats ───────────────────────────────────────────────────────────────
with_rule = hits + [(1.0, BY_ID["cr:700.1"])]
again = {r["id"] for _s, r in core.with_definitions(Q, with_rule)[len(with_rule):]}
check("a term whose rule a retrieved chunk prints (cr:700.1 prints 700.1a) is not repeated",
      "cr:glossary.spell-effect" not in again)
with_row = hits + [(1.0, BY_ID["cr:glossary.spell-effect"])]
again = [r["id"] for _s, r in core.with_definitions(Q, with_row)[len(with_row):]]
check("a glossary row already retrieved is not added twice", "cr:glossary.spell-effect" not in again)

# ── the switch ───────────────────────────────────────────────────────────────
os.environ["ALGO_DEFINITIONS"] = "off"
check("ALGO_DEFINITIONS=off: the slate is returned unchanged", core.with_definitions(Q, hits) == hits)
del os.environ["ALGO_DEFINITIONS"]

print(f"test_terms: all {PASS} checks passed ✅")
