#!/usr/bin/env python3
"""
store.py — append-only logging of AI responses + user feedback.

Every AI-generated answer (an `&ask` or a thread follow-up) is written to
`logs/responses.jsonl` with everything needed to later train/evaluate a real RAG
model OFFLINE: the question, the answer, the full retrieved chunks (text + scores),
the model used, and the conversation history. User feedback (👍/👎) lands in
`logs/feedback.jsonl`, linked back by `response_id`. Absence of feedback = neutral.

Both files are append-only JSONL — safe to tail, easy to join on `response_id`.
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
                 reasoning=False):
    """Persist one AI answer with its full retrieval context for later training."""
    record = {
        "response_id": response_id,
        "ts": _now(),
        "kind": kind,                       # "ask" | "followup"
        "model": model,
        "reasoning": reasoning,             # True if "math mode" thinking was on

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
