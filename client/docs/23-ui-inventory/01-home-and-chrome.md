# 01 — Home page and global chrome: UI inventory

Reader 1 of 7. Scope: the home page (`renderHome()` and everything it pulls in) and the page-wide chrome that sits around every non-board page: the legal footer and pages, the report pill and dialog, the help layer, the Learn to Play menu (it is opened from the home page), the bell/inbox/invite popups, toasts, the tab-title alert, the info tip, the connecting/kicked/reconnect notices, and `index.html`.

All paths are relative to `/home/bena/Documents/Algomancy/client/ui/`. Line numbers are from master `ba32fcf4` (2026-11-02). CSS line numbers are in `style.css` unless another file is named.

---

## 0. How the page is put together (read this first)

- **`index.html`** holds only `<div id="app">` plus two scripts. `main.ts` paints every screen into `#app` with `innerHTML` (`renderHome` at `main.ts:9329`). Off the board, `#app` loses `.board`, and `#app:not(.board) { display:block; max-width:none; padding:0 }` (style.css:424) hands the width to each screen.
- **Layers** are siblings of `#app` that each `install…()` once at boot (`main.ts:12417-12543`) and repaint only themselves. They are `#legalfoot` and `#legalover` (legal.ts), `#reportlayer` (report.ts), `#inboxlayer` (inbox.ts), `#helplayer` (helplayer.ts), `#learnmenu` (learnmenu.ts), `#infotip` (infotip.ts), plus some that are out of my scope (binder, amend, crlayer, reveals, replay bar, lesson layer, challenge layer, sandbox). Each layer works out "is a board up?" by watching `#app.class` with a `MutationObserver` (legal.ts:619, report.ts:398, inbox.ts:472, helplayer.ts:99).
- **Click routing.** One global capture-less `document` click listener in `main.ts:10416` finds `closest('[data-btn]')` and calls `handleButton` (`main.ts:11198`). That runs a chain of module handlers, each claiming its own prefix (`acct-`, `queue-`, `deck-`, `cards-`, `meta-`, `lg-`, `ch-`, `sc-`, `cr-`…). The leftovers fall to `handlePregameButton` (`main.ts:10455`) for the home and lobby buttons. Each **layer** uses its own attribute namespace and a **capture-phase** listener that runs before main.ts: `data-legal`, `data-report`, `data-inbox`, `data-help`, `data-learn`, `data-lmenu`.
- **What triggers a home repaint.** Every home interaction calls `renderHome()` again, which rebuilds the whole `#app`. Background work also calls it: the matchmaking counts poll (5 s, `queue.ts:197-214`, but only when the counts change), the league and challenge "hint" fetches (`league.ts:170-183`, `challenge.ts:156-170`), `/api/me` (`account.ts:313-330`), and the default-deck fetch (`main.ts:1329`).

---

## 1. `index.html` (the document shell)

Reached by every URL; the server serves it for `/` and every `?param` route. File: `index.html:1-35`.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| `<html lang="en">` | document language | — | — | index.html:2 |
| `<meta charset>` | utf-8 | — | — | :4 |
| `<meta name=viewport>` | `width=device-width, initial-scale=1` | — | — | :7 |
| `<title>` | "Algomancy" (tabalert.ts rewrites it while flashing) | flashing: "`<message>` — Algomancy" / "Algomancy" alternating | — | :8 |
| `<meta name=description>` | "Draft and play Algomancy online, free in your browser: a rules-enforcing fan client for Caleb Gannon's card game. Send a friend a room code, or find a match." | — | — | :9 |
| `<meta name=theme-color>` | `#12151a`, a hard-coded copy of `--bg` | — | — | :10 |
| favicon links | `favicon.ico` (16/32/48), `icon-192.png`, `apple-touch-icon.png`, all built by `site-icons.py` | — | — | :12-14 |
| Open Graph / Twitter | og:type, site_name "Algomancy Online", title "Algomancy — play online", description, url, image `og-image.jpg` 1200×630, twitter:card. Per-page previews (`og/cards.jpg`, `decks.jpg`, `league.jpg`, `learn.jpg`, `challenge.jpg`) are swapped in by the server (server/linkpreview.ts). | — | — | :16-24 |
| stylesheet | `style.css` (the only one; legal.ts injects a second `<style id="legal-css">` at runtime) | — | — | :25 |
| `#app` | the screen root | `.board` / `.v2` / `.netmode` while a board is up | style.css:43, 424 | :28 |
| `art-versions.js` | per-scan cache hashes (absent over file://) | — | — | :31 |
| `bundle.js` | the esbuild IIFE of main.ts | — | — | :32 |

Notes:
- **Fonts.** No web font is loaded for UI text. `body { font: 13px/1.4 system-ui, sans-serif }` (style.css:41). The one `@font-face` is 'Card Title' (EB Garamond Bold, `fonts/EBGaramond-Bold.woff2`, style.css:37-38), used for card names and not for the UI. So the wordmark `ALGOMANCY` is system-ui with letter-spacing.
- There is no `<noscript>` and no web-app manifest (`manifest.json`), although the owner uses the site as an installed web app (memory: every-page-has-a-button). Only `apple-touch-icon` covers that.
- The stylesheet header comment calls the look "spreadsheet-simulator chic" (style.css:1).

---

## 2. The home page

**How it is reached:** `/` with no query string; also any route that falls into the `else` at `main.ts:2723-2755` (`?queue=…`, `?rules`, `?learn`). Every "home" button goes there: `gohome` → `location.href = location.pathname` (`main.ts:10557`), `learn-home`, the challenge layer's `home`. When a page-module screen is open, `renderHome()` hands `#app` to it instead, in this order (`main.ts:9335-9357`): account → CR review → card browser → tabletop → decks → metagame → league → challenge → admin → queue. Only when none of them is open does it paint the home page.

**Renderer:** `renderHome()` `main.ts:9329-9457`, followed by the post-paint wiring at `main.ts:9443-9456`.

### 2.1 Layout regions (top → bottom)

```
#app (block flow)
└─ .homepage  (max-width 1180, centred, min-height 100dvh-128px so the footer peeks above the fold)
   ├─ .homehead            wordmark (left) ─────────── .homeident (right, wraps): name input | account bar | nav buttons
   ├─ section.lgbanner      league banner (0..1) + section.lgbanner.lgbother (0..n)
   ├─ .queuestrip           matchmaking strip (+ ul.qopen open-games list)
   ├─ .homegrid             auto-fit grid, minmax(302px,1fr)
   │   ├─ .homecard.offer   Live draft
   │   ├─ .homecard.offer.deckpicker  Constructed
   │   ├─ .homecard         Join a game (+ On your own: Learn to play)
   │   └─ .homecard.chhome  This week's challenge (0..1)
   └─ p.homefoot            "To play a friend…"
└─ section.updates          Recent updates (a SIBLING of .homepage inside #app)
footer#legalfoot            (layer, after #app)
#reportlayer  .reportfab    fixed bottom-right pill
#inboxlayer   .inboxbell    fixed, 124px from the right (signed in only)
```

Left → right: `.homehead` is a flex row, so the wordmark sits left and `.homeident` takes `margin-left:auto` (style.css:451). The cards in `.homegrid` sit 3 abreast at 1180 px. The fourth (challenge) card then wraps onto a second row on its own, at one third of the width.

Breakpoints that affect the home page: only `auto-fit` in the grids (`.homegrid` 302 px min, `.lgbbody` 240 px min, `.crknobs` 150 px min) and `.updates` at `max-width:620px` (style.css:504-508). The page has no phone layout of its own. The league banner starts folded when `innerWidth < 700` (league.ts:118-122).

### 2.2 Header — `.homehead` (main.ts:9368-9382)

| element | what it is/does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Wordmark `<h1>` | "ALGOMANCY", plain text in accent gold, letter-spacing .3em, 30px | always shown | `.homelogo` (base style.css:427; override `.homehead .homelogo` :449) | main.ts:9369 |
| Name field `<label>` | "Your name" + `<input id="h-name" maxlength=24 placeholder="(optional)">`. Stored to `localStorage.algoName` only when you press a New/Join button (`saveHomeName`, main.ts:9580) | **signed out only** (not rendered when `acct.currentUser()` is set). Value prefilled from `algoName`. A repaint before you click a game button **drops the typed text** (it is not saved on input). | `.namerow` (:428-429), `.homeident .namerow` (:454-455, input width 150px) | main.ts:9371-9373 |
| Account bar, signed out | `<div>`: "Playing signed out — nothing is recorded." + button **"Log in / Sign up"** (`data-btn="acct-open-auth"`, which opens the account screen in **register** mode, account.ts:1026-1028) | shown while `me` is null, **including while a token exists but `/api/me` has not answered yet**. A signed-in user therefore sees "Playing signed out" for a moment on every page load (no loading state). | `.acctbar.out`, `.accthint` (:1771-1774; `.homeident .acctbar` :452-453) | account.ts:362-366 |
| Account bar, signed in | the whole box is one `<button data-btn="acct-open-profile" title="your profile, stats and achievements">`. Line 1: "Playing as **{username}**" + favourite-element icon. Line 2: the record, e.g. "3W–2L · 1 unrecorded · 🔥3" or "no games yet" | streak chip `🔥N` only when streak ≥ 2; the "· N unrecorded" part only when `unresolved` > 0; the favourite icon only when one is set | `button.acctbar.in` (:1777-1779, hover underlines the name), `.acctwho` :1780, `.acctname` :1781, `.acctrec` :1782, `.acctel.icon` :1789-1790 | account.ts:368-375 |
| Favourite element icon | `<span class="acctel icon {el}" title="favorite element: {el}"><img src=ICON_BASE/{el}.webp alt={el}>` | per element | `.acctel`, `.acctel.icon`, `.acctel.{fire…dark}` (:1786-1802) | account.ts:352-353 |
| "🗂 My decks" | `data-btn="deck-openpage"` → the decks page | **signed in only** | `.homedecks` (:2570 — margin-top 6px, defined in the *decks* section) | main.ts:9375 |
| "📖 How to play" | `data-help="rules"` → help layer, Rules tab | always | `.homedecks` | main.ts:9376 |
| "🔍 Cards" | `data-btn="cards-openpage"` → card browser | always | `.homedecks` | main.ts:9377 |
| "🏆 Metagame" | `data-btn="meta-openpage"` → metagame page | always | `.homedecks` | main.ts:9378 |
| "🏅 League" / "🏅 League · sign up" | `data-btn="nav-league"` → `acct.leaveScreen(); lg.openLeague()` (main.ts:11202) | hidden unless a season is visible to this viewer or the viewer is an organizer. The "· sign up" suffix and the accent outline appear when the season is joinable and you have not entered. Hidden until the `/api/league` fetch answers, and **the fetch is fired from inside the render function** (`askHint()`). | `.homedecks`, `.homedecks.lgnavjoin` (:5126) | league.ts:190-196 |
| "🧩 Challenge" | `data-btn="nav-challenge"` → challenge page | hidden unless `/api/challenge` returned a current or past challenge (fetch fired from inside the render function) | `.homedecks` | challenge.ts:266-270 |

### 2.3 League banner (`lg.homeBannerHtml()`, league.ts:229-262; mounted at main.ts:9384)

Hidden entirely when there is no season. Rendered as `<section class="lgbanner" aria-label="League">`. The `lgb*` styles are at style.css:5064-5111 and 5127-5128.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Fold toggle | `<button data-btn="lg-banner" aria-expanded>` with caret "▾"/"▸" + "🏅 **{season name}**" | open/closed is remembered in `localStorage.algoLeagueBanner`; defaults to closed below 700 px | `.lgbfold` :5067, `.lgbcaret` :5068 | league.ts:240-241, toggle :1130-1133 |
| Phase label | "Constructed · " (constructed seasons only) + `s.label` (e.g. "Week 2 of 4") | gold uppercase | `.lgbphase` :5069 | :242 |
| "✓ you're in" | entered marker | only when you have entered | `.lgbin` :5070 (green) | :243 |
| Next-date line | e.g. "Sign-ups open Sun 2 Nov", "Week 1 starts …", "The final starts …", "Ends …", "Champion: X" | one of 6 forms (`nextText` league.ts:283-292) | `.lgbnext` :5071 | :244 |
| CTA | **"Sign up"** (`button.cta.primary data-btn=lg-open`) when joinable and not entered; otherwise "League page" (a plain button) | 2 variants | `.lgbhead .cta` :5072 only sets padding. The `.cta.primary` here does NOT get the gold of `.homecard .cta.primary`; it falls back to `button.primary` (green fill) | :235-237 |
| Dates strip `<ol>` | one pill per phase: "Sign-up week Sun 2 Nov", "Week 1 …", "Ends …" | `.now` (accent border), `.past` (opacity .5); colour/opacity are the only signal | `.lgbdates` :5073-5078 | :247-250 |
| "How it works" fold | `<h3><button class="lgbhowfold" data-btn="lg-how" aria-expanded>` "▾ How it works" + `<ul class="lgbhow">` with 6 bullets (Sunday-to-Saturday weeks, sign-up week, match format line, suggest a time, "A win is 3 points…", "After week N, the top two play…") | open by default until you have entered (`howOpen ?? !me.entered`); remembered for the visit only | `.lgbhowfold` :5127, `.lgbhow` :5083, `.lgbbody h3` :5080 | :252-256, 294-303 |
| Column 2, champion | "Champion" + "🏆 **{name}**" | when the season is finished | `.lgbchamp` :5098 | :257 |
| Column 2, your matches | "Sign-up week" (with the count "N players are free when you are." / "Nobody shares your hours yet." and "Up to N games this week count." + "Find an opponent" button) · "Your matches this week" / "Your final" rows: "vs **X** (handle on Discord)" + time line + **Play** (`button.primary data-btn=lg-play`) / "✅ won" / "lost" / "not played" / "to play" · empty: "You are sitting this week out." / "None this week." | entered and phase ≥ 0 | `.lgbrows` :5095-5097, `.lgbtime(.agreed/.ask/.dim)` :5109-5111 | :324-346 |
| Column 2, how to join | `<ol class="lgbsteps">`, 4 ticked steps: "Sign in or make an account" (linkbtn → acct-open-auth) / "Signed in"; "Mark when you are usually free"; "Add your Discord name" / "Discord name: X"; "Join from {date}" / "Join on the League page" / "Joined". Plus "Late entries are open until week 2." Closed state: "Sign-ups for this season have closed. The next one will be announced on Discord." | each step has a ✓ tick when done | `.lgbsteps`, `.lgbtick` :5084-5088, `.linkbtn` :3718 | :306-321 |
| Column 3, sign-ups | "Signed up (N)" + name pills / "Nobody yet — be the first." | before week 1 | `.lgbnames` :5089-5090 | :349-355 |
| Column 3, standings | `<table class="lgbtable">` with rank, name (🏆 for the champion), W–L, "N pts"; top 8, then "+N more on the League page" | after week 1 | `.lgbtable` :5091-5094 | :356-365 |
| Column 3, pairings | "Week N pairings" / "The final": "**W** beat L" / "A vs B to play / not played / double loss"; your own rows first, marked `.mine` (accent colour) | after week 1 | `.lgbrows li.mine` :5097 | :366-369, 373-381 |
| Other-season rows | `section.lgbanner.lgbother`: "🏅 **name**", phase label, next line, "vs **X**" + **Play** per open match, and a button named after the season | one per other running season (e.g. last month's final) | `.lgbother` :5066 | :267-280 |

### 2.4 Matchmaking strip (`mm.stripHtml(signedIn)`, queue.ts:402-411; mounted at main.ts:9386)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Title | `<img class="txticon" src=ICON_BASE/battle.webp alt="⚔" onerror="this.outerHTML=this.alt">` + "Matchmaking" | if the image fails, an inline handler swaps in the ⚔ glyph | `.qstriptitle` :3403, `.txticon` :1109 | queue.ts:405 |
| Count line | `countsSummary()`: "checking…" (before the first poll) / "nobody waiting — be the first" / "3 waiting · Constructed 1 · Live draft 2" | `.live` (green) when total > 0; colour is the only cue | `.qstripcount`, `.qstripcount.live` :3404-3406 | queue.ts:122-129, 406 |
| "Find a game" | `button.cta.primary.qstripgo data-btn="queue-open"` → the queue screen (`openQueue`, queue.ts:370) | always enabled | `.queuestrip .qstripgo` :3407 (gold border and text over the green `button.primary` fill) | queue.ts:408 |
| Open-games list | `<ul class="qopen">`, one `li.qopenrow` per waiting player: **{username}** · "Live draft · ranked · 1530" or "Constructed · open" · wait "m:ss" · button **"Join →"** (`data-btn="queue-join-open" data-id`) | hidden when empty. Clicking a game that has gone opens the queue screen with "that game is gone". Constructed while signed out opens it with "constructed needs an account — you have to bring a deck". | `.qopen`, `.qopenrow`, `.qopenwho/.qopenwhat/.qopenwait`, `.qopenjoin` :3456-3469 | queue.ts:424-435; handler :594-620 |
| Container | the full-width strip | — | `.queuestrip` :3399-3401 | queue.ts:403 |

Notes:
- `stripHtml(signedIn)` ignores its `signedIn` parameter. Everything it shows comes from the module's `counts` and `openGames`.
- `Join${g.mode === 'constructed' ? ' →' : ' →'}` has two identical branches (queue.ts:433).
- The wait timer does not tick on the home page. It only moves when the poll brings new data, because the 1 s tick only repaints while the queue screen is open (queue.ts:303).

### 2.5 Card 1 — Live draft (`.homecard.offer`, main.ts:9389-9408)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| `<h2>` | "Live draft" | — | `.homecard h2` :464 | 9390 |
| Subtitle | "Draft from shared packs, then play. You pick the three elements together once you are both in the room." ("three" becomes the number k when Custom rules changes the element count) | k = `crp.elementCount()` | `.homecard .cardsub` :465 | 9391-9392 |
| Fixed-trio `<details>` | summary: "…or pick the trio now and skip the lobby" ("elements" when k ≠ 3) | **open only when `ui.homeFixedTrio` is true**, i.e. after an element click. If the user opens it by hand, the next background repaint snaps it shut (it has no `toggle` listener, unlike Options and Single Card Duel). | `.fixedtrio` :1987-1990 | 9393-9394 |
| Element chips (×7) | `<button class="elchip {el}[ on]" data-btn="eltoggle" data-el>` + `elIcon(el)` (webp, `alt=""`) + lowercase name, capitalised by CSS. Clicking toggles it; when k are already picked, the oldest rotates out (main.ts:10468-10478). Saved to `localStorage.algoEls`. | off: opacity .55. on: bold, accent outline, element-coloured border; Light and Dark also tint the face. No `aria-pressed`. | `.elrow` :931, `.fixedtrio .elrow` :1990, `.elchip` :941-950, `.elicon` :1102, `.elchip .elicon` :1104 | 9395-9396 |
| "🎲" | `data-btn="elrandom" title="pick at random — any of the {N}"` (N = `crp.setCount()`, e.g. 35) | no aria-label (the title is its only name) | default `button` | 9397 |
| Fixed-trio start | `data-btn="newgame" data-mode="draft" data-els="1"`: "Start with fire + water + earth" | **disabled** with "pick 3 of the 7 (2/3)" until k are picked. Disabled with `title={error}` when the custom-rules verdict refuses the pick. This is a plain button, not `.cta`. | default `button` | 9399-9401 |
| Custom rules panel | see §2.6 | — | — | 9403 |
| `.spacer` | flex filler that pushes the CTA to the bottom | — | `.homecard .spacer` :466 | 9404 |
| Error line | `<p class="deckmsg">{uiError}</p>`. **Every** home error lands here, including a failed **Constructed** create ("could not reach the server", "the server refused these rules"). | only when `uiError` is set. Coloured accent **gold** (`.deckmsg`), not danger red. | `.deckmsg` :520 | 9405 |
| CTA | `button.cta.primary data-btn="newgame" data-mode="draft"`: "New live draft" / "New custom live draft" | disabled with `title={error}` when the custom rules are invalid | `.homecard .cta` :467, `.homecard .cta.primary` :468 + `button.primary` :50 → green fill, gold border and text, 15px bold | 9406-9407 |

### 2.6 Custom rules panel (`crp.panelHtml(fixedPick, clockPickHtml('draft'))`, customrulespanel.ts:121-163)

A `<details class="customrules" data-customrules>` inside the Live draft card. Its open state is module state (`open`), kept by a toggle listener (`wirePanel`, :203-233). Typing patches the DOM in place and does not repaint.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Summary | "Custom rules — none set" (the dash part is `span.dim`) / "Custom rules · **Simple cards only · Pack size 5 · …**" | active vs standard | `.customrules > summary` :1995-1997 | :138-140 |
| Clock picker (injected `extra`) | see §2.8. It sits **inside** this panel but is not a custom rule. | — | — | main.ts:3090-3105 |
| "🌱 Beginner" | `data-btn="cr-preset" data-preset="beginner" title="the rulebook's Quick Start: two elements, simple cards only, packs of 5"`. It also pre-picks fire + wood as the fixed pair (main.ts:10460-10464) | — | `.crpresets` :1998 | :142-143 |
| "Back to standard" | `data-btn="cr-preset" data-preset="standard"` | disabled when no rule is set | `.crpresets` | :144 |
| "Simple cards only" toggle | `button.crsimple[.on] aria-pressed` holding a text glyph checkbox "☑"/"☐" + **Simple cards only** + `span.dim` "silver-symbol cards · {simple} of {pool}" | on: accent border | `.crsimple` :1999-2001, `.crcheck` (no rule) | :146-148 |
| Knob steppers (×5) | `div.crknob[.changed]`: label (Elements / Pack size / Opening hand / Draws per turn / Starting life) + "−" (`aria-label="fewer"`) + **value** + "+" (`aria-label="more"`). Starting life steps by 5. | − or + disabled at the bounds. `.changed` (differs from default) brightens the label text, and that colour is the only cue. The aria-labels do not name the knob. | `.crknobs` :2002, `.crknob` :2003-2007 (buttons line-height 20px) | :124-131, 149 |
| "Banned cards" | `div.zonelabel` heading | — | `.zonelabel` :185 | :151 |
| Ban chips | `<span class="crchip">{name} <button data-btn="cr-unban" aria-label="unban {name}">✕</button></span>` / `span.dim` "none" | — | `.crchips` :2010, `.crchip` :2011-2012 **and** :5248 (see smell S1) | :152-153 |
| Ban input | `<input id="cr-ban" placeholder="type a card name to ban it">`. Enter bans the first suggestion. | keeps focus after a ban (`focusBan`) | `.crbans input` :2008 | :154 |
| Suggestions | up to 8 `<button data-btn="cr-ban">` after 2+ characters / `span.dim` "no card by that name" | patched in place on input | `.crsugg` :2013-2014 | :94-101, 155 |
| "Advanced — card filter" `<details>` | `<input id="cr-query" maxlength placeholder="e.g. -set:lightdark">` + `div#cr-querynote.dim`: "Same syntax as the 🔍 Cards page." / "N of {pool} cards match." / the parser's errors | opens by itself when a query is saved | `.cradvanced` :2015, input :2008 | :157-162, 103-108 |
| Pool verdict | `div#cr-pool`: "✓ {message}" (`.crok`, dim) / "✗ {error}" (`.crbad`, red) / empty | only when a rule is active; patched in place | `.crpool/.crok/.crbad` :2016-2018 | :110-115, 162 |

### 2.7 Card 2 — Constructed (`.homecard.offer.deckpicker`, main.ts:9410-9419)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| `<h2>` | "Constructed" | — | `.homecard h2` | 9411 |
| Subtitle | "A deck you built: 30 cards, max 2 of each." | — | `.cardsub` | 9412 |
| Deck `<select id="h-deck">` | variant A, **signed in with legal decks in the collection**: options "{name}" or "{name} — by {author}", plus a stray option "{name} (not in your collection)". Variant B, **signed out or empty collection**: the bundled defaults "{name} — by {author}", plus "{name} (imported)". Both start with a disabled "choose a deck…" when nothing is chosen. A `change` listener saves the pick and repaints (main.ts:9286-9297). | — | `.deckselect` :511 | 9215-9217, 9236-9238 |
| Loading state | `div.hint`: "loading your decks…" (signed in) / "loading the deck list…" | before `/api/deck/defaults` answers. **`.hint` has no style here**, so it renders as full-strength body text. | (none) | 9224 |
| Deck info line | A: "30 cards · [algomancer.cc]". B: "30 cards · by {author} · [view on algomancer.cc]". The links are `target=_blank`. | an empty `div.deckinfo` when nothing is picked. The link text differs between A and B. | `.deckinfo` :513-514 | 9211-9214, 9232-9235 |
| "My decks →" | `button.deckmanage data-btn="deck-openpage"` | signed in only; it duplicates the header's "🗂 My decks" under a different label | no CSS for `.deckmanage` | 9201-9203 |
| Import by link | `.joinrow.deckimport`: `<input id="h-deckurl" placeholder="algomancer.cc deck link">` + "Load" (`data-btn="deckimporturl"`) | variant B only. The typed URL is lost on any repaint. | `.joinrow` :433-437, `.deckimport` :515-516 | 9240-9243 |
| Paste `<details>` | "…or paste a deck list" → `<textarea id="h-decktext" rows=6 placeholder="1 Ignis Sprite\n2 Overwhelm\n…">` + "Use pasted list" (`data-btn="deckimporttext"`) | variant B only. The open state and the text are lost on repaint. | `.deckpaste` :517-518 | 9244-9247 |
| Deck message | `div.deckmsg`: "importing…" / "loaded {name} (30 cards) by {author}" / "not playable: a · b · c · d (+N more)" / "import failed" / "could not reach the server" / "could not load the default decks from the server" | success, progress and error all share one gold style | `.deckmsg` :520 | 9219, 9248; texts 9302-9315, 1335 |
| Options `<details>` | `details.fixedtrio.homeoptions data-homeoptions`, summary "Options — clock 45m" / "— clock off" (`span.dim`), body = the clock picker (§2.8) | open state kept in `homeOptionsOpen` via a toggle listener (main.ts:9450-9451) | reuses `.fixedtrio` | 3110-3116 |
| `.spacer` | — | — | — | 9415 |
| CTA | `button.cta.primary data-btn="newgame" data-mode="constructed"`: "New constructed game" / "New constructed game — pick a deck first" | disabled when no deck is picked | `.homecard .cta.primary` | 9416-9417 |
| Single Card Duel `<details>` | **below** the CTA: §2.9 | — | — | 9418 |

### 2.8 Clock picker (`clockPickHtml(mode)`, main.ts:3090-3105). Two instances: in Custom rules (draft) and in Options (constructed)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Wrapper | `div.clockpick data-clockpick title="the clock for games you start"` | — | `.clockpick` :1270 | 3094 |
| Label | "⏱ Clock" | — | `.clockpicklabel` :1271 | 3095 |
| "Default" | `button.elchip[.on] data-btn="clockpick" data-ms="auto" title="45 min constructed · 60 min live draft"`. Removes `localStorage.algoClockMs` | on when nothing is stored | **reuses `.elchip`** (element-chip styling: opacity .55 off, outline on) | 3096-3097 |
| "Off" / "45m" / "60m" | `button.elchip[.on]` with titles "no clock at all — nobody can lose on time", "45 minutes each — the constructed default", "60 minutes each — the live-draft default" | exactly one is on. The setting is shared by both instances, so choosing on one card changes the other. | `.elchip` | 3098-3099, presets 3035-3039 |
| Hint | "60m each" (draft) / "45m each" (constructed) when on Default; "running out of time loses the game"; "no clock — nobody can lose on time" | 3 variants | `.clockpickhint` :1272 (10px) | 3100-3103 |

### 2.9 Single Card Duel (`singleDuelHtml()`, main.ts:9261-9271, and `sc.pickerHtml()`, singlecard.ts:52-67)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| `<details>` | `details.fixedtrio.singleduel data-singleduel`, summary "…or something sillier: **Single Card Duel**" | open state kept in `singleDuelOpen` | `.fixedtrio`, `.singleduel .cardsub` :3717 | main.ts:9263-9264 |
| Blurb | "Thirty copies of one card. Your opponent picks theirs blind. It rates the cards, not you — see the [card ladder]." The link is `button.linkbtn data-btn="meta-ladder"`. | — | `.cardsub`, `.linkbtn` :3718 | 9265-9266 |
| Chosen card | `span.scart data-prev` holding the 46 px scan (artHtml) + `span.scname`: **{name}** + `span.dim` "× 30" + optional `span.scwarn title="a deck of this card can never put a unit on the table"` "makes no units — a draw if theirs doesn't either" | empty: `span.dim` "no card picked yet". `data-prev` gives a hover preview (mouse only). | `.scpick` :3719, `.scchosen` :3720, `.scart/.scimg` :3721-3722, `.scname` :3723, `.scwarn` :3832 | singlecard.ts:55-60 |
| Search | `.joinrow`: `<input id="sc-q" placeholder="find a card…">` + "🎲" (`data-btn="sc-random" title="any card at random — any of the {N}"`) | Enter picks the first suggestion | `.scpick .joinrow` :3727-3728 | :61-64 |
| Suggestions | `div#sc-sugg.crsugg`: up to 8 `<button data-btn="sc-pick" data-prev>` / "no card by that name" | patched in place | `.crsugg` :2013 | :44-50, 65 |
| Start | `<button data-btn="newgame" data-mode="constructed" data-single="1">`: "New single card duel — {card}" / "pick a card first" (disabled) | a **plain** button, unlike the card's other CTA | default `button` | main.ts:9268-9269 |

### 2.10 Card 3 — Join a game (`.homecard`, main.ts:9421-9436)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| `<h2>` | "Join a game" | — | — | 9422 |
| Subtitle | "Enter the room code you were sent." | — | `.cardsub` | 9423 |
| Code input | `<input id="h-code" placeholder="CODE" maxlength=8 autocapitalize="characters" spellcheck=false style="text-transform:uppercase">`. Enter clicks Join (main.ts:9444-9446) | an empty code does nothing and shows nothing. Typed text is lost on a background repaint. | `.joinrow input` :435-436 (letter-spacing .2em, bold, centred), `.homecard .joinrow input` :469 (17px) + an **inline style** | 9425-9426 |
| "Join" | `data-btn="joincode"` → `?ws=1&room=CODE` | — | `.homecard .joinrow button` :470 | 9427 |
| `.spacer` | — | — | — | 9429 |
| "On your own" | `div.homesep` > `div.zonelabel` "On your own" | — | `.homesep` :472, `.zonelabel` :185 | 9430-9431 |
| "Learn to play" | `<button data-learn="menu">` → the Learn menu layer (§3.7) | — | `.homesolo button` :475 | 9432-9434 |

### 2.11 Card 4 — This week's challenge (`chal.homeCardHtml()`, challenge.ts:273-285)

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Card | `div.homecard.chhome` | hidden when there is no current challenge or no server; appears after its own fetch, fired from inside the render function | `.homecard` (`.chhome` has no rules) | :278 |
| `<h2>` | "This week's challenge" | — | — | :279 |
| Goal | `p.cardsub` > `<b>` goalText, e.g. "Have 3 units in play at once" | — | — | :280 |
| Time line | "3d 4h left" / "5h 12m left" / "closed", + " · your best: 5 turns (#2 fastest)" | best only with a run on record. Not live: it changes only on a repaint. | `.cardsub` | :281 |
| "Play" | `button.cta.primary data-btn="ch-home-play" data-id` | — | `.homecard .cta.primary` | :283 |

### 2.12 Foot line and Recent updates

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Foot line | `p.homefoot`: "To play a friend, start a game and invite them, or send them the code." (the same class is reused by the waiting rooms: "Deals when both decks are in.") | — | `.homefoot` :476 | main.ts:9440 |
| Updates section | `<section class="updates" aria-labelledby="upd-h">` | hidden when the list is empty | `.updates` :483 | updates.ts:344-357 |
| Heading | `<h2 id="upd-h">` "Recent updates" + `span.updnew` "N new since your last visit" | the "new" span only when there are unseen entries and this is not a first visit. "Seen" is a count in `localStorage.algoUpdatesSeen`, read and advanced once per page load. | `.updates h2` :484 (12px dim uppercase), `.updnew` :494 | :349 |
| Row ×6 | `li.upd.{new|fix|change}[.unseen]`: `<time datetime>` "1 Nov" (blank for a second entry on the same day) · `span.updkind` "New" / "Fix" / "Change" pill · `<p>` text | `.unseen`: accent inset bar + faint gold wash | `.updlist` :486, `.upd` :488-495, `.updkind` :496-500, `.upd time` :495, `.upd p` :501 | :324-330 |
| "Older updates (N)" | `details.updolder` > `ol.updlist` with the rest (currently **236 rows**, all in the DOM on every home paint) | open state kept in `olderOpen` | `.updolder summary` :502-503 | :351-354 |
| Phone layout | at ≤620 px the text goes under date + chip, and empty dates are hidden | — | :504-508 | — |

### 2.13 Shared building blocks used by the home page

- **Cards:** `.homecard` (+ `.offer` variant: border `#3b4654`), `.homecard h2`, `.cardsub`, `.spacer`.
- **Buttons:** global `button` (style.css:45-50); `button.primary` (green fill `#3c5a2f`, border `#5b8747`); `.cta` (`.homecard .cta`, `.lgbhead .cta`, `.chplayrow .cta`); `.cta.primary` (gold outline over the green fill, scoped to `.homecard` and `.chplayrow` only); `.homedecks` (header nav); `.linkbtn` (text link look); `.elchip` (selectable chip, reused for the clock picker); `button.acctbar` (a whole bar as a button); `.lgbfold`/`.lgbhowfold` (unstyled disclosure buttons); `.qopenjoin` (solid accent pill).
- **Inputs:** `.joinrow` (input + button row, reused by the deck import and the single-card search, each overriding the letter-spacing), `.namerow`, `.deckselect`, `textarea` in `.deckpaste`.
- **Disclosures:** native `<details>` with four styles: `.fixedtrio` (dashed top rule, dim summary; reused for Options and Single Card Duel), `.customrules` (identical rules, duplicated), `.cradvanced`, `.deckpaste`, `.updolder`.
- **Labels/text:** `.zonelabel` (11px dim uppercase), `.hint`, `.dim` (neither has a global rule, see S3), `.deckmsg` (gold message line), `.homefoot`.
- **Chips/pills:** `.elchip`, `.crchip`, `.updkind`, `.lgbdates li`, `.lgbnames span`, `.acctel`, `.badgechip` (not on home).
- **Icons:** element webps via `elIcon()` (util.ts:13-14, `.elicon`) and the `acctel` img; `battle.webp` as `.txticon`; everything else is emoji.

### 2.14 Wiring and Storybook isolatability (home)

| piece | pure? | reads | what a story must stub / refactor |
|---|---|---|---|
| `renderHome()` | **No**: it writes `$app.innerHTML`, then attaches listeners and starts a poll | `acct` (me, token), `dk` collection, `crp` state, `ui.homeEls/homeFixedTrio`, `uiError`, `localStorage` (algoName, algoDeck, algoClockMs), `savedDeck()`, `mm` counts, the `lg`/`chal` hint caches; it **fires** `/api/league`, `/api/challenge`, `/api/deck/defaults`, `/api/queue` | **main.ts cannot be imported into a story**: importing it runs the whole boot (`main.ts:12376-12765`: installs every layer, `setInterval`s, `NetBackend`). `renderHome`, `deckPickerHtml`, `clockPickHtml`, `constructedOptionsHtml`, `singleDuelHtml` and `renderConnecting` are module-private. Each needs to move into its own module as `fooHtml(props): string`. |
| `deckPickerHtml()` | No | `savedDeck()` (localStorage), `acct.token()`, `dk.playableDecks()`, `defaultDeckList`, `deckMsg` | Make it `deckPickerHtml({decks, defaults, chosen, signedIn, msg})`. It is shared with the waiting room and the queue screen (passed as a dep, main.ts:12405). |
| `clockPickHtml(mode)` | No | `localStorage.algoClockMs` | Make it `clockPickHtml({mode, storedMs})`. |
| `acct.barHtml()` | Almost | module `me` | Can be driven through the exported `acct.applyMe(mock)` (account.ts:338), which repaints a no-op host when uninitialised. Better: `barHtml(me \| null)`. |
| `mm.stripHtml()` | No | module `counts`, `openGames` (no setters exported) | Refactor to `stripHtml(counts, openGames)`. The unused `signedIn` parameter can go. |
| `crp.panelHtml(fixed, extra)` | No | module `rules/open/advancedOpen/banDraft`, loaded from `localStorage.algoCustomRules` **at import** | Seed localStorage before import, or refactor to `panelHtml(state, fixed, extra)`. It writes `lastFixed` as a side effect. |
| `sc.pickerHtml()` | No | `localStorage.algoSingleCard`, module `draft`, `artHtml` → the card index | Pass `{chosen, draft}`; the art needs the card index or a stub. |
| `lg.navButtonHtml()`, `lg.homeBannerHtml()` | **No, and it fetches** | `askHint()` fires `fetch('/api/league')` on first call; module `hint`, `bannerOpen`, `howOpen` | A story would make a network call. Split into `bannerHtml(state, {open, howOpen})`; the internals (`nextText`, `joinStepsHtml`, `mineHtml`, `tableHtml`) are not exported. |
| `chal.navButtonHtml()`, `chal.homeCardHtml()` | **No, and it fetches** | `askHint()` → `/api/challenge`; module `hint`, `skew` | Same split: `homeCardHtml(current, mine, now)`. `timeLeft(closes, now)` is already pure and exported. |
| `updatesHtml(list, seen)` | **Yes, if both args are passed.** The default `seen` reads and writes localStorage. | module `olderOpen` | **Best candidate today.** Pass a list and a seen count. `rowHtml` is private but reachable. |
| Event wiring | `data-btn` is delegated through main.ts's global listener; inputs and `<details>` are wired by `addEventListener` after each paint (`wireDeckPicker`, `crp.wirePanel`, `wireSingleDuel`, `wireUpdates`, the `#h-code` Enter key, the `homeoptions` toggle) | — | Stories can show markup only, unless a story harness installs a delegating click handler. The prefix-routed `handleButton` chain lives in main.ts. |

---

## 3. Global chrome (every non-board page)

### 3.1 Legal footer — `footer#legalfoot` (legal.ts)

**Reached:** always present after `#app` (inserted by `installLegal()`, legal.ts:532-621, called at main.ts:12417). It is hidden (`foot.hidden`) while `#app.board`, synced by a MutationObserver (:614-620). Its CSS is **not in style.css**: a 68-line template string `CSS` (legal.ts:446-514) is injected as `<style id="legal-css">`. The footer also sets the "one-screenful minus 128 px" floor for every off-board page's first child (:453-459).

Layout: `.lgfootwrap`, a grid `repeat(auto-fit, minmax(300px,1fr))`, max-width 1400, two sections side by side (stacked on narrow screens): **left `.lgpitch`**, **right `.lgmeta`**.

| element | what it is/does | states | CSS (legal.ts) | file:line |
|---|---|---|---|---|
| `<h3>` | "Buy Algomancy. Please." | — | `#legalfoot h3` :466 (accent, 16px) | :424 |
| Pitch ¶1 | "This client is for playing Algomancy with somebody far away, and for teaching it to a friend in an evening. It is not a substitute for owning the game." | — | `#legalfoot p` :467 (12px dim) | :199-200 |
| Pitch ¶2 | "**Buy the box.** Algomancy is a physical game by Caleb Gannon, and buying it is what funds more of it. If you enjoy it here, that is the moment to buy it." | — | — | :201-202 |
| Pitch ¶3 | "**Or the print-and-play.** The whole game for very little money — and every copy still supports the creator." | — | — | :203-204 |
| "Buy the physical game →" | `<a class="lgbuy primary" href=shop… target=_blank rel="noopener noreferrer">` (the URL and its order are pinned by test 267) | — | `.lgbuys` :475, `.lgbuy` :476-478, `.lgbuy.primary` :479 (gold outline) | :188-189 |
| "Buy the print-and-play →" | `<a class="lgbuy">` | — | `.lgbuy` | :190-191 |
| Pitch footnote | "Both links go to Caleb Gannon's own shop. No affiliate code, no cut — nothing reaches this project." | — | `.lgdim` :480 (11.5px) | :206-207 |
| Notice | `p.lgnotice`: "An unofficial fan project, endorsed by Caleb Gannon but not affiliated with him or with Algomancy." (the `UNOFFICIAL` constant) | — | `#legalfoot .lgnotice` :468 (bold, text colour) | :428, 71-73 |
| Attribution ¶ | "Algomancy, its rules and all card art are Caleb Gannon's work, shown here so you can read your cards. There is no official client. This fan project makes no money: developed and directed by Ben Adams, coded by Claude (Anthropic's AI model)." | — | — | :429-431 |
| "📖 How to play" | `<button data-help="rules">` → help layer (duplicates the header button) | — | default `button` | :433 |
| "Algomancy Discord ↗" | `<a class="lgdiscord" href=discord.gg/… target=_blank>`, styled to look like a button | — | `.lgdiscord` :471-473 | :434 |
| "About & attribution" / "AI disclosure" / "Privacy" / "Terms" | `<button data-legal="about|ai|privacy|terms">` → the legal overlay | — | default `button` in `.lgpages` :469 | :435-438 |
| Footnote | "Free to play, no economy, no ads, no analytics — paid for by the person who runs it." | — | `.lgdim` | :440-441 |
| Background | `#0d1014` (hard-coded, not a token) + `border-top: var(--line)` | — | :461 | — |

### 3.2 Legal pages overlay — `#legalover` (legal.ts:566-605)

**Reached:** any `[data-legal]` button (footer, or the overlay's own tabs). It is created when opened and removed when closed. It closes on: the "Close" button, a click on the scrim, Escape, or a board coming up. `role="dialog" aria-label={title}`. Focus is not moved into it and is not trapped.

| element | what it is/does | states | CSS (legal.ts) | file:line |
|---|---|---|---|---|
| Scrim | `#legalover`, fixed, `rgba(6,8,11,.78)`, z 90 | — | :487-488 | :576-579 |
| Panel | `.lgpanel`, max 760 px, 92vh, only the body scrolls | — | :489-490 | :580 |
| Tabs | 4 `<button data-legal>`: "About & attribution", "AI disclosure", "Privacy", "Terms" | `.on` = accent border and text | `.lghead`, `.lgtabs`, `button.on` :491-494 | :582-583 |
| "Close" | `button.lgclose data-legal="close"` | pushed right | :495 | :584 |
| Body | `.lgbody` (scrolls) | — | :496 | :586 |
| Section headings | `<h2>` in uppercase accent 15px. About: "What this is", "And there is no official client", "Buy the game" (repeats the pitch and shop links), "Attribution", "Free, and staying free". AI: "The short version", "How it was built", "What that means for you", "Where AI runs while you play". Privacy: "The short version", "Your password, and the fact that it cannot be reset", "What the server keeps about you", "What that comes to on disk", "The rules judge — the one thing that leaves this server", "Your IP address", "What other players can see", "What your browser keeps", "Deleting it". Terms: "It is free, and it makes no money", "It is not official", "It is provided as it is", "Behave", "It can change". | — | `#legalover h2` :497-499 | about :219-258, ai :363-407, privacy :260-324, terms :326-359 |
| Callout paragraphs | `p.lgloud`: panel2 background, 3 px accent left bar | — | :502-503 | e.g. :228, 263, 275, 329, 366 |
| Storage lists | `ul.lgstore` > `li` (a 190 px grid): `div.lgkeys` of `<code>` field names + `<span>` prose. Generated from STORED_ACCOUNT / SESSION / GAME / FILES / BROWSER_KEYS (20 rows of localStorage keys). The guard test parses the server's source against them. | collapses to one column ≤620 px | :504-513 | :211-217, data :94-180 |
| Body links | shop links inline in Terms | — | `#legalover a` :501 | :338-340 |

### 3.3 Report pill and dialog — `#reportlayer` (report.ts)

**Reached:** the pill on every non-board page; the board's rail button (`reportopen`, main.ts:11175-11181) on the board; and "Dispute game" from the post-game screen (`openDispute`). Escape or a scrim click cancels. The draft, kind and severity are kept on cancel. Installed at main.ts:12420.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Pill | `button.reportfab data-report="open"` "📝 Report", fixed bottom-right 18 px, z 55 | hidden on the board and while the dialog is open. It moves aside when the binder is docked (`html.binderup` rules :2881-2891, 2972-2981). It gets no larger target on touch. | `.reportfab` :1293-1294 | report.ts:210-211 |
| Scrim | `div.reportscrim#reportscrim` rgba(6,8,11,.72), z 70 | — | :1291-1292 | :188 |
| Box | `div.overlaybox.reportbox role=dialog aria-label="Report"` | — | `.overlaybox` :893-895 (accent border), `.reportbox` :1330 | :188 |
| `<h3>` | "📝 Report" / dispute: "Dispute game" | — | `.overlaybox h3` | :189, 171 |
| Context hint | `div.hint`: "Filed with this exact moment of the game, so a bug can be replayed." (in a game or solo room) / "Filed with the page you are on." + "Filed as **{user}**." / "Filed anonymously — sign in for it to carry your name." Dispute: "Filed with the final board. The result stands until someone reviews it. …" | `.hint` is **not styled inside `.overlaybox`** | (none) | :185-190, 153-158, 172 |
| "What is it?" | `div.reportlabel` + `div.reportchoices role=radiogroup`: buttons **Bug / UX / UI issue / Feature request / Other** (`role=radio aria-checked`, title = the explanation) | `.on` = green ring and fill; disabled while sending | `.reportfield` :1333, `.reportlabel` :1334, `.reportchoices` :1338-1341 | :191-194, 162-166, labels :35-40 |
| "How bad is it?" | **Minor / Medium / Game breaking** radios | only for Bug and UX. "Game breaking" when on is red. | same | :195-198, :41-45 |
| Note | `<textarea id="report-note" rows=4>`. The placeholder follows the kind: "Pick a type above, then say what happened" / "What happened, and what did you expect instead?" / "What was confusing, awkward or hard to see?" / "What would you like the client to do, and why?" / "What is it?". Dispute: "What went wrong?" | focused on open with the caret at the end; disabled while sending | `.reportbox textarea` :1331 | :199, 50-55, 173 |
| Button row | `div.judgerow` (the class is borrowed from the judge box): "Cancel (esc)" (the `span.kh` hint is hidden on touch) · `span.reporthint` "Ctrl+Enter sends" (only once a kind is picked) · `button.primary` "Send report" / "Send dispute" / "sending…" | Send is disabled until the form is complete or while busy | `.judgerow` :1081, `.reportbox .judgerow` :1342, `.reporthint` :1343, `.kh` hidden on touch :4017 | :200-204, 174-178 |
| Error | `div.reporterror`: "the report was not accepted" / "could not reach the server to file the report" / "not connected to the game — try again in a moment" / "the dispute was not accepted" | — | `.reporterror` :1295 (red) | :205, 179 |
| Toast | `div.toast` "logged — thanks" / "logged — thanks, we can replay this exact moment" / "dispute sent — thanks", up for 4 s | its own copy of a toast timer (report.ts:235-239) | `.toast` :1368-1371 (green, z 90) | :217, 320, 270 |

Isolatability: `dialogHtml`/`disputeDialogHtml`/`pillHtml` are private and read module state (`kind`, `severity`, `busy`, `error`, `ctx`) plus `acct.currentUser()`. Only `pageOf()` is exported and pure. A story needs a `reportDialogHtml(state, user)` export.

### 3.4 Help layer — `#helplayer` (helplayer.ts) with the box from rules.ts

**Reached:** any `[data-help]` ("📖 How to play" in the header and the footer); URLs `?rules`, `?rules=book`, `?rules=cr&at=608.2b`, `?rules=tutorial` (main.ts:12749-12751). It never opens over a board, where the board's own `.overlay` slot shows the same box. Escape or a scrim click closes it (Escape in a non-empty search box clears the query first).

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Scrim | `div.helpscrim#helpscrim` rgba(6,8,11,.72), z 80 (deliberately not `.overlay`, test 269) | — | :1047-1048 | helplayer.ts:35 |
| Box | `div.overlaybox.helpbox` 800 px / 88vh | — | :1012-1013 | rules.ts:774 |
| Title `<h3>` | "Rules reference" / "The rulebook" / "The comprehensive rules" / "How to use the interface" | per tab | `.helphead` :1021 | rules.ts:776, 690-695 |
| Tabs | `button.helptab[.on] data-btn="helptab" data-tab`: "Rules", "Rulebook", "Comprehensive rules", "How to use the interface" | `.on`: accent and bold; off: opacity .75 | `.helptabs/.helptab` :1022-1024 | rules.ts:765-766, 777 |
| Search | `<input id="rules-q" class="rulesq" type=search>` "search the rules…" / "search the guide…" (Rules and Interface tabs). Focused on open. | — | `.rulesq` :1025-1027 | rules.ts:770-771 |
| Jump bar | `div.rulesjump` of `button[data-btn=helpjump]`, one per section | — | :1028-1029 | rules.ts:724-728 |
| List | `div.helpscroll#rules-list`: `section.rulesec` > `h4` + `p.rulesblurb` + `div.helprow` (`<b>` title + `<span>` body) | empty: `div.helpempty` "Nothing in the rules matches "x"." | :1014-1018, 1030-1034, `.helpempty` :1041 | rules.ts:706-719 |
| Rulebook tab | blurb "The Algomancy Manual — the complete illustrated rulebook. It can take a moment to load." + `a.bookopen` "Open the rulebook in a new tab ↗" + `<iframe class="bookframe">` (62vh, **white** background) + "In a game, the ⚖ judge button answers rules questions." | — | `.bookbar` :1050-1054, `.bookframe` :1055 | rules.ts:734-743 |
| CR tab | blurb + "Open the comprehensive rules in a new tab ↗" + "Ask the players on Discord ↗" + iframe | — | same | rules.ts:749-759 |
| "Close" | `button data-btn="helpclose"` | — | `.overlaybox > button` :928 (aligned right) | rules.ts:780 |

Isolatability: `rulesBoxHtml(tab, q)` is exported and pure, apart from the module `crAt` on the CR tab. It is a good story target.

### 3.5 Bell, notifications list, invite popups — `#inboxlayer` (inbox.ts)

**Reached:** shown **only when signed in**, not on a board, and not on a "quiet" page (connecting, replay, solo; `quiet` dep, main.ts:12430). It polls `/api/inbox` every 8 s (4 s in a waiting room, 30 s when the tab is hidden) with a single 1 s `setInterval` tick (inbox.ts:258-297). Installed at main.ts:12426-12442. A click anywhere outside closes the list.

| element | what it is/does | states & variants | CSS | file:line |
|---|---|---|---|---|
| Bell | `button.inboxbell[.lit] data-inbox="bell" title="notifications"` "🔔" + `span.inboxcount` N | `.lit` (accent border) and a red count badge when there is unread news. The badge count is not announced to screen readers. Fixed at `right:124px`, a magic number that assumes the Report pill's width. | `.inboxbell` :1300-1302, `.inboxcount` :1303-1304 (`#fff` on red) | inbox.ts:251 |
| List panel | `div.inboxlist`: `div.zonelabel` "Notifications", optional `p.inboxdone` (e.g. "✓ You're playing **X** Sat 8 Nov, 19:00." or the error text), rows, or `p.hint` "Nothing new." | not a dialog or menu role; scrolls at 60vh | `.inboxlist` :1305-1310, `.inboxdone` :1329 | :223-241 |
| Invite card | `div.invitecard`: "**{from}** invites you to {label}." + `button.primary` "Join" + "No thanks" | in the popup version, an ✕ (`button.invx title="keep it in the bell"`) | `.invitecard` :1311, `.invbtns` :1314-1315, `.invx` :1316 | :188-197 |
| Time-ask card | "**X** suggests playing your {season} match **Sat 8 Nov, 19:00** (your time)." + "Accept" (primary) + "Suggest another" | — | same | :199-208 |
| Friend request | "**X** wants to be friends." + "Accept" (primary) + "Decline" | — | same | :227-233 |
| League notes | `div.zonelabel` "League" + `div.invitecard.leaguenote[.unread]` (text from leaguenotes.ts `noteLine`) + "Play" (primary) or "League page" | `.unread`: accent left bar | `.leaguenote.unread` :1328 | :210-221, 234 |
| Popups | `div.invitepops`: unread invites and match-soon reminders as cards with ✕, fixed above the bell | hidden while the list is open; dismissals saved in `sessionStorage.algoInboxSeen`. Each new item plays the "decision" sound and flashes the tab title. | `.invitepops .invitecard` :1313 | :247-253, 310-320 |
| Room friends panel | (painted into the waiting room by main.ts and lobby.ts, so outside my scope) `roomFriendsHtml` | — | :1318-1325 | :173-177 |

Isolatability: every `*Html` here is private and reads module arrays. A story would need these exported: `inviteCardHtml(i, pop)`, `timeAskHtml(t, tz)`, `noteHtml(n, pop)`, `listHtml(state)`, `bellHtml(n)`.

### 3.6 Toasts (four systems)

| system | where | look | timing | file:line |
|---|---|---|---|---|
| main.ts `showToast` → `.toast` | **board only** (painted inside `renderNow`). Off the board a call sets `toastMsg`, but nothing paints it until a board render. | green bar, bottom centre, z 90; lifted to 178 px in `.netmode` | 4 s | main.ts:3146-3152, 7972; css :1368-1371 |
| report.ts toast → `.toast` | inside `#reportlayer`, any page | same `.toast` class | 4 s, own timer | report.ts:235-239 |
| toast.ts cost toasts → `.costtoasts` | board only: "⚠ this did nothing" + the engine sentence + "×N", max 4 rows, then "+N more — all of it is in the log". The whole strip dismisses on click (`data-btn="costtoastclose" title="nothing here can be undone — click to dismiss"`). | bottom-left, red left bar, z 61 | paced by flash.ts | toast.ts:267-277; css :3328-3349 |
| crlayer `.crtoast` | the CR review page (out of scope) | bottom centre, z 80 | — | css :5221-5225 |

`costToastHtml(live, now)` is exported and pure, so it is story-ready.

### 3.7 Learn to Play menu — `#learnmenu` (learnmenu.ts)

**Reached:** "Learn to play" on the home Join card (`data-learn="menu"`), `?learn`. It closes on ✕, a scrim click, or Escape. It blocks every key while open.

| element | what it is/does | states | CSS | file:line |
|---|---|---|---|---|
| Scrim | `div.learnscrim#learnscrim` rgba(6,8,11,.62), z 76 | — | :3524-3525 | learnmenu.ts:26 |
| Box | `div.learnbox role=dialog aria-label="Learn to play"` (600 px, accent border, its own copy of the overlaybox look) | — | :3526-3529 | :26 |
| Header | `div.lhead`: `<h3>` "📘 Learn to play" + `<button data-lmenu="close">` "✕" (no aria-label) | — | `.lhead` :3530-3533 | :27 |
| Blurb | "A real game, with a lesson at each new moment. About twenty minutes." | — | `.learnblurb` :3588 | :28 |
| Label | "Play one element" | — | `.learnlabel` :3589 | :29 |
| Element buttons | `button.learnel.el-{e}[.on] data-lmenu="el"` with icon + capitalised name (capitalised in JS here, by CSS for `.elchip`) | `.on`: accent | `.learnels/.learnel` :3590-3592 | :21-22 |
| Primary | `button.lprimary` "Start the {el} game" / "Continue your {el} game" + "Start over" | saved game vs none | `.lprimary` :3581 (uses `!important`) | :31-35 |
| "Read a lesson" `<details>` | `<ol>` of `button.learnread` "N. Title" + "✓" (`span.learnseen`) for lessons already read | — | `.learnlist/.learnread/.learnseen` :3595-3599 | :25, 36 |

Isolatability: `menuHtml(progress, el)` is exported and pure, so it is story-ready.

### 3.8 Tab alert (tabalert.ts)

There is no visible element: it changes `document.title` to "{message} — Algomancy" ↔ "Algomancy" once a second, **only while the tab is hidden**, and stops on `visibilitychange`/`focus`. Messages: "Match found!" (queue.ts:284), "Your game has started" (main.ts:800), "{X} invited you" / "{X} suggests a time" / "Your league match is soon" (inbox.ts:311-319), plus the board's decision cues. `flashTitle()` is pure (tabalert.ts:25-27).

### 3.9 Info tip — `#infotip` (infotip.ts)

A board-only hover/tap window (fixed, z 89, `aria-hidden="true"`, pointer-inert): player pile counts (`countsTipHtml`, a `tiphead` + `table.tiptab` with hand / deck / recycle pile / bin / cache / pack + `tipfoot`) and toolbar tips. Mouse: hover. Touch: tap to pin (`data-btn="infotip"`). It never appears off the board. CSS :4772-4793. `countsTipHtml` and the placement maths (`besideBox`, `cornerBox`) are pure and exported. Because it is `aria-hidden`, screen-reader users never get its content.

### 3.10 Connecting / error / kicked / reconnect notices (main.ts)

| element | what it is/does | trigger | CSS | file:line |
|---|---|---|---|---|
| Connecting screen | `div.joinscreen`: `<h2>` "Algomancy" + `<p>` "Connecting to the server…" | any `?room=`, `?learn=play`, `?challenge=play/watch`, `?replay=`, `?question=` page before the first `joined` (the same text appears for in-browser solo rooms and replays, where no server is involved) | `.joinscreen` :348-355 (420 px box, 60 px from the top) | main.ts:9173-9182; callers 12558-12708; renderNow 7897 |
| Error variant | `<p class="joinerr">{uiError}</p>` + `button.primary data-btn="gohome"` "← Back to the home screen". Texts: "disconnected from the server — reconnecting in 2s…" (main.ts:426), "The server sent a game with nothing in it. Reload the page to try again." (:792, 965), "no replay for CODE — either it is not a game you played, or there is no such game" (:12650), "this game cannot be replayed in the browser: …" (:12675), "that run cannot be watched" (:12619), "There is no rules question at that link. It may have been renamed or answered." (:12699), and server refusals such as "no such room" (:909) | `uiError` set while not yet joined. The error `<p>` has no `role=alert`. | `.joinerr` :1746 (red, 15px) | 9180-9181 |
| Kicked notice | `div.joinscreen`: `<h2>` "Algomancy" + `<p>` "{msg}" / "another connection took over this seat" + `<button data-btn="gohome">` **"home"** (lowercase, not primary) | server `kicked` message; reconnecting stops | `.joinscreen` | main.ts:880-886 |
| Reconnect after a deploy | **No visible notice.** A reconnect that lands on a new server `boot` id calls `location.reload()` silently (main.ts:768-771). The CLAUDE.md "page reloads itself" is this. | `boot` changed | — | main.ts:354-360, 768-771 |
| In-game disconnect | after joining, `uiError` "disconnected from the server — reconnecting in Ns…" is painted by the board (board reader's scope) | socket close | — | main.ts:422-432 |

Isolatability: `renderConnecting()` is a private writer that reads the module `uiError`. It should become `connectingHtml(error: string \| null)`. The kicked markup is inlined in `NetBackend.onMsg`.

### 3.11 Z-index map of the chrome (useful for a redesign)

| z | thing |
|---|---|
| 50 | binder panel |
| 55 | `.reportfab`, `.inboxbell` |
| 56 | `.inboxlist`, `.invitepops` |
| 60 | board `.overlay`, `.glimpsenotice` |
| 61 | `.costtoasts` |
| 66 / 69 | amend bar / amend scrim |
| 70 | `.reportscrim` |
| 72 / 75 | CR scrim / CR chip |
| 76 | `.learnscrim`, `.lessonscrim` |
| 80 | `.helpscrim`, `.crtoast` |
| 89 | `#infotip` |
| 90 | `.toast`, `#legalover` (a tie) |

---

## 4. Design smells (concrete)

**S1. A CSS class collision, very likely a live bug.** `.crchip` is defined twice for two unrelated components: the Custom-rules ban chip (`style.css:2011`, `customrulespanel.ts:149`) and the CR-review floating "💬 Comment" chip (`style.css:5248-5249`: `position: fixed; z-index: 75; padding: 4px 10px; border-color: var(--accent); box-shadow…`). The later rule is unscoped, so the ban chips on the home page should come out `position:fixed`, out of flow and stacked on top of each other. Needs a visual check; the fix is a rename.

**S2. Five different "primary" button looks.**
- `button.primary`: green fill `#3c5a2f`, green border (style.css:50).
- `.homecard .cta.primary` / `.queuestrip .qstripgo`: the same green fill with a **gold** border and text (:468, :3407). The green comes from the base rule; the override only sets border and text.
- `.lgbhead .cta.primary` (the league banner's "Sign up"): plain green, because `.cta.primary` is only styled inside `.homecard`/`.chplayrow`.
- `.lprimary` (Learn menu): gold border with `!important`, no fill (:3581).
- `.qopenjoin`: **solid gold fill with `#fff` text** (about 2:1 contrast; its fallback colour is Discord's `#5865F2`, :3465-3468).
- `.lgbuy.primary` (footer): a gold outline link.

Meanwhile "Start with …", "New single card duel" and "Join" are plain buttons. `.cta` means nothing on its own.

**S3. `.hint` and `.dim` are not utility classes.** Neither has a global rule; each only works inside a parent that defines it (`.joinscreen .hint`, `.lgbbody .dim`, …). On the home page `div.hint` "loading your decks…" (main.ts:9224), `span.dim` "no card by that name" (customrulespanel.ts:100, singlecard.ts:49), `#cr-querynote.dim`, `.scname .dim` "× 30" and the report dialog's `.hint` all render in **full-strength body text**.

**S4. One error/message style for everything.** `.deckmsg` (gold) carries success ("loaded X"), progress ("importing…") and errors ("not playable: …", "could not reach the server"). `uiError` from *any* home action is printed in the **Live draft** card (main.ts:9405), even when the Constructed button failed. Elsewhere errors are red (`.joinerr`, `.reporterror`, `.qerr`, `.crbad`).

**S5. Background repaints wipe uncontrolled inputs.** `renderHome()` rebuilds `#app` whenever the queue poll's counts change (queue.ts:208), the league or challenge hint arrives, `/api/me` returns, or the default decks load. `#h-name`, `#h-code`, `#h-deckurl`, `#h-decktext` and the open state of the paste `<details>` and the fixed-trio `<details>` are **not** kept across a repaint. Only the Custom rules, Single Card Duel, Options and Older updates disclosures, and the two type-ahead boxes, keep their state.

**S6. Render functions with side effects.** `lg.navButtonHtml()`, `lg.homeBannerHtml()`, `chal.navButtonHtml()` and `chal.homeCardHtml()` each call `askHint()`, which fires a `fetch` (league.ts:170-183, challenge.ts:156-170). A string builder that does network I/O cannot go into Storybook unchanged.

**S7. No loading states for the signed-in identity, so the page flashes the wrong state.** With a token but no `/api/me` answer yet, the header shows "Playing signed out — nothing is recorded." + "Log in / Sign up" + the name box, while the deck picker (which reads `acct.token()`) says "loading your decks…". The League and Challenge buttons, the banner and the challenge card pop in later with no placeholder, which shifts the layout.

**S8. Emoji as the icon system, mixed with real art.**
- Emoji: 🗂 📖 🔍 🏆 🏅 🧩 (header), 🎲 ⏱ 🌱 (draft card), ☑/☐ (a text-glyph checkbox, customrulespanel.ts:147), 🔥 (streak), 📝 (Report), 🔔 (bell), 📘 (Learn), ✓ ✕ ✅ ↗ → ←.
- Real art: the element icons and the ⚔ battle icon are game webps.
- 🏆 means both "Metagame" and "league champion"; 🏅 means both "League" and "participant trophy".
- Inline `onerror` handlers stand in for a fallback (queue.ts:405, util.ts:14).

**S9. Styles living outside style.css, and inline styles.**
- legal.ts injects 68 lines of CSS from a JS string (legal.ts:446-514), including hard-coded `#0d1014` and `rgba(6,8,11,.78)`.
- `style="text-transform:uppercase"` on the room-code input (main.ts:9426).

**S10. Hard-coded colours that should be tokens.**
- Card and strip borders: `#3b4654` (`.homecard.offer` :463, `.queuestrip` :3400).
- Green family: `#3c5a2f`/`#5b8747` (`button.primary`), `#1d2b1a` (`.toast`, `.reportchoices .on`).
- Element chip faces: `#2e2a20`, `#262c35`, `#cfd6e0` (`.elchip.light/.dark.on`).
- Update and queue rows: `#6fa8e0` (`.upd.change`), `rgba(217,164,65,.05/.1)` (the accent re-typed as rgba, :492, 497), `rgba(255,255,255,.04/.08)` (`.qopenrow`).
- Badges: `#fff` (`.inboxcount`, `.qopenjoin`).
- Scrim alphas `.55/.62/.72/.78` across six scrims.
- Box shadows `0 4px 18px .45`, `0 8px 28px .55`, `0 12px 40px .55`, `0 10px 30px .6`, `0 5px 20px .5`, with no shadow scale.

**S11. No type, spacing or radius scale.**
- Font sizes on these surfaces: 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17, 30 px.
- `.qopen*` alone switches to `rem`/`em` (:3456-3468).
- Radii: 3, 4, 5, 6, 7, 8, 10, 12, 15, 999.
- Page paddings: `.homepage` 30/22/44, `.updates` 6/22/40, `#legalfoot` 26/22/34.

**S12. Misnamed and reused classes.**
- `.homedecks` is the style for *every* header nav button, and it lives in the decks section (style.css:2570); its `margin-top:6px` nudges them off the centre line of the account bar.
- `.fixedtrio` styles the Options and Single Card Duel disclosures, which have nothing to do with trios; `.customrules` repeats the same four rules.
- `.elchip` styles the clock picker.
- `.judgerow` lays out the report dialog's buttons.
- `.joinscreen` is the connecting, kicked, sign-in and queue screen.
- `.homebtns` is the sign-in form's stack.
- `.homefoot` is reused in the waiting rooms.
- The `.offer` modifier also exists as `.card .badge.offer`.

**S13. Inconsistent labels and capitalisation.**
- Ways home: "← Back to the home screen" (connecting), **"home"** (kicked, lowercase, plain), "← home" (queue), "Leave" (waiting room), "Home" (Learn).
- Deck management: "🗂 My decks" vs "My decks →" (the same action twice on one screen).
- The same algomancer.cc link reads "algomancer.cc" or "view on algomancer.cc".
- Disabled button labels switch to lowercase prompts: "pick a card first", "pick 3 of the 7 (2/3)", "choose a deck…".
- Error copy mixes lowercase fragments ("could not reach the server") and full sentences ("The server sent a game with nothing in it. Reload the page to try again.").
- Signed out, the name box allows 24 characters (main.ts:9373); the sign-up username allows 20 (account.ts:399).
- Wordmark: "ALGOMANCY" (`h1.homelogo`) on home, "Algomancy" (`h2`) on the connecting screen.

**S14. Layout gaps.**
- The 4th home card (the challenge) wraps onto a row of its own at one third of the width.
- `.homegrid`'s `minmax(302px,1fr)` plus 44 px of page padding is 346 px, so a 320 px phone scrolls sideways. There is no phone layout for `.homehead`, which just wraps.
- On the Constructed card, the Single Card Duel disclosure sits *below* the card's primary CTA (main.ts:9416-9418).
- `.reportfab` and `.inboxbell` are fixed over the bottom-right of the content and the footer, and the bell's `right:124px` is a magic number.
- The Older-updates list puts 236 hidden `<li>` into the DOM on every home repaint.

**S15. Accessibility.**
- No `aria-pressed` on the toggle chips (`.elchip` elements and clock); state is outline or opacity only.
- `.crknob` −/+ have `aria-label="fewer"/"more"` without the knob's name.
- 🎲 and the Learn ✕ have no aria-label (title only, or nothing).
- The bell's unread count is not announced.
- Colour is the only state cue for `.qstripcount.live`, `.crknob.changed`, `.lgbdates .now/.past` and `.lgbrows li.mine`.
- The legal overlay, the help and Learn layers and the bell list never move or trap focus (only the report dialog focuses its textarea; help focuses its search). The bell list has no dialog or menu role.
- No `:focus-visible` style anywhere on these surfaces; the browser default ring applies, and inputs have no custom focus ring.
- Error lines are not `role=alert` or `aria-live`.
- `#infotip` is `aria-hidden`.
- Touch: `html.touch` enlarges only board buttons (style.css:4021-4022). The home CTAs, the 20px-line-height `.crknob` steppers, the elchips, the pill and the bell get no larger targets.

**S16. Missing states.**
- Silent reload after a deploy (main.ts:770).
- No "can't reach the server" state for the matchmaking strip: it keeps the last number, or "checking…" for ever when offline.
- The league and challenge fetch failures render nothing at all.
- An empty room code is ignored with no message.
- The challenge countdown and the queue wait times are frozen between repaints.
- "Connecting to the server…" is shown for local solo rooms and replays too.

---

## 5. Storybook summary for this area

**Story-ready today (exported, pure or nearly):**
- `updatesHtml(list, seen)`
- `footHtml()`, `shopLinksHtml()` (they need the `CSS` string from legal.ts, which is not exported)
- `rulesBoxHtml(tab, q)`
- `menuHtml(progress, el)` (Learn)
- `costToastHtml(live, now)`
- `countsTipHtml(c)`
- `badgeChipsHtml`, `trophyChipHtml(s)`
- `countsSummary`, `waitLabel`, `timeLeft`, `flashTitle`, `pageOf`

**Needs an args signature (reads module state):**
- `acct.barHtml` → `(me)`
- `mm.stripHtml` → `(counts, openGames)`
- `crp.panelHtml` → `(rules, ui, fixed, extra)`
- `sc.pickerHtml` → `(chosen, draft)`
- report `dialogHtml` → `(state, user)`
- inbox card builders → `(item, opts)`

**Needs moving out of main.ts first:**
- `renderHome` → `homeHtml(props)` composed of `homeHeaderHtml`, `liveDraftCardHtml`, `constructedCardHtml`, `joinCardHtml`
- `deckPickerHtml`, `clockPickHtml`, `constructedOptionsHtml`, `singleDuelHtml`
- `renderConnecting` → `connectingHtml(error)`
- the kicked notice

Importing main.ts boots the app.

**Needs its fetch split from its markup:** `lg.navButtonHtml`, `lg.homeBannerHtml`, `chal.navButtonHtml`, `chal.homeCardHtml`.

**Interaction in a story:** clicks route through main.ts's `handleButton` prefix chain (`data-btn`) and through capture-phase layer listeners (`data-legal`, `data-report`, `data-inbox`, `data-help`, `data-learn`, `data-lmenu`). Inputs and `<details>` are wired by `addEventListener` after each paint. Stories can render static markup, or a harness can mount a delegating click handler and re-render a story's args.
