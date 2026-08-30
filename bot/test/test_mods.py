#!/usr/bin/env python3
"""test_mods.py — graft/augment combinations: legality, rules text, art stacking.

Run: python3 test_mods.py
"""

# ── reaching the bot package ──────────────────────────────────────────
# This file sits one directory below bot/ and is run directly, so Python puts
# THIS directory on sys.path — not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

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

print("\n--- the (+) on the TYPE line grants attributes ---")
# Twenty cards are augments with an empty text box: their (+) heads the type line,
# so what transfers is the attributes. Reading only the text box called every one
# of them unaugmentable.
check_that(
    "a card whose only (+) is on its type line IS an augment source",
    error_for("General Smof + Chitin Shredder") is None,
    error_for("General Smof + Chitin Shredder"),
)
c = mods.build("General Smof + Chitin Shredder", CARDS)
check("the host gains the attribute", c.type, "{Powerful} Occult Spirit Unit")
check("the host's own rules text is untouched", c.text,
      "After combat, [Switch1] Each player sacrifices a unit.")
# The manual's own worked example: "Rampart Guardian ... can be augmented to grant
# the 'Tough' attribute to an ally".
check("the manual's Rampart Guardian example",
      mods.build("General Smof + Rampart Guardian", CARDS).type,
      "{Tough} Occult Spirit Unit")
# An attribute augment adds no text at all, so the note is the only prose that
# tells the player what happened.
check("the note says what was granted",
      mods.build("General Smof + Chitin Shredder", CARDS).describe(),
      "Chitin Shredder augmenting General Smof, granting Powerful")
check_that(
    "the subtypes stay behind — the host doesn't become an Insect",
    "Insect" not in mods.build("General Smof + Chitin Shredder", CARDS).type,
    mods.build("General Smof + Chitin Shredder", CARDS).type,
)
check_that(
    # The virus symbol is the icon in the card's top-right corner, not part of the
    # printed type line: it says how *this card* may be applied, not how its host
    # fights. Slink is {Thieving} ... {Virus}; only Thieving carries over.
    "{Virus} is not an attribute and doesn't transfer",
    mods.augment_attributes(CARDS.cards["Slink"]) == ["Thieving"],
    mods.augment_attributes(CARDS.cards["Slink"]),
)
check("two attributes on one card both transfer",
      mods.augment_attributes(CARDS.cards["Noxious Sporefiend"]), ["Poisonous", "Swift"])
# Augmenting Flying onto a flier grants nothing; printing it twice would imply it did.
check("an attribute the host already has isn't printed twice",
      mods.build("Ephemeral Skywalker + Nebula Drifter", CARDS).type,
      "[Augment] {Flying} Cloud Sprite Unit")
# Two attribute augments on one host, and a graft host keeps its graft text.
c = mods.build("Aetherflux Golem + Rampart Guardian + Slink", CARDS)
check("two attribute augments stack onto one host", c.type,
      "{Tough} {Thieving} Golem Sprite {Virus} Unit")
check("...and the host's augment paragraph still reads through", c.text,
      "[Augment] I gain +2/+2.")

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
    # Auric Ascendant, not Bubb: Bubb's (+) is on its type line, which makes it a
    # perfectly good augment source. Auric Ascendant has no symbol anywhere.
    "can't put a card with neither symbol under another",
    "no augment (+) or graft symbol" in (error_for("General Smof + Auric Ascendant") or ""),
    error_for("General Smof + Auric Ascendant"),
)
check_that(
    "any unit can be augmented, symbol or not",
    error_for("Auric Ascendant + A Pile of Rubbish") is None,
    error_for("Auric Ascendant + A Pile of Rubbish"),
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
# Nothing in the card pool should crash the builder or produce a combination that
# reads exactly like the host alone. "Adds something" is the invariant, not "adds
# text": an attribute augment contributes no text at all, and its whole effect is
# on the type line — so a pairing counts as built if either half moved.
srcs = [(n, c) for n, c in CARDS.cards.items() if mods.mod_kind(c)]
hosts = [(n, c) for n, c in CARDS.cards.items() if mods.is_unit(c)]
graft_hosts = [(n, c) for n, c in hosts if mods.has_graft_symbol(c)]
attr_srcs = [(n, c) for n, c in srcs if mods.augment_attributes(c)]
built = broke = 0
inert = []
for hname, hcard in hosts:
    for sname, scard in srcs:
        if sname == hname:
            continue
        kind = mods.mod_kind(scard)
        if kind == "graft" and not mods.has_graft_symbol(hcard):
            continue
        try:
            combo = mods.build(f"{hname} + {sname}", CARDS)
        except mods.ComboError:
            broke += 1
            continue
        gained_text = combo.text.strip() != mods.flow(hcard.get("text")).strip()
        gained_attr = combo.type != (hcard.get("type") or "").strip()
        if gained_text or gained_attr:
            built += 1
        else:
            # The one honest way to add nothing: an attribute the host already has.
            inert.append(f"{hname} + {sname}")
print(f"       {len(hosts)} unit hosts ({len(graft_hosts)} graft-capable), {len(srcs)} sources "
      f"({len(attr_srcs)} of them attribute augments)")
check_that(f"all {built} legal pairings build and change the card", broke == 0,
           f"{broke} failed to build")
check_that(
    "the only combinations that change nothing are duplicate attributes",
    all(mods.augment_attributes(CARDS.cards[p.split(" + ")[1]]) for p in inert),
    f"{len(inert)} inert: {inert[:5]}",
)

print("\n--- every modification card has an art anchor ---")
missing = [n for n, c in CARDS.cards.items()
           if mods.mod_kind(c) and CARDS.art_path(n) and n not in mods._anchors()]
check_that("no mod card falls back to a guessed peek", not missing, f"missing: {missing}")

print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails))
    sys.exit(1)
print("all good")
