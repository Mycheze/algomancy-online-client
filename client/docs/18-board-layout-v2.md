# 18 — The regions board

*Owner's sketch and decisions, 2026-09-22. Shipped behind the ▦ board toggle
in the side rail; the classic board is the default until the owner flips it.*

## Why

The classic game screen stacks the two players' regions horizontally: the
opponent's zones in a band at the top, the battle panel between, yours below.
Two things were wrong with it for players. **Regions were not legible** — whose
*territory* a card is in versus who *controls* it is the whole game, and the
board drew only control. And **the board scrolled** — with a full table you
scrolled the middle column up and down to see everything.

The regions board draws both facts, on different axes, and never scrolls.

## The topology

The play zone is a 6-wide × 9-tall grid of named areas. It is a **topology,
not a size map**: which areas exist, what touches what, what each holds. Real
sizes flex with the screen, the phase and the number of cards.

```
      c0    c1    c2  |  c3    c4    c5
r0  [their life][res ][bin] tP    tP    tP      their region: In Play      (tinfo · tplay)
r1  [hand/deck ][cache][bin] tP    tP    tP
r2   yV    yV    yV   |  tP    tP*   tP*     my Invaders row              (yinv)
r3   yF    yF    yF   |  tF    tF    tF      In Battle: mine left, theirs right (yfight · tfight)
r4   yF    yF    yF   |  tF    tF    tF
r5   yF    yF    yF   |  tF    tF    tF
r6   yP*   yP*   yP   |  tV    tV    tV      their Invaders row           (yplay · tinv)
r7   yP    yP    yP   | [bin][cache][hand/deck]   my info offshoot        (yinfo)
r8   yP    yP    yP   | [bin][res  ][my life ]
```

`y` / `t` = whose **region** (gold / green). `P` In Play, `F` In Battle, `V`
Invaders, `*` the "spawned in combat" corner of In Play — the region owner's
spell tokens sit there, visibly not in the formation. The info blocks are each
L's offshoot: part of the region, beside its own In Play, not the play area.
Their side is yours rotated 180°.

Two interlocking Ls. The opponent's region is the right column from the top
down to their Invaders row, plus the offshoot at the top left. Yours is the
left column from your Invaders row down, plus the offshoot at the bottom
right.

## The three axes

Each answers a different question a player has, and all three hold at every
size:

1. **Vertical position says who controls a card.** Your cards are on the
   bottom half of the screen, theirs on the top — even mid-attack. Your
   attackers at r5 and the token you brought at r6 are still on your half.
2. **Colour and the L say whose region it is in.** Region ≠ control. Your
   units attacking at 5,3 are drawn inside *their* colour block. Their
   Invaders row (r6) is their region but sits on your half, which is why a
   token your invader makes goes there without looking like it changed hands.
3. **The seam between c2 and c3 is the crossing.** Every attack crosses it,
   regroup uncrosses it, nothing else does.

## The movements

Everything below is already how the engine works (`Entity.region`,
`Region.owner`, `BattleState.round` / `.region`); the board only draws it.

- **Attack (round 1, IT into NIT's region).** Attackers leave your In Play,
  cross the seam into *their* In Battle block, on the battle row nearest your
  home (r5). Spell tokens brought along land in their Invaders row (r6). You,
  the player, are now in their region.
- **Block.** Their blockers come down from their In Play to the row facing
  yours (r4). Both formations are in their block; your region is idle.
- **Counterattack (units sent at block time; round 2).** Their sent units
  cross into *your* In Battle block on the row nearest their home (r3); your
  blockers come up to r4; their tokens go to your Invaders row (r2).
- **Regroup.** Everything returns to its home region.
- **Invaders** = in this region, controlled by a visitor, not in formation.

A formation column is a front unit and an optional back unit on both sides;
the back tucks behind the front within its rank, as the classic battle panel
already draws it. There is no fourth rank.

## What the board does with it

- **The battle panel is drawn once**, inside the battle block of the region
  the battle is in (`battle.region`). The other block is *idle*: it shows the
  counterattackers heading for it during round 1 (they arrive next round,
  into that block), else nothing. Outside a battle both blocks shrink to thin
  labelled bands and the In Play zones take the room (owner's choice).
- **Invaders** always render in the region's Invaders row, never in the
  battle panel's invader column (`battleHoldsInvaders` is false on this
  board).
- **The stack window** sits over the battle block of the region that is
  *not* the focus. In a battle the focus is the battle's region. Outside a
  battle the opponent's region does not exist for you — nothing in it can be
  touched from yours — so *your* region is the focus and the stack covers
  theirs. (`ui/layout.ts focusRegion`, `main.ts placeStackFree`.)
- **Never scrolls.** The board is pinned between the top bar and the action
  bar (`#app.board.v2 .main { overflow: hidden }`). After every paint and on
  every resize the fit pass (`ui/layout.ts fitBoard` over `ui/fit.ts`)
  measures each `[data-fit]` zone, counts its cards, and picks the largest
  card width from 46px up to the base `--cw` at which they all fit; below the
  floor the cards **fan** — overlapped, hover or tap raises one — never a
  scrollbar, never a "+N" pile (owner's choice). The invaders rows and idle
  bands fit by width alone, one row deep. A `ResizeObserver` on the table
  column re-runs the pass when the tucked hand dock or the action bar changes
  height without a paint.
- **Same pieces, new arrangement.** Every zone is a piece of `regionParts`
  (life, resources, hand summary and deck line, field, token strip,
  invaders, sent strip, bin, cache) or `battleHtml`, so every anchor
  (`data-animzone`), affordance and click handler is the classic board's.
  The classic template composes the same pieces and its output is byte-for-
  byte what it was.

## The toggle

`algoLayout` in localStorage (`'2'` = regions), read by `ui/layout.ts
layoutV2()`. The ▦ *board* button in the side rail flips it; it is listed on
the privacy page (`ui/legal.ts`) and in the guide's settings section
(`ui/tutorial.ts`). The regions board needs one seat to be "you" (its hand is
in the dock), so it applies to **online and Learn-to-Play games**; the two-
hand hotseat rig on `file://` keeps the classic board whatever the preference.
Flipping the default later is one character in `layoutV2()`.

## Guards

- `client/ui/test/317-fit-pass.test.ts` — the fit arithmetic and the focus rule.
- `client/ui/test/318-board-layout-v2.test.ts` — the regions board's census:
  the toggle, every anchor once in both boards for every state, nothing
  swallowed, the battle in the right block in both rounds, invaders and tokens
  where they belong, the stylesheet's grid.
- The whole rest of the ui suite is the classic board's guard.
- Headless: a solo Learn-to-Play game walked at 1440×900 and 1280×720 with
  `document.scrollHeight === clientHeight`, `.main` unscrollable, and no
  card, slot or column drawn outside its zone's box (2026-09-22).

## Deliberately not changed

The engine; the top bar; the hand dock; the instructions/ready bar; the
right rail; the targeting arrows (they still aim a *formation* at the field
zone — a `formation:<seat>` anchor on each battle side would make that exact,
and is more visible now that the field is farther from the battle block);
the cache, bin, life and hand-count widgets; the hotseat rig. The In Play vs
In Battle track ratio is fixed (1 : 1.5 during a battle), not weighted by card
count.
