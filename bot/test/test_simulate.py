#!/usr/bin/env python3
"""
test_simulate.py — the judge's engine calculator, bot side: gameserver.simulate,
its health cache, and the `simulate` tool in bot/tools.py. No LLM, no key.
Run: `.venv/bin/python bot/test/test_simulate.py`.

§1 gameserver.simulate against a FAKE server (a thread, since the client is
   synchronous): the spec and token arrive; an answer the server gave —
   {ok:false} for a bad spec, a 400/413 — comes back to read; everything else
   (refused, timed out, 404, 500, not JSON, no token) is GameServerDown
§2 ⭐ the health cache: asked once per 60 s, a stale answer returned at once
   while one background thread re-asks, a failed simulate marks it down at once
§3 at most two simulations in flight across the process
§4 the tool: schema in step with simulate.ts's frozen contract; the description
   names what it cannot model; the rendered text (≤ ~700 tokens) and the engine
   row core's footnote and the quote check read; ⭐ an unreachable engine is the
   fixed `engine unavailable` text and never raises; a refused spec names why
§5 core's seam: offered only at `all`, with a token, with the server healthy;
   one answer through core.answer_question with a fake model, the real tools
   module and the fake server — the [engine:sN] tag resolves and footnotes
§6 ⭐ END TO END: the real game server on a spare port with a test token, and
   the Gravitational Correction / Null Drone question through tools.dispatch.
   Spawns node; run it under the round's gate lock when other suites may be
   running (the server binds a port).
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

for k in ("ALGO_TOOLS", "ALGO_BOT_TOKEN", "ALGO_GAME_SERVER", "LLM_REASONING", "DEEPSEEK_REASONING"):
    os.environ.pop(k, None)

import gameserver  # noqa: E402
import tools  # noqa: E402

PASS = 0
REPO = _Path(__file__).resolve().parent.parent.parent


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


def raises(fn, exc=gameserver.GameServerDown):
    try:
        fn()
    except exc as e:
        return str(e) or True
    return None


# ── a real-shaped answer (simulate.ts's own output for the 767 §1 fixture) ──
GC_OK = {
    "ok": True, "engine": "abc1234def5678", "id": "s1",
    "board": ("you (life 30; 12 open: 12 fire): you.0 The Foretold 3/3 · hand: Luminous Arc, Luminous Arc, "
              "Gravitational Correction || opponent (life 30; 4 open: 4 water): opponent.0 Towering Colossus "
              "10/15 · hand: Null Drone"),
    "patched": [],
    "steps": [{"i": 0, "ok": True, "did": "you play Luminous Arc → Towering Colossus (Opponent's)"},
              {"i": 1, "ok": True, "did": "you play Luminous Arc → Towering Colossus (Opponent's)"},
              {"i": 2, "ok": True, "did": "opponent play Null Drone → Luminous Arc"},
              {"i": 3, "ok": True, "did": "you play Gravitational Correction (X=2) → Null Drone"},
              {"i": 4, "ok": True, "did": "opponent chose \"Decline\" for \"Pay [2] to keep Null Drone's targets?\""}],
    "offered": [
        {"at": "step 3", "seat": "you", "kind": "targets",
         "prompt": "Gravitational Correction: change the targets of target effect",
         "options": ["Luminous Arc [stack.0]", "Luminous Arc [stack.1]", "Null Drone [stack.2]"]},
        {"at": "step 4", "seat": "opponent", "kind": "payOrDecline",
         "prompt": "Pay [2] to keep Null Drone's targets?", "options": ["Pay [2]", "Decline"]},
        {"at": "step 4", "seat": "you", "kind": "payOrDecline",
         "prompt": "Gravitational Correction: choose a new target for Null Drone",
         "options": ["Luminous Arc [stack.0]", "Luminous Arc [stack.1]"]}],
    "log": ["Haste step: haste cards may be played.", "The haste step ends.",
            "Resolving Gravitational Correction (X=2):",
            "Gravitational Correction: You changes 1 of Null Drone's targets.",
            "Resolving Null Drone:", "Null Drone: Luminous Arc costs 2 > 0 life lost — not negated.",
            "Opponent spawns Null Drone.", "Luminous Arc deals 6 to Towering Colossus."],
    "final": {"phase": "battle round 1, attackWindow", "life": {"you": 30, "opponent": 30},
              "mana": {"you": "12 open → 6 open", "opponent": "4 open → 2 open"},
              "units": [{"ref": "you.0", "card": "The Foretold", "stats": "5/5", "printed": "3/3",
                         "damage": 0, "counters": 0, "attrs": [], "zone": "play"},
                        {"ref": "opponent.0", "card": "Towering Colossus", "stats": "10/15",
                         "printed": "10/15", "damage": 12, "counters": 0, "attrs": [], "zone": "play"}],
              "stack": [], "hands": {"you": [], "opponent": []},
              "bins": {"you": ["Gravitational Correction", "Luminous Arc ×2"], "opponent": []},
              "pending": "you holds priority (battle round 1, attackWindow)"},
    "auto": ["opponent passed ×2",
             "decision 'Gravitational Correction: choose a new target for Null Drone' (you): option 0 — Luminous Arc"],
    "limit": None,
}
BI_OK = {
    "ok": True, "engine": "abc1234def5678", "id": "s2",
    "board": "you (life 30; 0 open): you.0 Static Courier 3/1 [Balanced,Inverted] · hand: — || opponent (life 30; 0 open): no units · hand: —",
    "patched": ["you.0 Static Courier: Balanced, Inverted until regroup — directly, not by a card"],
    "steps": [], "offered": [],
    "log": ["Static Courier gains {Balanced} until regroup.", "Static Courier gains {Inverted} until regroup."],
    "final": {"phase": "deploy", "life": {"you": 30, "opponent": 30},
              "mana": {"you": "0 open → 0 open", "opponent": "0 open → 0 open"},
              "units": [{"ref": "you.0", "card": "Static Courier", "stats": "3/1", "printed": "3/2",
                         "damage": 0, "counters": 0, "attrs": ["Balanced", "Inverted"], "zone": "play"}],
              "stack": [], "hands": {"you": [], "opponent": []}, "bins": {"you": [], "opponent": []},
              "pending": None},
    "auto": ["you attacked with nobody", "opponent attacked with nobody"], "limit": None,
}
BAD_SPEC = {"ok": False, "id": "s3", "error": "you.hand[0]: unknown card \"Lumnous Arc\"",
            "errors": [{"at": "you.hand[0]", "error": "unknown card \"Lumnous Arc\"",
                        "didYouMean": ["Luminous Arc"]}]}


# ── the fake game server ────────────────────────────────────────────────────
class Fake:
    mode = "ok"            # ok | badspec | slow | boom | notjson | toolarge | down-health
    answer = GC_OK
    seen = []              # (method, path, headers, body)
    health_calls = 0
    delay = 0.0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json"):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        Fake.seen.append(("GET", self.path, dict(self.headers), None))
        if self.path.startswith("/api/bot/health"):
            Fake.health_calls += 1
            if self.headers.get("X-Algo-Bot") != "s3cret" or Fake.mode == "down-health":
                return self._send(404, b"not found", "text/plain")
            if Fake.delay:
                time.sleep(Fake.delay)
            return self._send(200, {"ok": True, "engine": "abc1234def5678", "bootId": "b"})
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"null")
        Fake.seen.append(("POST", self.path, dict(self.headers), body))
        if self.path != "/api/bot/simulate" or self.headers.get("X-Algo-Bot") != "s3cret":
            return self._send(404, b"not found", "text/plain")
        if Fake.mode == "slow":
            time.sleep(Fake.delay or 2.0)
        if Fake.mode == "boom":
            return self._send(500, b"kaboom", "text/plain")
        if Fake.mode == "notjson":
            return self._send(200, b"<html>nope</html>", "text/html")
        if Fake.mode == "toolarge":
            return self._send(413, {"ok": False, "error": "bad request: body too large"})
        if Fake.mode == "badspec":
            return self._send(200, {**BAD_SPEC, "id": body.get("id")})
        self._send(200, {**Fake.answer, "id": body.get("id")})


srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
DEAD = "http://127.0.0.1:1"


def use(base=BASE, token="s3cret", mode="ok", answer=GC_OK, delay=0.0):
    os.environ["ALGO_GAME_SERVER"] = base
    if token is None:
        os.environ.pop("ALGO_BOT_TOKEN", None)
    else:
        os.environ["ALGO_BOT_TOKEN"] = token
    Fake.mode, Fake.answer, Fake.delay = mode, answer, delay
    gameserver._HEALTH.reset()


# ════ §1 ═══════════════════════════════════════════════════════════════════
print("\n[§1 gameserver.simulate]")
use()
r = gameserver.simulate({"id": "s9", "you": {}, "opponent": {}})
check("a run comes back as the server's dict", r["ok"] is True and r["id"] == "s9")
m, path, headers, body = Fake.seen[-1]
check("POSTed to /api/bot/simulate as JSON", m == "POST" and path == "/api/bot/simulate"
      and headers.get("Content-Type") == "application/json" and body["id"] == "s9")
check("the token rides the X-Algo-Bot header, never the URL",
      headers.get("X-Algo-Bot") == "s3cret" and "token" not in path)
check("config is read per call (ALGO_GAME_SERVER / ALGO_BOT_TOKEN at call time)",
      gameserver.simulate({}, base=BASE)["ok"])

use(mode="badspec")
r = gameserver.simulate({"id": "s9"})
check("⭐ a refused spec is an answer to read, not an exception",
      r["ok"] is False and r["errors"][0]["didYouMean"] == ["Luminous Arc"])
use(mode="toolarge")
check("a 413 with a JSON body is returned too (the model wrote a spec too big)",
      gameserver.simulate({})["error"] == "bad request: body too large")
use(mode="boom")
check("a 500 raises GameServerDown", raises(lambda: gameserver.simulate({})) == "HTTP 500 from /api/bot/simulate")
use(mode="notjson")
check("a body that is not JSON raises", bool(raises(lambda: gameserver.simulate({}))))
use(token="wrong")
msg = raises(lambda: gameserver.simulate({}))
check("a 404 from the gate raises, without claiming to know which side is wrong",
      bool(msg) and "either unset there or does not match" in str(msg))
use(base=DEAD)
check("a refused connection raises", bool(raises(lambda: gameserver.simulate({}, timeout=1))))
use(token=None)
check("no ALGO_BOT_TOKEN: raises before any request", bool(raises(lambda: gameserver.simulate({}))))
use(mode="slow", delay=1.5)
t0 = time.monotonic()
msg = raises(lambda: gameserver.simulate({}, timeout=0.4))
check(f"⭐ its own timeout: a slow server raises 'timed out' ({time.monotonic() - t0:.1f}s)",
      bool(msg) and "timed out" in str(msg) and time.monotonic() - t0 < 1.4)
check("the default is 4 s (design §3: on top of the server's 2 s worker)", gameserver.SIM_TIMEOUT == 4.0)

# ════ §2 ═══════════════════════════════════════════════════════════════════
print("\n[§2 the health cache]")
use()
Fake.health_calls = 0
check("healthy server: available", gameserver.server_available() is True)
check("…and it reported the engine build", gameserver.simulate_engine() == "abc1234def5678")
for _ in range(5):
    gameserver.server_available()
time.sleep(0.3)                    # room for any background re-ask to land
check("⭐ asked ONCE within the TTL, however often core asks", Fake.health_calls == 1)
check("the TTL is 60 s", gameserver.HEALTH_TTL == 60.0)
use(token=None)
Fake.health_calls = 0
check("no token: unavailable, and nothing asked", gameserver.server_available() is False and Fake.health_calls == 0)
use(token="wrong")
check("wrong token (404): unavailable", gameserver.server_available() is False)
use(base=DEAD)
check("refused: unavailable", gameserver.server_available() is False)

use()
check("up", gameserver.server_available() is True)
key = (BASE, "s3cret")
gameserver._HEALTH._state[key]["at"] -= gameserver.HEALTH_TTL + 1        # make it stale
Fake.mode, Fake.delay = "down-health", 0.5
Fake.health_calls = 0
t0 = time.monotonic()
first = gameserver.server_available()
took = time.monotonic() - t0
check(f"⭐ a stale answer comes back AT ONCE ({took * 1000:.0f} ms), the old value",
      first is True and took < 0.2)
for _ in range(20):
    if gameserver._HEALTH._state[key]["ok"] is False:
        break
    time.sleep(0.05)
check("…while one background re-ask updates it", gameserver.server_available() is False
      and Fake.health_calls == 1)

use()
check("up again", gameserver.server_available() is True)
os.environ["ALGO_GAME_SERVER"] = BASE
Fake.mode = "boom"
raises(lambda: gameserver.simulate({}))
# a 5xx is a server that answered: health stays as it was
check("a 500 does not mark the server down (it answered)", gameserver.server_available() is True)
srv_dead_key = (DEAD, "s3cret")
gameserver._HEALTH.mark(DEAD, "s3cret", True)
os.environ["ALGO_GAME_SERVER"] = DEAD
raises(lambda: gameserver.simulate({}, timeout=1))
Fake.health_calls = 0
check("⭐ a simulate that could not reach the server marks it down at once — no wait for the TTL",
      gameserver.server_available() is False)

# ════ §3 ═══════════════════════════════════════════════════════════════════
print("\n[§3 at most two in flight]")
use(mode="slow", delay=1.6)
out = []
ths = [threading.Thread(target=lambda: out.append(gameserver.simulate({}, timeout=3))) for _ in range(3)]
for t in ths:
    t.start()
    time.sleep(0.05)
for t in ths:
    t.join()
busy = [o for o in out if o.get("busy")]
check(f"three at once: two run, the third is told busy ({len(busy)} busy)",
      len(busy) == 1 and sum(1 for o in out if o.get("ok")) == 2)
check("the cap is 2 (design §4)", gameserver.SIM_MAX_INFLIGHT == 2)

# ════ §4 ═══════════════════════════════════════════════════════════════════
print("\n[§4 the simulate tool]")
schema = tools.SIMULATE_SCHEMA
desc = schema["function"]["description"]
check("simulate is a tool, and the one server tool", "simulate" in tools.TOOL_NAMES
      and tools.SERVER_TOOLS == {"simulate"} and schema in tools.TOOLS)
check("top level is strict (unknown keys refused) and needs both sides",
      schema["function"]["parameters"]["additionalProperties"] is False
      and schema["function"]["parameters"]["required"] == ["you", "opponent"])
for phrase in ("NEVER what the rules say", "rules as written", "engine is the wrong side",
               "hidden information", "real opponent choices", "more than 2 players", "the draft",
               "deckTop", "the UI", "tabletop", "broken", "past rules", "when played"):
    check(f"the description says it cannot model: {phrase!r}", phrase in desc)


def _strings(v):
    if isinstance(v, dict):
        return " ".join(_strings(x) for x in v.values())
    if isinstance(v, list):
        return " ".join(_strings(x) for x in v)
    return v if isinstance(v, str) else ""


blob = _strings(schema)        # every description and enum, as the model reads them
ts = (REPO / "client" / "server" / "simulate.ts").read_text(encoding="utf-8")


def ts_list(name):
    m = re.search(rf"const {name}[^=]*=\s*\[([^\]]*)\]", ts)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


dos, until, res_kinds = ts_list("DOS"), ts_list("UNTIL"), ts_list("RESOURCE_KINDS")
check(f"simulate.ts still declares the lists this schema mirrors ({len(dos)} do, {len(until)} until)",
      len(dos) == 8 and len(until) == 4 and len(res_kinds) == 9)
check("⭐ every step `do` in the frozen contract is described", all(f'do:"{d}"' in blob for d in dos))
check("every `until` is offered", schema["function"]["parameters"]["properties"]["until"]["enum"] == until)
check("every resource kind is named", all(k in blob for k in res_kinds))
top = re.search(r"Change it only additively.*?REQUEST.*?\{(.*?)\n \*  \}", ts, re.S)
top_keys = set(re.findall(r'^\s*\*\s+"(\w+)":', top.group(1), re.M)) if top else set()
check(f"⭐ the schema's top-level keys are the contract's, less the id we set ({sorted(top_keys)})",
      top_keys and set(schema["function"]["parameters"]["properties"]) == top_keys - {"id"})
schema_chars = len(json.dumps(schema))
check(f"the schema stays compact (~{schema_chars // 4} tokens; it rides on every `all` answer)",
      schema_chars < 3600)

use(answer=BI_OK)
Fake.seen.clear()
text, row = tools.dispatch("simulate", {"id": "zz", "you": {"play": [
    {"card": "Static Courier", "temp": {"attrs": ["Balanced", "Inverted"], "power": None}}]},
    "opponent": {}, "until": None})
sent = Fake.seen[-1][3]
sid = row["id"].split(":", 1)[1]
check("our own id goes on the spec (the model's is replaced)", re.fullmatch(r"s\d+", sid) and sent["id"] == sid)
check("a null the model filled in is dropped, not sent to the strict server",
      "until" not in sent and "power" not in sent["you"]["play"][0]["temp"])
check("the text heads with the citable tag and says it is the client, not the rules",
      text.startswith(f"[engine:{sid}] Online client engine build abc1234") and "not what the rules say" in text)
check("…the board as built, and the unit's stats against its printed ones",
      "Board as built: you (life 30" in text and "you.0 Static Courier 3/1 (printed 3/2) [Balanced, Inverted]" in text)
check("…and what was set directly rather than by a card", "Set directly, not by a card: you.0 Static Courier" in text)
check("the row is an engine row with the build and the one-line board",
      row["source_type"] == "engine" and row["metadata"]["engine"] == "abc1234def5678"
      and row["metadata"]["board"] == BI_OK["board"] and row["text"] == text)
check("…carrying the final state and the log for the quote check",
      row["metadata"]["final"]["units"][0]["stats"] == "3/1" and len(row["metadata"]["log"]) == 2)
check("citable_rows gives exactly that row", tools.citable_rows(row) == [row])
text2, row2 = tools.dispatch("simulate", {"you": {}, "opponent": {}})
check("each call gets its own id", row2["id"] != row["id"])

import core  # noqa: E402
import quotecheck  # noqa: E402

check("⭐ core's footnote names the build and the board",
      core.friendly_source(row) == "Online client engine: simulated (build abc1234) — " + BI_OK["board"])
ans = f"Here in the client a 3/2 with both is 3/1 (simulated) [engine:{sid}]."
out, rep = quotecheck.check(ans, [row], core.resolve_citation)
check("the quote check keeps a stat pair the final state shows", out == ans and rep == {})
out, rep = quotecheck.check(ans.replace("3/1", "3/3"), [row], core.resolve_citation)
check("…and drops the engine tag from one it does not", f"engine:{sid}" not in out and rep.get("engine_mismatch"))
q = f'The log says "Static Courier gains {{Inverted}} until regroup" [engine:{sid}].'
check("a quoted log line survives the quote check", quotecheck.check(q, [row], core.resolve_citation)[1] == {})

use(answer=GC_OK)
text, row = tools.dispatch("simulate", {"you": {}, "opponent": {}, "showOffered": True})
check("the GC run shows the new-target menu, options and all",
      "choose a new target for Null Drone: Luminous Arc [stack.0] | Luminous Arc [stack.1]" in text)
check("…the silent defaults, never hidden", "Auto (unscripted defaults): opponent passed ×2" in text)
check("…and the log", "Log:\n" in text and "Null Drone: Luminous Arc costs 2 > 0 life lost — not negated." in text)

big = json.loads(json.dumps(GC_OK))
big["log"] = [f"line {i:02d} " + "x" * 60 for i in range(60)]
big["offered"] = big["offered"] * 2
t = tools.render_simulation("s7", big)
check(f"⭐ a big run fits the model's budget ({len(t)} ≤ {tools.SIM_TEXT_CHARS} chars, ~700 tokens)",
      len(t) <= tools.SIM_TEXT_CHARS)
check("…keeping the board, every step and the final state",
      "Board as built" in t and all(f"step {i} ok" in t for i in range(5)) and "opponent.0 Towering Colossus 10/15 damage 12" in t)
check("…and the NEWEST log lines over the oldest", "line 59" in t and "line 00" not in t)
check("…in order", t.index("line 58") < t.index("line 59"))
nolog = tools.render_simulation("s8", {**big, "log": ["only line " + "y" * 3000]})
check("no 'Log:' heading with nothing under it", "Log:" not in nolog)

use(mode="badspec")
text, row = tools.dispatch("simulate", {"you": {"hand": ["Lumnous Arc"]}, "opponent": {}})
check("a refused spec: the reasons, the did-you-mean, and what to do next",
      "refused the spec" in text and "you.hand[0]: unknown card" in text and "did you mean: Luminous Arc" in text
      and "call again" in text)
check("…and nothing to cite", tools.citable_rows(row) == [] and row["metadata"]["error"])

for label, kw in (("refused connection", {"base": DEAD}), ("wrong token", {"token": "wrong"}),
                  ("a 500", {"mode": "boom"}), ("no token", {"token": None})):
    use(**kw)
    try:
        text, row = tools.dispatch("simulate", {"you": {}, "opponent": {}})
        ok = text == '{"ok": false, "error": "engine unavailable"}' and tools.citable_rows(row) == []
    except Exception as exc:          # the whole point: it must not raise
        ok = False
        print("   raised", exc)
    check(f"⭐ {label}: the fixed 'engine unavailable' text, no citation, no exception", ok)
use(mode="slow", delay=1.0)
old = gameserver.SIM_TIMEOUT
gameserver.SIM_TIMEOUT = 0.3
text, _row = tools.dispatch("simulate", {"you": {}, "opponent": {}})
gameserver.SIM_TIMEOUT = old
check("a timeout is 'engine unavailable' too", text == tools.ENGINE_UNAVAILABLE)
check("args as a JSON string work (a tool call's raw arguments)",
      tools.dispatch("simulate", "not json")[0].endswith("not valid JSON."))
check("a spec over 16 KB is refused here, before the wire",
      "over 16 KB" in tools.dispatch("simulate", {"you": {"hand": ["x" * 17000]}, "opponent": {}})[0])

# ════ §5 ═══════════════════════════════════════════════════════════════════
print("\n[§5 core's seam]")
core._tools_mod = tools
offered = lambda: [core.tool_name(s) for s in core.offered_tools()]  # noqa: E731
use()
os.environ["ALGO_TOOLS"] = "all"
check("all + token + healthy server: simulate offered", "simulate" in offered())
os.environ["ALGO_TOOLS"] = "lookup"
check("lookup: not offered", "simulate" not in offered() and "rule" in offered())
os.environ["ALGO_TOOLS"] = "all"
use(token=None)
check("no token: not offered (the integration is absent)", "simulate" not in offered())
use(base=DEAD)
check("server down: not offered", "simulate" not in offered())

# one answer, end to end through core with a fake model and the real tools module
use(answer=BI_OK)
os.environ["ALGO_TOOLS"] = "all"


class FakeAI:
    def __init__(self):
        self.calls = []
        self.chat = NS(completions=self)

    async def create(self, **params):
        self.calls.append(json.loads(json.dumps(params)))
        usage = None
        if len(self.calls) == 1:
            tc = NS(id="call_1", type="function", function=NS(name="simulate", arguments=json.dumps(
                {"you": {"play": [{"card": "Static Courier", "temp": {"attrs": ["Balanced", "Inverted"]}}]},
                 "opponent": {}})))
            return NS(choices=[NS(message=NS(content="", tool_calls=[tc], reasoning_content=None),
                                  finish_reason="tool_calls")], usage=usage)
        result = params["messages"][-1]["content"]
        tag = re.match(r"\[(engine:s\d+)\]", result).group(1)
        return NS(choices=[NS(message=NS(content=f"Here in the client it is 3/1 (simulated) [{tag}].",
                                         tool_calls=None, reasoning_content=None),
                              finish_reason="stop")], usage=usage)


fake = FakeAI()
core.ai, core.ai_fallback, core.FALLBACK_MODEL = fake, None, None
core.LLM_MODEL, core.LLM_BASE_URL = "deepseek-flash", "https://api.deepseek.com"
meta = {}
answer, hits, _r = asyncio.run(core.answer_question("Balanced and Inverted on a 3/2?", [], meta=meta,
                                                    surface="web"))
check("the model was offered simulate and the engine wording",
      "simulate" in [t["function"]["name"] for t in fake.calls[0]["tools"]]
      and core.TOOL_PROMPT_ENGINE["web"] in fake.calls[0]["messages"][0]["content"])
check("⭐ the call ran through tools.dispatch to the server and back", meta["tools"][0]["name"] == "simulate"
      and meta["tools"][0]["ok"] is True and Fake.seen[-1][1] == "/api/bot/simulate")
tag = re.search(r"\[(engine:s\d+)\]", answer).group(1)
check("the answer keeps its engine citation (3/1 is in the final state)", tag and "engine_mismatch" not in meta)
rendered, legend = core.render_citations(answer, hits)
check("⭐ and it footnotes as the engine, with the build and the board",
      [core.friendly_source(r).split(" — ")[0] for _n, r in legend]
      == ["Online client engine: simulated (build abc1234)"] and tag not in rendered)
os.environ.pop("ALGO_TOOLS", None)
core._tools_mod = core._TOOLS_UNLOADED

# ════ §6 ═══════════════════════════════════════════════════════════════════
print("\n[§6 ⭐ end to end: the real game server]")
NODE = shutil.which("node")
SERVER = REPO / "client" / "server"
if not NODE or not (SERVER / "node_modules").exists():
    print("  SKIPPED: no node or client/server/node_modules on this machine")
else:
    scratch = _Path(tempfile.mkdtemp(prefix="algo-sim-e2e-"))
    env = {**os.environ, "PORT": "0", "HOST": "127.0.0.1", "ALGO_BOT_TOKEN": "e2e-t0ken",
           "ALGO_GAMES_DIR": str(scratch / "games"), "ALGO_ACCOUNTS_FILE": str(scratch / "accounts.json"),
           "ALGO_ISSUES_FILE": str(scratch / "issues.jsonl"), "ALGO_VERDICTS_FILE": str(scratch / "verdicts.jsonl"),
           "ALGO_REPORT_RUNS_FILE": str(scratch / "report-runs.jsonl"),
           "ALGO_REPORT_MARKS_FILE": str(scratch / "report-marks.jsonl"),
           "ALGO_LEAGUE_FILE": str(scratch / "league.json"), "ALGO_CR_COMMENTS_FILE": str(scratch / "cr.jsonl"),
           "ALGO_CHALLENGES_DIR": str(scratch / "challenges"),
           "ALGO_BOT_URL": DEAD, "ALGO_BOT_PUSH_URL": DEAD + "/push"}
    proc = subprocess.Popen([NODE, "main.ts"], cwd=SERVER, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    port, lines = None, []

    def reader():
        global port
        for line in proc.stdout:
            lines.append(line)
            m = re.search(r"Algomancy server on http://localhost:(\d+)", line)
            if m and port is None:
                port = int(m.group(1))

    threading.Thread(target=reader, daemon=True).start()
    try:
        deadline = time.monotonic() + 60
        while port is None and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        check("the game server started on a spare port", port is not None)
        use(base=f"http://127.0.0.1:{port}", token="e2e-t0ken")
        check("its health says yes to our token (and warms the engine worker)", gameserver.server_available())
        check("…and names the engine build", bool(gameserver.simulate_engine()))
        spec = {
            "initiative": "you",
            "you": {"hand": ["Luminous Arc", "Luminous Arc", "Gravitational Correction"],
                    "play": ["The Foretold"], "resources": {"fire": 12}},
            "opponent": {"hand": ["Null Drone"], "play": ["Towering Colossus"], "resources": {"water": 4}},
            "attack": [["you.0"]],
            "steps": [{"do": "play", "card": "Luminous Arc", "targets": ["opponent.0"]},
                      {"do": "play", "card": "Luminous Arc", "targets": ["opponent.0"]},
                      {"seat": "opponent", "do": "play", "card": "Null Drone", "targets": ["stack:Luminous Arc"]},
                      {"do": "play", "card": "Gravitational Correction", "x": 2, "targets": ["stack:Null Drone"]},
                      {"seat": "opponent", "do": "choose", "option": "decline"}],
            "showOffered": True,
        }
        text = None
        for attempt in range(3):          # the worker boots on the first health; give it a moment
            text, row = tools.dispatch("simulate", spec)
            if text != tools.ENGINE_UNAVAILABLE and "busy" not in text:
                break
            time.sleep(1.5)
        print("   " + "\n   ".join(text.splitlines()[:12]))
        check("⭐ the GC / Null Drone fixture runs through tools.dispatch", row["source_type"] == "engine"
              and text.startswith(f"[{row['id']}] Online client engine build"))
        menu = re.search(r"choose a new target for Null Drone: (.*)", text)
        check("⭐ the client's new-target menu offers the Arcs, NEVER Null Drone itself or the resolving GC",
              menu and "Luminous Arc [stack." in menu.group(1)
              and "Null Drone" not in menu.group(1) and "Gravitational Correction" not in menu.group(1))
        check("…while GC itself could aim at Null Drone (a spell unit is a spell effect)",
              re.search(r"change the targets of target effect: .*Null Drone \[stack\.2\]", text) is not None)
        check("the row carries the real build sha", row["metadata"]["engine"] == gameserver.simulate_engine())
        check("nothing was written to the server's var paths",
              not any(p.exists() for p in (scratch / "games", scratch / "issues.jsonl", scratch / "verdicts.jsonl")))
        bad, brow = tools.dispatch("simulate", {"you": {"hand": ["Lumnous Arc"]}, "opponent": {}})
        check("a misspelt card comes back refused with the real did-you-mean",
              "did you mean: Luminous Arc" in bad and tools.citable_rows(brow) == [])
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(scratch, ignore_errors=True)
    if port is None:
        print("".join(lines[-30:]))

srv.shutdown()
print(f"\ntest_simulate: all {PASS} checks passed ✅")
