# Algomancy client: UI inventory, categorised

Taken 2026-11-02 at master `ba32fcf4`, by reading the code only (nothing was run or changed).

> **A SNAPSHOT, NOT A LIVE DOCUMENT.** Every file:line here is as of `ba32fcf4` and will drift; re-check
> before acting on one. It is the raw material for the design-system plan, [`../23-design-system.md`](../23-design-system.md).
> Part 4's bugs were read off the code; Phase 0 of the plan confirmed or refuted each in a browser — see that file.

This file is the map. The seven detail files beside it have the element-by-element tables,
which give the visible copy, every state, the CSS classes and file:line for each element.

| file | covers | size |
|---|---|---|
| `01-home-and-chrome.md` | the home page, plus everything that sits on every page: footer, legal pages, report pill, help, bell/inbox, toasts, tab alert, info tip, connecting notices, `index.html` | 551 lines |
| `02-account-league-challenge-admin.md` | sign-in, the profile and its 6 tabs, the league page (10 cards + organizer), the weekly challenge, admin (5 tabs) | 830 |
| `03-decks-cards-meta.md` | My decks (4 tabs, 3 modals), the tabletop builder + binder, the card browser, Metagame, shared deck, duel ladder, Card stats | 1139 |
| `04-learn-rules-cr.md` | How to play (4 tabs), Learn to Play menu, lesson window, judge box, Rules review page, public CR page, question board, scenario tester, test mode | 567 |
| `05-lobbies-and-postgame.md` | connecting/kicked, matchmaking queue, the 3 waiting rooms, trio reveal, draft pick / bottom-two / pick-set dialogs, share/presence, concede, post-game, replay viewer | 728 |
| `06-game-board.md` | the board as it is since board round 8 (rail, top bar and turn strip gone; 50px icon toolbar): layout, every element type and state, shared primitives, existing isolated-render rigs (`?demo` FakeSocket, the 91 review-board scenarios, ui-driver) | 1008 |
| `07-design-foundations.md` | the CSS as a system: tokens, colour/type/spacing/radius/shadow/z/motion censuses, the de-facto components, how style.css is structured, icons, and a proposed token set | 527 |

---

## Part 1. Foundations (what a design system is built from)

Everything here is in `07-design-foundations.md` §1–7 and §11.

| foundation | today | proposed (07 §11) |
|---|---|---|
| **Colour tokens** | 40 on `:root`, split over 3 separate `:root` blocks. The CR review page has a **second palette** (its `--accent` is blue). 352 distinct literal colours, 249 used once; ~70 greys standing in for ~10 roles; 13 golds blur brand, selected, warning and targeting together | ~30 role tokens: 10 neutrals, accent/link, status ok/warn/bad/info (fg+bg), game colours namespaced `--game-*`, two scrims |
| **Status colours** | 5 parallel vocabularies; `--warn`, `--bad` and `--fg` are used outside the one place they are defined, so only their fallbacks apply | one success/warning/danger/info set |
| **Typography** | 45 distinct font sizes, no type scale, no rem; no global h1–h4 (about 55 per-page heading rules); the small uppercase label written 17+ times; 4 invalid `font: … inherit` declarations that the browser drops; UI text is system-ui, card titles are EB Garamond | 7 sizes (11/12/13/15/17/22/28), 2 weights, 3 line-heights, one eyebrow style, global headings. EB Garamond is a candidate display face |
| **Spacing** | 175 distinct padding values, every integer 1–16px in use, 8 page widths | 2px-based scale; one page container width, one page padding |
| **Radii** | 16 values (panels alone: 6/7/8/9/10/14) | 4: sm / md / lg / pill |
| **Elevation** | 93 distinct box-shadows | 3 shadows + a focus ring |
| **Z-index** | 39 values, no scale; the tabletop's 400–500 sits above every dialog | 8 named layers |
| **Motion** | 13 reduced-motion blocks; 6 infinite pulses not covered | 3 durations, 2 easings, one global reduced-motion rule |
| **Breakpoints** | 15 size conditions, 8 of them between 620 and 1000px; touch is a JS `html.touch` class (deliberate, keep) | 3: 700 / 900 / 1100 |
| **Theme** | dark only; no `color-scheme` declared, so native controls (scrollbars, selects, date pickers) are drawn light | declare `color-scheme: dark` |
| **Icons** | 83 emoji/glyphs used 384 times as icons; the only real SVG UI icon is the CR copy-link | one SVG icon set for ~20 UI actions; keep emoji only where they are content (trophies) |
| **Focus** | `outline: none` 8×, 2 `:focus-visible` rules in the whole sheet | a global focus ring |

## Part 2. Components (the de-facto ones, with every variant that exists today)

Census in `07` §8; per-page usage in 01–05 under "shared building blocks". "Copies" means
separate hand-written implementations of one idea.

| component | copies today | the problem in one line |
|---|---|---|
| **Button** | 1 base + ~60 context overrides, ~15 sizes | "primary" means a **green fill** globally and a **gold outline** on home/deck/challenge/legal. On `cta primary` buttons both apply at once, so you get green under a gold border. `.cta` has no base rule; there is no `.danger` rule although the TS emits one; there is a third button system in sandbox.ts |
| **Toggle / segmented / "on"** | the identical `.on` rule 28×, 5 different "selected" looks | sort and filter toggles on Metagame and Card stats have **no visible on state** at all |
| **Text input / select / textarea** | ~15 copies, no base rule | radius 4/5/7, three backgrounds; search fields are a 4th, darker variant |
| **Checkbox** | native ×3 plus fake ☑/☐ glyphs | unstyled, not accessible |
| **Panel / card** | ~95 hand-rolled; `.panel` does not exist | radii 2–20, about 30 paddings, 3 "emphasis" border colours |
| **Page header** | 8 near-identical flex rows | `.accthead` became the de-facto one for 9 pages; home, lobby, queue, admin and CR each have their own |
| **Back / exit control** | 7 wordings on non-game pages + 12 across the play flow | "← home", "Leave", "Return to Lobby" (where there is no lobby), "Return to home", "×", … |
| **Tabs** | 8 implementations, 2 active styles | one has real tab semantics (challenge leaderboard); admin's are filled, profile's uppercase, Metagame's sentence case |
| **Table** | 8 implementations | 4 header treatments, 6 cell paddings; the 8-column history table overflows on a phone |
| **Chip / badge / pill / tag** | ~20 implementations | `.crchip` name collision (live bug, below); 3 element-chip looks inside one game's lifecycle |
| **Dialog + scrim** | ~10 boxes, 12 scrims, 30 `✕` buttons | no `<dialog>`, no `role="dialog"`, no focus trap or Escape on most; scrim alphas .45–.78 |
| **Toast** | 4 systems | the main one only paints on the board, so a toast raised off the board waits until the next game render |
| **Tooltip / popover / menu** | `.menu` defined 3× (z 50→70→95), `#infotip` and `#ressum` share an identical shell written twice | heavy reliance on native `title=` for meaning |
| **Helper text** (`.hint`, `.dim`, `.cardsub`) | `.hint` 160 uses, `.dim` 115, **no global rule for either** | most hints, empty states and loading lines print at full text colour and read as content |
| **Status / error message** | `.deckmsg` (gold), `.joinerr`, `.qerr`, `.psnote`, `.acctmsg` (no rule at all), inline styles | errors and successes look the same (both gold) in most places; some errors are never shown |
| **Card thumbnail / tile** | 4 tile implementations, 5 name→art-URL helpers | hover-to-read is broken on all non-board pages since board round 8 |
| **Card search UI** | 3 (deck drawer, binder, card browser) | different add limits, labels, page sizes (60/120/120) |
| **Element / affinity chip** | `.elchip`, `.acctel`, `.triobanner .elchip`, `.reschip`, Card stats' `.el-*` | `.el-*` from Card stats also paints the Learn menu's element buttons (probable accident) |

## Part 3. Pages (the tree)

The section numbers point into the detail files.

- **Every page**
  - `index.html` shell: fonts, meta, OG, icons; no web manifest (01 §1)
  - Legal footer + 4 legal pages; its CSS is injected from legal.ts (01 §3.1–3.2)
  - Report pill + report dialog + dispute variant (01 §3.3)
  - Help layer → the How-to-play box (01 §3.4, 04 §A)
  - Bell, notification list, invite popups (01 §3.5)
  - Toasts ×4 (01 §3.6) · tab-title alert · info tip (01 §3.8–3.9)
  - Connecting / error / kicked / reconnect notices (01 §3.10, 05 §1–2)
- **Home** (01 §2, 02 §1)
  - Header: wordmark, name field (signed out), identity bar (signed in/out/loading), nav buttons: My decks · How to play · Cards · Metagame · League · Challenge
  - League banner (the "pinned area"): 4+ states by season phase
  - Matchmaking strip + open-games list
  - Live draft card: fixed-trio fold with element chips + 🎲, Custom rules panel, clock picker, CTA
  - Constructed card: deck picker (2 variants + loading), import, Options fold, CTA, Single Card Duel fold
  - Join a game: room code, Learn to play
  - This week's challenge card
  - Foot line · Recent updates (with "new since your last visit")
- **Sign-in / register** (02 §2)
- **Profile** (02 §3): header buttons (League, Challenge, Admin, Rules review, Reload, Log out, Return to Lobby); tabs Stats · Achievements · Ladder · Friends · Decks · History; post-game account forms
- **My decks** (03 §1): signed-out, deck list rail, import box, deck hero, tabs Cards · Curve & affinity · Maybeboard · Games; settings / description / export modals
  - **Tabletop builder** (03 §2): top bar, touch selection bar, piles, binder, challenge deck strip, drag model
- **Cards** browser (03 §3): query bar, syntax sheet, 10-section facet rail, grid/list/text results, pinned card panel, deckbuilding mode, keyboard
- **Metagame** (03 §5–6): published decks, shared deck `?deck=`, card duel ladder, Card stats (Cards table with 18 columns · Elements · Highlights · Games)
- **League** (02 §4): season, entry, availability grid, your matches + time picker, free-when-you-are, standings, matches, Discord time code, organizer tools, bell notes
- **Weekly challenge** (02 §5): finished runs, builder, this week, leaderboards (Fastest/Leanest/Purest/Overall), past weeks, tabletop host, run meter + end dialogs, watch a run
- **Admin** (02 §6): refused state; Reports · Accounts · Games · Live rooms · Challenges
- **How to play** (04 §A): Rules · Rulebook · Comprehensive rules · Interface tabs, in two shells (off-board help layer and on-board overlay)
- **Learn to Play** (04 §B–C): menu, lesson window (7 figure kinds, 9 UI states)
- **Rules review** `/?crreview=1` and public CR (04 §E–F); question board `?question=` (04 §G)
- **Testers** (04 §H–I): scenario tester, test mode (sandbox, with its own injected palette)
- **Play flow** (05): queue page (picker / searching / match found) → waiting rooms (constructed, league, single-card, draft trio) → trio reveal → draft pick / bottom-two / pick-set dialogs → board → concede → game over + post-game → watch again / replay viewer
- **Game board** (06), not being redesigned now, but it shares the primitives above

## Part 4. Bugs found along the way (not design opinions)

I checked the first two against the code myself. The rest come from the readers, read off
the code; they should be confirmed in a browser before anyone fixes them.

1. **`.crchip` defined twice** (style.css:2011 for the Custom rules ban chip, :5248 for the rules-review comment chip, which is `position: fixed; z-index: 75`). The second applies to both, so the banned-card chips in the home page's Custom rules panel should come out stacked in one fixed spot. Confirmed in code.
2. **Queue page box inside a box:** a 520px `.queuepanel` with its own border sits inside the 420px-max `.joinscreen` card (queue.ts:458, style.css:348/3410). It also repaints the whole page every second while searching, so Accept is rebuilt under the pointer. Confirmed in code.
3. Invalid `font: 14px/1.4 inherit` (style.css:1025, 2613, 3136, 3577): the whole declaration is dropped, so `.rulesq` and the judge input get no font, background or colour from that line.
4. A Discord-link error is written to `authMsg`, which only the sign-in screen shows, so on the profile it is never seen (account.ts:1130).
5. A ladder fetch error shows "nobody has played 5 rated games yet" (account.ts:1004); admin treats a 500 as "not an admin" (admin.ts:133).
6. The scenario panel's "NOT recorded" error shows in success green (scenario.ts:211).
7. Hover-to-read a card does nothing on the deck page, browser, metagame or stats since board round 8 (`main.ts:10046` only fires for `[data-prevart]`); comments still say it works.
8. "My decks →" from a waiting room opens a deck page whose Close does nothing (main.ts:12383 `inGame` guard).
9. The replay viewer's keys (Space, arrows, Escape) fire while typing in the judge or report box; Escape quits the replay from inside a dialog (replaybar.ts:344–350). Its "tinted past this point" style targets `#app .table`, which no longer exists.
10. Signed-in users see "Playing signed out — Log in / Sign up" briefly on every load (no loading state). Background polls repaint the whole home page and wipe typed text in the name, room-code and paste boxes.
11. Destructive actions are inconsistently confirmed: log out, remove friend, make/revoke admin, result override and Give up on a run all act on one click; the league asks twice.
12. The league availability grid can only be painted with a pointer, and `touch-action: none` stops a finger on it from scrolling the page.

## Part 5. Storybook readiness

Per-renderer tables are in each file's Storybook section (01 §5, 02 §9, 03 §10, 04 §M, 05 §19, 06).

- **Story-ready now** (exported, pure `(args) => string`): `updatesHtml`, `footHtml`, `rulesBoxHtml`, Learn `menuHtml`, `costToastHtml`, `lob.lobbyHtml`, `lob.revealHtml`, `pg.postGameHtml`, `shareBar`, `pickSetHtml`, `cardPanelHtml`, `deckStripHtml`, `piletable`, `challengeStripHtml`, `builderHtml`, `noteLine`, `scoreHtml`, the lesson window and scenario panel, `markdown.ts`.
- **Needs an args signature**: `acct.barHtml`, `mm.stripHtml`, `crp.panelHtml`, `sc.pickerHtml`, the report and inbox builders; `decks.ts`, `cards.ts`, `meta.ts` and `cardstats.ts` (they read module state or localStorage); admin is the cheapest page to convert.
- **Must move out of main.ts first**: anything defined in main.ts (`renderHome`, `deckPickerHtml`, `clockPickHtml`, the waiting rooms, draft dialogs, concede, judge box), because **importing main.ts boots the whole app**.
- **Fetch during render**: the league banner and nav button, the challenge card. The fetch has to be split from the paint.
- **Hard**: the tabletop (registers its drag handler on import), the CR review page (~30 module globals plus polling).
- **Invisible to Storybook unless moved into the stylesheet**: the CSS injected by `legal.ts` and `sandbox.ts`.
- Clicks are delegated on `data-*` attributes (`data-btn`, `data-help`, `data-learn`, `data-report`, …; 13 namespaces), so one action-logger decorator covers every story.
