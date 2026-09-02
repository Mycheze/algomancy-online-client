"""
rulings.py — a card's rulings, straight out of the corpus. No LLM.

`/rulings <card>` is a plain filter, not a question: the ruling chunks are
tagged with the cards they mention at build time
(pipeline/build_rulings._detect_cards), so this reads them off rather than
asking anything. That is deliberate — the owner asked for "all rules around a
card", and a retrieval-and-summarise answer would be slower, cost money, and
be able to be wrong about what a thread actually said.

Split out of bot.py so the slash command and the dying `&ruling` can share one
implementation while both exist, and so the split leaves nothing behind when
the prefix half goes.
"""

import re

import discord

from core import cards, retriever
from discordui import _ruling_snippet

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


def rulings_embed_for(name):
    """(embed, None) for a card's rulings, or (None, a sentence saying why not).

    Returns rather than sends, so the same body serves a prefix reply and a
    slash followup — and so a test can call it with no Discord at all.
    """
    card, matched, alts = cards.lookup(name)
    if not card:
        hint = f" Did you mean: {', '.join(alts)}?" if alts else ""
        return None, f"No card found matching **{name}**.{hint}"

    hits = find_card_rulings(matched)
    if not hits:
        msg = f"No rulings mention **{matched}** yet."
        if alts:
            msg += f"  (Close names: {', '.join(alts)}.)"
        return None, msg

    e = discord.Embed(
        title=f"⚖️ Rulings mentioning {matched}",
        color=0x5865F2,
        description=f"{len(hits)} thread{'s' if len(hits) != 1 else ''} found "
                    "· highest authority first",
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
        e.set_footer(text=f"…and {len(hits) - 10} more. "
                          "Ask `/ask` about a specific interaction.")
    return e, None
