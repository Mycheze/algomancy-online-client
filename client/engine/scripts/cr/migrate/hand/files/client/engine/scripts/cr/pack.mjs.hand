/**
 * A drafting unit's source pack: everything the Stage C drafter for one unit
 * reads, gathered out of the extract and the reviewed state, in one directory.
 *
 *   node scripts/cr/pack.mjs <U12|all> [--seed <pilot dir>]
 *
 * writes `CR_PACKS_DIR/<unit>/` (gitignored, inside the build dir):
 *   owner.md     every owner call already on the unit's records (`sources.owner`):
 *                his words, the date he adopted them and where he said them, under
 *                the rule that carries them. The owner's calls live in the records
 *                now; there is no register to pack.
 *   raq.md       every RAQ claim assigned to the unit, verbatim, with its
 *                guards and note; a claim in a thread still open is flagged
 *   printed.md   the Manual / Rulebook pages assigned to the unit
 *   cards.md     the printed reminder of each keyword in the unit's sections,
 *                and every card printing that keyword
 *   ours.md      our glossary rows for the unit — OUR TEXT, NOT AUTHORITY
 *   tests.md     the titles of every test file the unit's records bind or cite,
 *                or its claims name as guards
 *   seed/        with --seed: the pilot's records and verdicts for the unit
 *
 * Deterministic: the same inputs give byte-identical files. `buildPack` is
 * pure; `writePack` does the disk work.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CR_PACKS_DIR, CR_SOURCE_CLASSIFICATION, CR_UNITS } from '../paths.mjs';
import { loadInputs } from './render.mjs';
import { indexLedger } from './ledger.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
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
    src: readJson(CR_SOURCE_CLASSIFICATION),
    inputs: loadInputs(),
  };
}

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
  const L = indexLedger(I.inputs.ledger);
  const records = I.inputs.records.filter((r) => { const n = L.numOf(r.key); return n && unitOfNum(I.units, n.replace(/[a-z]+$/, '')) === unit; });
  const mineKeys = new Set(records.map((r) => r.key));

  /* owner.md */
  const ol = [`# ${unit} — the owner's calls on this unit's rules`, '', `Unit: ${U.title} (rules ${U.rules}). Each quote is the owner's own words, adopted on the date shown; it is its own evidence. A new owner call is added to the record it settles (sources.owner, from: "comment <id>").`, ''];
  for (const r of records) {
    if (!(r.sources?.owner ?? []).length) continue;
    ol.push(`## ${L.numOf(r.key)} ${r.key}`, '', ...r.sources.owner.map((o) => `- adopted ${o.adopted}${o.from ? ` (${o.from})` : ''}: "${o.quote}"`), '');
  }
  files['owner.md'] = ol.join('\n');

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
  const gl = [];
  for (const g of ex.glossary) {
    const t = String(g.term).toLowerCase();
    const sec = attrSection.get(t) ?? kwSection.get(t) ?? GLOSSARY_SECTION[g.term];
    const byTerm = sec && unitOfNum(I.units, sec) === unit;
    const cites = (Array.isArray(g.rule) ? g.rule : [g.rule]).filter((x) => mineKeys.has(x));
    if (!byTerm && !cites.length) continue;
    gl.push(`## ${g.term}`, '', `matched by: ${[byTerm ? `term (section ${sec})` : null, cites.length ? `cites ${cites.join(', ')}` : null].filter(Boolean).join('; ')}`, '', '```json', JSON.stringify(g, null, 1), '```', '');
  }
  files['ours.md'] = [`# ${unit} — glossary rows: OUR TEXT — NOT AUTHORITY`, '', 'client/ui/glossary.ts, written by this project. Never quote it as a source of a rule.', '', ...(gl.length ? gl : ['(no glossary row for this unit)', ''])].join('\n');

  /* tests.md */
  const cited = new Map();
  const cite = (file, why) => { const f = file.split('::')[0].trim(); if (!cited.has(f)) cited.set(f, new Set()); cited.get(f).add(why); };
  for (const r of records) for (const f of [...(r.sources?.tests ?? []), ...(r.examples ?? []).map((x) => x.test).filter(Boolean)]) cite(f, L.numOf(r.key));
  for (const t of ex.raq) for (const c of t.claims) if (claims[c.id]?.units.includes(unit)) for (const gd of c.guards) cite(gd, `RAQ ${c.id}`);
  const tl = [`# ${unit} — test files bound by the unit's rules and its RAQ guards (${cited.size})`, ''];
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
  const which = args.filter((a, i) => si < 0 || (i !== si && i !== si + 1))[0];
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
