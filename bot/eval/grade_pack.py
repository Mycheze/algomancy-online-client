#!/usr/bin/env python3
"""
grade_pack.py — turn eval run files into BLIND grading shards for Claude-agent
graders, so a tools A/B costs nothing to grade (judge tools design §5).

    .venv/bin/python bot/eval/grade_pack.py RUN_A.jsonl RUN_B.jsonl … --name tools-2026-11 \\
        [--shard-size 40] [--seed 1] [--gold bot/eval/gold.jsonl]

Writes, under var/eval/<name>/:
    shard-1.md … shard-N.md   ~40 items each: the gold record, the answer (its
                              citation tags renumbered [S1], [S2]…), the text of
                              every source it cited, and the deterministic
                              checks (unresolved citations, quote check, which
                              must_cite sources it cited). The bot's primer heads
                              each shard once (the BACKGROUND the judge sees).
and beside that directory:
    var/eval/<name>.key.json  blind id -> which run, config and item it was,
                              plus the run's numbers report.py needs.

⚠ BLIND. Every (run, item) answer is pooled, shuffled with --seed and given a
blind id (b001…) — the same question from two configs lands in different
places, and nothing in a shard names a run, a label or a tools level. The key
is written OUTSIDE the shard directory so a grader listing it does not see it.
What a shard cannot hide: an answer that used the engine cites a source whose
text says "Online client engine". Grading is against the gold record, so that
is a tell about the config, not about the grade.

Graders follow scratchpad/eval-grader-brief.md and write grades-N.jsonl into
the same directory, one line per item: {"id", "grade", "invented": [...], "note"}
with grades from evallib.GRADES. Then:

    .venv/bin/python bot/eval/report.py --grades var/eval/<name>

No model is called anywhere in this file.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))     # bot/
sys.path.insert(0, str(HERE))            # bot/eval/

import evallib as ev                      # noqa: E402

SHARD_SIZE = 40
#: one cited source's text in a shard; a CR chunk or a simulation fits whole
SOURCE_CHARS = 3000

_CITE_GROUP = re.compile(r"\[([^\[\]]+)\]")
_TAG = re.compile(r"^[a-z][a-z0-9_\-]*:\S")


def key_path(pack_dir: Path) -> Path:
    pack_dir = Path(pack_dir)
    return pack_dir.parent / f"{pack_dir.name}.key.json"


def renumber(answer: str, tags: list[str]) -> str:
    """[cr:700.1a; card:Null Drone] -> [S1; S2], by the order of `tags`.
    Card text in brackets ([Augment]) has no colon and is left alone."""
    num = {t: f"S{i}" for i, t in enumerate(tags, 1)}

    def repl(m):
        parts = [p.strip() for p in re.split(r"[;,]", m.group(1))]
        if not any(_TAG.match(p) for p in parts):
            return m.group(0)
        return "[" + "; ".join(num.get(p, "S?") if _TAG.match(p) else p for p in parts) + "]"

    return _CITE_GROUP.sub(repl, answer or "")


def _resolve_old(row: dict, corpus_by_id: dict) -> dict:
    """cited_sources for a run file written before run.py stored them: the
    corpus row by exact id (a tool row cannot be recovered, and says so)."""
    out = {}
    for t in row.get("cited") or []:
        if t in (row.get("cited_unresolved") or []):
            continue
        r = corpus_by_id.get(t)
        out[t] = ({"id": t, "source_type": r.get("source_type"), "title": r.get("title"),
                   "text": r.get("text", ""), "metadata": {}} if r else
                  {"id": t, "source_type": None, "title": t, "text": "(text not recorded in this run file)",
                   "metadata": {}})
    return out


def must_cite_check(gold: dict, sources: dict) -> list[tuple[str, bool]]:
    """(gold must_cite, did the answer cite a source that is or contains it)."""
    out = []
    for c in gold.get("must_cite") or []:
        hit = False
        for s in sources.values():
            row = {"id": s.get("id") or "", "metadata": s.get("metadata") or {}}
            try:
                hit = ev.cite_matches(c, row)
            except Exception:
                hit = False
            if hit:
                break
        out.append((c, hit))
    return out


def checks(row: dict, gold: dict, sources: dict) -> dict:
    return {
        "cited": len(row.get("cited") or []),
        "cited_unresolved": list(row.get("cited_unresolved") or []),
        "quote_fail": list(row.get("quote_fail") or []),
        "engine_mismatch": list(row.get("engine_mismatch") or []),
        "must_cite": must_cite_check(gold, sources),
    }


def _quote_block(text: str) -> str:
    return "> " + (text or "").strip().replace("\n", "\n> ")


def render_item(bid: str, gold: dict, row: dict, sources: dict, chk: dict) -> str:
    tags = list(row.get("cited") or [])
    lines = [f"## {bid}", "", f"*Category:* {gold.get('category')}", ""]
    for m in gold.get("history") or []:
        lines.append(f"> *earlier {m['role']}:* {m['content']}")
    if gold.get("history"):
        lines.append("")
    lines += [f"**Question:** {gold['question']}", "",
              "**Gold record**", "", f"- *expected:* {gold.get('expected')}",
              "- *key_points:* " + ("; ".join(gold.get("key_points") or []) or "–"),
              "- *must_not:* " + ("; ".join(gold.get("must_not") or []) or "–")]
    for e in gold.get("evidence") or []:
        lines.append(f"- *evidence* [{e.get('source')} {e.get('ref')}]: \"{e.get('quote')}\"")
    if gold.get("notes"):
        lines.append(f"- *gold notes:* {gold['notes']}")
    lines += ["", "**Answer**", "", _quote_block(renumber(row.get("answer") or "", tags)), "",
              "**Sources the answer cited**", ""]
    if not tags:
        lines.append("(none)")
    for i, t in enumerate(tags, 1):
        s = sources.get(t)
        if s is None:
            lines.append(f"- **S{i}**: did not resolve to any source the bot had — the reader never saw it")
            continue
        head = s.get("title") or s.get("id")
        if s.get("cited_num"):
            head += f" (cited as {s['cited_num']})"
        text = s.get("text") or ""
        if len(text) > SOURCE_CHARS:
            text = text[:SOURCE_CHARS] + " …"
        lines += [f"- **S{i}** — {head}", "", "```", text, "```"]
    mc = ", ".join(f"{c} {'cited' if ok else 'NOT cited'}" for c, ok in chk["must_cite"]) or "–"
    lines += ["", "**Deterministic checks** (facts, not grades)", "",
              f"- citations: {chk['cited']}, unresolved (dropped before a reader saw them): "
              f"{len(chk['cited_unresolved'])}",
              f"- quote check failures (a \"quote\" its source does not print; the bot already "
              f"stripped the quote marks): {len(chk['quote_fail'])}"
              + (" — " + "; ".join(q.get("quote", "")[:80] for q in chk["quote_fail"]) if chk["quote_fail"] else ""),
              f"- engine stat mismatches: {len(chk['engine_mismatch'])}",
              f"- must_cite: {mc}", ""]
    return "\n".join(lines)


SHARD_HEAD = """# Grading shard {n} of {total} ({count} items)

Grade every item below with the brief `eval-grader-brief.md` (the orchestrator
gives you its path). Write `grades-{n}.jsonl` in THIS directory, one JSON object
per line, one line per item, in any order:

    {{"id": "b001", "grade": "<one of: {grades}>", "invented": ["<claim with no support>", …], "note": "<one sentence>"}}

Do not open any other file in this directory or any `*.key.json` file.

## BACKGROUND — the bot's verified primer (general knowledge of the game)

{primer}

---
"""


def build(run_paths, name, shard_size=SHARD_SIZE, seed=1, gold_path=ev.GOLD, out_root=None,
          primer=None, corpus_rows=None):
    """Write the shards and the key; returns (pack_dir, key)."""
    gold = {g["id"]: g for g in ev.load_gold(gold_path)}
    pool, skipped = [], []
    corpus_by_id = None
    for rp in run_paths:
        head, items = ev.read_run(rp)
        for iid, row in items.items():
            if iid not in gold or not row.get("answer"):
                skipped.append({"run": str(rp), "id": iid, "why": "error" if row.get("error") else
                                ("not in gold" if iid not in gold else "no answer")})
                continue
            sources = row.get("cited_sources")
            if sources is None:
                if corpus_by_id is None:
                    corpus_by_id = {r["id"]: r for r in (corpus_rows if corpus_rows is not None else _corpus(head))}
                sources = _resolve_old(row, corpus_by_id)
            pool.append((str(rp), head, row, sources))
    random.Random(seed).shuffle(pool)
    width = max(3, len(str(len(pool))))
    if out_root is None:
        import paths
        out_root = paths.var_dir() / "eval"
    pack = Path(out_root) / name
    pack.mkdir(parents=True, exist_ok=True)
    if primer is None:
        import core
        primer = core.PRIMER
    total = max(1, -(-len(pool) // shard_size))
    key = {"name": name, "seed": seed, "gold": str(gold_path), "gold_sha": ev.sha(Path(gold_path).read_bytes())[:12],
           "rubric": ev.RUBRIC_SIG, "shards": total, "items": {}, "skipped": skipped,
           "runs": {}}
    for n in range(1, total + 1):
        chunk = pool[(n - 1) * shard_size: n * shard_size]
        parts = [SHARD_HEAD.format(n=n, total=total, count=len(chunk), grades=", ".join(ev.GRADES),
                                   primer=primer.strip())]
        for j, (rp, head, row, sources) in enumerate(chunk):
            bid = f"b{(n - 1) * shard_size + j + 1:0{width}d}"
            g = gold[row["id"]]
            chk = checks(row, g, sources)
            parts.append(render_item(bid, g, row, sources, chk))
            key["items"][bid] = {
                "run": rp, "label": head.get("label"), "config": config_of(head), "item": row["id"],
                "category": g.get("category"), "shard": n,
                "cost_usd": row.get("cost_usd"), "total_ms": row.get("total_ms"),
                "tools_level": row.get("tools_level", head.get("tools", "off")),
                "tool_calls": len(row.get("tools") or []),
                "simulate_calls": sum(1 for t in row.get("tools") or [] if t.get("name") == "simulate"),
                "quote_fail": len(chk["quote_fail"]), "engine_mismatch": len(chk["engine_mismatch"]),
                "cited_unresolved": len(chk["cited_unresolved"]),
                "must_cite_hit": sum(1 for _c, ok in chk["must_cite"] if ok),
                "must_cite_total": len(chk["must_cite"]),
                "engine": row.get("engine") or [],
            }
            key["runs"].setdefault(rp, {"label": head.get("label"), "config": config_of(head),
                                        "engine_version": head.get("engine_version"),
                                        "engine_sha": head.get("engine_sha")})
        (pack / f"shard-{n}.md").write_text("\n".join(parts), encoding="utf-8")
    key_path(pack).write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    return pack, key


def config_of(head: dict) -> str:
    """What makes two runs the same configuration (repeats of it share this)."""
    return (f"tools={head.get('tools') or 'off'} model={head.get('model')} "
            f"reasoning={head.get('reasoning')} surface={head.get('surface') or 'web'}")


def _corpus(head):
    p = Path(head.get("corpus") or "")
    if not p.is_file():
        import paths
        p = Path(paths.CORPUS)
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Write blind grading shards for Claude-agent graders.")
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--name", required=True, help="pack name: var/eval/<name>/ and var/eval/<name>.key.json")
    ap.add_argument("--shard-size", type=int, default=SHARD_SIZE)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--gold", default=str(ev.GOLD))
    a = ap.parse_args(argv)
    pack, key = build(a.runs, a.name, a.shard_size, a.seed, a.gold)
    print(f"[grade_pack] {len(key['items'])} items in {key['shards']} shard(s) -> {pack}/shard-*.md")
    print(f"[grade_pack] key (keep it from the graders): {key_path(pack)}")
    if key["skipped"]:
        print(f"[grade_pack] skipped {len(key['skipped'])} (errors / no answer / not in gold)")


if __name__ == "__main__":
    main()
