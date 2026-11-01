#!/usr/bin/env python3
"""
test_tools.py — the judge's lookup tools (tools.py), offline. No network, no
key, no game server, no model: every check calls dispatch() directly.

Why it exists: the tools are how the judge looks a rule up instead of making
one up (the owner's chief fear), so what it pins is what a wrong lookup would
cost:
- `rule` prints the record's EXACT text, its examples and a STATUS line, and the
  STATUS carries every caveat a record has — engineDiffers (with the finding),
  verdict partial, basis owner with the adoption date, basis engine, untested,
  digital scope — found on REAL records, so a caveat the renderer drops fails
  here. An unknown number answers "No such rule" with the nearest live ones.
- `define("spell effect")` gives the Spell effect row and rule 700.1a (a spell
  unit IS a spell effect) — the 2026-11-01 bug (response b5ffba60) was the model
  reading that term off its words; "spell effects" must not fall to "Spell".
- `card` gives oracle text, the engine's facts from printed.json, the Light &
  Dark provisional flag and ruling snippets — the same rulings /rulings finds.
- `search` honours `types` and returns citable ids.
- Every row a result prints resolves through core.resolve_citation and is
  footnoted by core.render_citations unchanged, including the extra rows
  (define's rule, card's rulings, search's hits) through citable_rows().
- Bad input never raises: unknown tool, missing/non-string/huge args, bad JSON.
- A sweep of EVERY rule, glossary term and card keeps each result inside the
  token budget with its STATUS intact.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import json  # noqa: E402

import core  # noqa: E402
import tools  # noqa: E402

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


def call(_tool, **args):
    return tools.dispatch(_tool, args)


def cites(answer, rows):
    """render_citations over tool rows only (the slate empty): the footnote names."""
    _text, sources = core.render_citations(answer, [(0.0, r) for r in rows])
    return [core.friendly_source(r) for _n, r in sources]


D = tools.data()

# ── TOOLS: the schemas the model is offered ──────────────────────────────────
check("four lookups, then simulate (the server tool, tested in test_simulate.py)",
      tools.TOOL_NAMES == ("rule", "define", "card", "search", "simulate")
      and tools.SERVER_TOOLS == {"simulate"})
check("each is an OpenAI function schema with an object of required args",
      all(t["type"] == "function" and t["function"]["parameters"]["type"] == "object"
          and t["function"]["parameters"]["required"] and t["function"]["description"]
          for t in tools.TOOLS))
schema_chars = len(json.dumps([t for t in tools.TOOLS if t["function"]["name"] not in tools.SERVER_TOOLS]))
check(f"the lookup schemas stay small (~{schema_chars // 4} tokens; they ride on every answer)",
      schema_chars < 2400)
check("data loads once", tools.data() is D)

# ── rule ─────────────────────────────────────────────────────────────────────
text, row = call("rule", num="700.1a")
r700 = D.by_num["700.1a"]
check("rule 700.1a: the record's exact text", r700["text"] in text)
check("... with every example", all(f"Example: {e}" in text for e in r700["examples"]))
check("... its parent and the citation tag", "Parent: 700.1" in text and text.startswith("[cr:700.1a]"))
check("... and a STATUS line, last", text.splitlines()[-1].startswith("STATUS: basis "))
check("row: corpus-shaped, cr:700.1a, carrying the flags",
      row["id"] == "cr:700.1a" and row["source_type"] == "cr" and row["title"] == "CR 700.1a"
      and {"id", "text", "source", "authority", "authority_label", "metadata"} <= set(row)
      and row["metadata"]["nums"] == ["700.1a"]
      and {"basis", "engine_differs", "verdict", "untested", "scope", "open_question",
           "discrepancies", "owner_adopted"} <= set(row["metadata"]))
check("row text is the corpus rendering (header, rule line, examples)",
      row["text"].startswith("Comprehensive Rules (unofficial) · 7.") and r700["text"] in row["text"]
      and r700["examples"][0] in row["text"])
check("core.resolve_citation finds the row by its tag", core.resolve_citation("cr:700.1a", [row]) == (row, None))
check("render_citations footnotes it as CR 700.1a", cites("A spell unit is one [cr:700.1a].", [row]) == ["CR 700.1a"])

text, _ = call("rule", num="700.1")
check("rule 700.1 lists its subrules", "Subrules: 700.1a " in text and "700.1b " in text)
check("rule accepts 'CR 700.1A', 'rule 700.1a', 'cr:700.1a' and the dotted key",
      all(call("rule", num=n)[1]["id"] == "cr:700.1a"
          for n in ("CR 700.1A", "rule 700.1a", "cr:700.1a", r700["key"])))
check("an Annex D number, lower-cased, is found", call("rule", num="d1.1")[1]["id"] == "cr:D1.1")
text, row = call("rule", num="802")
check("a section number lists its rules", text.startswith("[cr:802] CR section 802. Attributes")
      and "802.17 Electric" in text and row["id"] == "cr:802")

text, row = call("rule", num="700.1z")
check("unknown number: 'No such rule' and the nearest live ones",
      text.startswith("No such rule: 700.1z.") and "700.1a" in text and "700.1b" in text)
check("... with an error row nothing can cite", tools.citable_rows(row) == [] and row["metadata"]["error"])
check("a number past the end still answers with neighbours", "Nearest:" in call("rule", num="999.9")[0])

# ── STATUS on real records ───────────────────────────────────────────────────
recs = D.records


def first(pred):
    return next((r for r in D.rules if pred(r)), None)


ed = first(lambda r: r["engineDiffers"])
check("there is a real engineDiffers record to test", ed is not None)
text, row = call("rule", num=ed["num"])
fid = recs[ed["key"]]["engineDiffers"][0]
check(f"engineDiffers ({ed['num']}): ⚠ ENGINE DIFFERS with the finding id and title",
      "⚠ ENGINE DIFFERS" in text.splitlines()[-1] and fid in text
      and D.findings[fid]["title"][:40] in text)
check("... and the row says so", row["metadata"]["engine_differs"] and row["metadata"]["engine_differs_ids"] == [fid])

pa = first(lambda r: r["verdict"] == "partial" and not r["num"].startswith("D"))
check("there is a real partial record", pa is not None)
text, row = call("rule", num=pa["num"])
check(f"verdict partial ({pa['num']}) is on the STATUS line",
      "verdict partial" in text.splitlines()[-1] and row["metadata"]["verdict"] == "partial")

ow = first(lambda r: r["basis"] == "owner" and tools._owner_adopted(recs[r["key"]]) and not r["num"].startswith("D"))
check("there is a real owner-basis record with an adoption date", ow is not None)
when = tools._owner_adopted(recs[ow["key"]])
text, row = call("rule", num=ow["num"])
check(f"basis owner ({ow['num']}): 'unofficial owner call, adopted {when}'",
      f"basis owner — unofficial owner call, adopted {when}" in text and row["metadata"]["owner_adopted"] == when)

en = first(lambda r: r["basis"] == "engine")
text, _ = call("rule", num=en["num"])
check(f"basis engine ({en['num']}): engine-derived, awaiting owner sign-off",
      "engine-derived: no printed or designer source, awaiting owner sign-off" in text)

un = first(lambda r: r["untested"])
text, row = call("rule", num=un["num"])
check(f"untested ({un['num']}) is on the STATUS line", "untested" in text.splitlines()[-1] and row["metadata"]["untested"])

dg = first(lambda r: r["scope"] == "digital" and not r["num"].startswith("D"))
text, row = call("rule", num=dg["num"])
check(f"scope digital ({dg['num']}): an online-client convention",
      "scope digital" in text.splitlines()[-1] and row["metadata"]["scope"] == "digital")

import crnotes  # noqa: E402

crnotes.NOTES.by_target = {f"rule:{r700['key']}": [
    {"id": "c1", "target": f"rule:{r700['key']}", "role": "owner", "date": "2026-11-01",
     "body": "This example may be wrong."}]}
try:
    st = call("rule", num="700.1a")[0].splitlines()[-1]
    check("an open owner/judge review note on the rule reaches its STATUS",
          "open review note (owner, 2026-11-01): This example may be wrong." in st)
finally:
    crnotes.NOTES.by_target = {}
check("... and is gone with the note", "review note" not in call("rule", num="700.1a")[0])

big = D.by_num["802.17"]                          # long, and with a long STATUS
t, _ = tools._render_rule(big, budget=500)
check("a tight budget cuts the body, never the STATUS",
      len(t) <= 500 and t.endswith("\n" + tools.status_line(big)) and t.startswith("[cr:802.17]"))

mx = first(lambda r: r["basis"] == "mixed" and not r["engineDiffers"] and r["verdict"] == "confirmed"
           and not r["untested"] and not r["discrepancies"] and r["scope"] == "game")
text, _ = call("rule", num=mx["num"])
check(f"a clean record ({mx['num']}) has no caveat on its STATUS",
      not any(w in text.splitlines()[-1] for w in ("ENGINE DIFFERS", "partial", "untested", "scope digital")))

# ── define ───────────────────────────────────────────────────────────────────
for q in ("spell effect", "spell effects", "Spell Effect", "  spell   effect "):
    text, row = call("define", term=q)
    check(f"define({q!r}) is the Spell effect row, not Spell",
          row["id"] == "cr:glossary.spell-effect" and "[cr:glossary.spell-effect] Spell effect:" in text
          and "[cr:glossary.spell]" not in text)
text, row = call("define", term="spell effect")
check("... and prints rule 700.1a whole: a spell unit IS a spell effect",
      D.by_num["700.1a"]["text"] in text and "a spell unit or a spell token on the stack" in text
      and "Defining rule:\n[cr:700.1a]" in text)
rows = tools.citable_rows(row)
check("citable rows: the glossary row and the rule", [r["id"] for r in rows] == ["cr:glossary.spell-effect", "cr:700.1a"])
check("both tags footnote through render_citations",
      cites("It is one [cr:glossary.spell-effect], see [cr:700.1a].", rows)
      == ["CR glossary: Spell effect", "CR 700.1a"])
check("the glossary row is the corpus's own row",
      {k: v for k, v in rows[0].items() if k != "metadata"}
      == {k: v for k, v in next(r for r in core.retriever.rows if r["id"] == "cr:glossary.spell-effect").items()
          if k != "metadata"})
text, _ = call("define", term="Spell")
check("define('Spell') is still Spell", text.startswith("[cr:glossary.spell] Spell:"))
text, _ = call("define", term="Devastating")
check("an obsolete term says 'Not defined by these rules'", "Not defined by these rules" in text and "(obsolete term)" in text)
text, row = call("define", term="xyzzyq")
check("an unknown term: not in the glossary, try search", "not a term" in text and tools.citable_rows(row) == [])
text, _ = call("define", term="adjacnet")
check("a misspelling finds the close term, and says it did", "Adjacent" in text and "nearest" in text)

# ── card ─────────────────────────────────────────────────────────────────────
text, row = call("card", name="Null Drone")
check("card Null Drone: oracle text", "Negate target spell effect if its cost is less than" in text)
check("... the engine's facts from printed.json",
      "Online client engine plays it as: spellUnit · timing battle · cost b (mana 2) · 2/1" in text)
check("... row is the corpus's card row", row["id"] == "card:Null Drone" and row["source_type"] == "card")
check("... cited as Card: Null Drone", cites("Null Drone says so [card:Null Drone].", [row]) == ["Card: Null Drone"])

import rulings  # noqa: E402  (discord; the test env has it, the web app need not)

text, row = call("card", name="Amphivore")
expect = [r["id"] for r in rulings.find_card_rulings("Amphivore")][:tools.CARD_RULINGS]
got = [r["id"] for r in tools.citable_rows(row)[1:]]
check("card rulings are the ones /rulings finds, best first, at most 3", got == expect and len(got) == 3)
check("... each printed with its tag", all(f"[{i}]" in text for i in got))
check("... and each resolves", all(core.resolve_citation(i, tools.citable_rows(row)) for i in got))
check("card_rulings agrees with rulings.find_card_rulings on every card that has rulings",
      all([r["id"] for r in tools.card_rulings(n)] == [r["id"] for r in rulings.find_card_rulings(n)]
          for n in ("Null Drone", "Oorblak", "Amphivore", "Wisp", "Lost Guardian")))

ld = next(n for n, c in core.cards.cards.items() if "light" in (c.get("factions") or []) and n in D.printed)
text, _ = call("card", name=ld)
check(f"a Light & Dark card ({ld}) is flagged provisional", "Light & Dark card: PROVISIONAL" in text)
check("a base-set card is not", "PROVISIONAL" not in call("card", name="Null Drone")[0])
text, _ = call("card", name="Cardback")
check("a card outside the engine pool says so", "Not in the online client's card pool." in text)
text, row = call("card", name="null dron")
check("a near-miss name still finds the card", row["id"] == "card:Null Drone")
text, row = call("card", name="qqqqzzzz")
check("no card: a sentence, an uncitable row", text.startswith("No card matches") and tools.citable_rows(row) == [])

# ── search ───────────────────────────────────────────────────────────────────
text, row = call("search", query="spell effect ambush negate", types=["cr"])
rows = tools.citable_rows(row)
check("search types=[cr]: five CR hits, each printed with its id",
      len(rows) == tools.SEARCH_K and all(r["source_type"] == "cr" for r in rows)
      and all(f"[{r['id']}]" in text for r in rows))
check("a hit's subrule resolves through its chunk",
      any(core.resolve_citation(f"cr:{n}", rows) for r in rows for n in r["metadata"]["nums"][1:2]))
text, row = call("search", query="Null Drone", types=["card", "ruling"])
check("search types=[card, ruling] keeps to those",
      all(r["source_type"] in ("card", "ruling") for r in tools.citable_rows(row)))
check("search with no types searches everything", len(tools.citable_rows(call("search", query="initiative")[1])) == 5)
check("an unknown type is refused by name", call("search", query="x", types=["web"])[0].startswith("search: unknown type web"))

# ── bad input: a line of text, an uncitable row, never an exception ───────────
bad = [
    ("nope", {}), (None, {}), ("rule", None), ("rule", {}), ("rule", {"num": 5}), ("rule", {"num": ""}),
    ("rule", "{not json"), ("rule", "[1, 2]"), ("define", {"term": ["a"]}), ("card", {"name": None}),
    ("card", {"name": "x" * 50000}), ("search", {"query": ""}), ("search", {"query": "x", "types": 7}),
    ("search", {"query": "x", "types": [None]}), ("rule", {"num": "700.1a" * 1000}),
]
outs = [tools.dispatch(n, a) for n, a in bad]
check("bad calls return (str, row) and never raise",
      all(isinstance(t, str) and t and isinstance(r, dict) for t, r in outs))
check("... every one an error row citable_rows() drops", all(tools.citable_rows(r) == [] for _t, r in outs))
check("JSON-string args (as a tool call carries them) work", tools.dispatch("rule", '{"num": "700.1a"}')[1]["id"] == "cr:700.1a")
_real = tools.data
tools.data = lambda: 1 / 0                      # a failure inside a lookup
try:
    t, r = tools.dispatch("rule", {"num": "700.1a"})
    check("a failure inside a lookup comes back as a line, not an exception",
          t == "rule: lookup failed (ZeroDivisionError)." and tools.citable_rows(r) == [])
finally:
    tools.data = _real
check("an error row is still safe to hand render_citations",
      core.render_citations("text [cr:1.1]", [(0.0, outs[0][1])])[0] == "text")

# ── the sweep: every rule, term and card, inside the budget ──────────────────
LIMIT = tools.MAX_TEXT_CHARS
worst = {}
for r in D.rules:
    t, rw = call("rule", num=r["num"])
    assert rw["id"] == f"cr:{r['num']}", r["num"]
    assert t.endswith("\n" + tools.status_line(r)), r["num"]          # STATUS last and whole
    assert r["text"] in t or len(r["text"]) > LIMIT - 400, r["num"]      # text whole unless gigantic
    worst["rule"] = max(worst.get("rule", 0), len(t))
check(f"all {len(D.rules)} rules: found, STATUS last and whole, ≤ {LIMIT} chars", worst["rule"] <= LIMIT)
for g in D.glossary:
    t, rw = call("define", term=g["term"])
    assert rw["id"] == f"cr:{g['key']}", g["term"]
    worst["define"] = max(worst.get("define", 0), len(t))
check(f"all {len(D.glossary)} glossary terms define as themselves, ≤ {LIMIT} chars", worst["define"] <= LIMIT)
for n in core.cards.names:
    t, rw = call("card", name=n)
    assert rw["id"] == f"card:{n}", n
    worst["card"] = max(worst.get("card", 0), len(t))
check(f"all {len(core.cards.names)} cards look up as themselves, ≤ {LIMIT} chars", worst["card"] <= LIMIT)

typical = {
    "rule 700.1a": len(call("rule", num="700.1a")[0]),
    "define spell effect": len(call("define", term="spell effect")[0]),
    "card Null Drone": len(call("card", name="Null Drone")[0]),
    "search": len(call("search", query="spell effect ambush negate")[0]),
}
print("  sizes (≈tokens = chars/4): TOOLS", schema_chars // 4, "·",
      " · ".join(f"{k} {v // 4}" for k, v in typical.items()),
      "· worst", " ".join(f"{k} {v // 4}" for k, v in worst.items()))

print(f"test_tools: all {PASS} checks passed ✅")
