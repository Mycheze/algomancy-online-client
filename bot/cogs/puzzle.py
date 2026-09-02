"""
cogs/puzzle.py — "What's the play?" board puzzles.

⚠ `/puzzle play` IS PUBLIC: it opens a thread so people can argue about the
board, and an ephemeral message cannot have one. The ANSWER is a different
matter — 🔑 reveals it ephemerally, so one person checking themselves cannot
spoil it for the thread, and a 📣 button puts it in front of everyone once
they have all had a go. That split is the whole design and it lives in the
buttons, not here.

This is also the command that was broken. `&wtp` raised AttributeError on every
puzzle from the day it shipped until it was fixed, because nothing imported
bot.py and the Discord half was never live-tested. test/test_embeds.py now
renders every puzzle.
"""

import discord
from discord import app_commands
from discord.ext import commands

import store
import wtp

from .common import fail, start


class Puzzle(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        from bot import (HintButton, NextPuzzleButton, PostSolutionButton,
                         RevealButton)
        self.bot.add_dynamic_items(RevealButton, HintButton,
                                   PostSolutionButton, NextPuzzleButton)

    puzzle = app_commands.Group(
        name="puzzle", description="What's the play? — board puzzles")

    async def _id_autocomplete(self, interaction: discord.Interaction, current: str):
        # ⚠ Autocomplete has a three-second budget and no defer. load_all()
        # touches the disk, so the list is cached on the cog and refreshed
        # whenever the command is actually RUN — puzzles are authored in the
        # web editor, on human timescales.
        ids = getattr(self, "_ids", None)
        if ids is None:
            ids = self._ids = [(p.id, p.title) for p in wtp.load_all()]
        q = (current or "").lower()
        return [app_commands.Choice(name=f"{t} · {i}"[:100], value=i)
                for i, t in ids if q in i.lower() or q in t.lower()][:25]

    @puzzle.command(name="play", description="Get a puzzle to solve")
    @app_commands.describe(id="A specific puzzle (default: one you haven't seen).")
    @app_commands.autocomplete(id=_id_autocomplete)
    async def play(self, interaction: discord.Interaction, id: str = None):
        # Public: opens a thread. See the header.
        await start(interaction)
        self._ids = [(p.id, p.title) for p in wtp.load_all()]     # refresh the cache
        chosen = None
        if id:
            try:
                chosen = wtp.load(id)
            except wtp.PuzzleError as exc:
                await fail(interaction, f"⚠️ {exc}")
                return
        from bot import send_puzzle
        await send_puzzle(interaction.channel, interaction.user, puzzle=chosen,
                          followup=interaction.followup)

    @puzzle.command(name="list", description="Every puzzle, and which you've seen")
    async def list_(self, interaction: discord.Interaction, private: bool = True):
        await start(interaction, private=private)
        puzzles = wtp.load_all()
        if not puzzles:
            await fail(interaction, "No puzzles yet — build one in the web editor.")
            return
        seen = set(store.wtp_seen(interaction.user.id))
        lines = [
            f"{'✅' if p.id in seen else '🆕'} **{p.title}** · `{p.id}` "
            f"· {p.difficulty}" + (f" · {', '.join(p.tags)}" if p.tags else "")
            for p in puzzles[:25]]
        e = discord.Embed(title="🧩 What's the Play? — puzzles",
                          description="\n".join(lines), color=0x5865F2)
        e.set_footer(text="/puzzle play id:<one of these> · "
                          "/puzzle play for one you haven't seen")
        await interaction.followup.send(embed=e)
