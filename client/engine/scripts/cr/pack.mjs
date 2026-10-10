/**
 * A drafting unit's source pack: everything the Stage C drafter for one unit
 * reads, gathered out of the extract and the reviewed state, in one directory.
 *
 *   node scripts/cr/pack.mjs <U12|all> [--seed <pilot dir>]
 *
 * writes `CR_PACKS_DIR/<unit>/` (gitignored, inside the build dir):
 *   rulings.md   the CURRENT rulings assigned to the unit (partly superseded
 *                ones included), full text, each under a header line with its
 *                status, scope and basis, and a banner for every part that no
 *                longer stands, every undecided question and every stale ⚠
 *   history.md   every ruling assigned to the unit that is wholly or partly
 *                superseded, with its banners (full text for the wholly
 *                superseded; the partly superseded are in rulings.md)
 *   raq.md       every RAQ claim assigned to the unit, verbatim, with its
 *                guards and note; a claim in a thread still open is flagged
 *   printed.md   the Manual / Rulebook pages assigned to the unit
 *   cards.md     the printed reminder of each keyword in the unit's sections,
 *                and every card printing that keyword
 *   ours.md      our glossary rows for the unit — OUR TEXT, NOT AUTHORITY
 *   tests.md     the titles of every test file the unit's rulings cite or
 *                its claims name as guards
 *   seed/        with --seed: the pilot's records and verdicts for the unit
 *
 * Deterministic: the same inputs give byte-identical files. `buildPack` is
 * pure; `writePack` does the disk work.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CR_CLASSIFICATION, CR_PACKS_DIR, CR_SOURCE_CLASSIFICATION, CR_SUPERSESSION, CR_UNITS,
} from '../paths.mjs';
import { NON_SUPERSEDING } from './check.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rulingNum = (id) => { const m = /^R(\d+)(b?)/.exec(id); return Number(m[1]) + (m[2] ? 0.5 : 0); };
const byRuling = (a, b) => rulingNum(a) - rulingNum(b);
/** the drafting unit an outline number belongs to: `608.2b` → U12, `802.16` → U20 */
function unitOfNum(units, num) {
  const s = String(num);
  const head = /^802\.\d+/.exec(s)?.[0] ?? s.split('.')[0];
  return units.find((u) => u.sections.includes(head))?.id ?? null;
}

/** glossary terms the attribute order and the printed reminders do not place */
const GLOSSARY_SECTION = {
  Burst: '803', Unstable: '803', Ambush: '803', Once: '803', Prophecy: '803',
  Virus: '723', Augment: '721', Graft: '722', Rot: '112', Debt: '112',
  Cache: '403', Recycle: '408', Trash: '801', Glimpse: '801',
  Haste: '504', Battle: '505', Shard: '106', Prismite: '106',
};

/**
 * Everything a pack is made from, loaded once.
 * @param ex the extract (`extract()`)
 */
export function loadPackInputs(ex) {
  return {
    ex,
    units: readJson(CR_UNITS).units,
    cls: readJson(CR_CLASSIFICATION),
    sup: readJson(CR_SUPERSESSION),
    src: readJson(CR_SOURCE_CLASSIFICATION),
  };
}

/** the banners a ruling carries: superseded parts, undecided questions, stale ⚠ */
function bannersOf(I, id) {
  const out = [];
  const q = (x) => `"${x.quote}" (${x.quoteFrom})`;
  for (const e of I.sup.edges.filter((x) => x.to === id && x.decision === 'accepted' && !NON_SUPERSEDING.has(x.relation))) {
    out.push(e.scope
      ? `> **PARTLY SUPERSEDED** (${e.relation}): ${e.scope} — by ${e.from}: ${q(e)}`
      : `> **SUPERSEDED** (${e.relation}) by ${e.from}: ${q(e)}`);
  }
  for (const u of (I.sup.uncertain ?? []).filter((x) => x.to === id)) {
    out.push(`> **UNDECIDED** (${u.kind}, ${u.from} → ${u.to}): ${u.question} — ${u.quotes.map(q).join(' / ')}`);
  }
  const c = I.cls[id];
  if (c?.staleWarning) out.push(`> **STALE ⚠**: this ruling's own warning looks out of date — ${q(c.staleWarning)}`);
  return out;
}

function headerOf(I, id) {
  const c = I.cls[id];
  const scope = c.mixed ? `${c.scope} (mixed${c.mixed.digital ? `; digital half: ${c.mixed.digital}` : ''})` : c.scope;
  const basis = c.designer ? 'designer-backed' : c.ownerOnly ? 'owner call' : 'printed/other';
  return `status: ${c.status} · scope: ${scope} · basis: ${basis} · sections: ${c.sections.join(', ')} · units: ${c.units.join(', ')}`;
}

const fullText = (r) => `${r.heading}\n${r.body.replace(/\s+$/, '')}`;

/**
 * One unit's pack, as {fileName: content}. Pure.
 * @param I     loadPackInputs()
 * @param unit  'U12'
 * @param seed  optional {records: [], verdicts: [{file, rows}]} — the pilot's
 */
export function buildPack(I, unit, seed = null) {
  const { ex } = I;
  const U = I.units.find((u) => u.id === unit);
  if (!U) throw new Error(`no drafting unit ${unit}`);
  const files = {};
  const rulings = new Map(ex.rulings.map((r) => [r.id, r]));
  const mine = Object.keys(I.cls).filter((id) => I.cls[id].units.includes(unit)).sort(byRuling);
  const standing = mine.filter((id) => !['superseded', 'withdrawn', 'absorbed'].includes(I.cls[id].status));
  const past = mine.filter((id) => I.cls[id].status !== 'current');

  /* rulings.md */
  const rl = [`# ${unit} — current rulings (${standing.length})`, '', `Unit: ${U.title} (rules ${U.rules}). Each ruling below still stands, at least in part; read every banner before its text.`, ''];
  for (const id of standing) {
    rl.push(`## ${id}`, '', headerOf(I, id), '', ...bannersOf(I, id).flatMap((b) => [b, '']), '```md', fullText(rulings.get(id)), '```', '');
  }
  files['rulings.md'] = rl.join('\n');

  /* history.md */
  const hl = [`# ${unit} — superseded and partly superseded rulings (${past.length})`, '', 'History only: what no longer stands, and what replaced it. Cite these in `history`, never in `rulings`.', ''];
  for (const id of past) {
    const whole = !standing.includes(id);
    hl.push(`## ${id}`, '', headerOf(I, id), '', ...bannersOf(I, id).flatMap((b) => [b, '']));
    hl.push(...(whole ? ['```md', fullText(rulings.get(id)), '```', ''] : ['(the part that still stands, and the full text, are in rulings.md)', '']));
  }
  files['history.md'] = hl.join('\n');

  /* raq.md */
  const claims = I.src.raqClaims, threads = I.src.raqThreads;
  const ra = [`# ${unit} — RAQ claims`, '', 'Designer answers, verbatim. A claim in a thread that is still OPEN is not a ruling.', ''];
  let nClaims = 0;
  for (const t of ex.raq) {
    const cs = t.claims.filter((c) => claims[c.id]?.units.includes(unit));
    if (!cs.length) continue;
    const th = threads[String(t.threadId)];
    ra.push(`## ${t.title} (thread ${t.threadId})${th?.open ? ' — ⚠ OPEN THREAD: NOT A RULING' : ''}`, '');
    for (const c of cs) {
      nClaims++;
      const a = claims[c.id];
      ra.push(`### RAQ ${c.id}`, '', `status: ${c.status}${a.outdated ? ' · ⚠ OUTDATED' : ''} · sections: ${a.sections.join(', ')}`, '',
        `- claim: ${c.claim}`, `- source: ${c.source}`, `- guards: ${c.guards.length ? c.guards.join(' | ') : '(none)'}`,
        ...(c.note ? [`- note: ${c.note}`] : []), ...(c.ticket ? [`- ticket: ${c.ticket}`] : []), '');
    }
  }
  if (!nClaims) ra.push('(no RAQ claim is assigned to this unit)', '');
  files['raq.md'] = ra.join('\n');

  /* printed.md */
  const pages = ex.printedPages.filter((p) => I.src.printedPages[`${p.doc} p.${p.page}`]?.units.includes(unit));
  files['printed.md'] = pages.length
    ? pages.map((p) => `=== ${p.doc} p.${p.page} ===\n${p.text.replace(/\s+$/, '')}\n`).join('\n')
    : '(no printed page is assigned to this unit)\n';

  /* cards.md */
  const kws = I.src.keywordReminders.filter((k) => unitOfNum(I.units, k.rule) === unit);
  const names = [...new Set(kws.map((k) => k.keyword))];
  const ca = [`# ${unit} — printed reminders and the cards that print them`, ''];
  if (!names.length) ca.push('(no keyword in this unit\'s sections prints a reminder)', '');
  for (const kw of names) {
    ca.push(`## ${kw}`, '', 'Printed reminders:', '');
    for (const k of kws.filter((x) => x.keyword === kw)) ca.push(`- ${k.card} (rule ${k.rule}; ${k.source}): "${k.quote}"`);
    const re = new RegExp(`\\b${kw.replace(/[^\w ]/g, '')}\\b`, 'i');
    const printing = ex.cards.filter((c) => (c.attrs ?? []).some((a) => a.toLowerCase() === kw.toLowerCase()) || re.test(c.text ?? '') || re.test(c.typeLine ?? ''))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    ca.push('', `Cards printing it (${printing.length}):`, '');
    for (const c of printing) ca.push(`- **${c.name}** — ${c.typeLine ?? ''}\n  ${String(c.text ?? '').replace(/\s*\n\s*/g, ' / ')}`);
    ca.push('');
  }
  files['cards.md'] = ca.join('\n');

  /* ours.md */
  const attrSection = new Map((ex.enums.attrs ?? []).map((a, i) => [a.toLowerCase(), `802.${i + 2}`]));
  const kwSection = new Map(I.src.keywordReminders.map((k) => [k.keyword.toLowerCase(), k.rule]));
  const mineSet = new Set(mine);
  const gl = [];
  for (const g of ex.glossary) {
    const t = String(g.term).toLowerCase();
    const sec = attrSection.get(t) ?? kwSection.get(t) ?? GLOSSARY_SECTION[g.term];
    const byTerm = sec && unitOfNum(I.units, sec) === unit;
    const cites = (Array.isArray(g.ruling) ? g.ruling : [g.ruling]).filter((x) => mineSet.has(x));
    if (!byTerm && !cites.length) continue;
    gl.push(`## ${g.term}`, '', `matched by: ${[byTerm ? `term (section ${sec})` : null, cites.length ? `cites ${cites.join(', ')}` : null].filter(Boolean).join('; ')}`, '', '```json', JSON.stringify(g, null, 1), '```', '');
  }
  files['ours.md'] = [`# ${unit} — glossary rows: OUR TEXT — NOT AUTHORITY`, '', 'client/ui/glossary.ts, written by this project. Never quote it as a source of a rule.', '', ...(gl.length ? gl : ['(no glossary row for this unit)', ''])].join('\n');

  /* tests.md */
  const cited = new Map();
  const cite = (file, why) => { const f = file.split('::')[0].trim(); if (!cited.has(f)) cited.set(f, new Set()); cited.get(f).add(why); };
  for (const id of mine) for (const f of rulings.get(id).testsCited ?? []) cite(f, id);
  for (const t of ex.raq) for (const c of t.claims) if (claims[c.id]?.units.includes(unit)) for (const gd of c.guards) cite(gd, `RAQ ${c.id}`);
  const tl = [`# ${unit} — test files cited by the unit's rulings and RAQ guards (${cited.size})`, ''];
  for (const f of [...cited.keys()].sort()) {
    const hit = ex.tests.filter((t) => t.file === f || t.file.endsWith(`/${f}`));
    tl.push(`## ${f}`, '', `cited by: ${[...cited.get(f)].sort().join(', ')}`, '');
    if (!hit.length) tl.push('(not in the tests index)', '');
    for (const t of hit) tl.push(`${t.file} (${t.titles.length} titles)`, ...t.titles.map((x) => `- ${x}`), '');
  }
  files['tests.md'] = tl.join('\n');

  /* seed/ */
  if (seed) {
    const inUnit = (n) => unitOfNum(I.units, String(n).replace(/[a-z]+$/, '')) === unit;
    files['seed/records.json'] = JSON.stringify(seed.records.filter((r) => inUnit(r.num)), null, 1) + '\n';
    files['seed/verdicts.json'] = JSON.stringify(seed.verdicts.flatMap(({ file, rows }) => rows.filter((v) => inUnit(v.num)).map((v) => ({ file, ...v }))), null, 1) + '\n';
  }
  return files;
}

/** the pilot's v2 records and every round's verdicts, from its scratch dir */
export function readSeed(dir) {
  const vdir = join(dir, 'verify');
  return {
    records: readJson(join(dir, 'draft-608-v2.json')),
    verdicts: readdirSync(vdir).filter((f) => /^verdicts-.*\.json$/.test(f)).sort().map((f) => ({ file: f, rows: readJson(join(vdir, f)) })),
  };
}

/** write one unit's pack, replacing the old one; → {file: chars} */
export function writePack(I, unit, seed = null) {
  const files = buildPack(I, unit, seed);
  const dir = join(CR_PACKS_DIR, unit);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  const sizes = {};
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), text);
    sizes[f] = text.length;
  }
  return sizes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--seed');
  const seedDir = si >= 0 ? args[si + 1] : null;
  const which = args.filter((a, i) => i !== si && i !== si + 1)[0];
  if (!which) { console.error('usage: node scripts/cr/pack.mjs <U01..U24|all> [--seed <pilot dir>]'); process.exit(2); }
  const { extract } = await import('./extract.mjs');
  const I = loadPackInputs(extract());
  const seed = seedDir ? readSeed(seedDir) : null;
  const SEEDED = new Set(['U12', 'U19', 'U20']);
  for (const u of which === 'all' ? I.units.map((x) => x.id) : [which]) {
    const sizes = writePack(I, u, SEEDED.has(u) ? seed : null);
    const total = Object.values(sizes).reduce((a, b) => a + b, 0);
    console.log(`${u}  ${total} chars  ${Object.entries(sizes).map(([f, n]) => `${f}=${n}`).join(' ')}`);
  }
}
