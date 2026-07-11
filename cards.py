#!/usr/bin/env python3
"""
cards.py — Algomancy card index: fuzzy name matching, full-text search, art.

Loads the oracle JSON (`AlgomancyCards/AlgomancyCards-OracleText.json`) and
serves two lookups over it:
  * `lookup(name)`   — match a user-typed NAME tolerantly (exact -> substring ->
                       difflib close-match). Behind `&card` / `/card`.
  * `search(query)`  — find a card from a DESCRIPTION, for someone who remembers
                       what a card does but not what it's called. Behind
                       `&search` / `/search`.
Both resolve a card to its local art file. No Discord/HTTP dependency, so the
whole thing is testable on its own and shared by both front-ends via core.cards.
"""

import difflib
import json
import math
import re
from collections import Counter
from pathlib import Path

# One tokenizer/stemmer for the whole project: the same query that finds a rules
# passage should find a card, and a stemming rule fixed in one place should fix
# both. (Importing the module is cheap — it doesn't read the corpus until a
# Retriever is constructed.)
from retriever import stem_tokens

ROOT = Path(__file__).resolve().parent
CARDS_DIR = ROOT / "AlgomancyCards"
ORACLE_JSON = CARDS_DIR / "AlgomancyCards-OracleText.json"

# Element -> embed sidebar color (Discord int). Defaults to neutral gray.
FACTION_COLOR = {
    "fire": 0xE2503B,
    "water": 0x3B82E2,
    "earth": 0x9C6B3F,
    "metal": 0xA8B0B8,
    "wood": 0x4FAF58,
}
FACTION_EMOJI = {
    "fire": "🔥", "water": "💧", "earth": "⛰️", "metal": "⚙️", "wood": "🌿",
}

# --- auto-linking card names in prose ------------------------------------
# The web app turns every card name it finds in an answer into a hover-preview
# link. Two families of name break that, because they are also ordinary words in
# any sentence about the rules — and an answer about the battle phase should not
# be strewn with links to a card called Battle.

# 1. Components and reference cards. In the index because they have art, but no
# one wants a preview of the cardback, and they'd match constantly. Never linked.
NON_CARD_NAMES = {
    "Cardback", "Blank Card", "Generic Unit", "Turn Structure",
    "1v1 Turn Structure", "Initiative Back", "Player Icons Card",
    "Player Keywords Card",
} | {f"Stolen Card {i}" for i in range(1, 11)}

# 2. Real cards whose names double as everyday Algomancy vocabulary. These link
# only when BOTH hold: the text uses the card's exact capitalisation (so "the
# battle phase" and "you recall a unit" are left alone), AND the word isn't
# hemmed in by one of the rules words below — "during Battle" and "the Battle
# phase" are the phase, not the card, however they're capitalised. Extend this
# list whenever a card name starts showing up as noise; it's just vocabulary.
AMBIGUOUS_NAMES = {
    "Battle", "Fight", "Initiative", "Recall", "Poison", "Crystal", "Intent",
    "Left", "Right", "Stay", "Robot", "Jelly", "Overwhelm", "Discharge",
    "Download", "Perish", "Squish", "Formless", "Foretell", "Rebalance",
    "Reconfigure", "Resurrect", "Unmake", "Abduct", "Manufacture",
    "Dormant Resource", "Shard Resource", "Fire Resource", "Water Resource",
    "Earth Resource", "Wood Resource", "Metal Resource",
}
# A word immediately BEFORE an ambiguous name that marks it as game-speak.
LINK_VETO_BEFORE = {
    "during", "in", "into", "throughout", "before", "after", "each", "every",
    "this", "that", "your", "their", "our", "my", "no", "any",
}
# …and immediately AFTER ("Battle phase", "Poison counters", "Initiative team").
LINK_VETO_AFTER = {
    "phase", "phases", "step", "steps", "damage", "spell", "spells", "token",
    "tokens", "counter", "counters", "attribute", "attributes", "keyword",
    "keywords", "ability", "abilities", "team", "teams", "player", "players",
    "order", "symbol", "icon", "zone", "timing", "window", "windows", "rule",
    "rules",
}


# --- search tuning --------------------------------------------------------
# `search()` is a small BM25 index over the cards themselves — 370 of them, so a
# full scan per query is free and no model call is needed. It is deliberately NOT
# the corpus retriever (retriever.py): that one ranks rules PROSE for `&ask`,
# where authority and passage length matter. Here every document is a card, and
# what matters instead is WHICH FIELD a term landed in — "poison" in a card's
# name is a much stronger signal than "poison" buried in its oracle text — plus
# the structured cues a describing player naturally types (a 2/1, an element, a
# cost). Hence per-field weights and cue boosts rather than authority tiers.
SEARCH_FIELDS = {
    # Deliberately modest. A term in the name IS a strong signal, but the bonus for
    # a query that looks like a name is applied separately (see _name_affinity) —
    # weighting the name field heavily on top of that made descriptive queries lose
    # to coincidental name words ("return a unit from the bin" ranked the card
    # *called* Return to Nature above the one that actually recalls from the bin).
    "name": 1.8,
    "type": 1.8,        # holds the attributes ({Haste}) and subtypes (Robot, Beast)
    "factions": 1.8,
    "text": 1.0,
    "keywords": 1.2,    # what this card's attributes MEAN — see KEYWORD_TEXT
    "rulings": 0.4,     # indexed, but a ruling is about a card, not the card itself
}
# BM25 knobs, tuned for cards rather than prose. b is low: cards are all short, and
# a wordy card is not a worse match for a term than a terse one — penalising length
# here mostly punishes the complex cards people are most likely to be describing.
SEARCH_K1 = 1.4
SEARCH_B = 0.35
# A query word that isn't in any card gets difflib'd to the nearest word that is,
# so "flyng"/"poisonus" still land. Same idea as the retriever's fuzzy repair, and
# the cutoff is low for the same reason it is there: the index stores STEMS, so a
# typo is compared against "fly", not "flying", and scores lower than it looks
# ("flyng" vs "fly" is only 0.75).
SEARCH_FUZZY_CUTOFF = 0.72
SEARCH_FUZZY_WEIGHT = 0.85

# Players describe cards in the vocabulary they already have — plain English, or
# whatever other card game they came from. These map that onto the words actually
# printed on Algomancy cards, which are often NOT the obvious ones: no card says
# "destroy" (they say delete), or "counter" a spell (negate), or "return" to hand
# (recall), or "enters play" (spawn), or "creature" (unit), or "graveyard" (bin).
# Without this table those queries retrieve nothing, however well ranked.
#
# Expansion ADDS the printed word and KEEPS the typed one, so a word that is both
# a synonym and real card vocabulary still matches itself — "discard" is a synonym
# for the bin and also a thing two cards literally tell you to do.
SEARCH_ALIASES = {
    # plain English / other games' vocabulary -> the word actually on the card
    "creature": "unit", "creatures": "unit", "minion": "unit", "guy": "unit",
    "graveyard": "bin", "yard": "bin", "discard": "bin", "trash": "bin",
    "destroy": "delete", "destroys": "delete", "kill": "delete", "kills": "delete",
    # NB: "counterspell"/"cancel" only. Bare "counter"/"counters" is left alone —
    # on an Algomancy card that overwhelmingly means a +1/+1 counter, and aliasing
    # it to negate would misdirect every query about counters.
    "counterspell": "negate", "cancel": "negate",
    "return": "recall", "returns": "recall", "bounce": "recall",
    "etb": "spawn", "enter": "spawn", "enters": "spawn", "battlefield": "play",
    "leaves": "despawn", "death": "die",
    "make": "create", "makes": "create", "making": "create", "token": "create",
    "trample": "piercing", "deathtouch": "deadly", "unblockable": "sneaky",
    "flier": "flying", "flyer": "flying", "flies": "flying", "fly": "flying",
    "sac": "sacrifice", "dmg": "damage", "hit": "damage", "hits": "damage",
    "cantrip": "draw", "pump": "counter", "buff": "counter",
    # element colours, for anyone reaching for a colour pie
    "red": "fire", "blue": "water", "green": "wood", "brown": "earth",
    "grey": "metal", "gray": "metal", "silver": "metal",
}

# Idioms that only mean something as a phrase. Applied to the raw query before
# it's split into words, because the mapping is not word-for-word: "counter a
# spell" means negate, while the bare word "counter" means a +1/+1 counter and
# must be left alone (hence no "counter" entry in SEARCH_ALIASES above).
SEARCH_PHRASES = {
    "counter a spell": "negate",
    "counter target spell": "negate",
    "counter spell": "negate",
    "enters the battlefield": "spawn",
    "enters play": "spawn",
    "comes into play": "spawn",
    "leaves play": "despawn",
    "first strike": "swift",
    "can't be blocked": "sneaky",
    "cant be blocked": "sneaky",
    "double damage": "powerful",
    "to their hand": "recall hand",
}

# What each attribute MEANS, indexed onto every card that has it. This is the
# difference between a search that matches words and one that finds cards: the
# only {Thieving} card in the game never says "draw" anywhere on it, so "flier
# that draws a card when it hits the player" can only find it if the index knows
# Thieving *is* that sentence. Same for trample->Piercing, deathtouch->Deadly.
#
# Definitions are the verified ones from core.PRIMER's keyword glossary, phrased
# the way a player would describe the effect. (Stated here rather than imported:
# core imports cards, not the other way round, and these are search text — they
# can be reworded for recall without touching what the model is told.)
KEYWORD_TEXT = {
    "flying": "flying flier can only be blocked by other flying units",
    "piercing": "excess combat damage beyond a blocked unit carries over to the defending player trample",
    "electric": "excess damage is redirected to an adjacent unit and chains across a row",
    "deadly": "any amount of combat damage it deals delete the unit it hits deathtouch",
    "poisonous": "damages units with -1/-1 counters instead of ordinary combat damage",
    "swift": "deals its combat damage first strike",
    "sluggish": "deals its combat damage last",
    "tough": "its defense toughness is doubled",
    "haste": "may be played during the haste step at instant speed",
    "virus": "may be applied as a modification augment from your hand during battle",
    "burst": "can be cast any time but all burst spells of the same type are played at once",
    "unstable": "if it would go to the bin it is erased instead",
    "battle": "can only be used during a fight after attackers are declared",
    "ambush": "played during battle recalling one of your units and taking its position",
    "powerful": "deals double damage",
    "reaping": "when it kills one or more units its controller player draws a card",
    "thieving": "when it deals combat damage to an opponent player draw a card",
    "resonant": "when it damages a unit it also deals that much damage to that unit's controller player",
    "vulnerable": "receives double damage",
    "feeble": "cannot block",
    "sneaky": "cannot be blocked if it is attacking alone unblockable",
    "evasive": "requires two blockers to block it",
    "alluring": "the targeted enemy cannot attack and must block it this combat",
    "unaware": "ignores all stat changes",
    "balanced": "power and defense both become the greater of the two",
    "inverted": "reverses stat changes so a -7/-7 effect instead gives +7/+7",
    # Ability icons (the [bracketed] ones), for "a card I can stick onto a unit".
    "augment": "modification attached from your bin onto any unit adding its text",
    "switch": "graft modification attached under a unit that has the graft symbol",
    "switch1": "bounded graft that triggers at most once per turn",
}
# Attributes/icons a card HAS are the {braced} and [bracketed] tokens on its type
# line ("[Augment] {Flying} Cloud Sprite Unit").
_TYPE_TOKEN_RE = re.compile(r"[\[{]([A-Za-z]+\d*)[\]}]")
# Element words (plus the colour aliases above) that mark a query as asking for a
# faction — "green flier" should float WOOD fliers, not merely fliers. Derived from
# FACTION_COLOR so a sixth element only ever has to be added in one place.
FACTIONS = tuple(FACTION_COLOR)
_COLOR_TO_FACTION = {v: v for v in FACTIONS}
_COLOR_TO_FACTION.update({k: v for k, v in SEARCH_ALIASES.items() if v in FACTIONS})
# Words meaning "has no element" — the faction-neutral (Prismite-cost) cards.
NEUTRAL_WORDS = {"colorless", "colourless", "neutral", "prismite"}

# Cue boosts. Multiplicative and gentle: a cue lifts the cards that satisfy it
# rather than filtering out the ones that don't, so a half-remembered detail
# ("I think it was a 2/2?") re-ranks the field instead of emptying it.
FACTION_BOOST = 1.6
STAT_BOOST = 1.7
COST_BOOST = 1.4
NEUTRAL_BOOST = 1.5
# "red SPELL that deals damage" should prefer an actual Spell over a Unit that
# happens to talk about damage. Asymmetric on purpose: nearly every card is a
# Unit, so the unit cue is close to a no-op, while the spell cue is a real filter.
TYPE_BOOST = 1.35

# A cue can also be the WHOLE query: "2/1", "fire spell", "costs 3" leave no words
# to rank once the cue is lifted out of them. So a satisfied cue scores in its own
# right, and these are the standalone values (used only when there's no text match
# to multiply). Ordered by how much each one actually narrows the set: a specific
# P/T says far more than "it's a unit".
CUE_SCORE = {"pt": 3.0, "faction": 2.0, "neutral": 2.0, "cost": 1.5,
             "spell": 1.0, "unit": 0.5}

# Name affinity, added to the BM25 score so that `&search` still behaves like
# `&card` when the query IS a name (the whole point: one command that finds the
# card whether or not you remember what it's called).
NAME_EXACT = 12.0
NAME_SUBSTR = 6.0
NAME_FUZZY = 5.0
NAME_FUZZY_CUTOFF = 0.8

# A power/toughness the player remembers: "2/1", "a 3 / 3".
_PT_RE = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\b")
# …but "creates a 1/1 token" is a stat the card MAKES, not one the card HAS. Read
# as a cue it does real damage — it boosts every card that happens to be a 1/1 and
# buries the token-makers the player was actually describing. When a create verb
# leads into the stat we drop the cue and let the digits be searched as words,
# which is exactly how they appear in the oracle text ("Create a 1/1 unit").
_MAKES_PT_RE = re.compile(
    r"\b(?:create|creates|creating|make|makes|making|spawn|spawns)\b[\w\s]{0,12}$")
# A cost they remember: "costs 3", "3 cost", "3 mana", "3-drop".
_COST_RE = re.compile(r"\bcosts?\s*(\d{1,2})\b|\b(\d{1,2})[\s-]*(?:cost|mana|drop)\b")


def _norm(s):
    """Lowercase and collapse non-alphanumerics for forgiving comparison."""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def plain_text(text):
    """Card text with the JSON's formatting codes resolved, game tokens kept.

    Strips the layout/italic/colour markers ({/n}, {i}, {g}) but leaves [Switch]
    and {Haste} intact — those are real game vocabulary, so they belong in the
    search index and in a snippet the front-ends will render as icons.

    Whitespace is left exactly as the card data has it (some cards carry stray
    double spaces). This is the single pass behind the search index AND both
    front-ends' card rendering, so tidying here would silently restyle 52 cards
    in `&card` — a display change that belongs in its own commit, not this one.
    Callers that need normalised spacing (e.g. SearchHit.snippet) do it themselves.
    """
    if not text:
        return ""
    t = text.replace("{/n}", "\n")
    t = re.sub(r"\{/?i\d*\}", "", t)              # italic markers {i} {i1} {/i}
    return t.replace("{g}", "").replace("{p}", "")   # attribute colour markers


def _name_affinity(qn, norm_name):
    """Bonus for the query looking like the card's NAME rather than describing it.

    This is what lets one command serve both habits: type `search wisp` and the
    card called Wisp still comes first, even though `search` is built for people
    who've forgotten the name.
    """
    if not qn:
        return 0.0
    if qn == norm_name:
        return NAME_EXACT
    if qn in norm_name:
        # Scaled by how much of the name the query covers, so "fire" gets a nudge
        # toward Fireball but never outranks a card actually named Fire.
        return NAME_SUBSTR * len(qn) / len(norm_name)
    ratio = difflib.SequenceMatcher(None, qn, norm_name).ratio()
    return NAME_FUZZY * ratio if ratio >= NAME_FUZZY_CUTOFF else 0.0


class SearchHit:
    """One card matched by `search()`, carrying the evidence for why it matched.

    `matched` holds the (stemmed) query words that actually landed, which is what
    `snippet()` windows the oracle text around — so a result list can show the
    player the line that made this card a candidate, not just its name.
    """

    __slots__ = ("name", "card", "score", "matched")

    def __init__(self, name, card, score, matched):
        self.name = name
        self.card = card
        self.score = score
        self.matched = matched

    def __repr__(self):
        return f"<SearchHit {self.name} {self.score:.2f}>"

    def snippet(self, width=170):
        """A window of the card's oracle text around the first matched word.

        Game tokens ([Switch], {Haste}) are left intact for the front-end to
        render as icons, exactly as it renders the full card's text.
        """
        text = " ".join((plain_text(self.card.get("text"))
                         or plain_text(self.card.get("type"))).split())
        if len(text) <= width:
            return text
        low = text.lower()
        pos = next((p for p in (low.find(t) for t in self.matched) if p >= 0), 0)
        start = max(0, pos - width // 4)
        end = min(len(text), start + width)
        return (("…" if start else "") + text[start:end].strip()
                + ("…" if end < len(text) else ""))


class CardIndex:
    def __init__(self, oracle_path=ORACLE_JSON, cards_dir=CARDS_DIR):
        self.cards_dir = Path(cards_dir)
        data = json.loads(Path(oracle_path).read_text())
        # The JSON maps name -> [face, ...]; keep the first (front) face.
        self.cards = {name: faces[0] for name, faces in data.items() if faces}
        self.names = list(self.cards)
        self._norm_to_name = {_norm(n): n for n in self.names}
        # Built on the first search() — a bot that never searches shouldn't pay
        # for the index, and a test that only does name lookups stays instant.
        self._sindex = None

    def lookup(self, query, n_alts=3):
        """Return (card_dict, matched_name, alternatives) — card may be None.

        Matching cascade: exact (normalized) -> unique substring -> fuzzy.
        `alternatives` is a list of other plausible names for a "did you mean".
        """
        qn = _norm(query)
        if not qn:
            return None, None, []

        # 1. exact normalized hit
        if qn in self._norm_to_name:
            name = self._norm_to_name[qn]
            return self.cards[name], name, []

        # 2. substring matches on the normalized name
        subs = [n for n in self.names if qn in _norm(n)]
        if len(subs) == 1:
            return self.cards[subs[0]], subs[0], []

        # 3. fuzzy close matches over the normalized keys
        fuzzy_keys = difflib.get_close_matches(qn, self._norm_to_name, n=8, cutoff=0.5)
        fuzzy = [self._norm_to_name[k] for k in fuzzy_keys]

        # Merge substring + fuzzy candidates, preserving order, de-duped.
        ranked = list(dict.fromkeys(subs + fuzzy))
        if not ranked:
            return None, None, []
        best = ranked[0]
        return self.cards[best], best, ranked[1:1 + n_alts]

    # --- full-text search ------------------------------------------------

    def _search_index(self):
        """The BM25 index over card fields, built once on first use."""
        if self._sindex is None:
            self._sindex = self._build_search_index()
        return self._sindex

    @staticmethod
    def _keyword_text(type_line):
        """Definitions of every attribute/icon on this card's type line, so the
        card is findable by what its keywords DO, not just what they're called."""
        return " ".join(
            KEYWORD_TEXT[k] for k in
            dict.fromkeys(m.lower() for m in _TYPE_TOKEN_RE.findall(type_line or ""))
            if k in KEYWORD_TEXT)

    def _build_search_index(self):
        rows = []
        for name, card in self.cards.items():
            # Components and reference cards (cardback, turn-structure aids) are in
            # the index for their art, but nobody is *searching* for them — they'd
            # only ever be noise in a result list.
            if name in NON_CARD_NAMES:
                continue
            type_line = plain_text(card.get("type"))
            fields = {
                "name": name,
                "type": type_line,
                "factions": " ".join(self.factions(card)),
                "text": plain_text(card.get("text")),
                "keywords": self._keyword_text(type_line),
                "rulings": " ".join(card.get("rulings") or []),
            }
            # One weighted bag of words per card: a term's frequency is scaled by
            # the weight of the field it appeared in, so BM25 saturation then
            # applies to "how strongly does this card say X", not raw word counts.
            tf = Counter()
            length = 0
            for field, weight in SEARCH_FIELDS.items():
                tokens = stem_tokens(fields[field])
                length += len(tokens)          # true length, for BM25 normalisation
                for t in tokens:
                    tf[t] += weight
            rows.append({"name": name, "card": card, "tf": tf, "len": length or 1,
                         "norm": _norm(name), "type_low": type_line.lower()})

        df = Counter()
        for r in rows:
            df.update(r["tf"])
        n = len(rows) or 1
        idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        avgdl = sum(r["len"] for r in rows) / n
        return {"rows": rows, "idf": idf, "avgdl": avgdl, "vocab": list(df)}

    def _search_terms(self, words, index):
        """Query words -> [(term, weight)]: alias-expanded, stemmed, typo-repaired."""
        idf, vocab = index["idf"], index["vocab"]
        words = words.lower()
        # Phrases first, while the query is still a string — "counter a spell" has
        # to be recognised before "counter" is on its own as a word.
        for phrase, meaning in SEARCH_PHRASES.items():
            if phrase in words:
                words += " " + meaning
        raw = re.findall(r"[a-z0-9]+", words)
        # Expansion ADDS the printed word, keeping the typed one — "discard" is
        # both a word two cards actually use and a synonym for the bin.
        expanded = raw + [SEARCH_ALIASES[w] for w in raw if w in SEARCH_ALIASES]
        terms = {}
        for t in stem_tokens(" ".join(expanded)):
            if t in idf:
                terms[t] = max(terms.get(t, 0.0), 1.0)
                continue
            near = difflib.get_close_matches(t, vocab, n=1, cutoff=SEARCH_FUZZY_CUTOFF)
            if near:
                terms[near[0]] = max(terms.get(near[0], 0.0), SEARCH_FUZZY_WEIGHT)
        return list(terms.items())

    def search(self, query, limit=8):
        """Find cards from a free-text description. Returns [SearchHit], best first.

        Ranks every card by BM25 over its weighted fields, adds a bonus if the
        query looks like the card's name, then lifts the cards that satisfy any
        structured cue the query happens to carry (an element, a 2/1, a cost).
        """
        q = (query or "").strip()
        if not q:
            return []
        index = self._search_index()
        ql = q.lower()

        # Lift the structured cues out BEFORE picking words to search for. The "2"
        # and "1" of a 2/1 are a stat, not two words to hunt for in oracle text —
        # left in, they'd match every card that happens to deal 2 damage.
        pt = _PT_RE.search(ql)
        if pt and _MAKES_PT_RE.search(ql[:pt.start()]):
            pt = None                       # "creates a 1/1" — a token, not this card's stats
        cost = _COST_RE.search(ql)
        want_pt = (pt.group(1), pt.group(2)) if pt else None
        want_cost = next((g for g in cost.groups() if g), None) if cost else None
        words = ql
        for cue in (pt, cost):
            if cue:
                words = words.replace(cue.group(0), " ")

        plain_words = set(re.findall(r"[a-z]+", words))
        want_factions = {_COLOR_TO_FACTION[w] for w in plain_words if w in _COLOR_TO_FACTION}
        want_neutral = bool(plain_words & NEUTRAL_WORDS)
        want_spell = "spell" in plain_words
        want_unit = bool(plain_words & {"unit", "creature", "minion"})

        terms = self._search_terms(words, index)
        qn = _norm(q)
        idf, avgdl = index["idf"], index["avgdl"]

        hits = []
        for row in index["rows"]:
            tf = row["tf"]
            norm = SEARCH_K1 * (1 - SEARCH_B + SEARCH_B * row["len"] / avgdl)
            score, matched = 0.0, []
            for t, w in terms:
                f = tf.get(t)
                if f:
                    score += w * idf[t] * (f * (SEARCH_K1 + 1)) / (f + norm)
                    matched.append(t)
            score += _name_affinity(qn, row["norm"])

            # Cues both LIFT a text match (multiplier) and STAND ALONE (score of
            # their own), because a cue can be the entire query — "2/1" has no
            # words left to rank once the stat is lifted out of it.
            card = row["card"]
            mult, cue = 1.0, 0.0
            if want_factions & set(self.factions(card)):
                mult *= FACTION_BOOST
                cue += CUE_SCORE["faction"]
            if want_neutral and not self.factions(card):
                mult *= NEUTRAL_BOOST
                cue += CUE_SCORE["neutral"]
            if want_pt and (str(card.get("power")), str(card.get("toughness"))) == want_pt:
                mult *= STAT_BOOST
                cue += CUE_SCORE["pt"]
            if want_cost and str(card.get("total_cost")) == want_cost:
                mult *= COST_BOOST
                cue += CUE_SCORE["cost"]
            if want_spell and "spell" in row["type_low"]:
                mult *= TYPE_BOOST
                cue += CUE_SCORE["spell"]
            if want_unit and "unit" in row["type_low"]:
                mult *= TYPE_BOOST
                cue += CUE_SCORE["unit"]

            score = score * mult if score > 0 else cue
            if score <= 0:
                continue
            hits.append(SearchHit(row["name"], card, score, matched))

        hits.sort(key=lambda h: (-h.score, h.name))
        return hits[:limit]

    def art_path(self, name):
        """Local art file for a card name, or None if it has no art."""
        p = self.cards_dir / (name.replace(" ", "-") + ".jpg")
        return p if p.exists() else None

    # --- display helpers -------------------------------------------------

    @staticmethod
    def factions(card):
        f = card.get("factions")
        if isinstance(f, list):
            return [x.lower() for x in f]
        if isinstance(f, str) and f.lower() not in ("", "unknown"):
            return [f.lower()]
        return []

    def color(self, card):
        fs = self.factions(card)
        return FACTION_COLOR.get(fs[0], 0x9AA0A6) if fs else 0x9AA0A6

    def faction_label(self, card):
        fs = self.factions(card)
        if not fs:
            return "Neutral / Unknown"
        return " ".join(f"{FACTION_EMOJI.get(f,'')} {f.title()}".strip() for f in fs)
