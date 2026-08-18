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
are battle materiel. ⚠ Engine call from the 2026-08-18 playtest; currently
applied to Tidelurker only — confirm whether it should be the global default.

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
