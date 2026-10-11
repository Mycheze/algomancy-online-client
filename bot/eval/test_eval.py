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

print(f"test_eval: all {PASS} checks passed ✅")
