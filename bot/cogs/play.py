"""
cogs/play.py — the two practice tools: colour combos, and pack-1-pick-X drafts.

`/colors` is a group rather than one command sniffing its own argument. The
prefix version read `&colors`, `&colors stats` and `&colors fire earth wood` off
one free-text string against a set of magic words (STATS_WORDS), which is
exactly the ambiguity subcommands exist to remove.

⚠ `/draft` IS PUBLIC for the same reason `/ask` is: it opens a thread so a
group can argue about the pack, and an ephemeral message cannot have one.
"""

import discord
from discord import app_commands
from discord.ext import commands

import combos
import draft
import store
from discordui import (_draft_file, _render, confirmation, draft_embed,
                       stats_embed, suggestion_embed)

from .common import fail, start


class Play(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        from bot import (PickButton, PickClearButton, PlayedButton, RerollButton)
        self.bot.add_dynamic_items(PlayedButton, RerollButton,
                                   PickButton, PickClearButton)

    colors = app_commands.Group(
        name="colors", description="Which three-colour decks to play next")

    @colors.command(name="suggest", description="A fresh three-colour combo you haven't played")
    async def colors_suggest(self, interaction: discord.Interaction,
                             private: bool = False):
        await start(interaction, private=private)
        from bot import combo_view
        games = store.read_games(interaction.user.id)
        combo, reason = combos.suggest(games)
        await interaction.followup.send(
            embed=suggestion_embed(interaction.user, combo, reason,
                                   combos.coverage(games)),
            view=combo_view(interaction.user.id, combo))

    @colors.command(name="log", description="Record a combo you've played")
    @app_commands.describe(combo="e.g. fire earth wood")
    async def colors_log(self, interaction: discord.Interaction, combo: str,
                         private: bool = False):
        await start(interaction, private=private)
        from bot import record_game
        try:
            parsed = combos.parse_combo(combo)
        except combos.ComboError as exc:
            await fail(interaction, f"⚠️ {exc}")
            return
        recorded, cov = record_game(parsed, interaction.user.id, interaction.channel_id)
        await interaction.followup.send(confirmation(parsed, recorded, cov))

    @colors.command(name="stats", description="Which combos you've played, and which are left")
    @app_commands.describe(user="Whose history to show (defaults to yours).")
    async def colors_stats(self, interaction: discord.Interaction,
                           user: discord.User = None, private: bool = False):
        await start(interaction, private=private)
        who = user or interaction.user
        await interaction.followup.send(
            embed=stats_embed(who, combos.coverage(store.read_games(who.id))))

    @app_commands.command(name="draft", description="Practise a draft pick")
    @app_commands.describe(
        mode="p1p1 = a 10-card pack, pick 1. p1p6 = a turn-1 live-draft pile, keep 6.",
        seed="Replay someone else's pack — paste their code.")
    # Built from draft.MODES rather than typed out, so a third mode cannot
    # exist in the engine and be missing from the picker.
    @app_commands.choices(mode=[
        app_commands.Choice(name=f"{m} — {draft.MODES[m].label}", value=m)
        for m in draft.MODES
    ])
    async def draft_cmd(self, interaction: discord.Interaction,
                        mode: app_commands.Choice[str], seed: str = None):
        # Public: opens a thread. See the header.
        await start(interaction)
        from bot import pick_view
        try:
            pack = draft.resolve(mode.value, seed)
        except draft.DraftError as exc:
            await fail(interaction, f"⚠️ {exc}")
            return
        png = await _render(draft.render_pack_image, pack)
        msg = await interaction.followup.send(
            embed=draft_embed(pack), file=_draft_file(png, "pack.png"),
            view=pick_view(pack), wait=True)
        try:
            thread = await msg.create_thread(
                name=f"{pack.spec.label} · {pack.code}"[:90], auto_archive_duration=1440)
            await thread.send(
                f"🧵 Pack's up — **what {pack.picks} would you keep, and why?** Tap the "
                "numbered buttons on the pack to lock in your picks and I'll post them "
                f"here. Everyone can play the same pack: `/draft mode:{pack.mode} "
                f"seed:{pack.seed}`.")
        except discord.HTTPException:
            pass
