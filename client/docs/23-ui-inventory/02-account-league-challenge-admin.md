# UI inventory 02: account, profile, league, weekly challenge, admin

Reader 2 of 7. Area: `client/ui/account.ts` (1213 lines), `league.ts` (1292), `leaguenotes.ts` (79), `challenge.ts` (601), `challengebuild.ts` (231), `challengerun.ts` (369), `admin.ts` (516), `judgehistory.ts` (29). Also the `challengeStripHtml` part of `deckstrip.ts`, the account forms that `postgame.ts` renders (`account.ts` handles them), and the glue in `main.ts`.

Paths below are relative to `client/ui/`. CSS line numbers are in `style.css`.

---

## 0. Orientation

### 0.1 How these pages take over `#app`

`renderHome()` (main.ts:9329) checks each page's `screen()` in a fixed order, and the first one that is open paints `#app` (main.ts:9335-9357):

1. `acct.screen()`: sign-in or profile (main.ts:9335)
2. `crr.screen()`: rules review (another reader)
3. `cb` → `tt` → `dk` → `meta` (another reader)
4. `lg.screen()`: league (main.ts:9351)
5. `chal.screen()`: weekly challenge (main.ts:9353)
6. `admin.screen()`: admin (main.ts:9355)
7. `mm.screen()`: queue (another reader)

The account screen comes first. So the profile's nav buttons call `acct.leaveScreen()` before they open another page (main.ts:11202-11205): `nav-league`, `nav-challenge`, `nav-admin` and `nav-crreview`.

Clicks go through one delegated `click` listener on `document` (main.ts:10416). It finds `closest('[data-btn]')` and calls `handleButton` in main.ts (main.ts:11197). That handles the `nav-*` buttons itself, then hands each prefix to its module: `acct-` (plus `pg-claim` and `pg-signup`), `lg-`, `ch-`, `admin-`. The challenge run layer is the exception: it uses `data-chal` and its own capturing listener (challengerun.ts:361-367).

### 0.2 URL parameters (entry points)

| URL | Opens | Where it is read |
|---|---|---|
| none | No URL for sign-in or profile. A reload loses the profile. | account.ts has no URL sync |
| `?league` or `?league=1` | League page, current season | league.ts:157-163 |
| `?league=<seasonId>` | League page for that season | league.ts:159-160, `syncUrl` 383-390 |
| `?challenge` or `?challenge=1` | Challenge page | challenge.ts:108-120 |
| `?challenge=<id>` | Challenge page with that challenge's builder open | challenge.ts:113 |
| `?challenge=1&board=<id>` | Challenge page with that past week's board unfolded (where Watch returns to) | challenge.ts:115, main.ts:12611 |
| `?challenge=1&signin=1` | Challenge page with the sign-in screen on top, which returns to the page | challenge.ts:119, main.ts:12774 |
| `?challenge=play&id=<id>` | A challenge run (the game board) | main.ts:12572-12583 |
| `?challenge=watch&run=<runId>` | Replay viewer playing a closed week's run | main.ts:12584-12618 |
| `?table=ch:<id>` | Tabletop deck builder for that challenge | challenge.ts:590-601 |
| `?admin=1` | Admin dashboard | admin.ts:213-219 |
| `?replay=<code>` | Linked from history rows and admin game rows | account.ts:932, admin.ts:326 |

### 0.3 `judgehistory.ts`

It has **no UI**. It is a DOM-free helper (`judgeHistory()`, judgehistory.ts:21-29) that turns the judge box's exchanges into turns for the bot. main.ts:5201 is its only caller. There is nothing to inventory.

---

## 1. Home-page surfaces this area owns

### 1.1 `acct.barHtml()`: the identity widget (account.ts:361-376)

**Reached:** it always renders in the home header's `.homeident` cluster (main.ts:9374), right of the `ALGOMANCY` wordmark. When signed out, main.ts puts a "Your name" input before it (main.ts:9371-9373, another reader's), and the two read as one cluster.

**Layout:** one flex row.

| element | what it is / does | states & variants | CSS classes | file:line |
|---|---|---|---|---|
| Signed-out container | A `<div>` strip | Shown when `me` is null: signed out, a token not yet resolved, or offline with no cached profile | `.acctbar.out`: flex, panel2 bg, 6px radius, 12px font (style.css:1771-1772) | account.ts:363 |
| Hint text | "Playing signed out — nothing is recorded." | Signed out only | `.accthint`: dim, `flex:1` (style.css:1773); `.homeident .acctbar .accthint { flex: 0 1 auto }` (style.css:453) | account.ts:364 |
| Log in button | "Log in / Sign up". Opens the auth screen. `authMode` is `register` when signed out (account.ts:1027) | Signed out only. Note: the label says "Log in" but the screen opens on **Create an account** | base `button`; `.acctbar button` 4px 10px / 12px (style.css:1774) | account.ts:365 |
| Signed-in container | The whole strip is a `<button>`. It opens the profile on the Stats tab and refetches `/api/me` | `me` present. Tooltip: "your profile, stats and achievements". On hover the border turns accent and the name is underlined | `button.acctbar.in` (style.css:1777-1779) | account.ts:372 |
| "Playing as" + name | "Playing as **{username}**" | none | `.acctwho` (dim, flex), `.acctname` (bold, accent, 13px) (style.css:1780-1781) | account.ts:373 |
| Favourite element icon | The element's `.webp` icon, 18px. Title "favorite element: {el}" (US spelling; the profile uses "favourite") | Only if `favoriteElement` is set | `.acctel.icon.{el}` (style.css:1786-1790), img from `ICON_BASE` | account.ts:352-353 |
| Record line | "{w}W–{l}L", then " · {n} unrecorded" if any unresolved games. "no games yet" when there are 0 games | 0 games / some games / some unresolved | `.acctrec`: dim, `flex:1` (style.css:1782) | account.ts:369-371, 374 |
| Streak flame | " · 🔥{n}" | Only when `streak >= 2`. An emoji used as the icon | inside `.acctrec` | account.ts:374 |

There is no loading state. Until `/api/me` resolves, a signed-in user sees the signed-out strip. There is no logout here: a comment says it moved to the profile (account.ts:358-360).

### 1.2 League nav button: `lg.navButtonHtml()` (league.ts:190-196)

| element | what | states | classes | line |
|---|---|---|---|---|
| "🏅 League" | Opens the league page (`nav-league`) | Hidden unless a season is visible **or** the viewer is an organizer. Becomes "🏅 League · sign up" with an accent border when the season can be joined and the viewer has not joined | `.homedecks` (the "My decks" button's class reused, style.css:2570, margin-top only); `.lgnavjoin` (style.css:5126) | league.ts:195 |

Side effect: rendering it calls `askHint()`, which can `fetch('/api/league')` (league.ts:170-183). The same applies to the banner.

### 1.3 Challenge nav button: `chal.navButtonHtml()` (challenge.ts:266-270)

| element | what | states | classes | line |
|---|---|---|---|---|
| "🧩 Challenge" | Opens the challenge page (`nav-challenge`) | Hidden when there is neither a current nor a past challenge, or no server | `.homedecks` | challenge.ts:269 |

Rendering it also calls `askHint()`, which fetches `/api/challenge`.

### 1.4 League home banner: `lg.homeBannerHtml()` (league.ts:229-262)

**Reached:** it sits on the home page under the header and above the queue strip (main.ts:9384). It renders when `/api/league` returns a season the viewer can see.

**Layout:**
1. Head row `.lgbhead`: fold toggle and name, phase, an "in" tick, the next date, and a CTA.
2. Unfolded only: the date pills `ol.lgbdates`.
3. Unfolded only: `.lgbbody`, an auto-fit grid (min 240px) of three blocks: How it works | Join steps / your matches / Champion | Signed up / Standings and pairings.
4. Then one `.lgbanner.lgbother` line per **other** running season (`otherHtml`, league.ts:267-280).

| element | what | states & variants | classes | line |
|---|---|---|---|---|
| Section | `<section aria-label="League">` | none | `.lgbanner`: panel bg, **accent** 1px border, 10px radius (style.css:5064) | 238 |
| Fold toggle | "▾/▸ 🏅 **{season name}**". Toggles `bannerOpen` and stores it in `localStorage.algoLeagueBanner` | `aria-expanded`. **Default is folded when `innerWidth < 700`** (league.ts:118-122) | `.lgbfold` (unstyled button look, 15px), `.lgbcaret` (dim, 1em) (style.css:5067-5068) | 240-241 |
| Phase label | "Constructed · " (constructed seasons only) + `s.label` (e.g. "Week 2 of 3") | Format prefix | `.lgbphase`: accent, bold, 12px, uppercase (style.css:5069) | 242 |
| In tick | "✓ you're in" | Only if entered | `.lgbin`: glow green 12px | 243 |
| Next date | From `nextText()`: "Champion: X" / "Sign-ups open {day}" / "Week 1 starts {day}" / "The final starts {day}" / "Ends {day}" / "Week N starts {day}" | One per phase (league.ts:283-292). Dates are in the viewer's availability zone | `.lgbnext`: dim 13px, `flex:1` | 244 |
| CTA (join) | "Sign up". Opens the league page (`lg-open`) | When the season can be joined and the viewer is not entered | `.cta.primary`. Only `.lgbhead .cta` padding is defined (style.css:5072), so it gets the green `button.primary` look, **not** the accent CTA look the home cards use | 236 |
| CTA (default) | "League page" | Otherwise | plain button | 237 |
| Date pills | One `<li>` per phase: "Sign-up week Sun 5 Oct", "Week 1 …", "Final …", "Ends …" | `.now` gets an accent border, `.past` is 50% opacity | `.lgbdates`, `li.now`, `li.past` (style.css:5073-5078) | 247-250 |
| "How it works" h3 + fold | A button inside the h3: "▾/▸ How it works" | Open by default if not entered, folded if entered. Not persisted (`howOpen`) | `.lgbhowfold` (style.css:5128-5129); `.lgbbody h3` is dim, 11px, uppercase (5080) | 252-256 |
| How list | Six bullets. Copy is in `howHtml` (league.ts:294-303): "Each week (Sunday to Saturday) you get {perWeek} opponents, matched on the hours you are both free." … "A win is 3 points. A match nobody plays counts for neither player." … "After week {n}, the top two play one game for the title." | The third bullet changes with the format (`matchLine`, 205-207) | `.lgbhow` (5083) | 294-303 |
| Champion block | h3 "Champion" + "🏆 **{name}**" | Once a champion exists | `.lgbchamp` (16px) | 257 |
| Join steps | h3 "How to join" + four ticked steps: "Sign in or make an account" (a `.linkbtn` to `acct-open-auth`) / "Signed in"; "Mark when you are usually free" / "Marked …"; "Add your Discord name" / "Discord name: X"; "Join from {day}" / "Join on the League page" / "Joined" | Each step `done` → dim with a green ✓ circle. Undone steps are `.linkbtn`s to `lg-open` when signed in, plain text when not. A closed season shows "Sign-ups for this season have closed. The next one will be announced on Discord." Adds "Late entries are open until week 2." when it applies | `.lgbsteps`, `li.done`, `.lgbtick` (round 15px badge), `.linkbtn` (style.css:3718, dotted-underline accent) | 306-321 |
| Your matches (entered) | Sign-up week: h3 "Sign-up week", rows, "{n} players are free when you are." / "Nobody shares your hours yet." "Up to {cap} games this week count.", and a "Find an opponent" button. Weeks: h3 "Your matches this week" or "Your final". Rows read "vs **{opp}** ({contact} on Discord)", optionally with a time line under them, and on the right "✅ won" / "lost" / "not played" / a **Play** button (`lg-play`) / "to play" | Time line: agreed "{when} ✓" (green); mine "you suggested {when}" (dim); theirs "suggests {when} — answer on the League page" (accent). No match: "You are sitting this week out." / "None this week." | `.lgbrows li` (flex, space-between), `.lgbtime(.agreed/.ask/.dim)` (style.css:5110-5112) | 324-346 |
| Signed-up names | h3 "Signed up ({n})" + name pills | Before week 1. Empty: "Nobody yet — be the first." | `.lgbnames span` (pill) | 349-355 |
| Standings mini | h3 "Standings" + a table: rank / name (+🏆) / W–L / "{n} pts". At most 8 rows, then "+{n} more on the League page" | Week 1 onward | `.lgbtable` (5090-5093) | 356-365 |
| Pairings mini | h3 "Week {n} pairings" / "The final" + rows "**W** beat L", or "A vs B" with "to play" / "not played" / "double loss" | Mine first, highlighted in accent (`li.mine`) | `.lgbrows li.mine` | 366-369, 373-381 |
| Other-season strip | "🏅 **{name}**", the label, the next line or final pairing, "vs **{opp}**" + **Play** per playable match, and a button named after the season | One per extra running season | `.lgbanner.lgbother` (grey border, style.css:5066) | 267-280 |

### 1.5 Challenge home card: `chal.homeCardHtml()` (challenge.ts:273-285)

It sits in the home `.homegrid` as the fourth card (main.ts:9437).

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | `div.homecard.chhome`. `.chhome` has **no CSS** | Hidden when there is no current challenge | `.homecard` (style.css:458) | 278 |
| Heading | "This week's challenge" | none | `.homecard h2` | 279 |
| Goal | **{goalText}** | none | `.cardsub` | 280 |
| Time and best | "{3d 4h left}" + " · your best: {n} turns (#{rank} fastest)" | Best shown only when `mine` has a score | `.cardsub` | 281 |
| Spacer | Pushes the CTA to the bottom | none | `.spacer` | 282 |
| Play | "Play" opens the challenge page (`ch-home-play`). It does **not** start a run, despite the label | none | `.cta.primary` (accent CTA, style.css:467-468) | 283 |

---

## 2. Sign-in / register screen (account.ts:387-421)

**Reached:**
- "Log in / Sign up" on the home bar, which opens on **register** (account.ts:1027)
- "Sign in or make an account" in the banner join steps
- "Log in / Sign up" on the league Join card
- "Sign in to submit" on the challenge Finished runs card, or `?challenge=1&signin=1`, both through `signInThenReturn()` (account.ts:294-297), which opens on **login** and returns to the page that asked
- the rules review "Sign in to comment" (another reader)
- the profile route, if `me` is missing (account.ts:499)

There is no URL.

**Layout:** a centred 420px card (`.joinscreen`), stacked vertically: wordmark, h2, hint, the register-only warning, two labelled inputs, the message, a column of buttons, the register-only footer hint.

| element | what | states & variants | classes | line |
|---|---|---|---|---|
| Card | Container | none | `.joinscreen.home.acctscreen`. `.joinscreen` (style.css:348-355): max 420, margin 60 auto, panel, 10px radius, gap 14. `.home` has **no rule** | 389 |
| Wordmark | h1 "ALGOMANCY" | none | `.homelogo`: accent, .3em tracking, centred (style.css:427) | 390 |
| Title | h2 "Create an account" / "Log in" | Mode | `.acctscreen h2` / `.joinscreen h2` accent (style.css:1800, 349) | 391 |
| Hint | Register: "A username and a password, nothing else — no email, no recovery." Login: "Signed in, every game you play is recorded to your profile." | Mode | `.hint` → `.joinscreen .hint` dim 12px (style.css:355) | 392-394 |
| Password warning | "**DO NOT FORGET YOUR PASSWORD. THERE IS NO PASSWORD RESET.** There is no email address on this account to send one to. Write it down." | Register only. `data-warn="nopwreset"` (a test hook) | `.pwwarn`: panel2, **danger** border, bold red (style.css:531-534) | 395-397 |
| Username | label "Username" + input `#a-user`, maxlength 20, autocomplete username, prefilled with `me?.username` | Focused on register | `.namerow` (flex) + `.acctscreen .namerow` override (style.css:1803-1804); the input is panel2 | 398-399 |
| Password | label "Password" + `#a-pass` type=password, maxlength 200, autocomplete new-/current-password | Focused on login | same | 400-401 |
| Message | Error text: "username and password, please" / server error / "that did not work" / "could not reach the server" | When `authMsg` is set | `.deckmsg`: **accent gold**, 12px (style.css:520). Errors are gold, not red | 402 |
| Submit | "Create account" / "Log in" / "working…" | Disabled while busy. Enter in either input clicks it (keydown listeners bound after the paint, 413-418) | `.primary` in `.homebtns` → accent border and text on the green bg (style.css:430-432) | 404-405 |
| Toggle | "I'm new here — create an account" / "I already have an account" | Mode | button | 406-407 |
| Back | "Back". Closes to the host page | none | button | 408 |
| Footer hint | "Sign up with a name you have played under here and those games come with it." | Register only | `.hint` | 410-411 |

The success path stores the token and `algoName`, then shows the profile on Stats, or returns to the host when `returnAfterAuth` is set (account.ts:974-983).

There is **no password reset** (by design) and **no "forgot password" link**. Errors come back as the server's raw strings.

---

## 3. Profile page (account.ts:498-535)

**Reached:** the signed-in identity bar (`acct-open-profile`), which always lands on the **Stats** tab, or a successful sign-in. There is no URL and no deep link to a tab.

**Layout:**
- `.acctpage` shell: max 1100px, centred, 12px padding (style.css:1811).
- `.accthead`: a flex row. Left side: h1 (name, element icon, badge chips, trophy chips) with a summary hint under it. Right side: `.accthbtns`, a wrapping button cluster.
- `.accttabs`: a row of six tab buttons.
- `.acctbody`: an auto-fit grid of `minmax(300px, 1fr)` cards; `.acctcard.wide` spans the full width (style.css:1823-1825).

### 3.1 Header

| element | what | states & variants | classes | line |
|---|---|---|---|---|
| h1 name | `{username}` | none | `.accthead h1`: 26px, flex (style.css:1814) | 511 |
| Element icon | Favourite element as an 18px icon | If set | `.acctel.icon` | 511, 352 |
| Owner chip | "Owner" (CSS uppercases it). Title "the site's owner" | `badge.owner` | `.badgechip.owner`: filled accent, .55em, pill (style.css:933-935) | 134 |
| Judge chip | "Judge L{1-3}". Title "judge level N — a trusted voice on rules and reports" | `badge.judge` | `.badgechip.judge` (outline accent) | 135 |
| Trophy chips | "🏆 Champion · {season}" / "🥈 Finalist · …" / "🏅 Participant · …", newest first. Title "{season}: champion, 3–1 in the league" | One per finished season. An unknown place renders nothing | `.badgechip.trophy.{champion/finalist/participant}`. Champion is filled `#e0a93c`, finalist `#b8c2cc` outline (hard-coded, style.css:937-939). **Participant has no rule**, so it falls back to the accent outline | 145-168 |
| Summary hint | "{n} games · {w}W–{l}L · {n} with no recorded result · playing since {Mon d}" | The unresolved clause is conditional. "game"/"games" pluralised | `.accthead .hint` (dim 12px) | 512-514 |
| League | "🏅 League". Title "the league: sign up, your matches, the standings" | Always shown, even with no season (the home nav hides it then) | button | 517 |
| Challenge | "🧩 Challenge". Title "this week's solo puzzle and its leaderboard" | Always shown | button | 518 |
| Admin | "🛠 Admin". Title "the operator dashboard" | Only if `me.admin` | button | 519 |
| Rules review | "📜 Rules review". Title "the comprehensive rules, open for review and comments" | Only for the owner or a judge | button | 520 |
| Refresh | "↻". Title "reload from the server". Refetches `/api/me` | No spinner or feedback. Icon-only | button | 521 |
| Log out | "Log out". Posts `/api/auth/logout`, clears the token, goes home | **No confirm** | button | 522 |
| Return to Lobby | "Return to Lobby" (primary). Closes the profile | none. Note: there is no page called "Lobby"; it goes to the home page | `button.primary` (green) | 523 |

### 3.2 Tab bar (account.ts:501-506, 526)

| tab | label as rendered (CSS uppercases it) | count badge | line |
|---|---|---|---|
| stats | "stats" | none | 501 |
| achievements | "achievements" + `{earned}/{total}` | `.acctcount` dim | 503 |
| ladder | "ladder" | none. Fetches `/api/players?mode=` on first open | 501, 1169 |
| friends | "friends" + `{friends}` + ` +{incoming}` | `+N` when there are incoming requests (the only pending-request signal) | 504 |
| decks | "decks" + `{published count}` | none | 505 |
| history | "history" | none | 501 |

Classes: `.accttabs` (flex, gap 6), `.accttab`: uppercase 11px, 6px 12px (style.css:1819). `.accttab.on`: accent border, text and bold (style.css:1820). There is no `role="tablist"`, `role="tab"` or `aria-selected`. The handler re-lists the tab names by hand, with a ⚠ comment that `decks` once went missing (account.ts:1161-1165).

### 3.3 Stats tab (`statsTab`, account.ts:592-670)

Cards, in order: **Record**, **Connections** (conditional), **Password** (conditional), **Elements**, **On the table**, **Combat**, **Most played cards**, **Head to head** (conditional).

| element | what | states | classes | line |
|---|---|---|---|---|
| Card shell | `section.acctcard` | none | panel, 6px radius (style.css:1824). h3 accent 14px uppercase (1828); h4 dim 12px uppercase (1830) | 595 |
| Record: stat grid | Six cells: games / wins / losses / no result / win streak / best streak. The "no result" title is "games played on an older engine whose log no longer replays…" | Numbers use `toLocaleString` | `.statgrid` (auto-fit 88px) / `.statcell` / `.statval` (20px bold) / `.statlab` (10px uppercase dim) (style.css:1838-1843) | 597-604 |
| Formats line | "formats played: live draft 3 · constructed 2" or "none yet" (`modeName` turns `shared` into "sandbox") | none | `.hint`. **No colour rule applies inside `.acctcard`**, so it renders at full text colour (see smells) | 605, 588-590 |
| Rating h4 + grid | h4 "Rating"; cells "constructed" and "live draft" (default **1000**). Title "{n} rated constructed games" | Shows 1000 even with 0 rated games | statgrid | 606-612 |
| Rating hint | "Everyone starts at 1000 — see the ladder for what counts." or "over {c} constructed and {d} draft games from the queue" | 0 rated / some rated | `.hint` | 613-615 |
| Unresolved hint | "{n} games from before results were recorded." | If unresolved > 0. Duplicates the stat cell and the header hint (said three times) | `.hint` | 616-617 |
| Connections card | h3 "Connections" | **Hidden** when the server has no Discord bot (`discordLinking` false) | `.acctcard` | 544-567 |
| …linked | A stat "**Discord** @handle" + "Unlink Discord" button + hint "Lets `/profile` and `/rating` find you. Unlinking works even if you have lost the Discord account." | Linked | `.statgrid > .stat` (**`.stat` has no CSS**); `button.btn` (**`.btn` has no CSS**); `.linkcode` (**no CSS**) | 548-554 |
| …code showing | "**your code** {CODE}" + "Type `/link code X` in Discord within ten minutes." | While the code has not expired. **No countdown**, and nothing repaints when it expires | same | 559-563 |
| …unlinked | "Link Discord" + "Get a code here and type it into the bot." | Default | same | 564-565 |
| …error | The code request's error goes into `authMsg`, which only the **auth** screen shows, so on the profile it is **never shown** (bug) | none | none | 1130 |
| Password card | h3 "Password"; a hidden username input (password managers); "Current", "New", "New again" inputs; "Change password" button; message line | Hidden for guests. Messages: "fill in your current and new password" / "the new passwords do not match" / server error / "Password changed." (`.hint`) / "could not reach the server". Errors are `.deckmsg` (gold) | `.acctcard.pwform`, `.namerow` (style.css:1827) | 572-583, 1049-1060 |
| Elements card | h3 "Elements"; an element bar (flex segments sized by weight, title "{el}: N%"); a legend of pills "fire 40%" | Empty: "No cards played yet." | `.elbar` / `.elbarseg.{el}` (inline `style="flex:{w}"`) / `.ellegend` / `.acctel.{el}` pills (style.css:1845-1850, 1786-1799) | 467-477, 621-624 |
| …hint | "By card played; a hybrid counts half to each element." | none | `.hint` | 624 |
| …Recycled | h4 "Recycled for resources" + a second bar + "Prismites you turned into an element count here too." | same empty state | same | 625-627 |
| …Favourite element | h4 "Favourite element" + a `role="radiogroup"` of icon buttons (`role="radio"`, `aria-checked`) + an "auto" pill | `.on` is the chosen one. Hint: "You chose {el}." / "Showing the element you have played most — {el}." Each click posts and refetches with no busy state | `.favpick`, `.favel` (34px circles, .55 opacity), `.favel.on` (accent outline), `.favel.auto` (style.css:1791-1795) | 482-491, 628-629 |
| On the table card | Eight stat cells: units played / spells played / spell tokens cast / augments & grafts / cards drafted / different cards / abilities used / resources opened | none | statgrid | 631-643 |
| Combat card | Eight cells: damage dealt / life lost / units killed / units lost / attacks declared / units sent / turns played / longest game ("turn N", a string value) | none | statgrid | 644-656 |
| Most played cards | An `<ol>` of "{card} ×{n}" | Empty: "Nothing yet." Card names are not links or previews | `.topcards`, `.tcname`, `.tcn` (style.css:1852-1855) | 657-662 |
| Head to head | A headerless table: opponent / "{n} games" / "{w}W–{l}L" (green if W≥L, else red) | Hidden with no opponents | `.accttable`, `.good` / `.bad` (style.css:1857-1862) | 663-669 |

### 3.4 Achievements tab (account.ts:672-755)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | `section.acctcard.wide`, h3 "Achievements" + "{earned} of {total}" | none | `.acctcount` | 751-754 |
| Group section | h4 "{group}" + "{got}/{n}". Groups follow `GROUP_ORDER`: Getting started, Winning, Elements, On the table, Combat, One-game feats, Formats and people, League. Unknown groups go last | none | `.achgroup` / `.achgroup h4` (style.css:1898-1900) | 675-678, 745-748 |
| Achievement tile | Icon (a server-sent emoji, **inserted unescaped**), name, earned date, description, rung pips, progress bar, "have / need" | Earned: full opacity, accent border, coloured icon, accent name, date. Unearned: .55 opacity, grayscale icon, bar and progress. Secret (`hidden`): dashed border, monospace name, no bar. Ladder: shows the lowest unearned rung with one pip per rung (title "{x} of {n} earned") | `.achgrid` (auto-fill 260px), `.ach(.got/.secret)`, `.achicon`, `.achbody`, `.achname`, `.achdate`, `.achdesc`, `.achpips span(.on)`, `.achbar > span` (**inline `style="width:{pct}%"`**), `.achprog` (style.css:1882-1907) | 689-722 |

Sort order inside a group: earned first, then closest to done. There is no filter or search.

### 3.5 Ladder tab (account.ts:785-831)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Ladder" | none | `.acctcard` (not wide) | 823-824 |
| Mode switch | Two buttons: "Constructed" / "Live draft" | `.on`. Implemented with the **element chip** class | `.elrow` + `.elchip(.on)` (style.css:931, 941-942; opacity .55 when off, accent outline when on) | 786-788 |
| Loading | "loading…" | Before the fetch lands, and on every mode switch (the board is cleared) | `.hint` | 790-794 |
| You line | "**You** · #{rank} of {rated} · **{rating}**" + "{n} rated games — {k} more and you appear on the board above." | Shown when you are rated but not listed. When unrated: "You have no rated {draft/constructed} games yet." Hidden when you are listed (your row is highlighted instead) | `.youstanding`: panel2, 3px accent left edge (style.css:3451-3452) | 813-821 |
| Table | Columns: `#` / (dot) / player / rating / rated / record. Rows: rank, online dot (**no title here**, unlike the friends rows), name + element icon, **rating** (accent bold), rated count, "{w}W–{l}L" | `tr.myrow` (panel2 bg) | `.accttable.ladder`, `.lrank`, `.lrating`, `.fdot(.on)` (style.css:3448-3450, 1914-1915) | 796-809 |
| Empty | "nobody has played 5 rated constructed games yet — the board fills up as people play." | No listed players. The **same text is shown on a fetch error** (`catch` returns an empty board) | `.hint` | 810-811, 1004 |
| Footnote | "Everyone starts at 1000. Only games from the **matchmaking queue** are rated — a game started by room code moves nothing. Constructed and live draft are rated separately." | none | `.hint` | 828-829 |

### 3.6 Friends tab (account.ts:833-864)

| element | what | states | classes | line |
|---|---|---|---|---|
| Add a friend card | h3 "Add a friend"; input `#a-friend` (placeholder "their username", **no label**, maxlength 20); "Send request" | Messages: "request sent to X" / "you and X are now friends" / server error / "could not reach the server". All in `.deckmsg` gold, success included. Enter does **not** submit (no key binding) | `.joinrow` (the room-code row: the input is **centred, bold, .2em letter-spaced** like a room code, style.css:433-437) | 843-850, 1182-1195 |
| Wants to be friends | h3 + friend rows with **Accept** (primary) / **Decline** | Hidden when there are none | `.friendrow` | 851-853 |
| Friends card | h3 "Friends {n}" + rows with a ✕ (title "remove friend") | Empty: "Nobody yet. Add your opponent by their username." Removing has **no confirm** | `.friendrow`, `.fdot` (title "online now" / "offline"), `.fname`, `.acctel.icon`, `.fstats` "{n} games · {w}W", `.fspacer` (style.css:1909-1915) | 757-772, 854-859 |
| Waiting on | h4 "Waiting on" + rows with "asked" + **Cancel** | Only with outgoing requests | `.hint` "asked" | 858, 768-769 |
| Everyone here | `section.wide`, h3 "Everyone here", and a table of **all players**: dot / player / games / record / **badges** (actually the earned achievement count) | "loading…". On error, an empty table body with no message | `.accttable` | 834-842, 860-863 |

### 3.7 Decks tab (account.ts:439-464)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | `section.wide`, h3 "Published decks" | Empty: "Nothing published yet. Share a deck from its **share** tab and it appears here." | `.acctcard.wide` | 442-446 |
| Deck row | A whole-row button (`meta-open`, so meta.ts handles it). Cover thumbnail (46px, inline `onerror` hides a broken image), name, "{n} cards · after {owner}'s {name}", and on the right "**{pct}%** {w}W–{l}L in {g}" or "no games yet" | Cover optional; the percentage only when there are decided games | `.metalist`, `.metarow`, `.metacover`, `.metabody`, `.metaname`, `.metaby`, `.metarec`, `.dim` (borrowed from the metagame page, style.css:3287-3297). `.dim` is **unstyled here** | 447-463 |

### 3.8 History tab (account.ts:866-949)

| element | what | states | classes | line |
|---|---|---|---|---|
| Empty | "No games recorded yet." in a plain card (**no h3**, unlike every other tab) | 0 games | `.acctcard` | 938 |
| Card | `section.wide`, h3 "Recent games" | none | | 939-940 |
| Table head | result / opponent / format / elements / turns / life / played / room | none | `.accttable.games` (th uppercase dim 10px) | 941-944 |
| Result cell | "WIN" (green, bold) / "loss" (red), **inconsistent case** / "?" (whole row dim) | `tr.res-{win/loss/unknown}` | style.css:1863-1866 | 925 |
| Tags | "walkover · not counted" (title "{who} conceded on turn N"); "early concession · half weight" (accent); "custom · not counted" (title lists the rules); "single card · not counted"; "fixed"; "disputed" (title "{who} disputed this result") | Per flag. A walkover row is dimmed whole | `.constag(.walkover/.early/.custom/.fixed/.disputed)`: 10px uppercase boxed, `cursor:help` (style.css:1872-1880) | 872-906 |
| Elements cell | Element pills. Draft: one trio. Other formats: "mine vs theirs", with "—" for a side that played no card | none | `.acctel.{el}`, `.hint` " vs " | 916-920 |
| Turns | "{n}", plus an accent **+** with title "played on an older engine — its numbers are a floor, not a total" | `diverged` | `.partial` (style.css:1868) | 929 |
| Life | "{mine}–{theirs}" | none | | 930 |
| Played | "Oct 3" (locale) | "—" if invalid | | 931 |
| Room | Link "▶ {CODE}" → `?replay=CODE`, title "watch this game back" | none | `.roomcell` (monospace dim), `.replaylink` (accent, style.css:3994-3995) | 932-933 |
| Legend | "▶ watches a game back, one action at a time. **+**: played on an older engine, so its numbers are a floor. A **walkover** (conceded on turn 1) counts toward nothing; an **early concession** counts at half weight." | none | `.hint` | 945-947 |

There is no pagination, filter or sort, and **no horizontal-scroll wrapper**: the 8-column table overflows its card on a phone.

### 3.9 Post-game account forms (rendered by `postgame.ts`, handled by `account.ts`)

These belong to the post-game screen, which another reader owns. They are listed here because their behaviour and copy live in account.ts.

| element | what | states | classes | line |
|---|---|---|---|---|
| Guest claim form | "Keep this game?" / "You played as a guest. Sign up to keep this game and your rating." / unlabelled inputs with placeholders "a name" (**maxlength 40**, against 20 everywhere else) and "a password" / "Keep it" / an error slot | On success the form becomes "Saved — this game is on your profile now." | `.pgclaim`, `.pgclaimhead`, `.pgclaimerr` (style.css:3472-3476, in rem with rgba-white colours), `.hint` | postgame.ts:211-221; handler account.ts:1070-1088 |
| Signed-out sign-up | "Keep this game?", a hint, the `.pwwarn` capitals warning (short version), inputs, "Sign up and keep it" | Becomes "Signed up — this game is the first one on your profile." / "Signed up. The offer for this game had run out, so your profile starts with your next one." | `.pgnote` (style.css:2081) | postgame.ts:234-248; account.ts:276-279, 1092-1120 |

---

## 4. League page (league.ts:481-511)

**Reached:**
- the home header "🏅 League" or the banner's "Sign up" / "League page" / "Find an opponent" / step links (`lg-open`)
- the profile "🏅 League"
- a bell note's "League page" (main.ts:12432-12439, which navigates when in a game)
- the URL `?league` or `?league=<id>`

**Layout:**
- Shell: `.metapage.lgpage` (max 1100, padding 10/18/32, style.css:3283), so a different shell from the profile's `.acctpage`.
- Header: the profile's `.accthead`. Left: h1 "🏅 League" and a hint subtitle. Right: `.accthbtns` holding only "Back".
- Message bar `.acctmsg`.
- Season switcher `.cbtools`.
- "Loading…".
- Other-season strips (the banner's `otherHtml`).
- `.acctbody`, overridden to **3 fixed columns** (`.lgpage .acctbody`, style.css:5028), dropping to 1 column at ≤760px (style.css:5035-5039). Cards in order: No season · Season (span 2) · Join/You're in · Availability (wide) · Your matches (wide) · Free when you are (wide) · Standings · Matches (span 2, or wide for an organizer) · Discord time code · Organizer (wide).

| element | what | states & variants | classes | line |
|---|---|---|---|---|
| h1 | "🏅 League" | none | `.accthead h1` | 487 |
| Subtitle | "A month of live drafts: opponents every week, matched on when you can play, then a final." / "A month of casual constructed: …" | Format | `.hint` (dim inside `.accthead`) | 488, 209-211 |
| Back | "Back" (`lg-close`) | none | button | 489 |
| Message | Every action's result: "Saved." "Copied." "You're in {season}." "Called off." "Suggested {when}. They'll see it in their own time zone." "Agreed. You both get a reminder fifteen minutes before." "Moved on." "Season created." "Result set." "Added." "Deleted." "Paired again. Copy the new post below for Discord." / errors: "could not load the league", "could not reach the server", "not allowed", "pick a day and a time first" | When `msg` is set. It **never clears on a timer** and lasts until the next action. Success and error look the same | `.acctmsg`: **no CSS rule at all**, so plain unstyled text | 491 |
| Season switcher | One button per season ("{name}", plus " 🔒" when hidden) | Only with more than one season. `.on` on the current one, **but `.cbtools button.on` has no rule**, so the selected season is not shown | `.cbtools` (the card browser's toolbar: flex, 12px, dim, style.css:3045) | 492-493 |
| Loading | "Loading…" | Only before the first answer. Later reloads show nothing | `.dim` | 494 |
| No season | "No season yet" / "There is no league season running right now. Watch the Discord for the next one." | Data loaded, no season | `.acctcard.wide` (a `div`, not a `section`) | 497 |

### 4.1 Season card (league.ts:513-533)

| element | what | states | classes | line |
|---|---|---|---|---|
| Title | h3 "{season name}" + tags "hidden" / "on hold" | Flags | `.lgtag` (10px uppercase pill, style.css:5022) | 519 |
| Stat grid | "{label}" / now · {n} / players · {perWeek} / opponents a week · {weeks} / weeks + a final | none | `.statgrid`, `.statcell`, `.statval.lgphase` (15px, style.css:5024) | 520-525 |
| Dates | "Sign-ups open **{when}**. Week 1 starts **{when}**, the final **{when}**, and the season ends **{when}** (your time)." | The sign-up clause only before sign-up. "?" if a phase is missing | `p`, `.dim` | 526-528 |
| Champion | "🏆 Champion: **{name}**" | When there is a champion | `p` | 529 |
| Hint | "Weeks run Sunday to Saturday. {matchLine} Your opponents are here each week: suggest a time below (or message them on Discord), then both press Play. A match nobody plays by the end of its week counts for neither player." | none | `.hint` | 530-531 |

### 4.2 Entry card (league.ts:535-567)

| state | content | classes | line |
|---|---|---|---|
| Signed out | h3 "Join", "Sign in to join the league.", a primary "Log in / Sign up" (`acct-open-auth`) | `.acctcard` | 536-539 |
| Entered | h3 "You're in"; if sitting out this week: "You are sitting week N out and its pairings are out. Want to play after all? Ask the organizer to put you back in."; if future weeks remain: "Can't play a week? Sit it out before its pairings go out, and nobody is left waiting for you." plus per-week toggles "Week k: playing" / "Week k: sitting out" (`.on`, red) → armed "Press again to sit week k out" (`.danger`). Titles "sit this week out" / "you are sitting this week out — press to play it". Then "Leave the league" → armed "Press again to leave the league" | `.lgskips` (style.css:5025-5026), `button.on`, `button.danger` (red outline) | 541-557 |
| Not entered | h3 "Join"; the problem sentence capitalised with " (below)" appended when it is about the Discord name or hours, or "You are all set. Join, then play anybody free when you are this week. Pairings start with week 1." / "Press the button and your pairings arrive with the next week."; primary "Join {season}" (**disabled** while there is a problem or a request is busy); if withdrawn: "You left this season; joining again keeps the results you already played." | `.primary`, `.hint` | 558-566 |

The **two-press "arming" confirm** (`arming` state, league.ts:99) is used for leave, skip, cancel, advance, delete and repair. It is a pattern of its own, not a dialog, and it has no `aria-live`.

### 4.3 Availability card (league.ts:569-600)

Signed in only. `.acctcard.wide` containing `.lgavail`: a 250px side column and the grid (style.css:5031), stacking at ≤760px.

| element | what | states | classes | line |
|---|---|---|---|---|
| h3 | "When you're usually free" | none | | 574 |
| Intro | "Mark the hours you could usually play: pick quick fills, or drag across the grid. Opponents are matched on the hours you share." | none | `.lgavside > p:first-child` | 576 |
| Discord name | label "Your Discord name" + `#lg-contact` (placeholder "e.g. rashi", maxlength 40). Typing enables Save without a repaint | none | `.lgtzrow` (label stacked, dim 12px; input panel2, style.css:5040-5043) | 577-578 |
| Privacy hint | "Only other league players see it, so they can message you to arrange a game." | none | `.hint` | 579 |
| Time zone | label "Time zone" + `#lg-tz` with a `<datalist>` of every IANA zone; a "use {Europe/London}" button (title "use this device's time zone") | Changing it repaints | `.lgtzrow` | 580-582 |
| Quick fills | Six toggle buttons: "Weeknights 7–11pm", "Every evening 6–11pm", "Weekend days 10am–6pm", "Weekend evenings 6pm–midnight", "Weekday lunch 12–2pm", "Late nights 10pm–2am" | `.on` when all their hours are on. A column in the side panel, a row when narrow | `.lgpresets`, `button.on` (accent) (style.css:5045-5046, 5033-5034) | 583-586, 132-139 |
| Hours count | "{n} hours a week" + " — mark at least {min} to join". Updated live while dragging | Red and bold below the minimum | `#lg-hours`, `.lgwarn` (danger bold, style.css:5053) | 587 |
| Contact warning | "Add your Discord name to join." | Empty contact | `.lgwarn` | 588 |
| Clear | "Clear" | none | button | 589 |
| Save | "Save" / "Saved" | Disabled unless there are unsaved changes and nothing is busy | `.primary` | 590 |
| Grid | 8 columns (50px hour label + 7 days, **Sunday first**) × 25 rows. Day headers "Sun…Sat"; hour labels from Intl ("12 AM", "1 AM"…); 168 cells, each titled "Mon 7 PM". Paint by pointer-drag (`setPointerCapture`) | `.lgcell.on` = accent fill. Max width 820px. `touch-action:none`, so **the grid blocks page scrolling on touch** | `.lggrid`, `.lgday`, `.lghr`, `.lgcell(.on)` (16px tall, style.css:5047-5052) | 592-598, 1033-1076 |

The grid is pointer-only. Cells are `<div>`s with no role, keyboard access or labels.

### 4.4 Your matches (league.ts:619-638) and the time picker (673-720)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Your matches", then one h4 per week: "The final" / "Sign-up week" / "Week k" (newest first) | When the viewer has matches | `.acctcard.wide`, `.accttable.lgmatches` (first column nowrap, style.css:5054) | 622-624 |
| Opponent cell | "vs **{name}**" + line break + "Discord: {contact}" | Contact is optional | `.dim` | 625-626 |
| Play cell | **Play** (primary, `lg-play`); in sign-up week also "Call off" → armed "Press again to call it off" (`.danger`) | Only when playable | `.lgplay` (nowrap, right, style.css:5101-5105) | 627-629 |
| Result cell | "✅ you won" / "you lost" / "double loss" / "not played" (dim) | When decided | | 630-632 |
| Time line | Agreed: "Playing **{when}** ✓" (green bold). Mine: "You suggested **{when}**. Waiting for {opp}." Theirs: "{opp} suggests **{when}**" + **Accept** (primary) | When a time exists | `.lgtime(.agreed/.ask)` (style.css:5108-5114) | 676-680 |
| Suggest toggle | "Suggest a time" / "Suggest another time" | Playable and the form closed | `button[data-btn=lg-time-open]` (style.css:5114) | 682-683 |
| Free line | "you're both free: {Mon 6 Oct, 7:00 PM–9:00 PM} · …" (up to 4) or "no shared hours left this week — suggest a time anyway, or arrange one on Discord" | Hidden while the form is open | `.dim` | 665-670 |
| Time form | Up to 6 chips ("you're both free:" + a button per window start), then "or" + `<input type=datetime-local id=lgt-at step=900 min max>` + "{zone} time" + **Suggest** (primary) + **Cancel** | Only one form open at a time | `.lgtimeform` (panel2 box), `.lgtimechips`, `.lgtimepick` (style.css:5115-5120) | 691-720 |
| Footnote | "Times are in {zone}. Play opens your match room; your opponent joins from their own League page. Nothing is dealt until you are both there, and the elements are drawn at random." | Always says "elements are drawn at random", **even in a constructed season** | `.hint` | 635-636 |

### 4.5 Free when you are (sign-up week, entered) (league.ts:723-738)

| element | what | states | classes | line |
|---|---|---|---|---|
| h3 + intro | "Free when you are" / "Sign-up week has no pairings. Play anybody here instead: up to {cap} games count in the standings (you have {used}), one per opponent. Message them on Discord, then start the game and both press Play." | none | `.acctcard.wide` | 726-728 |
| Row | **{name}** + "Discord: {contact}" / "free together: {windows}" or "no shared hours left this week" / a reason (dim, wraps) or "Start a league game" (`lg-challenge`) | Empty: "Nobody else has joined yet." | `.accttable.lgsuggest` | 729-735 |
| Hint | "Times are in {zone}." | none | `.hint` | 736 |

### 4.6 Standings (league.ts:740-765)

| element | what | states | classes | line |
|---|---|---|---|---|
| Pre-week-1 variant | h3 "Signed up ({n})" + name pills | phase ≤ 0 | `.acctcard.wide`, `.lgbnames` (the banner's class, reused) | 742-746 |
| Table | `#` / player / W–L / pts / OMW (th title "opponents' match-win percentage — the tiebreak") | none | `.accttable` | 757-758 |
| Rows | rank / name, plus a trophy chip when the season is closed ("🏆 Champion" / "🥈 Finalist", without the season name) or " 🏆" while open / "w–l" + " (n)" for unplayed (title "matches not played") / points / OMW% or "–" | A withdrawn player's row is dim (.5) | `.lgpage tr.dim`; `.accttable .badgechip.trophy` (.8em) | 759-762, 751-756 |
| Footnote | "3 points a win. Ties go to opponents' match-win percentage, then head to head." | none | `.hint` | 763 |

### 4.7 Matches (league.ts:767-788)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Matches", h4 per week | Span 2 for players, wide for organizers | `.acctcard.lgspan2` / `.wide` | 771-772 |
| Row | "A vs B" / "**W** won" (+ "(organizer)", + "(fixed)" with a title) / "to play" / "not played" / "double loss" | none | `.accttable` | 773-774, 468-477 |
| Dispute line | "Disputed by **{name}** ({code}): {note}" | Organizer only, when disputed | `.lgdispute` (accent, .85em, defined in the **accounts** CSS block, style.css:1880) | 785-788 |
| Override | `<select>` "set…" / "{A} won" / "{B} won" / "not played" / "double loss" / "reopen" + a "set" button (lowercase) | Organizer only. The select has **no label**, and there is **no confirm** | `.lgorg` (style.css:5055-5056) | 775-778 |

### 4.8 Discord time code (league.ts:832-853)

It is shown to **everyone**, signed out included, on every league page view.

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Discord time code" | none | `.acctcard.lgstamp` (`.lgstamp` has no rule) | 836 |
| Picker | `datetime-local #lg-stamp-at` step 60 + "{zone} time" | Defaults to the next quarter hour, pinned on the first copy | `.lgtimepick` | 837-838 |
| Table | Seven rows (styles t T d D f F R): preview text / a read-only code input `<t:…:X>` / **Copy** | Copy → "Copied <t:…>" in the message bar. Falls back to `execCommand` | `.accttable.lgstamps`, `.lgstampcode` (monospace, 15em, max 42vw, style.css:5121-5122) | 839-843, 858-868 |

### 4.9 Organizer card (league.ts:886-951, 1015-1029)

Shown when the server says `organizer`. It is visible even when there is no season, because that is where a season gets created.

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Organizer" | none | `.acctcard.wide.lgorgcard` | 890 |
| Status line | "{name} (casual constructed/live draft) is at **{label}**. It moves on by itself — **but it is on hold**: next is **{label}** at {when}." / "It moves on only when you press Advance." | auto / hold / manual | `p` | 892-894 |
| Advance | "Advance to {next}" (primary) → "Press again: move to {next} now" (danger) | When there is a next phase | `.primary` / `.danger` | 896-897 |
| Preview | "Preview next pairings" | phase < weeks | button | 898 |
| Hold | "Hold at next boundary" / "Release hold" | none | button | 899 |
| Auto | "Switch to manual" / "Switch to automatic" | none | button | 900 |
| Visibility | "Hide" / "Make public" | none | button | 901 |
| Format | "Make it draft" / "Make it constructed" | Hidden when `formatProblem` is set (the reason is not shown) | button | 902-903 |
| Delete | "Delete" → "Press again to delete this test season" | Hidden seasons only | `.danger` | 904 |
| Repair | "Sitting week k out: **Name** [Put back in] …" + [Pair week k again] + "(new opponents for everybody; post the new pairings)" / "(not now: {reason})" | During weeks 1..n. Disabled while there is a problem. Two-press | `.danger` when armed | 939-951 |
| Add player | input `#lg-addname` (placeholder "player name", **no label**) + "Add player" + "(skips the Discord-name, hours and late-entry checks)" | none | `.dim` | 907-908 |
| Preview table | h4 "Week k would be" + rows "A vs B" / "{n} days shared" / two windows; red when fewer than 2 days are shared. Hint: "{X} has one opponent fewer this week. Rows in red share fewer than two days — they may struggle to meet. The real pairing is made from the players and results at the moment the week starts." | After Preview | `.accttable`, `.lgweak` (style.css:5057) | 1022-1029 |
| Post for Discord | h4 + a read-only `<textarea #lg-post>` (rows ≤ 18) holding `postText()` (emoji 🏅/🏆, markdown, `<t:>` stamps, @mentions) + **Copy** + "Times are Discord timestamps — each reader sees their own." | Text per phase: sign-up / week / final / over (964-1013) | `.lgpost` (monospace, style.css:5123-5124) | 1015-1020 |
| Outbox | h4 "Discord messages" + the last 25 rows: kind / to / when / "⚠ {error}" or "✓ sent" or "waiting" | When there is an outbox | `.accttable.lgout` (no rule) | 911-913 |
| Log | `<details><summary>Log</summary>` + a reversed list "{when} {what}" | When there is a log | `.lglog` (240px scroll, style.css:5061) | 914-915 |
| New season | `<details>` (open when there is no season), summary "New season": a form grid with Id (default `YYYY-MM`), Name (default "November 2026"), Sign-ups open (datetime-local, now), Week 1 starts (next Sun 07:00 UTC, shown in the **browser's local zone**, not the league zone), Weeks (number 1-8, 3), Opponents a week (1-6, 3), Format select ("Live draft (random elements)" / "Casual constructed (any deck, every game)"), checkboxes "automatic (follows the calendar)" (checked) and "hidden (a test season)"; hint "Week boundaries are a whole week apart from week 1's start. Sunday 07:00 UTC (midnight Saturday, US Pacific) is the default."; primary "Create season" | none | `.lgform` (auto-fit 230px, style.css:5058-5060), `.lgorgcard summary` (accent, style.css:5063) | 917-933 |

### 4.10 League notes in the bell (`leaguenotes.ts`)

The bell layer belongs to `inbox.ts` (another reader's). The **sentences** are produced here, by a pure function `noteLine(n, time)` → `{html, action}` (leaguenotes.ts:29-79). The bell wraps each one in `.invitecard.leaguenote(.unread)` (inbox.ts:210-221). Unread notes get a 3px accent left edge (style.css:1328). The button is **Play** (primary) or **League page**.

| kind | sentence | button |
|---|---|---|
| signup | "You're in **{season}**." | League page |
| signups-open | "Sign-ups for **{season}** are open." | League page |
| pairings | "**{season}** week {n}: you play **A**, **B**." (or "nobody") | League page |
| sitting-out | "You sit out week {n} of **{season}**, as you asked." / "No opponent for you in week {n} of **{season}**." | none |
| week-pairings | "**{season}** week {n} is paired." | League page |
| week-closed | "**{season}** week {n} is over." | League page |
| final | "You're in the final of **{season}**, against **{opp}**!" / "The **{season}** final is set." | League page |
| result | "You beat / You lost to **{opp}** (in the final). Your record: {r}." | none |
| challenge | "**{from}** started a sign-up week game with you." | League page |
| waiting | "**{from}** is waiting for you in your **{season}** match." | **Play** |
| season | "**{season}** is over — you are the champion! / — you reached the final. / ." | League page |
| time | "**{from}** suggests playing {at}." | League page |
| time-agreed | "**{from}** accepted: you play {at}." | League page |
| time-reminder | "Your match against **{opp}** starts at {at}." | **Play** |
| dispute | "**{by}** disputed their **{season}** match against **{opp}** ({code}): "{note…120}"" | League page |
| unknown | "News from **{season}**." | League page |

---

## 5. Weekly challenge page (challenge.ts:397-424)

**Reached:** home "🧩 Challenge", the home card "Play", the profile "🧩 Challenge", the run layer's "Challenge page" / "Give up", the tabletop's "Back to the challenge", and the URL `?challenge…`.

**Layout:**
- Shell: `.metapage.chpage`.
- `.accthead`: h1 "Weekly challenge" (**no emoji**, unlike the nav and the league's h1) with a hint; a "Back" button.
- `.acctmsg`.
- "Loading…".
- `.acctbody`: the default auto-fit 300px grid. Cards: Finished runs (wide) · [non-current builder header (wide)] · Builder (wide) · No challenge · This week · Leaderboard (wide when closed) · Past weeks (wide) · [past board].

| element | what | states | classes | line |
|---|---|---|---|---|
| h1 | "Weekly challenge" | none | `.accthead h1` | 407 |
| Subtitle | "Build a deck in order, then reach the goal using as few cards, elements and turns as you can." | none | `.hint` | 408 |
| Back | "Back" (`ch-close`) | none | button | 409 |
| Message | "could not load the challenges" / "could not reach the server" | none | `.acctmsg` (**no CSS**) | 411 |
| Loading | "Loading…" | Before the first load | `.dim` | 412 |
| No challenge | "No challenge this week" / "Check back on Sunday." | Loaded with no current challenge | `.acctcard` | 418 |

### 5.1 Finished runs (challenge.ts:372-387)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Finished runs" | Only when runs are kept in localStorage | `.acctcard.wide.chkept` | 375 |
| Row | **{title}** "5 turns (3 paying debt) · 12 cards (2 extra) · 2 elements" | none | `.chkeptrow` (style.css:5369) | 378 |
| Status | "Submitting…" / error | Per run | `.dim`, `.chproblem` (danger) | 379-380 |
| Submit | "Submit" | Signed in, not sending | button | 382 |
| Sign in | "Sign in to submit" (primary) | Guest or signed out | `.primary` | 383 |
| Drop | "✕" (title "drop this run") | **No confirm**, and the run is lost | button | 384 |

### 5.2 Builder (`challengebuild.ts` `builderHtml`, 200-231; hosted at challenge.ts:415-417)

A header card comes first when the builder is for a **non-current** week: h3 title, `.chgoal`, and, when closed, "This week is closed. A run still goes on its leaderboard."

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Your deck" + "Dealt in this order, 1 on top." | Open after "Build a deck" / "Build" / "Try this deck" | `.acctcard.wide.chbuild` (`.chbuild` has no rule) | cb:209-211 |
| Toolbar | **Build on the table** (primary) · Import a deck (`aria-expanded`) · Clear (only with cards) · undo "{Imported X. / Cleared. / Loaded X's deck.} [Undo]" · "{n} cards · {u} names · {e} extra" | none | `.cbtools` (the card browser's again), `.chundo` (no rule) | cb:212-219 |
| Import picker | A button per saved deck ("{name} {n}") | Open state. Empty: "No saved decks." | `.chimport` (style.css:5372) | cb:220-222 |
| Problem | The engine's verdict, e.g. "Add a card to start." | When illegal | `.chproblem` | cb:223 |
| Turn-1 hand | "Turn 1 hand (you bottom 2)" + card pills (`data-prev`, which hovers a preview) | Legal decks only | `.chhand`, `.chhandcard` (style.css:5373-5374) | cb:224-225 |
| List | `<ol>`: position ("1", or "3–4" for a run) + name (`data-prev`). Read-only | With cards. Max height 60vh, scrolls | `.chlist`, `.chrow`, `.chpos`, `.chname` (style.css:5375-5378) | cb:205-208, 226 |
| Play | "Play" (`.cta.primary`, right-aligned) | Disabled while there is a problem | `.chplayrow .cta` (style.css:5379-5381) | cb:227-229 |

### 5.3 This week card (challenge.ts:296-308)

| element | what | states | classes | line |
|---|---|---|---|---|
| Title | h3 "{c.title}" | none | `.acctcard.chweek` (no rule) | 297-298 |
| Goal | "{goalText}" (15px bold) | none | `.chgoal` (style.css:5357) | 299 |
| Setup lines | One `p` per engine setup line | none | `.chsetup` (no rule) | 300 |
| Blurb | Free text | Optional | `p` | 301 |
| Meta | "{3d 4h left} · {n} entrants" | none | `.dim` | 302 |
| Rules | "Three first places: fewest turns, fewest cards, fewest elements." + `DEBT_RULE`: "Debt you still owe when you meet the goal adds the turns it would take to pay off: your open resources pay first, then each later turn pays with 2 more resources than the one before." | none | `.dim` | 303-304, 331-332 |
| Your best | h4 "Your best" + a table: Fastest / **#rank** / score line, for all four boards | Signed in with runs | `.accttable.chmine` | 289-294 |
| Build | "Build a deck" (primary) | Hidden while this week's builder is open | `.primary` | 306 |

### 5.4 Leaderboard (challenge.ts:335-359)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Leaderboard", or on a past board "{title} · week of {week}" | Wide when closed (an extra column) | `.acctcard.chboardcard` (`overflow-x:auto`, style.css:5360) | 357-358 |
| Loading / error / empty | "Loading…" / "Could not load the leaderboard." / "No runs yet." | Per state (the best-covered loading/error/empty set in this area) | `.dim` | 338-340 |
| Winners | "Winners · Fastest: **X** · Leanest: **Y** · Purest: **Z**" + "played on older rules" flags | Closed weeks | `.chwinners` | 322-326 |
| Tabs | Fastest / Leanest / Purest / Overall. Each has a **`title` tooltip** with its tie rule (BOARD_TIP) | `role="tablist"` / `role="tab"` / `aria-selected`: the **only ARIA tablist in this area**. `.on` | `.chtabs`, `button.on` (style.css:5361-5362) | 347-348 |
| Tab tip | The same tie-rule sentence, repeated under the tabs: "Fewest turns. Ties go to fewer cards, then fewer elements." … "All three at once, with turns counting most: turns² × cards × √elements. No trophy." | none | `.chtabtip` | 349 |
| Table head | `#` / player / Turns (title TURNS_TIP) / Cards (title "Each card used counts once, and every copy past the second counts as one more.") / Elements / [blank, closed only] | The sort column is accent | `.accttable.chboard`, `th.chsorted` (style.css:5364) | 350-351 |
| Row | rank / name + "played on older rules" (dim, title OLDER_TIP) / turns (bold if sorted) + "(+n debt)" with a debt tooltip / cards + "(n extra)" / elements / [Try this deck] (title "load this deck into the builder") [Watch] | Closed weeks get buttons | `.chold`, `.chrowbtns` (style.css:5366-5367) | 352-355 |

### 5.5 Past weeks (challenge.ts:361-370)

| element | what | states | classes | line |
|---|---|---|---|---|
| Card | h3 "Past weeks" | When past weeks exist | `.acctcard.wide` | 363 |
| Row | week / **{title}** goal (dim) / "{n} entrants" / [Leaderboard] (`.on` when open) [Build] | none | `.accttable.chpast`, `.chpast button.on` (style.css:5359) | 364-368 |
| Unfolded board | `boardHtml(c, true)` appended **after** the card, not inside it | none | | 369 |

### 5.6 The tabletop host for a challenge (challenge.ts:536-582) and the deck strip (deckstrip.ts:64-91)

The tabletop page (`tabletop.ts`) is another reader's area. The challenge supplies:
- `title` = the challenge title; `backLabel` = "Back to the challenge"
- `strip()` = `deckStripHtml(title, summary, { lead: 'Challenge' })`, the card browser's deck bar, plus "{goal} · Cards on the table are not in the deck. The table is saved in this browser only." (`.ttchnote.dim`, hidden ≤900px, style.css:2948, 2979)
- `below()` = `challengeStripHtml`

| element | what | states | classes | line |
|---|---|---|---|---|
| Strip section | The deck under the table, left to right = top to bottom | none | `.ttdeck` (bg **#141f1b** hard-coded) | ds:76 |
| Head | "**Your deck**" + "dealt left to right, 1 on top · {n} cards" + problem + **Play** (`ch-play`) | Play is disabled while there is a problem | `.ttdeckhead`, `.dim` (**unstyled here**), `.chproblem`, `.cta.primary.ttplay` (style.css:2950-2953) | ds:77-81 |
| Hand bracket | A bracket over the first N cards: "Turn 1 hand · you bottom 2", title "the cards you start with, as the game deals them" | Without a hand: `.ttnohand` (transparent) | `.ttbracket` (inline `style="width:…"`) | ds:73-75 |
| Cards | Absolutely positioned scans (inline `style="--k;left;top"`) with `data-zoom`, draggable | `.ttfront`, `.ttpicked` | `.ttcard`, `.ttfan` | ds:68-70, 85 |
| Position numbers | "1 2 3 …" under the cards | none | `.ttstripnums` | ds:71, 86 |
| Empty | "Drag cards here from the binder or the table." | 0 cards | `.dim.ttstripempty` | ds:87 |

Breakpoints: ≤900px tighter padding; the bell and report buttons move at 1366 and 900 (style.css:2970-2982).

### 5.7 The challenge run (game board): meter and end dialogs (challengerun.ts)

**Reached:** Play in the builder or the strip calls `freshRun` and goes to `?challenge=play&id=`. That boots a SoloServer board (main.ts:12572-12583). A stale link without a saved run bounces back to `?challenge`.

| element | what | states | classes | line |
|---|---|---|---|---|
| Meter | A row in the board's `.stickytop` (main.ts:7937), `role="status"`: "{Kill units} 2 / 5 · turn 3 · debt 4 (+2 turns) · cards 9" | Debt part only when there is debt | `.chmeter` (panel, **accent** border), `.chmetertext` (tabular, bold) (style.css:5384-5387) | 299-306, 184-191 |
| ↺ Turn | "↺ Turn" (title "back to the start of this turn") | none | `.chmeter button` (12px) | 302 |
| Retry | "Retry" | **No confirm** (the run is restarted) | | 303 |
| Give up | "Give up". Clears the run and goes to the page | **No confirm**, destructive | | 304 |
| Room tooltip | The toolbar status shows "🧩 {title}" | none | (main.ts:7407) | |
| Goal met dialog | Scrim + box `role="dialog" aria-label="Goal met"`: h3 "Goal met"; score grid Turns / Cards / [Extra copies] / Elements; "Met on turn N, plus k turns to pay off D debt."; submit status; buttons **Export run** · **Retry** · **Challenge page** (primary) | Submit status: guest → "Sign in to put this run on the leaderboard. It is kept here until you do." + **Sign in** (primary); sending → "Submitting…"; error → `.chproblem` + **Try again**; done → "New best: fastest, leanest. #1 fastest · #3 leanest · #2 purest · #2 overall." / "On the leaderboard. No new best." | `.chscrim` (fixed, z 77, rgba scrim), `.chbox` (460px, accent border), `.chscore` (`.statgrid` reused), `.chdebt`, `.chboxbtns` (style.css:5388-5395) | 308-321, 267-294 |
| Run failed dialog | `role="dialog" aria-label="Run failed"`: h3 "Run failed"; the reason ("You lost before the goal was met." / "The dummy died before the goal was met." / the goal's own rule); **↺ Rewind this turn** · **Retry** (primary) · **Challenge page** | none | same | 322-331 |

The dialogs have no focus management, no `aria-modal` and no Escape. Their primary button sits in a **different position** in each: on Goal met "Challenge page" is primary, on Run failed "Retry" is.

### 5.8 Watch a run (main.ts:12584-12618)

`?challenge=watch&run=` loads the BL-38 replay viewer (another reader's `replaybar.ts`), titled with the challenge title, and exits to `?challenge=1&board=<id>`. On failure, `uiError` is set to "that run cannot be watched" and the page re-renders. There is no page-specific UI beyond that.

---

## 6. Admin dashboard (admin.ts:432-464)

**Reached:**
- the profile's "🛠 Admin" (`nav-admin`), only when `me.admin`
- the URL `?admin=1`

The header comment (admin.ts:9-13) still says "There is no link to it anywhere in the client". That is **stale**.

**Layout:**
- `paint()` **replaces `#app`'s whole className** with `admin` (admin.ts:435). Other pages only remove `board`.
- `.adminpage` shell: max **1400px**, padding `1rem` (style.css:3482).
- `.adminhead`: h1, "signed in as X", refresh, close.
- `.admintabs`.
- `.adminmsg`.
- Body: an `.adminnote` paragraph, then a table in `.admintablewrap` (overflow-x auto).

### 6.1 Shell and refused state

| element | what | states | classes | line |
|---|---|---|---|---|
| Refused page | h1 "Admin" + "close" + "This account is not an admin on this server, or you are not signed in. Nothing else on this page is available." | Any non-200 from **any** admin route. A 500 or a network blip reads as "not an admin" | `.adminpage`, `.adminhead`, `.adminnote` | 436-441 |
| h1 | "Admin" (no emoji; the profile button has 🛠) | none | `.adminhead h1` | 455 |
| Who | "signed in as {name}" | After the overview loads | `.adminwho` (dim .85em, pushes the buttons right) | 456 |
| refresh | "refresh" (lowercase) | none | button | 457 |
| close | "close" (lowercase; every other page says "Back") | none | button | 458 |
| Tabs | Reports · Accounts · Games · Live rooms · Challenges | `.on` = **filled accent background**, a third tab look | `.admintabs`, `.admintab.on` (style.css:3485-3486) | 443-447 |
| Message | Network errors; `setadmin` refusal text | none | `.adminmsg`: `var(--bad, #e66)`, and **`--bad` is not defined** in `:root` | 461 |
| Loading | "loading…" replaces the body while the tabs stay | On every tab switch and every action (**the whole table blanks after each 👍 click**) | `.adminnote` | 448 |

### 6.2 Reports tab (admin.ts:270-301), the default tab

| element | what | states | classes | line |
|---|---|---|---|---|
| Summary | "{total} report(s) · {n} unjudged · 👍 {real} · 👎 {not} · {live} still open on the ledger · {n} marked * are not in the committed snapshot yet, so they can have no status until `npm run reports` runs." | Unfetched clause conditional. Uses "(s)" plurals | `.adminnote`, `i.unk`, `code` | 291-292 |
| Filter | Checkbox "unjudged only" (`data-btn` on the `<input>`) | none | `.adminnote label` | 293 |
| Read-only note | "**Status is read-only** and comes from the ledger in the build this server is running — …" | none | | 294-296 |
| Columns | # / when / where / who / kind / report / status / real? | none | `.admintable` (th dim 600, nowrap) | 298-299 |
| # | "#{id}" + "*" (title "not in the committed snapshot yet — run npm run reports" / "ledger #N") | none | `td.num`, `i.unk` | 274 |
| when | "2026-11-01 20:33" (UTC slice) | none | | 275 |
| where | room code, or *page* italic | none | | 276 |
| who | name, or *signed out* | Badge chips not shown | | 277 |
| kind | "{kind}/{severity}" | none | | 278 |
| report | Note text (pre-wrap, min 22rem) | none | `.notecell` | 279 |
| status | "untriaged" (title "no ledger entry yet") / "{status}" / "agreed fix", with the guards list as the title | `.stchip.none/.fixed/.live/.partial/.agreed-fix` (style.css:3505-3510) | 261-268 |
| real? | 👍 (title "real, worth doing") · 👎 (title "not a bug / won't do") · ✕ (title "clear — set by {who}") | `.on` = filled accent. Clicking the active one clears it, **and** a ✕ is also shown, contradicting the code comment at 488-489 | `.adminacts button(.on)` | 281-288 |
| Row dim | A whole row at .45 opacity when marked 👎 | none | `tr.dim` | 273 |
| Empty | "no reports" | none | `td colspan=8` | 300 |

### 6.3 Accounts tab (admin.ts:234-259)

| element | what | states | classes | line |
|---|---|---|---|---|
| Note | "{n} account(s) · {n} admin(s). A judge badge and the admin flag are independent — a judge is a trusted voice on rules, an admin can change other people's accounts. The last admin cannot be revoked." | none | `.adminnote` | 252-254 |
| Columns | account / games / wins / joined / last played / discord / actions | none | | 256-257 |
| account | **name** + chips "owner" (lowercase in markup; a **duplicate** of account.ts `badgeChipsHtml` without its titles) / "Judge L2" / "admin" (red) | none | `.badgechip.owner/.judge/.admin` (`.admin` uses the undefined `--bad`) | 226-232, 237 |
| actions | none · L1 · L2 · L3 (the **current level is not marked**) · "make admin" / "revoke admin" | **No confirm** for admin grant or revoke | `.adminacts` | 243-250 |
| Empty | "no accounts yet" | none | | 258 |

### 6.4 Games tab (admin.ts:303-348)

| element | what | states | classes | line |
|---|---|---|---|---|
| Note | "{n} game(s) in the history." + "A name marked * is the one recorded …" + "{n} were played before the match timer existed … shown as "—" rather than as 0 …" | Conditional clauses | `.adminnote` | 340-343 |
| Columns | code / played / mode / elements / players / result / turns / length | none | | 345-346 |
| code | "▶ {code}" link → `?replay=`, title "watch this game back — both hands, since you did not play it" | none | `.replaylink` | 326-327 |
| mode | The raw `g.mode` (**not** `modeName()`, so "shared" shows here and "sandbox" on the profile) + chips "custom" / "rated" / "fixed" (title) / "disputed" (title) | none | `.stchip` | 329 |
| elements | "fire+water vs earth" (joined text, not the coloured pills the profile uses) | none | | 330-332 |
| players | "A vs B" + "*" (title "not a current account — the name recorded at the time") | none | `i.unk` | 310-312, 333 |
| result | *unfinished* / "a draw" / "{name} won" + "diverged" chip | none | `.stchip.none` | 322-324, 334 |
| turns / length | number / "{m}m" or "—" | none | `td.num` | 335-336 |

### 6.5 Live rooms tab (admin.ts:350-373)

| element | what | states | classes | line |
|---|---|---|---|---|
| Note | "{n} room(s) in memory. A finished game stays here until it is dropped, … This page never touches a live game." | none | `.adminnote` | 365-368 |
| Columns | room / mode / seats / at / actions / live / watching | none | | 370-371 |
| seats | "Name (guest) ●" × 2. The dot is green or grey, titled "connected" / "not connected" | none | `.dot.on/.off` (rem-sized, rgba, style.css:3515-3517). A **third online-dot implementation** after `.fdot` and the inbox `.fdot.busy` | 352-354 |
| at | "over" / "turn N · {phase}" | none | | 359 |
| Room code | Plain text, **not** a link (Games rows are links) | none | | 356 |

### 6.6 Challenges tab (admin.ts:375-430)

| element | what | states | classes | line |
|---|---|---|---|---|
| Note | "The calendar is empty." / "**The calendar has run out** — its last week closed {utc}. New challenges must be written." / "**The calendar runs out {utc}** — {n} weeks from now ({n} upcoming rows). Add rows to `CHALLENGES` in server/challenges.ts before then." + three explanatory sentences | none | `.adminnote` | 418-425 |
| No data | "no calendar" | none | | 406 |
| Columns | status / challenge / goal / opens / closes / seed / par / reference run / board | none | | 427-428 |
| status | "open now" (green chip) / "closed" (grey) / "upcoming" (blue) + "opens in N days / 1 day / under a day" | Closed rows are dim | `.stchip.chopen/.chsoon/.none`, `.unk` (style.css:3512-3513) | 386-391 |
| challenge | **title** + id (dim) | none | `.unk` used as a **dim-text utility**, not for "unknown" | 410 |
| goal | **goal** + setup lines + blurb | none | `.notecell` | 411 |
| opens / closes | "Sun 25 Oct 2026 07:00 UTC" ×2 | none | | 412 |
| reference run | *being walked — refresh in a moment* / "no reference run file" (red chip) / "no longer verifies" (red chip, error as the title) + error + "(action N)" / "N turns (+d debt) · N cards · N elements · raw R · Skill S" | Per state. **"Skill" is shown here although players no longer see it** | `.stchip.live` | 394-403 |
| board | "{n} runs / {n} players" or "—" | none | `td.num` | 416 |

---

## 7. Shared building blocks (component candidates)

| block | what it is | used by (my area) | also used elsewhere | notes |
|---|---|---|---|---|
| **Page shell** | A centred max-width container | `.acctpage` (1100 / 12px), `.metapage` (1100 / 10 18 32) for league and challenge, `.adminpage` (1400 / 1rem), `.joinscreen` (420 card) for auth | `.homepage`, `.deckpage`, `.cbpage`, `.metadeck` | **Four shells** in this area, with different paddings and units. The CSS admits it: "Every page … brings its own" (style.css:3276) |
| **Page header** | h1 + subtitle hint + right-hand button cluster | `.accthead`/`.accthbtns`: profile, league, challenge; `.adminhead`: admin; `.homelogo` + h2: auth | the meta page probably uses `.accthead` too | Admin reinvents it. The h1 sometimes has an emoji (🏅 League) and sometimes not (Weekly challenge, Admin) |
| **Back / close** | Leave the page | "Return to Lobby" (primary, profile), "Back" (auth, league, challenge), "close" (admin), "Back to the challenge" (tabletop), "Challenge page" (run) | | Five labels for one action |
| **Card / panel** | Bordered panel with an uppercase accent h3 | `.acctcard` (+ `.wide`, `.lgspan2`) everywhere except admin; `.homecard` (home); `.lgbanner`; `.chbox` | `.lobbypanel`, `.invitecard` | The cards are a mix of `<section>` and `<div>` |
| **Card grid** | Auto-fit columns | `.acctbody` (300px auto-fit) vs `.lgpage .acctbody` (fixed 3 columns) vs `.lgbbody` (240px) vs `.achgrid` (260px) vs `.statgrid` (88px) | `.homegrid` (302px) | Six grid recipes |
| **Stat cell** | Big number over a small uppercase label | `stat()` account.ts:493; the league season card **hand-writes** the same markup (league.ts:521-524); `statCell()` challengerun.ts:263 is a third copy ("account.ts's `.statcell`") | | Three implementations of one component. A fourth variant, `.stat` (Connections), has no CSS |
| **Tabs** | A segmented control that switches the view | `.accttab` (profile), `.elchip` (ladder mode), `.cbtools button.on` (league season, not styled), `.chtabs` (challenge board, ARIA), `.admintab` (admin, filled) | `.elchip` is the draft-trio picker | **Five tab looks**, one with ARIA |
| **Data table** | A compact table | `.accttable` (profile, league, challenge; uppercase 10px th), `.admintable` (admin; normal-case 600 th, rem, rgba lines), `.lgbtable` (banner, headerless) | | Three table styles. Only `.admintablewrap` handles horizontal overflow (plus `.chboardcard`) |
| **Chip / pill** | Small rounded label | `.badgechip` (owner/judge/trophy/admin), `.constag` (history tags), `.stchip` (admin status), `.lgtag` (hidden/on hold), `.acctel` (element pill), `.lgbnames span`, `.lgbdates li`, `.chhandcard`, `.youstanding` | | **Nine chip recipes**, each with its own padding, radius, size and case |
| **Online dot** | Presence indicator | `.fdot(.on)` (friends, ladder, everyone), `.dot.on/.off` (admin) | `.fdot.busy` (inbox) | Two implementations |
| **Inline message** | The outcome of an action | `.deckmsg` (gold: auth, friends, password errors), `.hint` (password success), `.acctmsg` (league, challenge; **unstyled**), `.adminmsg` (red, undefined var), `.chproblem` (red), `.lgwarn` (red bold), `.pgclaimerr` | toasts (another reader) | Seven ways to report a result. Success and error rarely differ |
| **Hint text** | Secondary prose | `.hint`, `.dim`, `.adminnote`, `.unk`, `.cardsub`, `.accthint`, `.lgbnext` | | `.hint` and `.dim` have **no global rule**: they are dim only inside certain parents |
| **Two-press confirm** | "Press again to …" arming | league only (leave, skip, call off, advance, delete, repair) | | Not used for logout, admin grant/revoke, give up, drop run, remove friend or result override |
| **Dialog** | Scrim + box | `.chscrim` / `.chbox` (run end) | `.overlay` (style.css:889, the game's) and the report form | The challenge reinvents the overlay |
| **CTA button** | Big primary | `.cta.primary` with four contextual definitions (`.homecard`, `.lgbhead`, `.chplayrow`, `.ttdeckhead .ttplay`) and **no base `.cta` rule**; `button.primary` is green with a green border; `.homebtns .primary` is accent | | Two looks for "primary": green fill vs accent outline-on-green |
| **Link button** | A text-looking button | `.linkbtn` (banner steps) | Single Card Duel CSS block (style.css:3718) | Defined inside an unrelated section |
| **Element icon / pill** | `.acctel.icon` (img), `.acctel.{el}` (word pill), `.favel` (radio), `.elbarseg` | profile, ladder, friends, history | `.elchip` (home) | Four element representations |
| **Date / time formatting** | `shortDate` (account.ts:425), `day` / `when` / `windowText` (league, Intl in the league zone), `day` / `when` (admin, ISO slices in UTC), `utc()` (admin), `timeLeft` (challenge) | | | Five formatters, three zones (locale, league zone, UTC) |
| **Two "player" tables** | Friends' "Everyone here" (all-time wins) vs Ladder (rating) | | | Both fetch `/api/players` |

---

## 8. Design smells (concrete, with file:line)

### 8.1 Missing or broken styling
1. **`.hint` and `.dim` have no global colour.** `.hint` is dim only under `.joinscreen` / `.accthead` (style.css:355, 1815). `.dim` is coloured only under `.lgpage`, `.lgbbody`, `.chpage` and `.lobbyseat` (5020, 5082, 5356, 1970). So every `.hint` inside a profile `.acctcard` renders in full text colour (account.ts:605, 613, 624, 627, 828, 857, 945…), and the decks tab's `.dim` record (account.ts:460-461), the tabletop strip's "dealt left to right" (deckstrip.ts:78) and the banner head's `pairingText` dims (league.ts:274) are not dimmed.
2. **`.acctmsg` has no CSS** (league.ts:491, challenge.ts:411). Action results and errors on two pages are bare text.
3. **`.stat`, `.btn` and `.linkcode` have no CSS** (account.ts:550-564). The Discord card has an unstyled stat and an unstyled link code next to styled `.statcell`s.
4. **`--bad` is used but never defined** (style.css:3489, 3502), so it survives only through the `#e66` fallback.
5. **The league season switcher has no selected state.** `.cbtools button.on` is not styled (league.ts:492-493).
6. **`.badgechip.trophy.participant` has no rule** (style.css:937-939). The 🏅 participant chip falls back to the accent outline.
7. **No base `.cta` rule.** It is defined four times by context. The banner's "Sign up" `.cta.primary` gets the green look while every other CTA gets accent-on-green (style.css:467-468, 5072, 5380-5381, 2952-2953).
8. One-off classes with no rule that only add noise: `.home` (account.ts:389), `.chhome`, `.chweek`, `.chbuild`, `.chsetup`, `.chundo`, `.lgstamp`, `.lgout`.

### 8.2 Hard-coded colours, units and placement
9. Literal colours outside the tokens: `#e0a93c` and `#b8c2cc` trophies (style.css:938-939); `#3c5a2f` / `#5b8747` primary (53); `#3b4654` (464); `#3a444f` (1914); `#141f1b` (2949, 2959); `#f0c983` (3995); admin's `rgba(80,200,120,.25)`, `rgba(110,160,255,.25)` and `rgba(230,120,80,.3)` (3506-3513); `.pgclaim` rgba whites (3472-3476).
10. **Mixed units.** The admin and `.pgclaim` blocks use rem/em; everything else uses px.
11. `.lgdispute` (a league class) is defined in the **accounts** CSS block (style.css:1880). `.linkbtn` lives in the Single Card Duel block (3718). `.homedecks` is the "My decks" button class reused for the League and Challenge nav buttons (league.ts:195, challenge.ts:269), and its only rule sits in the deck-collection block (2570).
12. Inline styles: `style="flex:{w}"` (account.ts:473) and `style="width:{pct}%"` (account.ts:718) are data-driven and acceptable. The inline `onerror="this.style.visibility='hidden'"` handler (account.ts:452) is a smell. The deckstrip positions (deckstrip.ts:69-86) are data-driven.

### 8.3 Emoji as icons
13. 🏅 League / 🧩 Challenge / 🛠 Admin / 📜 Rules review (account.ts:517-520); ↻ refresh with no label (521); 🔥 streak (374); 🏆 🥈 🏅 trophies (145-149); ✕ remove (770, challenge.ts:384, admin.ts:287); ▶ replay (933); ✅ won (league.ts:333, 631); 🔒 hidden season (493); ⚠ / ✓ outbox (913); 👍 👎 triage (admin.ts:283-285); ▾ ▸ carets (league.ts:241, 254); ↺ Turn (challengerun.ts:302); achievement icons are server-sent emoji. **🏅 means both "League" and "Participant"**, and 🏆 means both "Champion" and the home "Metagame" button.

### 8.4 Inconsistent copy, labels and case
14. Back actions: "Return to Lobby" (primary, account.ts:523) / "Back" / "close" (admin.ts:438, 458) / "Back to the challenge" / "Challenge page". And "refresh" (admin) vs "↻" (profile).
15. Case: admin buttons are lowercase ("refresh", "close", "none", "make admin", "set"; league.ts:778 "set"); history's result reads "WIN" vs "loss" (account.ts:925); profile tab labels are lowercase in markup and uppercased by CSS; admin table headers are lowercase and **not** uppercased, while `.accttable th` are. Errors are lowercase with no full stop ("could not reach the server"); successes are sentence case with one ("Saved.").
16. Spelling: "favorite element" in the bar's tooltip (account.ts:353) vs "Favourite element" on the profile (628).
17. "badges" column = the achievement count (account.ts:835) while "badge" elsewhere means the Owner/Judge trust mark.
18. Mode names: the profile uses `modeName()` ("sandbox", "live draft"); admin prints the raw `g.mode` ("shared", "draft") (admin.ts:329).
19. The home bar button says "Log in / Sign up" but opens **Create an account** (account.ts:365, 1027).
20. The challenge home card's **Play** opens the page and does not start a run (challenge.ts:283, 451).
21. The league footnote says "the elements are drawn at random" even for constructed seasons (league.ts:636).
22. Username maxlength: 20 on sign-up, 40 on guest claim (postgame.ts:216), 40 for the league Discord name.

### 8.5 Missing loading, empty and error states; feedback
23. **The Discord link error is invisible**: it is written to `authMsg`, which only the auth screen renders (account.ts:1130).
24. A ladder fetch error shows the "nobody has played 5 rated games yet" empty state (account.ts:1004, 810). A friends "Everyone here" fetch error shows an empty table (1013).
25. `refreshMe` fails silently (account.ts:325-327). The "↻" button gives no feedback.
26. Admin treats any non-200 (a 500, a proxy error) as "not an admin" (admin.ts:133, 144). Every action blanks the whole table to "loading…" (admin.ts:150, 448).
27. The league page shows "Loading…" only on first load. Reloads after actions show nothing, and `busy` disables only Join and Save.
28. The league `msg` never clears and looks the same for success and failure.
29. The Discord link code has no countdown and does not expire on screen (account.ts:556-563).
30. The favourite picker posts with no busy state (account.ts:1062-1065). Admin judge buttons don't mark the current level (admin.ts:244-247).
31. No confirm on: Log out (account.ts:522), remove friend ✕ (770), make/revoke admin (admin.ts:248), result override (league.ts:778), Give up (challengerun.ts:304, 346), drop a kept run ✕ (challenge.ts:384). Meanwhile the league uses two-press arming for its own destructive actions.
32. The admin ✕ "clear" button duplicates the toggle-off behaviour that the comment at admin.ts:488-489 says makes a ✕ unnecessary.
33. The history empty state has no h3, unlike every other tab (account.ts:938).

### 8.6 Accessibility
34. The profile tabs, ladder mode, league season switcher and admin tabs have no tab roles or `aria-selected` / `aria-pressed`. Only `.chtabs` has them (challenge.ts:347-348).
35. **The availability grid is pointer-only** (`div` cells, no role, tabindex or keys; league.ts:592-598, 1065-1075). `touch-action:none` (style.css:5048) means a finger on the grid cannot scroll the page.
36. Unlabelled inputs: `#a-friend` (account.ts:846), `#lg-addname` (league.ts:907), the override `<select>` (775), and the post-game claim inputs (placeholder-only).
37. Message areas (`.acctmsg`, `.deckmsg`, `.adminmsg`) have no `role="status"` / `aria-live`. The two-press arming changes the label with no announcement.
38. Online status is colour-only. The ladder rows' `.fdot` has **no title at all** (account.ts:798, 837).
39. The run dialogs have `role="dialog"` but no `aria-modal`, focus move or trap, or Escape (challengerun.ts:311, 323).
40. Heading levels jump: the profile h1 → the card h3 (no h2); the achievement group h4 sits inside the h3 card.
41. Touch targets: the base button is about 28px tall (5px 12px at 13px). `html.touch` enlarges only game controls (style.css:4021-4022), never these pages. The `.lgcell` cells are 16px tall, the friend row buttons 3px 8px at 11px, the admin buttons `.15rem .4rem`.
42. The achievement icon is inserted **unescaped** (account.ts:712). `elChip` puts the server's element string into a class and URL unescaped (353). Both are server-trusted, but they are XSS-shaped.

### 8.7 Layout and responsive behaviour
43. The **history table (8 columns) has no overflow wrapper**, so it pushes the page sideways on a phone (account.ts:941). The same goes for the league's matches, suggestions and stamps tables. Only admin (`.admintablewrap`) and the challenge board (`.chboardcard`) handle it.
44. The profile header holds up to 7 buttons in `.accthbtns`, which wraps into a block on narrow screens (account.ts:516-524). There is no overflow menu.
45. The league uses a fixed 3-column grid (style.css:5028) between 760px and 1100px, which gives cramped ~330px columns. The banner defaults to folded under 700px, but only at module load (league.ts:120).
46. The admin page overwrites `#app.className` (admin.ts:435), whereas every other page toggles a single class.
47. The account screen has **no URL**: a reload on the profile drops to home, and a tab cannot be deep-linked. League, challenge and admin all sync the URL.

### 8.8 Stale or contradictory comments, and duplication
48. admin.ts:9-13 says there is no link to the page; the profile has one (account.ts:519).
49. `badgeChips` (admin.ts:226-232) duplicates `badgeChipsHtml` (account.ts:131-137) with different case and no titles.
50. The stat cell is implemented three times (account.ts:493, league.ts:521-524, challengerun.ts:263).
51. The unresolved-games count is said three times on the Stats tab (header 512-513, stat cell 601, hint 616-617).

---

## 9. Storybook isolatability

**General wiring.** Every page uses the same contract: `initX({ app, rerender })` + `screen()` + `renderScreen()` + `handleButton(btn)`, with all state in module-level `let`s.
- Renderers write `$app.innerHTML` directly. They do not return strings, except for the home fragments and a few exported helpers.
- Events are delegated by `data-btn` from **main.ts's** document listener (main.ts:10416 → 11197). A story that wants clicks needs a tiny delegator that calls `mod.handleButton(btn)`.
- Some inputs are wired directly after the paint: account keydown (account.ts:414-418), league `wireGrid` / `wireStamp` (league.ts:1033-1076, 846-853), and the challenge layer's own capture listener on `data-chal` (challengerun.ts:361-367).

| module / function | pure? | reads | what a story must stub or refactor |
|---|---|---|---|
| `account.ts` `badgeChipsHtml`, `trophyChipHtml`, `trophyChipsHtml`, `concessionTag`, `fixedTag`, `disputedTag`, `customTag`, `gameElementsHtml`, `historyRowsHtml`, `modeName`, `signupNoteHtml` | **Yes**, exported | args only (`esc`) | Ready for stories as they are |
| `account.ts` `barHtml()` | No | module `me`; `ICON_BASE` (assets.ts) | Refactor to `barHtml(me)`, or expose a `setMe()` test seam (`applyMe(next)` exists, account.ts:338, and **is** a usable seam since it repaints only through `rerenderHost`) |
| `account.ts` `renderAuth`, `renderProfile`, `statsTab`, `achievementsTab`, `ladderTab`, `friendsTab`, `decksTab`, `historyTab`, `connectionsHtml`, `passwordHtml`, `favoritePickerHtml`, `achievementCard`, `friendRow`, `elementBarHtml`, `stat` | No: module-private | `me`, `tab`, `authMode`, `authMsg`, `busy`, `ladder`, `ladderMode`, `leaders`, `discordLinking`, `linkCode`, `pwMsg`, `friendMsg`; `localStorage` (token); `artFor` (meta.ts) for covers; `ALL_ELEMENTS` (engine) | Export them as `(viewModel) => string`. `renderAuth` also **focuses an input and binds listeners inside the render**, which must be split out. `renderProfile` must stop calling `$app!.innerHTML`. Fixtures: a full `Me` (Profile has about 30 numeric fields), `AchievementState[]`, `FriendView[]`, `MatchRow[]`, `LeaderRow[]`, `PublicDeck[]` |
| `league.ts` `homeBannerHtml()`, `navButtonHtml()` | No | `hint`, `hintOrganizer`, `bannerOpen` (**localStorage + innerWidth read at module load**), `howOpen`; `Date.now()` / Intl zone via `viewTz()`; **calls `askHint()`, which fetches during render** | Split `askHint` out of render. Inject `now` and `tz`. Pass `LeagueState` in. The inner pieces (`otherHtml`, `nextText`, `howHtml`, `joinStepsHtml`, `mineHtml`, `tableHtml`, `pairingText`) are almost pure apart from the `fmt` zone and `howOpen` |
| `league.ts` `paint()` + `seasonCardHtml`, `entryCardHtml`, `availabilityCardHtml`, `myMatchesHtml`, `timeHtml`, `timeFormHtml`, `freeLineHtml`, `suggestionsHtml`, `standingsHtml`, `allMatchesHtml`, `stampHtml`, `organizerHtml`, `repairHtml`, `previewHtml`, `postHtml` | No: private | `data`, `draft`, `dirty`, `preview`, `arming`, `busy`, `timeOpen`, `msg`, `loading`, `stampAt`; **`Date.now()` in at least 6 places**; `location.origin` (postHtml); `Intl.supportedValuesOf` (zones) | Most take `s: SeasonView` already, so exporting them and passing `{data, ui}` is a modest refactor. Needs a fixed clock and zone. The grid needs `wireGrid()` after mounting for drag stories. Fixtures: a `SeasonView` per phase (pre-signup, sign-up week, week k, final, closed), each in organizer and player views |
| `league.ts` `postText`, `stampPreview`, `discordCode` | **Yes**, exported (`now` / `origin` / `tz` injected) | args | Ready |
| `leaguenotes.ts` `noteLine(n, time)` | **Yes**, exported, clock injected | args | Ideal. Wrap in the inbox `.invitecard.leaguenote` markup for a visual story |
| `challenge.ts` `homeCardHtml()`, `navButtonHtml()` | No | `hint`, `skew`; **`askHint()` fetches during render** | Same fix as league |
| `challenge.ts` `paint()` + `weekCardHtml`, `boardHtml`, `pastHtml`, `keptHtml`, `bestHtml`, `winnersHtml` | No: private | `data`, `boards` Map, `tab`, `pastOpen`, `building`, `list`, `importing`, `undo`, `sending`; `doneRuns()` (**localStorage**); `canSubmit()` (**token + `acct.isGuest()`**); `dk.playableDecks()`; `chosenDeck()` (localStorage); `timeLeft` uses `Date.now()+skew`; `tt.screen()` guard | Export them with explicit inputs. `timeLeft(closes, now)` is already exported with `now` injectable. Engine imports `goalText` / `setupLines` (pure). Fixtures: `ChallengeReply`, `BoardReply` (open and closed, with `older` rows, debt), `DoneRun[]` |
| `challengebuild.ts` `builderHtml(v)` | **Pure function of `BuilderView`**, but runs the **engine** (`checkChallengeDeck`, `newChallengeGame`) to get the problem and hand | args + engine | Storyable as is if the engine bundles in Storybook. It is deterministic, given a `ChallengeDef` with a seed |
| `deckstrip.ts` `challengeStripHtml(v)` | **Pure** (`StripView`) | `scanHtml` → asset URLs | Storyable. Card art needs `ART_BASE` to resolve, so serve `data/cards` |
| `challengerun.ts` `scoreHtml(s)`, `statCell` | **Pure** | args | Ready |
| `challengerun.ts` `meterHtml(run)`, `layerHtml(run)` | Pure **given a `ChallengeRun`**, but that is a class whose constructor builds a `SoloServer` and calls `localStorage` | `run.meterText()`, `run.done`, `run.failed`, `run.failedWhy()`, `run.submit` | Duck-type a fake: `{ meterText: () => '…', done, failed, failedWhy: () => '…', submit: {s:'guest'} } as unknown as ChallengeRun` (private fields block structural typing). Better: take a small view-model interface |
| `admin.ts` all renderers | No: private | `accounts`, `reports`, `games`, `rooms`, `cal`, `over`, `tab`, `loading`, `allowed`, `msg`, `unmarkedOnly`; writes `app.className` | Export `accountsHtml(rows, over)` and the rest. Each is close to pure already. Admin is the cheapest page to make storyable |
| `judgehistory.ts` | Pure, no UI | none | n/a |

**Global CSS dependencies for any story:** `style.css` in full. The pages rely on:
- `#app:not(.board)` making `#app` block flow (style.css:425);
- the `button` base (50-54);
- `:root` tokens (2-35);
- contextual rules that only fire under a parent class, such as `.accthead .hint` and `.lgpage .dim`. A story must wrap each fragment in its real parent (`.acctpage` / `.metapage.lgpage` / `.metapage.chpage` / `.adminpage`) or it will look different from production.

---

## 10. Responsive and breakpoint notes for these pages

| rule | effect | style.css |
|---|---|---|
| `#app:not(.board) { display:block }` | Off-board pages are plain flow | 425 |
| `.acctbody` auto-fit `minmax(300px,1fr)` | Profile cards go 1 to 3 across | 1823 |
| `.lgpage .acctbody` 3 fixed columns → 1 at **≤760px**; `.lgavail` 2 columns → 1; presets column → row | League | 5028, 5031, 5035-5039 |
| `.lgbbody` auto-fit 240px | Banner body | 5079 |
| Banner starts folded when `innerWidth < 700` | JS, evaluated once | league.ts:120 |
| `.statgrid` auto-fit 88px | Stat cells | 1838 |
| `.achgrid` auto-fill 260px | Achievements | 1882 |
| `.lgform` auto-fit 230px | New-season form | 5058 |
| `.chbox` `min(94vw,460px)`, scroll at 90vh | Run dialog | 5390 |
| `.lgstampcode` max 42vw | Stamp input | 5122 |
| `.ttdeck` / `.ttchnote` tighten or hide at ≤900px; bell and report buttons move at ≤1366 / ≤900 | Challenge strip | 2974-2982 |
| `.admintablewrap` overflow-x | Admin tables scroll | 3493 |
| `.chboardcard` overflow-x | Leaderboard scrolls | 5360 |
| none | Profile history, league tables, `.accthbtns` have **no small-screen handling**; `html.touch` has no rules for these pages | n/a |
