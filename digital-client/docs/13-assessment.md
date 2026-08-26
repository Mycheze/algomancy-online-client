# Floor and ceiling — where the client actually stands

**Written 2026-08-26, after round 27.** A standing assessment, not a round
report. The round reports live in commit messages and `card-todo.ts`; this is
the view from further back, and it is meant to be re-read and revised rather
than appended to.

Every number here is printed by the suite on every run. Re-run them before
quoting them — the whole argument below is that numbers from an unaudited
instrument are worth less than they look.

---

## 1. Three claims, in descending order of what we can back

### ① No card is dead. — **MEASURED**

490 of 491 cards reach a play window and resolve on the drill board.
`card-ledger.ts` is empty. 494 of 495 registered cards are named by a
hand-written test (the one exception is `Alluring Attribute`, a synthetic).

This is solid, it is well-evidenced, and it took months.

### ② Almost every printed promise produces evidence of the right KIND. — **PARTIAL, AND WEAKLY**

392 of 439 printed promises across 347 cards: 114/123 unconditional, 278/316
gated behind a trigger, condition, activation or `[Augment]` box.

Real progress. But "evidence of the right kind" is a far smaller claim than it
sounds — see §2.

### ③ Cards do what they print — right target, right amount, right timing. — **UNMEASURED**

Nothing in the repository measures this pool-wide.

Not "we measured it and it is bad". **We have never measured it.** This is the
honest answer to "are the cards working as printed", and it is the single most
important line in this document.

---

## 2. Why claim ② is weaker than it reads

`84-card-semantics.test.ts` states its own limit in its header, and it is worth
reading twice:

> This is a FLOOR, not a proof of correctness. A card that prints "deal 3
> damage to target unit" and deals 3 to the WRONG unit passes here.

So a card can be counted as delivering its promise while hitting the wrong
unit, for the wrong amount, at the wrong time, for the wrong duration.

**We have built a very good floor and almost no ceiling.**

---

## 3. The curve we have been climbing is flattening

Gated promises — the hard 316 — across the last four rounds:

| round | observed | never observed | gain | what it cost |
|---|---|---|---|---|
| 24 | 0 / 316   | 316 | —    | the population was counted, never checked |
| 25 | 98 / 316  | 218 | +98  | teaching the drill to pay for and fire an activation |
| 26 | 264 / 316 | 52  | +166 | building a graft host and firing trigger events |
| 27 | 278 / 316 | 38  | +14  | a whole round, eighteen agents |

The remaining 38 claims across 37 cards are named individually in
`84-card-semantics`'s `UNREACHED` with the precondition each lacks:
**BOARD 25 · CHOICE 6 · VOCAB 3 · REGION 1 · EVENTLESS 1.**

`EVENTLESS` is new and is the interesting one: *implemented, really happens, and
nothing in the game can see it happen.*

Two things follow:

- The remaining 38 are mostly **board-construction problems**, not card
  problems. Reaching them proves less per unit of effort than the first 264 did.
- The metric itself is the weak one from §2.

**We are getting expensive gains on a number that was never the point.**

---

## 4. Root causes or bandaids?

**Mostly root causes**, and the evidence is specific rather than reassuring.

Round 27 emptied **§2 of the divergence inventory** — the standing list of
everywhere the engine knowingly differed from printed text. Those eleven rows
were *genuine missing primitives*: `E.toHand`, `E.moveMod`, `E.loseRot`, a real
formation `TargetRef`, variable activation costs, a mid-resolution priority
window, per-column face-damage attribution. Each unblocked several cards. That
is the opposite of a patch.

Two agents this round **refused to build what their ticket asked for**, because
measurement showed the premise unreachable — a multiplayer bug in an engine
that is 1v1 by construction, and a combat path for an attribute no card can
have. Shipping the measurement instead of a fix is the discipline that keeps
the suite honest.

### The exception that keeps recurring

**One-card fixes for whole classes.** Report #46 (static effects) was closed
with a single-card fix and the owner filed the same class twice more (#60,
#75). It happened again this round *in our own output*: a guard shipped
hardcoded to the five reported Glimpse cards when eleven cards call
`E.glimpse()`.

We catch these now — but only because somebody goes looking, every time.

---

## 5. The real problem: the instruments, not the cards

Defects found **in the measurement system itself** over the last few rounds.
Not bugs in the game — bugs in the things that tell us whether the game works.

- **`stripCode` went blind three separate times.** No notion of a regex literal
  (one stray quote swallowed 5,128 of `engine.ts`'s 8,901 lines; all three
  bin-write sites vanished); then no notion of a line comment (927 lines of card
  files leaked back in as code); then no notion of a nested template literal
  (911 lines of `ui/main.ts` blanked). **Every sweep in the repo rests on this
  one function.**
- **A live rules bypass sat invisible to nine passing tests** — a real
  `bin.push` hidden inside a nested template left `90-coverage-census` green.
- **Six checkers in one round reported more sight than they had**, and every one
  had made a number go *up* — the direction that flatters.
- **Four `fixed` reports had guards that could never have failed** on the
  behaviour in the report. All the same shape: unit-testing the last hop with a
  hand-built input, for a report about the whole chain.
- **Every secrecy test in the engine suite is unfalsifiable** (CT-84).
  `Harness.absorb()` flattens all events into one seatless log, so a card can
  publish an opponent's entire hand and its own test passes. **Two genuine
  information leaks survived 153 test files for exactly this reason.**
- **The drill credited one card with another card's events** when a run ran out
  of steps mid-activation (CT-87), which made a broken card read as working.
- **A dead-code sweep could not match any identifier containing `$`**, because
  it built `new RegExp('\\b' + name + '\\b')` and `$` is an end-anchor. A
  function used on eight lines read as dead.
- **The client driver cannot see nested elements** (CT-75), so a class of click
  bug passes in the driver and fails in a browser. It had already produced one
  wrong ticket.
- **The server suite fails about one run in three** (CT-85), on a different test
  each time.

> **Every one of these was found by a person saying "this says clean and I don't
> believe it." Not one was found by the suite.**

That is the finding. A real share of our effort goes into verifying the
verifiers, reactively, after the fact.

This is why "we closed eleven tickets" is not by itself good news. A checker
that reports more sight than it has does not merely fail to find bugs; **it
manufactures confidence.** The numbers in this document are worth exactly what
the instruments producing them are worth, and those instruments have been wrong
repeatedly, in the flattering direction.

---

## 6. What is actually missing

**Correctness assertions that scale.** The only pattern in the repo that scales
is *deriving* tests from printed data — `109-attr-channel-conformance` builds
its rule by scraping the pool's own reminder text, so a new card is covered the
day it is added. Everything else is hand-written per card. 495 cards × several
clauses will never be hand-written, and hand-written tests are exactly the ones
that rot into unfalsifiability.

**A client testing story.** Three separate reports were presentation problems
misdiagnosed as rules problems (#15, #104, #106). One sat `by-design` for five
days on a coherent story, a real rule and a genuine owner quote — applied to
the wrong game. That is a pattern, not a coincidence.

**Multiplayer.** `createGame` builds exactly two players and two regions;
`other(seat)` is the literal `1 - seat`. Measured this round. Three- and
four-player tables are on the backlog (BL-07) and that work touches nearly
every seam above.

**Games.** 23 real games on the server, 18 with reports against them, 107
reports total — and **zero new reports during three days of work.** Reports and
reading-around-reports found the Glimpse glossary bug (stale seven days), both
information leaks, and the whole "everything is deadly" family. Sweeps found
none of them.

---

## 7. Four moves, in priority order

### 1. Change what we measure — sample for correctness

Stop pushing "promises observed". Take **thirty cards at random** and write
*exact* assertions — right target, right amount, right timing, right duration —
then count how many are actually right.

**That number is currently unknown, and it is unlikely to be 100%.** Whatever it
is, it is the honest measure of "the cards work as printed", and the failures it
surfaces will be a better work queue than the remaining 38 unreached claims.

### 2. Derive, never enumerate

Standing rule: a new guard's card list is **computed from printed data**, not
typed from the cards in the report. This round shipped a hand-typed list of five
where the pool holds eleven; with the rule in force that guard would have
covered the class the day it was written.

### 3. Play more games

The highest-value finds of the last week all trace to a report or to reading
around one. A sweep asks the question you thought to ask; a game asks the
question you didn't. Two hours of play is worth more than another agent round
against the current ticket list.

### 4. Audit the instruments on a schedule

Currently this happens by accident, when someone distrusts a clean result. Make
it a standing pass with a fixed question — *what would this checker print if it
were blind, and have we measured that it isn't?* — and require a positive
control for every observation channel.

---

## 8. What "done" would have to mean

We have never written this down, which is part of why the goal keeps feeling
unreachable. A definition we could actually test against:

1. Every printed clause has a test that **names the card and the clause**.
2. That test **provably reddens** when the clause's implementation is broken —
   demonstrated by breaking it, not assumed.
3. The checker asserting it has a **positive control** showing it can see.
4. A run of real games produces **no report of a card misbehaving**.

Against that bar we are perhaps a third of the way, and the remaining two-thirds
is **correctness work, not coverage work**.

The foundation under it is sound: no dead cards, no known missing primitives,
and a suite that grew 153 → 169 files in one round without adding a minute of
drift to the saved-game corpus.

**The reframe worth making:** we have spent months making the game *run*. It
runs. The next phase is making it *demonstrably right*, and that is a different
kind of work with a different metric — one we do not currently collect.

---

*Sources, all printed by the suite on every run: `84-card-semantics`,
`81-card-drill`, `90-coverage-census`, `card-todo.ts` (85 filed / 70 closed /
15 open), `playtest-ledger.ts` (107 reports), `digital-rules.md` (190 rulings),
`docs/09-divergence-inventory.md`. Engine suite at time of writing: 169 files,
2,719 assertions, 0 failures.*
