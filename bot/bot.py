#!/usr/bin/env python3
"""
bot.py — Algomancy rules Discord bot (one of two front-ends over `core.py`).

Commands
--------
  &ask <question>     RAG answer over the rules corpus, with source citations.
                      Opens a thread; ask follow-ups there and context is kept.
  &card <name>        Fuzzy-matched card lookup with art, stats, and rulings.
  &search <text>      The same card lookup, but from a DESCRIPTION instead of a
                      name — for when you remember what a card does, not what
                      it's called. Ranks the whole set and shows the best match.
  &colors             Suggest a fresh 3-colour deck; ✅ to record that you played it.
  &played <colors>    Record a combo you played, e.g. `&played fire earth wood`.
  &p1p1 / &p1p6       Draft practice: a reproducible pack, tap to pick.
  &wtp [id]           "What's the play?" — a designed board + a question, with a
                      thread to work it out in and a private 🔑 reveal. Puzzles are
                      built in the web editor (app.py's /editor) and shared by both
                      front-ends, so what you solve here counts as seen there.
  &feedback [text]    Share feedback about the bot.

The RAG brain (retrieval, primer, DeepSeek call, citations) lives in `core.py`
and is shared with the web app (`app.py`); this file is only the Discord layer.

Setup
-----
  pip install -r requirements.txt
  cp .env.example .env      # then fill in DISCORD_TOKEN and DEEPSEEK_API_KEY
  python3 bot.py
"""

import asyncio
import io
import os
import re

import discord
from discord.ext import commands
from dotenv import load_dotenv

# Load .env before importing core, which reads DEEPSEEK_* config at import time.
load_dotenv()

import combos
import core
import draft
import mods
import store
import wtp
from core import answer_question, cards, retriever

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

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents, help_command=None)

# thread_id -> clean conversation history [{role, content}] (no big context blobs)
THREADS: dict[int, list[dict]] = {}
# thread ids opened by `&feedback` (no args); messages in them are logged as
# general feedback. In-memory like THREADS, so it resets on restart — the
# `&feedback <text>` form always works regardless.
FEEDBACK_THREADS: set[int] = set()




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
bot.add_dynamic_items(FeedbackButton)




async def post_cited_cards(channel, answer, hits):
    """Post images of any cited cards into a thread/channel (no-op if none)."""
    files = cited_card_files(answer, hits)
    if files:
        await channel.send(content="**Cited cards** (referenced above):", files=files)




# --- commands ------------------------------------------------------------

@bot.command(name="ask")
async def ask_cmd(ctx, *, question: str = None):
    if not question:
        await ctx.reply("Usage: `&ask <your rules question>`")
        return
    async with ctx.typing():
        try:
            answer, hits, reasoning = await answer_question(question, history=[])
        except Exception as exc:  # surface API/auth errors instead of silent failure
            await ctx.reply(f"⚠️ Couldn't reach the model: `{exc}`")
            return

    rid = store.new_response_id()
    store.log_response(rid, "ask", question, answer, hits, core.DEEPSEEK_MODEL,
                       user_id=ctx.author.id, channel_id=ctx.channel.id,
                       reasoning=reasoning, engine_version=core.ENGINE_VERSION)
    reply = await ctx.reply(embed=answer_embed(question, answer, hits, reasoning),
                            view=feedback_view(rid))

    # Open a thread for follow-ups and seed it with this turn's context.
    try:
        thread = await reply.create_thread(name=question[:90], auto_archive_duration=60)
        THREADS[thread.id] = [
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ]
        await thread.send("🧵 Ask follow-up questions in this thread — I'll keep the context.")
        await post_cited_cards(thread, answer, hits)
    except discord.HTTPException:
        pass  # e.g. in DMs / threads where sub-threads aren't allowed























class CardSelect(discord.ui.DynamicItem[discord.ui.Select], template=r"cardsel:v1"):
    """Dropdown of the other cards a search matched; picking one shows it in full.

    Persistent across restarts, and cheaply so: the option's *value* is the card
    name, and Discord sends the message's options back with the interaction. So
    the callback needs to remember nothing about the search that built it — it
    just looks the chosen name up, exactly as `&card` would.
    """

    def __init__(self, hits):
        super().__init__(discord.ui.Select(
            custom_id="cardsel:v1",
            placeholder="Not the one? Pick another match…",
            options=[
                discord.SelectOption(
                    label=h.name[:100],
                    value=h.name[:100],
                    description=_bare(h.snippet(90))[:100] or None,
                    emoji=FACTION_EMOJI.get(next(iter(cards.factions(h.card)), ""), None),
                )
                for h in hits[:25]
            ],
        ))

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        # The options come back on the message itself, and the pick arrives in
        # `values` — so an empty item here is enough to service the callback.
        return cls([])

    async def callback(self, interaction: discord.Interaction):
        name = self.item.values[0]
        card, matched, _alts = cards.lookup(name)
        if not card:
            await interaction.response.send_message(
                f"I can't find **{name}** any more.", ephemeral=True)
            return
        embed, file = build_card_embed(card, matched, [], attach_name="card.jpg")
        embed.set_author(name="🔍 from your search")
        # Swap the shown card in place, keeping the dropdown so you can keep
        # browsing the same result set. attachments= replaces the old art (and
        # clears it for a card that has none).
        await interaction.response.edit_message(
            embed=embed, attachments=[file] if file else [])


bot.add_dynamic_items(CardSelect)




@bot.command(name="search", aliases=["find"])
async def search_cmd(ctx, *, query: str = None):
    if not query:
        await ctx.reply(
            "Usage: `&search <what you remember>` — I'll find the card from a "
            "description, so you don't need the name.\n"
            "e.g. `&search wood unit that draws a card when it dies` · "
            "`&search counter a spell` · `&search 2/1 fire unit with haste`")
        return

    hits = cards.search(query, limit=SEARCH_RESULTS)
    if not hits:
        await ctx.reply(
            f"Nothing matched **{query}**. Try describing what the card *does* "
            "(“deals damage to every unit”, “recall a unit from the bin”), or "
            "look it up by name with `&card`.")
        return

    top, rest = hits[0], hits[1:]
    embed, file = build_card_embed(top.card, top.name, [], attach_name="card.jpg")
    embed.set_author(name=f"🔍 search: {query}"[:256])
    if rest:
        body, shown = search_results_field(rest)
        if shown:
            embed.add_field(name=f"Other matches ({shown})", value=body, inline=False)
    view = discord.ui.View(timeout=None)
    view.add_item(CardSelect(hits))          # every hit, incl. the one shown
    await ctx.reply(embed=embed, file=file, view=view)


@bot.command(name="card")
async def card_cmd(ctx, *, name: str = None):
    if not name:
        await ctx.reply("Usage: `&card <card name>`  ·  several: `&card Name1, Name2` "
                        "·  grafted/augmented: `&card General Smof + Spectrogenesis`")
        return

    # No card name contains a comma, so it's a safe separator for multi-lookup.
    queries = [q.strip() for q in name.split(",") if q.strip()]
    if len(queries) > MAX_CARDS:
        await ctx.reply(f"That's {len(queries)} cards — I can only show {MAX_CARDS} at once. "
                        f"Showing the first {MAX_CARDS}.")
        queries = queries[:MAX_CARDS]

    embeds, files, not_found, illegal = [], [], [], []
    for i, q in enumerate(queries):
        # No card name contains a '+' either, so it unambiguously means "stack these".
        if "+" in q:
            try:
                combo = mods.build(q, cards)
            except mods.ComboError as exc:
                illegal.append(str(exc))
                continue
            embed, file = build_combo_embed(combo, attach_name=f"card{i}.jpg")
        else:
            card, matched, alts = cards.lookup(q)
            if not card:
                not_found.append(q)
                continue
            embed, file = build_card_embed(card, matched, alts, attach_name=f"card{i}.jpg")
        embeds.append(embed)
        if file:
            files.append(file)

    notes = illegal[:]
    if not_found:
        notes.append("Couldn't find: " + ", ".join(f"**{n}**" for n in not_found))

    if not embeds:
        await ctx.reply("\n".join(notes) or f"No card found matching **{name}**.")
        return
    await ctx.reply(content="\n".join(notes) or None, embeds=embeds, files=files)


# --- rulings lookup -------------------------------------------------------
# `&ruling <card>` lists every community/judge/designer ruling that mentions a
# card, straight from the corpus (no LLM). Rulings are tagged with their cards
# at build time (build_rulings._detect_cards), so this is a plain filter.

_PART_RE = re.compile(r"\s*\(part \d+\)\s*$")
_AUTH_LABEL = {0: "🟣 Discord ruling", 1: "🔵 Judge write-up", 2: "⚪ Community"}




def find_card_rulings(matched_name):
    """Ruling rows that mention `matched_name`, deduped by thread, best-authority first."""
    word = re.compile(rf"(?<!\w){re.escape(matched_name)}(?!\w)")
    best = {}
    for r in retriever.rows:
        if r["source_type"] != "ruling":
            continue
        md = r.get("metadata", {})
        if matched_name not in md.get("cards", []) and not word.search(r["text"]):
            continue
        base = r["id"].split("#")[0]                       # collapse multi-part threads
        if base not in best or r["authority"] < best[base]["authority"]:
            best[base] = r
    rows = list(best.values())
    rows.sort(key=lambda r: (r["authority"], r["title"]))
    return rows


@bot.command(name="ruling", aliases=["rulings", "raq"])
async def ruling_cmd(ctx, *, name: str = None):
    if not name:
        await ctx.reply("Usage: `&ruling <card name>` — lists judge/designer rulings that mention a card.")
        return

    card, matched, alts = cards.lookup(name)
    if not card:
        hint = f" Did you mean: {', '.join(alts)}?" if alts else ""
        await ctx.reply(f"No card found matching **{name}**.{hint}")
        return

    hits = find_card_rulings(matched)
    if not hits:
        msg = f"No rulings mention **{matched}** yet."
        if alts:
            msg += f"  (Close names: {', '.join(alts)}.)"
        await ctx.reply(msg)
        return

    e = discord.Embed(
        title=f"⚖️ Rulings mentioning {matched}",
        color=0x5865F2,
        description=f"{len(hits)} thread{'s' if len(hits) != 1 else ''} found · highest authority first",
    )
    for r in hits[:10]:
        title = _PART_RE.sub("", r["title"])
        md = r.get("metadata", {})
        label = _AUTH_LABEL.get(r["authority"], "ruling")
        url = md.get("url")
        who = md.get("answered_by") or ""
        date = md.get("date") or ""
        link = f"\n[full thread →]({url})" if url else ""
        foot = " · ".join(x for x in (who, date) if x)
        value = f"{_ruling_snippet(r)}{link}"
        if foot:
            value += f"\n*{foot}*"
        e.add_field(name=f"{label} · {title}"[:256], value=value[:1024], inline=False)
    if len(hits) > 10:
        e.set_footer(text=f"…and {len(hits) - 10} more. Ask `&ask` for a specific interaction.")
    await ctx.reply(embed=e)












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


bot.add_dynamic_items(PlayedButton, RerollButton)

STATS_WORDS = {"stats", "history", "list", "coverage"}


async def log_played(ctx, text):
    """Shared by `&played <colors>` and `&colors <colors>`."""
    try:
        combo = combos.parse_combo(text)
    except combos.ComboError as exc:
        await ctx.reply(f"⚠️ {exc}")
        return
    recorded, cov = record_game(combo, ctx.author.id, ctx.channel.id)
    await ctx.reply(confirmation(combo, recorded, cov))


@bot.command(name="colors", aliases=["colours", "combo"])
async def colors_cmd(ctx, *, arg: str = None):
    arg = (arg or "").strip()

    if arg.lower() in STATS_WORDS:
        await ctx.reply(embed=stats_embed(ctx.author, combos.coverage(store.read_games(ctx.author.id))))
        return
    if arg:  # `&colors fire earth wood` — an explicit log, same as `&played`
        await log_played(ctx, arg)
        return

    games = store.read_games(ctx.author.id)
    combo, reason = combos.suggest(games)
    await ctx.reply(embed=suggestion_embed(ctx.author, combo, reason, combos.coverage(games)),
                    view=combo_view(ctx.author.id, combo))


@bot.command(name="played")
async def played_cmd(ctx, *, text: str = None):
    if not text:
        await ctx.reply("Usage: `&played fire earth wood` — records a combo you've played.")
        return
    await log_played(ctx, text)


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


bot.add_dynamic_items(PickButton, PickClearButton)


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


async def run_draft(ctx, mode, seed):
    try:
        pack = draft.resolve(mode, seed)
    except draft.DraftError as exc:
        await ctx.reply(f"⚠️ {exc}")
        return
    async with ctx.typing():
        png = await _render(draft.render_pack_image, pack)
    msg = await ctx.reply(embed=draft_embed(pack),
                          file=_draft_file(png, "pack.png"), view=pick_view(pack))
    # Open a discussion thread with a neutral, human prompt (no AI take).
    try:
        thread = await msg.create_thread(
            name=f"{pack.spec.label} · {pack.code}"[:90], auto_archive_duration=1440)
        await thread.send(
            f"🧵 Pack's up — **what {pack.picks} would you keep, and why?** Tap the "
            "numbered buttons on the pack to lock in your picks and I'll post them "
            f"here. Everyone can play the same pack: `&{pack.mode} {pack.seed}`.")
    except discord.HTTPException:
        pass  # e.g. DMs / places threads aren't allowed


@bot.command(name="p1p1")
async def p1p1_cmd(ctx, *, seed: str = None):
    await run_draft(ctx, "p1p1", seed)


@bot.command(name="p1p6")
async def p1p6_cmd(ctx, *, seed: str = None):
    await run_draft(ctx, "p1p6", seed)


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


bot.add_dynamic_items(RevealButton, HintButton, PostSolutionButton, NextPuzzleButton)


def wtp_view(p):
    view = discord.ui.View(timeout=None)
    view.add_item(RevealButton(p.id))
    if p.hints:
        view.add_item(HintButton(p.id))
    view.add_item(NextPuzzleButton(p.id))
    return view


async def send_puzzle(channel, user, *, puzzle=None, exclude=None, reply_to=None):
    """Post a puzzle: the board image, the question, and the buttons. Opens a
    thread so people can argue about it without spoiling the answer."""
    if puzzle is None:
        puzzles = wtp.load_all()
        if not puzzles:
            await channel.send(
                "No puzzles yet — build one in the web editor (`/editor`).")
            return
        puzzle, _why = wtp.pick_next(puzzles, store.wtp_seen(user.id), exclude=exclude)

    store.log_wtp(puzzle.id, "served", user.id,
                  channel_id=getattr(channel, "id", None), source="discord")
    png = await _render(wtp.render_board_image, puzzle, cards)
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


@bot.command(name="wtp", aliases=["puzzle", "whatstheplay"])
async def wtp_cmd(ctx, *, arg: str = None):
    arg = (arg or "").strip()

    if arg.lower() in ("list", "ls"):
        puzzles = wtp.load_all()
        if not puzzles:
            await ctx.reply("No puzzles yet — build one in the web editor.")
            return
        seen = set(store.wtp_seen(ctx.author.id))
        lines = [
            f"{'✅' if p.id in seen else '🆕'} **{p.title}** · `{p.id}` "
            f"· {p.difficulty}" + (f" · {', '.join(p.tags)}" if p.tags else "")
            for p in puzzles[:25]]
        e = discord.Embed(
            title="🧩 What's the Play? — puzzles",
            description="\n".join(lines), color=0x5865F2)
        e.set_footer(text="&wtp <id> for a specific one · &wtp for one you haven't seen")
        await ctx.reply(embed=e)
        return

    puzzle = None
    if arg:
        try:
            puzzle = wtp.load(arg)
        except wtp.PuzzleError as exc:
            await ctx.reply(f"⚠️ {exc}")
            return

    async with ctx.typing():
        await send_puzzle(ctx.channel, ctx.author, puzzle=puzzle, reply_to=ctx.message)


@bot.command(name="help")
async def help_cmd(ctx):
    e = discord.Embed(title="Algomancy Rules Bot", color=0x5865F2, description=(
        "**`&ask <question>`** — Ask a rules question. I answer from the official "
        "rules corpus with citations, then open a thread for follow-ups.\n\n"
        "**`&card <name>`** — Look up a card (fuzzy matched) with art, stats, and rulings. "
        "Look up several at once with commas: `&card Sprouter, Overbloom, Plodding Pebble`.\n\n"
        "**`&search <description>`** — Can't remember the name? Describe the card and I'll "
        "find it: `&search wood unit that draws a card when it dies`, `&search counter a "
        "spell`, `&search 2/1 fire unit with haste`. Searches oracle text, type, keywords "
        "(“trample” finds {Piercing}), elements and stats — then shows the best match as a "
        "full card, with the runners-up in a dropdown.\n\n"
        "**`&ruling <card>`** — List the judge/designer rulings that mention a card, "
        "straight from the corpus (no AI), with links to the full threads.\n\n"
        "**`&colors`** — Suggest three colours to play, favouring combos you've never "
        "tried. Hit ✅ when you've actually played it (or `&played fire earth wood`). "
        "`&colors stats` shows how much of the game you've explored.\n\n"
        "**`&p1p1 [seed]`** — A standard 10-card pack from the whole set: which one do "
        "you take? Tap a button to lock your pick.\n\n"
        "**`&p1p6 [seed]`** — A turn-1 live-draft pile of 16 from three random elements; "
        "keep 6. Tap buttons to pick, and I'll post your picks to the thread. Add a "
        "`seed` to replay or share an exact pack.\n\n"
        "**`&wtp [id]`** — “What's the play?” Posts a board someone built, with a "
        "question (can you win this turn? what do you block?) and a thread to work it "
        "out in. 🔑 reveals the answer privately so you can check yourself. `&wtp list` "
        "shows them all; a bare `&wtp` gives you one you haven't seen.\n\n"
        "**`&feedback [text]`** — Share feedback about the bot. With text, it's logged "
        "right away; with no text I open a thread where every message you send is recorded.\n\n"
        "**`&help`** — Show this message."
    ))
    await ctx.reply(embed=e)


@bot.command(name="feedback")
async def feedback_cmd(ctx, *, text: str = None):
    if text:
        store.log_general_feedback(text, ctx.author.id, channel_id=ctx.channel.id)
        await ctx.reply("📝 Thanks — your feedback has been recorded.")
        return
    # No args: open a thread and record each message posted in it as feedback.
    try:
        thread = await ctx.message.create_thread(
            name=f"Feedback · {ctx.author.display_name}"[:90], auto_archive_duration=60)
        FEEDBACK_THREADS.add(thread.id)
        await thread.send(
            "📝 Share your feedback about the bot here — I'll record every message you "
            "post in this thread. This is general feedback, not about a specific answer.")
    except discord.HTTPException:
        await ctx.reply(
            "I couldn't open a thread here. You can still send feedback inline: "
            "`&feedback <your feedback>`.")


# --- thread follow-ups ---------------------------------------------------

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    # A non-command message inside a `&feedback` thread = general feedback to log.
    if (isinstance(message.channel, discord.Thread)
            and message.channel.id in FEEDBACK_THREADS
            and not message.content.startswith(PREFIX)
            and message.content.strip()):
        store.log_general_feedback(
            message.content, message.author.id,
            channel_id=message.channel.parent_id, thread_id=message.channel.id)
        try:
            await message.add_reaction("📝")  # confirm without cluttering the thread
        except discord.HTTPException:
            pass
        return
    # A non-command message inside a tracked &ask thread = a follow-up question.
    if (isinstance(message.channel, discord.Thread)
            and message.channel.id in THREADS
            and not message.content.startswith(PREFIX)
            and message.content.strip()):
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
    await bot.process_commands(message)


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
