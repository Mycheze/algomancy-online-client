"""
test_league.py — the league's Discord half (cogs/league.py, client/docs/20-league.md).
Run: `.venv/bin/python bot/test/test_league.py`. No Discord, no real game server.

§1 the league-channel file: round trip, no .tmp left, a corrupt file reads as empty
§2 ⭐ EVERY KIND RENDERS — a row of each kind the server writes becomes a
   message inside Discord's limits, with times as <t:…> stamps (so each reader
   sees their own zone); an unknown kind renders as None rather than raising
§3 ⭐ PULL → SEND → ACK against a fake game server: a linked player gets a DM,
   an unlinked one is acked 'not-linked', DMs closed fall back to the channel
   and ack 'dm-closed', a transient Discord error is NOT acked (so it is sent
   next pass), a channel row with no channel set is 'no-channel'
§4 ⭐ THE TEST REDIRECT sends every DM — linked or not — to one person,
   headed with who it was for
§5 the loop never starts under build_bot() (it would die in wait_until_ready)
§6 /league join and /league status, driven through a stub interaction
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import json  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import discord  # noqa: E402
from aiohttp import web  # noqa: E402

import gameserver  # noqa: E402
import paths  # noqa: E402
from cogs import league as lg  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


T = 1_791_763_200     # a Monday, 2026-10-12 00:00 UTC
PEOPLE = {
    "u1": {"id": "u1", "name": "Ann", "discordId": "111"},
    "u2": {"id": "u2", "name": "Bob", "discordId": None},
}
WIN = [{"start": T + 19 * 3600, "hours": 3}, {"start": T + 2 * 86400 + 19 * 3600, "hours": 2}]
ROWS = {
    "signup": {"season": "Pilot", "firstWeek": 1, "weeks": 3, "firstPairings": T, "late": False},
    "signups-open": {"season": "Pilot", "start": T, "weeks": 3, "perWeek": 3},
    "pairings": {"season": "Pilot", "week": 1, "weeks": 3, "deadline": T + 7 * 86400, "record": "0–0", "short": True,
                 "opponents": [{"id": "u2", "name": "Bob", "record": "0–0", "match": "p-w1-1", "windows": WIN},
                               {"id": "u1", "name": "Ann", "record": "0–0", "match": "p-w1-2", "windows": []}]},
    "sitting-out": {"season": "Pilot", "week": 2, "skipped": True, "next": 3},
    "week-pairings": {"season": "Pilot", "week": 1, "weeks": 3, "deadline": T + 7 * 86400,
                      "matches": [{"a": "u1", "b": "u2", "aName": "Ann", "bName": "Bob"}]},
    "week-closed": {"season": "Pilot", "week": 1, "weeks": 3,
                    "table": [{"id": "u1", "name": "Ann", "w": 2, "l": 1, "points": 6}]},
    "final": {"season": "Pilot", "finalist": True, "opponent": {"id": "u2", "name": "Bob", "record": "5–2"},
              "match": "p-final", "windows": WIN, "deadline": T + 35 * 86400},
    "result": {"season": "Pilot", "match": "p-w1-1", "final": False, "won": True,
               "opponent": {"id": "u2", "name": "Bob"}, "record": "1–0", "rank": 1, "of": 6},
    "season": {"season": "Pilot", "place": "champion", "w": 8, "l": 2, "champion": "Ann"},
}


def row(kind, rid=1, to="u1"):
    return {"id": rid, "season": "pilot", "kind": kind, "createdAt": "2026-10-12T00:00:00Z",
            "to": PEOPLE.get(to) if to else None, "data": dict(ROWS[kind], ids=["u1", "u2"]), "people": PEOPLE}


# ── §1 ────────────────────────────────────────────────────────────────
print("[§1 the league-channel file]")
check("no file reads as no channels", lg.channels() == {})
check("adding one reports it was not there", lg.set_channel(55, 9, 1) is False)
check("…and it is there", "55" in lg.channels())
check("no .tmp left behind", not paths.league_channel_file().with_suffix(".tmp").exists())
check("removing reports it was there", lg.set_channel(55, 9, 1, on=False) is True)
paths.league_channel_file().write_text("{not json", encoding="utf-8")
check("⭐ a corrupt file reads as empty, never raises", lg.channels() == {})

# ── §2 ────────────────────────────────────────────────────────────────
print("[§2 ⭐ every kind renders]")
for kind in ROWS:
    msg = lg.render(row(kind), "https://algomancy.online")
    check(f"{kind} renders", msg is not None)
    if msg is None:
        continue
    text = msg.get("content") or ""
    if msg.get("embed"):
        e = msg["embed"].to_dict()
        text += json.dumps(e)
        check(f"{kind}: embed within Discord's limits",
              len(e.get("title", "")) <= 256 and len(e.get("description", "")) <= 4096
              and all(len(f["value"]) <= 1024 and len(f["name"]) <= 256 for f in e.get("fields", [])))
    check(f"{kind}: content under 2000 characters", len(msg.get("content") or "") <= 2000)
    if kind in ("signup", "signups-open", "pairings", "week-pairings", "final"):
        check(f"⭐ {kind}: times are Discord stamps, never formatted by the bot", "<t:" in text)
    if msg.get("view"):
        urls = [c.url for c in msg["view"].children]
        check(f"{kind}: the link opens the season's league page", urls == ["https://algomancy.online/?league=pilot"])
pair = lg.render(row("pairings"), None)["embed"].to_dict()
check("pairings: a linked opponent is a mention", any("<@111>" in f["value"] for f in pair["fields"]))
check("pairings: an unlinked one is their name", any("**Bob**" in f["value"] for f in pair["fields"]))
check("pairings: no shared hours says so", any("No shared hours" in f["value"] for f in pair["fields"]))
check("pairings: the short seat is told why", "one opponent fewer" in pair["description"])
check("no public URL → no link button", lg.render(row("signup"), None).get("view") is None)
check("⭐ an unknown kind is None, not an exception",
      lg.render({"id": 9, "kind": "from-the-future", "data": {}}, None) is None)
check("the channel's season post names the champion",
      "Ann" in lg.render({**row("season", to=None), "data": {"season": "Pilot", "championName": "Ann", "champion": "u1",
                                                              "table": [{"id": "u1", "w": 8, "l": 2, "points": 24}]}}, None)["content"])


# ── §3 / §4 ───────────────────────────────────────────────────────────
class FakeUser:
    def __init__(self, uid, mode="ok"):
        self.id, self.mode, self.sent = uid, mode, []

    async def send(self, **kw):
        if self.mode == "closed":
            raise discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "Cannot send messages to this user")
        if self.mode == "flaky":
            raise discord.HTTPException(SimpleNamespace(status=500, reason="oops"), "server error")
        self.sent.append(kw)


class FakeChannel:
    def __init__(self):
        self.sent = []

    async def send(self, **kw):
        self.sent.append(kw)


class FakeBot:
    def __init__(self, users, channel):
        self.users, self.channel = users, channel

    async def fetch_user(self, uid):
        return self.users[uid]

    def get_channel(self, cid):
        return self.channel

    async def fetch_channel(self, cid):
        return self.channel

    async def wait_until_ready(self):
        return None


OUTBOX, ACKS = [], []


async def make_server():
    async def outbox(req):
        if req.headers.get("X-Algo-Bot") != "s3cret":
            return web.Response(status=404, text="not found")
        return web.json_response({"ok": True, "base": "https://algomancy.online", "rows": OUTBOX})

    async def ack(req):
        ACKS.append(await req.json())
        return web.json_response({"ok": True, "updated": 1})

    async def status(req):
        if req.query.get("discord") == "111":
            return web.json_response({"ok": True, "linked": True, "availability": True, "season": {
                "name": "Pilot", "label": "Week 1 of 3", "standings": [],
                "me": {"entered": True, "skips": [2], "joinProblem": None, "matches": [
                    {"week": 1, "opponent": {"name": "Bob"}, "result": None, "won": None}]}}})
        return web.json_response({"ok": True, "linked": False, "season": None, "availability": False})

    async def join(req):
        body = await req.json()
        return web.json_response({"ok": True} if body["discordId"] == "111" else {"ok": False, "error": "not-linked"})

    app = web.Application()
    app.router.add_get("/api/league/bot/outbox", outbox)
    app.router.add_post("/api/league/bot/ack", ack)
    app.router.add_get("/api/league/bot/status", status)
    app.router.add_post("/api/league/bot/join", join)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


def stub_interaction(uid):
    calls = []

    async def defer(**kw):
        calls.append(("defer", kw))

    async def send_message(*a, **kw):
        calls.append(("send_message", a, kw))

    async def followup(*a, **kw):
        calls.append(("followup", a, kw))

    return SimpleNamespace(user=SimpleNamespace(id=uid), channel_id=1, guild_id=9, calls=calls,
                           response=SimpleNamespace(defer=defer, send_message=send_message),
                           followup=SimpleNamespace(send=followup))


async def main():
    runner, base = await make_server()
    real = gameserver.client
    gameserver.client = gameserver.GameServer(base=base, token="s3cret", timeout=3)
    try:
        print("[§3 ⭐ pull → send → ack]")
        ann, closed, flaky = FakeUser(111), FakeUser(222, "closed"), FakeUser(333, "flaky")
        chan = FakeChannel()
        cog = lg.League(FakeBot({111: ann, 222: closed, 333: flaky}, chan))
        lg.set_channel(77, 9, 1)
        OUTBOX[:] = [
            row("pairings", 1, "u1"),                                      # linked → DM
            row("pairings", 2, "u2"),                                      # unlinked → not-linked
            {**row("result", 3, "u1"), "to": {"id": "u3", "name": "Cy", "discordId": "222"}},   # DMs closed
            {**row("result", 4, "u1"), "to": {"id": "u4", "name": "Di", "discordId": "333"}},   # transient
            row("week-pairings", 5, None),                                 # channel
            {"id": 6, "kind": "from-the-future", "to": None, "data": {}, "people": {}},
        ]
        sent, failed = await cog.deliver_once()
        check("⭐ the linked player got their DM", len(ann.sent) == 1 and ann.sent[0].get("embed") is not None)
        check("⭐ …with mentions that ping nobody", ann.sent[0]["allowed_mentions"].users is False)
        check("delivered rows are acked as sent", sorted(sent) == [1, 5])
        check("⭐ an unlinked player is acked not-linked", failed.get(2) == "not-linked")
        check("⭐ DMs closed → acked dm-closed…", failed.get(3) == "dm-closed")
        check("…and a mention in the league channel instead",
              any("<@222>" in (m.get("content") or "") for m in chan.sent))
        check("⭐ a transient error is NOT acked, so it goes again next pass", 4 not in sent and 4 not in failed)
        check("an unknown kind is acked failed rather than retried for ever", failed.get(6) == "unknown-kind")
        check("the channel row was posted", any("week 1 of 3" in (m.get("content") or "") for m in chan.sent))
        check("one ack call carried all of it", len(ACKS) == 1 and sorted(ACKS[0]["sent"]) == [1, 5]
              and set(ACKS[0]["failed"]) == {"2", "3", "6"})

        lg.set_channel(77, 9, 1, on=False)
        OUTBOX[:] = [row("week-closed", 7, None)]
        _, failed = await cog.deliver_once()
        check("a channel row with no channel set is 'no-channel'", failed.get(7) == "no-channel")

        print("[§4 ⭐ the test redirect]")
        me = FakeUser(999)
        cog = lg.League(FakeBot({999: me}, chan))
        lg.REDIRECT = "999"
        OUTBOX[:] = [row("pairings", 8, "u2"), row("signup", 9, "u1")]
        sent, failed = await cog.deliver_once()
        lg.REDIRECT = None
        check("⭐ even an unlinked player's DM reaches the tester", sorted(sent) == [8, 9] and not failed)
        check("⭐ …headed with who it was for", "to Bob" in (me.sent[0].get("content") or "")
              and "to Ann" in (me.sent[1].get("content") or ""))

        print("[§6 /league join, /league status]")
        ix = stub_interaction(111)
        await cog.join.callback(cog, ix)
        check("⭐ join defers first", ix.calls[0][0] == "defer")
        check("a linked player is in", "You're in" in ix.calls[-1][1][0])
        ix = stub_interaction(444)
        await cog.join.callback(cog, ix)
        check("⭐ an unlinked one is told how to link", "/link code" in ix.calls[-1][1][0])
        ix = stub_interaction(111)
        await cog.status.callback(cog, ix)
        out = ix.calls[-1][1][0]
        check("status names this week's opponent and the skip", "Bob" in out and "week 2" in out)
    finally:
        await gameserver.client.close()
        gameserver.client = real
        await runner.cleanup()


asyncio.run(main())

# ── §5 ────────────────────────────────────────────────────────────────
print("[§5 the loop and build_bot]")


async def built():
    import bot as botmod
    b = await botmod.build_bot()
    cog = b.get_cog("League")
    running = cog.deliver_loop.is_running() if cog else None
    names = [c.name for c in b.tree.get_commands()]
    await b.close()
    return cog, running, names

cog, running, names = asyncio.run(built())
check("the League cog is loaded", cog is not None)
check("⭐ build_bot() does not start the delivery loop", running is False)
check("/league is registered", "league" in names)

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
