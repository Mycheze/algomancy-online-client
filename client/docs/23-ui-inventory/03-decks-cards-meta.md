# 03 — Decks, the card browser, card stats / metagame

Reader 3 of 7. Area: `client/ui/decks.ts`, `deckstats.ts`, `deckformat.ts`, `deckstrip.ts`, `decklayout.ts`,
`deckarrange.ts`, `tabletop.ts`, `binder.ts`, `piletable.ts`, `drag.ts`, `cards.ts`, `cardsearch.ts`,
`cardsynonyms.ts`, `cardindex.ts`, `cardlinks.ts`, `cardstats.ts`, `meta.ts`, `zoom.ts`, `cardpanel.ts`,
`presszoom.ts`, plus the CSS each element uses in `style.css`.

All paths below are relative to `client/ui/`. Line numbers are as of master `ba32fcf4`.

---

## 0. How these pages are wired (read this first)

### 0.1 Routing and stacking

`renderHome()` (`main.ts:9329`) is a priority ladder. In order, the first module whose `screen()` is
non-null owns `#app`:

| order | check | module | why that order |
|---|---|---|---|
| 1 | `acct.screen()` | account | out of scope |
| 2 | `crr.screen()` | rules review | out of scope |
| 3 | **`cb.screen()`** | card browser (`cards.ts`) | `main.ts:9342`. It is checked first because it can be open **on top of** the deck page, the tabletop or the challenge builder (deckbuilding mode leaves those open underneath). |
| 4 | **`tt.screen()`** | tabletop (`tabletop.ts`) | `main.ts:9346`. Sits on top of the deck page or the challenge page. |
| 5 | **`dk.screen()`** | My decks (`decks.ts`) | `main.ts:9347` |
| 6 | **`meta.screen()`** | metagame list, shared deck (`?deck=`), card duel ladder, card stats (`meta.ts` + `cardstats.ts`) | `main.ts:9349` |
| 7+ | league, challenge, admin, queue, then the home page itself | | out of scope |

Each module is initialised once at boot with `{ app: $app, rerender }` (`main.ts:12383–12389`). Clicks:
`main.ts` has ONE delegated click listener; it finds `closest('[data-btn]')` and offers the element to each
module's `handleButton` in turn (`main.ts:11213–11219`): `dk` (`deck-*`), then `tt` (`tt-*`), then `cb`
(`cards-*`), then `meta` (`meta-*`, which first hands `meta-cs-*` to `cardstats.handle`). The binder is the
exception: it is a layer outside `#app` and uses its own attribute `data-dd` and its own capture-phase
listener (`binder.ts:291–300`). Keys: only the card browser has a key handler (`cb.handleKey`,
offered by `main.ts:12063`).

Every page repaints by replacing `#app.innerHTML` wholesale on every state change; the scroll position, focus
and caret are put back by hand (`decks.ts` "Perch" `:1183–1230`, `cards.ts` `repaintKeepingCaret`
`:605`, `meta.ts` `repaintKeepingCaret` `:547`, `cardstats.ts` `afterPaint` `:512`, tabletop `SCROLLERS`
`tabletop.ts:452`). That is four separate implementations of "keep the caret across a repaint".

### 0.2 Entry points into this area

| from | element | target | file:line |
|---|---|---|---|
| Home header (signed in only) | `🗂 My decks` button, `.homedecks` | `deck-openpage` | `main.ts:9375` |
| Home header | `🔍 Cards`, `.homedecks` | `cards-openpage` | `main.ts:9377` |
| Home header | `🏆 Metagame`, `.homedecks` | `meta-openpage` | `main.ts:9378` |
| Home Constructed card, deck picker | `My decks →`, `.deckmanage` | `deck-openpage` | `main.ts:9202` |
| Home Single Card Duel blurb | "card ladder" `.linkbtn` | `meta-ladder` | `main.ts:9266` |
| Profile page, public decks | `.metarow` buttons (the metagame row, reused) | `meta-open` | `account.ts:450` |
| URL | `?cards=1[&q=…][&card=…]` | card browser | `cards.ts:114–126` |
| URL | `?card=<name>` | card browser with that card pinned; also the Discord unfurl | `cards.ts:122–126` |
| URL | `?meta=1` / `?deck=<id>` / `?cardladder=1` / `?cardstats=1` or `?cardstats=<card>` | metagame views | `meta.ts:106–116` |
| URL | `?table=<deckId>` / `?table=ch:<challengeId>` | tabletop, re-entered after a reload | `tabletop.ts:498`, `:527–539` |
| Deck page | `Build on the table` | tabletop | `decks.ts:1117` |
| Deck page | `🔍 Browse all cards` / `🔍 browse` / `find similar` | card browser in deckbuilding mode | `decks.ts:531`, `:547`, `:514` |
| Tabletop binder | `All cards…` / `Find similar` | card browser in deckbuilding mode | `binder.ts:141`, `:133` |
| Card browser pinned card | `metagame` link, `card stats` link | metagame list, card stats tab on that card | `cards.ts:412`, `:415` |
| Tutorial ("How to play") | spotlights `deck-openpage`, `deck-new`, `deck-import-open`, `deck-export`, `cards-openpage`, `cards-help`, `meta-openpage` | | `tutorial.ts:62`, `:81` |

### 0.3 Facts that apply to every page in this area

These came out of reading the CSS against the markup. Each is a design-system problem, not a one-page one.

1. **`.hint`, `.dim`, `.acctmsg`, `.good`, `.bad`, `.ok` and `.warn` have no global rule.** `grep` of `style.css` and
   of every injected stylesheet (`legal.ts`, `sandbox.ts`) finds them only under parents: `.accthead .hint`
   (`style.css:1815`), `.acctcard .hint` (`:1835`), `.joinscreen .hint` (`:355`), `.cbcount .hint` (`:3104`),
   `.accttable .good/.bad` (`:1861–1862`), `.cbdeckbar .ok/.warn` (`:3193–3194`), and so on. Outside those parents
   the class does nothing. Concrete misses:
   - decks rail empty state `<div class="hint">No decks yet — make one.</div>` (`decks.ts:1283`) and the detail
     placeholder `Pick a deck, or make a new one.` (`:1287`) render as plain body text;
   - the deck hero record `<b class="good|bad">3W–1L</b>` (`decks.ts:350`) inside `.deckrecline` is **not coloured**;
     the same goes for the metagame row's `<b class="good|bad">NN%</b>` (`meta.ts:304`) inside `.metarec`;
   - `<span class="dim">no games yet</span>`, `· built by …` (`decks.ts:349`, `:1100`) are not dimmed;
   - every `<p class="hint">` on the metagame, ladder and card stats pages (loading, empty, footnote,
     explanations: `meta.ts:246–252`, `:382–391`, `cardstats.ts:277`, `:315`, `:354`, `:398`, `:412`, `:485`,
     `:487`) is unstyled body text;
   - `<div class="acctmsg">` (`meta.ts:240`, `:368`, `:508`, `cardstats.ts:505`) has **no rule at all**, so the
     page's error/status line looks like any other paragraph.
2. **Toggle buttons inside `.cbtools` show no selected state.** `class="on"` is styled only under specific parents
   (`.cbviews button.on` `:3051`, `.metatabs button.on` `:3729`, and nine others elsewhere). So on the metagame list
   the sort buttons `winrate / most played / newest / name` (`meta.ts:371–372`), and on card stats the
   `both / draft / constructed`, `ever / last 30 days / last 7 days`, `rated only`, `both signed in`, `my games`
   (`cardstats.ts:268–275`) and `all / units / spells` (`:299–300`) toggles, **all look the same whether on or off.**
   Only the outer tab rows (`.metatabs`) light up.
3. **Card tiles have no hover read on these pages any more.** The tile markup still carries `data-prev`
   (`decks.ts:412`, `cards.ts:337`, `:354`, `meta.ts:418`, ladder `meta.ts:211`, card stats `cardstats.ts:256`,
   `:431`), and the comments in `decks.ts:372–374` and `cards.ts:324–327` say that attribute drives "the whole
   hover box". It no longer does. Since board round 8, `main.ts`'s `mouseover` arms the tooltip only for
   `[data-prevart]` (`main.ts:10046–10050`) and otherwise calls `zoomAt`, whose `zoomTarget` only matches
   `.card, .rescard, .stackcard` (`zoom.ts:174–180`). `.dktile`, `.cbrow`, `.metarow` and `.csname` match none of
   these, so a mouse resting on a tile, list row, ladder row or stats row gets nothing. The only hover read left in
   this area is the **art tip** on card names in a deck description on *your own* deck page (`cardLinker({ art: true })`,
   `decks.ts:645`). The shared deck page calls `cardLinker({ focusBtn: 'meta-focus' })` **without** `art`
   (`meta.ts:512`), so the same description on the public page has no hover at all. The tabletop and binder use the
   separate press-and-hold zoom (`data-zoom`, §2.9).
4. **Page header, two shapes.** Decks and Cards use `.accthead` > `div` + `.accthbtns` (right-aligned via
   `margin-left:auto`, `style.css:1816`). Metagame, ladder, card stats and the shared deck put a bare `<button>`
   straight into `.accthead` (`meta.ts:237`, `:365`, `:488`, `:505–506`, `cardstats.ts:501`). With no `.accthbtns`
   wrapper, nothing pushes the button to the right, so it sits next to the title block. The back-button wording
   differs on every page; see §8.
5. **Page widths:** `.deckpage` 1400 (`style.css:2565`), `.cbpage` 1500 (`:3031`), `.metapage` 1100 (`:3283`),
   `.metadeck` 1400 (`:3284`), `.cspage` 1480 (`:3736`), and the tabletop is full-bleed fixed
   (`.ttpage`, `:2784`). Side padding is 22px on decks and cards and 18px on meta. These are five widths for five
   sibling pages.

---

## 1. My decks — `decks.ts`

**Reached by:** `deck-openpage` (home header `🗂 My decks`, home deck picker `My decks →`, tutorial). `handleButton`
case `deck-openpage` sets `open = true` → `renderScreen()` (`decks.ts:1499–1502`) → `ensureCollection(paint)` +
`paint()` (`:1367–1370`). The renderer is `paint()` (`:1235–1291`), which calls `detailHtml(d)` (`:1065–1155`).
There is no URL of its own: `?table=<id>` exists only for the tabletop over it.

**State (all module globals, `decks.ts:101–181`):** `open`, `decks`, `loading`, `openId`, `tab`
(`cards|mana|maybe|games`), `group` (`type|cost|element|flat`), `adding`, `search`, `msg`, `confirmDelete`,
`importing`, `importMsg`, `exporting` (`text|file|null`), `descOpen`, `settingsOpen`, `descEditing`, `syntaxOpen`,
`descDraft`, `focusDesc`, `focus`, plus the save queue (`queued`, `inflight`, `saveTimer`, `savePending`).

### 1.1 Logged-out variant (`decks.ts:1252–1262`)

Shown when `!acct.token()`. It reuses the sign-in screen's shell, not the deck page's.

| element | what it is/does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| wrapper | centred narrow card, as on sign-in | — | `.joinscreen.home.acctscreen` | `decks.ts:1253` |
| logo | "ALGOMANCY" | — | `h1.homelogo` | `:1254` |
| heading | "Decks" | — | `h2` (`.acctscreen h2` is accent coloured) | `:1255` |
| hint | "Log in to keep your decks and their records. You start with five." | — | `p.hint` (`.joinscreen .hint`) | `:1256` |
| primary button | "Log in / Sign up" → `acct-open-auth` | — | `.homebtns button.primary` (accent outline, bold) | `:1258` |
| back | "Back" → `deck-close` | — | `.homebtns button` | `:1259` |

In practice the home page hides `🗂 My decks` when signed out (`main.ts:9375`), so this is reached only through
the tutorial spotlight or a stale state.

### 1.2 Page shell and header (`decks.ts:1265–1277`)

Layout: `.deckpage` (max 1400, padding 12/22/24) → `.accthead` → `.deckmain` (a grid: 260px rail | detail;
**one column under 900px**, `style.css:2567–2568`).

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| title | "Decks" | — | `.accthead h1` but overridden by `.deckpage h1` (22px, `style.css:2566`). Cards uses 26px from `.accthead h1`, so the two titles differ in size. | `decks.ts:1268` |
| status line | `"{n} saved · edits save themselves"` plus `" · {msg}"` when there is a message | before load: `"loading…"`; after a failed load: `msg` (`"could not load your decks"` / `"could not reach the server"`); otherwise `"no decks loaded"`. `msg` carries every server note and error: `"copied"`, `"deleted “X”"`, `"imported"` or the import's note, `"“X” is the deck you are bringing to constructed games"`, `"could not save that change"`, `"could not reach the server — that change is not saved"`. Messages never clear on their own; the next navigation clears them. | `.accthead .hint` (dim 12px) | `:1269–1271` |
| refresh | `↻` → `deck-refresh` (flush save, drop the cache, reload) | `title="reload from the server"`, **no aria-label**, icon only | plain `button` | `:1274` |
| back | "Return to Lobby" → `deck-close` (flushes the pending save, closes) | always primary. **There is no lobby**: it returns to the home page. | `button.primary` (green fill `#3c5a2f`, `style.css:53`) | `:1275` |

### 1.3 Left rail — deck list (`decks.ts:1279–1284`, `deckRow` `:957–975`)

`aside.decklist`: a flex column, gap 6, **sticky top:8** (`style.css:2573`). Under 900px the grid stacks, but the rail
is still sticky.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| New deck | "+ New deck" → `deck-new` (POST `/api/decks/create` with name "New deck"; opens it with the add drawer open and the search box focused) | errors go to the header `msg`: "could not make a deck" / "could not reach the server" | `.deckmakebtns button.primary` (flex:1) | `:980` |
| Import | "Import…" → `deck-import-open` | swaps both buttons for the import box (§1.4) | `.deckmakebtns button` | `:981` |
| deck row | the whole row is a `<button>` → `deck-open` (`data-id`) | `.on` when open (accent border, panel2 background) | `button.deckrow` (grid 46px / 1fr / 18px) | `:960` |
| ↳ cover thumb | the cover scan, cropped to the art (`margin-top:-18%`) | falls back to the deck's first card; empty box when the deck is empty; `onerror` hides the image | `.deckrowart img` | `:961–963` |
| ↳ name | deck name, clamped to 2 lines (bundled names differ only at the end) | updates live while you type in the name box, without a repaint (`wire()` `:1316`) | `.deckrowname` | `:965` |
| ↳ count line | `"{n} cards"` + `" · {m} maybe"` | singular "card" | `.deckrowmeta` (dim 11px) | `:966–967` |
| ↳ element pills | one uppercase pill per element ≥ 50% share threshold (`deckElements`), `title="{pct}% of the deck"` | none: `<span class="dim">empty</span>` | `.acctel.{el}` (shared with the profile page) | `:968`, `elChips` `:343` |
| ↳ record | `"3W–1L"` | empty before the first game | `.deckrowrec` | `:969` |
| ↳ legality flag | `✓` or `!` | `.ok`: green `--glow`. `.bad`: **accent gold**, not red. The tooltip lists the problems, e.g. "30 minimum · 3 card(s) this build cannot play", or "legal — ready to play". Colour plus glyph. | `.deckflag.ok/.bad` | `:971–973` |
| empty / loading | `"loading…"` or `"No decks yet — make one."` | `.hint` has no styling here (§0.3) | `div.hint` | `:1283` |

### 1.4 Import box (`importHtml`, `decks.ts:977–1001`)

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| box | panel card | — | `.deckimportbox` | `:984` |
| label | "Import a deck" | uppercase tiny | `.zonelabel` | `:985` |
| URL input | placeholder "algomancer.cc deck link" | — | `.joinrow input#dk-url`. **Inherits the room-code look**: `.joinrow input` is centred, letter-spacing .2em, bold (`style.css:435`), so a URL is typed in spaced bold capitals. The home picker patches this with `.deckimport input` (`:515`); this box has no such patch. | `:986–987` |
| Load | "Load" → `deck-import-url` | does nothing on an empty input | `.joinrow button` (flex:1, so as wide as the input) | `:988` |
| paste disclosure | `<details open>` "…or paste a list, or a deck file" | always open; the summary can collapse it | `details.deckpaste` (dim summary, `style.css:517`) | `:990–991` |
| paste textarea | 5 rows; placeholder "2 Ignis Sprite / 2 Rune Channeler / … / …or paste a whole deck file (JSON)" | — | `textarea#dk-text` (`.deckimportbox textarea` 100%) | `:992–993` |
| Import it | "Import it" → `deck-import-text` | nothing on empty | `button` | `:994` |
| help | "One card per line, or a deck file — that brings the description, cover and maybeboard with it." | — | `div.hint` (unstyled) | `:995–996` |
| status | `importMsg`: "importing…", a server error, or "could not reach the server" | only when set | `.deckmsg` (accent 12px, `style.css:520`) | `:998` |
| cancel | "cancel" (lower case) → `deck-import-close` | — | `button` | `:999` |

On success the box closes and the header line says `"imported"` or the server's note.

### 1.5 Deck hero (`detailHtml`, `decks.ts:1081–1120`)

`.deckhero` is a grid of `132px | 1fr | auto` on a panel card. **Under 720px** it becomes `96px | 1fr`, and the
action column moves into a row underneath (`style.css:3888–3893`).

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| cover | the cover scan | none picked: `<span class="hint">no art — pick one under ⚙</span>`; `onerror` hides it | `.deckcover` (min-height 100, aspect reserved) | `:1082–1084` |
| name input | inline-editable deck name, max 60; typing saves (debounced 500ms) and mirrors into the rail and the ⚙ copy **without a repaint** | border appears on hover, accent on focus | `input#dk-name.deckname` | `:1086–1087`, `wire()` `:1310–1325` |
| facts line | `"{n} cards · {u} unit(s) / {s} spell(s) · avg {x.x} mana"` plus element pills | spell units count as spells here, but they get their own section in the grid | `.deckfacts` (dim, flex) + `.acctel` | `:1088–1090` |
| legality problems | e.g. "30 minimum · max 2 of a card · this build cannot play: A, B, C (+2)" | **only when illegal**; nothing when legal (owner request) | `.deckstatus.bad` (accent on dark brown `#2a2314`) | `:1098` |
| record line | `recordLine`: `<b class="good|bad">3W–1L</b>` + `" in 4 games · 1 with no result"` | "no games yet"; `· built by {author}` when the author is not "you"; `algomancer.cc` link (`target=_blank`) when imported from there. **The good/bad colours and the dims do not render** (§0.3). | `.deckrecline` | `:1099–1101`, `:348–353` |
| description | §1.5.1 | | | `:1104` |
| play | `▶`, or `✓` when this is the chosen deck → `deck-play` (stores the deck in localStorage via `chooseDeck`) | disabled when illegal; title "bring this deck to your next constructed game" / "this is the deck you are bringing" / "not legal yet — see the line on the left"; `aria-label` | `.dkicon.play` (38×38; accent outline; `.on` green fill `#1c2a1c`; disabled .4) | `:1111–1114` |
| settings | `⚙` → `deck-settings` | title and aria "deck settings" | `.dkicon` | `:1115–1116` |
| tabletop | "Build on the table" → `deck-tabletop` | the only word button in an icon column, so the column is uneven | `.dktabletop`, **no CSS rule** (plain button) | `:1117–1118` |

#### 1.5.1 Description block (`descHtml`, `decks.ts:631–653`)

| element | what | states | CSS | file:line |
|---|---|---|---|---|
| empty prompt | "+ describe this deck" → `deck-desc-edit` | empty description only | `.deckdesc.empty` (dashed, no background) + `button.cblink` | `:637–639` |
| body | markdown via `mdToHtml` with `cardLinker({ focusBtn: 'deck-focus', art: true })`: card names become `.cardlink` `<a>` elements that **hover an art tip immediately** and **click to pin** | clipped at 600 chars at a sentence (the comment says 900, the code says 600, `:629`); `.on` = expanded | `.deckdesc` (max-height 168, scrolls) / `.deckdesc.on` (60vh), `.deckdescbody`, `.cardlink` (accent, dotted underline) | `:644–645` |
| read more / show less | toggles `descOpen` | only when clipped or open | `button.cblink` | `:647–649` |
| edit | "edit" → opens the editor modal | — | `button.cblink` | `:650` |

The hover art tip is `#hovertip.hovertip.art` (260px wide, `style.css:2512`), placed by `placeHoverTip` (`main.ts:9933`).

### 1.6 Tab bar (`decks.ts:1073–1079`, `:1121`)

| element | label (exact) | states | CSS | file:line |
|---|---|---|---|---|
| tab | `cards <span class="acctcount">{total}</span>` | `.on` | `button.accttab` (**uppercase via CSS**, 11px) + `.acctcount` dim | `:1074` |
| tab | `curve &amp; affinity` | | | `:1075` |
| tab | `maybeboard {n}` | | | `:1076` |
| tab | `games {record.games}` | the count is the lifetime record, but the tab lists only the profile's last 25, so the two numbers can disagree | | `:1077` |

These are the profile page's tabs (`.accttabs/.accttab`), reused.

### 1.7 "Cards" tab (`decks.ts:1123–1140`)

Inside `section.acctcard.wide`: the **deck strip** (`deckStripHtml`, §4.2), then `.dkwork` (a grid; it gains a 320px
right column `:has(.cbdetail)`, and goes to one column under 1000px, `style.css:3200–3203`), whose main column
holds the toolbar, the grouped grid and the add drawer, with the pinned-card panel beside it.

| element | what | states | CSS | file:line |
|---|---|---|---|---|
| deck strip | "Building **{name}** · 30 cards · legal · mini-curve · element counts" | **sticky top:4 on this page only** (`.deckpage .cbdeckbar`, `style.css:3208`). Repeats the name and the count shown just above. | `.cbdeckbar` | `:1124` |
| "group by" label | "group by" | — | `.zonelabel` | `:1128` |
| grouping chips | `Units / spells`, `Cost`, `Element`, `One list` (`decklayout.ts:41–46`), with tooltips "split by what the card is, then cost order" etc. | `.on` | `button.dkkind` (3/9 padding 12px; `.on` accent) | `:1129–1131` |
| spacer | — | — | `.dkfilterspacer` | `:1132` |
| instruction | "click a card to pin it · » sends it to the maybeboard" | — | `span.hint` (`.dktoolbar .hint` margin only, so not dimmed) | `:1133` |
| section head | e.g. "UNITS 14 cards", "3 mana", "fire/wood", "X cost", "not in this build" | sections with no cards are omitted | `.dkgroup` > `.dkgrouphead` (accent, uppercase, underlined) + `span.dim` | `groupedTiles` `:448–453` |
| grid | auto-fill `minmax(112px, 1fr)` | — | `.dkgrid` | `:451` |
| empty grid | "Nothing in here yet — add cards below." | — | `div.hint` | `:440–442` |

#### 1.7.1 The card tile (`tile(name, n, where, cover)`, `decks.ts:398–435`)

One function draws three contexts: `where = 'deck' | 'maybe' | 'add'`.

| part | what | variants and triggers | CSS | line |
|---|---|---|---|---|
| tile | the whole tile is `data-btn="deck-focus"` (toggles the pinned panel), `data-prev` (no longer does anything, §0.3), `aria-label "{name} ×{n}"` when n>1 | `.dkstack` when n≥2 (stacked copies, `--d` depth); `.iscover` (accent border; **the only marker of the cover is colour**); `.overcap` (n>2, red border); `.atcap` (**add drawer only**: n≥2, art greyed `grayscale(.55) brightness(.72)`) | `div.dktile` (63/88 aspect, panel2, border) | `:409–413` |
| ghost layers | n−1 (at most 2) offset copies behind the front card, each darker | geometry derived in CSS from `--d`/`--i`/`--dkstep:13%` (`style.css:2705–2744`) | `span.dkghostwrap` (inline `style="--i:{i}"`) | `:414–416` |
| art | `<img class="dkart">` with an inline `onerror` that hides it | lazy loaded | `.dkart` (cover, top-aligned) | `:417–418` |
| over-cap badge | `×3` in red | only when n>2 | `span.dkn.bad` | `:421` |
| control bar | bottom strip of tiny buttons; **always visible** (not hover-gated) | | `.dkbtns` (black .72 scrim; buttons flex:1, white 12px; hover accent fill) | `:422–433` |
| ↳ deck: `−` | "cut one" → `deck-less` | | | `:427` |
| ↳ deck: `+` | "another copy" → `deck-more` | **hidden at 2 copies** | | `:428` |
| ↳ deck: `»` | "move one to the maybeboard" → `deck-to-maybe` | | | `:429` |
| ↳ add: `+` | "add a copy to the deck" → `deck-add` | hidden at 2 | | `:424` |
| ↳ add: `»` | "add to the maybeboard" → `deck-add-maybe` | | | `:425` |
| ↳ maybe: `−` / `+` / `«` | "drop one" / "another copy" / "move one into the deck" → `deck-maybe-less` / `-more` / `deck-from-maybe` | `+` is never capped | | `:430–432` |

The buttons carry tooltips only: `title`, **no aria-label**. `−`, `+`, `»`, `«` are bare glyphs. The tile is a
`<div>` with no `tabindex`, so it cannot be reached by keyboard.

#### 1.7.2 The add drawer (`addDrawerHtml`, `decks.ts:527–562`)

**Closed** (`:529–532`):

| element | copy | → | CSS |
|---|---|---|---|
| open drawer | "+ Add cards" | `deck-adding` (opens and focuses the search) | `button.dkadd` (margin-top only) |
| full browser | "🔍 Browse all cards", title "the full card browser, with the whole filter syntax" | `deck-browse` | `button.dkbrowse` (**no CSS rule**) |

Wrapper `.dkaddrow` (flex gap 6).

**Open** (`section.dkdrawer`: accent border, panel2):

| element | what | states | CSS | line |
|---|---|---|---|---|
| search | `input#dk-search`, placeholder "search the pool — name, type, text, or a filter like  mana:2 -kw:virus" (note the double space) | live; re-renders only the results and the count, so the caret is kept (`wire()` `:1331–1343`) | `.dksearch` (flex:1, **no other styling**: default input look) | `:544–546` |
| browse | "🔍 browse" (lower case here, Title Case on the closed button) | `deck-browse` | button | `:547` |
| done | "done" → `deck-adding-close` | | button | `:548` |
| element chips ×7 | icon + name; tri-state: neutral → `.on` (include) → `.off` (exclude, struck through red) → neutral. Tooltips "include" / "click again to exclude" / "click again to clear" | | `button.elchip.{el}` (opacity .55 off; `.on` outline accent and element border) + `.off` (`style.css:3212`) | `:551` |
| spacer | | | `.dkfilterspacer` | `:552` |
| kind chips | "units", "spells", "in the deck" | tri-state | `button.dkkind` | `:553–555` |
| clear | "clear" → `deck-filter-clear` | only when the query is non-empty | plain button | `:556` |
| result count | `"{n} cards"` + `" — showing the first 60, narrow the search or open the browser to see the rest"` (the live-typing version says "narrow the search to see the rest", `:1341`, so the wording changes as you type) | capped at 60 | `.dkresultcount` (dim 11px) | `:558–559` |
| results | `#dk-results.dkgrid` of `tile(n, countIn(n), 'add')` | greyed at cap; no empty-state text (the count just says "0 cards") | | `:560` |

The pool is deck-legal cards only (`r.playable`). The query language is the browser's (§3.4).

#### 1.7.3 The pinned card panel on the deck page (`focusHtml`, `decks.ts:495–516`)

`cardPanelHtml(focus, { close: 'deck-unfocus', actions })` (§4.1), placed in `.dkwork`'s right column. Actions:

| button | → | when |
|---|---|---|
| "add a copy" (`.primary`, green) | `deck-add` | the card is deck-legal and the deck holds fewer than 2 |
| "cut one" | `deck-less` | n > 0 |
| "to the maybeboard" | `deck-add-maybe` | always |
| "find similar" (title "find cards like this one in the browser") | `deck-browse-card` → the card browser, running `similarQuery` | always |

### 1.8 "Curve & affinity" tab (`deckStatsHtml`, exported, `decks.ts:881–925`)

This is a **pure function of `DeckAnalysis`**, also used on the shared deck page (§5.3). Four or five
`section.acctcard` cards inside `.acctbody.deckbody` (auto-fit `minmax(300px,1fr)`).

| card | elements | CSS | line |
|---|---|---|---|
| **Curve** (`h3`, accent uppercase) | one `.dkcurverow` per mana value 0…max (dense, so a gap shows): mana number, then a stacked bar of segments `units` (blue `#4e7fa8`), `spellunits` (`#6f9ab8`), `spells` (purple `#9a6fb8`), each with an inline `style="flex:N"` and a tooltip "3 units at 2", and a transparent pad; count on the right. Empty rows at opacity .55. An X row when there are X cards. A key: coloured `<i>` swatches labelled "units", "spell units" (when there are any), "spells", plus "X-cost cards sit on no rung — they cost what you pay". Footer hint "Average cost 2.9 mana, not counting 2 X-cost cards." | `.dkcurve`, `.dkcurverow(.empty/.x)`, `.dkcurvem`, `.dkcurvebar .seg.units/.spellunits/.spells`, `.pad`, `.dkcurven`, `.dkcurvekey i.seg` — **segment colours are hard-coded hex, not tokens** (`style.css:2993–2995`) | `curveHtml` `:566–591`, `:884–889` |
| **What is in it** | `.statgrid` of `.statcell`s: "{n} units ({pct})", "{n} spells ({pct})", "spell units" (when any), "battle cards" (tooltip "cards printed {Battle} — playable during a battle rather than in deployment"), "haste cards" (when any), "different cards" | `.statgrid/.statcell/.statval/.statlab` (shared with the profile) | `:890–900` |
| **Elements** | `.elbar` of `.elbarseg.{el}` (inline flex, tooltip "fire: 40%") + `.ellegend` of `.acctel` pills "fire 40%"; empty: "Nothing in the deck yet."; footnote "By card; a hybrid counts half to each element." | `.elbar`, `.elbarseg`, `.ellegend`, `.acctel` | `:901–912` |
| **Affinity — what you need open, and by when** (wide) | `table.dkaff`: header "by mana", "cards", then one column per element in use (icon + name, coloured pill `.acctel.{el}` on a `th`). Rows: mana, card count (dim), cumulative affinity per element; `·` when zero (`.dknone` `#3a434f`); `.dknew` (accent bold) where a requirement first appears, with a tooltip "a card at 3 mana is the first thing that needs 2 fire" / "carried up from a cheaper card". A final row "everything" in bold. Explanatory hint: "The affinity you need **open** by each mana value. **Bold** is where a new requirement first appears. The bottom row is the ceiling: 3 fire + 2 wood can play every card in the deck." Empty: "Nothing in the deck asks for affinity yet." | `.dkaff`, `.dkmana`, `.dknone`, `.dknew`, `.dkmaxrow` | `affinityHtml` `:842–869` |
| **The greediest costs** (wide, when there are any) | up to 8 `.dkdemandrow`s: a cost badge (game icons: `cost_N` or `.costnum` text above 9, plus a pip icon per affinity) + card name. Hint: "These set the ceiling above — cut from here to lower it." | `.dkdemand`, `.dkdemandrow`, `.costbox` (`costnum` has **no CSS rule**) | `:917–924`, `costBadge` `:334–341` |

### 1.9 "Maybeboard" tab (`decks.ts:1142–1150`)

| element | copy | CSS |
|---|---|---|
| heading | "Maybeboard {n}" | `.acctcard h3` + `.acctcount` |
| hint | "Not a sideboard — a shelf for cards you might use. Nothing here is shuffled into a game, and no deck rules apply." | `.acctcard .hint` |
| grid | `groupedTiles(maybe, null, 'maybe')`, the same grouping as the cards tab | §1.7.1 |
| empty | "Nothing on the maybeboard yet." | `div.hint` |
| pinned panel | the same `focusHtml()` | |

### 1.10 "Games" tab (`gamesTab`, `decks.ts:929–953`)

| element | copy / behaviour | CSS |
|---|---|---|
| empty | "No games yet. Press **Play this deck**, then start a constructed game while logged in." plus "(Older record: 3W–1L.)". **"Play this deck" no longer exists as a label**: the button is the `▶` icon. | `.acctcard .hint` |
| heading | "Games with this deck {n}" | `h3` + `.acctcount` |
| table | columns `result · opponent · turns · life · played · room`; result "WIN" / "loss" / "?" (**inconsistent case**); life "20–0"; date "Oct 4"; room = `▶ CODE` link to `?replay=CODE` (title "watch this game back") | `table.accttable.games`, `tr.res-{win/loss/unknown}`, `.resultcell`, `.roomcell`, `a.replaylink` (shared with the profile) |
| footer | "The last 25 games on your profile · full record 3W–1L" | `.hint` |

Data comes from `acct.currentUser()?.history` (the profile's last 25), filtered by `deckId`.

### 1.11 ⚙ Deck settings modal (`settingsLayer`, `decks.ts:668–736`)

Drawn **inside `#app`** (not a layer). The backdrop carries `data-btn="deck-settings-close"` and the box carries the
no-op `deck-stop`, which is how clicking outside closes it. There is **no Escape key**, no `role="dialog"`, no
`aria-modal` and no focus trap, and focus is not moved into the box.

| element | copy / behaviour | states | CSS | line |
|---|---|---|---|---|
| backdrop | full-screen scrim; click closes | | `.dkmodal` (fixed, z95, rgba(0,0,0,.62)) | `:672` |
| box | | | `.dkmodalbox` (min(560px,100%)) | `:673` |
| head | `h2` "Deck settings" + `✕` (title/aria "close") | | `.dkmodalhead` + `.dkicon` (30px here) | `:674–677` |
| section heads | "Name", "Who can see it", "Deck art", "Description", "Export", "This deck" | | `.dkmodalbox h3` (accent uppercase 13px) | `:679–726` |
| name | second copy of the name input (`#dk-name2`), mirrored live with the hero's | | `input.deckname` | `:680–681` |
| visibility | three buttons "Private" / "Unlisted" / "Public", tooltips "only you", "anybody with the link; not listed anywhere", "the link, your profile, and the metagame list" | `.on`; each click saves at once | `.dkvisrow` > `button.dkvisb` | `:689–696` |
| share bar | readonly link input (`onclick="this.select()"` inline) + `🔗` copy button (`copylink`, handled in `main.ts:10558`; the label flips to "copied ✓") | `.off` (opacity .55) when private | `.sharebar` (accent border) + `.sharelink` (monospace) + `.dkicon` | `:703–707` |
| private note | "Private — the link only opens for you." | private only | `p.hint` | `:708–710` |
| cover picker | `🎲 Random from deck` → `deck-cover-random`; status hint "wearing **Card**" / "nothing picked yet"; a grid of every distinct card, most expensive first, each a `button.dkcovertile` (title = name) → `deck-cover`; `.on` accent border | empty deck: "Put some cards in it first." | `.dkcoverbar`, `.dkcovergrid` (minmax 58px, max-height 240, scrolls), `.dkcovertile(.on)` | `coverPickerHtml` `:751–766` |
| description | "Edit it" / "Write one" → `deck-desc-edit` (closes ⚙, opens the editor) | | `.dkmodalacts` | `:716–718` |
| export | "As a card list" / "As a deck file (JSON)" → `deck-export` | | `.dkmodalacts` | `:721–724` |
| duplicate | "Duplicate it" → POST `/api/decks/duplicate`; header shows "copied" | | button | `:728` |
| delete | "Delete it" → `deck-delete` (asks) → becomes "Delete “X” for good" (`deck-delete-yes`) + "keep it" | two-step confirm in place | `button.dkdanger` (red outline) | `:729–732` |

Dead CSS: `.dkvis`, `.dkviso`, `.dkviso.on`, `.dkviso .hint` (`style.css:3269–3274`) belong to the retired three-card
visibility picker and are no longer emitted by anything.

### 1.12 Description editor modal (`descLayer`, `decks.ts:778–801`; syntax note `syntaxHtml` `:806–839`)

| element | copy | CSS | line |
|---|---|---|---|
| box | wide modal | `.dkmodalbox.wide` (min(760px,100%)) | `:781` |
| title | "{Deck name} — description" | `.dkmodalhead h2` (ellipsis) | `:783` |
| `?` | toggles the syntax note; `.on` when open; title/aria "Description syntax" | `.dkicon(.on)` — but `.dkicon.on` has **no rule**, so the open state does not show | `:784–785` |
| `✕` | cancel | `.dkicon` | `:786` |
| syntax note | `h3` "Description syntax"; prose; an `accttable` of write→get pairs (`## A heading`, `**bold** · *italic*`, `- a list item`, `1. a step`, `> a quote`, `` `code` ``, "a blank line"); `h3` "Card names link themselves"; two-bullet list ("Case matters." / "One-word names that are also rules words do not auto-link"); the explicit form `[the two-drop](Ignis Sprite)`; "A pasted URL stays plain text." | `.dksyntax` (max-height 44vh scroll), `.accttable` | `:807–838` |
| textarea | 18 rows, max 6000, placeholder "What is the deck trying to do? What do you keep? What beats it?"; the draft lives in module state `descDraft` so a repaint does not lose it | `textarea#dk-desc.dkdesctext` | `:791–793` |
| actions | "Save" (`.primary`), "Cancel", and the hint "markdown · card names link themselves · 6000 characters" (no live counter) | `.dkaddrow` (reused from the add row) | `:794–798` |

### 1.13 Export modal (`exportLayer`, `decks.ts:1035–1063`)

| element | copy | states | CSS |
|---|---|---|---|
| title | "Export {name}" + `✕` | | `.dkmodalhead` |
| format chips | "card list" / "whole deck (JSON)" | `.on` | `button.dkkind` inside `.dktoolbar` |
| copy | "copy" → `deck-copy-list` (selects the textarea; the label flips to "copied ✓") | | button |
| download | "download" → a blob download of `{name}.txt` or `{name}.json` | | button |
| close | "close" (a third close control, beside `✕` and the backdrop) | | button |
| hint | file: "Description, cover, maybeboard and attribution included — paste it into any import box." / text: "Cards only, one per line — no description or cover. algomancer.cc reads this format." | | `.hint` |
| textarea | readonly, 10 or 16 rows, `onclick="this.select()"` | | `.dkexporttext` (monospace) |

Opening Export from ⚙ closes ⚙; there is no way back to ⚙ except reopening it.

### 1.14 Behaviour notes that matter to a redesign

- **Autosave**: every edit goes through `edit()` → `scheduleSave()` (a 500ms debounce, POST `/api/decks/update`).
  The only visible save state is the static "edits save themselves" in the header. There is no "saving…" or
  "saved" indicator; a failure shows up only in `msg`.
- **Scroll anchoring**: `perch()`/`alight()` (`:1208–1230`) hold the scroll and caret across repaints, and when
  the drawer is open they anchor on `#dk-results`. Any redesign that keeps the full-repaint model inherits this.
- Legality is recomputed on the client every paint (`analyzeDeck`), so the flag, the counts and the strip move
  on the same click.

### 1.15 Building blocks used / reinvented (deck page)

Reused: `.accthead/.accthbtns`, `.accttabs/.accttab/.acctcount`, `.acctcard(.wide)`, `.acctbody`, `.accttable`,
`.statgrid/.statcell`, `.elbar/.ellegend`, `.acctel` (all from the profile page); `.joinrow`, `.zonelabel`,
`.deckmsg`, `.sharebar/.sharelink` (from home and lobby); `.elchip` (home); `.cbdeckbar`, `.cbdetail`, `.cblink`,
`.cardlink` (card browser).

Own: `.dkicon` (icon button), `.dkkind` (chip), `.dkmodal/.dkmodalbox/.dkmodalhead/.dkmodalacts` (the
**only modal in this area**, and it is not the game's `.overlay/.overlaybox` modal), `.dkgrid/.dktile/.dkbtns/.dkn`,
`.dktoolbar`, `.dkfilters`, `.dkcurve*`, `.dkaff`, `.dkexport`, `.dkcover*`.

### 1.16 Design smells (deck page)

- Inline styles: `style="--d:N"` and `style="--i:N"` (`:411`, `:414`); curve segment `style="flex:N"` (`:572–582`);
  element bar `style="flex:N"` (`:905`); inline `onerror="this.style.visibility='hidden'"` on every `<img>` (`:416`,
  `:418`, `:764`, `:962`, `:1083`); inline `onclick="this.select()"` (`:704`, `:1059`).
- Hard-coded colours: curve segments `#4e7fa8 #6f9ab8 #9a6fb8`; `.deckstatus` backgrounds `#1c2a1c/#2a2314`;
  `.dkicon.play.on` `#1c2a1c`; `.dknone #3a434f`; `.dkbtns` hover ink `#12151a`; `.dkn` `rgba(0,0,0,.7)`/`#fff`.
- "bad" means **gold** on `.deckflag.bad` and `.deckstatus.bad` but **red** on `.dkn.bad`, `.dktile.overcap` and
  `.accttable .bad`.
- Emoji or glyphs used as icons: `↻ ▶ ✓ ⚙ ✕ ? 🔗 🎲 🔍 + − » «`.
- Mixed capitalisation in one view: "+ New deck", "Import…", "cancel", "Import it", "Load"; "+ Add cards" /
  "🔍 Browse all cards" vs "🔍 browse" / "done"; ⚙: "Duplicate it", "Delete it", "keep it"; export: "copy",
  "download", "close"; results "WIN" vs "loss".
- Redundancy: the name appears in the input, in the strip ("Building **X**") and in the rail; the count appears in
  the tab, the facts line, the strip and the rail.
- Accessibility: the tiles are `div[data-btn]` (no focus or role); tile buttons have `title` only; the modals
  have no dialog semantics or Escape; the cover is marked by border colour alone; `↻` is unlabelled.
- Unstyled `.hint`/`.dim`/`.good`/`.bad` (§0.3).
- Dead or unused: `.dkvis/.dkviso` CSS; `.deckbtns` (`style.css:2623`); `.deckstatus.ok` (no longer emitted);
  `.dkname` (`:2751`, the tile name banner was removed but its CSS and stack offsets remain); `.dktabletop`,
  `.dkbrowse` and `.costnum` have no rules.

### 1.17 Storybook isolatability (deck page)

- **Pure and exportable today:** `deckStatsHtml(a)` (exported). `curveHtml`, `affinityHtml`, `costBadge`, `tile`,
  `groupedTiles`, `deckRow`, `coverPickerHtml`, `syntaxHtml` and `recordLine` are pure or nearly pure but **not
  exported**, and `groupedTiles` reads the `group` global.
- **Reads globals:** `detailHtml` (`tab`, `group`, `adding`, `search`, `focus`, `settingsOpen`, `descEditing`,
  `exporting`, `descOpen`, `confirmDelete`, `chosenDeck()` → localStorage, `acct.currentUser()`), `paint()`
  (writes `$app` directly and checks `acct.token()`, `cb.screen()` and `tt.screen()`).
- **Fetch:** `/api/decks`, `/api/decks/{create,update,import,duplicate,delete}`.
- **To make stories:** export the view helpers with explicit parameters (`tile(name, n, where, cover)` is already
  explicit; pass `group`), or add a `deckPageHtml(viewState)` that takes everything `paint()` reads. Stub `acct`
  (`token`, `currentUser`, `authHeaders`), `chosenDeck`, and the card index (bundled JSON, so it works as-is).
  Wiring is `data-btn` delegation from `main.ts`, so a story needs a click shim that calls
  `dk.handleButton(closest('[data-btn]'))`, plus `wire()`'s direct input listeners.
- Art URLs come from `assets.ts` `ART_BASE` (relative and depth-sensitive; see CLAUDE.md), so Storybook's static
  dir must serve `data/cards/*.jpg` at the right relative path, or the stories show blank tiles (`onerror` hides
  the image silently).

---

## 2. The tabletop deck builder — `tabletop.ts`, `piletable.ts`, `binder.ts`, `deckstrip.ts`, `drag.ts`, `presszoom.ts`

**Reached by:** "Build on the table" on the deck page (`decks.ts:1117`) → `tabletopHostFor(openId)` →
`tt.openTabletop(host)` (`tabletop.ts:503–513`). The challenge builder reaches it the same way
(`challenge.ts:488`, host `challenge.ts:535–580`). A reload on `?table=<id>` comes back through
`registerTableResolver` (`main.ts:12386–12387`), showing "Setting out the table…" while it waits
(`tabletop.ts:533–534`). The renderer is `pageHtml(h)` (`tabletop.ts:395–448`), painted by `paint()` (`:454–470`,
which passes it through `noImgDrag` and then calls `openBinder`).

### 2.1 Layout

```
.ttpage (fixed: top0 left0 bottom0 right:var(--bdw)=340px | 300px touch)     #binderlayer .ddpanel (fixed right, 340px)
├─ .tttop      [← Back to the deck] [.ttsummary = deck strip] [Re-sort ▾] [Undo]   ├─ "Drop to remove" banner (only while a card hovers it)
├─ .ttselbar   (touch only, when something is picked up)                          ├─ .ddhead  [▴ grab (narrow only)] [Search cards…]
├─ .ttbody                                                                        ├─ .ddchips  7 elements · units · spells · in deck · clear
│   ├─ .tttable  (felt; scrolls)                                                  ├─ .ddcount  "N cards  All cards…"
│   │    └─ .ttrow  gutter | pile | gutter | pile | … | .ttend                     ├─ .ddpin    pinned card (art + buttons)
│   └─ .ttmaybe  (the Maybe pile; a column at the right edge)                     └─ .ddresults  3-col grid of tiles + "Show more (n)"
└─ host.below()  (challenge only: the deck strip, §2.6)
```

**Under 900px** (`style.css:2883–2892`, `:2925–2932`): the binder becomes a **bottom sheet** (height `--ddh:46vh`,
or 88vh with `.full`, a scrim when full); `.ttpage` stops at `bottom: var(--ddh)`; `.ttbody` scrolls as a block;
the Maybe column moves under the table; the strip's mini-curve and element counts are hidden. Card width comes
from JS (`piletable.ts:35–38`): **132px** desktop, **108px** on touch or ≤1366px, **88px** under 900px.

### 2.2 Top bar (`tabletop.ts:432–436`, `toolsHtml` `:384–392`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| back | "← Back to the deck" / "← Back to the challenge" (`host.backLabel`) | | `button.ttback` | `:433` |
| summary | `host.strip()`: the deck strip `deckStripHtml(name, analyze, …)` with lead "Building" (decks) or "Challenge" plus the `ttchnote` "{goal} · Cards on the table are not in the deck. The table is saved in this browser only." (challenge) | the strip is restyled flat here (`.ttsummary .cbdeckbar` has no border or background) | `.ttsummary` | `:434` |
| Re-sort | `<details>` with summary "Re-sort ▾" and a menu "By cost" / "By type" / "By element" → `tt-resort` | the menu auto-closes when a drag starts | `details.ttresort > summary` (styled as a button), `.ttmenu` (absolute dropdown, z30, shadow) | `:387–389` |
| Undo | "Undo" → `tt-undo` | **only right after a Re-sort**, and gone after the next edit | button | `:390` |

### 2.3 Touch selection bar (`selBarHtml`, `tabletop.ts:363–382`)

Appears only after a **finger** tap picks something up (a mouse click pins instead, `:583`).

| variant | elements | CSS |
|---|---|---|
| a card is picked up | **{card name}** · "tap where it goes" (dim) · "Cut" (unless from the binder) · "Maybe" (not from Maybe) · "To deck" (from Maybe) · "New pile" · `✕` (aria "put it down") | `.ttselbar` (panel2 strip), `.dkicon` (32px, pushed right) |
| a pile is picked up (via the grip) | **{pile name}** · `◀` (aria "move left") · `▶` ("move right") · `✕` | same |

### 2.4 The table and its piles (`pileHtml`, `piletable.ts:151–177`; `pageHtml` `tabletop.ts:410–447`)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| felt | the drop zone "end" (a new pile at the end) | radial gradient felt `#1e3029 → --felt #172520` (hard-coded); pan-y only | `.tttable` | `tabletop.ts:439` |
| row | wrapping flex row, row-gap 18 | | `.ttrow` | `:440` |
| gutter | an 18px gap before each pile = drop zone `gap|i` (new pile there) | while a card is over it: a dashed white upright; while a **pile** is carried: a solid accent upright | `.ttgutter(.dropover)` (`::before`) | `:420` |
| end slot | "Drag cards here from the binder." when there are no piles | dashed card outline while a card is over it | `.ttend(.dropover)` | `:441` |
| pile | `section.ttpile`, drop zone `pile|id`, width = card width | `.dropover`: soft white tint; `.ttbefore/.ttafter`: an accent edge while a pile is carried beside it; `.dragsrc`: opacity .3; `.ttpicked`: accent outline (touch) | `.ttpile` | `piletable.ts:165` |
| pile header | the drag handle for the whole pile (mouse drag) | `cursor: grab` | `header.ttpilehead` | `:166` |
| ↳ grip | `⠿`, `aria-label="move this pile"`, `data-btn="tt-head"` (a finger taps it to pick the pile up; a mouse click on it does nothing) | a `<span>`, **not focusable** | `.ttgrip` (dim) | `:163` |
| ↳ name | the pile name; click → becomes an in-place `<input>` (max 40, Enter saves, Escape reverts, blur saves) | `title="Rename"`; a border on hover | `span.ttpilename` → `input.ttpilename.ttrenaming` | `piletable.ts:159`, `tabletop.ts:591–609` |
| ↳ fixed label | "Maybe" | | `.ttpilelabel` (dim uppercase on the Maybe pile) | `:160` |
| ↳ over-cap | `×3`, red pill, title "Card A ×3, Card B ×3" | when any card in the pile is over the cap | `.ttovercap` | `:166–167` |
| ↳ count | the number of cards | | `.ttpilecount` (dim tabular) | `:168` |
| ↳ delete | `✕`, aria "delete pile" → `tt-delpile` | **only on an empty named pile when it is not the last pile** | `.ttpiledel` (red on hover) | `:169` |
| fan | absolutely placed cards, each showing a top strip `S` (a fifth of the card, shrinking to a 14px minimum to fit the pane) | the height is inline `style="height:Npx"` | `.ttfan` | `:171` |
| card | `data-btn="tt-card"`, `data-tt-src`, `data-zoom`; **mouse click = pin in the binder**; touch tap = pick up / put down before | `.ttfront` (just dropped, z400, shadow); `.ttpicked` (touch, accent outline); `.iscover` (a `★` at top right via `::after`); `.draglift` (lifted on press, scale 1.04); `.ttgone` (hidden while its gap preview shows); hover raises it to z500 after .3s (mouse only, not while dragging or zooming) | `.ttcard` + inline `style="--k:K;top:Npx"` | `:172–175` |
| ↳ art | the scan, or `.cbnoart` with the name when there is no scan | | `.ttart` | `:175` |
| ↳ cap number | `×3` small red pill on each over-cap copy | | `.ttcapn` | `:175` |
| Maybe column | `.ttmaybe` > a pile named "Maybe" (no rename, no grip) | deck host only; dark `#141f1b` (hard-coded) | `.ttmaybe`, `.ttmaybepile` | `tabletop.ts:421–429` |

### 2.5 Interaction model (the part a redesign must keep)

`place()` (`tabletop.ts:182–289`) is the single door, and both drags and taps go through it.

| gesture | mouse | finger |
|---|---|---|
| read a card | **press and hold 320ms** (`presszoom.ts HOLD_MS`) or **hold the middle button** and run along a pile (`presszoom.ts:96–101`); a click **pins it in the binder** | hold `PEEK_MS` (the same beat lifts it for a drag) |
| move a card | drag; the pile under the pointer tints and opens a gap where it will land (`showPreview` `:742–768`) | tap to pick up → tap a card (inserts before it) / pile / gutter / end / the binder (Cut) |
| move a pile | drag the header | tap `⠿` → `◀ ▶` or tap a gutter |
| cut a copy | **drag it to the binder** (the binder shows "Drop to remove") | tap → "Cut" |
| to the maybeboard | drag onto the Maybe pile | tap → "Maybe" |
| new pile | drag to a gutter or the end | tap → "New pile" / tap a gutter |
| add from the binder | drag a binder tile onto the table, or its `+` (`place(... {at:'auto'})`) | the same; `+` is always visible on touch |
| keyboard | **none**, apart from Enter/Escape while renaming and Escape to put down a touch selection | — |

The drag ghost is `#draglayer > .dragghost` (rotated -2°, scaled 1.06, `drag.ts:141`), and the source gets `.dragsrc`.
Edge auto-scroll is on (`edgeScroll: true`). `html.dragging` / `html.ttcarrypile` are global flags while a drag lasts.

**Accessibility gap:** with a mouse, moving a card between piles, cutting, sending to Maybe and making a new pile
are **drag-only**. The touch selection bar, which has buttons for all of these, never appears for a mouse
(`lastPointer === 'mouse'` → pin, `:583`). Nothing is keyboard-operable.

### 2.6 The challenge deck strip (`challengeStripHtml`, `deckstrip.ts:64–91`)

Below the table on the challenge host only.

| element | copy | states | CSS | line |
|---|---|---|---|---|
| section | | | `section.ttdeck` (`#141f1b`, top border) | `:76` |
| head | **"Your deck"** · "dealt left to right, 1 on top · {n} cards" (dim) · problem text (when illegal) · **Play** → `ch-play` | Play disabled when there is a problem | `.ttdeckhead`, `.chproblem` (from the challenge page), `button.cta.primary.ttplay` (**the `.primary` here is accent-outlined, not green**, `style.css:2953`) | `:77–81` |
| scroller | horizontal scroll | | `.ttstripbox` | `:82` |
| zone | drop zone `strip`, x-axis | `.dropover` tint | `.ttstripzone` | `:83` |
| hand bracket | "Turn 1 hand · you bottom 2", over the first N cards, tooltip "the cards you start with, as the game deals them" | `.ttnohand` (transparent) when it cannot be dealt; inline `style="width:Npx"` | `.ttbracket > span` | `:73–75` |
| fan | cards at `left:k·Sx`, each a `ttcard` | inline `left`, `width`, `height` | `.ttfan`, `.ttcard` | `:68–70`, `:85` |
| position numbers | 1…n under each card | inline `left` | `.ttstripnums > span` | `:71`, `:86` |
| empty | "Drag cards here from the binder or the table." | `.dim` (unstyled here) | `.ttstripempty` | `:87` |

The report button and the inbox bell are repositioned by CSS while the strip is up (`html.binderup:has(.ttdeck)`,
`style.css:2970–2982`). That is three magic `bottom:` values (285px / 252px / calc).

### 2.7 The binder layer (`binder.ts`)

A layer: `#binderlayer`, appended to `<body>` by `installBinder()` (`binder.ts:280–330`). It closes itself when `#app`'s
first child is no longer `.ttpage` (a MutationObserver, `:324–329`). Its markup comes from `binderHtml()` (`:151–167`),
and later paints update only the parts by id (`paint()` `:178–200`), so the search box is never rebuilt.

| element | copy / behaviour | states | CSS | line |
|---|---|---|---|---|
| panel | `aside.ddpanel`, `aria-label="Card binder"`, drop zone `binder` (= cut) | `.dropover`: red inner glow + the remove banner; `.full` (narrow, 88vh) | `#binderlayer .ddpanel` (fixed right, `--bdw`) | `:153` |
| remove banner | "Drop to remove" | only while a table card is over the panel | `.ddremove` (pink on a red tint, hard-coded `#f1c9c9`) | `:155` |
| grab | `▴`/`▾`, aria "taller"/"smaller" | **narrow only** | `.ddgrab` | `:157` |
| search | `#dd-search`, placeholder "Search cards" | not auto-focused on touch | `.ddsearch` (no other styling) | `:158–159` |
| chips | 7 element **icons only** (no names; `alt` = element), "units", "spells", "in deck" (vs "in the deck" in the drawer), "clear" | tri-state `.on/.off`; **no tooltips** (the drawer's chips have them) | `.ddchips button`, `.elchip.ddel.{el}`, `.dkkind` | `chipsHtml` `:109–120` |
| count | "{n} cards" + "All cards…" link → full browser with this query | | `.ddcount` + `.cblink` | `:139–142` |
| pinned card | the scan (150px; 96px narrow) + **name**, "{n} in the deck", "+ Add" (`.primary`), "» Maybe", "Find similar", `✕` | when a card is pinned (a mouse click on a table card, or a binder tile click) | `.ddpinbox`, `.ddpinart`, `.ddpinside`, `.dkicon` | `pinHtml` `:122–137` |
| grid | 3 columns (auto-fill 84px when narrow) | | `.ddgrid` | `:145` |
| tile | `div.dktile.ddtile`, `data-dd="pin"`, draggable source `binder|name`, `data-zoom` | `.ddon` (pinned, accent outline); `×n` badge: accent `.ddin` for in-deck, red `.bad` over the cap | `.dktile.ddtile`, `.dkn.ddin/.bad` | `tileHtml` `:96–107`, `badge` `:88–93` |
| tile buttons | `+` (aria "add a copy"), `»` (aria "to Maybe") | **hidden until hover on desktop** (opacity 0), always shown on touch. This differs from the deck page, where they always show | `.ddtile .dkbtns` | `:102–105` |
| more | "Show more ({n})" (paged 120) | | `button.ddmore` | `:147` |
| scrim | narrow + full only; tap → half height | | `.ddscrim` | `:152` |

Keys: Escape unpins, then shrinks the sheet (`:311–318`).

### 2.8 Smells (tabletop)

- Hard-coded colours: `--felt #172520`, `#1e3029`, `#141f1b` (three places), scrollbar `#3a4553`, `rgba(23,37,32,.92)`,
  `#f1c9c9`, `rgba(217,84,84,…)` (the danger token re-typed as an rgba).
- Inline geometry styles everywhere (`--cw/--ch`, `--k`, `top`, `left`, `height`, `width`); some of it is inherent to
  the absolute fan.
- **Three implementations of the card-search UI**: the deck drawer (§1.7.2), the binder (§2.7) and the browser's
  bar plus rail (§3). They use different chip sets, labels ("in the deck" / "in deck"), placeholders, page sizes
  (60 / 120 paged / 120 chunked) and "show more" wording ("showing the first 60…" / "Show more (n)" /
  "show 120 more (n left)").
- **Three "pinned card" panels**: `cardPanelHtml` (§4.1), the binder's own `.ddpinbox`, and the press zoom.
- Glyphs as icons: `⠿ ✕ ◀ ▶ ▴ ▾ ★ » + ←`.
- `.primary` means a green fill on the deck page and an accent outline on the strip's Play (`.ttplay.primary`).
- Mouse users have no non-drag route for most edits (§2.5).

### 2.9 Storybook isolatability (tabletop)

- `pileHtml(PileView)` (`piletable.ts:151`) and `challengeStripHtml(StripView)` (`deckstrip.ts:64`) are **pure, exported,
  parameterised**: ideal first stories. `scanHtml` reads the bundled card index.
- `pageHtml(h: TableHost)` is exported and takes an interface, so a story can pass a fake `TableHost`. But it
  reads `document.documentElement.classList` (touch), `innerWidth`, `.tttable`'s height and module globals
  (`sel`, `front`, `undo`).
- **Import side effect:** `tabletop.ts:825` calls `addDragProvider(provider)` at module load, and drag needs
  `installDrag` (main.ts) to listen. Press zoom installs document listeners on `initTabletop`. The binder is a
  body-level layer with a MutationObserver that **closes itself unless `#app > .ttpage` exists**, so a binder
  story must mount a `#app` with a `.ttpage` child.
- `.ttpage` is `position: fixed` with `right: var(--bdw)`, so it fills the Storybook canvas. Use a full-screen
  layout.
- Stub: the card index (bundled, fine), `touch.ts`'s `touchSeen`/`PEEK_MS`, and the `main.ts` click delegator
  (`tt-*` via `data-btn`; `data-dd` is self-contained).

---

## 3. The card browser — `cards.ts`

**Reached by:** `cards-openpage` (home `🔍 Cards`), `?cards=1`, `?card=<name>`, or from the deck page, the binder or
the challenge in **deckbuilding mode** (`cb.useDeck(bridge); cb.openBrowser(query)`). The renderer is `paint()`
(`cards.ts:511–536`).

### 3.1 Layout

```
.cbpage (max 1500)
├─ .accthead   h1 "Cards" + hint            [Return to Lobby | Back to the deck]
├─ .cbdeckbar  (deckbuilding mode only)     "Building X · n cards · legal · ▁▃▅ · 🔥4 💧2 · [back to the deck]"
├─ .cbbar      [ query input ............................ ] [×] [?]
├─ .cberr      (parse errors)
├─ .cbsuggest  (did you mean …)
├─ .cbtools    sort [select] [↓] grid|list|text   ……  saved searches · save search · forget
├─ .cbhelp     (syntax sheet, toggled by ?)
└─ .cbmain     grid: 220px rail | results | 320px detail (when pinned)  → one column under 1100px
     ├─ aside.cbrail  (sticky, viewport-high, scrolls)
     ├─ section.cbresults
     └─ section.cbdetail (pinned card)
```

### 3.2 Header (`cards.ts:516–525`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| title | "Cards" | 26px (`.accthead h1`), unlike Decks' 22px | `.accthead h1` | `:518` |
| hint | "The {n} cards. Tokens and reference cards: `class:all`." where `class:all` is a `.cblink` → `cards-try` | | `.accthead .hint` | `:519–520` |
| back | "Return to Lobby" or, in deckbuilding mode, "Back to the deck" → `cards-close` | always `.primary` (green) | `.accthbtns button.primary` | `:523` |

### 3.3 The deck strip in deckbuilding mode (`deckSideHtml`, `cards.ts:473–477`)

`deckStripHtml(bridge.name(), bridge.summary(), { trailing: '<button data-btn="cards-toDeck">back to the deck</button>' })`
(§4.2). So the page has **two** "back to the deck" buttons in deckbuilding mode (the header's "Back to the deck"
and the strip's "back to the deck"), with different capitalisation and the same effect. Here the strip is **not sticky**;
on the deck page it is.

### 3.4 Query bar and tools (`barHtml`, `cards.ts:479–509`)

| element | copy / behaviour | states | CSS | line |
|---|---|---|---|---|
| query input | `#cb-q`, placeholder "search — try  el:wood kind:unit mana:2 -kw:virus"; a 90ms debounced full repaint that keeps the caret; written to the URL (`?q=`) and to localStorage `algoCardQuery` | focused when the page opens; `/` focuses it from anywhere | `.cbq` (monospace 15px, accent focus border) | `:483–485` |
| clear | `×` (title "clear") → `cards-clear` | only when there is a query | `.cbclear` | `:486` |
| help | `?` (title "search syntax") toggles the syntax sheet | no `.on` style when open | plain button | `:487` |
| errors | the parser's messages joined with " · ", e.g. `unknown filter "foo:" — try kind`, "unclosed quote — closed it for you", `"mana<=" has nothing after it`, "sort: must be one of …" (`cardsearch.ts:245–386`) | | `.cberr` (red 12px) | `:489–491` |
| suggestions | "did you mean `attr:deadly` or `…`?", each a `.cblink` with a `<code>` and a tooltip of why (`cardsynonyms.ts` `suggest`) | | `.cbsuggest` | `:492–495` |
| sort | `<label>sort <select id="cb-sort">` with options name, mana, pow, tou, element, kind, set, rarity, relevance (lower-case raw keys) | answers `change` | `.cbtools select` | `:497–500` |
| direction | `↑` / `↓` (title "reverse the order") → `cards-dir` | | button | `:501` |
| view | "grid" / "list" / "text" → `cards-view` (written into the query as `view:`) | `.on` | `.cbviews button(.on)` | `:502–503` |
| saved searches | each saved query as a `.cblink` (its name truncated to 24 chars + "…") | from localStorage `algoCardSearches`, max 8 | `.cblink` | `:505` |
| save | "save search" (title "keep this search") | when there is a query | button | `:506` |
| forget | "forget" (title "drop the saved searches") | when any are saved | button | `:507` |

### 3.5 Facet rail (`railHtml`, `facets`, `SECTIONS`, `cards.ts:194–298`)

`aside.cbrail`: sticky, `max-height: 100dvh-20px`, scrolls; **static under 1100px**. Ten collapsible sections. Each is
`section.cbsection(.open)` > `button.cbsectionhead` (title in uppercase + an active-count pill `.cbactive` (accent) +
caret `▾`/`▸` `.cbcaret`) > `.cbchips` (a scrolling box, max `min(42vh, 360px)`) + an optional `.cbnote`.

| section (open by default?) | chips (labels as shown) | note |
|---|---|---|
| **Element** (open) | 7 element chips with icons (`.elchip.{el}`), "mono", "hybrid", "colourless" | "click once to include, twice to exclude" (the only place the tri-state is explained) |
| **Cost** (open) | 0–8, X, "1 pip", "2 pips", "3 pips" | — |
| **Kind and timing** (open) | Unit, Spell, Token, Deployment only, Haste, Battle, Virus | — |
| **Attributes** | every printed attribute (derived) with counts, plus "burst", "unstable" | — |
| **Mechanics** | raw flag names: augment, graft, ambush, prophecy, **discardme**, debt, transform, **tokenmaker** | — |
| **This deck** (deckbuilding only) | "in the deck", "on the maybeboard" | — |
| **Subtypes** | the 40 most common, with counts | "the forty most common — the rest are one `sub:` away" (backticks print literally; the note is not markdown) |
| **Printed deck** | "Base Game", "Kickstarter Exclusive", "**Light vs Dark**" (`cardindex.ts:80–82`; elsewhere the set is "Light & Dark") with counts | "which box it came in — the element decks are under Element" |
| **Complexity** | values from the data, with counts | — |
| **What kind of thing** | card, token, resource, marker, help, exclusive | "tokens, resources and the box’s reference cards are not deck-legal" |

Chip: `button.cbchip` (+ `.elchip.{el}` for elements) `.on` (accent, bold) / `.off` (red, struck through), count
`.cbn` (dim 10px); tooltips "include X" / "showing only X — click to exclude" / "hiding X — click to clear"
(`chipHtml` `:268–277`). **Capitalisation is mixed across sections**: "Unit/Spell/Token" capitalised; "mono/hybrid",
"card/token/…" and the mechanics lower case; attributes as data. **Spelling** is mixed too: the chip says
"colourless", the flag is `is:colorless` and the value is `none`.

### 3.6 Results (`resultsHtml`, `cards.ts:369–391`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| count | "**{n}** cards — showing {k}" | | `.cbcount` (+ `b` 15px) | `:379–380` |
| implicit-class note | "tokens and reference cards not counted — `class:all`" (a link that appends `class:all`) | when the implicit class filter applied | `.cbimplicit` | `:381–384` |
| zero results | "nothing matches — loosen a filter, or check the syntax under “?”." | | `.cbcount .hint` | `:385` |
| **grid view** | `.dkgrid.cbgrid` (auto-fill **170px**, about 6 abreast) of `tileHtml` | default | | `:378` |
| **list view** | `.cblist` of `rowHtml` rows | | | `:376–377` |
| **text view** | a readonly textarea of names (4–30 rows, `onclick="this.select()"` inline) | | `.cbtext` (monospace) | `:373–375` |
| more | "show {min(rest,120)} more ({rest} left)" → `cards-more` | | `.cbmore` (centred) | `:388–390` |

**Grid tile** (`tileHtml` `:333–343`): `div.dktile.cbtile` (`data-btn="cards-focus"`, `data-prev`), art via `artHtml`
(or `.cbnoart` with the name for the nine artless cards), `×n` copies badge in deckbuilding mode (`.dkn`, `.bad`
over 2), a class tag "TOKEN"/"RESOURCE"/… for non-cards (`.cbclass`, and the tile gets `.noncard` at opacity .82),
`.sel` for the keyboard cursor (accent outline), and a hover accent border. Deckbuilding buttons (`tileButtons`
`:303–311`): `−` (when n>0) "cut one", `+` "add a copy" (**not capped at 2 here**, though the deck page and the
binder cap it), `»` "add to the maybeboard" (absent when `bridge.noMaybe`, i.e. a challenge).

**List row** (`rowHtml` `:351–367`): `div.cbrow` (grid `76px 172px 164px 40px 1fr auto auto`; zebra striped; under 900px
only cost, name and the extras show): cost icons (`costHtml`), name, type, P/T (`.cbpt`, always present, empty for
spells), one-line rules text (icons inline, `<br>` flattened), `×n`, deckbuilding buttons.

### 3.7 Pinned card panel (`detailHtml`, `cards.ts:398–421`)

`cardPanelHtml(focus, { close:'cards-unfocus', rulings, extra, actions })` (§4.1) in the 320px third column; it moves under the
results below 1100px. Extras: "In {n} published deck(s) — `metagame`" (when n>0, from `/api/deck/played`, a silent
failure) and a "card stats" link (`meta-stats-open`, data-card). Actions: "find similar", "rulings" (fetches
`/api/cardinfo`; shows "loading…", the rulings as paragraphs, or "no recorded rulings for this card."), "copy link"
(title "a link to this card, to paste in Discord or anywhere", flips to "link copied ✓"), and in deckbuilding mode
"add to {deck name}" (`.primary`).

### 3.8 Syntax help sheet (`helpHtml`, `cards.ts:425–460`)

`section.cbhelp` (a panel card inserted **between the toolbar and the results**, pushing them down; it is not a
modal). Contents: close `×` (`.cbclose`); `h2` "Search syntax"; an intro sentence; an example `pre.cbexample`
`-el:fire (sub:sprite OR sub:demon) mana<=3`; `table.cbkeys` with columns "filter / also / what it matches / example"
generated from `KEYS` (23 rows, `cardsearch.ts:65–92`), where each example is a `.cblink` → `cards-try` that runs it
and closes the sheet; `h3` "Operators" prose; `h3` `is:` with every flag (~40) as a `.cblink` + dim help, joined
with " · " into one long run-on paragraph (`.cbflags`, line-height 1.9); `h3` "Ordering" with `sort:` / `dir:` / `view:` values.
Escape closes it.

### 3.9 Keyboard (`handleKey`, `cards.ts:829–885`)

`/` focus search · Escape (closes help → unpins → blurs) · ↓/↑ (also while typing) and →/← (when not typing) move
the cursor `.sel` · Enter pins · `+`/`=` add and `-` cut in deckbuilding mode. **This is the only page in the area with
keyboard navigation.**

### 3.10 Smells (card browser)

- Labels are raw identifiers: sort options (`pow`, `tou`, `rarity`, `relevance`), view names, mechanic chips
  (`discardme`, `tokenmaker`).
- "Light vs Dark" vs "Light & Dark"; "colourless" vs `colorless`.
- Two "back to the deck" buttons with different case.
- `?`'s open state is not shown; the help sheet is inline rather than a popover, so it shoves the results down.
- `+` in deckbuilding mode is not capped (but the deck page and binder are), so the same deck behaves differently
  depending on where you add from.
- Inline `onclick` / `onerror`.
- The tiles are `div[data-btn]` with no focus or role. Keyboard users get the cursor but cannot Tab to a card.

### 3.11 Storybook isolatability (card browser)

- Not exported: `tileHtml`, `rowHtml`, `railHtml`, `resultsHtml`, `barHtml`, `helpHtml`. All read module globals (`q`,
  `bridge`, `cursor`, `shown`, `railOpen`, `helpOpen`, `focus`, `rulings`, `playedIn`). `barHtml` reads
  **localStorage** on every render (`savedSearches()`).
- `initCards` reads `location.search`; `syncUrl` writes `history.replaceState`.
- Data: the card index and the search are **bundled and pure** (`cardsearch.search`, `cardindex.allRows`), so
  real data needs no stubbing. Fetch only for `/api/deck/played` and `/api/cardinfo`.
- To make stories, lift a `cardsPageHtml({ q, bridge?, focus, shown, helpOpen, railOpen, cursor, saved, rulings,
  playedIn })` or export the pieces with parameters. A `DeckBridge` is a plain interface (`cards.ts:53–76`), so a
  fake one turns on deckbuilding mode.

---

## 4. Shared components — `cardpanel.ts`, `decklayout.ts`, `cardlinks.ts`

All pure and DOM-free, so these are the best Storybook candidates in the area.

### 4.1 `cardPanelHtml(name, { close, actions?, rulings?, extra? })` — the pinned card panel (`cardpanel.ts:147–181`)

Used by the deck page (§1.7.3), the card browser (§3.7), the shared deck (§5.3) and card stats (§6.3).

| part | content | CSS |
|---|---|---|
| frame | sticky, viewport-high, scrolls | `section.cbdetail` |
| close | `×` (title "close"), the host's `data-btn` | `.cbclose` (absolute top-right) |
| art | `artHtml(r,'cbdetailart')` / `.cbnoart` | `.cbdetailart` |
| name | `h2` | `.cbdetail h2` (17px) |
| cost | mana icon(s) per digit + pip icons; unknown pips as `[p]` text | `.cbdetailcost` |
| type line | iconised type + " · P/T" | `.cbdetailtype` (dim 12px) |
| rules text | paragraphs, iconised | `.cbdetailtext p` |
| reminders | one line per glossary term, e.g. "**Virus** cards can also be applied…" or "**Term** — sentence", then MTG-synonym meanings | `.cbgloss` |
| facts | `dl`: set, complexity, class (+ " · not deck-legal"), "engine: not scripted — cannot be played here yet", "source: pre-release art, provisional", creates, transforms into | `.cbfacts dt/dd` |
| extra | host markup | `.cbfact` (by convention) |
| actions | host buttons | `.cbdetailbtns` |
| rulings | paragraphs or "no recorded rulings for this card." | `.cbrulings` |

Card stats reorders the children with `order:` (`style.css:3764–3770`), so the same component looks different
there.

### 4.2 `deckStripHtml(name, summary, { trailing?, lead? })` — the deck strip (`cardpanel.ts:220–247`)

| part | content | CSS |
|---|---|---|
| frame | | `.cbdeckbar` (accent border, panel2) |
| name | "{lead='Building'} **{name}**" (leads in use: Building / Deck / Challenge) | `.cbdeckname` |
| count | "{n} cards" | `.cbdeckcount` |
| legality | "legal" (green) or the first problem (accent) | `.ok` / `.warn` (styled only inside `.cbdeckbar`) |
| mini curve | one bar per mana value (inline `style="height:N%"`), the mana value under it, tooltip "{m} mana: {n}" | `.cbminicurve`, `.cbcbar i/em` |
| element counts | icon + count (one decimal, e.g. "4.5" for hybrids) | `.cbdeckels`, `.cbdeckel` |
| spacer + trailing | host button | `.cbspacer` |

Used on the deck page (sticky), the card browser (not sticky), the tabletop top bar (flattened, curve and elements
hidden under 900px), the shared deck page (lead "Deck") and the challenge page.

### 4.3 `decklayout.ts`

`GROUPINGS` (labels + hints), `deckSections(a, grouping)`, `stackLayers(n)` and `needsCountBadge(n)`: the shared
vocabulary of the deck grid, used by `decks.ts` and `meta.ts`. **The tile markup itself is not shared**: `decks.ts tile()`
and `meta.ts deckTile()` are two copies of the stacked tile, and they already differ (meta uses `artHtml` with a
`.cbnoart` fallback inside the ghost wrappers; decks uses a raw `<img>` + `onerror`; meta has no controls).

### 4.4 `cardlinks.ts`

`cardLinker({ focusBtn?, art? })` makes `a.cardlink[data-prev][data-prevart?][data-btn?]` (no href; **not focusable**;
dotted underline, accent). `clipDescription(src, budget)` and `descSummary(src)` are text-only helpers.

---

## 5. Metagame — `meta.ts`

One module, **four views** (`view: 'list' | 'deck' | 'ladder' | 'stats'`), one `paint()` (`meta.ts:533–543`). The three
top-level tabs appear on list, ladder and stats, **but not on the shared deck view**.

### 5.1 The tab row (`tabsHtml`, `meta.ts:193–199`)

| tab | → | CSS |
|---|---|---|
| "Published decks" | `meta-list` | `.cbtools.metatabs button(.on)` (sentence case; the deck page's tabs are uppercase `.accttab`) |
| "Card stats" | `meta-stats-open` | |
| "Card duel ladder" | `meta-ladder` | |

The tab row reuses `.cbtools` (a **toolbar** class: 12px, dim) rather than `.accttabs`, so this page's tabs look nothing like
the deck page's tabs.

### 5.2 Published decks list (`listHtml`, `meta.ts:351–393`; reached by `meta-openpage`/`?meta=1`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| header | `h1` "Metagame" + `p.hint` "Decks people have published, with their records." + "Back" → `meta-close` | Back is a bare button in `.accthead` (§0.3.4), not primary | `.metapage`, `.accthead` | `:362–366` |
| tabs | §5.1 | | | `:367` |
| message | load errors: "could not load the metagame list" / "could not reach the server" | | `.acctmsg` (**no CSS**) | `:368` |
| sort | "sort" label + "winrate" / "most played" / "newest" / "name"; each click **refetches** from the server | `.on` **not styled** (§0.3.2) | `.cbtools`, `.zonelabel` | `:369–372` |
| search | `#meta-q`, placeholder "name, builder, or a card in it"; filters on the client; full repaint, caret restored | | `.dksearch` | `:374–375` |
| element chips | 7 `.elchip.{el}` toggles (include only, **no exclude** state, unlike the browser's tri-state) | `.on` | `.dkfilters` | `:377–379` |
| clear | "clear" | when filtered | button | `:380` |
| loading | "loading…" | first load | `p.hint` (unstyled) | `:382` |
| empty: filters | "Nothing matches those filters." | | `p.hint` | `:385` |
| empty: nothing yet | "Nothing on the list yet. A deck appears here once it is **public**, **legal** and has {5} constructed games behind it, played signed in." | | `p.hint` | `:386–387` |
| row | `button.metarow` → `meta-open`: cover 46px (`.metacover`), name (`.metaname` bold), "by {user} · after {owner}’s {deck}" (`.metaby` + `.dim`), a one-line description snippet (`.metadesc`, ellipsis), element pills (`.metaels` > `.acctel`), record on the right (`.metarec`: "**NN%** 6W–4L in 10 games · 3 copies"; the % is `.good/.bad`, **uncoloured**) | hover accent border | `.metarow` (grid 46/1fr/auto) | `rowHtml` `:333–349` |
| footer | "Every deck here is legal and has at least 5 constructed games behind it." | when rows exist; says the same as the empty-state text | `p.hint` | `:390–391` |

### 5.3 Shared deck view (`deckHtml`, `meta.ts:484–531`; reached by a row or `?deck=<id>`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| not found / loading | `h1` "Deck" + "Back"; `p.hint` with the message "That deck is not shared, or the link is wrong." / "loading…" / "That deck is not shared."; and "See the metagame list" | | `.metadeck` | `:485–491` |
| header | `h1` {deck name}; `p.hint` "by {user} · after X’s Y · unlisted — only people with the link see this"; **two** bare buttons "Metagame" (`meta-list`) and "Back" (`meta-close`) | | `.accthead` | `:500–507` |
| message | "copying…", "Copied into your collection — {note}. It starts private.", errors | | `.acctmsg` | `:508` |
| strip | `deckStripHtml(name, a, { lead: 'Deck' })`, so the name appears again right under the h1 | | `.cbdeckbar` | `:509` |
| record | "**NN%** 6W–4L in 10 games · 3 copies" (the % only when games ≥ minGames) or "no games yet" | | `.deckrecline` | `:510`, `recordLine` `:294–307` |
| description | markdown, clipped at **400** (vs 600 on the deck page), card links that pin (`meta-focus`) but **do not hover** (no `art`); "read more"/"show less" | | `.deckdesc(.on)`, `.deckdescbody`, `.cblink` | `:511–515` |
| take | "Copy this deck to my collection" (`.primary`) → POST `/api/decks/take` | signed in and not yours; yours: "Yours — edit it on your decks page." (a hint; **no button to go there**) | `.dkaddrow` | `:516–521` |
| share bar | "Send somebody this link:" + readonly link + "copy" (word; the ⚙ modal uses a `🔗` icon) | | `.sharebar`, `.sharelink` | `:522–524` |
| export | closed: "Export this deck" (`.dkadd`); open: **inline** panel (not the deck page's modal): "export" label, "card list"/"whole deck (JSON)", "copy", "close" (**no download**, unlike the deck page), hint, textarea | | `.dkexport`, `.dktoolbar`, `.dkkind`, `.dkexporttext` | `:525`, `exportHtml` `:465–482` |
| grid toolbar | "group by" + the four groupings + "Stats"/"Hide stats" toggle (title "curve, elements, and the affinity this deck needs open") | `.on` | `.dktoolbar`, `.dkkind` | `deckGrid` `:439–447` |
| stats | `deckStatsHtml(a)` (§1.8), folded by default | | `.acctbody.deckbody.metastats` (`.metastats` has no rule) | `:448` |
| grid | `.dkgroup`/`.dkgrouphead`/`.dkgrid` of `deckTile` (stacked copies, `×n` only over the cap, **no controls**; click → `meta-focus` pins) | | `.dktile(.dkstack)` | `:449–453`, `deckTile` `:404–425` |
| pinned card | `cardPanelHtml(focus, { close:'meta-unfocus' })`, with **no actions** (no "find similar", no "copy link", no "card stats") | | `.dkwork`, `.cbdetail` | `:526–529` |

### 5.4 Card duel ladder (`ladderHtml`, `meta.ts:223–254`; reached by `meta-ladder`/`?cardladder=1`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| header | `h1` "Card duel ladder"; `p.hint` "Every card's Elo from Single Card Duels — thirty copies of one card against thirty of another. The cards are rated, never the players. Start a duel from the home screen, under Constructed."; "Back" | | `.metapage`, `.accthead` | `:232–238` |
| tabs | §5.1 | | | `:239` |
| summary | "{d} duels · {c} cards rated" | | `.cbtools .dim` | `:242` |
| search | `#meta-q`, "find a card" | **shares the `text` variable with the decks list**, so a filter typed on one tab carries over to the other | `.dksearch` | `:244`, `:77` |
| loading / empty / no-match | "loading…", "No duels yet. Somebody has to go first.", "No rated card matches that." | | `p.hint` | `:246–248` |
| row | `div.metarow.ladderrow` (a div styled to look like the button rows): cover, "#{rank} {card}", "6W–4L in 10 duels · 2 mirrors", rating **bold** on the right | **not clickable** (`cursor: default`); `data-prev` does nothing; no way to see the card | `.metarow.ladderrow` | `ladderRowHtml` `:210–221` |
| divider | "NOT ENOUGH DUELS YET — a card is ranked once it has 5 duels that were not mirrors." | unranked cards listed below it | `.metadivider` (+ `.hint`) | `:250–252` |

No sorting control, no column headers. The rating number is unlabelled ("1532" means Elo only from the intro text).

### 5.5 Smells (meta)

- Back buttons: "Back" (list, ladder, stats, deck) vs "Return to Lobby" (decks, cards) vs "← Back to the deck"
  (tabletop); the shared deck has "Metagame" **and** "Back"; none use `.accthbtns`.
- Unstyled `.on`, `.hint`, `.acctmsg`, `.good/.bad` (§0.3).
- The ladder rows imitate a button (`.metarow` on a div, then `.ladderrow` puts the border back).
- The export panel is inline here and a modal on the deck page, and it lacks "download".
- The search text is shared between the decks list and the ladder.
- The 46px cover thumbnail is reinvented three times: `.deckrowart` (46, crops with a negative margin), `.metacover` (46,
  object-fit), `.csthumb` (26×36).

### 5.6 Storybook isolatability (meta)

- Nothing is exported except `openStats`, `openLadder`, `artFor`, `screen`, `renderScreen` and `handleButton`.
  `listHtml`, `rowHtml`, `deckHtml`, `deckTile`, `deckGrid`, `exportHtml`, `ladderHtml` and `ladderRowHtml` read
  module globals (`rows`, `one`, `ladder`, `text`, `els`, `sort`, `focus`, `deckGroup`, `statsOpen`, `descOpen`,
  `exporting`, `msg`, `loading`, `minGames`) plus `acct.currentUser()`/`acct.token()` and `location`.
- `rowHtml(d: PublicDeck)` and `ladderRowHtml(c, rank)` are pure apart from `artFor` (index) and would be trivial to export.
- Fetch: `/api/deck/meta?sort=`, `/api/deck/shared?id=`, `/api/cardladder`, `/api/decks/take`. `initMeta` triggers fetches
  from `location.search`, so a story must not call `initMeta` with a real URL, or it must mock `fetch`.

---

## 6. Card stats — `cardstats.ts` (the metagame page's "Card stats" tab)

**Reached by:** the "Card stats" tab, the browser panel's "card stats" link (`meta-stats-open` with `data-card`),
or `?cardstats=1` / `?cardstats=<card>`. `meta.ts` owns the URL, tabs and paint; `cardstats.pageHtml(tabsHtml())`
(`cardstats.ts:495–510`) builds the markup and `afterPaint()` wires the search box.

### 6.1 Page frame and filters (`pageHtml`, `headerHtml` `cardstats.ts:260–286`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| header | `h1` "Card stats"; `p.hint` "How every card has done, from every game played here. Each percentage has its number of games beside it — a small number is a small sample."; "Back" | | `.metapage.cspage` (max 1480) | `:497–502` |
| tabs | §5.1 | | | `:503` |
| format | "format" label + "both" / "draft" / "constructed" (refetch) | `.on` **not styled** | `.cbtools.csfilters`, `.zonelabel` | `:268–269` |
| played | "played" + "ever" / "last 30 days" / "last 7 days" (refetch) | `.on` not styled | | `:270–271` |
| toggles | "rated only", "both signed in", "my games" (the last only when signed in) | `.on` not styled, so **it is impossible to tell whether a toggle is on** | | `:273–275` |
| coverage line | "**N** games · M seats · 2026-09-01 → 2026-11-01 · **K** of M seats have every draw on record (why?)" + " · **your games only**". "(why?)" is a `span.dim` with a long `title`: **tooltip-only explanation**, not focusable, invisible to touch | | `p.hint.csline` | `:277–281` |
| section tabs | "Cards" / "Elements" / "Highlights" / "Games" | `.on` styled (it is a `.metatabs`) | `.cbtools.metatabs.cssections` (identical styling to the page tabs, so there are two tab rows that look the same) | `:282–285` |
| message | "Only {n} games match these filters. Card stats need at least 5, so nobody's hand from one game is on show — widen the filters." / server error / "could not reach the server" | | `.acctmsg` (no CSS) | `:505`, `load` `:115–117` |
| loading | "loading…" (first load only; a refetch shows the old data with **no indicator**) | | `p.hint` | `:506` |

### 6.2 "Cards" section (`tableHtml`, `cardstats.ts:290–319`)

| element | copy | states | CSS | line |
|---|---|---|---|---|
| search | `#meta-cs-q` "find a card" | caret restored after a full repaint | `.dksearch` | `:298` |
| kind | "all" / "units" / "spells" (a spell unit counts as a spell, `kindOf` `:217–221`) | `.on` **not styled** | buttons in `.cbtools` | `:299–300` |
| min games | "min games" + `−` (aria "fewer") **N** `+` (aria "more"), 1–50 | | `.zonelabel`, `b.csmin` | `:302–303` |
| element chips | 7 `.elchip.{el}` (include only; matches ANY element) | `.on` | `.dkfilters` | `:305–306` |
| clear | "clear" | when any filter is set | button | `:307` |
| table | sticky header; **sticky first column** "Card {n}"; sortable columns (§ below), with header buttons showing `▾`/`▴` and a tooltip of the definition | the focused row is `.on` (accent tint `rgba(217,164,65,.10)`, hard-coded) | `.cswork` (dkwork + 340px panel), `.cstablewrap` (x-scroll), `table.cstable`, `th.csnum`, `button.cssort(.on)` | `:309–314` |
| card cell | a button → `meta-cs-focus`: 26×36 thumbnail (hidden under 700px), name, element icons | | `button.csname`, `.csthumb`, `.cselicons .acctel.icon` | `cardName` `:255–258` |
| WR cell | "NN%" + a small game count, background tinted on a diverging orange↔cyan scale (**inline `style="background: rgba(…)"`**, hard-coded colours, `wrTint` `:138–143`), tooltip "W won of N" | `·` when n=0 | `td.csnum.cswr` + `small` | `wrCell` `:145–149` |
| IWD cell | "+NNpp" tinted; tooltip "GIH 55% of 40 vs not seen 48% of 30" | | `td.csnum` | `:151–155` |
| empty | "No card matches that." | | `p.hint` | `:315` |

**Columns** (`COLS`, `cardstats.ts:174–211`; the set depends on the format):

| key | label | tooltip | formats |
|---|---|---|---|
| games | Games | seat-games the card figured in at all | all |
| gih | GIH WR | win rate when it was in your hand at any point | all |
| oh | OH WR | … opening hand | all |
| drawn | Drawn WR | … reached your hand after the opening — drawn, or drafted in | all |
| played | Played WR | … when you played or cast it | all |
| gns | GNS WR | … in your deck or your draft's pool and you never held it | all |
| iwd | IWD | improvement when drawn: GIH minus not-seen, in points | all |
| playrate | Play % | of the games you held it, how often you played it | all |
| firstturn | Turn | average turn it was first played on | all |
| recycled | Recycled | copies recycled for a resource | all |
| pick | Pick % | of the copies in a pack you drafted from, how many you took | all, draft |
| pos | Pick pos | average place in a pack's life it was taken at: 0 fresh, 1 once passed, 2 twice passed | draft |
| passed | Passed | copies left in a pack you drafted from | draft |
| given | Given | copies you moved out of your hand into a pack | draft |
| deck | Deck % | of the constructed decks, how many ran it | all, constructed |
| copies | Copies | average copies in the decks that ran it | constructed |
| deckwr | Deck WR | win rate of the decks that ran it | constructed |
| bottom | Bottom % | of the copies held, how many were put on the bottom in the draw step | constructed |

The 17lands jargon (GIH, OH, GNS, IWD) is explained **only in `title` tooltips**, which a touch user cannot read; there is no legend.

### 6.3 Pinned card with stats (`detailHtml`, `cardstats.ts:339–379`)

`cardPanelHtml(name, { close: 'meta-cs-unfocus', extra: '<div class="csdetail">…' })`, reordered by CSS so the numbers
come right after the name and the art shrinks to 62% (`style.css:3764–3770`).

| part | content | CSS |
|---|---|---|
| four tiles | "in hand", "opening hand", "played", "never seen": a big %, "N games", a tinted background (inline style) and a tooltip | `.cstiles`, `.cstile`, `.cstilelabel` |
| IWD sentence | "Holding it: **+7 points** against the games it sat unseen." / "Not enough to compare holding it with not seeing it." | `p.hint` |
| "In the draft" `h4` | bars: "in packs you drafted from", "taken" (+%), "given back from hand"; "Taken on average at pick **0.8** of a pack's life (0 fresh, 2 twice passed)." | `.csbars/.csbar/.csbarlabel/.csbartrack/.csbarfill.pick` (`#4fb3c9` hard-coded), `.csbarval` |
| "In constructed" `h4` | "decks that ran it" (+ "1.8 copies"), "bottomed in the draw step" | `.csbarfill.deck` (`#9aa5b0` = the metal colour, hard-coded) |
| "What happened to it" `h4` | "held (copies)", "played", "recycled for a resource" | `.csbarfill.fate` |
| "First played on turn" `h4` | a column histogram, tooltip "turn 3: 5" (the last bucket shows "+") | `.cshist/.cshistcol/.cshistbar` (inline height %) |
| none | "No finished game under these filters has this card in it." | `p.hint` |

### 6.4 "Elements" section (`elementsHtml`, `cardstats.ts:383–425`)

- An explanatory paragraph ("A player's colours are the elements that make up at least a quarter…").
- `table.cstable.cselements`: Element (`.acctel` pill with icon) · Win rate (a tinted `wrCell`) · a diverging bar from the 50% line
  (`.cswrbar/.cswrmid/.cswrfill.up|.down`, inline left/width; colours `#4fb3c9`/`#e07b39` hard-coded) · Picked (a share bar
  in the element colour `.csbarfill.el-{el}` + number) · Played (the same).
- `h3` "Colour pairs" + hint + a 7×7 upper-triangle matrix `table.cspairs` (element icons only as headers, `title`
  = element; cells "NN%" + count, tinted; `·` empty; `.csblank` below the diagonal).
- `h3` "Draft trios" + `.cstrios` pills (three icons + a count).

The "Colour pairs" matrix is **icon-only headers**; the element name is only in the tooltip.

### 6.5 "Highlights" section (`highlightsHtml`, `cardstats.ts:436–465`)

A sentence-with-stepper: "Every list counts only cards with at least [−] N [+] games behind the number." (the
stepper is shared with the Cards section's `minGames`). Then `.csboards` (auto-fill 260px) of 12 `.csboard` cards, each
an `h4` (with a tooltip) + an `ol` of up to 8 `button.csboardrow` (thumbnail, name, **value**, small sub-line) → `meta-cs-focus`
(switches to the Cards section and pins the card). Boards: Best in hand · Worst in hand · Biggest swing · Best when
played · First picks · Passed over · Least drafted · Given back · Most played · Best mana · Most main-decked · Sent to
the bottom. Empty board: "Nothing yet."

### 6.6 "Games" section (`gameHtml`, `cardstats.ts:469–491`)

Two tiles ("on the play" win rate, tinted; "games" with seats); `h3` "How long games run" + a wide histogram
(`.cshist.cshistwide`, the count above each bar, the turn below) + the caption "turns per game"; `h3` "Where the numbers come from" +
a paragraph + `ul.cssources` ("**N** recorded as played", "replayed and proven by its board fingerprints", "replayed and
checked card by card", "read from what each player did (older rules)", "decklists only").

### 6.7 Smells (card stats)

- Toggle states are invisible (§0.3.2), which is the worst usability bug in the area.
- Hard-coded colour scales in JS (`rgba(79,179,201,a)` / `rgba(224,123,57,a)`) and duplicated in CSS (`#4fb3c9`, `#e07b39`);
  the accent re-typed as `rgba(217,164,65,.10)`; `#9aa5b0` in place of `var(--metal)`.
- `ELEMENTS` is hard-coded in this file (`:60`) while every other file imports `ALL_ELEMENTS`/`ELEMENTS`.
- Jargon and explanations live only in tooltips ("(why?)", column definitions, pair headers).
- No loading indicator on a refetch.
- Two identical-looking tab rows (page tabs and section tabs).

### 6.8 Storybook isolatability (card stats)

- `pageHtml(tabs)` is exported, but it reads module state (`data`, `mode`, `range`, `rated`, `bothSigned`, `mine`, `section`,
  `sortKey`, `sortDir`, `text`, `els`, `kind`, `minGames`, `focus`, `loading`, `msg`) and `acct.currentUser()`. `data`
  can only arrive by `fetch('/api/cardstats')`. A story needs either a mocked fetch returning a `CsResult` fixture (the
  type is exported, `:44–54`) or a small refactor so `pageHtml(view, data)` takes them.
- `tableHtml`, `detailHtml`, `elementsHtml`, `highlightsHtml`, `gameHtml`, `bars`, `tile`, `wrCell` and `cardName` are pure given
  `data` plus state, and are good candidates for export.

---

## 7. Card zoom / hover / press on these pages (`zoom.ts`, `presszoom.ts`, `main.ts` hover)

| mechanism | where it works in this area | where it does not | file:line |
|---|---|---|---|
| hover zoom (dock magnifier) | **nowhere in this area**: it targets `.card, .rescard, .stackcard` only | deck tiles, browser tiles and rows, meta tiles, stats rows | `zoom.ts:174–186`, `main.ts:10075` |
| long-hover text box (`data-prev`, 550ms) | **dead off the board**: `mouseover` arms it only for `[data-prevart]` | every `data-prev` tile and row in this area | `main.ts:10043–10052` |
| art tip (`data-prevart`) | card names in a description on **your own** deck page (`cardLinker({art:true})`) | the shared deck page's description (no `art`) | `decks.ts:645`, `meta.ts:512`, `main.ts:9958–9965` |
| press zoom (`data-zoom`) | tabletop cards, the strip, binder tiles: mouse hold 320ms, middle button, finger hold | the deck page, the browser and meta (no `data-zoom`) | `presszoom.ts`, `zoom.ts:465–510` |
| click to pin a panel | the deck page, the browser, the shared deck, card stats (`.cbdetail`); the tabletop (the binder's `.ddpinbox`) | the ladder (rows inert) | — |

So **a card is read three different ways depending on the page**: a pinned side panel (deck, browser, meta, stats), the
binder pin plus press-zoom (tabletop), or the hover zoom (the game board, out of scope).

---

## 8. Cross-page component census (reinventions)

| concept | variants in this area | where |
|---|---|---|
| **Page header** | `.accthead` + `.accthbtns` (decks, cards) · `.accthead` + a bare button (meta ×4) · `.tttop` + `.ttback` (tabletop) · `.joinscreen` (decks logged out) | §1.2, §3.2, §5, §2.2 |
| **Back button copy** | "Return to Lobby" (primary green) · "Back to the deck" (primary) · "back to the deck" · "Back" (plain) · "Metagame" + "Back" · "← Back to the deck" / "← Back to the challenge" · "← Back" (tabletop loading) | — |
| **Tabs** | `.accttabs/.accttab` (uppercase, decks) · `.cbtools.metatabs` (sentence case, meta + stats sections) · `.cbviews` (browser view switch) · grouping `.dkkind` chips | §1.6, §5.1, §6.1, §3.4 |
| **Chips/toggles** | `.elchip` (opacity-based) · `.cbchip` (tri-state, struck through) · `.dkkind` (small, accent) · `.dkvisb` · plain `button.on` in `.cbtools` (unstyled) · binder `.ddchips button` | — |
| **Search input** | `.cbq` (styled monospace) · `.dksearch` (unstyled default input; used by the drawer, meta, ladder, stats) · `.ddsearch` (unstyled) · `.joinrow input` (room-code look, misused for URL import) | — |
| **Card tile** | `decks.ts tile()` · `meta.ts deckTile()` · `cards.ts tileHtml()` · `binder.ts tileHtml()` · `piletable.ts` `.ttcard` · cover-picker `.dkcovertile` · stats `.csthumb` | all `.dktile` except the last three |
| **Art URL helper** | `decks.ts art()` (`getCard().image`) · `meta.ts artFor()` · `cardstats.ts art()` · `cardpanel.ts artUrl` · `main.ts art()` | five copies of "name → scan URL" |
| **Pinned card** | `cardPanelHtml` `.cbdetail` (4 hosts, reordered on stats) · binder `.ddpinbox` | §4.1, §2.7 |
| **Deck summary** | `deckStripHtml` `.cbdeckbar` · deck hero `.deckfacts` · deck row `.deckrowmeta` · `deckStatsHtml` | — |
| **Record line** | `decks.ts recordLine` ("3W–1L in 4 games · 1 with no result") · `meta.ts recordLine` ("NN% 6W–4L in 10 games · 3 copies") · deck row ("3W–1L") · ladder ("6W–4L in 10 duels · 2 mirrors") | four formats |
| **Modal** | `.dkmodal` (deck page only) · inline panels (meta export, browser help `.cbhelp`) | — |
| **Close control** | `✕` `.dkicon` · `×` `.cbclose` · "close" / "done" / "cancel" / "keep it" words · `✕` aria "put it down" | — |
| **Export** | modal with download (decks) · inline without download (meta) | §1.13, §5.3 |
| **Share link** | `.sharebar` with a `🔗` icon (⚙) · `.sharebar` with "Send somebody this link:" + "copy" (meta) · "copy link" button (browser panel) | — |
| **Show more** | "— showing the first 60, narrow the search…" (drawer, capped) · "show 120 more (n left)" (browser) · "Show more (n)" (binder) | — |
| **Empty / loading** | `.hint` text in five unstyled contexts; "loading…" (lower case, no spinner) everywhere; no skeletons; no error styling (`.acctmsg` unstyled, `.deckmsg` accent, `.cberr` red) | — |

---

## 9. Design smells — consolidated, worst first

1. **Selected state invisible on the metagame sort and every card-stats filter** (`meta.ts:371–372`, `cardstats.ts:268–275`,
   `:299–300`): `.on` has no rule under `.cbtools`. The user cannot tell which sort is active or whether "rated only" or "my
   games" is on.
2. **Semantic utility classes with no definition**: `.hint`, `.dim`, `.acctmsg`, `.good`, `.bad`, `.ok`, `.warn` are styled
   only under specific parents (§0.3.1). Records lose their green/red, errors look like body text, and empty states look
   like content. Meanwhile the same word means different colours where it *is* defined (`bad` = gold on `.deckflag` and
   `.deckstatus`, red on `.dkn` and `.accttable`).
3. **Card reading is inconsistent and partly dead**: `data-prev` hover no longer does anything on these pages, yet comments
   and markup still assume it does (`decks.ts:372`, `cards.ts:324`); the shared-deck description hovers nothing while the
   same description on the owner's page hovers art; the ladder rows are inert; the tabletop uses a press zoom that
   nothing else in this area has.
4. **Drag-only actions on the tabletop for mouse users and no keyboard path at all** (§2.5); the tiles everywhere are
   `div[data-btn]`, not focusable; the `.cardlink` `<a>` has no href; the modals have no dialog semantics or Escape
   (`decks.ts:672`, `:780`, `:1040`); important explanations live only in `title` tooltips (card stats "(why?)", column
   definitions, the pair matrix headers, every tile button).
5. **Three card-search UIs and four tile implementations** that already disagree (caps, chip sets, labels, page sizes,
   hover-gated vs always-on buttons), plus **five art-URL helpers** and **four caret-preserving repaint helpers**.
6. **Headers and navigation drift**: five page max-widths; two header structures; seven wordings of "back"; "Return to
   Lobby" where there is no lobby; uppercase tabs on one page and sentence-case on the next; two identical-looking tab rows
   on card stats.
7. **Hard-coded colours outside the token set**: the curve segments, the felt and table greens (`#172520`, `#1e3029`, `#141f1b`),
   the win-rate scales in JS (`cardstats.ts:142`) and CSS (`#4fb3c9`, `#e07b39`), the accent and danger re-typed as rgba,
   `#9aa5b0` in place of `--metal`, and `button.primary`'s green `#3c5a2f`/`#5b8747` vs `.primary` = accent outline in
   `.homebtns`/`.ttplay`.
8. **Inline styles and handlers**: `style="--d/--i/flex/height/width/left/top/background"`, `onerror="this.style.visibility='hidden'"`
   on every scan, and `onclick="this.select()"`. A strict CSP is impossible as written.
9. **Copy and labels**: raw identifiers shown to players (`pow`, `tou`, `relevance`, `discardme`, `tokenmaker`, GIH/OH/GNS/IWD);
   mixed capitalisation within one panel; "Light vs Dark" vs "Light & Dark"; "colourless" vs `colorless`; "maybeboard" /
   "Maybe" / "maybe"; stale instructions ("Press **Play this deck**", `decks.ts:933`); a comment/code mismatch on the
   description budget (900 vs 600, `decks.ts:621–629`).
10. **Dead CSS**: `.dkvis`, `.dkviso*`, `.deckbtns`, `.deckstatus.ok`, `.dkname` (and its stack offsets); and rules missing
    for emitted classes (`.dktabletop`, `.dkbrowse`, `.costnum`, `.metastats`, `.dkicon.on`).

---

## 10. Storybook — what it would take, per module

| module | renderer(s) | pure? | reads | fetch | events | story effort |
|---|---|---|---|---|---|---|
| `cardpanel.ts` | `cardPanelHtml`, `deckStripHtml`, `artHtml`, `costHtml`, `glossaryFor` | **yes, exported** | the bundled card index + glossary | none | host `data-btn` strings | **trivial**; start here |
| `piletable.ts` | `pileHtml(PileView)`, `scanHtml` | **yes, exported** | the card index | none | `data-btn tt-*` | trivial (needs the `.ttpage`'s `--cw/--ch` vars on a wrapper) |
| `deckstrip.ts` | `challengeStripHtml(StripView)` | **yes, exported** | the card index | none | `tt-*`, `ch-play` | trivial |
| `decklayout.ts` / `deckstats.ts` / `deckarrange.ts` / `deckformat.ts` | data only | yes | the card index | none | — | fixtures for the other stories |
| `decks.ts` | `deckStatsHtml(a)` exported; everything else private | partly | ~20 module globals, `acct`, `chosenDeck` (localStorage) | 6 endpoints | `main.ts` delegation + `wire()` listeners | **medium**: export `tile`, `deckRow`, `curveHtml`, `affinityHtml`, `coverPickerHtml`, and add a `deckPageHtml(state)` |
| `cards.ts` | all private | no | globals + **localStorage at render** + `location` | 2 (optional) | delegation + `wire()` + `handleKey` | **medium**: lift a page-state object |
| `meta.ts` | all private | no | globals, `acct`, `location` | 4 | delegation + `oninput` | medium; `rowHtml`/`ladderRowHtml` are near-pure |
| `cardstats.ts` | `pageHtml(tabs)` exported but state-bound | no | globals, `acct` | 1 | delegation via `meta` | medium: a `CsResult` fixture + a setter or param |
| `tabletop.ts` | `pageHtml(h: TableHost)` exported | nearly | `sel/front/undo`, `document` (touch class, pane height, innerWidth) | none | **drag provider registered at import**; press zoom listeners; delegation | **hard** for interaction stories (needs `installDrag`), easy for static ones with a fake host |
| `binder.ts` | private `binderHtml`; a layer | no | globals | none | its own capture listener (`data-dd`), **a MutationObserver that self-closes unless `#app > .ttpage`** | hard; needs the full layer harness |

**What every story needs regardless:**
- `style.css` loaded whole: it is one global sheet, and `body`, `button`, `#app:not(.board)` and the token `:root` are all needed.
  Note `#app` is a grid by default (`style.css:41`), so wrap stories in `#app` without `.board`, or the page squeezes into
  `1fr 290px`.
- A click shim: `document.addEventListener('click', e => module.handleButton(e.target.closest('[data-btn]')))`, since every
  button in this area relies on `main.ts`'s delegator.
- Card art served at the path `assets.ts ART_BASE` resolves to (relative, depth-sensitive), or every scan disappears silently
  via the inline `onerror`.
- A stubbed `account.ts` (`token`, `currentUser`, `authHeaders`) for anything that branches on sign-in.

**Constraints a redesign must respect (tests and coupling, read before renaming anything):**
- `test/212-card-browser-wiring`, `214-deck-page-wiring`, `220-deck-layout`, `336-card-stats-wiring`, `535-tabletop-page`,
  `536-tabletop-routes`, `537-binder-layer`, `540-challenge-tabletop`, `213-cardlinks`, `189-collection-loading` and
  `716-piles-and-stacks` read this markup or these sources. 212 also forbids `cards.ts` and `decks.ts` from importing each other,
  which is why `cardpanel.ts` exists.
- `tutorial.ts:62` and `:81` spotlight buttons by `data-btn` name (`deck-new`, `deck-import-open`, `deck-export`,
  `cards-help`, …). `deck-export` exists only inside the ⚙ modal, so the spotlight cannot find it unless ⚙ is open.
- `ui/report.ts` reads the page's **last** root class to name the page in bug reports (`tabletop.ts:430` comment), so the root
  class names (`deckpage`, `cbpage`, `metapage`, `metadeck`, `cspage`, `ttpage`) are load-bearing.
