#!/usr/bin/env python3
"""
draft.py — "pack 1, pick X" draft practice, the way Algomancy actually plays.

Two presets, both faithful to the Manual's live-draft rules:

  * p1p1 — a whole-set pack of 10 (the game's standard pack size), pick the one
    card you'd take. Drawn from the real draftable deck: the 5 elements plus every
    two-colour hybrid pair.
  * p1p6 — a turn-1 live-draft scenario. The Manual deals each player 16 cards on
    the first turn (4 for the opening hand, 10 for the pack, 2 for the first draw
    step) and has them "combine into a pile of 16 for drafting", keeping 6 and
    leaving 10 in the pack. So p1p6 = a 16-card pack you pick 6 from. Live draft
    for 2-3 players uses 3 elements, so the pack is built from 3 randomly chosen
    elements plus the 3 hybrid pairs among them — nothing you couldn't really see.

Everything is reproducible from a short **code** like `p1p6-7GK2QX`: same code →
same three elements and same sixteen cards, so you can save a pack, paste it into
the other front-end, or send it to a friend and you're both looking at the same
thing. A bare command (`&p1p6`) mints a fresh random code.

Framework-agnostic, like combos.py: no Discord and no FastAPI here, and the pure
draft logic imports with no third-party deps. `bot.py` and `app.py` drive it, and
image rendering (the only part that needs Pillow) is imported lazily so the engine
and its tests run without it.
"""

import hashlib
import os
import re
from dataclasses import dataclass

import cards as _cards
import combos

# One source of truth for the elements and their order (so the expansion's
# light/dark flow in exactly where combos.COLORS adds them).
ELEMENTS = combos.COLORS
_ORDER = {c: i for i, c in enumerate(ELEMENTS)}

# The shared card index. Its own instance rather than core.cards so the engine
# stays light and independently testable (cards.py is just JSON + difflib); tests
# can pass their own index into build_pools().
CARDS = _cards.CardIndex()


class DraftError(ValueError):
    """Bad mode/code input — the message is written to be shown to the user."""


# --- the draftable pool --------------------------------------------------
# The real drafted deck is elements + hybrids only: no colourless Prismite/Shard
# resources, no Kickstarter Glitch cards, no tokens or help cards, no card backs.
# Filtering to exactly that reproduces the Manual's "54 <element> cards" per
# element (verified: 54 each × 5 + 50 hybrids = 320).

def _draftable(card):
    if card.get("Side") != "Front":
        return False
    type_line = (card.get("type") or "").lower()
    if "help card" in type_line or "resource" in type_line or "token" in type_line:
        return False
    if card.get("complexity") == "Glitch":          # Kickstarter Glitch cards
        return False
    fs = _cards.CardIndex.factions(card)
    # Must be one or two of the real elements (drops colourless / unknown).
    return bool(fs) and all(f in _ORDER for f in fs)


def build_pools(index=CARDS):
    """(mono, hybrids) for a card index.

    mono[element]      -> sorted card names of that single element
    hybrids[pair]      -> sorted card names of that two-element pair, keyed by a
                          canonical-order tuple e.g. ('fire', 'water')

    Names are sorted so a seed reproduces the same pack no matter what order the
    source JSON happens to be in.
    """
    mono = {e: [] for e in ELEMENTS}
    hybrids = {}
    for name, card in index.cards.items():
        if not _draftable(card):
            continue
        fs = tuple(sorted(index.factions(card), key=_ORDER.__getitem__))
        if len(fs) == 1:
            mono[fs[0]].append(name)
        else:
            hybrids.setdefault(fs, []).append(name)
    for names in mono.values():
        names.sort()
    for names in hybrids.values():
        names.sort()
    return mono, hybrids


MONO, HYBRIDS = build_pools()

# The whole draftable set, sorted — the p1p1 pool.
FULL_POOL = sorted(
    [n for names in MONO.values() for n in names]
    + [n for names in HYBRIDS.values() for n in names])


def element_pool(elements):
    """The live-draft pool for a set of elements: their mono cards plus every
    hybrid pair that lies entirely within the set. Sorted for reproducibility."""
    chosen = set(elements)
    pool = [n for e in chosen for n in MONO[e]]
    for pair, names in HYBRIDS.items():
        if set(pair) <= chosen:
            pool += names
    return sorted(pool)


# --- presets -------------------------------------------------------------

@dataclass(frozen=True)
class PackSpec:
    name: str
    elements: int | None   # None = whole set; N = choose N elements at random
    pack_size: int
    picks: int
    label: str
    blurb: str


MODES = {
    "p1p1": PackSpec(
        "p1p1", elements=None, pack_size=10, picks=1,
        label="Pack 1, Pick 1",
        blurb="A standard 10-card pack from the whole set. Which one do you take?"),
    "p1p6": PackSpec(
        "p1p6", elements=3, pack_size=16, picks=6,
        label="Pack 1, Pick 6 · turn-1 live draft",
        blurb="Your turn-1 pile of 16 (opening hand + pack + first draw), from 3 "
              "elements. Keep 6, leave 10 in the pack."),
}


# --- seeds & codes -------------------------------------------------------
# A code is "<mode>-<seed>". The seed is what varies; minted seeds use a
# Crockford-ish base32 alphabet (no I/L/O/U, so nothing reads ambiguously), but a
# user can pass any string as a seed and it's honoured — hashed the same way.

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CODE_RE = re.compile(r"^\s*(p1p1|p1p6)-(.+?)\s*$", re.IGNORECASE)


def mint_seed(length=6):
    """A fresh random shareable seed like '7GK2QX'."""
    return "".join(_ALPHABET[b % len(_ALPHABET)] for b in os.urandom(length))


# Cap seed length so a code (and the Discord button custom_ids that embed it,
# limited to 100 chars) stay short. Only absurdly long custom seeds are affected.
_MAX_SEED = 32


def normalize_seed(seed):
    """Fold a seed to the canonical form we hash. Uppercased, trimmed, and length-
    capped so a friend re-typing a code in the wrong case still lands on the same
    pack and the code stays short."""
    return (seed or "").strip().upper()[:_MAX_SEED]


def _rng(mode, seed):
    """A deterministic RNG for (mode, seed).

    Seeded off a SHA-256 digest rather than Python's hash() so the same code
    reproduces the same pack across processes and Python versions (hash() is
    salted per-process). random.Random(int) itself is stable across versions.
    """
    import random
    digest = hashlib.sha256(f"{mode}:{normalize_seed(seed)}".encode()).digest()
    return random.Random(int.from_bytes(digest, "big"))


# --- packs ---------------------------------------------------------------

@dataclass(frozen=True)
class Pack:
    mode: str
    seed: str                 # normalized (uppercased) seed
    elements: tuple           # elements the pack was built from, in game order
    slots: tuple              # card names; slot n is slots[n - 1]
    picks: int                # how many you're meant to pick

    @property
    def code(self):
        return f"{self.mode}-{self.seed}"

    @property
    def spec(self):
        return MODES[self.mode]


def generate(mode, seed=None):
    """Build a reproducible pack for `mode` (mints a random seed if none given)."""
    if mode not in MODES:
        raise DraftError(f"Unknown draft mode “{mode}”. Try p1p1 or p1p6.")
    spec = MODES[mode]
    seed = normalize_seed(seed) if seed else mint_seed()
    rng = _rng(mode, seed)

    if spec.elements is None:
        elements = tuple(ELEMENTS)
        pool = FULL_POOL
    else:
        # Choose the elements first, then the cards, both off the same RNG. The
        # element population is combos.COLORS (fixed order), and every pool is
        # name-sorted, so the draw order — and thus the pack — depends only on
        # the seed, never on dict/JSON ordering.
        picked = rng.sample(list(ELEMENTS), spec.elements)
        elements = tuple(sorted(picked, key=_ORDER.__getitem__))
        pool = element_pool(elements)

    slots = tuple(rng.sample(pool, spec.pack_size))
    return Pack(mode, seed, elements, slots, spec.picks)


def parse_code(code):
    """'p1p6-7GK2QX' -> ('p1p6', '7GK2QX'). Raises DraftError if it isn't one."""
    m = _CODE_RE.match(code or "")
    if not m:
        raise DraftError(f"“{code}” isn't a draft code like `p1p6-7GK2QX`.")
    return m.group(1).lower(), normalize_seed(m.group(2))


def pack_from_code(code):
    """A Pack from a full code string like 'p1p6-7GK2QX' (parse + generate)."""
    mode, seed = parse_code(code)
    return generate(mode, seed)


def resolve(mode, arg=None):
    """Turn a command argument into a Pack.

      * empty            -> a fresh random pack in `mode`
      * a full code      -> exactly that pack (its OWN mode + seed wins, so a
                            pasted `p1p1-…` reproduces even via `&p1p6`)
      * anything else    -> `mode` with the argument used as the seed

    So `&p1p6`, `&p1p6 7GK2QX`, `&p1p6 p1p6-7GK2QX`, and `&p1p6 my-cool-seed`
    all do the sensible thing.
    """
    arg = (arg or "").strip()
    if not arg:
        return generate(mode)
    m = _CODE_RE.match(arg)
    if m:
        return generate(m.group(1).lower(), m.group(2))
    return generate(mode, arg)


def pack_payload(pack, art_url=None):
    """A JSON-friendly dict for the web/API and for tests. `art_url(name)` maps a
    card name to an image URL (or None); defaults to no art."""
    art_url = art_url or (lambda _n: None)
    return {
        "mode": pack.mode,
        "seed": pack.seed,
        "code": pack.code,
        "label": pack.spec.label,
        "blurb": pack.spec.blurb,
        "elements": list(pack.elements),
        "picks": pack.picks,
        "pack_size": len(pack.slots),
        "slots": [{"slot": i, "name": name, "art_url": art_url(name)}
                  for i, name in enumerate(pack.slots, 1)],
    }


# --- image rendering -----------------------------------------------------
# Pillow is imported here, lazily, so the pure engine (and its tests) don't need
# it. Both front-ends call render_pack_image / render_picks_image; the Discord bot
# posts the bytes as an attachment, and the web app can use them as a share image.

# Card art is a uniform 720×1000; thumbnail to this width and derive the height.
_THUMB_W = 240
_THUMB_H = round(_THUMB_W * 1000 / 720)
_GAP = 16
_PAD = 20
_BG = (24, 25, 28)
_ACCENT = (88, 101, 242)      # Discord blurple, matches the embeds
_BADGE_BG = (0, 0, 0)
_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _cols(n):
    """4 across for the 16-card pack, 5 for the 10-card pack."""
    return 4 if n > 12 else 5


def _font(size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(_FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def _thumb(name, index):
    """A card's art thumbnail, or a labelled placeholder if it has no image."""
    from PIL import Image, ImageDraw
    path = index.art_path(name)
    if path:
        img = Image.open(path).convert("RGB").resize((_THUMB_W, _THUMB_H))
        return img
    img = Image.new("RGB", (_THUMB_W, _THUMB_H), (45, 47, 52))
    d = ImageDraw.Draw(img)
    d.text((10, 10), name, font=_font(16), fill=(220, 220, 220))
    return img


def _badge(draw, x, y, text, *, accent=False):
    """A round slot-number badge in a card's top-left corner."""
    r = 17
    fill = _ACCENT if accent else _BADGE_BG
    draw.ellipse([x + 6, y + 6, x + 6 + 2 * r, y + 6 + 2 * r], fill=fill,
                 outline=(255, 255, 255), width=2)
    font = _font(20)
    l, t, rr, b = draw.textbbox((0, 0), text, font=font)
    draw.text((x + 6 + r - (rr - l) / 2, y + 6 + r - (b - t) / 2 - t),
              text, font=font, fill=(255, 255, 255))


def _compose(entries, index, *, highlight=None):
    """Grid image of (slot_number, card_name) entries.

    `highlight` is an optional set of slot numbers: those are ringed in accent and
    the rest are dimmed, so a pack can be shown with someone's picks called out.
    Returns PNG bytes.
    """
    from PIL import Image, ImageDraw
    n = len(entries)
    cols = _cols(n)
    rows = (n + cols - 1) // cols
    W = _PAD * 2 + cols * _THUMB_W + (cols - 1) * _GAP
    H = _PAD * 2 + rows * _THUMB_H + (rows - 1) * _GAP
    canvas = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(canvas)

    for i, (slot, name) in enumerate(entries):
        col, row = i % cols, i // cols
        x = _PAD + col * (_THUMB_W + _GAP)
        y = _PAD + row * (_THUMB_H + _GAP)
        thumb = _thumb(name, index)
        picked = highlight is not None and slot in highlight
        if highlight is not None and not picked:
            thumb = Image.eval(thumb, lambda p: p // 3)      # dim the non-picks
        canvas.paste(thumb, (x, y))
        if picked:
            draw.rectangle([x, y, x + _THUMB_W - 1, y + _THUMB_H - 1],
                           outline=_ACCENT, width=6)
        _badge(draw, x, y, str(slot), accent=picked)

    import io
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def render_pack_image(pack, index=CARDS, highlight=None):
    """The whole pack as a numbered grid (optionally highlighting some slots)."""
    entries = list(enumerate(pack.slots, 1))
    return _compose(entries, index, highlight=set(highlight) if highlight else None)


def render_picks_image(pack, picks, index=CARDS):
    """Just the chosen cards, in slot order, each ringed as a pick."""
    chosen = [(i, name) for i, name in enumerate(pack.slots, 1) if i in set(picks)]
    return _compose(chosen, index, highlight={s for s, _ in chosen})
