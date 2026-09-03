"""
watchers.py — which Discord channels want to hear about the matchmaking queue,
and how often they are willing to hear it.

⚠ THIS IS THE FIRST REWRITABLE FILE THE PYTHON SIDE OWNS. Everything in
store.py is append-only JSONL, where a torn write costs one line and the rest
of the file is still good. This one is rewritten whole, so a half-written file
does not lose a row — it silently disables the feature and leaves no error
anywhere. Hence: write to a temp file and rename (atomic on the same
filesystem), and treat an unreadable file as empty rather than raising. A
config file must never be able to stop the bot from booting.

A dict keyed by channel id, not a log. This is CURRENT STATE — "these channels
are watching" — and an append-only log would mean replaying history to work out
what is true now.

THE COOLDOWN IS PER ACCOUNT AND GLOBAL, not per channel. Somebody who queues,
is offered a game, declines it and queues again is ONE event, however many
channels are watching. Per-channel cooldowns would let one person with three
watchers generate three separate bursts. There is a per-channel floor as well,
for the different case where several unrelated people queue at once.

⚠ time.monotonic(), NOT wall clock: an NTP step must not unlock a cooldown.
In memory on purpose — a restart forgetting a ten-minute value costs at most
one extra message, and persisting it would be a second file to keep correct.
"""

import json
import os
import threading
import time

import paths
import store

# How long before the same person can trigger another announcement anywhere.
JOIN_COOLDOWN = float(os.getenv("ALGO_QUEUE_COOLDOWN", "600"))
# …and the floor under any one channel, whoever it is about.
CHANNEL_COOLDOWN = float(os.getenv("ALGO_QUEUE_CHANNEL_COOLDOWN", "60"))

_lock = threading.RLock()
_last_user: dict[str, float] = store.Bounded(5000)
_last_channel: dict[int, float] = {}

# The file, as last read, and the mtime it had then. Every queue event used to
# read and parse it from disk on the bot's event loop.
_cache: tuple[float, dict] | None = None


def _read() -> dict:
    global _cache
    path = paths.queue_watch_file()
    try:
        stamp = path.stat().st_mtime_ns
    except FileNotFoundError:
        _cache = None
        return {"version": 1, "watches": {}}
    if _cache is not None and _cache[0] == stamp:
        return _cache[1]
    data = _read_file(path)
    _cache = (stamp, data)
    return data


def _read_file(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"version": 1, "watches": {}}
    except (json.JSONDecodeError, OSError) as exc:
        # ⚠ Never raise. A corrupt config must degrade to "nobody is watching",
        # not to a bot that will not start.
        print(f"[watchers] {path} unreadable ({exc}); treating as empty")
        return {"version": 1, "watches": {}}
    if not isinstance(data, dict) or not isinstance(data.get("watches"), dict):
        print(f"[watchers] {path} is not the shape I expect; treating as empty")
        return {"version": 1, "watches": {}}
    return data


def _write(data: dict) -> None:
    path = paths.queue_watch_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)          # atomic on the same filesystem


def all_watches() -> dict:
    """channel_id (int) -> {guild_id, role_id, added_by, added_at}."""
    with _lock:
        return {int(k): v for k, v in _read()["watches"].items()}


def watches_for_guild(guild_id: int) -> dict:
    return {c: w for c, w in all_watches().items() if w.get("guild_id") == guild_id}


def set_watch(channel_id: int, *, guild_id: int, role_id=None, added_by=None) -> bool:
    """Start (or update) a watch. True if it replaced an existing one."""
    with _lock:
        data = _read()
        existed = str(channel_id) in data["watches"]
        data["watches"][str(channel_id)] = {
            "guild_id": guild_id,
            "role_id": role_id,
            "added_by": str(added_by) if added_by else None,
            "added_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _write(data)
        return existed


def remove_watch(channel_id: int) -> bool:
    """Stop watching. True if there was anything to stop."""
    with _lock:
        data = _read()
        gone = data["watches"].pop(str(channel_id), None) is not None
        if gone:
            _write(data)
        return gone


def may_announce(user_id: str, channel_id: int, *, now=None) -> bool:
    """Is this person's queue join worth saying in this channel right now?

    Checks the per-person cooldown first, then the channel floor, and STAMPS
    both only when it says yes — so a suppressed announcement does not push
    the next one further away.
    """
    now = time.monotonic() if now is None else now
    with _lock:
        if now - _last_user.get(user_id, -1e9) < JOIN_COOLDOWN:
            return False
        if now - _last_channel.get(channel_id, -1e9) < CHANNEL_COOLDOWN:
            return False
        _last_user[user_id] = now
        _last_channel[channel_id] = now
        return True


def reset_cooldowns() -> None:
    """Test seam."""
    with _lock:
        _last_user.clear()
        _last_channel.clear()
