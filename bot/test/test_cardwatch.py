#!/usr/bin/env python3
"""
test_cardwatch.py — the card-errata watcher: both halves, and the dispatch
between them.
Run: `.venv/bin/python bot/test/test_cardwatch.py`. No Discord, no network.

§1 the report text: what it says, and the warning it must never lose
§2 ⭐ A FORWARDED #card-changes POST IS A WEBHOOK, SO ITS AUTHOR IS A BOT.
   `AlgoBot.on_message` returns early on `message.author.bot`, correctly, for
   its own job — and a listener living there would therefore never see the one
   kind of message this feature exists for. This drives the REAL dispatch, not
   the cog method, because the method working proves nothing about whether it
   is ever called.
§3 the two halves report differently on a clean result: a post gets an answer
   (silence would read as "it missed it", and a clean result after a real post
   is itself information — the feed cannot see banners), the daily poll says
   nothing (a bot that reports "still fine" every day is a bot you skim).
§4 the channel gate: another channel is ignored, and so is the cog's own report
§5 a failing fetch never takes the bot down, and never spams the daily channel
§6 ⭐ UNCONFIGURED MEANS ABSENT, NOT BROKEN. With no ALGO_CARDWATCH_CHANNEL the
   loop must not start — the same rule ALGO_BOT_TOKEN follows on both sides.

⚠ TWO TRACEBACKS ON STDERR ARE EXPECTED. §5 drives the failing-fetch path, and
the cog prints the exception on purpose so a broken poll is visible in the
journal. A clean run still ends in a pass line and exit 0.
"""

import os as _os
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

# ⚠ BEFORE THE IMPORT. The cog reads its channel id at module import, so a test
# that sets this afterwards would configure nothing and quietly prove nothing.
CHANNEL = 424242424242
_os.environ["ALGO_CARDWATCH_CHANNEL"] = str(CHANNEL)

import asyncio  # noqa: E402

from cogs import cardwatch  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


FINDINGS = [
    {"name": "Stalwart Sentinel", "version": 2,
     "notes": ["text\n      ours: [Augment] When you play a card…\n      site: AUGMENT 1X: …"]},
    {"name": "Deathcoil Construct", "version": 2, "notes": ["mana 3 -> 5", "toughness 3 -> 2"]},
]


# ── §1 the report text ────────────────────────────────────────────────

msg = cardwatch._format(FINDINGS, "a post in the mirrored #card-changes")
check("the report names every card", "Stalwart Sentinel" in msg and "Deathcoil Construct" in msg)
check("…and every note under them", "mana 3 -> 5" in msg and "toughness 3 -> 2" in msg)
check("…and says how many", "2 card(s)" in msg)
check("…and names what triggered it", "#card-changes" in msg)
check("⭐ it never loses the warning that the feed has not read the card",
      "does not OCR" in msg and "Open the scan" in msg)
check("it fits in one Discord message", len(msg) <= 2000)

many = cardwatch._format([{"name": f"Card {i}", "version": 2, "notes": ["x" * 200]}
                          for i in range(40)], "daily check")
check("a big errata round is truncated rather than refused", len(many) <= 2000)
check("…and says so instead of silently dropping cards", "more" in many)


# ── the stubs ─────────────────────────────────────────────────────────

class FakeChannel:
    def __init__(self, cid):
        self.id = cid
        self.sent = []

    async def send(self, content, **kw):
        self.sent.append(content)


class FakeUser:
    def __init__(self, uid, is_bot):
        self.id = uid
        self.bot = is_bot


class FakeMessage:
    def __init__(self, channel, author):
        self.channel = channel
        self.author = author


class FakeBot:
    def __init__(self):
        self.user = FakeUser(999, True)
        self._channels = {}

    def get_channel(self, cid):
        return self._channels.get(cid)


def cog_with(findings, *, raises=False):
    """A CardWatch whose check is stubbed. The loop is cancelled at once —
    §6 covers whether it started, and a live 24h timer in a test is a leak."""
    bot = FakeBot()
    cog = cardwatch.CardWatch(bot)
    if cog.poll.is_running():
        cog.poll.cancel()

    async def fake_check():
        if raises:
            raise RuntimeError("algomancer.cc is down")
        return findings
    cog.run_check = fake_check
    return cog


# ── §2 the dispatch, through the real bot ─────────────────────────────

async def dispatch_tests():
    import bot as botmod

    b = await botmod.build_bot()
    cog = b.get_cog("CardWatch")
    check("the cog is loaded by build_bot", cog is not None)
    check("⭐ build_bot does not start a live 24h timer (it connects to nothing)",
          not cog.poll.is_running())

    # ⭐ THE WIRING, STRUCTURALLY. `Bot.dispatch` cannot be driven here — it
    # reaches `Client.loop`, which raises on a client that has never logged in,
    # and build_bot() deliberately does not log in. So the claim is checked
    # where it actually lives: a cog listener is registered in `extra_events`
    # and dispatched BESIDE `AlgoBot.on_message`, not through it. That is the
    # whole reason this listener is in a cog and not in bot.py.
    listeners = [f.__qualname__ for f in b.extra_events.get("on_message", [])]
    check("⭐ the cog's on_message is registered beside AlgoBot's, not inside it",
          any("CardWatch" in q for q in listeners))

    # …and WHY that matters, as a differential rather than an assertion about
    # nothing. `&anything` is the one content AlgoBot.on_message answers outside
    # a thread (the legacy-prefix pointer), so the SAME message from a human and
    # from a bot separates the two paths: one replies, one returns at the
    # `author.bot` guard. Without the contrast this check would pass vacuously,
    # which is how a guard in this repo has silently proved nothing before.
    class Replyable(FakeMessage):
        def __init__(self, channel, author, content):
            super().__init__(channel, author)
            self.content = content
            self.replies = []

        async def reply(self, *a, **kw):
            self.replies.append((a, kw))

    human = Replyable(FakeChannel(CHANNEL), FakeUser(777, False), "&card")
    await botmod.AlgoBot.on_message(b, human)
    check("AlgoBot.on_message DOES answer a human's legacy `&` message",
          len(human.replies) == 1)

    forward = Replyable(FakeChannel(CHANNEL), FakeUser(555, True), "&card")
    await botmod.AlgoBot.on_message(b, forward)
    check("⭐ …and drops the identical message when its author is a BOT — which "
          "every forwarded #card-changes post is, so a listener living in bot.py "
          "would never see one", forward.replies == [])

    await b.close()


async def listener_tests():
    """The cog's listener itself, called the way the dispatcher calls it."""
    cog = cog_with([])
    chan = FakeChannel(CHANNEL)
    calls = []

    async def record(channel, trigger, *, quiet_when_level):
        calls.append((channel, trigger, quiet_when_level))
    cog.report = record

    # a forwarded #card-changes post: author.bot is True
    await cog.on_message(FakeMessage(chan, FakeUser(555, True)))
    check("⭐ a WEBHOOK forward (author.bot) reaches the cog and runs a check", len(calls) == 1)
    check("…and is reported as a post, not as a poll",
          bool(calls) and calls[0][1].startswith("a post") and calls[0][2] is False)

    calls.clear()
    await cog.on_message(FakeMessage(chan, FakeUser(777, False)))
    check("a human post in that channel also triggers a check", len(calls) == 1)

    # §4 the channel gate
    calls.clear()
    await cog.on_message(FakeMessage(FakeChannel(CHANNEL + 1), FakeUser(555, True)))
    check("another channel is ignored", calls == [])

    await cog.on_message(FakeMessage(chan, FakeUser(999, True)))   # 999 == the bot itself
    check("⭐ its OWN report does not trigger another check (no feedback loop)", calls == [])


# ── §3/§5 how each half reports ───────────────────────────────────────

async def report_tests():
    # a post, clean result → it answers, and says why clean is not "no change"
    cog = cog_with([])
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "a post in the mirrored #card-changes", quiet_when_level=False)
    check("a post with no field diff still gets an answer", len(chan.sent) == 1)
    check("⭐ …and that answer says the feed cannot see a banner",
          bool(chan.sent) and "banner" in chan.sent[0] and "scan" in chan.sent[0])

    # the daily poll, clean result → silence
    cog = cog_with([])
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "daily check", quiet_when_level=True)
    check("the daily poll says nothing when nothing changed", chan.sent == [])

    # the daily poll, findings → it speaks
    cog = cog_with(FINDINGS)
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "daily check", quiet_when_level=True)
    check("…and does speak when something did", len(chan.sent) == 1)
    check("…with the findings in it", bool(chan.sent) and "Deathcoil Construct" in chan.sent[0])

    # §5 a broken fetch
    cog = cog_with(None, raises=True)
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "daily check", quiet_when_level=True)
    check("⭐ a failing daily poll posts nothing rather than a stack trace every morning",
          chan.sent == [])
    cog = cog_with(None, raises=True)
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "a post in the mirrored #card-changes", quiet_when_level=False)
    check("…but a check somebody asked for says it failed", len(chan.sent) == 1)
    check("…naming the reason", bool(chan.sent) and "algomancer.cc is down" in chan.sent[0])


# ── §6 unconfigured means absent ──────────────────────────────────────

def unconfigured_test():
    saved = cardwatch.CHANNEL_ID
    cardwatch.CHANNEL_ID = 0
    try:
        cog = cardwatch.CardWatch(FakeBot())
        check("⭐ with no ALGO_CARDWATCH_CHANNEL the daily loop never starts",
              not cog.poll.is_running())
        if cog.poll.is_running():
            cog.poll.cancel()
    finally:
        cardwatch.CHANNEL_ID = saved


asyncio.run(dispatch_tests())
asyncio.run(listener_tests())
asyncio.run(report_tests())
unconfigured_test()

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
