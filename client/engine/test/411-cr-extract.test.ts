/**
 * The comprehensive-rules EXTRACT step (scripts/cr/extract.mjs): the parser
 * every later stage trusts. Each count here is measured by a mechanism other
 * than the parser's own — two readings that share a premise are one piece of
 * evidence, not two.
 *
 *  §1 rulings: the parsed count equals `grep -c` of the headings; the b-suffix
 *     ruling is there; untitled headings take their first `###`; sorted.
 *  §2 supersession: every heading that carries a reversal / narrowing / extension
 *     / WITHDRAWN / ABSORBED / RETIRED mark yields a candidate; the edges the
 *     pilot missed are now proposed.
 *  §3 RAQ: one claim row per claim in ledgers/raq.ts, counted at runtime.
 *  §4 tests: titles are read by a tokenizer, escapes undone.
 *  §5 printed pages: none empty but the one all-image page; numbers follow the
 *     printed footers; known passages land on their pages.
 *  §6 extract() is deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CR_PRINTED_PAGES, DIGITAL_RULES } from '../scripts/paths.mjs';
import { extract } from '../scripts/cr/extract.mjs';
import { testTitlesOf } from '../scripts/cr/extract-test-titles.mjs';
import { RAQ } from '../../ledgers/raq.ts';
import { MANUAL_REMINDERS } from '../../ui/glossary.ts';

const X = extract();
const byId = new Map(X.rulings.map(r => [r.id, r]));
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

test('§1 every ruling heading is parsed — counted by grep, not by the parser', () => {
  const grepped = execFileSync('grep', ['-oE', '^## R[0-9]+b?\\b', DIGITAL_RULES], { encoding: 'utf8' })
    .trim().split('\n').map(l => l.slice(3));
  assert.ok(grepped.length >= 300, `grep found only ${grepped.length} headings — the pattern has gone blind`);
  assert.equal(X.rulings.length, grepped.length);
  assert.deepEqual([...byId.keys()].sort(), [...grepped].sort());
});

test('§1 the b-suffix ruling exists, and the list is sorted by number although the file is not', () => {
  assert.ok(byId.has('R197b'), 'R197b is missing');
  const r = byId.get('R197b')!;
  assert.equal(r.n, 197);
  assert.equal(r.suffix, 'b');
  for (let k = 1; k < X.rulings.length; k++) {
    const a = X.rulings[k - 1]!, b = X.rulings[k]!;
    assert.ok(a.n < b.n || (a.n === b.n && a.suffix < b.suffix), `${a.id} before ${b.id}`);
  }
  const inFileOrder = [...X.rulings].sort((a, b) => a.line - b.line);
  let inversions = 0;
  for (let k = 1; k < inFileOrder.length; k++) if (inFileOrder[k]!.n < inFileOrder[k - 1]!.n) inversions++;
  assert.ok(inversions > 0, 'the file has no inversions any more — this check proves nothing about sorting');
});

test('§1 a heading with no title takes its first ### line', () => {
  const md = readFileSync(DIGITAL_RULES, 'utf8').split('\n');
  for (const id of ['R199', 'R201', 'R204']) {
    const r = byId.get(id);
    assert.ok(r, `${id} missing`);
    assert.equal(md[r.line - 1]!.trim(), `## ${id}`, `${id}'s heading is no longer bare — pick another control`);
    const firstSub = md.slice(r.line).find(l => l.startsWith('### '))!;
    assert.ok(r.title.length > 10, `${id} has no title`);
    assert.equal(r.title, firstSub.slice(4).trim());
  }
});

test('§2 every heading-marked relation yields a candidate from that heading', () => {
  const marked = X.rulings.filter(r =>
    /\b(reversed|reverses|narrowed|narrows|extends)\b|WITHDRAWN|ABSORBED|RETIRED/.test(r.heading.replace(/^## R\d+b?/, '')));
  assert.ok(marked.length >= 21, `only ${marked.length} marked headings — the mark test has gone blind`);
  const missing = marked.filter(r => !X.supersessionCandidates.some(e => e.where === 'heading' && e.host === r.id))
    .map(r => r.heading);
  assert.deepEqual(missing, []);
});

test('§2 the relations the pilot missed are proposed (R3 by R295 and R261; R42 by R301)', () => {
  const has = (from: string, to: string): boolean =>
    X.supersessionCandidates.some(e => e.from === from && e.to === to);
  assert.ok(has('R295', 'R3'), 'R295 "What this amends: R3" not proposed');
  assert.ok(has('R261', 'R3'), 'R261 "[R3] stands, narrowed" not proposed');
  assert.ok(has('R301', 'R42'), 'R301 -> R42 not proposed');
  // and every candidate names two real rulings, never one ruling twice
  for (const e of X.supersessionCandidates) {
    assert.ok(byId.has(e.from) && byId.has(e.to) && e.from !== e.to, JSON.stringify(e));
  }
});

test('§3 one RAQ claim row per claim in ledgers/raq.ts, ids unique', () => {
  const runtime = RAQ.reduce((a, e) => a + (e.claims?.length ?? 0), 0);
  const rows = X.raq.flatMap(t => t.claims);
  assert.ok(runtime > 100, `raq.ts has only ${runtime} claims`);
  assert.equal(rows.length, runtime);
  assert.equal(new Set(rows.map(c => c.id)).size, rows.length);
  assert.equal(X.raq.length, RAQ.length);
});

test('§4 test titles come out of a tokenizer: escapes undone, comments and regexes skipped', () => {
  const title = (re: RegExp, file: string): string | undefined =>
    X.tests.find(t => t.file.endsWith(file))?.titles.find(s => re.test(s));
  assert.ok(title(/^§2 a Pure recipient's own Vulnerable is off too/, '290-pure-outside-combat.test.ts'));
  assert.ok(title(/^R340 Squish: Bubb with Good Whale's Piercing/, '405-raq-noncombat-piercing.test.ts'));
  const src = [
    "// test('in a comment')",
    "const q = /'/; const s = '\\u0041';",
    "test('it\\'s ' + \"two \" + `parts ${'}'}`, () => {});",
    "re.test('a method, not a test');",
    "/* test('in a block comment') */ test.todo(\"todo\\ttab\");",
  ].join('\n');
  assert.deepEqual(testTitlesOf(src), [{ title: "it's two parts ${'}'}" }, { title: 'todo\ttab' }]);
  assert.ok(X.tests.some(t => t.dir === 'ui') && X.tests.some(t => t.dir === 'server'));
});

test('§5 every printed page has text except the one all-image page, numbered by its footer', () => {
  const src = JSON.parse(readFileSync(CR_PRINTED_PAGES, 'utf8')) as {
    pages: { doc: string; page: number; footer: number | null; imageOnly?: boolean; text: string }[];
  };
  const imageOnly = src.pages.filter(p => p.imageOnly).map(p => `${p.doc} p.${p.page}`);
  assert.deepEqual(imageOnly, ['Manual p.4']);
  for (const p of src.pages) {
    if (!p.imageOnly) assert.ok(p.text.trim().length > 0, `${p.doc} p.${p.page} is empty`);
    if (p.footer !== null) assert.equal(p.footer, p.page, `${p.doc} p.${p.page} prints ${p.footer}`);
  }
  const pagesOf = (doc: string): number[] => src.pages.filter(p => p.doc === doc).map(p => p.page);
  assert.deepEqual(pagesOf('Manual'), Array.from({ length: 44 }, (_, i) => i + 1));
  assert.deepEqual(pagesOf('Rulebook 2023'), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(src.pages.filter(p => p.footer !== null).length >= 40, 'the footer check covers too few pages');
  assert.equal(X.printedPages.length, src.pages.length);
});

test('§5 known Manual passages land on their book pages', () => {
  const manual = X.printedPages.filter(p => p.doc === 'Manual');
  const headed = (word: string): number[] => manual
    .filter(p => new RegExp(`^(?:_ )?${word.replace(/[&]/g, '\\$&')}$`, 'm').test(p.text)).map(p => p.page);
  for (const [page, word] of [[23, 'DAMAGE'], [24, 'ATTRIBUTES'], [20, 'ATTACKING'], [33, 'GRAFT'], [42, 'Q&A']] as const) {
    assert.ok(headed(word).includes(page), `${word} is on ${JSON.stringify(headed(word))}, not p.${page}`);
  }
  // a second channel: the hand-entered pages of ui/manual-reminders.json
  assert.ok(MANUAL_REMINDERS.size >= 5);
  for (const [term, r] of MANUAL_REMINDERS) {
    const found = manual.filter(p => norm(p.text).includes(norm(r.text))).map(p => p.page);
    assert.deepEqual(found, [r.page], `${term}: the manual's sentence is on ${JSON.stringify(found)}, entered as p.${r.page}`);
  }
});

test('§6 extract() is deterministic', () => {
  assert.deepEqual(extract(), X);
});
