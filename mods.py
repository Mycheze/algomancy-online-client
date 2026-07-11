"""mods.py — grafted and augmented card combinations for `&card A + B`.

Algomancy lets you stack a card from your discard under a unit in play and read
the two textboxes as one card. This module models that: given `A + B` it decides
whether the combination is legal, which of the two modification rules applies,
what the resulting card *reads* as, and stacks the art so B peeks out under A.

The two rules (Manual, "Modifications"; Glossary, "Augment" / "Graft"):

  Augment (+)     Pay B's cost, put B under any unit A. A is then treated as if
                  it had all the text in B's (+) paragraph. Only that paragraph
                  transfers — a card's non-augment text stays behind.

  Graft (switch)  Pay B's cost, put B under A. Both cards must carry the graft
                  symbol. Graft abilities are templated "Cause -> Effect", and
                  grafting adds B's *effect* onto A's cause; the result reads
                  "Cause -> effect1 AND effect2". So B contributes only the text
                  after its symbol — B's own cause is dropped, because A's is the
                  one that fires.

Both icons are kept in the combined text rather than being flattened into "and":
the symbol is what tells you whether each effect is bounded (once per turn) or
unbounded, and a bounded effect stays bounded after it's grafted on.

No card carries both symbols, so the second card alone determines which rule is
in play; `&card A + B` needs no extra syntax to say which one you meant.
"""
import io
import json
import re
from pathlib import Path

from cards import CARDS_DIR, plain_text

ANCHORS_JSON = CARDS_DIR / "mod_anchors.json"

# A real [Augment] ability starts a line. Reconfigure's only [Augment] sits
# mid-line inside reminder text ("(The first target must have [Augment] to be
# able to be augmented.)") — that's a rules reference, not an ability it grants,
# and treating it as one would let people "augment" with a card that has no
# augment paragraph at all.
AUGMENT_RE = re.compile(r"(?:^|\{/n\})\s*\[Augment\]")
SWITCH_RE = re.compile(r"\[Switch1?\]")

# A word broken across a printed line ("non- {/n}token"). The card data carries
# the card's *layout*, so its line breaks fall mid-word; the combined text is a
# fresh rendering, not a reproduction of either card's textbox, so it reflows.
# Guarded to letter-hyphen-letter, which leaves "-1/-1" and "+1/+1" alone.
SOFT_WRAP_RE = re.compile(r"([A-Za-z])-\s*\n\s*([A-Za-z])")

CARD_W, CARD_H = 720, 1000
# Used when a card has no anchor (no art, or the match wasn't confident): about
# one text line, which is what most single-ability cards need anyway.
FALLBACK_PEEK = 110
MAX_MODS = 4


def _anchors():
    if _anchors.cache is None:
        try:
            _anchors.cache = json.loads(Path(ANCHORS_JSON).read_text())
        except FileNotFoundError:      # not built yet — fall back to a fixed peek
            _anchors.cache = {}
    return _anchors.cache


_anchors.cache = None


# --- what a card can do ---------------------------------------------------

def is_unit(card):
    """Graft and augment both target units. 'Spell Unit' cards are units."""
    return "Unit" in (card.get("type") or "").split()


def augment_ability(card):
    """The card's (+) paragraph — the text an augment transfers — or None."""
    text = card.get("text") or ""
    m = AUGMENT_RE.search(text)
    if not m:
        return None
    return text[text.index("[Augment]", m.start()):]


def graft_effect(card):
    """The text after the card's graft symbol — the effect a graft transfers.

    Everything before the symbol is the card's own cause ("When I am dealt
    damage,"), which is exactly the part grafting throws away: the host's cause
    is what fires the combined ability.
    """
    text = card.get("text") or ""
    m = SWITCH_RE.search(text)
    return text[m.start():] if m else None


def has_graft_symbol(card):
    return bool(SWITCH_RE.search(card.get("text") or ""))


def mod_kind(card):
    """How this card behaves when placed *under* another one, or None."""
    if augment_ability(card):
        return "augment"
    if has_graft_symbol(card):
        return "graft"
    return None


def is_bounded(card):
    """A bounded graft ([Switch1]) triggers at most once per turn."""
    return "[Switch1]" in (card.get("text") or "")


# --- the combined rules text ----------------------------------------------

def flow(text):
    """Card text reflowed into prose: formatting codes resolved, printed line
    breaks undone (including words hyphenated across a line), tokens kept."""
    if not text:
        return ""
    t = plain_text(text)                 # {/n} -> \n, drops {i}/{g} markers
    t = SOFT_WRAP_RE.sub(r"\1\2", t)     # "non-\ntoken" -> "nontoken"
    t = re.sub(r"\s*\n\s*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def card_paragraphs(card):
    """A card's text as real paragraphs.

    {/n} is a line-wrap, not a paragraph mark — it splits words in half. The one
    boundary that *is* structural is where an [Augment] ability begins, so that's
    the only place we break.
    """
    text = card.get("text") or ""
    m = AUGMENT_RE.search(text)
    if m and m.start() > 0:
        return [flow(text[:m.start()]), flow(text[m.start():])]
    return [flow(text)]


def combined_text(host, mods):
    """The rules text of the modified card.

    Graft effects join the host's ability, because they share its cause and
    resolve as one ability. Augments are independent paragraphs, so they get
    their own lines.
    """
    lines = card_paragraphs(host)
    grafted = [flow(graft_effect(c)) for _, c, k in mods if k == "graft"]
    if grafted:
        lines[0] = " ".join([lines[0]] + grafted).strip()
    lines += [flow(augment_ability(c)) for _, c, k in mods if k == "augment"]
    return "\n".join(ln for ln in lines if ln)


# --- parsing and legality --------------------------------------------------

class ComboError(Exception):
    """A combination that the rules don't allow, phrased for the player."""


class Combo:
    def __init__(self, host_name, host, mods, swapped=False):
        self.host_name = host_name
        self.host = host
        self.mods = mods                     # [(name, card, kind)]
        self.swapped = swapped
        self.text = combined_text(host, mods)

    @property
    def names(self):
        return [self.host_name] + [n for n, _, _ in self.mods]

    @property
    def title(self):
        return " + ".join(self.names)

    @property
    def kinds(self):
        return {k for _, _, k in self.mods}

    def describe(self, bold=lambda s: s):
        """One line naming what was done, so nobody reads the image as just the
        top card. `bold` styles the card names for the caller's front-end (Discord
        markdown, HTML, or plain by default)."""
        bits = []
        for name, card, kind in self.mods:
            if kind == "graft":
                word = "bounded graft" if is_bounded(card) else "graft"
                bits.append(f"{bold(name)} grafted onto {bold(self.host_name)} ({word})")
            else:
                bits.append(f"{bold(name)} augmenting {bold(self.host_name)}")
        return " · ".join(bits)


def split_query(query):
    """`A + B` -> ['A', 'B']. No card name contains '+', so it's a safe split."""
    return [p.strip() for p in query.split("+") if p.strip()]


def _check_host(host_name, host, mods):
    """Raise if `host` can't legally carry `mods`. Returns nothing."""
    if not is_unit(host):
        type_line = flow(host.get("type") or "").strip() or "card"
        raise ComboError(
            f"**{host_name}** is a {type_line}, not a unit — graft and augment "
            f"both go onto a unit in play.")
    if any(k == "graft" for _, _, k in mods) and not has_graft_symbol(host):
        raise ComboError(
            f"**{host_name}** has no graft symbol, so nothing can be grafted onto "
            f"it. Grafting needs the symbol on *both* cards.")


def build(query, index):
    """Parse `A + B [+ C…]` into a Combo. Raises ComboError with a readable
    reason if the cards don't exist or the combination isn't legal."""
    parts = split_query(query)
    if len(parts) < 2:
        raise ComboError("Give me two cards to combine, like "
                         "`&card General Smof + Spectrogenesis`.")
    if len(parts) - 1 > MAX_MODS:
        raise ComboError(f"That's {len(parts) - 1} modifications — I'll stack up "
                         f"to {MAX_MODS}.")

    resolved = []
    for part in parts:
        card, matched, _ = index.lookup(part)
        if not card:
            raise ComboError(f"No card found matching **{part}**.")
        resolved.append((matched, card))

    mods = []
    for name, card in resolved[1:]:
        kind = mod_kind(card)
        if not kind:
            raise ComboError(
                f"**{name}** has no augment (+) or graft symbol, so it can't be "
                f"put under another card.")
        mods.append((name, card, kind))

    host_name, host = resolved[0]
    try:
        _check_host(host_name, host, mods)
    except ComboError as illegal:
        # People name the cards in either order. If the pair only works the other
        # way round, do that instead of bouncing them — but say so, because which
        # card is on top changes what the stack means.
        swapped = _swap(resolved)
        if swapped:
            return swapped
        # The swap didn't work either. Report why the order they *asked for*
        # failed; the swapped attempt failed for its own unrelated reason, and
        # saying "Spectrogenesis is not a unit" to someone who never claimed it
        # was the host just sends them looking for the wrong mistake.
        raise illegal

    return Combo(host_name, host, mods)


def _swap(resolved):
    """The same two cards the other way up, if that's legal. None if it isn't."""
    if len(resolved) != 2:
        return None
    (host_name, host), (alt_name, alt) = resolved
    kind = mod_kind(host)
    if not kind:
        return None
    alt_mods = [(host_name, host, kind)]
    try:
        _check_host(alt_name, alt, alt_mods)
    except ComboError:
        return None
    return Combo(alt_name, alt, alt_mods, swapped=True)


# --- stacking the art ------------------------------------------------------

def peek_height(name):
    """How far a card slides out from under its host: enough to reveal the
    ability it contributes, and nothing above it.

    `cut` is the blank gap above the ability's first line, found in the art at
    build time (see build_anchors.py) — so the peek starts between two lines of
    text rather than through one.
    """
    a = _anchors().get(name)
    if not a:
        return FALLBACK_PEEK
    return max(40, min(CARD_H, CARD_H - a["cut"]))


def render_stack(combo, index):
    """The combination as one image: host on top, each modification peeking out
    below it with its transferred ability showing. JPEG bytes, or None if the
    host has no art.

    JPEG, not PNG: the source art is already JPEG, so a lossless re-encode just
    quintuples the upload for no visible gain.
    """
    from PIL import Image

    host_art = index.art_path(combo.host_name)
    if not host_art:
        return None

    layers = []          # (image, peek) for each modification, top-down
    for name, _, _ in combo.mods:
        art = index.art_path(name)
        if art:
            layers.append((Image.open(art).convert("RGB"), peek_height(name)))

    height = CARD_H + sum(p for _, p in layers)
    canvas = Image.new("RGB", (CARD_W, height), (0, 0, 0))

    # Bottom-most card first, so each card is overlapped by the one above it.
    offset = 0
    placements = []
    for img, peek in layers:
        offset += peek
        placements.append((img, offset))
    for img, y in reversed(placements):
        canvas.paste(img, (0, y))
    canvas.paste(Image.open(host_art).convert("RGB"), (0, 0))

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=90, optimize=True)
    return buf.getvalue()
