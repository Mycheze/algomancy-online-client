#!/usr/bin/env python3
"""test_mods.py — graft/augment combinations: legality, rules text, art stacking.

Run: python3 test_mods.py
"""
import sys

import mods
from cards import CardIndex

CARDS = CardIndex()
fails = []


def check(label, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"        got:  {got!r}\n        want: {want!r}")
        fails.append(label)


def check_that(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        if detail:
            print(f"        {detail}")
        fails.append(label)


def combo_text(query):
    return mods.build(query, CARDS).text


def error_for(query):
    try:
        mods.build(query, CARDS)
    except mods.ComboError as e:
        return str(e)
    return None


print("--- the two combinations from the feature request ---")
check(
    "graft: General Smof + Spectrogenesis",
    combo_text("General Smof + Spectrogenesis"),
    'After combat, [Switch1] Each player sacrifices a unit. [Switch1] Create three '
    'Wisps. (They are 0/1 units that can\'t block with "Sacrifice me after combat.")',
)
check(
    "augment: Aetherflux Golem + A Pile of Rubbish",
    combo_text("Aetherflux Golem + A Pile of Rubbish"),
    "[Augment] I gain +2/+2.\n[Augment] When I die, draw a card.",
)

print("\n--- only the transferable part of the bottom card carries over ---")
# Plodding Pebble's cause ("When I am dealt damage") must be dropped: the host
# supplies the cause. Its reminder line must not come along either.
check(
    "graft drops the grafted card's own cause",
    combo_text("General Smof + Plodding Pebble"),
    "After combat, [Switch1] Each player sacrifices a unit. "
    "[Switch1] Put a +1/+1 counter on me.",
)
# Stellarspore Harvester's first paragraph is NOT part of its augment.
check(
    "augment takes only the (+) paragraph, not the whole card",
    combo_text("Aetherflux Golem + Stellarspore Harvester"),
    "[Augment] I gain +2/+2.\n[Augment] When I die, give each unit you control "
    "with a -1/-1 counter on it to target opponent.",
)

print("\n--- text reflow ---")
# "cre- {/n}ate" is a printed line-wrap; the combined text is a fresh rendering.
check_that(
    "words hyphenated across a printed line are rejoined",
    "cre- ate" not in combo_text("Aetherflux Golem + Arcane Concentrator")
    and "create an X/X unit" in combo_text("Aetherflux Golem + Arcane Concentrator"),
    combo_text("Aetherflux Golem + Arcane Concentrator"),
)
check_that(
    "'-1/-1' is not mangled by the de-hyphenation",
    "-1/-1" in combo_text("Aetherflux Golem + Stellarspore Harvester"),
)

print("\n--- legality ---")
check_that(
    "can't graft onto a card with no graft symbol",
    "no graft symbol" in (error_for("Aetherflux Golem + Spectrogenesis") or ""),
    error_for("Aetherflux Golem + Spectrogenesis"),
)
check_that(
    "can't put a card with neither symbol under another",
    "no augment (+) or graft symbol" in (error_for("General Smof + Bubb") or ""),
    error_for("General Smof + Bubb"),
)
check_that(
    "any unit can be augmented, symbol or not",
    error_for("Bubb + A Pile of Rubbish") is None,
    error_for("Bubb + A Pile of Rubbish"),
)
check_that(
    "unknown card name is reported, not crashed on",
    "No card found" in (error_for("Zzzz Nonexistent + A Pile of Rubbish") or ""),
)
check_that(
    "Reconfigure is not an augment source (its [Augment] is reminder text)",
    "no augment (+) or graft symbol" in (error_for("General Smof + Reconfigure") or ""),
    error_for("General Smof + Reconfigure"),
)

print("\n--- host must be a unit, and order is forgiving ---")
# Spectrogenesis is a Spell, so it can't host. The reverse is legal, so we swap.
c = mods.build("Spectrogenesis + General Smof", CARDS)
check_that("a spell can't host, so the order is swapped", c.swapped and c.host_name == "General Smof",
           f"host={c.host_name} swapped={c.swapped}")
check("swapped combo reads the same as the right way round",
      c.text, combo_text("General Smof + Spectrogenesis"))
# Two spells: no swap can rescue it.
check_that(
    "two spells is an error, not a silent swap",
    "not a unit" in (error_for("Spectrogenesis + Accelerated Germination") or ""),
    error_for("Spectrogenesis + Accelerated Germination"),
)

print("\n--- multiple modifications ---")
c = mods.build("Amphivore + Spectrogenesis + Accelerated Germination", CARDS)
check("two grafts both join the host's ability",
      c.text,
      "When my column deals combat damage to an opponent, [Switch1][Switch1][Switch1] "
      "(Trigger three copies of this graft ability as one single trigger). "
      "[Switch1] Create three Wisps. (They are 0/1 units that can't block with "
      '"Sacrifice me after combat.") [Switch1] Create two 1/1 units.')
c = mods.build("Plodding Pebble + Spectrogenesis + A Pile of Rubbish", CARDS)
check_that(
    "a graft and an augment on one host: graft joins the ability, augment gets its own line",
    c.text.count("\n") == 1 and c.text.endswith("[Augment] When I die, draw a card."),
    c.text,
)
check_that("too many modifications is refused",
           "I'll stack up to" in (error_for("Amphivore + Spectrogenesis + Foretell + "
                                            "Accelerated Germination + Arcane Echo + "
                                            "Channeled Boon") or ""))

print("\n--- titles ---")
check("combined title names both cards",
      mods.build("General Smof + Spectrogenesis", CARDS).title,
      "General Smof + Spectrogenesis")

print("\n--- art stacking ---")
c = mods.build("General Smof + Spectrogenesis", CARDS)
art = mods.render_stack(c, CARDS)
check_that("the stack renders to a JPEG", art is not None and art[:2] == b"\xff\xd8")
if art:
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(art))
    peek = mods.peek_height("Spectrogenesis")
    check("stack is one card tall plus the peek", im.size, (720, 1000 + peek))
    check_that("the peek reveals roughly one ability, not half the card",
               60 <= peek <= 220, f"peek={peek}")
    check_that("the upload stays small enough for Discord",
               len(art) < 2_000_000, f"{len(art)} bytes")

# Every mod card's peek must be sane: enough to show its ability, never so much
# that it exposes text that doesn't transfer.
peeks = {n: mods.peek_height(n) for n, c2 in CARDS.cards.items()
         if mods.mod_kind(c2) and CARDS.art_path(n)}
odd = {n: p for n, p in peeks.items() if not (55 <= p <= 260)}
check_that(f"all {len(peeks)} peeks are within one to four text lines", not odd, f"{odd}")

print("\n--- every legal pairing holds up ---")
# Nothing in the card pool should crash the builder or produce empty text.
srcs = [(n, c) for n, c in CARDS.cards.items() if mods.mod_kind(c)]
hosts = [(n, c) for n, c in CARDS.cards.items() if mods.is_unit(c)]
graft_hosts = [(n, c) for n, c in hosts if mods.has_graft_symbol(c)]
built = broke = 0
for hname, hcard in hosts:
    for sname, scard in srcs:
        if sname == hname:
            continue
        kind = mods.mod_kind(scard)
        if kind == "graft" and not mods.has_graft_symbol(hcard):
            continue
        try:
            combo = mods.build(f"{hname} + {sname}", CARDS)
            if not combo.text.strip():
                broke += 1
            else:
                built += 1
        except mods.ComboError:
            broke += 1
print(f"       {len(hosts)} unit hosts ({len(graft_hosts)} graft-capable), {len(srcs)} sources")
check_that(f"all {built} legal pairings build with non-empty text", broke == 0,
           f"{broke} failed")

print("\n--- every modification card has an art anchor ---")
missing = [n for n, c in CARDS.cards.items()
           if mods.mod_kind(c) and CARDS.art_path(n) and n not in mods._anchors()]
check_that("no mod card falls back to a guessed peek", not missing, f"missing: {missing}")

print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails))
    sys.exit(1)
print("all good")
