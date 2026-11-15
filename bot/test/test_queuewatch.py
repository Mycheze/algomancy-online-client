#!/usr/bin/env python3
"""
test_queuewatch.py — the queue announcer: its config file, its cooldown, and
reading the game server's event ring.
Run: `.venv/bin/python bot/test/test_queuewatch.py`. No Discord, no game server.

§1 ⭐ THE CONFIG FILE IS THE FIRST REWRITABLE FILE THE PYTHON SIDE OWNS, and it
   is rewritten whole. A torn write does not lose a row, it silently disables
   the feature — so: it lands under ALGO_VAR_DIR, it is written atomically, and
   a corrupt one reads as empty instead of stopping the bot from booting.
§2 the cooldown, driven by an injected clock so nothing sleeps
§5 the announcement's allowed-mentions, which is the difference between "come
   play" and pinging a server
§6 ⭐ EVERY EVENT KIND GOES THROUGH on_event AGAINST A STUB BOT. The dispatch
   shipped once calling three methods that did not exist.
§7 ⭐ THE POLL, ACROSS RESTARTS, against a stand-in for the server's ring
   (client/server/hooks.ts): nothing that happened while the bot was down is
   lost, a gap it cannot see resynchronises from the queue, and what it posted
   survives it.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import contextlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402

import discord  # noqa: E402

import gameserver  # noqa: E402
import paths  # noqa: E402
import watchers  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


# ── §1 the config file ────────────────────────────────────────────────
print("\n[§1 the watch list]")
target = paths.queue_watch_file()
check(f"⭐ it lands under the scratch var dir, not the deployment's "
      f"({target})", str(_scratch_var.scratch_var_dir()) in str(target))

watchers.remove_watch(111)
check("a fresh file reads as no watches", watchers.all_watches() == {})
check("removing something that isn't there says so", watchers.remove_watch(111) is False)

check("adding a watch returns False (nothing replaced)",
      watchers.set_watch(111, guild_id=999, role_id=42, added_by=7) is False)
w = watchers.all_watches()
check(f"…and it is there, keyed by int channel id (got {list(w)})", list(w) == [111])
check("…with the guild and role", w[111]["guild_id"] == 999 and w[111]["role_id"] == 42)
check("re-adding the same channel REPLACES and says so",
      watchers.set_watch(111, guild_id=999, role_id=None) is True)
check("…and the role really changed", watchers.all_watches()[111]["role_id"] is None)

watchers.set_watch(222, guild_id=888)
check("two channels, two watches", set(watchers.all_watches()) == {111, 222})
check("watches_for_guild filters", set(watchers.watches_for_guild(999)) == {111})
check("the file is valid JSON on disk", isinstance(
    json.loads(target.read_text()), dict))
check("⭐ no .tmp is left behind — the write is rename-based",
      not target.with_suffix(".tmp").exists())

check("removing works", watchers.remove_watch(222) is True)
check("…and persists", set(watchers.all_watches()) == {111})

# ⭐ the one that matters: a corrupt file must not stop the bot.
target.write_text("{ this is not json")
check("⭐ a CORRUPT file reads as empty rather than raising — a config file "
      "must never be able to stop the bot from booting",
      watchers.all_watches() == {})
target.write_text('{"version": 1, "watches": []}')      # right type, wrong shape
check("…and so does one of the wrong shape", watchers.all_watches() == {})
target.unlink()

# ── §2 the cooldown ───────────────────────────────────────────────────
print("\n[§2 the cooldown, on an injected clock]")
watchers.reset_cooldowns()
T = 1000.0
check("the first announcement goes out", watchers.may_announce("u1", 1, now=T))
check("⭐ the same person again immediately does NOT — one person who queues, "
      "declines and requeues is ONE event",
      not watchers.may_announce("u1", 1, now=T + 5))
check("…still not, just before the window closes",
      not watchers.may_announce("u1", 1, now=T + watchers.JOIN_COOLDOWN - 1))
watchers.reset_cooldowns()
check("…but does once it has passed",
      watchers.may_announce("u1", 1, now=T)
      and watchers.may_announce("u1", 1, now=T + watchers.JOIN_COOLDOWN + 1))

watchers.reset_cooldowns()
check("a DIFFERENT person in the same channel is still gated by the channel floor",
      watchers.may_announce("u1", 1, now=T)
      and not watchers.may_announce("u2", 1, now=T + 1))
check("…and gets through once the floor has passed",
      watchers.may_announce("u2", 1, now=T + watchers.CHANNEL_COOLDOWN + 1))

watchers.reset_cooldowns()
check("⭐ the SAME person is gated in EVERY channel, not per channel",
      watchers.may_announce("u1", 1, now=T)
      and not watchers.may_announce("u1", 2, now=T))

watchers.reset_cooldowns()
check("a suppressed announcement does not push the next one further away",
      watchers.may_announce("u1", 1, now=T)
      and not watchers.may_announce("u1", 1, now=T + 10)
      and watchers.may_announce("u1", 1, now=T + watchers.JOIN_COOLDOWN + 1))


# ── §5 the announcement ───────────────────────────────────────────────
print("\n[§5 what the announcement is allowed to ping]")
from cogs.queuewatch import QueueWatch  # noqa: E402


class FakeRole:
    id = 4242
    mention = "@Players"

    def is_default(self):
        return False


cog = QueueWatch(None)
event = {"t": "queue.join", "userId": "u1", "username": "Ben", "discordId": None,
         "mode": "constructed", "ranked": True, "rating": 1042,
         "counts": {"total": 2}}

out = cog._announcement(event, None)
am = out["allowed_mentions"]
check("with no role, nothing is pinged",
      am.roles is False and am.users is False and am.everyone is False)
check("the message names the player, the format and the count",
      "Ben" in out["content"] and "constructed" in out["content"]
      and "2 waiting" in out["content"])

role = FakeRole()
out = cog._announcement(event, role)
am = out["allowed_mentions"]
check("⭐ with a role, EXACTLY that role is pinged and nothing else",
      am.roles == [role] and am.users is False and am.everyone is False)
check("…and it is actually mentioned in the text", "@Players" in out["content"])

linked = dict(event, discordId="123456789")
out = cog._announcement(linked, None)
check("a linked player is shown as a mention", "<@123456789>" in out["content"])
check("⭐ …but users=False, so being announced does not ping you",
      out["allowed_mentions"].users is False)


# ── §6 the dispatch ───────────────────────────────────────────────────
print("\n[§6 ⭐ every event kind, through on_event, against a stub bot]")
from cogs import queuewatch as qw  # noqa: E402


class FakeMessage:
    _next = 1000

    def __init__(self):
        FakeMessage._next += 1
        self.id = FakeMessage._next
        self.edits = []

    async def edit(self, **kw):
        self.edits.append(kw)


class FakeChannel:
    def __init__(self, cid):
        self.id = cid
        self.guild = type("G", (), {"get_role": staticmethod(lambda _rid: None)})()
        self.sent = []
        self.messages = {}

    async def send(self, **kw):
        m = FakeMessage()
        self.sent.append(kw)
        self.messages[m.id] = m
        return m

    def get_partial_message(self, mid):
        return self.messages.get(mid) or Deleted()


class Deleted:
    """A message somebody deleted on Discord: editing it is a 404."""
    async def edit(self, **kw):
        raise discord.NotFound(type("R", (), {"status": 404, "reason": "Not Found"})(),
                               "Unknown Message")


class FakeBot:
    def __init__(self, *channels):
        self.channels = {c.id: c for c in channels}

    def get_channel(self, cid):
        return self.channels.get(cid)


async def dispatch_tests():
    chan = FakeChannel(111)
    cog = qw.QueueWatch(FakeBot(chan))
    watchers.set_watch(111, guild_id=999)
    cog.posted.clear()

    def join(uid, name):
        watchers.reset_cooldowns()
        return {"event": {"t": "queue.join", "userId": uid, "username": name,
                          "discordId": None, "mode": "draft", "ranked": False,
                          "rating": 1000, "counts": {"total": 1}}}

    await cog.on_event(join("u1", "Ben"))
    check("a join posts one announcement", len(chan.sent) == 1)
    check("⭐ …and remembers it, so it can be corrected later",
          cog.posted.get("u1") == [(111, chan.sent and max(chan.messages))])
    first = chan.messages[max(chan.messages)]

    await cog.on_event(join("u2", "Rashi"))
    second = chan.messages[max(chan.messages)]
    await cog.on_event({"event": {"t": "queue.match", "room": "ABCD", "mode": "draft",
                                  "seats": [{"userId": "u1", "username": "Ben", "seat": 0, "rating": 1000},
                                            {"userId": "u2", "username": "Rashi", "seat": 1, "rating": 1000}]}})
    check("⭐ a match edits BOTH invitations", len(first.edits) == 1 and len(second.edits) == 1)
    check("…to say who is playing whom", "Ben vs Rashi" in first.edits[0]["content"]
          and "playing now" in first.edits[0]["content"])
    check("…and drops the Join button", first.edits[0]["view"] is None)
    check("…and forgets both", "u1" not in cog.posted and "u2" not in cog.posted)
    check("…without sending anything new", len(chan.sent) == 2)

    await cog.on_event(join("u3", "Cass"))
    third = chan.messages[max(chan.messages)]
    await cog.on_event({"event": {"t": "queue.leave", "userId": "u3", "username": "Cass",
                                  "discordId": None, "mode": "draft", "reason": "left",
                                  "counts": {"total": 0}}})
    check("a leave edits that person's invitation",
          len(third.edits) == 1 and "stopped waiting" in third.edits[0]["content"])

    await cog.on_event(join("u4", "Dee"))
    fourth = chan.messages[max(chan.messages)]
    await cog.on_event({"event": {"t": "queue.lapse", "mode": "draft",
                                  "backInLine": [], "dropped": ["u4"]}})
    check("⭐ a decliner (who never emits leave) is caught on lapse.dropped",
          len(fourth.edits) == 1 and "no longer open" in fourth.edits[0]["content"])
    check("nothing is left remembered", cog.posted == {})

    await cog.on_event({"event": {"t": "queue.match", "room": "X", "mode": "draft",
                                  "seats": [{"userId": "nobody", "username": "?"}]}})
    check("a match for somebody never announced is a no-op", len(chan.sent) == 4)
    await cog.on_event({"event": {"t": "who.knows"}})
    check("an unknown kind is ignored", len(chan.sent) == 4)
    watchers.remove_watch(111)


asyncio.run(dispatch_tests())


# ── §7 the poll ───────────────────────────────────────────────────────
print("\n[§7 ⭐ the poll, across restarts]")


class FakeRing:
    """The game server's /api/bot/events and /api/bot/queue (hooks.ts since())."""
    token = "t"

    def __init__(self, boot, cap=500):
        self.boot, self.cap, self.seq, self.ring, self.waiting = boot, cap, 0, [], set()

    def emit(self, event, ends=()):
        self.seq += 1
        self.ring = (self.ring + [{"seq": self.seq, "bootId": self.boot, "event": event}])[-self.cap:]
        if event["t"] == "queue.join":
            self.waiting.add(event["userId"])
        self.waiting -= set(ends)

    async def events(self, since):
        oldest = self.ring[0]["seq"] if self.ring else self.seq + 1
        return {"ok": True, "bootId": self.boot, "nextSeq": self.seq, "truncated": since + 1 < oldest,
                "events": [e for e in self.ring if e["seq"] > since]}

    async def queue(self):
        return {"ok": True, "waiting": [{"userId": u} for u in sorted(self.waiting)]}


def join_ev(uid, name):
    return {"t": "queue.join", "userId": uid, "username": name, "discordId": None,
            "mode": "draft", "ranked": False, "rating": 1000, "counts": {"total": 1}}


def leave_ev(uid, name):
    return {"t": "queue.leave", "userId": uid, "username": name, "discordId": None,
            "mode": "draft", "reason": "left", "counts": {"total": 0}}


async def poll(cog):
    watchers.reset_cooldowns()            # §2 covers the cooldown; here it would hide events
    await cog.poll_once()


async def poll_tests():
    real = gameserver.client
    paths.queue_posted_file().unlink(missing_ok=True)
    chan = FakeChannel(111)
    bot = FakeBot(chan)
    watchers.set_watch(111, guild_id=999)
    server = gameserver.client = FakeRing("boot-1")
    try:
        cog = qw.QueueWatch(bot)
        await poll(cog)                                    # first start: resync
        server.emit(join_ev("u1", "Ben"))
        await poll(cog)
        ben = chan.messages[max(chan.messages)]
        # the bot is down while three things happen
        server.emit(join_ev("u2", "Rashi"))
        server.emit({"t": "queue.match", "room": "ABCD", "mode": "draft",
                     "seats": [{"userId": "u1", "username": "Ben", "seat": 0, "rating": 1000},
                               {"userId": "u2", "username": "Rashi", "seat": 1, "rating": 1000}]},
                    ends=("u1", "u2"))
        server.emit(join_ev("u3", "Cass"))
        cog = qw.QueueWatch(bot)                           # restarted: only the file survives
        await poll(cog)
        check("⭐ AFTER A RESTART, WHAT HAPPENED WHILE THE BOT WAS DOWN IS DELIVERED: Ben's "
              "invitation says he is playing, Rashi (whose game is already over) is not "
              "announced, Cass (still waiting) is "
              f"(edits {[e['content'] for e in ben.edits]}, sent {[s['content'][:20] for s in chan.sent]})",
              len(ben.edits) == 1 and "Ben vs Rashi" in ben.edits[0]["content"]
              and len(chan.sent) == 2 and "Cass" in chan.sent[1]["content"])
        cass = chan.messages[max(chan.messages)]

        # the server restarts: a new boot, an empty queue, then Dee joins
        server = gameserver.client = FakeRing("boot-2")
        server.emit(join_ev("u4", "Dee"))
        await poll(cog)
        await poll(cog)
        restarted = ("no longer open" in (cass.edits or [{}])[-1].get("content", "")
                     and len(chan.sent) == 3 and "Dee" in chan.sent[2]["content"])
        dee = chan.messages[max(chan.messages)]
        # the bot misses more than the ring holds, Dee's leave among it
        server.emit(leave_ev("u4", "Dee"), ends=("u4",))
        for i in range(600):
            server.emit(join_ev(f"x{i}", f"Filler {i}"))
        await poll(cog)
        truncated = ("no longer open" in (dee.edits or [{}])[-1].get("content", "")
                     and len(chan.sent) == 3 and cog.seq == server.seq)
        check("⭐ A NEW BOOT OR A TRUNCATED ANSWER RESYNCHRONISES FROM THE QUEUE: invitations "
              "of people no longer waiting are closed, a new boot's ring is read from its "
              "start, and a gap is not replayed "
              f"(after the server restart {restarted}, after the overflow {truncated})",
              restarted and truncated)

        # what was posted outlives the bot, and a message deleted since is let go
        server.emit(join_ev("u5", "Gil"))
        await poll(cog)
        gil = max(chan.messages)
        before = dict(cog.posted)
        cog = qw.QueueWatch(bot)
        survived = cog.posted == before and "u5" in cog.posted
        del chan.messages[gil]
        server.emit(leave_ev("u5", "Gil"), ends=("u5",))
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            await poll(cog)
        check("⭐ THE POSTED MAP SURVIVES A RESTART, and a message deleted on Discord since "
              f"is forgotten quietly (survived {survived}, said {said.getvalue()!r})",
              survived and "u5" not in cog.posted and "u5" not in qw._load()[2]
              and said.getvalue() == "")
    finally:
        gameserver.client = real
        watchers.remove_watch(111)


asyncio.run(poll_tests())

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
