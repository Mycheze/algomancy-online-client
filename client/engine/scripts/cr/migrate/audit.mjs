/* COVERAGE AUDIT, DIGITAL-SCOPE LIST AND ABSORB DRY-RUN — step 1a/1b
 * measurement for the CR-only migration. READ-ONLY.
 *
 *   node client/engine/scripts/cr/migrate/audit.mjs   → data/comprehensive-rules/build/audit.json
 *
 * Needs build/rmap.json and build/census.json (--dump) first: run rmap.mjs, then
 * census.mjs --dump.
 *
 *   coverage   every ruling whose status is current / partly-superseded / narrowed
 *              and whose scope is game or digital that NO record cites in
 *              sources.rulings (history-only citers are reported beside it),
 *              with where client/ still cites it
 *   process    the process-scope rulings, with their client citations
 *   digital    main-document records that would get scope 'digital' under
 *              "cites any digital-scope ruling" (sources.rulings), with a
 *              heuristic flag for game rules that cite one incidentally
 *   absorb     owner-basis records: does each carry a ruling QUOTE (not a bare
 *              ref) that could become sources.owner[].quote; is the quote still
 *              verbatim in the ruling body
 *   dates      each ruling's adoption date: the first commit that added its
 *              `## R<n>` heading, over BOTH paths the register has lived at
 *              (digital-client/docs before the 2026-08-30 reorg, client/docs
 *              after), against the dates its own heading/body state */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_BUILD_DIR, REPO_ROOT, DIGITAL_RULES } from '../../paths.mjs';
import { parseRulings } from '../extract.mjs';
import { loadInputs } from '../render.mjs';
import { indexLedger, compareNums } from '../ledger.mjs';
import { parseRulingCite, norm } from '../schema.mjs';
import { RMAP_JSON } from './rmap.mjs';
import { CENSUS_JSON } from './census.mjs';

export const AUDIT_JSON = join(CR_BUILD_DIR, 'audit.json');
const LIVE = new Set(['current', 'partly-superseded', 'narrowed']);
/** the register's path before the 2026-08-30 reorg; git cannot --follow two paths in one -p walk */
const OLD_REGISTER = 'digital-client/docs/digital-rules.md';

/** ruling id → {date, commit} of the first commit adding its heading line */
export function headingDates() {
  const rel = DIGITAL_RULES.slice(REPO_ROOT.length + 1);
  const log = execFileSync('git', ['log', '--reverse', '-p', '--format=@@C %as %h', '--', OLD_REGISTER, rel],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  const first = {};
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@C ')) { const [, d, h] = line.split(' '); cur = { date: d, commit: h }; continue; }
    const m = /^\+## R(\d+)(b?)(?!\w)/.exec(line);
    if (m && cur) { const id = `R${Number(m[1])}${m[2]}`; first[id] ??= cur; }
  }
  return first;
}

export function runAudit() {
  const rmap = JSON.parse(readFileSync(RMAP_JSON, 'utf8'));
  const census = JSON.parse(readFileSync(CENSUS_JSON, 'utf8'));
  if (!census.rows) throw new Error('census.json has no rows: run census.mjs --dump');
  const R = rmap.rulings;
  const inputs = loadInputs();
  const I = indexLedger(inputs.ledger);
  const C = inputs.classification;
  const rulings = Object.fromEntries(parseRulings().map((r) => [r.id, r]));

  // client citations per ruling (excluding the register and the CR data)
  const cites = {};
  for (const row of census.rows) {
    if (!row.file.startsWith('client/') || row.area === 'register (deleted)' || row.fp) continue;
    const id = R[row.id] ? row.id : `R${row.n}`;
    (cites[id] ??= {})[row.file] = (cites[id][row.file] ?? 0) + 1;
  }
  const citeSummary = (id) => {
    const f = cites[id] ?? {};
    const files = Object.entries(f).sort((a, b) => b[1] - a[1]);
    return { n: files.reduce((a, [, k]) => a + k, 0), files: files.length, top: files.slice(0, 4).map(([p, k]) => `${p.replace(/^client\//, '')}×${k}`) };
  };

  // ── coverage ──
  const coverage = Object.values(R)
    .filter((r) => LIVE.has(r.status) && (r.scope === 'game' || r.scope === 'digital') && r.direct.n === 0)
    .map((r) => ({ id: r.id, status: r.status, scope: r.scope, title: r.title, summary: r.summary,
      historyCiters: r.history.hits.map((h) => h.num), clientCites: citeSummary(r.id) }));

  // ── process ──
  const process = Object.values(R).filter((r) => r.scope === 'process')
    .map((r) => ({ id: r.id, status: r.status, title: r.title, summary: r.summary, reason: C[r.id]?.reason ?? null,
      cited: r.direct.n, clientCites: citeSummary(r.id) }));

  // ── digital-scope ──
  const digitalIds = new Set(Object.entries(C).filter(([, v]) => v.scope === 'digital').map(([k]) => k));
  const digital = [];
  let digitalViaHistoryOnly = 0;
  for (const rec of inputs.records) {
    if (rec.key.startsWith('annexd.')) continue;
    const ids = (rec.sources.rulings ?? []).map((x) => parseRulingCite(typeof x === 'string' ? x : x.ref)?.id).filter(Boolean);
    const hids = (rec.sources.history ?? []).map((h) => parseRulingCite(h.ruling)?.id).filter(Boolean);
    const dig = [...new Set(ids.filter((i) => digitalIds.has(i)))];
    if (!dig.length) { if (hids.some((i) => digitalIds.has(i))) digitalViaHistoryOnly++; continue; }
    const game = [...new Set(ids.filter((i) => C[i]?.scope === 'game'))];
    const printed = (rec.sources.printed ?? []).length, designer = (rec.sources.designer ?? []).length;
    const reasons = [];
    if (printed) reasons.push(`printed×${printed}`);
    if (designer) reasons.push(`designer×${designer}`);
    if (game.length) reasons.push(`game rulings ${game.join(',')}`);
    if (['printed', 'designer', 'mixed'].includes(rec.basis)) reasons.push(`basis ${rec.basis}`);
    digital.push({ num: I.numOf(rec.key), key: rec.key, basis: rec.basis, digital: dig, text: rec.text.slice(0, 100),
      looksGame: reasons.length > 0, reasons });
  }
  digital.sort((a, b) => compareNums(a.num, b.num));

  // ── absorb ──
  const owner = inputs.records.filter((r) => r.basis === 'owner');
  const absorb = { owner: owner.length, withQuote: 0, bareOnly: [], noRulingAtAll: [], quoteNotVerbatim: [], multiRuling: 0, withOtherEvidence: 0 };
  for (const rec of owner) {
    const rs = rec.sources.rulings ?? [];
    const quoted = rs.filter((x) => typeof x === 'object' && x.quote);
    if (!rs.length) absorb.noRulingAtAll.push({ num: I.numOf(rec.key), key: rec.key, history: (rec.sources.history ?? []).map((h) => h.ruling) });
    else if (!quoted.length) absorb.bareOnly.push({ num: I.numOf(rec.key), key: rec.key, refs: rs.map((x) => (typeof x === 'string' ? x : x.ref)) });
    else absorb.withQuote++;
    const ids = new Set(rs.map((x) => parseRulingCite(typeof x === 'string' ? x : x.ref)?.id));
    if (ids.size > 1) absorb.multiRuling++;
    if ((rec.sources.printed ?? []).length || (rec.sources.designer ?? []).length) absorb.withOtherEvidence++;
    for (const q of quoted) {
      const id = parseRulingCite(q.ref)?.id;
      const body = rulings[id] ? norm(rulings[id].heading + '\n' + rulings[id].body) : '';
      if (!body.includes(norm(q.quote))) absorb.quoteNotVerbatim.push({ key: rec.key, ref: q.ref, quote: q.quote.slice(0, 80) });
    }
  }
  // all-record view too (the plan drops sources.rulings from every record, not only owner ones)
  const allBare = inputs.records.filter((r) => (r.sources.rulings ?? []).some((x) => typeof x === 'string' || !x.quote)).length;

  // ── dates ──
  const git = headingDates();
  const dates = {};
  for (const id of Object.keys(R)) {
    const r = rulings[id];
    const headDates = r.heading.match(/\b20\d\d-\d\d-\d\d\b/g) ?? [];
    dates[id] = { git: git[id] ?? null, heading: headDates[0] ?? null, bodyEarliest: r.dates[0] ?? null, bodyLatest: r.dates.at(-1) ?? null };
  }
  const dateStats = {
    rulings: Object.keys(dates).length,
    gitFound: Object.values(dates).filter((d) => d.git).length,
    headingHasDate: Object.values(dates).filter((d) => d.heading).length,
    bodyHasDate: Object.values(dates).filter((d) => d.bodyEarliest).length,
    gitOnReorgDay: Object.values(dates).filter((d) => d.git?.date === '2026-08-30').length,
  };
  return { coverage, process, digital, digitalViaHistoryOnly, absorb: { ...absorb, allRecordsWithABareCite: allBare }, dates, dateStats };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = runAudit();
  writeFileSync(AUDIT_JSON, JSON.stringify(a, null, 1) + '\n');
  console.log(JSON.stringify({
    coverage: a.coverage.length, process: a.process.length,
    digital: a.digital.length, digitalLooksGame: a.digital.filter((d) => d.looksGame).length, digitalViaHistoryOnly: a.digitalViaHistoryOnly,
    absorb: { owner: a.absorb.owner, withQuote: a.absorb.withQuote, bareOnly: a.absorb.bareOnly.length, noRulingAtAll: a.absorb.noRulingAtAll.length,
      quoteNotVerbatim: a.absorb.quoteNotVerbatim.length, multiRuling: a.absorb.multiRuling, withOtherEvidence: a.absorb.withOtherEvidence,
      allRecordsWithABareCite: a.absorb.allRecordsWithABareCite },
    dateStats: a.dateStats,
  }, null, 1));
  console.log(`wrote ${AUDIT_JSON}`);
}
