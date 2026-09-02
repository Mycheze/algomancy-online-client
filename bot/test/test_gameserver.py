#!/usr/bin/env python3
"""
test_gameserver.py — the bot's client for the game server, and the contract it
assumes. Run: `.venv/bin/python bot/test/test_gameserver.py`. No real server.

§1 the happy path parses
§2 ⭐ EVERY FAILURE IS ONE EXCEPTION WITH A SENTENCE IN IT — a refused
   connection, a timeout, a 500, a non-JSON body and an {"ok": false} body all
   arrive as GameServerDown, because a caller that has to tell five failure
   shapes apart is a caller that will get four of them wrong
§3 the token goes on the header and NEVER in the query string, and is absent
   from the unauthenticated route
§4 ⭐ THE `/search` FALLBACK REFUSES TO GUESS. When the server is down, a plain
   description falls back to the local BM25 search — but a QUERY does not,
   because running `-el:fire mana<=3` through a text search returns confident
   nonsense, which is worse than an outage since nobody can tell
§5 ⭐ THE CONTRACT IS REAL — the routes this file calls are asserted to exist
   in the TypeScript on the other side of the repo. A mock proves the client
   parses what it was told to expect; only this proves it was told the truth.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
import _scratch_var  # noqa: F401,E402

import asyncio  # noqa: E402
import json  # noqa: E402

from aiohttp import web  # noqa: E402

import gameserver  # noqa: E402

PASS = 0
FAILED = 0


def check(name, cond):
    global PASS, FAILED
    if cond:
        PASS += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}")


SEEN = []          # every request the fake server received


async def make_server():
    """A stand-in for :5000 that records what it was asked."""
    async def cardsearch(req):
        SEEN.append(("cardsearch", dict(req.query), dict(req.headers)))
        return web.json_response({
            "ok": True, "query": req.query.get("q", ""), "total": 55, "returned": 2,
            "implicitCards": True, "errors": [],
            "cards": [{"name": "Ignis Sprite", "type": "Sprite Unit", "cost": "rr",
                       "mana": 2, "pow": 1, "tou": 1, "supertype": "Unit",
                       "image": "Ignis-Sprite.jpg", "art": "/data/cards/Ignis-Sprite.jpg"}],
        })

    async def queue(req):
        SEEN.append(("queue", dict(req.query), dict(req.headers)))
        return web.json_response({"ok": True, "counts": {"total": 0}})

    async def health(req):
        SEEN.append(("health", dict(req.query), dict(req.headers)))
        if req.headers.get("X-Algo-Bot") != "s3cret":
            return web.Response(status=404, text="not found")
        return web.json_response({"ok": True, "bootId": "abc", "rooms": 0})

    async def boom(req):
        return web.Response(status=500, text="kaboom")

    async def notjson(req):
        return web.Response(status=200, text="<html>nope</html>")

    async def refused(req):
        return web.json_response({"ok": False, "error": "no player called \"Nobody\""})

    app = web.Application()
    app.router.add_get("/api/cardsearch", cardsearch)
    app.router.add_get("/api/queue", queue)
    app.router.add_get("/api/bot/health", health)
    app.router.add_get("/api/bot/boom", boom)
    app.router.add_get("/api/bot/notjson", notjson)
    app.router.add_get("/api/bot/profile", refused)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = runner.addresses[0][1]
    return runner, port


async def main():
    runner, port = await make_server()
    base = f"http://127.0.0.1:{port}"
    gs = gameserver.GameServer(base=base, token="s3cret", timeout=3)
    try:
        print("\n[§1 the happy path]")
        r = await gs.cardsearch("el:fire mana<=3", limit=2)
        check("a search comes back parsed", r["total"] == 55 and r["returned"] == 2)
        check("…with the cards in it", r["cards"][0]["name"] == "Ignis Sprite")
        check("…and the art URL the server composed",
              r["cards"][0]["art"] == "/data/cards/Ignis-Sprite.jpg")
        q = dict(SEEN[-1][1])
        check(f"the query is sent as typed (got {q.get('q')!r})",
              q.get("q") == "el:fire mana<=3")
        check("implicit defaults to on", q.get("implicit") == "1")
        check("…and can be turned off",
              (await gs.cardsearch("x", implicit=False)) is not None
              and dict(SEEN[-1][1]).get("implicit") == "0")
        check("health parses", (await gs.health())["ok"] is True)

        print("\n[§2 ⭐ every failure is one exception with a sentence]")
        for label, call in (
            ("a 500", gs._get("/api/bot/boom", private=True)),
            ("a non-JSON body", gs._get("/api/bot/notjson", private=True)),
            ("an ok:false body", gs.profile(name="Nobody")),
        ):
            try:
                await call
                check(f"{label} raises", False)
            except gameserver.GameServerDown as exc:
                check(f"{label} raises GameServerDown", True)
                check(f"   …carrying a readable message ({str(exc)[:40]!r})",
                      bool(str(exc).strip()))
            except Exception as exc:
                check(f"{label} raises GameServerDown, not {type(exc).__name__}", False)

        # a closed port, and a wrong token
        dead = gameserver.GameServer(base="http://127.0.0.1:1", token="s3cret", timeout=1)
        try:
            await dead.health()
            check("a refused connection raises", False)
        except gameserver.GameServerDown:
            check("a refused connection raises GameServerDown", True)
        finally:
            await dead.close()

        wrong = gameserver.GameServer(base=base, token="wrong", timeout=3)
        try:
            await wrong.health()
            check("a wrong token raises", False)
        except gameserver.GameServerDown as exc:
            check("a wrong token raises GameServerDown", True)
            # ⚠ The server 404s identically for "no token configured" and
            # "wrong token" — on purpose — so the message must not claim to
            # know which, or it sends the reader to the wrong file.
            check("⭐ …and does NOT claim to know which of the two it was",
                  "either" in str(exc) or "does not match" in str(exc))
        finally:
            await wrong.close()

        print("\n[§3 where the token goes]")
        await gs.health()
        _, params, headers = SEEN[-1]
        check("the token is on the X-Algo-Bot header", headers.get("X-Algo-Bot") == "s3cret")
        check("⭐ …and NOT in the query string — the server refuses that, and a "
              "token in a URL is a token in every access log",
              "token" not in params)
        await gs.queue_counts()
        _, _, qheaders = SEEN[-1]
        check("the PUBLIC queue route is called with no token at all",
              "X-Algo-Bot" not in qheaders)

        print("\n[§4 ⭐ the fallback refuses to guess]")
        from cogs.cardlookup import _LOOKS_LIKE_QUERY
        for looks_like_a_filter in ("el:fire", "mana<=3", "-t:sprite", "pow>2",
                                    "o:\"when I die\"", "el:fire mana<=3"):
            check(f"{looks_like_a_filter!r} is recognised as a query",
                  bool(_LOOKS_LIKE_QUERY.search(looks_like_a_filter)))
        for plain_english in ("wood unit that draws a card when it dies",
                              "counter a spell", "the one with the big crab",
                              "2/1 fire unit with haste"):
            check(f"{plain_english!r} is NOT mistaken for a query",
                  not _LOOKS_LIKE_QUERY.search(plain_english))

        print("\n[§5 ⭐ the routes really exist on the other side]")
        # A mock proves the client parses what it was told to expect. Only
        # reading the TypeScript proves it was told the truth — this is the
        # same trick test_oracle.py uses across the same repo boundary.
        root = _Path(__file__).resolve().parent.parent.parent
        ts = "\n".join((root / "client" / "server" / f).read_text()
                       for f in ("main.ts", "api-bot.ts", "api-cardsearch.ts"))
        for route in ("/api/cardsearch", "/api/queue", "/api/bot/health",
                      "/api/bot/queue", "/api/bot/profile", "/api/bot/invite"):
            check(f"{route} appears in client/server/", f"'{route}'" in ts or
                  f'"{route}"' in ts)
        check("⭐ …and the server reads the SAME header name this client sends",
              "x-algo-bot" in ts.lower())
    finally:
        await gs.close()
        await runner.cleanup()


asyncio.run(main())
print(f"\n{PASS} checks passed" + (f", {FAILED} FAILED ❌" if FAILED else " ✅"))
raise SystemExit(1 if FAILED else 0)
