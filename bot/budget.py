"""
budget.py — the one spending limit every way of asking the rules bot shares.

`core.answer_question` is the only door to the paid model and it enters
through `BUDGET.admit()`, so `/ask`, a Discord thread follow-up, the web page
and the game server's judge proxy all get the same three limits:

  per asker   ALGO_ASK_PER_DAY questions per UTC day (default 40). The caller
              names the asker (`discord_asker`, a game account the proxy
              vouches for, or the peer address). An owner or judge badge is
              exempt from this limit only. Counted in memory: a restart
              forgets it.
  spend       ALGO_ASK_USD_PER_DAY of logged `cost_usd` per UTC day (default 5).
  in flight   ALGO_ASK_IN_FLIGHT answers at once in this process (default 4).
              The next caller is refused at once, never queued.

The spend total is shared by bot.py and app.py, two processes, through the one
file both append to, responses.jsonl. Each holds today's total from that file
plus what it spent itself since it last read it, and reads only the bytes
appended since — at most once per RESEED_SECONDS. So one process sees the
other's spending at most RESEED_SECONDS late, and the overshoot past the cap is
at most the other process's spend in one such window plus one answer's cost for
each answer already in flight in either process when the cap is reached.

A refusal is `OverBudget`, whose message is one sentence for the person who
asked; it is raised before any model call, so it costs nothing and is not
logged.
"""

import inspect
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import store
from paths import responses_log

RESEED_SECONDS = 60
_BLOCK = 1 << 16


class OverBudget(Exception):
    """A question refused before the model was called. The message is written
    to be shown to a person, not logged at one."""


BUSY = "The rules bot is answering as many questions as it can right now. Try again in a moment."
ASKER_LIMIT = ("You have asked the rules bot {n} questions today, which is the daily limit. "
               "It resets at midnight UTC.")
SPEND_LIMIT = "The rules bot has used up today's budget and will be back at midnight UTC."


def _env(name, default, cast):
    try:
        return cast(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _utc_now():
    return datetime.now(timezone.utc)


def exempt(badge) -> bool:
    """An owner or judge badge (gameserver.badge_of's shape) skips the
    per-asker cap."""
    return isinstance(badge, dict) and (badge.get("owner") is True
                                        or badge.get("judge") in (1, 2, 3))


def discord_asker(user_id) -> str:
    """The asker key for a Discord user: the same salted hash the answer log
    stores, so no raw id is held here either."""
    return f"discord:{store._who(user_id)}"


def _row_cost(line: bytes):
    """(row's UTC day, its cost) for one log line, or None if unreadable."""
    try:
        row = json.loads(line)
    except (ValueError, UnicodeDecodeError):
        return None
    ts = row.get("ts") if isinstance(row, dict) else None
    if not isinstance(ts, str) or len(ts) < 10:
        return None
    cost = row.get("cost_usd")
    return ts[:10], (float(cost) if isinstance(cost, (int, float)) and cost > 0 else 0.0)


class Budget:
    def __init__(self, *, per_asker=None, daily_usd=None, in_flight=None,
                 clock=_utc_now, monotonic=time.monotonic, log=responses_log,
                 reseed_seconds=RESEED_SECONDS):
        self.per_asker = per_asker if per_asker is not None else _env("ALGO_ASK_PER_DAY", 40, int)
        self.daily_usd = daily_usd if daily_usd is not None else _env("ALGO_ASK_USD_PER_DAY", 5.0, float)
        self.max_in_flight = in_flight if in_flight is not None else _env("ALGO_ASK_IN_FLIGHT", 4, int)
        self.clock, self.monotonic, self.log = clock, monotonic, log
        self.reseed_seconds = reseed_seconds
        self.in_flight = 0
        self._lock = threading.Lock()
        self._day = None
        self._asked = {}
        self._file_usd = 0.0    # today's cost in the log, up to _offset
        self._local_usd = 0.0   # this process's cost since the log was last read
        self._offset = None     # bytes of the log already summed; None = never read
        self._read_at = None

    # ── the spend total ────────────────────────────────────────────────────
    def _roll(self):
        day = self.clock().date().isoformat()
        if day != self._day:
            self._day, self._asked = day, {}
            self._file_usd = self._local_usd = 0.0

    def _refresh(self):
        now = self.monotonic()
        if self._offset is not None and now - self._read_at < self.reseed_seconds:
            return
        self._read_at = now
        path = self.log()
        try:
            size = path.stat().st_size
        except OSError:     # nothing logged yet: what it spent stays local
            self._file_usd = 0.0
            return
        if self._offset is None or size < self._offset:
            self._seed(path, size)
        else:
            self._catch_up(path)
        self._local_usd = 0.0   # whatever it spent is in the file now (or lost, uncounted)

    def _seed(self, path, size):
        """Today's cost, read backwards from the end until yesterday."""
        total, end, rest, pos = 0.0, None, b"", size
        with path.open("rb") as f:
            while pos > 0:
                step = min(_BLOCK, pos)
                pos -= step
                f.seek(pos)
                chunk = f.read(step) + rest
                if end is None:     # a half-written last line is read next time
                    cut = chunk.rfind(b"\n")
                    if cut < 0:
                        rest = chunk
                        continue
                    end = pos + cut + 1
                    chunk = chunk[:cut]
                lines = chunk.split(b"\n")
                rest = lines[0] if pos > 0 else b""
                done = False
                for line in reversed(lines if pos == 0 else lines[1:]):
                    got = line.strip() and _row_cost(line)
                    if not got:
                        continue
                    if got[0] < self._day:
                        done = True
                        break
                    if got[0] == self._day:
                        total += got[1]
                if done:
                    break
        self._offset, self._file_usd = (end or 0), total

    def _catch_up(self, path):
        """Add the rows appended since the last read."""
        with path.open("rb") as f:
            f.seek(self._offset)
            data = f.read()
        cut = data.rfind(b"\n")
        if cut < 0:
            return
        for line in data[:cut].split(b"\n"):
            got = line.strip() and _row_cost(line)
            if got and got[0] == self._day:
                self._file_usd += got[1]
        self._offset += cut + 1

    def spent_today(self) -> float:
        with self._lock:
            self._roll()
            self._refresh()
            return self._file_usd + self._local_usd

    def spend(self, usd):
        """Count an answer's cost (meta["cost_usd"]) until the log is next read."""
        if isinstance(usd, (int, float)) and usd > 0:
            with self._lock:
                self._roll()
                self._local_usd += float(usd)

    # ── admission ──────────────────────────────────────────────────────────
    @asynccontextmanager
    async def admit(self, asker=None, badge=None):
        """Hold one in-flight slot for one question, or raise OverBudget.

        `asker`: the key the per-asker cap counts; None counts nobody (the
        tests and the eval). `badge`: a dict, None, or a Future of one —
        awaited only when the asker is already at the cap."""
        with self._lock:
            self._roll()
            self._refresh()
            if self._file_usd + self._local_usd >= self.daily_usd:
                raise OverBudget(SPEND_LIMIT)
            at_cap = asker is not None and self._asked.get(asker, 0) >= self.per_asker
        if at_cap:
            if inspect.isawaitable(badge):
                badge = await badge
            if not exempt(badge):
                raise OverBudget(ASKER_LIMIT.format(n=self.per_asker))
        with self._lock:
            if self.in_flight >= self.max_in_flight:
                raise OverBudget(BUSY)
            self.in_flight += 1
            if asker is not None:
                self._asked[asker] = self._asked.get(asker, 0) + 1
        try:
            yield self
        finally:
            with self._lock:
                self.in_flight -= 1


#: the process's budget; core.answer_question reads it per call. None turns the
#: limit off — only for an operator's own run (bot/eval/run.py), never a surface.
BUDGET: Budget | None = Budget()
