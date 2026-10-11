/* PROOF OF NO BEHAVIOUR CHANGE — plan 1f.
 *
 *   node client/engine/scripts/cr/migrate/proof.mjs --after <migrated tree> [--before <tree>]
 *
 * Bundles the engine, the browser client and the game server with esbuild
 * (comments stripped, whitespace minified, identifiers kept, no legal
 * comments) from the tree before the migration and the tree after it, then
 * compares the two bundles TOKEN BY TOKEN with the repo's JS tokenizer:
 *   · every code token must be identical (same identifiers, operators, numbers,
 *     in the same order) — a comment rewrite cannot change behaviour;
 *   · every string literal that differs is listed, old → new, and tagged
 *     `visible` when visible.json wrote it (the intended player-visible edits).
 * Exit 1 when a code token differs, or a string differs that visible.json did
 * not write — those are listed for a human to clear (a rewritten citation inside
 * a log line or an error message is a string change a player or the owner may see).
 * --before defaults to this checkout (the register-era tree). Writes
 * build/migrate/proof.json. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, CR_BUILD_DIR } from '../../paths.mjs';
import { tokenize } from '../extract-test-titles.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
export const BUNDLES = [
  { name: 'engine', entry: 'client/engine/src/index.ts', platform: 'neutral' },
  { name: 'ui', entry: 'client/ui/main.ts', platform: 'browser' },
  { name: 'server', entry: 'client/server/main.ts', platform: 'node' },
];

function bundle(root, b, out) {
  const esbuild = join(REPO_ROOT, 'client/engine/node_modules/.bin/esbuild');
  execFileSync(esbuild, [join(root, b.entry), '--bundle', `--platform=${b.platform}`, '--format=esm', '--packages=external',
    '--minify-whitespace', '--legal-comments=none', '--charset=utf8', '--log-level=error', '--loader:.json=json', `--outfile=${out}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return readFileSync(out, 'utf8');
}

export function compare(before, after, visibleTexts = []) {
  const A = tokenize(before), B = tokenize(after);
  const isStr = (t) => t.t === 'str' || t.t === 'tmpl';
  const codeA = A.filter((t) => !isStr(t)), codeB = B.filter((t) => !isStr(t));
  const codeDiffs = [];
  for (let i = 0; i < Math.max(codeA.length, codeB.length); i++) {
    if (codeA[i]?.v !== codeB[i]?.v || codeA[i]?.t !== codeB[i]?.t) { codeDiffs.push({ at: i, before: codeA[i]?.v, after: codeB[i]?.v, near: before.slice(Math.max(0, (codeA[i]?.s ?? 0) - 60), (codeA[i]?.s ?? 0) + 60) }); if (codeDiffs.length > 20) break; }
  }
  const sA = A.filter(isStr), sB = B.filter(isStr);
  const strings = [];
  if (sA.length !== sB.length) codeDiffs.push({ at: -1, before: `${sA.length} strings`, after: `${sB.length} strings` });
  else for (let i = 0; i < sA.length; i++) {
    if (sA[i].v === sB[i].v) continue;
    const neu = sB[i].v;
    strings.push({ before: sA[i].v.slice(0, 300), after: neu.slice(0, 300), visible: visibleTexts.some((v) => v && neu.includes(v)) });
  }
  return { codeDiffs, strings, sizes: [before.length, after.length] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const after = arg('--after');
  if (!after) { console.error('usage: proof.mjs --after <migrated tree> [--before <tree>]'); process.exit(2); }
  const before = arg('--before') ?? REPO_ROOT;
  const dir = join(CR_BUILD_DIR, 'migrate', 'proof');
  mkdirSync(dir, { recursive: true });
  const vis = existsSync(join(HERE, 'visible.json')) ? JSON.parse(readFileSync(join(HERE, 'visible.json'), 'utf8')).entries : [];
  // a visible edit's replacement, unquoted, is what a changed string will contain
  const visibleTexts = vis.map((v) => v.replace.replace(/^[\s'"`(]+|['"`),\s]+$/g, '').replace(/\\'/g, "'").replace(/\\n/g, '\n').split(/'\s*\n\s*\+\s*'/)[0]);
  const report = {};
  let bad = 0;
  for (const b of BUNDLES) {
    const x = bundle(resolve(before), b, join(dir, `before-${b.name}.js`));
    const y = bundle(resolve(after), b, join(dir, `after-${b.name}.js`));
    const r = compare(x, y, visibleTexts);
    report[b.name] = { identical: x === y, codeDiffs: r.codeDiffs, stringsChanged: r.strings.length, visible: r.strings.filter((s) => s.visible).length, unlisted: r.strings.filter((s) => !s.visible), sizes: r.sizes };
    bad += r.codeDiffs.length + r.strings.filter((s) => !s.visible).length;
  }
  writeFileSync(join(CR_BUILD_DIR, 'migrate', 'proof.json'), JSON.stringify(report, null, 1) + '\n');
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v.identical ? 'byte-identical' : `${v.codeDiffs.length} code token difference(s), ${v.stringsChanged} string(s) changed (${v.visible} from visible.json, ${v.unlisted.length} not)`}`);
  console.log(`wrote ${join(CR_BUILD_DIR, 'migrate', 'proof.json')}`);
  process.exit(bad ? 1 : 0);
}
