#!/usr/bin/env python3
"""
test_embeds.py — a golden snapshot of every embed the bot builds.
Run: `.venv/bin/python bot/test/test_embeds.py`. No network, no tokens.

WHY: bot.py was one 1397-line file, and splitting it into cogs is a big
MECHANICAL move — the kind where nothing type-checks it, no existing test
imports it, and a mistake surfaces as a slightly wrong embed weeks later.
`discord.Embed.to_dict()` is the exact payload that goes over the wire, so
freezing it turns "I think I moved that correctly" into a diff.

The golden file (`test/golden_embeds.json`) is COMMITTED, and it was generated
from the pre-split bot.py. Regenerate it only when an embed is deliberately
changed:  `python3 bot/test/test_embeds.py --bless`

⚠ Every input below is a literal, and the card names are real cards chosen to
exercise the renderers rather than to be pretty: one with icon tokens in its
text, one hybrid, one with no art. A snapshot over inputs that drift is a
snapshot that fails for reasons nobody caused.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import json  # noqa: E402

# ⚠ THE MODULE UNDER TEST MOVES, THE GOLDEN DOES NOT. Written against the
# pre-split bot.py and blessed there, so the split can be proved inert. When
# the builders move to discordui.py, THIS LINE is the only allowed edit.
import bot as ui  # noqa: E402
import combos  # noqa: E402
import core  # noqa: E402
import draft  # noqa: E402
import mods  # noqa: E402
import wtp  # noqa: E402

GOLDEN = _Path(__file__).resolve().parent / "golden_embeds.json"

# Cards picked for what they exercise, not for flavour.
CARDS = [
    "Aberrant Populace",   # [Switch1] + {i}…{/i} in text: the icon/format path
    "Tidal Menace",        # the set's one true vanilla unit
    "Mohruung",            # a [Switch1] trigger the rulings corpus knows
]


def snapshot():
    out = {}

    class FakeUser:
        """Just enough of a discord.User for the builders that footer with one."""
        display_name = "Tester"
        name = "Tester"
        id = 778331995297808438
        def __str__(self): return "Tester"

    user = FakeUser()

    # ── the card embed, the most-used one ──
    # build_card_embed returns (embed, file_or_None); the file is a handle to a
    # real jpeg, so only the embed is snapshotted.
    for name in CARDS:
        card, matched, alts = core.cards.lookup(name)
        embed, _file = ui.build_card_embed(card, matched, alts)
        out[f"card:{name}"] = embed.to_dict()

    # ── the text/cost/faction renderers, on their own ──
    # These run with NO emoji loaded (EMOJI is filled at on_ready from a live
    # guild), which is the fallback path — and the one a fresh guild sees.
    for name in CARDS:
        card, matched, _ = core.cards.lookup(name)
        out[f"text:{name}"] = ui.render_card_text(card.get("text") or "")
        out[f"cost:{name}"] = ui.render_cost(card.get("cost") or "")
        out[f"faction:{name}"] = ui.render_faction_label(card)

    # ── search results ──
    hits = core.cards.search("unit that draws a card when it dies", limit=6)
    out["search:field"] = ui.search_results_field(hits)
    out["search:names"] = [h.name for h in hits]

    # ── an answer embed, with citations rendered to footnotes ──
    q = "What happens to damage at regroup?"
    hits2 = core.retriever.search(q, k=4)
    answer = ("Damage is removed at regroup [source:manual:0018], and temporary "
              "buffs end [source:glossary:regroup].")
    out["answer"] = ui.answer_embed(q, answer, hits2).to_dict()
    out["answer:reasoning"] = ui.answer_embed(q, answer, hits2, reasoning=True).to_dict()
    out["_corpus_rows"] = len(core.retriever.rows)   # non-vacuity: the corpus loaded

    # ── colour combos ──
    combo = ("earth", "fire", "wood")
    cov = combos.coverage([])
    out["combo:suggestion"] = ui.suggestion_embed(user, combo, "never played", cov).to_dict()
    out["combo:stats"] = ui.stats_embed(user, cov).to_dict()

    # ── a grafted card: the mods.py skin ──
    graft = mods.build("Mohruung + Aberrant Populace", core.cards)
    built = ui.build_combo_embed(graft)
    out["combo:card"] = (built[0] if isinstance(built, tuple) else built).to_dict()

    # ── a draft pack (seeded, so the pack is identical every run) ──
    pack = draft.resolve("p1p6", "TESTSEED")
    out["draft:embed"] = ui.draft_embed(pack).to_dict()
    out["draft:slots"] = list(pack.slots)

    # ── the puzzles ──
    # ⚠ EVERY puzzle, not one: `&wtp` raised AttributeError on all three for as
    # long as the feature existed, because _resource_text read Side.resources
    # (a LIST of Resource cards) as a kind->count dict. Rendering them all is
    # what would have caught it.
    for pid in sorted(p.id for p in wtp.load_all()):
        puzzle = wtp.load(pid)
        out[f"wtp:{pid}"] = ui.wtp_embed(puzzle).to_dict()
        out[f"wtp:{pid}:solution"] = ui.solution_embed(puzzle).to_dict()

    return out


# ⚠ Compare through JSON, not against the live objects. A builder that returns
# a TUPLE round-trips out of the golden file as a LIST, and a snapshot test that
# failed on that would be failing on its own serialiser rather than on the code.
got = json.loads(json.dumps(snapshot(), ensure_ascii=False))

if "--bless" in _sys.argv:
    GOLDEN.write_text(json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"blessed {len(got)} snapshots -> {GOLDEN}")
    raise SystemExit(0)

if not GOLDEN.exists():
    raise SystemExit(f"no golden file at {GOLDEN} — run with --bless first")

want = json.loads(GOLDEN.read_text())

PASS = FAILED = 0
for key in sorted(set(want) | set(got)):
    if key not in got:
        print(f"  ✗ {key}: gone from the snapshot")
        FAILED += 1
    elif key not in want:
        print(f"  ✗ {key}: new, not in the golden (bless it if intended)")
        FAILED += 1
    elif got[key] != want[key]:
        print(f"  ✗ {key} changed")
        print(f"      want: {json.dumps(want[key], ensure_ascii=False)[:300]}")
        print(f"      got:  {json.dumps(got[key], ensure_ascii=False)[:300]}")
        FAILED += 1
    else:
        PASS += 1

# non-vacuity: an empty or tiny snapshot must not pass
if PASS and len(want) < 15:
    print(f"  ✗ the golden only has {len(want)} entries — it should cover every builder")
    FAILED += 1

print(f"\n{PASS} embed snapshots matched" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
