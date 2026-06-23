#!/usr/bin/env python3
"""
bot.py — Algomancy rules Discord bot.

Commands
--------
  &ask <question>     RAG answer over the rules corpus, with source citations.
                      Opens a thread; ask follow-ups there and context is kept.
  &card <name>        Fuzzy-matched card lookup with art, stats, and rulings.

Retrieval is the dependency-free TF-IDF search in `retriever.py`; generation is
DeepSeek via its OpenAI-compatible API (cheap `deepseek-v4-flash` by default).

Setup
-----
  pip install -r requirements.txt
  cp .env.example .env      # then fill in DISCORD_TOKEN and DEEPSEEK_API_KEY
  python3 bot.py
"""

import os
import re

import discord
from discord.ext import commands
from dotenv import load_dotenv
from openai import AsyncOpenAI

import store
from cards import CardIndex, FACTION_EMOJI
from retriever import Retriever

load_dotenv()

PREFIX = "&"
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_BASE = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MAX_HISTORY = 8        # how many prior thread messages to resend as context
TOP_K = 6              # chunks retrieved per question

# "Math mode": stat/arithmetic questions (combat damage, buffs, Electric arcing,
# Fireball-vs-Growth, regroup math) benefit from DeepSeek's thinking mode. We
# auto-detect them and enable thinking only then, so the cost hits just the
# questions that need it. DEEPSEEK_REASONING: "auto" (detect) | "off" | "always".
REASONING_MODE = os.getenv("DEEPSEEK_REASONING", "auto").lower()
REASONING_EFFORT = os.getenv("DEEPSEEK_REASONING_EFFORT", "high")

# Verified core-rules digest, always supplied to the model so it has reliable
# footing even when retrieval misses. Grounded in the Manual + Rules Glossary;
# keep edits factual. Facts here are background — the model states them without a
# [tag] (only retrieved passages get cited).
PRIMER = """Core Algomancy primer (verified basic rules — always reliable background):
- Algomancy is a live-draft card game by Caleb Gannon. Five elemental factions — \
Fire, Water, Earth, Wood, Metal — plus colorless (faction-neutral) cards. Resources \
of an element pay a card's mana cost AND satisfy that element's threshold requirement.
- Goal: eliminate every opponent by reducing their life to zero (in team games, the \
whole opposing team). Players typically start at 30 life.
- A turn has four phases IN THIS ORDER: (1) Planning — refresh/untap resources, draw, \
and draft cards; (2) Battle — declare attacks and blocks into formations and deal \
combat damage; (3) Regroup; (4) Deployment — play cards and apply mods, then end the \
turn. Regroup happens BEFORE Deployment, not at the very end of the turn.
- Regroup is a clean-up step with no player actions: units return to their region, ALL \
combat damage on units is removed, ALL temporary stat changes end (anything "until \
regroup"), ALL Spell Tokens are erased, and all units leave their formation. So a 1/1 \
buffed to 3/3 "until regroup" that took 1 damage goes back to a healthy 1/1 — the \
damage is cleared at the same moment the buff ends; it does NOT become 1/0.
- Tokens: Spell Tokens are temporary and erased at Regroup. Ordinary unit tokens are \
NOT erased by Regroup — they persist like normal units until killed or removed. \
"Leaving formation" is only a positional reset at Regroup; it is NOT leaving play / \
being removed.
- Combat: each spot where one player's attackers meet a defender is a Skirmish (at most \
one per player). Creatures fight in Formations made of columns; a column holds at most \
2 creatures (front and back). Creatures are Adjacent only orthogonally (left/right/ \
front/back), never diagonally. Attributes (Flying, Poisonous, Electric, Deadly, etc.) \
are shared between creatures in the same column ("vertically adjacent") — e.g. a Flying \
creature in front of a Poisonous one makes the whole column Flying AND Poisonous; if \
one leaves combat its column-mate loses the shared attribute. Flying units can only be \
blocked by Flying units.
- Modifications: both Augment (+) and Graft (switch-arrows) attach a card from your \
DISCARD/bin (never your hand), paying its cost, onto a creature, which then gains the \
added text. Graft can only target creatures that themselves have the graft symbol; \
Augment can target any creature.
- Conjure makes a spell token cast at a set time. In combat it casts immediately; \
outside combat it casts in the next combat — offensive conjured spells just after \
attackers are declared, then defensive ones (which resolve before the offensive ones). \
An unspecified X on a conjured spell is 1.
- Targeting: you can only target things in a Skirmish with you, so you cannot target an \
opponent's cards during your own main phase (outside combat).
- Initiative (1v1/team games): the Initiative team acts first each turn, creating an \
attack-counterattack flow; free-for-all games declare attacks simultaneously.

Keyword glossary — attributes appear in {bold} before the type line; ability keywords \
appear in [brackets] in card text. These definitions are reliable:
- Flying — can only be blocked by other Flying units.
- Piercing — excess combat damage beyond a blocked unit's health carries over to the \
defending player. This is Algomancy's equivalent of "trample" from other card games.
- Electric — excess damage from an Electric source is redirected to an adjacent \
creature, and can chain across a row of small creatures.
- Deadly — any amount of combat damage it deals destroys the unit it hits (like \
"deathtouch" elsewhere).
- Poisonous — a Poisonous source damages units in the form of -1/-1 counters (not \
ordinary combat damage).
- Swift — deals its combat damage first; Sluggish — deals its combat damage last (a \
unit that is both deals damage twice, going first and last).
- Tough — its defense/toughness is doubled.
- Haste — may be played during the haste step (instant speed in that window).
- Virus — may also be applied as a modification (augment) from your hand during battle, \
not only played normally.
- Burst — a non-combat attribute; can be cast any time, but you must play all Burst \
spells of the same type at once.
- Unstable — a non-combat attribute; if the card would go to the bin/discard it is \
erased instead (used to limit recursion).
- Battle — a timing attribute: the card can only be used during an actual fight. The \
Battle phase starts every turn, but every chance to act in it (priority windows, casting \
Battle spells) opens only AFTER attackers are declared. If no one attacks into a region \
involving you, there is no skirmish, the combat steps are skipped, and the phase just \
passes with nothing to do. You can play a Battle card when a fight involving you is \
happening: you attack, you counter-attack, or you are attacked.
- Ambush — play the unit during battle, recalling one of your units and placing the \
ambusher into that unit's position in play.
- Powerful — a Powerful source deals double damage.
- Reaping — when a Reaping source kills one or more units, its controller draws a card.
- Thieving — when a Thieving source deals combat damage to an opponent, draw a card.
- Resonant — when a Resonant source deals damage to a unit, it also deals that much \
damage to that unit's controller.
- Vulnerable — a Vulnerable card/unit receives double damage.
- Feeble — Feeble units can't block.
- Sneaky — a Sneaky unit can't be blocked if it is attacking alone.
- Evasive — an Evasive unit requires two blockers.
- Alluring — when an Alluring column attacks, the targeted enemy can't attack and must \
block it this combat if able.
- Unaware — Unaware cards (and the units they interact with) ignore all stat changes.
- Balanced — a Balanced unit's power and defense both become the greater of the two.
- Inverted — reverses a unit's stat changes (a -7/-7 effect instead gives +7/+7).
- Augment (+), Graft (switch-arrows), Conjure — see the Modifications and Conjure notes above.
Note: "Devastating" is not a current attribute (it appears only in old example text); the \
live keyword for excess combat damage going to the player is Piercing."""

SYSTEM_PROMPT = """You are the Algomancy Rules Bot, an expert assistant for the \
card game Algomancy by Caleb Gannon. Answer using TWO trusted sources only: (1) the \
Core Primer of basic rules below — verified and always reliable; and (2) the retrieved \
passages provided with each question, which cover the specifics. Do not use outside \
knowledge about other card games or invent rules beyond these two sources.

Grounding and citations:
- The primer is general background: state it freely WITHOUT a [tag]. Attach a [tag] only \
to a claim drawn DIRECTLY from a retrieved passage, e.g. "Grafts can only go onto other \
graft cards [rulebook23:0026]."
- If you are reasoning or inferring something neither the primer nor the passages state \
explicitly, present it as an inference ("the rules don't state this directly, but…") and \
do NOT attach a citation.
- A card's own text in the passages is authoritative for what THAT card does — read it \
carefully and apply it literally before reaching for general rules.
- When sources disagree, prefer the higher-authority one (authority 1 = primary \
rulebook, most trustworthy; higher numbers less so; the primer is reliable for basics) \
and note the conflict if it matters.
- If neither the primer nor the retrieved passages cover the question, say you don't \
have that in the rules rather than inventing an answer. A clear "the rules provided \
don't cover this" is a good answer.

Do not be led by the question:
- The user may state or imply a rule, often as a leading question ("…right?", \
"otherwise it'll be X"). Treat every such assumption as UNVERIFIED. Check it against the \
passages and correct it if they disagree or are silent — never just agree to be agreeable.
- Distinguish carefully between similar-but-distinct terms. For example, "Spell Tokens" \
are erased at regroup but ordinary unit tokens are not; "leaving formation" is a \
positional reset, NOT the same as leaving play / being removed.

In threads (follow-up questions):
- Answer the MOST RECENT question. Earlier turns are background only; do not let a \
previous question's topic pull your answer off-course — if the new question is about \
something else, switch fully to it.
- The passages attached to the current question are the authoritative context for THIS \
answer. Prior answers may have relied on different passages; do not cite from memory.

Style: be concise, use Discord-friendly markdown, keep answers under ~250 words."""

# --- clients & indexes (loaded once at startup) --------------------------
retriever = Retriever()
cards = CardIndex()
# The DeepSeek client is built in __main__ once the API key is resolved (CLI arg
# or env), so the module can be imported without a key present (e.g. for tests).
ai: AsyncOpenAI | None = None

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


# --- RAG plumbing --------------------------------------------------------

def build_context(hits):
    blocks = []
    for _score, r in hits:
        blocks.append(
            f"[{r['id']}] (authority {r['authority']} — {r['authority_label']}; "
            f"source: {r['source']})\n{r['text']}")
    return "\n\n---\n\n".join(blocks)


# Citation tags look like [prefix:suffix] (e.g. [manual:0023], [card:Wisp]); card
# text uses tagless brackets like [Augment], so requiring a colon leaves those alone.
_HIST_CITE_RE = re.compile(r"\s*\[[^\[\]]*:[^\[\]]*\]")


def _strip_citations(text):
    """Remove our [tag] citations from text fed back as thread history — those
    tags point at passages no longer in context and only confuse the model."""
    return re.sub(r"[ \t]{2,}", " ", _HIST_CITE_RE.sub("", text)).strip()


# --- "math mode" detection ------------------------------------------------
# Stat block like 1/1, +2/+2, 3/4 — the strongest signal a question is numeric.
_STAT_RE = re.compile(r"[+\-]?\d+\s*/\s*[+\-]?\d+")
_NUM_RE = re.compile(r"[+\-]?\d+")
# Combat/arithmetic vocabulary; presence alongside numbers implies real math.
_MATH_WORDS = {
    "damage", "deal", "deals", "dealt", "take", "takes", "power", "toughness",
    "life", "mana", "cost", "buff", "buffed", "debuff", "excess", "remaining",
    "leftover", "overkill", "lethal", "survive", "survives", "kill", "kills",
    "die", "dies", "arc", "arcs", "split", "divide", "spread", "heal", "prevent",
    "fireball", "growth", "conjure", "electric", "trample", "regroup", "counter",
}
_QUANT_PHRASES = ("how much", "how many", "left over", "leftover", "add up",
                  "end up with", "1/0", "at regroup")


def needs_reasoning(question):
    """Heuristic: does this look like a numeric/combat-math question worth
    enabling DeepSeek thinking for? Conservative — a false positive just spends
    a little more on an easy question; a false negative falls back to normal."""
    ql = question.lower()
    if _STAT_RE.search(ql):                       # explicit stat/buff block
        return True
    nums = len(_NUM_RE.findall(ql))
    signals = sum(bool(re.search(rf"\b{w}\b", ql)) for w in _MATH_WORDS)
    signals += sum(p in ql for p in _QUANT_PHRASES)
    return (nums >= 1 and signals >= 2) or (nums >= 2 and signals >= 1)


def _use_reasoning(question):
    if REASONING_MODE == "always":
        return True
    if REASONING_MODE == "off":
        return False
    return needs_reasoning(question)


async def answer_question(question, history):
    """Retrieve, call DeepSeek, return (answer_text, hits, reasoning_used)."""
    hits = retriever.search(question, k=TOP_K)
    context = build_context(hits) if hits else "(no relevant passages found)"
    messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{PRIMER}"}]
    # Prior assistant turns are resent with their citation tags stripped (the
    # passages they referenced aren't in this call's context).
    for m in history[-MAX_HISTORY:]:
        if m["role"] == "assistant":
            messages.append({"role": "assistant",
                             "content": _strip_citations(m["content"])})
        else:
            messages.append(m)
    # Freshly retrieved passages for THIS question; the closing instruction keeps
    # follow-ups anchored on the current question rather than the thread's history.
    followup_note = (
        "\n\nThese passages were retrieved for the CURRENT question only — answer it "
        "directly using them, and don't assume earlier passages still apply."
        if history else "")
    messages.append({
        "role": "user",
        "content": (f"Retrieved passages:\n{context}\n\n"
                    f"Current question: {question}{followup_note}"),
    })
    reasoning = _use_reasoning(question)
    params = {"model": DEEPSEEK_MODEL, "messages": messages, "max_tokens": 900}
    if reasoning:
        # Thinking mode ignores temperature; ask for chain-of-thought reasoning.
        params["reasoning_effort"] = REASONING_EFFORT
        params["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        params["temperature"] = 0.2
    resp = await ai.chat.completions.create(**params)
    return resp.choices[0].message.content.strip(), hits, reasoning


# Friendly display names for sources, keyed by the chunk's `source` filename.
SOURCE_NAMES = {
    "Algomancy-Manual": "Official Manual",
    "Algomancy-Rulebook-2023-07": "2023 Rulebook",
    "Algomancy-Rules-Glossary.md": "Rules Glossary",
    "The-Rules-of-Algomancy.md": "The Rules of Algomancy (web)",
    "Mastering-Initiative-Strategy-Guide.md": "Mastering Initiative (guide)",
    "The-Making-of-Algomancy.md": "The Making of Algomancy (dev-log)",
    "AlgomancyCards-OracleText.json": "Card data",
}
_SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
# Bracketed citation groups: [tag], [tag; tag2], [a, b] — anything inside [].
_CITE_RE = re.compile(r"\[([^\[\]]+)\]")


def _sup(n):
    return str(n).translate(_SUPERSCRIPT)


def friendly_source(r):
    """A clean, human-readable name for a retrieved chunk's source."""
    if r["source_type"] == "card":
        return f"Card: {r['title']}"
    if r["source_type"] == "glossary":
        return f"Glossary: {r['title']}"
    stem = r["source"].rsplit("/", 1)[-1]
    return SOURCE_NAMES.get(stem, stem.rsplit(".", 1)[0].replace("-", " "))


def render_citations(answer, hits):
    """Turn the model's `[source:tag]` citations into clean footnote superscripts.

    Returns (display_text, ordered_sources) where ordered_sources is a list of
    (number, row) for the sources actually cited, in first-appearance order.
    Brackets that don't contain a known tag are left untouched.
    """
    by_id = {r["id"]: r for _s, r in hits}
    # Number by source *document* (friendly name) so multiple chunks of e.g. the
    # 2023 Rulebook share one footnote instead of cluttering the legend.
    order, number, rep = [], {}, {}

    def repl(m):
        nums = []
        for t in [x.strip() for x in re.split(r"[;,]", m.group(1))]:
            r = by_id.get(t)
            if r is None:
                continue
            key = friendly_source(r)
            if key not in number:
                order.append(key)
                number[key] = len(order)
                rep[key] = r
            nums.append(number[key])
        if not nums:
            return m.group(0)  # not one of our citations — leave it alone
        return "".join(_sup(n) for n in sorted(dict.fromkeys(nums)))

    text = _CITE_RE.sub(repl, answer)
    text = re.sub(r"\s+([.,;:)])", r"\1", text)   # tidy space left before punctuation
    text = re.sub(r"[ \t]{2,}", " ", text)
    sources = [(number[k], rep[k]) for k in order]
    return text.strip(), sources


def cited_card_files(answer, hits, limit=10):
    """discord.File art for each *card* the answer actually cited (with art),
    so the images can be posted in the thread for easy reference."""
    _display, sources = render_citations(answer, hits)
    files = []
    for n, r in sources:
        if r["source_type"] != "card":
            continue
        art = cards.art_path(r["title"])
        if art:
            files.append(discord.File(str(art), filename=f"cite{n}.jpg"))
        if len(files) >= limit:
            break
    return files


async def post_cited_cards(channel, answer, hits):
    """Post images of any cited cards into a thread/channel (no-op if none)."""
    files = cited_card_files(answer, hits)
    if files:
        await channel.send(content="**Cited cards** (referenced above):", files=files)


def answer_embed(question, answer, hits, reasoning=False):
    display, sources = render_citations(answer, hits)
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
    mode = f"{DEEPSEEK_MODEL} · 🧠 thinking" if reasoning else DEEPSEEK_MODEL
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
    store.log_response(rid, "ask", question, answer, hits, DEEPSEEK_MODEL,
                       user_id=ctx.author.id, channel_id=ctx.channel.id,
                       reasoning=reasoning)
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

# Card-text tokens -> custom-emoji NAME. [..] tokens are ability keywords,
# {..} tokens are attributes. (Edit these if the guild's emoji names differ —
# on_ready prints how many were loaded.)
ICON_NAMES = {
    "[augment]": "augment", "[switch1]": "bounded_graft", "[switch]": "graft",
    "[virus]": "virus", "[battle]": "battle", "[haste]": "haste",
    "{virus}": "virus", "{battle}": "battle", "{haste}": "haste",
}
# Affinity/cost letters -> faction emoji (verified from card data). Used only on
# the COST line — in card TEXT, {g}/{p} are attribute colours, not factions.
# NOTE: `p` = colorless (the Prismite resource); intentionally unmapped until the
# correct emoji name is confirmed (it is NOT `dark`), so it renders as "p" for now.
RESOURCE_NAMES = {
    "r": "fire", "m": "metal", "b": "water",
    "e": "earth", "g": "wood",
}
_TOKEN_RE = re.compile(r"\[[^\[\]]+\]|\{[^{}]+\}")


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
    if is_brace_attr:                # unknown {Attribute} -> drop braces
        return tok[1:-1]
    return tok                       # unknown [ability]/cost token -> leave as-is


def render_card_text(text):
    """Clean card oracle text / type line for Discord: convert formatting codes
    and swap game-icon tokens for custom emojis (falls back to text if absent)."""
    if not text:
        return text
    t = text.replace("{/n}", "\n")
    t = re.sub(r"\{/?i\d*\}", "", t)              # italic markers {i} {i1} {/i}
    t = t.replace("{g}", "").replace("{p}", "")   # attribute colour markers (gold/purple)
    return _TOKEN_RE.sub(_sub_token, t)


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


@bot.command(name="card")
async def card_cmd(ctx, *, name: str = None):
    if not name:
        await ctx.reply("Usage: `&card <card name>`  ·  or several: `&card Name1, Name2, Name3`")
        return

    # No card name contains a comma, so it's a safe separator for multi-lookup.
    queries = [q.strip() for q in name.split(",") if q.strip()]
    if len(queries) > MAX_CARDS:
        await ctx.reply(f"That's {len(queries)} cards — I can only show {MAX_CARDS} at once. "
                        f"Showing the first {MAX_CARDS}.")
        queries = queries[:MAX_CARDS]

    embeds, files, not_found = [], [], []
    for i, q in enumerate(queries):
        card, matched, alts = cards.lookup(q)
        if not card:
            not_found.append(q)
            continue
        embed, file = build_card_embed(card, matched, alts, attach_name=f"card{i}.jpg")
        embeds.append(embed)
        if file:
            files.append(file)

    if not embeds:
        await ctx.reply(f"No card found matching **{name}**.")
        return

    content = None
    if not_found:
        content = "Couldn't find: " + ", ".join(f"**{n}**" for n in not_found)
    await ctx.reply(content=content, embeds=embeds, files=files)


@bot.command(name="help")
async def help_cmd(ctx):
    e = discord.Embed(title="Algomancy Rules Bot", color=0x5865F2, description=(
        "**`&ask <question>`** — Ask a rules question. I answer from the official "
        "rules corpus with citations, then open a thread for follow-ups.\n\n"
        "**`&card <name>`** — Look up a card (fuzzy matched) with art, stats, and rulings. "
        "Look up several at once with commas: `&card Sprouter, Overbloom, Plodding Pebble`.\n\n"
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
        store.log_response(rid, "followup", message.content, answer, hits, DEEPSEEK_MODEL,
                           user_id=message.author.id, channel_id=message.channel.parent_id,
                           thread_id=message.channel.id, history=list(history),
                           reasoning=reasoning)
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
    print(f"Logged in as {bot.user} · model={DEEPSEEK_MODEL} · "
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
    ap.add_argument("--model", help=f"DeepSeek model id (default: {DEEPSEEK_MODEL})")
    args = ap.parse_args()

    deepseek_key = args.deepseek_key or os.getenv("DEEPSEEK_API_KEY")
    token = args.discord_token or os.getenv("DISCORD_TOKEN")
    if not deepseek_key or not token:
        raise SystemExit(
            "Usage: python3 bot.py <DEEPSEEK_API_KEY> <DISCORD_TOKEN>\n"
            "(either value may instead come from DEEPSEEK_API_KEY / DISCORD_TOKEN env vars).")
    if args.model:
        DEEPSEEK_MODEL = args.model

    ai = AsyncOpenAI(api_key=deepseek_key, base_url=DEEPSEEK_BASE)
    bot.run(token)
