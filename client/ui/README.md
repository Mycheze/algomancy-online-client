# `ui/` — the browser client

Everything the player sees: the home screen, the board, the lobby, the deck
builder, the profile, the tutorial. One `index.html`, one stylesheet built
from the pieces in `styles/`, and one esbuild bundle built from `main.ts`. It imports the engine; the engine never
imports it.

```bash
npm run build        # styles/ → bundle.css (concatenated), main.ts → bundle.js (minified, external source map)
npm run typecheck    # tsc --noEmit, borrowing ../engine's tsc
npm test             # node --test test/**/*.test.ts, ~85 files, DOM-free
npm run check        # all three, which is what the client root's `check` calls
```

There is no dev server of its own. `npm --prefix .. run dev` builds this
bundle and serves it from the game server; `index.html?demo` opened straight
off disk is a scripted mid-battle, the same engine running in the page and
nothing to click. It is the only route that needs no server at all, which is
what keeps the `file://` half of `ART_BASE` below honest.

## How it is put together

**`main.ts` is the page**: it owns `#app`, renders the current screen into it
with `innerHTML` on every state change, and routes buttons. Everything that
must survive that wipe is a **layer**: a sibling of `#app` that installs itself
once and paints only when its own state changes. The bug-report form
(`report.ts`), the rules reference (`rules.ts`), the help overlay
(`helplayer.ts`), the legal footer and pages (`legal.ts`), the lesson panel
(`lessonlayer.ts`), the sandbox (`sandbox.ts`) and the tab alert
(`tabalert.ts`) are all layers, and each exposes one `install…()` call.
`test/269-overlays-in-all-three-lists.test.ts` is the census that keeps the
list of layers honest.

**Logic is split from painting.** Every decision the client makes is a pure
function over engine state, tested without a DOM, and only the final paint
is not:

| decides | paints | what |
|---|---|---|
| `motion.ts` | `anim.ts` | which cards moved between zones, which arrows to draw (a state diff, not an event feed) |
| `sfx.ts` | `audio.ts` | at most one sound cue per state change, and the idle thump — plus the LIFE channel, which sits outside that contest because a life change never arrives alone |
| `flash.ts` | `main.ts` | what is on the visual stack right now, including items that resolve with no response window |
| `formation.ts` | `main.ts` | the battle line's column arithmetic, and what to publish to the opponent while you build one |
| `cardtext.ts` | `cardpanel.ts`, `inspect.ts`, `cards.ts` | a card's text box as the rules see it now: printed text, donated mods, granted text, suppression, live stats |
| `deckstats.ts` | `decks.ts` | the curve, the unit/spell split and the affinity table a deck is judged on |
| `cardsearch.ts` | `cards.ts` | the card browser's query language; the game server and the Discord bot run the same grammar through `/api/cardsearch` |

**The wire.** The WebSocket client is in `main.ts` (`queue.ts` holds the
matchmaking socket). It sends `{join}`, `{action}` and `{lobby}` messages and
receives the redacted view, the events and the legal-action list the server
computed. The client never
holds hidden information. `solo.ts` is an in-browser server that speaks the
same protocol, which is how the Learn to Play lessons run against a scripted
opponent with no network at all (`bot.ts`, `lessons.ts`, `lessonflow.ts`).

**Assets.** `assets.ts` is the only module that spells an asset URL.
`ART_BASE` is deliberately relative and its depth is load-bearing twice: over
HTTP the excess `..` clamps to the route the server serves, and over `file://`
it walks two real directories up to the repo root, which is the only reason
`index.html?demo` off disk shows card art. `test/247-asset-paths.test.ts`
guards it.

**Reminder text.** Three JSON tables beside the code hold the game's own words
for a glossary term, each with a `_README` inside saying where its text comes
from: `manual-reminders.json` (quoted from the Manual, checked word for word
by `test/231-manual-text.test.ts`), `card-library-reminders.json` (reminders
printed on cards the pool does not carry) and `scan-reminders.json` (type-line
reminders the oracle transcription omits). `glossary.ts` and `rules.ts` read
them.

## How the pages are drawn (the design system)

The non-game pages are built in four layers, each in its own place
([`docs/23-design-system.md`](../docs/23-design-system.md) is the plan and its § Progress says how far it got):

1. **Tokens** — [`styles/tokens.css`](styles/tokens.css): every colour, size, space, radius and shadow as a
   `--color-*` / `--text-*` / `--space-*` … custom property. A new colour is a token first.
2. **Base** — [`styles/base.css`](styles/base.css): the element defaults (headings, links, `.hint`/`.dim`,
   `.eyebrow`, text fields, the focus ring), all under `:where()` and never on the board.
3. **Components** — [`components/`](components/README.md): `ui-` pieces as pure `props → HTML string` functions
   (button, panel, page header, tabs, table, status …), CSS in `styles/components/`.
4. **Pages** — [`pages/`](pages/README.md): one module per page, `…View()` gathers, a pure `…Html(view)` draws
   from components, `paint…()` touches the DOM. The page's own CSS is `styles/pages/<nn>-<page>.css`.

**The stylesheet is one file built from pieces.** [`styles/index.css`](styles/index.css) lists them with
`@import`, and that order IS the cascade: tokens → base → components → the page, board and shared pieces in their
historical order (later overrides earlier, so a piece never moves casually). `npm run build` concatenates them into
`bundle.css`; tests read the same text through `test/read-styles.ts`. The board's pieces are `styles/board/`; a
page's are `styles/pages/`; what both use is `styles/shared/`.

**Storybook** ([`../storybook/README.md`](../storybook/README.md)) shows every component and every page from
made-up views, on the site's real CSS: `cd client/storybook && npm install && npm run storybook`. It is where a page
design is iterated. **ui-shots** (`client/server/e2e/ui-shots.mjs`, compared with `ui-shots-compare.mjs`) photographs
every page state at three widths against a fixed fixture; a restructure is proved by 0 differences.

**The guards** (all in `npm run check`): 920 the piece list and order, 921 no new colour literal in a page piece,
925 no page re-declares a base selector, 940 every component has its CSS, story, test and barrel line, 962 every
`pages/*.ts` `…Html` is pure, 992 every page has a story and a DOM-free test, 993 no colour literal in a page or
component `.ts`, 994 no stray stylesheet (no `style.css`, no `.css` outside `styles/`, no injected `<style>`),
995 no page hand-writes a `ui-` class, 996 the READMEs name every page and component file.

## Touch

The client is used on iPads. Hover is gated on the pointer type, never on a
media query; the rail's card menu and the table's ☰ are the finger's
right-click; the action bar sits at the bottom. `test/273-touch-reach.test.ts`
is the guard.

## The board

The middle of the table is the **regions** board (`lboardHtml`,
`docs/18-board-layout-v2.md`): `regionParts` placed into the owner's
topology — each player's region a colour, its vertical position saying who
*controls* a card — and it never scrolls: `layout.ts` measures every zone
after each paint and `fit.ts` decides the card width, fanning the cards past
the floor. It is the only board since board round 8 (2026-10-29), which
deleted the classic board, its ▦ toggle (`algoLayout`) and the side rail; the
right column is a 50px toolbar, and a card is read by the hover zoom with its
current text beside it. `test/317` and `test/318` are its guards.

## Files that are not TypeScript

- `index.html`: the one page. It links `bundle.css` and `bundle.js`.
- `styles/`: the stylesheet's SOURCE, canonical — `tokens.css`, `base.css`,
  then `board/`, `pages/` and `shared/` pieces, which `styles/index.css` lists
  one `@import` each in cascade order. The order is load-bearing: they were
  cut word for word out of the old single `style.css` (2026-11-02,
  `scripts/split-styles.mjs`), a changelog of overrides, so a piece moved past
  one it overrides changes the page. A new piece goes into `index.css` exactly
  once (`test/920`). Tests read the CSS only through `test/read-styles.ts`.
- `scripts/`: `build-css.mjs` (the CSS half of `npm run build`) and
  `styles.mjs` (the one concatenation, shared by the build and the tests).
- `bundle.css`, `bundle.js`, `bundle.js.map`: the build output, gitignored.
  `bundle.css` is `styles/` concatenated byte for byte — never esbuild, which
  would re-print it and break the tests that read the CSS as text.
- `favicon.ico`, `icon-192.png`, `apple-touch-icon.png`, `og-image.jpg`: the
  site icons and the link preview, generated from the game's own glyphs by
  `site-icons.py` (Python, because Pillow; run by hand when the art changes).
- `sfx/`: the sound cues, one `.ogg` per cue — CC0 from Kenney, except the two
  life cues, which are ours and synthesised. `sfx/NOTICE.md` has the provenance
  of each and the exact `sox` line that made the pair.
- `test/ui-driver.ts`: the harness the UI tests drive the page with.
