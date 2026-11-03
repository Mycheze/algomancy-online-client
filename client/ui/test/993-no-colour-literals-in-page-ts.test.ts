/* 993 · NO COLOUR LITERAL IN A PAGE OR COMPONENT MODULE (design-system Phase 5)
 *
 * 921 keeps colour literals out of the page stylesheets; this is the same rule
 * for the markup. A page (ui/pages/*.ts) or a component (ui/components/*.ts)
 * that writes `style="background: rgba(…)"` or `color: #e07b39` has put a
 * colour where a redesign cannot find it. A colour is a token in
 * styles/tokens.css and reaches markup as `var(--color-…)` — in a class's CSS,
 * or inline through `var()` / `color-mix(… var(--…) …)` when it is computed
 * (the card stats' win-rate tint is the example).
 *
 * Comments are prose and are skipped. ALLOW is the escape hatch: a file and
 * the literal, with the reason. It is empty, and should stay so.
 *
 *   §0  the detector: catches every spelling, passes ids, issue numbers,
 *       entities, tokens and comments
 *   §1  no literal outside ALLOW
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UI_COMPONENTS_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

/** `pages/x.ts` → literals allowed there, each with its reason. Empty on purpose. */
const ALLOW: Record<string, { literal: string; why: string }[]> = {};

/** the source without comments: block comments, and `//` to the end of a line when it follows a space or starts it */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const HEX = /(?<![&\w/-])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const NAMED = /\b(?:color|background(?:-color)?|border(?:-[a-z]+)?-?color|border|outline|fill|stroke|box-shadow|text-shadow)\s*:\s*[^;"'`]*?\b(white|black|red|green|blue|gold|orange|yellow|purple|pink|gr[ae]y|silver|cyan|magenta|navy|teal|crimson|maroon)\b/gi;

/** every colour literal in a module's code */
export function colourLiterals(src: string): string[] {
  const c = code(src);
  const out: string[] = [];
  for (const m of c.matchAll(HEX)) {
    // an all-digit "#191" is an issue number unless it sits where a value does
    if (/^\d+$/.test(m[1]!) && !/[:(,]\s*$/.test(c.slice(Math.max(0, m.index - 3), m.index))) continue;
    out.push(m[0]);
  }
  for (const m of c.matchAll(FUNC)) out.push(m[0]);
  for (const m of c.matchAll(NAMED)) out.push(m[1]!);
  return out;
}

const modules = (): Array<[string, string]> => [
  ...readdirSync(UI_PAGES_DIR).filter(f => f.endsWith('.ts')).map(f => [`pages/${f}`, join(UI_PAGES_DIR, f)] as [string, string]),
  ...readdirSync(UI_COMPONENTS_DIR).filter(f => f.endsWith('.ts')).map(f => [`components/${f}`, join(UI_COMPONENTS_DIR, f)] as [string, string]),
];

test('§0 the detector: every spelling caught; ids, issue numbers, entities, tokens and comments passed', () => {
  const caught: Array<[string, number]> = [
    ['return `background: rgba(79, 179, 201, ${a})`;', 1],
    ["const s = 'color: #e07b39';", 1],
    ['`<td style="background:#4FB3C9">`', 1],
    ["const c = 'border-color: #111';", 1],
    ['`<i style="color: hsl(20 80% 50%)">`', 1],
    ["el.style.color = 'x'; const t = 'color: white';", 1],
    ['`<b style="border: 1px solid red">`', 1],
    ['const x = `fill: oklch(70% .1 200)`;', 1],
  ];
  for (const [src, n] of caught) assert.equal(colourLiterals(src).length, n, `missed in: ${src}`);
  const passed = [
    "document.querySelector('#app')",
    "const q = '#lg-ov-' + id;",
    '/* the old rgba(6,8,11,.72) scrim */ const a = 1;',
    "  // #191: the clock moved here, was color: #fff",
    "const n = `report #296 is fixed`;",
    "const e = '&#39;';",
    'return `background: color-mix(in srgb, var(--color-winrate-up) 12.3%, transparent)`;',
    "const s = 'color: var(--color-accent)';",
    "const u = 'https://example.com/#abc';",
  ];
  for (const src of passed) assert.deepEqual(colourLiterals(src), [], `flagged: ${src}`);
  assert.ok(modules().length >= 35, 'the pages and components are not being reached');
});

test('§1 no colour literal in ui/pages/*.ts or ui/components/*.ts', () => {
  const bad: string[] = [];
  for (const [name, path] of modules()) {
    const allowed = (ALLOW[name] ?? []).map(a => a.literal);
    const found = colourLiterals(readFileSync(path, 'utf8')).filter(l => !allowed.includes(l));
    if (found.length) bad.push(`${name}: ${found.join(', ')}`);
  }
  assert.deepEqual(bad, [],
    'a colour literal in page or component markup. Make it a token in styles/tokens.css and write var(--color-…) '
    + '(color-mix(in srgb, var(--…) N%, transparent) for a computed strength), or, if it truly cannot be, '
    + 'add it to ALLOW with the reason');
});
