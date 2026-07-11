#!/usr/bin/env python3
"""
app.py — Algomancy rules web app (a browser front-end over `core.py`).

Same RAG brain as the Discord bot (`bot.py`), served as a small chat website so
you can use it at the table without Discord and share a link with anyone. Reuses
core.py (retrieval + DeepSeek + citations) and store.py (training-data logging +
feedback), so every web answer is logged exactly like a Discord one.

Endpoints
---------
  GET  /                 the chat UI (static/index.html)
  POST /api/ask          {question, history, session_id} -> answer + sources + cards
  POST /api/feedback     {response_id, rating, session_id} -> logged (good|weird|bad)
  GET  /api/colors       suggest a fresh 3-colour deck + this session's coverage
  POST /api/colors/played {colors, session_id} -> record a combo as played
  GET  /api/card?name=   fuzzy card lookup (stats, oracle text, rulings, art url)
  GET  /api/search?q=    find cards from a description (oracle text, keywords, stats)
  GET  /editor           the "What's the play?" puzzle editor (static/editor.html)
  GET  /api/wtp/...      puzzles: list, next-unseen, one, solution, board image
  POST /api/wtp/save     create/update a puzzle (see WTP_EDIT_KEY below)
  GET  /art/{name}       card art image
  /icons/...             game icon images (Icons/)

Editing
-------
Anyone who can reach the site can *play* a puzzle. Writing one is gated by the
`WTP_EDIT_KEY` env var: set it and the editor asks for it once (and remembers it);
leave it unset and editing is open, which is what you want on a LAN but not behind
a public tunnel.

Run
---
  pip install -r requirements.txt
  python3 app.py <DEEPSEEK_API_KEY>      # or set DEEPSEEK_API_KEY in env/.env
  # then open http://localhost:8000  (share it publicly with a Cloudflare Tunnel)
"""

import os
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

load_dotenv()  # populate env before importing core (reads DEEPSEEK_* at import)

import mimetypes
import re
from html import escape

# Some OS/Python mime databases (notably older ones) don't map .webp, so the icon
# StaticFiles mount would serve them as application/octet-stream. Register it so
# icons come back as image/webp everywhere.
mimetypes.add_type("image/webp", ".webp")

import combos
import core
import draft
import mods
import store
import wtp
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import cards
from cards import FACTION_COLOR

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
ICONS = ROOT / "Icons"
# Icon names we actually have an image file for (so missing ones fall back to text,
# exactly like the Discord bot degrades to text when a guild emoji is absent).
AVAILABLE_ICONS = {p.stem for p in ICONS.glob("*.webp")} if ICONS.is_dir() else set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # If the client wasn't already built (e.g. running under `uvicorn app:app
    # --reload`, which skips __main__), init it from the environment so the ask
    # endpoint works. No-op when __main__ already called init_client.
    if core.ai is None:
        key = os.getenv("DEEPSEEK_API_KEY")
        if key:
            core.init_client(key, model=os.getenv("DEEPSEEK_MODEL") or None)
    yield


app = FastAPI(title="Algomancy Rules Bot", lifespan=lifespan)

# Game-icon images (served to the page so answers/cards can show real icons).
if ICONS.is_dir():
    app.mount("/icons", StaticFiles(directory=str(ICONS)), name="icons")

# The pages' own assets. index.html was self-contained, but the puzzle board is
# rendered by the same CSS+JS in two places (the play page and the editor's live
# preview), so it lives in files both can load rather than being duplicated.
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


# --- request models ------------------------------------------------------

class Turn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[Turn] = []
    session_id: str | None = None


class FeedbackRequest(BaseModel):
    response_id: str
    rating: str                 # good | weird | bad (matches the Discord buttons)
    session_id: str | None = None


class PlayedRequest(BaseModel):
    colors: list[str]           # three colour names
    session_id: str | None = None


# --- helpers -------------------------------------------------------------

def _art_url(title: str) -> str | None:
    """Public URL for a card's art, or None if the card has no image file."""
    return f"/art/{quote(title)}" if core.cards.art_path(title) else None


# Card names that have art — sent to the page so it can detect card mentions in
# answer text and show hover/tap previews. Computed once (art presence is static);
# names < 3 chars are dropped to avoid spurious matches inside ordinary words, and
# so are the components/reference cards (Cardback, Turn Structure, …), which are in
# the index for their art but are never worth linking mid-sentence.
CARD_NAMES_WITH_ART = sorted(
    (n for n in core.cards.names
     if len(n) >= 3 and n not in cards.NON_CARD_NAMES and core.cards.art_path(n)),
    key=len, reverse=True)


def _sources_payload(sources):
    """[(n, row)] -> list of {n, name, authority} for the page's source legend."""
    return [{"n": n, "name": core.friendly_source(r), "authority": r["authority_label"]}
            for n, r in sources]


# --- game-icon rendering (web) -------------------------------------------
# Mirror of bot.py's emoji rendering, but emitting <img> from /icons/ instead of
# Discord custom emojis. Uses core.ICON_NAMES / core.RESOURCE_NAMES so both
# front-ends share one token->icon mapping.

def _icon_img(name, fallback):
    """An <img> for the icon if we have its file, else the escaped fallback text."""
    if name in AVAILABLE_ICONS:
        return f'<img class="icon" src="/icons/{name}.webp" alt="{escape(name)}">'
    return escape(fallback)


def _sub_token_html(m):
    tok = m.group(0)
    is_brace_attr = tok[0] == "{" and tok[1:-1].isalpha()
    fallback = tok[1:-1] if is_brace_attr else tok
    name = core.ICON_NAMES.get(tok.lower())
    if name:
        return _icon_img(name, fallback)
    if is_brace_attr:                # unknown {Attribute} -> drop braces
        return escape(tok[1:-1])
    return escape(tok)               # unknown [ability]/cost token -> leave as text


def render_card_text_html(text):
    """Card oracle text / type line as safe HTML: literal text escaped, formatting
    codes handled, and known game-icon tokens swapped for <img> icons."""
    if not text:
        return ""
    # cards.plain_text resolves the JSON's formatting codes ({/n} -> a newline,
    # {i}, {g}) — the same pass the bot and the search index use, so a new code is
    # handled in one place. Escape after it, and before injecting any <img>: the
    # game tokens it leaves behind ([Switch], {Haste}) contain no HTML-special
    # characters, so they survive escaping intact for the icon pass below.
    t = escape(cards.plain_text(text)).replace("\n", "<br>")
    return core.ICON_TOKEN_RE.sub(_sub_token_html, t)


def render_cost_html(cost):
    """Affinity/cost string like '4bb' rendered with faction icons (digits kept)."""
    if not cost or cost == "empty":
        return escape(cost or "")
    out = []
    for ch in cost:
        name = core.RESOURCE_NAMES.get(ch.lower())
        out.append(_icon_img(name, ch) if name else escape(ch))
    return "".join(out)


def render_factions_html(factions):
    """Faction list with each faction's icon (falls back to the name as text)."""
    return " ".join(f'{_icon_img(f, "")} {escape(f.title())}'.strip() for f in factions)


# --- routes --------------------------------------------------------------

@app.get("/")
def index():
    # no-store so edits to the page always show up on refresh (no stale HTML cached
    # by the browser); the page is tiny, so skipping the cache costs nothing.
    return FileResponse(str(STATIC / "index.html"), headers={"Cache-Control": "no-store"})


@app.post("/api/ask")
async def api_ask(req: AskRequest):
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Empty question.")
    history = [{"role": t.role, "content": t.content} for t in req.history]
    try:
        answer, hits, reasoning = await core.answer_question(question, history)
    except Exception as exc:  # surface API/auth errors instead of a silent 500
        raise HTTPException(status_code=502, detail=f"Couldn't reach the model: {exc}")

    display, sources = core.render_citations(answer, hits)
    # Fall back to the top retrieved chunks if the model cited nothing inline.
    if not sources and hits:
        sources = [(i, r) for i, (_s, r) in enumerate(hits[:3], 1)]
    cited_cards = [{"n": n, "title": title, "art_url": _art_url(title)}
                   for n, title, _path in core.cited_card_paths(answer, hits)]

    rid = store.new_response_id()
    store.log_response(
        rid, "followup" if history else "ask", question, answer, hits,
        core.DEEPSEEK_MODEL, user_id=req.session_id or "web", channel_id="web",
        history=history, reasoning=reasoning, engine_version=core.ENGINE_VERSION)

    return {
        # Markdown with citation superscripts, icon tokens ([Switch1], [Augment], …)
        # left as-is: the page renders the markdown and then swaps the tokens for
        # <img> icons on the DOM (see /api/icons). It's also what the page sends
        # back as conversation history, so no markup leaks into the model.
        "response_id": rid,
        "answer": display,
        "sources": _sources_payload(sources),
        "cited_cards": cited_cards,
        "reasoning": reasoning,
        "model": core.DEEPSEEK_MODEL,
    }


@app.post("/api/feedback")
def api_feedback(req: FeedbackRequest):
    if req.rating not in ("good", "weird", "bad"):
        raise HTTPException(status_code=400, detail="rating must be good|weird|bad")
    store.log_feedback(req.response_id, req.rating, req.session_id or "web")
    return {"ok": True}


# mods.ComboError phrases its reasons in Discord markdown (**Card Name**). The page
# escapes whatever it's given, so the markers would show up as literal asterisks —
# drop them rather than teach mods.py about two front-ends' markup.
_EMPHASIS_RE = re.compile(r"\*{1,2}")


def _combo_error(exc) -> HTTPException:
    return HTTPException(status_code=400, detail=_EMPHASIS_RE.sub("", str(exc)))


def _combo_payload(query: str):
    """A grafted/augmented card, shaped exactly like a plain card payload so the
    page renders it through the same panel — plus the line saying what was done."""
    try:
        combo = mods.build(query, core.cards)
    except mods.ComboError as exc:
        raise _combo_error(exc)
    host = combo.host
    factions = core.cards.factions(host)
    # The card names are the only untrusted part of the sentence, so they're the
    # only part that needs escaping; the rest is our own prose.
    note = combo.describe(bold=lambda s: f"<b>{escape(s)}</b>")
    if combo.swapped:
        note += (f" — {escape(combo.host_name)} has to be the one in play, "
                 f"so it goes on top.")
    return {
        "name": combo.title,
        "type": host.get("type", ""),
        "type_html": render_card_text_html(host.get("type", "")),
        "cost": host.get("cost", ""),
        "cost_html": render_cost_html(host.get("cost", "")),
        "total_cost": host.get("total_cost", ""),
        "power": host.get("power", ""),
        "toughness": host.get("toughness", ""),
        "factions": factions,
        "factions_html": render_factions_html(factions),
        "text": combo.text,
        "text_html": render_card_text_html(combo.text),
        "rulings": [],
        "complexity": host.get("complexity", ""),
        "art_url": "/stack?q=" + quote(" + ".join(combo.names)),
        "mod_html": note,
        "alts": [],
    }


@app.get("/api/card")
def api_card(name: str):
    # No card name contains a '+', so it unambiguously means "stack these".
    if "+" in name:
        return _combo_payload(name)
    card, matched, alts = core.cards.lookup(name)
    if not card:
        raise HTTPException(status_code=404, detail=f"No card matching {name!r}.")
    factions = core.cards.factions(card)
    return {
        "name": matched,
        "type": card.get("type", ""),
        "type_html": render_card_text_html(card.get("type", "")),
        "cost": card.get("cost", ""),
        "cost_html": render_cost_html(card.get("cost", "")),
        "total_cost": card.get("total_cost", ""),
        "power": card.get("power", ""),
        "toughness": card.get("toughness", ""),
        "factions": factions,
        "factions_html": render_factions_html(factions),
        "text": card.get("text", ""),
        "text_html": render_card_text_html(card.get("text", "")),
        "rulings": card.get("rulings") or [],
        "complexity": card.get("complexity", ""),
        "art_url": _art_url(matched),
        "alts": alts,
    }


@app.get("/api/search")
def api_search(q: str, limit: int = 8):
    """Find cards from a free-text DESCRIPTION — the web twin of `&search`.

    Same ranking as the bot (cards.CardIndex.search); the page shows the best
    match as a full card panel, identical to `/card`, and lists the runners-up
    with the line of text that matched.
    """
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Empty search.")
    hits = core.cards.search(query, limit=max(1, min(limit, 20)))
    return {
        "query": query,
        "results": [{
            "name": h.name,
            "type_html": render_card_text_html(h.card.get("type", "")),
            "cost_html": render_cost_html(h.card.get("cost", "")),
            "power": h.card.get("power", ""),
            "toughness": h.card.get("toughness", ""),
            "factions_html": render_factions_html(core.cards.factions(h.card)),
            # The line that made this a candidate — rendered like any card text,
            # so [Switch1] / {Haste} come through as icons in the result list too.
            "snippet_html": render_card_text_html(h.snippet()),
            "art_url": _art_url(h.name),
        } for h in hits],
    }


@app.get("/api/icons")
def api_icons():
    """Game-icon tokens ([Augment], {Battle}, …) mapped to their image.

    The page swaps these in on the DOM *after* it renders an answer's markdown,
    rather than us baking <img> into the answer text here. Answers quote card text,
    and the model often quotes it inside a code span — whose contents a markdown
    renderer escapes, so pre-baked HTML prints as source. Substituting on the DOM
    puts the icon inside the code span instead of the tag's text. The token->name
    mapping still lives in core, so both front-ends agree on what a token means.
    """
    return {"tokens": {tok: f"/icons/{name}.webp"
                       for tok, name in core.ICON_NAMES.items()
                       if name in AVAILABLE_ICONS}}


@app.get("/api/cardnames")
def api_cardnames():
    """Names of cards that have art, for in-text hover/tap previews on the page,
    plus the rules for the ones whose names are also ordinary words (see
    cards.AMBIGUOUS_NAMES) — the page matches names, so it needs the vocabulary."""
    return {
        "names": CARD_NAMES_WITH_ART,
        "ambiguous": sorted(cards.AMBIGUOUS_NAMES),
        "veto_before": sorted(cards.LINK_VETO_BEFORE),
        "veto_after": sorted(cards.LINK_VETO_AFTER),
    }


# Curated example questions for the greeting suggestion (one shown at random per
# page load). Hand-picked and cleaned from real questions — kept on-topic and
# well-phrased, unlike the raw logs (which had typos, dupes, and off-topic test
# queries). Edit this list to change what's suggested.
EXAMPLE_QUESTIONS = [
    "What's the difference between augment and graft?",
    "Can a graft-only spell be played directly, or must it be grafted onto another card?",
    "A 1/1 is buffed to 3/3 'until regroup' and takes 1 damage — at regroup does it die or go back to 1/1?",
    "Can I play a Virus during the battle phase like a normal unit?",
    "Do flying creatures get blocked by non-flying creatures?",
    "If only one creature in my attacking column has flying, does my opponent need a flying blocker?",
    "If a creature in a column dies, do the others keep its shared attributes like flying?",
    "What is the X on a conjured spell if the card doesn't give a number?",
    "If I conjure a Fireball 2 and they conjure a Growth 2 on the same creature, who wins?",
    "Is diagonal adjacency a thing, or only orthogonal?",
    "Walk me through exactly what happens during the Regroup phase.",
    "What's the Algomancy keyword for trample?",
    "How does Sluggish work?",
    "How does Piercing excess damage work?",
    "Does the battle phase happen every turn, even if no one attacks?",
    "If a Virus puts -7/-7 on an enemy unit, does it go to the bin normally?",
    "How much life do players start with?",
    "Do unit cards count as spells?",
    "Why do some card abilities have text [in square brackets]?",
    "Does spawning a Robot with +1/+1 counters trigger Scrapyard Custodian?",
]


@app.get("/api/examples")
def api_examples():
    """Curated example questions for the greeting suggestion hint."""
    return {"questions": EXAMPLE_QUESTIONS}


# --- colour-combo suggestions --------------------------------------------
# Mirrors the Discord `&colors` / `&played` commands. History is keyed on the
# page's `session_id` (the stable per-browser id it already uses for feedback),
# so a browser remembers what it played without anyone needing an account.

def _colors_payload(games, suggestion=None, reason=None):
    cov = combos.coverage(games)
    return {
        "suggestion": list(suggestion) if suggestion else None,
        "reason": reason,                   # "new" (never played) | "stale" (longest unplayed)
        "played_count": len(cov["played"]),
        "total": cov["total"],
        "unplayed": [list(c) for c in cov["unplayed"]],
        "played": [{"colors": list(c), "count": cov["counts"][c], "last": cov["last"][c]}
                   for c in cov["played"]],
        # Everything the page needs to render a combo without hardcoding the
        # colour list — so adding light/dark to combos.COLORS just works.
        "icons": {c: f"/icons/{c}.webp" for c in combos.COLORS if c in AVAILABLE_ICONS},
        "swatches": {c: f"#{FACTION_COLOR[c]:06x}" for c in combos.COLORS
                     if c in FACTION_COLOR},
    }


@app.get("/api/colors")
def api_colors(session_id: str | None = None, exclude: str | None = None):
    """Suggest a combo to play next. `exclude` is a combo key to avoid (re-roll)."""
    games = store.read_games(session_id or "web")
    try:
        skip = combos.from_key(exclude) if exclude else None
    except combos.ComboError:
        skip = None                          # unknown key: nothing to avoid
    suggestion, reason = combos.suggest(games, exclude=skip)
    return _colors_payload(games, suggestion, reason)


@app.post("/api/colors/played")
def api_colors_played(req: PlayedRequest):
    """Record a combo as played. Returns the refreshed coverage for the page."""
    try:
        combo = combos.parse_combo(" ".join(req.colors))
    except combos.ComboError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    user_id = req.session_id or "web"
    games = store.read_games(user_id)
    recorded = not combos.logged_recently(games, combo)
    if recorded:
        store.log_game(combo, user_id, channel_id="web", source="web")
        games = store.read_games(user_id)
    # Echo the parsed combo so the page names it back correctly however it was typed.
    return {"recorded": recorded, "colors": list(combo), **_colors_payload(games)}


# --- pack-1-pick-X draft practice ----------------------------------------
# Mirrors the Discord `&p1p1` / `&p1p6` commands. The page renders the returned
# slots as a tap-to-pick grid; picks happen client-side (no round trip), and the
# `code` is the shareable/replayable seed — paste it into the bot for the same pack.

@app.get("/api/draft")
def api_draft(mode: str, seed: str | None = None):
    """A reproducible pack. `mode` is p1p1|p1p6; `seed` is optional — a bare seed
    or a full code like 'p1p6-7GK2QX' (which reproduces that exact pack)."""
    try:
        pack = draft.resolve(mode, seed)
    except draft.DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return draft.pack_payload(pack, art_url=_art_url)


# --- "What's the play?" puzzles ------------------------------------------
# Mirrors the Discord `&wtp` command. A puzzle is a board + a question + a hidden
# solution; you answer it, then reveal to check yourself. The solution is served
# from its OWN endpoint, never bundled with the board — otherwise it'd be sitting
# in the page's memory (and its network tab) the whole time you were "thinking".
#
# Who you are is the page's existing `session_id` (the stable per-browser id it
# already uses for feedback and colour history), so a browser remembers which
# puzzles it's seen without anyone needing an account.

# Set WTP_EDIT_KEY to require it for saving/deleting. Unset = editing is open,
# which is right for a LAN but not for a public tunnel.
EDIT_KEY = os.getenv("WTP_EDIT_KEY") or ""


class AttemptRequest(BaseModel):
    puzzle_id: str
    answer: str = ""
    session_id: str | None = None


class SaveRequest(BaseModel):
    puzzle: dict
    session_id: str | None = None


def _require_edit_key(key):
    # compare_digest so a wrong key can't be guessed a character at a time.
    import hmac
    if EDIT_KEY and not hmac.compare_digest(key or "", EDIT_KEY):
        raise HTTPException(status_code=403,
                            detail="Wrong edit key — you can play puzzles, but not save them.")


def _puzzle_error(exc) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


# Element icons for the board's status bars (fire/water/… — the same five the
# colour suggester uses). Shipped inside the puzzle payload so the board renderer
# gets everything it needs in one response, and so a missing icon file degrades to
# the element's name instead of a broken image.
WTP_ICONS = {e: f"/icons/{e}.webp" for e in wtp.ELEMENTS if e in AVAILABLE_ICONS}

# What the editor autocompletes over. NOT CARD_NAMES_WITH_ART: that list exists to
# decide what to linkify in *prose*, so it drops the reference cards — and with
# them "Generic Unit", which is a real, playable token and in fact the only truly
# vanilla body in the game (a printed X/X, no attribute, no text). Exactly what you
# want to build a combat-math puzzle out of. So the editor gets its own list: every
# card with art, minus the components nobody can put on a board.
WTP_CARD_NAMES = sorted(
    n for n in core.cards.names
    if core.cards.art_path(n) and n not in (cards.NON_CARD_NAMES - {"Generic Unit"}))

# Tokens made at a chosen size — the page marks their X field as required.
WTP_X_CARDS = sorted(n for n in WTP_CARD_NAMES
                     if wtp.needs_x(core.cards.cards.get(n)))

# Of those, the ones whose X arrives as +1/+1 COUNTERS rather than as a printed
# body — a Robot is a 0/0 that "spawns with X +1/+1 counters", a Generic Unit is
# printed X/X. The editor gives a Robot one control (its counters ARE its X, as
# the card says) instead of two that would mean the same thing.
WTP_COUNTER_TOKENS = sorted(n for n in WTP_X_CARDS
                            if wtp.x_is_counters(core.cards.cards.get(n)))


def _wtp_payload(p, *, solution=False):
    return {**wtp.payload(p, core.cards, art_url=_art_url, solution=solution),
            "icons": WTP_ICONS}


@app.get("/editor")
def editor():
    return FileResponse(str(STATIC / "editor.html"),
                        headers={"Cache-Control": "no-store"})


@app.get("/api/wtp/config")
def api_wtp_config():
    """What the editor needs before it can draw anything: whether saving needs a
    key, the element icons (it labels the resource inputs with them), and the card
    names it autocompletes over (incl. tokens, and which of those need an X)."""
    return {
        "edit_key_required": bool(EDIT_KEY), "icons": WTP_ICONS,
        "phases": list(wtp.PHASES), "elements": list(wtp.ELEMENTS),
        "cards": WTP_CARD_NAMES, "x_cards": WTP_X_CARDS,
        "counter_tokens": WTP_COUNTER_TOKENS,
        # The resources you can put on the table, as the actual cards they are —
        # the five elements plus Shard and Prismite, which expend for mana like
        # any other but give no affinity.
        "resource_kinds": [
            {"kind": k, "card": wtp.RESOURCE_CARD[k],
             "art_url": _art_url(wtp.RESOURCE_CARD[k])}
            for k in wtp.RESOURCE_KINDS],
        "resource_states": list(wtp.RESOURCE_STATES),
        "cardback_url": _art_url(wtp.CARDBACK),
    }


@app.get("/api/wtp/list")
def api_wtp_list(session_id: str | None = None):
    """Every puzzle, newest first, with what this browser has done with each."""
    seen = set(store.wtp_seen(session_id or "web"))
    solved = {e["puzzle_id"] for e in store.read_wtp(session_id or "web")
              if e.get("event") == "revealed"}
    return {"puzzles": [{**wtp.summary(p),
                         "seen": p.id in seen, "revealed": p.id in solved}
                        for p in wtp.load_all()]}


@app.get("/api/wtp/next")
def api_wtp_next(session_id: str | None = None, exclude: str | None = None):
    """A puzzle this browser hasn't seen (or the one it saw longest ago)."""
    puzzles = wtp.load_all()
    if not puzzles:
        raise HTTPException(status_code=404,
                            detail="There are no puzzles yet — make one in the editor.")
    user = session_id or "web"
    puzzle, why = wtp.pick_next(puzzles, store.wtp_seen(user), exclude=exclude)
    store.log_wtp(puzzle.id, "served", user, channel_id="web", source="web")
    return {**_wtp_payload(puzzle), "why": why}


@app.post("/api/wtp/preview")
def api_wtp_preview(req: SaveRequest):
    """Render an UNSAVED puzzle exactly as it will look when played.

    The editor's live preview goes through this rather than rendering from its own
    state in JS: the board renderer is fed one payload shape, built in one place
    (wtp.payload), so what you see while editing is what a player sees — card
    names resolved the same way, stats computed the same way. It also means the
    editor never needs its own copy of the card index.
    """
    try:
        p = wtp.from_json({**req.puzzle, "id": req.puzzle.get("id") or "wtp-PREVIEW"})
    except wtp.PuzzleError as exc:
        raise _puzzle_error(exc)
    return {**_wtp_payload(p, solution=True),
            "warnings": wtp.validate(p, core.cards)}


@app.post("/api/wtp/save")
def api_wtp_save(req: SaveRequest, x_edit_key: str = Header(default="")):
    """Create or update a puzzle. Returns its id and any non-fatal warnings."""
    _require_edit_key(x_edit_key)
    try:
        p = wtp.from_json(req.puzzle)
        wtp.save(p)
    except wtp.PuzzleError as exc:
        raise _puzzle_error(exc)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Couldn't write the puzzle: {exc}")
    return {"id": p.id, "warnings": wtp.validate(p, core.cards),
            "puzzle": wtp.to_json(p)}


@app.post("/api/wtp/attempt")
def api_wtp_attempt(req: AttemptRequest):
    """Record what someone answered, before they reveal. Worth keeping: for a
    learner, *why* they got it wrong is the whole lesson."""
    try:
        pid = wtp.normalize_id(req.puzzle_id)
    except wtp.PuzzleError as exc:
        raise _puzzle_error(exc)
    store.log_wtp(pid, "answered", req.session_id or "web",
                  answer=(req.answer or "").strip(), channel_id="web", source="web")
    return {"ok": True}


@app.delete("/api/wtp/{pid}")
def api_wtp_delete(pid: str, x_edit_key: str = Header(default="")):
    _require_edit_key(x_edit_key)
    try:
        wtp.delete(pid)
    except wtp.PuzzleError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@app.get("/api/wtp/{pid}/solution")
def api_wtp_solution(pid: str, session_id: str | None = None):
    """The answer. Fetched only when someone actually asks to see it."""
    try:
        p = wtp.load(pid)
    except wtp.PuzzleError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    store.log_wtp(p.id, "revealed", session_id or "web",
                  channel_id="web", source="web")
    return {"id": p.id, "solution": p.solution, "hints": list(p.hints)}


@app.get("/api/wtp/{pid}/board.png")
def api_wtp_board(pid: str):
    """The board as one image — the same picture the Discord bot posts. Handy for
    sharing a puzzle anywhere that can't run the page."""
    try:
        p = wtp.load(pid)
    except wtp.PuzzleError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return Response(content=wtp.render_board_image(p, core.cards),
                    media_type="image/png",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/wtp/{pid}")
def api_wtp_one(pid: str, session_id: str | None = None):
    """One puzzle, board and question only — no solution (see /solution)."""
    try:
        p = wtp.load(pid)
    except wtp.PuzzleError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    store.log_wtp(p.id, "served", session_id or "web", channel_id="web", source="web")
    return _wtp_payload(p)


@app.get("/art/{name}")
def art(name: str):
    path = core.cards.art_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="No art for that card.")
    return FileResponse(str(path), media_type="image/jpeg")


@app.get("/stack")
def stack(q: str):
    """The art for `A + B`: the cards stacked, each modification peeking out from
    under its host with the ability it contributes on show."""
    try:
        combo = mods.build(q, core.cards)
    except mods.ComboError as exc:
        raise _combo_error(exc)
    art = mods.render_stack(combo, core.cards)
    if not art:
        raise HTTPException(status_code=404, detail="No art for that card.")
    return Response(content=art, media_type="image/jpeg")


if __name__ == "__main__":
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser(description="Run the Algomancy rules web app.")
    ap.add_argument("deepseek_key", nargs="?",
                    help="DeepSeek API key (overrides the DEEPSEEK_API_KEY env var)")
    ap.add_argument("--model", help=f"DeepSeek model id (default: {core.DEEPSEEK_MODEL})")
    ap.add_argument("--host", default="0.0.0.0", help="bind host (default: 0.0.0.0)")
    ap.add_argument("--port", type=int, default=8000, help="bind port (default: 8000)")
    args = ap.parse_args()

    deepseek_key = args.deepseek_key or os.getenv("DEEPSEEK_API_KEY")
    if not deepseek_key:
        raise SystemExit(
            "Usage: python3 app.py <DEEPSEEK_API_KEY>\n"
            "(or set DEEPSEEK_API_KEY in the environment / .env).")

    core.init_client(deepseek_key, model=args.model)
    uvicorn.run(app, host=args.host, port=args.port)
