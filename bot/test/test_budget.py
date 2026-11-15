#!/usr/bin/env python3
"""
test_budget.py — the spending limit (bot/budget.py) and every surface that
asks through it. Offline: a fake model behind the real core.answer_question,
an injected clock, no sleeps.
Run: `.venv/bin/python bot/test/test_budget.py`.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import os  # noqa: E402

os.environ["ALGO_CR_NOTES"] = "off"
os.environ["ALGO_TOOLS"] = "off"

import asyncio  # noqa: E402
import json  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

import discord  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as webapp  # noqa: E402
import bot as botmod  # noqa: E402
import budget  # noqa: E402
import core  # noqa: E402
import gameserver  # noqa: E402
from cogs import judge as judgecog  # noqa: E402
from paths import responses_log  # noqa: E402

os.environ.pop("ALGO_BOT_TOKEN", None)
gameserver.client.token = ""

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


class Model:
    def __init__(self):
        self.calls = 0
        self.chat = NS(completions=self)

    async def create(self, **params):
        self.calls += 1
        usage = NS(prompt_tokens=100, completion_tokens=10, cost=0.001)
        return NS(choices=[NS(message=NS(content="an answer"), finish_reason="stop")], usage=usage)


MODEL = Model()
core.ai, core.ai_fallback, core.FALLBACK_MODEL = MODEL, None, None
UNWRITTEN = responses_log().with_name("budget-unwritten.jsonl")
NOON = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def fresh(**kw):
    args = {"per_asker": 99, "daily_usd": 100.0, "in_flight": 4, "log": lambda: UNWRITTEN, **kw}
    budget.BUDGET = budget.Budget(**args)
    return budget.BUDGET


async def ask(b, asker=None, badge=None):
    try:
        async with b.admit(asker, badge):
            return "ok"
    except budget.OverBudget as exc:
        return str(exc)


def run(coro):
    return asyncio.run(coro)


async def _no_badge(*a, **kw):
    return None
gameserver.asker_badge = _no_badge
botmod.post_cited_cards = _no_badge


# 1. Past the daily cap an asker is refused before the model is called; a new UTC day resets it.
now = [NOON]
fresh(per_asker=1, clock=lambda: now[0])
run(core.answer_question("q", [], meta={}, asker="discord:a"))
calls = MODEL.calls
try:
    run(core.answer_question("again", [], meta={}, asker="discord:a"))
    refused = None
except budget.OverBudget as exc:
    refused = str(exc)
now[0] = NOON + timedelta(hours=12, minutes=1)
check("1 the per-asker cap refuses before the model, and resets at midnight UTC",
      refused == budget.ASKER_LIMIT.format(n=1) and MODEL.calls == calls
      and run(core.answer_question("tomorrow", [], meta={}, asker="discord:a"))[0] == "an answer")

# 2. An owner or judge badge skips the per-asker cap and no other limit.
b = fresh(per_asker=1)
run(ask(b, "game:j"))
check("2 a badge is exempt from the per-asker cap only",
      run(ask(b, "game:j", {"judge": 2})) == "ok" and run(ask(b, "game:j", {"owner": True})) == "ok"
      and run(ask(fresh(daily_usd=0), "game:j", {"owner": True})) == budget.SPEND_LIMIT
      and run(ask(fresh(in_flight=0), "game:j", {"owner": True})) == budget.BUSY)


# 3. The spend cap counts today's logged cost, seeded by a fresh process from responses.jsonl.
def row(ts, cost):
    return json.dumps({"response_id": "x", "ts": ts, "cost_usd": cost}) + "\n"


log = responses_log()
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text(row("2026-11-14T23:59:00+00:00", 9.0) + row("2026-11-15T09:00:00+00:00", 4.75),
               encoding="utf-8")
under = run(ask(fresh(daily_usd=5.0, clock=lambda: NOON, log=responses_log), "a"))
with log.open("a", encoding="utf-8") as f:
    f.write(row("2026-11-15T11:00:00+00:00", 0.25))
check("3 a fresh process seeds today's spend from the log and refuses at the cap",
      under == "ok"
      and run(ask(fresh(daily_usd=5.0, clock=lambda: NOON, log=responses_log), "a")) == budget.SPEND_LIMIT)
log.unlink()


# 4. With every slot taken the next caller is refused at once, not queued.
async def _busy():
    b = fresh(in_flight=1)
    async with b.admit("x"):
        return await asyncio.wait_for(ask(b, "y"), 1)
check("4 the in-flight ceiling refuses the next concurrent caller", run(_busy()) == budget.BUSY)


# 5a. /ask on Discord shows the refusal sentence.
class Followup:
    def __init__(self):
        self.sent = []

    async def send(self, *a, wait=False, **kw):
        self.sent.append((a[0] if a else None, kw))


class Response:
    async def defer(self, **kw):
        return None


async def _slash():
    cog = judgecog.Judge(NS())
    i = NS(user=NS(id=200), channel_id=4242, response=Response(), followup=Followup())
    await cog.ask.callback(cog, i, "what is affinity?")
    return i.followup.sent[-1][0]
fresh(daily_usd=0)
check("5 /ask shows the refusal sentence", run(_slash()) == f"⚠️ {budget.SPEND_LIMIT}")


# 5b. A Discord thread follow-up shows the refusal sentence.
class Thread(discord.Thread):
    def __init__(self, tid, parent):  # noqa: no discord.Thread.__init__: no state, no guild
        self.id, self.parent_id = tid, parent

    def typing(self):
        class _T:
            async def __aenter__(s):
                return None

            async def __aexit__(s, *a):
                return False
        return _T()

    async def send(self, *a, **kw):
        return None


async def _follow():
    the_bot = await botmod.build_bot()
    botmod.THREADS[777] = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]
    replies = []

    async def reply(*a, **kw):
        replies.append(a[0] if a else None)
    msg = NS(author=NS(id=500, bot=False), channel=Thread(777, 4242), content="and then?", reply=reply)
    await the_bot.on_message(msg)
    await the_bot.close()
    return replies[-1]
fresh(daily_usd=0)
check("5 a thread follow-up shows the refusal sentence", run(_follow()) == f"⚠️ {budget.SPEND_LIMIT}")


# 5c. POST /api/ask answers a refusal with 429 and the sentence as detail.
def post(peer="127.0.0.1", token=None, **body):
    client = TestClient(webapp.app, client=(peer, 50000))
    return client.post("/api/ask", json={"question": "what is affinity?", **body},
                       headers={"x-algo-bot": token} if token else {})


fresh(daily_usd=0)
r = post()
check("5 /api/ask refuses with 429 and the sentence",
      r.status_code == 429 and r.json() == {"detail": budget.SPEND_LIMIT})

# 6. With a token set, a headerless public caller is refused and a headerless key or badge is not believed.
os.environ["ALGO_BOT_TOKEN"] = "s3cret"
try:
    fresh(per_asker=1)
    calls = MODEL.calls
    public = post(peer="8.8.8.8").status_code
    first = post().status_code
    claimed = post(asker_key="acct-9", asker={"owner": True}).status_code
    check("6 /api/ask trusts only the x-algo-bot header",
          public == 403 and first == 200 and claimed == 429 and MODEL.calls == calls + 1)
finally:
    os.environ.pop("ALGO_BOT_TOKEN", None)

print(f"test_budget: {PASS} checks passed ✅")
