# Prototype — hotseat rules-engine slice

A playable proof-of-concept of the architecture in `../docs/04-architecture-spec.md`:
a real (small) rules engine, a card registry in the proposed declarative style, and a
click-to-act interface with legal-target highlighting. **15 real Algomancy cards**, hotseat
1v1, both hands visible (it's a test rig, not a product).

## Run it

Open `index.html` in a browser — no server, no build step needed
(`file://` works; card art loads from `../../AlgomancyCards/`).

- Normal game: `index.html`
- Jump straight into a scripted mid-battle with a spell on the stack: `index.html?demo`
- Engine logic tests: `node test.js` (56 assertions)

## What's real

- **Global turn**: Planning (refresh → draw 2 → recycle cards into dormant resources →
  activate max 2) → Battle → Regroup (damage/temp-mods/tokens cleanup) → Deployment
  (initiative player first) → initiative passes.
- **Resources as permanents**: dormant/open/expended, affinity (dormant gives none,
  expended still counts), prismites wild, mana auto-paid on cast.
- **The stack**: battle-timed spells, spell units, Fireball tokens, Virus augments, and
  triggered abilities all stack; priority alternates from the initiative player; negation
  (Dreadwave Devourer) and fizzling (all targets gone) work; a negated spell unit never spawns.
- **Triggers**: on-spawn/on-die (Ignis Sprite), on-spell with once-per-turn bound
  (Rune Channeler), battle-scoped ordinal counters ("when the *second* ally dies this
  battle" — Mischievous Reclaimer), after-combat (Smouldering Inferno).
- **Combat**: columns (front/back), **column-shared attributes** (Flying block restriction,
  Evasive needs two blockers, Piercing overflow to the player), combined column power,
  front-to-back damage with lethal assignment, simultaneous damage, blocked-stays-blocked,
  back-row promotion on death.
- **Mods**: augments during deployment from hand *or bin* (attribute grants), **Virus
  augments from hand during battle on the stack** — including donating "After combat,
  sacrifice me" to an enemy unit; modded units are Unstable and get erased on death.
- **Damage persists across the whole battle phase**, clears at regroup. Spell tokens
  persist until regroup.

## Deliberate simplifications (this is a slice, not the game)

- No regions (1v1 collapses to one shared battlefield) · no draft (shared shuffled deck,
  draw 2) · no grafts · battle = two sequential attack rounds instead of the real
  counterattack declaration · no Swift/Sluggish damage sub-steps · triggers fired outside
  a priority window resolve immediately · Fireballs castable in your deployment too ·
  hands visible (hotseat) · engine mutates state (the real one should be a pure reducer,
  see docs 04 §1).

## Files

| file | what |
|---|---|
| `cards.js` | the card registry — the declarative-DSL pattern demo (15 cards + Fireball) |
| `engine.js` | phases, resources, stack/priority, triggers, combat, mods (~600 lines) |
| `ui.js` | render + click-to-act interaction, `?demo` scenario |
| `test.js` | 56 scripted logic-state assertions (`node test.js`) |
