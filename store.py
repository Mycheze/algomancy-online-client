#!/usr/bin/env python3
"""
store.py — append-only logging of AI responses + user feedback.

Every AI-generated answer (an `&ask` or a thread follow-up) is written to
`logs/responses.jsonl` with everything needed to later train/evaluate a real RAG
model OFFLINE: the question, the answer, the full retrieved chunks (text + scores),
the model used, and the conversation history. User feedback (👍/👎) lands in
`logs/feedback.jsonl`, linked back by `response_id`. Absence of feedback = neutral.

A third file, `logs/games.jsonl`, records which 3-colour decks each person has
played, which is what `combos.py` reads to suggest a fresh combo.

All files are append-only JSONL — safe to tail, easy to join on `response_id`.
"""

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
RESPONSES = LOG_DIR / "responses.jsonl"
FEEDBACK = LOG_DIR / "feedback.jsonl"
GENERAL_FEEDBACK = LOG_DIR / "general_feedback.jsonl"
GAMES = LOG_DIR / "games.jsonl"

_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _append(path, record):
    with _lock:
        LOG_DIR.mkdir(exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def new_response_id():
    """Hex id — safe to embed in a Discord component custom_id."""
    return uuid.uuid4().hex


def log_response(response_id, kind, question, answer, hits, model,
                 *, user_id, channel_id, thread_id=None, history=None,
                 reasoning=False, engine_version=None):
    """Persist one AI answer with its full retrieval context for later training."""
    record = {
        "response_id": response_id,
        "ts": _now(),
        "kind": kind,                       # "ask" | "followup"
        "model": model,
        "reasoning": reasoning,             # True if "math mode" thinking was on
        "engine_version": engine_version,   # which prompt+primer+corpus produced it

        "user_id": user_id,
        "channel_id": channel_id,
        "thread_id": thread_id,
        "question": question,
        "answer": answer,
        "retrieved": [
            {
                "id": r["id"],
                "score": round(s, 4),
                "authority": r["authority"],
                "source_type": r["source_type"],
                "source": r["source"],
                "title": r["title"],
                "text": r["text"],          # full chunk, so logs are self-contained
            }
            for s, r in hits
        ],
        "history": history or [],           # prior turns (clean Q/A, no context blobs)
    }
    _append(RESPONSES, record)


def log_feedback(response_id, rating, user_id):
    """Record a 👍/👎 click. rating is 'good' or 'bad'. Latest click wins at join time."""
    _append(FEEDBACK, {
        "ts": _now(),
        "response_id": response_id,
        "rating": rating,
        "user_id": user_id,
    })


def log_general_feedback(text, user_id, *, channel_id=None, thread_id=None):
    """Record freeform feedback about the bot from `&feedback` — NOT tied to a
    specific answer (so it goes in its own file, not feedback.jsonl)."""
    _append(GENERAL_FEEDBACK, {
        "ts": _now(),
        "text": text,
        "user_id": user_id,
        "channel_id": channel_id,
        "thread_id": thread_id,
    })


# --- played colour combos (combos.py) ------------------------------------
# Which 3-colour decks a person has played, so the bot can suggest fresh ones.
# `user_id` is a Discord user id or a web session id; stored as a string so the
# two surfaces share one key space and one file.

def log_game(colors, user_id, *, channel_id=None, source=None):
    """Record that someone played a colour combo. `colors` should already be in
    canonical order (combos.canonical) so records compare cleanly by eye."""
    _append(GAMES, {
        "ts": _now(),
        "user_id": str(user_id),
        "colors": list(colors),
        "channel_id": channel_id,
        "source": source,               # "discord" | "web"
    })


def read_games(user_id=None):
    """Every logged game, oldest first — or just `user_id`'s if given.

    Re-read per call rather than cached: the file holds one line per game played,
    so it stays tiny, and a fresh read means a game logged from Discord shows up
    on the website immediately (both front-ends can even be separate processes).
    Malformed lines are skipped rather than crashing a suggestion.
    """
    if not GAMES.exists():
        return []
    want = None if user_id is None else str(user_id)
    games = []
    with _lock:
        with GAMES.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if want is None or record.get("user_id") == want:
                    games.append(record)
    return games
