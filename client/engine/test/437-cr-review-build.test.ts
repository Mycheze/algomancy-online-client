/**
 * THE RULES REVIEW PAGE'S DOCUMENT: render.mjs `buildReview()`.
 *
 * Nothing review-shaped is committed. The game server (server/api-crreview.ts)
 * calls buildReview() on the committed records and the page paints what it
 * returns (ui/crtypes.ts CrReview), so this file proves the build is the
 * document and nothing else:
 *
 *  - every rule (live and tombstoned), section, glossary row, finding and
 *    discrepancy carries exactly one `data-crt` mark, and `targets` is those
 *    marks, derived from the html, in document order;
 *  - every part's html is the published .html edition's own fragment with the
 *    marks added and nothing else; its md is bytes of the .md edition, its txt
 *    bytes of the .txt edition; `files` are the editions;
 *  - the owner questions are owner-questions.md's, in its order and numbering;
 *  - the drafter's notes never reach it, and no part can carry script.
 *
 * Whether it agrees with the COMMITTED files (born 0, same numbers and keys)
 * is 409 §12, beside 409 (1), which byte-checks those files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { CR_DIR, CR_RULES_DIR } from '../scripts/paths.mjs';
import { extract } from '../scripts/cr/extract.mjs';
import { buildReview, loadInputs, render } from '../scripts/cr/render.mjs';
import { allocate, formatLedger } from '../scripts/cr/ledger.mjs';
import type { CrReview } from '../../ui/crtypes.ts';

const EX = extract();
const R: CrReview = await buildReview({ ex: EX });
const INPUTS = loadInputs();
const FILES = render(INPUTS, EX).files;

const MARK = /\sdata-crt="([^"]*)"/g;
const marksIn = (html: string): string[] => [...html.matchAll(MARK)].map(m => m[1]!);
const unmark = (html: string): string => html.replace(MARK, '');
const ALL_HTML = [...R.parts.map(p => p.html), ...R.disc.map(d => d.html)];

test('every ledger rule, live or tombstoned, is marked exactly once; keys, removed and aliases are the ledger', () => {
  const count = new Map<string, number>();
  for (const t of R.targets) count.set(t, (count.get(t) ?? 0) + 1);
  const ledger = INPUTS.ledger;
  const rules = ledger.entries.filter(e => e.kind !== 'section');
  assert.ok(rules.length > 1000, `only ${rules.length} rule entries: the committed ledger did not load`);
  for (const e of rules) assert.equal(count.get(`rule:${e.key}`), 1, `rule ${e.num} (${e.key}) is marked ${count.get(`rule:${e.key}`) ?? 0} times`);
  for (const e of ledger.entries.filter(x => x.kind === 'section')) assert.equal(count.get(`sec:${e.num}`), 1, `section ${e.num} is not marked once`);
  assert.deepEqual(R.keys, Object.fromEntries(ledger.entries.map(e => [e.key, e.num])));
  assert.deepEqual(R.removed, Object.fromEntries(ledger.entries.filter(e => e.removed).map(e => [e.key, e.num])));
  assert.deepEqual(R.aliases, Object.fromEntries(ledger.aliases.map(a => [a.from, a.to])));
  // each rule mark sits on the article that carries that rule's number
  for (const p of R.parts) {
    for (const m of p.html.matchAll(/<article class="rule [^"]*" id="r([^"]+)" data-crt="rule:([^"]+)"/g)) {
      assert.equal(R.keys[m[2]!], m[1], `the article for r${m[1]} is marked with ${m[2]}, whose number is ${R.keys[m[2]!]}`);
    }
  }
});

test('targets are the marks in the html, in document order, each once; every glossary row, finding and discrepancy has one', () => {
  assert.deepEqual(R.targets, ALL_HTML.flatMap(marksIn), 'targets must be derived from the html, in part order');
  assert.equal(new Set(R.targets).size, R.targets.length, 'a target is marked twice');
  for (const t of R.targets) assert.match(t, /^(front|annexP|changelog|annexD|(sec|rule|gloss|disc|finding):[^\s"<>]+)$/, `not a CrTarget: ${t}`);
  const has = new Set(R.targets);
  for (const id of ['front', 'annexP', 'changelog', 'annexD']) assert.ok(has.has(id as never), `${id} is not marked`);
  for (const g of INPUTS.glossary) assert.ok(has.has(`gloss:${g.key}`), `glossary row ${g.key} is not marked`);
  for (const f of INPUTS.findings) assert.ok(has.has(`finding:${f.id}`), `finding ${f.id} is not marked`);
  assert.equal(R.disc.length, INPUTS.discrepancies.length);
  for (const d of R.disc) {
    assert.ok(d.html.startsWith(`<article class="disc" id="${d.id}" data-crt="disc:${d.id}">`), `${d.id}: the mark is not on the item root`);
    assert.deepEqual(marksIn(d.html), [`disc:${d.id}`], `${d.id} holds a mark that is not its own`);
  }
  // tiers in report order
  assert.deepEqual(R.disc.map(d => d.tier), [...R.disc.map(d => d.tier)].sort());
});

test('the contents list every part once: chapters by their sections, then Annex P, the glossary, the changelog, Annex D', () => {
  const listed = R.toc.flatMap(e => (e.sections ? [...(e.lead ? [e.lead] : []), ...e.sections.map(s => s.part)] : [e.id]));
  assert.deepEqual(listed, R.parts.map(p => p.id), 'the toc and the parts disagree on what is in the document or its order');
  assert.deepEqual(R.toc.map(e => e.id), [
    'front', ...INPUTS.outline.chapters.map((c: { num: string }) => `ch${c.num}`), 'annexP', 'glossary', 'changelog', 'chD',
  ]);
  // Annex D opens with its precedence paragraph, which is in no section: the
  // page painted Annex D from D1 until 2026-10-10
  const d = R.toc.find(e => e.id === 'chD')!;
  assert.equal(d.lead, 'annexD');
  const lead = R.parts.find(p => p.id === 'annexD')!;
  assert.equal(lead.kind, 'lead');
  assert.equal(lead.chapter, 'D');
  assert.ok(lead.html.includes(INPUTS.outline.annexD.precedence.slice(0, 60)), 'the lead holds the precedence paragraph');
  assert.equal(R.toc.filter(e => e.lead).length, 1, 'only Annex D has a lead');
  for (const e of R.toc) {
    for (const s of e.sections ?? []) {
      const p = R.parts.find(x => x.id === s.part)!;
      assert.equal(p.kind, 'section');
      assert.equal(`ch${p.chapter}`, e.id, `${p.id} is filed under ${e.id} but says chapter ${p.chapter}`);
      assert.equal(p.num, s.num);
    }
  }
});

test('each part is the editions own text: html with only the marks added, md and txt verbatim', () => {
  const html = FILES.html, md = FILES.doc + '\n', annexD = FILES.annexD + '\n', txt = FILES.txt;
  for (const p of R.parts) {
    if (p.kind === 'section' || p.kind === 'front') {
      assert.ok(html.includes(unmark(p.html)), `${p.id}: the html is not the edition fragment plus marks`);
    }
    assert.ok(md.includes(p.md) || annexD.includes(p.md), `${p.id}: the md is not bytes of the .md edition or Annex D`);
    // the .txt edition has no Annex D (the lead's md is its Precedence block, which only Annex D's file has)
    if (p.chapter !== 'D') assert.ok(txt.includes(p.kind === 'section' ? p.txt : p.txt.trimEnd()), `${p.id}: the txt is not bytes of the .txt edition`);
  }
  // annexP, glossary, changelog: unmarking leaves the edition with at most a wrapper element around it
  for (const id of ['annexP', 'glossary', 'changelog', 'annexD']) {
    const bare = unmark(R.parts.find(p => p.id === id)!.html).replace(/<div>\n?|\n?<\/div>(?=<div>|<\/dl>|$)/g, '');
    for (const line of bare.split('\n')) assert.ok(html.includes(line), `${id}: "${line.slice(0, 80)}" is not in the html edition`);
  }
  for (const d of R.disc) assert.ok(html.includes(unmark(d.html)), `${d.id}: the html is not the report item plus its mark`);
  assert.deepEqual(
    { doc: R.files.doc.text, html: R.files.html.text, txt: R.files.txt.text, annexD: R.files.annexD.text, discrepanciesMd: R.files.disc.text, ownerQuestions: R.files.oq.text, changelog: R.files.changelog.text },
    FILES, 'files must be render() output');
});

test('a section downloaded as html is the edition shell filled: one title hole, one body hole', () => {
  assert.equal(R.shell.split('{{TITLE}}').length, 2);
  assert.equal(R.shell.split('{{BODY}}').length, 2);
  const [head] = FILES.html.split('<body>');
  assert.equal(R.shell.split('<body>')[0], head!.replace(/<title>[^<]*<\/title>/, '<title>{{TITLE}}</title>'), 'the shell head (its CSS) is not the editions');
});

test('owner questions are owner-questions.md, in its order and numbering, with each items reading labels', () => {
  const ids = [...R.files.oq.text.matchAll(/^\*(D-[A-Z0-9-]+), rule /gm)].map(m => m[1]);
  const items = R.ownerQuestions.flatMap(t => t.items);
  assert.ok(items.length > 0, 'no owner questions');
  assert.deepEqual(items.map(i => i.id), ids);
  assert.deepEqual(items.map(i => i.n), items.map((_, i) => i + 1));
  const topics = [...R.files.oq.text.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(R.ownerQuestions.map(t => t.topic), topics);
  const tier1 = INPUTS.discrepancies.filter(d => d.tier === 1 && d.question);
  assert.deepEqual(new Set(items.map(i => i.id)), new Set(tier1.map(d => d.id)));
  for (const it of items) {
    const d = tier1.find(x => x.id === it.id)!;
    assert.deepEqual(it.readings, (d.question!.readings ?? []).map(r => r.label));
    assert.ok(it.readings.length >= 2, `${it.id} offers ${it.readings.length} readings`);
  }
});

test('the drafter notes never reach the page, and no part can carry script', () => {
  const all = JSON.stringify(R);
  let checked = 0;
  for (const r of [...INPUTS.records, ...INPUTS.glossary]) {
    const n = (r as { notes?: unknown }).notes;
    if (typeof n !== 'string' || n.length < 40) continue;
    checked++;
    assert.ok(!all.includes(JSON.stringify(n).slice(1, -1)), `${r.key}: its notes are in the review`);
  }
  assert.ok(checked > 100, `only ${checked} notes checked`);
  for (const h of [...ALL_HTML, R.shell]) {
    // record text is escaped, so a tag here is the renderer's own; check the tags, not the prose
    // ("Probe: onStack=false" is prose)
    assert.doesNotMatch(h, /<(script|iframe|object|embed)\b/i);
    assert.doesNotMatch(h, /<[a-z][^>]*\son[a-z]+\s*=/i);
    assert.doesNotMatch(h, /<[a-z][^>]*=\s*"?\s*javascript:/i);
  }
});

test('inputs name every file the build read, the directories included, so a new record file invalidates the cache', () => {
  assert.ok(R.inputs.every(p => isAbsolute(p)));
  assert.ok(R.inputs.includes(CR_RULES_DIR));
  for (const f of readdirSync(CR_RULES_DIR).filter(x => x.endsWith('.json'))) assert.ok(R.inputs.includes(join(CR_RULES_DIR, f)), `${f} is not in inputs`);
});

test('the build is deterministic', async () => {
  assert.deepEqual(await buildReview({ ex: EX }), R);
});

test('a removed rule still renders as a marked tombstone, so its comments have somewhere to show', async () => {
  // the committed ledger has no tombstone yet: remove one leaf rule in a copy
  // the leaf must be named by nothing else that renders: no record, discrepancy or finding
  const named = ['rules', 'discrepancies', 'findings'].flatMap(d => readdirSync(join(CR_DIR, d)).map(f => readFileSync(join(CR_DIR, d, f), 'utf8'))).join('\n');
  const uses = (key: string): number => named.split(new RegExp(`(?<![\\w.-])${key.replace(/\./g, '\\.')}(?![\\w-]|\\.[a-z0-9])`)).length - 1;
  const leaf = INPUTS.records.find(r => !INPUTS.records.some(x => x.parent === r.key) && uses(r.key) === 1 /* its own record */);
  assert.ok(leaf, 'no leaf rule that nothing names');
  const dir = mkdtempSync(join(tmpdir(), 'cr437-'));
  try {
    const rulesDir = join(dir, 'rules');
    cpSync(CR_RULES_DIR, rulesDir, { recursive: true });
    for (const f of readdirSync(rulesDir)) {
      const rows = JSON.parse(readFileSync(join(rulesDir, f), 'utf8')) as { key: string }[];
      writeFileSync(join(rulesDir, f), JSON.stringify(rows.filter(r => r.key !== leaf.key)));
    }
    const ledger = join(dir, 'ledger.json');
    writeFileSync(ledger, formatLedger(allocate([], INPUTS.ledger, { edition: 'Test', remove: { [leaf.key]: { reason: 'removed by 437' } } }).ledger));
    const r = await buildReview({ paths: { rulesDir, ledger }, ex: EX });
    const num = R.keys[leaf.key]!;
    assert.equal(r.born, 0);
    assert.deepEqual(r.removed, { [leaf.key]: num });
    assert.ok(r.targets.includes(`rule:${leaf.key}`));
    const sec = r.parts.find(p => p.html.includes(`id="r${num}"`))!;
    assert.match(sec.html, new RegExp(`<article class="rule [^"]* tomb" id="r${num.replace(/\./g, '\\.')}" data-crt="rule:${leaf.key.replace(/\./g, '\\.')}">`));
    assert.ok(r.inputs.includes(rulesDir) && r.inputs.includes(ledger), 'inputs follow the paths given');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
