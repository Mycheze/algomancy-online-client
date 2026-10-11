/* CITATION SCORING — step 1c of the CR-only migration. For every live `R<n>`
 * citation the census finds, pick the CR rule it should cite instead, or say
 * that nobody can pick it mechanically.
 *
 *   node client/engine/scripts/cr/migrate/score.mjs [--threshold 0.9] [--sample 1 | --validate]
 *     → data/comprehensive-rules/build/cites.json   one row per citation occurrence
 *     → data/comprehensive-rules/build/units.json   the unresolved ones, grouped by ruling into
 *                                                   agent units (5–15 rulings, ~420 citations)
 *     --sample 1   build/sample.json: picks stratified by decider and confidence band, to label
 *     --validate   build/sample.json: a fresh sample of AUTO picks not yet labelled
 *     build/calibration.json (hand labels, if present) is scored against the current picks.
 *
 * READ-ONLY over the committed tree. Re-runnable on any checkout: it rebuilds
 * rmap.json first, then takes the census rows (census.mjs) and re-reads the
 * records, so a record added since the last run is a candidate this run.
 *
 * WHAT IS IN SCOPE. Everything the census counts as "to rewrite" except the
 * FROZEN history (owner decision 2026-10-11): verdicts/*.json, and the
 * `evidence:` strings of card-todo-closed / backlog-closed. Also out: the
 * register itself, the generated CR outputs, classification/supersession,
 * the fields absorb drops (sources.rulings/history, sourceHashes), and this
 * directory (the migration's own examples).
 *
 * METHODS (cites.json `method`), in the order they are tried:
 *   fp          not a citation (census heuristic, or allowlist.json)
 *   none        no target exists: no heading (184's UNREGISTERED), or no record
 *               cites the ruling (the ten uncovered live rulings until their
 *               records land; then a re-run maps them)
 *   process     a process-scope ruling: becomes a pointer to its guard test
 *               (PROCESS_HOME, from the WS1b report §3), or `obsolete`
 *   range       `R38–R48`: a span, never auto-picked
 *   unique      the ruling's citing records sit under one rule or one section
 *               (rmap class unique-rule / unique-section, §-sub-map included)
 *   binding     the token is inside a `file.test.ts::title` reference: it takes
 *               the pick of the test title it names, so title and binding move
 *               together
 *   scored      a multi ruling: candidates are its citing records, scored on the
 *               signals below; `pick` is set only when `confidence` ≥ threshold
 *               (else `proposed`, and the row goes to units.json)
 *   provenance  in the CR's own data (record notes/rebuttal, discrepancies, findings)
 *               a ruling is cited as a SOURCE; its rewrite is the absorbed owner
 *               source, not a CR number. `topic` keeps the pick for the rewriter.
 * `historical: true` marks a sentence about reversal/supersession: the pick stands,
 * but the rewrite there may need other wording.
 *
 * CONFIDENCE (calibrated 2026-10-11, build/calibration.json): self/bound 0.97/0.95
 * when the quote evidence agrees or is silent, 0.55 when it contradicts; quote-led
 * = family margin × √(best quote / 40); quote+card (the sentence's card and the
 * quote winner agree) is lifted to 1 − 0.2·(1 − c). Threshold 0.9.
 *
 * SIGNALS for a multi ruling, strongest first (each candidate's `signals`):
 *   self     the citation sits inside a CR record that is itself a candidate, or
 *            a discrepancy/finding whose `rule` is a candidate
 *   bound    the citation sits inside a test (or IS its title) that a candidate
 *            binds in `examples[].test` (exact, or the binding is a prefix)
 *   engine   the enclosing function / a symbol in the context is in the
 *            candidate's `sources.engine`
 *   card     a card the context names (or the card definition the citation sits
 *            in) is named by the candidate (`card: X` refs, text, notes)
 *   file     the citation's file is in the candidate's `sources.tests`, or the
 *            candidate binds an example in that file
 *   quote    BM25 of the citing sentence + comment block against the candidate's
 *            quotes of THIS ruling (weighted 2) and its text
 *   prior    the candidate's section's place in classification.json `sections`
 *            (weak tie-break only)
 * Candidates in one rule family (802.15, 802.15a…) are pooled when no signal
 * separates them: the pick is then the family rule (`family: true`). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_BUILD_DIR, REPO_ROOT, ORACLE_JSON } from '../../paths.mjs';
import { tokenize } from '../extract-test-titles.mjs';
import { loadInputs } from '../render.mjs';
import { indexLedger, parseNum, compareNums } from '../ledger.mjs';
import { parseRef } from '../schema.mjs';
import { parseRulingCite } from './register.mjs';
import { buildRmap, counts as rmapCounts, RMAP_JSON } from './rmap.mjs';
import { runCensus } from './census.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CITES_JSON = join(CR_BUILD_DIR, 'cites.json');
export const UNITS_JSON = join(CR_BUILD_DIR, 'units.json');
export const SAMPLE_JSON = join(CR_BUILD_DIR, 'sample.json');
export const CALIBRATION_JSON = join(CR_BUILD_DIR, 'calibration.json');
const ALLOWLIST = join(HERE, 'allowlist.json');
const MIGRATE_DIR_REL = 'client/engine/scripts/cr/migrate/';
/** CR-data fields whose R-citations name a ruling as a source document (see step 7) */
const PROVENANCE = (area, field) => !!field && (
  (area === 'cr/rules' && /^(notes|rebuttal)$/.test(field))
  || area === 'cr/discrepancies' || area === 'cr/findings' || area === 'cr/other');
/** the calibrated auto-pick threshold (see calibration.json; --threshold overrides) */
export const DEFAULT_THRESHOLD = 0.9;

/* ── process-scope rulings → where their reasoning lives after the register goes
 * (WS1b report §3). `pointer` is what a citation becomes: `(see <pointer>)`. */
const PROCESS_HOME = {
  R155: '71-card-ledger', R169: '143-replay-divergence', R171: '84-card-semantics', R173: '154-guard-shape',
  R174: '147-comment-conformance', R180: '170-battle-position-promises', R181: 'CLAUDE.md § The gates',
  R182: '65-effect-conformance', R193: '147-comment-conformance', R199: 'drill.ts', R200: 'replay-room.ts',
  R201: '164-sweep-sight', R203: '174-secrecy-is-seat-aware', R204: 'test-clock.ts', R210: '147-comment-conformance',
  R211: '181-inconclusive-activation-window', R214: '150-registration-order', R215: null, R217: '187-scenario-queue',
  R218: '14-scenario-tester.md', R220: '14-scenario-tester.md', R231: '197-absorb-is-shared', R232: '81-card-drill',
  R233: '201-assessment-numbers', R234: null, R259: '238-question-sheets', R260: '83-card-todo', R275: null,
  R285: 'fetch-reports.mjs', R343: 'data/comprehensive-rules/README.md',
};

/* ── text helpers ── */
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const normLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const STOP = new Set(('the a an and or of to in on at by for is are was were be been it its this that these those with as from not no '
  + 'but if then so do does did has have had can may must will would should when which who what where how all any each every '
  + 'one two than into out up only also just too very same such per via see now here there they them their our we us you your '
  + 'he his she her i me my test tests ts true false const let var return new null undefined').split(' '));
/** words of a text: camelCase split, lower-cased, stop-words and R-numbers dropped, crude stem */
export function words(s) {
  const out = [];
  const t = String(s ?? '').replace(/\bR\d{1,3}b?\b/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  for (let w of t.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    w = w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
    if (w.length >= 3) out.push(w);
  }
  return out;
}

/* ── per-file caches: lines, line offsets, test extents, card extents ── */
const fileCache = new Map();
function fileInfo(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
  const lines = text.split('\n');
  const offs = [0];
  for (const l of lines) offs.push(offs[offs.length - 1] + l.length + 1);
  const lineOf = (off) => { let lo = 0, hi = lines.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
  const info = { text, lines, offs, lineOf, tests: [], cards: [], json: null };
  if (/\.(ts|mts|mjs|js)$/.test(rel)) {
    let toks = null;
    try { toks = tokenize(text); } catch { toks = null; }
    if (toks) {
      // match parens once
      const close = new Array(toks.length).fill(-1), stack = [];
      toks.forEach((t, k) => { if (t.t === 'p' && (t.v === '(' || t.v === '{' || t.v === '[')) stack.push(k); else if (t.t === 'p' && (t.v === ')' || t.v === '}' || t.v === ']')) { const o = stack.pop(); if (o !== undefined) close[o] = k; } });
      for (let k = 0; k < toks.length; k++) {
        const tok = toks[k];
        if (tok.t !== 'id') continue;
        const prev = toks[k - 1];
        if (prev && prev.t === 'p' && prev.v === '.') continue;
        if (tok.v === 'test' || tok.v === 'it') {
          let j = k + 1;
          if (toks[j]?.v === '.' && ['skip', 'only', 'todo'].includes(toks[j + 1]?.v)) j += 2;
          if (toks[j]?.v !== '(') continue;
          const open = j; j++;
          if (toks[j]?.t !== 'str' && toks[j]?.t !== 'tmpl') continue;
          let title = toks[j].v; const ts = toks[j].s; let te = toks[j].e; j++;
          while (toks[j]?.v === '+' && (toks[j + 1]?.t === 'str' || toks[j + 1]?.t === 'tmpl')) { title += toks[j + 1].v; te = toks[j + 1].e; j += 2; }
          const end = close[open] >= 0 ? toks[close[open]].e : te;
          info.tests.push({ title, s: tok.s, e: end, ts, te, line: lineOf(tok.s), endLine: lineOf(end) });
        } else if (tok.v === 'card' && toks[k + 1]?.v === '(' && toks[k + 2]?.t === 'str') {
          const end = close[k + 1] >= 0 ? toks[close[k + 1]].e : toks[k + 2].e;
          info.cards.push({ name: toks[k + 2].v, s: tok.s, e: end, line: lineOf(tok.s), endLine: lineOf(end) });
        }
      }
    }
  }
  if (rel.endsWith('.json')) { try { info.json = JSON.parse(text); } catch { info.json = null; } }
  fileCache.set(rel, info);
  return info;
}

const isCommentLine = (l) => /^\s*(\/\/|\/\*|\*|#)/.test(l);
/** the comment block (or md paragraph) around a line, ±8 lines max, markers stripped;
 *  `at` is where the citation line starts in `text` */
function blockOf(info, line, md) {
  const L = info.lines, i = line - 1;
  const inBlock = md ? (k) => L[k] !== undefined && L[k].trim() !== '' && !/^#{1,6}\s/.test(L[k])
    : (k) => L[k] !== undefined && isCommentLine(L[k]);
  let a = i, b = i;
  if (inBlock(i)) {
    while (a > 0 && i - a < 8 && inBlock(a - 1)) a--;
    while (b < L.length - 1 && b - i < 8 && inBlock(b + 1)) b++;
  } else { a = Math.max(0, i - 1); b = Math.min(L.length - 1, i + 1); }
  const strip = (l) => l.replace(/^\s*(\/\/+|\/\*+|\*+\/?|#+)\s?/, '').replace(/\*\/\s*$/, '');
  let text = '', at = 0;
  for (let k = a; k <= b; k++) { if (k === i) at = text.length; text += strip(L[k]) + ' '; }
  return { from: a + 1, to: b + 1, text, at };
}
const rulingRe = (id) => new RegExp(`\\b${id}(?![\\dA-Za-z])`, 'g');
/** the sentence of `text` around offset `pos` */
function sentenceAt(text, pos) {
  if (pos < 0) return text.slice(0, 300);
  let a = pos, b = pos;
  while (a > 0 && !/[.!?;]\s/.test(text.slice(a - 1, a + 1)) && pos - a < 400) a--;
  while (b < text.length && !(/[.!?;]/.test(text[b]) && /\s|$/.test(text[b + 1] ?? '')) && b - pos < 400) b++;
  return text.slice(a, b + 1).replace(/\s+/g, ' ').trim();
}
/** the offset of the occ-th `id` token in text at or after `from` */
function tokenAt(text, id, from, occ) {
  const re = rulingRe(id); re.lastIndex = from;
  let m, k = 0;
  while ((m = re.exec(text))) { if (k++ === occ) return m.index; }
  return text.search(rulingRe(id));
}
/** the nearest preceding function-ish name within 200 lines (engine/src, ui, server) */
function enclosingFn(info, line) {
  const re = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)|^\s{0,4}(?:private\s+|public\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]*)?\{\s*$/;
  for (let k = line - 1; k >= 0 && line - k < 200; k--) {
    const m = re.exec(info.lines[k]);
    if (m) { const n = m[1] ?? m[2] ?? m[3]; if (!['if', 'for', 'while', 'switch', 'catch', 'return'].includes(n)) return n; }
  }
  return null;
}

/** a frozen closed-ledger evidence string? (the nearest entry field above the line is `evidence:`) */
function frozenEvidence(rel, info, line) {
  if (!/client\/ledgers\/(card-todo|backlog)-closed\.ts$/.test(rel)) return false;
  const L = info.lines;
  const here = L[line - 1];
  if (isCommentLine(here)) return false;
  if (!/^\s*evidence:/.test(here) && !/^\s*(\+\s*)?['"`]/.test(here)) return false;
  for (let k = line - 1; k >= 0 && line - k < 80; k--) {
    const m = /^\s{2,8}([A-Za-z]+):/.exec(L[k]);
    if (m) return m[1] === 'evidence';
    if (/^\s*[{}],?\s*$/.test(L[k])) return false;
  }
  return false;
}

/* ── BM25 over the record corpus ── */
function bm25Index(docs) {
  const df = new Map(); let total = 0;
  for (const d of docs) { total += d.length; for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1); }
  const N = docs.length, avg = total / Math.max(1, N);
  const idf = (w) => Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
  const score = (q, d, k1 = 1.2, b = 0.75) => {
    const tf = new Map(); for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of new Set(q)) { const f = tf.get(w); if (!f) continue; s += idf(w) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg)); }
    return s;
  };
  return { idf, score };
}

export function score({ threshold = DEFAULT_THRESHOLD } = {}) {
  // 1. fresh map + census
  const map = buildRmap();
  mkdirSync(CR_BUILD_DIR, { recursive: true });
  writeFileSync(RMAP_JSON, JSON.stringify({ counts: rmapCounts(map), ...map }, null, 1) + '\n');
  const census = runCensus({ dump: true });
  const R = map.rulings;
  const inputs = loadInputs();
  const I = indexLedger(inputs.ledger);
  const recByKey = new Map(inputs.records.map((r) => [r.key, r]));
  const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8')).entries;
  const cardNames = Object.keys(JSON.parse(readFileSync(ORACLE_JSON, 'utf8'))).filter((n) => n.length >= 4 && /^[A-Z]/.test(n));
  const cardRe = new RegExp(`\\b(${cardNames.sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  const cardsIn = (s) => new Set([...String(s ?? '').matchAll(cardRe)].map((m) => m[1]));

  // 2. per-record features
  const feat = new Map();
  for (const r of inputs.records) {
    const num = I.numOf(r.key);
    if (!num) continue;
    const quotes = {};
    for (const x of r.sources?.rulings ?? []) {
      const ref = typeof x === 'string' ? x : x.ref; const c = parseRulingCite(ref); if (!c) continue;
      (quotes[c.id] ??= []).push(typeof x === 'object' ? (x.quote ?? '') : '');
    }
    const cards = new Set();
    for (const x of r.sources?.printed ?? []) { const p = parseRef(x.ref); if (p?.type === 'card') cards.add(p.name); }
    for (const c of cardsIn(`${r.text} ${r.notes ?? ''} ${(r.examples ?? []).map((e) => `${e.text ?? ''} ${e.test ?? ''}`).join(' ')}`)) cards.add(c);
    const bindings = (r.examples ?? []).filter((e) => e.test).map((e) => { const [f, ...t] = e.test.split('::'); return { file: f, title: t.join('::') }; });
    const testFiles = new Set([...(r.sources?.tests ?? []).map((t) => String(t).split('::')[0]), ...bindings.map((b) => b.file)]);
    const engine = (r.sources?.engine ?? []).map((e) => { const s = String(e); const m = /^(?:([\w.-]+\.\w+):)?(.+)$/.exec(s); return { file: m[1] ?? null, sym: m[2].split('.').pop() }; });
    feat.set(r.key, { key: r.key, num, text: r.text, quotes, cards, bindings, testFiles, engine,
      docText: words(`${r.text} ${r.key.replace(/[.-]/g, ' ')}`), docQuote: Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, words(v.join(' '))])) });
  }
  const BM = bm25Index([...feat.values()].map((f) => [...f.docText, ...Object.values(f.docQuote).flat()]));

  // 3. rows in scope
  const EXCLUDED_AREA = new Set(['register (deleted)', 'cr/reviewed (deleted)', 'cr/generated']);
  const frozen = { verdicts: 0, evidence: 0 };
  const rows = [];
  const seenId = new Map();
  for (const c of census.rows) {
    if (EXCLUDED_AREA.has(c.area) || c.dropped) continue;
    if (c.file.startsWith(MIGRATE_DIR_REL)) continue;
    if (c.area === 'cr/verdicts') { frozen.verdicts++; continue; }
    const info = fileInfo(c.file);
    const isJson = c.line === null;
    const lineText = isJson ? c.text : info.lines[c.line - 1];
    if (!isJson && frozenEvidence(c.file, info, c.line)) { frozen.evidence++; continue; }
    const ruling = c.id;
    // occurrence index of this ruling's token on this line
    const toks = [...lineText.matchAll(/\bR(\d{1,3})(b?)\b/g)];
    const occ = toks.filter((m) => `R${Number(m[1])}${m[2]}` === ruling && m.index < c.col).length;
    let id = `${c.file}#${isJson ? `j${c.jrow ?? '-'}.${c.field}` : ''}#${ruling}#${sha(normLine(lineText))}#${occ}`;
    const dup = seenId.get(id) ?? 0; seenId.set(id, dup + 1);
    if (dup) id += `~${dup}`;
    rows.push({ c, info, isJson, lineText, ruling, id, occ });
  }

  // 4. per-row context + structural facts
  const titleRows = new Map(); // `${basename}::${title}` → [row]
  for (const row of rows) {
    const { c, info, isJson } = row;
    const md = /\.md$/.test(c.file);
    let ctx = { sentence: '', block: '', lines: null, test: null, fn: null, card: null, recordKey: null };
    if (isJson) {
      const obj = Array.isArray(info.json) && c.jrow !== null ? info.json[c.jrow] : null;
      ctx.sentence = sentenceAt(row.lineText, tokenAt(row.lineText, row.ruling, 0, row.occ));
      ctx.block = row.lineText.length > 1200 ? ctx.sentence : row.lineText;
      ctx.recordKey = obj ? (obj.key && c.area === 'cr/rules' ? obj.key : obj.rule ?? null) : null;
      ctx.jsonField = c.field;
      if (c.field === 'examples.test') {
        const [f, ...t] = row.lineText.split('::'); ctx.binding = { file: f, title: t.join('::') };
      }
    } else {
      const b = blockOf(info, c.line, md);
      ctx.block = b.text.replace(/\s+/g, ' ').trim(); ctx.lines = [b.from, b.to];
      // the citation's own token: the occ-th of its ruling on its (stripped) line
      const stripped = b.text.slice(b.at);
      ctx.sentence = sentenceAt(b.text, tokenAt(b.text, row.ruling, b.at, row.occ));
      const off = info.offs[c.line - 1] + c.col;
      const t = info.tests.filter((x) => x.s <= off && off < x.e).pop();
      if (t) {
        ctx.test = { file: basename(c.file), title: t.title };
        if (off >= t.ts && off < t.te) { ctx.inTitle = true; const k = `${basename(c.file)}::${t.title}`; (titleRows.get(k) ?? titleRows.set(k, []).get(k)).push(row); }
      }
      if (/\.(ts|mts|mjs|js)$/.test(c.file) && !t) ctx.fn = enclosingFn(info, c.line);
      if (info.cards.length) {
        const inside = info.cards.filter((x) => x.line <= c.line && c.line <= x.endLine).pop();
        const next = info.cards.find((x) => x.line > b.to && x.line - b.to <= 3);
        ctx.card = inside?.name ?? next?.name ?? null;
      }
      // a ledger guard / any `file.test.ts::title` string holding this token
      const gm = [...row.lineText.matchAll(/(['"`])(\d{1,3}-[\w.-]+\.test\.ts)::((?:\\.|(?!\1).)*)\1/g)]
        .find((m) => m.index <= c.col && c.col < m.index + m[0].length);
      if (gm) ctx.binding = { file: gm[2], title: gm[3].replace(/\\(.)/g, '$1') };
    }
    row.ctx = ctx;
  }

  // 5. classify + score
  const out = [];
  const pending = []; // binding rows resolved after titles
  for (const row of rows) {
    const { c, ctx, ruling } = row;
    const r = R[ruling] ?? (ruling.endsWith('b') ? null : null);
    let form = c.form === 'section' ? '§' : c.form;
    if (ctx.inTitle) form = 'title';
    else if (ctx.binding) form = 'binding';
    const base = {
      id: row.id, file: c.file, line: c.line, col: c.col, ...(row.isJson ? { jsonRow: c.jrow, field: c.field, leaf: c.leaf } : {}), area: c.area,
      ruling, form, class: c.cls, historical: !!c.hist, code: c.code ?? null,
      context: { text: normLine(row.lineText).slice(0, 400), sentence: ctx.sentence.slice(0, 500), block: ctx.block.slice(0, 1200), lines: ctx.lines,
        test: ctx.test, fn: ctx.fn, card: ctx.card, record: ctx.recordKey, binding: ctx.binding ?? null },
      candidates: [], pick: null, confidence: 0, method: null,
    };
    const fpAllow = allow.find((a) => a.file === c.file && row.lineText.includes(a.match) && (!a.ids || a.ids.includes(ruling)));
    if (c.cls === 'fp' || fpAllow) { out.push({ ...base, method: 'fp', reason: fpAllow?.reason ?? c.fp }); continue; }
    if (!r) { out.push({ ...base, method: 'none', reason: c.cls }); continue; }
    if (r.scope === 'process') {
      const has = Object.hasOwn(PROCESS_HOME, ruling);
      const home = has ? PROCESS_HOME[ruling] : undefined;
      out.push({ ...base, method: has ? 'process' : 'none', pick: null, pointer: home ?? null, obsolete: has && home === null, confidence: has ? 1 : 0, reason: has ? undefined : 'process ruling with no home in the table' });
      continue;
    }
    if (c.form === 'range') { out.push({ ...base, method: 'range' }); continue; }
    if (c.cls === 'unmapped') { out.push({ ...base, method: 'none', reason: 'no record cites it' }); continue; }
    if (c.cls === 'unique-rule' || c.cls === 'unique-section') {
      out.push({ ...base, method: 'unique', pick: c.target, confidence: 1, family: !!(c.cls === 'unique-section'), reason: c.cls });
      continue;
    }
    // multi: candidates = the citing records (the §-sub-map's, when the cite is §-scoped and it narrows)
    let hits = r.method === 'direct' ? r.direct.hits : null;
    if (!hits) {
      // history/routed: the hits rmap classified on
      hits = (r.nums ?? []).map((num) => ({ num, key: I.byNum.get(num)?.key }));
    }
    const secM = /^\s?(?:its\s)?§\s?(\d+)/.exec(row.lineText.slice(c.col + ruling.length, c.col + ruling.length + 12));
    if (secM && map.sub[`${ruling}§${secM[1]}`]) {
      const subNums = new Set(map.sub[`${ruling}§${secM[1]}`].nums);
      const narrowed = hits.filter((h) => subNums.has(h.num));
      if (narrowed.length) hits = narrowed;
    }
    const seen = new Set();
    hits = hits.filter((h) => h.key && !seen.has(h.key) && seen.add(h.key));
    const qWords = words(`${ctx.sentence} ${ctx.sentence} ${ctx.block} ${ctx.test?.title ?? ''} ${ctx.card ?? ''} ${ctx.fn ?? ''}`);
    const ctxCards = new Set([...cardsIn(`${ctx.sentence} ${ctx.test?.title ?? ''}`), ...(ctx.card ? [ctx.card] : [])]);
    const ctxText = `${ctx.block} ${row.lineText}`;
    const fileBase = basename(c.file);
    const clsSecs = r.clsSections ?? [];
    const cands = hits.map((h) => {
      const f = feat.get(h.key);
      if (!f) return { num: h.num, key: h.key, score: 0, signals: {} };
      const sig = {};
      if (ctx.recordKey && ctx.recordKey === h.key) sig.self = 1;
      const tst = ctx.test ?? (form === 'binding' ? ctx.binding : null);
      if (tst && f.bindings.some((b) => b.file === tst.file && b.title && tst.title.startsWith(b.title))) sig.bound = 1;
      // only the ENCLOSING function counts: a symbol merely named in a long comment
      // matched the wrong rule 7 times in 10 (calibration round 1)
      if (ctx.fn && f.engine.some((e) => e.sym === ctx.fn && (!e.file || e.file === fileBase))) sig.engine = 1;
      const cm = [...ctxCards].filter((x) => f.cards.has(x));
      if (cm.length) sig.card = cm.length;
      if (f.testFiles.has(fileBase) || (ctx.binding && f.testFiles.has(ctx.binding.file))) sig.file = 1;
      const qd = f.docQuote[ruling] ?? [];
      const bq = BM.score(qWords, qd), bt = BM.score(qWords, f.docText);
      sig.quote = Math.round((2 * bq + bt) * 100) / 100;
      const sec = parseNum(h.num)?.section;
      const pi = clsSecs.findIndex((s) => s === sec || h.num === s || h.num.startsWith(s + '.') || (s === 'D' && /^D/.test(h.num)));
      if (pi >= 0) sig.prior = Math.round((0.3 / (pi + 1)) * 100) / 100;
      return { num: h.num, key: h.key, score: 0, signals: sig };
    });
    // the combined score: quote evidence, plus bonuses for the weak structural
    // signals scaled to the best quote score here (so they tip, never swamp)
    const qmax = Math.max(1, ...cands.map((x) => x.signals.quote ?? 0));
    for (const x of cands) {
      const g = x.signals;
      x.score = Math.round((100 * (g.self ?? 0) + 50 * (g.bound ?? 0) + (g.quote ?? 0) + (g.prior ?? 0)
        + qmax * (BONUS.card * Math.min(1, g.card ?? 0) + BONUS.engine * (g.engine ?? 0) + BONUS.file * (g.file ?? 0))) * 100) / 100;
    }
    cands.sort((a, b) => b.score - a.score || compareNums(a.num, b.num));
    base.candidates = cands;
    out.push({ ...base, ...decide(cands), method: 'scored', historical: !!c.hist });
    if (form === 'binding' && ctx.binding) pending.push(out.length - 1);
  }

  // 6. bindings take their title's pick
  const titleRowIdx = new Map(out.map((o, i) => [o.id, i]));
  for (const i of pending) {
    const o = out[i];
    const b = o.context.binding;
    const match = [...titleRows.entries()].filter(([k]) => { const [f, ...t] = k.split('::'); return f === b.file && t.join('::').startsWith(b.title); })
      .flatMap(([, rs]) => rs).filter((tr) => tr.ruling === o.ruling);
    const tos = [...new Set(match.map((tr) => out[titleRowIdx.get(tr.id)]))];
    const picks = [...new Set(tos.map((t) => t.pick))];
    if (tos.length && picks.length === 1) {
      const t = tos[0];
      out[i] = { ...o, method: 'binding', titleRow: t.id, pick: t.pick, confidence: t.confidence, decidedBy: `title:${t.decidedBy ?? t.method}`, family: t.family };
    } else o.bindingUnresolved = tos.length ? 'title rows disagree' : 'no title row found';
  }

  // 7. provenance: in the CR's own data a ruling is cited as a SOURCE ("R93 quotes
  // calebgannon", a discrepancy side `source: "R157"`). Its rewrite is the absorbed
  // owner source, not a CR number — and the "self" pick there is the record's own
  // number, which says nothing. The pick is kept as `topic`, for the rewriter.
  for (const o of out) {
    if (o.method === 'fp' || o.method === 'binding' || !PROVENANCE(o.area, o.field)) continue;
    o.provenance = true; o.topic = o.pick; o.topicMethod = o.method; o.method = 'provenance'; o.pick = null;
  }
  // 8. threshold
  for (const o of out) {
    if (o.method === 'scored' || (o.method === 'binding' && o.decidedBy?.startsWith('title:'))) {
      o.auto = o.pick !== null && o.confidence >= threshold;
      if (!o.auto) { o.proposed = o.pick; o.pick = null; }
    } else o.auto = o.method === 'unique' || o.method === 'process';
  }
  return { out, frozen, threshold, R, map };
}

/** weak-signal bonuses, as a fraction of the best quote score among the candidates */
const BONUS = { card: 0.15, engine: 0.05, file: 0.05 };
/** the score that drives the non-structural pick: quote + prior + weak bonuses */
const soft = (c, qmax) => (c.signals.quote ?? 0) + (c.signals.prior ?? 0)
  + qmax * (BONUS.card * Math.min(1, c.signals.card ?? 0) + BONUS.engine * (c.signals.engine ?? 0) + BONUS.file * (c.signals.file ?? 0));
/** how much quote evidence counts as "enough" (BM25 units; a good match scores 30–150) */
const ABS_FULL = 40;

/** pick from sorted candidates: the decisive structural signal, else the soft score
 *  with family pooling; confidence = margin over the next family × absolute strength */
function decide(cands) {
  if (!cands.length) return { pick: null, confidence: 0, decidedBy: 'no-candidates' };
  const fam = (num) => { const p = parseNum(num); return p && p.rule !== null ? `${p.section}.${p.rule}` : num; };
  const qmax = Math.max(1, ...cands.map((c) => c.signals.quote ?? 0));
  const qRaw = Math.max(0, ...cands.map((c) => c.signals.quote ?? 0));
  const qTop = cands.slice().sort((a, b) => (b.signals.quote ?? 0) - (a.signals.quote ?? 0) || compareNums(a.num, b.num))[0];
  /** does the quote evidence agree with a structural pick? null when there is none to speak of */
  const agreeWith = (num) => {
    if (qRaw < QUOTE_EVIDENCE) return null;
    const c = cands.find((x) => x.num === num);
    return fam(num) === fam(qTop.num) || ((c?.signals.quote ?? 0) >= 0.75 * qRaw);
  };
  for (const s of ['self', 'bound']) {
    const w = cands.filter((c) => c.signals[s]);
    if (!w.length || w.length === cands.length) continue;
    const fams = [...new Set(w.map((c) => fam(c.num)))];
    if (w.length === 1 || fams.length === 1) {
      const pool = w.slice().sort((a, b) => soft(b, qmax) - soft(a, qmax));
      let pick = pool[0].num, family = false;
      if (pool.length > 1 && margin(soft(pool[0], qmax), soft(pool[1], qmax)) < 0.35) { pick = fams[0]; family = pick !== pool[0].num; }
      const agree = agreeWith(pool[0].num);
      // calibration round 2: a structural pick the quote evidence contradicts was
      // wrong 5 times in 10; one it agrees with (or with no quote evidence) 0 in 8+
      const conf = agree === false ? STRUCT_DISAGREE : (s === 'self' ? 0.97 : 0.95) - (family ? 0.02 : 0);
      return { pick, confidence: round(conf), decidedBy: s, family, agree, quoteTop: qTop.num };
    }
    if (w.length < cands.length) { cands = w; break; }
  }
  const byFam = new Map();
  for (const c of cands) { const f = fam(c.num); if (!byFam.has(f)) byFam.set(f, []); byFam.get(f).push(c); }
  const fams = [...byFam.entries()].map(([f, cs]) => ({ f, cs: cs.slice().sort((a, b) => soft(b, qmax) - soft(a, qmax)) }))
    .map((x) => ({ ...x, s: soft(x.cs[0], qmax) })).sort((a, b) => b.s - a.s);
  const top = fams[0], second = fams[1];
  const famMargin = second ? margin(top.s, second.s) : 1;
  let pick = top.cs[0].num, family = false;
  if (top.cs.length > 1 && margin(top.s, soft(top.cs[1], qmax)) < 0.35) { pick = top.f; family = pick !== top.cs[0].num; }
  const w = top.cs[0];
  const decidedBy = fam(qTop.num) === top.f ? (w.signals.card ? 'quote+card' : 'quote')
    : w.signals.card ? 'card' : w.signals.engine ? 'engine' : w.signals.file ? 'file' : 'quote';
  const abs = Math.min(1, (w.signals.quote ?? 0) / ABS_FULL);
  let conf = cands.length === 1 ? 0.5 * Math.sqrt(abs) : famMargin * Math.sqrt(abs);
  // two independent signals agree (the card the sentence names, and the quote
  // winner): calibration round 2 found 10/10 right from conf 0.5 up
  if (decidedBy === 'quote+card') conf = 1 - (1 - conf) * 0.2;
  return { pick, confidence: round(conf), decidedBy, family, margin: round(famMargin), quoteTop: qTop.num };
}
/** below this best BM25 score there is no quote evidence to agree or disagree */
const QUOTE_EVIDENCE = 5;
/** a structural pick that the quote evidence contradicts: held for an agent */
const STRUCT_DISAGREE = 0.55;
const margin = (a, b) => (a <= 0 ? 0 : Math.max(0, (a - b) / a));
const round = (x) => Math.round(x * 1000) / 1000;

/** group unresolved citations by ruling, then pack rulings into units of ~5–15 rulings / bounded citations */
function buildUnits(out, R, map, inputs) {
  // a held binding is not here: it names a title row, and takes that row's final pick
  const unresolved = out.filter((o) => (o.method === 'scored' && !o.auto) || o.method === 'range');
  const by = new Map();
  for (const o of unresolved) { if (!by.has(o.ruling)) by.set(o.ruling, []); by.get(o.ruling).push(o); }
  const recByKey = new Map(inputs.records.map((r) => [r.key, r]));
  const I = indexLedger(inputs.ledger);
  const rulings = [...by.entries()].map(([id, cs]) => {
    const r = R[id];
    const keys = new Set(cs.flatMap((c) => c.candidates.map((x) => x.key)));
    return {
      ruling: id, title: r?.title ?? null, status: r?.status ?? null, scope: r?.scope ?? null, summary: r?.summary ?? null,
      sections: r?.clsSections ?? [],
      candidates: [...keys].map((k) => { const rec = recByKey.get(k); return { num: I.numOf(k), key: k, text: rec?.text ?? null,
        quotes: (rec?.sources?.rulings ?? []).filter((x) => typeof x === 'object' && parseRulingCite(x.ref)?.id === id).map((x) => x.quote) }; })
        .sort((a, b) => compareNums(a.num, b.num)),
      citations: cs.map((c) => ({ id: c.id, file: c.file, line: c.line, form: c.form, historical: c.historical || undefined,
        proposed: c.proposed ?? c.pick ?? null, confidence: c.confidence, decidedBy: c.decidedBy ?? c.method,
        sentence: c.context.sentence.slice(0, 400), text: c.context.text.slice(0, 300),
        ...(c.context.sentence.length < 80 ? { block: c.context.block.slice(0, 400) } : {}),
        test: c.context.test?.title, card: c.context.card ?? undefined, binding: c.context.binding ?? undefined,
        top: c.candidates.slice(0, 3).map((x) => `${x.num} ${x.score}`) })),
    };
  });
  // pack: N units, N = enough for ~UNIT_CITES citations and ≤15 rulings each; each
  // ruling, biggest first, joins the least-loaded unit (LPT), so every unit gets a
  // mix of big and small rulings and the load is even
  const total = rulings.reduce((a, r) => a + r.citations.length, 0);
  const N = Math.max(1, Math.ceil(total / UNIT_CITES), Math.ceil(rulings.length / 15));
  const units = Array.from({ length: N }, () => ({ rulings: [], n: 0 }));
  const bySize = rulings.slice().sort((a, b) => b.citations.length - a.citations.length || a.ruling.localeCompare(b.ruling, 'en', { numeric: true }));
  for (const r of bySize) {
    const open = units.filter((x) => x.rulings.length < 15);
    const u = open.reduce((m, x) => (x.n < m.n ? x : m), open[0]);
    u.rulings.push(r); u.n += r.citations.length;
  }
  for (const u of units) u.rulings.sort((a, b) => a.ruling.localeCompare(b.ruling, 'en', { numeric: true }));
  return units.map((u, i) => ({ unit: `M${String(i + 1).padStart(3, '0')}`, rulings: u.rulings.map((r) => r.ruling),
    citations: u.rulings.reduce((a, r) => a + r.citations.length, 0), items: u.rulings }));
}
/** a unit's citation budget: what one agent can read in context with the candidates */
const UNIT_CITES = 420;

/** a fresh, seeded sample of AUTO picks (contextual methods), excluding ids already labelled:
 *  the out-of-sample check of the threshold rule fitted on the first sample */
function validationOf(out, labelled, per = { self: 12, bound: 10, 'quote+card': 9, quote: 9 }, seed = 20261012) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const picked = [];
  for (const [d, n] of Object.entries(per)) {
    const pool = out.filter((o) => o.method === 'scored' && o.auto && o.decidedBy === d && !labelled.has(o.id)).sort((a, b) => a.id.localeCompare(b.id));
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    picked.push(...pool.slice(0, n).map((o) => ({ ...o, stratum: `auto:${d}` })));
  }
  return picked;
}
function sampleOf(out, scale = 1, seed = 20261011) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const scored = out.filter((o) => o.method === 'scored' && (o.pick ?? o.proposed));
  const picked = [];
  for (const [name, f, n] of STRATA) {
    const pool = scored.filter(f).sort((a, b) => a.id.localeCompare(b.id));
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    picked.push(...pool.slice(0, Math.round(n * scale)).map((o) => ({ ...o, stratum: name })));
  }
  return picked;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const threshold = arg('--threshold') !== null ? Number(arg('--threshold')) : DEFAULT_THRESHOLD;
  const { out, frozen, R, map } = score({ threshold });
  const inputs = loadInputs();
  const tally = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const units = buildUnits(out, R, map, inputs);
  // calibration: read labels if present
  let calib = null;
  if (existsSync(CALIBRATION_JSON)) {
    const C = JSON.parse(readFileSync(CALIBRATION_JSON, 'utf8'));
    const byId = new Map(out.map((o) => [o.id, o]));
    const res = {};
    for (const l of C.labels ?? []) {
      const o = byId.get(l.id);
      if (!o) { (res._missing ??= 0); res._missing++; continue; }
      const pick = o.pick ?? o.proposed;
      const stale = pick !== l.pick;
      const key = `${l.set ?? 'tuning'}:${l.decidedBy ?? o.decidedBy}`;
      const k = res[key] ??= { n: 0, ok: 0, stale: 0, atThreshold: { n: 0, ok: 0 } };
      if (o.method === 'provenance') { (k.provenance ??= 0); k.provenance++; continue; }
      if (stale) { k.stale++; continue; }
      k.n++; if (l.ok) k.ok++;
      if (o.auto) { k.atThreshold.n++; if (l.ok) k.atThreshold.ok++; }
    }
    // the headline: precision of the labelled picks that are auto at this threshold, per set
    for (const set of ['tuning', 'validation']) {
      const ks = Object.entries(res).filter(([k]) => k.startsWith(set + ':'));
      res[`${set}:AUTO`] = ks.reduce((a, [, v]) => ({ n: a.n + v.atThreshold.n, ok: a.ok + v.atThreshold.ok }), { n: 0, ok: 0 });
    }
    calib = res;
  }
  const summary = {
    threshold, total: out.length, frozen,
    method: tally(out, (o) => o.method),
    provenanceByArea: tally(out.filter((o) => o.provenance), (o) => `${o.area}:${o.field}`),
    auto: tally(out.filter((o) => o.auto), (o) => o.method),
    scoredDecidedBy: tally(out.filter((o) => o.method === 'scored'), (o) => `${o.decidedBy}:${o.auto ? 'auto' : 'held'}`),
    historicalAuto: out.filter((o) => o.auto && o.historical).length,
    familyPicks: out.filter((o) => o.auto && o.family).length,
    byArea: tally(out, (o) => `${o.area}:${o.auto ? 'auto' : o.method === 'fp' ? 'fp' : 'open'}`),
    units: { n: units.length, citations: units.reduce((a, u) => a + u.citations, 0), rulings: units.reduce((a, u) => a + u.rulings.length, 0) },
    calibration: calib,
  };
  writeFileSync(CITES_JSON, JSON.stringify({ summary, rows: out }, null, 1) + '\n');
  writeFileSync(UNITS_JSON, JSON.stringify({ summary: summary.units, units }, null, 1) + '\n');
  const n = arg('--sample');
  const asSample = (xs) => xs.map((o) => ({ id: o.id, stratum: o.stratum, file: o.file, line: o.line, form: o.form, ruling: o.ruling,
    decidedBy: o.decidedBy, confidence: o.confidence, pick: o.pick ?? o.proposed, family: o.family, area: o.area, historical: o.historical,
    context: o.context, top: o.candidates.slice(0, 4).map((c) => ({ num: c.num, key: c.key, score: c.score, signals: c.signals })) }));
  if (process.argv.includes('--validate')) {
    const labelled = new Set(existsSync(CALIBRATION_JSON) ? JSON.parse(readFileSync(CALIBRATION_JSON, 'utf8')).labels.map((l) => l.id) : []);
    writeFileSync(SAMPLE_JSON, JSON.stringify(asSample(validationOf(out, labelled)), null, 1) + '\n');
  }
  if (n) writeFileSync(SAMPLE_JSON, JSON.stringify(sampleOf(out, Number(n)).map((o) => ({ id: o.id, stratum: o.stratum, file: o.file, line: o.line, form: o.form, ruling: o.ruling,
    decidedBy: o.decidedBy, confidence: o.confidence, pick: o.pick ?? o.proposed, family: o.family, area: o.area, historical: o.historical,
    context: o.context, top: o.candidates.slice(0, 4).map((c) => ({ num: c.num, key: c.key, score: c.score, signals: c.signals })) })), null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  console.log(`wrote ${CITES_JSON}, ${UNITS_JSON}`);
}
