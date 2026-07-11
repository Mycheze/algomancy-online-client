#!/usr/bin/env python3
"""
combos.py — "what three colours should we play next?"

A deck is three of the game's colours. With the base five that's ten distinct
combos; the point of this module is to remember which ones you've already played
and steer you toward the ones you haven't, so a playgroup actually sees the whole
game instead of drifting back to the same two or three pairings.

The suggestion rule has two layers. Coverage decides WHICH combos are eligible;
freshness decides which of those you get:

  * Coverage — while any combo is unplayed, only unplayed ones are eligible, so
    you always see all of them before repeating any. Once they're all played,
    the stalest third (longest untouched) becomes eligible instead.
  * Freshness — among the eligible combos, pick the one whose *colours* you've
    used least recently, ties broken at random. This stops back-to-back games
    leaning on the same colours, which coverage alone doesn't prevent: without
    it you can follow Fire/Earth/Metal with Fire/Earth/Wood and it'll happily
    call that "fresh" because the trio is new.

Framework-agnostic (no Discord, no FastAPI): `bot.py` and `app.py` both import it,
and history is read/written through `store.py`.
"""

import itertools
import random
import re
from datetime import datetime, timedelta, timezone

# The game's colours, in the game's own order. THIS IS THE ONLY THING THE
# EXPANSION CHANGES: append "light" and "dark" here and everything downstream
# follows — ALL_COMBOS goes from 10 to 35, coverage/progress rescale themselves,
# and both front-ends pick it up with no other edits. (Icons/emojis for the new
# colours would need adding separately; missing ones degrade to plain text.)
COLORS = ("fire", "water", "earth", "metal", "wood")

# A deck is three colours mixed together.
COMBO_SIZE = 3

_ORDER = {c: i for i, c in enumerate(COLORS)}

# Every legal colour set, each in canonical (game) order. C(5,3) = 10 today.
ALL_COMBOS = [
    tuple(sorted(c, key=_ORDER.__getitem__))
    for c in itertools.combinations(COLORS, COMBO_SIZE)
]

# Things people actually type. The single letters are the game's own cost codes
# (r/m/b/e/g), so `&played r e g` works. Note there's no "w" — it would be
# ambiguous between water and wood.
ALIASES = {
    "r": "fire", "red": "fire",
    "b": "water", "blue": "water",
    "e": "earth", "brown": "earth",
    "m": "metal", "grey": "metal", "gray": "metal", "silver": "metal",
    "g": "wood", "green": "wood", "nature": "wood",
}

# Dropped when parsing, so "fire and earth and wood" reads the same as "fire earth wood".
_FILLER = {"and", "with", "plus", "we", "played", "playing", "deck", "colors", "colours"}

_WORDS_RE = re.compile(r"[^a-z]+")


class ComboError(ValueError):
    """Bad colour input — the message is written to be shown to the user as-is."""


# --- naming --------------------------------------------------------------

def canonical(colors):
    """Order a colour set the way the game lists them, so it's a stable key."""
    return tuple(sorted(set(colors), key=_ORDER.__getitem__))


def key(combo):
    """Storage/custom_id form: 'fire-earth-wood'."""
    return "-".join(combo)


def label(combo):
    """Human form: 'Fire · Earth · Wood'."""
    return " · ".join(c.title() for c in combo)


def from_key(text):
    """Inverse of key(): 'fire-earth-wood' -> ('fire', 'earth', 'wood').

    Raises ComboError on anything that isn't a current, complete combo — a key
    can arrive from a stale Discord button or a hand-written URL, and after the
    expansion ships a "light-dark-fire" key could even outlive a rollback.
    """
    parts = [p for p in (text or "").lower().split("-") if p]
    if len(set(parts)) != COMBO_SIZE or any(p not in _ORDER for p in parts):
        raise ComboError(f"“{text}” isn't a valid {COMBO_SIZE}-colour combo.")
    return canonical(parts)


def parse_combo(text):
    """Parse free text like 'fire, earth & wood' into a canonical 3-colour tuple.

    Raises ComboError with a user-facing message on anything unparseable.
    """
    words = [w for w in _WORDS_RE.split((text or "").lower()) if w and w not in _FILLER]
    if not words:
        raise ComboError(f"Name {COMBO_SIZE} colours, e.g. `fire earth wood`.")

    picked = []
    for w in words:
        color = ALIASES.get(w) or (w if w in _ORDER else None)
        if color is None:
            raise ComboError(
                f"I don't know the colour “{w}”. The colours are: "
                + ", ".join(c.title() for c in COLORS) + ".")
        if color not in picked:      # tolerate "fire fire earth wood" -> dedupe
            picked.append(color)

    if len(picked) != COMBO_SIZE:
        raise ComboError(
            f"A deck is {COMBO_SIZE} different colours — I only counted "
            f"{len(picked)} ({', '.join(c.title() for c in picked)}).")
    return canonical(picked)


def record_combo(game):
    """The canonical combo in a stored game record, or None if it's unusable
    (hand-edited log, or a colour that no longer exists)."""
    colors = game.get("colors") or []
    if len(set(colors)) != COMBO_SIZE or any(c not in _ORDER for c in colors):
        return None
    return canonical(colors)


# --- history -------------------------------------------------------------

def logged_recently(games, combo, hours=6):
    """Did this person already record `combo` in the last `hours`?

    A double-tapped confirm button (or one click from each surface) shouldn't
    count as two games. One session is nowhere near six hours, so anything inside
    that window is the same game being logged twice.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    for game in games:
        if record_combo(game) != tuple(combo):
            continue
        try:
            when = datetime.fromisoformat(game["ts"])
        except (KeyError, TypeError, ValueError):
            continue
        if when >= cutoff:
            return True
    return False


def coverage(games):
    """Summarise one person's play history.

    `games` is store.read_games() output (chronological). Returns played combos
    newest-first, the ones never played, and per-combo counts / last-played
    timestamps. ISO-8601 timestamps sort lexicographically, so plain string
    comparison is a correct chronological sort here.
    """
    counts, last = {}, {}
    for g in games:
        combo = record_combo(g)
        if not combo:
            continue
        counts[combo] = counts.get(combo, 0) + 1
        last[combo] = max(last.get(combo, ""), g.get("ts") or "")

    return {
        "counts": counts,
        "last": last,
        "played": sorted(last, key=lambda c: last[c], reverse=True),
        "unplayed": [c for c in ALL_COMBOS if c not in last],
        "total": len(ALL_COMBOS),
    }


# How many games back "recently used" reaches. A colour last seen this many games
# ago (or never) counts as maximally fresh, so ancient history doesn't sway the
# pick — only the recent run of games does.
FRESHNESS_HORIZON = 5


def color_gaps(games):
    """For each colour, how many games since it was last played (capped).

    1 = it was in the last game (stalest possible), FRESHNESS_HORIZON = not seen
    in a long time, or never. Higher is fresher.
    """
    recent = [c for c in (record_combo(g) for g in games) if c]
    gaps = {}
    for color in COLORS:
        gap = FRESHNESS_HORIZON
        for distance, combo in enumerate(reversed(recent), start=1):
            if color in combo:
                gap = min(distance, FRESHNESS_HORIZON)
                break
        gaps[color] = gap
    return gaps


def freshness(combo, gaps):
    """How fresh a combo's colours are overall — the sum of their gaps.

    Summing gaps does the two things we want at once: it favours colours you
    haven't touched lately, and (because a colour from last game contributes just
    1) it pushes the pick away from re-using the previous game's colours. That's
    what breaks up long streaks of the same colour.
    """
    return sum(gaps[c] for c in combo)


def suggest(games, *, exclude=None, rng=random):
    """Pick the next combo to play. Returns (combo, reason).

    reason is "new" when the combo has never been played (we're still filling in
    the grid) or "stale" when everything's been played and this is among the
    least-recently-used. `exclude` (a combo) is avoided where possible, so
    re-rolling gives you something different.

    Within whichever pool applies, we don't pick uniformly at random — we pick the
    combos whose colours are freshest (see `freshness`), breaking ties randomly.
    Coverage still comes first: while any combo is unplayed the pool is the
    unplayed ones, so you always see all of them before any repeat. Freshness only
    decides the ORDER you walk through them, keeping consecutive games from
    leaning on the same colours.

    (With 5 colours and 3 per deck, back-to-back games must share at least one
    colour — 3 + 3 > 5 — so the goal is minimising the overlap, not removing it.)
    """
    cov = coverage(games)
    pool, reason = cov["unplayed"], "new"

    if not pool:
        # Everything played at least once: draw from the stalest third, so it's
        # varied but still biased toward what you haven't seen in ages.
        last = cov["last"]
        ranked = sorted(ALL_COMBOS, key=lambda c: last[c])
        pool, reason = ranked[:max(1, len(ranked) // 3)], "stale"

    if exclude is not None and len(pool) > 1:
        pool = [c for c in pool if c != tuple(exclude)] or pool

    gaps = color_gaps(games)
    best = max(freshness(c, gaps) for c in pool)
    return rng.choice([c for c in pool if freshness(c, gaps) == best]), reason


def progress_bar(done, total, width=10):
    """'▰▰▰▱▱▱▱▱▱▱' — width is in cells, not combos, so it survives the expansion."""
    filled = round(width * done / total) if total else 0
    return "▰" * filled + "▱" * (width - filled)
