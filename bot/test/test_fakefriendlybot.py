#!/usr/bin/env python3
"""
test_fakefriendlybot.py — the test server's stand-in for FriendlyBot
(cogs/fakefriendlybot.py), against a fake channel. No Discord, nothing sleeps.
Run: `.venv/bin/python bot/test/test_fakefriendlybot.py`.

§1 an answer: FriendlyBot's four messages, its timings, its file name
§2 the pictures: the right region painted, edits accumulating
§3 what it ignores, as FriendlyBot does
§4 misbehaviour on request: silent, nototis, wrong, swr
§5 the watcher (cogs/cardedits.py) reads its answers as FriendlyBot's
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import io  # noqa: E402
import time  # noqa: E402

from PIL import Image, ImageChops  # noqa: E402

from cards import CardIndex  # noqa: E402
from cogs import cardedits as ce  # noqa: E402
from cogs import fakefriendlybot as ffb  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


CHANNEL, ELSEWHERE, BOT = "700000000000000001", "700000000000000002", "833541652374618223"
PREFIX = "CUsersCalebPycharmProjectscardgamebot_library"
CARDS = CardIndex()


class Sent:
    """One message the fake posted: its text, or its picture."""

    def __init__(self, content, file):
        self.content = content or ""
        self.filename = file.filename if file else None
        self.data = file.fp.read() if file else None

    async def read(self):
        return self.data


class FakeChannel:
    def __init__(self, cid=CHANNEL):
        self.id = int(cid)
        self.sent = []

    async def send(self, content=None, *, file=None):
        self.sent.append(Sent(content, file))


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def make():
    slept = []

    async def sleep(s):
        slept.append(s)
    fake = ffb.FakeFriendlyBot(None, channels={CHANNEL}, cards=CARDS, sleep=sleep)
    return fake, slept


async def say(fake, text, channel):
    await fake.on_message(Obj(channel=channel, content=text, author=Obj(id=int(BOT))))
    return channel.sent


def image(sent):
    return Image.open(io.BytesIO(sent.data)).convert("RGB")


def changed(a, b, box):
    """Does `box` differ between two pictures (beyond JPEG noise)?"""
    diff = ImageChops.difference(a.crop(box), b.crop(box)).convert("L")
    return diff.getextrema()[1] > 40


ORB = (40, 36, 112, 108)
STATS = (568, 50, 668, 104)
ART = (100, 300, 600, 600)
BANNER = (0, 440, 720, 520)


async def tests():
    # ── §1 ──
    print("\n[§1 an answer]")
    fake, slept = make()
    ch = FakeChannel()
    sent = await say(fake, "$modify murkstalker|total cost|2", ch)
    check(f"four messages ({len(sent)})", len(sent) == 4)
    check("⭐ the first line exactly: the name and field as typed",
          sent[0].content == "Modified murkstalker's total cost from this")
    check("the old picture, named as FriendlyBot names it",
          sent[1].filename == f"{PREFIX}Murkstalker.jpg" and sent[1].content == "")
    check("`To this`, then the new picture", sent[2].content == "To this" and sent[3].filename == sent[1].filename)
    check("FriendlyBot's timings: 0.3 s to the first line, ~5 s to the new picture",
          slept == list(ffb.DELAYS) and abs(sum(slept) - 5.7) < 0.01)
    check("JPEGs at the scan's size", all(s.data[:3] == b"\xff\xd8\xff" and image(s).size == (720, 1000)
                                          for s in (sent[1], sent[3])))
    fake, _ = make()
    sent = await say(fake, "$modify seer or empty spaces|Total_Cost|2", FakeChannel())
    check("a loose name: the echo keeps what was typed, the file names the real card",
          sent[0].content == "Modified seer or empty spaces's Total_Cost from this"
          and sent[1].filename == f"{PREFIX}Seer_of_Empty_Spaces.jpg")
    sent = await say(fake, "$modify blights end|text|Draw.", FakeChannel())
    check("punctuation dropped from the file name", sent[1].filename == f"{PREFIX}Blights_End.jpg")
    sent = await say(fake, "$complex murkstalker", FakeChannel())
    check("$complex: one line", [s.content for s in sent] == ["Set the complexity of murkstalker to Complex"])

    # ── §2 ──
    print("\n[§2 the pictures]")
    fake, _ = make()
    sent = await say(fake, "$modify murkstalker|total cost|2", FakeChannel())
    before, after = image(sent[1]), image(sent[3])
    check("⭐ a cost edit paints the cost orb", changed(before, after, ORB))
    check("…and nothing else", not changed(before, after, STATS) and not changed(before, after, ART))
    first_after = sent[3].data
    sent = await say(fake, "$modify murkstalker|power|5", FakeChannel())
    check("⭐ edits accumulate: the next edit's old picture is the last one's new picture",
          sent[1].data == first_after)
    before, after = image(sent[1]), image(sent[3])
    check("a power edit paints the stat box, and keeps the cost already painted",
          changed(before, after, STATS) and not changed(before, after, ORB))
    sent = await say(fake, "$modify murkstalker|text|Draw a card.", FakeChannel())
    check("a text edit shows a `simulated` banner", changed(image(sent[1]), image(sent[3]), BANNER))
    fresh, _ = make()
    sent = await say(fresh, "$modify murkstalker|power|5", FakeChannel())
    check("each stand-in keeps its own record: a fresh one starts from the scan",
          not changed(image(sent[1]), Image.open(CARDS.art_path("Murkstalker")).convert("RGB"), ORB))

    # ── §3 ──
    print("\n[§3 what it ignores]")
    fake, _ = make()
    for ignored in ["$Modify murkstalker|power|3", "$modify murkstalker|power", "$modify|murkstalker|power|3",
                    "$modify murkstalker|text|a|b", "$modfy murkstalker|power|3", "$get murkstalker|text",
                    "Modified murkstalker's power from this", "hello"]:
        check(f"silent on {ignored!r}", await say(fake, ignored, FakeChannel()) == [])
    check("⭐ never outside the watched channels",
          await say(fake, "$modify murkstalker|power|3", FakeChannel(ELSEWHERE)) == [])

    # ── §4 ──
    print("\n[§4 misbehaviour on request]")
    fake, _ = make()
    ch = FakeChannel()
    await say(fake, "$fakefb silent", ch)
    check("$fakefb is acknowledged", [s.content for s in ch.sent] == ["(fake FriendlyBot) next answer: silent"])
    ch.sent.clear()
    check("silent: no answer at all", await say(fake, "$modify murkstalker|power|3", ch) == [])
    check("…for one answer only", len(await say(fake, "$modify murkstalker|power|3", FakeChannel())) == 4)

    await say(fake, "$fakefb nototis", FakeChannel())
    sent = await say(fake, "$modify murkstalker|power|4", FakeChannel())
    check("nototis: stops after the old picture",
          [s.content for s in sent] == ["Modified murkstalker's power from this", ""] and sent[1].filename)

    await say(fake, "$fakefb swr", FakeChannel())
    sent = await say(fake, "$modify murkstalker|power|4", FakeChannel())
    check("swr: `Something went wrong`", [s.content for s in sent] == ["Something went wrong"])

    await say(fake, "$fakefb wrong", FakeChannel())
    sent = await say(fake, "$modify murkstalker|power|4", FakeChannel())
    check("⭐ wrong: the echo as typed, another card's pictures",
          len(sent) == 4 and sent[0].content == "Modified murkstalker's power from this"
          and sent[1].filename != f"{PREFIX}Murkstalker.jpg" and sent[1].filename == sent[3].filename)
    await say(fake, "$fakefb normal", FakeChannel())
    check("normal, and an unknown mode is ignored",
          fake.mode == "normal" and await say(fake, "$fakefb sideways", FakeChannel()) == [] and fake.mode == "normal")

    # ── §5 ──
    print("\n[§5 the watcher reads it as FriendlyBot]")
    CALEB = "900000000000000001"
    for mode, want in (("normal", ["seen", "reply"]), ("nototis", ["seen", "noAnswer"]),
                       ("swr", ["seen", "error"]), ("silent", ["seen", "noAnswer"]), ("wrong", ["seen", "reply"])):
        fake, _ = make()
        if mode != "normal":
            await say(fake, f"$fakefb {mode}", FakeChannel())
        ch = FakeChannel()
        command = "$modify murkstalker|total cost|2"
        await say(fake, command, ch)
        m = ce.Matcher(BOT, {CHANNEL})
        m.set_pending([{"id": "ce-20261127-murkstalker-7f3a", "card": "Murkstalker", "discord": CALEB,
                        "since": "2026-11-27T00:00:00.000Z",
                        "commands": [{"i": 0, "text": command, "field": "total cost", "posted": False, "done": False}]}])
        t = time.time()
        msgs = [ce.Msg("1", CHANNEL, CALEB, command, t)]
        msgs += [ce.Msg(str(k + 2), CHANNEL, BOT, s.content, t + 0.3 * (k + 1), [s] if s.filename else [])
                 for k, s in enumerate(ch.sent)]
        acts = []
        for msg in msgs:
            acts += m.feed(msg)
        acts += m.tick(t + 200)
        check(f"{mode}: the watcher reports {want} ({[a.kind for a in acts]})", [a.kind for a in acts] == want)
        if mode == "normal":
            check("⭐ …with FriendlyBot's echo and a file name the server accepts for the card",
                  acts[1].body["echo"] == "Modified murkstalker's total cost from this"
                  and ce.attachment_file_key(acts[1].body["fileName"]) == ce.friendlybot_file_key("Murkstalker")
                  and await acts[1].after.read() == ch.sent[3].data)
        if mode == "wrong":
            check("…a file name the server refuses for the card",
                  ce.attachment_file_key(acts[1].body["fileName"]) != ce.friendlybot_file_key("Murkstalker"))


asyncio.run(tests())

print(f"\ntest_fakefriendlybot: {PASS} passed, {FAILED} failed")
if FAILED:
    raise SystemExit(1)
print(f"test_fakefriendlybot: all {PASS} checks passed ✅")
