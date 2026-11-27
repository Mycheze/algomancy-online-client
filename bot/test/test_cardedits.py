#!/usr/bin/env python3
"""
test_cardedits.py — the card editor's watcher (cogs/cardedits.py) against real
FriendlyBot sequences from #card-changes (fixtures/friendlybot/*.json).
Run: `.venv/bin/python bot/test/test_cardedits.py`. No Discord, no game server.

§1 the parse mirror: client/ui/cardnotation.ts's rules, on 1506's quoted commands
§2 a clean edit: the command is seen, the four messages collected, the right bodies
§3 a re-post: the last complete answer is the one that stands, answered or not
§3c complexity: one line, no picture
§4 a loose name, a malformed command, two answers interleaved
§5 FriendlyBot silent, cut off, or `Something went wrong`
§6 what is ignored: another author, another channel, an edit nobody submitted
§7 the cog: pictures downloaded and sent, a restart caught up from history, inert unconfigured
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from cogs import cardedits as ce  # noqa: E402
from cogs.cardedits import Matcher, Msg, parse_command  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


FIXTURES = _Path(__file__).resolve().parent / "fixtures" / "friendlybot"
CALEB, FB, OTHER = "900000000000000001", "900000000000000002", "900000000000000003"
CHANNEL, ELSEWHERE = "700000000000000001", "700000000000000002"
AUTHORS = {"calebgannon": CALEB, "FriendlyBot": FB}


class Att:
    """An attachment: its name, and bytes that say which message it came from."""

    def __init__(self, filename, msg_id):
        self.filename = filename
        self.data = b"\xff\xd8\xff" + f"{msg_id}:{filename}".encode()

    async def read(self):
        return self.data


def load(name, *, channel=CHANNEL, authors=None):
    doc = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    who = {**AUTHORS, **(authors or {})}
    return [Msg(m["id"], channel, who[m["author"]], m["content"], ce.parse_iso(m["at"]),
                [Att(a, m["id"]) for a in m["attachments"]]) for m in doc["messages"]]


def edit(eid, card, *commands, discord=CALEB, since="2020-01-01T00:00:00.000Z", done=False):
    return {"id": eid, "card": card, "discord": discord, "since": since,
            "commands": [{"i": i, "text": t, "field": f, "posted": done, "done": done}
                         for i, (t, f) in enumerate(commands)]}


def run(msgs, *edits, until=None, matcher=None):
    m = matcher or Matcher(FB, {CHANNEL})
    m.set_pending(list(edits))
    out = []
    for msg in msgs:
        out += m.feed(msg)
    if until is not None:
        out += m.tick(until)
    return out


def kinds(actions):
    return [a.kind for a in actions]


def by_id(msgs, mid):
    return next(m for m in msgs if m.id == mid)


# ── §1 the parse mirror ───────────────────────────────────────────────
print("\n[§1 the parse mirror]")
# client/ui/test/1506-card-edit-commands.test.ts §2, word for word
CASES = [
    ('$modify murkstalker|text|When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.',
     'murkstalker', 'text', 'When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.'),
    ('$modify murkstalker|total cost|2', 'murkstalker', 'total cost', '2'),
    ('$modify seer or empty spaces|total cost|2', 'seer or empty spaces', 'total cost', '2'),
    ('$modify shard sprite|cost|w', 'shard sprite', 'cost', 'w'),
    ('$modify arbitor of armistice|toughness|2', 'arbitor of armistice', 'toughness', '2'),
    ('$modify triskaidekophage|power|13', 'triskaidekophage', 'power', '13'),
    ('$modify rider of the tides|image|images_out/Stable/rtdd.png', 'rider of the tides', 'image', 'images_out/Stable/rtdd.png'),
    ('$modify maw of despair|type|Creature — Bedlam Alien', 'maw of despair', 'type', 'Creature — Bedlam Alien'),
    ('$modify frosted denial|Text|Draw.', 'frosted denial', 'text', 'Draw.'),
    ('$modify cthyrian rector|Type|Creature — Blight Zombie {Virus}', 'cthyrian rector', 'type', 'Creature — Blight Zombie {Virus}'),
    ('$modify x|total_cost|3', 'x', 'total cost', '3'),
    ('$modify x|Total Cost|3', 'x', 'total cost', '3'),
    ('$modify  spawn|image|images_out/Stable/wisp.png', ' spawn', 'image', 'images_out/Stable/wisp.png'),
    ('$modify bripp |text|Erase that card.', 'bripp ', 'text', 'Erase that card.'),
]
for text, name, fld, value in CASES:
    p = parse_command(text)
    check(f"parses like cardnotation.ts: {text[:50]}",
          p is not None and (p["verb"], p["name"], p["field"], p["value"]) == ("modify", name, fld, value))
check("the field as typed is kept for the echo", parse_command('$modify x|Total_Cost|3')["raw_field"] == "Total_Cost")
p = parse_command('$complex murkstalker')
check("$complex", (p["verb"], p["name"], p["field"], p["value"]) == ("complex", "murkstalker", "complexity", "Complex"))
p = parse_command('$simple debt blep')
check("$simple", (p["verb"], p["name"], p["value"]) == ("simple", "debt blep", "Simple"))
# 1506 §3: what FriendlyBot ignored
for ignored in [
    '$modify|the everywhere|text|[Augment] As I spawn, name a card.',
    '$Modify battle|image|images_out/Stable/battle2.png',
    '$modifyburgeon|images|images_out/Stable/burg.png',
    '$modfy murkstalker|power|3',
    '$modify burgeon|Text|[Switch1] Double the /[might | mass] of target unit until regroup.',
    '$modify servant of the flame|image|images_out|Stable|fireguy.png',
    '$modify bloodletting beast|text',
    '$modify endbringer',
    '$replace afflicting anima|text|Wight|Wraith',
    '$get murkstalker|text',
    'please $modify murkstalker|power|3',
    '$modify |power|3',
    '$complex ',
]:
    check(f"ignored as FriendlyBot ignores it: {ignored[:50]}", parse_command(ignored) is None)
# 1506 §6
for card, key in [("Murkstalker", "Murkstalker"), ("Blight's End", "Blights_End"),
                  ("A Fast Pile of Rocks", "A_Fast_Pile_of_Rocks"), ("Seer of Empty Spaces", "Seer_of_Empty_Spaces"),
                  ("Hooba-Nan", "Hooba-Nan"), ("All-Consuming Blaze", "All-Consuming_Blaze")]:
    check(f"file key {card}", ce.friendlybot_file_key(card) == key
          and ce.attachment_file_key(f"CUsersCalebPycharmProjectscardgamebot_library{key}.jpg") == key)
check("another bot's picture is not FriendlyBot's", ce.attachment_file_key("temp.jpg") is None
      and ce.attachment_file_key("DAzothBot_LibraryGet_Cards.jpg") is None)

# ⭐ the echo, built from the command, against every answer in the record
echoes = 0
for f in sorted(FIXTURES.glob("*.json")):
    msgs = json.loads(f.read_text(encoding="utf-8"))["messages"]
    for k, m in enumerate(msgs):
        nxt = next((n for n in msgs[k + 1:] if n["author"] == "FriendlyBot"), None)
        if m["author"] == "calebgannon" and parse_command(m["content"]) and nxt \
                and nxt["content"].startswith("Modified "):
            echoes += 1
            check(f"⭐ {f.stem}: the first line is built from the command as typed",
                  ce.first_line(parse_command(m["content"])) == nxt["content"])
check(f"the record has answers to check the echo against ({echoes})", echoes >= 20)
# from the record: FriendlyBot echoes the field as typed, not as it folds it
for typed, said in [("$modify cosmic conspirator|total_cost|5", "Modified cosmic conspirator's total_cost from this"),
                    ("$modify Biotoxicity|Text|[Switch1] Create three Poison 1.", "Modified Biotoxicity's Text from this")]:
    check(f"⭐ the echo keeps the field as typed: {said}", ce.first_line(parse_command(typed)) == said)
check("the loose name: seer or empty spaces is Seer of Empty Spaces",
      ce.name_matches("seer or empty spaces", "Seer of Empty Spaces")
      and ce.name_matches("the Almighty doot", "The Mighty Doot"))
check("…and not another card", not ce.name_matches("murkstalker", "Seer of Empty Spaces")
      and not ce.name_matches("blights end", "Blightwalker"))
check("times are written as the server writes them",
      ce.iso(ce.parse_iso("2026-10-23T15:48:24.053Z")) == "2026-10-23T15:48:24.053Z")


# ── §2 a clean edit ───────────────────────────────────────────────────
print("\n[§2 a clean edit: Murkstalker, 2026-10-23]")
msgs = load("murkstalker-clean")
murk = edit("ce-20261023-murkstalker-7f3a", "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"))
acts = run(msgs, murk, until=msgs[-1].at + 600)
check(f"one seen and one reply, nothing else ({kinds(acts)})", kinds(acts) == ["seen", "reply"])
seen, reply = acts
cmd = by_id(msgs, "1563217537230053426")
check("seen: the command as posted, its message and channel, when",
      seen.body == {"id": murk["id"], "i": 0, "messageId": cmd.id, "channelId": CHANNEL,
                    "content": "$modify murkstalker|total cost|2", "at": "2026-10-23T15:48:24.053Z"})
check("⭐ reply: FriendlyBot's echo and file name, at the new picture's time",
      reply.body == {"id": murk["id"], "i": 0, "echo": "Modified murkstalker's total cost from this",
                     "fileName": "CUsersCalebPycharmProjectscardgamebot_libraryMurkstalker.jpg",
                     "at": "2026-10-23T15:48:29.505Z"})
check("⭐ the before picture is the one after the first line, the after one after `To this`",
      reply.before is by_id(msgs, "1563217539180265503").attachments[0]
      and reply.after is by_id(msgs, "1563217560097529868").attachments[0])
check("the text edit before it, which nobody submitted here, sent nothing",
      all(a.body.get("messageId") != "1563217495685333124" for a in acts))


# ── §3 a re-post ──────────────────────────────────────────────────────
print("\n[§3 The Everywhere, posted four times]")
msgs = load("everywhere-reposted")
posts = [m for m in msgs if m.author == CALEB and "everywhere" in m.content]
check("the fixture holds the four posts", len(posts) == 4)
every = edit("ce-20261023-the-everywhere-0b1c", "The Everywhere", (posts[0].content, "text"))
acts = run(msgs, every, until=msgs[-1].at + 600)
check(f"each post seen and each answer caught, in order ({kinds(acts)})",
      kinds(acts) == ["seen", "reply"] * 4)
check("each seen carries its own post, as posted",
      [a.body["content"] for a in acts if a.kind == "seen"] == [p.content for p in posts])
check("⭐ the last reply is the last answer's new picture: the server keeps the newest",
      acts[-1].after is msgs[-1].attachments[0] and acts[-1].body["at"] == ce.iso(msgs[-1].at))
check("the Seer edit between them went to nobody",
      all("Seer" not in a.body.get("fileName", "") for a in acts))
# the server lists an answered command as done until the home box picks it up
answered = edit(every["id"], "The Everywhere", (posts[0].content, "text"), done=True)
acts = run(msgs, answered, until=msgs[-1].at + 600)
check(f"⭐ a command already answered still matches a re-post, which is seen and collected ({kinds(acts)})",
      kinds(acts) == ["seen", "reply"] * 4
      and [a.body["content"] for a in acts if a.kind == "seen"] == [p.content for p in posts])

print("\n[§3c complexity]")
msgs = load("complexity")
eel = edit("ce-20240303-nimbus-eel-ee1e", "Nimbus Eel", ("$complex nimbus eel", "complexity"))
acts = run(msgs, eel, until=msgs[-1].at + 600)
check(f"$complex: seen, then the one line as its answer ({kinds(acts)})", kinds(acts) == ["seen", "reply"])
check("⭐ the answer is the line alone: no file name, no pictures",
      acts[1].body == {"id": eel["id"], "i": 0, "echo": "Set the complexity of nimbus eel to Complex",
                       "at": ce.iso(by_id(msgs, "1213637085110739114").at)} and acts[1].before is None)
cap = edit("ce-20240303-noxious-deathcap-dcap", "Noxious Deathcap", ("$complex noxious deathcap", "complexity"))
acts = run(msgs, cap)
check("a $simple posted for a $complex command is seen as posted; the server decides",
      kinds(acts) == ["seen", "reply"] and acts[0].body["content"] == "$simple noxious deathcap"
      and acts[1].body["echo"] == "Set the complexity of noxious deathcap to Simple")
check("other cards' complexity lines go to nobody", all(a.body["id"] == cap["id"] for a in acts))
m = Matcher(FB, {CHANNEL})
acts = run(msgs[4:5], eel, matcher=m)
check("no line within a minute: no answer", kinds(acts) == ["seen"] and kinds(m.tick(msgs[4].at + 61)) == ["noAnswer"])

print("\n[§3b re-posted before the answer came back]")
msgs = load("blights-end-repost")
blight = edit("ce-20251129-blights-end-1a2b", "Blight's End",
              ("$modify blights end|text|Distribute X -1/-1 counters among units.", "text"))
acts = run(msgs, blight, until=msgs[-1].at + 600)
check(f"both posts seen, one complete answer, the cut-off one timed out ({kinds(acts)})",
      kinds(acts) == ["seen", "seen", "reply", "noAnswer"])
check("the reply's before is FriendlyBot's card before the first post",
      acts[2].before is by_id(msgs, "1444385637934563500").attachments[0]
      and acts[2].after is by_id(msgs, "1444385946463371274").attachments[0])
check("the total-cost edit after it, which nobody submitted here, took no picture",
      all(a.body.get("fileName", "").endswith("Blights_End.jpg") for a in acts if a.kind == "reply"))


# ── §4 a loose name, a malformed command, interleaving ────────────────
print("\n[§4 a loose name]")
msgs = load("seer-loose-name")
seer = edit("ce-20261023-seer-of-empty-spaces-9e9e", "Seer of Empty Spaces",
            ("$modify seer of empty spaces|total cost|2", "total cost"))
acts = run(msgs, seer)
check(f"`seer or empty spaces` matches Seer of Empty Spaces ({kinds(acts)})", kinds(acts) == ["seen", "reply"])
check("the echo keeps the name as typed; the file name is the real card",
      acts[1].body["echo"] == "Modified seer or empty spaces's total cost from this"
      and acts[1].body["fileName"].endswith("Seer_of_Empty_Spaces.jpg"))
other = edit("ce-20261023-murkstalker-0000", "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"))
check("…and does not match another card's edit", run(msgs, other) == [])

print("\n[§4b a malformed command]")
msgs = load("malformed-no-reply")
every = edit("ce-20261023-the-everywhere-0b1c", "The Everywhere", (msgs[1].content, "text"))
acts = run(msgs[:1], every)
check("`$modify|the everywhere|…` is not a command: nothing is seen", acts == [])
acts = run(msgs, every)
check(f"the retyped one two minutes later is ({kinds(acts)})",
      kinds(acts) == ["seen", "reply"] and acts[0].body["messageId"] == msgs[1].id)

print("\n[§4c two answers interleaved]")
msgs = load("interleaved")
pt = edit("ce-20251127-murkstalker-5c5c", "Murkstalker",
          ("$modify murkstalker|power|8", "power"), ("$modify murkstalker|toughness|8", "toughness"))
acts = run(msgs, pt, until=msgs[-1].at + 600)
replies = {a.body["i"]: a for a in acts if a.kind == "reply"}
check(f"both commands seen and answered ({kinds(acts)})",
      kinds(acts) == ["seen", "seen", "reply", "reply"] and set(replies) == {0, 1})
check("⭐ power's `To this` came after toughness's first line, and still goes to power",
      replies[0].before is by_id(msgs, "1443700906007855210").attachments[0]
      and replies[0].after is by_id(msgs, "1443700927264460941").attachments[0])
check("⭐ toughness gets the pictures after that",
      replies[1].before is by_id(msgs, "1443700927931355198").attachments[0]
      and replies[1].after is by_id(msgs, "1443700948537970812").attachments[0]
      and replies[1].body["echo"] == "Modified murkstalker's toughness from this")


# ── §5 silence, cut off, an error ─────────────────────────────────────
print("\n[§5 FriendlyBot silent, then cut off five times]")
msgs = load("no-to-this")
doot = edit("ce-20250521-the-mighty-doot-d00d", "The Mighty Doot", ("$modify the mighty doot|text|x", "text"))
acts = run(msgs, doot, until=msgs[-1].at + ce.ANSWER_SECONDS + 1)
check(f"six posts, six seen, six timed out, no reply ({kinds(acts)})",
      kinds(acts).count("seen") == 6 and kinds(acts).count("noAnswer") == 6 and "reply" not in kinds(acts))
check("the first post got no first line: it times out when the next message comes, 15 minutes on",
      kinds(acts)[:3] == ["seen", "noAnswer", "seen"] and acts[1].key[3] == msgs[0].id)
check("the body says so", acts[1].body == {"id": doot["id"], "i": 0, "noAnswer": True,
                                           "at": ce.iso(msgs[1].at)})
m = Matcher(FB, {CHANNEL})
acts = run(msgs[:4], doot, matcher=m)
check("an answer cut off after its old picture is not yet late at 119 s",
      kinds(m.tick(msgs[1].at + ce.ANSWER_SECONDS - 1)) == [])
check("…and is at 121 s", kinds(m.tick(msgs[1].at + ce.ANSWER_SECONDS + 1)) == ["noAnswer"])
m = Matcher(FB, {CHANNEL})
run(msgs[1:2], doot, matcher=m)
check("no first line: not late at 59 s, late at 61 s",
      m.tick(msgs[1].at + 59) == [] and kinds(m.tick(msgs[1].at + 61)) == ["noAnswer"])

print("\n[§5b Something went wrong]")
msgs = load("something-went-wrong")
seis = edit("ce-20220921-seismomancy-5e15", "Seismomancy", ("$modify seismomancy|details|{}", "details"))
acts = run(msgs, seis, until=msgs[-1].at + 600)
check(f"two errors, word for word, then the cut-off third times out ({kinds(acts)})",
      kinds(acts) == ["seen", "error", "seen", "error", "seen", "noAnswer"])
check("the error body", acts[1].body == {"id": seis["id"], "i": 0, "error": "Something went wrong",
                                         "at": ce.iso(by_id(msgs, "1022181490328617170").at)})
# an error answering a command that is not ours goes to nobody
murk = edit("ce-20261023-murkstalker-7f3a", "Murkstalker", ("$modify murkstalker|power|3", "power"))
t0 = 1_800_000_000.0
acts = run([Msg("1", CHANNEL, CALEB, "$modify murkstalker|power|3", t0),
            Msg("2", CHANNEL, CALEB, "$rename xzythraal|Bring Decay", t0 + 1),
            Msg("3", CHANNEL, FB, "Something went wrong", t0 + 2)], murk)
check(f"…one after a `$rename` is the rename's, not our command's ({kinds(acts)})", kinds(acts) == ["seen"])


# ── §6 what is ignored ────────────────────────────────────────────────
print("\n[§6 what is ignored]")
murk = edit("ce-20261023-murkstalker-7f3a", "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"))
check("another author posting the same command", run(load("murkstalker-clean", authors={"calebgannon": OTHER}), murk) == [])
check("an unwatched channel", run(load("murkstalker-clean", channel=ELSEWHERE), murk) == [])
check("an edit nobody submitted (no linked Discord)",
      run(load("murkstalker-clean"), edit(murk["id"], "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"),
                                          discord=None)) == [])
check("no pending edit at all", run(load("murkstalker-clean")) == [])
acts = run(load("murkstalker-clean", authors={"FriendlyBot": OTHER}), murk, until=2e9)
check(f"⭐ FriendlyBot's lines from anyone else are not its answer ({kinds(acts)})", kinds(acts) == ["seen", "noAnswer"])
check("a field the edit does not change",
      run(load("murkstalker-clean"), edit(murk["id"], "Murkstalker", ("$modify murkstalker|power|2", "power"))) == [])
m = Matcher(FB, {CHANNEL})
msgs = load("murkstalker-clean")
once = run(msgs, murk, matcher=m)
check("a message read twice is read once", len(once) == 2 and run(msgs, murk, matcher=m) == [])


# ── §7 the cog ────────────────────────────────────────────────────────
print("\n[§7 the cog]")


class FakeServer:
    token = "t0ken"

    def __init__(self, pending=()):
        self.pending = list(pending)
        self.calls = []

    async def cardedit_pending(self):
        return {"ok": True, "edits": self.pending}

    async def cardedit_seen(self, body):
        self.calls.append(("seen", body))
        return {"ok": True, "road": "fast", "status": "waiting"}

    async def cardedit_reply(self, body):
        self.calls.append(("reply", body))
        return {"ok": True, "road": "fast", "status": "applying"}


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def discord_message(m):
    return Obj(id=int(m.id), channel=Obj(id=int(m.channel)), author=Obj(id=int(m.author)), content=m.content,
               created_at=datetime.fromtimestamp(m.at, timezone.utc), attachments=m.attachments)


class FakeChannel:
    def __init__(self, msgs):
        self.msgs = msgs
        self.asked = []

    def history(self, *, after, oldest_first, limit):
        self.asked.append((after, oldest_first, limit))
        msgs = [discord_message(m) for m in self.msgs if m.at > after.timestamp()]

        async def gen():
            for m in msgs:
                yield m
        return gen()


class FakeBot:
    def __init__(self, channels):
        self.channels = channels

    def get_channel(self, cid):
        return self.channels.get(str(cid))


def cog_for(server, channels=None):
    return ce.CardEdits(FakeBot(channels or {}), server=server, channels={CHANNEL}, friendlybot=FB)


async def cog_tests():
    msgs = load("murkstalker-clean")
    murk = edit("ce-20261023-murkstalker-7f3a", "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"),
                since="2026-10-23T15:40:00.000Z")
    end = msgs[-1].at

    # live: the poll knows the edit, then the messages arrive
    server = FakeServer([murk])
    cog = cog_for(server, {CHANNEL: FakeChannel([])})
    check("pending edits: busy", await cog.poll_once(now=msgs[0].at - 60) is True)
    for m in msgs:
        await cog.on_message(discord_message(m))
    check(f"live: seen then reply sent ({[c[0] for c in server.calls]})", [c[0] for c in server.calls] == ["seen", "reply"])
    body = server.calls[1][1]
    check("⭐ both pictures downloaded and sent, base64, the right one each way",
          base64.b64decode(body["before"]) == by_id(msgs, "1563217539180265503").attachments[0].data
          and base64.b64decode(body["after"]) == by_id(msgs, "1563217560097529868").attachments[0].data)
    server.pending = []
    check("nothing pending: idle", await cog.poll_once(now=end + 10) is False)

    # ⭐ a restart: everything happened while the bot was down
    server = FakeServer([murk])
    chan = FakeChannel(msgs)
    cog = cog_for(server, {CHANNEL: chan})
    await cog.poll_once(now=end + 30)
    check(f"⭐ after a restart the history is read and nothing is lost ({[c[0] for c in server.calls]})",
          [c[0] for c in server.calls] == ["seen", "reply"])
    check("read from the oldest pending edit, less the clock slack, oldest first",
          chan.asked and chan.asked[0][0].timestamp()
          == datetime(2026, 10, 23, 15, 40, tzinfo=timezone.utc).timestamp() - ce.CLOCK_SLACK_SECONDS
          and chan.asked[0][1])
    cog.next_catchup = 0
    await cog.poll_once(now=end + 40)
    check("a second catch-up sends nothing twice", len(server.calls) == 2 and len(chan.asked) == 2)

    # ⭐ the game server's clock 49 s ahead of Discord's (the test laptop's, measured live):
    # the command pasted at once carries a Discord time before the edit's `since`
    cmd_at = by_id(msgs, "1563217537230053426").at
    skewed = {**murk, "since": ce.iso(cmd_at + 49)}
    server = FakeServer([skewed])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=end + 49 + 5)
    check(f"⭐ a server clock ahead of Discord's loses nothing ({[c[0] for c in server.calls]})",
          [c[0] for c in server.calls] == ["seen", "reply"])
    # …but a command posted well before the edit existed is not its command, though an
    # older pending edit has the history read from before it
    stale = {**murk, "since": ce.iso(cmd_at + ce.CLOCK_SLACK_SECONDS + 60)}
    older = edit("ce-20200101-nimbus-eel-ee1e", "Nimbus Eel", ("$complex nimbus eel", "complexity"))
    server = FakeServer([older, stale])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=end + ce.CLOCK_SLACK_SECONDS + 70)
    check(f"a command from before the edit existed is not matched to it ({server.calls})", server.calls == [])

    # a restart in the middle of the answer: the rest arrives live
    server = FakeServer([murk])
    cut = [m for m in msgs if m.at <= by_id(msgs, "1563217539180265503").at]
    cog = cog_for(server, {CHANNEL: FakeChannel(cut)})
    await cog.poll_once(now=cut[-1].at + 1)
    check("mid-answer restart: the command is seen from history", [c[0] for c in server.calls] == ["seen"])
    for m in msgs:
        await cog.on_message(discord_message(m))
    check("…and the rest of the answer, arriving live, completes it",
          [c[0] for c in server.calls] == ["seen", "reply"]
          and base64.b64decode(server.calls[1][1]["before"]) == by_id(msgs, "1563217539180265503").attachments[0].data)

    # posted before the poll knew the edit
    server = FakeServer([])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=msgs[0].at - 60)
    for m in msgs:
        await cog.on_message(discord_message(m))
    check("a command posted before the poll knew its edit is not matched live", server.calls == [])
    server.pending = [murk]
    await cog.poll_once(now=end + 5)
    check("⭐ …and is caught from history as soon as the edit appears",
          [c[0] for c in server.calls] == ["seen", "reply"])

    # ⭐ this box's clock 90 s ahead of Discord's: the timeouts run on Discord's clock, so a
    # command FriendlyBot is still answering is not reported silent the moment it is seen
    import time as _time
    cmd = by_id(msgs, "1563217537230053426")
    fresh = Msg(cmd.id, cmd.channel, cmd.author, cmd.content, _time.time() - 90)
    server = FakeServer([{**murk, "since": ce.iso(fresh.at - 1)}])
    cog = cog_for(server, {CHANNEL: FakeChannel([])})
    cog.next_catchup = float("inf")
    await cog.poll_once(now=fresh.at - 5)
    await cog.on_message(discord_message(fresh))
    await cog.poll_once()
    check(f"⭐ a clock ahead of Discord's does not time out a fresh command ({[c[0] for c in server.calls]})",
          [c[0] for c in server.calls] == ["seen"])

    # FriendlyBot down
    server = FakeServer([murk])
    cog = cog_for(server, {CHANNEL: FakeChannel([])})
    await cog.poll_once(now=msgs[0].at - 60)
    await cog.on_message(discord_message(by_id(msgs, "1563217537230053426")))
    await cog.poll_once(now=by_id(msgs, "1563217537230053426").at + 61)
    check(f"⭐ a silent FriendlyBot is reported by the poll ({server.calls[-1]})",
          [c[0] for c in server.calls] == ["seen", "reply"] and server.calls[-1][1].get("noAnswer") is True)

    # a refused reply is not resent
    class Refusing(FakeServer):
        async def cardedit_reply(self, body):
            self.calls.append(("reply", body))
            return {"ok": False, "error": "FriendlyBot changed a different card: Blights End"}
    server = Refusing([murk])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=end + 5)
    cog.next_catchup = 0
    await cog.poll_once(now=end + 6)
    check("a refused reply is sent once", [c[0] for c in server.calls] == ["seen", "reply"])

    # ⭐ posted after the home box picked the edit up: the server refuses the seen
    class Late(FakeServer):
        async def cardedit_seen(self, body):
            self.calls.append(("seen", body))
            return {"ok": False, "error": "posted after the change was picked up: make a new edit"}
    server = Late([edit(murk["id"], "Murkstalker", ("$modify murkstalker|total cost|2", "total cost"), done=True)])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=end + 5)
    cog.next_catchup = 0
    await cog.poll_once(now=end + 6)
    check(f"⭐ a refused seen is sent once, and its answer is not sent at all ({[c[0] for c in server.calls]})",
          [c[0] for c in server.calls] == ["seen"])
    # the live re-post of an answered command: seen and collected again
    every = edit("ce-20261023-the-everywhere-0b1c", "The Everywhere",
                 ("$modify the everywhere|text|x", "text"), done=True)
    server = FakeServer([every])
    cog = cog_for(server, {CHANNEL: FakeChannel([])})
    emsgs = load("everywhere-reposted")
    await cog.poll_once(now=emsgs[0].at - 60)
    for m in emsgs:
        await cog.on_message(discord_message(m))
    check("live, every re-post of the answered command is sent with its answer",
          [c[0] for c in server.calls] == ["seen", "reply"] * 4)
    # complexity: the reply carries no pictures
    cmsgs = load("complexity")
    eel = edit("ce-20240303-nimbus-eel-ee1e", "Nimbus Eel", ("$complex nimbus eel", "complexity"))
    server = FakeServer([eel])
    cog = cog_for(server, {CHANNEL: FakeChannel(cmsgs)})
    await cog.poll_once(now=cmsgs[-1].at + 5)
    check("a complexity answer is sent as {id, i, echo, at}",
          [c[0] for c in server.calls] == ["seen", "reply"] and set(server.calls[1][1]) == {"id", "i", "echo", "at"})

    # the game server down: nothing is lost, the next catch-up sends it
    class Down(FakeServer):
        async def cardedit_seen(self, body):
            raise ce.gameserver.GameServerDown("refused")
    server = Down([murk])
    cog = cog_for(server, {CHANNEL: FakeChannel(msgs)})
    await cog.poll_once(now=end + 5)
    server.__class__ = FakeServer
    cog.next_catchup = 0
    check("an answer is not sent ahead of its unsent command", server.calls == [])
    await cog.poll_once(now=end + 6)
    check("both are sent by the next catch-up, in order", [c[0] for c in server.calls] == ["seen", "reply"])

    # unconfigured: inert
    server = FakeServer([murk])
    for channels, fbid in (((), FB), ({CHANNEL}, "")):
        cog = ce.CardEdits(FakeBot({}), server=server, channels=channels, friendlybot=fbid)
        await cog.on_message(discord_message(msgs[-6]))
        check("unconfigured: not enabled, reads nothing", not cog.enabled and server.calls == [])
    tokenless = FakeServer([murk])
    tokenless.token = ""
    check("no ALGO_BOT_TOKEN: not enabled", not ce.CardEdits(FakeBot({}), server=tokenless, channels={CHANNEL},
                                                             friendlybot=FB).enabled)
    for var in ("ALGO_CARDEDIT_CHANNELS", "ALGO_FRIENDLYBOT_ID"):
        os.environ.pop(var, None)
    check("the env unset reads as no channels and no FriendlyBot",
          ce.watched_channels() == set() and ce.friendlybot_id() == "")
    os.environ["ALGO_CARDEDIT_CHANNELS"] = f" {CHANNEL}, {ELSEWHERE} ,"
    check("ALGO_CARDEDIT_CHANNELS is a comma list", ce.watched_channels() == {CHANNEL, ELSEWHERE})
    os.environ.pop("ALGO_CARDEDIT_CHANNELS")


asyncio.run(cog_tests())


async def bot_tests():
    import bot as botmod
    os.environ.pop("ALGO_FAKE_FRIENDLYBOT", None)
    b = await botmod.build_bot()
    check("the bot loads the watcher", b.get_cog("CardEdits") is not None)
    check("…and not the fake FriendlyBot unless asked", b.get_cog("FakeFriendlyBot") is None)
    os.environ["ALGO_FAKE_FRIENDLYBOT"] = "1"
    b2 = await botmod.build_bot()
    check("ALGO_FAKE_FRIENDLYBOT=1 loads the fake", b2.get_cog("FakeFriendlyBot") is not None)
    os.environ.pop("ALGO_FAKE_FRIENDLYBOT")
    await b.close()
    await b2.close()

asyncio.run(bot_tests())

print(f"\ntest_cardedits: {PASS} passed, {FAILED} failed")
if FAILED:
    raise SystemExit(1)
print(f"test_cardedits: all {PASS} checks passed ✅")
