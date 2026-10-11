#!/usr/bin/env python3
"""
test_primer.py — the judge bot's PRIMER states no known-false rule.
Run: `.venv/bin/python bot/test/test_primer.py`. Offline: no key, no network.

The PRIMER (bot/core.py) is background the model states WITHOUT a citation, so
a wrong line in it is a hallucination with authority. The 2026-10-11 audit split
it into claims and checked each against the Manual, card text, RAQ rulings and
the Comprehensive Rules; these are the false statements it found (or that the
eval caught the bot repeating). Each entry carries the false sentence it was
written against, and the test first proves the pattern still matches that
sentence — so a pattern that has rotted into matching nothing fails loudly
instead of passing forever.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import re  # noqa: E402

import core  # noqa: E402

PASS = 0


def check(name, ok):
    global PASS
    if not ok:
        print(f"FAIL: {name}")
        _sys.exit(1)
    PASS += 1
    print(f"  ok  {name}")


# (what is false, pattern, a sentence that states it — mostly the old primer's own words)
DENY = [
    ("tokens are trashed (reversed 2026-09-28; CR 801.2d)",
     r"\btokens?\s+(are|is|can be|get)\s+trashed",
     "Tokens are trashed, yes."),
    ("six elements / factions (eval g003; CR 105.1 says seven)",
     r"\bsix\s+(elemental\s+)?(elements|factions)\b",
     "There are six factions in total."),
    ("five elements as the whole pool (Light & Dark make seven)",
     r"\bfive\s+elemental\s+factions\b",
     "Five elemental factions — Fire, Water, Earth, Wood, Metal — plus colorless cards."),
    ("colorless cards (no source; the cause of g003)",
     r"\bcolou?rless\b",
     "plus colorless (faction-neutral) cards"),
    ("Conjure as a live mechanic (no current card prints it)",
     r"\bconjure\s+(makes|creates)\b",
     "Conjure makes a spell token cast at a set time."),
    ("rot is never removed (Burn the Blight removes it; CR 112.13a)",
     r"\brot\s+is\s+never\s+removed\b",
     "Rot is never removed once gained."),
    ("glimpse reveals only the top card (Glimpse N; CR 801.9)",
     r"\bglimpse\b\W+reveal\s+the\s+top\s+card\b",
     "Glimpse — reveal the top card of the deck and cache it."),
    ("Burst can be cast any time (Burst tokens are Battle cards; CR 803.5)",
     r"\bburst\b[^.\n]*\bany\s+time\b",
     "Burst — a non-combat attribute; can be cast any time."),
    ("Deadly is combat-only (CR 802.3e)",
     r"\bcombat\s+damage\s+it\s+deals\s+destroys\b",
     "Deadly — any amount of combat damage it deals destroys the unit it hits."),
    ("the Wraith is a 4/4 (redesigned to 3/3 on 2026-08-21)",
     r"\bwraith\b[^.\n]*\b4/4\b(?!\s+printing)",
     "Wraith — a 4/4 Blight Zombie Token Unit."),
    ("mods are not played only 'provisionally' (RAQ: Mods are NOT Played)",
     r"\bprovisional\s+clarification\b",
     '"Playing" vs "applying a mod" (provisional clarification, pending errata)'),
    ("other games' terms the model then imports",
     r"\b(trample|deathtouch|lifelink|instant\s+speed)\b",
     "Haste — may be played during the haste step (instant speed in that window)."),
    ("Skirmish as the current term (it is region now)",
     r"\bis\s+a\s+skirmish\b",
     "each spot where one player's attackers meet a defender is a Skirmish"),
]

print("denylist patterns still match what they were written against")
for name, pat, example in DENY:
    check(f"pattern bites: {name}", re.search(pat, example, re.I) is not None)

print("the primer states none of them")
for name, pat, _ in DENY:
    m = re.search(pat, core.PRIMER, re.I)
    check(f"primer clean: {name}" + (f" — found {m.group(0)!r}" if m else ""), m is None)

print("the facts that replaced them are there")
check("seven elements, Light and Dark named", "SEVEN elements" in core.PRIMER and "Light and Dark" in core.PRIMER)
check("a hybrid card belongs to two elements", "hybrid card belongs to two elements" in core.PRIMER)
check("tokens are not trashed", "any TOKEN" in core.PRIMER and "it is not trashed" in core.PRIMER)

print(f"\n{PASS} checks passed ✅")
