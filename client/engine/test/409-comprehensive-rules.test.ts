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
 *  (4) every supersession candidate is decided, or held as an `uncertain`
 *      row (both quotes, for the owner) — only that count is pinned;
 *  (5) every ruling is classified, so a new ruling turns this red, and the
 *      reviewed state is mechanically sound: every edge quote verbatim, every
 *      status agreeing with its edges, every source assigned exactly once;
 *  (6) the stale count (sources changed since drafting) is pinned.
 *
 * Each part passes on an empty rules/ dir, and that would prove nothing on its
 * own: §8 and §9 run the same checks over a small fixture with one defect
 * planted per check and require each to fail BY NAME, so a check that went
 * blind is noticed. §7 unit-tests the ledger (the only place a number is born).
 * §10 tests the harness (scripts/cr/harness.mjs): plant, judge, feedback,
 * finalize and stamp, each over a fixture with its defect planted.
 *
 * Fast on purpose: one extract() (no pdftotext — the printed pages are a
 * committed JSON), one `git show`, no process per test title.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_ROOT, CR_LEDGER, CR_SOURCE_CLASSIFICATION, CR_UNITS } from '../scripts/paths.mjs';
import { extract } from '../scripts/cr/extract.mjs';
import type { Extract } from '../scripts/cr/extract.d.mts';
import { render, loadInputs, OUTPUT_PATHS, type CrInputs } from '../scripts/cr/render.mjs';
import { check } from '../scripts/cr/check.mjs';
import {
  allocate, appendOnlyProblems, compareNums, emptyLedger, formatLedger, letterFor, letterIndex,
  LedgerError, type Ledger,
} from '../scripts/cr/ledger.mjs';
import { norm, recordHash, validateFinding, type RuleRecord } from '../scripts/cr/schema.mjs';
import {
  badSpans, buildFeedback, finalize, judge, plant, roundKeys, sameAsVerified, shuffleRank, stamp,
  type Mutant, type RoundFiles,
} from '../scripts/cr/harness.mjs';

/* ── the pins (4)–(6). Each must EQUAL the measured count: a rise is new
 *    unreviewed work (a new ruling, a new candidate, a changed source) and a
 *    fall means lower the pin, so the number only ever ratchets down. ── */
/** supersession.json's `uncertain` rows: questions the register review could
 *  not settle, held undecided for the owner. Resolving one lowers this */
const EXPECTED_UNCERTAIN = 9;
/** rules whose cited sources changed since they were drafted */
const EXPECTED_STALE = 0;

const EX: Extract = extract();
// A broken ledger must fail (1) and (3) by name, not crash the file before (2)
// can say which number moved — so the committed state is loaded defensively.
let INPUTS: CrInputs | null = null, OUT: ReturnType<typeof render> | null = null, LOAD_ERROR = '';
try { INPUTS = loadInputs(); OUT = render(INPUTS, EX); } catch (e) { LOAD_ERROR = String((e as Error).message ?? e); }
const RESULT = INPUTS ? check(INPUTS, EX) : null;

function pinned(name: string, actual: number, pin: number, list: string): void {
  assert.ok(actual <= pin, `${name}: ${actual}, above the pin of ${pin}. New unreviewed work: ${list}`);
  assert.equal(actual, pin, `${name}: ${actual}, below the pin of ${pin} — lower EXPECTED_ in this file to ${actual}`);
}

test('(1) re-rendering gives the committed document files, byte for byte, and no number is born', () => {
  assert.ok(INPUTS && OUT, `the committed state does not render: ${LOAD_ERROR}`);
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

function result(): NonNullable<typeof RESULT> {
  assert.ok(RESULT, `the committed state does not load: ${LOAD_ERROR}`);
  return RESULT;
}

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
  const lines = result().problems.map((p) => `${p.code}  ${p.where}: ${p.msg}`);
  assert.deepEqual(lines, [], `${lines.length} problem(s):\n${lines.slice(0, 40).join('\n')}`);
});

/* the reviewed state's own shape, beyond what check.mjs reads */
type Quoted = { quote: string; quoteFrom: string };
type Edge = { from: string; to: string; relation?: string; scope?: string | null; decision: string } & Partial<Quoted>;
type Uncertain = { from: string; to: string; kind: string; question: string; quotes: Quoted[] };
type ClsRow = { status: string; scope: string; units: string[]; staleWarning?: Quoted; uncertain?: string[] };
const SUP = (INPUTS?.supersession ?? { edges: [] }) as unknown as { edges: Edge[]; uncertain?: Uncertain[] };
const CLS = (INPUTS?.classification ?? {}) as unknown as Record<string, ClsRow>;

test('(4) every supersession candidate is decided, or held as an uncertain row (only those pinned)', () => {
  const r = result();
  const held = new Set((SUP.uncertain ?? []).map((u) => `${u.from}>${u.to}`));
  const loose = r.undecided.map((u) => `${u.from}>${u.to}`).filter((k) => !held.has(k));
  assert.deepEqual(loose, [], `supersession candidates with no decision in supersession.json: ${loose.slice(0, 10).join(', ')}`);
  pinned('uncertain supersession rows', (SUP.uncertain ?? []).length, EXPECTED_UNCERTAIN,
    (SUP.uncertain ?? []).map((u) => `${u.from}>${u.to}`).join(', '));
});

test('(5) every ruling is classified, and the reviewed state is mechanically sound', () => {
  const r = result();
  assert.deepEqual(r.unclassified, [], `rulings with no row in classification.json: ${r.unclassified.join(', ')}`);
  const bad: string[] = [];
  const text = new Map(EX.rulings.map((x) => [x.id, norm(`${x.heading ?? ''} \n ${x.body ?? ''}`)]));
  const verbatim = (where: string, q: Partial<Quoted> | undefined) => {
    if (!q?.quote || !q.quoteFrom) { bad.push(`${where}: no quote`); return; }
    const raq = /^RAQ (\d+#\d+)$/.exec(q.quoteFrom);
    const c = raq ? EX.raq.flatMap((t) => t.claims).find((x) => x.id === raq[1]) : null;
    const t = raq ? (c ? norm(`${c.claim} \n ${c.source}`) : undefined) : text.get(q.quoteFrom);
    if (t === undefined) bad.push(`${where}: ${q.quoteFrom} does not exist`);
    else if (!t.includes(norm(q.quote))) bad.push(`${where}: not verbatim in ${q.quoteFrom}: "${q.quote.slice(0, 80)}"`);
  };
  const SUPERSEDING = (e: Edge) => e.decision === 'accepted' && !['extends', 'cites', 'confirms', 'applies'].includes(e.relation ?? '');
  for (const e of SUP.edges) if (e.decision === 'accepted') verbatim(`edge ${e.from}>${e.to}`, e);
  for (const u of SUP.uncertain ?? []) {
    if (u.quotes.length < 2) bad.push(`uncertain ${u.from}>${u.to}: needs both sides' quotes`);
    u.quotes.forEach((q, i) => verbatim(`uncertain ${u.from}>${u.to} quotes[${i}]`, q));
  }
  const units = new Set((JSON.parse(readFileSync(CR_UNITS, 'utf8')) as { units: { id: string }[] }).units.map((u) => u.id));
  for (const [id, c] of Object.entries(CLS)) {
    const es = SUP.edges.filter((e) => e.to === id && SUPERSEDING(e));
    const want = !es.length ? ['current'] : es.some((e) => !e.scope) ? ['superseded', 'withdrawn', 'absorbed'] : ['partly-superseded', 'narrowed'];
    if (!want.includes(c.status)) bad.push(`${id}: status ${c.status}, but its accepted edges make it ${want.join('|')}`);
    for (const u of c.units) if (!units.has(u)) bad.push(`${id}: unit ${u} is not in units.json`);
    if (c.staleWarning) verbatim(`${id} staleWarning`, c.staleWarning);
    for (const k of c.uncertain ?? []) if (!(SUP.uncertain ?? []).some((u) => `${u.from}>${u.to}` === k)) bad.push(`${id}: uncertain ${k} has no row in supersession.json`);
  }
  for (const u of SUP.uncertain ?? []) if (!CLS[u.to]?.uncertain?.includes(`${u.from}>${u.to}`)) bad.push(`uncertain ${u.from}>${u.to}: ${u.to}'s classification row does not flag it`);
  // every RAQ claim and thread and every printed page has exactly one row
  const SRC = JSON.parse(readFileSync(CR_SOURCE_CLASSIFICATION, 'utf8')) as {
    raqClaims: Record<string, { units: string[] }>; raqThreads: Record<string, { open: boolean }>;
    printedPages: Record<string, { units: string[] }>; keywordReminders: { keyword: string; card: string; quote: string; source: string }[];
  };
  const same = (what: string, have: string[], want: string[]) => {
    const h = new Set(have), w = new Set(want);
    const miss = want.filter((x) => !h.has(x)), extra = have.filter((x) => !w.has(x));
    if (miss.length || extra.length) bad.push(`${what}: missing ${miss.slice(0, 5).join(', ') || '-'}; not a source ${extra.slice(0, 5).join(', ') || '-'}`);
  };
  same('raqClaims', Object.keys(SRC.raqClaims), EX.raq.flatMap((t) => t.claims.map((c) => c.id)));
  same('raqThreads', Object.keys(SRC.raqThreads), EX.raq.map((t) => String(t.threadId)));
  same('printedPages', Object.keys(SRC.printedPages), EX.printedPages.map((p) => `${p.doc} p.${p.page}`));
  for (const [k, a] of [...Object.entries(SRC.raqClaims), ...Object.entries(SRC.printedPages)]) for (const u of a.units) if (!units.has(u)) bad.push(`${k}: unit ${u} is not in units.json`);
  const cards = new Map(EX.cards.map((c) => [c.name.toLowerCase(), norm(`${c.text} \n ${c.typeLine}`)]));
  for (const k of SRC.keywordReminders) {
    if (!k.source.startsWith('cards[]')) continue; // the type-line reminders were read off the scans
    if (!cards.get(k.card.toLowerCase())?.includes(norm(k.quote))) bad.push(`keyword reminder ${k.keyword}: not verbatim on ${k.card}`);
  }
  assert.deepEqual(bad, [], `${bad.length} problem(s) in the reviewed state:\n${bad.slice(0, 30).join('\n')}`);
});

test('(6) the stale count is pinned', () => {
  const r = result();
  pinned('stale rules', r.stale.length, EXPECTED_STALE, r.stale.slice(0, 10).map((s) => `${s.where}: ${s.msg}`).join('; '));
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
      key: 'combat.damage.overview', textHash: recordHash(A), verdict: 'confirmed', round: 1, verifier: 'fixture',
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
  { name: 'two units chose one discrepancy id', code: 'duplicate-id', plant: (i) => { i.discrepancies.push(structuredClone(i.discrepancies[0]!)); } },
  { name: 'a finding id that is not F-U<nn>-<n>', code: 'schema', plant: (i) => { i.findings[0]!.id = 'F-U12'; B(i).engineDiffers = ['F-U12']; } },
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

/* ── §10 the harness: plant → judge → feedback → finalize ──────────────── */

const SPAN_FILE = 'client/engine/src/engine.ts';
const SPAN_TEXT = 'the column deals its damage as one source';
const readText = (f: string) => (f === SPAN_FILE ? `// ${SPAN_TEXT}\nmore code` : null);
const U = 'U99';
function unitRecords(): RuleRecord[] {
  const r = (key: string, text: string, extra: Partial<RuleRecord> = {}): RuleRecord => ({
    key, parent: '608', order: 1, text, examples: [], see: [],
    sources: { printed: [{ ref: 'Manual p.23', quote: 'processes happen simultaneously' }] },
    basis: 'printed', confidence: 'high', notes: 'drafter only', sourceHashes: {}, ...extra,
  });
  return [
    r('combat.one', 'Each column deals its damage as one source.', { engineDiffers: ['F-U99-1'], rebuttal: 'drafter only' } as Partial<RuleRecord>),
    r('combat.two', 'The attacking player divides an attacking column\'s damage.'),
    r('combat.three', 'Swift columns strike in the first sub-step.'),
    r('combat.four', 'Sluggish columns strike in the last sub-step.'),
    r('combat.gone', '[Removed: merged into combat.one]'),
  ];
}
const MUTANTS: Mutant[] = [
  { key: 'combat.two', mutant: 'The defending player divides an attacking column\'s damage.', why_false: 'wrong player' },
  { key: 'combat.four', mutant: 'Sluggish columns strike in the first sub-step.', why_false: 'wrong sub-step' },
];
const verdict = (key: string, v: string, problem = '', extra: Record<string, unknown> = {}) => ({
  key, verdict: v, problem, basis_ok: true, engine: [{ loc: 'engine.ts:assignColumnDamage', agrees: 'yes', note: 'n' }],
  tests_run: [{ file: 'client/engine/test/02-combat.test.ts', pattern: 'p', passed: true, asserts_claim: true }],
  probes: [], source_checks: [{ ref: 'Manual p.23', supports: 'yes', note: '' }],
  quote_spans: [{ file: SPAN_FILE, text: SPAN_TEXT }], ...extra,
});
function planted(round = 1, mutants = MUTANTS) {
  const records = unitRecords();
  return plant({ unit: U, round, records, sel: roundKeys(records, round, null), mutants });
}
/** a verifier that catches both mutants and confirms the rest */
const honest = () => ({ unit: U, round: 1, verdicts: [
  verdict('combat.one', 'confirmed'), verdict('combat.three', 'partial', 'the Swift clause is unsupported'),
  verdict('combat.two', 'contradicted', 'the attacking player divides it'), verdict('combat.four', 'contradicted', 'Sluggish strikes last'),
], bugs: [] as Record<string, unknown>[] });

test('§10 plant strips the drafter-only fields, keeps engineDiffers, substitutes the mutants and shuffles by seed', () => {
  const { input, truth } = planted();
  assert.deepEqual(input.map((r) => r.key).sort(), ['combat.four', 'combat.one', 'combat.three', 'combat.two'], 'a removed rule is never verified');
  for (const r of input) for (const k of ['notes', 'confidence', 'rebuttal', 'parent', 'order', 'sourceHashes']) assert.ok(!(k in r), `${k} reaches the verifier`);
  assert.deepEqual(input.find((r) => r.key === 'combat.one')!.engineDiffers, ['F-U99-1']);
  assert.equal(input.find((r) => r.key === 'combat.two')!.text, MUTANTS[0]!.mutant);
  assert.deepEqual(Object.keys(truth.verified).sort(), ['combat.one', 'combat.three'], 'the ground truth pins only what the verifier saw unmutated');
  const ranks = input.map((r) => shuffleRank(U, 1, r.key));
  assert.deepEqual(ranks, [...ranks].sort(), 'ordered by the seeded rank, not by key or position');
  assert.deepEqual(planted().input, input, 'deterministic');
});

test('§10 plant rejects a mutant identical to its original, outside the round, carried, doubled, unexplained or miscounted', () => {
  const records = unitRecords();
  const sel = roundKeys(records, 1, null);
  const tryPlant = (mutants: Mutant[], s = sel) => () => plant({ unit: U, round: s === sel ? 1 : 2, records, sel: s, mutants });
  assert.throws(tryPlant([{ ...MUTANTS[0]!, mutant: ' The attacking player divides  an attacking column\'s damage. ' }, MUTANTS[1]!]), /identical to the original/);
  assert.throws(tryPlant([{ ...MUTANTS[0]!, key: 'combat.nine' }, MUTANTS[1]!]), /not a live rule/);
  assert.throws(tryPlant([{ ...MUTANTS[0]!, key: 'combat.gone' }, MUTANTS[1]!]), /not a live rule/);
  assert.throws(tryPlant([MUTANTS[0]!, MUTANTS[0]!]), /mutated twice/);
  assert.throws(tryPlant([{ ...MUTANTS[0]!, why_false: '' }, MUTANTS[1]!]), /why_false is empty/);
  assert.throws(tryPlant([MUTANTS[0]!]), /2–3 mutants/);
  // round 2: changed = one, three; carried (mutated in round 1) = two; four is outside the round
  const s2 = roundKeys(records, 2, { changed: ['combat.one', 'combat.three'], unverified: ['combat.two'], hosts: [] });
  assert.deepEqual(s2, { keys: ['combat.one', 'combat.three', 'combat.two'], carried: ['combat.two'], mutable: ['combat.one', 'combat.three'] });
  assert.throws(tryPlant([{ ...MUTANTS[0]! }, { key: 'combat.one', mutant: 'x', why_false: 'y' }], s2), /carried from round 1 unverified/);
  assert.throws(tryPlant([MUTANTS[1]!, { key: 'combat.one', mutant: 'x', why_false: 'y' }], s2), /not in round 2/);
  // positive control: a host offered when fewer than three keys are left to mutate
  const s3 = roundKeys(records, 2, { changed: ['combat.one', 'combat.three'], unverified: ['combat.two'], hosts: ['combat.four', 'combat.one'] });
  assert.deepEqual(s3.mutable, ['combat.four', 'combat.one', 'combat.three']);
  const ok = plant({ unit: U, round: 2, records, sel: s3, mutants: [MUTANTS[1]!, { key: 'combat.one', mutant: 'Each column deals its damage as two sources.', why_false: 'one source' }] });
  assert.deepEqual(ok.truth.hosts, ['combat.four']);
  assert.deepEqual(ok.truth.keys, ['combat.four', 'combat.one', 'combat.three', 'combat.two']);
});

test('§10 judge: every mutant caught is a valid batch; one confirmed, or caught with no problem text, invalidates it', () => {
  const { input, truth } = planted();
  const good = judge({ truth, input, doc: honest(), readText });
  assert.equal(good.batchValid, true);
  assert.deepEqual([good.mutants, good.caught, good.missed], [2, 2, []]);
  assert.deepEqual(good.nonConfirmed, ['combat.three'], 'mutants are excluded from nonConfirmed');
  assert.deepEqual(good.counts, { confirmed: 1, partial: 1 }, 'and from the counts');
  const fooled = honest();
  fooled.verdicts[3] = verdict('combat.four', 'confirmed', 'wording could be tighter'); // a problem note does not make a confirmation a catch
  const bad = judge({ truth, input, doc: fooled, readText });
  assert.equal(bad.batchValid, false, 'a confirmed mutant must discard the batch');
  assert.deepEqual(bad.missed, ['combat.four']);
  const terse = honest();
  terse.verdicts[2] = verdict('combat.two', 'contradicted', '  ');
  assert.equal(judge({ truth, input, doc: terse, readText }).batchValid, false, 'caught needs the problem named');
  const skipped = honest();
  skipped.verdicts = skipped.verdicts.filter((v) => v.key !== 'combat.two');
  assert.equal(judge({ truth, input, doc: skipped, readText }).batchValid, false, 'a mutant with no verdict is missed');
});

test('§10 judge runs the quote-span checker: a span not in its file, too long or multi-line is flagged', () => {
  const { input, truth } = planted();
  const doc = honest();
  doc.verdicts[0]!.quote_spans = [{ file: SPAN_FILE, text: 'the column deals its damage twice' }, { file: SPAN_FILE, text: SPAN_TEXT }];
  doc.verdicts[1]!.quote_spans = [{ file: 'no/such/file.ts', text: 'x' }, { file: SPAN_FILE, text: `a\n${SPAN_TEXT}` }, { file: SPAN_FILE, text: 'y'.repeat(201) }];
  const j = judge({ truth, input, doc, readText });
  assert.deepEqual(j.badSpans.map((b) => `${b.key} ${b.why}`), [
    'combat.one not verbatim in the file', 'combat.three no such file', 'combat.three spans more than one line', 'combat.three longer than 200 chars',
  ]);
  assert.deepEqual(badSpans([{ file: SPAN_FILE, text: `  the column  deals its\tdamage as one source ` }], readText), [], 'whitespace-normalised, the positive control');
});

test('§10 feedback leaves the mutants out (verdicts and bugs), keeps what the reviser needs, and refuses an invalid batch', () => {
  const { input, truth } = planted();
  const doc = honest();
  doc.verdicts[0] = verdict('combat.one', 'confirmed', '', { source_checks: [{ ref: 'Manual p.23', supports: 'partly', note: 'on-topic only' }] });
  doc.bugs = [
    { title: 'Swift ignored', summary: 's', evidence: [{ file: SPAN_FILE, quote: SPAN_TEXT }], rule: 'combat.three' },
    { title: 'Mutant-driven', summary: 's', evidence: [], rule: 'combat.two' },
  ];
  const fb = buildFeedback({ truth, input, doc, judged: judge({ truth, input, doc, readText }) });
  assert.deepEqual(fb.items.map((x) => x.key), ['combat.one', 'combat.three'], 'a confirmed rule with a partly source check is fed back; no mutant is');
  assert.equal(fb.items[0].source_checks_not_yes.length, 1);
  assert.ok(fb.items[1].engine.length && fb.items[1].quote_spans.length, 'engine notes and quote spans travel');
  assert.deepEqual(fb.bugs.map((b) => b.title), ['Swift ignored']);
  assert.ok(!JSON.stringify(fb).includes('combat.two') && !JSON.stringify(fb).includes('combat.four'), 'nothing names a mutated key');
  const fooled = honest();
  fooled.verdicts[2] = verdict('combat.two', 'confirmed');
  assert.throws(() => buildFeedback({ truth, input, doc: fooled, judged: judge({ truth, input, doc: fooled, readText }) }), /not valid/);
});

test('§10 finalize takes each key from the latest VALID round, never a mutant, and marks the untested and the stale', () => {
  const records = unitRecords();
  const r1 = planted();
  // round 2 re-verifies one, three and the carried two; four hosts a mutant, so its round-1 verdict… does not exist (it was mutated in round 1)
  const s2 = roundKeys(records, 2, { changed: ['combat.one', 'combat.three'], unverified: ['combat.two', 'combat.four'], hosts: [] });
  const r2 = plant({ unit: U, round: 2, records, sel: s2, mutants: [
    { key: 'combat.one', mutant: 'Each column deals its damage as two sources.', why_false: 'one source' },
    { key: 'combat.three', mutant: 'Swift columns strike in the last sub-step.', why_false: 'first' },
  ] });
  const r2fooled = { verdicts: [verdict('combat.one', 'confirmed'), verdict('combat.three', 'contradicted', 'first'), verdict('combat.two', 'unsupported', 'no source'), verdict('combat.four', 'unsupported', 'no source')] };
  const r2good = { verdicts: [
    verdict('combat.one', 'contradicted', 'one source'), verdict('combat.three', 'contradicted', 'first'),
    verdict('combat.two', 'confirmed', '', { tests_run: [{ file: 'x.test.ts', passed: true, asserts_claim: 'partly - on-topic' }] }),
    verdict('combat.four', 'confirmed', '', { tests_run: [], probes: [{ file: 'p.test.ts', title: 'cr:combat.four', passed: true, demonstrates: 'yes' }] }),
  ], bugs: [{ title: 'swift IGNORED', summary: 'dup by title', evidence: [], rule: 'combat.three' }, { title: 'Sluggish late', summary: 's', evidence: [{ file: `/abs/elsewhere/${SPAN_FILE}`, quote: 'q' }], rule: 'combat.four' }] };
  const r1doc = honest();
  r1doc.bugs = [{ title: 'Swift ignored', summary: 's', evidence: [{ file: SPAN_FILE, quote: SPAN_TEXT }], rule: 'combat.three' }];
  const rounds: RoundFiles[] = [
    { round: 1, truth: r1.truth, input: r1.input, attempts: [{ attempt: 1, doc: r1doc }] },
    { round: 2, truth: r2.truth, input: r2.input, attempts: [{ attempt: 1, doc: r2fooled }, { attempt: 2, doc: r2good }] },
  ];
  const current = unitRecords();
  current.find((r) => r.key === 'combat.three')!.text = 'Swift columns strike first.'; // revised after its last verification
  const res = finalize({ unit: U, records: current, rounds, findings: [{ id: 'F-U99-1', title: 'Drafter finding', summary: 's', evidence: [{ file: SPAN_FILE, quote: SPAN_TEXT }], rule: 'combat.one' }], readText, exists: (p) => p === SPAN_FILE });
  const by = new Map(res.verdicts.map((v) => [v.key, v]));
  assert.deepEqual([...by.keys()], ['combat.four', 'combat.one', 'combat.three', 'combat.two']);
  assert.equal(by.get('combat.one')!.round, 1, 'mutated in round 2, so round 1 stands');
  assert.equal(by.get('combat.three')!.round, 1, 'mutated in round 2, so round 1 stands');
  assert.deepEqual([by.get('combat.two')!.round, by.get('combat.two')!.verifier], [2, 'U99-r2-a2'], 'round 2, from the valid second attempt — never the fooled first');
  assert.equal(by.get('combat.two')!.verdict, 'confirmed');
  assert.equal(by.get('combat.one')!.textHash, recordHash(current[0]!), 'an unchanged record is pinned by its current hash');
  assert.deepEqual(res.report.stale, ['combat.three'], 'a record revised after its verdict is stale, pinned to the text verified');
  assert.notEqual(by.get('combat.three')!.textHash, recordHash(current.find((r) => r.key === 'combat.three')!));
  assert.deepEqual(res.report.untested, ['combat.two'], 'a passing test that does not assert the claim demonstrates nothing; a demonstrating probe does');
  assert.equal(res.records.find((r) => r.key === 'combat.gone')!.untested, undefined, 'a removed rule is left alone');
  assert.deepEqual(res.findings.map((f) => f.id), ['F-U99-1', 'F-U99-2', 'F-U99-3'], 'bugs dedup by title, numbered after the drafter');
  assert.deepEqual(res.findings.slice(1).map((f) => f.title), ['Swift ignored', 'Sluggish late']);
  assert.deepEqual(res.report.invalidRounds, []);
  // round 2 with only the fooled attempt: nothing from round 2 is used
  const only1 = finalize({ unit: U, records: current, rounds: [rounds[0]!, { ...rounds[1]!, attempts: [rounds[1]!.attempts[0]!] }], readText });
  assert.deepEqual(only1.report.invalidRounds, [2]);
  assert.ok(only1.verdicts.every((v) => v.round === 1));
  assert.deepEqual(only1.report.unverified, ['combat.four', 'combat.two'], 'mutated in round 1 and never validly verified since');
});

test('§10 a promoted CR example keeps the verdict; any other example change unverifies it', () => {
  const ver = { text: 'Swift columns strike first.', examples: [{ text: 'A Swift column strikes.', test: null }] };
  const rec = (examples: RuleRecord['examples']): RuleRecord => ({ key: 'k', parent: '608', order: 1, text: ver.text, examples, see: [], sources: {}, basis: 'printed', confidence: 'high', sourceHashes: {} });
  assert.ok(sameAsVerified(rec(ver.examples), ver));
  assert.ok(sameAsVerified(rec([{ text: 'A Swift column strikes.', test: '423-cr-combat-damage.test.ts::cr:k shows it' }]), ver), 'rebound to the promoted test');
  assert.ok(sameAsVerified(rec([...ver.examples, { text: 'New.', test: '423-cr-combat-damage.test.ts::cr:k new' }]), ver), 'a promoted example added');
  assert.ok(!sameAsVerified(rec([{ text: 'A Swift column strikes.', test: '02-combat.test.ts::other' }]), ver), 'rebound elsewhere');
  assert.ok(!sameAsVerified(rec([{ text: 'A Sluggish column strikes.', test: null }]), ver), 'example text changed');
});

test('§10 stamp fills the hashes of the cited current rulings and quoted claims, keeps what is there, drops the uncited', () => {
  const x = fixtureExtract();
  const r: RuleRecord = { ...structuredClone(fixtureInputs().records[0]!), sourceHashes: { [R(1)]: 'as drafted', [R(3)]: 'no longer cited' } };
  r.sources.rulings = [R(1), `${R(4)} its first sentence`];
  r.sources.designer = [{ ref: 'RAQ 111#0', quote: 'q' }];
  const out = stamp([r], x);
  assert.deepEqual(out.records[0]!.sourceHashes, { [R(1)]: 'as drafted', [R(4)]: 'h4', 'RAQ 111#0': 'c0' });
  assert.deepEqual([out.filled, out.dropped], [2, 1]);
  assert.deepEqual(stamp([r], x, { refresh: true }).records[0]!.sourceHashes[R(1)], 'h1');
});

test('§10 an untested rule is marked in all three editions; unit-scoped finding ids validate', () => {
  const i = fixtureInputs();
  A(i).untested = true;
  const out = render(i, fixtureExtract());
  assert.match(out.files.doc, /\(Untested: no executed test demonstrates it\.\)/);
  assert.match(out.files.txt, /\(Untested: no executed test demonstrates it\.\)/);
  assert.match(out.files.html, /class="chip v-untested">Untested</);
  assert.deepEqual(validateFinding({ id: 'F-U12-3', title: 't', summary: 's', evidence: [{ file: 'f', quote: 'q' }], rule: 'r' }), []);
});
