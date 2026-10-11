/* THE LEFTOVERS — every citation recite could not rewrite, as work lists.
 *
 *   node client/engine/scripts/cr/migrate/leftovers.mjs <out dir>
 *     → <out dir>/{nodecision,drop,reword,selfcheck}.json
 * Each row: id, file, line, the original line text, the current decision (if any)
 * and why it could not apply. Simulates recite in memory (all decision layers);
 * writes nothing in the tree. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recite, loadDecisions } from './recite.mjs';
import { CITES_JSON } from './score.mjs';
import { REPO_ROOT } from '../../paths.mjs';

const out = resolve(process.argv[2] ?? '.');
mkdirSync(out, { recursive: true });
const cites = JSON.parse(readFileSync(CITES_JSON, 'utf8'));
const D = loadDecisions();
// files the hand step owns whole are written by hand, citations included: not leftovers
const man = JSON.parse(readFileSync(new URL('./hand/manifest.json', import.meta.url), 'utf8')).files;
const skipFiles = Object.entries(man).filter(([, e]) => (e.owned || e.op === 'delete') && (e.step ?? 'hand') === 'hand').map(([p]) => p);
const { report } = recite({ cites, decisions: D, dryRun: true, skipFiles });
const byId = new Map(cites.rows.map((r) => [r.id, r]));
const text = new Map();
const lineOf = (file, ln) => { if (!text.has(file)) text.set(file, readFileSync(join(REPO_ROOT, file), 'utf8').split('\n')); return text.get(file)[ln - 1]; };
const row = (id, why) => {
  const r = byId.get(id) ?? {};
  const d = D.get(id);
  return { id, file: r.file, line: r.line, ruling: r.ruling, original: r.line ? lineOf(r.file, r.line) : r.context?.text, decision: d ? { ...d, unit: undefined, source: d.unit } : null, scriptPick: r.pick ?? r.proposed ?? null, method: r.method, why };
};
const lists = {
  nodecision: report.leave.map((x) => row(x.id, x.why)),
  drop: report.dropUnapplied.map((x) => row(x.id, `no grammatical removal found for a ${x.kind}`)),
  reword: report.rewordUnapplied.map((x) => row(x.id, x.why)),
  selfcheck: report.selfCheck.map((x) => ({ file: x.file, line: x.line, why: x.why, text: x.text, ids: cites.rows.filter((r) => r.file === x.file && r.line && Math.abs(r.line - x.line) <= 2).map((r) => r.id) })),
};
for (const [k, v] of Object.entries(lists)) writeFileSync(join(out, `${k}.json`), JSON.stringify({ count: v.length, rows: v }, null, 1) + '\n');
console.log(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])));
