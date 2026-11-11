/*
 * 1030 · THE MANUAL'S PALETTE — one scheme, all dark, and the old gold and green gone
 *
 * Owner, 2026-11-03: "Let's change the color scheme to match the official rule
 * PDF rather than this yellow and green nonsense we have going on", and "The
 * comprehensive rules is light mode and the rest of the app is dark mode, for
 * some reason. Let's keep it all dark for now."
 *
 * The rulebook (data/rules/Algomancy-Manual.pdf) is a deep purple page, white
 * text, lavender-grey muted text, and ONE accent: the orange of its headings
 * and NOTE boxes. tokens.css carries that at the role level, so every page
 * follows it. This file holds the pieces a later edit could quietly undo:
 *
 *   §1  the roles are the Manual's: the panel is its page, the accent AND the
 *       filled primary are its orange (the primary was a green), the page under
 *       a panel is darker than the panel
 *   §2  every text role clears WCAG AA (4.5:1) on every surface it sits on,
 *       and the primary's label is dark ink (white on the orange is 2.4:1)
 *   §3  no page, shared piece, component or the base reintroduces the old gold
 *       accent, the old green fill or the tabletop's green felt, nor paints a
 *       page with the board's targeting gold (--target)
 *   §4  the comprehensive rules are dark wherever they are shown: render.mjs
 *       writes the document dark whatever the reader's system prefers, in the
 *       client's own colours, and the committed page was re-rendered with it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { declarations } from '../scripts/css-scan.mjs';
import { readStylePieces } from './read-styles.ts';
import { CR_DOC_HTML, REPO_ROOT } from '../../engine/scripts/paths.mjs';

const MANUAL = { page: '#3e1d52', orange: '#f68c3f' };

/** declarations with their values (css-scan gives offsets; masking keeps them, so they index the source) */
const decls = (text: string) => declarations(text).decls.map(d => ({ ...d, value: text.slice(d.start, d.end) }));

const pieces = readStylePieces();
const tokensText = pieces.find(p => /(^|\/)tokens\.css$/.test(p.piece))!.text;
const TOK = new Map(decls(tokensText).filter(d => d.selector === ':root')
  .map(d => [d.prop, d.value.trim().toLowerCase()] as const));
const tok = (name: string): string => {
  const v = TOK.get(name);
  assert.ok(v, `${name} is not defined on :root in tokens.css`);
  return v!;
};

/* ── WCAG 2 relative luminance and contrast ── */
const rgb = (hex: string): number[] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is not a #rrggbb colour`);
  return [0, 2, 4].map(i => parseInt(m![1]!.slice(i, i + 2), 16));
};
const lum = (hex: string): number => {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/* ════════════════════════════════════════════════════════════════════════ */

test('§0 non-vacuity: the token map is read, and the contrast maths is WCAG\'s', () => {
  assert.ok(TOK.size >= 60, `only ${TOK.size} :root declarations read from tokens.css`);
  assert.equal(contrast('#ffffff', '#000000').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

test('§1 the roles are the Manual\'s: its page is the panel, its orange the accent and the primary', () => {
  assert.equal(tok('--color-surface'), MANUAL.page, 'a panel is the Manual\'s page colour');
  assert.equal(tok('--color-accent'), MANUAL.orange, 'the accent is the Manual\'s orange');
  assert.equal(tok('--color-confirm'), MANUAL.orange,
    'the filled primary (button.primary) is the same orange — it was a green; one accent, not two');
  assert.ok(lum(tok('--color-bg')) < lum(tok('--color-surface')), 'the page is darker than a panel, so a panel reads as raised');
  assert.ok(lum(tok('--color-surface-sunken')) < lum(tok('--color-bg')), 'a well is below the page');
  for (const n of ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-sunken']) {
    const [r, g, b] = rgb(tok(n));
    assert.ok(b! > g! && r! > g!, `${n} ${tok(n)} is a purple (red and blue over green), not a grey or a navy`);
    assert.ok(lum(tok(n)) < 0.06, `${n} ${tok(n)} is dark: "keep it all dark"`);
  }
});

test('§2 every text role clears AA (4.5:1) on every surface it sits on; the primary\'s label is dark ink', () => {
  const surfaces = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-sunken'];
  const fails: string[] = [];
  const need = (fg: string, bg: string, min = 4.5): void => {
    const c = contrast(tok(fg), tok(bg));
    if (c < min) fails.push(`${fg} ${tok(fg)} on ${bg} ${tok(bg)}: ${c.toFixed(2)} < ${min}`);
  };
  for (const fg of ['--color-text', '--color-text-muted', '--color-accent', '--color-link',
    '--color-success', '--color-warning', '--color-info']) for (const bg of surfaces) need(fg, bg);
  // red text sits on the page and on panels; on a raised panel (a danger button's label) it is
  // 3.95 (it was 3.88). Any lighter and white on a red badge (the bell's count, a damage chip)
  // goes under 3:1, the floor for its bold figures — the record's table has both. (Those fills
  // read --color-danger-fill since BL-51, the same red here; the accessible mode lifts the text.)
  for (const bg of ['--color-bg', '--color-surface', '--color-surface-sunken']) need('--color-danger', bg);
  need('--color-text-on-fill', '--color-danger-fill', 3);
  need('--color-text-on-accent', '--color-accent');
  need('--color-text-on-accent', '--color-confirm');
  need('--color-text-on-accent', '--color-confirm-hover');
  for (const [fg, bg] of [['--color-accent', '--color-accent-wash'], ['--color-success', '--color-success-bg'],
    ['--color-warning', '--color-warning-bg'], ['--color-danger', '--color-danger-bg'], ['--color-info', '--color-info-bg']] as const) need(fg, bg);
  assert.deepEqual(fails, [], 'a text role under AA:\n  ' + fails.join('\n  '));

  // the orange fill takes dark ink wherever a primary is drawn
  const base = pieces.find(p => /(^|\/)base\.css$/.test(p.piece))!.text;
  const button = pieces.find(p => /components\/button\.css$/.test(p.piece))!.text;
  assert.match(base, /button\.primary\s*\{[^}]*\bcolor:\s*var\(--color-text-on-accent\)/, 'button.primary has dark ink');
  assert.match(button, /\.ui-button--primary\s*\{[^}]*\bcolor:\s*var\(--color-text-on-accent\)/, '.ui-button--primary has dark ink');
});

/* the old palette's literals: the gold accent and its tints, the green fill and its border and
   hover, the felt — any spelling a page could reach for */
const OLD = [
  /#d9a441\b/i, /rgba?\(\s*217\s*,\s*164\s*,\s*65\b/, /#3c5a2f\b/i, /#5b8747\b/i, /#476b37\b/i,
  /#e0b93c\b/i, /rgba?\(\s*224\s*,\s*185\s*,\s*60\b/, /#2a2314\b/i, /#141f1b\b/i, /#172520\b/i, /#1e3029\b/i,
  /rgba?\(\s*23\s*,\s*37\s*,\s*32\b/,
];
const PAGEISH = (piece: string): boolean => /(^|\/)base\.css$/.test(piece) || /^(pages|shared|components)\//.test(piece);

test('§3 no page, shared piece, component or the base brings back the old gold or green, or paints with --target', () => {
  const scoped = pieces.filter(p => PAGEISH(p.piece));
  assert.ok(scoped.length >= 30, `only ${scoped.length} page-side pieces found`);
  const hits: string[] = [];
  for (const { piece, text } of scoped) {
    for (const d of decls(text)) {
      for (const re of OLD) if (re.test(d.value)) hits.push(`${piece}: ${d.selector} { ${d.prop}: ${d.value.trim()} }`);
      // --target is the BOARD's "targeting" gold, a game role; off the board the accent says "look here"
      if (/var\(\s*--target\b/.test(d.value)) hits.push(`${piece}: ${d.selector} { ${d.prop} } reads --target`);
    }
  }
  assert.deepEqual(hits, [], 'the old palette on a page (use a role from tokens.css):\n  ' + hits.join('\n  '));
});

/** the first `:root { … }` block of render.mjs's CSS — the document's screen palette */
const rootVars = (css: string): Map<string, string> => {
  const m = /:root\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'no :root block');
  return new Map([...m![1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(x => [x[1]!, x[2]!.trim().toLowerCase()] as const));
};

test('§4 the comprehensive rules are dark whatever the reader prefers, in the client\'s colours', () => {
  const src = readFileSync(join(REPO_ROOT, 'client', 'engine', 'scripts', 'cr', 'render.mjs'), 'utf8');
  const html = readFileSync(CR_DOC_HTML, 'utf8');
  for (const [what, text] of [['render.mjs', src], ['the committed Algomancy-Comprehensive-Rules.html', html]] as const) {
    assert.doesNotMatch(text, /prefers-color-scheme/, `${what}: the palette must not hang on the reader's system setting`);
    const v = rootVars(text);
    const same: [string, string][] = [['--bg', '--color-bg'], ['--surface', '--color-surface'], ['--fg', '--color-text'],
      ['--muted', '--color-text-muted'], ['--line', '--color-border'], ['--accent', '--color-info'],
      ['--accent-soft', '--color-info-bg'], ['--mark', '--color-accent']];
    for (const [doc, role] of same) assert.equal(v.get(doc), tok(role), `${what}: ${doc} is the client's ${role}`);
    assert.match(text, /:root\s*\{[^}]*color-scheme:\s*dark/, `${what}: the document says it is dark (its scrollbars, its controls)`);
  }
  // the review page shows the same document under .crdoc, on the roles themselves
  const review = pieces.find(p => /pages\/\d+-crreview\.css$/.test(p.piece))!.text;
  const crdoc = decls(review).filter(d => d.selector === '.crdoc');
  const val = (prop: string): string | undefined => crdoc.find(d => d.prop === prop)?.value.trim();
  for (const [doc, role] of [['--fg', '--color-text'], ['--muted', '--color-text-muted'], ['--surface', '--color-surface'], ['--mark', '--color-accent']] as const)
    assert.equal(val(doc), `var(${role})`, `.crdoc ${doc} reads ${role}`);
});
