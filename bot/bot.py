#!/usr/bin/env python3
"""
bot.py — Algomancy rules Discord bot (one of two front-ends over `core.py`).

This file is now the WIRING, not the commands: the bot class, the sync policy,
the components that predate the cogs, the `&` shim, and the one thing the
message-content intent is still for. Every command lives in `cogs/`.

Commands (all slash — `&` was retired 2026-09-02)
-------------------------------------------------
  /ask                RAG answer over the rules corpus, with source citations.
                      Opens a thread; type in it and the context is kept.
  /card               Card lookup by name, autocompleted. `with:` stacks a
                      graft or augment under it.
  /find               …from a DESCRIPTION instead of a name, for when you
                      remember what a card does. Local BM25, no network.
  /search             …as a FILTER, in the browser's query language:
                      `el:fire mana<=3`. Runs on the game server, because the
                      grammar lives there and must not be copied here.
  /rulings            Every community, judge and designer ruling about a card.
  /colors             suggest · log · stats — which three-colour decks to play.
  /draft              p1p1 / p1p6 practice packs, tap to pick.
  /puzzle             play · list — "What's the play?" boards, authored in the
                      web editor (app.py's /editor) and shared by both
                      front-ends, so solving one here counts as seen there.
  /link               start · code · status · remove — bind this Discord to an
                      Algomancy account, so /profile and /rating know you.
  /profile /rating /leaderboard    how you and everyone else are doing.
  /queuewatch         announce in a channel when somebody joins the queue.
  /queue              who is waiting right now.
  /feedback /help /sync

Where the rest of it is
-----------------------
  cogs/            the commands, one module per area
  discordui.py     every embed and formatter — no Bot, no Context, so it is
                   testable with no token (test/test_embeds.py freezes all 36)
  core.py          the RAG brain, shared with the web app (app.py)
  gameserver.py    the client for the digital client's game server on :5000
  pushserver.py    the loopback listener it pushes queue events back to

Setup
-----
  pip install -r requirements.txt
  cp .env.example .env      # then fill in DISCORD_TOKEN and DEEPSEEK_API_KEY
  python3 bot.py

⚠ The bot must be invited with BOTH scopes — `bot applications.commands`. With
`scope=bot` alone the tree syncs, returns 200, and no command appears anywhere.
"""

import asyncio
import functools
import time
import hashlib
import io
import json
import os
import re

import discord
from discord.ext import commands
from dotenv import load_dotenv

# Load .env before importing core, which reads DEEPSEEK_* config at import time.
load_dotenv()

import combos
import core
import gameserver
import paths
import pushserver
import draft
import mods
import store
import wtp
from core import answer_question, cards, retriever

# ⚠ TRANSITIONAL. The `&` commands below are scheduled for deletion; the slash
# versions in cogs/ are the ones that survive. So the shared pieces live over
# THERE and are imported back here, not the other way round — when this half
# goes, nothing has to move again.
from cogs.cardlookup import CardSelect
from rulings import rulings_embed_for

# The drawing half, split out of this file: embeds, icon substitution and the
# small formatters. Nothing in there touches a Bot or a Context, which is what
# lets test/test_embeds.py freeze every embed without a Discord token.
from discordui import (EMOJI, FEEDBACK_KINDS, MAX_CARDS, SEARCH_RESULTS,
                       _bare, _draft_file, _render, _ruling_snippet,
                       _slots_str, answer_embed, build_card_embed,
                       build_combo_embed, cited_card_files, confirmation,
                       draft_embed, search_results_field, solution_embed,
                       stats_embed, suggestion_embed, wtp_embed)

PREFIX = "&"

# ── which guild gets the commands, and how fast ───────────────────────
#
# A guild-scoped sync lands INSTANTLY; a global one can take up to an hour to
# propagate. So a dev box sets ALGO_DEV_GUILD and iterates, and the deploy
# syncs globally, which is what reaches the Algomancy community server.
#
# ⚠ ALGO_DEV_GUILD MUST NOT BE SET ON THE DEPLOY BOX. `copy_global_to` makes
# guild-scoped COPIES of every command; once a global sync has propagated, a
# guild holding copies as well shows every command TWICE. That is the classic
# slash-deploy bug and the only thing preventing it is this variable staying
# laptop-only.
DEV_GUILD = os.getenv("ALGO_DEV_GUILD", "").strip()


def tree_signature(tree) -> str:
    """A hash of the command tree exactly as Discord will receive it.

    ⚠ WHY A GLOBAL SYNC IS NOT UNCONDITIONAL. bot.py runs under systemd with
    Restart=always. An unconditional `tree.sync()` in setup_hook plus any crash
    at boot is a global-sync loop against a rate limit that is not generous,
    and the symptom is a bot that cannot start at all. So the deploy syncs only
    when the tree has actually CHANGED — same trick core.py uses to version the
    engine, over `to_dict()` because that is the payload, not the source.
    """
    payload = sorted(json.dumps(c.to_dict(tree), sort_keys=True)
                     for c in tree.get_commands())
    return hashlib.sha256("\n".join(payload).encode()).hexdigest()[:12]


class AlgoBot(commands.Bot):
    """The bot, with cog loading and the sync policy in one place.

    Constructing it does not connect, does not sync and needs no token — which
    is what lets test/test_slash.py read the whole command tree offline. That
    matters more here than it looks: a single bad command name makes Discord
    reject the ENTIRE sync, and the symptom is not an error, it is no commands
    at all.
    """

    async def setup_hook(self):
        await load_cogs(self)
        await self.sync_tree()
        await self.start_push_listener()

    async def start_push_listener(self):
        """Take queue events from the game server, if this deploy wants them.

        ⚠ Started here rather than in build_bot(): a test builds a bot and must
        not bind a port for it. Without ALGO_BOT_TOKEN nothing starts at all —
        the feature is absent rather than unprotected."""
        cog = self.get_cog("QueueWatch")
        if cog is None:
            return
        self._push_runner = await pushserver.start(cog.on_event)

    async def close(self):
        runner = getattr(self, "_push_runner", None)
        if runner is not None:
            await runner.cleanup()
        await gameserver.client.close()
        await super().close()

    async def sync_tree(self):
        if DEV_GUILD:
            guild = discord.Object(id=int(DEV_GUILD))
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            print(f"[slash] synced {len(synced)} commands to guild {DEV_GUILD} (instant)")
            return
        sig = tree_signature(self.tree)
        stamp = paths.tree_sig_file()
        was = stamp.read_text().strip() if stamp.exists() else ""
        if was == sig:
            print(f"[slash] tree unchanged ({sig}) — no global sync")
            return
        synced = await self.tree.sync()
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(sig + "\n")
        print(f"[slash] synced {len(synced)} commands globally ({was or 'none'} -> {sig}); "
              "may take up to an hour to appear")


async def load_cogs(b):
    """Every cog, loaded onto `b`. Plain add_cog rather than load_extension:
    the extension machinery exists for hot reload, which Restart=always makes
    beside the point, and it would make this harder to call from a test."""
    from cogs.account import Account
    from cogs.cardlookup import CardLookup
    from cogs.judge import Judge
    from cogs.play import Play
    from cogs.puzzle import Puzzle
    from cogs.meta import Meta
    from cogs.queuewatch import QueueWatch
    for cog in (CardLookup, Judge, Play, Puzzle, Meta, QueueWatch, Account):
        if b.get_cog(cog.__name__) is None:
            await b.add_cog(cog(b))


async def build_bot() -> "AlgoBot":
    """Construct the bot and load every cog. Does NOT connect, does NOT sync,
    needs no token and no API key. This is the entry point every test uses."""
    b = AlgoBot(command_prefix=PREFIX, intents=_intents(), help_command=None)
    register_legacy_items(b)
    await load_cogs(b)
    return b


def _intents():
    i = discord.Intents.default()
    # ⚠ STILL PRIVILEGED, AND STILL NEEDED. After the slash migration this
    # intent has exactly one job left: plain messages typed inside an /ask
    # thread are follow-ups that keep their context. Slash commands and
    # buttons carry their own text and need none of it.
    i.message_content = True
    return i


intents = _intents()
bot = AlgoBot(command_prefix=PREFIX, intents=intents, help_command=None)

# thread_id -> clean conversation history [{role, content}] (no big context blobs)
THREADS: dict[int, list[dict]] = {}




class FeedbackButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"fb:(?P<rating>good|weird|bad):(?P<rid>[0-9a-f]+)"):

    def __init__(self, rating: str, rid: str):
        label, emoji, style, _ = FEEDBACK_KINDS[rating]
        super().__init__(discord.ui.Button(
            label=label, emoji=emoji, style=style,
            custom_id=f"fb:{rating}:{rid}",
        ))
        self.rating = rating
        self.rid = rid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["rating"], match["rid"])

    async def callback(self, interaction: discord.Interaction):
        store.log_feedback(self.rid, self.rating, interaction.user.id)
        word = FEEDBACK_KINDS[self.rating][3]
        await interaction.response.send_message(
            f"Thanks — recorded this answer as **{word}**.", ephemeral=True)


def feedback_view(rid: str) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    for rating in FEEDBACK_KINDS:
        view.add_item(FeedbackButton(rating, rid))
    return view


# Make feedback buttons survive restarts: register the dynamic item once so
# clicks on old messages are still routed to FeedbackButton.callback.




async def post_cited_cards(channel, answer, hits):
    """Post images of any cited cards into a thread/channel (no-op if none)."""
    files = cited_card_files(answer, hits)
    if files:
        await channel.send(content="**Cited cards** (referenced above):", files=files)























































def record_game(combo, user_id, channel_id):
    """Log a played combo for one person. Returns (recorded, coverage-after).

    `recorded` is False when they already logged this combo in the last few hours
    (a double-tapped button), in which case nothing is written.
    """
    games = store.read_games(user_id)
    if combos.logged_recently(games, combo):
        return False, combos.coverage(games)
    store.log_game(combo, user_id, channel_id=channel_id, source="discord")
    return True, combos.coverage(store.read_games(user_id))




def combo_view(user_id, combo) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(PlayedButton(combos.key(combo)))
    view.add_item(RerollButton(str(user_id), combos.key(combo)))
    return view


# Like the feedback buttons, these carry their state in the custom_id (a combo
# key such as "fire-earth-wood"), so they keep working across bot restarts.

class PlayedButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"co:played:(?P<key>[a-z\-]+)"):

    def __init__(self, key: str):
        super().__init__(discord.ui.Button(
            label="We played this", emoji="✅",
            style=discord.ButtonStyle.success, custom_id=f"co:played:{key}"))
        self.key = key

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["key"])

    async def callback(self, interaction: discord.Interaction):
        try:
            combo = combos.from_key(self.key)
        except combos.ComboError as exc:      # stale button from an older colour set
            await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
            return
        recorded, cov = record_game(combo, interaction.user.id, interaction.channel_id)
        await interaction.response.send_message(
            confirmation(combo, recorded, cov), ephemeral=True)


class RerollButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"co:roll:(?P<uid>\d+):(?P<key>[a-z\-]+)"):

    def __init__(self, uid: str, key: str):
        super().__init__(discord.ui.Button(
            label="Re-roll", emoji="🎲",
            style=discord.ButtonStyle.secondary, custom_id=f"co:roll:{uid}:{key}"))
        self.uid = uid
        self.key = key

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["uid"], match["key"])

    async def callback(self, interaction: discord.Interaction):
        user = interaction.user
        games = store.read_games(user.id)
        try:
            current = combos.from_key(self.key)
        except combos.ComboError:
            current = None                    # unknown key: just don't exclude anything
        combo, reason = combos.suggest(games, exclude=current)
        embed = suggestion_embed(user, combo, reason, combos.coverage(games))
        view = combo_view(user.id, combo)
        # Only the person the suggestion was made for edits it in place; anyone
        # else gets their own suggestion, drawn from their own history, privately.
        if str(user.id) == self.uid:
            await interaction.response.edit_message(embed=embed, view=view)
        else:
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)











# --- pack-1-pick-X draft practice ----------------------------------------
# `&p1p1` / `&p1p6` post a reproducible pack as one numbered image with a row of
# tap-to-pick buttons, and open a discussion thread. Each person's picks are kept
# privately (per message, per user); the moment someone completes a set, their
# picks are rendered as an image into the thread. Everything replays from the seed
# shown on the embed, so a pack can be shared, saved, or sent to a friend.

# (message_id, user_id) -> that person's ordered slot picks, and the last set we
# posted for them (so re-completing the same picks doesn't spam the thread).
# In-memory like THREADS: a restart forgets in-progress picks, but every button
# carries the pack's code, so the pack itself is always rebuildable.
DRAFT_PICKS: dict[tuple[int, int], list[int]] = {}
DRAFT_POSTED: dict[tuple[int, int], frozenset] = {}












# Like the feedback/combo buttons, these carry their state (the pack's code and the
# slot number) in the custom_id, so they keep working across bot restarts.

class PickButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"dp:(?P<slot>\d+):(?P<code>.+)"):

    def __init__(self, slot, code, row=0):
        super().__init__(discord.ui.Button(
            label=str(slot), style=discord.ButtonStyle.secondary,
            custom_id=f"dp:{slot}:{code}", row=row))
        self.slot = int(slot)
        self.code = code

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["slot"]), match["code"])

    async def callback(self, interaction):
        await handle_pick(interaction, self.code, self.slot)


class PickClearButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"dpx:(?P<code>.+)"):

    def __init__(self, code):
        super().__init__(discord.ui.Button(
            label="Clear my picks", emoji="🧹",
            style=discord.ButtonStyle.danger, custom_id=f"dpx:{code}", row=4))
        self.code = code

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["code"])

    async def callback(self, interaction):
        key = (interaction.message.id, interaction.user.id)
        DRAFT_PICKS.pop(key, None)
        DRAFT_POSTED.pop(key, None)
        await interaction.response.send_message(
            "🧹 Cleared your picks — tap the cards to start again.", ephemeral=True)




def pick_view(pack):
    view = discord.ui.View(timeout=None)
    per_row = 4 if len(pack.slots) > 12 else 5      # 4×4 for 16, 5×2 for 10
    for slot in range(1, len(pack.slots) + 1):
        view.add_item(PickButton(slot, pack.code, row=(slot - 1) // per_row))
    view.add_item(PickClearButton(pack.code))
    return view


async def handle_pick(interaction, code, slot):
    try:
        pack = draft.pack_from_code(code)
    except draft.DraftError:
        await interaction.response.send_message(
            "⚠️ I couldn't read this pack's code — it may be from an older version.",
            ephemeral=True)
        return

    key = (interaction.message.id, interaction.user.id)
    picks = DRAFT_PICKS.setdefault(key, [])
    if slot in picks:
        picks.remove(slot)                          # tap again to unpick
    elif len(picks) >= pack.picks:
        await interaction.response.send_message(
            f"You've already got your {pack.picks} ({_slots_str(picks)}). "
            "Tap one of those to swap it out first.", ephemeral=True)
        return
    else:
        picks.append(slot)

    if len(picks) == pack.picks:
        chosen = frozenset(picks)
        if DRAFT_POSTED.get(key) != chosen:         # avoid re-posting the same set
            DRAFT_POSTED[key] = chosen
            png = await _render(draft.render_picks_image, pack, list(picks))
            target = interaction.message.thread or interaction.channel
            try:
                await target.send(
                    content=f"🎴 **{interaction.user.display_name}'s picks** "
                            f"(`{pack.code}`) — slots {_slots_str(picks)}",
                    file=_draft_file(png, "picks.png"))
            except discord.HTTPException:
                pass
        await interaction.response.send_message(
            f"✅ That's your {pack.picks} ({_slots_str(picks)}) — posted to the "
            "thread. Tap any card to change your mind.", ephemeral=True)
    else:
        need = pack.picks - len(picks)
        await interaction.response.send_message(
            f"Picked {_slots_str(picks)} — **{len(picks)}/{pack.picks}**. "
            f"Choose {need} more.", ephemeral=True)








# --- "What's the play?" puzzles ------------------------------------------
# `&wtp` posts a board someone designed in the web editor, with the question, and
# opens a thread to argue about it in. The answer is revealed privately (an
# ephemeral message, so one person checking themselves doesn't spoil the thread
# for everyone else) — or deliberately to the whole thread, once the discussion
# has run its course.
#
# Which puzzles you've seen is remembered per Discord user, so a bare `&wtp` keeps
# handing you new ones. It's the same log the website writes, keyed on the same
# ids, so a puzzle you solved on the site won't come back at you in Discord.

# (message_id, user_id) -> how many hints that person has asked for. In-memory
# like DRAFT_PICKS: a restart just means hints start from the top again.
WTP_HINTS: dict[tuple[int, int], int] = {}







class RevealButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"wr:(?P<pid>wtp-[0-9A-Z]+)"):

    def __init__(self, pid):
        super().__init__(discord.ui.Button(
            label="Reveal the answer", emoji="🔑",
            style=discord.ButtonStyle.primary, custom_id=f"wr:{pid}"))
        self.pid = pid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["pid"])

    async def callback(self, interaction):
        try:
            p = wtp.load(self.pid)
        except wtp.PuzzleError as exc:
            await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
            return
        store.log_wtp(p.id, "revealed", interaction.user.id,
                      channel_id=interaction.channel_id, source="discord")
        # Ephemeral: one person checking their answer mustn't spoil it for
        # everyone else still thinking. "Post to thread" is the deliberate way to
        # put it in front of the room.
        await interaction.response.send_message(
            embed=solution_embed(p), view=PostSolutionView(p.id), ephemeral=True)


class HintButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"wh:(?P<pid>wtp-[0-9A-Z]+)"):

    def __init__(self, pid):
        super().__init__(discord.ui.Button(
            label="Hint", emoji="💡",
            style=discord.ButtonStyle.secondary, custom_id=f"wh:{pid}"))
        self.pid = pid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["pid"])

    async def callback(self, interaction):
        try:
            p = wtp.load(self.pid)
        except wtp.PuzzleError as exc:
            await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
            return
        if not p.hints:
            await interaction.response.send_message(
                "No hints for this one — you're on your own. 🙂", ephemeral=True)
            return
        key = (interaction.message.id, interaction.user.id)
        i = WTP_HINTS.get(key, 0)
        if i >= len(p.hints):
            await interaction.response.send_message(
                "That's every hint I've got. Hit 🔑 when you want the answer.",
                ephemeral=True)
            return
        WTP_HINTS[key] = i + 1
        store.log_wtp(p.id, "hint", interaction.user.id,
                      channel_id=interaction.channel_id, source="discord")
        await interaction.response.send_message(
            f"💡 **Hint {i + 1}/{len(p.hints)}** — {p.hints[i]}", ephemeral=True)


class PostSolutionButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"wp:(?P<pid>wtp-[0-9A-Z]+)"):
    """On the ephemeral reveal: put the answer in front of the whole thread."""

    def __init__(self, pid):
        super().__init__(discord.ui.Button(
            label="Post the answer to the thread", emoji="📣",
            style=discord.ButtonStyle.secondary, custom_id=f"wp:{pid}"))
        self.pid = pid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["pid"])

    async def callback(self, interaction):
        try:
            p = wtp.load(self.pid)
        except wtp.PuzzleError as exc:
            await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
            return
        # The ephemeral message this button sits on has no thread of its own, so
        # post to the channel we're in — inside a puzzle thread, that IS the thread.
        target = interaction.channel
        try:
            await target.send(
                content=f"📣 **{interaction.user.display_name}** revealed the answer "
                        f"to **{p.title}**:",
                embed=solution_embed(p))
        except discord.HTTPException:
            await interaction.response.send_message(
                "I couldn't post here.", ephemeral=True)
            return
        await interaction.response.send_message("📣 Posted.", ephemeral=True)


class PostSolutionView(discord.ui.View):
    def __init__(self, pid):
        super().__init__(timeout=None)
        self.add_item(PostSolutionButton(pid))




class NextPuzzleButton(
        discord.ui.DynamicItem[discord.ui.Button],
        template=r"wn:(?P<pid>wtp-[0-9A-Z]+)"):
    """Serve the clicker a puzzle they haven't seen — theirs, not the poster's."""

    def __init__(self, pid):
        super().__init__(discord.ui.Button(
            label="Another puzzle", emoji="➡️",
            style=discord.ButtonStyle.secondary, custom_id=f"wn:{pid}"))
        self.pid = pid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["pid"])

    async def callback(self, interaction):
        await interaction.response.defer()
        await send_puzzle(interaction.channel, interaction.user,
                          exclude=self.pid, reply_to=None)




def wtp_view(p):
    view = discord.ui.View(timeout=None)
    view.add_item(RevealButton(p.id))
    if p.hints:
        view.add_item(HintButton(p.id))
    view.add_item(NextPuzzleButton(p.id))
    return view


async def send_puzzle(channel, user, *, puzzle=None, exclude=None, reply_to=None,
                      followup=None):
    """Post a puzzle: the board image, the question, and the buttons. Opens a
    thread so people can argue about it without spoiling the answer.

    Three ways in, because there are three callers: `reply_to` for a prefix
    command replying to a message, `followup` for a slash command that has
    already deferred (⚠ it must be answered through its followup or the user
    is left with a spinner), and plain `channel.send` for the "Another puzzle"
    button, which has neither.
    """
    if puzzle is None:
        puzzles = wtp.load_all()
        if not puzzles:
            note = "No puzzles yet — build one in the web editor (`/editor`)."
            await (followup.send(note) if followup else channel.send(note))
            return
        puzzle, _why = wtp.pick_next(puzzles, store.wtp_seen(user.id), exclude=exclude)

    store.log_wtp(puzzle.id, "served", user.id,
                  channel_id=getattr(channel, "id", None), source="discord")
    png = await _render(wtp.render_board_image, puzzle, cards)
    if followup:
        # wait=True so a Message comes back — the thread below needs one.
        send = functools.partial(followup.send, wait=True)
    else:
        send = reply_to.reply if reply_to else channel.send
    msg = await send(embed=wtp_embed(puzzle),
                     file=discord.File(io.BytesIO(png), filename="board.png"),
                     view=wtp_view(puzzle))
    try:
        thread = await msg.create_thread(
            name=f"WTP · {puzzle.title}"[:90], auto_archive_duration=1440)
        await thread.send(
            "🧵 **What's the play?** Work it out here — say what you'd do and why. "
            "🔑 shows you the answer privately (so you can check yourself without "
            "spoiling it for anyone else), and there's a 📣 button on that to put "
            "it in front of the thread when everyone's had a go.")
    except discord.HTTPException:
        pass  # DMs, or somewhere threads aren't allowed








# --- thread follow-ups ---------------------------------------------------

@bot.event
async def on_message(message: discord.Message):
    """The one thing the privileged message-content intent is still for.

    ⚠ EVERYTHING ELSE IS A SLASH COMMAND NOW. What survives here is thread
    follow-ups: `/ask` opens a thread, and plain typing in it continues the
    conversation with its context. That cannot be a slash command without
    making people retype `/ask` every turn, and it cannot be a button without
    making them click before they type — so the intent stays, doing exactly
    this and nothing else.

    …plus the `&` shim, which is temporary. Somebody with five months of
    muscle memory should be told where their command went, once, rather than
    typing into silence. Delete LEGACY and this branch a month after the flip.
    """
    if message.author.bot:
        return

    if (isinstance(message.channel, discord.Thread)
            and message.channel.id in THREADS
            and message.content.strip()
            and not message.content.startswith(PREFIX)):
        history = THREADS[message.channel.id]
        async with message.channel.typing():
            try:
                answer, hits, reasoning = await answer_question(message.content, history)
            except Exception as exc:
                await message.reply(f"⚠️ Couldn't reach the model: `{exc}`")
                return
        rid = store.new_response_id()
        store.log_response(rid, "followup", message.content, answer, hits, core.DEEPSEEK_MODEL,
                           user_id=message.author.id, channel_id=message.channel.parent_id,
                           thread_id=message.channel.id, history=list(history),
                           reasoning=reasoning, engine_version=core.ENGINE_VERSION)
        history.append({"role": "user", "content": message.content})
        history.append({"role": "assistant", "content": answer})
        await message.reply(embed=answer_embed(message.content, answer, hits, reasoning),
                            view=feedback_view(rid))
        await post_cited_cards(message.channel, answer, hits)
        return

    if message.content.startswith(PREFIX):
        await _legacy_pointer(message)


# ── the `&` shim ──────────────────────────────────────────────────────
#
# ⚠ THE TABLE MUST COVER EVERY NAME AND ALIAS THAT EVER WORKED, or somebody
# types `&raq` and gets nothing at all — which is worse than the old command
# still being there. test_slash.py asserts it against the slash tree.
#
# Deliberately not a redirect: running the slash version on their behalf would
# teach them nothing and leave them typing `&` forever.
LEGACY = {
    "ask": "ask",
    "card": "card",
    "search": "find", "find": "find",
    "ruling": "rulings", "rulings": "rulings", "raq": "rulings",
    "colors": "colors suggest", "colours": "colors suggest", "combo": "colors suggest",
    "played": "colors log",
    "p1p1": "draft", "p1p6": "draft",
    "wtp": "puzzle play", "puzzle": "puzzle play", "whatstheplay": "puzzle play",
    "feedback": "feedback",
    "help": "help",
}

# Who has already been told, and when. In memory: a restart forgetting costs
# one extra reminder, and a file for a one-hour value is a file too many.
_TOLD: dict[int, float] = {}
_TELL_AGAIN_AFTER = 3600.0


async def _legacy_pointer(message):
    """Say where a `&` command went — once an hour per person, at most."""
    word = message.content[len(PREFIX):].split(None, 1)[0].lower() if \
        message.content[len(PREFIX):].strip() else ""
    slash = LEGACY.get(word)
    if not slash:
        return                      # not one of ours; say nothing at all
    now = time.monotonic()
    if now - _TOLD.get(message.author.id, -1e9) < _TELL_AGAIN_AFTER:
        return
    _TOLD[message.author.id] = now
    try:
        await message.reply(
            f"`{PREFIX}{word}` is **/{slash}** now — type `/` and it will come up. "
            "Everything moved to slash commands: they autocomplete, they work in "
            "DMs, and I no longer have to read every message in the server to "
            "find them.",
            mention_author=False)
    except discord.HTTPException:
        pass


# ── the components that still live in this file ───────────────────────
#
# ⚠ REGISTERED IN A FUNCTION, NOT AT IMPORT. These used to be four
# `bot.add_dynamic_items(...)` calls scattered next to their classes, which
# bound them to the module-level `bot` and to nothing else — so `build_bot()`
# returned a bot with NINE DEAD BUTTONS and no error anywhere. A component that
# is not registered does not raise; the click just fails, remotely, for the
# person who clicked it.
#
# The cogs register their own in `cog_load`. This is the legacy half, and it
# goes away with the `&` commands.
LEGACY_ITEMS = (FeedbackButton, PlayedButton, RerollButton, PickButton,
                PickClearButton, RevealButton, HintButton, PostSolutionButton,
                NextPuzzleButton)


def register_legacy_items(b):
    b.add_dynamic_items(*LEGACY_ITEMS)


register_legacy_items(bot)


@bot.event
async def on_ready():
    # Cache custom emojis from every guild the bot is in, by name, for card icons.
    EMOJI.update({e.name: str(e) for e in bot.emojis})
    print(f"Logged in as {bot.user} · model={core.DEEPSEEK_MODEL} · "
          f"{len(retriever.rows)} chunks, {len(cards.names)} cards, "
          f"{len(EMOJI)} custom emojis loaded")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Run the Algomancy rules Discord bot.",
        epilog="Example: python3 bot.py <DEEPSEEK_API_KEY> <DISCORD_TOKEN>")
    ap.add_argument("deepseek_key", nargs="?",
                    help="DeepSeek API key (overrides the DEEPSEEK_API_KEY env var)")
    ap.add_argument("discord_token", nargs="?",
                    help="Discord bot token (overrides the DISCORD_TOKEN env var)")
    ap.add_argument("--model", help=f"DeepSeek model id (default: {core.DEEPSEEK_MODEL})")
    args = ap.parse_args()

    deepseek_key = args.deepseek_key or os.getenv("DEEPSEEK_API_KEY")
    token = args.discord_token or os.getenv("DISCORD_TOKEN")
    if not deepseek_key or not token:
        raise SystemExit(
            "Usage: python3 bot.py <DEEPSEEK_API_KEY> <DISCORD_TOKEN>\n"
            "(either value may instead come from DEEPSEEK_API_KEY / DISCORD_TOKEN env vars).")

    core.init_client(deepseek_key, model=args.model)
    bot.run(token)
