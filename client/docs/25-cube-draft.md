# 25 — Cube draft events

Owner's request 2026-11-14. A host opens an **event**; up to a table of players join by link or code; they
pod-draft (MTGO style, packs passed around the table, bots fill empty seats), each builds a deck from only
what they drafted, then they play a Swiss / Round-robin / Exhibition tournament of Bo1 or Bo3 matches under
casual or competitive rules. This doc is the contract every workstream builds to. Decisions marked **(D)** were
made by the orchestrator, not the owner, and are listed again in §12 for the owner to approve or overturn.

## 1. Owner's settled choices
- Cube = a pasted card list OR a set of the game's elements. Five elements is the standard.
- Host sets min/max players (default table 8), tournament (Swiss / Round robin / Exhibition), rules (casual /
  competitive), best of (1 / 3, default 1), start now (host fires at will) or at a scheduled time.
- Join by link or code; a seat is reserved on join. Host starts the draft.
- Packs dealt without replacement — singleton, unless a pasted list has duplicates.
- **Pack too small for the table → keep 3 packs, shrink the pack size to fit** (base five = 320 deck-legal
  cards; 8 seats → 3 packs of 13). Host sees the numbers and may override pack count and size.
- Pick: click a card to reserve it, a Confirm button takes it; or drag it into your picks. At ≤10 s left
  with nothing reserved the client auto-highlights (reserves) a card; at 0 the reserved card is taken.
- Pick clock = **6 s × cards in the pack**. A waiting pack shows at once after you pass.
- After the draft: the normal builder, only the drafted cards. Main ≥ 30, sideboard ≤ 7. A deck may be
  edited between rounds ("Save and submit deck").
- While waiting: standings, who is still playing, Watch a match.
- Host can manage people and manually edit pairings / results.
- A round finishes → **90 s break**; the host sees the next pairings at once, may change them or "Post now".
- Exhibition: no rounds. You are matched with someone you have not played as soon as you both are free;
  no rematches; prefer similar records.
- Swiss: 3 / 1 / 0. Round robin: everyone once; matches may span days.
- **Bots: draft only, then leave.** The tournament is humans only. Solo testing uses seeded sim accounts.
- Bot heuristic: highest win-rate card, penalise elements the pool doesn't support, small bonus for curve gaps.

## 2. Architecture (files and ownership)

A `Room` is a two-seat table, so an event is its own record that *opens ordinary match rooms* for its pairings,
exactly like the league (`league-match.ts openLeagueMatch`).

| file | what | pure? |
|---|---|---|
| `server/cube-types.ts` | every shared type: config, event record, the wire view, WS messages. UI imports it **type-only**. | types |
| `server/cube-draft.ts` | the pod draft state machine: deal, seat order, pass direction, pick/reserve/timeout, pack rounds | pure (time passed in) |
| `server/cube-bot.ts` | the pick heuristic + `autoBuild(pool)` (suggested 30 + 7) | pure (win rates passed in) |
| `server/cube-tourney.ts` | Swiss / round-robin / exhibition pairing, standings, tie-breaks, host edits | pure |
| `server/cube-store.ts` | one JSON file per event `var/cube/<CODE>.json` (`cubeDir()` in statepaths.ts, env `ALGO_CUBE_DIR`), load/persist, the event's notes (bell) | I/O |
| `server/cube.ts` | the event controller: phases, the 1 s sweep, ops, opening match rooms, recording results | glue |
| `server/api-cube.ts` | HTTP routes + the room-less WS channel `{t:'cube', …}` wiring in main.ts | glue |
| `ui/cube.ts` | client controller: module state, the socket, clicks, `screen()` | |
| `ui/pages/cube.ts` | event page: lobby · building status · tournament · done (`cubeView/cubeHtml/paintCube`) | pure Html |
| `ui/pages/cubedraft.ts` | the pick screen (`cubeDraftHtml`) | pure Html |
| `ui/tabletop.ts` (edit) | `TableHost.poolRows?()` + per-card owned ceiling so the builder can be pointed at a drafted pool | |
| `ui/styles/cube.css` | the CSS piece (listed once in `styles/index.css`) | |
| `server/e2e/cube-seed.ts` | sims: register, join an event, draft fast, auto-build, submit, optionally play out | script |

## 3. The event record

```ts
type CubeSource = { kind: 'elements'; elements: Element[] } | { kind: 'list'; names: string[] /* with multiplicity */ };
type Tournament = 'swiss' | 'roundrobin' | 'exhibition';
interface CubeConfig {
  name: string;                    // default "<host>'s cube"
  source: CubeSource;              // default elements = fire water earth wood metal
  packs: number | null;            // null = auto (3)
  packSize: number | null;         // null = auto: min(15, floor(pool / (seats × packs)))
  minPlayers: number;              // default 2 (D)
  maxPlayers: number;              // default 8, range 2..12 (D)
  fillBots: boolean;               // default true: bots fill to maxPlayers at start (D)
  startAt: number | null;          // epoch ms; null = host starts
  tournament: Tournament;          // default 'swiss'
  swissRounds: number;             // default 3
  rules: 'casual' | 'competitive'; // default 'casual' (D)
  bestOf: 1 | 3;                   // default 1
}
type Phase = 'lobby' | 'drafting' | 'building' | 'playing' | 'done' | 'cancelled';
```

The event code is a 4-letter code minted with `freshRoomCode()` + `reserveRoomCode()` and checked by
`codeTaken` — events and rooms share one code space, so a code typed into Join is never ambiguous. The URL is
`/?cube=CODE` (written with `replaceState`, like `?league=`), reachable from a home button (every page has a button).

**Sign-in required** to create or join (guests are real accounts, so "play as guest" covers everyone).

### Pool & packs
- `elements`: `draftDeckList(elements)` (one copy each, registration order).
- `list`: parsed with `importDeckText` (ignore its deck-rule problems); unknown / non-deck-legal names are
  refused at creation with the list of bad names. **Copies capped at 2 per card (D)** — the constructed copy
  cap still applies to cube decks, so a third copy could be drafted but never played.
- At draft start: `seats = humans + (fillBots ? maxPlayers − humans : 0)`, `packs = config.packs ?? 3`,
  `packSize = config.packSize ?? min(15, floor(pool / (seats × packs)))`. Refuse to start if packSize < 5
  ("this cube is too small for N players"). The setup screen shows the live numbers for the current seat
  count and for a full table.

## 4. The draft (`cube-draft.ts`)
- Seed per event. Seat order around the table is **shuffled at start (D)**. Pool shuffled; packs dealt
  without replacement; leftover cards unused.
- Pack 1 passes left, pack 2 right, pack 3 left (alternating).
- Each seat has a FIFO queue of packs. The head pack is the seat's *current* pack; its pick clock starts
  when it becomes current: `6000 × cards` ms (env `ALGO_CUBE_PICK_MS_PER_CARD` overrides 6000 for tests/dev).
- `reserve(seat, card)` (no clock change); `pick(seat, card)` commits and passes the rest on; a timeout takes
  the reserved card, else the seat's **suggestion** (the bot heuristic for that seat's pool — the same card
  the client highlights at ≤10 s). The server sends `suggest` with every current pack.
- A pack round ends when every pack is empty; the next round deals at once.
- Bots pick **1 s (D)** after a pack becomes current for them (instant feels broken next to a human).
- Disconnected humans keep their clock; timeouts auto-pick. A returning player sees their current pack.
- A player sees: their current pack, their picks, pack/pick number, seconds left, direction, and the table
  (each seat's name, bot/human, how many packs are waiting at it). Never others' picks.
- The last pick → phase `building`. Bots and their pools are dropped from the event (kept in the file).

## 5. Bots (`cube-bot.ts`), ported from the owner's MTG DraftTrainer `app/heuristic.py`
`score = 100 × wr + colour + curve + bomb`, where
- `wr` = the card's game-in-hand win rate from `cardStats({mode:'all'}).cards[i].gih` shrunk toward 50%:
  `(w + 10 × 0.5) / (n + 10)`; a card with no data is 0.5.
- colour: elements = the card's `factions`. Support per element from the pool (top two elements fully supported,
  a third at ≤0.5 by depth); penalty per unsupported element ramps 1.5 → 6 points as the pool commits
  (commit = min(1, elemental cards / 12)); gold cards pay per element.
- curve: from pick 14 on, a unit at a `mana` slot where the pool's on-element units are short of a target
  (scaled to a 30-card deck — the agent picks targets and documents them) gets up to +1.5.
- bomb: +1 per pool card with wr ≥ 0.61 sharing an element (cap +2).
- ±0.5 seeded jitter so bots at one table differ.
- `autoBuild(pool, wr)` → `{main ≥ 30, side ≤ 7}`: the pool's best two elements (plus gold cards of exactly
  those), filled by score to 30 (more on-element if short); side = the next 7 best. Used by the
  builder's "Suggest a deck" button and by sims.

## 6. Building
- Phase `building`: each player gets the builder (the tabletop) pointed at their drafted pool. It starts
  empty; **"Suggest a deck" (D)** fills it with `autoBuild`.
- Deck rule: main ≥ 30, side ≤ 7, every card ⊆ the drafted pool counting copies, ≤ 2 copies over main + side,
  every card deck-legal (`checkMatchDeck` + the pool check, on the server at submit).
- Cube decks live in the **event**, never in the account's 20-slot deck shelf. **"Save a copy to my decks"
  is not built (D)**.
- "Save and submit deck" → submitted. The lobby shows who has submitted.
- When every player has submitted → the first pairing break starts (§7). The host may also "Start now"; any
  player with no submitted deck is then **dropped (D)** (confirm dialog names them).
- During the tournament a player may edit and re-submit any time they are not in a match; a match uses the
  deck submitted when its room opens. In Bo3, between games, the match's own sideboarding applies.

## 7. Tournament (`cube-tourney.ts`)
Points 3 win / 1 draw / 0 loss. Tie-breaks (D: the MTG standard): points, OMW% (each opponent's match-win %
floored at 1/3), GW% (floored 1/3), OGW% (floored 1/3), then join order. A draw happens only by host edit.

- **Swiss** — `swissRounds` rounds (host sets, default 3). Round 1 random. Later rounds: pair within points
  order avoiding rematches (backtracking; n ≤ 12, exhaustive is fine), float down when needed. Odd count:
  the bye goes to the lowest-ranked player without one; a bye = a 2–0 match win.
- **Round robin** — every pair once (n(n−1)/2 matches), all posted at once. Matches are played in any order,
  any time, over days. No byes. Done when every match is decided, or the host ends it.
- **Exhibition** — no rounds. Each player has a **Ready** switch, **on by default (D)** after submitting and
  after each match (switch off to take a break). The server pairs two Ready players who have not met,
  preferring the smallest points gap, then the longest waiter. Both are notified (bell + sound + tab alert).
  Done when the host ends it.
- **The break** (between Swiss rounds, and before round 1 of every format): when the last match of a round is
  decided, the next round's pairings are computed **at once** and shown to the host, who may swap players,
  set a bye, or "Post now". After **90 s** (env `ALGO_CUBE_BREAK_MS`) they post automatically. Players see
  "Next round in 1:12". Before round 1: the same 90 s break starts when every deck is submitted (round robin
  posts its whole schedule then; exhibition turns Ready on then).
- **Host edits**: swap players in un-posted or un-started pairings; set or clear any result (win / draw /
  void) on a match that is not in progress (an in-progress one: "Award" ends its match room as a void and
  records the host's result); drop / undrop a player (dropped players are never paired; in round robin their
  unplayed matches count as losses for them (D)); end the event. Standings are always derived — the host
  edits results, never standings directly.
- No round time limit **(D)** — competitive matches carry their own 45-min chess clock.

## 8. Matches
- A posted pairing is a **match** (`startMatch(room, id, bestOf, now, casual)`), unrated, with
  `m.cube = {event, pairing}`. **Rooms open lazily** when either player presses Play (the league's pattern):
  an unjoined room closes after ~65 min and voids its match — a cube void just returns the pairing to
  "not started"; the next Play opens a fresh room. Both seats are registered server-side with the decks
  submitted at that moment.
- One composed `ended` dispatcher (main.ts) calls both the league's and the cube's handlers — never a second
  `setMatchHooks({ended})` that replaces the league's.
- History rows are tagged `cube: CODE`; **cube games are unrated and left out of card stats, ratings and
  achievements (D)** (as custom-rules games are).
- When a cube match is over the client goes back to the event page, not home. Watching a cube match has a
  "Back to the event" exit.
- Spectating: the existing `?ws=1&room=CODE&watch=1`. The event page's Matches list shows a **Watch** button
  on every live match.

## 9. Wire
- HTTP (bearer token): `POST /api/cube/new {config}` → `{code}`; `POST /api/cube/<code>/join`, `/leave`,
  `/deck {main, side}` (submit), `/ready {on}`, `/play` → `{room}` (open/reuse my match room);
  host: `/start`, `/config`, `/kick {user}`, `/pairings {swap…}`, `/post`, `/result {pairing, outcome}`,
  `/drop {user, on}`, `/end`, `/cancel`. `GET /api/cube/mine` → my events for the home/Join sheet.
- Live: the room-less socket (the queue's pattern, main.ts ~2570): client sends
  `{t:'cube', op:'sub', code, token}`; server pushes `{t:'cube', view: CubeView}` on every change. No per-second
  pushes: the view carries absolute deadlines plus the server's `now` (for clock skew) and the client counts
  down itself. Draft ops on the socket:
  `{t:'cube', op:'reserve'|'pick', card}`.
- `CubeView` is per viewer (it hides others' picks) and is the only thing the UI renders from. Exact shape in
  `cube-types.ts`, owned by the server workstream; the UI workstream starts from fixtures of that shape.

## 10. UI
- **Entry (D)**: a fourth card on the home's right column, "Cube draft" (glance: your events and their phase),
  opening the cube page; "New event" lives there. The Join sheet lists "Your cube events" beside "Your
  matches", and its code box accepts an event code.
- Event page (`frameHtml`, `fill: true`, no page scroll), by phase:
  - **lobby**: seats (names; empty seats show "Bot" when fill is on, else "Open"), the settings summary, the
    pack math, the share link + code, scheduled countdown. Host: Start draft, Edit settings, remove a player.
  - **drafting** → the pick screen (§4): the builder's layout, the pool band replaced by the current pack's
    tiles (bigger), Confirm pick, the drafted cards on the table below, the clock, "Pack 2 · Pick 5", the
    table strip (seats with waiting packs, direction arrow).
  - **building**: the tabletop with the cube host (restricted pool, "Suggest a deck", "Save and submit deck");
    a strip of who has submitted.
  - **playing**: toolbar tabs `Standings · Round · Matches · Players` (round robin: `Schedule`; exhibition:
    no Round tab, a big Ready switch). "Your match" card with Play. Deck button → builder. Break countdown.
    Host: a Pairings sheet (swap, post now), result/drop editing.
  - **done**: final standings.
- Components only (tests 993/995), each page has a DOM-free `…Html` test + a Storybook story, `data-btn` names
  stable, every drag also a click route.

## 11. Tests and numbers
Reserved test numbers **1300–1349**: 1300–1309 draft+bot, 1310–1319 tourney, 1320–1334 server integration,
1335–1349 UI. Agents run targeted tests only; the orchestrator runs the full gate.

## 12. Decisions made without the owner (approve or overturn)
1. Min players default 2, max 8 (range 2–12); bots fill to max by default.
2. Rules default Casual.
3. Seat order shuffled at the draft start; bots pick after 1 s.
4. A pasted list's copies are capped at 2 (the constructed copy cap).
5. Builder starts empty, with a "Suggest a deck" button; cube decks don't go on your deck shelf.
6. Host "Start now" drops anyone without a submitted deck.
7. Tie-breaks: OMW%, GW%, OGW% (floored ⅓); a bye is a 2–0 win.
8. Round robin: no byes; a dropped player's unplayed matches are losses.
9. Exhibition Ready is on by default after each match.
10. No round time limit.
11. Cube games unrated, out of card stats and achievements.
12. Entry: a "Cube draft" card on the home's right column; Join accepts event codes.
13. No CR record yet for the cube deck rule (follow-up).
