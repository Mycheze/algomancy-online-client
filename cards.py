#!/usr/bin/env python3
"""
cards.py — Algomancy card index with fuzzy name matching + art resolution.

Loads the oracle JSON (`AlgomancyCards/AlgomancyCards-OracleText.json`), matches
user-typed names tolerantly (exact -> substring -> difflib close-match), and
resolves each card to its local art file. Used by the Discord `&card` command,
but has no Discord dependency so it can be tested on its own.
"""

import difflib
import json
import re
from pathlib import Path

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


def _norm(s):
    """Lowercase and collapse non-alphanumerics for forgiving comparison."""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


class CardIndex:
    def __init__(self, oracle_path=ORACLE_JSON, cards_dir=CARDS_DIR):
        self.cards_dir = Path(cards_dir)
        data = json.loads(Path(oracle_path).read_text())
        # The JSON maps name -> [face, ...]; keep the first (front) face.
        self.cards = {name: faces[0] for name, faces in data.items() if faces}
        self.names = list(self.cards)
        self._norm_to_name = {_norm(n): n for n in self.names}

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
