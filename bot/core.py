#!/usr/bin/env python3
"""
core.py — the shared Algomancy rules "brain".

This is the framework-agnostic RAG core: retrieval (BM25 over the rules corpus),
the verified rules primer, the system prompt, the DeepSeek call with the "math
mode" reasoning router, and citation rendering. It knows nothing about Discord or
HTTP — both `bot.py` (Discord) and `app.py` (web) import from here so there is a
single brain behind every front-end.

Call `init_client(api_key, ...)` once at startup before `answer_question`.
"""

import hashlib
import asyncio
import os
import re
from pathlib import Path

from openai import AsyncOpenAI

from cards import CardIndex
import retriever as retr
from retriever import CORPUS, Retriever

DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_BASE = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MAX_HISTORY = 8        # how many prior turns to resend as conversation context
# 10, not 6: the rulings corpus is dense enough that 6 slots could be swept
# entirely by edge-case rulings, leaving no room for the base rule they modify.
# 10 slots + retriever's FOUNDATION_FLOOR keeps both on the table.
TOP_K = 10             # chunks retrieved per question

# "Math mode": stat/arithmetic questions (combat damage, buffs, Electric arcing,
# Fireball-vs-Growth, regroup math) benefit from DeepSeek's thinking mode. We
# auto-detect them and enable thinking only then, so the cost hits just the
# questions that need it. DEEPSEEK_REASONING: "auto" (detect) | "off" | "always".
REASONING_MODE = os.getenv("DEEPSEEK_REASONING", "auto").lower()
MODEL_TIMEOUT = float(os.getenv("DEEPSEEK_TIMEOUT", "60"))
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
- Modifications: both Augment (+) and Graft (switch-arrows) are special actions taken \
during the DEPLOYMENT phase. You play the mod card from EITHER your hand OR your \
bin/discard — both are legal, and the card does NOT have to be in the bin — paying its \
cost and meeting affinity, and put it under a creature, which then gains the added text \
(or attributes; see the next bullet). If the glossary's Augment/Graft entries say "the \
card must be in your discard", that wording is outdated: the rulebook says you "can apply \
augments both from your hand and from your discard". Graft can only target creatures that \
themselves have the graft symbol; Augment can go on a creature whether or not it carries \
any symbol. Either way you may only modify YOUR OWN units, because deployment has no \
interaction across regions. The one exception is a Virus, which may additionally be \
augmented from your HAND during battle — that is the only time a mod can land on an \
OPPONENT's unit, and they then control the added text as if it were their own.
- The augment symbol can sit EITHER at the start of a line in the text box OR at the \
start of the TYPE LINE, in front of the attributes. A type-line (+) grants those \
ATTRIBUTES rather than any text — Chitin Shredder ("[Augment] {Powerful} Insect Unit") \
has no rules text at all, and augmenting it makes its host Powerful. So a card with an \
empty text box can still be a perfectly good augment, and you must never say a card \
cannot be augmented without checking its type line for the (+). The subtypes (Insect, \
Rock Beast) and the {Virus} icon do NOT transfer — only the attributes.
- Graft placement and source. Like all modifications, a graft is played from your HAND or \
your bin during the deployment phase (pay the card's cost, meet affinity). It goes onto a \
card that has BOTH a graft symbol and a trigger, and it always goes UNDER that card — the \
original card stays on top as the "main" card, keeping its name and stats, and ITS trigger \
fires the combined effect. You canNOT graft a card on top to make it the new main creature. \
The only choice you get is WHERE among the already-grafted cards the new one sits: if you \
graft C onto a unit that reads A/B, you may make it A/B/C or A/C/B — but A stays on top, \
and once placed the order is fixed for good. Grafts also only go on YOUR OWN units (unlike \
a Virus): an opponent's units aren't available to target during your deployment. If the \
glossary's Graft entry says you can put the card "on top or beneath", that wording is \
outdated — under only.
- "Playing" vs "applying a mod" (provisional clarification, pending official Light & Dark \
errata): only UNITS and SPELLS are "played". Applying a modification — attaching a Virus, \
graft, or augment, whether it comes from your hand, your bin, or a glimpse — is NOT \
"playing a card". So abilities that trigger "when you play a unit/spell/card" do NOT \
trigger when a mod is applied, even one applied from the bin. This matters especially for \
Light-element cards that care about playing cards.
- Bounded vs unbounded graft (the switch-arrow shown as [Switch]/[Switch1] in a card's \
ability text): this symbol caps how often that triggered effect can fire IN A TURN. The \
UNBOUNDED form ([Switch]) can trigger an unlimited number of times per turn; the BOUNDED \
form ([Switch1]) triggers at most ONCE PER TURN. So a unit whose trigger is bounded \
(e.g. "When I become targeted, [Switch1] Create ...") cannot loop infinitely — it \
produces its effect only once per turn no matter how many times it is re-triggered.
- Conjure makes a spell token cast at a set time. In combat it casts immediately; \
outside combat it casts in the next combat — offensive conjured spells just after \
attackers are declared, then defensive ones (which resolve before the offensive ones). \
An unspecified X on a conjured spell is 1.
- Targeting: you can only target things in a Skirmish with you, so you cannot target an \
opponent's cards during your own main phase (outside combat).
- Initiative (1v1/team games): the Initiative team acts first each turn, creating an \
attack-counterattack flow; free-for-all games declare attacks simultaneously.
- Square brackets on a card mean ONE of two different things, and they are easy to \
confuse because the card text you are shown writes both the same way. (a) An ICON: on \
the printed card this is a picture, and the text renders it as a bracketed word — \
[Switch], [Switch1], [Augment], [Battle], [Virus], [Haste]. These are symbols, NOT \
costs, and nothing is paid for them. (b) An ADDITIONAL COST: any OTHER bracketed text \
(e.g. "[Sacrifice a unit]") is a cost that must be resolved in order to play the card. \
So [Switch] on a card is the graft symbol, not something you pay.

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
live keyword for excess combat damage going to the player is Piercing.

Light & Dark expansion (163 cards, two new elements). IMPORTANT: no official rulebook or \
errata has shipped for it. Card text is transcribed from card images, and the definitions \
below are PROVISIONAL — drawn from printed reminder text and the designer's Discord \
messages. Say so when you rely on them; they are sourced, but not settled rules.
- Light — new element; cream/white pip. Themes: Prophecy, cache, glimpse, life gain, \
Blessed, and debt as a price for strong effects.
- Dark — new element; grey pip. Themes: rot, trashing, bin recursion, -1/-1 counters, \
sacrifice, Afflicting.
- Rot — a persistent harm that accumulates on a PLAYER, not a unit. Card text (Rot \
Counter): "At the start of deployment, you take damage equal to the number of rot you \
have." Rot is never removed once gained, so it hits you again every deployment, and \
deployment has no priority, so the damage cannot be responded to. Some effects convert \
combat damage into rot instead of life loss. Your own rot is a source you control.
- Debt — an accumulating cost paid off with mana, unlike rot. After the resources step \
you MUST pay 1 mana per debt and that debt is removed; if you cannot pay for all of it, \
only what you can pay is removed and the rest carries over to the next turn. There is no \
life loss or other penalty for unpaid debt. It happens at the END of the resource step \
and you cannot activate mana after paying it (designer, 2024-12-02).
- Prophecy — an alternate cost on a second banner under the title, reading \
"Prophecy — <condition>" (e.g. "Two Turns Pass", "Your life is 5 or less"). Card text: \
"To prophecy, cache this card during deployment by paying its prophecy cost. You may \
play it for free, as if it were in your hand, if the prophecy has been fulfilled." \
Prophesying is legal only during DEPLOYMENT, and fulfilment counts forward from that \
moment — it never looks backwards at a condition already met. "For free" means without \
paying its cost AND ignoring affinity. In 1v1 both battles in a turn tick "One Battle \
Passes". Caching a unit that is in play sends its mods to the bin. Effects can attach a \
prophecy to an opponent's card too.
- Cache — a neutral holding zone separate from hand, bin and deck ("basically exile with \
the intent to be referenced later", designer). Cards stay cached if unused. Being cached \
does NOT by itself let you play a card — only effects that say so (like glimpse) do — but \
you CAN augment or graft from cache.
- Glimpse — reveal the top card of the deck and cache it; until end of turn you may play \
it as if it were in hand, ignoring affinity. You still pay its cost and obey timing.
- Blessed — damage dealt by a blessed source also gains its controller that much life, \
simultaneously with the damage (the same game-state check, like lifelink). The gain \
therefore lands before the lethal check, so a blessed source cannot kill its own \
controller with its own damage.
- Afflicting — when an afflicting source kills one or more units, those units' \
CONTROLLERS gain a rot. "Kills" includes killing with -1/-1 counters, not only with \
damage — which is how Umbral Decay, the only afflicting card, works.
- Lethal — any combat damage from a lethal unit kills a player outright.
- Pure — pure cards, and the cards they interact with, ignore all other attributes.
- Modular — you may apply mods to a modular card from hand and/or bin as it is played, \
paying each mod's cost.
- Wraith (renamed from WIGHT — Blight's End still prints "Wight"; they are the same \
token) — a 0-cost 3/3 Blight Zombie Token Unit carrying [Augment], reading "At the start \
of deployment, put a -1/-1 counter on an ally. When I die, Augment a Wraith onto an \
ally." (Physical card, 2026-08-21; this REPLACES an older 4/4 printing that shrank itself \
when it attacked or blocked — that text is obsolete.) It is a real body, not merely a \
mod, but it carries the augment symbol, which is why most cards create it directly as an \
augment on a unit. Both of its lines are live while it stands in play as a unit. Its \
first trigger points OUTWARD at an ally during deployment; it does not shrink itself by \
fighting. Its death trigger does NOT move the dying Wraith — that one is erased like any \
token; the trigger creates a BRAND NEW Wraith as an augment on an ally. "An ally" is not \
a target: it is chosen on resolution, so it cannot be redirected and cannot fizzle for \
want of a legal target.
- Trash / trashed — card text: "A nontoken card entering a bin from anywhere other than \
the stack is trashed" — i.e. a card reaches a bin without having been played. \
Discarding, sacrificing, milling and dying in combat are ALL trashing. TOKENS CAN BE \
TRASHED (2026-08-21, reversing an earlier reading): both rulebooks say "Tokens are \
temporary CARDS", so a token IS a card in Algomancy, unlike Magic; the "nontoken" \
qualifier survives only on Void Scavenger, a card cut from the set; and the designer's \
own paraphrase ("basically when a card enters your bin but wasn't played", 2025-02-01) \
has no such qualifier. A dying token does reach the bin first — the designer confirmed \
it counts "for the purposes of triggers" (2025-03-12) and that a token "does enter your \
hand and then gets erased immediately" (2025-06-15) — even though the printed Manual \
says a leaving token goes to the token pile "instead of the hand or bin"; the rulings \
win, and both points are provisional. NOT trashing: a spell going to the bin after \
resolving (it comes from the stack, so negating a spell is not trashing it), or erasing \
(an erased card never touches a bin at all). The owner of the bin the card enters is the \
one who trashes it."""

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
- When sources disagree, prefer the LOWER authority number — that is the more \
trustworthy source. The ladder: 0 = a Discord ruling (an answer given in the game's \
official Discord, by the designer or an experienced judge), which is DEFINITIVE and \
overrides every other source, including the rulebook; 1 = primary rulebook, card text, \
and official judge write-ups; 2 = official glossary; 3 = the older 2023 rulebook; \
4-5 = web write-ups and design blogs, which are frequently outdated. The primer is \
reliable for basics. A Discord ruling that contradicts an older rulebook means the game \
CHANGED, not that the ruling is wrong — follow the ruling and say so.
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
"trashed" means (including that tokens CAN be trashed), the Wraith/Wight token, prophecy \
and debt are all sourced now, so flag them as provisional but do NOT hedge them as \
unknown. Note that a sourced L&D point can still be SUPERSEDED when the card is \
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
ENGINE_DATE = "2026-08-21"


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
# The DeepSeek client is built by init_client() once the API key is resolved (CLI
# arg or env), so this module can be imported without a key present (e.g. tests).
ai: AsyncOpenAI | None = None


def init_client(api_key, base_url=DEEPSEEK_BASE, model=None):
    """Build the DeepSeek client (and optionally override the model). Call once at
    startup before answer_question. Returns the client."""
    global ai, DEEPSEEK_MODEL
    # ⚠ timeout: the SDK's default is 600 s. The game server's /api/judge proxy
    # gives up at 60 s, so anything slower was an orphaned in-flight call on
    # this side with the caller already gone — and enough of those exhaust the
    # connection pool. One number here, and both front-ends inherit it.
    ai = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=MODEL_TIMEOUT)
    if model:
        DEEPSEEK_MODEL = model
    return ai


# --- RAG plumbing --------------------------------------------------------

def lesson_block(context):
    """The Learn to Play lesson as a labelled block for the final user message
    (R297), or '' when there is none."""
    context = (context or "").strip()
    if not context:
        return ""
    return f"{LESSON_NOTE}<lesson>\n{context}\n</lesson>\n\n"


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


async def answer_question(question, history, context=None):
    """Retrieve, call DeepSeek, return (answer_text, hits, reasoning_used).

    `context` (R297): the Learn to Play lesson the player is reading, placed in
    the final user message under LESSON_NOTE. Retrieval stays on the question."""
    if ai is None:
        raise RuntimeError("DeepSeek client not initialised — call core.init_client() first")
    # BM25 over the whole corpus is synchronous and sits on the Discord bot's
    # event loop otherwise — every other command waits while it runs.
    hits = await asyncio.to_thread(retriever.search, question, k=TOP_K)
    passages = build_context(hits) if hits else "(no relevant passages found)"
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
    params = {"model": DEEPSEEK_MODEL, "messages": messages}
    if reasoning:
        # v4-flash counts hidden reasoning tokens against max_tokens, so the budget
        # must cover the chain-of-thought AND the visible answer. Thinking mode
        # ignores temperature.
        params["max_tokens"] = 4000
        params["reasoning_effort"] = REASONING_EFFORT
        params["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        # v4-flash is a hybrid model that reasons BY DEFAULT. Without an explicit
        # disable it silently spends the whole token budget on hidden reasoning and
        # returns empty content (finish_reason=length), so thinking must be turned
        # off for the cheap path — not merely left unrequested.
        params["max_tokens"] = 900
        params["temperature"] = 0.2
        params["extra_body"] = {"thinking": {"type": "disabled"}}
    resp = await ai.chat.completions.create(**params)
    answer = (resp.choices[0].message.content or "").strip()
    if not answer:
        # Don't return a blank answer silently; surface why instead.
        raise RuntimeError(
            f"model returned an empty answer (finish_reason={resp.choices[0].finish_reason})")
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
