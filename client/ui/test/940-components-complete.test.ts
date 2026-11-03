/*
 * 940 · EVERY COMPONENT IS WHOLE: CODE, STYLESHEET, STORY, TEST
 *
 * The design system's components (Phase 3, client/docs/23-design-system.md)
 * live in four places at once: `ui/components/<name>.ts` (a pure function from
 * props to an HTML string), `ui/styles/components/<name>.css` (its `ui-<name>`
 * classes), `client/storybook/stories/<name>.stories.ts` (every variant, to
 * see and iterate on) and a DOM-free test in ui/test. A component missing one
 * of them is the start of the rat's nest the round exists to clear: a class
 * with no stylesheet paints as a bare element, a component with no story is
 * one the owner cannot look at, one with no test can stop escaping its text.
 *
 *   §0  non-vacuity — the walks find the components, the pieces and the stories
 *   §1  each component has its stylesheet piece (defining `.ui-<name>`), its
 *       story (importing it from ui/components), a test importing it, and a
 *       line in the barrel
 *   §2  nothing orphaned: no component piece, story or barrel line without a component
 *   §3  the component pieces sit together straight after base.css — before
 *       every page, so a page can still override one while it adopts it
 *   §4  their CSS reads tokens only (no colour literal) and defines only
 *       `ui-` classes (plus the `on` state, which tests read; toggle.ts says why)
 *   §5  they are pure: a component imports only its siblings and ../util.ts
 *       (for esc), never a page module or main.ts
 *
 * `_`-prefixed files in ui/components (the shared helpers) are not
 * components, and index.ts is the barrel. A `_`-prefixed story
 * (`_tokens.stories.ts`, the Foundations page) is about no one component.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_TEST_DIR } from '../../engine/scripts/paths.mjs';
import { colourLiterals, declarations } from '../scripts/css-scan.mjs';
import { readStylePieces } from './read-styles.ts';

const COMPONENTS = readdirSync(UI_COMPONENTS_DIR)
  .filter(f => f.endsWith('.ts') && f !== 'index.ts' && !f.startsWith('_'))
  .map(f => f.slice(0, -'.ts'.length))
  .sort();
const PIECES = readStylePieces();
const COMPONENT_PIECES = PIECES.filter(p => p.piece.startsWith('components/'));
/** `components/button.css` → `button` */
const pieceName = (piece: string): string => piece.slice('components/'.length).replace(/\.css$/, '');
const STORIES = existsSync(STORYBOOK_STORIES_DIR)
  ? readdirSync(STORYBOOK_STORIES_DIR).filter(f => f.endsWith('.stories.ts') && !f.startsWith('_')) : [];
const storyName = (f: string): string => f.slice(0, -'.stories.ts'.length);
const TESTS = readdirSync(UI_TEST_DIR).filter(f => f.endsWith('.test.ts'))
  .map(f => readFileSync(join(UI_TEST_DIR, f), 'utf8'));
const BARREL = readFileSync(join(UI_COMPONENTS_DIR, 'index.ts'), 'utf8');

/** the class names a selector list mentions */
const classesIn = (selector: string): string[] => [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]!);

test('§0 POSITIVE CONTROL: the walks find the components, their pieces and their stories', () => {
  assert.ok(COMPONENTS.length >= 13, `only ${COMPONENTS.length} components found in ui/components: ${COMPONENTS.join(', ')}`);
  for (const known of ['button', 'dialog', 'toast']) assert.ok(COMPONENTS.includes(known), `${known} is not among the components`);
  assert.ok(COMPONENT_PIECES.length >= 13, `only ${COMPONENT_PIECES.length} components/ pieces in the stylesheet`);
  assert.ok(STORIES.length >= 13, `only ${STORIES.length} stories found in ${STORYBOOK_STORIES_DIR}`);
  assert.ok(TESTS.length > 50, 'the ui test directory read as nearly empty');
  assert.match('.ui-toggle.on:hover, .ui-tabs--caps .ui-tabs__tab', /\.ui-/);
  assert.deepEqual(classesIn('.ui-toggle.on:hover, .ui-tabs--caps .ui-tabs__tab'), ['ui-toggle', 'on', 'ui-tabs--caps', 'ui-tabs__tab']);
});

test('§1 each component has its stylesheet piece, its story, a test and a barrel line', () => {
  const missing: string[] = [];
  for (const name of COMPONENTS) {
    const piece = COMPONENT_PIECES.find(p => pieceName(p.piece) === name);
    if (!piece) missing.push(`${name}: no ui/styles/components/${name} piece in styles/index.css`);
    else if (!new RegExp(`\\.ui-${name}(?![\\w-])`).test(piece.text)) missing.push(`${name}: its piece never defines .ui-${name}`);
    const story = join(STORYBOOK_STORIES_DIR, `${name}.stories.ts`);
    if (!existsSync(story)) missing.push(`${name}: no story ${name}.stories.ts in client/storybook/stories/`);
    else if (!readFileSync(story, 'utf8').includes(`'../../ui/components/${name}.ts'`)) {
      missing.push(`${name}: its story does not import '../../ui/components/${name}.ts'`);
    }
    if (!TESTS.some(t => t.includes(`'../components/${name}.ts'`))) missing.push(`${name}: no ui/test file imports '../components/${name}.ts'`);
    if (!BARREL.includes(`export * from './${name}.ts';`)) missing.push(`${name}: ui/components/index.ts does not export it`);
  }
  assert.deepEqual(missing, [], 'a component is not whole (ui/components/README.md, "Adding a component"):\n  ' + missing.join('\n  '));
});

test('§2 nothing orphaned: every component piece, story and barrel line has its component', () => {
  const orphans = [
    ...COMPONENT_PIECES.map(p => pieceName(p.piece)).filter(n => !COMPONENTS.includes(n)).map(n => `styles/components/${n}: no ui/components/${n}.ts`),
    ...STORIES.map(storyName).filter(n => !COMPONENTS.includes(n)).map(n => `stories/${n}.stories.ts: no ui/components/${n}.ts`),
    ...[...BARREL.matchAll(/export \* from '\.\/([\w-]+)\.ts';/g)].map(m => m[1]!).filter(n => !COMPONENTS.includes(n))
      .map(n => `index.ts exports ./${n}.ts, which is not a component`),
  ];
  assert.deepEqual(orphans, [], orphans.join('\n'));
});

test('§3 the component pieces are one block, straight after base.css', () => {
  const order = PIECES.map(p => p.piece);
  const base = order.findIndex(p => /^base\.css$/.test(p));
  assert.ok(base >= 0, 'no base piece in the cascade');
  const block = order.slice(base + 1, base + 1 + COMPONENT_PIECES.length);
  assert.deepEqual(block, COMPONENT_PIECES.map(p => p.piece),
    'the components/ pieces are not together directly after base.css in styles/index.css');
});

test('§4 component CSS reads tokens only and defines only ui- classes', () => {
  const bad: string[] = [];
  for (const { piece, text } of COMPONENT_PIECES) {
    for (const c of colourLiterals(text)) bad.push(`${piece}: ${c.selector} { ${c.prop}: …${c.literal}… } — a colour literal; use a --color-* token`);
    for (const d of declarations(text).decls) {
      for (const cls of classesIn(d.selector)) {
        if (!cls.startsWith('ui-') && cls !== 'on') bad.push(`${piece}: ${d.selector} — .${cls} is not a ui- class`);
      }
    }
  }
  assert.deepEqual([...new Set(bad)], [], [...new Set(bad)].join('\n'));
});

test('§5 a component imports only its siblings and ../util.ts', () => {
  const bad: string[] = [];
  for (const f of readdirSync(UI_COMPONENTS_DIR).filter(x => x.endsWith('.ts'))) {
    const src = readFileSync(join(UI_COMPONENTS_DIR, f), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)) {
      const spec = m[1]!;
      if (!/^\.\/[\w-]+\.ts$/.test(spec) && spec !== '../util.ts') bad.push(`${f} imports ${spec}`);
    }
  }
  assert.deepEqual(bad, [], 'a component must stay a pure function of its props: ' + bad.join(', '));
});
