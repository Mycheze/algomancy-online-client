# 05 — Lobbies, matchmaking, the pick dialogs, and after the game

Reader 5 of 7. Area: **everything between "I clicked Play" and the board, and after the game ends.**
Read-only survey of `client/ui/` at master `ba32fcf4` (2026-11-02). All line numbers are `client/ui/<file>:<line>`;
CSS lines are `style.css:<line>`. Nothing was run — every "likely" below is from reading the code and the
cascade, and is marked as such where a browser check would settle it.

**Not covered here (other readers):** the home page (incl. the queue *strip* `mm.stripHtml` and the open-games
list, the home custom-rules panel `crp.panelHtml`, `singleDuelHtml` on the home Constructed card), global chrome
(bell `inbox.ts` layer, legal footer, report pill), the board itself (regions board, toolbar, action bar
mechanics), CSS tokens as a system.
Overlap noted where it exists: `deckPickerHtml()` and `sc.pickerHtml()` appear on the home page **and** in my
waiting rooms; the custom-rules *summary* appears in my draft lobby while the custom-rules *editor* is home-only.

---

## 0. The flow, and which renderer owns each step

```
home ──"Find a game"/?queue=1──────────────► QUEUE PAGE (queue.ts renderScreen)            §3
  │                                            picker ─► searching ─► "Match found" overlay
  │                                                          │ both accept
  │                                                          ▼  location.search = ?ws=1&room=…
  ├─"New live draft"/"New constructed game"/"Join"/invite/Discord link ─► ?ws=1&room=CODE
  ▼
CONNECTING (renderConnecting, main.ts:9173)                                                  §1
  │  error / refused join / disconnect-before-join → same screen, red line + "← Back…"
  │  another tab took the seat → KICKED notice (main.ts:880)                                 §2
  ▼  NET.waiting set by the server
WAITING ROOM — one of three:
  • draft room (w.trio)    → lob.lobbyHtml  (lobby.ts:149)    "Live draft"/"Custom live draft"/"League match" §6
  • constructed (default)  → renderWaiting  (main.ts:9461)    "Constructed"/"League match"   §4
  • single card (w.single) → renderSingleWaiting (main.ts:9529) "Single Card Duel"           §5
  ▼  both locked in → the deal → the BOARD (another reader)
draft only:  TRIO REVEAL overlay (lob.revealHtml, lobby.ts:210) over the first draft step     §8
every draft turn:  DRAFT PICK dialog (pickModalHtml main.ts:7730 + draftPanelHtml 7634)       §9
constructed turn 1+: DRAW "bottom two" dialog (bottomPanelHtml main.ts:7789)                  §10
  hidden either dialog → "↑ back to …" bar (pickShowHtml main.ts:7736)
mid-game, opponent seat empty: SHARE BANNER (shareBannerHtml main.ts:7539)                    §12
mid-game: PRESENCE dot + room tip (presenceHtml 1788, toolTipHtml 7442)                       §12
mid-game: CONCEDE confirm (concedeHtml main.ts:12222)                                         §13
mid-game: "↺ watch again" (watchAgainHtml main.ts:6324)                                       §15
game over: POST-GAME overlay (pg.postGameHtml postgame.ts:293)                                §14
   └ "view the final board" → board + prompt-bar "Post-game summary" button (main.ts:6365)
   └ "Return to home" / "Join matchmaking queue" (→ ?queue=1) / rematch → new ?ws room
any time later: REPLAY VIEWER (?replay=CODE, ?question=id, ?challenge=watch) — replaybar.ts    §16
also: PICK-SET dialog (Wake the Dead / Tides of the Cosmos, pickset.ts) — an in-game modal   §11
```

Every transition between these is a **full page navigation** (`location.search = …` / `location.href = location.pathname`)
— `gohome` (main.ts:10557), `pg-home` (postgame.ts:361), `pg-queue` (postgame.ts:357), match found (queue.ts:281),
rematch (postgame.ts:373), replay close (replaybar.ts:294). Nothing animates between these screens.

---

## 1. Connecting / join error — `renderConnecting()` main.ts:9173

**Reached by:** any `?ws=1&room=CODE` URL (home "New…" buttons, Join, invite popup Join, Discord deep link,
rematch, matchmaking match). Also shown while a `?replay=`, `?question=`, `?challenge=watch` or `?learn=play`
page boots (main.ts:12557, 12570, 12586, 12642, 12704), i.e. for things that are **not** connecting to a server.
Routed from `renderNow()` main.ts:9895 while `NET && !NET.joined`.

**Layout:** a single centred card (`.joinscreen`, max 420px, 60px from the top). Title, one line, optional button.

| element | what it is/does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Card | the whole screen | — | `.joinscreen` (style.css:348: panel bg, 1px `--line` border, r10, p24, flex column gap14) | main.ts:9179 |
| Title "Algomancy" | `<h2>`, mixed case (every other page header spells `ALGOMANCY` in the letter-spaced `.homelogo`) | — | `.joinscreen h2` (350: accent, m0) | main.ts:9179 |
| Status line | `"Connecting to the server…"` | no error: plain `<p>` (default 13px text colour); **error**: same `<p>` gets `.joinerr` and shows `uiError` verbatim | `.joinerr` (1746: danger, 15px, max 42ch, lh1.5) | main.ts:9180 |
| Error copies seen here | `"disconnected from the server — reconnecting in Ns…"` (main.ts:426, set on every socket close before join), the server's refusal text (e.g. unknown room code), `"no replay for CODE — either it is not a game you played, or there is no such game"` (12650), `"this game cannot be replayed in the browser: …"` (12669), `"that run cannot be watched"` (12618), `"There is no rules question at that link. It may have been renamed or answered."` (12700) | lowercase-first for most, sentence-case for the question one | `.joinerr` | as listed |
| "← Back to the home screen" | `data-btn="gohome"` → `location.href = location.pathname` (main.ts:10557) | only when `uiError` set | `button.primary` (53: **green** `#3c5a2f` fill) + `.joinscreen button` (354: 16px, p8) | main.ts:9181 |

Missing states: no spinner/progress while connecting (contrast the queue's `.qspin`); no timeout ("still trying…");
the same "Connecting to the server…" copy shows while a replay file is being fetched or a solo lesson builds
locally, where there is no server. While *reconnecting* after a disconnect, the button "← Back to the home screen"
is offered as if the error were final, beside "reconnecting in 2s…".

---

## 2. Kicked notice — inline in `NetBackend.onMsg` main.ts:880–886

**Reached by:** opening the same seat in another tab/device (`m.t === 'kicked'`). Paints straight into `#app`,
bypassing `render()`.

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Card | same `.joinscreen` card as §1 | — | `.joinscreen` | main.ts:882 |
| "Algomancy" | `<h2>` | — | `.joinscreen h2` | main.ts:882 |
| Message | server's `m.msg`, fallback `"another connection took over this seat"` | — | none (plain `<p>`) | main.ts:883 |
| "home" | `data-btn="gohome"`, **lowercase, no arrow, not primary** — the same action as §1's "← Back to the home screen" | — | `.joinscreen button` | main.ts:884 |

---

## 3. Matchmaking queue page — `mm.renderScreen()` queue.ts:440, `screenHtml()` queue.ts:451

**Reached by:** home strip "Find a game" (`queue-open`); `?queue=1` (post-game "Join matchmaking queue",
postgame.ts:357); `?queue=draft|constructed[&vs=<id>][&ranked=0]` deep links (main.ts:12736–12742, the Discord
links); clicking an open game's "Join →" on the home strip (`queue-join-open`, queue.ts:597) lands here already
searching. Routed from `renderHome()` (main.ts:9357) — it is a "home sub-page", not a room.
Repaints the **whole of `#app` once a second** while searching or an offer is up (`ensureTick`, queue.ts:309).

**Layout (top→bottom):** outer `.joinscreen` card → inner `.queuepanel` card → header row (title left, back
right) → counts line → error line → body. Body is one of three states: **picker**, **searching**, **offer
overlay**.

### 3a. Shell (all states)

| element | what it is/does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Outer wrapper | reuses the connecting screen's card | always. Also carries a `home` class that **no CSS rule targets** | `.joinscreen.home.queuescreen` (348; `.home` none) | queue.ts:458 |
| Inner panel | a second bordered panel inside the first | — | `.queuescreen .queuepanel` (3410: panel bg, border, r10, p18/20, `width:min(94vw,520px)`, flex col gap12) | queue.ts:459 |
| ⚠ panel-in-panel | `.joinscreen` is `max-width:420px; padding:24px`, the inner panel asks for 520px → **likely overflows its own card by ~150px on desktop** and draws two nested borders. Verify in a browser. | — | 348 vs 3410 | — |
| "Find a game" | `<h2>` | — | `.queuehead h2` (3414: m0, 19px) + `.joinscreen h2` (accent) | queue.ts:461 |
| "← home" | `data-btn="queue-home"` → `closeQueue()`: leaves the queue, closes socket, repaints home (no navigation) | always shown, including mid-search (silently cancels the search) | `.qback` (3415: 12px, p4/10) | queue.ts:462 |
| Counts line | `countsSummary(counts)`: `"checking…"` (before first poll) · `"nobody waiting — be the first"` · `"3 waiting · Constructed 1 · Live draft 2"` | polled every 5 s over HTTP (queue.ts:205), pushed over the socket while searching | `.qcounts` (3416: dim, 12px) | queue.ts:464, 129 |
| Error line | `error` text: server refusal, `"lost the connection — try searching again"` (291), `"could not start a guest game"` (354), `"could not reach the server"` (361), `"that game is gone"` (597), blocker text when a link/open-game join is refused | only when `error` | `.deckmsg.qerr` (520 accent → 3417 **danger**) | queue.ts:465 |

### 3b. Picker state (`pickerHtml`, queue.ts:471)

| element | what it is/does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| "FORMAT" label | section label | — | `.zonelabel` (185: dim 11px uppercase .08em, mt8) | queue.ts:474 |
| Format toggle "Constructed" / "Live draft" | two buttons acting as a radio group; `queue-mode` saves to `localStorage.algoQueueMode` | `.on` on the chosen one. **Reuses the element-chip class**: unselected is `opacity:.55` (looks disabled), `text-transform:capitalize`, selected gets a 2px accent outline | `.elrow.qmodes` (931, 3418) + `.elchip` / `.elchip.on` (941/942) | queue.ts:475–477 |
| Format blurb | draft: `"Once matched you agree the elements in a lobby, then draft from shared packs."` · constructed: `"This deck is locked in — a matchmade game deals straight away."` | per format | `.cardsub` — **unstyled here** (only `.homecard .cardsub` 465 and `.singleduel .cardsub` 3717 exist) → default `<p>` margins, full text colour | queue.ts:478 |
| Deck picker | the home screen's `deckPickerHtml()` (see §7c), borrowed through `deps` | constructed only | `.qdeck` (3419: flex col gap8) | queue.ts:482 |
| "WHO YOU PLAY" label | | — | `.zonelabel` | queue.ts:484 |
| "Ranked" option | big two-line button: **Ranked** / `"near your rating · 1043 — the search widens the longer you wait"` (rating omitted if unknown) | `.on` if chosen; saved to `algoQueueRanked` | `.qranked` (3424), `.qopt` (3425), `.qopt.on` (3427: accent border, panel2 bg), `.qopt.on b` (3428), `.qopt .hint` (3429: 11px) | queue.ts:486–490 |
| "Whoever’s open" option | **Whoever’s open** / `"anyone at all — and it still counts towards your rating"` (curly apostrophe; elsewhere straight) | as above | as above | queue.ts:487 |
| Blocker line | `queueBlocker()`: `"constructed needs an account — you have to bring a deck"` / `"pick one of your decks first"` | constructed only, signed-out or deckless. **Gold** (`.deckmsg`), whereas the server error above is red (`.qerr`) | `.deckmsg` (520: accent, 12px) | queue.ts:494, 142 |
| Go button | `"Find a live draft game"` / `"Find a constructed game"`; when blocked: `"Find a game"` + disabled | `disabled` while a blocker applies | `.cta.primary.qgo` (`.cta` unstyled outside `.homecard`/league/challenge; `button.primary` green; `.qgo` 3420: p12/14, 15px, 700) | queue.ts:495–496 |
| Signed-out hint | `"Signed out you can still play by room code from the home screen — it just is not recorded."` | signed-out only | `.hint` → `.joinscreen .hint` (355: dim, 12px, m0) | queue.ts:497 |

### 3c. Searching state (`searchingHtml`, queue.ts:500)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Spinner | CSS ring | `aria-hidden`; reduced-motion → 3 s per turn | `.qspin` (3433, keyframes 3436, 3437) | queue.ts:510, 521 |
| Headline | `"Searching for a live draft game…"` / `"Searching for a constructed game…"`; direct challenge: `"Joining Rashi game…"` (sic — `vsName` with no possessive; fallback `"Joining their game…"`) | `s.vs` picks the variant | `<b>` in `.qsearchtext` (3432) | queue.ts:512, 523 |
| Band · wait | ranked: `"±150 · 0:42"` / `"anyone · 2:10"`; open: `"anyone · 0:42"`; challenge: `"live draft · 0:42"` | updates every second (full repaint) | `.hint` | queue.ts:513, 524–526 |
| Sub-hint | `"the search widens the longer you wait"` / `"wide open now"` / challenge: `"waiting for them to accept"` | ranked-with-band / ranked-unbounded / challenge | `.hint` | queue.ts:514, 527–529 |
| Cancel | `"Stop searching"` (normal) vs `"Stop"` (direct challenge) — `queue-cancel` | — | `.joinscreen button` (16px p8), no own class | queue.ts:517, 532 |

No `aria-live` on the searching text or wait timer.

### 3d. "Match found" overlay (`offerHtml`, queue.ts:535)

Painted **inside `#app`** (not a layer), over the queue page; plays the `decision` cue and flashes the tab title
`"Match found!"` (queue.ts:297–298). Countdown is local (`offerAt`), repainted every second.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Scrim | full-screen dim | — | `.overlay.qoverlay` (891; `.qoverlay` has no rule) | queue.ts:538 |
| Box | | — | `.overlaybox.qofferbox` (893: accent border, r10, 560w → 3439: 380w, centred text, `align-items:stretch`) | queue.ts:538 |
| "Match found" | `<h3>` | — | `.overlaybox h3` (895: accent) | queue.ts:539 |
| Opponent | **name** / `"1043 · Live draft"` (rating · format; format capitalised here, lowercased in the searching line) | — | `.qopponent` (3440: 17px col) + `.hint` | queue.ts:540–543 |
| Accept | `"Accept 12"` (seconds in a dim span) | not yet accepted | `.cta.primary.qaccept` (3441: p13/14, 16px 700), `.qcount` (3442). ⚠ also matched by `.overlaybox > button {align-self:flex-end}` (928) → **likely renders right-aligned at content width**, not full width, inside a centred box. Verify. | queue.ts:546 |
| Waiting line | `"Waiting for Rashi… 12"` | after you accept | `.qwaiting` (3443: p10, dim) | queue.ts:545 |
| Decline / Cancel | `"Decline"` before accepting, `"Cancel"` after | — | `.qdecline` (3444: 12px, centred) | queue.ts:547 |
| After-accept hint | `"If they do not answer in time you go back to the front of the queue."` | after accept | `.qofferbox .hint` (3445: 11px) | queue.ts:548 |

Missing: no state for the countdown reaching 0 (shows `0` until the server speaks); no focus moved to Accept;
no `role="dialog"`; Escape does nothing here (the board's `closeTopOverlay` ladder isn't on this page).

---

## 4. Constructed waiting room — `renderWaiting()` main.ts:9461 (non-trio branch from 9479)

**Reached by:** a constructed room (`mode=constructed`) before both decks are in — creator lands here after
"New constructed game", joiner after a link/code/invite; also a **constructed league match** (`w.league`,
server-bound seats). Routed from `renderNow()` main.ts:9897 (`NET.waiting`). Repainted on every server push;
the friends panel inside is patched in place by `inbox.ts` (no repaint).

**Layout (top→bottom):** header row (logo · title+room code · Leave) → share bar → friends panel → "Your deck"
panel (until your deck is in) → footer strip of two seat lines → error line → footnote. Max 1000px, vertically
centred in the viewport (`justify-content: safe center; min-height:100dvh`).

| element | what it is/does | states & variants (trigger) | CSS classes | file:line |
|---|---|---|---|---|
| Page | | — | `.lobbypage` (1927) | main.ts:9490 |
| Header row | logo, title, buttons; bottom hairline | — | `.lobbyhead` (1930: flex baseline gap16 wrap, bottom border) | 9491 |
| "ALGOMANCY" | `<h1>` wordmark, 24px here (30px on home, default on old screens) | — | `.homelogo` (427: accent, .3em tracking) + `.lobbyhead .homelogo` (1932) | 9492 |
| Title | `"Constructed — room ABCD"` / `"League match — room ABCD"` | `w.league` | `.lobbyhead h2` (1933: 15px 700 text colour) | 9493 |
| Room code | the code, letter-spaced, accent | — | `.lobbyhead .roomcode` (1934) | 9493 |
| "Leave" | `data-btn="gohome"` → full navigation home. **No confirm**, no "your opponent will be told" | always | `.headbtns` (1935: ml auto), `.headbtns button` (1936: 12px p5/12) | 9494 |
| Share bar | `shareBar('Send your opponent the room code', room, link)` — §7a | **hidden for league**; shown even once the opponent has arrived (unlike the draft lobby, which hides it) | `.sharebar` etc. | 9500 |
| League waiting hint | `"Waiting for your opponent. They join from their own League page — tell them on Discord you are here."` | league and opponent not connected | `.hint.lobbywait` — `.hint` has **no global rule**, `.lobbywait` only centres (5125) → renders as **plain full-colour text** | 9498 |
| Invite-a-friend panel | `roomFriendsHtml(!net.peers[opp])` — §7b | not league; signed in; opponent seat empty | `.lobbypanel.roomfriends` | 9500 |
| "Your deck" panel | | **disappears completely once your deck is in** (`mineIn`) — there is no "change deck" after that | `.lobbypanel.deckpicker` (1940; `.deckpicker` has no rule) | 9502 |
| "YOUR DECK" / "YOUR DECK FOR THIS GAME" | panel label | league adds "for this game" | `.lobbypanel > .zonelabel` (1942) | 9503 |
| League deck hint | `"Any deck. Keep it or change it every game."` | league | `.lobbypanel .hint` (1943: m0 only — colour/size **not set**) | 9504 |
| Deck picker | `deckPickerHtml()` — §7c (select, info, "My decks →", import row, paste) | signed-in collection vs signed-out bundled+import | §7c | 9505 |
| "Play this deck" | `data-btn="deckjoin"` → `NET.sendJoin(true)` (10548) | disabled with no saved deck; **no "pick a deck first" text** (home's button says it) | `.cta.primary` → only `button.primary` green applies | 9506 |
| Footer strip | | — | `.lobbyfoot` (1966: panel2 bar, r10, p12/16) | 9509 |
| Seat line — you | dot + `"Ann (you) — deck is in — Ignis Aggro by Ann"` or `"Ann (you) — pick a deck above"` | dot `ready` (green glow) once in; otherwise default **gold** dot | `.lobbyseats` (1968: 13px), `.lobbyseat` (1969), `.seatdot` (1971 accent) `.ready` (1972 glow), `.lockedin` (1947 glow), `.dim` via `.lobbyseat .dim` (1970) | 9511–9514 |
| Seat line — opponent | `"Bo — deck is in"` / `"Bo — connected — still choosing a deck…"` / `"Bo — not here yet"`; name fallback **"Opponent"** | dot: `ready` / default gold (here, choosing) / `away` (grey `#454f5c`, hard-coded) | as above + `.seatdot.away` (1973) | 9515–9517 |
| Error line | `uiError` (server refusal, `"disconnected from the server — reconnecting in 2s…"`) | when set; **gold** `.deckmsg`, not red | `.deckmsg` (520) | 9521 |
| Footnote | `"Deals when both decks are in."` | — | `.homefoot` (476: dim 12px centred) | 9522 |

Wiring: `wireDeckPicker(renderWaiting)` (9524). Tab title alert `"Your opponent is here"` when they arrive (main.ts:739).
Bell + legal footer layers are present (global chrome).

⚠ **"My decks →" inside a room (likely broken).** `deck-openpage` paints the deck page straight into `#app`
(decks.ts:1499), but its close button calls `rerenderHost`, which is `() => { if (!inGame) renderHome(); }`
(main.ts:12383) — in a room `inGame` is true, so **Close does nothing**, and the next server push repaints the
waiting room over the deck page without warning. Verify in a browser.

---

## 5. Single Card Duel waiting room — `renderSingleWaiting()` main.ts:9529

**Reached by:** a constructed room the server flags `single` (creator from the home Single Card Duel disclosure;
joiner via link). Same furniture as §4.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Header | `"Single Card Duel — room ABCD"`, Leave | — | as §4 | 9538–9543 |
| Share bar | same lead `"Send your opponent the room code"` | always (even after they arrive) | `.sharebar` | 9545 |
| Friends panel | §7b | opp seat empty | | 9546 |
| Draw panel | `"DRAW — PICK AGAIN"` / `"You picked **X**; Bo picked **Y**. Neither ever makes a unit, so nobody could attack — a draw before it starts. Pick again (the same card is allowed)."` — both card names hover-preview (`data-prev`) | only when `w.drawn` (both picked unit-less cards) | `.lobbypanel.scdraw` (3833: accent border), `.scdraw p` (3834). Note: this panel has a `<p>` that is **not** `.hint` — different text colour from neighbouring hints | 9548–9553 |
| "Your card" panel | label `"YOUR CARD"`, blurb `"Thirty copies of whatever you pick, hidden from your opponent."` | until your card is in | `.lobbypanel.deckpicker`, `.cardsub` — **unstyled here** | 9555–9557 |
| Card picker | `sc.pickerHtml()` — §7d | | | 9558 |
| Play button | `"Play Ignis Sprite"` / `"Pick a card first"` (disabled) — capital P here, `"pick a card first"` lower-case on the home version (main.ts:9269) | | `.cta.primary` | 9559 |
| Seat lines | `"(you) — card is in — X"` / `"pick a card above"`; opponent `"card is in"` (blind: never names it) / `"connected — still choosing a card…"` / `"not here yet"` | dots as §4 | as §4 | 9562–9571 |
| Error + footnote | `uiError`; `"Deals when both cards are in."` | | `.deckmsg`, `.homefoot` | 9574–9575 |

Wiring: `sc.wire()` (9577) — typing patches suggestions in place.

---

## 6. Draft lobby — `lob.lobbyHtml(v)` lobby.ts:149, called from `renderWaiting()` main.ts:9466

**Reached by:** a draft room (`mode=draft`) before the trio/pair is settled: new live draft, custom live draft
(BL-43), draft rematch (offers "Run it back"), a **draft league match** (`method === 'random'`). Not reached when
the creator fixed the elements on the home screen ("skip the lobby").

**Layout (top→bottom):** header → share bar + friends (until opponent arrives) **or** league waiting hint →
custom-rules summary (custom rooms) → **two-column grid** (left: method list, min 250/max 330px; right: the
method's input) → footer strip (two seat lines left, the ready button right) → footnote. Grid collapses to one
column under 780px (style.css:1939).

| element | what it is/does | states & variants (trigger) | CSS classes | file:line |
|---|---|---|---|---|
| Page/header | as §4 | | `.lobbypage`, `.lobbyhead`, `.homelogo`, `.roomcode`, `.headbtns` | lobby.ts:168–173 |
| Title | `"Live draft — room ABCD"` / `"Custom live draft — room ABCD"` / `"League match — room ABCD"` | `v.custom` / `method==='random'` (a custom league match would say "Custom live draft") | `.lobbyhead h2` | lobby.ts:171 |
| Leave | `gohome` | | `.headbtns button` | lobby.ts:172 |
| Share bar + friends | `shareBar(...)` + `v.friends` (`roomFriendsHtml`) | **hidden as soon as the opponent is here** (contrast §4/§5 which keep it) | §7a, §7b | lobby.ts:177 |
| League waiting hint | identical string to main.ts:9498 (duplicated literal) | league, opponent absent | `.hint.lobbywait` (unstyled colour) | lobby.ts:176 |
| Custom rules box | `"CUSTOM RULES"` + bullet list from `rulesSummary()` (customrules.ts:224: `"2 elements"`, `"Packs of 5"`, `"Simple cards only"`, `"Opening hand of N"`, `"Draw N a turn"`, `"N starting life"`, `"Banned: A, B"`, `"Card filter: …"`) + `"192 cards left out. Kept in your history, counts toward no stats."` | `v.custom` | `.lobbycustom` (2019: accent border r6 p8/12 **mb12** — but the page is a gap:16 flex column, so this adds a double gap), `.lobbycustom ul` (2020) | lobby.ts:143–147, 179 |
| Grid | | | `.lobbygrid` (1938) | 181 |
| Left panel label | `"HOW SHOULD THE TRIO BE CHOSEN?"` (`pair` for 2, `set of elements` otherwise) | count | `.lobbypanel > .zonelabel` | 183 |
| Method buttons | one per server method, each **bold label + blurb** (server/trio.ts:306–327): **Run it back** "Play the same three elements you just played." (rematch only) · **One each, one at random** "You each name one element without seeing the other. The third is drawn at random." · **Something new** "The server picks a trio the two of you have never played — or have not played in the longest." · **Rank all seven** "You each put all seven in order. The trio is drawn from your combined ranking, weighted toward what you both wanted." · (league) **All at random** | `.on` = current method (either player may switch it; the server clears both submissions). `disabled` while you are locked in. No `aria-pressed` | `.lobbymethods` (1951), `.lobbymethod` (1952), `b` (1954), `em` (1955 — `<em>` used with `font-style:normal`), `.lobbymethod.on` (1957: accent border+text, 700) | lobby.ts:91–100 |
| Right panel label | `"YOUR ELEMENT"` / `"YOUR RANKING, BEST FIRST"` / `"NOTHING TO FILL IN"` | method | `.zonelabel` | lobby.ts:128–132, 187 |
| **pick-one:** element grid | 7 element chips (icon + name) as a grid of ≥112px cells; click toggles | `.on` for your pick; all `disabled` when locked | `.elrow.lobbyels` (1960 grid), `.lobbyels .elchip` (1961: 14px p9/12), `.elchip.<el>.on` (941–950, per-element borders; light/dark also get hard-coded bg `#2e2a20`/`#262c35`), `.elicon` (1963: 18px) | lobby.ts:102–106 |
| pick-one hint | `"Name one. Hidden until you are both locked in."` → `"You named **Fire**. Hidden until you are both locked in."` | pick | `.lobbysection .hint` (1946: m0 only) | 106 |
| **rank:** ranked strip | dashed well showing chips in order with a small rank number; click one to take it out (`title="click to take it back out"`) | empty: `"click them in order, most wanted first"` | `.ranklist` (1977: dashed border, `rgba(0,0,0,.15)` bg), `.elchip.ranked` (1980), `.ranknum` (1981: 10px abs) | 109–116 |
| rank: remaining chips | the unranked elements, click to append | hidden when all ranked | `.elrow.lobbyels` | 117–119 |
| rank: helper buttons | `"start over"` · `"fill the rest in any order"` (both lower-case) | disabled when locked / nothing to clear / nothing left | `.lobbyrankbtns` (1983), `button` (1984: 12px) | 120–123 |
| rank: progress | `"3/7 ranked. Shared top picks are more likely, never certain."` | | `.hint` | 124 |
| **fresh:** body | `"Say you are ready and the server picks a trio the two of you have never played."` | | `.hint` | 166 |
| **again:** body | `"Say you are ready and you will play it again."` | rematch | `.hint` | 162 |
| **random (league):** body | `"This is a league match. When you are both ready, the trio is drawn at random and the first player is picked at random."` | league | `.hint` | 165 |
| Footer strip | | | `.lobbyfoot` | 192 |
| Seat lines | `seatLine()`: `"Ann (you) — still choosing…"` (dim) / `"— ready"` (green bold) / opponent `"— has not arrived yet"` (**not dimmed**, unlike "still choosing…"); name fallbacks `'You'`, **`'Your opponent'`** | dot `away`/default/`ready` | `.lobbyseat`, `.seatdot`, `.lockedin`, `.dim` | 135–140, 193–196 |
| Ready button | `"I'm ready"` (primary) / disabled `"finish choosing first"` (lower-case, **the disabled label is the instruction**) | `ready(method)` | `.lobbygo` (1974), `.lobbygo button` (1975: 15px 700 p10/24) + `button.primary` green | 197–201 |
| Unlock button | `"Change my mind"` | when locked | `.lobbygo button` (not primary) | 198 |
| Footnote | `"Nothing is dealt until you have both locked in."` | | `.homefoot` | 203 |

Missing: **no error/disconnect line at all** — `lobbyHtml` takes no `uiError`, so a refused lock or
`"disconnected from the server — reconnecting…"` is invisible in the draft lobby while §4/§5 show it. No
indication that the *opponent* is locked in beyond the seat line; no countdown; the opponent changing the method
under you is not announced (your selection silently resets, lobby.ts:239).

Wiring: `lob.handleLobbyButton()` (lobby.ts:230) via main.ts:11237; it keeps un-submitted picks in module state
(`pick`, `ranking`, `localFor`) and calls `rerender` = `renderWaiting`.

---

## 7. Shared sub-blocks used by the waiting rooms

### 7a. Share bar — `shareBar(lead, room, link)` util.ts:19

Used by: constructed waiting (main.ts:9500), single-card waiting (9545), draft lobby (lobby.ts:177), in-game
banner (§12, main.ts:7553). Comment says "One copy of the furniture" — true for markup, but the four callers
position it differently.

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Bar | `"Send your opponent the room code **ABCD** or this link:"` (in game: `"Waiting for your opponent — send them the room code **ABCD** or this link:"`) | — | `.sharebar` (411: flex, **accent border**, panel bg, r6, p8/10, mb8), `.sharebar b` (413: accent, .1em), `.lobbypage .sharebar` (1929), `.joinscreen .sharebar` (535); `.sharebar.off` (3863) is a deck-page variant | util.ts:20 |
| Link field | read-only `<input>` with the join URL; **inline `onclick="this.select()"`**; no label/aria-label | — | `.sharelink` (414: panel2, 12px **monospace**) | util.ts:21 |
| "copy" | `data-btn="copylink"` → `copyText()` (util.ts:44) selects the first `.sharelink` in the document, label becomes `"copied ✓"` in place and never reverts | lower-case; the replay question bar's twin says `"Copy link"` → `"Copied ✓"` | default `button` | util.ts:22; handler main.ts:10558 |

No "share via…" (Web Share API) on touch; no QR; no separate copy-code button (the code is bold text only).

### 7b. Invite-a-friend panel — `roomFriendsHtml(open)` inbox.ts:173

Painted inside `#app` by the room, then **patched in place** by the inbox poll (`#roomfriends`, inbox.ts:181).
Clicks are `data-inbox`, claimed in capture by the inbox layer (inbox.ts:454).

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Panel | `"INVITE A FRIEND"` | only signed in **and** seat open | `.lobbypanel.roomfriends` (`.roomfriends` no rule) | inbox.ts:175 |
| Loading | `"…"` | before the first poll | `.hint` | inbox.ts:163 |
| Empty | `"Add friends on your profile and they show up here."` (no link to the profile) | no friends | `.hint` | inbox.ts:164 |
| Friend row | presence dot · favourite element icon · **name** · status word · button | `.roomfriend.online|playing|offline`; offline name dims | `.roomfriend` (1319, 1320, 1321), `.rfname` (1322), `.rfstatus` (1323) | inbox.ts:149–159 |
| Presence dot | | `.on` green glow (online/playing), `.busy` gold (playing), none = grey `#3a444f` (hard-coded) | `.fdot` (1916, 1917, 1325) | inbox.ts:154 |
| Fav element | element icon | if set | `.acctel.icon` (1789/1790) | inbox.ts:155 |
| Status word | `"online"` / `"in a game"` / `"offline"` / `"said no"` | | `.rfstatus` | inbox.ts:145, 157 |
| Invite button | `"Invite"` (primary green unless offline) / `"Ask again"` (after a decline) / disabled `"Invited ✓"` | | `.roomfriend button` (1324: 12px) | inbox.ts:149–151 |
| Panel message | `panelMsg` | after an invite attempt | `.deckmsg` (gold) | inbox.ts:166 |

### 7c. Constructed deck picker — `deckPickerHtml()` main.ts:9198 (shared with the home Constructed card and the queue page)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Deck `<select>` | signed in: your **playable** decks (`"Name — by Author"`, author omitted when "you"); signed out: the 5 bundled decks + an imported one | placeholder `"choose a deck…"` (disabled) when none; `"X (not in your collection)"` stray option; `"X (imported)"`. **No `<label>`** — the panel's `.zonelabel` div is not associated | `.deckselect` (511) | 9215, 9236 |
| Loading | `"loading your decks…"` / `"loading the deck list…"` | before fetch | `.hint` (no global style) | 9224 |
| Deck info | `"30 cards · algomancer.cc"` (signed in) / `"30 cards · by Ann · view on algomancer.cc"` (signed out) — external link, new tab | empty div when none | `.deckinfo` (513/514) | 9212, 9233 |
| "My decks →" | `deck-openpage` | signed in only. In a room: see the ⚠ in §4 | `.deckmanage` — **no CSS rule** | 9202 |
| Import row | `<input placeholder="algomancer.cc deck link">` + `"Load"` | signed out only | `.joinrow.deckimport` (433/435/437, 515/516) | 9240–9243 |
| Paste disclosure | `"…or paste a deck list"` → textarea (placeholder `"1 Ignis Sprite / 2 Overwhelm / …"`) + `"Use pasted list"` | signed out | `.deckpaste summary/textarea` (517/518) | 9244–9247 |
| Message | `deckMsg`: `"importing…"`, `"loaded X (30 cards) by Y"`, `"not playable: … (+N more)"`, `"import failed"`, `"could not reach the server"` | success and failure **share one gold style** | `.deckmsg` | 9219, 9248, 9304–9318 |

### 7d. Single-card picker — `sc.pickerHtml()` singlecard.ts:51 (shared with the home disclosure)

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Chosen card | 46px scan thumbnail (hover preview `data-prev`) · **name** · `"× 30"` | none: `"no card picked yet"` | `.scpick` (3719), `.scchosen` (3720), `.scart` (3721), `.scimg` (3722), `.scname` (3723) | singlecard.ts:54–60 |
| Unit warning | `"makes no units — a draw if theirs doesn’t either"` with tooltip `"a deck of this card can never put a unit on the table"` | card makes no units | `.scwarn` (3832 — defined 110 lines from its siblings) | 59 |
| Search box | `<input id="sc-q" placeholder="find a card…">` — no label | | `.joinrow` + `.scpick .joinrow input` (3727, undoing `.joinrow`'s room-code letter-spacing) | 62 |
| 🎲 | random card, `title="any card at random — any of the 491"` | | `.scpick .joinrow button` (3728) | 63 |
| Suggestions | up to 8 matching buttons (hover-preview), or `"no card by that name"` | ≥2 chars typed | **`.crsugg`** (2013/2014) — borrowed from the custom-rules ban search | 39–45, 65 |

---

## 8. Trio reveal interstitial — `lob.revealHtml(reveal)` lobby.ts:210, slot main.ts:7968

**Reached by:** the draft deal after the lobby resolves (`m.trio` → `pendingTrio`, main.ts:807). Drawn by
`renderNow` **over the board**, above the first draft-pick dialog (z 60 vs 58).

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Scrim | | Escape / scrim click dismisses (`closeTopOverlay` main.ts:12021) | `.overlay.trioover` (891, 2027) | main.ts:7968 |
| Box | its own box class, not `.overlaybox` | — | `.trioreveal` (2028: accent border r8, p20/24, max 460, centred, big shadow) | lobby.ts:211 |
| Element banner | the chosen chips (non-interactive `<span class="elchip on">`) | — | `.triobanner` (2031), `.triobanner .elchip` (2032) | 212–213 |
| How | e.g. `"one element each, the rest drawn"`, `"a trio you have not played (or have not played in a while)"`, `"drawn from your combined rankings"`, `"the same trio again"`, `"a trio drawn at random"` (server/trio.ts) | lower-case | `.triohow` (2033: accent 700) | 214 |
| Detail list | e.g. `"Ann chose fire."`, `"Bo chose fire — the same one!"`, `"Drawn from that set: …"` | | `.triodetail` (2034: dim 12px, left-aligned inside a centred box) | 215 |
| "Draft!" | `trio-ok` → closes | — | `button.primary` | 216 |

---

## 9. Draft pick dialog — `pickModalHtml()` main.ts:7730 + `draftPanelHtml()` 7634 + `packInfoHtml()` 7622

**Reached by:** every draft step in a live draft (planning phase, `draftDone[mySeat]` false). A modal over the
board since 2026-09-27; the hand dock tucks underneath (`handDockTucked`, `.handdock.tucked`).

**Layout:** scrim → wide box (≤1180px, 96vw) → top-right "look at the board" → pack info row → head row
(who · instruction · commit button · error) → "your hand after drafting" zone → "left in the pack" zone.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Scrim | | z58 (under trio reveal and post-game); Escape/scrim = **hide** (not answer) | `.overlay.pickover` (4105, 4116 `--pick-railclear`) | 7731 |
| Box | | | `.overlaybox.pickbox` (4106, 4117) | 7731 |
| "▁ look at the board" | hides the dialog; title `"hide this and look at the table (Esc) — your picks are kept"`. The **"▁" (lower one-eighth block)** is used as an icon | — | `.pickbox .pickbar` (4108: right-aligned) | 7732 |
| Pack row | `"Pack #2 · pick 3 of 5 (9 of 13 cards left)"` | each part omitted if the server didn't send it | `.packrow` (1232), `.packinfo` (1233: accent 700) | 7631 |
| Pack fate chip | **returns:** `"this pack comes back to you later this cycle — what you leave, your opponent picks from first"` · **others:** `"your last look at this pack — after this commit it never comes back to you, and your opponent drafts whatever you leave in it"` · **recycled:** `"final look — this pack is retired after this commit: what you leave is shuffled into the bottom of the deck, and nobody drafts from it again"` | `packInfo.after` | `.packback` (1240: green `#17241c/#35583f/#8fc79c`), `.lastlook` (1234: amber `#33270f/#7a5e1e`), `.lastlook.final` (1238: purple `#241a2e/#7a5b96/#d6b8f2`) — **all hard-coded hexes** | 7606–7620, 7630 |
| Panel | | inside the box: border/bg stripped | `.draftpanel` (538) → `.pickbox .draftpanel` (4119) | 7652 |
| Who | `"Ann — draft step"` | | `.drafthead .who` (541) | 7655 |
| Instruction | `"Click a card to move it."` (hidden on touch and under 1100px) + `"Leave exactly 3 in the pack."` | | `.remind` (4076/4077) | 7656 |
| Commit | `"Keep 9 · pass the pack (enter)"` / `"Keep 9 · end the pack (enter)"` (recycled) | disabled until the pack count is exact. `(enter)` hidden on touch | `button.primary`, `.kh` (4017) | 7657–7658 |
| Count error | `"pack has 4/3"` | when not exact. **Inline `style="color:var(--danger)"`** | inline | 7659 |
| Hand zone | `"YOUR HAND AFTER DRAFTING (9)"` + clickable cards (`data-act="draftcard"`), drag supported | | `.zonelabel`, `.zone.draftkeep` (543: green left rule), `.pickbox .draftpanel .card` (4121: clamp 64–118px) | 7660–7661 |
| Pack zone | `"LEFT IN THE PACK — PASSES TO YOUR OPPONENT (3/3)"` / `"LEFT IN THE PACK — RECYCLED INTO THE DECK, UNSEEN (3/3)"` | fate | `.zone.draftleave` (544: dim rule, opacity .85) | 7662–7663 |
| Hidden → resume bar | in the action bar: `"Draft step your pick is waiting ↑ back to the draft"` | `pickHidden` | `.promptbar.pending` (58: amber `#33270f`), `button.primary` | 7736–7742 |
| Tucked hand label | `"Your hand (N) — tucked away while you choose; hover / tap here to look"` | mouse vs touch words | `.handdock.tucked`, `.mouseonly/.touchonly` (4015–4017) | main.ts:7951 |

---

## 10. Constructed "bottom two" dialog — `bottomPanelHtml()` main.ts:7789 (same modal shell as §9)

**Reached by:** each constructed planning draw (draw 4, bottom 2). This is the only "mulligan-like" step; there is
no separate mulligan screen.

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Shell | `pickModalHtml` — scrim, box, "▁ look at the board" | | as §9 | 7730 |
| Who | `"Ann — draw phase"` (§9 says "draft **step**"; the resume bar says "Draw **step**") | | `.drafthead .who` | 7801 |
| Instruction | `"You drew 4. Click 2 cards to put on the bottom of your deck, then confirm."` (`"the card"` if one) — **not** wrapped in `.remind`, so it shows on touch with "Click" | | — | 7802 |
| Commit | `"Put 1/2 on the bottom (enter)"` | disabled until 2 | `button.primary` | 7803–7804 |
| Keeping zone | `"KEEPING (6)"` | | `.zone.draftkeep` | 7805–7806 |
| Bottom zone | `"TO THE BOTTOM OF YOUR DECK, IN THIS ORDER (1/2)"`; empty: `"click cards above"` | | `.zone.draftleave`, `.binempty` (975) | 7807–7808 |
| Panel | | | `.draftpanel.bottompanel` (`.bottompanel` no rule) | 7800 |
| Resume bar | `"Draw step two cards to put on the bottom ↑ back to your draw"` | hidden | as §9 | 7739–7741 |

---

## 11. Pick-set dialog (Wake the Dead / Tides of the Cosmos) — `ps.pickSetHtml()` pickset.ts:211, slot main.ts:7958

In-game, but a lobby-style modal; included because the brief lists `pickset.ts`. **Reached by:** an engine
decision carrying `pickSet` ("choose up to two with total cost ≤ N").

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Scrim/box | | Escape/scrim = hide | `.overlay.psover` (4125), `.overlaybox.psbox` (4126) | pickset.ts:233 |
| Title | the card's name (prompt before `:`) | | `.pstitle` (4129) | 234 |
| Budget line | `"5 mana left · 1 of 2 chosen"` | live as you tick | `.pscount` (4130) | 235 |
| "▁ look at the board" | `pshide`, title `"your picks are kept (Esc)"` (§9's twin has a different title) | | default button inside `.psbar` (4128) — §9's lives in `.pickbar` | 236 |
| Note | `"X can't be chosen now. Pick again."` | follow-up lost the card | `.psnote` (4131: danger) | 237 |
| Panes | `"THEIR BIN"` + `"YOUR BIN"` (bins group) or `"REVEALED"` | | `.pspanes` (4132), `.pspane` (4133/4134) | 228–231 |
| Card | full card with a cost badge | `.on` (outline **`#7fc0ff`** — a blue found nowhere in the tokens), `.off` (35% + grayscale), clickable only if it fits | `.pscard` (4135–4138), badge `.pscost` (no rule) | 216–226 |
| Empty pane | `"none"` | | `.binempty` | 229 |
| Confirm | `"Play 2"` / `"Play none"` | | `button.primary` in `.psfoot` (4139) | 238 |
| Resume bar | `"<who>: <prompt> ↑ Choose"` (+ cast cancel) | hidden | `.promptbar.pending` | main.ts:6282–6285 |

Note: three different "hide this dialog" titles across §9/§10/§11; resume buttons say `"↑ back to the draft"`,
`"↑ back to your draw"`, `"↑ Choose"` (capitalisation differs).

---

## 12. In-game share banner, presence, room tip, spectator lines

### 12a. Share banner — `shareBannerHtml()` main.ts:7539, painted into `#shareslot` by `paintLive()` (1826)

**Reached by:** being on the board while the other seat is empty (e.g. a dealt game whose opponent left, or a
room that deals without both seats). Hidden on game over, with a post-game, in scripted scenarios, and never for
spectators' "watch" link (BL-29 comment 7554).

| element | copy | CSS | file:line |
|---|---|---|---|
| Banner | `"Waiting for your opponent — send them the room code ABCD or this link: [link] copy"` | `.sharebar` inside `.stickytop` | 7553 |

### 12b. Presence dot — `presenceHtml()` main.ts:1788 (into `#presenceslot` on the toolbar's room button)

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Dot | `●` with `aria-label="opponent connected"` | on: green, top-right of the room icon | `.presence.on` (409, 4956/4957) | 1798 |
| Offline | `●` + `"offline"` under the icon, the whole room button turns red and pulses (`tboffline`) | off | `.presence.off` (410, 4958/4959), `.tbstat:has(.presence.off)` (4960, reduced-motion 4963) | 1799 |
| (absent) | nothing for spectators, replays, demo, finished sessions (`liveSession`) | | | 1794–1797 |

### 12c. Room status button + its info tip — `roomStatus()` 7401, toolbar 7361, `toolTipHtml('room')` 7442

| element | copy / icon | variant | CSS | file:line |
|---|---|---|---|---|
| Room icon | `ⓘ` "room ABCD" · `👁` "spectating ABCD" · `▶` "replay ABCD" · `❓` "rules question" · `📘` "Learn to Play" · `🧩` challenge title | seat / spectator / replay / question / lesson / challenge | `.tbstat` (4955), watcher count `.tbcount` (4964) | 7361–7362, 7401–7409 |
| Tip head | icon + label | | `#infotip .tiphead` | 7448 |
| Tip lines | `"you can see both hands"` (spectator, dim) · `"👁 2 watching — they see both hands"` (players, when watched) · `"● opponent connected"` (`tipok`) / `"● opponent offline"` (`tipwarn`) · `"room ABCD"` (lesson/challenge, dim) | | `#infotip .tipline`, `.dim` (4786) | 7449–7452 |

### 12d. Spectator "standing line" (what a watcher reads in the action bar)

A spectator (`?ws=1&room=CODE&watch=1`, main.ts:12549) has `NET.seat = 0` as an *orientation*, an empty legal list
and no presence. The action bar shows the waiting line `"● Waiting for Bo…"` / `"Waiting for Bo to respond"` /
`"Waiting for Bo (Card)"` (`waitingNote`, inspect.ts; bar main.ts:6411, `.promptbar.waiting` 1717, `.livedot`
1724 pulsing) — computed against `other(NET.seat)`, i.e. **always names seat 1 even when seat 0 is the one
acting** (likely; verify). There is no "You are spectating" banner — only the 👁 icon and its tip. In a replay
the bar is empty by design (6383).

---

## 13. Concede dialog — `concedeHtml()` main.ts:12222

**Reached by:** toolbar ☰ table menu or right-click on bare table → "Concede…" (`boardMenuItems`, 12200).

| element | copy | variant | CSS | file:line |
|---|---|---|---|---|
| Scrim | — | stops at the toolbar (`.mainonly`) | `.overlay.mainonly` (959/960/962 — `298px`/`228px`/`52px` magic offsets) | 12236 |
| Box | — | | `.overlaybox` | 12236 |
| Title | `"Concede the match?"` / test game: `"Leave the match?"` | `h.state.sandbox` | `.overlaybox h3` | 12228/12232 |
| Body | `"Ann loses. This cannot be undone."` / `"This is a test game — nothing is recorded. Leaving closes it."` | | plain `<p>` | 12229/12233 |
| Confirm | `"Concede"` / `"Leave"` — **listed first, unstyled (no danger/primary)** | | `.overlaybox > button` (928: align-self flex-end → each button on its own row, right-aligned) | 12234/12230 |
| Cancel | `"Keep playing"` / `"Stay"` | | same | 12235/12231 |

The concede consequences (walkover / half weight, CR D8.5, postgame.ts:95) are explained only **after** conceding,
on the post-game screen — the dialog says nothing about turn 1–2 concessions.

---

## 14. Game over — prompt bar + post-game overlay

### 14a. Game-over prompt bar — `promptHtml()` main.ts:6359–6368

| element | copy | variant | CSS | file:line |
|---|---|---|---|---|
| Who | `"You win! 🎉"` / `"Bo wins."` (net) · `"Bo wins!"` (local) | the 🎉 is the only emoji in a result line; post-game title has none | `.promptbar .who` | 6365, 6367 |
| "Post-game summary" | `pg-reopen` → shows the overlay again | net, post-game exists (only visible after "view the final board") | default button | 6366 |
| "New game" | `restart` | non-net only | | 6368 |

### 14b. Post-game overlay — `pg.postGameHtml(o)` postgame.ts:293, slot main.ts:7969

**Reached by:** the server's `gameover` message (main.ts:669). Dismiss with "view the final board", Escape, or a
scrim click (all = hide; main.ts:12019).

**Layout (top→bottom):** big title + sub-line → stat table (you | label | them) → Unlocked box → concession box →
recorded note → disputed note → guest/sign-up claim form → stacked buttons → link-style "view the final board".
Box max 560px, scrolls internally.

| element | what it is/does | states & variants (trigger) | CSS | file:line |
|---|---|---|---|---|
| Scrim | | | `.overlay.pgover` (2041: padding 16, scroll) | 301 |
| Box | | `.won` green border/title, `.lost` grey `#4a5462` border (hard-coded), draw: neither | `.pgbox` (2042), `.won` (2045/2050), `.lost` (2046/2051) | 301 |
| Title | `"You win!"` / `"Bo wins"` (no "!") / `"Game over"` (draw) | winner | `.pgtitle` (2049: 30px 700) | 297, 303 |
| Sub-line | `"live draft · 12 turns · 47m · [fire][wood][metal]"`; constructed: `"constructed · … · [fire][water] vs [earth]"`; single: `"single card duel · …"`; mode `shared` → `"sandbox"`; length omitted when unknown, `<1m` under a minute, `1h 12m` | `modeName()` account.ts:588, `matchLength()` 129, `elementsLine()` 288 | `.pgsub` (2052: dim 12px flex), element chips `.acctel.<el>` (1786–1802, account-page class), `" vs "` as `.hint` | 298–299, 304 |
| Stat table header | your name · (blank) · their name; winner's name green | | `.pgtable th` (2059–2062), `.pgwin` | 183–188 |
| Stat rows | `"life left"`, `"damage dealt"`, `"units played"`, `"spells played"`, `"spell tokens cast"`, `"augments & grafts"`, `"units killed"`, `"units lost"`, `"attacks declared"`, `"units sent"`, `"cards drafted"`, `"resources opened"`, `"abilities used"` — rows that are 0–0 are dropped; the higher side bolds (not for "units lost") | | `.pgnum` (2064–2067), `.pgnum.lead`, `.pglabel` (2068: dim 11px uppercase centre) | 143–172 |
| "LEANED ON" row | element chip of the most-played element / `"—"` | | `.pgel` (2070/2071) + `.acctel` | 178–181, 191 |
| "MOST PLAYED" row | `"Ignis Sprite ×3"` / `"—"` | | `.pgcard` (2072: accent 12px) | 174–177, 193 |
| Unlocked box | `"UNLOCKED"` + rows of achievement emoji icon · **name** · desc | `o.unlocked?.length` | `.pgunlocked` (2074), `.pgunlockedhead` (2076), `.pgach` (2078), `.achicon` (1886/2079 — emoji at 22px; **`u.icon` inserted unescaped** from the server) | 309–313 |
| Concession box | **walkover:** `"Walkover — not counted (You conceded on turn 1). Not a game: no stats, no achievements, no rated game for either player; the conceder loses a few rating points and the winner gains nothing."` · **early:** `"Early concession — half weight (Bo conceded on turn 2). It counts as a win and a loss, moves ratings at half the usual amount, and is left out of the fast-game achievements."` | recorded + weight ≠ normal | `.pgnote.pgweight.<weight>` (2081, 2084, `.early` 2086 accent border; **`.walkover` has no rule** — the harsher outcome gets the plainer box) | 95–109, 315 |
| Recorded note | `"Recorded to your profile."` / `"In your match history, marked as not counted."` / `"Not recorded — nobody was signed in."`; single card: `"X vs Y. A mirror match — it moves nothing, anywhere."` / `"…In the match history; it moves nothing on the card ladder."` / `"…Rated the cards, not you — see the card ladder under 🏆 Metagame."` (an emoji used as a navigation reference) | | `.pgnote` (2081: dim 11px centre) | 316–324 |
| Disputed note | `"Bo disputed this result."` | opponent disputed | `.pgnote` | 281–285 |
| Guest claim form | `"Keep this game?"` / `"You played as a guest. Sign up to keep this game and your rating."` / inputs placeholder `"a name"` (maxlength **40**), `"a password"` / `"Keep it"` / error line | `isGuest()` (queue-minted guest) | `.pgclaim` (3472: **rem units + `rgba(255,255,255,.05)`**, unique in this area), `.pgclaimhead` (3474), `.pgclaimerr:empty` (3476) | 211–221 |
| Sign-up claim form | `"Keep this game?"` / `"You played signed out. Make an account now and this game is the first one on your profile."` / red-bordered warning **`"DO NOT FORGET YOUR PASSWORD. THERE IS NO PASSWORD RESET."`** / inputs (`maxlength` **20** — differs from the guest form's 40) / `"Sign up and keep it"` | `o.signup` and signed out | `.pgclaim`, `.pwwarn` (531/534) | 234–248 |
| Claim results | `"Saved — this game is on your profile now."` (account.ts:1082), `"Signed up — this game is the first one on your profile."` / `"Signed up. The offer for this game had run out, so your profile starts with your next one."` (account.ts:276), errors `"that did not work"`, `"could not reach the server"` | swaps the form's `outerHTML` in place | `.pgnote` | account.ts:1070–1118 |
| Button stack | full-width column | | `.pgbtns` (2088), `.pgbtns button` (2089: p10 14px) | 330 |
| Rematch (4 states) | `"Request rematch"` → `"Waiting for Bo…"` (disabled primary) + `"Never mind"` → if they asked first: `"Bo wants a rematch — accept"` (green, **pulsing** `livepulse`, no reduced-motion rule) → `"Starting the rematch…"` (seen only for a frame — the client navigates at once, main.ts:689) | `o.rematch`, `o.rematchRoom` | `button.primary`, `.pgwants` (2091) | 251–266 |
| Dispute | `"Dispute game"` → opens the report form in dispute mode; after: disabled `"Disputed"` | `o.disputable` | default button, **same weight as Rematch, sits between Rematch and Home** | 273–278 |
| "Return to home" | `pg-home` → full navigation | | default | 333 |
| "Join matchmaking queue" | `pg-queue` → `?queue=1` (the page itself is titled "Find a game") | always, including for a guest/scenario | default | 334 |
| "view the final board" | `pg-close` → hide overlay | | `.pgpeek` (2092/2093: link-styled button) | 336 |

Missing/oddities: no `role="dialog"`/focus trap; title has no heading element; the table has an empty `<th>` and
no caption/scope; nothing shows rating change (+/-) though "Ranked" is a queue choice; no "watch the replay" link
here (the replay lives on the profile history `▶ CODE`).

---

## 15. "↺ watch again" — `watchAgainHtml()` main.ts:6324

| element | copy | when | CSS | file:line |
|---|---|---|---|---|
| Toolbar button | `↺` (+ `" watch again"` label hidden on the toolbar), title `"watch their deployment again"` / `"watch their haste step again"` | the last playback is this turn's and none is playing | `.lbl` hidden (4949) | 6327 |
| Playback bar (related) | `"▶ Bo's deployment 3/7 <caption> Skip (space)"` / at a stop `"Continue (space)"`; tail: `"End of turn"`, `"End of the haste step"` | while a playback runs | `.promptbar.playbar` (75–77) | 6308–6321 |

---

## 16. Replay viewer — `replaybar.ts` (layer `#replaylayer`), boot main.ts:12584 / 12623 / 12687

**Reached by:** profile match history `▶ CODE` links (`?replay=CODE`, account.ts history rows), bug-report
links with `&at=K`, `?question=<id>` (rules question boards, `ui/questions.ts`), `?challenge=watch&run=…`
(weekly challenge watch). Board is the ordinary spectator board; the bar floats at the bottom centre (above the
hand dock when there is one: `bottom:178px`, 3942).

**Layout:** [optional question box] → head row (code · position · parted tag · verdict chip · eye toggle · ×) →
[optional verdict explanation] → transport row (⏮ ◀ ▶/⏸ ▶| ⏭ · scrubber · speed).

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Bar | fixed, centred, ≤860px | `.parted` (red border) past the divergence; `.asking` for a question | `.replaybar` (3902, 3906, 3942, 3949, 3952, 3983) | replaybar.ts:167 |
| Code | `"ABCD"` / challenge title / `"Rules question"` | | `.replayroom` (3909) | 170 |
| Position | `"action 42 / 180 · turn 6"` | hidden <720px | `.replaywhere` (3910, 3953) | 171 |
| Parted tag | `"NOT THE RECORDED GAME"`, title explains | `at > partedAt` | `.replayparted` (3996: danger 11px uppercase) | 172–173 |
| Verdict chip | `"AS RECORDED"` (green) · `"FAITHFULNESS UNVERIFIED"` (amber) · `"FORKED GAME"` (amber) · `"RECONSTRUCTION FROM ACTION 93"` (red) · `"CANNOT BE REPLAYED"` (red) · `"STAGED POSITION"` (green); a button: toggles the explanation; title `"what this replay is worth"` | `chip()` 99–112 | `.replaychip.good|warn|bad` (3917–3921, hard-coded bgs `#1a2318/#262016/#2b1a1a`) | 174–175 |
| Eye toggle | `"your view"` ↔ `"both hands"`; title `"show both hands"` / `"show only what you could see"` | admin opens omniscient | `.replayeye` (3911), `.on` (3912 `#1d2b1a`) | 176–178 |
| Close | `"×"`, title `"leave the replay"` → `location.search = exitTo` (home or the challenge board) | | `.replayclose` (3913) | 179 |
| Explanation | 5 long paragraphs (`detailText`, 114–144), e.g. reconstruction: `"The rules have changed since this game was played. Up to action 93 what you are watching is the game that happened; from there on … The board is tinted past that point."` | `detail`; auto-open for unreplayable | `.replaydetail` (3922) | 181 |
| Transport | `⏮` start · `◀` back · `▶`/`⏸` play · `▶|` forward · `⏭` end — **glyph-only, `title` but no `aria-label`**; forward is the ASCII-ish `▶|` while back is a plain `◀` | disabled at ends | `.replaytransport` (3925–3927, 3954), `.replayplay` (3928) | 183–188 |
| Scrubber | `<input type=range>` 0…total, `aria-label="action"` | | `.replayscrub` (3929: accent-color) | 189–190 |
| Speed | `<select>` 1/2/3/5/10 + `" /sec"`; >2/sec turns animations off for the duration | | `.replayspeed` (3930/3931) | 191–195 |
| Question box | title (ellipsis) · `"The question, readings and cards"` ↔ `"Close the question"` · read-only link field (`aria-label`) · `"Copy link"` → `"Copied ✓"` · moments `"1. Before the block"`… (lit one green) · note line / `"Between two moments: step with the arrows, or pick a moment."`; open: asked text, readings (**`.rqreadings` has no rule**), "client" line (green), each card's text | `?question=` only | `.rqbox` … `.rqnote` (3962–3988) | 209–228 |
| Keys | Space play/pause, ←/→ step, **Escape leaves the replay** | capture phase, `stopPropagation` | — | 344–350 |

⚠ **Tint is dead CSS (likely).** The "board is tinted past that point" promise is
`body:has(.replaybar.parted) #app .table { filter: saturate(.55) }` (3936), but no element in the client has the
class `table` any more (the regions board is `.lboard`) — so past the divergence only the bar's border turns red.

⚠ **Replay keys are not gated on typing.** The capture-phase keydown (replaybar.ts:344) takes Space and the
arrows with `preventDefault` whenever a replay is open — including while the player types in the judge box (⚖ is
on the toolbar in a replay) or the report form. Escape there leaves the whole replay instead of closing the
dialog. Verify in a browser.

---

## 17. Shared building blocks — and where these screens reinvent them

**Shared (genuinely one implementation):**
- `shareBar()` util.ts:19 — 4 callers. `copyText()` util.ts:44 — share bar + replay question link.
- `.lobbypage/.lobbyhead/.lobbypanel/.lobbyfoot/.lobbyseat/.seatdot` — the three waiting rooms share the *classes*
  (comment main.ts:9486: "same furniture as the draft lobby").
- `deckPickerHtml()` — home, queue, constructed waiting. `sc.pickerHtml()` — home, single-card waiting.
- `.overlay` + `.overlaybox` — concede, match-found, draft pick, pick-set.
- `.zonelabel` as the universal section label; `.elchip` as the universal toggle chip.
- `.promptbar.pending` as the "something is waiting for you" resume bar (§9/§10/§11).

**Reinvented / divergent:**
| thing | copies | difference |
|---|---|---|
| Page header (logo + title + Leave) | lobby.ts:169, main.ts:9491, main.ts:9539 — hand-copied ×3; queue page uses a different header (`.queuehead`, h2 + "← home"); connecting/kicked use `.joinscreen h2 "Algomancy"` | 3 header shapes for adjacent screens |
| Seat line | `seatLine()` lobby.ts:135 vs inline copies main.ts:9511–9517 and 9564–9570 | words differ: "has not arrived yet" vs "not here yet"; "ready" vs "deck is in"/"card is in"; fallback "Your opponent" vs "Opponent"; "has not arrived" not dimmed vs "not here yet" dimmed |
| League waiting hint | lobby.ts:176 and main.ts:9498 | identical literal, duplicated |
| Modal box | `.overlaybox` (concede/offer/pick) vs `.pgbox` (post-game) vs `.trioreveal` (reveal) | three border colours (accent / line-or-glow / accent), three radii (10/10/8), three paddings, three shadows (none / 50px / 40px) |
| "Hide this dialog" bar | `.pickbar` (main.ts:7732) vs `.psbar` (pickset.ts:234) | same "▁ look at the board" label, different classes and titles |
| `esc()` | util.ts:7, pickset.ts:59, replaybar.ts:90 | util.ts's header says the copies drifted; two still exist |
| Error/message line | `.joinerr` (red, 15px), `.deckmsg` (**gold**, 12px), `.deckmsg.qerr` (red), `.psnote` (red), `.pgclaimerr` (default), inline `style="color:var(--danger)"` | errors are gold in the waiting rooms, red on the queue page and connecting screen |
| Radio-ish toggles | `.lobbymethod.on`, `.qopt.on`, `.elchip.on` (queue formats), `.rqmoment.on`, `.replayeye.on` | five "selected" looks: accent text+border / accent border+panel2 bg / accent outline / green text+bg / green text+bg |
| Search-with-suggestions | `sc.pickerHtml` borrows `.crsugg` from customrulespanel.ts | class prefix leaks between features |
| Element chips | `.elchip` (buttons, lobby/home) vs `.acctel` (pills, post-game sub-line and leaned-on) vs `.triobanner .elchip` (static spans) | three element-chip looks within one game's lifecycle |
| Big CTA | `.cta.primary` styled only in `.homecard`, `.lgbhead`, `.chplayrow` | in the waiting rooms and the queue page `.cta` does nothing; the button is the generic green `button.primary` |

**Exit/back wording across the flow:**
| screen | control | copy |
|---|---|---|
| connecting error | `gohome` (primary) | "← Back to the home screen" |
| kicked | `gohome` | "home" |
| queue page | `queue-home` | "← home" |
| waiting rooms ×3 | `gohome` | "Leave" |
| queue searching | `queue-cancel` | "Stop searching" / "Stop" |
| match found | `queue-decline` | "Decline" / "Cancel" |
| draft lobby | `lobby-unlock` | "Change my mind" |
| pick dialogs | hide | "▁ look at the board" |
| concede | cancel | "Keep playing" / "Stay" |
| post-game | `pg-home` / `pg-close` / `pg-rematch-cancel` | "Return to home" / "view the final board" / "Never mind" |
| replay | close | "×" |
| trio reveal | ok | "Draft!" |

---

## 18. Design smells (concrete)

**Cascade / CSS**
1. `.hint` has **no global rule** (only 20 scoped ones). Any `.hint` not inside `.joinscreen`, `.acctcard`, … renders at full text colour, 13px, default `<p>` margins: the league waiting hint (lobby.ts:176, main.ts:9498 — `.lobbywait` only centres, style.css:5125), and inside `.lobbypanel`/`.lobbysection` the only rule is `margin:0` (1943, 1946), so lobby hints are **not dimmed** while the identical class on the queue page is (355).
2. `.cardsub` styled only under `.homecard` (465) and `.singleduel` (3717) — the queue blurb (queue.ts:478) and single-card waiting blurb (main.ts:9557) are unstyled paragraphs.
3. `.cta` styled only in three parent contexts (467/468, 5072, 5380/5381) — the waiting-room "Play this deck" (9506), "Play X" (9559), queue "Find a … game" (queue.ts:495) and "Accept" (546) get no CTA treatment.
4. Queue page nests `.queuepanel` (520px) in `.joinscreen` (max 420px + 24px padding) — panel-in-panel, likely overflow (queue.ts:458–459; style.css:348, 3410). `.home` on the same element is dead.
5. Dead selectors in this area: `.home`, `.qoverlay`, `.roomfriends`, `.deckpicker`, `.deckmanage`, `.bottompanel`, `.pscost`, `.pgweight.walkover`, `.rqreadings`, and the replay tint target `#app .table` (3936).
6. `.overlaybox > button { align-self: flex-end }` (928) silently governs the concede buttons (stacked, right-aligned) and likely the queue "Accept" (queue.ts:546).
7. `.lobbycustom { margin-bottom: 12px }` (2019) inside a `gap:16px` flex column → 28px gap only above the grid in custom rooms.
8. Related rules scattered: `.scwarn`/`.scdraw` at 3832–3834, the rest of the single-card picker at 3716–3728; `.pgclaim` at 3472 while the rest of the post-game block is 2041–2093; `.lobbywait` at 5125 vs lobby block 1927–1984; `.fdot.busy` (1325) before `.fdot` (1916).

**Hard-coded values** (no token): `button.primary #3c5a2f/#5b8747` (53) — the primary button is green while every "selected"/headline colour is gold `--accent`; `.seatdot.away #454f5c` (1973); `.fdot #3a444f` (1916); pack-fate chips `#17241c #35583f #8fc79c #33270f #7a5e1e #241a2e #7a5b96 #d6b8f2` (1234–1240); `.pgbox.lost #4a5462` (2046); replay chip bgs `#1a2318 #262016 #2b1a1a` (3919–3921); `#1d2b1a` ×3 (3912, 3972, 1368); `.pscard.on #7fc0ff` (4136); `.elchip.light/dark.on #2e2a20 #262c35 #cfd6e0` (949/950); `.ranklist rgba(0,0,0,.15)` (1977); `.pgclaim rgba(255,255,255,.05)` + **rem** units (3472, the only rem in this area); magic offsets `178px` (replay bar/toast above the dock, 1371, 3942), `298px`/`228px` (959/962).
**Font-size sprawl** in these screens alone: 10, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 19, 24, 30px.
**Widths:** joinscreen 420, queue 520 (380 for the offer), post-game 560, overlaybox 560, trio reveal 460, lobby 1000, pick dialogs 1180, replay 860.

**Inline styles / inline handlers**
9. `style="color:var(--danger)"` on the draft count error (main.ts:7659); inline `onclick="this.select()"` in `shareBar` (util.ts:21); inline `onerror` on every element icon (`elIcon`, util.ts:14).

**Emoji / glyphs as icons**
10. `🎲` random (singlecard.ts:63), `🎉` (main.ts:6365), `🏆` referenced in prose as a navigation target (postgame.ts:321), achievement icons (server emoji, unescaped, postgame.ts:311), `▁` as "hide" (main.ts:7732, pickset.ts:236), `↑` resume, `↺` watch again, `●` presence, `👁 ⓘ ❓ ▶ 📘 🧩` room icons (main.ts:7403–7409), `⏮ ◀ ▶ ⏸ ▶| ⏭ ×` transport (replaybar.ts:179–188), `✓` in "copied ✓"/"Invited ✓", `←`/`→` in nav labels. Mixed with the game's real webp icons (`elIcon`) on the same screens.

**Wording / capitalisation**
11. Lower-case button labels beside Title-case ones on one screen: "copy", "start over", "fill the rest in any order", "finish choosing first", "home", "← home", "view the final board" vs "I'm ready", "Change my mind", "Play this deck", "Request rematch", "Return to home". Disabled buttons that carry instructions ("finish choosing first", "Pick a card first", "pick a card first").
12. Same idea, different words: "draft step" / "draw phase" / "Draw step" (7655, 7801, 7739); "Join matchmaking queue" vs "Find a game"; "Leave" vs "← home" vs "Return to home" vs "home"; "Opponent" vs "Your opponent"; "has not arrived yet" vs "not here yet".
13. "Joining Rashi game…" — missing possessive (queue.ts:512). "Rank all seven" is hard-coded even when the element count changes (server/trio.ts:310).
14. Copy that says "Click" on touch: "Click 2 cards to put on the bottom…" (main.ts:7802 — not in `.remind`, unlike 7656).
15. "Connecting to the server…" shown while loading a replay file or booting a local lesson (main.ts:12586, 12642, 12570).

**Missing states**
16. Draft lobby shows **no error or disconnect line** (lobby.ts:149 takes no `uiError`) while the other two waiting rooms do (main.ts:9521, 9574).
17. Constructed/single waiting: once your deck/card is in, the picker vanishes with no "change" — the draft lobby has "Change my mind".
18. Errors and successes share `.deckmsg` gold (`"loaded X…"` and `"disconnected from the server…"` look the same).
19. No connecting spinner; reconnect state offers "← Back to the home screen" as if final.
20. Match-found countdown at 0 has no expired state; no live region for the queue; post-game shows no rating delta.
21. "Leave" in a waiting room has no confirmation, even when the opponent is already in and choosing.

**Accessibility**
22. No `role="dialog"`, `aria-modal`, focus move or focus trap on any overlay here (concede, match found, pick, pick-set, trio reveal, post-game).
23. Radio-like groups are plain buttons with `.on`, no `aria-pressed`/`role="radio"`: lobby methods, queue format, ranked/open, rank chips, replay moments (the replay eye and custom-rules toggles elsewhere do have `aria-pressed`).
24. Unlabelled inputs: share link (util.ts:21), deck `<select>` (main.ts:9215), `#h-deckurl`, `#sc-q`, post-game claim inputs (placeholder-only).
25. Transport buttons are glyphs with `title` only (replaybar.ts:183–188); seat state is a coloured `<i>` dot (meaning carried by the words beside it, OK) but `.elchip` unselected (opacity .55) and disabled (opacity .4) are near-identical.
26. `<em>` with `font-style:normal` as a blurb (lobby.ts:98), `<i>` as a dot, `<b>` as status; post-game title is a `<div>`, not a heading; stat table has an empty `<th>`.
27. `.pgwants` pulses forever with no reduced-motion override (2091).

**Behaviour that will bite a redesign**
28. The queue page repaints the whole `#app` every second while searching/offering (queue.ts:309) — any CSS transition or hover state on that page resets each second; the Accept button is replaced under the pointer every second.
29. "My decks →" in a waiting room opens a deck page whose Close does nothing (main.ts:12383 `inGame` guard) and which the next server push overwrites (§4).
30. Replay keyboard capture ignores text fields; Escape quits the replay from inside any dialog (replaybar.ts:344–350).

---

## 19. Storybook isolatability

**Event wiring, everywhere in this area:** markup is template strings; clicks are **delegated** — one document
listener in main.ts dispatches on `data-btn` through a prefix chain (`queue-`, `lobby-`, `pg-`, `sc-`, then
`handlePregameButton`, then `BOARD_BTNS`, main.ts:11198); card clicks use `data-act`; layers use their own
attributes with capture listeners (`data-replay` replaybar.ts:318, `data-inbox` inbox.ts:454). Inputs are wired
after each paint (`wireDeckPicker`, `sc.wire`). So a story can render the HTML string and attach one
`[data-btn],[data-act],[data-replay],[data-inbox]` click logger (Storybook actions) — no handlers need mounting.
Stories must also load the global `style.css` and set `<html class="touch">` for the touch variant.

| renderer | pure? | reads / needs | what a story must stub or refactor |
|---|---|---|---|
| `lob.lobbyHtml(v)` lobby.ts:149 | **almost** — takes a `LobbyView`; already called DOM-free by test 298 | module state `pick`/`ranking`/`localFor` (mutated by `syncLocals`); imports engine `ALL_ELEMENTS`; `elIcon` (ICON_BASE URL) | Good candidate as-is. To show a filled pick-one/rank state, either pass `lobby.mine` (syncLocals adopts it) or export a setter. Add a `error?` field to fix smell 16. |
| `lob.revealHtml(r)` lobby.ts:210 | **yes** | — | none |
| `pg.postGameHtml(o)` postgame.ts:293 | **almost** — takes `GameOver`; tests 277/291/521 call it DOM-free | `account.ts` module state: `isGuest()`, `currentUser()`, `signupOutcome()` (all null in a fresh module) | Default stories work. Guest-claim / "already signed up" variants need account state → inject `{guest, signedIn, signupOutcome}` as parameters. |
| `concessionNote`, `matchLength`, `elementsLine` (postgame.ts) | yes | | none |
| `shareBar()` util.ts:19 | yes | | none |
| `ps.pickSetHtml(dec, card, iconize)` pickset.ts:211 | mostly — renderer injected | module `sel` state; engine `getCard` for costs | Needs a `Decision` fixture and a `cardHtml` stub (main.ts's real one is not importable). |
| `sc.pickerHtml()` singlecard.ts:51 | no | `localStorage.algoSingleCard`, module `draft`; engine `DECK_LIST`, `cardindex.rowFor` (catalogue), `cardpanel.artHtml` | Seed localStorage in the story or add `pickerHtml(chosen, draft)`. Imports are heavy but browser-safe. |
| `roomFriendsHtml(open)` inbox.ts:173 | no | module `friends`, `loaded`, `panelMsg`, `deps.token` (set by `installInbox`) | No setter for the friend list → export `friendRowHtml`/`panelBody` or a `roomFriendsHtmlFor(list)`. |
| queue page `screenHtml/pickerHtml/searchingHtml/offerHtml` queue.ts:451–551 | no, and **private** | module `pickMode`, `pickRanked`, `searching`, `offer`, `offerAt`, `counts`, `error`, `deps.*` (token, rating, deckPickerHtml), `Date.now()` | Export a `queueScreenHtml(state)` taking those as an object; the pure helpers (`countsSummary`, `bandLabel`, `waitLabel`, `queueBlocker`) already exist and are tested (283, 299). |
| replay bar `paint()` replaybar.ts:148 | no — writes to a layer | `server` (a `ReplayServer`: `at`, `total`, `turn`, `omniscient`), `meta`, `playing`, `speed`, `detail`, `qOpen` | Extract `replayBarHtml(meta, transportState)`; `chip()`, `detailText()`, `questionHtml()` are already pure but private. |
| `renderConnecting`, kicked notice | no — main.ts, writes `$app` | `uiError`, `esc` | Trivial to extract `connectingHtml(error)`; kicked markup lives inside `NetBackend.onMsg` (main.ts:882). |
| `renderWaiting` / `renderSingleWaiting` main.ts:9461/9529 | no | `NET` (room, seat, names, peers, waiting, custom), `savedDeck()` (localStorage), `deckPickerHtml()` (acct token, dk collection, `defaultDeckList`, `deckMsg`), `roomFriendsHtml`, `sc.*`, `uiError`, `location.origin` | **main.ts cannot be imported in Storybook** (top-level side effects: installs layers, reads `location`, opens sockets at main.ts:12544+). Extract `waitingRoomHtml(view)` into its own module alongside lobby.ts — the natural shape is a `WaitingView` like `LobbyView`, and it would let the three rooms share one header/seat-line component (§17). |
| `deckPickerHtml()` main.ts:9198 | no | as above | Extract with a `DeckPickerView {decks, current, signedIn, msg, loading}`. |
| `draftPanelHtml/packInfoHtml/bottomPanelHtml/pickModalHtml/pickShowHtml` main.ts:7622–7810 | no | `h.state` (GameState: players, packs, packInfo, turn), `ui.draftPack`/`ui.bottomPick`, `NET`, `pickHidden`, main.ts `cardHtml` | Extract with explicit inputs (`{name, hand, pack, need, fate, packInfo}`) and an injected card renderer, as pickset.ts already does. |
| `concedeHtml` main.ts:12222 | no | `concedeAsk`, `h.state.players`, `h.state.sandbox` | Trivial: `concedeHtml({name, sandbox})`. |
| `shareBannerHtml`, `presenceHtml`, `watchAgainHtml`, `toolTipHtml('room')`, `roomStatus` | no | `NET`, `h.state`, `postGame`, `scn`, `liveSession`, `lastPlayback`, `playbackNow`, `replayActive()`, `learn`, `chrun` | Each reduces to a few booleans/strings; extract with those as parameters. |

**Cheapest first stories** (no refactor): `lobbyHtml` (all 5 methods × locked/unlocked × here/away × custom ×
league), `revealHtml`, `postGameHtml` (win/loss/draw × constructed/draft/single × concession weights × rematch
states × disputed × unlocked), `shareBar`, `pickSetHtml` (with a stub card renderer).

---

## 20. CSS class index for this area (style.css line of the first/defining rule)

`.joinscreen` 348 · `.joinerr` 1746 · `.homelogo` 427 · `.homefoot` 476 · `.sharebar` 411 · `.sharelink` 414 ·
`.lobbypage` 1927 · `.lobbyhead` 1930 · `.roomcode` 1934 · `.headbtns` 1935 · `.lobbygrid` 1938 · `.lobbypanel` 1940 ·
`.lobbysection` 1945 · `.lockedin` 1947 · `.lobbymethods` 1951 · `.lobbymethod` 1952 · `.lobbyels` 1960 ·
`.lobbyfoot` 1966 · `.lobbyseats` 1968 · `.lobbyseat` 1969 · `.seatdot` 1971 · `.lobbygo` 1974 · `.ranklist` 1977 ·
`.elchip.ranked` 1980 · `.ranknum` 1981 · `.lobbyrankbtns` 1983 · `.crsugg` 2013 · `.lobbycustom` 2019 ·
`.trioover` 2027 · `.trioreveal` 2028 · `.triobanner` 2031 · `.triohow` 2033 · `.triodetail` 2034 · `.lobbywait` 5125 ·
`.roomfriend` 1319 · `.rfname` 1322 · `.rfstatus` 1323 · `.fdot` 1916 · `.deckselect` 511 · `.deckinfo` 513 ·
`.deckimport` 515 · `.deckpaste` 517 · `.deckmsg` 520 · `.pwwarn` 531 · `.joinrow` 433 · `.scpick` 3719 ·
`.scchosen` 3720 · `.scart` 3721 · `.scimg` 3722 · `.scname` 3723 · `.scwarn` 3832 · `.scdraw` 3833 ·
`.queuepanel` 3410 · `.queuehead` 3413 · `.qback` 3415 · `.qcounts` 3416 · `.qerr` 3417 · `.qmodes` 3418 ·
`.qdeck` 3419 · `.qgo` 3420 · `.qranked` 3424 · `.qopt` 3425 · `.qsearching` 3431 · `.qsearchtext` 3432 ·
`.qspin` 3433 · `.qofferbox` 3439 · `.qopponent` 3440 · `.qaccept` 3441 · `.qcount` 3442 · `.qwaiting` 3443 ·
`.qdecline` 3444 · `.overlay` 891 · `.overlaybox` 893 · `.overlay.mainonly` 959 · `.elrow` 931 · `.elchip` 941 ·
`.elicon` 1102 · `.zonelabel` 185 · `.binempty` 975 · `.draftpanel` 538 · `.drafthead` 540 · `.draftkeep` 543 ·
`.draftleave` 544 · `.packrow` 1232 · `.packinfo` 1233 · `.lastlook` 1234 · `.packback` 1240 · `.pickover` 4105 ·
`.pickbox` 4106 · `.pickbar` 4108 · `.psover` 4125 · `.psbox` 4126–4139 · `.remind` 4076 · `.kh`/`.mouseonly`/`.touchonly` 4015–4017 ·
`.promptbar` 56 (`.pending` 58, `.playbar` 75, `.waiting` 1717) · `.livedot` 1750 · `.presence` 409 / 4956 ·
`.tbstat` 4955 · `.tbcount` 4964 · `.pgover` 2041 · `.pgbox` 2042 · `.pghead` 2048 · `.pgtitle` 2049 · `.pgsub` 2052 ·
`.pgtable` 2058 · `.pgnum` 2064 · `.pglabel` 2068 · `.pgel`/`.pgcard` 2070 · `.pgunlocked` 2074 ·
`.pgunlockedhead` 2076 · `.pgach` 2078 · `.achicon` 1886 · `.pgnote` 2081 · `.pgweight` 2084 · `.pgbtns` 2088 ·
`.pgwants` 2091 · `.pgpeek` 2092 · `.pgclaim` 3472 · `.acctel` 1786 · `.replaybar` 3902 · `.replayhead` 3908 ·
`.replayroom` 3909 · `.replaywhere` 3910 · `.replayeye` 3911 · `.replayclose` 3913 · `.replaychip` 3917 ·
`.replaydetail` 3922 · `.replaytransport` 3925 · `.replayplay` 3928 · `.replayscrub` 3929 · `.replayspeed` 3930 ·
`.rqbox` 3962 … `.rqnote` 3973 · `.replayparted` 3996 · `.toast` 1368 · base `button` 50, `button.primary` 53,
`button:disabled` 54.
