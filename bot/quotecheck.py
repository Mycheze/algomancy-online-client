#!/usr/bin/env python3
"""
quotecheck.py — the deterministic quote check (judge tools design §2).

The owner's chief fear is a hallucinated rule, and the most convincing shape
of one is a rule given in quotation marks with a citation after it: it reads
as verbatim, so nobody checks it. This module checks it, with no model call:

- A quotation ("…" or “…”, 12–300 characters) followed within 3 characters —
  or after one short parenthetical such as "(CR 700.1a)" — by a [tag] group is
  a claim that those words are printed in the cited source.
- The quote is normalised (whitespace, quote and dash styles, case, markdown
  emphasis) and split on an ellipsis (… or ...) into fragments that must all
  appear, in order, in the text one of its tags resolves to: the corpus /
  tool row's text (a CR record with its examples, a card's oracle text), plus
  any `examples` or engine `log` lines the row's metadata carries.
- On a miss the quotation marks AND the citation group go — the words stay,
  but no longer pose as a verbatim, sourced quote — and the miss is reported.

A second check, for engine results only: a stat pair ("3/1") in a sentence
citing [engine:sN] must appear in that result's `final` (or its text);
otherwise the engine citation is dropped from that sentence and reported as
an engine mismatch.

No repair round, so no extra cost: the eval measures how often these fire.
Pure functions; core.py passes its own resolver so this module needs nothing
from it (and is testable on its own).
"""

import json
import re

MIN_QUOTE, MAX_QUOTE = 12, 300

# An opening quote, 12–300 characters with no quote mark, a closing quote; then
# up to 3 characters, an optional short parenthetical ("(CR 700.1a)"), up to 3
# more, and a bracketed group. Group "tags" is the bracket's inside.
_QUOTE_RE = re.compile(
    r'(?P<open>["“])(?P<body>[^"“”\n]{%d,%d})(?P<close>["”])'
    r'(?P<gap>[^\[\]\n]{0,3}?(?:\([^()\[\]\n]{1,40}\)[^\[\]\n]{0,3}?)?)'
    r'\[(?P<tags>[^\[\]]+)\]' % (MIN_QUOTE, MAX_QUOTE))

# One of our citation tags (same shape core._TAG_LIKE_RE accepts).
_TAG_LIKE_RE = re.compile(r"^[a-z][a-z0-9_\-]*:\S")

_ELLIPSIS_RE = re.compile(r"…|\.\.\.")
# Every quote mark, single or double, curly or straight, folds to one: a model
# quoting a rule that itself quotes a word nests the marks its own way.
_FOLD = str.maketrans({
    "“": '"', "”": '"', "„": '"', "‘": '"', "’": '"', "‚": '"', "`": '"', "'": '"',
    "—": "-", "–": "-", "‑": "-", "−": "-", " ": " ",
})
_EDGE = " \t\n.,;:!?'\"()-"


def normalise(text):
    """Fold quote/dash styles, drop markdown emphasis, collapse whitespace, casefold."""
    t = str(text or "").translate(_FOLD)
    t = t.replace("**", "").replace("__", "").replace("*", "")
    return re.sub(r"\s+", " ", t).strip().casefold()


def fragments(quote):
    """The quote's pieces between ellipses, normalised, edge punctuation off."""
    out = []
    for piece in _ELLIPSIS_RE.split(quote):
        p = normalise(piece).strip(_EDGE)
        if p:
            out.append(p)
    return out


def in_order(frags, haystack):
    """Every fragment appears in `haystack` (normalised), each after the last."""
    if not frags:
        return False
    pos = 0
    for f in frags:
        i = haystack.find(f, pos)
        if i < 0:
            return False
        pos = i + len(f)
    return True


def _as_lines(v):
    if not v:
        return []
    if isinstance(v, str):
        return [v]
    out = []
    for x in v:
        out.append(x.get("text", "") if isinstance(x, dict) else str(x))
    return out


def row_haystack(row):
    """The exact text a citation of `row` may be quoted from, normalised."""
    m = row.get("metadata") or {}
    parts = [row.get("text") or ""]
    for key in ("quote_text", "examples", "log"):
        parts.extend(_as_lines(m.get(key)))
    return normalise("\n".join(parts))


def _tag_parts(group):
    return [t.strip() for t in re.split(r"[;,]", group) if _TAG_LIKE_RE.match(t.strip())]


def _rows_for(tag, rows, resolve):
    """Every row a tag can mean: exact id matches (a tool row and a retrieved
    chunk may share one) plus whatever the resolver picks."""
    found = [r for r in rows if r.get("id") == tag]
    hit = resolve(tag, rows) if resolve else None
    if hit is not None:
        r = hit[0] if isinstance(hit, tuple) else hit
        if all(r is not x for x in found):
            found.append(r)
    return found


def check_quotes(answer, rows, resolve=None):
    """(answer', failures). failures = [{"tags": [...], "quote": "..."}] for every
    quoted-and-cited passage whose words its sources do not print; in answer'
    those lose their quotation marks and their citation group."""
    failures = []

    def repl(m):
        tags = _tag_parts(m.group("tags"))
        if not tags:
            return m.group(0)                  # [Augment]-style card text, not a citation
        frags = fragments(m.group("body"))
        for tag in tags:
            for r in _rows_for(tag, rows, resolve):
                if in_order(frags, row_haystack(r)):
                    return m.group(0)
        failures.append({"tags": tags, "quote": m.group("body")[:120]})
        gap = m.group("gap").rstrip()
        return m.group("body") + gap

    out = _QUOTE_RE.sub(repl, answer)
    if failures:
        out = re.sub(r"[ \t]+([.,;:)])", r"\1", out)
        out = re.sub(r"[ \t]{2,}", " ", out)
    return out, failures


_SENTENCE_RE = re.compile(r"[^\n]*?(?:[.!?]+(?=\s|$)|\n|$)")
_ENGINE_GROUP_RE = re.compile(r"\[([^\[\]]*\bengine:[^\[\]]*)\]")
_STAT_PAIR_RE = re.compile(r"(?<![\d/])\d+/\d+(?![\d/])")


def _engine_haystack(row):
    m = row.get("metadata") or {}
    final = m.get("final")
    blob = json.dumps(final, ensure_ascii=False) if final is not None else ""
    return blob + "\n" + (row.get("text") or "")


def check_engine_stats(answer, rows, resolve=None):
    """(answer', mismatches). A sentence citing [engine:sN] that states a stat
    pair the result's `final` does not contain loses the engine citation."""
    mismatches = []

    def fix_sentence(sent):
        groups = list(_ENGINE_GROUP_RE.finditer(sent))
        if not groups:
            return sent
        stats = _STAT_PAIR_RE.findall(_ENGINE_GROUP_RE.sub("", sent))
        if not stats:
            return sent

        def repl(g):
            kept = []
            for part in (p.strip() for p in re.split(r"[;,]", g.group(1))):
                if not part.startswith("engine:"):
                    kept.append(part)
                    continue
                rs = _rows_for(part, rows, resolve)
                hay = "\n".join(_engine_haystack(r) for r in rs)
                missing = [s for s in stats if not re.search(rf"(?<![\d/]){re.escape(s)}(?![\d/])", hay)]
                if missing or not rs:
                    mismatches.append({"tag": part, "stats": missing or stats})
                else:
                    kept.append(part)
            return f"[{'; '.join(kept)}]" if kept else ""

        return _ENGINE_GROUP_RE.sub(repl, sent)

    out = "".join(fix_sentence(s) for s in _SENTENCE_RE.findall(answer))
    if mismatches:
        out = re.sub(r"[ \t]+([.,;:)])", r"\1", out)
        out = re.sub(r"[ \t]{2,}", " ", out)
    return out, mismatches


def check(answer, rows, resolve=None):
    """Both checks. Returns (answer', {"quote_fail": [...], "engine_mismatch": [...]})
    with only the non-empty lists present."""
    out, qf = check_quotes(answer, rows, resolve)
    out, em = check_engine_stats(out, rows, resolve)
    report = {}
    if qf:
        report["quote_fail"] = qf
    if em:
        report["engine_mismatch"] = em
    return out, report
