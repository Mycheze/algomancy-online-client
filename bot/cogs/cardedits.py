"""
cogs/cardedits.py — catches FriendlyBot's answers to the card editor's commands.

The editor (client/docs/card-editor.md) gives a designer FriendlyBot commands to
paste into #card-changes. This cog watches that channel, tells the game server
which of them was posted (`/api/bot/cardedit/seen`), and hands it FriendlyBot's
before and after pictures (`/api/bot/cardedit/reply`). It never posts.

The matching is a plain state machine, `Matcher`, fed message-like objects
(`Msg`), so the tests drive it from the export's real sequences with no Discord.
The cog around it only polls the server, reads channel history and downloads.

FriendlyBot's answers carry no reply reference, so an answer is tied to its
command by order and by its echo (client/docs/friendlybot.md):

    $modify <name>|<field>|<value>             the submitter
    Modified <name>'s <field> from this        FriendlyBot, ~0.3 s, the name and field as typed
    <picture>                                  the card before
    To this                                    ~5 s later
    <picture>                                  the card after

Unset ALGO_CARDEDIT_CHANNELS or ALGO_FRIENDLYBOT_ID (or ALGO_BOT_TOKEN), and
the cog is loaded but inert: it polls nothing and reads no message.
"""

import asyncio
import base64
import difflib
import os
import re
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone

import discord
from discord.ext import commands, tasks

import gameserver

# ── FriendlyBot's grammar: the mirror of client/ui/cardnotation.ts ─────
# That module is the authority; these follow its parseCommand, foldField,
# friendlyBotFileKey and attachmentFileKey rule for rule, and
# test_cardedits.py runs the same quoted commands through both.

MODIFY = "$modify "
_COMPLEXITY = re.compile(r"\$(simple|complex) (.+)", re.S)
ATTACHMENT_PREFIX = "CUsersCalebPycharmProjectscardgamebot_library"


def fold_field(name):
    """A field name as FriendlyBot reads it: case-insensitive, `_` the same as a space."""
    return name.lower().replace("_", " ")


def parse_command(text):
    """A posted message as FriendlyBot reads it, or None for one it ignores.

    {verb, name, field, raw_field, value}: `name` and `raw_field` as typed,
    because FriendlyBot echoes them so; `field` folded. The verb is lower-case
    and followed by one space, and a $modify has exactly three parts: nothing
    escapes a `|`."""
    m = _COMPLEXITY.fullmatch(text)
    if m:
        verb, name = m.group(1), m.group(2)
        if not name.strip():
            return None
        return {"verb": verb, "name": name, "field": "complexity", "raw_field": "complexity",
                "value": "Simple" if verb == "simple" else "Complex"}
    if not text.startswith(MODIFY):
        return None
    parts = text[len(MODIFY):].split("|")
    if len(parts) != 3:
        return None
    name, raw_field, value = parts
    if not name.strip() or raw_field == "":
        return None
    return {"verb": "modify", "name": name, "field": fold_field(raw_field),
            "raw_field": raw_field, "value": value}


def friendlybot_file_key(card):
    """The stem FriendlyBot names a card's picture with (`Blight's End` → `Blights_End`)."""
    return re.sub(r"[^A-Za-z0-9_-]", "", card.replace(" ", "_"))


def attachment_file_key(filename):
    """The stem of a FriendlyBot picture's file name, or None for any other file."""
    if not filename.startswith(ATTACHMENT_PREFIX) or not filename.endswith(".jpg"):
        return None
    return filename[len(ATTACHMENT_PREFIX):-len(".jpg")] or None


def first_line(parsed):
    """FriendlyBot's first line for a command: exact, the name and field as typed."""
    if parsed["verb"] == "modify":
        return f"Modified {parsed['name']}'s {parsed['raw_field']} from this"
    return f"Set the complexity of {parsed['name']} to {parsed['value']}"


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


#: how close a typed name must be to the card's: `seer or empty spaces` is 0.95
LOOSE_NAME = 0.85


def name_matches(typed, card, command_name=None):
    """The typed name is the generated command's, or loosely the card's. FriendlyBot
    matches loosely too; the server's attachment-name check catches a wrong landing."""
    t = _norm(typed)
    if not t:
        return False
    if t in (_norm(card), _norm(command_name or "")):
        return True
    return difflib.SequenceMatcher(None, t, _norm(card)).ratio() >= LOOSE_NAME


def iso(at):
    """Epoch seconds as the server writes times (`toISOString`), so they compare as strings."""
    d = datetime.fromtimestamp(at, timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


# ── the state machine ─────────────────────────────────────────────────

#: no first line this long after the command: FriendlyBot is down (friendlybot.md: 0.3 s)
FIRST_LINE_SECONDS = 60.0
#: no `To this` and picture this long after the command (99th percentile: 7.8 s)
ANSWER_SECONDS = 120.0
#: how far the game server's clock may run ahead of Discord's: an edit's `since` is the
#: server's, a message's time is Discord's, and a command pasted at once must still count
CLOCK_SLACK_SECONDS = 120.0


@dataclass
class Msg:
    """What the matcher reads of a message. `attachments` are anything with a
    `.filename` (discord.Attachment in the cog, a stand-in in the tests)."""
    id: str
    channel: str
    author: str
    content: str
    at: float
    attachments: list = field(default_factory=list)


def view(message):
    """A discord.Message as the matcher reads it."""
    return Msg(str(message.id), str(message.channel.id), str(message.author.id),
               message.content or "", message.created_at.timestamp(), list(message.attachments))


@dataclass
class Action:
    """One request to the game server. `key` makes it idempotent across replays;
    `post` is the command message it answers; a reply's pictures are read from
    `before`/`after` when it is sent."""
    kind: str          # seen | reply | error | noAnswer
    body: dict
    key: tuple
    post: str
    before: object = None
    after: object = None


@dataclass
class _Posted:
    """One of our commands, seen posted, waiting for FriendlyBot's first line."""
    edit: str
    i: int
    echo: str
    msg: str
    at: float
    complexity: bool


@dataclass
class _Answer:
    """One FriendlyBot answer in flight. `posted` is None for an edit nobody
    submitted here: it is followed all the same, so its pictures go to nobody."""
    posted: object
    echo: str
    at: float
    before: object = None
    key: str = None
    to_this: bool = False


class _Channel:
    def __init__(self):
        self.waiting = []        # _Posted, oldest first
        self.answers = []        # _Answer, oldest first
        self.last_command = None  # the newest `$` message: what a `Something went wrong` answers


class Matcher:
    """Feed it every message of the watched channels, in order; it returns the
    requests to make. FriendlyBot answers in order but two answers can
    interleave (one's `To this` after the next one's first line), so each line
    and picture goes to the OLDEST answer waiting for that kind of message."""

    def __init__(self, friendlybot, channels):
        self.friendlybot = str(friendlybot)
        self.channels = {str(c) for c in channels}
        self.pending = []            # the server's /pending edits
        self.fed = set()             # message ids already read
        self._ch = {}

    def set_pending(self, edits):
        self.pending = sorted(edits or [], key=lambda e: str(e.get("since") or ""))

    def _channel(self, cid):
        return self._ch.setdefault(cid, _Channel())

    # ── messages ──
    def feed(self, msg):
        if msg.id in self.fed or msg.channel not in self.channels:
            return []
        self.fed.add(msg.id)
        out = self.tick(msg.at)
        ch = self._channel(msg.channel)
        if msg.content.startswith("$"):
            ch.last_command = msg.id
            out += self._command(ch, msg)
        if msg.author == self.friendlybot:
            out += self._friendlybot(ch, msg)
        return out

    def _command(self, ch, msg):
        parsed = parse_command(msg.content)
        if not parsed:
            return []
        hit = self._match(msg, parsed)
        if not hit:
            return []
        edit, i = hit
        ch.waiting.append(_Posted(edit, i, first_line(parsed), msg.id, msg.at,
                                  parsed["verb"] != "modify"))
        body = {"id": edit, "i": i, "messageId": msg.id, "channelId": msg.channel,
                "content": msg.content, "at": iso(msg.at)}
        return [Action("seen", body, ("seen", edit, i, msg.id), msg.id)]

    def _match(self, msg, parsed):
        """(edit id, command index) of the command this one posts. An answered command
        matches too: a re-post may carry a new value, and the server decides what it changes.
        A message from before the edit existed posts nothing of it."""
        for edit in self.pending:
            if str(edit.get("discord") or "") != msg.author:
                continue
            if edit.get("since") and msg.at < parse_iso(edit["since"]) - CLOCK_SLACK_SECONDS:
                continue
            for c in edit.get("commands") or []:
                if parsed["field"] != fold_field(str(c.get("field") or "")):
                    continue
                ours = parse_command(str(c.get("text") or ""))
                if name_matches(parsed["name"], str(edit.get("card") or ""), ours and ours["name"]):
                    return edit["id"], c.get("i")
        return None

    def _friendlybot(self, ch, msg):
        out = []
        text = msg.content
        if text.startswith("Modified ") and text.endswith(" from this"):
            posted = self._take_waiting(ch, text, complexity=False)
            ch.answers.append(_Answer(posted, text, msg.at))
        elif text.startswith("Set the complexity of "):
            posted = self._take_waiting(ch, text, complexity=True)
            if posted:
                out.append(Action("reply", {"id": posted.edit, "i": posted.i, "echo": text, "at": iso(msg.at)},
                                  ("reply", posted.edit, posted.i, msg.id), posted.msg))
        elif text == "To this":
            a = next((a for a in ch.answers if a.before is not None and not a.to_this), None)
            if a:
                a.to_this = True
        elif text.strip() == "Something went wrong":
            out += self._went_wrong(ch, msg)
        for att in msg.attachments:
            out += self._picture(ch, att, msg)
        return out

    def _take_waiting(self, ch, text, complexity):
        p = next((p for p in ch.waiting if p.complexity == complexity and p.echo == text), None)
        if p:
            ch.waiting.remove(p)
        return p

    def _picture(self, ch, att, msg):
        key = attachment_file_key(getattr(att, "filename", "") or "")
        if key is None:
            return []
        for a in ch.answers:
            if a.before is None:
                a.before, a.key = att, key
                return []
            if a.to_this and a.key == key:
                ch.answers.remove(a)
                p = a.posted
                if p is None:
                    return []
                body = {"id": p.edit, "i": p.i, "echo": a.echo, "fileName": att.filename, "at": iso(msg.at)}
                return [Action("reply", body, ("reply", p.edit, p.i, msg.id), p.msg, before=a.before, after=att)]
        return []

    def _went_wrong(self, ch, msg):
        """FriendlyBot's one error, put on our command when it was the last one posted."""
        for p in ch.waiting:
            if p.msg == ch.last_command:
                ch.waiting.remove(p)
                return [self._failed(p, msg, error=msg.content.strip())]
        for a in ch.answers:
            if a.posted is not None and a.posted.msg == ch.last_command:
                ch.answers.remove(a)
                return [self._failed(a.posted, msg, error=msg.content.strip())]
        return []

    @staticmethod
    def _failed(p, msg, error):
        return Action("error", {"id": p.edit, "i": p.i, "error": error, "at": iso(msg.at)},
                      ("error", p.edit, p.i, msg.id), p.msg)

    # ── time ──
    def tick(self, now):
        """The answers that have run out of time by `now`, as noAnswer reports."""
        out = []
        for ch in self._ch.values():
            for p in [p for p in ch.waiting if now - p.at > FIRST_LINE_SECONDS]:
                ch.waiting.remove(p)
                out.append(self._silent(p, now))
            for a in [a for a in ch.answers if now - (a.posted.at if a.posted else a.at) > ANSWER_SECONDS]:
                ch.answers.remove(a)
                if a.posted:
                    out.append(self._silent(a.posted, now))
        return out

    @staticmethod
    def _silent(p, now):
        return Action("noAnswer", {"id": p.edit, "i": p.i, "noAnswer": True, "at": iso(now)},
                      ("noAnswer", p.edit, p.i, p.msg), p.msg)


# ── configuration ─────────────────────────────────────────────────────

def watched_channels():
    """ALGO_CARDEDIT_CHANNELS: comma-separated channel ids."""
    return {c.strip() for c in os.getenv("ALGO_CARDEDIT_CHANNELS", "").split(",") if c.strip()}


def friendlybot_id():
    return os.getenv("ALGO_FRIENDLYBOT_ID", "").strip()


#: polls while an edit is pending, and while none is
POLL_BUSY = 5.0
POLL_IDLE = 60.0
#: how often the history is re-read while an edit is pending, for a message the gateway dropped
CATCHUP_SECONDS = 300.0
#: never read further back than this, however old the oldest pending edit
CATCHUP_MAX_SECONDS = 7 * 24 * 3600.0


class CardEdits(commands.Cog):
    def __init__(self, bot, *, server=None, channels=None, friendlybot=None):
        self.bot = bot
        self.server = server or gameserver.client
        self.channels = set(channels) if channels is not None else watched_channels()
        self.friendlybot = friendlybot if friendlybot is not None else friendlybot_id()
        self.matcher = Matcher(self.friendlybot, self.channels)
        self.lock = asyncio.Lock()
        self.sent = set()             # Action.key of every request the server has answered
        self.unsent = set()           # (edit, i) with a request that failed: the rest waits for the replay
        self.refused = set()          # command messages the server would not take: their answers go nowhere
        self.known = set()            # the pending edit ids of the last poll
        self.next_catchup = 0.0
        self._last_down = 0.0
        self.skew = 0.0               # this box's clock minus Discord's, read off the last live message

    def discord_now(self):
        """Now on Discord's clock, which every message time and so every timeout is on."""
        return time.time() - self.skew

    @property
    def enabled(self):
        return bool(self.channels and self.friendlybot and self.server.token)

    # ── the loop ──
    @commands.Cog.listener()
    async def on_ready(self):
        if self.enabled and not self.poll_loop.is_running():
            self.poll_loop.start()

    async def cog_unload(self):
        if self.poll_loop.is_running():
            self.poll_loop.cancel()

    @tasks.loop(seconds=POLL_IDLE)
    async def poll_loop(self):
        try:
            busy = await self.poll_once()
        except Exception:
            traceback.print_exc()        # an exception would end a tasks.loop
            return
        want = POLL_BUSY if busy else POLL_IDLE
        if self.poll_loop.seconds != want:
            self.poll_loop.change_interval(seconds=want)

    @poll_loop.before_loop
    async def _ready(self):
        await self.bot.wait_until_ready()

    async def poll_once(self, now=None):
        """Refresh the pending edits, re-read history when one is new or the
        catch-up is due, and report what has timed out. True while any pends."""
        now = self.discord_now() if now is None else now
        try:
            body = await self.server.cardedit_pending()
        except gameserver.GameServerDown as exc:
            if time.monotonic() - self._last_down > 600:
                print(f"[cardedits] pending edits unavailable: {exc}")
                self._last_down = time.monotonic()
            return bool(self.known)
        edits = [e for e in body.get("edits") or [] if isinstance(e, dict) and e.get("id")]
        ids = {e["id"] for e in edits}
        fresh = bool(ids - self.known)
        self.known = ids
        async with self.lock:
            self.matcher.set_pending(edits)
            if edits and (fresh or now >= self.next_catchup):
                await self._catch_up(edits, now)
            await self._run(self.matcher.tick(now))
        return bool(edits)

    async def _catch_up(self, edits, now):
        """Replay every watched channel since the oldest pending edit through a
        fresh matcher, which then replaces the live one. A restart, or a command
        posted before the poll knew its edit, loses nothing; `sent` keeps the
        replay from repeating a request the server already has."""
        since = min([parse_iso(e["since"]) for e in edits if e.get("since")] or [now]) - CLOCK_SLACK_SECONDS
        since = max(since, now - CATCHUP_MAX_SECONDS)
        msgs = []
        for cid in sorted(self.channels):
            msgs += await self._history(cid, since)
        fresh = Matcher(self.friendlybot, self.channels)
        fresh.set_pending(edits)
        self.unsent.clear()
        actions = []
        for m in sorted(msgs, key=lambda m: (m.at, int(m.id))):
            actions += fresh.feed(m)
        self.matcher = fresh
        self.next_catchup = now + CATCHUP_SECONDS
        await self._run(actions)

    async def _history(self, cid, since):
        channel = self.bot.get_channel(int(cid))
        try:
            if channel is None:
                channel = await self.bot.fetch_channel(int(cid))
            after = datetime.fromtimestamp(since, timezone.utc)
            return [view(m) async for m in channel.history(after=after, oldest_first=True, limit=None)]
        except (discord.HTTPException, AttributeError) as exc:
            print(f"[cardedits] can't read channel {cid}: {exc}")
            return []

    # ── live messages ──
    @commands.Cog.listener()
    async def on_message(self, message):
        if not self.enabled or str(message.channel.id) not in self.channels:
            return
        self.skew = time.time() - message.created_at.timestamp()
        async with self.lock:
            await self._run(self.matcher.feed(view(message)))

    # ── the requests ──
    async def _run(self, actions):
        for a in actions:
            cmd = (a.body.get("id"), a.body.get("i"))
            if a.key in self.sent or cmd in self.unsent or a.post in self.refused:
                continue             # an answer is never sent ahead of its unsent command, nor after a refused one
            try:
                if a.kind == "seen":
                    res = await self.server.cardedit_seen(a.body)
                else:
                    body = dict(a.body)
                    if a.before is not None:
                        # read at once: Discord's attachment links expire within a day
                        body["before"] = base64.b64encode(await a.before.read()).decode("ascii")
                        body["after"] = base64.b64encode(await a.after.read()).decode("ascii")
                    res = await self.server.cardedit_reply(body)
            except gameserver.GameServerDown as exc:
                print(f"[cardedits] {a.kind} for {a.body.get('id')} #{a.body.get('i')} not sent: {exc}")
                self.unsent.add(cmd)     # the next catch-up replays it
                continue
            except discord.HTTPException as exc:
                print(f"[cardedits] couldn't download FriendlyBot's pictures: {exc}")
                self.unsent.add(cmd)
                continue
            self.sent.add(a.key)
            if res.get("ok") is False:
                # a refusal is the server's answer (a post after pickup, another card's picture): never resent
                print(f"[cardedits] {a.kind} for {a.body.get('id')} #{a.body.get('i')} "
                      f"refused: {res.get('error')}")
                if a.kind == "seen":
                    self.refused.add(a.post)
