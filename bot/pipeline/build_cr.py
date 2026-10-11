#!/usr/bin/env python3
"""
build_cr.py — the Unofficial Comprehensive Rules as corpus chunks.

Reads data/comprehensive-rules/Algomancy-Comprehensive-Rules.json (paths.CR_JSON),
the machine-readable edition `npm --prefix client run cr:render` writes, and
turns it into retrievable chunks for build_corpus.py. Python never re-numbers
anything: every number, and every cross-reference inside a rule's text, comes
out of the renderer already resolved.

THE CHUNK. One per numbered rule, carrying its subrules and the examples the
document prints, headed by its chapter and section titles — the unit a judge
cites. A rule whose subrules would take it past ~600 tokens is cut between
subrules, and each later piece repeats the head rule's opening so it still
reads on its own. Glossary rows are small chunks of their own. Chunk ids are
`cr:<number of the first rule in it>` (`cr:608.2`, `cr:608.2d`, `cr:D6.16`) and
`cr:<glossary key>` (`cr:glossary.adjacent`).

THE AUTHORITY. The CR is OURS: it describes what the digital client enforces and
does not speak for the game (its README says so first). So it ranks BELOW the
designer's word and level with, never above, the Manual — see the AUTHORITY rows
in build_corpus.py and memory "raq-is-the-authority". Within it, three tiers:

    cr          basis printed / designer / mixed       -> 1  (sourced in print or by Caleb)
    cr_owner    basis owner / engine                   -> 2  "unofficial — owner call"
    cr_digital  scope digital, or any Annex D rule      -> 2  "digital-client convention"

A chunk never mixes tiers: a rule whose subrules differ in tier is cut where the
tier changes, so a label always tells the truth about every line under it.

A rule with an open tier-1 discrepancy (a question waiting on the owner) is
marked in its text, and so is one the online client currently plays differently
(engineDiffers) or that verification only partly confirmed.

SCOPE. Each row's `scope` comes from the JSON (the record's own field). Until
the records carry it, ALGO_CR_SCOPE_OVERRIDE may name a JSON file of
{key: {"scope": "game"|"digital"|...}} for a LOCAL experiment — it is read only
when that variable is set, and nothing committed depends on it.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))

import json
import os
from pathlib import Path

from paths import CR_JSON

# ~600 tokens at the corpus's 4 chars/token. A single rule longer than this on
# its own (with its examples) stays whole: cutting a rule mid-sentence would
# make a chunk that states half a rule.
CR_MAX_CHARS = 2400
# How much of the head rule a continuation piece repeats, for context.
HEAD_REPEAT_CHARS = 220

SOURCE = "Algomancy-Comprehensive-Rules.json"
SOURCE_TYPE = "cr"


def authority_key(row: dict, scope_override: dict | None = None) -> str:
    """The build_corpus.AUTHORITY key for one rule row."""
    scope = row.get("scope")
    if scope_override and row.get("key") in scope_override:
        scope = scope_override[row["key"]].get("scope", scope)
    if scope == "digital" or str(row.get("num", "")).startswith("D"):
        return "cr_digital"
    if row.get("basis") in ("owner", "engine"):
        return "cr_owner"
    return "cr"


def _rule_lines(row: dict) -> list[str]:
    head = row["num"] + (f" {row['title']}." if row.get("title") else "")
    text = row.get("text") or ""
    see = row.get("see") or []
    if see:
        text += f" See rule{'s' if len(see) > 1 else ''} {', '.join(see)}."
    lines = [f"{head} {text}".rstrip()]
    for ex in row.get("examples") or []:
        lines.append(f"  Example: {ex}")
    if row.get("openQuestion"):
        lines.append(f"  [Open question: the owner has not yet chosen between two readings of "
                     f"{row['num']}; treat this rule as unsettled.]")
    if row.get("engineDiffers"):
        lines.append(f"  [The online client currently plays {row['num']} differently; a fix is filed.]")
    if row.get("verdict") in ("partial", "contradicted", "unsupported"):
        lines.append(f"  [Verification of {row['num']} was only {row['verdict']}.]")
    return lines


def _header(row: dict) -> str:
    return (f"Comprehensive Rules (unofficial) · {row['chapterTitle']} › "
            f"{row['section']}. {row['sectionTitle']}")


def _groups(rows: list[dict]) -> list[list[dict]]:
    """Rows grouped as [top-level rule, its subrules…] in document order."""
    groups: list[list[dict]] = []
    for r in rows:
        if r["parent"] == r["section"] or not groups or groups[-1][0]["num"] != r["parent"]:
            groups.append([r])
        else:
            groups[-1].append(r)
    return groups


def chunk_rows(rows: list[dict], make_record, *, scope_override=None,
               max_chars: int = CR_MAX_CHARS) -> list[dict]:
    """Rule rows -> corpus records (see the module docstring)."""
    out = []
    for group in _groups(rows):
        head = group[0]
        pieces: list[list[dict]] = []
        cur: list[dict] = []
        cur_len, cur_auth = 0, None
        for r in group:
            auth = authority_key(r, scope_override)
            size = sum(len(x) + 1 for x in _rule_lines(r))
            if cur and (auth != cur_auth or cur_len + size > max_chars):
                pieces.append(cur)
                cur, cur_len = [], 0
            cur.append(r)
            cur_len += size
            cur_auth = auth
        if cur:
            pieces.append(cur)
        for piece in pieces:
            first = piece[0]
            auth = authority_key(first, scope_override)
            lines = [_header(head)]
            if first is not head:
                opening = head.get("text") or head.get("title") or ""
                if len(opening) > HEAD_REPEAT_CHARS:
                    opening = opening[:HEAD_REPEAT_CHARS].rsplit(" ", 1)[0] + "…"
                lines.append(f"(continues {head['num']}: {opening})")
            for r in piece:
                lines.extend(_rule_lines(r))
            nums = [r["num"] for r in piece]
            title = f"CR {nums[0]}" + (f"–{nums[-1]}" if len(nums) > 1 else "")
            meta = {
                "kind": "rule",
                "num": first["num"],
                "nums": nums,
                "keys": [r["key"] for r in piece],
                "section": head["section"],
                "section_title": head["sectionTitle"],
                "scope": "digital" if auth == "cr_digital" else "game",
                "basis": sorted({r.get("basis") or "" for r in piece} - {""}),
                "open_question": any(r.get("openQuestion") for r in piece),
                "engine_differs": any(r.get("engineDiffers") for r in piece),
                "discrepancies": sorted({d for r in piece for d in r.get("discrepancies") or []}),
            }
            out.append(make_record(f"cr:{first['num']}", "\n".join(lines), SOURCE, SOURCE_TYPE,
                                   auth, title, meta))
    return out


def chunk_glossary(glossary: list[dict], rows_by_num: dict, make_record,
                   *, scope_override=None) -> list[dict]:
    """One small chunk per glossary row, in the tier of the rule it points at."""
    out = []
    for g in glossary:
        see = g.get("see") or []
        target = rows_by_num.get(see[0]) if see else None
        auth = authority_key(target, scope_override) if target else "cr"
        text = (f"Comprehensive Rules (unofficial) · Glossary\n"
                f"{g['term']}{' (Obsolete)' if g.get('obsolete') else ''}: {g['text']}"
                + (f" See rule{'s' if len(see) > 1 else ''} {', '.join(see)}." if see else ""))
        meta = {"kind": "glossary", "term": g["term"], "gloss_key": g["key"],
                "nums": list(see), "keys": [], "section": None,
                "scope": "digital" if auth == "cr_digital" else "game",
                "obsolete": bool(g.get("obsolete"))}
        out.append(make_record(f"cr:{g['key']}", text, SOURCE, SOURCE_TYPE, auth,
                               f"CR glossary: {g['term']}", meta))
    return out


def _scope_override():
    path = os.environ.get("ALGO_CR_SCOPE_OVERRIDE")
    if not path:
        return None
    data = json.loads(Path(path).read_text())
    print(f"  [cr] LOCAL scope override from {path}: {len(data)} keys (not for a committed build)")
    return data


def build_cr(path=CR_JSON, *, scope_override=None):
    """Every CR chunk: the numbered rules, Annex D, the glossary."""
    from build_corpus import make_record   # local import, as build_rulings does
    path = Path(path)
    if not path.exists():
        print(f"  [skip] {path.name} not found — run: npm --prefix client run cr:render")
        return []
    doc = json.loads(path.read_text())
    if scope_override is None:
        scope_override = _scope_override()
    rows = doc["rules"] + doc["annexD"]
    by_num = {r["num"]: r for r in rows}
    recs = (chunk_rows(doc["rules"], make_record, scope_override=scope_override)
            + chunk_rows(doc["annexD"], make_record, scope_override=scope_override)
            + chunk_glossary(doc["glossary"], by_num, make_record, scope_override=scope_override))
    tiers = {}
    for r in recs:
        k = r["authority_label"]
        tiers[k] = tiers.get(k, 0) + 1
    print(f"  CR {doc['edition']['name']} ({doc['generated_from']}): {len(rows)} rules + "
          f"{len(doc['glossary'])} glossary rows -> {len(recs)} chunks {tiers}")
    return recs
