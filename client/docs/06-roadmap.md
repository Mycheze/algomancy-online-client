# 06 — Roadmap

**SCOPE CHANGE 2026-07-16 (late):** an official Algomancy client is now in production on
Steam, so this project is **personal software**: a way for Bena and their girlfriend to
keep playing together while studying in different cities. Two players, one home server,
join-by-room-code — **no accounts, no lobbies, no publishing, no production concerns**
(which also moots the Caleb-approval item). Rules transparency stays: it's the reason to
use this over TTS. Practical consequence: M2 shrinks to a thin WebSocket layer + redacted
views; M4 (live draft) is still the fun goal but for two people; FFA/teams/spectators are
out of scope unless they become fun to build.

**Original framing (2026-07-16, earlier)** (doc 05 §B): audience = players who already
know the game and want more of it; **rules engine from day one** (no manual-tabletop
milestone — TTS already covers that); **v1 = 1v1 live draft (3-element shared deck) + 1v1
constructed**. Estimates assume evenings/weekends + heavy AI assistance, calibrated against
the Argentum datapoint.

Rules transparency is a product feature for this audience: visible stack, verbose game log
with trigger provenance, "why is this action illegal?" — build these into the client from
the start, not as polish.

## M1 — Engine core with ~20 cards — 4-8 weeks
The pure library, fuzz-tested, hotseat/solo in browser (grown out of the since-removed `prototype/`).
- Phase machine (1v1), resources/affinity, deployment casting, stack + priority,
  triggers/events, modifiers + 6-layer projection, combat with formations, state-based actions,
  `legalActions`, decision-point model, seeded RNG + action log.
- **Mods (augment/graft) done properly** — the #1 de-risk item; in the first 20 cards.
- Fuzz harness + per-card tests. `digital-rules.md` rulings log starts here.
- **Exit criterion: fuzzer plays 1M games without crash/illegal state; 20 cards fully correct.**

## M2 — Online enforced client, 1v1 constructed — 3-6 weeks
Constructed first purely because it needs fewer scripted cards than draft.
- ~~Node/TS server wrapping the engine: rooms with join codes, WebSockets, `viewFor`
  redaction, reconnect, action-log persistence.~~ **Slice landed 2026-07-16**
  (`client/server/`): ws server + room codes + per-seat redaction (hand/deck/
  dormant-resource kinds/seed) + event blurring + reconnect resync + JSON persistence
  with replay-restore; the hotseat UI gained a network mode (`?ws=1&room=CODE&seat=N`).
  Remaining for M2 proper: play a real remote game end-to-end (the exit criterion),
  fix what that surfaces, deploy on the home server.
- Client: legal-action highlighting, targeting arrows, prompt bar, visible stack, auto-pass,
  full game log. Minimal deckbuilder (30+ cards, max 2 copies) over the scripted pool —
  **deckbuilder optional now** (personal scope: the shared-deck default already plays).
- **Exit criterion: two people finish a real enforced constructed game online, and the loser
  can read the log and see exactly why everything happened.**

## M3 — Card burn-down, element by element — 6-12 weeks

**2026-08-18: the first trio is DONE.** Fire+water+earth is fully scripted — all
183 trio cards (3×~56 mono + 3×5 hybrids) plus the earlier wood/metal cards:
registry 199, playable deck 190, suite 263 tests / 0 fail / 15 todo, 1000 fuzz
games clean. Eight parallel scripting agents + two unpark waves; the engine
gained temp-attr grants, battle-draw events, a per-battle life-loss ledger, a
continuous static-modifier layer, and an end-of-turn suspension fix along the
way. The 15 todos are the parking lot: cast-time X costs, damage replacement,
cost modifiers, mod-carried statics, spell-effect attr projection, trigger
suppression, Shard resources, bin-play/bin-resident triggers, regroup
replacement. **M4 (live draft) is unblocked.**
- B7 resolved: all five elements are valid; a live draft uses any 3 per game. So the target
  is the whole set, but **draft unlocks per fully-scripted trio** — completing any 3 elements
  (~175-190 cards: 3×54 mono + that trio's hybrids) makes M4 shippable, and each further
  element multiplies the available trios.
- Scripting order is a free choice: start with whichever elements are mechanically cheapest
  (fewest stack-exotica cards) to get the first playable trio fastest.
- LLM pipeline: oracle text → DSL draft → human review → per-card test (definition of done).
- Run a constructed league on the growing pool while it lands.
- Weird-card parking lot for the stack exotica; ship without them.

## M4 — Live draft (the v1 identity feature) — DONE 2026-08-18

**Shipped**: `mode: 'draft'` through the whole stack. The deck is the physical
box for the fire+water+earth trio — `draftDeckList()` filters the registry by
oracle factions to exactly the Manual's 54 per element + 5 per hybrid pair =
**177 cards, one copy each**. Game start deals 6-card hands (opening 4 + turn-1
draws, Manual p.16) and 10-card packs, clockwise from initiative. Every
planning phase opens a **draft step**: merge hand+pack, `draftCommit` names the
pile indices that stay in the pack (leave-exactly-10 enforced), both commits
pass the packs clockwise (1v1: swap). Packs **refresh every N+1 turns**
(1v1: turns 4, 7, …): recycled to the bottom of the deck in seeded-random
order, fresh 10s dealt. Packs are redacted like the Manual says: your own only
during your open draft step, the opponent's never. The server takes
`mode: 'draft'` on the room-creating join (home screen: "New live draft"),
persists it, and replays it on restart; undo covers draft commits. The client
gets a draft panel (click cards between "hand after drafting" and "left in the
pack", commit gated on exactly 10) and an "opponent is still drafting…" state.
- Tests: `test/20-draft.test.ts` (12 cases), draft-mode fuzz (25 games +
  replay determinism) in 06-fuzz, `server/test-draft.ts` (19 checks:
  redaction, passing, undo, persistence/restart). Suite: 277 / 0 fail.
- Simultaneity note: no timer — personal scope; the commitment window +
  "opponent is drafting…" is enough for two people who trust each other.
- **v1 ships here: 1v1 live draft (fwe trio) + 1v1 constructed.** Each further
  scripted element multiplies the available draft trios (wood/metal → 10).

**First human playtest fixes (2026-08-18 evening):** the round-2 FRESH-attack
bug (units attack from home when round 1 didn't happen — "that unit is in
another region"); `forcedAction()` (server+UI auto-submit "don't attack"/"no
blocks" for empty boards); **Shards** (Manual p.18: element activation at ≥3
affinity grants a dormant Shard; mana, no affinity; prismite-exchange counts);
`state.elements` (draft games only offer/accept the trio's resources);
**simultaneous hidden deployment** (house rule: `deployDone[]` in the engine —
`deployPlayer` kept as a derived sequential marker for old drivers; the server
freezes each seat's view of the opponent at deploy start, holds the opponent's
events, and flushes them as a "replay" when both are done; undo can splice
your own action out of the deploy segment); tolerant room replay (now-illegal
logged actions are skipped, not fatal). UI: sticky bottom hand dock + sticky
side panel (net mode), compact opponent hand, bins as card scans, +N/+N
counter badges, dormant resources greyed + a "you still have activations"
confirm, clamped context menus, game-element-only recycle menu, stack card
art, and a "Pass all" priority button that disarms when the stack grows.
(⚠ That single button is **history**, not the current client: R251 — 2026-08-29,
report #123 — split it into three promises with different scopes, and the one
described here became **Pass through stack**.)

**Playtest round 2 (same evening):** cast-time MULTI-TARGETING
(`TargetSpec.count/min`, dedup, "No more targets" after the min — Twin Flame
and Battle now pick every target at cast); Animated Spark rebuilt as a true
static over a new per-battle `spellsPlayed:<seat>` ledger; **mod-carried
statics un-parked** (statics radiate from augment mods, anchored on the HOST —
Sandstone Defender, Dreadspawn Horror, Malformed Monstrosity, Towering
Colossus all fully live; `augmentable: true` flags statics-only augments);
**combat sub-step trigger drain** (`battle.damageStep` + `pumpCombatDamage()`,
resumable via settle like the turn-end pattern): triggers fired by a damage
sub-step resolve immediately — special actions, no priority (R3) — before the
next sub-step, so Flowstone Arcanite's Swift counters land before normal
damage. UI: battle sub-step in the phase track, table orientation (your units
below the vs-line), base-vs-effective P/T (colored live stats + printed base
on board cards and the focus viewer), and the focus viewer composes modded
units — base art + each mod's text-box strip, like the physical slide-under.
Suite 289 / 0 fail; 1000-game fuzz clean on the new combat pump.

**Playtest round 3 (second live game, 2026-08-18):** Engine — absent
counterattackers now exist NOWHERE (no statics radiation, no token
enumeration — R32; the live Towering Colossus case); Tidelurker's 2/2 arrives
at HOME (R28 ⚠ — created units default to the controller's region; global
default still to confirm — **R28 was WITHDRAWN on 2026-08-23 by R115: a created
unit arrives where its SOURCE is, so Tidelurker's 2/2 now stays in the battle
region and cannot block the counterattack**); Tiderunner Initiate's open-spot prompt broadened
(behind a survivor / emptied column / a NEW attacker column — R29); Recall's
unconditional 2 life documented as R30; combat sub-step trigger timing is
R31; seenHand (Bripp looks are remembered until the owner's draft merge);
DecisionOption.card (hand/deck/bin picks carry the card for real scans).
Twin Flame's engine was CORRECT — the UI's 'targets' decisions rendered no
button for non-board options, so "No more targets" was unreachable.
UI (rebuilt) — region-PHYSICAL board: units render in the region they're in
(invaders marked, absent units in a dimmed "counterattacking" strip, the
battle region ringed and the other dimmed); bins moved to the side panel;
opponent's hand lives in their identity row; seen-hand memory strip; sticky
topbar; Unit Token uses Generic-Unit.jpg + art() honors printed images with
an onerror fallback; decision options render as clickable card scans;
spell-token ride-along UI for attacks and counterattack sends; deployment
reveal interstitial ("Your opponent's deployment" + Continue); pass-all is
visible/cancelable; a real auto-pass TOGGLE (passes only when pass is the
only legal action); end-of-combat guard when castable spell tokens remain.
Suite 296 / 0 fail.

## THE FULL SET (2026-08-18, late): all five elements scripted

Eight parallel scripting agents added the remaining 130 wood/metal/hybrid
cards: **DECK_LIST = 320 = the whole draftable box** (54×5 mono + 50
hybrids), all **10 trios Manual-exact at 177** (test/31-trios gate). Draft
rooms take a CHOSEN TRIO end to end: `createGame(seed, names, mode, els)` +
`sanitizeTrio`, rooms persist `els`, the join carries it, and the home
screen has a 3-of-5 element picker (colored chips + random die, persisted
per browser). Suite 453 / 0 fail / 30 todo; 200 fuzz games across all 10
trios + the 320-card shared deck clean. New parking-lot themes from the
batches (for a future primitives session): control-change primitive
(approximated per-batch as `giveControl`), copy/transform machinery,
attribute/ability suppression layer, damage prevention/replacement, cast-time
X payment, died-event token/counter snapshots, `tokenCreated`/`targeted`/
`resourceActivated` not dispatched to trigger listeners, play-permission and
cost-modifier layers (Rook, The Silent, Dispatch Courier, Worldbender).

## M5 — Beyond v1 — open-ended
- More elements → full 5-element draft; FFA intents (commit-reveal); teams; spectators;
  replay viewer; puzzle mode (load `puzzles/*.json` as scenarios — free synergy with the
  bot project); accounts/lobby; Caleb's blessing before any public deploy.

## First three concrete steps
1. ~~Answer the doc-05 questions~~ **Done 2026-07-16** — rulings live in
   [digital-rules.md](digital-rules.md) (R1 still provisional).
2. ~~Grow `prototype/` toward M1 in TypeScript~~ **Done 2026-07-16** — `engine/` is the
   pure reducer (apply + legalActions + seeded RNG + action-log replay), with real regions,
   the 1v1 counterattack rule, Swift/Sluggish sub-steps, Electric pathing, **proper graft
   composition**, 22 scripted cards, R1-R12 encoded as tests (R10 todo: no Unaware card
   yet), the prototype's suite ported, a fuzzer (2000 games clean, 100% terminate,
   replay-deterministic), and the hotseat UI rebuilt on top (`engine/ui/index.html`).
   New provisional rulings R13-R16 (engine calls) await Bena's confirmation.
3. ~~Set up the card-scripting pipeline early~~ **Done 2026-07-16** — `scripts/gen-card.mjs`:
   validates names against the oracle JSON, grows `scripts/pool.mjs`, re-extracts
   printed.json, and emits a TODO-marked DSL skeleton + test stub per card. Proven by
   scripting the mechanics-batch-2 ten (pool now 34): stat layer 4 (Tough/Balanced, R19),
   Deadly (R21), Sneaky (R20), Feeble, the planning haste step (R18), damage triggers,
   Robot/Wisp unit tokens, and Ambush (R22 — Good Whale's parked mode included).

### M1 remaining
- 1M-game fuzz run on the server — **ready to go, not yet run** (a 2026-07-16 attempt
  was stopped early by request after 7.7k/1M games, all clean). Everything is staged:
  `test/fuzz-parallel.ts` + engine rsync'd to 192.168.100.5, user-local node at
  `~/node-v22`. Measured: ~24 games/s on 10 nice'd workers → ~12 h for 1M. Kick off with
  `setsid nohup nice -n 19 ~/node-v22/bin/node test/fuzz-parallel.ts 1000000 10 > fuzz-1M.log 2>&1 &`
  in `~/Documents/Algomancy/client/engine`. Laptop: 12.7 games/s on 7 workers.
- R7 voluntary over-assignment + a card that makes it observable.
- Stat layers 5-6 when the first Inverted/Unaware card lands (R10 is a `todo` test).
- Bena to confirm/overturn provisional rulings R13-R16, R18-R22.
