"""tools.py — the judge's lookup tools: rule, define, card, search. No LLM, no network.

WHY THIS EXISTS
---------------
The owner, 2026-11-01: "let the system do some sort of calculation in the
engine, using tools, rather than try to force it to think." The judge answers
from a retrieved slate of ten passages; when the slate lacks the rule a
question turns on, the model fills the gap from its own words — and his chief
fear is a hallucinated rule. These four tools let it LOOK THE THING UP instead:
the exact text of a numbered rule with its status, a term's CR definition with
the rule that defines it, a card's oracle text beside what the online client
actually plays, and a targeted search. Design: the round's judge-tools-design.md
§1 Phase 1.

THE INTERFACE (frozen with core.py's tool loop)
-----------------------------------------------
    TOOLS                       OpenAI-style function schemas, one per tool
    dispatch(name, args)        -> (text, row)

`text` is what the model reads (≤ ~600 tokens, MAX_TEXT_CHARS). `row` is a
corpus-shaped row (id, source_type, title, text, source, authority,
authority_label, metadata — the shape build_corpus.make_record writes), so
core.render_citations / core.resolve_citation cite it unchanged.

⚠ ONE CALL CAN PRINT SEVERAL CITABLE SOURCES. `define` prints the glossary row
AND its defining rule; `card` prints the card AND up to three rulings; `search`
prints five hits. The model may cite any of them, so the main row carries the
others under `row["extra_rows"]`. Collect with `citable_rows(row)`, which
flattens them and drops the error marker — appending `row` alone still works,
it just leaves the extra tags unresolvable (render_citations drops those).

⚠ AN ERROR IS A ROW TOO. Unknown tool, bad or missing args, no such rule: the
text says so in a line, and the row is a harmless marker (`metadata.error`,
id "tool:error") that citable_rows() leaves out. dispatch() never raises.

DATA. Everything loads once, lazily, on the first call (threading.Lock: the
loop runs lookups through asyncio.to_thread): CR_JSON (text, examples, see,
the flags), the rule records CR_RECORDS_DIR (sources, the owner's adoption
dates, engineDiffers ids), the findings and discrepancies, PRINTED_JSON (the
engine's pool). Cards, rulings and search come off core's own CardIndex and
Retriever — imported inside the functions, because core imports this module.
Row text for a rule is rendered by the corpus builder's own functions
(pipeline/build_cr.py), so a tool row reads exactly like a retrieved chunk.
"""

from __future__ import annotations

import bisect
import difflib
import json
import re
import sys
import threading
from pathlib import Path

import crnotes
import terms
from paths import (BOT_DIR, CR_DISCREPANCIES_DIR, CR_FINDINGS_DIR, CR_JSON,
                   CR_RECORDS_DIR, PRINTED_JSON)

# pipeline/build_cr.py renders a CR row's corpus text and picks its authority
# tier; build_corpus.py owns the AUTHORITY table and make_record. Both are pure
# and cheap to import (no I/O at module level); only their functions are used.
if str(BOT_DIR / "pipeline") not in sys.path:
    sys.path.insert(0, str(BOT_DIR / "pipeline"))

#: the model reads at most this much of one result (~600 tokens at 4 chars/token)
MAX_TEXT_CHARS = 2400
#: longest argument string accepted; a rule number or a card name is short
MAX_ARG_CHARS = 200
#: search: hits returned, and the snippet width of each
SEARCH_K = 5
SNIPPET_CHARS = 300
#: card: ruling snippets shown, and their width
CARD_RULINGS = 3
RULING_SNIPPET_CHARS = 230
#: search `types` -> corpus source_types ("rulebook" means the official prose)
SEARCH_TYPES = {
    "cr": ("cr",),
    "card": ("card",),
    "ruling": ("ruling",),
    "rulebook": ("rulebook", "glossary"),
}

TOOLS = [
    {"type": "function", "function": {
        "name": "rule",
        "description": ("Exact text of a Comprehensive Rules rule by number (\"700.1a\", \"D6.4\"), "
                        "with examples, cross-refs, subrules and a STATUS line. Cite as [cr:<num>]."),
        "parameters": {"type": "object", "properties": {
            "num": {"type": "string", "description": "rule number, e.g. 608.2b"}},
            "required": ["num"], "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "define",
        "description": ("The Comprehensive Rules definition of a game term (\"spell effect\", "
                        "\"adjacent\") plus the rule that defines it."),
        "parameters": {"type": "object", "properties": {
            "term": {"type": "string"}},
            "required": ["term"], "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "card",
        "description": ("A card's oracle text, what the online client's engine plays for it, "
                        "and up to 3 rulings. Cite as [card:<Name>]."),
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}},
            "required": ["name"], "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "search",
        "description": "Search the rules corpus; returns 5 snippets with their citation ids.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"},
            "types": {"type": "array", "items": {"type": "string", "enum": list(SEARCH_TYPES)},
                      "description": "limit to these sources"}},
            "required": ["query"], "additionalProperties": False}}},
]

TOOL_NAMES = tuple(t["function"]["name"] for t in TOOLS)


# ── data, loaded once ────────────────────────────────────────────────────────

class _Data:
    """Everything the four tools read, built once on the first call."""

    def __init__(self):
        import build_corpus
        import build_cr
        self.build_cr, self.build_corpus = build_cr, build_corpus
        doc = json.loads(Path(CR_JSON).read_text(encoding="utf-8"))
        self.cr_source = Path(CR_JSON).name
        self.rules = doc["rules"] + doc["annexD"]
        self.by_num = {r["num"]: r for r in self.rules}
        self.by_key = {r["key"]: r for r in self.rules}
        self.children: dict[str, list[str]] = {}
        for r in self.rules:
            self.children.setdefault(r["parent"], []).append(r["num"])
        # a section ("802", "D6") is a parent that is not itself a rule
        self.sections = {r["section"]: (r["chapterTitle"], r["sectionTitle"]) for r in self.rules}
        self.order = sorted(self.by_num, key=_num_sort_key)
        self.order_keys = [_num_sort_key(x) for x in self.order]
        self.glossary = doc["glossary"]
        self.records = _read_dir(CR_RECORDS_DIR, "U*.json", key="key")
        self.findings = _read_dir(CR_FINDINGS_DIR, "U*.json", key="id")
        self.discrepancies = _read_dir(CR_DISCREPANCIES_DIR, "U*.json", key="id")
        self.printed = json.loads(Path(PRINTED_JSON).read_text(encoding="utf-8"))
        self.glossary_terms = sorted(
            ((g["term"], terms._pattern(g["term"]), g) for g in self.glossary),
            key=lambda t: -len(t[0]))


def _read_dir(path, pattern, key):
    out = {}
    for f in sorted(Path(path).glob(pattern)):
        for item in json.loads(f.read_text(encoding="utf-8")):
            if isinstance(item, dict) and item.get(key):
                out[item[key]] = item
    return out


_DATA: _Data | None = None
_LOCK = threading.Lock()


def data() -> _Data:
    global _DATA
    if _DATA is None:
        with _LOCK:
            if _DATA is None:
                _DATA = _Data()
    return _DATA


# ── rule numbers ─────────────────────────────────────────────────────────────

_NUM_RE = re.compile(r"^(?:cr|rule|rules)?[\s:#]*([dD]?\d+(?:\.\d+[a-zA-Z]*)?)\.?$", re.I)


def _norm_num(raw: str) -> str | None:
    """"CR 700.1A" / "rule 700.1a" / "cr:700.1a" / "d6.4" -> "700.1a" / "D6.4"."""
    m = _NUM_RE.match(raw.strip())
    if not m:
        return None
    n = m.group(1)
    head, _, tail = n.partition(".")
    head = head.upper()
    return f"{head}.{tail.lower()}" if tail else head


def _num_sort_key(num: str):
    """Document order: 100.1 < 100.1a < 100.2 < 101 ... < D1.1."""
    annex = num.startswith("D")
    head, _, tail = num.lstrip("D").partition(".")
    m = re.match(r"(\d*)([a-z]*)", tail)
    return (annex, int(head or 0), int(m.group(1) or 0) if m else 0, m.group(2) if m else "")


def _nearest(num: str, n: int = 4) -> list[str]:
    """The live rule numbers nearest an unknown one, for "did you mean"."""
    d = data()
    try:
        key = _num_sort_key(num)
    except (ValueError, AttributeError):
        return difflib.get_close_matches(num, d.order, n=n)
    i = bisect.bisect_left(d.order_keys, key)
    return d.order[max(0, i - n // 2): i + (n - n // 2)]


# ── rows ─────────────────────────────────────────────────────────────────────

def _error(msg: str) -> tuple[str, dict]:
    row = {"id": "tool:error", "text": msg, "source": "tools", "source_type": "tool",
           "authority": 9, "authority_label": "tool error", "outdated_risk": False,
           "title": "tool error", "metadata": {"error": True}}
    return msg, row


def citable_rows(row: dict | None) -> list[dict]:
    """Every row a tool result printed that the model may cite: the row itself
    and its `extra_rows`, flattened; an error marker or None gives []."""
    if not isinstance(row, dict) or (row.get("metadata") or {}).get("error"):
        return []
    out = [{k: v for k, v in row.items() if k != "extra_rows"}]
    for extra in row.get("extra_rows") or []:
        out.extend(citable_rows(extra))
    return out


def _owner_adopted(rec: dict) -> str | None:
    dates = [o.get("adopted") for o in (rec.get("sources") or {}).get("owner") or [] if o.get("adopted")]
    return max(dates) if dates else None


def rule_row(r: dict) -> dict:
    """A corpus-shaped row for ONE rule (no subrules), its text rendered by
    build_cr exactly as the corpus renders it; metadata carries every flag."""
    d = data()
    rec = d.records.get(r["key"]) or {}
    auth = d.build_cr.authority_key(r)
    text = d.build_cr._header(r) + "\n" + "\n".join(d.build_cr._rule_lines(r))
    meta = {
        "kind": "rule", "num": r["num"], "nums": [r["num"]], "keys": [r["key"]],
        "section": r["section"], "section_title": r["sectionTitle"],
        "scope": "digital" if auth == "cr_digital" else "game",
        "basis": [r["basis"]] if r.get("basis") else [],
        "open_question": bool(r.get("openQuestion")),
        "engine_differs": bool(r.get("engineDiffers")),
        "discrepancies": list(r.get("discrepancies") or []),
        # beyond the corpus row's fields: what the STATUS line is made of
        "engine_differs_ids": list(rec.get("engineDiffers") or []),
        "verdict": r.get("verdict"),
        "untested": bool(r.get("untested")),
        "owner_adopted": _owner_adopted(rec),
        "tool": "rule",
    }
    return d.build_corpus.make_record(f"cr:{r['num']}", text, d.cr_source, "cr", auth,
                                      f"CR {r['num']}", meta)


def glossary_row(g: dict) -> dict:
    """The corpus row build_cr.chunk_glossary makes for one glossary entry."""
    d = data()
    rows = d.build_cr.chunk_glossary([g], d.by_num, d.build_corpus.make_record)
    row = rows[0]
    row["metadata"]["tool"] = "define"
    return row


# ── STATUS ───────────────────────────────────────────────────────────────────

BASIS_WORDS = {
    "printed": "printed (card or rulebook text)",
    "designer": "the designer's ruling",
    "engine": "engine-derived: no printed or designer source, awaiting owner sign-off",
}
#: the authority kinds a `mixed` record can mix, strongest first (the CR README's order)
MIXED_KINDS = (("designer", "designer"), ("printed", "printed"), ("owner", "owner call"),
               ("engine", "engine"))


def _clip(s: str, n: int) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[:n - 1].rsplit(" ", 1)[0] + "…"


def status_line(r: dict, row: dict | None = None) -> str:
    """The rule's standing in one line: its basis, and every flag that makes it
    a lead rather than a ruling (engineDiffers, partial, untested, digital
    scope, an open question, disagreeing sources, an open review note)."""
    d = data()
    rec = d.records.get(r["key"]) or {}
    basis = r.get("basis") or "unknown"
    when = _owner_adopted(rec)
    if basis == "owner":
        parts = [f"basis owner — unofficial owner call{', adopted ' + when if when else ''}"]
    elif basis == "mixed":
        src = rec.get("sources") or {}
        kinds = [word + (f" (adopted {when})" if k == "owner" and when else "")
                 for k, word in MIXED_KINDS if src.get(k)]
        parts = ["basis mixed" + (f": {' + '.join(kinds)}" if kinds else "")]
    else:
        parts = [f"basis {BASIS_WORDS.get(basis, basis)}"]
    ids = rec.get("engineDiffers") or []
    if r.get("engineDiffers") or ids:
        why = "; ".join(f"{i}: {_clip(d.findings.get(i, {}).get('title', ''), 110)}" for i in ids)
        parts.append("⚠ ENGINE DIFFERS — the online client currently does otherwise"
                     + (f" ({why})" if why else ""))
    if r.get("verdict") == "partial":
        parts.append("verdict partial — only partly verified against the client")
    elif r.get("verdict") not in ("confirmed", None):
        parts.append(f"verdict {r['verdict']}")
    elif r.get("verdict") is None:
        parts.append("not verified in this edition")
    if r.get("untested"):
        parts.append("untested — no executed test demonstrates it")
    if r.get("scope") == "digital" or r["num"].startswith("D"):
        parts.append("scope digital — an online-client convention, not a tabletop rule")
    if r.get("openQuestion"):
        parts.append("OPEN QUESTION — the owner has not chosen between two readings")
    for did in r.get("discrepancies") or []:
        dis = d.discrepancies.get(did) or {}
        res = dis.get("resolution")
        parts.append(f"sources disagreed ({did})" + (f", settled: {_clip(res, 120)}" if res else ""))
    for n in crnotes.NOTES.notes_for(row or rule_row(r)):
        parts.append(f"open review note ({n['role']}, {n['date']}): {_clip(n['body'], 200)}")
    return "STATUS: " + " · ".join(parts)


def _source_refs(rec: dict, limit: int = 5) -> str:
    src = rec.get("sources") or {}
    refs = [s.get("ref") for kind in ("printed", "designer") for s in src.get(kind) or [] if s.get("ref")]
    refs += [f"owner call, adopted {o['adopted']}" for o in src.get("owner") or [] if o.get("adopted")]
    refs += [f"engine: {s}" if isinstance(s, str) else f"engine: {s.get('ref', '')}"
             for s in src.get("engine") or []]
    refs = list(dict.fromkeys(refs))
    more = f" (+{len(refs) - limit} more)" if len(refs) > limit else ""
    return "; ".join(refs[:limit]) + more


def _fit(must: list[str], optional: list[tuple[int, str]], budget: int = MAX_TEXT_CHARS) -> str:
    """`must` lines always; then each (position, line) of `optional` while the
    total fits `budget`, in the order given (priority). Output is in position
    order — `must` lines take positions 0..len(must)-1 in their given order,
    unless an optional position is lower."""
    used = sum(len(s) + 1 for s in must)
    keep = []
    for pos, line in optional:
        if used + len(line) + 1 <= budget:
            keep.append((pos, line))
            used += len(line) + 1
    return "\n".join(s for _p, s in sorted(list(enumerate(must)) + keep, key=lambda x: x[0]))


# ── the tools ────────────────────────────────────────────────────────────────

def _render_rule(r: dict, budget: int = MAX_TEXT_CHARS) -> tuple[str, dict]:
    d = data()
    row = rule_row(r)
    rec = d.records.get(r["key"]) or {}
    num = r["num"]
    head = (f"[cr:{num}] CR {num}{' ' + r['title'] if r.get('title') else ''} "
            f"({r['chapterTitle']} › {r['section']}. {r['sectionTitle']})")
    text = r["text"]
    status = status_line(r, row)
    opt = []
    for i, ex in enumerate(r.get("examples") or []):
        opt.append((10 + i, f"Example: {ex}"))
    if r.get("see"):
        opt.append((40, "See: " + ", ".join(r["see"])))
    parent = r.get("parent")
    if parent in d.by_num:
        opt.append((41, f"Parent: {parent} — {_clip(d.by_num[parent]['text'], 120)}"))
    elif parent in d.sections:
        opt.append((41, f"Parent: section {parent}. {d.sections[parent][1]}"))
    kids = d.children.get(num) or []
    if kids:
        gist = [f"{k} {_clip(d.by_num[k]['text'], 70)}" for k in kids[:8]]
        more = f" (+{len(kids) - 8} more)" if len(kids) > 8 else ""
        opt.append((42, "Subrules: " + " | ".join(gist) + more))
    refs = _source_refs(rec)
    if refs:
        opt.append((43, f"Sources: {refs}"))
    # priority: status and text are musts; then see/parent, subrules, examples, sources
    order = [o for o in opt if o[0] in (40, 41)] + [o for o in opt if o[0] == 42] \
        + [o for o in opt if o[0] < 40] + [o for o in opt if o[0] == 43]
    room = budget - len(status) - 1
    out = _fit([head, text], order, room)
    # STATUS goes last and is never cut
    out = _clip_block(out, room) + "\n" + status
    return out, row


def _clip_block(s: str, n: int) -> str:
    return s if len(s) <= n else s[:max(0, n - 1)] + "…"


def _render_section(sec: str) -> tuple[str, dict]:
    d = data()
    chapter, title = d.sections[sec]
    kids = d.children.get(sec) or []
    lines = [f"[cr:{sec}] CR section {sec}. {title} ({chapter})"]
    for k in kids:
        lines.append(f"{k} {_clip(d.by_num[k]['text'], 90)}")
    text = _clip_block("\n".join(lines), MAX_TEXT_CHARS)
    rtext = f"Comprehensive Rules (unofficial) · {chapter} › {sec}. {title}\n" + "\n".join(lines[1:])
    row = d.build_corpus.make_record(
        f"cr:{sec}", rtext, d.cr_source, "cr", "cr_digital" if sec.startswith("D") else "cr",
        f"CR {sec}", {"kind": "section", "num": sec, "nums": [sec], "keys": [], "section": sec,
                      "section_title": title, "scope": "digital" if sec.startswith("D") else "game",
                      "tool": "rule"})
    return text, row


def tool_rule(num) -> tuple[str, dict]:
    if not isinstance(num, str) or not num.strip():
        return _error("rule: give a rule number, e.g. 700.1a")
    raw = num.strip()[:MAX_ARG_CHARS]
    d = data()
    if raw in d.by_key:                                  # a dotted key
        return _render_rule(d.by_key[raw])
    n = _norm_num(raw)
    if n and n in d.by_num:
        return _render_rule(d.by_num[n])
    if n and n in d.sections:
        return _render_section(n)
    near = _nearest(n) if n else []
    hint = f" Nearest: {', '.join(near)}." if near else ""
    return _error(f"No such rule: {raw}.{hint}")


def _find_term(term: str):
    """The glossary entry for `term`: a whole match of a term with the
    inflections card text uses (terms._pattern, longest term first — so
    "spell effects" is Spell effect, never Spell), then a term inside the
    phrase, then a close spelling. Returns (entry, how) or (None, suggestions)."""
    d = data()
    q = " ".join(term.split())
    for t, pat, g in d.glossary_terms:
        if pat.fullmatch(q):
            return g, "exact"
    for t, pat, g in d.glossary_terms:              # longest first
        if len(t) >= terms.MIN_TERM_LEN and pat.search(q):
            return g, "within"
    names = {t.lower(): g for t, _p, g in d.glossary_terms}
    close = difflib.get_close_matches(q.lower(), list(names), n=3, cutoff=0.75)
    if close:
        return names[close[0]], "close"
    loose = difflib.get_close_matches(q.lower(), list(names), n=3, cutoff=0.5)
    return None, [names[c]["term"] for c in loose]


def tool_define(term) -> tuple[str, dict]:
    if not isinstance(term, str) or not term.strip():
        return _error("define: give a game term, e.g. spell effect")
    q = term.strip()[:MAX_ARG_CHARS]
    d = data()
    g, how = _find_term(q)
    if g is None:
        hint = f" Close glossary terms: {', '.join(how)}." if how else ""
        return _error(f"\"{q}\" is not a term in the Comprehensive Rules glossary.{hint} "
                      "Try search.")
    row = glossary_row(g)
    lines = []
    if how != "exact":
        lines.append(f"(No glossary entry for \"{q}\"; the nearest is \"{g['term']}\".)")
    obs = " (obsolete term)" if g.get("obsolete") else ""
    lines.append(f"[cr:{g['key']}] {g['term']}{obs}: {g['text']}")
    see = g.get("see") or []
    extra = []
    if len(see) > 1:
        lines.append("Also see: " + ", ".join(see[1:]))
    if see and see[0] in d.by_num:
        # the defining rule, in the room the definition leaves (its STATUS is never cut)
        room = MAX_TEXT_CHARS - sum(len(s) + 1 for s in lines) - len("Defining rule:\n")
        rtext, rrow = _render_rule(d.by_num[see[0]], budget=room)
        extra.append(rrow)
        lines.append(f"Defining rule:\n{rtext}")
    elif see:
        lines.append("See: " + ", ".join(see))
    row["extra_rows"] = extra
    return "\n".join(lines), row


def _engine_facts(p: dict) -> str:
    bits = [p.get("kind") or "?", f"timing {p.get('timing')}"]
    cost = p.get("cost") or "none"
    bits.append(f"cost {cost} (mana {p.get('mana')})")
    if p.get("kind") == "unit" or p.get("power") or p.get("toughness"):
        bits.append(f"{p.get('power')}/{p.get('toughness')}")
    if p.get("attrs"):
        bits.append("attrs " + ", ".join(p["attrs"]))
    if p.get("augmentAttrs"):
        bits.append("grants as augment " + ", ".join(p["augmentAttrs"]))
    for flag in ("virus", "burst", "unstable"):
        if p.get(flag):
            bits.append(flag)
    if p.get("prophecy"):
        pr = p["prophecy"]
        bits.append(f"prophecy cost {pr.get('cost')} (mana {pr.get('mana')})"
                    + (f" if {pr['condition']}" if pr.get("condition") else ""))
    if p.get("ambush"):
        bits.append(f"ambush cost {p['ambush'].get('cost')} (mana {p['ambush'].get('mana')})")
    if p.get("discardMe"):
        bits.append(f"discard-me cost {p['discardMe'].get('cost') or 'none'} "
                    f"(mana {p['discardMe'].get('mana')})")
    if p.get("gainDebt"):
        bits.append(f"gain debt {p['gainDebt']}")
    return " · ".join(str(b) for b in bits)


_PART_RE = re.compile(r"\s*\(part \d+\)\s*$")


def card_rulings(name: str) -> list[dict]:
    """Ruling rows that mention `name`, one per thread, best authority first.
    The same filter as rulings.find_card_rulings — which imports discord, so
    the web app cannot reach it; test_tools.py holds the two to the same answer."""
    import core
    word = re.compile(rf"(?<!\w){re.escape(name)}(?!\w)")
    best = {}
    for r in core.retriever.rows:
        if r["source_type"] != "ruling":
            continue
        md = r.get("metadata", {})
        if name not in md.get("cards", []) and not word.search(r["text"]):
            continue
        base = r["id"].split("#")[0]
        if base not in best or r["authority"] < best[base]["authority"]:
            best[base] = r
    rows = list(best.values())
    rows.sort(key=lambda r: (r["authority"], r["title"]))
    return rows


def _ruling_snippet(row: dict, width: int = RULING_SNIPPET_CHARS) -> str:
    """A ruling's body without its title line and tails (discordui._ruling_snippet)."""
    text = row["text"]
    body = text.split("\n\n", 1)[1] if "\n\n" in text else text
    for cut in ("\nRelated cards:", "\n\n(Source:", "\n\n(Answered by"):
        i = body.find(cut)
        if i != -1:
            body = body[:i]
    return _clip(body, width)


def tool_card(name) -> tuple[str, dict]:
    if not isinstance(name, str) or not name.strip():
        return _error("card: give a card name")
    q = name.strip()[:MAX_ARG_CHARS]
    import core
    from cards import plain_text
    card, matched, alts = core.cards.lookup(q)
    if not card:
        return _error(f"No card matches \"{q}\". Try search with types [\"card\"].")
    d = data()
    lines = []
    if alts:
        lines.append(f"(Best match for \"{q}\"; also close: {', '.join(alts)}.)")
    stats = ""
    if card.get("power") not in (None, "") or card.get("toughness") not in (None, ""):
        stats = f" · {card.get('power')}/{card.get('toughness')}"
    facs = ", ".join(card.get("factions") or []) or "none"
    lines.append(f"[card:{matched}] {matched} — {card.get('type', '')} · cost {card.get('cost') or 'none'}"
                 f" (total {card.get('total_cost', '?')}){stats} · elements {facs}")
    lines.append("Text: " + (" ".join(plain_text(card.get("text", "")).split()) or "(none)"))
    p = d.printed.get(matched)
    if p:
        lines.append("Online client engine plays it as: " + _engine_facts(p))
    else:
        lines.append("Not in the online client's card pool.")
    if set(card.get("factions") or []) & {"light", "dark"}:
        lines.append("Light & Dark card: PROVISIONAL — transcribed from the card image; "
                     "no official rules release yet.")
    rrows = card_rulings(matched)[:CARD_RULINGS]
    for r in rrows:
        lines.append(f"[{r['id']}] {_clip(_PART_RE.sub('', r['title']), 90)} — {_ruling_snippet(r)}")
    if not rrows:
        lines.append("No rulings mention this card.")
    text = _clip_block("\n".join(lines), MAX_TEXT_CHARS)
    row = next((r for r in core.retriever.rows if r["id"] == f"card:{matched}"), None)
    if row is None:
        row = d.build_corpus.make_record(f"card:{matched}", "\n".join(lines[:3]),
                                         "AlgomancyCards-OracleText.json", "card", "card",
                                         matched, {"name": matched})
    row = {**row, "metadata": {**(row.get("metadata") or {}), "tool": "card"},
           "extra_rows": list(rrows)}
    return text, row


def _flag_marker(r: dict) -> str:
    m = r.get("metadata") or {}
    if r.get("source_type") != "cr":
        return ""
    flags = []
    if m.get("engine_differs"):
        flags.append("⚠ engine differs")
    if m.get("open_question"):
        flags.append("open question")
    if m.get("scope") == "digital":
        flags.append("digital")
    if any(b in ("owner", "engine") for b in m.get("basis") or []):
        flags.append("owner/engine basis")
    return f" ({'; '.join(flags)})" if flags else ""


def tool_search(query, types=None) -> tuple[str, dict]:
    if not isinstance(query, str) or not query.strip():
        return _error("search: give a query")
    q = query.strip()[:MAX_ARG_CHARS]
    if types in (None, "", []):
        want = None
    else:
        if isinstance(types, str):
            types = [types]
        if not isinstance(types, list) or not all(isinstance(t, str) for t in types):
            return _error(f"search: types must be a list of {', '.join(SEARCH_TYPES)}")
        bad = [t for t in types if t not in SEARCH_TYPES]
        if bad:
            return _error(f"search: unknown type {', '.join(bad)}; use {', '.join(SEARCH_TYPES)}")
        want = [st for t in types for st in SEARCH_TYPES[t]]
    import core
    import retriever as retr
    hits = core.retriever.search(q, k=SEARCH_K, types=want)
    if not hits:
        return _error(f"search: nothing matches \"{q}\".")
    lines = []
    rows = []
    for _s, r in hits:
        rows.append(r)
        body = r["text"]
        if r.get("source_type") == "cr" and "\n" in body:
            body = body.split("\n", 1)[1]        # the "Comprehensive Rules · chapter › section" head
        lines.append(f"[{r['id']}] {r['title']}{_flag_marker(r)}: "
                     f"{retr.snippet(body, q, width=SNIPPET_CHARS)}")
    text = _clip_block("\n".join(lines), MAX_TEXT_CHARS)
    main = {**rows[0], "extra_rows": rows[1:]}
    return text, main


_DISPATCH = {
    "rule": lambda a: tool_rule(a.get("num")),
    "define": lambda a: tool_define(a.get("term")),
    "card": lambda a: tool_card(a.get("name")),
    "search": lambda a: tool_search(a.get("query"), a.get("types")),
}


def dispatch(name: str, args) -> tuple[str, dict]:
    """Run tool `name` with `args` (a dict, or the JSON string a tool call
    carries). Returns (text for the model, corpus-shaped row). Never raises:
    an unknown tool, malformed args or an internal failure come back as one
    line of text and an error row (citable_rows() drops it)."""
    try:
        fn = _DISPATCH.get(name) if isinstance(name, str) else None
        if fn is None:
            return _error(f"Unknown tool {name!r}; the tools are {', '.join(TOOL_NAMES)}.")
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except ValueError:
                return _error(f"{name}: arguments are not valid JSON.")
        if args is None:
            args = {}
        if not isinstance(args, dict):
            return _error(f"{name}: arguments must be an object.")
        return fn(args)
    except Exception as exc:                       # a lookup must never break an answer
        return _error(f"{name}: lookup failed ({type(exc).__name__}).")
