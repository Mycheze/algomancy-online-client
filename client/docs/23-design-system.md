# 23 — Design system: the plan

> **STATUS: Phase 0 in progress (started 2026-11-02).** The owner approved this plan on 2026-11-02 ("go ahead
> and get on it") with the Phase 0 defaults below. The live, commentable copy is the owner's Claude Doc
> "Algomancy Design System Plan" (https://claude.ai/artifact/JVnAtDeJhGwT4FgNmy8dKw); this file is the
> repo's copy, and the one later sessions should keep current. It supersedes BL-10's 2026-08-25
> "light sprucing up, not a redesign" brief.
>
> Raw material: [`23-ui-inventory/`](23-ui-inventory/README.md), a 2026-11-02 snapshot of every UI element.

Turn the client's ad-hoc styling into a real design system in six phases (0 to 5). Don't change how anything
looks until the system exists. Then redesign on top of it, one component and one page at a time, in Storybook.

## Why

The non-game pages look "vibe-coded" for one reason: **there is no shared base layer, so every page styled its
own copy of everything.** The inventory counts the copies:
- 352 distinct colours against 40 tokens, and 45 font sizes;
- ~95 hand-rolled panels, 8 tab bars, 8 tables, ~10 dialog boxes and 4 toast systems;
- `.hint` used 160 times with no global rule, and three meanings of "primary".

## Approach

- **Convert, then redesign.** Phases 0–5 change structure, not the design. Each ends with before/after
  screenshots of every page. The only intended visible differences are:
  - the Phase 0 bug fixes;
  - Phase 2's grey hints and focus rings;
  - places where a page's private copy differed from the shared component.

  Each one is listed for the owner.
- **Snap to what's already there.** The first tokens take today's most common values, so swapping literals for
  tokens is mostly invisible. Every value that does move goes on a list the owner approves.
- **One page at a time.** Each page conversion is its own small round that lands on master. No branch outlives a
  week, because other sessions edit `main.ts` and `style.css` daily.
- **The game board is out of scope.** The exception is the primitives it shares with the rest: buttons, dialogs,
  chips and colour tokens. Its ~3,300 lines of CSS move into their own files word for word.
- **Storybook arrives with the components (Phase 3)**, in its own package (`client/storybook/`), so the UI keeps
  no dependencies and the gate never waits on it.

## Target structure

Each layer uses only the layers above it:

```
tokens.css   ~30 colour roles, 7 type sizes, spacing, 4 radii, 3 shadows, 8 z-layers, motion
  ↓
base.css     body text, h1–h4, links, .hint/.dim, one label style, inputs, focus ring        board/ (moved as is,
  ↓                                                                                        reads tokens only)
components/  ui/components/<name>.ts (pure fn → HTML string) + styles/components/<name>.css  → Storybook
  ↓
pages/       ui/pages/<page>.ts: pageView() gathers state, pageHtml(view) draws it          → Storybook
  ↓
build        esbuild: styles/ → bundle.css (gitignored), main.ts → bundle.js; index.html loads both
```

## Phases

About 18 rounds in total. Every phase lands on master on its own and leaves the client working.

| Phase | Rounds | What | Gate |
|---|---|---|---|
| 0 Prepare | 1 | Screenshot tool on made-up data (`client/server/e2e/ui-shots.mjs`); every test that reads `style.css` goes through one `readStyles()` helper; the inventory's bugs confirmed in a browser and fixed | Baselines captured, full gate green, fixes live with update lines |
| 1 Split and tokenise | 2 | `style.css` → `client/ui/styles/` bundled to `bundle.css`; `legal.ts`/`sandbox.ts` injected CSS moved in; tokens written; literals replaced (page CSS first, board exact matches only); guard: no new colour literal outside `tokens.css` | Every screenshot identical, or a snap the owner approved |
| 2 Base layer | 1 | Global body/heading/link/`.hint`/`.dim`/label/input/focus styles; delete per-page copies | Owner checks the visible changes; an update line ships |
| 3 Components and Storybook | 2 | Components: button (primary/secondary/ghost/danger/link/icon), toggle, field, panel, page header, back link, tabs, table, chip, status message, empty state, dialog (native `<dialog>`), toast, icon (one SVG sprite). Each has a story with every variant and a DOM-free test | Owner signs off each component |
| 4 Pages | 11 | One page per round: Home → Sign-in/Profile → My decks/tabletop → Cards → Metagame/Card stats → League → Weekly challenge → Queue/waiting rooms/post-game → How to play/Learn → Admin → Rules review. Each round: extract the renderer, add a page story, swap in components keeping every `data-btn`, delete the replaced CSS, before/after screenshots | Before/after reviewed, per page |
| 5 Clean-up | 1 | Delete dead rail/classic CSS, the 28 `.on` copies and the triple `.menu`. Guards: no colour or z-index literal outside tokens, no class defined in two unrelated places, every component has a story. Update the UI README and `CLAUDE.md` | No literal left outside the tokens |

After Phase 5 the redesign proper starts. The owner picks variants in Storybook, and each pick is a change to a
token or one component, which every page then follows.

## Keeping it safe

| Risk | Guard |
|---|---|
| A "no visible change" phase moves something | Baseline screenshots of every page at 1440 / 1024-touch / 390. Byte-identical files pass; any difference goes to a side-by-side report |
| Splitting the stylesheet breaks the tests that read `style.css` as text | Phase 0 routes them all through `readStyles()` |
| Renamed buttons break tests and the tutorial | `data-btn` names never change |
| Tests that read class names from rendered markup (ui-driver) | A component keeps the class names those tests read, or the test changes in the same commit, with the reason |
| Other sessions edit `style.css`/`main.ts` daily | Worktrees under `.claude/worktrees/`, small landings. The split is one commit at a quiet hour, announced first, after in-flight CSS work (e.g. the `cc-*` competitive-constructed branches) has landed |
| Existing guards | 269 overlay census, 273 touch reach, 247 asset paths and 323 update lines stay green; the full gate runs before every landing |
| Deploys | Client-only (`npm --prefix client/ui run build`, no restart). Update lines for phases 0 and 2 and for every page redesign; none for 1, 3 and 5 |

## Decisions

Settled by the owner on 2026-11-02, by approving the plan with its defaults:
- Go ahead; BL-10 now points here.
- The inventory is committed as `client/docs/23-ui-inventory/`.
- The inventory's bugs are fixed in Phase 0, each after a browser check.
- Screenshot fixtures use made-up data. Real data carries player names, and the repo is public.

Still open, with the default that applies unless the owner says otherwise:

| Needed by | Decision | Default |
|---|---|---|
| Phase 1 | The snap list | Flag anything over 2px or a visible colour shift; the rest goes through |
| Phase 3 | Where Storybook is viewed | A static build on the site behind the owner badge, so it opens on the iPad |
| Phase 3 | What "primary" looks like | Keep both: green = confirm in the game, gold = a page's main action. Choose properly in the redesign. **Settled 2026-11-03** (owner: "match the official rule PDF rather than this yellow and green nonsense"): one orange, the Manual's, filled for the primary and as the accent; the palette is the Manual's purple (tokens.css, ui/test/1030) |
| Phase 3 | Prefix for component classes | `ui-` (`ui-button`, `ui-panel`) |
| Phase 4 | Page order | As in the table above |

## Progress

> **Resume here.** State at the end of 2026-11-02. Work stopped mid-phase-1 at the owner's request.

| Phase | State |
|---|---|
| 0 | **On master** (`292f870b`, `f069203e`, `6777399e`; gate green). **Not deployed.** The owner said "hold and just work locally", so whoever next deploys master ships these. Contents: the inventory and this plan; `readStyles()` for every CSS-reading test (910); the bug fixes with guards 900–909, including Custom rules being dead since 2026-10-10 (crreview swallowed every `cr-` button); and 8 update lines dated 2026-11-02. When it does deploy, **re-date those lines** to the deploy day (323 checks the order). |
| 1a | **Branch `ds-phase1b`** (worktree `.claude/worktrees/ds-phase1b`), commits `a0afe05e` (split into `client/ui/styles/`, `bundle.css` byte-identical to the old `style.css`) and `af486e6e` (CR verdict U23's span path follows the move). Full gate green on its own. |
| tool | Same branch, `efc6f506`: `client/server/e2e/ui-shots.mjs` + `ui-fixture.ts` + `pinned-server.mjs` + `ui-shots-compare.mjs`. 83 states × 3 viewports, 524 PNGs. Always compare two runs **on the same fixture dir** (a re-seeded fixture differs in ~80 shots), with `--fuzz 3`. |
| 1b-i | Same branch, `b507f029`: 65 role tokens in `styles/tokens.css` (the old names still work), `ui/scripts/tokenize-styles.mjs` (exact matches only, pages/shared/base, the board untouched), 921 colour-literal ratchet. Zero visible change (524 shots, 0 differ). **The landing gate for 1a + tool + 1b-i was started and stopped unfinished; run it again before pushing.** |
| 1b-ii | Same branch. `tokenize-styles.mjs --snap through`: 589 near-values onto the scale, pages/ only, each element ≤2px. Visible in aggregate (479/524 shots differ). **Owner approved 2026-11-03.** |
| 2–5 | **Round of 2026-11-03, branch `ds-int`** (the owner: backend only, under today's look; PAGES ONLY; CC merged in; both ship together after an owner playtest). Wave 1 merged: `ds-pages` (home, waiting rooms, deck/clock picker out of `main.ts` into `ui/pages/`; `pages/README.md` maps all 40 pages; CC states in ui-shots via `ui-fixture.ts --cc`), `ds-comp` (13 `ui-` components, tests 940+, Storybook in `client/storybook/`), `ds-base` (Phase 2 base layer under `:where()`, guard 925). Wave 2 (pages onto components): front door, account/social/admin, cards/meta/stats, league/challenge/learn. Not this round: decks + tabletop + binder (CC-heavy), crreview, rules/help, the icon sprite. Briefs and per-stream records: `var/records/ds-round-2026-11-03-*.md`. |
| **after 2026-11-03** | Where each phase stands once `ds-int` (waves 1–3) lands. **0, 1a, 1b, tool:** done. **2 (base):** done; `.zonelabel` moved from a board piece into base.css on 2026-11-11 (BL-63). **3 (components):** 13 components plus the variants the pages asked for (page-header `subtitleAs`, panel `titleHtml` + `panelSubheading`, tab `className`, table `headless` + column `title`/`headClassName`, status `tag: 'p'`, primary hover) and tokens `--color-scrim-strong`, `--color-winrate-up/-down`; Storybook built and served to admins. **The icon sprite is not done.** **4 (pages):** 24 page modules under `ui/pages/` (map: `ui/pages/README.md`); **left:** My decks + deck modals + sideboard, the tabletop builder and binder, the rules review (`crreview.ts`), How to play / the help layer (`rules.ts`, `helplayer.ts`, CSS in a board piece), the lesson window, the public CR sheet, the replay bar, and `handlePregameButton` (still in `main.ts`, `TODO(ds)`). **5 (guards):** 992 (a story and a DOM-free test per page), 993 (no colour literal in page/component `.ts`), 994 (no stray stylesheet), 995 (no hand-written `ui-` class), 996 (the READMEs name every file), on top of 920/921/925/940/962. How it fits together: `client/ui/README.md` § How the pages are drawn. |

| **redesign: home** | **2026-11-03 evening, on `ds-int`**: the first page of the redesign (docs/24), built on the system before the playtest so CC and the new home ship together. New components `icon` (25 glyphs, one outline style), `iconButton`, `segmented`, `sheet` (+ `installSheetEsc`), `appShell` + `shellBar` (tests 1002–1007). `pages/home.ts` rebuilt on them: toolbar · Play card (Draft \| Constructed; Casual \| Competitive) · League/Challenge/Matchmaking cards · bottom bar; every fold is a sheet; the pill, bell and legal footer are hidden on home only (1020). No page scroll at ≥760×600: guards 1010 (CSS contract), 1011 (driven tabs/sheets/Esc), 1012 (ui-shots `noScroll`). Inventory, decisions and the old→new map: `var/records/ds-round-2026-11-03-home-{inventory,decisions,page,edge,comp}.md`. |

### Waiting for the owner

The approval page is https://claude.ai/artifact/KYPv65og6FnFJx9vMx6ozu.

1. ~~Apply the spacing snap?~~ Yes (owner, 2026-11-03).
2. Leave the 17 bigger near-misses as literals and handle them page by page in Phase 4? Recommended: yes, and nothing changes unless the owner objects.
3. `color-scheme: dark` on `:root` (dark native scrollbars and selects)? Recommended: yes, in Phase 2.

Also already settled: Phase 0's two UX calls. Only data-losing actions ask "press again" (giving up a run, dropping a kept run). The league availability grid uses tap plus arrow keys.

### Landing 1a + tool + 1b-i (the next step)

1. Rebase `ds-phase1b` onto `origin/master`. If `client/ui/style.css` conflicts because another branch edited it, take that branch's added sections into new `styles/pages/*` pieces at the same cascade position (one `@import` each in `styles/index.css`), then `git rm client/ui/style.css`. `node client/ui/scripts/split-styles.mjs --rev <that branch's commit> --check` shows where its sections would cut.
2. Re-run `node client/ui/scripts/tokenize-styles.mjs` (idempotent). Paste a new allowlist into 921 if it asks.
3. Check that verdict U23's span still names the piece that holds the `.placewarn` radial-gradient (engine test 409).
4. Run the full gate (`EXIT=0` in the log, not the notification). Then `git push origin ds-phase1b:master`.
5. Tell the competitive-constructed session the commit. Its `cc-int` branch adds **two** CSS sections to `style.css` (sideboard/tabletop and the match screen) and will merge them into pieces itself. Delete `split-styles.mjs` only after cc has landed. (Done 2026-11-07, BL-61: it is gone.)
6. Visible-change phases get update lines; 1a, the tool and 1b-i get none.

### Found, not fixed (ticket material)

- On a phone, the report button covers the league page's "Suggest a time".
- The friends "Everyone here" list shows an empty table on a fetch error.
- The league grid's help text still says "drag" on touch.
- The tabletop's rerender has the same `!inGame` guard pattern as the waiting-room deck-page bug. Checked 2026-11-11 (BL-63): not reachable, because in a room Back runs the deck page's own close and `renderScreen()` is only called from `renderHome()`.
- ui-shots phone overflow walk: Card stats headers, the past-week "Watch" buttons and admin badge buttons sit past the right edge. Probably inside scrolling tables; look before ticketing.
- Signed-out home at 1440: the "Challenge" nav button wraps onto its own row.
