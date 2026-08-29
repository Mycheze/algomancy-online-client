# Algomancy — questions from round 31 (2026-08-29)

**Older sheets are still open and nothing here replaces them.**
`docs/questions-round27.md` — Q2, Q4, Q6, Q7, Q8 unanswered.
`docs/questions-round28.md` — Q3 unanswered.

⚠ Before answering anything below, note the lesson round 28 wrote into its own
Q1: **a question sheet is not proof a thing is unruled.** That round re-asked a
question settled three days earlier and recommended the opposite answer, and
nothing in the repository would have objected. Both questions below were checked
against the register first; the ruling each one lands near is named.

---

## Q1. Is there a response window between a trigger going on the stack and its effect?

**Report #119** (room YFUE, 2026-08-28, seat 1):
*"I should be able to use cosmic reversal to my unit before the effect of
eminence [unit] triggers."*

What the log shows, at that moment:

```
Trigger: Eminence of the Barrens — you may pay [one] — I fight another target unit.
…
Eminence of the Barrens: … targets Leaping Lillik (Rashi's).

Resolving Eminence of the Barrens: … I fight another target unit:
Eminence of the Barrens fights Leaping Lillik.
```

The trigger goes on the stack, its target is declared, and it resolves. No
priority is handed out in between, so the owner of the targeted unit never gets
to respond to a trigger aimed at it.

**The nearest existing ruling is R198**, and it points the other way for the
sibling case: a card *played* mid-resolution "goes on the stack; the resolution
that played it finishes; **then priority is handed out with the played card
sitting there, respondable, negatable and visible with its cost already paid**."
R164 made a spell COPY a real stack item for the same reason. A trigger is the
one member of that family that has not been asked about.

- **(a) Yes — a trigger is respondable like anything else on the stack.**
  Consistent with R198 and R164, and it is what the owner expected. The cost is
  a priority round per trigger, which is what report #126 ("auto stack triggers")
  is separately asking to be able to skip — the two answers fit together.
- **(b) No — a trigger resolves without a window.** Then the client should stop
  implying otherwise, and #119 is `by-design`.

ANSWER: Yes, all triggers are respondable. And at this moment, she had priority and enough mana to cast the spell. But we think the reason the game prevented it was not cause she didn't have prio, but because it assumed the spell needed to be cast while there was a *spell effect* on the stack (despite that not being a requirement). She wanted to bounce the in play spell unit.

---

## Q2. CT-106 — should we close the `actionCount` timing leak at all?

`actionCount` is served live to both seats, so a **modified** client can see
*when* its opponent acted inside a hidden simultaneous step (haste, resource,
deployment). Measured on the real wire: 2 → 3 → 6 across one haste step. The
shipped client shows nothing; the exposure is to a client someone wrote.

This is the **only** ticket that predates this round and is still open, and its
own entry says to ask you before building — because the fix is not small. It
cannot be done in `server/view.ts` (freezing the counter jams the client's
one-intent-per-state latch); it needs a per-seat counter in `engine.ts`/`rooms.ts`,
which touches the replay and forensics stack that is keyed on action index
(**R200**).

- **(a) Build it** — accept the churn in the replay stack.
- **(b) Leave it open** and record it as a known limitation of hidden steps.
- **(c) Close it as wontfix** — the threat model (an opponent running a modified
  client against you) is not one this client defends against anywhere else.

ANSWER: Since all they get is very minimal information, I'm not worried about this.

---

## Q3. How far should the game-log rethink go? *(scope check, not a rules question)*

**Report #125:** *"the game log is too detailed. It says things that almost seem
more like the game is clarifying things to itself rather than being useful to the
players. I think the whole game log should be rethought out to be a bit more user
friendly and readable."*

I have scoped this as: **a player-facing default view, with today's output kept
behind a verbose toggle.** The reason for keeping it rather than cutting it is
that the detail is load-bearing elsewhere — `replay-room.ts` forensics run on
these lines, and several ledger entries (including #129 this round) were settled
by reading them.

⚠ And it is not uniformly too detailed. **Report #121**, from the day before,
is the opposite complaint: *"the log didn't make it seem like it looks at the
board for spell units"* — a player trying to audit what a card considered and
finding the log would not tell him. Readable is not the same as shorter.

- **(a) The toggle** — as scoped above.
- **(b) A real rethink** — decide what a log line is *for* and rewrite the
  vocabulary. Bigger, and worth its own round.

ANSWER: The toggle is fine, I think. 

---

## Q4. Cosmic Reversal — does "all other spell effects and spell units" reach the board?

**Report #121** (room YFUE, 2026-08-28): *"Does cosmic reversal correctly return
all Spell Units **that are in play**? There wasn't one here, but that was the
intention. And the log didn't make it seem like it looks at the board for spell
units..."*

**Both halves of what you noticed are correct.** Measured 2026-08-29: the card
iterates the stack and nothing else, and its "kinds" filter is a set of *stack
item* kinds. Driven directly — a Jelly (a printed Spell Unit) sitting in play,
Cosmic Reversal cast with an empty stack — the Jelly is untouched, and the log
says only *"there is no other spell effect on the stack — nothing is recalled."*
So it does not look at the board, and the log could not have told you either way.

Printed: *"Recall all other spell effects and spell units. (Negate them and put
them into their controller's hands.)"*

The evidence genuinely cuts both ways, which is why this is a question and not a
patch:

- **for the stack-only reading** — "negate them" is stack language, and you
  cannot negate a permanent that has already resolved;
- **for your reading** — *"all other spell effects"* already covers a spell unit
  sitting on the stack. Naming spell units **separately** has to be doing some
  work, and reaching the board is the only work left for it to do.

- **(a) Board too** — a spell unit in play is recalled to its controller's hand.
- **(b) Stack only** — the second noun is belt-and-braces, and #121 is `by-design`.

Two tests currently pin today's behaviour and say in as many words that they do
not bless it.

ANSWER: Yes. It returns all spell effects on the stack (anything currently on the stack with type spell goes to the owners hand) and recalls all spell units *from the board*.

---

## Q5. When a STOLEN unit dies, who trashed it — its owner, or the player who controlled it?

Surfaced by the R244 work, not reported. R244 settles that a **mod** is trashed
by the controller of the unit it sits on. But the **body** is still trashed by
`u.owner`, so after R244 a unit taken with R8-style control and then killed is
trashed **in its owner's name while its mods are trashed in its controller's**.

Nothing in the pool distinguishes the two today, so this is not currently a bug —
which is exactly why it is worth answering now rather than the first time a card
does distinguish them.

- **(a) The controller trashes it** — consistent with R244, and with "the player
  who was using it is the one who lost it".
- **(b) The owner trashes it** — today's behaviour; the card was always theirs
  and it is their bin it lands in.
- **(c) Leave it** — no card can tell, revisit when one can.

ANSWER: The controller trashes it and it goes to their graveyard. In Algomancy, there's no issue with taking opponent's cards and putting them into your zones in the way that's not possible in other card games. The primary format (live draft) is a fully shared card pool.

---

## Q6. Pass All — what should "something new is played" actually mean?

**Report #123:** *"Pass All still isn't working right."*

⚠ **This is the one report this round that was NOT fixed as reported, and the
reason is worth reading.** Room VYTV was replayed and the real release function
evaluated at every one of the game's pass windows. Around action 56, where you
filed it, the chip came off because Rashi put two items on the stack — which is
**exactly what the button promises**: *"keep passing until the battle ends or
something new is played."* Closing it on the work below would have been the same
false closure the #46 → #60 → #75 chain is made of.

Two genuine defects were found in the same code and are fixed:

- the activated-ability release clause was **empty at all 107 pass windows** of
  that game — it could not have fired on the reported behaviour at all — while
  six spell tokens and a castable card came out of resolutions and moved nothing;
- the stack clause compared **heights**, so a batch that resolved the top item
  and pushed a new one at the same height was invisible. That happened three
  times for you in that game: the chip passed through an item it had promised to
  hand back.

⚠ **But deriving the release set makes the chip notice MORE, not less.** So if
your complaint is that it stops too often, this round has made it slightly worse,
and the fix is a narrower promise — which only you can name:

1. **Should a TRIGGER count as "something new is played"?** Nobody chose to put
   it there. (Note this interacts with Q1: if triggers become respondable, they
   become worth stopping for.)
2. **Should the chip keep passing once you have said "I am done acting this
   battle"** — i.e. is Pass All "pass until something happens" or "I am out, run
   the rest of the battle"? Those are different buttons, and it may want to be
   the second one.

ANSWER: I think there need to be three options: Pass, Pass through stack, and Pass all. Pass just does a single effect resolution (as it doesn now). Pass through the stack assumes a pass is given to all effects that are currently on the stack, but gives priority if something changes. And Pass all is the assumption that the player doesn't want priority until the next phase (which will likely be deployment).

---

## Q7. Three printed reminders are NARROWER than this client, and they now win on screen

Fallout from Q-less work: report #118 asked for *"the exact reminder text provided
by the game"*, and that shipped (R248). For 15 attributes the pool prints a
reminder and the player now reads it verbatim; for the 10 that print none
anywhere, the repo's own authored rule still shows, because it is the only
statement of that rule we have.

**But three of the printed reminders disagree with how this client actually
plays**, and now that they are on screen, the client teaches something it does
not do:

| attribute | what the card prints | what the client does |
|---|---|---|
| **{Flying}** | "Only flying units can block flying units" | blocks by **column**, not by unit |
| **{Pure}** | no carve-out | has the R61 {Feeble} carve-out and a stat-layer exception |
| **{Electric}** | no path rule | the **controller picks the path**, and {Piercing} interacts |

All three generalisations are preserved in the new `rule` field and are still
asserted, so nothing is lost — the question is only what the player is shown.

- **(a) Leave it** — the printed sentence is what you asked for, and a player who
  wants the full rule can open the card browser.
- **(b) Re-edit these three** — deliberately, recorded as a divergence, the way
  R106 and R137 recorded theirs. Then {Flying} says "column" on screen.
- **(c) Show both everywhere** — printed sentence, then our rule beneath it, on
  the in-game surfaces too and not just the browser.

⚠ Worth knowing before you answer (b): re-editing means the client's reminder
text deliberately contradicts the printed card in the player's hand, which is the
thing #118 was filed about in the first place.

ANSWER: No, many of the things in the client are NOT what's printed on the card and/or in the rules. Piercing, for example, has a lot more additional rules text that OUR CLIENT added. In the "rules" and quick reference for cards, it should just be the approved rules text from the game. It's fine to maintain our wording in the backend, since it means it's easier for you (an LLM) to work with. But for humans, it's easier to just have the simplified rules text. 

Or wait, I'm wondering if we're talking about the same place. I mean when you click a card in the card browser or click the rulings of a card or open the "rules" popup. For example, here's what I see for one card:
Aetherflux Golem
1[e][e]
Golem Sprite {Virus} Unit · 1/1

[Augment] I gain +2/+2.
Virus — The one card you may augment DURING BATTLE, and only out of your hand: with priority, onto any unit in the battle’s region — yours or the enemy’s — or onto a spell on the stack, either player’s. (Rook grants the same window to hand and bin cards that are not viruses.) R79, R95, R161
Augment — A deployment action: slide it out of your hand, bin or cache under one of your own units — or, in deployment, under your own spell token. It donates its type-line attributes and its text-box [Augment] text to the host. A host that is a SPELL, on the stack, reached during battle by a {Virus}, takes the attributes only; so does a spell token. R55, R79, R89, R95

That text for "Virus" and "Augment" is OUR text. Not the games. Notice how it references R numbers and not just the stuff in the manual.

Not all cards are done properly anyway:
Brough
4[l][e]
Cosmic Unit · 0/4

[Augment] Everything is balanced. (The power and defense of balanced units are equal to the greater of the two.)
Augment — A deployment action: slide it out of your hand, bin or cache under one of your own units — or, in deployment, under your own spell token. It donates its type-line attributes and its text-box [Augment] text to the host. A host that is a SPELL, on the stack, reached during battle by a {Virus}, takes the attributes only; so does a spell token. R55, R79, R89, R95

deck
    Light & Dark (Light/Earth)
complexity
    Complex
class
    card
source
    transcribed from pre-release art, provisional 
    
    
Balanced isn't actually in the text here. 

Maybe all this extra text deserves several sub agents just to go over and rewrite them and ensure they match the rules book/text.

Rot cards also don't have rules text yet.

---

## Q8. R3 is contradicted by Caleb, in his own words, repeatedly

You said you needed to check the damage-window ruling and wondered what
Swift/Sluggish do to it. **Your instinct is right and Caleb has answered it
directly — several times, in `rules-questions`.** The evidence, so you do not
have to go looking:

**Caleb's canonical step list** (msg 23451):

```
Normal:                     Swift unit:                 Sluggish unit:
  After blocks priority       After blocks priority       After blocks priority
- Combat damage             - Swift damage              - Combat
  After combat                After swift                 Before Sluggish priority
                            - Combat                    - Sluggish damage
                              After combat                After combat
```

> **Caleb:** "Normally there's no priority inside of combat. **If swift damage
> happens, there is one priority window after it. If sluggish damage happens,
> there is one priority window before it.** So at most there will be two
> priority windows within combat." *(msg 14024)*

> **Caleb:** "there are three main priority windows: 1. after attacks 2. after
> blocks 3. after combat. you can get one more priority window if there is a
> sluggish unit in formation… **between these, everything that happens will
> enter the stack at the start of the following priority window**" *(msg 29947)*

> **Caleb:** "swift damage opens a new priority window between that damage and
> regular combat damage (same with sluggish)" *(msg 22896)*

**And your memory about death triggers is confirmed** — `_passer`, RAQ:
> "After Combat damage is done you move to 'after combat' triggers (**it will be
> the same stack as any 'when I die' resulting from combat damage**)… you can
> play on top of that stack."

Asked whether a trigger *by itself* opens a window, Caleb says no:
> **Caleb:** "Unless a unit has swift or sluggish, those open additional
> priority windows for even later possible interaction." — *"do you mean that if
> there are any effects that go on the stack… that would open up a priority
> window? Or does there have to be swift or sluggish?"* — **"There has to be a
> unit with swift or sluggish in formation."** *(msg 25834)*

### So where does that leave R3?

R3 says: *"there is **no priority window between damage sub-steps** — e.g.
between Swift damage and normal damage, the recalculated state applies but
nobody can respond."*

- **The general half is right.** A trigger firing during damage does not open a
  window. Damage and its resolution are uninterruptible.
- **The example is exactly backwards.** "Between Swift damage and normal damage"
  is the one place Caleb says a window *does* open.

### And the engine is wrong in a second, separate way

`processTriggerQueue` leaves `battleMode` false while `battle.damageStep` is
set, so a trigger fired by combat damage takes the immediate-resolve branch and
**never reaches the stack at all**. Per Caleb it should go on the stack and be
respondable **at the start of the after-combat window** — which is the window
Rashi should have had, even with no Swift or Sluggish anywhere. That is report
#119, and on this evidence it is a real engine bug rather than a rules question.

- **(a) Correct both** — amend R3's example, open the swift/sluggish windows,
  and make damage triggers reach the stack for the following window. This is the
  Caleb-conformant game and it is a real chunk of work in the combat loop.
- **(b) Fix only the stack half** — damage triggers become respondable in the
  after-combat window (closes #119), and the swift/sluggish sub-step windows stay
  unbuilt and get their own ticket.
- **(c) R3 stands as an intentional divergence** — recorded like R106 and R137,
  which also overruled Caleb on purpose.

ANSWER:
