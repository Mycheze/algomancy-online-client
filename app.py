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
  GET  /art/{name}       card art image
  /icons/...             game icon images (Icons/)

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
import store
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
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
    # Escape first; the formatting codes ({/n}, {i}, [augment], …) contain no
    # HTML-special characters, so they survive escaping intact and we can match
    # them next. Icon <img> tags are injected afterward, so they stay live.
    t = escape(text)
    t = t.replace("{/n}", "<br>")
    t = re.sub(r"\{/?i\d*\}", "", t)              # italic markers {i} {i1} {/i}
    t = t.replace("{g}", "").replace("{p}", "")   # attribute colour markers
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
        "response_id": rid,
        "answer": display,                  # markdown with citation superscripts
        # Same text with icon tokens ([Switch1], [Augment], …) swapped for <img>
        # icons — for display only. `answer` stays plain because the page sends it
        # back as conversation history, and history should carry no markup.
        "answer_display": core.render_icons(display, _icon_img),
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


@app.get("/api/card")
def api_card(name: str):
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
