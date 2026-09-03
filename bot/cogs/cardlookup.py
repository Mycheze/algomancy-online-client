"""
cogs/cardlookup.py — looking a card up: by name, by description, by ruling.

TWO SEARCHES, AND THEY ARE NOT THE SAME QUESTION. This is the one thing worth
understanding before editing this file:

  /card <name>        — you know the name. Fuzzy, forgiving, autocompleted.
  /find <description> — you remember what it DOES. cards.CardIndex.search:
                        BM25 over stemmed text, with Algomancy's own
                        vocabulary (delete/negate/recall, not
                        destroy/counter/return) and keyword-meaning indexing,
                        so "draws a card when it hits the player" finds the one
                        {Thieving} card even though the word "draw" is nowhere
                        on it.
  /search <query>     — a FILTER, in the browser's query language:
                        `-el:fire (t:sprite OR t:demon) mana<=3`. Lives on the
                        game server (client/ui/cardsearch.ts) and arrives here
                        over HTTP, because the bot must not hold a second copy
                        of that grammar. Added separately; see gameserver.py.

Deleting the BM25 one in favour of the query language would be a real loss —
a filter answers none of the questions a description answers — and it would
also break app.py's /api/search, which the web front-end renders.
"""

import re

import asyncio

import discord
from discord import app_commands
from discord.ext import commands

import gameserver
import mods
import rulings
from cards import FACTION_EMOJI
from core import cards
from discordui import (MAX_CARDS, SEARCH_RESULTS, _bare, build_card_embed,
                       build_combo_embed, search_results_field)

from .common import card_autocomplete, down_notice, fail, start


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


class CardLookup(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        # ⚠ Registered on the CLIENT, not the cog: a DynamicItem is rebuilt
        # from its custom_id with no reference to whatever created it, which
        # is exactly what lets a click on a month-old message still work.
        self.bot.add_dynamic_items(CardSelect)

    # ── /card ─────────────────────────────────────────────────────────
    @app_commands.command(
        name="card", description="Look up a card by name (or stack two with `with:`)")
    @app_commands.describe(
        name="The card. Several at once with commas.",
        with_="Stack this one under it — a graft or an augment.",
        private="Only you see the answer.")
    # `with` is a Python keyword, so the parameter is `with_` and Discord is
    # told the real name. This is the half `&card A + B` never had: the mod
    # gets its own autocompleted box instead of being buried in free text.
    @app_commands.rename(with_="with")
    @app_commands.autocomplete(name=card_autocomplete, with_=card_autocomplete)
    async def card(self, interaction: discord.Interaction, name: str,
                   with_: str = None, private: bool = False):
        await start(interaction, private=private)
        query = f"{name} + {with_}" if with_ else name

        # No card name contains a comma, so it stays a safe separator.
        queries = [q.strip() for q in query.split(",") if q.strip()]
        notes = []
        if len(queries) > MAX_CARDS:
            notes.append(f"That's {len(queries)} cards — showing the first {MAX_CARDS}.")
            queries = queries[:MAX_CARDS]

        embeds, files, not_found = [], [], []
        for i, q in enumerate(queries):
            if "+" in q:                       # no card name contains one either
                try:
                    combo = mods.build(q, cards)
                except mods.ComboError as exc:
                    notes.append(str(exc))
                    continue
                # Pillow compositing, off the loop — as play.py's _render does
                embed, file = await asyncio.to_thread(
                    build_combo_embed, combo, attach_name=f"card{i}.jpg")
            else:
                card, matched, alts = cards.lookup(q)
                if not card:
                    not_found.append(q)
                    continue
                embed, file = build_card_embed(card, matched, alts,
                                               attach_name=f"card{i}.jpg")
            embeds.append(embed)
            if file:
                files.append(file)

        if not_found:
            notes.append("Couldn't find: " + ", ".join(f"**{n}**" for n in not_found))
        if not embeds:
            await fail(interaction, "\n".join(notes) or f"No card found matching **{name}**.")
            return
        await interaction.followup.send(content="\n".join(notes) or None,
                                        embeds=embeds, files=files)

    # ── /find ─────────────────────────────────────────────────────────
    @app_commands.command(
        name="find", description="Find a card from what it DOES, when you can't recall the name")
    @app_commands.describe(
        description="What you remember — e.g. 'wood unit that draws a card when it dies'",
        private="Only you see the answer.")
    async def find(self, interaction: discord.Interaction, description: str,
                   private: bool = False):
        await start(interaction, private=private)
        hits = cards.search(description, limit=SEARCH_RESULTS)
        if not hits:
            await fail(interaction,
                       f"Nothing matched **{description}**. Try describing what the card "
                       "*does* (“deals damage to every unit”, “recall a unit from the "
                       "bin”), or look it up by name with `/card`.")
            return

        top, rest = hits[0], hits[1:]
        embed, file = build_card_embed(top.card, top.name, [], attach_name="card.jpg")
        embed.set_author(name=f"🔍 {description}"[:256])
        if rest:
            body, shown = search_results_field(rest)
            if shown:
                embed.add_field(name=f"Other matches ({shown})", value=body, inline=False)
        view = discord.ui.View(timeout=None)
        view.add_item(CardSelect(hits))        # every hit, including the one shown
        await interaction.followup.send(embed=embed, file=file, view=view)

    # ── /rulings ──────────────────────────────────────────────────────
    @app_commands.command(
        name="rulings", description="Every community, judge and designer ruling about a card")
    @app_commands.describe(card="The card to look up.", private="Only you see the answer.")
    @app_commands.autocomplete(card=card_autocomplete)
    async def rulings(self, interaction: discord.Interaction, card: str,
                      private: bool = False):
        await start(interaction, private=private)
        embed, note = rulings.rulings_embed_for(card)
        if embed is None:
            await fail(interaction, note)
            return
        await interaction.followup.send(embed=embed)

    # ── /search ───────────────────────────────────────────────────────
    @app_commands.command(
        name="search",
        description="Filter the card pool: el:fire mana<=3 -t:sprite")
    @app_commands.describe(
        query="e.g. `el:fire mana<=3`, `t:demon OR t:sprite`, `o:\"when I die\"`",
        limit="How many to list (1-25).",
        private="Only you see the answer.")
    async def search(self, interaction: discord.Interaction, query: str,
                     limit: app_commands.Range[int, 1, 25] = 10,
                     private: bool = False):
        await start(interaction, private=private)
        try:
            res = await gameserver.client.cardsearch(query, limit=limit)
        except gameserver.GameServerDown as exc:
            await self._search_fallback(interaction, query, exc)
            return

        cards_ = res.get("cards") or []
        if not cards_:
            note = f"Nothing matches `{query}`."
            if res.get("errors"):
                note += "\n" + _errors_line(res["errors"])
            await fail(interaction, note + "\n`/help` · or describe it with `/find`.")
            return

        embed = discord.Embed(
            title=f"🔎 {res['total']} card{'s' if res['total'] != 1 else ''} match",
            color=0x5865F2,
            description="\n".join(
                f"**{c['name']}** · {c['type']}"
                + (f" · {c['cost']}" if c.get("cost") else "")
                + (f" · {c['pow']}/{c['tou']}" if c.get("supertype") == "Unit" else "")
                for c in cards_)[:4000])
        embed.set_author(name=query[:256])

        # Say what was guessed and what was assumed. The parser auto-closes an
        # unfinished quote rather than refusing, so a result for `o:"draw a ca`
        # is an answer to a question the user did not quite ask.
        foot = []
        if res.get("errors"):
            foot.append(_errors_line(res["errors"]))
        if res.get("implicitCards"):
            foot.append("showing cards only — add `class:all` for tokens and markers")
        if res["total"] > res["returned"]:
            foot.append(f"showing {res['returned']} of {res['total']}")
        if foot:
            embed.set_footer(text=" · ".join(foot)[:2048])
        await interaction.followup.send(embed=embed)

    async def _search_fallback(self, interaction, query, exc):
        """The game server is down. Answer with the local describer instead —
        but ONLY if the query does not look like the query language.

        ⚠ THE GUARD IS THE POINT. Running `-el:fire mana<=3` through a BM25
        text search does not fail, it returns confident nonsense, which is
        worse than an outage because nobody can tell. The regex asks "does this
        look like a filter at all"; it does not parse one, and it must not
        grow into something that does.
        """
        if _LOOKS_LIKE_QUERY.search(query):
            await fail(interaction, down_notice(exc)
                       + "\n(`/search` speaks the game server's query language, "
                         "so it needs it. `/find <description>` works without it.)")
            return
        hits = cards.search(query, limit=SEARCH_RESULTS)
        if not hits:
            await fail(interaction, down_notice(exc))
            return
        top = hits[0]
        embed, file = build_card_embed(top.card, top.name, [], attach_name="card.jpg")
        embed.set_author(name=f"🔍 {query}"[:256])
        embed.set_footer(text="the game server is down, so I read that as a "
                              "description rather than a filter")
        await interaction.followup.send(embed=embed, file=file)


def _errors_line(errors):
    return "⚠️ " + "; ".join(e.get("message", "?") for e in errors[:3])


# `key:value`, `mana<=3`, `pow>2` — the shape of a filter, not a parse of one.
_LOOKS_LIKE_QUERY = re.compile(r"[a-z]{1,12}\s*(?::|!=|<=|>=|<|>|=)")
