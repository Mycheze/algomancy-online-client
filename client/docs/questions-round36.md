# Algomancy — questions from round 36 (2026-09-01)

Three questions, none of them new, all of them blocking real work that is
otherwise ready to start. Round 36 itself has produced no rules question so far;
if it does, it will be appended below with the evidence attached.

⚠ **Checked against the register before writing, per round 31's lesson.**
`questions-round31.md` opened by listing five questions as open when four had
already been ruled the day before, because nothing had backfilled the `ANSWER:`
lines. So each question below was grepped against `docs/digital-rules.md` first:
"spectator", "password reset", "no email", "mixed-allegiance" and
"supposed to be an ally" appear nowhere in the register. These three really are
unanswered.

The standing pair of lessons, restated so the next sheet does not need to
re-learn them: **a question sheet is not proof a thing is unruled** (round 28
Q1), and **a blank answer line is not proof of it either** (round 32). Check the
register, not the sheet.

---

## Q1. Spectators: seat-by-seat, or omniscient?

**BL-29.** This is the whole build, not a detail — it decides the data model
before a line is written, so nothing on this entry can start until you answer.

Does a spectator see the game **seat by seat**, with each side's hidden
information still hidden — which is exactly what `server/view.ts`'s `viewFor()`
already produces, so it costs nearly nothing — or an **omniscient broadcast**
view showing both hands?

⚠ The thing worth your attention rather than mine: an omniscient LIVE view is a
cheating vector the moment a spectator can talk to a player. Everywhere else
that ships one solves it with a delay, and a delay is a decision with a number in
it, not a default I should pick for you.

If the answer is "omniscient, with a delay", I need the delay.

ANSWER: Just omniscient and live is fine for now

---

## Q2. How is "supposed to be an ally" DERIVED?

**BL-30**, and your own words for what you want:

> "it might be nice to add a small warning if they select two of their own units
> (Did you mean to target allies with this spell?)"

A warning, not a legality change — that half is clear and R74 already has the
precedent for warned-but-legal. What is not clear is how the client KNOWS.

You named Fight and Organic Exchange. But the rule has to come out of the card
data, or it is a hand-typed list of two cards that goes stale the day a third is
printed — and this repo has been bitten by exactly that shape more than once.
I can see three ways and they are materially different work:

1. **It is derivable from the printed text** and I have not found the pattern.
   If you can say what the two cards have in common *as printed*, that is the
   answer and it generalises for free.
2. **It needs a new facet in the printed data** — a field saying "this spell's
   targets are meant to be split across sides". Honest, but it is a data change
   and someone has to fill it in for the whole pool.
3. **It is an explicit accepted list** maintained by hand, with a test that
   makes its staleness loud.

⚠ **The false-positive case is the entire risk.** A warning that fires when you
*deliberately* aim a Fight at two of your own units is worse than no warning,
because you will learn to click through it and then it protects nothing.

ANSWER: I think it's derivable. Anything that says target ally AND target unit on the same card. That implies there is a difference in the units being chosen. Just choosing two targets or two allies is clear and easy. Just choosing a single target too. But if a card calls out "one ally, one *other* target", it is almost always going to be one ally and one enemy.

---

## Q3. No email means no password reset. What happens when someone forgets?

**BL-16**, and this one has never been put to you at all — it was not among the
29 questions in the 2026-08-25 interview, and the backlog entry flags it as
unraised rather than answered.

The account store keeps a username and a scrypt password hash. There is no email
address anywhere, which is a deliberate and good privacy property — it is what
BL-15's privacy page will say in as many words. But it means a forgotten password
is **unrecoverable**, and on a public deploy that will happen in the first week.

The options, as I see them:

1. **Nothing.** Forgotten is gone; make a new account. Honest, zero code, and
   the account is only a name and some game history — say so plainly at
   registration so nobody is surprised.
2. **A recovery code** shown once at registration, which the player keeps. No
   email, no reset flow, still recoverable.
3. **An admin reset** through BL-16's panel — you do it by hand, on request.
   Fine at small scale, and it does not scale.
4. **Optional email**, which reintroduces the thing you deliberately did not
   want and changes what the privacy page has to say.

I would build (1) plus a clear line at registration, and add (3) when the admin
panel exists — but this is a product decision about your users, not a technical
one, and the privacy page BL-15 ships today has to state whichever answer you
give.

ANSWER: 1 is fine. It'd basically be the same as a recovery code. If it becomes a problem and people start to use it more, we can reevaluate. Just make sure to tell people when they're making an account. DO NOT FORGET YOUR PASSWORD, THERE IS NO PASSWORD RESET.

---

## Q4. Which clock banks should the home screen offer?

**BL-26**, and this one is genuinely small — I only need it because the answer is
a list of numbers a player sees, and I should not pick your defaults for you.

The clock is now a real per-room setting: chosen when the room is created,
persisted, inherited by a rematch, and visible to both seats before the first
action. The server validates it as a **range** — anything from 1 second to 6
hours, plus **off** — rather than a fixed list, so this question is purely about
what the picker shows.

My placeholder is **Off · 10m · 20m · 30m · 60m (default) · 90m**.

1. Is that the right set?
2. Should **Off** sit in the row like the rest, or be tucked away? It is the one
   choice that changes what a game *is* now that running out loses.
3. Related, and worth deciding at the same time: **should a clockless room count
   for rating** (BL-02) at all? With BL-27 landed, only a clocked game can end in
   a loss on time; a clockless one where somebody walks away still lands as an
   abandonment, which you have already said should "just not count". So a
   clockless rated game is the one place BMing survives.

⚠ The 60-minute default is unchanged and I have not touched it — you raised it
from 40 on 2026-08-20 after a draft game ran out, and that is recorded as
already-decided.

ANSWER: Let's do: 45m (default for constructed), 60m (default for live draft) and allow the clock to be turned off when doing room settings, for friendly games. 

Oh and by the way, I wanted to have a global match timer/thing so that you can see how long a game took (literal time passed, not double counting time when each player is acting). And saving this along with the games to be able to track average time to see if the chess clocks aren't set too high/low. 

---

## Q5. "Hold priority" — did you mean the literal line, or the MTGO thing?

**BL-18.** Its `doneWhen` says:

> You can cast a second spell in response to your own first without the window
> closing

Building full control turned up that **those are two different features**, and
only one of them is a client change.

**What the line literally says is already true**, and is now pinned by a test:
you cast, the opponent gets a look, priority comes back to you, and your first
spell is **still on the stack** for you to respond to. Nothing is lost — you can
always answer your own spell.

**What "hold priority" means in MTGO is different**: you cast, and the opponent
is *not* offered a window at all until you say you are done. Two of your spells
go on the stack with nobody able to act between them. That is **false today**, on
purpose or not — `engine.ts` hands priority to the other seat the moment an item
reaches the stack.

⚠ **Making the second one true is an ENGINE change to who gets priority after a
cast, which is a rules decision and not a UI toggle.** It changes what your
opponent can respond to and when, so it is not something I should infer from two
words. Concretely, it would let you assemble a two-card combination that cannot
be broken in the middle — which is either exactly what you want or exactly what
you don't.

So: **which did you mean?** If it is the literal line, BL-18 is complete once the
server half lands and nothing further is needed. If it is the MTGO behaviour, it
wants its own ruling and its own entry, and I would want to hear how it interacts
with the {Swift}/{Sluggish} windows before building it.

ANSWER: Ho, you can't hold priority after casting a spell, that's not what I meant actually. I just wanted "Full control" so when you're holding control, you will be given every single stop, regardless of your settings (auto pass) or yields or the haste step or anything. Even during deployment, nothing will automatically resolve if you're holding ctrl. When you let go, it goes right back to the way it was

---

## Round 36 findings — for your information, no answer needed

These are **not questions** and nothing is blocked on them (deliberately not
`## Q` headings, so `238-question-sheets` does not count them as waiting on
you). They came out of fixing CT-176, and they are here because they are real
divergences that nobody would otherwise have written down.

### 1. "Deployment uses the stack" is only true of triggers

R144 says deployment uses the stack. In practice a deployment *play* still
resolves where it stands and never reaches one — `playAtTiming`'s deployment
branch commits with `'resolve'`. That is what CT-176 turned out to be: Earthbound
Replicator's copy trigger fired correctly and then found nothing on the stack to
copy, because Overbloom had never been on it.

The obvious repair — route deployment plays through the deployment stack — was
tried and **reverted, with a measurement**. `settle()` will not drain that stack
while *any* decision is open (the R154 guard), and deployment is simultaneous,
so one seat's pending question freezes the other seat's play. On DQVZ, Ben's
Eldritch Dreamtender waited behind Rashi's Floral Singularity X question and
spawned in the wrong order; 14 engine tests failed, including R154's own two.

So: if you ever want deployment plays genuinely on the stack, **the R154 hold has
to become seat-aware first**, and that is a separate and much larger piece of
work. Nothing is broken today — the fix that shipped makes the copy work without
moving the play. Recorded so the next person to look at R144 does not re-derive
the reverted branch; it is commented in `apply.ts` too.

### 2. In deployment, a copy resolves AFTER the original, not before

The RAQ wording is "above original spell effect", which cannot be honoured when
the original never reached a stack to be above. **No card currently makes the
order observable** — the reachable family is exactly `['Overbloom']`, derived
from printed data and pinned by a census test that reddens if a second card ever
joins it — so nothing is at stake today. But it is a real divergence from the
printed wording and you should know it exists rather than find it in a game.

---

### 3. Four oracle-text overrides were added without a ruling — tell me if you disagree

CT-132. Twelve cards name an attribute they do not carry on their type line;
**eight** tagged it with the `{g}` keyword marker and **four** did not, so the
same word rendered as a coloured keyword on one card and grey prose on another —
Brough ("Everything is balanced"), Blob of the Dark Order and Unrelenting Horror
("piercing"), Inexorable Miasma ("poisonous").

Fixed in `printed-overrides.mjs` — four lines, one `{g}` each. The canonical
`data/cards/AlgomancyCards-OracleText.json` is untouched, as always.

⚠ **These are the first entries in that override table that you have not ruled
on**, and each `by:` field says so rather than implying otherwise. My reasoning
for going ahead: it changes no rule and no wording — it is a presentation marker
that makes the same keyword render the same way everywhere, and Brough's own
reminder text ("The power and defense of balanced units are equal to the greater
of the two") settles what the word is doing. It is four lines plus one
`npm run extract` to revert if you would rather it waited.

**Worth knowing regardless:** deriving the list rather than typing the four names
turned up a rule nobody had stated. The first scan returned **sixteen** bare
words, because an untagged "flying" inside `{i}(Only flying units can block
flying units.)` looks identical to the bug and is not one — **reminder text is
prose *about* a keyword and is bare on all eight cards that do tag the rules
occurrence.** Had the four names been typed in, that would never have surfaced,
and the next person to "tag every attribute word" would have coloured twelve
reminders. It is now its own assertion.

---

### 4. Test mode is network-room-only, and hotseat does not get it

BL-06. The sandbox flag is set at the **deal**, and local hotseat has no server
room and therefore no deal — its `Harness` never sees one. So "Test mode" starts
a real (solo) room and the second seat opens in a second tab, exactly as you
asked for; playing hotseat locally gets you the ordinary game with no cheats.

That was the obvious default rather than a decision worth crediting, and it is
cheap to revisit. **Say if hotseat should have it too** and it becomes its own
small entry.

Two things deliberately left alone, neither worth a question: a sandbox room
still shows the ordinary *"Waiting for your opponent — send them the room code"*
banner, which reads fine because that link genuinely *is* the open-the-other-seat
affordance; and `/api/verdict` will accept a verdict for a sandbox room, which is
harmless because the verdict bar never appears there.

---

*(More appended as the round's agents hit them. Nothing above waits on you.)*
