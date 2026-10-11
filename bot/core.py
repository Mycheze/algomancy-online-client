#!/usr/bin/env python3
"""
core.py — the shared Algomancy rules "brain".

This is the framework-agnostic RAG core: retrieval (BM25 over the rules corpus),
the verified rules primer, the system prompt, the model call (any OpenAI-compatible
API; DeepSeek by default) with the "math mode" reasoning router, retry/fallback
and per-call usage/cost measurement, and citation rendering. It knows nothing about Discord or
HTTP — both `bot.py` (Discord) and `app.py` (web) import from here so there is a
single brain behind every front-end.

Call `init_client(api_key, ...)` once at startup before `answer_question`.
"""

import hashlib
import asyncio
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import openai
from openai import AsyncOpenAI

from cards import CardIndex
import crnotes
import retriever as retr
from retriever import CORPUS, Retriever


def _env(name, default=None):
    """`LLM_<name>`, else the pre-2026-10-11 `DEEPSEEK_<name>`, else `default`.

    ⚠ THE OLD NAMES ARE A FALLBACK, NOT DEPRECATED NOISE. The deployed `.env`
    on the VPS says DEEPSEEK_API_KEY (and maybe DEEPSEEK_MODEL/_TIMEOUT); it has
    to keep working, unedited, the day this lands. An empty value counts as
    unset, the way `.env.example`'s blank lines are meant."""
    for key in (f"LLM_{name}", f"DEEPSEEK_{name}"):
        v = os.getenv(key)
        if v is not None and v.strip() != "":
            return v.strip()
    return default


def api_key():
    """The primary model's API key, from the environment only — never argv (see
    the note in bot.py's __main__)."""
    return _env("API_KEY")


# Any OpenAI-compatible chat-completions endpoint. `deepseek-flash` is the
# current name for V4.1 Flash; `deepseek-v4-flash` (the default until
# 2026-10-11) is a retired alias DeepSeek still routes to the same model.
LLM_MODEL = _env("MODEL", "deepseek-flash")
LLM_BASE_URL = _env("BASE_URL", "https://api.deepseek.com")
# Kept under the old names: discordui.py's footer and older callers read them.
DEEPSEEK_MODEL = LLM_MODEL
DEEPSEEK_BASE = LLM_BASE_URL
# Optional second model, tried ONCE in place of the retry when the primary times
# out, errors 5xx/429, drops the connection or returns an empty answer. Its base
# URL and key default to the primary's.
FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL") or None
FALLBACK_BASE_URL = os.getenv("LLM_FALLBACK_BASE_URL") or None
FALLBACK_API_KEY = os.getenv("LLM_FALLBACK_API_KEY") or None
MAX_HISTORY = 8       # how many prior turns to resend as conversation context
# 10, not 6: the rulings corpus is dense enough that 6 slots could be swept
# entirely by edge-case rulings, leaving no room for the base rule they modify.
# 10 slots + retriever's FOUNDATION_FLOOR keeps both on the table.
TOP_K = 10             # chunks retrieved per question

# "Math mode": stat/arithmetic questions (combat damage, buffs, Electric arcing,
# Fireball-vs-Growth, regroup math) benefit from DeepSeek's thinking mode. We
# auto-detect them and enable thinking only then, so the cost hits just the
# questions that need it. LLM_REASONING: "auto" (detect) | "off" | "always".
REASONING_MODE = _env("REASONING", "auto").lower()
REASONING_EFFORT = _env("REASONING_EFFORT", "high")

# --- time budget ----------------------------------------------------------
# ⚠ THE GAME SERVER'S /api/judge PROXY GIVES UP AT 60 s (client/server/main.ts,
# AbortSignal.timeout(60000)). Everything below has to fit inside it.
#
# ⚠ AND AN httpx TIMEOUT DOES NOT BOUND A DEEPSEEK CALL. DeepSeek keeps a
# queued non-streaming request alive by sending blank lines until inference
# starts (up to 10 minutes — api-docs.deepseek.com, "Rate Limit"), and httpx's
# timeout is per read, so every blank line resets it. The 60 s DEEPSEEK_TIMEOUT
# this replaced could therefore never fire on exactly the requests it was for,
# and the SDK's two default retries stacked on top of it. So: each attempt is
# bounded by the wall clock (asyncio.wait_for), the SDK does no retrying of its
# own (max_retries=0), and core makes at most TWO attempts — the primary, then
# either a retry of it or the fallback model — inside one LLM_DEADLINE.
#
# The numbers: a non-thinking answer is ~400 tokens at ~220 tok/s plus ~1 s
# to first token on a ~10k-token prompt, so ~3 s; a "math mode" answer may
# think through its whole 4000-token budget, ~20 s. LLM_TIMEOUT=25 s covers
# that with headroom, and two of them (50 s) plus retrieval sit under a 55 s
# deadline, which leaves the proxy ~5 s for the response to travel back.
# The deadline wins over the per-attempt figure: a deploy that still sets
# DEEPSEEK_TIMEOUT=60 gets one attempt clamped to 55 s and no retry.
MODEL_TIMEOUT = float(_env("TIMEOUT", "25"))
LLM_DEADLINE = float(os.getenv("LLM_DEADLINE") or "55")
# An attempt is not started with less than this left: it could not finish.
MIN_ATTEMPT_S = 3.0

# Core-rules digest, always supplied to the model so it has footing even when
# retrieval misses. The model states these facts WITHOUT a [tag], so every line
# here must be quotable from a source (Manual, card text, a RAQ ruling or the
# Comprehensive Rules). Audited claim by claim on 2026-10-11 (see
# RAG-CHANGELOG.md); `bot/test/test_primer.py` fails on known-false statements.
# Keep it short: the specifics come from retrieved CR chunks, which cite.
PRIMER = """Core Algomancy primer (basic rules — reliable background):
- Algomancy is a card game by Caleb Gannon, played as a live draft (one shared \
deck, drafted during the game), as constructed (each player brings a deck) and in \
other formats. Its factions are called ELEMENTS. The printed Manual names five: \
Fire, Water, Earth, Wood and Metal. The Light & Dark expansion adds Light and Dark, \
so the current card pool has SEVEN elements. A hybrid card belongs to two elements.
- Resources: each is expended (turned sideways) for 1 mana, once per turn. A card's \
element pips are its affinity requirement (the 2023 Rulebook says "threshold"): you \
need that many resources of that element. Meeting affinity uses nothing up, and \
expended resources still count. Prismites and Shards give no affinity.
- Goal: eliminate all your opponents by bringing their life to 0 (in a team game, \
the entire opposing team). Each player begins with 30 life.
- A turn has four phases IN THIS ORDER: (1) Planning — refresh, draw, draft, \
resource step, haste step; (2) Battle — attacks, blocks, combat damage; (3) \
Regroup; (4) Deployment — players play most of their cards and apply mods; then \
the end-of-turn step. Regroup comes BEFORE deployment, not at the end of the turn. \
The battle phase happens every turn, but attacking is optional: in a region nobody \
attacks, the combat and after-combat steps are skipped, and in 1v1 the \
non-initiative player may still attack in round 2 if the initiative player did not.
- Regions: there is one per player, all gameplay happens inside them, and an effect \
never reaches another region. Battle is the only phase in which players interact: \
outside it everyone is alone in their own region, so you cannot target or affect an \
opponent's cards outside battle. (The old glossary's "skirmish" is now "region".)
- Regroup has no player actions. In order: units return to their own regions; all \
damage on units is removed; all temporary stat changes ("until regroup") end; all \
units leave formation. All spell tokens are erased. Damage goes before the buff \
ends, so a 1/1 buffed to 3/3 until regroup that took 1 damage is a healthy 1/1 \
afterwards, not a 1/0. Unit tokens are NOT erased at regroup. Leaving formation is \
not leaving play: a unit can be in a region without being in a formation.
- Formations: attacking and blocking units stand in columns; a column holds at most \
two units, front and back, and the front is filled first. Adjacent means left, \
right, front or back in the same formation, never diagonal. COMBAT attributes \
(printed in gold) are shared by every unit in the column, and lost at once when the \
unit sharing them leaves; NON-COMBAT attributes (purple: Burst, Unstable, Modular) \
are not shared.
- In 1v1 and team games the initiative team attacks first and the other team may \
then counterattack; in free-for-all everyone declares attacks at once with intent \
cards. The initiative passes clockwise when the turn is over.
- Mods (Augment and Graft): applying one is a special action during DEPLOYMENT, \
from your HAND or your BIN, paying its mana cost and meeting its affinity. The mod \
goes beneath its host and becomes part of it. In deployment you can mod only your \
own units. A Virus can also be applied as an augment from your hand during battle, \
onto any unit in that region, an opponent's too; the host's controller then controls \
the mod and its text. A modded card is Unstable; if it is returned to hand, its \
mods go to the bin. (The old Rules Glossary's "the card must be in your discard" \
and graft "on top or beneath" are outdated.)
- Applying a mod is NOT playing a card: only units and spells are played, so a \
"when you play a unit/spell/card" ability does not trigger on a mod, even one from \
the bin.
- The augment symbol at the start of a text-box paragraph gives the host that \
paragraph; on the TYPE LINE it gives the host the attributes on that type line (no \
stats, no subtypes). Chitin Shredder ("[Augment] {Powerful} Insect {Virus} Unit", \
no rules text) makes its host Powerful. Check the type line before saying a card \
cannot be augmented.
- Graft: both cards need the graft symbol, and the host must be a unit in play with \
a graft cause of its own. The host stays on top and its cause decides when the \
combined ability fires: "cause: effect 1 AND effect 2 …", one ability resolving top \
to bottom. A new graft may go at any position below the host's own card; grafts \
already applied cannot be re-ordered. [Switch] is unbounded (any number of times); \
[Switch1] is bounded (once per turn).
- Square brackets: [Switch], [Switch1], [Augment], [Battle], [Virus], [Haste] and \
[once] are symbols, never costs. Other bracketed text in a text box is an \
additional cost or a choice between modes, paid or chosen to play the card.

Keywords — the printed reminder text, which is reliable:
- Flying: "Only flying units can block flying units." Deadly: "Any damage from a \
deadly source will kill a unit." Powerful: "Powerful sources deal double damage".
- Swift: "Swift units deal combat damage first." Sluggish: "Sluggish units deal \
combat damage last." A unit with both deals combat damage twice.
- Piercing: "Excess damage from piercing sources is dealt to the recipient's \
controller." Electric: "Excess damage from electric sources can be directed to an \
adjacent unit, recursively." Poisonous: "Poisonous sources damage units in the \
form of -1/-1 counters."
- Tough: defense doubled. Vulnerable: dealt double damage. Feeble: can't block. \
Evasive: "Evasive units require two blockers." Sneaky: "Sneaky units can't be \
blocked if attacking alone." Alluring: "When an alluring column attacks, target \
enemy can't attack and must block it this combat if able."
- Resonant: "Whenever a resonant source deals damage to a unit, it deals that much \
damage to that unit's controller." Thieving: "Whenever a thieving source deals \
combat damage to an opponent, draw a card." Reaping: "When a reaping source kills \
one or more units, draw a card. It loses reaping until regroup."
- Balanced: "The power and defense of balanced units are equal to the greater of \
the two." Inverted: "Invert the stat changes of inverted units." Unaware: an \
Unaware card, and every card interacting with it, ignores all stat changes.
- Haste: can be played during the haste step as well as during deployment. Battle: \
can be played only while its player is in battle with another player (you attack, \
counterattack or are attacked), never in deployment. Virus: can also be applied as \
an augment from your hand during battle. Ambush: play the unit during battle for \
the cost beside the keyword: "Recall target ally, put me into their position in \
play."
- Burst (on spell tokens): casting one casts every spell token of the same NAME you \
control in that region at the same time. Unstable: if the card would enter a bin \
from play or the stack, it is erased instead (from a hand, deck or cache it goes to \
the bin normally).
- "Devastating" is not a current attribute; no current card prints "Conjure".

Light & Dark expansion (163 cards, two new elements). No official rulebook or errata \
has shipped for it, and its card text is transcribed from card images. Treat the \
lines below as PROVISIONAL — say so when you rely on them; they are sourced, but not \
settled.
- Blessed: "Damage dealt by a blessed source causes its controller to gain that \
much life." The gain is simultaneous with the damage, so a blessed source cannot \
kill its own controller. Afflicting: "When an afflicting source kills one or more \
units, those units' controllers gain a rot." Killing with -1/-1 counters counts. \
Lethal: "Any combat damage from a lethal unit will kill a player." Pure: "Pure \
cards and cards they are interacting with ignore all other attributes." Modular: \
"You can apply mods to a modular card from your hand and/or bin as it is played. \
You still pay their costs."
- Rot is a counter on a PLAYER: at the start of each deployment phase you are dealt \
damage equal to your rot, and no one can respond to it. Rot never goes away on its \
own (only an effect that removes counters, like Burn the Blight, clears it). Your \
own rot is a source you control.
- Debt is a counter on a player: at the end of each of your resource steps you pay 1 \
mana per debt, removing it; you cannot activate mana after paying. Debt you cannot \
pay stays for your next resource step; there is no other penalty.
- Prophecy: a banner reading "Prophecy — <condition>" with its own cost. To \
prophesy, pay that cost during deployment and cache the card; the condition counts \
forward from that moment. Once it is fulfilled, the card may be played from the \
cache for free, ignoring affinity, as if it were in your hand. In 1v1 both battles \
of a turn count toward "One Battle Passes".
- Cache: a zone of its own beside the hand, bin and deck. Being cached does not by \
itself let you do anything with a card; it needs a live permission (a fulfilled \
prophecy, or a glimpse this turn), and then it can be played or applied as a mod: \
free and ignoring affinity under a prophecy, its mana cost but ignoring affinity \
under a glimpse. A cached card with no permission just stays there. A unit cached \
from play sends its mods to the bin.
- Glimpse N: reveal the top N cards of the deck, cache one, recycle the rest. Until \
end of turn you may play the cached card as if it were in your hand, ignoring \
affinity, but you still pay its cost and obey its timing.
- Trashed: "A nontoken card entering a bin from anywhere other than the stack is \
trashed." Discarding, sacrificing, milling and dying into the bin are trashing. NOT \
trashing: a spell going to the bin from the stack (resolved or negated), erasing (an \
erased card never enters a bin), and any TOKEN — a dying unit token does enter the \
bin, so abilities that watch the bin see it, and is then erased, but it is not \
trashed and fires no "when ... trashed" ability. The player whose bin the card \
enters trashes it.
- Wraith (the same token as "Wight", the old name Blight's End still prints): a \
0-cost 3/3 Blight Zombie Token Unit, "[Augment] At the start of deployment, put a \
-1/-1 counter on an ally. When I die, Augment a Wraith onto an ally." Most cards \
create it directly as an augment on a unit. The dying Wraith is erased like any \
token; its trigger makes a NEW one. An older 4/4 printing that shrank when it \
attacked or blocked is obsolete."""

SYSTEM_PROMPT = """You are the Algomancy Rules Bot, an expert assistant for the \
card game Algomancy by Caleb Gannon. Answer using TWO trusted sources only: (1) the \
Core Primer of basic rules below — verified and always reliable; and (2) the retrieved \
passages provided with each question, which cover the specifics. Do not use outside \
knowledge about other card games or invent rules beyond these two sources.

Grounding and citations:
- The primer is general background: state it freely WITHOUT a [tag]. Attach a [tag] only \
to a claim drawn DIRECTLY from a retrieved passage, e.g. "Grafts can only go onto other \
graft cards [rulebook23:0026]."
- Copy each [tag] EXACTLY as it heads its passage ([manual:0023], [card:Temporal Rift], \
[ruling:raq-1353859961855148103]). Never make up a tag, shorten one, or cite a passage \
you were not given.
- If you are reasoning or inferring something neither the primer nor the passages state \
explicitly, present it as an inference ("the rules don't state this directly, but…") and \
do NOT attach a citation.
- A card's own text in the passages is authoritative for what THAT card does — read it \
carefully and apply it literally before reaching for general rules.
- When sources disagree, prefer the LOWER authority number — that is the more \
trustworthy source. The ladder: 0 = a Discord ruling (an answer given in the game's \
official Discord, by the designer or an experienced judge), which is DEFINITIVE and \
overrides every other source, including the rulebook; 1 = primary rulebook, card text, \
official judge write-ups, and Comprehensive Rules that rest on print or the designer; \
2 = official glossary, and Comprehensive Rules marked "owner call" or "digital-client \
convention"; 3 = the older 2023 rulebook; 4-5 = web write-ups and design blogs, which \
are frequently outdated. The primer is reliable for basics. A Discord ruling that \
contradicts an older rulebook means the game CHANGED, not that the ruling is wrong — \
follow the ruling and say so.

The Comprehensive Rules (passages tagged [cr:…]):
- They are an UNOFFICIAL numbered rulebook written for this project's online client, not \
Caleb Gannon's rulebook. Use them for precise statements, and name the rule in your prose \
as "CR 608.2b" (the number printed in the passage) as well as giving a [tag]: the \
passage's own tag, or — for a subrule printed INSIDE a retrieved passage — that subrule's \
number, e.g. [cr:608.2b] from the passage tagged [cr:608.2]. Never tag a rule number that \
no retrieved passage prints.
- They LOSE to the Manual, to card text and to a Discord ruling: where a CR passage \
conflicts with one of those, follow the higher source and say the CR differs.
- "owner call": this project's own ruling where no printed or designer source decides. \
Give it, but say it is an unofficial ruling.
- "digital-client convention": how the online client handles something players at a table \
would simply agree on. Each such passage carries an instruction on how to present it — \
follow it.
- A passage marked [Open question: …] is unsettled; say so rather than presenting it as \
settled.
- A passage may end with "⚠ Open review note (owner|judge, date): …". That is a reviewer \
flagging that the rule above it may be WRONG and is waiting to be fixed. It is a lead, \
not a source: never state the note as the rule. Mention the uncertainty, and prefer a \
higher source if one was retrieved.
- If neither the primer nor the retrieved passages cover the question, say you don't \
have that in the rules rather than inventing an answer. A clear "the rules provided \
don't cover this" is a good answer.
- The Light & Dark expansion has NO official rules release yet. Its card text was \
transcribed from card images, and any passage labelled "Light & Dark provisional \
glossary" — or a primer line marked provisional — is a best reading from printed \
reminder text and the designer's Discord messages, NOT settled rules. When you rely on \
one, say plainly that it is provisional and may change when the official release ships. \
Where such a source explicitly marks a point UNCONFIRMED, do not fill the gap with a \
guess — say it is not documented yet. But where it DOES state a rule and names its \
source (card text or a dated designer message), answer it directly: rot's timing, what \
"trashed" means, the Wraith/Wight token, prophecy and debt are all sourced now, so flag \
them as provisional but do NOT hedge them as unknown. The Comprehensive Rules are NEWER \
than the provisional glossary: where the two conflict on a Light & Dark point, follow the \
Comprehensive Rules passage, even one marked "owner call". Note that a sourced L&D point can still be SUPERSEDED when the card is \
redesigned — the Wraith is a 3/3 as of 2026-08-21, and any passage describing a 4/4 \
Wraith/Wight is an older printing; prefer the primer and the newest-dated source.

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

Style: be concise, use clean markdown, keep answers under ~250 words."""

# --- engine version stamp ------------------------------------------------
# Every logged answer is stamped with ENGINE_VERSION so we can tell, after the
# fact, exactly which rules brain produced it — essential when triaging feedback
# ("is this 👎 from the old prompt or the current one?"). The version is a
# hand-bumped date plus content hashes of the two things that actually change an
# answer: the prompt+primer (generation behaviour) and the corpus (retrieval
# data). Any edit to either flips its hash automatically, so a stale stamp can't
# survive an un-bumped date, and a `p…` change (prompt) is distinguishable from a
# `c…` change (data) at a glance. Bump ENGINE_DATE + add a line to
# ENGINE_CHANGELOG.md whenever you make a real behavioural change. See that file
# for the history; responses logged before this field existed have no stamp.
ENGINE_DATE = "2026-10-11"


# Prepended to the final user turn in a thread. The earlier turns are context for
# resolving pronouns and "wait, so…" — they are not open questions.
FOLLOWUP_NOTE = (
    "This is a follow-up in an ongoing thread. The earlier turns are BACKGROUND "
    "ONLY — do NOT re-answer an earlier question. The passages above were retrieved "
    "for the CURRENT question below; answer only that question, directly.\n\n"
)

# R297 — Learn to Play: the digital client's lesson window sends the lesson the
# player is reading along with their question, so "what does that mean?" is
# answered about the lesson and not in a vacuum. The lesson is a teaching
# SUMMARY written for new players; it is context for the question, not a rules
# source, and the retrieved passages outrank it wherever they disagree.
LESSON_NOTE = (
    "The player is reading this Learn to Play lesson in the digital client and is "
    "asking about it. It is a simplified teaching summary, NOT a rules source: use it "
    "to understand what they are asking, answer at a beginner's level, and where it "
    "and the retrieved passages disagree, the passages win.\n"
)


def _sig(*parts):
    """Short stable content hash of the given text/bytes parts."""
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode("utf-8"))
    return h.hexdigest()[:8]


PROMPT_SIG = _sig(SYSTEM_PROMPT, PRIMER, FOLLOWUP_NOTE, LESSON_NOTE)
try:
    CORPUS_SIG = _sig(Path(CORPUS).read_bytes())
except OSError:
    CORPUS_SIG = "nocorpus"
# Retrieval knobs are a third axis of behaviour: the same prompt over the same
# corpus answers differently if the slate it sees changes. Hashing them means a
# tuning change (TOP_K, authority boosts, the foundational floor) is visible in
# the logs instead of masquerading as an unchanged engine.
RETRIEVAL_SIG = _sig(TOP_K, retr.BM25_K1, retr.BM25_B, retr.OUTDATED_PENALTY,
                     retr.FUZZY_CUTOFF, retr.FUZZY_WEIGHT, retr.FOUNDATION_FLOOR,
                     sorted(retr.AUTH_BOOST.items()),
                     sorted(retr.FOUNDATION_TYPES))
ENGINE_VERSION = f"{ENGINE_DATE}.p{PROMPT_SIG}.c{CORPUS_SIG}.r{RETRIEVAL_SIG}"

# --- indexes & client (loaded once at startup) ---------------------------
retriever = Retriever()
cards = CardIndex()
# The model client is built by init_client() once the API key is resolved (from
# the environment), so this module can be imported without a key (e.g. tests).
ai: AsyncOpenAI | None = None
ai_fallback: AsyncOpenAI | None = None


def init_client(api_key, base_url=None, model=None):
    """Build the model client (and the fallback's, when LLM_FALLBACK_MODEL is
    set), optionally overriding the model. Call once at startup before
    answer_question. Returns the primary client."""
    global ai, ai_fallback, LLM_MODEL, LLM_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_BASE
    if base_url:
        LLM_BASE_URL = DEEPSEEK_BASE = base_url
    if model:
        LLM_MODEL = DEEPSEEK_MODEL = model
    # ⚠ timeout: the SDK's default is 600 s. This httpx-level figure still
    # catches a dead socket, but it is NOT what bounds a call — see the time
    # budget note at the top: _complete() wraps every attempt in the wall
    # clock. max_retries=0 because the retry is core's, inside the deadline.
    ai = AsyncOpenAI(api_key=api_key, base_url=LLM_BASE_URL,
                     timeout=MODEL_TIMEOUT, max_retries=0)
    ai_fallback = None
    if FALLBACK_MODEL:
        fb_base = FALLBACK_BASE_URL or LLM_BASE_URL
        fb_key = FALLBACK_API_KEY or api_key
        ai_fallback = (ai if (fb_base == LLM_BASE_URL and fb_key == api_key)
                       else AsyncOpenAI(api_key=fb_key, base_url=fb_base,
                                        timeout=MODEL_TIMEOUT, max_retries=0))
    return ai


# --- providers: the request extras that differ between OpenAI-compatible APIs --
# Keyed by base-URL host (LLM_PROVIDER forces one, for a proxy or a local box).
# Each entry answers: what turns thinking OFF, what turns it ON at an effort,
# and whether `temperature` is sent alongside reasoning.
#
# ⚠ DEEPSEEK'S "off" IS NOT OPTIONAL. Flash is a hybrid model that thinks BY
# DEFAULT (effort high, per the Thinking Mode guide). Not merely leaving
# thinking unrequested but explicitly disabling it is what keeps the cheap path
# from spending its whole 900-token budget on hidden reasoning and returning
# empty content (finish_reason=length). Thinking mode ignores temperature.
#
# OpenRouter (openrouter.ai/docs, "Reasoning Tokens"): `reasoning.effort:
# "none"` disables it; `{effort, exclude: true}` reasons without returning the
# chain. A model flagged `mandatory` rejects "none" — choose another model.
#
# Anything else gets the generic entry: nothing sent to switch thinking off
# (there is no standard), top-level `reasoning_effort` to switch it on. A model
# there that reasons by default shows up as empty answers in the log
# (attempts[].error = "empty …") — give its host an entry here.
PROVIDERS = {
    "deepseek": {
        "hosts": ("api.deepseek.com",),
        "off": lambda: {"extra_body": {"thinking": {"type": "disabled"}}},
        "on": lambda effort: {"reasoning_effort": effort,
                              "extra_body": {"thinking": {"type": "enabled"}}},
        "temperature_with_reasoning": False,
    },
    "openrouter": {
        "hosts": ("openrouter.ai",),
        "off": lambda: {"extra_body": {"reasoning": {"effort": "none"}}},
        "on": lambda effort: {"extra_body": {"reasoning": {"effort": effort,
                                                           "exclude": True}}},
        "temperature_with_reasoning": False,
    },
    "generic": {
        "hosts": (),
        "off": lambda: {},
        "on": lambda effort: {"reasoning_effort": effort},
        "temperature_with_reasoning": False,
    },
}


def provider_for(base_url):
    """The PROVIDERS key for a base URL (LLM_PROVIDER overrides)."""
    forced = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if forced in PROVIDERS:
        return forced
    host = (urlparse(base_url or "").hostname or "").lower()
    for name, p in PROVIDERS.items():
        if any(host == h or host.endswith("." + h) for h in p["hosts"]):
            return name
    return "generic"


def request_params(base_url, reasoning, effort=None):
    """Token budget, temperature and the provider's thinking switch for one call."""
    p = PROVIDERS[provider_for(base_url)]
    if reasoning:
        # Hidden reasoning tokens count against max_tokens, so the budget must
        # cover the chain-of-thought AND the visible answer.
        params = {"max_tokens": 4000, **p["on"](effort or REASONING_EFFORT)}
        if p["temperature_with_reasoning"]:
            params["temperature"] = 0.2
    else:
        params = {"max_tokens": 900, "temperature": 0.2, **p["off"]()}
    return params


# --- usage & cost -----------------------------------------------------------
# ONE price table. USD per 1M tokens at the provider's standard (peak) rate:
# input on a cache miss, input on a cache hit, output (reasoning tokens bill as
# output). From api-docs.deepseek.com/quick_start/pricing, fetched 2026-10-11.
# A model not in this table gets cost_usd = null — never a guess. A provider
# that reports its own charge (OpenRouter's usage.cost) is believed over this.
PRICES = {
    "deepseek-flash":    {"in": 0.30, "cached": 0.006, "out": 1.20, "offpeak": "deepseek"},
    # retired alias, routed to and billed as V4.1 Flash
    "deepseek-v4-flash": {"in": 0.30, "cached": 0.006, "out": 1.20, "offpeak": "deepseek"},
    "deepseek-v4-pro":   {"in": 1.32, "cached": 0.044, "out": 3.96, "offpeak": "deepseek"},
}


def deepseek_peak(when):
    """DeepSeek bills full rate 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday,
    and half everywhere else. ⚠ Chinese public holidays are also off-peak and
    are NOT modelled: on those days the logged cost is twice the real one."""
    when = when.astimezone(timezone.utc)
    return when.weekday() < 5 and (1 <= when.hour < 4 or 6 <= when.hour < 10)


def _field(obj, name):
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def read_usage(resp):
    """Normalise resp.usage across providers to {prompt, cached, completion,
    reasoning} (None where the provider did not say), plus its reported cost."""
    u = _field(resp, "usage")
    if u is None:
        return None, None
    cached = _field(u, "prompt_cache_hit_tokens")                         # DeepSeek
    if cached is None:
        cached = _field(_field(u, "prompt_tokens_details"), "cached_tokens")  # OpenAI-style
    usage = {
        "prompt": _field(u, "prompt_tokens"),
        "cached": cached,
        "completion": _field(u, "completion_tokens"),
        "reasoning": _field(_field(u, "completion_tokens_details"), "reasoning_tokens"),
    }
    reported = _field(u, "cost")
    return usage, (float(reported) if isinstance(reported, (int, float)) else None)


def cost_usd(model, usage, when=None, reported=None):
    """(cost, basis) for one call. basis is "provider", "peak", "offpeak", or
    None when the cost is unknown (cost None too)."""
    if reported is not None:
        return round(reported, 8), "provider"
    price = PRICES.get(model)
    if not price or not usage or usage.get("prompt") is None or usage.get("completion") is None:
        return None, None
    cached = usage.get("cached") or 0
    dollars = ((usage["prompt"] - cached) * price["in"] + cached * price["cached"]
               + usage["completion"] * price["out"]) / 1_000_000
    basis = "peak"
    if price.get("offpeak") == "deepseek" and not deepseek_peak(when or datetime.now(timezone.utc)):
        dollars, basis = dollars / 2, "offpeak"
    return round(dollars, 8), basis


class _Retryable(Exception):
    """An attempt failed in a way worth one more try (or the fallback)."""


async def _attempt(client, model, base_url, messages, reasoning, timeout):
    params = {"model": model, "messages": messages, **request_params(base_url, reasoning)}
    try:
        resp = await asyncio.wait_for(client.chat.completions.create(**params), timeout)
    except (asyncio.TimeoutError, openai.APITimeoutError):
        raise _Retryable("timeout")
    except openai.APIConnectionError as exc:
        raise _Retryable(f"connection: {exc}")
    except openai.APIStatusError as exc:
        if exc.status_code >= 500 or exc.status_code == 429:
            raise _Retryable(f"http {exc.status_code}")
        raise                      # 4xx: a bad key or request; another try won't help
    answer = (resp.choices[0].message.content or "").strip()
    if not answer:
        raise _Retryable(f"empty (finish_reason={resp.choices[0].finish_reason})")
    return answer, resp


async def _complete(messages, reasoning, meta, start):
    """Up to two attempts inside LLM_DEADLINE (counted from `start`, a
    time.monotonic() taken before retrieval): the primary, then the fallback
    model if one is configured, else the primary once more. Fills `meta` with
    what the log needs and returns the answer text."""
    plan = [("primary", ai, LLM_MODEL, LLM_BASE_URL)]
    if ai_fallback is not None:
        plan.append(("fallback", ai_fallback, FALLBACK_MODEL, FALLBACK_BASE_URL or LLM_BASE_URL))
    else:
        plan.append(("retry", ai, LLM_MODEL, LLM_BASE_URL))
    attempts = []
    for kind, client, model, base in plan:
        remaining = LLM_DEADLINE - (time.monotonic() - start)
        if remaining < MIN_ATTEMPT_S:
            break
        t0 = time.monotonic()
        try:
            answer, resp = await _attempt(client, model, base, messages, reasoning,
                                          min(MODEL_TIMEOUT, remaining))
        except _Retryable as exc:
            attempts.append({"kind": kind, "model": model, "error": str(exc),
                             "ms": round((time.monotonic() - t0) * 1000)})
            print(f"[llm] {kind} {model}: {exc}")
            continue
        ms = round((time.monotonic() - t0) * 1000)
        attempts.append({"kind": kind, "model": model, "error": None, "ms": ms})
        usage, reported = read_usage(resp)
        cost, basis = cost_usd(model, usage, reported=reported)
        meta.update({
            "model": model,
            "requested_model": LLM_MODEL,
            "provider": provider_for(base),
            "latency_ms": ms,
            "usage": usage,
            "cost_usd": cost,
            "cost_basis": basis,
            "fallback": ({"from": LLM_MODEL, "reason": attempts[0]["error"]}
                         if kind == "fallback" else None),
            "attempts": attempts,
        })
        return answer
    meta["attempts"] = attempts
    why = "; ".join(f"{a['kind']} {a['model']}: {a['error']}" for a in attempts) or "no time left"
    if attempts and all(a["error"] == "timeout" for a in attempts):
        raise TimeoutError(f"model timed out ({why})")
    raise RuntimeError(f"model gave no answer ({why})")


# --- RAG plumbing --------------------------------------------------------

def lesson_block(context):
    """The Learn to Play lesson as a labelled block for the final user message
    (R297), or '' when there is none."""
    context = (context or "").strip()
    if not context:
        return ""
    return f"{LESSON_NOTE}<lesson>\n{context}\n</lesson>\n\n"


# Where the answer will be read. A "digital-client convention" passage (Annex D,
# or a rule the CR scopes to the online client) is said differently on each:
# inside the client, the convention simply IS how the game plays; on Discord the
# reader may be playing at a table, where players agree such things themselves.
# The game server's /api/judge and the bot's own web page are both "web".
SURFACES = ("web", "discord")
DIGITAL_NOTE = {
    "web": ("digital-client convention: the reader is in the online client, so state "
            "this plainly as how the game plays here"),
    "discord": ('digital-client convention: when you rely on it, say it is how it works '
                '"in the online client; tabletop may differ"'),
}


def build_context(hits, surface="web", notes_used=None):
    """The passages block. A CR passage carries its label, its digital-client
    instruction for `surface`, and any open review note (crnotes); the note ids
    are appended to `notes_used` when a list is passed."""
    note_of = DIGITAL_NOTE.get(surface, DIGITAL_NOTE["web"])
    blocks = []
    for _score, r in hits:
        label = r["authority_label"]
        if r.get("source_type") == "cr" and (r.get("metadata") or {}).get("scope") == "digital":
            label = f"{label} — {note_of}"
        text = r["text"]
        for n in crnotes.NOTES.notes_for(r):
            text += "\n" + crnotes.format_note(n)
            if notes_used is not None and n["id"] not in notes_used:
                notes_used.append(n["id"])
        blocks.append(
            f"[{r['id']}] (authority {r['authority']} — {label}; "
            f"source: {r['source']})\n{text}")
    return "\n\n---\n\n".join(blocks)


# Citation tags look like [prefix:suffix] (e.g. [manual:0023], [card:Wisp]); card
# text uses tagless brackets like [Augment], so requiring a colon leaves those alone.
_HIST_CITE_RE = re.compile(r"\s*\[[^\[\]]*:[^\[\]]*\]")


def strip_citations(text):
    """Remove our [tag] citations from text fed back as conversation history —
    those tags point at passages no longer in context and only confuse the model."""
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
    if REASONING_MODE in ("off", "never"):     # .env.example says "never"
        return False
    return needs_reasoning(question)


async def answer_question(question, history, context=None, meta=None, surface="web"):
    """Retrieve, call the model, return (answer_text, hits, reasoning_used).

    `surface` ("web" | "discord"): where the answer is read — the game server's
    judge box and the bot's web page are "web", every Discord path "discord". It
    decides how a digital-client convention is worded (DIGITAL_NOTE).

    `context` (R297): the Learn to Play lesson the player is reading, placed in
    the final user message under LESSON_NOTE. Retrieval stays on the question.

    `meta`: pass a dict and it comes back filled with what store.log_response
    takes as `llm=` — the model that actually answered, latency, usage, cost,
    whether the fallback was used. A dict and not a fourth return value, so the
    three-tuple every caller unpacks is unchanged."""
    if ai is None:
        raise RuntimeError("model client not initialised — call core.init_client() first")
    start = time.monotonic()
    meta = {} if meta is None else meta
    if surface not in SURFACES:
        raise ValueError(f"surface must be one of {SURFACES}, not {surface!r}")
    # The open-review-note overlay refreshes on its own task; this only makes
    # sure that task exists. The answer reads whatever snapshot is in memory.
    crnotes.NOTES.ensure_started()
    # BM25 over the whole corpus is synchronous and sits on the Discord bot's
    # event loop otherwise — every other command waits while it runs.
    hits = await asyncio.to_thread(retriever.search, question, k=TOP_K)
    notes_used = []
    passages = build_context(hits, surface, notes_used) if hits else "(no relevant passages found)"
    meta["surface"], meta["cr_notes"] = surface, notes_used
    messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{PRIMER}"}]
    # Prior assistant turns are resent with their citation tags stripped (the
    # passages they referenced aren't in this call's context).
    for m in history[-MAX_HISTORY:]:
        if m["role"] == "assistant":
            messages.append({"role": "assistant",
                             "content": strip_citations(m["content"])})
        else:
            messages.append(m)
    # The current question goes LAST, after the passages and the anti-drift note.
    # It used to sit before the note, and ~1 in 4 follow-ups drifted into
    # re-answering the previous turn instead — the retrieved passages for a
    # follow-up still look a lot like the prior question's, so whatever the model
    # read last won. Ending on the actual question anchors it.
    messages.append({
        "role": "user",
        "content": (f"Retrieved passages:\n{passages}\n\n"
                    f"{FOLLOWUP_NOTE if history else ''}"
                    f"{lesson_block(context)}"
                    f"Current question: {question}"),
    })
    reasoning = _use_reasoning(question)
    # For store.log_failure: a failed answer still records what it retrieved.
    # (log_response copies only its named keys out of meta, so these two never
    # reach a successful row twice.)
    meta["hits"], meta["reasoning"] = hits, reasoning
    # The thinking switch, token budget and temperature per provider live in
    # PROVIDERS / request_params(); the retry, fallback and deadline in _complete().
    # A blank answer is never returned silently: it is retried, then raised.
    answer = await _complete(messages, reasoning, meta, start)
    meta["total_ms"] = round((time.monotonic() - start) * 1000)
    return answer, hits, reasoning


# --- citation rendering --------------------------------------------------
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


# The rules review page in the client: `&at=r608.2b` opens the document at a
# rule (Annex D's are `rD6.16`, the same id the .html edition uses), and
# `&at=gloss:<key>` at a glossary row (client/ui/cranchor.ts placer().ofRef).
CR_REVIEW_BASE = (os.getenv("ALGO_PUBLIC_URL") or "https://algomancy.online").rstrip("/")


def cr_link(r):
    """The review-page URL for a CR chunk, or None for any other source."""
    if r.get("source_type") != "cr":
        return None
    m = r.get("metadata") or {}
    if m.get("kind") == "glossary":
        at = f"gloss:{m['gloss_key']}" if m.get("gloss_key") else None
    else:
        at = f"r{m['num']}" if m.get("num") else None
    return f"{CR_REVIEW_BASE}/?crreview=1&at={quote(at, safe=':.')}" if at else None


def friendly_source(r):
    """A clean, human-readable name for a retrieved chunk's source."""
    if r["source_type"] == "cr":
        m = r.get("metadata") or {}
        if m.get("kind") == "glossary":
            return f"CR glossary: {m.get('term') or r['title']}"
        return f"CR {m.get('num') or r['title']}"
    if r["source_type"] == "card":
        return f"Card: {r['title']}"
    if r["source_type"] == "glossary":
        return f"Glossary: {r['title']}"
    stem = r["source"].rsplit("/", 1)[-1]
    return SOURCE_NAMES.get(stem, stem.rsplit(".", 1)[0].replace("-", " "))


def cr_chunk_covers(row, num):
    """Does retrieved CR chunk `row` print rule `num`? build_cr.py makes one
    chunk per rule with the subrules that fit beside it, and names a split
    rule's continuation piece after ITS first subrule (cr:802.16g holds
    802.16g–j, cr:802.16 only 802.16–f) — so metadata.nums is the truth, not
    the id. A CR glossary row's nums POINT at a rule; it does not contain it.
    bot/eval/evallib.py matches gold citations through this same function."""
    if not str(row.get("id", "")).startswith("cr:"):
        return False
    m = row.get("metadata") or {}
    if m.get("kind") == "glossary":
        return False
    return str(num) in [str(n) for n in (m.get("nums") or [m.get("num")]) if n]


_SUBRULE_TAIL_RE = re.compile(r"[a-z]+$")


def resolve_citation(tag, hit_rows):
    """The retrieved chunk a citation tag points at, as (row, cited_num), or
    None. cited_num is set when the tag names a CR SUBRULE inside a retrieved
    chunk rather than the chunk itself: [cr:603.2a] -> (the cr:603.2 chunk,
    "603.2a"). Order: the exact id; a CR chunk whose nums print the number;
    failing that, the chunk whose num is the subrule's parent rule."""
    for r in hit_rows:
        if r["id"] == tag:
            return r, None
    if not tag.startswith("cr:") or tag.startswith("cr:glossary."):
        return None
    num = tag[3:]
    for r in hit_rows:
        if cr_chunk_covers(r, num):
            return r, num
    parent = _SUBRULE_TAIL_RE.sub("", num)
    if parent and parent != num:
        for r in hit_rows:
            if (str(r.get("id", "")).startswith("cr:")
                    and (r.get("metadata") or {}).get("kind") != "glossary"
                    and (r.get("metadata") or {}).get("num") == parent):
                return r, num
    return None


def _cited_view(r, num):
    """The row a footnote shows for a subrule citation: a COPY of the chunk
    with its number replaced by the one the model cited, so friendly_source()
    says "CR 603.2a" and cr_link() anchors at r603.2a (the review page and the
    .html edition give every subrule its own id). The hit itself is untouched."""
    if num is None:
        return r
    return {**r, "title": f"CR {num}", "metadata": {**(r.get("metadata") or {}), "num": num}}


# A bracketed part that is one of OUR citation tags: lowercase prefix, colon, no
# space after it ([manual:0023], [card:Temporal Rift], [cr:608.2b]). Card text
# ([Augment], [Switch1]) and prose ("[Note: …]") never look like this.
_TAG_LIKE_RE = re.compile(r"^[a-z][a-z0-9_\-]*:\S")


def render_citations(answer, hits):
    """Turn the model's `[source:tag]` citations into clean footnote superscripts.

    Returns (display_text, ordered_sources) where ordered_sources is a list of
    (number, row) for the sources actually cited, in first-appearance order.
    A CR subrule tag ([cr:603.2a]) resolves to the retrieved chunk that prints
    it and is footnoted as that subrule (see resolve_citation/_cited_view).

    ⚠ A tag that resolves to NOTHING retrieved is DROPPED, never shown: until
    2026-10-11 it stayed in the text as raw "[cr:603.2a]" — 159 of 537 tags in
    eval run 2, in 68 of 115 answers. Brackets that hold no citation-shaped
    part (card text like [Augment]) are left untouched.
    """
    rows = [r for _s, r in hits]
    # Number by source *document* (friendly name) so multiple chunks of e.g. the
    # 2023 Rulebook share one footnote instead of cluttering the legend. A CR
    # rule is its own document: "CR 603.2a" and "CR 603.2" are two footnotes.
    order, number, rep = [], {}, {}

    def repl(m):
        parts = [x.strip() for x in re.split(r"[;,]", m.group(1))]
        if not any(_TAG_LIKE_RE.match(t) for t in parts):
            return m.group(0)  # not a citation at all — card text, leave it alone
        nums = []
        for t in parts:
            hit = resolve_citation(t, rows)
            if hit is None:
                continue        # an unresolvable tag: dropped, prose kept
            r = _cited_view(*hit)
            key = friendly_source(r)
            if key not in number:
                order.append(key)
                number[key] = len(order)
                rep[key] = r
            nums.append(number[key])
        return "".join(_sup(n) for n in sorted(dict.fromkeys(nums)))

    text = _CITE_RE.sub(repl, answer)
    text = re.sub(r"\s+([.,;:)])", r"\1", text)   # tidy space left before punctuation
    text = re.sub(r"[ \t]{2,}", " ", text)
    sources = [(number[k], rep[k]) for k in order]
    # The model cited nothing inline: show the top retrieved passages anyway, so
    # an answer never arrives with no sources at all. (Both front-ends did this
    # themselves, identically, after calling here.)
    if not sources and hits:
        sources = [(i, r) for i, (_s, r) in enumerate(hits[:3], 1)]
    return text.strip(), sources


# --- game-icon vocabulary (shared by both front-ends) --------------------
# Maps card-text/cost tokens to an icon NAME. Each front-end renders that name its
# own way: the Discord bot as a guild custom emoji (<:name:id>), the web app as an
# <img> from data/icons/<name>.webp. Keeping the mapping here means both stay in sync.
#
# Card-text tokens: [..] are ability keywords, {..} are attributes. Only these
# keywords actually have an icon — most attributes (Flying, Deadly, Poisonous, …)
# have NO image and just render as their plain word. Each name maps to an
# data/icons/<name>.webp file (and a same-named Discord guild emoji).
ICON_NAMES = {
    "[augment]": "augment", "[switch1]": "bounded_graft", "[switch]": "graft",
    "[virus]": "virus", "[battle]": "battle", "[haste]": "haste",
    "[once]": "once",
    "{virus}": "virus", "{battle}": "battle", "{haste}": "haste",
}
# Affinity/cost letters -> faction icon (verified from card data). Used on the COST
# line and inside a [cost] token in card text (see below) — but NOT for a {braced}
# token, where {g}/{p} are attribute colours, not factions.
# NOTE: `p` = colorless (the Prismite resource); intentionally unmapped (no icon
# yet), so it renders as the literal "p".
RESOURCE_NAMES = {
    "r": "fire", "m": "metal", "b": "water",
    "e": "earth", "g": "wood",
    # Light & Dark expansion. "p" stays unmapped on purpose — colourless has no
    # icon by design and renders as plain text.
    "l": "light", "d": "dark",
}
ICON_TOKEN_RE = re.compile(r"\[[^\[\]]+\]|\{[^{}]+\}")

# --- cost tokens ----------------------------------------------------------
# A cost printed inside card text: an amount ([one], [x]), a resource ([e]), or both
# at once ([4bb] — "pay four, and two water"). One token can therefore be SEVERAL
# icons, which is why these can't live in ICON_NAMES; cost_token_icons() expands a
# token into the icons that draw it.
#
# Amounts are spelled out as words on the cards, and that is worth preserving: it
# means no cost token is ever a bare number, so none of this can collide with a
# footnote-ish "[1]" when the same matching runs over an LLM's prose. The compound
# form keeps that property by requiring at least one resource letter.
COST_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "x": "x",
}
AMOUNT_NAMES = {c: f"cost_{c}" for c in "0123456789x"}
# [e], [4bb], [2be] — and l/d for the Light & Dark elements ([d], [4dd]).
_COMPOUND_COST_RE = re.compile(r"[0-9]*[rmbegld]+")
# The Light & Dark cards print plain numeric costs ("pay [1]") where the base set
# spells them ([one]). Card text is safe to expand digit-only tokens in; prose is
# NOT (see ICON_PROSE_RE below — "[1]" there is far more likely a footnote).
_PLAIN_AMOUNT_RE = re.compile(r"[0-9]+")


def cost_token_icons(tok):
    """The icons that draw a [cost] token from card text, or None if it isn't one.

    Returns [(icon name, the character it draws)] so a front-end can fall back to
    readable text per icon, exactly as it does on the cost line: [one] -> [('cost_1',
    '1')], [4bb] -> [('cost_4', '4'), ('water', 'b'), ('water', 'b')].
    """
    body = tok[1:-1].lower()
    if body in COST_WORDS:                            # [one], [x]
        body = COST_WORDS[body]
    elif _PLAIN_AMOUNT_RE.fullmatch(body):            # [1], [12]
        pass
    elif not _COMPOUND_COST_RE.fullmatch(body):       # [4bb], [e], [d]
        return None                                   # anything else isn't a cost
    return [(AMOUNT_NAMES.get(c) or RESOURCE_NAMES[c], c) for c in body]


# Prose icons. Answers quote card text back at the reader ("[Switch1] triggers
# once per turn"), so the same tokens need rendering in an LLM answer, not just in
# a card embed. This regex matches ONLY the tokens we have an icon for — unlike
# ICON_TOKEN_RE, which matches any bracketed text and is safe only over card text,
# where every bracket is a game token. In prose, brackets belong to markdown links
# and to our own [source:tag] citations, so anything unknown must be left alone.
ICON_PROSE_RE = re.compile("|".join([
    *(re.escape(t) for t in sorted(ICON_NAMES, key=len, reverse=True)),
    r"\[(?:%s)\]" % "|".join(sorted(COST_WORDS, key=len, reverse=True)),
    r"\[[0-9]*[rmbegld]+\]",
]), re.IGNORECASE)


def sub_card_token(tok, render, text=lambda s: s):
    """One card-text token ([Switch1], {Haste}, [4bb]) as the front-end draws it.

    `render(icon_name, fallback)` is the front-end's icon — a guild emoji on
    Discord, an <img> on the web — and `text(s)` is how it emits literal text
    (identity on Discord, html.escape on the web). Both front-ends used to carry
    this whole function, line for line apart from those two leaves, which is
    how a fix landed in one and not the other; render_icons below already
    took the callback for prose, and this is the same seam for card text.
    """
    is_brace_attr = tok[0] == "{" and tok[1:-1].isalpha()
    # Readable fallback if the icon is missing: bare word for {Attribute}, the
    # token itself for [Ability] (the brackets read as a keyword).
    fallback = tok[1:-1] if is_brace_attr else tok
    name = ICON_NAMES.get(tok.lower())
    if name:
        return render(name, fallback)
    if not is_brace_attr:
        # A [cost]: one token, but possibly several icons ([4bb] is a "4" then two
        # water drops). Each falls back to the character it draws, so a missing
        # icon leaves "4bb" — the same way the cost line degrades.
        icons = cost_token_icons(tok)
        if icons:
            return "".join(render(n, c) for n, c in icons)
    if is_brace_attr:                # unknown {Attribute} -> drop braces
        return text(tok[1:-1])
    return text(tok)                 # unknown [ability] -> leave as-is


def render_cost(cost, render, text=lambda s: s):
    """An affinity/cost string like '4bb' with resource icons, digits kept."""
    if not cost or cost == "empty":
        return text(cost or "")
    out = []
    for ch in cost:
        name = RESOURCE_NAMES.get(ch.lower())
        out.append(render(name, ch) if name else text(ch))
    return "".join(out)


def render_icons(text, render):
    """Swap game-icon tokens in prose ([Switch1], {Battle}, [one], …) for icons.

    `render(icon_name, fallback)` is the front-end's renderer — the same signature
    the two front-ends already use for card text — so the bot gets custom emojis
    and the web app gets <img> tags from one pass here. The fallback it receives if
    the icon is missing keeps [Switch1] bracketed (the brackets read as a keyword)
    but bares a {Battle} attribute, matching how card text degrades.
    """
    if not text:
        return text

    def sub(m):
        tok = m.group(0)
        name = ICON_NAMES.get(tok.lower())
        if name:
            fallback = tok[1:-1] if tok[0] == "{" else tok
            return render(name, fallback)
        # A cost token, then — the only other thing ICON_PROSE_RE matches. Each icon
        # degrades to the character it draws, so [4bb] reads as "4bb" if any is absent.
        return "".join(render(n, c) for n, c in cost_token_icons(tok))

    return ICON_PROSE_RE.sub(sub, text)


# A markdown code span/fence renders its contents *literally*, which is exactly
# what an icon has to avoid: whatever render_icons substitutes in would be shown as
# its own source. Models quote card text constantly, and quoted card text is where
# the tokens live, so this lands often. Matches a fenced block (with or without an
# info string) or a single-backtick span; double-backtick spans are rare enough in
# LLM prose to leave alone.
CODE_RE = re.compile(r"```[^\n]*\n(?P<fence>.*?)```|`(?P<span>[^`\n]+)`", re.S)


def uncode_icon_tokens(text):
    """Drop the code formatting from any code span/fence that quotes an icon token.

    For front-ends that cannot show an icon inside code. The web page doesn't need
    this — it substitutes on the DOM after its markdown renderer has run, so the
    <img> lands *inside* the <code> element — but Discord will not expand a custom
    emoji inside a code span at all, and there is no markup that makes it. So the
    bot trades the monospace for the icon: same information, formatted the only way
    the platform allows. Spans with no icon token in them keep their formatting.
    """
    if not text:
        return text

    def sub(m):
        inner = m.group("fence") if m.group("fence") is not None else m.group("span")
        return inner if ICON_PROSE_RE.search(inner) else m.group(0)

    return CODE_RE.sub(sub, text)


def cited_card_paths(answer, hits, limit=10):
    """For each *card* the answer actually cited (and that has art), return
    (footnote_number, card_title, art_Path). Framework-agnostic — Discord wraps
    these in discord.File, the web app serves them as image URLs."""
    _display, sources = render_citations(answer, hits)
    out = []
    for n, r in sources:
        if r["source_type"] != "card":
            continue
        art = cards.art_path(r["title"])
        if art:
            out.append((n, r["title"], art))
        if len(out) >= limit:
            break
    return out
