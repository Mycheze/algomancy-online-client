# 07 — Visual & UX redesign spec ("MTGO-grade" client)

Status: **draft for review** (2026-07-17). Supersedes the M1 "dumb terminal" hotseat UI
(`engine/ui/main.ts`) as the *product* client. The engine, server, and redaction layer are
kept; this is a client rebuild plus modest server/home-screen additions.

## 0. What we're fixing

The M1 rig proved the engine works. It is, by its own comment, "the M1 test rig, not the
product." Concrete failings the redesign targets (Bena's brief):

1. **The stack is invisible.** It's a cramped text list in a 290px sidebar. It must be *seen*
   in the center of play and *interacted with* directly (target it, inspect it, watch it resolve).
2. **Everything is under-visualized.** Resources are 20px dots; regions are unlabeled flex rows;
   priority is a bare "Pass" button. Nothing communicates game *state at a glance*.
3. **Layout isn't table-shaped.** It should read like a game board: you at the bottom, opponent
   mirrored at the top, a shared middle where combat and the stack happen.
4. **Priority/phase are opaque.** No phase track, no sense of "the window is open, you may respond,"
   no stops/shortcuts. Passing priority "feels weird."
5. **No juice.** No motion, no sound; the player can't *track* what just happened.
6. **It's a single screen.** The product must be two tabs with genuine hidden information, entered
   from a home screen.

## 1. Design principles

- **Correctness over animation, but not *instead* of it.** MTGO-style: the truth is always legible;
  motion and sound *serve* legibility (they show causality), they don't decorate.
- **Table-shaped.** Mirror the physical game (borrow the PIL renderer's wisdom: opponent on top with
  their front row toward center, you on the bottom, hand at the base).
- **Never cover printed text.** Badges, counters, and stats attach to a card's *frame*, never over its
  rules text (the existing renderers deliberately put the stat strip below the art). Rules transparency
  is a product feature.
- **The engine is the source of truth.** The client is a view + intent sender. All legality comes from
  `legalActions`; all pauses from `state.decision`; all sound/animation from the `events` stream.
- **Use the real assets.** 361 card scans, 24 icons, canonical element colors. Compose, don't recreate.
- **One focal zone at a time** *(added from review — the linchpin)*. At every moment exactly one zone is
  lit and the rest are dimmed by a scrim (`brightness(.6–.72)`): planning → your hand+resources; stack
  non-empty → the stack; battle → the combat lane. This, plus a strict card-size ladder, is what stops
  40+ card images reading as spreadsheet mush.
- **Facts never animate; only objects move** *(added from review — architectural invariant)*. Numbers,
  legality glows, priority, and phase state update on the *same frame* the engine reports them. Motion
  depicts a card/unit *travelling* (hand→stack, attacker→lane) via FLIP on a persistent node. Input and
  legal-target highlighting come straight off `state`/`state.decision` and are **never gated on an
  animation completing**. Animations are cosmetic, interruptible, and speed-controllable down to instant.
  (This is the redesign's single biggest risk: an animation-first rebuild that adds input latency would
  feel *worse* than the current dumb terminal. The invariant exists to prevent that.)

## 2. Screen flow: home → lobby → game

```
┌── HOME ──────────────┐   ┌── LOBBY (waiting) ────┐   ┌── GAME ───────────────┐
│  ALGOMANCY           │   │  Room  ABCD           │   │  the board            │
│  [ New game ]        │──▶│  share link / code    │──▶│  (starts when both     │
│  [ Join game ___ ]   │   │  You: seat 0 ✓        │   │   seats are filled &   │
│  [ Local hotseat ]   │   │  Opponent: waiting…   │   │   ready)               │
│  [ Practice / demo ] │   │  [ Ready ]            │   │                        │
│  name: ____  ♪ vol   │   └───────────────────────┘   └───────────────────────┘
└──────────────────────┘
```

- **New game**: client asks the server for (or generates) a fresh room code, joins as a seat, lands in
  the lobby showing the code + a copyable `?room=CODE` link to send the opponent.
- **Join game**: enter a code → lobby.
- **Local hotseat**: the current both-seats-on-one-screen mode, kept for solo testing (no server needed).
- **Practice / demo**: the `?demo` mid-battle, and/or a scripted tutorial board.
- **Settings** (persist to `localStorage`): display name, sound on/off + volume, animation speed,
  "stops" preferences (see §6), left/right-handed rail.
- Server already supports join-by-room-code, seat assignment, `names`, reconnect, and persistence
  (`server/main.ts`, `rooms.ts`). Home/lobby is a thin addition; the game view is the real work.

## 3. Game board layout

Vertical, table-shaped. You are always the bottom seat; the opponent is mirrored at the top. The
center is shared space (combat lane + stack). A collapsible right rail holds log + card preview.

```
╔═══════════════════════════════════════════════════════════════╦═════════════╗
║ TOPBAR: turn · PHASE TRACK ▸plan▸haste▸[BATTLE]▸regroup▸deploy ║             ║
║         initiative ⭐ · opponent name · ♥30                    ║  CARD       ║
╠═══════════════════════════════════════════════════════════════╣  PREVIEW    ║
║  ▸ opp hand (card backs, fanned)                    (count 5)  ║  (hover)    ║
║  ▸ opp resources  [▣▣▣ open] [▨▨ face-down]         mana/aff   ║             ║
║  ▸ OPPONENT REGION  ── front row toward center ──             ║─────────────║
║ ···················· COMBAT LANE ···········  ┌─ STACK ─┐ ····║  GAME LOG   ║
║   (attackers physically move here in battle)  │ [card]  │     ║  scrolling  ║
║   facing columns, 2 deep, blockers opposite   │ [card]◀─┼─tgt ║  event      ║
║  ▸ YOUR REGION  ──── front row toward center ─┘ └────────┘    ║  lines,     ║
║  ▸ YOUR RESOURCES  [🔥 open][💧 exp][▨ dormant]     mana/aff   ║  newest at  ║
║  ▸ YOUR HAND (real cards, fanned, hover-lift)       (count 6) ║  bottom     ║
╠═══════════════════════════════════════════════════════════════╣             ║
║ ACTION BAR:  ● You have priority   [ Pass (space) ]  stops▾    ║  [collapse] ║
║              "both pass → resolve top of stack"               ║             ║
╚═══════════════════════════════════════════════════════════════╩═════════════╝
```

Responsive: rail collapses under ~1100px; on narrow the stack floats as an overlay. Card thumb size
is a CSS var (`--cw`) as today; hands fan and overlap to fit.

## 4. Component specs

### 4.1 The stack (the headline fix)
- Rendered as a **vertical column of real card faces** in the center-right of the board, top item at
  the top, slightly fanned/overlapped like MTGO's stack.
- Each item shows: the card art, controller color-edge, and a small caption (`kind`, `X=` for tokens).
- **Target arrows**: SVG lines from a stack item to its targeted unit(s)/player, drawn from
  `item.parts[].targets` (`TargetRef`: `{unit}|{player}|{stack}`). Hovering an item lights its arrows.
- **Graft composites**: `parts.length > 1` renders as a stacked/fanned group with a "⑂ n parts" tag;
  a single negation greys the whole group (matches R9 semantics).
- **Negated / fizzled**: greyed with a slash; `fizzled` gets a puff.
- **Interaction**: when a stack item is a legal target (`decision.kind==='targets'` and it's an
  option), it highlights and is clickable to target. Otherwise click = inspect (enlarge + full text).
- **Resolution animation**: on a `resolved`/`negated`/`fizzled` event the top item animates off (slides
  to its controller / puffs) with a sound; remaining items rise. Empty stack → the column disappears.

### 4.2 Resources as cards
- The resource row is **actual resource cards** laid horizontally along each player's base
  (`Fire-Resource.jpg` … or a clean generated element-card; decision in §9). Sized smaller than hand
  cards but recognizably cards, not dots.
- States map to visual affordances:
  - `dormant` → face-down/greyed card back, "asleep"; **clickable to activate** during planning (max 2,
    `activationsLeft`); a glow when activation is legal.
  - `open` → upright, faintly glowing (available mana).
  - `expended` → rotated ~90° ("tapped"), dimmed.
  - `prismite` → the silver/colorless card; during planning, click to **exchange** into an element
    (`exchangePrismite`), with an element picker.
- A compact **mana/affinity readout** sits beside the row: open mana total + per-element affinity pips
  (from `E.openMana` / `E.affinity`). Opponent's dormant resources render as unknown backs (redaction
  already sends `kind:'hidden'`).

### 4.3 Hands
- **Yours**: real card faces, fanned along the very bottom, hover-lifts a card and shows full text in
  the preview rail. Legal plays glow (green, existing `.playable` semantics). Click opens the
  context menu of legal actions for that card (play / ambush / augment / graft / recycle) — reusing the
  current menu logic, but as a nicer popover.
- **Opponent's**: fanned card backs at the top, count only (`__HIDDEN__` from redaction).
- During planning, clicking a hand card offers "recycle → element" (resource gain).

### 4.4 Regions & combat
- Each player's **region is a labeled board half**. Outside battle, units sit as a tidy flex/grid of
  cards in the owner's half (front row nearest center).
- **Battle**: the combat lane between regions activates. Attacking columns *physically move* into the
  lane (the engine literally moves attackers into the defender's region — the animation mirrors this).
  Columns render 2-deep, front-to-back; blockers line up opposite; the round-1 counterattack "send"
  zone and round-2 counter are shown explicitly.
- **Formation building** (declareAttack/declareBlocks): click a unit → it "picks up" (carry state),
  click a slot → it drops in. Front-row-first, ≤2 per column enforced client-side, `apply` validates.
  Clearer slot affordances than today (ghost card outlines, legal-slot glow).
- Column-shared attributes (Flying/Piercing/Electric/…) render as a shared banner over the column, not
  repeated per card, so the "column shares attributes" rule is visible.
- Unit chrome: stats `p/t` bottom-right, damage bottom-left (red), `+n/−n` counters as a die-badge
  (borrow the PIL renderer's die motif), mod stack as small pips down the card's left edge, `sent`/
  `absent` state as a translucent overlay. **None over the rules text.**

### 4.5 Phase track + priority HUD
- **Phase track** (top): the sequence `planning → haste → battle(declare · attackWindow · blocks ·
  blockWindow · after) → regroup → deploy → end` as a ribbon with the current phase/step lit and the
  battle round shown. This makes "where are we?" always answerable.
- **Action bar** (bottom): the single most important clarity fix.
  - Shows **whose priority** it is with a clear light: "● You have priority" vs "○ Waiting for
    opponent…" (net mode already computes this).
  - The **pass** affordance states its consequence: "both pass → resolve top of stack" or "→ next
    step." Bound to a key (space / F2-style).
  - Phase-specific primary actions live here too: "Done planning", "Attack!", "Confirm blocks", "Done
    deploying" — promoted from scattered prompt buttons to one consistent bar.

### 4.6 Card rendering
- **Tokens must render properly** *(they don't today — Bena flagged this)*. Three token surfaces, each
  with distinct chrome: (1) **spell tokens awaiting cast** sitting in a region (`Entity.kind==='spellToken'`,
  carry `x`) — a castable card with a prominent **`X=` badge** and a TOKEN frame, glowing when
  `castSpellToken` is legal; (2) **spell tokens on the stack** (`StackItem.kind==='spellToken'`, carry
  `card`+`x`) — same X badge in the stack cascade; (3) **created unit tokens** (`Entity.token===true`,
  `tokenStats`) — a unit with token chrome that visibly vanishes (erased, not binned) on leaving play.
  Burst grouping and spell tokens *riding with attackers* (`declareAttack.spellTokens`) render as tagged
  along in the formation. The X value and token identity must be unmistakable at a glance.
- Base: the card scan (`data/cards/<Name-With-Hyphens>.jpg`, served by the existing server at
  `/data/cards/…`). Overlays attach to the frame only.
- **Preview rail** shows the enlarged art + `getCard(name).text` with **icons** for costs/keywords
  (port `app.py`'s `render_card_text_html` + the `/data/icons/*.webp` set; the token→icon vocabulary is in
  `core.py`). This is where the icon reuse lands first.

## 5. Sound design

Small, quiet, functional cues driven off the **event stream** (server pushes `events[]`; the client
maps new event `type`s to sounds). Web Audio, short samples or lightweight synthesis, master volume +
mute in settings, **off until the player enables it** (respect autoplay policies — enable on first
gesture). Proposed map (from the `EventType` enum):

| event | cue | feel |
|---|---|---|
| `draw` | soft paper slide | quiet |
| `resourceActivated` | low tick | quiet |
| `spellPlayed` / `stackPushed` | soft "place" | present |
| `triggered` | light bell tick | subtle |
| `resolved` | resolve chime | satisfying |
| `negated` / `fizzled` | muted thud / fizzle | negative |
| `attackDeclared` / `attacked` | drum thud | weighty |
| `blocksDeclared` / `blocked` | shield clack | weighty |
| `combatDamage` / `damage` | impact | punchy |
| `died` / `despawned` | soft break | somber |
| your turn to act (priority to you, decision for you) | gentle ping | attention |
| `gameOver` | win/lose sting | finality |

De-dupe: only play for *new* events since last render; cap concurrent sounds; never stack the same
cue twice in a frame.

## 6. Interaction model: priority, stops, shortcuts *(rewritten from review)*

MTGO's biggest lesson is **not making players click "pass" constantly — while never letting the game
fly past a window where they wanted to act.** The first draft got the core condition backwards; this is
the corrected model, mapped to *this* engine (`passPriority`, two-passes-resolve, `state.decision`).

- **Auto-pass fires whenever your *only* legal action is `passPriority`** — stack empty **or non-empty** —
  and no `state.decision` targets you and no stop/yield break condition holds. (The empty-stack gate was
  the bug: the whole point is to auto-pass through the opponent's spells you can't answer.) Auto-pass is
  **re-armed on every state change** and only ever sends a pass the server would already accept — the
  server stays authoritative.
- **Decisions are hard stops.** A pending `state.decision` whose `seat` is me (`targets` / `orderTriggers`
  / `electricPath` / `payOrDecline` / `insertGraft`) is a `decide` action, never a pass — auto-pass and
  yield can **never** swallow it. Auto-pass/yield apply *only* to `passPriority` windows.
- **Hold priority** *(was missing — the #1 power-user interaction)*. After you act you **retain** priority
  by default and must pass to hand it over (so you can stack two battle cards before the opponent
  responds). A "yield after this cast" toggle passes automatically instead.
- **The pass loop-back must be visible.** When you pass, the opponent responds, and the stack grows,
  priority **returns to you** — the action bar must announce it ("opponent responded — your priority"),
  and auto-pass/yield **break on stack growth**. Silently re-entering a window you thought you'd left is
  the #1 misplay source; we surface it instead.
- **Stops** are player-set points where the client always stops even if auto-pass could fire. They map to
  *this engine's real windows*, not MTG's: phase/step stops on `planning · haste · battle{declare ·
  attackWindow · blocks · blockWindow · afterWindow} · deploy`, plus **conditional** stops ("stop when I
  hold a battle-castable card / a virus / an instant-speed response"). Stops are asymmetric (settable on
  your windows and on the opponent's) and only matter when you'd *have* priority — a stop never grants
  priority you don't hold. There is **no "combat damage" step** to stop on (damage happens on the
  two-pass advance out of `afterWindow`); the stop vocabulary reflects that.
- **Yield / pass-until** with explicitly enumerated break conditions: the stack grows, a decision targets
  you, a conditional stop becomes true, or you reach a step you've stopped on.
- **Armed state is always visible.** If auto-pass/yield is about to skip the next N windows, the action
  bar shows it **armed with one-click cancel** — otherwise the turn "flies by" and reads as broken.
- **Keyboard**: space/F2 = pass/OK, enter = confirm primary, esc = cancel/close menu, number keys pick
  menu items, `u` = undo target selection where legal, Tab/Enter cycles+picks targets. `?` help overlay.
- **Targeting** stays click-to-select against highlighted candidates (unchanged engine contract), with
  arrows and a clear "click a highlighted target" affordance; also keyboard-cyclable.

Only *my* legal actions/decisions ever produce interactive affordances; the opponent's turn shows a
calm, *informative* waiting state (§4.7), never their buttons.

## 7. Technical architecture

The current client re-writes `#app.innerHTML` after every action. That's fatal for animation (DOM
nodes are destroyed, so nothing can transition) and awkward for sound (hard to know what's *new*).
The rebuild introduces a thin persistent-DOM layer while keeping the engine/backend contract.

- **Backend contract unchanged**: `interface Backend { state; log; do(action) }` with `Harness`
  (hotseat) and `NetBackend` (remote) implementations — both already exist. Add an `events` feed so the
  client can react to *what happened*, not just the new state (NetBackend already receives `events`;
  Harness returns them from `do`).
- **Keyed render / reconciliation**: cards, stack items, and resources are DOM nodes keyed by
  `EntityId` / stack id. A render pass diffs against the previous keyed set: create/move/remove nodes
  instead of nuking everything. Movement uses **FLIP** (measure First/Last, invert, play) so a card
  gliding from hand → stack → combat lane is a CSS transform transition on the *same* node.
  - Framework-free to match the repo's zero-runtime-dep ethos (esbuild only). A ~150-line keyed-list +
    FLIP helper covers it. (Decision point in §9 — a tiny lib is an option.)
- **Sound engine**: a small module that, given the delta of new events, schedules cues. Preloads a
  handful of assets; obeys the mute/volume setting.
- **Server additions**: a home page + lobby served alongside the existing bundle; a create-room path
  (or purely client-generated codes, which already works); pass `names` on join (supported). Everything
  else — authority, redaction, reconnect, persistence — is reused untouched. Keep the redaction
  allowlist honest: any new hidden `GameState` field needs a `view.ts` update + a `test-drive.ts` check.
- **File shape** (proposed): `engine/ui/` grows from one `main.ts` into
  `app.ts` (bootstrap + routing home/lobby/game), `render/board.ts`, `render/stack.ts`,
  `render/resources.ts`, `render/hand.ts`, `render/combat.ts`, `render/hud.ts`, `card.ts`,
  `icons.ts`, `sound.ts`, `flip.ts`, `net.ts` (extracted NetBackend), `home.ts`, `style.css` (split or
  kept single). Still bundled by `npm run build:ui`.

## 8. Asset reuse map

| need | source |
|---|---|
| card faces | `data/cards/<Name-With-Hyphens>.jpg` (361), served at `/data/cards/` |
| element / keyword / cost icons | `data/icons/*.webp` (24); vocabulary in `core.py`, HTML render in `app.py` |
| card data / text | `engine/src/cards/printed.json` via `getCard(name)`; oracle JSON for the full 370 |
| element colors | fire `#E2503B` water `#3B82E2` earth `#9C6B3F` metal `#A8B0B8` wood `#4FAF58` |
| theme | existing CSS vars (`--bg #12151a`, `--accent #d9a441`, glow/target/danger trio) |
| layout wisdom | `wtp.py` PIL renderer + `static/board.css` (facing columns, stat-below-art, die counters) |
| resource card art | `Fire-Resource.jpg` etc., `Cardback.jpg` |

## 9. Open decisions (Bena's call)

1. **Render approach**: framework-free keyed-DOM + FLIP (matches repo ethos, ~150 LOC to maintain) vs.
   pull in a tiny reactive/animation lib. *Recommendation: framework-free.*
2. **Resource card look**: ✅ **DECIDED — use the literal `*-Resource.jpg` scans.** The art already
   exists (`Fire/Water/Earth/Metal/Wood-Resource.jpg`, `Dormant-Resource.jpg` back, `Prismite.jpg`), and
   it maps cleanly to states: dormant = the face-down `Dormant-Resource` back, open = the element card
   face-up, expended = element card tapped 90°, prismite = `Prismite.jpg`. Opponent's dormant resources
   naturally read as the generic back (hidden), their open ones as the real element card (public).
3. **Animation intensity**: MTGO-restrained (fast slides, minimal) vs. more Arena-like juice.
   *Recommendation: restrained; it's a spreadsheet simulator with taste.*
4. **Sound source**: ✅ **DECIDED — synthesized in-code (Web Audio), tunable, no asset files.** Master
   volume + mute in settings; enable on first gesture (autoplay policy). Swap to samples later if wanted.
5. **Scope of first playable**: full board + stack + combat + sound in one pass, vs. staged
   (board/resources/hand → stack → combat → sound). *Recommendation: staged, but all landing.*
6. **Home screen breadth**: minimal (new/join/hotseat/demo) vs. also a settings panel + reconnect list.
   *Recommendation: minimal + settings; reconnect is already handled by rejoining a code.*

## 10. Milestones

- **R0 — scaffolding**: split the client into modules; introduce the keyed-render + FLIP layer behind
  the existing look (no visual change yet, proves the architecture). Home/lobby shell.
- **R1 — table layout**: the board rebuilt table-shaped; resources-as-cards; hands top/bottom; regions
  as halves; phase track + priority HUD. (No combat lane motion yet.)
- **R2 — the stack**: center visual stack with target arrows, graft groups, resolve animation.
- **R3 — combat**: combat lane with attackers moving in; formation building; blockers; counterattack.
- **R4 — sound + stops**: event-driven sound; auto-pass/stops/shortcuts; help overlay.
- **R5 — polish**: responsive rail, settings persistence, win/lose screen, reconnect UX, a11y pass.

Each milestone stays playable end-to-end in two tabs. **Two ordering changes from review**: (a) the
premium-defining CSS — card elevation, vignetted felt, the size ladder, focal dimming — lands in **R1,
not R5** (it's ~15 lines and it *is* what the brief asks for); (b) a scripted **coach/first-game** board
lands by **R1–R2**, not R5, because a first-time *pair* is the biggest failure risk (§13).

---

## 11. Accessibility & responsiveness *(new — was a hole)*

- **Element = icon + shape, never color alone.** fire/earth (`#E2503B`/`#9C6B3F`) and metal/water are
  red-green / low-contrast collisions for ~8% of players. Every element is coded by its `data/icons/*.webp`
  glyph *and* a distinct chip shape/label, with color as reinforcement only. (Nearly free — icons exist.)
- **`prefers-reduced-motion`**: FLIP transits collapse to instant; every state stays fully legible with
  motion off. Principle "facts never animate" already guarantees the game is playable animation-free.
- **Keyboard scope, honestly stated**: priority/menus/targeting are fully keyboard-driven (space/enter/
  esc/numbers/Tab-cycle). Formation-building (carry-drop) is mouse-first with a keyboard fallback; if the
  fallback slips a milestone we say so rather than implying full keyboard parity.
- **Screen floor**: designed for **≥1024px landscape**. The rail collapses under ~1100px and the stack
  floats as an overlay; below 1024 we show a "best on a larger screen" notice rather than shipping an
  unusable 375px board. Phone is out of scope for v1.

## 12. States & errors matrix (§4.7) *(new — the real product surface for a novice pair)*

Today every failure is one global `uiError` string, wiped on the next action. Replace with a designed
state for each cell. The client is always in exactly one connection-state and shows the right affordance:

| state | what the player sees | recovery |
|---|---|---|
| connecting | spinner + "connecting to server…" | auto-retry |
| joined / lobby | room code, **copy-invite-link**, live "opponent connected ✓/…", Ready (cancellable) | — |
| waiting on peer (in game) | **what** you're waiting on ("opponent is choosing blockers / planning") + live dot + elapsed timer | — |
| peer dropped | non-destructive banner: "opponent disconnected — game paused & **saved**, reconnecting…" shown to **both** sides | auto-retry; resume on rejoin |
| you dropped | "reconnecting… 3s" auto-retry banner, **never** "refresh to reconnect" | auto; localStorage remembers the room |
| illegal action | the **offending card/target** shakes with an inline reason — not a top bar the eye has left | dismiss on next act |
| decision for you | board dims to a scrim, the prompt pulls focus + a gentle ping; never scrolls off | answer |
| game over | win/lose screen (forfeit-on-disconnect handled explicitly) | rematch / home |

- **Invite, not a code to transcribe**: New-game mints the room and lands the host in the lobby with a
  one-click **Copy invite link** (`?room=CODE`, no seat). The joiner clicks it and is **auto-seated** —
  players never see "seat 0 / 1" (that stays behind hotseat/debug).
- **Rejoin discovery**: persist the active room to `localStorage`; show a **"Rejoin game in progress"**
  card on Home. The engine supports rejoin; only its *discovery* was missing.

## 13. Onboarding & always-visible info

- **Scripted coach** (extends the existing `demoBattle()` generator): the first thing New-game offers a
  novice is a solo board that walks one planning→battle loop with callouts. First time an attacker
  crosses the lane, a one-shot coach-mark ("attackers move into the enemy region") so the signature
  mechanic doesn't read as a bug. First time a resource state matters, a callout naming dormant/open/
  expended. Reuses the event stream (§5) to fire callouts on first occurrence.
- **Glossary on hover** for every unusual term (region, prismite, FILO stack, formation, graft/augment/
  virus) — cheaper than a full tutorial, covers the long tail.
- **Always-visible readouts** a competitive player needs (were missing): **opponent's open mana, per
  element** (open resources are *public* — dormant is hidden, open is not); your open mana + affinity
  pips; **armed auto-pass/yield** with cancel; **pass-progress** ("you passed — waiting" vs "your
  priority — last word", including who acts first this window via initiative); a reserved, server-
  authoritative **clock** slot (even if casual games run untimed); optional **combat projection** ("if
  unblocked you're at X"). Mods on a unit **hover-expand** to show the grafted/augment cards fanned.

## 14. Art-direction implementation specs *(concrete numbers to build R1 from)*

**Size ladder** (multipliers on `--cw`, base bumped `78→82px`): your hand `1.15×` · your units `1.0×` ·
opponent region + hand-backs `0.88×` (subordinate, "farther") · resources `0.66×` · **active stack
`1.25×`** (the largest thing on the board while it exists).

**Felt & depth**: board bg = `radial-gradient(ellipse 120% 80% at 50% 42%, #1b2129, #12151a 60%,
#0d1013)` + a ~3% tiled noise data-URI. Regions are soft inset *fields* (`border-radius:14px`, `inset
0 0 0 1px rgba(255,255,255,.04)`), not `--line` boxes; opponent half tinted imperceptibly cool, yours
warm. Cards get real elevation: `box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 3px 8px rgba(0,0,0,.35)`,
lifting on hover; `border-radius:6px`; a 6px outer mask so 361 differently-bordered JPGs read as one deck.

**Glow budget (avoid the Christmas-tree tell)**: states are layered box-shadows, not hard outlines; one
hue per meaning — playable `#6fc36f` (static glow), candidate `#e0b93c` (the board's **only** looping
pulse — motion = "act here"), selected `#7fc0ff`. Only the **focal zone's** cards may glow; never >1
state class per card.

**Stat plate**: bottom-anchored `linear-gradient(transparent, rgba(0,0,0,.85))` over the lowest ~22% of
the card (never the text box), element-colored left border, `tabular-nums`.

**Stack**: non-empty → backdrop `blur(2px) brightness(.7)` scrim so it floats; vertical cascade
(`translateY(28px) translateX(10px) scale(.97^depth)`, `rotate(-1.5deg)` jitter), newest largest on top;
4px left edge in the *controller seat* color (you gold `--accent`, opp steel `#6f8bc0`). Target arrows on
one SVG overlay: quadratic Bézier, 2.5px, amber `#e0b93c`, `drop-shadow` glow, arrowhead, **35% opacity
default → 100% on hover of that item**, per-part colored for graft composites, animated `stroke-dashoffset`
flowing source→target. Resolve: top item `scale 1.25→1.32` + white-flash 8% → slide to controller region
`260ms cubic-bezier(.4,0,.2,1)` + fade, remainder FLIP-rises `220ms`. Fizzle: `scale(.7) blur(4px)` fade
`200ms` (goes *nowhere* — causal distinction from resolve).

**Resource chips** (generated, not scans): rounded `0.66×`, `linear-gradient(160deg, color-mix(el 30%,
bg), bg)`, element icon centered. dormant = cardback `grayscale brightness(.45)` dashed (green breathing
glow when activatable); open = full-color + `0 0 10px -3px var(--el)`; expended = `rotate(90deg)
brightness(.5)` with a visible `.18s` rotate on activation; prismite = iridescent silver, slow 8s hue
shift, click → radial element picker. Mana/affinity = filled-pip / hollow-ring strip beside the rail.

**Motion vocabulary** (consistency reads as premium): two easings only — enter/move
`cubic-bezier(.2,.7,.3,1)`, exit `cubic-bezier(.4,0,1,1)`. Durations: micro 120–160ms · transit
240–280ms · emphasis ≤300ms, all × a settings `--anim` multiplier (incl. 0/instant). MOVE (transform,
FLIP): hand→stack, stack→region, attacker→lane, resource-tap, draw (scales from deck, 200ms). FADE
(opacity/filter): fizzle, death desaturate, damage flash (90ms red `brightness(1.4) hue-rotate(-30)` +
3px shake), negation scrim, log append, focal dim. NEVER animate: numbers, legality, priority, phase.

**Typography**: two-tier — condensed display face + `tabular-nums`, `.08em`, uppercase for the phase
track / life / stack captions; keep `system-ui` for body/log.

## 15. Focus-driven, per-phase layouts *(the governing model — from Bena's hand-authored layouts)*

The board is **not one static layout**. It reorganizes per phase, and within battle per *which region
is contested*, always enlarging what matters right now and shrinking what doesn't. Reference layouts
(3 views, with mirrors to be derived) live in `engine/ui/layouts.json`. The rules:

- **Battle = the contested region is the centerpiece, and combat is *combined into that region*.** When
  you attack, the **opponent's region + combat** fill the center huge (their region is where the fight
  is — your attackers physically moved there); **your own home region is small and unimportant** (your
  units left it). The opponent's hand/resources/bin/info compress to a thin, glanceable, expandable top
  strip. Your hand/resources/bin stay large at the bottom. This **flips** when the opponent attacks you
  or on the round-2 counterattack: *your* region+combat becomes the centerpiece, theirs shrinks. So
  "combat" combines with the **defended** region (whichever it is), never fixed to one seat — my earlier
  attempts wrongly pinned combat to "your region" and kept the opponent at fixed prominence.
- **Planning ≡ Deploy: solo "goldfish" phases.** No live opponent interaction. Your board is huge and
  central; the opponent is crushed to a small top strip you *can* expand if curious but normally ignore.
  You act privately. **Ctrl+Z / undo is available** during these phases (nothing is committed or
  interactive — this maps naturally onto the engine's action-log: undo = drop the last action and
  replay). After you commit (Done), you watch a **replay** of what the opponent did during their
  simultaneous solo phase. Regroup / end-of-turn use this same solo-focused shape.
- **Your stuff is always big; the opponent's is compact-but-expandable.** Prominence tracks relevance.
- **The stack is a free-floating box the player positions themselves** (MTGO-style), persisted as a
  per-user preference — not docked to a fixed spot.
- **Columns / who's attacking must be legible** in the enlarged combat centerpiece (big cards, clear
  column grouping).
- Layouts **mirror**: the two seats are inverses of each other, and the two battle directions are
  inverses. I only need to author one side and reflect it.

Implementation: ship a small **layout table keyed by (phase, contested-region, seat)** producing each
zone's rect + card-scale (exactly the editor's output shape). The renderer places zones from that table
and transitions between them when the phase/focus changes. `layouts.json` is the seed; the floating
stack position and "expand opponent" toggles are user prefs layered on top.

New engine-facing needs this surfaces: **undo during planning/deploy** (action-log truncation + replay,
client-guarded to the current solo phase) and an **opponent-turn replay** for the simultaneous solo
phases (feed the redacted event/action stream of the opponent's committed phase to the client to play
back). Both fit the existing seed+action-log architecture.

**Decisions (✅ from review):**
- **Opponent solo-phase reveal** = *animated replay on the board* (their cards play out, skippable) **plus
  a persistent, re-openable/scrubbable log*. Drive it from the redacted event stream of their committed
  phase.
- **Undo during planning/deploy** = *single-step* (Ctrl+Z undoes only the most recent action, one level).
  Simple and predictable; maps to popping the last action and replaying. (Not full-phase, not
  haste-excluded — just one level.)
- **Views to build**: Planning, Battle, Deploy (+ their mirrors for the other seat / attack direction),
  **plus a Targeting/Response overlay** (dim board, highlight candidates, draw target arrows) **and a
  Game-over/results screen**. Regroup/End-of-turn reuse the solo-goldfish shape (not distinct views);
  no separate mulligan/game-start view for v1.
- Reference layouts (Planning/Battle/Deploy, Bena-authored) live in `engine/ui/layouts.json`; the live
  renderer that consumes them is `engine/ui/focus-board.html` (the seed of the real layout engine).
