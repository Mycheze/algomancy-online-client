"""terms.py — put the CR's definition of a game term beside the passages that use it.

WHY THIS EXISTS
---------------
2026-11-01, response b5ffba60: "can Gravitational Correction change the target
of a Null Drone to the Null Drone itself?" The bot answered that Null Drone "is
a spell unit, not a spell effect" — backwards: CR 700.1a defines a spell effect
as "a spell, a spell unit or a spell token on the stack". The definition was in
the corpus twice (cr:700.1, cr:glossary.spell-effect) and retrieved neither
time, because retrieval runs on the QUESTION and the question never said "spell
effect" — only Null Drone's card text did. Without it the model read the term
off its words, and flash and pro alike got it wrong (3/3 each). With the
glossary row on the slate, flash called Null Drone a spell effect 3/3.

So after retrieval, every CR glossary term that appears in the question or in
a retrieved CARD's own text (its type line and text box) gets its glossary row
appended to the slate, unless a retrieved chunk already prints the rule it
points at. Nothing here is hand-listed: the terms are the CR glossary's own
rows, read off the corpus, and which ones win a slot is decided by how rare
each term is across the corpus (a rare term carries more meaning than "card").

The rows keep their own ids (cr:glossary.<key>), so the model can cite them and
core.render_citations footnotes them like any retrieved passage.
"""

from __future__ import annotations

import re

#: at most this many definitions are added to one slate (each is ~40 tokens)
MAX_DEFS = 8
#: terms shorter than this ("X") match too much ordinary text to mean anything
MIN_TERM_LEN = 3


def _pattern(term: str) -> re.Pattern:
    """Whole-word, case-insensitive, with the inflections card text uses:
    trash -> trashed, negate -> negated, target -> targeting, ally -> allies.
    A multi-word term matches across a space or a hyphen."""
    words = [re.escape(w) for w in re.split(r"[\s\-]+", term.strip().lower()) if w]
    last = words[-1]
    if last.endswith("y") and len(last) > 2:
        last = f"(?:{last}|{last[:-1]}ies)"
    body = r"[\s\-]+".join(words[:-1] + [last])
    return re.compile(rf"\b{body}(?:s|es|ed|d|ing)?\b", re.IGNORECASE)


def card_rules_text(row: dict) -> str:
    """The part of a card chunk a rules question turns on: the type line and the
    text box. Not the name (a card called "Leave None Pure" is not about Pure),
    not the cost/stats/factions lines, not the appended rulings prose."""
    lines = (row.get("text") or "").split("\n")
    type_line = lines[1] if len(lines) > 1 else ""
    body = (row.get("text") or "").split("\n\n", 1)
    box = body[1] if len(body) > 1 else ""
    box = box.split("\nRulings:", 1)[0]
    return f"{type_line}\n{box}"


class TermIndex:
    """The CR glossary rows of a corpus, with a matcher and a rarity for each."""

    def __init__(self, rows):
        self.terms = []          # (term, pattern, row), longest term first
        gloss = [r for r in rows if str(r.get("id", "")).startswith("cr:glossary.")
                 and (r.get("metadata") or {}).get("term")]
        for r in gloss:
            term = r["metadata"]["term"]
            if len(term) < MIN_TERM_LEN:
                continue
            self.terms.append((term, _pattern(term), r))
        self.terms.sort(key=lambda t: -len(t[0]))
        # rarity: how many corpus chunks use the term (fewer = more specific)
        # (a substring test on the term's first word skips the regex on most
        # chunks: 187 patterns x ~2500 chunks took 5 s, this ~1 s)
        texts = [(r.get("text") or "") for r in rows]
        lows = [t.lower() for t in texts]
        self.df = {}
        for term, pat, _r in self.terms:
            head = re.split(r"[\s\-]+", term.lower())[0]
            head = head[:-1] if head.endswith("y") else head
            self.df[term] = sum(1 for t, lo in zip(texts, lows) if head in lo and pat.search(t))

    def matches(self, text: str) -> list[str]:
        """Glossary terms in `text`, a longer term claiming its span first, so
        "spell effect" is matched as itself and not also as "spell" + "effect"
        there (either may still match somewhere else in the text)."""
        if not text:
            return []
        taken: list[tuple[int, int]] = []
        found = []
        for term, pat, _r in self.terms:
            for m in pat.finditer(text):
                s, e = m.span()
                if any(s < te and ts < e for ts, te in taken):
                    continue
                taken.append((s, e))
                if term not in found:
                    found.append(term)
        return found

    def definitions_for(self, question: str, hits, covers=None, limit=MAX_DEFS):
        """The glossary rows to append to `hits` ([(score, row)]): terms in the
        question first, then terms in the retrieved cards' rules text, each
        group rarest first; skipping a row already retrieved and a term whose
        rule a retrieved chunk prints (`covers(row, num)`, core.cr_chunk_covers).
        Returns [(term, row)]."""
        hit_rows = [r for _s, r in hits]
        have = {r["id"] for r in hit_rows}
        by_term = {t: r for t, _p, r in self.terms}
        q_terms = self.matches(question)
        c_terms = []
        for r in hit_rows:
            if r.get("source_type") == "card":
                for t in self.matches(card_rules_text(r)):
                    if t not in c_terms and t not in q_terms:
                        c_terms.append(t)
        rare = lambda ts: sorted(ts, key=lambda t: (self.df.get(t, 0), t))
        out = []
        for t in rare(q_terms) + rare(c_terms):
            row = by_term[t]
            if row["id"] in have:
                continue
            nums = (row.get("metadata") or {}).get("nums") or []
            if covers and any(covers(h, n) for h in hit_rows for n in nums):
                continue
            out.append((t, row))
            if len(out) >= limit:
                break
        return out
