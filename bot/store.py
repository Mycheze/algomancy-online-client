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

# Locations live in paths.py.
#
# ⚠ IMPORTED AS FUNCTIONS AND CALLED AT THE POINT OF USE, never bound to a
# module-level constant here. These five paths are overridable with ALGO_VAR_DIR
# so a test can be pointed at a scratch directory, and binding one at import
# time would defeat that for any caller that sets the variable after this module
# is loaded — writing to the real log while believing it had been redirected.
# That is not hypothetical: it is what this module did until 2026-09-01, and
# 136 of the 247 rows in the live wtp_attempts.jsonl are the result.
from paths import (
    log_dir,
    responses_log,
    feedback_log,
    general_feedback_log,
    games_log,
    wtp_attempts_log,
)

_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _append(path, record):
    with _lock:
        # parents=True: a scratch ALGO_VAR_DIR has no `logs/` yet, and neither
        # does a fresh deployment. `exist_ok` alone only tolerated the parent
        # already being there.
        log_dir().mkdir(parents=True, exist_ok=True)
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
    _append(responses_log(), record)


def log_feedback(response_id, rating, user_id):
    """Record a 👍/👎 click. rating is 'good' or 'bad'. Latest click wins at join time."""
    _append(feedback_log(), {
        "ts": _now(),
        "response_id": response_id,
        "rating": rating,
        "user_id": user_id,
    })


def log_general_feedback(text, user_id, *, channel_id=None, thread_id=None):
    """Record freeform feedback about the bot from `&feedback` — NOT tied to a
    specific answer (so it goes in its own file, not feedback.jsonl)."""
    _append(general_feedback_log(), {
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
    _append(games_log(), {
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
    path = games_log()
    if not path.exists():
        return []
    want = None if user_id is None else str(user_id)
    games = []
    with _lock:
        with path.open(encoding="utf-8") as f:
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


# --- "What's the play?" puzzle attempts (wtp.py) --------------------------
# Which puzzles a person has been served, what they answered, and whether they
# revealed the solution. Two jobs: the bot/site use it to hand you a puzzle you
# haven't seen (like read_games feeds combos.suggest), and the answers are worth
# reading afterwards — for a learner, WHY they got it wrong is the whole lesson.
# Same key space as games.jsonl: a Discord user id or a web session id, as a str.

def log_wtp(puzzle_id, event, user_id, *, answer=None, channel_id=None, source=None):
    """Record one puzzle event. `event` is served | answered | revealed | hint."""
    _append(wtp_attempts_log(), {
        "ts": _now(),
        "puzzle_id": puzzle_id,
        "event": event,
        "user_id": str(user_id),
        "answer": answer,               # what they wrote, on an "answered" event
        "channel_id": channel_id,
        "source": source,               # "discord" | "web"
    })


def read_wtp(user_id=None, puzzle_id=None):
    """Puzzle events, oldest first — filtered to a user and/or a puzzle.

    Re-read per call, like read_games: the file is one line per puzzle opened, so
    it stays small, and a puzzle solved in Discord counts as seen on the website
    immediately (the two front-ends can be separate processes).
    """
    path = wtp_attempts_log()
    if not path.exists():
        return []
    want_user = None if user_id is None else str(user_id)
    events = []
    with _lock:
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if want_user is not None and record.get("user_id") != want_user:
                    continue
                if puzzle_id is not None and record.get("puzzle_id") != puzzle_id:
                    continue
                events.append(record)
    return events


def wtp_seen(user_id):
    """Puzzle ids this person has been served, oldest first (duplicates kept, so
    wtp.pick_next can tell which one they saw longest ago)."""
    return [e["puzzle_id"] for e in read_wtp(user_id)
            if e.get("event") == "served" and e.get("puzzle_id")]
