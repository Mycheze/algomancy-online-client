"""
gameserver.py — the bot's client for the digital client's game server.

The two halves of this repo have talked for a while, but only one way:
client/server/main.ts proxies /api/cardinfo and /api/judge out to bot/app.py on
:8000, so the in-game card inspector and the "ask the judge" box are the bot
answering the client. This is the return leg.

⚠ THE BOT HOLDS NO COPY OF ANYTHING THE SERVER OWNS. `/search` speaks the
browser's query language — `-el:fire (t:sprite OR t:demon) mana<=3` — and that
grammar lives in exactly one place, client/ui/cardsearch.ts, reached through
GET /api/cardsearch. Reimplementing it here in Python would be a second
grammar, and two grammars drift. Same for ratings, the queue and the ladder.

⚠ EVERY FAILURE IS ONE EXCEPTION CARRYING A SENTENCE. A connection refused, a
timeout, a 500, a body that is not JSON, and a body that says `{"ok": false}`
are all the same thing to a caller: the thing you asked for did not happen, and
here is what to tell the user. A caller that has to distinguish five failure
shapes is a caller that will handle four of them.

DEGRADATION IS A RULE, NOT A PER-COMMAND DECISION. Everything that needs :5000
catches GameServerDown and says three things: what it could not do, that it is
the GAME SERVER and not the bot that is down (they are separate services, and
the difference is "wait a minute" versus "tell Ben"), and what still works.
See cogs/common.down_notice.

CONFIG. ALGO_GAME_SERVER (default http://127.0.0.1:5000 — same box as the bot
on the deploy, so this is loopback) and ALGO_BOT_TOKEN.

⚠ ALGO_BOT_TOKEN LIVES IN TWO FILES AND THEY MUST MATCH. The Python side reads
the repo-root .env; the game server reads client/server/tester.env, which
the game server's systemd unit reads (deploy/algomancy-game.service). A mismatch is not an error — the
server's gate answers 404 to everything, which looks exactly like the feature
not existing.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

import aiohttp     # already a discord.py dependency; nothing new is installed

BASE = os.getenv("ALGO_GAME_SERVER", "http://127.0.0.1:5000").rstrip("/")
TOKEN = os.getenv("ALGO_BOT_TOKEN", "")
TIMEOUT = float(os.getenv("ALGO_GAME_SERVER_TIMEOUT", "5"))


class GameServerDown(Exception):
    """The game server did not answer, or answered with a refusal.

    The message is written to be shown to a person, not logged at one.
    """


class GameServer:
    """One session, reused. A session per request is what aiohttp warns about,
    and it matters even on loopback once /queue status is being polled."""

    def __init__(self, base=None, token=None, timeout=None):
        self.base = (base or BASE).rstrip("/")
        self.token = token if token is not None else TOKEN
        self.timeout = timeout or TIMEOUT
        self._session = None

    async def session(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout))
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _get(self, path, *, private=False, **params):
        # The token goes on a HEADER and never in the query string — the game
        # server refuses `?token=` deliberately, because a token in a URL is a
        # token in every access log on the way.
        headers = {"X-Algo-Bot": self.token} if private and self.token else {}
        url = f"{self.base}{path}"
        try:
            session = await self.session()
            async with session.get(url, params=params, headers=headers) as res:
                if res.status == 404 and private:
                    # ⚠ DO NOT NAME A CAUSE HERE. The server's gate answers 404
                    # for "no ALGO_BOT_TOKEN configured" and for "wrong token"
                    # ALIKE, deliberately — an unconfigured deploy must not
                    # admit the routes exist. So the bot genuinely cannot tell
                    # which it is, and saying one would send whoever reads it
                    # to the wrong file.
                    raise GameServerDown(
                        "the game server is not answering privileged requests — "
                        "ALGO_BOT_TOKEN is either unset there or does not match "
                        "the one here")
                if res.status >= 400:
                    raise GameServerDown(f"HTTP {res.status} from {path}")
                try:
                    body = await res.json(content_type=None)
                except Exception:
                    raise GameServerDown(f"{path} did not return JSON")
        except GameServerDown:
            raise
        except aiohttp.ClientError as exc:
            raise GameServerDown(str(exc) or exc.__class__.__name__)
        except TimeoutError:
            raise GameServerDown(f"timed out after {self.timeout:g}s")
        if not isinstance(body, dict):
            raise GameServerDown(f"{path} returned {type(body).__name__}, not an object")
        if body.get("ok") is False:
            raise GameServerDown(body.get("error") or "the server refused that")
        return body

    async def _post(self, path, body):
        headers = {"X-Algo-Bot": self.token} if self.token else {}
        url = f"{self.base}{path}"
        try:
            session = await self.session()
            async with session.post(url, json=body, headers=headers) as res:
                if res.status == 404:
                    raise GameServerDown(
                        "the game server is not answering privileged requests — "
                        "ALGO_BOT_TOKEN is either unset there or does not match "
                        "the one here")
                if res.status >= 400:
                    raise GameServerDown(f"HTTP {res.status} from {path}")
                try:
                    body_out = await res.json(content_type=None)
                except Exception:
                    raise GameServerDown(f"{path} did not return JSON")
        except GameServerDown:
            raise
        except aiohttp.ClientError as exc:
            raise GameServerDown(str(exc) or exc.__class__.__name__)
        except TimeoutError:
            raise GameServerDown(f"timed out after {self.timeout:g}s")
        if not isinstance(body_out, dict):
            raise GameServerDown(f"{path} returned {type(body_out).__name__}")
        # ⚠ Unlike _get, this does NOT raise on {"ok": false}. A refused link
        # ("that Discord account is already linked to Ben") is an answer the
        # user needs to read, not a transport failure — and turning it into an
        # exception would make the caller unwrap it again to say anything
        # useful. Callers of _post check `ok` themselves.
        return body_out

    # ── public ────────────────────────────────────────────────────────
    async def cardsearch(self, query, limit=10, implicit=True):
        """The browser's query language. Returns the whole payload — `total`
        is every match and `returned` is this page, and they are different
        numbers on purpose."""
        return await self._get("/api/cardsearch", q=query, limit=limit,
                               implicit="1" if implicit else "0")

    async def queue_counts(self):
        """How many are waiting. Unauthenticated by design: 'is anybody around'
        is the question somebody asks BEFORE deciding to sign up."""
        return await self._get("/api/queue")

    # ── privileged ────────────────────────────────────────────────────
    async def health(self):
        return await self._get("/api/bot/health", private=True)

    async def queue(self):
        """Who is waiting, by name. /api/queue gives numbers only, on purpose."""
        return await self._get("/api/bot/queue", private=True)

    async def profile(self, *, name=None, discord_id=None):
        params = {"name": name} if name else {"discord": discord_id}
        return await self._get("/api/bot/profile", private=True, **params)

    async def invite(self, mode="constructed", seat=0):
        return await self._get("/api/bot/invite", private=True, mode=mode, seat=seat)

    async def claim_link(self, code, discord_id, discord_name):
        """Redeem a code the player minted on their own profile page."""
        return await self._post("/api/bot/link/claim", {
            "code": code, "discordId": str(discord_id), "discordName": discord_name,
        })

    async def unlink(self, discord_id):
        return await self._post("/api/bot/unlink", {"discordId": str(discord_id)})

    # ── the league (client/docs/20-league.md) ─────────────────────────
    async def league_outbox(self, limit=50):
        """The league messages waiting to be sent. Each row stays on the
        server until it is acked, so a restart on either side loses none."""
        return await self._get("/api/league/bot/outbox", private=True, limit=limit)

    async def league_ack(self, sent, failed=None):
        """`sent`: row ids delivered. `failed`: {row id: reason}. Idempotent."""
        return await self._post("/api/league/bot/ack", {
            "sent": list(sent), "failed": {str(k): v for k, v in (failed or {}).items()},
        })

    async def league_status(self, discord_id):
        return await self._get("/api/league/bot/status", private=True, discord=str(discord_id))

    async def league_join(self, discord_id):
        return await self._post("/api/league/bot/join", {"discordId": str(discord_id)})

    async def league_leave(self, discord_id):
        return await self._post("/api/league/bot/leave", {"discordId": str(discord_id)})

    async def league_skip(self, discord_id, week, skip=True):
        return await self._post("/api/league/bot/skip", {
            "discordId": str(discord_id), "week": int(week), "skip": bool(skip),
        })

    async def leaderboard(self, mode):
        """The ladder. Unauthenticated: /api/players already applies the
        owner's PUBLIC_AFTER listing rule, and a second copy of that rule is
        exactly what this bot is trying not to have."""
        return await self._get("/api/players", mode=mode)


# One instance, shared. The cogs reach for this rather than building their own,
# so there is one session and one place the config is read.
client = GameServer()


# ── the judge's engine calculator (/api/bot/simulate) ────────────────────────
# The judge bot's `simulate` tool (bot/tools.py) posts a small board-and-script
# to the game server and reads back what the ONLINE CLIENT does. The contract
# is frozen in the header of client/server/simulate.ts; this side only carries
# it. Judge tools design §1 Phase 2 and §3.
#
# ⚠ SYNCHRONOUS, ON PURPOSE, AND NOT ON `client`. Both callers are synchronous:
# core._dispatch runs tools.dispatch in a worker thread (asyncio.to_thread),
# and core.offered_tools asks server_available() inline while it builds the
# request. An aiohttp session belongs to one event loop, and the worker thread
# has none — so this is plain urllib, one short request per call, on loopback.
#
# ⚠ CONFIG IS READ PER CALL, not at import like BASE/TOKEN above: core reads
# ALGO_BOT_TOKEN per call to decide whether simulate is offered at all, and
# the eval harness loads .env after this module may have been imported. Same
# variables, same meaning.
#
# FAILURES. A transport failure (refused, timed out, 404 from the gate, a 5xx,
# a body that is not JSON) raises GameServerDown, like everything else here.
# An answer the server GAVE — {ok:false, error, errors[]} for a bad spec,
# HTTP 400/413 included — is returned as-is: the model wrote the spec and
# needs to read what was wrong with it (the _post rule above).

#: the bot's own wall clock per simulation, on top of the server's 2 s worker limit
SIM_TIMEOUT = float(os.getenv("ALGO_SIM_TIMEOUT", "4"))
#: how long one health answer is trusted (design §3: a cached /api/bot/health)
HEALTH_TTL = 60.0
#: a health probe on loopback answers in milliseconds; this only bounds a hung server
HEALTH_TIMEOUT = 1.5
#: simulations in flight across the whole process (design §4)
SIM_MAX_INFLIGHT = 2

_SIM_SLOTS = threading.BoundedSemaphore(SIM_MAX_INFLIGHT)


def _sim_config(base=None, token=None):
    b = (base or os.getenv("ALGO_GAME_SERVER") or "http://127.0.0.1:5000").rstrip("/")
    t = token if token is not None else os.getenv("ALGO_BOT_TOKEN", "")
    return b, t


def _request(url, *, token, body=None, timeout):
    """(status, parsed JSON or None) for one GET (body None) or POST. Raises
    GameServerDown on anything that is not an HTTP answer."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="GET" if body is None else "POST")
    if token:
        req.add_header("X-Algo-Bot", token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as exc:          # an HTTP answer, just not a 2xx
        status, raw = exc.code, exc.read() or b""
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError) or isinstance(exc, TimeoutError) or "timed out" in str(reason):
            raise GameServerDown(f"timed out after {timeout:g}s")
        raise GameServerDown(str(reason) or exc.__class__.__name__)
    try:
        parsed = json.loads(raw.decode("utf-8")) if raw else None
    except ValueError:
        parsed = None
    return status, parsed


def simulate(spec, *, base=None, token=None, timeout=None):
    """POST `spec` to /api/bot/simulate and return the server's answer (a dict
    with `ok`). Raises GameServerDown when there is no answer to return.
    At most SIM_MAX_INFLIGHT run at once across the process; past that this
    returns a busy answer rather than queueing behind them."""
    b, t = _sim_config(base, token)
    timeout = SIM_TIMEOUT if timeout is None else timeout
    if not t:
        raise GameServerDown("ALGO_BOT_TOKEN is not set here, so the engine is not reachable")
    if not _SIM_SLOTS.acquire(timeout=min(1.0, timeout)):
        return {"ok": False, "busy": True, "error": "busy: other simulations are running; try once more"}
    try:
        status, body = _request(f"{b}/api/bot/simulate", token=t, body=spec, timeout=timeout)
    except GameServerDown:
        _HEALTH.mark(b, t, False)
        raise
    finally:
        _SIM_SLOTS.release()
    if status == 404:
        _HEALTH.mark(b, t, False)
        raise GameServerDown("the game server is not answering privileged requests — "
                             "ALGO_BOT_TOKEN is either unset there or does not match the one here")
    if status in (400, 413) and isinstance(body, dict):
        return body if body.get("ok") is False else {"ok": False, "error": str(body)[:200]}
    if status >= 400:
        raise GameServerDown(f"HTTP {status} from /api/bot/simulate")
    if not isinstance(body, dict) or "ok" not in body:
        raise GameServerDown("/api/bot/simulate did not return a JSON answer")
    _HEALTH.mark(b, t, True, body.get("engine"))
    return body


class _Health:
    """Is the game server up for simulate? One answer per (server, token),
    trusted for HEALTH_TTL. The first ask blocks (≤ HEALTH_TIMEOUT); a STALE
    answer is returned at once while one background thread re-asks, because
    core asks inline on the Discord bot's event loop and a hung server must
    not stall every other command once a minute. A simulate that could not
    reach the server marks it down at once, so the next answer stops offering
    the tool without waiting out the TTL."""

    def __init__(self):
        self._lock = threading.Lock()
        self._state = {}        # (base, token) -> {"ok", "at", "engine"}
        self._refreshing = set()

    def mark(self, base, token, ok, engine=None):
        with self._lock:
            prev = self._state.get((base, token)) or {}
            self._state[(base, token)] = {"ok": bool(ok), "at": time.monotonic(),
                                          "engine": engine or prev.get("engine")}

    def reset(self):
        with self._lock:
            self._state.clear()

    def engine(self, base=None, token=None):
        b, t = _sim_config(base, token)
        return (self._state.get((b, t)) or {}).get("engine")

    def _probe(self, base, token):
        try:
            status, body = _request(f"{base}/api/bot/health", token=token, timeout=HEALTH_TIMEOUT)
            ok = status == 200 and isinstance(body, dict) and body.get("ok") is True
            engine = body.get("engine") if ok else None
        except GameServerDown:
            ok, engine = False, None
        self.mark(base, token, ok, engine)
        return ok

    def _refresh_bg(self, key):
        try:
            self._probe(*key)
        finally:
            with self._lock:
                self._refreshing.discard(key)

    def available(self, base=None, token=None):
        b, t = _sim_config(base, token)
        if not t:
            return False
        key = (b, t)
        with self._lock:
            st = self._state.get(key)
            if st is not None and time.monotonic() - st["at"] < HEALTH_TTL:
                return st["ok"]
            if st is not None:
                if key not in self._refreshing:
                    self._refreshing.add(key)
                    threading.Thread(target=self._refresh_bg, args=(key,), daemon=True).start()
                return st["ok"]
        return self._probe(b, t)


_HEALTH = _Health()


def server_available(base=None, token=None):
    """True when simulate may be offered: a token is set and the game server's
    /api/bot/health said ok within the last HEALTH_TTL seconds."""
    return _HEALTH.available(base, token)


def simulate_engine(base=None, token=None):
    """The engine build the server last reported (health or a simulation), or None."""
    return _HEALTH.engine(base, token)
