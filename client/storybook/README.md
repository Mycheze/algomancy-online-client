# `client/storybook/`: the components, one page each

Storybook for the client's design-system components (`client/ui/components/`).
Every component has a page with each variant on it and controls to try the
props; the **Foundations** page shows the design tokens. Everything is drawn
with the site's real stylesheet, so a component looks here exactly as it will
on a page.

This is its own package. `client/ui` has no dependencies and must keep none,
and the gate (`npm --prefix client run check`) never waits on Storybook. The
only part of this directory the gate touches is the stories' types, which
`client/ui/tsconfig.json` checks; the stories import nothing from Storybook, so
that check needs nothing installed here.

## Run it

```bash
cd client/storybook
npm install          # once; versions are pinned exactly in package.json
npm run storybook    # dev server on http://localhost:6006, reloads as you edit
npm run build        # static site in storybook-static/ (gitignored)
```

Both scripts first run `npm run css`, which builds `client/ui/bundle.css` from
`client/ui/styles/` (the same file the game server serves). While the dev
server runs, editing any piece under `client/ui/styles/` rebuilds it and the
story repaints. Editing a component's `.ts` reloads the story too.

To look at it from an iPad on the same network, start the dev server with
`npx storybook dev -p 6006 --host 0.0.0.0` (after `npm run css`) and open
`http://<this machine>:6006`. Or serve `storybook-static/` with any static file
server.

## Add a component

The contract and the steps are in `client/ui/components/README.md`. In short:
the component (`ui/components/<name>.ts`), its CSS
(`ui/styles/components/<name>.css` plus an `@import` line), a barrel line, a
DOM-free test, and here a `stories/<name>.stories.ts`. `ui/test/940` fails until
all five exist.

A story file is plain CSF: a default export with a `title`, a `render` that
calls the component, and `args`; then one named export per variant:

```ts
import { CHIP_TONES, type ChipProps, chip } from '../../ui/components/chip.ts';

export default {
  title: 'Components/Chip',
  render: (args: ChipProps) => chip(args),
  args: { label: 'early', tone: 'neutral' },
  argTypes: { tone: { control: 'select', options: CHIP_TONES } },
};

export const Neutral = {};
export const Accent = { args: { tone: 'accent' } };
```

Rules for stories:
- **Import the component from `../../ui/components/<name>.ts`**, never a copy.
- **Import nothing from Storybook**, not even a type: ui's typecheck reads these
  files and has no Storybook installed.
- **Every variant gets a story**, plus an "all variants" gallery when the
  variants are worth comparing side by side. Loop over the component's exported
  variant list (`CHIP_TONES`) so a new variant shows up by itself.
- Layout for the story itself (rows, frames) is in `stories/_helpers.ts`.
  `_`-prefixed files are not about one component and 940 passes over them.

## The pure-function contract

A component is a function from props to an HTML string: no DOM, no state.
That is what lets one function serve the page (`innerHTML`), the story (the
`html` framework renders the returned string) and the test (asserts on the
string, no browser). Text props are escaped; props ending in `Html` take
trusted markup; `dataBtn`, `className` and `attrs` pass through to the root
element. The full contract is in `client/ui/components/README.md`.

## How it is wired

- `.storybook/main.js`: the stories glob, the `@storybook/html-vite`
  framework, telemetry off, Vite allowed to read the repo (the stories and the
  stylesheet live outside this package), and the plugin that rebuilds
  `bundle.css` when a style piece changes. It is plain JS on purpose: a `.ts`
  config would need a tsconfig, and `client/engine/test/153` requires every
  tsconfig to be in the gate.
- `.storybook/preview.js`: imports `../../ui/bundle.css`. Its one `url()`, the
  EB Garamond title face, resolves to `client/ui/fonts/` as it does on the site.
