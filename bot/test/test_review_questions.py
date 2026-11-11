#!/usr/bin/env python3
"""
test_review_questions.py — BL-17, the judges' review queue, bot half:
store.recent_answers() and app.py's GET /api/review/questions.

  §1 newest first, a failed call left out, the players' latest rating joined,
     no user id of any kind in a row
  §2 a follow-up carries its last turns, trimmed; long text is capped
  §3 the tail reader: rows far bigger than one read block, and `limit`
  §4 the route: 404 without ALGO_BOT_TOKEN, 404 on the wrong token, the rows
     with the right one
  §5 who asked: /api/ask keeps a judge's or the owner's badge (`asker`) only
     when the game server vouches with the token, and recent_answers carries
     the badge alone — never a junk key, and no row without one gains it
  §6 who asked, on Discord: gameserver.asker_badge reads the badge of the
     account a Discord id is linked to (owner first; none when unlinked,
     unbadged, tokenless, down or slow — never an exception), asks once per
     window; and the real /ask and the real thread follow-up, clicked, log it

Run: `.venv/bin/python bot/test/test_review_questions.py`. No network (§6's game
server is a local stub), no key.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT — see _scratch_var.py
import _scratch_var  # noqa: F401,E402

import json  # noqa: E402
import os  # noqa: E402

import store  # noqa: E402
from paths import responses_log, feedback_log  # noqa: E402

PASS = 0


def check(cond, what):
    global PASS
    if not cond:
        raise SystemExit(f"FAIL  {what}")
    PASS += 1
    print(f"  ok  {what}")


def reset():
    for p in (responses_log(), feedback_log()):
        if p.exists():
            p.unlink()


def answer(q, a, *, user="u1", channel="web", history=None, hits=None):
    rid = store.new_response_id()
    store.log_response(rid, "followup" if history else "ask", q, a, hits or [], "m",
                       user_id=user, channel_id=channel, history=history)
    return rid


# §1
reset()
r1 = answer("Can a Fight target my own unit?", "Yes.", user="alice-discord-id", channel="12345")
store.log_failure("ask", "a question that never got an answer", RuntimeError("down"), "m",
                  user_id="bob", channel_id="web")
r2 = answer("Does haste let a unit attack the turn it spawns?", "Yes, it does.")
store.log_feedback(r1, "good", "x")
store.log_feedback(r1, "bad", "y")
rows = store.recent_answers(10)
check([r["id"] for r in rows] == [r2, r1], "§1 newest first, the failed call left out")
check(rows[1]["surface"] == "discord" and rows[0]["surface"] == "web", "§1 the surface is web or discord")
check(rows[1].get("rating") == "bad" and "rating" not in rows[0], "§1 the latest rating is joined, none when nobody rated")
blob = json.dumps(rows)
check("user_id" not in blob and "alice-discord-id" not in blob and "channel_id" not in blob,
      "§1 no user id or channel id in any row")
check("retrieved" not in rows[0], "§1 the retrieved chunks stay in the log")

# §2
reset()
long_turn = "x" * (store.REVIEW_TURN_MAX + 50)
hist = [{"role": "user", "content": f"turn {i} " + long_turn} for i in range(6)]
r3 = answer("and then?", "y" * (store.REVIEW_TEXT_MAX + 10), history=hist)
row = store.recent_answers(5)[0]
check(row["id"] == r3 and row["kind"] == "followup", "§2 a follow-up is listed as one")
check(len(row["history"]) == store.REVIEW_TURNS and row["history"][0]["content"].startswith("turn 2"),
      "§2 it carries its last turns only")
check(all(len(t["content"]) == store.REVIEW_TURN_MAX for t in row["history"]), "§2 each turn is trimmed")
check(len(row["answer"]) == store.REVIEW_TEXT_MAX, "§2 a long answer is capped")

# §3
reset()
big = [(9.0 - i, {"id": f"c{i}", "authority": 1, "source_type": "cr", "source": "s", "title": "t",
                  "text": "z" * 40000}) for i in range(3)]
ids = [answer(f"question {i}", f"answer {i}", hits=big) for i in range(12)]
check(responses_log().stat().st_size > 12 * 100000, "§3 the fixture rows are each bigger than a read block")
rows = store.recent_answers(5)
check([r["id"] for r in rows] == list(reversed(ids))[:5], "§3 the last five, newest first, across block edges")
check([r["id"] for r in store.recent_answers(100)] == list(reversed(ids)), "§3 a limit past the start reads the first row too")
check(store.recent_answers(5)[4]["question"] == "question 7", "§3 a row read across a block edge parses whole")

# §4
from fastapi.testclient import TestClient  # noqa: E402
import app as webapp  # noqa: E402

os.environ.pop("ALGO_BOT_TOKEN", None)
with TestClient(webapp.app) as client:
    check(client.get("/api/review/questions").status_code == 404, "§4 no token configured: 404")
    check(client.get("/api/review/questions", headers={"x-algo-bot": ""}).status_code == 404,
          "§4 no token configured, an empty header: still 404")
    os.environ["ALGO_BOT_TOKEN"] = "s3cret"
    try:
        check(client.get("/api/review/questions").status_code == 404, "§4 no header: 404")
        check(client.get("/api/review/questions", headers={"x-algo-bot": "wrong"}).status_code == 404,
              "§4 the wrong token: 404")
        ok = client.get("/api/review/questions?limit=3", headers={"x-algo-bot": "s3cret"})
        check(ok.status_code == 200 and [r["id"] for r in ok.json()["questions"]] == list(reversed(ids))[:3],
              "§4 the right token: the last answers")
    finally:
        os.environ.pop("ALGO_BOT_TOKEN", None)

# §5
reset()


async def _fake_answer(question, history, *, context=None, meta=None, surface="web"):
    return f"answer to {question}", [], False

webapp.core.answer_question = _fake_answer
os.environ["ALGO_BOT_TOKEN"] = "s3cret"
try:
    with TestClient(webapp.app) as client:
        def ask(q, asker=None, token=None):
            body = {"question": q, **({"asker": asker} if asker is not None else {})}
            r = client.post("/api/ask", json=body, headers={"x-algo-bot": token} if token else {})
            check(r.status_code == 200, f"§5 asked: {q}")
            return r.json()["response_id"]
        plain = ask("a player's question")
        claimed = ask("a stranger claims a badge", {"judge": 3})
        wrong = ask("the wrong token claims one", {"owner": True}, token="nope")
        judge = ask("a judge asks in a game", {"judge": 2}, token="s3cret")
        owner = ask("the owner asks in a game", {"owner": True}, token="s3cret")
        check(client.post("/api/ask", json={"question": "q", "asker": {"judge": 7}},
                          headers={"x-algo-bot": "s3cret"}).status_code == 422,
              "§5 a badge that does not exist is refused")
finally:
    os.environ.pop("ALGO_BOT_TOKEN", None)
by_id = {r["id"]: r for r in store.recent_answers(10)}
check(by_id[judge].get("asker") == {"judge": 2}, "§5 the game server's judge: the badge is kept")
check(by_id[owner].get("asker") == {"owner": True}, "§5 the game server's owner: the badge is kept")
check(all("asker" not in by_id[r] for r in (plain, claimed, wrong)),
      "§5 no token, or the wrong one: no badge, whatever the request claimed")
store._append(responses_log(), {"response_id": "f" * 32, "ts": "2026-11-10T00:00:00Z", "kind": "ask",
                                "question": "q", "answer": "a", "channel_id": "web",
                                "asker": {"judge": 2, "name": "someone", "id": "acc-1"}})
row = store.recent_answers(1)[0]
check(row["asker"] == {"judge": 2}, "§5 a logged asker is passed on as the badge alone")

# §6
import asyncio  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from aiohttp import web  # noqa: E402

import gameserver  # noqa: E402

LOOKUPS = []
LINKED = {
    "100": {"username": "Ben", "badge": {"owner": True, "judge": 1, "since": "2026-09-05T00:00:00Z"}},
    "200": {"username": "Jo", "badge": {"judge": 3, "since": "2026-10-01T00:00:00Z"}},
    "300": {"username": "Pat", "badge": None},
}


async def _profile(req):
    LOOKUPS.append(dict(req.query))
    if req.headers.get("X-Algo-Bot") != "s3cret":
        return web.Response(status=404, text="not found")
    d = req.query.get("discord")
    if d == "666":
        await asyncio.sleep(5)  # a game server that hangs
    if d not in LINKED:
        return web.json_response({"ok": True, "linked": False, "player": None})
    return web.json_response({"ok": True, "linked": True, "online": False, "player": LINKED[d]})


class _Followup:
    async def send(self, *a, wait=False, **kw):
        return SimpleNamespace(create_thread=self._no_thread)

    async def _no_thread(self, **kw):
        import discord
        raise discord.HTTPException(SimpleNamespace(status=400, reason="DM"), "no threads here")


class _Response:
    async def defer(self, **kw):
        return None


def _ix(uid):
    return SimpleNamespace(user=SimpleNamespace(id=uid), channel_id=4242,
                           response=_Response(), followup=_Followup())


async def _section6():
    app = web.Application()
    app.router.add_get("/api/bot/profile", _profile)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = runner.addresses[0][1]
    gs = gameserver.GameServer(base=f"http://127.0.0.1:{port}", token="s3cret", timeout=10)
    tokenless = gameserver.GameServer(base=gs.base, token="", timeout=3)
    down = gameserver.GameServer(base="http://127.0.0.1:9", token="s3cret", timeout=1)
    real_client, gameserver.client = gameserver.client, gs
    gameserver._ASKER_CACHE.clear()
    try:
        b = gameserver.asker_badge
        check(await b(100) == {"owner": True}, "§6 the owner's linked Discord id: the owner badge, owner first")
        check(await b(200) == {"judge": 3}, "§6 a judge's linked Discord id: the judge badge alone")
        check(await b(300) is None, "§6 a linked player with no badge: none")
        check(await b(999) is None, "§6 an unlinked Discord id: none")
        check(LOOKUPS[-1] == {"discord": "999"}, "§6 the lookup asks by the Discord id")
        n = len(LOOKUPS)
        check(await b(200) == {"judge": 3} and len(LOOKUPS) == n, "§6 a second question inside the window asks nothing")
        check(await b(200, now=10 ** 9) == {"judge": 3} and len(LOOKUPS) == n + 1,
              "§6 …and past the window it asks again")
        t0 = asyncio.get_running_loop().time()
        check(await b(666) is None, "§6 a game server that hangs: none")
        check(asyncio.get_running_loop().time() - t0 < gameserver.ASKER_TIMEOUT + 1,
              "§6 …within the lookup's own timeout, not the client's")
        n = len(LOOKUPS)
        check(await b(200, gs=tokenless, now=10 ** 10) is None and len(LOOKUPS) == n,
              "§6 no ALGO_BOT_TOKEN: none, and nothing is asked")
        check(await b(201, gs=down) is None, "§6 the game server down: none, and no exception")

        # ⭐ the real /ask and the real thread follow-up, clicked
        import core
        import bot as botmod
        from cogs import judge as judgecog

        async def fake_answer(question, history, *, meta=None, surface="web", **kw):
            return f"answer to {question}", [], False
        judgecog.answer_question = fake_answer
        botmod.answer_question = fake_answer
        reset()
        cog = judgecog.Judge(SimpleNamespace())
        await cog.ask.callback(cog, _ix(200), "a judge asks on Discord")
        await cog.ask.callback(cog, _ix(999), "a player asks on Discord")

        import discord

        class _Thread(discord.Thread):
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
        thread = _Thread(777, 4242)
        botmod.THREADS[777] = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]

        async def _reply(*a, **kw):
            return None
        msg = SimpleNamespace(author=SimpleNamespace(id=100, bot=False), channel=thread,
                              content="the owner follows up", reply=_reply)
        orig_cited = botmod.post_cited_cards

        async def _no_cards(*a, **kw):
            return None
        botmod.post_cited_cards = _no_cards
        try:
            the_bot = await botmod.build_bot()
            await the_bot.on_message(msg)
        finally:
            botmod.post_cited_cards = orig_cited
        by_q = {r["question"]: r for r in store.recent_answers(10)}
        check(by_q["a judge asks on Discord"].get("asker") == {"judge": 3},
              "§6 ⭐ /ask by a judge's linked account: the review queue sees the judge's badge")
        check("asker" not in by_q["a player asks on Discord"], "§6 /ask by an unlinked player: no badge")
        check(by_q.get("the owner follows up", {}).get("asker") == {"owner": True},
              "§6 ⭐ a follow-up in the thread by the owner: the owner badge")
    finally:
        gameserver.client = real_client
        gameserver._ASKER_CACHE.clear()
        await gs.close()
        await tokenless.close()
        await down.close()
        await runner.cleanup()

asyncio.run(_section6())

print(f"\nALL {PASS} CHECKS PASSED")
