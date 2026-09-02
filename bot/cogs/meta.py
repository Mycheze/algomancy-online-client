"""cogs/meta.py — /help, and the owner-only sync escape hatch."""

import discord
from discord import app_commands
from discord.ext import commands

HELP = [
    ("Rules", [
        ("/ask", "a rules question — cites its sources, and opens a thread you "
                 "can keep asking in"),
        ("/rulings", "every community, judge and designer ruling about one card"),
    ]),
    ("Cards", [
        ("/card", "look one up by name · `with:` stacks a graft or augment under it"),
        ("/find", "find a card from what it DOES, when the name is gone"),
    ]),
    ("Practice", [
        ("/puzzle play", "a board puzzle — work out the best line"),
        ("/draft", "a draft pack to pick from"),
        ("/colors suggest", "a three-colour deck you haven't played"),
    ]),
    ("Other", [
        ("/feedback", "tell Ben what you'd change"),
    ]),
]


class Meta(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="help", description="What this bot can do")
    async def help_cmd(self, interaction: discord.Interaction, private: bool = True):
        e = discord.Embed(
            title="Algomancy bot",
            description="Rules answers grounded in the manual, the glossary and "
                        "the Discord rulings — plus the cards, and something to "
                        "practise on.",
            color=0x5865F2)
        for section, rows in HELP:
            e.add_field(
                name=section,
                value="\n".join(f"**{c}** — {d}" for c, d in rows),
                inline=False)
        e.set_footer(text="Play at the client · every answer links its sources")
        await interaction.response.send_message(embed=e, ephemeral=private)

    @app_commands.command(name="sync", description="(owner) re-publish the command tree")
    @app_commands.describe(scope="guild = instant, here only. global = everywhere, slow.")
    @app_commands.choices(scope=[
        app_commands.Choice(name="this guild (instant)", value="guild"),
        app_commands.Choice(name="global (up to an hour)", value="global"),
    ])
    async def sync(self, interaction: discord.Interaction,
                   scope: app_commands.Choice[str]):
        owner = (await self.bot.application_info()).owner
        if interaction.user.id != owner.id:
            await interaction.response.send_message(
                "That one's Ben's.", ephemeral=True)
            return
        await interaction.response.defer(thinking=True, ephemeral=True)
        if scope.value == "guild" and interaction.guild:
            self.bot.tree.copy_global_to(guild=interaction.guild)
            done = await self.bot.tree.sync(guild=interaction.guild)
            where = "this guild"
        else:
            done = await self.bot.tree.sync()
            where = "globally (may take up to an hour)"
        await interaction.followup.send(f"Synced {len(done)} commands {where}.",
                                        ephemeral=True)
