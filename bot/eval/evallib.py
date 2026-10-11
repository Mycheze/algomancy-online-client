"""evallib.py — the pieces run.py, report.py and test_eval.py share.

Three things live here, each named once:

1. The gold set loader (`load_gold`). `gold.jsonl` beside this file is input
   data, built elsewhere and reviewed by the owner — ⚠ on 2026-10-11 it is the
   115-item DRAFT, not yet owner-approved, so no number measured against it is
   authority yet. Fields: id question expected key_points must_not evidence
   category history origin confidence notes must_cite. Re-copying it after a review
   needs no other change, because nothing here caches anything derived from it
   except the judge cache, whose key includes a hash of each item's graded
   fields (so an edited item is re-judged and an untouched one is not).

2. must_cite -> chunk matching (`parse_cite`, `cite_matches`). The ONE place
   that knows how a gold citation ("CR 608.2b", "RAQ <thread>", "card: Name",
   "Discord <channel>#<message index>") corresponds to a corpus chunk. Today's
   corpus has no CR chunks at all, so every CR cite is "not measurable" on it:
   recall is computed only over cites some chunk in the corpus COULD satisfy,
   and the run records how many that was.

3. The judge: the rubric, the prompt, strict-JSON parsing and the cache.
"""

from __future__ import annotations

import glob
import hashlib
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOT_DIR = HERE.parent
GOLD = HERE / "gold.jsonl"

GRADES = ("correct", "partial", "wrong", "invented_rule", "good_abstain", "bad_abstain")
#: what counts toward "accuracy" in the report
ACCURATE = ("correct", "good_abstain")


def sha(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def load_gold(path=GOLD):
    items = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            items.append(json.loads(line))
    ids = [it["id"] for it in items]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"gold set has duplicate ids: {sorted(dupes)}")
    return items


def item_sig(item) -> str:
    """Hash of the fields the judge grades against. An owner edit to any of
    them invalidates that item's cached grades; nothing else does."""
    return sha(json.dumps({k: item.get(k) for k in
                           ("question", "history", "expected", "key_points",
                            "must_not", "evidence", "category")},
                          sort_keys=True, ensure_ascii=False))[:16]


# ── must_cite -> chunk ──────────────────────────────────────────────────────

_CR_TAIL = re.compile(r"^[a-z.]")


def parse_cite(cite: str):
    """'CR 608.2b' -> ('cr', '608.2b'); 'RAQ 135…' -> ('raq', '135…');
    'card: Monke' -> ('card', 'Monke'); 'Discord 106…#13905' -> ('discord',
    ('106…', 13905)). Anything else -> ('other', cite)."""
    c = cite.strip()
    if c.startswith("CR "):
        return "cr", c[3:].strip()
    if c.startswith("RAQ "):
        return "raq", c[4:].strip()
    if c.lower().startswith("card:"):
        return "card", c[5:].strip()
    m = re.match(r"Discord (\d+)#(\d+)$", c)
    if m:
        return "discord", (m.group(1), int(m.group(2)))
    return "other", c


def _cr_covers(chunk_num: str, want: str) -> bool:
    """Does the chunk for rule `chunk_num` contain rule `want`? A chunk is one
    numbered rule WITH its subrules (WS2), so cr:608.2 covers 608.2b, and
    cr:608 covers 608.2 — but cr:608.2 does not cover 608.21."""
    if want == chunk_num:
        return True
    return want.startswith(chunk_num) and bool(_CR_TAIL.match(want[len(chunk_num):]))


def _base_id(chunk_id: str) -> str:
    return chunk_id.split("#", 1)[0]          # split chunks: cr:608.2#1, raq-…#0


def _url_tail(row):
    url = (row.get("metadata") or {}).get("url") or ""
    parts = url.rstrip("/").split("/")
    return parts[-1] if url else "", (parts[-2] if len(parts) >= 2 else "")


class DiscordIndex:
    """Message index -> message id for a channel export, so a gold cite
    'Discord <channel>#<i>' can be matched to a curated rules-questions chunk
    (whose metadata.url names one message id). Loaded lazily and only for a
    channel that is not an RAQ thread. The exports are gitignored and live only
    in the main checkout; a worktree finds them through git's common dir."""

    WINDOW = 5      # a curated chunk's url may be the question or the answer

    def __init__(self, exports_dir=None):
        self._dir = Path(exports_dir) if exports_dir else None
        self._chan: dict[str, dict[str, int]] = {}

    def _exports_dir(self):
        if self._dir and self._dir.is_dir():
            return self._dir
        import paths
        if paths.RULINGS_EXPORTS.is_dir():
            return paths.RULINGS_EXPORTS
        try:
            common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=BOT_DIR,
                                    capture_output=True, text=True, check=True).stdout.strip()
            main = (BOT_DIR / common).resolve().parent
            cand = main / paths.RULINGS_EXPORTS.relative_to(paths.REPO_ROOT)
            return cand if cand.is_dir() else None
        except (OSError, subprocess.CalledProcessError, ValueError):
            return None

    def ids(self, chan: str) -> dict[str, int] | None:
        """message id -> index, or None if the export is not on this machine."""
        if chan not in self._chan:
            d = self._exports_dir()
            files = glob.glob(str(d / f"*[[]{chan}].json")) if d else []
            if not files:
                self._chan[chan] = None
            else:
                msgs = json.loads(Path(max(files, key=lambda f: Path(f).stat().st_size))
                                  .read_text(encoding="utf-8"))["messages"]
                self._chan[chan] = {m.get("id"): i for i, m in enumerate(msgs)}
        return self._chan[chan]


def cite_matches(cite: str, row: dict, discord: DiscordIndex | None = None) -> bool:
    """THE must_cite -> chunk rule. True when corpus row `row` is (or contains)
    what gold citation `cite` points at."""
    kind, key = parse_cite(cite)
    cid = row.get("id", "")
    meta = row.get("metadata") or {}
    if kind == "cr":
        if cid.startswith("cr:"):
            return _cr_covers(_base_id(cid)[3:], key)
        nums = meta.get("num") or meta.get("rule") or meta.get("rules") or meta.get("nums")
        if isinstance(nums, str):
            nums = [nums]
        return bool(nums) and cid.startswith("cr") and any(_cr_covers(str(n), key) for n in nums)
    if kind == "raq":
        tail, _ = _url_tail(row)
        return (_base_id(cid) == f"ruling:raq-{key}" or tail == key
                or str(meta.get("thread_id") or "") == key)
    if kind == "card":
        return _base_id(cid).lower() == f"card:{key}".lower()
    if kind == "discord":
        chan, idx = key
        if cite_matches(f"RAQ {chan}", row):      # an RAQ thread: thread-level
            return True
        tail, parent = _url_tail(row)
        if parent != chan or not discord:
            return False
        ids = discord.ids(chan)
        if not ids or tail not in ids:
            return False
        return abs(ids[tail] - idx) <= DiscordIndex.WINDOW
    return False


def measurable_cites(item, corpus_rows, discord=None):
    """The item's must_cite entries that SOME chunk in the corpus satisfies —
    the only ones retrieval could possibly find."""
    return [c for c in item.get("must_cite") or []
            if any(cite_matches(c, r, discord) for r in corpus_rows)]


def retrieval_check(item, hit_rows, measurable, discord=None):
    """{cite: matching retrieved chunk id or None} over the measurable cites,
    plus the plan's "at least one retrieved" item-level flag."""
    found = {}
    for c in measurable:
        found[c] = next((r["id"] for r in hit_rows if cite_matches(c, r, discord)), None)
    return {
        "must_cite": list(item.get("must_cite") or []),
        "measurable": list(measurable),
        "found": found,
        "any_hit": (any(v for v in found.values()) if measurable else None),
        "hit_frac": (sum(1 for v in found.values() if v) / len(measurable)) if measurable else None,
    }


# ── citations in the answer ─────────────────────────────────────────────────

_CITE_RE = re.compile(r"\[([^\[\]]+)\]")
_TAG_RE = re.compile(r"^[a-z][a-z0-9_\-]*:\S")


def cited_tags(answer: str):
    """The [prefix:id] tags the answer cites, in order, deduplicated. Card text
    in brackets ([Augment], [Haste]) has no colon and is ignored."""
    out = []
    for m in _CITE_RE.finditer(answer or ""):
        for t in re.split(r"[;,]", m.group(1)):
            t = t.strip()
            if _TAG_RE.match(t) and t not in out:
                out.append(t)
    return out


# ── the judge ───────────────────────────────────────────────────────────────

JUDGE_SYSTEM = """You grade answers from an Algomancy rules bot against a gold answer written by \
a rules expert. Algomancy is a drafting card game (not Magic: The Gathering). Do not use outside \
knowledge of other card games; everything you may treat as true about Algomancy is in this message.

You receive:
- the question (and any earlier turns);
- the GOLD RECORD: `expected` (the reference answer), `key_points` (what a complete answer must \
convey), `must_not` (claims that make an answer wrong), `evidence` (verbatim source quotes), `category`;
- BACKGROUND: the bot's verified basic-rules primer — general knowledge of the game;
- PASSAGES: the source passages the bot retrieved for this question, each headed by its [id];
- the bot's ANSWER.

Step 1 — list every RULES claim in the answer that goes beyond the gold record (how the game works: \
a timing, a step, a number, a keyword's effect, what a card does, a ruling, an exception). Ignore \
restatements of the question, basic vocabulary, strategy advice, politeness and offers to help. For \
each claim decide its support:
- "primer" if BACKGROUND states it;
- "passage:<id>" if a PASSAGE explicitly states it (not merely mentions the topic);
- "none" otherwise. Be strict: a specific-sounding mechanic, step, number or exception that neither \
the gold record, BACKGROUND nor a PASSAGE states is "none", however plausible it sounds.
Claims with support "none" are INVENTED.

Step 2 — choose exactly one label, the first that fits:
1. "good_abstain" — the gold expects the bot to decline (category should-abstain, or `expected` says \
the sources do not answer it) AND the answer declines / says it cannot confirm, without asserting a \
specific rule, number or fact the gold says is unknown. Pointing the user elsewhere is fine.
2. "bad_abstain" — the gold has a definite answer but the answer declines, says it cannot find or \
confirm it, or hedges without committing to the expected verdict.
3. "wrong" — the headline verdict contradicts `expected`, OR the answer asserts anything in `must_not` \
or anything the gold record contradicts (even if a PASSAGE says it: passages can be outdated, the \
gold record wins), OR (should-abstain item) it confidently gives an answer the gold says is unknown.
4. "invented_rule" — not wrong, but at least one INVENTED claim.
5. "partial" — verdict right, nothing invented, but a `key_point` is missing or garbled.
6. "correct" — verdict right, every key point conveyed (paraphrase is fine), nothing invented.

Citation tags like [manual:0012] have been removed from the answer; ignore formatting, length, tone.

Reply with ONLY a JSON object, no prose, no code fence:
{"claims": [{"claim": "<short paraphrase>", "support": "primer" | "passage:<id>" | "none"}, ...], \
"grade": "<one label>", "missing_points": ["<key point not conveyed>", ...], \
"violations": ["<must_not item asserted, or what contradicts the gold>", ...], \
"rationale": "<one sentence>"}"""

#: changes to the rubric invalidate every cached grade
RUBRIC_SIG = sha(JUDGE_SYSTEM)[:12]


def passages_block(hit_rows) -> str:
    if not hit_rows:
        return "(none)"
    return "\n\n".join(f"[{r['id']}] ({r.get('authority_label', '')})\n{r.get('text', '')}" for r in hit_rows)


def judge_user_message(item, answer_text: str, primer: str = "", hit_rows=()) -> str:
    gold = {k: item.get(k) for k in ("category", "expected", "key_points", "must_not")}
    gold["evidence"] = [f"[{e.get('source')} {e.get('ref')}] {e.get('quote')}"
                        for e in item.get("evidence") or []]
    parts = [f"BACKGROUND (verified primer):\n{primer or '(none)'}",
             f"PASSAGES the bot retrieved:\n{passages_block(hit_rows)}"]
    if item.get("history"):
        parts.append("EARLIER TURNS (background only):\n" + "\n".join(
            f"{m['role']}: {m['content']}" for m in item["history"]))
    parts.append(f"QUESTION:\n{item['question']}")
    parts.append("GOLD RECORD:\n" + json.dumps(gold, ensure_ascii=False, indent=1))
    parts.append(f"ANSWER TO GRADE:\n{answer_text}")
    return "\n\n".join(parts)


def parse_judge(text: str) -> dict:
    """Strict JSON out of the judge's reply. Tolerates a code fence or leading
    prose (models add them), never a missing or unknown grade."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        obj = json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, re.S)
        if not m:
            raise ValueError(f"judge reply is not JSON: {t[:200]!r}")
        obj = json.loads(m.group(0))
    grade = str(obj.get("grade", "")).strip().lower()
    if grade not in GRADES:
        raise ValueError(f"judge gave unknown grade {grade!r}")
    lst = lambda k: [str(x) for x in (obj.get(k) or []) if str(x).strip()]
    claims = []
    for c in obj.get("claims") or []:
        if isinstance(c, dict) and str(c.get("claim", "")).strip():
            sup = str(c.get("support") or "none").strip()
            claims.append({"claim": str(c["claim"]).strip(),
                           "support": sup if sup in ("primer", "none") or sup.startswith("passage:") else "none"})
    out = {"grade": grade, "missing_points": lst("missing_points"),
           "violations": lst("violations"), "claims": claims,
           "invented_claims": [c["claim"] for c in claims if c["support"] == "none"],
           "passage_only_claims": [c["claim"] for c in claims if c["support"].startswith("passage:")],
           "rationale": str(obj.get("rationale") or "").strip()}
    out["invented"] = grade == "invented_rule" or bool(out["invented_claims"])
    return out


class JudgeCache:
    """Append-only JSONL: key -> verdict. Key = (item id, the item's graded
    fields, answer hash, judge model, rubric, primer + retrieved ids) — so re-running a run, or
    re-judging an unchanged answer, costs nothing."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.rows = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                try:
                    r = json.loads(line)
                    self.rows[r["key"]] = r["verdict"]
                except (json.JSONDecodeError, KeyError):
                    continue

    @staticmethod
    def key(item, answer: str, judge_model: str, context_sig: str = "") -> str:
        """context_sig: hash of what the judge saw besides the gold record and
        the answer (the primer and the retrieved passage ids)."""
        return sha(item["id"], item_sig(item), sha(answer), judge_model, RUBRIC_SIG, context_sig)[:32]

    def get(self, k):
        return self.rows.get(k)

    def put(self, k, verdict):
        self.rows[k] = verdict
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"key": k, "verdict": verdict}, ensure_ascii=False) + "\n")


# ── run files ───────────────────────────────────────────────────────────────

def read_run(path):
    """(header, {item id: row}) from a run file. A later row for the same id
    wins (a resumed or re-judged run appends)."""
    header, items = None, {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("type") == "run":
            header = header or r
        elif r.get("type") == "item":
            items[r["id"]] = r
    return header or {}, items


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    i = (len(xs) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)
