#!/usr/bin/env python3
"""
test_eval.py — offline tests for the eval harness (bot/eval/). No network, no
key: the answering model and the judge are fakes.

Covers the parts whose failure would silently corrupt a bake-off:
- must_cite -> chunk matching (CR subrule containment, card, RAQ thread,
  Discord-in-an-RAQ-thread), and "measurable" = some chunk COULD match;
- cited-tag extraction and resolution against the retrieved ids;
- the judge's JSON parsing (fences, prose, unknown grades refused) and the
  invented / passage-only split;
- run.py end to end through the real core.answer_question with a fake client:
  rows written, follow-up history reaches the model, an errored item is
  recorded not raised, a second run resumes and the judge cache is hit;
- report.py: the table numbers, the per-item diff, a blind sheet carrying no
  grades, and agreement arithmetic.
"""

import sys as _sys
from pathlib import Path as _Path

_HERE = _Path(__file__).resolve().parent
_sys.path.insert(0, str(_HERE.parent / "test"))
_sys.path.insert(0, str(_HERE.parent))
_sys.path.insert(0, str(_HERE))
import _scratch_var  # noqa: F401,E402  — before any bot import: var/ -> scratch

import asyncio  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import contextlib  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

import evallib as ev  # noqa: E402

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


# ── matching ────────────────────────────────────────────────────────────────
cr = lambda n: {"id": f"cr:{n}", "metadata": {}}
check("CR exact", ev.cite_matches("CR 608.2b", cr("608.2b")))
check("CR subrule inside its rule's chunk", ev.cite_matches("CR 608.2b", cr("608.2")))
check("CR split chunk id", ev.cite_matches("CR 608.2b", cr("608.2#1")))
check("CR 608.21 is not inside 608.2", not ev.cite_matches("CR 608.21", cr("608.2")))
check("CR annex D", ev.cite_matches("CR D4.1c", cr("D4.1")))
crn = lambda cid, nums, kind="rule": {"id": cid, "metadata": {"kind": kind, "nums": nums}}
check("CR by build_cr nums", ev.cite_matches("CR 103.1d", crn("cr:103.1", ["103.1", "103.1a", "103.1d"])))
check("CR continuation piece: nums beat the id prefix",
      not ev.cite_matches("CR 802.16g", crn("cr:802.16", ["802.16", "802.16a"]))
      and ev.cite_matches("CR 802.16g", crn("cr:802.16g", ["802.16g", "802.16h"])))
check("CR glossary row does not count as its rule", not ev.cite_matches("CR 107.1", crn("cr:glossary.x", ["107.1"], "glossary")))
check("CR never matches a manual chunk", not ev.cite_matches("CR 104.2", {"id": "manual:0002", "metadata": {}}))
check("card", ev.cite_matches("card: Temporal Rift", {"id": "card:Temporal Rift", "metadata": {}}))
check("card is exact", not ev.cite_matches("card: Rift", {"id": "card:Temporal Rift", "metadata": {}}))
raq = {"id": "ruling:raq-1353986897902567424#1",
       "metadata": {"url": "https://discord.com/channels/626/1353986897902567424"}}
check("RAQ by chunk id", ev.cite_matches("RAQ 1353986897902567424", raq))
check("RAQ by url", ev.cite_matches("RAQ 1353986897902567424",
                                    {"id": "ruling:x", "metadata": {"url": "https://d/c/1/1353986897902567424"}}))
check("Discord ref inside an RAQ thread matches the thread", ev.cite_matches("Discord 1353986897902567424#19", raq))


class FakeDiscord(ev.DiscordIndex):
    def ids(self, chan):
        return {"m100": 100, "m200": 200} if chan == "999" else None


rq = {"id": "ruling:discord-1", "metadata": {"url": "https://discord.com/channels/626/999/m100"}}
check("Discord message within the window", ev.cite_matches("Discord 999#103", rq, FakeDiscord()))
check("Discord message outside the window", not ev.cite_matches("Discord 999#150", rq, FakeDiscord()))
item = {"id": "x", "must_cite": ["CR 1.1", "card: Monke"]}
corpus = [{"id": "card:Monke", "metadata": {}}, {"id": "manual:0001", "metadata": {}}]
meas = ev.measurable_cites(item, corpus)
check("measurable excludes cites no chunk can satisfy", meas == ["card: Monke"])
rc = ev.retrieval_check(item, [corpus[1]], meas)
check("recall miss", rc["any_hit"] is False and rc["hit_frac"] == 0)
rc = ev.retrieval_check(item, corpus, meas)
check("recall hit", rc["any_hit"] is True and rc["found"]["card: Monke"] == "card:Monke")
check("no measurable cite -> recall None", ev.retrieval_check({"must_cite": ["CR 1"]}, corpus, [])["any_hit"] is None)

# ── cited tags ──────────────────────────────────────────────────────────────
tags = ev.cited_tags("It dies [manual:0026; ruling:discord-5]. [Augment] is not a tag. [card:Temporal Rift] [manual:0026]")
check("cited tags parsed, deduped, card text ignored",
      tags == ["manual:0026", "ruling:discord-5", "card:Temporal Rift"])

# ── judge parsing ───────────────────────────────────────────────────────────
v = ev.parse_judge('```json\n{"grade": "Correct", "claims": [{"claim": "a", "support": "primer"}, '
                   '{"claim": "b", "support": "passage:manual:1"}, {"claim": "c", "support": "made up"}]}\n```')
check("judge JSON in a fence; grade case-folded", v["grade"] == "correct")
check("unknown support counts as invented", v["invented_claims"] == ["c"] and v["invented"])
check("passage-only claims kept apart", v["passage_only_claims"] == ["b"])
check("judge JSON after prose", ev.parse_judge('Sure: {"grade": "wrong"}')["grade"] == "wrong")
try:
    ev.parse_judge('{"grade": "great"}')
    check("unknown grade refused", False)
except ValueError:
    check("unknown grade refused", True)
check("rubric mentions every grade", all(g in ev.JUDGE_SYSTEM for g in ev.GRADES))

# ── run.py end to end, with fakes ───────────────────────────────────────────
import core  # noqa: E402
import run as runner  # noqa: E402
import report  # noqa: E402

scratch = _Path(_scratch_var.scratch_var_dir())
gold_path = scratch / "gold.jsonl"
GOLD = [
    {"id": "t1", "question": "how much life do you start with", "expected": "30", "key_points": ["30"],
     "must_not": ["20"], "evidence": [], "category": "core", "must_cite": ["card: Monke", "CR 103.1d"]},
    {"id": "t2", "question": "and in team games?", "expected": "same", "key_points": [], "must_not": [],
     "evidence": [], "category": "follow-up", "must_cite": [],
     "history": [{"role": "user", "content": "how much life"}, {"role": "assistant", "content": "30 [manual:0002]"}]},
    {"id": "t3", "question": "BOOM", "expected": "x", "key_points": [], "must_not": [], "evidence": [],
     "category": "core", "must_cite": []},
]
gold_path.write_text("".join(json.dumps(g) + "\n" for g in GOLD))


def _row(cid, text, stype, meta=None, auth=1):
    return {"id": cid, "text": text, "source": "fixture", "source_type": stype, "authority": auth,
            "authority_label": "fixture", "outdated_risk": False, "title": cid, "metadata": meta or {}}


# The test's own corpus: it must not depend on what the live corpus holds today.
FIXTURE = [
    _row("cr:103.1", "103.1 Starting the game. 103.1d Each player's life total starts at 30.", "cr",
         {"kind": "rule", "num": "103.1", "nums": ["103.1", "103.1a", "103.1d"], "scope": "game"}),
    _row("cr:glossary.life", "Life: how much damage a player can take. See rule 103.1d.", "cr",
         {"kind": "glossary", "nums": ["103.1d"], "scope": "game"}),
    _row("card:Monke", "Monke\nUnit\nA monkey with 30 life worth of mischief.", "card", {"name": "Monke"}),
    _row("manual:0002", "Each player begins with 30 life. Team games share nothing.", "rulebook"),
    _row("glossary:team", "Team games: players on a team start with life as normal.", "glossary", {}, 2),
]
corpus_path = scratch / "corpus.jsonl"
corpus_path.write_text("".join(json.dumps(r) + "\n" for r in FIXTURE))
GOLD[0]["must_cite"] = ["card: Monke", "CR 103.1d", "CR 999.9"]
gold_path.write_text("".join(json.dumps(g) + "\n" for g in GOLD))


def resp(content, usage=None):
    return NS(choices=[NS(message=NS(content=content), finish_reason="stop")],
              usage=usage or NS(prompt_tokens=1000, completion_tokens=100, prompt_cache_hit_tokens=0,
                                prompt_tokens_details=None, completion_tokens_details=None, cost=None))


class FakeModel:
    def __init__(self):
        self.calls = []
        self.chat = NS(completions=self)

    async def create(self, **p):
        self.calls.append(p)
        q = p["messages"][-1]["content"]
        if "BOOM" in q:
            raise RuntimeError("model exploded")       # not retryable: recorded, not raised
        if "Retrieved passages:\n[" not in q:
            return resp("30 life [nope:1]")
        tag = q.split("Retrieved passages:\n[", 1)[1].split("]", 1)[0]   # the first passage shown
        return resp(f"30 life [{tag}] [nope:1]")


class FakeJudgeClient:
    def __init__(self):
        self.calls = 0
        self.chat = NS(completions=self)

    async def create(self, **p):
        self.calls += 1
        user = p["messages"][-1]["content"]
        assert "BACKGROUND" in user and "PASSAGES" in user and "GOLD RECORD" in user
        return resp(json.dumps({"grade": "correct", "claims": [], "rationale": "fine"}))


fake = FakeModel()
fj = FakeJudgeClient()
core.ai = fake
core.ai_fallback = None
core.init_client = lambda *a, **k: fake           # run.py builds the client through here
os.environ["ALGO_EVAL_NO_DOTENV"] = "1"
os.environ["EVAL_FAKE_KEY"] = "x"
os.environ["EVAL_FAKE_JUDGE_KEY"] = "x"
runner.make_judge = lambda args: runner.Judge(fj, "fake-judge", "https://judge.test", True,
                                              ev.JudgeCache(runner.eval_dir() / "judge-cache.jsonl"))
out = scratch / "run.jsonl"
argv = ["--gold", str(gold_path), "--corpus", str(corpus_path), "--out", str(out), "--api-key-env", "EVAL_FAKE_KEY",
        "--judge-key-env", "EVAL_FAKE_JUDGE_KEY", "--label", "fake", "--concurrency", "2"]
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(argv)
head, items = ev.read_run(out)
check("header names the run, the corpus and the surface", head["label"] == "fake"
      and head["corpus_chunks"] == len(FIXTURE) and head["surface"] == "web" and head["cr_notes"] is False)
check("every item has a row", set(items) == {"t1", "t2", "t3"})
check("answer, cost and latency recorded", items["t1"]["answer"].startswith("30")
      and items["t1"]["usage"]["prompt"] == 1000 and items["t1"]["total_ms"] is not None)
check("cited tag resolves; unknown tag reported", items["t1"]["cited_unresolved"] == ["nope:1"]
      and len(items["t1"]["cited"]) == 2)
check("measurable = cites some fixture chunk can satisfy",
      items["t1"]["retrieval"]["measurable"] == ["card: Monke", "CR 103.1d"])
check("CR cite found through the rule chunk, not the glossary row",
      items["t1"]["retrieval"]["found"]["CR 103.1d"] == "cr:103.1")
check("surface web reaches core", items["t1"]["surface"] == "web")
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(argv[:argv.index("--out") + 1] + [str(scratch / "discord.jsonl")] + argv[argv.index("--out") + 2:]
                + ["--surface", "discord", "--ids", "t2", "--no-judge"])
check("surface discord reaches core", ev.read_run(scratch / "discord.jsonl")[1]["t2"]["surface"] == "discord")
hist_call = next(c for c in fake.calls if "team games" in c["messages"][-1]["content"])
check("follow-up history reaches the model, citations stripped",
      any(m["role"] == "assistant" and m["content"] == "30" for m in hist_call["messages"]))
check("an errored item is recorded, not raised", "model exploded" in (items["t3"]["error"] or "")
      and "judge" not in items["t3"])
check("judged", items["t1"]["judge"]["grade"] == "correct" and fj.calls == 2)

# resume: answered+judged items are skipped; only the errored one runs again
n_before = len(fake.calls)
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(argv)
check("resume re-runs only the errored item", len(fake.calls) - n_before == 1)
# re-judge the same answers under a new label: every verdict comes from the cache
out2 = scratch / "rejudge.jsonl"
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(["--gold", str(gold_path), "--rejudge", str(out), "--out", str(out2),
                 "--judge-key-env", "EVAL_FAKE_JUDGE_KEY", "--label", "rj"])
_h2, items2 = ev.read_run(out2)
check("rejudge hits the cache", fj.calls == 2 and all(r["judge"]["cached"] for r in items2.values()))
# an owner edit to an item's gold invalidates exactly that item's cached grade
GOLD[0]["expected"] = "thirty"
gold_path.write_text("".join(json.dumps(g) + "\n" for g in GOLD))
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(["--gold", str(gold_path), "--rejudge", str(out), "--out", str(scratch / "rj2.jsonl"),
                 "--judge-key-env", "EVAL_FAKE_JUDGE_KEY", "--label", "rj2"])
check("edited gold item is re-judged, the other is not", fj.calls == 3)

# retrieval-only: no model call, no judge
n_before = len(fake.calls)
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(["--gold", str(gold_path), "--corpus", str(corpus_path), "--retrieval-only",
                 "--out", str(scratch / "rec.jsonl")])
_h3, rec = ev.read_run(scratch / "rec.jsonl")
check("retrieval-only makes no model call", len(fake.calls) == n_before and rec["t1"]["retrieved"])

# ── report ──────────────────────────────────────────────────────────────────
md = report.run_table(out)
check("report shows accuracy over graded items", "**100%** (2/2)" in md)
check("report shows the category table", "| follow-up | 1 |" in md)
fake_b = scratch / "b.jsonl"
rows = [json.dumps(head)] + [json.dumps({**r, "judge": {**r["judge"], "grade": "wrong"}} if r["id"] == "t1" else r)
                             for r in items.values()]
fake_b.write_text("\n".join(rows) + "\n")
d = report.diff_table(out, fake_b)
check("diff marks a regression", "| t1 | core | correct | wrong | worse |" in d)
sheet = report.blind_sample(out, 5, 3, gold_path)
body = sheet.split("## t", 1)[1]
check("blind sheet has answers and no grades",
      "30 life" in body and "**Your grade:** ______" in body
      and "correct" not in body and "fine" not in body)
grades = scratch / "owner.json"
grades.write_text(json.dumps({"t1": "correct", "t2": "partial"}))
ag = report.agreement(out, grades)
check("agreement arithmetic", "exact label: 50% (1/2)" in ag and "| t2 | partial | correct |" in ag)

# ── judge tools: run.py --tools, the run row's tool fields ─────────────────
check("the default run records tools off", head["tools"] == "off" and head["tools_offered"] == []
      and items["t1"]["tools_level"] == "off" and items["t1"]["tools"] == [])
check("⭐ a run row keeps the TEXT of every source the answer cited (tool rows are not in the corpus)",
      list(items["t1"]["cited_sources"]) == [items["t1"]["cited"][0]]
      and items["t1"]["cited_sources"][items["t1"]["cited"][0]]["text"])
out_l = scratch / "lookup.jsonl"
with contextlib.redirect_stdout(io.StringIO()):
    runner.main(argv[:argv.index("--out") + 1] + [str(out_l)] + argv[argv.index("--out") + 2:]
                + ["--tools", "lookup", "--ids", "t1", "--no-judge"])
hl, il = ev.read_run(out_l)
check("--tools lookup reaches core: the header and the row say so, lookups offered",
      hl["tools"] == "lookup" and "rule" in hl["tools_offered"] and "simulate" not in hl["tools_offered"]
      and il["t1"]["tools_level"] == "lookup")
check("…and the quote check's fields are recorded", il["t1"]["quote_fail"] == [] and il["t1"]["engine_mismatch"] == [])
lookup_call = fake.calls[-1]
check("…and the model was offered the lookup tools", {t["function"]["name"] for t in lookup_call.get("tools") or []}
      >= {"rule", "define", "card", "search"})
os.environ.pop("ALGO_BOT_TOKEN", None)
try:
    with contextlib.redirect_stdout(io.StringIO()):
        runner.main(argv[:argv.index("--out") + 1] + [str(scratch / "all.jsonl")] + argv[argv.index("--out") + 2:]
                    + ["--tools", "all", "--ids", "t1", "--no-judge"])
    check("--tools all without the engine refuses to start", False)
except SystemExit as exc:
    check("⭐ --tools all without the engine refuses to start (no run labelled all that never simulated)",
          "simulate is not offered" in str(exc))
os.environ.pop("ALGO_TOOLS", None)
tf = runner.tool_fields({"tools_level": "all", "tools": [{"name": "simulate", "ok": True}], "tool_rounds": 1,
                         "quote_fail": [{"tags": ["cr:1"], "quote": "x"}]},
                        [{"id": "engine:s1", "source_type": "engine", "metadata": {"engine": "abc123"}},
                         {"id": "cr:1", "source_type": "cr", "metadata": {}}])
check("tool_fields: level, calls, quote_fail and the engine build the simulation ran on",
      tf["tools_level"] == "all" and tf["tools"][0]["name"] == "simulate" and tf["engine"] == ["abc123"]
      and len(tf["quote_fail"]) == 1)

# ── grade_pack: blind shards ────────────────────────────────────────────────
import grade_pack  # noqa: E402

h_all = {**head, "label": "secret-label-all", "tools": "all"}
all_rows = [json.dumps(h_all)] + [json.dumps({**r, "tools_level": "all", "quote_fail": [{"tags": ["x:1"], "quote": "made up words"}],
                                              "tools": [{"name": "simulate"}]})
                                  for r in items.values()]
run_all_cfg = scratch / "cfg-all.jsonl"
run_all_cfg.write_text("\n".join(all_rows) + "\n")
pack, key = grade_pack.build([out, fake_b, run_all_cfg], "pack1", shard_size=3, seed=5, gold_path=gold_path,
                             out_root=scratch / "packs", primer="PRIMER-TEXT", corpus_rows=FIXTURE)
shards = sorted(pack.glob("shard-*.md"))
text = "\n".join(sh.read_text() for sh in shards)
check("answered items pooled across runs (2 answered × 3 runs), errors skipped",
      len(key["items"]) == 6 and len([k for k in key["skipped"] if k["why"] == "error"]) == 3)
check("shards of the asked size, with the primer once each",
      len(shards) == 2 and all(sh.read_text().count("PRIMER-TEXT") == 1 for sh in shards))
check("⭐ blind: no run label, run file or tools level in any shard",
      "secret-label-all" not in text and "fake" not in text and "cfg-all" not in text and "tools=" not in text)
check("…and the key, which says, sits OUTSIDE the shard directory",
      grade_pack.key_path(pack) == pack.parent / "pack1.key.json" and grade_pack.key_path(pack).exists()
      and not list(pack.glob("*key*")))
order = [key["items"][b]["run"] for b in sorted(key["items"])]
check("shuffled: the blind order is not the order the runs were given in",
      order != [str(p) for p in (out, out, fake_b, fake_b, run_all_cfg, run_all_cfg)])
bid = next(b for b, m in key["items"].items() if m["item"] == "t1" and m["config"].startswith("tools=off"))
sh = (pack / f"shard-{key['items'][bid]['shard']}.md").read_text()
item_md = sh.split(f"## {bid}", 1)[1].split("\n## ", 1)[0]
check("an item carries the question, the gold record and the evidence",
      "how much life do you start with" in item_md and "*expected:*" in item_md and "*must_not:* 20" in item_md)
check("⭐ the answer's tags are renumbered S1, S2 and every cited source's text is shown",
      "[S1]" in item_md and "[S2]" in item_md and "**S1**" in item_md
      and "did not resolve to any source" in item_md)
check("…with the deterministic checks: unresolved, quote check, must_cite",
      "unresolved (dropped before a reader saw them): 1" in item_md and "must_cite: card: Monke" in item_md)
bid_all = next(b for b, m in key["items"].items() if m["item"] == "t1" and m["config"].startswith("tools=all"))
sh_all = (pack / f"shard-{key['items'][bid_all]['shard']}.md").read_text().split(f"## {bid_all}", 1)[1]
check("a quote-check failure is shown as a fact", "quote check failures" in sh_all and "made up words" in sh_all)
check("the key keeps what report needs", key["items"][bid_all]["simulate_calls"] == 1
      and key["items"][bid_all]["quote_fail"] == 1 and key["items"][bid]["cost_usd"] is not None)
g_t1 = {g["id"]: g for g in GOLD}["t1"]
r_off = items["t1"]
src = r_off["cited_sources"]
chk = grade_pack.checks(r_off, g_t1, src)
r_cfg = {**r_off, "tools_level": "all", "tools": [{"name": "simulate"}], "engine": ["abc123"], "tool_rounds": 2,
         "model": "other-model", "reasoning_used": True, "label": "x"}
check("⭐ blind: the same answer from two configs renders byte-identically",
      grade_pack.render_item("b1", g_t1, r_off, src, chk) == grade_pack.render_item("b1", g_t1, r_cfg, src, chk))
check("renumber leaves card text alone", grade_pack.renumber("x [Augment] y [cr:1; card:A] [cr:1]", ["cr:1", "card:A"])
      == "x [Augment] y [S1; S2] [S1]")

# ── report --grades: merge the Claude-agent grades ──────────────────────────
ids = sorted(key["items"])
lines = []
for b in ids:
    m = key["items"][b]
    if m["config"].startswith("tools=all"):
        lines.append({"id": b, "grade": "correct", "invented": [], "note": "ok"})
    else:
        lines.append({"id": b, "grade": "wrong" if m["item"] == "t1" else "correct",
                      "invented": ["life is 31"] if m["item"] == "t1" else [], "note": ""})
(pack / "grades-1.jsonl").write_text("\n".join(json.dumps(x) for x in lines[:4]) + "\nnot json\n"
                                    + json.dumps({"id": ids[0], "grade": "great"}) + "\n")
(pack / "grades-2.jsonl").write_text("\n".join(json.dumps(x) for x in lines[4:5]) + "\n"
                                    + json.dumps(lines[0]) + "\n")
md = report.grades_report(pack)
row_off = next(l for l in md.splitlines() if l.startswith("| tools=off"))
row_all = next(l for l in md.splitlines() if l.startswith("| tools=all"))
n_all = sum(1 for x in lines[:5] if key["items"][x["id"]]["config"].startswith("tools=all"))
n_off = 5 - n_all
off_ok = sum(1 for x in lines[:5] if key["items"][x["id"]]["config"].startswith("tools=off") and x["grade"] == "correct")
check(f"⭐ accuracy per config from the graders' lines ({off_ok}/{n_off} off, {n_all}/{n_all} all)",
      f"| 2 | {n_off} | **{report._p(off_ok, n_off)}**" in row_off and f"| 1 | {n_all} | **100%**" in row_all)
check("invented = any claim listed or the invented_rule grade", "life is 31" in md)
check("the per-run table lists each repeat", md.count("`run.jsonl`") == 1 and md.count("`b.jsonl`") == 1)
check("⭐ the noise caveat is printed", "Noise." in md and "±5 points" in md)
check("bad lines are named, not guessed", "grades-1.jsonl:5: not JSON" in md
      and "unknown grade 'great'" in md and "graded twice" in md)
check("ungraded items are listed", "Not graded yet: " + ids[5] in md)
with contextlib.redirect_stdout(io.StringIO()) as buf:
    report.main(["--grades", str(pack)])
check("report.py --grades from the command line", "Agent-graded eval: pack1" in buf.getvalue())

print(f"test_eval: all {PASS} checks passed ✅")
