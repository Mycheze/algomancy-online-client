/**
 * The comprehensive-rules export's data shapes, as plain-JS validators.
 *
 * Every validator returns a list of human-readable problems (empty = valid);
 * none throws. They check SHAPE only — whether a quote is really in its
 * source, a ruling current or a test real is check.mjs's job, because that
 * needs the extract.
 *
 * The shapes (data/comprehensive-rules/README.md has the prose):
 *   rule record   CONTROL's v2 schema + `parent`, `order`, `sourceHashes`
 *   glossary row  a rule record with `term` instead of `parent`/`order`
 *   discrepancy   {id, kind, rule, summary, sides[{source, quote}], resolution, tier}
 *   verdict       {key, textHash, verdict, round, verifier, engine[], tests_run[],
 *                  probes[]?, source_checks[], quote_spans[], basis_ok, problem}
 *                  (textHash = recordHash: the text and the examples verified)
 *   finding       {id: F-U12-3, title, summary, evidence[{file, quote}], rule, ct?}
 */
import { createHash } from 'node:crypto';

export const BASES = ['printed', 'designer', 'owner', 'engine', 'mixed'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const VERDICTS = ['confirmed', 'partial', 'contradicted', 'unsupported', 'untested'];
/** the pilot's discrepancy kinds; the letter is what the report groups on */
export const DISC_KINDS = [
  'a-sources-disagree', 'b-engine-only', 'c-owner-call-only', 'd-raq-open',
  'f-register-chain-wrong', 'g-other',
];
/** the discrepancy report's four tiers, in the order a reader takes them */
export const TIERS = {
  1: 'Questions for the owner',
  2: 'Register and test fixes',
  3: 'Engine-only and owner-only rules',
  4: 'Everything else',
};
/** how long a quoted source span may be (the contract: ≤200 chars, one line) */
export const MAX_QUOTE = 200;

/** whitespace-normalised: every run of whitespace is one space, trimmed */
export const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** sha256 of the normalised text, 16 hex */
export const textHash = (s) => createHash('sha256').update(norm(s)).digest('hex').slice(0, 16);
/**
 * What a verdict pins: the rule's text and its examples with their test
 * bindings, since the verifier checked both. A record with no examples hashes
 * as its text alone. A verdict whose hash no longer matches is stale.
 */
export function recordHash(r) {
  const ex = Array.isArray(r?.examples) ? r.examples : [];
  if (!ex.length) return textHash(r?.text ?? '');
  return textHash([r.text, ...ex.map((x) => `${x?.text ?? ''} ⟦${x?.test ?? ''}⟧`)].join(' ¶ '));
}
/** a finding id: `F-U12-3` (unit-scoped, what the rounds write) or `F-3` */
export const FINDING_ID_RE = /^F-(?:U\d+-)?\d+$/;

/** a key: lower-case dotted segments, hyphens allowed inside a segment */
export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
/** a ruling citation: `R114`, `R197b`, optionally followed by a scope
 *  ("R7 its Piercing half") */
const RULING_CITE_RE = /^R(\d+)(b?)(?![\w])\s*(.*)$/;

/**
 * Parse a ruling citation. → {id, n, suffix, scope} or null.
 * `scope` is the text after the id ('' when the citation is bare).
 */
export function parseRulingCite(s) {
  const m = RULING_CITE_RE.exec(String(s).trim());
  if (!m) return null;
  return { id: `R${m[1]}${m[2]}`, n: Number(m[1]), suffix: m[2], scope: m[3].trim() };
}

/**
 * Parse a source reference, as written in a record's `ref` or a discrepancy
 * side's `source`. → {type, …} or null.
 *   Manual p.N · Rulebook 2023 p.N       → printed page
 *   card: <Name>                         → a card's printed text
 *   RAQ <threadId>#<i>                   → a designer claim
 *   R<n>[b] …                            → a ruling body
 *   glossary: <Term>                     → our glossary (never authority)
 *   file: <repo-relative path>           → a file in the repo (engine code, a test)
 */
export function parseRef(ref) {
  const s = String(ref).trim();
  let m;
  if ((m = /^Manual p\.(\d+)$/.exec(s))) return { type: 'page', doc: 'Manual', page: Number(m[1]) };
  if ((m = /^Rulebook 2023 p\.(\d+)$/.exec(s))) return { type: 'page', doc: 'Rulebook 2023', page: Number(m[1]) };
  if ((m = /^card: (.+)$/.exec(s))) return { type: 'card', name: m[1].trim() };
  if ((m = /^RAQ (\d+)#(\d+)$/.exec(s))) return { type: 'raq', id: `${m[1]}#${m[2]}`, threadId: m[1] };
  if ((m = /^glossary: (.+)$/.exec(s))) return { type: 'glossary', term: m[1].trim() };
  if ((m = /^file: (.+)$/.exec(s))) return { type: 'file', path: m[1].trim() };
  const r = parseRulingCite(s);
  if (r) return { type: 'ruling', ...r };
  return null;
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string';
const nonEmpty = (x) => isStr(x) && x.trim() !== '';

function quoteProblems(where, q) {
  const out = [];
  if (!nonEmpty(q)) out.push(`${where}: quote is empty`);
  else {
    if (q.length > MAX_QUOTE) out.push(`${where}: quote is ${q.length} chars (max ${MAX_QUOTE})`);
    if (/[\r\n]/.test(q)) out.push(`${where}: quote spans more than one line`);
  }
  return out;
}

function refQuoteList(where, list, refOk, refHint) {
  const out = [];
  if (!Array.isArray(list)) return [`${where}: must be an array`];
  list.forEach((x, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(x)) { out.push(`${w}: must be {ref, quote}`); return; }
    if (!nonEmpty(x.ref) || !refOk(x.ref)) out.push(`${w}: ref ${JSON.stringify(x.ref)} is not ${refHint}`);
    out.push(...quoteProblems(w, x.quote));
  });
  return out;
}

const SOURCE_FIELDS = ['printed', 'designer', 'ours', 'rulings', 'history', 'engine', 'tests'];

/** a section/parent number: `608`, `D3`; a rule number: `608.2`; a subrule: `608.2b` */
export const SECTION_NUM_RE = /^(?:\d{3}|D\d+)$/;
export const RULE_NUM_RE = /^(?:\d{3}|D\d+)\.\d+$/;
export const ANY_NUM_RE = /^(?:\d{3}|D\d+)(?:\.\d+(?:[a-z]+)?)?$/;

/**
 * A rule record (or, with `term`, a glossary row). → problems[]
 */
export function validateRecord(r) {
  const out = [];
  if (!isObj(r)) return ['record is not an object'];
  const id = r.key ?? r.num ?? '(no key)';
  const P = (m) => out.push(`${id}: ${m}`);
  const glossary = 'term' in r;
  if (!nonEmpty(r.key) || !KEY_RE.test(r.key)) P(`key ${JSON.stringify(r.key)} is not a dotted lower-case key`);
  if (!nonEmpty(r.text)) P('text is empty');
  if (glossary) {
    if (!nonEmpty(r.term)) P('term is empty');
    if (!Array.isArray(r.see) || r.see.length === 0) P('a glossary row needs at least one "see" target');
    if (r.obsolete !== undefined && typeof r.obsolete !== 'boolean') P('obsolete must be a boolean');
  } else {
    if (!nonEmpty(r.parent)) P('parent is missing (the rule it hangs under, e.g. "608" or "608.2", or a key)');
    else if (r.parent.includes('.') && /^\d/.test(r.parent) && !RULE_NUM_RE.test(r.parent) && !SECTION_NUM_RE.test(r.parent)) P(`parent ${r.parent} is a subrule: rules go three levels deep at most`);
    if (typeof r.order !== 'number' || !Number.isFinite(r.order)) P('order must be a finite number');
  }
  if (r.num !== undefined && (!isStr(r.num) || !ANY_NUM_RE.test(r.num))) P(`num ${JSON.stringify(r.num)} is not a rule number`);
  if (!Array.isArray(r.examples)) P('examples must be an array');
  else r.examples.forEach((x, i) => {
    if (!isObj(x) || !nonEmpty(x.text)) P(`examples[${i}] needs text`);
    else if (x.test !== undefined && x.test !== null && !(isStr(x.test) && x.test.includes('::'))) P(`examples[${i}].test must be "<file>::<test title>"`);
  });
  if (!Array.isArray(r.see) || !r.see.every(nonEmpty)) P('see must be an array of rule numbers or keys');
  // a glossary row is a definition pointing at its rule; the rule carries the basis
  if (!(glossary && r.basis === undefined) && !BASES.includes(r.basis)) P(`basis ${JSON.stringify(r.basis)} is not one of ${BASES.join('|')}`);
  if (!(glossary && r.confidence === undefined) && !CONFIDENCES.includes(r.confidence)) P(`confidence ${JSON.stringify(r.confidence)} is not one of ${CONFIDENCES.join('|')}`);
  if (r.notes !== undefined && !isStr(r.notes)) P('notes must be a string');
  if (r.engineDiffers !== undefined && (!Array.isArray(r.engineDiffers) || !r.engineDiffers.every((f) => FINDING_ID_RE.test(f)))) P('engineDiffers must be an array of finding ids (F-U<nn>-<n>)');
  if (r.untested !== undefined && typeof r.untested !== 'boolean') P('untested must be a boolean');
  if (!isObj(r.sourceHashes)) P('sourceHashes must be an object ({"R114": bodyHash, "RAQ <id>#<i>": textHash})');
  else for (const [k, v] of Object.entries(r.sourceHashes)) {
    if (!(parseRulingCite(k)?.scope === '' || /^RAQ \d+#\d+$/.test(k))) P(`sourceHashes key ${JSON.stringify(k)} is not "R<n>" or "RAQ <id>#<i>"`);
    if (!nonEmpty(v)) P(`sourceHashes[${k}] is empty`);
  }
  const s = r.sources;
  if (!isObj(s)) { P('sources must be an object'); return out; }
  for (const k of Object.keys(s)) if (!SOURCE_FIELDS.includes(k)) P(`sources.${k} is not a source field`);
  for (const k of SOURCE_FIELDS) if (s[k] !== undefined && !Array.isArray(s[k])) P(`sources.${k} must be an array`);
  const pre = `${id}: sources`;
  if (Array.isArray(s.printed)) out.push(...refQuoteList(`${pre}.printed`, s.printed, (x) => parseRef(x)?.type === 'page' || parseRef(x)?.type === 'card', '"Manual p.N", "Rulebook 2023 p.N" or "card: <Name>"'));
  if (Array.isArray(s.designer)) out.push(...refQuoteList(`${pre}.designer`, s.designer, (x) => parseRef(x)?.type === 'raq', '"RAQ <threadId>#<i>"'));
  if (Array.isArray(s.ours)) out.push(...refQuoteList(`${pre}.ours`, s.ours, (x) => parseRef(x)?.type === 'glossary', '"glossary: <Term>"'));
  if (Array.isArray(s.rulings)) s.rulings.forEach((x, i) => {
    if (isStr(x)) { if (!parseRulingCite(x)) P(`sources.rulings[${i}] ${JSON.stringify(x)} is not a ruling citation`); }
    else if (isObj(x)) {
      if (!parseRulingCite(x.ref ?? '')) P(`sources.rulings[${i}].ref is not a ruling citation`);
      if (x.quote !== undefined) out.push(...quoteProblems(`${pre}.rulings[${i}]`, x.quote));
    } else P(`sources.rulings[${i}] must be "R<n>" or {ref, quote}`);
  });
  if (Array.isArray(s.history)) s.history.forEach((h, i) => {
    if (!isObj(h) || !parseRulingCite(h.ruling ?? '') || !nonEmpty(h.relation)) P(`sources.history[${i}] must be {ruling: "R<n>", relation}`);
  });
  if (Array.isArray(s.engine) && !s.engine.every(nonEmpty)) P('sources.engine must hold non-empty strings');
  if (Array.isArray(s.tests) && !s.tests.every(nonEmpty)) P('sources.tests must hold non-empty strings');
  return out;
}

/** a discrepancy → problems[] */
export function validateDiscrepancy(d) {
  const out = [];
  if (!isObj(d)) return ['discrepancy is not an object'];
  const P = (m) => out.push(`${d.id ?? '(no id)'}: ${m}`);
  if (!nonEmpty(d.id) || !/^D[\w.-]+$/.test(d.id)) P('id must be D<…>');
  if (!DISC_KINDS.includes(d.kind)) P(`kind ${JSON.stringify(d.kind)} is not one of ${DISC_KINDS.join('|')}`);
  if (!nonEmpty(d.rule)) P('rule is missing');
  if (!nonEmpty(d.summary)) P('summary is empty');
  if (!nonEmpty(d.resolution)) P('resolution is empty');
  if (![1, 2, 3, 4].includes(d.tier)) P('tier must be 1, 2, 3 or 4');
  if (!Array.isArray(d.sides) || d.sides.length === 0) P('sides must be a non-empty array');
  else d.sides.forEach((x, i) => {
    if (!isObj(x) || !nonEmpty(x.source)) P(`sides[${i}] needs a source`);
    else if (!parseRef(x.source)) P(`sides[${i}].source ${JSON.stringify(x.source)} is not a resolvable reference`);
    if (isObj(x)) out.push(...quoteProblems(`${d.id}: sides[${i}]`, x.quote));
  });
  return out;
}

/** a verifier's verdict → problems[] */
export function validateVerdict(v) {
  const out = [];
  if (!isObj(v)) return ['verdict is not an object'];
  const P = (m) => out.push(`verdict ${v.key ?? '(no key)'}: ${m}`);
  if (!nonEmpty(v.key) || !KEY_RE.test(v.key)) P('key is not a rule key');
  if (!nonEmpty(v.textHash)) P('textHash is missing');
  if (!VERDICTS.includes(v.verdict)) P(`verdict ${JSON.stringify(v.verdict)} is not one of ${VERDICTS.join('|')}`);
  if (!Number.isInteger(v.round) || v.round < 1) P('round must be an integer ≥ 1');
  if (!nonEmpty(v.verifier)) P('verifier is missing');
  for (const k of ['engine', 'tests_run', 'source_checks', 'quote_spans']) if (!Array.isArray(v[k])) P(`${k} must be an array`);
  if (Array.isArray(v.tests_run)) v.tests_run.forEach((t, i) => {
    if (!isObj(t) || !nonEmpty(t.file) || typeof t.passed !== 'boolean') P(`tests_run[${i}] must be {file, pattern, passed, asserts_claim}`);
  });
  if (Array.isArray(v.quote_spans)) v.quote_spans.forEach((q, i) => {
    if (!isObj(q) || !nonEmpty(q.file) || !nonEmpty(q.text)) P(`quote_spans[${i}] must be {file, text}`);
  });
  if (typeof v.basis_ok !== 'boolean') P('basis_ok must be a boolean');
  if (!isStr(v.problem)) P('problem must be a string ("" when none)');
  return out;
}

/** an engine finding (a bug or divergence, filed as a CT ticket) → problems[] */
export function validateFinding(f) {
  const out = [];
  if (!isObj(f)) return ['finding is not an object'];
  const P = (m) => out.push(`${f.id ?? '(no id)'}: ${m}`);
  if (!nonEmpty(f.id) || !FINDING_ID_RE.test(f.id)) P('id must be F-U<nn>-<n>');
  if (!nonEmpty(f.title)) P('title is empty');
  if (!nonEmpty(f.summary)) P('summary is empty');
  if (!nonEmpty(f.rule)) P('rule is missing');
  if (f.ct !== undefined && f.ct !== null && !/^CT-\d+$/.test(f.ct)) P('ct must be CT-<n>');
  if (!Array.isArray(f.evidence) || f.evidence.length === 0) P('evidence must be a non-empty array');
  else f.evidence.forEach((e, i) => {
    if (!isObj(e) || !nonEmpty(e.file)) P(`evidence[${i}] needs a file`);
    if (isObj(e)) out.push(...quoteProblems(`${f.id}: evidence[${i}]`, e.quote));
  });
  return out;
}

/** the numbering ledger → problems[] (shape and uniqueness; ledger.mjs owns the rules) */
export function validateLedger(l) {
  const out = [];
  if (!isObj(l) || l.version !== 1 || !Array.isArray(l.entries) || !Array.isArray(l.aliases)) return ['ledger must be {version: 1, entries: [], aliases: []}'];
  const nums = new Set(), keys = new Set();
  for (const e of l.entries) {
    if (!isObj(e) || !nonEmpty(e.num) || !ANY_NUM_RE.test(e.num) || !nonEmpty(e.key)) { out.push(`ledger entry ${JSON.stringify(e)} needs num and key`); continue; }
    if (nums.has(e.num)) out.push(`ledger: number ${e.num} is held twice`);
    if (keys.has(e.key)) out.push(`ledger: key ${e.key} is held twice`);
    nums.add(e.num); keys.add(e.key);
    if (e.removed !== undefined && !nonEmpty(e.removed)) out.push(`ledger: tombstone ${e.num} needs a reason`);
  }
  for (const a of l.aliases) {
    if (!isObj(a) || !nonEmpty(a.from) || !nonEmpty(a.to)) out.push(`ledger alias ${JSON.stringify(a)} needs from and to`);
    else if (keys.has(a.to)) out.push(`ledger: alias target ${a.to} is itself a ledger key`);
  }
  return out;
}

/** outline.json → problems[] */
export function validateOutline(o) {
  const out = [];
  if (!isObj(o)) return ['outline is not an object'];
  if (!nonEmpty(o.title)) out.push('outline: title is missing');
  const ed = o.edition;
  if (!isObj(ed) || !nonEmpty(ed.name) || !/^\d{4}-\d{2}-\d{2}$/.test(ed.effective ?? '') || !nonEmpty(ed.engineCommit)) out.push('outline: edition must be {name, effective: YYYY-MM-DD, engineCommit}');
  const nums = new Set(), keys = new Set();
  const sec = (s, where) => {
    if (!isObj(s) || !SECTION_NUM_RE.test(s.num ?? '') || !nonEmpty(s.title) || !KEY_RE.test(s.key ?? '')) { out.push(`outline: ${where} section ${JSON.stringify(s?.num)} needs num, key and title`); return; }
    if (nums.has(s.num)) out.push(`outline: section ${s.num} appears twice`);
    if (keys.has(s.key)) out.push(`outline: key ${s.key} appears twice`);
    nums.add(s.num); keys.add(s.key);
    for (const sl of s.slots ?? []) {
      if (!KEY_RE.test(sl.key ?? '') || !nonEmpty(sl.title) || typeof sl.order !== 'number') out.push(`outline: section ${s.num} slot ${JSON.stringify(sl)} needs key, title, order`);
      else if (keys.has(sl.key)) out.push(`outline: key ${sl.key} appears twice`);
      else keys.add(sl.key);
    }
    if (s.generate !== undefined && (!isObj(s.generate) || !nonEmpty(s.generate.from) || !nonEmpty(s.generate.key) || typeof s.generate.orderStart !== 'number')) out.push(`outline: section ${s.num} generate needs from, key, orderStart`);
  };
  if (!Array.isArray(o.chapters) || o.chapters.length === 0) out.push('outline: chapters must be a non-empty array');
  else for (const c of o.chapters) {
    if (!isObj(c) || !nonEmpty(c.num) || !nonEmpty(c.title) || !Array.isArray(c.sections)) { out.push(`outline: chapter ${JSON.stringify(c?.num)} needs num, title, sections`); continue; }
    for (const s of c.sections) sec(s, `chapter ${c.num}`);
  }
  if (!isObj(o.annexD) || !Array.isArray(o.annexD.sections)) out.push('outline: annexD.sections is missing');
  else for (const s of o.annexD.sections) sec(s, 'Annex D');
  for (const k of ['annexP', 'glossary', 'changelog']) if (!isObj(o[k]) || !nonEmpty(o[k].title)) out.push(`outline: ${k}.title is missing`);
  return out;
}
