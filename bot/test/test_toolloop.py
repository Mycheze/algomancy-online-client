#!/usr/bin/env python3
"""
test_toolloop.py — the judge tools loop in core.py (core._run_tools), offline,
against a fake OpenAI client and a stub tools module. No network, no key.
Run: `.venv/bin/python bot/test/test_toolloop.py`.

What it pins (judge tools design §2–§3):
- ALGO_TOOLS=off (the default) sends the pre-tools request byte for byte,
  footnotes read as before and the quote check does not run: deploying this
  changes nothing until the switch is flipped.
- The caps: ≤ 3 tool rounds (2 with thinking), ≤ 6 calls (parallel calls
  count one each), ≤ 2 simulate; then ONE final call with tool_choice "none".
- The deadline: a round starts only with TOOL_ROUND_MIN_S left, else the next
  call is the final one; one retry/fallback budget for the whole answer.
- reasoning_content goes back on the turn's tool-call messages with thinking
  on, never with it off, and never across questions (a thinking follow-up
  answers without tools: DeepSeek would 400 on history with no reasoning).
- simulate is offered only at "all" and only with ALGO_BOT_TOKEN set.
- Tool rows join the citation hits; trust caveats are appended to footnotes in
  code; the quote check runs on the answer; meta["tools"] reaches the log.
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
from types import SimpleNamespace as NS

import openai
# the HTTP library openai ITSELF uses: openai 3.x moved to httpx2 (same API, new
# name), older releases use httpx. The fakes below must be built from the same one,
# and a fresh `pip install -r bot/requirements.txt` has only the one openai pulls in
# (2026-11-04: the steward box and the VPS had openai 3, no httpx; the laptop, both).
import openai._base_client as _openai_base
httpx = getattr(_openai_base, "httpx2", None) or _openai_base.httpx
from openai.types import CompletionUsage

for k in ("ALGO_TOOLS", "ALGO_BOT_TOKEN", "LLM_REASONING", "DEEPSEEK_REASONING"):
    os.environ.pop(k, None)

import core
import store
from paths import responses_log

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


USAGE = CompletionUsage.model_validate({
    "prompt_tokens": 10000, "completion_tokens": 400, "total_tokens": 10400,
    "prompt_cache_hit_tokens": 8000, "prompt_cache_miss_tokens": 2000})


def tc(name, args, i=0):
    return NS(id=f"call_{name}_{i}", type="function",
              function=NS(name=name, arguments=args if isinstance(args, str) else json.dumps(args)))


def say(content="an answer", reasoning=None):
    return NS(choices=[NS(message=NS(content=content, tool_calls=None, reasoning_content=reasoning),
                          finish_reason="stop")], usage=USAGE)


def calls(*tcs, reasoning=None, content=""):
    return NS(choices=[NS(message=NS(content=content, tool_calls=list(tcs), reasoning_content=reasoning),
                          finish_reason="tool_calls")], usage=USAGE)


class Fake:
    """create() plays a script: a response, an exception, ("sleep", s, resp),
    or a callable(params) -> response. Every request is deep-copied on entry,
    so a later mutation of the loop's message list cannot rewrite history."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []
        self.chat = NS(completions=self)

    async def create(self, **params):
        self.calls.append(json.loads(json.dumps(params)))
        step = self.script.pop(0)
        if isinstance(step, tuple) and step[0] == "sleep":
            await asyncio.sleep(step[1])
            return step[2]
        if isinstance(step, BaseException):
            raise step
        if callable(step):
            return step(params)
        return step


# ── the stub tools module (the frozen A↔B interface) ───────────────────
DISPATCHED = []


def _dispatch(name, args):
    DISPATCHED.append((name, args))
    if name == "rule":
        num = args.get("num", "?")
        return (f"[cr:{num}] {num} Every target is chosen as the effect is put on the stack.",
                {"id": f"cr:{num}", "source": "Algomancy-Comprehensive-Rules.json",
                 "source_type": "cr", "authority": 1,
                 "authority_label": "Comprehensive Rules (unofficial)", "title": f"CR {num}",
                 "text": f"{num} Every target is chosen as the effect is put on the stack.",
                 "metadata": {"kind": "rule", "num": num, "engineDiffers": num == "802.17",
                              "verdict": "partial" if num == "802.8c" else None,
                              "basis": "owner" if num == "700.9" else "printed"}})
    if name == "card":
        return "[card:Abduct] Gain control of target unit.", {
            "id": "card:Abduct", "source_type": "card", "title": "Abduct",
            "source": "AlgomancyCards-OracleText.json", "authority": 1,
            "authority_label": "canonical card data", "text": "Gain control of target unit."}
    if name == "simulate":
        return "[engine:s1] board: you: Towering Colossus 3/1", {
            "id": "engine:s1", "source_type": "engine", "title": "simulation s1",
            "source": "engine", "authority": 2, "authority_label": "online client engine",
            "text": "Towering Colossus becomes 3/1",
            "metadata": {"engine": "abc1234def", "board": "you: Towering Colossus 10/15",
                         "final": {"units": [{"stats": "3/1"}]}}}
    if name == "define":
        return "[cr:glossary.spell-effect] … [cr:110.3a] …", {
            "id": "cr:glossary.spell-effect", "source_type": "cr", "title": "spell effect",
            "text": "Spell effect: the effect of a spell on the stack.",
            "metadata": {"kind": "glossary", "term": "spell effect"},
            "extra_rows": [{"id": "cr:110.3a", "source_type": "cr", "title": "CR 110.3a",
                            "text": "110.3a A spell effect is an effect.",
                            "metadata": {"kind": "rule", "num": "110.3a", "nums": ["110.3a"]}}]}
    if name == "oops":
        return "oops: no such thing.", {"id": "tool:error", "source_type": "tool",
                                        "text": "oops: no such thing.", "metadata": {"error": True}}
    if name == "boom":
        raise ValueError("kaboom")
    raise KeyError(name)


def _schema(name):
    return {"type": "function", "function": {
        "name": name, "description": f"stub {name}",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": True}}}


STUB = NS(TOOLS=[_schema(n) for n in ("rule", "card", "boom", "simulate")], dispatch=_dispatch)


def names(params):
    return [s["function"]["name"] for s in params.get("tools") or []]


def ask(primary, q="what is affinity?", history=(), fallback=None, surface="web", stub=STUB):
    core.ai, core.ai_fallback = primary, fallback
    core.FALLBACK_MODEL = "fb-model" if fallback else None
    core._tools_mod = stub
    DISPATCHED.clear()
    meta = {}
    out = asyncio.run(core.answer_question(q, list(history), meta=meta, surface=surface))
    return out, meta


core.LLM_MODEL, core.LLM_BASE_URL = "deepseek-flash", "https://api.deepseek.com"
MATH_Q = "a 3/1 attacks a 2/2, how much damage is dealt?"
assert core.needs_reasoning(MATH_Q) and not core.needs_reasoning("what is affinity?")
HIST = [{"role": "user", "content": "what is a column?"},
        {"role": "assistant", "content": "A column holds two units [manual:0001]."}]

# ── off: byte-identical ───────────────────────────────────────────────
print("\n[ALGO_TOOLS=off is the default, and changes nothing]")
check("unset means off", core.tools_level() == "off")
os.environ["ALGO_TOOLS"] = "banana"
check("an unrecognised value means off", core.tools_level() == "off")
del os.environ["ALGO_TOOLS"]

for q, hist in (("what is affinity?", []), (MATH_Q, []), ("and a row?", HIST)):
    c = Fake(say('It says "a fabricated sentence nobody printed" [cr:603.2].'))
    (answer, hits, reasoning), meta = ask(c, q=q, history=hist)
    sent = c.calls[0]
    # The pre-tools request, rebuilt the way core built it before tools existed.
    want_msgs = [{"role": "system", "content": f"{core.SYSTEM_PROMPT}\n\n{core.PRIMER}"}]
    for m in hist:
        want_msgs.append({"role": "assistant", "content": core.strip_citations(m["content"])}
                         if m["role"] == "assistant" else m)
    want = {"model": "deepseek-flash", "messages": want_msgs + [sent["messages"][-1]],
            **core.request_params(core.LLM_BASE_URL, reasoning)}
    check(f"⭐ off, {'thinking' if reasoning else 'plain'}{', follow-up' if hist else ''}: "
          f"the request is byte-identical to the pre-tools one",
          json.dumps(sent, sort_keys=True) == json.dumps(want, sort_keys=True)
          and "tools" not in sent and "tool_choice" not in sent and len(c.calls) == 1)
check("off: the quote check does not run (the answer comes back as the model wrote it)",
      answer == 'It says "a fabricated sentence nobody printed" [cr:603.2].')
check("off: no tools keys in meta", not any(k in meta for k in (
    "tools", "tools_level", "quote_fail", "tool_rounds", "model_calls")))
check("off: ENGINE_VERSION has no .t axis", ".t" not in core.ENGINE_VERSION.split(".r", 1)[1])
flagged = {"id": "cr:802.17", "source_type": "cr", "title": "CR 802.17", "source": "x",
           "metadata": {"kind": "rule", "num": "802.17", "nums": ["802.17"],
                        "engine_differs": True, "basis": ["owner"]}}
check("off: a flagged CR footnote reads as it always did", core.friendly_source(flagged) == "CR 802.17")

# ── lookup: one call when the slate is enough ──────────────────────────
print("\n[ALGO_TOOLS=lookup: round 0 is today's request plus tools]")
os.environ["ALGO_TOOLS"] = "lookup"
c = Fake(say("an answer"))
(answer, hits, _r), meta = ask(c)
sent = c.calls[0]
check("one call, tool_choice auto, the lookup tools offered (simulate and its kin not)",
      len(c.calls) == 1 and sent["tool_choice"] == "auto"
      and names(sent) == ["rule", "card", "boom"])
check("the system message gains the tools section; no engine wording without simulate",
      core.TOOL_PROMPT in sent["messages"][0]["content"]
      and "engine result" not in sent["messages"][0]["content"]
      and sent["messages"][0]["content"].startswith(core.SYSTEM_PROMPT)
      and sent["messages"][0]["content"].endswith(core.PRIMER))
os.environ["ALGO_TOOLS"] = "off"
c_off = Fake(say("an answer"))
ask(c_off)
os.environ["ALGO_TOOLS"] = "lookup"
off_sent = c_off.calls[0]
check("…and nothing else in the request changes (same question with tools off)",
      {k: v for k, v in sent.items() if k not in ("tools", "tool_choice")}
      == {**off_sent, "messages": [sent["messages"][0], *off_sent["messages"][1:]]}
      and sent["messages"][0]["content"].replace(core.TOOL_PROMPT + "\n\n", "")
      == off_sent["messages"][0]["content"])
check("meta: level, no tool calls, one model call",
      meta["tools_level"] == "lookup" and meta["tools"] == [] and meta["model_calls"] == 1)

c = Fake(say("an answer"))
(answer, hits, _r), meta = ask(c, stub=None)
check("tools module absent: no tools offered, the plain request goes",
      "tools" not in c.calls[0] and answer == "an answer")

# ── a tool round ──────────────────────────────────────────────────────
print("\n[a tool round]")
c = Fake(calls(tc("rule", {"num": "603.2a"})),
         say('The rules say "Every target is chosen as the effect is put on the stack" '
             '(CR 603.2a) [cr:603.2a].'))
(answer, hits, _r), meta = ask(c)
second = c.calls[1]
asst, tool = second["messages"][-2], second["messages"][-1]
check("the tool ran with the model's arguments", DISPATCHED == [("rule", {"num": "603.2a"})])
check("the second request carries the assistant's tool call and the tool result",
      asst["role"] == "assistant" and asst["tool_calls"][0]["function"]["name"] == "rule"
      and tool == {"role": "tool", "tool_call_id": "call_rule_0",
                   "content": "[cr:603.2a] 603.2a Every target is chosen as the effect is put on the stack."})
check("…with tool_choice still auto (a round is left)", second["tool_choice"] == "auto")
check("⭐ the tool's row joins the citation hits, so the tag renders",
      hits[-1][1]["id"] == "cr:603.2a"
      and core.render_citations(answer, hits)[1][0][1]["id"] == "cr:603.2a")
check("an honest quote of the tool result passes the quote check",
      answer.startswith('The rules say "Every') and "quote_fail" not in meta)
check("meta.tools logs name, args, ms, ok, chars",
      meta["tools"][0]["name"] == "rule" and meta["tools"][0]["args"] == {"num": "603.2a"}
      and meta["tools"][0]["ok"] is True and meta["tools"][0]["chars"] > 10
      and isinstance(meta["tools"][0]["ms"], int) and meta["tool_rounds"] == 1)
check("usage and cost are summed over both calls",
      meta["usage"]["prompt"] == 20000 and meta["usage"]["completion"] == 800
      and meta["model_calls"] == 2 and meta["cost_usd"] is not None)

store.log_response("r1", "ask", "q", answer, hits, core.LLM_MODEL, user_id="t", channel_id="test",
                   engine_version=core.ENGINE_VERSION, llm=meta)
row = json.loads(responses_log().read_text().splitlines()[-1])
check("⭐ the log row carries tools, tools_level and the tool row in `retrieved`",
      row["tools"][0]["name"] == "rule" and row["tools_level"] == "lookup"
      and row["retrieved"][-1]["id"] == "cr:603.2a")

print("\n[a fabricated quote of a tool result]")
c = Fake(calls(tc("rule", {"num": "603.2"})),
         say('The rules say "targets may be chosen later" (CR 603.2) [cr:603.2]. Done.'))
(answer, hits, _r), meta = ask(c)
check("⭐ the quote check strips the quotation marks and the citation",
      answer == "The rules say targets may be chosen later (CR 603.2). Done.")
store.log_response("r2", "ask", "q", answer, hits, core.LLM_MODEL, user_id="t", channel_id="test",
                   engine_version=core.ENGINE_VERSION, llm=meta)
row = json.loads(responses_log().read_text().splitlines()[-1])
check("…and quote_fail reaches the log row", row["quote_fail"][0]["tags"] == ["cr:603.2"])

print("\n[several sources from one call; error rows cite nothing]")
STUB.TOOLS += [_schema("define"), _schema("oops")]
c = Fake(calls(tc("define", {"term": "spell effect"}), tc("oops", {}, 1)),
         say("A spell effect [cr:glossary.spell-effect] is an effect [cr:110.3a]."))
(answer, hits, _r), meta = ask(c)
check("⭐ a result's extra_rows join the hits too, so their tags render",
      [r["id"] for _s, r in hits[-2:]] == ["cr:glossary.spell-effect", "cr:110.3a"]
      and len(core.render_citations(answer, hits)[1]) == 2
      and all("extra_rows" not in r for _s, r in hits))
check("an error row is not citable, and its call logs ok: false",
      all(r["id"] != "tool:error" for _s, r in hits)
      and [t["ok"] for t in meta["tools"]] == [True, False])
STUB.TOOLS = STUB.TOOLS[:-2]

# ── caps ──────────────────────────────────────────────────────────────
print("\n[caps]")
greedy = lambda params: calls(tc("rule", {"num": "1.1"}, len(params["messages"])))
c = Fake(greedy, greedy, greedy, say("final"))
(answer, hits, _r), meta = ask(c)
check("⭐ at most 3 tool rounds, then a 4th, FINAL call",
      len(c.calls) == 4 and meta["tool_rounds"] == 3 and answer == "final")
check("⭐ the final call says tool_choice none (and still lists the tools)",
      [p["tool_choice"] for p in c.calls] == ["auto", "auto", "auto", "none"]
      and names(c.calls[-1]) == ["rule", "card", "boom"])

c = Fake(greedy, greedy, say("final", reasoning="R-final"))
(answer, hits, reasoning), meta = ask(c, q=MATH_Q)
check("⭐ thinking on: at most 2 tool rounds, then the final call",
      reasoning and len(c.calls) == 3 and meta["tool_rounds"] == 2
      and c.calls[-1]["tool_choice"] == "none")
check("…thinking stays on for every call of the answer (math mode keeps its behaviour)",
      all(p["extra_body"] == {"thinking": {"type": "enabled"}} and p["max_tokens"] == 4000
          for p in c.calls))

c = Fake(calls(*[tc("rule", {"num": f"1.{i}"}, i) for i in range(8)]), say("final"))
(answer, hits, _r), meta = ask(c)
tool_msgs = [m for m in c.calls[1]["messages"] if m["role"] == "tool"]
check("⭐ 8 parallel calls: 6 run, 2 answered 'not run' (every call id still gets a result)",
      len(DISPATCHED) == 6 and len(tool_msgs) == 8
      and sum("not run" in m["content"] for m in tool_msgs) == 2)
check("…and the call cap makes the next call the final one",
      len(c.calls) == 2 and c.calls[1]["tool_choice"] == "none")

c = Fake(calls(tc("card", "{not json"), tc("nope", {}), tc("boom", {})), say("final"))
(answer, hits, _r), meta = ask(c)
tool_msgs = [m["content"] for m in c.calls[1]["messages"] if m["role"] == "tool"]
check("bad JSON, an unoffered tool and a tool that raises each come back as an error result",
      tool_msgs[0].startswith("error: arguments were not valid JSON")
      and tool_msgs[1].startswith("error: no tool named 'nope'")
      and tool_msgs[2] == "error: boom failed: kaboom"
      and [t["ok"] for t in meta["tools"]] == [False, False, False] and answer == "final")

# ── simulate: level and token ─────────────────────────────────────────
print("\n[simulate is offered only at 'all' with ALGO_BOT_TOKEN]")
os.environ["ALGO_TOOLS"] = "all"
check("all, no token: simulate left out", [core.tool_name(s) for s in core.offered_tools()]
      == ["rule", "card", "boom"])
os.environ["ALGO_BOT_TOKEN"] = "t0k"
check("all, token set: simulate offered", "simulate" in [core.tool_name(s) for s in core.offered_tools()])
os.environ["ALGO_TOOLS"] = "lookup"
check("lookup, token set: simulate still left out",
      "simulate" not in [core.tool_name(s) for s in core.offered_tools()])
os.environ["ALGO_TOOLS"] = "all"
check("a server_available() that says no leaves it out",
      "simulate" not in [core.tool_name(s) for s in core.offered_tools()]
      if (setattr(STUB, "server_available", lambda: False) or True) else False)
del STUB.server_available

c = Fake(calls(*[tc("simulate", {}, i) for i in range(3)]), say("Here in the client it is 3/1 [engine:s1]."))
(answer, hits, _r), meta = ask(c, surface="discord")
sysmsg = c.calls[0]["messages"][0]["content"]
check("the engine wording joins the prompt, in the surface's words",
      core.TOOL_PROMPT_ENGINE["discord"] in sysmsg and core.TOOL_PROMPT_ENGINE["web"] not in sysmsg)
check("⭐ at most 2 simulate calls per answer",
      [n for n, _a in DISPATCHED] == ["simulate", "simulate"]
      and "not run: the simulate limit" in c.calls[1]["messages"][-1]["content"])
check("an engine citation whose stat matches the final state is kept",
      answer == "Here in the client it is 3/1 [engine:s1]." and "engine_mismatch" not in meta)
check("⭐ the engine footnote names the build and the board it simulated",
      core.friendly_source(hits[-1][1])
      == "Online client engine: simulated (build abc1234) — you: Towering Colossus 10/15")
del os.environ["ALGO_BOT_TOKEN"]
os.environ["ALGO_TOOLS"] = "lookup"

# ── reasoning_content ─────────────────────────────────────────────────
print("\n[reasoning_content: within a turn, never across turns]")
c = Fake(calls(tc("rule", {"num": "1.1"}), reasoning="R1"),
         calls(tc("rule", {"num": "1.2"}), reasoning="R2"), say("final", reasoning="R3"))
(answer, hits, reasoning), meta = ask(c, q=MATH_Q)
a1 = [m for m in c.calls[1]["messages"] if m["role"] == "assistant"]
a2 = [m for m in c.calls[2]["messages"] if m["role"] == "assistant"]
check("⭐ thinking on: each tool-call turn goes back WITH its reasoning_content",
      [m.get("reasoning_content") for m in a1] == ["R1"]
      and [m.get("reasoning_content") for m in a2] == ["R1", "R2"])

c = Fake(calls(tc("rule", {"num": "1.1"}), reasoning="stray"), say("final"))
(answer, hits, reasoning), meta = ask(c)
a1 = [m for m in c.calls[1]["messages"] if m["role"] == "assistant"]
check("thinking off: no reasoning_content is sent, even if the provider returned one",
      not reasoning and "reasoning_content" not in a1[0])

c = Fake(calls(tc("rule", {"num": "1.1"})), say("final"))
(answer, hits, reasoning), meta = ask(c, q="and a row?", history=HIST)
hist_turn = c.calls[0]["messages"][2]
check("a plain follow-up uses tools; its history turn is text only (no reasoning carried across)",
      names(c.calls[0]) and hist_turn == {"role": "assistant", "content": "A column holds two units."})

c = Fake(say("final", reasoning="R"))
(answer, hits, reasoning), meta = ask(c, q=MATH_Q, history=HIST)
check("⭐ a THINKING follow-up answers without tools (history has no reasoning to pass back)",
      reasoning and "tools" not in c.calls[0] and meta["tools_skipped"] == "thinking follow-up"
      and c.calls[0]["messages"][0]["content"] == f"{core.SYSTEM_PROMPT}\n\n{core.PRIMER}")

# ── time and the shared budget ────────────────────────────────────────
print("\n[the deadline and one retry budget per answer]")
saved = (core.LLM_DEADLINE, core.TOOL_ROUND_MIN_S, core.MIN_ATTEMPT_S)
core.LLM_DEADLINE, core.TOOL_ROUND_MIN_S, core.MIN_ATTEMPT_S = 10.0, 9.0, 0.5
c = Fake(("sleep", 1.2, calls(tc("rule", {"num": "1.1"}))), say("final"))
(answer, hits, _r), meta = ask(c)
check("⭐ under TOOL_ROUND_MIN_S left after a round: the next call is the final one",
      [p["tool_choice"] for p in c.calls] == ["auto", "none"] and answer == "final")

core.LLM_DEADLINE, core.TOOL_ROUND_MIN_S = 1.5, 0.1
c = Fake(calls(tc("rule", {"num": "1.1"})), ("sleep", 5, say("too late")), say("never"))
try:
    ask(c)
    timed_out = False
except TimeoutError:
    timed_out = True
check("⭐ each call gets min(MODEL_TIMEOUT, remaining): a hang is cut at the deadline",
      timed_out and len(c.calls) == 2)
core.LLM_DEADLINE, core.TOOL_ROUND_MIN_S, core.MIN_ATTEMPT_S = saved

req = httpx.Request("POST", "https://api.example.test/v1/chat/completions")
c = Fake(openai.APITimeoutError(request=req), calls(tc("rule", {"num": "1.1"})),
         openai.InternalServerError("boom", response=httpx.Response(500, request=req), body=None),
         say("never"))
try:
    ask(c)
    raised = None
except RuntimeError as exc:
    raised = str(exc)
check("⭐ ONE retry per answer: a timeout spends it, a later 5xx gives up (no second retry)",
      raised and len(c.calls) == 3 and "http 500" in raised)

fb = Fake(calls(tc("rule", {"num": "1.1"})), say("from the fallback"))
c = Fake(openai.APITimeoutError(request=req))
(answer, hits, _r), meta = ask(c, fallback=fb)
check("the fallback takes over for the REST of the answer, with the same tools",
      answer == "from the fallback" and len(c.calls) == 1 and len(fb.calls) == 2
      and names(fb.calls[0]) == ["rule", "card", "boom"] and fb.calls[1]["tool_choice"] == "auto")
check("…logged as a fallback, every attempt with its round",
      meta["model"] == "fb-model" and meta["fallback"]["reason"] == "timeout"
      and [(a["kind"], a["round"]) for a in meta["attempts"]]
      == [("primary", 0), ("fallback", 0), ("fallback", 1)])

c = Fake(openai.BadRequestError("tools?", response=httpx.Response(400, request=req), body=None),
         say("answered without tools"))
(answer, hits, _r), meta = ask(c)
check("a 400 on a tools request: answered the pre-tools way instead of not at all",
      answer == "answered without tools" and "tools" not in c.calls[1]
      and meta["tools_error"].startswith("http 400"))

c = Fake(say(""), say(""))
try:
    ask(c)
    raised = None
except RuntimeError as exc:
    raised = str(exc)
check("two empty answers still raise, never a blank answer", raised and "empty" in raised)

# ── footnote caveats ──────────────────────────────────────────────────
print("\n[trust caveats are appended to footnotes in code]")
c = Fake(calls(tc("rule", {"num": "802.17"}, 0), tc("rule", {"num": "802.8c"}, 1),
               tc("rule", {"num": "700.9"}, 2)),
         say("The client differs [cr:802.17], it is partial [cr:802.8c], and an owner call [cr:700.9]."))
(answer, hits, _r), meta = ask(c)
legend = [core.friendly_source(r) for _n, r in core.render_citations(answer, hits)[1]]
check("⭐ engineDiffers / partial / owner call reach the legend though the model named none",
      legend == ["CR 802.17 ⚠ the client currently does otherwise", "CR 802.8c (partial)",
                 "CR 700.9 (owner call, unofficial)"])
check("a corpus chunk's engine_differs + owner basis, for a one-rule chunk",
      core.friendly_source(flagged) == "CR 802.17 ⚠ the client currently does otherwise (owner call, unofficial)")
multi = {**flagged, "metadata": {**flagged["metadata"], "nums": ["802.17", "802.17a"],
                                 "basis": ["engine"], "open_question": True}}
check("…a several-rule chunk only knows ANY rule differs: no differs/open caveat, basis kept",
      core.friendly_source(multi) == "CR 802.17 (engine-derived, unconfirmed)")
check("a glossary row and a card get no caveats",
      core.friendly_source({"id": "card:X", "source_type": "card", "title": "X", "source": "x",
                            "metadata": {"engineDiffers": True}}) == "Card: X")

# ── against the real bot/tools.py, when it is here ─────────────────────
print("\n[the real tools module]")
try:
    import tools as real_tools
except Exception as exc:          # T-A's module not merged on this branch
    real_tools = None
    print(f"  --  skipped: {exc!r}")
if real_tools is not None:
    _txt, rrow = real_tools.dispatch("rule", {"num": "802.17"})
    line = rrow["text"].splitlines()[1]
    words = " ".join(line.split()[3:13])           # ten words from the rule's own text
    c = Fake(calls(tc("rule", {"num": "802.17"})),
             say(f'The rules say “{words}” (CR 802.17) [cr:802.17]. '
                 f'They also say "electric damage is always doubled by the client" [cr:802.17].'))
    (answer, hits, _r), meta = ask(c, stub=real_tools)
    check("real rule tool: offered schemas are its TOOLS (lookup level)",
          names(c.calls[0]) == [n for n in real_tools.TOOL_NAMES
                                if n not in getattr(real_tools, "SERVER_TOOLS", ())])
    check("⭐ real rule tool: a verbatim quote survives, a made-up one is unquoted and uncited",
          f"“{words}” (CR 802.17) [cr:802.17]" in answer
          and "also say electric damage is always doubled by the client." in answer
          and len(meta["quote_fail"]) == 1)
    legend = [core.friendly_source(r) for _n, r in core.render_citations(answer, hits)[1]]
    check("real rule tool: the footnote caveat follows the record's engine_differs flag",
          ("⚠ the client currently does otherwise" in legend[0])
          == bool(rrow["metadata"].get("engine_differs")))
    core._tools_mod = core._TOOLS_UNLOADED

# ── the engine version ────────────────────────────────────────────────
print("\n[ENGINE_VERSION]")
PROBE = "import core; print(core.ENGINE_VERSION)"


def version(**env):
    e = {k: v for k, v in os.environ.items() if k != "ALGO_TOOLS"}
    e.update(env)
    out = subprocess.run([_sys.executable, "-c", PROBE], cwd=str(_Path(core.__file__).parent),
                         env=e, capture_output=True, text=True, check=True).stdout
    return out.strip().splitlines()[-1]


off_v, look_v = version(), version(ALGO_TOOLS="lookup")
check("⭐ ALGO_TOOLS=off at import: the stamp has no .t axis (today's stamp)", ".t" not in off_v.split(".r", 1)[1])
check("ALGO_TOOLS=lookup: .t<sig> appended to the same stamp",
      look_v.startswith(off_v + ".t") and look_v != off_v)

del os.environ["ALGO_TOOLS"]
print(f"\ntest_toolloop: all {PASS} checks passed ✅")
