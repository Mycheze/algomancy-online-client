/* CHECK A DECISIONS FILE — simulate recite in memory for the ids one file decides.
 *
 *   node client/engine/scripts/cr/migrate/run.mjs --check-decisions <file.json> [--rescore] [--json]
 *
 * Every decision layer in decisions/ is loaded, then <file.json> on top (it wins by id),
 * and recite runs WITHOUT writing anything, over this checkout's build/cites.json (the
 * register-era citation table; --rescore rebuilds it first, ~20 s). For each id the file
 * decides it prints: applied / unapplied (why) / self-check failure, the original line
 * and the line as recite leaves it. An id not in the citation table is reported as
 * `unknown id` (the line changed since, or a typo). Exit 1 if any id did not apply cleanly. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../../paths.mjs';
import { recite, loadDecisions, mapRange } from './recite.mjs';

export async function checkDecisions(file, { rescore = false } = {}) {
  const { CITES_JSON, score } = await import('./score.mjs');
  let cites;
  if (rescore || !existsSync(CITES_JSON)) { const { out } = score({}); cites = { rows: out }; }
  else cites = JSON.parse(readFileSync(CITES_JSON, 'utf8'));
  const extra = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const D = loadDecisions();
  for (const [id, d] of Object.entries(extra.decisions ?? {})) D.set(id, { ...d, unit: extra.unit ?? file });
  const man = JSON.parse(readFileSync(new URL('./hand/manifest.json', import.meta.url), 'utf8')).files;
  const skipFiles = Object.entries(man).filter(([, e]) => (e.owned || e.op === 'delete') && (e.step ?? 'hand') === 'hand').map(([p]) => p);
  const { report, after, before, editsOf, consumed } = recite({ cites, decisions: D, dryRun: true, skipFiles });
  const byId = new Map(cites.rows.map((r) => [r.id, r]));
  const why = new Map();
  for (const x of report.leave) why.set(x.id, `left: ${x.why}`);
  for (const x of report.dropUnapplied) why.set(x.id, `unapplied ${x.kind}: no grammatical removal / overlaps`);
  for (const x of report.rewordUnapplied) why.set(x.id, `unapplied reword: ${x.why}`);
  const results = [];
  for (const id of Object.keys(extra.decisions ?? {})) {
    const r = byId.get(id);
    if (!r) { results.push({ id, status: 'unknown id', why: 'not in the citation table (line changed since the census, or a typo)' }); continue; }
    if (skipFiles.includes(r.file)) { results.push({ id, file: r.file, status: 'hand-owned', why: 'the hand step rewrites this file whole; tell the migration driver instead' }); continue; }
    const res = { id, file: r.file, line: r.line, original: r.line ? (before.get(r.file) ?? readFileSync(`${REPO_ROOT}/${r.file}`, 'utf8')).split('\n')[r.line - 1] : r.context?.text };
    // the line as recite leaves it: map the row's offset through the file's edits
    const old = before.get(r.file), neu = after.get(r.file), es = editsOf.get(r.file);
    if (r.line && old && neu && es) {
      const offs = old.split('\n').slice(0, r.line - 1).reduce((a, l) => a + l.length + 1, 0);
      const [na] = mapRange(es, offs, offs);
      const ls = neu.lastIndexOf('\n', na - 1) + 1, le = neu.indexOf('\n', na);
      res.result = neu.slice(ls, le < 0 ? undefined : le);
    }
    const sc = report.selfCheck.filter((x) => x.file === r.file && res.result !== undefined && neu && Math.abs(x.line - (neu.slice(0, neu.indexOf(res.result)).split('\n').length)) <= 1);
    const broken = (report.shapeBroken ?? []).find((x) => x.file === r.file);
    if (broken) { res.status = 'code-shape broken'; res.why = `the file's code would change, not just its comments and strings (a join or quote added/removed?): ${broken.at}`; res.result = undefined; }
    else if (why.has(id)) { res.status = 'unapplied'; res.why = why.get(id); }
    else if (sc.length) { res.status = 'self-check failure'; res.why = sc.map((x) => x.why).join('; '); }
    else if (consumed.has(id)) res.status = 'applied';
    else { res.status = 'unapplied'; res.why = 'no edit made (a skip/binding row, or the line was not reached)'; }
    results.push(res);
  }
  return results;
}

export function printResults(results, json = false) {
  if (json) { console.log(JSON.stringify(results, null, 1)); return; }
  const tally = {};
  for (const r of results) {
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log(`${r.status.toUpperCase().padEnd(18)} ${r.id}${r.why ? `\n  why: ${r.why}` : ''}${r.original !== undefined ? `\n  - ${String(r.original).trim().slice(0, 220)}` : ''}${r.result !== undefined ? `\n  + ${String(r.result).trim().slice(0, 220)}` : ''}`);
  }
  console.log(JSON.stringify(tally));
}
