# 15 — The card browser, the query language, and the card-data audit

*Written 2026-08-28, when the browser shipped. The syntax table here is a copy
for reading; the one that is true is `KEYS` and `FLAGS` in
`ui/cardsearch.ts`, which the in-app help sheet prints directly and
`engine/test/210-cardsearch.test.ts` exercises example by example.*

## Why

The client could show you 483 deck-legal cards through three controls: a
substring box, one element chip, and a unit/spell toggle, capped at 60 results,
inside the deck page's "+ Add cards" drawer. There was no way to browse the
pool, no way to ask a question with more than one clause, and no way to say
*not*.

> "The digital client desperatly needs a card viewer/searcher/scryfall like
> interface/filtering syntax. […] I want to easily be able to find cards with
> certain text and features and everything including negative filtering,
> inclusive and exclusive searches, etc. It should also be nice and easy to use
> for deck building."

## The shape

```
AlgomancyCards-OracleText.json  (534 names, Caleb's transcription, canonical)
        │  engine/scripts/extract-printed.mjs  +  printed-overrides.mjs
        ├────────► src/cards/printed.json     492 — the ENGINE's trusted data
        └────────► src/cards/catalogue.json   534 — browse-only superset
                          │
              ui/cardindex.ts   one row per card, joined with the registry
                          │
              ui/cardsearch.ts  parser → AST → predicate   (pure, DOM-free)
                    │                              │
          ui/cards.ts (the page)          ui/decks.ts (the drawer)
                    └──── one predicate, two surfaces ────┘
```

Both derived files are written by the same run of the same script, so they
cannot drift; `test/211-card-audit.test.ts` re-derives them and fails if what
is committed is not what the current oracle file produces. **That test is the
reason to read this section**: before it existed, editing the transcription and
forgetting `npm run extract` was invisible, and the client simply kept showing
yesterday's cards.

### Three questions that are easy to confuse

`ui/cardindex.ts` answers all three separately, and the browser asks all three
(537 rows: the oracle file's 534, plus the three synthetics the registry adds):

| field | means | count |
|---|---|---|
| in the index at all | the thing exists | 537 |
| `scripted` | the engine has printed data and can draw it | 495 |
| `playable` | it is deck-legal (`DECK_LIST`) | 483 |

### The implicit `class:card`

The browser shows the 483 cards unless you say otherwise. The other 54 are help
charts, resource faces, effect markers and one engine-internal attribute
carrier, and they are what you want roughly never.

It shipped for a few hours as a literal `class:card` in the query box, and the
owner's call (2026-08-28) was that it should be invisible: *"I expect people to
want to see that list 95% of the time. Then changing the search will be how
they show the other stuff. It's also annoying that clearing the search needs to
put it back in."* So clearing the box now means "the cards", which is what
clearing a card search should mean.

**Saying otherwise is mentioning class at all, anywhere in the query** —
`class:token`, `-class:card`, `class:all`, or a class `is:` flag like
`is:help`. Any of those and the implicit term is not added, so a question
*about* classes is never silently intersected with one particular class. That
is the failure mode that makes a hidden default infuriating, and
`search()` returns `implicitCards` so the count line can say, in one dim
line, when it has narrowed the answer.

`matches()` stays literal: the default belongs to the browser, not to the
language. `search(src, { implicit: false })` evaluates the query exactly as
written.

A help card is only the first. A Fireball token is the first two. `Alluring
Attribute` — an internal carrier `src/apply.ts` registers for the {Alluring}
trigger — is only the second, and is classified `marker` so it never appears as
a card you could play.

### `class`, derived and not enumerated

Every catalogue entry gets a `class` from its printed type line: supertype
`Card` → `help`; `!Resource` → `marker`; `Resource` → `resource`; a type line
containing `Token` → `token`; `Deck: Kickstarter Exclusive` → `exclusive`;
otherwise `card`. Subtypes are likewise *what is left* after the markup and the
supertype tail come off, so a subtype nobody has printed before needs no code
change. The owner's call on coverage was **"everything, but treat tokens,
resources and the 'help' cards as special, non-card cards"**.

## The query language

```
query := or
or    := and ( ("OR" | "or" | "|") and )*
and   := unary+                        juxtaposition is AND
unary := "-"? ( "(" or ")" | term )    "-" negates a term OR a group
term  := KEY OP VALUE | BARE
OP    := ":" | "=" | "!=" | ">" | "<" | ">=" | "<="
VALUE := word | "quoted phrase" | /regex/i | comma,separated,list
```

A **bare word** searches name, type line and rules text — what the old drawer
did, so nothing regressed. `name:` / `type:` / `text:` narrow it.

The parser is **tolerant on purpose**. The bar re-runs on every keystroke, so it
sees `o:"draw a ca` far more often than a finished query: unclosed quotes,
parens and regexes are auto-closed and reported in `errors`, never thrown.

### Filters

| filter | also | matches |
|---|---|---|
| `name:` | `n:` | the card name |
| `text:` | `o:` `oracle:` | printed rules text |
| `type:` | `t:` | the whole type line, subtypes included |
| `sub:` | `st:` `subtype:` | one printed subtype |
| `super:` | `supertype:` | Unit / Spell / Spell Unit / Spell Token / Resource |
| `el:` | `e:` `f:` `faction:` `color:` `c:` | element identity — see below |
| `pip:` | `pips:` `affinity:` | affinity pips: a count, or a multiset |
| `mana:` | `m:` `mv:` `cmc:` | printed mana value, or `X` |
| `pow:` `tou:` `pt:` | `p:` `def:` | printed stats |
| `kind:` | `k:` | unit / spell / spellunit / spelltoken |
| `timing:` | | deploy / battle / haste |
| `attr:` | `a:` | a printed attribute |
| `aug:` | | an attribute granted when applied as an augment |
| `kw:` | `keyword:` | any keyword — by name, or by what it *means* |
| `set:` | `deck:` `s:` | the printed deck a card ships in |
| `rarity:` | `r:` `complexity:` | simple / common / complex / glitch |
| `class:` | | card / token / resource / marker / help / exclusive / `all` |
| `creates:` | `makes:` | a token this card creates |
| `is:` | `has:` | a yes/no property (34 of them) |
| `in:` `copies:` | | the open deck, in deckbuilding mode |

### Elements: where inclusive and exclusive live

Scryfall's colour operators, because they are the vocabulary that makes this
useful for deckbuilding:

| query | means |
|---|---|
| `el:fire` | has fire |
| `el:fire,wood` (or `el:rg`) | has fire **and** wood |
| `el=fire,wood` | is **exactly** fire+wood |
| `el<=fire,wood` | fits inside a fire/wood deck (subset, monos included) |
| `el>=fire` | superset of fire (same as `:`) |
| `-el:fire` / `el!=fire` | is not fire |
| `el:mono` `el:hybrid` `el:none` | one element / more than one / none |

Values are element names, pip letters, or a comma list of either. `f` also
means fire: `b` and `g` were taken by water and wood so fire had to give up
`r`, but nothing competes for `f`. **`w` is deliberately not a letter** —
water and wood both want it, and a letter that silently picks one of two
elements is worse than one that does nothing.

`pip:` takes the same operators over the pip multiset, so `pip<=rrg` is
"castable off two fire and one wood".

### `kw:` asks by name first, then by meaning

`kw:virus` is a keyword name and answers exactly. `kw:trample` is not a keyword
this game has, so it falls back to searching what the keywords *mean* and finds
Piercing. That fallback is the only way to find the one {Thieving} card by
"draws a card", since that card never prints the word "draw"
(`ui/cardsynonyms.ts`, ported from `cards.py`'s `KEYWORD_TEXT`).

### Suggestions, never silent expansion

The Python side expands a query behind your back — `deathtouch` becomes
`deadly` and the search finds what you meant. This client deliberately does not.
A bar that quietly searches for a word you did not type cannot answer "does any
card actually **say** trample", and reading printed text is the point of the
browser. Instead the alias tables drive a hint line under the box:
`deathtouch → attr:deadly`, as a chip you click.

### Display terms

`sort:` `dir:` `view:` parse into the query but do not filter, so **the query
string carries the whole page** and a search is a shareable link
(`?cards&q=…`). `sort:relevance` is the default whenever a bare word is
present, and orders exact name > name prefix > name contains > type > text.

## The two editors, one state

The facet rail holds no state. A chip click calls `withChip(src, key, value,
state)` which rewrites the **query string**, and the chips re-derive their look
from that string on every paint. So a chip can never disagree with the box.

Chips are tri-state: neutral → include → exclude → neutral. Excluding is drawn
struck-through in the danger colour, not merely dimmer, because two states that
differ only in opacity are two states nobody can tell apart.

`withChip` edits the **source text**, not a rebuilt AST, so everything typed by
hand — spacing, quoting, parens — survives a chip click. It only touches
top-level terms: a chip that reached inside a parenthesised OR would rewrite a
query the user built into one that means something else. When the query has a
top-level `OR`, appending wraps it — `(el:fire OR el:water) kind:unit` — because
an unwrapped append would bind to the last branch only.

## Deckbuilding

Opened from a deck ("🔍 browse" in the drawer, or "Browse all cards"), every
tile grows add/cut controls, an `×N` badge, and `in:deck` / `copies>=1` start
answering.

**The browser never touches the deck.** `ui/decks.ts` hands it a `DeckBridge`
whose every mutation goes through that file's single `edit()` →
`scheduleSave()` funnel, so the debounce rules documented in its header — in
particular "an edit to a DIFFERENT deck flushes the one already waiting" —
still hold. Returning from the browser is a `paint()`, not a `renderScreen()`,
so it does not re-enter the collection loader (see `test/189`, and the 2.3-second
home screen that fixed).

## The audit

`npm --prefix engine run audit:cards` (and `test/211-card-audit.test.ts`, which
runs the same function):

1. **freshness** — the committed derived files are what the current oracle file
   produces
2. every `POOL` name exists upstream; every `printed.json` name is in `POOL`
3. type lines parse: the markup vocabulary is closed, every remaining word
   reads as a subtype, exactly one supertype tail
4. `factions` is a list, and agrees with the cost pips via `ELEMENT_OF_PIP`
5. no unknown pip letters; stats are numeric or `X`/`*`
6. hygiene on the **emitted** strings: no double spaces, no wrap artifacts
7. every name the client will draw has a scan on disk
8. `PRINTED_OVERRIDES` are not stale; aliases resolve and do not leak
9. **subtypes exactly one card prints** — the check that would have caught
   `{Battle}AI Cosmic Spell`, which R162 found and R240 confirmed was an OCR
   artifact rather than a subtype

Findings we have looked at and accepted are named in
`engine/scripts/card-audit-known.mjs` — 48 of them today: the twelve reference
cards whose `factions` is the string `"Unknown"`, the nine Kickstarter cards
with no scan, and the 27 legitimate one-off subtypes. **A stale entry there is
a failure**, the same as a stale printed override. The list caught one on its
first run: a `Linked Extinction` "Sacrifce" entry whose cause had already been
fixed at source in `0818074`.

### What is deliberately NOT checked

Each of these looked obvious and is wrong:

- *"total_cost is at least the pip count."* **False in Algomancy.** Affinity
  pips are a requirement, not a payment: 51 cards cost less mana than they
  demand pips. See `ui/deckstats.ts`'s header.
- *"a card has rules text."* 24 real cards are vanilla. That is `is:vanilla`,
  not a defect.
- *"the source has no double spaces."* 52 records do, and `normalisePrinted`
  exists to fix them on the way out — so the check runs on the emitted strings,
  where the answer is zero.
- *unknown `[tokens]` in rules text.* That vocabulary is open by design
  (`[Sacrifice a unit]`, `[Pay X life]`). Only the `{formatting}` vocabulary is
  closed, so only that is checked.

## Files

| file | role |
|---|---|
| `engine/scripts/extract-printed.mjs` | both derived files, one parse pass |
| `engine/scripts/audit-cards.mjs` | the checks, and the report |
| `engine/scripts/card-audit-known.mjs` | findings we accept, each with a reason |
| `engine/src/cards/catalogue.json` | generated; never hand-edited |
| `ui/cardindex.ts` | one row per card |
| `ui/cardsearch.ts` | the language |
| `ui/cardsynonyms.ts` | what a word meant, offered not assumed |
| `ui/cards.ts` | the page |
| `engine/test/210-cardsearch.test.ts` | grammar, operators, answers |
| `engine/test/211-card-audit.test.ts` | the audit, plus the registry-level checks |
