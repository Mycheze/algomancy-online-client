/**
 * The comprehensive-rules EXTRACT step (scripts/cr/extract.mjs): the parser
 * every later stage trusts. Each count here is measured by a mechanism other
 * than the parser's own — two readings that share a premise are one piece of
 * evidence, not two.
 *
 *  (§1 rulings and §2 supersession candidates went with the R-ruling register
 *  in the 2026-10 CR-only migration: the extract no longer reads it.)
 *  §3 RAQ: one claim row per claim in ledgers/raq.ts, counted at runtime.
 *  §4 tests: titles are read by a tokenizer, escapes undone.
 *  §5 printed pages: none empty but the one all-image page; numbers follow the
 *     printed footers; known passages land on their pages.
 *  §6 extract() is deterministic.
 *  §7 engine symbols: class methods are declared names (private ones, and ones
 *     whose parameter list runs over lines or holds a `;`); calls are not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CR_PRINTED_PAGES } from '../scripts/paths.mjs';
import { extract, symbolsIn } from '../scripts/cr/extract.mjs';
import { testTitlesOf } from '../scripts/cr/extract-test-titles.mjs';
import { RAQ } from '../../ledgers/raq.ts';
import { MANUAL_REMINDERS } from '../../ui/glossary.ts';

const X = extract();
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

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
  assert.ok(title(/Squish: Bubb with Good Whale's Piercing/, '405-raq-noncombat-piercing.test.ts'), 'the escaped apostrophe in a title was not undone');
  assert.ok(!('rulings' in X), 'the extract still reads the retired register');
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

test('§7 engine symbols include the class methods a rule names (positive control)', () => {
  const have = new Set(X.engineSymbols);
  // private with a multi-line parameter list; public with a `;` inside its parameters
  for (const n of ['assignColumnDamage', 'electionWalk', 'dealEffectDamageAll', 'defaultSplitAmounts']) {
    assert.ok(have.has(n), `${n} is a method declared in client/engine/src`);
  }
});

test('§7 the symbol scan reads method declarations, not calls or data fields', () => {
  const src = [
    'class E {',
    '  private walk(b: B, key: string,',
    '      seat: Seat): void {',
    '  dealAll(ctx: Ctx, hits: { target: T; n: number }[]): void {',
    '  static make<T>(x: T): E {',
    '  onHit = (u: Unit) => u.id;',
    '  sizeOf(u: Unit): number;',
    '  damageSubs: string[] = [];',
    '  run() {',
    '    helper(x);',
    '    forEachUnit(g, (u) => {',
    '    if (x) {',
    '  }',
    '}',
    'const table = {',
    '  pick: (g, self) => g.first(self),',
    '  label: \'not a function\',',
    '};',
  ].join('\n');
  assert.deepEqual([...symbolsIn(src)].sort(), ['E', 'dealAll', 'make', 'onHit', 'pick', 'run', 'sizeOf', 'table', 'walk']);
});
