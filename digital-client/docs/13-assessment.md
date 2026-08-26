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

### ③ Cards do what they print — right target, right amount, right timing. — **SAMPLED, 2026-08-26**

> **Round 28 executed §7.1.** This claim read **UNMEASURED** until then, and the
> paragraph it replaced is kept below because the reasoning still stands.

**125 of 127 clauses correct — 98.4%** — over 30 cards drawn at seed 212 from
the full 495, with exact assertions for right target, right amount, right
timing and right duration (`182-correctness-sample.test.ts`, which prints the
tally every run and re-derives the sample from the seed so it cannot be
curated after the fact).

Both failures are **one sentence on one card** (Torrential Reclamation, CT-91),
and it is a ruling question rather than an obvious bug.

**Read this number carefully, in three ways:**

1. **It is a sample, not the pool.** 30 of 495. It says the happy path is
   solid; it does not say the pool is 98.4% correct.
2. **It covers the happy path and little else.** The file's own header names
   what it does not reach: fizzle and target-loss (R86), trigger order, R118
   copies, and — the biggest hole — **the donated `[Augment]` path for ten of
   the eleven augment cards in the sample.** Only one is checked on a host, and
   "me"/"you" resolve differently there under R131. That is where the last three
   rounds' real bugs actually came from.
3. **A high number is the suspicious outcome, and §7.1 said so in advance.** It
   was hardened against itself: three assertions that turned out to be
   tautologies — reading a printed flag back out of `printed.json` — were
   rewritten as behaviour, and six were break-tested by breaking the
   implementation and watching them redden.

*The original text, still true of everything outside the sample:* Nothing in the
repository measures this pool-wide. Not "we measured it and it is bad" — for
465 of 495 cards **we have never measured it**, and that remains the honest
answer to "are the cards working as printed".

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

The remaining **38 claims across 37 cards** are named individually in
`84-card-semantics`'s `UNREACHED` with the precondition each lacks:
**BOARD 25 · CHOICE 5 · VOCAB 3 · EXTRACT 2 · REGION 1 · EVENTLESS 1.**

> ⚠ **This line was got wrong three times on 2026-08-26 (round 28), twice by
> the person correcting it. The suite now prints it, derived, so nobody
> hand-summarises it again.**
>
> As first published it read `BOARD 25 · CHOICE 6 · VOCAB 3 · REGION 1 ·
> EVENTLESS 1` — summing to **36** against a stated total of 38, with `EXTRACT`
> (Mycelial Mentor, Lurking Dread) missing entirely. A class-widening audit
> caught that and reported the partition above, which is **correct**.
>
> I then "corrected" the audit to *32 cards, BOARD 20* — and was wrong. Two
> independent scrapes of the source literal agreed on 32, and both were blind:
> the live object has **37** keys, which is what `Object.keys(UNREACHED).length`
> reports on every run. **The scrapes were confidently, reproducibly, and
> identically wrong**, which is precisely why agreement between two readings of
> the same text is not evidence — they shared the assumption, not the answer.
>
> That is `stripCode`'s failure (§5) reproduced by the author of this
> paragraph, inside the document that warns about it, while correcting somebody
> else's version of the same mistake. **The tally the suite prints has been
> right every single time.** Quote it; do not re-derive it.

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

**Round 28 added four more, and closed six of the ten above** (CT-84, CT-85,
CT-87, CT-75, and `stripCode`/`$` via R201's late register entry):

- **Eight pool-wide conformance sweeps could only see 494 of 495 cards**, and
  nothing said so. `allCardNames()` is complete only if `src/apply.ts` has been
  imported, because one of the three synthetics is registered there. The
  *determinism* test pinned the wrong number outright (`=== 494`). It mattered
  to four: `63-card-art` was hiding a real failure, `71-card-ledger`'s "no dead
  cards" clean sheet covered 494, and **`68-target-conformance`'s entry for
  `'enemyUnit'` had zero live subjects and was never once exercised** — while
  both its own comment and `apply.ts` asserted it covered that card.
- **`65-effect-conformance`'s empty-collection branch was not rare, it was
  unreachable.** Every board it drove gave each present seat a unit. Given a
  third board it convicted seven labels on its first run, before a line of card
  code changed — one of them on no ticket and in no report.
- **Two closed tickets rested on closure criteria that could not fail.** CT-70's
  read *"`SILENT_KNOWN` is empty for the R25 family"*, which is satisfiable
  while members remain; CT-64's said *"according to whatever is decided"*, which
  any outcome satisfies. The §5 pattern reaching the **closure conditions**, not
  just the checkers.
- **Twelve ruling numbers were cited in code with no entry in the register.**
  R142 forty times, R134 thirty-two. Rulings made, implemented, cited — and the
  reasoning never written down anywhere (R215).

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

> **Status after round 28 (2026-08-26).** Moves 1, 2 and 4 were executed;
> **move 3 was not, and cannot be by an agent.** Move 1 produced the number now
> in §1③. Move 2 is a standing rule and was enforced in every brief that round
> — the derived Glimpse list (5 hardcoded → 11 computed) and the derived
> `endBattleRound` call-site list are its output. Move 4 produced the four
> findings added to §5. **Move 3 remains the highest-value thing available and
> it needs the owner**, which is why round 28 ended by designing an in-client
> scenario tester: a human oracle is the only instrument that can judge a card
> the author of the test did not already understand.

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
