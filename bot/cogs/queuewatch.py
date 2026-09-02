"""
cogs/queuewatch.py — "somebody is waiting for a game; come play".

`/queuewatch #channel @role` marks a channel, and every queue join arrives from
the game server (pushserver.py) and turns into one message there.

⚠ NO AUTO-CLEANUP OF OLD MESSAGES — the owner's explicit call. A stale
invitation is left where it is rather than edited or deleted. What IS cleaned
up is a watch pointing at a channel that no longer exists or that the bot can
no longer post in: without that, one deleted channel raises on every queue join
for ever. That is a different thing from tidying away announcements, and it is
the only self-healing here.

⚠ ALLOWED MENTIONS ARE ALWAYS EXPLICIT. Never the client default. A queue
announcement pings exactly the configured role and nothing else — the player's
own Discord handle is rendered as a name, not a ping, because being announced
is not a reason to be notified. And `@everyone` is refused outright: it is a
role like any other to the API, and `role.is_default()` is the only thing
between "come play" and pinging a server.
"""

import discord
from discord import app_commands
from discord.ext import commands

import gameserver
import watchers

from .common import down_notice, fail, start

MODE_LABEL = {"constructed": "constructed", "draft": "draft"}


class QueueWatch(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # ── the announcement ──────────────────────────────────────────────
    async def on_event(self, envelope):
        """One event from the game server. Called in the background."""
        event = envelope.get("event") or {}
        if event.get("t") != "queue.join":
            return                       # only joins are announced, for now
        user_id = str(event.get("userId") or "")
        for channel_id, watch in watchers.all_watches().items():
            if not watchers.may_announce(user_id, channel_id):
                continue
            channel = self.bot.get_channel(channel_id)
            if channel is None:
                watchers.remove_watch(channel_id)
                print(f"[queuewatch] channel {channel_id} is gone; watch dropped")
                continue
            role = None
            if watch.get("role_id"):
                role = channel.guild.get_role(int(watch["role_id"]))
            try:
                await channel.send(**self._announcement(event, role))
            except (discord.Forbidden, discord.NotFound) as exc:
                watchers.remove_watch(channel_id)
                print(f"[queuewatch] can't post in {channel_id} ({exc}); watch dropped")

    def _announcement(self, event, role):
        counts = event.get("counts") or {}
        total = counts.get("total", 1)
        mode = MODE_LABEL.get(event.get("mode"), event.get("mode") or "a game")
        who = event.get("username") or "somebody"
        # A linked Discord account is shown as a mention so people recognise
        # each other — but users=False below means it renders without pinging.
        if event.get("discordId"):
            who = f"**{who}** (<@{event['discordId']}>)"
        else:
            who = f"**{who}**"
        kind = "ranked" if event.get("ranked") else "open"
        line = (f"🎮 {who} just joined the **{mode}** queue — {kind}, "
                f"{event.get('rating', '?')}. "
                f"**{total} waiting.**")

        view = discord.ui.View(timeout=None)
        url = _public_url()
        if url:
            # A LINK button: no custom_id, no callback, nothing to persist.
            view.add_item(discord.ui.Button(
                label="Join the queue →", style=discord.ButtonStyle.link, url=url))

        return {
            "content": f"{line}\n{role.mention}" if role else line,
            "view": view if url else None,
            # ⚠ Explicit, always. See the header.
            "allowed_mentions": discord.AllowedMentions(
                roles=[role] if role else False, users=False, everyone=False),
        }

    # ── /queuewatch ───────────────────────────────────────────────────
    @app_commands.command(
        name="queuewatch",
        description="Announce here when somebody joins the matchmaking queue")
    @app_commands.describe(
        channel="Where to post (default: here).",
        role="Ping this role each time. Leave empty for a quiet announcement.",
        enabled="Set false to stop watching that channel.")
    # Configuring a ping channel is a moderator action, so Discord's own
    # permission UI handles it rather than a hand-rolled check. guild_only
    # because default_permissions means nothing in a DM.
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.guild_only()
    async def queuewatch(self, interaction: discord.Interaction,
                         channel: discord.TextChannel = None,
                         role: discord.Role = None,
                         enabled: bool = True):
        target = channel or interaction.channel

        if not enabled:
            gone = watchers.remove_watch(target.id)
            await interaction.response.send_message(
                f"Stopped watching {target.mention}." if gone
                else f"{target.mention} wasn't being watched.", ephemeral=True)
            return

        if role is not None and role.is_default():
            await interaction.response.send_message(
                "That's `@everyone` — I'm not doing that. Pick a real role, or "
                "leave it empty for a quiet announcement.", ephemeral=True)
            return

        await start(interaction, private=True)
        # Prove the game server is reachable BEFORE promising anything, and
        # show the current counts — it turns "did that work?" into an answer.
        try:
            counts = (await gameserver.client.queue_counts()).get("counts", {})
            reachable = f"{counts.get('total', 0)} waiting right now"
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc)
                       + "\n(I haven't saved the watch — fix that first.)")
            return

        replaced = watchers.set_watch(
            target.id, guild_id=interaction.guild_id,
            role_id=role.id if role else None, added_by=interaction.user.id)
        await interaction.followup.send(
            f"{'Updated' if replaced else 'Watching'} {target.mention} — "
            f"I'll post there when somebody joins the queue"
            + (f", pinging {role.mention}." if role else ", quietly.")
            + f"\nGame server is up · {reachable}.",
            allowed_mentions=discord.AllowedMentions.none())

    # ── /queue ────────────────────────────────────────────────────────
    @app_commands.command(name="queue", description="Who's waiting for a game")
    async def queue(self, interaction: discord.Interaction, private: bool = True):
        await start(interaction, private=private)
        try:
            body = await gameserver.client.queue()
        except gameserver.GameServerDown as exc:
            # Fall back to the PUBLIC counts route: it needs no token, so it
            # still answers when only the privileged half is misconfigured.
            try:
                counts = (await gameserver.client.queue_counts()).get("counts", {})
                await interaction.followup.send(
                    f"**{counts.get('total', 0)}** waiting "
                    f"({counts.get('byMode', {}).get('constructed', 0)} constructed, "
                    f"{counts.get('byMode', {}).get('draft', 0)} draft). "
                    "I can't see who — that needs the bot token.")
            except gameserver.GameServerDown:
                await fail(interaction, down_notice(exc))
            return

        waiting = body.get("waiting") or []
        if not waiting:
            url = _public_url()
            await interaction.followup.send(
                "Nobody's in the queue right now."
                + (f"\nBe the first: {url}" if url else ""))
            return
        lines = []
        for w in waiting:
            band = w.get("band")
            lines.append(
                f"• **{w['username']}** · {w['mode']} · "
                f"{'ranked' if w.get('ranked') else 'open'} · {w.get('rating', '?')}"
                f" · waiting {round(w.get('waitedMs', 0) / 1000)}s"
                + (f" · ±{band}" if band else " · anyone"))
        e = discord.Embed(title=f"⏳ {len(waiting)} waiting",
                          description="\n".join(lines)[:4000], color=0x5865F2)
        await interaction.followup.send(embed=e)


def _public_url():
    import os
    return os.getenv("ALGO_PUBLIC_URL", "").strip() or None
