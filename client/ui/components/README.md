# `ui/components/`: the design system's components

Phase 3 of the design-system plan (`client/docs/23-design-system.md`). Each
file here is one component: a **pure function from props to an HTML string**.
Pages are built by concatenating those strings and assigning them to
`innerHTML`, which is how every page in this client is already painted, so a
component drops into a page with no framework and no new dependency.

**Nothing uses them yet.** The components went in first, in Storybook, with
tests. The next wave (Phase 4, one page per round) swaps them into the pages.

| component | file | variants and options |
|---|---|---|
| Button | `button.ts` | `secondary` (default), `primary` (green confirm), `action` (gold page action), `ghost`, `danger`, `link`, `icon` (needs `title`) · size `md`/`sm` · `href` renders an `<a>` |
| Toggle | `toggle.ts` | `on` / off · `strong` (bold when on) · size |
| Field | `field.ts` | control `input` (any `type`, checkbox/radio laid out in a row) / `textarea` / `select` · `hint` · `error` |
| Panel | `panel.ts` | `default` / `inset` / `emphasis` · `roomy` · `wide` · `title` |
| Page header | `page-header.ts` | title (+ `titleHtml`), subtitle, `actionsHtml`, `back` (a back link, last) |
| Back link | `back-link.ts` | `primary` (default, "Return to Lobby") / `secondary` / `link` · `arrow` |
| Tabs | `tabs.ts` | `plain` / `caps` · per-tab `count` and `dataBtn` |
| Table | `table.ts` | columns with `align`, cells text or `{ html }`, `caption`, `emptyText`, `scroll` |
| Chip | `chip.ts` | tone `neutral` / `accent` / `success` / `warning` / `danger` / `info` · shape `tag` / `pill` · `solid` |
| Status message | `status.ts` | `ok` / `warn` / `error` / `info` / `note` (today's gold `.deckmsg`) · `boxed` |
| Empty state | `empty-state.ts` | boxed (default) / `bare` · `title` · `actionHtml` |
| Dialog | `dialog.ts` | native `<dialog>` · width `md` / `lg` / `xl` · `closable` · `openDialog` / `closeDialog` / `installDialogClose` |
| Toast | `toast.ts` | `success` / `info` / `danger` · `toastHtml` (markup) and `showToast` (one region on `<body>`) |

`index.ts` re-exports them all. `_shared.ts` holds what they share (escaping,
the attribute string); it is not a component.

## The contract

1. **Pure.** `props → string`. No DOM, no module state, no imports but sibling
   components and `../util.ts` (for `esc`). The two exceptions are the small
   helpers that exist to touch the DOM, `openDialog`/`closeDialog`/
   `installDialogClose` and `showToast`; each takes what it touches as an
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
   screen. Where it deliberately does not, the header says so (the gold
   `action` button drops the green fill the census lists as a bug).
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

## How the pages adopt them (Phase 4)

One page per round, in the plan's order (Home, Sign-in/Profile, My decks,
Cards, Metagame/Card stats, League, Weekly challenge, Queue/waiting
rooms/post-game, How to play/Learn, Admin, Rules review). Each round:

1. **Split the renderer.** `ui/pages/<page>.ts` gets `pageView()`, which gathers
   the state, and `pageHtml(view)`, which draws it from components. A page
   story renders `pageHtml` with made-up data.
2. **Swap in components, keeping every `data-btn`** and every class a test or
   the ui-driver reads. Where a test reads an old class, keep it on the element
   with `className` (`className: 'acctcard'`), or change the test in the same
   commit and say why.
3. **Delete the page's private CSS** the component replaced (`.accthead`,
   `.acctcard`, its copy of the `.on` rule). The component pieces load before
   every page, so while a page's old rules remain they still win; delete them
   to see the component's look.
4. **Prove it with ui-shots** before and after. The only allowed differences
   are where the page's private copy differed from the component; each goes on
   the list for the owner.

Known seams for that work:
- A page rule with an element selector outranks a component class: `.deckpage h1`
  (22px) beats `.ui-page-header__title` (26px), `.acctbar button` beats
  `.ui-button`'s padding. Deleting the page rule is the fix, not `!important`.
- `main.ts` repaints `#app` with `innerHTML` on every state change, so a
  `<dialog>` inside `#app` is destroyed by the next repaint. A dialog that must
  outlive one belongs in a layer beside `#app` (`ui/README.md`).
- The gold "primary" on a `<button>` today also shows the green fill underneath
  (the census's bug); `variant: 'action'` is the gold alone. Swapping it in is a
  visible fix the owner should see on the list.
- The toast helper replaces the green `.toast`, `.crtoast` and the deck page's
  messages. The board's cost toasts (`ui/toast.ts`) are a stack of game notices
  and stay as they are.
