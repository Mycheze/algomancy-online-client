# 06 — The in-game board and its overlays

Reader 6 of 7. Scope: the game screen (`renderNow`, `main.ts:7887`) and every
board-side module, overlay and floating layer. Lobbies, draft lobby, post-game,
replay transport and non-game pages are other readers' areas; CSS tokens as a
system are another reader's. Classes are recorded here per element.

All line numbers are at master `ba32fcf4` (2026-11-01). `main.ts` = `client/ui/main.ts`,
`style.css` = `client/ui/style.css`; other files are `client/ui/<name>` unless a path is given.

**Two corrections to the brief first:**

- **There is no `<900px` rail drawer, top bar or turn strip any more.** Board
  round 8 (deployed 2026-10-29) removed the classic board, the 250px side rail,
  the rail's sub-900px slide-in drawer and the top phase strip. The right column
  is now a 50px icon **toolbar** at every width (`style.css:4932` comment: "there
  is no narrow-screen drawer any more"). The turn/phase strip is now a row of
  **phase icons** inside *your* info line (`phaseIconsHtml`, `main.ts:7479`). A lot
  of CSS for the rail is still in the file, though (see §4.6).
- **The log is no longer a panel.** It opens as a modal from the ☰ table menu
  (`logOverlayHtml`, `main.ts:6862`).

---

## 1. Board layout map

### 1.1 The page grid (`#app.board.v2`)

`renderNow()` (`main.ts:7887`) writes the whole of `#app` with one `innerHTML`.
`#app` gets the classes `board`, `v2` and `netmode` (`main.ts:7899-7901`).

```
#app.board.v2   grid-template-columns: minmax(0,1fr) 50px     (style.css:4941)
                grid-template-rows:    minmax(0,1fr) auto auto (style.css:1652)
                height:100dvh, gap/padding var(--gap)=2px      (style.css:4180)
┌──────────────────────────────────────────────────┬──────┐
│ .main  (flex column, overflow hidden)             │.side │
│  ├ .stickytop  challenge meter · #shareslot       │.tool-│
│  └ .lboard  ← THE REGIONS BOARD (§1.2)            │ bar  │
├──────────────────────────────────────────────────┤ 50px │
│ .actionbar  pickShowHtml · tokenLossBarHtml ·     │      │
│             promptHtml → .promptbar (§2.G)        │      │
├──────────────────────────────────────────────────┤      │
│ .handdock(.tucked)  .zonelabel + .zone (net only) │      │
└──────────────────────────────────────────────────┴──────┘
 + siblings in #app that are fixed or absolutely placed:
   svg.lring (your region's ring, fixed z3) · .ltail (your tint behind bar+dock, z-1)
   .stackboard.live (floating stack window) · .castpending (card being cast)
   dialogs (.overlay…) · .menu · .glimpsenotice (becomes a grid ROW above the
   action bar: style.css:5011-5017) · cost toasts · .toast
```

Built in `renderNow` at `main.ts:7930-7973`, in this order: `.main` (with
`.stickytop` and `lboardHtml`), `.actionbar`, `toolbarHtml`, `.handdock`,
`lringHtml`, `stackBoardHtml`, `castingHtml`, pick modal, pick-set dialog, erased
dialog, concede dialog, `menuHtml`, bin dialog, cache dialog, help, log,
inspector, judge, trio reveal, post-game, glimpse notice, cost toasts, toast.

### 1.2 The regions board (`.lboard`, `lboardHtml`, `main.ts:4370`)

There are two interlocking L-shaped regions. Each region keeps one colour for
both players: region 0 is gold (`--rgn0`) and region 1 is green (`--rgn1`),
defined at `style.css:4247`. Vertical position says who controls a card;
colour says whose region it is in. Grid at `style.css:4203-4230`:

```
grid-template-areas:                     rows
  "tinfo  tinfo"    their info line      var(--lint, --linh=76px)
  "tplay  tplay"    their In Play         minmax(0,1fr)
  "yinv   tfight"   my Invaders | their battle block   auto
  "yfight tfight"   my battle block                     auto
  "yfight tinv"     ... | their Invaders               auto
  "yplay  yplay"    my In Play            minmax(0,1fr)
  "yinfo  yinfo"    my info line          var(--linh)
```

| block | markup | renderer |
|---|---|---|
| region tints | `.lback.{theirs,mine}.{a,b}.rc{0,1}` (4 divs) | `lboardHtml` `main.ts:4523-4524` |
| seam | `.lseam` (dashed divider down the middle) | `main.ts:4525`, css `style.css:4282` |
| info line | `.linfo.{theirs,mine}(.inactive) > .lin` | inner `info()` `main.ts:4399` |
| In Play | `.lplay.{theirs,mine}(.battledim/.battlefocus)[data-fit=cards]` → `.ltok` token corner + `.regionmain > .zone[data-animzone=field:N]` | inner `play()` `main.ts:4446` |
| Invaders row | `.linv.{side}(.empty)[data-fit=pile]` → `invaderPileHtml` | inner `invaders()` `main.ts:4470` |
| battle block | `.lfight.{side}.{focus,sendhere,incoming,idle}[data-fit=battle/line/band/row]` → `battleHtml` / `counterSendHtml` / `.sentstrip` | inner `fight()` `main.ts:4480` |
| seen-hand float | `.lseen.{mine,theirs}` → `.seenhand` | `seenFloat()` `main.ts:4434` |
| region ring | `svg.lring.rc{n}[data-ring][data-visit] > path` + `.ltail.rc{n}` | `lringHtml` `main.ts:4537`, path drawn by `layout.ts:570 ringBoard` |

Outside a battle the board has class `.lboard.idle` and the middle rows collapse
to bands. In a battle it is `.lboard.fighting[data-fight=mine|theirs]`, the
fight's block takes the height it needs, and `layout.ts` `shapeBoard` writes
`--lidle`, `--lbandt`, `--lbandb` and `data-wide` (`layout.ts:400-403`).

**Info line contents** (one fixed-height line per player, `main.ts:4399-4417`):

- **Mine**, left to right: `.lres` resources (takes the remaining width) ·
  `.phicons` phase icons · `.lend` (`.lbin` bin fan · `.lcache` cache fan ·
  `.lid` name + life + rot/debt).
- **Theirs** is the mirror: `.lid` (with `.lhand` mini card backs under the
  name) · `.lspect` (a spectator sees their full hand) · `.lcache` · `.lbin` ·
  `.lres`. Theirs has no phase icons.
- The per-region pieces come from `regionParts` (`main.ts:4122`), which returns
  `pnameFixed`, `life`, `counters`, `resGrouped`, `miniHand`, `seenStrip`,
  `fieldZone`, `tokenCorner`, `invaderPile`, `sentStrip`, `binMini`, `cache` and
  `handZone`.

### 1.3 The paint pipeline (what turns a string into a board)

1. `render()` (`main.ts:8279`) throttles and calls `renderNow()`.
2. `renderNow` refreshes the module caches (`modHostCache`, `actCache`,
   `placeWarnCache`, `lifeHeldNow`). It then snapshots the viewport and the
   hover, writes `innerHTML`, restores the viewport, keeps the hover, and calls
   `paintLive()` to fill the live slots (`#presenceslot`, `#shareslot`;
   `style.css:49`).
3. `relayout()` (`main.ts:2105`) does the measuring after the paint:
   - `fitBoard(document, baseCw)` (`layout.ts:60`) writes `--cw`,
     `data-fitmode="fan"` and `--fanstep` on every `[data-fit]` zone. The
     arithmetic is in `fit.ts` (DOM-free).
   - Resource line: `--rcw`, `--resstep`, `data-spread` (`layout.ts:459`).
   - Battle staging: `data-stage=below|beside` (`layout.ts:484`).
   - Piles: `--pilestep`, `--invw`.
   - Ring path: `ringBoard` (`layout.ts:570`).
   - Floating stack window: `placeStackWindow` / `placeStackFree`
     (`main.ts:1923/1993`) write `--stack-x/y`, `--table-*`, `#app.stackfree`
     and `data-ring`.
   - Casting card: `placeCasting` (`main.ts:2081`), with the free-spot search in
     `freespot.ts`, writes `--cast-x/y` and `#app.castfree`.
   - Draft pick dialog: `--pick-railclear` (`railclear.ts`).
   - Arrows: `repaintArrows`.
4. Animation layers outside `#app`: `anim.ts` (ghost flights `.animlayer`, arrows
   `svg.arrowlayer`) runs off a state diff from `motion.ts`.

### 1.4 Touch, narrow and short screens

| condition | what changes | where |
|---|---|---|
| `html.touch` (set by the first touch or pen `pointerdown`, never by a media query) | `.touchonly` shown; `.mouseonly` and `.kh` hotkey hints hidden; buttons `min-height:36px`; `.menu` buttons bigger; `.remind` how-to prose hidden; `.binuse` button shown under each bin card; the tucked dock opens on tap | `touch.ts:136`, `style.css:4015-4027, 4076, 980` |
| touch gestures | Tap **reads** a card and a button acts: `.tapgo` "Cast"/"Activate" (`tapgo.ts:90`). Long press **peeks** at 340px (`PEEK_MS` 380, `touch.ts:47`; `zoom.ts:133 peekBox`). The read hangs the card menu under the zoom (`.zoomhang .zoommenu .zmi`, `main.ts:10285-10306`). ☰ and the rail card menu are the finger's right-click. Drag to play (`drag.ts`, `#draglayer`, `.dropover`). | |
| `max-width:1100px` | `.remind` / `.remindrow` hidden; `.overlay.mainonly` stale rail offset (see §4.6) | `style.css:4077, 962` |
| `max-width:1100px and min-height:800px` (a tablet on its side) | `--cw:74px`; hand cards 86px | `style.css:4032` |
| `@container (max-width:1100px)` on the info line | mana count moves first; bin/cache labels go back above their thumbs; thumbs size from `cqh` | `style.css:4419-4437` |
| `max-width:900px` | smaller `.promptbar` padding and font (12px); bar buttons `4px 10px`; rail-era `.setbtn`/`.setgroup` rules (dead on the board) | `style.css:4063, 4080` |
| `max-height:860px` | hand dock cards 76px | `style.css:4720, 4731` |
| `max-height:820px` | info line `--linh:70px`; spectator line 104px | `style.css:4231, 4235` |
| `prefers-reduced-motion` | about 12 separate blocks (life delta, glimpse, flights, act pulse, zoom pulse, offline pulse…) | various |

The board **never scrolls** (`.main` is `overflow:hidden`). When a zone runs out
of room its cards fan instead (`[data-fitmode=fan]`, `style.css:4626-4642`).

---

## 2. Catalogue of element types

### A. The card scan family

#### A1. Card thumbnail — `cardHtml(name, opts)` (`main.ts:3287`)

This is the board's one card primitive. Every scan on the table, in hand, in a
dialog, in the prompt bar or in a strip goes through it.

```
div.card[.state…][data-prev=name][data-anim][data-modh][data-act/btn…]
  img (onerror → .noart) · .artfallback (name text when no art)
  .badges(.hasmore)[title] > span.badge…     chip strip, ONE line (§B)
  .picktag        verb band across the art ("Keep", "Sacrifice")
  .stats          P/D plate top-right (unit) — .statup / .statdown / .basestat
  .xdie(.num)     spell-token X as a die face (dieHtml main.ts:3384)
  .placewarn      (!) illegal-placement mark (placewarn.ts:79)
  .dmg            red damage tag bottom-left "−2"
  .fieldmods > .modstrip(.modpick)…   mods hung under the card
  .tapgo          touch "Cast" button (tapgo.ts:90)
```

- Base CSS: `.card` at `style.css:187`, `img` at 216 (with `aspect-ratio 18/25`,
  which is load-bearing), `.stats` 225, `.dmg` 227, `.badges` 239, `.picktag`
  295.
- Width is `var(--cw)`. The default is 78px, and the fit pass rewrites it per
  zone.
- The class list comes from `cardClasses` (`inspect.ts:835`).

| state class | meaning | look | CSS |
|---|---|---|---|
| `.playable` | something is on offer (cast, deploy into formation…) | 2px solid green outline (`--glow`) | 253 |
| `.playable.nocast` | on offer, but **not** castable (augment/graft/prophesy/recycle only) | amber **dashed** outline | 263 |
| `.multi` | more than one kind of play (a click opens a menu) | ring unchanged; the `⑂` chip says so | inspect.ts:989 |
| `.playable.cached` | a cache card shown again beside the hand | violet outer ring `#b48ce0` | 271 |
| `.activatable` | unit has a legal activated ability | pulsing soft green halo (`actpulse`, infinite) | 278 |
| `.candidate` | a pick target for the open question | 3px gold outline (`--target`) | 289 |
| `.selected` | picked/riding/sent | 3px blue outline `#7fc0ff` | 300 |
| `.carrying` | being carried to a formation slot | 3px **dashed** blue | 301 |
| `.chosen` | an earlier player's open pick (CR 102.3b) | 3px dashed gold; dark picktag | 305 |
| `.modhost` | a legal host for the mod being placed | pulsing (`modpulse`) | 1215 |
| `.modded` | wears mods (taller: mod strips hung under it) | layout only | 677 |
| `.pinghl` | hovered decision option points here | highlight | 1206 |
| `.back` | face-down card (official back image via `--cardback`) | `aspect-ratio 63/88` | 341 (`backHtml` main.ts:3392) |
| `.dead` | defined, never emitted | greyscale | 307 |
| `.dragsrc` / `.droptarget` / `.dropover` | drag-to-play | dims / dashed green / solid green | 4153-4158 |
| `.animland` / `.animhurt` / `.animbuff` | motion flashes (anim.ts) | gold / red / green box-shadow burst | 1590-1606 |

Overrides by container: the hand dock is 92px (`style.css:593`), bin and cache
dialogs 92px (976, 1446), bin fan thumbs 46px absolutely fanned (967-973;
info-line version 4356-4360), glimpse cards 58/52px, sent strip and invader pile
small, pick dialogs `clamp(64px, 9.5vw, 118px)` (4115, 4134).

#### A2. Unit on the table — `unitHtml(u, opts)` (`main.ts:3550`)

This is `cardHtml` with unit data added:

- **Stats plate**: `p/t`. When the live stats differ from the printed ones it
  shows `.statup` or `.statdown` with the printed pair as `.basestat` under it
  (`style.css:618-620`).
- **Damage** `.dmg` "−N".
- **Chips** come from `unitBadges` (`main.ts:3413`). See §B.
- `candidate`, `chosen` / `pickTag` (from boardpick), `selected`, `carrying`,
  `playable` (it can be dragged into a formation), `activatable`, `modhost`,
  `warn` (placewarn).
- `inert` (a sent-away counterattacker) has no `data-act`.
- **Face** follows copy effects (`faceOf`), and a `⧉ Name` chip marks a copy.

#### A3. Hand card — `handZoneHtml(p)` (`main.ts:3638`)

`cardHtml` with these options: `playable`, `nocast`, `multi`, `candidate`,
`pickTag`. Chips come from `handBadges` (`main.ts:3622`): an offer chip, an
`X=3 now` chip, and `📜 prophesy [n]`.

`handCachedHtml` (`main.ts:3688`) appends `.handcached` (dashed violet left rule,
`cached · playable now` label, `style.css:176-184`).

The hand dock is `.handdock(.tucked)` (`main.ts:7942`, css 590-607, 4710-4731).
`.tucked` clips the dock to a strip during draft and bottom picks: hover opens it
with a mouse, a tap opens it on touch.

#### A4. Opponent's hand

`.minihand > .miniback` (30×42 backs overlapping by −18px) plus
`.handcount` ("hand 5", 16px dim) (`main.ts:4183`, css 562-568, 4333-4335).

#### A5. Spell token — `tokenHtml(t)` (`main.ts:3800`)

`cardHtml` with `die: t.x` (the big X die), plus `riding` and `sent` chips,
`selected` when riding or sent, `playable` when castable or toggleable, `.tapgo`
on touch, and `data-act="token"`.

Tokens with the same look stack: `.tokstack(.many)[data-zoomclear]` >
`.tokslot` (`--i/--j/--k/--edge` inline) + `b.tokcount` "×N"
(`tokenStackHtml` `main.ts:3875`, css 4500-4513; hovering spreads `.many`).

The corner chip is `span.tokchip` "✨N", an info-tip target (`main.ts:4148`, css
4495). Its tip content is `tokenTipHtml` (`main.ts:3893`): `.tiptab.toktab` with
`.tallyrow(.burst/.mixed)`.

#### A6. Invader pile — `invaderPileHtml` (`main.ts:3924`)

`.invaders > .zone.invaderzone.invpile(.many)(.open)(.fanleft)` >
`.invslot` + `button.pilecount` "×N". Hover or click spreads it. CSS
`style.css:4604-4625`.

#### A7. Counterattackers in transit — `.sentstrip`

`.zonelabel` + `.zone.sentzone` + `.sentfoot` "arrives next round". The strip
gets `--sentcols` inline (`main.ts:4162`, css 840-852, 4536-4540).

#### A8. Mods on the table

`.fieldmods > .modstrip(.modpick)(.noart)[--modpeek]`: slices of the mod scans
hung under the host. `fieldMods` (`main.ts:9753`) and `modStripsHtml`
(`main.ts:9720`) are a pure string. CSS `style.css:652-697`.

In the zoom they become `.zoommods`. In text they are `.modnames > .modname`
(`modNamesHtml`, `main.ts:9773`).

#### A9. Bin fan (in the info line)

`.regionbin(.hasmods)[data-btn=binopen]` > `.zonelabel "bin (N)"` +
`.regionbinthumbs` (3 fanned `.card`, a targeted one surfaced with
`data-bintgt` and the `.badge.tgtnow` chip) + `.binmodhint`.
`main.ts:4258-4273`, css 967-975, 3374-3394, 4342-4362.

#### A10. Cache fan

`.regioncache(.hasplay)(.onlyspent)(.cempty)[data-btn=cacheopen]` >
`.cthumbs > .cthumb > .card + span.cchip(.cls)` + `span.cmore "+N"`.
`regionCacheHtml` `main.ts:4898`, chip `cacheChip` `main.ts:4746`, css
1441-1478, 4342-4362.

#### A11. Seen-hand aid

`.seenhand(.emptied) > .seenhead(.seenlabel "👁 Their hand, seen turn N", button.seendismiss ×2) + .seenhint + .seencards > .seenslot(.card + button.seenx ✕)`.
`main.ts:4206-4219`, css 853-875, 4651-4662.

#### A12. Resource card — `resHtml(r,p,i)` (`main.ts:3588`)

```
span.rescard.{open|expended|dormant}.{fire|water|earth|wood|metal|light|dark|prismite|hidden|shard}
            (.canact)(.muted)(.noart)[data-act=res]
  img · span.resplate (colour plate when no scan) · span.reschip.{el} (element letter on your own dormant) · .tapgo
```

| state | look | css |
|---|---|---|
| open | face up | 358 |
| `.expended` | turned 90° and faded to .45 | 365-371 |
| `.dormant` | the Dormant-Resource back with an element chip | 551 |
| `.canact` | green outline | 372 |
| `.muted` | dormant outside planning: scale .8, opacity .38, grey | 380 |
| `.noart` | Light/Dark have no scan, so a coloured plate is shown | 392-406 |

The run grouping is `resGroupedHtml` (`main.ts:4313`):
`span.resrow.lresrow > span.resgroup(.wake) > rescard… + span.rescount` and
`span.resmana > b.resmananum + "mana open" + .resact`.

The resource window on hover is `#ressum` (`ressum.ts:57 resSumHtml`; css
4755-4771): `.rshead/.rsmana/.rstab/.rsnil/.rsfoot`.

Legacy `.res` dot pips (`style.css:160-171`) are dead code.

#### A13. Stack card (`.stackcard`) — see §K

#### A14. Card zoom copy — see §N

### B. Badges and chips

**The card chip** is `span.badge(.mod)(.ctr)(.cls)[title]` (`badgeSpan`
`main.ts:3283`). Base style is `style.css:246`: 9px text, a dark translucent
background and a `#444` border. All chips stay on **one line**: `packBadgeLine`
(`inspect.ts:1106`) models widths, folds the overflow into a pinned
`.badge.more` "+N" and puts the full list in the strip's `title`. The rank
order is pick, then live state, then printed attributes.

| chip | text | class | from |
|---|---|---|---|
| attribute | `Ironhide` | (plain) | `unitBadges` main.ts:3414 |
| switched off | `⊘ all off` / `⊘ abilities off` | `.supp` (red) | inspect.ts:903 |
| forecast | `⤴ 4/4` | `.soon` (italic gold) | main.ts:3421 |
| activated ability | `⚡ [icons]` | `.act` (green) | main.ts:3428 |
| counters | `+2/+2` | `.ctr` (green bold) | main.ts:3436 |
| sent | `sent` | `.mod` (gold) | 3441 |
| trigger order | `#1` | `.orderno` (gold fill) | 3445 |
| pick warning | `⚠` | `.optwarn` | 3449 |
| lured | `🪝 lured — must block` | `.mod` | 3473 |
| named | `🗣 named X` | `.mod` | 3496 |
| prediction | `🔮 predicts 12` | `.mod` | 3512 |
| copy | `⧉ Borrower` | `.mod` | 3536 |
| auto-yield | `⏩ auto-yield` | `.mod` | 3546 |
| hand offer | `⑂ cast/graft` / `+ augment` | `.offer(.nocast)(.multi)` (green/amber/blue) | inspect.ts:989 |
| X preview | `X=3 now` | `.ctr` | main.ts:3268 |
| prophesy | `📜 prophesy [2]` | `.proph.on` | main.ts:3633 |
| copies | `×3` | `.count` | main.ts:6104 |
| bin target | `target` | `.tgtnow` (gold fill) | main.ts:4622 |
| cache window | `glimpse` / `free` / `paid` | `.glimpse(.on)` / `.free` / `.paid` | `cacheChip` main.ts:4746 |
| riding | `[battle] riding` | `.mod` (html) | main.ts:3805 |
| fold | `+N` | `.more` (pinned right) | inspect.ts:1138 |
| stack chips | Powerful etc. | `.stackchips .badge` | effectface.ts:229 |
| zoom dice | the same chips laid out as dice on the zoom | `#cardzoom .zoomdice .badge(.dmg)` | main.ts:10217, css ~4862 |

CSS for these variants is spread across `style.css:246-299, 554-560, 1153, 1409,
1471-1476, 2204-2209, 3390-3393`.

**Other chip and pill shapes on the board** (each its own CSS):

| element | look | where |
|---|---|---|
| `.cchip` | cache entry chip under a thumb | css 1449 |
| `.reschip.{el}` | 14px element circle | css 382-391 |
| `.pcount.rot` / `.pcount.debt` | 12px rounded pills, pink / ochre | css 1387-1390 (`main.ts:4290`) |
| `.ridechip(.on)` | toggle pills in the prompt bar for ride-along tokens and counter units | css 1564-1567 |
| `.tokchip` | ✨N | |
| `.tbcount` | watcher count on the room button | |
| `.livedot` | ● pulsing | css 1750 |
| `.presence.on/.off` | ● | css 408-409, 4953-4960 |
| `.linit` | ⭐ initiative star, `.off` when not yours | main.ts:4295, css 4328 |

**"How many" counters are drawn seven ways:** `.badge.more` "+N", `.badge.count`
"×N", `b.tokcount` "×N", `button.pilecount` "×N", `span.rescount`, `span.cmore`
"+N", and `span.burstn` (order number). `.stackdepth` "3 deep ↢" is an eighth
form.

### C. Life, name and player furniture

- **Life pill** — `span.life(.candidate)[data-act=player][data-animzone=life:N]`
  > `.lifeheart ♥` (13px red) + `.lifenum` (21px tabular). `main.ts:4296`, css
  103-151; on the info line, 4330-4332.
  - `.candidate` is a gold outline: the pill can be targeted.
  - `.lifedown` / `.lifeup` are .8s pill-colour flashes.
  - `.lifedelta.up/.down` is the number that rises off the pill (anim.ts
    flashLife).
  - Life is "held" while a pace beat is pending (`lifeHeldNow`).
  - The padding is load-bearing for arrowhead clearance: test 234.
- **Player pick note** (`playerPickNote` `main.ts:6006`): an X value and
  `.optwarn ⚠` added inside the pill when a player is a pick option.
- **Name** — `span.lname[data-tip=counts][data-btn=infotip]` >
  `span.pname` + `.linit ⭐`. Hover or tap opens the counts info tip
  (`infotip.ts:36 countsTipHtml`).

### D. The X die — `dieHtml(x)` (`main.ts:3384`)

`div.xdie > span.pip.p{1..9}` for 1–6, or `div.xdie.num > span` for 0 and 7+.
CSS `style.css:1418-1428`. It is a pure function.

### E. Phase icons — `phaseIconsHtml()` (`main.ts:7479`)

`div.phicons(.over)[data-tip=phase][data-btn=infotip]` contains:

- `span.phturn` — the turn number.
- `span.phi.{draft|plan|haste|battle1|battle2|regroup|deploy}(.cur)` — each an
  `img` from `ICON_BASE` (`draft.svg`, `planning.svg`, `haste.webp`,
  `battle.webp`, `regroup.svg`, `deploy.svg`).
- The battle rounds add `b.phr` (round number) and `span.phpips > i(.on/.done)`
  with four step pips.

The caption is `phaseCaption` (`main.ts:7514`), shown in the info tip. CSS
`style.css:4439-4457`.

### F. Clocks — `toolClocksHtml` (`main.ts:7425`)

`div.tbclocks[data-tip=clocks]` > `span.clocktime.{opp|you}(.run)(.warn)(.exp)[data-clkseat][data-short]`.

- A 1s textContent ticker patches the time.
- The base `.clocktime` rules (`style.css:1247-1265`) are overridden by the
  toolbar rules (`style.css:4973-4978`): monospace 11px, `.run` has an accent
  border, `.warn` and `.exp` are danger red, `.exp` is struck through.
- The info tip (`toolTipHtml` `main.ts:7442`) is a `.tiptab` with `tr.tiprun`.

### G. The action bar and the prompt bar

`.actionbar` (`style.css:720`) is a flex column with `max-height:50vh` and
`overflow-y:auto`. It is hidden when it holds no `.promptbar` (`:has`). It
contains, in order: `pickShowHtml` (`main.ts:7736`), `tokenLossBarHtml`
(`main.ts:1612`) and `promptHtml` (`main.ts:6330`).

**`.promptbar` look variants** (`style.css:56-84, 1717-1727`):

| class | look | used for |
|---|---|---|
| (default) | olive green `#262c18` / `#4a5b2a` | your phase bar: "you have priority", "Planning"… |
| `.pending` | brown/amber `#33270f` / `#7a5e1e` | a question to answer: every decision, confirm, picker; "Game stopped" |
| `.waiting` | slate `#1b2028` / `#384352` + breathing `.livedot` | waiting on the opponent or the server, auto-passing |
| `.playbar` | slate `#1f2630` / `#3d4a5c` | opponent playback (`playbackBarHtml` main.ts:6308) |
| `.nudgea` / `.nudgeb` | gold glow flash ×2 | "Yes, activate" was refused |

**Bar kinds** (each one function → one `.promptbar`):

| bar | function / line |
|---|---|
| frozen game | `promptHtml` 6333 |
| playback | `playbackBarHtml` 6308 |
| armed confirm: act, done, pass, deploy, haste, ally, noop. One table, one renderer. | `CONFIRM_BARS` 5797 / `confirmBarHtml` 5818 |
| auto-passing | 6355 |
| game over | 6366 |
| waiting (with `waitingNote`) | 6406 |
| decision, which dispatches to the kinds below | `decisionBarHtml` 6059 |
| ↳ board pick (choose on the board) | `boardPickHtml` 6032 |
| ↳ targets | 6115-6183 |
| ↳ assign split | 6188 |
| ↳ number | 6198 |
| ↳ order triggers | 6204-6276 |
| ↳ pick-set reopen | 6280 |
| ↳ pay/decline / generic | 6285-6304 |
| big card menu with search (> 14 card options) | `bigCardMenuHtml` 5888 |
| phase bar: haste, draft, planning, declare, ride-along, blocks, counter ask, modding, priority, deploy | `phaseBarHtml` 6436-6655 |
| modding bar | `moddingBarHtml` 5717 |
| token-loss notice | 1612 |
| pick hidden | `pickShowHtml` 7736 |

**Parts inside a bar** (css line in brackets):

- **Text:** `.who` (bold gold name) [66] · `.remind` (how-to text, hidden on
  touch and <1100px) · `.pickhint` ("— click a highlighted card") · `.duty`
  (bold warn) [79] · `.blockrefusal` (red left rule) [84] · `.placewarnline` ·
  `.earlier` (gold, CR 102.3b) [67] · `.cachenames` · the error
  `<span style="color:var(--danger)"> ✗ …</span>` (inline, `main.ts:6340`).
- **Options and pickers:** `.deccards` (a row of `cardHtml` options) [732] ·
  `.decpicks` / `.decdecline` (button groups; decline pushed right) [736-737] ·
  `.decsearch` + `.decall` (search box and "every option" expander) [749-763] ·
  `.ridepick > .ridechip` · `.burststrip > .bursttile(.now) > card + .burstn +
  .burstaim` [1392-1415] · `.ordertile(.picked) > card + .burstn` [1398-1429].
- **Steppers** (§I): `.ctrstep` · `.numentry` · `.asgstep`.
- **Buttons:** primary = `button.primary`; decline = `button.declinebtn`
  (transparent, dashed, dim) [738]; affirmative stop = `button.commitbtn` (green
  like primary) [3363]; `.kh` "(space)" hotkey suffix; `.btnnote` second line
  under the main button, e.g. "‹opponent› can reply", from `nextstep.ts:102
  passLabel` [71]; `castCancelBtnHtml` "✕ Cancel (esc)" / "↺ Start over" / "↶
  Undo last pick" (`main.ts:2418`).
- `details > summary style="color:var(--dim);cursor:pointer"` — an inline-styled
  expander (`main.ts:6192`).

### H. Buttons used on the board

| variant | look | css / emitted at |
|---|---|---|
| base `button` | panel2 fill, line border, 5px radius, `5px 12px`; hover = accent border | css 50-54 |
| `button.primary` | green fill `#3c5a2f` / `#5b8747` | css 53; used ~65× across the UI |
| `button.declinebtn` | transparent, dashed, dim; hover = danger | css 738 |
| `button.commitbtn` | **re-spells** the primary green | css 3363 |
| `:disabled` | opacity .4 | css 54 |
| toolbar buttons | 50px column, 18px emoji glyphs, `.tbsub` 9px subtitle, `.on` accent | css 4945-4952 |
| `.tbstat` room button | `.presence` dot; offline = red pulsing button | css 4953-4963 |
| `.passallchip` | green-lit "⏩ stop" | css 880, 4971 |
| `.setbtn` ⋯ and `.aptoggle(.on)` settings toggles | the `.on` state is glow green | css 884, 4993-4996 |
| `.logmode(.on)` | "▸ story / ▾ everything" | main.ts:6831 |
| `.seendismiss`, `.seenx`, `.glimpsex`, `.pilecount`, `.binuse`, `.orderdone` | small ad-hoc buttons, each sized separately | css 864-870, 912, 4612, 980 |
| `.tapgo` | touch action button on a card; **re-spells** primary green | css 987 |
| `.menu button` | menu items | §M |
| `.ridechip` (a span acting as a toggle button) | pill toggles | css 1564 |

### I. Steppers (three near-identical implementations)

| stepper | markup | view model |
|---|---|---|
| counter removal | `span.ctrstep` [inline flex] + hint + `−` `<b>n</b>` `+` `All (n)` `Take n` | `counterStepperHtml` main.ts:2550; `inspect.ts:2777 counterStepper` |
| number entry | `span.numentry` > `−10 − input#num-entry[type=number][style=width:5em] + +10` confirm (`commitbtn` on a cost ramp) + dim range + quick buttons | `numberEntryHtml` main.ts:2734; `inspect.ts:3224 numberEntry` |
| damage split | `span.asgstep` [inline] > victim run (inline coloured spans with →) + `−` `<b>` `+` … | `assignSplitHtml` main.ts:2794; `inspect.ts:3043 assignSplitStepper` |

The view models in `inspect.ts` are pure (`quantityStepper` `inspect.ts:2654` is
the common core). The markup is inline-styled and duplicated.

### J. The battle block

`battleHtml` (`main.ts:5215`), `battleColHtml` (5547), `colBuilderHtml` /
`slotHtml` (5643/5661), `counterSendHtml` (5514), `counterTrayHtml` (5473),
`watchingHtml` (5603), `pendingColHtml` (5587).

```
.battle(.watching) > h3 (hidden on the regions board) · .fshint · .remindrow
  .cols[style=…] > .col(.ridecol|.sendcol|.fsendcol|.fsoutcol) > .collabel
      .bhalf.top(.pending) · .vs · .bhalf.bot(.pending)
  .stagewrap > .cols + .stagerow[data-pool][--traycols] > .collabel + .zone.stagezone   (counterattack tray)
.lsend(.pending) > .zone.lsendrow > cards + .slot.lsendslot(.open)   (counter-send box in the other block)
.linvside > invaders pile .fanleft   (invaders beside the fight)
```

- **Slots:** `.slot` (dashed placeholder sized from `--cw`, css 319) · `.open`
  (green, clickable) · `.ghost` ("no attacker", "unblocked", "—") ·
  `.ghost.blockgone` · `.fslot` (formation drop target, pulsing `fspulse`, css
  1176-1196) · `.lsendslot` · `.dropover`.
- **Layout states:** `.lfight.focus[data-stage=below|beside]`,
  `[data-fitmode=fan]`. CSS `style.css:310-324, 1157-1205, 1741-1766,
  4515-4597, 4663-4682`.
- **Inline styles:** `colsStyle` on `.cols`, and
  `.remindrow style="color:var(--dim);margin-bottom:6px"` (`main.ts:5264-5265`).

### K. The stack window and casting

**Stack window** — `stackBoardHtml` (`main.ts:7090`):

```
.stackboard.live(.pending)(.closing)[data-animzone=stack][style=animation-delay]
  .stackrow[--stackstep] > .stackcard… (z-index inline per card)
  .stackcaption(.pending).st-{state}[data-anim-follow] > .stackverb .stackname .stackwait .by .stackdoes|.stackroles .stackfrom .stackdepth
```

It is a fixed window over the idle region (`placeStackFree`). Its border takes
the region colour (`#app.stackfree[data-ring]`). It fades in with `stackopen`
and out with `stackclose` held for 480ms. CSS `style.css:2095-2430`.

**`.stackcard`** anatomy: `img` or `.fxbody` (effect face) · `.stackface` (name
fallback) · `.xdie` · `.stackx` ("X=3") · `.badges.stackchips` ·
`.stackmodhost` · `.stacktag` (kind word) · `.stackbolt.{pending|answered|fizzled|…}`
· `.stacklost` ("⊘ target gone").

| state | look |
|---|---|
| `.mine` / `.seat0` | green 2px border |
| `.theirs` / `.seat1` | blue `#6c9bf0` |
| `.top` | raised |
| `.candidate` | gold |
| `.modhost` | pulsing |
| `.lost` | red ring (target missing) |
| `.negated` / `.fizzled` | grey |
| `.resolving` | teal `--pending` |
| `.flashing` | resolving beat |
| `.fx` | an ability, not a card |
| `.noart` | no image |
| `:hover` | z 60 lift |

**Effect face** — `effectBodyHtml(f)` (`main.ts:6965`, pure apart from `art()`):
`.fxbody(.bare) > .fxslice[--a --b] (art slice) .fxseam .fxgraft` + `.fxname(.inkdark)[--t1 --t2] > b name + i word`.
The name bar is drawn in the printed bar colours `--bar-*` and the `--card-title`
serif. CSS `style.css:2351-2411`.

**Card being cast** — `castingHtml` (`main.ts:7047`):
`.castpending > .stackcard.casting.{mine|theirs}`, placed by `freespot.ts` via
`--cast-x/y` (css 2146-2155).

**The does-line** under the caption is `doesLine` (`doesline.ts:523`, data in
`does-lines.json`): a pure (item, state) → string function.

**Focus body** (zoom panel and inspector): `previewStackHtml` (`main.ts:6873`) >
`.abilitybox > .abhead .abrow(.absrc) .xnow(.xinline) .abtargets .abneg
.abmodhost .stackmods`.

### L. Dialogs (scrim + box)

**Family 1: `.overlay > .overlaybox`** (`style.css:891-928`): fixed, z 60,
scrim `rgba(6,8,11,.72)`, box 10px radius with an **accent** border,
`min(92vw,560px)`, `max-height:80vh`.

`.overlay.mainonly` leaves the toolbar uncovered (`right:52px` on v2, css 960).
The base rule (959) and its `@media` (962) still carry the old rail's 298px and
228px offsets.

| dialog | box class | function / line |
|---|---|---|
| bin | `.binbox` > `.binmodbanner` + `.zone.binzone.bindialog > .binentry(card + button.binuse)` | `binDialogHtml` 4631 |
| erased pile | `.binbox` | `erasedDialogHtml` 4705 |
| cache | `.binbox.cachebox` > `.hint` + `.binmodbanner` + `.cachezone` > `.cacheentry(card + .cachecond(.met) + .cachepay(.free/.none))` + `.spentcache` | `cacheDialogHtml` 4959, `cacheCardHtml` 4783 |
| log | `.logbox` > `.logpanel#log` (h3 + `.logmode` + rows with `ev-*` classes, `.logtail`, `.ev-plumbing`, `.logcurtain`) | `logOverlayHtml` 6862, `logPanelHtml` 6786; css 1485-1568 |
| card inspector | `.inspectbox` > h3 + `.inspectscroll > .inspecttop(img + .inspecttext > .textbox)` + `.attrgloss(.off)` + `.tokenrow` + `.rulingrow` + h4 + `.judgerow` | `inspectorHtml` 5060; css 1086-1101 |
| judge | `.judgebox` > `.judgescroll > .judgeq .judgea(markdown) .hint` + `.judgerow(input + button.primary)` | `judgeOverlayHtml` 5165; css 1012, 1061-1085 |
| help | `.overlay.mainonly > helpBoxHtml()` (from rules.ts) | `helpOverlayHtml` 5015 |
| concede / leave | bare `.overlaybox` with h3, p, two plain buttons | `concedeHtml` 12222 |
| draft / bottom pick | `.overlay.pickover > .overlaybox.pickbox > .pickbar + .draftpanel` | `pickModalHtml` 7730, `draftPanelHtml` 7634, `bottomPanelHtml` 7789; css 4101-4120 |
| pick-set | `.overlay.psover > .overlaybox.psbox > .psbar .pspanes > .pspane > .pscard(.on/.off)` | `pickset.ts` `pickSetHtml(dec, cardHtml, iconizeText)`; css 4122-4140 |
| trio reveal | `.overlay.trioover` (lobby.ts) | other reader |
| post-game | `pg.postGameHtml` | other reader |

**Family 2: layers beside `#app`, each with its own scrim:**

- reveal history: `.revealscrim > .overlaybox.revealbox` (z 70, `reveallog.ts:142-159`)
- "propose a fix": `.amendscrim > .overlaybox.amendbox` + `.amendbar` (z 69/66, `amend.ts:239-275`)
- report: `.reportscrim` (z 70)
- help on other pages: `.helpscrim` (z 80, `helplayer.ts:36`)
- lessons: `.lessonscrim` (z 76)

### M. Menus and popovers

- **Context menu** — `menuHtml` (`main.ts:7332`):
  `div.menu[style="left:…;top:…"] > button[data-btn=menuitem](elIcon + iconized label)… + button[data-btn=menuclose] "cancel"`.
  - Opened from a right-click on a card (`cardMenuItems`), from a bare
    right-click or ☰ (`boardMenuItems` `main.ts:12200`: game log, erased piles,
    reveals, propose a fix, concede), from a multi-mode click
    (`main.ts:11301/11442/11593`) and from graft position (`main.ts:11798`).
  - It is positioned with JS clamping (`zoom.ts:156 menuBeside`).
  - CSS is `style.css:331` (z 50), 574 (`max-height`, scroll), 580 (z 70) and 583
    (z 95 on the board). On touch it gets bigger buttons (4022-4024).
- **Touch read menu**: `.zoomhang.zoommenuhang > .zoommenu > span.zmi[data-zmi]`,
  hung under the zoomed card (`main.ts:10285-10306`).
- **Toolbar popovers**:
  - `.tbmore > button.setbtn ⋯` + `.setgroup.tbpop(.open)` holding the
    `.aptoggle` switches (🔒 full control, ⏭ auto-pass, 🎭 bluff haste, ✨
    motion, 🔊 sound) (`main.ts:7378-7395`; css 4984-4996).
  - `.scnpop.tbpop` — the scenario tester's verdict panel (`scn.panelHtml`).

### N. Floating info: zoom, tips, hover

| layer | id / class | z | content | source |
|---|---|---|---|---|
| card zoom | `#cardzoom > .zoomcopy(.nbicon)(.zsupp)(.zoommodded)` + `.zoompanel(.twocol)` | 90 | An inert clone of the hovered card at 240px (`ZOOM_W`), grown FLIP-style from the card. The decorator turns the badge strip into `.zoomdice`, adds a `.zoomsupp.band-{attrs/abilities/all}` grey band, `.zoommods` strips, and `.zoomhang` (stack caption, `.handwhy`, touch `.zoomgo`, read menu). `.zoompanel` beside it holds the current `.textbox`. | `zoom.ts:254-330`; decorator `main.ts:10150-10229`; panel `zoomPanelHtml` `main.ts:10236`; css 4736-4931 |
| peek (touch) | same layer at 340px (`PEEK_W`) | 90 | long press | `zoom.ts:422` |
| press-zoom | `data-zoom` + hold 320ms or middle-click | 90 | deck builder, tabletop, binder | `presszoom.ts` |
| info tip | `#infotip(.on)` > `.tiphead .tiptab(.toktab) .tipline(.wrap/.tipwarn/.tipok/.dim) .tipfoot` | 89 | Name → pile counts; phase icons → caption; toolbar room, game or clocks; token corner | `infotip.ts`; `toolTipHtml` `main.ts:7442`; css 4772-4798 |
| resource window | `#ressum(.on)` | 89 | count of each element plus mana | `ressum.ts`; css 4755 |
| long-hover box | `#hovertip.hovertip(.on)` > `.textbox.compact` or `img.hovertipart` | 90 | A card name in prose (log, judge, cache names), after a 550ms dwell | `main.ts:9850-9990`; css 2503-2512 |
| native `title=` | — | — | **the dominant tooltip on the board.** Every chip, toolbar button, pile, die and stack chip carries one. | everywhere |

The current-text box is `textBoxHtml(box, {compact, noTitle})` (`main.ts:9640`):

```
.textbox(.modified)(.compact) > .tbhead(.bare) .tbname .tbtype .tbbadge "current text"
  .tbstats(.statup/.statdown .basestat .tbdmg)
  .tbattrs > .tbattr(.off)
  .tbsupp
  .tblines > .tbline.tb-{origin}(.off) > .tbfrom .tbtext .tbwhy
  .tbstate
```

It is used in the zoom panel, the inspector and the hover tip. CSS
`style.css:2430-2524`.

### O. Toasts and notices

| element | look / behaviour | source |
|---|---|---|
| `.toast` | bottom centre, z 90; lifted to 178px in net mode; 4s timer | `showToast` `main.ts:3148`, css 1368-1371 |
| `.costtoasts > .costtoast > b.costtoasthead + .costtoastmsg + i.costtoastn` + `.costtoastmore` | bottom left, z 61; click to dismiss | `toast.ts:267` (pure), css 3316-3349 |
| `.glimpsenotice > .glimpsehead(👁 … button.glimpsex ✕) + .glimpsecards` | Non-modal. On the board it is a grid row above the action bar. | `glimpseNoticeHtml` `main.ts:1568`; css 896-926, 5011-5017 |
| token-loss bar | a `.promptbar.pending` with `.duty "⚠ spell tokens lost"` | `main.ts:1612` |
| share banner `.sharebar` | `.sharelink` input + copy button | `util.ts:19 shareBar` (shared with lobby), `shareBannerHtml` `main.ts:7539` |
| frozen-game bar | `.promptbar.pending "⚠ Game stopped:"` | `main.ts:6333` |

### P. Arrows, motion, ring

- **Targeting arrows** — `svg.arrowlayer(.on) > g.arrow.{tgt|src|soft} > path + .arrowhead + .arrowdot + text.arrowlabel`.
  - `tgt` is solid amber: what the effect is aimed at.
  - `src` is dashed blue `#7fc0ff`: what produced the ability.
  - `soft` is a faint dashed amber hint on the top of the stack.
  - Built by `anim.ts:502-600`, with specs from `stackArrows` /
    `pendingAimArrows` (`main.ts:8343/8385`). CSS `style.css:1609-1630`.
  - The arrowhead must stop clear of the life digits (test 234).
- **Flights** — `.animlayer > .animghost(.back)(.noart)`, z 58 (`anim.ts:79,
  340`).
- **Landing / damage / buff flashes** — `.animland`, `.animhurt`,
  `.animbuff`.
- **Drag** — `#draglayer > .dragghost` (z 95, `drag.ts`, css 4146).
- **Region ring** — `svg.lring` path, a stroke in the region colour with a glow
  (css 4267-4271). It grows to take in a visiting attacker (`data-visit`).

### Q. The toolbar (right column) — `toolbarHtml` (`main.ts:7355`)

`div.side.toolbar`, top to bottom:

1. `.tbstat` room button (ⓘ / ▶ / 👁 / 📘 / 🧩 / ❓ + presence dot + watcher count)
2. 📘 lessons
3. `.tbgame` (draft element icons, ⚙ custom, 1×)
4. `.passallchip` ⏩ stop
5. 🧪 scenario
6. ☰ table menu
7. ↶ undo
8. ↺ watch again
9. ⚖ judge
10. ? rules and help
11. 📝 report
12. `.tbfill` spacer
13. `.tbclocks`
14. 🔒 `.fcnote`
15. `.tbmore` ⋯ (settings popover)

Every button's words are only in its `title`. CSS `style.css:4932-4996`.

### R. The `.zonelabel` caption

`.zonelabel` is 11px uppercase dim text with `.08em` tracking
(`style.css:185`). On the board it is mostly hidden or minimised; it is shared
with the draft panel and the lobby.

---

## 3. Shared primitives: board vs the rest of the site

| primitive | board version | non-game version(s) | differs? |
|---|---|---|---|
| **Base button** | global `button` (`style.css:50`) | same global rule | Same base. |
| **Primary button** | `button.primary`: **green fill** `#3c5a2f` (css 53). `.commitbtn` (3363) and `.tapgo` (987) re-spell the same green. | Home/challenge `.cta.primary`: **gold outline** (css 467-468, 5380-5381). League `.lprimary`: gold `!important` (3581). Deck page `.dkicon.primary`: gold border (2634). | **Yes.** "Primary" means green fill in the game and gold outline on the home, challenge and league pages. |
| **Secondary / decline** | `button.declinebtn` (dashed, transparent) | `.linkbtn` (underline dotted), `.cblink` (accent text link) | Different vocabularies. |
| **Toggle** | `.aptoggle.on` (glow-green border), `.ridechip.on` (green fill pill), toolbar `button.on` (accent) | `.elchip.on` (accent outline, per-element border), `.dkicon.play.on` (glow), `.decsearch button.on`, `.accttab`, `.crtab` | Three different "on" colours (glow, accent, element). |
| **Dialog** | `.overlay > .overlaybox`: z 60, scrim .72, **accent** border, 560px (css 891-893) | Deck page `.dkmodal > .dkmodalbox`: z 95, black .62 scrim, **line** border (3843-3846). `.helpscrim` z 80. `.crscrim` .55 z 72. `.chscrim` .62 z 77. `.lessonscrim` .62 z 76. `.ddscrim` .45 z 49. | **Yes.** At least 9 scrim implementations, 4 opacities, z from 49 to 95. The help box is wrapped in `.overlay.mainonly` in game (`main.ts:5015`) and in `.helpscrim` elsewhere (`helplayer.ts:36`). |
| **Card thumbnail** | `.card` (`cardHtml` `main.ts:3287`): `--cw` driven, outline states, one-line badge strip | Deck page `.dktile` (`decks.ts:409`); card browser `.dktile.cbtile` (`cards.ts:336`); binder `.dktile.ddtile` (`binder.ts:98`); tabletop `.ttcard` (`deckstrip.ts:69`); lesson figures. | **Yes.** Different markup, classes and states. The only thing they share is `artUrl()` (`assets.ts:31`) and the `data-prev` / `data-zoom` hooks for the zoom. |
| **Card zoom** | `#cardzoom` via hover (`data-prev`), with a decorator adding dice, mod strips and the text panel | Same `zoom.ts` via `presszoom.ts` (`data-zoom`, hold or middle-click) on the tabletop, binder and deck strip | Same layer. The board-only decorator adds game data. |
| **Chip / badge** | `.card .badge` (9px, on-card); `.pcount`; `.ridechip`; `.cchip`; `.reschip` | `.badgechip` (profile trust mark, uppercase pill, css 933); `.elchip` (element picker, 941); `.cbchip` (browser filter, 3093); `.stchip` (3505); `.crchip` (2011, 5248) | **Yes.** No shared chip base. |
| **Tooltip** | native `title` (dominant) + `#infotip` + `#ressum` + `#hovertip` + zoom panel | native `title`; `#hovertip` for prose card links on any page (cardlinks.ts); CR review has its own `.crtoast` / `.crchip` | `#infotip` and `#ressum` share one look (panel, line border, 8px radius, shadow) but are separate rules. |
| **Menu** | `.menu` (fixed, accent border, z 50→70→95) | tabletop `.ttmenu` (z 30, css 2797) | Two implementations. |
| **Toast** | `.toast` (bottom centre), `.costtoasts`, `.glimpsenotice` | `.crtoast` (CR review, z 80); `amend.ts:281` reuses `.toast` | Partly shared. |
| **Element colours and icons** | Tokens `--fire … --dark`, `--light-ink` / `--dark-ink` / `--metal-ink`, `--bar-*` (printed name bars) at `style.css:2-28`. Icons `/data/icons/<el>.webp` via `elIcon` (`util.ts:13`, onerror → display:none) and `txtIcon` (`cardtext.ts:1348`, onerror → alt text). The element colour is re-spelled per component: `.res.{el}`, `.reschip.{el}`, `.rescard.noart.{el}`, `.elchip.{el}.on` with hard-coded Light/Dark faces (946-951). | `.elchip` (lobby), league and deck affinity tables | The tokens are shared, but each component restates the per-element mapping and the light/dark gradients. |
| **Region colours** | `--rgn0` (= `--accent` value `#d9a441`), `--rgn1` `#52a877` + tints, defined mid-file (`style.css:4247`) | none | Board only, but the gold duplicates `--accent`. |
| **Typography** | Body is 13px/1.4 system-ui (css 37). `--card-title` (EB Garamond Bold, `ui/fonts/`) is used for effect name bars and the zoom. Clocks are ui-monospace. `.zonelabel` 11px uppercase. `.kh` and `.hint` have **no base rule**. | Same body. `.crdoc` defines its own palette and 15px/1.6 font (css 5280-5287). | `.hint` has about 20 context-specific rules and no base (§4.7). |
| **Text input** | `input#num-entry` (inline width), `.decsearch input`, `.judgerow input`, `.sharelink` | `.joinscreen input`, report fields, deck search | No shared input style. |
| **Live / presence dot** | `.livedot`, `.presence.on/.off` | lobby and friends (`.roomfriend`, `.inboxbell`) | Similar ideas, separate rules. |
| **Share bar** | `.sharebar` via `util.ts:19 shareBar` | the same function in lobby and waiting room | **Shared.** It is the one already-unified piece. |
| **Escaping / icons** | `esc`, `elIcon`, `iconizeText`, `txtIcon` | same modules | Shared (`util.ts`, `cardtext.ts`). |

---

## 4. Design smells (kept proportionate — the board is not being redesigned)

1. **Inline `style=` in board markup.** There are 45 inline `style="` in
   `main.ts`, 42 of them in the board range.
   - Steppers: `main.ts:2561-2564`, `2775-2777`, `2808-2820`. A comment at 2559
     says "styled inline: ui/style.css belongs to another change in flight".
   - `color:var(--dim)` appears 15× (e.g. 6347, 6356, 6452, 6469, 6621, 4972).
   - The error span is `style="color:var(--danger)"` (`main.ts:6340`).
   - Battle remind rows: `main.ts:5264-5265`, 5624, 5635.
   - `<details><summary style=…>`: 6192.
   - Acceptable: data-carrying custom properties (`--sentcols`, `--tokcols`,
     `--k/--i/--j`, `--stackstep`, `--a/--b`, `--modpeek`) and JS positions.
2. **Hard-coded colours (CSS, not TS).** `style.css` has **238 distinct hex
   values** against about 20 colour tokens. TypeScript has none, which is good.
   - Primary green `#3c5a2f` / `#5b8747` is written out 3× (css 53, 988 `.tapgo`,
     3363 `.commitbtn`).
   - Selection blue `#7fc0ff` appears 8× (selected, carrying, offer.multi, src
     arrow, glimpse.on, pick-set) with no token.
   - Others without tokens: cached violet `#b48ce0` ×4, their-stack blue
     `#6c9bf0`, prophecy `#9a8ad9` / `#b9abec`.
   - `--warn` is read with **two different fallbacks** (`#e8b64c` at css 79 and
     1258; `#e0b93c` at 830) and is only defined inside `.crdoc` (5283).
   - `--rgn0` duplicates `--accent`.
   - Prompt-bar backgrounds (`#262c18`, `#33270f`, `#1b2028`, `#1f2630`) are
     literals.
3. **Emoji as icons next to a real icon set.** The game ships webp/svg icons
   (`data/icons/`: element pips, `cost_0-9/x`, augment, graft, battle, haste,
   once, virus, phase svgs) and uses them through `txtIcon` / `elIcon` and the
   phase strip. Meanwhile:
   - The toolbar is all emoji or glyphs: ⓘ ▶ 👁 📘 🧩 ❓ ☰ ↶ ↺ ⚖ ? 📝 ⋯ 🔒 ⏩ 🧪
     (`main.ts:7360-7398`).
   - Settings use 🔒 ⏭ 🎭 ✨ 🔊 🔇.
   - Chips use 🪝 🗣 🔮 ⧉ ⚡ 📜 ⑂ ⊘ ⤴ ⏩ ✨ ⚠.
   - Life is ♥ and initiative is ⭐.
   - About 50 distinct glyphs in `main.ts:1400-8400`. They render differently per
     OS, and their size is set by `font-size` (18px in the toolbar).
4. **Near-duplicates.**
   - Three stepper markups (§I).
   - Seven "count" chip forms (§B).
   - About 9 dialog and scrim implementations (§3).
   - The help box in two different frames (`main.ts:5015` vs `helplayer.ts:36`).
   - The ride-along picker bar is copy-pasted between the attack and block steps
     (`main.ts:6510-6524` vs `6557-6571`), and the counter picker is a third
     near-copy (6576-6590). The armed confirms are already unified
     (`CONFIRM_BARS`, `main.ts:5797`), which is the model to follow.
   - `.clocktime` is defined twice: base at 1247, toolbar override at 4973.
   - Three image-fallback strategies inline in markup: `onerror` adds `.noart`
     (`cardHtml`, `resHtml`), sets `display:none` (`elIcon`), or swaps
     `outerHTML` to the alt text (`txtIcon`).
5. **z-index soup.** There are 108 `z-index` declarations, from 0 to 500.
   - `.menu` is set three times: z 50 (css 331), 70 (580, "rendered behind the
     dialog") and 95 (583, "above the zoom").
   - The other layers, in order: overlay 60 = glimpse 60 < costtoasts 61 <
     amendbar 66 < amendscrim 69 < reveal/report 70 < crscrim 72 < lessons
     76-77 < help 80 < ressum/infotip 89 < zoom/toast/hovertip 90 <
     menu/draglayer/dkmodal/lessonprev 95 < tabletop 400-500.
   - Each value has a comment recording the collision that set it. There is no
     scale.
6. **Rail-era cascade left behind.** Board round 8 deleted the classic board
   and the rail, but their CSS stays and is overridden by `#app.board.v2`
   selectors with higher specificity:
   - `.side` sticky (css 586)
   - `.overlay.mainonly` 298px and 228px offsets (959-962)
   - `.setbtn` / `.setgroup` `display:contents`, plus touch and 900px variants
     (4049-4069)
   - glimpse notice placed three ways (909 / 920 / 5011)
   - the 1100px "classic rail is a 220px column" note (961)
   - dead `.res` pip rules (160-171), `.binline` (161), `.gameover`, `.card.dead`
   - the comment block at about css 4160 still says the regions board is
     "Behind the ▦ board toggle … classic is the default"
   - `cssdead.py` (off-repo tool) lists 54 unreachable selectors across the
     sheet.
7. **Semantic classes with no base style.** `.hint` is used 27× in board markup
   (inspector, cache dialog, xnow rows, judge) with only context rules and no
   base. `.kh` (hotkey hint) has only a touch-hide rule. `.remind` has only hide
   rules. So "dim helper text" is restyled per container, or not at all.
8. **Button styles are inconsistent in the bar itself.**
   - Primary is green, but a replacement default uses `primary`, a cost ramp's
     confirm uses `commitbtn` (also green), and the auto-stack and "Start over"
     buttons use `declinebtn` (dashed) even though they are not declines
     (`main.ts:6270-6274`).
   - Done buttons in `doneRow` carry seat names ("Ann: To Battle (enter)").
   - Toolbar buttons are icon-only, with the label only in `title`.

---

## 5. Storybook: what can be isolated, and what already exists

### 5.1 How the board's renderers depend on state

`main.ts` **exports nothing** and runs its boot routing at import:
`params = new URLSearchParams(location.search)` at `main.ts:12368`, then the
`?room` / `?learn` / `?challenge` / `?replay` / `?question` / `?demo` branches at
12544-12751.

The board renderers read these module globals:

- `h` — the backend: `.state`, `.log`.
- `NET` — the `NetBackend` (`main.ts:289`): seat, `legal`, peers, room,
  spectating, frozen, watchers, single, custom, playback state.
- `ui` — `UiState` (`main.ts:1078`, **57 fields**).
- About **77 module-level `let`s**, including `actCache`, `modHostCache`,
  `placeWarnCache`, `lifeHeldNow`, `flashQueue` / `beatQueue`, `binView`,
  `cacheView`, `erasedView`, `settingsOpen`, `helpOpen`, `logOpen`,
  `judgeOpen`, `inspect`, `clockSnap`, `playbackNow`, `autoPassing`, `uiError`,
  `toastMsg`, `costToastsUp`, `concedeAsk`, `stackWasOpen` / `stackOpenedAt`.
- `localStorage`: `algoAutopass`, `algoBluffHaste`, `algoLogVerbose`, motion and
  sound.
- `Date.now()` for stack open/close, flash beats, clocks and cost toasts.
- Post-paint DOM measurement (fit, ring, stack and cast placement).

| tier | pieces | notes |
|---|---|---|
| **Already pure and exported** — direct story candidates | `placeWarnHtml` (placewarn.ts:79), `countsTipHtml` (infotip.ts:36), `resSumHtml` (ressum.ts:57), `costToastHtml` (toast.ts:267), `tapGoHtml` / `zoomGoHtml` (tapgo.ts:90/73), `pickSetHtml(dec, cardHtml, iconizeText)` (pickset.ts), `shareBar` / `elIcon` / `esc` (util.ts), `iconizeText` / `txtIcon` (cardtext.ts) | `pickSetHtml` takes `cardHtml` **injected**. That is the pattern that would let main.ts's atoms be passed to stories. |
| **Pure view models** (data → props; render them in a story wrapper) | `cardClasses`, `packBadgeLine`, `handOfferBadge`, `suppressionNote` / `suppressionBand`, `quantityStepper` / `counterStepper` / `numberEntry` / `assignSplitStepper`, `seenHandView`, `waitingNote`, `modStrips` (inspect.ts); `passLabel` (nextstep.ts); `doesLine` (doesline.ts); `effectFace`, `stackBadges`, `lostTargets` (effectface.ts); `earlierNote` (earlier.ts); `glimpseHeadline`, `revealView` (reveal.ts); `fitCards` / `fitBattle` / `fitRes` (fit.ts); `zoomBox` / `panelBox` / `peekBox` (zoom.ts); `freeSpot` (freespot.ts); `focusRegion` (layout.ts) | All DOM-free and tested headless. |
| **Pure but trapped in main.ts** (need a move to a module, no logic change) | `cardHtml` (3287 — depends only on `art()` → engine `getCard` + `artUrl`, `cardClasses`, `packBadgeLine`, `dieHtml`, `placeWarnHtml`), `badgeSpan` (3283), `dieHtml` (3384), `backHtml` (3392), `effectBodyHtml` (6965), `modStripsHtml` (9720), `textBoxHtml` (9640), `xRowsHtml` (3277), `xBadge` (3268), `CONFIRM_BARS` markup (minus the player name lookup) | These are the board's atoms. Extracting them to e.g. `ui/atoms.ts` would make card, badge, die, back, effect face, mod strip and text box stories trivial. |
| **State-reading** (stories need a whole game state) | `unitHtml`, `resHtml`, `handZoneHtml`, `tokenHtml`, `regionParts`, `lboardHtml`, `promptHtml` / `phaseBarHtml` / `decisionBarHtml`, `stackBoardHtml`, `castingHtml`, `toolbarHtml`, `phaseIconsHtml`, `toolClocksHtml`, all dialogs, `logPanelHtml`, `inspectorHtml` (fetches rulings), `judgeOverlayHtml` | These need `h.state` + `NET.legal` + `ui`, so render them through the real client (§5.2). |
| **DOM layers** (render on `document.body`, need a real browser) | `zoom.ts`, `infotip.ts`, `ressum.ts`, hover tip, `anim.ts` arrows and ghosts, `reveallog.ts`, `amend.ts`, `drag.ts`, `layout.ts fitBoard(root, baseCw)` / `ringBoard(root)` | `fitBoard` and `ringBoard` take a `ParentNode` root, so they can run against a story's container. |

### 5.2 Existing ways to render a board in isolation (exactly how they work)

**(a) `?demo` — a static board with no server** (`main.ts:11838-11926`)

- `demoBattle()` builds a mid-battle `GameState` with the engine's `Harness(7)`:
  real actions plus direct spawns (`E.spawnUnit`), pushed resources, then
  Jelly cast at a whale.
- `serveStaticBoard(state, log)` then swaps the module's
  `openSocket = () => new FakeSocket(server)`.
- The fake server answers the first client frame with **one** message:
  `{t:'watching', room:'DEMO', view:state, log, names, peers:[true,true]}`.
- It sets `NET = new NetBackend('DEMO', 0, …, /*spectate*/ true)` and `h = NET`.
- It runs off `file://` (that is why `ART_BASE` is relative; test 247 guards it).
- Limits:
  - One hard-coded board.
  - Spectator mode, so `legal = []`: no glows, no buttons, no prompt bar.
  - `serveStaticBoard` is not exported.
- **This is the closest thing to a Storybook decorator already in the tree.**
  Generalised, it is "pass any (state, log, legal, seat) to main.ts".

**(b) The `openSocket` / `FakeSocket` seam** (`fakesocket.ts`)

`main.ts` reaches the server only through `let openSocket`. `FakeSocket`
implements `readyState`, `onopen` / `onmessage` / `onclose`, `send`, `close` and
`deliver(msg)`, with messages crossing on microtasks. Three in-page servers
already use it:

- `solo.ts` — Learn to Play
- `replayserver.ts` — the BL-38 replay viewer; it pushes a `watching` frame per
  cursor move
- `serveStaticBoard` — `?demo`

Message shapes the client accepts:

- `{t:'joined', seat, view, log, legal, peers, names}` — authoritative,
  interactive
- `{t:'update', view, legal}` — goes through `pace.ts`'s 1s hold, so avoid it
  for stills
- `{t:'watching', …}` — spectator

**(c) Server scenario tester and review boards** (`client/server/scenarios.ts`
plus `scenarios-a…q.ts`; spec `client/docs/14-scenario-tester.md`)

- A `Scenario` is: `{id, card, why, expect, you, opponent, initiative, prologue
  (real engine actions), phase, priority}`. Sides list `hand`, `play: [{card,
  counters, token, mods}]` and `resources`.
- `dealScenario(seed, names, mode, els, decks, id)` (`scenarios.ts:506`) builds
  `createGame`, patches both sides (`board.ts patchSide`), runs the prologue
  through the real `apply`, and **asserts** the declared phase and priority. It
  is pure: same id → same board. Test 185 deals every scenario twice and
  compares them byte for byte.
- There are 91 scenarios across batches A–Q. **Review boards (UI, not card
  correctness):** H (counterattack build, 6), I (the stack, watched, 7), J
  (battle space, 6), M (new interfaces, 2), N (mods on the table, 2), O (board
  round, 2), P (replacement order, 3) and **Q (board round 8, 12 boards)**:
  - `board8-planning-wide`
  - `-haste`
  - `-first-pass`
  - `-stack`
  - `-blocks-counter`
  - `-round2-mine`
  - `-no-counter-end`
  - `-deploy-last`
  - `-modified-unit`
  - `-full-bins`
  - `-invaders-tokens`
  - `-their-wide`
- To open one, run the server with `ALGO_TESTER_TOKEN=<t>` (e.g.
  `ALGO_TESTER_TOKEN=review npm --prefix client run dev`) and visit
  `/api/scenario/open?token=<t>&id=<id>`. That deals a room and 302s to the
  board (`&json=1` returns the room code instead). The owner is seat 0 and a
  scripted bot plays seat 1. The toolbar's 🧪 popover shows `expect` and takes a
  verdict, written to `var/verdicts.jsonl`.
- **This is the richest fixture library for board stories.** Each review-board
  id is a named, deterministic, phase-asserted board state.

**(d) `client/ui/test/ui-driver.ts`** (1162 lines; imported by 123 test files)

- A Node harness with a fake DOM (a `Proxy` element; no layout, all rects are
  0).
- It loads `main.ts` with `__UI_DRIVER_SEARCH` (default `?room=UIDRIVER&seat=0`)
  and holds the other end of the socket.
- `client()` exposes `join(state, seat, legal)`, `update`, `push(msg)`, `click({btn|act…})`,
  `rightClick`, `tap`, `pointer`, `key`, `type`, `html()` (with live slots and
  layers spliced in), `raw()`, `renders()`, `sent()` / `actions()`.
- `local()` drives an engine `Harness(1234)` for both seats; `replay()` and
  `home()` are the other entry points.
- `affordances(html)` lists every `data-btn` / `data-act` with its ancestors.
- Good for generating **markup snapshots** of any state, but nothing is laid
  out, so `--cw` and the fit pass never run.

**(e) Off-repo headless-Chrome rigs** (`~/.claude/projects/-home-bena-Documents-Algomancy/tools/`, README there)

- `board8-check/check.mjs` deals the batch Q boards on a review server and
  checks layout at 1920, 1344 and 1024-touch: 54 checks covering no-scroll, cards
  inside their fit zones, ring reach, tokens, piles, touch taps and peek, zoom +
  panel, spectating, Learn to Play and replay.
- `cssdiff.mjs` produces a computed-style diff of a CSS change (with a positive
  control). `cssdead.py` lists unreachable selectors.
- `walk.mjs`, `zoomrig.mjs`, `boardshots.mjs` and `roomshot.mjs` drive real CDP
  mouse and touch.
- `review-rooms/BTUA.json` and `BTUB.json` are sliced live games, plus
  `slice-game.py`.

**(f) `?replay=CODE&at=N` and `?question=ID`**

These show a saved game frozen at an action (`main.ts:12623-12700`). The
replay server pushes `watching` frames, so it is spectator-only again.

### 5.3 Suggested route (for the Storybook reader to weigh)

1. **Atoms.** Move the pure markup functions out of `main.ts` (see the
   "trapped" row above) into a module, and write stories for card (every
   `cardClasses` state × badges × die × stats × mods), badge line (fold cases),
   die, back, rescard states, effect face, text box, stepper view models, and
   the info and resource tips. Stories need `style.css`, `/data/icons/`
   (`ICON_BASE` is absolute) and `data/cards/` art at `ART_BASE` (relative,
   `../../data/cards/`), optionally with `art-versions.js`.
2. **Whole-board stories.** Generalise `serveStaticBoard` into a decorator:
   - At build time in Node, call `dealScenario(...)` for each review-board id,
     plus `legalActions(state, seat)` (`engine/src/apply.ts`) and the seat's
     redaction `viewFor(state, seat)` (`server/view.ts:191`). Dump the results to
     JSON fixtures.
   - In the story iframe, set `openSocket` to a `FakeSocket` that delivers
     `{t:'joined', seat:0, view, log:[], legal, peers:[true,true], names}`. Use
     `joined`, not `watching`, so glows and bars appear.
   - Constraints:
     - `main.ts` owns `#app` and module globals and routes at import, so it is
       **one board per iframe document**. The story must remount the page, not
       re-render it.
     - Freeze time and set motion off (`motiontoggle`; `prefers-reduced-motion`)
       for stable snapshots.
     - Add `html.touch` for touch stories.
     - Use a viewport addon at 1920, 1344 and 1024 to match `check.mjs`.
       Card sizes are a function of the viewport (fit pass).
   - UI-only states (an open dialog, a context menu, settings ⋯, carrying a
     unit) can be reached by a scripted click after mount, the way ui-driver and
     `walk.mjs` do. Alternatively, export a `__setUi` hook.
