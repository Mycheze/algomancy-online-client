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

# Locations live in paths.py. NOTE: test_wtp.py monkeypatches wtp.PUZZLE_DIR to a
# tempdir, which works because every use below reads this module global at call
# time. Keep it a module-level name.
from paths import PUZZLE_DIR

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

# A token whose size is chosen when it's created ("Create a Robot 2"). Two cards
# spell that out in different ways, and the difference is REAL — not a wording
# quirk to paper over:
#
#   Generic Unit   printed X/X — the set's only genuinely vanilla body
#   Robot          printed 0/0, "I spawn with X +1/+1 counters on me.
#                  (If the number of counters changes, so does X.)"
#
# A Robot 3 is a 0/0 carrying three +1/+1 COUNTERS. It ends up a 3/3 either way,
# but the counters are a thing on the board that other cards can move, add to and
# remove — the card's own reminder text says X *is* the counter count. So a
# Robot's X becomes counters, and a Generic Unit's X becomes its printed body.
#
# Detected from the card data, not by name, so a new token that works either way
# is picked up for free.
_X_COUNTERS_RE = re.compile(r"spawns? with X \+1/\+1 counters", re.I)


def x_is_counters(card):
    """Is this token's X a pile of +1/+1 counters (a Robot) rather than its
    printed body (a Generic Unit)?"""
    if not card:
        return False
    return bool(_X_COUNTERS_RE.search(_cards.plain_text(card.get("text") or "")))


def needs_x(card):
    """Does this card's body depend on an X chosen at creation time?"""
    if not card:
        return False
    if str(card.get("power")).upper() == "X" or str(card.get("toughness")).upper() == "X":
        return True
    return x_is_counters(card)


@dataclass
class Unit:
    """A unit in play: a card, plus everything that's happened to it.

    The two ways a unit's stats can change are DIFFERENT THINGS, and the manual
    is explicit about it ("Stat Changes and Counters"):

      `counters`  permanent. A signed count of +1/+1 counters — negative means
                  -1/-1 counters. One field, not two, because that IS the rule:
                  "if both a +1/+1 counter and a -1/-1 counter are placed on a
                  unit, the two cancel out and will both be removed." So a unit
                  can never be holding some of each; the net is all there is.
                  Tracked with dice at the table, so we draw it as a die.

      `power`/`toughness`  temporary. Everything that ISN'T counters: a buff that
                  lasts until regroup, a static ability granting +2/+0 while its
                  source is in play, a Virus's -7/-7. "If a card doesn't
                  specifically say 'place counters' when mentioning stat changes,
                  its stat changes are temporary."

    Both are MODIFIERS on the printed stats rather than replacements, so the
    printed card stays the source of truth. The distinction matters to a solver:
    a puzzle can turn on whether a unit is still a 4/4 next turn.

    `x` is for tokens made at a chosen size (a Robot 2, a Generic Unit 3) — see
    needs_x(). Tokens are the cleanest bodies in the game for a combat-math
    puzzle, because they're the only ones with no ability text muddying the sum.
    """
    card: str                                   # card name (fuzzy-matched on load)
    power: int = 0                              # TEMPORARY stat change, may be negative
    toughness: int = 0
    counters: int = 0                           # PERMANENT: +n = +1/+1, -n = -1/-1
    damage: int = 0                             # damage marked this battle
    role: str = ""                              # "" | attacking | blocking
    mods: list = field(default_factory=list)    # cards grafted/augmented UNDER it
    note: str = ""                              # anything else ("shared Flying")
    x: int = 0                                  # a token's X ("Create a Robot 2")

    def resolved(self, index=CARDS):
        """(canonical_name, card) for this unit, or (name, None) if no such card.

        Unknown names are kept rather than rejected: a designer may want a token
        or a hypothetical the set doesn't have, and a puzzle is worth more than
        a strict schema. Renderers show the name in a placeholder.
        """
        card, matched, _ = index.lookup(self.card)
        return (matched, card) if card else (self.card, None)

    def base_stats(self, index=CARDS):
        """The body this unit starts from, before any modifiers — or None for a
        card that has no body at all (a resource, a spell token)."""
        _name, card = self.resolved(index)
        if not card:
            return None
        if str(card.get("power")).upper() == "X" or str(card.get("toughness")).upper() == "X":
            return self.x, self.x                # a Generic Unit's X is its body
        try:
            # A Robot's X is NOT its body — it's printed 0/0 and the X arrives as
            # counters (see counter_count).
            return int(card.get("power")), int(card.get("toughness"))
        except (TypeError, ValueError):
            return None                          # not a unit: nothing to add to

    def counter_count(self, index=CARDS):
        """How many +1/+1 counters are on this unit (negative = -1/-1 counters),
        including the ones a Robot was created with."""
        _name, card = self.resolved(index)
        return self.counters + (self.x if x_is_counters(card) else 0)

    def stats(self, index=CARDS):
        """Effective (power, toughness) — the body, plus the counters on it, plus
        whatever temporary buff it's under."""
        base = self.base_stats(index)
        if base is None:
            return None
        n = self.counter_count(index)
        return base[0] + n + self.power, base[1] + n + self.toughness

    def dead(self, index=CARDS):
        """Is this unit already lethally damaged? A board can't legally be in this
        state, so it's a validation warning, not a rendering mode."""
        st = self.stats(index)
        return bool(st) and self.damage >= st[1]


# --- resources -----------------------------------------------------------
# Resources are CARDS on the table, not a number on a scoresheet, and they carry
# a state that decides what they're currently worth (Manual, "The Planning Phase";
# Glossary, "Resources"):
#
#   dormant    face down. Provides NO affinity and NO mana. Everything spawns
#              this way; you may activate two a turn, flipping them face up.
#   open       face up, un-expended. Affinity AND 1 mana.
#   expended   spent for mana this turn. "Expended resources still count towards
#              threshold requirements, but cannot be expended for mana again."
#              They refresh at the start of a turn. The game's own convention for
#              showing this is TAPPING the card, so that's how we draw it.
#
# So: mana = the open ones; affinity = every one that isn't dormant. A puzzle that
# collapsed this to a single number couldn't ask "you've already spent three —
# can you still cast it?", which is most of what makes a play tight.
RESOURCE_STATES = ("open", "expended", "dormant")

# Shards and Prismites are resources that can be expended for mana like any other
# but "add no affinity" — so they're kinds, not elements.
RESOURCE_KINDS = ELEMENTS + ("shard", "prismite")
RESOURCE_CARD = {
    **{e: f"{e.title()} Resource" for e in ELEMENTS},
    "shard": "Shard Resource",
    "prismite": "Prismite",
}
# The face-down back — the actual card the game puts on the table for a dormant
# resource, and for a card in an opponent's hand.
CARDBACK = "Cardback"


@dataclass
class Resource:
    kind: str                          # an element, or shard / prismite
    state: str = "open"                # open | expended | dormant

    @property
    def card(self):
        return RESOURCE_CARD.get(self.kind, self.kind)

    @property
    def mana(self):
        return 1 if self.state == "open" else 0

    def gives_affinity(self, element):
        # Dormant gives nothing; shards and prismites never give affinity, however
        # face-up they are.
        return self.kind == element and self.state != "dormant" and element in ELEMENTS


@dataclass
class Side:
    """One player's half of the region."""
    name: str = "You"
    life: int = 30
    resources: list = field(default_factory=list)  # [Resource] — cards in play
    columns: list = field(default_factory=list)    # [[Unit, ...], ...] — max 2 deep
    hand: list = field(default_factory=list)       # card names (yours: shown)
    bin: list = field(default_factory=list)        # card names (graft/augment fodder)
    hand_count: int = 0                            # opponent's unseen cards

    @property
    def mana(self):
        """Mana available right now — the un-expended, face-up resources."""
        return sum(r.mana for r in self.resources)

    @property
    def units(self):
        return [u for col in self.columns for u in col]

    def affinity(self, element):
        """Affinity towards an element. Expended resources still count; dormant
        ones don't; shards and prismites never do."""
        return sum(1 for r in self.resources if r.gives_affinity(element))

    def resource_counts(self):
        """kind -> how many of that resource are on the table, whatever state."""
        counts = {}
        for r in self.resources:
            counts[r.kind] = counts.get(r.kind, 0) + 1
        return counts


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
        counters=_int(d.get("counters")),        # signed: -n means n × -1/-1
        damage=max(0, _int(d.get("damage"))), role=role,
        mods=mod_names, note=(d.get("note") or "").strip(),
        x=max(0, _int(d.get("x"))))


def _unit_to_json(u):
    d = {"card": u.card}
    for key in ("power", "toughness", "counters", "damage", "x"):
        if getattr(u, key):
            d[key] = getattr(u, key)
    if u.role:
        d["role"] = u.role
    if u.mods:
        d["mods"] = list(u.mods)
    if u.note:
        d["note"] = u.note
    return d


MAX_RESOURCES = 20


def _resource_from_json(r):
    """A resource from `"earth"`, `"earth:expended"`, or `{kind, state}`.

    The terse string form is what gets written, because a resource row is mostly
    "four earths and a shard" and a puzzle file should read like that rather than
    like a database dump.
    """
    if isinstance(r, str):
        kind, _, state = r.partition(":")
        r = {"kind": kind, "state": state or "open"}
    if not isinstance(r, dict):
        raise PuzzleError(f"“{r}” isn't a resource.")
    kind = str(r.get("kind") or "").strip().lower()
    state = (str(r.get("state") or "open")).strip().lower()
    if kind not in RESOURCE_KINDS:
        raise PuzzleError(f"“{kind}” isn't a resource — use an element, "
                          f"shard, or prismite.")
    if state not in RESOURCE_STATES:
        raise PuzzleError(f"“{state}” isn't a resource state — use "
                          f"{', '.join(RESOURCE_STATES)}.")
    return Resource(kind=kind, state=state)


def _resources_from_json(raw):
    """Resources from a list — or from the old `{"earth": 3}` shorthand, which is
    still the quickest way to say "three earths, all open" by hand."""
    if not raw:
        return []
    if isinstance(raw, dict):
        out = []
        for kind, n in raw.items():
            kind = str(kind).strip().lower()
            if kind not in RESOURCE_KINDS:
                raise PuzzleError(f"“{kind}” isn't a resource.")
            out += [Resource(kind=kind) for _ in range(max(0, _int(n)))]
    else:
        out = [_resource_from_json(r) for r in raw]
    if len(out) > MAX_RESOURCES:
        raise PuzzleError(f"That's more than {MAX_RESOURCES} resources on one side.")
    # Grouped by kind in game order so a row reads left-to-right the way the
    # elements always do, and two identical boards produce identical files.
    return sorted(out, key=lambda r: RESOURCE_KINDS.index(r.kind))


def _resource_to_json(r):
    return r.kind if r.state == "open" else f"{r.kind}:{r.state}"


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

    hand = [str(c).strip() for c in (d.get("hand") or []) if str(c).strip()]
    bin_ = [str(c).strip() for c in (d.get("bin") or []) if str(c).strip()]
    if len(hand) > MAX_HAND or len(bin_) > MAX_HAND:
        raise PuzzleError(f"Keep the hand and bin to {MAX_HAND} cards each.")

    return Side(
        name=(d.get("name") or default_name).strip() or default_name,
        life=_int(d.get("life"), 30),
        resources=_resources_from_json(d.get("resources")),
        columns=columns,
        hand=hand, bin=bin_, hand_count=max(0, _int(d.get("hand_count"))))


def _side_to_json(s):
    d = {"name": s.name, "life": s.life}
    if s.resources:
        d["resources"] = [_resource_to_json(r) for r in s.resources]
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
                # A token with no X is a 0/0 — almost always a forgotten field
                # rather than something anyone meant to put on a board.
                if needs_x(card) and not u.x:
                    how = ("give it some +1/+1 counters"
                           if x_is_counters(card) else "give it an X")
                    warnings.append(
                        f"{who}: “{name}” is a token made at a chosen size — {how} "
                        f"(a Robot 2 is a 2/2). At zero it's a 0/0.")
                if u.stats(index) is None and (u.power or u.toughness
                                               or u.counters or u.damage):
                    warnings.append(
                        f"{who}: “{name}” has no printed stats, so its "
                        f"counters/buffs/damage won't show.")
                st = u.stats(index)
                if st and st[1] <= 0:
                    # "A unit with 0 or less defense will immediately die."
                    warnings.append(
                        f"{who}: “{name}” is a {st[0]}/{st[1]} — a unit with 0 or "
                        f"less toughness dies immediately, so it can't be on the board.")
                elif u.dead(index):
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
    base = u.base_stats(index)
    combo = None
    if u.mods:
        # What the stack actually reads as, so a modified unit shows its real
        # ability on the board instead of just the host's — and its real type
        # line, since an augment can grant attributes ({Piercing}) rather than
        # text, and the type line is the only place those show up.
        try:
            combo = mods.build(" + ".join([name] + list(u.mods)), index)
        except mods.ComboError:
            combo = None
    return {
        "card": name,
        "known": card is not None,
        "art_url": art_url(name) if card else None,
        "power": st[0] if st else None,
        "toughness": st[1] if st else None,
        # The printed body, before the counters on it and before any buff — so a
        # unit that's been changed reads "5/5 (3/3)" and you can see both numbers.
        "base": f"{base[0]}/{base[1]}" if base else None,
        # Counters and buffs are kept apart all the way to the renderer, because
        # they aren't the same fact: counters are permanent, a buff wears off.
        #
        # `counters` is what's actually ON the unit — a Robot's X included, since
        # that X *is* a pile of +1/+1 counters. `counters_own` is only the field
        # the designer set, which is what the editor has to read back: load the
        # total into that field and a Robot 3 would come back as a 6/6.
        "counters": u.counter_count(index),
        "counters_own": u.counters,
        "buff_p": u.power, "buff_t": u.toughness,
        "damage": u.damage,
        "role": u.role,
        "x": u.x,
        "token": needs_x(card),
        "mods": list(u.mods),
        "text": combo.text if combo else ((card or {}).get("text") or ""),
        "type": combo.type if combo else (card or {}).get("type", ""),
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


def _resource_payload(r, index, art_url):
    return {
        "kind": r.kind,
        "state": r.state,
        "card": r.card,
        # A dormant resource is face DOWN on the table, so that's what it looks
        # like. The element is still on the payload, because the person building
        # the puzzle has to know which one it is.
        "art_url": art_url(CARDBACK if r.state == "dormant" else r.card),
        "mana": r.mana,
    }


def _side_payload(s, index, art_url):
    return {
        "name": s.name,
        "life": s.life,
        "mana": s.mana,
        "resources": [_resource_payload(r, index, art_url) for r in s.resources],
        "affinity": {e: s.affinity(e) for e in ELEMENTS if s.affinity(e)},
        "resource_counts": s.resource_counts(),
        "columns": [[_unit_payload(u, index, art_url) for u in col]
                    for col in s.columns],
        "hand": [_card_payload(c, index, art_url) for c in s.hand],
        "bin": [_card_payload(c, index, art_url) for c in s.bin],
        "hand_count": s.hand_count,
        "cardback_url": art_url(CARDBACK),
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
    """'4 mana open · 2 earth, 1 water (1 expended)' — in words. Callers that have
    icons (both front-ends do) swap the element words for pictures themselves."""
    if not side.resources:
        return "no resources"
    counts = side.resource_counts()
    bits = ", ".join(f"{counts[k]} {k}" for k in RESOURCE_KINDS if counts.get(k))
    spent = sum(1 for r in side.resources if r.state == "expended")
    dormant = sum(1 for r in side.resources if r.state == "dormant")
    extra = [f"{n} {label}" for n, label in
             ((spent, "expended"), (dormant, "dormant")) if n]
    tail = f" ({', '.join(extra)})" if extra else ""
    return f"{side.mana} mana open · {bits}{tail}"


# --- image rendering -----------------------------------------------------
# The board as one PNG, for Discord (which can't render our HTML). Same layout as
# the web board so a puzzle looks like itself on both surfaces: opponent on top
# with their front row nearest the middle, you on the bottom with yours, your hand
# along the base. Pillow is imported lazily, so the engine and its tests run
# without it (matching draft.py).

_CARD_W = 176
_CARD_H = round(_CARD_W * 1000 / 720)
# The stat strip lives BELOW the art, not across the bottom of it — the bottom of
# a card is its rules text, and the rules text is usually the puzzle. So a unit's
# tile is taller than its card.
_STRIP_H = 34
_TILE_H = _CARD_H + _STRIP_H
# The card's printed title bar (cost, name, power/toughness) as a fraction of its
# height. Badges start below it so they never cover the numbers you're adding up.
_TITLE_H = round(_CARD_H * 0.155)
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


_DIE = 30                                        # counter die, px


def _die(draw, x, y, n):
    """The +1/+1 (or -1/-1) counters on a unit, drawn as the die you'd sit on it
    at the table — green for +, red for -. `n` is signed and never zero here; the
    sign is shown, because a bare "3" doesn't say which kind of counter it is.
    Returns its height, so callers can stack under it."""
    up = n > 0
    draw.rounded_rectangle([x, y, x + _DIE, y + _DIE], radius=6,
                           fill=_GREEN if up else _RED,
                           outline=(255, 255, 255), width=2)
    label = f"+{n}" if up else str(n)            # str(-2) already carries its sign
    font = _font(16)
    draw.text((x + (_DIE - _text_w(draw, label, font)) // 2, y + 5),
              label, font=font, fill=(255, 255, 255))
    return _DIE


def _unit_tile(u, index, draw_on, x, y):
    """Draw one unit at (x, y): its art, then a strip UNDER the art carrying the
    state we've added (effective stats, damage), plus the badges that have to sit
    on the card itself (its role, the counters on it, the cards under it).

    Nothing we add is allowed to cover anything the card printed. The stat strip
    goes below the art rather than across the bottom of it, because that's where
    the rules text lives — and a puzzle usually turns on the rules text. The
    badges start below the card's title bar, which is where the printed cost, name
    and power/toughness are.
    """
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

    # The strip, below the art. Its own dark panel, not an overlay.
    st = u.stats(index)
    if st:
        sy = y + _CARD_H
        draw.rectangle([x, sy, x + _CARD_W - 1, sy + _STRIP_H - 1], fill=(12, 14, 20))

        # Damage as a bar across the top of the strip as well as a number, so
        # "nearly dead" reads at a glance when you're counting a whole board.
        if u.damage:
            frac = min(1.0, u.damage / max(1, st[1]))
            draw.rectangle([x, sy, x + _CARD_W - 1, sy + 4], fill=(60, 20, 20))
            draw.rectangle([x, sy, x + int((_CARD_W - 1) * frac), sy + 4], fill=_RED)

        font = _font(18)
        # Colour the stats if this unit ISN'T what its art says — from counters or
        # from a temporary buff, either way the printed number is now a lie.
        n = u.counter_count(index)
        up, down = (u.power > 0 or u.toughness > 0 or n > 0), (
            u.power < 0 or u.toughness < 0 or n < 0)
        colour = _GREEN if up and not down else _RED if down and not up else (
            _ACCENT if up else _TEXT)     # pulled both ways: just say "not printed"
        draw.text((x + 7, sy + 8), f"{st[0]}/{st[1]}", font=font, fill=colour)
        if u.damage:
            label = f"{u.damage} dmg"
            f2 = _font(14)
            draw.text((x + _CARD_W - 7 - _text_w(draw, label, f2), sy + 11),
                      label, font=f2, fill=_RED)

    # Badges start below the card's printed title bar — the cost, the name and the
    # printed power/toughness all live up there, and covering the stats we're
    # asking you to add up would be a particularly silly thing to do.
    top = y + _TITLE_H
    if u.role:
        _pill(draw, x + 7, top, ROLE_TAG[u.role], size=12,
              bg=_ATTACK if u.role == "attacking" else _BLOCK)

    # Counters, drawn as the die you'd actually put on the unit, with the mod pill
    # stacked under it — a counter sits ON the unit, a mod sits UNDER it.
    n = u.counter_count(index)
    if n:
        top += _die(draw, x + _CARD_W - 7 - _DIE, top, n) + 4
    if u.mods:
        label = f"+{len(u.mods)}"
        w = _text_w(draw, label, _font(15)) + 12
        _pill(draw, x + _CARD_W - 7 - w, top, label, bg=_ACCENT)


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
            y = y0 + (i + pad_top) * (_TILE_H + _GAP)
            _unit_tile(u, index, draw_on, x, y)
        x += _CARD_W + _GAP
    return x


def _hand_row(names, index, draw_on, x0, y0, w):
    """A row of face-up cards (a hand), scaled down."""
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


def _backs_row(n, index, draw_on, x0, y0, w):
    """Face-down cards — an opponent's hand. The card's own back, not a rectangle."""
    canvas, _draw = draw_on
    x = x0
    for _ in range(n):
        canvas.paste(_thumb(CARDBACK, index, _HAND_W, _HAND_H), (x, y0))
        x += _HAND_W // 2 + 6                    # overlapped, the way a hand is held
        if x + _HAND_W > x0 + w:
            break
    return x


def _resource_row(side, index, draw_on, x0, y0):
    """A player's resources as the cards they are.

    An expended resource is drawn TAPPED (rotated) — that's the game's own way of
    showing it's been spent (Glossary, "Resources"). A dormant one is drawn face
    down, because that is literally what it is on the table.
    """
    from PIL import Image
    canvas, draw = draw_on
    x = x0
    for r in side.resources:
        name = CARDBACK if r.state == "dormant" else r.card
        img = _thumb(name, index, _HAND_W, _HAND_H)
        if r.state == "expended":
            img = img.rotate(90, expand=True)     # tapped
            canvas.paste(img, (x, y0 + (_HAND_H - _HAND_W) // 2))
            x += _HAND_H + _GAP
        else:
            if r.state == "dormant":
                img = Image.eval(img, lambda v: v * 2 // 3)
            canvas.paste(img, (x, y0))
            x += _HAND_W + _GAP
    return x


def _resource_row_w(side):
    """How wide that row will be — needed before the canvas exists."""
    if not side.resources:
        return 0
    return sum((_HAND_H if r.state == "expended" else _HAND_W) + _GAP
               for r in side.resources) - _GAP


def _bar(draw, x, y, w, h, side):
    """A player's status bar: name, life, and what their resources add up to. The
    numbers stay even though the cards are on the board now — you shouldn't have
    to count a row of art to find out how much mana is open."""
    draw.rounded_rectangle([x, y, x + w, y + h], radius=9, fill=_PANEL,
                           outline=_LINE, width=1)
    name_f, life_f, res_f = _font(19), _font(24), _font(16)
    draw.text((x + 14, y + 8), _safe(side.name), font=name_f, fill=_MUTED)
    draw.text((x + 14, y + 30), f"{side.life} life", font=life_f, fill=_TEXT)

    label = f"{side.mana} mana" if side.resources else "no resources"
    lw = _text_w(draw, label, life_f)
    draw.text((x + w - 14 - lw, y + 8), label, font=life_f, fill=_ACCENT)
    # Affinity, not just a resource count: it's what decides whether the card in
    # hand is castable at all, and expended resources still provide it.
    bits = "  ".join(f"{side.affinity(e)} {e}" for e in ELEMENTS if side.affinity(e))
    if bits:
        bw = _text_w(draw, bits, res_f)
        draw.text((x + w - 14 - bw, y + 38), _safe(bits), font=res_f, fill=_MUTED)


def _rail(names, index, draw_on, x0, y0, label):
    """A bin, stacked down the side of the table the way a discard pile sits."""
    canvas, draw = draw_on
    draw.text((x0, y0), label, font=_font(12), fill=_MUTED)
    y = y0 + 18
    for name in names[:6]:
        card, matched, _ = index.lookup(name)
        canvas.paste(_thumb(matched if card else name, index, _HAND_W, _HAND_H),
                     (x0, y))
        y += _HAND_H + 6
    return y


def render_board_image(p, index=CARDS):
    """The whole board as a PNG, laid out like the table it is.

        opponent's hand (face down)                │
        opponent: life, mana                       │  their bin
        opponent's resources (tapped = expended)   │
        opponent's formation                       │
        ─────────── the phase ───────────          │
        your formation                             │
        your resources                             │
        you: life, mana                            │  your bin
        your hand (face up)                        │

    Bytes, ready to attach.
    """
    from PIL import Image, ImageDraw

    board_cols = max(len(p.opponent.columns), len(p.you.columns), 1)
    # Formation depth: a side with no two-deep column only needs one row of height.
    opp_rows = max((len(c) for c in p.opponent.columns), default=0)
    you_rows = max((len(c) for c in p.you.columns), default=0)

    bar_h, mid_h, label_h = 66, 44, 22
    zone = lambda on: (label_h + _HAND_H + _GAP) if on else 0

    inner_w = max(board_cols * _CARD_W + (board_cols - 1) * _GAP,
                  len(p.you.hand) * (_HAND_W + _GAP),
                  _resource_row_w(p.you), _resource_row_w(p.opponent),
                  620)
    rail_on = bool(p.you.bin or p.opponent.bin)
    rail_w = (_HAND_W + _PAD) if rail_on else 0

    H = (_PAD * 2
         + zone(p.opponent.hand or p.opponent.hand_count)
         + bar_h + _GAP
         + zone(p.opponent.resources)
         + (opp_rows * _TILE_H + max(0, opp_rows - 1) * _GAP if opp_rows else 40)
         + mid_h
         + (you_rows * _TILE_H + max(0, you_rows - 1) * _GAP if you_rows else 40)
         + zone(p.you.resources)
         + _GAP + bar_h
         + zone(p.you.hand))
    # The rail must not be taller than the table it sits beside.
    H = max(H, _PAD * 2 + 2 * (18 + min(3, max(len(p.you.bin), len(p.opponent.bin)))
                               * (_HAND_H + 6)))

    W = _PAD * 2 + inner_w + rail_w
    canvas = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(canvas)
    draw_on = (canvas, draw)

    def band(label, y):
        draw.text((_PAD, y + 4), label, font=_font(12), fill=_MUTED)
        return y + label_h

    y = _PAD

    # --- their side, from the far edge of the table inwards ---
    if p.opponent.hand or p.opponent.hand_count:
        y = band(f"{_safe(p.opponent.name).upper()}'S HAND", y)
        x = _hand_row(p.opponent.hand, index, draw_on, _PAD, y, inner_w)
        _backs_row(p.opponent.hand_count, index, draw_on, x, y, _PAD + inner_w - x)
        y += _HAND_H + _GAP

    _bar(draw, _PAD, y, inner_w, bar_h, p.opponent)
    y += bar_h + _GAP

    if p.opponent.resources:
        y = band("RESOURCES", y)
        _resource_row(p.opponent, index, draw_on, _PAD, y)
        y += _HAND_H + _GAP

    if opp_rows:
        _side_block(p.opponent, index, draw_on, _PAD, y, flip=True, depth=opp_rows)
        y += opp_rows * _TILE_H + (opp_rows - 1) * _GAP
    else:
        draw.text((_PAD + 4, y + 10), "no units in play",
                  font=_font(16, bold=False), fill=_MUTED)
        y += 40

    # --- the middle line: the border between the halves, carrying the phase ---
    draw.line([(_PAD, y + mid_h // 2), (_PAD + inner_w, y + mid_h // 2)],
              fill=_LINE, width=2)
    label = _safe(status_line(p))
    font = _font(16)
    lw = _text_w(draw, label, font)
    cx = _PAD + inner_w // 2
    draw.rectangle([cx - lw // 2 - 12, y + mid_h // 2 - 13,
                    cx + lw // 2 + 12, y + mid_h // 2 + 13], fill=_BG)
    draw.text((cx - lw // 2, y + mid_h // 2 - 9), label, font=font, fill=_ACCENT)
    y += mid_h

    # --- your side, from the middle back towards you ---
    if you_rows:
        _side_block(p.you, index, draw_on, _PAD, y, flip=False, depth=you_rows)
        y += you_rows * _TILE_H + (you_rows - 1) * _GAP
    else:
        draw.text((_PAD + 4, y + 10), "no units in play",
                  font=_font(16, bold=False), fill=_MUTED)
        y += 40

    if p.you.resources:
        y = band("RESOURCES", y)
        _resource_row(p.you, index, draw_on, _PAD, y)
        y += _HAND_H + _GAP

    y += _GAP
    _bar(draw, _PAD, y, inner_w, bar_h, p.you)
    y += bar_h

    if p.you.hand:
        y = band("YOUR HAND", y)
        _hand_row(p.you.hand, index, draw_on, _PAD, y, inner_w)
        y += _HAND_H + _GAP

    # --- the bins, off to the side, the way they sit on a table ---
    if rail_on:
        rx = _PAD + inner_w + _PAD - 4
        if p.opponent.bin:
            _rail(p.opponent.bin, index, draw_on, rx, _PAD,
                  f"{_safe(p.opponent.name).upper()}'S BIN")
        if p.you.bin:
            depth = 18 + min(len(p.you.bin), 6) * (_HAND_H + 6)
            _rail(p.you.bin, index, draw_on, rx, max(_PAD, H - _PAD - depth),
                  "YOUR BIN")

    import io
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()
