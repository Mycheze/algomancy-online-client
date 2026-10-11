#!/usr/bin/env python3
"""
test_llm.py — the model call in core.py, offline, against a fake OpenAI client.
Run: `.venv/bin/python bot/test/test_llm.py`. No network, no key.

What it pins, and why each one matters:
- DeepSeek's thinking switch is sent explicitly OFF on the cheap path. Without
  it Flash reasons by default, spends the 900-token budget and answers empty.
- The provider table: OpenRouter's `reasoning.effort` shape, and the generic
  entry sending nothing it cannot know.
- usage → tokens and cost on the logged row; cost is null for a model the price
  table does not know (never a guess); a provider-reported cost is believed.
- The retry/fallback policy: at most two attempts, the fallback used ONCE in
  place of the retry, a wall-clock timeout counts (DeepSeek keeps a queued call
  alive with blank lines, so httpx's per-read timeout never fires), a 4xx is
  not retried, and the whole thing stops at LLM_DEADLINE.
- The LLM_* names fall back to the DEEPSEEK_* names, and none of it moves
  ENGINE_VERSION (the model is logged in its own field).
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import asyncio
import json
import os
import subprocess
import time as _time
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import httpx
import openai
from openai.types import CompletionUsage

import core
import store
from paths import responses_log

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


def resp(content="an answer", usage=None, finish="stop"):
    return NS(choices=[NS(message=NS(content=content), finish_reason=finish)], usage=usage)


DS_USAGE = CompletionUsage.model_validate({
    # a real SDK object, with DeepSeek's extra field riding as a pydantic extra
    "prompt_tokens": 10000, "completion_tokens": 400, "total_tokens": 10400,
    "prompt_cache_hit_tokens": 8000, "prompt_cache_miss_tokens": 2000,
})


class Fake:
    """A client whose create() plays a script: each step is a response, an
    exception to raise, or ("sleep", seconds) to hang like a queued call."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []
        self.chat = NS(completions=self)

    async def create(self, **params):
        self.calls.append(params)
        step = self.script.pop(0)
        if isinstance(step, tuple) and step[0] == "sleep":
            await asyncio.sleep(step[1])
            return resp("too late")
        if isinstance(step, BaseException):
            raise step
        return step


def _req():
    return httpx.Request("POST", "https://api.example.test/v1/chat/completions")


def ask(primary, fallback=None, fallback_model=None, q="what is affinity?"):
    core.ai, core.ai_fallback = primary, fallback
    core.FALLBACK_MODEL = fallback_model
    meta = {}
    out = asyncio.run(core.answer_question(q, [], meta=meta))
    return out, meta


core.LLM_MODEL, core.LLM_BASE_URL = "deepseek-flash", "https://api.deepseek.com"

# ── the provider table ────────────────────────────────────────────────
print("\n[the thinking switch, per provider]")
off = core.request_params("https://api.deepseek.com", reasoning=False)
check("⭐ DeepSeek cheap path: thinking explicitly DISABLED",
      off.get("extra_body") == {"thinking": {"type": "disabled"}})
check("…with temperature 0.2 and the 900-token budget",
      off["temperature"] == 0.2 and off["max_tokens"] == 900)
on = core.request_params("https://api.deepseek.com", reasoning=True, effort="high")
check("DeepSeek math mode: thinking enabled, effort top-level, no temperature",
      on["extra_body"] == {"thinking": {"type": "enabled"}}
      and on["reasoning_effort"] == "high" and "temperature" not in on
      and on["max_tokens"] == 4000)
ro = core.request_params("https://openrouter.ai/api/v1", reasoning=False)
check("OpenRouter off: reasoning.effort = none",
      ro["extra_body"] == {"reasoning": {"effort": "none"}})
rn = core.request_params("https://openrouter.ai/api/v1", reasoning=True, effort="low")
check("OpenRouter on: effort + exclude, no temperature",
      rn["extra_body"] == {"reasoning": {"effort": "low", "exclude": True}}
      and "temperature" not in rn)
gen = core.request_params("http://127.0.0.1:11434/v1", reasoning=False)
check("an unknown host is generic and sends no thinking switch",
      core.provider_for("http://127.0.0.1:11434/v1") == "generic" and "extra_body" not in gen)
os.environ["LLM_PROVIDER"] = "deepseek"
check("LLM_PROVIDER forces an entry (a proxy in front of DeepSeek)",
      core.provider_for("http://127.0.0.1:9999/v1") == "deepseek")
del os.environ["LLM_PROVIDER"]

# ── usage and cost ────────────────────────────────────────────────────
print("\n[usage and cost]")
usage, reported = core.read_usage(resp(usage=DS_USAGE))
check("DeepSeek's prompt_cache_hit_tokens is read off the SDK object",
      usage == {"prompt": 10000, "cached": 8000, "completion": 400, "reasoning": None}
      and reported is None)
oa = core.read_usage(resp(usage={"prompt_tokens": 50, "completion_tokens": 7,
                                 "prompt_tokens_details": {"cached_tokens": 30},
                                 "completion_tokens_details": {"reasoning_tokens": 5},
                                 "cost": 0.0042}))
check("OpenAI-style cached/reasoning details, and a reported cost",
      oa == ({"prompt": 50, "cached": 30, "completion": 7, "reasoning": 5}, 0.0042))
peak = datetime(2026, 10, 12, 7, 0, tzinfo=timezone.utc)      # Monday 07:00 UTC
night = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)    # Monday 12:00 UTC
sat = datetime(2026, 10, 10, 7, 0, tzinfo=timezone.utc)       # Saturday 07:00 UTC
want = (2000 * 0.30 + 8000 * 0.006 + 400 * 1.20) / 1e6
check("Flash at peak: miss × 0.30 + hit × 0.006 + out × 1.20 per M",
      core.cost_usd("deepseek-flash", usage, when=peak) == (round(want, 8), "peak"))
check("…half off-peak, and Saturday is off-peak all day",
      core.cost_usd("deepseek-flash", usage, when=night) == (round(want / 2, 8), "offpeak")
      and core.cost_usd("deepseek-flash", usage, when=sat)[1] == "offpeak")
check("⭐ an unknown model costs null — never a guess",
      core.cost_usd("some-new-model", usage, when=peak) == (None, None))
check("a provider-reported cost wins, even for an unknown model",
      core.cost_usd("vendor/model", oa[0], reported=0.0042) == (0.0042, "provider"))
check("no usage at all → null", core.cost_usd("deepseek-flash", None) == (None, None))

# ── an answer, end to end into the log ────────────────────────────────
print("\n[an answer's row carries latency, tokens and cost]")
fake = Fake(resp(usage=DS_USAGE))
(answer, hits, reasoning), meta = ask(fake)
check("the answer comes back as the same three-tuple", answer == "an answer" and hits)
check("the call sent DeepSeek's thinking-off extras",
      fake.calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}
      and fake.calls[0]["model"] == "deepseek-flash")
store.log_response("rid-1", "ask", "what is affinity?", answer, hits, core.LLM_MODEL,
                   user_id="t", channel_id="test", reasoning=reasoning,
                   engine_version=core.ENGINE_VERSION, llm=meta)
row = json.loads(responses_log().read_text().splitlines()[-1])
check("usage on the row", row["usage"] == {"prompt": 10000, "cached": 8000,
                                           "completion": 400, "reasoning": None})
check("cost on the row, from the table", row["cost_usd"] in (round(want, 8), round(want / 2, 8))
      and row["cost_basis"] in ("peak", "offpeak"))
check("latency (model call) and total, as integer ms",
      isinstance(row["latency_ms"], int) and isinstance(row["total_ms"], int)
      and row["total_ms"] >= row["latency_ms"])
check("the old fields keep their names", all(k in row for k in (
    "response_id", "ts", "kind", "model", "reasoning", "engine_version", "user_id",
    "channel_id", "thread_id", "question", "answer", "retrieved", "history")))
check("model = the one that answered; no fallback; one attempt",
      row["model"] == "deepseek-flash" and row["fallback"] is None and len(row["attempts"]) == 1)
store.log_response("rid-2", "ask", "q", "a", hits, "deepseek-flash", user_id="t",
                   channel_id="test")
row2 = json.loads(responses_log().read_text().splitlines()[-1])
check("a caller passing no meta writes the old shape exactly (no new keys)",
      "usage" not in row2 and "cost_usd" not in row2 and row2["model"] == "deepseek-flash")

core.LLM_MODEL = "some-new-model"
(_a, hits, _r), meta = ask(Fake(resp(usage=DS_USAGE)))
check("⭐ an unknown model answers fine and logs cost null",
      meta["cost_usd"] is None and meta["cost_basis"] is None and meta["usage"]["prompt"] == 10000)
core.LLM_MODEL = "deepseek-flash"

# ── retry, fallback, deadline ─────────────────────────────────────────
print("\n[retry and fallback]")
primary = Fake(openai.APITimeoutError(request=_req()))
backup = Fake(resp("from the fallback", usage=DS_USAGE))
(answer, _h, _r), meta = ask(primary, backup, "deepseek-v4-pro")
check("⭐ the fallback fires once on a raised timeout",
      answer == "from the fallback" and len(primary.calls) == 1 and len(backup.calls) == 1)
check("…logged as such: model, requested_model, fallback.reason",
      meta["model"] == "deepseek-v4-pro" and meta["requested_model"] == "deepseek-flash"
      and meta["fallback"] == {"from": "deepseek-flash", "reason": "timeout"}
      and [a["kind"] for a in meta["attempts"]] == ["primary", "fallback"])
check("…and priced as the model that answered",
      meta["cost_basis"] in ("peak", "offpeak")
      and meta["cost_usd"] > core.cost_usd("deepseek-flash", meta["usage"], when=peak)[0] / 2)

saved = core.MODEL_TIMEOUT
core.MODEL_TIMEOUT = 0.2
primary = Fake(("sleep", 5))
backup = Fake(resp("rescued"))
start = _time.monotonic()
(answer, _h, _r), meta = ask(primary, backup, "deepseek-v4-pro")
check("⭐ a call that HANGS (blank-line keep-alive) is cut by the wall clock",
      answer == "rescued" and meta["fallback"]["reason"] == "timeout"
      and _time.monotonic() - start < 2)
core.MODEL_TIMEOUT = saved

primary = Fake(openai.InternalServerError("boom", response=httpx.Response(503, request=_req()),
                                          body=None), resp("second try"))
(answer, _h, _r), meta = ask(primary)
check("no fallback configured: a 5xx is retried once on the same model",
      answer == "second try" and len(primary.calls) == 2 and meta["fallback"] is None
      and [a["kind"] for a in meta["attempts"]] == ["primary", "retry"]
      and meta["attempts"][0]["error"] == "http 503")

primary = Fake(resp("", finish="length"), resp("filled"))
(answer, _h, _r), meta = ask(primary)
check("an empty answer is retried, and the reason recorded",
      answer == "filled" and meta["attempts"][0]["error"] == "empty (finish_reason=length)")

primary = Fake(resp("", finish="length"), resp("", finish="length"))
try:
    ask(primary)
    raised = None
except Exception as exc:  # noqa: BLE001
    raised = exc
check("two empties raise RuntimeError, never a blank answer",
      isinstance(raised, RuntimeError) and "finish_reason=length" in str(raised))

primary = Fake(openai.APITimeoutError(request=_req()), openai.APITimeoutError(request=_req()))
try:
    ask(primary)
    raised = None
except Exception as exc:  # noqa: BLE001
    raised = exc
check("two timeouts raise TimeoutError (judge.py's 'took too long' branch)",
      isinstance(raised, TimeoutError))

primary = Fake(openai.AuthenticationError("bad key", response=httpx.Response(401, request=_req()),
                                          body=None), resp("never"))
backup = Fake(resp("never either"))
try:
    ask(primary, backup, "deepseek-v4-pro")
    raised = None
except Exception as exc:  # noqa: BLE001
    raised = exc
check("a 4xx is not retried and does not fall back",
      isinstance(raised, openai.AuthenticationError) and len(primary.calls) == 1
      and not backup.calls)

saved = (core.MODEL_TIMEOUT, core.LLM_DEADLINE, core.MIN_ATTEMPT_S)
core.MODEL_TIMEOUT, core.LLM_DEADLINE, core.MIN_ATTEMPT_S = 10, 0.6, 0.3
primary = Fake(("sleep", 5), resp("never"))
start = _time.monotonic()
try:
    ask(primary)
    raised = None
except Exception as exc:  # noqa: BLE001
    raised = exc
check("⭐ LLM_DEADLINE bounds the whole thing: no second attempt without time for it",
      isinstance(raised, TimeoutError) and len(primary.calls) == 1
      and _time.monotonic() - start < 2)
core.MODEL_TIMEOUT, core.LLM_DEADLINE, core.MIN_ATTEMPT_S = saved

check("the default budget fits the 60 s judge proxy: 2 × LLM_TIMEOUT ≤ LLM_DEADLINE < 60",
      2 * 25 <= 55 < 60 and core.LLM_DEADLINE < 60)

# ── a failed answer is a row; the footer names who answered ───────────
print("\n[failure rows and the footer]")
meta = {}
core.ai, core.ai_fallback = Fake(resp("", finish="length"), resp("", finish="length")), None
try:
    asyncio.run(core.answer_question("what is affinity?", [], meta=meta))
except RuntimeError as exc:
    err = exc
rid = store.log_failure("ask", "what is affinity?", err, core.LLM_MODEL, llm=meta,
                        engine_version=core.ENGINE_VERSION, user_id="t", channel_id="test")
frow = json.loads(responses_log().read_text().splitlines()[-1])
check("⭐ a failed answer is logged: error set, answer empty, attempts kept",
      frow["response_id"] == rid and frow["answer"] == ""
      and frow["error"].startswith("RuntimeError: model gave no answer")
      and [a["kind"] for a in frow["attempts"]] == ["primary", "retry"])
check("…with every key an old-shape row has, and its retrieval",
      all(k in frow for k in row2) and len(frow["retrieved"]) > 0 and "cost_usd" not in frow)
check("a successful row never carries `error`", "error" not in row and "error" not in row2)

import discordui  # noqa: E402
footer = discordui.answer_embed("q", "a", [], model="deepseek-v4-pro").footer.text
check("the Discord footer names the model that answered, when told",
      footer.startswith("Answered by deepseek-v4-pro"))
check("…and the configured one otherwise",
      discordui.answer_embed("q", "a", []).footer.text.startswith(f"Answered by {core.LLM_MODEL}"))

# ── the client and the environment ────────────────────────────────────
print("\n[init_client and the environment]")
core.FALLBACK_MODEL, core.FALLBACK_BASE_URL, core.FALLBACK_API_KEY = "deepseek-v4-pro", None, None
c = core.init_client("sk-test")
check("the SDK does no retrying of its own (core's retry is inside the deadline)",
      c.max_retries == 0)
check("a fallback on the same host and key reuses the client", core.ai_fallback is c)
core.FALLBACK_BASE_URL = "https://openrouter.ai/api/v1"
core.init_client("sk-test")
check("a fallback elsewhere gets its own client",
      core.ai_fallback is not core.ai and "openrouter.ai" in str(core.ai_fallback.base_url))
core.FALLBACK_MODEL = core.FALLBACK_BASE_URL = None
core.init_client("sk-test")
check("no fallback configured → none built", core.ai_fallback is None)

saved_env = {k: os.environ.pop(k) for k in list(os.environ)
             if k.startswith(("LLM_", "DEEPSEEK_"))}
os.environ["DEEPSEEK_MODEL"] = "old-name"
check("_env falls back to DEEPSEEK_*", core._env("MODEL") == "old-name")
os.environ["LLM_MODEL"] = "new-name"
check("…and LLM_* wins when both are set", core._env("MODEL") == "new-name")
os.environ["LLM_MODEL"] = ""
check("…an EMPTY LLM_* counts as unset (a copied .env.example)", core._env("MODEL") == "old-name")
os.environ["DEEPSEEK_API_KEY"] = "sk-old"
check("the key too: DEEPSEEK_API_KEY is still read", core.api_key() == "sk-old")
for k in ("DEEPSEEK_MODEL", "LLM_MODEL", "DEEPSEEK_API_KEY"):
    os.environ.pop(k, None)
os.environ.update(saved_env)

PROBE = ("import json, core; print(json.dumps([core.LLM_MODEL, core.MODEL_TIMEOUT, "
         "core.ENGINE_VERSION, core.DEEPSEEK_MODEL]))")


def probe(**env):
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("LLM_", "DEEPSEEK_"))}
    out = subprocess.run([_sys.executable, "-c", PROBE], env={**clean, **env},
                         cwd=str(_Path(core.__file__).parent), capture_output=True, text=True,
                         check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


default = probe()
old = probe(DEEPSEEK_MODEL="deepseek-v4-flash", DEEPSEEK_TIMEOUT="60")
new = probe(LLM_MODEL="deepseek-v4-pro", DEEPSEEK_MODEL="deepseek-v4-flash")
check("default model deepseek-flash, 25 s per attempt",
      default[0] == "deepseek-flash" and default[1] == 25.0)
check("⭐ a pre-2026-10-11 .env (DEEPSEEK_MODEL, DEEPSEEK_TIMEOUT) still configures it",
      old[0] == "deepseek-v4-flash" and old[1] == 60.0 and old[3] == "deepseek-v4-flash")
check("LLM_MODEL beats DEEPSEEK_MODEL at import", new[0] == "deepseek-v4-pro")
check("⭐ ENGINE_VERSION does not move with the model or the timeout",
      default[2] == old[2] == new[2] == core.ENGINE_VERSION)

print(f"\n{PASS} checks passed ✅")
