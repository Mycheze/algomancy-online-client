#!/usr/bin/env python3
"""
test_card_aliases.py — a renamed card is found by either name.
Run: `.venv/bin/python bot/test/test_card_aliases.py`. No network, no Discord token.

The website's search has always read the engine's registerAlias list. The bot's
own lookup, which also answers the in-game card inspector, did not: after six
Light & Dark renames "Grim Bargain" returned Rime Wraith and "Gzxyclop" nothing.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _scratch_var  # noqa: E402,F401  (first: points ALGO_VAR_DIR at a throwaway)
sys.path.insert(0, str(HERE.parent))

from cards import CardIndex, load_aliases  # noqa: E402
from cogs.common import card_choices  # noqa: E402

RENAMED = {
    "Grim Bargain": "Consuming Mass",
    "Gzxyclop": "Bloatfiend",
    "Its Dark Bubb": "Oodvick",
    "No Hand Killer": "Lost Shade",
    "Spore of Regenesis": "The Birthmother",
    "Unrelenting Horror": "Stakoloth",
}

aliases = load_aliases()
for old, now in RENAMED.items():
    assert aliases.get(old) == now, f"registerAlias({old!r}, {now!r}) was not read: {aliases}"
assert len(aliases) >= 8, f"only {len(aliases)} aliases read"

idx = CardIndex()

for old, now in RENAMED.items():
    for q in (old, old.lower(), old.upper()):
        card, matched, _ = idx.lookup(q)
        assert matched == now and card["name"] == now, f"lookup({q!r}) -> {matched!r}, want {now!r}"
    card, matched, _ = idx.lookup(now)
    assert matched == now, f"lookup({now!r}) -> {matched!r}"
    hits = idx.search(old, limit=3)
    assert hits and hits[0].name == now, f"search({old!r}) -> {[h.name for h in hits]}"

# part of a former name, typed alone, when no current name holds those words
assert idx.lookup("Gzxy")[1] == "Bloatfiend", idx.lookup("Gzxy")[1]
assert idx.lookup("Regenesis")[1] == "The Birthmother", idx.lookup("Regenesis")[1]
assert idx.lookup("dark bubb")[1] == "Oodvick", idx.lookup("dark bubb")[1]

# a misspelled former name reaches the card too
assert idx.lookup("Gzxyclopp")[1] == "Bloatfiend", idx.lookup("Gzxyclopp")[1]

# a current card is never displaced by something that used to be called that
assert idx.lookup("Bubb")[1] == "Bubb", idx.lookup("Bubb")[1]
assert idx.lookup("Dreadspawn Horror")[1] == "Dreadspawn Horror"
for name in idx.names:
    assert idx.lookup(name)[1] == name, f"lookup({name!r}) -> {idx.lookup(name)[1]!r}"

# Discord's name suggestions: the old name leads to the card under its new name
for old, now in RENAMED.items():
    got = [(c.name, c.value) for c in card_choices(old)]
    assert (f"{now} (was {old})", now) in got, f"card_choices({old!r}) -> {got}"
    assert len(got) <= 25
new = [(c.name, c.value) for c in card_choices("Bloatfiend")]
assert new == [("Bloatfiend", "Bloatfiend")], new

print("test_card_aliases: PASS")
