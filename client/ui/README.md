# `ui/` — the browser client

Everything the player sees: the home screen, the board, the lobby, the deck
builder, the profile, the tutorial. One `index.html`, one stylesheet, and one
esbuild bundle built from `main.ts`. It imports the engine; the engine never
imports it.

```bash
npm run build        # main.ts → bundle.js (minified, external source map)
npm run typecheck    # tsc --noEmit, borrowing ../engine's tsc
npm test             # node --test test/**/*.test.ts, ~85 files, DOM-free
npm run check        # all three, which is what the client root's `check` calls
```

There is no dev server of its own. `npm --prefix .. run dev` builds this
bundle and serves it from the game server; `index.html` opened straight off
disk is the hotseat rig, both hands visible, the same engine running in the
page (`?demo` jumps into a mid-battle).

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
it walks two real directories up to the repo root, which is the only reason the
hotseat rig shows card art. `test/247-asset-paths.test.ts` guards it.

**Reminder text.** Three JSON tables beside the code hold the game's own words
for a glossary term, each with a `_README` inside saying where its text comes
from: `manual-reminders.json` (quoted from the Manual, checked word for word
by `test/231-manual-text.test.ts`), `card-library-reminders.json` (reminders
printed on cards the pool does not carry) and `scan-reminders.json` (type-line
reminders the oracle transcription omits). `glossary.ts` and `rules.ts` read
them.

## Touch

The client is used on iPads. Hover is gated on the pointer type, never on a
media query; the rail's card menu and the table's ☰ are the finger's
right-click; the action bar sits at the bottom. `test/273-touch-reach.test.ts`
is the guard.

## Files that are not TypeScript

- `index.html`, `style.css`: the one page and its stylesheet.
- `bundle.js`, `bundle.js.map`: the build output, gitignored.
- `favicon.ico`, `icon-192.png`, `apple-touch-icon.png`, `og-image.jpg`: the
  site icons and the link preview, generated from the game's own glyphs by
  `site-icons.py` (Python, because Pillow; run by hand when the art changes).
- `sfx/`: the sound cues, one `.ogg` per cue — CC0 from Kenney, except the two
  life cues, which are ours and synthesised. `sfx/NOTICE.md` has the provenance
  of each and the exact `sox` line that made the pair.
- `test/ui-driver.ts`: the harness the UI tests drive the page with.
