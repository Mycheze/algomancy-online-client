# 19 — Tablets, foldables and drag to play

*Owner, 2026-09-27: "optimize the client for use on mobile devices (that have
large-ish screens) — an iPad or foldable phone", and "integrate dragging as an
option for playing cards and building formations". Scope settled the same day:
iPad **landscape** and **unfolded foldables** (~690–900 CSS px, near-square);
drag for **mouse and touch alike**; first scope **play from hand** and
**formation building**. Not in scope: iPad portrait as a target, folded phones,
installable-app (PWA) polish.*

## What a finger gets

- **The page lays out at its real width** (`<meta name="viewport">` in
  `ui/index.html`) — without it a foldable laid the board out at 980px and
  shrank everything, tap targets included, to ~0.7×.
- **`html.touch`** is set by the first touch/pen pointerdown (`ui/touch.ts`) —
  the event, never `matchMedia('(hover: none)')`. It hides the keyboard hints
  (`<span class="kh">(enter)</span>`), shows "tap" for "hover", and gives the
  bars and menus ~36px targets.
- **The peek.** Press and hold a card (380ms, `PEEK_MS`) and the card zoom
  opens *clear of the finger* (`zoom.ts peekBox`: above it, else below, else
  beside), held until the finger lifts. The lift is swallowed: a peek never
  plays anything. On an info block's resources it is the resource window.
  Android's long-press `contextmenu` is suppressed while a peek holds.
- **A tap only reads** (report #201, owner: "the game forced me to play my card
  in battle when I was just trying to look at it"). A tap on a card in your hand
  or cache opens the same zoom as the peek and leaves it up; the next tap
  anywhere, or Escape, puts it away and does nothing else. Playing from the
  hand is a drag (below) or the rail's buttons. A tap that answers a question —
  a discard, a hand card the prompt is asking for — still answers it. It is the
  last pointer that decides, not the device: a mouse click still plays.
- **Full control** — a held Ctrl on a desktop — is a tap on its chip.
- **The tucked hand dock** opens with a tap on its label.

## Drag to play (`ui/drag.ts`)

Pointer Events, not HTML5 drag-and-drop. A press that moves less than the slop
(6px mouse, 10px touch) is a click and the click path is untouched; past it a
ghost follows the pointer, every target is lit, and the release drops.

**Every drop is a click route** — the rule `test/329 §4` pins. The plans live
in one section of `main.ts` (`── DRAG TO PLAY`) and act only through the
functions the clicks call:

| drag | onto | runs |
|---|---|---|
| hand / cached card, planning | the table (resources lit) | `handleHandClick` → the recycle menu, at the drop point |
| hand / cached card | the table (your field lit) | `handleHandClick` / `handleCacheClick` without the mod entries: one play fires, several open the same menu |
| hand / cached card | a glowing host | `applyMod` (a card that can augment *and* graft that host asks which) |
| your unit, building | a slot, or a unit standing in one | `dropCarried`; a unit already placed moves with `formation.ts moveInBuild` |
| your unit, building | the counterattack box | `ui.send` |
| a placed unit | your field | out of the build (`takeOutOfBuild`) |
| a spell token, building | the fight / the send box, or back | the token's own click (`tokenToggleMode`) |
| a draft / bottom-2 card | the other pile | the card's own click |

**The board is not repainted under a card in the air**: `render()` defers to
the end of the drag. Pushes still land in the state; the drop is checked
against it by the click route it calls (a hand index that now names a
different card is refused). A source a repaint replaced between the press and
the slop is found again by its data attributes. Escape, a cancelled pointer or
the page hiding flies the card home.

Touch: hand cards are `touch-action: pan-x` (the dock still swipes sideways,
an upward drag is the page's); cards on the regions board are
`touch-action: none` (that board never scrolls). **The classic board scrolls,
so a finger drags only hand cards there** — it is not the default board.

## Small screens

- **Under 900px the rail is a drawer** (style.css "NARROW"): the ☰ tab at the
  top right opens it, the dimmed table or the tab closes it. Tab and scrim are
  `#app`'s pseudo-elements and the open state a class on `<html>`, so no
  repaint can lose either.
- **On touch and under 900px, the rail is small print and icons** (owner,
  second look: "the info and buttons can be even more scrunched down" — and
  then: "I meant for it just to be for the iPad and show the same, normal view
  for computers"; a computer keeps the rail as it was, built from the same
  markup with `display: contents` and `order`, and a coarse PRIMARY pointer
  sets `html.touch` at load so an iPad never opens in the desktop look): the room / name / presence line
  is one dim 10.5px line; ☰ table, 📝 report and ↶ undo are icons; **⋯ more**
  opens the rest — rules, the judge and every toggle (full control, auto-pass,
  bluff haste, motion, board, sound) — and shows the icons' words.
- **The draft step and the constructed bottom-2 are a dialog** (owner: "should
  be its own modal that can be hidden to look at board. Trying to keep it in
  the board screen scrunches things way too much"). "▁ look at the board",
  Escape or a tap outside hides it — nothing is decided, the picks are kept —
  and "↑ back to the draft" in the action bar brings it back. It is on the
  Escape ladder and in `overlayUp` like every board dialog (test/269); Enter
  still confirms it when it is the only one up.
- **The reminders** — the how-to sentence in the planning / haste / deployment
  bars, the attack builder and the draft head (`class="remind"`) — are hidden
  on touch and under 1100px (owner: "the reminder text probably shouldn't be
  there and take so much space"). A desktop keeps them for now.
- **Tall and narrow** (≤1100 wide, ≥800 tall): base cards 74px, not 62.
- **Short and touch** (<820 tall): the hand dock tucks while you build a
  formation — nothing in the hand can be played then — so a block column's
  back slot is not cut off on an iPad in landscape.
- **The card browser and the deck builder** show a card's detail as a sheet
  on the right when they go to one column, not below every result.

## Verified

Headless Chrome with real CDP input (`Input.dispatchMouseEvent` /
`dispatchTouchEvent`), a Learn-to-Play solo game, at 1280×800 (mouse),
884×1104, 1024×700 and 690×829 (emulated touch, mobile viewport): peek up,
above the finger, lift plays nothing; drag-to-recycle opens the menu at the
drop point; drag-to-play plays; a unit dragged to the front slot, the back
slot, back to the field; a press under the slop is still a click; the drawer
opens, its buttons work, the scrim closes it without acting; a live draft room
(two browser contexts) drags a card from hand to pack, mouse and touch.

## Not done yet

- A **fanned** zone on touch still fans to 14px slivers; the peek reads any of
  them, but a "spread the fan" popover for tapping one is not built.
- **Drag to target** a spell or ability (owner's second tier), and the deck
  builder, are not dragged yet.
- iPad **portrait** and folded phones were not tuned.
