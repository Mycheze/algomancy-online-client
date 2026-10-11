#!/usr/bin/env python3
"""
report.py — summarise eval run files as markdown.

    .venv/bin/python bot/eval/report.py RUN.jsonl [RUN2.jsonl …]      # a table per run
    .venv/bin/python bot/eval/report.py A.jsonl B.jsonl --diff         # + per-item A→B changes
    .venv/bin/python bot/eval/report.py RUN.jsonl --blind-sample 20 --seed 7 > sheet.md
    .venv/bin/python bot/eval/report.py RUN.jsonl --agreement owner-grades.json

Calibration (plan WS3c): the owner grades a blind sample — question, gold, the
bot's answer, no judge grade — and `--agreement` compares. The grades file is
JSON: {"g012": "correct", "g047": "invented_rule", …} (or a list of
{"id", "grade"} objects); labels are evallib.GRADES. The plan's bar: if judge
and owner disagree on more than 15% of the sample, fix the rubric before
trusting the judge.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import evallib as ev  # noqa: E402

CATEGORY_ORDER = ["core", "card-interaction", "light-dark-provisional", "false-premise",
                  "digital-only", "should-abstain", "follow-up"]


def _p(n, d):
    return f"{100 * n / d:.0f}%" if d else "–"


def summarise(items: dict) -> dict:
    rows = list(items.values())
    graded = [r for r in rows if (r.get("judge") or {}).get("grade")]
    g = Counter(r["judge"]["grade"] for r in graded)
    invented = sum(1 for r in graded if r["judge"].get("invented"))
    meas = [r for r in rows if (r.get("retrieval") or {}).get("measurable")]
    cites_meas = sum(len(r["retrieval"]["measurable"]) for r in meas)
    cites_hit = sum(sum(1 for v in r["retrieval"]["found"].values() if v) for r in meas)
    cited = [r for r in rows if r.get("cited") is not None]
    unresolved = sum(len(r.get("cited_unresolved") or []) for r in cited)
    total_cited = sum(len(r.get("cited") or []) for r in cited)
    lat = [r.get("total_ms") for r in rows if r.get("answer")]
    costs = [r.get("cost_usd") for r in rows if r.get("answer") and r.get("cost_usd") is not None]
    jcost = sum((r.get("judge") or {}).get("judge_cost_usd") or 0 for r in graded)
    return {
        "n": len(rows), "answered": sum(1 for r in rows if r.get("answer")),
        "errors": sum(1 for r in rows if r.get("error")),
        "graded": len(graded), "grades": g,
        "accuracy": sum(g[k] for k in ev.ACCURATE), "invented": invented,
        "items_meas": len(meas), "items_any_hit": sum(1 for r in meas if r["retrieval"]["any_hit"]),
        "cites_total": sum(len((r.get("retrieval") or {}).get("must_cite") or []) for r in rows),
        "cites_meas": cites_meas, "cites_hit": cites_hit,
        "cited_total": total_cited, "cited_unresolved": unresolved,
        "answers_with_cites": sum(1 for r in cited if r.get("cited")), "answers": len(cited),
        "p50": ev.pct(lat, 0.5), "p95": ev.pct(lat, 0.95),
        "mean_cost": (sum(costs) / len(costs)) if costs else None,
        "total_cost": sum(costs) if costs else None, "judge_cost": jcost,
        "reasoning_used": sum(1 for r in rows if r.get("reasoning_used")),
    }


def run_table(path) -> str:
    header, items = ev.read_run(path)
    s = summarise(items)
    G, n = s["grades"], s["graded"]
    out = [f"## {header.get('label', Path(path).stem)}", "",
           f"`{Path(path).name}` — model **{header.get('model')}**, reasoning {header.get('reasoning')}, "
           f"corpus `{Path(str(header.get('corpus'))).name}` ({header.get('corpus_chunks')} chunks, "
           f"sha {header.get('corpus_sha')}), engine {header.get('engine_version')}, "
           f"judge {header.get('judge_model')} (rubric {header.get('rubric')}), gold sha {header.get('gold_sha')}.", ""]
    out += ["| metric | value |", "|---|---|",
            f"| items | {s['n']} ({s['answered']} answered, {s['errors']} errors, {n} graded) |",
            f"| **accuracy** (correct + good_abstain) | **{_p(s['accuracy'], n)}** ({s['accuracy']}/{n}) |",
            f"| correct / partial / wrong | {G['correct']} / {G['partial']} / {G['wrong']} |",
            f"| invented_rule (label) | {G['invented_rule']} ({_p(G['invented_rule'], n)}) |",
            f"| **any invented claim** (any label) | **{_p(s['invented'], n)}** ({s['invented']}/{n}) |",
            f"| good_abstain / bad_abstain | {G['good_abstain']} / {G['bad_abstain']} |",
            f"| retrieval recall, cites | {_p(s['cites_hit'], s['cites_meas'])} ({s['cites_hit']}/{s['cites_meas']} "
            f"measurable; {s['cites_total']} cites in gold) |",
            f"| retrieval recall, items (≥1 must_cite retrieved) | {_p(s['items_any_hit'], s['items_meas'])} "
            f"({s['items_any_hit']}/{s['items_meas']} items with a measurable cite) |",
            f"| citations resolving to a retrieved id | {_p(s['cited_total'] - s['cited_unresolved'], s['cited_total'])} "
            f"({s['cited_total'] - s['cited_unresolved']}/{s['cited_total']}; {s['answers_with_cites']}/{s['answers']} answers cite) |",
            f"| reasoning (math mode) used | {s['reasoning_used']} items |",
            f"| latency p50 / p95 (retrieval + model) | {_fmt_s(s['p50'])} / {_fmt_s(s['p95'])} |",
            f"| mean $/question | {_fmt_usd(s['mean_cost'])} |",
            f"| total answer cost / judge cost | {_fmt_usd(s['total_cost'])} / {_fmt_usd(s['judge_cost'])} |",
            ""]
    by = defaultdict(list)
    for r in items.values():
        by[r.get("category")].append(r)
    cats = [c for c in CATEGORY_ORDER if c in by] + sorted(c for c in by if c not in CATEGORY_ORDER)
    out += ["| category | n | accuracy | partial | wrong | invented (any) | bad_abstain | recall (items) |",
            "|---|---|---|---|---|---|---|---|"]
    for c in cats:
        cs = summarise({r["id"]: r for r in by[c]})
        cg, cn = cs["grades"], cs["graded"]
        out.append(f"| {c} | {cs['n']} | {_p(cs['accuracy'], cn)} | {cg['partial']} | {cg['wrong']} | "
                   f"{cs['invented']} | {cg['bad_abstain']} | {_p(cs['items_any_hit'], cs['items_meas'])} |")
    out.append("")
    bad = [r for r in items.values() if (r.get("judge") or {}).get("grade") in ("wrong", "invented_rule", "bad_abstain")]
    if bad:
        out += ["<details><summary>wrong / invented / bad-abstain items</summary>", "",
                "| id | category | grade | rationale |", "|---|---|---|---|"]
        for r in sorted(bad, key=lambda r: r["id"]):
            j = r["judge"]
            out.append(f"| {r['id']} | {r.get('category')} | {j['grade']} | {_cell(j.get('rationale'))} |")
        out += ["", "</details>", ""]
    errs = [r for r in items.values() if r.get("error")]
    if errs:
        out += ["Errors: " + "; ".join(f"{r['id']}: {_cell(r['error'])[:120]}" for r in errs), ""]
    return "\n".join(out)


def diff_table(a_path, b_path) -> str:
    ha, a = ev.read_run(a_path)
    hb, b = ev.read_run(b_path)
    rank = {"correct": 0, "good_abstain": 0, "partial": 1, "bad_abstain": 2, "invented_rule": 3, "wrong": 3, None: 9}
    lines = [f"## Per-item diff: {ha.get('label')} → {hb.get('label')}", "",
             "| id | category | A | B | | recall A→B |", "|---|---|---|---|---|---|"]
    better = worse = 0
    for i in sorted(set(a) | set(b)):
        ga = ((a.get(i) or {}).get("judge") or {}).get("grade")
        gb = ((b.get(i) or {}).get("judge") or {}).get("grade")
        ra = ((a.get(i) or {}).get("retrieval") or {}).get("any_hit")
        rb = ((b.get(i) or {}).get("retrieval") or {}).get("any_hit")
        if ga == gb and ra == rb:
            continue
        mark = ""
        if rank[gb] < rank[ga]:
            mark, better = "better", better + 1
        elif rank[gb] > rank[ga]:
            mark, worse = "worse", worse + 1
        cat = (b.get(i) or a.get(i)).get("category")
        lines.append(f"| {i} | {cat} | {ga} | {gb} | {mark} | {ra}→{rb} |")
    lines += ["", f"{better} better, {worse} worse, {len(set(a) | set(b))} items compared.", ""]
    return "\n".join(lines)


def blind_sample(path, n, seed, gold_path=ev.GOLD) -> str:
    _h, items = ev.read_run(path)
    gold = {g["id"]: g for g in ev.load_gold(gold_path)}
    pool = sorted(i for i, r in items.items() if r.get("answer") and i in gold)
    pick = sorted(random.Random(seed).sample(pool, min(n, len(pool))))
    out = [f"# Blind grading sheet ({len(pick)} items, seed {seed})", "",
           "Grade each answer against the gold record with one label: " + ", ".join(f"`{g}`" for g in ev.GRADES) + ".",
           "Rubric: the judge's (bot/eval/evallib.py `JUDGE_SYSTEM`). Return a JSON object "
           "`{\"<id>\": \"<label>\", …}` and run `report.py RUN --agreement grades.json`.", ""]
    for i in pick:
        g, r = gold[i], items[i]
        out += [f"## {i} ({g.get('category')})", ""]
        for m in g.get("history") or []:
            out.append(f"> *{m['role']}:* {m['content']}")
        out += [f"**Question:** {g['question']}", "", f"**Gold:** {g['expected']}", "",
                "**Key points:** " + "; ".join(g.get("key_points") or []), "",
                "**Must not:** " + ("; ".join(g.get("must_not") or []) or "–"), "",
                "**Bot answer:**", "", "> " + r["answer"].replace("\n", "\n> "), "",
                "**Your grade:** ______", ""]
    return "\n".join(out)


def agreement(path, grades_path) -> str:
    _h, items = ev.read_run(path)
    raw = json.loads(Path(grades_path).read_text(encoding="utf-8"))
    owner = raw if isinstance(raw, dict) else {x["id"]: x["grade"] for x in raw}
    bad = {k: v for k, v in owner.items() if v not in ev.GRADES}
    if bad:
        raise SystemExit(f"unknown labels in {grades_path}: {bad}")
    pairs = [(i, owner[i], ((items.get(i) or {}).get("judge") or {}).get("grade")) for i in sorted(owner)]
    pairs = [p for p in pairs if p[2]]
    n = len(pairs)
    exact = sum(1 for _i, o, j in pairs if o == j)
    coarse = lambda g: "ok" if g in ev.ACCURATE else ("partial" if g == "partial" else "bad")
    coarse_ok = sum(1 for _i, o, j in pairs if coarse(o) == coarse(j))
    lines = [f"## Judge vs owner agreement ({n} items)", "",
             f"- exact label: {_p(exact, n)} ({exact}/{n})",
             f"- coarse (accurate / partial / bad): {_p(coarse_ok, n)} ({coarse_ok}/{n})",
             f"- disagreement (exact): {_p(n - exact, n)} — the plan's bar is ≤ 15%", "",
             "| id | owner | judge |", "|---|---|---|"]
    lines += [f"| {i} | {o} | {j} |" for i, o, j in pairs if o != j]
    return "\n".join(lines) + "\n"


def _fmt_s(ms):
    return "–" if ms is None else f"{ms / 1000:.1f} s"


def _fmt_usd(x):
    return "–" if x is None else f"${x:.4f}"


def _cell(s):
    return str(s or "").replace("|", "\\|").replace("\n", " ")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Summarise eval runs.")
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--diff", action="store_true", help="per-item diff between the first two runs")
    ap.add_argument("--blind-sample", type=int, default=None, metavar="N")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--agreement", default=None, metavar="GRADES_JSON")
    ap.add_argument("--gold", default=str(ev.GOLD))
    a = ap.parse_args(argv)
    if a.blind_sample:
        print(blind_sample(a.runs[0], a.blind_sample, a.seed, a.gold))
        return
    if a.agreement:
        print(agreement(a.runs[0], a.agreement))
        return
    parts = ["# Judge-bot eval", ""] + [run_table(p) for p in a.runs]
    if a.diff and len(a.runs) >= 2:
        parts.append(diff_table(a.runs[0], a.runs[1]))
    print("\n".join(parts))


if __name__ == "__main__":
    main()
