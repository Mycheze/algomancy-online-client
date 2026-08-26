# The scenario tester — a human oracle for card correctness

**Commissioned 2026-08-26 (round 28), by the owner:**

> "Why don't you design real gameplay tests that I can just do for cards. Rather
> than scripting things, just set up actual states that I open on the server and
> try to play a card and make sure it properly functions. Cause the thing is,
> most of the cards are fairly simple and do work properly in the game. But a
> small portion that have weirder rulings or are more complex or whatever only
> come up in game."

---

## 1. Why this is not just another test file

Every test in this repository has the same ceiling, and
`84-card-semantics.test.ts` states it in its own header: **a test can only
assert what its author already believed.** The round-28 correctness sample
(`182-correctness-sample.test.ts`) is the strongest instrument we have and it
still only reaches 30 cards, only on the happy path, and only for the readings
one agent arrived at from the printed text.

The owner is the rules authority. **His "that's broken" is ground truth in a way
no assertion can be.** So this does not replace the harness — it replaces the
**oracle**. That is the missing half of `docs/13-assessment.md` §7.1 and §7.3,
and §7.3 is the one move an agent structurally cannot make:

> A sweep asks the question you thought to ask; a game asks the question you
> didn't.

It also unblocks work no fixture can reach. Of the 38 printed promises never
once observed, **25 are categorised `BOARD`** — meaning no fixture can build the
situation the clause needs. A human placing cards solves that in seconds.

---

## 2. The one architectural decision, and why it is this one

**A room's state is a function of `(seed, mode, els, decks, actions)`.** That is
what makes `replay-room.ts`, `replay-probe.ts`, the R200 divergence diff and the
whole forensic stack work. Injecting a hand-built `GameState` into a room would
break every one of them, permanently, for exactly the games we most want to be
able to re-examine.

So: **a scenario is a deterministic mutation applied inside `fresh()`, and its
id is recorded in the room file beside `seed`.**

```
Room { seed, mode, els, decks, scenario?: ScenarioId, actions }
                                ^^^^^^^^^^^^^^^^^^^^^
```

> ⚠ **This paragraph said `fresh()` is "the single choke point", and it was
> WRONG — corrected 2026-08-26 by the agent that built the slice.** `fresh()` is
> the choke point *for `rooms.ts`*. There are **four** deal sites:
> `rooms.ts::fresh()`, `replay-room.ts::runOnce()`, `stats.ts::summarizeGame()`
> and `replay-probe.ts`. Following this document as written would have left every
> scenario game **replaying, diffing and being counted on the plain opening
> board** — a silent, total divergence inside the tool built to explain
> divergences. The real choke point is `dealScenario()` in
> `server/scenarios.ts`; the first three call it, and the fourth *cannot* (it
> loads `createGame` from a worktree at a past commit), so it now **refuses a
> scenario file by name** rather than answering wrongly.
>
> Two more corrections from the same read: `phase` and `priority` in §3 cannot
> be scenario *fields* — `phase` is a consequence, not a knob. A scenario walks
> in via a **prologue of real actions** and then *declares* where it lands, and
> asserting that declaration doubles as §9's anti-rot guard.

`dealScenario()` is the choke point, and `rebuild()` reaches it — so a scenario
room rebuilds, replays, undoes, saves and diffs like any other. **A verdict is
therefore fully replayable from `(scenario id, engine SHA, action log)`**, which
is the property R200 exists to protect and the reason the existing corpus is
only ~39% usable.

⚠ The mutation must be **pure and total**: same scenario id + same engine → same
board, every time. No `Date.now()`, no unseeded randomness. `150-registration-order`
already proves why this matters: a batch importing another batch reshuffles
every deck.

---

## 3. What a scenario says

```ts
interface Scenario {
  id: string;                 // stable; cited by verdicts forever
  card: CardName;             // the card under test
  why: string;                // why THIS card is in the queue
  expect: string;             // plain English, shown on screen
  you:      { hand: CardName[]; play: Placed[]; resources: ResSpec };
  opponent: { hand: CardName[]; play: Placed[]; resources: ResSpec };
  initiative?: Seat;
  prologue?: (ids, state) => Action[];   // real actions, walked in
  phase: Phase;               // ASSERTED after the prologue, not a knob
  priority: Seat | null;      // asserted too
  handAfterPrologue?: CardName[];  // when the prologue spends a card
  needsLiveOpponent?: boolean; // see §4
}
```

> ⚠ **Corrected 2026-08-26.** The sketch above originally wrapped the two sides
> in a `board: { … }` and listed `phase`/`priority` as *inputs*. Neither is true:
> the sides sit at top level, and phase/priority are **asserted after the
> prologue** rather than set. `handAfterPrologue` was added when a scenario had
> to spend a card to reach its clause — a non-`{Virus}` `[Augment]` only ever
> attaches as a deployment action, so its donated text is unreachable otherwise.
> `186 §1` requires the declared remainder to be a **subset** of what was dealt:
> a prologue may spend, never draw, because a drawn card is seed-dependent and
> the board the owner opens would stop being the board that was tested.

`expect` is the load-bearing field. It is what lets the owner tell **"the card is
wrong"** from **"the setup is wrong"** — and that distinction is what the fourth
verdict button exists for.

---

## 4. The opponent

Most scenarios must not need a second tab. Default: a **scripted opponent that
passes and declines everything**, so the owner drives one seat and the game
moves.

`needsLiveOpponent: true` is set per scenario, for the cases that genuinely
require a second decision — blocks, responses to a play, "each player chooses".
Only then does the runner tell him to open the other seat in a new tab.

⚠ Getting this flag wrong in the *permissive* direction is the expensive
mistake: a scenario that silently needs an opponent looks like a hung game, and
a hung game looks like a bug.

---

## 5. The verdict

Four buttons, not three:

| verdict | meaning |
|---|---|
| **works** | the card did what it prints |
| **broken** | it did not |
| **slightly off** | right outcome, wrong amount / timing / wording / feel |
| **bad scenario** | the setup is wrong, or it could not be played at all |

`bad scenario` is not optional. Without it a wrong setup becomes a card bug
report, and an agent spends a round chasing it — which is exactly the failure
`docs/13-assessment.md` §6 records three times (#15, #104, #106 were all
presentation problems misdiagnosed as rules problems).

**Typing is never required to advance.** At 40 cards/hour there are ~90 seconds
per card. Optional fields: free text, the correct ruling, and — since the owner
chose one scenario per card — **a dropdown naming which printed clause was
off**, so a multi-clause card still yields clause-level precision without
multiplying the queue.

Every verdict is written to `server/verdicts.jsonl`, one line, stamped with the
scenario id, the engine SHA (R200), the room code and the action index — the
same shape as `issues.jsonl`, for the same reason.

---

## 6. The loop back — this is the point

A verdict is not a report. It is a **test**.

- **`works`** → the scenario is frozen into a permanent regression test. The
  case is pinned forever, which is what the owner asked for in round 27:
  *"Doing this with every case will ensure that edge cases get solved and stay
  solved as the game gets closer and closer to being finished."*
- **`broken` / `slightly off`** → a `card-todo.ts` entry with the scenario
  attached, and **the same scenario becomes the failing test that proves the
  fix**. No hand-built input, no unit-testing the last hop — the exact defect
  `docs/13-assessment.md` §5 lists four `fixed` reports for.

That is the difference between this and the existing 🐛 button: a bug report
tells you something is wrong once; a scenario tells you again every time the
suite runs.

---

## 7. The queue — risk-ranked, not alphabetical

495 cards at 40/hour is twelve hours, and the owner is right that most are
simple. The queue is **derived**, per `docs/13-assessment.md` §7.2, from:

1. the **37 cards** whose printed promise has never once been observed, each
   already annotated with the precondition it lacks (`84-card-semantics`'s
   `UNREACHED`);
2. the **donated `[Augment]` path** — R212 named this its single biggest hole:
   ten of eleven augment cards are only ever checked on their own body, and
   "me"/"you" resolve differently on a host under R131;
3. cards **carrying a ruling** — weird by definition, or nobody would have had
   to rule on them;
4. cards whose text has the shapes that keep producing bugs — *"that effect"*,
   *"this way"*, *"instead"*, *"for each"*;
5. the currently-open ones: Torrential Reclamation (CT-91), Shoreline Specter,
   Hand Peeper.

A first cut of the scoring puts **99 cards at score ≥ 20** and the top of the
list is almost entirely `[Augment]` cards — which is the ranking agreeing with
R212's independent finding, not a coincidence.

⚠ **The queue must not be all augment cards.** Breadth is part of the value:
interleave, so a session covers several mechanics rather than proving one.

---

## 8. Build order

**Vertical slice first.** One scenario, end to end, clickable — plumbing is the
risky part, and 20 working scenarios beat 120 unplayable ones.

1. `Scenario` type + the `fresh()` hook + room plumbing, with a test proving a
   scenario room **still rebuilds and replays byte-identically**.
2. Admin route, gated by a token, unreachable in normal play. This is a
   **public deploy** — see `digital-client/docs/05` and the backlog's BL-28.
3. The runner screen: board, `expect` line, four buttons, optional fields, next.
4. `verdicts.jsonl` + the `works` → frozen-regression-test pipeline.
5. The derived queue and the first ~25 scenarios.
6. The rest, in risk order.

---

## 9. What would make this fail

Worth writing down before building, because each has a precedent in this repo:

- **Scenarios that are wrong.** Mitigated by the `bad scenario` button and by
  the `expect` line being plain English. Expect the first batch to have duds.
- **A scenario that silently needs an opponent** (§4) — reads as a hung game.
- **Scenario rot.** A scenario naming a card that gets renamed, or a board that
  stops being legal, must fail the suite loudly. The `backlog.test.ts` pattern
  — every `touches` path is asserted to exist — is the model, and the README
  says why: it is *"the specific way a list like this rots into a text file"*.
- **Freezing a `works` verdict into a test that cannot fail.** Every frozen
  scenario needs the same treatment every guard in this round got: break the
  implementation, watch it redden, revert. A pinned scenario with no positive
  control is `docs/13-assessment.md` §5 with extra steps.
