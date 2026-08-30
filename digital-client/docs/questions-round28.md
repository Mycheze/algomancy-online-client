# Algomancy — questions from round 28 (2026-08-26)

**Read this one first: round 27's nine questions are still unanswered**, and
they are in `docs/questions-round27.md`. Nothing below replaces them. Three of
them are now blocking real work rather than merely tidying it:

| still open | why it matters more now |
|---|---|
| **Q1** — is a reveal inside a hidden simultaneous step public now, or at the barrier? | **Blocks CT-77 and CT-78 outright.** Both were left untouched this round because CT-78's own ticket says not to build before Q1 is answered. Two of the nine open tickets are waiting on one sentence from you. |
| **Q3/Q9** — does a mod erased as a COST reach the public erased pile? | The choke point is now built (`E.eraseMod`), so the answer is **one line in one place** instead of five scattered edits. See Q4 below — the scope grew. |
| **Q2** — does a `{Reaping}`-style kill rider fire when `{Deadly}` kills through an effect? | Unchanged, and it still changes how a whole attribute behaves. |

The rest of the round-27 questions cost a line each and close a ruling.

---

## Q1. Does "for each ally recalled this way" scale the sacrifice, or only the life loss?

**Torrential Reclamation** — *"Recall X target nontoken allies. Then each player
sacrifices a unit and you lose 1 life for each ally recalled this way."*

Today, with X=2, **each player sacrifices two units**. The trailing "for each"
is being applied to both halves of the sentence.

This is the **only** clause the round's 30-card correctness sample found wrong
(125 of 127 correct), so it is worth getting right rather than guessing. No
other card in the pool writes a scaled sacrifice that way — Structural Collapse
and No Hand Killer both put the scaling inline, in the clause it belongs to.

- **(a) Only the life loss scales** — the sacrifice is one unit each, always.
  My reading, and the one that matches how the rest of the pool is written.
- **(b) Both scale** — today's behaviour, and the card's own code comment says
  the distribution is deliberate.

ANSWER: **(b) BOTH SCALE** — answered 2026-08-28, recorded as **R221**.
⚠⚠ AND THIS QUESTION SHOULD NEVER HAVE BEEN ASKED. It was ALREADY RULED on 2026-08-25
as **R157 §17**: *"the card checks how many units you recalled and forces each player
to sacrifice that many units and you lose that much life"*, marked *Already correct*.
This sheet did not merely re-ask a settled question — it RECOMMENDED THE OPPOSITE
ANSWER, option (a) above. Had the owner taken the recommendation he would have
silently reversed his own ruling of four days earlier, and nothing in the repository
would have objected. Nothing checks that an open ticket or a pending question is not
re-litigating a CLOSED ruling. That gap is now CT-101, and it is worth more than the
card fix that exposed it.


---

## Q2. Torrential Reclamation at X=0 — does the second sentence still happen?

Same card, separate question, and this one may just be a bug. At X=0 the whole
spell returns early, so *"each player sacrifices a unit"* never happens at all.
The printed text does not gate the second sentence on the first.

I think this is simply wrong regardless of Q1, but it is one sentence on one
card and you may read the "this way" as binding the whole thing.

ANSWER: **THE SECOND SENTENCE STILL HAPPENS** — 2026-08-28, part of **R221**.
The owner was offered "both scale, and X=0 therefore does nothing" — which would have
closed the ticket outright — and did not take it. So the sacrifice clause is
unconditional with the scaling on top: `max(1, recalled)` rounds, life loss purely
scaled. X=0 costs every player a unit and costs the caster nothing. FIXED, and the
guard was verified by breaking it. ⚠ Read literally, R157 §17's "sacrifice THAT MANY
units" gives zero here — that seam is recorded in the card file, not smoothed over.


---

## Q3. Can "recall target ally" pick the card doing the recalling?

**Shoreline Specter** — *"After combat, you may recall target ally."* It
currently offers **itself** as a legal target.

Consistent with the permissive steer, and with how {Ally} is scoped elsewhere.
Flagging it because "target ally" reading as "including me" is the kind of thing
that is obvious once ruled and ambiguous until then.

ANSWER: **YES, AN ALLY INCLUDES ITSELF** — answered 2026-08-30, recorded as **R265**.
*"Otherwise it'd say 'Another target ally'. Ally = all units under your control
in the current region. Enemy = all units not under your control in the current
region."* Shoreline Specter was right. The general definition was the real
answer: measured across the pool, 17 of 18 ally slots offer the source and the
18th prints "another", and 0 of 154 unit-shaped slots leak across regions.


---

## Q4. Suppression Field erases real mod cards to no pile — is that in Q3's scope?

This is an **addition to round 27's Q3/Q9**, not a new question, and you should
answer them together.

While building the erase choke point I found a **second** card with the same
defect, on no ticket: **Suppression Field** removes real (nontoken) mod cards
from the game, says *"ERASES"* in its own log line, and files nothing to the R65
public erased pile. Slag Spewer is not alone.

Also worth knowing before you answer, because the engine currently contradicts
itself: **`disposeToBin` DOES put token mods on the erased pile; Ominous Growth
does not.** So "do token mods go on the pile" needs an answer too, and R133
("a token is not a card") may or may not exempt them.

ANSWER: **IN SCOPE, AND DONE** — **R219** (2026-08-26) closed this with the same
one-line seam as round-27 Q3/Q9. `E.eraseMod` files the pile, so Suppression Field was
fixed by the ruling it was reported alongside. Two deliberate exclusions are recorded
in R219 (`leavesGame: false`, and token mods).


---

## Q5. Should the haste step open when you have nothing you can actually do?

`canHaste` and `castable()` disagree, and the engine says so in its own comment
(`engine.ts:10599-10607`). Both directions happen: the haste step opens when
there is nothing playable, **and it is skipped while a card you could legally
haste sits in your hand.**

The second is the one you would report as a bug — a window you were entitled to
that never appeared. But making them agree changes **when a priority window
opens**, which is a rules-visible change, so it wants a ruling rather than a
patch.

ANSWER: **ALWAYS OFFER THE STEP** — 2026-08-28, recorded as **R224**. The step opens
unconditionally, and the "Bluff Haste" toggle asked for separately in report #109
becomes the fix rather than a new feature.
⚠ THIS QUESTION'S PREMISE WAS WRONG IN BOTH HALVES, measured 2026-08-28.
(1) Only ONE of the two directions is reproducible, and on ONE card — Eldritch
Reclaimer under Dispatch Courier. The "opens with nothing playable" direction has a
population of ZERO across all 495 cards: every candidate is `{Battle}`, and both
grantors return early on battle timing.
(2) The step ALREADY leaks. `hasteDone` is served live and public by design and the
client paints it as `ready ✓`. So always-open does not CREATE a side channel — it
removes one the client invented as an optimisation. The repo already holds the
argument against itself: `endOfHaste` fires even on the skipped path because "an
optimisation must not be observable".


---

## Q6. What should a spell do when it resolves with no legal target?

Two cards (**Luminous Arc**, **Dreadwave Devourer**) *throw* rather than fizzle
when they resolve with an empty target list. R86 fizzles first in a real game,
so this is unreachable today — but the pool almost certainly has more
`ctx.targets[0]!` sites and I would rather fix the class against a stated rule
than patch two cards.

Does an effect that reaches resolution with nothing to target: fizzle silently,
say so in the log, or is that state supposed to be impossible?

ANSWER: **FIZZLE, AND SAY SO IN THE LOG** — 2026-08-28, recorded as **R223**.
Applied to the whole COMPUTED class, not to the two cards named here. ⚠ The class is
**6× larger than this question states**: forcing an empty target list through the real
`EffectCtx` on three boards produces 42 throws across **14 effect slots on 12 cards**,
and two of those cards throw on three routes each — so a name-keyed guard would get it
wrong. The sweep that found them IS the guard (docs/13 §7.2).


---

*Round 28 closed CT-74, 75, 76, 79, 80, 81, 82, 83, 84, 85, 86 and 87 — twelve
of fifteen — and filed CT-88 through CT-93. The two it did not close (CT-77,
CT-78) are waiting on round 27's Q1. Open list and full detail in
`digital-client/engine/test/card-todo.ts`; the standing assessment is
`docs/13-assessment.md`.*
