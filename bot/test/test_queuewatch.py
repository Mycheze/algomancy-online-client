#!/usr/bin/env python3
"""
test_queuewatch.py — the queue announcer: its config file, its cooldown, and
the listener the game server pushes to.
Run: `.venv/bin/python bot/test/test_queuewatch.py`. No Discord, no game server.

§1 ⭐ THE CONFIG FILE IS THE FIRST REWRITABLE FILE THE PYTHON SIDE OWNS, and it
   is rewritten whole. A torn write does not lose a row, it silently disables
   the feature — so: it lands under ALGO_VAR_DIR, it is written atomically, and
   a corrupt one reads as empty instead of stopping the bot from booting.
§2 the cooldown, driven by an injected clock so nothing sleeps
§3 the listener: a wrong secret is a 404 (not a 403), no secret means no
   listener at all, malformed JSON is refused, an unknown event is ignored
§4 ⭐ THE HANDLER RETURNS BEFORE THE FAN-OUT FINISHES. The game server calls
   this from inside its own queue-join path; a slow Discord call must never be
   able to hold that request open.
§5 the announcement's allowed-mentions, which is the difference between "come
   play" and pinging a server
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import json  # noqa: E402

import discord  # noqa: E402
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import paths  # noqa: E402
import pushserver  # noqa: E402
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


# ── §3 + §4 the listener ──────────────────────────────────────────────
async def listener_tests():
    global PASS, FAILED
    print("\n[§3 the listener refuses what it should]")
    seen = []
    gate = asyncio.Event()

    async def on_event(envelope):
        seen.append(envelope)
        await gate.wait()          # §4 holds the fan-out open on purpose

    app = pushserver.build_app(on_event, token="s3cret")
    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    try:
        body = {"bootId": "b", "events": [{"seq": 1, "event": {"t": "queue.join"}}]}

        r = await client.post("/push/queue", json=body)
        check(f"⭐ no header is a 404, not a 403 — the two ends agree that an "
              f"unconfigured deploy admits nothing (got {r.status})", r.status == 404)
        r = await client.post("/push/queue", json=body,
                              headers={"X-Algo-Bot": "wrong"})
        check(f"a wrong secret is a 404 too (got {r.status})", r.status == 404)
        r = await client.post("/push/queue", data="not json",
                              headers={"X-Algo-Bot": "s3cret",
                                       "content-type": "application/json"})
        check(f"malformed JSON is refused, not crashed on (got {r.status})",
              r.status == 400)
        r = await client.post("/push/queue", json={"events": "nope"},
                              headers={"X-Algo-Bot": "s3cret"})
        check("events must be a list", r.status == 400)

        r = await client.get("/healthz")
        check("healthz answers", r.status == 200)

        print("\n[§4 ⭐ the handler returns before the fan-out finishes]")
        check("nothing has been handled yet", seen == [])
        r = await client.post("/push/queue", json=body,
                              headers={"X-Algo-Bot": "s3cret"})
        check(f"the push is accepted (got {r.status})", r.status == 200)
        payload = await r.json()
        check("…and says how many it took", payload.get("accepted") == 1)
        # ⭐ The response arrived while on_event is still blocked on `gate`.
        check("⭐ THE RESPONSE CAME BACK WHILE THE HANDLER IS STILL BLOCKED — "
              "the game server calls this from inside its own queue-join path, "
              "and a slow Discord call must not hold that open",
              not gate.is_set())
        gate.set()
        await asyncio.sleep(0.05)
        check("…and the event really was handled, afterwards", len(seen) == 1)

        # an unknown event type must not 400: a newer server may send one
        gate.set()
        r = await client.post("/push/queue",
                              json={"events": [{"seq": 2, "event": {"t": "who.knows"}}]},
                              headers={"X-Algo-Bot": "s3cret"})
        check("an unknown event type is accepted and ignored, so a newer game "
              "server does not get a 400 from an older bot", r.status == 200)

        # a handler that raises must not take the bot down
        async def boom(envelope):
            raise RuntimeError("nope")

        app2 = pushserver.build_app(boom, token="s3cret")
        s2 = TestServer(app2)
        c2 = TestClient(s2)
        await c2.start_server()
        r = await c2.post("/push/queue", json=body, headers={"X-Algo-Bot": "s3cret"})
        check("a handler that raises still answers 200", r.status == 200)
        await asyncio.sleep(0.05)
        check("…and the listener is still alive after it",
              (await c2.get("/healthz")).status == 200)
        await c2.close()
    finally:
        await client.close()


asyncio.run(listener_tests())

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

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
