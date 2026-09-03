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
  GET  /art/{name}       card art image
  /icons/...             game icon images (data/icons/)

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

import functools
import mimetypes
from typing import Literal
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
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import cards
from cards import FACTION_COLOR

# Locations live in paths.py — see the note there on why not `Path(__file__).parent`.
from paths import WEB_DIR as STATIC, ICONS_DIR as ICONS
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

# --- request models ------------------------------------------------------

# ⚠ EVERY FIELD A CALLER CONTROLS HAS A CEILING, AND `role` IS A CHOICE. It
# was a bare `str`, and core.answer_question appends non-assistant turns to the
# message list verbatim — so `{"role": "system", "content": "..."}` in the
# history was a second system prompt, from whoever cared to send one. The
# game server's proxy already caps `question` at 2000; this is the same cap
# on the thing being proxied to, for the day it is reachable some other way.
_SESSION = Field(default=None, max_length=64)


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AskRequest(BaseModel):
    question: str = Field(max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=8)
    session_id: str | None = _SESSION


class FeedbackRequest(BaseModel):
    response_id: str = Field(pattern=r"^[0-9a-f]{32}$")     # store.new_response_id()
    rating: str = Field(max_length=8)   # good | weird | bad (matches the Discord buttons)
    session_id: str | None = _SESSION


class PlayedRequest(BaseModel):
    colors: list[str] = Field(max_length=3)     # three colour names
    session_id: str | None = _SESSION


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
    return core.sub_card_token(m.group(0), _icon_img, escape)


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
    return core.render_cost(cost, _icon_img, escape)


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
        # combo.type, not the host's: an augment can grant attributes, and the
        # type line is where they land.
        "type": combo.type,
        "type_html": render_card_text_html(combo.type),
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


def _cost_tokens():
    """Every [cost] token the page might meet, mapped to the icons that draw it.

    The keyword tokens are a fixed list, but the costs are not: [one] and [x] are
    spelled out in core, while the compound ones ([4bb], [2be]) are whatever the set
    happens to print. So harvest those off the cards themselves — the page needs
    literal tokens to build its regex from, and an answer only ever quotes a cost
    that some card prints.
    """
    tokens = {f"[{w}]" for w in core.COST_WORDS}
    for card in core.cards.cards.values():
        for tok in core.ICON_TOKEN_RE.findall(card.get("text") or ""):
            if core.cost_token_icons(tok):
                tokens.add(tok.lower())
    return tokens


@app.get("/api/icons")
def api_icons():
    """Game-icon tokens ([Augment], {Battle}, [one], …) mapped to their images.

    The page swaps these in on the DOM *after* it renders an answer's markdown,
    rather than us baking <img> into the answer text here. Answers quote card text,
    and the model often quotes it inside a code span — whose contents a markdown
    renderer escapes, so pre-baked HTML prints as source. Substituting on the DOM
    puts the icon inside the code span instead of the tag's text. The token->name
    mapping still lives in core, so both front-ends agree on what a token means.

    Each token maps to a LIST of images, because a cost token can be more than one:
    [4bb] draws a "4" and two water drops. A token whose icons aren't all on disk is
    left out entirely, so the page leaves it as text rather than drawing half a cost.
    """
    def urls(names):
        if not all(n in AVAILABLE_ICONS for n in names):
            return None
        return [f"/icons/{n}.webp" for n in names]

    tokens = {tok: urls([name]) for tok, name in core.ICON_NAMES.items()}
    tokens |= {tok: urls([n for n, _ in core.cost_token_icons(tok)])
               for tok in _cost_tokens()}
    return {"tokens": {tok: u for tok, u in tokens.items() if u}}


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


@app.get("/art/{name}")
def art(name: str):
    path = core.cards.art_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="No art for that card.")
    return FileResponse(str(path), media_type="image/jpeg")


@functools.lru_cache(maxsize=256)
def _stacked_art(q: str) -> bytes | None:
    """Memoised: compositing several 200 KB scans is the most expensive thing
    this app does per request, and the same pairs come up again and again."""
    combo = mods.build(q, core.cards)
    return mods.render_stack(combo, core.cards)


@app.get("/stack")
def stack(q: str = Query(max_length=200)):
    """The art for `A + B`: the cards stacked, each modification peeking out from
    under its host with the ability it contributes on show."""
    try:
        art = _stacked_art(q.strip().lower())
    except mods.ComboError as exc:
        raise _combo_error(exc)
    if not art:
        raise HTTPException(status_code=404, detail="No art for that card.")
    return Response(content=art, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400"})


if __name__ == "__main__":
    import argparse

    import uvicorn

    # ⚠ LOOPBACK BY DEFAULT. This app has no auth and no rate limit in front of
    # a paid model, and it does not need either: the game server on :5000
    # proxies /api/judge and /api/cardinfo to it and caps what comes through.
    # --host 0.0.0.0 is still here for a box that genuinely wants the page
    # public; it is a decision now, not the default.
    # ⚠ AND NO SECRET ON THE COMMAND LINE — see bot.py's note.
    ap = argparse.ArgumentParser(description="Run the Algomancy rules web app.")
    ap.add_argument("--model", help=f"DeepSeek model id (default: {core.DEEPSEEK_MODEL})")
    ap.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8000, help="bind port (default: 8000)")
    args = ap.parse_args()

    deepseek_key = os.getenv("DEEPSEEK_API_KEY")
    if not deepseek_key:
        raise SystemExit("DEEPSEEK_API_KEY must be set in the environment or in .env "
                         "(see .env.example). It is not accepted on the command line.")

    core.init_client(deepseek_key, model=args.model)
    uvicorn.run(app, host=args.host, port=args.port)
