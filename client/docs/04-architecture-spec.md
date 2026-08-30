# 04 — Proposed architecture

Synthesis of docs 01-03 into a concrete design. Confidence varies; open questions are in
doc 05. Language assumption: **TypeScript** for the engine (runs in browser for the prototype
AND in Node for the server — one rules implementation, no port; Argentum proved the shape).
The Python side (FastAPI app, card index, draft) stays and serves card data/art; the game
server can live beside it or inside it later.

```
┌─────────────────────────────────────────────────────────┐
│ Client (browser, dumb terminal)                          │
│  render(redactedState) + send(intent) + prompt component │
└──────────────▲───────────────────────────┬──────────────┘
               │ redacted views / events    │ intents
┌──────────────┴───────────────────────────▼──────────────┐
│ Server layer (thin): rooms, WebSockets, auth, timers,    │
│  commitment barriers, viewFor(state, player) redaction   │
└──────────────▲───────────────────────────┬──────────────┘
               │ events                     │ actions
┌──────────────┴───────────────────────────▼──────────────┐
│ ENGINE (pure library, no I/O, seeded RNG)                │
│  apply(state, action) -> {state', events[], decisions[]} │
│  legalActions(state, player) -> Action[]                 │
├──────────────────────────────────────────────────────────┤
│ Card registry: 370 declarative defs over a primitive lib │
└──────────────────────────────────────────────────────────┘
```

## 1. The engine is a pure, deterministic library

- `apply(state, action) → { state, events, pendingDecisions }`. No I/O, no clock, RNG from a
  stored seed. Immutable state (structural sharing) — hobby-scale perf is a non-issue.
- **Action log + seed = the whole game**: replay, reconnect, undo-between-friends, bug reports
  that reproduce, and a **fuzzer** (random legal actions, millions of games) as the main QA tool.
- **Decision-point model**: resolution can pause needing input ("choose a mode", "pay [x]?",
  "order your triggers"). The engine returns a `pendingDecision {player, kind, options}`; the
  next action must answer it. This models Algomancy's mid-resolution payments/choices without
  callbacks or coroutines.
- `legalActions(state, player)` is a first-class engine function. It powers: server-side
  validation, client click-to-act highlighting, auto-pass when empty, and the fuzzer.

## 2. State model (extends `wtp.py`'s shapes)

```ts
GameState {
  seed, actionCount, turn, phase, step,
  initiativeSeat, format, config,
  sharedDeck: CardInstanceId[],          // hidden-ordered
  players: Player[],                     // seat-ordered circle
  regions: Region[],                     // one per player
  activeBattle?: BattleState,            // per-region during battle
  stack: StackItem[],                    // belongs to the resolving region
  entities: Map<EntityId, Entity>,       // the single object table
  pendingDecision?: Decision,
  battleCounters, turnCounters,          // "second ally death this battle" etc.
}
Player { seat, life, handIds[], binIds[], packIds[], cacheIds[], resourceIds[] }
Region { ownerSeat, presentSeats[], unitIds[], spellTokenIds[], formations: Formation[] }
Formation { ownerSeat, role: attack|defend, columns: [[EntityId(front), EntityId?(back)]],
            blockedColumns: bool[] }     // sticky blocked flags
Entity {   // unit, resource, spell token, or a card in any zone
  id, cardName, ownerSeat, controllerSeat, zone, regionIndex?,
  damage, counters,                      // signed; +1/+1 and -1/-1 cancel
  baseOverride?, tempMods: ModifierId[], // layer 2, layer 3
  modStack: EntityId[],                  // augments/grafts under this card, ordered
  flags { unstable, dormant, expended },
  perTurnBudgets: Map<abilityId, n>,     // bounded grafts, [once]
}
Modifier { id, source, target, effect, duration: untilRegroup|untilEndOfTurn|whileSourceInPlay }
```

Key commitments:
- **Base + projection**: nothing ever mutates printed stats. `effectiveStats(entity, state)`
  applies the six layers in order: printed → base-set → stat changes (temp + counters) →
  layer-4 attributes *in application order* (store acquisition timestamps) → Inverted →
  Unaware (evaluated pairwise at interaction sites). All modifiers are entities with source/
  duration (SabberStone's enchantment model) — expiry and source-death cleanup are lifecycle
  operations, and regroup's "remove all temporary changes" is a single filter.
- **Region scoping is structural**: every query helper (`unitsIn`, `playersIn`, `alliesOf`)
  takes a region. There is no global "all units" — you cannot accidentally write an
  un-scoped effect.
- **Mods are the card**: a modded unit's ability list is *computed* from base card + modStack
  (like `mods.py:combined_text` but over ability objects, not text). Graft composition builds
  one composite triggered ability (single stack item, single negation target).

## 3. Turn/phase machine & simultaneity

- Phase machine drives Planning → Battle → Regroup → Deployment → EOT with per-format step
  lists. Steps are either **simultaneous-commit** or **sequential**:
  - *Simultaneous-commit steps* (planning actions, FFA attack intents, FFA deployment): the
    server opens a commitment window; each player submits a bundle; others see only
    "committed ✓"; on all-in (or timer → default), the engine merges in deterministic order
    (initiative-clockwise) and resolves. FFA attack intents ARE this mechanism — the paper
    game's Intent cards are a physical commit-reveal protocol, which is *easier* digitally.
  - *Sequential steps* (1v1/team attack declaration, blocks, deployment IT-then-NIT, priority
    passes): normal one-actor-at-a-time actions.
- **Battle scheduler**: battles resolve per region, clockwise from left-of-initiative,
  initiative's region last; regions with disjoint participants may run in parallel (v1: just
  serialize all — always correct, simpler). While a region resolves, listeners and queries in
  other regions are suppressed (a `resolvingRegion` gate in the event dispatcher).
- 1v1 is the degenerate case (two regions, IT/NIT roles) — build 1v1 first, but keep the
  region array and seat circle from day one so FFA/teams are extensions, not rewrites.

## 4. Events, triggers, and the stack

- Every atomic change emits a typed event: `Spawned, Despawned, Died, DamageDealt,
  CountersChanged, ZoneChanged, SpellPlayed, ModApplied, PhaseStarted, ColumnDealtDamage,
  Targeted, TokenCreated, HandGained, LifeLost, Survived…` (§7 of doc 03 is the checklist —
  ~25 event types cover the entire card pool).
- Cards register **trigger specs** (event type + region-gated filter + effect) when entering
  the relevant zone. Filters evaluate against a snapshot at event time.
- Fired triggers collect into a pending set → owners order their own → they enter the stack in
  initiative order, NIT last (so NIT resolves first, per Manual Q&A).
- **Stack items**: `{source, controller, kind: spell|activated|triggered|virusAugment,
  effectRef, targets[], choices, snapshot}`. Targets lock at cast, re-validate at resolution;
  all-invalid → fizzle (spell units never spawn). End-of-turn triggers bypass the stack
  (special actions, no responses).
- **State-based actions** after every resolution: deaths (defense ≤ 0, damage ≥ defense),
  front-row promotion, counter cancellation, unstable-erasure, modifier expiry.

## 5. Card registry — hybrid internal DSL

One TS module per element/set; one entry per card; printed text stored alongside for review.

```ts
card("Sporecap Guardian", {
  cost: "gg", stats: [2, 4], types: ["Fungus", "Unit"], timing: [],
  abilities: [
    triggered(on.selfDies, give(allies(), modifier({ power: +1, until: "regroup" }))),
    activated({ mana: 2 }, draw(controller(), 1)),
  ],
})
// Escape hatch for the weird 10%:
card("Temporal Rift", { …, abilities: [ spell(raw((state, ctx) => endBattleNegatingAll(state, ctx))) ] })
```

- Primitive library grows **only when a real card needs it**; expect ~40-80 effects,
  ~25 trigger events, ~20 selectors. Selectors are region-scoped by construction.
- Pipeline: LLM drafts DSL from oracle text (we have the whole DB + a rules RAG bot!) → human
  review vs printed text → **per-card test required** (definition of done). Coverage is a
  burn-down; play with partial pools (a curated 60-card league is a fine beta).
- `data/` build step pulls `AlgomancyCards-OracleText.json` for costs/stats/types so only
  *behavior* is hand-authored — never re-type printed data.

## 6. Server & networking

- Thin Node/TS layer over the engine: rooms, one WebSocket per client, JSON messages.
- **`viewFor(state, seat)`** redaction: hands → counts, deck → count, packs → counts, dormant
  resources → "dormant" without element, intent commitments → "committed". Spectator = a view.
  Never send unredacted state; the client is untrusted by construction.
- Full redacted snapshot on every change (KBs — optimize never), plus an event feed for the
  game log. Reconnect = auth token + fresh snapshot. Disconnect grace timer before forfeit;
  commitment windows get timers with sensible defaults (Stay / no response / auto-pass).
- Persistence: append action log to SQLite per game. Replay viewer is free.
- Hosting: the existing server box (192.168.100.5) is plenty for friends-scale.

## 7. Client

- Fork `bot/web/board.js`/`board.css` layout language: facing formations, hand/bin rows,
  resource rows, counters-as-die, hold-to-zoom. Add the *interaction* layer:
  - Server-sent `legalActions[]` → glowing playable cards; click → targeting mode highlighting
    `validTargets`; SVG arrows for targets/attacks/stack items.
  - **One prompt bar** for every engine decision ("Choose a column", "Pay [2]? [Yes/No]",
    "Order your 3 triggers", "You: committed ✓ — waiting for opponent…").
  - Visible stack panel + phase ribbon + full game log with card links.
  - Auto-pass by default (window opens only if someone *can* act), stops menu later, per-trigger
    auto-yield later.
- No framework needed at prototype scale; adopt one only if the UI becomes the bottleneck.

## 8. What we deliberately do NOT build first

- FFA/teams (design for them in the state model; implement 1v1).
- The live draft (deck is shared+shuffled from day one, but draft step = "draw 2 more" until
  the engine is fun; draft UI is a later milestone reusing `draft.py` logic).
- Accounts/matchmaking (rooms with join codes).
- Mobile, animations, sound. MTGO is the bar: boring and correct.
