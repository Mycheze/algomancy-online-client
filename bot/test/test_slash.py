#!/usr/bin/env python3
"""
test_slash.py — the slash command tree, checked offline.
Run: `.venv/bin/python bot/test/test_slash.py`. No network, no Discord token.

WHY AN OFFLINE TEST OF A THING THAT ONLY EXISTS ON DISCORD.

`cmd.to_dict(tree)` returns the EXACT JSON Discord will be sent, so almost
everything that can be wrong about a command tree can be seen from here — and
the failure mode on the other side is unusually bad. Discord validates a sync
ATOMICALLY: one command with an illegal name or an over-length description
rejects the WHOLE payload, and the symptom is not an error in a log, it is the
bot coming up with no commands at all. That is worth catching in a script.

§1 non-vacuity, first, so nothing below can pass by testing an empty tree
§2 the rules Discord enforces at sync time: names, descriptions, limits
§3 ⭐ THE MIGRATION COVERAGE TABLE — every `&` command that ever existed,
   mapped to what replaces it. Retiring one becomes a deliberate edit here
   instead of a user typing into silence.
§4 ⭐ THE DEFER GUARD. Any handler that can take longer than three seconds must
   acknowledge first, or the user gets "The application did not respond" —
   permanently, with no way for the bot to correct it afterwards.
§5 the tree signature, which decides whether the deploy syncs at all
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import inspect  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402

import bot as botmod  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


BOT = asyncio.run(botmod.build_bot())
TREE = BOT.tree


def walk(cmds, prefix=""):
    """Every leaf command, as the user types it, with the object behind it."""
    out = []
    for c in cmds:
        if hasattr(c, "commands"):
            out += walk(c.commands, prefix + c.name + " ")
        else:
            out.append((prefix + c.name, c))
    return out


LEAVES = dict(walk(TREE.get_commands()))
TOP = list(TREE.get_commands())

# ── §1 non-vacuity ────────────────────────────────────────────────────
print("\n[§1 there is a tree at all]")
check(f"at least 12 commands (got {len(LEAVES)}: {sorted(LEAVES)})", len(LEAVES) >= 12)
check("…and the bot registered its components too "
      f"({len(BOT._connection._view_store._dynamic_items)})",
      len(BOT._connection._view_store._dynamic_items) == 10)

# ── §2 what Discord will reject ───────────────────────────────────────
# ⚠ WHAT THIS SECTION IS ACTUALLY FOR. discord.py validates command NAMES at
# decoration time and raises, so the name checks below are a backstop for a name
# built at runtime rather than the main event. It does NOT check description
# length, option descriptions, or the tree's total payload size — and Discord
# rejects a sync ATOMICALLY, so one 101-character description means the bot
# comes up with no commands at all and nothing says why. Those are the ones
# earning their keep here.
print("\n[§2 the rules Discord enforces atomically at sync time]")
NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
for name, cmd in sorted(LEAVES.items()):
    for part in name.split():
        check(f"/{name}: '{part}' is a legal command name", bool(NAME_RE.match(part)))
    desc = getattr(cmd, "description", "")
    check(f"/{name} has a description", bool(desc))
    check(f"/{name}'s description is within 100 chars ({len(desc)})", len(desc) <= 100)

for cmd in TOP:
    payload = cmd.to_dict(TREE)
    check(f"/{cmd.name} serialises", isinstance(payload, dict) and payload.get("name"))
    size = len(json.dumps(payload))
    # Discord caps the whole tree at 8000 bytes; no single command should be
    # anywhere near that, and one that is means a description ran away.
    check(f"/{cmd.name}'s payload is small ({size}B)", size < 4000)

    for opt in payload.get("options", []) or []:
        d = opt.get("description", "")
        check(f"/{cmd.name} option '{opt.get('name')}' is described "
              f"({len(d)} chars)", 0 < len(d) <= 100)

check(f"the whole tree is under Discord's 100-command cap ({len(TOP)})", len(TOP) <= 100)
total = len(json.dumps([c.to_dict(TREE) for c in TOP]))
check(f"…and under the 8000-byte payload cap ({total}B)", total < 8000)

# ── §3 the migration coverage table ───────────────────────────────────
print("\n[§3 ⭐ every & command has somewhere to go]")
# name (and aliases) -> the slash command that replaces it.
# ⚠ A user who types a retired `&` command must not meet silence. Retiring one
# is a deliberate edit HERE, not a gap nobody noticed.
REPLACES = {
    "ask": "ask",
    "card": "card",
    "search": "find",          # the BM25 describer. The query language is /search.
    "find": "find",
    "ruling": "rulings", "rulings": "rulings", "raq": "rulings",
    "colors": "colors suggest", "colours": "colors suggest", "combo": "colors suggest",
    "played": "colors log",
    "p1p1": "draft", "p1p6": "draft",
    "wtp": "puzzle play", "puzzle": "puzzle play", "whatstheplay": "puzzle play",
    "feedback": "feedback",
    "help": "help",
}
prefix_names = set()
for c in botmod.bot.commands:
    prefix_names.add(c.name)
    prefix_names.update(c.aliases)
check(f"every live & command is in the table (missing: "
      f"{sorted(prefix_names - set(REPLACES))})",
      not (prefix_names - set(REPLACES)))
for old, new in sorted(REPLACES.items()):
    check(f"&{old} -> /{new} exists", new in LEAVES)

# ── §4 the defer guard ────────────────────────────────────────────────
print("\n[§4 ⭐ anything slow acknowledges within three seconds]")
# Handlers that touch DeepSeek, Pillow, the disk or the network. Each must
# acknowledge before doing any of it.
SLOW = ["ask", "card", "find", "rulings", "draft",
        "puzzle play", "puzzle list", "colors suggest", "colors log", "colors stats"]
# …and the one that must NOT defer: send_modal() IS an initial response, so a
# deferred interaction can no longer open one.
NEVER_DEFER = ["feedback"]

for name in SLOW:
    cmd = LEAVES.get(name)
    check(f"/{name} exists to be checked", cmd is not None)
    if cmd is None:
        continue
    src = inspect.getsource(cmd.callback)
    awaits = re.findall(r"await\s+([\w.()\[\]]+)", src)
    check(f"⭐ /{name} defers before anything else it awaits "
          f"(first await is {awaits[0] if awaits else 'none'})",
          bool(awaits) and ("start(" in awaits[0] or ".defer(" in src.split(awaits[0])[0]))

for name in NEVER_DEFER:
    cmd = LEAVES.get(name)
    if cmd is None:
        continue
    src = inspect.getsource(cmd.callback)
    check(f"⭐ /{name} does NOT defer — send_modal() is itself the first response",
          "start(" not in src and ".defer(" not in src)

# ── §5 the sync decision ──────────────────────────────────────────────
print("\n[§5 the tree signature decides whether the deploy syncs]")
sig = botmod.tree_signature(TREE)
check(f"a signature is produced ({sig})", bool(sig) and len(sig) == 12)
check("…and it is stable across two builds of the same tree",
      botmod.tree_signature(asyncio.run(botmod.build_bot()).tree) == sig)

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
