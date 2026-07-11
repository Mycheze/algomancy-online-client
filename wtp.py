#!/usr/bin/env python3
"""
wtp.py — "What's the Play?" puzzles: a board state, a question, and a solution.

A designer builds a scenario in the web editor ("you're at 12, they're at 7, they
swing with these three, you hold these two and have 4 mana — can you win?"), and
it becomes a puzzle anyone can pull up in the bot or on the website, answer, and
then reveal the solution to check themselves. Built for practising the things a
new player has to grind: combat math, blocking, when to hold a trick.

The board model is the game's, not a generic card-game one:

  * A puzzle happens in ONE region, because every effect in Algomancy is region-
    limited — a region is the whole world as far as a play is concerned.
  * Each side's units sit in COLUMNS. A formation "has a front and back row but
    can scale infinitely in width", so a column is at most two deep, and units are
    adjacent to their left/right/front/back neighbours — never diagonally. That
    adjacency is what shares combat attributes, so a puzzle that gets the columns
    wrong gets the answer wrong.
  * The two sides face each other: the front row of each formation is the row
    nearest the middle. Renderers lay the opponent's columns out bottom-up and
    yours top-down so the board reads the way it sits on the table.
  * Resources are per-element counts, because that single number does double duty
    in the game: how many you have is your mana, and which elements they are is
    your affinity (a `4bb` card needs two water). A puzzle that just said "5 mana"
    couldn't tell you whether you can actually cast the card in your hand.

Everything else a scenario needs but the model can't say — "they have Overbloom
face-up in the bin", "assume they hold a trick" — goes in free-text `notes`.

Framework-agnostic, like combos.py and draft.py: no Discord and no FastAPI here,
and the pure engine imports with no third-party deps. `bot.py` and `app.py` drive
it; Pillow (for the Discord board image) is imported lazily so the engine and its
tests run without it.

Puzzles are JSON files in `puzzles/` — one per puzzle, human-readable, committed
to the repo like any other content. The editor writes them; both front-ends read
them fresh on every request, so a puzzle saved on the website is instantly live
in the bot without a restart.
"""

import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cards as _cards
import combos
import mods

ROOT = Path(__file__).resolve().parent
PUZZLE_DIR = ROOT / "puzzles"

# The shared card index — its own instance, like draft.CARDS, so the engine stays
# light and independently testable (cards.py is just JSON + difflib).
CARDS = _cards.CardIndex()

# One source of truth for the elements, so the light/dark expansion flows in here
# the moment it's added to combos.COLORS.
ELEMENTS = combos.COLORS

PHASES = ("Planning", "Battle", "Regroup", "Deployment")
SIDES = ("you", "opponent")
ROLES = ("", "attacking", "blocking")
ROLE_TAG = {"attacking": "ATK", "blocking": "BLK"}   # short enough to sit on the art
DIFFICULTIES = ("easy", "medium", "hard")

# A formation column is two deep: "if two units are in a column then no third can
# be placed behind them — both slots are full" (RAQ). The editor enforces it, and
# so does validation, because a three-deep column isn't a legal board.
COLUMN_DEPTH = 2

# Enough to keep a puzzle readable (and its image a sane size) without ever
# getting in a designer's way. Boards this big don't fit on a table either.
MAX_COLUMNS = 8
MAX_HAND = 12
MAX_MODS = mods.MAX_MODS


class PuzzleError(ValueError):
    """A malformed puzzle or a bad id — the message is written to be shown."""


# --- ids -----------------------------------------------------------------
# Same shape as a draft code: short, unambiguous, and shareable by voice. A
# puzzle's id is its filename, so it's also how you find it on disk.

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"      # Crockford-ish: no I/L/O/U
_ID_RE = re.compile(r"^wtp-[0-9A-Z]{4,12}$")


def mint_id():
    """A fresh puzzle id like 'wtp-7GK2QX'."""
    return "wtp-" + "".join(_ALPHABET[b % len(_ALPHABET)] for b in os.urandom(6))


def normalize_id(pid):
    """Fold user input to a canonical id. Accepts a bare seed ('7gk2qx') as well
    as the full 'wtp-7GK2QX', so people can type either at the bot."""
    pid = (pid or "").strip().upper()
    if not pid:
        raise PuzzleError("Which puzzle? Give me an id like `wtp-7GK2QX`.")
    if not pid.startswith("WTP-"):
        pid = "WTP-" + pid
    pid = "wtp-" + pid[4:]
    if not _ID_RE.match(pid):
        raise PuzzleError(f"“{pid}” isn't a puzzle id like `wtp-7GK2QX`.")
    return pid


# --- the board -----------------------------------------------------------

@dataclass
class Unit:
    """A unit in play: a card, plus everything that's happened to it.

    `power`/`toughness` are MODIFIERS on the printed stats, not the stats
    themselves — one field covers +1/+1 counters, a buff spell and a Virus's
    -7/-7 alike, and it keeps the printed card as the source of truth (so the
    board still reads right if a card is ever errata'd).
    """
    card: str                                   # card name (fuzzy-matched on load)
    power: int = 0                              # stat modifier, may be negative
    toughness: int = 0
    damage: int = 0                             # damage marked this battle
    role: str = ""                              # "" | attacking | blocking
    mods: list = field(default_factory=list)    # cards grafted/augmented UNDER it
    note: str = ""                              # anything else ("shared Flying")

    def resolved(self, index=CARDS):
        """(canonical_name, card) for this unit, or (name, None) if no such card.

        Unknown names are kept rather than rejected: a designer may want a token
        or a hypothetical the set doesn't have, and a puzzle is worth more than
        a strict schema. Renderers show the name in a placeholder.
        """
        card, matched, _ = index.lookup(self.card)
        return (matched, card) if card else (self.card, None)

    def stats(self, index=CARDS):
        """Effective (power, toughness) — printed stats plus modifiers — or None
        for a card with no printed stats (a resource, a non-unit token)."""
        _name, card = self.resolved(index)
        if not card:
            return None
        try:
            base_p, base_t = int(card.get("power")), int(card.get("toughness"))
        except (TypeError, ValueError):
            return None                          # not a unit: nothing to add to
        return base_p + self.power, base_t + self.toughness

    def dead(self, index=CARDS):
        """Is this unit already lethally damaged? A board can't legally be in this
        state, so it's a validation warning, not a rendering mode."""
        st = self.stats(index)
        return bool(st) and self.damage >= st[1]


@dataclass
class Side:
    """One player's half of the region."""
    name: str = "You"
    life: int = 30
    # element -> number of that resource in play. Total = mana available;
    # per-element = affinity. See the module docstring.
    resources: dict = field(default_factory=dict)
    columns: list = field(default_factory=list)  # [[Unit, ...], ...] — max 2 deep
    hand: list = field(default_factory=list)     # card names (yours: shown)
    bin: list = field(default_factory=list)      # card names (graft/augment fodder)
    hand_count: int = 0                          # for the opponent: cards, unseen

    @property
    def mana(self):
        return sum(self.resources.values())

    @property
    def units(self):
        return [u for col in self.columns for u in col]

    def affinity(self, element):
        return self.resources.get(element, 0)


@dataclass
class Puzzle:
    id: str
    title: str
    question: str
    solution: str = ""
    hints: list = field(default_factory=list)
    notes: str = ""                              # extra board context, free text
    author: str = ""
    created: str = ""
    difficulty: str = "medium"
    tags: list = field(default_factory=list)     # e.g. ["combat math", "blocking"]

    phase: str = "Battle"
    turn: str = "you"                            # whose turn it is
    initiative: str = "you"                      # who has initiative
    you: Side = field(default_factory=lambda: Side(name="You"))
    opponent: Side = field(default_factory=lambda: Side(name="Opponent"))

    @property
    def sides(self):
        return {"you": self.you, "opponent": self.opponent}


# --- (de)serialisation ---------------------------------------------------
# Hand-editable JSON: a designer should be able to open a puzzle file, read it,
# and fix a typo without the editor. So: no nesting we don't need, no nulls, and
# empty fields are omitted on write rather than written as `null`.

def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _unit_from_json(d):
    if isinstance(d, str):                       # bare name shorthand: "Sprouter"
        d = {"card": d}
    if not isinstance(d, dict) or not (d.get("card") or "").strip():
        raise PuzzleError("Every unit needs a card name.")
    role = (d.get("role") or "").strip().lower()
    if role not in ROLES:
        raise PuzzleError(f"“{role}” isn't a role — use attacking, blocking, or none.")
    mod_names = [str(m).strip() for m in (d.get("mods") or []) if str(m).strip()]
    if len(mod_names) > MAX_MODS:
        raise PuzzleError(f"A unit can carry at most {MAX_MODS} modifications.")
    return Unit(
        card=d["card"].strip(),
        power=_int(d.get("power")), toughness=_int(d.get("toughness")),
        damage=max(0, _int(d.get("damage"))), role=role,
        mods=mod_names, note=(d.get("note") or "").strip())


def _unit_to_json(u):
    d = {"card": u.card}
    for key in ("power", "toughness", "damage"):
        if getattr(u, key):
            d[key] = getattr(u, key)
    if u.role:
        d["role"] = u.role
    if u.mods:
        d["mods"] = list(u.mods)
    if u.note:
        d["note"] = u.note
    return d


def _side_from_json(d, default_name):
    d = d or {}
    columns = []
    for col in d.get("columns") or []:
        units = [_unit_from_json(u) for u in col]
        if len(units) > COLUMN_DEPTH:
            raise PuzzleError(
                f"A column holds {COLUMN_DEPTH} units (a front and a back row) — "
                f"one here has {len(units)}.")
        if units:
            columns.append(units)
    if len(columns) > MAX_COLUMNS:
        raise PuzzleError(f"That's more than {MAX_COLUMNS} columns on one side.")

    resources = {}
    for element, n in (d.get("resources") or {}).items():
        element = str(element).strip().lower()
        if element not in ELEMENTS:
            raise PuzzleError(f"“{element}” isn't an element.")
        if _int(n) > 0:
            resources[element] = _int(n)

    hand = [str(c).strip() for c in (d.get("hand") or []) if str(c).strip()]
    bin_ = [str(c).strip() for c in (d.get("bin") or []) if str(c).strip()]
    if len(hand) > MAX_HAND or len(bin_) > MAX_HAND:
        raise PuzzleError(f"Keep the hand and bin to {MAX_HAND} cards each.")

    return Side(
        name=(d.get("name") or default_name).strip() or default_name,
        life=_int(d.get("life"), 30), resources=resources, columns=columns,
        hand=hand, bin=bin_, hand_count=max(0, _int(d.get("hand_count"))))


def _side_to_json(s):
    d = {"name": s.name, "life": s.life}
    if s.resources:
        # Written in game order, not insertion order, so two puzzles with the same
        # resources produce byte-identical files (nice diffs, no churn).
        d["resources"] = {e: s.resources[e] for e in ELEMENTS if s.resources.get(e)}
    if s.columns:
        d["columns"] = [[_unit_to_json(u) for u in col] for col in s.columns]
    if s.hand:
        d["hand"] = list(s.hand)
    if s.bin:
        d["bin"] = list(s.bin)
    if s.hand_count:
        d["hand_count"] = s.hand_count
    return d


def from_json(d):
    """Build a Puzzle from a dict. Raises PuzzleError with a readable reason."""
    if not isinstance(d, dict):
        raise PuzzleError("A puzzle must be a JSON object.")
    title = (d.get("title") or "").strip()
    question = (d.get("question") or "").strip()
    if not title:
        raise PuzzleError("Give the puzzle a title.")
    if not question:
        raise PuzzleError("Give the puzzle a question — that's the whole point of it.")

    phase = (d.get("phase") or "Battle").strip().title()
    if phase not in PHASES:
        raise PuzzleError(f"“{phase}” isn't a phase — use one of {', '.join(PHASES)}.")
    for key in ("turn", "initiative"):
        if (d.get(key) or "you") not in SIDES:
            raise PuzzleError(f"`{key}` must be “you” or “opponent”.")
    difficulty = (d.get("difficulty") or "medium").strip().lower()
    if difficulty not in DIFFICULTIES:
        raise PuzzleError(f"“{difficulty}” isn't a difficulty — "
                          f"use one of {', '.join(DIFFICULTIES)}.")

    return Puzzle(
        id=normalize_id(d["id"]) if d.get("id") else mint_id(),
        title=title, question=question,
        solution=(d.get("solution") or "").strip(),
        hints=[str(h).strip() for h in (d.get("hints") or []) if str(h).strip()],
        notes=(d.get("notes") or "").strip(),
        author=(d.get("author") or "").strip(),
        created=(d.get("created") or "").strip() or _now(),
        difficulty=difficulty,
        tags=[str(t).strip() for t in (d.get("tags") or []) if str(t).strip()],
        phase=phase,
        turn=d.get("turn") or "you", initiative=d.get("initiative") or "you",
        you=_side_from_json(d.get("you"), "You"),
        opponent=_side_from_json(d.get("opponent"), "Opponent"))


def to_json(p):
    """A Puzzle as a hand-editable dict (this is exactly what lands on disk)."""
    d = {
        "id": p.id, "title": p.title, "question": p.question,
        "difficulty": p.difficulty, "phase": p.phase,
        "turn": p.turn, "initiative": p.initiative,
        "you": _side_to_json(p.you), "opponent": _side_to_json(p.opponent),
        "solution": p.solution,
    }
    for key in ("hints", "notes", "author", "tags"):
        if getattr(p, key):
            d[key] = getattr(p, key)
    d["created"] = p.created
    return d


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- validation ----------------------------------------------------------
# Warnings, not errors. A puzzle with a typo'd card name is still a puzzle, and a
# designer mid-edit shouldn't be blocked — but they should be told, because a
# silently-unmatched card name renders as an empty grey box.

def validate(p, index=CARDS):
    """Non-fatal problems with a puzzle, as a list of human-readable strings."""
    warnings = []
    for key, side in p.sides.items():
        who = side.name or key
        for i, col in enumerate(side.columns, 1):
            for u in col:
                name, card = u.resolved(index)
                if not card:
                    warnings.append(f"{who}, column {i}: no card called “{u.card}”.")
                    continue
                if u.stats(index) is None and (u.power or u.toughness or u.damage):
                    warnings.append(
                        f"{who}: “{name}” has no printed stats, so its "
                        f"buffs/damage won't show.")
                if u.dead(index):
                    st = u.stats(index)
                    warnings.append(
                        f"{who}: “{name}” has {u.damage} damage but only {st[1]} "
                        f"toughness — it would already be dead.")
                if u.mods:
                    try:
                        mods.build(" + ".join([name] + list(u.mods)), index)
                    except mods.ComboError as exc:
                        warnings.append(f"{who}, “{name}”: {_plain(str(exc))}")
        for zone in ("hand", "bin"):
            for name in getattr(side, zone):
                if not index.lookup(name)[0]:
                    warnings.append(f"{who}'s {zone}: no card called “{name}”.")
    if not p.solution:
        warnings.append("No solution yet — nobody will be able to check their answer.")
    return warnings


_EMPHASIS_RE = re.compile(r"\*{1,2}")


def _plain(text):
    """mods.ComboError phrases its reasons in Discord markdown; a warning list is
    read as plain text on both surfaces, so drop the markers."""
    return _EMPHASIS_RE.sub("", text)


# --- storage -------------------------------------------------------------
# One JSON file per puzzle, named by id. Read fresh every time (the directory
# holds a handful of small files): a puzzle saved in the web editor is live in
# the Discord bot immediately, even though they're separate processes.

def path_for(pid):
    return PUZZLE_DIR / f"{normalize_id(pid)}.json"


def save(p):
    """Write a puzzle to `puzzles/<id>.json`. Returns the Puzzle."""
    PUZZLE_DIR.mkdir(exist_ok=True)
    body = json.dumps(to_json(p), indent=2, ensure_ascii=False) + "\n"
    # Write-then-rename so a reader (the bot, mid-request) can never see a
    # half-written file — it either sees the old puzzle or the new one.
    tmp = path_for(p.id).with_suffix(".json.tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path_for(p.id))
    return p


def load(pid):
    """Load one puzzle by id. Raises PuzzleError if there's no such puzzle."""
    path = path_for(pid)
    if not path.exists():
        raise PuzzleError(f"No puzzle called `{normalize_id(pid)}`.")
    try:
        return from_json(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as exc:
        raise PuzzleError(f"`{path.name}` isn't valid JSON: {exc}")


def delete(pid):
    path = path_for(pid)
    if not path.exists():
        raise PuzzleError(f"No puzzle called `{normalize_id(pid)}`.")
    path.unlink()


def load_all():
    """Every puzzle, newest first. A file that won't parse is skipped rather than
    breaking the list for everyone else."""
    if not PUZZLE_DIR.is_dir():
        return []
    puzzles = []
    for path in sorted(PUZZLE_DIR.glob("wtp-*.json")):
        try:
            puzzles.append(from_json(json.loads(path.read_text(encoding="utf-8"))))
        except (PuzzleError, json.JSONDecodeError, OSError):
            continue
    puzzles.sort(key=lambda p: p.created, reverse=True)
    return puzzles


# --- choosing what to serve ----------------------------------------------
# The same "don't repeat yourself" idea as combos.suggest: show someone a puzzle
# they haven't seen before, and only start recycling once they've seen them all.

def pick_next(puzzles, seen_ids, exclude=None, rng=None):
    """A puzzle to serve next, and why. (None, None) if there are no puzzles.

    Prefers one they've never opened; once they've seen everything, gives back
    the one they saw longest ago, so a re-run is at least a re-test.
    """
    import random
    rng = rng or random
    pool = [p for p in puzzles if p.id != exclude] or list(puzzles)
    if not pool:
        return None, None
    seen = list(seen_ids or [])
    fresh = [p for p in pool if p.id not in set(seen)]
    if fresh:
        return rng.choice(fresh), "new"
    # `seen` is oldest-first (it's an append-only log), so the id that appears
    # earliest in it is the one served longest ago.
    order = {}
    for i, pid in enumerate(seen):
        order[pid] = i                          # last occurrence wins
    return min(pool, key=lambda p: order.get(p.id, -1)), "again"


# --- payloads ------------------------------------------------------------
# One JSON shape, used by the web page, the editor's live preview, and the tests.
# The solution is NOT in it: it's fetched separately, so a puzzle's answer is
# never sitting in the page's memory (or its network tab) before you ask for it.

def _unit_payload(u, index, art_url):
    name, card = u.resolved(index)
    st = u.stats(index)
    combined = None
    if u.mods:
        # What the stack actually reads as, so a grafted unit shows its real
        # ability on the board instead of just the host's.
        try:
            combined = mods.build(" + ".join([name] + list(u.mods)), index).text
        except mods.ComboError:
            combined = None
    return {
        "card": name,
        "known": card is not None,
        "art_url": art_url(name) if card else None,
        "power": st[0] if st else None,
        "toughness": st[1] if st else None,
        "base": (f"{card.get('power')}/{card.get('toughness')}"
                 if card and st else None),
        "buff_p": u.power, "buff_t": u.toughness,
        "damage": u.damage,
        "role": u.role,
        "mods": list(u.mods),
        "text": combined if combined is not None else ((card or {}).get("text") or ""),
        "type": (card or {}).get("type", ""),
        "cost": (card or {}).get("cost", ""),
        "note": u.note,
    }


def _card_payload(name, index, art_url):
    card, matched, _ = index.lookup(name)
    return {
        "card": matched if card else name,
        "known": card is not None,
        "art_url": art_url(matched) if card else None,
        "text": (card or {}).get("text", ""),
        "type": (card or {}).get("type", ""),
        "cost": (card or {}).get("cost", ""),
        "power": (card or {}).get("power", ""),
        "toughness": (card or {}).get("toughness", ""),
    }


def _side_payload(s, index, art_url):
    return {
        "name": s.name,
        "life": s.life,
        "mana": s.mana,
        "resources": {e: s.resources[e] for e in ELEMENTS if s.resources.get(e)},
        "columns": [[_unit_payload(u, index, art_url) for u in col]
                    for col in s.columns],
        "hand": [_card_payload(c, index, art_url) for c in s.hand],
        "bin": [_card_payload(c, index, art_url) for c in s.bin],
        "hand_count": s.hand_count,
    }


def payload(p, index=CARDS, art_url=None, *, solution=False):
    """A JSON-friendly puzzle for the API and the page. `art_url(name)` maps a
    card name to an image URL (or None); defaults to no art."""
    art_url = art_url or (lambda _n: None)
    d = {
        "id": p.id, "title": p.title, "question": p.question,
        "notes": p.notes, "author": p.author, "created": p.created,
        "difficulty": p.difficulty, "tags": list(p.tags),
        "phase": p.phase, "turn": p.turn, "initiative": p.initiative,
        "hint_count": len(p.hints),
        "you": _side_payload(p.you, index, art_url),
        "opponent": _side_payload(p.opponent, index, art_url),
    }
    if solution:
        d["solution"] = p.solution
        d["hints"] = list(p.hints)
    return d


def summary(p):
    """The one-line form used by puzzle lists and pickers."""
    return {
        "id": p.id, "title": p.title, "question": p.question,
        "difficulty": p.difficulty, "tags": list(p.tags),
        "author": p.author, "created": p.created,
        "has_solution": bool(p.solution), "hint_count": len(p.hints),
    }


# --- text summaries ------------------------------------------------------
# The status line, in words. Both front-ends show it next to the board image, so
# it lives here and not in either of them.

def status_line(p):
    """'Battle phase · Your turn · You have initiative'."""
    turn = "Your turn" if p.turn == "you" else f"{p.opponent.name}'s turn"
    who = p.you.name if p.initiative == "you" else p.opponent.name
    init = "You have initiative" if p.initiative == "you" else f"{who} has initiative"
    return f"{p.phase} phase · {turn} · {init}"


def resource_line(side):
    """'4 mana · 🔥2 🌿2' — as plain text, with each element spelled out. Callers
    that have icons (both of ours do) swap the words for pictures themselves."""
    if not side.resources:
        return "no resources"
    bits = " · ".join(f"{side.resources[e]} {e}" for e in ELEMENTS
                      if side.resources.get(e))
    return f"{side.mana} mana ({bits})"


# --- image rendering -----------------------------------------------------
# The board as one PNG, for Discord (which can't render our HTML). Same layout as
# the web board so a puzzle looks like itself on both surfaces: opponent on top
# with their front row nearest the middle, you on the bottom with yours, your hand
# along the base. Pillow is imported lazily, so the engine and its tests run
# without it (matching draft.py).

_CARD_W = 176
_CARD_H = round(_CARD_W * 1000 / 720)
_HAND_W = 132
_HAND_H = round(_HAND_W * 1000 / 720)
_GAP = 12
_PAD = 22
_BG = (20, 22, 28)
_PANEL = (28, 31, 41)
_LINE = (47, 52, 69)
_TEXT = (231, 233, 240)
_MUTED = (154, 160, 180)
_ACCENT = (124, 137, 255)
_RED = (216, 60, 60)
_GREEN = (59, 165, 93)
_ATTACK = (216, 92, 60)
_BLOCK = (72, 140, 216)

_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _font(size, bold=True):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(_FONT_BOLD if bold else _FONT_REG, size)
    except OSError:
        return ImageFont.load_default()


def _text_w(draw, text, font):
    l, _t, r, _b = draw.textbbox((0, 0), text, font=font)
    return r - l


# Emoji and other pictographs, which DejaVu has no glyph for — Pillow draws them
# as blank boxes. Player names are user-supplied, so this is a real risk; the rest
# of the board is card names and numbers. Everything else DejaVu handles, INCLUDING
# the punctuation the status line is built from, so nothing else gets folded (an
# earlier ASCII-only fold turned every "·" separator into a "?").
_UNRENDERABLE_RE = re.compile(
    "[" "\U0001F000-\U0001FAFF" "\U00002600-\U000027BF"
    "\U0000FE00-\U0000FE0F" "\U0001F1E6-\U0001F1FF" "]")


def _safe(text):
    """Text Pillow can actually draw with DejaVu: composed, minus pictographs."""
    return _UNRENDERABLE_RE.sub("", unicodedata.normalize("NFC", text or "")).strip()


def _thumb(name, index, w, h):
    """A card's art at (w, h), or a labelled placeholder if it has no image."""
    from PIL import Image, ImageDraw
    path = index.art_path(name)
    if path:
        return Image.open(path).convert("RGB").resize((w, h))
    img = Image.new("RGB", (w, h), (45, 47, 52))
    d = ImageDraw.Draw(img)
    font = _font(13)
    y = 8
    for word in _safe(name).split():                # crude wrap; it's a fallback
        d.text((7, y), word, font=font, fill=(220, 220, 220))
        y += 16
    return img


def _pill(draw, x, y, text, *, bg, fg=(255, 255, 255), size=15, pad=6):
    """A small rounded label. Returns its width, so callers can lay pills in a row."""
    font = _font(size)
    w = _text_w(draw, text, font) + pad * 2
    h = size + 8
    draw.rounded_rectangle([x, y, x + w, y + h], radius=5, fill=bg)
    draw.text((x + pad, y + 3), text, font=font, fill=fg)
    return w


def _unit_tile(u, index, draw_on, x, y):
    """Paste one unit's art at (x, y) and overlay its state: effective stats, the
    damage it's marked with, its formation role, and anything under it."""
    from PIL import Image, ImageDraw
    name, card = u.resolved(index)
    canvas, draw = draw_on
    art = _thumb(name, index, _CARD_W, _CARD_H)
    canvas.paste(art, (x, y))

    # A modded unit is a stack; say so on the tile, since the mod is often the
    # whole point of the puzzle and the host's art doesn't show it.
    if u.mods:
        draw.rectangle([x, y, x + _CARD_W - 1, y + _CARD_H - 1],
                       outline=_ACCENT, width=3)

    # Stat strip along the bottom: what the unit actually is right now.
    st = u.stats(index)
    strip_h = 30
    if st:
        sy = y + _CARD_H - strip_h
        overlay = Image.new("RGBA", (_CARD_W, strip_h), (0, 0, 0, 205))
        canvas.paste(overlay, (x, sy), overlay)
        font = _font(18)
        buffed = u.power or u.toughness
        colour = _GREEN if (u.power > 0 or u.toughness > 0) else (
            _RED if buffed else _TEXT)
        draw.text((x + 7, sy + 5), f"{st[0]}/{st[1]}", font=font, fill=colour)
        if u.damage:
            label = f"{u.damage} dmg"
            f2 = _font(14)
            draw.text((x + _CARD_W - 7 - _text_w(draw, label, f2), sy + 8),
                      label, font=f2, fill=_RED)
    elif not card:
        pass                                     # placeholder already shows the name

    # Damage is also drawn as a red bar across the card, so "nearly dead" reads at
    # a glance — the number alone is easy to miss when you're counting a board.
    if st and u.damage:
        frac = min(1.0, u.damage / max(1, st[1]))
        bar_y = y + _CARD_H - strip_h - 6
        draw.rectangle([x, bar_y, x + _CARD_W - 1, bar_y + 5], fill=(60, 20, 20))
        draw.rectangle([x, bar_y, x + int((_CARD_W - 1) * frac), bar_y + 5], fill=_RED)

    # Role pill, top-left. Abbreviated to keep it off the card's printed name.
    if u.role:
        _pill(draw, x + 6, y + 6, ROLE_TAG[u.role], size=12,
              bg=_ATTACK if u.role == "attacking" else _BLOCK)
    # Mod count, top-right.
    if u.mods:
        label = f"+{len(u.mods)}"
        w = _text_w(draw, label, _font(15)) + 12
        _pill(draw, x + _CARD_W - 6 - w, y + 6, label, bg=_ACCENT)


def _side_block(side, index, draw_on, x0, y0, *, flip, depth):
    """Lay out one side's columns. `flip` puts the front row at the BOTTOM of the
    block — the opponent's side, whose front row faces you across the middle.

    `depth` is the deepest column on this side, i.e. how many rows tall the block
    is. A shallower column is pushed DOWN by the difference on the flipped side,
    so a lone unit stands in the front row rather than floating at the back.
    """
    _canvas, _draw = draw_on
    x = x0
    for col in side.columns:
        # A column is [front, back]. Ours reads top-down; theirs bottom-up.
        rows = list(col) if not flip else list(reversed(col))
        pad_top = (depth - len(rows)) if flip else 0
        for i, u in enumerate(rows):
            y = y0 + (i + pad_top) * (_CARD_H + _GAP)
            _unit_tile(u, index, draw_on, x, y)
        x += _CARD_W + _GAP
    return x


def _hand_row(names, index, draw_on, x0, y0, w):
    """A row of face-up cards (a hand or a bin), scaled down."""
    canvas, _draw = draw_on
    x = x0
    for name in names:
        card, matched, _ = index.lookup(name)
        canvas.paste(_thumb(matched if card else name, index, _HAND_W, _HAND_H),
                     (x, y0))
        x += _HAND_W + _GAP
        if x + _HAND_W > x0 + w:                 # one row is all a hand ever needs
            break
    return x


def _bar(draw, x, y, w, h, side, *, index, align_right=False):
    """A player's status bar: name, life, and their resources as element counts."""
    draw.rounded_rectangle([x, y, x + w, y + h], radius=9, fill=_PANEL,
                           outline=_LINE, width=1)
    name_f, life_f, res_f = _font(19), _font(24), _font(16)
    draw.text((x + 14, y + 8), _safe(side.name), font=name_f, fill=_MUTED)
    life = f"{side.life} life"
    draw.text((x + 14, y + 30), life, font=life_f, fill=_TEXT)

    # Resources on the right of the bar: "4 mana" and the per-element breakdown,
    # because affinity is what decides whether the card in hand is castable.
    label = f"{side.mana} mana" if side.resources else "no resources"
    lw = _text_w(draw, label, life_f)
    draw.text((x + w - 14 - lw, y + 8), label, font=life_f, fill=_ACCENT)
    bits = "  ".join(f"{side.resources[e]} {e}" for e in ELEMENTS
                     if side.resources.get(e))
    if bits:
        bw = _text_w(draw, bits, res_f)
        draw.text((x + w - 14 - bw, y + 38), bits, font=res_f, fill=_MUTED)


def render_board_image(p, index=CARDS):
    """The whole board as a PNG: opponent's formation, the middle line with the
    phase, your formation, then your hand. Bytes, ready to attach."""
    from PIL import Image, ImageDraw

    opp_cols = max(len(p.opponent.columns), 0)
    you_cols = max(len(p.you.columns), 0)
    board_cols = max(opp_cols, you_cols, 1)
    # Formation depth: a side with no two-deep column only needs one row of height.
    opp_rows = max((len(c) for c in p.opponent.columns), default=0)
    you_rows = max((len(c) for c in p.you.columns), default=0)

    hand = list(p.you.hand)
    bin_ = list(p.you.bin)
    hand_rows = (1 if hand else 0) + (1 if bin_ else 0)

    bar_h = 66
    mid_h = 44
    zone_label_h = 24

    inner_w = max(board_cols * _CARD_W + (board_cols - 1) * _GAP,
                  len(hand) * (_HAND_W + _GAP), len(bin_) * (_HAND_W + _GAP),
                  620)
    W = _PAD * 2 + inner_w
    H = (_PAD * 2 + bar_h + _GAP
         + (opp_rows * _CARD_H + max(0, opp_rows - 1) * _GAP if opp_rows else 40)
         + mid_h
         + (you_rows * _CARD_H + max(0, you_rows - 1) * _GAP if you_rows else 40)
         + _GAP + bar_h
         + (hand_rows * (zone_label_h + _HAND_H + _GAP) if hand_rows else 0))

    canvas = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(canvas)
    draw_on = (canvas, draw)

    y = _PAD
    _bar(draw, _PAD, y, inner_w, bar_h, p.opponent, index=index)
    y += bar_h + _GAP

    if opp_rows:
        _side_block(p.opponent, index, draw_on, _PAD, y, flip=True, depth=opp_rows)
        y += opp_rows * _CARD_H + (opp_rows - 1) * _GAP
    else:
        draw.text((_PAD + 4, y + 10), "no units in play", font=_font(16, bold=False),
                  fill=_MUTED)
        y += 40

    # The middle line: the border between the two halves of the region, labelled
    # with the phase — the single most load-bearing fact on the board.
    draw.line([(_PAD, y + mid_h // 2), (_PAD + inner_w, y + mid_h // 2)],
              fill=_LINE, width=2)
    label = _safe(status_line(p))
    font = _font(16)
    lw = _text_w(draw, label, font)
    draw.rectangle([_PAD + inner_w // 2 - lw // 2 - 12, y + mid_h // 2 - 13,
                    _PAD + inner_w // 2 + lw // 2 + 12, y + mid_h // 2 + 13],
                   fill=_BG)
    draw.text((_PAD + inner_w // 2 - lw // 2, y + mid_h // 2 - 9), label,
              font=font, fill=_ACCENT)
    y += mid_h

    if you_rows:
        _side_block(p.you, index, draw_on, _PAD, y, flip=False, depth=you_rows)
        y += you_rows * _CARD_H + (you_rows - 1) * _GAP
    else:
        draw.text((_PAD + 4, y + 10), "no units in play", font=_font(16, bold=False),
                  fill=_MUTED)
        y += 40

    y += _GAP
    _bar(draw, _PAD, y, inner_w, bar_h, p.you, index=index)
    y += bar_h

    for label, names in (("YOUR HAND", hand), ("YOUR BIN", bin_)):
        if not names:
            continue
        draw.text((_PAD, y + 6), label, font=_font(14), fill=_MUTED)
        y += zone_label_h
        _hand_row(names, index, draw_on, _PAD, y, inner_w)
        y += _HAND_H + _GAP

    import io
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()
