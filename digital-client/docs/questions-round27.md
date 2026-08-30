# Algomancy — questions from round 27 (2026-08-26)

Eight questions, all thrown up by work that is already done. **Nothing here is
blocking** — every one has a defensible answer shipped and pinned by a test, so
an answer changes a line or two and a test name, not a design.

**How to use this:** type your answer on the `ANSWER:` line. "Current behaviour
is right" is a real answer and I'll record it as a ruling so nobody re-opens it.
Skip any you want to think about.

**If you only answer two:** Q1 and Q2. Q1 is the only one where I genuinely
cannot guess, and Q2 changes what six cards do.

---

## Q1. Is a reveal inside a hidden simultaneous step public NOW, or at the barrier?

Report #104 was *"Glimpse is supposed to REVEAL the cards, but opponents cannot
see them right now."* We chased it properly: replayed GYSR, then opened the game
in a real browser **as your opponent's seat**. The names are there, they render,
they're clickable. **The moment you reported is not broken.**

But there is one case that genuinely is invisible, and it's a different set of
cards from the one you played. During a **hidden simultaneous step** (deployment,
haste, resources) the server holds your opponent's copy of every event until the
barrier. So a Glimpse that happens in there is silent to them until the step ends.

**Oracle of Foretelling is always in that case** (it's a deployment card). So are
Glook, Lilbot, Visionary Construct, Maw of Despair, Seer of Empty Spaces. The
other four Glimpse cards are `{Battle}` and are never held.

- **(a) At the barrier** — today's behaviour. The hidden step is hidden, reveal
  included. Costs nothing; I write it down and close it.
- **(b) Immediately** — the card says REVEAL and means it. This needs a
  per-event exemption to the hold, and then a second decision: what escapes
  *alongside* it (the framing "resolved" line? the following "cached" line? the
  stack item?). That second decision is where the actual work is.

ANSWER: **(b) IMMEDIATELY** — answered 2026-08-28, recorded as **R222**.
*"Immediately — the card says REVEAL."* Consistent with the standing steer (printed
text wins; take the permissive reading). This is the answer that costs work: it needs
a per-event exemption to `heldEvents`, which is all-or-nothing per segment today.
⚠ The SECOND decision — what escapes ALONGSIDE the reveal — was NOT ruled on, and is
defaulted to "the `glimpsed` event and nothing else". Closes CT-77, unblocks CT-78.


---

## Q2. Does a `{Reaping}`-style kill rider fire when {Deadly} kills through an effect?

`{Deadly}` kills in combat. Through a non-combat effect it does not: the damage
path checks `{Poisonous}` first and never reaches the Deadly test — the code's
own comment admits it. Meanwhile Rotspore Herald prints *"Everything is
{deadly}"*, and you've already ruled that one literally ("Rotspore also applies
to all spells and spell tokens. Literally everything in its region").

So: **should {Deadly} kill through effect damage the way it does in combat?** I
think yes on your standing steer, but it's a real rules question and it changes
how a whole attribute behaves, so I'd rather ask than assume.

ANSWER: **YES, IT KILLS EVERYWHERE** — answered 2026-08-28, recorded as **R237**
(*"{Deadly} reaches every damage site, and {Poisonous} is a FORM of dealing damage,
not a replacement of it"*). Backfilled onto this sheet 2026-08-29 in round 32; the
ruling names this question by number.


---

## Q3. Does a mod erased as a COST reach the public erased pile?

Slag Spewer's cost is *"erase one of my mods"*. That mod currently vanishes with
a plain log line and never appears in the R65 public erased pile, where every
other erase is recorded. R157 §3 arguably wants it there. I left it as-is rather
than change behaviour on a guess.

ANSWER: **YES** — already answered 2026-08-26 as **R219**, before this sheet was
handed over. *"Obviously the card says where it should end up. It's erased… It should
just end up in the erased zone."* The same ruling fixed a second live instance nobody
had filed (Suppression Field). See Q9, which is this same question asked twice.


---

## Q4. Is a card played mid-resolution "played from your hand"?

Four cards let you play a card during another card's resolution (Hooba-Pon,
Insidious Invitation, Spell Excavation, Tides of the Cosmos). Those plays now
reach the stack properly and can be responded to — but they carry no "which zone
did this come from" marker, and never have.

That matters for Proph and Stalwart Sentinel, which print *"played from anywhere
other than your hand"*. Today they read a blank and treat it as neither.

ANSWER: **IT MATTERS WHERE THEY COME FROM** — answered 2026-08-30, recorded as **R263**.
*"Those cards are still cast. It matters WHERE they come from. If the card
originates in the hand, it's played from the hand. If it originates from the
cache or bin or somewhere else, it's not played from the hand."* Re-asked as
round-32 Q3. Three cards carried a blank marker, not four — Spell Excavation
stopped being a mid-resolution play at R197 — and a FIFTH zone had to be added
to the union: Tides of the Cosmos plays off the revealed top of the DECK.


---

## Q5. If every point of a combat hit is REPLACED, did that unit "deal combat damage"?

A Blightsea Polyp can replace a combat hit entirely. Cards that trigger on
*"when my column deals combat damage"* currently see nothing in that case.

But you've ruled the other way for `{Thieving}` and `{Lethal}` — Caleb's
2024-10-24 answer is that a replaced hit still counts as dealt. So these may be
inconsistent with your own ruling.

ANSWER: **A REPLACED HIT WAS STILL DEALT** — answered 2026-08-28, recorded as
**R238**, which gives the face-damage channel its own event. Backfilled onto this
sheet 2026-08-29 in round 32; the ruling names this question by number.


---

## Q6. Interdiction Rift's type line — still unruled

Printed `{Battle}AI Cosmic Spell`, missing the space after the marker. You
already corrected the identical defect on Might of the Grove (*"should read
'{Battle} Tree Druid Spell'"*). These two are the **only** type lines in the
whole file with `}` glued to a letter, so it's the complete set of that defect.

Confirming it lets me fix it at source with the other three, in one message to
Caleb, instead of patching it downstream forever.

ANSWER: **`{Battle} Cosmic Spell`; the `AI` is a transcription error** — answered
2026-08-28 verbatim, recorded as **R240**. The same answer commissioned a full
oracle-text typo sweep. Backfilled onto this sheet 2026-08-29 in round 32.


---

## Q7. Three multipliers — 6× or 8×?

The amount-multiplier formula is linear: `value × 2 × n`. So three Arbiters give
**6×**. A purely multiplicative reading gives **8×**. Nobody has ruled it; it is
implemented linear and pinned by a test so a ruling changes two lines.

Also unruled from the same place: how a multiplier composes with an *additive*
amount mod. Implemented as multiplier-after-additive.

ANSWER: **MAKE IT EXPONENTIAL** — answered 2026-08-30, recorded as **R264**. Three
Arbiters give ×8, not ×6. R157 §23's worked example is untouched: at n = 2 the
linear and multiplicative readings are arithmetically identical, which is why
this could sit open for so long. ⚠ THE SECOND HALF IS STILL OPEN — composition
with the ADDITIVE family was not answered, and `E.lifeAmount` keeps its interim
`(v + Σdelta) × factor`.


---

## Q8. Can a region-scoped effect reach a player who isn't in the region?

Two cards (Uglk, Big Glimpse Card) fall back to "the other seat" when they can't
find an opponent in their region — so they reach a player R25's region scoping
says isn't there. Every other card in the pool respects the region and does
nothing.

Given your steer that cards are literal and open, I suspect these two are right
and everyone else is over-narrow — but it's the reverse of how I'd normally read
R25, so I'm asking rather than picking.

ANSWER: **NO — REGION SCOPING IS ABSOLUTE, AND MY SUSPICION WAS WRONG** — answered
2026-08-28, recorded as **R239**; Uglk's `?? (1 - seat)` fallback was removed and the
whole family swept. R243 later added the other half (regions scope "all", but they do
NOT scope information). Backfilled onto this sheet 2026-08-29 in round 32.


---

*Round 27 closed CT-55, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73 and fixed two
hidden-information leaks. The open list and full detail are in
`digital-client/engine/test/card-todo.ts`.*

---

## Q9. Does a mod erased as a COST reach the public erased pile? (duplicate of Q3 — answer either)

Two agents found this independently from opposite directions, so it's worth
restating: Slag Spewer's *"Erase one of my mods"* cost really erases the mod,
announces it with a plain log line, and the mod lands on **no pile at all** —
which is the exact thing R65's public erased pile was built to prevent (your
complaint that opened it was *"there's currently no way to view erased cards"*).

Every other erase in the game files to the pile. This one doesn't, because it's
a cost rather than an effect.

If the answer is "yes, it goes on the pile", it's a one-line fix.

ANSWER: **YES** — see Q3. Both closed by **R219** (2026-08-26). Two agents found
this independently from opposite directions, which is why it was answered quickly;
the duplicate is left in place as evidence of that.
