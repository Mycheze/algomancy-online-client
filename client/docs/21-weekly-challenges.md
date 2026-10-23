# 21 — Weekly Challenges

A solo puzzle a week: build an **ordered** deck that reaches a goal ("40 units in play at
once"), scored on how little it needed. The browser plays the run; the server replays the
uploaded log, scores it itself, and ranks it. Proposed by a Discord player, adopted by the
owner 2026-10-19.

## Owner's settled choices (2026-10-19)

- **Deck:** no minimum size, no copy cap. Only the cards actually **used** count, each name
  once (**unique**). Every copy of a name beyond the 2nd adds to **extra** ("50 copies of 1
  card is worse than 2 copies each of 25").
- **Order:** always dealt exactly as arranged (index 0 on top). One fixed seed per challenge,
  so a run is a deterministic puzzle.
- **Reveal:** while a week is open the board shows names and numbers only. Decks and runs open
  when it closes.
- **Winner:** ~~the best Algomancer Skill wins the week. One trophy.~~ Superseded 2026-10-23, below.

**Changed 2026-10-21 (owner).** Skill used to be the bare product, lower better, with a board
per metric. Two runs (8·2·5 → "80", 6·2·5 → "60") read as the better run scoring lower. Now:
- **Skill is par ÷ raw × 100, HIGHER is better.** The week's reference run scores exactly 100.
- **One leaderboard, ranked by Skill only.** Fewer cards and fewer elements are both valid
  routes to a good Skill; neither is "strictly better", so no metric gets a board of its own.

**Changed 2026-10-23 (owner), after the first week's 31 runs.** One number cannot say which run
is best: elements (1 to 7) weighed as much as turns, the hardest thing to cut, and Skill hid
both turn-3 runs under a 3·2·5 one while a 12-turn 3·1·12 run scored 250. Players (Nyar, on
Discord) asked for a leaderboard per thing optimised. Now:
- **Three leaderboards, three first places, three trophies a week.** Each sorts by one metric
  and breaks ties with the other two, then the earlier run:
  - **Fastest** — turns, then cards, then elements. The page's default tab.
  - **Leanest** — cards, then turns, then elements.
  - **Purest** — elements, then turns, then cards.
- **Overall** — a fourth tab, no trophy: turns² × cards × √elements (compared exactly as
  turns⁴ × cards² × elements). Resources grow each turn, so what a run can do by turn T grows
  about like T²; elements weigh least.
- A player's entry on a board is their best run **for that board** — one player can stand on
  the boards with different runs.
- Skill and par are no longer shown. Every run still stamps `raw` and `skill` (nothing
  recomputes a stamp), and nothing ranks by them.

## Scoring

```
unique   = distinct card names among the copies used
extra    = Σ over names max(0, copiesUsed(name) − 2)
cards    = unique + extra
elements = |∪ factions of the cards used|      (raw uses max(1, elements))
turns    = state.turn when the goal is met
raw      = cards × max(1, elements) × turns    — the run's exact cost
Skill    = par ÷ raw × 100, rounded half up    — HIGHER is better (skillOf)
```

- **Par** is the row's `par` in `server/challenges.ts`: the **raw** of its reference run, so
  that run scores Skill 100. It is a committed number, not read off the reference file at
  request time — a row is a promise once its week opens, and every stamped Skill was divided
  by it. Test 506 holds it equal to what the reference run scores.
- Example: par 10·1·9 = 90. A 6·2·5 run (raw 60) shows Skill 150; an 8·2·5 run (raw 80)
  shows 113 (112.5 rounded half up). Test 539.
- Rounding in integers: `floor((200·par + raw) / (2·raw))`. A raw of 0 is read as 1.

**What counts as "used":**
- A copy counts as used when one of the **player's own actions** takes it out of their hand:
  played, cast, put under a unit (augment/graft), or spent or recycled as a cost.
- Each physical copy counts **once**, however often it is replayed. Key it by card instance
  where the engine has instance identity.
- Cards that were only drawn, or never left the deck, cost nothing.
- Spell tokens are not cards.

**The leaderboard:** one per challenge.
- Ranked by the stamped `raw` ascending — the same order as Skill descending, but exact, so
  two runs that round to the same Skill still order. Ties go to the earlier run.
- A player's entry is their best run.
- Each row shows Skill and its breakdown: cards (with the extra copies when there are any),
  elements, turns.

## The game a challenge deals

- Mode `constructed` with a `LessonDeal`.
- **Seat 0, the player:** stacked deck, 30 life, 2 prismites. Plays the **real constructed
  card step** (the same draw as any constructed game), not the lesson's `drawPerTurn`. This is
  the one new per-seat knob on `LessonDeal`.
- **Seat 1, the dummy:**
  - No cards in hand ever: opening hand 0, draws 0, Shards 0, prismites 0, life 99.
  - Its deck is `DUMMY_DECK`.
  - It acts only through `dummyMove`, the most passive legal action, a pure function of the
    state. The browser and the server use this one definition.
- **Initiative:** seat 0 holds it on turn 1, then it passes each turn as in any game.
- **The run ends** at the first action after which the goal is met. If the dummy dies, the game
  is over and the run failed. Nothing else ends it; the player can give up.

## Module contracts

### `client/engine/src/challenge.ts` (pure, imported by ui and server)

```ts
export type Goal =
  | { kind: 'unitsInPlay'; n: number }   // seat 0 controls ≥ n units at once
  | { kind: 'spellTokens'; n: number }   // seat 0 has created ≥ n spell tokens (cumulative)
  | { kind: 'unitSize'; p: number; t: number } // seat 0 controls a unit with effStats ≥ p/t
  | { kind: 'counters'; n: number }      // ≥ n +1/+1 counters placed on seat 0's units (cumulative)
  | { kind: 'unitsPlayed'; n: number };  // seat 0 has played ≥ n unit cards (cumulative)

export interface ChallengeDef { id: string; week: string /* YYYY-MM-DD, a Sunday */; title: string;
  blurb: string; goal: Goal; seed: number; par: number /* the reference run's raw */ }

export const PLAYER: Seat;            // 0
export const DUMMY: Seat;             // 1
export const DUMMY_DECK: CardName[];
export function challengeDeal(def: ChallengeDef): LessonDeal;
export function checkChallengeDeck(cards: unknown): { ok: true; cards: CardName[] } | { ok: false; error: string };
export function newChallengeGame(def: ChallengeDef, deck: CardName[]): Harness; // dealt, dummy settled
export function dummyMove(state: GameState, legal: Action[]): Action;

export interface RunAcc { /* opaque-ish: progress, used copies, elements, turn, met */ }
export function newRun(goal: Goal): RunAcc;
export function foldRun(acc: RunAcc, before: GameState, action: Action, after: GameState,
  events: EngineEvent[]): RunAcc;
export function progress(acc: RunAcc): { value: number; target: number; met: boolean };
export function goalText(goal: Goal): string;      // "Have 40 units in play at once"
export function progressLabel(goal: Goal): string; // "Units in play"

export interface RunScore { unique: number; extra: number; cards: number; elements: number;
  turns: number; raw: number; skill: number }
export function skillOf(par: number, raw: number): number;    // par ÷ raw × 100, rounded half up
export function scoreRun(acc: RunAcc, par: number): RunScore;
export function better(a: RunScore, b: RunScore): boolean;    // a strictly beats b: a.raw < b.raw

/** Replay a whole uploaded run: the full action log as the harness recorded it, both seats.
 * Every dummy action must equal dummyMove; every player action must be legal. Stops at the
 * first action that meets the goal; trailing actions are ignored. */
export function verifyRun(def: ChallengeDef, deck: unknown, actions: unknown, opts?: { maxActions?: number }):
  { ok: true; score: RunScore /* against def.par */; actions: Action[] /* truncated at the goal */ }
  | { ok: false; error: string; at?: number };
```

### `client/server/challenges.ts` (the calendar: committed data)

- `CHALLENGES: ChallengeDef[]`, one row per week, Sundays strictly increasing, each with its
  committed `par`.
- A week opens Sunday 07:00 UTC and closes the next Sunday 07:00 UTC.
- `weekWindow(def) → {opens, closes}` (ms).
- `currentChallenge(now)` returns the row whose window holds now, or null.
- `pastChallenges(now)` returns the closed rows, newest first.
- `challengeById(id)`.
- An env var `ALGO_CHALLENGE_NOW` (ISO date) overrides "now", for tests and dev only.

### HTTP API (`client/server/api-challenge.ts`)

| route | who | returns |
|---|---|---|
| `GET /api/challenge` | anyone | `{ now, current: ChallengeView \| null, past: ChallengeView[], mine?: Record<id, Record<BoardKind, { score, rank }>> }` (`mine`: the caller's best and rank on each board) |
| `GET /api/challenge/<id>/board` | anyone | `{ id, closed, boards: Record<BoardKind, BoardRow[]>, winners?: { fastest, leanest, purest } }` — all four boards at once; `winners` only once closed |
| `GET /api/challenge/run/<runId>` | anyone if the week is closed; otherwise the run's owner only | `{ runId, challengeId, name, deck, actions, score, at, verdict, partedAt, refusedAt, older? }` — see **Watch** |
| `POST /api/challenge/run` | signed in | body `{ challengeId, deck, actions }` → `{ ok: true, runId, score, improved: boolean, newBest: BoardKind[], ranks: Record<BoardKind, number> }` or `{ ok: false, error }` |

```ts
BoardKind = 'fastest' | 'leanest' | 'purest' | 'overall'   // engine challenge.ts, compareScores
ChallengeView = ChallengeDef & { opens: number; closes: number; closed: boolean;
  entrants: number }                    // par: the row's committed number
BoardRow = { rank: number; name: string; score: RunScore; at: number;
  runId?: string; deck?: CardName[];    // runId and deck only when closed
  older?: true }                        // see Watch: "played on older rules"
```

**How a POST is handled:**
- It is verified in a `worker_threads` worker, **never on the main loop**. A long run replays
  thousands of actions at about 5 ms each, and doing that on the main loop would freeze every
  live game.
- Caps: deck ≤ 200 cards, actions ≤ 20000, a body-size cap, and one verification in flight
  per user.
- A run submitted to a past week is recorded and ranked on that week's board, but it can't
  move a frozen winner.

**Storage** (`var/challenges/`, path getter in `server/statepaths.ts`):
- `runs.jsonl` is append-only: `{runId, challengeId, user, name, at, deck, actions, score,
  engine}`. A score is stamped once and never recomputed; the boards rank its `cards`,
  `elements` and `turns` (it also carries `raw` and `skill`, which nothing shows since
  2026-10-23).
- `weeks.json` (`version: 3`) holds the frozen results per closed week: `{closedAt, frozenAt, boards: Record<BoardKind, BoardRow[]>}`, the top ten of each; a trophy board's winner is its first row. No week froze under version 2, and an older file is not read (the sweep refreezes from `runs.jsonl`).
  - `sweepChallenges()` (on main.ts's expiry tick, throttled) freezes each newly closed week.
  - It catches up on weeks missed while the server was down and is idempotent.
- `sigs.jsonl` is append-only: `{runId, engine, sigs}` — the board's fingerprint after every
  action of the run (`digest(signature(state))`, BL-38's), written by the verifier at
  submission and by the backfill tool for older runs. The first line for a run wins; a
  fingerprint is never recomputed. It is its own file because `runs.jsonl` is never rewritten.

### Watch (added 2026-10-23)

Watch replays a stored run on the **live** engine, so after a rules change it can play a
different game. Owner, 2026-10-23: "Fingerprints + banner".
- `server/challenge-sigs.ts` `walkRun` is verifyRun's walk with a per-action fingerprint (its
  `onStep` hook); past where verifyRun stops it goes on as Watch does, a refused action
  leaving `''`.
- `server/challenge-resim.ts` walks a stored run again on this engine **in the verifier
  worker** (lanes: a submission first, then a Watch, then background work), cached per run per
  engine, and compares against `sigs.jsonl`:
  - `as-recorded` — every recorded fingerprint reproduced; `reconstruction` from `partedAt`, the
    first one that is not; `unverified` — the run has no fingerprints. `refusedAt` is the first
    action this engine refuses. The replay bar (`ui/replaybar.ts`) shows these as for BL-38.
  - A run stamped with the live engine is not walked again: as-recorded if fingerprinted,
    unverified if not.
- **The board mark** (owner, 2026-10-23: "Flag it, still ranked"). A run is marked `older` when
  it no longer reproduces *materially* on the live engine: it no longer verifies (an action
  refused, the dummy's move changed, the goal not met), or it meets the goal at another action,
  or for another score. Its score and rank stand. A cosmetic parting (the board differs, and the
  run still verifies to the same score at the same action) is a reconstruction for Watch and is
  **not** marked. The board answers from the cache and never waits: an unworked run is queued in
  the background lane and is unmarked until it has been. The page shows "played on older rules",
  with the reason on hover.
- **Backfill** (`server/challenge-sigs-backfill.ts`): runs verified before fingerprints were
  kept get them from a checkout of the engine they were stamped with — only runs stamped with
  that engine, only runs it reproduces (verifies, same goal action, same score), idempotent.

### Browser (`client/ui/challenge.ts` + a generalised `ui/solo.ts`)

- **Page:** the `?challenge` screen and a `nav-challenge` button. Every page has a button,
  because the owner uses the installed web app with no URL bar.
  - This week: goal, time left, one line "Three first places: fewest turns, fewest cards,
    fewest elements.", my best and rank on each board, the Leaderboard: tabs Fastest (default)
    / Leanest / Purest / Overall, the sorting column bold, each tab's order in a line under it.
  - Past weeks: their leaderboards (the same tabs, and a "Winners ·" line), and once closed
    each deck with Watch and Try this deck.
- **Builder:** the challenge page shows the deck as a summary (its rows numbered by position,
  the Turn-1 hand, Import from a saved deck, Clear, one Undo, Play) and a **Build on the table**
  button (`ch-tabletop`). The order is built on the tabletop page (`ui/tabletop.ts`, host kind
  `challenge`, `?table=ch:<id>` on a reload):
  - a **scratch table** on top: piles of cards being considered, **not** in the deck, kept in
    this browser only (`algoChallengeTables`); the page says so in one line;
  - the **deck strip** below (`ui/deckstrip.ts`): one card per copy, left to right = top to
    bottom, a position under every card. The Turn-1 hand is bracketed, and the bracket is the
    engine's answer — the hand of a game dealt by `newChallengeGame` (`openingHand`), never
    re-derived;
  - the binder of every card down the right. Drag binder → strip to insert a card at the gap
    you let go in (its `+` adds at the bottom); strip → strip to reorder; scratch ↔ strip to move
    a card into or out of the deck; strip → binder to cut. Every drag has a tap route: tap a card
    to pick it up, then tap the card it goes before, the strip past the last card (the bottom),
    a pile, or the bar's New pile / Cut.
  - Drops go through the tabletop's one door (`place()`); the strip's cards belong to its one drag
    provider, so Firefox's own image drag is cancelled for them like every table card.
  The draft is kept per challenge in localStorage (`algoChallengeDecks`), with try/catch, and
  so is the scratch table. Verified with real input in Firefox (WebDriver BiDi) and Chrome (CDP
  mouse, and touch emulation at 1024×768): every strip drop lands where it was let go and is
  drawn in front, and Play deals exactly the bracketed hand.
- **Play:** a `SoloServer` with `challengeDeal` and `dummyMove` for seat 1.
  - A progress meter layer: "Units in play 37 / 40 · turn 6 · cards 5".
  - Rewind and undo as in Learn to Play.
  - When the goal is met: a complete panel with the Skill and its breakdown, whether it is a
    new best and the rank, then
    submit (signed in) or a sign-in prompt (guest; the run is kept and submitted after login).
  - "Export run" downloads `{challengeId, deck, actions}` as JSON.
- **Home:** a "This week's challenge" card with the goal, time left, my best and Play.

## Reference runs

- Every calendar row has `client/server/challenge-runs/<id>.json`, shaped `{challengeId, deck, actions}`.
- Test 506 replays each one through `verifyRun` and requires `ok`.
- It proves the goal is achievable at its `n`, guards against drift, and requires its `raw` to
  equal the row's committed `par` (so it scores Skill 100).
- Pars: crowd 90, tokens 104, giant 100, counters 81, parade 286.
