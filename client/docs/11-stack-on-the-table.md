# 11 — The stack on the table

*Built 2026-08-21, playtest round 8.*

> "All effects that can't be responded to (like haste or end of turn) happen and resolve
> instantly so it's very hard to track. The stack has a similar issue. The effects go on as
> list items. It would be better to have a little horizontal stack using actual visual cards,
> slightly overlapping, on the field."
> — Bena

Two complaints, one answer: **everything that happens gets a card on a stack you can see.**

Docs/09 made cards travel between zones and effects point at their targets. It left the
stack itself as a bulleted list in the side rail — and left the many effects that never
reach the stack with no representation at all.

## Half one: the stack is cards now

`stackBoardHtml()` (ui/main.ts) draws the stack as a strip of real card scans between the two
regions — the middle of the table, where you are already looking. The old `.stackpanel` list
is gone from the side rail; the game log took its height.

* Cards overlap left to right in the order they went on. The newest is on top, on the right,
  and is the one that resolves next — it sits proud of the rest and wears a green **next**
  chip.
* Each card keeps everything the list row had: hover opens the ability in the focus viewer
  (`previewStackHtml`, now including the `{Modular}` mods riding along), right-click still
  offers auto-yield on a trigger, and a targetable item still highlights and clicks.
* A caption under the row carries the one line of prose that matters — what resolves next,
  who owns it, and what it is pointed at.
* Only the rightmost card wears a floating chip; the others are overlapped from the right,
  so their label would be eaten. They say what they are in their own tag instead.
* The strip is `position: sticky` at **both** ends of the board scroller (`--topbar-h` is
  published by `renderNow()` so it parks under the sticky prompt rather than beneath it), so
  however far the table is scrolled the stack is on screen. Empty, it collapses to a thin
  dim rule that sticks to nothing and covers nothing.

## Half two: things that never reach the stack still get a beat on it

The rules give no response window to a haste-step card, anything played during deployment, an
activation outside battle, or a trigger between combat sub-steps. `E.commitItem(item,
'resolve')` resolves those on the spot — they are never in `GameState.stack`, so no amount of
diffing two states can find them.

So the engine announces them:

```ts
this.ev('stackFlash', '', { item: structuredClone(item) });
```

* **Rules-inert.** Nothing listens for it, nothing branches on it, no state changes.
* **Silent.** The message is `''`, which is this codebase's marker for *a signal, not a log
  line* — the reader already has "X resolves." from `resolveItem`. `Harness.absorb`, the net
  client's update handler and `server/view.ts redactLog` all skip empty messages, and both
  clients keep a `logTypes` array parallel to the **log** rather than to the event list,
  because the two are no longer index-aligned.
* **A snapshot**, because `resolveParts` is about to mark the item's parts spent underneath
  it, and the card being drawn must still show what was *about* to happen.

`ui/flash.ts` is the pure half: `queueFlashes` folds a batch of events into a queue, staggered
so a `settle()` cascade reads as a sequence rather than a fan; `stackRows` mixes the queue
into the real stack; `nextFlashWake` names the moment the strip next looks different, which is
what `main.ts` books its repaint for. Tested in `test/56-ui-flash.test.ts` with no clock —
time is a number passed in.

| knob | value | why |
|---|---|---|
| `HOLD_MS` | 1200 | "at least a second"; short enough that a six-card deployment is not a slideshow |
| `STAGGER_MS` | 280 | one batch arrives as a sequence you can follow |
| `MAX_LEAD_MS` | 2200 | past this the queue stops staggering and lets the rest land together — a long chain should crowd the stack, not queue up for half a minute |

Flashes are also spliced into the motion census (`censusWithFlashes`), *prepended* so the
greedy pairing in `diffCensus` prefers the stack over the other destination born in the same
render. That is what makes the card visibly leave the hand — or leap off the unit whose
trigger it is — and land on the stack, rather than the board simply being different
afterwards.

## The contract, unchanged

The beat is explanation, not a gate. The board underneath is final and clickable the instant
`render()` returns; a flashed card is a picture of something that has already happened. The
queue is dropped wherever the motion baseline is (`flashReset`), for the same reason: a state
that arrives wholesale — a fresh join, a resync, an undo's replay — is not something somebody
just did. `✨ motion: off` turns the whole thing off.

## Known limits

* A haste card goes hand → *(stack)* → bin in one render. Both destinations are born at once,
  the pairing picks the stack, and the bin copy pops in rather than flying there afterwards.
  A true two-hop flight would need the beat to gate the second render, which the contract
  above forbids.
* Direct actions are not stack items and correctly do not flash: recycling, prophesying,
  applying a mod, activating a resource.
* A flash carries the item's own targets, so its arrows work — but a unit it pointed at may
  already be dead by the time the card is drawn.
