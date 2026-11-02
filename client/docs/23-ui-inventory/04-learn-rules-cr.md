# 04 — How to Play · Learn to Play · Comprehensive Rules · Judge · Testers

Reader 4 of 7. Read-only inventory of `client/ui/` (all paths below are relative to
`/home/bena/Documents/Algomancy/client/ui/` unless stated). Line numbers are as of master `ba32fcf4`.

Covered surfaces:

| # | surface | how it is reached | renderer |
|---|---|---|---|
| A | **"How to play" box** (4 tabs: Rules · Rulebook · Comprehensive rules · How to use the interface) | home `📖 How to play` (main.ts:9376), footer `📖 How to play` (legal.ts:433), `?rules`, `?rules=book`, `?rules=cr[&at=608.2b]`, `?rules=tutorial` (main.ts:12750-12753); in a game the toolbar `?` (main.ts:7373) | `rulesBoxHtml()` rules.ts:764; off-board shell helplayer.ts:34; on-board shell `helpOverlayHtml()` main.ts:5015 |
| B | **Learn to Play menu** | home "On your own" → `Learn to play` (main.ts:9433), `?learn` (main.ts:12752), in a learn game the toolbar `📘` (main.ts:7363) | `menuHtml()` learnmenu.ts:19 |
| C | **Lesson window** (+ minimised pill, card preview, board highlights) | automatically during `?learn=play` (lessonTick, main.ts:8290); from menu "Read a lesson" | `windowHtml()` lessonlayer.ts:186, `pageHtml()` :155, `figureHtml()` :80, `pillHtml()` :222 |
| D | **Judge box** (in-game only) | toolbar `⚖` (main.ts:7372), inspector `⚖ Ask the judge about X` (main.ts:5144), card right-click menu (main.ts:12314) | `judgeOverlayHtml()` main.ts:5165 |
| E | **Rules review page** (the CR with comments) | `?crreview=1` (+`&at=`, `&c=`, or tab name as value), profile `📜 Rules review` for owner/judge badges (account.ts:520), judge answer source links (main.ts:5159) | `paint()` crreview.ts:674, plus crlayer.ts / crsearch.ts |
| F | **Public CR page** (`/comprehensive-rules`) | iframe in tab A4, "Open … in a new tab ↗" | server serves the generated `data/comprehensive-rules/Algomancy-Comprehensive-Rules.html` (server/main.ts:1204) — NOT ui code |
| G | **Rules question board panel** | `?question=<id>` (main.ts:12687), CR review `❓ Questions` list | `questionHtml()` replaybar.ts:209 (the rest of the replay bar is another reader's) |
| H | **Scenario tester panel** (🧪) | only in a server-dealt scenario room; toolbar `🧪` (main.ts:7366) | `panelHtml()` scenario.ts:119, slot main.ts:7395 |
| I | **Test mode (sandbox) panel** + home launcher | home "On your own" → `Test mode` (injected by sandbox.ts:409); the panel appears in a sandbox room | `panelHtml()` sandbox.ts:166 |
| — | markdown.ts / glossary.ts (as shown) | used by A, C, D | `mdToHtml()` markdown.ts:82 |

---

## A. The "How to play" box — `rules.ts`, `tutorial.ts`, `helplayer.ts`

### A.0 Two shells, one box

The same box (`rulesBoxHtml`) is drawn in two different containers:

| shell | where | scrim class | z-index | who handles clicks | file:line |
|---|---|---|---|---|---|
| **Off-board layer** | `<div id="helplayer">` appended to `<body>` once | `.helpscrim` (fixed, inset 0, rgba(6,8,11,.72), centred flex) | 80 | helplayer.ts capture listener: `data-help` opens; `helpclose`/`helptab`/`helpjump`; scrim click closes | helplayer.ts:36, 66-85; style.css:1047 |
| **On-board overlay** | inside `#app` on every board paint when `helpOpen` | `.overlay.mainonly` (fixed, rgba .72, z 60; right edge stops at the 50px toolbar on the regions board) | 60 | main.ts global `data-btn` handlers `helpopen/helpclose/helptab/helpjump` (main.ts:11133-11138); Escape via `closeTopOverlay()` main.ts:12013 | main.ts:5015-5017, 7964; style.css:891, 959-962 |

Off-board it auto-closes when a board comes up (MutationObserver on `#app.class`, helplayer.ts:99-102) and swallows every keydown while open except typing (helplayer.ts:91-97).

### A.1 Layout (both shells)

```
.overlaybox.helpbox  (panel bg, 1px gold border, r10, 18x22 pad, flex column gap 12, width min(94vw,800px), max-h 88vh)
 ├ .helphead  (flex, space-between, wrap)
 │   ├ <h3> tab title (gold)
 │   └ .helptabs → 4 × button.helptab
 ├ [Rules / Interface tabs]  input#rules-q.rulesq  → .rulesjump (chips) → .helpscroll#rules-list (sections)
 │ [Rulebook / CR tabs]      .helpscroll.bookscroll → blurb, .bookbar (2 links), iframe.bookframe, (blurb)
 └ <button data-btn="helpclose">Close</button>   (bottom-right via .overlaybox > button {align-self:flex-end})
```

### A.2 Element table — shell & tabs

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Opener: home button | `📖 How to play` | always on home | `.homedecks` | main.ts:9376 |
| Opener: footer button | `📖 How to play` | every non-board page (legal footer layer) | (footer styles) | legal.ts:433 |
| Opener: toolbar `?` | on the board, opens on-board copy | title "rules: the rules reference and the interface guide" | toolbar button | main.ts:7373 |
| Opener: deep links | `?rules`, `?rules=book`, `?rules=cr&at=608.2b`, `?rules=tutorial` | `at` validated `/^r?\d{3}(\.\d+[a-z]?)?$/i` | — | main.ts:12750-12753; rules.ts:796 |
| Scrim (off-board) | click closes | — | `.helpscrim` `#helpscrim` | helplayer.ts:36, 77 |
| Box | the dialog | **no `role="dialog"`, no `aria-modal`, no aria-label** | `.overlaybox.helpbox` | rules.ts:774 |
| Title `<h3>` | `Rules reference` / `The rulebook` / `The comprehensive rules` / `How to use the interface` | changes with tab | `.overlaybox h3` (gold, default h3 size) | rules.ts:690-695, 776 |
| Tab buttons ×4 | `Rules` · `Rulebook` · `Comprehensive rules` · `How to use the interface` | `.on` = gold border + gold text + bold; off = opacity .75. No `role=tab`/`aria-selected` | `.helptab`, `.helptab.on` (12px, 4x10 pad) | rules.ts:765-766, 777; style.css:1022-1024 |
| Close | `Close` text button, bottom-right | Escape also closes; on Rules tab Escape first clears a non-empty query | base `button` | rules.ts:780; helplayer.ts:94-96; rules.ts:842-850 |

### A.3 Tab "Rules" — the rules reference

Content = `RULES_SECTIONS` (rules.ts:647): **Turn structure · Icons · Attributes · Terms · Combat · The stack and priority · Resources · Drafting and formats · Modifications · Cards and effects** — 10 sections, ~80 entries. Attributes are derived from `KEYWORDS` (glossary.ts:898) with the printed reminder, else the Manual's, else the card-library's, else the authored text (rules.ts:251-264).

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Search box | `<input type=search id=rules-q>`; placeholder `search the rules…`; autofocused on open (`focusRulesSearch`, setTimeout 0) | filters live (delegated `input` listener on document); Esc clears query then closes. **No `<label>`/aria-label** | `.rulesq` (bg --bg, 1px --line, r7, 8x11 pad; focus = gold border, `outline:none`). Note `font: 14px/1.4 inherit` is an **invalid shorthand** → dropped | rules.ts:770-771, 830-851; style.css:1025-1027 |
| Search algorithm | every word must match title/body/detail/alt; crude English stemmer | pure | — | rules.ts:653-684 |
| Jump bar | one chip per visible section; scrolls section into view | shrinks with results; removed when nothing matches; re-rendered by outerHTML swap | `.rulesjump` + `button` (11px, 2x8) | rules.ts:724-729, 836-840; style.css:1028-1029 |
| Scroll list | the sections | patched in place (`#rules-list` innerHTML) on search | `.helpscroll` (overflow-y auto) | rules.ts:773, 802-806 |
| Section | `<section id="rs-<id>">` | first section's h4 margin-top 2px | `.rulesec` | rules.ts:710-714 |
| Section heading | `<h4>` e.g. `TURN STRUCTURE` | uppercase 12px gold letter-spaced | `.helpscroll h4` | style.css:1015, 1030-1031 |
| Section blurb | one line under heading (Turn, Icons, Attributes, Terms only) | iconized | `.rulesblurb` (dim 12px) | rules.ts:712; style.css:1032 |
| Entry row | 2-col: bold title (170px) + body | <700px stacks to one column | `.helprow` (dotted bottom border **#232a33 hard-coded**), `.helpbox .helprow b {width:170px}` | rules.ts:698-708; style.css:1016-1018, 1033-1035, 1057-1060 |
| Entry icons | game glyph images before title (battle, haste, augment, graft, bounded_graft, virus, once, cost_3, 5 elements, light/dark) | — | `img.txticon` (15px; -3px baseline) | rules.ts:699; style.css:1039, 1109, 1155 |
| Inline game markup | `{Haste}`, `[Augment]` etc. in titles/bodies drawn as icons | — | `.txticon` via `iconizeText` (cardtext.ts) | rules.ts:701-707 |
| Numbered steps | phase steps as `<ol>` | only array bodies (the 3 turn entries) | `.helprow ol` | rules.ts:700-701; style.css:1037-1038 |
| Detail line | "the fuller statement" under body (attributes with an authored `rule`) | smaller, opacity .8 | `.helpdetail` | rules.ts:706; style.css:1036 |
| Source | `source` field exists on every entry but is **not drawn** (owner 2026-09-05) | — | `.rulesrc` exists in CSS but is **dead** | rules.ts:703-705; style.css:1040 |
| Empty state | `Nothing in the rules matches “q”.` | — | `.helpempty` (dim, 14px pad) | rules.ts:719; style.css:1041 |

### A.4 Tab "Rulebook"

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Blurb | `The Algomancy Manual — the complete illustrated rulebook. It can take a moment to load.` | static; **no actual loading state** for the iframe | `.rulesblurb` | rules.ts:736 |
| Link bar | `Open the rulebook in a new tab ↗` (primary-looking) · `Ask the players on Discord ↗` | — | `.bookbar a`, `.bookopen` (gold) | rules.ts:737-740; style.css:1051-1055 |
| PDF frame | `<iframe src="/data/rules/Algomancy-Manual.pdf">` 62vh | iOS/phones render 1st page only (acknowledged in comment); **white `#fff` background hard-coded** | `.bookframe` | rules.ts:741; style.css:1056; assets.ts:42 |
| Footer hint | `In a game, the ⚖ judge button answers rules questions.` | static | `.rulesblurb` | rules.ts:742 |
| (no search box, no jump bar on this tab) | | | | rules.ts:770 |

### A.5 Tab "Comprehensive rules" (public)

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Blurb | `Every rule of the game, numbered. These are the unofficial comprehensive rules that this client follows.` | — | `.rulesblurb` | rules.ts:752 |
| Link bar | `Open the comprehensive rules in a new tab ↗` · `Ask the players on Discord ↗` | `#r<num>` appended when `?rules=cr&at=` | `.bookbar` | rules.ts:753-756 |
| Frame | `<iframe src="/comprehensive-rules#r608.2b">` | the framed page is a **standalone generated HTML with its own light/dark palette and IBM Plex fonts** (surface F) — light by default on a light-mode OS inside this dark modal | `.bookframe.crframe` (`.crframe` has no CSS) | rules.ts:757; server/main.ts:1204 |
| crAt | module global read by `rulesBoxHtml` (not a parameter) | — | — | rules.ts:770, 795-796 |

### A.6 Tab "How to use the interface" — `tutorial.ts`

Content = `TUTORIAL` (tutorial.ts:39): **Getting into a game · Reading the board · Planning · Playing cards, choosing targets, using abilities · Battle · Deployment · Settings behind ⋯ · Keyboard · The clock, the connection, spectators · When the game ends** (10 sections). Every step that names a button lists its `data-btn` and test 286 checks they exist.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Search | same `#rules-q`, placeholder `search the guide…` | substring only (no stemmer, unlike Rules tab) | `.rulesq` | rules.ts:767-769; tutorial.ts:418-437 |
| Jump bar | chips → `tt-<id>` | | `.rulesjump` | rules.ts:725-728 |
| Section | `<section id="tt-…">` + `<h4>` | | `.rulesec` | tutorial.ts:443-448 |
| Section blurb | escaped (NOT iconized, unlike Rules tab) | only `home` has one | `.rulesblurb` | tutorial.ts:446 |
| Steps list | `<ol>` if `numbered`, else `<ul>`; each `<li><b>Label</b> text</li>` | | `.ttsteps` (dim, 1.5lh), `.ttsteps b` (text colour) | tutorial.ts:439-447; style.css:1042-1044 |
| Empty | `Nothing in the guide matches “q”.` | | `.helpempty` | tutorial.ts:453 |

**Note:** the "row" visual of the Rules tab (`.helprow` 2-column grid) and the "list" visual of the Interface tab (`.ttsteps` bulleted list) are two different reading patterns for sibling tabs of one box.

---

## B. Learn to Play menu — `learnmenu.ts` (+ `learn.ts` for progress)

Reached: home "On your own" `Learn to play` (main.ts:9433), `?learn` (main.ts:12752), toolbar `📘` in a learn game (main.ts:7363). A layer `<div id="learnmenu">` beside `#app`.

### Layout

```
.learnscrim (fixed, z 76, rgba .62, 16px pad)
 └ .learnbox [role=dialog aria-label="Learn to play"]  (width min(94vw,600px), panel, gold border, r10, shadow)
    ├ .lhead:  <h3>📘 Learn to play</h3>  [✕]
    ├ p.learnblurb
    ├ .learnlabel  "PLAY ONE ELEMENT"
    ├ .learnels  5 element buttons
    ├ .learngo   [Start the fire game]  |  [Continue your fire game] [Start over]
    └ details.learnlist  <summary>Read a lesson</summary>  <ol> lesson buttons (+ ✓)
```

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Scrim | click outside closes | — | `.learnscrim` | learnmenu.ts:26, 63; style.css:3524 |
| Box | dialog | has role/aria-label (unlike help box); **no focus management / trap** | `.learnbox` (+ shared `.lessonbox` rules) | learnmenu.ts:26; style.css:3526-3529 |
| Heading | `📘 Learn to play` (emoji in heading) | 18px | `.lhead h3` | learnmenu.ts:27; style.css:3530-3531 |
| Close | `✕` glyph button, **no aria-label** | Esc also closes; all other keys swallowed while open | `.lhead > button` (12px, 3x10) | learnmenu.ts:27, 79-83; style.css:3533 |
| Blurb | `A real game, with a lesson at each new moment. About twenty minutes.` | | `.learnblurb` (dim) | learnmenu.ts:28 |
| Eyebrow | `Play one element` (uppercase 11px dim) | | `.learnlabel` | learnmenu.ts:29; style.css:3589 |
| Element buttons ×5 | `🔥img Fire`, Water, Earth, Wood, Metal (`elIcon` img + capitalised name) | `.on` gold border/text bold; off opacity .75. **Class `el-fire` etc. collides with the Card Stats bar fill `.el-fire {background: var(--fire)}` (style.css:3802-3804, unscoped) → each button is filled with its element colour** (Metal #9aa5b0 behind #d6dde6 text = poor contrast). No aria-pressed | `.learnel.el-<e>`, `.learnel.on`, `img.elicon` | learnmenu.ts:21-22; style.css:3591-3592, 1102 |
| Primary CTA | `Start the <el> game` (no saved game for that element) / `Continue your <el> game` (saved) | element name lower-case in label vs capitalised on chips | `.lprimary` (gold outline, `!important`) in `.learngo button` (8x16, 14px) | learnmenu.ts:30-35; style.css:3581, 3593-3594 |
| Start over | `Start over` — navigates to `&new=1`, **wipes the saved game with no confirm** | only when saved | base button | learnmenu.ts:33, 65-68 |
| Navigation | start/continue/fresh do a full page navigation (`location.search = ?learn=play&el=…`) | — | — | learnmenu.ts:65 |
| Lesson list disclosure | `<details><summary>Read a lesson</summary>` | closed by default | `.learnlist summary` (dim, pointer) | learnmenu.ts:36; style.css:3595-3596 |
| Lesson entries | `1. Anatomy of an Algomancy card` … `8. Haste`, `9. Other ways to play`, `10. Tips for this client` (+ 3b, 6b) — link-styled buttons | hover gold; opens the lesson window off-board | `.learnread` | learnmenu.ts:24-25, 71-74; style.css:3597-3598 |
| Seen mark | `✓` after a seen lesson | green `--glow` | `.learnseen` | learnmenu.ts:25; style.css:3599 |
| Responsive | <700px: box padding 10x12, max-h 94vh | | | style.css:3600-3604 |

State source: `loadProgress()` reads `localStorage.algoLearn` on every paint (learnmenu.ts:42; learn.ts:37-44). Private window → no saved state, silently.

---

## C. Lesson window — `lessonlayer.ts`, `lessonflow.ts`, `lessons.ts`

A layer `#lessonlayer` + a hover-preview `#lessonprev`, both on `<body>`. It **stays up over the board** (unlike the other layers). Keys: Enter/→ next, ← back, Esc minimise, Space swallowed, everything else blocked while open (lessonlayer.ts:434-452).

### C.1 Layout

```
.lessonscrim(.compact) (z 76, rgba .62; compact = transparent & click-through)
 └ .lessonbox(.compact) [role=dialog aria-label="Lesson 3: Deployment and regions"]
    ├ .lhead:  span.lnum "LESSON 3"  <h3>title</h3>  .lheadbtns [▁ hide]
    ├ .lscroll          (scrolls)
    │   ├ h4.lptitle   page title (gold 15px)
    │   ├ .lside       anatomy figure floated right (stacks <700px)
    │   ├ .lbody       markdown body (14px/1.55)
    │   ├ .lcallout    the one thing to remember (gold-tinted box)
    │   ├ figure.lfig… other figures
    │   └ details.lcites  "📖 from the rulebook" → blockquote.lquote + cite
    ├ .ljudge  (not in compact)  .ljlog (q/a turns)  .ljask [input#ljudge-q] [⚖ ask]
    └ .lfoot   .ldots (page dots)   .lfootbtns [← back] [extra actions] [Next → (enter)] | [Got it (enter)]
```

### C.2 Element table — chrome

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Scrim | full-screen dim; clicks inside the layer are captured & stopped | `.compact` → transparent, `pointer-events:none` (board stays usable) | `.lessonscrim`, `.lessonscrim.compact` | lessonlayer.ts:197; style.css:3524-3525, 3665 |
| Box | dialog with aria-label = "Lesson n: title" | `.compact` → 460px, 2px border | `.lessonbox`, `.compact` | lessonlayer.ts:197; style.css:3526-3528, 3666 |
| Lesson number | `Lesson 3`, `Lesson 3b`, or raw `🏁` for the end lesson; absent for the compact nudge (`n:''`) | uppercase 11px gold | `.lnum` | lessonlayer.ts:199; style.css:3532 |
| Title | `<h3>` 18px | | `.lhead h3` | lessonlayer.ts:199; style.css:3531 |
| Hide | `▁ hide` (title "Hide the lesson and look at the board (reopen it from the 📘 pill)") | Esc does the same | `.lheadbtns button` (12px) | lessonlayer.ts:200; style.css:3533 |
| Page title | `<h4>` | | `.lptitle` | lessonlayer.ts:166; style.css:3535 |
| Body | markdown + `[[Card]]` hover links + `{{part:id|words}}` anatomy pointers + icon tokens | function bodies render against the live game, or `EMPTY_CTX` when re-read from the menu (lessonflow.ts:125-134) | `.lbody`, `.lbody p/ul/li`, `.txticon` 16px | lessonlayer.ts:168; style.css:3536-3540 |
| Card link | `<a class="lcard" data-lcard>` — **no href, not focusable**; hover shows the scan; tap toggles it | only if the card exists in the index, else plain text | `a.lcard` (gold dotted underline, cursor help) | lessonlayer.ts:41-60, 372-377; style.css:3541 |
| Anatomy pointer | `<span class="lpart">` — hover draws an arrow (anim.ts setHoverArrows) to a pulsing anchor dot on the card | **mouse-only** (no tap/keyboard path) | `.lpart` (2px dotted --target underline, crosshair), `.lanchor.on` (pulse) | lessonlayer.ts:49, 403-424; style.css:3617-3618, 3634-3636 |
| Callout | emphasised box | optional | `.lcallout` (rgba(217,164,65,.12) bg, rgba(…,.55) border — the gold token re-typed as rgba) | lessonlayer.ts:169; style.css:3613-3616 |
| Rulebook quotes | `<details><summary>📖 from the rulebook</summary>` → blockquotes with `<cite>` "Manual, p. 18" | collapsed by default; summary marker hidden | `.lcites`, `.lquote`, `.lquote cite` (italic, gold left rule) | lessonlayer.ts:157-160; style.css:3542-3544, 3608-3612 |
| Judge log | `.ljq` question (gold bold) / `.lja` answer (markdown) / `.ljcards` "Card · Card" links | auto-scrolls to bottom; per-lesson history (Map by lesson id) | `.ljudge`, `.ljlog` (max 26vh), `.ljq`, `.lja`, `.ljcards` | lessonlayer.ts:192-194, 203-208; style.css:3569-3575 |
| Judge input | `input#ljudge-q` placeholder `Still unsure? Ask the judge about this lesson…`, maxlength 400; Enter asks | **no label**; `font: 14px/1.4 inherit` invalid shorthand again | `.ljask input` | lessonlayer.ts:205-206; style.css:3576-3578 |
| Judge button | `⚖ ask` → `asking…` (disabled) | NOT `.primary` (the board judge's Ask is) | base button | lessonlayer.ts:207 |
| Judge error | `could not reach the judge: <err>` rendered as an answer bubble — **no error styling** | also "The judge is not available right now…" when guest token fails (main.ts:12519) | `.lja` | lessonlayer.ts:325 |
| Page dots | one `<i>` per page; current gold | only when >1 page; **purely visual, no "page 2 of 5" text for AT** | `.ldots i`, `.ldots i.on` | lessonlayer.ts:190-191; style.css:3582-3584 |
| Back | `← back` | page > 0 | base | lessonlayer.ts:212 |
| Next | `Next → (enter)` | not last page | `.lprimary`, `.kh` hint hidden on touch | lessonlayer.ts:216; style.css:4017 |
| Got it | `Got it (enter)` → marks seen, closes, may open the next due lesson | last page, no end actions | `.lprimary` | lessonlayer.ts:215, 306-312 |
| End actions | `↺ Rewind this turn` (lost only) · `New game` (primary) · `Home` | last page of lesson `end` in a game | `.lprimary` on primary | lessonlayer.ts:195-196; main.ts:12522-12539 |
| Minimised pill | `📘 Lesson 3: Deployment and regions` fixed bottom-right | on the regions board it shifts to right:64px; hidden while ⋯ is open; 12px <900px | `.lessonpill` | lessonlayer.ts:222-224, 268; style.css:3585-3587, 4988-4991, 4084 |
| Card preview | `#lessonprev` 250px scan following the pointer, clamped to the viewport | display toggled by inline style | `#lessonprev`, `.lprevimg` | lessonlayer.ts:346-355; style.css:3553-3554 |
| Board highlight | page `highlight` selectors (e.g. `.phicons`, `.actionbar`) get a pulsing outline on the REAL board | **`.lhl` sets `position:relative; z-index:77` on arbitrary board nodes** | `.lhl` | lessonlayer.ts:255-261, 298; style.css:3662-3664 |
| Reading flag | `body.lessonreading` raises the arrow layer to z 85 | | | lessonlayer.ts:266; style.css:3619 |

### C.3 Figure kinds (`Figure` union, lessonflow.ts:46-63)

| kind | renders | CSS | file:line |
|---|---|---|---|
| `cards` | row of scans; each `FigCard` may be `dim` (greyscale .45), `cross` (72px pink `✕` `#ff2d7a`), `back` (card back or striped gradient), `badge` (chip top-right), `label` (caption under) | `.lfigcards`, `.lfigcard(.dim/.cross)`, `.lfigimg` 150px (130 in cards/flow, 110 <700px), `.lfigback`, `.lbadge`, `.lfiglabel` | lessonlayer.ts:68-76, 83-85; style.css:3550-3552, 3621-3628, 3631 |
| `flow` | scans joined by `➜` (26px gold glyph) | `.lflow`, `.lflowarrow` | lessonlayer.ts:86-88; style.css:3629-3630 |
| `anatomy` | one 230px card with absolutely-positioned anchor dots (`style="left:x%;top:y%"`) — floated right of the text in `.lside` | `.lanat`, `.lanatimg`, `.lanchor`, `.lside` | lessonlayer.ts:89-94, 165-167; style.css:3632-3636, 3687-3697 |
| `formation` | CSS grid of 96px cells (`style="--cols:n"`), `your opponent — attacking/blocking` side labels, a gold middle line, `no blocker` empty cells, per-column notes | `.lform`, `.lfside`, `.lfgrid`, `.lfcell`, `.lfempty`, `.lfline`, `.lfnote` (64px <700px) | lessonlayer.ts:95-124; style.css:3637-3644, 3700-3714 |
| `modded` | host card with mods tucked under (`style="--mods:n"`, each `style="--i:k"`) + an "IT NOW READS" panel | `.lmodwrap`, `.lmodded`, `.lmod`, `.lmodhost`, `.lreads`, `.lreadslabel` | lessonlayer.ts:125-133; style.css:3645-3652, 3690-3692 |
| `frames` | slideshow: `loop` auto-advances every 1.7s (setInterval), `step` numbers captions; controls `⏮` `▶/⏸` `⏭` + `1 / 4` | `.lframes`, `.lframe(.on)`, `.lframecap`, `.lframebtns`, `.lplay`, `.lframepos`. **`.lplay` collides with the board's region class `.lplay` (style.css:4293: overflow hidden, min-width 0, padding var(--ringpad))** | lessonlayer.ts:134-147, 329-344, 429-432; style.css:3653-3661 |
| `html` | trusted markup from lessons.ts: **turn strip** (`Planning ▸ Haste ▸ Battle ▸ Regroup ▸ Deploy`, one lit), **stack pile** (string-patched `style="--k:k"` into another function's output), **two regions** (`your region` / `your opponent's region`, green/red rgba borders, pink `#ff6b9a` wall text), **shop** (`Buy the game…` + `shopLinksHtml()`) | `.lturn`, `.lstack`, `.lstackpile`, `.lstacklabel`, `.lresolved`, `.lres`, `.lregions`, `.lregion.mine/.theirs`, `.lwall`, `.lshop`, `.lgbuys` | lessons.ts:107-132, 799; style.css:3555-3558, 3667-3686, 3548-3549 |
| figcaption | under any figure | 12px dim centred | `.lfig figcaption` | lessonlayer.ts:152; style.css:3546 |

### C.4 Lesson UI states (the kinds, not every lesson's text)

1. **Full lesson, multi-page** (dots, back/next, judge box). Lessons: `1` Anatomy of an Algomancy card · `2` Planning: resources and affinity · `3` Deployment and regions · `3b` Attributes · `4` Combat with units · `5` Battle spells and the stack · `6` Augmenting · `6b` Viruses · `7` Graft effects and grafting · `8` Haste (lessons.ts:146-680).
2. **Single-page lesson** (no dots; "Got it").
3. **Compact nudge** — `Planning again` (lessons.ts:376-385): transparent scrim, 460px box, no judge, no lesson number; its point is the board highlight.
4. **End lesson `🏁 Game over`** — won / lost bodies, the formats pages, "Where next" with the shop and reference cards; footer becomes the end-action buttons (lessons.ts:765-805).
5. **Re-read from the menu** (off-board): rendered against `EMPTY_CTX`, so "a card in your hand" falls back to generic wording; highlights try to match selectors on whatever page is under it.
6. **Reference lessons only reachable from the menu**: `9` Other ways to play (FORMATS), `10` Tips for this client (INTERFACE = TUTORIAL turned into markdown bullet pages) (lessons.ts:693-763).
7. **Minimised** → pill.
8. **Judge idle / busy (`asking…`) / answered / failed**.
9. **Due-lesson queue**: two lessons can be due at once; finishing one opens the next (lessonlayer.ts:311).

---

## D. The Judge box (board only) — `main.ts`, `judgehistory.ts`, `markdown.ts`

Only drawn inside the board paint (main.ts:7967). **There is no judge surface off the board** except the lesson judge (C) — the rulebook tab's own copy says "In a game, the ⚖ judge button…".

### Layout

```
.overlay.mainonly
 └ .overlaybox.judgebox  (min(92vw,640px))
    ├ <h3>⚖ Judge — ask the rules bot</h3>
    ├ .judgescroll (max-h 50vh): [.judgeq "Q: …"  .judgea (markdown + .hint sources + .hint cards)]* | empty hint | "thinking…"
    ├ .judgerow: input#judge-q  [Ask]
    └ [Close]
```

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Openers | toolbar `⚖` (title "ask the rules judge bot"); inspector `⚖ Ask the judge about <Card>`; right-click menu `⚖ Ask the judge about <Card>` — both prefill `I have a question about <Card>. ` | | toolbar / `.judgerow` / `.menu` | main.ts:7372, 5144, 12314-12318, 11142-11147 |
| Title | `⚖ Judge — ask the rules bot` | emoji in heading | `.overlaybox h3` | main.ts:5171 |
| Empty state | `Ask anything — answered from the rulebook and the designer’s Q&A.` | no log | `.hint` — **`.hint` has NO base style in style.css** (only context-scoped rules), so it renders as plain body text | main.ts:5172 |
| Question | `Q: <text>` | | `.judgeq` (gold bold) | main.ts:5167; style.css:1062 |
| Answer | markdown via `mdToHtml(…, {inline: iconizeText})`: h3/h4, p, ul/ol, blockquote, code, strong/em | refusals (busy / daily limit / sign in) appear as answers too, flagged `failed` only for history; **same styling as real answers** | `.judgea` + descendants | main.ts:5168; style.css:1063-1080 |
| Sources legend | `sources: 1. <name or link> · <i>authority</i><br>…` — a CR source links to `/?crreview=1&at=…` in a new tab | only when the bot sends sources | `.hint` (unstyled) | main.ts:5153-5163 |
| Cited cards | `cards: A · B` — each `span[data-prev]` hover-previews | | `.judgea .hint span` (dotted underline, help cursor) | main.ts:5169; style.css:1064 |
| Busy | `thinking…` line; input and Ask disabled | | `.hint` | main.ts:5173-5176 |
| Input | `input#judge-q` placeholder `e.g. can a Feeble unit be sent to counterattack?`; Enter asks; draft & caret survive repaints (`rewireInputs`) | **no label, no maxlength** (lesson's has 400) | `.judgerow input` | main.ts:5175, 8136-8150; style.css:1081-1083 |
| Ask | `Ask` | disabled while busy | `button.primary` (**hard-coded green #3c5a2f/#5b8747**) | main.ts:5176; style.css:53 |
| Close | `Close` | Esc via closeTopOverlay | base | main.ts:5178, 12012 |
| History | last 8 good exchanges sent as `history` | pure | — | judgehistory.ts:21-29 |

**Two judge UIs:** the board box (`.judgebox/.judgeq/.judgea/.judgerow`, `Q:` prefix, sources legend, green Ask, no maxlength) and the lesson judge (`.ljudge/.ljq/.lja/.ljask`, no prefix, **sources dropped** — main.ts:12520 maps only answer+cards, `⚖ ask` lowercase non-primary, maxlength 400, cited cards as lesson hover-links). Same fetch (`judgeRequest`, main.ts:5184), two markups, two CSS families.

---

## E. Rules review page — `crreview.ts`, `crlayer.ts`, `crsearch.ts`, `crdom.ts`, `cranchor.ts`, `crtypes.ts`

Reached: `?crreview=1` (value may be a tab name: `annexD`, `disc`, `oq`, `comments`), `&at=r608.2b|D-U12-3|F-…|gloss:…`, `&c=<comment id>`, or `#r608.2b` hash (crreview.ts:330-340); profile `📜 Rules review` for owner/judge badges (account.ts:520 → main.ts:11205); links from judge answers (main.ts:5159). Readable by anyone, writable by named accounts.

It owns `#app` (renderHome defers to it, main.ts:9338), adds the class `crapp` (crreview.ts:677) — **which has no CSS** (dead hook).

### E.1 Layout

```
.crpage
 ├ .crbar (sticky top, z 30, panel bg, wrap)
 │   [← Close] [☰ Contents](<1180) .crtitle(<b>title</b> edition, effective)  .crtabs[Document|Annex D|Discrepancies|Owner questions|Comments (n open)]
 │   .crsearchslot(search box)  .crgrow  .crwho(Commenting as X | Sign in to comment | Name your account to comment)
 │   [Show resolved/Fold resolved] [↻] [❓ Questions] [⬇ Download]
 ├ #crqslot   .crdl questions list (toggle)
 ├ #crdlslot  .crdl downloads (toggle)
 ├ .crmsg     error line (red)
 └ .crbody.tab-<tab>  grid: 230px | minmax(0,96ch) | 300px
     ├ nav.crtoc#crtoc (sticky; drawer <1180)
     ├ .crcol > .crdoc#crdoc   (renderer's HTML + decorations)
     └ aside.crmargin#crmargin (absolutely-placed thread cards; hidden <820 and on Comments tab)
Layers (crlayer.ts, #crlayer on body): 💬 Comment chip · composer (.crscrim > .crcomposer) · sheet (.crsheetscrim > .crsheet)
#crtoast on body
```

### E.2 Element table — the bar

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Close | `← Close` — title **"back to the lobby"** (it goes home) | | base, `.crbar button` | crreview.ts:686 |
| Contents toggle | `☰ Contents` opens the drawer | visible only <1180px | `.crtocbtn` | crreview.ts:687; style.css:5150, 5310 |
| Title | `<b>Algomancy Comprehensive Rules</b>` + `<edition>, effective <date>` (dim) — before load: `<b>Rules review</b>` | | `.crtitle`, `.crnote` | crreview.ts:678, 688 |
| Tabs ×5 | `Document` · `Annex D` · `Discrepancies` · `Owner questions` · `Comments <n open>` | `.on` gold; no ARIA tab semantics | `.crtab`, `.crn` | crreview.ts:60-62, 495-500; style.css:5145-5146 |
| Search slot | hosts the one persistent search element | full width row <820 | `.crsearchslot` | crreview.ts:690, 705; style.css:5235, 5318 |
| Who | `Commenting as <b>name</b>` / `[Name your account to comment]` (guest) / `[Sign in to comment]` | hidden until comments load (`rev<0`) | `.crwho`, `.crnote` | crreview.ts:502-507 |
| Show resolved | toggles `Show resolved` ↔ `Fold resolved` (textContent swap) | | `.crbar button` | crreview.ts:693, 1076-1080 |
| Refresh | `↻` (title "check for new comments") — **no busy indicator** | auto-poll every 30s while visible & composer closed | | crreview.ts:694, 213-216 |
| Questions | `❓ Questions` toggles the question-board list | `.on` | `.crbar button.on` | crreview.ts:695, 1061-1067 |
| Download | `⬇ Download` toggles downloads panel | `.on` | | crreview.ts:696, 1053-1059 |
| Message line | server/network errors | empty hides | `.crmsg` (danger) | crreview.ts:700; style.css:5151-5152 |

### E.3 Contents rail

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Close contents | `✕ Close contents` | only shown inside the <1180 drawer | `.crtocclose` | crreview.ts:529-532; style.css:5167, 5315 |
| Chapter entry | chapter/part title + `💬 n` open threads | `.on` = current; current one expands its sections | `.crtocent` (transparent, 2px left rule; hover/on gold) | crreview.ts:543-545; style.css:5162-5165 |
| Section entry | `608. Title 💬 n` | indented 20px, 12px | `.crtocsec` | crreview.ts:537-538; style.css:5166 |
| Annex D head | on the Annex D tab | | `.crtochead` | crreview.ts:539-541 |
| Hidden | tabs Discrepancies/Owner questions/Comments → empty rail | | | crreview.ts:535 |

### E.4 Document column (Document / Annex D tabs) + decorations

The content is **the renderer's own HTML** (engine/scripts/cr/render.mjs) injected as-is; every class is scoped under `.crdoc` with its own palette (style.css:5323-5395). Classes in the payload: `h2` (Georgia 22px), `h3`, `h4`, `.front`, `.figs/.fig`, `article.rule(.r-sub/.tomb)`, `p.rt`, `a.num`, `strong.rtitle`, `p.ex/.exl`, `.tb`, `.differs`, `.tags`, `.chip` + `.b-printed/.b-designer/.b-mixed/.b-owner/.b-engine` (source chips), `.v-confirmed/.v-partial/.v-untested/.v-contradicted/.v-unsupported/.v-none` (verification chips), `.k-a…k-g`, `.meta`, `.vnote`, `details.prov > summary`, `.fgroup/.fgh/.fnd/.dh`, `ul.src`, `.sk`, `q`, `.disc`, `p.res` (resets the client's global `.res` orb), `.count`, `dl.gloss dt/dd`, `.tw > table`.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Chapter heading | `<h2 id=chN>` | added by the page when the part lacks one | `.crdoc h2` | crreview.ts:549-559 |
| ＋ add-comment | fullwidth `＋` on every commentable item (in its `.tags` row / heading / start) — comments on the selection if any, else the whole item | title "comment on this (or on the words you have selected in it)" | `.crplus` (dim) | crreview.ts:774-782; style.css:5209-5210 |
| 💬 count | `💬 n` open threads on that item; desktop focuses first thread, narrow opens sheet | only when n>0 | `.crcount` (gold) | crreview.ts:783-792, 1115-1122; style.css:5211 |
| Highlight | `<mark class="crhl">` around a comment's quoted text (made by splitting text nodes) | `.on` when its thread is focused; click focuses thread | `mark.crhl`, `.on` | crdom.ts:101-122; crreview.ts:771, 806-808; style.css:5207-5208 |
| Folded count | ` 💬 n` appended to a `<summary>` hiding highlights | | `.crn` | crreview.ts:795-805 |
| Copy-link | inline **SVG chain icon** (the only SVG icon in this area) after every rule number / heading / finding / discrepancy; copies `/?crreview=1&at=…` | opacity .3, full on row hover/focus; .7 on touch; toast `Link copied` or `Copy this link: <url>` (6s) | `.crdoc .crshare` (uses `--muted`, `--accent-soft` that exist only inside `.crdoc`) | crreview.ts:825-877; style.css:5215-5220 |
| Flash | arrived-at item flashes gold | 1.4s | `.crflash` | crreview.ts:978-982; style.css:5212-5213 |
| In-doc links | `#r609.1` etc. move the page instead of the browser | | | crreview.ts:1011-1025 |
| Loading | `Loading the document…` | | `.crnote` | crreview.ts:680 |
| Error | server error text — **in dim `.crnote`, not danger** | | `.crnote` | crreview.ts:680 |
| Nowhere | `There is nothing at this place in the document.` | | `.crnote` | crreview.ts:552 |

### E.5 Margin threads (and the same card in the sheet and the Comments tab)

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Thread card | absolutely positioned level with its passage (`style.top` set in JS, collision-stacked by `layoutMargin`) | `.focus` gold border; `.crresolved` .8 opacity | `.crthread` | crreview.ts:464-491, 897-919; style.css:5174-5180 |
| Folded resolved | one-line `✓ name: snippet…` button | when resolved and not shown/expanded | `.crthread.crdone`, `.crdonebtn` (green, ellipsis) | crreview.ts:467-470; style.css:5176-5177 |
| Status chips | `rule removed` · `no longer in the document` · `the quoted text has changed` (warn) · `from <edition>` · `✓ resolved by X` (ok) | | `.crstatus`, `.crchipx(.warn/.ok)` | crreview.ts:453-461, 485 |
| Quote | the anchored words; struck through when gone | max 7.5em clipped | `.crquote`, `.crquote.gone` | crreview.ts:472; style.css:5200-5202 |
| Comment | `<b>name</b>` + badge chips (`Owner`, `Judge L2`, `system`) + `5 min ago` (title = ISO) + `(edited)` + `answer: Reading A` chip; body pre-wrap; `This comment was deleted.` | `.mine` class (no CSS) | `.crc`, `.crby`, `.crwhen`, `.crtext`, `.badgechip`, `.crchipx.crsys`, `.crchipx.crans` | crreview.ts:432-451; style.css:5182-5199 |
| Comment actions | `Edit` `Delete` (own, from server's `canEdit`); Delete uses **`window.confirm`** | | `.cracts button` (2x8, 12px) | crreview.ts:444-449, 1101-1103 |
| Thread actions | `Reply` · `Resolve`/`Reopen` (server's `canResolve`) · `Collapse` (resolved) · `Go to` (Comments tab) | | `.cracts` | crreview.ts:473-481 |
| Relative time | `just now`, `n min ago`, `n h ago`, `n d ago`, else date | | `.crwhen` | crreview.ts:363-372 |

### E.6 Other tabs

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Discrepancies | `<h2>Discrepancies</h2>` + note + `Tier 1..4 <count>` h3s + renderer `.disc` blocks | | `.crdoc .disc`, `.count` | crreview.ts:561-569 |
| Owner questions | `<h2>Questions for the owner</h2>` → topic h3 → `Question n` + disc html + answer slot | | `.croq`, `.croqn`, `.croqans` | crreview.ts:571-577; style.css:5203-5206 |
| Answer status | `Answered: Reading A` chip + `name, 2 d ago[: snippet]` / `Not answered yet.` | | `.crchipx.ok`, `.crnote` | crreview.ts:938-940 |
| Admin answer buttons | `Reading A` `Reading B` … `Other…` — one click posts; Other opens composer | **admin only** | `.croqbtns button` | crreview.ts:941-944, 1123-1130 |
| Comments tab | `<h2>Comments</h2>` + filter buttons `Open · Resolved · Outdated · Orphaned · Mine · All` + list of `.crwhere` (monospace gold location) + thread cards with `Go to`; orphan heading `No longer in the document`; empty `No comments here.` | margin column hidden on this tab | `.crfilters`, `.crtab`, `.crlistitem`, `.crwhere` | crreview.ts:579-606; style.css:5172-5173, 5181 |

### E.7 Downloads & Questions panels

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Downloads | rows: `Whole document .md .txt .html` · `This chapter …` (doc/annexD) · `This section (608) …` (from scroll position) · `Annex D .md · Discrepancy report .md · Owner questions .md · Changelog .md` · `Comments .md [.jsonl (raw journal, admins only)]` + note about standalone .html | `.jsonl` admin-only, a button that fetches with the token | `.crdl`, `.crdl a`, `.crlink`, `.crnote` | crreview.ts:618-633, 649-662; style.css:5153-5156 |
| Questions list | each rules question: link (navigates to `?question=id`) + `Copy link` + note "Each opens a staged board…" | toggle | `.crdl`, `.crqrow`, `.crlink` | crreview.ts:641-646; style.css:3985 |

### E.8 Search (crsearch.ts) — built with `createElement`, not a template string

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Input | `type=search`, placeholder `Search the rules  ( / )`, aria-label "Search the rules: a number, or words"; `/` focuses from anywhere (unless a dialog/report is open) | Esc clears then blurs; ↑↓ move; Enter goes | `.crsearch` (role=search), `.crsinput` | crsearch.ts:243-308; style.css:5236-5239 |
| Results | listbox dropdown; each `button[role=option]`: label column (rule number, monospace gold) + kind (`section`/`part`/`glossary`/`finding`/`discrepancy`) + bold title + snippet with `<mark>` | `.on` = keyboard selection; `Loading the document…` · `Nothing matches.` · `n more: add a word to narrow it.` | `.crsresults`, `.crsres(.on)`, `.crslab`, `.crskind`, `.crsbody`, `.crsnone` | crsearch.ts:213-228; style.css:5240-5250 |
| Number jump | `802.1`, `r802.1`, `d3.1a` → that rule and its children | | | crsearch.ts:111-163 |

### E.9 Layer: chip, composer, sheet (crlayer.ts) and toast

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Selection chip | `💬 Comment` floating at the end of a text selection inside a commentable item; `on <label> only` if clamped | positioned with **inline `style="left:…;top:…"`**; 30px lower on touch | `.crchip` (z 75) | crlayer.ts:245-249, 99-121; style.css:5253-5254 |
| Composer scrim | click outside: asks **`window.confirm('Discard this comment?')`** if text | | `.crscrim` (z 72, rgba .55 — yet another alpha) | crlayer.ts:237, 314-321; style.css:5255 |
| Composer | dialog: `Comment on / Reply on / Edit your comment on / Answer` **<label>** · quote or `On the whole item.` · note (cut/clamped) · answer note | right-docked 420px at top 90; bottom sheet <820 | `.crcomposer[role=dialog]`, `.crhead`, `.crquote`, `.crnote` | crlayer.ts:208-243; style.css:5256-5261, 5321 |
| Textarea | `#cr-draft` rows 5, maxlength 4000, placeholder `Write a reply` / `Write a comment`; Ctrl/⌘+Enter sends; draft stashed per target on cancel | disabled while busy; **no label** | `.crcomposer textarea` | crlayer.ts:220, 259-271 |
| Visibility note | `Visible to everyone who opens this page, under your name.` | | `.crnote` | crlayer.ts:221 |
| Buttons | `Cancel (esc)` · `Comment`/`Save` → `sending…` | | `.crrow`, `.primary` (green) | crlayer.ts:222-226 |
| Can't comment | `Sign in to comment. Anyone can read this page…` + `[Sign in]` / guest: `Name your account to comment…` + `[Open my profile]` | | `.crnote`, `.primary` | crlayer.ts:227-236 |
| Error | `write something first` / server error | | `.crerr` (danger) | crlayer.ts:191, 241 |
| Sheet (narrow) | bottom sheet with `<b>label</b>` + `Close` + thread cards / `No comments here yet.` | | `.crsheetscrim`, `.crsheet` | crlayer.ts:251-257; style.css:5265-5266 |
| Toast | `Link copied` / `Copy this link: …` | own toast element, not the app's `.toast` | `.crtoast(.on)` (z 80) | crreview.ts:879-894; style.css:5221-5225 |

### E.10 Breakpoints

- ≥1180: 3 columns (230 · 96ch · 300).
- 820–1179: rail becomes a fixed left drawer (280px, z 40) behind `☰ Contents`; 2 columns (doc · 280 margin).
- <820: one column; margin hidden; 💬 opens the sheet; search takes a full row; composer is a bottom sheet.
- Touch: `.crshare` more visible & larger.

---

## F. Public CR page (`/comprehensive-rules`) — not ui code, but it is a page users see

Served as the generated `data/comprehensive-rules/Algomancy-Comprehensive-Rules.html` (11,445 lines; server/main.ts:1204), framed in A.5 and opened in a new tab. **Third palette**: its own `:root` light theme (`--bg #f6f7f8`, `--accent #1f5f8b`) with a `prefers-color-scheme: dark` variant and `[data-theme]` overrides; fonts `IBM Plex Sans/Mono/Serif` (no font file loaded by the client → falls back to system-ui/Georgia). It does not share the client's header, footer, tokens or buttons. Its dark palette is the one copied into `.crdoc` (style.css:5323-5331). Owned by `engine/scripts/cr/render.mjs` — a redesign must decide whether this page joins the client's design system.

---

## G. Rules question board panel — `replaybar.ts:209` (`?question=<id>`)

The board is the replay viewer (another reader); the question box sits above the transport in the `.replaybar.asking` layer.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Unknown id | `There is no rules question at that link. It may have been renamed or answered.` on the connecting screen | | (join screen) | main.ts:12698-12701 |
| Title | question title, ellipsised | title attr = full | `.rqtitle` (gold 14px) | replaybar.ts:223; style.css:3964-3965 |
| Expand | `The question, readings and cards` ↔ `Close the question` | `.on` gold | `.rqopen` | replaybar.ts:224; style.css:3966-3967 |
| Link field | readonly input with the share URL | hidden <720px | `.rqlink` | replaybar.ts:225; style.css:3968-3969, 3987 |
| Copy | `Copy link` | | `.rqcopy` | replaybar.ts:226 |
| Expanded body | the question (`.rqasked`), readings `<b>Reading A.</b> text`, what this client does (`.rqclient`, green), each card's printed text with icons | max 40vh scroll | `.rqmore`, `.rqasked`, `.rqreadings`, `.rqclient`, `.rqcards` | replaybar.ts:216-221; style.css:3974-3979 |
| Moment buttons | `1. Start`, `2. Piercing granted`, … (title = note) | `.on` = the action index on screen (green, `#1d2b1a` hard-coded bg) | `.rqmoment(.on)` | replaybar.ts:212-214; style.css:3970-3972 |
| Note | the current moment's note / `Between two moments: step with the arrows, or pick a moment.` | min 2.7em | `.rqnote` | replaybar.ts:229 |

---

## H. Scenario tester panel — `scenario.ts`

Exists only when the SERVER pushes `scenario` for the room (fail-closed). On the regions board it is a popover off the toolbar's `🧪` (`.scnpop.tbpop`, main.ts:7395), opened automatically on a new scenario.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Toolbar toggle | `🧪` (title "the scenario: what it should do, and your verdict"), aria-expanded | `.on` | toolbar | main.ts:7366-7368 |
| Head | `🧪 Scenario · <b>Card</b>` + scenario id (dim, title = why) + `✕` close (popover) | | `.scnhead` (teal `--pending`), `.scnid`, `.scnx` | scenario.ts:135-137; style.css:2534-2535, 4998-5000 |
| Expectation | the brief, one `<div>` per line | the readable-size field | `.scnexpect` | scenario.ts:129, 138; style.css:2537-2539 |
| Opponent line | `Seat 1 is scripted: …` (dim) / `Seat 1 is occupied — …` (green) / **warning box** `This one needs a live opponent. Open seat 1 in another tab…` | 3 variants | `.scnhint`, `.scnhint.scnok`, `.scnwarn` | scenario.ts:102-115; style.css:2540-2544 |
| Verdict buttons | 2×2 grid: `✓ works` (green) · `✗ broken` (red) · `≈ slightly off` (gold) · `⚠ bad scenario` (dim) — file immediately | disabled while busy | `.scnbtns`, `.scnbtn.scn-<v>` | scenario.ts:55-60, 121-125; style.css:2545-2550 |
| Optional detail | `<details>` `add detail (optional — never required)` → clause `<select>` (`(which clause? — optional)` + printed clauses) or hint `this card prints no rules text…`, textarea `what happened? (optional)`, textarea `what SHOULD it do? (optional)` | open state & drafts survive repaints (`rewire`) | `.scndetail` (11px controls); `.hint` (unstyled) | scenario.ts:141-148, 227-243; style.css:2551-2552 |
| Stamp | `stamped with engine <code>abcdef1234</code> · room XXXX · action n` | | `.scnstamp` (10px) | scenario.ts:149-150 |
| Status | `filing “works”…` / `recorded: works · clause noted` / **`NOT recorded — <error>`** — **all three in green** | | `.scnstatus` (`--glow`) | scenario.ts:151, 189-214; style.css:2555 |
| Board (classic) sizing | flex rules for `#app.board .scnpanel` | | | style.css:1690-1694 |

---

## I. Test mode (sandbox) — `sandbox.ts`

Fail-closed on `state.sandbox`. Paints into `#sbx-root` on `<body>`; **injects its own `<style>` block with its own palette** (sandbox.ts:420-460) and its own font declaration. Repaints off a MutationObserver on `#app`.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Home launcher | `Test mode` button appended into `.homesolo` by the observer (title "a solo sandbox: any card, any mana, 1000 life…"); → `dealing…` (disabled) → navigates, or `test mode — <error>` / `test mode — could not reach the server` **as the button's own label** | | base button | sandbox.ts:409-418, 329-343 |
| Panel | fixed top-right 306px, max-h viewport-72, z 90 | `.on` shows | `#sbx-root` | sandbox.ts:421-423 |
| Head (click = collapse) | `🧪 Test mode` + `ROOM · seat 1` + `▾/▸` | collapsed shows head only | `.sbxhead`, `.sbxglyph`, `.sbxroom`, `.sbxchev` | sandbox.ts:168-172 |
| Summon | eyebrow `Summon — any of the N cards`; zone buttons `hand · board · bin` (`.on` blue); search input placeholder `name, or t:unit e:fire p>5` (**no label**); results: name + `2 · 1/3 · fire` meta; `nothing matches that`; `N more — keep typing` (max 40) | | `.sbxlabel`, `.sbxzones`, `.sbxzone(.on)`, `.sbxq`, `.sbxhits`, `.sbxhit`, `.sbxhitname`, `.sbxhitmeta`, `.sbxhint` | sandbox.ts:199-209 |
| Mana & affinity | 2-col grid: kind name, `−` n `+` per kind (elements + prismite + shard); `Set mana` (blue primary) · `all 5` · `none` | draft vs board pool | `.sbxmanas`, `.sbxmana`, `.sbxkind`, `.sbxn`, `.sbxgo` | sandbox.ts:181-186, 211-219 |
| Life | `Life — 30`; input (numeric) + `Set` + `1000`; errors `type a number first` / `that is not a number` | | `.sbxlife` | sandbox.ts:221-228, 305-319 |
| Phase | `Phase — battle (round 1), turn 3` + `⏭ next phase` + hint | | `.sbxgo`, `.sbxhint` | sandbox.ts:230-237 |
| Other seat | `↗ open seat 2 in a new tab` link + hint | room only | `.sbxtab` (`#7fb3e8`) | sandbox.ts:190-195 |
| Status | last action `Card → hand`, `mana set`, `life → 1000` | | `.sbxstatus` | sandbox.ts:240 |

---

## J. markdown.ts and glossary.ts (as shown)

- `mdToHtml(src, {inline})` (markdown.ts:82) — closed tag set `strong em code h3 h4 ul ol li blockquote p br`, **no attributes ever**, no links. `##`→h3, `###`→h4. Used by the judge box (main.ts:5168), lesson bodies/callouts/reads/captions/judge (lessonlayer.ts:65, 131, 168-169, 193), and also meta.ts and decks.ts. Pure. Its output has **no classes**, so every host styles descendant tags itself: `.judgea p/h3/h4/ul/blockquote/code` (style.css:1068-1080), `.lbody p/ul/li`, `.lja p`, `.lcallout p`, `.lreads p` — five descendant-selector families for one renderer.
- `glossary.ts` has **no markup**; it is the data. As shown: the Rules tab's Attributes section (rules.ts:266-276) and the unit inspector's "Referenced rules" rows (`glossRow`, main.ts:5005-5006, which reuses `.helprow`). `PRINTED_REMINDERS` / `MANUAL_REMINDERS` / `LIBRARY_REMINDERS` / scan-reminders.json decide which sentence is shown (glossary.ts:769-823, 889-903).

---

## K. Shared building blocks, and where these pages reinvent them

### Used across these surfaces
| block | where defined | used by |
|---|---|---|
| base `button` / `button.primary` / `button:disabled` | style.css:50-54 | everything (sandbox overrides all of it) |
| `.overlay` + `.overlaybox` dialog | style.css:891-895, 928 | help box (both shells), judge box |
| `esc()` | util.ts | all |
| `iconizeText()` / `txtIcon()` → `img.txticon` | cardtext.ts | rules, tutorial, lessons, judge, question cards |
| `mdToHtml()` | markdown.ts | judge, lessons |
| `artHtml()` → `img` with inline `onerror` | cardpanel.ts:43 | lesson figures, preview |
| `elIcon()` → `img.elicon` with inline `onerror` | util.ts:13 | learn menu |
| `badgeChipsHtml()` → `.badgechip` | account.ts:131 | CR comments |
| `shopLinksHtml()` → `.lgbuys` | legal.ts:186 | end lesson |
| `.kh` keyboard hint (hidden on touch) | style.css:4017 | lessons, composer |

### Reinventions (same concept, N implementations)

| concept | implementations in this area |
|---|---|
| **Modal scrim** | `.overlay` (z60, .72) · `.helpscrim` (z80, .72) · `.learnscrim/.lessonscrim` (z76, .62) · `.crscrim` (z72, .55) · `.crsheetscrim` · sandbox has none |
| **Dialog box** | `.overlaybox` (no shadow, 18x22) · `.learnbox/.lessonbox` (re-declares panel/border/radius + shadow, 14x18) · `.crcomposer` (r8, 12x14) · `.crsheet` · `.scnpanel` (teal border) · `#sbx-root .sbxbody` (own colours) |
| **Close affordance** | `Close` (help, judge) · `✕` (learn, scenario popover) · `▁ hide` (lesson) · `← Close` (CR) · `✕ Close contents` · `Cancel (esc)` (composer) · `Close` (sheet) · click head to collapse (sandbox) |
| **Tabs / segmented control** | `.helptab` (12px, opacity .75) · `.crtab` (CR tabs and filters) · `.learnel` (element picker) · `.sbxzone` (blue) · `.rqmoment` (green) · `.rqopen.on` |
| **Search input** | `.rulesq` (r7, 8x11, bg --bg, 14px intended) · `.crsinput` (r5, 5x10) · `.sbxq` (r4, 4x6, `#0d1119`) · `.judgerow input` (bg panel2, r5, 6x10) · `.ljask input` (bg --bg, r5, 5x8) |
| **Primary button** | `button.primary` (green fill #3c5a2f) · `.lprimary` (gold outline, `!important`) · `.bookopen` (gold-outlined link) · `.sbxgo` (blue fill #2f5d8a) · `.crdl a` gold links |
| **Q&A log** | `.judgeq/.judgea` vs `.ljq/.lja` |
| **Quote block** | `.lquote` (italic, gold rule) · `.crquote` (--target rule, clipped) · `.judgea blockquote` (gold rule, dim) · `.lcallout` |
| **Small chip/badge** | `.crchipx` (r3) · `.badgechip` (pill) · `.lbadge` (r10) · `.crdoc .chip` (r3, own colours) · `.crn` |
| **Eyebrow label (uppercase small)** | `.helpscroll h4` (12px gold .08em) · `.learnlabel` (11px dim .08em) · `.lfside` (10.5 .1em) · `.lreadslabel` (10.5 .1em) · `.lstacklabel` (10.5 .1em) · `.lregion h5` (11 .1em) · `.sbxlabel` (11 opacity .55 .05em) · `.lnum` (11 gold .08em) |
| **Toast** | app `.toast` (z90) vs `.crtoast` (z80) vs sandbox/scenario inline status lines |
| **Header / page chrome** | the CR page has its own sticky `.crbar`; the help box has `.helphead`; lessons `.lhead` — none shares a page header with the rest of the site |
| **Click routing** | `data-btn` (main.ts) · `data-help` · `data-learn` · `data-lmenu` · `data-lbtn` · `data-lcard` · `data-lpart` · `data-crl` · `data-crs` · `data-crui` (marker) · `data-sbx` · `data-replay` · `data-croq` |

---

## L. Design smells (concrete)

1. **A second (and third, and fourth) palette.**
   - `.crdoc` redefines `--line` and **`--accent` = blue `#7fb6e0`** plus 18 more tokens (style.css:5323-5331). On the same page the bar, rail, margin threads and composer use the global gold `--accent`, so the CR page has two accent colours side by side, and `button:hover {border-color: var(--accent)}` is blue inside the column and gold outside.
   - The public CR page (F) has its own light/dark token set and IBM Plex fonts; framed inside the dark help box it renders **light** on a light-mode OS.
   - `sandbox.ts:420-460` injects a whole stylesheet with ~15 hard-coded hexes (`#1d2330 #141922 #3a4759 #263041 #33405a #2f5d8a #4b83bb #0d1119 #29323f #222b37 #e8ecf4 #d7dee8 #7fb3e8`) and re-declares `font: 12px/1.4 system-ui`.
2. **Unscoped class collisions.**
   - `.el-fire … .el-dark {background: var(--…)}` from Card Stats (style.css:3802-3804) paints the Learn menu's element buttons (`learnel el-<e>`, learnmenu.ts:22) solid element colours; Metal (#9aa5b0) under #d6dde6 text fails contrast. Likely accidental — verify in a browser.
   - `.lplay` is both the lesson slideshow ▶ button (lessonlayer.ts:141) and the regions board's play-zone (style.css:4293: overflow hidden, min-width 0, padding).
   - `.lres` is both the lesson stack's "resolved" row (lessons.ts:117) and the board's resource cell (`.linfo .lres`, scoped there — safe today, a trap tomorrow).
   - `.res` from the CR renderer needs an explicit reset against the client's orb (style.css:5383).
3. **Hard-coded colours outside tokens:** `.helprow` border `#232a33` (style.css:1016); `.bookframe` `#fff` (1056); `button.primary` `#3c5a2f/#5b8747` (53); `.lcallout` gold as `rgba(217,164,65,…)` (3613-3614); `.lanchor.on`/`mark.crhl`/`.crsbody mark` target as `rgba(224,185,60,…)` (3635, 5207, 5248); `.lfigcard.cross` `#ff2d7a` (3624); `.lwall` `#ff6b9a` (3675); `.lregion.mine/.theirs` glow/danger re-typed as rgba (3669-3670); `.lfigback` gradient `#2a2f3a/#232833` (3625); `.rqmoment.on` `#1d2b1a` (3972); dead `.ldslot/.ldunit` `#22384a/#3a2622` (3564-3566).
4. **Inline `style=` / JS-set styles:** anatomy anchors `style="left:%;top:%"` (lessonlayer.ts:92); `--cols` ×3 (114, 117, 119); `--mods`/`--i` (128-129); stack pile `--k`/`--n` injected by **string-replacing another function's HTML** (lessons.ts:114-117); preview `style.left/top/display` (lessonlayer.ts:349-355); CR chip `left/top` (crlayer.ts:247); margin cards `style.top` & `minHeight` (crreview.ts:899-918); copy fallback `ta.style.cssText` (crreview.ts:870); `onerror="this.style…"` inline handlers in `artHtml`/`elIcon` (cardpanel.ts:46, util.ts:14).
5. **Emoji as icons everywhere** (no icon set): `📖` How to play / rulebook quotes · `📘` learn heading, pill, toolbar · `⚖` judge, ask · `✕` · `▁` hide · `⏮ ▶ ⏸ ⏭` slideshow · `➜` flow · `▸` turn strip · `🏁` lesson number · `✓` seen/resolved · `🧪` scenario & sandbox · `✓ ✗ ≈ ⚠` verdicts · `▾▸` collapse · `↗` external · `💬` comment/counts · `＋` (fullwidth) add · `↻` refresh · `❓` questions · `⬇` download · `☰` contents · `←` close · `📜` rules review · `↺` rewind · `🔥`-style element pngs. The only real vector icon is the CR copy-link SVG (crreview.ts:825). Emoji render differently per OS and carry no aria-label.
6. **`.hint` has no base style.** Used for the judge empty state, `thinking…`, `sources:` and `cards:` (main.ts:5163, 5169, 5172-5173) and the scenario's "prints no rules text" (scenario.ts:145) — they render as full-contrast body text. Only context-scoped `.x .hint` rules exist.
7. **Error states styled as success / as normal text:** scenario `NOT recorded — …` is green (`.scnstatus`, scenario.ts:211 + style.css:2555); judge failures and lesson-judge failures look exactly like answers (main.ts:5202-5205, lessonlayer.ts:325); CR document load error uses dim `.crnote` (crreview.ts:680) while comment errors use red `.crmsg`.
8. **Invalid CSS:** `font: 14px/1.4 inherit` is not a valid shorthand (keyword `inherit` cannot be combined) — the whole declaration is dropped in `.rulesq` (style.css:1025) and `.ljask input` (3577).
9. **Dead CSS / dead hooks:** `.rulesrc` (1040), `.ldiag .ldside .ldcols .ldcol .ldslot .ldunit .ldnote` (3559-3568), `.lfcols .lfcol .lfslot` (3639-3644, superseded by `.lfgrid`), `.crframe` (no rule), `#app.crapp` (no rule), `.crc.mine` (no rule).
10. **Typography drift:** body 13px system-ui; CR column 15px/1.6 system-ui with `h2` **Georgia serif 22px** (style.css:5332-5333); `.crwhere`/`.crslab` ui-monospace; card titles elsewhere EB Garamond; sizes used in this area alone: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 22, 24, 26, 72px. Headings: help `h3` default size gold, learn/lesson `h3` 18px, CR title is a `<b>` in a bar, section headings are uppercase 12px `h4`s (help) or 15px gold `h4` (lesson).
11. **Accessibility gaps:**
    - help box has no `role="dialog"`/`aria-modal`/label and no focus trap (rules.ts:774); learn/lesson boxes have role+label but no focus trap or return-focus.
    - unlabeled inputs: `#rules-q`, `#judge-q`, `#ljudge-q`, `#cr-draft`, `#sbx-q`, `#sbx-life`, scenario textareas/select (placeholder only).
    - tabs without `role=tab`/`aria-selected` (help, CR tabs, CR filters, element picker, sandbox zones).
    - `a.lcard` has no href (not focusable); `.lpart` arrows and card previews are hover-only (no keyboard path; `.lpart` has no tap path).
    - icon-only buttons with only `title`: `✕`, `↻`, `⏮▶⏭`, `−/+`, `🧪`, `⚖`, `?`.
    - page dots `.ldots` convey position visually only.
    - `html.touch .overlay button {min-height:36px}` (style.css:4022) covers the on-board help/judge boxes but NOT the same help box off-board (`.helpscrim`), nor `.learnscrim`, `.lessonscrim`, `.crscrim` — touch targets shrink depending on which shell drew them.
    - native `window.confirm` for Delete and Discard (crreview.ts:1102, crlayer.ts:318); `Start over` in the learn menu wipes progress with no confirm at all (learnmenu.ts:68).
12. **`.lhl` mutates the board it highlights:** `position:relative; z-index:77` on arbitrary selectors (style.css:3662-3664) — can shift absolutely-positioned board furniture while a lesson page is open.
13. **Copy inconsistencies:** CR `← Close` title says "back to the lobby" (crreview.ts:686); `Continue your fire game` (lower-case) next to `Fire` chip; `⚖ ask` vs `Ask`; `Got it (enter)` vs `Cancel (esc)` hint casing; the end lesson tells players "**? rules** (on the toolbar)" while the toolbar button is a bare `?`.
14. **Two Rules-ish surfaces render glossary data differently:** the help box's Attributes rows (`entryHtml`, 170px label column) and the inspector's "Referenced rules" (`glossRow`, main.ts:5005, the same `.helprow` class at 110px label width because it is outside `.helpbox`).

---

## M. Storybook isolatability

| surface | pure HTML function? | what it reads besides its args | what a story must stub / refactor | event wiring |
|---|---|---|---|---|
| **A Rules box** | `rulesBoxHtml(tab, q)` exported, nearly pure; `entryHtml`, `sectionHtml`, `rulesListHtml`, `bookHtml`, `crHtml(at)`, `tutorialListHtml(q)`, `tutorialSectionHtml` all pure & exported | **`crAt` module global** read inside `rulesBoxHtml` (rules.ts:770); JSON imports (`scan-reminders.json`, glossary → `printed.json`, manual/library reminders) with `with {type:'json'}` import attributes; `iconizeText` needs icon URLs from assets.ts (relative `ART_BASE`/`ICON_BASE`) | make `crAt` a parameter; Storybook's bundler must accept JSON import attributes; serve `data/icons` as static; the iframes need `/data/rules/Algomancy-Manual.pdf` and `/comprehensive-rules` (mock or static copy) | document-level delegated listeners: `installRulesOverlay()` (input/keydown) + `installHelpLayer()` (capture click/keydown, MutationObserver on `#app`); on the board, main.ts `data-btn` handlers. A story needs a `#app` element and to call both installers, or a thin decorator that re-implements tab switching |
| **B Learn menu** | `menuHtml(progress, el)` exported & pure | `elIcon` image URLs; `ALL_LESSONS` import pulls lessons.ts → cardindex (catalogue.json) | none for markup; for interaction stub `localStorage` (`algoLearn`) and `location.search` navigation | `installLearnMenu()` capture listener on document for `data-learn`/`data-lmenu` |
| **C Lesson window** | `windowHtml(model)`, `pageHtml(page, ctx)`, `figureHtml(f)`, `figCardHtml(fc)`, `pillHtml(label)`, `lessonInline(src)` exported | `rowFor()` card index (catalogue + registry: large engine import); `artHtml` scan URLs; **`figSeq` module counter** makes frame ids differ per render (snapshot-unstable); content functions take a `LessonCtx` (a GameState) — `null` falls back to `EMPTY_CTX` | pass `ctx: null` for static stories, or fixtures of GameState for state-dependent pages; reset/seed `figSeq`; serve card scans | `installLessonLayer(host)` needs a `LessonHost` (lessons, ctx, seen, markSeen, **judge promise**, endActions, onAction) — that interface is a good story seam; plus `setInterval` (frames), `#lessonprev`, `setHoverArrows` from anim.ts (arrow layer), `highlight()` querying the real document |
| **D Judge box** | **No.** `judgeOverlayHtml()` takes no args and reads main.ts module globals `judgeLog`, `judgeBusy`; not exported; input wiring lives in main.ts `rewireInputs` | importing main.ts boots the whole app (side effects at module scope) | extract `judgeBoxHtml({log, busy, draft})` + `judgeSourcesHtml` into their own module (as lessonlayer already does for its judge) | main.ts global `data-btn` (`judgeopen/judgeask/judgeclose`) + per-paint input listeners |
| **E CR review page** | Only `commentHtml(c)` is exported. `tabsHtml`, `tocHtml`, `threadHtml`, `columnHtml`, `downloadsHtml`, `questionsHtml`, `paint` read ~30 module globals (`doc, comments, you, tab, view, filter, showResolved, expanded, focusId, dlOpen, questionsOpen, tocOpen, msg, rev, place, resolveTarget…`) | `fetch('/api/cr/review')`, `fetch('/api/cr/comments')`, POST `/api/cr/comment`, 30s poll; `acct.token()/authHeaders()` (localStorage); `decorate()` needs a real DOM (text-node splitting, `getBoundingClientRect` for the margin, `getComputedStyle`); `threadHtml → isOutdated → document.getElementById('crdoc')`; `history.replaceState` | Either (a) mount the real page: `initCrReview({app, rerender})` + MSW/fetch mocks with a fixture `CrReviewDoc` and `CrCommentsReply`, or (b) refactor the painters to `(state) => html` and keep `decorate()` as a post-mount effect. The fixture doc is big (render.mjs output) — generate one small fixture | `handleButton()` contract with main.ts (`cr-*` via main's global `data-btn` listener, main.ts:11207) — a story must route clicks to `crr.handleButton` itself |
| **E crlayer (chip/composer/sheet)** | painters not exported but driven by exported `openComposer(c)`, `showSheet(title, html)` with a pluggable `setCrLayerHost(host)` | `window.getSelection`, `document.documentElement.classList.contains('touch')` | easiest story in the area: install layer, set a fake host, call `openComposer({...})` | `data-crl` capture listener; pointerdown/mouseup/selectionchange/scroll |
| **E crsearch** | index/search/highlight/snippet are pure & exported; the box itself is **imperative `createElement`**, not a template | host (`setCrSearchHost`) | story = `setCrSearchHost({active, doc, go})` + `mountSearch(div)` | own listeners on the element |
| **F public CR page** | static generated HTML | — | load the file as-is | — |
| **G question panel** | `questionHtml(q, at)` not exported; reads `qOpen` | ReplayServer | export it with `open` as a parameter | `data-replay` listeners in replaybar.ts |
| **H Scenario panel** | `panelHtml(room, closable)` exported; reads module `info/busy/status/detailOpen/drafts` | seed with `setScenario(fixture)` — trivial | none for markup; `rewire()` for drafts | main.ts global `data-btn` → `scn.handleButton(btn, ctx)` (exported, takes a ctx) |
| **I Sandbox panel** | `panelHtml(s, seat, room)` **not exported**; reads module state (`query, zone, pool, collapsed, status`) | `allCardNames()` (engine registry), `cardsearch.search` over all rows; injected `<style>`; MutationObserver on `#app` | export `panelHtml` and its CSS (move CSS into style.css); story with a GameState fixture `{sandbox:true, elements, players, phase…}` | `data-sbx` capture listener |
| markdown | `mdToHtml` pure | — | — | — |

**Cross-cutting prerequisites for any Storybook here:** (1) `style.css` loaded globally (it is one file; the CR and lesson rules are not separable today); (2) static serving of `data/icons`, `data/cards` scans, the PDF, and `/comprehensive-rules`; (3) JSON import attributes in the bundler; (4) no module may import `main.ts` (it boots the app) — the judge box and the on-board help shell must be extracted first; (5) most interaction is document-level capture listeners keyed on custom `data-*` namespaces, so each story needs the relevant `install…()` called once per story iframe, and `#app` present.

---

## N. Responsive & input-mode summary (this area)

| breakpoint / mode | effect | style.css |
|---|---|---|
| ≤1100px | on-board `.overlay.mainonly` right edge 228px (classic rail legacy; regions board overrides to 52px) | 962, 960 |
| ≤700px | help rows stack; learn/lesson boxes tighter; lesson figures shrink (150→110, anatomy 230→170, formation cells 96→64, modded 170→120); `.lside` stops floating | 1057-1060, 3600-3604, 3687-3697, 3707-3714 |
| ≤720px | question link field hidden; question top row wraps | 3986-3989 |
| ≤900px | lesson pill smaller | 4084 |
| ≤1179px | CR rail → drawer, 2 columns | 5309-5317 |
| ≤819px | CR one column, margin → sheet, composer → bottom sheet | 5318-5322 |
| `html.touch` | `.kh` hints hidden; `.overlay button` min-height 36 (board shell only); `.crshare` larger; CR chip drops 30px below selection | 4017, 4022, 5220; crlayer.ts:115-119 |
| `prefers-reduced-motion` | **not honoured** by `.lanchor.on` pulse, `.lhl` pulse, `.lframe` fade, `.crflash`, auto-looping frames | 3635-3636, 3662-3664, 3655-3656, 5212 |
