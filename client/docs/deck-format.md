# The Algomancy deck format

*A deck as a file: the list, and everything else the deck is.*

This is the format [algomancy.online](https://algomancy.online) exports a deck
as and imports one back from. It is written down here because it is meant to be
read by software that is **not** this client — algomancer.cc first, anything
else after — and a format that only one program can read is a serialisation,
not an interchange format.

The implementation is one file, `client/ui/deckformat.ts`, and it is the
normative one: where this document and that file disagree, the file is right
and this document is a bug. `client/engine/test/311-deck-format.test.ts` holds
it to everything claimed below.

## There are two export formats, and this is the richer one

| | what it carries | who reads it |
|---|---|---|
| **card list** (`.txt`) | the cards, and nothing else | people, chat, algomancer.cc's paste box, a two-line parser |
| **deck file** (`.json`) | the whole deck | this document |

The card list is not going away and is still the default export. It looks like
this, and it is exactly what the paste box accepts:

```
// Single-Box Battle Deck - Fire v1.1.0 — 30 cards
// https://www.algomancer.cc/decks/6a0ad201656c0c0c9b916b93
1 Spiteful Shadow
2 Ignis Sprite
…

// maybeboard
1 Rune Channeler
```

What it cannot carry is the description, the cover card, the maybeboard as a
separate list, or where the deck came from. That is what the deck file is for.

## Three rules the format rests on

**1. Cards are keyed by printed NAME, never by id.** Neither side's internal id
survives the trip and neither side has to know the other's. A reader resolves a
name against its own pool by normalising it — lowercase, and drop everything
that is not a letter or a digit — so `Ignis Sprite`, `ignis-sprite` and
`IgnisSprite` are one card. This is why algomancer.cc's slugs already work here
with no mapping table at all.

**2. A name the reader cannot resolve is a note, not a failure.** A thirty-card
deck with one unknown card is twenty-nine cards you want. Import the rest and
say which one was left out. Nothing in this format is worth refusing a deck over.

**3. Nothing derived is written.** If a field can be recomputed from `cards` by
anybody holding card data, it is not in the file — no curve, no element share,
no affinity ceiling, no legality, no card count.

An earlier draft of v1 carried all of those in a `stats` block, for a reader
with no card database. It was cut before shipping, for three reasons worth
stating so the idea does not come back: the readers this format exists for
*have* card databases; it roughly doubled the file, all of it restatement; and
a copy of derived data is a copy that can be **wrong**, so the only safe thing
to do with it is ignore it — at which point there is no reason to write it.

`record` is not an exception. A deck's win/loss where it was exported from
cannot be recomputed from its card list by anyone; it is data, not restatement.
It is advisory only because nobody's win rate means anything on your games.

## A whole file

```json
{
  "format": "algomancy-deck",
  "version": 1,
  "name": "Single-Box Battle Deck - Fire v1.1.0",
  "cards": [
    {
      "name": "Spiteful Shadow",
      "quantity": 1
    },
    {
      "name": "Aberrant Populace",
      "quantity": 1
    },
    {
      "name": "Bloodwind Revenant",
      "quantity": 1
    },
    {
      "name": "General Smof",
      "quantity": 1
    },
    {
      "name": "Soul Swallower",
      "quantity": 1
    },
    {
      "name": "Infernal Cultivator",
      "quantity": 1
    }
  ],
  "maybe": [
    {
      "name": "Rune Channeler",
      "quantity": 1
    }
  ],
  "description": "Single-box deck focusing on Fire.\n\nSacrifice the small things, then **swing**.",
  "author": "aramsunat",
  "cover": "Smouldering Inferno",
  "coverImage": "https://algomancy.online/data/cards/Smouldering-Inferno.jpg",
  "source": "https://www.algomancer.cc/decks/6a0ad201656c0c0c9b916b93",
  "visibility": "public",
  "id": "2f0c9a1e-7c44-4b8e-9a31-6d5f0c2b81aa",
  "url": "https://algomancy.online/?deck=2f0c9a1e-7c44-4b8e-9a31-6d5f0c2b81aa",
  "createdAt": "2026-05-18T08:46:57.327Z",
  "updatedAt": "2026-09-18T20:44:26.996Z",
  "exportedAt": "2026-09-20T09:14:02.511Z",
  "generator": {
    "app": "algomancy.online",
    "version": 1
  },
  "record": {
    "games": 9,
    "wins": 6,
    "losses": 3
  }
}
```

## The fields

Required: `format`, `version`, `name`, `cards`. Everything else is optional, and
a writer **omits** what it does not have rather than writing an empty string —
an importer that applies `description: ""` blanks a description that was fine.

| field | type | |
|---|---|---|
| `format` | `"algomancy-deck"` | present and different → refuse; absent → read anyway |
| `version` | integer | `1`. A higher number is readable: unknown fields are ignored, never fatal |
| `name` | string | the deck's name |
| `cards` | entry[] | the deck proper. One entry per distinct card |
| `maybe` | entry[] | the **maybeboard** — see below |
| `description` | string | markdown. algomancer.cc's plain text is valid markdown |
| `author` | string | who built it |
| `cover` | string | card name — the art that represents the deck. This is the field that means something |
| `coverImage` | url | …and a URL for that art, for a reader with no images of its own. Advisory |
| `source` | url | where the list came from, when it came from somewhere |
| `visibility` | `private` \| `unlisted` \| `public` | who may see it **where it was exported from**. History, not an instruction — see below |
| `id` | string | the exporting system's own id |
| `url` | url | a link that opens the deck there |
| `createdAt`, `updatedAt`, `exportedAt` | ISO 8601 | |
| `generator` | `{app, version}` | what wrote the file |
| `record` | `{games, wins, losses}` | the record where it was exported from. Advisory; a win rate belongs to the games that produced it |

A **card entry** is `{"name": "Ignis Sprite", "quantity": 2}`. A reader should
also accept a bare string (`"Ignis Sprite"`, meaning one) and an entry with no
`quantity` (meaning one). Quantities are clamped to 1–99.

### The maybeboard is not a sideboard

Algomancy has no sideboard, and calling this one would invite people to expect
between-game swaps that the rules do not have. `maybe` is a shelf: cards the
builder is considering. Nothing in it is shuffled into anything and no deck
rule applies to it. algomancer.cc's `sideboard` field is read into it and
`maybe` is written back out — the two mean the same thing in practice.

### Visibility does not transfer, and neither does the record

A file that was `public` where it was written says so, and a reader treats that
as history. Who may see the deck on the importing system is that system's
decision, made by the account importing it. A pasted file must never be able to
publish something on somebody's behalf.

## What a reader should accept

This client's parser takes all three of these, and an interoperating one is
encouraged to do the same:

1. **A deck file** as described above, at any `version`.
2. **Anything with a top-level `cards` array** of entries, `format` absent.
3. **algomancer.cc's own `/api/decks/<id>` response**, recognised by a nested
   `deck.cards`. `deck.sideboard` is read as `maybe`, `deck.description` as
   `description`, `user.username` as `author`, `cards[]`'s `{id, name}` pairs
   as the slug→name mapping, and a 24-hex `deck._id` becomes the `source` link.

Strict on write, permissive on read. Refuse only two things: a `format` that is
present and names somebody else's format, and a file with no cards in it. Any
field you do not recognise — including a `stats` block from a tool that keeps
one — is ignored, never an error.

## Where this is going

The two systems can already hand each other a deck by hand — export here, paste
there. The next step, when both sides want it, is doing that over HTTP instead
of over the clipboard. Nothing in this document depends on that happening, and
nothing in it should have to change when it does: a deck file is a deck file
whether it arrives in a textarea or in a response body.

Two things worth agreeing on before then, both of which are decisions rather
than code:

- **Which direction, and who authenticates.** Reading a *published* deck needs
  no account on either side; writing one into somebody's collection does.
- **What happens to a card the other side does not have.** Rule 2 says import
  the rest with a note. That is the right answer for a human pasting a list; a
  machine-to-machine sync may want the stricter one, and should say which it
  asked for rather than guessing.

---

*Implementation: `client/ui/deckformat.ts` (the format), `client/server/decks.ts`
(the importers), `client/ui/decks.ts` (the export panel).
Tests: `client/engine/test/311-deck-format.test.ts`.*
