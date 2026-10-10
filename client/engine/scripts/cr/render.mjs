/**
 * Render the comprehensive rules: outline.json + rules/*.json + the ledger +
 * verdicts + discrepancies + findings (+ the extract, for the attribute list
 * and Annex P) → the document in three editions, Annex D, the discrepancy
 * report, the owner's questions (its first tier) and the changelog.
 *
 * `render(inputs, extract)` is PURE and byte-deterministic: no clock, no git,
 * no environment. The edition, effective date and engine commit come from
 * outline.json, set by hand at release, so committing does not change the
 * document. Run as a script it allocates numbers for unseen keys (ledger.mjs —
 * the only place a number is born), writes the ledger, and writes every file.
 *
 *   npm --prefix client run cr:render
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import {
  CR_OUTLINE, CR_FRONT_MATTER, CR_RULES_DIR, CR_LEDGER, CR_VERDICTS_DIR, CR_DISCREPANCIES_DIR,
  CR_FINDINGS_DIR, CR_CLASSIFICATION, CR_SUPERSESSION, CR_DOC, CR_DOC_HTML, CR_DOC_TXT,
  CR_ANNEX_D, CR_DISCREPANCIES_MD, CR_OWNER_QUESTIONS, CR_CHANGELOG, CR_REVIEW_DEBUG_JSON,
} from '../paths.mjs';
import { allocate, compareNums, formatLedger, indexLedger, parseNum, readLedger, resolveKey } from './ledger.mjs';
import { ANY_NUM_RE, BASES, TIERS, VERDICTS, parseRulingCite, recordHash } from './schema.mjs';

/* ── inputs ─────────────────────────────────────────────────────────────── */

const readJson = (p, dflt) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);

/**
 * Everything on disk the renderer and the checker read. `records` are the
 * numbered rule records (sections 1–9 and Annex D); `glossary` the rows with
 * a `term`; `fileOf` names the rules/*.json file each came from.
 */
export function loadInputs(paths = {}) {
  const P = inputPaths(paths);
  const records = [], glossary = [], fileOf = new Map();
  for (const [f, r] of unitRows(P.rulesDir, '')) { fileOf.set(r, f); (r && 'term' in r ? glossary : records).push(r); }
  /** a per-unit dir's rows, each remembered with the file it came from */
  const rows = (dir, label) => unitRows(dir, `${label}/`).map(([f, r]) => { fileOf.set(r, f); return r; });
  return {
    outline: readJson(P.outline, null),
    frontMatter: existsSync(P.frontMatter) ? readFileSync(P.frontMatter, 'utf8') : '',
    records, glossary, fileOf,
    ledger: readLedger(P.ledger),
    verdicts: rows(P.verdictsDir, 'verdicts'),
    discrepancies: rows(P.discrepanciesDir, 'discrepancies'),
    findings: rows(P.findingsDir, 'findings'),
    classification: readJson(P.classification, null),
    supersession: readJson(P.supersession, null),
  };
}

/** where each input lives: the committed tree, unless a caller (a test) says otherwise */
function inputPaths(paths = {}) {
  return {
    outline: CR_OUTLINE, frontMatter: CR_FRONT_MATTER, rulesDir: CR_RULES_DIR, ledger: CR_LEDGER,
    verdictsDir: CR_VERDICTS_DIR, discrepanciesDir: CR_DISCREPANCIES_DIR, findingsDir: CR_FINDINGS_DIR,
    classification: CR_CLASSIFICATION, supersession: CR_SUPERSESSION, ...paths,
  };
}

/**
 * Every file and directory loadInputs() reads, absolute, in a fixed order: a
 * cache keyed on their mtimes goes stale exactly when the document could
 * change. The directories are in it so a NEW record file counts too.
 */
function inputFiles(paths = {}) {
  const P = inputPaths(paths);
  const out = [P.outline, P.frontMatter, P.ledger, P.classification, P.supersession];
  for (const dir of [P.rulesDir, P.verdictsDir, P.discrepanciesDir, P.findingsDir]) {
    out.push(dir);
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) out.push(join(dir, f));
  }
  return out;
}

/** every row of every `<unit>.json` array in a dir, as [file label, row], files in name order */
function unitRows(dir, prefix) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`${prefix}${f}: a per-unit file is an array of rows`);
    for (const r of rows) out.push([`${prefix}${f}`, r]);
  }
  return out;
}

/** the drafting unit a loaded row came from (`U12`), by its file; null for a fixture row */
export function unitOfRow(inputs, row) {
  const f = inputs.fileOf?.get(row);
  return f ? basename(f, '.json') : null;
}

/* ── the model: what gets a number, and what each number shows ──────────── */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** every section of the outline, chapters then Annex D */
export function outlineSections(outline) {
  const out = [];
  for (const c of outline.chapters) for (const s of c.sections) out.push({ ...s, chapter: c.num, annex: false });
  for (const s of outline.annexD?.sections ?? []) out.push({ ...s, chapter: 'D', annex: true });
  return out;
}

/** the titled slots the outline declares, including the generated ones
 *  (802.N: one per attribute, in the engine's Attr order, from the extract) */
export function outlineSlots(outline, ex) {
  const slots = [];
  for (const s of outlineSections(outline)) {
    for (const sl of s.slots ?? []) slots.push({ key: sl.key, title: sl.title, order: sl.order, parent: s.num });
    if (s.generate) {
      const g = s.generate;
      const list = ex?.enums?.[g.from];
      if (!Array.isArray(list)) throw new Error(`outline ${s.num}: the extract has no enums.${g.from} to generate from`);
      list.forEach((name, i) => slots.push({
        key: g.key.replace('{slug}', slug(name)), title: g.title.replace('{name}', name),
        order: g.orderStart + i, parent: s.num, generated: true,
      }));
    }
  }
  return slots;
}

/** the allocate() input: sections (pinned), slots, and the records — a record
 *  with a slot's key fills that slot and is numbered where the slot is */
export function ledgerItems(outline, records, ex) {
  const slots = outlineSlots(outline, ex);
  const slotKeys = new Set(slots.map((s) => s.key));
  return [
    ...outlineSections(outline).map((s) => ({ key: s.key, num: s.num, section: true })),
    ...slots.map((s) => ({ key: s.key, parent: s.parent, order: s.order })),
    ...records.filter((r) => !slotKeys.has(r.key)).map((r) => ({ key: r.key, parent: r.parent, order: r.order })),
  ];
}

/**
 * Number what is unseen and index everything. → the context both render and
 * check work from. Throws (LedgerError) if the ledger cannot be extended.
 */
export function buildModel(inputs, ex) {
  const { outline, records, glossary, verdicts, discrepancies, findings } = inputs;
  const { ledger, born } = allocate(ledgerItems(outline, records, ex), inputs.ledger, { edition: outline.edition?.name });
  const I = indexLedger(ledger);
  const canon = (k) => resolveKey(ledger, k);
  const recByKey = new Map(records.map((r) => [canon(r.key), r]));
  const slotByKey = new Map(outlineSlots(outline, ex).map((s) => [s.key, s]));
  const sectionByNum = new Map(outlineSections(outline).map((s) => [s.num, s]));
  const verdictByKey = new Map();
  for (const v of [...verdicts].sort((a, b) => a.round - b.round)) verdictByKey.set(canon(v.key), v);
  /** a rule number, or a key → its live number; undefined if neither */
  const numOfRef = (ref) => {
    if (typeof ref !== 'string') return undefined;
    if (ANY_NUM_RE.test(ref)) { const e = I.byNum.get(ref); return e && !e.removed ? ref : undefined; }
    return I.numOf(ref);
  };
  const R = refResolver(ledger, I);
  const discByNum = new Map();
  for (const d of [...discrepancies].sort((a, b) => cmpStr(a.id, b.id))) {
    // a merged item points from its own rule and from every merged-in item's rule
    for (const ref of [d.rule, ...(d.seeAlso ?? []).map((x) => x.rule)]) {
      const n = numOfRef(ref) ?? ref;
      if (!discByNum.has(n)) discByNum.set(n, []);
      if (!discByNum.get(n).includes(d)) discByNum.get(n).push(d);
    }
  }
  return {
    inputs, ex, outline, ledger, born, I, canon, recByKey, slotByKey, sectionByNum, verdictByKey,
    numOfRef, refsIn: R.refsIn, refText: R.refText, discByNum, glossary, findings: [...findings].sort((a, b) => cmpNumId(a.id, b.id)),
    discrepancies: [...discrepancies].sort((a, b) => cmpStr(a.id, b.id)),
  };
}

/**
 * Cross-references inside prose. A record may name another rule by its KEY
 * ("two strips that each fall under the other are rule effects.stripping.mutual")
 * — keys are permanent, numbers are the ledger's — and the renderer prints the
 * key's live number in its place. A key-shaped token is a dotted lowercase name
 * whose first segment is one the ledger's keys use (derived, never listed),
 * not part of a test binding (`file::cr:key`) and not a file name.
 *
 *   refText(s)  → s with every resolvable key replaced by "rule N" ("section N"
 *                 for a section; the bare number after "rule"/"section" already)
 *   refsIn(s)   → [{ref, kind: 'key'|'num', num}] every key-shaped token (a
 *                 family "key.*" too, which has no number) and every "rule N" /
 *                 "section N" / "see N.N" number in s; num undefined = dangling.
 *                 check.mjs fails on each dangling one.
 */
const FILE_EXT = new Set(['ts', 'mts', 'mjs', 'js', 'json', 'jsonl', 'md', 'html', 'txt', 'py', 'css']);
export function refResolver(ledger, I = indexLedger(ledger)) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heads = [...new Set(ledger.entries.map((e) => String(e.key).split('.')[0]))].sort();
  for (const a of ledger.aliases ?? []) heads.push(String(a.to).split('.')[0]);
  const keyRe = () => new RegExp(`(?<![\\w.:/\\-])((?:${[...new Set(heads)].map(esc).join('|')})(?:\\.[a-z0-9][a-z0-9-]*)+)(\\.\\*)?(?![\\w-]|\\.[A-Za-z0-9])`, 'g');
  // "see" is also a verb ("could only see 494"): after it, only a dotted number counts
  const numRe = () => /\b(?:(?:rules?|sections?) ((?:\d{3}|D\d+)(?:\.\d+[a-z]{0,2})?)|see ((?:\d{3}|D\d+)\.\d+[a-z]{0,2}))\b/gi;
  const isFile = (t) => FILE_EXT.has(t.split('.').pop());
  const liveNum = (n) => { const e = I.byNum.get(n); return e && !e.removed ? n : undefined; };
  const refsIn = (s) => {
    const out = [];
    const t = String(s ?? '');
    for (const m of t.matchAll(keyRe())) {
      if (isFile(m[1])) continue;
      // "annexd.display.*" names a family of keys, not a rule: it has no number
      out.push(m[2] ? { ref: `${m[1]}.*`, kind: 'key', num: undefined } : { ref: m[1], kind: 'key', num: I.numOf(m[1]) });
    }
    for (const m of t.matchAll(numRe())) { const n = m[1] ?? m[2]; out.push({ ref: n, kind: 'num', num: liveNum(n) }); }
    return out;
  };
  const refText = (s) => String(s ?? '').replace(keyRe(), (m, k, star, off, all) => {
    if (isFile(k) || star) return m;
    const n = I.numOf(k);
    if (!n) return m;
    if (/\b(?:rules?|sections?) $/i.test(all.slice(Math.max(0, off - 9), off))) return n;
    return `${I.entryOf(k)?.kind === 'section' ? 'section' : 'rule'} ${n}`;
  });
  return { refsIn, refText };
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** F-3 < F-12; F-U2-9 < F-U12-1 < F-U12-10 (unit, then number) */
const idParts = (id) => String(id).split('-').slice(1).map((x) => Number(x.replace(/^U/, '')));
const cmpNumId = (a, b) => {
  const x = idParts(a), y = idParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return cmpStr(a, b);
};

/** the verifier's latest verdict on a record, and whether it still fits the text */
export function verdictOf(M, rec) {
  const v = M.verdictByKey.get(M.canon(rec.key));
  if (!v) return null;
  return { ...v, stale: v.textHash !== recordHash(rec) };
}

/** every rule entry (live and tombstoned, not sections) under one section, in order */
function entriesOf(M, sectionNum) {
  return M.ledger.entries
    .filter((e) => e.kind !== 'section' && parseNum(e.num)?.section === sectionNum)
    .sort((a, b) => compareNums(a.num, b.num));
}

/** what a ledger entry shows: {num, level, title?, rec?, tomb?} */
function viewOf(M, e) {
  const p = parseNum(e.num);
  const level = p.sub ? 2 : 1;
  if (e.removed) {
    return { num: e.num, level, key: e.key, tomb: { reason: e.removed, replacedBy: e.replacedBy ? M.numOfRef(e.replacedBy) ?? e.replacedBy : null } };
  }
  return { num: e.num, level, key: e.key, title: M.slotByKey.get(e.key)?.title, rec: M.recByKey.get(e.key) };
}

/** the rulings a record cites (current and history), as ids */
export function citedRulings(rec) {
  const s = rec.sources ?? {};
  const out = [];
  for (const x of s.rulings ?? []) { const c = parseRulingCite(typeof x === 'string' ? x : x.ref ?? ''); if (c) out.push(c.id); }
  for (const h of s.history ?? []) { const c = parseRulingCite(h.ruling ?? ''); if (c) out.push(c.id); }
  return out;
}
const rulingLabel = (x) => (typeof x === 'string' ? x : x.ref);

/* ── shared text helpers ────────────────────────────────────────────────── */

const BASIS_LABEL = { printed: 'Printed', designer: 'Designer', mixed: 'Mixed', owner: 'Owner call', engine: 'Engine only' };
const VERDICT_LABEL = { confirmed: 'Confirmed', partial: 'Partial', contradicted: 'Contradicted', unsupported: 'Unsupported', untested: 'Untested' };
const KIND_LABEL = { a: 'Sources disagree', b: 'Engine only', c: 'Owner call only', d: 'RAQ open', f: 'Register chain wrong', g: 'Other' };

function seeNums(M, rec) {
  return (rec.see ?? []).map((s) => M.numOfRef(s) ?? `${s}(?)`);
}
function seeSentence(nums) {
  if (!nums.length) return '';
  return ` See rule${nums.length > 1 ? 's' : ''} ${nums.join(', ')}.`;
}
function exampleText(t) {
  return String(t).replace(/^\s*Example:\s*/i, '');
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/**
 * The test files that demonstrate a rule on every run of the gate: the files
 * its examples are bound to and the files its sources cite (an entry may be
 * `file::title`; the file is what the gate runs).
 */
export function gateTestFiles(rec) {
  const file = (t) => String(t).split('::')[0].trim();
  const out = new Set();
  for (const x of rec.examples ?? []) if (x.test) out.add(file(x.test));
  for (const t of rec.sources?.tests ?? []) out.add(file(t));
  out.delete('');
  return [...out].sort();
}
/**
 * What a rule's evidence line says: the verification round, how many tests
 * the verifier ran (the gate's, and probes it wrote itself) and whether they
 * passed, and how many gate test files are bound to the rule. The three
 * editions and the review page all say it with these phrases.
 */
function evidence(M, rec, v = verdictOf(M, rec)) {
  let ran = null;
  if (v && !v.stale) {
    const runs = [...(v.tests_run ?? []), ...(v.probes ?? [])].filter((t) => t.passed === true || t.passed === false);
    const probes = (v.probes ?? []).filter((t) => t.passed === true || t.passed === false).length;
    const fail = runs.filter((t) => t.passed === false).length;
    ran = !runs.length ? 'verifier ran no tests'
      : `verifier ran ${plural(runs.length, 'test')}${probes ? ` (${probes === 1 ? 'a probe it wrote' : `${probes} probes it wrote`})` : ''}, ${
        !fail ? (runs.length === 1 ? 'passed' : 'all passed') : `${fail} failed`}`;
  }
  const g = gateTestFiles(rec).length;
  return { v, round: v && !v.stale ? v.round : null, ran, gate: g ? plural(g, 'gate test file') : 'no gate test' };
}
/** md and txt: "confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file" */
function verdictWords(M, rec) {
  const { v, round, ran, gate } = evidence(M, rec);
  const head = !v ? 'not verified' : v.stale ? 'not verified (the text changed after verification)' : `${v.verdict} in round ${round}`;
  return [head, ran, gate].filter(Boolean).join('; ');
}
function provenanceBits(M, rec) {
  const s = rec.sources ?? {};
  const bits = [`Basis: ${BASIS_LABEL[rec.basis] ?? rec.basis}`, `Verified: ${verdictWords(M, rec)}`];
  if (s.printed?.length) bits.push(`Printed: ${s.printed.map((x) => x.ref).join('; ')}`);
  if (s.designer?.length) bits.push(`Designer: ${s.designer.map((x) => x.ref).join('; ')}`);
  if (s.rulings?.length) bits.push(`Rulings: ${s.rulings.map(rulingLabel).join(', ')}`);
  if (s.history?.length) bits.push(`Replaces: ${s.history.map((h) => `${h.ruling} (${h.relation})`).join('; ')}`);
  if (s.ours?.length) bits.push(`Our glossary (not a source): ${s.ours.map((x) => x.ref.replace(/^glossary: /, '')).join('; ')}`);
  if (s.engine?.length) bits.push(`Engine: ${s.engine.join(', ')}`);
  if (s.tests?.length) bits.push(`Tests: ${s.tests.join(', ')}`);
  bits.push(`Key: ${rec.key}`);
  return bits;
}
function differsText(rec) {
  return (rec.engineDiffers?.length ? ` (Engine differs, see ${rec.engineDiffers.join(', ')}.)` : '')
    + (rec.untested ? ' (Untested: no executed test demonstrates it.)' : '');
}
/* A chip named in the front matter's prose, `{chip:printed}` or `{chip:confirmed}`:
 * the HTML editions draw the very chip a rule wears, beside the sentence that says
 * what it means; the .md and .txt editions read its label as a plain word. A name
 * that is neither a basis nor a verdict fails the render. */
const FRONT_CHIP = /\{chip:([a-z]+)\}/g;
function frontChip(name, html) {
  const [cls, label] = BASIS_LABEL[name] ? [`b-${name}`, BASIS_LABEL[name]]
    : VERDICT_LABEL[name] ? [`v-${name}`, VERDICT_LABEL[name]] : [null, null];
  if (!cls) throw new Error(`front matter: {chip:${name}} is neither a basis nor a verdict`);
  return html ? `<span class="chip ${cls}">${label}</span>` : label;
}
/** the front matter with its placeholders filled; `html` keeps the chip tokens for mdToHtml */
function fillFront(M, text, { html = false } = {}) {
  const ed = M.outline.edition;
  const t = text.replaceAll('{{EDITION}}', ed.name).replaceAll('{{EFFECTIVE}}', ed.effective).replaceAll('{{ENGINE_COMMIT}}', ed.engineCommit);
  return html ? t : t.replace(FRONT_CHIP, (_, n) => frontChip(n, false));
}

/* ── Annex P's numbers, computed once for all three editions ───────────── */

export function provenance(M) {
  const numbered = [...M.recByKey.values()];
  const basis = Object.fromEntries(BASES.map((b) => [b, 0]));
  for (const r of numbered) basis[r.basis] = (basis[r.basis] ?? 0) + 1;
  const verdicts = { ...Object.fromEntries(VERDICTS.map((v) => [v, 0])), 'not verified': 0, 'text changed': 0 };
  for (const r of numbered) {
    const v = verdictOf(M, r);
    if (!v) verdicts['not verified']++;
    else if (v.stale) verdicts['text changed']++;
    else verdicts[v.verdict]++;
  }
  const engineOnly = numbered.filter((r) => r.basis === 'engine').map((r) => ({ num: M.I.numOf(r.key), rec: r }))
    .sort((a, b) => compareNums(a.num, b.num));
  const cited = new Set([...numbered, ...M.glossary].flatMap(citedRulings));
  const cls = M.inputs.classification;
  const rows = cls ? Object.entries(cls).sort((a, b) => cmpRuling(a[0], b[0])) : [];
  const uncitedGame = rows.filter(([id, c]) => c.scope === 'game' && !cited.has(id)).map(([id]) => id);
  const process = rows.filter(([, c]) => c.scope === 'process').map(([id, c]) => ({ id, reason: c.reason ?? '' }));
  return { total: numbered.length, basis, verdicts, engineOnly, uncitedGame, process, classified: !!cls };
}
function cmpRuling(a, b) {
  const A = parseRulingCite(a), B = parseRulingCite(b);
  return (A?.n ?? 0) - (B?.n ?? 0) || cmpStr(A?.suffix ?? '', B?.suffix ?? '');
}

/** the changelog, from the ledger's edition stamps */
function changelog(M) {
  const ed = new Map();
  const get = (name) => { const k = name ?? '(no edition)'; if (!ed.has(k)) ed.set(k, { born: [], sections: 0, removed: [], renamed: [] }); return ed.get(k); };
  for (const e of [...M.ledger.entries].sort((a, b) => compareNums(a.num, b.num))) {
    if (e.kind === 'section') get(e.since).sections++;
    else get(e.since).born.push(e);
    if (e.removed) get(e.removedIn).removed.push(e);
  }
  for (const a of [...M.ledger.aliases].sort((x, y) => cmpStr(x.from, y.from))) get(a.since).renamed.push(a);
  return [...ed].sort((a, b) => cmpStr(a[0], b[0]));
}

/* ── Markdown ───────────────────────────────────────────────────────────── */

const mdEsc = (s) => String(s).replace(/\*/g, '\\*');

function mdRule(M, v) {
  const a = `<a id="r${v.num}"></a>`;
  const label = v.level === 1 ? `${v.num}.` : v.num;
  if (v.tomb) return `${a}**${label}** [Removed: ${v.tomb.reason}]${v.tomb.replacedBy ? ` Replaced by ${v.tomb.replacedBy}.` : ''}\n`;
  const head = v.title ? `**${label} ${v.title}.**` : `**${label}**`;
  if (!v.rec) return `${a}${head}${v.title ? '' : ' [No record]'}\n`;
  const r = v.rec;
  const lines = [`${a}${head} ${M.refText(r.text)}${seeSentence(seeNums(M, r))}${differsText(r) ? ` *${differsText(r).trim()}*` : ''}`];
  for (const x of r.examples ?? []) {
    lines.push('', `> *Example (non-normative): ${mdEsc(M.refText(exampleText(x.text)))}*${x.test ? ` <sub>test: ${x.test}</sub>` : ''}`);
  }
  lines.push('', `<sub>${provenanceBits(M, r).join(' · ')}</sub>`);
  const ds = M.discByNum.get(v.num);
  if (ds) lines.push('', `<sub>Discrepancies: ${ds.map((d) => d.id).join(', ')} (discrepancies.md)</sub>`);
  return lines.join('\n') + '\n';
}

function mdSection(M, s) {
  const out = [`<a id="r${s.num}"></a>`, `### ${s.num}. ${s.title}`, ''];
  const es = entriesOf(M, s.num);
  if (!es.length) out.push('*No rules drafted yet.*', '');
  for (const e of es) out.push(mdRule(M, viewOf(M, e)));
  return out.join('\n');
}

function mdAnnexP(M, P) {
  const o = M.outline;
  const out = [`## ${o.annexP.title}`, '', 'Generated from the records, the verdicts and the ruling classification. Nothing here is a rule.', ''];
  out.push(`### Basis`, '', `${P.total} numbered rules.`, '', '| basis | rules |', '|---|---|');
  for (const b of BASES) out.push(`| ${BASIS_LABEL[b]} | ${P.basis[b] ?? 0} |`);
  out.push('', '### Verification', '', '| verdict | rules |', '|---|---|');
  for (const [k, n] of Object.entries(P.verdicts)) out.push(`| ${k} | ${n} |`);
  out.push('', '### Engine-only rules (awaiting the owner\'s sign-off)', '');
  if (!P.engineOnly.length) out.push('None.');
  for (const { num, rec } of P.engineOnly) out.push(`- [${num}](#r${num}) ${M.refText(rec.text)}`);
  out.push('', '### Findings: where the engine differs', '');
  if (!M.findings.length) out.push('None.');
  for (const f of M.findings) out.push(`- <a id="${f.id}"></a>**${f.id}** ${M.refText(f.title)}${f.ct ? ` (${f.ct})` : ''}. ${f.rule ? `Rule ${M.numOfRef(f.rule) ?? f.rule}` : 'Ruling register'}. ${M.refText(f.summary)}${f.dupes?.length ? ` Also found as ${f.dupes.join(', ')}.` : ''}${f.closed ? ` Re-checked: ${f.closed}` : ''}`);
  out.push('', '### Game rulings no rule cites', '');
  if (!P.classified) out.push('The rulings are not classified yet.');
  else out.push(P.uncitedGame.length ? P.uncitedGame.join(', ') : 'None.');
  out.push('', '### Process rulings, excluded', '');
  if (!P.classified) out.push('The rulings are not classified yet.');
  else if (!P.process.length) out.push('None.');
  else for (const p of P.process) out.push(`- ${p.id}${p.reason ? `: ${p.reason}` : ''}`);
  return out.join('\n') + '\n';
}

function mdGlossary(M) {
  const rows = [...M.glossary].sort((a, b) => cmpStr(a.term.toLowerCase(), b.term.toLowerCase()) || cmpStr(a.key, b.key));
  const out = [`## ${M.outline.glossary.title}`, ''];
  if (!rows.length) out.push('*No entries yet.*');
  for (const g of rows) out.push(`**${g.term}**${g.obsolete ? ' (Obsolete)' : ''}: ${M.refText(g.text)}${seeSentence(seeNums(M, g))}`, '');
  return out.join('\n').trimEnd() + '\n';
}

function mdChangelog(M, standalone) {
  const out = [standalone ? `# ${M.outline.title}: ${M.outline.changelog.title}` : `## ${M.outline.changelog.title}`, ''];
  out.push('Keyed by rule key. A number never moves, so a rule is new, removed or renamed; text changes to a rule are not listed yet.', '');
  for (const [name, c] of changelog(M)) {
    out.push(`${standalone ? '##' : '###'} ${name}`, '');
    out.push(`- New: ${c.born.length} rule${c.born.length === 1 ? '' : 's'}${c.sections ? ` and ${c.sections} section${c.sections === 1 ? '' : 's'}` : ''}.`);
    if (standalone) for (const e of c.born) out.push(`  - ${e.num} \`${e.key}\``);
    for (const e of c.removed) out.push(`- Removed: ${e.num} \`${e.key}\`: ${e.removed}${e.replacedBy ? ` (replaced by \`${e.replacedBy}\`)` : ''}`);
    for (const a of c.renamed) out.push(`- Renamed: \`${a.from}\` → \`${a.to}\``);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

function renderMd(M, P) {
  const o = M.outline;
  const out = [`# ${o.title}`, '', `*${o.subtitle ?? ''}*`, '', fillFront(M, M.inputs.frontMatter).trimEnd(), '', '## Contents', ''];
  for (const c of o.chapters) {
    out.push(`- ${c.num}. ${c.title}`);
    for (const s of c.sections) out.push(`  - [${s.num}. ${s.title}](#r${s.num})`);
  }
  out.push(`- ${o.annexP.title}`, `- ${o.glossary.title}`, `- ${o.changelog.title}`, `- ${o.annexD.title} (a separate document)`, '');
  for (const c of o.chapters) {
    out.push(`## ${c.num}. ${c.title}`, '');
    for (const s of c.sections) out.push(mdSection(M, s));
  }
  out.push(mdAnnexP(M, P), mdGlossary(M), mdChangelog(M, false));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Annex D's lead paragraph, which no section holds: the .md bytes and the html */
const mdAnnexDLead = (M) => `## Precedence\n\n${M.outline.annexD.precedence ?? ''}\n`;
const htmlAnnexDLead = (M) => `<p>${E(M.outline.annexD.precedence ?? '')}</p>`;

function renderAnnexD(M) {
  const o = M.outline;
  const out = [`# ${o.annexD.title}`, '', `*${o.title}. ${o.subtitle ?? ''}*`, '', mdAnnexDLead(M)];
  for (const s of o.annexD.sections) out.push(mdSection(M, s));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** "D-U18-1 (rule 801.9a), D-U07-16 (rule 404.5)": the items merged into this one */
const alsoFiled = (M, d) => (d.seeAlso ?? []).map((x) => `${x.id} (rule ${M.numOfRef(x.rule) ?? x.rule})`).join(', ');

function mdQuestion(M, q) {
  const out = [`**Question:** ${M.refText(q.ask)}`, ''];
  for (const r of q.readings ?? []) out.push(`- **Reading ${r.label}.** ${M.refText(r.text)} *At the table:* ${M.refText(r.table)}`);
  out.push('', `**The document today:** ${M.refText(q.follows)}`, '', `**Recommended:** ${M.refText(q.recommend)}`, '');
  return out;
}

function renderDiscMd(M) {
  const out = [`# ${M.outline.title}: Discrepancy Report`, '',
    'Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision, and owner-questions.md lists it on its own; every other item already says which source decides and which side the document follows. An item filed by more than one drafting unit is kept once, and names the others under "Also filed as".', ''];
  for (const t of [1, 2, 3, 4]) {
    const ds = M.discrepancies.filter((d) => d.tier === t);
    out.push(`## ${t}. ${TIERS[t]} (${ds.length})`, '');
    if (!ds.length) out.push('None.', '');
    for (const d of ds) {
      out.push(`### ${d.id} · ${KIND_LABEL[d.kind?.[0]] ?? d.kind} · rule ${M.numOfRef(d.rule) ?? d.rule}`, '', M.refText(d.summary), '');
      if (d.seeAlso?.length) out.push(`*Also filed as ${alsoFiled(M, d)}.*`, '');
      for (const sd of d.sides ?? []) out.push(`- ${sd.source}: "${sd.quote}"`);
      out.push('');
      if (d.question) out.push(...mdQuestion(M, d.question));
      out.push(`**Resolution:** ${M.refText(d.resolution)}`, '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * owner-questions.md: the first tier on its own, numbered and grouped by topic,
 * each answerable in one line. Topics come in the order of their first rule;
 * within a topic, items follow their rule numbers.
 */
function ownerQuestionGroups(M) {
  const qs = M.discrepancies.filter((d) => d.tier === 1 && d.question)
    .map((d) => ({ d, num: M.numOfRef(d.rule) ?? d.rule }))
    .sort((a, b) => compareNums(a.num, b.num) || cmpStr(a.d.id, b.d.id));
  const topics = [];
  for (const x of qs) if (!topics.includes(x.d.question.topic)) topics.push(x.d.question.topic);
  let n = 0;
  return topics.map((topic) => ({ topic, items: qs.filter((x) => x.d.question.topic === topic).map((x) => ({ ...x, n: ++n })) }));
}

function renderOwnerQuestions(M) {
  const groups = ownerQuestionGroups(M);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const out = [`# ${M.outline.title}: Questions for the Owner`, '',
    `${total} question${total === 1 ? '' : 's'}. In each, the authoritative source's own words support two readings and no higher source decides between them; everything else in discrepancies.md is already decided by the authority order or awaits sign-off there. Answer each with one line: the reading you choose. Each item's full record, with every quote, is in discrepancies.md under its id.`, ''];
  for (const { topic, items } of groups) {
    out.push(`## ${topic}`, '');
    for (const { d, num, n } of items) {
      const q = d.question;
      out.push(`### ${n}. ${M.refText(q.ask)}`, '', `*${d.id}, rule ${num}${d.seeAlso?.length ? `; also filed as ${alsoFiled(M, d)}` : ''}.*`, '');
      for (const sd of d.sides ?? []) out.push(`- ${sd.source}: "${sd.quote}"`);
      out.push('');
      for (const r of q.readings ?? []) out.push(`- **${r.label}.** ${M.refText(r.text)} *At the table:* ${M.refText(r.table)}`);
      out.push('', `**Today:** ${M.refText(q.follows)}`, '', `**Recommended:** ${M.refText(q.recommend)}`, '', '**Answer:**', '');
    }
  }
  if (!total) out.push('None.', '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── plain text ─────────────────────────────────────────────────────────── */

/** typographic symbols as ASCII text tokens; Markdown marks dropped */
const TXT_TOKENS = [
  [/[—]/g, '--'], [/[–]/g, '-'], [/→/g, '->'], [/←/g, '<-'], [/[“”]/g, '"'],
  [/[‘’]/g, "'"], [/…/g, '...'], [/·/g, '|'], [/×/g, 'x'], [/≤/g, '<='],
  [/≥/g, '>='], [/✓/g, '[ok]'], [/⚠️?/g, '(!)'], [/ /g, ' '], [/−/g, '-'],
];
export function toTxt(s) {
  let t = String(s);
  for (const [re, rep] of TXT_TOKENS) t = t.replace(re, rep);
  return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2').replace(/`([^`]+)`/g, '$1');
}

function txtRule(M, v) {
  const label = v.level === 1 ? `${v.num}.` : v.num;
  const pad = ' '.repeat(6);
  if (v.tomb) return `${label} [Removed: ${v.tomb.reason}]${v.tomb.replacedBy ? ` Replaced by ${v.tomb.replacedBy}.` : ''}\n`;
  const head = v.title ? `${label} ${v.title}.` : label;
  if (!v.rec) return `${head}${v.title ? '' : ' [No record]'}\n`;
  const r = v.rec;
  const lines = [`${head} ${M.refText(r.text)}${seeSentence(seeNums(M, r))}${differsText(r)}`];
  for (const x of r.examples ?? []) lines.push(`${pad}Example (non-normative): ${M.refText(exampleText(x.text))}${x.test ? ` [test: ${x.test}]` : ''}`);
  lines.push(`${pad}[${provenanceBits(M, r).join(' | ')}]`);
  return lines.join('\n') + '\n';
}

/** one section as the .txt edition lists it, before the edition-wide clean-up (txtClean) */
function txtSectionLines(M, s) {
  const out = [`${s.num}. ${s.title}`, ''];
  const es = entriesOf(M, s.num);
  if (!es.length) out.push('No rules drafted yet.', '');
  for (const e of es) out.push(txtRule(M, viewOf(M, e)));
  return out;
}
/** Markdown prose (Annex P, the glossary, the changelog) as the .txt edition prints it */
const txtOfMd = (s) => s.replace(/<a id="[^"]*"><\/a>/g, '').replace(/^#+ /gm, '').replace(/\[([^\]]+)\]\(#[^)]*\)/g, '$1').replace(/<\/?sub>/g, '');
/** the .txt edition's last pass: ASCII tokens, no trailing blanks, no runs of empty lines */
const txtClean = (s) => toTxt(s).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');

function renderTxt(M, md) {
  const o = M.outline;
  const out = [o.title.toUpperCase(), o.subtitle ?? '', '', fillFront(M, M.inputs.frontMatter).replace(/^#+ /gm, '').trimEnd(), '', 'CONTENTS', ''];
  for (const c of o.chapters) {
    out.push(`${c.num}. ${c.title}`);
    for (const s of c.sections) out.push(`   ${s.num}. ${s.title}`);
  }
  out.push('');
  for (const c of o.chapters) {
    out.push('', `${c.num}. ${c.title.toUpperCase()}`, '');
    for (const s of c.sections) out.push(...txtSectionLines(M, s));
  }
  // Annex P, the glossary and the changelog are prose already; reuse the Markdown
  const tail = md.slice(md.indexOf(`## ${o.annexP.title}`));
  out.push('', txtOfMd(tail));
  return txtClean(out.join('\n')).trimEnd() + '\n';
}

/* ── HTML ───────────────────────────────────────────────────────────────── */

const E = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** inline Markdown (code, bold, em) + symbol tokens + links to known rule numbers */
function inline(M, s, { link = true } = {}) {
  let t = E(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/(\{[A-Za-z/][A-Za-z0-9/ ]{0,20}\}|\[(?:once|one|two|three|zero|x|Switch|Augment|Haste|Battle|Virus)\])/g, '<span class="sym">$1</span>');
  if (link) {
    t = t.replace(/\b(rules?|section) ((?:\d{3}|D\d+)(?:\.\d+[a-z]{0,2})?)\b/g, (m, w, n) => (M.numOfRef(n) ? `${w} <a href="#r${n}">${n}</a>` : m));
    t = t.replace(/(?<![\w.#>])((?:\d{3}|D\d+)\.\d+[a-z]{0,2})\b(?![^<]*<\/a>)/g, (m, n) => (M.numOfRef(n) ? `<a href="#r${n}">${n}</a>` : m));
  }
  return t;
}

/** a small Markdown → HTML for the hand-written front matter */
function mdToHtml(M, text) {
  const out = [];
  let para = [], list = false;
  const flush = () => { if (para.length) { out.push(`<p>${inline(M, para.join(' '), { link: false })}</p>`); para = []; } };
  const endList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const line of text.split('\n')) {
    let m;
    if ((m = /^(#{1,4}) (.*)$/.exec(line))) { flush(); endList(); const lv = Math.min(6, m[1].length + 1); out.push(`<h${lv}>${inline(M, m[2], { link: false })}</h${lv}>`); continue; }
    if ((m = /^- (.*)$/.exec(line))) { flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(M, m[1], { link: false })}</li>`); continue; }
    if (/^\s+\S/.test(line) && list) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(M, line.trim(), { link: false })}</li>`); continue; }
    if (!line.trim()) { flush(); endList(); continue; }
    para.push(line.trim());
  }
  flush(); endList();
  return out.join('\n').replace(FRONT_CHIP, (_, n) => frontChip(n, true));
}

function htmlSources(M, rec) {
  const s = rec.sources ?? {};
  const rows = [];
  for (const [k, label] of [['printed', 'Printed'], ['designer', 'Designer'], ['ours', 'Our glossary (not a source)']]) {
    for (const x of s[k] ?? []) rows.push(`<li><span class="sk">${label}</span> ${E(x.ref)}: <q>${E(x.quote)}</q></li>`);
  }
  for (const x of s.rulings ?? []) {
    if (typeof x === 'string') rows.push(`<li><span class="sk">Ruling</span> ${E(x)}</li>`);
    else rows.push(`<li><span class="sk">Ruling</span> ${E(x.ref)}${x.quote ? `: <q>${E(x.quote)}</q>` : ''}</li>`);
  }
  for (const h of s.history ?? []) rows.push(`<li><span class="sk">Replaces</span> ${E(h.ruling)}: ${E(h.relation)}</li>`);
  if (s.engine?.length) rows.push(`<li><span class="sk">Engine</span> ${s.engine.map((e) => `<code>${E(e)}</code>`).join(', ')}</li>`);
  if (s.tests?.length) rows.push(`<li><span class="sk">Tests</span> ${s.tests.map((t) => `<code>${E(t)}</code>`).join(', ')}</li>`);
  return `<ul class="src">${rows.join('')}</ul>`;
}

const EVIDENCE_TITLE = 'gate test files: the test files bound to this rule through its examples or sources, which run on every check of the client';
function htmlVerdict(M, rec) {
  const v = verdictOf(M, rec);
  const { round, ran, gate } = evidence(M, rec, v);
  const words = [round !== null ? `verified in round ${round}` : null, ran, gate].filter(Boolean).join(' · ');
  const meta = `<span class="meta" title="${EVIDENCE_TITLE}">${E(words)}</span>`;
  if (!v) return ['<span class="chip v-none">Not verified</span>' + meta, ''];
  if (v.stale) return ['<span class="chip v-none">Not verified: text changed</span>' + meta, ''];
  const chip = `<span class="chip v-${E(v.verdict)}">${VERDICT_LABEL[v.verdict] ?? E(v.verdict)}</span>`;
  const note = v.verdict !== 'confirmed' && v.problem ? `<p class="vnote"><strong>Verifier:</strong> ${E(M.refText(v.problem))}</p>` : '';
  return [chip + meta, note];
}

/**
 * The review page's mark: `data-crt="<target>"` on a commentable item's root
 * element (ui/crtypes.ts CrTarget). The published editions are rendered with
 * `review` false and carry none; with it true the item is otherwise the same
 * bytes, so the page shows exactly what the document says.
 */
const crt = (review, target) => (review ? ` data-crt="${E(target)}"` : '');

function htmlRule(M, v, review = false) {
  const lvl = v.level === 2 ? 'r-sub' : 'r-top';
  const label = v.level === 1 ? `${v.num}.` : v.num;
  const num = `<a class="num" href="#r${v.num}">${label}</a>`;
  const mark = crt(review, `rule:${v.key}`);
  if (v.tomb) {
    return `<article class="rule ${lvl} tomb" id="r${v.num}"${mark}><p class="rt">${num} [Removed: ${E(v.tomb.reason)}]${v.tomb.replacedBy ? ` Replaced by <a href="#r${E(v.tomb.replacedBy)}">${E(v.tomb.replacedBy)}</a>.` : ''}</p></article>`;
  }
  const title = v.title ? `<strong class="rtitle">${E(v.title)}.</strong> ` : '';
  if (!v.rec) return `<article class="rule ${lvl}" id="r${v.num}"${mark}><p class="rt">${num} ${title}${v.title ? '' : '<span class="meta">[No record]</span>'}</p></article>`;
  const r = v.rec;
  const see = seeNums(M, r);
  const seeHtml = see.length ? ` See rule${see.length > 1 ? 's' : ''} ${see.map((n) => (M.numOfRef(n) ? `<a href="#r${n}">${n}</a>` : E(n))).join(', ')}.` : '';
  const differs = r.engineDiffers?.length ? ` <span class="differs">engine differs, see ${r.engineDiffers.map((f) => `<a href="#${E(f)}">${E(f)}</a>`).join(', ')}</span>` : '';
  const untested = r.untested ? ' <span class="chip v-untested">Untested</span>' : '';
  const ex = (r.examples ?? []).map((x) => `<p class="ex"><span class="exl">Example (non-normative).</span> ${inline(M, M.refText(exampleText(x.text)))}${x.test ? ` <span class="tb">test: ${E(x.test)}</span>` : ''}</p>`).join('');
  const [chip, vnote] = htmlVerdict(M, r);
  const ds = M.discByNum.get(v.num) ?? [];
  const dl = ds.length ? ` <span class="meta">${ds.map((d) => `<a href="#${E(d.id)}">${E(d.id)}</a>`).join(' ')}</span>` : '';
  return `<article class="rule ${lvl}" id="r${v.num}"${mark}>
<p class="rt">${num} ${title}${inline(M, M.refText(r.text))}${seeHtml}${differs}${untested}</p>${ex}
<div class="tags"><span class="chip b-${E(r.basis)}">${BASIS_LABEL[r.basis] ?? E(r.basis)}</span>${chip}${dl}</div>${vnote}
<details><summary>Provenance <span class="meta">key ${E(r.key)}</span></summary>${htmlSources(M, r)}</details>
</article>`;
}

function htmlSection(M, s, review = false) {
  const es = entriesOf(M, s.num);
  return `<section class="sec"${crt(review, `sec:${s.num}`)}><h3 id="r${s.num}"><a class="num" href="#r${s.num}">${s.num}.</a> ${E(s.title)}</h3>
${es.length ? es.map((e) => htmlRule(M, viewOf(M, e), review)).join('\n') : '<p class="meta">No rules drafted yet.</p>'}
</section>`;
}

function htmlDisc(M) {
  const out = [];
  for (const t of [1, 2, 3, 4]) {
    const ds = M.discrepancies.filter((d) => d.tier === t);
    out.push(`<h3>${E(TIERS[t])} <span class="count">${ds.length}</span></h3>`);
    for (const d of ds) out.push(htmlDiscItem(M, d));
  }
  return out.join('\n');
}

/** one item of the discrepancy report */
function htmlDiscItem(M, d, review = false) {
  const n = M.numOfRef(d.rule);
  const sides = (d.sides ?? []).map((sd) => `<li><span class="sk">${E(sd.source)}</span> <q>${E(sd.quote ?? '')}</q></li>`).join('');
  const also = d.seeAlso?.length ? `\n<p class="meta">${d.seeAlso.map((x) => `<span id="${E(x.id)}"></span>`).join('')}Also filed as ${d.seeAlso.map((x) => { const m = M.numOfRef(x.rule); return `${E(x.id)} (${m ? `<a href="#r${m}">rule ${m}</a>` : `rule ${E(x.rule)}`})`; }).join(', ')}.</p>` : '';
  const q = d.question;
  const qh = q ? `\n<p class="q"><strong>Question:</strong> ${inline(M, M.refText(q.ask))}</p>
<ul class="readings">${(q.readings ?? []).map((r) => `<li><strong>Reading ${E(r.label)}.</strong> ${inline(M, M.refText(r.text))} <em>At the table:</em> ${inline(M, M.refText(r.table))}</li>`).join('')}</ul>
<p><strong>The document today:</strong> ${inline(M, M.refText(q.follows))}</p>
<p><strong>Recommended:</strong> ${inline(M, M.refText(q.recommend))}</p>` : '';
  return `<article class="disc" id="${E(d.id)}"${crt(review, `disc:${d.id}`)}>
<p class="dh"><span class="num">${E(d.id)}</span> <span class="chip k-${E(d.kind?.[0] ?? 'g')}">${KIND_LABEL[d.kind?.[0]] ?? E(d.kind)}</span> ${n ? `<a class="meta" href="#r${n}">rule ${n}</a>` : `<span class="meta">rule ${E(d.rule)}</span>`}</p>
<p>${inline(M, M.refText(d.summary))}</p>${also}
<ul class="src">${sides}</ul>${qh}
<p class="res"><strong>Resolution:</strong> ${inline(M, M.refText(d.resolution))}</p>
</article>`;
}

function htmlAnnexP(M, P, review = false) {
  const o = M.outline;
  const tbl = (rows) => `<div class="tw"><table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table></div>`;
  const out = [`<h2 id="annex-p">${E(o.annexP.title)}</h2>`, '<p>Generated from the records, the verdicts and the ruling classification. Nothing here is a rule.</p>'];
  out.push(`<div class="figs"><div class="fig"><b>${P.total}</b><span>numbered rules</span></div>${BASES.map((b) => `<div class="fig"><b>${P.basis[b] ?? 0}</b><span>${BASIS_LABEL[b]}</span></div>`).join('')}</div>`);
  out.push('<h3>Verification</h3>', tbl([['verdict', 'rules'], ...Object.entries(P.verdicts).map(([k, n]) => [E(k), n])]));
  out.push('<h3>Engine-only rules (awaiting the owner\'s sign-off)</h3>');
  out.push(P.engineOnly.length ? `<ul>${P.engineOnly.map(({ num, rec }) => `<li><a href="#r${num}">${num}</a> ${inline(M, M.refText(rec.text))}</li>`).join('')}</ul>` : '<p>None.</p>');
  out.push('<h3>Findings: where the engine differs</h3>');
  out.push(M.findings.length ? M.findings.map((f) => {
    const n = M.numOfRef(f.rule);
    return `<article class="disc" id="${E(f.id)}"${crt(review, `finding:${f.id}`)}><p class="dh"><span class="num">${E(f.id)}</span> <strong>${inline(M, M.refText(f.title), { link: false })}</strong>${f.ct ? ` <span class="meta">${E(f.ct)}</span>` : ''} ${n ? `<a class="meta" href="#r${n}">rule ${n}</a>` : f.rule ? '' : '<span class="meta">ruling register</span>'}</p><p>${inline(M, M.refText(f.summary))}${f.dupes?.length ? ` Also found as ${E(f.dupes.join(', '))}.` : ''}${f.closed ? ` Re-checked: ${E(f.closed)}` : ''}</p><ul class="src">${(f.evidence ?? []).map((e) => `<li><span class="sk">${E(e.file)}</span> <q>${E(e.quote)}</q></li>`).join('')}</ul></article>`;
  }).join('\n') : '<p>None.</p>');
  out.push('<h3>Game rulings no rule cites</h3>', `<p>${!P.classified ? 'The rulings are not classified yet.' : P.uncitedGame.length ? E(P.uncitedGame.join(', ')) : 'None.'}</p>`);
  out.push('<h3>Process rulings, excluded</h3>', !P.classified ? '<p>The rulings are not classified yet.</p>' : P.process.length ? `<ul>${P.process.map((p) => `<li>${E(p.id)}${p.reason ? `: ${E(p.reason)}` : ''}</li>`).join('')}</ul>` : '<p>None.</p>');
  // the review page comments on the annex as a whole: everything under its heading
  if (review) return `${out[0]}\n<div${crt(true, 'annexP')}>\n${out.slice(1).join('\n')}\n</div>`;
  return out.join('\n');
}

function htmlGlossary(M, review = false) {
  const rows = [...M.glossary].sort((a, b) => cmpStr(a.term.toLowerCase(), b.term.toLowerCase()) || cmpStr(a.key, b.key));
  if (!rows.length) return '<p class="meta">No entries yet.</p>';
  return `<dl class="gloss">${rows.map((g) => {
    const see = seeNums(M, g);
    // a term and its definition have no common element; the review page's
    // mark needs one, and a <div> around a dt/dd pair is valid in a <dl>
    const [open, close] = review ? [`<div${crt(true, `gloss:${g.key}`)}>`, '</div>'] : ['', ''];
    return `${open}<dt>${E(g.term)}${g.obsolete ? ' <span class="meta">(Obsolete)</span>' : ''}</dt><dd>${inline(M, M.refText(g.text))}${see.length ? ` See rule${see.length > 1 ? 's' : ''} ${see.map((n) => (M.numOfRef(n) ? `<a href="#r${n}">${n}</a>` : E(n))).join(', ')}.` : ''}</dd>${close}`;
  }).join('')}</dl>`;
}

function htmlChangelog(M) {
  return changelog(M).map(([name, c]) => `<h3>${E(name)}</h3><ul><li>New: ${c.born.length} rule${c.born.length === 1 ? '' : 's'}${c.sections ? ` and ${c.sections} section${c.sections === 1 ? '' : 's'}` : ''}.</li>${c.removed.map((e) => `<li>Removed: <a href="#r${e.num}">${e.num}</a> <code>${E(e.key)}</code>: ${E(e.removed)}</li>`).join('')}${c.renamed.map((a) => `<li>Renamed: <code>${E(a.from)}</code> → <code>${E(a.to)}</code></li>`).join('')}</ul>`).join('\n');
}

const CSS = `
:root {
  --bg: #f6f7f8; --surface: #ffffff; --fg: #1d2329; --muted: #5b6670; --line: #d9dee3;
  --accent: #1f5f8b; --accent-soft: #e3eef6;
  --ok: #1e7a4c; --ok-bg: #e2f3ea; --warn: #8a5a00; --warn-bg: #fbefd5; --bad: #a3262a; --bad-bg: #f8e1e1;
  --c-printed: #2d5f8a; --c-designer: #6b3fa0; --c-mixed: #3f6f6a; --c-owner: #9a5b12; --c-engine: #a3262a;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --font-display: "IBM Plex Serif", Georgia, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #12161a; --surface: #1a2026; --fg: #e3e8ec; --muted: #9aa6b0; --line: #2e3740;
  --accent: #7fb6e0; --accent-soft: #1d3142;
  --ok: #6fcf9c; --ok-bg: #173327; --warn: #e6b75c; --warn-bg: #3a2d12; --bad: #f08a8d; --bad-bg: #3c1c1e;
  --c-printed: #82b3dd; --c-designer: #c3a3ec; --c-mixed: #8cc6bf; --c-owner: #e6ac63; --c-engine: #f08a8d; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #12161a; --surface: #1a2026; --fg: #e3e8ec; --muted: #9aa6b0; --line: #2e3740;
  --accent: #7fb6e0; --accent-soft: #1d3142;
  --ok: #6fcf9c; --ok-bg: #173327; --warn: #e6b75c; --warn-bg: #3a2d12; --bad: #f08a8d; --bad-bg: #3c1c1e;
  --c-printed: #82b3dd; --c-designer: #c3a3ec; --c-mixed: #8cc6bf; --c-owner: #e6ac63; --c-engine: #f08a8d; color-scheme: dark }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 var(--font-body); }
.wrap { max-width: 1120px; margin: 0 auto; padding: 28px 16px 80px; display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 40px; }
nav.rail { position: sticky; top: 20px; align-self: start; font-size: 13px; max-height: calc(100vh - 40px); overflow-y: auto; }
nav.rail a { display: block; color: var(--muted); text-decoration: none; padding: 3px 0 3px 10px; border-left: 2px solid var(--line); }
nav.rail a:hover, nav.rail a:focus-visible { color: var(--accent); border-left-color: var(--accent); outline: none }
main { min-width: 0; max-width: 74ch; }
header h1 { font: 600 30px/1.2 var(--font-display); margin: 0 0 6px; text-wrap: balance }
header .sub { color: var(--muted); margin: 0 0 18px }
h2 { font: 600 22px/1.3 var(--font-display); margin: 48px 0 12px; padding-top: 12px; border-top: 1px solid var(--line); text-wrap: balance }
h3 { font-size: 16px; margin: 28px 0 8px; } h4 { font-size: 15px; margin: 20px 0 6px }
.front { border: 1px solid var(--line); background: var(--surface); padding: 4px 18px; border-radius: 6px; font-size: 14.5px }
code, .num, .meta, .tb, .sk { font-family: var(--font-mono) }
code { font-size: 0.88em; background: var(--accent-soft); padding: 1px 4px; border-radius: 3px; overflow-wrap: anywhere }
.sym { font: 500 0.85em var(--font-mono); background: var(--accent-soft); padding: 0 3px; border-radius: 3px; white-space: nowrap }
.figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 18px 0 }
.fig { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px }
.fig b { display: block; font: 600 24px/1.2 var(--font-mono); font-variant-numeric: tabular-nums }
.fig span { color: var(--muted); font-size: 12.5px }
.rule { padding: 10px 0 12px; border-bottom: 1px solid var(--line) }
.rule.r-sub { padding-left: 22px }
.rule.tomb .rt { color: var(--muted) }
.rt { margin: 0 }
.num { font-weight: 500; color: var(--accent); margin-right: 4px; font-size: 0.92em; text-decoration: none }
.ex { margin: 6px 0 0; font-style: italic; color: var(--muted); font-size: 14px }
.exl { font-style: normal; font-weight: 500 }
.tb { font-style: normal; font-size: 11.5px; overflow-wrap: anywhere }
.differs { font: 500 12.5px var(--font-body); color: var(--bad); background: var(--bad-bg); padding: 1px 6px; border-radius: 3px; white-space: nowrap }
.differs a { color: inherit }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px }
.chip { font: 500 11.5px/1 var(--font-body); padding: 4px 7px; border-radius: 3px; border: 1px solid currentColor; letter-spacing: 0.02em }
.b-printed { color: var(--c-printed) } .b-designer { color: var(--c-designer) } .b-mixed { color: var(--c-mixed) }
.b-owner { color: var(--c-owner) } .b-engine { color: var(--c-engine) }
.v-confirmed { color: var(--ok); background: var(--ok-bg); border-color: transparent }
.v-partial, .v-untested { color: var(--warn); background: var(--warn-bg); border-color: transparent }
.v-contradicted, .v-unsupported { color: var(--bad); background: var(--bad-bg); border-color: transparent }
.v-none { color: var(--muted) }
.k-a, .k-d { color: var(--c-designer) } .k-b { color: var(--c-engine) } .k-c { color: var(--c-owner) } .k-f { color: var(--warn) } .k-g { color: var(--muted) }
.meta { font-size: 11.5px; color: var(--muted) }
.meta a, a.meta { color: var(--accent) }
.vnote { margin: 6px 0 0; font-size: 13.5px; background: var(--warn-bg); padding: 6px 10px; border-radius: 4px }
details { margin-top: 6px } summary { cursor: pointer; font-size: 13px; color: var(--accent) }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
ul.src { margin: 6px 0 0; padding-left: 18px; font-size: 13px; overflow-wrap: anywhere }
.sk { font-size: 11.5px; color: var(--muted); margin-right: 4px }
q { quotes: "\\201C" "\\201D" }
.disc { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; margin: 10px 0 }
.disc p { margin: 4px 0 } .dh { display: flex; flex-wrap: wrap; gap: 8px; align-items: center }
.res { font-size: 14px }
.count { font: 500 13px var(--font-mono); color: var(--muted) }
.front .chip { white-space: nowrap }
.gloss dt { font-weight: 600; margin-top: 10px } .gloss dd { margin: 2px 0 0 18px }
a { color: var(--accent) }
.tw { overflow-x: auto } table { border-collapse: collapse; font-size: 13.5px; margin: 8px 0 }
th, td { border-bottom: 1px solid var(--line); padding: 5px 10px 5px 0; text-align: left; vertical-align: top; font-variant-numeric: tabular-nums }
@media (max-width: 860px) { .wrap { grid-template-columns: minmax(0, 1fr); gap: 0 } nav.rail { display: none } }
`;

/** the edition's page around a body. `rail` null: a page with no contents
 * rail (a section or chapter downloaded from the review page) */
function htmlPage(title, rail, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
${rail === null ? '<div class="wrap" style="grid-template-columns: minmax(0, 1fr)">' : `<div class="wrap">
<nav class="rail" aria-label="Contents">
${rail}
</nav>`}
<main>
${body}
</main>
</div>
</body>
</html>
`;
}

/** the introduction: the filled front matter, its chips drawn in its own sentences */
const htmlFront = (M, review = false) =>
  `<div class="front" id="intro"${crt(review, 'front')}>${mdToHtml(M, fillFront(M, M.inputs.frontMatter, { html: true }))}</div>\n`;

const CHANGELOG_LEAD = '<p>Keyed by rule key. A number never moves, so a rule is new, removed or renamed; text changes to a rule are not listed yet.</p>';

function renderHtml(M, P) {
  const o = M.outline;
  const rail = [
    '<a href="#intro">Introduction</a>',
    ...o.chapters.map((c) => `<a href="#ch${E(c.num)}">${E(c.num)}. ${E(c.title)}</a>`),
    `<a href="#annex-p">Annex P</a>`, '<a href="#glossary">Glossary</a>', '<a href="#changelog">Changelog</a>',
    '<a href="#annex-d">Annex D</a>', '<a href="#discrepancies">Discrepancy report</a>',
  ].join('\n');
  const body = [];
  body.push(`<header><h1>${E(o.title)}</h1><p class="sub">${E(o.subtitle ?? '')} ${E(o.edition.name)}, effective ${E(o.edition.effective)}, engine at ${E(o.edition.engineCommit)}.</p></header>`);
  body.push(htmlFront(M));
  for (const c of o.chapters) {
    body.push(`<h2 id="ch${E(c.num)}">${E(c.num)}. ${E(c.title)}</h2>`);
    for (const s of c.sections) body.push(htmlSection(M, s));
  }
  body.push(htmlAnnexP(M, P));
  body.push(`<h2 id="glossary">${E(o.glossary.title)}</h2>`, htmlGlossary(M));
  body.push(`<h2 id="changelog">${E(o.changelog.title)}</h2>`, CHANGELOG_LEAD, htmlChangelog(M));
  body.push(`<h2 id="annex-d">${E(o.annexD.title)}</h2>`, htmlAnnexDLead(M));
  for (const s of o.annexD.sections) body.push(htmlSection(M, s));
  body.push('<h2 id="discrepancies">Discrepancy report</h2>', '<p>Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision.</p>', htmlDisc(M));
  return htmlPage(E(o.title), rail, body.join('\n'));
}

/* ── the entry point ────────────────────────────────────────────────────── */

/** the model, refusing a glossary that points at no live rule */
function renderModel(inputs, ex) {
  const M = buildModel(inputs, ex);
  // the glossary is a pointer layer: an entry whose "See rule" target is no live
  // rule would print a dead pointer, so the generator refuses (check.mjs names it
  // as glossary-see-unresolved)
  const dangling = M.glossary.flatMap((g) => (g.see ?? []).filter((s) => !M.numOfRef(s)).map((s) => `"${g.term}" → ${s}`));
  if (dangling.length) throw new Error(`glossary entries point at no live rule: ${dangling.join('; ')}`);
  return M;
}

/** every published file, by its OUTPUT_PATHS name */
function editions(M, P) {
  const md = renderMd(M, P);
  return {
    doc: md,
    html: renderHtml(M, P),
    txt: renderTxt(M, md),
    annexD: renderAnnexD(M),
    discrepanciesMd: renderDiscMd(M),
    ownerQuestions: renderOwnerQuestions(M),
    changelog: mdChangelog(M, true),
  };
}

/**
 * → {ledger, born, files: {doc, html, txt, annexD, discrepanciesMd, ownerQuestions, changelog}}
 * Pure and byte-deterministic.
 */
export function render(inputs, ex) {
  const M = renderModel(inputs, ex);
  return { ledger: M.ledger, born: M.born, files: editions(M, provenance(M)) };
}

/** where each rendered file is written */
export const OUTPUT_PATHS = {
  doc: CR_DOC, html: CR_DOC_HTML, txt: CR_DOC_TXT, annexD: CR_ANNEX_D,
  discrepanciesMd: CR_DISCREPANCIES_MD, ownerQuestions: CR_OWNER_QUESTIONS, changelog: CR_CHANGELOG,
};

/* ── the review page's document ─────────────────────────────────────────── */

/** a `data-crt` value as written by crt(): E() undone */
const CRT_RE = /\sdata-crt="([^"]*)"/g;
const unE = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The rules review page's document (ui/crtypes.ts CrReview), from the same
 * model and the same formatters as the published editions: every part's html
 * is the edition's own fragment with `data-crt` added, its md the bytes the
 * .md edition holds for it, its txt the .txt edition's. `files` IS render()'s
 * output. Pure, like render().
 */
function reviewOf(M, P, inputs) {
  const o = M.outline;
  const files = editions(M, P);
  const front = fillFront(M, M.inputs.frontMatter);
  const parts = [{
    id: 'front', kind: 'front', title: 'Introduction', html: htmlFront(M, true),
    md: front.trimEnd() + '\n', txt: txtClean(front.replace(/^#+ /gm, '').trimEnd() + '\n'),
  }];
  const toc = [{ id: 'front', title: 'Introduction' }];
  const chapter = (id, title, chapterNum, sections, lead = null) => {
    toc.push({ id, title, ...(lead ? { lead: lead.id } : {}), sections: sections.map((s) => ({ num: s.num, title: s.title, part: `s${s.num}` })) });
    if (lead) parts.push({ ...lead, kind: 'lead', chapter: chapterNum, txt: txtClean(txtOfMd(lead.md)) });
    for (const s of sections) {
      parts.push({
        id: `s${s.num}`, kind: 'section', num: s.num, chapter: chapterNum, title: s.title,
        html: htmlSection(M, s, true),
        md: (mdSection(M, s) + '\n').replace(/\n{3,}/g, '\n\n'),
        txt: txtClean(txtSectionLines(M, s).join('\n') + '\n'),
      });
    }
  };
  const prose = (id, kind, title, html, md) => {
    toc.push({ id, title });
    parts.push({ id, kind, title, html, md, txt: txtClean(txtOfMd(md)) });
  };
  for (const c of o.chapters) chapter(`ch${c.num}`, `${c.num}. ${c.title}`, c.num, c.sections);
  prose('annexP', 'annexP', o.annexP.title, htmlAnnexP(M, P, true), mdAnnexP(M, P));
  prose('glossary', 'glossary', o.glossary.title, `<h2 id="glossary">${E(o.glossary.title)}</h2>\n${htmlGlossary(M, true)}`, mdGlossary(M));
  prose('changelog', 'changelog', o.changelog.title,
    `<h2 id="changelog">${E(o.changelog.title)}</h2>\n<div${crt(true, 'changelog')}>\n${CHANGELOG_LEAD}\n${htmlChangelog(M)}\n</div>`, mdChangelog(M, false));
  // Annex D opens with its precedence paragraph, which is in no section
  chapter('chD', o.annexD.title, 'D', o.annexD.sections, {
    id: 'annexD', title: 'Precedence', html: `<div${crt(true, 'annexD')}>\n${htmlAnnexDLead(M)}\n</div>`, md: mdAnnexDLead(M) + '\n',
  });

  const disc = [];
  for (const t of [1, 2, 3, 4]) {
    for (const d of M.discrepancies.filter((x) => x.tier === t)) {
      disc.push({ id: d.id, tier: t, rule: M.numOfRef(d.rule) ?? d.rule, html: htmlDiscItem(M, d, true) });
    }
  }
  const ownerQuestions = ownerQuestionGroups(M).map(({ topic, items }) => ({
    topic, items: items.map(({ d, n }) => ({ id: d.id, n, readings: (d.question.readings ?? []).map((r) => r.label) })),
  }));
  // derived from the html, never listed: what the page can find is what is there
  const targets = [...parts, ...disc].flatMap((p) => [...p.html.matchAll(CRT_RE)].map((m) => unE(m[1])));

  const name = (k) => basename(OUTPUT_PATHS[k]);
  return {
    v: 1, title: o.title, subtitle: o.subtitle ?? '',
    edition: { name: o.edition.name, effective: o.edition.effective, engineCommit: o.edition.engineCommit },
    toc, parts, disc, ownerQuestions, targets,
    keys: Object.fromEntries(M.ledger.entries.map((e) => [e.key, e.num])),
    removed: Object.fromEntries(M.ledger.entries.filter((e) => e.removed).map((e) => [e.key, e.num])),
    aliases: Object.fromEntries((M.ledger.aliases ?? []).map((a) => [a.from, a.to])),
    shell: htmlPage('{{TITLE}}', null, '{{BODY}}'),
    files: {
      doc: { name: name('doc'), text: files.doc }, html: { name: name('html'), text: files.html },
      txt: { name: name('txt'), text: files.txt }, annexD: { name: name('annexD'), text: files.annexD },
      disc: { name: name('discrepanciesMd'), text: files.discrepanciesMd },
      oq: { name: name('ownerQuestions'), text: files.ownerQuestions },
      changelog: { name: name('changelog'), text: files.changelog },
    },
    born: M.born.length,
    inputs,
  };
}

/**
 * The review page's document, built from the committed records — the game
 * server's `/api/cr/*` routes call this and cache the answer by the mtimes of
 * `inputs`. Nothing review-shaped is committed: this IS the renderer, so the
 * page and the published editions cannot disagree. A stale ledger (records
 * with no number yet) still builds, numbering them as cr:render would, and
 * says so in `born`; a dangling glossary pointer or an unextendable ledger
 * throws.
 *
 * `ex` defaults to a fresh extract() (about a second; the renderer reads only
 * its enums). `paths` overrides loadInputs()' locations, for a fixture.
 * The engine source the enums come from is NOT in `inputs`: a process imports
 * it once, so a change there needs a restart anyway.
 */
export async function buildReview({ paths = {}, ex } = {}) {
  const extracted = ex ?? (await import('./extract.mjs')).extract();
  const M = renderModel(loadInputs(paths), extracted);
  return reviewOf(M, provenance(M), inputFiles(paths));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { extract } = await import('./extract.mjs');
  if (process.argv.includes('--review-json')) {
    // debugging only: what the server builds, written where nothing reads it
    const r = await buildReview({ ex: extract() });
    mkdirSync(dirname(CR_REVIEW_DEBUG_JSON), { recursive: true });
    writeFileSync(CR_REVIEW_DEBUG_JSON, JSON.stringify(r, null, 1) + '\n');
    console.log(`wrote ${CR_REVIEW_DEBUG_JSON}: ${r.parts.length} parts, ${r.disc.length} discrepancies, ${r.targets.length} targets; ${r.born} number(s) not in the ledger`);
  } else {
    const inputs = loadInputs();
    const out = render(inputs, extract());
    writeFileSync(CR_LEDGER, formatLedger(out.ledger));
    for (const [k, p] of Object.entries(OUTPUT_PATHS)) writeFileSync(p, out.files[k]);
    console.log(`rendered ${Object.keys(OUTPUT_PATHS).map((k) => basename(OUTPUT_PATHS[k])).join(', ')}; ${out.born.length} number(s) born`);
  }
}
