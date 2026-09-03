"""
cogs/common.py — the three things every slash command here needs to agree on.

Kept in one module rather than decided eleven times, because each of them has
a failure mode that only shows up in production:

  1. DEFER. Discord gives a command THREE SECONDS to acknowledge. `/ask` with
     reasoning on takes thirty or more, a Pillow render takes seconds, and the
     game server is a network hop. Past three seconds the interaction is dead
     and the user sees "The application did not respond" — permanently, with
     no way for the bot to correct it later.

     ⚠ AND `ephemeral` IS FIXED AT DEFER TIME. It cannot be changed afterwards,
     so `private` has to be read BEFORE the defer, not at send time.

     ⚠ A HANDLER THAT DEFERS AND THEN RAISES leaves the "thinking…" spinner up
     for ever. Every slow command therefore routes its failure through
     `fail()`, which uses followup.send — the only thing that still works.

  2. EPHEMERAL. Stated once: errors, hints, reveals and link codes are always
     private; `/ask`, `/puzzle play` and `/draft` are always public BECAUSE AN
     EPHEMERAL MESSAGE CANNOT HAVE A THREAD and all three open one; everything
     else takes an opt-in `private:` parameter.

  3. AUTOCOMPLETE. It has a three-second budget of its own and NO defer
     mechanism, so a callback that touches the disk or the network just shows
     nothing. The name list is precomputed at import, and matched with
     `cards._norm` — the same normaliser `CardIndex.lookup` uses, so a
     suggestion the user picks always resolves to the card they picked.
"""

import discord
from discord import app_commands

from cards import _norm
from core import cards

# Discord's hard cap on how many suggestions it will show.
AUTOCOMPLETE_LIMIT = 25

# (normalised, real) for every card, built once. 534 entries — a linear scan
# per keystroke is nothing, and it keeps this dependency-free.
_NAMES = sorted((_norm(n), n) for n in cards.names)


def card_choices(current: str) -> list[app_commands.Choice[str]]:
    """Cards whose name matches what has been typed, prefixes first.

    Pure and synchronous on purpose: see the header. A prefix match is what
    somebody typing a name means; a substring match is what somebody who has
    forgotten the first word means; and the first group is worth more.
    """
    q = _norm(current or "")
    if not q:
        return [app_commands.Choice(name=n, value=n)
                for _, n in _NAMES[:AUTOCOMPLETE_LIMIT]]
    starts, holds = [], []
    for norm, real in _NAMES:
        if norm.startswith(q):
            starts.append(real)
        elif q in norm:
            holds.append(real)
        if len(starts) >= AUTOCOMPLETE_LIMIT:
            break
    out = (starts + holds)[:AUTOCOMPLETE_LIMIT]
    # Choice.name is capped at 100 characters by Discord; no Algomancy card is
    # close, but a truncation here is invisible and a rejection is not.
    return [app_commands.Choice(name=n[:100], value=n[:100]) for n in out]


async def card_autocomplete(interaction: discord.Interaction, current: str):
    return card_choices(current)


async def start(interaction: discord.Interaction, *, private: bool = False):
    """Acknowledge within the three-second window. Call this FIRST — before any
    other await — in every handler that can be slow."""
    await interaction.response.defer(thinking=True, ephemeral=private)


async def fail(interaction: discord.Interaction, message: str):
    """Report a failure after a defer. followup.send is the only route left
    once the interaction has been acknowledged."""
    try:
        await interaction.followup.send(message, ephemeral=True)
    except discord.HTTPException:
        pass


def down_notice(exc) -> str:
    """What to say when the game server is not answering.

    Three things, deliberately: what could not be done, that it is the GAME
    SERVER and not the bot that is down (they are separate services and the
    distinction is the difference between "wait" and "tell Ben"), and what
    still works without it.
    """
    return (f"⚠️ The game server isn't answering (`{exc}`), so I can't do that "
            "right now. Rules questions (`/ask`), card lookups (`/card`) and "
            "practice drafts (`/draft`) all still work — none of them need it.")
