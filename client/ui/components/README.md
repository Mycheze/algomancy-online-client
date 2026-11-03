# `ui/components/`: the design system's components

Phase 3 of the design-system plan (`client/docs/23-design-system.md`). Each
file here is one component: a **pure function from props to an HTML string**.
Pages are built by concatenating those strings and assigning them to
`innerHTML`, which is how every page in this client is already painted, so a
component drops into a page with no framework and no new dependency.

They went in first (Phase 3, in Storybook, with tests); wave 2 of Phase 4
(2026-11-03) swapped them into the pages under `../pages/`, and the round after
added the variants those pages asked for. A page never writes a `ui-` class by
hand (test 995): if a component cannot draw what a page needs, add the option
here (see "Adding a variant").

| component | file | variants and options |
|---|---|---|
| Button | `button.ts` | `secondary` (default), `primary` (filled orange confirm), `action` (orange outline), `ghost`, `danger`, `link`, `icon` (needs `title`) · size `md`/`sm` · `href` renders an `<a>` |
| Toggle | `toggle.ts` | `on` / off · `strong` (bold when on) · size |
| Field | `field.ts` | control `input` (any `type`, checkbox/radio laid out in a row) / `textarea` / `select` · `hint` · `error` |
| Panel | `panel.ts` | `default` / `inset` / `emphasis` · `roomy` · `wide` · `title` (+ `titleHtml`, or alone) · `panelSubheading()`, the `<h4>` inside a panel |
| Page header | `page-header.ts` | title (+ `titleHtml`), subtitle (`subtitleAs: 'p'` for a paragraph with its margins), `actionsHtml`, `back` (a back link, last) |
| Back link | `back-link.ts` | `primary` (default, "Return to Lobby") / `secondary` / `link` · `arrow` |
| Tabs | `tabs.ts` | `plain` / `caps` · per-tab `count`, `dataBtn`, `title` and `className` |
| Table | `table.ts` | columns with `align`, `className`, `headClassName`, `title` (a header tooltip); cells text or `{ html }`; `caption`, `emptyText`, `scroll`, `headless` (no header row) |
| Chip | `chip.ts` | tone `neutral` / `accent` / `success` / `warning` / `danger` / `info` · shape `tag` / `pill` · `solid` |
| Status message | `status.ts` | `ok` / `warn` / `error` / `info` / `note` (today's accent `.deckmsg`) · `boxed` · `tag: 'p'` (a paragraph, with its margins) |
| Empty state | `empty-state.ts` | boxed (default) / `bare` · `title` · `actionHtml` |
| Dialog | `dialog.ts` | native `<dialog>` · width `md` / `lg` / `xl` · `closable` · `openDialog` / `closeDialog` / `installDialogClose` |
| Toast | `toast.ts` | `success` / `info` / `danger` · `toastHtml` (markup) and `showToast` (one region on `<body>`) |
| Icon | `icon.ts` | `icon(name, { size, title })` · one outline style, 24×24, `currentColor` · `ICON_NAMES` · 1em unless `size` (px or a CSS length) · decorative unless `title` |
| Icon button | `icon-button.ts` | the toolbar button: icon + caption · layout `stack` / `inline` · `badge` (a count, 99+, or `'dot'`) · `on` · `disabled` · `href` · `iconHtml` (an avatar) · ≥48px |
| Segmented | `segmented.ts` | one of a few: each option its own `dataBtn`/`attrs`/`on`/`disabled`/`title` · size `md` / `sm` · `full` · `ariaLabel` (root `role="group"`) |
| Sheet | `sheet.ts` | drawn from state (`open: false` → '') · placement `center` / `anchor-bottom-left` / `-bottom-right` / `-top-left` / `-top-right` · width `sm` / `md` / `lg` · `dismissBtn` on scrim and ✕ · `footerHtml` · `installSheetEsc` |
| App shell | `app-shell.ts` | `appShell({ topHtml, mainHtml, bottomHtml })`: 100dvh, only the main region scrolls; stacked flow under 760×600 · `shellBar({ startHtml, centerHtml, endHtml })` |

`index.ts` re-exports them all. `_shared.ts` holds what they share (escaping,
the attribute string); it is not a component.

## The contract

1. **Pure.** `props → string`. No DOM, no module state, no imports but sibling
   components and `../util.ts` (for `esc`). The two exceptions are the small
   helpers that exist to touch the DOM, `openDialog`/`closeDialog`/
   `installDialogClose`, `showToast` and `installSheetEsc`; each takes what it touches as an
   argument (or `globalThis.document`), so a test can pass a fake.
2. **Escaped.** Every text prop goes through `esc` from `ui/util.ts`. A prop
   whose name ends in `Html` (`labelHtml`, `bodyHtml`, `actionsHtml`, a table
   cell's `{ html }`) is **trusted markup**, usually another component's output.
   Never pass user text to an `…Html` prop.
3. **Pass-through.** Every component takes `dataBtn` (written as `data-btn`,
   exactly as given: main.ts's click delegator routes on it, and a page keeps
   every `data-btn` it had), `className` (added after the component's classes)
   and `attrs` (any other attribute, escaped; `true` writes a bare attribute,
   `false`/`null`/`undefined` leaves it out).
4. **`ui-` classes, BEM-ish.** `.ui-<name>` on the root, `.ui-<name>__part`
   inside, `.ui-<name>--variant` for a variant. The one exception is the state
   class **`on`** (a pressed toggle, the current tab), which stays `on` because
   ~18 tests and the ui-driver read `.on` from rendered markup.
5. **Tokens only.** The CSS is `ui/styles/components/<name>.css` and reads
   `var(--…)` from `ui/styles/tokens.css`, with no colour literal. Values the
   scale does not hold yet (the 5px control radius, the dialog's 18px 22px)
   are tokens too, in the components block at the end of `tokens.css`.
6. **Today's look.** Each component reproduces the most common existing recipe
   (the census, `client/docs/23-ui-inventory/07-design-foundations.md` §8, which
   each file's header cites), so swapping it into a page changes nothing on
   screen. Where it deliberately does not, the header says so.
7. **A story and a test each.** `client/storybook/stories/<name>.stories.ts`
   shows every variant; `ui/test/9xx-ui-<name>.test.ts` checks, without a DOM,
   that each variant renders its class, text is escaped and `data-btn` passes
   through.

`ui/test/940-components-complete.test.ts` holds this together: every component
has its CSS piece (defining `.ui-<name>`), story, test and barrel line; the CSS
has no colour literal and no non-`ui-` class; the pieces sit in one block right
after `base.css`; a component imports nothing it should not.

## Adding a component

1. `ui/components/<name>.ts`: export the function and its props type. If it
   has variants, export them as a `const` array (`BUTTON_VARIANTS`) so the
   story and the test loop over the same list.
2. `ui/styles/components/<name>.css`, and one `@import "components/<name>.css";`
   line in the components block of `ui/styles/index.css`.
3. `export * from './<name>.ts';` in `index.ts`.
4. `client/storybook/stories/<name>.stories.ts`, with a story per variant.
5. `ui/test/<next free 9xx>-ui-<name>.test.ts`.
6. `npm --prefix client/ui run check`. 940 names anything you missed.

## Adding a variant

A page that needs something a component does not do yet (a title with markup, a
table with no header row) gets it here, not as a copy of the component's markup
in the page:

1. Add the prop to the component, defaulting to today's output — every page that
   does not pass it must render byte for byte as before.
2. Any CSS goes in the component's piece, from tokens. A colour the scale does
   not hold becomes a token in `ui/styles/tokens.css` first.
3. A story for it in the component's stories file, and a case in its test.
4. Swap it into the page, delete the page CSS it replaces (grep the class across
   `client/ui` first, `.ts` included), and prove it with `ui-shots`: 0 differences.

## Where the pages stand (Phase 4)

Every page under `../pages/` draws with these where one reproduces its look.
What each page still writes by hand, and why, is in its module's header comment
and in `../pages/README.md`; the larger leftovers:

- **My decks, the tabletop builder, the binder, the rules review, How to play**
  are not under `pages/` yet, so they use no component.
- The metagame, ladder, card stats and shared-deck headers: their Back button
  sits beside the title, `pageHeader` puts it at the edge. An owner call.
- The profile's cards are still `<section class="acctcard">` (`panel` can take
  their counts in `titleHtml` now), and its history/ladder tables `.accttable`.
- The match room's buttons (834–839 pin their exact markup) and the report
  dialog's (287 reads `data-report="send" disabled` in that order).

Known seams:
- A page rule with an element selector outranks a component class: `.deckpage h1`
  (22px) beats `.ui-page-header__title` (26px), `.acctbar button` beats
  `.ui-button`'s padding. Deleting the page rule is the fix, not `!important`.
- `main.ts` repaints `#app` with `innerHTML` on every state change, so a
  `<dialog>` inside `#app` is destroyed by the next repaint. A dialog that must
  outlive one belongs in a layer beside `#app` (`ui/README.md`).
- **The colours are the Manual's** (owner 2026-11-03): deep purple surfaces,
  one orange accent that is also the filled primary, lavender as the secondary
  tone. The old gold-on-green `.cta.primary` is gone: the page overrides that
  painted gold over the green fill were deleted, so those buttons are plain
  primaries. `ui/test/1030` keeps the old gold and green off the pages.
- **The home redesign's five** (icon, icon button, segmented, sheet, app
  shell, 2026-11-03) reproduce nothing: they are new looks for
  `client/docs/24-redesign/`, so no page uses them until that page is built.
  Their sizes are tokens at the end of `tokens.css` (`--icon-button-*`,
  `--segmented-*`, `--shell-bar-h`, `--sheet-*`). A sheet has no entry
  animation on purpose (a repaint redraws it), and a page in the app shell
  must hide `#legalfoot`, or the page scrolls by the footer's height
  (`app-shell.ts`'s header).
- The toast helper replaces the green `.toast`, `.crtoast` and the deck page's
  messages. The board's cost toasts (`ui/toast.ts`) are a stack of game notices
  and stay as they are.
