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
from cards import FACTION_COLOR, FACTION_EMOJI, plain_text
from core import (ICON_NAMES, ICON_TOKEN_RE, RESOURCE_NAMES, answer_question,
                  cards, cited_card_paths, cost_token_icons, friendly_source,
                  render_citations, render_icons, retriever, uncode_icon_tokens)

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


# --- feedback buttons ----------------------------------------------------
# DynamicItem keeps the response_id in the button's custom_id, so feedback
# buttons keep working even after the bot restarts (no in-memory view needed).

# rating -> (button label, emoji, style, ephemeral confirmation text)
FEEDBACK_KINDS = {
    "good": ("Good", "👍", discord.ButtonStyle.success, "helpful 👍"),
    "weird": ("Fine, but odd", "🤔", discord.ButtonStyle.secondary,
              "correct but oddly written 🤔"),
    "bad": ("Inaccurate", "👎", discord.ButtonStyle.danger, "inaccurate 👎"),
}


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


# --- cited-card art ------------------------------------------------------

def cited_card_files(answer, hits, limit=10):
    """discord.File art for each *card* the answer cited (with art), so the
    images can be posted in the thread for easy reference."""
    return [discord.File(str(p), filename=f"cite{n}.jpg")
            for n, _title, p in cited_card_paths(answer, hits, limit=limit)]


async def post_cited_cards(channel, answer, hits):
    """Post images of any cited cards into a thread/channel (no-op if none)."""
    files = cited_card_files(answer, hits)
    if files:
        await channel.send(content="**Cited cards** (referenced above):", files=files)


def answer_embed(question, answer, hits, reasoning=False):
    display, sources = render_citations(answer, hits)
    # Icon tokens the model quoted from card text ([Switch1], [Augment], …) become
    # the guild's custom emojis, so an answer reads like the cards do. `_emoji`
    # degrades to the literal token if the guild is missing that emoji.
    # uncode_icon_tokens first: Discord shows a custom emoji inside a code span as
    # its raw <:name:id> source, and the model likes to quote card text in
    # backticks — so the code formatting has to go for the emoji to survive.
    display = render_icons(uncode_icon_tokens(display), _emoji)
    e = discord.Embed(
        title=f"❓ {question[:240]}",
        description=display[:4096],
        color=0x5865F2,
    )
    # Only list sources the answer actually cited; fall back to top retrieved.
    if not sources and hits:
        sources = [(i, r) for i, (_s, r) in enumerate(hits[:3], 1)]
    if sources:
        lines = [f"**{n}.** {friendly_source(r)} · *{r['authority_label']}*"
                 for n, r in sources]
        e.add_field(name="Sources", value="\n".join(lines)[:1024], inline=False)
    mode = f"{core.DEEPSEEK_MODEL} · 🧠 thinking" if reasoning else core.DEEPSEEK_MODEL
    e.set_footer(text=f"Answered by {mode} · rate below to help train the model")
    return e


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


# Discord allows at most 10 embeds and 10 attachments per message.
MAX_CARDS = 10


# --- custom emoji rendering for card icons -------------------------------
# Filled at on_ready from the bot's guilds: emoji name -> "<:name:id>".
EMOJI: dict[str, str] = {}

# The token->icon-name maps (ICON_NAMES, RESOURCE_NAMES) and the token regex live
# in core.py so the web app renders the same icons. The guild's custom emojis must
# be named to match the icon names (augment, bounded_graft, graft, fire, …).


def _emoji(name, fallback):
    """The renderable <:name:id> if the guild has that emoji, else `fallback`
    (so missing emojis degrade to readable text instead of breaking)."""
    return EMOJI.get(name, fallback)


def _sub_token(m):
    tok = m.group(0)
    is_brace_attr = tok[0] == "{" and tok[1:-1].isalpha()
    # Readable fallback if the emoji is missing: bare word for {Attribute}, the
    # token itself for [Ability] (the brackets read as a keyword).
    fallback = tok[1:-1] if is_brace_attr else tok
    name = ICON_NAMES.get(tok.lower())
    if name:
        return _emoji(name, fallback)
    if not is_brace_attr:
        # A [cost]: one token, but possibly several emojis ([4bb] is a "4" then two
        # water drops). Each falls back to the character it draws, so a missing emoji
        # leaves "4bb" — the same way the cost line degrades.
        icons = cost_token_icons(tok)
        if icons:
            return "".join(_emoji(n, c) for n, c in icons)
    if is_brace_attr:                # unknown {Attribute} -> drop braces
        return tok[1:-1]
    return tok                       # unknown [ability] -> leave as-is


def render_card_text(text):
    """Clean card oracle text / type line for Discord: convert formatting codes
    and swap game-icon tokens for custom emojis (falls back to text if absent)."""
    if not text:
        return text
    # cards.plain_text resolves the JSON's formatting codes ({/n}, {i}, {g}) and
    # leaves the game tokens for us to render — the same pass the search index and
    # the web app use, so a new code is handled once, not three times.
    return ICON_TOKEN_RE.sub(_sub_token, plain_text(text))


def render_cost(cost):
    """Render an affinity/cost string like '4bb' with faction emojis (digits kept)."""
    if not cost or cost == "empty":
        return cost
    out = []
    for ch in cost:
        name = RESOURCE_NAMES.get(ch.lower())
        out.append(_emoji(name, ch) if name else ch)
    return "".join(out)


def render_faction_label(card):
    """Factions line using the guild's custom faction emojis (each named after the
    faction), falling back to the Unicode FACTION_EMOJI if not loaded."""
    fs = cards.factions(card)
    if not fs:
        return "Neutral / Unknown"
    return " ".join(
        f"{_emoji(f, FACTION_EMOJI.get(f, ''))} {f.title()}".strip() for f in fs)


def build_card_embed(card, matched, alts, attach_name=None):
    """Build a card embed; return (embed, file_or_None). If `attach_name` is
    given and the card has art, the image is attached under that filename."""
    embed = discord.Embed(title=matched, color=cards.color(card))
    type_line = (card.get("type") or "").strip()
    if type_line:
        embed.description = f"*{render_card_text(type_line)}*"
    cost = render_cost(card.get("cost") or "—")
    total = card.get("total_cost")
    embed.add_field(
        name="Cost", value=f"{cost} (total {total})" if total else str(cost), inline=True)
    embed.add_field(
        name="Power / Toughness",
        value=f"{card.get('power', '?')}/{card.get('toughness', '?')}", inline=True)
    embed.add_field(name="Factions", value=render_faction_label(card), inline=True)

    text = (card.get("text") or "").strip()
    if text:
        embed.add_field(name="Oracle Text", value=render_card_text(text)[:1024], inline=False)

    rulings = card.get("rulings") or []
    if rulings:
        body = "\n".join(f"• {r}" for r in rulings)
        embed.add_field(name="Rulings", value=body[:1024], inline=False)

    if alts:
        embed.add_field(
            name="Did you mean…",
            value=", ".join(f"`{a}`" for a in alts), inline=False)

    footer = []
    if card.get("complexity"):
        footer.append(f"Complexity: {card['complexity']}")
    if card.get("Side") and card["Side"] != "Front":
        footer.append(f"Side: {card['Side']}")
    if footer:
        embed.set_footer(text=" · ".join(footer))

    file = None
    art = cards.art_path(matched)
    if art and attach_name:
        file = discord.File(str(art), filename=attach_name)
        embed.set_image(url=f"attachment://{attach_name}")
    return embed, file


# --- grafted / augmented cards -------------------------------------------
# `&card A + B` shows what A reads as once B is stacked under it. The rules and
# the art stacking live in mods.py; this is just the Discord skin, and it lands
# in the same shape as a plain `&card` so a combination doesn't look like a
# different kind of object.


def build_combo_embed(combo, attach_name=None):
    """Embed for a modified card: the stacked art, and the text it now reads as."""
    host = combo.host
    # Titled with BOTH names, so nobody reads the image as just the top card.
    embed = discord.Embed(title=combo.title, color=cards.color(host))

    # The combo's type line, not the host's: an augment can grant attributes, and
    # this is where they show up.
    if combo.type:
        embed.description = f"*{render_card_text(combo.type)}*"

    cost = render_cost(host.get("cost") or "—")
    total = host.get("total_cost")
    embed.add_field(
        name="Cost", value=f"{cost} (total {total})" if total else str(cost), inline=True)
    embed.add_field(
        name="Power / Toughness",
        value=f"{host.get('power', '?')}/{host.get('toughness', '?')}", inline=True)
    embed.add_field(name="Factions", value=render_faction_label(host), inline=True)

    if combo.text:
        embed.add_field(name="Oracle Text",
                        value=render_card_text(combo.text)[:1024], inline=False)

    # You pay the modification's own cost to apply it, so it's worth showing.
    applied = " · ".join(
        f"**{name}** {render_cost(card.get('cost') or '—')}"
        for name, card, _ in combo.mods)
    note = combo.describe(bold=lambda s: f"**{s}**")
    embed.add_field(name="Modification", value=f"{note}\nApplied for: {applied}",
                    inline=False)

    footer = []
    if combo.swapped:
        # They named the cards the other way round. Say so — which card is on top
        # is the whole difference between "A grafted with B" and "B grafted with A".
        footer.append(f"{combo.host_name} has to be the one in play, so it goes on top")
    if host.get("complexity"):
        footer.append(f"Complexity: {host['complexity']}")
    if footer:
        embed.set_footer(text=" · ".join(footer))

    file = None
    if attach_name:
        art = mods.render_stack(combo, cards)
        if art:
            file = discord.File(io.BytesIO(art), filename=attach_name)
            embed.set_image(url=f"attachment://{attach_name}")
    return embed, file


# --- card search ----------------------------------------------------------
# `&search <description>` is `&card` for when you remember what a card DOES but
# not what it's called ("that wood unit that draws when it dies"). The ranking
# lives in cards.CardIndex.search; this is just the Discord skin for it, and it
# deliberately ends in the same place `&card` does — the best match rendered as a
# full card embed — with the runners-up one click away in a dropdown.

SEARCH_RESULTS = 6          # candidates ranked per search
EMBED_FIELD_MAX = 1024      # Discord's cap on a single embed field's value
_TOKEN_BRACKETS_RE = re.compile(r"[\[{]([^\]}]+)[\]}]")


def _bare(text):
    """Game tokens stripped to bare words ([Switch1] -> Switch1) for the places
    Discord won't render an emoji anyway — dropdown labels and descriptions."""
    return _TOKEN_BRACKETS_RE.sub(r"\1", text or "")


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


def search_results_field(hits):
    """The 'Other matches' body: the runners-up, with the line that matched.

    Drops whole lines that don't fit rather than slicing the joined text at
    Discord's field cap — an icon token renders as `<:bounded_graft:123…>`, so a
    blind cut can land mid-tag and leave a dangling `<:bounded_graft:12` on show.
    Returns (body, shown) so the caller's header can't claim more than it lists.
    """
    lines, used = [], 0
    for h in hits:
        line = f"**{h.name}** — {render_card_text(h.snippet(110))}"
        if used + len(line) + 1 > EMBED_FIELD_MAX:
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines), len(lines)


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


def _ruling_snippet(row, width=230):
    """First slice of a ruling's body (drop the title line + trailing tails)."""
    text = row["text"]
    # body is everything after the "title\n\n" heading we prepend at build time
    body = text.split("\n\n", 1)[1] if "\n\n" in text else text
    for cut in ("\nRelated cards:", "\n\n(Source:", "\n\n(Answered by"):
        i = body.find(cut)
        if i != -1:
            body = body[:i]
    body = " ".join(body.split())
    return body[:width] + "…" if len(body) > width else body


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


# --- colour-combo suggestions --------------------------------------------
# `&colors` suggests three colours to play, biased toward combos you've never
# tried. Nothing is recorded until you confirm with the ✅ button (or `&played`),
# so re-rolling a suggestion you don't fancy never pollutes your history.

def combo_icons(combo):
    """The combo's faction emojis (custom if the guild has them, else Unicode)."""
    return " ".join(_emoji(c, FACTION_EMOJI.get(c, "")) for c in combo)


def _combo_lines(items, cov=None, limit=12):
    """Bullet list of combos, truncated so it always fits an embed field."""
    shown = items[:limit]
    lines = []
    for combo in shown:
        line = f"• {combos.label(combo)}"
        if cov:
            count = cov["counts"].get(combo, 0)
            when = (cov["last"].get(combo) or "")[:10]      # YYYY-MM-DD
            line += f" — {count}×, last {when}" if when else ""
        lines.append(line)
    if len(items) > limit:
        lines.append(f"…and {len(items) - limit} more")
    return "\n".join(lines)


def suggestion_embed(user, combo, reason, cov):
    done, total = total_played(cov), cov["total"]
    blurb = ("You've **never played this one**." if reason == "new" else
             "You've played everything — this is the one you've gone longest without.")
    e = discord.Embed(
        title=f"🎲 {combos.label(combo)}",
        description=f"{combo_icons(combo)}\n\n{blurb}\n\n"
                    f"`{combos.progress_bar(done, total)}` **{done}/{total}** combos explored",
        color=FACTION_COLOR.get(combo[0], 0x5865F2),
    )
    if cov["unplayed"]:
        e.add_field(name=f"Never played ({len(cov['unplayed'])})",
                    value=_combo_lines(cov["unplayed"])[:1024], inline=False)
    e.set_footer(text=f"Suggested for {user.display_name} · "
                      "hit ✅ once you've actually played it, or 🎲 to re-roll")
    return e


def stats_embed(user, cov):
    done, total = total_played(cov), cov["total"]
    e = discord.Embed(
        title=f"🎨 {user.display_name}'s colour history",
        description=f"`{combos.progress_bar(done, total)}` **{done}/{total}** combos explored",
        color=0x5865F2,
    )
    if cov["played"]:
        e.add_field(name=f"Played ({done})",
                    value=_combo_lines(cov["played"], cov)[:1024], inline=False)
    if cov["unplayed"]:
        e.add_field(name=f"Never played ({len(cov['unplayed'])})",
                    value=_combo_lines(cov["unplayed"])[:1024], inline=False)
    else:
        e.set_footer(text="You've played every combo — nice. Suggestions now "
                          "pick whatever you've left alone the longest.")
    return e


def total_played(cov):
    return len(cov["played"])


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


def confirmation(combo, recorded, cov):
    """The message shown after a combo is logged (or re-logged)."""
    done, total, left = total_played(cov), cov["total"], len(cov["unplayed"])
    if not recorded:
        return (f"Already recorded **{combos.label(combo)}** for you today — "
                f"you're at **{done}/{total}**.")
    tail = (f"{left} combo{'s' if left != 1 else ''} still untouched."
            if left else "That's every combo played — the full set. 🎉")
    return f"✅ Recorded **{combos.label(combo)}**. You're at **{done}/{total}**. {tail}"


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


async def _render(fn, *args):
    """Run a Pillow render off the event loop (it's CPU-bound)."""
    return await asyncio.to_thread(fn, *args)


def _draft_file(png, name):
    return discord.File(io.BytesIO(png), filename=name)


def _slots_str(slots):
    return ", ".join(str(s) for s in sorted(slots)) or "none"


def _element_line(elements):
    """'🔥 Fire · ⚙️ Metal · 🌿 Wood' using custom emojis when available."""
    return " · ".join(
        f"{_emoji(e, FACTION_EMOJI.get(e, ''))} {e.title()}".strip() for e in elements)


def draft_embed(pack):
    e = discord.Embed(
        title=f"🃏 {pack.spec.label}",
        description=(f"{pack.spec.blurb}\n\n"
                     f"**Pick {pack.picks}.** Tap the numbered buttons below — I'll "
                     f"confirm your picks privately and post them to the thread once "
                     f"you've chosen {pack.picks}."),
        color=0x5865F2,
    )
    if pack.spec.elements:
        e.add_field(name="Elements", value=_element_line(pack.elements), inline=False)
    e.add_field(name="Seed",
                value=f"`{pack.code}` — replay anywhere with `&{pack.mode} {pack.seed}`",
                inline=False)
    e.set_image(url="attachment://pack.png")
    e.set_footer(text="Your picks are private until you complete a set · the seed is shareable")
    return e


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

_DIFF_COLOR = {"easy": 0x3BA55D, "medium": 0xC9A227, "hard": 0xD83C3C}


def wtp_embed(p):
    e = discord.Embed(
        title=f"🧩 {p.title}",
        description=f"**{p.question}**",
        color=_DIFF_COLOR.get(p.difficulty, 0x5865F2))
    e.add_field(name="Board", value=wtp.status_line(p), inline=False)

    # Life and resources in words as well as in the picture: the numbers are the
    # puzzle, and they should be copy-pasteable into the thread.
    for side in (p.opponent, p.you):
        e.add_field(
            name=side.name,
            value=f"**{side.life}** life · {_resource_text(side)}",
            inline=True)
    if p.notes:
        e.add_field(name="Notes", value=p.notes[:1000], inline=False)

    e.set_image(url="attachment://board.png")
    bits = [p.difficulty]
    bits += list(p.tags)
    if p.author:
        bits.append(f"by {p.author}")
    e.set_footer(text=f"{p.id} · " + " · ".join(bits))
    return e


def _resource_text(side):
    """'4 mana (🔥2 🌿2)' — custom emojis when the guild has them, words if not."""
    if not side.resources:
        return "no resources"
    bits = " ".join(
        f"{_emoji(e, FACTION_EMOJI.get(e, ''))}{side.resources[e]}".strip()
        for e in wtp.ELEMENTS if side.resources.get(e))
    return f"**{side.mana}** mana ({bits})"


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


def solution_embed(p):
    # Solutions quote card text ("[Switch1] Put a +1/+1 counter on me"), so run
    # them through the same icon pass as an answer: uncode first, because Discord
    # won't expand a custom emoji inside a code span at all.
    body = p.solution or "_No solution was written for this one._"
    e = discord.Embed(
        title=f"🔑 {p.title} — the answer",
        description=render_icons(uncode_icon_tokens(body), _emoji)[:4000],
        color=0x3BA55D)
    e.set_footer(text=p.id)
    return e


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
