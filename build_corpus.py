#!/usr/bin/env python3
"""
build_corpus.py — Turn the Algomancy data into a single embeddings-ready JSONL.

Produces  corpus/algomancy_corpus.jsonl  with one JSON object per chunk:

    {
      "id":            stable unique id, e.g. "card:Abduct" or "manual:0007",
      "text":          the text to embed,
      "source":        file/dataset the chunk came from,
      "source_type":   "card" | "rulebook" | "glossary" | "article" | "devlog",
      "authority":     int, 1 = most authoritative (see AUTHORITY below),
      "authority_label": human label for the tier,
      "outdated_risk": bool, source predates final rules,
      "title":         card name / section heading / glossary term,
      "metadata":      source-specific structured fields (card stats, heading path…),
      "char_count":    len(text),
      "approx_tokens": rough token estimate (chars // 4),
    }

Run:  python3 build_corpus.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CARDS_JSON = ROOT / "AlgomancyCards" / "AlgomancyCards-OracleText.json"
RULES = ROOT / "Rules"
OUT_DIR = ROOT / "corpus"
OUT_FILE = OUT_DIR / "algomancy_corpus.jsonl"

# Prose chunking targets (characters). ~4 chars/token => ~400 tokens, ~50 overlap.
MAX_CHARS = 1600
OVERLAP_CHARS = 200

# Authority registry: lower number = prefer when sources conflict.
# Mirrors Rules/README.md "Authority & recency" ranking.
AUTHORITY = {
    "discord_ruling": (0, "Discord ruling (definitive)"),
    "card":          (1, "canonical card data"),
    "manual":        (1, "primary rulebook"),
    "judge_ruling":  (1, "official judge ruling"),
    "glossary":      (2, "official glossary"),
    "expansion_provisional": (2, "Light & Dark provisional glossary (unofficial)"),
    "community_ruling": (2, "community Q&A (judge-confirmed)"),
    "rulebook23":    (3, "secondary rulebook (2023)"),
    "rules_web":     (4, "designer web write-up"),
    "strategy":      (4, "official strategy guide"),
    "devlog":        (5, "design blog (may be outdated)"),
}

# Ideas the designer floated in a write-up and then SCRAPPED. They read like rules
# and retrieve like rules, so leaving them in means the bot confidently teaches a
# rule that does not exist — the graft-on-top text below did exactly that, and it
# outranked the real "grafts go underneath" rule often enough to flip the answer.
# Each entry is matched literally and cut from the text at build time.
SCRAPPED_RULES = [
    # Grafts go UNDER the target card, full stop. Placing one on top so the unit
    # "becomes whatever is on top" was an experiment that never shipped.
    "(Right now I am testing allowing players to graft cards beneath or on top of "
    "other cards. If you graft on top, the creature essentially becomes whatever "
    "is on top.)",
]


def drop_scrapped(text):
    """Cut any SCRAPPED_RULES passage out of a chunk's text (see above)."""
    for dead in SCRAPPED_RULES:
        text = text.replace(dead, "")
    return re.sub(r"[ \t]{2,}", " ", text).strip()

approx_tokens = lambda s: len(s) // 4


# --------------------------------------------------------------------------- #
# Generic helpers
# --------------------------------------------------------------------------- #
def make_record(cid, text, source, source_type, auth_key, title,
                metadata=None, outdated_risk=False):
    authority, label = AUTHORITY[auth_key]
    text = drop_scrapped(text)
    return {
        "id": cid,
        "text": text,
        "source": source,
        "source_type": source_type,
        "authority": authority,
        "authority_label": label,
        "outdated_risk": outdated_risk,
        "title": title,
        "metadata": metadata or {},
        "char_count": len(text),
        "approx_tokens": approx_tokens(text),
    }


def split_prose(text, max_chars=MAX_CHARS, overlap=OVERLAP_CHARS):
    """Greedy paragraph-packing splitter with character overlap between chunks.

    Keeps whole paragraphs together when possible; only hard-splits a single
    paragraph that is itself larger than max_chars.
    """
    def word_split(s, size):
        """Split s into <=size pieces, breaking on whitespace where possible."""
        pieces = []
        while len(s) > size:
            cut = s.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size      # avoid tiny first piece
            pieces.append(s[:cut].strip())
            s = s[cut:].strip()
        if s:
            pieces.append(s)
        return pieces

    def word_tail(s, n):
        """Last ~n chars of s, snapped forward to a word boundary."""
        if len(s) <= n:
            return s
        frag = s[-n:]
        sp = frag.find(" ")
        return frag[sp + 1:] if sp != -1 else frag

    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if len(p) > max_chars:                       # oversized single paragraph
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.extend(word_split(p, max_chars))
            continue
        candidate = f"{cur}\n\n{p}" if cur else p
        if len(candidate) <= max_chars:
            cur = candidate
        else:
            chunks.append(cur)
            tail = word_tail(cur, overlap) if overlap else ""
            cur = f"{tail}\n\n{p}".strip() if tail else p
    if cur:
        chunks.append(cur)
    return [c.strip() for c in chunks if c.strip()]


# --------------------------------------------------------------------------- #
# Cards
# --------------------------------------------------------------------------- #
def render_card(c):
    """One readable text blob per card record."""
    lines = [c.get("name", "").strip()]
    if c.get("type"):
        lines.append(c["type"].strip())

    stat_bits = []
    cost = c.get("cost", "").strip()
    total = c.get("total_cost", "").strip()
    if cost or total:
        cost_str = f"Cost: {cost or '—'}"
        if total:
            cost_str += f" (total {total})"
        stat_bits.append(cost_str)
    if c.get("power") or c.get("toughness"):
        stat_bits.append(f"Power/Toughness: {c.get('power','?')}/{c.get('toughness','?')}")
    if stat_bits:
        lines.append(" | ".join(stat_bits))

    meta_bits = []
    if c.get("factions"):
        meta_bits.append("Factions: " + ", ".join(c["factions"]))
    if c.get("complexity"):
        meta_bits.append(f"Complexity: {c['complexity']}")
    if c.get("Deck"):
        meta_bits.append(f"Deck: {c['Deck']}")
    if meta_bits:
        lines.append(" | ".join(meta_bits))

    if c.get("text"):
        lines.append("")
        lines.append(c["text"].strip())
    if c.get("details"):
        lines.append("")
        lines.append(c["details"].strip())
    if c.get("rulings"):
        lines.append("")
        rulings = c["rulings"]
        if isinstance(rulings, list):
            rulings = "\n".join(str(r) for r in rulings)
        lines.append("Rulings:\n" + str(rulings).strip())
    return "\n".join(lines)


def build_cards():
    data = json.loads(CARDS_JSON.read_text())
    records, skipped = [], 0
    seen = {}
    for name, entries in data.items():
        if not isinstance(entries, list):
            entries = [entries]
        for c in entries:
            # Skip placeholder cards with no art + no rules (the KSX stubs).
            if not c.get("text", "").strip() and not c.get("type", "").strip():
                skipped += 1
                continue
            cname = c.get("name", name).strip()
            seen[cname] = seen.get(cname, 0) + 1
            cid = f"card:{cname}" + (f"#{seen[cname]}" if seen[cname] > 1 else "")
            meta = {
                "name": cname,
                "cost": c.get("cost", ""),
                "total_cost": c.get("total_cost", ""),
                "type": c.get("type", ""),
                "power": c.get("power", ""),
                "toughness": c.get("toughness", ""),
                "factions": c.get("factions", []),
                "complexity": c.get("complexity", ""),
                "deck": c.get("Deck", ""),
                "side": c.get("Side", ""),
                "has_rulings": bool(c.get("rulings")),
            }
            records.append(make_record(
                cid, render_card(c), "AlgomancyCards-OracleText.json",
                "card", "card", cname, meta))
    print(f"  cards: {len(records)} chunks ({skipped} placeholder stubs skipped)")
    return records


# --------------------------------------------------------------------------- #
# Glossary — one chunk per term
# --------------------------------------------------------------------------- #
def build_glossary():
    raw = (RULES / "Algomancy-Rules-Glossary.md").read_text()
    # Drop code-fence lines and the wp-block marker; normalise bold term markers.
    raw = re.sub(r"```.*", "", raw)
    raw = raw.replace("wp-block-preformatted", "")
    raw = re.sub(r"\*\*(.+?):\*\*", r"\1:", raw)        # **Term:** -> Term:
    records = []
    term_re = re.compile(r"^([A-Z][A-Za-z /+()-]{1,40}):\s")
    for para in re.split(r"\n\s*\n", raw):
        para = para.strip()
        if not para:
            continue
        m = term_re.match(para)
        term = m.group(1).strip() if m else para.split(":", 1)[0][:40]
        cid = "glossary:" + re.sub(r"[^A-Za-z0-9]+", "-", term).strip("-").lower()
        records.append(make_record(
            cid, para, "Algomancy-Rules-Glossary.md", "glossary",
            "glossary", term, {"term": term}))
    print(f"  glossary: {len(records)} terms")
    return records


def build_expansion_glossary():
    """Light & Dark terms — same Term: definition shape, but provisional.

    The intro prose above the first term is skipped; only "Term: ..." paragraphs
    become chunks, each tagged so the bot can say the definition is unofficial.
    """
    path = RULES / "Light-and-Dark-Provisional-Glossary.md"
    if not path.exists():
        return []
    raw = path.read_text()
    term_re = re.compile(r"^([A-Z][A-Za-z /+()-]{1,40}):\s")
    records = []
    for para in re.split(r"\n\s*\n", raw):
        para = " ".join(para.strip().split())
        m = term_re.match(para)
        if not m:
            continue
        term = m.group(1).strip()
        cid = "ld-glossary:" + re.sub(r"[^A-Za-z0-9]+", "-", term).strip("-").lower()
        records.append(make_record(
            cid, para, "Light-and-Dark-Provisional-Glossary.md",
            "glossary", "expansion_provisional",
            f"{term} (Light & Dark, provisional)",
            {"term": term, "expansion": "Light & Dark", "provisional": True},
            outdated_risk=True))
    print(f"  L&D glossary: {len(records)} terms")
    return records


# --------------------------------------------------------------------------- #
# Markdown docs — heading-aware
# --------------------------------------------------------------------------- #
# Web-extraction noise: failed embeds become "An error occurred." headings and
# promo/footer links leak into the article body.
MD_NOISE_HEADING = re.compile(
    r"^(an error occurred\.?|loading\.\.\.|advertisement|share this:?)\s*$", re.I)
MD_NOISE_LINE = re.compile(
    r"^\[(subscribe|sign up|click here|follow us|share)[^\]]*\]\(", re.I)


def build_markdown(path, source_type, auth_key, outdated_risk, id_prefix):
    text = path.read_text()
    lines = text.splitlines()
    sections, heading_stack, buf = [], [], []
    cur_title = path.stem

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append((" > ".join(heading_stack) or cur_title, body))

    for ln in lines:
        m = re.match(r"^(#{1,6})\s+(.*)", ln)
        if m and MD_NOISE_HEADING.match(m.group(2).strip()):
            continue                                  # drop spurious noise heading
        if MD_NOISE_LINE.match(ln.strip()):
            continue                                  # drop promo/footer link line
        if m:
            flush()
            buf = []
            level = len(m.group(1))
            title = m.group(2).strip()
            heading_stack = heading_stack[:level - 1]
            while len(heading_stack) < level - 1:
                heading_stack.append("")
            heading_stack = heading_stack[:level - 1] + [title]
        else:
            buf.append(ln)
    flush()

    records, n = [], 0
    for title, body in sections:
        for piece in split_prose(body):
            n += 1
            full = f"{title}\n\n{piece}" if title and not piece.startswith(title) else piece
            records.append(make_record(
                f"{id_prefix}:{n:04d}", full, path.name, source_type,
                auth_key, title, {"heading": title}, outdated_risk))
    print(f"  {path.name}: {len(records)} chunks")
    return records


# --------------------------------------------------------------------------- #
# Rulebook PDFs — column-aware re-extraction + size chunking
# --------------------------------------------------------------------------- #
# The Manual is a dense multi-column layout (up to 3 body columns plus callout
# boxes). Plain reading-order `pdftotext` interleaves those columns and shatters
# paragraphs mid-sentence — e.g. the "Additional costs: … brackets …" rule was
# split across a column boundary and made unretrievable. We instead extract with
# PyMuPDF at the *block* (paragraph) level and sort blocks column-aware: cluster
# by x-position into column bands, read each band top-to-bottom, bands
# left-to-right. That keeps every paragraph intact even on infographic pages.
try:
    import fitz  # PyMuPDF — build-time only (not needed by the running bot)
except ImportError:
    fitz = None

# Leftover page furniture after block extraction: page numbers, running
# headers/footers ("… alGomancy …", "_Running Header_"), decorative bars.
NOISE_RE = re.compile(
    r"^\s*(\d{1,3}|alGomancy.*|.*_ ?algomancy.*|[A-Z][a-z]+ ?_ ?algomancy.*)\s*$"
)
FURNITURE_RE = re.compile(
    r"^[_\sxX]+$"                       # decorative bars like "_xxxxxxxxx_"
    r"|^_.*_$"                          # running header/footer wrapped in "_"
    r"|algomancy\s+Game\s+Components",  # page footer "N algomancy Game Components_"
    re.I)
# A contents/index block: several "<page-no> <Heading>" pairs and no real prose.
TOC_RE = re.compile(r"\b\d{1,3}\s+[A-Z][a-z]+")
COLUMN_GAP = 55           # pt; an x0 gap wider than this starts a new column band


def _clean_block(txt):
    """Normalise one extracted block: rejoin soft-hyphen line breaks (dam­\\nage
    -> damage), drop control glyphs and the decorative leading "_" section marker,
    collapse the block onto flowing lines."""
    txt = re.sub(r"\xad\s*", "", txt)                              # soft hyphens
    txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", txt)     # control glyphs
    txt = txt.replace("\n", " ")
    txt = re.sub(r"^_+\s*", "", txt)                              # decorative "_ "
    return re.sub(r"[ \t]{2,}", " ", txt).strip()


def _is_furniture(block):
    """True for non-content blocks: decorative bars, running headers/footers, and
    table-of-contents / index listings (which otherwise outrank real rules text).
    TOC blocks are "<page-no> <Heading>" runs with no sentence punctuation — the
    period test keeps real combat-math prose (which also has numbers) safe."""
    if not block or FURNITURE_RE.match(block) or NOISE_RE.match(block):
        return True
    return len(TOC_RE.findall(block)) >= 3 and block.count(".") <= 1


def _columns_sorted(page):
    """Text blocks of a page in column-aware reading order (column, then y)."""
    tb = [b for b in page.get_text("blocks")
          if (len(b) < 7 or b[6] == 0) and b[4].strip()]
    if not tb:
        return []
    xs = sorted({round(b[0]) for b in tb})
    bands = [[xs[0]]]
    for x in xs[1:]:
        if x - bands[-1][-1] > COLUMN_GAP:
            bands.append([])
        bands[-1].append(x)

    def band_of(x):
        rx = round(x)
        for i, band in enumerate(bands):
            if band[0] - 1 <= rx <= band[-1] + 1:
                return i
        return len(bands)

    return sorted(tb, key=lambda b: (band_of(b[0]), b[1]))


def _extract_pdf_pymupdf(pdf_path):
    doc = fitz.open(str(pdf_path))
    blocks = []
    for page in doc:
        for b in _columns_sorted(page):
            block = _clean_block(b[4])
            if _is_furniture(block):
                continue
            blocks.append(block)
    doc.close()
    return re.sub(r"\n{3,}", "\n\n", "\n\n".join(blocks))


def _extract_pdf_pdftotext(pdf_path):
    """Fallback: pdftotext in reading order (no -layout), light noise filtering.
    Interleaves multi-column pages — only used if PyMuPDF isn't installed."""
    out = subprocess.run(
        ["pdftotext", str(pdf_path), "-"],
        capture_output=True, text=True, check=True).stdout
    out = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", out)
    kept = []
    for ln in out.splitlines():
        s = ln.strip()
        if not s:
            kept.append("")
            continue
        if NOISE_RE.match(s):
            continue
        kept.append(s)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept))


def extract_pdf_text(pdf_path):
    """Column-aware PDF text (PyMuPDF); falls back to pdftotext if unavailable."""
    if fitz is not None:
        return _extract_pdf_pymupdf(pdf_path)
    print("  [warn] PyMuPDF not installed — falling back to pdftotext "
          "(multi-column pages may be garbled). `pip install pymupdf` to fix.")
    return _extract_pdf_pdftotext(pdf_path)


def build_rulebook(pdf_path, source_name, auth_key, id_prefix, outdated_risk=False):
    if not pdf_path.exists():
        print(f"  [skip] {pdf_path.name} not found")
        return []
    text = extract_pdf_text(pdf_path)
    chunks = split_prose(text)
    records = [
        make_record(f"{id_prefix}:{i:04d}", ch, source_name, "rulebook",
                    auth_key, source_name, {}, outdated_risk)
        for i, ch in enumerate(chunks, 1)
    ]
    print(f"  {pdf_path.name}: {len(records)} chunks (column-aware re-extraction)")
    return records


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    if not CARDS_JSON.exists():
        sys.exit(f"Cards JSON not found at {CARDS_JSON}")
    OUT_DIR.mkdir(exist_ok=True)

    all_records = []
    print("Building corpus…")
    all_records += build_cards()
    all_records += build_glossary()
    all_records += build_expansion_glossary()

    all_records += build_rulebook(
        RULES / "Algomancy-Manual.pdf", "Algomancy-Manual", "manual", "manual")
    all_records += build_rulebook(
        RULES / "Algomancy-Rulebook-2023-07.pdf", "Algomancy-Rulebook-2023-07",
        "rulebook23", "rulebook23")

    all_records += build_markdown(
        RULES / "The-Rules-of-Algomancy.md", "article", "rules_web",
        True, "rules_web")          # flagged OBSOLETE at top of file
    all_records += build_markdown(
        RULES / "Mastering-Initiative-Strategy-Guide.md", "article", "strategy",
        False, "strategy")
    for dl in sorted(RULES.glob("DevLog-*.md")):
        all_records += build_markdown(dl, "devlog", "devlog", True, dl.stem.lower())
    all_records += build_markdown(
        RULES / "The-Making-of-Algomancy.md", "devlog", "devlog", True, "making-of")

    from build_rulings import build_rulings  # local import avoids circular load
    all_records += build_rulings()

    with OUT_FILE.open("w") as f:
        for r in all_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Summary
    by_type, by_auth, toks = {}, {}, 0
    for r in all_records:
        by_type[r["source_type"]] = by_type.get(r["source_type"], 0) + 1
        by_auth[r["authority"]] = by_auth.get(r["authority"], 0) + 1
        toks += r["approx_tokens"]
    print(f"\nWrote {len(all_records)} chunks -> {OUT_FILE.relative_to(ROOT)}")
    print(f"  by source_type: {dict(sorted(by_type.items()))}")
    print(f"  by authority:   {dict(sorted(by_auth.items()))}")
    print(f"  ~{toks:,} total tokens (est.)")


if __name__ == "__main__":
    main()
