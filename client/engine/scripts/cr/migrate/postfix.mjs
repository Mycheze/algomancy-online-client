/* POSTFIX — exact corrections to the MIGRATED text, after recite and the hand step.
 *
 * decisions/postfix-*.json (in file-name order):
 *   {"edits": [{"file": "<repo path>", "find": "<exact text>", "replace": "<text>", "why": "…",
 *               "code"?: true, "step"?: "delete"}]}
 *
 * `find` is an exact substring of the file AS THE RUN LEFT IT (not a regex) and must occur
 * exactly once there, after the earlier edits to the same file; a missing or repeated find
 * fails the run and nothing is written. `step: "delete"` defers the edit until after the
 * delete step's merges (the docs it rewrites); otherwise it runs in the main run, after the
 * hand step and before rebind, so a retitled test's bindings can follow it (rebind.json).
 *
 * The same guards as recite: a .ts/.mts file must still parse (esbuild), and a script's code
 * shape (everything but comments and string contents, test titles included) must not change.
 * An edit flagged `"code": true` is the exception — a repair of code the migration broke —
 * and is checked for parsing only; every one is listed in the run log. (The shape check sees
 * tokens, not string contents: code spliced INTO a string, like 276's QUIET, passes it; the
 * flag is how such a repair is declared, not something the check enforces.) */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../../paths.mjs';
import { codeShape } from './recite.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
let esbuildTransform = null;
try { esbuildTransform = createRequire(join(REPO_ROOT, 'client/engine/package.json'))('esbuild').transformSync; } catch { esbuildTransform = null; }

export function loadPostfix(dir = join(HERE, 'decisions')) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => /^postfix-.*\.json$/.test(x)).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const [i, e] of (j.edits ?? []).entries()) {
      if (typeof e.file !== 'string' || typeof e.find !== 'string' || typeof e.replace !== 'string' || !e.find) throw new Error(`${f} edit ${i}: needs file, a non-empty find and replace`);
      out.push({ ...e, src: `${f}#${i}` });
    }
  }
  return out;
}

const count = (t, s) => { let n = 0; for (let i = t.indexOf(s); i >= 0; i = t.indexOf(s, i + 1)) n++; return n; };
const parses = (rel, t) => {
  if (!esbuildTransform || !/\.(ts|mts)$/.test(rel)) return null;
  try { esbuildTransform(t, { loader: 'ts', logLevel: 'silent' }); return null; } catch (e) { return String(e.message ?? e).split('\n').slice(0, 2).join(' '); }
};

/** apply the postfix edits for `step` ('postfix' | 'delete'); throws, writing nothing, on any problem */
export function postfix({ step = 'postfix', root = REPO_ROOT, dir } = {}) {
  const edits = loadPostfix(dir).filter((e) => (e.step ?? 'postfix') === step);
  const byFile = new Map();
  for (const e of edits) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)).push(e);
  const problems = [], writes = [], codeEdits = [];
  for (const [rel, es] of byFile) {
    const abs = join(root, rel);
    if (!existsSync(abs)) { problems.push(`${rel}: no such file (${es.map((e) => e.src).join(', ')})`); continue; }
    const t0 = readFileSync(abs, 'utf8');
    // comment/string edits first, under the code-shape guard; then the flagged code repairs
    let t = t0;
    const apply = (e) => {
      const n = count(t, e.find);
      if (n !== 1) { problems.push(`${rel}: ${e.src} find occurs ${n}× (wants exactly 1): ${JSON.stringify(e.find.slice(0, 80))}`); return; }
      t = t.replace(e.find, () => e.replace);
    };
    for (const e of es.filter((x) => !x.code)) apply(e);
    if (/\.(ts|mts|mjs|js)$/.test(rel) && codeShape(t0) !== codeShape(t)) problems.push(`${rel}: a postfix edit not flagged "code" changes code`);
    for (const e of es.filter((x) => x.code)) { apply(e); codeEdits.push({ file: rel, src: e.src, why: e.why ?? '', find: e.find, replace: e.replace }); }
    const pe = parses(rel, t);
    if (pe) problems.push(`${rel}: does not parse after postfix: ${pe}`);
    writes.push([abs, t, es.length]);
  }
  if (problems.length) throw Object.assign(new Error(`postfix (${step}): ${problems.length} problem(s)\n  ${problems.join('\n  ')}`), { problems });
  for (const [abs, t] of writes) writeFileSync(abs, t);
  return { step, edits: edits.length, files: writes.length, codeEdits };
}
