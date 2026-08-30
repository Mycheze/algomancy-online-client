# Algomancy — questions from round 32 (2026-08-29)

**Nothing here is new since yesterday.** Every question on this sheet was already
asked and is still blank. It exists because the open list was WRONG and I would
rather hand you a short accurate one than a long stale one.

⚠ **What I corrected before writing this.** `questions-round31.md` opened by
saying five round-27 questions were unanswered. **Four of them had already been
answered** — Q2 by **R237**, Q5 by **R238**, Q6 by **R240**, Q8 by **R239**, all
on 2026-08-28, and two of those rulings name the question by number in their own
first line. Nobody ever went back and filled in the `ANSWER:` line on the sheet,
so anything that built the open list by looking for a blank answer reported them
open. They are backfilled now, with a pointer to the ruling that settled each.

That is round 28's own Q1 lesson arriving from the other direction. Round 28
learned *"a question sheet is not proof a thing is unruled"*. This round adds:
**a blank answer line is not proof of it either.** `202-settled-rulings` checks
the first direction and structurally cannot check this one — it matches on CARD
NAMES, and all four of these rulings are about mechanics, not cards. A guard for
it is part of this round's work.

**So the real backlog is five, and here it is.**

---

## Q1. R3 is contradicted by Caleb, in his own words, repeatedly

**This is `questions-round31.md` Q8, unchanged and still the most consequential
thing on any sheet.** I am not restating the evidence — it is on that sheet in
full, with four Caleb quotes and his canonical step list. The short version:

- **R3's general half is right.** A trigger firing during damage does not, by
  itself, open a priority window. Caleb: *"There has to be a unit with swift or
  sluggish in formation."*
- **R3's worked example is exactly backwards.** It says *"between Swift damage
  and normal damage … nobody can respond."* That is the one place Caleb says a
  window **does** open: *"If swift damage happens, there is one priority window
  after it. If sluggish damage happens, there is one priority window before it."*
- **And the engine is wrong in a second, independent way.** `processTriggerQueue`
  leaves `battleMode` false while `battle.damageStep` is set, so a trigger fired
  by combat damage takes the immediate-resolve branch and **never reaches the
  stack at all**. Per Caleb and per `_passer` it should sit on the stack and be
  respondable at the start of the after-combat window. That is report **#119**,
  and on this evidence it is an engine bug rather than a rules question.

- **(a) Correct both** — amend R3's example, open the swift/sluggish windows, and
  make damage triggers reach the stack for the following window. The
  Caleb-conformant game; a real chunk of work in the combat loop.
- **(b) Fix only the stack half** — damage triggers become respondable in the
  after-combat window (closes #119); the sub-step windows get their own ticket.
- **(c) R3 stands as a deliberate divergence** — recorded like R106 and R137,
  which also overruled Caleb on purpose.

**CT-112 is blocked on this and on nothing else.**

ANSWER: The ruling is correct, but *where* the trigger goes is wrong. If there are no units in combat with sluggish or combat, there will be no triggers during the damage step. Instead, all triggers that are caused by damage get moved to "After combat", along with anything that triggers then. Here is an official RAQ ruling:

*Recorded 2026-08-30 as **R261**.*
```
Q: What is the order of effects on the stack, which result from Combat Damage ("Whenever I am dealt damage", "When I die" etc.) and resulting from "After Combat"? 

A: Since all those effects are put on the same stack at the same time, each player can decide the order of their effects. Initiative (IT) player put all of his effects on the stack first, then non-Initiative (NIT) player puts his. 
This may lead to stack like this: 
After Combat ...
When I die ...
After Combat ...
Whenever I am dealt damage ...
After combat ...
```
Both the initiative player and non-initiative player have their triggers put onto the stack during after combat and can respond to them there (I forget who's triggers are on the stack first, however. But that's in the rules and fairly clear).


---

## Q2. Does "zones follow control" reach the other three zones, or only the bin?

**R250 (yesterday) is your ruling and it is about BINS.** You said, answering Q5:

> *"The controller trashes it and it goes to their graveyard. In Algomancy,
> there's no issue with taking opponent's cards and putting them into your zones
> in the way that's not possible in other card games. The primary format (live
> draft) is a fully shared card pool."*

That reasoning plainly reaches further than bins, and three other per-seat
destinations still read `owner`. They were **deliberately left alone** and
written down in R250 rather than swept, because each one is a power change:

| route | today | if zones follow control |
|---|---|---|
| `recall` → **hand** | `opts.to ?? u.owner` | a stolen unit bounces into the **thief's** hand |
| `cacheUnit` → **cache** | same shape | a stolen unit caches into the thief's cache |
| `eraseMod` → **R65 erased pile** | `mod.owner` | the Return to Nature family follows control |

**The argument for leaving them:** the Manual says a recall goes to its *owner's*
hand, and a stolen unit recalled would bounce into the thief's hand — which is a
strictly stronger steal than "I use your unit until end of turn".

**The argument for extending:** it is your own sentence, and one seam that reads
`owner` while its neighbour reads `controller` is how a card that can finally
tell them apart gets it wrong once and quietly.

⚠ **Cosmic Reversal is not evidence either way.** Its board half passes an
explicit `to: controller` because its **printed text** says *"put them into their
controller's hands"* — a printed-text argument, which does not generalise to
`recall`'s default.

- **(a) All four follow control** — one rule, no seam.
- **(b) Bins only** — today's behaviour, and the Manual's hand rule stands.
- **(c) Split** — name which of the three go and which stay, and why.

ANSWER: **(a) All four follow control** — one rule, no seam. Only exception is that "owner" in constructed is always the person's who brought the card to the game. I don't think will ever matter, but keep it in mind.

*Recorded 2026-08-30 as **R262**.*


---

## Q3. Is a card played mid-resolution "played from your hand"?

*(carried verbatim from `questions-round27.md` Q4 — still blank)*

Four cards let you play a card during another card's resolution (Hooba-Pon,
Insidious Invitation, Spell Excavation, Tides of the Cosmos). Those plays reach
the stack properly and can be responded to — but they carry no "which zone did
this come from" marker, and never have.

That matters for **Proph** and **Stalwart Sentinel**, which print *"played from
anywhere other than your hand"*. Today they read a blank and treat it as neither
— so they fire for nobody rather than for someone.

ANSWER: I've answered this before. Those cards are still cast. It matters WHERE they come from. If the card originates in the hand, it's played from the hand. If it originates from the cache or bin or somewhere else, it's not played from the hand.

*Recorded 2026-08-30 as **R263**.*


---

## Q4. Three multipliers — 6× or 8×? And which order with an additive mod?

*(carried verbatim from `questions-round27.md` Q7 — still blank)*

R157 §23 has your formula, written while you were answering a question about
**two** Arbiters: *"quadruple it!! So always n\*2\*v"*. Taken literally that is
linear, so three Arbiters give **6×**. A purely multiplicative reading gives
**8×**. It is implemented linear and pinned by a test, so a ruling changes two
lines.

**Two separate things are open here and only one of them is the headline:**

1. **n ≥ 3.** You wrote the formula about two and the third has never been put to
   you.
2. **Composition with the ADDITIVE family is explicitly unruled** — R157 §23 says
   so itself. The interim decision, written down in `E.lifeAmount`, is
   `(v + Σdelta) × factor`: **the multiplier applies AFTER the additive mods.**
   The reason is that the other order silently turns a printed "plus 1" into plus
   2 in front of any multiplier, which is not what the card says.

ANSWER: Make it exponential.

*Recorded 2026-08-30 as **R264**.*


---

## Q5. Can "recall target ally" pick the card doing the recalling?

*(carried verbatim from `questions-round28.md` Q3 — still blank)*

**Shoreline Specter** — *"After combat, you may recall target ally."* It
currently offers **itself** as a legal target.

Consistent with the permissive steer, and with how {Ally} is scoped elsewhere.
Flagging it because "target ally" reading as "including me" is the kind of thing
that is obvious once ruled and ambiguous until then.

ANSWER: Yes, an ally includes itself. Otherwise it'd say "Another target ally". Ally = all units under your control in the current region. Enemy = all units not under your control in the current region.

*Recorded 2026-08-30 as **R265**.*


---

## Q6. "Rot cards don't have rules text yet" — which half did you mean?

**This one IS new, and it is only here because it was nearly lost.** Your answer
to `questions-round31.md` Q7 is what produced R248 and R252 last round. It ended
with two more observations, and **round 31 built from the first paragraph and
left these on the floor — nothing in any ledger captured them until today:**

> *"Not all cards are done properly anyway: Brough … `[Augment] Everything is
> balanced.` … **Balanced isn't actually in the text here.**"*
> *"**Rot cards also don't have rules text yet.**"*

**The Brough half is a straightforward bug and is being fixed this round, no
ruling needed.** The card browser attaches glossary rows off the **type line
only**, so any card that grants an attribute from its *text box* shows no rules
text for it — 12 cards for attributes, and 141 term pairs and ten whole glossary
rows overall that the browser never draws. The in-game inspector gets it right;
the browser uses the wrong one of the client's two glossary paths. (The irony:
Brough is the only card in the pool that prints a {Balanced} reminder, so R248
took **Brough's own sentence** as the game's words for {Balanced} — and now shows
it on Child of Aether while refusing to show it on Brough.)

**The Rot half splits in two and only you can say which you meant.**

- **(a) "The browser never shows it."** True and measured: 15 cards mention rot,
  the in-game inspector shows the {Rot} row on 15 of 15, the card browser / deck
  page / published-deck panel show it on **0 of 15**. Rot is a *player counter*,
  not an attribute, so the type-line attach was never going to fire. **This is
  fixed for free by the Brough fix and needs no answer from you.**
- **(b) "Replace our authored Rot sentence with the game's words."** ⚠ **There
  are none.** `231-manual-text.test.ts` pins **zero** occurrences of Rot in the
  Algomancy Manual, and because Rot is not an attribute no card prints a reminder
  for it either. The `ui/glossary.ts` row is the **only** statement of the Rot
  rule this repository has — which is already the settled policy for the 21 rows
  in that position (R252 §3). If you want the game's words here, you would have
  to write them.

So: **(a) alone**, and I close it this round? Or **(b) as well**, in which case
what should the Rot text say?

ANSWER: Rot has now been added. So this question should exist since it's answered.

*Recorded 2026-08-30 as **R267**.*


---

## Q7. Hiding the log put one announcement behind a click. Does it need its own surface?

**A cost of your own #131, found while building it — flagged rather than papered
over.** The log is now hidden by default, which is what you asked for. But the
log was also **the client's fallback surface for anything with no notice of its
own**, and one thing was relying on that.

**CT-55 / report #66** was, in your words, about putting the unused-spell-token
warning *"in front of the player who lost the tokens"*. The only surface it was
ever put on **is the game log**. The line still reaches the screen and its guard
still holds it down — but what no longer holds is the phrase **in front of**. A
player who loses tokens now has to right-click the table and choose *View game
log* to find out.

Only one other thing ever got promoted off the log for exactly this reason:
CT-78's glimpse, which was given its own `.glimpsenotice`. Nothing else was.

- **(a) Leave it.** The log is one click away and the warning is a minor case
  (a round-2 attacker who declines).
- **(b) Give this one its own notice**, the way the glimpse got one.
- **(c) Bigger: decide what a "the log is hidden, but you need to see this"
  surface is** — a toast tier — and move the handful of lines that qualify onto
  it. That is its own round, and it wants you to say which lines qualify.

⚠ Worth knowing: I did **not** invent a second surface on my own initiative,
because which announcements deserve one is a product call and getting it wrong
means either a silent loss or a client that interrupts you constantly.

ANSWER: I don't knwo what warning you're talking about, but no warnings should only exist in the log. In fact, NOTHING should only exist in the log. Everything should be clear in the UI. The log is for checking past things. So this warning about spell tokens should be in the normal warning and choice area, where all the normal buttons are.

*Recorded 2026-08-30 as **R266**.*


---

*Round 32's work list is in `client/engine/test/card-todo.ts`; the four
new reports of 2026-08-29 are ledger #131–#134 / CT-124–CT-127, and the two
recovered from your Q7 answer are CT-129 and CT-130.*
