/* Every class the stylesheet styles is a class something draws.
 *
 * A rule for a class no markup carries is dead weight that reads as live: the
 * next reader keeps it in step with a design change, and a later page that
 * happens to reuse the name inherits a look nobody chose for it.
 *
 * Drawn = the class name appears as a word in a writer (the client's sources,
 * the stories, the rules renderer), or is built there from a prefix: `el-${e}`
 * or a regex replacement's `kw-$1` writes every class starting `el-` / `kw-`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStyles } from './read-styles.ts';
import { declarations } from '../scripts/css-scan.mjs';
import { CR_RENDER_MJS, STORYBOOK_DIR, UI_DIR } from '../../engine/scripts/paths.mjs';

/** helpers the design system defines ahead of their first user (base.css says so) */
const KEPT = new Set(['eyebrow']);

const SKIP_DIRS = new Set(['node_modules', 'test', 'styles', 'storybook-static', 'fonts', 'sfx', 'og']);
const WRITER_EXT = /\.(ts|mjs|js|html|json)$/;

function writersIn(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('bundle.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...writersIn(p)); }
    else if (WRITER_EXT.test(e.name)) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

/** every class a selector of `css` names */
function styledClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const sel of new Set(declarations(css).decls.map(d => d.selector))) {
    const bare = sel.replace(/\[[^\]]*\]/g, ' ');
    for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]!);
  }
  return out;
}

const esc = (s: string): string => s.replace(/[-]/g, '\\-');

/** is `cls` written in `blob`, whole or built from one of its prefixes? */
function drawn(cls: string, blob: string): boolean {
  if (new RegExp(`(^|[^\\w-])${esc(cls)}($|[^\\w-])`).test(blob)) return true;
  for (let k = 1; k < cls.length; k++) {
    if (new RegExp(`(^|[\\s"'\`])${esc(cls.slice(0, k))}(\\$\\{|\\$\\d)`).test(blob)) return true;
  }
  return false;
}

const deadIn = (css: string, blob: string): string[] =>
  [...styledClasses(css)].filter(c => !KEPT.has(c) && !drawn(c, blob)).sort();

const blob = [...writersIn(UI_DIR), ...writersIn(STORYBOOK_DIR), readFileSync(CR_RENDER_MJS, 'utf8')].join('\n');
const css = readStyles();

test('the stylesheet and its writers are read (positive control)', () => {
  const classes = styledClasses(css);
  assert.ok(classes.size > 1500, `${classes.size} classes styled`);
  assert.ok(classes.has('homecard') && drawn('homecard', blob), 'a literal class is found');
  assert.ok(classes.has('el-fire') && drawn('el-fire', blob), 'a class built from a prefix is found');
});

test('the check finds a class nothing draws, and is not fooled by a word ending in its prefix', () => {
  const probe = '.homecard { color: red; } .zzdead, .homecard .zzdead2 { margin: 0; } a[href$=".pdf"] { color: red; }';
  assert.deepEqual(deadIn(probe, blob + '\nIt moves on by itself${x}'), ['zzdead', 'zzdead2']);
  assert.equal(drawn('lfcol', 'It moves on by itself${x}'), false, '"itself${" does not build an lf… class');
});

test('every class the stylesheet styles is one the client draws', () => {
  assert.deepEqual(deadIn(css, blob), [], 'a rule for a class no markup carries: delete it, or draw the class');
});
