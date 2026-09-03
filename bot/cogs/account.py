"""
cogs/account.py — who you are on the game server, seen from Discord.

`/link` binds a Discord account to a game account so `/profile` and `/rating`
know who is asking. The code is minted on the player's own profile page and
typed here; link.ts on the server explains why that direction and not the
other.

⚠ EVERY REPLY HERE IS EPHEMERAL BY DEFAULT. A link code is a secret for ten
minutes, and somebody's rating is their business — `/profile` and `/rating`
take `private:` like the rest, but a link code has no public form at all.
"""

import discord
from discord import app_commands
from discord.ext import commands

import gameserver

from .common import down_notice, fail, public_url, start

MODES = [
    app_commands.Choice(name="constructed", value="constructed"),
    app_commands.Choice(name="draft", value="draft"),
]



class Account(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    link = app_commands.Group(
        name="link", description="Connect your Discord to your Algomancy account")

    @link.command(name="start", description="How to connect your account")
    async def link_start(self, interaction: discord.Interaction):
        url = public_url()
        where = f"{url}/?account=1" if url else "your profile page on the client"
        await interaction.response.send_message(
            "**Linking takes ten seconds:**\n"
            f"1. Sign in at {where} and open **Account → Connections**\n"
            "2. Press **Link Discord** — you'll get a six-character code\n"
            "3. Come back here and run `/link code <that code>`\n\n"
            "The code is minted on your own signed-in page, which is what "
            "proves the account is yours. It lasts ten minutes.",
            ephemeral=True)

    @link.command(name="code", description="Redeem the code from your profile page")
    @app_commands.describe(code="The six characters your profile page showed you.")
    async def link_code(self, interaction: discord.Interaction, code: str):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.claim_link(
                code.strip(), interaction.user.id, str(interaction.user))
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        if not body.get("ok"):
            await fail(interaction, f"⚠️ {body.get('error', 'that did not work')}")
            return
        name = (body.get("account") or {}).get("username", "your account")
        await interaction.followup.send(
            f"✅ Linked to **{name}**. `/profile` and `/rating` know you now.",
            ephemeral=True)

    @link.command(name="status", description="Which account this Discord is linked to")
    async def link_status(self, interaction: discord.Interaction):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.profile(discord_id=interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        if not body.get("linked"):
            await fail(interaction, "This Discord isn't linked to anything yet — "
                                    "`/link start` explains how.")
            return
        await interaction.followup.send(
            f"Linked to **{body['player']['username']}**.", ephemeral=True)

    @link.command(name="remove", description="Disconnect this Discord from your account")
    async def link_remove(self, interaction: discord.Interaction):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.unlink(interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        if not body.get("ok"):
            await fail(interaction, f"⚠️ {body.get('error', 'that did not work')}")
            return
        await interaction.followup.send(
            f"Unlinked from **{body.get('was', 'your account')}**.", ephemeral=True)

    # ── /profile ──────────────────────────────────────────────────────
    @app_commands.command(name="profile", description="Somebody's record")
    @app_commands.describe(
        user="Whose (defaults to you, if you've linked).",
        name="…or look them up by their Algomancy username.")
    async def profile(self, interaction: discord.Interaction,
                      user: discord.User = None, name: str = None,
                      private: bool = False):
        await start(interaction, private=private)
        body, who = await self._lookup(interaction, user, name)
        if body is None:
            return
        p = body["player"]
        prof = p.get("profile", {})
        e = discord.Embed(title=p["username"], color=0x5865F2)
        e.add_field(name="Record",
                    value=f"{prof.get('wins', 0)}W / {prof.get('losses', 0)}L "
                          f"· {prof.get('games', 0)} games", inline=True)
        ratings = prof.get("rating", {})
        played = prof.get("ratedGames", {})
        e.add_field(
            name="Rating",
            value="\n".join(
                f"{m}: **{ratings.get(m, 1000)}** ({played.get(m, 0)} rated)"
                for m in ("constructed", "draft")),
            inline=True)
        if prof.get("bestStreak"):
            e.add_field(name="Best streak", value=str(prof["bestStreak"]), inline=True)
        if p.get("favoriteElement"):
            e.set_footer(text=f"favourite element: {p['favoriteElement']}"
                              + (" · online" if body.get("online") else ""))
        await interaction.followup.send(embed=e)

    # ── /rating ───────────────────────────────────────────────────────
    @app_commands.command(name="rating", description="Just the number")
    @app_commands.choices(mode=MODES)
    async def rating(self, interaction: discord.Interaction,
                     mode: app_commands.Choice[str] = None,
                     user: discord.User = None, name: str = None,
                     private: bool = False):
        await start(interaction, private=private)
        body, who = await self._lookup(interaction, user, name)
        if body is None:
            return
        p = body["player"]
        prof = p.get("profile", {})
        wanted = [mode.value] if mode else ["constructed", "draft"]
        lines = [f"**{m}**: {prof.get('rating', {}).get(m, 1000)} "
                 f"({prof.get('ratedGames', {}).get(m, 0)} rated games)"
                 for m in wanted]
        await interaction.followup.send(f"**{p['username']}** — " + " · ".join(lines))

    # ── /leaderboard ──────────────────────────────────────────────────
    @app_commands.command(name="leaderboard", description="The ladder")
    @app_commands.choices(mode=MODES)
    async def leaderboard(self, interaction: discord.Interaction,
                          mode: app_commands.Choice[str],
                          limit: app_commands.Range[int, 1, 25] = 10,
                          private: bool = False):
        await start(interaction, private=private)
        try:
            body = await gameserver.client.leaderboard(mode.value)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        players = (body.get("players") or [])[:limit]
        if not players:
            # Not an error: with PUBLIC_AFTER=5 an early ladder is legitimately
            # empty, and saying so is more use than an empty list.
            await fail(interaction,
                       f"Nobody's on the {mode.value} ladder yet — it takes "
                       f"{body.get('publicAfter', 5)} rated games to be listed.")
            return
        lines = [f"`{i + 1:>2}` **{r['username']}** — {r['rating']} "
                 f"({r['ratedGames']} rated)"
                 for i, r in enumerate(players)]
        e = discord.Embed(title=f"🏆 {mode.value} ladder",
                          description="\n".join(lines), color=0xE2B33B)
        e.set_footer(text=f"{body.get('rated', len(players))} players have a rated game")
        await interaction.followup.send(embed=e)

    # ── shared ────────────────────────────────────────────────────────
    async def _lookup(self, interaction, user, name):
        """(body, who) for whoever was asked about, or (None, None) after
        having already told the user why not."""
        try:
            if name:
                body = await gameserver.client.profile(name=name)
            else:
                target = user or interaction.user
                body = await gameserver.client.profile(discord_id=target.id)
                if not body.get("linked"):
                    mine = target.id == interaction.user.id
                    await fail(interaction,
                               "You haven't linked your Discord yet — `/link start`."
                               if mine else
                               f"{target.display_name} hasn't linked their Discord. "
                               "Try `name:` with their Algomancy username.")
                    return None, None
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return None, None
        if not body.get("player"):
            await fail(interaction, f"No player called **{name}**.")
            return None, None
        return body, body["player"]["username"]
