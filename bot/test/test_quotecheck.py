#!/usr/bin/env python3
"""
test_quotecheck.py — the deterministic quote check (bot/quotecheck.py), offline.
Run: `.venv/bin/python bot/test/test_quotecheck.py`.

A quotation followed by a citation claims the cited source prints those words.
The check must keep every honest quote — whatever the quote marks, whitespace,
case or an ellipsis did to it — and strip the quotation marks AND the citation
from one the source does not print, so it no longer poses as verbatim. Engine
citations get a second check: a stat pair in the sentence must be in the
simulation's final state.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import core
import quotecheck as qc

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


CR603 = {"id": "cr:603.2", "source_type": "cr", "text":
         "Comprehensive Rules (unofficial) · 6. Spells › 603. Targets\n"
         "603.2 Every target is chosen as the effect is put on the stack.\n"
         "603.2a An “if” clause attached to the action does not limit the choice —\n"
         "  it is checked   as the effect resolves.\n"
         "  Example: Delete target unit if it has a -1/-1 counter on it.",
         "metadata": {"kind": "rule", "num": "603.2", "nums": ["603.2", "603.2a"]}}
CARD = {"id": "card:Abduct", "source_type": "card", "text":
        "Abduct\n{Battle} Alien Spell\n\nGain control of target unit with cost [x] or less "
        "unless its controller pays [x].", "metadata": {}}
TOOLROW = {"id": "cr:802.8c", "source_type": "cr", "text": "802.8c A balanced unit's power and "
           "defense are each the greater of the two.",
           "metadata": {"num": "802.8c", "examples": ["A 3/1 balanced unit is a 3/3."]}}
ENGINE = {"id": "engine:s1", "source_type": "engine", "text": "simulated",
          "metadata": {"log": ["you play Luminous Arc → Towering Colossus",
                               "Towering Colossus becomes 3/1"],
                       "final": {"units": [{"ref": "you.0", "stats": "3/1", "printed": "3/2"}]}}}
ROWS = [CR603, CARD, TOOLROW, ENGINE]


def run(answer):
    return qc.check(answer, ROWS, core.resolve_citation)


print("\n[honest quotes survive]")
a = 'The rule says "Every target is chosen as the effect is put on the stack" [cr:603.2].'
out, rep = run(a)
check("an exact straight-quoted rule is kept untouched", out == a and rep == {})

a = 'It says “an "if" clause attached to the action does not limit the choice” [cr:603.2a].'
out, rep = run(a)
# the body holds a straight quote, which ends the quotation early: no match, no change
check("a quote that cannot be parsed as one is left alone", out == a and rep == {})

a = "CR 603.2a: “An ‘if’ clause attached to the action does not limit the choice” [cr:603.2a]."
out, rep = run(a)
check("⭐ curly quotes + a subrule tag resolved to its chunk: kept", out == a and rep == {})

a = 'The rules say "it is checked as the effect resolves" (CR 603.2a) [cr:603.2a].'
out, rep = run(a)
check("⭐ whitespace differs from the source (newline, triple space): kept",
      out == a and rep == {})

a = 'Per the rule, "Every target is chosen ... as the effect resolves" [cr:603.2].'
out, rep = run(a)
check("⭐ ellipsis fragments found in order: kept", out == a and rep == {})

a = 'Per the rule, "every target is chosen… put on the stack." [cr:603.2]'
out, rep = run(a)
check("…the unicode ellipsis, a lower-case start and a period inside the quote: kept",
      out == a and rep == {})

a = 'Abduct reads "gain control of target unit with cost [x] or less" [card:Abduct].'
out, rep = run(a)
check("a card's oracle text, bracketed cost token and all: kept", out == a and rep == {})

a = 'Its example: "A 3/1 balanced unit is a 3/3." [cr:802.8c]'
out, rep = run(a)
check("a CR record's example (metadata.examples on a tool row) counts", out == a and rep == {})

a = 'The log shows "Towering Colossus becomes 3/1" [engine:s1].'
out, rep = run(a)
check("an engine result's log lines count", out == a and rep == {})

print("\n[fabricated quotes are unquoted and uncited]")
a = 'The rules say "a target may be changed after it is chosen" (CR 603.2) [cr:603.2]. Next.'
out, rep = run(a)
check("⭐ words the source does not print: quotes and citation gone, words + (CR …) kept",
      out == "The rules say a target may be changed after it is chosen (CR 603.2). Next.")
check("…reported as quote_fail with the tag and the quote",
      rep["quote_fail"] == [{"tags": ["cr:603.2"],
                             "quote": "a target may be changed after it is chosen"}])

a = 'Per the rule, "as the effect resolves … every target is chosen" [cr:603.2].'
out, rep = run(a)
check("⭐ ellipsis fragments OUT of order: a miss",
      "quote_fail" in rep and '"' not in out and "[cr:" not in out)

a = 'It says “every target is chosen at random” [cr:603.2] and that is that.'
out, rep = run(a)
check("a curly-quoted fabrication is unquoted too",
      out == "It says every target is chosen at random and that is that." and rep["quote_fail"])

a = 'The rule: "Every target is chosen as the effect is put on the stack" [cr:999.9].'
out, rep = run(a)
check("a tag that resolves to nothing cannot vouch for a quote",
      out == "The rule: Every target is chosen as the effect is put on the stack." and rep["quote_fail"])

a = 'Two sources: "Every target is chosen as the effect is put on the stack" [card:Abduct; cr:603.2].'
out, rep = run(a)
check("a group of tags: one that prints the words is enough", out == a and rep == {})

print("\n[things that are not a quoted citation are untouched]")
for a, why in [
    ('The word "fizzle" [cr:603.2] is short.', "a quote under 12 characters"),
    ('It says "something entirely made up here" and nothing else.', "a quote with no citation after it"),
    ('Play "something entirely made up here" [Augment] style.', "[Augment] card text after a quote"),
    ('It says "something entirely made up here", then much later in the same line [cr:603.2].',
     "a citation too far from the quote"),
    ("No quotes at all [cr:603.2]. 3/1 here [cr:802.8c].", "an answer with no quotation"),
]:
    out, rep = run(a)
    check(f"untouched: {why}", out == a and rep == {})

print("\n[engine stat pairs]")
a = "Here in the client it becomes 3/1 (simulated) [engine:s1]. Fine."
out, rep = run(a)
check("a stat pair the final state shows: citation kept", out == a and rep == {})
a = "Here in the client it becomes 3/3 (simulated) [engine:s1]. The rule says 3/3 [cr:802.8c]."
out, rep = run(a)
check("⭐ a stat pair the final state does not show: the engine citation is dropped",
      out == "Here in the client it becomes 3/3 (simulated). The rule says 3/3 [cr:802.8c].")
check("…reported as engine_mismatch", rep == {"engine_mismatch": [{"tag": "engine:s1", "stats": ["3/3"]}]})
a = "It is 3/3 per CR 802.8c in the client [engine:s1; cr:802.8c]."
out, rep = run(a)
check("…only the engine tag leaves a mixed group (and a CR number does not split the sentence)",
      out == "It is 3/3 per CR 802.8c in the client [cr:802.8c]." and rep["engine_mismatch"])
a = "The client gives 3/1 [engine:s1]; printed it is 3/2."
out, rep = run(a)
check("every stat pair in the sentence must be in final (3/2 is the printed stat, also there)",
      out == a and rep == {})

print(f"\ntest_quotecheck: all {PASS} checks passed ✅")
