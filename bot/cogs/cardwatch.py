"""
cogs/cardwatch.py — "Caleb changed a card"; both halves of finding out.

Caleb errataes cards and announces it in #card-changes in HIS Discord, which
this bot cannot read: it is in one guild, the owner's, and gets 403 on that
channel. Between 2026-08-19 and 2026-09-21 eleven Light & Dark cards drifted and
nothing here noticed — Stalwart Sentinel gained `[once]`, Deathcoil Construct
went 3 mana to 5, Feed to Hooba changed the VERB from erase to delete, and Tithe
Enforcer lost its Prophecy banner and with it the whole of its text. Every one
was live in the client, wrong, for a month.

TWO SOURCES, AND NEITHER IS ALLOWED TO BE THE ONLY ONE
------------------------------------------------------
  * THE MIRROR — the owner's server follows #card-changes, so Caleb's posts
    arrive in a channel this bot CAN read. That is where the WHY of a change
    is: which card, what changed, and often the reasoning. It is also the only
    source for a change algomancer.cc cannot represent at all (see below).
    ⚠ But a follow only forwards posts the author PUBLISHES, and on 2026-09-21
    the mirror held nothing but its own two "now following" notices while nine
    cards had changed that day. So it can be silent through a real change.
  * THE FEED — algomancer.cc's card API, diffed against our oracle by
    pipeline/check_card_updates.py. It caught all eleven. It cannot tell you
    why, and it has one blind spot that matters (below).

Each covers the other's failure. A post arriving runs the diff; the diff runs
daily regardless. Either one firing puts a report in front of the owner.

⚠ THE FEED DOES NOT OCR CARD TEXT — it stores a card's name, its colour and its
image, and that is all (owner, 2026-09-21). So it never re-renders a card, a
revision-hashed image URL is a NEW FILE CALEB UPLOADED, and **the report says
WHICH cards to look at while the SCAN says what changed**. Nothing this cog
posts should be copied into the oracle. It is a pointer, not a transcription.
And because the feed has no field for an alternative cost of any kind, it can
never report a Prophecy or Ambush banner changing — that is exactly how Tithe
Enforcer would have been missed, and why the mirror half is not optional.

OFF UNLESS CONFIGURED, like every other integration here. No
ALGO_CARDWATCH_CHANNEL means no listener and no loop, which is the intended
state for a deploy that has not opted in rather than a broken one.
"""

import asyncio
import os
import traceback
from datetime import datetime, timezone

import discord
from discord.ext import commands, tasks

import paths
from pipeline import check_card_updates as checker

#: The mirrored #card-changes channel: watched for Caleb's posts, and where the
#: reports go. One id on purpose — the report belongs beside the post that
#: prompted it, and a second channel would be a second thing to keep correct.
CHANNEL_ID = int(os.getenv("ALGO_CARDWATCH_CHANNEL") or 0)

#: How often the feed is polled when nothing has been posted. Daily: Caleb
#: errataes in batches, the whole 2026-09-21 round shared one timestamp, and a
#: tighter loop would only find the same nothing more often.
POLL_HOURS = float(os.getenv("ALGO_CARDWATCH_HOURS", "24"))

#: Discord refuses a message over 2000 characters, and a big errata round can
#: exceed that. The report is cut at the last whole card that fits.
LIMIT = 1900


def _format(findings: list[dict], trigger: str) -> str:
    """The findings as one message. Deliberately blunt about what it is worth:
    every line here came from a feed that has not read the card."""
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    head = (f"**Card changes upstream** — {trigger}, {when}\n"
            f"{len(findings)} card(s) disagree with `data/cards/AlgomancyCards-OracleText.json`.\n"
            "⚠ algomancer.cc does not OCR card text. **Open the scan** — this says which "
            "cards to look at, not what they say now.\n")
    out = [head]
    used = len(head)
    for f in findings:
        block = f"\n__{f['name']}__ (upstream v{f['version']})\n"
        for n in f["notes"]:
            block += f"• {n}\n"
        if used + len(block) > LIMIT:
            out.append(f"\n…and {len(findings) - (len(out) - 1)} more. "
                       "Run `bot/pipeline/check_card_updates.py` for the rest.")
            break
        out.append(block)
        used += len(block)
    return "".join(out)


class CardWatch(commands.Cog):
    """The mirror listener and the daily poll, both ending in the same report."""

    def __init__(self, bot):
        self.bot = bot
        self._lock = asyncio.Lock()      # one check at a time: both halves can fire together

    @commands.Cog.listener()
    async def on_ready(self):
        """Start the daily poll HERE, not in `__init__`.

        ⚠ `tasks.Loop.start()` in the constructor raises. `build_bot()` — the
        constructor every test uses, and the real one before login — connects
        to nothing, so the loop's `before_loop` hits `wait_until_ready()` on a
        client that has never logged in and dies with "Client has not been
        properly initialised". The test caught it on the first run.

        `on_ready` fires on every RECONNECT as well as the first connect, so
        the guard is not decoration: without it a flaky connection would stack
        a second and third poll on the same channel."""
        if CHANNEL_ID and not self.poll.is_running():
            self.poll.change_interval(hours=POLL_HOURS)
            self.poll.start()

    async def cog_unload(self):
        if self.poll.is_running():
            self.poll.cancel()

    # ── the check itself, shared by both halves ───────────────────────

    async def run_check(self) -> list[dict]:
        """Fetch and diff. ⚠ OFF THE EVENT LOOP: `checker.fetch` is a blocking
        urllib call and the diff walks 536 oracle rows, and a bot that stops
        answering /card while it talks to a third-party site is a worse bug than
        the one this exists to catch."""
        def work():
            import json
            site = checker.fetch(offline=False)
            ours = json.loads(paths.ORACLE_JSON.read_text(encoding="utf-8"))
            findings, _unmatched = checker.compare(ours, site)
            return findings
        return await asyncio.to_thread(work)

    async def report(self, channel, trigger: str, *, quiet_when_level: bool) -> None:
        """Run the check and say what it found.

        `quiet_when_level` is the difference between the two halves. A daily
        poll that found nothing says nothing — a bot that posts "still fine"
        every day trains you to skim past it, and the day it matters you skim
        past that too. A poll fired by one of CALEB'S OWN POSTS does answer,
        because silence there reads as "the bot missed it", and because a real
        post with no diff is itself information: it means the change is one the
        feed cannot see (a banner), and the scan is the only way in."""
        async with self._lock:
            try:
                findings = await self.run_check()
            except Exception as exc:
                traceback.print_exc()
                # Only speak up about a failure that somebody asked for. A
                # broken daily poll must not post a stack trace every morning.
                if not quiet_when_level:
                    await channel.send(f"⚠️ Couldn't check algomancer.cc: `{exc}`")
                return

            if not findings:
                if not quiet_when_level:
                    await channel.send(
                        "Checked algomancer.cc against our oracle: **no field disagrees**.\n"
                        "⚠ That is not \"no change\". The feed has no field for a Prophecy or "
                        "Ambush banner and does not read card text, so a banner appearing or "
                        "disappearing is invisible to it. If the post above names a card, "
                        "**open its scan**.")
                return

            await channel.send(_format(findings, trigger),
                               allowed_mentions=discord.AllowedMentions.none())

    # ── half one: Caleb posted ────────────────────────────────────────

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """A forwarded #card-changes post.

        ⚠ IT ARRIVES AS A WEBHOOK, SO ITS AUTHOR IS A BOT. `AlgoBot.on_message`
        returns early on `message.author.bot` — correctly, for its own job — and
        this would never run if it lived there. A cog listener is dispatched
        beside that method rather than through it, which is the whole reason
        this is here and not in bot.py.

        Own messages are still skipped, or the report this cog posts would
        trigger another check, for ever."""
        if not CHANNEL_ID or message.channel.id != CHANNEL_ID:
            return
        if self.bot.user is not None and message.author.id == self.bot.user.id:
            return
        await self.report(message.channel, "a post in the mirrored #card-changes",
                          quiet_when_level=False)

    # ── half two: nobody posted, and cards changed anyway ─────────────

    @tasks.loop(hours=24)
    async def poll(self):
        channel = self.bot.get_channel(CHANNEL_ID)
        if channel is None:
            return          # not in cache yet, or the channel is gone; try tomorrow
        await self.report(channel, "daily check", quiet_when_level=True)

    @poll.before_loop
    async def _ready(self):
        await self.bot.wait_until_ready()
