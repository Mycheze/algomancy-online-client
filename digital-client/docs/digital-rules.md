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

> ⚠ **IMPLEMENTED BY [R106](#r106--stat-layer-6-unaware-everything-in-the-interaction-reads-at-printed-stats), 2026-08-23. Text above kept as the original ruling; R106 is the operative one.**
> R10 sat unimplemented for thirteen months. The owner restated it operationally in 2026:
> an `{Unaware}` card, **and every card it is involved with**, reads at the numbers
> **PRINTED** on the card — not its base stats, and not just the Unaware one. R106 scopes
> that to **dealing/receiving damage and combat**; **targeting**, which the sentence above
> also lists, is R106's one named open edge and is deliberately not implemented. Read R106
> before acting on the sentence above.

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

## R28 ❌ WITHDRAWN (2026-08-23) — superseded by R115
**This ruling is dead. See [R115](#r115--a-created-unit-arrives-where-its-source-is).**

It said: a created UNIT with no place named arrives in its controller's HOME
region, not the battle region, *because* "Tidelurker's 2/2 minted mid-attack
must be home to block the counterattack". The designer was asked that exact
consequence on 2026-08-23 and answered the other way: **anything made by
anything spawns in the region its source is in**, and a token minted mid-attack
stays stranded in the enemy region, in no column, unable to block the
counterattack. R28's rationale is precisely what R115 forbids, so the ruling is
withdrawn rather than narrowed. R52, which confirmed it as the global default,
is withdrawn with it. (Its one surviving half — spell tokens appear where the
effect resolves — is now simply what R115 says about everything.)

## R29 ⚠ — "An open spot in your formation" (Tiderunner Initiate)
Requires an EXISTING formation of yours (you attacked, or you declared
blocks): join behind a lone survivor, take over an emptied column, or — as
the attacker — front a fresh column beside the formation. With no formation
declared there is nothing to join and no prompt. Joining is optional ("may").

**And it is a PLAY, so the spot is chosen at CAST.** *(Added 2026-08-22 from
playtest room UFAB: "Tiderunner Initiate should never have entered the
Invader's zone. It gets played directly into the formation, not as a trigger
that happens when it enters.")*

The card had been modelled as a triggered ability on its own `spawned` event,
resolving through R75's `E.placeInFormation`. Playing it therefore spawned a
unit into the battle region **in no column** — which is precisely the state the
client draws as the invader's zone — stacked a placement trigger, and handed
the opponent priority. In the reported game Good Whale (Ambush) and Tidal
Reversion used that window to recall the Initiate before it ever reached the
line. The window should not have existed: the card was never played anywhere
for it to be answered in.

The printed words settle it. *"You may PLAY me into an open spot"* is a
statement about how the card is played, not an effect the card has. So:

- the spot is collected in the **cast window**, beside X, {Modular} mods,
  targets and bracketed costs (R35), through `E.collectFormationSpot` and the
  `'formation'` cast stage. The answer rides on the stack item
  (`StackItem.formationSpot`), where both players can see where it is going;
- it is **taken at resolution, atomically with the spawn**. `E.takeSpot` runs
  inside `spawnUnit`, between minting the entity and emitting `'spawned'`, so
  the unit is already standing in the line the first time any listener or any
  player sees it. Nothing observes the intermediate state, because there is no
  moment at which it exists;
- the slot is **re-derived** at resolution rather than remembered as an index —
  a column can collapse, widen, or lose the unit the spot was measured against
  between the cast and the resolution (R5/R56). `FormationSpot` names the spot
  in a way that survives that (an end of the line, the unit it goes behind, the
  index of a hole) and simply fails to match when it is gone, in which case the
  card resolves into the region, outside the formation, **and says so**;
- with no formation of your own, nothing is asked and the card is played
  normally. That half is unchanged and is pinned by a test;
- "stay out of formation" is still on the menu whenever the question is asked,
  because the text says *may*. That is the one legal way to end up outside the
  line — a choice, never a window.

The card is now one flag: `card('Tiderunner Initiate', { playsIntoFormation:
true })`. `CardBehavior.playsIntoFormation` is also the missing half of **Trench
Stalker**'s first clause ("I can be played directly into formation"); what still
parks that card is its play-from-bin mode, not this.

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

## R33 ✅ ABSORBED INTO R115 (2026-08-23) — it was never an exception
"When one of your spell effects deals damage, create that many 1/1 units":
the created units arrive **where the carrier (the augmented unit / the unit
with the text) is**. R28 and R52 called this a *per-card exception* to a
home-region default; [R115](#r115--a-created-unit-arrives-where-its-source-is)
withdrew that default and made R33's reading **the general rule** — a created
unit arrives where its SOURCE is, which for a carrier trigger is where the
carrier is. Nothing about this card changes; it stops being special. Two related
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

1. ~~**Tokens are cards.**~~ ⚠ **THIS PREMISE IS DEAD — see
   [R133](#r133--tokens-are-not-cards-and-trashing-never-needed-them-to-be).**
   It read: *"Tokens are temporary cards"* opens the Tokens section of BOTH
   rulebooks, so Algomancy does not draw Magic's token/nontoken line. The owner
   ruled the opposite on 2026-08-24: **tokens are NOT cards.** The CONCLUSION
   below is unaffected, because it rests on premises 2 and 3, which stand on
   their own — trashing keys on the DESTINATION, not on what the object is.
2. **A dying token does enter the bin** — see R69, with Caleb's rulings.
3. **It does not come from the stack**, which is this rule's entire definition
   of trashing.

So a dying token is trashed by the owner of the bin it enters, exactly like
everything else, and is *then* erased out of that bin (R69).

**Amended again 2026-08-24 — [R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased): the same
sentence now covers an {Unstable} card.** It too enters a bin from play, is
trashed there, and is only then erased by a state-based sweep — as do the
nontoken MODS it carried. That was the last object whose disposition was
allowed to decide whether trashing happened, and with it gone this rule is
exactly what it says: *the destination, not the object.*

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

Two deliberate limits, one since lifted. ⚠ **One firing per zone, not per
copy**: the printed texts are standing permissions ("if I am in your bin"),
not per-copy triggers, so three copies in a bin fire once. A `[Switch1]`
budget (R9) on a zone trigger used to live only for the one firing, because a
stand-in has nowhere to keep it — that flag is CLOSED by
[R124](#r124--leftbin-every-bin-removal-goes-through-one-choke-point), which
keeps the reservation in `GameState.zoneBudgets` (per seat per card name, per
turn). (The ruling was renumbered R124 at merge — R120 is the elective
combat-damage split.)

⚠ Two things this deliberately did **not** solve, one since solved. The
missing **"a card left a bin" event** exists now — R124's `E.removeFromBin` is
the choke point, and Rotling is unparked on it. And **a trash
trigger can never carry a graft rider** (Blightwalker, Afflicting Anima, Maw of
Despair print theirs as `[Switch1]`). That one is structural, not a missing
hook. The graft CAUSE still works normally while the card is a unit in play;
only the trash firing itself can never have riders, and `fireOwnTrashTrigger`
hard-codes the stand-in's `mods: []` to say so.

⚠ **The ARGUMENT for that was killed by [R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased) on
2026-08-24; the answer was not.** It used to read: *a modded unit that dies is
ERASED (Unstable) and never reaches a bin at all, so a card that IS trashed
provably carries no mods* — re-derived on 2026-08-21 onto R69's branch order
when tokens became trashable. R137 makes an Unstable unit pass THROUGH the bin
and be trashed there, so a trashed card can now perfectly well have been a
modded one, and the structural impossibility is gone.

What replaces it is a live reason rather than an accident: the stand-in is the
card **as it sits in the bin**, and a card in a bin has no mods on it. Mods do
not travel into a bin with their carrier — each nontoken one enters its OWN
owner's bin as a separate card (and is separately trashed, R137/R70), and a
token mod has no card at all (R69). So `mods: []` is what the trashed object
actually is, not a limitation to route around. This is the third time in two
days (R116, R125, R133) that a conclusion outlived its argument; the conclusion
is kept here **because it was re-derived**, not because it was already written
down. One further consequence: the
stand-in a trash trigger fires on is no longer always fabricated. R70 hands it
the dead unit's own detached entity where there is one, so the trigger keeps
the region it died in; the `mods: []` is still written explicitly, for the
reason above.

## R52 ❌ WITHDRAWN (2026-08-23) — superseded by R115
**This ruling is dead. See [R115](#r115--a-created-unit-arrives-where-its-source-is).**

R52 confirmed R28 as the global default ("a created unit arrives in its
CONTROLLER's home region, never the battle region the effect happened to
resolve in") and closed R33's open question in R28's favour. On 2026-08-23 the
designer reversed both, from report #83 — *"Life Plant's units were made in my
region, despite it currently being in Rashi's region. Anything made by anything
needs to spawn in that region (then can return during regroup)."*

Everything R52 moved is moved back:

- **Flesh Tithe, Keeper of Tithes, Afflicting Anima, Cosmic Devourer, Life
  Plant** and **Swarmling** went from the effect's region to home under R52;
  R115 returns them to the effect's region — i.e. they were right before.
- R52's **"⚠ Known follow-up"** list — the two dozen base-set cards said to
  "still" create units in the effect's region, and therefore to need migrating
  to home — is **CANCELLED in full**. Those cards were already following the
  rule R115 states. (The list also named **Squish**, which creates nothing at
  all: it only deals damage. It was never a creator.)
- What R52 got right and R115 keeps: cards whose printed text names a place
  (Hooba-God's "in my formation", Feed to Hooba's "in its position in play")
  still override the region default with a *slot*, and putting a card into play
  from a bin (Exhume, Wake the Dead, Uglk…) is not creating at all.

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
block — unparked by this).

**Corrected 2026-08-23.** This paragraph used to end by calling the `[element]
Resource` card faces "still parked … needs resource cards to be playable cards
at all", one paragraph after correctly saying the affinity bonus "already
created real Shards and is unchanged". Both cannot be true, and the second one
is: **the clause on those faces is not card behaviour**. "When I activate, if
you have at least [r][r][r], create a Shard" is the Manual p.18 general rule,
printed on the physical card as a reminder — implemented once in
`apply.ts::maybeGrantShard`, for **all seven elements**, verified on the real
`activateResource` action path. `printed.json` carries only three Resource
faces (fire, water, earth), so routing the rule through card definitions would
silently drop the bonus for wood, metal, light and dark, and keeping both would
pay it twice. The three faces are `card('X Resource', {})` on purpose; their
ledger entries were deleted and they are declared in `71-card-ledger`'s
`NOT_A_GAP`. See R116 for the one thing about the bonus that *was* wrong.

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

> ### ⚠ THE TARGETING HALF OF THIS RULING WAS WRONG. See **R128**.
>
> The table below and the two `TargetSpec.what` members are still good law.
> **One sentence of it was not**: "A unit on the stack is in neither: a unit
> arriving in play is not an effect, and there are no parts to negate."
>
> The owner reversed that on 2026-08-24, verbatim: *"R60 is wrong. ANYTHING on
> the stack is an effect, including units and spell units. Units aren't spells,
> so if they say 'spell effect' a unit would be unaffected."*
>
> **Why the old reasoning was bad reasoning, and not just a bad answer.** The
> second clause — "there are no parts to negate" — is a fact about `StackItem`,
> not a fact about Algomancy. A 'unit' item is built with `parts: []` because a
> unit card has no `spellEffect`; that is an implementation detail of how this
> engine represents a card on its way into play. Reading it back out as a rule
> ("therefore a unit cannot be an effect") is mechanism logic dressed as a
> ruling: the engine's data shape was allowed to decide a rules question. And
> the answer it produced was the CLOSED one — it is exactly the "cards are
> conservative rather than intentionally open" assumption the owner named as the
> reason six audit questions in a row came back the other way. Negating a unit
> mid-cast is a real, interesting play, and nothing printed forbids it.
>
> The first clause was also weaker than it looked. "A unit arriving in play is
> not an effect" was asserted, never sourced; the card set's own vocabulary
> distinguishes *spell* from *effect*, and R60 used it to draw the
> spell/nonspell line correctly while quietly borrowing it a second time to draw
> an effect/non-effect line no card ever draws.
>
> This section is kept, wrong sentence and all, because the repo keeps
> superseded rulings visible: the shape of the mistake is worth more than a
> clean file. Read R128 for what the engine does now.

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
*(⚠ REVERSED by R128 — kept above as written for the record. A unit on the
stack IS an effect; it is only the SPELL half it stays out of.)*

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
- **Alluring** (R84) — a Pure blocker is "able" against anything, so a *lured*
  Pure unit is compelled even by a Flying column, and one Pure blocker covers
  an Evasive Alluring column by itself (which makes "could it have satisfied
  the column alone?" answer yes, so it must). An Alluring column that is
  *itself* Pure ignores its own Alluring and compels nobody — under R84 that is
  upstream of the stack, and the trigger never fires at all.
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

⚠ **[R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased) (2026-08-24) goes one step
further and DIVERGES from the two sources quoted just above.** The reminder
text and Caleb's 2025-04-08 line both describe the destination and both read as
"no bin, therefore no trash" — the owner overruled them, and an Unstable death
now takes the token's route: bin → `trashed` → sweep. The destination is still
the erased pile; what changed is what happens on the way. Read R137 before
reasoning from the quotes in this section.
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

The sequence `destroy()` now produces for an unmodded token — and, since
[R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased), for an {Unstable} card as well — in order:

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
- **Deformant** — *"Sacrifice me **and another ally**: …"* **MOVED 2026-08-23**,
  on the effect-level `castCost` route, and the two reasons this entry gave for
  not moving it were both wrong. One `AbilityCost` does carry `sacrificeSelf`
  **and** `sacrificeOther` together, so the payment was always expressible —
  but that route carries `collectItemCosts`' documented latent half-pay (the
  choice-free half charged one call earlier than the choice-bearing half), and
  Deformant would have been the first card to trip it. `castCost` is one
  collector and one window. See **`includeSelf`** below.

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

### `includeSelf` — "sacrifice me AND another ally" as ONE payment (Deformant, 2026-08-23)
*"Sacrifice me and another ally: Delete all units with cost equal to the total
number of counters on us."* — Deformant, m/2 2/2. `sacrificeUnits` carries a
third flag beside `from: 'self'`:

```ts
{ kind: 'sacrificeUnits'; from?: 'self'; includeSelf?: true; n: number | 'X'; xMin?: number }
```

It is **not** `from: 'self'` with a second cost bolted on, and it is **not "any
two units"**: the source is *mandatory and choice-free*, and it is **excluded**
from the menu the remaining `n - 1` are chosen from — which is what makes
"another" mean another. Four touch points in `engine.ts`, and the first is the
one that matters:

| touch point | what `includeSelf` does |
| --- | --- |
| `canPayCastCost` | demands **BOTH halves up front** — the source live *and* `n - 1` other units in the region. Without this the source dies for a cost whose remainder cannot be paid |
| `chargeCastCost` | shares R73's `from: 'self'` branch for the first half (widened to `from === 'self' \|\| includeSelf`), charged **first** and outright inside the cast window |
| `castCostOptions` | filters `item.sourceId` off the menu |
| `costOwing` | **drops the flag once the source half is paid.** Re-asking `includeSelf` for the remainder would look for a source that is now dead and skip the part after half of it had been charged |

`costTimes` preserves the flag through R110's graft multiplier by spread.
`costIsIterated` and `costPaidSoFar` needed no change. ⚠ The choice-free source
half is charged only for a **non-optional** cost: an opt-in grafted rider must
be able to decline before anything is charged, and no card in the pool is both.

**The receipt widened with it.** `costPaid.sacrificedUnits` was
`{ card, power, defense }[]` and is now
`{ unit, card, power, defense, counters }[]`, snapshotted at payment in **both**
writers. `counters` is the **raw `Entity.counters`**, and that is the ruling,
not a shortcut: counters NET (*"if I have +1/+1 and -1/-1 on the 2 cards, what's
the total number?"* → *"0, they cancel out"*) and a temporary buff is not a
counter at all (*"oh, no those are not counters"*), so `effStats` cannot
reconstruct the number. Both sacrificed units are dead by the time the effect
runs, so the receipt is the only place the total can come from. The singular
`paid.sacrificed` receipt — read by `batch-fire-a`, `batch-fire-b`,
`batch-metal-b` and `batch-hybrids-wm-b` — is **built separately** now rather
than sharing one literal, so a future field on one cannot appear silently on the
other.

**The card lost two things it no longer needs.** Its mid-resolution
`ctx.choose('deform', …)` is gone — that was a response window between cost and
effect the printed card does not have, and it was exactly what its ledger entry
described. And its R77 `usableWhen` is gone as *redundant*, not as an omission:
`canPayCastCost` for `sacrificeUnits` + `includeSelf` **is** the "another ally"
board condition, and `abilityUnusable` asks it before the ability is offered.
Restating it would be a second implementation of one gate.

⚠ **A behaviour change to an existing passing test.**
`26-metal-a.test.ts::Deformant: sacrifice me + an ally, …` used to `pass` twice
to RESOLVE the activation and meet a `payOrDecline` naming the ally with a bare
`EntityId`. The decision is a **`targets`** one carrying `{ unit: id }` now, and
it arrives **before** the item reaches the stack, so the passes moved to after
the payment. That is the point of the change, not a casualty of it.

Guarded by `26-metal-a.test.ts::Deformant: sacrifice me + an ally, delete all
units costing our counter total`, `26-metal-a.test.ts::Deformant: "sacrifice me
AND another ally" is ONE payment, made in the CAST window`,
`26-metal-a.test.ts::Deformant: the counter total is read off the RECEIPT as of
payment, not off the board`, and `26-metal-a.test.ts::Deformant: all or nothing
— it never half-pays when the second sacrifice is unavailable`.

`card-ledger.ts`: **Deformant's entry is deleted.**

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

⚠ **Tiderunner Initiate was in that table until 2026-08-22 and should never have
been.** It is where the slot logic was invented — it was the one card that
actually asked — but its text is *"you may PLAY me into an open spot"*, and a
play is not an effect resolving. Folding it in here cost the UFAB report; see
**R29**, which now owns it. What R75 governs is the *create a unit in my
formation* class above, and nothing else.

`E.formationSlots(seat)` is now the single answer to *where can a unit join this
formation*, and `E.placeInFormation(unit, ctx)` raises the choice. All four cards
route through it and their own placement code is gone. R29's play-time placement
shares `formationSlots` — the legal set below is the same set either way — but
reaches it through a cast stage and `E.takeSpot` instead.

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

**Resolution time, not cast time — for an EFFECT that places a unit.** Nothing
here prints *target*, so this is a choice and not a target — same shape as R71's
"an ally": a `ctx.choose` at resolution, auto-picked when exactly one placement
is legal, and a **logged** no-op when none is. The chooser is the **effect's**
controller. Every branch emits an event: an effect that resolves into silence is
a conformance failure, and *"there was nowhere to put it"* is exactly what a
player needs told.

⚠ **The carve-out (2026-08-22).** "At resolution" is a statement about *effects*,
and it was over-applied. **A placement that is part of PLAYING a card is chosen
on CAST**, with everything else about how that card is played (R35), and taken
atomically with the card's own arrival — see **R29**. The two are not in tension
once you read what each is about: Hooba-Bot's Robot is genuinely created by an
effect and then put somewhere, so there is a real moment between the two and the
ruling above says who decides. Tiderunner Initiate is never put anywhere,
because it is played into the spot; a moment between the two would be a bug, and
was one.

(`placeInFormation`'s `optional: true` — the "stay out of formation" answer for
the printed *you may* — was written for Tiderunner and now has no caller among
the four. It is kept: R29's own menu offers the same answer, and the next card
that prints *may* in an effect will want it here.)

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
no pending decision.)*

> ⚠ **The Alluring rule stated here is SUPERSEDED by R84** (2026-08-22, the same
> day). "Defenders that are able to block it must block it" is attributed below
> to the Manual, and the Manual does not contain the word: {Alluring} targets
> ONE enemy unit, from the stack. Read R84 for what the attribute does. What
> survives here — and is still load-bearing — is the **hang** and the
> **contract** it forced on `legalActions`: because Alluring is conjunctive
> across columns, a generator that varies one column at a time cannot express a
> legal answer on its own, so every offer must be built on a compulsory core
> that is always offered. R84 keeps that contract; only the definition of the
> core changed. The mechanism described under "The fix" below (`alluringDuties`,
> `unmetAllure`, free-pool counting) has been deleted.

The fuzzer stopped on this position, at the block step:

```
attacker: two one-unit columns, BOTH {Alluring}
defender: four units, all able to block
blocks:   {}          → and no legal action for anyone
```

Alluring, as the engine then read it: *"defenders that are able to block it must
block it."* (Wrong — R84.) Two Alluring columns and two able blockers means
**both duties are live at once**,
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

*(The shape survives in R84; the machinery below does not. Kept for the
reasoning, which is why the contract exists.)*

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

### Deformant's cost — UNPARKED 2026-08-23

Deformant used to pick and sacrifice its ally at **resolution**, which left a
response window between cost and effect that the printed card does not have.
R77 fixed the offer half; the payment window shipped on 2026-08-23 on the
effect-level **`CastCost`** route, and the R77 `usableWhen` came out with it —
`abilityUnusable` gates the offer on `canPayCastCost`, which for
`sacrificeUnits` + `includeSelf` **is** the "another ally" board condition, so a
`usableWhen` restating it would be a second implementation of one gate.

**⚠ TWO REASONS RECORDED HERE WERE STALE, and both are corrected.** This section
used to say *"'Sacrifice me and another ally' is a compound cost, and
`AbilityCost` has no shape for one"* — not true: a single `AbilityCost` carries
`sacrificeSelf` and `sacrificeOther` at once and pays both inside the one cast
window. It then said the blocker was the **receipt**, which was true but not the
deciding reason: **the `AbilityCost` route is the wrong one regardless.**
`collectItemCosts` carries a documented latent half-pay — the choice-free half
is charged one call **earlier** than the choice-bearing half, so the first card
to combine them reaches the collector with its mana already spent, and Deformant
would have been exactly that first card. `castCost` is one collector and one
window.

The two engine edits it needed — `includeSelf?: true` on the `sacrificeUnits`
variant, and the widened `costPaid.sacrificedUnits` receipt carrying `unit` and
the raw `counters` — are documented in full under **R73 → `includeSelf`**.

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
augment to grant attributes to"*. (**Corrected 2026-08-23 by
[R105](#r105--modular-takes-any-mod-you-can-pay-for-and-a-modded-card-is-unstable)**,
which made the same donation true through the `{Modular}` window as well.) (The repo-root bot agrees and is also wrong:
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

**Answered 2026-08-23, from the other side.** Asked the same question about a
`{Modular}` mod — the same act by a different timing — the owner ruled *"a
modded Spellbind should also have unstable"*. That is R69's mechanism applied to
a card on the stack, which is what this section already does, so the reading
above stands and [R105](#r105--modular-takes-any-mod-you-can-pay-for-and-a-modded-card-is-unstable)
makes the two windows agree. `91-modular.test.ts` asserts they cannot diverge.

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
- ~~**{Piercing} on a spell effect.**~~ **CLOSED 2026-08-23 — see R103.** The
  note above was true when it was written and stopped being true when the owner
  ruled on where the excess goes. `dealEffectDamageAll` now reads {Piercing}
  and a donated one pierces exactly like a printed one, which is what made this
  ruling's own example ("mostly Deadly, Piercing, and Powerful are impacted by
  this") true rather than aspirational.

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

## R84 — {Alluring} TARGETS one enemy unit, from the stack

*(Playtest room UFAB, 2026-08-22. Sources: Caleb, Discord — see the quotes
below. **Supersedes R76**, which implemented a different rule entirely.)*

The bug report was *"Tempest Wrangler (with Alluring) didn't trigger on
attacks"*. The position: three attack columns, one of them {Alluring}; the
defender held exactly two units able to block, put both of them on the **other
two** columns, left the Alluring column unblocked, and the engine accepted the
declaration. Six unblocked damage, dead player.

There was a real hole there — the duty's candidate pool was computed **after**
subtracting the units the defender had already committed elsewhere, so
committing everyone somewhere else *manufactured* the "nobody is able" excuse.
But fixing that in place would have entrenched the wrong rule. R76 read
{Alluring} as *"defenders that are able to block it must block it"* and
attributed the wording to the Manual. `Rules/Algomancy-Manual.txt` contains **no
occurrence of the word "Alluring" at all**. The rule was invented.

### What the attribute actually is

Five rulings, all Caleb's unless noted:

1. **It targets ONE enemy unit.** Asked "Does alluring stop a whole enemy from
   attacking or a single unit?" — *"single unit"* … *"meaning target unit
   controlled by an opponent"*. (`docs/03-mechanics-inventory.md` had it right
   all along: "target enemy can't attack, must block this column".)
2. **Two effects on that target: it can't attack, and it must block that column
   this combat if able.** A community summary he let stand: *"if you are
   Initiative player, when your formation enters enemy region, you can use
   Alluring to target 1 enemy unit. It won't be able to 'counter-attack' into
   your region and will be forced to block column which has Alluring unit. If
   you are Non-Initiative player … the 'target enemy can't attack' part loses
   its value … but you can still force specific unit to block Alluring
   column."*
3. **It goes on the stack and can be negated.** *"'Alluring' effect goes to
   stack and can be negated?" — "Yep!"*, and *"this would stop the trigger if
   you kill the allurer while the effect is on the stack"*.
4. **Once it has resolved, killing the allurer does not undo it.** Asked whether
   removing the Alluring unit in the priority window before blocks makes the
   effect fizzle: *"You can't attack but you can block other things."*
5. **It does not stack.** *"Nah alluring doesn't stack"* … *"It's just one
   attribute"* … *"It's like how you can't gain flying flying"*. Two Alluring
   units in one column produce ONE target, not two. It **is** shared to the
   column like every other combat attribute — *"It's also even weirder because
   alluring is shared to the column"* — so it is one target per COLUMN.

And the printed word "able" is real, in both directions: *"Yeah they can not
block. You don't get to mind control the opponent 🙂"*.

### The rule, stated

For each {Alluring} attack column `ci` with lured unit `A`:

- Let **need(ci)** = 2 if the column is {Evasive}, else 1 — with R61's carve-out
  that a single {Pure} blocker switches {Evasive} off and can cover it alone.
- **If `blocks[ci]` is non-empty, `A` must be one of its members.**
- **If `blocks[ci]` is empty, that is legal only if `A` could not have satisfied
  the column alone** — i.e. `need(ci) > 1`, or `A` is not able to block `ci` at
  all ({Feeble}; no {Flying} against a Flying column; R20's lone-{Sneaky}
  attacker), all with R61's {Pure} exceptions.
- **`A` may not be sent out as a counterattacker, and may not be declared as an
  attacker**, for the rest of this battle phase.

**"Able" is a property of the unit and that column only** — region, controller,
still in play, {Feeble}, {Flying}, lone-{Sneaky}, {Evasive}, {Pure}. It never
depends on what the defender chose to do with that unit elsewhere. That
dependency *was* the UFAB bug, and removing it is the point of the rewrite.

### The solved RAQ thread, which is what pins it

*[Solved] Alluring AND Evasive column* — the column is Alluring **and** Evasive,
so it needs two blockers, and it lures exactly one unit, A:

| defender holds | legal declarations |
|---|---|
| A | forgo it — A cannot cover an Evasive column alone, so nothing compels it, and it is free to block elsewhere |
| A, B | forgo it, **or** A+B — and nothing else |
| A, B, C | forgo it, **or** A+B, **or** A+C — **B+C is illegal** |

Both clauses are needed and neither is redundant. The second explains the first
column: one unit cannot make `need = 2`, so "if able" is simply false. The first
explains the last row, and the corpus gives the reasoning in one line: *"If
another unit B wants to block the alluring column then suddenly A can and also
has to."* You do not get to send a substitute — if the column is being blocked
at all, the unit that was called to it is one of the blockers.

Plain (non-Evasive) {Alluring} collapses to "A must block it", which is the
whole point of the attribute.

### Why it is a TRIGGER, and what that buys

{Alluring} is the first **attribute in the game that targets**, so there was no
pattern to copy. It is modelled as an on-attack triggered ability, queued at the
`attackDeclared` seam in `doDeclareAttack` — one per Alluring COLUMN, not one
per unit, because it does not stack.

Everything in ruling 3 then comes for free from machinery that already exists:
it is a `kind: 'triggered'` stack item, so it is a legal *"target effect"* and
Dematerialize negates it (R68 splices it off the stack and it never resolves);
its target is chosen as it goes onto the stack (R67), by the attacker, from the
enemy units in the battle region; and the whole target-picking UI works on it
without one line of client code.

Ruling 3's "kill the allurer while it is on the stack" is **not** the general
fizzle rule — the general rule fizzles on the *target* being gone, and the
target is fine. It is a check inside the effect: the allurer must still be
standing in an attack column, and that column must still be {Alluring}. Nothing
else in the engine needed to change for it.

**The effect needs a home.** `EffectPart.effectKey` is a registry lookup with no
back door, and card code (Divine Intervention, Gravitational Correction, Hexbane
Shiitake) calls `effectByKey` on the parts of whatever stack item it is
retargeting — an Alluring trigger included, now that it is a legal target
effect. A rules-owned effect therefore has to be a registered card or those
three throw on it. It is registered as the synthetic `Alluring Attribute`
(`registerSynthetic`, `kind: 'spellToken'` so it is not a deck card). The stack
item carries the **allurer's** card name, not the synthetic's, so the log, the
card scan and the token scanner never see it.

### Lifetimes: two effects, two different clocks

`Entity.allured = { round, columns[] }`.

- **Can't attack** is the presence of the field, whatever round stamped it. It
  lasts the rest of the battle phase and is cleared at regroup with every other
  temporary change (R11 step 3). It survives the allurer's death, which is
  exactly ruling 4.
- **Must block** is `columns`, and only in the round that stamped it. The
  entries are attack-column **indices**, which are a column's identity (R72), so
  they are re-keyed by `E.rekeyColumns` in the same single commit as
  `BattleState.blocks` and drop out when their column ceases to exist. That is
  the mechanism behind "kill the allurer and the block is freed": the column
  collapses, the duty goes with it, the mark stays.

⚠ In the 1v1 battle structure the "may not be declared as an attacker" half is
currently **unreachable on its own**: round 2's attacker pool *is* the units
sent out at block time, and a lured unit may not be sent. The guard is in
`validFormation` anyway — it is the half of the attribute that survives the
allurer's death, and the seat/round model is written for formats with more
rounds — and it is tested against a pool built by hand.

### ⚠ Two duties on one unit — a judgement call

Two Alluring columns may name the **same** unit, and it cannot block both.
**Discharging either duty excuses the rest**, and the "must be among its
blockers" clause is waived for the excused ones too. Without the waiver a
defender who does exactly what one duty demands is then refused for the other,
and the position has *no legal declaration at all* — which is the R76 hang in a
new costume.

This is the **only** place "able" is allowed to look at the rest of the
declaration, and it is bounded: only another {Alluring} duty can excuse one.
Blocking a plain column excuses nothing, and being sent to counterattack cannot
excuse anything because a lured unit may not be sent. (Bena's call, 2026-08-22.)

### What was deleted, and what R76's contract still buys

`alluringDuties`, `unmetAllure` and `compulsoryBlocks`' free-pool search are
gone — about 120 lines — replaced by `allureViolation` (the two clauses above)
and a `compulsoryBlocks` that is no search at all: each duty **names its unit**,
and two duties can only collide by naming the same one, in which case
discharging either excuses the other, so taking the first is right.

R76's *contract* survives and still matters: `legalActions` must always be able
to offer at least one legal block declaration, because Alluring is conjunctive
across columns and a generator that varies one column at a time cannot express
that (fuzz seed 1993 — every offer refused, no legal action for anyone, hang).
Every offer is still built on top of the compulsory core, and the bare core is
still always offered. What changed is that the core is now legal *by
construction* rather than by a greedy-is-sufficient argument.

Two of R76's sub-findings also survive unchanged, because they were about "able"
rather than about who is compelled: a lone {Sneaky} + {Alluring} attacker
compels nobody (R20 forbids blocking it, so nobody is able), and an {Alluring}
column that is itself {Pure} compels nobody (R61) — under the new model that is
upstream of the stack, and the trigger simply never fires.

## R85 — A suspended resolution rolls back on RESUME, not when it suspends

*(Playtest room UFAB, 2026-08-22. Bug 52: "During the resolution of Insidious
Invitation, I should have seen what my opponent played during the resolution
and what they paid. That's the whole point of 'Starting with you'. I couldn't
see anything until I declined to put something into play.")*

Insidious Invitation reads *"Draw a card. [Switch1] Starting with you, players
may play a unit from hand as if it were {Battle}."* The caster answered first,
paid for a unit and put it into play; the opponent was then asked their half —
and saw a board on which none of that had happened. No unit, no spent mana, not
even the draw, and an empty log. They found out only once they had answered.

### Not a networking bug: the information did not exist

`ctx.choose` is not a coroutine. It **throws** a `PartChoice`, and the part is
re-run from the top with the recorded answers once the answer arrives. For that
replay to be sound the world has to be back at the boundary of that part, and
`resolveParts` used to put it there *the instant the part suspended*:

```ts
this.s = snap;                 // the WHOLE state goes back
this.events.length = evLen;    // the narration is DELETED
```

and only then published the suspension. So the state on the wire at every
mid-resolution decision was the state *before the effect started*. The server
was broadcasting correctly (`broadcastAfterAction`); there was simply nothing to
broadcast. Deployment's `heldEvents` holding is not involved — `segmentKey`
returns null in battle.

The card is one `EffectPart` (the whole body, draw and per-seat loop together —
`effectByKey` addresses parts as `spell:<CardName>`), so there is no sub-part
granularity to fall back on. And this is the whole class: every multi-step
resolution — a glimpse chain, an electric path, any per-seat loop — had it.

### The fix: separate "what the replay restarts from" from "what players see"

The rollback state is no longer applied at the suspension. It rides **on** it,
as `Suspension.snapshot`, and `E.resumeResolve` applies it when the answer comes
back. Between the question and the answer, the state on the table is the real,
partly-resolved one.

Four things make that safe:

- **The published state never has to be action-legal, only renderable.**
  `apply()`'s dispatch refuses every action except `decide` and `concede` while
  a decision is pending (R65 owns the concede exception), so nothing can be
  built on top of a half-resolved board. Verified, not assumed — and pinned by
  a test that walks `legalActions` for both seats on a suspended resolution.
- **The log does not double.** The replay deterministically re-emits everything
  the part emitted before it suspended, so the suspension also records how many
  events the table has already been shown (`Suspension.shown`) and
  `resolveParts` drops exactly that many from the front of the replay's output.
- **The replay is byte-identical.** Rolling back on resume rather than at the
  suspension means `nextId` is restored to the part boundary *before* the
  replay, not after it, so the entities the replay re-creates get the same ids
  the ones on the players' screens had. Nothing flickers into a new identity.
- **A few fields are carried FORWARD across the rewind**, because they belong to
  the session rather than to the resolution: `actionCount` (the client's
  "my action landed" latch — it must never go backwards), the seat NAMES
  (rooms.ts writes those straight into the state, outside the action log), and
  `decisionHigh`.

`decisionHigh` is new and is the one subtlety worth naming. Decision ids come
off `nextId`, which the rewind now moves *backwards*; the second question of a
multi-step resolution could therefore be handed the id the first one used, and
`ui/sfx.ts` reads "a new id" as "a new question was asked". A high-water mark
keeps ids strictly increasing. Outside a replay it never binds, so every id in
an ordinary game is the one it always was.

**The snapshot never leaves the server.** It is a whole unredacted `GameState` —
both hands, the deck order, the face-down resources — so `server/view.ts` strips
it from every view, including the view of the seat whose decision it is. No
client has any use for it: only `apply()` reads it.

**Backwards compatible.** A suspension serialized before this rule has no
snapshot; `resumeResolve` then replays from wherever it is, which is exactly the
old behaviour and exactly what such a state was saved under. Saved games replay
through the action log and never see a snapshot at all.

⚠ **What this does NOT recover: "and what they paid" — actually, it does.** The
report asked for two things and the payment looked unrecoverable, because
`g.payCard` happens inside the rolled-back window. It is not: the window is no
longer rolled back while the question is open, so the caster's spent resources
are on the published board along with their unit. Both halves of the report are
delivered.

## R86 — An effect fizzles when it loses ALL its targets, and takes its untargeted parts with it

*(Playtest report #71, game GETD, 2026-08-22: "Rashi's grafted effect resolved
even tho its only legal target was gone. It's an official ruling that a grafted
effect with a target becomes 'vulnerable' to requiring a target to resolve".)*

Sourced, and the source is unusually explicit — Caleb Gannon's Discord, the RAQ
thread **"[Solved] When does effect fizzles?"**:

> **Q:** "For effects like Channel Through or big Grafts with multiple targets
> (and additional buff or card draws), when do they fizzle?"
> **A:** "**If effect loses ALL of its targets and wants to resolve.**"

and then the worked example, which is the whole of the rule:

> Bellowing Boulder triggers his graft effect and you target Bumblecrab to get
> '+7/+7 until regroup' and target enemy Hooba-Lan to be 'deleted'. […] Now
> Bellowing Boulder graft effect has lost ALL of its targets and it will fizzle
> when resolving **(yielding no card draw from 2nd and 3rd graft)**.

Read that parenthesis twice. The two "draw a card" grafts were **never
targeted**. They die anyway, because the composite is ONE effect and one effect
fizzles as a unit. Restated twice more in the same thread: *"currently at least
1 target must remain for whole effect to be carried out"*, and *"in order for
effect to fail you need to invalidate ALL targets"*.

### What GETD actually showed

Rashi's Spewing Mushroom carried four grafts. Its attack trigger composed a
five-part item, of which exactly one part — Technological Superiority's
"duplicate each counter on **target unit**" — declared a target, and the target
it declared was the Mushroom itself. A Poison 8 then killed the Mushroom while
the trigger sat on the stack. The log, verbatim from the replay at HEAD:

```
Resolving Spewing Mushroom: create a Poison X (X = my power):
Spewing Mushroom: the unit is gone — no Poison.
Rashi creates a Poison 1.        ×4   ← Biotoxicity + Sprouter, both UNTARGETED
Recyclable Sentinel gets +1/+1 until regroup.   ← Sudden Bloom, UNTARGETED
Spewing Mushroom: create a Poison X (X = my power): a part fizzles (target gone).
```

Four Poison tokens and a board-wide buff, paid out by an effect that had lost
every target it ever had. Under the ruling the whole line should read one line:
`Spewing Mushroom: create a Poison X (X = my power) fizzles — all targets are
gone.` It does now.

### The fix is one word wide

`resolveItem` asked each part *"are you still alive?"* and an untargeted part
answered `true`:

```ts
const partAlive = (part: EffectPart): boolean => {
  if (part.spent) return false;
  const def = effectByKey(part.effectKey);
  if (!def.targets) return true;      // ← a composite with any untargeted part
  …                                   //   could never fizzle, however dead its targets
};
if (!item.parts.some(partAlive)) { fizzle }
```

An untargeted part no longer votes. Whether the ITEM is targeted at all is then
asked separately, of the whole item:

```ts
if (!def.targets) return false;   // R86: untargeted parts do not vote
…
const targeted = item.parts.some(p => !p.spent && !!effectByKey(p.effectKey).targets);
if (targeted && !item.parts.some(partAlive)) { fizzle }
```

Three cases fall out of that shape, and all three are deliberate:

| the item | before | after |
| --- | --- | --- |
| no targeting **anywhere** (Ignis Sprite's spawn trigger) | resolves | resolves — it has nothing to lose |
| a targeted part whose spec is **min 0** with nothing declared ("Recall **up to one** target cached card. You gain 3 life.") | resolves | resolves — declaring no target was a legal choice, and the unconditional half must happen |
| a **required** target the item never had a legal candidate for | fizzles | fizzles — it wanted a target and has none |

That last row is not a footnote. The first draft of this rule keyed the gate on
*"did any part declare a TargetRef?"* instead of *"does any part have a targets
spec?"*, and replaying GETD caught it immediately: three Poison 1s cast into a
region everything had just left declared nothing, stopped fizzling, and started
printing a cheerful `Resolving Poison 1:` above no effect at all. The
distinction between "lost its target" and "never had one" is real, and both are
still a fizzle; only *"was never targeted in the first place"* is not.

### Blast radius: none, and that is worth saying

1454 tests run over `resolveItem` and every one of them stayed green. That is
not evidence the change is small — it is evidence the pool has very few
composites that mix a targeted part with an untargeted one AND lose the target,
which is exactly why the bug survived to be found by a human. The replay is the
real check: GETD now diverges from its recorded log at precisely one point, the
reported one, and all 19 games in `server/games/` still replay FAITHFUL.

### `allOrNothing` is untouched, and is a different question

`EffectDef.allOrNothing` (R5, `dsl.ts`) is set by three cards — Scrap For Parts,
Organic Exchange, Battle — and **the engine has never read it**: `grep`
`allOrNothing` over `src/` returns the declaration and three card files, and no
consumer. Each of those cards enforces it by hand inside its own `run`, which is
why they work.

It is also asking a different question. `allOrNothing` is **per part**: *"SOME
of my targets are gone — do I resolve partially against the survivors, or not at
all?"* R86 is **per item**: *"ALL of my targets are gone — does anything on this
item happen?"* A two-target Battle that loses one fighter is `allOrNothing`'s
case and R86 says nothing about it; a two-target Battle that loses both is
R86's, and would have fizzled before R86 too (its only part is targeted). They
neither overlap nor contradict. Wiring `allOrNothing` into the engine remains an
open, separate job.

Guarded by `78-round17-core.test.ts::a graft composite that loses its ONLY
target fizzles whole`, `78-round17-core.test.ts::one surviving target carries
the untargeted grafts through`, `78-round17-core.test.ts::an item that declares
NO target anywhere never fizzles` and `78-round17-core.test.ts::a required
target with no legal candidate at cast still fizzles`.

## R87 — A counterattacker may bring spell tokens, and `declareBlocks` has to be able to say so

*(Playtest report #67, game GETD, 2026-08-22: "What happened to Rashi's Poison
tokens here? She just wanted to bring them with her attackers but they somehow
went onto the stack, without any targets or anything??")*

She was right, and the engine half-agreed with her already.

### The rule

Spell tokens travel with a formation, in either direction, and they need a unit
to carry them:

> "Yes, spell tokens can move into other regions on attack/counter-attack step.
> But they always need a unit to take them with them." (lofavreel, rules-questions
> 2023-08-19)

> "If your opponent declares a counter attack they create a formation and move
> those units **+ some/all spell tokens** to your region." (tecera, 2025-12-23)

> "Then during blocker/counter-attack step you can send this 2/2 unit **with
> Poison 5** to enemy region as counter-attack" (_passer, 2025-03-29)

> "In order to move spell tokens, you must have attacked opponent Region. In
> order to attack opponent Region, you must send atleast 1 of your unit."
> (_passer, 2025-05-10)

and Caleb himself on the general permission:

> "you can only play spell tokens in the region they are in (**or you can bring
> them into enemy regions during an attack, if they were created in your own
> region**)" (calebgannon, 2025-04-21)

### What was actually wrong

Not the legality. `doDeclareBlocks` has always accepted a spell token mixed into
its `send` array — `t.kind === 'unit' || t.kind === 'spellToken'`, plus the
"spell tokens travel only with units" invariant. What was missing was any way to
find that out. `Action.declareAttack` carries a named `spellTokens` field;
`Action.declareBlocks` carried only `send`, and `legalActions` never once
offered a `send` containing a token. So the client had no field to fill, nothing
in the offer list to render, and the only remaining use for a Poison was to cast
it where it stood — which is literally what GETD's action 92/94 pair is:

```json
{"type":"declareBlocks","seat":1,"blocks":{},"send":[25,6,19]}
{"type":"castSpellToken","seat":1,"entityId":21}
```

Three counterattackers went out; three Poison 1s stayed home and were fired,
{Burst}-grouped, into a region every enemy had just left. All three reported
*"there is no legal target for that — it does nothing"*.

### The shape

`declareBlocks` now takes the same optional `spellTokens?: EntityId[]` as
`declareAttack`, with the same meaning. `apply` concatenates it onto `send`
before anything downstream sees it, so:

- **backwards compatible by construction** — a saved game that named a token in
  `send` still replays, and all 19 games in `server/games/` do;
- the two declarations share ONE legality helper, `needRidingToken` in
  `apply.ts` — "a spell token you control, standing in the region this formation
  is leaving from". An attack and a counterattack are the same movement seen
  from opposite sides of the table, and this whole report is the two of them
  having been allowed to disagree;
- the "needs a unit to carry it" half stays at each call site, because that is
  where the units are.

`legalActions` now offers, for each free unit, a second declaration that brings
every ridable token along. Representative rather than exhaustive, like every
other formation-shaped offer: the builder composes any subset and `apply()`
validates it.

The block log line counts them separately — *"blocks 0 column(s) and sends 3
counterattacker(s) with 3 spell token(s)"* — because "3 counterattackers" when
one of them is a Poison is exactly the confusion report #67 opened with. Wording
is byte-identical to before whenever no token rides along.

### ⚠ Open for the client

`test/75-ui-reachability.test.ts`'s `facetsOf` does not distinguish a
`declareBlocks` that carries tokens from one that does not, so the new rider has
**no reachability row**. It wants a `declareBlocks:spellTokens` facet and a
ledger entry, the way `declareAttack:spellTokens` has one ('unoffered' — that
side deliberately leaves the rider to the builder). Whoever owns that file next.

Guarded by `78-round17-core.test.ts::declareBlocks takes spellTokens`,
`78-round17-core.test.ts::legalActions offers the counterattack-with-token
shape`, `78-round17-core.test.ts::spell tokens still travel only with units` and
`78-round17-core.test.ts::a token named in the old `send` field still
counterattacks`.

## R88 — "Target effect targeting me" is a TARGETING restriction, and a Virus targets its host

*(Playtest round 16, game GETD, 2026-08-22, report #70.)*

> "Graxxlid is lighting up like I can activate its ability despite there being
> no legal targets on the stack"

Graxxlid prints *"[Augment][once] [one]: Negate target effect targeting me.
That effect's controller draws a card."* Its spec was a bare
`what: 'stackEffect'`, so **every** item on the stack was a candidate and the
"…targeting me" clause was checked at RESOLUTION, where a non-matching target
printed an info line and did nothing. The client's green `.activatable` halo is
a pure read of `legalActions`, so the ability lit up whenever the stack was
non-empty. From the table that is a card that promises an answer it does not
have — the exact inverse of report #35, where a card that *could* act was not
drawn as if it could.

### Which of the two questions the clause is

R64 already settled the general shape: *"the printed restriction is part of
what makes a target LEGAL, not a condition checked once the spell resolves"*.
The community RAQ thread **"[Solved] Target requirements to put effect on
stack"** is the source under it:

> "In order to play a card, you **must** be able to select the valid targets
> for the effect. Eg. You cannot play Resurrect if there aren't any 2 mana
> units in your bin. You cannot play Fight if there isn't 2 units in the region
> (one of which must be an allied unit)."

So *"targeting me"* is a `TargetSpec.restrict`, and R64's three consumers —
the candidate menu, `castable`, `E.canFillSlot` — plus `abilityUnusable`'s
"an ability with no legal target is not offered and is refused" do the rest.
Nothing in the client changed: the halo went out because `legalActions` stopped
offering the activation.

The resolution check **stays**, and is not dead code. A restriction is asked at
cast and is never re-asked (R5/R56), so the world may legally stop satisfying
it in between — Redirect moves an effect's targets, a part can be spent, the
aiming item can leave the stack, and Reconfigure can carry the Graxxlid mod to
a different host while `ctx.sourceId` still names the host it was activated
from. The same RAQ thread says as much about the far end: *"if there was a
legal target at this point in time and it disappears (e.g. OP playing something
in response to the trigger), the ability will resolve as far as it can."*

### A Virus is an effect that targets its host

Hoisting the predicate exposed a second, older gap. `doAugment` builds a Virus
stack item with `parts: []` and a `hostId` — it carries **no target refs at
all** — so a read over `parts[].targets` says a Virus targets nothing, and
Graxxlid could never answer one. The designer says otherwise:

> **calebgannon:** "You can redirect a virus, it is a targeted effect"

and asked immediately after, *"Interesting, so you could Graxxlid or Boon of
Protection it as well?"*:

> **calebgannon:** "Yep! They're fully interactible."

So "does this stack item aim at unit U?" is two clauses, not one: a live
(unspent) part declaring `{ unit: U }`, **or** `kind === 'virus'` with
`hostId === U`. R79's other Virus shape — `hostStack`, a Virus aimed at a spell
on the stack — aims at no unit and is excluded.

This is a **card-code** predicate today (`aimsAtUnit` in `batch-earth-a.ts`),
not an engine one, because Graxxlid is the only card in the pool that asks the
question about *itself*. Boon of Protection asks the neighbouring question
("does it target anything **allied**?") and Enigmatic Warder asks the redirect
version; when a third card needs it, the predicate wants to move to `dsl.ts`
and all three should share it — but a shared helper written for one caller is
a guess, so it stays local until there are two.

Guarded by `16-earth-a.test.ts::Graxxlid (report #70)` and
`16-earth-a.test.ts::a Virus being applied to me`.

## R89 — R79's missing half: a SPELL TOKEN may be augmented during DEPLOYMENT

*(Asked for by Bena, 2026-08-22. Supersedes the first bullet of
[R79](#r79--a-virus-may-be-augmented-onto-a-spell-on-the-stack)'s "⚠ Not in
scope" section, which read: "**Deployment-phase augmenting of a spell token** —
Caleb 2025-03-06 says it is possible. A spell token in play is an `Entity`
(`kind: 'spellToken'`), not a stack item, and `doAugment`'s deploy branch still
requires `kind === 'unit'`. Untouched." It is no longer untouched; that bullet
is dead and this entry replaces it.)*

The ruling, in the same 2025-03-06 answer R79 already quotes half of. The
question was *"can i augment my spells during deployment?"*:

> "It's very similar to how regular viruses work. So you can hit enemy spells,
> the spell gets erased on resolution. **You can augment spells during
> deployment but currently that would only be possible with spell tokens. Also
> you can only do this with attributes.**" (calebgannon, rules-questions
> 2025-03-06)
> — and immediately after: *"Mostly, deadly, piercing and powerful are impacted
> by this. Especially deadly"*

### It is NOT restricted to Virus cards

The reading taken, and it is a reading — sourced to the community rather than to
Caleb. Asked *"could you still augment a spell in deployment with a non-virus
mod? Or timing won't let you"*, `_passer` (2026-01-15, rules-questions) laid out
why the Virus keyword exists at all:

> "**The idea being you can normally only mod during Deployment. BUT you can use
> viruses during combat.**"
> "So if you create some Fireballs during deployment" … "**You can mod one of it
> with Bubb from bin/hand**" … "To make it kill Robot 10"
> "But since Bubb is not a virus, you couldn't mod Fireball **during combat**
> (not without help of Rook)"

That is the axis the restriction runs along: **{Virus} buys you the TIMING, not
the host.** Deployment is when anyone may apply any augment; combat is the
exception {Virus} unlocks. Caleb's own sentence does not contradict it — *"that
would only be possible with spell tokens"* is about which **spells** exist to be
augmented during deployment (a token in play is the only one), not about which
**mods** may do it. So the deploy branch takes any `[Augment]` card from any of
the deployment mod zones (hand, bin, cache), on the same terms as augmenting a
unit; it does **not** require `c.virus`, which is the battle branch's gate and
stays there.

### What was in the way, and what it cost

One line, the same shape as the three R79 found:

```ts
const host = e.entity(hostId!);
e.need(host && host.kind === 'unit' && !host.absent, 'no such unit');
```

A spell token in play is an `Entity` with `kind: 'spellToken'`, so it could
never be a host, and `legalActions` offered only `e.unitsOf(seat, region)`.
Verified empirically at HEAD: with a Fireball token on the board, the only
augment host on offer was the unit standing beside it.

Both are fixed, and **`legalActions` offering it is not optional**. R79 shipped
`hostStack` correct, tested, and completely unreachable for a whole round
because nothing offered it and nothing on screen glowed; that is the incident
`test/75-ui-reachability.test.ts` exists to prevent, and repeating it here would
have been the same bug twice.

### Only ATTRIBUTES transfer — and that comes for free

The augment rides the token onto the stack as `item.augments`, the very field
R79 built for the battle-time version, seeded in `doCastSpellToken` from the
token entity's augment mods. Everything else is already written:

- `E.stackAugmentAttrs` unions `augmentAttrs` and **reads nothing else**, so
  "you can only do this with attributes" is enforced by construction — a virus
  whose payload is rules text donates exactly nothing;
- `EffectCtx.grantedAttrs` reaches `dealEffectDamage`, so a Fireball 3 wearing
  Chitin Shredder's {Powerful} deals 6;
- `E.itemAttrs` sees them at resolution-time attribute checks;
- `dischargeItem` erases the pair on resolution — a modded card is Unstable and
  Unstable is a bin replacement (R69), and a spell token has no card to bin
  anyway, so only the augment reaches the erased pile.

The log says which of the two happened at the moment the player commits the
card, rather than leaving them to discover it when the token resolves for the
same damage as before: *"— the spell gains {Powerful} when it is cast"* or
*"— but a spell can only gain ATTRIBUTES, and this grants none, so nothing
changes."*

### Three questions this raises, answered

- **Does the augment survive to resolution?** Yes — it is carried on the item,
  not looked up on an entity that no longer exists.
- **Is the modded token erased on resolution, like an augmented stack spell?**
  Yes, through the same `dischargeItem`. The token was never a card, so what is
  erased is the augment.
- **Does it survive Regroup with Harbinger of Immolation out?** Yes. R11's note
  is that a protected token *"is spared the ERASE and nothing else"*, and a mod
  is not an until-regroup change, so the augment is still on it next turn. The
  companion fix is in `startRegroup`: an **unprotected** modded token now erases
  its mods **with** it (Manual p.35, *"when it dies or is erased, it and all of
  its mods are erased with it"*). Before R89 no token could carry a mod, so the
  unconditional `delete this.s.entities[e.id]` had nothing to orphan; now it
  would have.

### ⚠ Still not in scope

- **Augmenting a token ENTITY during BATTLE.** `_passer`'s "not without help of
  Rook" implies a Virus could be applied to a Fireball standing on the board
  mid-combat. R79's `hostStack` path already answers the combat question for a
  token you are *casting*, and opening the entity form needs its own targeting
  and response-window design. Left alone deliberately; **Bena to rule** whether
  it is worth the second path.
- **The client.** `ui/inspect.ts`'s `modHosts()` derives its host sets purely
  from the offered actions, so a token host lands in `hosts.units` and glows —
  but `modHostPhrase()` will call it "a unit", and the board click handler has
  to accept a spell token as a mod drop target. `test/75`'s `facetsOf` folds
  this into `augment:host-unit`; it probably wants an `augment:host-token` facet
  of its own.

Guarded by `78-round17-core.test.ts::a spell token is a legal augment host
during deployment`, `78-round17-core.test.ts::only ATTRIBUTES transfer`,
`78-round17-core.test.ts::a text-only augment on a token grants nothing`,
`78-round17-core.test.ts::an augmented token erased at regroup takes its mod
with it` and `78-round17-core.test.ts::the augment rides the token through a
Harbinger regroup`.

## R90 — A park note is a CLAIM: Prediction Prophet needed no new primitive

*(Playtest round 17 audit, 2026-08-22. Unparks Prediction Prophet, whose note
had read: "'predict your life total' needs a player action during the haste
step and a field in PlayerState/Entity to keep the number, neither of which
exists". Both halves were false on the day they were re-read.)*

Printed (`printed.json`): **"During [Haste], predict your life total. At the
start of deployment, create a 5/5 unit if you matched the prediction."**
— lll/3 1/3 Spirit Unit.

No Caleb ruling exists on this card; a search of the whole Discord export for
"Prediction Prophet" and for "predict" returns nothing about it. Nothing here
is a rules question — it is entirely a claim about the ENGINE, which is exactly
the class of park note that rots.

### (a) The "player action" already existed, as a decision

[R50](#r50--the-haste-step-ends-with-an-event) fires `'endOfHaste'` inside a
`settle()` window, and `startBattlePhase` says so in as many words:

> "A trigger from step 1 **may suspend on a decision**, which would strand the
> game between the haste step and the battle phase — so the flip is deferred to
> `finishHasteEnd()`, which `settle()` calls at every safe point."

So a trigger listening on `'endOfHaste'` is allowed to raise a Decision, and
`EffectCtx.choose` is the number picker. No new player action, no new phase
hook: the prediction is asked for at the tail of the step, which is "during
[Haste]".

### (b) The place to keep the number already existed: `Entity.budgets`

`budgets` is a per-entity `Record<string, number>` and **only `E.startTurn`
clears it** (`for (const e of Object.values(this.s.entities)) e.budgets = {}`).
The turn runs mana → [Haste] → battle → **deployment**, so a number written at
the end of the haste step survives the battle *and* regroup and is still there
when `'startOfDeployment'` fires in the same turn. Ancient One already writes
`self.budgets[key]` by hand.

`s.battleCounters` would **not** work and is the trap worth naming:
`finishHasteEnd` resets it (`this.s.battleCounters = this.s.regions.map(...)`)
on the way into battle — precisely the window the prediction has to cross.

The stored value is `prediction + 1`, because `budgets[k] ?? 0` cannot tell
"absent" from "predicted zero" and both are reachable states.

### ⚠ The one approximation

A `Decision` carries a finite option list and "predict your life total" is any
number, so the menu is `0 … your current life + 5`. A prediction more than five
above where you stand during [Haste] cannot be entered. Everything else is
exact.

Guarded by `40-light-c.test.ts::the [Haste] prediction is a real decision, and
matching it creates a 5/5`, `40-light-c.test.ts::the prediction survives battle
and regroup, and a MISS creates nothing`, and `40-light-c.test.ts::predicting
the life total you will END the battle on creates the 5/5`.

## R91 — "Name a card" is a Decision; the region rule is not negotiable

*(Same audit. Unparks The Everywhere, whose note read: "a 'name a card' PLAYER
ACTION. That is the only thing left." The action existed; something else was
left.)*

Printed: **"[Augment] During [Haste] name a card. My last named card loses all
abilities. {i}(As long as I am in their region.)"** — l/4 3/3 {Haste} Spirit
Unit.

⚠ **Source warning.** The Discord's discussions of "the everywhere" are about a
DIFFERENT card. `calebgannon` and `tabbysupercat` (rules-questions) are
workshopping *"instead of attacking, columns of omnipresent units create copies
of themselves that are attacking. For each copy that does not return in
regroup, sacrifice the original unit"*, and `shadyshores` refers to *"a unit
that becomes an exact copy through the everywhere"*. Neither describes the
printed L&D text. **They are not authority for this card** and were not used.

### What shipped

`ctx.choose` takes an arbitrary option list, and `DecisionOption.card` exists
so *"the client renders the real scan instead of a text label"* (types.ts) —
that IS "name a card". The menu is every card name in play plus an explicit
"a card that is not in play" (a no-op on the printed card too, and the only way
to decline friendly fire). The silence is
[R62](#r62--losing-all-attributes-and-abilities-is-a-layer)'s
`E.suppress(u, 'The Everywhere', { abilities: true })` on **every copy of the
named card in the naming unit's own region** — "my last named CARD", not "that
unit".

### The region scoping is a ruling, and it costs the card almost everything

Caleb, rules-questions, twice and unprompted:

> "if you take away anything from the rules, it is: **If you have a question
> about wheither something can be done with units across regions, the answer is
> no.** …the only exception is attacking into other regions"

> "**the single rule we'll never violate is 'nothing can send information across
> regions'**"

> "Just treat each region as if they exist in a completely different game"

At the end of the haste step **every unit is still standing at home**, so the
naming unit's region holds only its own side. The printed card reaches an enemy
because it **attacks into their region later in the same turn**, at which point
its CONTINUOUS effect switches on. A one-shot applied at naming time cannot see
that coming.

So: the card is live, region-correct and testable, and today it can only
silence allies. That is an honest weakness, and it is **not** to be "fixed" by
reaching across regions — that would be inventing a rule against the quotes
above.

### ⚠ What is still approximated, and the exact seam

The DURATION. Printed it is continuous; the engine has only R62's
until-regroup form. Closing it needs, precisely: **a string field on `Entity`**
to hold the named card (`budgets` is numeric-only — see R90) **plus a
`StaticMod` that matches on a card NAME rather than an entity id**. Then this
card stops being a trigger and becomes a static, which is what its text
actually is.

Guarded by `38-light-a.test.ts::naming a card during [Haste] silences EVERY
copy of it IN MY REGION`, `38-light-a.test.ts::naming a card that is not in
play silences nobody`, and the standing todo `38-light-a.test.ts::the silence
should be CONTINUOUS`.

## R92 — Three of the four COPY layers already ship (Apex Prime, partial)

> **SUPERSEDED BY R118 (2026-08-23).** The fourth layer shipped: copy is now
> layer 0, and the "⚠ Still dead" list below — the NAME, `statics` and the
> ACTIVATED abilities — is closed, for Apex Prime, Borrower of Forms and
> Ancient One alike. Kept as the record of how the card was read before the
> layer existed; the todo test it names at the end no longer exists.

*(Same audit. Downgrades Apex Prime from `dead` to `partial`. Its note claimed
"effStats has no copy layer and ownAttrs/abilities read straight off the
printed card, so there is nothing to approximate honestly"; three quarters of
the copy was reachable.)*

Printed: **"[Augment] When I attack or block, if your life total is odd, you
may have all of your units become a copy of target unit until regroup."** —
lm/4 4/4 Technology God Unit.

The rules half of "becomes a copy" is settled in the RAQ thread on Borrower of
Forms, which is the pool's other copy card:

> "As Caleb said *'it inherits all of the combined text'*" — *"Q: Does BoFy get
> counters of original unit? A: **Yes.**"* (`_passer`, rarely-asked-questions,
> "Borrower of Forms — The weird interactions")

### What was reachable, and why the durations line up

Every one of these expires at **regroup**, which is this card's own printed
duration — that is what makes them usable here rather than merely present.

| copied layer | primitive | ruling |
| --- | --- | --- |
| base stats | `E.setBase` (layer 2 — a rewrite, so counters and temp buffs still apply on top) | [R66](#r66--base-stats-are-a-layer-not-a-delta) |
| attributes | `E.addTempAttr` over `g.ownAttrs(target)` — the target's LIVE set, its mods' and statics' grants included, not just the printed line | R11 step 3 |
| triggered / `[Augment]` text | `E.grantText` | [R63](#r63--granting-authored-text-until-regroup) |

One `grantText` per channel is enough and this is worth writing down:
`fireEvent` dispatches granted text as
`collectTriggersFrom(u, g.card, g.via, …)`, which walks the **whole** ability
list for that channel. The `index` on `GrantedText` is descriptive, not a
selector — so one grant carries every triggered ability the copied card has on
that channel. Reforge the Dead is the precedent.

"You may" is a `payOrDecline` at resolution; "your units" is region-scoped
(R12); the odd-life condition is judged at EVENT time (R1), so an even life
total means the trigger never queues and no target is ever asked for.

### ⚠ Still dead, and each needs the CORE

- **the copied NAME.** `Entity.card` is the identity that bins, "name a card"
  (R91) and every counters-by-name effect key off. A copy-name layer is a core
  change with a blast radius, not a card-file one.
- **`statics`.** `staticsFor()` reads `statics` off the printed card; there is
  no granted-static channel beside `Entity.granted`.
- **ACTIVATED abilities.** `apply.ts`'s `pushActivatedOptions` offers
  `getCard(u.card).abilities` and never reads `granted` — so `grantText` will
  happily store an activated ability that can never be offered.

Borrower of Forms waits on exactly the same three; whoever builds the copy
layer should land both cards.

Guarded by `44-hybrids-ld-a.test.ts::on an odd life total, all of your units
copy the target's base stats and attributes`, `44-hybrids-ld-a.test.ts::the
copied "when I die" text really fires on the copy`, `44-hybrids-ld-a.test.ts::an
EVEN life total means the trigger never queues at all`, and the standing todo
`44-hybrids-ld-a.test.ts::the copy does not carry the NAME, the STATICS or the
ACTIVATED abilities`.

## R93 — Stat layer 5: {Inverted} negates the NET change from base
Playtest report #73 (room GETD, 2026-08-22): *"Inverted isn't working on my Malformed
Monstrosity. -7/-7 should become +7/+7, making it a 17/16"*. It wasn't: `effStats()`
ended on the literal comment `// layer 5 (Inverted), 6 (Unaware) go here` and did
nothing with the attribute. Layer 5 now ships; layer 6 ({Unaware}) is untouched and
still parked.

**The operation.** After layer 4, if the unit has {Inverted}:

```
p = 2·baseP − p      t = 2·baseT − t
```

i.e. `base − (current − base)` — negate the accumulated delta from base. Caleb Gannon
derived it in `#rules-questions` and then checked it against the other candidate
reading (negate each contribution separately) himself:

> **calebgannon:** "1/4 tough balanced is 8/8 — Tough is +0/+4, Balanced is +7/0. If we
> include inverted it gains +0/-4, -7/+0 → To become a -6/0"
> **calebgannon:** "If we compare 8/8 to 1/4, it's +7/+4"
> **calebgannon:** "Which also works to invert to a -6/0"

The two agree, so the delta form is the implementation. It is arithmetic, not wordplay:

> **lofavreel:** "Now I know it means 'the result of the change gets inverted'."
> **calebgannon:** "yes … it is a mathematical operation, not a linguistic operation"

So Tough inverted is not "halve the defense", it is "lose the +0/+4 you gained"
(**calebgannon:** *"inverted would turn their +0/+3 into -0/-3 and kill them"*), and
counters ride along by construction (**dickey3471:** *"Does inverted reverse the affect
of +1/+1 Counters?"* — **calebgannon:** *"yes"*). Its Dark Bubb's own reminder text says
the same thing in miniature: *"(Invert the stat changes of inverted units. For example,
-1/+2 would become +1/-2.)"*

**Layer 2 is not a change.** A base REWRITE — `Entity.baseSet`, `StaticMod.baseP/baseT`
(R66) — redefines what base *is*, so it is the thing inverted FROM and is never
inverted. A Statweaver'd unit with no other modifiers is a 3/3 whether or not it is
{Inverted}. spikeydog_40883, uncontradicted in the same thread: *"Its base stats aren't
being inverted. Just the modifications to those stats by counters, stat-altering
augments, or attributes."*

**Applied once.** {Inverted} is read from the same deduped walk layer 4 uses
(`E.statLayerAttrs`, renamed from `layer4Attrs`), so R19's rule holds for it too: an
attribute is either present or not, and two Reality Benders on one host do not cancel
into a double negation.

**Column-shared**, and this is asked and answered rather than extrapolated:

> **spikeydog_40883:** "So, all attributes are shared between the units in the same
> column? Including stuff like Inverted or Tough?"
> **calebgannon:** "Yes"

and generally: *"Units in a column just share attributes in all situations… if one unit
in the column has tough, the other will also have it and it's defense will be doubled
(regardless of it's when you're calculating combat damage, fighting or whatever)"*.
A player working out the consequence in the same channel: augmenting Reality Bender
onto a robot's column-mate kills the robot *"because it would share inverted attribute
with"* it.

**Death is checked after, not during.** `effStats` is atomic and `checkDeaths` runs on
the answer, which is already what the rules want — no change was needed here, but it is
load-bearing enough to pin:

> **Q:** does it die if it hits 0 partway through? **calebgannon:** "Not if it hits 0
> mid calculation" / "Doesn't instantly die"
> **lofavreel** (agreed by Caleb): "imagine it as one big equation that has at the end
> 'and all of this = health'. It is not a time thing… in the game no time passes
> inbetween."

So a 1/1 with a -1/-1 counter and {Inverted} is a live 2/2, never a dead 0/0.

### ⚠ OPEN — is {Inverted} really a clean layer, or interleaved into layer 4?
Caleb, immediately after the worked example above:

> **calebgannon:** "Tough inverted balanced would be different" … "It would survive as a 1/1"

which reads as {Inverted} taking a *position* in layer 4's application order and
inverting only what was accumulated up to that point, rather than being a clean layer
after all of it. He then closed the case himself:

> **calebgannon:** "Tough inverted balanced is basically impossible to make happen.
> Because tough inverted would die before you could add more"

The engine ships the clean layer — it is the reading his own worked example uses, it is
the only one the grant channels can express (nothing records the ORDER an attribute was
granted in relative to the others), and the divergent case needs a unit to survive being
Tough-and-Inverted first. **If the owner wants the interleaved reading**, the change is
in `E.statLayerAttrs`: it already returns the attrs in application order, so layer 5
would move inside the layer-4 loop and negate against a running snapshot instead of
against base. That is a strictly larger job and would make the answer depend on grant
order for the first time.

### ⚠ OPEN — two `card-ledger.ts` entries are now stale by construction
`Its Dark Bubb` and `Reality Bender` were listed as wholly-{Inverted} dead cards. Both
work now with no card-file change (Reality Bender is already augmentable via printed
`augmentAttrs`), so both entries should be **deleted**. `71-card-ledger.test.ts`'s
placeholder check is now per-attribute — layer 6's placeholder still exists and holds
up Bubb / Trashling / Haboob, layer 5's does not — so the suite says so out loud until
they go.

Guarded by `79-round17-layers.test.ts::R93 layer 5: the owner's Malformed Monstrosity —
a 10/9 at -7/-7 inverts to 17/16`, `79-round17-layers.test.ts::R93 layer 5: Caleb's
worked example — a 1/4 Tough Balanced Inverted is a -6/0`, `79-round17-layers.test.ts::
R93 layer 5: a base REWRITE is the thing inverted FROM, never inverted itself`,
`79-round17-layers.test.ts::R93 layer 5: {Inverted} applies ONCE however many sources
grant it`, `79-round17-layers.test.ts::R93 layer 5: {Inverted} is shared down the
COLUMN, like every other attribute`, `79-round17-layers.test.ts::R93 layer 5: hitting 0
mid-calculation is not death — the equation resolves first`, and
`79-round17-layers.test.ts::R93 layer 5: Its Dark Bubb — the whole card is the
attribute, and it works now`.

### R93 addendum — the one part of {Inverted} the corpus CONTRADICTS itself on

Settled by Bena on 2026-08-22, after being shown both worked examples side by
side. Recorded here because it is the kind of thing a future reader will
re-derive from the corpus and "fix" in the wrong direction.

The question is what {Inverted} inverts *from* when a base REWRITE is in play
("becomes base 4/4" — Formless; "your units are base 3/3" — Aberrant
Statweaver, R66).

**What R93 ships**, and what Bena ruled for: layer 2 redefines what base *is*,
so it is not a stat *change* and is the thing you invert *from*. Backed by
spikeydog_40883 in `#rules-questions`: *"Its base stats aren't being inverted.
Just the modifications to those stats by counters, stat-altering augments, or
attributes."*

**What the corpus says elsewhere**, explicitly and twice — `_passer`, who
writes most of the `[Solved]` RAQ summaries:

> "Inverted looks at Printed base stats, looks what unit is 'currently' and
> invert the difference"

> "So if there was 10/15 which base stats were changed to be 4/4 (Formless does
> this), it had +1/+1 counter, then: 10/15 → 4/4 → 5/5. If you invert it now it
> sees that total diff from original stat is -5/-10, so it traces back to
> original stats (10/15) and add inverted values (+5/+10) to 15/25"

On that board the two readings give **15/25** and **3/3**. Caleb never
addressed base rewrites: his own worked example (1/4 Tough Balanced Inverted →
-6/0, the one R93 is built on) contains no rewrite, so it does not
discriminate. `_passer` also confirms the *placement* — *"Inverted is second to
last, just before Unaware"* — which R93 follows.

If this is ever put to Caleb and he answers the other way, the change is one
line in `effStats` (compare against layer 1 rather than `base`) plus the test
`79-round17-layers.test.ts::a base REWRITE is the thing inverted FROM`, which
carries both quotes so the alternative is one edit away rather than a
re-investigation.


## R94 — The static → effect-attribute channel (`EffectAttrMod`), and a live source read
Two of the pool's "deck enabler" cards project an attribute onto a resolving EFFECT
rather than onto a unit:

- **Emberflame Enlightener** — "[Augment] Your units and spells gain {g}powerful."
- **Envoy of Lightning** — "[Augment] Your spell effects with a single target are
  {g}Electric."

R79 built the READ side of this (`EffectCtx.grantedAttrs`, unioned into the source's
attributes by `dealEffectDamage`), but its only writer was `E.stackAugmentAttrs` — a
VIRUS augmented onto an item already on the stack. Nothing continuous could reach it.

### The shape: a sibling of `CostMod`, not an extension of `StaticMod`
`StaticMod.affects` is typed over an `Entity`, and a `StackItem` is not one. So
`EffectAttrMod` (`dsl.ts`) is `CostMod`'s sibling and `E.effectAttrsFor` is
`costModsFor` line for line: the same `anchored()` walk (units in play **and** augment
mods, each read from its HOST), the same R12 region scope, the same **shallow** R62
guard (`anchor.suppressed?.abilities`, not the full `abilitiesSuppressed()`
projection), the same reentrancy latch, and an early bail when no card in the region
declares `effectAttrs`. Ownership stays in the card's own `affects`, which is the
division `StaticMod` already uses — so an Enlightener augmented onto an ENEMY unit
boosts *that enemy's* spells, matching the units half exactly.

### PER PART, with a DECLARED target count — and getting this wrong is silent
The gatherer runs once per PART of a resolving item, and `EffectAttrCtx.targets` is
`part.targets.length` (the cast-time list), **never** `ctx.targets.length` (the
survivors `resolveParts` has already filtered). RAQ *"[Solved] Envoy of Lightning vs
Twin Flame."*, in full:

> **Q:** "If Twin Flame is played with only 1 target, is it Electric thanks to Envoy?"
> **A:** "Yes, it will be Electric"
> **Q:** "What if Twin Flame was played targeting two units, but one of them was removed
> before Twin Flame resolves. Will it be Electric?"
> **A:** "No, it still has 2 targets, but one of them is invalid (but could become valid
> thanks to Gravitational Correction or Warder)."

A channel built on the survivor count scores perfectly on Emberflame and wrongly — and
invisibly — on Envoy, which is why the declared count is load-bearing enough to have its
own test.

### The separate bug found on the way: `dealEffectDamageAll` read the PRINTED source
`E.dealEffectDamageAll` opened on `this.card(ctx.sourceName)?.attrs`. Combat damage has
always read the LIVE entity (`colAttrs` → `ownAttrs` → `staticsFor`), so a unit that
**gained** {Powerful} hit twice as hard with its body and exactly as hard as before with
its own damage ability. Nine cards in the pool deal noncombat damage from a unit source
(Soul Reaver, Deformant, Bloated Manablub, Verdant Necrophage, Cthyrian Culler, Nectar
Ridge Oracle, Restitution, Seismomancy, Mirrorback Ambusher). The designer scales
exactly this, RAQ *"[Solved] Resonant, Combat Damage, Conduit and Powerful"*:

> **Q:** "What if Resonant is Powerful?"
> **A:** "2/4 Resonant Powerful would deal 4 combat damage to enemy unit and then **put
> effect on stack to deal 8 damage to enemy face**."

It now reads the live source entity and falls back to the printed card once the body is
gone — `E.itemAttrs`'s shape, which has been right all along for the {Afflicting} check.
`ownAttrs`, not `effAttrs`: column-sharing is a COMBAT layer, and an effect's source is
the card, not the column it is standing in. `E.itemAttrs` itself is left alone (it is
per-ITEM and has no target count; it only feeds {Afflicting}).

### ⚠ OPEN — does "your SPELLS" include your spell TOKENS?
It is the difference between an Emberflame deck doubling its Burst Fireballs and not, so
it is a real deck-construction question. **The engine's default is YES** and it is
decided in ONE place, `dsl.isSpellEffect` — delete `'spellToken'` from that line and
both cards move together.

The reasoning: a spell token *is* a spell, and Emberflame's text has no play verb to
hang a carve-out on. R59 DID carve tokens out of `costMods` — "a spell token is cast
from play, not played" — but that exists because Tranquility says "cards cost [one] more
to **play**". The corpus is thin and second-hand (lordofkaranda, rules-questions: *"Spell
tokens are spells and activating them is playing them"* — a player, not Caleb, and its
second half contradicts R59's own basis). Nothing from the designer either way.
`12-fire-a.test.ts` pins the current answer explicitly so a ruling either way lands as a
one-line change plus one number.

### ⚠ OPEN — the RESONANT rider is doubled twice in the RAQ, once in the engine
The same RAQ continues: *"Resonant+Powerful+Conduit? … 2/4 would deal 4 combat damage to
enemy unit, and then put effect on stack to deal (4+1)x2 = 10 damage to enemy face"* —
the rider is scaled by {Powerful} a SECOND time, after it has already been computed off
the doubled combat damage. The engine riders the undoubled amount (`dealEffectDamageAll`
and the combat assign path). Flagged, deliberately not changed: it is a separate ruling
with its own arithmetic and its own blast radius.

### Handoff: `card-ledger.ts` and the canary
`Envoy of Lightning`'s ledger entry should be **deleted**, and `Emberflame Enlightener`'s
with it (its `partial` was the spells half). `71-card-ledger.test.ts` used Envoy as the
load-bearing canary proving the dead-shape sweep still has teeth; the canary is now
**Conduit of Pain**, which is byte-for-byte the same inert-augment shape, is declared in
the ledger, and is genuinely parked (it needs a noncombat damage REPLACEMENT hook, which
this did not build). `deadShapes`'s `BEHAVIOR_KEYS` gained `'effectAttrs'` so a card
whose only behaviour is one is not swept up as "bare".
`68-target-conformance.test.ts`'s Envoy exemption is still needed and still correct in
substance; its wording ("a static, targets nothing") should read "an `effectAttrs` mod".

Guarded by `12-fire-a.test.ts::Emberflame Enlightener: your SPELLS gain {Powerful} too —
a spell effect deals double`, `12-fire-a.test.ts::Emberflame Enlightener: "YOUR spells" —
the opponent's spell in the same region gains nothing`, `12-fire-a.test.ts::Emberflame
Enlightener: the SPELLS aura is DONATED too (mod-carried effectAttrs)`,
`12-fire-a.test.ts::Emberflame Enlightener: ⚠ OPEN — "your spells" currently INCLUDES
your spell tokens`, `12-fire-a.test.ts::Envoy of Lightning: plays as a 3/2, and is still
applicable as an augment`, `12-fire-a.test.ts::Envoy of Lightning: your single-target
spell effects are Electric`, `12-fire-a.test.ts::Envoy of Lightning: two DECLARED targets
is not "a single target", even after one is removed`, `12-fire-a.test.ts::Envoy of
Lightning: one declared target on the SAME spell is Electric (the control)`, and
`79-round17-layers.test.ts::R94: a unit's own damage ability reads the {Powerful} it was
GRANTED, not its printed attrs`.

## R95 — `ModPermission`: an opt-in permission to apply a mod (Rook)
"[Augment] You may augment cards from hand and bin during battle as if they were
[Virus]." (Rook, me/4 4/4). This text is the whole card, and until round 17 you got a
vanilla 4/4.

**The default is NO, and it takes explicit wording.** The designer says both halves of
that in one exchange (`#rules-questions`):

> **chatt_nooga:** "Does Steward of the Plain let me apply a virus from my discard during
> combat?"
> **calebgannon:** "That's a very interesting question" / **"It shouldn't"** / "But I can
> see why it might be interpreted that way"
> **chatt_nooga:** "Okay but hear me out: What if it did? Would that be broken?"
> **calebgannon:** **"Not really I don't think. If it said 'as if it was in your hand'
> then it could work"** → `$card rook` → **"Does do that"** / "Steward and rook are good
> friends"

So the seam is opt-in per card, never a general widening of the battle window.

### The shape
`CardBehavior.modPermissions?: ModPermission[]`, with
`{ augmentInBattle?: (g, self, ctx: ModCtx) => boolean }` and
`ModCtx = { seat, card, from: 'hand'|'bin'|'cache', region }`. Structurally a `CostMod` —
same ctx, same `anchored()` radiation from a unit in play or an augment mod reading from
its HOST, same R12 region scoping, same reentrancy latch, same purity rule — but folded
as an **OR**, not summed: one grantor is enough and two Rooks are not twice as
permissive. That is the whole reason it cannot be a `CostMod`, which adds numbers.

`self` is the ANCHOR, so the `[Augment]` half is free: augmented onto a host, the
permission belongs to the host's controller.

`ModCtx.from` is in the signature rather than hardcoded at the call site, so **Rook
itself** refuses the cache — the printed zone list ("hand and bin") is the card's, not
the rules'. Region scoping is not a convenience either; on this exact card, rodanaw in
`#rules-questions`: *"I am 99% sure that Rook has to be in the region, since there are no
global effects in Algomancy"*, and generally *"Yes. as with 99.99% of all questions
regarding regions."*

### ⚠ The most dangerous line in the change
`c.virus` was read in exactly three places engine-wide, and the two battle branches of
`doAugment` bypassed the `ModZone` plumbing in a **second**, load-bearing way: both
hardcoded `e.player(seat).hand.splice(index, 1)`. Widening only the `e.need` would have
let a bin augment through and then **deleted the wrong card out of the hand**, leaving
the bin card in place. Both are `zoneTake(e, seat, from, index)` now, and
`29-hybrids-wm-a.test.ts` pins the hand contents explicitly so the failure mode is a
red test rather than a silent card swap.

`legalActions`'s battle window grew a `pushBattleAugments` walking hand **and** bin —
there had been no bin leg at all, which is why the card was unreachable even where it
was legal — and it routes through the same `battleAugmentAllowed` predicate `doAugment`
enforces. One predicate, two callers.

### ⚠ Bins now change size mid-battle
Nothing read a bin's LENGTH mid-battle before this. R51's zone triggers (a card that
acts while it sits in a bin) and R40's trash ledger both read bins, and R51 says in as
many words that *"There is still no 'a card left a bin' event"* — so a card leaving a bin
this way is silent. Nothing in the pool currently depends on it; flagged because the next
card that does will land on it.

### ⚠ OPEN — three questions for the owner
1. **Does "as if they were [Virus]" unlock R79 STACK hosts** (augmenting a spell on the
   stack), or only unit hosts? R79 is *what a Virus may do*, so the permissive reading
   unlocks both, and that is **what ships** — one predicate guards both branches of
   `doAugment`. If the ruling is that the permission is only about the hand-and-bin
   TIMING, the stack branch's gate goes back to `c.virus && from === 'hand'`.
2. **Does the card actually GAIN {Virus}, or only the timing permission?** It matters for
   erase-on-host-death and anything else that reads `c.virus` off a mod. **Only the
   permission ships** — nothing writes `virus` onto the card or the mod.
3. **Does it cover GRAFT?** Printed text says "augment", `doGraft` is deployment-only,
   and the recommendation is **no**. Nothing was built for it.

Guarded by `29-hybrids-wm-a.test.ts::Rook: a NON-virus augment from HAND during battle —
refused without it, legal with it`, `29-hybrids-wm-a.test.ts::Rook: augmenting from the
BIN during battle takes the card out of the BIN, not the hand`,
`29-hybrids-wm-a.test.ts::Rook: legalActions OFFERS the bin augment, and offers nothing
without a Rook`, `29-hybrids-wm-a.test.ts::Rook: the permission is REGION-scoped, and
does not reach the opponent`, `29-hybrids-wm-a.test.ts::Rook: the [Augment] half works,
and the permission belongs to the HOST`, and `29-hybrids-wm-a.test.ts::Rook: it prints
"hand and bin", so the CACHE stays shut`.

`card-ledger.ts`: **delete Rook's entry.**

### The HASTE sibling — `applyAtHaste` (Slurpr), shipped 2026-08-23
"[Augment] You can apply other mods during [Haste] as if it was deployment." — Slurpr,
l/2 2/2. `ModPermission` has a second member, `applyAtHaste?: (g, self, ctx) => boolean`,
and `ModCtx` grew an optional `kind?: 'augment' | 'graft'`.

**It is R95's shape and not R97's, on purpose.** Dispatch Courier prints *"Each turn"*, so
R97 SUMS its grants into a per-turn budget kept in `hastePlaysUsed`. Slurpr prints no
quantity at all, so this is an unbudgeted **OR-fold**: one grantor is enough, two Slurprs
are not twice as permissive, and **no new `GameState` field exists or is needed**.

**"Other mods" is augments AND grafts** — R37's word for both — which is why `ctx.kind` is
on the context. A card that wants only one half reads it; Slurpr grants both and reads
neither. *"As if it was deployment"* is the whole grant: the deployment branch runs
verbatim with only its **phase test** replaced, so every other deployment refusal still
refuses (paying at `purpose: 'mod'` under R37/R59, the host being in your own region, a
graft needing a graft cause on its host, R89's spell-token hosts).

**"Other" needs no self-exclusion.** The granting Slurpr is already applied, and a second
Slurpr card in hand genuinely is another mod.

#### The four gates, and which one is fatal
1. `E.mayApplyModAtHaste` — the OR-folding gatherer, byte for byte `mayAugmentInBattle`
   apart from the member it reads. It needs the **private** `anchored()` walk and the
   `inModPermissions` latch, which is exactly why it cannot live in a card file. Same R12
   region scope, same shallow R62 guard. **No base case**, unlike the battle window's
   {Virus}: nothing is printed as haste-timed modding, so the whole permission is the
   grant.
2. `apply.ts`'s `hasteModAllowed` — **the one predicate**, R95's `battleAugmentAllowed`
   precedent. It adds the window test (the R18 haste step, this seat not yet done) and is
   called by the action path *and* the offer path, because the fuzzer's "legalActions
   lied" invariant has caught that split before.
3. The action path: a haste branch in `doAugment` (whose else-arm was
   `illegal('modding is a deployment action (or a battle Virus)')`) and in `doGraft`.
   ⚠ `doGraft`'s timing gate **moved off its first line** — the predicate asks the granting
   card about the `CardDef` being applied, so the `zonePeek`/`getCard` lookups have to come
   first. The refusal is otherwise unchanged, and still precedes anything being taken or
   paid.
4. The offer gates, **both** of them. `legalHasteActions` grew `pushHasteMods`, which
   shares one extracted `pushMods` walk with the deployment offer — hand, bin and cache
   (R41), for augments and grafts alike — because *"as if it was deployment"* is precisely
   a claim that the two lists are the same list. And `startHasteStep`'s `canHaste`, which
   **skips the step outright** when no seat has a legal *play*: a board with a Slurpr and a
   hand of nothing but mods would never have reached gates 2 and 3 at all. That is playtest
   report #74 (R97's own fatal gate) one verb over, and it is the seam that would have made
   the whole card silently unreachable. `E.hasHasteModAvailable` is that gate; it cannot
   call `hasteModAllowed` (which gates on the `hasteDone` this very function is deciding),
   so it duplicates the zone walk by hand and shares the **permission** half through
   `mayApplyModAtHaste`.

Guarded by `40-light-c.test.ts::Slurpr: mods may be applied during [Haste] as if it was
deployment`, `40-light-c.test.ts::Slurpr: a GRAFT lands during [Haste] too`,
`40-light-c.test.ts::Slurpr: the [Haste] mod permission is region-scoped and belongs to the
grantor's controller`, `40-light-c.test.ts::Slurpr: the haste step OPENS for a hand of
nothing but mods`, `40-light-c.test.ts::without a Slurpr the [Haste] refusal is unchanged`,
and `40-light-c.test.ts::Slurpr: R37 — a mod applied during [Haste] pays at purpose "mod"`.

`card-ledger.ts`: **Slurpr's entry is deleted.**

## R96 — Playing a spell from your BIN, and {Unstable} as a stamp
"In this battle, you may play spells from your bin. If you do, they gain {p}unstable
until regroup. (If they would enter a bin, erase them instead.)" — Abyssal Evocation,
rr/4 {Battle}. Until round 17 it resolved to an info line and went to the bin, so a
bin-recursion deck built on it had no recursion at all.

### The permission is BATTLE-SCOPED STATE, and that is forced, not chosen
`E.anchored` walks `holder.kind === 'unit'` and `'mod'`. Abyssal Evocation is a **spell**:
it resolves and goes to the bin, so there is nothing left in play to radiate from and it
cannot be an `anchored()` radiator like R59's `CostMod` or R95's `ModPermission`.

It is a `battleCounter` instead — `E.mayPlaySpellsFromBin` / `E.grantBinSpellPlay`,
copied from `battleCounter`/`bumpBattleCounter`. That is an exact fit for "**in this
battle**": the counters are region-KEYED, which is R14's *"'this battle' = this region's
battle"* for free and stops round 1's permission leaking into round 2, and they are wiped
by the existing per-battle-phase reset, so "in this battle" needs no cleanup code. It is
also **not a new `GameState` field** — zero serialization and replay risk.

The key names what was granted (`binPlaySpells:<seat>`), so a future "you may play UNITS
from your bin" gets its own key rather than silently widening this one.

### The action is its own variant
`{ type: 'playFromBin'; seat; binIndex }`, following `prophesy`'s precedent — NOT a
loosened `playCard`. `playCard` means "out of your hand" everywhere in the engine and in
the whole replay corpus, and widening it would silently re-index every saved game's hand
plays. `doPlayFromBin` is modelled on `doPlayCached`, which is *the* "play from a
non-hand zone gated on a permission" function; the `bin` arm of `castable` / `baseItem` /
`playAtTiming` / `StackItem.from` was already pre-wired with no callers, and this is the
caller. `legalActions`'s `pushBinPlays` and `apply`'s `doPlayFromBin` read the **same**
predicate — the fuzzer's "legalActions lied" check has caught that class of split before.

### {Unstable} is a STAMP, and there are TWO decision points
"Gain … **until regroup**" means the card stays Unstable after the permission lapses, so
it cannot be derived from the permission. `StackItem.unstable` and `Entity.unstable` are
the stamp. ⚠ {Unstable} is **not** an `Attr` (it is absent from the union on purpose — it
is a bin replacement, not a combat attribute), so it cannot ride `tempAttrs`.

The engine has two independent "is this Unstable" sites and both had to learn about it:

| site | derived reason | + the stamp |
| --- | --- | --- |
| `destroy()` — a unit leaving play | `mods.length > 0` | `\|\| u.unstable === true` |
| `dischargeItem()` — a card leaving the stack | `item.augments?.length` | `\|\| item.unstable === true` |

`dischargeItem` is the one an ordinary bin-played spell hits, and it is the single choke
point for both resolution and negation. The virus loop inside that branch is untouched —
it iterates `viruses` and is correctly a no-op at zero.

R69 confirms the mechanism and names this card: *"Reminder text on both cards that GRANT
it (Abyssal Evocation, Spell Excavation): '(If they would enter a bin, erase them
instead.)' — a bin replacement, in as many words. … Only the destination changes."*

"Until regroup" is one line in the existing R11 step-3 sweep, beside `delete e.suppressed`.
And propagating the stamp onto the body a bin-played spell UNIT spawns (`afterParts`)
closes **Spell Excavation's** own *"edge, noted for review"* in the same change.

### ⚠ OPEN — does a bin-played card obey its PRINTED timing?
**Shipped RESTRICTIVE.** R42/R45 answered the analogous CACHE question that way — *"normal
TIMING applies — the card is played 'as if it were in your hand' … (Caleb 2025-12-28)"* —
and `playAtTiming` enforces it for free. The consequence is real: **only {Battle} spells
in your bin are playable**, so a bin of deploy-timing spells is inert under this card. The
permissive reading needs an explicit timing override. A test pins the restrictive answer
so a ruling either way is a visible change.

(A side effect worth knowing: Abyssal Evocation is itself a {Battle} spell, so once it
resolves it sits in your bin and is one of the spells you may now replay.)

### ⚠ PARTIAL CREDIT — this does NOT unpark what the ledger implies it does
The card-ledger notes say the same missing permission parks **Writhing Host** and half of
**Trench Stalker**, and that Rook waits on it too. That is more shared credit than is
real:
- **Rook** needed the *mod*-application sibling, which is R95 and a different seam
  entirely; this built none of it.
- **Writhing Host** and **Trench Stalker** need more than a bin-play permission — check
  each against its printed text before deleting anything.
Only **Abyssal Evocation**'s entry is unambiguously stale.

Guarded by `12-fire-a.test.ts::Abyssal Evocation: in this battle, you may play spells from
your bin`, `12-fire-a.test.ts::Abyssal Evocation: a bin-played spell is {Unstable} — it is
ERASED, never re-binned`, `12-fire-a.test.ts::Abyssal Evocation: the permission is this
REGION's battle, and lapses at the next one`, `12-fire-a.test.ts::Abyssal Evocation:
without the permission the action is refused, not just unoffered`, `12-fire-a.test.ts::
Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing`, and
`12-fire-a.test.ts::Abyssal Evocation: a bin-played SPELL UNIT stamps its BODY, and
"until regroup" ends it`.

---

## R97 — A card may be granted permission to be PLAYED at a timing its printed line refuses

**Playtest report #74 (WEHH, 2026-08-22): "Dispatch Courier didn't give me the option to
play a card with haste."** It did not, because nothing anywhere asked.

### The rules half was already settled
Caleb's Discord, rules-questions, on the printed "mana step" symbol:

> **calebgannon:** "that symbol is haste, meaning you can play it during the mana step"
> **calebgannon:** "There is no priority during the mana step, but you can play haste cards
> and resources as special actions"
> **nyarlathotep8457:** "Yes the Mana step is the resources step of the planning phase."

So **the printed "mana step" IS this engine's R18 haste step**, and Dispatch Courier
("[Augment] Each turn, you may play a unit during the mana step as if it had [Haste]") was
asking for exactly one thing: a seat-level play-timing grant.

### The seam
`PlayPermission.playAtHaste` (`cards/dsl.ts`), gathered by `E.hastePlayAllowance` and asked
through `E.mayPlayAtHaste`. Radiation is R95's, unchanged — the `anchored()` walk (a unit in
play, or an augment mod read from its HOST), R12 region scope, the shallow R62 guard, a
reentrancy latch.

**It SUMS where R95 OR-folds**, and that is the one deliberate difference. Two Rooks are not
twice as permissive, but two Couriers each print "Each turn, you may play a unit" and two of
them are two plays. `Infinity` recovers the OR-fold for a grant with no budget in its text,
so both shapes fit one number.

### THREE gates that must agree, and one of them is load-bearing
1. `E.startHasteStep()`'s `canHaste` — **it skips the step OUTRIGHT** when no seat has a
   legal haste play. Miss this one and the other two are never asked: a hand of nothing but
   deploy units plus a Courier on the board never even opens the step. That is the bug the
   report saw.
2. `legalActions`' `phase === 'planning' && s.hasteDone` branch — the client's affordance.
3. `playAtTiming`'s planning branch — the enforcement.

All three call the same `E.mayPlayAtHaste`. The fuzzer's "legalActions lied" check exists
for exactly this class of split.

### The budget
`GameState.hastePlaysUsed` — the per-seat sibling of R43's `hasteManaSpent`, zeroed by the
same `startHasteStep`. **A play is not an ability activation**, so nothing writes
`Entity.budgets` for one and the printed "Each turn" has nowhere else to live. The haste
step happens exactly once a turn, so "per haste step" and "each turn" are the same window.
Charged only after the play is known legal and paid for — an illegal attempt must not eat
the turn's allowance.

### ⚠ WHAT A GRANT CANNOT DO: a {Battle} card stays a battle card
RAQ **"[Solved] Dispatch Courier vs Battle Timing"**, in full:

> Q: Does units / spell-units with {Battle} timing can be played during {Haste} thanks to
> Dispatch Courier?
> A: **No, despite gaining {Haste} they can still only be played during {Battle}.**

The designer's own reasoning, rules-questions, on this exact case:

> **nyarlathotep8457:** "spells like Dreadweave or Hush Mush can't have a legal target in
> the Haste step … That are the reasons why i thought NO was the 'more correct' ruling"
> **calebgannon:** "it's gotta be no"
> **calebgannon:** "battle cards are designed to be played in battle only. Not all of them
> will cause problems but I think some will"

That refusal is GENERAL — it is about what gaining haste can do, not about Courier — so it
lives in `E.hastePlayAllowance` above every grantor, not in any one card's predicate.

### What Courier itself decides
"a UNIT" — `kind === 'unit' || kind === 'spellUnit'`. A spell unit counts: RAQ "[Solved]
Spell Units played when you can 'play a unit from hand'" — *"Q: If you decide to use
Hooba-Pon Effect to play Spell-Unit, does that units 'spell' part happens? A: Yes, the spell
part happens and if it resolves, the unit will spawn into formation"*, and *"Q: Does that
count as 'playing a spell' for some triggers? A: Yes."* The grant belongs to the ANCHOR's
controller, so augmented onto a host it is the host's controller who may play.

### ⚠ PARTIAL CREDIT — what this does NOT unpark
The card-ledger notes say Writhing Host, Rook and Slurpr queue behind this same seam. Only
one of those is true, and it is the one already done:
- **Rook** needed the *mod*-application sibling, which is R95 and shipped separately.
- **Writhing Host** ("If I am in your bin, you may play a unit as if it had [Haste] by
  erasing me as an additional cost") needs two things R97 does not have: a grantor sitting
  in the **BIN**, which `anchored()` does not walk, and an **additional cost attached to a
  different card's play action**, which `PlayCtx` has no room for. Still parked.
- **Slurpr** ("You can apply other mods during [Haste] as if it was deployment") is the
  MOD-timing twin and belongs to R95's family. **COMPLETE as of 2026-08-23** — see R95's
  own "haste sibling" section below for the finished seam.

Only **Dispatch Courier**'s ledger entry is stale.

Guarded by `26-metal-a.test.ts::play a unit during the mana step as if it had`,
`26-metal-a.test.ts::the "Each turn" allowance is one`, `26-metal-a.test.ts::a {Battle} unit
stays a battle card even with the grant`, and `26-metal-a.test.ts::no Courier, no haste step`.

---

## R98 — PREVENTED damage was never dealt (and that is not what REPLACED damage means)

**Playtest report #72 (GETD, 2026-08-22): "Phytochemical Protection is entirely non
functional. Needs to work like the text says. Duh."** It was: the spell targeted, logged,
and did nothing, because the engine had no "damage would be dealt to a UNIT" hook of any
kind. The two that existed (`replaceRotDamage`, `replaceCombatDamageToPlayer`) are both
damage to a PLAYER.

### The choke point
`E.preventUnitDamage(u, amount, info): number` — returns the damage **LET THROUGH**. Both
places unit damage is committed now pass through it: `dealEffectDamageAll`'s per-recipient
pass and `combatSubStep`'s per-unit commit. Numeric rather than boolean so a partial
preventer needs no second seam.

### Prevention unmakes the damage. Replacement does not.
RAQ **"[Solved] Poisonous vs 'Whenever I am dealt damage' vs Phytochemical Protection"**:

> Q: Does Poisonous bypass Phytochemical Protection?
> A: **No it doesn't.** As said above, damage is dealt in the form of -1/-1 counters, which
> means **if there is not damage being dealt, then no counters are placed.**
>
> Eg. … Before regular combat damage is resolved, enemy uses Phytochemical Protection on his
> Jellyglop. Then Sporebloom Siren deals 2 damage to Jollyglop, but damage is prevented.
> **Jollyglop doesn't trigger, won't get -2/-2 from Poisonous but will receive +2/+2 counters
> from Phytochemical Protection.**

So a fully prevented hit produces **no `damage` event** ("whenever I am dealt damage" stays
silent), **no Poisonous -1/-1 counters**, **no {Deadly} kill**, **no {Resonant} rider** and
**no {Blessed} gain** — every one of those is keyed on damage having been dealt.

⚠ This is the OPPOSITE of R38's replacement hooks, where *"replacing the damage does NOT
unmake it: Caleb ruled (2024-10-24) the damage still counts as having been DEALT, so
{Lethal} still kills through it"*. **Replacement is a substitution; prevention is a
subtraction.** Nothing in the engine may treat them as one layer.

### It does NOT touch assignment
RAQ **"[Solved] Excessive Combat Damage & interaction with Piercing, Deadly and
Phytochemical Protection"**, on a shielded 0/5 Awoken Tomb in front of a 5/6 Bubb:

> Q: Two enemies, front is 0/5 Awoken Tomb which has Phytochemical Protection and 5/6 Bubb
> behind it?
> A: You must assign atleast 5 damage to Awoken before you can start assigning damage to
> Bubb in the back. **Awoken will get atleast +5/+5 counters, but won't make 5/5 unit.**
>
> Q: If I had Deadly in above scenario?
> A: Atleast 1 dmg to Awoken (gets +1/+1, won't create 1/1 unit), rest of the damage can go
> to Bubb in the back.
>
> Q: If I had Piercing instead?
> A: Atleast 5 damage to Awoken (gets atleast +5/+5, won't create 5/5), atleast 6 damage to
> Bubb, rest can go to Opponent HP.

The shield changes nothing about lethal assignment, Piercing excess or Deadly's 1-point
floor: those are planned against the unit's real toughness as if it were unprotected. The
hook therefore runs at COMMIT, after all planning — which is also why it is after
{Vulnerable}'s doubling ("all damage that WOULD BE DEALT" to a Vulnerable unit is the
doubled number).

### Where the shield lives
`Entity.damageShield` holds the CARD that shielded, exactly as `suppressed` names the card
that switched a layer off — the log line has to say what stopped the damage. It is an
ENTITY field, not a radiating `StaticMod`, because the shield belongs to a resolved SPELL
with no permanent behind it: there is nothing in play for a static to hang on. Swept by the
R11 step-3 regroup cleanup beside `suppressed` and `unstable`, which is what makes "until
regroup" free.

`Entity.shieldPending` + `E.settleDamagePrevention()` pay out "a +1/+1 counter for each
damage prevented this way". **Deferred to the end of the commit loop**, not paid inside the
hook, because `addCounters` runs `checkDeaths` — paying on the spot would resolve a death in
the middle of a batch R80 deliberately made simultaneous.

### The player hook was widened at the same time, for Oorblak
`replaceCombatDamageToPlayer` now takes `attrs` (the striking column's live attributes) and
`pure` (R61) in its `info`, and may return a **NUMBER** — the damage let through — instead
of a boolean. `true`/`false` keep their old meaning, so it is a widening and Blightsea Polyp
is untouched. Oorblak's ledger entry said in so many words that `{ attacker, region }` and
an all-or-nothing return were why its Piercing-excess half was parked; both are gone, and
the card was rewritten against them on 2026-08-23. The `PARKED — Piercing excess` todo is
now four real tests in `17-earth-b.test.ts` and the ledger entry is deleted.

### ⚠ TWO THINGS LEFT OPEN, both deliberately
1. **The counters cap at LETHAL, not at the whole hit.** The engine's R7 auto-assignment
   gives each blocker exactly enough to kill it and DROPS the rest (only {Piercing} carries
   excess anywhere). The RAQ says otherwise for this card — *"Q: No Deadly, No Piercing.
   Single enemy with Phytochemical Protection? A: All damage must be assigned to this single
   unit and whole damage will be prevented, potentially putting a lot of +/+ counters."* —
   so a shielded 1/1 blocking a 7-power column gets **1** counter here and **7** by the
   ruling. Not changed: making the leftover pool land would move every overkill number in
   the engine (marked damage, the "takes N" log line, and every {Resonant} rider), which is
   an assignment ruling of its own and wants its own R-number. Pinned by a test so a fix is
   a visible change.
2. **Two Phytochemical Protections on ONE unit.** The shield is a single named flag, so the
   second spell re-stamps it and the unit still gets ONE counter per damage prevented, not
   two. Nothing in the corpus addresses it.

Guarded by `24-wood-b.test.ts::combat damage is prevented and paid back as`,
`24-wood-b.test.ts::prevented damage is NOT dealt`, `24-wood-b.test.ts::Poisonous does not
bypass it`, `24-wood-b.test.ts::cannot kill through it`, `24-wood-b.test.ts::the shield lasts
UNTIL REGROUP and no longer`, and `24-wood-b.test.ts::the counters cap at LETHAL`.

---

## R99 — A constructed deck's ELEMENT IDENTITY is a presentation hint, never a rule

**Playtest ledger #63 (GETD, 2026-08-22): "In constructed, the resource options from
recycling and prismites should be limited just to the elements that are in your deck. No
need to put the whole list for every single game when they're not relevant."**

`GameState.deckElements[seat]` is the union of `getCard(n).factions` over that seat's
decklist, in canonical `ALL_ELEMENTS` order, computed in `createGame` **before the shuffle**
(it is a property of the deck, not of the order it landed in) and present in `constructed`
mode only. Shared plays all seven; draft has already narrowed `elements` to its trio.
A client must fall back to `elements` when it is absent.

### ⚠ IT IS A MENU DEFAULT AND NOTHING ELSE
`legalActions` still offers **all seven** elements for `recycleForResource` and
`exchangePrismite`, and `doRecycleForResource` / `doExchangePrismite` still accept all seven.
Nothing that was legal became illegal, which is why all 19 saved games still replay.

That restraint is not caution, it is the rule: **Reap the Due is mono-light and scales off
DARK affinity**, so a mono-light deck running it must still be able to take dark resources
or the card is blank. The client should DEFAULT the menu to `deckElements[mySeat]` and keep
the other elements reachable — a "show all seven" affordance, not a hard filter.

Also: `els` on a saved game file is a **red herring** for this. It is the draft trio and is
written for every mode, constructed included.

### ⚠ OPEN QUESTION FOR THE OWNER — is deck element identity PUBLIC at game start?
It decides whether `deckElements` belongs in both players' views or only the owner's.
**Shipped unredacted**, because redaction lives in `server/view.ts` and the engine cannot
reach it. If the owner rules it PRIVATE, the whole change is one line in `viewFor()`,
alongside the existing hand/deck redactions:

```ts
if (v.deckElements) v.deckElements = v.deckElements.map((d, s) => (s === seat ? d : []));
```

Either way the CLIENT should read `state.deckElements?.[mySeat] ?? state.elements` and never
the opponent's entry, so the menu behaves identically under both rulings.

Guarded by `34-constructed.test.ts::constructed records each seat`, `34-constructed.test.ts::
it is a PRESENTATION default`, and `34-constructed.test.ts::absent outside constructed`.

---

## R100 — "I can't be played from your hand" is a ZONE restriction, and it needed its own flag

`CardBehavior.noPlayFromHand` — the mirror of R42's `prophesyFromBin` and defaulting the
other way round: every card may be played from hand unless it says it may not.

Calming Force prints "I can't be played from your hand. Negate all other effects." The
negate half had shipped; the restriction had not, so **the engine was strictly MORE
permissive than the printed card** — the one direction a rules engine must never be.

It took a new flag because nothing existing means this. R64's `restrict` narrows what an
EFFECT may TARGET; `prophesyFromBin` is a different zone and a different verb; `timing` is
about WHEN, not WHERE FROM.

Enforced in **four** places, and all four matter:
- one `e.need` in `doPlayCard`, so a hand-play is REFUSED rather than merely un-offered;
- the three `legalActions` sites that push a hand `playCard` (the R18 haste step, the battle
  priority window, deployment) — **a refusal the UI still offers as a legal click is its own
  playtest report.**

The check sits in `doPlayCard` after the `ambush` / `discardMe` dispatch, deliberately: those
are their own printed play modes with their own cost lines, and no card yet prints both this
restriction and one of them. It is also nowhere near `playAtTiming`, because it is about the
ZONE and not the timing.

⚠ **The line names one zone and one verb, so that is all it takes away.** Calming Force is
still reachable by a cache release (R42/R45), by a bin-play permission (R96), and as a mod,
and it can still be discarded and recycled from hand like any card. In practice it becomes a
card you have to set up.

Guarded by `40-light-c.test.ts::is enforced, and not just un-offered`.

## R101 — TRANSFORM: turning a card over is a mutation of `Entity.card`, not a new unit
Playtest ledger #24 (room ZQPC, 2026-08-20): *"Scholar of the Void doesn't say what the
Beyond card it can transform into does"*. The entry sat blocked for two days on a fact
rather than a design question — **"Beyond, Codex Incarnate" existed in no data we hold**:
not the 534-card oracle file (which names it only inside Scholar's own text), not the
corpus, not the rulings export, and there was no art. The owner supplied the card face on
2026-08-22. It is transcribed in `src/cards/registry.ts`:

> **Beyond, Codex Incarnate** — cost 0, 8/3, *Book Token Unit*
> "If you would take damage from rot, put that many -1/-1 counters on target unit instead.
> Your units are {g}inverted. {i}(Reverse their stat changes.)"

and the owner's note on why it is not in the pool: *"can't be played cause it's on the
back of a card"*. It is a `registerSynthetic` and deliberately NOT a `printed.json` row —
that file is regenerated from `scripts/pool.mjs` over the oracle data, so a hand-added row
would be silently dropped on the next regeneration.

**There is no transform layer, and there does not need to be.** `Entity.card` IS the
card's identity: `E.baseStatsOf` reads `this.card(e.card)` for layer 1, the bin push on
death reads `u.card`, "name a card" and counters-by-name key off it, and the client
renders from it. So `self.card = 'Beyond, Codex Incarnate'` changes all of them at once
and consistently, which is exactly what "transform me into X" means. Card code in this
repo already mutates its own entity directly (`self.budgets[key] = 1`, batch-metal-a), so
the operation belongs where it is written rather than behind a new engine primitive.

**A transform is the SAME unit with a different face up.** Nothing is deleted and nothing
is spawned, and this is a ruling, not a convenience:

- **same `id`**, so anything holding it — a block assignment, a queued trigger's
  `sourceId`, a spell already targeting it — still points at the right thing, and its
  formation slot (columns store ids) is kept for free;
- **no `spawned` / `died` / `despawned` event**: the unit was never absent from the board,
  so every "since it entered play" fact stays true and `budgets` (R9's once-per-turn
  ledger) cannot be laundered by flipping the card over;
- **counters and marked damage survive** — they are facts about the unit, not the face.
  (R93 makes the same point for {Inverted}: counters ride along by construction.)

**It becomes a TOKEN.** Beyond's type line says "Book **Token** Unit", and the type line
is already this engine's own definition of a token (`DECK_LIST`'s filter,
`ui/inspect.tokenOnlyName`). The transform therefore sets `Entity.token`, which makes
every leaves-play path correct with no new code: dying pushes to the bin and R69's
state-based sweep erases it with a public record, and the recall-to-hand and cache paths
erase it the same way. Without the flag the literal name "Beyond, Codex Incarnate" would
sit in a bin *as though it were a card*, and every exhume, recall and bin-play effect in
the pool could fetch a 0-cost 8/3 — which is both broken and the thing the owner said
cannot happen.

> ⚠ **OPEN — should it flip BACK on the way out?** The rejected alternative is that a
> transformed unit leaving play returns to its front face, so the physical card reaches
> the bin as Scholar of the Void. That is the Magic rule for double-faced cards and it
> loses the player less. It is rejected here because **nothing on either face prints it**,
> there is no Algomancy source for it anywhere in the corpus, and it needs a second
> identity switch wired into the death path. If the owner wants it, the change is one
> branch in `E.destroy`'s bin push, and the ledger entry says so.

**The [Augment] half is REFUSED, explicitly.** Scholar's whole text is `[Augment]`, so it
transfers to a host, and "me" then rebinds to the host exactly as Skittering Blight's
"counters on me" does. Transforming an arbitrary host is incoherent for the owner's own
reason: Beyond is on the back of *this* card, and a Good Whale has its own reverse side.
So the transform is offered only when the ANCHOR prints this back face, which the
registry's declarative transform table answers. The happy consequence is that a Scholar
augmented onto **another Scholar** works — that host does have a Beyond on its back — and
it falls out of the same check instead of needing a special case.

**"You may discard your hand" is a real cost, and an EMPTY hand still pays it.** The
option is a `payOrDecline` (declining is always offered) and the hand is discarded only
after the answer comes back — plan-then-commit, because the engine replays a part from its
boundary on suspension. Discarding zero cards is legal: the cost is "discard your hand",
not "discard a card". That makes an empty-handed Scholar the card's best case, which is a
line, not a bug.

### The clause that is PARKED, and the exact seam
*"If you would take damage from rot, put that many -1/-1 counters on **target** unit
instead."* R38's `replaceRotDamage` is the right hook and Skittering Blight is the working
precedent — but its version says *"me"* and this one says **target unit**. The hook is
`(g, self, seat, amount) => boolean`: no target slot, no `EffectCtx`, no `ctx.choose`. It
is called from `E.rotDamage()` straight out of `startDeployment()`, before the
`startOfDeployment` event exists and with nothing on the stack, and `E.partChoose` — the
seam `E.glimpse` uses to raise a decision from engine code — is private and null outside a
resolving part. **Asking would need a new `Suspension` variant (types.ts) raised from
`rotDamage()` (engine.ts) and resumed in apply.ts.** That is an engine change, so the hook
is declared and DECLINES, loudly, in the log at the moment it bites.

Three fakes were weighed and rejected: hardcoding "me" (a different card, and a suicidal
one — an 8/3 eating its own rot); auto-picking when exactly one candidate exists (Beyond is
itself a unit in play whenever the hook fires, so the degenerate case *is* "me"); and
picking a deterministic enemy (it takes a real decision away, and "target" is the game's
word for *you choose*).

**On R67 vs R71.** R67 says targets are chosen AT CAST; R71 carved out an exception for
text that picks *without* the printed word "target" (the Wraith's "an ally", chosen at
resolution). This clause fits neither: the word "target" IS printed, and there is no cast
to choose at. The conclusion is that **R67 was written for things that are cast, and a
replacement effect is not one** — when the seam is built, this target should be chosen
when the replacement APPLIES, by Beyond's controller. Until then Beyond carries the pool's
first `68-target-conformance` exemption of this kind, which comes off the moment the seam
lands.

### The inspector row the report was actually about
Re-read the report: the complaint is that you cannot see what you would become *before*
the hand is discarded. `ui/inspect.transformFaces` feeds a "Transforms into" row from the
same declarative table, the way `tokensCreatedBy` leads with `EffectDef.creates` — there is
deliberately no text-scan fallback, because unlike a token name a transform target is not
something a scan can ever confirm. Passing `live` reads the entity's own card name, so a
Scholar that has already transformed shows no row, and a host wearing the mod shows none
either — the view and the engine refuse the same case for the same reason. The back face
is also excluded from `TOKEN_NAMES`, or the details page would claim Scholar *creates* a
Beyond; it becomes one.

Guarded by `43-dark-c.test.ts::R101 — discard your hand and transform into Beyond`,
`43-dark-c.test.ts::R101 — declining keeps the hand and the 0/2 body`,
`43-dark-c.test.ts::R101 — an EMPTY hand still pays the cost`,
`43-dark-c.test.ts::R101 — the transform is the SAME unit`,
`43-dark-c.test.ts::R101 — a transformed Scholar is a TOKEN`,
`43-dark-c.test.ts::R101 — donated to a HOST the transform is refused`,
`43-dark-c.test.ts::R101 — a Scholar augmented onto ANOTHER Scholar does work`,
`43-dark-c.test.ts::R101 — registered, but it can never be drafted, decked or drawn`,
`43-dark-c.test.ts::R93 — "Your units are inverted" reaches YOUR units and not the enemy`,
`43-dark-c.test.ts::the parked rot clause admits itself in the log rather than going quiet`,
`50-ui-inspect.test.ts::the inspector says what Scholar of the Void transforms into`,
`50-ui-inspect.test.ts::a card that has already transformed shows no row`, and
`50-ui-inspect.test.ts::the back face is NOT listed as a token Scholar of the Void creates`.

## R102 — a REPLACEMENT may put a triggered effect on the stack (rot, "target unit")

**Beyond, Codex Incarnate**: *"If you would take damage from rot, put that many
-1/-1 counters on target unit instead."* R101 parked this clause and wrote a
park note concluding that a brand-new `Suspension` variant was needed.
Everything the note said about the seam was true — `CardBehavior.replaceRotDamage`
is `(g, self, seat, amount) => boolean`, with no target slot, no `EffectCtx` and
no `ctx.choose`; `E.rotDamage()` is called straight out of `startDeployment()`,
before the `startOfDeployment` event exists and with nothing on the stack; and
`E.partChoose` (the seam `E.glimpse` uses to raise a decision from engine code)
is private and null outside a resolving part. The **conclusion** was wrong.

**THE OWNER'S RULING, 2026-08-22, verbatim:**

> "In Deployment, you're in your own region, alone. So you can only target your
> own units. It would trigger, ask you what you want to target, then put the
> -1/-1 counters on during deployment (which still has and uses a stack). But
> since Beyond gives all your units inverted, no one would die of course."

*"It would TRIGGER"* is the whole design, and it is materially lighter than a
new Suspension variant: **the replacement does not have to finish inside the
hook.** It puts a TRIGGERED EFFECT on the stack, and R67's existing machinery —
`fireEvent` → `queueTrigger` → `processTriggerQueue` → `collectTargets` →
`commitItem` — does the asking. Deployment already runs that path
(`processTriggerQueue`'s `then = 'resolve'` outside battle).

**The one new seam is an EVENT, not a decision.** `EventType` gains
`'rotReplaced'`, fired by `E.replaceRotDamage` the instant a hook returns true,
inside `rotDamage()`'s own `settle()` window. Its `data` carries `seat` (who
would have taken the damage), `n` (how much was replaced), `card`, and `unit` —
the **anchor** entity, so a `self: true` listener on the replacing card matches
and nobody else's does ([Augment]-donated text reads from its host, exactly as
`anchored()` means it). It *replaces* the old `ev('info', …)` line rather than
adding one: same words, same log line, only the type changed. Skittering Blight
needs none of this — *"instead put that many +1/+1 counters on me"* is
arithmetic the hook can finish on the spot — but any replacement that has to
ask a question can now declare an ordinary triggered ability against
`'rotReplaced'` and be asked properly.

**What the ruling settles, and how each half is encoded:**

* **The target is the controller's OWN units.** Written as an R64 `restrict` on
  a `what: 'unit'` spec, **not** as `what: 'allyUnit'`. Both express the ruling;
  the restrict is the one that can be *printed*. The card says "target unit",
  and `68-target-conformance`'s "every target kind a card declares is named by
  its printed text" reads the phrase the way a player does — `'allyUnit'` is the
  kind for text that prints "target **ally**", and this text does not. So the
  KIND stays the kind the card names and the ruling lands where R64 puts
  restrictions: in the predicate that decides which candidates are legal. It is
  a real rule and not an accident of the board — the region-scoped candidate
  list (R12) *would* happen to hold only your units during deployment, and
  relying on that would be relying on a coincidence.
* **The chooser is Beyond's controller**, for free: `queueTrigger` takes the
  pending trigger's `controller` from the host entity. In deployment that is
  also the player who would have taken the rot, because `E.replaceRotDamage`
  only asks hooks whose anchor satisfies `a.controller === seat`.
* **THE HOOK RETURNS TRUE FIRST**, before anything is queued, let alone
  resolved. The damage IS replaced — that is what "instead" means — so a queued
  effect that later fizzles for want of a target does **not** resurrect it:
  nobody takes the damage either way. Same direction as R98 ("a REPLACED hit
  still counts as dealt") and R86 (an item that loses its targets fizzles), and
  the only ordering the hook's boolean signature can express.
* **No legal target** takes `collectTargets`' existing branch — it logs
  "there is no legal target for that — it does nothing" and the part is skipped
  (R86). R67's "a mandatory target with no candidate makes the CAST illegal"
  does not apply, because this is not a cast. In practice it is unreachable:
  the hook radiates from a UNIT IN PLAY that the damaged seat controls, so
  Beyond itself is always a legal candidate for its own replacement.
* **Both sides.** Rot is per-seat and `E.rotDamage()` walks initiative then NIT,
  so two Beyonds (one each) each fire their own `'rotReplaced'` off their own
  anchor and queue their own trigger under their own controller. Ordering is
  `processTriggerQueue`'s existing determinism; within one seat
  `E.replaceRotDamage` already sorts holders by entity id (the R62 precedent).

**THE DEFERRAL, and why it is not optional.** R50 sequences the start of
deployment as *(1)* rot damage, *(2)* the `startOfDeployment` event, and rot
first is itself a ruling. Once rot can raise a DECISION, the suspension throws
clean out of `startDeployment()` and `doDecide` resumes into
`collectTargets`/`commitItem`/`settle` — which has never heard of step 2. The
event would simply never fire, and every *"At the start of deployment, …"* card
on the board (Scholar of the Void, Xzydris, Prediction Prophet, Invasive
Species) would silently miss its turn. So `GameState.deployStarting` (additive,
optional) flags the window open and `E.finishDeployStart()` — called from
`settle()` — closes it at the first safe point. Exactly the shape of
`hasteEnding`/`finishHasteEnd` (R50) and `turnEnding`/`finishTurnEnd`. R50's
ordering is preserved: the replacement resolves inside `rotDamage()`'s settle,
still strictly before the event.

**The consequence the owner named is real, and is tested.** Beyond grants
{Inverted} to your units and R93 layer 5 negates the accumulated delta from
base, so -1/-1 counters read as +1/+1: a 7/5 ally taking your three rot becomes
a **10/8**. Your own rot grows your board, and "no one would die of course".

The three shortcuts R101 rejected (hardcode "me", auto-pick the forced
candidate, pick a deterministic enemy) stay rejected — the printed word is
"target", which is the game's word for "you choose", and now it really is.

Guarded by
`43-dark-c.test.ts::R102 — the rot replacement asks its controller for a target, and the damage never lands`,
`43-dark-c.test.ts::R102 — the counters make your own units BIGGER, because Beyond inverts them`,
`43-dark-c.test.ts::R102 — the target list is your own units, even with an enemy standing in the region`,
`43-dark-c.test.ts::R102 — two Beyonds each queue their own, each asked of its own controller`, and
`43-dark-c.test.ts::R102 — the start-of-deployment event still fires after the rot replacement stopped to ask`.

### R102 addendum — checked against report #75, and it holds

Report #75 (WEHH, 2026-08-22) states the rule for what may use the stack:

> "The only cards that should ever produce effects that go onto the stack are
> cards that say 'When' or 'Whenever' or have a ':' activated ability. All cards
> that say 'instead' or 'as' or 'if' shouldn't go onto the stack."

Beyond's rot clause prints **"instead"**, so on the face of it R102 contradicts
that and the conflict was raised rather than papered over. Bena settled it on
2026-08-23, and the refinement is the part to remember:

> "Not an exception since it says 'target'. I guess I meant 'cards that say
> instead, as or if and don't mention targets'. Plus, rot damage is a trigger to
> deal you that damage anyway."

So the rule has two halves, and the second is what makes it usable:

1. **"instead" / "as" / "if" with NO target named → never touches the stack.**
   This is the acceptance criterion the replacement layer (ledger #60) has to be
   built against. Automaton of Abundance, Cosmic Conspirator, Nullbringer,
   Counter Thief, Flux Resonator, Proliferating Slime and Conduit of Pain are
   all in this class, and all of them reaching the stack today is the bug.
2. **A replacement that names a TARGET still uses the stack.** A target has to
   be *chosen*, and a choice is public and respondable — there is nowhere else
   for it to happen. R102 is therefore the correct shape for Beyond, not a
   carve-out from the rule.

And the corroborating reason: rot damage is itself a trigger to deal you that
damage, so a replacement of it riding the stack is consistent with the thing it
replaces rather than an anomaly.

The practical consequence for whoever builds the replacement layer: **the
printed word decides the mechanism, and "target" is the switch.** Do not build
one path and special-case the other — sort every card in ledger #60 by that
test first.

## R103 — {Piercing} pierces on NON-COMBAT damage too, into the unit's controller

*(Owner ruling, 2026-08-23, closing CARD-TODO #4 and the R79 "not in scope" note above.)*

The owner's own example of what the test sweep should catch was *"piercing is
done even when its on a non-combat effect"*. It was not: `dealEffectDamageAll`
— the batch EVERY non-combat damage source goes through — read {Deadly},
{Powerful}, {Poisonous}, {Resonant}, {Blessed}, {Reaping} and {Electric}, and
never mentioned {Piercing}. Measured before the fix: Ruinbringer (8/9
{Piercing}) dealing 5 effect damage to a 7/2 left both life totals at 30,
byte-identical to a vanilla 3/3.

**THE RULING, verbatim:**

> "It redirects excess damage to that unit's controller (not as a trigger, just
> as part of resolution of the damage)."

That is the rulebook's combat wording generalised off the column — Rulebook
2023-07: *"Excess damage beyond the health of the back row unit does not carry
over to the player, unless the damage comes from a unit with the Piercing
attribute"* — and R7 already settled that piercing is **automatic, not
elective**, so there is no assignment choice to raise.

**"Not as a trigger, just as part of resolution"** is the load-bearing half and
it decides the implementation: the excess is added to the SAME R80 batch as an
ordinary player recipient. One resolution, one `total`, one commit loop,
nothing on the stack in between, and no window for anybody to respond between
the unit's share and the player's.

**Order of operations**, which is where this is easy to get wrong:

1. {Powerful} doubles the source's damage first (already in the per-hit loop).
2. The victim is priced in what it RECEIVES, so {Vulnerable}'s receive-side
   doubling halves the pool needed to kill it — `mult` is the exchange rate
   between "damage the source deals" and "damage the victim takes".
3. Damage earlier hits in the same batch already assigned to that victim counts
   (R80 coalesces a recipient named twice).
4. {Deadly} caps the need at ONE point, so a Deadly + Piercing source spends 1
   and pierces the whole rest. Source: RAQ *"[Solved] Excessive Combat Damage &
   interaction with Piercing, Deadly and Phytochemical Protection"* — *"Atleast
   1 dmg to Awoken (gets +1/+1, won't create 1/1 unit), rest of the damage can
   go to Bubb."*
5. Prevention (R98) runs afterwards, at commit. The same RAQ is explicit that a
   damage shield changes nothing about assignment: *"Atleast 5 damage to Awoken
   (gets atleast +5/+5, won't create 5/5), atleast 6 damage to Bubb, rest can go
   to Opponent HP."* So the excess is planned against the unit's real toughness
   **as if it were unprotected**.

**{Poisonous} pierces on the same arithmetic.** `checkDeaths` kills on
`t <= 0 || damage >= t`, so `t - damage` counters are exactly as lethal as
`t - damage` marked damage — and combat's `assign` already prices a Poisonous
column's lethal share off toughness, so ruling otherwise would put the two paths
in disagreement.

**{Electric} and {Piercing} compose** rather than one eating the other. Electric
says where excess goes NEXT; Piercing says where it goes when there is no next.
An Electric chain that dead-ends used to lose the remainder (R4); with Piercing
it now lands on the last victim's controller.

**The one lethal arithmetic.** All of the above lives in a single `poolToKill`
closure inside `dealEffectDamageAll`, shaped on `combatSubStep`'s `assign` and
read by both {Electric} and {Piercing}. That is deliberate: the previous inline
copy in the Electric branch knew nothing about {Vulnerable} or {Deadly}, and two
copies of overkill arithmetic are two copies that drift.

✅ **Closed: Oorblak** (2026-08-23). *"[Augment] If combat damage would be dealt
to you, that damage is dealt to me instead."* Its parked half was the COMBAT
hook (`replaceCombatDamageToPlayer`), not this one — non-combat damage never
reaches it. Both engine seams shipped in R98 and the card was rewritten against
them, borrowing this section's arithmetic verbatim: {Powerful} has already
doubled the hit at the source, {Vulnerable} prices what Oorblak RECEIVES, and
the {Piercing} leftover is handed back as the hook's numeric return. **One
deliberate divergence:** step 4 ({Deadly} caps the lethal share at one point)
is NOT read on the redirect path, because the kill it implies is delivered by
combat's `L.deadlyHit` sweep — which has already run by the time
`commitPlayerDamage` calls the hook — so honouring the floor there would leave
Oorblak alive on 1 damage *and* send the rest to the face. Killing from inside
the hook is an engine ordering decision, not the card's; until it is ruled on,
a Deadly+Piercing column redirected into Oorblak absorbs its full toughness and
pierces only the true remainder. Tests: `17-earth-b.test.ts`.

## R104 — the REPLACEMENT-EFFECT LAYER: two families, and why they compose differently

*(Owner ruling, restated three times; closing playtest ledger #60, #64 and #75,
and CARD-TODO #10, #11 and #12.)*

**THE RULE, verbatim (WEHH, 2026-08-22):**

> "Replacement effects and triggered effects and static effects are being
> handled wrong by the system, still. The only cards that should ever produce
> effects that go onto the stack are cards that say 'When' or 'Whenever' or have
> a ':' activated ability. All cards that say 'instead' or 'as' or 'if'
> shouldn't go onto the stack."

**And the refinement, 2026-08-23, which is the load-bearing half:**

> "Not an exception since it says 'target'. I guess I meant 'cards that say
> instead, as or if and don't mention targets'. Plus, rot damage is a trigger to
> deal you that damage anyway."

So **the printed word decides the mechanism, and "target" is the switch.** A
target has to be *chosen*, and choosing is a public, respondable act — there is
nowhere but the stack for it to happen. R102 (Beyond, Codex Incarnate) prints
"target unit" and is therefore the correct shape for the one card that goes the
other way, not a carve-out.

**Why this needed a layer and not seven fixes.** He reported it three times.
First as one card — #46, VEAV: *"The 'I get -2/-2' isn't a trigger that should go
on the stack. It's a static effect"* — which was closed by editing Bulborb. Then
as a class, twice (#60, #75). A one-card fix is what makes a class of bug recur,
so the primary deliverable here is `test/88-replacement-conformance.test.ts`,
not the cards. That is R48's lesson (report #48: *"This is a recurring issue, do
a full text search"* → the answer was a permanent test).

### The two families

The cards split cleanly, and they **compose differently**, which is the whole
reason there are two.

**1. `AmountMod` — continuous, SUMMED.** Changes a NUMBER on its way through and
nothing else. Modelled on `CostMod` line for line: the same `E.anchored()` walk
(units in play plus augment mods reading from their HOST), the same R12 region
scope, the same shallow R62 suppression guard, the same reentrancy latch, and
the same division of labour — ownership lives in the card's own predicate, not
in the gatherer. Read through `E.amountDelta(ctx)`.

The fold is a ruling, not a convenience. Caleb, on how these compose:

> "a replacement only happens once … The replacement just takes what would be 1
> and makes it 2"

So two **different** modifiers both apply (two Conduits of Pain make a 1 into a
3), and none applies to its own contribution. That last part needs no guard at
all, and its absence is the point: an `AmountMod` is **consulted**, once, as a
pure query, where the trigger implementations it replaces **re-entered**
`addCounters` and each needed a module-level `let` to stop themselves looping.
Report #60 counted five such flags — *"Five module-level mutable flags exist
purely to paper over this"* — and they are gone.

**2. The named `replaceX` hooks — FIRST-TRUE-CONSUMES.** Substitutes or
redirects the thing itself. A thing can only be replaced once, so the first
claimant takes it and ties break by entity id, exactly as `replaceRotDamage`
has always done. Modelled on the two hooks that already existed
(`replaceRotDamage`, `replaceCombatDamageToPlayer`).

**Deliberately NOT a general "any event" framework**, and that is
`replaceRotDamage`'s own argument, kept: *"Deliberately a one-off hook, not a
replacement framework."* One named hook per replaceable quantity means every
replaceable thing in the engine is greppable and nothing becomes replaceable by
accident. `88-replacement-conformance` asserts every declared hook is read
somewhere in `engine.ts`, so a hook can never look implemented and do nothing —
which is the exact shape of the Harbinger of Immolation incident.

### The hooks and the choke points

| Hook | Signature | Consulted in |
|---|---|---|
| `amountMods` | `delta: (g, self, ctx: AmountCtx) => number` | `E.addCounters`, `E.dealEffectDamageAll`, `E.gainRot`, `E.gainDebt` |
| `replaceLifeGain` | `(g, self, seat, amount, why) => boolean` | `E.gainLife` |
| `replaceCounters` | `(g, self, target, n) => Entity \| null` | `E.addCounters` |
| `replaceTokenCreation` | `(g, self, req: TokenRequest) => TokenRequest \| null` | `E.spawnUnit({token:true})`, `E.createSpellToken` |
| `replaceTokenBatch` | `(g, self, batch) => TokenRequest[] \| null` | `E.settleTokenBatch`, from `resolveParts` |

Plus one thing that is neither: **the life LOCK**. `E.lifeLocked(seat)` /
`E.lockLife(seat, region)` is a region-keyed `battleCounter`, not a radiator,
and the shape is forced rather than chosen — Suspend is a SPELL, so nothing of
it stays in play for `anchored()` to radiate from. That is R96's situation and
R96's answer, reused. It is asked **above** the replacement hooks in both
`gainLife` and `loseLife`: once the change cannot happen at all, there is
nothing left to replace.

**`AmountCtx.region` may be undefined**, and that is `E.fireEvent`'s own rule
rather than a loophole: `fireEvent` scopes listeners to `ev.data.region` and
dispatches an event carrying none to *all* of them. `gainRot` and `gainLife`
write a region only inside a battle, so a modifier that used to be a
`rotGained` trigger must be asked in the same places or the card quietly
narrows on being "fixed".

### Order of operations, where two layers meet

**In `dealEffectDamageAll`** (rewritten hours earlier for R103's {Piercing}
excess), the amount hook goes **after** {Powerful}'s doubling and **before**
{Vulnerable} prices the victim:

1. {Powerful} doubles what the source deals (R103 step 1 — the source scaling
   its own printed damage).
2. **`AmountMod`** — Conduit of Pain's "+1". An outside continuous modifier on
   the result.
3. `poolToKill` prices the victim in post-{Vulnerable} terms; {Piercing} and
   {Electric} spend the excess.

Put the modifier before the doubling and the printed "plus 1" silently becomes
plus 2 in front of any Powerful source, which is not what the card says. Being
at step 2 rather than at commit is also what makes it compose with {Piercing}:
the extra point pierces like any other. It is applied **per hit**, exactly where
{Powerful} is — a source that damages three units deals damage three times.

**In `addCounters`**, the amount runs before the redirect. "Put that many
counters plus one instead" describes what *would be placed*; "those counters are
placed on me instead" steals what *would be placed*. So a Counter Thief standing
beside a Flux Resonator steals the plus-one too.

### Token creation, the BATCH, and how a replacement asks a question

Report #64 (GETD): *"Biotoxicity didn't give me the choice of what kinds of
tokens I wanted even though I had Cosmic Conspirator."* Two defects:

* **The spell-token half was completely dead.** The old implementation was a
  `spawned` trigger and `E.createSpellToken` fires no dispatchable event at all,
  so Biotoxicity's three Poisons went past it in silence. A replacement is
  *consulted at the call*, so it needs no event — **the seam is the call**. That
  is the general lesson: the park note said this half waited on "a dispatchable
  event on spell-token creation", and it never did.
* **The Robot half asked too late.** It really created the Robot, fired a
  `spawned` for it, asked, and erased it — so a token the card says was never
  created was on the board and in the event stream.

**One resolving part is one creation batch**, which is the unit R80 already gave
effect damage (*"One resolution of one effect, one batch"*). `resolveParts`
opens one around `def.run` and settles it **inside the try**, so a decision
raised by a batch replacement suspends and replays through exactly the machinery
every other mid-resolution question uses. A part that suspends before finishing
leaves its batch unsettled on purpose: R85 rolls the world back to the part
boundary and replays it, and a batch settled at the suspension would pay out
twice. A creation with no part open is its own batch of one, so nothing is ever
left unsettled.

**Raising the decision** uses `E.askInResolution(tag, dec)`, which is
`E.partChoose` — the seam `E.glimpse` uses, and the one R102's write-up
discusses. It fits here where it did not fit R102 for a concrete reason: rot
damage is dealt from `startDeployment()` with no part resolving, whereas token
creation almost always happens *inside* one. Outside a resolving part it returns
null, the card takes the printed branch and **says so**, exactly as glimpse's
*"no decision window — the top card is cached by default"* does. A silent
default is what produces playtest reports.

**"UNIQUE" IS BY TOKEN KIND — the card NAME — and the X is not part of it.**
So Manufacture ("Create a Robot 3, a Robot 2 and a Robot 1") plus Automaton of
Abundance yields **one** extra Robot, and a Fireball 2 beside a Fireball 5 is
one unique token. The basis is the engine's own definition of identity, which
R101 argues at length for the transform: `Entity.card` is what bins, "name a
card" effects, counters-by-name, `DECK_LIST` and the inspector all key off, and
every Robot is the one registered card `Robot` whatever number it wears. The X
is a quantity *on* the token, not a different token — which is also why Cosmic
Conspirator's reminder text can say *"(With the same X value.)"* while swapping
the kind. The copy takes the **first of its kind** in the batch: "a copy of each
unique token you created" has to copy something, and first is the deterministic
answer that needs no ruling (a "largest X" reading would be a strictly better
card and nothing prints it). ⚠ This is the one place the uniqueness reading had
a choice; if the owner rules otherwise it is three lines in
`batch-metal-a.ts`.

### What this fixes, card by card

| Card | Was | Is |
|---|---|---|
| `Nullbringer` | trigger: gain N, then lose 2N — the total **spiked** and `lifeGained` fired for a gain that never happened | `replaceLifeGain`; lose N, and **no `lifeGained` event** |
| `Counter Thief` | `events: []` — completely dead | `replaceCounters` redirect, gated on "during battle" |
| `Conduit of Pain` | `events: []` — completely dead | `amountMods`, +1 to an allied source's noncombat damage |
| `Flux Resonator` | trigger that mutated `u.counters` directly to dodge re-entrancy, so one placement produced a `countersChanged` for the WRONG number and a silent extra after it | `amountMods`; one placement, one event, the right number |
| `Proliferating Slime` | trigger + module-level `let proliferating` | `amountMods` over counters, rot and debt |
| `Automaton of Abundance` | trigger per `spawned` + `let aoaCopying`; N identical tokens gave N copies | `replaceTokenBatch`; one copy per unique kind |
| `Cosmic Conspirator` | created the Robot, fired `spawned`, erased it; the spell-token half dead | `replaceTokenCreation`, asked before anything exists, once per token |
| `Suspend` | a logged no-op | a real region-keyed life lock, both directions |

**The module-level flags.** `proliferating` (batch-hybrids-ld-b) and
`aoaCopying` (batch-metal-a) are **deleted** — they existed only because a
trigger re-entered the primitive, and a consulted modifier does not. `probing`
(batch-water-b) and `aoScanning` (batch-metal-a) are **kept**, and they are a
different thing: both guard a nested QUERY from re-entering itself (Spell
Excavation's bin scan finding itself; two adjacent Ancient Ones mimicking each
other), which is `E.inStatics`' pattern and has nothing to do with replacement.
One new latch was needed and it lives in the ENGINE, in `E.inCostMods`' shape:
`E.inReplaceCounters`, because a counter REDIRECT really does re-enter — the
thief puts the counters on itself, and that is a counter placement — and two
thieves would bounce one placement between them forever.

### What is still NOT replaceable, stated plainly

* **`E.loseLife` has no card hook.** Only the lock stops it. Nothing in the pool
  prints "if you would lose life, … instead", so the hook would be a hook with
  no card, and the layer's narrowness is deliberate.
* **Combat damage to a UNIT.** `preventUnitDamage` (R98) only ever *reduces*;
  there is no substitute-or-redirect hook for it. Oorblak's parked Piercing-
  excess half is on `replaceCombatDamageToPlayer`, a different seam, and is
  untouched here.
* **Card draw, discard, zone changes, targeting, death.** None has a hook. R79's
  {Unstable} bin→erase is a *stamp* and not a replacement seam a card may ask
  for about itself, which is why Suspend's "Erase me" is still parked (with
  Temporal Rift, the other card printing it).
* **MULTIPLICATIVE amounts.** `Arbiter of Vitality` — *"Double all life gain and
  life loss"* — prints neither "would" nor "instead", so it is outside the class
  #75 defines and stays a trigger. Giving it a hook would need a multiplicative
  amount family, and how that composes with the additive one is a ruling nobody
  has made.
* **Prevention is still not replacement.** R98 settled it and nothing here
  changes it: *"if there is not damage being dealt, then no counters are
  placed."* Phytochemical Protection prints "would" and no "instead", and the
  conformance sweep's third narrowing round is exactly that distinction.
* **A replacement declares nothing to the inspector.** R69's `EffectDef.creates`
  is a property of an EFFECT, and a replacement is not one — it has no
  `EffectDef` and never resolves off a stack. `test/65-effect-conformance`
  therefore exempts tokens created while `E.inReplacement` is true. That is a
  real gap in the "tokens it creates" panel for Cosmic Conspirator and Automaton
  of Abundance, and it is named here rather than papered over.

Guarded by
`88-replacement-conformance.test.ts` (the whole file — the sweep is the deliverable),
`87-replacement-layer.test.ts` (the layer: composition, negation, the events that no longer fire, the batch, the lock),
`12-fire-a.test.ts::Conduit of Pain`,
`26-metal-a.test.ts::Automaton of Abundance` and `::Cosmic Conspirator`,
`27-metal-b.test.ts::Flux Resonator`,
`40-light-c.test.ts::Nullbringer` and `::Suspend`,
`45-hybrids-ld-b.test.ts::Proliferating Slime`, and
`46-hybrids-ld-c.test.ts::Counter Thief`.

## R105 — {Modular} takes ANY mod you can pay for, and a modded card is Unstable

*(Owner rulings, 2026-08-23, closing CARD-TODO #19. Sourced: Manual pp.33-35;
Caleb 2025-02-07, 2025-04-24; R69, R79, R103.)*

`{Modular}` is printed on exactly one card, **Spellbind** — *"(You can apply
mods to a modular card from your hand and/or bin as it is played. You still pay
their costs.) [Switch1] You gain one rot."* The window was built correctly in
R35's cast-time collection and had been since Light & Dark landed. **What it
offered was the bug**, and it was one line: `if (!isGraftable(name) …) return;`
— 137 of 494 cards, grafts only.

**THE RULE, verbatim:**

> "I think it's legal to apply ANYTHING to a Modular card. But many cards wont
> do anything at all since it requires being in play (which a spell never is).
> Same with viruses, they should also be allowed to be applied to the modular
> card, even if they might not do anything"

So **the cost is the whole filter**: every card in your hand and bin whose cost
you can pay is on the menu. No graft gate, no augment-capability gate, viruses
included. Nothing in the pool is *structurally* excluded — every card in a hand
or a bin is a `unit`, a `spell` or a `spellUnit`, and the only card faces that
could not be applied (the element Resource faces) are not deck cards at all;
`registry.DECK_LIST` filters them out before a game ever sees them.

**A mod that does nothing is a legal play.** That is the half of the ruling that
is easy to legislate away, and it is deliberate: the engine's job is to charge
you for the card and let you make the mistake, not to protect you from it.

### What a mod on a spell can and cannot do

| what the mod prints | what it does on a spell | why |
| --- | --- | --- |
| a `[Switch]` graft effect | joins the item as an **extra part** | Manual p.33 — a graft's effect transfers, and the composite resolves as one ability. Unchanged from before. |
| a **type-line** `[Augment]` attribute | is **donated to the resolving effect** | R79's channel, by a different timing. |
| **text-box** `[Augment]` text, statics | **nothing** | *"spells cannot gain static abilities like that, so the only useful thing you can do is give them attributes"* (Caleb 2025-04-24). A spell has no body for a triggered ability or a static to live on. |
| nothing applicable at all | **nothing** | legal, wasteful, and the owner's *"even if they might not do anything"*. |

The third row is a **deliberate no-op**, not an unimplemented one, and the
difference is invisible from outside — which is exactly how a dead card survives
a green suite (see the head of `card-ledger.ts`). It is therefore asserted:
Sparkwraith's whole card is *"[Augment] Whenever you play a spell, put a +1/+1
counter on me"*, so the test applies it to a Spellbind, **plays a spell while it
rides the stack**, and pins that no counter appears anywhere.

### The attribute seam — the half that makes the ruling mean anything

Widening the offer alone would have changed **nothing observable**, and that is
the failure shape this repo keeps getting bitten by. The measurement, taken
2026-08-23: graftable cards and type-line-`[Augment]` cards are **DISJOINT** —
137 and 22, overlap **zero**. So under the old filter, attribute donation
through `{Modular}` was not rare; it was *impossible*.

`E.stackModAttrs(item)` unions the mods' `augmentAttrs` and is read in the two
places R79's `stackAugmentAttrs` already was:

- `EffectCtx.grantedAttrs`, which `dealEffectDamage` unions into the source's
  printed attributes before it reads {Powerful} / {Deadly} / {Piercing} (R103) /
  {Resonant} / {Poisonous} / {Blessed} / {Reaping};
- `E.itemAttrs`, so the resolution-time checks ({Afflicting}) see them too.

A **separate method** rather than a widened `stackAugmentAttrs`, so R79's virus
channel keeps meaning what its name says and neither can be mistaken for the
other in a stack trace.

Of those 22 attribute cards, fourteen are viruses and could already reach a
spell through R79's own window. **Eight could reach one by no route at all** —
Resonant Form, Noxious Sporefiend, Carapace Devourer, Tempest Wrangler, Bubb,
Ephemeral Skywalker, Curio Drifter, Whispering Mantid. `{Modular}` is the only
timing that ever puts them on a spell, and the reminder text always said it did.

### ⚠ The carrier is {Unstable} — and that is what the card is FOR

The question this ruling had to answer: a resolving spell is neither dying nor
being erased — R40 sends it to the bin **from the stack** — so does Manual p.35
reach it?

> "As long as a card is modded, it has the unstable attribute, meaning when it
> dies or is erased, it and all of its mods are erased with it. **This means
> that even though mods can be applied from the bin, they are generally only
> able to be applied once.**" (Manual p.35)

That last sentence has exactly one referent in the whole game: `{Modular}` is
the only window that applies a mod **from a bin**. R69 had already settled the
mechanism — **Unstable is a BIN replacement, not a death replacement** (Caleb
2025-03-13, 2025-04-08: *"unstable units still die, they just get erased instead
of ending up in the bin"*) — so "it never reaches a bin" needs no death to
trigger it, and a resolving spell is precisely a card on its way to a bin.

The owner ruled, and gave the design reason, which is the part worth keeping:

> "A modded Spellbind should also have unstable. It basically works as a
> 'flashback' for graft cards. You pay 1 to put it on the stack, then add in
> some effects from your yard that you also want to happen. Since otherwise,
> gaining 1 rot is pretty bad"

So Spellbind is a **flashback**: [1] and a rot buys you a graft effect out of
your own bin. The erase is not a harsh edge case — it is the **price** of the
flashback, and without it the graft is infinitely reusable and the drawback
evaporates. The Manual's sentence is not incidental colour; it is this card.

**Mechanically**, `payModularMod` stamps `item.unstable = true` the moment a mod
attaches. A stamp taken at CAST rather than a fact derived at disposal, for R96's
reason: `dischargeItem` then reads **one** flag on every exit — resolution, R5
fizzle and negation alike — instead of re-deriving the same fact three times.
`E.disposeItemMods` sends the mods to their controller's public erased pile (R65)
in one event, beside the carrier's own; `E.negate` reads the same pair, so a
negated modded carrier is erased too and the log says so.

This also **closes an asymmetry that had opened without anyone deciding it**: a
virus applied to a spell through R79's window erased the whole pile, while a mod
applied to the same spell through the `{Modular}` window binned it and left it
reusable. Once anything at all can be applied, those are the same act, and one
act cannot have two disposals. `91-modular.test.ts` runs both routes with the
same card on the same carrier and asserts the two results are **deep-equal**, so
they can never silently diverge again.

**Unmodded, nothing changes.** A `{Modular}` spell nobody applied anything to is
not modded, so it is not Unstable, and it is binned like any other spell (R40).

### The spell-UNIT edge, stated rather than discovered later

No `{Modular}` card in the pool is a spell unit. If one is ever printed, the
stamp rides onto the spawned body (`afterParts` already copies `item.unstable`
to `Entity.unstable`, R96's path) and the mods are erased rather than binned —
which is the same answer, and is what a modded card being Unstable means. It is
untested because it is unreachable; it is written down so that the first card
that reaches it finds a decision rather than a surprise.

Guarded by
`91-modular.test.ts` (the whole file — the offer, the two donation channels, the
deliberate no-op, the cost, the flashback line end to end, the R79 parity, and
negation),
`43-dark-c.test.ts::Spellbind: {Modular} carrier`, and
`37-attrs-wight.test.ts::{Modular}: mods are applied at cast time`.
The last two previously asserted the mod landed in a **bin**; both were corrected
to the erase, with the reasoning written into them.

## R106 — STAT LAYER 6, {Unaware}: everything in the interaction reads at PRINTED stats

R10 (above) settled what "interacting with" means in 2026-07-16 and then sat there for
thirteen months, because the layer it needed was never built. {Unaware} was the last
attribute in the pool with **zero** references anywhere in the engine (CARD-TODO #5):
three cards printed it — Bubb (5/6), Trashling (2/2, which donates it as a {Virus}) and
Haboob (a spell) — and all three were plain vanilla bodies in play. `effStats()` carried
the comment `// layer 6 (Unaware) goes here` and nothing else.

### The ruling (Bena, 2026-08-23), verbatim

> "Unaware means that it looks ONLY at what is the literal printed text on all cards
> 'involved' (self or others when dealing damage or in combat when dealing/receiving). So
> Bubb blocking a Robot token would kill it (do Bubb, it has 0 power and 0 defense), no
> matter how many +1/+1 counters it has. Bubb would also survive 100 -1/-1 counters just
> fine. Haboob kills anything that has 1 defense printed at the card level."

This agrees with Caleb, in rules-questions, on the same attribute: "Unaware is last 'stat
modifier applied' and any Unaware units (or Spells like Haboob) will only look at BASE
STAT PRINTED on cards." There is no divergence between the two to record.

The rule has two halves, and both shipped.

### Half 1 — SELF: printed, not base

Layer 6 returns **layer 1 alone**. An Unaware card's own numbers never move off the
numbers on its face, for any purpose, the state-based death check included — which is
what makes "survive 100 -1/-1 counters just fine" true with no special case anywhere.

| layer | what it is | under {Unaware} |
|---|---|---|
| 1 | printed / token stats | **the answer** |
| 2 | base REWRITES — `Entity.baseSet`, `StaticMod.baseP`/`baseT` | ignored |
| 3 | counters, `tempPower`/`tempToughness`, continuous `dp`/`dt` statics | ignored |
| 4 | the `{Tough}` / `{Balanced}` attribute layer (R19) | ignored |
| 5 | `{Inverted}` (R93) | ignored |

Note it drops **layer 2 as well**, which is where it parts company with {Inverted} one
layer up. R93 keeps base rewrites because they are what {Inverted} inverts *from*; this
rule is about what a card *reads*, and "your units are base 3/3" (Aberrant Statweaver) or
"becomes a base 4/4" (Formless, Unstable Refactor) is not literal printed text on Bubb's
card. So a Statweaver leaves Bubb a 5/6.

For a TOKEN, "printed" is what it was created as — which is the same thing its card face
says, and the reason the owner reached for a Robot: a `Robot` prints **0/0** and carries
its entire size in +1/+1 counters, so a Robot 20 reads 0/0 and the two readings are as
far apart as the pool allows.

### Half 2 — PAIRWISE: the other side IS collapsed

"it looks ONLY at what is the literal printed text on **all cards 'involved'**". If any
participant in an interaction is {Unaware}, **every** participant reads at printed, not
just the Unaware one. Bubb blocking a Robot 20 sees a 0/0: it kills it, and takes nothing
back, because 0 power is what the Robot deals.

**Scope is exactly the owner's parenthetical** — "self or others when dealing damage or in
combat when dealing/receiving" — and it is three call sites, no more:

- `assignCombatDamage`: power dealt and toughness assigned against, with **both columns of
  the exchange** as the participants. Threaded exactly like {Pure}'s `pure` flag one layer
  down, and for the same reason: it is a property of the pairing, not of a card.
- `dealEffectDamageAll`: the lethal arithmetic (`poolToKill`, which {Piercing} and
  {Electric} read) and the commit's death read, with **the source and the recipient** as
  the participants. The source side is read off `srcAttrs`, which falls back to the
  printed card when there is no source entity — that is the whole of how a SPELL like
  Haboob is Unaware at all.
- the `fight` helper in `batch-earth-a.ts`, which snapshots both powers. It hands the flag
  to its two `dealEffectDamage` calls through `grantedAttrs` (R79's seam), because an
  ability that makes two units fight is its own source and would otherwise collapse only
  one direction.

The collapse survives {Pure}: R61 switches the ATTRIBUTE layer off for an exchange, and
this is a STAT layer — an Unaware card's numbers are its printed numbers whether or not
anyone is reading its attributes.

### The death check, and why it needed its own sweep

`checkDeaths` is the state-based sweep and it reads `effStats`, so it cannot see that a
Robot 20 just fought as a 0/0, or that Haboob's 1 damage was lethal on a printed 1 defense
under four +1/+1 counters. Both of the owner's *kill* examples live in
`E.sweepCollapsedDeaths`, which runs at the end of an exchange over that exchange's
participants only — outside an interaction a Robot 20 is a 20/20 and stays one. It sits
beside `sweepDeadly` in the combat sub-step for the same reason: both are "this exchange
killed something the ordinary check misses".

### Column sharing (R19): {Unaware} is shared

The layer reads `E.statLayerAttrs`, the same helper {Tough}, {Balanced} and {Inverted}
use, which walks own printed attrs → augment/virus mods → **column-mates**. So {Unaware}
is column-shared, and a unit standing beside Bubb in a formation reads at *its own*
printed stats for as long as the formation holds.

That is the precedent, not an extrapolation. Caleb, quoted on that helper: units in a
column "just share attributes **in all situations**… if one unit in the column has tough,
the other will also have it"; and asked point-blank "So, all attributes are shared between
the units in the same column? Including stuff like Inverted or Tough?" — "Yes". The
consequence runs both ways and is pinned in a test: a {Tough} Rampart Guardian sharing a
column with Bubb loses its own doubling, because it is Unaware now.

### ⚠ THE ONE OPEN EDGE: targeting

R10's own wording lists **targeting** as an interaction —

> "Everything counts as interacting: fight, battle (blocking/being blocked/dealing or
> receiving combat damage), **targeting** — all of it."

— but the owner's operational statement scopes the rule to damage and combat:

> "(self or others when dealing damage or in combat when dealing/receiving)"

so targeting is **deliberately not implemented**. "Delete target unit with base power 2 or
less" asks `baseStatsOf`, and target legality is read at roughly 33 card-side sites; making
each of them Unaware-aware is a separate change with a separate ruling behind it. This is
recorded as a known, named gap rather than left as an omission: if a player reports that an
Unaware card was or was not a legal target for a stat-gated effect, this paragraph is the
answer to check first.

### Where it lives

- `E.printedStats(e)` — layer 1 alone.
- `E.unaware(e)` — column-shared, off `statLayerAttrs`.
- `E.interactionStats(u, involved)` / `E.collapsedBy(u, involved)` — the pairwise read.
- `E.sweepCollapsedDeaths(ids)` — the deaths the collapsed reading implies.
- one clause at the end of `E.effStats`: `if (statAttrs.includes('Unaware')) return
  this.printedStats(e);`

Reentrancy is avoided by construction: `statLayerAttrs` walks `ownAttrs`, which reads
printed data, `tempAttrs`, augment mods and statics' `attrs` — it never asks anyone for a
number — and the existing `E.inStatics` guard bounds the rest.

### Consequences worth knowing

- **Trashling is a debuff virus, not a blank.** Donating {Unaware} onto a host strips the
  host's counters, auras, temp buffs and {Tough} for as long as the mod is on it, and it
  keeps doing so for counters gained *after* the virus lands: layer 6 is continuous, not a
  stamp.
- **Haboob's {Unaware} is the card.** A spell has no stats of its own to collapse, so its
  {Unaware} exists entirely to collapse what it hits.
- **{Unaware} beats {Inverted}** on the same unit, by layer order.
- **The attribute does not kill its own bearer.** A −100/−100 on Bubb leaves it a live 5/6;
  the counters stay on the entity, they are simply never read.

### Tests

`92-unaware.test.ts` (seeds 9200-9299) is the layer's own file: the owner's three worked
examples as named tests quoting him, the self half (counter, temp delta, aura, base
rewrite, {Tough}, {Inverted}), the pairwise half through real combat damage in both
directions plus a `fight`, column sharing in both directions, the Trashling donation, and
**three negative controls** — a non-Unaware unit still gets its counters, its aura, its
temp delta and its {Tough}; an exchange with nobody Unaware in it is not collapsed; and a
Robot token nobody Unaware is fighting swings its full size. The controls matter more than
usual here because TWO different collapses are in play: an implementation that read every
unit at printed all the time would satisfy every other assertion in the file.
`05-rulings.test.ts` carries R10's own two tests, and its `{todo:true}` — which could never
fail, and under which this card stayed dead through two playtest reports and a conceded
game — is gone.


## R107 — OWNER is not CONTROLLER, and putting a card into play never transfers it

*(2026-08-23, closing CARD-TODO #17. Found by the fix round, not by a report.)*

`E.spawnUnit(seat, …)`'s `seat` is the **controller**. `opts.owner` is whose card it is,
and it defaults to `seat` — which is right for the overwhelming majority of spawns and
wrong for every effect that reaches into a zone it does not own.

Before this, `spawnUnit` had no owner parameter at all: it wrote `owner: seat,
controller: seat` together. So **Wake the Dead** — *"Play up to two units in ANY bin with
total cost [8] or less now, for free."* — did not borrow the opponent's card, it
naturalised it. The unit died into the CASTER's bin, counted toward the caster's "cards
in your bin" effects for the rest of the game, and the original owner could never recur
it. Nothing in the printed text says any of that.

**The rule.** R65 already governs and only needed to be honoured: *"each card reaches ITS
OWN owner's erased pile — a virus on an enemy spell is the enemy's card, and the two
piles are public."* Putting a card into play out of a zone you do not own does not
transfer the card. It dies to its owner's bin, it counts toward their bin, and they may
recur it.

**A control clause is R8 and is NOT this.** R8 moves the unit between sides; it does not
renationalise the card. The two are independent, and one card sets both in opposite
directions in a single sentence — **Uglk**: *"each player puts a unit from **their** bin
into play under an **opponent's** control."* Controller = the opponent, owner = the
player whose bin it came from. That card was handing the card over permanently.

**Reclaim the Fallen** is the third: *"under their **controller's** control"* — a virus
you stuck on an enemy comes back on their side and is still your card.

Every other spawn site in the pool reads the caster's own zone, and every `{ token: true }`
site is correct by construction: a creation is owned by its creator. The `spawned` event
carries `owner` **only when it differs from the controller**, so no existing reader's
payload moved.

## R108 — a bounded [once] is not spent by a DECLINE (narrowed by R113)

*(Owner ruling, 2026-08-23, closing CARD-TODO #18. **Read R113 with this one** — the
designer later drew the line more tightly than the sentence below does, and R113 wins
wherever the two disagree.)*

> A `[once]` is spent only when the ability actually does something. Say no to a "you may"
> and the budget is intact, so the same trigger can ask again later the same turn.

The bug: `composeParts` writes `budgetHolder.budgets[key] = 1` the moment a `bounded`
ability is composed — before its run has any chance to discover it can do nothing. 88 of
the pool's 138 bounded (`[once]` / `[Switch1]`) abilities have a run that can bail out.
**Hexbane Shiitake** was the clearest victim: it read `inEndOfTurn(g) ? false :
ctx.choose(…)`, so in that window the player was **never asked** and the `[once]` was
burnt anyway.

**Both halves answered at once.** Declining a "you may" and being unable to be asked at
all are the same outcome under this ruling: nothing happened, so nothing is spent.

**The seam is explicit, and it has to be.** `EffectCtx.refundBudget?.()` raises
`EffectPart.refunded`; `E.settleBudgetRefund` pays it out *after* the part finishes.
The obvious alternative — refund when the run emitted no event — **does not work and must
not be reintroduced**: the CARD-TODO #3 sweep gave every one of those bail-out branches an
announcement, which was the entire point of it, so they all look busy now. A refund keyed
on event count would refund nothing.

**Why the reservation stays at composition time.** It is also the re-entrancy guard. The
refund is a payout, not a deferral.

**Replay safety (R85).** The flag lives on the PART, which the suspension carries, so it
survives serialisation. A suspension throws past `settleBudgetRefund`, and the replay
starts with the flag clear and re-raises it only if it reaches the same branch again —
so refunding is idempotent, and a run that succeeds never raises it at all.

**One route the run cannot reach.** A graft rider's cast `[cost]` is marked spent at CAST
time, before any run exists, so `ctx.refundBudget()` is unreachable there. `E.refundPart`
is therefore also called from `payCastCost`'s decline branch and the two unpayable-cost
branches. Same ruling by a different route: declining a cost you were offered is
declining.

**A FIZZLE does NOT refund** — see **R113**. This was answered the other way on the same
day (CARD-TODO #20) and then reversed by the designer's `[bounded_graft]` ruling, which
says the use is gone "regardless of if that ability resolves or doesn't". The paragraph
that used to stand here described the fizzle as "the ability did nothing"; R113 is the
statement that being unable to finish is not the same as declining to start.

## R109 — an empty damage batch says so

*(2026-08-23, closing CARD-TODO #16.)*

`dealEffectDamageAll` handed an empty hit list used to return in silence. Every *"I deal N
damage to each opponent / each enemy unit"* card builds a list and hands it over, so with
no opponent in the region (R25) or no enemy unit on the board the card resolved, the mana
was spent, and the log was blank. The guard is at the TOP of the method and keyed on
`hits.length`, so one line covers every carrier and no card has to know — Meteor Shower,
Roving Quillback, Infernal Grovekeeper and Channel Through were all fixed without a card
edit.

**Two shapes that are NOT this and stay silent**, which is why the guard is where it is:

- **every hit computed `n <= 0`.** `hits` is non-empty, so it never reaches the guard; the
  planning loop drops it. The CARD chose the amount and owns the explanation — Siphon Life
  already says "X = 0".
- **a fully PREVENTED batch (R98).** Prevention runs *after* `!order.length`, in the
  `received` loop, so a prevented batch structurally cannot arrive at the guard, and
  `preventUnitDamage` logs itself.

Deliberately not caught: a non-empty batch whose targets have all left play. That is R5's
"your target is gone", those cards announce it themselves, and folding it in would put two
different sentences behind one guard.

---

## R110 — "Trigger two/three copies of this graft ability" repeats bounded grafts and charges [costs] N times

*(Audit follow-through, 2026-08-23. Sourced ruling, not a guess — numbered
R110 to stay clear of the R103–R109 block the concurrent playtest round is
writing.)*

**Lost Guardian** (two marks), **Witness of the Crossing** and **Amphivore**
(three) are graft MULTIPLIERS: `EffectDef.graftCopies` on their effect, read by
`composeParts`, which materializes every OTHER graft part of the composite N
times — *Graft 1 → Graft 2 → Graft 1 → Graft 2* — as ONE stack item. The
multiplier's own effect does nothing at resolution.

**The ruling** ("Amphivore / Lost Guardian. Bounded Grafts and Ralph explained.",
Insanity Engine, moderator, 2025-03-21 — and "Can Amphivore trigger a bounded
graft three times in a turn? Yes", same day):

- *"Any Bounded Grafts will be repeated."* A [Switch1] graft's budget is spent
  once by the cause's single trigger and the composite gets N copies of it.
  Amphivore used to skip bounded grafts ("correctly run once") — wrong.
- *"Cost must be paid twice (Lost Guardian) or thrice (Amphivore)."* Each
  copy is its own part with its own cast-window [cost] and its own receipt.
- *"What if you must Sacrifice 2 or 3 units, but have only 1 available? — No
  Sacrifice at all and you don't get the effect."* `collectCastCosts` asks
  about the N-fold cost ONCE, before the first copy pays; unpayable skips
  every copy, and declining the first copy declines them all. (All three
  doublers used to skip [cost] riders outright, resolving only the paid
  printed copy — also wrong.)
- A targeted graft aims each copy separately (each part collects its own
  targets in the cast window — no more mid-resolution `ctx.choose` picking).
- Ralph's control-changing graft: the copies after the first find the unit
  no longer yours and do nothing — that falls out of resolution order.

Two multipliers in one composite (a doubler grafted under a doubler) multiply;
unruled, and unreachable in the pool without someone trying. Tests: 17-earth-b
(bounded repeat; [Discard a card] paid twice; all-or-nothing), 14-water-a
(bounded tripled; three targets).

---

## R111 — a FREE prophecy release casts an X spell for X = 0

*(Audit follow-through, 2026-08-23. Owner's ruling.)*

The engine used to log *"released for FREE"* and then run the normal "choose X
(paid now)" decision, charging the whole X. **Bena, 2026-08-23:** *"prophecy on
an X spell works like magic, forced to cast it for 0 (unless its X is an
additional cost or something)."* So a fulfilled-prophecy release of a
`mana: 'X'` card fixes `item.x = 0` at creation (`baseItem` via
`playAtTiming`'s `fixedX`), `collectX` has nothing to ask, nothing is paid, and
the log says *"an X spell released for free is cast for X = 0"*. A bracketed
variable cast cost ("[Remove X +1/+1 counters]", "[Pay X life]") is a
different X — a COST, not the mana — and is still collected as before. Test:
36-cache-prophecy (R111).

---

## R112 — a stolen unit's mods change controller with it (one control-change primitive)

*(Audit follow-through, 2026-08-23. Owner's ruling.)*

Four card batches carried their own "gain control" helper and disagreed on
the mods: wood-a flipped the mods' controller, wood-c / hybrids-wm-b /
hybrids-ld-a left the mods on the old controller (so "your units" statics and
"[Augment] when I…" text donated by a mod on a stolen unit still read the
thief's opponent). **Bena, 2026-08-23:** *"A stolen unit's mods are part of
the unit, so yes, they go with them to the unit's new controller. That's the
whole point of some of the viruses which force units to flip flop
controllers."*

`E.giveControl(u, to)` is now the one primitive (Corrupting Blight, Hush Mush,
Hexbane Shiitake, Ralph, Rebalance, Stellarspore Harvester, the wm-b and ld-a
steals all call it): the unit AND its mods change controller (owner never
does); it leaves any formation through `removeFromFormation`, so the R72
column collapse happens — the local copies spliced the arrays by hand and
skipped it; and since regions are exclusive, a unit whose new controller is
not present where it stands (a deployment-time steal) goes to that
controller's home now, mods with it, rather than sitting in a region its
controller is not in until regroup. Mid-battle both seats are present and it
stays on the board. Test: 25-wood-c (R112).

*Also closed without a ruling:* the audit's "three readings of 'my column
connected'" — on re-reading the printed text, Blightmound says *"When **I**
deal combat damage or die"* (its anchor-only check is right), Vroot says *"my
column deals combat damage"* (it listens to damage AND life loss, so blockers
count, as printed), Zephyrzoa/Amphivore say *"…to an opponent"*. Each follows
its own words; there was no divergence to rule on.


## R113 — a bounded use is spent by USING it, not by it working

*(Designer, 2026-08-23, four answers in one sitting. This is the rule the whole `[once]` /
`[Switch1]` / `[bounded_graft]` family is measured against, and it **narrows R108**.)*

### The line

> A bounded ability **"can only be activated or triggered once per turn. Regardless of if
> that ability resolves or doesn't."**

and, on the same day, about **Hexbane Shiitake**'s `[once]` trigger:

> "Its ability can only be triggered once per turn, but you can choose for each spell if
> you want to let it trigger and to put the ability on the stack."

Read together those two sentences name a single moment: **the bounded use is spent when
the ability is activated, or when it is put on the stack.** Before that moment the player
may decline for free, as often as the trigger condition recurs. After it, nothing hands
the use back — not a fizzle, not a negation, not a run that finds there is nothing to do.

**What survives, therefore, is exactly one shape:** the player was offered the ability and
did not take it up, or could not be offered it at all. Every `E.refundPart` route in the
engine has to answer to that sentence, and the ones that did not have been deleted (see
"the two families" below).

### The two families, as the code has them

The pool's bounded runs bail out in two ways, and the ruling splits them:

| the branch says | example | R113 |
| --- | --- | --- |
| *the player declined, or no offer was possible* | Afflicting Anima's "you may pay [1]" refused, or unpayable; Hexbane Shiitake declined, or never asked in the end-of-turn window; Murkdrop Distiller with nothing in the bin to cache; The Bonesculptor with no legal unit to offer; a graft rider's `[cost]` declined at cast time | **not spent** — `ctx.refundBudget?.()` stays |
| *it was used and simply achieved nothing* | Auric Ascendant activated with no other ally to recall; Slag Spewer activated with no mod to erase; Graxxlid's target already off the stack; Structural Collapse's sacrificed unit having 0 defense; **any fizzle** | **spent** — the refund call has been removed |

The test of which family a branch is in is not "did anything happen" — it is **"was there
a yes/no about the ability itself, and was the answer no?"** An activated ability the
player paid for has no such question in it; a `you may` does.

### Nesting: `[graft]` under `[bounded_graft]`, and the other way round

Both directions were ruled explicitly, and both were already true in `E.composeParts`:

> "With `[graft]` under `[bounded_graft]` the whole block of different parts is only put on
> the stack once per turn."

A **bounded cause** bounds the whole composite. `composeParts` returns `null` on the second
attempt, so nothing — base effect or grafted rider, bounded or not — goes on the stack
again that turn.

> "With `[bounded_graft]` under `[graft]` the big block of different parts can be put on the
> stack multiple times each turn, but after the first time the `[bounded_graft]` parts are
> missing."

An **unbounded cause** composes every time; each bounded graft rider is skipped once its own
`mod.budgets['graft']` is set, and the composite still fires without it.

The budget is per *card* (R9), which for the rider means per **mod entity** — two copies of
the same bounded graft card on one host each get their own use.

Tests: 94-bounded-uses (all four answers, one test each), 93-engine-defects (the decline
routes R113 keeps).


## R114 — combat damage is DEALT in full; the split is elective, and only {Piercing} leaves the unit

*(Designer, 2026-08-23, two answers in one sitting — playtest reports #84 and #79.)*

### The line

> "ALL damage is dealt to units, even if it surpasses its defense. The only exception is
> Piercing, which deals excess to the controller."

and, asked the same day how a column splits over **several** blockers:

> "Each player is allowed to split the damage however they want, actually. It's actually
> legal to do ALL the damage to the front unit and none to the back one, even if there is
> enough to kill them both. The only rule is that the front unit must be assigned lethal
> damage before assigning any to the back unit."

So there are two separate things, and the engine had been conflating them:

* **Assignment** — how a column's pool is *divided* among the units it is fighting. This is
  the attacker's (or blocker's) choice, constrained by exactly one rule: **a unit in front
  must be assigned lethal before anything is assigned behind it.** Lethal is a *floor on the
  pass-along*, not a ceiling on the share.
* **Dealing** — what happens to the assigned pool. All of it lands. Nothing is trimmed for
  being more than the victim's defense; "excess damage beyond the health of the back row
  unit" simply piles onto that unit unless the column has **{Piercing}**, which is the one
  attribute that carries it out of the combat and onto the controller's face.

### What was wrong

`E.assignColumnDamage` computed each victim's *lethal need* and then used it as a **cap on
the damage dealt** (`a = Math.min(remaining, poolNeed)`), returning the leftover — which
both callers dropped on the floor unless the source column had {Piercing}. A 4-power
attacker into a 1/1 blocker therefore *dealt 1*, and every card that reads the amount off
the `damage` event (Vroot, Mirage Scuttler, Molten Tormentor, Lithoghul, Restitution,
Mirrorback Ambusher, Decay Distributor, Jollyglop, Phytochemical Protection) read the
trimmed number. Report #79 is the sharpest case: a 2-power **{Deadly}** column into a
shielded 7/3 paid **1** prevention counter instead of 2, because {Deadly}'s one-point floor
had been implemented as a cap.

Effect damage was never affected — `E.dealEffectDamageAll` always dealt the full amount, and
its `poolToKill` is read only by {Piercing} and {Electric}. The two damage paths had quietly
drifted apart; `82-attr-interactions` now pins them together.

### What the engine does

`assignColumnDamage` walks the victims front-to-back paying each one its **pass-along share**
(the pool that would kill it; 1 for a {Deadly} column), and then lands whatever is left on
the **back-most living unit** — one of the legal splits under the elective rule above, and
the one the rulebook itself describes. {Piercing} is still the exception: its leftover is
returned to the caller and hits the face instead.

The **player-elective** split shipped later as **R120**: when a strike carries a real choice
the dealing side is asked, and the split above is the one-click default. Two neighbouring
behaviours are deliberately unchanged: a column whose blockers all died still drops its
non-Piercing power (R72/R13 — there is no unit left to deal it to), and a {Vulnerable}
back-row unit receives *double* the leftover, because the leftover is source-side pool.

Tests: 05-rulings (R114, three tests), 24-wood-b (Phytochemical Protection, the whole hit
and the report-#79 situation), 38-light-a (Vroot), 17-earth-b (Mirage Scuttler), 19-hybrids
(Mirrorback Ambusher), 82-attr-interactions (combat and effect damage agree).

---

## R115 — a created unit arrives where its SOURCE is

*(Designer, 2026-08-23, from playtest report #83. This ruling **WITHDRAWS R28 and R52**
and **ABSORBS R33**. It is a rules reversal, not a clarification: three cards' worth of
power was deliberately cut by it.)*

### The line

> "Life Plant's units were made in my region, despite it currently being in Rashi's
> region. **Anything made by anything needs to spawn in that region** (then can return
> during regroup)."

*That region* = the region the SOURCE is in **right now**, at the moment the effect
resolves. Not the controller's home region; not where the source was played; not where the
card that made the source came from.

### The consequence, put to the designer explicitly and confirmed

A token minted **mid-attack** is created in the **enemy region**. It is in that region and
in **no column** — the state the client already draws as the invader's zone (a unit in a
region but outside the formation is first-class and long-tested, 73-play-into-formation).
Therefore:

- it **cannot block the counterattack** — `validFormation` gates blockers on
  `u.region === fromRegion`, and the attacker's home region is not the battle region;
- it takes no part in this battle at all unless something places it into the formation;
- it **walks home at regroup**, like every other unit out of position (`startRegroup`).

This is a real power cut to **Tidelurker**, **Life Plant**, **Legion of the Depths** and
**Pack Leader**, and the designer confirmed it as intended. R28 existed *because* of
Tidelurker's 2/2 ("it must be home to block the counterattack"); that sentence is now the
thing the rule forbids.

### What it means in code

`ctx.region` **is** the answer, on all four resolution paths, and always has been:

| path | where `StackItem.region` comes from |
| --- | --- |
| spell cast in battle | the battle region the cast happened in (`apply.ts`) |
| spell cast in deployment | the caster's home region (`apply.ts`) — home **is** the source's region then |
| activated ability | `u.region` — where the unit stands (`apply.ts`) |
| triggered ability | the source's region at fire time (`engine.ts`, R70) |

So the rule is one line long: **a card that creates something passes `ctx.region`.** There
is nothing to compute and no new primitive. `E.spawnUnit(seat, name, region, opts)` keeps
its required explicit `region` — it has no `ctx` and cannot see the source, so it must not
grow a default.

25 cards were discarding `ctx.region` and substituting `g.homeRegion(ctx.controller)`; all
25 now pass `ctx.region`. Two of them were **live bugs today** (battle-timing spells:
Galactic Germination, Arcane Echo); six were latent (deploy-timing spells, where home *is*
`ctx.region` — wrong only once a `[Switch1]` is grafted onto a battle cause); the other
seventeen were ability-path creators, the family report #83 is about.

### The three silent defaults, deleted

`makeOneOne` (batch-wood-a), `makeRobot` (batch-metal-b) and `create1s` (batch-wood-c) each
took `region?: number` and fell back to `?? g.homeRegion(seat)`. That `??` is *how* four
cards inherited the wrong region with no line of code anywhere saying so. `region` is now a
**required** parameter on all three, so the compiler asks the question at every call site.

### The guard

`98-spawn-region` scans the card sources and **fails on any `homeRegion(` inside a `run:`
body under `src/cards/`**, with a named allow-list. The allow-list is empty of creators by
construction: the only cards allowed to name a place are the bespoke placers, and those
name a *slot* or another unit's region, never `homeRegion`. The test also asserts every
allow-list entry is still needed, so the list cannot rot.

### What did NOT change

- **Spell tokens** (Fireball, Poison, Crystal) already appeared at `ctx.region`. R115 is
  the same rule for unit tokens — the "battle materiel" distinction R28 drew is gone
  because there is no longer anything for it to distinguish.
- **Bespoke placers** whose printed text names a place: Hooba-God ("in my formation"),
  Hooba-Mon, Necromorph (the victim's region), Feed to Hooba ("in its position in play"),
  `E.ambushSwap`. These name a *slot* on top of R115's region.
- **Putting a card into play from a bin** (Exhume, Wake the Dead, Resurrect, Uglk…) is not
  creating; those cards pass `ctx.region` already and are untouched.
- **Regroup** already returns every out-of-position unit to its controller's home region
  (`startRegroup`), which is the second half of the designer's sentence.

Tests: 98-spawn-region (report #83 verbatim; the regroup round-trip; R28's rationale
inverted — the mid-attack token cannot block; the source scan; the two battle spells; a
deploy-timing negative control), plus the fifteen card tests that flipped from asserting
the old rule.

## R116 — An EXCHANGE is not an ACTIVATION: no affinity Shard for a traded Prismite

> ## ⚠ REVERSED BY [R132](#r132--a-prismite-does-activate-its-new-resource-r116-reversed).
> The owner reversed this on 2026-08-24 from playtest ANBB (report #92):
> *"Prismites are behaving wrong. You told me they shouldn't trigger the
> creation of a shard, but that's not true. It literally says on them that you
> make a resource then activate it."* The section is kept in full below,
> because how it went wrong is the useful part: **it never quoted the card.**
> It reasoned from the engine's `exchange` MODEL — a mutation of an
> already-activated resource — and from a fetchland analogy, and neither is
> what the card says. Do not restore it.

*(Owner, 2026-08-23. **Engine bug, quietly live since the p.18 bonus shipped.** This is a
NERF: prismite-heavy play had been collecting a Shard it was never owed.)*

### The line

> "An exchange is not an activation."

Caleb draws the same line, and names the mechanism it is not:

> "'Activating the prismite' is like playing your land for turn, but cracking the
> fetchland doesn't take an additional land drop."

### What was wrong

`doExchangePrismite` set `r.kind = element` and then called `maybeGrantShard`, so trading
an active Prismite into your third copy of an element handed you a free dormant Shard —
the Manual p.18 affinity bonus, paid on a card that had not been activated as that
element. The inline comment justified it by arguing that "the exchange turns an
already-activated resource into this element, so the p.18 shard bonus applies just as if
it had been activated as one".

That reasoning is the error. The trigger is printed as "**When I activate**", and the
activation already happened — to a **Prismite**, which pays nothing (R17: prismites give
no affinity, and `maybeGrantShard` returns early on `prismite` and `shard`). R17's
exchange is a *later, separate* planning action that changes what an already-face-up
resource is. It does not rewind time and re-run the activation as the new element, any
more than cracking a fetchland re-spends your land drop.

### What it means at the table

- Activating a dormant element resource at ≥3 affinity: **Shard**, every time (Caleb,
  asked whether the bonus is once or repeatable: "**Every time**"). Unchanged.
- Exchanging an active Prismite into an element — even your third copy of it: **no
  Shard**. The Prismite's value is R17's colour fixing, and that is all of it.
- Recycling a card for a resource (R17's other resource source) never paid the bonus and
  still does not: `doRecycle` creates a **dormant** resource, and you have to spend an
  activation on it before anything happens.

The affinity bonus now has exactly **one** call site, `doActivateResource`. Any future
resource-creating action that wants to pay it has to say so, in the same breath as saying
why it counts as an activation.

**Tests:** `21-fixes` — the test that asserted the old behaviour ("exchanging a Prismite
into your 3rd element copy also grants the shard") is inverted and renamed, and now pins
that the exchange still *works* (the resource really becomes that element, keeping its
state) while paying nothing. `12-fire-a` carries the positive half: the seven-element
conformance sweep and the self-counts-toward-its-own-three boundary.

---

## R117 — "when my column deals combat damage" fires in MY column's sub-step

*(Owner ruling, 2026-08-23, closing the last open question on **Eldritch Dreamtender** —
the `{ todo: true }` that outlived all four round-7 deferrals.)*

### The line

> It fires in the sub-step its **own column** strikes in — a {Swift} column fires in the
> Swift sub-step, otherwise the normal one.

### What was wrong

Combat damage is dealt in three sub-steps (Swift → normal → Sluggish, R3), and
`E.commitPlayerDamage` aggregates **every** connecting column's face damage into **one**
`loseLife` per seat per sub-step. The three cards that print "when my column deals combat
damage to an opponent" — **Eldritch Dreamtender**, **Zephyrzoa**, **Blightmound** — all
listen on that aggregated `lifeLost` and asked only *"is my column attacking unblocked, or
piercing?"*. Nothing asked *which sub-step is running*.

So a Dreamtender standing in a **normal** column fired during the **Swift** sub-step
whenever any Swift column also connected. Because R73 makes its sacrifice a **cast cost**,
it was then in the bin before its own column ever struck — and its own power simply
evaporated. Same shape for Zephyrzoa (recall your bin and erase me) and Blightmound.

### What the engine does

Two public methods on `E`:

* `combatSubStepOf(u)` → `'Swift' | 'normal' | 'Sluggish' | null` — which sub-step `u`'s
  column strikes in, or `null` when `u` is in no column. It finds `u`'s column on either
  side of the pairing, reconstructs the pairing's `pure` **exactly the way
  `assignCombatDamage` does**, and returns whichever sub-step the private `scheduled()`
  answers true for. Threading `pure` is not decoration: **R61 {Pure}** blinds a whole
  exchange to attributes in both directions, so a printed {Swift} column blocked by a Pure
  unit collapses into the *normal* sub-step.
* `strikesInCurrentSubStep(u)` — `b.damageStep === combatSubStepOf(u)`. The one shared gate
  the three cards call.

**The gate must live in `when()`, never in `run()`.** `when()` is evaluated at event time
(R1), *inside* `combatSubStep(sub)`; `pumpCombatDamage` advances `b.damageStep` only *after*
`combatSubStep` returns, and then drains the trigger queue. So `b.damageStep` reads the
CURRENT sub-step during `when()` and the NEXT one by the time the trigger settles.

### What this does NOT close

Face damage still arrives as **one aggregated `lifeLost` per seat per sub-step**, so two of
the *same* player's columns connecting in the *same* sub-step remain indistinguishable to
card text. The sub-step gate narrows the ambiguity a great deal but does not remove it;
removing it means carrying live column ids on the combat ledger, which is a separate job
that also touches Amphivore and Vroot.

Orthogonal to **R114** (combat damage is dealt in full), which changed `assignColumnDamage`
and touched neither `scheduled` nor `commitPlayerDamage`.

**Tests:** `53-playtest-round7` — five tests: a Dreamtender in a normal column beside a
Swift one (the regression: 3 face damage, not 2), the {Swift}-column mirror, a {Sluggish}
column waiting out both earlier sub-steps, the {Pure} pairing collapsing a printed {Swift}
column into the normal sub-step, and `combatSubStepOf` answering `null` outside a column.
`26-metal-a`, `44-hybrids-ld-a` and `42-dark-b` keep the three cards' own coverage.

---

## R118 — the COPY LAYER: a face in front of the identity, at layer 0

*(Owner rulings, 2026-08-23, unparking **Apex Prime**, **Borrower of Forms** and
**Ancient One** — the last multi-card seam in the ledger. The activated-ability facet
landed later the same day; see "The ACTIVATED facet" below.)*

### The two rulings

**1. SPLIT IDENTITY.** A copy changes the **game name** — statics, "name a card",
targeting by name, the text box — but the **physical card is unchanged**: it bins, it is
erased, and it belongs to a deck *as itself*. A Borrower of Forms that became a Good Whale
and then dies puts **Borrower of Forms** in the bin.

**2. MODS.** The owner, verbatim:

> *"Inherit the mods text, but it IS Unstable. Anything that's modded is unstable and the
> copy is still considered modded."*

So a copy of a modded unit inherits the mods' **text**, no mod entity is cloned, the copy
**counts as modded**, and it is therefore **{Unstable}** — erased instead of binned when it
dies (R69). This is neither of the two options that were offered; it is what he said.

### Why it is a layer and not a rewrite

R101 (transform) rewrites `Entity.card` in place and argues *"there is no transform layer
and there does not need to be"*. That argument is right for a **permanent, total** change
and is exactly why it fails for a copy:

* **Apex Prime must revert** — "until regroup" is printed on the card;
* **Ancient One is additive and continuous** — adjacency changes *inside* one combat (R72
  column collapse, a neighbour dying, blockers declared), so the answer has to be
  recomputed every time it is asked;
* a rewrite would **destroy the physical card**, which ruling 1 forbids.

So there is **one indirection in front of the identity**, and `Entity.card` is never
written by a copy.

### The shape

`Entity.copies?: CopyRef[]`, where a `CopyRef` is `{ card, facets, until, from, seq }` plus
two optionals. `facets` is which of `name | stats | attrs | statics | activated | triggered | behavior`
(the last added by R127) the face contributes; `seq` is a `nextId` tick, so two copies resolve **last-wins** exactly
the way `baseSet`/`baseSetSeq` does. Everything is plain serializable data, so `seed +
actions` replays bit-identically and states written before R118 load unchanged.

The engine's four public reads:

| call | answers |
| --- | --- |
| `E.faceName(e)` / `E.nameOf(e)` | the GAME name — `facesOf(e)[0].card` |
| `E.faceDef(e)` | `getCard(faceName(e))` — where its rules come from |
| `E.facesWith(e, facet)` | every face contributing that facet, in order |
| `E.isUnstable(e)` | mods, or R96's stamp, **or** ruling 2's copied-modded face |

`E.nameOf` was added the same day for The Everywhere's name-matching static, reserved as
"the single hook for a copy layer". It is that hook; it is now `faceName`.

Two writers: `E.becomeCopy(target, src, opts)` stamps a face, and `E.prepareCopy` /
`E.wearCopy` split it in two for a card whose halves resolve separately (`E.parkCopySource`
/ `E.takeCopySource` hold the prepared face in `GameState.copyParks`, `battleCounters`'
sibling — Borrower of Forms erases its target in one resolution and spawns the body that
wears the face in the next, so the source entity is gone by then).

The **continuous** half is `CardDef.projects` (a `FaceProjection`), radiating through
`E.anchored()` exactly as `StaticMod` does: units in play plus augment mods reading from
their host, R12 region scope, and the shallow R62 guard. That is what makes Ancient One's
`[Augment]` form project onto the **host** for free.

### Layer order

**COPY IS LAYER 0**, below everything, because it redefines what *printed* MEANS:

```
0 COPY  ·  1 printed/tokenStats  ·  2 baseSet + StaticMod baseP/baseT
3 counters/temp  ·  4 Tough/Balanced  ·  5 Inverted  ·  6 Unaware
```

Consequences, each of them pinned by a test:

* **A later `setBase` still wins — and so does an earlier one.** Layer 2 rewrites whatever
  layer 1 currently says, so the order the two land in does not matter.
* **Counters and marked damage stay on the entity.** They are facts about the *unit*, not
  about the face (R101's precedent). A 1/1 that becomes a 7/5, takes two -1/-1 counters and
  then reverts at regroup **dies** — and the regroup sweep now runs `checkDeaths()` on the
  way out, which it never did. That check was also missing for `baseSet`, silently, since
  layer 2 shipped.
* **R106 {Unaware} reads the COPIED face's printed stats.** `E.printedStats` consults the
  face first: a Unit Token wearing a Good Whale face *prints* 7/5.
* **R62 suppression is a veto ABOVE copy, checked on the ENTITY.** A silenced copy radiates
  nothing — all of its faces go off at once — but it keeps its name and its body, because
  R62 switches *abilities* off, not identity.
* **A projected face never carries `name` or `stats`.** `facesOf(e)[0]` is always the
  identity face, so "I have all abilities of adjacent allies" does not rename the Ancient
  One or make it a 7/5.

### Decisions taken here (defaults, all documented)

* **Copy of a copy chains via the FACE** — MTG's "copiable values", and the only reading
  consistent with split identity. You copy what it *is*, not what it is printed on.
* **"Create a copy of me"** (Echo of Despair, Hooba-God, Swarmling) reads the FACE, and
  carries no counters and no mods.
* **Borrower of Forms overrides layer 1.** `CopyRef.printedStats` snapshots the target's
  *base* (layers 1-2) rather than the copied card's printed pair, because the reminder text
  says "I copy all **stat changes**". It is the only card that does. It also **stops
  writing `self.tokenStats`** — a live latent bug: `tokenStats` is layer 1 "what a token
  was created as", the Borrower is not a token, and the write made {Unaware} read the
  *borrowed* numbers as printed.
* **Ancient One's TRIGGERED half keeps its bookkeeping `when()`**, and its projection
  declares `facets: ['statics', 'activated']`. The generic face machinery cannot label a
  mimicked trigger *"Ancient One (as Minor Kraken)"*, and that attribution is what tells a
  player whose trigger they are ordering. Leaving `'triggered'` in would queue every
  mimicked trigger twice.
* ~~**A copy does NOT carry the radiating-permission families**~~ — **REVERSED BY R127,
  2026-08-24.** This section used to say that `costMods`, `effectAttrs`, `amountMods`,
  `playPermissions`, `modPermissions` and `mustBeTargeted` "read `this.card(holder.card)`
  in six `anchored()` walks of their own and no card in the pool needs them copied today",
  and that routing them through `facesWith` was "mechanical when one does". The owner's
  Ancient One ruling is that one, and the seven `replace*` hooks were a seventh through
  thirteenth channel the sentence did not even list. **The facet list above is therefore
  no longer complete**: `CopyFacet` gained `behavior`, and every one of those thirteen
  walks now reads `E.facesWith`. See R127.

### The ACTIVATED facet — the offer and the accept (2026-08-23, same ruling)

The facet shipped stamped but unread: `apply.ts` offered and accepted activated abilities
off `getCard(u.card)`, so a copied or projected one could never be used. Both reads now go
through **`E.facesWith(u, 'activated')`**, which closed Apex Prime, Ancient One and Borrower
of Forms in one change, exactly as this section predicted.

**Which face, which list.** For every face the unit is wearing, in layer order, BOTH its
`abilities` and its `augmentText` are live — the same pair `E.fireEvent` already scans for
the triggered facet. A card's own `[Augment]` text is active when it is played normally
(Manual Q&A), and a face projected off a neighbour's *augment mod* has its text nowhere
else, so dropping `augmentText` would drop half of "this includes modded abilities".

**`Action.via` grew a fourth arm, additively:**

| `via` | list | budget / effect key |
| --- | --- | --- |
| `undefined` | the IDENTITY face's `abilities` | `ability:<face>#i` |
| `'augment'` | the identity face's `augmentText` | `augment:<face>#i` |
| `{ mod }` | that augment mod's `augmentText` | `augment:<mod card>#i` |
| `{ face }` / `{ face, text: 'augment' }` | a **projected** face's list | `ability:<face>#i` / `augment:<face>#i` |

The first three arms are byte for byte what they were, so an action log written before the
`{ face }` arm existed still parses and still replays identically — pinned by a replay
round-trip test that puts a real `via: { face }` in the log.

**The identity face keeps `via: undefined`.** A unit that *became* a copy has not borrowed
anything: the copied card is what it **is**, so its abilities are its own. Only a face that
is not the identity one — a continuous projection — is addressed by name, which is also
what makes the UI able to say *whose* ability it is.

**The R9 budget is keyed by FACE, never by `Entity.card`.** `composeParts` takes
`viaCard ?? faceName(source)`, and the `{ face }` arm feeds it the face. Without that, an
Ancient One standing between two neighbours whose `[once]` abilities both sit at index 0
would give them **one** budget between them and the second would be unusable.

**Offer and accept share one derivation.** `pushActivatedOptions` and `activationSource`
both call `facesWith(u, 'activated')` and both decide "is this the identity face?" with
`faceName(u)`; a face the unit is not wearing is *refused* rather than quietly resolved off
the physical card. This repo's "legalActions lied" bugs are all splits between those two,
and the fuzzer has an invariant for exactly it. `ui/inspect.ts` mirrors the pair in one
`activationTextSource` helper that `abilityOf` and the option label both use, so the
inspector cannot list an ability the game will not offer.

**Tests:** `44-hybrids-ld-a` — twelve tests on Apex Prime covering the name, the physical
card in the bin, a copied static radiating, R62 as a veto above copy, {Unaware}, {Inverted},
`setBase` ordering both ways, the lethal regroup revert, copy-of-a-copy, face replacement
across attack-then-block, a `seed + actions` replay round trip of `Entity.copies`, and the
copied activated ability being offered, accepted and firing — then gone again at regroup.
`26-metal-a` — Ancient One's projected static appearing and vanishing with the column, the
Ancient One keeping its own name and body, Borrower of Forms taking the name/attrs/text,
binning as itself, ruling 2's modded-copy erase, the permanent face with its snapshotted
base, plus the projected ACTIVATED ability (offered, accepted, refused the instant the
column breaks), the per-face `[once]` budget, the permanent Borrower offer, and the
`via: { face }` replay round trip.

---

## R119 — a paid-for cost reduction OUTLIVES its source ("you paid for it")

*(Card-drill follow-through, 2026-08-23. Owner's ruling.)*

**Deferral Drone**: *"[Augment][once] Gain 4 debt: The next card you play this
turn costs [3] less."*

The card was built on 2026-08-22 out of three parts that all lived on the
entity: the charge was an `Entity.budgets` key, the discount was a `CostMod`
radiating from the anchor, and the spend was a bookkeeping trigger on the same
card. So **sacrificing the Drone in response evaporated a charge the player had
already paid 4 debt for.** Nothing in the rulings export speaks to this card at
all (zero hits for *"Deferral"*, *"next card you play"*, *"costs [3] less"*),
so it was parked as a ruling question rather than guessed at.

**Bena, 2026-08-23:** *the charge survives — **"you paid for it."***

So the charge is not a property of the Drone. The **ability has resolved** and
its cost is spent; what is left is a fact about the PLAYER, and the source
leaving play cannot reach back through a resolved effect to take it away. This
is the same instinct R59 already encodes on the other side — a CostMod is
continuous and dies with its anchor precisely *because* it has never resolved.

### What it is now

`GameState.nextPlayDiscount?: number[]` — per-seat, additive/optional, so a
game serialized before this ruling loads and reads as 0.

| part | where |
| --- | --- |
| **set** | `E.grantNextPlayDiscount(seat, n)`; the card's `run` passes `ctx.controller` |
| **read** | `E.manaToPlay`, after the `costModsFor` fold and **before** the clamp at 0 |
| **spend** | `E.spendNextPlayDiscount(seat)` at the `'spellPlayed'` and `'spawned'` emit sites |
| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |

**All three moving parts had to move, not just the charge.** The spend half was
a trigger *on the Drone*, so a charge that survived the Drone with a card-side
spend would have been **unspendable** — a permanent 3-mana discount on every
card for the rest of the turn. That is why this is an engine change and not a
card change.

**On `GameState`, not `PlayerState`.** The two existing per-seat-per-turn
charges — R43's `hasteManaSpent` and R97's `hastePlaysUsed` — are both
top-level arrays, and `PlayerState` is the redaction-sensitive object:
`server/view.ts` replaces `players[opponent]` **wholesale** with the
segment-start snapshot inside a hidden simultaneous segment, and rewrites hand
and resources on top of it. Per-turn bookkeeping that must read live for the
acting seat belongs beside its siblings.

**`ctx.controller`, so R59 still holds.** That is the ITEM's controller — the
Drone's controller when it is a unit in play, and the **HOST's** controller
when the text was donated by an augment. *"You"* is the host's controller, and
the `[Augment]` half needs no extra code, exactly as it did under the CostMod.

**The `purpose` guard is R37/R59, unchanged.** A mod payment passes
`purpose: 'mod'`, so the discount is not consulted and the charge is not burnt:
applying an augment, a graft or a battle Virus is **not playing a card**.

**The spend stays at the EVENT sites, deliberately — NOT in `payCard`.**
Moving it into `payCard` looks cleaner and silently changes behaviour: a free
prophecy release (R111) never reaches `payCard` at all (`doPlayCached`'s `free`
arm skips it outright) and yet it *is* a card being played, and it fires
`'spellPlayed'` / `'spawned'` like any other. Under the event sites it spends
the charge, which is what the card already did. The two sites carry the two
filters the card's own `when()` made, verbatim: a **spell token** is cast from
play rather than played (R59), and a unit that arrives with no `from` zone was
**created**, not played (R49).

### The one behaviour change, named

A `CostMod` is **region-scoped** (R12: `costModsFor` filters `a.region ===
region`). A per-seat charge is not. **After this ruling, a seat acting in two
regions in one turn gets the discount wherever they play.**

That is the more correct reading rather than an accident: *"the next card
**you** play"* is player-scoped text, and R12 exists to stop information and
continuous effects crossing between regions, not to fence a player's own
resolved bookkeeping — the same way life, debt and rot are not region-scoped.
It is recorded here because it is visible at the table, not because it is in
doubt.

### Tests

`45-hybrids-ld-b` — the charge survives the Drone being sacrificed; it is spent
by the next play *with the Drone gone* (the reason the spend could not stay
card-side); it does not carry into the next turn; applying a mod still does not
burn it with the Drone gone (R37); plus the five pre-existing Deferral Drone
tests unchanged, including the donated-augment R59 case and a JSON round-trip
that also loads a pre-R119 state with the field absent.

---

## R120 — the ELECTIVE combat-damage split: the dealing side is ASKED

*(The deferred half of R114 / playtest report #84, built 2026-08-24. The ruling was already
on the books; this is the engine catching up to it.)*

### The line

> "Each player is allowed to split the damage however they want, actually. It's actually
> legal to do ALL the damage to the front unit and none to the back one, even if there is
> enough to kill them both. The only rule is that the front unit must be assigned lethal
> damage before assigning any to the back unit."

R114 recorded the ruling and shipped only the auto-split, marked as deferred. The standing
project rule — **the engine must never decide for the player** — is what this closes: with
two living victims and more pool than the front unit's share, *which* legal split lands was
the engine's choice, not the controller's.

### What the engine does

At the top of every combat-damage sub-step, **before the ledger exists and before any event
is emitted**, `E.collectAssignPlans` walks the columns exactly as the assignment will
(`exchangeAt` is the shared derivation — same alive-filters, same {Pure}/{Unaware}
handling, same Powerful-doubled pool) and raises a decision for every strike whose split is
a *real* choice:

* **≥ 2 living victims**, and
* **pool > the front unit's pass-along share** (`victimShare`: lethal need, halved and
  rounded up under {Vulnerable}, 1 under {Deadly}, printed defense in an {Unaware}
  exchange), and
* **no {Piercing}** — its overflow is automatic, never elective (the ruling's own
  exception; the overflow keeps hitting the face untouched, and there is nothing left over
  to elect once every share is paid).

The decision (`kind: 'assignDamage'`, suspension `'combatAssign'`) belongs to the side
**dealing** the column's damage — the attacker over the blocking column, the defender over
the attacking column; both directions multi-assign. It is **iterative**: one victim at a
time, front-to-back, "how much of the remaining N to this unit?", offering exactly the
legal amounts `[share .. remaining]` — an amount below the front's lethal is never *shown*
while anything would go behind it (the R64 doctrine: illegal options are unoffered, not
refused). Forced steps — the last living victim, or a remainder within the next share —
are auto-filled, so a two-unit column asks exactly one question. The whole pool is always
assigned: the ruling deals ALL damage to units.

The **first** question leads with `default — share front-to-back (…)`: one click reproduces
the pre-R120 auto-split byte for byte and skips the walk. Fast play stays fast; the choice
is still the player's. `forcedAction` never answers it (it returns null under any pending
decision), and `finishBattle`/`assignDefault` in the test rig click the default explicitly.

### Mechanics worth naming

* Answers accumulate in `BattleState.assignPlans` (`{ picks, def? }` per strike key
  `${sub}:atk|blk:${colIdx}`); the suspension is raised before anything mutates, so the
  sub-step **re-enters from scratch** per answer — the processTriggerQueue discipline, which
  is what makes a JSON round-trip mid-election load and drive. Plans are consumed by the
  sub-step's assignment and cleared with it (R72: `ci` is only an identity for the
  sub-step's length). Pre-R120 states simply have no `assignPlans` — read as "no elections",
  which is right.
* An elected split enters `assignColumnDamage` as a `plan` and short-circuits only the
  *walk*: everything downstream of "unit U is assigned K" — {Deadly} marks, {Afflicting}
  buckets, {Blessed}, {Poisonous}/{Resonant}, R98 prevention, {Vulnerable}'s receive-side
  doubling, R114 dealing-in-full — is the same `give()` either way.
* Amounts are SOURCE-side pool points, so a {Vulnerable} victim still receives double what
  was elected onto it, exactly as the leftover behaved before.

Tests: `100-elective-assign` (asked/overkill-front, default = pinned pre-R120 numbers,
floors-only menus, silent trivial combats, {Deadly} floors, {Piercing} silent + unchanged
overflow beside an election, mid-election JSON round-trips, block-side election).

---

## R121 — the ability-cost tax and the pay-to-trigger gate (Crevice Lurker)

*(Card-drill follow-through, 2026-08-24. Designer rulings.)*

**Crevice Lurker**: *"[Augment] Abilities cost [one] more to activate or
trigger during battle. (Choosing to not pay this prevents the abilities from
triggering.)"*

R59's CostMod taxed CARD plays only: `doActivateAbility` had no
cost-modification layer at all, and a trigger had no payment gate anywhere.
Both halves shipped together.

**The tax is the R59 layer, widened.** `CostCtx.purpose` grows two values —
`'activate'` and `'trigger'` — and `E.abilityTax` folds the same radiating
`costModsFor` walk (same R12 region scope, same R62 guard, same reentrancy
latch) over them. Every pre-R121 CostMod gates on `=== 'play'`, so nothing
else moves. Deltas SUM (two Lurkers = +2), exactly as card-play CostMods do.

- **Activation**: the tax joins the printed mana in BOTH places the printed
  mana lives — `canPayAbilityCost` (shared by `pushActivatedOptions`' offer
  and `doActivateAbility`'s accept: an unaffordable taxed activation is
  neither offered nor accepted) and `E.payActivationCost` (paid in the cast
  window with the rest of the activation cost, announced when nonzero).
- **Trigger**: `E.gateTaxedTrigger`, ONE choke point in `processTriggerQueue`
  where every stack-bound trigger passes — card triggers, augment-donated
  triggers and R51 zone triggers alike, never per-card. Under a nonzero tax
  the trigger's CONTROLLER gets a real `payOrDecline` decision: pay and it
  goes on the stack; decline and it simply does not happen. **The decision is
  the player's** — the engine never chooses for them. The one promptless case
  is zero open mana: with no legal way to pay, the trigger is prevented
  outright and announced in the log ("… the trigger is prevented: Crevice
  Lurker taxes it [1] and the mana is not there").

**Designer rulings encoded:**

- The card *"taxes the cost to activate or trigger abilities"* and can stop
  e.g. Ruinbringer's "After combat, delete all units" **like a negate can**.
- An ability's *"if you do"* clause is **not** its own trigger — it resolves
  inside the one queued trigger's parts and is never double-taxed.
- (R37 family) Augment/Ambush are alternative ways to PLAY a card, not
  activated abilities — applying a mod is not taxed (`purpose: 'mod'`).

**What counts as a trigger** (the taxed set): real triggered abilities headed
to the STACK. Bookkeeping listeners whose `when()` returns false never queue
and are untaxed by construction; R3's combat-sub-step triggers resolve
immediately as special actions and never reach the stack, so the gate does
not see them (Ruinbringer's after-combat trigger fires with `damageStep`
already cleared, so it IS stack-bound and IS gated); zone-dispatched triggers
that queue to the stack during battle ARE taxed. Resource activations and
spell-token casts are not ability activations and are untaxed.

**R108/R113 interaction**: a trigger DECLINED at the gate — or prevented with
no mana — keeps its `[once]`: the bounded reservation `composeParts` wrote at
queue time is handed back by `E.refundTriggerBudgets` ("declining never
spends it"; "no offer could be made at all"). Paying spends it, resolve or
not. A zone trigger's stand-in holder was never in `s.entities`, so its
refund is correctly a no-op (its bound never persisted anyway — R51's flag).

**Serialization**: the pending question is the `'payTrigger'` suspension arm
— plain data (the dequeued `PendingTrigger` plus the tax) — so it survives a
JSON round-trip and a replay; `doDecide` resumes through
`E.resumeTriggerGate`, and `server/view.ts` needs no new redaction (the arm
carries no snapshot and no hidden zone).

### Tests

`16-earth-a` — nine real tests (the promoted `{ todo: true }` park): taxed
and refused activation in battle, untaxed in deployment, the pay / decline /
zero-mana trigger gate, the kept `[once]` asking again the same turn, the
untaxed battle mod application (R37), the donated-augment host-region form,
two Lurkers summing to +2, and a JSON round-trip of the pending
pay-decision. The card's ledger entry came off in the same commit, and the
71-card-ledger CANARY moved on to Vengeance.

---

## R122 — an IMPOSED additional cast cost on another player's cards

*(Vengeance un-parked, 2026-08-24.)*

**Vengeance**: *"[Augment] Cards your opponents play during battle gain
'[Sacrifice a unit]'."*

R59's `CostMod` carried `delta` (extra mana) and R60 added `life` (extra
life); a sacrifice is neither — it is a cost **with a choice in it**, so it
can be neither summed into `manaToPlay` nor charged inside `payCard`. R122 is
the third channel of the same layer: `CostMod.sacrifice` returns how many
units the play additionally costs, and the payment routes through the cast
window like every other chosen cost (R35/R49/R64).

| part | where |
| --- | --- |
| **declare** | `CostMod.sacrifice?(g, self, ctx)` — same `CostCtx`, same anchor walk and R12 region scope as `delta`/`life` |
| **count** | `E.unitsToPlay(seat, name, opts)` — `lifeToPlay`'s sibling, line for line; contributions ADD |
| **gate** | `E.canPayCard` / `E.canPayManaOnly`: fewer units in the region than the count → the play is not offered, and `apply()` refuses it — exactly as unaffordable mana |
| **attach** | `playAtTiming` (apply.ts): a `StackItem.pendingCosts` atom `{ kind: 'playSacrifice', n }`, counted against the region the card is played into |
| **pay** | `collectItemCosts` / `payItemCost`: the PAYER picks each unit off a menu of their own units (tokens included); each dies as a real sacrifice through `destroy` — death triggers fire, bin/Unstable rules apply |

Decisions, one per rule that needed making:

- **The payer chooses.** The decision lists the paying seat's units in the
  battle region and nothing else; the engine never decides for the player.
- **Additive composition.** Two Vengeances demand two sacrifices — each
  bracketed cost is its own payment. `unitsToPlay` sums, the atom's `n`
  carries the total, and the collector asks unit by unit ("2 left" first).
- **Mandatory once declared, atomic before the stack.** There is no decline
  option: legality was gated up front (no unit → no play, and a refused play
  pays nothing — hand, mana and board untouched), and the cost is paid in the
  cast window before the item reaches the stack, with the play's mana.
  Nobody may respond between cost and spell. The action model has no mid-cast
  cancel, so "a declined play pays nothing" reduces to the gate plus a menu
  that offers ONLY the payer's units.
- **Scope is the R59/R60 scope, verbatim.** "Your opponents" compares
  `ctx.seat` to the ANCHOR's controller, so a donated augment reads from the
  HOST — "you" is the host's controller — with no extra code; "during battle"
  is the phase test plus R12 region scoping (it taxes the battle it stands
  in, both rounds alike); applying a mod is not playing (R37,
  `purpose: 'mod'`).
- **What stays outside, deliberately.** A spell token is cast from play, not
  played (R59), and never reaches `playAtTiming`; an Ambush pays its own
  printed cost line and today sits outside the R59/R60/R122 play-tax layer
  alike — widening any of the three onto Ambush is one future decision, not
  three accidents.
- **The count is fixed at declaration**, with the rest of the bill.
  `collectItemCosts` keeps a belt-and-braces unpayable branch for a board
  that changes inside the window — unreachable by construction today, and
  labelled as such at the branch.

### Tests

`45-hybrids-ld-b` — nine real tests replacing the `{ todo: true }` park:
the taxed opponent choosing off a menu of only their units; the gated play
refusing atomically with nothing half-paid; the controller's own plays,
deployment plays (region held equal) and battle-time mods all exempt; the
donated-augment host anchor; a death trigger firing off the sacrificed unit
(Static Courier); a JSON round-trip of the pending decision; and two
Vengeances imposing two sacrifices behind a two-unit gate.
## R123 — playing cards out of a BIN under the card's own text (Writhing Host, Trench Stalker)

*(Card-ledger follow-through, 2026-08-24. Two dead cards hung off one seam:
nothing in `legalActions` ever offered a card sitting in a bin unless R96's
battle-scoped spell grant was live, and no permission could be ANCHORED in a
bin at all.)*

**Writhing Host**: *"If I am in your bin, you may play a unit as if it had
[Haste] by erasing me as an additional cost to play that unit."*

**Trench Stalker**: *"[Discard two cards]{/n}I can be played directly into
formation, and played from your bin."*

### The bin-anchored grant (Writhing Host)

R97's `PlayPermission` radiates through `E.anchored()`, which walks units in
play and augment mods — a card in a bin is a NAME in an array with no Entity
to anchor on. So the grant gets its own seam instead of a widened walk:

| part | where |
| --- | --- |
| **declare** | `CardBehavior.binPlayPermissions` (dsl.ts) — predicate takes no `self` |
| **gather** | `E.binHasteGrantorIndex(ctx)` walks `ctx.seat`'s OWN bin — the printed "your bin" is the walk itself, per-seat by construction |
| **offer** | `legalHasteActions` pushes `{ type: 'playCard', …, eraseGrant: true }`, only when no free R97 route exists (a Courier allowance costs nothing and is strictly better) |
| **open the step** | `startHasteStep`'s `canHaste` — report #74's fatal gate, a third time over, in bin form |
| **pay** | `playAtTiming`'s planning branch erases the grantor beside the play's other costs |

**The cost is the grantor.** No `hastePlaysUsed` budget is charged for an
erase-funded play — erasing the card IS the spend, taken only once the play is
known legal (a declined or refused play never touches the bin), announced as
*"Writhing Host is erased from Ben's bin — X is played as if it had
[Haste]."* and routed to the R65 public erased pile by the same `'erased'`
event hook every other erase uses.

**No index rides on the action.** `eraseGrant` is a flag: apply re-finds the
first grantor through the same predicate the offer used, so a JSON round trip
or a replay cannot desync on a stale bin index. Two Hosts in one bin are
FUNGIBLE — same name, same effect, same pile — so the arbitrary first-match is
not deciding for the player; a second DISTINCT grantor card would make the
choice visible and would then need an index.

**What the grant cannot do is R97's, unchanged:** a {Battle} card stays a
battle card (RAQ "[Solved] Dispatch Courier vs Battle Timing"), a printed
[Haste] card needs no grant (and must not cost anyone a grantor), and "as if
it had [Haste]" is TIMING ONLY — the played unit never carries the attribute.
"A unit" includes a spell unit (RAQ "[Solved] Spell Units played when you can
'play a unit from hand'").

### The card's own play-from-bin line (Trench Stalker)

`CardBehavior.playsFromBin`, offered and applied through the SAME
`playFromBin` action R96 built — `pushBinPlays` and `doPlayFromBin` now accept
either the R96 battle grant (spells only) or the card's own flag. Printed
timing still applies, exactly R42/R45's cache reading: a {Battle} card is
offered in battle priority windows and nowhere else.

**The {Unstable} question, decided and documented:** a card played from a bin
under its OWN line is **NOT stamped {Unstable}**. The R96 stamp is the
GRANTING cards' own text — "If you do, they gain {p}unstable until regroup" is
a sentence on Abyssal Evocation and Spell Excavation, in reminder-text form
"(If they would enter a bin, erase them instead.)" — not a fact about bins.
The Manual's blanket Unstable rule is about MODDED cards (p.35), and Trench
Stalker's line grants nothing of the kind. Encoded in `doPlayFromBin`
(`unstable` is passed only on the grant route) and asserted in its tests.

**The whole-card rule held:** the R49 `castCost: { kind: 'discardCard', n: 2 }`
and R29's `playsIntoFormation` landed in the same commit as the bin action,
per the ledger entry's warning — the cost gates EVERY play of the card (hand
and bin), so the card is no longer strictly better than printed from hand nor
less flexible than printed elsewhere. The cost hangs on a `spellEffect` whose
`run` is empty and unreachable by construction (a `'unit'` StackItem resolves
by spawning; `resolveItem` returns before parts run) — declared in
`NOT_A_GAP` rather than smuggled past the ledger sweep.

### Tests

`42-dark-b` — the haste step engages off the bin grant alone; the offer
carries `eraseGrant` and playing it erases exactly one Host to the erased
pile; the played unit does NOT carry [Haste]; no bin copy → no offer; declining
leaves bin and hand untouched; an opponent's copy grants nothing; a JSON round
trip mid-offer still drives, with two fungible copies. `46-hybrids-ld-c` —
played from bin with the discard-2 paid at cast and the R29 spot taken
atomically (including a mid-cast JSON round trip), arriving WITHOUT
{Unstable}; fewer than two other cards → no offer; from hand the cost and the
formation entry both apply, in both directions of the old vanilla error.
## R124 — 'leftBin': every bin removal goes through one choke point

*(2026-08-24. Engine seam + one card, Rotling.)*

**The gap.** R51 gave a card sitting in a bin a trigger surface (`zone:
'bin'`), but nothing ever fired when a card LEFT one: bins were spliced
directly by some thirty card effects and by engine code (cache, erase-as-cost,
prophesy-from-bin, play-from-bin), so "When I leave your bin, [Switch1] You
may pay [1] to draw a card and gain 1 rot." (Rotling) had an ear and no sound.

**The choke point.** `E.removeFromBin(seat, binIndex, reason)` is now the ONE
way a card leaves a bin. It splices, then fires a `'leftBin'` event with
`data: { seat, card, reason }` — `seat` is the bin's owner, `reason` a short
verb ('recalled', 'revived', 'erased', 'cached', 'played', 'prophesied',
'recycled', 'modded' — an augment or graft applied out of the bin). Every
site in the tree is routed through it — since 2026-08-24 that includes the
two late finds (CARD-TODO #26): a mod applied `from: 'bin'` (apply.ts
`zoneTake`, reason `'modded'`) and the R123 erase-funded grantor (the
Writhing Host bin copy paying for a haste play used to be spliced directly;
it now leaves with reason `'erased'`, and the site's own 'erased' announce
still routes it to the R65 pile, exactly once). A bulk sweep
(Finality's erase-both-bins, Reality Siphoner's recycle-your-bin, Zephyrzoa's
recall-your-bin) fires once **per card**, back-to-front. The event's `msg` is
`''` — signal-only, the `stackFlash` precedent — because every site already
announces the removal in its own words, and the game log should not say
everything twice.

**Dispatch inversion.** For every other zone event, R51's presence test is
"does the zone hold the name?". For `'leftBin'` the subject has by definition
already left, so the presence test is the EVENT itself: the listener fires
exactly when the event names this card out of this seat's bin. That is also
where `self: true` is enforced for zone listeners — another card leaving my
bin is not me — and it makes the pronoun reading concrete: **"your bin" is the
bin owner's.** The seat whose bin the card left is the seat that triggers,
decides, pays and collects, whichever side once played the card.

**The budget (CARD-TODO #21, closed).** A zone firing is anchored on a
throwaway stand-in, so a `bounded` reservation written onto it bounded
nothing — the census in 90-coverage-census kept the combination out of the
pool rather than fake it. The design question it held open — *what does "per
card" (R9) mean for a card that is not in play?* — is answered **per seat per
card name**: a bin holds bare names, not instances, so the name in that seat's
zone IS the card as far as the rules can see (the same reading R51 already
used to give three copies one firing). The reservation lives in
`GameState.zoneBudgets` (keyed `${seat}:${prefix}:${card}#${index}`), written
by `composeParts`' stand-in branch, refunded by `refundPart`'s (so R113 — a
declined "you may" never spends the use — holds from a bin exactly as it does
in play), cleared by `startTurn` beside the `Entity.budgets` wipe, and it
serializes with the state. Additive/optional: a pre-R124 save reads as empty.
The census now pins the POPULATION of bounded+zone abilities instead, so the
next one is checked against this rationale on purpose.

### Tests

`43-dark-c` — Rotling recalled out of the bin by a real recursion effect
(Blightwalker) is offered the pay-[1] and draws + gains rot; declining pays,
draws and gains nothing and does not spend the [Switch1] (R113); another card
leaving is not me, and leaving the opponent's bin triggers the bin owner; the
[Switch1] bounds it once per turn and startTurn refreshes it; erase-from-bin
and cache-from-bin both fire 'leftBin' through the choke point; the pending
decision and the reservation survive a JSON round-trip, and a pre-R124 state
still loads. `04-mods` / `42-dark-b` — the two once-bypassed sites (a graft
and an augment applied from the bin; the R123 grantor erase, which also still
reaches the erased pile exactly once) each fire exactly one 'leftBin'.
`90-coverage-census` — a static sweep fails on any direct bin splice in src/
outside `removeFromBin` itself, so the next bypass fails a test instead of
waiting to be re-found (CARD-TODO #26).

## R125 — "Everything" is literal: Rotspore Herald reaches spells and spell tokens

*(2026-08-24. One card, two attribute channels, no engine change.)*

**The ruling.** Asked whether "Everything is {deadly}" deadly-fies non-unit
damage sources, the owner: *"Rotspore also applies to all spells and spell
tokens. Literally everything in its region. I think you're underestimating
most cards. All the cards in Algomancy are pretty literal."*

**The general principle, which outlives this card**: when a printed text
carries no qualifier, do not invent one. The narrow reading here was not a
considered ruling — it was the shape of the mechanism that happened to be
built first (a `StaticMod`, which is typed over `Entity`), quietly promoted
into a rule about the card. Read the card, then find the mechanism.

**Why one sentence needs two mechanisms.** `dealEffectDamageAll` reads a
damage source's attributes two different ways, and only one of them was wired:

| source | how its attrs are read | channel that reaches it |
|---|---|---|
| unit, spell token (an `Entity` in play) | live `ownAttrs` → `staticsFor` | `statics` |
| a resolving SPELL (no entity at all) | printed `card.attrs` + `EffectCtx.grantedAttrs` | R94 `effectAttrs` |

So the Herald now declares both, each with `affects: () => true` — no
ownership test and no kind test, because the printed text has nothing to hang
one on. `statics` losing its `t.kind === 'unit'` filter is what puts {Deadly}
on a Fireball token standing in the region; `effectAttrs` is what puts it on a
Flame of History resolving there. Both gatherers are already region-scoped
(`a.region === target.region` / `=== ctx.region`), so the SCOPE clause of the
card is inherited rather than re-implemented.

### Tests

`107-semantics-statics` — six, red-checked in both directions (removing
`effectAttrs` reddens the spell and spell-token tests; narrowing `statics`
back to units reddens the spell-token one alone): a unit-sourced effect (the
pre-existing R94 pair), a 1-damage SPELL killing a 7/5 with the Herald in the
region, the same spell merely marking 1 without it, a Fireball 1 spell token
killing the 7/5 and visibly carrying {Deadly} in its own `ownAttrs`, and the
REGION boundary — a Herald at home deadly-fies nothing in the battle region,
asserted on the fixture itself so the test cannot silently stop meaning
anything.

## R126 — "up to N" means you may declare NONE

*(2026-08-24. Two cards, no engine change — found by the literal-reading audit.)*

`TargetSpec.min` defaults to 1, so a spec that prints "up to" must override it.
Twin Flame ("I deal 2 damage to each of **up to** two target units") and Minor
Kraken ("Recall **up to** one target unit with 5 or less defense") did not, and
were therefore FORCED to shoot or recall whenever any legal unit was in reach —
including the caster's own board, which is the case that makes it a real cost
rather than a technicality. Every other card printing the words already spells
it `min: 0` (Prismatic Observer, Necromantic Rebuke, Grob, Nothyr, Lumengrove
Lurker, Delver of the Ephemeral, Malevolent Machinations), so this is the pool
agreeing with itself, not a new rule.

**A fixture rotted with it, and that is the interesting part.** `21-fixes`'s
"multi-target validation" test drove Twin Flame to assert a GENERAL engine
property — "done is offered only after the minimum". Twin Flame was the pool's
only `count: 2, min: 1` spec, and it was that only *because of this bug*. Fixing
the card left the test describing a shape no card has. It is now two tests: the
duplicate-refusal and below-minimum done-gate against **Fight** (a real
`min: 2`), and the "up to" behaviour against Twin Flame itself, which now offers
"No more targets" immediately and completes a cast having shot nothing.

Worth recognising: **a test fixture that has to be a specific card is evidence
about that card.** When the only card with a shape is the card with the bug, the
shape is the bug.

## R128 — anything on the stack is an effect (R60 reversed)

*(Owner ruling, 2026-08-24, verbatim: "R60 is wrong. ANYTHING on the stack is
an effect, including units and spell units. Units aren't spells, so if they say
'spell effect' a unit would be unaffected.")*

### The rule

**`stackEffect` — plain "target effect" — is now LITERALLY every item on the
stack.** No kind test at all: spell, spell unit, spell token, ambush, triggered
ability, activated ability, virus, **and a `{Battle}` unit on its way into
play**. `E.pushStackTargets` no longer computes an `effectish` predicate; it
pushes every item the exclusion (`excludeStackId`, R68) does not skip.

**`stackSpell` — "target SPELL effect" — is unchanged.** Spell / spell unit /
spell token / ambush. A plain unit is not a spell, so the three cards that print
"spell effect" (Dreadwave Devourer, Null Drone, Dream Lapse) still cannot see
it. A **spell unit stays spell-side**: the owner's sentence names "units and
spell units" only to say both are *effects*, and a spell unit is a spell that
becomes a unit — Hush Mush and Jelly are cast as spells and answered as spells.

The spell/nonspell line has therefore not moved; the **effect** line has. The
consequence that matters is the third category:

**"Target NONSPELL effect" is the complement, so it GAINS the plain unit.**
Nothyr ("negate up to one target nonspell effect") restricted to
`triggered | activated | virus` — an enumeration copied out of R60's own
sentence. A unit on the stack is an effect (R128) and is not a spell (the same
sentence), which is precisely what "nonspell effect" names. Nothyr's `restrict`
is now written as the complement — *not* spell / spell unit / spell token /
ambush — so the next kind added to `StackItem` lands on the right side of it
without a second edit.

### What negating a unit does

Nothing new had to be built, and that is worth recording rather than glossing:
`negate()` already handled it, because `NEGATE_BINS` already contained `'unit'`
(R68 put it there for the log line's sake — "a {Battle} unit caught mid-cast is
a real card and has to land somewhere"). The branch was simply unreachable,
since nothing could ever target a unit item. So:

- the item is spliced off the stack the instant the negation resolves (R68);
- **the unit never arrives** — `resolveItem`'s `spawnUnit` call is never made;
- **the card goes to its controller's bin**, from the stack, which is not a
  trash (R40). Unstable/`{Modular}` carriers erase instead, by the same
  `dischargeItem` path as every other kind.

A negated **spell unit** was already reachable and behaves the same way: no
body spawns, the card is binned.

`item.parts.length > 0` is assumed nowhere. Every consumer that walks the
targeted item's parts does so with `.some` / `.forEach` (Boon of Protection,
Divine Intervention, Gravitational Correction, Enigmatic Warder), and a unit
item's `parts` is `[]`, so the walk is a clean no-op — "Monke has no target to
change" — not a crash. Pinned by a test rather than asserted.

### The sweeps: confirmed, NOT narrowed

**Finality** ("negate all other effects"), **Return to Nature** ("negate all
effects") and **Temporal Rift** ("negate all effects, this battle is over")
iterate `[...g.s.stack]` with no kind filter, so they were already catching a
unit mid-cast. The audit had flagged all three as possibly-too-wide *precisely
because of R60*. R128 settles them the other way: the loops are correct exactly
as written and must not be narrowed. Comments to that effect are on all three
cards, because "we looked at this and deliberately left it" is the thing a
future audit needs to know.

The contrast card is **Molten Riftbreaker**, whose despawn clause negates "all
allied **spells**" and does filter by kind. That is right for the same reason:
a unit is an effect but is not a spell. R128 is one sentence with two halves,
and Finality and Molten Riftbreaker are the two halves.

### Deliberately not changed

**`STACK_VIRUS_HOSTS`** (apply.ts) stays `spell | spellUnit | spellToken`. R79
is about what a Virus may be *applied to* — "it's perfectly legal to put the
powerful guy onto a giant fireball you're casting" — which is a permission
about SPELLS, not about effects. R128 made a unit on the stack an effect; the
same sentence says a unit is not a spell, so this set is untouched. (Whether a
virus should be able to ride a `{Battle}` unit mid-cast is a separate open
question, still flagged in R79 as a judgement call.)

### Tests

`test/118-stack-effect.test.ts`, seeds 12800-12806, seven tests. The vehicle is
**Monke** (`m`/1 `{Battle}` Unit — no spawn trigger, so the stack item is a bare
`unit` with `parts: []`, asserted in the fixture itself).

Red-checked by reverting both halves of the fix (the `effectish` predicate in
`pushStackTargets` and Nothyr's whitelist `restrict`): **4 of 7 fail** —
Dematerialize is offered no target at all, the negate never happens, Nothyr's
menu loses the unit, and Gravitational Correction has nothing to point at. The
other three (a negated spell unit, "target spell effect" refusing the plain
unit, Finality catching it) pass in both directions **by design**: they pin
behaviour R128 *confirms* rather than changes, and a green-in-both-directions
test is exactly what "we checked this and did not move it" looks like.


## R132 — a Prismite DOES activate its new resource (R116 reversed)

*(Owner, 2026-08-24, playtest ANBB report #92. One line of engine; a BUFF,
restoring what R116 took away a day earlier.)*

### The card settles it

> "Erase me: Create a non-prismite resource, **then activate it**. Do this only
> during the mana step. {i}(This does not use one of your activations for turn.)"

The second half of a prismite's own line **is an activation**, so the Manual
p.18 affinity bonus is owed on it like any other: activate your third of an
element, take a free dormant Shard. R116 had carved the exchange out.

### Why the old ruling was wrong, which is the transferable part

**R116 never quoted the printed text.** It reasoned from the engine's model —
`doExchangePrismite` mutates a resource in place, so it looked like a "later,
separate" act — and then reached for an analogy (cracking a fetchland) to
justify what the model already did. That is the mechanism deciding the rule,
the same failure as [R125](#r125--everything-is-literal-rotspore-herald-reaches-spells-and-spell-tokens)
(a `StaticMod` typed over `Entity` became "Rotspore only affects units") and
[R128](#r128--anything-on-the-stack-is-an-effect-r60-reversed) ("a unit has no
parts to negate" became "a unit is not an effect").

**The engine was already contradicting itself**, which is the tell to look for
next time: `doExchangePrismite` fires a `'resourceActivated'` event, so every
listener in the game has always been told this is an activation. Only the shard
check was special-cased out of it.

**Caleb's fetchland line survives and is not in tension.** *"'Activating the
prismite' is like playing your land for turn, but cracking the fetchland
doesn't take an additional land drop."* That is about the ACTIVATION
ALLOWANCE — the reminder's "does not use one of your activations for turn" —
which is charged in `doActivateResource` and not here. You get the Shard; you
do not get a second activation. Both halves of the card are now true at once.

### What it looked like at the table

ANBB, 2026-08-24, is the whole argument on one board: Ben reached three dark
affinity **through prismites** and was paid nothing, while Rashi's third fire
came from an ordinary activation and paid. Same board state, two answers,
decided by how you happened to get there. Pinned in `21-fixes` as
`R132: the ANBB position`, asserting both seats on one harness.

### Tests

`21-fixes` — the third copy by prismite pays; a second copy pays nothing (the
bar is affinity, not the prismite); and the ANBB two-seat comparison. The
R116 test is not deleted but INVERTED IN PLACE, carrying the full history of
both reversals, because this test has now flipped twice and the next person
deserves to know that before flipping it a third time.

## R127 — Ancient One copies the whole text box: every channel but attributes

*(Owner ruling, 2026-08-24, in the batch that also produced R125 and R126. It reverses a
bullet R118 wrote in its own "decisions taken here" list.)*

> *"Ancient One technically copies **eeeeverything**, including everything you mentioned.
> It explicitly includes modded abilities. **The only thing it doesn't are attributes**
> (like Piercing or Unstable). It basically just copies **the whole text box** of adjacent
> allies (so only during combat) right in its text box."*

Printed: *"[Augment] I have all abilities of adjacent allies. {i}(This includes modded
abilities.)"*

And the principle he gave with it, which is why the answer came back this way:

> *"Don't assume that cards are limited, they're designed to be open ended and interact in
> novel and interesting ways… Algomancy is inherently a creative, synergistic game."*

### What was wrong

R118 built the copy layer with a facet enum — `name | stats | attrs | statics | activated |
triggered` — and then wrote down, as a deliberate decision, that the *other* things a card
carries are not copied:

> *"A copy does NOT carry the radiating-permission families — `costMods`, `effectAttrs`,
> `amountMods`, `playPermissions`, `modPermissions`, `mustBeTargeted`. They read
> `this.card(holder.card)` in six `anchored()` walks of their own and **no card in the pool
> needs them copied today**. Routing them through `facesWith` is mechanical when one does."*

Ancient One is that card, and always was. Worse, "six" undercounted: the **seven `replace*`
hooks** (`replaceRotDamage`, `replaceCombatDamageToPlayer`, `replaceLifeGain`,
`replaceCounters`, `replaceTokenCreation`, `replaceTokenBatch`, `replaceCardStep`) read
`this.card(holder.card)` in seven more walks of exactly the same shape. So an Ancient One
standing next to **Tranquility**, **Flux Resonator**, **Gatekeeper of Souls**, **Counter
Thief**, **Automaton of Abundance**, **Cosmic Conspirator**, **Crevice Lurker**, **The
Silent**, **Rook**, **Dispatch Courier** or **Conduit of Pain** borrowed *nothing* from
them — while borrowing the statics and activated abilities of the ally beside it.

### The ruling, as built

`CopyFacet` gains one member, **`behavior`**, and it means *everything a card radiates from
play that is not a static, an activated ability, a triggered ability, or an attribute*:

```
costMods · effectAttrs · amountMods · modPermissions · playPermissions · mustBeTargeted
replaceRotDamage · replaceCombatDamageToPlayer · replaceLifeGain · replaceCounters
replaceTokenCreation · replaceTokenBatch · replaceCardStep
```

The list is **closed by exclusion, not by enumeration**: anything a `CardDef` grows later
that radiates from a unit in play belongs in `BEHAVIOR_CHANNELS`, because the owner's
sentence is about the *whole text box* and names exactly one thing it leaves out.

Ancient One's projection is now `facets: ['statics', 'activated', 'behavior']`. All
thirteen walks read their clauses off `E.facesWith(holder, 'behavior')` — through two
helpers that keep `staticsFor`'s rule from drifting thirteen ways:

| helper | job |
| --- | --- |
| `E.behaviorFaces(holder, anchor)` | the faces this radiator's clauses come off: a unit reads its identity face (the **copied** card when it wears one) plus everything projected onto it; an augment **mod** reads only its own card, because a mod is never copied and a projection lands on its HOST |
| `E.donates(holder, anchor, key)` | the `anchored()` presence predicate — own card first (a single property read, which is still the whole answer on any board with no copy layer), the face walk only if that misses |
| `E.donorFaces(holders, key)` | flattens a sorted holder list into one entry per candidate CLAUSE, which is what the "first to claim it consumes the event" hooks actually iterate |

**Log lines now name the FACE**, not the physical card — `staticsFor`'s `from: face` rule,
for the same reason: the text box has to name the card the clause is printed on.

### ATTRIBUTES are the one exclusion, and they were already excluded

*"The only thing it doesn't are attributes (like Piercing or Unstable)."*

`attrs` stays a `CopyFacet` of its own and is **not** in Ancient One's `projects` list. It
has to stay a facet, because the R118 copy layer proper still uses it: a **Borrower of
Forms** that becomes a Good Whale really does gain {Piercing}, and an **Apex Prime** copy
carries the attributes of what it copied. The engine enforces the split in two places at
once — `E.ownAttrs` reads `faceDef(e).attrs`, i.e. the **identity face only**, and Ancient
One simply does not declare the facet. {Unstable} rides along with it: `E.isUnstable` reads
`faceDef(e).unstable` and the copy-modded flag, neither of which a projection touches.

### "So only during combat" needs no gate

It is already true by construction, and adding a phase check would be a redundant second
statement of the same fact. `E.adjacentInFormation` opens with:

```ts
const b = this.s.battle;
if (!b) return [];
```

so `aoBorrowedFaces` returns an empty list outside a battle, the projection contributes
nothing, and every channel falls back to the Ancient One's own (empty) text. The tests
measure it from the other side: kill the neighbour mid-combat and the borrowed clause is
gone in the same instant, because a projection is **re-evaluated on every read** and never
stamped (R118's reason for `projects` existing at all).

### Reentrancy: nothing new was needed, and here is why

Widening the channel makes new re-entry paths *reachable* — a borrowed `costMod` asking
about a cost, a borrowed `replaceCounters` placing counters. Every one of them lands on a
latch that already existed, because the widening reuses the existing walks rather than
adding new ones:

* `inCostMods`, `inEffectAttrs`, `inAmountMods`, `inModPermissions`, `inPlayPermissions` —
  a nested query answers the identity-only/zero answer, exactly as before;
* `inReplaceCounters` — the latch R104 added precisely because Counter Thief's redirect *is*
  a counter placement. A borrowed thief re-enters it and stops at the same door; the R127
  test drives that path;
* `inTokenBatchSettle` — the extras a batch replacement creates are not part of their own
  batch;
* `inFaces` — the `projectedFaces` latch, and it is **released before any borrowed clause
  runs**: `behaviorFaces` returns a list of names, and the callbacks are invoked outside it.
  So a borrowed clause gets the ordinary (not the shallow) answer to anything it asks;
* `aoScanning`, the card-level latch that stops two adjacent Ancient Ones mimicking each
  other, is untouched — it guards the TRIGGERED half, which R127 does not go near.

**No new latch was added**, and the whole-pool card drill and the fuzzer both run clean.
Saying so is the point: the instruction was to guard a genuine infinite recursion the way
the existing latches do *and say so*; there was none to guard.

### Deliberately NOT routed through the face layer

Five one-line permissions read `this.card(name)` and stay that way, because every one of
them is asked of a card that is **not in play**, and a projected face only exists for an
entity standing in a formation:

| flag | read of a card in | why a projection can never reach it |
| --- | --- | --- |
| `noPlayFromHand` | the HAND | no adjacency in a hand |
| `prophesyFromBin` | the BIN | no adjacency in a bin |
| `playsFromBin` (R123) | the BIN | ditto |
| `binPlayPermissions` (R123, Writhing Host) | the owner's BIN | `anchored()` does not walk the bin at all |
| `playsIntoFormation` (R29) | a STACK item | the card is mid-cast, not a unit |

`playPermissions` and `modPermissions` *are* routed, because a copy-layer identity face can
carry them — but note the timing: R97's haste step runs before any battle, so an Ancient
One can never in practice borrow **Dispatch Courier**'s grant (there is no formation yet),
while R95's `mayAugmentInBattle` is battle-timed and genuinely reachable. Both are
OR-folded or budget-summed per grantor, so a borrowed copy of a grantor already on the
board is usually invisible — which is why the tests pin the four channels where a second
radiator *is* observable.

### Consequences worth naming

* **An identity copy now carries the behaviour channels too.** `behavior` is in
  `FULL_FACETS`, so a Borrower of Forms that became Tranquility taxes spells — and, because
  a face REPLACES, it stops radiating whatever its physical card printed. That is R118
  ruling 1 applied to a channel R118 had left reading `Entity.card`.
* **`E.facesOf` enumerates `behavior`** with the other projected facets, and
  `ui/cardtext.ts`'s projected-face loop gained it too — so a projection that donated
  *only* behaviour channels would still appear in the text box, attributed to the face it
  came from. (Ancient One's faces were already listed via the `statics` facet, which it
  projects for the same faces; the loop is widened so that stays true by construction
  rather than by coincidence.)
* **The clause reads "I" as the mimic.** A borrowed Gatekeeper of Souls makes the **Ancient
  One** must-be-targeted; a borrowed Counter Thief steals the counters onto the **Ancient
  One**. That is `anchored()`'s existing contract (a clause reads from its anchor) and it
  is what "right in its text box" means.

**Tests:** `117-copy-everything` — four channels (`costMods` via Tranquility, `amountMods`
via Flux Resonator, `mustBeTargeted` via Gatekeeper of Souls, `replaceCounters` via Counter
Thief), each asserted adjacent *and* two columns away on the same geometry, two of them
also asserted going dark the instant the neighbour dies; plus the negative test that an
adjacent Good Whale's {Piercing} does **not** cross while a Tranquility on the other side
of the same Ancient One does. Red-checked: dropping `'behavior'` from the projection fails
all five; adding `'attrs'` to it fails the negative one alone.

## R129 — a spell token is a token, and a unit is a card: two events that were logged but never fired

*(2026-08-24. Two owner rulings, one shape. Both halves were the same defect:
the engine already KNEW the thing had happened — it had written a line about it
— and no card could hear it.)*

**The two rulings, verbatim.**

> *"Spell tokens are still tokens."* … *"Don't assume that cards are limited,
> they're designed to be open ended."*

> *"Everything is a card, including units. Tokens are NOT cards, however."*

### (a) 'tokenCreated' is now DISPATCHED, not just logged

`E.createSpellToken` built a `tokenCreated` event and pushed it onto the log
without ever calling `fireEvent`. `tokenCreated` has been a real `EventType`
since the beginning; nothing had ever fired it. So **Mycelial Mentor** ("When
you create a token, [Switch1] Target ally gains +3/+3 until regroup") worked
for half of what it prints: a UNIT token spawns and fires `spawned`, which the
card listens to, but a Poison, a Crystal or a Fireball fired nothing at all.

"A token" carries no qualifier, and the set proves the reading itself — **Cosmic
Conspirator** prints *"if you would create a Robot, POISON, CRYSTAL or
FIREBALL"* in one breath, and the wood-b batch mints Poisons on four cards.

**This is the R125 shape, and it is why nothing caught it.** Half the card
worked. A sweep that asks "does this card do anything?" gets a yes.

**The risk was never the event — it was the other listener.** Once
`tokenCreated` really fires, every card that means *unit* token has to say so.
The pool has exactly one: **The World Shepherd**, "[Augment] Whenever a UNIT
token is created, put a -1/-1 counter on me. If you do, put +1/+1 counter on
that token." A Poison is not a body; it has no stats and could not take the
+1/+1 the second sentence puts on it. Three independent things keep it out, and
the R129 test pins all three rather than trusting any one of them:

1. **The event.** The Shepherd listens to `spawned`, which a spell token does
   not fire.
2. **The payload.** `tokenCreated` carries `id`, never `unit` — deliberately.
   Every unit-token listener in the pool identifies its subject as `data.unit`,
   so that key is the fence. (Firing with `unit: t.id` "for payload parity" is
   the plausible wrong fix; the test fails on it.)
3. **The entity.** A spell token is `kind: 'spellToken'` and carries no `token`
   flag, so `!!u.token` is false even for a listener that does reach it.

Each creation fires exactly ONE of the two events, so a card that means *every*
token can safely list both (Mycelial Mentor does) without double-triggering.

### (b) 'cardPlayed': a {Battle} unit and an Ambush are cards being played

`commitItem` fired `spellPlayed` for `spell` / `spellUnit` / `spellToken` only.
A {Battle}-timing UNIT and an AMBUSH each pushed a stack item **with no play
event at all** — so **Void Mandible** ("[Augment] When a nontoken CARD is played
during battle, sacrifice me. If you do, negate that effect.") could not see
either. Its printed noun is *card*, and under the owner's ruling that noun
includes units. Five {Battle} unit cards and five Ambush modes walked past it.

**The decision, and it is the load-bearing one: `cardPlayed` fires ALONGSIDE
`spellPlayed`, it does not replace it.** `spellPlayed` keeps its exact current
meaning — spell, spell unit, spell token, with `token: true` on the last — so
not one of the ~15 "when you play a spell" cards changed behaviour, and the
change cannot leak. `cardPlayed` is the wide event and Void Mandible is the only
card moved onto it. A spell therefore fires both; that is intended, because a
spell is a card.

`CARD_PLAY_KINDS` (in `cards/dsl.ts`, so card files can reach it without a
runtime import of the engine) is the membership, and the exclusions are as
deliberate as the inclusions:

| StackItem kind | fires `cardPlayed` | why |
| --- | --- | --- |
| `unit`, `spellUnit`, `spell`, `ambush` | **yes** | a card being played |
| `spellToken` | no | *"Tokens are NOT cards"*; R59 — cast from play, not played |
| `virus` | no | **R37**: applying a mod is not playing a card |
| `triggered`, `activated` | no | not plays at all |

R37 is untouched and re-pinned by test: a Virus applied during battle produces a
`kind: 'virus'` stack item and fires **neither** event. It does not reach
`commitItem` at all today (`doAugment` pushes it straight onto the stack) — the
kind is named in the exclusion list so that stays true if it ever does.

The event is **signal-only**: `msg` is `''`, the `leftBin` (R124) precedent. Every
play already announces itself on `spellPlayed` or on the `spawned` line, so
`cardPlayed` adds no log line anywhere and no existing log assertion moved.

### What was deliberately NOT changed

- **`playInline`** (batch-water-a) fires a hand-rolled `spellPlayed` for a card
  played by another card's effect. It never goes through `commitItem`, so it
  does not fire `cardPlayed`. Widening it is a card-side change with its own
  blast radius and is not part of this ruling.
- **Ancient One's** `AO_EVENTS` gained `'cardPlayed'` — one entry, and only
  because Void Mandible's augment text moved onto that event and the Ancient
  One must still mimic an adjacent ally wearing one.
- **The two cards that hand-roll the union.** **Stalwart Sentinel** and
  **Proph** already listen to `['spellPlayed', 'spawned']` to mean "a card was
  played", with a `kind` check so a spell unit is counted exactly once. They
  were deliberately left alone, and not only for diff hygiene: **they are asking
  a different question.** A unit's `spawned` fires at RESOLUTION, so those two
  count units that actually ARRIVED; `cardPlayed` fires in the cast window,
  before the item is even on the stack, so it counts units that were PLAYED —
  a negated {Battle} unit fires `cardPlayed` and never fires `spawned` at all.
  Void Mandible needs the early one (it has to answer the play, not the body);
  a "put counters on me when you play a card" trigger arguably wants the late
  one. Folding them together is a separate ruling, not a tidy-up.

## R130 — every counter is a counter, and a placement carries its actor

*(2026-08-24. One engine parameter, three cards, two approximations retired.)*

**The ruling**, verbatim: *"All counters count as counters."* No sign filter,
ever. It is R125's principle applied to a noun: the printed word is "a
counter", so a card that says it does not get to mean "a -1/-1 counter".

**The bug underneath the sign filters was not narrowness — it was a missing
fact.** Three cards print an ACTOR ("when **you** put", "by an **allied**
source") and `E.addCounters(target, n)` had no source parameter, so each of
them had picked a proxy for the actor out of what the event did carry. The
proxies were wrong in both directions at once:

| card | printed | read as | wrong when |
|---|---|---|---|
| Wandering Blightshell | "when **you** put **a counter** on an enemy" | -1/-1 counters landed on an enemy unit | an opponent shrinks their OWN unit (draws me a card); I grow an enemy (draws nothing) |
| Scrapyard Custodian | "when **you** put one or more counters on an ally" | counters landed on an ally, by anyone | an opponent poisons my unit and I am paid for it |
| Flux Resonator | "counters put on a unit **by an allied source**" | counters put onto an allied UNIT, positive only | an opponent's counters on my unit get my plus-one; my counters on THEIR unit do not |

**The parameter.** `addCounters(target, n, by?: Seat)`. It reaches exactly two
places: `AmountCtx.sourceSeat` (the field the amount layer has had since R104,
which Conduit of Pain's identical "by an allied source" already reads on the
damage path) and `by` on the `countersChanged` event. Nothing else changes —
`inReplaceCounters` still latches the redirect, the amount layer still runs
before it, and spawn counters still fold in at `spawnUnit`.

**`by` is OPTIONAL, and its default is the seam that made this a small
change.** `resolveParts` publishes the resolving item's controller as
`partActor` for the duration of one `def.run` — `partChoose`'s sibling, saved
and restored on the same two lines — and `addCounters` falls back to it. Every
counter a CARD places is placed by a resolving effect, so the 52 card call sites got
the right actor without being edited. Explicit `by` is for the caller who
knows better and for white-box tests, which have no resolving part to inherit
from.

**An UNKNOWN actor is not a yes.** `by` is genuinely absent for engine sweeps
and raw `new E(state).addCounters(...)` calls, and `undefined` is a real
answer: "nobody in particular put this" is not the same statement as "you did".
A card asking WHO gets no for an answer rather than a guess — which is why the
white-box calls in `87-replacement-layer` and `27-metal-b` now name their seat.

**A SPAWN's own counters have no putter**, so the answer was chosen rather than
found: `spawnUnit` passes `sourceSeat: seat`, the creator of the token. It
reaches the AMOUNT layer only — an allied Flux Resonator still makes a Robot X
enter as X+1 (report #88) — and fires no `countersChanged`, so no "when you put
a counter" trigger sees a spawn, exactly as before. A REDIRECT does not change
the actor either: counters you aimed at one unit and a Counter Thief moved to
another are still counters you put.

**The sign filters that stayed.** Pestilent Mycelion ("whenever one or more
**-1/-1** counters are put on a unit") prints its sign, and Flowstone
Arcanite / Blightmound read a negative `countersChanged` in a combat sub-step
to recognise {Poisonous} damage — a fact about the damage channel, not a
reading of a card's noun. Both are correct as they stand. Flux Resonator's
`amount > 0` was the third and it was not printed: "that many counters plus
one" is one more of the same thing, the `step` idiom Proliferating Slime (the
same clause from the other side) has always used. It cuts both ways — your own
-1/-1s deepen too — and nothing prints that the clause only helps.

### Tests

`120-counter-attribution` — twelve, red-checked one seam at a time. Reverting
the Blightshell predicate reddens 5 (both directions, the [Switch1] bound, the
unattributed case and the real-card path); reverting Scrapyard Custodian
reddens 1; reverting Flux Resonator reddens 3; dropping the `partActor`
default reddens the 2 that drive real cards (a Crystal cast by me on an enemy,
a Poison cast by the opponent on their own unit); dropping `by` from the event
and from `AmountCtx` reddens 9.

## R131 — "another" is a different ENTITY, not a different card name

*(2026-08-24. Owner ruling + one engine seam + two cards, Rotbeast and
Blightwalker.)*

**The ruling, verbatim.** *"All other/another cards should work based on 'game
state tracking UUID' (or whatever we use). It only cares about the other thing
being a different entity."*

So an "other"/"another" clause **never** filters by CARD NAME. Two copies of a
card are two things, and each is "another" to the other. Excluding by name
excludes every copy — one card's worth too many — and it is the reading that
*shuts interaction down*, which is exactly the habit the same day's rulings
memo names: *"Don't assume that cards are limited, they're designed to be open
ended and interact in novel and interesting ways."*

**The three identities.** The comparison to make depends on where the thing
lives, and this engine has exactly three shapes:

| where | identity | how |
| --- | --- | --- |
| in play | `EntityId` | `notSelf` / `ctx.sourceId` — already right |
| a MOD's donated text | the mod's own `EntityId` | `ctx.selfModId` (new) |
| a BIN | `(card name, nth occurrence)` — a `BinRef` | the `'trashed'` event's `binNth` (new) |

**The mod case (Rotbeast).** *"[Augment] After combat, move all my other
Augments onto one or more enemies."* The text is printed on a card that is
being worn as a mod, and "my" means the HOST — which is exactly why the trigger
records `host.id` and nothing else. Donated text therefore had no way to name
its own mod entity, and the implementation fell back to `m.card !== 'Rotbeast'`:
a host wearing two Rotbeast augments moved **neither**, because each firing
filtered out the other Rotbeast along with itself. (Its comment even claimed
"one instance is filtered out" while the code filtered every instance — a fact
about the code mistaken for a fact about the card, the same shape as R124's
Rotling comments.)

The fix is one optional field threaded end to end: `PendingTrigger.selfModId`
→ `StackItem.selfModId` → `EffectCtx.selfModId`, set by the mod branch of
`fireEvent`'s scan and read through the `isSelfMod(ctx, e)` helper. Undefined
for a card's own text and for R63 granted text, which is right: no mod carries
those, so nothing is excluded — a Rotbeast played normally as a unit dumps
every augment on it, because a unit is not one of its own Augments.

Two Rotbeast augments now do something instead of nothing: each trigger moves
whatever is on the host but itself, so #1 carries #2 to the enemy and #2 — which
reads the host live (R1) — then carries #1. The pool got a new interaction back
that a name comparison had quietly deleted.

**The bin case (Blightwalker).** *"When I am trashed, [Switch1] You may pay [2]
to recall another target unit from your bin."* A bin holds bare card NAMES —
there is no entity, so there is no uid to compare, and this is the case the
ruling's "UUID" does not literally reach.

It did not need a new identity, because **the repo had already answered this
question and written down why**. R64's `BinRef` is `{ seat, card, nth }`, with
the rationale printed in `types.ts`: *"copies of one card there are genuinely
indistinguishable — the card name plus which copy IS the whole identity"*.
(R124 made the same per-seat-per-NAME call for `zoneBudgets`.) So "another" in
a bin means **one SLOT excluded**, not one name, and the only missing piece was
*which* slot — the trigger knew the card's name and nothing about where it
landed.

`E.noteTrashed` now stamps it: the `'trashed'` event carries `binNth`, the
occurrence index of the copy that was just trashed. Every trash path in the
tree pushes the card into the bin *before* firing (`toBin`, `destroy`,
`leavePlay` + `afterDespawn`, Hooba-Mon's exchange), so the LAST occurrence of
that name is this instance. The restriction reads it through
`notSelfBinCard`, which is legitimate under R67 — a triggered ability's
targeting restriction may read the event that fired it.

**What this does NOT close, honestly.** `binNth` is a *position*, not a uid, and
it inherits `BinRef`'s slide: if an earlier copy leaves the bin between the
firing and the target choice, the ref points at whichever copies remain. That
is deliberate and consistent — copies of one card in a bin are interchangeable
by the repo's own rule — but it is a weaker guarantee than an EntityId, and it
would break if the game ever needed a bin card to be distinguishable from its
twin (a bin card carrying counters, a mod, or a prophecy would need one; a
`CachedCard` already has a `uid` for exactly that reason). **If that day comes,
the fix is to give bin entries the shape cache entries already have — a record
with a uid — not to bolt a second identity onto the event.** Until then, one
slot excluded is the whole of what "another" means here.

**Swept, and what came back.** `grep -rn "\.card !== '" src/cards/sets/` found
five name comparisons and no more; `notSelf`'s two users were already correct.
The other three (Amphivore, Witness of the Crossing, Lost Guardian) were
LOG-LINE counts inside the R110 graft multipliers, and they were wrong in both
directions at once: excluding their own name over-excluded a second copy of the
same multiplier, and under-excluded a *different* multiplier — which
`composeParts` skips anyway ("never multiply a multiplier"). They now ask
`isGraftMultiplier(m.card)`, which is the question the engine actually answers
and mentions no name at all.

One near-miss is deliberately **not** changed: Earthbound Replicator and its
kin find the spell that was just played with
`g.s.stack.find(i => i.card === name && i.controller === seat)`. That is a
lookup for the event's own subject, not an "other" exclusion, so R131 has
nothing to say about it — but it is a name comparison standing in for an
identity, and two identical spells on one stack would confuse it. Its own
ruling, if anyone wants it.

Pinned by `test/121-another-identity.test.ts`.


## R133 — tokens are NOT cards, and trashing never needed them to be

*(Owner, 2026-08-24. No behaviour change: a REASONING repair.)*

### The ruling

> "Everything is a card, including units. Tokens are NOT cards, however."

and, asked directly whether that pulls trashing back with it:

> "Tokens are trashed, yes."

### Why both are true at once

[R40](#r40--trashing-a-card-entering-a-bin-from-anywhere-but-the-stack)'s
2026-08-21 amendment made tokens trashable and listed three premises. The
FIRST was "tokens are cards", and it is now dead. The other two never depended
on it:

- a dying token **really does enter the bin** before the state-based sweep
  erases it — Caleb, *"yes, for the purposes of triggers"*, and *"Technically
  it does enter your hand and then gets erased immediately"* (R69);
- the only printed wording that restricts trashing to a **nontoken** card is
  the reminder text of **Void Scavenger, a card CUT from the set**.

So the rule is: **trashing is defined by the DESTINATION, not by the object.**
Anything entering a bin from anywhere other than the stack is trashed. A token
qualifies not because it is a card but because it goes to the bin.

### Void Mandible's "nontoken card" is shorthand, and provisional

Void Mandible is the ONLY card in the pool printing "nontoken **card**" — the
other 25 "nontoken" cards qualify *spell*, *unit*, *ally* or *enemy*, all
things a token genuinely is. That lone exception looked like evidence that
tokens ARE cards. The owner's answer:

> "I think Void Mandible is just trying to save space (card < unit or spell).
> And its a new card, so might be changed"

So "card" there means "unit or spell", chosen to fit the text box — and the
wording may not survive. **Do not build a rule on that card's noun.**
[R129](#r129--a-spell-token-is-a-token-and-a-unit-is-a-card-two-events-that-were-logged-but-never-fired)
already implements it as unit + spell + ambush with spell tokens excluded,
which is what the shorthand means, so nothing changes.

### The lesson, which is the third time today

R40 kept the right answer while carrying a premise that had died. That is the
same failure as [R116](#r116--an-exchange-is-not-an-activation-no-affinity-shard-for-a-traded-prismite)
(reasoned from the engine's model instead of the card) and
[R125](#r125--everything-is-literal-rotspore-herald-reaches-spells-and-spell-tokens)
(a type signature became a rule): **a conclusion can outlive its argument, and
a dead premise is load-bearing for whoever reads it next.** When a ruling is
reversed, walk its dependants and repair their reasoning even where the
behaviour is already correct — the comment in `E.noteTrashed` quoted the dead
premise verbatim and would have taught the next reader the wrong rule.

## R137 — an {Unstable} unit that dies IS TRASHED: it passes through the bin, then is erased

*(Owner, 2026-08-24, from playtest report #93 / room ANBB. **This ruling
DIVERGES from the printed reminder text and from a direct Caleb ruling.** Both
are quoted below and neither is being reinterpreted away — the owner overruled
them, the way [R106](#r106--stat-layer-6-unaware-everything-in-the-interaction-reads-at-printed-stats)
diverged from Caleb and the divergence was recorded rather than buried.)*

### The report

> "I'm pretty sure we're doing death and trashing wrong for Unstable units.
> Dropslime wouldn't make sense otherwise. But here, it died and I didn't get
> its trigger or the other one."

Room ANBB replays FAITHFUL under the engine of the day, and **Dropslime
demonstrates both halves of the bug by itself** in one battle:

| what happened to it | log | trigger |
|---|---|---|
| discarded from HAND, unmodded | `Ben trashes Dropslime (from hand).` | fired — 2 damage to Rashi |
| in play, grafted a Wraith by Plague Ritual → {Unstable}, blocked, took lethal | `Dropslime dies — Unstable: it and its 1 mod(s) are ERASED.` | **nothing** |

On that same combat-damage step an unmodded **Thoughtripper** died, binned,
trashed and fired correctly. Two disposals that look identical to a player,
behaving differently.

### The ruling

**An Unstable card that dies enters a bin, is trashed there, and is only then
erased.** Structurally identical to the TOKEN path the engine has run since
[R69](#r69--a-token-entering-a-zone-is-really-there-then-a-state-based-sweep-erases-it-and-unstable-is-tested-first):

1. the card is pushed into the bin (`binTo`'s bin when a card redirects it);
2. `died` fires, and its listeners see the card sitting in that bin — `to` is
   `'bin'` for every death now, Unstable included;
3. `noteTrashed` fires `trashed`, bumps the per-battle ledger and queues the
   card's own "when I am trashed" trigger;
4. the state-based sweep (`E.eraseFromZone`, through R124's `removeFromBin`)
   takes it back out and records it in the public erased pile (R65);
5. only now does anything queued in 2 or 3 resolve.

**The destination a player sees is unchanged.** The bin is empty again before
anybody can look, and every existing "it does not reach a bin" assertion in the
suite still passes. What changed is what happens *on the way*.

### What this diverges from, in the sources' own words

- **Printed reminder text**, on both cards that GRANT {Unstable} (Abyssal
  Evocation, Spell Excavation): *"(If they would enter a bin, erase them
  instead.)"*
- **Caleb, 2025-04-08**, asked the exact graft-and-death-triggers version:
  *"Unstable units still die, they just get erased instead of ending up in the
  bin."*

Both describe the **destination**, and both read naturally as "no bin,
therefore no trash". That reading is what the engine implemented until today,
and it is not a misreading — it is the plain sense of the text.

### Why the owner ruled against them anyway

The engine already says **exactly the same words about a token** and still runs
it through the bin:

> "Technically it does enter your hand and then gets erased immediately… So it
> would trigger any 'enters hand' stuff. Similar to how tokens can 'die'."
> (Caleb 2025-06-15, on tokens)

A dying token is binned, trashed, and swept to the erased pile. A dying
Unstable card ended in the *same erased pile* by a different rule, and so two
disposals that are indistinguishable at the table behaved differently. #93 is
what that costs: the same card, in the same battle, trashing from hand and not
trashing from play.

So the rule is the one [R133](#r133--tokens-are-not-cards-and-trashing-never-needed-them-to-be)
stated and did not finish applying: **trashing is defined by the DESTINATION,
not by the object.** Unstable was the last object still exempt.

### The mods ride with it

A nontoken mod on the dying carrier is **binned, trashed and swept too**. ⚠ The
ANBB log cannot settle this — the mod there was a Wraith, a token, which has no
card to trash either way — so this is reasoning, stated so it can be overruled
cleanly:

- when the carrier is **recalled or cached** instead of killed, its nontoken
  mods already go to their owners' bins FROM PLAY and R40 already trashes each
  one (`leavePlay` + `afterDespawn`, R70, Caleb 2024-09-15);
- so if a *death* skipped that trash, the same mod card would behave
  differently depending on how its host left play — which is the exact shape of
  the bug this ruling removes.

A **token** mod still has no card of its own (R69): never binned, never
trashed, erased-pile record only.

### Pull Under keeps its override

Pull Under prints *"Delete target unit. If you do, put it and all of its mods
into your bin"*, and the engine's long-standing reading is that the card's own
destination wins over the Unstable erase. That override used to be card code
doing its own `toBin` after `destroy()` erased everything and fired no trash.
Under R137 `destroy()` already bins and trashes, so the override is now the
single flag `destroy(u, verb, { binTo, keepBinned: true })` — "do not run the
sweep". Left as it was, the card would have binned and trashed every card
**twice**. A token victim is still swept: this card moves *cards* into a bin,
and a token has none.

### The blast radius, which is larger than the report

**Family A — the card's OWN "when I am trashed" trigger**, dead on every
Unstable death until now: Afflicting Anima, Blightwalker, Dropslime, Maw of
Despair, Nothyr, Thoughtripper.

**Family B — watchers of someone else's trash.** These eight have been silently
**under-triggering on every modded-unit death in every game ever played**, and
nobody reported it because you cannot see a trigger that does not happen:
Cerebrox, Cthyrian Culler, Cthyrian Rector, Muck Rummager, Murkdrop Distiller,
Murkstalker, Splort, Unrelenting Horror.

**Two cards reach back into the bin for the card they saw trashed**, and under
R137 an Unstable card is in the bin only for the trigger window. Neither
needed a new answer — the TOKEN path has faced this since R69 and both cards
already handle it:

> ⚠ **That last sentence was wrong, and
> [R140](#r140--a-responder-that-reaches-back-into-a-bin-must-name-the-copy-the-event-named)
> fixes it the same day.** Both cards "handled it" by asking the bin *"is there
> a card of that name here?"*, which gives the right answer only when there is
> no OTHER copy of that name in the bin. With an innocent older copy resting
> there, the Rector recalled *it* and the Distiller cached *it*. The two
> paragraphs below are still correct about what should happen when the trashed
> copy is gone; they were wrong that the cards could tell.

- **Cthyrian Rector** ("sacrifice me. If you do, recall that card from your
  bin") pays its sacrifice — a CAST cost (R73), settled on the way to the stack
  before any bin lookup — and then finds nothing, saying so. Deliberate: the
  alternatives are refunding a paid cost after the fact (no mechanism, and R73
  exists to avoid needing one) or recalling out of the **erased pile**, which
  must never become reachable, because that pile is how a card leaves the game
  permanently (R65).
- **Murkdrop Distiller** ("[once] … you may cache it") finds nothing to cache
  and — R108/R113, *"a [once] is spent only when the ability does something"* —
  **refunds the use**, so a real trash later the same turn still gets the offer.

### ⚠ A consequence worth knowing before it surprises somebody

A Family A card that dies Unstable **cannot leave itself in the bin**. Trashed
from hand, Dropslime rests in the bin and can be recurred; trashed by dying
Unstable, it fires its trigger and is then erased out of the game. The trigger
is the same; what is left behind is not.

### Spells are untouched

A virused spell leaving the stack (R79) is Unstable and is erased, and it is
**not** trashed — not because of Unstable, but because **nothing coming from
the stack is ever trashed** (R40). `E.dischargeItem` is a different path from
`E.destroy` and this ruling does not reach it.
## R139 — an amount rides INSIDE one decision option: the counter-removal pick

*(Owner, 2026-08-24. BL-25. An affordance complaint that turned out to be a
DECISION PROTOCOL change — the reason it is written up here and R136 (the
one-line badge strip) is not: nothing outside the client could observe R136,
whereas this changes what the engine offers, what it accepts, and what a card
may declare.)*

### The ruling

> "It's actually okay, it's just not clear that it wants you to click the unit.
> It needs to say that. Plus maybe a counter with up/down arrows would be nice
> too or an 'All' button which jumps the count to the max (without auto
> submitting) for cases where there are a ton of counters."

**"Actually okay" is a constraint, not a compliment.** The mechanism —
[R64](#r64--a-bracketed-cost-is-paid-at-cast-a-printed-restriction-is-a-targeting-restriction)'s
"[Remove X +1/+1 counters from allies]" paid at cast, one pick at a time — is
not redesigned. What is added is labelling, a stepper, and an "All" button.
**"All" SETS the count and does NOT submit**, and that is the whole point: on a
unit carrying a lot of counters you want to see the number before you spend
them.

### The fourth bug, which nobody reported: clicking the unit did nothing

The owner said the prompt "isn't clear that it wants you to click the unit".
The prompt was not merely unclear — **the unit was inert.** A counter-removal
option names its unit as `{counterFrom: id}`, while `decisionOptionIndex` and
`isCandidate` in `ui/main.ts` matched only `{unit: id}`. So the unit standing on
the board was neither highlighted nor clickable, and the only way in was its
card scan down in the prompt bar, under a prompt that named the COST
("remove X +1/+1 counters from allies") and never the ACTION. The affordance
existed and was invisible; the obvious thing to click was broken.

Stated plainly because it generalises: **a decision option that names an entity
in its own namespace is invisible to every board-side lookup keyed on
`{unit:}`.** BL-24 hit the mirror image of this in `optionPingId` (a bare number
under the wrong decision kind pinged whichever entity happened to own that id).
Both are the same hazard — option payloads are per-decision namespaces, and the
board's ref shape is only one of them.

### Why a client-side stepper is unsound, and why this had to reach the engine

The obvious implementation is a count in the client that sends the same
decision N times. **It cannot work the moment the game is on a server.** A
`decide` action carries an option **INDEX**, not a value; the cost collector
rebuilds the whole menu after every payment (a unit that ran out of counters
leaves it, the "that's enough — X = k" option renumbers); and `ui.sentFor`
refuses a second intent against a state already spent. Sending 5 would pay 1 and
silently discard 4 — or, worse, pay the 2nd through 5th against re-numbered
options and take counters off units nobody clicked.

So **the amount has to live inside one option**, which makes a quantity control
an engine change and not a UI change:

- `castCostOptions` emits one option per **(unit, amount)** pair where it used
  to emit one per unit: `{counterFrom: id}` for one, and
  `{counterFrom: id, n: k}` for k up to `min(u.counters, owed)`.
- `payCastCost`'s `counterFrom` branch takes `n` and **clamps** it — to the
  unit's own counters and, for a fixed cost, to what is still owed. Clamping
  rather than refusing is deliberate: the client's stepper carries ONE count
  across several allies with uneven counters, which is exactly the board being
  complained about, and refusing "take 3" on the ally that has 2 would make the
  stepper a trap.
- the prompt says it — "— click a unit to take counters off it" — in the
  ENGINE, so the log and any future client get it, not just the one client that
  happens to draw a hint.

**⚠ The n = 1 option's value is byte-identical to the pre-R139 one, and that is
load-bearing, not incidental.** `{counterFrom: id}` with no `n` is what saved
games, stored `ctx.choose` answers, and every existing test resolve against.
Both saved games (ANBB, SMVJ) still replay FAITHFUL because of it. **A new
option shape may be ADDED to a menu; an existing one may not be respelled.**

### `counterPickMax` is NOT `counterPool` — the trap worth writing down

`Decision.counterMax` is new: the most counters ONE pick may take, and what a
client's stepper maxes at and its "All" jumps to. It comes from
`E.counterPickMax`, which reads the same `counterPool` the payability check
reads.

The obvious answer — "the max is `counterPool`" — **is wrong for `from:
'allies'`, and so is any client that adds up the pips it can see.** A pick NAMES
ONE UNIT. Four counters spread over two allies is two picks of two, never one
pick of four. A UI counting board state would have offered four, and the fourth
click would have been refused by an engine that had never offered it. For
`from: 'self'` there is exactly one unit, so there the pool IS the answer and
`counterPool` is returned unchanged.

### R130 is not re-litigated

[R130](#r130--every-counter-is-a-counter-and-a-placement-carries-its-actor)
ruled that all counters count as counters. `counterPickMax` therefore makes
**no eligibility judgement of its own**: it reads `counterPool` and `unitsOf`
and nothing else, which are the same two the payability check and the option
list read. Deciding *which* counters a stepper may reach is not a judgement the
UI gets to re-make.

`counterPool` keeps its `Math.max(0, u.counters)`. That is not a sign filter
R130 missed — counters are ONE signed net int, and this cost **prints its
sign** ("+1/+1 counters"), which is the same carve-out R130 already left
standing for Pestilent Mycelion's printed "-1/-1".

### An effect may declare its own ceiling — groundwork, not a fix

`ctx.choose`'s decision type grew `counterMax`, and the engine passes it onto
the `Decision`, so **a card effect that asks "how many counters?" gets the same
stepper as a cost does.** Chombot's "move up to two counters" declares it. Its
option VALUES are unchanged (a bare amount), which is what keeps stored answers
and `pick(h, 2)` working.

**Said honestly: this fixes no live problem.** A survey of the pool found only
two card effects that remove counters by a player's choice — Chombot (a fixed
0–2 menu) and Inexorable Miasma (exactly one) — and neither can ever have "a
ton of counters". Everything else is a choiceless sweep. The widening is
groundwork so the next card that asks for a real quantity does not have to
reinvent the protocol.

### Tests

`124-counter-stepper` — fifteen. The stepper's clamp/max/All judgement is
LIFTED into `ui/inspect.ts` (`counterStepper`, `clampCounterCount`,
`counterStepperCount`, `counterPickIndex`, `counterAmountIndex`,
`counterPickUnits`) for the reason R134 (the card-text formatter) and R136
both landed on: `ui/main.ts` runs DOM code on import and no test can reach it.
`CounterStepperAction.submit` is the literal `false` — the "without auto
submitting" ruling stated in the type, so no path through the stepper can
produce a decision index.

Red-checked one seam at a time, eleven reverts: dropping the prompt instruction
reddens 2; dropping `counterMax` reddens 3; dropping the per-amount options
reddens 3; pinning `payCastCost` back to one counter reddens 3; making "All" a
no-op reddens 5; neutering `clampCounterCount` reddens 5; making
`counterPickIndex` demand an exact match reddens 3; always emitting the hint
reddens 1; dropping the `counterMax` gate on the amount shape reddens 1 (a
"choose X" menu is bare numbers too — the BL-24 collision again); dropping
Chombot's ceiling reddens 1; un-deduping `counterPickUnits` reddens 2.

Both cost routes are covered because they are separate at the table even though
they share `collectCastCosts`: a spell cast (Discharge, `from: 'allies'`) and an
activated ability (Soul Reaver, `from: 'self'`).

## R140 — a responder that reaches back into a bin must name the COPY the event named

*(2026-08-24. CARD-TODO #27. Not an owner ruling and not a new rule of the
game: it is [R131](#r131--another-is-a-different-entity-not-a-different-card-name)
being applied on the side of the seam that never got it. Three cards, one
engine sweep.)*

### The rule

**A bin holds bare card NAMES, so identity in a bin is (name, nth occurrence)
— and a card responding to an event about a binned card must resolve THAT
pair, not search the bin for the name.** A pair that no longer resolves means
**gone**. It never means "take the other copy".

R131 already said the first half and stamped `binNth` on the `trashed` event
for exactly this reason: *"copies of one card there are genuinely
indistinguishable"*, so the only handle on a particular copy is which
occurrence of its name it is. `E.noteTrashed` has been stamping it, and
`notSelfBinCard` has been reading it, since that ruling landed.

**The cards that respond to a trash never read it.** They re-found the card
with `bin.lastIndexOf(name)`.

### Why that is a different question

`lastIndexOf(name)` asks *"where is the last copy of that name in this bin
RIGHT NOW"*. The event asks *"where is the copy this event was about"*. The two
agree only while there is one copy, and they come apart the instant the event's
copy has left the bin — which is precisely what the state-based sweep does:

1. the card is pushed into the bin;
2. `died` / `trashed` fire, and a responder's trigger goes **on the stack**;
3. the sweep takes the copy back out — a token
   ([R69](#r69--a-token-entering-a-zone-is-really-there-then-a-state-based-sweep-erases-it-and-unstable-is-tested-first)),
   or an {Unstable} death
   ([R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased));
4. the trigger resolves, searches by name, and lands on an **innocent older
   copy of the same card** that has been sitting in that bin all game.

The cards then acted on a card the player never trashed. In full:

| card | what the name search did to the wrong copy |
|---|---|
| **Cthyrian Rector** | recalled it to hand — having already paid the sacrifice, which is a CAST cost (R73) and settled before any lookup |
| **Murkdrop Distiller** | cached it out of the bin and made it playable this turn ([R41/R45](#r45--glimpse-n-reveal-n-cache-one-recycle-the-rest)) |
| **Biomass Devourer** | **ERASED it** — [R65](#r65--discarding-is-not-playing-conceding-the-erased-pile)'s pile, out of the game permanently |

Biomass Devourer is the one that cost a card, and it had a second miss of the
same family: a death event's `seat` is the **controller**, while the card bins
to its **owner**. It searched the controller's bin first, so a stolen unit
dying erased a same-named card out of the *thief's* bin and left the dead
card's own copy sitting in its owner's.

### ⚠ This is older than R137, and R137 is why it was found

A dying **token** has been binned, trashed and swept since R69, so the window
has always been open. R137 — every {Unstable} death now passes through the bin
— widened it from "a token died" to "any modded unit died", which is a normal
event in a normal battle. R137 looked straight at these two cards, wrote them
up as handled, and was wrong about *why* they looked handled; the correction is
recorded in R137's own text rather than quietly patched.

### The fix

`dsl.ts` gains the reader beside `binNthAt` and `notSelfBinCard`:

- **`binIndexOfNth(g, seat, name, nth)`** — the exact inverse of `binNthAt`.
  The live index of the (name, nth) ref, or **-1**.
- **`eventBinSlot(g, ev)`** — `{ seat, card, index }` for the card an event is
  about, `index === -1` meaning gone. It reads `card`, `binNth`, and the bin's
  seat: `binSeat` when the event names one, else `seat`.

`E.destroy` now stamps **`binSeat` and `binNth` onto the `died` event**, which
is the one decision this ruling had to make rather than inherit.

> **Why stamp the event rather than give Biomass Devourer its own handle.**
> `trashed` already carried the pair, and a card should not have to know which
> of the two events it is listening to in order to ask the same question. The
> alternative — inventing a second mechanism for `died` — would have left two
> spellings of one identity, which is the shape R131 was written to remove.
> `destroy()` is also the only code that knows the answer: it pushes the card
> and can read the index off that push. Stamping `binSeat` alongside is not
> decoration — without it `died` names the controller and the erase goes to the
> wrong player's bin, which is the second miss above.

**`E.eraseFromZone`'s `'bin'` branch takes an optional index**, the way its
`'cache'` branch already took an optional `uid`, and `destroy` passes the slot
it pushed. Today the sweep was *usually* right because push and sweep are
synchronous with only trigger COMPOSITION in between — but "usually right by
luck of ordering" is what this whole ruling is about. **A named slot that does
not hold that card is a no-op**, never a fall back to the name search: a
fallback is the bug. Mods are swept **highest index first**, because two mods
of one card land in one bin at consecutive slots and taking the lower one first
slides the higher out from under its own index.

[R124](#r124--leftbin-every-bin-removal-goes-through-one-choke-point) is
untouched: every removal still goes through `E.removeFromBin`, and nothing new
splices a bin.

### What a miss costs each card, now

- **Cthyrian Rector** — pays the sacrifice and recalls nothing, saying so. Same
  as R137 described, and now for the right reason. The alternatives are
  unchanged and still refused: refunding a paid cast cost (no mechanism, and
  R73 exists so none is needed), or reaching into the erased pile (R65 — that
  pile is how a card leaves the game).
- **Murkdrop Distiller** — makes no offer and **refunds its `[once]`**
  ([R108](#r108--a-bounded-once-is-not-spent-by-a-decline-narrowed-by-r113)/[R113](#r113--a-bounded-use-is-spent-by-using-it-not-by-it-working):
  no offer could be made, so the use is not spent). The wrong-copy miss is the
  same kind of miss as the empty-bin one and refunds identically.
- **Biomass Devourer** — ⚠ **a behaviour change, stated so it can be
  overruled.** It now makes **no offer at all**: no `[two]` is asked for and no
  counters are added. Before, a miss still paid and still grew the carrier.
  The printed text is one package — *"pay [two] to erase it and put two +1/+1
  counters on me"* — so with nothing to erase there is no bargain to offer, and
  this is how the card's two existing guards (no carrier, no mana) already
  behave. Contrast the Rector, which cannot refund because its cost was paid on
  the way to the stack; the Devourer's `[two]` is paid inside the resolution
  and simply never is.

### The five cards that use `lastIndexOf` CORRECTLY

Thirteen sites on CARDS use the idiom and **nine of them were right** (the four
wrong ones are the three cards above; Murkdrop had two), which is why this
was a site-by-site classification and not a rewrite. Every correct one asks *"is
MY OWN name in a bin"* — a question about a card name, where the copies really
are interchangeable and the last is as good as any other:

- **Spore of Regenesis** — `'died'` + `self: true`; the dying card is itself.
- **Lurking Dread** — zone triggers on `'afterCombat'`, bin and cache.
- **Xzydris** — zone trigger on `'startOfDeployment'`.
- **Cinder Scuttler** — `zone: 'bin'`.
- **Inexorable Miasma** — `zone: 'bin'`.

### Tests

- `43-dark-c` — the Rector and the Distiller each against the fixture the whole
  ruling is about: an **innocent copy already in the bin**, a second copy
  trashed and swept, and the responder must act on **neither**. Plus the
  Distiller's `[once]` surviving a wrong-copy miss, and a white-box pin on
  `eraseFromZone`'s named slot (it takes slot 0 with a later copy present, and
  a slot holding something else is a no-op rather than a search).
- `26-metal-a` — the same fixture for Biomass Devourer, and the
  owner-vs-controller miss: a stolen unit dies and the erase reaches the
  **owner's** bin while the thief's same-named card is untouched.
- `85-silent-branches` — the Distiller's decline fixture grew a `binNth`, or it
  would have been testing the "already gone" branch by accident. A hand-built
  event that omits the stamp now reads as "not in the bin", which is exactly
  what `noteTrashed` means when it omits it.
- `90-coverage-census` — **the static sweep**, so the fourth one fails a test
  instead of being found by hand. It walks the registry (not the text) for a
  triggered ability listening on `'trashed'`/`'died'` whose `run` still
  contains `lastIndexOf`, against an explicit allowlist naming each of the five
  self-locating cards and its reason. The allowlist is checked in **both**
  directions: an unexplained offender fails, and so does an entry whose card
  has stopped using the idiom. ⚠ It strips COMMENTS out of the function source
  before looking — `Function.prototype.toString` keeps them, and all three
  fixed cards explain in a comment what they no longer do.

Red-checked one fix at a time, four reverts: the Rector's name search reddens
its own test **and the census sweep**; the Distiller's reddens its own; Biomass
Devourer's reddens **both** of its (the swept-copy one and the stolen-unit
one); dropping `eraseFromZone`'s index reddens the white-box pin.

## R143 — "…gains control of me" on a spell unit is where it ENTERS, not a handover

*(Playtest reports #95 and #96, room SMVJ, 2026-08-24 — the same action index,
one minute apart. #95 is the cause the owner diagnosed; #96 is the symptom he
actually saw. Closes CARD-TODO #29 and #30.)*

### The reports

> **#95** — "Hush Mush's ability to go to the opponent isn't a trigger. It just
> happens as part of the spell."

> **#96** — "I shouldn't be getting a Flourishing Flora trigger here. Hush Mush
> should enter as Rashi's unit."

**Hush Mush** is a `{Battle}` Arcane Fungus **Spell Unit**, `gg`/2, 3/1:

> Negate target effect. Its controller gains control of me.

Two sentences, **one spell resolution**. The engine implemented the second one
as a `triggered` ability on the body's own `spawned` event, relaying the seat
through `battleCounters[region]['hushMushGiveTo']` (encoded `controller + 1`, 0
meaning nothing owed) and calling `E.giveControl` when it fired.

### Why that is wrong, and why it is not cosmetic

The body **spawned under the caster** and changed hands afterwards. That
intermediate state is **observable**, and the log said so out loud:

```
Resolving Hush Mush:
Channeled Boon is negated → bin.
Player 2 spawns Hush Mush.                                    ← the caster's
Trigger: Flourishing Flora — put a +1/+1 counter on me.       ← report #96
Trigger: Hush Mush — the negated effect's controller gains control of me.
```

The owner controlled a **Flourishing Flora** — *"[Augment] Whenever another
ally spawns, put a +1/+1 counter on me"* — and it took a counter he correctly
refused. The engine then stopped and asked him **which of the two triggers to
resolve first**, a question that should never have been asked at all.

**The bug is the window, not the card.** Every *"whenever another ally spawns"*
watcher the caster controls can see it; Flourishing Flora is simply the one
that happened to be on the board that game. Fixing Flora's `when()` would have
been fixing the witness.

### The ruling

**A spell unit whose text says another player gains control of it ENTERS as
that player's unit.** There is no moment at which the caster controls the body,
so there is nothing for a watcher to observe and nothing to hand over.

**OWNERSHIP DOES NOT FOLLOW.**
[R107](#r107--owner-is-not-controller-and-putting-a-card-into-play-never-transfers-it)
already draws this line and this is the same line: the opponent gains
**control**; the card is still yours, so it is still **your bin** it dies to
and still your card to recur. `spawnUnit(seat, …, { owner })` was built for
exactly this and needed no widening — the `spawned` event carries `owner` only
when it differs, so the table sees `Player 1 spawns Hush Mush — Player 2's
card.` and every existing reader of that event keeps the payload it had.

### The mechanism, and why it DELETED code

A spell unit's body is spawned by `E.afterParts`, **after** every effect part
has run, so an effect has no handle on it — which is the honest reason the
handoff existed at all. The seam is shaped exactly like the one `ctx.eraseSelf()`
already uses for *"Erase me."*: **`ctx.spawnUnder(seat)`** raises
**`StackItem.spawnUnder`**, and `afterParts` spawns the body as that seat's
unit. **On the item**, not in a closure, for the same
[R85](#r85--a-suspended-resolution-rolls-back-on-resume-not-when-it-suspends)
reason as `eraseSelf`: a part can suspend mid-resolution and be replayed out of
the serialised suspension, and `item` is what the suspension carries.

Net effect on the card: **the `triggered` ability and the `hushMushGiveTo`
battleCounters ledger are both gone.** Three lines of engine seam replaced
about twenty lines of relay.

### What the deletions settle

- **Two Hush Mushes in one battle.** `batch-wood-a.ts`'s header warned that the
  ledger was per-**REGION** and last-write-wins, so two copies resolving in one
  region before either spawned would read each other's seat — and dismissed it
  as unreachable with one copy per deck pool. The worry is **retired, not
  merely still unreachable**: the answer now rides on each spell's own stack
  item, so the two cannot see each other by construction. R12 region scoping
  stops being load-bearing here for the same reason — a stack item is not a
  shared ledger and has nowhere to leak to.
- **The target is gone.** The card's own *"the targeted effect has already left
  the stack"* branch is kept verbatim, but it is now confirmed **defensive**:
  R5 fizzles the whole item first (`Hush Mush fizzles — all targets are
  gone.`), no body spawns, and the card is binned from the stack (R40). A spell
  that negated nothing has no *"its controller"*, and now it also has nothing
  to give away.
- **"The body is gone — no handover."** **Deleted.** It guarded the gap between
  the spawn and the trigger — the body could die in between — and there is no
  gap any more. Deleting a branch whose whole subject has ceased to exist is
  not a loss of coverage.
- **Negation ordering** is unchanged, and now explicitly independent: the
  controller is read off the stack item **before** `g.negate()` takes it off
  the stack, so the body's controller never depends on the negated effect still
  being there when the body appears.
- **`96-x-preview`'s ledger census** lost its `Hush Mush` exemption, because the
  card no longer reads a per-battle ledger at all. That census checks its
  exemption list in **both** directions, so leaving the entry behind would have
  failed — the deletion is enforced rather than remembered.

### Tests

`23-wood-a` — four new, on top of the existing Hush Mush test (which lost the
two `pass()`es it used to need for the handoff and gained an assertion that
**nothing is waiting on the stack**):

- **#95** — the `spawned` event itself is the proof: `seat` is the negated
  effect's controller, `owner` is the caster, no `gains control of Hush Mush`
  line follows, and no trigger is queued behind the spell. There is no earlier
  state to catch, which is the point.
- **#96, the regression that matters** — the caster controls a Flourishing
  Flora standing in the battle region (asserted, or the test would pass for the
  wrong reason), and casting Hush Mush must queue **no Flourishing Flora
  trigger**. Checked on the QUEUEING rather than on the counter, because the
  queueing is the moment the caster's watcher saw a body that was never theirs
  — under the old code the counter has not even landed at that instant, since
  the engine is still busy asking which trigger to resolve first.
- **Two Hush Mushes**, one negating the opponent's spell and one negating the
  caster's OWN spell: two spawn events under two different seats. A shared slot
  lands both the same way.
- **The gone target**: two copies aimed at one effect — the second fizzles, no
  body, owner's bin, and nothing changes hands.

**Red-checked** by reverting `engine/src` and keeping the tests: all four new
tests fail, each on its own headline assertion (`it entered as A's unit`; `no
Flourishing Flora trigger`; `the two bodies ENTERED under different seats`;
`nothing changed hands after the fact`), and the amended existing test fails on
`the handover is not a trigger — nothing is waiting`. The drain helper these
tests share deliberately ANSWERS a trigger-ordering question rather than
refusing one — without that, the reverted run parks on the ordering decision
and the assertions measure an unfinished turn instead of a wrong one.

⚠ **`83-card-todo` FAILS ON PURPOSE when this lands**, naming CT-29: that entry
carries a proof which holds only while the bug lives. The failure is the
designed signal that the fix worked, and the ledger's owner closes it.
## R144 — deployment uses the stack, and a trigger may aim where an earlier one is about to fizzle it

**OWNER RULING**, playtest report #101 (room SMVJ, action 318, 2026-08-24),
verbatim and in full:

> "Deployment should use the stack. All Wraith triggers should go onto the
> stack simultaneously and be allowed to target the same unit, even exceeding
> its defense (the final triggers would just fizzle)."

Not a defect report and not a question — a specification. It has two separable
halves and they land as two commits, so either can be reverted alone:

- **(a)** deployment-phase triggers go through the **stack**, like everything
  else;
- **(b)** several of them may aim at the **same unit** even when the total
  exceeds what that unit can absorb; the surplus **fizzles on resolution**
  rather than being prevented when it is aimed.

**(b) is the load-bearing half.** (a) is the mechanism it needs.

### What the behaviour actually was — measured, not assumed

The suspicion carried into this ruling was "start-of-deployment triggers are
queued and resolved one at a time, and targeting is validated as each trigger's
target is collected, so a unit already at 0 toughness is no longer offered".
Both halves of it are **confirmed**, and the second one is confirmed with a
correction worth having:

- `E.processTriggerQueue` had exactly one route onto the stack, gated on
  `battleMode = phase === 'battle' && !battle.damageStep`. Everything else took
  `stackPendingTrigger(next, 'resolve')`: **built, aimed and resolved to
  completion, one at a time**, with the stack empty under all of them. Three
  Wraiths at the start of deployment therefore never coexisted anywhere.
- The Wraith's ally is **not chosen by the targeting layer at all**. R71 made
  it a resolution-time `ctx.choose` precisely because the word *target* is not
  printed on the card, so the second trigger picked its ally from
  `g.unitsOf(...)` *after* the first had already killed a 1/1. Nothing
  *refused* the dead unit; it was simply not in play any more.

So the thing that "pre-validated" was **not a targeting restriction**. It was
the ordinary fact that a choice made late is made in a later world. See the
census under (b) below: **no targeting restriction in the pool had to be
relaxed**, and the reason is worth reading before anyone loosens one.

### (a) — deployment uses the stack

`processTriggerQueue` gains `stackMode = battleMode || phase === 'deploy'`, and
that is what decides `'push'` vs `'resolve'`. `settle()` gains the matching
exit: with the trigger queue empty and a deployment stack standing, it calls
`resolveTop()` once and returns — `finishResolutionTail` settles again, so the
rest drains through the same door, top down.

> **Why settle() drains it rather than priority.** In battle the stack is
> drained by two passes because a battle stack **exists to be responded to**.
> Deployment is a hidden simultaneous segment with no priority windows at all
> — nobody may respond to anything — so its stack is drained at the same safe
> point every other out-of-battle resolution already uses. The owner said this
> himself back in [R102](#r102): deployment *"still has and uses a stack"*, in
> the same breath as ruling that the rot replacement puts a triggered effect on
> it.

**The resolution ORDER is deliberately unchanged.** Immediate mode resolved
NIT's queue first and then IT's, front to back. Stack mode pushes each seat's
queue in **reverse** (so its front ends up on top) with **NIT's pushed last**
(so NIT's sits above IT's) and pops FILO. Both spell the same order — which is
R2, and which is why the seeded replay does not move: five saved games
(WEHH, XVUR, EGCW, GETD, PRB1) replay with **byte-identical replayed/skipped
counts** before and after (57/328, 109/243, 134/184, 48/265, 95/0). Half (a)
costs **zero** replay drift.

**No tax.** [R121](#r121)'s pay-to-trigger gate stays keyed on `battleMode`,
not on `stackMode`. Crevice Lurker prints *"during battle"*; routing deployment
through the stack must not invent a tax the card does not print.

**[R102](#r102) is not regressed, and is now driven harder.** `deployStarting`
+ `finishDeployStart` already refuse to close the start-of-deployment window
while `stack.length` is non-zero, which is exactly the condition (a) newly
makes reachable. The rot replacement's trigger now goes *through* the
deployment stack, suspends there for its target, and the `'startOfDeployment'`
event still fires afterwards.

### ⚠ (a) opened a hole in the deployment freeze, and closed it

`server/view.ts` served **`state.stack` live to both seats, always**. That was
sound while nothing could ever sit on the stack inside a hidden simultaneous
segment — and after (a) something can: a start-of-deployment trigger sits there
carrying its label, its region and its declared aim while its controller is
being asked something. A live `v.stack` would be a live readout of what your
opponent is doing behind the freeze, which is the one thing the freeze is for.

`viewFor` now **drops the opponent's stack items inside a frozen segment** and
only there; outside one — i.e. in battle — the stack stays fully public. Same
rule and same reason as `E.beginResolving`, which publishes `s.resolving` in
the battle phase only. Dropped rather than served frozen because the segment
snapshot's own stack is empty by construction, so the two are the same array.

### A deployment trigger is no longer FLASHED, because it is now really there

`ui/flash.ts`'s `'stackFlash'` exists for items that resolve **without ever
reaching `state.stack`** — "all effects that can't be responded to (like haste
or end of turn) happen and resolve instantly so it's very hard to track". A
start-of-deployment trigger was one of them and is not one any more: it has a
real `stackPushed`/`resolved` pair, so flashing it as well would draw it twice.
A card PLAYED during deployment still flashes — that one really does go from
hand to board with no journey. Nothing regressed; the trigger stopped
qualifying.

### One pre-existing silent branch, exposed rather than caused

`65-effect-conformance`'s fuzz drive reached **Channeled Amalgam**'s `if (self
&& x > 0)` guard for the first time once (a) shifted the drive's trajectory,
and the guard says nothing when it declines — a
[CARD-TODO #3](#r109) defect. It is silent on master too (the drive just never
got there: 65 passes at `3063f2b` and fails with (a) alone). Its own sibling
three definitions down — Arcane Concentrator, the same `[once]`/`spellPlayed`/
X-is-the-cost shape — has announced this since it was written. Fixed with the
announcement rather than by re-seeding the drive.

### Tests — (a)

- `37-attrs-wight` — **"R144(a): every start-of-deployment trigger is on the
  stack before any of them resolves"**. A synthetic watcher records
  `g.s.stack.length` from inside its own resolution; three of them read
  `[2, 1, 0]`. Before (a) they read `[0, 0, 0]` — the stack was empty under all
  three because none of them was ever on it. That single array is the whole of
  half (a).
- `37-attrs-wight` — **"…announce themselves onto the stack, all of them before
  the first resolves"**: the `stackPushed`/`resolved` event sequence is
  `push, push, resolve, resolve`, never interleaved.
- `37-attrs-wight` — **"R12 — a shared deployment stack does not let a Wraith
  reach across regions"**: both seats fire into one queue and one stack, and
  each seat's menu holds only its own home region.
- `37-attrs-wight` — **"the deployment stack is not taxed — R121 is a
  battle-phase gate"**.
- `43-dark-c` — **"the start-of-deployment event still fires after the rot
  replacement stopped to ask"** is R102's own regression test, unchanged, and
  is now the guard for (a)'s suspension path as well.
- `56-ui-flash` — **"an item that resolves with no response window announces
  itself"**, amended: the deployment spawn trigger is now asserted **not** to
  be flashed *and* to have announced itself on the real stack, which is the
  same claim from both ends.

**Red-checked**: reverting `engine.ts` reddens the first two by name. The R12
and R121 tests **stay green** with (a) reverted, on purpose — they pin
invariants that had to *survive* the change, not the change itself, and a test
that reddened would mean (a) had broken one of them.

### (b) — several triggers may aim at ONE unit, and the surplus fizzles

The owner's clause is *"be allowed to target the same unit, even exceeding its
defense (the final triggers would just fizzle)"*, and (a) alone does **not**
deliver it. Measured with (a) in and (b) out: three Wraith triggers reach the
stack, then the first resolves, asks *"which ally?"*, kills the 1/1 — and the
second is asked afterwards, from a menu the 1/1 is no longer on. **A fizzle
needs the aim to have been declared before the thing it named died.** So (b) is
about *when the aim is taken*, and (a) is what makes an earlier moment exist.

The engine gains one seam, `EffectDef.subject` / `EffectPart.subject` /
`ctx.subject`, collected by `E.collectSubjects` beside the targets and read
back at resolution:

- **≥ 2 candidates** — one decision, in the stack window, `stage: 'subject'`.
- **1 candidate** — recorded without asking. A lone Wraith is not asked which
  of its single ally it means, exactly as `collectModes` does not ask about a
  one-option mode.
- **0 candidates** — recorded as `null`. This is the state the whole design
  turns on: the part declared **nothing**, so it has **nothing to lose**, and
  it resolves normally so its `run` can say *"there is no ally"*.
- **aimed, and the entity is gone at resolution** — the part is lost, and an
  item that has lost every target *and* subject it declared **fizzles**, with a
  line: *"… fizzles — what it was aimed at has left play."*

`E.resolveItem`'s existing R86 vote is where the last two meet: a subject part
votes to keep the item alive only while `subject != null && entity(subject)`,
and the "did it declare anything at all" question counts a subject only when it
actually named something. That is what keeps R71's *"with no ally it simply
does nothing — it cannot fizzle"* true while making *"the ally it named is
dead"* a fizzle.

> **R109's precedent, applied.** The fizzle line is not optional decoration. A
> trigger that vanished because the unit it named died under it is
> indistinguishable from a bug at the table, and "an empty damage batch
> announces" is the same rule from the other end.

### ⚠ Why this is NOT a `TargetSpec`, which would have been three lines

[R71](#r71) rules that the Wraith's "an ally" is **not a target**, on the
ground that the word *target* is not printed on the card, and spells the
consequences out: it cannot be redirected, `"when I become targeted"` never
fires for it, and it cannot fizzle. The owner's sentence overrules **the
fizzle**, and uses the word *target* while doing it. It would have been easy —
and wrong — to read that as "make it a target".

Being a target is not one property. It is four:

1. it is **chosen when the effect is declared**, not when it resolves;
2. it can **go stale**, and losing every one fizzles the effect ([R86](#r86));
3. it fires the **`'targeted'` event**;
4. it can be **redirected** into a slot ([R58](#r58)) and is subject to
   *"must be targeted if able"* compulsion.

R144 grants **1 and 2** — which is exactly and only what the owner asked for —
and withholds **3 and 4**. The expensive one is 3: **Mohruung** prints *"when I
become targeted, create a Crystal"*, and a Wraith counter is aimed at an
**ally**, so a pool where this fired would hand its controller a free Crystal
per Wraith per deployment. That is a power gain nobody asked for and nobody
could have been reading into report #101. 4 is the same objection in a quieter
voice: a redirect could send a friendly -1/-1 counter at an enemy, and a
Gatekeeper could compel the Wraith to shrink itself.

So R144 **narrows R71 rather than reversing it**. The word *target* is still
not printed, and everything R71 said except the fizzle still holds.

### Which targeting restrictions were relaxed: NONE, and why that is the answer

The brief for this ruling expected (b) to loosen targeting restrictions
elsewhere in the pool — "targeting must not pre-validate against a limit that
earlier-resolving triggers may consume". A census of the whole pool says there
was nothing to loosen. **Thirty** `restrict` / `slotRestricts` predicates exist
in `engine/src/cards/`, and every one of them tests a property of the candidate
itself:

- **card identity** — is this bin card a unit / a spell / cheap / mana 1 (15 of
  the 30, all `binCard` shapes);
- **ownership or region** — ally vs enemy, not-self, not-this-bin;
- **printed stats** — base power ≤ 2, `manaOf(card) ≤ X`, not a token, is an
  augment;
- **live stats** — `effStats(u)[1] ≤ 5`, `≥ 4`, `statsUntouched`. Three of
  these, and they are already governed by R5/R56: a restriction is **not
  re-asked at resolution**, and a card that needs it re-checked does so in its
  own `run` (Unmake, Reconfigure).

None of them is a **consumable** limit — none asks "is there enough of
something left", which is the only shape a sibling trigger could eat out from
under a later one. `E.targetCandidates` adds no such test either; its only
cross-item exclusion is "a part may not name the same target twice", which is
about **one** part and says nothing about two items naming one unit. Two stack
items have always been free to name the same target, and the survivor fizzles —
which is why (b) needed a new place to make a choice rather than a restriction
to delete.

**So the STOP condition never fired.** Nothing here lets a player do anything
they could not do with two spells aimed at one unit; the change is that a
Wraith's leftover triggers now do **nothing** instead of being forced onto the
player's own other units.

### ⚠ (b) reopened the fuzzer's seed-693 hole from a new direction

[R78](#r78) publishes `s.resolving` in the **battle phase only** — a hidden
simultaneous segment must not tell your opponent that you are mid-something.
Two places enforced that: `E.beginResolving`, which refuses to set the marker
outside battle, and `resolveParts`' `PartChoice` catch, which re-clears it —
the fuzzer's **seed 693**, where a battle resolution ended the battle and
`settle()` then resolved a Wraith's start-of-deployment trigger inline, which
suspended and stranded the outer battle item's marker in the deploy phase.

(b) makes the Wraith suspend in `collectSubjects` instead — a `'cast'`
suspension raised on the way *to* the stack, which never goes near that catch —
and the invariant broke again in `67-resolving-and-stack-viruses`. Two sites
cannot both be remembered, so **the gate moved to `E.suspend`**, the one door
every suspension goes through: outside battle, suspending clears `s.resolving`.
Nothing is lost — outside battle the marker was never legal to publish, and the
throw has abandoned the outer resolution either way.

### The death line is deliberately untouched

*"When I die, Augment a Wraith onto an ally"* still picks at resolution. The
owner's ruling is about the **start-of-deployment pile**, and that line has no
limit to exceed: a unit can carry any number of Wraith augments, so no pile of
them can over-aim and no surplus can exist to fizzle. Converting it would move
a decision earlier in the battle phase — a real replay change — to buy nothing.

### Tests — (b)

- `37-attrs-wight` — **"R144(b): three Wraith triggers may all aim at one 1/1,
  and the surplus fizzles"**. The owner's sentence, executed: all three menus
  offer the 1/1, all three take it, one counter lands, **two fizzle with a line
  each**, and — the point of the whole ruling — no Wraith is shrunk as a
  consolation prize.
- `37-attrs-wight` — **"…does not pre-validate against a limit an earlier
  trigger will consume"**: five triggers onto a 4/4, four land, one fizzles.
- `37-attrs-wight` — **"'no ally at all' still does nothing — it is not a
  fizzle (R71 unmoved)"**.
- `37-attrs-wight` — **"a subject is not a target — no 'targeted' event is ever
  fired for it"**. The Mohruung guard.
- `37-attrs-wight` — **"R144(b) x R113: a bounded ability that FIZZLES still
  spends its use"** (see below).
- `37-attrs-wight` — **"the aim is deterministic — same picks, same state"**.
- `67-resolving-and-stack-viruses` — the existing seed-693 fuzz walk, which is
  what caught the `s.resolving` regression above and now guards the new gate.

**Red-checked**: reverting `registry.ts` alone (the Wraith back to a
resolution-time `pickAlly`, the seam still present but unused) reddens the first
two by name; reverting the whole seam reddens those two **and** the R113 one.
Removing only the `E.suspend` phase gate reddens
`67-resolving-and-stack-viruses`' seed-693 walk. The R71, Mohruung and
determinism tests **stay green** under a revert, on purpose — they pin what had
to *survive* (b).

**Replay**: zero drift, both halves. WEHH / XVUR / EGCW / GETD / PRB1 replay
with identical replayed-vs-skipped counts at `3063f2b`, after (a), and after
(a)+(b) — 57/328, 109/243, 134/184, 48/265, 95/0. A saved game with **two or
more Wraith deployment triggers in one batch** would diverge (the decisions are
the same in number and order, but the menus differ once a unit dies mid-batch);
none of the saved games reaches that state.

### ⚠ FOR THE OWNER: this ruling was briefed with R108, and R113 overrules it

The brief asked for a test that *"a `[once]`/bounded ability that fizzles does
NOT spend its budget (R108)"*. **The repo rules the opposite**, on a verbatim
designer quote, and the test written here asserts the repo's rule rather than
the brief's:

> `[bounded_graft]` — "can only be activated or triggered once per turn.
> **Regardless of if that ability resolves or doesn't.**" — designer,
> 2026-08-23

[R113](#r113--a-bounded-use-is-spent-by-using-it-not-by-it-working) is that
answer, and it says in its own text that *"the previous R108 answer here was
wrong"*: a bounded use is spent by being **used** — activated, or put on the
stack — and only a **decline**, or an offer that could not be made at all,
keeps it. R144's fizzle is an ordinary fizzle and gets the ordinary treatment.
Six refund calls were deleted from the card pool when R113 landed. If R108's
first reading is meant to come back, it is a change to R113 and not something
R144 should have quietly done on the side.

## R146 — a card entering a bin goes through the choke point, and an inline play can still erase itself

**Date:** 2026-08-25. **Source:** the engine's call, derived from
[R40](#r40--trashing-a-card-entering-a-bin-from-anywhere-but-the-stack),
[R65](#r65--discarding-is-not-playing-conceding-the-erased-pile), R69/R79,
[R137](#r137--an-unstable-unit-that-dies-is-trashed-it-passes-through-the-bin-then-is-erased)
and R145. Nothing new was asked of the owner: both halves are existing rules
applied to two sites that had never been held to them.

`E.toBin(seat, name, from)` is the one legitimate way a card enters a bin —
plus `E.destroy` and the mods line inside `engine.ts`, which push first and
fire their own events for ordering reasons. An audit of every write to
`player(seat).bin` in `src/cards/` found **two** sites that went around it.
Both are fixed, and both were wrong in a way the card's other half hid.

### (1) Hooba-Mon exchanged an {Unstable} body into a bin and left it there

> "[Augment] When I attack, you may exchange me for target unit in your bin
> with cost 3 or less." — Hooba-Mon, d/1 1/1

`exchangeInPlace` sends the outgoing body to its owner's bin **from play**, and
it used to push the card, trash it, and stop:

```ts
if (!self.token) {
  g.player(self.owner).bin.push(self.card);
  g.noteTrashed(self.owner, self.card, 'play');   // R40: a bin, from play
}
```

On the **augment** line — the line the card is printed for — `self` is the HOST
WEARING Hooba-Mon. A host carrying a mod is {Unstable} by derivation (R69/R79),
so this is the ordinary case for this card and not a corner of it. R137/R145: an
Unstable card leaving an active zone into a bin is binned, **trashed there**,
and only then swept out into the erased pile. This one stayed in the bin —
fully recurrable, and still counting toward every "cards in your bin" effect and
every "erase X cards from your bin" cost. It was the last bin entry in card code
that disagreed with `E.destroy` about the same disposal.

The fix asks `g.isUnstable(self)` **before** the mods are deleted (isUnstable
derives Unstable from `self.mods`, and the delete loop empties that out from
under it), then follows `destroy()`'s statement order exactly:

```
push → noteTrashed → eraseFromZone(…, 'bin', { index })
```

Three deliberate points:

- **"Erased" does not mean "skipped the trash."** R137 is explicit that from
  PLAY the card really does enter the bin and really is trashed there. The test
  asserts the ORDER (`['trashed', 'erased']`), because a "not in the bin
  afterwards" assertion on its own passes for the wrong reason if someone later
  "optimises" the bin visit away.
- **The sweep names the SLOT it pushed** (R140), never a name search — an older
  copy of the same card resting in that bin must not be the one eaten.
- **A TOKEN host is unchanged**: still nothing binned and nothing trashed. See
  the ⚠ below; that is a pin of today's answer, not an endorsement of it.

### (2) A spell played free by Tides of the Cosmos could not obey its own "Erase me."

`playInline` (batch-water-a) is the shared "play this card as part of my
resolution" helper behind Tides of the Cosmos, Hooba-Pon, Insidious Invitation
and Spell Excavation. It passed:

```ts
eraseSelf: () => {},   // an inline mod run has no stack item to erase
```

The comment is true about the mechanism and wrong as an answer. **Collect
Remains, Suspend and Temporal Rift each print a self-erase sentence**, and
played for free off the top of the deck by Tides they were binned and stayed
recurrable. That is [CARD-TODO #15](../engine/test/card-todo.ts) — *"'Erase me'
is unimplemented"* — arriving a second time by a second route, hidden the same
way it was hidden the first time: the card's OTHER half worked.

`InlinePlay` now carries an `eraseSelf` flag. `playInline` RECORDS the request;
the CALLER, which is the thing that decides where the card goes, honours it —
the same split `StackItem.eraseSelf` / `E.dischargeItem` already uses, and for
the same reason. All four call sites were checked rather than assumed:

| call site | what it plays | effect of the flag |
| --- | --- | --- |
| Tides of the Cosmos | anything off the top of the deck | **erases instead of binning** |
| Hooba-Pon | `isUnitCard` only; disposes on FIZZLE | none — a fizzle never ran the effect, so the flag cannot be set |
| Insidious Invitation | as Hooba-Pon | none, same reason |
| Spell Excavation | a spell out of a bin | none — it never bins what it played (R96) |

**⚠ For the record: `Skybreaker` is NOT in this class.** The brief that
commissioned this work named four cards; there are three. Skybreaker's
"[Augment] Erase me:" is an activation **cost** on a unit in play
(`AbilityCost.eraseSelf`), which CARD-TODO #15 had already separated out for
exactly this reason. It cannot reach `playInline` at all.

### The question this ruling had to decide: is a free inline play a TRASH?

Tides' bin entry was a raw `bin.push`, so it had never had to answer. Routing it
through `toBin` forces a `from`, and `from` decides whether R40 trashes.

**Answer: `from: 'stack'` — it is NOT a trash.** Written down explicitly so a
future reader can see this was decided rather than overlooked.

The card left the DECK and never touched the stack, so a literal zone reading
says 'deck', which trashes. That reading is rejected. R40's own sentence is:

> "A spell or ability going to the bin **after resolving** does NOT [trash] (it
> comes from the stack)."

The parenthesis is how "played, and resolved" is normally *detected*; it is not
what the rule means. `playInline` skips the stack for an engine reason and
nothing else — there is no priority window to open on a free mid-resolution
play — and the spell was played, and it did resolve.

The decisive argument is consistency. If an inline play trashed, the same spell
would trash when Tides played it and not trash when it was cast from hand: two
routes to "play a spell", two answers, with all fourteen trash triggers and the
per-battle trash ledger firing on one of them. That is precisely the bug class
[R133](#r133--tokens-are-not-cards-and-trashing-never-needed-them-to-be) and
R137 closed when they made R40 key on the destination rather than on the object.

It also matches the pool as it already stood: Hooba-Pon and Insidious
Invitation, the other two `playInline` callers that dispose of a card, already
passed `'stack'` for a fizzled spell unit. All four sites now agree. The
assertion pinning this is in `15-water-b.test.ts` ("Tides plays an ORDINARY
spell for free"); flipping it means flipping all four call sites, not one.

### ⚠ THREE THINGS THIS RULING DID **NOT** FIX — for the owner

All three were found while doing the above, all three are in `exchangeInPlace`,
and the first two are rules questions rather than typos, so they are recorded
rather than answered:

1. **A TOKEN host exchanged out of play never reaches a bin at all.** The
   `if (!self.token)` guard skips the bin, the trash and the sweep. But R40's
   2026-08-21 amendment says a dying token *does* enter the bin and *is*
   trashed there before being erased — "the destination, not the object" — and
   `E.destroy` does exactly that for a token today. So the exchange and the
   death disagree about a token: the same shape of divergence part (1) above
   just removed for an Unstable card. R146 pins today's answer in a test rather
   than changing it, because it is a ruling and not an oversight.
2. **The mods on the exchanged host are deleted silently.**
   `for (const modId of self.mods) delete g.s.entities[modId]` — no bin, no
   trash, no `erased` event, so those cards never reach the public erased pile
   (R65) and Hooba-Mon itself simply vanishes from the game with no record.
   `destroy()` bins, trashes and sweeps each nontoken mod (R137). The same
   divergence again, one level down.
3. **The exchange fires no despawn trigger.** `exchangeInPlace` calls
   `g.ev('despawned', …)` but never `g.fireEvent('despawned', …)`, so nothing
   watching units leave play sees it. Almost certainly just a gap.
## R145 — the ACTIVE ZONE: in play and the stack

**Owner ruling, 2026-08-25:**

> "in play and the stack are active zones (which is relevant for cards that have
> unstable). When Statweaver, which has Unstable naturally, gets negated from
> the stack, it should be erased."

This finishes a definition that had been sitting half-written for a year and a
half. **Caleb supplied the PHRASE; Bena supplied the ZONE LIST.** Both halves
have to be said out loud, because neither one is a rule on its own.

### The phrase, and the hole in it

Caleb's own glossary, posted as a rules-bot dump in `rules-questions`
**2025-03-12** (`message-f307bada2ab3163e.txt:21`):

> `"Unstable": "If an unstable card would enter a bin from an active zone,
> erase it instead. This attribute is not shared in formation."`

That sentence is the *entire* definition of {Unstable}, and the phrase **"active
zone" appears exactly once in the whole rulings corpus** — this line. Caleb
never enumerates the active zones anywhere. So until 2026-08-25 the engine had a
replacement effect whose *trigger condition was undefined*, and it had been
implemented as "always" by default. That is the hole Bena's ruling fills, and it
is worth being honest that it is a fill and not a citation: **do not attribute
the zone list to Caleb.**

### The rule

1. **The ACTIVE ZONES are PLAY (the field / a formation) and the STACK.**
   Hand, deck, bin, cache and the erased pile are **inactive**.
2. {Unstable} replaces a bin entry with an **erase** only when the card is
   leaving an **active** zone.
   - **From play** — unchanged. It still routes bin → trashed → state-based
     sweep (R137), and the death event still fires. Unstable replaces the
     *bin*, not the *death* (Caleb 2025-03-13).
   - **From the stack** — straight to the owner's public erased pile (R65).
     R40 already says nothing leaving the stack is ever trashed, so there is no
     trash window to preserve here and nothing to fire.
3. A card leaving an **inactive** zone for a bin is **binned and trashed
   normally**, printed {Unstable} or not. Discard from hand, mill from deck, a
   cache entry binned unplayed (R41) — all ordinary.
4. {Unstable} is a **non-combat attribute** and is **not shared in formation**.

### The sources, one per clause

**The stack case, ruled directly.** Caleb, `rules-questions` **2025-09-13**
(msg idx 28028/28030):

> Q: "negated spells go to the bin, even if they were played from the bin?"
> A: "Yes, although most ways to play spells from the bin give them unstable"
> — *[posts Spell Excavation]* — **"So they would be erased if you used
> something like this and it got negated"**

**The negative control, which is what makes clause 2 a *check* and not a
blanket.** Caleb, **2025-03-31** (idx 21507/21508):

> Q: "Negating an augment puts it in the bin or erase?" → A: **"Into the bin"**

A non-{Unstable} card negated off the stack **bins**. Without this quote the
easy misreading — "everything leaving the stack erases" — looks right, and it
would delete the Manual p.34 virus-fizzle rule entirely.

**Recall is untouched.** Caleb, **2025-04-16**:

> "unstable doesn't stop recalling. So you could recall aberrant statweaver for
> example if it was in play."

Which follows from the glossary without needing a second ruling: {Unstable}
replaces a **bin entry**, and a hand is not a bin. Play → hand is unaffected
however active the origin zone is.

**Clause 4 is printed rules, not a ruling.** `Rules/Algomancy-Manual.txt`
~623-630, the NON-COMBAT ATTRIBUTES sidebar:

> "Some attributes, like burst and unstable, are written in a purple text.
> These attributes are referred to as non-combat attributes, since they
> generally have nothing to do with combat. **These attributes are not shared in
> formation**, and simply exist to modify cards. For example, the unstable
> attribute is often given to cards that have been played from the bin as a way
> to prevent them from being used more than once."

Caleb's glossary line says the same thing in its second sentence.

### The defect

`E.isUnstable(entity)` unions four sources **including the printed face**
(report #89), so the **in-play** half was already right. The **stack** had no
equivalent reader at all:

- `E.negate()` and `E.dischargeItem()` **each** computed
  `(item.augments?.length ?? 0) > 0 || item.unstable === true` by hand — the
  derived R79 case and the R96/R105 stamp, and **neither consulted the printed
  face**;
- `resolveItem`'s two virus-fizzle branches called
  `toBin(item.controller, item.card!, 'stack')` **raw**, bypassing
  `dischargeItem` and therefore any Unstable check whatsoever.

Four sites; one missing question; the same expression written out twice, which
is exactly how the printed face went missing from both copies at once.

Printed {Unstable} is **exactly two cards pool-wide**: **Oorblak** and
**Aberrant Statweaver** (`Abyssal Evocation` and `Spell Excavation` *grant* it).
Both are `kind: 'unit'`, `timing: 'deploy'` and both are also **{Virus}** — and
that combination is not a coincidence, it is the *only* route either card has to
the stack. A deploy-timing unit played normally goes through
`castChain(…, 'resolve')` with no stack window at all, so the only way to catch
one mid-flight is to play it as a **battle Virus augment**, which builds a
`kind: 'virus'` StackItem that can be negated or can fizzle. Both routes binned.

### The fix

`E.itemIsUnstable(item: StackItem)` — the stack twin of `isUnstable`, with the
same "here are all the ways in, unioned in one place" shape. Three ways in:
`augments.length > 0` (derived — a modded card is Unstable, R79),
`item.unstable === true` (the R96 bin-play stamp / the R105 {Modular} cast
stamp), and **`this.card(item.card).unstable === true`** (the printed face — the
missing one).

⚠ The printed face is consulted **only for the kinds whose `card` IS the object
on the stack** (`NEGATE_BINS`). A triggered or activated item's `card` names its
**source**, which is still standing in play; reading the printed flag off that
would erase-log an *ability* because the unit that owns it happens to be an
Aberrant Statweaver.

`negate()` and `dischargeItem()` both **read** it rather than recomputing it,
and the two virus-fizzle sites now route through `dischargeItem` too — so all
three stack exits share one predicate. `dischargeItem` is the right choke there
rather than a smaller helper because it already owns the whole disposition (the
R65 per-owner erased pile, the R79 virus split, the `eraseSelf` branch, and
`disposeItemMods`), and a fizzling item is entitled to every one of them: a
{Modular} virus that fizzled previously stranded its mods nowhere. The fizzle's
own log line stays at the call site, ahead of the call, for the same reason
`negate()`'s does — otherwise it says "→ bin" about a card that is about to be
erased.

### What R145 does NOT change

- **R137 — the from-play path.** An Unstable card dying still enters the bin, is
  **trashed** there, and is then swept to the erased pile. Every "when I am
  trashed" and "when a card is trashed" listener still fires. R137 is
  load-bearing and recent, and nothing here touches it.
- **R40.** Nothing leaving the stack is ever trashed — bin or erase, in either
  direction.
- **Recall.** Play → hand is untouched; a hand is not a bin.
- **Manual p.34.** An ordinary virus that is negated, or whose target becomes
  invalid, still goes to the **bin**. Only a virus that is *itself* {Unstable}
  is erased.
- **Column sharing.** Nothing needed doing: `unstable` and `burst` are their own
  boolean fields on `CardDef`, deliberately **not** `Attr`s, so `colAttrs` /
  `effAttrs` structurally *cannot* share them. That was true only by
  construction, and is now pinned by a whole-pool census test so a future
  extractor cannot "tidy" them into the `attrs` array.

### A question this CLOSES

Playtest report **#89** (room XVUR, 2026-08-23) fixed printed {Unstable} on the
death path and recorded a scope note: *"Whether a printed-Unstable card
DISCARDED from hand is also erased is unsourced and deliberately unchanged."*
The reporter's own message even said *"unless I'm misunderstanding what an
active zone is"*. **"From an active zone" is that source**, and it settles the
question in the direction of **no — it bins**. The hand is inactive. The ledger
note has been updated to point here rather than reading as open.

### Tests

New file `test/125-active-zone.test.ts`, deliberately built in both directions,
because a naive fix that erases printed-Unstable cards *everywhere* is wrong and
the negatives are the only thing that catches it.

Positive (must be **erased**, into the correct owner's R65 pile):
Statweaver negated off the stack · Oorblak negated off the stack · Statweaver
fizzling when its host unit dies · a virused ordinary spell negated (the R79
regression pin).

Negative (must still reach a **bin**): a non-Unstable virus negated · Statweaver
discarded from hand (bin **and** trash) · Oorblak milled from the deck · a
Statweaver binned from the cache (R41) · an Unstable unit **recalled** (card in
hand, nothing erased) · a modded unit's **column-mate** dying (bin + trash — the
Manual sidebar).

Conformance: the printed-{Unstable} population is exactly
`{Aberrant Statweaver, Oorblak}`, and neither `unstable` nor `burst` appears in
any card's `attrs`.

Plus a static sweep in `90-coverage-census`, the **bin-ENTRY** twin of R124's
bin-EXIT splice sweep: every `.bin.push(` in `src/` must be inside `toBin`,
`destroy`, or the documented `leavePlay` mods line — the only three places that
know which **zone** a card came from, which R145 makes the question {Unstable}
turns on and R40 makes the question trashing turns on.

⚠ That sweep carries a **dated, two-line exemption** for
`cards/sets/batch-dark-b.ts:437` (Hooba-Mon) and
`cards/sets/batch-water-b.ts:572` (Tides of the Cosmos), which push into a bin
by hand. Both were owned by a different agent in the same round. It is keyed by
**file and line** so it cannot silently cover a third site, and a stale entry is
a hard failure — **when those two land, delete the entries.**

**Red-checked.** Reverting `engine.ts` wholesale reddens the two negation tests
(both cards land in a bin) and the fizzle test (it logs "→ bin"), and leaves the
other eight green — including the R79 virused-spell case, which is the point:
that one already worked, and if sharing the predicate had broken it, the sharing
would be what is wrong. Reverting **only** the two fizzle sites reddens the
fizzle test alone, so each half is independently pinned.
## R148 — a control change is `E.giveControl` or it is a bug, and it is now an EVENT

*(CARD-TODO #38 and #39, both found 2026-08-24 by the R143 agent's sweep, both
closed 2026-08-25. No playtest report: this was latent, never observed at a
table, which is exactly why it needed a test rather than a fix.)*

### What was wrong

[R112](#r112--a-stolen-units-mods-change-controller-with-it-one-control-change-primitive)
made `E.giveControl(u, to)` the one
control-change primitive, because four card batches had been carrying their own
copy and the copies disagreed. Three cards never got the memo and kept flipping
`controller` by raw assignment:

| card | file | what the raw assignment skipped |
| --- | --- | --- |
| **Mindspore Fiend** | `batch-wood-b.ts` | the unit's MODS, and the formation unslot |
| **Organic Exchange** | `batch-wood-b.ts` | the MODS, both directions |
| **Download** | `batch-metal-a.ts` | the MODS (it unslotted by hand) |

The **mods** are the whole of it. Bena, 2026-08-23:

> "a stolen unit's mods are part of the unit, so yes, they go with them to the
> unit's new controller — that's the whole point of some of the viruses which
> force units to flip flop controllers"

So all three handed over a unit whose augments and grafts still answered to the
seat that lost it. The failure is **silent by construction**: the unit really
does change sides, so every test that checks `.controller` still passes. It
took a hand sweep to find, and it would have taken another to find the next
one — which is the actual problem this ruling closes.

### Two things in the ticket were wrong, and are corrected here

**Mindspore Fiend did not "skip the region move".** It picks its recipient with
`presentSeats(g, ctx.region)`, so the new controller is a seat **present in the
unit's region by construction** and `giveControl`'s R112 exclusivity branch — a
unit whose controller is not present goes home — cannot fire from that call
site at all. What it skipped was the mods and the unslot. (It also carried a
card-local note claiming the formation slot was kept *on purpose*, "for the
(already finished) battle". That note had nothing behind it and described
precisely the state the unslot exists to prevent: `afterCombat` is not the end
of the battle, the `afterWindow` priority is still to come, and through it the
unit would have been standing in its **old** controller's column while the
**opponent** controlled it. The note went with the fix.)

**Organic Exchange must NOT be unslotted — and that is not a bypass.** The
unslot exists so a unit that changes sides does not stand in a formation its
new controller does not own. *"Exchange control of two target units and swap
their positions"* keeps that invariant **by construction**: each unit takes the
other's slot, which is a slot on its new controller's side. So the primitive
grew one option, and one caller in the whole pool passes it:

```ts
giveControl(u: Entity, to: Seat, opts?: { keepFormation?: boolean }): boolean
```

`keepFormation` means *"I am re-slotting this unit myself"*. Anything that is
not a symmetric exchange must leave it alone. Organic Exchange's symmetric
**region** swap went the other way and was simply deleted: both targets come
out of one `targetCandidates` call, which enumerates `unitsIn(region)` for a
single region, so the two regions were always equal and the swap could never
do anything.

### CT-39: the event, and why "wait for the first card that needs it" was overruled

The ticket said to add the event *"WITH the first card that needs it, not
before — an event nothing listens to is untested surface."* That reasoning was
sound when it was written and is spent now: CT-38 routes **three printed
cards** through `giveControl` in the same commit, so a typed event emitted
there has three real drivers that can be observed today, and the tests drive it
through all three. What stays untested is only the **listening** half — no card
prints *"whenever you gain control of a unit"* yet — and that half is
`fireEvent`'s, shared with every other dispatched event in the union.

`giveControl` now emits `controlChanged` instead of the plain `info` line it
used to, carrying `{ unit, card, from, to, region }`:

- **`region` is where the unit stands AFTER any relocation**, so R12 scoping in
  `fireEvent` hands it to **both** present seats' listeners and to nobody else.
- **`unit` makes the moved unit the event's source**, so a `self:` listener on
  the unit that just changed hands matches.
- It is **not** signal-only: it carries the same message, word for word, so the
  game log is unchanged.
- The two "nothing changes hands" branches (the unit is gone; the seat already
  controls it) still emit `info` and dispatch nothing, because no controller
  changed.

`claims.ts` had `control: []` — a claim kind with no event type in the whole
vocabulary, evidenced only by a state delta. It reads `['controlChanged']` now,
with the state delta kept beside it for cards that hand a unit over in a phase
the drill does not reach.

### The invariant is a test now, not a habit

`90-coverage-census` gets R124's shape one zone over: **the only assignment to
a `.controller` in `src/cards/` is none at all**, and in `engine.ts` every one
is inside `giveControl`. Three sites in `src/cards/` are allowlisted with
written reasons, and the allowlist is checked for staleness so it cannot outlive
its cause — two mods being **re-parented onto a new host** (Reconfigure,
Rotbeast), which is a mod changing hosts rather than a unit changing hands, and
one **StackItem** controller (Hexbane Shiitake), which is a different object
with no mods, no slot and no region.

**⚠ Both code-reading traps this repo has hit were live here, and both are
avoided the same way.** `JSON.stringify` on a card definition **drops
functions**, so a check written that way reads nothing and answers "clean";
`Function.prototype.toString()` **keeps comments and strings**, so a comment
merely *mentioning* the bad idiom — usually the comment explaining that the
card no longer does it — holds the check true. The sweep reads **file source**
through `stripCode`, which is `card-todo.ts`'s own helper, now exported rather
than re-rolled: one copy of those regexes, one place to be wrong.

### Tests

- `24-wood-b` — **"Mindspore Fiend gives away a MODDED blocker"**: one
  assertion per skipped behaviour (mods / formation / region), so a partial
  regression names itself.
- `24-wood-b` — **"Organic Exchange hands over MODDED units"**: both
  directions' mods follow, and the position swap survives the choke point.
- `26-metal-a` — **"Download steals a MODDED unit token"**: "target token"
  reaches **unit** tokens too, and those can be augmented — the spell-token
  test above it could never have seen this.
- `24-wood-b` — **"an UNMODDED control change behaves exactly as it did before
  R148"**: the negative control, log line included.
- `90-coverage-census` — **"R148 stays solved"** and **"the only `.controller`
  assignments in engine.ts are inside giveControl"**.

**Red-checked, one card at a time.** Reverting **any single** card to its raw
assignment reddens that card's behaviour test *by name and for the stated
reason* ("its augment changed hands WITH it: 1 !== 0"), **and** the static
sweep, **and** `83-card-todo`'s "every item marked done is really done" via
CT-38's proof — three layers on one revert. Reverting the `controlChanged`
emission alone reddens all four behaviour tests on their event assertions and
nothing else. Ignoring `keepFormation` inside the primitive reddens both
Organic Exchange tests, including the pre-existing one from before this ruling.
## R147 — a spell unit that becomes a copy ENTERS as the copy, and copying is not a trigger

*(CARD-TODO #37, closed 2026-08-25. Found by the R143 agent while sweeping the
pool for the shape it had just fixed. The same defect class as CT-29/CT-30 one
layer over: R143 was about CONTROL, this is about IDENTITY.)*

### The card

**Borrower of Forms** — `mmm`/7, 2/2, `{Battle}` Squid Mimic **Spell Unit**:

> Erase target unit. I become an exact copy of that unit. *(I copy all stat
> changes, counters, card text and mods)*

Two sentences, **one spell resolution** — exactly Hush Mush's shape. The engine
implemented the second one as a `triggered` ability on the body's own `spawned`
event: the copied face was parked on a per-region ledger (`GameState.copyParks`,
key `${region}:bof`) and the copied numbers on six battle counters
(`bof:pending`, `bof:p`, `bof:t`, `bof:c`, `bof:tp`, `bof:tt`), and the trigger
claimed both.

### Why that is wrong

A trigger cannot run before the event that raised it. So the body **entered
play as a plain 2/2 Borrower of Forms** and turned into the thing it copied a
whole resolution later, and everything watching the spawn read the wrong body:

```
Resolving Borrower of Forms:
Bumblecrab is ERASED (no bin, no death).
Player 1 spawns Borrower of Forms.                              ← a 2/2, briefly
Trigger: Boreal Wanderer — deal 2 damage to each opponent.
Trigger: Borrower of Forms — I become an exact copy … (R118).
  → "Order your triggers (first picked resolves first)"         ← a question with no answer
```

**Nectar Ridge Oracle** — *"[once] When another ally with greater defense than
power spawns, draw a card"* — is [R1](#r1--trigger-conditions-vs-effect-values)'s
own worked example of an event-time condition, and it read 2/2 instead of the
borrowed 2/3: no trigger, no card. And any other ally-spawn watcher in the
region was raced by a copy trigger that should not exist, so the caster was
stopped and asked to order them.

### The ruling

**A spell unit whose own text says it becomes a copy ENTERS PLAY as that copy.**
There is no moment at which it is standing there as itself, so there is nothing
for a watcher to observe and nothing to order.

This is [R143](#r143--gains-control-of-me-on-a-spell-unit-is-where-it-enters-not-a-handover)'s
ruling one question over. R143: *whose is the body when it arrives?* R147:
*what is the body when it arrives?* Both are answered by the printed text of the
one spell that is resolving, and both therefore have to be answered before the
`spawned` event fires.

[R118](#r118--the-copy-layer-a-face-in-front-of-the-identity-at-layer-0)'s split
identity is untouched: `Entity.card` is still `Borrower of Forms`, the face is
still what `nameOf` reads, and the card that reaches a bin is still the one that
came out of the deck. Only the MOMENT the face goes on has moved.

### The mechanism, and what it deleted

`ctx.spawnWearing(face)` raises **`StackItem.spawnWearing`** — the exact seam
`ctx.spawnUnder(seat)` uses, in the same place, on the ITEM rather than in a
closure for the same [R85](#r85--a-suspended-resolution-rolls-back-on-resume-not-when-it-suspends)
reason (a part can suspend mid-resolution and be replayed out of the serialised
suspension, and `item` is what the suspension carries). `E.afterParts` passes it
to `spawnUnit`, which puts it on **after the spawn line is logged and before
`fireEvent`** — precisely where [R29](#r29-%EF%B8%8F--an-open-spot-in-your-formation-tiderunner-initiate)
already puts a formation placement, and for the identical reason: `fireEvent` is
the single door every listener goes through.

`SpawnFace` carries the prepared `CopyRef` plus the three things a face cannot
hold because they are facts about the unit and not about its identity — the
copied counters and the two temp deltas. They are applied **before** the face,
so that `wearCopy`'s closing `checkDeaths()` sees a finished body rather than a
half-dressed one; the final numbers are the same either way.

**Deleted:** the `triggered` ability, `E.parkCopySource`, `E.takeCopySource`,
`GameState.copyParks` and its regroup wipe, and all six `bof:*` battle counters.
`E.prepareCopy` — the serializable half of R118 that made the park possible —
stays, and is now called at the only place it was ever needed. Borrower of Forms
has no `abilities` at all any more.

### The ledger was a COLLISION, not only a window

The park slot was keyed by **region**, not by caster. Two Borrowers resolving in
one region before the first's trigger resolved shared one slot:

1. Borrower #1 resolves — face #1 parked, `bof:pending` = 1, body #1 spawns,
   trigger #1 queued.
2. Someone responds to trigger #1 with Borrower #2 — face #2 **overwrites**
   face #1, `bof:pending` = 2, body #2 spawns, trigger #2 queued on top.
3. Trigger #2 resolves. Its `take()` drains each counter *whole*, so it claims
   both castings' counters and temp deltas, and it takes face #2.
4. Trigger #1 resolves to `pending === 0` and returns. **Body #1 stays a plain
   Borrower of Forms for the rest of the game.**

Unlike R143's retired Hush Mush worry this was **reachable with one copy per
deck**: the ledger is shared by everyone present in the region, so one Borrower
each in a two-player battle is enough. `26-metal-a` pins it. Per ITEM, the
collision cannot be expressed at all.

### Tests

`26-metal-a` — five new, plus two existing tests that lost the two `pass()`es
they used to need for the second resolution:

- **The Oracle** sees a 2/3 body and its trigger is QUEUED (checked on the
  queueing, R143's preference — the card lands a resolution later), and it is
  the only trigger, so nothing is ordered.
- **No spurious ordering question**, with a Boreal Wanderer standing in the
  region (asserted to be there, or the test would pass for the wrong reason):
  exactly one trigger waits afterwards and it is the Wanderer's.
- **The identity at the instant**, read from inside `E.fireEvent` — the door
  every listener goes through — because "afterwards" is exactly what already
  worked. Name, stats and attributes are the borrowed ones there.
- **Negative control**: a Borrower whose target walks away fizzles whole (R5),
  spawns no body, bins the card, and leaves no half-asked question.
- **Two Borrowers in one region**, the collision above.

⚠ Every test in this batch needs the caster to be the **DEFENDER**. A spell
unit's body arrives in the region the spell resolved in — the BATTLE region —
while a unit the test rig spawns stands in its controller's HOME region. Only
when the caster defends are those the same region, and only then can any watcher
of theirs see the body at all. Each test asserts the watcher's region against
`battle.region`, so the arrangement cannot rot into a test that passes because
nobody was looking.

**Red-checked** by reverting `engine/src` and keeping the tests: the Oracle test
fails on `Borrower of Forms enters as a 2/3 Bumblecrab, so the Oracle triggers`;
the ordering test fails with the real `orderTriggers` decision, listing
`Borrower of Forms: I become an exact copy of the erased unit (R118)` as its
second option; the identity test fails with `'Borrower of Forms'` where
`'Sporebloom Siren'` belongs; the two-Borrowers test fails with body #1 still
named `Borrower of Forms`. The negative control stays GREEN on the revert — it
pins the fizzle path, which neither shape ever got wrong, and it is there to say
so rather than to catch the regression.

⚠ **`96-x-preview`'s ledger census loses its `Borrower of Forms` exemption** for
R143's reason: that census checks its exemption list in BOTH directions, so
leaving the entry behind fails the suite. The deletion is enforced, not
remembered.
## R149 — the R120 elective damage split gets a ticker, and the engine asks one victim at a time

**CT-34 / owner playtest report #100, room SMVJ**: *"The damage distribution UI
is terrible and confusing. Better would to have a ticker counter thing on each
unit that you click up/down and they always are forced to sum to the amount of
damage you have."*

**The mechanic is untouched.** [R120](#r120--the-elective-combat-damage-split-the-dealing-side-is-asked)
made the combat split elective on *"never decide for the player"* and it stays
elective. This is an affordance ruling only: not one line of `engine.ts` moved,
and `100-elective-assign`'s nine pinned splits are byte-for-byte what they were.

### ⚠ FOR THE OWNER: the report's shape is not the engine's shape

The report asks for **N tickers on N units, forced to sum**. The engine does
not raise that decision and never has. `E.electionWalk` asks **one victim at a
time**, front-to-back, and each question is a single scalar — *"how much of
`remaining` to <this unit>?"* — whose menu is exactly `[share .. remaining]`,
with the last living victim auto-filled with whatever is left. Two things
follow, and both are good news:

1. **The sum is already forced by construction, and never by the client.** An
   under-allocation (less than the unit in front is owed) and an
   over-allocation (more than the strike has) are not *refused* by the UI —
   upstream of any UI, they are not representable. A client that "enforced" the
   sum would be re-deriving `victimShare` — printed-vs-effective defense under
   {Unaware} (R106), doubled receipt under {Vulnerable} (R23), the {Deadly}
   floor of 1 (R114), damage already marked — which is four rulings re-decided
   in the client to draw a number. It does not. `min` and `max` are read off
   the option **values** the engine emitted, and off nothing else.
2. **What the player was missing was therefore not a constraint, it was the
   arithmetic.** The old bar drew a flat wall of `1 to X / 2 to X / 3 to X /
   4 to X (everything)` buttons: no running total, no sight of the units
   behind, and no sign that answering this question schedules another. That is
   the "terrible and confusing", and it is what the ticker replaces.

So the ticker is **per-victim**, and around it goes the whole column: the
victims already answered with their locked amounts, the one being asked with
the live dial, the ones behind still waiting, and the remainder between them.
The player watches the sum being forced instead of being told about it. Every
legal split the engine offered stays reachable — the raw menu is behind an
`every split` expander, because the ticker is an affordance **over** the menu
and never a narrowing of it.

Also worth saying plainly: a column is `[front, back?]`, so **a strike has at
most two victims and therefore asks exactly one question** — the back one is
always the auto-filled remainder. `AssignPlan.picks` is a list and the ticker
draws locked rows for it, but the engine cannot produce a locked row today.
That path is tested hand-built and labelled as such.

### The affordance did NOT already exist

BL-19 and BL-25 were both "the affordance is there and is merely unreachable",
so that was checked first. This is not that: `assignDamage` appeared **nowhere**
in `ui/`, and the decision fell through `decisionBarHtml` to the generic
option-button branch. Nothing to reach.

### REUSE: `counterStepper` was generalised, not forked

BL-25/R139 built this control shape three days ago for counter removal, and
BL-19 is the standing evidence of what a hand-written second copy costs. So the
dial itself was lifted out of `counterStepper` into a shared core in
`ui/inspect.ts` — `quantityStepper` / `stepQuantity` / `clampQuantity`, plus the
`StepperAction { submit: false }` ruling and the `hintOnce` say-it-once helper —
and **both** controls now build on it. `CounterStepperView extends
QuantityStepperView`; `CounterStepperAction` is an alias of `StepperAction`;
`clampCounterCount` delegates. Nothing in `main.ts` or in the fifteen BL-25
tests had to change.

What the two do **not** share, and must not, is the **range**. Counter removal
is one unit choosing *k* off itself, ceiling `Decision.counterMax`; a damage
split is one victim in a queue whose floor is *"lethal to this unit, because
units in front must die before damage walks past them"* and whose ceiling is
*"everything you have left"*. Those are different questions computed from
different engine fields. They dial identically — and the dialling is the part
that drifts.

The BL-25 **clamp** carries over verbatim, and for the same reason: the dial is
one stored number that outlives a single question, so a stored 4 can arrive at
a victim whose menu caps at 2. It is clamped **on render**, not on submit, so
the player reads 2 the instant that question paints rather than reading 4,
clicking confirm, and being given 2.

Tests: `126-assign-split` — the forced total and its reported remainder, the
per-victim clamp, "All" without submitting, the locked/active/behind rows, and
a **negative control** re-asserting BL-25's stepper on the shared core.

**Red-checked, one mutation per claim.** Removing `assignSplitSubmit`'s bounds
guard reddens (1) alone at `under.ok`. Widening the ticker's range off the
engine's option values reddens (2) at *"above the ceiling lands on the ceiling"*
(and (1)/(3)/(4) with it — they all read that range). Sending "All" to the floor
reddens (3) alone; widening `StepperAction.submit` to `boolean` and having
"All" auto-submit reddens (3), the negative control, **and** two BL-25 tests —
the right co-red, since that is shared code. Drifting the counter path's floor
from 1 to 0 reddens (5) and two BL-25 tests while every damage test stays green.

And **the BL-25 reproduction**, which is what test (4) is for: drift the
client's accepted option payload to `{to: n}` *and drift the hand-built menus in
the test file with it* — exactly what BL-25 did, where every test hand-wrote the
payload the handler expected. Tests (1), (2), (3) and (4b) all stay **green**.
Only (4), whose expectations come from a real engine-produced decision, goes
red. That is the assertion that would have caught BL-25, demonstrated.
## R151 — a token prints the X it actually has, and a dormant resource stops reading as mana

Two owner playtest reports, both **presentation only**: no rule moved, no
engine file was touched.

### CT-33 (report #99) — "a Poison 5 should say *Put 5 -1/-1 counters*"

> *"Tokens should have their X value in their text box modified to say the
> actual number, rather than X. So a Poison 5 would say 'Put 5 -1/-1 counters
> on target unit'."* — Bena

**This is NOT the R134/R141/R142 markup class,** and reading it as one is the
trap. Those three were each *a formatter failing to consume a printed token and
emitting it verbatim* — `{g}`, `[2]`, `{i1}`, `/[`. Nothing fails here. `X` is
genuinely the word printed on the card, because the card is a **template**: 44
of the pool's 492 printed texts carry a bare X, and 40 of them define it with a
"where X is …" clause that has no instance behind it at all. What was missing
was a **live per-instance value**.

**Where the substitution lives: the text box, at render time**
(`ui/cardtext.ts`, `liveX` + `substituteX`, applied at the end of
`entityTextBox`). Two reasons, and the second is the stronger one:

1. `src/cards/printed.json` is **generated** from
   `AlgomancyCards/AlgomancyCards-OracleText.json`. A per-instance number
   stamped into it would confuse the transcription of the physical card with
   one copy of it, and the next `npm run extract` would wipe it.
2. Stamping onto the **entity at creation** was the alternative, and the pool
   rules it out in its own words. Robot prints
   *"{i}(If the number of counters changes, so does the X value.)"* — a Robot 3
   that gains a counter **is** a Robot 4. An X frozen at creation starts lying
   the first time anything touches it; one read at render time cannot.

**Where X actually lives in the engine** — two places, because `dsl.ts` says so
("`x` is deliberately ONE field for two things: a spell token's X, and a unit
token's spawn counters"):

| token kind | source | cards |
| --- | --- | --- |
| spell token | `Entity.x`, stamped by `E.createSpellToken` | Fireball, Poison, Crystal |
| unit token | its **counters** (not the spawn request's number — `E.spawnUnit` puts them on and drops it, after the amount layer has had its say: an allied Flux Resonator makes a Robot X enter with X+1, report #88) | Robot |

**Every spelling of X the pool uses**, censused over all 492 printed texts
before the regex was written — R141's lesson is that the pool spells the same
thing more than one way and a rule that knows one spelling looks green while
covering half the cards:

| spelling | count | handled? |
| --- | --- | --- |
| `X` (bare) | 59 | **substituted** — this is the value |
| `X/X` | 9 | never touched — **stat notation** |
| `+X/+X` | 1 (Life Channel) | never touched — stat notation |
| `-X/-X` | 1 (Burden of Life) | never touched — stat notation |
| `[x]` | 8 | never touched — a **cost pip**: variable *mana*, drawn as `Icons/cost_x`. A digit substituted in there silently becomes a different cost icon. |
| `X+1` | 1 (Flamebreath Initiate) | substituted like a bare X; no token prints one |
| `{X}` | **0** | the brief expected this spelling; the pool does not use it. Excluded anyway. |

The stat forms are excluded by refusing an X glued to a `/`, `+` or `-` on the
side that would make it half of a pair — the same anchoring discipline R142
used for `/[`, and test/122's whole-pool sweep still proves no `X/X` moves.

**Reminder text is carved out.** Only three cards put an X inside `{i}…`
(Robot, Premonition, Cosmic Conspirator) and only Robot is a token, but that
one is the whole reason the carve-out exists: substituting into *"so does the X
value"* yields *"so does the 3 value"*, which is not a specialised card, it is a
broken one. Reminder text **names** the variable; it does not use it.

Applied to the **whole box**, not just the printed line: a grant, an augment's
donated clause or a projection landing on a Fireball describes the same spell,
and would otherwise disagree with the line directly above it.

### CT-31 (report #97) — dormant resources read as active outside planning

> *"Dormant resources can misleadingly look like they're active. Maybe have
> them not show up (or something) during battle/deployment so players don't
> think they're active. During planning they should show normally tho."* — Bena

New pure module **`ui/resources.ts`** (DOM-free, like `ui/cardtext.ts` and
`ui/inspect.ts`): `resourceRow(e, seat)` returns one `ResourceView` per
resource carrying `spendable`, `active`, `emphasis` and the hover `title`.
`main.ts` only draws it — three edited lines in `resHtml` and its one caller.

**`emphasis` is a value, not a colour.** A CSS rule cannot fail a test, which is
how a presentation bug comes back; `'normal' | 'muted'` is a discrete state on a
pure function's output, so the phase rule is pinned by an assertion and the
stylesheet is free to express it however it likes (currently `opacity: .38`,
scaled down, desaturated — **shrunk, not hidden**: they are still yours, and a
row that changes length between phases is its own miscount).

**Phase scoping is the owner's own**, and planning is the right exception for a
reason beyond taste: planning is the phase you **act** on a dormant resource in,
and the row is where you click. Dimming what you are being asked to click would
be worse than the bug. Regroup and gameover are left normal — nothing is being
spent and nobody is counting mana against a clock.

**The split comes from the engine.** R132 just reversed R116 (a Prismite DOES
activate its new resource), so "what is spendable" is live rules surface and a
UI that re-derived it would drift the next time the rule moved. `ResourceRow`
carries `mana = E.openMana(seat)` and an `agreesWithEngine` flag checked against
**two** independent engine queries, because they disagree exactly where a future
change would land: `E.openMana` counts what can still be **spent**, `E.affinity`
counts what is **awake** ("dormant gives no affinity"; "expended still counts").
Only `dormant` is muted — an expended resource was spent, which is a thing the
player did and remembers, and it is already drawn turned sideways.

### Tests — `test/127-token-x-and-dormant.test.ts` (10, seeds 5900-5999)

All ten **red-checked** by mutation, not by "the tests pass":

| mutation | reddens |
| --- | --- |
| the substitution call removed from `entityTextBox` | the four CT-33 positives (1-4) |
| `X_VALUE_RE` unanchored (`/X/g`) | 5 — `X/X`, `+X/+X`, `-X/-X`, `[x]` all move |
| the reminder carve-out removed | 3 — Robot reads "so does the 3 value" |
| `liveX` reads only `Entity.x` (unit-token counters dropped) | 3 **and the sweep, 4** — this is the R141 shape: 3 of 4 cards fixed still looks green without it |
| `liveX` drops the `token` check (any unit's counters become X) | 6 — Awoken Tomb's `X/X` template specialises |
| the box *annotates* every token line with "(X = n)" instead of substituting | 7 — a Wisp, which has no X, stops matching its printed card |
| `emphasisOf` always `'normal'` (CT-31 reverted) | 8, 9 |
| `planning` added to `MUTED_PHASES` | 8, 9 |
| `spendable` re-derived as "not dormant" instead of the engine's "open" | 10 |

The sweep (4) is the guard that stops the fix being one-card-deep: it asserts
the census itself — the pool's token cards with an X placeholder are exactly
**Fireball, Robot, Poison, Crystal** (Wisp and Wraith print none) — and then
mints one of each through the engine and checks no literal X survives.

### ⚠ FOR THE OWNER — an out-of-scope wrinkle worth a ticket

`CardTextBox.modified` stays **false** for a specialised token. It is the flag
the UI badges a card with when its box "is not simply the printed card", and a
Poison 5 arguably now qualifies. It was left alone because badging *every* token
on the table as modified would be noise and the `state` row already prints
"X = 5" — but if the badge should follow the substitution, that is a deliberate
call and not something R151 should have made on the side.

## R152 — the other three ways an exchange disagreed with `destroy`, and one erase that reached no pile

*2026-08-25. Follows directly from R146, which fixed the first of the four and listed these in its ⚠ section. Two of R146's three "not fixed" items are now fixed; the third is a RULING and is still open — see the bottom of this entry.*

R146 aligned the **body's** disposal in `exchangeInPlace` (Hooba-Mon) with
`E.destroy`. Everything else about that departure still disagreed with it.

### (1) The despawn was logged and never fired

`exchangeInPlace` called `g.ev('despawned', …)` and stopped. `E.ev` writes a log
line and an event object; `E.fireEvent` is what a listener sees, and `engine.ts`
has exactly one `fireEvent('despawned', …)` site — `afterDespawn`, the tail
`recall()` and `cacheUnit()` share. This was not it.

So **nothing in the game saw a Hooba-Mon exchange**. Not the host's own donated
`[Augment] When I despawn` text (Gzxyclop), not a third-party watcher of "one of
your units despawns" (Demon of the Depths), not `[Augment] Whenever a card enters
a player's hand` (which reads a despawn's `to`). A unit left play and every
"when a unit leaves play" ability in the pool was silent. The log said otherwise,
which is why it survived this long — a test asserting the log line would have
passed.

Fixed: the event object is held and `g.fireEvent('despawned', ev, self)` is
called, anchored on `self` so the departing unit sees its own departure
(`fireEvent`'s `dyingUnit` parameter, which is also how `destroy` gives a dying
unit its own death).

### (2) The mods were deleted with no bin, no trash and no erase

The line was `for (const modId of self.mods) delete g.s.entities[modId];`. No bin
entry, no `noteTrashed`, no `'erased'` event. On the augment line — the line the
card is printed for — **Hooba-Mon itself is one of those mods**, so the ordinary
use of this card made a nontoken card vanish from the game with no record, and
it never reached the public erased pile (R65).

R137 already states the principle for exactly this case, and states it as a
rule about *how the host left play* rather than about death:

> "A nontoken mod on a dying carrier enters a bin and is trashed when the carrier
> is RECALLED or CACHED (leavePlay + afterDespawn, R70). If killing the carrier
> instead skipped that trash, the same mod card would behave differently
> depending on how its host left play — the exact shape of the bug R137 removes."

An **exchange is a third way the host leaves play**, and it was the last one
still skipping it. `exchangeInPlace` now takes `destroy()`'s route, statement for
statement:

* every **nontoken** mod is pushed into its **own owner's** bin, before the
  despawn event fires (so a despawn listener sees the board a death listener
  would);
* each is trashed there, anchored on the mod entity (R70), after the body's own
  trash;
* when the body is `{Unstable}` — which a modded host always is, by derivation
  (R69/R79) — each is swept out of the bin again with `eraseFromZone`, **highest
  index first** (R140: two mods of one card land at consecutive slots, and
  erasing the lower one first slides the higher one under its recorded index);
* a **TOKEN** mod has no card of its own (R69), so it never touches a bin and is
  announced straight onto the erased pile by the same bulk `'erased'` event
  `destroy` emits for that case;
* and the mod **entities** are deleted last, not first — `fireEvent` walks
  `u.mods` through the entity table to find donated `[Augment]` text, so deleting
  them early is what silenced (1) for the host's own despawn sentence. `destroy`
  delays the deletion for the same reason and says so.

**This widens what fires.** It starts firing `trashed` triggers that did not fire
before — the six "when I am trashed" cards and the eight watchers of someone
else's trash. That is the *intended* consequence, and it is precisely what R137
did for deaths. No existing test asserted the old silence; `42-dark-b`,
`15-water-b`, `14-water-a`, `89-self-erase`, `04-mods`, `35-rot-debt-trash`,
`60-cast-time-targets` and `90-coverage-census` were all checked and all pass
unchanged, R146's three pinning tests included.

### (3) Spell Excavation's played card reached NO ZONE

`batch-water-b`. The card does `g.removeFromBin(ctx.controller, …, 'played')`,
plays the spell inline (`playInline` never bins what it played — the caller
decides), and then announced the disposal with:

```ts
g.ev('info', `${name} was unstable — erased instead of binned.`);
```

`E.ev` files the R65 public erased pile only when `type === 'erased'` **and**
`data.seat` is a number. With an `'info'` event the card was out of the bin and
**on no pile at all** — gone from the game with nowhere to look for it. That is
the exact complaint R65 was opened to answer: *"there's currently no way to view
erased cards."*

The log sentence was already correct, which is why the existing test ("it is
ERASED, not re-binned") passed the whole time: it asserted the card had left the
bin and that the line was logged, and both were true. Only the event **type** was
wrong. It is now a real `'erased'` event carrying `seat` and `card`.

**The other two `removeFromBin(…, 'played')` sites are NOT this bug** and were
deliberately left alone. The Bonesculptor (`batch-earth-c`) and Gridxlan
(`batch-hybrids-ld-c`) both play a **unit** out of the bin and immediately
`g.spawnUnit(...)`. The card becomes an entity in play, which is a zone; there is
nothing missing. (A separate question — whether either should stamp R96's
until-regroup `{Unstable}` on the body it spawned, the way the normal bin-play
path does — is *not* part of R152 and is not answered here.)


### (4) The TOKEN BODY — R146's open question, now RULED

R146 flagged, and did not fix, that a **token body** exchanged out of play
reached no zone at all: the `if (!self.token)` guard skipped the bin, the trash
and the sweep, while a **dying** token bins, is trashed there and is only then
swept (R40's 2026-08-21 amendment; `E.destroy` does that today). R146 recorded
it as a ruling rather than an oversight, because "exchanged" is not "died".

**Bena ruled on 2026-08-25:**

> "Hooba-Mon can exchange itself with a thing in the bin. No token can ever be a
> part of that exchange. It can't target a token in the bin (tokens are removed
> from existence during SBA checks and Hooba itself is not a token). However,
> yes. **For all intents and purposes a token is a normal thing that just ceases
> to exist in all zones other than in play/stack whenever SBAs are checked.**"

Note *what the ruling is about*: a **zone**, not dying. That is why it settles an
exchange without anyone having to decide whether an exchange counts as a death —
the question turns out not to have been the relevant one.

"A normal thing that **ceases to exist**", in that order, is a bin entry followed
by a removal, not an absence from the start. So the guard is gone. The body now
bins, is trashed there for the whole trigger window, and is then swept — token or
not — and only the **sweep** asks about tokenhood, exactly as `destroy` does:
`unstable` first (a token host wearing a mod is Unstable by derivation, and takes
that branch with the more specific message), then `else if (self.token)`, which
is reachable on its own only for a token whose *face* became Hooba-Mon (R118
layer 0) and which therefore carries no mod.

Bena's aside — "it can't target a token in the bin" — is about the **other** side
of the exchange, the card pulled *out* of the bin, and needs no code: a bin holds
card names and nothing ever puts a token's name there. It did, however, show up
an artifice in the tests, which pushed `'Unit Token'` into a bin to have something
cheap to exchange in. R152's own tests now use a real card (`Skittering Blight`).
The two R146 control tests still use the artificial entry and were left alone
deliberately, so that they keep pinning exactly what R146 pinned; they are worth
cleaning up next time that file is open.

### ⚠ The one place this ruling and R69 do not meet — reported, not resolved

Read literally, "a token … ceases to exist in all zones other than in play/stack"
would send a **token MOD** through a bin as well. R69 says the opposite for mods
— *"a token mod has no card of its own"* — and both `E.leavePlay` and `E.destroy`
implement R69: nontoken mods bin, token mods never do and are announced straight
onto the erased pile by a bulk `'erased'` event.

That split is **older than this ruling** and lives in `engine.ts`, which R152 did
not touch. R152 follows `destroy` on both halves, which is what keeps an exchange
and a death giving the same answer — the entire point of this ruling and of R137
before it. The token-body and token-mod tests do not contradict each other about
any single object; they differ about whether a token sitting in a **mod slot** is
"a thing with a card". If that is ever ruled the other way, the token-mod test
and `destroy`'s `binnedMods` filter move together.

### Cross-reference: R145's active zones, restated from the other side

Bena's sentence names the two zones a token keeps existing in as **"in
play/stack"** — the same pair R145 identifies as the active zones. He arrived
there from tokens and state-based checks, with no mention of `{Unstable}` or of
R145's question at all.

That is independent corroboration worth recording: **play + stack is a real seam
in this game, not a definition invented to make {Unstable} work.** Two unrelated
questions — "where does an Unstable card stop being erased?" and "where does a
token still exist?" — landed on the same boundary from opposite directions. See
R145 for what the rule actually says; it is not restated here.
## R150 — a readable ceiling on the client, and one seat's decision no longer freezes the other

Two owner playtest reports from room SMVJ, carried as **CT-28** (#94) and
**CT-32** (#98). Both are pacing/concurrency, neither is a rules change, and
`engine/src/engine.ts` and `engine/src/apply.ts` were not touched.

### CT-28 (#94) — "a max speed of 1 thing per second"

> *"We need a 'max speed' that the gamestate can resolve/put things onto the
> stack. When someone has auto pass on and has nothing left to do, it's
> impossible to keep up with what's going on currently."*

The engine is a pure reducer and must not learn about wall-clock time — a delay
in it would make the suite and `server/replay-room.ts` time-dependent. So the
ceiling is a client one, in a new pure module, **`engine/ui/pace.ts`**, with the
clock passed in exactly as `ui/flash.ts` takes it.

**Why the pacing that already existed was not enough.** `ui/flash.ts` paces the
story *within* one server batch (R80's combat stages, docs/11's stack beats).
But a resolving stack is not one batch — it is one `update` **per resolution**,
and a new batch deliberately *replaces* the beat queue. With auto-pass armed the
updates arrive back to back at machine speed, each one cancelling the
explanation of the one before. The missing knob was **between** batches.

- `PACE_MS = 1000` is the single named interval; nothing else spells a number.
- The queue carries `last` — the moment of the most recent **release** — and
  spaces from that, not merely from what is still waiting. ⚠ **The first
  version did the latter and was wrong**: real server updates arrive a few
  hundred ms apart and drain completely between arrivals, so every one of them
  found an empty queue and went straight out. The unit tests all passed
  (they enqueued a burst before draining, and so never emptied it); a headless
  Chrome run against a real two-seat game is what caught it. There is now a
  DRIP test beside every BURST test.
- `holdable(gate)` decides whether an update may wait. It is deliberately
  narrow: an update is eligible **only** when it is not the echo of something
  this client sent, carries no decision (a decision the client can see is
  always its own — `server/view.ts` nulls the other seat's), is not the game
  ending, and either offers **zero** legal actions or arrives with auto-pass
  armed. Auto-pass is the player having said out loud that these windows are
  not to be put to them; holding one gives them a readable second where the
  old `sendAutoPass` gave them 280ms.
- **An un-holdable update FLUSHES the backlog rather than jumping it.** This is
  the answer to "the throttle must never leave the client behind the server
  when it is that player's turn to act": the moment anything actionable
  arrives, everything queued ahead of it is released *with* it, in order. The
  client can therefore never be painting an old board while asking a live
  question, and the only states it ever holds are states with nothing to do.
- **Skip**: a `catching up (n) — ⏭ skip` chip beside the auto-passing chip, and
  the `S` key. `paceFlush` spends the whole queue in one step. Deliberately not
  Enter or Space — those confirm game actions, and the skip must only ever move
  the *screen* forward.
- Input is never delayed: `NetBackend.do()` sends immediately and marks the
  next update as its own echo, and an `error` flushes the queue first so a
  refusal is never told about a board the player cannot see yet.

### CT-32 (#98) — the blocking mechanism was **not** the presentation layer

> *"Rashi's start of combat (doing all her Wraith triggers) doesn't need to take
> away from what I'm doing in Deployment."*

The brief for this work suspected a modal, an animation await or an input gate
keyed on `state.resolving`. It is none of those. **It is the rules layer**, and
`server/test-concurrency.ts` §0 asserts the diagnosis before it asserts any fix:

- `apply.ts` opens with a **global** gate — `if (e.s.decision && action.type !==
  'decide' && action.type !== 'concede') e.illegal('a decision is pending for
  …')` — which refuses every non-decide action from **either** seat; and
- `legalActions()` opens with `if (s.decision) return legalDecisionActions(…)`,
  which returns `[]` for the seat that does not own it.

So during simultaneous deployment the other seat is handed an empty legal list
*and* has anything it sends refused by name. The client's "Waiting for X…" bar
is a faithful drawing of that empty list — un-gating the UI on its own would
only turn a frozen screen into a screen full of refusals. **This became
reachable with R144**, which put start-of-deployment triggers on the stack.

That gate is right in **battle**, where priority is sequential. It is wrong
inside a **hidden simultaneous segment**, where both seats act at once by
construction. The fix is two halves in `server/rooms.ts`, and they only work
together:

- **`legalForSeat(state, seat, segKey)`** — what a seat is *offered*. Inside a
  segment, a decision belonging to the other seat is answered against a shadow
  state with `decision`/`suspension` cleared. Outside a segment it is
  `legalActions` byte for byte.
- **`arrivalVerdict(state, action, segKey, parked)`** — what happens to what a
  seat *sends*: `'defer'` instead of a refusal. The action is parked on
  `room.deferred` and applied the moment the decision closes. `'decide'` and
  `'concede'` are never parked, an action from the seat whose *own* decision it
  is is never parked, nothing is parked outside a segment, and the queue is
  capped at `MAX_DEFERRED = 8` per seat.

`room.deferred` is **derived and never persisted**: an action reaches
`room.actions` only once it has actually applied, so a saved game is still
exactly the game that was played and `replay-room.ts` still replays it straight
through. A parked action that outlives its segment is refused rather than landed
in a phase its author never saw.

**Privacy is untouched, and is now load-bearing in a way it was not before.**
`viewFor` still nulls the other seat's decision and suspension, still serves
their half of a segment from the freeze, and `s.resolving` is still published in
the battle phase only. The sharp new guard is that seat 0's published legal list
is **identical** to the one it had before seat 1 played anything — so the
un-gating cannot itself be used to infer that the opponent is mid-something.

### Tests

- `engine/test/128-ui-pace.test.ts` — 18 cases on the drain arithmetic (burst
  **and** drip), the skip, and the safety gate, all on an injected clock.
  Nothing sleeps.
- `server/test-concurrency.ts` — in-process, no sockets; §0 the diagnosis, §1
  the deploy gate, §2 the negative controls, §3 the deferral round trip, §4 the
  bounds and the two escapes, §5/§6 the privacy properties. Added to
  `suite.test.ts`'s ledger.

**Red-checked**, each by the wrong implementation it rules out. On the client:
spacing from the waiting queue rather than from `last` reddens the drip test
(this is the browser bug, now guarded); a cooldown (`at = now + PACE_MS`)
instead of a rate limit reddens nine, including the quiet-spell one; advancing
the floor to the wall clock reddens the jitter test; advancing it on a skip
reddens the skip-then-next one; `holdable → true` (the naive
throttle-everything) reddens all four safety tests and `holdable → false`
reddens the two that say what *is* held; making an urgent arrival append rather
than collapse reddens the flush tests; breaking the flush, the prefix order or
`PACE_MS` itself reddens theirs. On the server: reverting
`legalForSeat` to `legalActions` reddens §1 and §5's identity test; removing the
`refuse` cases reddens all five of §2; removing deferral reddens §3 and §4;
removing the escapes or the cap reddens §4; removing `viewFor`'s decision
redaction reddens §5; removing the engine's `resolving` phase gates reddens §6.

**Verified in a real browser** (headless Chrome over CDP, a local server on
5177, two seats in one room): the demo board and a live two-seat game render
with no console errors and reach deployment through the throttle; with one seat
done planning and the other recycling back to back, the idle seat's chip counts
up `catching up (1)…(2)…(3)` and one click on it empties the queue.

### ⚠ FOR THE OWNER: two corrections to the brief, and one to a comment

1. **CT-32 is not a presentation bug.** The brief's standing lesson — "the
   presentation layer is the suspect when the rules layer tests clean" — did not
   hold here, and §0 of the new test file records the counter-example so the
   next reader does not go looking at the UI first.
2. **`s.resolving` is guarded in THREE places, not one.** The brief (and
   `E.beginResolving`'s own comment) describe it as *the* gate. Removing
   `beginResolving`'s gate alone leaves the property intact, because
   `resolveParts`' PartChoice catch and `E.suspend` each re-apply it. §6's
   assertion names all three and says which one it actually exercises.
3. **"Lift it into pure functions you can test" was necessary and not
   sufficient.** Every decision here *is* lifted and tested, and the pacing
   still shipped wrong for one round, because the unit tests chose the burst
   shape and the server produces the drip shape. The thing that caught it was
   twenty minutes of headless Chrome against a real two-seat game. For UI work
   in this repo, the browser pass is not a nicety on top of the tests — it is
   what tells the tests which shape to assert.

## R153 — the disposal tail is one primitive, and the bin sweeps can no longer be aliased around

*2026-08-25, CARD-TODO #43. Closes the loop R137 opened, R146 half-closed and
R152 finished by hand: the sequence those three rulings are about existed in
four copies, and every copy drifted. It is one method now. No behaviour changes
— this entry is about where the behaviour LIVES, which is why it can be read as
a refactor and why it is a ruling anyway: the ordering constraints below are
rules, and rules that are re-typed at each call site are rules that diverge.*

### What the disposal tail is

When something leaves **play** for a bin, exactly one sequence runs:

1. push each **nontoken** mod into **its own owner's** bin, remembering the slot
   index each landed at (R69, R137, R140);
2. push the **body** into its bin (`binTo` redirects both halves), remembering
   its slot (R40, R137);
3. **announce** — the caller's own event, logged *and fired*, after every push
   and before every trash, so a death listener and a despawn listener see the
   same board (R70, R137, R152(1));
4. **trash** the body, then each nontoken mod, each **anchored** on the detached
   entity it was, so its own "when I am trashed" text keeps the region it left
   play in (R40, R70, R131);
5. **sweep**, by slot index, **highest first**: if the body is {Unstable}, the
   body and every nontoken mod; else if the body is a token, just the body
   (R69, R137, R140, R145);
6. file the **token mods** on the public erased pile — they never reached a bin,
   so no sweep announces them (R65, R69);
7. delete the mod entities **last**, so step 3's window can still walk `u.mods`
   for donated `[Augment]` text.

Eight ordering constraints, and **not one of them is visible from a call site.**

### Why it is a primitive now

The sequence had four hand-copies. Their history is the argument:

* `E.destroy` — the original.
* `E.leavePlay` + `E.afterDespawn` — the recall/cache pair, which run steps 1,
  3 and 4 and nothing else.
* `exchangeInPlace` (Hooba-Mon, `src/cards/sets/batch-dark-b.ts`) — prose copied
  into a **card file**. R146 repaired the body's half of it. R152 then found
  three more disagreements in the same forty lines: the despawn was logged and
  never fired, the mods were `delete`d with no bin, no trash and no erased-pile
  entry, and a token body reached no zone at all.

Two repair rounds on one copy, with every fix landing as *another* hand-typed
statement next to the ones already there. The copy was **correct** on the day
CT-43 was filed and fully pinned by `test/42-dark-b.test.ts` — and that is the
strongest form of the argument, not a weakening of it: a copy that is right
today is a copy whose next divergence is invisible, because the tests that pin
it are written from the card's side, where "the same as `destroy`" is not
something an assertion can see.

So: **`E.disposeToBin(u, mods, announce, opts)`** (`src/engine.ts`). `E.destroy`
and `exchangeInPlace` both call it; there is deliberately no second
implementation.

```ts
disposeToBin(
  u: Entity, mods: Entity[],
  announce: (at: { binSeat: Seat; binIndex: number; unstable: boolean }) => void,
  opts: { binTo?: Seat; keepBinned?: boolean } = {},
): void
```

`announce` is held to the **middle** of the sequence on purpose — after every
push, before every trash — and receives the body's bin slot (`binSeat` +
`binIndex`, which is R131's bin identity and which only the disposal knows) plus
`unstable`, which the caller needs for the wording of its own log line. A death
logs `died` there and collapses its formation; an exchange logs `despawned` and
unslots. Anything else a caller must do inside that window goes in the callback;
nothing else belongs there, because `fireEvent` only *queues* triggers and the
recorded slot indices therefore stay exact.

`E.toBin` cannot express any of this and is not meant to: it takes neither R70's
`anchor` (so a mod's trash would lose the region it left play in) nor reports
the slot R140's sweep needs (so the sweep would be back to
`bin.lastIndexOf(name)`, which is how an innocent older copy of the same card
gets erased out of the game). `toBin` is for a card entering a bin from a zone
that is **not** play; `disposeToBin` is for one leaving play.

### What was NOT folded in, and why

`E.leavePlay` / `E.afterDespawn` (recall, cache) stay separate. They run step 1
and steps 3–4 for the **mods only**, because their body goes to a hand or a
cache rather than a bin: there is no body push, no body slot, no {Unstable}
sweep (a recalled carrier's mods stay in the bin whatever the carrier was) and
no token-mod erased line. Threading a "no body" mode through `disposeToBin`
would put a branch on every one of the eight constraints above to save four
lines, and would make all three paths harder to read. The R137 principle the
split has to preserve — *the same mod card behaves the same however its host
left play* — is asserted directly instead, in
`test/129-disposal-tail.test.ts`.

### The two bin census sweeps could be stepped around by a local variable

`test/90-coverage-census.test.ts` holds two source-reading guards: R124's bin
**exit** sweep (every removal goes through `E.removeFromBin`, so `leftBin`
fires) and R145's bin **entry** sweep (every entry goes through a method that
knows which zone the card came from). Both had the same two holes.

**Aliasing.** Both matched `<expr>.bin.push(` and a local literally *named*
`bin`. `const mb = g.player(m.owner).bin; mb.push(m.card);` walked straight
past — and `exchangeInPlace` contained exactly that shape for its mod pushes,
which is why the old `BIN_PUSH_EXEMPT` waived one line of the three it should
have caught. Both sweeps now follow **one level of aliasing**: a
`const X = <…>.bin;` anywhere in a file makes `X.push(` / `X.splice(` a hit in
that file. The initializer must *end* at `.bin` — `const n = p.bin.length` binds
a number, and a dozen card files would false-positive otherwise.

⚠ Still open, stated rather than hidden: a **conditional** binding
(`const zone = from === 'bin' ? e.player(seat).bin : …hand;`, `src/apply.ts:634`)
is not followed. There is exactly one in the codebase and it is **not** a
bypass — its `zone.splice` branch is unreachable when the zone is a bin, because
the line above routes that case through `E.removeFromBin`. Checked by hand,
2026-08-25. A second one would be invisible.

**Comments.** Both read raw lines, so a comment that merely *mentioned*
`.bin.push(` was a false positive that failed the suite. Writing the rule down
next to the code that obeys it was a test failure. Both sweeps strip comments
now. `exchangeInPlace` carries a deliberate live fixture — a comment naming
`.bin.push(` inside `src/cards/`, where any hit is an automatic bypass — so
removing the strip reddens immediately.

⚠ **`stripCode` cannot be used whole-file**, and the reason is worth recording
because the R148 sweep in the same file does exactly that. `stripCode`
(`test/card-todo.ts`) deletes a block comment newlines and all, so every
reported line number after the first block comment names the wrong line; and its
string arm has no notion of a **regex literal**, so the lone `'` inside
`/[[\]().,;:!?'"]/g` at `src/engine.ts:175` pairs with the next quote in the
file and everything between is deleted. Whole-file, that swallows **742
quote-free lines of `engine.ts`** — including all three of its `bin.push` lines.
The bin sweeps apply it **one line at a time** instead: a runaway quote cannot
leave the line it opened on, and the line count is preserved by construction.

`BIN_PUSH_EXEMPT` is empty again, and this time the reason to refill it is gone:
there is no bin push left in card code to waive.

### Tests

`test/129-disposal-tail.test.ts`, nine cases. Five drive the disposal through
Hooba-Mon's exchange — a plain body (the default branch, no sweep), nontoken
mods (the despawn *fires*, and each mod bins to **its own owner**), an
{Unstable} body including **two mods of one card in one bin** (the only shape
that can tell the descending sweep from the ascending one), a **token body with
no mods** (the `else if (token)` branch, reachable on its own only when a
token's face is Hooba-Mon), and a token mod reaching the erased pile through the
bulk event rather than a sweep. Three assert the sharing: a spy proving both
`destroy` and the exchange *run* the primitive, a structural check that neither
call site keeps a **second** copy beside it (a re-inline that also calls the
primitive would satisfy the spy and double every trash), and a shape guard on
the primitive itself. One asserts R137 across the split above: a mod's fate is
identical whether its host died or was exchanged.

**Red-checked, each by the wrong implementation it rules out.** Making the body
sweep unconditional (`else if (u.token)` → `else`) reddens the plain case;
logging the despawn without firing it reddens the mod case (and R152's two
despawn tests in 42-dark-b); dropping `.reverse()` from the mod sweep reddens
the two-of-one-card case; disabling the token branch reddens the token-body
case; dropping the bulk erased event reddens the token-mod case; pointing
`modBin` at the body's bin reddens the mod-owner assertion; handing the disposal
an empty `mods` reddens the cross-route case; renaming the `announce` call
reddens the shape guard.

Three of those mutations are worth naming, because **42-dark-b stays green
through all of them**: disabling the token-body branch, sending mods to the
wrong owner's bin, and — the one CT-43 is about — a **faithful re-inline** of
the whole tail back into `exchangeInPlace`. The last reddens both conformance
tests and the widened census sweep, and nothing else in the suite. That is the
measurement CT-43 asked for: the copy is invisible from the card's side, which
is why the sharing has to be asserted directly.
---

## R155 — a `{ todo: true }` test is not a record of anything, and a static can be a park too

**Bena, 2026-08-25.** Not a rules change; nothing in `engine/src/engine.ts` was
touched. This is the tail of the park-hygiene programme that `CARD_LEDGER`
started, and it closes the two ways a gap could still hide.

### The incident this is still about

Harbinger of Immolation's printed second half — "[Augment] Your spell tokens
stay through regroup" — was dead for two days behind a fully green suite. It
was "tracked" by a batch-header comment and by a `{ todo: true }` test naming
the primitive it was waiting on. **A `{ todo: true }` test can never fail, and
a comment cannot fail at all.** Two playtest reports and a conceded game went
by while `npm test` reported a number nobody had to act on.

### The rule

**The count of `{ todo: true }` tests in `engine/test/` is ZERO, and stays
zero.** Asserted by `90-coverage-census.test.ts`, over every `.ts` in `test/`
(a helper can call `test()` too), printing the population it scanned so the
zero has a denominator.

It is a hard zero and not a floor, unlike every other census in that file. A
todo is not a weak test; it is a test-shaped hole. A gap that genuinely cannot
be built yet is declared where declarations get checked against reality:
`test/card-ledger.ts` for a dead card half (both directions, every run) or
`test/card-todo.ts` for anything else.

The last one was Its Dark Bubb's `{Inverted}`, parked on "stat layer 5, which
the engine does not have". The engine had had it since **R93**, and layer 6
({Unaware}) since **R106** — the park outlived its reason by two engine waves
while reading as a tracked gap on every run. It is four real tests now, in
`test/43-dark-c.test.ts`, including the multi-source case that separates the
three readings of "invert the stat changes": the net change from base negated
once (R93, shipped), the per-source deltas negated and summed, and each
operation run backwards ("{Tough} inverted = halve"). Caleb's own worked
example cannot tell the first two apart, because with only layer-4 attributes
in play they agree; a board with a `+1/+1` counter *under* a `{Tough}` can,
and does — `[1, -2]` where the other readings say `[1, -1]` and `[1, 2.5]`.

### The blind spot in the sweep that was supposed to catch this

`71-card-ledger.test.ts::deadShapes` is the guard standing between this repo
and the next Harbinger. It read bare definitions and the `run` bodies of
`abilities` / `augmentText` / `spellEffect` / `graftEffect` — and was
**structurally blind to a gap written as a static or a flag**. That is not
hypothetical: Harbinger's *fixed* half is `statics: [{ affects,
survivesRegroup: true }]` with no run anywhere, and Arbiter of Armistice's
entire printed text is one `costMods` entry. A dead one of either read as a
live card and had no ledger entry demanded of it.

Worse, `statics: []` — an empty array — is `!== undefined`, so it satisfied the
bare-definition check for free. The one-line difference between `card('X', {})`
and `card('X', { statics: [] })` was the difference between "the sweep demands
an entry" and "the sweep says fine", for two definitions that do the same
nothing.

`inertShapes` closes the decidable part, and **only** the decidable part.

**What it can see** — literals:

- a behaviour key present but EMPTY (`statics: []`, `costMods: []`), which also
  no longer counts as behaviour for the bare-definition check;
- a `StaticMod` that projects nothing: no `dp`/`dt`/`baseP`/`baseT`/`attrs`/
  `suppressAttrs`/`suppressAbilities`/`survivesRegroup`, or every one it
  carries provably zero (`0`, `false`, `[]`, `() => 0`);
- a predicate whose whole body is the literal `false` — `affects: () => false`
  (matches nothing), `when: () => false` (can never queue). A body that
  *mutates* on the way to returning `false` is not constant, which is what
  keeps the bookkeeping pattern (Powerforge Synergist, Ancient One) off the
  list;
- a `CostMod` with no channel, or whose every channel is a constant `0`.

**What it cannot see, and never will:**

- whether an arbitrary predicate can ever match. `affects: (g, self, t) =>
  t.kind === 'unit'` on a card whose text is about spell tokens matches
  nothing, forever, and reads as live — Harbinger's own definition carries a
  comment warning about exactly that mistake. Deciding it is deciding an
  arbitrary program;
- a `when()` gated on a state the card's events never produce, or a cost
  function whose arithmetic cancels on every real board;
- a live flag whose READER was deleted;
- anything about whether the behaviour matches the PRINTED TEXT. A card can
  carry a fully live static implementing the wrong sentence.

The narrowness is the point. **An honest floor beats a check that claims more
than it does** — CARD-TODO #9's "97-card phantom band" is what the other thing
looks like. Both halves carry a synthetic canary registered by the test file
itself, so the detectors are proved on every run rather than on the day
somebody needs them, and Harbinger and Arbiter are asserted as live positive
controls: a sweep that cries wolf on working cards gets suppressed, and then
the next Harbinger walks straight past it. The population it scans (49 statics
/ 6 cost mods / 99 `when()` guards on 2026-08-25) is printed and floored from
below for the same reason — a guard over an empty set is worse than no guard.

### Notes deleted, because a park note that outlives its reason is the disease

Four pre-fix blocks were still sitting in the tree directly above the code that
had replaced them: Harbinger's "[Augment] half is PARKED … inert entry only"
(`batch-fire-a.ts`), Arbiter's "PARKED (header) … Registered bare"
(`batch-light-a.ts`, whose own batch header a hundred lines up already said
"none left in this batch"), Beyond, Codex Incarnate's rot replacement as "the
only clause still parked" (`batch-dark-c.ts` — shipped in R102, and
`registry.ts` says so outright), and three "still cut" bullets in
`engine/README.md` naming things that shipped in R93/R106, R91 and R119.

⚠ **The stale block was the one with the RIGHT numbers.** Harbinger is printed
`rr`/4 2/4; the surviving live block quoted "rr/3 2/3 Fire Unit", which is
wrong on the mana, the defense and the type line, and the deleted block also
carried the only note about the trigger's X being read at resolution (R1).
Deleting a stale block is not the same as deleting a block — both were read
before either was cut, and the survivor was corrected and given the R1 note
back.

The README's claim that "the todo count is the backlog" went with them;
`test/53-playtest-round7.test.ts` cites that rule and now says it is retired.

Still genuinely parked, and untouched: Blightwalker's `[Switch1]` graft rider,
the power/defense SWITCH, voluntary combat-damage over-assignment, burst-token
cast order, Rotbeast's mod-moving approximation.
