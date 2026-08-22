# Algomancy server — M2 remote-play slice

A thin, server-authoritative Node layer over the pure engine so two people in
different cities can play an enforced 1v1 game in their browsers. Personal
scope: a handful of players, join-by-room-code, no lobbies, **no TLS**. The
server holds the authoritative `GameState` + action log per room and only ever
sends each client a **redacted** view.

Since 2026-08-21 there are also **accounts** — a username and a password, a
lifetime stat sheet, achievements and a friends list. They are optional: play
signed out and nothing is recorded.

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

Open **http://localhost:8080** and press **New live draft** or **New
constructed game**. That is the only way a room comes into being: the button
asks `/api/new` for a code, which RESERVES it, and the first join to a reserved
code creates the room.

A new live draft opens a **lobby** rather than a game — see below.

Everyone else **joins** an existing code — the box on the home screen, or a
direct link:

- Seat 0: `http://localhost:8080/?ws=1&room=CODE&seat=0`
- Seat 1: `http://localhost:8080/?ws=1&room=CODE&seat=1`

Same `room` code = same game. `seat` is optional (omit it to take the first
free seat).

A code that names no room is an **error** — "No game with code XXXX" — not a
new empty game. It used to be get-or-create, and a mistyped code dropped you
alone into a room you thought was your opponent's (playtest: it happened twice
in one session, and both misses were still sitting in `games/` afterwards).
One consequence worth knowing: a reservation lives in memory, so if the server
restarts between pressing New game and landing in it, the code is dead and you
press the button again.

Opening the plain URL with no `?ws=`/`?room=` is the old **hotseat** client
(both hands visible) — still works, unchanged.

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

One of you presses New game and sends the other the code (or their seat link);
you take different seats. Refreshing the page rejoins the same room/seat and
resyncs — see Reconnect below.

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
- **Hidden simultaneous segments** (`rooms.ts` `segmentKey`): the resource
  step, the haste step and deployment are each played behind a screen — see
  below.
- **Reconnect**: refreshing and rejoining the same room+seat gets a full
  redacted view + the full redacted game log resync (simple full-state push on
  join).
- **Persistence**: each room's `{ seed, names, actions[] }` is written to
  `games/<CODE>.json` after every action. On startup the server restores rooms
  by replaying their action logs (`restoreRooms()`), so a server restart does
  not lose games in progress. A log that an engine change made invalid is
  skipped with a warning rather than crashing startup.

## Hidden simultaneous segments

Deployment used to be the only step played behind a screen. Playtest UZRG
(2026-08-21):

> "Planning should be like deployment, entirely divorced from what your
> opponent is doing. But right now, you can't take back making the wrong
> resource or recycling the wrong card if your opponent does something (which
> shouldn't matter) and you can see what your opponent is doing live, so
> there's technically a reason to wait to see what they do (which there
> shouldn't be)."

So a turn now has **three** hidden segments, not one, and one piece of code
knows which is which — `segmentKey(state)` in `rooms.ts`:

| key | the step | ends when |
|---|---|---|
| `plan` | the resource step: recycle / activate / exchange, plus the draft and draw-phase gates | both have hit **done planning** |
| `haste` | the haste step (R18) | both have hit **done haste** |
| `deploy` | simultaneous deployment | both have hit **done deploying** |

Inside a segment each seat's view of the OPPONENT is served from a snapshot
taken when the segment opened (`view.ts`, the `frozenOpp` argument), and every
event an action produces is held back from the other seat. Everything else is
one rule: **the key changed → flush the old segment's reveal, snapshot the new
one.** No phase is special-cased anywhere else. (`deploy` → `plan` is a close
and an immediate re-open on the *same* action, because doneDeploying runs
endTurn and startTurn; the rule handles it without knowing that.)

What stays live and public inside a segment: every done-flag (`planningDone`,
`hasteDone`, `draftDone`, `bottomDone`, `deployDone`) — "they have finished" is
exactly what you can see across a table — the phase and turn, your own
everything, and each player's NAME (which `renameSeat` writes outside the
action log, so the live one is carried over the frozen slot). What is
additionally covered up: the deck count, which a recycle would otherwise turn
into a live readout of how many resources your opponent has just made.

**Why the resource step is safe to hide.** The only legal actions there are
`recycleForResource`, `activateResource`, `exchangePrismite`, `donePlanning`
and the `draftCommit` / `bottomCards` gates. None reaches the stack, none
fires a trigger, none draws from the RNG, none allocates an entity id, and
every index is into the actor's own hand or resources — so the two seats'
actions **commute**, which `test-hidden.ts` asserts directly (same seed, two
interleavings, one state). The haste step can put things on the stack but only
non-interactively (`castChain(…, 'resolve')` — immediate resolution, no
priority, no responses), so it has deployment's hazards and no more.

### Undo inside a segment

Your last action is very often not the last one overall, so undo walks back to
**your** most recent action inside the segment and splices that — your
opponent acting can no longer take your undo away, which was the report. The
window closes at each barrier, which is right: once both have pressed done,
the decisions lock.

The action log stays **arrival order** — it IS the record, and
`replay(seed, actions)` must still reproduce it bit-identically. What needs a
rule is the *splice*, because removing seat A's action re-runs seat B's from a
different prior state. If A's action moved the entity-id clock or the RNG
stream, everything after it renumbers: A deploys unit 7, B deploys 8 and
augments `hostId: 8`; A undoes, B's unit becomes 7, and B's augment is now an
IllegalAction that the tolerant replay **silently skips** — B loses a play
nobody told them about. (That bug was in deployment all along.)

So: an action may leave a segment iff it is id- and RNG-inert, or nothing an
opponent did after it could be renumbered. `Room.segTouched[i]` (derived, never
persisted) records the first half; the exception to the second is a bare
barrier flag — `donePlanning` / `doneHaste` / `doneDeploying` / `passPriority`
/ `concede` carry no id, index or choice at all, so one of those landing on top
of your play is not a reason to refuse. Anything else is refused with a
message, rather than silently reordering somebody else's game. Because the
resource step is provably inert, the gate never fires there at all.

### Known leaks inside a segment (pre-existing, deliberately not fixed yet)

Both of these predate the hidden-segment work — they have always been true of
deployment — and both are on the record rather than rediscovered later:

- **`legalActions` is computed from live state.** A targeted play's legality
  can depend on the opponent's entities, so the legal-move list pushed to a
  seat during `haste` or `deploy` can reflect something they should not yet
  see. The `plan` segment is unaffected: planning legals read only your own
  hand, resources and pack.
- **A suspended decision leaves its stack item visible.** If a play inside a
  segment suspends on a decision, the item sits on `state.stack`, which is
  public in the view. The opponent cannot answer the decision, but they can see
  that something is there.

Neither leaks card identity in the `plan` segment, which is why they did not
block this round.

## Files

| path | what |
|---|---|
| `main.ts` | HTTP static host + WebSocket game loop (join / action / broadcast / lobby) |
| `trio.ts` | choosing the three draft elements together: the methods, pure and seeded |
| `test-lobby.ts` | the lobby: every method, the seeded draw, and "no cards until both lock in" |
| `test-postgame.ts` | the post-game payload and the rematch handshake |
| `view.ts` | `viewFor(state, seat)` redaction + per-seat event/log blurring |
| `rooms.ts` | in-memory room store, apply-to-room, hidden-segment bookkeeping, JSON persistence + replay restore |
| `test-hidden.ts` | the three hidden segments: freeze, holdback, reveal, the segment undo and its splice gate (was `test-deploy.ts`) |
| `replay-room.ts` | replay a saved game and say whether the file still describes it — faithful / engine drift / forked / inconsistent |
| `test-forensics.ts` | the log's contract: the fork record, the cascade one skip causes, and the undo roll-back guarantee |
| `test-drive.ts` | integration test: boots the server, two clients, asserts redaction + reconnect |
| `test-concede.ts` | R65 concede: the opponent's update, the stamped result, the refusals |
| `games/` | one JSON file per room (`{ seed, names, users, actions }`) |
| `accounts.ts` | the account store: passwords (scrypt), profiles, achievements unlocks, friends, match history |
| `achievements.ts` | the achievement table — one declarative counter+goal per badge |
| `stats.ts` | `summarizeGame(savedRoom)` — replays a game and tallies both players |
| `history.ts` | summarize → stash → rebuild: the one path every recorded game takes |
| `api-accounts.ts` | `/api/auth/*`, `/api/me`, `/api/player(s)`, `/api/friends/*` |
| `seed-accounts.ts` | CLI: import `games/` into the record (aliases, `--force`, `--dry`) |
| `test-accounts.ts` | the accounts test suite (stats fold, achievements, friends, live server) |
| `accounts/accounts.json` | the whole account store — **holds password hashes, gitignored** |

## The draft lobby: choosing three elements together

A live draft used to take its trio from the home screen, which had two
problems. It was one person's decision. And because the room was dealt the
moment its creator joined, that person got to study pack 1 pick 1 for however
long it took their opponent to click the link.

So a draft room now starts as a **lobby** and no cards exist until it
resolves. Both players are in the room, both submit, and the game is dealt to
both at the same instant. Either player can change the method while the lobby
is open (changing it clears both submissions — a ranking is not a pick).

Three methods (`trio.ts`) — four coming out of a rematch, which adds **Run it
back** — all of them **blind** — you never see what the
other person submitted until the trio comes back, because a pick you can see
is a pick you can counter:

| method | what you do | how it resolves |
|---|---|---|
| **One each, one at random** | name one element | both picks go in, the rest is drawn. Wanting the same element is a real outcome: it goes in once and two are drawn |
| **Something new** | just say you are ready | the trio the two of you have played least recently, or a brand new one — read off the account history, so it knows what you have actually played |
| **Rank all seven** | put all seven in order | a Borda count of both ballots, then a weighted draw from it |

Why Borda rather than an instant runoff: with two voters and seven candidates
an IRV is just "whose first choice survives the coin flip", which throws away
six sevenths of what you both said. Summing ranks uses the whole ballot, so
something you both put second beats something one of you loved and the other
put last — which is the outcome two people actually want out of a shared
draft. The weighting is quadratic in the combined rank, which in practice
gives a shared top three about 70% of the slots without ever making it certain.

Every draw runs through the engine's seeded generator off the room seed, so a
trio is reproducible and neither player can nudge it by the timing of their
click. When it resolves, both players get the trio **and the working** — who
picked what, the combined ranking, what chance did — as an interstitial and as
a line in the game log. A trio nobody can audit is a trio somebody suspects.

The escape hatch is unchanged: a room created with an explicit trio
(`&els=fire,water,earth`, the home screen's "fix the trio now" drawer, hotseat,
the tests) has no lobby and deals immediately.

Lobby messages, client → server, all `{ t: 'lobby', … }`:
`{ method }` changes the method · `{ submission, lock: true }` submits and
locks · `{ lock: false }` unlocks. While the lobby is open every message
carries `waiting.trio` — the method, the three on offer, who is locked in, and
**your own** submission echoed back (so a refresh keeps your ranking). Your
opponent's never crosses the wire.

## The post-game screen

A game used to end with one line in the prompt bar over a board nobody could
touch any more. It now ends with a screen: who won, both players' numbers side
by side, whatever the game unlocked, and three ways out — **request rematch**,
**return to home**, and a **matchmaking queue** button that is deliberately
dead until there are more than two of us.

The numbers come from the same `summarizeGame()` that feeds the profile, so
this screen and your stats page can never disagree about the game you just
played. Rows that are 0–0 for both players are dropped rather than padding the
table, and the label sits BETWEEN the two figures so they can be compared at a
glance — which is the only reason to put them on one screen.

"View the final board" dismisses it; the prompt bar keeps a **Post-game
summary** button to bring it back. Rejoining a room whose game is already over
gets the screen rather than a dead board.

### Rematch

`{ t: 'rematch', want: true | false }`. One side asking is broadcast to the
other (`{ t: 'rematch', rematch, room }`), and the button becomes "X wants a
rematch — accept". When both agree the server builds the new room outright and
sends both players its code; whoever clicks late follows them there rather than
starting a second, empty rematch.

The rematch keeps the format, the players and their seats, and takes a new
seed — it is another game, not a rerun. Constructed keeps both decks and deals
immediately (you have already each brought one). A **draft** rematch lands in a
lobby that knows what you just played, so it offers a fourth method, **Run it
back**, already selected — the likeliest answer to "again?" — with the other
three still there if you would rather change it up.

## Accounts, stats and achievements

Sign up on the home screen: a username and a password, nothing else. No email,
no reset flow — this is a two-person server, and an account is a name to hang
your stats on. Passwords are scrypt-hashed with a per-user salt and compared in
constant time; the session token lives in `localStorage` and rides along on the
websocket join, which is what binds a seat to an account.

**A game counts as soon as it is played, finished or not.** Most of ours end
because somebody has to go, and a "record it when someone wins" design would
count almost nothing. So the record is derived from `games/` itself: every
saved room is summarized at server start (`syncGamesDir`) and again the moment
a game reaches a winner. Unchanged files are skipped, so the sync costs nothing
after the first pass.

Everything downstream is a pure fold over that record:

```
games/<CODE>.json  →  summarizeGame()  →  history[]  →  rebuildProfiles()  →  achievements
```

which is why re-running any of it is safe. A game code is replaced in place,
never appended twice, and profiles are recomputed rather than incremented —
so changing how a stat is counted means `node seed-accounts.ts --force`, not
hand-editing anybody's numbers.

### Claiming games you already played

Saved games are recorded under the seat NAMES that were typed at the time.
Registering with one of those names claims them, so the first login already has
a full profile behind it. That is how the eight playtest games became Ben's and
Rashi's history. On a two-person LAN server "whoever registers the name is that
player" is the right trade; on anything public it would not be.

```bash
node seed-accounts.ts                          # sync anything new
node seed-accounts.ts --alias "Player 2=Rashi" # a seat saved before the name box existed
node seed-accounts.ts --result AGBP=Ben        # who won a game played before the winner stamp
node seed-accounts.ts --result all=Ben         # ...or all of them at once
node seed-accounts.ts --force                  # re-summarize everything
node seed-accounts.ts --dry                    # report only, writes nothing
```

`--alias` and `--result` both write INTO the saved game file, not just into
the record. They have to: a sync re-reads a file whenever it has changed, and
would otherwise undo them. Both are idempotent — a second run edits nothing.

### When a log stops describing its own game

A room file is a claim: **seed + actions reproduces this game**. It is the tool
the whole playtest loop reviews bugs with, so it has to be either true or
explicit about why not. Game UZRG rejected **79 of its 276 actions** replayed
on the engine it was played on, and nothing in the file explained it.

The mechanism, reproduced in `test-forensics.ts`. `rebuild()` is deliberately
tolerant — an action the current engine rejects is skipped rather than killing
the room, because losing a live game to a rules tweak is worse than a slightly
wrong log. But the skipped action stays in `actions`, and **one skip cascades**:
the board the rest of the log was written against no longer exists, so action
after action is refused too. On a synthetic 60-action game, one action becoming
illegal cost **28 of the 60** and rolled the game back from turn 4 to turn 2 —
and play then carried on from the rolled-back board, appending to a log that is
now two different games end to end.

Note what is *not* wrong: the skip is deterministic, so `rebuild(seed, actions)`
still equals the state the players are sitting in. The file is not
self-contradictory. It is **forked**, and it said nothing about it. That silence
is the bug.

So the file now says so. A restore that cannot faithfully rebuild a **live**
room appends to a `forks` array — when, how many actions were lost, why the
first one was refused, and which turn the game resumed at — and pushes a ⚠ line
into the game's own log so both players see it on their next join. The contract
becomes explicit and checkable: **seed + actions, minus the forks this file
declares, reproduces this game.**

Nothing is pruned, even though pruning would restore the literal contract.
Those actions are the evidence — a forked game is exactly the one you most want
to read — `history.ts` counts the RAW log length so a real game is never
demoted to a stub, and a rules commit can be reverted, at which point a recorded
fork can be re-checked while a pruned one is simply gone.

**A game in progress survives all of this**, which is the whole reason the
tolerant restore exists. It is restored, it is playable, new actions are still
accepted. The only difference is that the fork is now loud instead of silent.
Finished games are left alone: their skips are read-only forensics that
`stats.ts` already reports as diverged, and recording a fork for each would
rewrite hundreds of settled files on every boot. (The ~650 `replay skipped`
warnings at startup are those, and they are normal.)

Two more guarantees fell out:

- **An undo can never quietly cost somebody a move.** `spliceable()` predicts
  from an action's payload whether removing it would renumber what came after;
  `undoActionAt()` now *measures* it — it does the splice, and if the rebuild
  can suddenly not replay something, it puts the log back exactly as it was and
  reports a refusal. A measurement beats a prediction, and a refused undo beats
  an action vanishing out of the record.
- **`replay-room.ts` tells the two failures apart.** It used to present both as
  a pile of skips, which is precisely why UZRG went unnoticed:

| verdict | exit | meaning |
|---|---|---|
| **FAITHFUL** | 0 | every action replays, no forks declared |
| **ENGINE DRIFT** | 2 | the rules changed since; the *file* is a true record and the current engine disagrees with it. Expected after a rules commit — a surprise otherwise, and then this log has found you a regression |
| **FORKED** | 2 | the file declares forks and this replay reproduces exactly them. Not a server bug; read the halves as separate games |
| **FORKED + FURTHER DRIFT** | 2 | declared forks, plus new skips on top |
| **INCONSISTENT** | 3 | the file declares forks this engine replays fine. No server behaviour can produce that — a rules change was reverted, or the file was hand-edited |

`replay-room.ts` also deals constructed games from their two saved decks now;
it used to replay them from a shared deck, which diverged at the first draw.

### Why a result is stamped and not derived

A saved game is READ by replaying it, and an old log replayed onto a newer
engine diverges: R34 re-ordered simultaneous triggers, and once one action is
refused the rest of the log is describing a board that no longer exists, so
the refusals cascade. Five of our first eight games diverge (AGBP applies 73
of its 229 actions), which is why they briefly showed up as "unfinished" when
in fact Ben had won all eight.

So `rooms.ts` stamps `winner` into the saved game the moment a game is
decided, keeps it stickily (a replay that cannot reach the ending must never
clear a result that was true when it happened), and `stats.ts` prefers that
stamp over anything it can derive. A game with no stamp whose replay diverged
is reported as **unknown**, never as unfinished — its stats are a floor, not a
total, and the profile and match history both say so.

### What is counted

Per game, per seat: units and spells played, spell tokens cast, augments and
grafts, cards drafted, resources opened, abilities used, attacks declared and
units sent, damage dealt, life lost, units killed and lost, turns, and a
per-card tally. Elements are counted by **card weight** — every card you play
credits its element, a hybrid a half to each — and your "favorite element" is
the argmax of that. The tally reads the action log with the pre-action state in
hand (an index means nothing after the action runs) and the event stream for
consequences. Actions the current engine rejects are skipped, exactly as
`rooms.ts` skips them on replay, and are **not** counted.

Achievements (`achievements.ts`) are each one counter against one goal, so the
UI shows honest progress ("79 / 100 cards drafted") for every locked one, and a
new achievement is retroactive by construction. Unlocks are sticky: raising a
goal later cannot take somebody's badge away.

### Account endpoints

`POST /api/auth/register` · `/api/auth/login` · `/api/auth/logout` ·
`/api/auth/password` — a bearer token in, or out.
`GET /api/me` (401 when the token is unknown, so a stale one can be dropped) ·
`GET /api/player?name=` · `GET /api/players` · `GET /api/achievements`.
`POST /api/friends/request` · `/accept` · `/remove` — decline, cancel and
unfriend are all the same removal, so the client never has to work out which
it is doing.

Two env vars exist for tests, and only for tests: `ALGO_ACCOUNTS_FILE` and
`ALGO_GAMES_DIR`. The real store holds password hashes and must never be a
fixture.

## Test it

```bash
node test-drive.ts
node test-accounts.ts
```

Boots the server on an ephemeral port, connects two clients, and asserts:
redaction holds on **every** view pushed the whole session (seat 0 never sees
the opponent's hand contents, the deck order, the opponent's dormant resource
elements, or the seed); a recycle is blurred for the opponent; a wrong-seat
action is rejected; and a drop+rejoin resyncs a full redacted view. Expected
tail: `ALL PASS ✓`.

## Message protocol (JSON over one WebSocket)

Client → server:
- `{ t: 'join', room: CODE, seat?: 0|1, name?, token?, mode?, els?, deck? }` —
  `mode` (`shared`/`draft`/`constructed`) + `els` only apply when the join
  creates the room; `deck` (an array of card names, algomancer.cc-importable —
  see `decks.ts`) registers this seat's constructed deck; `token` is the
  account session token, and a valid one binds the seat to that account and
  **overrides `name`** (stats are filed under the account name, so it is the
  one thing that cannot disagree)
- `{ t: 'action', action: Action }`

Server → client:
- `{ t: 'joined', room, seat, view, log, legal, peers, names }` — while a
  constructed room still waits for decks, `view/log/legal` are replaced by
  `waiting: { have: [bool, bool] }`; a fresh full `joined` goes to both seats
  the moment the second deck arrives and the game is dealt
- `{ t: 'update', view, events?, legal, peers }` — after any action, to both
  seats. Inside a hidden segment the actor gets their own `events` and the
  opponent gets a bare view refresh
- `{ t: 'update', step, reveal, view, events, legal, peers }` — a hidden
  segment just closed. `step` is `'plan' | 'haste' | 'deploy'`; `reveal` is
  what the OTHER seat did behind the screen, and `events` is that followed by
  the public tail. The client renders a `'plan'` close as log lines and board
  animation only (it fires every turn and the payload is resource lines) and
  keeps the modal interstitial for `'haste'` and `'deploy'`
- `{ t: 'error', msg }` — illegal action / join error, to the actor only
- `{ t: 'gameover', seat, winner, names, mode, els, turns, seats, rematch,
  recorded, unlocked?, me? }` — the post-game screen's payload, sent to both
  seats when a game is decided and again to anyone who rejoins a decided room
- `{ t: 'rematch', rematch, room }` — who has asked; `room` is non-null once
  both have, and is where to go
- `{ t: 'me', me }` — the account profile, pushed alongside `joined` when the
  join carried a valid token
- `{ t: 'recorded', me, unlocked[] }` — the game just ended and went into your
  stats; `unlocked` is whatever achievements it earned

## Deck endpoints (constructed)

- `GET /api/deck/defaults` — the bundled test decks (`default-decks.json`,
  built by **aramsunat** on algomancer.cc), already mapped to engine card names
- `POST /api/deck/import` with `{ url }` (an algomancer.cc deck link — fetched
  through their `/api/decks/<id>` JSON) or `{ text }` (a pasted list, one card
  per line with optional leading count) → `{ ok, deck: { name, author, url?,
  cards, problems } }`
