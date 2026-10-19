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
- **Winner:** the lowest Algomancer Skill wins the week (ties go to the earlier run). One trophy.

## Scoring

```
unique   = distinct card names among the copies used
extra    = Σ over names max(0, copiesUsed(name) − 2)
cards    = unique + extra
elements = |∪ factions of the cards used|      (Skill uses max(1, elements))
turns    = state.turn when the goal is met
Skill    = cards × max(1, elements) × turns    — lower is better
```

**What counts as "used":**
- A copy counts as used when one of the **player's own actions** takes it out of their hand:
  played, cast, put under a unit (augment/graft), or spent or recycled as a cost.
- Each physical copy counts **once**, however often it is replayed. Key it by card instance
  where the engine has instance identity.
- Cards that were only drawn, or never left the deck, cost nothing.
- Spell tokens are not cards.

**Leaderboard categories:** `skill`, `unique`, `extra`, `elements`, `turns`.
- In every category lower is better.
- Ties break on skill, then on the earlier run.
- A player's entry in a category is their best run *for that category*.

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
  blurb: string; goal: Goal; seed: number }

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
  turns: number; skill: number }
export function scoreRun(acc: RunAcc): RunScore;

export type Category = 'skill' | 'unique' | 'extra' | 'elements' | 'turns';
export const CATEGORIES: Category[];
export function better(a: RunScore, b: RunScore, by: Category): boolean; // a strictly beats b

/** Replay a whole uploaded run: the full action log as the harness recorded it, both seats.
 * Every dummy action must equal dummyMove; every player action must be legal. Stops at the
 * first action that meets the goal; trailing actions are ignored. */
export function verifyRun(def: ChallengeDef, deck: unknown, actions: unknown, opts?: { maxActions?: number }):
  { ok: true; score: RunScore; actions: Action[] /* truncated at the goal */ }
  | { ok: false; error: string; at?: number };
```

### `client/server/challenges.ts` (the calendar: committed data)

- `CHALLENGES: ChallengeDef[]`, one row per week, Sundays strictly increasing.
- A week opens Sunday 07:00 UTC and closes the next Sunday 07:00 UTC.
- `weekWindow(def) → {opens, closes}` (ms).
- `currentChallenge(now)` returns the row whose window holds now, or null.
- `pastChallenges(now)` returns the closed rows, newest first.
- `challengeById(id)`.
- An env var `ALGO_CHALLENGE_NOW` (ISO date) overrides "now", for tests and dev only.

### HTTP API (`client/server/api-challenge.ts`)

| route | who | returns |
|---|---|---|
| `GET /api/challenge` | anyone | `{ now, current: ChallengeView \| null, past: ChallengeView[], mine?: Record<id, Partial<Record<Category, RunScore>>> }` |
| `GET /api/challenge/<id>/board?by=<cat>` | anyone | `{ id, by, closed, rows: BoardRow[], winner?: BoardRow }` |
| `GET /api/challenge/run/<runId>` | anyone if the week is closed; otherwise the run's owner only | `{ runId, challengeId, name, deck, actions, score, at }` |
| `POST /api/challenge/run` | signed in | body `{ challengeId, deck, actions }` → `{ ok: true, runId, score, improved: Category[], rank: Record<Category, number> }` or `{ ok: false, error }` |

```ts
ChallengeView = ChallengeDef & { opens: number; closes: number; closed: boolean;
  entrants: number; par?: RunScore }
BoardRow = { rank: number; name: string; score: RunScore; at: number;
  runId?: string; deck?: CardName[] }   // runId and deck only when closed
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
  engine}`. A score is stamped once and never recomputed.
- `weeks.json` holds the frozen results per closed week: `{closedAt, winner, top: Record<Category, BoardRow[]>}`.
  - `sweepChallenges()` (on main.ts's expiry tick, throttled) freezes each newly closed week.
  - It catches up on weeks missed while the server was down and is idempotent.

### Browser (`client/ui/challenge.ts` + a generalised `ui/solo.ts`)

- **Page:** the `?challenge` screen and a `nav-challenge` button. Every page has a button,
  because the owner uses the installed web app with no URL bar.
  - This week: goal, time left, par, my bests, the board with category tabs.
  - Past weeks: their boards, and once closed each deck with Watch and Try this deck.
- **Builder:** card search over the constructed pool and an **ordered** list (position 1 =
  top, with ↑↓ and drag). Import from a saved deck. Show what is drawn in the opening hand.
  The draft is kept per challenge in localStorage, with try/catch.
- **Play:** a `SoloServer` with `challengeDeal` and `dummyMove` for seat 1.
  - A progress meter layer: "Units in play 37 / 40 · turn 6 · cards 5".
  - Rewind and undo as in Learn to Play.
  - When the goal is met: a complete panel with the score and the categories improved, then
    submit (signed in) or a sign-in prompt (guest; the run is kept and submitted after login).
  - "Export run" downloads `{challengeId, deck, actions}` as JSON.
- **Home:** a "This week's challenge" card with the goal, time left, my best and Play.

## Reference runs

- Every calendar row has `client/server/challenge-runs/<id>.json`, shaped `{challengeId, deck, actions}`.
- Test 506 replays each one through `verifyRun` and requires `ok`.
- It proves the goal is achievable at its `n`, guards against drift, and its score is the row's `par`.
