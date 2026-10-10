/**
 * The mechanical half of the anti-hallucination contract (data/comprehensive-
 * rules/README.md): everything about a rule record a script can check without
 * judgement. The gate (test 409) requires `problems` to be empty.
 *
 * `check(inputs, extract)` → {
 *   problems:     [{code, where, msg}]   every one fails the gate, by name;
 *   stale:        [{kind, where, msg}]   sources that changed since drafting,
 *                                         verifier spans or finding evidence no
 *                                         longer in their file (pinned, not failing);
 *   undecided:    [{from, to}]           supersession candidates with no reviewed row;
 *   unclassified: [id]                   rulings with no classification row;
 * }
 *
 * Quotes are compared whitespace-normalised, as substrings of their source:
 *   printed  → the extract's printedPages (Manual / Rulebook 2023 pages) or a card's text
 *   designer → the RAQ claim's `claim` / `source` text
 *   rulings  → the ruling's body
 *   ours     → our glossary (never authority)
 * Pure apart from reading repo files named by `file:` references and verdict
 * spans. Run as a script it checks the committed state and exits 1 on problems.
 *
 *   npm --prefix client run cr:check
 *   node client/engine/scripts/cr/check.mjs --unit U12     (one unit's files only)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, basename, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../paths.mjs';
import {
  ANY_NUM_RE, norm, parseRef, parseRulingCite, recordHash,
  validateDiscrepancy, validateFinding, validateOutline, validateRecord, validateVerdict,
} from './schema.mjs';
import { buildModel, citedRulings, loadInputs, outlineSlots, unitOfRow } from './render.mjs';

/** relations that do NOT make the older ruling stop being current */
export const NON_SUPERSEDING = new Set(['extends', 'cites', 'confirms', 'applies']);
export const CLASS_SCOPES = ['game', 'digital', 'process'];

/**
 * Where a verifier's quoted code can stand as a rule's evidence (with an
 * executed test). A game rule is what the ENGINE does, so only engine source
 * counts. An Annex D rule (key `annexd.*`: the digital conventions — clocks,
 * auto-pass, undo, recap, reveal) is what the client and the game server do,
 * so their source counts too. Tests never count as the quoted code, and a
 * game rule whose only span is in client/ui or client/server still has none.
 */
export const ENGINE_EVIDENCE_ROOTS = ['client/engine/src/'];
export const DIGITAL_EVIDENCE_ROOTS = [...ENGINE_EVIDENCE_ROOTS, 'client/ui/', 'client/server/'];
const NOT_SOURCE = ['client/ui/test/', 'client/server/test/', 'client/server/e2e/'];
export const isAnnexD = (r) => /^annexd(\.|$)/.test(String(r?.key ?? ''));
export function isEvidenceSpan(r, file) {
  const f = String(file ?? '');
  if (NOT_SOURCE.some((p) => f.startsWith(p)) || /\.test\.[cm]?[jt]s$/.test(f) || f.includes('/node_modules/')) return false;
  return (isAnnexD(r) ? DIGITAL_EVIDENCE_ROOTS : ENGINE_EVIDENCE_ROOTS).some((p) => f.startsWith(p));
}

/** index the extract once: the lookups every check needs */
export function indexExtract(ex) {
  const pages = new Map((ex.printedPages ?? []).map((p) => [`${p.doc} p.${p.page}`, norm(p.text)]));
  const cards = new Map();
  for (const c of ex.cards ?? []) cards.set(c.name.toLowerCase(), norm([c.text, c.typeLine].filter(Boolean).join(' \n ')));
  const claims = new Map();
  const threads = new Set();
  for (const t of ex.raq ?? []) {
    threads.add(String(t.threadId));
    for (const c of t.claims ?? []) claims.set(c.id, c);
  }
  const rulings = new Map((ex.rulings ?? []).map((r) => [r.id, r]));
  const gloss = (ex.glossary ?? []).map((g) => ({ term: String(g.term ?? ''), text: norm(Object.values(g).filter((v) => typeof v === 'string').join(' \n ')) }));
  const tests = ex.tests ?? [];
  const symbols = new Set(ex.engineSymbols ?? []);
  return { pages, cards, claims, threads, rulings, gloss, tests, symbols };
}

/**
 * The terms the glossary must define, DERIVED, never listed: tag → what it is.
 *   zone:<z> phase:<p> step:<s> substep:<s>   the engine's enum exports (ex.enums),
 *                                              except the phase `gameover`, the
 *                                              engine's terminal state and not one of
 *                                              the turn's phases (rule 500.1)
 *   attr:<Name>                                every attribute (the 802 slots)
 *   ours:<Term>                                every row of client/ui/glossary.ts
 *   keyword:<key>                              every top-level rule of 801 and 803
 *                                              (keyword actions, other keywords)
 * A new zone, attribute, client-glossary row or keyword rule turns the gate red
 * until the glossary has an entry for it.
 */
export function glossaryTags(ex, ledger) {
  const tags = new Map();
  const en = ex?.enums ?? {};
  for (const z of en.zones ?? []) tags.set(`zone:${z}`, `the zone ${z}`);
  for (const p of en.phases ?? []) if (p !== 'gameover') tags.set(`phase:${p}`, `the phase ${p}`);
  for (const s of en.battleSteps ?? []) tags.set(`step:${s}`, `the battle step ${s}`);
  for (const s of en.damageSubSteps ?? []) tags.set(`substep:${s}`, `the damage sub-step ${s}`);
  for (const a of en.attrs ?? []) tags.set(`attr:${a}`, `the attribute ${a}`);
  for (const g of ex?.glossary ?? []) tags.set(`ours:${g.term}`, `the client glossary row ${g.term}`);
  for (const e of ledger?.entries ?? []) {
    if (e.kind !== 'section' && !e.removed && /^80[13]\.\d+$/.test(e.num)) tags.set(`keyword:${e.key}`, `keyword rule ${e.num} (${e.key})`);
  }
  return tags;
}

/** the test files an example/test reference names (by path suffix or basename) */
export function testFilesFor(X, file) {
  const f = file.replace(/^client\//, '');
  const exact = X.tests.filter((t) => t.file === f || t.file === file || t.file.endsWith(`/${f}`) || f.endsWith(`/${t.file}`));
  return exact.length ? exact : X.tests.filter((t) => basename(t.file) === basename(f));
}

/** how many test titles a `file::title` binding matches: exact first, then substring */
export function titleMatches(X, binding) {
  const i = binding.indexOf('::');
  const file = binding.slice(0, i), title = binding.slice(i + 2);
  const files = testFilesFor(X, file);
  if (!files.length) return { files: 0, n: 0 };
  const all = files.flatMap((t) => t.titles);
  const exact = all.filter((t) => t === title).length;
  // a title the index could only read up to a non-literal is a prefix of the real one
  const partial = files.flatMap((t) => t.partialTitles ?? []).filter((p) => title.startsWith(p) || p.includes(title)).length;
  return { files: files.length, n: exact || all.filter((t) => t.includes(title)).length + partial };
}

export function check(inputs, ex, opts = {}) {
  const repo = opts.repoRoot ?? REPO_ROOT;
  const X = indexExtract(ex);
  const problems = [], stale = [];
  const P = (code, where, msg) => problems.push({ code, where, msg });
  const S = (kind, where, msg) => stale.push({ kind, where, msg });
  const fileCache = new Map();
  const repoFile = (rel) => {
    if (!fileCache.has(rel)) {
      const abs = join(repo, rel);
      fileCache.set(rel, !isAbsolute(rel) && existsSync(abs) ? norm(readFileSync(abs, 'utf8')) : null);
    }
    return fileCache.get(rel);
  };

  /* reviewed state: supersession and classification */
  const edges = inputs.supersession?.edges ?? [];
  const accepted = edges.filter((e) => e.decision === 'accepted' && !NON_SUPERSEDING.has(e.relation));
  /** → null (current) | {whole: true} | {scopes: [...]} */
  const superseded = (id) => {
    const es = accepted.filter((e) => e.to === id);
    if (!es.length) return null;
    if (es.some((e) => !e.scope)) return { whole: true, by: es.map((e) => e.from) };
    return { whole: false, scopes: es.map((e) => e.scope), by: es.map((e) => e.from) };
  };

  /** resolve a source ref and check a quote against it; `code` names the failure */
  const quoteIn = (where, ref, quote, code = 'quote-not-verbatim') => {
    const r = parseRef(ref);
    const q = norm(quote ?? '');
    let text = null;
    if (!r) { P('source-missing', where, `${JSON.stringify(ref)} is not a resolvable reference`); return; }
    if (r.type === 'page') {
      // a printed page breaks words across lines ("defend-" / "ing"): join both
      // sides the same way, and let a quote end on the broken half-word
      text = X.pages.get(`${r.doc} p.${r.page}`);
      if (text !== undefined) {
        const join = (t) => t.replace(/(\w)- (\w)/g, '$1$2');
        if (q && join(text).includes(join(q).replace(/(\w)-$/, '$1'))) return;
      }
    }
    else if (r.type === 'card') text = X.cards.get(r.name.toLowerCase());
    else if (r.type === 'raq') {
      const c = X.claims.get(r.id);
      if (!c) { P('raq-missing', where, `RAQ claim ${r.id} does not exist`); return; }
      text = norm(`${c.claim ?? ''} \n ${c.source ?? ''}`);
    } else if (r.type === 'ruling') {
      const rr = X.rulings.get(r.id);
      if (!rr) { P('ruling-missing', where, `${r.id} does not exist`); return; }
      text = norm(`${rr.heading ?? ''} \n ${rr.body ?? ''}`);
    } else if (r.type === 'glossary') {
      const hit = X.gloss.filter((g) => g.term.toLowerCase() === r.term.toLowerCase());
      text = (hit.length ? hit : X.gloss).map((g) => g.text).join(' \n ') || null;
    } else if (r.type === 'file') text = repoFile(r.path);
    if (text === null || text === undefined) { P('source-missing', where, `${ref}: no such ${r.type}`); return; }
    if (!q || !text.includes(q)) P(code, where, `not verbatim in ${ref}: "${String(quote).slice(0, 90)}"`);
  };

  /* outline */
  if (!inputs.outline) P('schema', 'outline.json', 'the outline is missing');
  else for (const m of validateOutline(inputs.outline)) P('schema', 'outline.json', m);

  /* schemas */
  const all = [...inputs.records, ...inputs.glossary];
  for (const r of all) for (const m of validateRecord(r)) P('schema', inputs.fileOf?.get(r) ?? 'rules', m);
  for (const d of inputs.discrepancies) for (const m of validateDiscrepancy(d)) P('schema', inputs.fileOf?.get(d) ?? 'discrepancies', m);
  for (const v of inputs.verdicts) for (const m of validateVerdict(v)) P('schema', inputs.fileOf?.get(v) ?? 'verdicts', m);
  for (const f of inputs.findings) for (const m of validateFinding(f)) P('schema', inputs.fileOf?.get(f) ?? 'findings', m);
  const keyCount = new Map();
  for (const r of all) keyCount.set(r.key, (keyCount.get(r.key) ?? 0) + 1);
  for (const [k, n] of keyCount) if (n > 1) P('duplicate-key', k, `key ${k} is used by ${n} records`);
  // the per-unit files are written in parallel: an id two units both chose is caught here
  for (const [what, rows] of [['discrepancy', inputs.discrepancies], ['finding', inputs.findings], ['verdict', inputs.verdicts]]) {
    const n = new Map();
    for (const x of rows) { const id = what === 'verdict' ? x?.key : x?.id; n.set(id, (n.get(id) ?? 0) + 1); }
    for (const [id, c] of n) if (c > 1) P('duplicate-id', String(id), `${what} ${id} appears ${c} times`);
  }

  /* numbering */
  let M = null;
  if (inputs.outline) {
    try { M = buildModel(inputs, ex); } catch (e) { P('ledger', 'ledger.json', e.message); }
  }
  if (M) {
    for (const b of M.born) {
      const sec = M.sectionByNum.has(b.num);
      P('unnumbered', b.key, `${sec ? 'section' : 'rule'} ${b.key} has no number in the committed ledger (it would be ${b.num}): run cr:render`);
    }
    const slots = new Map(outlineSlots(inputs.outline, ex).map((s) => [s.key, s]));
    const sectionKeys = new Set([...M.sectionByNum.values()].map((s) => s.key));
    for (const e of inputs.ledger.entries) {
      if (e.removed || e.kind === 'section') continue;
      const k = e.key;
      if (!M.recByKey.has(k) && !slots.has(k) && !sectionKeys.has(k)) P('ledger-orphan', e.num, `${e.num} (${k}) has no record and no slot, and is not a tombstone: tombstone it (node ledger.mjs remove ${k} "<reason>")`);
    }
    for (const r of inputs.records) {
      const num = M.I.numOf(r.key);
      if (r.num !== undefined && num && r.num !== num) P('num-mismatch', r.key, `the record says ${r.num}; the ledger holds ${num}`);
      const sl = slots.get(r.key);
      if (sl && r.parent !== sl.parent) P('slot-parent-mismatch', r.key, `fills the outline slot under ${sl.parent} but says parent ${r.parent}`);
    }
  }
  const numOk = (ref) => {
    if (!M) return true;
    return !!M.numOfRef(ref);
  };
  /**
   * A cross-reference inside prose (a rule key, or "rule/section/see N") that
   * does not name a live rule would print as a raw key or a dead number: the
   * renderer resolves keys to numbers (render.mjs refResolver), so whatever it
   * cannot resolve fails here.
   */
  const proseRefs = (where, field, text) => {
    if (!M || typeof text !== 'string') return;
    for (const x of M.refsIn(text)) {
      if (!x.num) P('ref-unresolved', `${where} ${field}`, `${x.kind === 'key' ? 'key' : 'rule number'} ${x.ref} in the ${field} is not a live rule (renamed, removed or misspelt)`);
    }
  };
  const findingIds = new Set(inputs.findings.map((f) => f.id));
  const discIds = new Set(inputs.discrepancies.map((d) => d.id));
  const verdictByKey = new Map();
  for (const v of [...inputs.verdicts].sort((a, b) => a.round - b.round)) verdictByKey.set(M ? M.canon(v.key) : v.key, v);

  /* every record */
  for (const r of all) {
    const w = r.key ?? '(no key)';
    const s = r.sources ?? {};
    const arr = (k) => (Array.isArray(s[k]) ? s[k] : []);
    for (const [i, x] of arr('printed').entries()) quoteIn(`${w} printed[${i}]`, x.ref, x.quote);
    for (const [i, x] of arr('designer').entries()) quoteIn(`${w} designer[${i}]`, x.ref, x.quote);
    for (const [i, x] of arr('ours').entries()) quoteIn(`${w} ours[${i}]`, x.ref, x.quote);
    for (const [i, x] of arr('rulings').entries()) {
      const label = typeof x === 'string' ? x : x?.ref ?? '';
      const c = parseRulingCite(label);
      if (!c) continue; // schema already said so
      if (!X.rulings.has(c.id)) { P('ruling-missing', `${w} rulings[${i}]`, `${c.id} does not exist`); continue; }
      const sup = superseded(c.id);
      if (sup?.whole) P('ruling-superseded', `${w} rulings[${i}]`, `${c.id} is superseded (by ${sup.by.join(', ')}): cite it in history, not rulings`);
      else if (sup && !c.scope) P('ruling-scope-required', `${w} rulings[${i}]`, `${c.id} is partly superseded (${sup.scopes.join('; ')}): cite it with the scope that still stands`);
      if (typeof x === 'object' && x.quote !== undefined) quoteIn(`${w} rulings[${i}]`, c.id, x.quote);
    }
    for (const [i, h] of arr('history').entries()) {
      const c = parseRulingCite(h?.ruling ?? '');
      if (c && !X.rulings.has(c.id)) P('ruling-missing', `${w} history[${i}]`, `${c.id} does not exist`);
    }
    for (const e of arr('engine')) {
      for (const tok of String(e).split(/\s*[/,]\s*/).filter(Boolean)) {
        let sym = tok;
        const m = /^([\w./-]+\.(?:ts|mjs|js)):(.+)$/.exec(tok);
        if (m) {
          sym = m[2];
          const f = m[1].includes('/') ? m[1] : `client/engine/src/${m[1]}`;
          if (!repoFile(f.startsWith('client/') ? f : `client/engine/src/${f}`)) P('engine-symbol-missing', w, `engine file ${m[1]} does not exist`);
        }
        const id = sym.split('.').pop().replace(/\(\)$/, '');
        if (!X.symbols.has(id)) P('engine-symbol-missing', w, `engine symbol ${tok} is not declared in client/engine/src`);
      }
    }
    for (const t of arr('tests')) {
      const file = t.split('::')[0];
      if (!testFilesFor(X, file).length) P('test-file-missing', w, `test file ${file} is not in the tests index`);
      else if (t.includes('::')) { const n = titleMatches(X, t).n; if (n !== 1) P('example-test-unresolved', w, `test binding matches ${n} titles: ${t.slice(0, 120)}`); }
    }
    for (const [i, x] of (Array.isArray(r.examples) ? r.examples : []).entries()) {
      if (!x?.test) continue;
      const { files, n } = titleMatches(X, x.test);
      if (!files) P('example-test-unresolved', `${w} examples[${i}]`, `test file of ${x.test.split('::')[0]} is not in the tests index`);
      else if (n !== 1) P('example-test-unresolved', `${w} examples[${i}]`, `binding matches ${n} test titles (needs exactly 1): ${x.test.slice(0, 120)}`);
    }

    /* basis vs sources (ours never counts) */
    const hasPrinted = arr('printed').length > 0, hasDesigner = arr('designer').length > 0, hasRulings = arr('rulings').length > 0;
    const hasEngine = arr('engine').length > 0;
    const kinds = [hasPrinted, hasDesigner, hasRulings, hasEngine].filter(Boolean).length;
    const bad = (m) => { if (!('term' in r)) P('basis-inconsistent', w, `basis ${r.basis}: ${m}`); };
    if (r.basis === 'printed' && !hasPrinted) bad('needs a printed quote');
    if (r.basis === 'designer' && !hasDesigner) bad('needs a designer quote');
    if (r.basis === 'owner' && !hasRulings) bad('needs a ruling');
    if (r.basis === 'owner' && (hasPrinted || hasDesigner)) bad('has a printed or designer source, so it is not an owner call alone');
    if (r.basis === 'engine' && (hasPrinted || hasDesigner)) bad('has a printed or designer source, so it is not engine-only');
    if (r.basis === 'mixed' && kinds < 2) bad('needs sources of at least two kinds (printed, designer, rulings, engine)');

    /* the contract's first clause: at least one checkable evidence item */
    const quoted = hasPrinted || hasDesigner || arr('rulings').some((x) => typeof x === 'object' && x?.quote);
    const v = verdictByKey.get(M ? M.canon(r.key) : r.key);
    const demonstrated = v && v.textHash === recordHash(r)
      && (v.quote_spans ?? []).some((q) => isEvidenceSpan(r, q.file))
      && (v.tests_run ?? []).some((t) => t.passed);
    if (!('term' in r) && !quoted && !demonstrated) P('no-evidence', w, `no verbatim quote from a printed, designer or ruling source, and no verified code quote (engine source; for Annex D also client/ui or client/server source) with an executed test${hasEngine ? ' (engine symbols alone are not evidence)' : ''}`);

    /* the sources a later check can watch */
    const hashes = r.sourceHashes ?? {};
    for (const x of arr('rulings')) {
      const c = parseRulingCite(typeof x === 'string' ? x : x?.ref ?? '');
      if (c && X.rulings.has(c.id) && !(c.id in hashes)) P('source-hash-missing', w, `cites ${c.id} but carries no sourceHashes["${c.id}"]`);
    }
    for (const x of arr('designer')) {
      const k = String(x?.ref ?? '');
      if (X.claims.has(k.replace(/^RAQ /, '')) && !(k in hashes)) P('source-hash-missing', w, `quotes ${k} but carries no sourceHashes["${k}"]`);
    }
    for (const [k, h] of Object.entries(hashes)) {
      const c = parseRulingCite(k);
      if (c && c.scope === '') {
        const rr = X.rulings.get(c.id);
        if (!rr) P('ruling-missing', `${w} sourceHashes`, `${c.id} does not exist`);
        else if (rr.bodyHash !== h) S('source', w, `${c.id} changed since drafting`);
      } else if (k.startsWith('RAQ ')) {
        const cl = X.claims.get(k.slice(4));
        if (!cl) P('raq-missing', `${w} sourceHashes`, `${k} does not exist`);
        else if (cl.textHash !== h) S('source', w, `${k} changed since drafting`);
      }
    }

    proseRefs(w, 'text', r.text);
    for (const [i, x] of (Array.isArray(r.examples) ? r.examples : []).entries()) proseRefs(w, `examples[${i}]`, x?.text);
    for (const s2 of Array.isArray(r.see) ? r.see : []) {
      if (numOk(s2)) continue;
      if ('term' in r) P('glossary-see-unresolved', w, `the glossary entry "${r.term}" points at ${s2}, which is not a live rule number or key: a glossary row is a pointer, and this one points nowhere`);
      else P('see-unresolved', w, `see ${s2} is not a live rule number or key`);
    }
    for (const f of r.engineDiffers ?? []) if (!findingIds.has(f)) P('finding-missing', w, `engineDiffers names ${f}, which is not in findings.json`);
  }

  /* the glossary: a pointer layer over the numbered rules (see glossaryTags) */
  if (inputs.glossary.length) {
    const tags = glossaryTags(ex, M?.ledger);
    const covered = new Map();
    const terms = new Map();
    for (const g of inputs.glossary) {
      const w = g.key ?? '(no key)';
      for (const t of Array.isArray(g.derived) ? g.derived : []) {
        if (!tags.has(t)) P('glossary-tag-unknown', w, `derived tag ${t} names no zone, phase, step, sub-step, attribute, client-glossary row or 801/803 keyword rule (renamed or removed?)`);
        covered.set(t, w);
      }
      for (const [i, u] of (Array.isArray(g.usedBy) ? g.usedBy : []).entries()) quoteIn(`${w} usedBy[${i}]`, u?.ref, u?.quote);
      const t = String(g.term ?? '').toLowerCase();
      if (terms.has(t)) P('duplicate-term', w, `the term "${g.term}" is also ${terms.get(t)}`);
      terms.set(t, w);
    }
    for (const [t, what] of tags) if (!covered.has(t)) P('glossary-term-missing', t, `${what} has no glossary entry: add a row to rules/glossary.json whose derived tags include "${t}"`);
  }

  /* discrepancies: every side's quote verbatim, the rule resolves */
  for (const d of inputs.discrepancies) {
    for (const [i, sd] of (d.sides ?? []).entries()) {
      if (sd?.source && parseRef(sd.source)) quoteIn(`${d.id} sides[${i}]`, sd.source, sd.quote, 'discrepancy-quote-not-verbatim');
    }
    proseRefs(d.id, 'summary', d.summary);
    proseRefs(d.id, 'resolution', d.resolution);
    if (d.rule && !numOk(d.rule)) P('discrepancy-rule-unresolved', d.id, `rule ${d.rule} is not a live rule number or key`);
    /* a merged-in item: its rule still resolves, and its id is not also a live item */
    for (const s of Array.isArray(d.seeAlso) ? d.seeAlso : []) {
      if (s?.rule && !numOk(s.rule)) P('discrepancy-rule-unresolved', d.id, `seeAlso ${s.id}: rule ${s.rule} is not a live rule number or key`);
      if (discIds.has(s?.id)) P('duplicate-id', d.id, `seeAlso ${s.id} was merged into ${d.id} but is still an item of its own`);
    }
    const q = d.question;
    if (q && typeof q === 'object') {
      for (const k of ['ask', 'follows', 'recommend']) proseRefs(d.id, `question.${k}`, q[k]);
      for (const [i, r] of (Array.isArray(q.readings) ? q.readings : []).entries()) {
        proseRefs(d.id, `question.readings[${i}].text`, r?.text);
        proseRefs(d.id, `question.readings[${i}].table`, r?.table);
      }
    }
  }

  /* findings: the rule resolves; evidence that left its file is stale (the bug may be fixed) */
  for (const f of inputs.findings) {
    proseRefs(f.id, 'title', f.title);
    proseRefs(f.id, 'summary', f.summary);
    if (f.rule && !numOk(f.rule)) P('finding-rule-unresolved', f.id, `rule ${f.rule} is not a live rule number or key`);
    for (const d of f.dupes ?? []) if (!findingIds.has(d)) P('finding-missing', f.id, `dupes names ${d}, which is not in findings`);
    for (const e of f.evidence ?? []) {
      const t = repoFile(String(e.file ?? ''));
      if (t === null) P('source-missing', f.id, `evidence file ${e.file} does not exist (repo-relative paths only)`);
      else if (!t.includes(norm(e.quote ?? ''))) S('finding-evidence', f.id, `evidence no longer in ${e.file}: "${String(e.quote).slice(0, 80)}"`);
    }
  }

  /* verdicts: each is for a record; its quoted spans still in their files */
  const recKeys = new Set(all.map((r) => r.key));
  for (const v of inputs.verdicts) {
    const k = M ? M.canon(v.key) : v.key;
    if (v.verdict !== 'confirmed') proseRefs(v.key, 'verdict problem', v.problem);
    if (!recKeys.has(v.key) && !recKeys.has(k)) P('verdict-orphan', v.key, 'a verdict for a key no record has');
    for (const q of v.quote_spans ?? []) {
      if (isAbsolute(String(q.file))) { P('verdict-span-path', v.key, `span file ${q.file} must be repo-relative`); continue; }
      const t = repoFile(String(q.file));
      if (t === null) P('source-missing', v.key, `span file ${q.file} does not exist`);
      else if (!t.includes(norm(q.text ?? ''))) S('verdict-span', v.key, `verified span no longer in ${q.file}: "${String(q.text).slice(0, 80)}"`);
    }
  }

  /* supersession: every candidate decided; decided rows name real rulings */
  const decided = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const seenPairs = new Set();
  const undecided = [];
  for (const c of ex.supersessionCandidates ?? []) {
    const k = `${c.from}>${c.to}`;
    if (seenPairs.has(k)) continue;
    seenPairs.add(k);
    if (!decided.has(k)) undecided.push({ from: c.from, to: c.to });
  }
  for (const e of edges) {
    if (!X.rulings.has(e.from) || !X.rulings.has(e.to)) P('supersession-unresolved', `${e.from}>${e.to}`, 'a supersession row names a ruling that does not exist');
    if (!['accepted', 'rejected'].includes(e.decision)) P('schema', 'supersession.json', `${e.from}>${e.to}: decision must be accepted or rejected`);
  }

  /* classification: every ruling has a row; every row is a ruling */
  const cls = inputs.classification ?? {};
  const unclassified = (ex.rulings ?? []).map((r) => r.id).filter((id) => !(id in cls));
  for (const [id, c] of Object.entries(cls)) {
    if (!X.rulings.has(id)) P('classification-orphan', id, 'classified, but no such ruling');
    if (!CLASS_SCOPES.includes(c?.scope)) P('schema', 'classification.json', `${id}: scope must be ${CLASS_SCOPES.join('|')}`);
  }

  return { problems, stale, undecided, unclassified, cited: new Set(all.flatMap(citedRulings)) };
}

/**
 * Which drafting unit a problem or stale row belongs to (`U12`), by the file
 * its row came from: a schema problem names the file; every other `where`
 * starts with a record key, a discrepancy or finding id, or a verdict key.
 * null = global (the outline, the ledger, the reviewed register files).
 */
export function unitIndex(inputs) {
  const byId = new Map();
  for (const r of [...inputs.records, ...inputs.glossary]) byId.set(r.key, unitOfRow(inputs, r));
  for (const d of inputs.discrepancies) byId.set(d.id, unitOfRow(inputs, d));
  for (const f of inputs.findings) byId.set(f.id, unitOfRow(inputs, f));
  for (const v of inputs.verdicts) if (!byId.has(v.key)) byId.set(v.key, unitOfRow(inputs, v));
  return (p) => {
    const w = String(p.where ?? '');
    if (/\.json$/.test(w)) return basename(w, '.json');
    return byId.get(w.split(' ')[0]) ?? null;
  };
}

/**
 * `node check.mjs [--unit U12]`. With --unit, only that unit's problems and
 * stale rows are listed (and fail), and `unnumbered` is a note, not a problem:
 * numbers are born when cr:render runs at the end of a wave, never inside a
 * unit's round. Problems elsewhere are counted, not listed.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { unit: { type: 'string' } } });
  const { extract } = await import('./extract.mjs');
  const inputs = loadInputs();
  const r = check(inputs, extract());
  let problems = r.problems, stale = r.stale, notes = [], elsewhere = 0;
  if (values.unit) {
    const unitOf = unitIndex(inputs);
    const mine = problems.filter((p) => unitOf(p) === values.unit);
    elsewhere = problems.length - mine.length;
    notes = mine.filter((p) => p.code === 'unnumbered');
    problems = mine.filter((p) => p.code !== 'unnumbered');
    stale = stale.filter((s) => unitOf(s) === values.unit);
  }
  for (const p of problems) console.log(`PROBLEM ${p.code}  ${p.where}: ${p.msg}`);
  for (const s of stale) console.log(`stale   ${s.kind}  ${s.where}: ${s.msg}`);
  if (values.unit) {
    console.log(`${values.unit}: ${problems.length} problem(s); ${stale.length} stale; ${notes.length} record(s) not numbered yet (numbered at wave end by cr:render — not a problem); ${elsewhere} problem(s) outside this unit, not listed`);
  } else console.log(`${problems.length} problem(s); ${stale.length} stale; ${r.undecided.length} supersession candidate(s) undecided; ${r.unclassified.length} ruling(s) unclassified`);
  process.exit(problems.length ? 1 : 0);
}
