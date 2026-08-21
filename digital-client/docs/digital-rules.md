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
(Engine 2026-07-16.)

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
Casting one Burst token casts all your Burst tokens in that region; the engine
currently stacks them in a fixed (entity id) order instead of letting the caster
order them. Targets are chosen per token. ⚠ Simplification — revisit if ordering
ever matters. (Engine 2026-07-16.)

## R17 — Prismites give no affinity; active ones exchange during planning
Prismites start the game **dormant** (Manual p.10 setup), can be expended for 1 mana
like any resource, but grant **no affinity** — they are not wild. Their value is the
exchange: during planning, an **active** (face-up) Prismite may be swapped for a
resource of any element, keeping its current state ("players essentially get to pick
their two starting resources for free", Manual p.18; delaying the exchange preserves
hidden information). A dormant Prismite cannot be exchanged. The engine and prototype
had wrongly treated them as wild-affinity and starting face-up.
(Bena 2026-07-16, confirmed by Manual p.18.)

## R18 ⚠ — Haste step engine model
The haste step (Manual p.18: after the resource step, only {Haste} cards playable, ends
when everyone has played all they want) is modeled as a sub-step after both players
finish planning: each haste play **resolves immediately** (planning is not interactive —
no stack, no responses), players may interleave plays in any order, and a player with no
legal haste play is auto-marked done. The step is **skipped outright** when nobody has a
legal haste play, so turns without haste cards look exactly as before. ⚠ Engine call:
strictly, resource decisions lock before anyone sees a haste play; the engine lets a
not-yet-done player keep playing haste cards after seeing the opponent's (planning
reveals no other information, so this is judged harmless in 1v1). (Engine 2026-07-16.)

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

## R40 — Trashing: a nontoken card entering a bin from anywhere but the stack
Discarding, sacrificing, milling and dying in combat all trash. A spell or
ability going to the bin after resolving does NOT (it comes from the stack),
so negating a spell is not trashing; tokens are never trashed; erasing never
touches the bin and so is not trashing. The trasher is the owner of the bin
the card enters. A per-battle trash count is required (Dropslime, Muck
Rummager). (Printed: Void Scavenger reminder text; Caleb 2025-02-01;
broadened by Bena 2026-08-19.)

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

## R47 ⚠ — A dying Wraith re-attaches instead of being erased
The Wraith token (renamed FROM "Wight"; the printed token card still shows the
retired title, and `Blight's End` is the one card still printing it) is a 0-mana
4/4 Blight Zombie Token Unit reading "[Augment] When I attack or block, put
a -1/-1 counter on me. When I die, augment me onto target ally." Unlike
every other unit token it is not erased on death — its own trigger applies
it as an augment mod to a chosen ally, donating the shrink-on-fight text to
its new host. It ceases to exist only when no legal ally remains. "Create a
Wraith" spawns the body; "Augment a Wraith onto a unit" creates the same
token directly as a mod. A Wraith dying is not trashing (tokens are excluded,
R40). (Printed token card via Bena 2026-08-19; the no-erase carve-out is
Bena's reading of the printed text.)

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
Gravitational Correction, Infernal Cultivator — while Tidelurker (R28's own
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
