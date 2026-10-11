/* THE CITATION CENSUS — step 1b/1c sizing for the CR-only migration.
 *
 *   node client/engine/scripts/cr/migrate/census.mjs [--dump]
 *     → data/comprehensive-rules/build/census.json   (--dump: every occurrence too)
 *
 * READ-ONLY. Every `\bR\d{1,3}b?\b` in the tracked text files of client/,
 * data/comprehensive-rules/ and data/rules/, each tagged with:
 *   area      where it is (engine/src, engine/src/cards, ui, ui/test, …)
 *   cls       its ruling's class in rmap (unique-rule / unique-section / multi /
 *             unmapped), or `unregistered` (no heading; 184's UNREGISTERED) or
 *             `nonexistent` (no heading, not on 184's list) or `fp` (a candidate
 *             false positive — see FALSE_POSITIVE below)
 *   form      bare · section (`R157 §5`) · range (`R38–R48`, `R38-R48`) · list
 *   hist      the line speaks of it historically (reversed/superseded/withdrawn/
 *             was/…), or the ruling itself is dead — a CR number there changes
 *             the sentence's meaning
 *   code      in code, not a comment (string literal / identifier), by a crude
 *             line scanner — candidates for player-visible text
 *   field     for a JSON file under data/comprehensive-rules: the record field
 *             (sources.rulings / sources.history / sourceHashes are dropped by the
 *             absorb step, not rewritten by the codemod)
 *   mech      a mechanical rewrite is possible: unique class, not hist, not a
 *             range, not code, not in a dropped field
 * Plus: test titles starting `R<n>` (a real tokenizer, extract-test-titles.mjs),
 * CR example bindings and ledger `::` guards that point at such titles. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_BUILD_DIR, REPO_ROOT } from '../../paths.mjs';
import { testTitlesOf } from '../extract-test-titles.mjs';
import { loadInputs } from '../render.mjs';
import { buildRmap, RMAP_JSON } from './rmap.mjs';

export const CENSUS_JSON = join(CR_BUILD_DIR, 'census.json');
const TOKEN = /\bR(\d{1,3})(b?)\b/g;
const BINARY = /\.(ogg|png|jpg|jpeg|ico|woff2?|pdf|gif|webp)$/i;
const HIST_WORDS = /\b(revers\w*|supersed\w*|withdr[ae]w\w*|narrow\w*|amend\w*|overturn\w*|correct(ed|s|ion)|replac\w*|absorb\w*|retir\w*|took back|takes back|used to|was (?:false|wrong)|said otherwise|old|previously|formerly|before)\b/i;

/** where a repo path lives, for the census table */
export function areaOf(p) {
  const rules = [
    [/^client\/docs\/digital-rules\.md$/, 'register (deleted)'],
    [/^client\/engine\/src\/cards\//, 'engine/src/cards'],
    [/^client\/engine\/src\//, 'engine/src'],
    [/^client\/engine\/test\//, 'engine/test'],
    [/^client\/engine\/scripts\//, 'engine/scripts'],
    [/^client\/engine\//, 'engine/other'],
    [/^client\/ui\/test\//, 'ui/test'],
    [/^client\/ui\//, 'ui'],
    [/^client\/server\/test\//, 'server/test'],
    [/^client\/server\/e2e\//, 'server/e2e'],
    [/^client\/server\//, 'server'],
    [/^client\/ledgers\//, 'ledgers'],
    [/^client\/docs\//, 'docs'],
    [/^client\//, 'client/other'],
    [/^data\/comprehensive-rules\/rules\//, 'cr/rules'],
    [/^data\/comprehensive-rules\/discrepancies\//, 'cr/discrepancies'],
    [/^data\/comprehensive-rules\/findings\//, 'cr/findings'],
    [/^data\/comprehensive-rules\/verdicts\//, 'cr/verdicts'],
    [/^data\/comprehensive-rules\/(classification|supersession)\.json$/, 'cr/reviewed (deleted)'],
    [/^data\/comprehensive-rules\/(Algomancy-Comprehensive-Rules\.|Annex-D|discrepancies\.md|owner-questions|changelog)/, 'cr/generated'],
    [/^data\/comprehensive-rules\//, 'cr/other'],
    [/^data\/rules\//, 'data/rules'],
  ];
  for (const [re, a] of rules) if (re.test(p)) return a;
  return 'other';
}

/** JSON: [path-of-field, string] for every string leaf */
function* leaves(v, path = '', top = null) {
  if (typeof v === 'string') yield [path, v, top];
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* leaves(v[i], path, top ?? (path === '' ? i : null));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      yield [`${path ? path + '.' : ''}${k}`, k, top]; // keys can cite too (sourceHashes {"R114": …})
      yield* leaves(x, `${path ? path + '.' : ''}${k}`, top);
    }
  }
}
const DROPPED_FIELD = /^(sources\.rulings|sources\.history|sourceHashes)(\.|$)/;

/** a crude per-line scanner for .ts/.mjs: which columns are code (not comment), and inside a string */
function codeMask(lines) {
  let inBlock = false;
  return lines.map((line) => {
    const mask = new Array(line.length).fill(0); // 0 comment/ws, 1 code, 2 string-in-code
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i + 1];
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
      if (q) { mask[i] = 2; if (c === '\\') { mask[i + 1] = 2; i++; } else if (c === q) q = null; continue; }
      if (c === '/' && n === '*') { inBlock = true; i++; continue; }
      if (c === '/' && n === '/') break;
      if (c === '"' || c === "'" || c === '`') { q = c; mask[i] = 2; continue; }
      mask[i] = 1;
    }
    return mask;
  });
}

export function runCensus({ dump = false } = {}) {
  const rmap = existsSync(RMAP_JSON) ? JSON.parse(readFileSync(RMAP_JSON, 'utf8')) : buildRmap();
  const R = rmap.rulings;
  const registered = new Set(Object.keys(R).map((k) => Number(k.replace(/\D/g, ''))));
  const t184 = readFileSync(join(REPO_ROOT, 'client/engine/test/184-ruling-register.test.ts'), 'utf8');
  const unregistered = new Set([...t184.slice(t184.indexOf('const UNREGISTERED'), t184.indexOf('/* ══ §1'))
    .matchAll(/\{ n: (\d+),/g)].map((m) => Number(m[1])));

  const files = execFileSync('git', ['ls-files', 'client', 'data/comprehensive-rules', 'data/rules'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && !BINARY.test(f));
  const occ = [];
  for (const f of files) {
    const abs = join(REPO_ROOT, f);
    let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    if (!/\bR\d{1,3}b?\b/.test(text)) continue;
    const area = areaOf(f);
    const add = (o) => occ.push({ file: f, area, ...o });
    if (f.endsWith('.json') && f.startsWith('data/comprehensive-rules/')) {
      const j = JSON.parse(text);
      let leaf = 0;
      for (const [field, s, top] of leaves(j)) {
        for (const m of s.matchAll(TOKEN)) add({ field: field.replace(/\.\d+/g, ''), m, s, idx: m.index, line: null, jrow: top, leaf });
        leaf++;
      }
      continue;
    }
    const lines = text.split('\n');
    const mask = /\.(ts|mts|mjs|js)$/.test(f) ? codeMask(lines) : null;
    lines.forEach((ln, i) => {
      for (const m of ln.matchAll(TOKEN)) add({ m, s: ln, idx: m.index, line: i + 1, code: mask ? mask[i][m.index] : 0 });
    });
  }

  const rows = occ.map((o) => {
    const { m, s, idx } = o;
    const n = Number(m[1]), suffix = m[2];
    const id = `R${n}${suffix}`;
    const after = s.slice(idx + m[0].length, idx + m[0].length + 12);
    const before = s.slice(Math.max(0, idx - 3), idx);
    let form = 'bare';
    const sec = /^\s?(?:its\s)?§\s?(\d+)/.exec(after);
    if (sec) form = 'section';
    if (/^\s?(?:[-–—]|\.\.|to|through)\s?R\d/.test(after) || /R\d{1,3}b?\s?(?:[-–—]|\.\.)\s?$/.test(s.slice(Math.max(0, idx - 8), idx))) form = 'range';
    else if (/^\s?\/\s?R\d/.test(after) || /\/\s?$/.test(before)) form = 'list';
    let cls, target = null, rid = id;
    if (!R[id] && suffix && R[`R${n}`]) rid = `R${n}`;
    const r = R[rid];
    if (r) {
      cls = r.class; target = r.target;
      if (sec) { const sub = rmap.sub[`${rid}§${sec[1]}`]; if (sub && sub.class !== 'unmapped') { cls = sub.class; target = sub.target; form = 'section'; } }
    } else if (n === 0 || n > 350) cls = 'fp';
    else if (unregistered.has(n)) cls = 'unregistered';
    else cls = 'nonexistent';
    // FALSE_POSITIVE: a token that is not a ruling citation at all
    let fp = null;
    if (cls === 'fp') fp = 'out-of-range';
    else if (o.code === 1 && (/^\s*(=|\.|\(|,|\)|;|!)/.test(after) || /\b(const|let|var)\s+$/.test(s.slice(Math.max(0, idx - 8), idx)))) fp = 'identifier';
    else if ((o.file === 'client/docs/07-visual-redesign.md' && n <= 5) || /R0\s?[–-]\s?R5/.test(s)) fp = 'visual-redesign-round';
    if (fp) cls = 'fp';
    const dead = r && !['current', 'partly-superseded', 'narrowed'].includes(r.status);
    const hist = !!(dead || HIST_WORDS.test(s.slice(Math.max(0, idx - 80), idx + 80)));
    const dropped = !!(o.field && DROPPED_FIELD.test(o.field));
    const code = o.code === 2 ? 'string' : o.code === 1 ? 'code' : null;
    // a string in shipped code (engine/src, ui, server) may be player-visible; a string in a
    // test (a title, a message) or a ledger (data) is rewritten by the same map
    const shipped = /^(engine\/src|engine\/src\/cards|ui|server)$/.test(o.area);
    const visibleCandidate = !!(code && shipped);
    const uniq = (c) => c === 'unique-rule' || c === 'unique-section';
    const mech = !dropped && !fp && uniq(cls) && !hist && form !== 'range' && !visibleCandidate;
    // under the `primary` proposal (rmap.mjs), a multi ruling gets its anchor's target
    const prim = cls === 'multi' && r?.proposals ? r.proposals.primary : null;
    const mechPrimary = mech || (!dropped && !fp && !!prim && uniq(prim.class) && !hist && form !== 'range' && !visibleCandidate);
    return { file: o.file, line: o.line, col: idx, jrow: o.jrow ?? null, leaf: o.leaf ?? null, text: dump ? s : undefined, area: o.area, field: o.field ?? null, id, n, cls, fp, target, form, hist, code, visibleCandidate, dropped, mech, mechPrimary, primaryTarget: prim?.target ?? null,
      ctx: s.slice(Math.max(0, idx - 60), idx + 60).replace(/\s+/g, ' ') };
  });

  // ── test titles ──
  const TEST_ROOTS = ['client/engine/test/', 'client/ui/test/', 'client/server/test/', 'client/server/e2e/'];
  const titles = [], titlesInner = [];
  for (const f of files.filter((f) => TEST_ROOTS.some((r) => f.startsWith(r)) && /\.(ts|mts|mjs|js)$/.test(f))) {
    for (const t of testTitlesOf(readFileSync(join(REPO_ROOT, f), 'utf8'))) {
      const m = /^\[?R(\d{1,3})(b?)\b/.exec(t.title);
      if (m) titles.push({ file: f.split('/').pop(), path: f, title: t.title, id: `R${Number(m[1])}${m[2]}`, bracket: t.title.startsWith('[') });
      else if (/\bR\d{1,3}b?\b/.test(t.title)) titlesInner.push({ file: f.split('/').pop(), title: t.title });
    }
  }
  const titleKey = (file, title) => `${file}::${title}`;
  const titleSet = new Set(titles.map((t) => titleKey(t.file, t.title)));
  // CR example bindings
  const inputs = loadInputs();
  const bindings = [], bindingsInner = [];
  for (const rec of inputs.records) for (const ex of rec.examples ?? []) {
    if (!ex.test) continue;
    const [file, ...rest] = ex.test.split('::'); const title = rest.join('::');
    if (/^\[?R\d{1,3}b?\b/.test(title)) bindings.push({ key: rec.key, file, title, exact: titleSet.has(titleKey(file, title)) });
    else if (/\bR\d{1,3}b?\b/.test(title)) bindingsInner.push({ key: rec.key, file, title });
  }
  // ledger `::` guards (string literals holding `<file>.test.ts::<title>`)
  const guards = [];
  for (const f of files.filter((f) => f.startsWith('client/ledgers/') && f.endsWith('.ts'))) {
    const src = readFileSync(join(REPO_ROOT, f), 'utf8');
    for (const m of src.matchAll(/(['"`])(\d{1,3}-[\w.-]+\.test\.ts)::((?:\\.|(?!\1).)*)\1/g)) {
      const title = m[3].replace(/\\(.)/g, '$1');
      guards.push({ ledger: f.split('/').pop(), file: m[2], title, rtitle: /^\[?R\d{1,3}b?\b/.test(title), inner: /\bR\d{1,3}b?\b/.test(title) });
    }
  }

  const tally = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const pivot = (xs, f, g) => xs.reduce((a, x) => { const k = f(x), c = g(x); (a[k] ??= {})[c] = (a[k][c] ?? 0) + 1; a[k].total = (a[k].total ?? 0) + 1; return a; }, {});
  const live = rows.filter((r) => !['register (deleted)', 'cr/reviewed (deleted)', 'cr/generated'].includes(r.area) && !r.dropped);
  const summary = {
    total: rows.length,
    byArea: pivot(rows, (r) => r.area, (r) => r.cls),
    toRewrite: live.length,
    toRewriteByClass: tally(live, (r) => r.cls),
    toRewriteMech: tally(live, (r) => (r.mech ? 'mechanical' : 'context')),
    toRewriteMechPrimary: tally(live, (r) => (r.mechPrimary ? 'mechanical' : 'context')),
    mechPrimaryByArea: pivot(live, (r) => r.area, (r) => (r.mechPrimary ? 'mechanical' : 'context')),
    fp: tally(rows.filter((r) => r.fp), (r) => `${r.fp}`),
    fpFiles: tally(rows.filter((r) => r.fp), (r) => `${r.fp} ${r.file}`),
    visibleCandidates: tally(live.filter((r) => r.visibleCandidate), (r) => r.file),
    mechByArea: pivot(live, (r) => r.area, (r) => (r.mech ? 'mechanical' : 'context')),
    contextReasons: tally(live.filter((r) => !r.mech), (r) =>
      r.cls === 'multi' || r.cls === 'unmapped' || r.cls === 'unregistered' || r.cls === 'nonexistent' || r.cls === 'fp' ? `class:${r.cls}`
        : r.hist ? 'historical' : r.form === 'range' ? 'range' : r.visibleCandidate ? 'shipped-string' : 'other'),
    forms: tally(live, (r) => r.form),
    hist: tally(live, (r) => (r.hist ? 'historical' : 'plain')),
    inCode: tally(live.filter((r) => r.code), (r) => `${r.area}:${r.code}`),
    droppedFieldCites: tally(rows.filter((r) => r.dropped), (r) => r.field),
    crFieldCites: tally(rows.filter((r) => r.field && !r.dropped), (r) => `${r.area}:${r.field}`),
    distinctIds: new Set(live.map((r) => r.id)).size,
    titles: { n: titles.length, bracketed: titles.filter((t) => t.bracket).length, innerOnly: titlesInner.length, byClass: tally(titles, (t) => R[t.id]?.class ?? 'nohead') },
    bindings: { n: bindings.length, exact: bindings.filter((b) => b.exact).length, innerOnly: bindingsInner.length, byClass: tally(bindings, (b) => R[/R\d+b?/.exec(b.title)[0]]?.class ?? 'nohead') },
    guards: { n: guards.length, rtitle: guards.filter((g) => g.rtitle).length, anyR: guards.filter((g) => g.inner).length },
  };
  const out = { summary, titles, bindings, guards: guards.filter((g) => g.rtitle) };
  if (dump) out.rows = rows;
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dump = process.argv.includes('--dump');
  const c = runCensus({ dump });
  writeFileSync(CENSUS_JSON, JSON.stringify(c, null, 1) + '\n');
  console.log(JSON.stringify(c.summary, null, 1));
  console.log(`wrote ${CENSUS_JSON}`);
}
