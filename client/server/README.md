# `server/` — the game server

A thin, server-authoritative Node layer over the pure engine, so two people
in different places can play an enforced game in their browsers. One port,
plain HTTP and WebSocket, a TLS terminator in front on any box that is not a
LAN. The server holds the authoritative `GameState` and action log per room
and only ever sends each seat a **redacted** view.

It also holds everything a public deploy needs around a game: accounts and
stats, saved decks, a matchmaking queue with ratings, the post-game screen,
the chess clock, spectators, the bug-report button, the admin dashboard, and
the HTTP the Discord bot reads.

## Run it

From the repo root, the way you will actually run it:

```bash
npm --prefix client run dev      # builds the UI bundle, serves http://localhost:5177
```

That binds loopback, keeps every saved game, account and report under
`var/dev/`, and runs with the Discord integration absent. By hand:

```bash
npm install                      # one dependency: ws
node main.ts                     # http://localhost:8080; PORT= and HOST= to change
```

`main.ts` serves the browser client statically from `../ui` and the card art
from `../../data`. Rebuild the bundle (`npm --prefix ../ui run build`) after a
UI change; a running server picks it up on the next page load.

A room comes into being one way: the home screen asks `GET /api/new` for a
code, which **reserves** it, and the first join to a reserved code creates the
room. Everyone else joins the code, from the home screen or a link
(`/?ws=1&room=CODE&seat=0`). A code that names no room is an error, not a new
empty game. A reservation lives in memory, so a restart between pressing the
button and landing in the room means pressing it again.

## Deployed

On the VPS behind Caddy at <https://algomancy.online>, as
`deploy/algomancy-game.service`: `PORT=5000`, `HOST=127.0.0.1`, reachable only
through the proxy. [`../../deploy/README.md`](../../deploy/README.md) is the
recipe. Behind the proxy every socket's peer is the proxy, so everything keyed
on an address (the login throttle, the signup brake, the report and judge
limits) reads `X-Forwarded-For` through `api-util.ts`, and only from a
loopback peer. A seat taken while signed in is bound to that account;
anyone else asking for it is refused.

## How it works

- **The loop.** A client sends its intended `Action`. The server checks the
  seat matches the connection, applies it through `../engine/src/apply.ts`,
  then pushes to both seats a per-seat redacted view, the new redacted events,
  and that seat's `legalActions`, computed here so the client never needs
  hidden information to highlight a play. An illegal action goes back to the
  actor alone.
- **Redaction** (`view.ts`, `viewFor(state, seat)`). The opponent's hand
  becomes a count; the shared deck becomes a count, and the seed and RNG state
  are dropped because deck order derives from them; the opponent's face-down
  resources hide their element; a pending decision goes only to the seat that
  must answer it. Event text is blurred where it would leak: a recycle names
  the card to its owner and reads "recycles a card" to the opponent. The same
  module runs inside the browser for the tutorial bot.
- **Hidden simultaneous segments** (`rooms.ts`, `segmentKey`). The resource
  step, the haste step and deployment are each played behind a screen. Inside
  one, each seat's view of the opponent is a snapshot from when the segment
  opened, and the opponent's events are held back; when the key changes the
  old segment's reveal is flushed and the new one snapshotted. Undo inside a
  segment walks back to *your* most recent action and splices it, so an
  opponent acting cannot take your undo away. The splice is refused when an
  action that moved the id clock or the RNG has an opponent's action after it,
  because the tolerant replay would silently renumber theirs. The resource
  step's actions provably commute, so the gate never fires there.
- **Reconnect.** Rejoining the same room and seat gets the full redacted view
  and log again.
- **Persistence.** Each room is written to `var/games/<CODE>.json` after every
  action: seed, names, accounts, the action log, decks, engine versions,
  custom rules, the stamped result. On startup `restoreRooms()` replays every
  file; one an engine change made invalid is skipped with a warning.
  `replay-room.ts games/CODE.json` replays a file through the current engine
  and says whether it still describes the game (faithful, drift, forked,
  unreplayable); `--as-recorded` diffs it against the engine that recorded it.

## The draft lobby

A live draft starts as a lobby and no cards exist until it resolves. Both
players choose how the three elements are picked, both submit blind, and the
game is dealt to both at the same instant. Three methods (`trio.ts`): **one
each, one at random**; **something new**, the trio the two of you have played
least recently, read off the account history; **rank all seven**, a Borda
count of both ballots and a weighted draw. A rematch adds **run it back**.
Every draw runs off the room seed, and the result comes with its working, in
the game log. A room created with an explicit trio (`&els=fire,water,earth`)
has no lobby and deals immediately.

## Custom rules

A live draft can be created with custom rules: pack size, element count,
opening hand, draws per turn, starting life, Simple cards only, banned cards,
a card filter (R292). The client previews them with `../ui/customrules.ts`;
`POST /api/new {rules}` runs the same check here, resolves them once into a
`DraftDeal` and refuses a pool below the floor with a sentence. The
reservation keeps the resolved deal, every re-deal and restore passes it, and
nothing re-resolves the rules. A custom game is kept in the history and
skipped by every rating and record fold.

## The post-game screen and rematch

A decided game ends with who won, both players' numbers side by side from the
same `summarizeGame()` that feeds the profile, whatever it unlocked, and three
ways out: rematch, home, the queue. `{ t: 'rematch', want }`: when both agree
the server builds the new room and sends both its code. The rematch keeps the
format, the players and their seats, and takes a new seed.

## Accounts, stats and achievements

A username and a password, nothing else: no email, no reset. Passwords are
scrypt-hashed with a per-user salt; the session token rides on the WebSocket
join, which binds a seat to an account. Playing signed out records nothing.

**A game counts as soon as it is played, finished or not**, and everything
downstream is a pure fold over the saved games themselves:

```
var/games/<CODE>.json → summarizeGame() → history[] → rebuildProfiles() → achievements, ratings
```

Profiles are recomputed, never incremented, so changing how a stat is counted
means `node seed-accounts.ts --force`, not editing anybody's numbers. A game's
result is stamped when it is decided and read back, never re-derived by
replay, because an old log replayed by a newer engine can describe a
different game. Registering with a name you already played under claims those
games.

`POST /api/auth/register` · `login` · `logout` · `password` ·
`GET /api/me` · `/api/player?name=` · `/api/players[?mode=]` (the ladder) ·
`/api/achievements` · `POST /api/friends/request` · `accept` · `remove`.

## Matchmaking and ratings

`queue.ts`, `rating.ts`, `createMatch` in `rooms.ts`. A signed-in player picks
a format and **ranked** or **open**, and the server puts two of them in a
room. One pool per format: two entries pair when every constraint either
imposes is met, and an open entry imposes none. A ranked band widens with the
wait (±100 to anyone at three minutes), is checked against **both** players'
bands, and the current width is sent to the client rather than recomputed
there. A pair is held ten seconds for both to accept; a let-down player goes
back with their original wait. Leaving falls out of the socket closing.

Elo, per format, from 1000, K 40 while provisional and 20 after the fifth
rated game, which is also when a player appears on the public ladder. Only
games the matchmaker made are rated; a room made from a code cannot become
one. The fold is a second pass over the whole history in a total order
(`playedAt`, then `code`), so re-running it reproduces the same numbers
exactly. A matchmade room's clock is the format default, never either
player's picker.

## Decks

The signed-out path: `GET /api/deck/defaults` (five bundled decks, built by
aramsunat on algomancer.cc) and `POST /api/deck/import {url | text}`, which
turn a link or a pasted list into card names the browser keeps in
`localStorage`.

A signed-in player has a **collection** (`collection.ts`, `api-decks.ts`):
`GET /api/decks`, `POST /api/decks/create` · `update` · `delete` ·
`duplicate` · `import` · `take`. Three commitments: a deck's record is a fold
over the game history by deck id, never a stored count; a saved deck may be
illegal (29 cards is a deck mid-edit) and is refused only when brought to a
game; the starter five are seeded once and never re-seeded. The deck id
reaches the record over the wire, and the server re-reads the deck out of the
account behind the token, so an id you do not own is ignored.

A deck carries a `visibility`, private by default. `publicdecks.ts` serves
the unauthed reads: `GET /api/deck/shared?id=` (a private deck and a
nonexistent one give the same answer), `GET /api/deck/meta?sort=` (the public
decks ranked, with a games floor under which a deck is listed but not ranked)
and `GET /api/deck/played`. Records fold by lineage, so a copied list
accumulates its copies' games. The file format the client exports is
[`../docs/deck-format.md`](../docs/deck-format.md).

## The wire

One WebSocket. Client → server:

- `{ t: 'join', room, seat?, name?, token?, mode?, els?, deck?, deckId? }`;
  `mode` and `els` apply only when the join creates the room; a valid token
  binds the seat to the account and overrides `name`
- `{ t: 'action', action }`
- `{ t: 'lobby', method | submission, lock }` while a draft lobby is open
- `{ t: 'queue', token, q: 'join' | 'leave' | 'accept' | 'decline', mode?, ranked?, deckId? }`,
  the one message a socket may send while in no room
- `{ t: 'rematch', want }`

Server → client:

- `{ t: 'joined', room, seat, view, log, legal, peers, names }`; while a
  constructed room waits for decks, `waiting` replaces the view
- `{ t: 'update', view, events?, legal, peers }` after any action; with
  `step` and `reveal` when a hidden segment just closed
- `{ t: 'error', msg }` to the actor only
- `{ t: 'gameover', … }`, `{ t: 'rematch', … }`, `{ t: 'me', me }`,
  `{ t: 'recorded', me, unlocked }`, `{ t: 'queue', counts | matched }`

`hooks.ts` pushes queue events to the Discord bot when `ALGO_BOT_PUSH_URL` and
`ALGO_BOT_TOKEN` are set; `api-bot.ts` serves `/api/bot/*` and
`api-cardsearch.ts` serves `/api/cardsearch` to it, token-gated. Unset, none
of those routes exist. `main.ts` proxies `/api/cardinfo` and `/api/judge` to
the rules bot's web app on :8000 for the in-game inspector and judge box.

## Where the state is

`statepaths.ts` names every file this server writes, each a getter that reads
its environment variable on every call so a test can point it at a scratch
directory after import: `var/games/`, `var/accounts/accounts.json`,
`var/issues.jsonl` (bug reports, stamped with room and action index),
`var/verdicts.jsonl` (the scenario tester's verdicts), `var/report-marks.jsonl`
(admin triage). None of it is committed and none of it can be rebuilt.

## Files

| | |
|---|---|
| `main.ts` | the HTTP server, the static host, the WebSocket loop, the proxies |
| `rooms.ts` · `view.ts` · `trio.ts` | rooms and persistence · redaction · the lobby methods |
| `replay-room.ts` · `replay-probe.ts` · `engine-version.ts` | replaying a saved file, and stamping which engine recorded it |
| `accounts.ts` · `stats.ts` · `history.ts` · `achievements.ts` · `api-accounts.ts` | the store, the fold, the badges, the routes |
| `queue.ts` · `rating.ts` · `concession.ts` · `cardladder.ts` | matchmaking, Elo, what counts as a concession, the single-card ladder |
| `decks.ts` · `collection.ts` · `publicdecks.ts` · `api-decks.ts` · `default-decks.json` | decks, signed out and in |
| `scenarios*.ts` | the scenario tester's library, one file per batch |
| `admin.ts` · `api-admin.ts` · `api-bot.ts` · `api-cardsearch.ts` · `api-link.ts` · `link.ts` · `hooks.ts` | the dashboard, the bot's routes, Discord account linking |
| `art-versions.ts` | a content hash per scan, so a replaced image is not stale in every browser for a year |
| `seed-accounts.ts` | CLI: import or re-summarize `var/games/` into the record |
| `statepaths.ts` · `api-util.ts` · `report-fields.ts` · `types.ts` | the paths, the four lines every route needs, the report shape |
| `test/` | node:test files, in-process, importing this package's modules |
| `e2e/` | scripts that spawn the **real server** and drive it over real sockets; `e2e/suite.test.ts` runs them |
| `tester.env.example` | the environment the deployed unit reads (`ALGO_BOT_TOKEN` and friends) |

## Test it

```bash
npm run check     # typecheck, then both suites
npm test          # test/ in-process, then e2e/ through the runner; ~2.5 minutes
node e2e/test-clock.ts   # any one script still runs on its own
```

`e2e/suite.test.ts` is a `node:test` file with one case per script, each
spawning the script against a throwaway `ALGO_GAMES_DIR`, `ALGO_ACCOUNTS_FILE`,
`ALGO_ISSUES_FILE` and `ALGO_VERDICTS_FILE`, and with the bot token and push
URL emptied so a fabricated match can never reach the live Discord bot. It is
safe to run on the deploy box. Its last two cases are a ledger: every
test-shaped file under `e2e/` is either run or listed as not-a-test with a
reason, and `package.json` still points `npm test` at the runner. Scripts run
one at a time; the port race that used to flake the suite was between
processes outside it, and `spawnServer()` in `e2e/test-util.ts` takes an
OS-assigned port for that reason.
