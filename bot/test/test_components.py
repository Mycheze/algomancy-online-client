#!/usr/bin/env python3
"""
test_components.py — the frozen custom_id contract for every button and select
the bot has ever posted. Run: `.venv/bin/python bot/test/test_components.py`.
No network, no Discord token, no DeepSeek key needed.

WHY THIS FILE EXISTS, AND WHY IT IS WRITTEN AS A FROZEN TABLE.

A `discord.ui.DynamicItem` carries its state in the custom_id and is rebuilt
from a regex when somebody clicks. That is what makes these buttons survive a
restart — and it also means the regex is a WIRE FORMAT, not an implementation
detail. Every message the bot has already posted is still sitting in Discord
with its custom_id baked in. Change a template and those buttons do not error
loudly; they stop matching, and the clicker gets "This interaction failed".

So the failure mode is silent, it is remote, and its latency is however long it
takes somebody to scroll back to a month-old `&wtp` post. Nothing else in this
repo would notice. Hence a literal table of the ten patterns, spelled out
rather than derived from the classes: a test that reads the template off the
class it is testing agrees with any change to it, which is precisely the
agreement we do not want.

If a template below genuinely must change, the migration is not editing this
file. It is: keep the old class registered so old messages still work, add the
new one alongside, and delete the old one when you no longer care about
messages from before the change.

Also covers the two mechanical limits Discord enforces and discord.py does
not: a custom_id is capped at 100 characters, and a template must match the
custom_id its own constructor emits.
"""

# ── reaching the bot package ──────────────────────────────────────────
# This file sits one directory below bot/ and is run directly, so Python puts
# THIS directory on sys.path — not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory, so this
# run cannot append to the deployment's live logs. See _scratch_var.py.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import asyncio  # noqa: E402
import re  # noqa: E402

# ⚠ THE COMPONENTS MOVE BETWEEN MODULES; THE TABLE BELOW DOES NOT. This file
# was written against the pre-split bot.py and run there first, precisely so
# that pulling the bot apart could be proved to change none of these ten
# strings.
#
# It no longer asks a MODULE what it defines — it asks a built bot what is
# REGISTERED on it, which is the thing that actually matters. An unregistered
# DynamicItem does not raise: the class exists, the button renders, and the
# click silently fails for whoever clicked it. Scanning a module would have
# said everything was fine.
import asyncio as _aio  # noqa: E402

import bot as botmod  # noqa: E402

_BUILT = _aio.run(botmod.build_bot())
REGISTERED = {c.__name__: c
              for c in _BUILT._connection._view_store._dynamic_items.values()}

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


# ── the frozen table ──────────────────────────────────────────────────
#
# name -> (template, a constructor call, the custom_id it must produce,
#          the state from_custom_id must hand back)
#
# ⚠ DO NOT REGENERATE THIS FROM THE CLASSES. The literals are the point.

FROZEN = {
    "FeedbackButton": (
        r"fb:(?P<rating>good|weird|bad):(?P<rid>[0-9a-f]+)",
        lambda C: C("good", "0123abcdef"),
        "fb:good:0123abcdef",
        {"rating": "good", "rid": "0123abcdef"},
    ),
    "CardSelect": (
        r"cardsel:v1",
        lambda C: C([]),
        "cardsel:v1",
        {},
    ),
    "PlayedButton": (
        r"co:played:(?P<key>[a-z\-]+)",
        lambda C: C("earth-fire-wood"),
        "co:played:earth-fire-wood",
        {"key": "earth-fire-wood"},
    ),
    "RerollButton": (
        r"co:roll:(?P<uid>\d+):(?P<key>[a-z\-]+)",
        lambda C: C("778331995297808438", "earth-fire-wood"),
        "co:roll:778331995297808438:earth-fire-wood",
        {"uid": "778331995297808438", "key": "earth-fire-wood"},
    ),
    "PickButton": (
        r"dp:(?P<slot>\d+):(?P<code>.+)",
        lambda C: C(15, "p1p6-7GK2QX"),
        "dp:15:p1p6-7GK2QX",
        {"slot": "15", "code": "p1p6-7GK2QX"},
    ),
    "PickClearButton": (
        r"dpx:(?P<code>.+)",
        lambda C: C("p1p6-7GK2QX"),
        "dpx:p1p6-7GK2QX",
        {"code": "p1p6-7GK2QX"},
    ),
    "RevealButton": (
        r"wr:(?P<pid>wtp-[0-9A-Z]+)",
        lambda C: C("wtp-COLUMN"),
        "wr:wtp-COLUMN",
        {"pid": "wtp-COLUMN"},
    ),
    "HintButton": (
        r"wh:(?P<pid>wtp-[0-9A-Z]+)",
        lambda C: C("wtp-COLUMN"),
        "wh:wtp-COLUMN",
        {"pid": "wtp-COLUMN"},
    ),
    "PostSolutionButton": (
        r"wp:(?P<pid>wtp-[0-9A-Z]+)",
        lambda C: C("wtp-COLUMN"),
        "wp:wtp-COLUMN",
        {"pid": "wtp-COLUMN"},
    ),
    "NextPuzzleButton": (
        r"wn:(?P<pid>wtp-[0-9A-Z]+)",
        lambda C: C("wtp-COLUMN"),
        "wn:wtp-COLUMN",
        {"pid": "wtp-COLUMN"},
    ),
}


print("\n[the ten templates are exactly what they have always been]")
for name, (template, _make, _cid, _state) in FROZEN.items():
    cls = REGISTERED.get(name)
    check(f"{name} is registered on the bot", cls is not None)
    if cls is None:
        continue
    # ⚠ Read the COMPILED pattern, not `cls.template` — on the class that is a
    # property descriptor, so comparing it to a string is a check that can
    # never pass and would have frozen nothing.
    actual = cls.__discord_ui_compiled_template__.pattern
    check(
        f"{name}'s template is unchanged\n"
        f"      frozen: {template!r}\n"
        f"      actual: {actual!r}\n"
        "      ⚠ every button already posted to Discord carries the OLD id. "
        "Changing a template does not error — it silently stops matching, and "
        "the clicker gets 'This interaction failed'. Register the old class "
        "alongside the new one instead.",
        actual == template,
    )

print("\n[non-vacuity: the table covers every component the bot registers]")
found = set(REGISTERED)
missing = found - set(FROZEN)
check(
    f"no DynamicItem is missing from the frozen table (unlisted: {sorted(missing)})",
    not missing,
)
check(f"…and the table is not empty (found {len(found)})", len(found) == 10)

print("\n[a template matches the id its own constructor emits]")
for name, (template, make, want_cid, want_state) in FROZEN.items():
    cls = REGISTERED.get(name)
    if cls is None:
        continue
    item = make(cls)
    got = item.item.custom_id
    check(f"{name} emits {want_cid!r} (got {got!r})", got == want_cid)

    # Discord's own cap. Nothing in discord.py enforces it, and the id is only
    # rejected when the message is SENT — i.e. in production, not here.
    check(f"{name}'s custom_id is within Discord's 100-char cap ({len(got)})",
          len(got) <= 100)

    m = cls.__discord_ui_compiled_template__.fullmatch(got)
    check(f"{name}'s template fullmatches its own custom_id", m is not None)
    if m is None:
        continue

    # …and the round trip really reconstructs the state. `interaction` and
    # `item` are unused by every one of these, which is what makes this
    # callable offline.
    rebuilt = asyncio.run(cls.from_custom_id(None, None, m))
    check(f"{name} round-trips through from_custom_id", isinstance(rebuilt, cls))
    check(f"{name}'s regex captures {sorted(want_state)}",
          m.groupdict() == want_state)

print("\n[the worst case still fits]")
{
    # PickButton is the only id whose length is driven by user input: a draft
    # seed can be 32 characters (draft._MAX_SEED). Nothing else here is
    # variable-length in a way a person controls.
}
import draft  # noqa: E402
worst = REGISTERED["PickButton"](16, f"p1p6-{'W' * draft._MAX_SEED}")
check(
    f"⭐ PickButton with a max-length seed is {len(worst.item.custom_id)} chars, "
    "under the cap — draft._MAX_SEED is the only thing keeping it there",
    len(worst.item.custom_id) <= 100,
)
check("…and that id still matches its own template",
      REGISTERED["PickButton"].__discord_ui_compiled_template__
      .fullmatch(worst.item.custom_id) is not None)

# ⚠ slot FIRST, code LAST is load-bearing: a pasted draft code contains a dash
# and an arbitrary seed may contain more, so a code-first layout could not be
# parsed back apart. Assert the ORDER, not just the fields.
check(
    "⭐ PickButton puts the slot before the code, so a seed containing dashes "
    "still parses",
    re.match(r"^dp:\d+:", worst.item.custom_id) is not None,
)

# ── the command surface ───────────────────────────────────────────────
#
# Splitting bot.py apart could drop a command and nothing would say so: the
# decorators register against a module-level object, so a block that fails to
# move simply stops existing. These are the eleven names the bot has answered
# to, plus every alias, and they are what the slash migration has to keep
# covering — a user who types `&raq` after the flip must not meet silence.
print("\n[the command surface is what it has always been]")
COMMANDS = {
    "ask": (), "card": (), "search": ("find",), "ruling": ("rulings", "raq"),
    "colors": ("colours", "combo"), "played": (), "p1p1": (), "p1p6": (),
    "wtp": ("puzzle", "whatstheplay"), "feedback": (), "help": (),
}

registered = {c.name: tuple(c.aliases) for c in botmod.bot.commands}
check(f"all eleven commands are registered (got {sorted(registered)})",
      set(registered) == set(COMMANDS))
for name, aliases in COMMANDS.items():
    check(f"&{name} exists", name in registered)
    if name in registered:
        check(f"&{name}'s aliases are {aliases or '(none)'} "
              f"(got {registered[name] or '(none)'})",
              set(registered[name]) == set(aliases))

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
