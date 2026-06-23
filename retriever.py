#!/usr/bin/env python3
"""
retriever.py — shared keyword retrieval core over the Algomancy chunk corpus.

This is the same search logic that `ask.py` exposes on the CLI, factored out so
both the CLI and the Discord bot can use it. A `Retriever` loads the corpus and
builds the index once, then answers many `search()` calls — ideal for a
long-running bot process.

Scoring is BM25 (term-frequency saturation + length normalisation), which fixed
two failure modes the older raw-TF/length scoring had:
  * Long rulebook passages were drowned out by short card chunks — BM25's `b`
    length term keeps the authoritative Manual competitive on "how does X work".
  * A single typo ("flyng") matched nothing — query terms are now lightly
    stemmed, and any term still absent from the vocabulary is fuzzy-matched
    (difflib) to its nearest real term before scoring.
Higher-authority and non-outdated sources get a score multiplier so the
Manual/glossary float above experimental dev-log / web chatter on ties.
"""

import json
import math
import re
from collections import Counter
from difflib import get_close_matches
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus" / "algomancy_corpus.jsonl"

# Authority tier -> score multiplier (tier 1 = most authoritative).
AUTH_BOOST = {1: 1.30, 2: 1.20, 3: 1.05, 4: 0.95, 5: 0.85}
# Extra penalty for chunks flagged as likely outdated (experimental dev notes,
# old web write-ups). Keeps stale "right now I'm testing…" text from outranking
# the current rulebook/glossary.
OUTDATED_PENALTY = 0.8

# BM25 parameters. b < 0.75 softens the length penalty so multi-sentence
# rulebook passages aren't punished as hard relative to one-line cards.
BM25_K1 = 1.5
BM25_B = 0.5

# A query term absent from the vocabulary is mapped to its closest real term if
# the similarity clears this bar (catches typos / spelling variants).
FUZZY_CUTOFF = 0.74
# Fuzzy-matched terms are slightly discounted to reflect the uncertainty.
FUZZY_WEIGHT = 0.85

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP = set("a an the of to in on at is are be can do does what when how why "
           "you your it its they their i my me we our with for and or but if "
           "this that these those as so not no yes only all any some during "
           "from into about right exactly point then unless want have has".split())


def _stem(t):
    """Very light suffix stripping so plurals / verb forms match their root
    ('creatures'->'creature', 'flying'/'blocks'/'blocked'->'fly'/'block')."""
    if len(t) > 4 and t.endswith("ing"):
        return t[:-3]
    if len(t) > 4 and t.endswith("ed"):
        return t[:-2]
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def tokenize(s):
    """Raw content tokens (lowercased, stop-words and 1-char tokens dropped)."""
    return [t for t in TOKEN_RE.findall(s.lower()) if t not in STOP and len(t) > 1]


def stem_tokens(s):
    return [_stem(t) for t in tokenize(s)]


def load(corpus_path=CORPUS):
    path = Path(corpus_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Corpus not found at {path} — run: python3 build_corpus.py")
    return [json.loads(l) for l in path.open()]


def build_index(rows):
    """Build the BM25 index. Returns a dict consumed by `score()`."""
    docs = [Counter(stem_tokens(r["text"] + " " + r["title"])) for r in rows]
    doc_len = [sum(d.values()) or 1 for d in docs]
    avgdl = sum(doc_len) / len(doc_len) if doc_len else 1.0
    df = Counter()
    for d in docs:
        df.update(d.keys())
    n = len(docs)
    # BM25 idf (always positive thanks to the +1 inside the log).
    idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
    return {"docs": docs, "doc_len": doc_len, "avgdl": avgdl,
            "idf": idf, "vocab": list(df.keys())}


def _query_terms(query, index):
    """Stem the query and fuzzy-repair any term not in the vocabulary.
    Returns a list of (term, weight) pairs."""
    idf = index["idf"]
    vocab = index["vocab"]
    terms = []
    for t in stem_tokens(query):
        if t in idf:
            terms.append((t, 1.0))
            continue
        near = get_close_matches(t, vocab, n=1, cutoff=FUZZY_CUTOFF)
        if near:
            terms.append((near[0], FUZZY_WEIGHT))
    return terms


def score(query, rows, index, types=None):
    """BM25 score every row against the query; return [(score, row), …] sorted."""
    terms = _query_terms(query, index)
    if not terms:
        return []
    docs, doc_len, avgdl, idf = (
        index["docs"], index["doc_len"], index["avgdl"], index["idf"])
    results = []
    for r, d, dl in zip(rows, docs, doc_len):
        if types and r["source_type"] not in types:
            continue
        s = 0.0
        norm = BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl)
        for t, w in terms:
            f = d.get(t)
            if f:
                s += w * idf[t] * (f * (BM25_K1 + 1)) / (f + norm)
        if s > 0:
            s *= AUTH_BOOST.get(r["authority"], 1.0)
            if r.get("outdated_risk"):
                s *= OUTDATED_PENALTY
            results.append((s, r))
    results.sort(key=lambda x: -x[0])
    return results


def snippet(text, query, width=300):
    """Window the text around the first matched query term."""
    terms = tokenize(query)
    low = text.lower()
    pos = min((low.find(t) for t in terms if low.find(t) >= 0), default=0)
    start = max(0, pos - width // 4)
    end = min(len(text), start + width)
    frag = text[start:end].strip().replace("\n", " ")
    return ("…" if start > 0 else "") + frag + ("…" if end < len(text) else "")


class Retriever:
    """Loads the corpus + index once, then serves many searches."""

    def __init__(self, corpus_path=CORPUS):
        self.rows = load(corpus_path)
        self.index = build_index(self.rows)

    def search(self, query, k=6, types=None):
        """Return up to `k` (score, row) tuples, best first."""
        return score(query, self.rows, self.index, types)[:k]
