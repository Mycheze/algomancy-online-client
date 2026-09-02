#!/usr/bin/env python3
"""
discordui.py — how the bot DRAWS things: embeds, icon substitution, the small
formatters every command shares.

Split out of bot.py, which had grown to 1397 lines with the rendering woven
through the commands. The line this file draws is the useful one: nothing in
here touches a `Bot`, a `Context`, an `Interaction` or a command. It takes
game data and returns a `discord.Embed` or a string, which means:

  * every one of these is callable from a test with no token and no gateway —
    and `test/test_embeds.py` does exactly that, freezing all 36 of them as
    `Embed.to_dict()`, the payload that actually goes over the wire;
  * a cog can import it without importing another cog, so the buttons and the
    commands can be split up without a circular import;
  * ⚠ THE FUNCTION THAT MADE THIS WORTH DOING is `_resource_text`. It read
    `wtp.Side.resources` (a LIST of Resource cards) as a kind->count dict, so
    `&wtp` raised AttributeError on every puzzle for as long as the feature
    existed. Nothing caught it because nothing imported bot.py. Everything in
    this file is now reachable by a test that needs no Discord at all.

THE EMOJI FALLBACK IS LOAD-BEARING, not a nicety. `EMOJI` is filled at
`on_ready` from the guild's own custom emojis, so it is EMPTY here, empty in
every test, and empty in any guild that has not had the icons uploaded.
`_emoji(name, fallback)` degrades to the plain word rather than printing a
broken `<:name:id>` — which is why the goldens in test_embeds.py are the
no-emoji rendering, and why a fresh guild gets readable text instead of noise.
"""

import asyncio
import io
import re

import discord

import combos
import core
import mods
import wtp
from cards import FACTION_COLOR, FACTION_EMOJI, plain_text
from core import (ICON_NAMES, ICON_TOKEN_RE, RESOURCE_NAMES, cards,
                  cited_card_paths, cost_token_icons, friendly_source,
                  render_citations, render_icons, uncode_icon_tokens)

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


# --- cited-card art ------------------------------------------------------

def cited_card_files(answer, hits, limit=10):
    """discord.File art for each *card* the answer cited (with art), so the
    images can be posted in the thread for easy reference."""
    return [discord.File(str(p), filename=f"cite{n}.jpg")
            for n, _title, p in cited_card_paths(answer, hits, limit=limit)]


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


def confirmation(combo, recorded, cov):
    """The message shown after a combo is logged (or re-logged)."""
    done, total, left = total_played(cov), cov["total"], len(cov["unplayed"])
    if not recorded:
        return (f"Already recorded **{combos.label(combo)}** for you today — "
                f"you're at **{done}/{total}**.")
    tail = (f"{left} combo{'s' if left != 1 else ''} still untouched."
            if left else "That's every combo played — the full set. 🎉")
    return f"✅ Recorded **{combos.label(combo)}**. You're at **{done}/{total}**. {tail}"


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
    """'4 mana (🔥2 🌿2)' — custom emojis when the guild has them, words if not.

    ⚠ `side.resources` is a LIST of Resource cards, not a kind->count mapping.
    This read it as a dict for as long as the feature existed, so `&wtp` raised
    `'list' object has no attribute 'get'` on every puzzle that has any
    resources — which is all of them. Nothing caught it because the Discord
    commands have never been live-tested and no test imported bot.py. Ask
    `resource_counts()` for the mapping, the way wtp.resource_line() does.

    Counting RESOURCE_KINDS rather than ELEMENTS also means a Shard or a
    Prismite is shown instead of silently dropped; neither has an emoji, so
    both fall back to their word.
    """
    if not side.resources:
        return "no resources"
    counts = side.resource_counts()
    bits = " ".join(
        f"{_emoji(k, FACTION_EMOJI.get(k, k))}{counts[k]}".strip()
        for k in wtp.RESOURCE_KINDS if counts.get(k))
    return f"**{side.mana}** mana ({bits})"


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
