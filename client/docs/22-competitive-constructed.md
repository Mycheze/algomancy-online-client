# 22 — Competitive Constructed

*Owner, 2026-11-02: a tournament-shaped constructed format. Matches may be Best of 3 (Bo1
stays). Decks get a sideboard of up to 7 cards, swapped freely with the main deck **between**
games ("just like Magic"), with saved one-click swap presets. No simultaneous steps: the
initiative player takes planning, haste and deployment first while the other player watches,
then they switch. A chess clock of 45 minutes per player **per match**, plus 120 s to sideboard.
"Concede game", not "Concede match", and it must work. A match may be paused between games by
mutual agreement and resumed later exactly where it stood.*

> **2026-11-03 — saved swap presets were TAKEN OUT** (owner, after the first playtest: *"Let's
> actually entirely remove the 'Swaps' thing for now. That can come later, but the UX is terrible
> for it and we should plan it better. Rip it out for now."*). Everything below about presets —
> `SwapPreset`, `applyPreset`, the deck's `swaps` field, the Swaps section of the sideboard tab,
> the between screen's presets row and `{t:'cc', op:'preset'}` — describes what was built on
> 11-02 and removed on 11-03; it is kept as the record for when presets are planned again.
> What stays is the sideboard itself and sideboarding **by hand** between games (§5.4), with one
> "Back to the registered deck" button (§8 Q3). A deck or a match file saved with `swaps` /
> `presets` still loads; the field is ignored, and a deck drops it at its next save. The same
> day the Sideboard became the deck page's **second** tab, with a link to it under the main
> list ("Sideboard · n cards →" / "Add a sideboard →"), and the Sideboard tab gained its own
> add-cards drawer.

This is the design. **Nothing is built yet.** §0 is settled and is not reopened here. §8 holds
the questions that are still the owner's. Every claim about today's code cites `file:line`
(paths under `client/` unless they start `data/`), as of master `ba32fcf4`.

Short names: **CC** = Competitive Constructed. **INT / NIT** = the initiative / non-initiative
player of the current turn. **Game** = one Algomancy game. **Match** = one Bo1 or Bo3.

---

## 0. Settled

**DECIDED by the owner, 2026-11-02:**

| | |
|---|---|
| Swaps | Like Magic: any cards either way. Main stays ≥ 30, sideboard ≤ 7. The main deck's size may change. |
| Clock flag | Running out of time **loses the match**. |
| Initiative, games 2–3 | The **loser of the previous game chooses** who takes the initiative. Game 1 is random. |
| Pause limit | **7 days**, then the match closes with no result. A league match also closes at its league week's end. |

**Defaults stated to the owner and not objected to.** This spec builds them:

- CC is its own format in the lobby, with a Bo1/Bo3 choice. Casual constructed and draft are
  unchanged. The December league is CC Bo3.
- In the sequential steps the NIT watches the INT live. Nothing is hidden. This is the printed
  order (CR 501.4, 507.3). The simultaneous version is the client's house rule, Annex D1.5,
  which CT-247 kept (wontfix). CC turns it off.
- The sideboard is a **new** field, separate from `maybe`. Existing decks start with an empty
  sideboard. The copy cap counts main + side together. The opponent never sees your sideboard
  or your swaps. Swap presets are named and stored on the deck.
- The sideboard window is 120 s, or until both players press Ready. When it expires, whatever
  is set is locked in. Neither chess clock runs between games or while the match is paused.
- The in-game button reads "Concede game". A Bo3 also offers "Concede match".
- A rated Bo3 gives **one** Elo result (the match winner). Card stats still count every game.
- A pause is offered after a game ends, and both players must agree. Resuming needs both of
  them present.
- **Not this round:** CC in the matchmaking queue.

---

## 1. What exists, and what is missing

| need | today | gap |
|---|---|---|
| Several games as one unit | Nothing. One room is one game. `createRematch` builds a **new room with a new code** (`server/rooms.ts:4161-4189`). `rematchRoom` is not persisted (`rooms.ts:4700`). | A match record (§2). |
| Sequential steps | Resource, haste and deployment are hidden simultaneous segments. `hiddenSegment` (`engine/src/engine.ts:306-310`) is the one predicate. The server hides with it (`rooms.ts:103-147`, `2143-2216`), and so do `ui/solo.ts:159-174` and `ui/replayserver.ts:196-234`. The decision gate reads it (`engine/src/apply.ts:348`), and so does the timestamp clock (`engine.ts:2707-2721`). | An engine switch that makes it `null` in CC (§3). |
| A per-game rules flag | `createGame(seed, names, mode, draftElements, decks, deal, lessonDeal)` (`apply.ts:136-150`) is the only carrier. A save has no ruleset stamp; `versions[]` holds git SHAs only. | A new optional `rules` argument and a persisted `Room.rules` (§3.1). |
| Chosen initiative | Rolled from the seed (`apply.ts:206-211`). A lesson deal may override it, **after the roll is drawn**, so the RNG stream does not move. | The same override for CC games 2–3. |
| Clock per match | One bank per seat per room. `MATCH_CLOCK_MS.constructed` = 45 min (`rooms.ts:1431-1434`). Its UI copy is `CLOCK_DEFAULT_BY_MODE` (`ui/main.ts:3048-3052`), held equal by test 279. A seat is billed only while it has legal actions (`rooms.ts:1499-1530`). | Banks carried from game to game, and a flag that ends the match. |
| Concede | Engine action `{type:'concede'}` (`apply.ts:561`, `765-769`). Stamped as `room.concession` (`rooms.ts:2810`). Weighted by turn (`server/concession.ts`). Labelled "🏳 Concede the match" (`ui/inspect.ts:798`). | "Concede game" everywhere, plus a match-level concede. |
| Sideboard | None. `maybe` is a shelf. The docs say so in three places: `docs/deck-format.md:159-165`, `ui/deckformat.ts:97-100` and `server/collection.ts:47-50`. algomancer.cc's `sideboard` is read into `maybe` (`ui/deckformat.ts:315`, `server/decks.ts:113-115`). | A new field, a validator, a builder pile, and presets (§4). |
| League result | `recordFinishedGame` reports the first decided game (`server/main.ts:1921-1932`). `recordPlayed` ignores a second report (`server/league-store.ts:887-901`). `LeagueFormat` is `'draft'\|'constructed'` (`league-store.ts:53-55`). | A `'competitive'` format whose **match** reports (§6). |
| Elo | `isRated` folds each matchmade game separately (`server/rating.ts:144-170`). | A match counted once (§2.6). |

**No card reaches outside the game.** The phrase "outside the game" occurs in the oracle file
only in a physical-tracking reminder ("…another card or dice with the same number on top of
the card, outside the game"). So the engine never needs to know a sideboard exists. A sideboard
is a server and deck-store concept only.

---

## 2. Where the match lives

### 2.1 Decision: a Match record that chains ordinary rooms

**Every game of a match is an ordinary room**, with its own code, seed, decks, action log and
file. A **Match** record, in a new store, ties them together and holds everything that lasts
between games. Each game room carries one link back to its match: `Room.match = {id, game}`.

**Rejected: one room holding several games.** Everything that consumes a room assumes one room
is one game, a function of `(seed, mode, els, decks, scenario, custom, actions)`
(`rooms.ts:752-760`):

- `rebuild()` replays one log from one seed (`rooms.ts:2136-2216`).
- `persist` writes a single `actions`, `sigs`, `cardLog`, `refs`/`posRefs`, `versions` and
  `forks`, each aligned to that one log (`rooms.ts:4372-4462`).
- The replay viewer's `ReplayFile` is one seed and one log (`ui/replayserver.ts:63-75`), and so
  is the `replay-room.ts` CLI.
- History imports one file as one `RecordedGame` (`server/history.ts:86`, `298`).
- Card stats replay one file through `dealScenario` (`server/stats.ts:366`,
  `server/cardledger.ts:398`).
- The agreed-fix rewind, undo and drift detection all index one log
  (`rooms.ts:3475-3550`, `4116-4119`).

Making each of these hold arrays would touch nearly every server module, and it would put every
saved game's format at risk to gain something a link field gives for free.

**What chaining costs, and where each cost is paid:**

| concern | answer |
|---|---|
| Replay, BL-38 viewer, card stats, history | Untouched in shape: each game is a room file. Each file gains two additive fields, `rules` and `match` (§2.3). Every consumer that **deals** a game must pass `rules` (§3.1). |
| League result | The match reports, once, when it is decided. The per-room league hook is skipped for match rooms (§6.2). |
| Elo | One result per match, from a match row (§2.6). Card stats keep every game. |
| Idle close (1 h / 12 h, `rooms.ts:2383-2408`) | Applies to each game room unchanged. The one exemption is the waiting room of a **paused** match (§2.5). |
| 7-day restore window (`rooms.ts:4325`, `4594-4605`) | The pause resets the waiting room's `lastActionAt`. The restore window and the void deadline then lapse at the same instant (§2.5). |
| The code players hold | A room code is **not** stable: codes are minted against the room map alone, so a forgotten finished room's code can be handed out again (`main.ts:509-516`, guarded by test 367). The match therefore gets its own id, never a room code. Players follow the current game's room by push, as `rematchRoom` does today (`main.ts:2066`, `ui/main.ts:687-689`). A paused match is reached by a button (§5.6), never by a remembered URL. |

### 2.2 The Match record (`server/match-store.ts`, new; `var/matches/<id>.json`)

The store writes atomically (temp file + rename), as `persist` does (`rooms.ts:4367-4371`). Its
location goes in `server`'s path module beside `gamesDir()`, never spelled inline (CLAUDE.md).

```ts
interface Match {
  id: string;                          // 'M' + 10 base32 chars — never a room code
  bestOf: 1 | 3;
  users: [string, string];             // both seats are accounts (see below)
  names: [string, string];
  createdAt: number; endedAt?: number;
  /** what each seat brought to game 1 — the pool every later configuration must be a
   *  rearrangement of. Locked when game 1 deals. */
  registered: [Registered | null, Registered | null];   // {main, side, deckId|null}
  /** the configuration each seat will play next (equal to `registered` before game 1) */
  current: [Config | null, Config | null];              // {main, side}
  games: MatchGame[];                  // {code, initiative: Seat, winner: Seat|null,
                                       //  how: 'played'|'conceded'|'time'|'closed', at}
  banks: [number, number];             // chess-clock ms left, written at each game's end
  phase: 'game' | 'between' | 'paused' | 'over' | 'void';
  between?: {
    code: string;                      // the waiting room of the next game (§2.4)
    chooser: Seat;                     // the previous game's loser
    initiative: Seat | null;           // their answer
    ready: [boolean, boolean];
    until: number | null;              // epoch ms the sideboard window locks; null while paused
  };
  pause?: { offeredBy: Seat | null; pausedAt: number | null };
  result?: { winner: Seat; how: 'games' | 'conceded' | 'time'; at: number; concededBy?: Seat };
  league?: RoomLeague; rated?: true;
}
```

**Both seats must be signed in.** A match's identity, its pause and resume, the presets and the
league all hang off accounts. A guest still has casual constructed. `seatVerdict`
(`rooms.ts:2669`) gains a CC arm that refuses a signed-out joiner with one sentence.

### 2.3 What a game room adds

Two additive fields, written only when present, exactly like `single` and `league`
(`rooms.ts:4392-4402`):

- `rules: { sequential: true, initiative?: 0 | 1 }` is **part of the deal**, persisted beside
  `seed` like `custom` (`rooms.ts:4389-4391`). `initiative` is absent on game 1, which rolls.
  On restore, a `rules` value this build cannot read **throws**, never deals a standard game.
  `restoreCustom` (`rooms.ts:91-98`) is the model.
- `match: { id, game }` is the link (game is 1-based). Restore reads it into the room
  (`rooms.ts:4689-4700`).

`decks` stays what it is: the two **main** decks this game was dealt from. A replay needs no
sideboard. The sideboard lives in the match record only.

### 2.4 The next game's room is created when the previous game ends

When game *k* is decided and the match goes on, `match.ts` creates game *k*+1's room at once:

- a constructed room with `decks = [null, null]`, so `roomWaiting` is true
  (`rooms.ts:1832-1835`);
- `users` copied from the match (the way `createRematch` does it, `rooms.ts:4183`);
- `match` and `league` stamped, plus `rated` if the match is rated;
- clocks set from `match.banks`.

The between-games flow (§5) runs **in that waiting room**. This choice buys four things already
in the code:

- **Presence comes from sockets.** "Both present" for resume is `room.sockets[0] &&
  room.sockets[1]`. No new presence channel is needed.
- **No clock runs.** `matchRunning` is false while `roomWaiting` (`rooms.ts:1483`). That is
  the stated default ("neither chess clock runs between games"), with no new code.
- **Per-seat payloads already exist.** `waitingInfo(room, seat)` (`main.ts:1762`) is built
  separately for each seat. The match lobby rides it as `match?: MatchLobbyInfo`, and each seat
  gets only its own configuration (§5.3).
- **The deal path is the existing one.** When the window resolves, `match.ts` calls
  `setRoomDeck` for both seats with their `current.main`. `setRoomDeck` deals through `fresh()`
  (`rooms.ts:2068-2097`), which now passes `room.rules`.

A join to a match room after game 1 must **not** register the deck it carries. The constructed
join registers one today (`main.ts:2606-2608`). `takesJoinDeck` (`rooms.ts:2037-2039`) gains a
`room.match && room.match.game > 1 → false` arm.

### 2.5 Pause, restore and void

- **Pause** sets `match.phase = 'paused'`, `pause.pausedAt = now` and `between.until = null`
  (the sideboard window stops). It also sets the waiting room's `lastActionAt = now` and
  persists the room.
  - The restore window is 7 days from `lastActionAt` (`rooms.ts:4325`, `4594`). It therefore
    keeps the room loaded for exactly as long as the match can be resumed.
- **Idle close** must not close a paused match's room. `idleDue` (`rooms.ts:2402-2408`) gets an
  injected predicate, `setRoomHeld(fn)`, that `match.ts` supplies. This is the same injection
  shape as `ctx.openRoom` (`main.ts:627`). `rooms.ts` must not import `match.ts`, because
  `match.ts` imports `rooms.ts`.
- **Void.** A sweep on the existing 1-second interval (`main.ts:3352`) voids a match in these
  cases:
  - it has been paused for 7 days;
  - it is a league match, it is not in a live game, and its league match already has a result,
    i.e. the week closed (§6.2);
  - its current game room was idle-closed.

  Voiding stamps no result. It closes the waiting room with `closed: {reason: 'void'}` (the
  `RoomClosed` mechanism, `rooms.ts:1287-1289`). Games already played stay in every player's
  history, as single games.
- **Boot order:** load the match store, run the void sweep once, then `restoreRooms`. A room
  whose match is void is closed in its file on the way past, as the restore window already does
  for stale rooms (`rooms.ts:4594-4605`).

### 2.6 Recorded games, card stats, Elo

- **Every game is recorded as today.** `recordLiveGame` (`history.ts:178`) and the history
  sync record it, so card stats, the card ledger, profile W/L and achievements all see every
  game. `RecordedGame` (`server/accounts.ts:372`) gains `match?: {id, game, bestOf}`, and the
  history views label the row "Game 2 of 3".
- **Elo sees matches, never their games.** `isRated` (`rating.ts:144`) gains `if (game.match)
  return false`. `rebuildProfiles` (`accounts.ts:1105`) folds the per-game rows that are not in
  a match, plus one **match row** per decided match, all in `ratingOrder`
  (`rating.ts:173-174`). The match rows are read from finished match records: a stamped result,
  never re-derived, which is the store's standing law (`server/concession.ts`, "THE STAMP").
  - A match row is `{code: match.id, playedAt: endedAt, mode: 'constructed', finished: true,
    winner, users, rated}`.
  - The `M` prefix keeps a match id from tying with a room code in the sort.
  - **Concession weight:** a match decided by a concede in **game 1** carries that game's
    `concession`, so a Bo1 weighs exactly as a game does today (D8.5). Any later decision weighs
    `normal`, because two or more games were played.
- **CC's ladder is the constructed ladder.** `RatedMode` stays `'constructed' | 'draft'`
  (`rating.ts:52`). Whether CC should get a ladder of its own is §8 Q4.
- **No mid-match peeking.** Two doors would show a seat the opponent's deck before the match is
  over, and both close for CC:
  - `/api/replay/<code>` serves the full file, decks included, to either seat
    (`server/api-replay.ts:202-227`). It refuses a game whose match is not `over`/`void`, except
    to an admin who is not a seat.
  - A seat can open a second tab as an omniscient watcher (`main.ts:1388-1405`). Watching a
    match's room is refused to either of the match's two accounts.

---

## 3. The engine switch

### 3.1 How the flag reaches the engine

```ts
// engine/src/types.ts
export interface GameRules {
  /** CC: the printed initiative-first order for the resource, haste and deploy steps */
  sequential?: true;
  /** CC games 2–3: the seat the previous game's loser chose. The roll is still drawn. */
  initiative?: Seat;
}
// GameState, additive like `singleCard` (apply.ts:220):
sequential?: true;
```

- `createGame` gains an **eighth** optional argument, `rules?: GameRules`. So do `replay()`
  (`apply.ts:478`) and `Harness` (`engine/src/harness.ts:33`). The argument is absent on every
  existing call, so every existing deal is untouched.
- `createGame` stamps `state.sequential = true` when it is asked. **Only constructed may ask**
  (it throws otherwise), as a lesson deal does (`apply.ts:153`). From then on the engine reads
  the **state**, never the options. A state that lacks the stamp is a house-rules game, and that
  includes every log ever saved.
- **Initiative override:** `initiative: lesson?.initiative ?? rules?.initiative ?? (initRoll <
  0.5 ? 0 : 1)`. `rngNext` still runs first (`apply.ts:206-207`), so a CC game's shuffle and
  every later RNG draw are the same functions of the seed that they are today.
  - **Deal order is fine.** `dealOrder()` starts from the initiative seat (`engine.ts:16072`),
    but each constructed seat draws from its own already-shuffled deck, so choosing the
    initiative moves no card between seats.
- **Server threading.** `fresh()` and `rebuild()` (`rooms.ts:1820`, `2136`) and `dealScenario`
  (`server/scenarios.ts:505-516`) each gain a `rules` argument. **Every** call site passes the
  room's or file's own `rules`:
  - `rooms.ts`: 1980, 2088, 2505, 3495, 4118, 4175, 4233, 4674;
  - `stats.ts:366`, `cardledger.ts:398`, `replay-room.ts`, `replay-probe.ts:300`,
    `history.ts`;
  - `ui/replayserver.ts:145`, where `ReplayFile` gains `rules?`.

  A guard test scans for every call, as `server/e2e/test-custom-rules.ts` does for
  `custom?.deal`. Forgetting `initiative` deals game 2 with the wrong seat holding the
  initiative, a different game, and nothing else would notice.

### 3.2 What changes in each step (CC only)

The printed source is CR 501.4: *"In a 1v1 game, the refresh, the draw step and the draft step
happen for both players simultaneously. The resource step and the haste step are taken first by
the initiative player and then by the non-initiative player."* CR 507.3: *"In 1v1 and team games
the printed rules have the initiative team deploy first."* CR 501.4a: *"No player begins the
resource step until every player has finished the draft step."*

| step | today (house rule, D1.4/D1.5) | CC | source |
|---|---|---|---|
| Refresh | automatic | unchanged | 501.4 |
| Constructed draw 4 / bottom 2 (`startConstructedDraw`, `engine.ts:16047-16062`; `bottomCards`, `apply.ts:631-653`) | both at once | **still both at once.** It is the draw step plus the draft step, taken together (CR 901.5, 503.4), which 501.4 makes simultaneous. Which cards go back is private however the step is run: the event names only a count (`apply.ts:651`). | 501.4, 901.5 |
| Resource step | both at once, hidden; a seat that has bottomed may start before the other has (`apply.ts:3840-3853`, then `3853ff`) | Opens only when **both** have bottomed (`bottomDone === null`). INT first. NIT's resource options open when `planningDone[INT]`. | 501.4, 501.4a |
| Haste step | both at once, hidden (`startHasteStep`, `engine.ts:16262-16271`) | INT first. NIT's options open when `hasteDone[INT]`. | 501.4 |
| Deployment | both at once, hidden. `deployPlayer` is already "the initiative-ordered first seat still deploying", kept "for sequential drivers/tests" (`types.ts:2503-2509`, maintained at `apply.ts:3031`). | Only `deployPlayer` deploys. | 507.3 |
| Battle | sequential already | unchanged | D1.4c |

**One predicate per step, in `engine.ts`, read everywhere that step is gated:**

- `planning(seat)` replaces the `phase === 'planning' && !planningDone[seat]` guard at
  `apply.ts:656`, `677`, `719` and `772`, and the dispatcher arm at `apply.ts:3743`.
- `hasting(seat)` replaces the `hasteDone !== null && !hasteDone[seat]` checks at
  `apply.ts:786`, `974`, `1126`, `2127` and `3795`, and the prophecy check at
  `engine.ts:3997`.
- `deploying(seat)` (`engine.ts:16565-16567`) gains the CC clause in place. Every caller,
  including `legalActions` (`apply.ts:3749`) and `doDoneDeploying` (`apply.ts:3020-3021`), gets
  it for free.

Each predicate is its old expression `&& (!s.sequential || <CC clause>)`. The reducer
(`e.need`) and `legalActions` read the **same** predicate. Today's plays are refused and
offered in the same place (CR D1.2a), and that must stay true.

**What does not change:**

- **No new action type and no new priority window.** The INT's `donePlanning`, `doneHaste` and
  `doneDeploying` already exist, and they hand over. So `legalActions` for a state without
  `sequential` is the same list in the same order. That is the whole replay-drift argument
  (§7, Risks).
- **The NIT's clock.** It does not run during the INT's step, because `clockRunning` bills only
  a seat with legal actions (`rooms.ts:1527-1529`). Nothing in the clock changes. D3.2a ("in a
  step both players take at once, both clocks run") simply stops applying, because no such step
  exists outside the draw.
- **The phase text that would now be false.** `startDeployment` logs "Deployment: both players
  deploy at the same time — moves are revealed when everyone is done."
  (`engine.ts:16546`). In CC it says the INT deploys first. Events are not in the state
  signature, so the change is safe for `sigs`.

### 3.3 The hiding machinery switches itself off

`hiddenSegment(s)` returns `null` when `s.sequential`. Everything keyed on it then stands down
by construction, with no edits:

- the server's `segSnapshot`, `heldEvents`, `heldFrames` and recap playback
  (`rooms.ts:2143-2216`, `2760-2826`);
- `viewFor`'s `frozenOpp`, because the caller passes null outside a segment (`view.ts:148-156`,
  `191`);
- `legalForSeat` (`view.ts:538`);
- `ui/solo.ts` and `ui/replayserver.ts`;
- the decision gate (`apply.ts:348`): a decision blocks both seats, as it does in battle, which
  is the printed game;
- the timestamp re-basing (`engine.ts:2707-2721`): CC plays are stamped in the order they were
  made, which already is initiative order. CR 113.2b speaks only of "a step both players take at
  the same time".

**One split is needed.** `stepKey` and `stepLabel` (`rooms.ts:3475-3484`) use
`hiddenSegment` to **name** the sub-step for the agreed-fix rewind ("back to the start of this
step"). In CC, a null would merge the resource and haste steps into one key. So the engine
exports `planningStep(s)`, today's body of `hiddenSegment`, and `hiddenSegment(s) =
s.sequential ? null : planningStep(s)`. `stepKey` and `stepLabel` switch to `planningStep`.
Nothing else moves.

**Consequences, all intended:**

- No recap in CC. The NIT has watched the INT's step live, paced at one step a second (D5.4).
- No in-step undo. D4.1 is defined only inside a hidden segment, and the undo walks only the
  open segment's actions (`rooms.ts:2156-2158`). Whether CC wants an own-step undo is §8 Q2.
- **One leak to plug.** `deckElements`, each seat's deck element identity, is **not redacted**
  (`types.ts:2238-2243`, D6.6e). After sideboarding it would tell the opponent that your
  elements changed. In a `sequential` state, `viewFor` blanks the opponent's entry. This is
  D6.6e's "one line in server/view.ts" (`types.ts:2242`), applied to CC only. Deck **size**
  stays public, as a deck's height is at a table.

**Pacing at a handover.** When the INT finishes, the NIT's client may still be showing the INT's
last moves at D5.4's one step a second, while the NIT's clock has started. That is at most a
second or two per handover. Build no new hold unless a playtest measures it. If one is needed,
`watchHold` (`main.ts:1882-1887`) is the existing tool.

### 3.4 Games 2–3: the loser chooses

This is not an engine action. The choice is made in the between-games room (§5.2) and passed as
`rules.initiative` when that room deals. The engine needs only §3.1's override. The loser is
`other(winner)` of the previous `MatchGame`. The concede and time paths stamp a winner too
(`room.winner`, `rooms.ts:1793-1811`).

### 3.5 The CR records this needs

Numbers are allocated by the one CR agent (`data/comprehensive-rules/README.md`, "Numbering and
the ledger"). This spec allocates none. A record's `sources.owner` quote must be the
owner's **own words**, from his 2026-11-02 message. The round register's summary
(kept outside the repo) is a paraphrase and does not qualify (README, "THE
ANTI-HALLUCINATION CONTRACT" 1a).

**Amend:**

| rule | key | change |
|---|---|---|
| D1.4 | `annexd.general.hidden-segment` | "…are hidden simultaneous segments, except in Competitive Constructed (see the new CC section)." |
| D1.5 | `annexd.general.initiative-order` | the house rule now carries the CC exception: in CC the printed order of 501.4 and 507.3 holds. |
| D3.1 | `annexd.clocks.banks` | the home screen's three settings do not apply to CC, which has a fixed per-match bank. |
| D3.2a | `annexd.clocks.running.simultaneous` | true of a CC game only in the draw phase. Check the wording still holds. |
| D3.3 | `annexd.clocks.out-of-time` | in CC the player loses the **match**. |
| D3.4 | `annexd.clocks.idle-rooms` | a paused match's waiting room is not closed while the pause lasts. |
| D4.1 | `annexd.undo.hidden-step` | none needed if Q2 is "no undo" (CC has no hidden step). Otherwise a new sibling. |
| D6.6e | `annexd.reveal.public-zones.deck-elements` | in CC, the opponent's entry is not sent. |
| D8.5 | `annexd.modes.concession` | how a conceded game weighs inside a match (§2.6). |
| 113.2b | `concepts.timestamps.when.simultaneous-steps` | probably none (its own wording excludes CC). Verify. |
| 900.6 | `formats.general.digital-scope` | name CC among the client's modes. |

**New** (basis `owner` unless noted):

- *(game scope)* **The CC match.**
  - A match is one game or best of three, and the first to two game wins takes a Bo3.
  - **Game 1's initiative is random.** This is 103.1c's rule carried to constructed. *(103.1c
    is keyed `concepts.starting.live-draft.initiative`: it speaks of live draft. That no printed
    rule covers constructed is a gap to file, not to paper over.)*
  - **Later games:** the previous game's loser chooses which player has the initiative.
- *(game)* **The sideboard.**
  - At most 7 cards, and at most 2 copies of a card across main and side. This is 901.3
    extended, and it is the owner's call.
  - The sideboard is exchanged with the main deck **only between games**, in any numbers. The
    main deck stays ≥ 30 (901.2). The sideboard is not part of the game, and no effect sees it.
- *(game)* **Conceding.** Conceding a game loses that game (104.4). Conceding the match loses
  the match, at any time, between games included.
- *(game, basis `printed`)* **Sequential steps in CC.** It restates 501.4, 501.4a and 507.3 as
  binding in CC. No owner call is needed for the order itself. The owner call is only that CC
  drops D1.5.
- *(annexd)* **The match clock.**
  - 45 minutes per player for the whole match. It runs under D3.2.
  - Neither clock runs between games or while the match is paused.
  - Running out loses the match.
- *(annexd)* **The sideboard window.**
  - 120 s, or until both players are ready. What is set when it closes is what is played.
  - The opponent sees only ready or not ready.
  - The previous game's loser makes the initiative choice in the same window (§8 Q1 for the
    case where they do not).
- *(annexd)* **Pause and void.**
  - A pause is offered after a game ends and needs both players' agreement. Resuming needs both
    players present.
  - After 7 days the match closes with no result. A league match also closes at its week's end.
- *(annexd)* **No peeking.** While a match is open, its games' replays and a live watch of its
  room are refused to its players (§2.6).

Each new behavioural rule needs an executed test (contract 2). §7 assigns them.

**As built by W1 (2026-11-02).** The records are numbered: **901.9** (the CC match), **901.9a**
(the printed step order), **901.9b** (the sideboard), **901.9c** (swaps), **901.9d** (initiative),
**D4.6** (undo until Done, §3.6), **D8.6** with **D8.6a** (the match clock), **D8.6b** (the
sideboarding window) and **D8.6c** (the initiative choice at Ready); **D1.4** and **D1.5** carry the
CC exception. The owner calls quote his message and his answers of 2026-11-02 (`from: "chat
2026-11-02"`). Not drafted this round: conceding, pause and void, no peeking, the D3.x and D6.6e
amendments. Those belong with the code that does them (W3, W4, W6), which should bind its tests as
examples. The owner-only records have no executed test yet and ship marked untested until then.

### 3.6 Undo until Done — the engine contract (W1, for W3 and W6)

The owner's answer (§8 Q2) is "Undo until Done". The record is D4.6. The engine half is pure, in
`engine/src/ccundo.ts`, and test 805 pins it. Nothing in a room uses it yet.

**What can happen inside a CC step.** The owner asked whether anything inside these steps can
draw, shuffle or reveal. This was checked on 2026-11-02.

- **The resource step** has only `recycleForResource`, `activateResource`, `exchangePrismite` and
  `donePlanning`. None of them draws, shuffles or reveals. A recycle adds a card the player already
  saw to the bottom of the pile. An affinity Shard is public. Debt is paid inside the Done. So the
  resource step is always undoable back to its start.
- **The haste step and deployment** play cards and abilities, and those can draw, search,
  shuffle, glimpse, cache off a deck or look at a hand. Each of those is a barrier, and the undo
  stops there.
- **Bottoming** (draw 4 / bottom 2) is not inside any CC step. It is simultaneous, and no seat owns
  it (`sequentialStep` is null), so the walk never reaches it.

**The API.**

```ts
sequentialStep(s): { key: `${turn}:${step}:${seat}`, step: 'plan'|'haste'|'deploy', seat } | null
ccUndoMark(before, action, after, events): { key, seat, barrier, leftDecision, decide }
ccUndoFloor(marks, seat, now): number   // the earliest undoable index; marks.length = nothing
```

- `sequentialStep` gives the open CC step and the one seat taking it. It reads
  `E.planning`, `E.hasting` and `E.deploying`. It is null outside CC, outside the three steps,
  while bottoming, and at game over.
- `ccUndoMark` is computed for **every** applied action, as it lands. It is DERIVED, kept parallel
  to `room.actions` like `segSeen`, never persisted, and recomputed by `rebuild()`.
  - `barrier` is null, or one of the reasons the action stands:
    - `done`: it moved the game out of the step (a Done, a concede);
    - `other`: it is the other seat's action, which in CC is an answer to a question the step
      owner's play raised;
    - `asks`: it left a question for the other seat;
    - `fix`: an agreed fix;
    - `random`: the RNG moved;
    - `deck`: a deck or recycle pile lost a card or was reordered (a card added to the bottom does
      not count);
    - `seen`: a `glimpsed` or `revealed` event, or `seenHand` changed.
- `ccUndoFloor` returns the earliest index an undo may reach. That is the trailing run of
  `seat`'s own actions with the open step's key, back to the latest barrier.
  - It returns `marks.length` when it is not `seat`'s step.
  - If the step opened on a question (the action before it has `leftDecision`), the leading run
    of answers is the step's business and is not undoable. This is D4.1b's `segmentFloor` rule.
  - It never goes past a Done, because each Done changes the key.

**What W3 builds (server).**

1. In `applyToRoom` and `rebuild()`, push `ccUndoMark(before, a, after, events)` for every action
   in a `sequential` room.
2. Add a CC branch to `undoForSeat` for when `room.state.sequential` is set and `segKey` is null:
   - Refuse when `ccUndoFloor(...) === actions.length`.
   - Otherwise splice the **last** action. By construction it is the seat's own. Run every gate
     that already exists: `amendFloor`, `spliceable`, `undoActionAt` (whose rebuild must re-derive
     the marks).
3. Keep the measured floor as well. Run `seenBy(...)` (server/seen.ts) with
   `{ frozen: null, holding: false }` on CC step actions, which today is measured only inside a
   hidden segment. Refuse at or before the latest action that showed **either** seat a hidden
   card, because in CC both players watch every event live. The engine's `seen` and `deck`
   barriers are the cheap first line of defence, and `seenBy` is the measured one.
4. The cast-chain branch (an own pending X/cost/target stage) stays as it is.
5. Send each seat a boolean, "you can undo now" (`ccUndoFloor < len` for that seat), never the
   marks.

**What W6 builds (UI).** `ui/undo.ts` today shows the button only when `hiddenSegment(s) !==
null`. Add a CC arm that reads the server's boolean. The opponent sees the take-back on the
board as it happens. No playback or recap is involved: there is no hidden step.

---

## 4. Sideboards

### 4.1 The rule, in code: `engine/src/matchdeck.ts` (new, pure)

This lives in a new file, not in `apply.ts`, so that the deck work and the engine work never
touch the same file (§7).

```ts
export const SIDEBOARD_MAX = 7;
/** a CC registration: checkDeck on the main, then the side cap and the cross-board copy cap */
export function checkMatchDeck(main: unknown, side: unknown):
  { ok: true; main: CardName[]; side: CardName[] } | { ok: false; error: string };
/** a between-games configuration: legal, AND the same multiset as `registered` */
export function checkSwap(registered: Config, next: Config): Result;
/** a preset applied to the REGISTERED deck (§4.6), or why it cannot be */
export function applyPreset(registered: Config, p: SwapPreset): Config | { error: string };
```

- `checkMatchDeck` reuses `checkDeck` (`apply.ts:71-87`) for the pool check, the canonical
  names and main ≥ 30. It then checks `side.length ≤ 7` and the copy cap counted over
  `main ++ side`, through `canonicalCardName` so that an alias counts as its card
  (`apply.ts:63-70`).
- A Single Card Duel deck is never a CC deck.
- The engine still receives only the main deck (`createGame`'s `decks`). Nothing in
  `apply.ts` changes for sideboards.

### 4.2 The deck file (`ui/deckformat.ts`, `docs/deck-format.md`)

- `DeckFile` gains `sideboard?: DeckFileEntry[]`. `DECK_FORMAT_VERSION` goes to **2**.
  - The doc already promises that "a higher number is readable: unknown fields are ignored"
    (`deck-format.md:139`).
  - A v1 reader that sees `sideboard` on a flat file puts it in its maybeboard
    (`deckformat.ts:315`). That is a harmless degradation.
- **Reading:**
  - Our own flat file: `sideboard` → sideboard and `maybe` → maybe. The
    `deck['maybe'] ?? deck['sideboard']` fallback at `deckformat.ts:315` becomes
    algomancer-only.
  - **algomancer.cc's nested `deck.sideboard` still goes into `maybe`.** Their field predates
    sideboards here, and the doc records that people used it as a maybeboard
    (`deck-format.md:163-165`). A list over 7 cards there would also make the deck
    unregistrable. The builder moves a card with one tap. §8 Q5 can reverse this.
- `docs/deck-format.md` § "The maybeboard is not a sideboard" (`:159-165`) is **replaced**.
  "Algomancy has no sideboard" becomes:

  > `sideboard`: up to 7 cards, exchanged with the main deck between the games of a Competitive
  > Constructed match. The copy cap counts main and sideboard together. `maybe` is still a
  > shelf: no deck rule applies to it and it is never played.

  The field table at `:140-153` gains the row. The reader rule at `:181-184` says algomancer's
  `deck.sideboard` is read as `maybe`.

### 4.3 The stored deck (`server/collection.ts`)

`CollectionDeck` (`collection.ts:42`) gains two fields:

- `sideboard: CardName[]`. Absent means `[]`. Sanitize it with the same `canon` path as
  `maybe` (`:342`, `:450`, `:499`).
- `swaps?: SwapPreset[]` (§4.6).

The comment at `:47-50` loses its "NOT a sideboard — Algomancy has none" sentence. Legality is
"computed on read" (`:40-41`): add `ccLegal` (`checkMatchDeck`) beside today's legality, so a
deck can be playable casually and not in CC, or the reverse. `duplicateDeck` copies both fields
(`:563`). A shared or public deck shows its sideboard (it is part of the list, as `maybe` is)
and **never its swaps**: presets are a player's own plans. The privacy page line for `decks`
(`ui/legal.ts:103`) names sideboards and swap presets.

### 4.4 The deck API (`server/api-decks.ts`)

- `create` and `update` accept `sideboard` and `swaps` beside `maybe`
  (`api-decks.ts:48-60`).
- `import` carries a file's `sideboard` (`:114-126`).
- Nothing on the deck API refuses an illegal CC deck. A deck "may be illegal while you build"
  (`collection.ts:45`). Legality is enforced where the deck is **played** (§5.1).

### 4.5 The builder (`ui/decks.ts`, `ui/tabletop.ts`)

- `ui/decks.ts`:
  - the `Tab` union (`decks.ts:99`) and the tab list (`:1076`) gain **sideboard** between
    `maybe` and `games`;
  - its tile grid is `groupedTiles(…, 'side')`. The copy cap at `:400` counts main + side.
  - a **CC legality chip** next to the existing one;
  - a **Swaps** section under the sideboard tab (§4.6).
- `ui/tabletop.ts`:
  - a **Sideboard** pile at the table's edge, beside the Maybe pile (`tabletop.ts:20`, `:74`);
  - `TableNext` (`:60`) gains `sideboard?`;
  - pickup sources (`:94-100`) gain `{from: 'side'}`;
  - the pile header shows `n/7`, in red over 7, as the ×3 copy warning does (`:80`).
  - Every drop is a click route (docs/19 § "The tabletop deck builder"). The binder's + gains
    "to sideboard".

### 4.6 Swap presets — REMOVED 2026-11-03 (see the note at the top; kept as the record)

```ts
interface SwapPreset { id: string; name: string;     // ≤ 40 chars, ≤ 12 presets per deck
  out: CardName[];                                   // main → side (a multiset)
  in: CardName[]; }                                  // side → main (a multiset; |in| ≠ |out| is fine)
```

- **A preset is a target relative to the registered deck, never a delta on whatever is current.**
  Clicking "vs. control" sets the configuration to `applyPreset(registered, p)`. Two clicks give
  the same result as one. The preset is valid in game 3 whatever game 2 used. "Registered deck"
  is the reset button.
  - The other reading would be a delta on the current configuration. Under it a preset applied
    after a different one fails half the time, for reasons nobody could see.
- **Validity is computed, never stored.** A preset is usable iff `out ⊆ main`, `in ⊆ side`
  (multisets) and the result passes `checkMatchDeck`. A later deck edit can make it unusable.
  It is kept, and its button is disabled with the reason ("needs 2× Ignis Sprite in the main
  deck").
- On write, `sanitize` canonicalises names and drops entries that name a card in neither board.
  It does not rewrite a preset to make it valid. That would be the server deciding a player's
  plan.
- Edited on the deck's sideboard tab as one row per preset: a name, two chip lists (out and in),
  and a "set from current" button that captures the difference between the builder's main and
  side and the deck's main and side. That button is only for building presets.

---

## 5. Between games

### 5.1 Game 1

1. **Create.** The home screen's **Competitive** card (§6.1) sends the creating join with
   `mode: 'constructed'`, a new `cc: {bestOf}`, `deck`, `side` and `deckId`. It rides the join
   like `single` (`main.ts:2497-2528`).
   - The server validates with `checkMatchDeck`. A refusal gets one sentence, as a bad deck
     does today (`main.ts:2509-2511`).
   - It creates the Match (`registered[creator]`) and room 1, with `rules: {sequential: true}`
     and `match: {id, 1}`.
2. **The second player joins** with their own deck and side. `setRoomDeck` deals game 1.
3. The constructed waiting room (`renderWaiting`, `ui/main.ts:9461-9500`) shows "Competitive — Best of 3" and
   lets each seat pick a **CC-legal** deck. The picker greys an illegal one and gives the
   reason.

### 5.2 The flow

```
 game k decided ──► match decided? ──yes──► MATCH OVER (result screen, §5.5)
                         │no
                         ▼
               next room created (§2.4) ──► both clients pushed {t:'match', room}
                         │
                         ▼
   ┌────────────── BETWEEN (one screen, one 120 s window) ───────────────┐
   │ loser: "Who takes the initiative in game k+1?"  [Me] [Opponent]     │
   │ both:  sideboard panel · presets · [Ready]                          │
   │ both:  [Offer pause]      either: [Concede match]                   │
   └──────────────────────────────────────────────────────────────────────┘
        │ both Ready, or 120 s ─► lock configs ─► deal (rules.initiative) ─► game k+1
        │ pause offered + accepted
        ▼
     PAUSED ── both present + [Resume] accepted ──► BETWEEN (window restarts at 120 s)
        │ 7 days / league week end                   (configs as they were)
        ▼
      VOID (no result)
```

- **The window opens when both seats are in the room**, so a slow redirect does not cost a
  player their sideboarding. It locks 120 s later. A seat that disconnects inside the window
  does not stop it, because the window is not a chess clock and a stated default is that
  neither clock runs between games.
  - `between.until` is a stored deadline, so a restart resumes it.
  - The match sweep (§2.5) resolves it.
- **Each Ready is final until the deal.** Un-Ready while the window is open is allowed. Once
  both are Ready the deal happens at once.
- **The initiative choice must be in before the deal.** A missing answer at the lock is §8 Q1.

### 5.3 What each seat is sent (`waitingInfo(...).match`, `main.ts:1762`)

```ts
interface MatchLobbyInfo {
  id: string; bestOf: 1 | 3; game: number;           // the game about to be dealt
  score: [number, number]; names: [string, string];
  banks: [number, number];                           // frozen chess clocks, ms
  phase: 'between' | 'paused';
  chooser: Seat; initiative: Seat | null;            // public: both see the choice once made
  until: number | null;                              // the window's deadline
  ready: [boolean, boolean];                          // the ONLY thing sent about the opponent's deck
  mine: { registered: Config; current: Config; presets: SwapPreset[] };
  pause?: { offeredBy: Seat | null };
}
```

**The opponent's configuration, sideboard, presets and deck id are never in it.** The server
test in §7 W3 asserts this over the wire, as 203 does for the hidden step.

### 5.4 The sideboarding screen (`ui/match.ts`, new)

It is drawn into the waiting room when `waiting.match` is present, through the constructed
waiting room's branch in `ui/main.ts`. The match-specific DOM stays in `match.ts`, so the
12.8k-line `main.ts` gains only a dispatch.

- **Header:** score ("Game 2 of 3 — you lead 1–0"), both banks frozen, and the countdown.
- **The loser's prompt** sits above everything. Two buttons, never a default highlight (D1.2g).
  The winner sees "Rashi is choosing who takes the initiative…", and then the answer.
- **The panel:** two lists, *Main (31)* and *Sideboard (6/7)*, grouped as the builder groups
  them. **One tap moves a copy across.** No drag is needed, though drag works too
  (docs/19: "Every drop and every tap is…"). It is a touch-first screen: a 120-s window on an
  iPad cannot depend on hover or right-click.
  - A live legality line ("Main deck needs 30 — you have 29"). **Ready is disabled while the
    configuration is illegal.**
  - At the lock, an illegal configuration falls back to the **last legal one**. A player never
    starts a game with an illegal deck, and never loses one to a slow tap.
- **Presets row:** "Registered deck", then one button per preset (disabled with its reason when
  invalid, §4.6). *Removed 2026-11-03: only "Back to the registered deck" is left, sent as an
  ordinary `config`.*
- **Ready / Not ready.** The opponent shows only as a ready dot.
- **Footer:** "Offer pause" (or "Accept pause?" for the other seat) and "Concede match".

### 5.5 In game, and at the end of each game

- **Concede:**
  - `ui/inspect.ts:798` becomes "🏳 Concede game" in **every** room.
  - A CC Bo3 adds "🏳 Concede match". It sends a new socket message `{t:'concedeMatch'}`,
    not an engine action.
  - **In a game,** the server applies `{type:'concede', seat}` (so the game's log records its
    own loss as a real action) and then stamps `match.result = {how: 'conceded', concededBy}`.
  - **Between games or paused,** it stamps the result directly.
  - Both go through one function in `match.ts`, so they cannot drift.
- **"Function properly"** means that conceding a game in a Bo3 not yet decided goes on to the
  next game, as a lost game does. The single choke point is `recordFinishedGame`
  (`main.ts:1913`). It is reached by a win, a concession and a timeout alike
  (`main.ts:3087-3092`), and calls `matchGameDecided(room)` first.
- **Flag:** `expireOnTime` (`rooms.ts:1793-1811`) stamps the game as today. `matchGameDecided`
  sees `onTime` on the note and ends the match: the owner's "lose the match".
- **The post-game screen** (`ui/postgame.ts`) of a match game shows the game result, the match
  score and **Continue** in place of Rematch (`postgame.ts:254-256`). A finished match shows the
  match result and both players' game results. In a match, a rematch is a new match. "Rematch"
  opens the Competitive card, preselected, and is not wired to `createRematch`, which would
  build a casual room.
- **Clock across games.**
  - The topbar shows the carried bank.
  - Game *k*+1's room is created with `clockMs = match.banks` and `clockStart = 45 min` (the
    match's setting, for display: "of 45:00").
  - `createRoom` (`rooms.ts:2498`) takes an optional initial `clockMs`.
  - `match.banks` is written from the room's `clockMs` in `matchGameDecided`, after
    `settleClock`.

### 5.6 Reaching a match (the installed-app rule)

The owner uses the site as an installed web app, with no address bar (memory:
`every-page-has-a-button`). So **a paused or in-progress match is always one button away**:

- a **"Your matches"** row on the home screen, above the mode cards. It lists open matches
  ("vs Rashi · 1–0 · paused 2 d ago · Resume") from a new `/api/matches/mine`.
- the League page's existing **Play** button for a league match (§6.2), which opens the
  match's current room.
- the bell, which gets a "Rashi wants to resume your match" line when the other player is in
  the room. It uses the existing inbox poll (`friends-invites-and-bell`).

### 5.7 Pause and resume

- **Offer and accept** happen only in BETWEEN (the owner's "between games"). Either player
  may offer; the offer lapses if the window locks first.
- **Paused:** the room shows "Paused — resume any time before <date>" and a **Resume** button.
  Resume needs both sockets (§2.4) and both clicks. The window then restarts at the full 120 s.
  `current` configurations, `ready = [false, false]`, the initiative choice once made, the score
  and the banks are exactly as they were.
- **League:** a paused league match shows the week's end as its deadline if that comes before
  the 7 days.

### 5.8 The wire, as built (W3, 2026-11-02) — for W6

Everything below is on the existing socket. Refusals come back as `{t:'error', msg}`; every
accepted between-games op pushes both seats a fresh `update` whose `waiting.match` is §5.3's
`MatchLobbyInfo` (built in `server/match.ts`).

**Client → server**

| message | when | effect |
|---|---|---|
| `{t:'join', room, mode:'constructed', cc:{bestOf:1\|3}, deckId \| (deck, side), token}` | creating join (code from `/api/new`) | makes the match and room 1 (45-min bank, `rules:{sequential}`); registers the creator. Signed in only. `deckId` re-reads the saved deck (`matchDeckForPlay`, with its presets); without it `deck` + `side` are checked with `checkMatchDeck` and carry no presets. |
| `{t:'join', room, deckId \| (deck, side), pick: true, token}` | game 1, second seat | registers; the second registration deals game 1 (initiative rolled). Re-sending before the deal re-registers. **Only a `pick` join registers** (the waiting room's Play this deck): any other join carries the browser's casual deck and registers nothing (CT-518). |
| `{t:'join', room, token}` | games 2–3 | a deck riding on it is ignored (`takesJoinDeck` is false in a match room). The window opens once both seats are in. |
| `{t:'cc', op:'config', main, side}` | between | `checkSwap` against the registration; an illegal one is refused and the last legal one stands. Un-readies the seat. |
| ~~`{t:'cc', op:'preset', preset}`~~ | between | *Removed 2026-11-03 — refused as an unknown request.* Was: `preset` = a preset id from `mine.presets`, or `'registered'`; `applyPreset`, then as `config`. |
| `{t:'cc', op:'ready', ready:true\|false, initiative?: 0\|1}` | between | the chooser's Ready **must** carry `initiative` (an absolute seat: their own = "I take it"); the other seat's carries none. Both Ready → dealt at once. After the lock (`locked: true`) only the chooser's `ready` with `initiative` is accepted, and it deals. |
| `{t:'cc', op:'pause'}` | between, not locked | first = an offer (`pause.offeredBy`); the other seat's = agreement → `phase:'paused'`. |
| `{t:'cc', op:'unpause'}` | an offer stands | withdraw or decline it. |
| `{t:'cc', op:'resume'}` | paused | needs both sockets in the room; both must send it. The window restarts at 120 s. |
| `{t:'concedeMatch'}` | in a game, between, paused, before game 1 deals | one function (`match.ts concedeMatch`). In a game the engine concede lands first. |
| `{t:'undo'}` | a CC step of yours | **the existing message.** In a `sequential` game it takes back your last action in the open CC step (CR D4.6). The opponent gets the new board and a public "undid their last action" line. |

**Server → client, additions**

- `update`/`joined` with `waiting.match` (§5.3) plus two fields §5.3 did not have: `locked`
  (the window has locked; the deal waits on the chooser alone) and `clockStart` (the match's
  bank, for "of 45:00"). `phase` is the match's: `'game'` in game 1's registration room,
  `'between'`, `'paused'`. `ready` in game 1 means "has registered". `mine` is null until this
  seat has registered. `pause` carries `{offeredBy, pausedAt, resume:[bool,bool]}`.
- every in-game push (`baseView`) of a match room: `match: {id, bestOf, score, game, phase,
  room, result?, voided?}`, and in a CC game `ccUndo: boolean` — "you can undo now". Never the
  marks.
- `{t:'match', match: <same summary>, room: <next room code> | null}` to both seats of the game
  just decided (and of the room the match moved to) when a game ends, when the match ends
  (`room: null`, `match.phase:'over'`, `match.result`), and when it is voided. The client
  follows `room` with a plain `join` (the installed-app rule: no URL needed).
- `gameover` gains `match` (the same summary): show the score and **Continue** (to
  `match.room`) in place of Rematch. `{t:'rematch'}` in a match room is refused.
- `GET /api/matches/mine` (Bearer token) → `{ok, matches:[{id, bestOf, seat, opponent, score,
  game, phase, room, pausedAt, until, voidAt, opponentHere, resumeAsked}]}`, open matches only.
  `voidAt` is when the sweep would void it: a pause's 7 days, or a league match's week end if
  sooner (also on `waiting.match.pause.voidAt`). `opponentHere`/`resumeAsked` feed the bell's
  "<name> wants to resume your match" (CT-517).
- `{t:'watch', room, token}`: a match room is watched only by a signed-in account that is not
  one of its players, while the match is open. **The client must send `token` on `watch`.**
- `/api/replay/<code>` of a game of an open match: 404 to its players (admins who are not a seat
  still see it).

**Hooks left for W4** (`server/match.ts`): `setLeagueWeekClosed(fn)` — the sweep voids a
league match between games or paused once `fn(match)` is true; `setMatchHooks({ended})` — called
once when a match is over or void (the league report and the match row for Elo). `Match.league`
and `Match.rated` are carried onto every game room the match creates.

---

## 6. Lobby and league

### 6.1 The lobby

- A **Competitive** home card, beside Constructed (`ui/main.ts:9416`). It has a Bo1 / Bo3
  toggle (default Bo3), the deck picker filtered to CC-legal decks, and **New match**. It needs
  sign-in (§2.2). Signed out, the card says so and offers Sign in.
- **No clock picker.** The bank is `MATCH_CLOCK_MS.constructed`, the 45 minutes the owner asked
  for, and it is fixed.
- Rooms made from the lobby are **unrated**, like every link room (`rooms.ts:730-738`).
- The waiting-room header (`ui/main.ts:9493`) reads "Competitive — Best of 3 — room CODE".

### 6.2 The league

- **Format.** `LeagueFormat` gains `'competitive'`, and so does `LEAGUE_FORMATS`
  (`league-store.ts:53-54`).
  - ⚠ **`formatOf` must be rewritten.** It is `s.format === 'constructed' ? 'constructed' :
    'draft'` (`:55`), which reads `'competitive'` as **draft**.
  - The season patch at `:296` and the client's `mode: formatOf(s)` (`api-league.ts:137`,
    `:145`) carry the new value. The League page names it "Competitive Constructed, Bo3".
- **Opening.** `openLeagueRoom` (`main.ts:3297`), for a competitive season, creates the Match
  with `league` and `rated: m.week >= 1`, the same rule as today (`api-league.ts:138-140`).
  Room 1 is created by `createLeagueRoom`'s constructed branch (`rooms.ts:4284-4285`) plus
  `rules` and `match`.
  - When `m.room` is already set, **Play** opens the match's **current** room, never game 1's.
  - `matchOpened` (`api-league.ts:144`) records the match id, not a room code.
- **Result.** `recordFinishedGame`'s league branch (`main.ts:1924`) is skipped when
  `room.match` is set. When the match is decided, `match.ts` calls `leagueRecordPlayed(
  league.match, winnerUserId, finalGameCode, now, {fixed})`. `fixed` is true if any of the
  match's games took an agreed fix. `recordPlayed` is unchanged.
- **Disputes.** `flagDispute` (`league-store.ts:910-917`) refuses a code that is not
  `m.result.code`. A dispute filed from any game of the match is accepted: the match supplies its
  game codes.
- **The week's end.** `closeWeek` (`league-store.ts:741-749`) marks unplayed matches
  `deadline` and is unchanged. The match sweep then **voids** a league CC match whose league
  match now carries a result while it is between games or paused (the owner: "league matches
  also close at league-week end").
  - A game in progress at the boundary is played out. If that game decides the match, its
    result stands: `recordPlayed` already lets a played result replace `unplayed`
    (`league-store.ts:891`).
  - If it does not decide the match, the match is voided when the game ends.

---

## 7. Build split

Six workstreams, each in its own worktree (`.claude/worktrees/<name>`). In dependency order:

```
W1 engine + CR ─┐
                ├─► W3 server match ─► W4 records + league ─┐
W2 deck data ───┤                                           ├─► land in order W1 W2 W3 W4 W5 W6
                └─► W5 builder ───────────────────────────── │
                         W3 ─► W6 match screens ─────────────┘
```

W1 and W2 start at once. W5 starts when W2 is on master. W3 starts when W1 and W2 are on master.
W4 and W6 start when W3 is.

| | territory (owns) | tests | done when |
|---|---|---|---|
| **W1 Engine + CR** | `engine/src/types.ts` (`GameRules`, `sequential`), `engine/src/apply.ts` (`createGame` and `replay` argument, initiative override, the step predicates at the call sites §3.2), `engine/src/engine.ts` (`planning`/`hasting`/`deploying`, `planningStep`, `hiddenSegment`, the CC deployment message), `engine/src/harness.ts`; `server/rooms.ts` **only** `stepKey`/`stepLabel` (2 lines); `data/comprehensive-rules/rules/*.json` via the cr scripts (§3.5). It is the **only** agent that allocates CR numbers. | **800–807**: per-step CC order (bottoming simultaneous; resource gated on all bottomed; INT then NIT for resource, haste and deploy; the reducer refuses the NIT's early play with the same predicate); initiative override keeps the RNG stream (same shuffle, flipped seat); the decision gate blocks both in CC; `hiddenSegment` null and `planningStep` named; **a drift guard: every committed fixture and a fuzz sample replay byte-identical (sigs) with the change**; the CR records' examples. | A Harness CC game plays sequentially; every existing suite is green with no fixture re-pinned; `cr:check` passes. |
| **W2 Deck data** | `engine/src/matchdeck.ts` (new), `ui/deckformat.ts`, `docs/deck-format.md`, `server/collection.ts`, `server/api-decks.ts`, `server/decks.ts`, `ui/legal.ts` (the decks line) | **808–813**: `checkMatchDeck` (side cap, cross-board cap, alias counted as its card); `checkSwap` (same multiset, main ≥ 30); `applyPreset` absolute and idempotent, and stale with a reason; deck file v2 round trip, a v1 reader degrades to maybe, algomancer `deck.sideboard` → maybe; collection sanitize and duplicate carry side and swaps; a public view shows the side and never the swaps. 311 updated. | A saved deck holds a side and presets through the API, and export and import round-trip it. |
| **W3 Server match** | `server/match.ts` + `server/match-store.ts` (new); `server/rooms.ts` (`Room.match`/`rules`, persist/restore, `fresh`/`rebuild` threading at the 8 sites, `createRoom` initial `clockMs`, `takesJoinDeck` arm, `seatVerdict` CC arm, `setRoomHeld` injection in `idleDue`); `server/main.ts` (CC join, `concedeMatch`, `matchGameDecided` in `recordFinishedGame`, the sweep, the `{t:'match'}` push, `waitingInfo.match`, `/api/matches/mine`); `server/view.ts` (the `deckElements` blank); `server/api-replay.ts` and the watch refusal; `server/scenarios.ts` (`dealScenario` argument) | **814–823**: a Bo3 runs game 1→2→3 with the loser choosing and the banks carried; a flag loses the match; concede game continues and concede match ends (in game and between); the window locks at 120 s or on both Ready, with fallback to the last legal configuration; pause, restart, resume where it stood; void at 7 d; a paused room survives the idle sweep; **no wire message to a seat names the opponent's configuration, sideboard, presets or `deckElements`** (203's discipline); replay and watch refused mid-match; the `rules` threading scan (test-custom-rules' shape). | Two e2e clients play a full Bo3 through a server restart mid-pause. |
| **W4 Records + league** | `server/accounts.ts` (match rows into `rebuildProfiles`), `server/rating.ts`, `server/history.ts`, `server/stats.ts`, `server/cardledger.ts`, `server/replay-room.ts`, `server/replay-probe.ts` (the `rules` argument), `server/league-store.ts`, `server/league.ts`, `server/api-league.ts` | **824–829**: one Elo result per match, none per game; a game-1 concede weighs by D8.5, a later one is normal; card stats count every game; history rows tagged by game; a competitive season opens a match and reports once; `formatOf('competitive')`; week end voids a paused match; dispute from any game. | A league CC match moves the table once and the rating once. |
| **W5 Builder** | `ui/decks.ts`, `ui/tabletop.ts`, `ui/binder.ts` (the "to sideboard" +) | **830–833**: sideboard tab and CC chip; tabletop Sideboard pile, every drop a click route, n/7; preset editor with "set from current"; stale preset disabled with its reason. | The owner can build a 30+7 deck with two presets on desktop and iPad. |
| **W6 Match screens** | `ui/match.ts` (new), the dispatch and Competitive card in `ui/main.ts`, `ui/inspect.ts` (concede labels), `ui/postgame.ts`, `ui/replayserver.ts` (`ReplayFile.rules`), `ui/updates.ts` | **834–839**: the between screen (one tap per card, Ready disabled when illegal, presets, a ready dot only); the loser prompt with no default; pause offer, accept and resume; "Concede game" everywhere and "Concede match" in Bo3; post-game Continue; "Your matches" reachable by button (the installed-app rule); a CC replay deals with the chosen initiative. | A two-browser Bo3 through the CDP rig, including a pause. |

**Overlap left:** `server/rooms.ts` is touched by W1 (two lines) and W3. W1 lands first, and W3
rebases onto it. `ui/main.ts` is W6 only. W5 never touches it.

### Risks, worst first

1. **Replay drift for existing modes.** The fuzz walks index `legalActions`, and one added
   option or window re-rolls them (memory: `new-legal-action-drifts-fuzz`;
   `replay-drift-is-silent`). **CC-only gating avoids it by construction**, but only if three
   things hold:
   - (a) every new clause is `!s.sequential || …`, and `sequential` is absent on every non-CC
     state;
   - (b) no action type, option or push order changes (the dispatcher's push order "is
     load-bearing", `apply.ts:3725-3728`);
   - (c) `createGame` draws exactly the same RNG with no `rules`.

   W1's drift guard (800–807) replays the committed fixtures and a fuzz sample and compares
   `sigs`. It must be written to fail first, by flipping a predicate (memory: "verify by
   breaking").
2. **A deal site that forgets `rules`.** It silently deals game 2 with the wrong initiative. The
   W3 scan test is the only net. It must scan `ui/` too.
3. **Leaks.** Turning hiding off is the intent for the steps, but not for decks.
   `deckElements`, the replay file, the omniscient watch and the waiting payload are four doors.
   W3's wire test must cover all four.
4. **The match/room seam.** Two stores must agree across a restart. The boot order (§2.5) and
   one writer per field (match.ts writes the match, rooms.ts the room) keep them apart. Test
   with a kill between "game decided" and "next room persisted": the sweep must finish the job
   on boot.
5. **UI assumptions of simultaneity.** The client's planning and deploy bars were built for "both
   at once". The NIT gets an empty legal list during the INT's step, which already draws
   "Waiting for X". W6 checks every step's bar text in CC.

---

## 8. Owner's answers (2026-11-02) — settled

1. **Initiative is chosen AS the loser readies up** (owner: "Just make it a choice right before
   starting the games, as they ready up"). The previous game's loser has two Ready buttons —
   "Ready — I take the initiative" / "Ready — they take it" — so their Ready carries the choice;
   the winner has one plain Ready. The deal happens when both are Ready. If the 120 s window locks
   first, configurations lock (last legal one) and the loser is left with only the two initiative
   buttons, **untimed**; the deal happens on their click. The client never chooses for them
   (D1.2 stands, no exception). A stalling loser is ended only by the idle close / 7-day void.
2. **Undo until Done in CC.** In a CC resource, haste or deploy step, the acting player may undo
   their own actions in that step until they press Done; the opponent sees the take-back live.
   This needs a CC undo scope outside the hidden-segment machinery (today's D4.1 undo walks only
   the open hidden segment, `rooms.ts:2156-2158`): W1 owns the engine side (what an undo may
   rewind — never past a Done, never past a reveal of hidden information such as a draw, if any
   such exists inside the step; the agent must check and report), W3 the server/rewind side,
   W6 the button. A new Annex D record (sibling of D4.1) states it.
3. **Game 3 sideboarding starts from game 2's configuration**, "Registered deck" one tap away.
4. **CC moves the constructed rating** (shared ladder, today's `RatedMode`).
5. **algomancer.cc's `sideboard` still imports into maybe** (orchestrator's call, stated to the
   owner).
