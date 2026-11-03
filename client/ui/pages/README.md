# `client/ui/pages/` — the non-game pages

Where the client's pages live under the page contract (`client/docs/23-design-system.md` § Target structure,
Phase 4). Started 2026-11-03 by moving the home screen, the waiting rooms, the deck picker and the connecting screen
out of `main.ts`; the same day's wave 2 brought the front door, the account pages, the card pages, the league, the
weekly challenge and Learn to Play here. **Still outside:** My decks (+ its modals and the tabletop builder and
binder), the rules review, How to play / the help layer, the lesson window, the public CR sheet, and the replay bar —
the table below says where each one is and how hard it is.

**The usual shape.** A page's old module (`client/ui/<name>.ts`) keeps its STATE, its fetches, its clicks and any
in-place patches, and gains one snapshot export (`queueSnapshot()`, `panelSnapshot()`, `state()` …) the page's view
reads. The drawing lives here. Other modules import the old module, not the page, so nothing outside had to change.
A page module imports from its controller with `import type` only, so the runtime graph stays controller → page.

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
  slots, and the `data-btn` names asserted) and a Storybook story (`client/storybook/stories/pages/<page>.stories.ts`,
  `_page.ts` holds the frame and stand-in slots). Test 992 fails on a `pages/*.ts` that exports an `…Html` and has
  neither.
- **Draw with the components** (`../components/README.md`): a page never writes a `ui-` class by hand (test 995), and
  never a colour literal (test 993) — a colour is a token in `styles/tokens.css`, read through `var(--…)`. A page that
  needs something a component cannot do yet asks for a variant (add it there, with a story and a test) rather than
  copying the component's markup.

## What is here now

| file | exports | what (and the module that keeps the state) |
|---|---|---|
| `home.ts` | `homeView`, `homeHtml`, `paintHome`, `saveHomeName`; the home's own state `homeMode`/`setHomeMode`, `homeFormat`/`setHomeFormat`, `openSheet`/`openHomeSheet`/`closeHomeSheet` | the home screen (client/docs/24-redesign/, 2026-11-03): the app shell, a toolbar, the Play card (Draft \| Constructed), League · Challenge · Matchmaking beside it, a bottom bar, and the sheets (Join a room, Custom rules, Import, Single Card Duel, the client info, Updates). `main.ts renderHome()` is still the **router** (which page owns `#app`) and calls `paintHome` when none does |
| `waiting.ts` | `constructedWaitingView/Html`, `singleWaitingView/Html`, `paintWaiting` | the waiting rooms: constructed + constructed league, Single Card Duel; dispatches the draft trio lobby and the Competitive match room |
| `deckpicker.ts` | `deckPickerView`, `deckPickerHtml`, `deckPicker`, `wireDeckPicker`, `importDeck` | the constructed deck picker (home, waiting room, queue) with its state |
| `clockpick.ts` | `clockPickView`, `clockPickHtml`, `chosenClockMs`, `CLOCK_*` | BL-26's clock banks and picker. Engine test 279 locks `CLOCK_DEFAULT_BY_MODE` to the server's copy by reading this file |
| `connecting.ts` | `connectingHtml` | "Connecting to the server…" and a refused join |
| `caret.ts` | `caretIn`, `restoreCaret` | the caret carry, shared with the board's `snapshotViewport` (not a page; no `…Html`) |
| `queue.ts` | `queueView`, `queueHtml`, `paintQueue`, `queueStripView`, `queueStripHtml` | the matchmaking queue and its home strip. `ui/queue.ts`: socket, counts poll, the 1s tick (`tickInPlace`), `queue-` clicks; snapshot `queueSnapshot()` |
| `lobby.ts` | `lobbyView`, `lobbyHtml`, `revealHtml` | the draft trio lobby and the trio reveal. `ui/lobby.ts`: the un-submitted pick/ranking, `lobby-` clicks; snapshot `lobbyLocals()` |
| `customrules.ts` | `customRulesView`, `customRulesHtml` | the Custom rules panel (Live draft card). `ui/customrulespanel.ts`: rules + storage, verdict, `cr-` clicks, `wirePanel` (in-place typing patches); snapshot `panelSnapshot()` |
| `singlecard.ts` | `singleCardPickerView`, `singleCardPickerHtml` | the Single Card Duel card picker. `ui/singlecard.ts`: the pick, `sc-` clicks, `wire`; snapshot `pickerSnapshot()` |
| `postgame.ts` | `postGameView`, `postGameHtml` | the post-game screen (drawn over the board by main.ts). `ui/postgame.ts`: wire types, `pg-` clicks, the helpers server test 363 imports |
| `match.ts` | `competitiveCardView/Html`, `yourMatchesView/Html`, `matchRoomView`, `matchRoomHtml`, `paintMatchRoom`, `matchResultHtml` | Competitive Constructed: the home card, "Your matches", the match room. `ui/match.ts`: the draft, best-of, the Your-matches fetch, `cc-` clicks, the countdown; snapshot `matchState()` |
| `signin.ts` | `signinView`, `signinHtml`, `paintSignin`, `identityBarView`, `identityBarHtml` | sign-in / register and the identity bar (a home slot). State in `ui/account.ts` |
| `profile.ts` | `profileView`, `profileHtml`, `paintProfile`; the shared pieces `badgeChipsHtml`, `trophyChip(s)Html`, `historyRowsHtml`, `gameElementsHtml`, `modeName` … | the profile (Stats · Achievements · Ladder · Friends · Decks · History). State, fetches and clicks in `ui/account.ts`, which re-exports the shared pieces |
| `admin.ts` | `adminView`, `adminHtml`, `paintAdmin` (+ state and clicks, the whole module) | Admin (Reports · Accounts · Games · Live rooms · Challenges) |
| `report.ts` | `reportLayerHtml`, `reportDialogHtml`, `reportPillHtml`, the label tables | the report pill and dialog (+ dispute). State, sending and keys in `ui/report.ts` |
| `inbox.ts` | `inboxLayerHtml`, `inboxListHtml`, `roomFriendsHtml`, `roomFriendsBodyHtml` | the bell, its list, the invite popups, the waiting room's friends panel. State, poll and clicks in `ui/inbox.ts` |
| `cards.ts` | `cardsView`, `cardsHtml`, `paintCards`, `facets`, `CHUNK` | the card browser (`?cards`, `?card=`). State, fetches, URL, clicks and keys in `ui/cards.ts` |
| `meta.ts` | `metaView`, `metaHtml`, `paintMeta`, `metaTabsHtml`, `metaRowHtml`, `artFor` | metagame list, shared deck, card duel ladder; hosts card stats. State in `ui/meta.ts` |
| `cardstats.ts` | `cardStatsView`, `cardStatsHtml`, `paintCardStats`, `COLS`, `colsFor` | the card stats tab. State in `ui/cardstats.ts` |
| `league.ts` | `leagueView`, `leagueHtml`, `leagueBannerHtml`, `leagueNavHtml`, the season types and formatting | the league page, its home banner and header button. State, fetches, `handleButton`, the grid and time-code wiring and `paint()` in `ui/league.ts` (`TODO(ds)`: paint stays with the wiring) |
| `challenge.ts` | `challengePageView`, `challengePageHtml`, `challengeHomeView`, `challengeHomeCardHtml`, `challengeNavHtml` | the weekly challenge page, its home card and header button. State, fetches, clicks, the tabletop host and `paint()` in `ui/challenge.ts` (`TODO(ds)`); the builder is `ui/challengebuild.ts` `builderHtml` (already pure) |
| `challengerun.ts` | `runMeterHtml`, `runEndHtml`, `scoreHtml`, `statCell` | a challenge run's meter and end panels. `ui/challengerun.ts` gathers (`runMeterView`, `runEndView`) |
| `learn.ts` | `learnMenuView`, `learnMenuHtml` | the Learn to Play menu. The layer, clicks and keys in `ui/learnmenu.ts` |

**Still in `main.ts`, on purpose:** `handlePregameButton` — the home and waiting-room buttons (`eltoggle`, `elrandom`,
`clockpick`, `newgame`, `joincode`, `deckimporturl/text`, `deckjoin`, `singlejoin`, `gohome`, `copylink`). They write
main.ts state (`ui.homeEls`, `ui.homeFixedTrio`, `uiError`, `NET`) and open the room. `TODO(ds): view/html split:` move
them here once `uiError` and the element pick have a home outside main.ts's `UiState`. Also the **kicked** notice,
written inline in `NetBackend`'s message handler.

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
| **Home** | `pages/home.ts` homeView/homeHtml/paintHome; router `main.ts` renderHome; buttons `main.ts` handlePregameButton (incl. `home-mode`, `home-format`, `home-els`, `home-sheet`, `home-sheet-close`) | 06-home, the components (app shell, icon button, segmented, sheet), 18-draft-lobby (Custom rules), 33-single-card-duel, 07-lobby (picker), 47-competitive-match, board/13 (`.clockpick`), shared/10-element-chips | 366, 839, 1011 (and 610/634/732 start here); 960 and 1010 are DOM-free | home__signed-out, home__signed-in, home__constructed, home__competitive, home__pick-now, home__join-open, home__info-open, home__updates-open, home__customrules-open, home__bell-open, home__cc-your-matches *cc* — all `noScroll` (1012) | **easy** now (split done); the buttons are medium — they write `ui.homeEls`/`uiError` |
| Deck picker (home, waiting room, queue) | `pages/deckpicker.ts` | 07-lobby (`.deckselect`, `.deckinfo`, `.deckimport`, `.deckpaste`, `.deckmsg`) | 366 (on home), 254 (waiting room) | home__*, waiting__constructed, queue__constructed | **easy** (split done) |
| Clock picker | `pages/clockpick.ts` (`look: 'segmented'` is the home's Clock row) | board/13-playtest-round4-clocks-report (`.clockpick`) | 366 | home__signed-in, home__constructed | **easy** (split done) |
| Custom rules panel (the home's Custom rules sheet) | `pages/customrules.ts` customRulesView/Html (`bare`: no fold, for the sheet); state + clicks + `wirePanel` in `customrulespanel.ts` | 18-draft-lobby (`.customrules`), 10-element-chips | 366, 298 | home__customrules-open | **easy (done)** |
| Single Card Duel sheet + card picker | `pages/home.ts` (the sheet); `pages/singlecard.ts` singleCardPickerView/Html; the pick + clicks in `singlecard.ts` | 33-single-card-duel, 34-cardstats (`.scwarn`) | 1011 | — | **easy (done)** |
| Competitive (the Play card's format) + "Your matches" (the Join sheet) | `pages/match.ts` competitiveCardView, ccDeckSelectHtml, yourMatchesView/Html (competitiveCardHtml, the old card, is kept for its story); `match.ts` keeps `bestOf`/`pickId`/`mine` and the fetch (`loadMyMatches`) | 47-competitive-match | 839 | home__competitive, home__cc-your-matches *cc* | **easy (done)** |
| Recent updates (the home's Updates sheet) | `updates.ts` updatesHtml/wireUpdates (`UPDATES` is the deploy list, edited every round; drawn by `pages/home.ts` in its Updates sheet) | 06-home (`.upd*`) | — (323 is DOM-free) | home__updates-open | **easy**: already `(list, seen) => string`, with a story (`stories/pages/updates.stories.ts`) |
| Matchmaking queue page + home strip | `pages/queue.ts` queueView/Html, paintQueue, queueStripView/Html; socket, counts poll, the 1s in-place tick and clicks in `queue.ts` | 30-queue, 04-joinscreen | — | queue__picker, queue__constructed, queue__signed-out | **easy (done)** |
| Connecting / refused join | `pages/connecting.ts` connectingHtml; `main.ts` renderConnecting | 04-joinscreen (`.joinscreen`, `.joinerr`) | 254 | — (a socket screen) | **easy** (done) |
| Kicked ("another connection took over") | `main.ts` NetBackend message handler, `m.t === 'kicked'` | 04-joinscreen | 70, 355 | — | **easy** markup, but it sits inside the socket class; move with the board-side cleanup |
| Constructed / constructed-league waiting room | `pages/waiting.ts` constructedWaitingView/Html, paintWaiting | 18-draft-lobby (`.lobbypage`, `.lobbyseat`, `.seatdot`, `.lockedin`), 07-lobby, board/05 (`.sharelink`) | 254, 356 | waiting__constructed | **easy** (done) |
| Single Card Duel waiting room | `pages/waiting.ts` singleWaitingView/Html | 18-draft-lobby, 33-single-card-duel (`.scdraw`) | — | — (needs a room with `single` armed) | **easy** (done) |
| Draft trio lobby + trio reveal | `pages/lobby.ts` lobbyView/Html, revealHtml; `lobby.ts` lobbyLocals, handleLobbyButton | 18-draft-lobby, 07-lobby, 10-element-chips | 269 | — | **easy (done)** |
| Competitive match room: game 1 registration, between games, pause | `pages/match.ts` matchRoomView/Html, paintMatchRoom, matchResultHtml (via `pages/waiting.ts` paintWaiting); `match.ts` handleMatchButton | 47-competitive-match | 834, 835, 836, 837, 838 | match__registration *cc*, match__between-paused *cc* | **easy (done)**; its buttons are still hand-written (834–839 pin their markup) |
| Post-game (game over, rematch, Bo3 continue) | `pages/postgame.ts` postGameView/Html; `postgame.ts` handlePostGameButton | 19-postgame | 521, 638, 838 | — (over a finished board) | **easy (done)** |
| Replay viewer bar | `replaybar.ts` (9 `let`s, keys installed globally) | board/36-replaybar | 320, 321, 508 | — | **medium**: keys fire while typing (inventory bug 9) |
| Draft pick / bottom-two / pick-set dialogs, concede, judge box | `main.ts` (board half), `pickset.ts` pickSetHtml | board/* | many | — | out of scope (board) — listed so nobody looks for them here |

### Account, decks, cards

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| Sign-in / register | `pages/signin.ts` signinView/Html, paintSignin (state in `account.ts`) | 17-accounts | 839 | auth__sign-up, auth__log-in | **easy (done)** |
| Profile (Stats · Achievements · Ladder · Friends · Decks · History) | `pages/profile.ts` profileView/Html, paintProfile; the identity bar is `pages/signin.ts` identityBarHtml (`account.ts` barHtml gathers the slot); state, fetches and clicks in `account.ts` | 17-accounts, 28-metagame (`.acctpage` overrides) | 610, 634, 732 | profile__stats, profile__achievements, profile__ladder, profile__friends, profile__decks, profile__history | **done** (view/html split). The cards are still `<section class="acctcard">`, not `panel()` |
| My decks (list, hero, Cards · Curve & affinity · Maybeboard · Games tabs) | `decks.ts` renderScreen | 23-decks, 26-deckstrip-curve-affinity, 27-cards (add drawer) | 830, 832, 833 (open it from home) | decks__first, decks__public-deck, decks__curve, decks__games, decks__maybeboard, decks__card-focus, decks__group-cost, decks__add-drawer | **hard**: 2,075 lines, 30 module `let`s |
| Deck modals (settings, describe, export, import) | `decks.ts` | 35-deck-modals | 830 | decks__settings, decks__describe, decks__export, decks__import | **hard** (with the page) |
| Sideboard tab + swap presets (Competitive) | `decks.ts` (tab `side`, `deck-swap-*`, `deck-try-*`) | 23-decks, 47-competitive-match | 830, 832, 833 | decks__cc-sideboard *cc*, decks__cc-swap-new *cc* | **hard** (with the page) |
| Tabletop deck builder (+ binder layer) | `tabletop.ts` pageHtml/renderScreen; `binder.ts` | 24-tabletop, 25-binder, 26-deckstrip-curve-affinity, shared/38-drag | 535, 537, 540, 541, 542, 831 | tabletop__deck, challenge__builder, tabletop__cc-sideboard *cc* | **hard**: registers its drag handler on import; its z-index sits above every dialog |
| Card browser (`?cards`) | `pages/cards.ts` cardsView/Html, paintCards; state, fetches, URL, clicks and keys in `cards.ts` | 27-cards, 28-metagame | — | cards__browse, cards__search, cards__syntax, cards__list-view, cards__text-view, cards__pinned, cards__deckbuilding | **easy (done)** |
| Metagame: published decks, shared deck `?deck=`, card duel ladder | `pages/meta.ts` metaView/Html, paintMeta; state in `meta.ts` | 28-metagame | — | meta__decks, meta__shared-deck, meta__card-ladder | **easy (done)**; its headers keep their own markup (the Back button sits by the title, not at the edge — an owner call) |
| Card stats (`?cardstats`) | `pages/cardstats.ts` cardStatsView/Html, paintCardStats; state in `cardstats.ts` | 34-cardstats, 28-metagame | — | cardstats__cards, cardstats__elements, cardstats__highlights, cardstats__game, cardstats__card | **easy (done)** |

### League, challenge, admin, learning, rules

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| League (season, entry, availability, matches, standings, organizer) | `pages/league.ts` leagueView/Html, leagueBannerHtml, leagueNavHtml; state, clicks, grid + time-code wiring and `paint` in `league.ts`; `leaguenotes.ts` (the bell's) | 44-league | 610 | league__announced, league__signup, league__running, league__final, league__finished, league__signed-out, league__organizer, league__suggest-time | **done** (view/html split; paint stays with the wiring — `TODO(ds)`) |
| Weekly challenge (page, boards, past weeks, builder, run meter, end dialogs, watch) | `pages/challenge.ts` challengePageView/Html, challengeHomeView/HomeCardHtml/NavHtml; `pages/challengerun.ts` runMeterHtml/runEndHtml/scoreHtml; `challengebuild.ts` builderHtml; state + tabletop host in `challenge.ts` | 46-challenge, 44-league (`.chmeter`) | 505, 508, 540, 592, 598, 612, 648 | challenge__page, challenge__signed-out, challenge__board-leanest, challenge__board-purest, challenge__board-overall, challenge__past-week, challenge__builder | **done** (paint stays in challenge.ts — `TODO(ds)`) |
| Admin (Reports · Accounts · Games · Live rooms · Challenges) | `pages/admin.ts` adminView/Html, paintAdmin (the whole module: state and clicks too) | 31-admin | — | admin__refused, admin__reports, admin__accounts, admin__games, admin__rooms, admin__challenges | **done** |
| How to play (Rules · Rulebook · Comprehensive rules · Interface), off-board help layer | `rules.ts` rulesBoxHtml/helpBoxHtml (pure); `helplayer.ts` | board/11-hotfixes-help-judge-overlays | — (299 is DOM-free) | rules__rules, rules__search, rules__rulebook, rules__cr, rules__interface | **easy**: the renderers are pure; its CSS lives in a board piece |
| Learn to Play menu | `pages/learn.ts` learnMenuView/Html; the layer, clicks and keys in `learnmenu.ts` (`menuHtml` kept, 307 drives it) | 32-learn | — | learn__menu, learn__lessons | **done** |
| Lesson window | `lessonlayer.ts` windowHtml/pageHtml (exported) | 32-learn, board/43-toolbar | — | — (it is a game) | **medium**: 9 `let`s; drawn over a board |
| Rules review (`?crreview`) | `crreview.ts` renderScreen (37 `let`s, polling) | 45-crreview | — | crreview__doc, crreview__annexD, crreview__disc, crreview__oq, crreview__comments | **hard**: ~30 module globals plus polling; owns every `cr-` button |
| Public CR sheet / link previews | `crlayer.ts` | 45-crreview (`.crscrim`) | — | — | **medium** |
| Question board (`?question=`) | `questions.ts` + the replay route in `main.ts` | board/* | 528 | — | out of scope (a replayed board) |
| Scenario tester, test mode | `scenario.ts` panelHtml; `sandbox.ts` (injects its own CSS) | board/22-scenario-strip; injected | 713; 275 | — | out of scope (in-game panels) |

### On every page

| page / screen | code now | CSS | driver tests | ui-shots states | tangle |
|---|---|---|---|---|---|
| Legal footer + About / AI / Privacy / Terms | `legal.ts` footHtml (pure), installLegal | `pages/48-legal.css` (the last piece; no longer injected) | — | legal__about, legal__ai, legal__privacy, legal__terms | **easy**: the CSS is in `styles/`; the markup could move here as is |
| Report pill + dialog (+ dispute) | markup `pages/report.ts` reportLayerHtml/DialogHtml/PillHtml; state, sending and keys in `report.ts` | shared/13-report-and-inbox | 287, 521, 592 | report__dialog, report__bug | **done** |
| Bell, notification list, invite popups, room friends | markup `pages/inbox.ts` inboxLayerHtml/ListHtml, roomFriendsHtml/BodyHtml; state, poll and clicks in `inbox.ts` | shared/13-report-and-inbox | 839 | home__bell-open | **done** |
| Toasts, tab-title alert, info tip | `toast.ts`, `tabalert.ts`, `infotip.ts`, `main.ts` | board/29-cost-toasts, board/42-zoom-ressum-infotip | many (board) | — | out of scope (board primitives) |

## The ui-shots *cc* states

The shared fixture (`var/ds-shots/fixture`) predates Competitive Constructed. `node client/server/e2e/ui-fixture.ts
--out <dir> --cc` builds one that also has a deck with a sideboard and two swap presets ("Ember Rush (Competitive)")
and a Best of three paused between games 1 and 2. The six *cc* states above are added only when `fixture.json` has a
`cc` block, after every other state, so the shared fixture's runs are unchanged.
