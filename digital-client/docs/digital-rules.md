# Digital rules — rulings log

Adjudications the engine implements, numbered and dated. The paper rules resolve these by
conversation at the table; the engine needs exactly one answer each. **This file is the
engine's spec** — every ruling here should end up encoded as a test.

Format: ruling, source (Bena / Manual / Caleb), date. Provisional rulings are marked ⚠.

---

## R1 — Trigger conditions vs effect values

**Conditions are checked once, at event time; amounts are computed at resolution.**

- *Condition*: "When an ally spawns with greater defense than power…" — checked at the
  moment of spawning. Once the trigger is on the stack it resolves regardless of later stat
  changes; to stop it, the opponent must respond **before the event** (remove the triggering
  unit / change the state before it enters). If the condition was false at event time, no
  later change makes it fire.
- *Amount*: Astral Tidewraith — "damage equal to the number of cards in their hand" — the
  hand count is measured **when the trigger resolves**, so responses can change it.
- *Explicit exception template*: cards that DO re-check at resolution say so on the card —
  "**if I am still in formation**" (Hooba-Nan, Rousing Spirit). That clause is a
  resolution-time check, encoded per card; it is the only recheck mechanism.

(Bena 2026-07-16.)

## R2 — Ordering of simultaneous triggers
All simultaneous triggers are ordered **by their owner, however they choose**; then all go
onto the stack with **NIT's entering last** (thus resolving first). (Bena 2026-07-16,
consistent with Manual Q&A p.43.)

## R3 — Formation changes during combat
All formation changes are **recalculated immediately** (promotion, attribute sharing, column
membership), but there is **no priority window between damage sub-steps** — e.g. between
Swift damage and normal damage, the recalculated state applies but nobody can respond.
(Bena 2026-07-16.)

## R4 — Electric damage pathing
The **Electric source's controller** chooses the path. There are **no formation changes
during damage distribution**: initial damage happens, then excess passes immediately along
the chosen path (it is excess damage, resolved atomically within the damage event).
(Bena 2026-07-16.)

## R5 — Fizzle vs partial resolution (per-card guideline)
Depends on how *load-bearing* each target is: if every target is required for the effect to
make sense (e.g. Battle/fight effects needing both units), the whole effect **fizzles**;
otherwise it **resolves partially** against the remaining legal targets. Applied per card
during scripting; each card's test records its behavior. (Bena 2026-07-16.)

## R6 — "Unless its controller pays [x]" payments
Payment is **part of spell resolution**: the paying player gets a dialogue to pay X or
decline, mid-resolution. No priority window around the payment. (Bena 2026-07-16.)
Engine note: this is exactly the `pendingDecision` model in docs/04 §1.

## R7 — Combat damage splitting
The **controller of the damage-dealing unit** decides how damage splits (including
voluntary over-assignment). **Piercing is automatic, not elective** (unlike MTG trample):
whatever is left over after assignment is dealt to the opponent. (Bena 2026-07-16.)

## R8 — Control change
The unit **swaps sides, straight up** — including joining the new controller's formations.
No region ambiguity: see R12. (Bena 2026-07-16.)

## R9 — Once-per-turn budgets under control change
Once-per-turn ([once], bounded grafts) is **tracked per card**; changing controller does
**not** reset a spent budget. (Bena 2026-07-16.)

## R10 — Unaware's "interacting with"
**Everything counts as interacting**: fight, battle (blocking/being blocked/dealing or
receiving combat damage), targeting — all of it. Unaware and whatever it interacts with
mutually ignore stat changes. (Bena 2026-07-16.)

## R11 — Regroup order
There is a set order; per the Manual's own listing (p.7): **(1) players and units return to
their regions, (2) damage on units is reset, (3) temporary stat changes are removed,
(4) units leave formation** — plus spell tokens are erased (token rules section). Verify the
detailed regroup section confirms this exact sequence when it first matters in play.
(Bena + Manual, 2026-07-16.)

## R12 — Regions are exclusive
**Things exist in exactly one region at a time.** This resolves the exotica: a stolen unit
is simply in its new controller's side of whatever region it occupies (R8); a region-ending
effect (Temporal Rift) affects only that region's battle and stack — other regions resolve
later, unaffected. (Bena 2026-07-16.)

## R13 ⚠ — Piercing through a fully-dead blocked column
A blocked column stays blocked, but if all blockers are gone at damage time a
**Piercing** column's damage carries entirely to the defending player (assignment
over an empty column leaves everything as excess, and piercing excess is automatic
per R7). Non-piercing columns still deal nothing through a dead block. ⚠ Engine
call during M1 (the prototype dealt nothing in both cases) — needs Bena.
(Engine 2026-07-16.) **Confirmed by the Manual, 2026-08-21**, which prints it in
as many words: *"The column is considered blocked even if the defending unit is
removed during combat!"* The ⚠ above is really only about the Piercing half now.

The mirror case — the **attackers** are gone and the blockers are alive — is
answered the *other* way by
[R72](#r72--formation-gravity-the-back-row-always-promotes-the-line-closes-ranks-only-before-blocks):
the blocker deals nothing. There the attack is gone; here it is still real.

## R14 ⚠ — "In this battle" counters are per region-battle
Battle-scoped counters ("the second ally dies in this battle") are kept **per
region** and reset at battle-phase start; since a region hosts at most one battle
per phase, "this battle" = this region's battle. Deaths outside the battle phase
don't count. ⚠ Engine call (the prototype counted across the whole phase globally).
(Engine 2026-07-16.)

## R15 ⚠ — Round-2 attackers when round 1 had no battle
If IT declines to attack (no round-1 battle), NIT never gets a block step and so
never commits counterattackers — in that case NIT may attack round 2 with **any**
of their units. If a round-1 battle happened, round-2 attackers are **exactly the
units sent at block time** (Manual p.20-21), even if that set is empty (= no
round-2 battle). (Engine 2026-07-16.)

## R16 ⚠ — Burst casting order
Casting one Burst token casts all your Burst tokens **of that name** in that
region (R81 — this used to read "all your Burst tokens", which fused a Poison
into a Fireball group); the engine currently stacks them in a fixed (entity id)
order instead of letting the caster order them. Targets are chosen per token.
⚠ Simplification — revisit if ordering ever matters. (Engine 2026-07-16;
name-grouping 2026-08-22.)

## R17 — Prismites give no affinity; active ones exchange during planning
Prismites start the game **dormant** (Manual p.10 setup), can be expended for 1 mana
like any resource, but grant **no affinity** — they are not wild. Their value is the
exchange: during planning, an **active** (face-up) Prismite may be swapped for a
resource of any element, keeping its current state ("players essentially get to pick
their two starting resources for free", Manual p.18; delaying the exchange preserves
hidden information). A dormant Prismite cannot be exchanged. The engine and prototype
had wrongly treated them as wild-affinity and starting face-up.
(Bena 2026-07-16, confirmed by Manual p.18.)

## R18 — Haste step engine model
The haste step (Manual p.18: after the resource step, only {Haste} cards playable, ends
when everyone has played all they want) is modeled as a sub-step after both players
finish planning: each haste play **resolves immediately** (planning is not interactive —
no stack, no responses), players may interleave plays in any order, and a player with no
legal haste play is auto-marked done. The step is **skipped outright** when nobody has a
legal haste play, so turns without haste cards look exactly as before. (Engine 2026-07-16.)

**The ⚠ is withdrawn (2026-08-21).** It used to concede that "the engine lets a
not-yet-done player keep playing haste cards after seeing the opponent's",
judged harmless because planning reveals nothing else. The concession is now
false: the haste step is a **hidden simultaneous segment** — nobody sees the
other side's haste plays until everyone is done, exactly as the planning phase
already worked. That hiding is not a mitigation of the model, it is *what makes
the model correct*: with no information flowing, interleaving in any order and
locking resource decisions first are indistinguishable from the printed
"everyone plays what they want, then the step ends".

Note the enforcement layer. The pure engine does not hide anything — it holds
the whole state and answers every query truthfully — so the concealment is done
where every other concealment is done, in the **server's view redaction**
(`server/view.ts` / `server/rooms.ts`), the same seam that hides hands and
opponents' pending decisions. A tool that drives the engine directly and skips
the server can still peek, which is true of hands too and is not a rules
question.

## R19 ⚠ — Stat layer 4 application order
Tough (defense doubled) and Balanced (power and defense become the max of the two) apply
in **application order** (Manual Q&A p.42). Engine ordering: the unit's **own printed
attrs in type-line order, then augment-granted attrs in mod-stack order, then
column-shared attrs** (column order, front to back). Duplicates don't stack — an
attribute is either present or not, and its first occurrence sets its position.
⚠ Engine call: the Manual doesn't specify an order for printed-vs-granted-vs-shared;
"order gained" is the engine's reading. (Engine 2026-07-16.)

## R20 ⚠ — Sneaky's "attacking alone"
A Sneaky column cannot be blocked iff its unit is **the only attacking unit in the
formation** (spell tokens riding along don't count as company). Two Sneaky units
attacking are NOT alone — both blockable. ⚠ Engine reading of "unblockable if attacking
alone". (Engine 2026-07-16.)

## R21 ⚠ — Deadly specifics
Any **nonzero** damage from a Deadly source kills the damaged unit, regardless of
toughness. In combat, the auto-assignment treats 1 damage as lethal per victim (so a
Deadly Piercing column sends everything past 1-per-blocker through); the kill happens in
the same damage sub-step, before the next sub-step's recalc. Deadly works on effect
damage too, and Deadly kills count for Reaping draws. Players don't "die" to Deadly —
it only shortens units. ⚠ Engine call on the 1-per-victim auto-assignment interaction
with Piercing. (Engine 2026-07-16.)

## R22 ⚠ — Ambush details
Ambush (Manual p.40) plays a unit from hand during battle as a **targeted effect on the
stack**: pay the bracketed cost (e.g. [4bb] = 4 mana, bb affinity — not the card's
printed cost), target an **ally** in the battle region; on resolution the ally is
**recalled** and the ambusher spawns **directly into its formation slot** (or simply
into the region if the ally wasn't in formation). Target gone at resolution → fizzle,
ambusher to the bin ("you lose both", card ruling). Recall = base card to its **owner's
hand**, its mods to their owners' **bins**, a token target is erased. ⚠ Engine calls:
an ambush on the stack counts as a "spell effect" for negation targeting (Dreadwave
Devourer can negate it → ambusher to the bin), and a mid-battle formation swap inherits
the slot exactly (including a blocking slot). (Engine 2026-07-16.)

## R23 ⚠ — Vulnerable's doubling vs assignment (and Powerful's)
**Powerful** doubles the source's total damage once, **before** assignment/overflow (a
Powerful Piercing column pierces the doubled amount). **Vulnerable** doubles what the
victim *receives*: in combat assignment only half the pool is needed for lethal and the
marked amount is doubled on commit — so Piercing overflow is computed on the
**pre-double** pool, and a Vulnerable blocker makes the attacker's excess pierce sooner.
Deadly's 1-is-lethal applies to the pool. ⚠ Engine call: the Manual gives no explicit
ordering. (Engine 2026-07-16.)

## R24 ⚠ — Thieving draws once per connecting column
"Combat damage to an opponent → draw" = **one card per Thieving column that deals combat
damage to a player** in a damage sub-step (unblocked or Piercing overflow), not one per
point of damage. ⚠ No numeric definition found in Manual/glossary. (Engine 2026-07-16.)

## R25 ⚠ — "Each opponent" is region-scoped
"Each opponent/player" effects read the **event region's present seats** (R12, the
Astral Tidewraith pattern). Consequence: a "when I despawn, each opponent loses 3"
unit that dies **outside battle** (deployment sacrifice) affects nobody — the home
region only lists its owner then. ⚠ Confirm, or add a fallback for out-of-battle
timing. (Engine 2026-07-16.)

## R26 ⚠ — "Whenever you play a unit" includes itself; tokens don't count as "played"
Bloomcaster's "[Augment] Whenever you play a unit" (no "another") **fires on its own
arrival** when played normally. "Play" excludes token creation — that non-token
condition is also the recursion guard (the created 1/1 is a token and can't re-trigger).
(Engine 2026-07-16.)

## R27 ⚠ — Formation-counting amounts are live at resolution
"X = the attacking units in my formation" (Embermaw Fledgling) counts **surviving
units the controller owns in `battle.columns` at trigger resolution** (R1 amounts):
combat deaths reduce X, and a unit that wasn't attacking gets X = 0 → no token.
Same reading applies to future "in my formation" counts. (Engine 2026-07-16.)

---

## Project decisions (recorded here for one-stop reference)

- **Audience**: players who already know Algomancy and want more games, or want to deepen
  rules understanding by watching the engine work. Rules transparency = product feature.
- **Rules engine from day one**; no manual-tabletop milestone (TTS already covers that).
- **v1 formats**: 1v1 live draft + 1v1 constructed. **All five elements are valid** — a live
  draft simply uses 3 at a time (chosen per game), so the card burn-down ultimately covers
  the whole set; draft becomes available for whichever element trios are fully scripted.
- **Engine language: TypeScript** (one implementation: browser + server).
- **Card scripting**: LLM-drafted DSL → human review → **a test for every card** (definition
  of done; the tests are also the regression suite that keeps updates from breaking the game).
- **Distribution**: internal use / personal curiosity for now; nothing publishes without
  Caleb's approval (deferred, not forgotten).

## R28 ⚠ — Created units arrive in their controller's region (playtest ruling)
A triggered/spell effect that "creates" a UNIT without naming a place puts it
in its controller's home region — NOT the battle region where the effect
resolved (Tidelurker's 2/2 minted mid-attack must be home to block the
counterattack). Cards that say "in my formation" or similar override this.
Spell tokens (Fireballs etc.) still appear where the effect resolves — they
are battle materiel. ⚠ Engine call from the 2026-08-18 playtest.
**Confirmed as the global default by R52 (2026-08-19)**, which also closes
R33's open question: R33 (Ember of Life) is a per-card exception, not a rival
default.

## R29 ⚠ — "An open spot in your formation" (Tiderunner Initiate)
Requires an EXISTING formation of yours (you attacked, or you declared
blocks): join behind a lone survivor, take over an emptied column, or — as
the attacker — front a fresh column beside the formation. With no formation
declared there is nothing to join and no prompt. Joining is optional ("may").

## R30 ⚠ — "Each player recalls a unit and loses 2 life" (Recall)
The life loss is unconditional per present player: a player with no unit to
recall still loses 2. (Do as much as you can; the two clauses are not linked
by "if you do".)

## R31 ⚠ — Triggers between combat damage sub-steps
Triggered abilities fired by a damage sub-step (Swift/normal/Sluggish)
resolve IMMEDIATELY — as special actions, no priority window (R3) — before
the next sub-step. A Swift unit's "when my column deals combat damage" rider
therefore lands before normal damage (Flowstone Arcanite's counters).

## R32 — Sent counterattackers don't exist anywhere (Manual p.20, clarified)
While "sent" (between block declaration and the end of round 1) a
counterattacker is in NO region: it radiates no statics, is no legal target,
and its spell tokens can't be cast. It reappears in the enemy region when
round 2 begins.

## R33 ⚠ — Ember of Life's 1/1s arrive in the CARRIER's region (playtest ruling)
"When one of your spell effects deals damage, create that many 1/1 units":
the created units arrive **where the carrier (the augmented unit / the unit
with the text) is**, not in the controller's home region — refining R28,
whose home-region default came from Tidelurker. **That open question is now
CLOSED by R52 (2026-08-19): R28 is the default and R33 is a per-card
exception**, kept only because Ember of Life's printed text ties the creation
to the carrier. Two related
clarifications from the same playtest game: "one of YOUR spell effects"
means spells controlled by the carrier's controller (damage events now carry
the effect's controller), and "deals damage" is unqualified — spell-effect
damage **to a player's face counts** (a damage event is emitted for player
hits from effects; combat damage still never counts). (Bena 2026-08-18.)

## R34 — Identical simultaneous triggers are not ordered
When ALL of a seat's simultaneously queued triggers are identical — same
card, same ability/label, same composed parts (e.g. Flourishing Flora
queuing three copies of its trigger, or two token copies queuing the same
text) — the ordering decision (R2) is skipped and they enqueue in the order
they fired: the choice could not be expressed (the options would be
indistinguishable labels) and the outcome multiset is the same. Triggers
from different cards/abilities, or composites whose parts differ (a spent
bounded graft), still ask. (Bena 2026-08-18.)

## R35 — Bracketed [costs] and X on spells are chosen and PAID AT CAST
A spell's bracketed additional cost ("/[Sacrifice a unit]: …") and a spell's
X are cast-time payments: the caster picks the sacrifice / the X value (only
affordable values are offered) BEFORE the spell reaches the stack, the
payment happens on the spot (not respondable), and responses see the fixed
X / the already-paid cost. With no unit to sacrifice — or less open mana
than the smallest legal X ("X can't be zero" → 1) — the cast is ILLEGAL.
Negation does not refund a paid cast cost. The payment receipt is
snapshotted at payment (Volatile Toxicity / Structural Collapse read the
sacrificed unit's defense as it was then), the cost is region-scoped (the
caster's units where the spell is cast — supersedes the old Linked
Extinction any-region note), and a spell COPY inherits the original's
receipt and X instead of paying again. GRAFTED riders pay the same cost when
the composite collects its cast-time decisions (exactly where graft
targeting happens); a rider may be declined — that part is then skipped —
and an unpayable rider is skipped the same way. Rationale: costs are part of
casting (the playtest bugs: Immolate reached the stack unpaid; Wildfire's
mid-resolution X read as "paid 0"). Activated-ability rider costs
(Hearthwood Ancient, Infernal Cultivator, Throwing Boulder, Auric Ascendant)
are a separate parked theme and still resolve-time. (Playtest fix
2026-08-18.)

## R36 — A lone sent counterattacker auto-forms in round 2
When a round-2 counterattack pool holds EXACTLY one unit and no spell token
that could ride along, the only-unit formation is auto-declared (a forced
action, logged like any other). Rationale: the player already committed the
unit at block time; the only real choice left — whether a sent spell token
rides — suppresses the forcing when present. (Playtest request 2026-08-18.)

## R37 ⚠ — "Playing" a card means units and spells only; mods are APPLIED, not played
Only units and spells are "played" (from whatever zone — hand, bin, or
elsewhere). Applying a modification — attaching a Virus, graft, or augment,
whether it comes from your hand, your bin, or a glimpse — is NOT "playing a
card". Consequently, abilities that trigger on "when(ever) you play a
unit/spell/card" do NOT trigger when a mod is applied, even a mod applied
from the bin. This is the intended reading behind the Light element's
play-matters cards (per Discord discussion); the current published rulings
are unclear, so this stands as a provisional local errata until Caleb ships
the official Light & Dark release/errata. Affected base-set cards carry a
provisional-errata note in their oracle `rulings`. (Bena 2026-08-19.)

## R38 — Rot: start of deployment, damage equal to your rot, never decays
`PlayerState.rot`. At the start of the deployment phase each player takes
damage equal to their own rot total, in initiative order. Rot never
decreases on its own. The damage's source is the damaged player's own rot
(Caleb 2024-08-20: "Your rot is a source you control"), it lands in the same
window as regroup triggers, and because there is no priority during
deployment it cannot be responded to. Rot damage must run through a
replacement hook — Skittering Blight converts it to +1/+1 counters on
itself. (Printed: the Rot Counter card, Caleb's card library 2026-01-15; via
Bena 2026-08-19.)

## R39 — Debt: mandatory, automatic, paid at the end of the resource step
`PlayerState.debt`. When a player finishes their planning resource step they
must pay 1 mana per debt, each mana removing one debt. Partial payment is
allowed and the remainder carries to the next turn; there is no other
penalty for being unable to pay. It is not a choice and needs no action —
it is deliberately the LAST thing in the resource step so that no further
mana can be activated afterwards, and the mana spent is unavailable for
casting this turn. (Caleb 2024-09-10, refined 2024-12-02; via Bena 2026-08-19.)

## R40 — Trashing: a card entering a bin from anywhere but the stack
Discarding, sacrificing, milling and dying in combat all trash. A spell or
ability going to the bin after resolving does NOT (it comes from the stack),
so negating a spell is not trashing; erasing never touches the bin and so is
not trashing. The trasher is the owner of the bin the card enters. A
per-battle trash count is required (Dropslime, Muck Rummager). (Printed: Void
Scavenger reminder text; Caleb 2025-02-01; broadened by Bena 2026-08-19.)

**Amended 2026-08-21 — the "nontoken" clause is REVERSED. Tokens CAN be
trashed.** This rule used to read "a **nontoken** card entering a bin…" and
carried the flat clause *tokens are never trashed*. Bena has ruled the other
way, and the three premises are each independently sourced:

1. **Tokens are cards.** *"Tokens are temporary cards"* opens the Tokens
   section of BOTH rulebooks. Algomancy does not draw Magic's token/nontoken
   line; token-ness here is physical provenance (anything you would not
   shuffle into the deck), and the game carves tokens out by printing the
   literal word **"nontoken"** where it means to.
2. **A dying token does enter the bin** — see R69, with Caleb's rulings.
3. **It does not come from the stack**, which is this rule's entire definition
   of trashing.

So a dying token is trashed by the owner of the bin it enters, exactly like
everything else, and is *then* erased out of that bin (R69).

⚠ What the old clause rested on: the **reminder text of Void Scavenger**, the
one card in the corpus that prints "nontoken" next to a trash. That card has
been **cut**, and it is not registered in the engine at all — so the qualifier
that justified a rule-wide exception now survives on nothing. No scripted trash
trigger in the pool prints "nontoken".

**Consequence, and it is intended:** all fourteen trash triggers (Dropslime,
Muck Rummager, Cerebrox, Murkstalker, Afflicting Anima, Blightwalker, Cthyrian
Culler, Cthyrian Rector, Maw of Despair, Murkdrop Distiller, Nothyr, Splort,
Thoughtripper — and Void Scavenger if it ever returns) and the per-battle trash
ledger now see token deaths. Token-heavy Dark boards are materially stronger at
trash payoffs. That is the point of the ruling, not a side effect of it.

**Bin redirection (2026-08-19).** A card that redirects a dying unit into
someone else's bin (Pull Under: "delete target unit; it and its mods go to
YOUR bin") passes `E.destroy(u, verb, { binTo: seat })`. The bin push and the
trash attribution are ONE decision — "trashed by the owner of the bin it
enters" — so they cannot be split: `destroy()` fires `trashed` synchronously,
queueing that event's triggers and bumping the per-battle ledger, long before
card code regains control, and a compensating second `trashed(caster)` would
double-count the ledger and double-fire "when I am trashed" (Dropslime,
Nothyr, Murkstalker). Exactly one trash event fires, naming the seat whose bin
received the card.

## R41 ⚠ — Cache is public information
Both players can see every cached card and which prophecy is attached to it.
Rationale: glimpse reveals the card as it caches, and Prismatic Observer
targets a cached card, so the zone has to be visible to be playable; Caleb
calls cache "a neutral zone like the hand and bin" (2024-02-25). Consequence:
no server-side redaction for cache. (Bena's call 2026-08-19 — overturn if
prophesied cards turn out to be face-down.)

## R42 — Prophecy: cache during deployment for the banner cost, then play free
Prophesying is legal ONLY during the deployment phase (Caleb 2025-05-09) and
costs the banner's plain mana number, no affinity. The card moves to cache
with its prophecy attached. Only a card that says so may be prophesied from
the bin (Angel of Anguish). Once the condition is fulfilled the card may be
played from cache for free — and "for free" also ignores affinity (Caleb
2024-10-28) — but normal TIMING still applies, since it is played "as if it
were in your hand". A fulfilled prophecy equally permits grafting or
augmenting the card for free (Caleb 2024-12-03). (Printed reminder text via
Bena 2026-08-19.)

## R43 — Prophecy conditions count forward from the moment of prophesying
"Two Turns Pass" means two turns after this card was prophesied, not two
turns of the game. Caleb 2024-09-22: "It needs to be prophecied beforehand …
Same way that 'Four turns pass' can't just be played on turn 5." In 1v1 both
battles in a turn tick "One Battle Passes" (Caleb 2024-09-24).

## R44 ⚠ — A fulfilled prophecy latches
Once a prophecy's condition has been met it stays fulfilled, even if the
state that fulfilled it goes away — a card prophesied on "your life is 5 or
less" remains playable after you gain life back. Rationale: the reminder
text says the card may be played "if the prophecy has been fulfilled" and
Caleb's announcement says "anytime after the condition has been met", both
of which read as a one-way latch. (Bena's call 2026-08-19.)

## R45 — Glimpse N: reveal N, cache ONE, recycle the rest
Glimpse N reveals the top N cards of the deck, caches exactly **one** of the
glimpser's choice, and recycles the other N-1 to the bottom of the deck.
Until end of turn the cached card may be played as if it were in the
glimpser's hand, **ignoring affinity** (Caleb 2024-10-28) but still paying its
mana cost (Caleb 2023-08-13) and still obeying timing restrictions (Caleb
2025-12-28). The permission expires at end of turn; the card stays in cache,
inert.

**CORRECTION 2026-08-19**: this ruling first read "caches all N". That was
wrong, and five base-set cards were migrated to it before the error was
caught. The printed reminder text on every card that glimpses more than one
says "Reveal the top X cards of the deck and **cache one** … **Recycle the
rest**" (Premonition, Oracle of Foretelling, Celestial Purge, Dematerialize).
The N=1 cards read "reveal the top card and cache it" only because cache-one
and cache-all coincide at N=1. Glook's "Glimpse 1, X times" is X separate
one-card glimpses, not one Glimpse X. `Big Glimpse Card` is a deliberate
variant and says so explicitly ("Cache one **pile** … Recycle the other
pile"). (Printed reminder text; correction by Claude 2026-08-19.)

**Implemented 2026-08-19.** `E.glimpse(seat, n)` now reveals N, raises the
choose-one decision through the resolving part's own `ctx.choose` (a new
`E.partChoose` seam, so no card code had to change), caches the pick with the
until-end-of-turn stamp and recycles the rest to the bottom of the deck in
revealed order. N = 1 raises no decision. A glimpse called with no resolving
part to hang a decision on — an engine-internal or white-box call — caches the
top card deterministically and says so in the log.

## R46 — Mods do not follow a card into cache
When a unit in play is cached, the mods attached to it go to the bin rather
than travelling with it. (Caleb 2024-09-15.)

## R47 — RETIRED 2026-08-21 (the card was redesigned; see R71)
**This rule is withdrawn — not stale, wrong.** The card it described no longer
exists.

What R47 said, verbatim in substance: the Wraith token was a 0-mana **4/4**
Blight Zombie Token Unit reading *"[Augment] When I attack or block, put a
-1/-1 counter on me. When I die, augment me onto target ally"*; **unlike every
other unit token it was not erased on death** — its own trigger re-applied *the
same token* as an augment mod on a chosen ally, donating the shrink-on-fight
text to its new host, and it ceased to exist only when no legal ally remained.
A Wraith dying was not a trash, because tokens were excluded from R40.

Every one of those clauses is now false. On **2026-08-21** Bena supplied the
new printed card: a **3/3** whose first line is a start-of-deployment -1/-1
counter on an ally and whose second line **mints a fresh Wraith** rather than
re-homing the dying one. The dying Wraith is erased like any other token —
after entering the bin and being trashed there (R69), which also reverses
R47's last sentence.

The one clause that survives is the naming: `Wraith` and the retired `Wight`
are ONE card, registered under the current name with the old one as an alias,
because `Blight's End` still prints "Wight".

**Replaced by [R71](#r71--the-wraith-token-redesigned-and-an-ally-is-not-a-target).**

## R48 — Blessed is simultaneous; Afflicting fires on counter kills
Blessed life gain happens on the same game-state check as the damage, not as
a trigger on the stack, so it applies before the lethal check and a blessed
source cannot kill its own controller through its own damage (Caleb
2024-09-15, 2025-03-18: "similar to lifelink in mtg"). Afflicting fires when
its source kills units by -1/-1 counters as well as by damage (Caleb
2024-09-10) — which is the only way Umbral Decay, the sole afflicting card,
kills anything. ⚠ One rot per affected controller per kill event, however
many of their units died, is Bena's reading of the reminder text; no
designer statement was found.

## R49 ⚠ — Non-mana costs are paid when you pay them, not when they resolve
A bracketed cast cost and an activated ability's cost are now modelled for
real, beyond the old sacrifice-a-unit / mana / sacrifice-self pair. A spell may
carry `[Pay N life]`, `[Discard N cards]` or `[Gain N debt]` (including the
printed `Printed.gainDebt` line, which the engine itself charges — a negated
Hyper Beam still costs its caster the debt); an activated ability may cost
life, debt, N discards, N *other* units, or the printed either/or "discard a
card **or** sacrifice a nontoken unit". Every one of them **gates the action**:
an unpayable cost makes the cast or activation ILLEGAL (R35), `legalActions`
never offers it, and `apply()` refuses it — instead of the old behaviour, where
the action was legal and the effect silently fizzled at resolution. Costs that
carry no choice (life, debt) are charged on the spot; costs that carry one
(which card, which unit) are chosen in the cast window, still **before** the
item reaches the stack, so no one may respond between a cost and its effect.
A spell may not discard **itself** to pay its own `[Discard a card]`.

⚠ **May a life cost be paid if it would kill you? No.** You may pay N life only
while you have **more** than N — paying your last life is refused too. Life
reaching 0 ends the game inside `loseLife`, so paying at cast would hand the
opponent the win before the spell resolved; R35 already makes an unpayable cost
an illegal cast, and nothing in the pool reads like a suicide button. No
designer statement was found either way — this is the engine's ruling
(2026-08-19), and every affected card (Blob of the Dark Order, Glararr, Hand
Peeper, Life Leech, Aurozoa, Visionary Construct, Flesh Tithe) follows it.

Two smaller pieces ride along. `ActivatedAbility.timing` carries a printed
`{Battle}` / `{Deployment}` marker on the ability itself (Grox, Cadaverous
Cultivator), enforced at activation rather than fudged at resolution. And two
fields the card pool had been asking for: `Entity.spawnedTurn` (stamped for
every entity, behind "erase all units that spawned this turn") and a `from`
zone — `'hand' | 'cache' | 'bin'` — carried on the `spellPlayed` and `spawned`
events, so "when you play a card from anywhere other than your hand" is a field
read rather than a log scan. A unit *created* by an effect carries no `from` at
all, which is what keeps effect-made tokens out of "played" triggers (R37 keeps
mods out for the same reason). Still not expressible: a cost whose amount the
payer chooses (Flesh Tithe's `[Pay X life]`, No Hand Killer's "discard X
cards") and a zone cost (Grox's "erase two cards in your bin") — those stay at
resolution and are flagged on the cards.

## R50 — The haste step ends, and deployment starts, with a real event
Two turn-structure seams had no dispatched event, so no card could hook them.
Both now fire inside a proper `settle()` window.

**`endOfHaste`** fires in `startBattlePhase()` **before** `hasteDone` is nulled,
so "At the end of [Haste], …" (Keeper of Tithes, Debt Plant) sees the step it is
closing. The order matters twice over: R43's `hasteWithUsedMana` prophecy sweep
requires `hasteDone === null`, so firing first means a trigger's own spending
can never latch that prophecy early, and only after the window drains is
`hasteDone` cleared, the prophecy swept and the mana tally zeroed. The event
fires even when R18 **skipped** the step outright — the haste step is part of
the turn whether or not anyone had a card for it, and an optimisation must not
be observable. Because a trigger may suspend on a decision, the phase flip is
deferred through `GameState.hasteEnding` and completed by `finishHasteEnd()`
from `settle()`, exactly the way `turnEnding` defers the turn flip.

**`startOfDeployment`** fires in `startDeployment()` **after** R38's rot damage
has settled. ⚠ That order is a ruling: nothing in the printed rules sequences
them, and rot damage is treated as part of the step *opening* — an automatic
charge, not a trigger — so a start-of-deployment trigger cannot pre-empt it.
The visible consequence is that rot which kills you kills you before your own
trigger resolves. (Bena's engine, 2026-08-19; no designer statement found.)

## R51 ⚠ — A card in a bin or a cache can listen
`fireEvent()` scans units in play, so "If I am in your bin, after combat …"
(Lurking Dread, Inexorable Miasma, Xzydris, and the base set's Cinder Scuttler)
had no trigger surface at all. A triggered ability may now declare
`zone: 'bin' | 'cache'`, and those are dispatched separately, anchored on a
**detached stand-in entity** with id -1 — the same device R40 already uses for a
trashed card's own trigger. The stand-in is never in `s.entities`: it cannot be
targeted, radiates no statics and appears in no other scan. Its
`owner`/`controller` is the seat whose zone holds the card, so "if I am in
*your* bin" is that seat throughout, and its region is that seat's action
region. Dispatch is indexed by event type, so an event nobody listens for from
a zone costs one failed map lookup.

Two deliberate limits. ⚠ **One firing per zone, not per copy**: the printed
texts are standing permissions ("if I am in your bin"), not per-copy triggers,
so three copies in a bin fire once. And a `[Switch1]` budget (R9) on a zone
trigger lives only for the one firing, because a stand-in has nowhere to keep
it — flagged rather than faked.

⚠ Two things this deliberately does **not** solve. There is still **no "a card
left a bin" event** — bins are spliced directly by a dozen card effects and by
engine code, with no choke point — so Rotling stays parked. And **a trash
trigger can never carry a graft rider** (Blightwalker, Afflicting Anima, Maw of
Despair print theirs as `[Switch1]`). That one is structural, not a missing
hook: a *modded* unit that dies is ERASED (Unstable) and never reaches a bin at
all, so a card that IS trashed provably carries no mods, and the ghost's empty
`mods: []` is the correct answer rather than a limitation to route around. The
graft CAUSE still works normally while the card is a unit in play; only the
trash firing itself can never have riders.

**Re-derived 2026-08-21, after R69 let tokens be trashed** — the argument
survives, and is now load-bearing on the branch ORDER rather than on the token
carve-out. R69 tests `mods.length` FIRST: an Unstable anything, token or not,
is erased with its mods and reaches no bin. Trashing requires entering a bin.
Therefore *anything trashed out of play carried no mods* — which is what the
empty `mods: []` encodes — and that now holds for the token case too, where it
previously held only by accident (a modded token used to take the token branch
and escape trashing for the wrong reason). One further consequence: the
stand-in a trash trigger fires on is no longer always fabricated. R70 hands it
the dead unit's own detached entity where there is one, so the trigger keeps
the region it died in; the `mods: []` is still written explicitly, for the
reason above.

## R52 ⚠ — A created unit arrives in its CONTROLLER's home region (R28 is the default)
"Create a unit / create a Wraith / create that many 1/1 units", with no place
named, puts the unit in its **controller's home region** — never the battle
region the effect happened to resolve in. This closes **R33's open question**
("is R28 the default and R33 a per-card exception, or is 'the effect's region'
the real default?") in favour of **R28**: R28 is the general rule, and R33
(Ember of Life's 1/1s arriving where the *carrier* is) is a **per-card
exception**, justified only because that card's printed text ties the creation
to the carrier. Cards whose text names a place — "in my formation" (Hooba-God),
"in its position in play" (Feed to Hooba) — likewise override it, and **spell
tokens** (Fireballs, Poisons) are unaffected: they are battle materiel and
still appear where the effect resolves.

Rationale, from R28's own playtest finding: a unit minted mid-attack must be
home to block the counterattack, otherwise "create a unit" mid-battle reads as
a combat trick the printed text does not promise. The alternative default —
the effect's region — would make the same card behave differently depending on
which trigger happened to fire it, which is exactly the inconsistency this
ruling exists to remove.

Applied uniformly across the Light & Dark pool: **Flesh Tithe**, **Keeper of
Tithes**, **Afflicting Anima**, **Cosmic Devourer**, **Life Plant** and
**Swarmling** moved from the effect's region to the controller's home region;
**Legion of the Depths** and **Primordial Coalescence** already did this.
"Put into play from a bin" (Exhume, Covenant of the Damned, Uglk, Gridxlan,
Wake the Dead) is **not** creating and is deliberately untouched.

⚠ Known follow-up, deliberately out of this pass's scope: **the base set is
not uniform either.** A dozen base-set cards still create units in the
effect's region — Perpetual Construct, Squish, Channeled Amalgam, Astralith,
Stormsowing Nimbus, Flamebreath Initiate, Engorged Caudex, Forager of the
Fallen, Spawntender, Spell Excavation, Echo of Despair, Mirage Walker,
Gravitational Correction, Infernal Cultivator — plus five more found in the
2026-08-21 audit: Soul Siphon, Stoneborn Progenitor, Awoken Tomb, Arcane
Concentrator, Embermaw Fledgling (all battle-reachable creators using the
effect's region; Soul Siphon and Flesh Tithe are the same printed shape and
currently behave differently) — while Tidelurker (R28's own
source), Ancient One, Pack Leader, Pathogenic Enclave, Scrap For Parts, Floral
Singularity and Galactic Germination already use the home region. R52 is
the rule they should all follow, but the base-set migration wants its own
coordinated sweep: several of those cards' tests pin the current region, and
one of them (Ember of Life) is R33's named exception and must NOT move.
(Engine 2026-08-19.)

---

## R53 — "When I become targeted" fires on every targeting path

*(Playtest round 5, 2026-08-19. Engine bug, not a rules question.)*

Targeting a unit fires a `targeted` event **wherever the targeting comes
from**: a spell or ability resolving off the stack, a virus, an augment, or a
graft. All four are targeting.

The engine had two separate targeting paths and only one of them dispatched.
`apply.ts` (doAugment / doGraft / the virus push) called `fireEvent`, but
`engine.ts` `commitItem` — the path every spell and ability takes — built the
event, wrote it to the log, and never dispatched it. The event was visible in
the game log, so the bug looked like a card bug rather than a routing bug.
Consequence: **no spell in the game could trigger a "when I become targeted"
ability** — Mohruung's Crystal 2 never appeared. Found at the table.

The dispatch carries the targeted unit's own `region`, so region-scoped
listeners (R12) resolve against the region the unit is actually in. It fires
at commit time, before the item is pushed, so the queued trigger settles onto
the stack **above** the spell that targeted — the trigger resolves first.

Downstream: **Earthbound Replicator** was written to listen to `spellPlayed`
and re-derive targets precisely because this path was deaf; it still works and
is left alone. **Earnest Defender** scrapes `targeted` entries out of the
event-log tail — unaffected, the log entries are unchanged. **Ancient One**
already listed `targeted` among the events it mimics and now genuinely
receives it.

## R54 — A Shard is not a Prismite

*(Playtest round 5, 2026-08-19.)*

"Create a Shard" creates a resource of kind **`shard`**: it arrives dormant,
gives **one generic mana** once activated, gives **no affinity**, and **cannot
be exchanged** for an element during planning.

That last clause is the whole ruling. R17's planning exchange — trade an
active Prismite for a resource of any element — is the Prismite's entire
value, and Shard-making cards had been approximated as making Prismites, which
silently upgraded every one of them into a free colour-fixer. `openMana`
counts both identically, so nothing in play revealed the difference until
planning. Found at the table (Swirling Shardform).

Shards now go through `E.createShard(seat, n, source)` and nothing else; card
files may not push into `player.resources` directly (guarded by a test). The
affinity bonus in `apply.ts` (Manual p.18 — three affinity in an element grants
a free Shard when you activate it) already created real Shards and is unchanged.

**Live:** Swirling Shardform (two on spawn), Hooba-Lan (one per attack or
block — unparked by this). Still parked for a different reason: the `[element]
Resource` card faces, whose "when I activate" trigger needs resource cards to
be playable cards at all.

## R55 — Printed `[Augment]` is a permission, not a payload

*(Playtest round 5, 2026-08-19.)*

If a card prints the `[Augment]` marker in its text box, it **can be applied as
an augment** — from hand, from bin, or from cache — regardless of whether its
donated text is implemented.

The engine derives "is this an augment?" from behaviour: type-line
`augmentAttrs`, scripted `augmentText`, or the explicit `augmentable` flag. A
card whose `[Augment]` text is implemented as a **static** has none of the
three unless the author sets `augmentable: true`, and four cards
(**Brough**, **Air Plant**, **Life Power Dude**, **The Omniphage**) did not —
so they could not be slid under a unit at all. Found at the table: Brough sat
in a bin and the client would not offer it.

The marker is the permission and the text is a separate question. A guard test
now asserts that every card in `DECK_LIST` printing a text-box `[Augment]`
marker satisfies `isAugment()`. The marker opens a text segment (start of the
text or just after a `{/n}`); a mid-sentence mention inside `{i}(...)` reminder
text is **not** a marker — that is what keeps **Reconfigure**, a spell that
moves augments around, from being treated as one.

## R56 — "Another target" is re-checked at resolution, never assumed from cast

*(Fuzz seed 1132, 2026-08-19. Engine bug, pre-existing.)*

A card that collects two targets gets them **distinct at cast**. That is not an
invariant that survives to resolution: **Enigmatic Warder** ("[two]: change a
target of target effect to me") redirects a target afterwards, and two
activations collapse *both* of a two-target spell's slots onto one unit.

Any effect whose printed text says "**another**" must therefore re-check
distinctness when it resolves. **Scrap For Parts** already did (`from.id ===
to.id`); **Reconfigure** did not, and its comment recorded the cast-time
distinctness as "distinct by construction". Resolving it with both targets
equal deleted the entity and then re-attached it as a mod pointing at its own
dead id — an **orphan mod**, a corrupt entity table, which is a crash risk
rather than a rules error. Reconfigure now emits an info line and does nothing
when the targets have collapsed.

The general rule: cast-time target *selection* constrains what can be chosen,
never what will still be true later. Redirection, death, region changes and
zone changes all happen in between. Re-validate at resolution.

## R57 — Targets are chosen before costs are paid

*(Playtest round 6, 2026-08-19. Engine bug.)*

Every cast-time *question* is asked in this order: **X → {Modular} mods →
TARGETS → costs.** Nothing that requires a decision, and nothing irreversible,
is spent until the effect has been aimed.

The precise scope: an **activated ability** pays its entire cost after
targeting (mana, life, debt and sacrifice-self included). A **played card**
still pays its flat printed mana up front in `playAtTiming` — mana is fungible
and castability was already gated, so nothing is lost by it — but its bracketed
`[cost]` (R35), which is where the sacrifices and discards live, now comes
after targets like everything else.

It used to be the other way round. `doActivateAbility` charged mana, life and
debt and ran `destroy(u, 'is sacrificed')` at the moment of activation, before
`castChain` ever reached target collection. So a **"Sacrifice me:"** ability
ate its own unit the instant you clicked it — before showing you the target
list, and with no way back if you had misclicked a unit you meant to *block*
with. Found at the table.

The whole cost now rides on the item (`StackItem.activationCost` for the
choice-free half, `pendingCosts` for the half that needs a choice) and is
charged in the cast window once targets are settled. Both halves still happen
**at cast, before the item reaches the stack**, so R49's guarantee holds: no
player may respond between an activation's cost and its effect.

This applies to bracketed part costs (R35) too, not only activation costs — a
`[Sacrifice a unit]` spell asks what it is aiming at first. Two consequences
worth knowing: an ability may now legally target the very unit it is about to
sacrifice (it fizzles, exactly as it should), and the cost is charged even when
targeting turned out to find nothing, which is why the client asks "are you
sure?" before firing an irreversible ability that will not stop for a target.

## R58 — Per-slot target legality, re-checked at resolution

*(Playtest round 6, 2026-08-19. Engine bug.)*

A multi-target spec may restrict each slot separately (`TargetSpec.slots`), and
a redirection effect may only move a target into a slot **it could legally
occupy**.

**Fight** prints "Target ally and *another target* unit fight". Both are
targets. The engine took only the ally at cast and picked the second unit
mid-resolution, so the opponent never saw what the spell was aimed at while it
sat on the stack, and the second "target" could not be responded to at all.
It is now a two-slot spec: slot 0 `allyUnit`, slot 1 `unit`.

"Ally" means ally **of the effect's controller**, and that is where the second
half of the bug lived: **Enigmatic Warder** ("[two]: change a target of target
effect to me") would move the *opponent's* unit into the caster's ally slot.
Changing a target may never create an illegal one, so the Warder now offers
only slots that `E.canFillSlot` accepts — which also enforces R56's "another"
by refusing a slot that would duplicate a sibling.

As in R56, cast-time legality is not an invariant. Fight re-checks both slots
when it resolves: same unit twice, or an "ally" that changed controller while
the spell was on the stack, and it does nothing.

## R59 — Cost modifiers

*(Playtest round 6, 2026-08-19.)*

A card in play may continuously change what it costs to **play** other cards.
`CardBehavior.costMods` radiates exactly like `statics` — from a unit in play
and from an augment mod anchored on its host — and is scoped to the holder's
region (R12). `E.manaToPlay(seat, name, opts)` is the authority; the total is
clamped at zero.

`purpose` separates **playing** a card from **applying** it as a mod. Applying
a mod is not playing (R37), so a "spells cost [one] more to play" modifier must
not tax an augment, a graft or a battle Virus — those price with
`purpose: 'mod'`.

**Tranquility** ("[Augment] Spells cost [one] more to play during battle") was
parked for want of this layer, and the playtest report — "Tranquility isn't
taxing spells" — was exactly right: it couldn't. It is live now, and its clauses
map cleanly onto the layer: *spells* = the spell card kinds you play from hand
(`spell`, `spellUnit`; a spell token is cast from play, not played), *to play*
= `purpose: 'play'`, *during battle* = the battle phase only, and an unqualified
subject means it taxes **both** players in its region, attackers included.

An X spell still pays X at cast (R35); the modifier applies to the rest of the
bill.

Still parked for want of more than this layer: **Crevice Lurker** and the
"choosing not to pay prevents the ability from triggering" shape, which needs a
pay-to-trigger hook on every trigger entering the stack, not just a price.

## R60 — "Target effect" vs "target spell effect", and the life half of the cost layer

*(Playtest round 8, 2026-08-20, room DEYK.)*

### The targeting half

Two reports, one root. *"I'm not able to cast Hush Mush for some reason right
now. Tho I have priority and there's an effect I want to negate."* The effect
was **Warbloom Herald's attack trigger**, and every negate in the engine mapped
onto one target kind — `stackSpell`, which is spells, spell units, spell tokens
and ambushes.

The card set draws the line itself, and drew it in the other place:

| printed wording | cards |
|---|---|
| "target **spell** effect" | Dreadwave Devourer, Null Drone, Dream Lapse |
| "target **nonspell** effect" | Nothyr |
| "target effect" | Hush Mush, Dematerialize, Boon of Protection, Graxxlid, Enigmatic Warder, Gravitational Correction, Soul Tithe, Divine Intervention, Necromantic Rebuke, Frosted Denial |

Both qualifiers are dead words if plain "effect" means only spells — "nonspell
effect" would name the empty set, and three cards would be saying "spell"
twice. So **plain "effect" is the superset**, and `TargetSpec.what` now has two
members:

- `stackSpell` — spell / spell unit / spell token / ambush. Unchanged, and
  still what the three cards that say "spell effect" use.
- `stackEffect` — all of those **plus** triggered abilities, activated
  abilities and a Virus being applied.

A **unit** on the stack is in neither: a unit arriving in play is not an
effect, and there are no parts to negate.

The ten unqualified cards moved to `stackEffect`. That is a real widening —
Boon of Protection can answer a trigger now, Divine Intervention can redirect
one — and it is what they print.

Nothyr keeps its resolution-time `ctx.choose` over the nonspell items rather
than a `stackNonspell` spec: it is still slightly stronger than printed
(the pick cannot be responded to) and nothing new asks for the third spec.

### The life half

*"I didn't have to pay 2 life from Arbiter of Armistice's ability when casting
a spell during battle (but I should have had to do it)."* Correct — the card
was parked because R59 brought in only the **mana** half of the cost layer.

`CostMod.life` is the other half, radiating on exactly the same rules (R59,
R12). `E.lifeToPlay` is its authority, `E.canPayCard` gates on it, and
`E.payCard` charges it in the same breath as the mana — before the card reaches
the stack, so it cannot be responded to and negating the card does not refund
it. An unpayable life tax makes a card uncastable exactly as unpayable mana
does, under R49's rule: you may pay N life only while you have **more** than N,
so 2 life is unpayable at 2 life.

**Arbiter of Armistice** ("Cards played during battle gain [Pay 2 life]") is
live, scoped as printed: *cards*, so a unit played in battle is taxed too;
*played*, so applying a mod is exempt (R37); *during battle*, so the haste step
and deployment are free; and unqualified, so it taxes **everyone** in its
region including its own controller.

## R61 — {Pure}: the attribute layer, switched off for one interaction

*(Playtest round 8, 2026-08-20, room DEYK.)*

*"Pure units should be able to block evasive or flying units."*

`{Pure}` was parked by standing precedent (docs/08) on the assumption that it
needed the general attribute-**suppression** layer still parked for Monke,
Suppression Field and Transmogrifant. It does not, and that was the whole
mistake: those suppress a card's attributes globally and durably, whereas Pure
is scoped to a single **interaction** and switches *both* sides of it off at
once — "Pure cards and cards they are interacting with ignore all other
attributes", its own other attributes included.

Combat is where attributes live, and combat already resolves per
**attack-column / block-column pair**, which is exactly that interaction. So
Pure lives at those choke points (`E.pure`), not in a suppression layer:

- **Declaring blocks** — one Pure card in either column and neither evasion
  rule survives it: Flying, Evasive, and Sneaky's lone-attacker immunity. A
  Pure unit's own Feeble does not stop it blocking, either.
- **Alluring** — a Pure blocker is "able" against anything, so it can be
  compelled; and an Alluring column that is *itself* Pure ignores its own
  Alluring and compels nobody.
- **Combat damage** — both columns' attribute sets are empty for that
  exchange: no Piercing, Deadly, Powerful, Poisonous, Resonant, Blessed,
  Afflicting or Thieving, and the victim's Vulnerable is off too. With no
  Swift or Sluggish in it, the exchange strikes in the normal sub-step.

Stats are not attributes: a Pure 2/3 still dies to 3 damage.

**Not covered:** interactions outside combat. A spell targeting a Pure unit
does not currently blind itself to that unit's attributes — no pool card needs
it, and the general "any interaction" form still wants the parked suppression
layer.

## R62 — The suppression layer: "loses all attributes and abilities"

*(Playtest round 9, 2026-08-21.)*

*"I'm pretty sure removing abilities from cards isn't working right."*

It was not working at all. Five printed cards take something away — Suppression
Field, Transmogrifant, Monke, Formless's second clause, The Everywhere — and
every one of them was parked with the same note, because `ownAttrs` only ever
*unioned* grants and `fireEvent` had no mute hook. The engine could add to a
card forever and subtract from it never.

**Suppression is a layer, and it sits under every other one.** It is a VETO,
not a sum: one suppressor switches the half off, and nothing switches it back
on. The printed text is "loses **all** attributes", so an attribute the unit
would otherwise get from a mod, a column-mate, a static or an until-regroup
grant is gone too — not just its printed ones.

Two forms, unioned by `E.suppressionOf()` so nothing downstream has to know
there are two:

| form | where it lives | ends when | cards |
|---|---|---|---|
| until regroup | `Entity.suppressed = { attrs?, abilities? }`, stamped by `E.suppress()` | regroup (R11 step 3), with the other temporary changes | Suppression Field, Formless |
| continuous | `StaticMod.suppressAttrs` / `.suppressAbilities`, radiating and region-scoped like any static | the instant the projector stops projecting | Monke, Transmogrifant |

The value stored is the **card to blame**, because the client's text box
(ui/cardtext.ts) has to say who did it — "⊘ attributes switched off by Monke"
is the difference between a confusing board and a legible one.

**What "abilities" covers.** Everything the card would otherwise do by itself:
triggered abilities (own, its own `[Augment]` text, its mods' donated text,
and anything granted to it under R63), activated abilities (neither offered by
`legalActions` nor accepted by `apply`), the statics and cost modifiers it
radiates — a static *is* an ability — and both R38 replacement hooks. Erasing
a unit's mods (Suppression Field's second clause) is separate and additional:
suppression silences donated text, erasure removes it.

**What it does not cover.** Stats are not abilities: a silenced 7/5 is still a
7/5, counters and temp deltas still apply, and layer 4 stops only because
Tough and Balanced are attributes. Being suppressed does not stop a card being
targeted, blocking, dying, or being a legal graft host.

**Static-vs-static resolves in ONE pass.** `staticsFor` skips a holder whose
*entity flag* is set, not one silenced by another static. So a unit silenced by
a spell stops radiating immediately, while two Monkes — each the other's
"other unit" — both keep radiating and both go quiet. That is the simultaneous
answer the layer model wants, and it is also the only one that terminates
without iterating to a fixpoint.

**Still parked:** The Everywhere ("During `[Haste]` name a card. My last named
card loses all abilities.") — the suppression half is now trivial, but naming a
card is a decision primitive the engine does not have.

## R63 — Granting rules text

*(Playtest round 9, 2026-08-21.)*

Reforge the Dead prints *"Your units gain 'When I die, create a Robot 3.'
until regroup"*, and was parked for the mirror-image reason to R62: nothing
could add an ability either, because once the spell is binned nothing remains
in play to listen.

A grant is a **reference, not a copy**: `Entity.granted` holds
`{ card, via, index, text, from }`, addressing an authored ability in the
registry. That keeps it plain serializable data — so it replays bit-identically
— and it composes for free, because `fireEvent` already dispatches through
`collectTriggersFrom(host, cardName, …)` with the card name as a parameter and
the effect key (`ability:<card>#<i>`) already resolves through the registry
rather than through the host.

The granting card authors the granted ability **in its own `abilities` list**,
where nothing else can ever fire it — a spell is never a unit in play, so the
in-play scan reaches it only through a grant. No synthetic card, no second
registry.

Three consequences worth stating, all of them just the printed text read
literally:

- The grant is a **snapshot of "your units"** at resolution. A unit that
  arrives afterwards was not one of them and gets nothing.
- It is **region-scoped** (R12, the Flowstone Arcanite precedent).
- It is cleared at **regroup**, with everything else temporary.

Granted text is silenced by R62 exactly like printed text — it is an ability
the card has, and "loses all abilities" means all of them.

## R64 — A bracketed cost is paid at cast; a printed restriction is a targeting restriction

*(Playtest round 10, game PEMC, 2026-08-21.)*

Two halves of one seam, from one report:

> "Shouldn't Discharge have you remove counters as an additional cost? Not on
> resolution"

It should. What happened at the table is the reason this is a rule and not a
tidiness note. Rashi cast Discharge — *"[Remove X +1/+1 counters from allies]:
I deal X damage to target unit"* — it went on the stack, Ben got a full
priority window, **and only then** was X chosen and the counters removed. Three
things are wrong with that at once: the opponent is asked whether to answer a
spell whose size nobody has chosen yet; a negate would have thrown the spell
away without the cost ever being paid; and the caster can see the response
before committing to what they are paying. A cost paid after the response
window is not a cost.

### The cost half

R35 already said this and only had four cost kinds to say it about
(`sacrificeUnit`, `payLife`, `discardCard`, `gainDebt`), so most of the pool's
brackets were parked or hand-rolled into resolution-time `ctx.choose` loops.
`CastCost` now covers `sacrificeUnits`, `removeCounters` (from allies or from
the source itself) and `eraseBin` as well, and every kind accepts **`n: 'X'`**.

A **variable** cost is where X comes from. You pay one unit of it at a time
until you stop; what you paid **is** the spell's X, written to
`costPaid.x` and read as `ctx.x`. That is the only source Discharge has for X —
nothing on the card ties it to mana.

Ordering follows from that. A variable cost is collected **with the mana X, at
the very top**, before targets: the spell's size has to be settled before it
can be aimed, because what it may aim at is sized by X (*"Negate up to X target
effects"*). Fixed costs stay where R57 put them, **after** targets — R57 is
about not destroying a unit before showing you what it could have hit, and a
cost that decides how big the spell is has no such reading.

Converted: Discharge, Malevolent Machinations, Necromantic Rebuke, Flesh Tithe,
Soul Reaver. Still parked: Trench Stalker (its bracket pays for one of two
play MODES that do not exist yet — adding the cost alone would only make the
card worse) and Vengeance (it *grants* a bracket to the opponent's cards,
which is the cost-modifier layer, not this one).

### The targeting half

> "I was allowed to choose illegal targets for Reconfigure"

`TargetSpec` could say *what kind* of thing a target was and nothing else, so
every printed restriction — *"with base power 2 or less"*, *"with 4 or more
defense"*, *"with no stat changes"*, *"the first target must have [Augment]"* —
was checked at resolution, and the spell offered the whole board and then
refused most of it. From the table that is indistinguishable from a bug.

`TargetSpec.restrict` is a predicate over the resolved target, asked in the
three places that must agree: the menu you choose from, `castable` (no legal
target ⇒ the cast is illegal), and `canFillSlot` (a redirect may not drop an
illegal target into a slot). `slotRestricts` gives per-slot versions, and
`TargetCtx` carries what the predicate needs: whose effect it is, the source
entity, the item's X (Abduct's *"cost [x] or less"*) and the targets already
chosen for this part (Necromorph's *"cost less than or equal to **it**"*).

The restriction is **not** re-asked at resolution — R5 and R56 govern that —
so a card whose restriction can change in between keeps its own resolution
check. Both are correct and they are different questions.

New target kinds alongside it: `enemyUnit`, `token` (unit tokens and spell
tokens alike), `opponent` (a player, and not you — `any` was offering every
unit on the board to *"target opponent"*), and **`binCard` / `anyBinCard`**. A
bin holds plain card names, so two copies there are genuinely
indistinguishable: naming the card **is** the whole reference (`BinRef`), and
the index is looked up again at resolution.

### Targets are declared at cast — all of them

> "Download didn't have me target anything..."

It did not, and neither did nine others: they picked their target
mid-resolution, so the item sat on the stack aiming at nobody, *"when I become
targeted"* never fired, and a response was made against an unaimed spell.
Moved to cast time: Download, Arcane Echo, Resurrect, Rousing Spirit,
Blightwalker, Collect Remains, Delver of the Ephemeral, Necromorph, Aethercap
Siphoner, Torrential Reclamation and Channel Through's ally picks. What stays
at resolution is what genuinely is not a target: a division of damage among a
targeted opponent's units, a ransom the *other* player may pay, a sacrifice
each player chooses for themselves.

An **ability** is gated the way a spell is now, too: one whose bracketed cost
cannot be paid, or whose mandatory target has nothing legal to aim at, is not
offered and is refused. It used to take your mana and skip the part.

### And the menu says whose

Rashi aimed Discharge at her own Unit Token. The menu read *"Unit Token, Unit
Token"*. Both sides field generic tokens with identical art, so the option text
was the only thing that could have carried the difference; `targetLabel` now
names the controller of every unit it offers.

## R65 — Discarding is not playing; conceding; the erased pile

*(Playtest round 10, game PEMC, 2026-08-21.)*

**Discard-me is an instant-speed action.** R40 modelled the printed *"Discard
me"* line as an alternative play MODE, and inherited the card's own timing with
it — so Sacrifice Dude (*"2 [d] Discard me"* on a deploy unit) could only be
discarded during deployment.

> "I can't discard Sacrifice Dude at 'instant' speed. It has to work like that,
> otherwise the alternate cost doesn't make sense (since you don't have
> opponent's during deployment)."

Right, and the card proves it: its payoff is *"each opponent sacrifices a
nontoken unit"*, and in deployment the opponent is not in your region at all
(R25). Discarding is not playing (R37) — nothing reaches the stack, nothing
spawns, and the only thing anyone sees is the card's own "when I am trashed"
trigger. So the mode is available whenever you hold priority in battle, as well
as during your own deployment. A printed `{Battle}` marker on the discard line
(Nothyr) still restricts it to battle; nothing restricts it to deployment.

**Concede** is an `Action` — so it lands in the log, replays with the game, and
reaches the result record exactly as a lethal blow does. It is the one action
with no timing, no priority and no phase, and the one thing you may do while a
decision is pending *against* you, since that decision may be the reason you
want to stop. It is deliberately **not** in `legalActions`: it is never a move
to consider, only one to choose, and the fuzzer must never wander into it.

**The erased pile.** Erasing takes a card out of the game — no bin, no death
triggers, nothing plays it back — but the information is public and there was
no way to look at it. `PlayerState.erased` keeps it, appended by `E.ev()` off
the `erased` event every erase site already emits, rather than at each of the
dozen sites.

## R66 — Base stats are REPLACED, not adjusted, and the replacement is a layer

*(Playtest round 11, 2026-08-21.)*

> "It looks like Aberrant Statweaver gives units +-X/+-X. But really what should
> happen is a pure replacement effect that changes the BASE stats of the card.
> Like, if Statweaver could, it would change the literal numbers on the card."

R-round-7 built half of this: `Entity.baseSet`, an until-regroup stamp written
by `E.setBase`, so *"becomes a base 4/4"* stopped compounding with the base a
previous effect had already written. What it did not build was the CONTINUOUS
half — a base rewrite that radiates from a card in play for as long as that
card is in play — so *"Your units are base 3/3"* had nowhere to live and was
implemented in the only layer that existed: `3 − printed power` handed to the
+X/+X layer.

That is a different effect wearing the same numbers, and it is wrong in four
separate ways:

- **it stacks.** Two Statweavers turned a 7/5 into `7 + (3−7) + (3−7)` = a
  −1/−1, i.e. a dead whale. A replacement is idempotent by construction.
- **it re-derives off the PRINTED base**, so it could not see any other rewrite
  — Formless and a Statweaver on one unit each computed a delta from 7/5 and
  both deltas landed.
- **it is invisible to the questions that ask about a base.** Unmake deletes a
  unit *"with base power 2 or less"*; a Statweavered Good Whale is base power 3
  and was still being read as 7.
- **it reads as a buff.** Everything that asks *"has this unit's stats been
  changed"* saw a −4/−2 modifier rather than a different card.

**The rule.** Layer 2 has two sources and one answer. `Entity.baseSet` is the
until-regroup stamp (Formless, Body Swap, Unstable Refactor, Celestial Shifter,
Floral Singularity); `StaticMod.baseP`/`baseT` is the continuous rewrite
(Aberrant Statweaver), radiating with the same region and suppression rules as
every other static. `E.baseStatsOf` is the only reader, and it resolves the two
**last-wins by timestamp** — never by summing. Timestamps come off the shared
`nextId` clock: `baseSetSeq` for a stamp, and for a static the id of the entity
carrying the text, which is when it started applying. So a Statweaver played
after a Formless overrides it, and one played before does not.

Nothing about layer 3 changes: counters, until-regroup deltas and everyone's
+X/+X still apply on top of whatever layer 2 answered, and a base rewrite that
drops defense to 0 kills at the next death check exactly as it should.

**Not layer 2:** *"double my power and defense"* (Bulwark Manatee, Transmutide
Enigma) and *"switch the power and defense of target unit"* (Invasive
Reassignment) are still until-regroup deltas computed off the effective stats
at resolution. Doubling genuinely is a delta. Switching is the one remaining
approximation in the stat layers: the delta freezes the two numbers as they
stood at resolution, so a later ASYMMETRIC change (a +2/+0 landing afterwards)
applies unswitched.

Where a real switch belongs is an OPEN RULING, and this line previously guessed
at it ("above layer 4"). It should not have. The Manual's layer list has six
entries and none of them is a switch — layer 5 is {Inverted}, which sign-flips
layer 3, a different operation entirely. Bena's position (2026-08-21): "I'm not
a judge in either game." So the approximation stands, deliberately, rather than
inventing a seventh layer and letting a guess harden into a rule the way the
stale PARKED comments R67 swept did.

---

## R67 — "Target" is chosen when the effect is PUT ON THE STACK, and a bracketed cost is paid there too

*(Playtest round 12, 2026-08-21)*

> "Lots of cards seem to choose targets on resolution rather than when they're
> played or put onto the stack. In many cases, this is wrong. Any card or
> effect that says 'target' has to be chosen initially when put onto the stack.
> Same for when you need to pay an additional cost. That cost is paid as it's
> being put onto the stack."

The engine's *architecture* already said this. `E.castChain` runs
`collectTargets` and then `commitItem`, in that order, for every item that
reaches the stack — a played card, an activated ability, and (via
`processTriggerQueue`) a triggered one. Cast-time costs are paid in the same
pass: R35's bracketed `castCost`, R49/R57's activation costs, R64's variable
`'X'` costs, and {Modular}'s mods. Nothing on the stack has ever been able to
pay a bracketed cost late.

What was wrong was **per-card**: eleven cards never declared a `targets` spec at
all and re-derived their "target" with a mid-resolution `ctx.choose` instead.
Most of them predate the seams that would have let them declare it — R58's
per-slot specs, R64's `binCard` / `anyBinCard` / `restrict` — and their comments
say so in as many words ("*the bin is not a targetable zone, so the pick is a
mid-resolution ctx.choose*"). The seams exist now, so the cards use them.

A mid-resolution pick is not a cosmetic difference. It means:

- **the item sits on the stack aiming at nothing**, so the window where an
  opponent may respond is a window in which nobody can see what the spell is
  about to do — the single thing the stack exists to show;
- **nothing can interact with the choice.** A redirect (`E.canFillSlot`) has no
  slot to move, `mustBeTargeted` (Gatekeeper of Souls) cannot compel it, and
  R5's fizzle-when-the-target-is-gone never applies because there was no target
  to lose;
- **an impossible aim is discovered too late.** "Put target unit from your bin
  into play" with an empty bin used to resolve into a silent no-op that ate the
  card and the mana. A mandatory target with no legal candidate makes the cast
  **illegal** (R64) — Covenant of the Damned is now refused, not wasted.

**The rule.** If a card prints "target", the effect declares a `TargetSpec` and
the engine collects it in the cast window. `min: 0` carries a printed "you may"
or "up to"; `count: 'X'` carries "X target …" and reads the X that R35 already
fixed. Choices that are *not* targets stay where they are — which pile to cache,
how to distribute damage among a player's units, which card to discard, and
"you may pay [2] to …" (optional mana *inside* an effect, not a cost of putting
it on the stack) are all still mid-resolution `ctx.choose`.

Two seams were added to carry the last two cards:

- **`what: 'player'`** — plain "target player" with no ownership clause, so you
  are a legal target for your own (Soul Siphon). `'opponent'` already existed
  and measures from the effect's controller (R58), not the chooser's.
- **`TargetCtx.event`** — the event that fired a triggered ability, so a target
  phrased relative to it can be judged. Rippleback Skulker's "put target card
  from *that player's* bin into your hand" cannot name a bin without knowing
  who was just dealt combat damage.

Fixed: Delver of Mysteries, Spell Excavation, Covenant of the Damned, Hooba-Mon
(bin targets); Nothyr (up to one target nonspell effect); Mindwarp Sporefrog,
Big Glimpse Card (target opponent); Soul Siphon (target player); Tidal
Reversion (one target unit per player); Blight's End (X target units);
Rippleback Skulker (target card in that player's bin).

**Not this rule.** *Apex Prime* still prints "target" and still chooses
nothing: "all of your units become a copy of target unit until regroup" needs a
COPY layer — name, stats, attributes and abilities projected from another card
and expiring at regroup — and there is none. The pool's one "become a copy"
(Borrower of Forms) is a bespoke stats-and-counters relay through battle
counters for a single unit, permanently, at spawn; it does not generalise.

*Flux Constructor* was on this list and should not have been. Its card comment
said the dying unit's counter count was "unknowable at both event time and
resolution" — but `destroy()` stamps `counters` onto the death event for
exactly this reason, and has since Entropic Entity needed it. The note outlived
the problem it described. The card is implemented: the count comes off
`ev.data.counters`, "one or more counters" is a nonzero *net* (the engine keeps
one signed total, so a unit that died holding two -1/-1 counters qualifies and
the drawback moves with them), and "another target unit" is a declared target
with `min: 0` for the printed "you may".

*Envoy of Lightning* and
*Boon of Protection* say "target" about OTHER effects' targeting, not their own.
*Channel Through*'s second clause ("distribute 2 damage among target opponent's
units") declares its X allies but not the opponent: a spec cannot mix a
variable-count slot with a fixed extra one, and in 1v1 the opponent is forced.
(R83 fixes this — Bena ruled the opponent IS a cast-time target, and
`TargetSpec.extraSlots` lets a variable slot be followed by a fixed one.)

**One hazard the move creates.** A restriction runs inside `targetCandidates`,
so a restriction that asks `targetCandidates` about ANOTHER card's spec is a
nested query — and Spell Excavation's ("target spell from your bin" is
restricted to spells that could actually be played, which means asking whether
the bin card can find a target) is self-referential the moment a second Spell
Excavation is sitting in the bin. It overflowed the stack. The fix is a
reentrancy guard of the same shape as `E.inStatics`: a re-entered probe answers
on kind and affordability alone, which can only make the menu more permissive,
and `run` re-asks the full question before committing. Any future restriction
that reaches into another card's spec needs the same guard.

**A consequence worth knowing:** the collector asks even when exactly one
candidate is legal, so a forced "target opponent" is now a click. That is the
engine's standing behaviour for every other target, and auto-filling forced
targets would drop a `decide` from the action log and break replay of saved
games — so it is left alone rather than special-cased here.

## R68 — Negating an effect REMOVES it from the stack, then and there

*(Playtest round 13, game UZRG, 2026-08-21.)*

> "Is negate supposed to remove effects from the stack? I thought it was
> supposed to work by just removing them from the stack and putting them into
> the bin (if a spell/unit), not just 'greying them out' and removing their
> effect"

It is, and it did not. `E.negate()` set `item.negated = true` and left the item
sitting on the stack. The removal-and-bin lived somewhere else entirely — in an
`if (item.negated)` branch of `resolveItem()` — and that branch only ran when
`resolveTop()` eventually popped the item. Since `finishResolutionTail()`
restarts the priority window from the initiative player after **every**
resolution, each dead item cost a full extra round to shuffle off. In UZRG one
Containment Protocol negated four items at action 218, and actions 219–226 were
eight further `passPriority` calls popping four greyed-out corpses one at a
time, while a battle both players had already resolved refused to end.

**The structural cause is that the stack had exactly one exit.** `resolveTop()`
→ `resolveItem()` was the only way anything came off it, so `negate()` *could
not* remove anything — it could only leave a note for that one exit to read
later. Negation was modelled as a property of resolution ("resolve as nothing")
rather than as removal from the stack. Three cards had already hand-rolled the
missing primitive, which is how you know it was missing: Temporal Rift called
`negate()` and then pushed the cards to bins itself and set `stack.length = 0`;
Dream Lapse called `negate()` and then spliced; Cosmic Reversal rebuilt
`g.s.stack` from a `keep` array.

**The rule.** A negated item leaves the stack the instant the negation
resolves, and its card goes where it goes at that same instant. `E.negate()` is
now written over a new primitive, `E.removeFromStack(stackId): StackItem |
undefined` — pull an item off the stack and hand it back, the caller decides
where its card goes. That is the second exit, and it is what a recall
(Dream Lapse, Cosmic Reversal) needs too: the same removal with a different
destination.

Where the card goes, by item kind:

- **spell / spellUnit / unit / virus / ambush** — to its controller's **bin**.
  R40: it comes **from the stack**, so this is *not* a trash, and no `trashed`
  event fires.
- **spellToken** — erased. A token never reaches a bin (R40).
- **triggered / activated** — nothing. The ability has no card of its own; the
  item's `card` field names its SOURCE, which is still standing in play. A
  negated ability is simply gone, and it does **not** count as "erased" for the
  cards that care about the erased pile (R65).

**The `kind: 'unit'` hole this closed.** The old branch gated the bin push on
`spell | spellUnit | virus | ambush` but gated the "→ bin" log suffix on
`kind !== spellToken | triggered | activated`. A negated `{Battle}` **unit**
therefore logged "→ bin" and was **silently erased into nowhere**. It was
reachable from Return to Nature, Calming Force, Finality and Temporal Rift, all
of which negate everything on the stack, and all of which are `{Battle}` spells
that can catch a `{Battle}` unit (Monke, Shard Sprite, Trench Stalker,
Tiderunner Initiate, Surly Stalker) mid-cast. A negated unit is binned.

**The hazard the change creates**, and it bit six cards: `negate()` now
*splices*, so `for (const it of g.s.stack) g.negate(it.id)` skips every other
item. Every sweep iterates a copy (`[...g.s.stack]`). Flame Shield was worse
than a skip — it counted its Fireball payout off the same loop, so negating two
spells paid one Fireball and left the second spell alive.

**Two things stopped being questions.** `targetStillLegal` for a stack target
is now just "is it still on the stack" — there is no such thing as a negated
item sitting there to exclude. And `resolveItem`'s negated branch is gone
rather than kept as a guard: its two callers are `resolveTop()`, which pops
from a stack that no longer holds negated items, and `commitItem(…, 'resolve')`,
which hands over an item freshly built with `negated: false` that was never on
the stack for anyone to answer. The `negated` flag survives on the type and on
the detached item, which is what the log line reads.

### ⚠ Ordering inside one resolution — needs a ruling

**Finality** reads *"Negate all other effects. Erase all cards in bins."* Under
the old behaviour the negated cards reached the bin a whole priority round
*after* Finality finished, so Finality did **not** erase the cards it had just
negated. Under R68 they are in the bin before the second sentence runs, so it
**does**.

The straightforward reading of the printed text is implemented — the sentences
resolve in order, and by the second one the cards are in bins — and
`test/61-negation.test.ts` pins that. But it is a real power increase on one
card, arrived at as a side effect of fixing something else, and the same shape
will appear on any future card whose second clause reads a zone its first
clause just filled. **Bena to rule.** If the answer is "no, a card negated by
this spell is not yet in the bin when this spell's own later clause looks",
that is a per-card ordering note on Finality, not a change to R68.

## R69 — A token entering a ZONE is really there, then a state-based sweep erases it; and Unstable is tested first

*(Playtest round 13, game UZRG, 2026-08-21. Sourced against the rules corpus
and Caleb's Discord rulings; Bena's ruling on the trash half. **Extended from
the bin to the HAND and the CACHE on 2026-08-22** — see the last section.)*

Three things that looked like three separate bugs are one branch, in
`E.destroy()`. As it stood:

```
if (u.token) …          // token: erased
else if (mods.length) … // Unstable: it and its mods are ERASED
else …                  // → bin, and R40 trashes it
```

### 1. The order is wrong — this is the UZRG bug

A **modded token** takes the first branch and never reaches the Unstable one.
At the table: a Wraith body carrying a Wraith mod (from `Blight's End`) died,
took the token carve-out, **came back**, and its mod's donated death trigger
fired as well — a double dip that no printed text authorises.

Unstable is now tested **first**. An Unstable *anything*, token or not, is
erased with its mods. `mods.length` is the whole test, which is what "Unstable"
has always meant here.

### 2. Unstable replaces the BIN, not the DEATH

The playtest report claimed the opposite — that an Unstable unit should not
die — and it is **mistaken**. Sources, in order of weight:

- `Rules/Algomancy-Manual.txt:886-888`, the PERMADEATH sidebar, is the only
  printed rules text; there is no glossary entry anywhere.
- Reminder text on both cards that GRANT it (Abyssal Evocation, Spell
  Excavation): *"(If they would enter a bin, erase them instead.)"* — a bin
  replacement, in as many words.
- Caleb 2025-03-13, asked *"Do unstable units die or do they just despawn into
  the erased zone?"* → **"They die"**.
- Caleb 2025-04-08, asked the exact graft-and-death-triggers version →
  **"unstable units still die, they just get erased instead of ending up in the
  bin"**.
- He distinguishes this from a genuine death-replacement: on Pull Under he
  would errata it *"to be a replacement, which wouldn't trigger death"*.

So the `died` event fires on every branch, death triggers go off, and other
cards' "whenever a unit dies" watchers see it. Only the destination changes.
The engine, `docs/03-mechanics-inventory.md`, `ui/glossary.ts`, `core.py` and
`cards.py` already had this right; nothing was changed for it beyond making the
branch order stop hiding it.

### 3. A dying token DOES reach the bin — and the printed Manual is wrong

> "Do tokens enter hand/bin before they are erased?" — **"yes, for the purposes
> of triggers"** (Caleb 2025-03-12)

> "Technically it does enter your hand and then gets erased immediately. So it
> would trigger any 'enters hand' stuff. Similar to how tokens can 'die'."
> (Caleb 2025-06-15)

Against `Rules/Algomancy-Manual.txt:361-362`, which says tokens go to the token
pile *"instead of the hand or bin"*. The designer overrides the printed line.

**Timing.** The erase is a **state-based action** and it resolves *before* the
trigger goes on the stack — *"state based effects happen to erase it and then
the trigger goes on the stack"* (Caleb 2023-09-12). That maps exactly onto the
engine's two-phase dispatch: `fireEvent()` only QUEUES triggers, so the token
is in the bin for the whole event window (every `when` predicate, the ledger,
the bin-zone scan) and out of it before anything RESOLVES.

⚠ **A conflicting ruling, recorded rather than smoothed over.** Caleb
**2025-03-09** said the opposite — tokens go to the token pile *"instead of
sending them to your bin"* — three days before the 2025-03-12 answer above.
The engine implements the majority and most recent reading. If the 03-09 line
is the intended one, this rule and R40's amendment both fall.

### And so: a dying token is trashed

Tokens are cards, they enter the bin, and they do not come from the stack —
which is R40's entire definition of trashing. **Bena's ruling, 2026-08-21**,
reversing R40's old flat "tokens are never trashed". See the amendment on R40
for the evidence and for the fact that the old clause rested on the reminder
text of a card that has since been cut.

The sequence `destroy()` now produces for an unmodded token, in order:

1. the card is pushed into the bin (the bin of `binTo` when a card redirects
   it — Pull Under — else the owner's);
2. `died` fires, and its listeners see the card sitting in that bin;
3. `noteTrashed` fires `trashed`, bumps the per-battle ledger and queues the
   card's own "when I am trashed" trigger;
4. the state-based sweep (`E.eraseFromBin`) removes it and records it in the
   public erased pile (R65);
5. only now does anything queued in 2 or 3 resolve.

⚠ **Step 4 is new information in the UI.** A dying token used to vanish with no
`erased` event at all, so R65's pile never listed one; now every Wisp, Wraith
and 1/1 that dies appends to it. That is *correct* — the card really was erased
out of a zone — but the pile was built to answer "which real cards are out of
the game", and token deaths are frequent enough to bury the answer. If Bena
wants tokens kept off the list, the change is in `E.ev()`'s erased-pile hook,
not in this rule: the erase itself still has to happen and still has to log.

**What this hands to card code.** A trash trigger that wants the trashed card
*back out of the bin* will not find a token there — `Cthyrian Rector` and
`Murkdrop Distiller` both already handle "no longer in the bin", but the Rector
sacrifices itself first and unconditionally ("sacrifice me. **If you do,**
recall that card"), so it now eats itself on the first token death on your
side and gets nothing. That follows from the printed text plus the timing
ruling, so it is implemented as written rather than patched — **flagged for
Bena** as the one place this ruling reads as a downgrade rather than an upgrade.
(Since [R73](#r73--sacrifice-me-is-a-cast-cost-paid-on-the-way-to-the-stack) the
Rector's self-sacrifice is a **cast cost**, which moves the payment earlier
without changing this: it still pays, and still finds nothing left to recall.)

### The window is not bin-only: it opens on the HAND and the CACHE too

*(Bena's ruling, 2026-08-22. The bin-only first pass was the wrong half — the
designer's answer is literally about a hand.)*

> "Can I recall a token unit? If so, I guess it is just erased, right?" —
> **"Yep. Technically it does enter your hand and then gets erased immediately.
> So it would trigger any 'enters hand' stuff. Similar to how tokens can
> 'die'."** (Caleb 2025-06-15)

> asked whether recalling a spell token triggers Rider of the Tides —
> **"Oh dang yeah it should also trigger it."** (Caleb 2025-04-24)

So a **recalled** token really does enter the hand: `E.recall` pushes the card
into the hand, stamps the despawn event `to: 'hand'` (R70) for a token exactly
as for anything else, fires it — and only then does the same state-based sweep
take it back out. The timing argument is unchanged and is the one Caleb gave
(2023-09-12): `fireEvent` only QUEUES, so the token is in the hand for the whole
event window and out of it before anything resolves.

**Consequences, all intended.** "When one or more cards enter a hand during
battle" now counts a recalled token — **Rider of the Tides** (the card Caleb was
asked about), **Xenopod Progenitor** and **Galerider Eel**. A recall is still
never a **trash**: a hand is not a bin, and R40 is about bins.

⚠ **The CACHE is the engine's call, not a ruling.** There is no designer
statement about a token being cached — none at all. `E.cacheUnit` opens the same
window (the card reaches the cache, the `cached` event fires with it really
sitting there, the sweep removes it) because the alternative is one zone
behaving differently from the other two for no stated reason. **Overturnable by
Bena** with no other change: the sweep is one call.

**One mechanism, not three.** `E.eraseFromBin` became `E.eraseFromZone(seat,
card, 'bin' | 'hand' | 'cache', msg, uid?)` and every caller — `destroy()`,
`recall()`, `cacheUnit()` — goes through it. The generalisation was clean: the
sweep was never bin-specific in substance, only in its name and its pile lookup.
The cache needed one extra parameter because its entries are `CachedCard`s with
a `uid` rather than bare names, and the caller minting the entry always has it.

**A fourteenth leave-play copy collapsed with it.** `batch-hybrids-ld-c.ts` held
a hand-rolled `putIntoHand()` for Capture ("put target unit into YOUR hand"),
copied from `recall()` line for line because the destination seat differs. It
had already drifted: it stamped no R70 `to`, so **Capture triggered no
"a card entered a hand" watcher at all**. `E.recall` now takes `{ to, verb }`
and `putIntoHand` is a one-line delegate. Every other hand-rolled leave-play
routine in `src/cards/**` was checked and is a deliberate **erase** path (no
bin, no despawn, nothing to share) — those stay local, correctly.

## R70 — Facts about a leaving unit ride the EVENT

*(Playtest round 13, 2026-08-21. Structural — no player quote; two live bugs.)*

`E.destroy()` deletes the entity as its **second statement**, before the `died`
event is even constructed, and then passes the deleted object by reference to
`fireEvent`. Triggers are queued, not resolved, so by the time one of them runs
`this.entity(sourceId)` is `undefined` and every fact about the dead unit has
to come from somewhere else.

The engine had already patched around this twice, in two different ways, which
is how you know an idea was missing: `counters` was stamped onto the death
event for Entropic Entity, and R40's trash trigger fabricated a **detached id
-1 ghost** so its `when` had something to read. Two point fixes, one absent
concept. Two bugs fell out of the gap.

### 1. Every "when I die" trigger resolved in the wrong region (R12)

`processTriggerQueue()` built its stack item with

```
region: this.entity(next.sourceId)?.region ?? this.actionRegion(next.controller)
```

For a death trigger the entity is *always* gone, so it *always* took the
fallback — the **controller's** action region, not the region the unit died
in. Reproduced: a death trigger offered a target standing in a different region
while withholding the ally standing beside the corpse. This affected **every
`self: true` "when I die" trigger in the pool**, and `test/62-death-facts.test.ts`
pins it (revert the fix and that test alone fails).

The fix is the general one: `PendingTrigger` carries the **region its source
fired in**, written at queue time in `collectTriggersFrom` (from `host.region`),
`fireOwnTrashTrigger` and `fireZoneTriggers`. Resolution reads
`entity(sourceId)?.region ?? next.region ?? actionRegion(controller)` — a live
source still uses its CURRENT region, because it may legitimately have moved
between firing and resolving; the new middle term only ever answers for a
source that is gone.

### 2. Rules logic was reading the log message

`batch-wood-c.ts`'s Saprophytic Oracle — *"whenever a **nontoken** unit dies"* —
decided token-ness with `when: (_g, _self, ev) => !ev.msg.includes('token: erased')`.
A dying Wraith logs different text, so it minted a 1/1 off a token death. This
was a **class**, not a case: four cards matched that phrase (Saprophytic Oracle,
Biomass Devourer, Soulforger, Fungal Gardener), Ghord matched
`ev.msg.includes('is sacrificed')` to read the verb, Galerider Eel matched the
word `'hand'` to ask where a recalled card went, and Rider of the Tides /
Xenopod Progenitor asked the same question by looking up the card's TYPE for
the word "Token" — which also read a unit going to a CACHE as one entering a
hand.

**The rule.** A message is for humans. Anything a `when` or an effect needs is
event DATA. `died` and `despawned` now both carry the full bundle:

| field | meaning |
| --- | --- |
| `unit`, `card`, `seat` | as before (`seat` is the CONTROLLER) |
| `owner` | the card's owner, which `binTo` can divorce from the controller |
| `region` | where it was standing when it left |
| `counters` | what it was carrying (the old one-off stamp, now part of the set) |
| `token` | was it a token — the "nontoken unit" test, for real |
| `verb` | `dies` / `is deleted` / `is sacrificed` |
| `to` | where the card went: `'bin'` \| `'erased'` \| `'hand'` \| `'cache'` |

All eight cards above were rewritten onto these. No rules predicate in the pool
reads `ev.msg` any more.

### The two patches collapse into one mechanism

R40's fabricated ghost and the death event's `counters` stamp were the same
idea twice. `fireOwnTrashTrigger` now takes an optional **anchor**: when the
trash happened *because a unit left play*, `destroy()` hands over the detached
entity it already has — real region, real counters, real owner — and the
fabricated id -1 stand-in remains only for a trash with no unit behind it (a
discard, a mill, a cached card binned). The anchor is copied, not used in
place, with `controller` forced to the trasher (R40: the owner of the bin the
card entered) and `mods: []` (R51: anything trashed out of play provably had
none), so composing the trigger cannot write a bounded budget onto a corpse.

The `trashed` event and the per-battle ledger take their region from the anchor
too — a unit that died in the other region used to have its trash counted, and
its own trash trigger dispatched, in its controller's home region instead.

**Deliberately not built:** the full "leaving play" limbo zone that was
originally scoped for this. The Wraith redesign (R71) removed its main
justification — nothing needs a dead unit to keep existing as an addressable
thing any more; it only needs its facts, and facts fit on an event.

## R71 — The Wraith token, redesigned; and "an ally" is not a target

*(Bena, 2026-08-21, supplying the printed card. Retires [R47](#r47--retired-2026-08-21-the-card-was-redesigned-see-r71).)*

```
Wraith — cost 0 [d], 3/3, "Blight Zombie Token Unit"
[Augment] At the start of deployment, put a -1/-1 counter on an ally.
          When I die, Augment a Wraith onto an ally.
```

Against the retired 4/4: the body is smaller; the first line stopped being a
self-shrink on attack/block and became a **start-of-deployment -1/-1 counter on
an ALLY**; and the second line stopped moving the dying Wraith and now
**creates a fresh one**.

**Four rulings from Bena — the first three needed before the engine could
script the card at all, the fourth (2026-08-21) settling this rule's one
remaining ⚠.**

1. **Both lines are live on a Wraith BODY standing in play**, not only when it
   is a mod. That is not a new principle — a card's own text-box `[Augment]`
   text has always been live while the card is itself a unit in play (Manual
   Q&A; it is what `fireEvent`'s `collectTriggersFrom(u, u.card, 'augment')`
   pass is for, and the retired Wraith already leaned on it) — but with one
   `[Augment]` over BOTH lines it now means a Wraith body carrying a Wraith mod
   has the text *twice* and does it *twice*. R55 is the neighbouring rule: the
   marker is a permission to be applied as an augment, not a payload.
2. **The death trigger mints a NEW Wraith.** The dying one is erased like any
   other token (via R69's bin window). It does **not** re-home itself; that was
   R47 and R47 is withdrawn. `E.augmentWraith` minting a brand-new token — long
   suspected of being a bug — is the correct behaviour, and it stays paired
   with `E.createWraith`: "create a Wraith" spawns the body, "Augment a Wraith
   onto a unit" applies one as a mod. Neither is redundant under the redesign.
3. **"an ally" / "on an ally" is NOT a target.** The word *target* is not
   printed, so the ally is chosen **on resolution**, with a plain
   `ctx.choose`. Consequences, all deliberate: it cannot be redirected
   (`E.canFillSlot` has no slot to move), *"when I become targeted"* (R53) does
   not fire, and it cannot **fizzle** for want of a legal ally — with no
   candidate it simply does nothing.

   ⚠ **This cuts against [R67](#r67--target-is-chosen-when-the-effect-is-put-on-the-stack-and-a-bracketed-cost-is-paid-there-too)** — "any card or effect that says
   'target' has to be chosen initially when put onto the stack" — and it does
   so **precisely because the word "target" is absent**. R67's own closing
   paragraph already carves this out ("choices that are *not* targets stay
   where they are"). Said here in as many words so the next reader does not
   "fix" the Wraith by adding a `TargetSpec`.

4. **"An ally" MAY be the Wraith (or its host) ITSELF — a unit is its own
   ally.** *(Bena's ruling, 2026-08-21; this was the rule's one open ⚠ and it
   is now settled in favour of what the engine already did.)*

   The reasoning, kept because it generalises past this card: **nothing on the
   card prints "another"**, which is the qualifier the pool uses everywhere
   else when it means "not me" — and is how `TargetSpec`'s `allyUnit` already
   behaves throughout. It is also the only reading under which the deployment
   line **has a candidate at all on a lone Wraith**, instead of being dead text
   on the commonest board state the card produces; and it is continuous with
   the retired printing, which shrank itself.

   `docs/08-light-and-dark.md`'s *"it is not a combat trigger and it does not
   shrink itself"* was the contrary evidence. It is describing the printed
   text's move from *"on me"* to *"on an ally"* — the trigger no longer
   **automatically** targets itself — not forbidding a self-pick. No change was
   needed in `wraithAllies`; the note above it in `registry.ts` records the
   ruling rather than asking for one.

**Registration.** The Wraith is now in `scripts/pool.mjs` and its printed data
is EXTRACTED from `AlgomancyCards-OracleText.json` like every other token card
(Wisp, Fireball, Poison) — stats, type, text, factions and art all come from
the oracle entry, and `registry.ts` carries behaviour only. It used to be a
hand-written `registerSynthetic`, which is what let its stats and its text
drift a full card revision out of date and go unnoticed. The project rule
("printed data is never hand-copied") is the whole reason this class of drift
is supposed to be impossible; the Wraith was the exception that proved it.

Its art is `Wraith.jpg`, not the generic-unit scan it used to point at.
`test/63-card-art.test.ts` now opens the file behind **every** registered
card's `image`, so a card silently rendering as a generic can never hide again.

## R72 — Formation gravity: the back row always promotes, the line closes ranks only before blocks

*(Playtest round 7, game BRDM, 2026-08-20 — reported, consciously deferred, and
fixed in round 13, 2026-08-21. The rule is **printed**; the engine had simply
never read it.)*

> "When a column becomes empty during combat, the columns to the right should
> immediately collapse and fill the gap. There can never be an empty column in
> the middle of a formation. The game fixes the formation as a state based
> action"

The player is right about the mechanism and wrong about the window, and the
Manual says so. **"HOLD THE LINE"** (p.22), verbatim:

> "Formations have a front and back row but can scale infinitely in width. […]
> Once a formation is set, the units are locked in position and are considered
> adjacent to their left, right, front and back neighbors until regroup where
> they all leave formation."
>
> "The front row of a column must be filled first before a unit can be placed
> in a back row."
>
> "If a unit is removed from a formation, any units behind it move to the front
> row and take its place."
>
> "If the last unit in a column is removed from a formation, the columns on its
> sides will close in to fill the gap. **This only happens before blocks are
> declared. After blocks, columns will not move to fill gaps.**"

### The finding: gravity has two halves with DIFFERENT timing

That asymmetry is the whole rule, and it is easy to miss because the two
sentences sit next to each other:

| | rule | when |
| --- | --- | --- |
| **vertical** | a unit behind a removed one moves up and takes its place | **always** — no qualifier, mid-combat included |
| **horizontal** | the columns on either side of an emptied one close in | **only before blocks are declared** |

So after the defender has answered, an emptied column is a **permanent hole**
in the attacking line, and every column index is frozen for the rest of the
battle. Back-row promotion keeps working throughout.

### What was there, and what changed

`E.removeFromFormation` spliced a dead unit out of its column — so vertical
gravity worked by accident, since splicing a dense array *is* promotion — but
the emptied column stayed in `b.columns` forever as a `[]`. A three-wide attack
whose middle column died kept fighting as three columns with a hole in it
**even in the attack step**, where the Manual says the line should have closed.
Adjacency counted the hole as a neighbour and the UI drew a blank slot.

`E.repairFormation()` now does both halves, with the window on the second one.
It is a **state-based action** in the sense the report asked for — run wherever
deaths are checked, never at one call site — but it is gated, not
unconditional. The first build of this rule ran the collapse *always*, including
between damage sub-steps; that was wrong, and the tests that pinned it are now
the tests that pin the window.

`E.beforeBlocksDeclared()` is the gate: battle steps `declare`, `attackWindow`
and `blocks`. Note the consequence — `b.blocks` is still `{}` throughout that
window, so **a collapse can never re-key a live block map**. The re-key path
exists for column-scoped counters and as belt-and-braces; the live case is
[R75](#r75--joining-a-formation-is-a-choice-and-adjacent-means-sides-and-abovebelow)'s
left-insert.

### The structural problem, and why index keys were kept

`BattleState.blocks` is keyed by attack-column INDEX — **the index IS the
column's identity** — so closing a gap is not a splice, it is a **re-key**, and
there are three things keyed by that index that must all move at the same
instant:

| keyed by column index | what happens on a shift |
| --- | --- |
| `blocks[ci]` | the blocking column moves with its attacker |
| `battleCounters['col:<ci>:…']` | the column's ledger moves with it |
| the `atk:${ci}` / `blk:${ci}` damage-source keys | local to one sub-step; never persisted |

`E.rekeyColumns(to)` is the single owner of that move, shared with R75's
insert, and it commits in one statement pair with nothing observable between —
which matters because "no priority" (R3) is not "no observers": a `when`
predicate runs synchronously inside `fireEvent`, and several read the formation.
`repairFormation` is called from `removeFromFormation` (the one funnel every
departure goes through — `destroy`, `recall`, `cacheUnit`) so the repair lands
*before* `fireEvent('died')`, and again at the end of `checkDeaths()` as the
state-based backstop for the several cards that edit `b.columns` directly.

Two details it gets right:

- **Column ARRAY OBJECTS survive; they are never rebuilt.** Card code holds
  column references (`E.columnOf`) and compares them by identity —
  `Object.entries(b.blocks).find(([, c]) => c === col)` appears in four card
  files.
- **An emptied BLOCK column keeps its key.** Manual, on blocking: *"The column
  is considered blocked even if the defending unit is removed during combat!"*
  Key *presence* is that sticky flag (R13), so `blocks[ci] = []` is a hole in
  the block assignment rather than a gap in a formation. And a blocking
  formation *"is allowed to be assigned with empty columns"* in the first place,
  so a sparse block map is never something to repair.

**Why not stable per-column ids.** Weighed and rejected, for reasons about this
repo rather than taste. `blocks` is not only engine state, it is the **wire
format**: the `declareBlocks` action carries `Record<number, EntityId[]>` keyed
by index, and *seed + action log = the whole game* is the project's hard gate,
so re-keying the action would invalidate every saved game in `server/games/`.
The identity would also have to live outside the thing it identifies — card code
pushes columns onto `b.columns` directly (`batch-wood-a`, `batch-water-b`,
`batch-fire-a`), so a parallel `colIds[]` drifts the first time a card grows the
formation. The only handle that cannot drift is the column ARRAY OBJECT, which
survives `structuredClone` but not the JSON the server and the saved games are
made of. And roughly a dozen card files compute `ci = b.columns.indexOf(col)`
and read `b.blocks[ci]` on the spot, so every one is correct the moment the
re-key is atomic. Index-as-identity is safe exactly when the index set changes
only in one atomic operation no observer can interleave with — and the Manual's
timing rule makes that set change in a *much* smaller window than the first
build assumed.

The Manual's *"can scale infinitely in width"* does not force the issue either:
an unbounded-left formation is handled by **normalising on every left-insert**
rather than by going negative, which is the same atomic relabel, keeps
`0..n-1` on the wire, and is observationally identical to negative indices.

### A blocker whose attackers all died — the special case dissolved

Bena, 2026-08-21, before the Manual passage surfaced:

> "It stays, but has nothing to deal damage to, so it doesn't deal damage. But
> it stays in the formation for the blocker, which means there's a 'hole' in
> the attackers formation."

The first half of that needed a special predicate — *a column holding blockers
is not empty* — and under the Manual it needs nothing at all: blocks have been
declared, so **no column moves**, and the hole is just the general rule. The
special case is gone from the code. What survives is the damage half:

**A blocking column whose attackers are all dead deals nothing, Piercing
included.** Piercing is the excess left over after damage is *assigned* (R7);
with nothing to assign to there is no exchange for it to be the excess of.
Verified against the pre-R72 engine: a `Good Whale` (7/5 {Piercing}) blocking a
column whose lone attacker was killed in the block window used to push its full
**7 into the attacking player's face**. Reachable from any spell that kills a
blocked attacker before damage.

Note the deliberate asymmetry with **R13**, which is the Manual's own: a
Piercing *attacker* still gets through a dead block, because *"the column is
considered blocked even if the defending unit is removed during combat"* — there
the attack is still real; here it is the attack that is gone.

### ⚠ The client's in-progress block assignment is index-keyed too

`ui/formation.ts` says it in as many words — *"THE INDEX IS THE MEANING"* — and
the block-building preview keys the defender's half-finished assignment by
attack-column index. The Manual's window makes this *the* remaining hazard
rather than an incidental one: the collapse now fires only during `declare` /
`attackWindow` / `blocks`, and the `blocks` step is exactly when the defender is
clicking. A spell that kills an attacker mid-assignment shifts the indices under
the client.

The engine is safe either way — `doDeclareBlocks` validates every key against
the current `b.columns` and refuses one that no longer exists, so the worst case
is a rejected declaration rather than a misplaced blocker. But the client should
re-seed its preview when `b.columns.length` changes, and it does not yet.
Engine-side work is done; this one is a UI follow-up.

### ⚠ A blocker may not be assigned where no attacker is — the engine is stricter than the Manual

The Manual: *"Units may even be placed blocking in slots where attackers aren't,
which can be beneficial for adjacency matters cards."* `doDeclareBlocks` refuses
that — `e.need(atkCol, 'no such attacking column')` — so a blocking formation can
only ever be as wide as the attack. Under the current data model it has to: a
blocking column is addressed by the attacking column it answers, and a blocker
standing opposite nothing has no key. Left alone deliberately, and noted here
because it is a printed rule the engine does not implement, not an oversight.
Fixing it means giving the blocking grid its own width, which is the one change
that would genuinely force stable column ids.

### Park hygiene — why this report came back at all

The round-7 commit message closed with *"Still open, deliberately:"* and four
items, and left **zero trace in the repo**: no `PARKED` comment, no ⚠ here, no
`{ todo: true }` test. The engine README's own rule is that each parked thing
carries a todo test naming the primitive it waits on, *so the todo count is the
backlog*. These four were outside that accounting, so nothing could report them
and two came back as fresh reports. Audited in round 13:

| round-7 deferral | status |
| --- | --- |
| Necromorph's second target | **closed** — R64 gave bin cards a real `TargetRef` |
| Formless's attribute-removal half | **closed** — R62 is the suppression layer |
| the empty-column collapse | **closed** — this rule |
| Eldritch Dreamtender's sacrifice timing | **closed** — [R73](#r73--sacrifice-me-is-a-cast-cost-paid-on-the-way-to-the-stack): the sacrifice is a cast cost, paid on the way to the stack |

Eldritch Dreamtender was a rules question rather than a missing primitive, and
it was answered within the day: R73 reads *"sacrifice me"* as a **cast cost**,
paid on the way to the stack. Its ledger entry closed the same round it was
written down — which is the point of writing it down.

No other deferral in the playtest-round commit history is off the ledger: every
other "parked" in those messages is a card that does carry its todo test.

## R73 — "Sacrifice me" is a CAST COST, paid on the way to the stack

*(Bena's ruling, 2026-08-22, on the game-BRDM report about Eldritch
Dreamtender.)*

> "Technically, Eldritch Dreamtender needs to be sacrificed for its ability to
> go on the stack, but it's still visually in play while resolving its trigger."

The card reads *"[Augment] When my column deals combat damage to an opponent,
**sacrifice me. If you do,** look at that player's hand and discard a card from
it."* The sacrifice used to be a `g.destroy(self, 'is sacrificed')` **inside
`effect.run`** — at resolution, after a whole priority window with the unit
still standing on the board. The report is right, and the ruling is: **read the
printed prose as a bracketed cost.**

**What was missing was one primitive, and only one.** The *window* was already
solved: R64/R67 settle bracketed costs in the cast window for spells, activated
abilities **and triggered items alike** (`buildTriggerItem` → `collectTargets` →
`collectCastCosts`), so an `EffectDef.castCost` on a `TriggeredAbility` was
already being honoured. What `CastCost` could not say was *"sacrifice **me**"*:
`sacrificeUnit` / `sacrificeUnits` offer **every unit you control in the
region**, which would let the player sacrifice a different unit — a different
card. (`AbilityCost.sacrificeSelf` exists but is reachable only from an
`ActivatedAbility`; a `TriggeredAbility` has no `cost` field at all.)

**The shape follows the existing precedent.** `removeCounters` already carries
`from: 'allies' | 'self'` and resolves `'self'` through `item.sourceId`;
`sacrificeUnits` now carries `from?: 'self'` and does the same. Four touch
points in `engine.ts`:

| touch point | what `from: 'self'` does |
| --- | --- |
| `canPayCastCost` | payable **iff the source entity is live, non-absent and controlled by the paying seat** — deliberately NOT `unitsOf(seat, region).length >= 1` |
| `costIsIterated` | **false**: the cost carries no choice, so it falls through to be charged outright — no decision, no suspension |
| `chargeCastCost` | snapshots the source's stats into `costPaid.sacrificedUnits` (uniform with the chosen-unit path), then `destroy(u, 'is sacrificed')` |
| `castCostLabel` | *"sacrifice me"* |

The payability test is the subtle one and is the reason it is not a unit count:
**a dead source has to make the cost unpayable**, so R5 partial resolution sets
`part.spent` and skips the part. That is the right answer for a trigger whose
source died between firing and settling — and it also guarantees an ally
standing beside the corpse is never eaten in its place.

**The consequences are understood and INTENDED, not side effects.** As a cost
the sacrifice becomes:

- **mandatory** — the printed "if you do" is gone; a choice-free cost on an
  effect's own text is charged outright (the decline option exists only for an
  optional grafted rider);
- **unrespondable** — no decision means no suspension means no window between
  the payment and the item reaching the stack;
- **a total skip when the source is already dead** — no hand is looked at and
  nothing is discarded.

That is what *"sacrificed for its ability to go on the stack"* means. The
printed line is effect prose with an if-you-do rider rather than a printed
`[cost]`; the ruling reads it as a cost anyway.

### Sibling sweep — every self-sacrifice in the pool, and where each landed

The printed shape is prose with an if-you-do rider, not a bracketed cost, so it
had to be found by reading rather than by grep on `castCost`. Fourteen printed
cards mention sacrificing themselves. **Three moved:**

| card | printed line | why it moves |
| --- | --- | --- |
| **Eldritch Dreamtender** | *"When my column deals combat damage to an opponent, sacrifice me. **If you do**, look at that player's hand and discard a card from it."* | the report's card; exact shape |
| **Cthyrian Rector** | *"When you trash another card, sacrifice me. **If you do**, recall that card from your bin."* | identical shape, mandatory, no rider condition |
| **Void Mandible** | *"When a nontoken card is played during battle, sacrifice me. **If you do**, negate that effect. (This is not optional.)"* | identical shape — and the printed *"(This is not optional.)"* says out loud what the cost reading already gives |

**Deliberately NOT moved, with the reason in each case:**

- **Ploosh** (*"Otherwise, sacrifice me and you lose 3 life"*) — genuinely
  conditional on a life-parity check made at resolution. There is no cast-time
  moment at which you know whether it is owed.
- **Maelstrom Charger** (*"you **may** sacrifice me. If you do, copy that
  spell"*) — printed as OPTIONAL. A choice-free cost would make it mandatory,
  which is a behaviour change the printed text refuses.
- **Smouldering Inferno**, **Wisp** (*"After combat, sacrifice me."*) — the
  sacrifice IS the whole effect; there is no rider for a cost to buy. Moving it
  would also break **Infernal Wispweaver**, whose *"your wisps … do not
  sacrifice themselves"* works by suppressing the Wisp's one ability.
- **Oracle of the Flame**, **Sprouter**, **Prismatic Observer**, **Skybreaker**
  — already correct: printed *"Sacrifice me:"* colon-costs on ACTIVATED
  abilities, carried by `AbilityCost.sacrificeSelf` and charged in the same
  cast window.

⚠ **Two left flagged rather than guessed at** — both are printed costs the
engine still pays at resolution, but neither is the shape R73 built and each
needs its own decision:

- **Throwing Boulder** — *"Sacrifice me: I deal 3 damage to any target.
  Activate this ability only if I have an adjacent ally."* A printed
  colon-cost ACTIVATED ability that carries `cost: {}` and destroys itself
  inside `run` (the file calls this "the Immolate precedent"). It wants
  `sacrificeSelf: true`, not `castCost` — plus an activation gate for the
  adjacency clause, which does not exist. **Not moved.**
- **Deformant** — *"Sacrifice me **and another ally**: …"* A compound cost no
  `AbilityCost` shape covers; it would need `sacrificeSelf` **and** a
  sacrifice-another atom in one cost. **Not moved.**

**Closes the last round-7 deferral.** `test/53-playtest-round7.test.ts`'s ledger
listed *"Eldritch Dreamtender's sacrifice timing"* as the one item still open;
the `{ todo: true }` tests in `test/26-metal-a.test.ts` and
`test/53-playtest-round7.test.ts` are now real tests.

⚠ **Still open, and genuinely a separate question: WHEN inside combat damage.**
R73 settles *whether* the sacrifice is a cost, not *which damage sub-step* the
trigger fires in. The trigger fires off the aggregated combat `lifeLost` event
and R3/R31 resolve it immediately, so a Dreamtender in a Swift column is gone
before normal damage. That reading is still the engine's default rather than a
ruling, and the todo in `test/53` says so.

## R74 — A variable cost may WARN that X = 0 does nothing; it may not forbid it

*(Bena, 2026-08-22, from Necromantic Rebuke — having checked the physical card.)*

The printed line is exactly

```
[Erase X cards from your bin]: Negate up to one target effect unless its
controller erases X cards from their bin.
```

so the encoding is **correct as printed** — no transcription bug, no missing
`xMin`, and none of the mechanics changed. What is wrong is that **X = 0 is a
guaranteed no-op and nothing told you**: the ransom "erase 0 cards" is met by
the controller doing nothing at all, so the negate can never happen, and the
first the caster hears of it is the spell fizzling.

**The ruling is a warning, not a prohibition.** X = 0 stays legal and the option
stays on the table. This is deliberately different from `CastCost.xMin`, which
**forbids** — compare No Hand Killer's `xMin: 1`, which exists so a zero cannot
burn a `[once]` budget the player never gets back. The distinction:

| | use |
| --- | --- |
| `xMin` | paying zero **costs you something irreversible** — refuse it |
| `xZeroWarning` | paying zero is **merely a bad idea** — say so and allow it |

**A declared seam, not a per-card patch.** `EffectDef.xZeroWarning?: string` is
a one-line statement of *why* zero does nothing, declared on the effect because
that is where the fact lives. `collectCastCosts` surfaces it on the
`"That's enough — X = 0"` option — the one moment the payer can still change
their mind — and `finishVariableCost` logs it when a variable cost closes at
zero on its own (an empty pool raises no decision to hang it on).

Four cards share the shape and all four now declare it: **Necromantic Rebuke**
(negates nothing), **Malevolent Machinations** ("up to X effects" is up to
none), **Discharge** (0 damage), **Flesh Tithe** (no unit). Every one of them
already said it at RESOLUTION, which is far too late to be of any use.

`DecisionOption.warning?: string` carries the text to the client. The warning is
**also appended to `label`**, so a client that ignores the field still shows it;
the field exists so a client that cares can style it as a warning rather than as
prose.

## R75 — Joining a formation is a CHOICE; and "adjacent" means sides and above/below

*(Bena, 2026-08-21, two rulings. Replaces five per-card approximations of the
first and one of the second.)*

### The placement rule

> "When something spawns something 'in my formation' or 'in formation', it's up
> to the controller of the effect to choose where the unit goes. They can put it
> to either side of the existing units OR in the second slot of a column for a
> column which only has 1 unit. That choice should be made on effect
> resolution."

Nothing in the engine did this. **Placement was auto-picked, per card, with a
different rule each time** — five cards, five house rules for the same printed
words:

| card | what it used to do |
| --- | --- |
| Hooba-Bot | "my column if open, else the first open column on my side" |
| Hooba-Lin | my column's back slot, else open a column on the right |
| Hooba-God | my column's back slot, or **nothing at all** if it was full |
| Hooba-Pon | "my column if open, else the first open one" |
| Tiderunner Initiate | actually asked — and is where the slot logic was invented |

`E.formationSlots(seat)` is now the single answer to *where can a unit join this
formation*, and `E.placeInFormation(unit, ctx)` raises the choice. All five cards
route through it and their own placement code is gone.

**The legal placement set.** Three kinds, left to right:

- **a new column at either END of the line** — leftmost or rightmost;
- **the BACK slot of a column that holds exactly one unit**;
- **the front slot of an R72 hole** — a column emptied of attackers that its
  blockers are holding open.

The first two are the ruling as printed. Two things in that list are readings,
and are said here so the next reader knows they were decided and not overlooked:

⚠ **"Either side of the existing units" is read as the two ENDS, not as an
insertion between two existing columns.** "The existing units" is taken to mean
the line as a whole. A card that wanted to split a formation down the middle
would be a different, louder effect.

⚠ **The hole is a third kind the ruling does not enumerate.** It is kept because
the engine already offered it (Tiderunner Initiate), because a hole genuinely is
an open position in the line, and because it is the **only way a formation ever
heals a hole** — R72 can open one and nothing else can close it. It cannot
create a hole, so it cannot conflict with R72. A unit that takes a hole walks
straight into the block that is holding it open, which is a real consequence and
is pinned by a test.

**Only the ATTACKING line can widen.** A blocking column is keyed to the
attacking column it answers (R72 — the index *is* the identity), so a new
blocking column has no index at which to exist. That also means "there is no
open position" is, in practice, a **defender's** problem: an attacker's line can
always grow at an end. A formation you are not standing in cannot be joined at
all — with no living unit in the grid the answer is "no slots", not "open a
column out of nowhere".

**Resolution time, not cast time.** Nothing here prints *target*, so this is a
choice and not a target — same shape as R71's "an ally": a `ctx.choose` at
resolution, auto-picked when exactly one placement is legal, and a **logged**
no-op when none is. The chooser is the **effect's** controller. `optional: true`
adds a "stay out of formation" answer for the one card whose text says *you may*
(Tiderunner Initiate). Every branch emits an event: an effect that resolves into
silence is a conformance failure, and *"there was nowhere to put it"* is exactly
what a player needs told.

**Inserting at index 0 is the dangerous case, and it has one owner.** Opening a
column on the left shifts every existing column right, so every `blocks` key and
every column-scoped counter shifts with it. That is the same re-key R72's
collapse performs in the other direction, and both now go through
`E.rekeyColumns(to)` — one atomic commit, nothing observable in between. It is
worth noting what this replaced: Hooba-Nan carried a
`Object.keys(b.blocks).length === 0` guard that existed *solely* because
unshifting a column renumbers block keys and the card could not do it safely.

### The adjacency rule

> "If a unit references its own adjacent slots (which only exist if it's in a
> formation) it's referring to its sides and above/below. Nothing diagonal."

and the Manual says the same thing in the same words — "HOLD THE LINE", p.22:

> "Once a formation is set, the units are locked in position and are considered
> adjacent to their **left, right, front and back** neighbors until regroup
> where they all leave formation."

Written down in the engine for the first time. Relative to a unit at grid position
(column `ci`, row `ri`):

- `(ci - 1, ri)` — the neighbouring column, **same row**
- `(ci + 1, ri)` — likewise on the other side
- `(ci, 1 - ri)` — the other slot in its **own** column

and nothing else. **The other row of a neighbouring column is diagonal and is
not adjacent.** `E.adjacentSlots(id)` returns the empty ones; `E.adjacentInFormation(id)`
is the same definition read for units rather than for slots, and both take their
grid from one private `formationGrid(seat)` so they cannot drift apart.

A card that names slots relative to itself — Hooba-Nan's *"all my empty adjacent
slots"*, Rousing Spirit's *"the empty slot behind me"* — is describing a derived
set of positions, so it does **not** get the placement choice. It fills exactly
those slots. Only *"in my formation"* / *"in formation"* with no positional
qualifier is a choice.

**Two questions the code had to answer, both settled by the parenthetical
"which only exist if it's in a formation":**

⚠ **Past the edge of the line is NOT a slot.** A unit in the leftmost column has
no left-adjacent slot; it does not have an implicit one at which a new column
could be opened. This **changes Hooba-Nan**: it used to front fresh columns at
both edges (a lone Hooba-Nan grew a one-column attack into three), and now a
lone Hooba-Nan makes exactly one 1/1, behind itself. Note that `formationSlots`
*does* offer both ends — the two rules genuinely disagree about the space past
the last column, and deliberately: **joining** a formation is a choice about the
line as a whole, **adjacency** is a position derived from a unit.

**The front row always fills first** — and that is *printed*, not derived:
*"The front row of a column must be filled first before a unit can be placed in
a back row."* So a column is `[]`, `[front]` or `[front, back]` and never
`[gap, back]`, and the engine upholds it structurally: `repairFormation`'s
vertical half promotes the back row (R72), the dead-id sweep splices, and every
placement appends. A slot is therefore fillable only when the column's next free
row *is* that row (`col.length === row`), which makes "the back slot of a column
whose front is empty" **unreachable rather than a case to handle** — a unit put
there would slide to the front, and the front of a neighbouring column is
diagonal. Asserted impossible rather than handled, in
`test/64-formation-collapse.test.ts` and `test/66-formation-placement.test.ts`.

**Infinite width, without negative indices.** *"Formations […] can scale
infinitely in width"*, in both directions — so `formationSlots` always offers
both ends and there is no formation too wide to add to. The engine keeps
`0..n-1` integer keys and **normalises on every left-insert** instead: the
insert relabels every column, every `blocks` key and every column-scoped counter
in one atomic `rekeyColumns` commit, which is observationally identical to
letting the leftmost column be −1 and keeps the `declareBlocks` wire format (and
therefore every saved game) replayable. See R72 for the full weighing.

## R76 — Alluring duties are discharged TOGETHER, and `legalActions` has to be able to say so

*(Fuzz seed 1993, 2026-08-22. A stuck state: no legal action for either player,
no pending decision. The rule was right; the engine could not express it.)*

The fuzzer stopped on this position, at the block step:

```
attacker: two one-unit columns, BOTH {Alluring}
defender: four units, all able to block
blocks:   {}          → and no legal action for anyone
```

Alluring (Manual): *"defenders that are able to block it must block it."* Two
Alluring columns and two able blockers means **both duties are live at once**,
so the only legal declarations are the ones that block both. `legalActions`
offered a *representative* set of declarations that each blocked exactly **one**
column — `{ [ci]: [u] }` and `{ [ci]: [u, v] }` — and then filtered the set
through the validator's own `unmetAllure`. Every option left the other Alluring
column unblocked with a blocker to spare, so every option was filtered out. The
list came back empty for the defender, the attacker had no priority, and the
game had nowhere to go.

**Nothing was wrong with the position.** `{0: [a], 1: [b]}` was legal the whole
time and `apply()` would have accepted it. The engine simply could not think of
it — a representative set that cannot represent any legal answer is not a
representative set, it is a hang.

**This is exactly as old as Alluring.** The single-column generator and the
compulsory filter landed in the same commit, playtest round 7 (2026-08-20),
and nothing has touched either since; R72/R75 were ruled out by rebuilding the
position by hand with both of them disabled. The round-7 note reasoned carefully
about *two Alluring columns against ONE free blocker* — "a duty you cannot
discharge twice is discharged once" — and that case does work. It is two
Alluring columns against **two** blockers, where the duty **can** be discharged
twice and therefore must be, that had no representative.

### The fix: build the compulsory core first, then offer choices on top of it

`unmetAllure` and the generator now read the same intermediate object. One
`alluringDuties(e, seat, blocks, send)` returns, per unblocked Alluring column,
*who could still be added* and *how many it would take*:

- `unmetAllure` reads them to **refuse** a declaration — any duty with
  `free.length >= need` is unmet.
- `compulsoryBlocks` reads them to **build** one — assign each duty its `pick`,
  greedily, in column order.

Greedy is provably sufficient, which is why there is no search here: a duty left
unblocked was left unblocked because fewer than `need` units were free when it
was reached, and later assignments only shrink the free pool, so it is still
discharged at the end. Order cannot matter, and the result always satisfies
`unmetAllure`. Every declaration `legalActions` offers is now `{...core,
...oneMoreColumn}`, and the bare core is always offered — legal by construction,
so **the list is never empty**.

The `pick` is not simply "the first `need` free units": {Evasive} wants two
blockers *unless* one of them is {Pure}, which switches the attribute layer off
for the whole exchange (R61) and lets it block alone. The duty carries the
concrete units so the generator and the validator cannot disagree about which
ones satisfy it.

### A second stuck state, found by reading rather than by fuzzing

An attacker that is **alone, {Sneaky} and {Alluring}** was the same hang from the
other direction: R20 forbids blocking a lone Sneaky attacker, and Alluring
demanded a block, so *every* declaration was refused by one rule or the other.

The resolution is in the printed word "able": if the rules forbid blocking it,
nobody is able, and the duty is discharged by doing nothing. `alluringDuties`
now excludes a lone Sneaky attacker's would-be blockers — except a {Pure} one,
which sees through Sneaky like every other attribute (R61) and is therefore
still able, and still compelled.

### The general lesson, for the next representative set

`legalActions` is documented as returning a representative set rather than an
exhaustive one, and for formation-shaped actions it has to be — the space is
exponential. But *representative* has a floor: *if a legal action exists, at
least one must be offered.* Any rule that makes legality **conjunctive across
independent parts of one action** — as Alluring does across columns — breaks a
generator that varies one part at a time. The fix shape generalises: compute the
compelled part first, then vary what is free.

The fuzzer's existing "legalActions lied" invariant catches the opposite error
(offering something `apply` refuses) and cannot see this one; the stuck-state
check is what catches this direction, and it did.

## R77 — "Activate this ability only if …" is a GATE, and a self-sacrifice is a COST

*(Playtest XCYX, 2026-08-22, Throwing Boulder. Applies R73's ruling to an
activated ability, and R64's principle to a printed precondition.)*

> "Throwing Boulder was allowed to be activated without having adjacent allies.
> It didn't resolve, but it shouldn't have been allowed to be activated. And
> also, in order to activate it, sacrificing him should have happened as a cost
> to even put the ability on the stack"

Both halves were real, and both had been predicted the same day by the agent
that built R73, which declined to guess and left a note. The card reads:

```
Throwing Boulder — e/1, 0/3 Rock Unit
[Augment] Sacrifice me: I deal 3 damage to any target.
          Activate this ability only if I have an adjacent ally.
```

and was scripted with `cost: {}`, a `g.destroy(self, 'is sacrificed')` in the
middle of `run()`, and the adjacency condition as an `if` beside it. So it was
offered, activated, targeted, resolved — and then printed "no adjacent ally"
and did nothing, having cost nothing.

### The sacrifice is an activation cost

`AbilityCost.sacrificeSelf` already existed and four cards already used it
(Oracle of the Flame, Sprouter, Prismatic Observer, Skybreaker). Throwing
Boulder now carries it, so R49/R57 apply unchanged: the cost rides on the item
and is paid **inside the cast window, after targets are chosen and before the
item reaches the stack**. Nobody may respond between the cost and the effect,
and the unit is in the bin while its ability is still waiting to resolve —
which is exactly what "sacrificed to even put the ability on the stack" means.
This is R73 (a triggered ability's "sacrifice me") one shape along.

### The precondition is a gate, not a fizzle

`ActivatedAbility.usableWhen?: (g, self, seat) => boolean` is new — a general
seam, not a carve-out, because "this ability is only usable under condition X"
is a recurring shape and three other cards in the pool already wanted it.

It joins the two gates R64 added, in one predicate (`abilityUnusable`) called
from both `legalActions` (do not offer it) and `doActivateAbility` (refuse it):

| gate | rule |
| --- | --- |
| a printed precondition is false | R77 |
| a bracketed [cost] on the effect cannot be paid | R64 |
| a mandatory target has nothing legal | R64 |

**Ordering is load-bearing and it is checked first.** The condition is about the
source, and the cost destroys the source. `doActivateAbility` evaluates every
gate before anything is paid, so a self-sacrificing ability's cost can never
invalidate its own condition. `self` is the source unit — the *host* when the
ability was donated by an augment — so "I have an adjacent ally" reads
correctly either way.

**And it is not re-checked at resolution.** R1: conditions are checked once, at
the moment the rule names — here, activation. For this card it could not be
re-checked even in principle, since the cost has already removed its own subject
by the time the ability resolves. If the ally dies in response, the boulder
still lands. That is the same shape as every other R1 condition and needs no
special case.

Adjacency itself is [R75](#r75--joining-a-formation-is-a-choice-and-adjacent-means-sides-and-abovebelow)'s
`E.adjacentInFormation`: sides and above/below, nothing diagonal. Adjacent
allies only exist while the unit is *in* a formation, so out of combat this
ability is simply never offered — which is correct, and was previously another
way to waste it.

### The sibling sweep

Every activated ability in the pool was checked for the same shape — a board
condition knowable at activation, tested at resolution instead. Converted:

| card | condition, previously checked at resolution |
| --- | --- |
| **Throwing Boulder** | "only if I have an adjacent ally" |
| **The Bonesculptor** | the deploy window (re-implemented by hand) + "is there an ability-free unit in my bin I can afford" |
| **Gridxlan** | the deploy window + the printed "if your hand is empty" + "is there a unit in my bin I can afford" |
| **Deformant** | "another ally" to sacrifice |

The Bonesculptor and Gridxlan are the sharpest of these after the report itself:
both are `bounded`, so being offered when they could do nothing did not merely
waste a click — **activating burnt the once-per-turn budget**, and both cards'
own headers admitted it ("activating outside deployment wastes the budget").
Both were also re-implementing `ActivatedAbility.timing`, which R49 added for
exactly this, at resolution and by hand.

**Not converted, deliberately.** Everything else that early-returns from an
activated ability's `run()` is one of two legitimate things: a **target that
vanished** between activation and resolution (R5's fizzle — it was legal when
offered), or a **mid-resolution choice that came back empty** (a decline).
Neither is knowable at activation, and turning either into a gate would be
wrong.

### ⚠ Deformant's cost is still parked

*"Sacrifice me **and another ally**"* is a **compound** cost, and `AbilityCost`
has no shape for one: `sacrificeSelf` and `sacrificeOther` exist separately and
cannot be combined into a single indivisible payment. Deformant therefore still
picks and sacrifices at resolution. R77 fixed the offer half — it is no longer
offered when you have no other unit — but the payment window is unchanged, and
it now carries a `{ todo: true }` test naming the missing cost shape, per the
project's park rule.

## R78 — An item stays on the stack until it has ACTUALLY resolved

*(Playtest round 13, 2026-08-22. The presentation half of the R68 machinery.)*

> "The current way that effects resolve is confusing. To my opponent, it looks
> like something already resolved and there's something confusing about seeing
> 'xyz resolves' while your opponent is actually choosing how their effect
> resolves. It would make more sense if there was a different state before
> resolution like 'Opponent is resolving [effect]' and leave the effect on the
> stack until it's ACTUALLY resolved (and its resulting effects are reflected
> on the board). Right now, having it leave the stack while the player is
> choosing things looks wrong."

**The structural cause is that `resolveTop()` popped first and resolved
second.**

```ts
resolveTop(): void {
  const item = this.s.stack.pop()!;   // gone from the game state…
  this.resolveItem(item);             // …and only now does anything happen
  this.finishResolutionTail();
}
```

`resolveItem` can suspend: the decision-point model (`state.decision` +
`state.suspension`) throws out of the middle of a part, rolls the state back to
that part's boundary, and replays it once the answer arrives. For the whole of
that window — which is however long a human takes to click — the item was
referenced by **nothing but the suspension**. It was not on the stack, its
effects had not happened, and the log had already said "X resolves." The
opponent's screen showed an empty stack and an unchanged board.

### The state: `GameState.resolving`, not a flag on the stack

The obvious shape is `StackItem.resolving = true`, left in `s.stack`. **That is
the shape [R68](#r68--negating-an-effect-removes-it-from-the-stack-then-and-there)
just deleted**, and the reason it deleted it applies here with a sharper edge.

R68's argument was that a flag-on-the-stack makes every reader of `s.stack`
responsible for remembering the flag, and that the readers do not remember. A
resolving item is genuinely different from a negated one — it is really still
there and it really will finish, where a negated one was finished and loitering
— so "reintroducing `negated`" is not by itself the objection. The objection is
concrete, and it is the card pool:

> **Temporal Rift, Finality, Return to Nature, Calming Force, Flame Shield** all
> resolve by sweeping `for (const it of [...g.s.stack]) g.negate(it.id)`.

Put the resolving item back in `s.stack` and **Temporal Rift negates itself,
mid-resolution, from inside its own `run()`**. Every one of those cards would
need a new "except the one that is resolving" clause, and so would
`targetCandidates`, `passPriority`'s `if (this.s.stack.length)`, `settle()`'s
combat-damage resume, `finishResolutionTail`'s `lenBase`, and everything
written after this. The invariant that keeps them all correct is worth more
than the field placement:

> **`s.stack` is the items still WAITING to resolve. Nothing else.**

So the resolving item lives in its own field, `GameState.resolving:
StackItem | null` — additive and optional, so a pre-R78 saved state reads as
"nothing is resolving". `E.resolveTop()` sets it after the pop and clears it
after `resolveItem` returns; a suspension throws straight past the clear, which
is precisely the mechanism.

**The client reads `state.resolving`.** It is a whole `StackItem`, so the label
is `resolving.label` and *whose* effect it is is `resolving.controller` —
`controller !== mySeat` is the "Opponent is resolving …" case. It is not
redacted: `server/view.ts` structured-clones the state and blanks a named list
(opponent hand, deck order, seed, the other seat's decision), and this is not on
it. Nothing else needs to change server-side.

### Responding to a resolving item: no, and it falls out for free

The last response window closed when both players passed; a resolving item is
past that. All three sites were checked and all three are already right,
*because* the field is not in `s.stack`:

| site | why it excludes a resolving item |
| --- | --- |
| `targetCandidates` (R60 "target effect") | iterates `this.s.stack` |
| `E.negate` / `E.removeFromStack` | `findIndex` over `this.s.stack` |
| `legalActions` | returns **only** `decide` actions while `s.decision` is set, and a resolving item exists only while one is |

`apply`'s `dispatch` closes it a second time: every action except `decide` and
`concede` is refused outright while a decision is pending. So the answer is
enforced twice over, and a test pins both.

### Replay determinism: ONE object, deliberately

This is the part that could have gone quietly wrong. `resolveParts` suspends by
replacing the entire state with a pre-part snapshot (`this.s = snap`) and then
storing the **live** item on the suspension. With a second reference to that
item now living in the state, the snapshot's copy and the suspension's original
are two different objects the moment the rollback happens — and they would drift
apart forever, because `structuredClone` (which `apply()` runs on every action)
clones them independently once they are distinct.

The rollback therefore re-points the marker at the live item:

```ts
this.s = snap;
this.events.length = evLen;
if (this.s.resolving) this.s.resolving = item;   // one object, not two
```

`structuredClone` **preserves internal aliasing** — shared references inside one
clone stay shared — so from here on `s.resolving === s.suspension.item` survives
every action boundary, every save, every replay. Using the live item (rather
than the snapshot's copy) also keeps the behaviour byte-identical to pre-R78:
that is exactly what the suspension already carried. `test/fuzz.ts` asserts the
aliasing as an invariant, and `replay(seed, actions)` is pinned bit-identical.

### Every exit clears it

`resolveTop` and `commitItem(…, 'resolve')` each capture the previous marker and
restore it, and `doDecide`'s resume clears it once `afterParts` has returned. That single clear point covers every way out of
`resolveItem` — a normal resolution, an R5 fizzle, a partial resolution whose
parts all skipped, a virus whose host vanished, and the `commitItem` no-window
path behind the `stackFlash` beat. `loseLife`/`concede` clear it too, so a game
that ends mid-resolution does not end holding one. `checkInvariants` makes a
stranded marker a fuzzer failure: **`resolving` non-null with no `s.decision`
open is a stuck state**, and this codebase has just had two of those.

**Resolution nests, and the fuzzer proved it inside 700 games.** A battle
resolution can end the battle; `settle()` then resolves a start-of-deployment
trigger *inline*, under the outer `resolveItem` that is still on the JS stack.
If that inner trigger suspends, the throw unwinds the outer resolution
completely — it is abandoned, not paused, and nothing will ever finish it. So
the rollback **assigns** the marker rather than re-pointing whatever was there:
the item that is suspending is the only one that may stay marked, and the phase
gate below is re-applied at the same moment. (Seed 693: a Wraith's
`startOfDeployment` trigger suspending under a battle resolution, publishing a
marker in the deploy phase. `test/67` pins it by seed.)

### ⚠ Battle phase only — and why

`beginResolving` publishes the marker only while `s.phase === 'battle'`.
`resolveTop()` is only ever reached from `passPriority`, so that costs nothing
there; the gate is about `commitItem(…, 'resolve')`, which also runs during the
resource step, the haste step and deployment — the **hidden simultaneous
segments** (`server/rooms.ts` `segmentKey`), whose entire purpose is that your
opponent cannot see you act until both of you are done. `viewFor` freezes the
opponent's players and entities inside a segment but `resolving` is a top-level
field, so publishing it there would leak "your opponent is mid-something" out of
the freeze.

The residue: an unrespondable effect that suspends mid-resolution **outside**
battle still shows the opponent nothing. Its controller has the decision open
and knows perfectly well what is happening, and nobody else is allowed to. The
one case this gives up is a trigger resolving between combat damage sub-steps
in a *non*-battle phase, which does not exist. **If the freeze is ever taught to
redact this field, the gate can go.**

### ⚠ "X resolves." still logs at the START of resolution — Bena to rule

The `resolved` event fires before `resolveParts` runs, so the log still reads
"Fireball resolves." and then the damage lines underneath it. That ordering is
what makes the log readable — the line is the heading for the effects that
follow — and the event is log-only (nothing dispatches on it), so moving it is
safe but not obviously better. The report's complaint is answered by the *state*
being visible rather than by moving the line, but if seeing "resolves" while
someone is still choosing is what grates, the fix is one line and belongs here.

## R79 — A Virus may be augmented onto a SPELL on the stack

*(Playtest round 13, 2026-08-22. Sourced: Caleb 2025-04-06, 2025-03-06,
2025-04-24; Manual pp.34-35.)*

> "Something that I'm almost positive hasn't been implemented is being able to
> augment viruses onto spells that are on the stack. It's perfectly legal in the
> game to put the powerful guy onto a giant fireball you're casting to have it
> deal double damage."

They were right on both counts, and the ruling is verbatim on the point:

> **Q:** "In Battle, can you augment a spell with a virus, such as applying
> Chitin Shredder as an augment on Arc Lightning?"
> **A:** "Yes. **This notably only works with attributes.**" (Caleb 2025-04-06)

and, more fully:

> "It's very similar to how regular viruses work, so **you can hit enemy spells
> and the spell gets erased on resolution**. You can augment spells during
> deployment, but currently that would only be possible with spell tokens.
> Also, **you can only do this with attributes** — mostly Deadly, Piercing, and
> Powerful are impacted by this, especially Deadly." (Caleb 2025-03-06)

"The powerful guy" is **Chitin Shredder** — `ee`, 1/2, *"[Augment] {Powerful}
Insect {Virus} Unit"*, no rules text at all, so what it donates is the type-line
attribute. {Powerful} doubles the damage its source deals.

**Three separate places said no.** `doAugment` hard-gated the host with
`e.need(host && host.kind === 'unit')`, and a `StackItem` is not an `Entity` at
all. `legalActions` only ever offered `e.unitsIn(b.region)`. And
`collectModular`'s own docstring asserted the opposite of the ruling — *"it is
the only kind of mod that means anything on a spell — a spell has no body for an
augment to grant attributes to"*. (The repo-root bot agrees and is also wrong:
`mods.py:_check_host` raises `"is a {type}, not a unit — graft and augment both
go onto a unit in play"`.)

### Legal hosts: spells, and only spells

`STACK_VIRUS_HOSTS = { spell, spellUnit, spellToken }`. The ruling names spells
and adds spell tokens explicitly. Excluded, each for its own reason:

| kind | why not |
| --- | --- |
| `triggered` / `activated` | an ability is an *effect* but not a *spell*, and it has no card of its own for a mod to sit under. R60 lets you **negate** one; that is a different permission. ⚠ |
| `virus` | a virus is itself a mod in flight, not a host. ⚠ |
| `unit` | a `{Battle}` unit mid-cast. A virus wants to be a mod on the body it lands on, which is the ordinary augment, available the instant it spawns. ⚠ |
| `ambush` | an ambusher is a unit played face-down, not a spell; R22 only makes it negatable. ⚠ |

The four ⚠ are judgement calls, not sourced answers. **Bena to rule** if any of
them should open — the gate is one `Set` in `apply.ts` and the resolution code
does not care.

### What the mod actually does

A `StackItem` now carries `augments?: { card: CardName; by: Seat }[]`,
deliberately separate from `mods` ({Modular}'s cast-time cost, R35): these were
applied **afterwards, as a response, by either player** — which is why `by` is
recorded. A card belongs to its owner, so a virus you put on an *enemy* spell
lands in **your** erased pile when the pair goes, and becomes a mod owned by
**you** if the carrier was a spell unit. `E.stackAugmentAttrs(item)` unions their
`augmentAttrs` — the type-line grants, exactly as `ownAttrs` reads a unit's
augment mods — and the result reaches two places:

- `EffectCtx.grantedAttrs`, which `dealEffectDamage` unions into the source's
  printed attrs before it reads {Powerful} / {Deadly} / {Poisonous} /
  {Resonant} / {Electric} / {Blessed} / {Reaping}. **This is the seam the
  SPELLS half of Emberflame Enlightener has been parked on** ("dealEffectDamage
  reads the source CARD's printed attrs, with no seam for an in-play
  modifier") — it exists now, though that card is a *static aura* and unparking
  it is a separate job.
- `E.itemAttrs`, so the resolution-time attribute checks ({Afflicting}) see them
  too.

Text-box `[Augment]` abilities and statics donate **nothing** here — *"spells
cannot gain static abilities like that, so the only useful thing you can do is
give them attributes"* (Caleb 2025-04-24). A text-only virus (Graxxlid,
Skybreaker) may still legally be applied; the log says so and nothing happens.

### Timing falls out; nothing needed special-casing

R37 already says applying a mod is not *playing*, so no "spells cost more"
modifier taxes it. The battle branch of `doAugment` already required priority
and the battle region. The virus item is `pushItem`ed like any response, which
puts it **above** its host and hands priority to the other player — so it
resolves first, and the host is still sitting underneath it when it does. A
virus whose host left the stack in the meantime (negated, or recalled) fizzles
to the bin, which is the Manual's own answer: *"If a virus is negated or its
target becomes invalid, it is placed into the bin, and cannot be used as a virus
again"* (p.34).

**Consistency with [R78](#r78--an-item-stays-on-the-stack-until-it-has-actually-resolved):
you cannot virus a spell that is RESOLVING.** `doAugment` looks the host up in
`s.stack` and nowhere else, so a resolving item is simply not there — the same
answer, from the same reason, as negation.

### ⚠ The carrier is ERASED, not binned — R69's Unstable, applied

Manual p.35: *"As long as a card is modded, it has the unstable attribute,
meaning when it dies or is erased, it and all of its mods are erased with it."*
R69 pinned the shape of that: **Unstable is a BIN replacement, not a death
replacement** (Caleb 2025-03-13, 2025-04-08 — *"unstable units still die, they
just get erased instead of ending up in the bin"*). A spell carrying a virus is
a modded card, and a resolving spell is a card on its way to a bin. So:

> `E.dischargeItem(item, hasCard)` — the one place a stack item's card leaves
> the stack. With no viruses on it, the card goes to its controller's bin
> (R40: from the stack, never a trash). With viruses on it, the card **and every
> virus** are erased instead, into the public erased pile (R65).

That is Caleb 2025-03-06's *"the spell gets erased on resolution"* arrived at
from an existing rule rather than a new one, and it applies **uniformly** — a
resolution, an R5 fizzle, and a negation all funnel through the one method. The
negation case is the surprising one and it is deliberate: R68 bins a negated
spell, but an Unstable one cannot reach a bin, so it is erased. (The Manual's
*"if a virus is negated … it is placed into the bin"* is about the **virus item**
being negated before it ever attached — that item has no augments of its own and
still takes the bin branch. Both are pinned by tests.)

**Bena to rule.** The quote is direct and the mechanism is R69's, but this is a
real power increase: a `ee` virus now denies the opponent's spell to their bin
entirely, which matters against every bin-recursion card in the pool. If the
answer is "no, a virused spell still goes to the bin", `dischargeItem` is the
one method to change.

**The spell UNIT exception.** A `spellUnit` does not *leave* on resolution — it
*arrives*. Erasing its card would delete a unit on its way into play, which no
ruling asks for and which would make one `ee` virus a hard removal spell for
every spell unit in the game. Instead its viruses ride it in as the augment mods
they always were, via `attachMod` — which makes the **body** Unstable, exactly
as if it had been augmented the ordinary way the moment it landed.

### ⚠ Not in scope

- **Deployment-phase augmenting of a spell token** — Caleb 2025-03-06 says it is
  possible. A spell token in play is an `Entity` (`kind: 'spellToken'`), not a
  stack item, and `doAugment`'s deploy branch still requires `kind === 'unit'`.
  Untouched.
- **Squish / Fight / Battle** — Caleb 2025-08-05: *"The **unit** is the source of
  the damage, not the spell … a Virus like Powerful (or Tidepool Terror) should
  be attached to the unit dealing the damage, not to the spell."* Those effects
  already deal their damage through the unit, so they are correct by
  construction; nothing was added to enforce it.
- **{Piercing} on a spell effect.** The ruling lists it as impacted, but
  Piercing is a combat-overflow rule in this engine and `dealEffectDamage` has
  no overflow to pierce. The attribute now reaches the effect; nothing reads it
  there yet.

## R80 — ALL of one effect's damage is dealt at ONCE

*(Playtest round 15, game VEAV, 2026-08-22.)*

Two reports, minutes apart, and they are the same defect:

> "Channel Through caused Restitution to make 2 triggers, but it should have
> done just one trigger."

> "I only made 2 units from my Channel Through, but Channel Through dealt 6
> damage to my allies and 6 damage to my opponent's units, so I should have
> made 12 units."

The engine had no notion of **"the damage an effect dealt"** — only a pile of
independent `dealEffectDamage(ctx, target, n)` calls, each firing its own
`damage` event and each looking, to everything downstream, like a separate
thing happening. Channel Through committed its distributed damage in 1-point
increments (the card comment said so in as many words: *"the 2 distributed
damage is committed in 1-point increments"*), so:

- a unit given two of those points was **dealt damage twice**. Rashi's
  Restitution ("whenever I am dealt damage, I deal that much damage to each
  opponent") triggered twice for 1 instead of once for 2 — a visible,
  game-swinging difference, because two triggers are two separate things to
  respond to and each one is a separate hit on the face;
- **Ember of Life** ("when one of your spell effects deals damage, create that
  many 1/1 units") saw only the first fragment. Its own card comment recorded
  the shape it was written against: *"one event per damaged victim; [once]
  takes the first."* Two units instead of twelve.

**The rule.** The unit of effect damage is the **batch**: one effect's
resolution deals all of its damage at once, through `E.dealEffectDamageAll`.

- hits are **coalesced per recipient** — a recipient named twice is dealt one
  total and hears about it once;
- every `damage` event in the batch carries **`total`**, the whole batch, for
  the texts that ask what the EFFECT dealt rather than what one victim took;
- **deaths are checked once**, after all of it is marked, which is what
  "simultaneous" means for two units that kill each other.

`dealEffectDamage(ctx, t, n)` is now sugar for a batch of one, so a
single-target spell is unchanged and `total === n` there. Every reader can be
written against the batch.

**Where the line falls.** One resolution of one effect is one batch — *not* one
spell, and not one turn. Sourced the other way round, Caleb 2025-03-20, on
Meteor Shower making several Rockfalls: *"Each copy of Rockfall is a separate
source, so Ember of Life triggers separately for each copy rather than
combining them into one bigger trigger."* Meteor Shower's three rockfalls are
three batches for the same reason.

**Which cards changed.** Every effect that damages more than one recipient in
one resolution: Channel Through, Rockfall 4 (A Fast Pile of Rocks), Meteor
Shower, Haboob, Bellowing Boulder, Deathglow Strider, Restitution, Roving
Quillback, Spirit of Vengeance, Infernal Grovekeeper, Boreal Wanderer, Bloated
Manablub, Astral Tidewraith. *Fight* deliberately did not: its two halves have
**different sources** (each unit deals its own damage), and a batch is per
source.

**Awoken Tomb reads its own share, Ember of Life reads the total**, and both
are right: "X is the damage **I am dealt**" is `n`, "that many" after "one of
your spell **effects** deals damage" is `total`. The event carries both.

**Electric got slightly better on the way.** Overflow is planned against damage
earlier hits *in this batch* have already assigned, rather than against a board
that has not been written to yet.

**Consequence for the stack display.** A triggered ability's X is usually
neither the R35 mana X nor an R64 variable cost — it is the number its event
carried, which is why "Awoken Tomb's trigger, while on the stack, doesn't say
what X is equal to" survived R13's fix for the other two. `ui/inspect.ts`
`stackItemX` reads `item.event.data.n` for a trigger whose **label** says its
amount is variable ("X = the damage dealt", "that much", "that many"), and
names the batch total in the hint when it differs. Presentation only: a label
this misses costs one badge, never a rule.

## R81 — Burst groups by NAME

*(Playtest round 15, game VEAV, 2026-08-22. Supersedes half of R16.)*

> "The game is trying to force me to cast my Fireball here (since it has
> Burst), but Burst only applies to spell tokens with the same NAME. I should
> be allowed to play Poison, let it resolve, then play Fireball since they have
> different names."

Correct, and printed: *"a player must play all burst spells they control **of
the same type** at the same time"* (The Rules of Algomancy, spell tokens).
`doCastSpellToken` swept `tokensOf(seat, region).filter(t => card(t).burst)` —
**every** burst token you controlled there — so a Poison and a Fireball fused
into one group that went on the stack together and could not be split. That is
a real loss of play: the two do different things, and the whole point of
resolving one before casting the other is to see what it did first.

The group is `t.card === tok.card` now. R16's remaining half still stands: the
tokens in a group stack in entity-id order rather than a caster-chosen one.

Related: the caster may aim each token separately (Caleb 2025-03-22: *"spell
tokens created via Burst can each target different things — they don't have to
share a target"*), which the per-token target collection already did.

## R82 — Two printed targets, two cast-time slots — and a test that says so

*(Playtest round 15, game VEAV, 2026-08-22.)*

> "Squish, on cast, only has you select 1 target unit, but it needs 2 targets
> (a target ally and any target). **This is a recurring issue, do a full text
> search for anything that has 2 targets** (either says the word target more
> than once or says 'two targets') **and ensure all cards and effects that need
> to choose targets happen ON CAST.**"

R67 already settled the rule; what recurred is that it was enforced by reading
the card that had just misbehaved. Fight (R58), then eleven cards at once in
R67, then Necromorph (BRDM), then Squish (VEAV) — and 492 cards in the pool
that nobody had read for this. (The MNWK report in the same series named
"Flight", which is not a card in the pool under that name and could not be
chased down; it is listed here only because the pattern is the point.)

So the search is a test now: `test/68-target-conformance.test.ts`. A card whose
printed text says "target" N times must declare at least N cast-time slots
across its effects, and a card that prints "target" at all must declare one
somewhere. Reminder text (`{i}…{/i}`) is stripped from the count — it restates
rules rather than adding them, and Reconfigure's *"(the first target must have
[Augment])"* is the same target the sentence already named.

Every exemption is listed **with its reason**, and a third test asserts the
list is exactly right: an exemption that stops being needed fails as loudly as
a card that stops declaring its targets. There are four kinds of exemption —
the word is about another effect's targeting (Gravitational Correction, Divine
Intervention, Boon of Protection, Download, …), two separate effects with one
target each (Stellarspore Harvester), a variable slot that cannot be followed
by a fixed one (Channel Through), and one genuinely unimplemented card (Apex
Prime, which still needs a copy layer).

**Fixed by the sweep.** *Squish* — a two-slot spec, slot 0 an ally of the
caster and slot 1 any other unit, exactly Fight's shape, re-checked at
resolution (R56/R58) because a Warder can move a slot afterwards.
*Stellarspore Harvester*'s [Augment] half printed "target **opponent**" and
declared `what: 'any'`, which is the damage kind: it offered every unit on the
board and both players, and the usual pick could only fizzle into an info line.
The audit found that one; nobody had reported it.

**Channel Through** was left standing here for one round and is settled in R83
below: the opponent IS a cast-time target, and the spec can say so now.


## R83 — A spec may mix a VARIABLE slot with a fixed one; and Channel Through

*(Bena, 2026-08-22, closing the question R82 left open.)*

> "Channel Through's second part doesn't target, that's correct. On cast, you
> target X of YOUR units and an opponent. Then, when it resolves, you just
> 'distribute' the damage without targeting or going onto the stack or
> anything."

So the card makes **two different kinds of choice**, and the difference is the
whole point:

| | when | declared? | on the stack? | respondable? |
|---|---|---|---|---|
| X allies + one opponent | cast | yes, as targets | yes, on the item | yes |
| which of that opponent's units take the points | resolution | no | no | no |

The second half was already right — a mid-resolution `ctx.choose`, exactly what
R67 said a *distribution* is. The first half was not: the opponent went
**undeclared**, because a `count: 'X'` slot could not be followed by a fixed
one. Caleb had already said the same thing from the other side (2025-11-25):
*"Channel Through targets the player, so yes, you're good."*

**The seam.** `TargetSpec.extraSlots` — fixed slots asked for in addition to
`count`. They occupy the **low** indices, which is what `slots` (an absolute
index) already describes: `slots: ['opponent']` with `what: 'allyUnit'` makes
slot 0 the opponent and every later slot an ally. First rather than last for a
mechanical reason, not a stylistic one: a counted spec ends when the chooser
says "no more targets", and a slot behind that gate could never be reached.

`min` counts across the whole spec, so `min: 1` means "the opponent is
mandatory, the allies are not" — which is right, since you may hold fewer than
X allies. At X = 0 the opponent is still asked for and the spell still does
nothing (R74: a variable cost may warn that X = 0 is empty, not forbid it).

**What changed at the table.** The distribution now offers only the **targeted**
opponent's units rather than "everyone who is not me" — identical in 1v1, a
real difference at three players. And the opponent is on the stack where it can
be seen, redirected (R58 `canFillSlot`) and reacted to, which is the entire
reason R67 moved targets to cast time.
