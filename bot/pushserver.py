"""
pushserver.py — the loopback listener the game server pushes queue events to.

An aiohttp.web app on the BOT's own event loop. No new dependency: aiohttp
already ships with discord.py.

⚠ LOOPBACK ONLY. It binds 127.0.0.1 by default, so the firewall never enters
into it — the deploy box opens 22/80/443/5000/8000, and this is unreachable
from outside by construction rather than by policy. Both services are on the
same machine, so this is a local socket.

⚠ AND IT IS NOT STARTED AT ALL WITHOUT A SECRET. No ALGO_BOT_TOKEN means no
listener, which is the same posture the game server's own gate takes: a deploy
that has not opted in does not have the feature, rather than having it
unprotected. A wrong secret gets a 404, not a 403 — the two ends agree about
that, and for the same reason.

⚠ THE HANDLER MUST NOT WAIT FOR DISCORD. The game server calls this from
inside its own queue-join path. It validates, schedules the fan-out, and
returns; a slow Discord API call must never be able to hold that request open.
The reply says how many channels it went to, which is worth having: a steady
`announced: 0` in the game server's log is how you find out that nobody ever
ran /queuewatch.

An unknown event type answers 200 and is ignored, so a newer game server can
send something this bot has not learned about without getting a 400 back.
"""

import asyncio
import hmac
import os

from aiohttp import web

LISTEN = os.getenv("ALGO_BOT_LISTEN", "127.0.0.1:8765")
TOKEN = os.getenv("ALGO_BOT_TOKEN", "")


def _authorised(request) -> bool:
    given = request.headers.get("X-Algo-Bot", "")
    return bool(TOKEN) and hmac.compare_digest(given, TOKEN)


def build_app(on_event, *, token=None):
    """The aiohttp app. `on_event(envelope)` is awaited once per event, in the
    background — never inside the request."""
    secret = TOKEN if token is None else token

    async def push(request):
        given = request.headers.get("X-Algo-Bot", "")
        if not (secret and hmac.compare_digest(given, secret)):
            # 404, not 403: see the header.
            return web.Response(status=404, text="not found")
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "not JSON"}, status=400)
        events = body.get("events") or []
        if not isinstance(events, list):
            return web.json_response({"ok": False, "error": "events must be a list"},
                                     status=400)
        # ⚠ Scheduled, not awaited. See the header.
        announced = 0
        for envelope in events:
            if not isinstance(envelope, dict):
                continue
            announced += 1
            asyncio.create_task(_safely(on_event, envelope))
        return web.json_response({"ok": True, "accepted": announced})

    async def healthz(request):
        return web.json_response({"ok": True})

    app = web.Application()
    app.router.add_post("/push/queue", push)
    app.router.add_get("/healthz", healthz)
    return app


async def _safely(fn, envelope):
    """A handler that raises must not take the bot down with it, and must not
    become an unhandled task exception nobody ever reads."""
    try:
        await fn(envelope)
    except Exception as exc:
        print(f"[push] handler failed on {envelope.get('event', {}).get('t')}: {exc}")


async def start(on_event):
    """Start the listener, or explain why not. Returns the runner, or None."""
    if not TOKEN:
        print("[push] no ALGO_BOT_TOKEN — queue notifications are off")
        return None
    host, _, port = LISTEN.rpartition(":")
    runner = web.AppRunner(build_app(on_event))
    await runner.setup()
    site = web.TCPSite(runner, host or "127.0.0.1", int(port))
    await site.start()
    print(f"[push] listening on {host or '127.0.0.1'}:{port} for queue events")
    return runner
