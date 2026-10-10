/**
 * THE GATE for the comprehensive-rules export (data/comprehensive-rules/).
 *
 * The document is generated, so the gate does not read it for meaning: it
 * proves that what is committed is what the scripts produce, and that every
 * record passes the mechanical half of the anti-hallucination contract
 * (scripts/cr/check.mjs). Six parts over the committed state:
 *
 *  (1) re-rendering gives the committed files, byte for byte, and the ledger
 *      needs no new number;
 *  (2) the ledger is append-only against the last commit (`git show HEAD:`);
 *  (3) check.mjs finds no problems;
 *  (4) every supersession candidate is decided        — a PINNED count until
 *  (5) every ruling is classified                      — the register stage
 *      lands its files; then both pins are 0, and a new ruling turns this red;
 *  (6) the stale count (sources changed since drafting) is pinned.
 *
 * Each part passes on an empty rules/ dir, and that would prove nothing on its
 * own: §8 and §9 run the same checks over a small fixture with one defect
 * planted per check and require each to fail BY NAME, so a check that went
 * blind is noticed. §7 unit-tests the ledger (the only place a number is born).
 *
 * Fast on purpose: one extract() (no pdftotext — the printed pages are a
 * committed JSON), one `git show`, no process per test title.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_ROOT, CR_LEDGER } from '../scripts/paths.mjs';
import { extract } from '../scripts/cr/extract.mjs';
import type { Extract } from '../scripts/cr/extract.d.mts';
import { render, loadInputs, OUTPUT_PATHS, type CrInputs } from '../scripts/cr/render.mjs';
import { check } from '../scripts/cr/check.mjs';
import {
  allocate, appendOnlyProblems, compareNums, emptyLedger, formatLedger, letterFor, letterIndex,
  LedgerError, type Ledger,
} from '../scripts/cr/ledger.mjs';
import { textHash, type RuleRecord } from '../scripts/cr/schema.mjs';

/* ── the pins (4)–(6). Each must EQUAL the measured count: a rise is new
 *    unreviewed work (a new ruling, a new candidate, a changed source) and a
 *    fall means lower the pin, so the number only ever ratchets down. ── */
/** supersession candidates with no reviewed row in supersession.json */
const EXPECTED_UNDECIDED = 74;
/** rulings with no row in classification.json (owner decision 4) */
const EXPECTED_UNCLASSIFIED = 329;
/** rules whose cited sources changed since they were drafted */
const EXPECTED_STALE = 0;

const EX: Extract = extract();
const INPUTS: CrInputs = loadInputs();
const OUT = render(INPUTS, EX);
const RESULT = check(INPUTS, EX);

function pinned(name: string, actual: number, pin: number, list: string): void {
  assert.ok(actual <= pin, `${name}: ${actual}, above the pin of ${pin}. New unreviewed work: ${list}`);
  assert.equal(actual, pin, `${name}: ${actual}, below the pin of ${pin} — lower EXPECTED_ in this file to ${actual}`);
}

test('(1) re-rendering gives the committed document files, byte for byte, and no number is born', () => {
  assert.deepEqual(OUT.born, [], `the committed ledger lacks ${OUT.born.length} number(s) (first: ${JSON.stringify(OUT.born[0])}) — run npm --prefix client run cr:render`);
  assert.equal(readFileSync(CR_LEDGER, 'utf8'), formatLedger(OUT.ledger), 'ledger.json is not in canonical form — run cr:render');
  for (const [k, p] of Object.entries(OUTPUT_PATHS)) {
    assert.ok(existsSync(p), `${relative(REPO_ROOT, p)} is missing — run cr:render`);
    assert.ok(readFileSync(p, 'utf8') === OUT.files[k as keyof typeof OUT.files],
      `${relative(REPO_ROOT, p)} differs from a fresh render — it is generated: fix the record and run cr:render, never edit the output`);
  }
  // and the render is deterministic: a second run is byte-identical
  assert.deepEqual(render(INPUTS, EX).files, OUT.files);
});

test('(2) the ledger is append-only against the last commit', (t) => {
  let head: string;
  try {
    head = execFileSync('git', ['show', `HEAD:${relative(REPO_ROOT, CR_LEDGER)}`], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? e);
    if (/does not exist|exists on disk, but not in/.test(msg)) { t.diagnostic('ledger.json is not in HEAD yet: nothing to be append-only against'); return; }
    t.skip(`git is unavailable here, so the append-only check cannot run: ${msg.split('\n')[0]}`);
    return;
  }
  const problems = appendOnlyProblems(JSON.parse(head) as Ledger, JSON.parse(readFileSync(CR_LEDGER, 'utf8')) as Ledger);
  assert.deepEqual(problems, [], `a published number moved, was dropped or was reused:\n${problems.join('\n')}`);
});

test('(3) check.mjs finds no problems in the committed records', () => {
  const lines = RESULT.problems.map((p) => `${p.code}  ${p.where}: ${p.msg}`);
  assert.deepEqual(lines, [], `${lines.length} problem(s):\n${lines.slice(0, 40).join('\n')}`);
});

test('(4) every supersession candidate is decided (pinned until supersession.json lands)', () => {
  pinned('undecided supersession candidates', RESULT.undecided.length, EXPECTED_UNDECIDED,
    RESULT.undecided.slice(0, 10).map((u) => `${u.from}>${u.to}`).join(', '));
});

test('(5) every ruling is classified (pinned until classification.json lands)', () => {
  pinned('unclassified rulings', RESULT.unclassified.length, EXPECTED_UNCLASSIFIED, RESULT.unclassified.slice(-10).join(', '));
});

test('(6) the stale count is pinned', () => {
  pinned('stale rules', RESULT.stale.length, EXPECTED_STALE, RESULT.stale.slice(0, 10).map((s) => `${s.where}: ${s.msg}`).join('; '));
});

/* ── §7 the ledger ─────────────────────────────────────────────────────── */

test('§7a subrule letters skip l and o, then run aa, ab …', () => {
  const first = Array.from({ length: 26 }, (_, i) => letterFor(i)).join(' ');
  assert.equal(first, 'a b c d e f g h i j k m n p q r s t u v w x y z aa ab');
  assert.ok(!/[lo]/.test(Array.from({ length: 600 }, (_, i) => letterFor(i)).join('')));
  for (let i = 0; i < 600; i++) assert.equal(letterIndex(letterFor(i)), i);
  assert.ok(compareNums('608.2z', '608.2aa') < 0 && compareNums('608.2', '608.2a') < 0 && compareNums('608.10', '608.9') > 0);
  assert.ok(compareNums('999.1', 'D1') < 0, 'Annex D sorts after the main document');
});

const SEC = { key: 'combat.damage', num: '608', section: true };
const it = (key: string, order: number, parent = '608') => ({ key, parent, order });

test('§7b a new rule inserted between two old ones goes to the END of its parent', () => {
  const one = allocate([SEC, it('a', 1), it('b', 2), it('b.x', 1, 'b')], emptyLedger(), { edition: 'E1' }).ledger;
  const num = (l: Ledger, k: string) => l.entries.find((e) => e.key === k)?.num;
  assert.equal(num(one, 'a'), '608.1');
  assert.equal(num(one, 'b'), '608.2');
  assert.equal(num(one, 'b.x'), '608.2a');
  const two = allocate([SEC, it('a', 1), it('between', 1.5), it('b', 2), it('b.x', 1, 'b'), it('b.w', 0, 'b')], one, { edition: 'E2' });
  assert.equal(num(two.ledger, 'between'), '608.3', 'the new key sorts between a and b by order, but is numbered at the end');
  assert.equal(num(two.ledger, 'b.w'), '608.2b');
  assert.equal(num(two.ledger, 'a'), '608.1');
  assert.equal(num(two.ledger, 'b'), '608.2');
  assert.deepEqual(two.born.map((b) => b.num).sort(), ['608.2b', '608.3']);
  assert.equal(two.ledger.entries.find((e) => e.key === 'between')?.since, 'E2');
  assert.deepEqual(appendOnlyProblems(one, two.ledger), []);
  // pure: the input ledger is untouched
  assert.equal(one.entries.length, 4);
});

test('§7c a removed rule becomes a tombstone that keeps its number, and its number is never handed out again', () => {
  const one = allocate([SEC, it('a', 1), it('b', 2), it('c', 3)], emptyLedger()).ledger;
  assert.throws(() => allocate([SEC, it('a', 1), it('b', 2), it('c', 3)], one, { remove: { b: { reason: 'merged into a' } } }), LedgerError,
    'a key that still has a record cannot be removed');
  const two = allocate([SEC, it('a', 1), it('c', 3)], one, { edition: 'E2', remove: { b: { reason: 'merged into a', replacedBy: 'a' } } });
  const tomb = two.ledger.entries.find((e) => e.key === 'b');
  assert.deepEqual(tomb, { num: '608.2', key: 'b', removed: 'merged into a', removedIn: 'E2', replacedBy: 'a' });
  const three = allocate([SEC, it('a', 1), it('c', 3), it('d', 4)], two.ledger).ledger;
  assert.equal(three.entries.find((e) => e.key === 'd')?.num, '608.4', 'the tombstone\'s 608.2 is not reused');
  assert.throws(() => allocate([SEC, it('a', 1), it('b', 2)], two.ledger), /removed .*cannot come back/);
  assert.deepEqual(appendOnlyProblems(one, two.ledger), []);
  assert.match(appendOnlyProblems(two.ledger, one).join('\n'), /was a tombstone/);
});

test('§7d reusing or moving a number is rejected', () => {
  const one = allocate([SEC, it('a', 1)], emptyLedger()).ledger;
  // a section claiming a number another key holds
  assert.throws(() => allocate([SEC, { key: 'other.section', num: '608', section: true }], one), /already held by combat\.damage.*never reused/);
  // a section moving
  assert.throws(() => allocate([{ key: 'combat.damage', num: '609', section: true }], one), /numbers never move/);
  // duplicate keys
  assert.throws(() => allocate([SEC, it('a', 1), it('a', 2)], one), /appears twice/);
  // too deep
  const deep = allocate([SEC, it('a', 1), it('a.x', 1, 'a')], emptyLedger()).ledger;
  assert.throws(() => allocate([SEC, it('a', 1), it('a.x', 1, 'a'), it('a.x.y', 1, 'a.x')], deep), /three levels/);
  // a hand-edited ledger that reuses or moves a number is caught by the append-only check
  const reused: Ledger = { ...one, entries: one.entries.map((e) => (e.key === 'a' ? { ...e, key: 'z' } : e)) };
  assert.match(appendOnlyProblems(one, reused).join('\n'), /608\.1 was a and is now z: a number is never reused/);
  const moved: Ledger = { ...one, entries: one.entries.map((e) => (e.key === 'a' ? { ...e, num: '608.5' } : e)) };
  assert.match(appendOnlyProblems(one, moved).join('\n'), /dropped|moved/);
});

test('§7e a key is renamed only through an alias, and keeps its number', () => {
  const one = allocate([SEC, it('old.key', 1), it('x', 2)], emptyLedger()).ledger;
  // without an alias, a renamed key is a new rule (new number) and the old one an orphan
  const plain = allocate([SEC, it('new.key', 1), it('x', 2)], one).ledger;
  assert.equal(plain.entries.find((e) => e.key === 'new.key')?.num, '608.3');
  const aliased: Ledger = { ...one, aliases: [{ from: 'old.key', to: 'new.key' }] };
  const r = allocate([SEC, it('new.key', 1), it('x', 2)], aliased);
  assert.deepEqual(r.born, []);
  assert.deepEqual(appendOnlyProblems(aliased, r.ledger), []);
  assert.match(appendOnlyProblems(aliased, one).join('\n'), /alias old\.key → new\.key was dropped/);
});

test('§7f the ledger is written deterministically, sorted in document order', () => {
  const l = allocate([SEC, { key: 'z.sec', num: '101', section: true }, it('b', 2), it('a', 1), it('a.x', 1, 'a')], emptyLedger()).ledger;
  const shuffled: Ledger = { ...l, entries: [...l.entries].reverse() };
  assert.equal(formatLedger(shuffled), formatLedger(l));
  assert.deepEqual(JSON.parse(formatLedger(l)).entries.map((e: { num: string }) => e.num), ['101', '608', '608.1', '608.1a', '608.2']);
});

/* ── §8 / §9: a fixture, clean, then with one defect planted per check ─── */

// Ruling ids are built, never written: test 184 reads every R-number spelled
// under client/ as a citation of the register.
const R = (n: number) => `R${n}`;
const REPO_FILE = 'client/engine/scripts/cr/schema.mjs';
const REPO_LINE = 'export const BASES';

function fixtureExtract(): Extract {
  const ruling = (n: number, body: string) => ({
    n, suffix: '', id: R(n), title: `Ruling ${n}`, glyphs: '', heading: `## ${R(n)} Ruling ${n}`, line: n, body,
    bodyHash: `h${n}`, dates: [], testsCited: [], rulingsCited: [], manualRefs: [], raqTitleRefs: [],
  });
  return {
    rulings: [
      ruling(1, 'Each column deals its combat damage as one source.'),
      ruling(2, 'Swift columns strike twice.'),
      ruling(3, 'A column with Swift and Sluggish strikes in both sub-steps.'),
      ruling(4, 'Damage is assigned by the dealer. There is no window between sub-steps.'),
    ],
    supersessionCandidates: [
      { from: R(3), to: R(2), verb: 'reverses', where: 'heading', ctx: '', host: R(3) },
      { from: R(3), to: R(4), verb: 'narrows', where: 'body', ctx: '', host: R(3) },
    ],
    raq: [{
      threadId: '111', title: '[Solved] Front and back', status: 'reviewed', note: null,
      claims: [{ id: '111#0', claim: 'You can deal all damage to the front unit.', source: 'calebgannon: "yes"', status: 'covered', guards: [], ticket: null, note: null, textHash: 'c0' }],
    }],
    glossary: [{ term: 'Swift', text: 'Swift units deal combat damage first.' }],
    cards: [{ name: 'Rime Wraith', kind: 'unit', timing: 'deploy', attrs: [], typeLine: 'Spirit Unit', text: 'Sluggish units deal combat damage last.' }],
    printedPages: [{ doc: 'Manual', page: 23, text: 'all of the following damage\nprocesses happen  simultaneously, unless modified by an ability:\nUnblocked units deal combat damage to the defend-\ning player.' }],
    enums: { phases: [], battleSteps: [], damageSubSteps: [], decisionKinds: [], zones: [], attrs: ['Flying', 'Deadly'], elements: [], cardKinds: [], timings: [] },
    tests: [{ file: 'client/engine/test/02-combat.test.ts', dir: 'engine', titles: ['swift column deals damage first', "the recipient's choice", 'dup', 'dup'] }],
    engineSymbols: ['assignCombatDamage', 'advanceBattleStep'],
  };
}

const OUTLINE = {
  title: 'Fixture Rules', subtitle: 'A fixture.',
  edition: { name: 'Fixture edition', effective: '2026-10-10', engineCommit: 'abc1234' },
  chapters: [
    { num: '6', title: 'Battle', sections: [{ num: '608', key: 'combat.damage', title: 'Combat Damage Step' }] },
    { num: '8', title: 'Keywords', sections: [{
      num: '802', key: 'keywords.attributes', title: 'Attributes',
      slots: [{ key: 'attr.general', title: 'General', order: 1 }],
      generate: { from: 'attrs', key: 'attr.{slug}', title: '{name}', orderStart: 2 },
    }] },
  ],
  annexD: { title: 'Annex D', precedence: 'The main document governs the game.', sections: [{ num: 'D1', key: 'annexd.general', title: 'General' }] },
  annexP: { title: 'Annex P' }, glossary: { title: 'Glossary' }, changelog: { title: 'Changelog' },
};

const TEXT_A = 'Each column deals its combat damage as one source, and all combat damage is dealt at once.';
function fixtureInputs(): CrInputs {
  const A: RuleRecord = {
    key: 'combat.damage.overview', parent: '608', order: 1, text: TEXT_A,
    examples: [{ text: 'Example: a Swift column strikes first.', test: '02-combat.test.ts::swift column deals damage first' }],
    see: ['802.3', 'combat.damage.choice'],
    sources: {
      printed: [
        { ref: 'Manual p.23', quote: 'processes happen simultaneously, unless modified by' },
        // a word broken across lines on the page: quoted whole, or ending on the broken half
        { ref: 'Manual p.23', quote: 'deal combat damage to the defending player' },
        { ref: 'Manual p.23', quote: 'Unblocked units deal combat damage to the defend-' },
      ],
      designer: [], ours: [{ ref: 'glossary: Swift', quote: 'Swift units deal combat damage first.' }],
      rulings: [R(1)], history: [{ ruling: R(2), relation: 'reversed' }],
      engine: ['engine.ts:assignCombatDamage'], tests: ['02-combat.test.ts'],
    },
    basis: 'mixed', confidence: 'high', sourceHashes: { [R(1)]: 'h1' },
  };
  const B: RuleRecord = {
    key: 'combat.damage.choice', parent: 'combat.damage.overview', order: 1,
    text: 'The dealing player may assign all of a column\'s damage to the front unit.',
    examples: [{ text: 'Example: the recipient\'s choice is never asked.', test: "02-combat.test.ts::the recipient's choice" }],
    see: [],
    sources: { printed: [], designer: [{ ref: 'RAQ 111#0', quote: 'deal all damage to the front unit' }], ours: [], rulings: [], history: [], engine: [], tests: [] },
    basis: 'designer', confidence: 'high', engineDiffers: ['F-1'], sourceHashes: { 'RAQ 111#0': 'c0' },
  };
  const C: RuleRecord = {
    key: 'attr.deadly', parent: '802', order: 3, text: 'Deadly is an attribute.',
    examples: [], see: [],
    sources: { printed: [{ ref: 'card: Rime Wraith', quote: 'Sluggish units deal combat damage last.' }], rulings: [{ ref: `${R(4)} its first sentence`, quote: 'Damage is assigned by the dealer.' }] },
    basis: 'mixed', confidence: 'medium', sourceHashes: { [R(4)]: 'h4' },
  };
  const G: RuleRecord = {
    key: 'glossary.column', term: 'Column', text: 'The units of a formation one behind another.', examples: [], see: ['608'],
    sources: {}, sourceHashes: {},
  };
  const inputs: CrInputs = {
    outline: structuredClone(OUTLINE), frontMatter: '## Introduction\n\nEdition {{EDITION}}, {{EFFECTIVE}}, {{ENGINE_COMMIT}}.\n',
    records: [A, B, C], glossary: [G], fileOf: new Map(),
    ledger: emptyLedger(),
    verdicts: [{
      key: 'combat.damage.overview', textHash: textHash(TEXT_A), verdict: 'confirmed', round: 1, verifier: 'fixture',
      engine: [], tests_run: [{ file: 'client/engine/test/02-combat.test.ts', passed: true }], source_checks: [],
      quote_spans: [{ file: REPO_FILE, text: REPO_LINE }], basis_ok: true, problem: '',
    }],
    discrepancies: [{
      id: 'D608-1', kind: 'a-sources-disagree', rule: 'combat.damage.choice', tier: 1,
      summary: 'Print reads as forced; the designer makes it elective.',
      sides: [{ source: 'Manual p.23', quote: 'processes happen simultaneously' }, { source: 'RAQ 111#0', quote: 'deal all damage' }],
      resolution: 'Follow the designer.',
    }],
    findings: [{ id: 'F-1', title: 'The engine asks the recipient', summary: 'It asks the wrong player.', evidence: [{ file: REPO_FILE, quote: REPO_LINE }], rule: 'combat.damage.choice' }],
    classification: { [R(1)]: { scope: 'game', sections: ['608'] }, [R(2)]: { scope: 'game' }, [R(3)]: { scope: 'game' }, [R(4)]: { scope: 'process', reason: 'tooling' } },
    supersession: { edges: [
      { from: R(3), to: R(2), relation: 'reverses', scope: null, decision: 'accepted' },
      { from: R(3), to: R(4), relation: 'narrows', scope: 'its second sentence', decision: 'accepted' },
    ] },
  };
  inputs.ledger = render(inputs, fixtureExtract()).ledger; // "committed": every key already numbered
  return inputs;
}

test('§8 the clean fixture passes every check — so each planted failure below is caused by its plant', () => {
  const r = check(fixtureInputs(), fixtureExtract());
  assert.deepEqual(r.problems.map((p) => `${p.code} ${p.where}: ${p.msg}`), []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.undecided, []);
  assert.deepEqual(r.unclassified, []);
});

type Plant = { name: string; code: string; plant: (i: CrInputs, x: Extract) => void };
const rec = (i: CrInputs, key: string): RuleRecord => {
  const r = [...i.records, ...i.glossary].find((x) => x.key === key);
  if (!r) throw new Error(`no fixture record ${key}`);
  return r;
};
const A = (i: CrInputs) => rec(i, 'combat.damage.overview');
const B = (i: CrInputs) => rec(i, 'combat.damage.choice');
const PLANTS: Plant[] = [
  { name: 'a record breaks the schema', code: 'schema', plant: (i) => { B(i).basis = 'vibes'; } },
  { name: 'a printed quote is not in its page', code: 'quote-not-verbatim', plant: (i) => { A(i).sources.printed![0]!.quote = 'processes happen at once'; } },
  { name: 'a card quote is not on the card', code: 'quote-not-verbatim', plant: (i) => { rec(i, 'attr.deadly').sources.printed![0]!.quote = 'Sluggish units deal combat damage first.'; } },
  { name: 'a designer quote is not in the RAQ claim', code: 'quote-not-verbatim', plant: (i) => { B(i).sources.designer![0]!.quote = 'deal all damage to the back unit'; } },
  { name: 'a ruling quote is not in the ruling body', code: 'quote-not-verbatim', plant: (i) => { (rec(i, 'attr.deadly').sources.rulings![0] as { quote: string }).quote = 'Damage is assigned by the recipient.'; } },
  { name: 'an ours quote is not in the glossary', code: 'quote-not-verbatim', plant: (i) => { A(i).sources.ours![0]!.quote = 'Swift units deal combat damage last.'; } },
  { name: 'a printed page that does not exist', code: 'source-missing', plant: (i) => { A(i).sources.printed![0]!.ref = 'Manual p.99'; } },
  { name: 'a cited ruling that does not exist', code: 'ruling-missing', plant: (i) => { A(i).sources.rulings = [R(999)]; } },
  { name: 'a superseded ruling cited as current', code: 'ruling-superseded', plant: (i) => { A(i).sources.rulings = [R(1), R(2)]; A(i).sourceHashes[R(2)] = 'h2'; } },
  { name: 'a partly superseded ruling cited bare', code: 'ruling-scope-required', plant: (i) => { rec(i, 'attr.deadly').sources.rulings = [R(4)]; } },
  { name: 'a RAQ claim that does not exist', code: 'raq-missing', plant: (i) => { B(i).sources.designer![0]!.ref = 'RAQ 111#9'; } },
  { name: 'an engine symbol that does not exist', code: 'engine-symbol-missing', plant: (i) => { A(i).sources.engine = ['engine.ts:assignCombatDamageTwice']; } },
  { name: 'an example bound to no test title', code: 'example-test-unresolved', plant: (i) => { A(i).examples[0]!.test = '02-combat.test.ts::no such title'; } },
  { name: 'an example bound to two test titles', code: 'example-test-unresolved', plant: (i) => { A(i).examples[0]!.test = '02-combat.test.ts::dup'; } },
  { name: 'a test file that does not exist', code: 'test-file-missing', plant: (i) => { A(i).sources.tests = ['999-nope.test.ts']; } },
  { name: 'basis designer with no designer quote', code: 'basis-inconsistent', plant: (i) => { A(i).basis = 'designer'; } },
  { name: 'basis printed resting only on our glossary', code: 'basis-inconsistent', plant: (i) => { A(i).basis = 'printed'; A(i).sources.printed = []; } },
  { name: 'a rule with no checkable evidence', code: 'no-evidence', plant: (i) => { const r = B(i); r.basis = 'engine'; r.sources.designer = []; r.sourceHashes = {}; } },
  { name: 'a see that resolves to no number', code: 'see-unresolved', plant: (i) => { A(i).see = ['608.99']; } },
  { name: 'engineDiffers names a finding that does not exist', code: 'finding-missing', plant: (i) => { B(i).engineDiffers = ['F-9']; } },
  { name: 'a discrepancy quote that is not verbatim', code: 'discrepancy-quote-not-verbatim', plant: (i) => { i.discrepancies[0]!.sides[1]!.quote = 'deal no damage'; } },
  { name: 'a cited ruling with no source hash', code: 'source-hash-missing', plant: (i) => { delete A(i).sourceHashes[R(1)]; } },
  { name: 'a record the ledger has not numbered', code: 'unnumbered', plant: (i) => { i.records.push({ ...structuredClone(B(i)), key: 'combat.damage.new', engineDiffers: [] }); } },
  { name: 'a ledger key with no record, not tombstoned', code: 'ledger-orphan', plant: (i) => { i.records = i.records.filter((r) => r.key !== 'combat.damage.choice'); i.discrepancies = []; i.findings = []; A(i).see = ['802.3']; } },
  { name: 'a record whose num disagrees with the ledger', code: 'num-mismatch', plant: (i) => { A(i).num = '608.7'; } },
  { name: 'two records with one key', code: 'duplicate-key', plant: (i) => { i.glossary.push({ ...structuredClone(rec(i, 'glossary.column')) }); } },
  { name: 'a verdict for no record', code: 'verdict-orphan', plant: (i) => { i.verdicts[0]!.key = 'no.such.rule'; } },
  { name: 'a verdict span given as an absolute path', code: 'verdict-span-path', plant: (i) => { i.verdicts[0]!.quote_spans[0]!.file = `/tmp/${REPO_FILE}`; } },
  { name: 'a classification row for no ruling', code: 'classification-orphan', plant: (i) => { i.classification![R(77777)] = { scope: 'game' }; } },
  { name: 'a supersession row naming no ruling', code: 'supersession-unresolved', plant: (i) => { i.supersession!.edges.push({ from: R(88888), to: R(1), relation: 'reverses', scope: null, decision: 'rejected' }); } },
  { name: 'the outline moves a numbered section', code: 'ledger', plant: (i) => { i.outline.chapters[0].sections[0].num = '609'; } },
  { name: 'a record filling a slot under the wrong parent', code: 'slot-parent-mismatch', plant: (i) => { rec(i, 'attr.deadly').parent = '608'; } },
];

for (const p of PLANTS) {
  test(`§8 planted: ${p.name} → ${p.code}`, () => {
    const i = fixtureInputs(), x = fixtureExtract();
    p.plant(i, x);
    const codes = check(i, x).problems.map((q) => q.code);
    assert.ok(codes.includes(p.code), `the check went blind: expected ${p.code}, got [${codes.join(', ')}]`);
  });
}

test('§8 the scoped citation of a partly superseded ruling is allowed; the apostrophe title resolves', () => {
  const i = fixtureInputs(), x = fixtureExtract();
  // positive controls, so the two plants above cannot pass by rejecting everything
  assert.equal(String(rec(i, 'attr.deadly').sources.rulings![0] && (rec(i, 'attr.deadly').sources.rulings![0] as { ref: string }).ref), `${R(4)} its first sentence`);
  assert.equal(B(i).examples[0]!.test, "02-combat.test.ts::the recipient's choice");
  assert.deepEqual(check(i, x).problems, []);
});

test('§8 the counted checks fire: stale, undecided, unclassified', () => {
  const i = fixtureInputs(), x = fixtureExtract();
  x.rulings[0]!.bodyHash = 'changed';
  x.raq[0]!.claims[0]!.textHash = 'changed too';
  x.supersessionCandidates.push({ from: R(4), to: R(1), verb: 'amends', where: 'body', ctx: '', host: R(4) });
  delete i.classification![R(4)];
  i.findings[0]!.evidence[0]!.quote = 'this line was fixed away';
  i.verdicts[0]!.quote_spans[0]!.text = 'nor is this one here';
  const r = check(i, x);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.stale.map((s) => `${s.kind} ${s.where}`).sort(), [
    'finding-evidence F-1', 'source combat.damage.choice', 'source combat.damage.overview', 'verdict-span combat.damage.overview',
  ]);
  assert.deepEqual(r.undecided, [{ from: R(4), to: R(1) }]);
  assert.deepEqual(r.unclassified, [R(4)]);
});

test('§9 the fixture renders: numbers, slots in Attr order, tombstones, see links, markers, determinism', () => {
  const x = fixtureExtract();
  const i = fixtureInputs();
  const out = render(i, x);
  const md = out.files.doc;
  assert.match(md, /\*\*608\.1\.\*\* Each column deals/);
  assert.match(md, /\*\*608\.1a\*\* The dealing player/);
  assert.match(md, /\*\*802\.2\. Flying\.\*\*/, 'the 802 slots come from enums.attrs, in order');
  assert.match(md, /\*\*802\.3\. Deadly\.\*\* Deadly is an attribute\./, 'a record fills its slot');
  assert.match(md, /See rules 802\.3, 608\.1a\./, 'see keys resolve to numbers');
  assert.match(md, /Engine differs, see F-1/);
  assert.match(md, /> \*Example \(non-normative\): a Swift column strikes first\.\*/);
  assert.match(md, /Edition Fixture edition, 2026-10-10, abc1234\./);
  assert.match(md, /\| Mixed \| 2 \|/);
  assert.ok(md.includes(`Process rulings, excluded\n\n- ${R(4)}: tooling`));
  // HTML: anchors, chips, folded provenance, links
  const html = out.files.html;
  for (const re of [/id="r608\.1a"/, /class="chip b-designer"/, /class="chip v-confirmed"/, /<details><summary>Provenance/, /<a href="#r802\.3">802\.3<\/a>/, /class="differs">engine differs, see <a href="#F-1">F-1<\/a>/, /id="D608-1"/]) {
    assert.match(html, re);
  }
  // plain text: ASCII tokens, no Markdown marks
  assert.doesNotMatch(out.files.txt, /\*\*|<sub>|[—→“”]/);
  assert.match(out.files.txt, /^608\.1a The dealing player/m);
  assert.match(out.files.discrepanciesMd, /## 1\. Questions for the owner \(1\)\n\n### D608-1/);
  assert.match(out.files.annexD, /## Precedence\n\nThe main document governs the game\./);
  // a tombstone
  const removed = allocate([], i.ledger, { edition: 'Second', remove: { 'combat.damage.choice': { reason: 'merged into 608.1' } } }).ledger;
  const j = fixtureInputs();
  j.ledger = removed;
  j.records = j.records.filter((r) => r.key !== 'combat.damage.choice');
  j.discrepancies = []; j.findings = []; A(j).see = [];
  const out2 = render(j, x);
  assert.match(out2.files.doc, /\*\*608\.1a\*\* \[Removed: merged into 608\.1\]/);
  assert.match(out2.files.changelog, /## Second\n\n- New: 0 rules\.\n- Removed: 608\.1a `combat\.damage\.choice`: merged into 608\.1/);
  // byte-deterministic
  assert.deepEqual(render(fixtureInputs(), fixtureExtract()).files, out.files);
});

test('§9 an empty rules dir renders every section as "No rules drafted yet" and checks clean', () => {
  const x = fixtureExtract();
  const i = fixtureInputs();
  i.records = []; i.glossary = []; i.verdicts = []; i.discrepancies = []; i.findings = [];
  i.ledger = emptyLedger();
  const out = render(i, x);
  i.ledger = out.ledger;
  assert.match(out.files.doc, /### 608\. Combat Damage Step\n\n\*No rules drafted yet\.\*/);
  assert.deepEqual(check(i, x).problems, []);
});
