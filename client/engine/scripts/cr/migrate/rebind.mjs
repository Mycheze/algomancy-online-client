/* REBIND — after the hand step, every test binding still names a real test.
 *
 *   node client/engine/scripts/cr/migrate/rebind.mjs [--dry-run]
 *
 * recite moves a binding with its title when IT renamed the title. A file the
 * hand step owns whole (184, 177, 238, 409 …) is rewritten after recite, so a
 * binding into it (a CR example, a ledger guard) can be left pointing at a
 * title that is gone. This pass finds every such binding and re-points it:
 *   1. rebind.json, hand-written: {"<file>::<old needle>": "<new needle>"} for a
 *      title whose WORDS the rewrite changed;
 *   2. otherwise the old needle with its citation taken out ("R248: a row the
 *      pool prints…" → "a row the pool prints…"), when that names a title;
 *      a CR example binds the WHOLE title (it must match exactly one).
 * Anything still unresolved is reported, never guessed. */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, CR_RULES_DIR } from '../../paths.mjs';
import { tokenize } from '../extract-test-titles.mjs';
import { titlesOf, unescapeJs } from './recite.mjs';
import { indentOf } from './util.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REBIND_JSON = join(HERE, 'rebind.json');
const TEST_DIRS = ['client/engine/test', 'client/ui/test', 'client/server/test', 'client/server/e2e'];
const CITE = /\s*\(?\b(?:CR (?:\d{3}|D\d+)(?:\.\d+[a-z]*)?(?:,\s(?:\d{3}|D\d+)(?:\.\d+[a-z]*)?)*|\[?R\d{1,3}b?\]?(?:\s?[/+]\s?R\d{1,3}b?)*(?:\s?\(?(?:its\s)?§\s?\d+[a-z]?\)?)?)\)?/g;
const uncite = (s) => s.replace(CITE, ' ').replace(/\s+/g, ' ').replace(/^[\s:—–·|-]+/, '').trim();

function walk(rel, out = []) {
  for (const n of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name.startsWith('.')) continue;
    const p = `${rel}/${n.name}`;
    if (n.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function rebind({ dryRun = false } = {}) {
  const titles = new Map(); // basename → [title]
  for (const d of TEST_DIRS) {
    if (!existsSync(join(REPO_ROOT, d))) continue;
    for (const f of walk(d).filter((x) => /\.(ts|mts|mjs)$/.test(x))) {
      try { titles.set(basename(f), titlesOf(tokenize(readFileSync(join(REPO_ROOT, f), 'utf8'))).map((t) => t.title)); } catch { /* not a test file */ }
    }
  }
  const explicit = existsSync(REBIND_JSON) ? JSON.parse(readFileSync(REBIND_JSON, 'utf8')).map ?? {} : {};
  const out = { rewritten: 0, explicit: 0, unresolved: [], files: [] };
  // only bindings INTO a file the hand step owns are this pass's business (recite moved the rest)
  const man = existsSync(join(HERE, 'hand/manifest.json')) ? JSON.parse(readFileSync(join(HERE, 'hand/manifest.json'), 'utf8')).files : {};
  const owned = new Set(Object.entries(man).filter(([, e]) => e.owned || e.op === 'delete').map(([p]) => basename(p)));
  const hits = (file, needle) => (titles.get(file) ?? []).filter((t) => t.includes(needle));
  /** → the needle to use, or null when nothing names a title; `exact`: bind the whole title */
  const fix = (file, needle, exact) => {
    const n = hits(file, needle).length;
    if (exact ? n === 1 : n >= 1) return needle;
    if (!owned.has(file)) return needle; // recite's business, not this pass's
    if (!titles.has(file)) return null;  // a deleted test: whatever bound to it must be re-pointed by hand
    const ex = explicit[`${file}::${needle}`];
    if (ex !== undefined) { out.explicit++; const h = hits(file, ex); return exact ? (h.length === 1 ? (h[0] === ex ? ex : h[0]) : null) : (h.length ? ex : null); }
    const u = uncite(needle);
    if (u && u !== needle) {
      const h = hits(file, u);
      if (exact ? h.length === 1 : h.length >= 1) return exact ? h[0] : u;
    }
    return null;
  };
  // client/ code and docs: string literals `<file>.test.ts::<needle>`
  const BIND = /(['"`])(\d{1,3}-[\w.-]+\.test\.ts)::((?:\\.|(?!\1).)*)\1/g;
  for (const rel of walk('client').filter((f) => /\.(ts|mts|mjs|js|md)$/.test(f) && !f.startsWith('client/engine/scripts/cr/migrate/') && f !== 'client/docs/digital-rules.md' && !owned.has(basename(f)))) {
    const t0 = readFileSync(join(REPO_ROOT, rel), 'utf8');
    if (!t0.includes('.test.ts::')) continue;
    let changed = false;
    const t1 = t0.replace(BIND, (all, q, file, raw) => {
      const needle = unescapeJs(raw);
      const neu = fix(file, needle, false);
      if (neu === null) { out.unresolved.push(`${rel}: ${file}::${needle.slice(0, 90)}`); return all; }
      if (neu === needle) return all;
      changed = true; out.rewritten++;
      const esc = neu.replace(/\\/g, '\\\\').split(q).join(`\\${q}`);
      return `${q}${file}::${esc}${q}`;
    });
    if (changed) { out.files.push(rel); if (!dryRun) writeFileSync(join(REPO_ROOT, rel), t1); }
  }
  // the CR records' example bindings
  for (const f of readdirSync(CR_RULES_DIR).filter((x) => x.endsWith('.json'))) {
    const abs = join(CR_RULES_DIR, f);
    const text = readFileSync(abs, 'utf8');
    const rows = JSON.parse(text);
    let changed = false;
    for (const r of rows) for (const ex of r.examples ?? []) {
      if (!ex?.test || !ex.test.includes('::')) continue;
      const [file, ...rest] = ex.test.split('::');
      const needle = rest.join('::');
      const neu = fix(file, needle, true);
      if (neu === null) { out.unresolved.push(`${f} ${r.key}: ${ex.test.slice(0, 110)}`); continue; }
      if (neu !== needle) { ex.test = `${file}::${neu}`; changed = true; out.rewritten++; }
    }
    if (changed) { out.files.push(relative(REPO_ROOT, abs)); if (!dryRun) writeFileSync(abs, JSON.stringify(rows, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '')); }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(rebind({ dryRun: process.argv.includes('--dry-run') }), null, 1));
}
