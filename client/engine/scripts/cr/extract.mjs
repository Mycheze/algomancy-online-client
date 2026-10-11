/* THE EXTRACT STEP of the comprehensive-rules export: every source the
 * drafter and the checker read, in one deterministic JSON.
 *
 *   node engine/scripts/cr/extract.mjs        (npm run cr:extract, from client/)
 *     → data/comprehensive-rules/build/extract.json   (gitignored)
 *
 * `extract()` is the same thing in-process — pure, no network, no pdftotext —
 * so the gate never needs the build directory. The shape is the `Extract`
 * interface in extract.d.mts.
 *
 * WHERE EACH PART COMES FROM, AND HOW (derive, never enumerate: a data
 * structure that exists as a module is IMPORTED, never regexed out of source):
 *   raq            imported: ledgers/raq.ts `RAQ`
 *   glossary       imported: ui/glossary.ts `GLOSSARY` (the rows a player sees;
 *                  authority `ours`, never a source of law)
 *   cards          printed.json — the PRINTED pool. The registry holds more
 *                  names than printed.json (synthetic tokens; and apply.ts
 *                  registers one more on import), none of them printed cards.
 *   printedPages   the committed CR_PRINTED_PAGES (extract-printed-pages.mjs)
 *   enums          imported: types.ts arrays, apply.ts ALL_ELEMENTS,
 *                  extract-printed.mjs ATTRS (the Attr union's order);
 *                  card kinds and timings are the values printed.json uses
 *   tests          a real JS tokenizer (extract-test-titles.mjs), escapes undone
 *   engineSymbols  ⚠ WEAK: a line-level scan of client/engine/src (symbolsIn)
 *                  for declared function / const / let names, class and
 *                  object-literal methods (multi-line parameter lists too) and
 *                  fields holding a function. It can say a name exists; it
 *                  cannot say what the name does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CR_BUILD_DIR, CR_PRINTED_PAGES, ENGINE_SRC_DIR, ENGINE_TEST_DIR, ORACLE_JSON, REPO_ROOT,
  SERVER_E2E_DIR, SERVER_TEST_DIR, UI_TEST_DIR,
} from '../paths.mjs';
import { ATTRS, OUT as PRINTED_JSON } from '../extract-printed.mjs';
import { testTitlesOf } from './extract-test-titles.mjs';
import { BATTLE_STEPS, DAMAGE_SUBSTEPS, DECISION_KINDS, PHASES, ZONES } from '../../src/types.ts';
import { ALL_ELEMENTS } from '../../src/apply.ts';
import { RAQ } from '../../../ledgers/raq.ts';
import { GLOSSARY } from '../../../ui/glossary.ts';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const uniqSorted = xs => [...new Set(xs)].sort();


/* ── THE REST ────────────────────────────────────────────────────────────── */

function raqThreads() {
  return RAQ.map(e => ({
    threadId: e.id, title: e.title, status: e.status, note: e.note ?? null,
    claims: (e.claims ?? []).map((c, i) => ({
      id: `${e.id}#${i}`, claim: c.claim, source: c.source, status: c.status,
      guards: c.guards ?? [], ticket: c.ticket ?? null, note: c.note ?? null,
      textHash: sha256(JSON.stringify([c.claim, c.source])),
    })),
  }));
}

/** a GlossEntry as data: a RegExp is kept as its `/source/flags` text */
const glossaryRows = () => GLOSSARY.map(e => JSON.parse(JSON.stringify(e, (_k, v) => (v instanceof RegExp ? String(v) : v))));

function printedCards() {
  const pool = JSON.parse(readFileSync(PRINTED_JSON, 'utf8'));
  return Object.values(pool)
    .map(c => ({ name: c.name, kind: c.kind, timing: c.timing, attrs: c.attrs ?? [], typeLine: c.type, text: c.text }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The printed BACKS of the oracle's two-sided cards that carry rules text —
 * the Dormant Resource face every resource shows until it is activated
 * ("Dormant resources provide no affinity or mana."), the Generic Unit token
 * card, the stack tracker. The engine's pool (printed.json) has fronts only,
 * so without these a rule could not quote the one place print states the
 * dormant rule. Kept apart from `cards`: a back has no kind or timing, and a
 * back that shares a front's name (Fireball) never shadows the front
 * (check.mjs indexExtract).
 */
function cardBacks() {
  // the oracle maps each name to an ARRAY of its printings
  const rows = Object.values(JSON.parse(readFileSync(ORACLE_JSON, 'utf8'))).flat();
  return rows.filter(c => c && c.Side === 'Back' && String(c.text ?? '').trim())
    .map(c => ({ name: c.name, typeLine: c.type, text: c.text }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function printedPages() {
  const src = JSON.parse(readFileSync(CR_PRINTED_PAGES, 'utf8'));
  return src.pages.map(p => ({ doc: p.doc, page: p.page, text: p.text }));
}

function enums(cards) {
  return {
    phases: [...PHASES], battleSteps: [...BATTLE_STEPS], damageSubSteps: [...DAMAGE_SUBSTEPS],
    decisionKinds: [...DECISION_KINDS], zones: [...ZONES], attrs: [...ATTRS], elements: [...ALL_ELEMENTS],
    cardKinds: uniqSorted(cards.map(c => c.kind)), timings: uniqSorted(cards.map(c => c.timing)),
  };
}

const TEST_DIRS = [
  [ENGINE_TEST_DIR, 'engine'], [UI_TEST_DIR, 'ui'], [SERVER_TEST_DIR, 'server'], [SERVER_E2E_DIR, 'server'],
];

function listFiles(dir, re) {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    if (e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, re));
    else if (re.test(e)) out.push(p);
  }
  return out;
}

const repoRel = p => relative(REPO_ROOT, p).split('\\').join('/');

function testIndex() {
  const out = [];
  for (const [d, dir] of TEST_DIRS) {
    for (const f of listFiles(d, /\.(ts|mts|mjs|js)$/)) {
      const found = testTitlesOf(readFileSync(f, 'utf8'));
      if (!found.length) continue;
      const row = { file: repoRel(f), dir, titles: found.map(t => t.title) };
      const partial = found.filter(t => t.partial).map(t => t.title);
      if (partial.length) row.partialTitles = partial;
      out.push(row);
    }
  }
  return out;
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'with', 'super',
  'constructor', 'else', 'do', 'new', 'typeof', 'await', 'yield', 'throw', 'delete', 'void', 'in', 'of']);

/* A member's modifiers, a member's name, and the heads that declare a name. */
const MODS = '(?:(?:public|private|protected|static|readonly|async|override|abstract|declare|get|set)\\s+)*';
const NAME = '([A-Za-z_$][\\w$]*)';
const FN_DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const CLASS_DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const VAR_DECL = /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/;
/** `  [mods] name[?]<T>(` — a class or object-literal method's head; its params may run over lines */
const METHOD_HEAD = new RegExp(`^\\s+${MODS}\\*?\\s*${NAME}\\s*\\??\\s*(?:<[^()]*?>)?\\s*\\(`);
/** `  [mods] name[?!][: T] = (…) =>` / `= function` / `= x =>` — a field holding a function */
const FN_FIELD = new RegExp(`^\\s+${MODS}${NAME}\\s*[?!]?\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*(?::[^=]+)?=>|[A-Za-z_$][\\w$]*\\s*=>)`);
/** `  [static] name[: T] =` — a static field */
const STATIC_FIELD = new RegExp(`^\\s+(?:(?:public|private|protected)\\s+)?static\\s+(?:readonly\\s+)?${NAME}\\s*[:=]`);
/** `  name: (…) =>` / `name: function` / `name: async x =>` — an object-literal property holding a function */
const FN_PROP = new RegExp(`^\\s+${NAME}\\s*:\\s*(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*(?::[^=]+)?=>|[A-Za-z_$][\\w$]*\\s*=>)`);

/**
 * A method head's parameter list may run over several lines, and may hold
 * `;` (`hits: { target: T; n: number }[]`) or nested parens. Balance the
 * parens from the head's `(` across lines; it is a declaration when what
 * follows the closing `)` on its line is an optional return type and a `{`
 * (a body), or a return type and a `;` (an overload or interface signature;
 * a bare `;` is a call statement) — never `=>`, a call taking a callback.
 */
function methodAt(lines, i, open) {
  let depth = 0;
  for (let j = i; j < Math.min(lines.length, i + 60); j++) {
    const line = lines[j];
    let quote = null;
    for (let k = j === i ? open : 0; k < line.length; k++) {
      const c = line[k];
      if (quote) { if (c === '\\') k++; else if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) {
        const rest = line.slice(k + 1);
        return !rest.includes('=>') && (/^\s*(?::.*)?\{\s*$/.test(rest) || /^\s*:.*;\s*$/.test(rest));
      }
    }
  }
  return false;
}

/**
 * The names a TypeScript source declares, read line by line: functions,
 * classes, const/let/var, class and object-literal methods (any modifiers, with the
 * parameter list on one line or many), fields and properties that hold a
 * function, and static fields. Data fields are not symbols. ⚠ WEAK — a name
 * exists; it cannot say what the name does.
 */
export function symbolsIn(text) {
  const names = new Set();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = FN_DECL.exec(line) ?? CLASS_DECL.exec(line) ?? VAR_DECL.exec(line);
    if (!m && (m = METHOD_HEAD.exec(line)) && !methodAt(lines, i, m[0].length - 1)) m = null;
    m ??= FN_FIELD.exec(line) ?? STATIC_FIELD.exec(line) ?? FN_PROP.exec(line);
    if (m && !KEYWORDS.has(m[1])) names.add(m[1]);
  }
  return names;
}

function engineSymbols() {
  const names = new Set();
  for (const f of listFiles(ENGINE_SRC_DIR, /\.ts$/)) for (const n of symbolsIn(readFileSync(f, 'utf8'))) names.add(n);
  return [...names].sort();
}

/** the whole extract, in-process and deterministic */
export function extract() {
  const cards = printedCards();
  return {
    raq: raqThreads(),
    glossary: glossaryRows(),
    cards,
    cardBacks: cardBacks(),
    printedPages: printedPages(),
    enums: enums(cards),
    tests: testIndex(),
    engineSymbols: engineSymbols(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const x = extract();
  const ms = Math.round(performance.now() - t0);
  mkdirSync(CR_BUILD_DIR, { recursive: true });
  const file = join(CR_BUILD_DIR, 'extract.json');
  const json = JSON.stringify(x, null, 1) + '\n';
  writeFileSync(file, json);
  console.log(`Wrote ${repoRel(file)} (${(json.length / 1024).toFixed(0)} KiB) in ${ms} ms: `
    + `${x.raq.length} RAQ threads / ${x.raq.reduce((a, t) => a + t.claims.length, 0)} claims, `
    + `${x.glossary.length} glossary rows, ${x.cards.length} printed cards, ${x.printedPages.length} printed pages, `
    + `${x.tests.reduce((a, t) => a + t.titles.length, 0)} test titles in ${x.tests.length} files, `
    + `${x.engineSymbols.length} engine symbols`);
}
