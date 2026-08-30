# 09 — Visual clarification: card motion & targeting arrows

*Built 2026-08-20, playtest round 7.*

> "It's really hard to tell what's happening unless you're super tuned into the game."
> — Bena

The client was correct and unreadable. Every action re-rendered the whole board, so a card
going from hand to stack to field to bin was three instantaneous swaps in three different
corners of the screen, and an effect's targets existed only as a comma-separated tail on a
log line. This is the first pass at making the board *legible at a glance*: cards visibly
travel between zones, and effects visibly point at what they are aiming at.

## The contract

**Motion explains what the engine already did. It never gates it.**

Both overlays live outside `#app`, are `pointer-events: none`, and are painted *after* the
new board is already in the DOM. The board is final and clickable the instant `render()`
returns — you can click straight through a card that is still in the air. Nothing in the
animation path can swallow an input, delay an action, or change what is legal. That keeps
faith with the project's founding line ("correctness over animations", docs/README).

## Why a state diff and not an event feed

The obvious design is "listen to engine events and animate them". It does not work here:

* the client re-renders **everything** after every action, so no DOM node survives to be
  animated — there is nothing to attach an event to;
* in network mode the server sends log events as `{msg, type}` only (`server/view.ts`) —
  no entity ids — so an event-driven client would need a new wire format and a new
  redaction audit;
* one action routinely moves several cards (a resolution kills a unit, bins the spell and
  spawns a token), and events do not tell you which DOM box each one ended up in.

So instead: **take a census of the state before and after, and diff it.**

## The pieces

| file | what |
|---|---|
| [`ui/motion.ts`](../ui/motion.ts) | pure: `census(state)` → slots, `diffCensus(a, b)` → moves + pulses. No DOM. |
| [`ui/anim.ts`](../ui/anim.ts) | DOM: FLIP, ghost flights, the SVG arrow layer. Knows nothing about Algomancy. |
| [`ui/main.ts`](../ui/main.ts) | tags every card with its slot key, wraps `render()`, decides which arrows to draw. |
| [`engine/test/51-ui-motion.test.ts`](../engine/test/51-ui-motion.test.ts) | 17 tests over the diff — every route a card takes, and the ways it can go wrong. |

### Identity across zones

The whole problem is: *which card is this, next render?* Keys are per-zone:

```
field / mod entity   e<id>              stable — the engine's entity id
stack item           s<id>              stable — the engine's stack id
cache entry          c<uid>             stable — R41's uid
hand / bin card      h<seat>:<name>#k   the k-th copy of that name
```

Hand and bin hold bare `CardName`s with no identity of their own, so "the k-th copy" is the
best handle available — and it has the property we want: playing the 2nd of 5 cards retires
exactly one key and leaves the other four untouched, where an index key would renumber
everything after it.

A card changing zone therefore changes key, and **no key survives the trip**. That is what
the pairing pass is for: a key that vanished and a key that appeared naming the same card
are the same physical card, moving. Pairs are scored (same name +5, same seat +2, plausible
zone transition +1) and taken greedily best-first. A face-down `__HIDDEN__` card matches any
card of the *same seat*, which is exactly how "the opponent played something" gets animated
in network mode.

Wrong pairings are possible — two copies of one card, one dying as the other is cast — and
are fine. The worst case is a card scan flying to the wrong twin for 300ms.

### What the DOM layer does with it

1. **FLIP** for keys that survived: a unit walking from its region into an attack column is
   the same element in a new place, so it slides.
2. **Ghost flights** for keys that changed: a `position: fixed` card scan arcs from the old
   box to the new one, and the destination stays blank until it lands. Endpoints that are
   scrolled off-screen are pinned to the nearest viewport edge, so the far seat's hand still
   reads as "a card came from down there" rather than silently popping.
3. **Pulses** for keys that survived with different numbers: damage, counters and life
   flash red or green in place.
4. **Zone anchors** (`[data-animzone]`) catch everything with no per-card element — the bin
   mini only shows three scans, the deck is a counter, a mod is a badge on its host.

Capped at 12 flights per render: past that a resolution chain reads as confetti rather than
as "that card went there".

### Two things a state diff cannot see, handled explicitly

* **Triggered/activated abilities** are not a card changing zone — nothing left a hand — but
  they *did* come from somewhere. A stack slot carries an `origin` hint (`e<sourceId>`), so
  the ability visibly leaps off the unit that produced it. That is the whole answer to "why
  is this on the stack?".
* **Draw / recycle / bottoming** have no slot on one side (the deck is a number). The diff
  falls back to the size deltas it *can* see: a hand card that vanished while the resource
  row grew flew into the resource row.

## Targeting arrows

An SVG overlay, redrawn on hover, scroll, resize, and as card art lands (a board whose scans
have not arrived measures as a stack of zero-height boxes — the first version drew nothing at
all for exactly this reason).

| arrow | when |
|---|---|
| **solid amber** | hovering a stack item → each of its live targets |
| **thin dashed amber** | always on, for the TOP of the stack only — the one thing about to happen |
| **dashed blue** | the source of an ability → the ability on the stack, and, while a decision is pending, the card that is *asking* you → the prompt bar |
| **solid amber (persistent)** | targets already chosen for a cast that has not reached the stack yet (#4/R57 pre-commit chain) |

Hovering a *unit* draws the reverse view: everything on the stack aimed at it, plus whatever
it put on the stack itself.

Spent parts are skipped (they will do nothing) and a negated item draws nothing.

## The toggle

`✨ motion: on/off` in the side panel, persisted in `localStorage.algoMotion`.

Flights default to **off** under `prefers-reduced-motion`; arrows do **not**, because they
are static and they are the clarity half of the feature. Only an explicit "motion: off"
hides them.

## What came after

Round 8 took the other half of "hard to tell what's happening": the stack itself. It left the
side rail and became overlapping card scans on the table, and effects that resolve with no
response window — which never touch `GameState.stack`, so no census diff can see them — now
get a beat on it anyway. See [11-stack-on-the-table.md](11-stack-on-the-table.md); the
census-diff machinery below is unchanged, with the flashed items spliced into the "after"
census so they fly like anything else.

## Known limits

* Two copies of the same card in the same zone can be paired the wrong way round.
* The census-diff approach can only guess a destination for a card that leaves a zone with
  no size change to point at — those fade out in place rather than flying somewhere wrong.
* `handleAction()` renders twice per click (the handler renders, then the dispatcher renders
  again). The motion layer is built to survive it — a render with no moves leaves cards in
  the air alone, and destinations are re-hidden by key after every render — but the
  double render is still there and would be worth collapsing.
* Draft-panel cards carry no keys, so a draft commit animates as deck-anchor flights rather
  than card-by-card.
