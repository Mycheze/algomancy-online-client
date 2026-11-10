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

import hashlib
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Locations live in paths.py.
#
# ⚠ IMPORTED AS FUNCTIONS AND CALLED AT THE POINT OF USE, never bound to a
# module-level constant here. These paths are overridable with ALGO_VAR_DIR so a
# test can be pointed at a scratch directory, and binding one at import time
# would defeat that for any caller that sets the variable after this module is
# loaded — writing to the real log while believing it had been redirected.
#
# That is not hypothetical. It is what this module did until 2026-09-01: the
# puzzle feature's test wrote 136 of the 247 rows in the live
# var/logs/wtp_attempts.jsonl. The feature was removed on 2026-09-02, so the
# example is history — the rule is not.
from paths import (
    log_dir,
    responses_log,
    feedback_log,
    general_feedback_log,
    games_log,

)

_lock = threading.Lock()


class Bounded(dict):
    """A dict with a ceiling: past `cap` entries, the oldest-inserted go.

    Every in-memory map the bot keeps — thread histories, draft picks, who
    has been told about `&`, what the queue announcer posted — grew for the
    life of a Restart=always process. None of it matters after a restart, so
    none of it needs to outlive a few hundred entries either."""

    def __init__(self, cap: int):
        super().__init__()
        self.cap = cap

    def __setitem__(self, key, value):
        if key in self:
            del self[key]           # re-inserting moves it to the young end
        super().__setitem__(key, value)
        while len(self) > self.cap:
            del self[next(iter(self))]

    def setdefault(self, key, default=None):
        if key not in self:
            self[key] = default
        return self[key]


_SALT = None


def _who(user_id) -> str:
    """The answer log used to carry raw Discord user ids next to every question
    somebody ever asked, for ever. It carries a salted hash now: the same person
    still lines up across rows (which is what the eval set needs), and the row
    no longer names them. The salt is minted once per deployment and lives
    beside the logs; nothing reads it back but this function."""
    global _SALT
    if _SALT is None:
        salt_file = log_dir() / ".salt"
        try:
            _SALT = salt_file.read_text().strip()
        except FileNotFoundError:
            log_dir().mkdir(parents=True, exist_ok=True)
            _SALT = secrets.token_hex(16)
            salt_file.write_text(_SALT + "\n")
    return hashlib.sha256(f"{_SALT}:{user_id}".encode()).hexdigest()[:16]

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
                 reasoning=False, engine_version=None, llm=None, error=None, asker=None):
    """Persist one AI answer with its full retrieval context for later training.

    `llm` is the dict core.answer_question(meta=...) filled. Its fields are
    ADDED to the record (latency_ms, total_ms, usage, cost_usd, cost_basis,
    provider, requested_model, fallback, attempts) and every older field keeps
    its name and meaning — except that `model` becomes the model that actually
    answered, which differs from the configured one only when the fallback ran
    (then `requested_model` and `fallback` say so). Rows from before
    2026-10-11 simply lack the new keys.

    `error` is set only by log_failure(); a successful row never has the key.

    `asker` (BL-17, 2026-11-10) is the BADGE of the account that asked in a
    game — {"owner": true} or {"judge": 1-3} — and only when the game server
    vouched for it (app.py api_ask); absent for everybody else. Never who."""
    llm = llm or {}
    record = {
        "response_id": response_id,
        "ts": _now(),
        "kind": kind,                       # "ask" | "followup"
        "model": llm.get("model") or model,
        "reasoning": reasoning,             # True if "math mode" thinking was on
        "engine_version": engine_version,   # which prompt+primer+corpus produced it

        "user_id": _who(user_id),
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
    # Measured per call (added 2026-10-11). Absent keys stay absent rather than
    # null when the caller passed no meta, so "not measured" and "unknown" differ.
    # surface and cr_notes added 2026-10-11: where the answer was read (web |
    # discord), and the ids of the open CR review notes shown to the model with
    # it (crnotes.py) — live data, so the log is the only record of them.
    # The judge tools (2026-11-01, core._run_tools; absent with ALGO_TOOLS=off):
    # tools_level, tools [{name, args, ms, ok, chars}], tool_rounds,
    # model_calls, the quote check's quote_fail / engine_mismatch, and
    # tools_skipped / tools_error when an answer fell back to no tools.
    for key in ("requested_model", "provider", "latency_ms", "total_ms", "usage",
                "cost_usd", "cost_basis", "fallback", "attempts", "surface", "cr_notes",
                "tools_level", "tools", "tool_rounds", "model_calls", "quote_fail",
                "engine_mismatch", "tools_skipped", "tools_error"):
        if key in llm:
            record[key] = llm[key]
    if error is not None:
        record["error"] = error
    if asker:
        record["asker"] = asker
    _append(responses_log(), record)


def log_failure(kind, question, error, model, *, llm=None, engine_version=None, **where):
    """An answer that never came (every attempt failed, or anything else raised)
    as a responses.jsonl row, so the failure rate is a count over the log and not
    a grep of the journal. Same shape as a success: every key present, `answer`
    the empty string, plus `error` (the exception text) and whatever `attempts`
    the call got through. A reader that wants answers skips rows with `error`.
    No feedback can join to it: no button was ever shown for its response_id.
    Returns the response_id."""
    llm = llm or {}
    rid = new_response_id()
    log_response(rid, kind, question, "", llm.get("hits") or [], model,
                 reasoning=llm.get("reasoning", False), engine_version=engine_version,
                 llm=llm, error=f"{type(error).__name__}: {error}", **where)
    return rid

def log_feedback(response_id, rating, user_id):
    """Record a 👍/👎 click. rating is 'good' or 'bad'. Latest click wins at join time."""
    _append(feedback_log(), {
        "ts": _now(),
        "response_id": response_id,
        "rating": rating,
        "user_id": _who(user_id),
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



# --- the judges' review queue (BL-17) ------------------------------------
# Badged judges read the answers the bot gave and flag the bad ones. The flags
# are the GAME SERVER's (var/judge-flags.jsonl, keyed on response_id, with the
# judge's account); this side only hands over what was asked and answered,
# through app.py's token-gated GET /api/review/questions.

REVIEW_TEXT_MAX = 6000      # one question or answer, as the review page shows it
REVIEW_TURN_MAX = 1500      # one earlier turn of a follow-up's thread
REVIEW_TURNS = 4            # how many earlier turns come with a follow-up


def _tail_lines(path, want):
    """The last `want` non-empty lines of `path`, newest first — read backwards
    in blocks, because responses.jsonl carries every retrieved chunk in full and
    is far too big to read whole for a page of fifty questions."""
    out, rest = [], b""
    with path.open("rb") as f:
        f.seek(0, 2)
        pos = f.tell()
        while pos > 0 and len(out) < want:
            step = min(1 << 16, pos)
            pos -= step
            f.seek(pos)
            chunk = f.read(step) + rest
            lines = chunk.split(b"\n")
            rest = lines[0]               # may be cut mid-line; finished next block
            for line in reversed(lines[1:]):
                if line.strip():
                    out.append(line)
                    if len(out) >= want:
                        break
        if pos == 0 and rest.strip() and len(out) < want:
            out.append(rest)
    return out


def _latest_ratings():
    """response_id -> the last 👍/👎 anybody clicked on it (good | weird | bad)."""
    path = feedback_log()
    ratings = {}
    if not path.exists():
        return ratings
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("response_id") and row.get("rating"):
                ratings[row["response_id"]] = row["rating"]
    return ratings


def _asker_badge(raw):
    """A logged `asker`, as the review page may show it: the badge alone."""
    if not isinstance(raw, dict):
        return None
    if raw.get("owner") is True:
        return {"owner": True}
    if raw.get("judge") in (1, 2, 3):
        return {"judge": raw["judge"]}
    return None


def recent_answers(limit=200):
    """The last `limit` answers the bot gave, newest first, as the judges'
    review page shows them: what was asked, what it said, where (web — the site
    and the in-game judge box — or discord), the thread before a follow-up, and
    the players' own rating. A failed call (`error`) answered nothing and is
    left out. No user id of any kind: a judge reviews the answer, not the asker
    — only, when a judge or the owner asked in a game, their badge (`asker`), so
    the page can list those questions first (BL-17)."""
    path = responses_log()
    if not path.exists():
        return []
    with _lock:
        lines = _tail_lines(path, max(limit * 2, limit + 20))
    ratings = _latest_ratings()
    out = []
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("error") or not row.get("response_id") or not row.get("answer"):
            continue
        surface = row.get("surface") or ("web" if row.get("channel_id") == "web" else "discord")
        turns = [{"role": t.get("role"), "content": str(t.get("content", ""))[:REVIEW_TURN_MAX]}
                 for t in (row.get("history") or [])[-REVIEW_TURNS:] if isinstance(t, dict)]
        item = {
            "id": row["response_id"],
            "ts": row.get("ts"),
            "kind": row.get("kind"),
            "surface": surface,
            "question": str(row.get("question", ""))[:REVIEW_TEXT_MAX],
            "answer": str(row.get("answer", ""))[:REVIEW_TEXT_MAX],
        }
        if turns:
            item["history"] = turns
        asker = _asker_badge(row.get("asker"))
        if asker:
            item["asker"] = asker
        if row["response_id"] in ratings:
            item["rating"] = ratings[row["response_id"]]
        out.append(item)
        if len(out) >= limit:
            break
    return out
