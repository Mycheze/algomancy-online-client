#!/usr/bin/env python3
"""upload_emojis.py — install the card icons in the guild as custom emojis.

On Discord the bot draws card text with the guild's OWN custom emojis: bot.py caches
them by name at on_ready, and render_card_text() looks each icon up by that name. So
an icon in data/icons/ is invisible on Discord until an emoji of the same name exists —
which is why a new icon needs this pass, and why [once] kept rendering as "[once]".

    ./.venv/bin/python upload_emojis.py <bot-token> [guild-id]

The bot account needs "Manage Expressions" in the guild. Emojis that already exist
are left untouched, so re-running after adding an icon only adds the new ones.

A guild has 50 emoji slots, so this uploads only the icons a front-end can actually
ask for — every cost_<n> whose number some card prints, and not the rest.
"""

import asyncio
import io
import sys
from pathlib import Path

import discord
from PIL import Image

import core

# Locations live in paths.py.
from paths import ICONS_DIR as ICONS


def wanted():
    """The icon names the front-ends can ask for, and that we have a file for.

    data/icons/ carries cost_0 through cost_9 so a future card is already covered, but
    only a handful of those numbers are printed today — no point spending a guild's
    emoji slots on the rest. So take the keyword and faction icons, then add the cost
    icons that the actual card text expands to.
    """
    names = set(core.ICON_NAMES.values()) | set(core.RESOURCE_NAMES.values())
    for card in core.cards.cards.values():
        for tok in core.ICON_TOKEN_RE.findall(card.get("text") or ""):
            names.update(n for n, _ in core.cost_token_icons(tok) or [])
    return {n for n in sorted(names) if (ICONS / f"{n}.webp").exists()}


def png_bytes(name):
    """The icon as PNG. Discord's emoji endpoint takes png/jpeg/gif, not webp."""
    buf = io.BytesIO()
    Image.open(ICONS / f"{name}.webp").convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


class Uploader(discord.Client):
    def __init__(self, guild_id):
        super().__init__(intents=discord.Intents.default())
        self.guild_id = guild_id
        self.failed = False

    async def on_ready(self):
        try:
            await self.upload()
        except Exception as e:                     # noqa: BLE001 — report, don't trace
            print(f"error: {e}")
            self.failed = True
        finally:
            await self.close()                     # otherwise the client sits forever

    async def upload(self):
        guild = self.pick_guild()
        if guild is None:
            self.failed = True
            return

        have = {e.name for e in guild.emojis}
        todo = sorted(wanted() - have)
        print(f"{guild.name}: {len(guild.emojis)}/{guild.emoji_limit} emoji slots used")
        if not todo:
            print("every icon is already an emoji — nothing to do")
            return
        if len(todo) > guild.emoji_limit - len(guild.emojis):
            print(f"error: {len(todo)} to add but only "
                  f"{guild.emoji_limit - len(guild.emojis)} slots free")
            self.failed = True
            return

        print(f"adding {len(todo)}: {', '.join(todo)}")
        for name in todo:
            try:
                await guild.create_custom_emoji(
                    name=name, image=png_bytes(name),
                    reason="Algomancy card icon")
                print(f"  + :{name}:")
            except discord.Forbidden:
                print(f"  ! :{name}: — the bot lacks Manage Expressions here")
                self.failed = True
                return
            except discord.HTTPException as e:
                print(f"  ! :{name}: — {e}")
                self.failed = True

    def pick_guild(self):
        if self.guild_id:
            guild = self.get_guild(self.guild_id)
            if guild is None:
                print(f"error: the bot is not in guild {self.guild_id}")
            return guild
        if len(self.guilds) == 1:
            return self.guilds[0]
        if not self.guilds:
            print("error: the bot is in no guilds")
            return None
        print("error: the bot is in several guilds — name one:")
        for g in self.guilds:
            print(f"  {g.id}  {g.name}")
        return None


def main():
    if not 2 <= len(sys.argv) <= 3:
        raise SystemExit(__doc__.strip())
    guild_id = int(sys.argv[2]) if len(sys.argv) == 3 else None

    client = Uploader(guild_id)
    try:
        client.run(sys.argv[1], log_handler=None)
    except discord.LoginFailure:
        raise SystemExit("error: that bot token was rejected")
    if client.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
