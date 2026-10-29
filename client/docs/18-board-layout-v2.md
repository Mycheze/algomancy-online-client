# 18 — The regions board

*Owner's sketch and decisions, 2026-09-22. Shipped behind the ▦ board toggle,
the default from 2026-09-26, and since board round 8 (2026-10-29) the only
board: the classic board, the toggle and the side rail are deleted.*

## Why

The classic game screen stacks the two players' regions horizontally: the
opponent's zones in a band at the top, the battle panel between, yours below.
Two things were wrong with it for players. **Regions were not legible** — whose
*territory* a card is in versus who *controls* it is the whole game, and the
board drew only control. And **the board scrolled** — with a full table you
scrolled the middle column up and down to see everything.

The regions board draws both facts, on different axes, and never scrolls.

## The topology

Board round 8 (owner, 2026-10-27, as settled at the first review; the
original 6 × 9 grid of 2026-09-22 is in git history). The play zone is a
grid of seven rows. It is a **topology, not a size map**: which areas exist,
what touches what, what each holds. Real sizes flex with the screen, the
phase and the number of cards.

```
 ┌──────────────────────────────────────────────────────────┐
 │ tinfo: their name ♥ ⭐ · cache · bin · resources (flex)   │  their FOOT:
 │ tP   their In Play (and their spell-token corner)        │  info line + In Play
 ├───────────────────────────┬┄┬────────────────────────────┤
 │ yV  my Invaders           │┆│ tF  their battle block     │  the MIDDLE — the only
 │ yF  my battle block       │┆│ tF                         │  part the seam splits
 │ yF                        │┆│ tV  their Invaders         │
 ├───────────────────────────┴┄┴────────────────────────────┤
 │ yP   my In Play (and my spell-token corner)              │  my FOOT:
 │ yinfo: resources (flex) · phase icons · bin · cache · You ♥│  In Play + info line
 ├──────────────────────────────────────────────────────────┤
 │ action bar                                               │  my region's tint and
 │ hand                                                     │  ring run on down
 ╵                                                          ╵  off the window
```

`y` / `t` = whose **region** (each region keeps one colour, gold region 0 and
green region 1, whoever is looking). `P` In Play, `F` the battle block, `V`
Invaders. Their side is yours rotated 180°: two interlocking Ls, each a
full-width foot and a column of the middle. The opponent's region is their
info line and In Play along the top and the right column of the middle;
yours is the left column of the middle and your In Play and info line along
the bottom — which continues, in your colour, round the action bar and the
hand. **Outside a battle the middle collapses to thin bands** and the two In
Plays share the height, so each region is about half the table (owner:
"deployment should still flatten, so your region gets smaller and takes up
approx the bottom 50%"). **In a battle the middle grows**: the battle block
being fought in takes the height it needs and the In Plays are the bands
round 7 plans.

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
- **The rail holds the last CLICKED card** — any card click, a move included
  except in the planning phase before its haste step (draw, draft and resource
  steps: there a click that was a move — a bottom pick, a draft pick, a
  recycle — leaves the rail alone; a haste-step play still fills it, it is
  playing a card; report #223, owner 2026-10-18, `test/497`) —
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

### Round 6 — spacing (owner, 2026-09-27)

- **Invaders beside the fight.** While a region is being fought in, its
  invaders (spell tokens that rode in, units standing in a region their
  controller does not own) stand in a strip down the RIGHT of that region's
  battle block (`.linvside`) — the columns pack left, so that side was bare
  table — and not in the full-width Invaders row, which took ~140px from the
  fight and held its columns at the 40px floor while the invaders drew at 78.
  Each strip card is 0.6× the formation's card width, so an invader is always
  smaller than the units in the line; `fitBattle`'s `side` option takes the
  strip's width out of the same box the columns stand in (the strip is
  absolutely placed, so the columns' measured box never depends on it). A
  region NOT being fought in still draws its invaders in its row, at the
  two-thirds `row` size.
- **Closer columns.** 12px card to card (gap 6, `.col` padding 3), was 28;
  `layout.ts` COL_GAP/COL_CHROME say the same two numbers. The "unblocked"
  ghost is as wide as its card and no wider.
- **The bin clears its block.** The info offshoot's bin fan sizes itself off
  the block's height (`.linfo` is the size container) with a few px of air;
  the 56px fan used to run into the region ring and under the block's edge.

### The counterattack build (CT-192, report #179, owner's layout 2026-09-30)

- **The sent units wait in a tray, full-size.** During a round-2 declare out
  of a sent pool, the builder's sent units leave the invader strip for a
  `.stagerow` tray in the fight block (`counterTrayHtml`), at the columns'
  own `--cw`; a placed unit leaves the tray for its column and comes back
  when taken out. Spell tokens that rode along keep the strip.
- **Every slot up front.** One column per sent unit, front and back each,
  drawn before anything is placed; they keep their places as units come and
  go (the declaration closes the gaps on Attack!). Number keys reach them all.
- **Where the tray stands.** Along the foot of the fight (the edge nearest the
  builder's home) when a third rank fits at the 40px floor; where it does not
  (a 768px laptop, a tablet) it stands beside the columns on the seam side,
  two ranks deep and as wide as half the pool, so no back slot is cut off
  (`layout.ts stagePlan`, `data-stage` below|beside).
- **The bar.** "Build your counterattack (N sent)", and beside *Attack with
  everything* the one-click shapes (`battle.ts counterShapes`): *One column*
  for a pool of two, *Pairs* from three up. Classic draws the slots, the bar
  and the shapes, not the tray. The watching seat's view is unchanged.
- Guard: `client/ui/test/351-counterattack-build.test.ts`; review board: the
  `counter-build` scenario (`server/scenarios-h.ts`).

### Round 7 — battle space (report #204, owner 2026-10-11)

The report: *"We should rework the whole UI, especially during battle, to
better use the available space and be more dynamic. There are so many moments
where there is an absolute ton of unused space on screen, but the units and the
'important' area is all scrunched into the side of the screen."* Measured on
HPTR before the round: in every battle slice the cards covered 5.5–12.9% of the
board. The fight's block was always half the board wide (the six equal columns),
its rows a fixed 1 : 1.5 against In Play, its cards capped at 86px (`GROW`), and
its columns packed against the block's left edge; the other region's battle
block held nothing in any slice. At 1440×900 a two-column, four-rank fight stood
at 43px beside a 1048×388 empty rectangle; at 1280×720 its back blocker rank was
cut off.

**The owner's choices** (asked 2026-10-11; not to be re-asked):

1. **The fight block grows.** The two Ls, their tints, the seam and the ring
   stay. During a battle the block holding the fight takes most of the board,
   width and height; what is not in use is "smooshed to the side" — the idle
   battle block is a narrow band at the side that still shows what it holds,
   and an empty or near-empty In Play gives its height to the fight. The
   columns stand in the middle of the fight and are sized to fill it.
2. **Units may grow to ~120px** where there is room — a moderate cap, not
   unbounded. The 40px battle floor stays the floor. *(Corrected the same day
   to 100px, and the width to "only what it needs" — see below.)*
3. **The edges do not change much**: the rail, the info offshoot, the hand
   dock, the top bar, the action bar and the 1500px `#app` cap stay.
4. **Every screen size matters equally**: it scales with the window.

**What changed** (battle only — outside a battle the board is the grid it was,
and the classic board is untouched):

- **A battle grid.** `.lboard` carries `data-fight="mine|theirs"` (whose column
  holds the fight) and style.css `.lboard.fighting[data-fight]` makes it five
  rows — band · invaders row · fight · invaders row · band — over three
  tracks. The bands (info offshoot · In Play) are still split at exactly half
  (`calc(50% - 4px)`, the old three tracks and two gaps), so the info offshoots
  keep their place and width; below them the fight's column is two tracks, the
  idle column one (`--lidle`). Each L is still a band and a column, so the tints
  (`.lback`), the seam and the ring follow by grid lines alone.
- **The shape is planned from the room** (first build; the width rule is corrected below) (`ui/fit.ts planBattleBoard`, written by
  `ui/layout.ts shapeBoard` before any zone is fitted, as `--lidle`, `--lbandt`,
  `--lbandb`). The bands stand at the info offshoot's two-line height (`BAND.two`,
  80px) while the fight can use the height; whatever the fight cannot use — its
  cards at the cap, or held by its width — goes back to the bands, half each.
  Where even the fight's floor will not stand, the bands give more, down to the
  name-and-life line (`BAND.one`; the resources clip before the name, as they
  always have) — which is what puts the fourth rank on a 720px window. The idle
  column is as wide as what it holds wants (its cards one row deep at the row
  size; the send box's cards and two-card slot at the line size), never under
  one card at the floor (two for the send slot), never over a quarter of the
  board (`IDLE_SHARE`), and never into width the fight's columns need. Its
  inputs are the board's own box, card counts and paddings, so it cannot chase
  its tail.
- **The cap was 120px** (`BATTLE_CAP`; 100px since the correction below; the field keeps `GROW`). The invader strip's
  cards stay 0.6× the line's.
- **The columns are centred** in the fight, by auto margins (which give way to
  the edge when the row is full, so a crowded row is never cut at both ends),
  in the width the invader strip leaves them (`--invw` on the block pads
  `.cols`).
- **Counterattackers on their way wrap** down the narrow idle column (fit
  `band`, the row size) instead of fanning along one row.
- **The info offshoot's two-line form applies.** Its smaller resources (24px,
  the mana inline) had never taken effect — the base rules came later in the
  file at the same weight. In a battle they do now; that form is what the bands
  are planned at.
- **The ring** takes in the visitor's info offshoot at that block's own width
  (half the board), not the fight column's; in a battle both shapes have the
  same eight corners, so the entry still tweens.

Before → after the FIRST build, on the same HPTR slices (superseded by the
correction below): the four-rank fight (s084) 43 → 66px at 1440×900,
60 → 98px at 1920×1080, and at 1280×720 still the 40px floor but with all four
ranks standing (the back blocker was cut off); the three-column attack (s129)
77 → 120px at 1440×900, 48 → 65px at 1280×720, 56 → 82px at 1344×768; the
largest empty rectangle at 1440×900 in s084 1048×388 (55% of the board) →
516×552 (39%). Cards cover more of the board in every slice at 1440×900 and
1920×1080 (s129 12.5 → 20%); at 1280×720 and 1344×768 the four-rank slices
cover less (s084 6.9 → 5.7%), because the In Play cards beside the info
shrink to give the fight its height — the trade the owner chose.

What the round did NOT change: outside a battle (the same waste is there — the
two idle bands and the stack's band — but YOUR region is the focus and stays as
it was; for a later round), the field's `GROW`, the hand dock, the column labels
and vs line inside the battle table.

#### The owner's correction (2026-10-11, same day, on a live dev server)

The first build gave the fight three quarters of the board whatever it held
(the idle column at most a quarter, the bands at their minimum, a 120px cap).
The owner, reviewing it on the HPTR slices: *"it's taking up the space that it
doesn't need. Those first several [HPTR] links were to a combat that really
didn't need all that additional horizontal space."* — *"the 120px cap is a bit
big. I think it should cap at 100px/card during a fight."* — *"the horizontal
space should be expanded *when needed*."*

The rule now (settled): **size the fight to what its columns NEED, not to a
share of the board.**

1. **Height first.** The fight takes as much height as its ranks can use at up
   to the cap; the In Play bands give way (as above).
2. **Then only the width it needs.** The fight block is as wide as its columns
   stand at that size (their gaps and chrome, and the invader strip when there
   is one) — and never narrower than the half-board block it had before the
   round. A fight that fits in half keeps the old half-and-half board EXACTLY
   (style.css `.lboard.fighting[data-fight]`: two tracks); a wider one gets
   `data-wide` (three tracks, the bands still split at half) and pushes the
   other region aside by as much as it needs, never past one floor card of the
   idle column (two for the send slot).
3. **Everything it does not need stays with the other region**, as before the
   round. So a small or height-bound fight (HPTR s084: two columns, four ranks)
   is the old 50/50 board with taller, bigger units; only a wide attack moves
   the seam.
4. **The cap is 100px** (`BATTLE_CAP`). The 40px floor stays.

`IDLE_SHARE` and the idle column's "as wide as what it holds wants" are gone:
the idle column is simply what the fight leaves. Two fixes from the batch-J
review boards (`server/scenarios-j.ts`, battle-space-*) came with it:

- **The band you build a formation FROM keeps its units at the slots' size.**
  Declaring blocks, your four waiting units stood at ~50px beside ~85px empty
  slots (the band had given its height to the fight). planBattleBoard's
  `source` — the In Play bands holding units you can put in the declaration
  (`.card.playable`, i.e. ui/battle.ts formationCandidates) — picks the
  largest card width at which the fight AND that band both stand, so the units
  and the slots match (77/77px on the defend board at 1440×900).
- **A column's label never wraps** (`max-width: var(--cw)`, one line,
  ellipsis): "column 5 · side-block" wrapped to two lines, which dropped that
  column's slots below the rest and widened it past the plan.

After the correction (`layout-measure/after2/`): HPTR s084 is 46px at
1344×768 and 66px at 1440×900 in the old half block (531 / 579px wide), every
rank standing; s129 (three columns) 82px / 100px, also in the half block; the
seven-column attack 100px in an 812px block at both sizes.

Guards: `client/ui/test/448-battle-space-plan` (the plan's arithmetic — need
not share, never under half, the 100px cap, the source band — and the DOM pass
that writes it), `449-battle-board-grid` (`data-fight` in both rounds from both
seats, the half-and-half grid and the wide one per side, the centring, the
labels), `450-ring-takes-the-visitor-info`.

### Board round 8 — more table (owner and invi, 2026-10-27 to 10-29)

The verdict: the chrome took space from the battlefield and made the eye
travel. What changed:

- **Gaps of 1–2px** between every box on the game screen (`--gap`,
  `--gap-tight` on `:root`); the cards keep clear of the ring by the blocks'
  own padding (`--ringpad`, 5px), not by gaps. `layout.ts` COL_GAP /
  COL_CHROME / INV_PAD / INV_GAP / BAND moved with the CSS (test 711 derives
  them from it).
- **Each player's info is one full-width line** (`--linh`, 76px; 68px under
  820px tall), the outer row of its region's foot. Mine: resources (they take
  the width left) · phase icons, centred on the window or as near as the line
  allows · bin · cache · name and life at the right edge. Theirs, the mirror:
  name and life with their card backs under the name · cache · bin ·
  resources. The bin and the cache keep a slot the width they need, full or
  empty, their thumbs as tall as the line allows (never under a resource
  card), the label a pill on the fan. The resources spread when the line has
  the room, fan when it does not, and shrink only when even the fan does not
  fit (`layout.ts resLine` → `fit.ts fitRes`). Their window (`ressum.ts`)
  opens over the cards only, beside the cards, and no longer repeats the mana.
  A spectator's view of the top hand is a stretch of that seat's line, which
  grows to 128px (104px) while it holds it.
- **The deck line is gone.** Hovering a name — tapping it on touch — shows
  hand, deck, recycle pile, bin and cache as numbers, with the mark's
  explanation (`ui/infotip.ts`; the name also carries the `deck:` anchor).
- **Phase icons** in my line replace the top bar's phase track: (Draft) ·
  Plan · Haste · Battle 1 · Battle 2 · Regroup · Deploy, the current one lit,
  the battle's four steps as pips, the turn as a numeral; hover or tap for
  the caption. The new glyphs are flat white SVGs in `data/icons/`.
- **No top bar** on this board.
- **The topology** above. The first build made each region a full-height
  column with its info line as the foot; the owner's review: *"you killed the
  very important dynamic resizing of the regions"* — and it put your In Play
  at the top of your column, breaking axis 1. The info lines stayed; the feet
  took the In Plays back, so the board flattens to halves outside a battle and
  the middle grows in one exactly as round 7 planned it (`--lbandt` /
  `--lbandb`, `fit.ts planBattleBoard` over the board between the two lines).
- **Your ring runs off the window.** On your region the ring is an open path
  up the left, round your column, across your foot and down the right, round
  the action bar and the hand, its ends below the window's foot. The ring is a
  fixed layer beside the board (`#app > .lring`, `main.ts lringHtml`) because
  the bar and the dock are rows of `#app` outside `.main`, which clips. Your
  tint runs on behind the bar and the dock in every phase (`#app > .ltail`);
  the dock's accent edge is gone. A visitor's name, cache and bin — the part
  of their info line that travels with them — are ringed as a loop of their
  own, since their line lies across the other region's In Play from the
  column; the loop is a point until they enter, so the entry still tweens.

- **The side rail is a 50px toolbar** (`main.ts toolbarHtml`): ☰ table, ↶
  undo, ⚖ judge, ? rules, 📝 report, ⋯ (every toggle, behind it), with the
  room and presence as one icon and both clocks at the foot; a hover names an
  icon, and the room, the game's chips and the clocks open an info tip (a tap
  pins it). The card preview pane is gone: a mouse reads a card by the zoom,
  a finger by the press-and-hold peek or a tap that moves nothing (its read
  carries the card menu, which the rail used to hold for a finger).
- **The main button names where it goes** (`ui/nextstep.ts passLabel`): To
  Blockers, To Damage, End Battle, Resolve ‹card›, End Turn, Done Deploying,
  with "‹opponent› can reply" while they still can.

Checkpoint 4 (owner, 2026-10-29):

- **Invaders are a pile** (`main.ts invaderPileHtml`): small cards (the fight's
  strip 0.45 × its units, the Invaders row half a base card, never under
  30px), each a sliver past the last and never wider than 1.6 cards
  (`fit.ts pileStepFrac`). Hovering fans the pile along its row by transform —
  rightward in the Invaders row, leftward in the fight's strip — so nothing
  else moves; a board pick on one of its cards, or a tap on its count, holds
  it fanned.
- **The token corner holds stacks** (`tokenStackHtml`): tokens alike in every
  way the board draws — card, X, mods, riding, castable, pickable — share one
  stack under a ×N count, biggest X first, and fan on hover. The corner stands
  at the OUTER end of In Play (mine right, theirs left) — at the seam end it
  crowded the units in deployment — and is sized by its stacks, so no token is
  lost to a small window. Its cards are 80% of the In Play units' (owner:
  full-size tokens "feel a bit weird"). Its heading became an info tip
  (`data-tip="tokens"`, the ✨ chip for a finger): name, count and sizes, and
  what a burst click does.
- **Their units start at the seam** (`layout.ts theirLead`): their In Play is
  the full width, but their row starts where their side of the board begins
  and fills rightward, as mine fills from the left edge of mine — at the far
  edge, a few units were easy to miss. The lead before the first card gives
  way as the row grows (review board `board8-their-wide`).
- **A stacked or piled card's zoom clears its row** (`zoom.ts clearRow`), so
  the fan it opened stays in sight.
- **The current text beside every zoom** (`main.ts zoomPanelHtml`, placed by
  `zoom.ts panelBox`): the rail's text box — current text, attributes, mods,
  the power/defense breakdown — for every card, unchanged ones too (owner:
  "so that players know where to look and what it means").

P7: the classic board is deleted (owner: "it's dumb to leave that in there"):
`algoLayout` and the ▦ toggle, the classic region panel, its token strip, the
battle panel's invader column, the side rail, its focus viewer and pin, the
top bar and its phase track. A browser that chose classic gets this board.
The stylesheet lost only the rules for deleted classes; on 26 pages the
computed style of all 10,549 elements was identical before and after.

Guards: `711-board8-lines-and-gaps`, `712-toolbar`, `716-piles-and-stacks`,
`233` (the stacks and the tip), and 318, 324, 352, 368, 448, 449, 450, 674,
687, 302 (the deck's numbers now come from the tap) and 273 §4 (the two tap
routes).

## The classic board

Deleted in board round 8 (2026-10-29). `algoLayout` may still sit in a
player's localStorage from before; nothing reads it, and 318 §1 pins that a
stored classic choice gets this board.

## Guards

- `client/ui/test/317-fit-pass.test.ts` — the fit arithmetic and the focus rule.
- `client/ui/test/324-info-block-resources.test.ts` — the resource window's
  numbers and placement, the count pills and the wake run, the zoom standing
  aside, and the pin.
- `client/ui/test/318-board-layout-v2.test.ts` — the board's census: no
  toggle, every anchor once for every state, nothing swallowed, the battle in
  the right block in both rounds, invaders and tokens where they belong, the
  stylesheet's grid.
- `client/ui/test/448`–`450` — the battle board's shape (round 7).
- `client/ui/test/716-piles-and-stacks.test.ts` — the pile arithmetic, the
  zoom clearing a row, where the token tip and the text panel stand.
- Headless: a solo Learn-to-Play game walked at 1440×900 and 1280×720 with
  `document.scrollHeight === clientHeight`, `.main` unscrollable, and no
  card, slot or column drawn outside its zone's box (2026-09-22).

## Deliberately not changed

The engine; the hand dock; the instructions/ready bar. (The top bar, the
right rail and the cache, bin and life widgets were on this list until board
round 8; the hotseat rig was deleted on 2026-09-23.)
(The targeting arrows were on this list, aiming a *formation* at the field
zone, until report RCPN on 2026-09-26: each battle half now carries
`data-fside` and a formation arrow lands on all of its player's halves.) The In Play vs
In Battle track ratio was fixed (1 : 1.5 during a battle) until round 7, which
plans the battle's rows and columns from the room there is.
