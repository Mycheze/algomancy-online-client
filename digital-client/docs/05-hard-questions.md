# 05 — The hard questions

Questions a digital implementation forces that the paper rules don't fully answer, plus real
design decisions for Bena to make. These are the actual risk in this project — code is cheap
now; **rules adjudication and scope discipline are not**.

## A. Rules gaps a digital version must adjudicate (the "digital comprehensive rules")

The Manual is written for humans at a table. An engine needs answers to questions the table
resolves by talking. Each of these needs a written ruling (the RAG corpus + Discord rulings
channel are the mine; some may need Caleb):

1. **Trigger filter timing** — is "whenever a nontoken unit dies" evaluated against the state
   at event time or at resolution? (Engine must pick one; MTG says event time.)
2. **Simultaneous deaths** — one damage step kills five units with death triggers across both
   players: exact ordering rule? (Manual gives NIT-resolves-first for stack entry; is that
   sufficient for *all* simultaneous events?)
3. **Mid-battle formation edge cases** — front unit dies while its column's damage is being
   assigned? Back-row promotion during Swift damage, before normal damage? Does the promoted
   unit now share column attributes for the second damage sub-step? (Likely yes — verify.)
4. **Electric pathing** — "non-overlapping path, can't go backwards": is the path chosen by
   the Electric source's controller? Confirm path legality when the grid mutates mid-damage.
5. **Exact fizzle semantics** — "some targets invalid → partial resolution": for each multi-
   target card, which parts still happen? Needs a per-card audit during scripting.
6. **Payment timing** — "unless its controller pays [x]": can they expend dormant→no,
   activated-this-turn resources? Any response window around the payment?
7. **Voluntary over-assignment** — attacker may over-kill the front unit; who chooses the
   split when Deadly/Poisonous/Piercing interact?
8. **Control-change geometry** — a donated unit stands in which region? If it was attacking?
9. **Mods on control change** — Manual says the unit's controller controls mods; what happens
   to per-turn bounded-graft budgets already spent when control flips mid-turn?
10. **"Interacting with" for Unaware** — enumerate exactly which interactions (combat damage,
    targeting, fights?) — pairwise stat-ignoring needs a precise definition.
11. **Regroup ordering** — units return / damage clears / tokens erase / temp mods clear: does
    internal order ever matter? (E.g. "when I despawn" on a spell token vs damage clearing.)
12. **Stack + region boundary** — a spell on the stack in region 3 when its resolution changes
    battle order (Temporal Rift): what happens to the rest of region 3's stack? To regions
    4 and 5 that haven't resolved?

**Recommendation:** keep a `digital-rules.md` decisions log from day one. Every question gets a
numbered ruling with rationale. This document *is* the engine spec, and it's also genuinely
useful content for the community/RAG bot regardless of how far the client goes.

> **STATUS 2026-07-16: done — see [digital-rules.md](digital-rules.md).** Bena adjudicated
> all twelve as R1–R12 (R1 provisional pending a re-explained question). New questions go
> there, not here.

## B. Product decisions (Bena's call, not researchable)

1. **Who is this for?** — **DECIDED 2026-07-16: people who already know Algomancy and want
   more games (or want to deepen their rules understanding by watching the engine work).**
   Implications: no tutorializing needed; rules *transparency* is a feature (visible stack,
   verbose game log, "why was this illegal?" explanations); an audience beyond one playgroup,
   so the Caleb/IP conversation (B4) matters sooner rather than later.
2. **Rules-enforced from the start, or shared tabletop first?** — **DECIDED: rules engine
   from the get-go.** Tabletop-Simulator-style play already exists; a manual tabletop adds
   nothing for this audience. This makes the M1 engine core the critical path and accepts
   the cost: months before the first playable online game.
3. **Which format is v1?** — **DECIDED: 1v1 live draft (3-element shared deck) AND 1v1
   constructed.** Live draft is the identity and must be in v1. Consequence: v1 needs the
   draft loop (hand↔pack merge, leave-exactly-10, pack passing, refresh cycle) *and* full
   card coverage of at least 3 elements (~54×3 mono + their hybrids ≈ 175-190 cards), so the
   card burn-down is prioritized by element, not by simplicity.
   → B7 answered: **all five elements are valid** — a live draft just uses any 3 at a time,
   chosen per game. So the burn-down covers the whole set; draft unlocks per fully-scripted
   trio, and the order we script elements in is a free implementation choice.
4. **IP question** — **DECIDED: deferred.** Internal use / personal curiosity only for now;
   nothing publishes without Caleb's approval when that day comes.
5. **Engine language** — **DECIDED: TypeScript** (one implementation runs in browser for
   solo/hotseat and on the server for online).
6. **LLM card-scripting** — **DECIDED: yes, with a test for every card** as the definition of
   done; the per-card tests double as the regression suite so future updates can't silently
   break cards. The bot project's rulings data doubles as test fixtures.

## C. Known engine hard parts (solvable, but budget them)

Ranked by expected pain:
1. Mods (augment/graft) as runtime ability composition — the #1 Algomancy-specific problem;
   no off-the-shelf TCG engine has this. Prototype it early to de-risk.
2. Formation grid + column attribute sharing + damage assignment (incl. Electric pathing,
   Swift/Sluggish sub-steps).
3. Region scoping + battle resolution ordering + "elsewhere doesn't exist" suppression.
4. The 6-layer stat projection with application-order layer 4 and pairwise Unaware.
5. Simultaneous-commit infrastructure (planning, FFA intents) with timers/defaults.
6. Per-battle/per-turn ability budgets and ordinal triggers ("second ally death this battle").
7. Stack exotica (retargeting, stealing spells, copy-as-cast) — park them; ship without.

## D. What would kill this project

- **The card backlog death march** (engine works, 300 cards to go, motivation gone). Defense:
  LLM pipeline + per-card tests + playable partial pools from the first month.
- **Rules-engine rabbit hole** (generalizing for hypothetical cards). Defense: primitives only
  when a real card needs them; weird-card parking lot.
- **Building alone in the dark.** Defense: the hybrid path — something playable with a friend
  every few weeks, even if half the rules are manual.
