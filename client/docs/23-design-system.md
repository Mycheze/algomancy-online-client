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
| Phase 3 | What "primary" looks like | Keep both: green = confirm in the game, gold = a page's main action. Choose properly in the redesign |
| Phase 3 | Prefix for component classes | `ui-` (`ui-button`, `ui-panel`) |
| Phase 4 | Page order | As in the table above |

## Progress

| Phase | State |
|---|---|
| 0 | in progress — worktrees `ds-phase0` (tests helper, bug fixes, docs) and `ds-shots` (screenshot tool) |
