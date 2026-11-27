"""
cogs/fakefriendlybot.py — a stand-in for FriendlyBot, for the test Discord server.

Loaded only when ALGO_FAKE_FRIENDLYBOT=1, never on the deploy. In the watched
channels (ALGO_CARDEDIT_CHANNELS) it answers `$modify <name>|<field>|<value>`
in FriendlyBot's exact shape and timing (client/docs/friendlybot.md):

    Modified <name as typed>'s <field as typed> from this     ~0.3 s
    CUsersCalebPycharmProjectscardgamebot_library<Key>.jpg     the card before
    To this                                                    ~5 s
    CUsersCalebPycharmProjectscardgamebot_library<Key>.jpg     the card after

The pictures are the card's scan with every value it has been given so far
painted over the region that prints it, so consecutive edits accumulate as
FriendlyBot's do. It answers any author, itself included: with
ALGO_FRIENDLYBOT_ID set to this bot's own id, one token plays both sides.

`$fakefb <mode>` sets how the NEXT answer misbehaves, so every failure path can
be walked live: silent (no answer), nototis (stops after the old picture),
wrong (another card's picture), swr (`Something went wrong`), normal.
"""

import asyncio
import io

import discord
from discord.ext import commands
from PIL import Image, ImageDraw, ImageFont

from .cardedits import ATTACHMENT_PREFIX, friendlybot_file_key, parse_command, watched_channels

MODES = ("normal", "silent", "nototis", "wrong", "swr")

#: seconds from the command to each message: the first line, the old picture,
#: "To this" (the render), the new picture (friendlybot.md's measured timings)
DELAYS = (0.3, 0.4, 4.7, 0.3)

#: the scan's geometry (720 x 1000; bot/pipeline/read_card_faces.py reads the same regions)
SIZE = (720, 1000)
ORB = (75, 72, 36)                # the cost orb: centre and radius
STATS = (568, 50, 668, 104)       # a unit's power/toughness box
BANNER = (0, 440, 720, 520)       # where a text, type or art change is announced


def file_name(card):
    return f"{ATTACHMENT_PREFIX}{friendlybot_file_key(card)}.jpg"


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def render(scan_path, card, values):
    """The card's scan with `values` ({folded field: value}) painted on, as JPEG bytes."""
    try:
        im = Image.open(scan_path).convert("RGB") if scan_path else None
    except OSError:
        im = None
    if im is None:
        im = Image.new("RGB", SIZE, (60, 60, 60))
        ImageDraw.Draw(im).text((40, 40), card["name"] if isinstance(card, dict) else str(card),
                                fill=(255, 255, 255), font=_font(40))
    im = im.resize(SIZE) if im.size != SIZE else im
    d = ImageDraw.Draw(im)
    row = card if isinstance(card, dict) else {}
    if "total cost" in values or "cost" in values:
        x, y, r = ORB
        d.ellipse((x - r, y - r, x + r, y + r), fill=(0, 0, 0), outline=(255, 60, 60), width=3)
        d.text((x, y), str(values.get("total cost", row.get("total_cost", "?"))),
               fill=(255, 255, 255), font=_font(40), anchor="mm")
        if "cost" in values:
            d.text((x, y + r + 16), values["cost"], fill=(255, 60, 60), font=_font(22), anchor="mm")
    if "power" in values or "toughness" in values:
        d.rectangle(STATS, fill=(235, 235, 235), outline=(255, 60, 60), width=3)
        pt = f"{values.get('power', row.get('power', '?'))}/{values.get('toughness', row.get('toughness', '?'))}"
        d.text(((STATS[0] + STATS[2]) // 2, (STATS[1] + STATS[3]) // 2), pt,
               fill=(0, 0, 0), font=_font(36), anchor="mm")
    rest = [f for f in values if f not in ("cost", "total cost", "power", "toughness")]
    if rest:
        d.rectangle(BANNER, fill=(200, 30, 30))
        d.text((360, 480), "simulated: " + ", ".join(sorted(rest)), fill=(255, 255, 255),
               font=_font(34), anchor="mm")
    out = io.BytesIO()
    im.save(out, "JPEG", quality=88)
    return out.getvalue()


class FakeFriendlyBot(commands.Cog):
    def __init__(self, bot, *, channels=None, cards=None, sleep=asyncio.sleep, delays=DELAYS):
        self.bot = bot
        self.channels = set(channels) if channels is not None else watched_channels()
        self._cards = cards
        self.sleep = sleep
        self.delays = delays
        self.mode = "normal"
        self.values = {}        # card name -> {folded field: value}, as edited so far

    @property
    def cards(self):
        if self._cards is None:
            from cards import CardIndex
            self._cards = CardIndex()
        return self._cards

    @commands.Cog.listener()
    async def on_message(self, message):
        if str(message.channel.id) in self.channels:
            await self.answer(message.channel, message.content or "")

    async def answer(self, channel, content):
        """FriendlyBot's answer to one message in a watched channel."""
        if content.startswith("$fakefb"):
            mode = content[len("$fakefb"):].strip().lower()
            if mode in MODES:
                self.mode = mode
                await channel.send(f"(fake FriendlyBot) next answer: {mode}")
            return
        parsed = parse_command(content)
        if not parsed:
            return                          # FriendlyBot ignores what it cannot read
        card, name, _ = self.cards.lookup(parsed["name"])
        if card is None:
            return
        mode, self.mode = self.mode, "normal"
        if mode == "silent":
            return
        first, before_pic, to_this, after_pic = self.delays
        if mode == "swr":
            await self.sleep(first)
            await channel.send("Something went wrong")
            return
        if parsed["verb"] != "modify":
            await self.sleep(first + before_pic + to_this)
            await channel.send(f"Set the complexity of {parsed['name']} to {parsed['value']}")
            return
        shown = self._other(name) if mode == "wrong" else name
        before = dict(self.values.get(shown, {}))
        self.values.setdefault(name, {})[parsed["field"]] = parsed["value"]
        after = dict(self.values.get(shown, {}))
        await self.sleep(first)
        await channel.send(f"Modified {parsed['name']}'s {parsed['raw_field']} from this")
        await self.sleep(before_pic)
        await channel.send(file=self._picture(shown, before))
        if mode == "nototis":
            return
        await self.sleep(to_this)
        await channel.send("To this")
        await self.sleep(after_pic)
        await channel.send(file=self._picture(shown, after))

    def _other(self, name):
        names = sorted(self.cards.cards)
        return names[(names.index(name) + 1) % len(names)]

    def _picture(self, name, values):
        data = render(self.cards.art_path(name), self.cards.cards.get(name, {"name": name}), values)
        return discord.File(io.BytesIO(data), filename=file_name(name))
