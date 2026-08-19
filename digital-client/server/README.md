# Algomancy server — M2 remote-play slice

A thin, server-authoritative Node layer over the pure engine so two people in
different cities can play an enforced 1v1 game in their browsers. Personal
scope: exactly two players, join-by-room-code, **no accounts, no lobbies, no
TLS**. The server holds the authoritative `GameState` + action log per room and
only ever sends each client a **redacted** view.

## Run it

```bash
cd digital-client/server
npm install        # one dependency: ws
node main.ts       # HTTP + WebSocket on http://localhost:8080
PORT=9000 node main.ts   # custom port
```

`node main.ts` also serves the browser client statically (the esbuild bundle
from `../engine/ui`) and the card art. If you changed the UI, rebuild the
bundle first:

```bash
cd ../engine && npm run build:ui
```

Open **http://localhost:8080** — the join screen appears when you pass `?ws=1`.
Direct links skip it:

- Seat 0: `http://localhost:8080/?ws=1&room=KITCHEN&seat=0`
- Seat 1: `http://localhost:8080/?ws=1&room=KITCHEN&seat=1`

Same `room` code = same game. `seat` is optional (omit it to take the first
free seat). Opening the plain URL with no `?ws=`/`?room=` is the old **hotseat**
client (both hands visible) — still works, unchanged.

## Deployed (2026-08-18, home LAN)

Live on the home server (`benshomeserver.local`, 192.168.0.5 — the router
re-addressed the LAN from 192.168.100.x at some point) at
**http://192.168.0.5:5000**. Port matters: the box's firewall silently drops
8080 (no sudo access to open it), but **5000 is allowed**, hence `PORT=5000`.
Started with:

```bash
cd ~/Documents/Algomancy/digital-client/server
PORT=5000 setsid nohup ~/node-v22/bin/node main.ts > gameserver.log 2>&1 < /dev/null &
```

Survives SSH logout, **not** a reboot — restart by hand (or add a systemd user
unit later). Deploy = `git pull`, `npm install` + `npm run build:ui` in
`engine/` if the UI changed, `npm install` in `server/` if deps changed, then
kill the 5000 listener (find its PID via `ss -tlnp | grep 5000`) and rerun the
line above. Verified 2026-08-18: two WebSocket clients from a laptop played 80
actions into turn 5 with zero redaction leaks (`test-drive.ts` also ALL PASS on
the box itself).

## Play together remotely

Runs fine on the home server box (see above):

```bash
git pull
cd digital-client/server && PORT=5000 ~/node-v22/bin/node main.ts
```

Then give the remote player a route to port 5000. Easiest options, no TLS
needed:

- **Tailscale** (recommended): install on the server and on the other player's
  machine; they open `http://<tailscale-ip-or-name>:8080/?ws=1&room=CODE&seat=1`.
- **Port-forward**: forward TCP 8080 on the home router to 192.168.100.5 and
  share `http://<your-public-ip>:8080/?ws=1&room=CODE&seat=1`.

Both of you pick the same room code and different seats. Refreshing the page
rejoins the same room/seat and resyncs — see Reconnect below.

## How it works

- **Server-authoritative loop**: a client sends its intended `Action` over the
  WebSocket; the server checks `action.seat` matches the connection's seat,
  applies it through `engine/src/apply.ts`, then pushes to **both** clients a
  per-seat redacted view + the new (redacted) events + that seat's
  `legalActions` (computed server-side, so the client never needs hidden info to
  highlight plays). Illegal actions are caught and the message is sent back only
  to the actor (the UI shows it inline).
- **Redaction** (`view.ts`, `viewFor(state, seat)`): the opponent's hand → count
  only (card backs); the shared deck → count only (never contents/order, and the
  seed/rngState are dropped since deck order is derivable from the seed); the
  opponent's **dormant** resources → element hidden (they are face-down —
  their element is hidden information); a pending decision (and its options) is
  sent only to the seat that must answer it. Everything else is public: bins,
  life, in-play units/tokens/mods, formations, the stack, phase/turn.
- **Event redaction**: `EngineEvent.msg` strings are blurred where they would
  leak hidden info — a recycle names the recycled card (which goes to the hidden
  bottom of the deck) to its owner but reads "recycles a card" to the opponent.
- **Reconnect**: refreshing and rejoining the same room+seat gets a full
  redacted view + the full redacted game log resync (simple full-state push on
  join).
- **Persistence**: each room's `{ seed, names, actions[] }` is written to
  `games/<CODE>.json` after every action. On startup the server restores rooms
  by replaying their action logs (`restoreRooms()`), so a server restart does
  not lose games in progress. A log that an engine change made invalid is
  skipped with a warning rather than crashing startup.

## Files

| path | what |
|---|---|
| `main.ts` | HTTP static host + WebSocket game loop (join / action / broadcast) |
| `view.ts` | `viewFor(state, seat)` redaction + per-seat event/log blurring |
| `rooms.ts` | in-memory room store, apply-to-room, JSON persistence + replay restore |
| `test-drive.ts` | integration test: boots the server, two clients, asserts redaction + reconnect |
| `games/` | one JSON file per room (`{ seed, names, actions }`) |

## Test it

```bash
node test-drive.ts
```

Boots the server on an ephemeral port, connects two clients, and asserts:
redaction holds on **every** view pushed the whole session (seat 0 never sees
the opponent's hand contents, the deck order, the opponent's dormant resource
elements, or the seed); a recycle is blurred for the opponent; a wrong-seat
action is rejected; and a drop+rejoin resyncs a full redacted view. Expected
tail: `ALL PASS ✓`.

## Message protocol (JSON over one WebSocket)

Client → server:
- `{ t: 'join', room: CODE, seat?: 0|1, name?, mode?, els?, deck? }` — `mode`
  (`shared`/`draft`/`constructed`) + `els` only apply when the join creates the
  room; `deck` (an array of card names, algomancer.cc-importable — see
  `decks.ts`) registers this seat's constructed deck
- `{ t: 'action', action: Action }`

Server → client:
- `{ t: 'joined', room, seat, view, log, legal, peers, names }` — while a
  constructed room still waits for decks, `view/log/legal` are replaced by
  `waiting: { have: [bool, bool] }`; a fresh full `joined` goes to both seats
  the moment the second deck arrives and the game is dealt
- `{ t: 'update', view, events?, legal, peers }` — after any action, to both seats
- `{ t: 'error', msg }` — illegal action / join error, to the actor only

## Deck endpoints (constructed)

- `GET /api/deck/defaults` — the bundled test decks (`default-decks.json`,
  built by **aramsunat** on algomancer.cc), already mapped to engine card names
- `POST /api/deck/import` with `{ url }` (an algomancer.cc deck link — fetched
  through their `/api/decks/<id>` JSON) or `{ text }` (a pasted list, one card
  per line with optional leading count) → `{ ok, deck: { name, author, url?,
  cards, problems } }`
