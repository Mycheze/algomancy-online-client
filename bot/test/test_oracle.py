#!/usr/bin/env python3
"""
test_oracle.py — the bot and the client agree about every corrected card.

  .venv/bin/python test_oracle.py

WHY THIS EXISTS
---------------
`data/cards/AlgomancyCards-OracleText.json` has known defects the owner has
ruled on. The client corrects them through `printed-overrides.mjs` into
`printed.json`; the Python side reads the oracle file directly and, until
2026-09-01, did not correct them at all. Measured that day: the bot answered a
lookup for **Might of the Grove** with `{Battle}Tree Tree Druid Spell` — a
duplicated word and a missing space the owner had ruled on five days earlier —
while the client had been right the whole time. Two halves of one repo, giving
different answers about the same card, with nothing anywhere to notice.

So this file asks the two consumers the same question and compares.

⚠ THE SUBJECT SET IS DERIVED, at run time, from the generated artifact. Nothing
here types "Might of the Grove" into an assertion it could pass without: a
seventh correction added next round joins this guard on the day it is written,
and one that stops being needed leaves it. A guard written against two card
names would go stale exactly when it mattered.

⚠ EVERY SECTION STATES ITS NON-VACUITY FIRST. Every check below has the shape
"for each correction, the two agree" — which an EMPTY correction list satisfies
forever, and the artifact is optional by design (a checkout that has never run
`npm run extract` has none). §0 is what stops this file reporting a clean sweep
over nothing.
"""

# ── reaching the bot package ──────────────────────────────────────────
# This file sits one directory below bot/ and is run directly, so Python puts
# THIS directory on sys.path — not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory, so this
# run cannot append to the deployment's live logs. See _scratch_var.py —
# 136 of 247 rows in the real wtp_attempts.jsonl were put there by these
# tests before this line existed.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import contextlib
import copy
import io
import json

from cards import CardIndex, plain_text
from oracle import StaleCorrectionError, apply_corrections, load_corrections, load_oracle
from paths import ORACLE_CORRECTIONS, ORACLE_JSON, REPO_ROOT

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        print(f"  ❌ {label} {extra}")


def section(title):
    print(f"\n=== {title} ===")


PRINTED_JSON = REPO_ROOT / "client" / "engine" / "src" / "cards" / "printed.json"
CORRECTIONS = load_corrections()
RAW = json.loads(ORACLE_JSON.read_text(encoding="utf-8"))
FIXED = load_oracle()
PRINTED = json.loads(PRINTED_JSON.read_text(encoding="utf-8"))


# ══ §0 the positive controls ══════════════════════════════════════════
section("§0 the sources this file compares are real and non-empty")

check("the generated corrections artifact exists",
      ORACLE_CORRECTIONS.exists(),
      f"(expected {ORACLE_CORRECTIONS} — run `npm --prefix client/engine run extract`)")
check("and it declares at least one correction",
      len(CORRECTIONS) > 0,
      "(an empty list makes every 'the two agree' check below pass over nothing)")
check("the client's generated pool is readable and whole",
      len(PRINTED) > 400, f"({len(PRINTED)} cards)")
check("the raw oracle is readable and whole", len(RAW) > 400, f"({len(RAW)} cards)")
# and the loader is not simply handing back the raw file
check("load_oracle() really differs from the raw file — the corrections are applied",
      any(FIXED[c["card"]][0][c["field"]] != RAW[c["card"]][0][c["field"]]
          for c in CORRECTIONS),
      "(nothing changed, so the loader is a no-op and §1 proves nothing)")


# ══ §1 the two consumers agree, per correction ════════════════════════
section("§1 the bot and the client say the same thing about every corrected card")

for c in CORRECTIONS:
    card, field = c["card"], c["field"]
    bot_value = FIXED[card][0][field]
    client_value = PRINTED.get(card, {}).get(field)
    raw_value = RAW[card][0][field]

    # non-vacuity FIRST, per entry: the correction must actually be changing
    # something, or "they agree" is true of a card nobody corrected
    check(f"{card} ({field}): the raw transcription really is wrong",
          raw_value != c["to"],
          f"(raw already reads {raw_value!r} — if Caleb fixed it at source, "
          "delete the override entry rather than keeping it)")
    check(f"{card} ({field}): THE BOT AND THE CLIENT AGREE",
          bot_value == client_value,
          f"\n        bot   : {bot_value!r}\n        client: {client_value!r}")
    check(f"{card} ({field}): and it is the corrected value, not the raw one",
          bot_value == c["to"] and bot_value != raw_value,
          f"(got {bot_value!r}, wanted {c['to']!r})")


# ══ §2 `g` means two different things, and only one of them is corrected ══
section("§2 the gold TEXT marker is corrected; the wood COST pip is untouched")

# ⚠ THE TRAP THIS SECTION EXISTS FOR. The letter `g` means two unrelated things
# depending on which field it is in:
#     cost : the WOOD pip   (dsl.ts ELEMENT_OF_PIP — r fire, b water, e earth,
#                            g wood, m metal, l light, d dark)
#     text : `{g}`, the GOLD keyword marker that colours the next word
# Owner, 2026-09-01: "{g} is in the text marker and it makes the following word
# GOLD. It's used for giving units attributes." A summary that did not
# distinguish the two was read as a claim that four cards were missing an
# element from their affinity cost — a serious and completely different bug. So
# both halves are pinned, separately.

check("no correction touches a cost — this table has never edited an affinity cost",
      not any(c["field"] == "cost" for c in CORRECTIONS),
      "(a correction is editing `cost`; `g` there is the WOOD pip, not the gold "
      "text marker, and that would need its own ruling)")

# whole-pool sweep, derived: every card's cost must read the same to both
# consumers, so a correction cannot perturb one without this going red
_cost_drift = [
    n for n, c in PRINTED.items()
    if n in FIXED and str(FIXED[n][0].get("cost", "")) != str(c.get("cost", ""))
]
check(f"all {len(PRINTED)} cards' affinity costs still agree, bot vs client",
      not _cost_drift, f"(drifted: {_cost_drift[:6]})")
check("...and that sweep is not vacuous - the pool really carries costs",
      sum(1 for c in PRINTED.values() if c.get("cost")) > 400)

# the gold marker: carried in the corrected DATA, stripped for DISPLAY. Both
# are true at once and neither implies the other.
_gold = [c for c in CORRECTIONS if "{g}" in c["to"]]
check("the gold marker IS shipped in the corrected data",
      len(_gold) > 0,
      "(the {g} corrections were held back - the owner ruled they are text "
      "formatting and belong in the corrected data for every reader)")
check("every shipped {g} is in a `text` field, never a type line or a cost",
      all(c["field"] == "text" for c in _gold))
check("plain_text still strips {g} for DISPLAY - a marker, not a word",
      plain_text("gains {g}piercing until regroup") == "gains piercing until regroup")
check("Brough and Rotspore Herald both carry the marker in the corrected data",
      "{g}" in FIXED["Brough"][0]["text"] and "{g}" in FIXED["Rotspore Herald"][0]["text"],
      f"\n        Brough  : {FIXED['Brough'][0]['text'][:56]!r}"
      f"\n        Rotspore: {FIXED['Rotspore Herald'][0]['text'][:56]!r}")


# ══ §3 a correction whose baseline moved is REFUSED ═══════════════════
section("§3 a stale correction raises rather than rewriting a fixed field")

_probe = copy.deepcopy(RAW)
_first = CORRECTIONS[0]
_probe[_first["card"]][0][_first["field"]] = "something nobody declared"
try:
    apply_corrections(_probe, CORRECTIONS)
    check("a moved baseline is refused", False, "(it applied the correction anyway)")
except StaleCorrectionError as e:
    check("a moved baseline is refused, loudly and by name", _first["card"] in str(e))

# …and the outcome we actually want is NOT an error: Caleb fixing it at source
_fixed_upstream = copy.deepcopy(RAW)
_fixed_upstream[_first["card"]][0][_first["field"]] = _first["to"]
try:
    n = apply_corrections(_fixed_upstream, CORRECTIONS)
    check("a correction already made AT SOURCE is a quiet no-op, not a crash",
          n == len(CORRECTIONS) - 1, f"(applied {n} of {len(CORRECTIONS)})")
except StaleCorrectionError as e:
    check("a correction already made at source is a quiet no-op", False, f"({e})")

# a missing artifact must not stop the bot booting
check("a checkout with no artifact loads the raw oracle rather than crashing",
      load_corrections(ORACLE_CORRECTIONS.parent / "no-such-file.json") == [])
# …and says so, once, on stderr: silently serving text the owner has already
# ruled wrong is the defect this whole module exists to close, so the one case
# where it still happens has to be audible to whoever can fix it.
_err = io.StringIO()
with contextlib.redirect_stderr(_err):
    load_corrections(ORACLE_CORRECTIONS.parent / "also-no-such-file.json")
    load_corrections(ORACLE_CORRECTIONS.parent / "also-no-such-file.json")
check("...and warns about it, exactly once per path rather than once per caller",
      _err.getvalue().count("UNCORRECTED") == 1, f"({_err.getvalue()!r})")


# ══ §4 the whole card lookup, end to end ══════════════════════════════
section("§4 the defect this closes, asked of the real CardIndex")

_idx = CardIndex()
for c in CORRECTIONS:
    card_obj, name, _ = _idx.lookup(c["card"])
    check(f"CardIndex.lookup({c['card']!r}) returns the corrected {c['field']}",
          card_obj.get(c["field"]) == c["to"],
          f"(got {card_obj.get(c['field'])!r})")

print("\n" + "=" * 46)
print(f"{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
