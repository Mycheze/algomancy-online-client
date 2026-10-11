#!/usr/bin/env python3
"""
run.py — run the judge bot's real pipeline over the gold set, and grade it.

    .venv/bin/python bot/eval/run.py --label baseline            # prod model, all items, judged
    .venv/bin/python bot/eval/run.py --model deepseek-v4-pro --reasoning off --label pro
    .venv/bin/python bot/eval/run.py --corpus /path/to/other_corpus.jsonl --label cr-corpus
    .venv/bin/python bot/eval/run.py --retrieval-only --label recall   # free: no model, no judge
    .venv/bin/python bot/eval/run.py --rejudge var/eval/<run>.jsonl --judge-model …

Each item goes through `core.answer_question` exactly as a Discord or web
question does (retrieval, primer, system prompt, follow-up history, the math-mode
router, the retry/deadline), with only these swapped: the model/base URL/key
(`--model --base-url --api-key-env`), the reasoning mode, and the corpus the
retriever loads. The fallback model is OFF unless `--fallback` is given, so a
run measures one model.

Keys come from the environment only (`--api-key-env NAME` names the variable);
the repo's `.env` is read if the variable is not already set. A key on argv
would sit in shell history and `ps` — there is deliberately no flag for one.

Output: one JSONL file (`--out`, default var/eval/<date>-<label>.jsonl): a
header row (`type: run`) then one row per item (`type: item`). Re-running with
the same --out resumes: items already answered without error are skipped.
Judge verdicts are cached in var/eval/judge-cache.jsonl (see evallib.JudgeCache).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))     # bot/
sys.path.insert(0, str(HERE))            # bot/eval/

import paths                              # noqa: E402
import evallib as ev                      # noqa: E402

# Prices for judge models core's PRICES table does not carry (USD / 1M tokens).
# None today: the judge is a DeepSeek model, which core prices.
EXTRA_PRICES: dict = {}


def eval_dir() -> Path:
    return paths.var_dir() / "eval"


def load_dotenv():
    """Fill unset variables from the repo's .env (the main checkout's when run
    from a worktree). Values are never printed. ALGO_EVAL_NO_DOTENV=1 skips it
    (the offline test sets it, so a broken fake can never reach a real key)."""
    if os.environ.get("ALGO_EVAL_NO_DOTENV"):
        return
    cands = [paths.REPO_ROOT / ".env"]
    try:
        import subprocess
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=HERE,
                                capture_output=True, text=True, check=True).stdout.strip()
        cands.append((HERE / common).resolve().parent / ".env")
    except Exception:
        pass
    for p in cands:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip().removeprefix("export ").strip()
            v = v.strip().strip('"').strip("'")
            if k and v and not os.environ.get(k):
                os.environ[k] = v
        break


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--label", default=None, help="run name, used in the default --out")
    ap.add_argument("--model", default=None, help="answering model (default: core's LLM_MODEL)")
    ap.add_argument("--base-url", default=None, help="OpenAI-compatible base URL (default: core's)")
    ap.add_argument("--api-key-env", default=None,
                    help="NAME of the env var holding the answering key (default LLM_API_KEY/DEEPSEEK_API_KEY)")
    ap.add_argument("--reasoning", choices=("off", "on", "auto"), default="auto",
                    help="core's math-mode router: off, on (always), auto (production)")
    ap.add_argument("--corpus", default=None, help="corpus JSONL (default: the repo corpus)")
    ap.add_argument("--gold", default=str(ev.GOLD))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--ids", default=None, help="comma-separated item ids")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fallback", action="store_true", help="keep LLM_FALLBACK_MODEL if set")
    ap.add_argument("--retrieval-only", action="store_true", help="retrieval checks only; no model, no judge")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--judge-model", default="deepseek-v4-pro")
    ap.add_argument("--judge-base-url", default="https://api.deepseek.com")
    ap.add_argument("--judge-key-env", default="DEEPSEEK_API_KEY")
    ap.add_argument("--judge-reasoning", choices=("on", "off"), default="on")
    ap.add_argument("--rejudge", default=None, metavar="RUNFILE",
                    help="judge the answers in an existing run file (writes --out)")
    ap.add_argument("--max-cost", type=float, default=5.0,
                    help="stop starting new items once answer+judge spend passes this (USD)")
    return ap.parse_args(argv)


# ── the judge call ──────────────────────────────────────────────────────────

class Judge:
    def __init__(self, client, model, base_url, reasoning, cache: ev.JudgeCache):
        self.client, self.model, self.base_url = client, model, base_url
        self.reasoning, self.cache = reasoning, cache
        self.calls = 0

    async def grade(self, item, answer, hit_rows=()):
        """hit_rows: the chunks the bot retrieved, shown to the judge with the
        primer so a claim that rests on them is not mistaken for invention."""
        import core
        hit_rows = list(hit_rows)
        ctx = ev.sha(ev.sha(core.PRIMER), *[r["id"] for r in hit_rows])[:16]
        k = ev.JudgeCache.key(item, answer, self.model, ctx)
        hit = self.cache.get(k)
        if hit is not None:
            return {**hit, "cached": True}
        params = core.request_params(self.base_url, self.reasoning)
        params["max_tokens"] = 12000 if self.reasoning else 1500
        params.pop("temperature", None)
        if not self.reasoning:
            params["temperature"] = 0.0
        messages = [{"role": "system", "content": ev.JUDGE_SYSTEM},
                    {"role": "user", "content": ev.judge_user_message(
                        item, core.strip_citations(answer), core.PRIMER, hit_rows)}]
        last_err = None
        for attempt in range(3):
            t0 = time.monotonic()
            self.calls += 1
            try:
                resp = await self.client.chat.completions.create(
                    model=self.model, messages=messages,
                    response_format={"type": "json_object"}, **params)
                verdict = ev.parse_judge(resp.choices[0].message.content or "")
            except Exception as exc:          # a bad reply is retried, then recorded
                last_err = f"{type(exc).__name__}: {exc}"[:300]
                await asyncio.sleep(1 + attempt * 2)
                continue
            usage, reported = core.read_usage(resp)
            cost = None
            if self.model in EXTRA_PRICES and usage:
                p = EXTRA_PRICES[self.model]
                cost = round(((usage["prompt"] or 0) * p["in"] + (usage["completion"] or 0) * p["out"]) / 1e6, 8)
            else:
                cost, _ = core.cost_usd(self.model, usage, reported=reported)
            verdict.update({"judge_model": self.model, "rubric": ev.RUBRIC_SIG,
                            "judge_usage": usage, "judge_cost_usd": cost,
                            "judge_ms": round((time.monotonic() - t0) * 1000)})
            self.cache.put(k, verdict)
            return {**verdict, "cached": False}
        return {"grade": None, "error": last_err, "judge_model": self.model}


def make_judge(args):
    from openai import AsyncOpenAI
    key = os.environ.get(args.judge_key_env)
    if not key:
        raise SystemExit(f"judge key env var {args.judge_key_env} is not set")
    client = AsyncOpenAI(api_key=key, base_url=args.judge_base_url, timeout=240, max_retries=2)
    return Judge(client, args.judge_model, args.judge_base_url, args.judge_reasoning == "on",
                 ev.JudgeCache(eval_dir() / "judge-cache.jsonl"))


# ── one item ────────────────────────────────────────────────────────────────

async def run_item(item, measurable, judge, discord, retrieval_only=False):
    import core
    row = {"type": "item", "id": item["id"], "category": item.get("category"),
           "question": item["question"], "follow_up": bool(item.get("history")),
           "item_sig": ev.item_sig(item)}
    meta: dict = {}
    hits = []
    if retrieval_only:
        hits = await asyncio.to_thread(core.retriever.search, item["question"], k=core.TOP_K)
        row.update({"answer": None, "error": None})
    else:
        t0 = time.monotonic()
        try:
            answer, hits, reasoning = await core.answer_question(
                item["question"], list(item.get("history") or []), meta=meta)
            row.update({"answer": answer, "error": None, "reasoning_used": reasoning})
        except Exception as exc:
            hits = meta.get("hits") or []
            row.update({"answer": None, "error": f"{type(exc).__name__}: {exc}"[:400],
                        "reasoning_used": meta.get("reasoning")})
        row.update({
            "model": meta.get("model"), "provider": meta.get("provider"),
            "latency_ms": meta.get("latency_ms"),
            "total_ms": meta.get("total_ms") or round((time.monotonic() - t0) * 1000),
            "usage": meta.get("usage"), "cost_usd": meta.get("cost_usd"),
            "cost_basis": meta.get("cost_basis"), "attempts": meta.get("attempts"),
        })
    hit_rows = [r for _s, r in hits]
    row["retrieved"] = [r["id"] for r in hit_rows]
    row["retrieval"] = ev.retrieval_check(item, hit_rows, measurable, discord)
    if row.get("answer"):
        cited = ev.cited_tags(row["answer"])
        got = set(row["retrieved"])
        row["cited"] = cited
        row["cited_unresolved"] = [t for t in cited if t not in got]
    if judge and row.get("answer"):
        row["judge"] = await judge.grade(item, row["answer"], hit_rows)
    return row


def spent(row):
    c = row.get("cost_usd") or 0
    j = row.get("judge") or {}
    if not j.get("cached"):
        c += j.get("judge_cost_usd") or 0
    return c


async def main_async(args):
    load_dotenv()
    gold = ev.load_gold(args.gold)
    if args.ids:
        want = [s.strip() for s in args.ids.split(",") if s.strip()]
        missing = set(want) - {g["id"] for g in gold}
        if missing:
            raise SystemExit(f"unknown gold ids: {sorted(missing)}")
        gold = [g for g in gold if g["id"] in want]
    if args.limit:
        gold = gold[: args.limit]

    import core
    from retriever import Retriever
    corpus_path = Path(args.corpus) if args.corpus else Path(paths.CORPUS)
    if args.corpus:
        core.retriever = Retriever(corpus_path)
    rejudge, rj_head = None, {}
    if args.rejudge:
        rj_head, rejudge = ev.read_run(args.rejudge)
        if rj_head.get("corpus") and not args.corpus and Path(rj_head["corpus"]).is_file():
            corpus_path = Path(rj_head["corpus"])
            core.retriever = Retriever(corpus_path)
    core.REASONING_MODE = {"off": "off", "on": "always", "auto": "auto"}[args.reasoning]
    discord = ev.DiscordIndex()
    rows = core.retriever.rows
    measurable = {g["id"]: ev.measurable_cites(g, rows, discord) for g in gold}


    if not (args.retrieval_only or rejudge is not None):
        if not args.fallback:
            core.FALLBACK_MODEL = None
        key_env = args.api_key_env
        key = os.environ.get(key_env) if key_env else core.api_key()
        if not key:
            raise SystemExit(f"no API key: set {key_env or 'LLM_API_KEY / DEEPSEEK_API_KEY'}")
        core.init_client(key, base_url=args.base_url, model=args.model)
    judge = None if (args.retrieval_only or args.no_judge) else make_judge(args)

    label = args.label or ("recall" if args.retrieval_only else (args.model or core.LLM_MODEL))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = Path(args.out) if args.out else eval_dir() / f"{stamp}-{label}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)

    done = {}
    if out.exists():
        _prior_head, prior = ev.read_run(out)
        done = {i: r for i, r in prior.items()
                if not r.get("error") and (args.retrieval_only or r.get("answer"))
                and (judge is None or (r.get("judge") or {}).get("grade"))}
    header = {
        "type": "run", "label": label, "started": datetime.now(timezone.utc).isoformat(),
        "mode": "retrieval-only" if args.retrieval_only else ("rejudge" if rejudge else "full"),
        "model": None if args.retrieval_only else core.LLM_MODEL,
        "base_url": None if args.retrieval_only else core.LLM_BASE_URL,
        "reasoning": args.reasoning, "corpus": str(corpus_path),
        "corpus_sha": ev.sha(corpus_path.read_bytes())[:12], "corpus_chunks": len(rows),
        "engine_version": core.ENGINE_VERSION, "top_k": core.TOP_K,
        "gold": str(args.gold), "gold_sha": ev.sha(Path(args.gold).read_bytes())[:12],
        "items": len(gold), "judge_model": judge.model if judge else None,
        "judge_reasoning": args.judge_reasoning if judge else None,
        "rubric": ev.RUBRIC_SIG if judge else None, "rejudge_of": args.rejudge,
        "measurable_cites": sum(len(v) for v in measurable.values()),
        "total_cites": sum(len(g.get("must_cite") or []) for g in gold),
    }
    if rejudge is not None:
        for k in ("model", "base_url", "reasoning", "corpus", "corpus_sha", "engine_version"):
            header[k] = rj_head.get(k)
    with out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(header, ensure_ascii=False) + "\n")

    todo = [g for g in gold if g["id"] not in done
            and (rejudge is None or (rejudge.get(g["id"]) or {}).get("answer"))]
    print(f"[eval] {label}: {len(todo)} to run ({len(done)} already done) -> {out}")
    sem = asyncio.Semaphore(max(1, args.concurrency))
    lock = asyncio.Lock()
    total = {"usd": sum(spent(r) for r in done.values()), "n": 0, "stopped": False}

    async def one(item):
        async with sem:
            if total["usd"] >= args.max_cost:
                total["stopped"] = True
                return
            if rejudge is not None:
                prev = rejudge.get(item["id"])
                if not prev or not prev.get("answer"):
                    return
                row = {k: v for k, v in prev.items() if k != "judge"}
                by_id = {r["id"]: r for r in rows}
                row["judge"] = (await judge.grade(item, prev["answer"],
                                                  [by_id[i] for i in prev.get("retrieved") or [] if i in by_id])
                                if judge else None)
                row["cost_usd"] = 0       # the answer was paid for in the original run
            else:
                row = await run_item(item, measurable[item["id"]], judge, discord,
                                     retrieval_only=args.retrieval_only)
            async with lock:
                total["usd"] += spent(row)
                total["n"] += 1
                with out.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                g = (row.get("judge") or {}).get("grade") or ("ERR" if row.get("error") else "-")
                print(f"  [{total['n']:>3}/{len(todo)}] {row['id']} {g:<13} "
                      f"{(row.get('total_ms') or 0) / 1000:5.1f}s  ${total['usd']:.4f}", flush=True)

    await asyncio.gather(*(one(g) for g in todo))
    if total["stopped"]:
        print(f"[eval] STOPPED: spend passed --max-cost ${args.max_cost}")
    print(f"[eval] done: {out}  (spend this run+resumed ≈ ${total['usd']:.4f})")
    return out


def main(argv=None):
    args = parse_args(argv)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
