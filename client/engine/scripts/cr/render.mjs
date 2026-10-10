/**
 * Render the comprehensive rules: outline.json + rules/*.json + the ledger +
 * verdicts + discrepancies + findings (+ the extract, for the attribute list
 * and Annex P) → the document in three editions, Annex D, the discrepancy
 * report and the changelog.
 *
 * `render(inputs, extract)` is PURE and byte-deterministic: no clock, no git,
 * no environment. The edition, effective date and engine commit come from
 * outline.json, set by hand at release, so committing does not change the
 * document. Run as a script it allocates numbers for unseen keys (ledger.mjs —
 * the only place a number is born), writes the ledger, and writes every file.
 *
 *   npm --prefix client run cr:render
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  CR_OUTLINE, CR_FRONT_MATTER, CR_RULES_DIR, CR_LEDGER, CR_VERDICTS, CR_DISCREPANCIES,
  CR_FINDINGS, CR_CLASSIFICATION, CR_SUPERSESSION, CR_DOC, CR_DOC_HTML, CR_DOC_TXT,
  CR_ANNEX_D, CR_DISCREPANCIES_MD, CR_CHANGELOG,
} from '../paths.mjs';
import { allocate, compareNums, formatLedger, indexLedger, parseNum, readLedger, resolveKey } from './ledger.mjs';
import { ANY_NUM_RE, BASES, TIERS, VERDICTS, parseRulingCite, textHash } from './schema.mjs';

/* ── inputs ─────────────────────────────────────────────────────────────── */

const readJson = (p, dflt) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);

/**
 * Everything on disk the renderer and the checker read. `records` are the
 * numbered rule records (sections 1–9 and Annex D); `glossary` the rows with
 * a `term`; `fileOf` names the rules/*.json file each came from.
 */
export function loadInputs(paths = {}) {
  const P = {
    outline: CR_OUTLINE, frontMatter: CR_FRONT_MATTER, rulesDir: CR_RULES_DIR, ledger: CR_LEDGER,
    verdicts: CR_VERDICTS, discrepancies: CR_DISCREPANCIES, findings: CR_FINDINGS,
    classification: CR_CLASSIFICATION, supersession: CR_SUPERSESSION, ...paths,
  };
  const records = [], glossary = [], fileOf = new Map();
  if (existsSync(P.rulesDir)) {
    for (const f of readdirSync(P.rulesDir).filter((x) => x.endsWith('.json')).sort()) {
      const rows = JSON.parse(readFileSync(join(P.rulesDir, f), 'utf8'));
      if (!Array.isArray(rows)) throw new Error(`${f}: a rules file is an array of records`);
      for (const r of rows) { fileOf.set(r, f); (r && 'term' in r ? glossary : records).push(r); }
    }
  }
  return {
    outline: readJson(P.outline, null),
    frontMatter: existsSync(P.frontMatter) ? readFileSync(P.frontMatter, 'utf8') : '',
    records, glossary, fileOf,
    ledger: readLedger(P.ledger),
    verdicts: readJson(P.verdicts, []),
    discrepancies: readJson(P.discrepancies, []),
    findings: readJson(P.findings, []),
    classification: readJson(P.classification, null),
    supersession: readJson(P.supersession, null),
  };
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
  const discByNum = new Map();
  for (const d of [...discrepancies].sort((a, b) => cmpStr(a.id, b.id))) {
    const n = numOfRef(d.rule) ?? d.rule;
    if (!discByNum.has(n)) discByNum.set(n, []);
    discByNum.get(n).push(d);
  }
  return {
    inputs, ex, outline, ledger, born, I, canon, recByKey, slotByKey, sectionByNum, verdictByKey,
    numOfRef, discByNum, glossary, findings: [...findings].sort((a, b) => cmpNumId(a.id, b.id)),
    discrepancies: [...discrepancies].sort((a, b) => cmpStr(a.id, b.id)),
  };
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpNumId = (a, b) => (Number(a.split('-')[1]) - Number(b.split('-')[1])) || cmpStr(a, b);

/** the verifier's latest verdict on a record, and whether it still fits the text */
export function verdictOf(M, rec) {
  const v = M.verdictByKey.get(M.canon(rec.key));
  if (!v) return null;
  return { ...v, stale: v.textHash !== textHash(rec.text) };
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
    return { num: e.num, level, tomb: { reason: e.removed, replacedBy: e.replacedBy ? M.numOfRef(e.replacedBy) ?? e.replacedBy : null } };
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
function verdictWords(v) {
  if (!v) return 'not verified';
  if (v.stale) return 'not verified (the text changed after verification)';
  const ran = (v.tests_run ?? []).filter((t) => t.passed).length;
  return `${v.verdict}, round ${v.round}, ${ran} test${ran === 1 ? '' : 's'} run`;
}
function provenanceBits(M, rec) {
  const s = rec.sources ?? {};
  const bits = [`Basis: ${BASIS_LABEL[rec.basis] ?? rec.basis}`, `Verified: ${verdictWords(verdictOf(M, rec))}`];
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
  return rec.engineDiffers?.length ? ` (Engine differs, see ${rec.engineDiffers.join(', ')}.)` : '';
}
function fillFront(M, text) {
  const ed = M.outline.edition;
  return text.replaceAll('{{EDITION}}', ed.name).replaceAll('{{EFFECTIVE}}', ed.effective).replaceAll('{{ENGINE_COMMIT}}', ed.engineCommit);
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
  const lines = [`${a}${head} ${r.text}${seeSentence(seeNums(M, r))}${differsText(r) ? ` *${differsText(r).trim()}*` : ''}`];
  for (const x of r.examples ?? []) {
    lines.push('', `> *Example (non-normative): ${mdEsc(exampleText(x.text))}*${x.test ? ` <sub>test: ${x.test}</sub>` : ''}`);
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
  for (const { num, rec } of P.engineOnly) out.push(`- [${num}](#r${num}) ${rec.text}`);
  out.push('', '### Findings: where the engine differs', '');
  if (!M.findings.length) out.push('None.');
  for (const f of M.findings) out.push(`- <a id="${f.id}"></a>**${f.id}** ${f.title}${f.ct ? ` (${f.ct})` : ''}. Rule ${M.numOfRef(f.rule) ?? f.rule}. ${f.summary}`);
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
  for (const g of rows) out.push(`**${g.term}**${g.obsolete ? ' (Obsolete)' : ''}: ${g.text}${seeSentence(seeNums(M, g))}`, '');
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

function renderAnnexD(M) {
  const o = M.outline;
  const out = [`# ${o.annexD.title}`, '', `*${o.title}. ${o.subtitle ?? ''}*`, '', '## Precedence', '', o.annexD.precedence ?? '', ''];
  for (const s of o.annexD.sections) out.push(mdSection(M, s));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function renderDiscMd(M) {
  const out = [`# ${M.outline.title}: Discrepancy Report`, '',
    'Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision; every other item already says which side the document follows.', ''];
  for (const t of [1, 2, 3, 4]) {
    const ds = M.discrepancies.filter((d) => d.tier === t);
    out.push(`## ${t}. ${TIERS[t]} (${ds.length})`, '');
    if (!ds.length) out.push('None.', '');
    for (const d of ds) {
      out.push(`### ${d.id} · ${KIND_LABEL[d.kind?.[0]] ?? d.kind} · rule ${M.numOfRef(d.rule) ?? d.rule}`, '', d.summary, '');
      for (const sd of d.sides ?? []) out.push(`- ${sd.source}: "${sd.quote}"`);
      out.push('', `**Resolution:** ${d.resolution}`, '');
    }
  }
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
  const lines = [`${head} ${r.text}${seeSentence(seeNums(M, r))}${differsText(r)}`];
  for (const x of r.examples ?? []) lines.push(`${pad}Example (non-normative): ${exampleText(x.text)}${x.test ? ` [test: ${x.test}]` : ''}`);
  lines.push(`${pad}[${provenanceBits(M, r).join(' | ')}]`);
  return lines.join('\n') + '\n';
}

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
    for (const s of c.sections) {
      out.push(`${s.num}. ${s.title}`, '');
      const es = entriesOf(M, s.num);
      if (!es.length) out.push('No rules drafted yet.', '');
      for (const e of es) out.push(txtRule(M, viewOf(M, e)));
    }
  }
  // Annex P, the glossary and the changelog are prose already; reuse the Markdown
  const tail = md.slice(md.indexOf(`## ${o.annexP.title}`));
  out.push('', tail.replace(/<a id="[^"]*"><\/a>/g, '').replace(/^#+ /gm, '').replace(/\[([^\]]+)\]\(#[^)]*\)/g, '$1').replace(/<\/?sub>/g, ''));
  return toTxt(out.join('\n')).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
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
  return out.join('\n');
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

function htmlVerdict(v) {
  if (!v) return ['<span class="chip v-none">Not verified</span>', ''];
  if (v.stale) return ['<span class="chip v-none">Not verified: text changed</span>', ''];
  const ran = (v.tests_run ?? []).filter((t) => t.passed).length;
  const chip = `<span class="chip v-${E(v.verdict)}">${VERDICT_LABEL[v.verdict] ?? E(v.verdict)}</span>`;
  const meta = `<span class="meta">round ${v.round} · ${ran} test${ran === 1 ? '' : 's'} run</span>`;
  const note = v.verdict !== 'confirmed' && v.problem ? `<p class="vnote"><strong>Verifier:</strong> ${E(v.problem)}</p>` : '';
  return [chip + meta, note];
}

function htmlRule(M, v) {
  const lvl = v.level === 2 ? 'r-sub' : 'r-top';
  const label = v.level === 1 ? `${v.num}.` : v.num;
  const num = `<a class="num" href="#r${v.num}">${label}</a>`;
  if (v.tomb) {
    return `<article class="rule ${lvl} tomb" id="r${v.num}"><p class="rt">${num} [Removed: ${E(v.tomb.reason)}]${v.tomb.replacedBy ? ` Replaced by <a href="#r${E(v.tomb.replacedBy)}">${E(v.tomb.replacedBy)}</a>.` : ''}</p></article>`;
  }
  const title = v.title ? `<strong class="rtitle">${E(v.title)}.</strong> ` : '';
  if (!v.rec) return `<article class="rule ${lvl}" id="r${v.num}"><p class="rt">${num} ${title}${v.title ? '' : '<span class="meta">[No record]</span>'}</p></article>`;
  const r = v.rec;
  const see = seeNums(M, r);
  const seeHtml = see.length ? ` See rule${see.length > 1 ? 's' : ''} ${see.map((n) => (M.numOfRef(n) ? `<a href="#r${n}">${n}</a>` : E(n))).join(', ')}.` : '';
  const differs = r.engineDiffers?.length ? ` <span class="differs">engine differs, see ${r.engineDiffers.map((f) => `<a href="#${E(f)}">${E(f)}</a>`).join(', ')}</span>` : '';
  const ex = (r.examples ?? []).map((x) => `<p class="ex"><span class="exl">Example (non-normative).</span> ${inline(M, exampleText(x.text))}${x.test ? ` <span class="tb">test: ${E(x.test)}</span>` : ''}</p>`).join('');
  const [chip, vnote] = htmlVerdict(verdictOf(M, r));
  const ds = M.discByNum.get(v.num) ?? [];
  const dl = ds.length ? ` <span class="meta">${ds.map((d) => `<a href="#${E(d.id)}">${E(d.id)}</a>`).join(' ')}</span>` : '';
  return `<article class="rule ${lvl}" id="r${v.num}">
<p class="rt">${num} ${title}${inline(M, r.text)}${seeHtml}${differs}</p>${ex}
<div class="tags"><span class="chip b-${E(r.basis)}">${BASIS_LABEL[r.basis] ?? E(r.basis)}</span>${chip}${dl}</div>${vnote}
<details><summary>Provenance <span class="meta">key ${E(r.key)}</span></summary>${htmlSources(M, r)}</details>
</article>`;
}

function htmlSection(M, s) {
  const es = entriesOf(M, s.num);
  return `<section class="sec"><h3 id="r${s.num}"><a class="num" href="#r${s.num}">${s.num}.</a> ${E(s.title)}</h3>
${es.length ? es.map((e) => htmlRule(M, viewOf(M, e))).join('\n') : '<p class="meta">No rules drafted yet.</p>'}
</section>`;
}

function htmlDisc(M) {
  const out = [];
  for (const t of [1, 2, 3, 4]) {
    const ds = M.discrepancies.filter((d) => d.tier === t);
    out.push(`<h3>${E(TIERS[t])} <span class="count">${ds.length}</span></h3>`);
    for (const d of ds) {
      const n = M.numOfRef(d.rule);
      const sides = (d.sides ?? []).map((sd) => `<li><span class="sk">${E(sd.source)}</span> <q>${E(sd.quote ?? '')}</q></li>`).join('');
      out.push(`<article class="disc" id="${E(d.id)}">
<p class="dh"><span class="num">${E(d.id)}</span> <span class="chip k-${E(d.kind?.[0] ?? 'g')}">${KIND_LABEL[d.kind?.[0]] ?? E(d.kind)}</span> ${n ? `<a class="meta" href="#r${n}">rule ${n}</a>` : `<span class="meta">rule ${E(d.rule)}</span>`}</p>
<p>${inline(M, d.summary)}</p>
<ul class="src">${sides}</ul>
<p class="res"><strong>Resolution:</strong> ${inline(M, d.resolution)}</p>
</article>`);
    }
  }
  return out.join('\n');
}

function htmlAnnexP(M, P) {
  const o = M.outline;
  const tbl = (rows) => `<div class="tw"><table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table></div>`;
  const out = [`<h2 id="annex-p">${E(o.annexP.title)}</h2>`, '<p>Generated from the records, the verdicts and the ruling classification. Nothing here is a rule.</p>'];
  out.push(`<div class="figs"><div class="fig"><b>${P.total}</b><span>numbered rules</span></div>${BASES.map((b) => `<div class="fig"><b>${P.basis[b] ?? 0}</b><span>${BASIS_LABEL[b]}</span></div>`).join('')}</div>`);
  out.push('<h3>Verification</h3>', tbl([['verdict', 'rules'], ...Object.entries(P.verdicts).map(([k, n]) => [E(k), n])]));
  out.push('<h3>Engine-only rules (awaiting the owner\'s sign-off)</h3>');
  out.push(P.engineOnly.length ? `<ul>${P.engineOnly.map(({ num, rec }) => `<li><a href="#r${num}">${num}</a> ${inline(M, rec.text)}</li>`).join('')}</ul>` : '<p>None.</p>');
  out.push('<h3>Findings: where the engine differs</h3>');
  out.push(M.findings.length ? M.findings.map((f) => {
    const n = M.numOfRef(f.rule);
    return `<article class="disc" id="${E(f.id)}"><p class="dh"><span class="num">${E(f.id)}</span> <strong>${E(f.title)}</strong>${f.ct ? ` <span class="meta">${E(f.ct)}</span>` : ''} ${n ? `<a class="meta" href="#r${n}">rule ${n}</a>` : ''}</p><p>${inline(M, f.summary)}</p><ul class="src">${(f.evidence ?? []).map((e) => `<li><span class="sk">${E(e.file)}</span> <q>${E(e.quote)}</q></li>`).join('')}</ul></article>`;
  }).join('\n') : '<p>None.</p>');
  out.push('<h3>Game rulings no rule cites</h3>', `<p>${!P.classified ? 'The rulings are not classified yet.' : P.uncitedGame.length ? E(P.uncitedGame.join(', ')) : 'None.'}</p>`);
  out.push('<h3>Process rulings, excluded</h3>', !P.classified ? '<p>The rulings are not classified yet.</p>' : P.process.length ? `<ul>${P.process.map((p) => `<li>${E(p.id)}${p.reason ? `: ${E(p.reason)}` : ''}</li>`).join('')}</ul>` : '<p>None.</p>');
  return out.join('\n');
}

function htmlGlossary(M) {
  const rows = [...M.glossary].sort((a, b) => cmpStr(a.term.toLowerCase(), b.term.toLowerCase()) || cmpStr(a.key, b.key));
  if (!rows.length) return '<p class="meta">No entries yet.</p>';
  return `<dl class="gloss">${rows.map((g) => {
    const see = seeNums(M, g);
    return `<dt>${E(g.term)}${g.obsolete ? ' <span class="meta">(Obsolete)</span>' : ''}</dt><dd>${inline(M, g.text)}${see.length ? ` See rule${see.length > 1 ? 's' : ''} ${see.map((n) => (M.numOfRef(n) ? `<a href="#r${n}">${n}</a>` : E(n))).join(', ')}.` : ''}</dd>`;
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
.legend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; margin: 8px 0 }
.gloss dt { font-weight: 600; margin-top: 10px } .gloss dd { margin: 2px 0 0 18px }
a { color: var(--accent) }
.tw { overflow-x: auto } table { border-collapse: collapse; font-size: 13.5px; margin: 8px 0 }
th, td { border-bottom: 1px solid var(--line); padding: 5px 10px 5px 0; text-align: left; vertical-align: top; font-variant-numeric: tabular-nums }
@media (max-width: 860px) { .wrap { grid-template-columns: minmax(0, 1fr); gap: 0 } nav.rail { display: none } }
`;

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
  body.push(`<div class="front" id="intro">${mdToHtml(M, fillFront(M, M.inputs.frontMatter))}</div>`);
  body.push(`<div class="legend">${BASES.map((b) => `<span class="chip b-${b}">${BASIS_LABEL[b]}</span>`).join('')}</div>`);
  for (const c of o.chapters) {
    body.push(`<h2 id="ch${E(c.num)}">${E(c.num)}. ${E(c.title)}</h2>`);
    for (const s of c.sections) body.push(htmlSection(M, s));
  }
  body.push(htmlAnnexP(M, P));
  body.push(`<h2 id="glossary">${E(o.glossary.title)}</h2>`, htmlGlossary(M));
  body.push(`<h2 id="changelog">${E(o.changelog.title)}</h2>`, '<p>Keyed by rule key. A number never moves, so a rule is new, removed or renamed; text changes to a rule are not listed yet.</p>', htmlChangelog(M));
  body.push(`<h2 id="annex-d">${E(o.annexD.title)}</h2>`, `<p>${E(o.annexD.precedence ?? '')}</p>`);
  for (const s of o.annexD.sections) body.push(htmlSection(M, s));
  body.push('<h2 id="discrepancies">Discrepancy report</h2>', '<p>Every place where the sources disagree, the register contradicts itself, or a rule rests only on the engine or on an owner call. Each quote is checked to be verbatim. Only the first tier needs a decision.</p>', htmlDisc(M));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${E(o.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<nav class="rail" aria-label="Contents">
${rail}
</nav>
<main>
${body.join('\n')}
</main>
</div>
</body>
</html>
`;
}

/* ── the entry point ────────────────────────────────────────────────────── */

/**
 * → {ledger, born, files: {doc, html, txt, annexD, discrepanciesMd, changelog}}
 * Pure and byte-deterministic.
 */
export function render(inputs, ex) {
  const M = buildModel(inputs, ex);
  const P = provenance(M);
  const md = renderMd(M, P);
  return {
    ledger: M.ledger,
    born: M.born,
    files: {
      doc: md,
      html: renderHtml(M, P),
      txt: renderTxt(M, md),
      annexD: renderAnnexD(M),
      discrepanciesMd: renderDiscMd(M),
      changelog: mdChangelog(M, true),
    },
  };
}

/** where each rendered file is written */
export const OUTPUT_PATHS = {
  doc: CR_DOC, html: CR_DOC_HTML, txt: CR_DOC_TXT, annexD: CR_ANNEX_D,
  discrepanciesMd: CR_DISCREPANCIES_MD, changelog: CR_CHANGELOG,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { extract } = await import('./extract.mjs');
  const inputs = loadInputs();
  const out = render(inputs, extract());
  writeFileSync(CR_LEDGER, formatLedger(out.ledger));
  for (const [k, p] of Object.entries(OUTPUT_PATHS)) writeFileSync(p, out.files[k]);
  console.log(`rendered ${Object.keys(OUTPUT_PATHS).map((k) => basename(OUTPUT_PATHS[k])).join(', ')}; ${out.born.length} number(s) born`);
}
