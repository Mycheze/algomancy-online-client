#!/usr/bin/env python3
"""
test_citations.py — offline tests for core.render_citations: how the model's
[tag] citations become footnotes. No network, no key.

Why it exists: eval run 2 (2026-10-11, the first on the CR corpus) found 159 of
537 citation tags naming a CR SUBRULE ([cr:603.2a]) inside a retrieved rule
chunk (cr:603.2). The renderer matched ids exactly, so in 68 of 115 answers
players saw raw "[cr:603.2a]" text and no footnote. Covers: subrule -> the
chunk whose nums print it, footnoted and linked AS the subrule; a split rule's
continuation piece; the parent-rule fallback; an unknown tag dropped with the
prose kept; card tags and card text ([Augment]) unaffected; and the eval's
gold matching agreeing with the renderer.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402  — before any bot import

import core  # noqa: E402

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


def row(cid, stype, meta=None, title=None):
    return {"id": cid, "text": "…", "source": "fixture", "source_type": stype, "authority": 1,
            "authority_label": "fixture", "title": title or cid, "metadata": meta or {}}


CR603 = row("cr:603.2", "cr", {"kind": "rule", "num": "603.2", "nums": ["603.2", "603.2a", "603.2b"]},
            "CR 603.2–603.2b")
CR802 = row("cr:802.16g", "cr", {"kind": "rule", "num": "802.16g", "nums": ["802.16g", "802.16h"]})
CR104 = row("cr:104.2", "cr", {"kind": "rule", "num": "104.2", "nums": ["104.2"]})
GLOSS = row("cr:glossary.stack", "cr", {"kind": "glossary", "term": "Stack", "gloss_key": "glossary.stack",
                                        "nums": ["608.1"]})
CARD = row("card:Temporal Rift", "card", {"name": "Temporal Rift"}, "Temporal Rift")
MANUAL = row("manual:0026", "rulebook")
HITS = [(1.0, r) for r in (CR603, CR802, CR104, GLOSS, CARD, MANUAL)]

text, src = core.render_citations(
    "Responses resolve last-in first-out [cr:603.2a]. Rift negates it [card:Temporal Rift]. "
    "Regroup clears damage [manual:0026]. The chunk itself [cr:603.2].", HITS)
names = [core.friendly_source(r) for _n, r in src]
check("no raw tag survives", "[cr:" not in text and "[card:" not in text and "[manual:" not in text)
check("subrule footnoted as the subrule, chunk as itself",
      names == ["CR 603.2a", "Card: Temporal Rift", core.friendly_source(MANUAL), "CR 603.2"])
check("subrule link anchors at the subrule",
      core.cr_link(src[0][1]).endswith("crreview=1&at=r603.2a"))
check("chunk link anchors at its own number", core.cr_link(src[3][1]).endswith("&at=r603.2"))
check("the retrieved hit is not mutated", CR603["metadata"]["num"] == "603.2" and CR603["title"] == "CR 603.2–603.2b")
check("card tag unaffected", names[1] == "Card: Temporal Rift" and src[1][1] is CARD)
check("superscripts in place", text.startswith("Responses resolve last-in first-out ¹."))

r, n = core.resolve_citation("cr:802.16h", [CR603, CR802])
check("continuation piece found through nums", r is CR802 and n == "802.16h")
r, n = core.resolve_citation("cr:104.2c", [CR104])
check("parent-rule fallback when no chunk prints the subrule", r is CR104 and n == "104.2c")
check("a glossary row never stands in for a rule", core.resolve_citation("cr:608.1", [GLOSS]) is None)
check("a different rule's chunk does not match", core.resolve_citation("cr:603.21", [CR603]) is None)

text, src = core.render_citations("It fizzles [cr:999.9z]. Also [made:up; manual:0026] here.", HITS)
check("unknown tag dropped, prose kept", text == "It fizzles. Also ¹ here." and len(src) == 1)
text, src = core.render_citations("Play it with [Augment] and pay {r} [Switch1].", HITS)
check("card text brackets untouched", text == "Play it with [Augment] and pay {r} [Switch1].")
check("nothing cited inline -> top passages as sources", [r for _n, r in src] == [CR603, CR802, CR104])

paths = core.cited_card_paths("Rift [card:Temporal Rift] and [cr:603.2a]", HITS)
check("cited_card_paths still finds the cited card",
      [(n, t) for n, t, _p in paths] == ([(1, "Temporal Rift")] if core.cards.art_path("Temporal Rift") else []))

# the eval scores gold citations with the same rule the renderer uses
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "eval"))
import evallib  # noqa: E402
check("eval gold matching agrees with the renderer",
      evallib.cite_matches("CR 802.16h", CR802) and not evallib.cite_matches("CR 802.16f", CR802)
      and not evallib.cite_matches("CR 608.1", GLOSS))

print(f"test_citations: all {PASS} checks passed ✅")
