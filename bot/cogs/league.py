"""
cogs/league.py — the league's Discord half (client/docs/20-league.md).

The game server owns the league: seasons, pairings, results, and every message
a player should get. This cog does two things with it.

1. DELIVERS THE OUTBOX. Every league message is a row on the server that stays
   there until this cog says it was sent (`/api/league/bot/outbox`, then
   `/ack`). A loop pulls every 30 seconds. That is deliberate, and it is the
   difference from queuewatch: the queue's push is fire-and-forget, and a push
   that lands while the bot is restarting is gone — fine for "someone is
   queueing", not fine for "here are your opponents this week". Pull + ack
   cannot lose a row across a restart on either side; at worst a row sent and
   not yet acked is sent twice.

   ⚠ THE BOT HAD NEVER SENT A DM BEFORE THIS. A player with DMs closed to the
   server makes `user.send` raise Forbidden (Discord error 50007); that row
   falls back to a mention in the league channel and is acked as FAILED with
   the reason, so the organizer's page shows who is not getting messages.

2. /league — join, leave, skip a week, status, standings, and (for moderators)
   which channel gets the public posts.

⚠ ALGO_LEAGUE_DM_REDIRECT (testing only). A Discord user id: every DM — to
anybody, linked or not — goes to that user instead, headed with who it was
for. It is how one person with one Discord account sees every message ten
simulated players would get (docs/20 §8b). Never set it on the deploy box.
"""

import json
import os
import time
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks

import gameserver
import paths

from .common import down_notice, fail, public_url, start

POLL_SECONDS = float(os.getenv("ALGO_LEAGUE_POLL", "30"))
REDIRECT = os.getenv("ALGO_LEAGUE_DM_REDIRECT", "").strip() or None

# League posts ping nobody by default: a mention renders as a name.
QUIET = discord.AllowedMentions(users=False, roles=False, everyone=False)


# ── the channel setting ───────────────────────────────────────────────
# A rewritable file, so: temp + rename to write, and a corrupt file reads as
# empty (paths.py's warning above bot_state_dir()).

def channels() -> dict:
    try:
        data = json.loads(paths.league_channel_file().read_text(encoding="utf-8"))
        return data.get("channels", {}) if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def set_channel(channel_id: int, guild_id: int, added_by: int, on: bool = True) -> bool:
    """Add (or with on=False remove) a league channel. Returns whether it was there before."""
    chans = channels()
    had = str(channel_id) in chans
    if on:
        chans[str(channel_id)] = {"guild_id": guild_id, "added_by": added_by,
                                  "added_at": datetime.now(timezone.utc).isoformat()}
    else:
        chans.pop(str(channel_id), None)
    path = paths.league_channel_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": 1, "channels": chans}, indent=1), encoding="utf-8")
    tmp.replace(path)
    return had


# ── rendering: pure, so the test renders every kind ──────────────────

def _ts(unix, style="f"):
    """A Discord timestamp: it renders in each READER's own time zone, which is
    the whole reason the bot never formats a time itself."""
    return f"<t:{int(unix)}:{style}>"


def _who(people, uid):
    """A player as a mention when they are linked (renders as their name,
    pings nobody under QUIET), else their site name in bold — followed by the
    Discord name they TYPED for the league, when they gave one. That name is
    how the community finds them: the bot lives in the organizer's own server
    and he relays the posts (owner, 2026-10-04), where a mention means nothing."""
    p = (people or {}).get(uid) or {}
    name = f"<@{p['discordId']}>" if p.get("discordId") else f"**{p.get('name', 'someone')}**"
    return f"{name} ({p['contact']})" if p.get("contact") and not p.get("discordId") else name


def _windows(ws, limit=4):
    lines = [f"• {_ts(w['start'], 'f')} – {_ts(w['start'] + w['hours'] * 3600, 't')}" for w in ws[:limit]]
    if len(ws) > limit:
        lines.append(f"• …and {len(ws) - limit} more")
    return "\n".join(lines)


def league_url(base, season=None):
    if not base:
        return None
    return f"{base}/?league={season}" if season else f"{base}/?league"


def render(row, base=None):
    """One outbox row → the kwargs for `send()`: content, embed, view.
    Returns None for a kind this bot does not know (acked as failed, so a
    newer server cannot wedge an older bot's queue)."""
    kind, d, people = row.get("kind"), row.get("data") or {}, row.get("people") or {}
    url = league_url(base, row.get("season"))
    view = None
    if url:
        view = discord.ui.View(timeout=None)
        view.add_item(discord.ui.Button(label="Open the league →", style=discord.ButtonStyle.link, url=url))
    season = d.get("season", "the league")

    if kind == "signup":
        text = (f"🏅 You're in **{season}**! "
                + (f"You joined late, so your first opponents come in week {d.get('firstWeek')}. " if d.get("late") else "")
                + f"Your first pairings arrive {_ts(d['firstPairings'], 'F')} ({_ts(d['firstPairings'], 'R')}). "
                "Can't make a week? `/league skip` before it starts.")
        return {"content": text, "view": view}

    if kind == "signups-open":
        text = (f"🏅 **Sign-ups for {season} are open!** {d.get('weeks')} weeks, "
                f"{d.get('perWeek')} opponents a week matched on when you can play, then a final between the top two. "
                f"This week, play anybody free when you are: up to {d.get('perWeek')} of those games count. "
                f"Week 1 pairings go up {_ts(d['start'], 'F')}. Join on the site.")
        return {"content": text, "view": view}

    if kind == "pairings":
        e = discord.Embed(
            title=f"{season} — week {d.get('week')} of {d.get('weeks')}",
            description=(f"Your opponents this week. Your record: **{d.get('record')}**. "
                         f"Play before {_ts(d['deadline'], 'F')} — a match nobody plays counts for neither of you."
                         + ("\n*The numbers are odd this week, so you have one opponent fewer.*" if d.get("short") else "")),
            colour=0xE0A93C)
        for o in d.get("opponents", []):
            e.add_field(
                name=f"vs {o.get('name')} ({o.get('record')})",
                value=(_who(people, o["id"]) + "\n"
                       + (f"You're both free:\n{_windows(o.get('windows', []))}" if o.get("windows")
                          else "No shared hours — message them to find a time.")),
                inline=False)
        return {"embed": e, "view": view}

    if kind == "challenge":
        f = d.get("from") or {}
        text = (f"🏅 {_who(people, f.get('id'))} started a sign-up week game with you in **{season}**. "
                f"Agree a time, then both press Play on the League page — before {_ts(d['deadline'], 'F')}.")
        return {"content": text, "view": view}

    if kind == "waiting":
        f = d.get("from") or {}
        return {"content": f"🏅 {_who(people, f.get('id'))} is waiting for you in your **{season}** match. "
                           "Open the League page and press Play.", "view": view}

    if kind == "sitting-out":
        nxt = f" See you in week {d['next']}." if d.get("next") else ""
        text = (f"You're sitting out week {d.get('week')} of **{season}**, as you asked.{nxt}" if d.get("skipped")
                else f"There was no opponent for you in week {d.get('week')} of **{season}** this time.{nxt}")
        return {"content": text}

    if kind == "week-pairings":
        lines = [f"{_who(people, m['a'])} vs {_who(people, m['b'])}" for m in d.get("matches", [])]
        text = (f"🏅 **{season} — week {d.get('week')} of {d.get('weeks')}** · play by {_ts(d['deadline'], 'F')}\n"
                + "\n".join(lines))
        return {"content": text[:1990], "view": view}

    if kind == "week-closed":
        rows = [f"{i + 1}. {_who(people, r['id'])} — {r['w']}–{r['l']} ({r['points']} pts)"
                for i, r in enumerate(d.get("table", []))]
        return {"content": f"🏅 **{season}: week {d.get('week')} is over.** The table:\n" + "\n".join(rows), "view": view}

    if kind == "final":
        if d.get("finalist"):
            o = d.get("opponent") or {}
            e = discord.Embed(
                title=f"🏆 You're in the final of {season}!",
                description=(f"Against {o.get('name')} ({o.get('record')}) — {_who(people, o.get('id'))}. "
                             f"One game decides it. Play before {_ts(d['deadline'], 'F')}."),
                colour=0xE0A93C)
            e.add_field(name="You're both free",
                        value=_windows(d.get("windows", [])) or "No shared hours — message them to find a time.",
                        inline=False)
            return {"embed": e, "view": view}
        return {"content": (f"🏆 **The {season} final:** {_who(people, d.get('a'))} vs {_who(people, d.get('b'))}, "
                            f"by {_ts(d['deadline'], 'F')}."), "view": view}

    if kind == "result":
        o = d.get("opponent") or {}
        verb = "You beat" if d.get("won") else "You lost to"
        if d.get("final"):
            text = f"🏆 {verb} {o.get('name')} in the final of **{season}**." + (" You're the champion!" if d.get("won") else "")
        else:
            text = (f"{verb} {o.get('name')}. Your record in **{season}**: {d.get('record')}"
                    + (f" — {d['rank']} of {d['of']}." if d.get("rank") else "."))
        return {"content": text, "view": view}

    if kind == "season":
        if "place" in d:
            place = {"champion": "🏆 **Champion!**", "finalist": "🥈 **Finalist.**",
                     "participant": "🏅 Thanks for playing."}.get(d["place"], "")
            text = (f"**{season}** is over. {place} Your record: {d.get('w')}–{d.get('l')}. "
                    "The season's badge is on your profile.")
            return {"content": text, "view": view}
        rows = [f"{i + 1}. {_who(people, r['id'])} — {r['w']}–{r['l']}" for i, r in enumerate(d.get("table", []))]
        champ = f"🏆 **{d['championName']}** is the champion of {season}!" if d.get("championName") \
            else f"**{season}** is over."
        return {"content": champ + "\n" + "\n".join(rows), "view": view}

    return None


# ── the cog ───────────────────────────────────────────────────────────

class League(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self._last_down = 0.0

    @commands.Cog.listener()
    async def on_ready(self):
        # Started here, not in __init__, for CardWatch's reason: build_bot()
        # never logs in, and a loop started there dies in wait_until_ready.
        # on_ready fires on every reconnect, hence the guard.
        if gameserver.client.token and not self.deliver_loop.is_running():
            self.deliver_loop.change_interval(seconds=POLL_SECONDS)
            self.deliver_loop.start()

    async def cog_unload(self):
        if self.deliver_loop.is_running():
            self.deliver_loop.cancel()

    @tasks.loop(seconds=30)
    async def deliver_loop(self):
        await self.deliver_once()

    @deliver_loop.before_loop
    async def _ready(self):
        await self.bot.wait_until_ready()

    async def deliver_once(self) -> tuple[list[int], dict]:
        """Pull, send, ack. Returns what was acked (for the test)."""
        try:
            body = await gameserver.client.league_outbox()
        except gameserver.GameServerDown as exc:
            if time.monotonic() - self._last_down > 600:   # say so once in a while, not every 30s
                print(f"[league] outbox unavailable: {exc}")
                self._last_down = time.monotonic()
            return [], {}
        base = body.get("base") or public_url()
        sent, failed = [], {}
        for row in body.get("rows", []):
            outcome = await self.deliver(row, base)
            if outcome is None:
                continue                      # transient: leave it for the next pass
            if outcome == "sent":
                sent.append(row["id"])
            else:
                failed[row["id"]] = outcome
        if sent or failed:
            try:
                await gameserver.client.league_ack(sent, failed)
            except gameserver.GameServerDown as exc:
                print(f"[league] ack failed, will resend: {exc}")
        return sent, failed

    async def deliver(self, row, base):
        """'sent', a failure reason, or None to try again later."""
        msg = render(row, base)
        if msg is None:
            return "unknown-kind"
        to = row.get("to")
        if to is None:
            return await self.to_channels(msg)
        target = REDIRECT or to.get("discordId")
        if not target:
            return "not-linked"
        if REDIRECT and to.get("discordId") != REDIRECT:
            note = f"→ *to {to.get('name')}* (league test redirect)"
            msg = {**msg, "content": f"{note}\n{msg.get('content') or ''}".strip()}
        try:
            user = await self.bot.fetch_user(int(target))
            await user.send(**msg, allowed_mentions=QUIET)
            return "sent"
        except discord.Forbidden:
            # DMs closed: say it where they will see it, and tell the organizer
            await self.to_channels({
                "content": f"<@{target}> I couldn't send you a league message — your DMs are closed to this server. "
                           "Open them (Server → Privacy settings → Direct messages) to get your pairings.",
            }, ping=int(target))
            return "dm-closed"
        except discord.NotFound:
            return "no-such-user"
        except discord.HTTPException as exc:
            print(f"[league] DM to {target} failed, will retry: {exc}")
            return None

    async def to_channels(self, msg, ping=None):
        chans = channels()
        if not chans:
            return "no-channel"
        mentions = discord.AllowedMentions(users=[discord.Object(ping)], roles=False, everyone=False) if ping else QUIET
        ok = False
        for cid in chans:
            channel = self.bot.get_channel(int(cid))
            if channel is None:
                try:
                    channel = await self.bot.fetch_channel(int(cid))
                except discord.HTTPException:
                    continue
            try:
                await channel.send(**msg, allowed_mentions=mentions)
                ok = True
            except discord.HTTPException as exc:
                print(f"[league] post to {cid} failed: {exc}")
        return "sent" if ok else None

    # ── /league ───────────────────────────────────────────────────────
    league = app_commands.Group(name="league", description="The monthly league: sign up, sit out a week, standings")

    async def _answer(self, interaction, body, ok_text):
        if body.get("ok"):
            await interaction.followup.send(ok_text, ephemeral=True)
            return
        err = body.get("error") or "that didn't work"
        if err == "not-linked":
            err = ("your Discord isn't linked to an Algomancy account yet — on the site, open your profile, "
                   "press **Link Discord**, then run `/link code` here")
        elif "usually free" in err or "hours a week" in err:
            url = league_url(public_url())
            err += f" — do it on the league page{f': {url}' if url else ''}"
        await interaction.followup.send(f"⚠️ {err[0].upper()}{err[1:]}.", ephemeral=True)

    @league.command(name="join", description="Sign up for this month's league")
    async def join(self, interaction: discord.Interaction):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.league_join(interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        await self._answer(interaction, body, "🏅 You're in! I'll message you your opponents when the week starts.")

    @league.command(name="leave", description="Leave the league (results you've played stay)")
    async def leave(self, interaction: discord.Interaction):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.league_leave(interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        await self._answer(interaction, body, "You've left the league. No more pairings will come.")

    @league.command(name="skip", description="Sit out a week before its pairings go out")
    @app_commands.describe(week="Which week", sit_out="False to play that week after all")
    async def skip(self, interaction: discord.Interaction, week: app_commands.Range[int, 1, 8], sit_out: bool = True):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.league_skip(interaction.user.id, week, sit_out)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        await self._answer(interaction, body,
                           f"You'll sit out week {week}." if sit_out else f"You're playing week {week}.")

    @league.command(name="status", description="Your league matches this week")
    async def status(self, interaction: discord.Interaction):
        await start(interaction, private=True)
        try:
            body = await gameserver.client.league_status(interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        await interaction.followup.send(status_text(body), ephemeral=True, allowed_mentions=QUIET)

    @league.command(name="standings", description="The league table")
    async def standings(self, interaction: discord.Interaction, private: bool = False):
        await start(interaction, private=private)
        try:
            body = await gameserver.client.league_status(interaction.user.id)
        except gameserver.GameServerDown as exc:
            await fail(interaction, down_notice(exc))
            return
        await interaction.followup.send(standings_text(body), allowed_mentions=QUIET)

    @league.command(name="channel", description="Post the league's pairings and standings here (moderators)")
    @app_commands.describe(enabled="Set false to stop posting here")
    @app_commands.guild_only()
    async def channel(self, interaction: discord.Interaction, enabled: bool = True):
        # a SUBcommand cannot carry its own default_permissions, so the
        # moderator check is made here
        perms = getattr(interaction.user, "guild_permissions", None)
        if not perms or not perms.manage_guild:
            await interaction.response.send_message("Only a moderator (Manage Server) can set that.", ephemeral=True)
            return
        had = set_channel(interaction.channel_id, interaction.guild_id, interaction.user.id, enabled)
        await interaction.response.send_message(
            ("League posts will come here." if enabled else
             ("League posts will stop coming here." if had else "League posts weren't coming here.")),
            ephemeral=True)


def status_text(body) -> str:
    s = body.get("season")
    if not body.get("linked"):
        return "Your Discord isn't linked to an Algomancy account yet — link it from your profile on the site."
    if not s:
        return "There's no league season right now."
    me = s.get("me") or {}
    head = f"🏅 **{s['name']}** — {s['label']}."
    if not me.get("entered"):
        return head + " You're not in it" + (f": {me['joinProblem']}." if me.get("joinProblem") else " — `/league join`.")
    week = max([m["week"] for m in me.get("matches", [])], default=0)
    lines = []
    for m in me.get("matches", []):
        if m["week"] != week:
            continue
        r = m.get("result")
        state = ("✅ won" if m.get("won") else "lost" if m.get("won") is False
                 else "not played" if r else "to play")
        lines.append(f"• vs **{m['opponent']['name']}** — {state}")
    skips = me.get("skips") or []
    return "\n".join([head]
                     + ([f"Week {week}:"] + lines if lines else ["No matches yet — pairings come when the week starts."])
                     + ([f"Sitting out: week {', '.join(map(str, skips))}."] if skips else []))


def standings_text(body) -> str:
    s = body.get("season")
    if not s:
        return "There's no league season right now."
    rows = s.get("standings") or []
    if not rows:
        return f"🏅 **{s['name']}** — nobody has signed up yet."
    lines = [f"{r['rank']}. **{r['name']}** — {r['w']}–{r['l']} · {r['points']} pts" for r in rows[:15]]
    return f"🏅 **{s['name']}** — {s['label']}\n" + "\n".join(lines)
