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
§7 ⭐ THE DAILY POLL SAYS A LIST ONCE. An unfixed finding stays in the diff, and
   the poll used to post the identical report every morning.
§8 ⭐ ONE CARD, TWO SPELLINGS, NO FINDING — and a real change still is one. The
   site retyped its records on 2026-10-01 (`[4; Water 2]` for our `[4bb]`, the
   Prophecy banner moved into its own field, `prismite` for colourless…) and
   the checker posted ~37 unchanged cards a day. Each spelling pair below must
   compare equal, and each must still catch the edit that matters.

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


async def dedupe_tests():
    import paths
    paths.cardwatch_posted().unlink(missing_ok=True)

    cog = cog_with(FINDINGS)
    chan = FakeChannel(CHANNEL)
    await cog.report(chan, "daily check", quiet_when_level=True)
    await cog.report(chan, "daily check", quiet_when_level=True)
    check("⭐ the daily poll posts a list once, not every morning", len(chan.sent) == 1)

    changed = FINDINGS + [{"name": "Feed to Hooba", "version": 2, "notes": ["text …"]}]
    cog = cog_with(changed)
    await cog.report(chan, "daily check", quiet_when_level=True)
    check("…and speaks again when the list changes", len(chan.sent) == 2)

    await cog.report(chan, "a post in the mirrored #card-changes", quiet_when_level=False)
    check("a post in the channel always gets the full answer, even an unchanged one",
          len(chan.sent) == 3)

    await cog_with([]).report(chan, "daily check", quiet_when_level=True)
    await cog_with(changed).report(chan, "daily check", quiet_when_level=True)
    check("a list that clears and comes back is news again", len(chan.sent) == 4)


# ── §8 the normaliser ─────────────────────────────────────────────────

def normaliser_tests():
    import copy
    import json
    import paths
    from pipeline import check_card_updates as checker

    ours = json.loads(paths.ORACLE_JSON.read_text(encoding="utf-8"))

    def site(name, mana, abilities, affinity, *, main="Unit", power=None, defense=None,
             prophecy=None, image=None):
        o = ours[name][0]
        return {"name": name, "manaCost": mana, "abilities": [abilities] if abilities else [],
                "prophecy": prophecy, "set": {"name": "Core Set"},
                "imageUrl": image or o.get("image"),
                "typeAndAttributes": {"mainType": main},
                "stats": {"power": int(o["power"]) if power is None and o.get("power") else power,
                          "defense": int(o["toughness"]) if defense is None and o.get("toughness") else defense,
                          "affinity": affinity}}

    # Each record is the site's 2026-10-01 spelling of the card, verbatim.
    records = {
        "ambush cost `[2; Water 1, Earth 1]` for `[2be]`, `1X` for `[once]`": site(
            "Mirrorback Ambusher", 2,
            'battle Ambush [2; Water 1, Earth 1] (Play me with the effect "Recall target ally, '
            'put me into their position in play.") 1X When I am dealt damage, I deal that much '
            'damage to target unit.', {"earth": 1, "water": 1}),
        "Prophecy in its own field, not in the text": site(
            "Air Plant", 7, "(Only flying units can block flying units.) AUGMENT: Your other "
            "units gain +2/+2 and Flying.", {"light": 1, "wood": 1},
            prophecy={"manaCost": 2, "affinity": {"light": 1, "wood": 1},
                      "condition": "Your units have four unique costs."}),
        "`/[…]` and a line-break hyphen `sacri- {/n}fices`": site(
            "Structural Collapse", 3, "GRAFT1: [Sacrifice a unit]: Each opponent sacrifices units "
            "until their total defense is at least equal to the defense of your sacrificed unit.",
            {"earth": 2, "fire": 1}, main="Spell"),
        "`non-token` for our `non- {/n}token`": site(
            "Animated Spark", int(ours["Animated Spark"][0]["total_cost"]),
            "AUGMENT: Your units gain +1/+0 for each non-token spell you've played in this battle.",
            checker.our_affinity(ours["Animated Spark"][0]["cost"]), main="Spell"),
        "`prismite` is colourless": site(
            "Prismite", 0, "Erase me: Create a non-prismite resource, then activate it. Do this "
            "only during the mana step. (This does not use one of your activations for turn.)",
            {"prismite": 1}, main="Resource"),
        "Dark recorded": site(
            "Blightsea Polyp", 2, "AUGMENT: Columns deal combat damage to players as 1 rot. (For "
            "example, a column of a 4/4 unit and 2/2 unit would give the opponent 1 rot, without "
            "changing their life total.)", {"dark": 1, "water": 1}),
    }

    def found(rec):
        f, _ = checker.compare({rec["name"]: ours[rec["name"]]}, [rec])
        return f[0]["notes"] if f else []

    for label, rec in records.items():
        check(f"⭐ same card, two spellings → no finding: {label}  {found(rec)}", found(rec) == [])

    # …and the edit that matters is still seen through each normalisation.
    def edited(label, fn):
        rec = copy.deepcopy(records[label])
        fn(rec)
        return found(rec)

    check("an Ambush cost's affinity changing is still found",
          edited("ambush cost `[2; Water 1, Earth 1]` for `[2be]`, `1X` for `[once]`",
                 lambda r: r["abilities"].__setitem__(0, r["abilities"][0].replace("Earth 1", "Fire 1"))) != [])
    check("a Prophecy condition changing is still found",
          edited("Prophecy in its own field, not in the text",
                 lambda r: r["prophecy"].__setitem__("condition", "Two Turns Pass")) != [])
    check("a Prophecy cost changing is still found",
          edited("Prophecy in its own field, not in the text",
                 lambda r: r["prophecy"].__setitem__("manaCost", 3)) != [])
    check("⭐ a Prophecy banner REMOVED upstream is found (Tithe Enforcer)",
          edited("Prophecy in its own field, not in the text",
                 lambda r: r.__setitem__("prophecy", None)) != [])
    check("a word changing through the hyphen join is still found",
          edited("`non-token` for our `non- {/n}token`",
                 lambda r: r["abilities"].__setitem__(0, r["abilities"][0].replace("non-token", "token"))) != [])
    check("a verb changing is still found (Feed to Hooba: erase → delete)",
          edited("`/[…]` and a line-break hyphen `sacri- {/n}fices`",
                 lambda r: r["abilities"].__setitem__(0, r["abilities"][0].replace("sacrifices units", "deletes units"))) != [])
    check("Dark changing is found now that the site records it",
          edited("Dark recorded", lambda r: r["stats"].__setitem__("affinity", {"dark": 2})) != [])
    check("a mana change is still found",
          edited("Dark recorded", lambda r: r.__setitem__("manaCost", 3)) != [])


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
asyncio.run(dedupe_tests())
normaliser_tests()

print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
