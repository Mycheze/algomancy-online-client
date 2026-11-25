# 26 · Building a deck together

A host opens one of their decks to friends. Everyone signed in who has the link
works on the same deck builder table live: the piles, the Sideboard and Maybe.
Each person's search and pool are their own, and nobody else sees them.

## What the owner asked for

- A session is started from the host's deck and joined by invite (the bell) or by the link, by anyone signed in.
- Everyone sees everyone else's moves at once, plus their pointers and the card in their hand.
- The search band is not shared. The deck, sideboard and Maybe are.
- It is still the host's deck. When the host leaves, the session ends.

The decisions settled with the owner before building:

| question | answer |
|---|---|
| A refresh or a dropped connection | the session waits **60 s** for the host before it ends (`HOST_GRACE_MS`) |
| What guests can change | the cards and the arrangement. Name, cover, description and visibility are the host's (Deck info) |
| The link | one per session, dead when it ends. The host can **Remove** someone, who cannot come back. No view-only mode |
| Keeping it | a guest can **Save a copy to my decks** (a new private deck), from the sheet or the "session ended" page |
| Presence | pointers and held-card highlights, in each person's colour |
| Inviting | a friend's bell gets "X invites you to build Y together", with Join / No thanks. Or copy the link |
| Undo | each person's own, and only where nobody has touched what it changed since |

## How it works

**The server's copy is the table.** `server/collab.ts` holds each session's deck
as a `DeckTable` (cards, Maybe, Sideboard, piles). A move arrives as the builder
made it: `place()`'s `{carry, to}`. It is replayed in arrival order through
`ui/tableplace.ts applyPlace`, which is the same arithmetic the builder runs
(moved out of `tabletop.ts place()` for this). A move names its card by
(zone, index, name). If someone else has changed that spot first, a different
card is there, so the move is refused and never lands on the wrong copy. The
copy cap (2, counted across deck and sideboard) holds across everyone.

**The browser shows its own moves at once** (`ui/collab.ts`). Each move goes out
with a per-socket `seq`. Every view the server pushes carries `ack`, the last of
that socket's moves it has handled. The tab takes the view and replays its
still-unanswered moves on top, so a card never jumps back while its move is in
flight. A move someone else beat it to does not survive the replay, and the
server's `refused` says why in the note row. After a reconnect the tab drops
whatever was in flight and takes the next view as the truth, so nothing is
sent twice.

**Undo** (`tableplace.ts undoMerge`) works per person. The server keeps each
person's last 30 changes as before/after snapshots. Undo puts back only the
parts that change touched (each pile, the pile order, Maybe, the Sideboard),
and only if those parts still read as the change left them. Otherwise it says
someone has changed that part since. Redo is the same call reversed.

**Saving.** The table is written into the host's deck 1 s after each change and
again at the end. While a session is open, `/api/decks/update` ignores card,
Maybe, Sideboard and pile fields for that deck, so a stale tab of the host's
cannot overwrite the session. Name, cover, description and visibility still go
through, and the table's title follows them.

**Pointers** are anchored to the zone under them (`data-tt-zone`: a pile, Maybe,
the Sideboard), as fractions of its box, so windows of different sizes agree.
They are relayed at most every 40 ms per socket and never stored beyond the last
one per person. Over the pool the pointer is not sent, because everyone's pool
differs. The card in hand is its `data-tt-src`. Both are drawn in `#collabmarks`,
a fixed layer outside `#app`, so a table repaint never touches them.

## The wire (`shared/protocol.ts`)

| browser → server `{t:'collab', op}` | |
|---|---|
| `sub {code, token}` | take a place at the table (signed in; refused when removed or the table holds 8) |
| `move {seq, carry, to}` | a builder move (no strip, no whole-deck `set`, no Undo: see `parseCarry`/`parsePlace`) |
| `step {seq, dir}` | my Undo / Redo |
| `cursor {at, held}` | my pointer and the card in my hand |
| `kick {user}`, `end` | the host's |

| server → browser `{t:'collab', …}` | |
|---|---|
| `view` | the whole table, who is here, my Undo/Redo, `hostAway`, my `ack` |
| `cursor` | someone else's pointer |
| `refused {seq, note}` | one of my moves did not happen, and why |
| `ended` | the session is over for me (host left or ended it, I was removed, the deck was deleted) |

HTTP: `POST /api/collab/start {deck}` (returns the host's open session on it, if any), `/api/collab/invite {code, to}`
(friends only), `/api/collab/decline {code}`. `GET /api/inbox` carries `collab: [{code, from, deck, at}]`.

Nothing is persisted beyond the deck. A server restart ends every session (at most the last second of moves is unsaved).

## Files

`server/collab.ts` (rules, pure) · `server/api-collab.ts` (sessions, sockets, grace clock, saving, invites) ·
`ui/tableplace.ts` (the builder's move arithmetic and `undoMerge`) · `ui/collab.ts` (the browser) ·
`ui/pages/collab.ts` (its markup) · `styles/pages/59-collab.css` · `shared/collab.ts` (the colours).
Tests: server 1530, ui 1531.
