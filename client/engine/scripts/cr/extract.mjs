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
 *   rulings        parsed from DIGITAL_RULES, line by line (`## R<n>` / `## R<n>b`)
 *   supersession   CANDIDATE edges proposed off heading marks, banners and body
 *                  verbs. Recall over precision: the register stage decides them.
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
  CR_BUILD_DIR, CR_PRINTED_PAGES, DIGITAL_RULES, ENGINE_SRC_DIR, ENGINE_TEST_DIR, REPO_ROOT,
  SERVER_E2E_DIR, SERVER_TEST_DIR, UI_TEST_DIR,
} from '../paths.mjs';
import { ATTRS, OUT as PRINTED_JSON } from '../extract-printed.mjs';
import { testTitlesOf } from './extract-test-titles.mjs';
import { BATTLE_STEPS, DAMAGE_SUBSTEPS, DECISION_KINDS, PHASES, ZONES } from '../../src/types.ts';
import { ALL_ELEMENTS } from '../../src/apply.ts';
import { RAQ } from '../../../ledgers/raq.ts';
import { GLOSSARY } from '../../../ui/glossary.ts';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const byNum = (a, b) => a.n - b.n || a.suffix.localeCompare(b.suffix);
const uniqSorted = xs => [...new Set(xs)].sort();

/* ── RULINGS ─────────────────────────────────────────────────────────────── */

const GLYPHS = ['⚠', '❌', '✅'];

/**
 * `## R<digits>` with an optional `b`, then a non-word character or the end
 * of the line. Read character by character — test 411 counts the headings
 * with grep, a different mechanism, and the two must agree.
 */
function rulingHeading(line) {
  if (!line.startsWith('## R')) return null;
  let k = 4;
  while (k < line.length && line[k] >= '0' && line[k] <= '9') k++;
  if (k === 4) return null;
  const n = Number(line.slice(4, k));
  let suffix = '';
  if (line[k] === 'b') { suffix = 'b'; k++; }
  const next = line[k];
  if (next !== undefined && /\w/.test(next)) return null;
  return { n, suffix, rest: line.slice(k) };
}

/** a markdown link `[text](target)` → `text`, so an anchor like
 *  `#r301--…-r42-said-otherwise` is never read as a citation */
const unlink = s => s.replace(/\]\([^)\s]*\)/g, ']');

/** every `R<n>` / `R<n>b` cited in a text, as ids */
function refsIn(text) {
  return [...unlink(text).matchAll(/\bR(\d{1,3})(b?)(?![\w])/g)].map(m => `R${Number(m[1])}${m[2]}`);
}

const MANUAL_REF = /\b(?:Manual|Rulebook)\b(?:'s [^()\n]{0,30}\(| Q&A)? ?pp?\.\s?\d+(?:\s?[-–]\s?\d+)?/g;

/**
 * `[Solved] <title>` mentions in a body, resolved against the RAQ register's
 * own titles (imported). The doc wraps and truncates titles, so a mention
 * matches a thread when the text after the tag starts with the first 16
 * characters of the thread's title (tag removed, whitespace and quotes
 * normalised). A tagged mention that matches no thread is kept with
 * `threadId: null`.
 */
function raqTitleRefsIn(body, threads) {
  const norm = s => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ');
  const text = norm(unlink(body));
  const out = [];
  for (const m of text.matchAll(/\[(solved|asked|considered|todo)[^\]]{0,20}\]\s*([^\n]{0,60})/g)) {
    const after = m[2];
    const hits = threads.filter(t => t.key && after.startsWith(t.key));
    const mention = m[0].slice(0, 80).trim();
    if (hits.length) for (const h of hits) out.push({ text: mention, threadId: h.id });
    else out.push({ text: mention, threadId: null });
  }
  const seen = new Set();
  return out.filter(r => { const k = `${r.text}|${r.threadId}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.text.localeCompare(b.text) || String(a.threadId).localeCompare(String(b.threadId)));
}

export function parseRulings(md = readFileSync(DIGITAL_RULES, 'utf8')) {
  const lines = md.split('\n');
  const heads = [];
  lines.forEach((line, idx) => {
    const h = rulingHeading(line);
    if (h) heads.push({ ...h, idx });
    else if (line.startsWith('## ')) heads.push({ other: true, idx });
  });
  const threads = RAQ.map(e => ({
    id: e.id,
    key: e.title.replace(/^(\s*\[[^\]]*\])+\s*/, '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ').slice(0, 16),
  })).filter(t => /^\[/.test(RAQ.find(e => e.id === t.id).title) && t.key.length >= 8);
  const rulings = [];
  heads.forEach((h, k) => {
    if (h.other) return;
    const end = k + 1 < heads.length ? heads[k + 1].idx : lines.length;
    const bodyLines = lines.slice(h.idx + 1, end);
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    const body = bodyLines.join('\n');
    const id = `R${h.n}${h.suffix}`;
    let title = h.rest.replace(/^[\s⚠❌✅—–:-]+/u, '').trim();
    if (!title) {
      const sub = bodyLines.find(l => l.startsWith('### '));
      title = sub ? sub.slice(4).trim() : '';
    }
    const heading = lines[h.idx];
    const all = heading + '\n' + body;
    rulings.push({
      n: h.n, suffix: h.suffix, id, title,
      glyphs: GLYPHS.filter(g => h.rest.includes(g)).join(''),
      heading, line: h.idx + 1, body, bodyHash: sha256(body),
      dates: uniqSorted(all.match(/\b20\d\d-\d\d-\d\d\b/g) ?? []),
      testsCited: uniqSorted(all.match(/\b\d{1,3}-[A-Za-z0-9-]+\.test\.ts\b/g) ?? [])
        .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)),
      rulingsCited: [...new Set(refsIn(all))].filter(r => r !== id)
        .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)) || a.localeCompare(b)),
      manualRefs: uniqSorted((unlink(all).match(MANUAL_REF) ?? []).map(s => s.replace(/\s+/g, ' '))),
      raqTitleRefs: raqTitleRefsIn(body, threads),
    });
  });
  return rulings.sort(byNum);
}

/* ── SUPERSESSION CANDIDATES ────────────────────────────────────────────────
 *
 * Three places a relation is written:
 *   heading  the `## R<n>` line's own marks: "(reversed by R319)",
 *            "WITHDRAWN … superseded by R115", "(R60 reversed)", "(narrows R110)"
 *   banner   a paragraph set apart to announce it: the body's first paragraph,
 *            a `>` quote, a paragraph led by ⚠/❌/✅, or one led by a bold verb
 *   body     everything else, plus a `### What this amends` style section
 *            whose bullets/paragraphs LEAD with the rulings it changes
 *
 * Direction ("from" supersedes "to"):
 *   active   "R310 reverses R235", "this narrows R110"        → from subject (or host), to object
 *   passive  "reversed by R319", "absorbed into R115"         → from agent, to the left ref (or host)
 *   postfix  "(R60 reversed)", "[R3] stands, narrowed"         → from host, to the left ref
 *   active past with an object: "R305 overturned that carve-out" → from R305
 *   refuted  "R42 said otherwise", "R42 is just false"         → from host, to R42
 *   "R106 is the operative one"                                → from R106, to host
 *   a mark with no agent ("WITHDRAWN", "⚠ SUPERSEDED on one point") takes the
 *   other rulings named in the same heading or paragraph as its "from".
 * These are CANDIDATES. Citations that only look like relations get through;
 * the register stage rejects them. */

const ACTIVE = ['reverses', 'supersedes', 'narrows', 'amends', 'overturns', 'withdraws', 'corrects',
  'replaces', 'extends', 'retires', 'takes back'];
const PASSIVE = ['reversed', 'superseded', 'narrowed', 'amended', 'overturned', 'withdrawn', 'corrected',
  'replaced', 'extended', 'retired', 'absorbed'];
const REFUTED = ['said otherwise', 'is just false', 'is false', 'was false', 'is wrong', 'was wrong',
  'no longer holds', 'no longer stands'];
const OPERATIVE = 'is the operative one';
const VERB_RE = new RegExp(`\\b(${[...ACTIVE, ...PASSIVE, ...REFUTED, OPERATIVE].join('|')})\\b`, 'gi');
const REF_RE = /\bR(\d{1,3})(b?)(?![\w])/g;
const MARK_RE = /\b(withdrawn|retired|absorbed|superseded)\b/i;

/** strip what hides words from the verb scan: links, emphasis, backticks */
const clean = s => unlink(s).replace(/\[(R\d{1,3}b?)\]/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

/** sentence-ish clauses: split at . ; ! ? followed by space (not "e.g." / "vs.") */
const clausesOf = s => s.split(/(?<!\b(?:e\.g|i\.e|vs|cf|etc|p|pp))[.;!?](?=\s|$)/).map(c => c.trim()).filter(Boolean);

const refsWithPos = s => [...s.matchAll(REF_RE)].map(m => ({ id: `R${Number(m[1])}${m[2]}`, s: m.index, e: m.index + m[0].length }));

/** "R3/R31", "R3, R31 and R42": the refs chained onto the first one */
function chainFrom(clause, ref, all) {
  const out = [ref.id];
  let cur = ref;
  for (const r of all) {
    if (r.s <= cur.s) continue;
    if (/^\s*(?:§\s?\d+[a-z]?\s*)?(?:\/|,|&|and|or)\s*$/.test(clause.slice(cur.e, r.s))) { out.push(r.id); cur = r; } else break;
  }
  return out;
}

function edgesInText(text, host, where, otherRefsForMarks) {
  const out = [];
  const add = (from, to, verb, ctx) => out.push({ from, to, verb: verb.toLowerCase(), where, ctx: ctx.slice(0, 240) });
  for (const clause of clausesOf(clean(text))) {
    const refs = refsWithPos(clause);
    for (const vm of clause.matchAll(VERB_RE)) {
      const verb = vm[1].toLowerCase();
      const vs = vm.index;
      const ve = vs + vm[0].length;
      const left = refs.filter(r => r.e <= vs).at(-1);
      const leftGap = left ? clause.slice(left.e, vs) : null;
      const closeLeft = left && leftGap.length <= 25 && !leftGap.includes(',') ? left : null;
      const after = clause.slice(ve);
      const right = refs.find(r => r.s >= ve && r.s - ve <= 60);
      if (verb === OPERATIVE) { if (closeLeft) add(closeLeft.id, host, verb, clause); continue; }
      if (REFUTED.includes(verb)) {
        if (left && clause.slice(left.e, vs).length <= 40) add(host, left.id, verb, clause);
        continue;
      }
      if (ACTIVE.includes(verb)) {
        const subject = closeLeft ? closeLeft.id : host;
        if (right) for (const to of chainFrom(clause, right, refs)) add(subject, to, verb, clause);
        else if (closeLeft && /^\s*(?:it|this ruling|this|them)\b/i.test(after)) add(subject, host, verb, clause);
        continue;
      }
      // a past-tense form: passive with an agent, passive postfix, or active past
      if (verb === 'absorbed' && !/^\s*into\b/i.test(after)) continue;
      const agent = /^\s*(?:[^.;R]{0,30}?\s)?(?:by|into|—|–)\s*R(\d{1,3})(b?)(?![\w])/i.exec(after);
      if (agent) {
        const from = `R${Number(agent[1])}${agent[2]}`;
        const to = left && vs - left.e <= 160 ? left.id : host;
        add(from, to, verb, clause);
        continue;
      }
      if (closeLeft && /^\s*(?:that|the|this|its|their|an?|it|R\d+)\b/i.test(after)) {
        // "R305 overturned that carve-out": R305 did it; the object is another ref here, if any
        const others = refs.filter(r => r !== closeLeft).map(r => r.id);
        const to = right ? right.id : others.at(-1) ?? null;
        if (to) add(closeLeft.id, to, verb, clause);
        continue;
      }
      if (left && vs - left.e <= 160) { add(host, left.id, verb, clause); continue; }
      // a bare mark: only where marks are written (a heading, a banner) or in capitals
      // ("⚠ SUPERSEDED on one point") — in running prose it is talk ABOUT supersession
      if (MARK_RE.test(verb) && (where !== 'body' || vm[1] === vm[1].toUpperCase())) {
        for (const from of otherRefsForMarks) add(from, host, verb, clause);
      }
    }
  }
  return out;
}

const BANNER_LEAD = /^\s*(?:>|⚠|❌|✅|\*\*\s*(?:reverse|supersede|narrow|amend|overturn|withdraw|correct|replace|retire|implemented))/i;
const SECTION_VERB = /\b(amends|amended|supersed\w*|revers\w*|narrow\w*|overturn\w*|replac\w*|correct\w*|withdraw\w*)\b/i;

function candidatesOf(r) {
  const out = [];
  const headText = r.heading.replace(/^## R\d+b?/, '');
  const headOthers = refsIn(headText).filter(x => x !== r.id);
  out.push(...edgesInText(headText, r.id, 'heading', headOthers));
  // paragraphs, each remembering the `###` section it sits in
  let section = '';
  let first = true;
  const paras = [];
  let buf = [];
  const flush = () => { if (buf.length) paras.push({ text: buf.join('\n'), section }); buf = []; };
  for (const line of r.body.split('\n')) {
    // a `###` line is a section name AND can carry a mark ("— ⚠ REVERSED BY R306")
    if (line.startsWith('### ')) { flush(); section = line.slice(4); paras.push({ text: section, section, mark: true }); continue; }
    if (!line.trim() || /^\s*[-*] /.test(line)) flush();
    if (line.trim()) buf.push(line);
  }
  flush();
  for (const p of paras) {
    const where = first || p.mark || BANNER_LEAD.test(p.text) ? 'banner' : 'body';
    if (!p.mark) first = false;
    const others = refsIn(p.text).filter(x => x !== r.id);
    out.push(...edgesInText(p.text, r.id, where, others));
    // "### What this amends" — the paragraph LEADS with the rulings it changes
    const sv = SECTION_VERB.exec(p.section);
    if (sv && !p.mark && !refsIn(p.section).length) {
      const lead = /^\s*(?:[-*]\s+)?\*\*([^*]{0,80})\*\*/.exec(p.text)?.[1] ?? /^\s*(?:[-*]\s+)?((?:\[?R\d{1,3}b?\]?[\s/,&§\d]*)+)/.exec(p.text)?.[1] ?? '';
      for (const to of refsIn(lead).filter(x => x !== r.id)) {
        out.push({ from: r.id, to, verb: sv[1].toLowerCase(), where: 'body', ctx: clean(`${p.section}: ${p.text}`).slice(0, 240) });
      }
    }
  }
  return out.filter(e => e.from !== e.to);
}

export function supersessionCandidates(rulings) {
  const ids = new Set(rulings.map(r => r.id));
  const seen = new Set();
  const out = [];
  for (const r of rulings) {
    for (const e of candidatesOf(r)) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      const key = `${e.from}|${e.to}|${e.verb}|${e.where}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...e, host: r.id });
    }
  }
  const num = id => parseInt(id.slice(1));
  return out.sort((a, b) => num(a.to) - num(b.to) || a.to.localeCompare(b.to) || num(a.from) - num(b.from)
    || a.from.localeCompare(b.from) || a.where.localeCompare(b.where) || a.verb.localeCompare(b.verb)
    || a.host.localeCompare(b.host));
}

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
  const rulings = parseRulings();
  const cards = printedCards();
  return {
    rulings,
    supersessionCandidates: supersessionCandidates(rulings),
    raq: raqThreads(),
    glossary: glossaryRows(),
    cards,
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
  const where = {};
  for (const e of x.supersessionCandidates) where[e.where] = (where[e.where] ?? 0) + 1;
  console.log(`Wrote ${repoRel(file)} (${(json.length / 1024).toFixed(0)} KiB) in ${ms} ms: `
    + `${x.rulings.length} rulings, ${x.supersessionCandidates.length} candidate edges ${JSON.stringify(where)}, `
    + `${x.raq.length} RAQ threads / ${x.raq.reduce((a, t) => a + t.claims.length, 0)} claims, `
    + `${x.glossary.length} glossary rows, ${x.cards.length} printed cards, ${x.printedPages.length} printed pages, `
    + `${x.tests.reduce((a, t) => a + t.titles.length, 0)} test titles in ${x.tests.length} files, `
    + `${x.engineSymbols.length} engine symbols`);
}
