#!/usr/bin/env python3
"""
test_draft.py — offline tests for the pack-1-pick-X draft system (draft.py + the
web /api/draft endpoint). Run: `.venv/bin/python test_draft.py`. No network, no
Discord token, no DeepSeek key needed.

Covers: the draftable pool (matches the Manual's 54-per-element), seeded
determinism and order-independence, the p1p1 / p1p6 preset rules, code parsing /
round-tripping, image rendering, and the FastAPI endpoint.
"""


# ── reaching the bot package ──────────────────────────────────────────
# This file sits one directory below bot/ and is run directly, so Python puts
# THIS directory on sys.path — not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

import draft

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


def _raises(fn, exc=draft.DraftError):
    try:
        fn()
        return False
    except exc:
        return True


# --- the draftable pool --------------------------------------------------
print("pool")
check("54 mono cards per element (matches the Manual)",
      all(len(draft.MONO[e]) == 54 for e in draft.ELEMENTS))
check("all 10 hybrid pairs, 5 cards each",
      len(draft.HYBRIDS) == 10 and all(len(v) == 5 for v in draft.HYBRIDS.values()))
check("full pool is 320 cards", len(draft.FULL_POOL) == 320)

# Nothing undraftable leaked in: no help cards / resources / tokens / glitch /
# colourless / card backs.
_bad = []
for name in draft.FULL_POOL:
    c = draft.CARDS.cards[name]
    tl = (c.get("type") or "").lower()
    fs = draft.CARDS.factions(c)
    if (c.get("Side") != "Front" or c.get("complexity") == "Glitch"
            or any(w in tl for w in ("help card", "resource", "token"))
            or not fs or any(f not in draft._ORDER for f in fs)):
        _bad.append(name)
check("pool excludes all non-draftables", not _bad)

# Pools are sorted → a seed reproduces the same pack no matter the source order.
check("full pool is canonically sorted", draft.FULL_POOL == sorted(draft.FULL_POOL))
check("mono/hybrid lists are sorted",
      all(v == sorted(v) for v in draft.MONO.values())
      and all(v == sorted(v) for v in draft.HYBRIDS.values()))


class _FakeIndex:
    """A CardIndex-shaped stand-in with the cards dict in a different order."""
    factions = staticmethod(draft.CARDS.factions)

    def __init__(self, cards):
        self.cards = cards


_reordered = dict(reversed(list(draft.CARDS.cards.items())))
_mono2, _hy2 = draft.build_pools(_FakeIndex(_reordered))
check("pool building is independent of source-JSON order",
      _mono2 == draft.MONO and _hy2 == draft.HYBRIDS)


# --- p1p1 ----------------------------------------------------------------
print("p1p1")
p = draft.generate("p1p1", "HELLO")
check("p1p1 is a 10-card pack", len(p.slots) == 10)
check("p1p1 picks 1", p.picks == 1)
check("p1p1 has no duplicate slots", len(set(p.slots)) == 10)
check("p1p1 draws from the whole set", set(p.slots) <= set(draft.FULL_POOL))
check("p1p1 lists all 5 elements", len(p.elements) == 5)


# --- p1p6 ----------------------------------------------------------------
print("p1p6")
q = draft.generate("p1p6", "HELLO")
check("p1p6 is a 16-card pack", len(q.slots) == 16)
check("p1p6 picks 6", q.picks == 6)
check("p1p6 has no duplicate slots", len(set(q.slots)) == 16)
check("p1p6 uses exactly 3 elements", len(q.elements) == 3)
check("p1p6 elements are in game order",
      list(q.elements) == sorted(q.elements, key=draft._ORDER.__getitem__))
_allowed = set(draft.element_pool(q.elements))
check("every p1p6 card is within the 3 chosen elements (or their hybrids)",
      set(q.slots) <= _allowed)
# The pool for 3 elements = 3×54 mono + 3 hybrid pairs ×5 = 177.
check("p1p6 pool is 177 cards", len(_allowed) == 177)
# A hybrid outside the chosen trio must never appear.
_outside = [pair for pair in draft.HYBRIDS if not set(pair) <= set(q.elements)]
_outside_cards = {n for pair in _outside for n in draft.HYBRIDS[pair]}
check("no out-of-trio hybrids in the pack", not (set(q.slots) & _outside_cards))


# --- determinism & seeds -------------------------------------------------
print("determinism")
check("same code reproduces the same pack",
      draft.generate("p1p6", "HELLO").slots == q.slots
      and draft.generate("p1p6", "HELLO").elements == q.elements)
check("seeds are case-insensitive", draft.generate("p1p6", "hello").slots == q.slots)
check("different seeds differ",
      draft.generate("p1p6", "AAA").slots != draft.generate("p1p6", "BBB").slots)
check("mode matters: same seed, different mode differs",
      draft.generate("p1p1", "HELLO").slots != draft.generate("p1p6", "HELLO").slots[:10])
check("minted seeds are unique-ish",
      len({draft.mint_seed() for _ in range(200)}) > 190)
check("over-long seeds are capped", len(draft.normalize_seed("x" * 500)) == draft._MAX_SEED)


# --- codes ---------------------------------------------------------------
print("codes")
check("code format is mode-seed", q.code == "p1p6-HELLO")
check("parse_code round-trips", draft.parse_code("P1P6-abc") == ("p1p6", "ABC"))
check("parse_code rejects junk", _raises(lambda: draft.parse_code("nonsense")))
check("resolve empty mints a fresh pack", draft.resolve("p1p1").mode == "p1p1")
check("resolve uses the arg as a seed", draft.resolve("p1p6", "HELLO").slots == q.slots)
_pasted = draft.resolve("p1p6", "p1p1-HELLO")   # a pasted full code wins
check("resolve honours a pasted full code (its own mode wins)",
      _pasted.mode == "p1p1" and _pasted.seed == "HELLO")
check("pack_from_code rebuilds the exact pack",
      draft.pack_from_code(q.code).slots == q.slots)
check("resolve rejects an unknown mode", _raises(lambda: draft.resolve("p9p9")))


# --- image rendering -----------------------------------------------------
print("images")
pack_png = draft.render_pack_image(q)
check("pack image is a PNG", pack_png[:4] == b"\x89PNG")
check("pack image is non-trivial", len(pack_png) > 10_000)
picks_png = draft.render_picks_image(q, [1, 3, 5, 7, 9, 11])
check("picks image is a PNG", picks_png[:4] == b"\x89PNG")
check("highlighting changes the image",
      draft.render_pack_image(q, highlight=[1, 2, 3]) != pack_png)


# --- payload -------------------------------------------------------------
print("payload")
pl = draft.pack_payload(q, art_url=lambda n: f"/art/{n}")
check("payload has one entry per slot", len(pl["slots"]) == 16)
check("payload slots are numbered 1..N",
      [s["slot"] for s in pl["slots"]] == list(range(1, 17)))
check("payload carries art urls", all(s["art_url"] for s in pl["slots"]))
check("payload code matches", pl["code"] == q.code)


# --- web endpoint --------------------------------------------------------
print("web /api/draft")
from fastapi.testclient import TestClient  # noqa: E402
import app as webapp  # noqa: E402

with TestClient(webapp.app) as client:
    r = client.get("/api/draft", params={"mode": "p1p6", "seed": "HELLO"})
    check("endpoint 200s", r.status_code == 200)
    body = r.json()
    check("endpoint reproduces the same pack",
          [s["name"] for s in body["slots"]] == list(q.slots))
    check("endpoint serves real art urls",
          all(s["art_url"] and s["art_url"].startswith("/art/") for s in body["slots"]))
    check("endpoint mints when no seed given",
          client.get("/api/draft", params={"mode": "p1p1"}).json()["code"].startswith("p1p1-"))
    check("bad mode is a 400",
          client.get("/api/draft", params={"mode": "zzz"}).status_code == 400)
    # Deep-link form: a full code passed as the seed reproduces exactly.
    deep = client.get("/api/draft", params={"mode": "p1p6", "seed": "p1p1-HELLO"}).json()
    check("endpoint honours a pasted full code",
          deep["mode"] == "p1p1" and [s["name"] for s in deep["slots"]]
          == list(draft.generate("p1p1", "HELLO").slots))


print(f"\nALL {PASS} CHECKS PASSED")
