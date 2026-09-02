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
run-server.sh sources INSIDE its respawn loop. A mismatch is not an error — the
server's gate answers 404 to everything, which looks exactly like the feature
not existing.
"""

import os

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


# One instance, shared. The cogs reach for this rather than building their own,
# so there is one session and one place the config is read.
client = GameServer()
