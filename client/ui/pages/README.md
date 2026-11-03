# `client/ui/pages/` — the non-game pages

Where the client's pages live once they are converted to the page contract
(`client/docs/23-design-system.md` § Target structure, Phase 4). Started
2026-11-03 by moving the home screen, the waiting rooms, the deck picker and
the connecting screen out of `main.ts`. Every other page is still in its own
module at `client/ui/<name>.ts`; the table below says where, and how hard each
is to bring here. The next wave converts them one page per round.

## The page contract

A page module `pages/<page>.ts` exports three things:

| | what | rules |
|---|---|---|
| `<page>View(state?)` | gathers everything the page shows into a plain object | the ONLY place that reads module state, `localStorage`, the account, other modules. Markup another module draws (the account bar, the league banner…) comes in as a string **slot**, gathered here in the order the page used to call it — some of those fetch while drawing |
| `<page>Html(view)` | draws the view | **pure**: no `document`, `window`, `localStorage`, `location`, `fetch`, timers, no other module's namespace (`acct.`, `dk.` …), none of its own `let` state. Test 962 reads every exported `…Html` under `pages/` and fails on any of them |
| `paint<Page>(app, …, rerender)` | `app.innerHTML = <page>Html(<page>View(…))`, then the wiring (listeners, polls, caret carry) | the only part that touches the DOM |

And the rules that keep a conversion invisible:

- **`data-btn` names never change** (nor `data-help`, `data-learn`, `data-report`, `data-inbox`, `data-legal`, …). The click
  handlers, the tutorial and ~150 ui-driver tests find buttons by them.
- **Class names that tests read from markup never change** unless the test changes in the same commit, with the reason.
- **A move is not a rewrite.** Copy the template byte for byte; replace only the expressions. Prove it twice: the
  markup through `test/ui-driver.ts` before and after (byte-identical), and `ui-shots` (0 differences).
- **No import from `main.ts`** — importing it boots the client. State that main.ts and a page both need goes in a small
  shared module (`pages/caret.ts` is the example) or is passed in.
- **Import order is boot order.** `main.ts` imports `pages/*` LAST, and a page imports only modules main.ts already
  imported above it, so nothing is evaluated earlier than it was.
- A page gets a DOM-free test of its `…Html` (960–962 are the pattern: made-up views, `<!--SLOT:x-->` markers for the
  slots, and the `data-btn` names asserted).

## What is here now

| file | exports | what |
|---|---|---|
| `home.ts` | `homeView`, `homeHtml`, `paintHome`, `constructedOptionsHtml`, `singleDuelHtml`, `saveHomeName` | the home screen. `main.ts renderHome()` is still the **router** (which page owns `#app`) and calls `paintHome` when none does |
| `waiting.ts` | `constructedWaitingView/Html`, `singleWaitingView/Html`, `paintWaiting` | the waiting rooms: constructed + constructed league, Single Card Duel; dispatches the draft trio lobby (`lobby.ts`) and the Competitive match room (`match.ts`) |
| `deckpicker.ts` | `deckPickerView`, `deckPickerHtml`, `deckPicker`, `wireDeckPicker`, `importDeck` | the constructed deck picker (home, waiting room, and the queue through `initQueue`) with its state |
| `clockpick.ts` | `clockPickView`, `clockPickHtml`, `chosenClockMs`, `CLOCK_*` | BL-26's clock banks and picker. Engine test 279 locks `CLOCK_DEFAULT_BY_MODE` to the server's copy by reading this file |
| `connecting.ts` | `connectingHtml` | "Connecting to the server…" and a refused join |
| `caret.ts` | `caretIn`, `restoreCaret` | the caret carry, shared with the board's `snapshotViewport` |

**Still in `main.ts`, on purpose:** `handlePregameButton` — the home and waiting-room buttons (`eltoggle`, `elrandom`,
`clockpick`, `newgame`, `joincode`, `deckimporturl/text`, `deckjoin`, `singlejoin`, `gohome`, `copylink`). They write
main.ts state (`ui.homeEls`, `uiError`, `NET`) and open the room. `TODO(ds): view/html split:` move them here once
`uiError` and the element pick have a home outside main.ts's `UiState`. Also the **kicked** notice, written inline in
`NetBackend`'s message handler.

## Every non-game page and screen

Tangle: **easy** = a pure `…Html` exists or the page is one template; **medium** = module state or fetches to pull
into a view, one module; **hard** = many module globals, fetch/poll during render, DOM work interleaved with markup, or
shared with the board. CSS is under `client/ui/styles/` (`pages/` unless it says `board/` or `shared/`). "Driver tests"
are the ui-driver tests (`test/ui-driver.ts` `home()`/`client()`/`replay()`) that put the page on screen; tests that
import a pure renderer or read source are not listed. ui-shots states are `page__state` in
`client/server/e2e/ui-shots-states.mjs`; *cc* marks states that exist only on a fixture built with `--cc`.

### Front door and play flow

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| **Home** | `pages/home.ts` homeView/homeHtml/paintHome; router `main.ts` renderHome; buttons `main.ts` handlePregameButton | 06-home, 18-draft-lobby (`.fixedtrio`, Custom rules), 33-single-card-duel, 07-lobby (picker), 30-queue (strip), 47-competitive-match, board/13 (`.clockpick`), shared/10-element-chips | 366, 839 (and 610/634/732 start here) | home__signed-out, home__signed-in, home__folds-open, home__bell-open, home__cc-your-matches *cc* | **easy** now (split done); the buttons are medium — they write `ui.homeEls`/`uiError` |
| Deck picker (home, waiting room, queue) | `pages/deckpicker.ts` | 07-lobby (`.deckselect`, `.deckinfo`, `.deckimport`, `.deckpaste`, `.deckmsg`) | 366 (on home), 254 (waiting room) | home__*, waiting__constructed, queue__constructed | **easy** (split done) |
| Clock picker | `pages/clockpick.ts` | board/13-playtest-round4-clocks-report (`.clockpick`) | 366 | home__folds-open | **easy** (split done) |
| Custom rules panel (Live draft card) | `customrulespanel.ts` panelHtml/wirePanel | 18-draft-lobby (`.customrules`), 10-element-chips | 366 | home__folds-open | **easy**: panelHtml is one function over 7 module `let`s; give it a view |
| Single Card Duel fold + card picker | `pages/home.ts` singleDuelHtml; `singlecard.ts` pickerHtml/wire | 33-single-card-duel | — | home__folds-open | **easy**: pickerHtml reads one `let` (the chosen card) |
| Competitive card + "Your matches" row (home) | `match.ts` competitiveCardHtml, yourMatchesHtml, loadMyMatches | 47-competitive-match | 839 | home__signed-in, home__cc-your-matches *cc* | **medium**: `bestOf`/`pickId`/`mine` are module state, and the row fetches on paint |
| Recent updates band | `updates.ts` updatesHtml/wireUpdates | 06-home (`.upd*`) | — (323 is DOM-free) | on every home__* | **easy**: already `(list, seen) => string` |
| Matchmaking queue page | `queue.ts` renderScreen (13 `let`s; borrows the deck picker through initQueue) | 30-queue, 04-joinscreen | — | queue__picker, queue__constructed, queue__signed-out | **medium**: repaints the whole page every second while searching (inventory bug 2) |
| Connecting / refused join | `pages/connecting.ts` connectingHtml; `main.ts` renderConnecting | 04-joinscreen (`.joinscreen`, `.joinerr`) | 254 | — (a socket screen) | **easy** (done) |
| Kicked ("another connection took over") | `main.ts` NetBackend message handler, `m.t === 'kicked'` | 04-joinscreen | 70, 355 | — | **easy** markup, but it sits inside the socket class; move with the board-side cleanup |
| Constructed / constructed-league waiting room | `pages/waiting.ts` constructedWaitingView/Html, paintWaiting | 18-draft-lobby (`.lobbypage`, `.lobbyseat`, `.seatdot`, `.lockedin`), 07-lobby, board/05 (`.sharelink`) | 254, 356 | waiting__constructed | **easy** (done) |
| Single Card Duel waiting room | `pages/waiting.ts` singleWaitingView/Html | 18-draft-lobby, 33-single-card-duel, 34-cardstats (`.scdraw` landed there in the split) | — | — (needs a room with `single` armed) | **easy** (done) |
| Draft trio lobby + trio reveal | `lobby.ts` lobbyHtml, revealHtml, handleLobbyButton | 18-draft-lobby, 07-lobby, 10-element-chips | 269 | — | **easy**: both are already pure `(args) => string` |
| Competitive match room: game 1 registration, between games, pause | `match.ts` matchWaitingHtml, handleMatchButton (via `pages/waiting.ts` paintWaiting) | 47-competitive-match | 834, 835, 836, 837, 838 | match__registration *cc*, match__between-paused *cc* | **medium**: the html is near-pure but the seat's deck choice is module state |
| Post-game (game over, rematch, Bo3 continue) | `postgame.ts` postGameHtml (pure), handlePostGameButton | 19-postgame | 521, 638, 838 | — (over a finished board) | **easy** for the html; it paints over the board, so its story needs a board stub |
| Replay viewer bar | `replaybar.ts` (9 `let`s, keys installed globally) | board/36-replaybar | 320, 321, 508 | — | **medium**: keys fire while typing (inventory bug 9) |
| Draft pick / bottom-two / pick-set dialogs, concede, judge box | `main.ts` (board half), `pickset.ts` pickSetHtml | board/* | many | — | out of scope (board) — listed so nobody looks for them here |

### Account, decks, cards

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| Sign-in / register | `account.ts` renderScreen (the auth branch) | 17-accounts | 839 | auth__sign-up, auth__log-in | **medium**: shares account.ts's 19 `let`s with the profile |
| Profile (Stats · Achievements · Ladder · Friends · Decks · History) | `account.ts` renderScreen + the per-tab builders; `barHtml` (home slot) | 17-accounts, 28-metagame (`.acctpage` overrides) | 610, 634, 732 | profile__stats, profile__achievements, profile__ladder, profile__friends, profile__decks, profile__history | **hard**: 1,255 lines, 19 module `let`s, 5 fetches, the ladder fetch error shows as "nobody has played" (inventory bug 5) |
| My decks (list, hero, Cards · Curve & affinity · Maybeboard · Games tabs) | `decks.ts` renderScreen | 23-decks, 26-deckstrip-curve-affinity, 27-cards (add drawer) | 830, 832, 833 (open it from home) | decks__first, decks__public-deck, decks__curve, decks__games, decks__maybeboard, decks__card-focus, decks__group-cost, decks__add-drawer | **hard**: 2,075 lines, 30 module `let`s |
| Deck modals (settings, describe, export, import) | `decks.ts` | 35-deck-modals | 830 | decks__settings, decks__describe, decks__export, decks__import | **hard** (with the page) |
| Sideboard tab + swap presets (Competitive) | `decks.ts` (tab `side`, `deck-swap-*`, `deck-try-*`) | 23-decks, 47-competitive-match | 830, 832, 833 | decks__cc-sideboard *cc*, decks__cc-swap-new *cc* | **hard** (with the page) |
| Tabletop deck builder (+ binder layer) | `tabletop.ts` pageHtml/renderScreen; `binder.ts` | 24-tabletop, 25-binder, 26-deckstrip-curve-affinity, shared/38-drag | 535, 537, 540, 541, 542, 831 | tabletop__deck, challenge__builder, tabletop__cc-sideboard *cc* | **hard**: registers its drag handler on import; its z-index sits above every dialog |
| Card browser (`?cards`) | `cards.ts` renderScreen (13 `let`s, 2 fetches) | 27-cards, 28-metagame | — | cards__browse, cards__search, cards__syntax, cards__list-view, cards__text-view, cards__pinned, cards__deckbuilding | **medium**: one module, but the query state and the pinned panel interleave |
| Metagame: published decks, shared deck `?deck=`, card duel ladder | `meta.ts` renderScreen (17 `let`s, 4 fetches) | 28-metagame | — | meta__decks, meta__shared-deck, meta__card-ladder | **medium** |
| Card stats (`?cardstats`) | `cardstats.ts` pageHtml (exported) / renderScreen | 34-cardstats, 28-metagame | — | cardstats__cards, cardstats__elements, cardstats__highlights, cardstats__game, cardstats__card | **medium**: a `pageHtml` exists but reads 16 module `let`s and localStorage |

### League, challenge, admin, learning, rules

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| League (season, entry, availability, matches, standings, organizer) | `league.ts` renderScreen, navButtonHtml, homeBannerHtml; `leaguenotes.ts` | 44-league | 610 | league__announced, league__signup, league__running, league__final, league__finished, league__signed-out, league__organizer, league__suggest-time | **hard**: 1,384 lines, 21 `let`s, the home banner and nav button fetch while drawing |
| Weekly challenge (page, boards, past weeks, builder, run meter, end dialogs, watch) | `challenge.ts` renderScreen, homeCardHtml, navButtonHtml; `challengebuild.ts` builderHtml (pure); `challengerun.ts` meterHtml/scoreHtml | 46-challenge, 44-league (`.chmeter`) | 505, 508, 540, 592, 598, 612, 648 | challenge__page, challenge__signed-out, challenge__board-leanest, challenge__board-purest, challenge__board-overall, challenge__past-week, challenge__builder | **medium**: the builder is pure; the page has 18 `let`s and fetches its card on the home screen |
| Admin (Reports · Accounts · Games · Live rooms · Challenges) | `admin.ts` renderScreen | 31-admin | — | admin__refused, admin__reports, admin__accounts, admin__games, admin__rooms, admin__challenges | **easy**: the inventory's "cheapest page to convert"; treats a 500 as "not an admin" (bug 5) |
| How to play (Rules · Rulebook · Comprehensive rules · Interface), off-board help layer | `rules.ts` rulesBoxHtml/helpBoxHtml (pure); `helplayer.ts` | board/11-hotfixes-help-judge-overlays | — (299 is DOM-free) | rules__rules, rules__search, rules__rulebook, rules__cr, rules__interface | **easy**: the renderers are pure; its CSS lives in a board piece |
| Learn to Play menu | `learnmenu.ts` menuHtml (pure) | 32-learn | — | learn__menu, learn__lessons | **easy** |
| Lesson window | `lessonlayer.ts` windowHtml/pageHtml (exported) | 32-learn, board/43-toolbar | — | — (it is a game) | **medium**: 9 `let`s; drawn over a board |
| Rules review (`?crreview`) | `crreview.ts` renderScreen (37 `let`s, polling) | 45-crreview | — | crreview__doc, crreview__annexD, crreview__disc, crreview__oq, crreview__comments | **hard**: ~30 module globals plus polling; owns every `cr-` button |
| Public CR sheet / link previews | `crlayer.ts` | 45-crreview (`.crscrim`) | — | — | **medium** |
| Question board (`?question=`) | `questions.ts` + the replay route in `main.ts` | board/* | 528 | — | out of scope (a replayed board) |
| Scenario tester, test mode | `scenario.ts` panelHtml; `sandbox.ts` (injects its own CSS) | board/22-scenario-strip; injected | 713; 275 | — | out of scope (in-game panels) |

### On every page

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| Legal footer + About / AI / Privacy / Terms | `legal.ts` footHtml (pure), installLegal | **injected** by `legal.ts` (a `<style>` it writes; not in `styles/` yet) | — | legal__about, legal__ai, legal__privacy, legal__terms | **medium**: the CSS has to move into `styles/` first |
| Report pill + dialog (+ dispute) | `report.ts` (15 `let`s) | board/13-playtest-round4-clocks-report (`.reportbox`) | 287, 521, 592 | report__dialog, report__bug | **medium** |
| Bell, notification list, invite popups, room friends | `inbox.ts` (18 `let`s, 3 fetches); roomFriendsHtml (waiting-room slot) | board/13-playtest-round4-clocks-report (`.inboxlist`, `.invitecard`) | 839 | home__bell-open | **medium** |
| Toasts, tab-title alert, info tip | `toast.ts`, `tabalert.ts`, `infotip.ts`, `main.ts` | board/29-cost-toasts, board/42-zoom-ressum-infotip | many (board) | — | out of scope (board primitives) |

## The ui-shots *cc* states

The shared fixture (`var/ds-shots/fixture`) predates Competitive Constructed. `node client/server/e2e/ui-fixture.ts
--out <dir> --cc` builds one that also has a deck with a sideboard and two swap presets ("Ember Rush (Competitive)")
and a Best of three paused between games 1 and 2. The six *cc* states above are added only when `fixture.json` has a
`cc` block, after every other state, so the shared fixture's runs are unchanged.
