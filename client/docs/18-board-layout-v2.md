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

## The owner's first review (2026-09-23)

- **No captions.** "Region of …", "invaders in … region", "battle line of …",
  the invaders / spell-token / incoming strip labels and the battle panel's
  title are gone from this board — they were for planning it. The colour and
  the shape say whose region; the action bar says what to do. An empty
  Invaders row collapses to nothing.
- **One colour per region, whoever is looking.** Region 0 is gold, region 1
  green (`rc<region>`, `--rgn0` / `--rgn1`), so "the green region" is the same
  place to both players on a call. The In Play and battle blocks of a region
  are one tint — the two rectangles of each L no longer overlap (they did, and
  the doubled tint made In Play read as a different place from the battle).
- **The ring.** One border round the whole L of the focus region — offshoot,
  In Play, battle block, Invaders row — and, once the visiting player has
  ENTERED the region (declared the attack: the engine's `presentSeats`), round
  their info offshoot too, which travels with them. While they are still
  choosing attackers they are not there yet; when they commit, the ring grows
  over their info (a ~0.4 s tween of the path, gated on the motion pref) —
  owner, 2026-09-26. An SVG path drawn from
  the measured blocks after the fit pass (`ui/layout.ts ringBoard`). The stack
  window wears the same colour. The battle block has no border of its own.
- **The counterattack send box is in the other region.** During round-1
  blocks, `battleHtml({ sendApart: true })` leaves the send column out and
  `counterSendHtml` draws it in the ATTACKER's battle block — where the
  counterattack will be fought — as one long slot, a formation's width, on the
  edge nearest the sender's home. Same `data-act="sendslot"`, same `ui.send`.
- **Tokens and invaders at full size.** The spell-token corner is a fit zone
  of its own (`.ltok`), one or two base card widths wide and the full height
  of the block (the classic strip's `align-self: flex-start` had left its
  token zone zero pixels tall — the tokens could not be clicked). The Invaders
  rows fit one row deep at the full base width (`data-fit="line"`), not the
  classic strips' two-thirds.

### Round 2, same day — sizing (owner on a 1344×768 laptop)

- **The info offshoot never overflows.** It is a CSS size container; the
  grid inside it (`.lin`) is three short lines (name and life / resources /
  hand and deck) when the block is tall and two when a battle takes the
  height, with the cache and bin as fixed 34px thumb fans on the seam side.
  Before, four pieces stacked three deep in a block two field rows tall: the
  bin was clipped and ran into the resources, and the cache grew to 120px.
- **Resources are grouped** (`resGroupedHtml`): open, then expended, then
  dormant, each by element, each run of one kind overlapped into a fan.
  Order is not meaningful (owner); each card keeps its own `data-i`.
- **Cards grow into spare room.** The fit pass may size a field or the battle
  up to 1.5× the base card width (`GROW` in `ui/layout.ts`), not only down
  from it. One-row zones in auto-sized rows still cap at the base.
- **A buffer inside the ring.** Every block has 6px 10px of padding.
- **Idle bands collapse** to nothing outside a battle; the grid gap alone
  separates the regions, and the stack window still centres on the band.
- **The hand dock** has no caption (except while tucked) and 76px cards on a
  window under 860px tall.

### Round 3 — the card zoom (owner: "like the Mac apps bar")

- **Growth is capped at 1.1×** (`GROW`): 1.5× read as "huge". Cards on the
  table are meant to be fairly small; the zoom is how one is read.
- **Hovering any card with a picture magnifies it in place** (`ui/zoom.ts`):
  field, battle, hand, bin and cache thumbs, resources, the stack. A copy of
  the card on one fixed layer (`#cardzoom`, z 90, pointer-inert, every
  `data-*` stripped), laid out at 240px wide and animated out of the card's
  own box, centred on it and pushed inside the window — a hand card grows up,
  like a dock icon. A copy, not `transform: scale`, because every zone on this
  board clips. After a repaint it re-finds the card under the cursor with no
  animation. Mouse only; a finger taps, and the tap fills the rail.
- **The rail holds the last CLICKED card** — any card click, a move included —
  and no longer follows the hover; no pin, no badge. The long-hover text box
  is off (the zoomed scan is what it was for). The rail is 250px (was 290).
- All of it rides the ▦ regions preference (`zoomOn()` = `layoutV2()`); the
  classic board is unchanged. `test/322-card-zoom` pins the geometry.

### Round 4 — the zoom reads like the card (owner, 2026-09-26)

Six asks, all on the zoomed copy (`ui/zoom.ts`, the decorator in `main.ts`,
the "round 4" block of the zoom section in `style.css`):

- **Mods hang under a zoomed unit**, cut at each mod's own augment/graft
  symbol — the rail's strips, from the same builder (`modStripsHtml` →
  `inspect.ts modStrips`). The box makes room for them (`zoomBox`'s
  `extraH`), so a modded unit in the bottom row rises far enough.
- **Every chip is a die on the art**: the full list, unfolded and
  unsqueezed (`unitBadges` / `handBadges`, pulled out of `unitHtml` and
  `handZoneHtml` without changing their output), below the name bar and any
  prophecy banner. A counter and the damage are square dice.
- **The icon in a chip sits beside its word** — `.card img { display:block }`
  was reaching it. This one is global: the table's chips had it too.
- **Live P/D where the card prints it**: top right, over the printed pair,
  the same size; the printed base just under it when it differs.
- **A click that opens a menu holds the zoom** until the menu closes; the
  menu goes beside the held card (`menuBeside`) and outranks the zoom layer.
- **The zoom follows the pointer, not the event history** (`zoomCheck`): a
  card that moved out from under a still cursor — the tucked draft dock
  dropping back after a click — used to leave the copy stranded until the
  cursor crossed another element's edge.
- **The ring survives the zoom**: thicker, with a glow in its own colour; the
  copy's black shadow no longer overrides the box-shadow rings.

### Round 5 — the info offshoot (owner, 2026-09-26)

- **Pinned to the outer edge.** The offshoot's grid packs against the screen
  edge (theirs the top, yours the bottom) instead of centring, and the cache
  and bin hug the same edge, so the name and life stay put in both the
  three-line and the two-line (battle) variants. So do the name and hand
  lines inside the edge row: a cache spanning the rows had stretched that row,
  and centred in it the life dropped 56px. The initiative ⭐ keeps its width
  when the other seat has it (`pnameFixed`), since it used to push the
  opponent's life 19px sideways every turn. A block too short for its content
  clips the resources, never the name. The owner chose to keep three
  lines, so the hand/deck line still moves when the resources wrap.
- **Resources you can count.** Every scan has a 1px edge, dark on most and
  light on Dark and Shard (their faces are near black). A run of two or more
  carries a count pill. The mana is a bold number.
- **One window for the row, not a zoom per scan** (`ui/ressum.ts`, the numbers
  from `resources.ts resourceSummary`). Hovering the row shows the mana, the
  activations left in planning, and a line per kind: open, expended, dormant,
  and the affinity, which is `E.affinity`. It sits beside the row, under the
  opponent's and over yours, and never on it. `zoomTarget` leaves these
  resources alone, and the grouped cards drop their native `title`. A click
  still puts the scan in the rail.
- **Dormant resources you can activate do not fan.** A dormant run with a
  legal activate or exchange is `.wake`. It sorts first, beside the pinned
  name and life, draws its cards 34px wide and side by side with the glow, and
  one click on any of them activates it (owner: *"without having to thread the
  needle"*). They wear the glow ring, which the classic dormant outline had
  been overriding.
- **The frame holds still too** (the owner said yes to the cost). The
  offshoots are pinned to the board's edges, and the edges moved with the
  chrome: the top bar wrapped to two lines when the pass-through or catch-up
  chip showed (+56px), and the action bar was 48px in a battle, 78px in
  deployment and 109px in planning, and an empty hand collapsed the dock by
  ~88px. On this board the top bar is one 34px line (the phase track and the
  initiative note are clipped before the chips, which are the only way out of
  the pacing, and the chips are no taller than the line), and the dock stays
  one card tall with no cards in it.
- **The action bar's floor came back out** (owner, same day). For one round
  it never went below 110px, the planning prompt's height, so the board did
  not move between phases — at ~60px of a battle on a 768px window. In play
  the battle's one line of buttons sat in a bar "much larger than normal",
  and the owner chose the room over the still frame: the bar fits its content
  again, and the board moves by its height between phases.

The vertical budget is the constraint left: on a 768px window the board gets
~450px after the top bar, the action bar (48–115px) and the hand dock
(130px), and a battle needs its three ranks inside ~220px of it.

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
- `client/ui/test/324-info-block-resources.test.ts` — the resource window's
  numbers and placement, the count pills and the wake run, the zoom standing
  aside, and the pin.
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
