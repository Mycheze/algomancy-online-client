/*
 * 925 · A PAGE DOES NOT RE-DECLARE THE BASE LAYER
 *
 * Design-system Phase 2 (client/docs/23-design-system.md) gave the non-game
 * pages one base layer, `ui/styles/base.css`: body text, h1–h4, links, .hint,
 * .dim, the .eyebrow label, the form-control base and the :focus-visible ring.
 * Before it, every page wrote its own copy of each — `.hint` was used 160
 * times with no global rule — and a restyle meant forty edits. The round then
 * DELETED the per-page copies that equalled the base.
 *
 * This guard keeps them from growing back: no rule in a `pages/` or `shared/`
 * piece may select a base selector BARE, at the top level — `.hint { … }`,
 * `h2 { … }`, `a:hover { … }`, `input { … }` — because that restyles the base
 * for every page from inside one page's file. A page styles ITS OWN copy, in
 * context: `.lgpage .hint`, `.acctcard h3`, `.cbtools select`. A change that
 * is meant for every page goes in base.css.
 *
 *   §0  non-vacuity — every selector named below is really styled in base.css,
 *       and the detector flags a planted bare rule and passes a scoped one
 *   §1  no pages/ or shared/ piece has a bare base selector in any rule
 *
 * The board (board/) is out of the design system's scope and is not checked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declarations } from '../scripts/css-scan.mjs';
import { readStylePieces } from './read-styles.ts';

/** what base.css owns, as a page would spell it bare */
const BASE = ['body', 'h1', 'h2', 'h3', 'h4', 'a', '.hint', '.dim', '.eyebrow', 'input', 'select', 'textarea', ':focus-visible'];

/** split a selector list on its top-level commas */
function splitList(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(sel.slice(from, i).trim()); from = i + 1; }
  }
  out.push(sel.slice(from).trim());
  return out;
}

/** the base selector `one` names bare (itself, or itself with pseudo-classes/elements only), or null */
function bareBase(one: string): string | null {
  const s = one.trim();
  if (/[\s>+~]/.test(s.replace(/\([^)]*\)/g, ''))) return null;   // a combinator: it is in context
  for (const b of BASE) {
    if (b.startsWith(':')) { if (s === b || s === `*${b}`) return b; continue; }
    // the base selector, then nothing but pseudo-classes / pseudo-elements
    const rest = s.startsWith(b) ? s.slice(b.length) : null;
    if (rest === null) continue;
    if (rest === '' || /^(::?[\w-]+(\([^)]*\))?)+$/.test(rest)) {
      // `a` must not match `article`, `.dim` must not match `.dimmed`
      if (rest === '' || rest.startsWith(':')) return b;
    }
  }
  return null;
}

/** every bare base selector in a piece's rules: `selector → base` */
function offences(text: string): string[] {
  const seen = new Set<string>();
  for (const d of declarations(text).decls) {
    if (d.selector.startsWith('@')) continue;   // @font-face and friends
    if (d.at.some((a: string) => /^@keyframes/i.test(a))) continue;
    for (const one of splitList(d.selector)) {
      const b = bareBase(one);
      if (b) seen.add(`${one} (re-declares base ${b})`);
    }
  }
  return [...seen];
}

const pieces = readStylePieces();
const base = pieces.find(p => /^base\.css$/.test(p.piece));
const scoped = pieces.filter(p => /^(pages|shared)\//.test(p.piece));

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 every base selector this guard protects is really styled in base.css', () => {
  assert.ok(base, 'styles/base.css is a piece');
  const sels = declarations(base!.text).decls.map(d => d.selector).join('\n');
  for (const b of BASE) {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sels, new RegExp(`(^|[\\s(,])${esc}(?![\\w-])`, 'm'), `base.css styles ${b}`);
  }
});

test('§0 POSITIVE CONTROL: a bare base rule is caught, in context it is not', () => {
  const planted = [
    '.hint { color: red; }', 'h2 { margin: 0; }', 'a:hover { color: red; }', 'input, .x select { padding: 0; }',
    '@media (max-width: 600px) { .dim { opacity: .5; } }', 'textarea::placeholder { color: red; }', ':focus-visible { outline: 0; }',
  ];
  for (const css of planted) assert.equal(offences(css).length, 1, `caught: ${css}`);
  const fine = [
    '.acct .hint { color: red; }', '.x > h2 { margin: 0; }', 'tr.dim { opacity: .5; }', 'input.ttpilename { flex: 1; }',
    '.dimmed { color: red; }', 'article { margin: 0; }', 'h5 { margin: 0; }', '.lgcell:focus-visible { outline: 0; }',
    '.hintbox { color: red; }', 'a.lcard { color: red; }',
  ];
  for (const css of fine) assert.deepEqual(offences(css), [], `passes: ${css}`);
});

test('§0 the corpus is the real stylesheet: pages/ and shared/ pieces were read', () => {
  assert.ok(scoped.length >= 20, `${scoped.length} pages/shared pieces`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE GUARD
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 no pages/ or shared/ piece re-declares a base selector bare', () => {
  const bad = scoped.flatMap(p => offences(p.text).map(o => `${p.piece}: ${o}`));
  assert.deepEqual(bad, [],
    'A page piece styles a base selector for EVERY page. Scope it to the page (`.mypage .hint`), or, if every page should change, edit styles/base.css.');
});
