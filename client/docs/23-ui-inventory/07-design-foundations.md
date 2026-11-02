# 07 — Design foundations as they exist today

Scope: `client/ui/style.css` (5,395 lines, the one stylesheet) plus every style value hard-coded in `client/ui/*.ts` (inline `style=""`, `.style.*` writes, the two stylesheets injected from TS, SVG/canvas), `index.html`, `fonts/`, `og/` and the icon files. Read-only census, taken 2026-11-02 at master `ba32fcf4`. All line numbers are `style.css` unless a file is named.

Method: a small brace-matching parser (comments blanked, line numbers kept) split the sheet into **2,626 rules / 8,309 declarations / 80 at-rules**; every count below comes from that or from grep over the TS. The one-off scripts were not kept; re-derive with grep if a number matters.

## Headline numbers

| | count |
|---|---|
| Custom properties defined | **73 distinct names** in 88 declarations: 40 on `:root` (spread over three separate `:root` blocks, lines 2, 2782, 4245), 18 in a second palette scoped to `.crdoc`, 30 scoped or redefined elsewhere. Another **40 names** are used but never defined in CSS (TS writes them at runtime). |
| Distinct literal colours | **352** (337 in style.css out of 556 colour literals, plus 15 in TS). 249 of them are used exactly once. 113 literals reproduce a token's value, or a token's RGB at some alpha, by hand. |
| Distinct font sizes | **45** (24 px values from 8px to 72px, 8 em values, 10 cqw values, 2 `max()` expressions, plus 0). 27 declarations use half-pixel sizes. No type scale. |
| Distinct border radii | **16 px values** (1–22px, plus 999px), 23 counting %/cqw; 36 distinct full `border-radius` strings. |
| Distinct box-shadows | 93 distinct out of 112 declarations. |
| `!important` | **5** (2264, 2947, 3581, 3662, 4151). Low; specificity is handled with id and long chains instead (below). |
| Breakpoints | 50 `@media` + 1 `@container` in style.css (+1 `@media` in legal.ts). **15 distinct size conditions**: 11 max-width values, 3 max-height values, 1 combination. 13 `prefers-reduced-motion` blocks. 0 `prefers-color-scheme`, 0 `hover`/`pointer` queries. |
| z-index | 104 declarations, **39 distinct values** (from -1 to 500). |
| Emoji / symbol icons in TS | **83 distinct glyphs, 384 occurrences**: 35 pictographic emoji (103 uses) and 48 BMP symbols/arrows (281 uses). |
| Comments | 558 comments, 1,825 of the 5,395 lines (34%). 195 cite a ticket, report, owner, round or date. |

---

## 1. Token audit

### 1a. The `:root` palette (the real design tokens), style.css:2–36

| token | value | `var()` uses in CSS | in TS | notes |
|---|---|---|---|---|
| `--bg` | `#12151a` | 20 | 0 | Same literal is hard-coded 3 more times (1787, 2759, 2912), in `index.html` `theme-color` and in `site-icons.py:31`. Fallback `var(--bg, #111)` ×4 (dead, since it is always defined). |
| `--panel` | `#1a1f27` | 62 | 2 (legal.ts) | |
| `--panel2` | `#20262f` | 93 | 3 (legal.ts) | |
| `--line` | `#2e3742` | 188 | 6 | Redefined in `.crdoc` as `#2e3740` (2 hex digits apart). |
| `--text` | `#d6dde6` | 98 | 4 | rgba of its RGB written out ×3 (4283, 4453, 4454). |
| `--dim` | `#8794a3` | 225 | 20 | Most used inline-style token (`style="color:var(--dim)"` ×15 in TS). |
| `--accent` | `#d9a441` (gold) | 292 | 11 | Most used token. rgba(217,164,65,α) written out by hand ×11 at 8 different alphas. Redefined in `.crdoc` as **`#7fb6e0` (blue)**. Dead fallback `var(--accent, #5865F2)` (Discord blurple) at 3467. |
| `--danger` | `#d95454` | 72 | 2 | rgba(217,84,84,α) by hand ×10. Dead fallback `var(--danger, #d9534f)` at 85, a different red. |
| `--glow` | `#6fc36f` (green) | 104 | 0 | rgba(111,195,111,α) by hand **×22 at 14 alphas**. Dead fallback `var(--glow, #b7e26a)` (1567), a different green. |
| `--target` | `#e0b93c` (gold #2) | 41 | 0 | rgba(224,185,60,α) by hand ×12. |
| `--pending` | `#3fd2c0` (teal) | 4 | 0 | |
| `--fire --water --earth --wood --metal --light --dark` | `#d95436 #3f8fd9 #8a6b3d #4e8a3d #9aa5b0 #f2ead6 #6a7382` | 8 / 12 / 7 / 7 / 7 / 8 / 4 | 0 | Element colours. `--fire` (#d95436) and `--danger` (#d95454) differ by one channel. |
| `--light-ink --dark-ink --metal-ink` | `#2b2417 #ffffff #222222` | 3 each | 0 | `--dark-ink` is just white; `#fff` is written literally 25 more times. |
| `--bar-fire … --bar-dark` (7) | printed name-bar colours | **0** | dynamic | Never referenced statically; `main.ts:6979` builds `var(--bar-${el})`. Not dead, but grep cannot see it. |
| `--card-title` | `'Card Title', 'EB Garamond', …, serif` | 1 | 0 | The only font token. |
| `--cw` | `78px` | 37 | 1 | Card width. Redefined at 610 (62px under 1100px), 2785 (`.ttpage`, 132px), 4033 (74px), and written per zone by `fit.ts`/`layout.ts`/`tabletop.ts`. |
| `--gap` / `--gap-tight` | `2px` / `1px` | 23 / **0** | 0 | `--gap-tight` is defined and never used. These are the game board's gaps, not a page spacing scale. |
| `--ringpad` | `5px` | 3 | 0 | |

Second and third `:root` blocks (styles appended later instead of added to the first block):
- **2782** `--bdw: 300px; --ddh: 46vh; --felt: #172520` (tabletop/binder), with `html.touch { --bdw: 340px }` at 2783.
- **4245** `--rgn0: #d9a441` (a **copy of `--accent`'s value**, not a reference to it), `--rgn0-tint: rgba(217,164,65,.09)`, `--rgn1: #52a877`, `--rgn1-tint: rgba(74,158,104,.10)`. Note that `--rgn1-tint`'s RGB (74,158,104) is not `--rgn1`'s RGB (82,168,119).

### 1b. The second palette: `.crdoc`, style.css:5280–5288 (rules review page)

```
--surface:#1a2026  --fg:#e3e8ec  --muted:#9aa6b0  --line:#2e3740
--accent:#7fb6e0  --accent-soft:#1d3142
--ok:#6fcf9c --ok-bg:#173327  --warn:#e6b75c --warn-bg:#3a2d12  --bad:#f08a8d --bad-bg:#3c1c1e
--c-printed:#82b3dd --c-designer:#c3a3ec --c-mixed:#8cc6bf --c-owner:#e6ac63 --c-engine:#f08a8d
--font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace
```

It comes from the CR pipeline's own `render.mjs` stylesheet, pasted in and scoped. It is the only place the codebase has **semantic status tokens** (ok/warn/bad with matching `-bg`) and a **mono font token**. Inside `.crdoc`, `--accent` is blue, so the same `var(--accent)` paints gold on every other page and blue in the CR document. It also renames the base roles: `--surface` ≈ `--panel`, `--fg` ≈ `--text`, `--muted` ≈ `--dim`.

**Phantom tokens.** Some of these names are used outside `.crdoc`, where they are never defined, so only the fallback ever applies:
- `--warn` at 79, 1258 ×2, 1260 ×2 falls back to `#e8b64c`, but at 830 it falls back to `#e0b93c`. One "token" resolves to two different golds.
- `--bad` at 3490 and 3504 (admin) falls back to `#e66`.
- `--fg` at 1565 (`.ridechip`) falls back to `#e8e6df`.

### 1c. Other scoped definitions (component-local variables)

`--binth`/`--cacheth`/`--rcw` (`.linfo …`, 4347–4434, including inside `@container`), `--linh`/`--linspect`/`--lint` (`.lboard`, 4207–4235), `--rows` (`.bhalf.top/.bot`, 1168), `--d`/`--dkstep` (`.dktile`, 2705), `--ch` (`.ttpage`), `--crcolw: 96ch` (`.crbody`), `--modpeek` (`.modstrip`), `--ink`/`--inkshadow` (2406), and `--zglow`/`--zring` (`#cardzoom > .zoomcopy`, 4915–4921, five state values, the one tidy use of a local variable for a state colour).

### 1d. Runtime-only variables (written by TS, never defined in CSS): 40 names

`--a --b --t1 --t2 --i --j --k --n --edge --mods --cols --cardback --cast-x --cast-y --fanstep --invw --lbandb --lbandt --lead --lidle --pick-railclear --pilestep --resstep --rowsbot --rowstop --sentcols --stack-shift --stack-top --stack-x --stack-y --stackstep --table-bottom --table-left --table-mid --table-right --tbbot --tbtop --tokcols --traycols` (plus `--bar-*` assembled dynamically). Writers: main.ts (most), layout.ts, lessonlayer.ts, decks.ts, meta.ts, deckstrip.ts, piletable.ts, lessons.ts, tabletop.ts. These are layout plumbing for the board, not design tokens. A design-system pass should leave them alone but **namespace** them (for example `--_stack-x`) so they cannot be confused with tokens.

### 1e. Defined but never used
`--gap-tight`. (`--bar-*` look unused but are used dynamically.)

### 1f. Values used often but never tokenised
- **Black scrim/shadow alphas**: `rgba(0,0,0,α)` 90 uses at **21 different alphas** (.15 … .9); `rgba(6,8,11,α)` (a near-`--bg` scrim) ×11 at 6 alphas.
- **White hairline/hover alphas**: `rgba(255,255,255,α)` 20 uses at 14 alphas.
- **The "primary green" button pair** `#3c5a2f` / `#5b8747` (53, 3363, 3364) plus hover `#476b37`.
- **Gold tint backgrounds** for "warning-ish" boxes: `#33270f`, `#7a5e1e`, `#1a1406`, `#262016`, `#2d2716`, `#2a2314`, `#2a2418`.
- **Green tint backgrounds**: `#1d2b1a` ×4, `#1a2318`, `#1c2a1c`, `#1d3020`, `#173327`.
- **Red tint backgrounds**: `#2b1a1a` ×2, `#3a1e1e`, `#3c1c1e`, `#2a1c22`.
- **Slate borders** `#3a4759` ×4, `#3b4654` ×2, `#3d4b5c` ×2, … (11 values within ΔE 5, see §2).
- **A "link blue"** `#7fc0ff` ×8 (+ `rgba(127,192,255,…)` ×2). It is the 2nd most-used literal hex and has no token.
- **`#ffffff`** ×26 (`--dark-ink` exists but means "ink on the Dark element", not "white").
- **Font sizes** (§3), **radii** (§4), **z-indexes** (§6), **durations** (§7): none tokenised.

---

## 2. Colour census

**556 colour literals in style.css → 337 distinct**; 220 are `rgba()`, 332 hex, 4 `color-mix()`, 0 `hsl()`, and no named colours apart from `transparent` (29) and `currentColor` (2). TS adds 15 more distinct values:
- **`sandbox.ts:420–460`**: an entire injected stylesheet with its own slate-blue palette: `#1d2330 #e8ecf4 #3a4759 #141922 #d7dee8 #263041 #33405a #2f5d8a #4b83bb #0d1119 #29323f #222b37 #7fb3e8`. None of it uses a token.
- **`legal.ts:446–515`**: a second injected stylesheet (footer + legal overlay). It mostly uses tokens but hard-codes `#0d1014` and `rgba(6,8,11,.78)`.
- **`cardstats.ts:142`**: the heatmap: `rgba(79,179,201,α)` (teal) / `rgba(224,123,57,α)` (orange), computed alphas.
- `main.ts:2806/2813` writes `style="color:${…}"` choosing between `var(--dim)` and `inherit`; 87 inline `style=` attributes in total across 13 files (45 in main.ts), almost all positional or runtime variables. The cosmetic ones are `color:var(--dim)` ×15, `color:var(--danger)` ×2, `text-transform:uppercase`, and three hand-written `display:inline-flex;…gap:.2em/.3em` blocks.
- Mirrored outside CSS: `index.html` `theme-color="#12151a"`; `site-icons.py:31–34` hard-codes `--bg --panel --accent --text` (with comments saying so), plus `#f3f5f8` and `#8b96a3` for the OG text.
- SVG: two inline SVGs (`crreview.ts:825` link icon, `main.ts:4544` region ring) and arrows built in `anim.ts:523–851`; all colour through classes or `currentColor`. No canvas.

### 2a. Families (CSS + TS, distinct values and total uses)

| family | distinct | uses | the spread |
|---|---|---|---|
| near-black page/scrim backgrounds (L<16%) | **66** | 96 | `#111` ×7, `#12151a`, `#0b0d11`, `#0d1014`, `#0d1119`, `#11151b`, `#14181f`, `#141922`, `#151515`, `#1a1a1a`, `#1b2028`, `#1f2630` …; plus 20 different `rgba(r,g,b,.55–.96)` translucent darks |
| slate/blue-grey + blues | 53 | 74 | slate borders `#384352 … #454f5c` (11 within ΔE<5); blues `#3f8fd9 #5b9ed9 #6fa8e0 #6c9bf0 #7fb3e8 #7fb6e0 #7fc0ff #82b3dd #8fb4dd #93c6ef #cfe6ff`; violets `#9a8ad9 #9d8bf0 #b9abec #c9bff0 #6d5bd0 #6d5fa8 #5b6ea8 #4b4470` |
| gold/amber | **46** | 72 | `--accent #d9a441`, `--target #e0b93c`, `#e8b64c` ×5, `#f0c040` ×4, `#e0a93c` ×2, `#e3b341`, `#e0ae52`, `#e6b75c`, `#c8912f`, `#f0d27a`, `#e2c778` ×2, `#f0c983` ×2, `#c9b477`: **13 opaque golds** that all mean "accent/attention", plus 21 gold rgba tints |
| green | 39 | 54 | `--glow #6fc36f`, `#7fdc7f`, `#86e086`, `#8fe08f`, `#9fe0a4`, `#6fcf9c`, `#52a877`, `#3f8a46`, `#3f7a45`, `#356b37`, `#4e8a3d` …; `rgba(111,195,111,α)` at 14 alphas |
| red/pink | 31 | 37 | `--danger #d95454`, `#d9534f`, `#d95436` (fire), `#ee6666`/`#e66`, `#f08a8d`, `#ff8a8a`, `#ff7373`, `#ff6b5a`, `#d98080`, `#953636`, `#c0271a` … |
| dark neutrals (16–32%) | 24 | 37 | `#444` ×5, `#3a4049`, `#3a4048`, `#2e3740`, `#2e3742`, `#333b47`, `#29323f`, `#2a2f3a` … |
| light neutrals / text | 24 | 60 | `#fff` ×26, `#cfd8e3`, `#c9ced6`, `#ccd3dc`, `#cdd6e2`, `#cfd6e0`, `#d6dde6` (text), `#d7dee8`, `#e3e8ec`, `#e8e6df`, `#e8ecf4`, `#eee`, `#f2f5f9`, `#fafafa` |
| black alpha | 22 | 90 | 21 alphas: .15 .18 .22 .25 .28 .4 .45 .47 .5 .53 .55 .6 .62 .65 .7 .72 .75 .78 .8 .85 .9 |
| white alpha | 14 | 20 | .03 .04 .05 .06 .07 .08 .1 .14 .15 .16 .2 .32 .35 .45 |
| purple | 12 | 16 | `#b48ce0` ×4 (the "selected/carrying" ring), `#c98bdb`, `#d6b8f2`, `#9a6fb8`, `#e86fd8`, `#ff2d7a` … |
| mid greys | 7 | 8 | `#6a7382` (`--dark`), `#6b7382` ×2 (1 digit off it), `#777`, `#7c8593`, `#555` … |
| orange/copper | 6 | 6 | `#e07b39`, `#e6ac63`, `#824a11` … |
| teal | 3 | 4 | `--pending #3fd2c0`, `#4fb3c9` ×2, `#8cc6bf` |

### 2b. Near-duplicate clusters (opaque, CIE ΔE < 5: indistinguishable to most eyes)

- **12** within ΔE<5 of `#1d3142`: `#1d3142 #222b37 #22384a #232838 #232a36 #263041 #263042 #29323f #2a2f3a #2a3140 #2b3440 #2e3a4e`
- **11** slate borders: `#384352 #3a434f #3a4356 #3a444f #3a4553 #3a4759 #3b4654 #3b4a5e #3d4a5c #3d4b5c #454f5c`
- **11** panel-greys around `--panel`/`--panel2`: `#14181f #141922 #1a1f27(--panel) #1a1f29 #1a2026 #1b2028 #1d2330 #1f2630 #20262f(--panel2) #232833 #232a33`
- **8** page blacks around `--bg`: `#050505 #06080b #0b0d11 #0d1014 #111111 #12151a(--bg) #151515 #1a1a1a`
- **7** text greys around `--text`: `#c9ced6 #ccd3dc #cdd6e2 #cfd6e0 #cfd8e3 #d6dde6(--text) #d7dee8`
- **5** line greys around `--line`: `#2e3740 #2e3742(--line) #333b47 #3a4048 #3a4049`
- 4 dark golds (`#17130a #1a1206 #1a1405 #1a1406`), 4 dark greens (`#1c2a1c #1d2b1a #1d3020 #262c18`), 4 dim greys (`#99a3b2 #9aa5b0(--metal) #9aa6b0(--muted) #9aa7b8`), 4 brown-darks, 3 whites, 3 blues around `#7fb6e0`.

In effect the ~11 neutral roles the UI needs (bg, 2 surfaces, raised, line, strong line, text, dim text, …) are spelled with **~70 distinct greys**.

### 2c. Literals that should obviously have been a token (exact or alpha of a token's RGB)

| token | hand-written copies |
|---|---|
| `--glow` | 22 × `rgba(111,195,111,α)` (128, 129, 277, 279, 498, 1212–1249, …) |
| `--dark-ink`/white | 25 × `#fff` + 20 × `rgba(255,255,255,α)` |
| `--target` | 1 × `#e0b93c` + 12 × `rgba(224,185,60,α)` (1184, 1624, 3635, 3664, 4921, 5204–5244) |
| `--accent` | 11 × `rgba(217,164,65,α)` (492, 497, 1379, 1594, 2380, 3613, 3746, 4270, 4450) + `--rgn0` copying it |
| `--danger` | 10 × `rgba(217,84,84,α)` |
| `--bg` | 3 × `#12151a` + 4 dead `var(--bg, #111)` fallbacks |
| `--water`, `--text`, `--felt`, `--rgn1`, `--metal` | 3, 3, 1, 1, 1 |

Total: **113** hand copies. Only 4 places use `color-mix()` (4152, 4920, 4960, 4962), the modern way to derive these tints from the token itself.

---

## 3. Typography census

### Families
| family | where | uses |
|---|---|---|
| `system-ui, sans-serif` at **13px/1.4** | `body` (40), the global default | inherited everywhere |
| `system-ui, sans-serif` again | 135, 1627, 4834, 4844, 5242, 5312; `system-ui` alone at 383, 398; `sandbox.ts:422` (12px/1.4) | 9 |
| `system-ui, -apple-system, "Segoe UI", sans-serif` | `.crdoc` (5286), **15px/1.6** | 1 |
| `'Card Title'` (= EB Garamond Bold, `@font-face` at 37, `fonts/EBGaramond-Bold.woff2`, 25 KB, OFL) via `--card-title` | stack card names, 2398 | 1 |
| `Georgia, serif` / `Georgia, 'Times New Roman', serif` | `.crdoc h2` (5289), card zoom title (4814) | 2 |
| monospace, three spellings | `ui-monospace, monospace` ×11, `monospace` ×3, `var(--font-mono)` ×4 | 18 |
| `inherit` | 5 | |

`index.html` loads no web fonts. EB Garamond Bold is the only bundled face, used for **card titles only**: no page heading anywhere uses it, so the non-game pages are entirely `system-ui`.

### Sizes: 547 declarations (`font-size` + `font:` shorthand), 45 distinct values
- **px (495 decls, 24 values)**: `8`×10 `9`×22 `10`×41 `10.5`×8 `11`×91 `11.5`×8 **`12`×161** `12.5`×7 `13`×58 `13.5`×3 `14`×22 `14.5`×2 `15`×22 `16`×9 `17`×7 `18`×3 `19`×3 `20`×3 `21`×1 `22`×6 `24`×2 `26`×3 `30`×2 `72`×1
- **em (18 decls, 8 values)**: `.55 .72 .8 .82 .85 .88 .9 .92` (written `0.85`/`.85` and `0.92`/`.92` both ways)
- **cqw (12 decls, 10 values)**: `3.4 3.6 4.2 4.6 5.6 5.8 6.4 9.6 62 70`, the card zoom and stack-card faces, which scale with their container
- **other**: `max(11px, calc(var(--cw)*.24))`, `max(8px, calc(var(--cw)*.3))`, `0`; `font: inherit` ×21 (buttons/inputs)
- rem: **zero** font sizes in rem (rem appears only in admin padding).
- 66% of px sizes are 11–13px. The body text is 13px, the workhorse is 12px, labels are 10–11px.

**Is there a type scale? No.** Between 10px and 16px there are 13 steps (10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16), so adjacent sizes are visually indistinguishable. Page-title sizes alone take 7 values (15, 17, 18, 19, 22, 24, 26, 30).

### Weights, line-heights, spacing, case
- **font-weight**: `700`×114, `600`×30, `400`×17, `800`×7, `500`×7, `900`×2. In practice two weights (normal, 700); 600 and 800 are noise.
- **line-height: 24 distinct values**: unitless `1 1.1 1.15 1.2 1.25 1.3 1.35 1.4 1.45 1.5 1.55 1.6 1.9` and px `9 10 12 13 14 15 16 18 20 22`.
- **letter-spacing: 13 values**: `.06em`×23 `.04em`×14 `.08em`×12 `.02em`×8 `.1em`×7 `.05em`×5 `.03em`×4 `.3em` (the wordmark) `.2em` (the room-code input) `.16em` `0` `normal`.
- **text-transform**: `uppercase`×50 (the "small label" idiom), `capitalize`×2, `none`×8.
- `font-variant-numeric: tabular-nums` ×21; `small-caps` ×1; `italic` ×5.

### The de-facto "small caps label" idiom, written out separately each time
`color: var(--dim); font-size: 10–12px; text-transform: uppercase; letter-spacing: .04–.1em; (font-weight: 700)`. It is spelled independently in `.zonelabel` (185, 11px/.08em), `.abhead` (1546, 10px/.08em), `.accttable th` (1858, 10px/.05em), `.dkaff thead th` (3003, 11px/.05em), `.lgbbody h3` (5080, 11px/.08em), `.updates h2` (484, 12px), `.dkgrouphead` (2648, accent, 11px/.06em), `.pgunlockedhead` (2076, accent, 11px/.06em), `.accttab` (1819, 11px/.06em), `.cbsectionhead` (3076, 12px/.03em), `.betatag` (1359, 10px/.08em), `.constag` (1872, 10px/.03em), `.lgtag` (5022, 10px/.06em), `.replaychip` (3917, 11px/.06em), `.badgechip` (933, .55em/.04em), `sandbox.ts .sbxlabel` (11px/.05em), `legal.ts #legalover h2` (15px/.04em, accent). That is **17+ copies at 6 sizes and 6 trackings.**

### Headings: no global h1–h6 rule; every heading is styled per page
No rule targets a bare `h1`–`h5`, so headings get browser defaults (h1 = 2em = 26px, h2 = 19.5px, h3 = 15.2px at the 13px body) unless a page overrides them. TS emits h1 ×18, h2 ×46, h3 ×99, h4 ×27, h5 ×2 across ~25 files.

| level | per-page rules (line: size) |
|---|---|
| h1 | `.accthead h1` 1814: 26px/.04em (the page title on Profile, Cards, Card stats, Metagame, Duel ladder, Deck, Weekly challenge, League, Decks); `.deckpage h1` 2566: **22px**; `.adminhead h1` 3484: browser default; `.homelogo` 427/449/1932: accent, .3em tracking, **30px** home, **24px** lobby |
| h2 | `.homecard` 17px text 700 · `.lobbyhead` 15px · `.cbdetail` 17px · `.cbhelp` 18px · `.queuehead` 19px · `.dkmodalhead` 17px · `.updates` 12px dim uppercase · `.joinscreen`/`.acctscreen` accent, default size · `.crdoc` **600 22px/1.3 Georgia** · `#legalover` (legal.ts) 15px accent uppercase |
| h3 | 27 rules: `.overlaybox` accent · `.acctcard` accent 14px · `.dkmodalbox` accent 13px · `.lhead` 18px · `.lgbbody` dim 11px uppercase · `.chbox` accent · `.crdoc h3` · `.battle h3` · `.logpanel h3` · `.judgea h3` · … |
| h4 | 14 rules (`.helpscroll`, `.inspectscroll`, `.acctcard`, `.achgroup`, `.csdetail`, `.csboard`, `.crdoc` …) |

The same semantic slot (a card or dialog heading) is accent-coloured on some pages (overlay, acctcard, dkmodalbox, chbox, legal) and text-coloured on others (homecard, lobbyhead, cbdetail).

### Invalid declarations found
`font: 14px/1.4 inherit` (1025 `.rulesq`, 3577 `.ljask input`), `font: 700 19px/1.2 inherit` (2613 `.deckname`), `font: 600 13px/1.3 inherit` (3136 `.cbrowname`). A CSS-wide keyword cannot stand in for the family inside the `font` shorthand, so **these four declarations are dropped by the browser**. The intended size, weight and line-height never apply; the elements fall back to whatever else styles them (for an `<input>`, the UA's ~13.3px).

---

## 4. Spacing & sizing census

| property | decls | distinct full values | distinct atoms | most common |
|---|---|---|---|---|
| padding | 528 | **175** | 62 | `0`×36, `6px`×24, `8px 10px`×18, `8px`×17, `0 4px`, `6px 8px`, `4px`, `4px 10px` ×13 each |
| margin | 499 | **106** | 51 | `0`×89, `6px`×51, `4px`×35, `8px`×31, `auto`×27, `2px`×26, `0 0 6px`×16 |
| gap | 352 | 36 | 28 | `6px`×81, `8px`×56, `4px`×48, `10px`×33, `2px`×21, `3px`×20, `12px`×16, `14px`×13 |

- **px atoms across padding/margin/gap: 1,529.** 83% are even, but only **38% are multiples of 4**, and 64% fall on a {2,4,6,8,12,16,20,24,32,40,48} scale. Odd values are common: `3px`×94, `5px`×64, `1px`×42, `7px`×25, `9px`×22, `11px`×10. **Every integer from 1px to 16px is in use.**
- Units are mixed: px dominates; `rem` appears only in the admin page and a few chips (`.15rem .35rem .4rem .5rem .6rem .8rem 1rem`); `em` in a few inline TS styles (`gap:.2em`); `cqw` on the card zoom; `vh` on two dialogs.
- **Spacing scale: none.** `--gap` (2px) / `--ringpad` (5px) are the game board's gutters. On the non-game pages, page padding comes in at least six recipes: `30px 22px 44px` (home, lobby), `12px 22px 24px` (deck, cards), `10px 18px 32px` (meta), `12px` (account), `1rem` (admin), `24px` (join screen).
- **Page widths**: 420 (join), 760 (legal panel), 1000 (lobby), 1100 (account, meta), 1180 (home, updates), 1400 (deck, metadeck, admin, legal footer), 1480 (card stats), 1500 (card browser, game `#app`), 96ch (CR body). That is 8 container widths.

### Border radius: 330 decls, 36 distinct full values
`6px`×64 · `5px`×49 · `8px`×41 · `4px`×39 · `10px`×36 · `3px`×28 · `0`×52 · `50%`×15 · `7px`×14 · `9px`×12 · `999px`×10 · `12px`×5 · `2px`×3 · `1px`×2 · `14 15 20 22px`×1 each · `20%` · cqw ×4.
**Ten radii between 2px and 12px are in active use.** Panel-like boxes alone use 6, 7, 8, 9, 10 and 14px. Pills use both `999px` and `10px`/`20px`.

### Borders
- widths: `1px`×243, `2px`×45, `3px`×23 (mostly `border-left` accent bars), `4px`×1, cqw ×3
- styles: `solid`×275, **`dashed`×37, `dotted`×14**. Dashed and dotted are used as semantic signals (decline buttons, ghost slots, table row rules, `.homesep`, `.spentcache`), with no rule about which means what.
- shapes: `1px solid <c>` ×204 is the one universal border.

### Box shadows: 112 decls, **93 distinct**
- **Elevation drops** (floating panels): roughly 35 different recipes for the same job, e.g. `0 10px 30px rgba(0,0,0,.6)` ×4, `0 6px 24px rgba(0,0,0,.55)` ×3, `0 4px 18px .45`, `0 8px 28px .55`, `0 10px 40px .6`, `0 14px 50px .65`, `0 12px 40px .55`, `0 18px 40px .65`, `0 18px 50px .6`, `0 5px 14px .6`, `0 5px 16px .6`, `0 5px 20px .5`, `0 6px 16px .6`, `0 6px 20px .6`, `0 6px 20px .45`, `0 8px 20px .7`, `0 8px 26px .65`, `0 8px 30px .7`, `0 10px 22px .65`, `0 10px 24px .5`, `0 10px 28px .7`, `0 3px 12px .5/.6`, `0 4px 14px .4`, `0 4px 16px .5/.55`, `0 2px 8px .4/.6`, `0 1px 4px .55/.6`. There is no elevation scale.
- **Focus/state rings** as spread shadows: `0 0 0 2px|3px|6px <colour>` in accent, danger, glow, target, `#b48ce0`, `#f0c040`, black, `#c9ced6`.
- **Glows**: about 20 green/gold/red/blue/pink glows.
- text-shadow ×5 (5 distinct); `filter` ×24, mostly `grayscale()/brightness()` on inactive cards (12 distinct recipes).

---

## 5. Breakpoints & environment

**style.css: 50 `@media` + 1 `@container`; legal.ts: 1 `@media`.**

| condition | count | lines | targets |
|---|---|---|---|
| `max-width: 620px` | 1 (+1 legal.ts) | 504 | updates list; legal store grid |
| `max-width: 700px` | 7 | 1057, 3600, 3687, 3697, 3706, 3714, 3827 | help box; Learn to Play; card stats |
| `max-width: 720px` | 3 | 3888, 3951, 3986 | deck modals; replay bar |
| `max-width: 760px` | 1 | 5035 | league |
| `max-width: 780px` | 1 | 1939 | lobby grid |
| `max-width: 819px` | 1 | 5271 | CR review |
| `max-width: 900px` | 8 | 2568, 2883, 2925, 2977, 3144, 4063, 4080, 4100 | decks, tabletop, binder, card browser, touch rail |
| `max-width: 1000px` | 1 | 3202 | deck work area |
| `max-width: 1100px` | 6 | 609, 962, 3055, 3064, 4077, 4091 | `--cw` shrink, overlays, card browser |
| `max-width: 1100px and min-height: 800px` | 1 | 4032 | board card size |
| `max-width: 1179px` | 1 | 5262 | CR review TOC |
| `max-width: 1366px` | 1 | 2974 | tabletop deck strip |
| `max-height: 600px / 820px / 860px` | 1 / 2 / 2 | 5004 / 4231, 4235 / 4720, 4731 | board toolbar and info line |
| `@container (max-width: 1100px)` | 1 | 4419 | `.linfo` (container-type `size` at 4307) |
| `prefers-reduced-motion: reduce` | **13** | 153 … 4963 | see §7 |
| `prefers-color-scheme` | **0** | | **no light theme exists**; nothing anywhere sets `color-scheme` either, so native controls (scrollbars, `<select>` popups, date pickers) render in the light UA scheme on a dark page |
| `hover` / `pointer` / `any-pointer` | **0** | | deliberately: touch is detected in JS (`touch.ts:132–136`, `pointerType`) and written as `html.touch` |

- **11 different max-width breakpoints, 8 of them between 620 and 1000px** (620, 700, 720, 760, 780, 819, 900, 1000). These are per-page "whatever looked broken" values, not a system. 700/720 and 1100/1179 are near-pairs. Everything is desktop-down (`max-width`); there are no `min-width` (mobile-first) queries.
- Container queries: 6 containers declared (`.xdie.num`, `.placewarn`, `.stackcard.fx`, `.linfo`, `.linfo .lspect`, `#cardzoom > .zoomcopy`) for the cqw-sized card faces, but only one `@container` rule.
- **`html.touch`: 26 selectors / 21 rules** (982, 2783, 2910, 2973, 2980, 4016–4076, 4141, 5002, 5220) plus `.touchonly` ×2, and `html:not(.dragging):not(.touch):not(.zoompress)` (2839) as a hover gate. Main block: "TOUCH (2026-09-27)", 3997–4141.
- `index.html` has a `viewport` meta (`width=device-width, initial-scale=1`).

---

## 6. Z-index census: 104 declarations, 39 distinct values, no scale

From the top of the stack down (value, line, element):

| z | element(s) |
|---|---|
| **500** | `.ttcard:hover` (2839, tabletop) |
| **450** | `.ttcard.draglift`, `.ttcard.ttpicked` (2841–2842) |
| **400** | `.ttcard.ttfront` (2840) |
| var(--k) | `.ttcard` (2828), plus inline `style="z-index:${i+1}"` from main.ts:7209 |
| **95** | `#app.board.v2 .menu` (583), `#lessonprev` (3553), `.dkmodal` (3843), `#draglayer` (4146) |
| **90** | `.toast` (1368), `.hovertip` (2503), `#cardzoom` (4740), `#sbx-root` (sandbox.ts:422), `#legalover` (legal.ts:487) |
| 89 | `#ressum` (4755), `#infotip` (4772) |
| 85 | `body.lessonreading .arrowlayer` (3619) |
| 80 | `.helpscrim` (1047), `.crtoast` (5221) |
| 77 | `.lhl` (3663), `.chscrim` (5388) |
| 76 | `.lessonscrim, .learnscrim` (3524), `.lessonpill` (3585) |
| 75 | `.crchip` (5248) |
| 72 | `.crscrim` (5250) |
| 70 | `.menu` (580), `.revealscrim` (1276), `.reportscrim` (1291) |
| 69 | `.amendscrim` (1347) |
| 66 | `.amendbar` (1361) |
| 61 | `.costtoasts` (3328) |
| 60 | `.overlay` (891), `.glimpsenotice` (909), `.stackcard:hover` (2264, **`!important`**), `.cbdetail` under 1100px (4093) |
| 59 | `#app.board.pickup > .side` (4118), toolbar `.tbpop` (4984) |
| 58 | `.animlayer` (1581), `.overlay.pickover` (4105), `.overlay.psover` (4125), toolbar `.scnpop` (4987) |
| 56 | `.inboxlist, .invitepops` (1305) |
| 55 | `.reportfab` (1293), `.inboxbell` (1300), `.arrowlayer` (1610), `.replaybar` (3902) |
| 50 | `.menu` (332, the **first** of its three definitions), `#binderlayer .ddpanel` (2895) |
| 49 | `html.ddfull .ddscrim` ≤900px (2931) |
| 46 | `.stackboard.live` (2114), `.castpending` (2146) |
| 45 | `.stickytop` (705) |
| 40 | `.crtoc` ≤1179px (5266) |
| 35 | `.crsresults` (5234) |
| 30 | `.ttmenu` (2797), `.crbar` (5140) |
| 0–6 | 60 local stacking tweaks inside cards, tiles and tables (1×11, 2×13, 3×12, 4×4, 5×2, 6×4, 0×2, -1 `.ltail`, auto) |

Problems: values in the 45–95 band were picked one at a time, adjacent to whatever needed beating (55/56/58/59/60/61, 69/70/72/75/76/77). **Five unrelated layers share 90** (toast, hover tip, card zoom, sandbox panel, legal overlay) and **four share 95** (board menu, lesson preview, deck modal, drag layer), so their relative order depends on DOM order. The tabletop's 400–500 sits above every modal (95), so a tabletop card under hover can paint over a dialog opened from that page. The `.menu` element is defined three times at z 50 → 70 → 95.

---

## 7. Motion

- **28 `@keyframes`**, all used: `barnudgea/b` (64–65, two identical copies so the class can alternate), `lifedown/lifeup` (122/127), `lifedelta`/`lifedeltastill` (141/148), `actpulse` 277, `glimpsein` 925, `fspulse` 1186, `modpulse` 1214, `clockwarn` 1261, `animland/animhurt/animbuff` 1593–1604, `waitpulse` 1725, `livepulse` 1752, `stackopen/stackclose` 2139/2141, `stackpending` 2303, `stackflash` 2313, `costtoastin` 3348, `qspin` 3436, `lpulse` 3636, `lfade` 3656, `lhlpulse` 3664, `zoomactpulse` 4925, `tboffline` 4962, `crflash` 5210.
- **44 `animation*` declarations** (15 `infinite` pulses) and **16 `transition*` declarations**.
- **Durations (25 distinct)**: `0s .01ms 90ms .09s .12s .14s .15s .18s 180ms 220ms .3s 300ms .35s .45s .5s .7s .8s 900ms 1s 1.1s 1.2s 1.4s 1.6s 1.8s 3s`. Units are mixed (`.18s` and `180ms` both appear; `.3s` and `300ms` both appear). Clusters: micro 90–150ms (hover/transition), short 180–300ms (enter/exit), feedback 0.45–1.1s (flashes), pulse 1–1.8s.
- **Easing**: `ease-out`×18, `ease-in-out`×14, `ease`×3, `ease-in`×1, `linear`×1 in CSS. In JS (Web Animations API): `anim.ts:72` `cubic-bezier(.35,.05,.2,1)` (FLIP 200ms, flights 240–460ms), `anim.ts:423` `cubic-bezier(.2,1.3,.4,1)` (overshoot 260ms), `layout.ts:~626` ring morph `cubic-bezier(.2,.7,.2,1)` 420ms, `drag.ts:198` `cubic-bezier(.2,.8,.3,1)` 180ms. **Four bespoke curves in JS, none shared with CSS.**
- **Reduced motion**: 13 CSS blocks plus `matchMedia('(prefers-reduced-motion: reduce)')` in `anim.ts:27`, `drag.ts:133`, `zoom.ts:250`. It is handled per feature, not globally. Infinite pulses with **no** reduced-motion override found: `.card.activatable` `actpulse` (280), `.card.modhost` / `.stackcard.modhost` `modpulse` (1216, 1221; the `.stackcard { animation:none }` at 2345 has lower specificity than `.stackcard.modhost`), `.livedot` `livepulse` (1751; only the `.promptbar.waiting` instance is stopped), `.pgwants` (2091), `.lanchor.on` `lpulse` (3635), `.lhl` `lhlpulse` (3663). `.qspin` is slowed to 3s rather than stopped.

---

## 8. Component-class census (de-facto components)

1,447 distinct class names; 2,771 selectors. Below, the families a design system would turn into components.

### 8a. Buttons: one base, ~60 context overrides, three meanings of "primary"
**Base** (50–54): `button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 5px 12px; font: inherit }`, `:hover { border-color: var(--accent) }`, `:disabled { opacity: .4 }`. No `:focus-visible` style on buttons anywhere (2 `:focus-visible` rules in the whole sheet, both in `.crdoc`).

**Variants that exist:**
| variant | definition | notes |
|---|---|---|
| `button.primary` | 53: **green fill** `#3c5a2f` / border `#5b8747` | the only global variant; 58 `<button class="primary">` + 11 `<button class="cta primary">` in TS |
| "primary" re-skinned to **gold outline** | `.homebtns .primary` 432, `.homecard .cta.primary` 468, `.dkicon.primary` 2634, `.ttdeckhead .ttplay.primary` 2953, `.chplayrow .cta.primary` 5381, `legal.ts .lgbuy.primary` | sets only border+colour, so on `<button>`s the green fill from 53 **still shows under a gold border and gold text** (on `.lgbuy`, an `<a>`, it does not) |
| `button.commitbtn` | 3363–3366: the green pair again, written out a second time, with its own hover `#476b37` and disabled `.45` (base uses `.4`) | |
| `.cta` | **no base rule**: only `.homecard .cta` (11px 14px / 15px / 700), `.lgbhead .cta` (7px 16px), `.chplayrow .cta` (10px 22px / 700) | three different CTA sizes |
| **toggle `.on`** | `border-color: var(--accent); color: var(--accent)`, written out as an identical standalone rule **28 times** (754, 1514, 2644, 3051, 3273, 3729, 3967, 4052, 4061, 4069, 4951, 5046, 5126, 5142, 5145, 5359 …), plus variants that add `font-weight:700` (`.helptab.on` 1024, `.accttab.on` 1820, `.cbchip.on` 3094, `.chtabs button.on` 5362) or `opacity:1` | the admin tabs do it differently: **filled** accent (`.admintab.on` 3487, `.adminacts button.on` 3503) |
| danger | TS emits `<button class="danger">` (main.ts, the arming toggle) but there is **no global `.danger` rule**; `border-color+color: var(--danger)` is instead written ×9 (`button.declinebtn:hover` 739, `.scnbtn.scn-broken` 2548, `.dkdanger` 2624, `.cbchip.off` 3096, `.dkkind.off` 3211, `.replaychip.bad` 3921, `.lgpage button.danger` 5026, `.reportchoices …gamebreaking.on` 1341 (+ bg `#2b1a1a`), `.clocktime.exp` 1250) | no shared class |
| ghost / dashed | `button.declinebtn` 738 (transparent, dashed, dim) | |
| link-button | `.linkbtn` 3718 (accent, dotted underline); `.logpanel div.logcurtain button` 1516 (dim, dotted underline); `.spentcache > button` 1731 (dim, no underline); `.pgpeek:hover` 2093 | 4 copies |
| icon button | toolbar `#app.board.v2 > .toolbar > button` 4945 (18px glyph, 38px basis); `.dkicon`; `✕` close buttons (30 in TS) with no shared class; `.seenx` 870 (round, water border) | |
| overlay button bar | `.dkbtns button` 2756 (flat, white, on a black .72 strip, hover = accent fill with `#12151a` text) | |
| sizes | per-context padding: `2px 6px` (`.decall`, `.crsugg`), `2px 8px` (`.rulesjump`, `.cbviews`, `.cracts`, `.chmeter`), `3px 7–10px` (`.friendrow`, `.roomfriend`, `.ddchips`, `.lheadbtns`, `.lgtimechips`), `4px 10px` (`.invbtns`, `.acctbar`, `.lobbyrankbtns`), `5px 12px` (base), `6px 14px` (`.deckimport`), `8px 16px` (`.learngo`), `9px` (`.homebtns`), `10px` (`.pgbtns`), `10px 18px` / `10px 24px` (`.homecard .joinrow`, `.lobbygo`) | **about 15 sizes**, with font-size 11–16px independently |
| touch | `html.touch … button { min-height: 36px }` (4021) | |

Names the brief asked about: `.homedecks` (2570) is just `margin-top: 6px` on a stock button (`main.ts:9375` "🗂 My decks"), with an accent variant `.homedecks.lgnavjoin` (5126). `.headbtns` (1935–1936) is `margin-left:auto` plus `font-size:12px; padding:5px 12px`. `.accthbtns` (1816) is the same idea on account-style pages.

A **third button system** lives in `sandbox.ts:437–443` (`#sbx-root button`: `#263041` fill, `#3a4759` border, radius 4px, padding `3px 7px`, a `.sbxgo` blue primary `#2f5d8a`), and `legal.ts` dresses links as buttons (`.lgdiscord`, `.lgbuy` with radius 7px, padding `9px 14px`).

### 8b. Inputs, selects, textareas, checkboxes: **no base rule**
The recipe `background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 6px 8px` is re-declared about **15 times**: 352 `.joinscreen input`, 429 `.namerow input`, 435 `.joinrow input` (+ room-code tracking `.2em`), 518 `.deckpaste textarea` (`font: 12px monospace`), 750 `.decsearch input` (bg `#11151b`!), 1082 `.judgerow input`, 1331 `.reportbox textarea`, 1350/1352 `.amendbox`, 2008 `.crbans input`, 3047 `.cbtools select` (padding 2px 4px), 3475 `.pgclaim input` (rem padding), 3931 `.replayspeed select`, 5042 `.lgtzrow input` (radius **4px**), 5119 `.lgtimepick select` (bg **`--panel`**, radius 4px), 5254 `.crcomposer textarea`. Search fields use a **darker** variant on `var(--bg)` with radius 7px: `.rulesq` 1025, `.cbq` 3034 (`15px` monospace!), `.crsinput` 5231, `.ljask input` 3577. `sandbox.ts` has its own (`#0d1119`, radius 4px).
- Focus: `:focus { outline: none; border-color: var(--accent) }` is written 6 times (753, 1027, 2616, 3037, 5233, + 2819 `input.ttpilename`). **`outline: none` ×8** removes the focus ring with only a 1px border colour change as its replacement, and the other inputs have no focus style beyond the UA's.
- Checkboxes: native (3 in TS), plus **fake** ☑/☐ glyph checkboxes in `customrulespanel.ts:143` and main.ts. One `type="range"`, five `type="number"`, six `type="password"`. None are styled (no `accent-color`).
- Labels: `.lgform label` / `.lgtzrow label` (column, 12px dim) in the league; `.joinscreen label` (block); nothing global.

### 8c. Panels / cards: one recipe, ~95 copies
About 98 rules match `background: var(--panel|--panel2|dark literal) + border + border-radius` (the list was a one-off scratch file, not kept). The recipe is `background: var(--panel); border: 1px solid var(--line); border-radius: R; padding: P`, written out per class:
- **Page cards**: `.homecard` 459 (r10, `16px 18px 18px`), `.lobbypanel` 1940 (r10, `14px 16px 16px`), `.acctcard` 1824 (**r6**, `12px 14px 14px`), `.queuepanel` 3410 (r10, `18px 20px 20px`), `.queuestrip` 3399 (r10, border `#3b4654`), `.deckhero` 2602 (r8, 12px), `.cbdetail` 3151 (**r9**, 12px), `.cbhelp` 3174 (r9), `.cbsection` 3074 (**r7**), `.csboard` 3817 (r9), `.cstablewrap` 3741 (r8), `.deckrow` 2580 (r8), `.deckimportbox` 2576 (r8), `.updlist` 486 (r10, p0), `.joinscreen` 348 (r10, 24px), `.lgbanner` 5064 (r10, accent border).
- **Inset / secondary (on `--panel2`)**: `.lobbyfoot` 1966 (r10), `.statcell` 1839 (r5), `.ach` 1883 (r6), `.invitecard` 1311 (r8), `.deckdesc` 3249 (r7), `.dkdesctext` 3263 (r7), `.dksyntax` 3877 (r8), `.youstanding` 3451 (r6), `.replaydetail` 3922 (r6), `.rqmore` 3974 (r6), `.lgtimeform` 5115 (r6), `.crdl` 5152 (r6), `.cstile` 3773 (r7), `.textbox` 2442 (r6), `.lgpost` 5123 (r4), `.dkexport`/`.ddpinbox` (r8).
- **"Emphasised" panels with an accent border**: `.overlaybox` 893, `.draftpanel` 538, `.sharebar` 411, `.amendbar` 1361, `.trioreveal` 2028, `.lessonbox` 3526, `.cbdeckbar` 3190, `.dkdrawer` 2762, `.chbox` 5390, `.chmeter` 5384, `.crcomposer` 5251, `.lgbanner` 5064. These are radius 6, 8 or 10 with no pattern.
- **Coloured status panels**: `.promptbar` 56 (green `#262c18`/`#4a5b2a`), `.promptbar.pending` (gold `#33270f`/`#7a5e1e`), `.promptbar.playbar` (slate `#1f2630`/`#3d4a5c`), `.pwwarn` 531 (danger border), `.toast` 1368 (green `#1d2b1a`), `.packback` 1240 (green `#17241c`), `.scnpanel` 2531 (`--pending` border).
- `.panel`: **no such class exists**.
- Panel radii in use: 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20. Panel paddings: about 30 distinct.

### 8d. Chips, badges, pills, tags: about 20 independent implementations
`.elchip` 941 (a button: opacity .55, 2px border, element-coloured border when `.on`), `.reschip` 382 (14px element dot, gradients for light/dark/prismite/shard), `.badgechip` 933 (pill 999px, uppercase .55em; `.owner` accent fill, `.admin` `var(--bad,#e66)` fill, `.trophy.champion` `#e0a93c`, `.finalist` `#b8c2cc`), `.card .badge` 246 (r3, `rgba(20,24,30,.9)`, `#444` border) and `.stackcard .badge` 2204 (r `0 3px 3px 0`), `.badge.tgtnow` 3390, `.cchip` 1449 (r8, purple `#232838/#c9bff0/#4b4470`; `.proph.on` green, `.glimpse.on` gold), `.ridechip` 1564 (r10, `#7a5e1e` border, `--fg` phantom), `.passallchip` 880, `.constag` 1872 (r3, uppercase 10px), `.betatag` 1359 (r3), `.lgtag` 5022 (**r8**, uppercase 10px), `.tbbadge` 2452 (accent fill, r3, 9px), `.cbchip` 3093, `.stchip` 3505 (r4, rem padding, white/green/blue rgba fills), `.replaychip` 3917 (999px, good/warn/bad with three tint bgs), `.lbadge` 3626, `.lessonpill` 3585 (r20), `.crchip` (two meanings, below), `.crchipx` (CR review status), `.tokchip`, `.cachechip` …
- Status semantics (good/warn/bad) are re-invented in `.replaychip` (glow/accent/danger + `#1a2318/#262016/#2b1a1a`), `.stchip` (rgba greens/blues), `.crdoc .v-*` (the `--ok/--warn/--bad` tokens), `.constag` and the admin badges. That is five vocabularies for one idea.
- **Class collision:** `.crchip` is defined at **2011** (Custom Rules: the banned-card chip in `customrulespanel.ts:149`) and again at **5248** (CR review: the floating "💬 Comment" chip from `crlayer.ts:247`, `position: fixed; z-index: 75; padding: 4px 10px; accent border; shadow`). Both are global, so the ban chips also get `position: fixed` and the accent border. This is very likely a live layout bug in the Custom rules panel; it needs a look in a browser.

### 8e. Dialogs and scrims: ~12 scrims and ~10 box styles
Scrims (`position: fixed; inset: 0` + dark fill):
| scrim | z | fill |
|---|---|---|
| `.overlay` 891 | 60 | `rgba(6,8,11,.72)` |
| `.amendscrim` 1347 | 69 | `.72` |
| `.revealscrim` 1276, `.reportscrim` 1291 | 70 | `.72` |
| `.crscrim` 5250 | 72 | `rgba(6,8,11,.55)` |
| `.lessonscrim/.learnscrim` 3524 | 76 | `.62` |
| `.chscrim` 5388 | 77 | `.62` |
| `.helpscrim` 1047 | 80 | `.72` |
| `#legalover` (legal.ts:487) | 90 | `.78` |
| `.dkmodal` 3843 | 95 | **`rgba(0,0,0,.62)`** |
| `.ddscrim` 2931 | 49 | **`rgba(0,0,0,.45)`** |
| `.pgover` 2041 / `.trioover` 2027 | (via `.overlay`) | |

Boxes: `.overlaybox` (accent border, r10, `18px 22px`, `min(92vw,560px)`), with width modifiers `.helpbox` 640/800, `.inspectbox` 620, `.revealbox` 640, `.reportbox` 520, `.amendbox` 560, `.logbox` 820; `.pgbox` (**line** border, r10, `20px 24px`); `.dkmodalbox` (line, r10, `16px 18px`); `.chbox` (accent, r10, `14px 16px`); `.lessonbox/.learnbox` (accent, r10, `14px 18px`); `#legalover .lgpanel` (line, **r12**); `.trioreveal` (accent, **r8**, `20px 24px`); `.crcomposer` (accent, r8, `12px 14px`). Close buttons: `✕` glyph ×30 in TS, `overlaybox > button { align-self: flex-end }`, `.lgclose`, `.cbclose`. No shared dialog header. No `<dialog>` element is used.

### 8f. Tabs: 8 implementations, 2 active styles
`.helptabs/.helptab` 1022 (12px, opacity .75 → accent + 700), `.accttabs/.accttab` 1818 (**uppercase 11px .06em**), `.admintabs/.admintab.on` 3486 (**filled accent**, rem gaps), `.metatabs button.on` 3725/3729, `.crtabs/.crtab.on` 5144, `.chtabs button.on` 5362 (+700), `.logpanel .logmode.on` 1514, `.cbviews button.on` 3050, `#legalover .lgtabs` (legal.ts). All are ordinary buttons with an `.on` modifier; none have tab semantics in CSS beyond that.

### 8g. Tables: 8 implementations
`.accttable` 1858 (th: 10px uppercase dim .05em, `border-bottom 1px line`; td: `1px dotted`), also used by the league and by `.dksyntax`; `.pgtable` 2059 (th 13px **text 700**; td `border-top dotted`); `.dkaff` 3001 (th 11px uppercase; solid borders); `.cbkeys` 3185 (th dim 600); `.admintable` 3495 (rem padding, `rgba(255,255,255,.08)` borders); `.cstable` 3743 (sticky header/first column on `--panel2/--panel`, hover `rgba(255,255,255,.03)`, selected `rgba(217,164,65,.10)`); `#ressum .rstab` 4761; `#infotip .tiptab/.toktab` 4777. Cell padding: `4px 6px`, `3px 8px`, `3px 7px`, `.35rem .5rem`, `2px 6px`, `1px 12px 1px 0`. Header treatments: 4 different.

### 8h. Tooltips, popovers, menus
`.hovertip` 2503 (card art tip, z90, drop-shadow filter), `#infotip` 4772 and `#ressum` 4755 (identical `panel / line / r8 / 0 10px 30px .6` shell, z89, written twice), `#cardzoom .zoomhang` 2418 and `.zoommenu` 1008 (`rgba(20,24,30,.96)`, r8), `.menu` 331/574/580 (accent border, r6, three definitions), `.ttmenu` 2797 (line border, r8, z30), toolbar `.tbpop` 4984 (r8, z59), `.inboxlist` 1307 (r10, z56). Native `title=""` tooltips are used heavily in TS (the hover help on most icon buttons).

### 8i. Toasts: 3 implementations
`.toast` 1368 (**green**: `#1d2b1a` bg, glow border+text, r8, bottom 18px, z90), `.costtoast` 3333 (panel, `border-left 3px danger`, r7, in a `.costtoasts` stack at z61), `.crtoast` 5221 (panel, **accent** border, r6, bottom 24px, z80, the only one with a CSS transition). `toast.ts` drives the first.

### 8j. Labels and helper text
- `.zonelabel` 185 is the only global "small label" class (dim 11px uppercase .08em); see §3 for its 17 re-spellings.
- **`.hint` has no global rule.** It is used **160 times** in TS, but CSS styles it only inside 21 context selectors, and only **3** of them give it the dim colour (355 `.joinscreen`, 1091 `.inspectscroll h4`, 1815 `.accthead`). Everywhere else a `.hint` is plain body text with UA margins.
- **`.dim` has no global rule** either: 115 TS uses, 11 scoped CSS rules, some meaning `color: var(--dim)` (1970, 4786, 5020) and some meaning `opacity: .45–.6` (1733, 3499, 5021).
- `.cardsub` 465 exists only as `.homecard .cardsub` (dim 12px/1.5) and `.singleduel .cardsub`.
- `legal.ts .lgdim` (dim 11.5px) is its own helper class.

### 8k. Page headers: 8 near-identical flex rows
| header | line | layout | rule under it | title |
|---|---|---|---|---|
| `.homehead` | 447 | flex, gap 18, center | `1px solid line`, pb 16 | `.homelogo` 30px accent .3em |
| `.lobbyhead` | 1930 | flex, gap 16, **baseline** | `1px solid line`, pb 14 | `.homelogo` 24px + `h2` 15px |
| `.accthead` | 1812 | flex, gap 16, **flex-start** | `1px solid line`, pb 10, mb 12 | `h1` 26px .04em (on 9 pages) |
| `.deckpage h1` | 2566 | (inside `.accthead`) | | **22px** override |
| `.queuehead` | 3413 | flex, gap 10, space-between | none | `h2` 19px |
| `.adminhead` | 3483 | flex, gap .8rem, baseline | none | `h1` UA default |
| `.lhead` | 3530 | flex, gap 10, baseline | none | `h3` 18px |
| `.dkmodalhead`, `.helphead`, `.lgbhead`, `.ttdeckhead`, `.cbdeckbar` | 3855, 1021, 5072, 2950, 3190 | variants | | |

The account-style `.accthead` became the de-facto page header for Profile, Cards, Card stats, Metagame, Duel ladder, Deck, Decks, Weekly challenge and League. Home and Lobby use their own; Admin, Queue and CR review use theirs.

---

## 9. Structure of style.css

### 9a. Sections in order (`/* ── … ── */` ×67 and `/* ═══ … */` ×9 banners)

| lines | section | kind |
|---|---|---|
| 1–87 | `:root` tokens, `@font-face`, `body`, `#app` grid (1fr 290px), base `button`, `.promptbar` | shared + game |
| 88–334 | life meter, cards, battle, log | game |
| 335–356 | network mode (`.joinscreen`) | non-game |
| 357–416 | resource cards; presence + share | game |
| 417–545 | pre-game screens: home, recent updates, deck picker + waiting lobby, live draft panel | **non-game** |
| 546–929 | playtest UX fixes (2026-08-18); region-board overhaul + playtest round 2 | game (hotfix layers) |
| 930–951 | element chips | shared |
| 952–1381 | hotfixes (bins, help/judge, overlays); playtest rounds 3 and 4 (clocks, report, hotkeys) | game + shared dialogs (help, judge, report, amend, inbox, toast) |
| 1382–1640 | Light & Dark: rot/debt, cache zone, modular, log lines, §log modal, anim layer, targeting arrows | game |
| 1641–1766 | board fills the window; watching a formation | game |
| 1767–1918 | **accounts**: home strip, sign-in, profile, achievements | non-game |
| 1919–2036 | **draft lobby** | non-game |
| 2037–2094 | **post-game screen** | non-game (over the board) |
| 2095–2556 | the stack (+ four colours, abilities), text box, scenario tester strip | game |
| 2557–3020 | **deck collection, tabletop, binder, deck strip, curve, affinity table** | non-game |
| 3021–3304 | **card browser; BL-34/35/36 descriptions, publishing, metagame** | non-game |
| 3305–3394 | cost toasts; CR D7.2b tier | game |
| 3395–3519 | **matchmaking queue; admin dashboard** | non-game |
| 3520–3715 | Learn to Play (rounds 1–2) | mixed (layer over a board) |
| 3716–3894 | **single card duel; card stats; deck modals** | non-game |
| 3895–3996 | replay transport | game |
| 3997–4156 | TOUCH; DRAG TO PLAY | shared/game |
| 4157–5018 | THE REGIONS BOARD (info line, phase icons, in-play, invaders, battle, piles, fit, stack placement, round 7, card zoom, resource window, info tip, round 4, board-round-8 toolbar) | game |
| 5019–5129 | **league page** | non-game |
| 5130–5354 | **rules review page** (with its own palette) | non-game |
| 5355–5395 | **weekly challenge** | non-game |

**Approximate split:** non-game pages ≈ 1,910 lines (35%), the Learn to Play overlay ≈ 200 lines, game board + shared ≈ 3,290 lines (61%). Non-game styling is **not one block**: it sits in 10 separate runs, interleaved with game hotfix sections in roughly chronological order of when each feature shipped. The file is a changelog, not a structure. Shared primitives (button, input recipe, panel recipe, dialog) are defined either at the top (button only) or inside whichever feature needed them first (dialogs live inside "hotfixes" and "playtest round 4").

### 9b. Hotfix layering
- 558 comments, **1,825 comment lines (34% of the file)**.
- **195 comments** cite a ticket, report, owner, round or date: CT-n in 26 comments, BL-n in 30, `#n` report ids in 35, "report" in 39, "owner" in 61, "playtest" in 21, "round N" in 32, a 2026 date in 77, CR numbers in 32.
- Section titles are themselves dated rounds ("playtest round 3 (2026-08-18)", "round 4 (owner, 2026-09-26)", "BOARD ROUND 8", "CHECKPOINT 4", "ROUND 7"). Later rounds override earlier ones further down rather than editing them. **94 selectors are defined in more than one rule** in the same context: `:root` ×3, `.menu` ×3 (331, 574, 580), `.card`/`.rescard`/`.stackcard` ×3, `#app.board.v2 .handdock` ×3, `.linfo`/`.lplay`/`.linv` ×3, `#cardzoom > .zoomcopy` ×3, `.side` ×2 (43, 586), `button` ×2, `body` ×2, `.logpanel h3` ×2 (326, 1510), `.rescard.dormant` ×2 (371, 551), …

### 9c. Specificity
- `!important`: **5** (2264 `.stackcard:hover` z-index, 2947 `#app > .ttpage` min-height, 3581, 3662, 4151).
- **id selectors in 214 selectors**: `#app` ×100, `#cardzoom` ×64, `#infotip` ×19, `#ressum` ×13, `#draglayer` ×12, `#binderlayer` ×5, `#lessonprev` ×1; plus `#legalover`/`#legalfoot`/`#sbx-root` in the TS sheets.
- `#app.board.v2`-prefixed selectors ×72 (the "v2" board is now the only board, but the prefix stayed); `.lboard`-prefixed ×60.
- Highest specificity: `#app.board.v2 > .toolbar > .tbstat .presence.off .tbsub` (1,7,0); `body:has(> #app.board.v2 > .toolbar .setgroup.open) .lessonpill` (1,6,1); about ten others at (1,6,0).
- Combinator depth: 0 → 1,425 selectors, 1 → 1,008, 2 → 273, 3 → 52, 4 → 12, 5 → 1. `:has()` ×38, `:not()` ×18, `:is()` ×6.
- Because so much is scoped (`.homecard .cta.primary`, `.lobbyhead .headbtns button`), any future component class has to beat (0,3,0)–(1,6,0) chains. That is the main reason a design-system pass should start by **removing context-scoped re-skins** rather than adding classes on top of them.

---

## 10. Icons & imagery

### 10a. Emoji and symbol glyphs as icons: 83 distinct, 384 uses in TS (comments excluded)
**Pictographic emoji (35 distinct, 103 uses)**: 🏆×9 (league/trophies), 🏅×8, 📜×7 (rules/prophesy), 🛠×6 (admin/amend), 👁×6 (reveals), 📘×6 (learn), 📝×6 (report), 💬×4 (CR comment), 🔍×4 (cards/search), 📖×4 (how to play), 🧪×4 (scenario/test), 🧩×3 (challenge), 👍/👎×3 (admin triage), 🎲×3, 🔒×3, 🚫×2, 🏳×2 (concede), ✅×2, 🪝×2 (lured), 🗣×2 (named), ✨×2 (spell tokens), 🎯×2 (targeted), 🥈, 🔥 (streak), 🌱 (beginner), 🔗 (share), 🔔 (bell), 🚪 (leave), 🛡, ✋, 🏁, 🔮, 🎉, 🎭, 🔊/🔇, 🗂 (my decks).
**BMP symbols (48 distinct, 281 uses)**: `×` ×35 (counts and close), `✕` ×30 (close/remove), `→` ×29, `✓` ×22, `▶` ×19 (play/watch/cast), `▾`/`▸`/`▴` ×20 (disclosure carets), `⚖` ×9 (judge), `↺ ↻ ↶ ↩` ×15 (undo/rewind/refresh), `☰` ×7 (menu/contents), `⚠` ×7, `⏩ ⏭ ⏮ ⏸ ⏱ ⏳` ×21 (playback/clock), `⚙` ×5 (settings), `●` ×6 (presence), `✗` ×4, `⇄` ×4 (graft), `☑/☐` ×4 (fake checkboxes), `↑↓←⬇↗` ×18, `♥` (life), `⚔`, `⚡` ×3 (activate), `⭐` ×3 (initiative), `✦`, `♻`, `ⓘ`, `▦` …
Hot spots: `main.ts`, `inspect.ts` (the card menu labels), `league.ts`, `tutorial.ts`/`lessons.ts`, `admin.ts`, `account.ts` (nav buttons), `crreview.ts`.
- Two "close" glyphs (`✕` ×30 and `×` in some places), three "undo" arrows, three "play" triangles, and both `✓`/`✅` and `✗`/`🚫` for yes/no.
- Emoji render with the OS's colour emoji font, so they look different on Windows, macOS, Android and Linux, and they ignore `color:`. In CSS, `content:` adds `'✕'`, `'★'` and `" expired"` (plus 4 empty-string pseudo-elements).

### 10b. SVG
- Inline: `crreview.ts:825` (`LINK_SVG`, 16×16, `stroke="currentColor"`), `main.ts:4544` (the region ring `<svg class="lring">`, path set by `layout.ts`), `anim.ts` targeting arrows built with `createElementNS` (path + arrowhead + circle + text).
- Game glyph assets in `data/icons/` (29 files, served via `assets.ts` `ICON_BASE = '/data/icons/'`): `cost_0…9/x.webp`, the 7 element webps, `augment graft bounded_graft haste once virus battle` webps, and **4 SVGs** (`deploy draft planning regroup`, the phase icons). Used in text as `<img class="txticon">` (21 CSS rules). These are the only "real" icon set, and they are game glyphs, not UI icons.
- No UI icon font and no UI SVG sprite.

### 10c. Image assets in `client/ui/`
`favicon.ico` (16/32/48), `icon-192.png`, `apple-touch-icon.png` (180, RGB), `og-image.jpg` (1200×630) and `og/*.jpg` ×9 (per-page link previews: cards, challenge, decks, league, learn, play, replay, rules, stats). All are generated by `site-icons.py` from the GRAFT glyph tinted `--accent` on `--panel`, with the token values **copied** into the script (31–34). `fonts/EBGaramond-Bold.woff2` + `OFL.txt`. No `manifest.json` is referenced from `index.html`, although memory notes the owner uses an installed web app.

---

## 11. Recommendations: a minimal token set, grounded in the census

The goal is the smallest set that **every existing value can be snapped to without visible change for most of the UI**, so that the Storybook pass can start from real components.

### 11a. Colour roles (≈ 30 tokens, replacing ~350 literals)
**Neutrals (10)**, mapping the ~70 greys in §2b onto:
`--color-bg` (#12151a) · `--color-surface-sunken` (#0d1014, inputs/search) · `--color-surface` (#1a1f27, `--panel`) · `--color-surface-raised` (#20262f, `--panel2`) · `--color-surface-overlay` (rgba(20,24,30,.96), the zoom/menus) · `--color-border` (#2e3742) · `--color-border-strong` (#3b4654, the 11 slate borders) · `--color-text` (#d6dde6) · `--color-text-muted` (#8794a3) · `--color-text-on-accent` (#12151a).
**Brand/interactive (3)**: `--color-accent` (#d9a441), `--color-accent-hover`, `--color-link` (the untokenised `#7fc0ff` ×8). **Decide whether `--target` (#e0b93c) stays a separate game role.** At the moment the 13 golds blur "brand", "selected", "warning" and "targeting" together.
**Status (4 × fg/bg/border = 12)**: `success` (glow green), `warning` (one gold), `danger` (#d95454), `info` (blue). Adopt the CR page's `--ok/--warn/--bad` + `-bg` naming, which is the one existing semantic set, and retire `.replaychip`/`.stchip`/`.constag`/admin badge colours onto it.
**Game-specific (keep, namespace `--game-*`)**: the 7 elements + 3 inks, 7 printed bars, `--pending`, `--rgn0/1` (make `--rgn0: var(--accent)`, not a copy).
**Derived tints**: replace the 113 hand-written `rgba(token-rgb, α)` with `color-mix(in srgb, var(--x) N%, transparent)` at a fixed ladder (e.g. 8 / 16 / 35 / 55%), which the codebase already uses 4 times. **Scrims**: two tokens (`--scrim` .72, `--scrim-light` .55) instead of 10 alpha/colour combinations.
**Fold the `.crdoc` palette** into these roles (its `--accent` blue becomes `--color-link` or a page-level override) and fix the phantom `--warn`/`--bad`/`--fg` uses.
Tokenise `sandbox.ts`'s injected palette. Then declare `color-scheme: dark` on `:root`, which today nothing does.

### 11b. Type scale (7 steps instead of 45 values)
The body is 13px and 66% of sizes are 11–13px. A scale such as **11 / 12 / 13 / 15 / 17 / 22 / 28** covers the census: 8–10.5 → 11 (game-board micro text can keep a `--font-size-micro: 9px`), 11–11.5 → 11, 12–12.5 → 12, 13–13.5 → 13, 14–15 → 15, 16–19 → 17, 20–24 → 22, 26–30 → 28. Two weights (400, 700; fold 600/800 in), three line-heights (1.2 tight, 1.4 body, 1.6 prose), one **eyebrow/label** style (11px, 700, uppercase, `.06em`) to replace the 17 copies. Font tokens: `--font-ui` (system-ui), `--font-mono` (from `.crdoc`), `--font-display` (`--card-title`, EB Garamond, which could also give page titles some identity). Add a **global h1–h4** so headings stop depending on UA defaults. Fix the 4 invalid `font: … inherit` shorthands while there.

### 11c. Spacing scale
83% of spacing values are already even. A **2px-based** scale snaps most of them: `--space-0: 0`, `1: 2px`, `2: 4px`, `3: 6px`, `4: 8px`, `5: 12px`, `6: 16px`, `7: 24px`, `8: 32px`, `9: 48px`. That covers the top values across padding+margin+gap (6px ×275, 8px ×230, 4px ×204, 10px ×173 → snap 10 to 8 or 12 per case) and leaves the odd 3/5/7/9px (≈200 uses) as the main clean-up. Name **one page container** (`--page-max: 1180px` + a wide variant 1400–1500px) and **one page padding** instead of 8 widths and 6 paddings. Keep `--gap`/`--ringpad` as game-board tokens.

### 11d. Radii (4 instead of 16)
`--radius-sm: 4px` (chips, tags, 1–5px), `--radius-md: 6px` (buttons, inputs, small panels: 5/6/7), `--radius-lg: 10px` (cards, dialogs: 8/9/10/12/14), `--radius-pill: 999px` (10px/20px pills too).

### 11e. Elevation (3–4 instead of ~35 drops)
`--shadow-1` (0 2px 8px /.4, chips and toasts), `--shadow-2` (0 6px 20px /.55, menus, popovers, tooltips), `--shadow-3` (0 14px 40px /.65, dialogs, zoom), plus `--ring-focus` (0 0 0 2px accent) and leave the game glows as game tokens. Add a visible **`:focus-visible` ring** globally. Today `outline: none` ×8 and no button focus style.

### 11f. Z-layers (8 named layers instead of 39 values)
`--z-base: 0`, `--z-raised: 10` (the 0–6 local tweaks stay local), `--z-sticky: 30` (crbar, stickytop, sticky table heads), `--z-dock: 50` (rail, replaybar, inbox bell, toolbar popovers), `--z-board-fx: 55` (arrow/anim layers), `--z-overlay: 60` (scrims + dialogs; one value, with DOM order for nesting), `--z-popover: 80` (menus, info tip, hover tip, card zoom), `--z-toast: 90`, `--z-drag: 100`. Bring the tabletop's 400–500 inside its own stacking context (`isolation: isolate` on `.ttpage`) so it cannot cross dialogs.

### 11g. Motion (3 durations, 2 curves)
`--dur-fast: 120ms` (hover/fade), `--dur-base: 200ms` (enter/exit, FLIP), `--dur-slow: 400ms` (flights); `--ease-out: cubic-bezier(.2,.8,.3,1)` and `--ease-std: cubic-bezier(.35,.05,.2,1)` (from anim.ts). Export them to JS (`getComputedStyle`) so `anim.ts`/`drag.ts`/`layout.ts` stop hard-coding curves. Add one global `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-iteration-count: 1 !important; transition-duration: .01ms !important } }` to catch the six uncovered infinite pulses.

### 11h. Breakpoints (3 instead of 15)
`sm 700`, `md 900`, `lg 1100` absorb 620/700/720/760/780/819/900/1000/1100/1179 (1366 and the height queries are board-specific and can stay with the board). Keep `html.touch` as the input-mode switch, which is a deliberate decision recorded in `touch.ts:12`.

### 11i. What to consolidate first (ordered by payoff)
1. **Base form controls and a real button set.** Add a global `input, select, textarea` rule (it replaces ~15 copies) and button variants `primary / secondary / ghost / danger / link / icon` plus a `.is-on` toggle (it replaces 28 identical `.on` rules and the green-vs-gold "primary" split). Decide what primary *is*: today it is a green fill globally and a gold outline on the home, deck, challenge and legal pages.
2. **Global `.hint`, `.dim`, `.eyebrow`, `h1–h4`.** That is 160 + 115 TS uses currently styled by context or not at all.
3. **One panel component** (`surface`, `raised`, `emphasis` with an accent border) with radius and padding from the scale, replacing ~95 hand-rolled panels; **one dialog** (scrim + box + header + close) replacing about 10 box styles, 12 scrims and 30 `✕` buttons.
4. **Status vocabulary** (ok/warn/bad/info chips + toasts) from the `.crdoc` tokens, replacing 5 parallel systems; fix `.crchip`'s collision by renaming one side.
5. **Split the file**: `tokens.css`, `base.css`, `components/*.css`, `pages/*.css`, `board/*.css`. The game board (~3,300 lines) can stay as it is while the non-game pages (~1,900 lines in 10 runs) move onto components. Fold the TS-injected sheets (`sandbox.ts`, `legal.ts`) into it so Storybook can see them.
6. **Icons**: pick one UI icon set (an SVG sprite with `currentColor`) for the ~20 UI actions now drawn with emoji (close, menu, settings, undo, refresh, play/pause/step, search, share, bell, admin, report, judge, rules, learn, presence). Keep emoji only where they are content (trophies, medals). The game's own `data/icons/` glyphs stay as they are.

Caveats: counts are from a static parse and cannot see styles applied by class names that TS assembles from strings (for example `elchip ${el}`), and "never used" was checked against static `var()` text only. The `.crchip` collision, the invalid `font` shorthands and the `.hint` default styling are inferred from the CSS and TS and should be confirmed in a browser.
