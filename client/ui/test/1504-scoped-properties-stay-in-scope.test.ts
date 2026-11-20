/* A custom property defined only under some selector is read only where that selector reaches.
 *
 * Outside its scope a var() finds nothing: with a fallback it paints the fallback literal, which
 * no token change and no accessible palette ever moves; without one the declaration is dropped.
 * The rules review's document keeps a private palette on `.crdoc` (--warn, --bad, --fg, …), named
 * like tokens, and the board's amber, a ride chip's ink and the admin badge read it from outside.
 *
 * In scope = the use's selector extends the defining one, or names a class or id of its last
 * compound: the element it is set on (`.crdoc .differs` under `.crdoc`), or a modifier of it
 * (`.fxname` reading what `.fxname.inkdark` sets, with a fallback for the plain one). A property set from a ui
 * source (`style="--k:3"`, setProperty) is defined wherever the script put it. 1502 holds the
 * names nothing defines at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStyles } from './read-styles.ts';
import { declarations } from '../scripts/css-scan.mjs';
import { UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

type Decl = { prop: string; selector: string; value: string; at: string[] };

/** every declaration of `css`, with its value, @keyframes left out */
function decls(css: string): Decl[] {
  const { masked, decls: ds } = declarations(css);
  return ds.filter(d => !d.at.some(a => /^@(-webkit-)?keyframes/i.test(a)))
    .map(d => ({ prop: d.prop, selector: d.selector, value: masked.slice(d.start, d.end), at: d.at }));
}

/** :root (any theme of it), html and * reach every element */
const GLOBAL = /^(:root|html|\*)(\[[^\]]*\])?$/;
const stripArgs = (sel: string): string => { let s = sel; for (let k = 0; k < 4; k++) s = s.replace(/\([^()]*\)/g, ''); return s; };
/** the classes and ids a selector (one part of a list) names; a BEM modifier `.x--mod` names its block `.x` */
const names = (sel: string): Set<string> =>
  new Set((stripArgs(sel).match(/[.#][\w-]+/g) ?? []).flatMap(n => [n, n.replace(/--[\w-]+$/, '')]));
/** the classes and ids of a selector's last compound: the element the declaration lands on */
const lastNames = (sel: string): Set<string> => names(stripArgs(sel).trim().split(/\s*[\s>+~]\s*/).pop() ?? '');
/** `use` is `def` or reaches further in from it: `def > body`, `def.wide`, not `defthumbs` */
const extendsSel = (use: string, def: string): boolean => use.startsWith(def) && !/[\w-]/.test(use[def.length] ?? '');
/** a selector list's parts, split at its own commas, not those inside :is() or :not() */
function parts(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '(') depth++;
    else if (sel[i] === ')') depth--;
    else if (sel[i] === ',' && depth === 0) { out.push(sel.slice(from, i)); from = i + 1; }
  }
  return [...out, sel.slice(from)].map(p => p.trim()).filter(Boolean);
}

/** properties a ui source sets: markup and CSS strings, setProperty */
function scriptDefined(): Set<string> {
  const out = new Set<string>();
  for (const dir of [UI_DIR, UI_PAGES_DIR, UI_COMPONENTS_DIR]) {
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const t = readFileSync(join(dir, f), 'utf8');
      for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]!.toLowerCase());
      for (const m of t.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) out.add(m[1]!.toLowerCase());
    }
  }
  return out;
}

/** `selector → --name` for every var() in `css` that reads a property outside the only scopes defining it */
function outOfScope(css: string, fromScripts: ReadonlySet<string>): string[] {
  const all = decls(css);
  const scopes = new Map<string, string[]>();
  for (const d of all) if (d.prop.startsWith('--')) scopes.set(d.prop, [...(scopes.get(d.prop) ?? []), ...parts(d.selector)]);
  const out: string[] = [];
  for (const d of all) {
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = m[1]!.toLowerCase();
      const defs = scopes.get(name);
      if (!defs || fromScripts.has(name) || defs.some(s => GLOBAL.test(s))) continue;
      const reached = parts(d.selector).every(use => {
        const here = names(use);
        return defs.some(def => extendsSel(use, def) || [...lastNames(def)].some(n => here.has(n)));
      });
      if (!reached) out.push(`${d.selector} → ${name}`);
    }
  }
  return [...new Set(out)];
}

/** reached by inheritance from an ancestor the selector does not name — each checked by hand */
const INHERITED: Record<string, string> = {
  '.phicons .phword > span → --phink': 'the phase word sits inside its .phi icon, which sets the ink',
  '.lplay .ltok → --cwbase': 'the play zone is a region of the regions board, .lboard, which sets the card width',
  '.linfo .regionbinthumbs → --binth': 'the bin\'s thumbnails sit inside .regionbin, which sizes them',
  '.linfo .regionbinthumbs → --binslot': 'the same, the slot set on .regionbin on a short board',
  '.linfo .regionbinthumbs .card → --binth': 'the same, for each card in the pile',
};

const css = readStyles();
const fromScripts = scriptDefined();

test('the census reads the stylesheet and its scoped properties (positive control)', () => {
  const ds = decls(css);
  assert.ok(ds.length > 5000, `${ds.length} declarations`);
  assert.ok(ds.some(d => d.selector === '.crdoc' && d.prop === '--warn'), 'the rules document still keeps its own palette');
  assert.ok(ds.some(d => d.selector === '.crdoc .differs' && /var\(--bad\)/.test(d.value)), 'and reads it inside');
});

test('the check finds a scoped palette read from outside, and passes the shapes that reach', () => {
  const probe = `
    :root { --tok: red; }
    .doc { --warn: orange; --ink: black; }
    .doc .note { color: var(--warn); }
    .doc.wide p { color: var(--ink); }
    .card.dark { --shade: #000; }
    .card { color: var(--shade, #fff); }
    .bar .duty { color: var(--warn, #e8b64c); }
    .badge { background: var(--tok); border-color: var(--ink, red); }
    .x { width: var(--k); }
    .chip { --tone: grey; } .chip--solid { background: var(--tone); }
    :root:has(.pill) { --clear: 64px; } :root:has(.pill) > body { padding-bottom: var(--clear); }
    .zoom { --ring: 3px; } .zoom:is(.a, .b) { outline-width: var(--ring); }
    .doc, .other { --gap: 2px; } .list, .doc .item { margin: var(--gap); }
    .bin { --th: 9px; } .binthumbs { width: var(--th); }`;
  assert.deepEqual(outOfScope(probe, new Set(['--k'])), ['.bar .duty → --warn', '.badge → --ink', '.list, .doc .item → --gap', '.binthumbs → --th']);
});

test('no var() reads a scoped custom property from outside its scope', () => {
  const found = outOfScope(css, fromScripts);
  assert.deepEqual(found.filter(f => !(f in INHERITED)), [],
    'outside the selector that sets it the property is absent: the fallback is painted, or the declaration dropped. Use a token from tokens.css');
  assert.deepEqual(Object.keys(INHERITED).filter(k => !found.includes(k)), [], 'INHERITED names a read that is gone or now in scope');
});

test('the amber, the ride chip and the admin badge read the tokens', () => {
  const read = (sel: string, prop: string): string[] => decls(css).filter(d => d.selector === sel && d.prop === prop).map(d => d.value.trim());
  assert.deepEqual(read('.promptbar .duty', 'color'), ['var(--color-warning)']);
  assert.deepEqual(read('.tallyrow.mixed .tallyx', 'color'), ['var(--color-warning)']);
  assert.deepEqual(read('.clocktime.warn', 'color'), ['var(--color-warning)']);
  assert.deepEqual(read('.clocktime.warn.run', 'border-color'), ['var(--color-warning)']);
  assert.deepEqual(read('.ridechip', 'color'), ['var(--text)']);
  assert.deepEqual(read('.badgechip.admin', 'background'), ['var(--color-danger-fill)']);
});
